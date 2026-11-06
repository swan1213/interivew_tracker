import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'iflow-traffic-'));
process.env.IFLOW_DATA_DIR = dir;
process.env.GOOGLE_MOCK = '1';
delete process.env.ANTHROPIC_API_KEY;

const NOW = new Date('2026-10-26T09:12:00');

describe('storage traffic', () => {
  let sync: typeof import('./sync');
  let store: typeof import('./store');
  let mock: typeof import('./google/mock');
  const acct = {
    id: 'g-t', email: 'jordan.lee@gmail.example', name: 'Jordan Lee', provider: 'Gmail' as const, color: '#3F6FD8', initial: 'G',
    refreshToken: 'x', accessToken: 'x', expiresAt: Date.now() + 3600_000, lastSync: null as string | null, scopes: [],
  };
  const file = () => join(dir, store.mailFile(acct.id));
  const fresh = async () => {
    const api = new mock.MockGmail();
    api.messages.clear();
    mock.demoAsGmail(NOW).forEach((m) => api.messages.set(m.id, m));
    await store.writeAccounts([acct]);
    await store.removeKey(store.mailFile(acct.id));
    await store.removeKey(store.syncIndexFile(acct.id));
    await sync.syncAccount(acct, api, NOW);
    await sync.syncAccount(acct, api, NOW); // has the labels of everything now
    return api;
  };
  /** Any read or write of the mailbox from here on shows: reading fails, and a write replaces this. */
  const lockMailbox = () => writeFileSync(file(), 'not json', 'utf8');

  beforeAll(async () => {
    sync = await import('./sync');
    store = await import('./store');
    mock = await import('./google/mock');
  });

  it('a sync with nothing new neither reads nor writes the mailbox', async () => {
    const api = await fresh();
    lockMailbox();
    const r = await sync.syncAccount(acct, api, NOW);
    expect(r).toMatchObject({ newMessages: 0, removed: 0, pending: 0, refining: 0 });
    expect(readFileSync(file(), 'utf8')).toBe('not json');
  });

  it('with the job filter on, new mail that is not job related does not touch the mailbox, and is not fetched twice', async () => {
    process.env.GMAIL_JOB_FILTER = 'on';
    const api = await fresh();
    const sample = [...api.messages.values()][0];
    api.messages.set('junk', { ...sample, id: 'junk', threadId: 't-junk', snippet: 'Your pizza is on the way', payload: { ...sample.payload, headers: [{ name: 'From', value: 'Pizza <hi@pizza.example>' }, { name: 'Subject', value: 'Your pizza is on the way' }], parts: undefined, body: { data: Buffer.from('Enjoy your dinner').toString('base64url') } } } as typeof sample);
    lockMailbox();
    const get = vi.spyOn(api, 'getThread');
    await sync.syncAccount(acct, api, NOW);
    expect(get).toHaveBeenCalledTimes(1);
    await sync.syncAccount(acct, api, NOW);
    expect(get).toHaveBeenCalledTimes(1);
    expect(readFileSync(file(), 'utf8')).toBe('not json');
    delete process.env.GMAIL_JOB_FILTER;
  });

  it('a read or star change in Gmail still reaches the app, without a new mail version', async () => {
    const api = await fresh();
    const unread = async () => (await store.readMail(acct.id)).threads['t-e1'].messages.some((m) => m.labelIds.includes('UNREAD'));
    expect(await unread()).toBe(true);
    await api.modifyThread('t-e1', [], ['UNREAD']);
    await sync.syncAccount(acct, api, NOW);
    expect(await unread()).toBe(false);
  });

  it('new job mail changes the version the browser reloads on; nothing new keeps it', async () => {
    const api = await fresh();
    const rev = async () => (await store.readAccounts()).find((a) => a.id === acct.id)?.mailRev;
    const first = await rev();
    expect(first).toBeTruthy();
    await sync.syncAccount(acct, api, NOW);
    expect(await rev()).toBe(first);
    await store.removeKey(store.syncIndexFile(acct.id));
    await store.writeMail(acct.id, { threads: {}, skipped: [], lastSync: null });
    await new Promise((r) => setTimeout(r, 2));
    const r = await sync.syncAccount(acct, api, NOW);
    expect(r.newMessages).toBeGreaterThan(0);
    expect(await rev()).not.toBe(first);
  });

  it('accepts mailboxes saved before the index, without fetching their mail again', async () => {
    const api = await fresh();
    await store.removeKey(store.syncIndexFile(acct.id));
    const get = vi.spyOn(api, 'getThread');
    await sync.syncAccount(acct, api, NOW);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('a blocked database', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    process.env.GOOGLE_MOCK = '1';
  });

  it('says what is wrong instead of passing on the raw Redis error', async () => {
    const store = await import('./store');
    process.env.GOOGLE_MOCK = '';
    process.env.KV_REST_API_URL = 'https://redis.example';
    process.env.KV_REST_API_TOKEN = 't';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'ERR This database has reached current Fixed plan limits. Please upgrade manually or enable auto upgrade on Upstash Console' }), { status: 400 }));
    await expect(store.readAccounts()).rejects.toThrow(store.STORAGE_FULL);
  });
});
