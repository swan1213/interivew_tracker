/** A run of message text: plain words, or a link with a short label. */
export type Part = { text: string } | { url: string; label: string };

// A web address, optionally wrapped the way newsletters print them in plain text: "[ https://… ]".
// Trailing punctuation belongs to the sentence, not the link.
const URL_RE = /(\[\s*)?\b(https?:\/\/[^\s<>()[\]"']*[^\s<>()[\]"'.,;:!?])(\s*\])?/g;

/** What a link shows: host and path when short, else just the host ("substack.com"). */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const full = host + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
    return full.length <= 32 && !u.search ? full : host;
  } catch {
    return url;
  }
}

/** Split message text into plain runs and links, so links can be shown as tidy, clickable tags. */
export function linkParts(text: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    // A bracket only counts as wrapping when both sides are there.
    const wrapped = !!m[1] && !!m[3];
    const start = wrapped ? i : i + (m[1]?.length || 0);
    const end = wrapped ? i + m[0].length : i + (m[1]?.length || 0) + m[2].length;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ url: m[2], label: linkLabel(m[2]) });
    last = end;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
