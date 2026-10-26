import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Scratch data directory (token secret) before any server module loads; real adapters, faked fetch.
process.env.IFLOW_DATA_DIR = mkdtempSync(join(tmpdir(), 'iflow-ms-'));
delete process.env.GOOGLE_MOCK;
delete process.env.TOKEN_SECRET;

const folders = { inbox: 'F-IN', sentitems: 'F-SENT', deleteditems: 'F-DEL', junkemail: 'F-JUNK', drafts: 'F-DRAFT' };
const gmsg = (over: Record<string, unknown> = {}) => ({
  id: 'm1', conversationId: 'c1', parentFolderId: 'F-IN', subject: 'Interview with Contoso', isRead: false, flag: { flagStatus: 'flagged' },
  from: { emailAddress: { name: 'Riya Shah', address: 'riya@contoso.example' } }, toRecipients: [{ emailAddress: { name: 'Jordan Lee', address: 'jordan.lee@outlook.example' } }],
  receivedDateTime: '2026-10-22T14:00:00Z', internetMessageId: '<abc@contoso.example>', body: { contentType: 'text', content: 'Hi Jordan,\nCould you share your availability?' },
  attachments: [{ id: 'a1', name: 'JD.pdf', size: 2048, isInline: false }, { id: 'a2', name: 'logo.png', size: 100, isInline: true }], ...over,
});

describe('Outlook messages as Gmail messages', () => {
  it('maps conversation, folders, read and flag state, headers, body and attachments', async () => {
    const { toGmailMessage } = await import('./mail');
    const { parseMessage } = await import('../mime');
    const g = toGmailMessage(gmsg(), folders);
    expect(g.threadId).toBe('c1');
    expect(g.labelIds).toEqual(['UNREAD', 'STARRED', 'INBOX']);
    const p = parseMessage(g, 'jordan.lee@outlook.example');
    expect(p).toMatchObject({ fromName: 'Riya Shah', fromAddr: 'riya@contoso.example', subject: 'Interview with Contoso', date: '2026-10-22T14:00:00.000Z', isMine: false, messageId: '<abc@contoso.example>' });
    expect(p.bodyText).toBe('Hi Jordan,\nCould you share your availability?');
    expect(p.atts).toEqual([{ name: 'JD.pdf', size: '2 KB' }]);
    expect(toGmailMessage(gmsg({ parentFolderId: 'F-SENT', isRead: true, flag: {} }), folders).labelIds).toEqual(['SENT']);
    expect(toGmailMessage(gmsg({ parentFolderId: 'F-DEL', isRead: true, flag: {} }), folders).labelIds).toEqual(['TRASH']);
  });

  it('reads the Gmail-style searches the sync uses', async () => {
    const { readQuery } = await import('./mail');
    const now = Date.parse('2026-10-26T12:00:00Z');
    expect(readQuery('newer_than:60d -in:spam -in:trash', now)).toEqual({ since: '2026-08-27T12:00:00Z', bin: false, inbox: false, unread: false, flagged: false });
    expect(readQuery('newer_than:60d -in:spam -in:trash is:unread', now).unread).toBe(true);
    expect(readQuery('newer_than:60d -in:spam -in:trash in:inbox', now)).toMatchObject({ inbox: true, bin: false });
    expect(readQuery('in:trash OR in:spam', now)).toMatchObject({ bin: true, since: '' });
  });
});

describe('Outlook events as Google events', () => {
  it('maps times, cancellation, free time, declines, Teams links and the app marker', async () => {
    const { toGEvent, fromGEvent, IFLOW_PROP } = await import('./calendar');
    const { toBusy } = await import('../calendarSync');
    const ev = {
      id: 'e1', subject: 'Interview with NICE', start: { dateTime: '2026-10-27T18:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-27T18:30:00.0000000', timeZone: 'UTC' },
      showAs: 'busy', onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' }, onlineMeetingProvider: 'teamsForBusiness', webLink: 'https://outlook.live.com/calendar/item/e1',
    };
    const g = toGEvent(ev);
    expect(g.start).toEqual({ dateTime: '2026-10-27T18:00:00Z' });
    const acct = { id: 'o1', email: 'jordan.lee@outlook.example', name: 'Jordan', provider: 'Outlook' as const, color: '#0F7C8C', initial: 'J', refreshToken: '', accessToken: '', expiresAt: 0, lastSync: null, scopes: [] };
    expect(toBusy(acct, g)).toMatchObject({ id: 'gcal-o1-e1', co: 'Interview with NICE', role: 'Outlook Calendar', date: '2026-10-27', start: 14, end: 14.5, link: 'https://teams.microsoft.com/l/meetup-join/abc', platform: 'Microsoft Teams', htmlLink: 'https://outlook.live.com/calendar/item/e1' });
    expect(toBusy(acct, toGEvent({ ...ev, isCancelled: true }))).toBeNull();
    expect(toBusy(acct, toGEvent({ ...ev, showAs: 'free' }))).toBeNull();
    expect(toBusy(acct, toGEvent({ ...ev, responseStatus: { response: 'declined' } }))).toBeNull();
    expect(toBusy(acct, toGEvent({ ...ev, singleValueExtendedProperties: [{ id: IFLOW_PROP, value: 'ev-1' }] }))).toBeNull();

    const body = fromGEvent({ summary: 'Amazon · Technical', start: { dateTime: '2026-10-27T11:00:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-27T12:00:00', timeZone: 'America/New_York' }, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] }, extendedProperties: { private: { iflowId: 'ev-9' } } });
    expect(body).toMatchObject({ subject: 'Amazon · Technical', start: { dateTime: '2026-10-27T11:00:00', timeZone: 'Eastern Standard Time' }, isReminderOn: true, reminderMinutesBeforeStart: 60, singleValueExtendedProperties: [{ id: IFLOW_PROP, value: 'ev-9' }] });
  });
});

describe('Outlook mail over Graph', () => {
  afterEach(() => vi.unstubAllGlobals());

  const account = async () => {
    const { encrypt } = await import('../crypto');
    const { tokenSecret } = await import('../config');
    return { id: 'o-test', email: 'jordan.lee@outlook.example', name: 'Jordan Lee', provider: 'Outlook' as const, color: '#0F7C8C', initial: 'J', refreshToken: encrypt('r', tokenSecret()), accessToken: encrypt('tok', tokenSecret()), expiresAt: Date.now() + 3_600_000, lastSync: null, scopes: ['Mail.ReadWrite', 'Calendars.ReadWrite'] };
  };
  /** Answers Graph requests by path; records what was asked. */
  const fakeGraph = (calls: { url: string; init: RequestInit }[]) =>
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const u = new URL(url);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      const wk = /\/me\/mailFolders\/(\w+)$/.exec(u.pathname)?.[1];
      if (wk) return json({ id: (folders as Record<string, string>)[wk] });
      if (u.pathname === '/v1.0/me/sendMail') return new Response(null, { status: 202 });
      if (u.pathname === '/v1.0/me/messages' && u.searchParams.get('$filter')?.startsWith('conversationId')) return json({ value: [gmsg(), gmsg({ id: 'm0', receivedDateTime: '2026-10-21T10:00:00Z', parentFolderId: 'F-SENT', from: { emailAddress: { address: 'jordan.lee@outlook.example' } } })] });
      if (u.pathname === '/v1.0/me/messages') {
        return json({ value: [{ id: 'm1', conversationId: 'c1', parentFolderId: 'F-IN' }, { id: 'm2', conversationId: 'c2', parentFolderId: 'F-JUNK' }, { id: 'm3', conversationId: 'c3', parentFolderId: 'F-DRAFT', isDraft: true }, { id: 'm4', conversationId: 'c4', parentFolderId: 'F-SENT' }] });
      }
      return json({ error: { message: 'not found' } }, 404);
    });

  it('lists mail like the Gmail search (no junk, deleted or drafts) and reads conversations oldest first', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', fakeGraph(calls));
    const { OutlookMail } = await import('./mail');
    const mail = new OutlookMail(await account());
    expect(await mail.listMessages('newer_than:60d -in:spam -in:trash', 100)).toEqual([{ id: 'm1', threadId: 'c1' }, { id: 'm4', threadId: 'c4' }]);
    const list = calls.find((c) => c.url.includes('/me/messages?'))!;
    expect(decodeURIComponent(list.url)).toContain('receivedDateTime ge ');
    expect((list.init.headers as Record<string, string>).Prefer).toContain('IdType="ImmutableId"');
    const thread = await mail.getThread('c1');
    expect(thread.map((m) => m.id)).toEqual(['m0', 'm1']);
    expect(thread[0].labelIds).toEqual(['UNREAD', 'STARRED', 'SENT']);
    await expect(mail.getMessage('gone')).rejects.toMatchObject({ status: 404 });
  });

  it('sends a reply as MIME through sendMail', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', fakeGraph(calls));
    const { OutlookMail } = await import('./mail');
    const { buildRawReply } = await import('../google/gmail');
    const raw = buildRawReply({ fromName: 'Jordan Lee', fromAddr: 'jordan.lee@outlook.example', to: 'riya@contoso.example', subject: 'Re: Interview', body: 'Tuesday works.', inReplyTo: '<abc@contoso.example>' });
    expect(await new OutlookMail(await account()).send(raw)).toEqual({ id: '' });
    const sent = calls.find((c) => c.url.endsWith('/me/sendMail'))!;
    expect((sent.init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
    expect(Buffer.from(String(sent.init.body), 'base64').toString('utf8')).toContain('In-Reply-To: <abc@contoso.example>');
  });

  it('keeps paging until enough mail survives the junk / trash filter, and does not cache a failed folder lookup', async () => {
    let inboxFails = 1;
    const page2 = 'https://graph.microsoft.com/v1.0/me/messages?page=2';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = new URL(url);
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
        const wk = /\/me\/mailFolders\/(\w+)$/.exec(u.pathname)?.[1];
        if (wk === 'inbox' && inboxFails-- > 0) return json({ error: { message: 'busy' } }, 500);
        if (wk) return json({ id: (folders as Record<string, string>)[wk] });
        if (url === page2) return json({ value: [{ id: 'm9', conversationId: 'c9', parentFolderId: 'F-IN' }] });
        return json({ value: [{ id: 'j1', conversationId: 'cj', parentFolderId: 'F-JUNK' }, { id: 'd1', conversationId: 'cd', parentFolderId: 'F-DEL' }], '@odata.nextLink': page2 });
      }),
    );
    const { OutlookMail } = await import('./mail');
    const mail = new OutlookMail({ ...(await account()), id: 'o-paging' });
    await expect(mail.listMessages('newer_than:60d', 1)).rejects.toBeTruthy();
    expect(await mail.listMessages('newer_than:60d', 1)).toEqual([{ id: 'm9', threadId: 'c9' }]);
  });
});
