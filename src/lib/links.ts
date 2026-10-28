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

/** Booking pages where you pick a time yourself (Calendly, Greenhouse or Ashby self-scheduling, Zoom Scheduler, ...). */
const BOOKING = /calendly\.com|\bcal\.com\/|ashbyhq\.com\/meeting|greenhouse\.io\/(schedule|availability)|goodtime\.io|modernloop\.io|mloop\.in|paradox\.ai|scheduler\.zoom\.us|calendar\.app\.google|calendar\.google\.com\/calendar\/.*appointments|\/bookings?\/|meetings\.hubspot\.com|chilipiper\.com|savvycal\.com|zcal\.co|youcanbook\.me|doodle\.com|self-?schedul|schedul\w*[-/]?(link|request|interview)|\/schedule\//i;
/** One-way video interviews, recorded on your own time (Hireflix, Spark Hire, HireVue, ...). */
const VIDEO = /hireflix\.com|sparkhire\.com|hirevue\.com|willo\.video|myinterview\.com|vidcruiter\.com|interviewstream\.com|harver\.com/i;
/** Interviews held by an AI on your own time (micro1, ...). */
const AI = /micro1\.ai|apriora\.ai|ribbon\.ai|hireguide|alex\.com\/interview/i;

/** Wording that sends you to a booking page or button instead of asking you to reply with times. */
const BOOK_CUE = /\b(find a time|book a time|select a time|pick a time|choose (a|the) time|selecting time slots|time slots? (here|below)|enter your availability|use (our|my|the) (scheduler|scheduling (link|tool)|calendly|calendar link|booking link)|scheduling link|booking link|self-?schedul\w*|click (on )?(this|the) link (below )?and (choose|select|pick)|scheduled with goodtime|schedul\w*[^.\n]{0,60}\bclick(ing)? (on )?(the|this) (button|link)|(use|click) (on )?(the following|this|the) (link|button)[^.\n]{0,30}\bschedul\w*)\b/i;
/** Wording for an interview you take yourself: with an AI, or recorded on video. */
const AI_CUE = /\b(ai(-led| led|-driven| driven)? (interview|screening)|ai interviewer|conversational ai interview|start your (ai )?interview|take the ai interview)\b/i;
const VIDEO_CUE = /\b(one-way (video )?interview|(recorded|asynchronous|async) (video )?interview|record (your )?(video|answers|responses))\b/i;

export type SelfServe = { kind: 'book' | 'video' | 'ai'; url?: string };

/**
 * The link an email gives for scheduling yourself, recording a video interview or taking an AI interview.
 * Unsubscribe links never count.
 */
export function bookingLink(text: string): { kind: SelfServe['kind']; url: string } | null {
  for (const m of text.matchAll(URL_RE)) {
    if (/unsubscribe|preferences/i.test(m[2])) continue;
    if (VIDEO.test(m[2])) return { kind: 'video', url: m[2] };
    if (AI.test(m[2])) return { kind: 'ai', url: m[2] };
    if (BOOKING.test(m[2])) return { kind: 'book', url: m[2] };
  }
  return null;
}

/**
 * Whether an email has you book a time or take an interview yourself (a link or a button), rather than reply
 * with your availability. The link comes along when the text has it; a button in the HTML may not show there.
 */
export function selfServe(text: string): SelfServe | null {
  const link = bookingLink(text);
  if (link) return link;
  if (AI_CUE.test(text)) return { kind: 'ai' };
  if (VIDEO_CUE.test(text)) return { kind: 'video' };
  if (BOOK_CUE.test(text)) return { kind: 'book' };
  return null;
}
