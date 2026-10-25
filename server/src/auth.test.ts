import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Scratch data directory, fake Google, and the default owner before any server module loads.
process.env.IFLOW_DATA_DIR = mkdtempSync(join(tmpdir(), 'iflow-auth-'));
process.env.GOOGLE_MOCK = '1';
delete process.env.ADMIN_EMAIL;
delete process.env.TOKEN_SECRET;

const OWNER = 'winterhot223@gmail.com';

describe('session cookies', () => {
  it('round-trips, and rejects tampering and expiry', async () => {
    const { signSession, verifySession } = await import('./session');
    const tok = signSession({ email: 'A@X.com', name: 'A', exp: Date.now() + 60_000 });
    expect(verifySession(tok)?.email).toBe('a@x.com');
    const [body, mac] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ email: OWNER, name: 'x', exp: Date.now() + 60_000 })).toString('base64url');
    expect(verifySession(forged + '.' + mac)).toBeNull();
    expect(verifySession(body + '.' + mac.slice(0, -2) + 'AA')).toBeNull();
    expect(verifySession(signSession({ email: 'a@x.com', name: 'A', exp: Date.now() - 1 }))).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });
});

describe('guest redaction', () => {
  it('keeps the analytics fields and drops mail content', async () => {
    const { redactForGuest } = await import('./redact');
    const { buildDemoData } = await import('../../src/data/demo');
    const full = buildDemoData();
    const r = redactForGuest(full);
    const json = JSON.stringify(r);
    for (const secret of ['Priya', 'Microsoft', 'Amazon', 'chime.example', 'interview guide', full.emails[0].subject]) expect(json).not.toContain(secret);
    expect(r.emails.map((e) => [e.id, e.acct, e.cat, e.ago])).toEqual(full.emails.map((e) => [e.id, e.acct, e.cat, e.ago]));
    expect(r.apps.map((a) => a.stage)).toEqual(full.apps.map((a) => a.stage));
    expect(r.notifs).toEqual([]);
    // Placeholders stay consistent so events still match applications.
    const v3 = r.events.find((v) => v.id === 'v3')!;
    expect(r.apps.some((a) => a.co === v3.co)).toBe(true);
  });
});

describe('API access control', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const { createApi } = await import('./api');
    server = createApi().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  /** Mock sign-in: returns the session cookie, or '' with the redirect location when refused. */
  async function signIn(email: string): Promise<{ cookie: string; location: string }> {
    const r = await fetch(base + '/auth/login?as=' + encodeURIComponent(email), { redirect: 'manual' });
    const set = r.headers.get('set-cookie') || '';
    return { cookie: set.split(';')[0], location: r.headers.get('location') || '' };
  }
  const req = (cookie: string, path: string, method = 'GET', body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  it('refuses everything but health and sign-in without a session', async () => {
    expect((await fetch(base + '/health')).status).toBe(200);
    for (const [path, method] of [['/snapshot', 'GET'], ['/sync', 'POST'], ['/team', 'GET'], ['/mail/x:y/read', 'POST'], ['/accounts/x', 'DELETE'], ['/auth/me', 'GET']]) {
      const r = await fetch(base + path, { method });
      expect(r.status, method + ' ' + path).toBe(401);
      expect((await r.json()).code).toBe('signed_out');
    }
  });

  it('rejects a forged cookie', async () => {
    const r = await req('iflow_session=eyJlbWFpbCI6Indpbn0.abc', '/auth/me');
    expect(r.status).toBe(401);
  });

  it('only lets people on the team sign in', async () => {
    const r = await signIn('stranger@example.com');
    expect(r.cookie).toBe('');
    expect(decodeURIComponent(r.location)).toContain('stranger@example.com is not on this workspace');
  });

  it('signs the owner in as an admin who cannot be demoted or removed', async () => {
    const { cookie } = await signIn(OWNER);
    expect(cookie).toMatch(/^iflow_session=/);
    const me = await (await req(cookie, '/auth/me')).json();
    expect(me.user).toMatchObject({ email: OWNER, role: 'admin', owner: true });
    expect((await req(cookie, '/team/' + encodeURIComponent(OWNER), 'PATCH', { role: 'guest' })).status).toBe(409);
    expect((await req(cookie, '/team/' + encodeURIComponent(OWNER), 'DELETE')).status).toBe(409);
  });

  it('enforces guest, member and admin permissions', async () => {
    const admin = (await signIn(OWNER)).cookie;
    expect((await req(admin, '/team', 'POST', { name: 'Gail Guest', email: 'Guest@Example.com', role: 'guest' })).status).toBe(201);
    expect((await req(admin, '/team', 'POST', { name: 'Mo Member', email: 'member@example.com', role: 'member' })).status).toBe(201);
    expect((await req(admin, '/team', 'POST', { name: 'Dup', email: 'guest@example.com', role: 'member' })).status).toBe(409);
    expect((await req(admin, '/team', 'POST', { name: 'Bad', email: 'x@y.com', role: 'boss' })).status).toBe(400);

    const guest = (await signIn('guest@example.com')).cookie;
    expect((await (await req(guest, '/auth/me')).json()).user.role).toBe('guest');
    const snap = await req(guest, '/snapshot');
    expect(snap.status).toBe(200);
    expect((await snap.json()).snapshot.notifs).toEqual([]);
    for (const [path, method] of [['/sync', 'POST'], ['/team', 'GET'], ['/mail/x:y/read', 'POST'], ['/mail/x:y/send', 'POST'], ['/accounts/x', 'DELETE'], ['/auth/google/start', 'GET']]) {
      const r = await req(guest, path, method, method === 'POST' ? {} : undefined);
      expect(r.status, 'guest ' + method + ' ' + path).toBe(403);
      expect((await r.json()).code).toBe('forbidden');
    }

    const member = (await signIn('member@example.com')).cookie;
    expect((await req(member, '/sync', 'POST', {})).status).toBe(200);
    expect((await req(member, '/team')).status).toBe(403);
    expect((await req(member, '/team', 'POST', { name: 'X', email: 'x@example.com', role: 'admin' })).status).toBe(403);
    expect((await req(member, '/accounts/nope', 'DELETE')).status).toBe(404);
  });

  it('applies role changes and removals on the next request', async () => {
    const admin = (await signIn(OWNER)).cookie;
    const member = (await signIn('member@example.com')).cookie;
    expect((await req(admin, '/team/member%40example.com', 'PATCH', { role: 'guest' })).status).toBe(200);
    expect((await req(member, '/sync', 'POST', {})).status).toBe(403);
    expect((await req(admin, '/team/member%40example.com', 'DELETE')).status).toBe(200);
    const r = await req(member, '/snapshot');
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('not_on_team');
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('an admin cannot remove themselves', async () => {
    const owner = (await signIn(OWNER)).cookie;
    expect((await req(owner, '/team', 'POST', { name: 'Ada Admin', email: 'ada@example.com', role: 'admin' })).status).toBe(201);
    const ada = (await signIn('ada@example.com')).cookie;
    expect((await req(ada, '/team')).status).toBe(200);
    expect((await req(ada, '/team/ada%40example.com', 'DELETE')).status).toBe(409);
  });

  it('signing out clears the cookie', async () => {
    const r = await req((await signIn(OWNER)).cookie, '/auth/logout', 'POST', {});
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
