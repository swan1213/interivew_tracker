import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Scratch data directory before any server module loads.
process.env.IFLOW_DATA_DIR = mkdtempSync(join(tmpdir(), 'iflow-reconnect-'));
delete process.env.GOOGLE_MOCK;
delete process.env.TOKEN_SECRET;

describe('a mailbox whose access expired or was revoked', () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = async () => {
    const { encrypt } = await import('./crypto');
    const { tokenSecret } = await import('./config');
    const store = await import('./store');
    const acct = {
      id: 'g-lost', email: 'gregory@gmail.example', name: 'Gregory', provider: 'Gmail' as const, color: '#3F6FD8', initial: 'G',
      refreshToken: encrypt('old-refresh', tokenSecret()), accessToken: encrypt('old', tokenSecret()), expiresAt: 0, lastSync: null, scopes: [],
    };
    await store.writeAccounts([acct]);
    return { acct, store };
  };
  const google = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('is flagged for reconnecting, says so, and shows it in the snapshot', async () => {
    const { acct, store } = await setup();
    const { accessTokenFor } = await import('./google/gmail');
    const { buildSnapshot } = await import('./derive');
    google(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    await expect(accessTokenFor({ ...acct })).rejects.toThrow('Google access for gregory@gmail.example expired or was revoked. Reconnect it in Connected Accounts.');
    const [saved] = await store.readAccounts();
    expect(saved.authError).toContain('expired or was revoked');
    expect(buildSnapshot([saved], {}, new Date()).accts[0].reconnect).toContain('gregory@gmail.example');
  });

  it('clears the flag once a refresh works again, and leaves other errors alone', async () => {
    const { acct, store } = await setup();
    const { accessTokenFor } = await import('./google/gmail');
    google(500, { error: 'backend_error' });
    await expect(accessTokenFor({ ...acct })).rejects.toThrow('Google token error');
    expect((await store.readAccounts())[0].authError).toBeUndefined();

    await store.updateAccounts((l) => l.map((a) => ({ ...a, authError: 'old problem' })));
    google(200, { access_token: 'new', expires_in: 3600 });
    expect(await accessTokenFor({ ...(await store.readAccounts())[0] })).toBe('new');
    expect((await store.readAccounts())[0].authError).toBeUndefined();
  });
});
