import { cfg, tokenSecret } from '../config';
import { b64url, decrypt, encrypt } from '../crypto';
import type { GmailMessage } from '../mime';
import { readAccounts, writeAccounts } from '../store';
import type { StoredAccount } from '../types';
import { MockGmail } from './mock';
import { refreshAccessToken } from './oauth';

/** The slice of Gmail the app needs. Real and mock implementations share it. */
export interface GmailApi {
  listMessageIds(query: string, max: number): Promise<string[]>;
  getMessage(id: string, format?: 'full' | 'minimal'): Promise<GmailMessage>;
  modifyThread(threadId: string, add: string[], remove: string[]): Promise<void>;
  send(raw: string, threadId?: string): Promise<{ id: string }>;
}

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Returns a valid access token for the account, refreshing and persisting when needed. */
export async function accessTokenFor(acct: StoredAccount): Promise<string> {
  const secret = tokenSecret();
  if (acct.expiresAt - Date.now() > 60_000) return decrypt(acct.accessToken, secret);
  const t = await refreshAccessToken(decrypt(acct.refreshToken, secret));
  acct.accessToken = encrypt(t.access_token, secret);
  acct.expiresAt = Date.now() + t.expires_in * 1000;
  if (t.refresh_token) acct.refreshToken = encrypt(t.refresh_token, secret);
  await writeAccounts((await readAccounts()).map((a) => (a.id === acct.id ? acct : a)));
  return t.access_token;
}

export class RealGmail implements GmailApi {
  constructor(private acct: StoredAccount) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await accessTokenFor(this.acct);
    const r = await fetch(BASE + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error('Gmail API ' + r.status + ' on ' + path + (text ? ': ' + text.slice(0, 300) : ''));
    }
    return (await r.json()) as T;
  }

  async listMessageIds(query: string, max: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken = '';
    while (ids.length < max) {
      const q = new URLSearchParams({ q: query, maxResults: String(Math.min(100, max - ids.length)) });
      if (pageToken) q.set('pageToken', pageToken);
      const j = await this.call<{ messages?: { id: string }[]; nextPageToken?: string }>('/messages?' + q.toString());
      (j.messages || []).forEach((m) => ids.push(m.id));
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    return ids;
  }

  getMessage(id: string, format: 'full' | 'minimal' = 'full'): Promise<GmailMessage> {
    return this.call<GmailMessage>('/messages/' + encodeURIComponent(id) + '?format=' + format);
  }

  async modifyThread(threadId: string, add: string[], remove: string[]): Promise<void> {
    await this.call('/threads/' + encodeURIComponent(threadId) + '/modify', { method: 'POST', body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
  }

  send(raw: string, threadId?: string): Promise<{ id: string }> {
    return this.call<{ id: string }>('/messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) });
  }
}

/** Build an RFC 2822 reply and return it base64url-encoded for messages.send. */
export function buildRawReply(o: { fromName: string; fromAddr: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string }): string {
  const enc = (s: string) => (/[^\x20-\x7e]/.test(s) ? '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=' : s);
  const lines = [
    'From: ' + enc(o.fromName) + ' <' + o.fromAddr + '>',
    'To: ' + o.to,
    'Subject: ' + enc(o.subject),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (o.inReplyTo) lines.push('In-Reply-To: ' + o.inReplyTo);
  if (o.references) lines.push('References: ' + o.references);
  const body = Buffer.from(o.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return b64url(lines.join('\r\n') + '\r\n\r\n' + body);
}

export function gmailFor(acct: StoredAccount): GmailApi {
  if (cfg.mock) return MockGmail.for(acct.id);
  return new RealGmail(acct);
}
