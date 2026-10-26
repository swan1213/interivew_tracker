import { fromB64url } from './crypto';
import type { Attachment, ParsedMessage } from './types';

/** Subset of the Gmail API message resource we rely on. */
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
  snippet?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Very small HTML → text conversion good enough for recruiter mail. */
export function stripHtml(html: string): string {
  let s = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n').replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function humanSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function parseAddress(v: string): { name: string; addr: string } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), addr: m[2].trim().toLowerCase() };
  const addr = v.trim().replace(/^<|>$/g, '').toLowerCase();
  return { name: addr.split('@')[0] || addr, addr };
}

function header(p: GmailPart | undefined, name: string): string {
  const h = p?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function walk(p: GmailPart | undefined, out: { plain: string[]; html: string[]; atts: Attachment[] }): void {
  if (!p) return;
  const mt = (p.mimeType || '').toLowerCase();
  if (p.filename && p.body?.attachmentId) {
    out.atts.push({ name: p.filename, size: humanSize(p.body.size) });
  } else if (mt === 'text/plain' && p.body?.data) {
    out.plain.push(fromB64url(p.body.data).toString('utf8'));
  } else if (mt === 'text/html' && p.body?.data) {
    out.html.push(fromB64url(p.body.data).toString('utf8'));
  }
  (p.parts || []).forEach((c) => walk(c, out));
}

/** Longest body kept: enough for any real message, while newsletters with huge bodies cannot bloat storage. */
const BODY_MAX = 40_000;
const capBody = (b: string): string => (b.length > BODY_MAX ? b.slice(0, BODY_MAX) + '\n\n[Message shortened. Open it in Gmail to read the rest.]' : b);

/** Turn a Gmail API message into the flat shape the classifier and UI use. */
export function parseMessage(m: GmailMessage, myEmail: string): ParsedMessage {
  const p = m.payload;
  const from = parseAddress(header(p, 'From'));
  const out = { plain: [] as string[], html: [] as string[], atts: [] as Attachment[] };
  walk(p, out);
  let body = out.plain.join('\n').trim();
  if (!body && out.html.length) body = stripHtml(out.html.join('\n'));
  if (!body) body = m.snippet || '';
  const dateMs = m.internalDate ? parseInt(m.internalDate, 10) : Date.parse(header(p, 'Date')) || Date.now();
  const labelIds = m.labelIds || [];
  return {
    id: m.id,
    threadId: m.threadId,
    fromName: from.name,
    fromAddr: from.addr,
    to: header(p, 'To'),
    subject: header(p, 'Subject') || '(no subject)',
    date: new Date(dateMs).toISOString(),
    bodyText: capBody(body.replace(/\r\n/g, '\n')),
    atts: out.atts,
    labelIds,
    messageId: header(p, 'Message-ID') || header(p, 'Message-Id'),
    inReplyTo: header(p, 'In-Reply-To'),
    references: header(p, 'References'),
    isMine: labelIds.includes('SENT') || (!!myEmail && from.addr === myEmail.toLowerCase()),
  };
}

/** Strip quoted replies ("On … wrote:" and "> " lines) so classification sees only the new text. */
export function stripQuoted(body: string): string {
  const lines = body.split('\n');
  const cut = lines.findIndex((l) => /^On .{5,120} wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()) || /^From: .+$/.test(l.trim()) && lines.length > 10);
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith('>'));
  return kept.join('\n').trim();
}
