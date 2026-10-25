import express, { type NextFunction, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { cfg, tokenSecret } from './config';
import { decrypt, encrypt } from './crypto';
import { busyEvents, dropCalendarAccount, NoCalendarError, pushEvent, readCalendar, removeEvent, syncCalendar } from './calendarSync';
import { accountColors, accountInitial, ACCOUNT_COLORS, buildSnapshot, conversationGroups } from './derive';
import { hasCalendar } from './google/calendar';
import { buildRawReply, gmailFor } from './google/gmail';
import { MOCK_USER, mockTokens } from './google/mock';
import { authUrl, beginAuth, exchangeCode, fetchUserInfo, revokeToken, takeAuthRequest } from './google/oauth';
import { redactForGuest } from './redact';
import { atLeast, clearSessionCookie, requireRole, setSessionCookie, userOf, type SignedInUser } from './session';
import { addTeamMember, findMember, listTeam, normEmail, rememberName, removeTeamMember, setTeamRole, type TeamResult } from './team';
import { mailFile, readAccounts, readMail, removeKey, writeAccounts, writeMail } from './store';
import { syncAccount, updateStoredLabels } from './sync';
import type { CalEvent } from '../../src/data/types';
import type { StoredAccount } from './types';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function splitId(id: string): { acctId: string; threadId: string } {
  const i = id.indexOf(':');
  return i < 0 ? { acctId: '', threadId: id } : { acctId: id.slice(0, i), threadId: id.slice(i + 1) };
}

const enc = encodeURIComponent;

/**
 * The HTTP API, mounted at /api by the Vite plugin (dev) and the production server.
 * Every route except health and sign-in needs a session; the role decides the rest:
 * guest = redacted snapshot only, member = mail and accounts, admin = also the team.
 */
export function createApi(): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ configured: cfg.configured, mock: cfg.mock, provider: 'gmail', ai: !!cfg.anthropicKey && !cfg.mock, auth: cfg.configured });
  });

  const home = (res: Response, q = '') => res.redirect(cfg.appUrl + '/' + q);
  const authError = (res: Response, msg: string) => home(res, '?auth_error=' + enc(msg));
  const notOnTeam = (email: string) => email + ' is not on this workspace’s team. Ask an admin to add you.';

  /** Sign in to the app. Mock mode signs in as ?as=<email> (default: the first owner) without Google. */
  app.get(
    '/auth/login',
    wrap(async (req, res) => {
      if (!cfg.configured) {
        res.status(503).json({ error: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env and restart.' });
        return;
      }
      if (cfg.mock) {
        const as = normEmail(String(req.query.as || '')) || cfg.adminEmails[0];
        const m = await findMember(as);
        if (!m) {
          authError(res, notOnTeam(as));
          return;
        }
        setSessionCookie(res, m.email, m.name);
        home(res);
        return;
      }
      const { state, verifier } = await beginAuth('login');
      res.redirect(authUrl(state, verifier, 'login'));
    }),
  );

  app.post('/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get(
    '/auth/me',
    wrap(async (req, res) => {
      const r = await userOf(req);
      if (!r.user) {
        if (r.status === 403) clearSessionCookie(res);
        res.status(r.status || 401).json({ error: r.error, code: r.code });
        return;
      }
      res.json({ user: r.user });
    }),
  );

  /** Connect a Gmail mailbox (members and admins). */
  app.get(
    '/auth/google/start',
    requireRole('member'),
    wrap(async (_req, res) => {
      if (!cfg.configured) {
        res.status(503).json({ error: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env and restart.' });
        return;
      }
      const { state, verifier } = await beginAuth('connect');
      if (cfg.mock) {
        res.redirect('/api/auth/google/callback?code=mock&state=' + encodeURIComponent(state));
        return;
      }
      res.redirect(authUrl(state, verifier));
    }),
  );

  app.get(
    '/auth/google/callback',
    wrap(async (req, res) => {
      const back = (q: string) => res.redirect(cfg.appUrl + '/accounts?' + q);
      const q = req.query as Record<string, string | undefined>;
      const pend = q.state ? await takeAuthRequest(q.state) : null;
      if (pend?.purpose === 'login') {
        if (q.error || !q.code) {
          authError(res, q.error === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in failed: ' + (q.error || 'no code returned'));
          return;
        }
        const t = await exchangeCode(q.code, pend.verifier);
        const who = await fetchUserInfo(t.access_token);
        if (!who.email || who.email_verified === false) {
          authError(res, 'Google did not return a verified email address.');
          return;
        }
        const m = await findMember(who.email);
        if (!m) {
          authError(res, notOnTeam(normEmail(who.email)));
          return;
        }
        await rememberName(m.email, who.name || '');
        setSessionCookie(res, m.email, who.name || m.name);
        home(res);
        return;
      }
      if (q.error) {
        back('error=' + encodeURIComponent(q.error));
        return;
      }
      const verifier = pend?.verifier;
      if (!q.code || !verifier) {
        back('error=' + encodeURIComponent('The sign-in session expired. Please try again.'));
        return;
      }
      // The browser returns from Google with its session cookie (SameSite=Lax allows top-level navigation).
      const actor = (await userOf(req)).user;
      if (!actor || !atLeast(actor.role, 'member')) {
        back('error=' + encodeURIComponent('Sign in as a member or admin to connect a mailbox.'));
        return;
      }
      const tokens = cfg.mock ? mockTokens() : await exchangeCode(q.code, verifier);
      const info = cfg.mock ? MOCK_USER : await fetchUserInfo(tokens.access_token);
      if (!info.email) {
        back('error=' + encodeURIComponent('Google did not return an email address.'));
        return;
      }
      const secret = tokenSecret();
      const accts = await readAccounts();
      const email = info.email.toLowerCase();
      const id = 'g-' + createHash('sha1').update(email).digest('hex').slice(0, 8);
      const existing = accts.find((a) => a.id === id);
      const refreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token, secret) : existing?.refreshToken;
      if (!refreshToken) {
        back('error=' + encodeURIComponent('Google did not issue a refresh token. Remove this app under your Google account permissions, then connect again.'));
        return;
      }
      const others = accts.filter((a) => a.id !== id);
      const taken = new Set(accountColors(others).values());
      const acct: StoredAccount = {
        id,
        email,
        name: info.name || email,
        provider: 'Gmail',
        color: existing && !taken.has(existing.color) ? existing.color : ACCOUNT_COLORS.find((c) => !taken.has(c)) || ACCOUNT_COLORS[others.length % ACCOUNT_COLORS.length],
        initial: accountInitial(email),
        refreshToken,
        accessToken: encrypt(tokens.access_token, secret),
        expiresAt: Date.now() + tokens.expires_in * 1000,
        lastSync: existing?.lastSync ?? null,
        scopes: (tokens.scope || '').split(' ').filter(Boolean),
      };
      await writeAccounts(existing ? accts.map((a) => (a.id === id ? acct : a)) : accts.concat([acct]));
      back('connected=' + encodeURIComponent(id));
    }),
  );

  app.get(
    '/snapshot',
    requireRole('guest'),
    wrap(async (_req, res) => {
      const accts = await readAccounts();
      const mails = Object.fromEntries(await Promise.all(accts.map(async (a) => [a.id, await readMail(a.id)] as const)));
      const snapshot = buildSnapshot(accts, mails, new Date());
      snapshot.events.push(...busyEvents(await readCalendar(), accts));
      const user = res.locals.user as SignedInUser;
      res.json({ snapshot: user.role === 'guest' ? redactForGuest(snapshot) : snapshot });
    }),
  );

  app.post(
    '/sync',
    requireRole('member'),
    wrap(async (req, res) => {
      const accountId = (req.body as { accountId?: string } | undefined)?.accountId;
      const accts = (await readAccounts()).filter((a) => !accountId || a.id === accountId);
      let newMessages = 0;
      const errors: string[] = [];
      // Every account, and each account's mail and calendar, sync side by side.
      await Promise.all(
        accts.flatMap((a) => [
          syncAccount(a).then(
            (r) => void (newMessages += r.newMessages),
            (e: Error) => void errors.push(a.email + ': ' + e.message),
          ),
          hasCalendar(a) ? syncCalendar(a).catch((e: Error) => void errors.push(a.email + ' calendar: ' + e.message)) : Promise.resolve(),
        ]),
      );
      res.json({ newMessages, errors });
    }),
  );

  const acctOr404 = async (res: Response, id: string): Promise<StoredAccount | null> => {
    const a = (await readAccounts()).find((x) => x.id === id);
    if (!a) res.status(404).json({ error: 'Unknown account' });
    return a || null;
  };

  const labelRoute = (path: string, labels: (body: { on?: boolean }) => { add: string[]; remove: string[] }) =>
    app.post(
      '/mail/:id/' + path,
      requireRole('member'),
      wrap(async (req, res) => {
        const { acctId, threadId } = splitId(String(req.params.id));
        const a = await acctOr404(res, acctId);
        if (!a) return;
        const { add, remove } = labels((req.body as { on?: boolean }) || {});
        // A conversation can span several Gmail threads (calendar notices for one event); label them all.
        const mail = await readMail(a.id);
        const group = conversationGroups(Object.values(mail.threads)).get(threadId);
        for (const id of group ? group.map((t) => t.id) : [threadId]) {
          await gmailFor(a).modifyThread(id, add, remove);
          await updateStoredLabels(a.id, id, add, remove);
        }
        res.json({ ok: true });
      }),
    );
  labelRoute('read', () => ({ add: [], remove: ['UNREAD'] }));
  labelRoute('star', (b) => (b.on ? { add: ['STARRED'], remove: [] } : { add: [], remove: ['STARRED'] }));
  labelRoute('archive', () => ({ add: [], remove: ['INBOX'] }));

  app.post(
    '/mail/:id/send',
    requireRole('member'),
    wrap(async (req, res) => {
      const { acctId, threadId } = splitId(String(req.params.id));
      const body = (req.body || {}) as { accountId?: string; body?: string; mode?: string; to?: string };
      const a = await acctOr404(res, body.accountId || acctId);
      if (!a) return;
      const text = (body.body || '').trim();
      if (!text) {
        res.status(400).json({ error: 'The message is empty.' });
        return;
      }
      const t = (await readMail(acctId)).threads[threadId];
      const head = t ? [...t.messages].reverse().find((m) => !m.isMine) || t.messages[t.messages.length - 1] : undefined;
      if (!head) {
        res.status(404).json({ error: 'Unknown conversation' });
        return;
      }
      const forward = body.mode === 'forward';
      if (forward && !body.to) {
        res.status(400).json({ error: 'Add a recipient to forward this message.' });
        return;
      }
      const subject = (forward ? 'Fwd: ' : 'Re: ') + head.subject.replace(/^((re|fwd?):\s*)+/i, '');
      // The composer's To field wins (reply all, edited recipients); a bare reply goes to the sender.
      const to = (body.to || '').trim() || head.fromName + ' <' + head.fromAddr + '>';
      const raw = buildRawReply({
        fromName: a.name,
        fromAddr: a.email,
        to,
        subject,
        body: text,
        inReplyTo: forward ? undefined : head.messageId,
        references: forward ? undefined : [head.references, head.messageId].filter(Boolean).join(' '),
      });
      const r = await gmailFor(a).send(raw, forward ? undefined : threadId);
      if (!forward) {
        // Record the reply in the stored thread right away; the next sync refreshes its labels.
        const mail = await readMail(acctId);
        const thread = mail.threads[threadId];
        if (thread && !thread.messages.some((m) => m.id === r.id)) {
          thread.messages.push({
            id: r.id, threadId, fromName: a.name, fromAddr: a.email, to, subject, date: new Date().toISOString(),
            bodyText: text, atts: [], labelIds: ['SENT'], messageId: '', inReplyTo: head.messageId, references: head.references, isMine: true,
          });
          await writeMail(acctId, mail);
        }
      }
      res.json({ id: r.id });
    }),
  );

  app.delete(
    '/accounts/:id',
    requireRole('member'),
    wrap(async (req, res) => {
      const accts = await readAccounts();
      const a = accts.find((x) => x.id === String(req.params.id));
      if (!a) {
        res.status(404).json({ error: 'Unknown account' });
        return;
      }
      if (!cfg.mock) {
        try {
          await revokeToken(decrypt(a.refreshToken, tokenSecret()));
        } catch {
          /* best effort */
        }
      }
      await writeAccounts(accts.filter((x) => x.id !== a.id));
      await removeKey(mailFile(a.id));
      // Events already on the Google Calendar stay there; the app just stops tracking them.
      await dropCalendarAccount(a.id);
      res.json({ ok: true });
    }),
  );

  // ---- Google Calendar: mirror interviews the user puts on (or takes off) the calendar ----
  app.put(
    '/calendar/events/:id',
    requireRole('member'),
    wrap(async (req, res) => {
      const ev = ((req.body || {}) as { event?: CalEvent }).event;
      const ok =
        !!ev && ev.id === String(req.params.id) && ev.kind === 'interview' && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date)) &&
        Number.isFinite(ev.start) && Number.isFinite(ev.end) && ev.start >= 0 && ev.end > ev.start && ev.end <= 48;
      if (!ok) {
        res.status(400).json({ error: 'Send an interview with a date and a start before its end.' });
        return;
      }
      try {
        res.json(await pushEvent({ ...ev, co: String(ev.co || 'Interview'), role: String(ev.role || 'Interview') }, await readAccounts()));
      } catch (e) {
        if (!(e instanceof NoCalendarError)) throw e;
        res.status(409).json({ error: e.message, code: 'calendar_scope' });
      }
    }),
  );
  app.delete(
    '/calendar/events/:id',
    requireRole('member'),
    wrap(async (req, res) => {
      res.json({ removed: await removeEvent(String(req.params.id), await readAccounts()) });
    }),
  );

  // ---- team and roles (admins only) ----
  const teamReply = async (res: Response, r: TeamResult) => {
    if (r.error) res.status(r.status).json({ error: r.error });
    else res.status(r.status).json({ member: r.member, team: await listTeam() });
  };
  app.get(
    '/team',
    requireRole('admin'),
    wrap(async (_req, res) => {
      res.json({ team: await listTeam() });
    }),
  );
  app.post(
    '/team',
    requireRole('admin'),
    wrap(async (req, res) => {
      const b = (req.body || {}) as { name?: string; email?: string; role?: string };
      await teamReply(res, await addTeamMember(b.name || '', b.email || '', b.role));
    }),
  );
  app.patch(
    '/team/:email',
    requireRole('admin'),
    wrap(async (req, res) => {
      await teamReply(res, await setTeamRole(String(req.params.email), ((req.body || {}) as { role?: string }).role));
    }),
  );
  app.delete(
    '/team/:email',
    requireRole('admin'),
    wrap(async (req, res) => {
      await teamReply(res, await removeTeamMember(String(req.params.email), (res.locals.user as SignedInUser).email));
    }),
  );

  app.use((req, res) => {
    res.status(404).json({ error: 'No such API route: ' + req.method + ' ' + req.path });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api]', err.message);
    res.status(500).json({ error: err.message });
  });
  return app;
}
