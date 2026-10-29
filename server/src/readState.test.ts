import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Email } from '../../src/data/types';

// Scratch data directory and fake Google before any server module loads.
process.env.IFLOW_DATA_DIR = mkdtempSync(join(tmpdir(), 'iflow-read-'));
process.env.GOOGLE_MOCK = '1';
delete process.env.ADMIN_EMAIL;
delete process.env.TOKEN_SECRET;

const OWNER = 'winterhot223@gmail.com';

describe('marking a selection read or unread', () => {
  let server: Server;
  let base = '';
  let cookie = '';

  beforeAll(async () => {
    const { createApi } = await import('./api');
    server = createApi().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const login = await fetch(base + '/auth/login?as=' + encodeURIComponent(OWNER), { redirect: 'manual' });
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    // Connect the mock Gmail and pull its mail. The API is mounted at / here, not /api.
    const start = await req('/auth/google/start');
    await req(start.headers.get('location')!.replace(/^\/api/, ''));
    await req('/sync', 'POST', {});
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const req = (path: string, method = 'GET', body?: unknown) =>
    fetch(base + path, { method, redirect: 'manual', headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const emails = async (): Promise<Email[]> => (await (await req('/snapshot')).json()).snapshot.emails;

  it('marks every selected conversation in the mailbox and in the stored mail, in one request', async () => {
    const { readAccounts, readMail } = await import('./store');
    const { MockGmail } = await import('./google/mock');
    const [a] = await readAccounts();
    // Conversations you only sent are never shown unread, so pick received ones.
    const ids = (await emails()).filter((e) => e.thread.some((m) => !m.mine)).slice(0, 6).map((e) => e.id);
    expect(ids.length).toBe(6);

    const r = await req('/mail/read-state', 'POST', { ids, unread: true });
    expect(r.status).toBe(200);
    expect((await r.json()).changed).toBe(6);
    expect((await emails()).filter((e) => ids.includes(e.id)).every((e) => e.unread)).toBe(true);
    const gmail = MockGmail.for(a.id);
    const threadOf = (id: string) => id.slice(id.indexOf(':') + 1);
    expect([...gmail.messages.values()].filter((m) => ids.map(threadOf).includes(m.threadId)).every((m) => m.labelIds?.includes('UNREAD'))).toBe(true);

    await req('/mail/read-state', 'POST', { ids, unread: false });
    expect((await emails()).filter((e) => ids.includes(e.id)).some((e) => e.unread)).toBe(false);
    const mail = await readMail(a.id);
    expect(ids.map(threadOf).every((t) => !mail.threads[t].messages.some((m) => m.labelIds.includes('UNREAD')))).toBe(true);
  });

  it('refuses a malformed request', async () => {
    expect((await req('/mail/read-state', 'POST', { ids: 'g:t', unread: true })).status).toBe(400);
    expect((await req('/mail/read-state', 'POST', { ids: ['g:t'] })).status).toBe(400);
  });

  it('needs a member or admin', async () => {
    const r = await fetch(base + '/mail/read-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [], unread: true }) });
    expect(r.status).toBe(401);
  });
});
