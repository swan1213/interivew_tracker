/**
 * In-process stand-in for Google, enabled with GOOGLE_MOCK=1.
 * OAuth "succeeds" immediately and Gmail serves the demo mailbox in real
 * Gmail API message format, so the full sync → classify → UI path runs
 * without credentials.
 */
import { buildDemoData, DEMO_TODAY } from '../../../src/data/demo';
import { b64url } from '../crypto';
import type { GmailMessage, GmailPart } from '../mime';
import { GmailError, searchesBin, type GmailApi } from './gmail';
import type { TokenSet, UserInfo } from './oauth';

export const MOCK_USER: UserInfo = { email: 'jordan.lee@gmail.example', name: 'Jordan Lee' };

export function mockTokens(): TokenSet {
  return { access_token: 'mock-access-' + Date.now(), refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'mock' };
}

/** The demo inbox as Gmail API resources, timestamped relative to `now`. */
export function demoAsGmail(now: Date = new Date()): GmailMessage[] {
  const d = buildDemoData();
  const demoNow = new Date(DEMO_TODAY + 'T09:12:00');
  const shift = now.getTime() - demoNow.getTime();
  const msgs: GmailMessage[] = [];
  d.emails.forEach((e) => {
    const headAt = new Date(demoNow.getTime() - e.ago * 60000 + shift);
    e.thread.forEach((m, i) => {
      const last = i === e.thread.length - 1;
      const at = last ? headAt : new Date(headAt.getTime() - (e.thread.length - i) * 5 * 86400000);
      const parts: GmailPart[] = [{ mimeType: 'text/plain', body: { data: b64url(m.body), size: m.body.length } }];
      (m.atts || []).forEach((a) => parts.push({ mimeType: 'application/pdf', filename: a.name, body: { attachmentId: 'att-' + a.name, size: parseInt(a.size, 10) * 1024 } }));
      const labels = ['INBOX'];
      if (last && e.unread) labels.push('UNREAD');
      if (last && e.starred) labels.push('STARRED');
      msgs.push({
        id: 'm-' + e.id + (last ? '' : '-' + i),
        threadId: 't-' + e.id,
        labelIds: labels,
        internalDate: String(at.getTime()),
        snippet: m.body.slice(0, 80),
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: m.from + ' <' + m.addr + '>' },
            { name: 'To', value: 'Jordan Lee <' + MOCK_USER.email + '>' },
            { name: 'Subject', value: (last && e.thread.length > 1 && !/^re:/i.test(e.subject) ? 'Re: ' : '') + e.subject },
            { name: 'Date', value: at.toUTCString() },
            { name: 'Message-ID', value: '<' + e.id + '-' + i + '@mock.example>' },
          ],
          parts,
        },
      });
    });
  });
  return msgs;
}

export class MockGmail implements GmailApi {
  private static instances = new Map<string, MockGmail>();
  static for(accountId: string): MockGmail {
    let m = MockGmail.instances.get(accountId);
    if (!m) {
      m = new MockGmail();
      MockGmail.instances.set(accountId, m);
    }
    return m;
  }

  readonly messages = new Map<string, GmailMessage>();
  readonly sent: { raw: string; threadId?: string }[] = [];
  /** Clock for sent messages; tests override it to stay on the fixture's timeline. */
  now: () => number = () => Date.now();

  constructor() {
    demoAsGmail().forEach((m) => this.messages.set(m.id, m));
  }

  async listMessageIds(query: string, max: number): Promise<string[]> {
    return (await this.listMessages(query, max)).map((m) => m.id);
  }

  async getThread(threadId: string): Promise<GmailMessage[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => parseInt(a.internalDate || '0', 10) - parseInt(b.internalDate || '0', 10));
  }

  /**
   * Understands the label searches sync uses (is:unread, is:starred, in:inbox) and the Trash/Spam search;
   * other terms match everything. Like Gmail, Trash and Spam are left out unless searched for.
   */
  async listMessages(query: string, max: number): Promise<{ id: string; threadId: string }[]> {
    const need = [['is:unread', 'UNREAD'], ['is:starred', 'STARRED'], ['in:inbox', 'INBOX']].filter(([q]) => query.split(' ').includes(q)).map(([, l]) => l);
    const bin = searchesBin(query);
    const inBin = (m: GmailMessage) => (m.labelIds || []).some((l) => l === 'TRASH' || l === 'SPAM');
    return Array.from(this.messages.values())
      .filter((m) => need.every((l) => (m.labelIds || []).includes(l)) && inBin(m) === bin)
      .sort((a, b) => parseInt(b.internalDate || '0', 10) - parseInt(a.internalDate || '0', 10))
      .slice(0, max)
      .map((m) => ({ id: m.id, threadId: m.threadId }));
  }

  async getMessage(id: string): Promise<GmailMessage> {
    const m = this.messages.get(id);
    if (!m) throw new GmailError(404, 'mock: no message ' + id);
    return m;
  }

  async modifyThread(threadId: string, add: string[], remove: string[]): Promise<void> {
    for (const m of this.messages.values()) {
      if (m.threadId !== threadId) continue;
      const set = new Set(m.labelIds || []);
      add.forEach((l) => set.add(l));
      remove.forEach((l) => set.delete(l));
      m.labelIds = Array.from(set);
    }
  }

  async send(raw: string, threadId?: string): Promise<{ id: string }> {
    this.sent.push({ raw, threadId });
    const id = 'sent-' + this.sent.length;
    if (threadId) {
      // Make the reply visible in the thread on the next sync, like Gmail does.
      const text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const subject = /^Subject: (.*)$/m.exec(text)?.[1] || '';
      const body = text.split('\r\n\r\n').slice(1).join('\r\n\r\n');
      const decoded = /Content-Transfer-Encoding: base64/i.test(text) ? Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') : body;
      this.messages.set(id, {
        id,
        threadId,
        labelIds: ['SENT'],
        internalDate: String(this.now()),
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: MOCK_USER.name + ' <' + MOCK_USER.email + '>' },
            { name: 'Subject', value: subject },
            { name: 'Message-ID', value: '<' + id + '@mock.example>' },
          ],
          body: { data: b64url(decoded), size: decoded.length },
        },
      });
    }
    return { id };
  }
}
