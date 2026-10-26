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
  /** Like listMessageIds, with the conversation each message belongs to. */
  listMessages(query: string, max: number): Promise<{ id: string; threadId: string }[]>;
  /** Every message in a conversation, sent and received, oldest first. */
  getThread(threadId: string): Promise<GmailMessage[]>;
  getMessage(id: string, format?: 'full' | 'minimal'): Promise<GmailMessage>;
  modifyThread(threadId: string, add: string[], remove: string[]): Promise<void>;
  send(raw: string, threadId?: string): Promise<{ id: string }>;
}

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** Waits before retrying a rate-limited request; kept short so a sync round still finishes in time. */
const RETRY_MS = [2000, 4000];

/**
 * Gmail allows each user 250 quota units a second (a thread costs 10, a list page 5). Requests
 * for one account are spaced to stay well under that, so a large backfill doesn't trip the limit.
 */
const UNITS_PER_SEC = 150;
const pace = new Map<string, number>();
async function spend(accountId: string, units: number): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, pace.get(accountId) || 0);
  pace.set(accountId, start + (units / UNITS_PER_SEC) * 1000);
  if (start > now) await new Promise((r) => setTimeout(r, start - now));
}

export const RATE_LIMITED = 'Gmail is limiting how fast this app can read mail. It will continue shortly.';
/** Gmail turned requests away for going too fast; waiting a little and continuing works. */
export const isRateLimitError = (e: unknown): boolean => e instanceof GmailError && e.status === 429;

/** Google's own message from an error body, without the JSON around it. */
export function googleError(status: number, text: string): string {
  try {
    const m = (JSON.parse(text) as { error?: { message?: string } }).error?.message;
    if (m) return m;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 200) || 'HTTP ' + status;
}

/** A failed Gmail request, with its HTTP status (404: the message or thread no longer exists). */
export class GmailError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Searches for Trash or Spam need includeSpamTrash, or Gmail leaves those messages out. */
export const searchesBin = (query: string): boolean => /(^|[\s(])in:(trash|spam)\b/.test(query);

/** Too many requests: 429, or 403 with a rate-limit or quota reason. */
export const isRateLimited = (status: number, text: string): boolean => status === 429 || (status === 403 && /rateLimitExceeded|quota exceeded/i.test(text));

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

  private async call<T>(path: string, init: RequestInit = {}, units = 5): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await spend(this.acct.id, units);
      const token = await accessTokenFor(this.acct);
      const r = await fetch(BASE + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers || {}) } });
      if (r.ok) return (await r.json()) as T;
      const text = await r.text().catch(() => '');
      if (isRateLimited(r.status, text)) {
        // Slow every request for this account down, not just this one.
        pace.set(this.acct.id, Math.max(pace.get(this.acct.id) || 0, Date.now() + RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]));
        if (attempt < RETRY_MS.length) {
          await new Promise((res) => setTimeout(res, RETRY_MS[attempt]));
          continue;
        }
        throw new GmailError(429, RATE_LIMITED);
      }
      throw new GmailError(r.status, 'Gmail API ' + r.status + ': ' + googleError(r.status, text));
    }
  }

  async listMessages(query: string, max: number): Promise<{ id: string; threadId: string }[]> {
    const out: { id: string; threadId: string }[] = [];
    let pageToken = '';
    while (out.length < max) {
      const q = new URLSearchParams({ q: query, maxResults: String(Math.min(500, max - out.length)) });
      if (searchesBin(query)) q.set('includeSpamTrash', 'true');
      if (pageToken) q.set('pageToken', pageToken);
      const j = await this.call<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>('/messages?' + q.toString());
      out.push(...(j.messages || []));
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    return out;
  }

  async listMessageIds(query: string, max: number): Promise<string[]> {
    return (await this.listMessages(query, max)).map((m) => m.id);
  }

  async getThread(threadId: string): Promise<GmailMessage[]> {
    return (await this.call<{ messages?: GmailMessage[] }>('/threads/' + encodeURIComponent(threadId) + '?format=full', {}, 10)).messages || [];
  }

  getMessage(id: string, format: 'full' | 'minimal' = 'full'): Promise<GmailMessage> {
    return this.call<GmailMessage>('/messages/' + encodeURIComponent(id) + '?format=' + format);
  }

  async modifyThread(threadId: string, add: string[], remove: string[]): Promise<void> {
    await this.call('/threads/' + encodeURIComponent(threadId) + '/modify', { method: 'POST', body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) }, 10);
  }

  send(raw: string, threadId?: string): Promise<{ id: string }> {
    return this.call<{ id: string }>('/messages/send', { method: 'POST', body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) }, 100);
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
