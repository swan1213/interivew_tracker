import { accessTokenFor, GmailError, paceRequests, RATE_LIMITED } from '../google/gmail';
import type { StoredAccount } from '../types';

const BASE = 'https://graph.microsoft.com/v1.0';

/** One page of a Graph collection. */
export interface Page<T> { value?: T[]; '@odata.nextLink'?: string }

export interface GraphOpts {
  /** Extra `Prefer` values, e.g. text bodies or UTC times. */
  prefer?: string[];
  /** How a failed request is reported; the mail and calendar adapters use their own error types. */
  fail?: (status: number, message: string) => Error;
}

/**
 * A Microsoft Graph request for the account. Ids are requested as immutable, so a message keeps
 * its id when it moves between folders (Graph ids otherwise change on archive or delete).
 * Throttling (429, 503) waits as Graph asks, then reports Gmail's rate-limit error so sync
 * saves what it has and the app continues shortly.
 */
export async function graph<T>(acct: StoredAccount, path: string, init: RequestInit = {}, o: GraphOpts = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await paceRequests(acct.id, 5);
    const token = await accessTokenFor(acct);
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: ['IdType="ImmutableId"', ...(o.prefer || [])].join(', '), ...((init.headers as Record<string, string>) || {}) };
    const r = await fetch(path.startsWith('https://') ? path : BASE + path, { ...init, headers });
    if (r.ok) return (r.status === 202 || r.status === 204 ? undefined : await r.json()) as T;
    if (r.status === 429 || r.status === 503) {
      if (attempt < 2) {
        const wait = Math.min(8, Number(r.headers.get('Retry-After')) || 2) * 1000;
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      throw new GmailError(429, RATE_LIMITED);
    }
    const text = await r.text().catch(() => '');
    let msg = text.slice(0, 200);
    try {
      msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message || msg;
    } catch {
      /* not JSON */
    }
    const message = 'Microsoft Graph ' + r.status + ': ' + (msg || 'request failed');
    throw o.fail ? o.fail(r.status, message) : new Error(message);
  }
}

/** Every item of a paged collection, up to `max`. */
export async function graphAll<T>(acct: StoredAccount, path: string, max: number, o: GraphOpts = {}): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  while (next && out.length < max) {
    const page: Page<T> = await graph<Page<T>>(acct, next, {}, o);
    out.push(...(page.value || []));
    next = page['@odata.nextLink'];
  }
  return out.slice(0, max);
}

/** An OData string literal ('it''s'). */
export const odataString = (s: string): string => "'" + s.replace(/'/g, "''") + "'";
