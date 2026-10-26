import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Point the server at a scratch data directory with the fake Google before loading modules.
process.env.IFLOW_DATA_DIR = mkdtempSync(join(tmpdir(), 'iflow-test-'));
process.env.GOOGLE_MOCK = '1';
delete process.env.ANTHROPIC_API_KEY;

const NOW = new Date('2026-10-26T09:12:00');

describe('sync → classify → derive with the mock Gmail', () => {
  let sync: typeof import('./sync');
  let derive: typeof import('./derive');
  let store: typeof import('./store');
  let mock: typeof import('./google/mock');
  let api: import('./google/mock').MockGmail;
  const acct = {
    id: 'g-test', email: 'jordan.lee@gmail.example', name: 'Jordan Lee', provider: 'Gmail' as const, color: '#3F6FD8', initial: 'G',
    refreshToken: 'x', accessToken: 'x', expiresAt: Date.now() + 3600_000, lastSync: null, scopes: [],
  };

  beforeAll(async () => {
    sync = await import('./sync');
    derive = await import('./derive');
    store = await import('./store');
    mock = await import('./google/mock');
    await store.writeAccounts([acct]);
    api = new mock.MockGmail();
    // Rebuild the fixture on the test clock so dates match the demo text.
    api.messages.clear();
    mock.demoAsGmail(NOW).forEach((m) => api.messages.set(m.id, m));
  });

  it('first sync stores and classifies every job-related thread', async () => {
    const r = await sync.syncAccount(acct, api, NOW);
    expect(r.newMessages).toBe(13); // 12 threads, one with an earlier message
    const mail = await store.readMail(acct.id);
    expect(Object.keys(mail.threads)).toHaveLength(12);
    expect(Object.values(mail.threads).every((t) => t.classification)).toBe(true);
    expect(mail.threads['t-e7'].messages).toHaveLength(2);
  });

  it('a second sync adds nothing and keeps classifications', async () => {
    const r = await sync.syncAccount(acct, api, NOW);
    expect(r.newMessages).toBe(0);
  });

  it('derives emails, applications, events, notifications and activity', async () => {
    const accts = await store.readAccounts();
    const snap = derive.buildSnapshot(accts, { [acct.id]: await store.readMail(acct.id) }, NOW);
    expect(snap.accts[0]).toMatchObject({ id: 'g-test', addr: 'jordan.lee@gmail.example', provider: 'Gmail' });
    expect(snap.emails).toHaveLength(12);
    const amazon = snap.emails.find((e) => e.company === 'Amazon')!;
    expect(amazon.cat).toBe('confirmed');
    expect(amazon.unread).toBe(true);
    expect(amazon.starred).toBe(true);
    expect(amazon.evId).toBe('ev-' + amazon.id);
    expect(amazon.thread).toHaveLength(1);
    expect(amazon.time).toBe('7:37 AM');
    const atl = snap.emails.find((e) => e.company === 'Atlassian')!;
    expect(atl.thread).toHaveLength(2);
    expect(atl.opts).toHaveLength(3);

    const ev = snap.events.find((v) => v.id === amazon.evId)!;
    expect(ev).toMatchObject({ co: 'Amazon', date: '2026-10-27', start: 11, end: 12, added: false, stage: 'tech', platform: 'Amazon Chime' });
    expect(snap.events.some((v) => v.co === 'Northwind Cloud' && v.stage === 'offer')).toBe(true);

    const apps = snap.apps;
    expect(apps.find((a) => a.co === 'Microsoft')?.stage).toBe('sched');
    expect(apps.find((a) => a.co === 'Amazon')?.stage).toBe('confirmed');
    expect(apps.find((a) => a.co === 'Coinbase')?.stage).toBe('closed');
    expect(apps.find((a) => a.co === 'Northwind Cloud')?.stage).toBe('offer');
    expect(apps.find((a) => a.co === 'Stripe')?.stage).toBe('applied');
    expect(apps.some((a) => a.co === 'JobBoard')).toBe(false);

    expect(snap.notifs.length).toBeGreaterThanOrEqual(5);
    expect(snap.notifs.find((n) => n.emailId === amazon.id)?.title).toBe('Interview confirmed');
    expect(snap.activity[0].text).toBe('Microsoft asked for your availability');
  });

  it('label changes and a sent reply are reflected after the next sync', async () => {
    const mail = await store.readMail(acct.id);
    const e1 = mail.threads['t-e1'];
    await api.modifyThread('t-e1', [], ['UNREAD']);
    api.now = () => NOW.getTime() + 60_000;
    await api.send(Buffer.from('From: Jordan <jordan.lee@gmail.example>\r\nSubject: Re: test\r\nContent-Type: text/plain\r\n\r\nThese times work.').toString('base64url'), 't-e1');
    await sync.syncAccount(acct, api, NOW);
    const snap = derive.buildSnapshot(await store.readAccounts(), { [acct.id]: await store.readMail(acct.id) }, NOW);
    const ms = snap.emails.find((e) => e.company === 'Microsoft')!;
    expect(ms.unread).toBe(false);
    expect(ms.thread).toHaveLength(2);
    expect(ms.thread[1].mine).toBe(true);
    expect(ms.replied).toBe(true);
    expect(ms.done).toBe(true);
    expect(ms.ivStatus).toBe('awaiting');
    expect(e1.messages).toHaveLength(1);
  });

  it('keeps every received message and lists conversations you started under Sent', async () => {
    const msg = (id: string, from: string, to: string, subject: string, body: string, labelIds: string[]) => ({
      id, threadId: 't-' + id, labelIds, internalDate: String(NOW.getTime() - 3_600_000),
      payload: {
        mimeType: 'text/plain',
        headers: [{ name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject }, { name: 'Date', value: new Date(NOW.getTime() - 3_600_000).toUTCString() }],
        body: { data: Buffer.from(body).toString('base64url'), size: body.length },
      },
    });
    api.messages.set('news', msg('news', 'Weekly Digest <digest@news.example>', 'Jordan Lee <jordan.lee@gmail.example>', 'Your weekly digest', 'Top stories this week.', ['INBOX', 'UNREAD']));
    api.messages.set('out', msg('out', 'Jordan Lee <jordan.lee@gmail.example>', 'Sam Park <sam@corp.example>', 'Coffee next week?', 'Hi Sam, are you free for coffee next week?', ['SENT']));
    await sync.syncAccount(acct, api, NOW);
    const snap = derive.buildSnapshot(await store.readAccounts(), { [acct.id]: await store.readMail(acct.id) }, NOW);
    const digest = snap.emails.find((e) => e.subject === 'Your weekly digest')!;
    expect([digest.unread, digest.cat, digest.needs]).toEqual([true, 'other', false]);
    expect(snap.apps.some((a) => a.emailId === digest.id)).toBe(false);
    const out = snap.emails.find((e) => e.subject === 'Coffee next week?')!;
    expect([out.cat, out.fromName, out.fromAddr, out.unread, out.needs, out.canReply]).toEqual(['sent', 'To: Sam Park', 'sam@corp.example', false, false, false]);
    expect(out.thread.map((m) => m.mine)).toEqual([true]);

    // A reply arrives in a conversation whose earlier messages are past the newest-N cap: all of it comes along.
    const old = msg('old', 'Jordan Lee <jordan.lee@gmail.example>', 'Ana Ruiz <ana@hire.example>', 'Following up on my application', 'Hi Ana, any update on the role?', ['SENT']);
    api.messages.set('old', { ...old, threadId: 't-conv', internalDate: String(NOW.getTime() - 40 * 86_400_000) });
    api.messages.set('reply', { ...msg('reply', 'Ana Ruiz <ana@hire.example>', 'Jordan Lee <jordan.lee@gmail.example>', 'Re: Following up on my application', 'Thanks Jordan, we would like to schedule an interview.', ['INBOX', 'UNREAD']), threadId: 't-conv', internalDate: String(NOW.getTime() + 120_000) });
    const keep = process.env.GMAIL_MAX_MESSAGES;
    process.env.GMAIL_MAX_MESSAGES = '1';
    await sync.syncAccount(acct, api, NOW);
    if (keep === undefined) delete process.env.GMAIL_MAX_MESSAGES;
    else process.env.GMAIL_MAX_MESSAGES = keep;
    const snap2 = derive.buildSnapshot(await store.readAccounts(), { [acct.id]: await store.readMail(acct.id) }, NOW);
    const conv = snap2.emails.find((e) => e.id === acct.id + ':t-conv')!;
    expect(conv.thread.map((m) => [m.mine, m.addr])).toEqual([[true, 'jordan.lee@gmail.example'], [false, 'ana@hire.example']]);
    expect(conv.peers).toEqual(['ana@hire.example']);
    expect(out.peers).toEqual(['sam@corp.example']);
  });

  it('works through a large backlog over several syncs, newest conversations first', async () => {
    const other = { ...acct, id: 'g-batch' };
    await store.writeAccounts([acct, other]);
    const fresh = new mock.MockGmail();
    fresh.messages.clear();
    mock.demoAsGmail(NOW).forEach((m) => fresh.messages.set(m.id, m));
    process.env.GMAIL_SYNC_BATCH = '5';
    try {
      const pending: number[] = [];
      for (let i = 0; i < 4; i++) pending.push((await sync.syncAccount(other, fresh, NOW)).pending);
      expect(pending).toEqual([7, 2, 0, 0]);
      expect(Object.keys((await store.readMail(other.id)).threads)).toHaveLength(12);
    } finally {
      delete process.env.GMAIL_SYNC_BATCH;
    }
  });

  it('saves what it has when out of time and continues on the next sync', async () => {
    const other = { ...acct, id: 'g-budget' };
    await store.writeAccounts([acct, other]);
    const fresh = new mock.MockGmail();
    fresh.messages.clear();
    mock.demoAsGmail(NOW).forEach((m) => fresh.messages.set(m.id, m));
    process.env.GMAIL_SYNC_BUDGET_MS = '0';
    try {
      const r = await sync.syncAccount(other, fresh, NOW);
      expect([r.newMessages, r.pending]).toEqual([0, 12]);
    } finally {
      delete process.env.GMAIL_SYNC_BUDGET_MS;
    }
    const r2 = await sync.syncAccount(other, fresh, NOW);
    expect([r2.pending, r2.refining]).toEqual([0, 0]);
    expect(Object.keys((await store.readMail(other.id)).threads)).toHaveLength(12);
  });

  it('forgets mail moved to Trash or deleted for good in Gmail', async () => {
    const ids = Object.keys((await store.readMail(acct.id)).threads);
    expect(ids).toContain('t-news');
    expect(ids).toContain('t-out');
    api.messages.get('news')!.labelIds = ['TRASH'];
    api.messages.delete('out');
    const r = await sync.syncAccount(acct, api, NOW);
    expect(r.removed).toBe(2);
    const mail = await store.readMail(acct.id);
    expect(mail.threads['t-news']).toBeUndefined();
    expect(mail.threads['t-out']).toBeUndefined();
    const snap = derive.buildSnapshot(await store.readAccounts(), { [acct.id]: mail }, NOW);
    expect(snap.emails.some((e) => e.subject === 'Your weekly digest' || e.subject === 'Coffee next week?')).toBe(false);
  });
});
