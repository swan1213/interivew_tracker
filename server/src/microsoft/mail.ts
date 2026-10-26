/**
 * Outlook.com / Microsoft 365 mail through Microsoft Graph, behind the same GmailApi the sync
 * uses for Gmail. Graph messages are turned into Gmail-shaped resources (conversation as thread,
 * read / flagged / folder as labels), so parsing, classification and the UI are shared.
 */
import { b64url } from '../crypto';
import { GmailError, searchesBin, type GmailApi } from '../google/gmail';
import type { GmailMessage, GmailPart } from '../mime';
import type { StoredAccount } from '../types';
import { graph, graphAll, odataString, type GraphOpts, type Page } from './graph';

interface Recipient { emailAddress?: { name?: string; address?: string } }
export interface GraphMessage {
  id: string;
  conversationId?: string;
  parentFolderId?: string;
  subject?: string;
  from?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  flag?: { flagStatus?: string };
  internetMessageId?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  attachments?: { id?: string; name?: string; size?: number; isInline?: boolean }[];
}

/** A message as listings return it: just enough to find its conversation and folder. */
type ListRow = { id: string; conversationId?: string; parentFolderId?: string; isDraft?: boolean };

/** Ids of the well-known folders that decide a message's labels. */
export interface Folders { inbox: string; sentitems: string; deleteditems: string; junkemail: string; drafts: string }

const LIST_FIELDS = 'id,conversationId,parentFolderId,receivedDateTime,isDraft';
const FULL_FIELDS = LIST_FIELDS + ',subject,from,toRecipients,ccRecipients,sentDateTime,isRead,flag,internetMessageId,bodyPreview,body';
const STATE_FIELDS = 'id,conversationId,parentFolderId,isRead,flag,isDraft';
/** Plain-text bodies, so the same parser and classifier read them. */
const TEXT: GraphOpts = { prefer: ['outlook.body-content-type="text"'] };
const mailError = (status: number, message: string): Error => new GmailError(status, message);

const who = (r?: Recipient): string => {
  const a = r?.emailAddress;
  if (!a?.address) return '';
  return a.name && a.name !== a.address ? '"' + a.name.replace(/"/g, '') + '" <' + a.address + '>' : a.address;
};

/** A Graph message in the shape of a Gmail API message resource. */
export function toGmailMessage(m: GraphMessage, f: Folders): GmailMessage {
  const labelIds = [
    !m.isRead ? 'UNREAD' : '',
    m.flag?.flagStatus === 'flagged' ? 'STARRED' : '',
    m.parentFolderId === f.inbox ? 'INBOX' : '',
    m.parentFolderId === f.sentitems ? 'SENT' : '',
    m.parentFolderId === f.deleteditems ? 'TRASH' : '',
    m.parentFolderId === f.junkemail ? 'SPAM' : '',
    m.isDraft || m.parentFolderId === f.drafts ? 'DRAFT' : '',
  ].filter(Boolean);
  const when = m.receivedDateTime || m.sentDateTime || '';
  const text = m.body?.content || m.bodyPreview || '';
  const bodyPart: GmailPart = { mimeType: m.body?.contentType === 'html' ? 'text/html' : 'text/plain', body: { data: b64url(Buffer.from(text, 'utf8')), size: text.length } };
  const atts: GmailPart[] = (m.attachments || [])
    .filter((a) => !a.isInline && a.name)
    .map((a) => ({ mimeType: 'application/octet-stream', filename: a.name, body: { attachmentId: a.id || a.name, size: a.size } }));
  const headers = [
    { name: 'From', value: who(m.from) },
    { name: 'To', value: [...(m.toRecipients || []), ...(m.ccRecipients || [])].map(who).filter(Boolean).join(', ') },
    { name: 'Subject', value: m.subject || '' },
    { name: 'Date', value: when ? new Date(when).toUTCString() : '' },
    { name: 'Message-ID', value: m.internetMessageId || '' },
  ];
  return {
    id: m.id,
    threadId: m.conversationId || m.id,
    labelIds,
    internalDate: when ? String(Date.parse(when)) : undefined,
    snippet: m.bodyPreview,
    payload: atts.length ? { mimeType: 'multipart/mixed', headers, parts: [bodyPart, ...atts] } : { ...bodyPart, headers },
  };
}

/** What a Gmail-style search the sync uses asks of Graph. */
export function readQuery(query: string, now = Date.now()): { since: string; bin: boolean; inbox: boolean; unread: boolean; flagged: boolean } {
  const days = /\bnewer_than:(\d+)d\b/.exec(query)?.[1];
  return {
    since: days ? new Date(now - Number(days) * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z') : '',
    bin: searchesBin(query),
    inbox: /(^|\s)in:inbox\b/.test(query),
    unread: /(^|\s)is:unread\b/.test(query),
    flagged: /(^|\s)is:starred\b/.test(query),
  };
}

// Folder ids don't change; look them up once per account.
const folderCache = new Map<string, Promise<Folders>>();

export class OutlookMail implements GmailApi {
  constructor(private acct: StoredAccount) {}

  private get<T>(path: string, init: RequestInit = {}, o: GraphOpts = {}): Promise<T> {
    return graph<T>(this.acct, path, init, { fail: mailError, ...o });
  }

  folders(): Promise<Folders> {
    let p = folderCache.get(this.acct.id);
    if (!p) {
      // A failed lookup must not be cached as "no such folder" (every message would lose its INBOX label), so errors propagate.
      const one = (wk: string) => this.get<{ id: string }>('/me/mailFolders/' + wk + '?$select=id').then((x) => x.id);
      p = Promise.all(['inbox', 'sentitems', 'deleteditems', 'junkemail', 'drafts'].map(one)).then(([inbox, sentitems, deleteditems, junkemail, drafts]) => ({ inbox, sentitems, deleteditems, junkemail, drafts }));
      p.catch(() => folderCache.delete(this.acct.id));
      folderCache.set(this.acct.id, p);
    }
    return p;
  }

  async listMessages(query: string, max: number): Promise<{ id: string; threadId: string }[]> {
    const q = readQuery(query);
    const f = await this.folders();
    const page = '$top=' + Math.min(500, Math.max(1, max)) + '&$select=' + LIST_FIELDS;
    const since = q.since ? 'receivedDateTime ge ' + q.since : '';
    let rows: ListRow[];
    if (q.bin) {
      const inFolder = (wk: string) => graphAll<{ id: string; conversationId?: string }>(this.acct, '/me/mailFolders/' + wk + '/messages?' + page, max, { fail: mailError });
      rows = (await Promise.all([inFolder('deleteditems'), inFolder('junkemail')])).flat();
    } else {
      const filter = [since, q.unread ? 'isRead eq false' : '', q.flagged ? "flag/flagStatus eq 'flagged'" : ''].filter(Boolean).join(' and ');
      const base = (q.inbox ? '/me/mailFolders/inbox/messages?' : '/me/messages?') + page + (filter ? '&$filter=' + encodeURIComponent(filter) : '');
      // Like the Gmail search (-in:spam -in:trash), and drafts aren't mail yet. Filtered page by page, so `max`
      // rows that pass are returned: the label refresh relies on the newest `max` being complete.
      const out = new Set([f.deleteditems, f.junkemail, f.drafts].filter(Boolean));
      const keep = (m: ListRow) => !m.isDraft && !out.has(m.parentFolderId || '');
      // Newest first, like Gmail; Graph refuses some filter + sort combinations, so fall back to unsorted.
      rows = await this.listKept(base + '&$orderby=receivedDateTime%20desc', max, keep).catch((e) =>
        e instanceof GmailError && e.status === 400 ? this.listKept(base, max, keep) : Promise.reject(e),
      );
    }
    return rows.slice(0, max).map((m) => ({ id: m.id, threadId: m.conversationId || m.id }));
  }

  /** Pages through a listing until `max` rows pass `keep` (or the listing ends). */
  private async listKept<T>(path: string, max: number, keep: (row: T) => boolean): Promise<T[]> {
    const rows: T[] = [];
    let next: string | undefined = path;
    while (next && rows.length < max) {
      const pageOf: Page<T> = await this.get<Page<T>>(next);
      rows.push(...(pageOf.value || []).filter(keep));
      next = pageOf['@odata.nextLink'];
    }
    return rows.slice(0, max);
  }

  async listMessageIds(query: string, max: number): Promise<string[]> {
    return (await this.listMessages(query, max)).map((m) => m.id);
  }

  /** Every message of a conversation, sent and received, oldest first; drafts, deleted and junk left out. */
  async getThread(conversationId: string): Promise<GmailMessage[]> {
    const f = await this.folders();
    const path =
      '/me/messages?$top=100&$select=' + FULL_FIELDS + '&$expand=' + encodeURIComponent('attachments($select=id,name,size,isInline)') + '&$filter=' + encodeURIComponent('conversationId eq ' + odataString(conversationId));
    const msgs = await graphAll<GraphMessage>(this.acct, path, 500, { fail: mailError, ...TEXT });
    const out = new Set([f.deleteditems, f.junkemail, f.drafts].filter(Boolean));
    return msgs
      .filter((m) => !m.isDraft && !out.has(m.parentFolderId || ''))
      .sort((a, b) => (a.receivedDateTime || '').localeCompare(b.receivedDateTime || ''))
      .map((m) => toGmailMessage(m, f));
  }

  async getMessage(id: string, format: 'full' | 'minimal' = 'full'): Promise<GmailMessage> {
    const f = await this.folders();
    const m = await this.get<GraphMessage>('/me/messages/' + encodeURIComponent(id) + '?$select=' + (format === 'full' ? FULL_FIELDS : STATE_FIELDS), {}, TEXT);
    return toGmailMessage(m, f);
  }

  /** Read / unread, flag / unflag, and archive (out of the Inbox) for a whole conversation. */
  async modifyThread(conversationId: string, add: string[], remove: string[]): Promise<void> {
    const f = await this.folders();
    const msgs = await graphAll<GraphMessage>(
      this.acct,
      '/me/messages?$top=100&$select=' + STATE_FIELDS + '&$filter=' + encodeURIComponent('conversationId eq ' + odataString(conversationId)),
      500,
      { fail: mailError },
    );
    const patch: Record<string, unknown> = {};
    if (add.includes('UNREAD')) patch.isRead = false;
    if (remove.includes('UNREAD')) patch.isRead = true;
    if (add.includes('STARRED')) patch.flag = { flagStatus: 'flagged' };
    if (remove.includes('STARRED')) patch.flag = { flagStatus: 'notFlagged' };
    for (const m of msgs) {
      if (Object.keys(patch).length) await this.get('/me/messages/' + encodeURIComponent(m.id), { method: 'PATCH', body: JSON.stringify(patch) });
      if (remove.includes('INBOX') && m.parentFolderId === f.inbox) {
        await this.get('/me/messages/' + encodeURIComponent(m.id) + '/move', { method: 'POST', body: JSON.stringify({ destinationId: 'archive' }) });
      }
    }
  }

  /**
   * Send a raw RFC 2822 message. Graph takes MIME as base64 and threads replies by their
   * In-Reply-To / References headers. It returns no id; the next sync picks the sent copy up.
   */
  async send(raw: string): Promise<{ id: string }> {
    await this.get('/me/sendMail', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: Buffer.from(raw, 'base64url').toString('base64') });
    return { id: '' };
  }
}
