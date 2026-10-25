import type { TimeHit } from './types';

const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** Hours to add to a time expressed in `zone` to get Eastern time (the app's base zone). */
export function zoneToEt(zone?: string): number {
  const z = (zone || 'ET').toUpperCase();
  const map: Record<string, number> = { ET: 0, EST: 0, EDT: 0, CT: 1, CST: 1, CDT: 1, MT: 2, MST: 2, MDT: 2, PT: 3, PST: 3, PDT: 3, UTC: -4, GMT: -4 };
  return map[z] ?? 0;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return isoLocal(dt);
}

export function dowOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** "Mon, Oct 26" */
export function lab(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return DN[dt.getDay()] + ', ' + MN[dt.getMonth()] + ' ' + dt.getDate();
}

export function fmtT(h: number): string {
  let H = Math.floor(h + 1e-9);
  let m = Math.round((h - H) * 60);
  if (m === 60) { H += 1; m = 0; }
  const hh = ((H % 24) + 24) % 24;
  const ap = hh >= 12 ? 'PM' : 'AM';
  let x = hh % 12;
  if (x === 0) x = 12;
  return x + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
}

export const agoMinutes = (iso: string, now: Date): number => Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));

/** Compact time label like the inbox list: "8:34 AM", "Sun", "Oct 24", "Oct 24, 2025". */
export function timeLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (isoLocal(d) === isoLocal(now)) return fmtT(d.getHours() + d.getMinutes() / 60);
  const days = Math.round((now.getTime() - d.getTime()) / 86400000);
  if (days < 7 && days >= 0) return DN[d.getDay()];
  const base = MN[d.getMonth()] + ' ' + d.getDate();
  return d.getFullYear() === now.getFullYear() ? base : base + ', ' + d.getFullYear();
}

/** "38 min ago", "3h ago", "Yesterday", "Oct 24" */
export function relLabel(iso: string, now: Date): string {
  const mins = agoMinutes(iso, now);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + ' min ago';
  if (mins < 24 * 60 && isoLocal(new Date(iso)) === isoLocal(now)) return Math.floor(mins / 60) + 'h ago';
  if (isoLocal(new Date(iso)) === addDays(isoLocal(now), -1)) return 'Yesterday';
  return timeLabel(iso, now);
}

/** "Wed, Oct 21 · 4:15 PM" for a thread message header. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  return lab(isoLocal(d)) + ' · ' + fmtT(d.getHours() + d.getMinutes() / 60);
}

export function nextBusinessDays(fromIso: string, n: number): string[] {
  const out: string[] = [];
  let d = fromIso;
  while (out.length < n) {
    d = addDays(d, 1);
    const w = dowOf(d);
    if (w !== 0 && w !== 6) out.push(d);
  }
  return out;
}

/** Business days from a to b inclusive. */
export function businessDaysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let d = a;
  for (let i = 0; i < 31 && d <= b; i++) {
    const w = dowOf(d);
    if (w !== 0 && w !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

const DATE_RE = /\b(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b|\b(today|tomorrow)\b|\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/gi;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*(?:to|-|–|—|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.))?(?:\s*(ET|EST|EDT|PT|PST|PDT|CT|CST|CDT|MT|MST|MDT|UTC|GMT))?\b/gi;
const DEADLINE_CUE = /\b(by|before|no later than|due|deadline|until|submit(?:ted)? by|return(?:ed)? by)\b/i;
const ORIGINAL_CUE = /\b(move|reschedul\w*|original(?:ly)?|current(?:ly)?|instead of|was (?:set|scheduled)|previously)\b/i;

interface DateTok { iso: string; index: number; raw: string }
interface TimeTok { start: number; end?: number; zone?: string; index: number; raw: string }

function resolveDate(m: RegExpExecArray, ref: Date): string | null {
  const refIso = isoLocal(ref);
  if (m[5]) return m[5].toLowerCase() === 'today' ? refIso : addDays(refIso, 1);
  let y: number;
  let mo: number;
  let d: number;
  if (m[2]) {
    mo = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    d = parseInt(m[3], 10);
    y = m[4] ? parseInt(m[4], 10) : ref.getFullYear();
  } else {
    mo = parseInt(m[6], 10) - 1;
    d = parseInt(m[7], 10);
    y = m[8] ? (m[8].length === 2 ? 2000 + parseInt(m[8], 10) : parseInt(m[8], 10)) : ref.getFullYear();
    if (mo < 0 || mo > 11) return null;
  }
  if (d < 1 || d > 31) return null;
  let iso = isoLocal(new Date(y, mo, d));
  // A month/day with no year that is well in the past most likely means next year.
  if (!m[4] && !m[8] && iso < addDays(refIso, -45)) iso = isoLocal(new Date(y + 1, mo, d));
  return iso;
}

function toHours(h: string, mm: string | undefined, mer: string | undefined): number | null {
  let H = parseInt(h, 10);
  const M = mm ? parseInt(mm, 10) : 0;
  if (H > 23 || M > 59) return null;
  const ap = mer ? mer.replace(/\./g, '').toLowerCase() : '';
  if (ap === 'pm' && H < 12) H += 12;
  if (ap === 'am' && H === 12) H = 0;
  return H + M / 60;
}

function timesIn(line: string): TimeTok[] {
  const out: TimeTok[] = [];
  TIME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIME_RE.exec(line))) {
    const mer1 = m[3];
    const mer2 = m[6];
    if (!mer1 && !mer2) continue; // a bare number is not a time
    const start = toHours(m[1], m[2], mer1 || mer2);
    if (start === null) continue;
    let end: number | undefined;
    if (m[4]) {
      const e = toHours(m[4], m[5], mer2 || mer1);
      if (e !== null) end = e;
    }
    out.push({ start, end, zone: m[7] ? m[7].toUpperCase() : undefined, index: m.index, raw: m[0] });
  }
  return out;
}

function datesIn(line: string, ref: Date): DateTok[] {
  const out: DateTok[] = [];
  DATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DATE_RE.exec(line))) {
    const iso = resolveDate(m, ref);
    if (iso) out.push({ iso, index: m.index, raw: m[0] });
  }
  return out;
}

function hitLabel(h: { date: string; start?: number; end?: number; zone?: string }): string {
  let s = lab(h.date);
  if (h.start !== undefined) s += ' · ' + fmtT(h.start) + (h.end !== undefined ? '–' + fmtT(h.end) : '');
  if (h.zone) s += ' ' + h.zone;
  return s;
}

/**
 * Find concrete dates and times in a message. Dates and times on the same line are
 * paired; a time on a line right after a date line (e.g. "Date: …\nTime: …") is paired
 * with that date. Times preceded by a deadline cue become 'deadline' hits; times on a
 * line that talks about moving or an original slot become 'original' hits.
 */
export function extractDateTimes(text: string, ref: Date): TimeHit[] {
  const hits: TimeHit[] = [];
  const lines = text.split(/\r?\n/);
  let pending: { iso: string; line: number } | null = null;
  lines.forEach((line, i) => {
    const dates = datesIn(line, ref);
    const times = timesIn(line);
    const kindFor = (idx: number): TimeHit['kind'] => {
      const before = line.slice(Math.max(0, idx - 40), idx);
      if (DEADLINE_CUE.test(before)) return 'deadline';
      if (ORIGINAL_CUE.test(line.slice(0, idx))) return 'original';
      return 'meeting';
    };
    if (dates.length && times.length) {
      const used = new Set<number>();
      times.forEach((t) => {
        const date = dates.filter((d) => d.index <= t.index).pop() || dates[0];
        used.add(date.index);
        const h = { date: date.iso, start: t.start, end: t.end, zone: t.zone };
        hits.push({ ...h, label: hitLabel(h), kind: kindFor(t.index) });
      });
      // Dates on the same line that no time refers to (e.g. a signing deadline after a call time).
      dates
        .filter((d) => !used.has(d.index))
        .forEach((d) => {
          const before = line.slice(Math.max(0, d.index - 40), d.index);
          hits.push({ date: d.iso, label: hitLabel({ date: d.iso }), kind: DEADLINE_CUE.test(before) ? 'deadline' : 'meeting' });
        });
    } else if (dates.length) {
      dates.forEach((d) => {
        const before = line.slice(Math.max(0, d.index - 40), d.index);
        hits.push({ date: d.iso, label: hitLabel({ date: d.iso }), kind: DEADLINE_CUE.test(before) ? 'deadline' : 'meeting' });
      });
      pending = { iso: dates[dates.length - 1].iso, line: i };
      return;
    } else if (times.length && pending && i - pending.line <= 2) {
      const date = pending.iso;
      times.forEach((t) => {
        const h = { date, start: t.start, end: t.end, zone: t.zone };
        hits.push({ ...h, label: hitLabel(h), kind: kindFor(t.index) });
      });
      // Replace the date-only hit with the paired one.
      const idx = hits.findIndex((x) => x.date === date && x.start === undefined);
      if (idx >= 0) hits.splice(idx, 1);
    }
    if (dates.length) pending = { iso: dates[dates.length - 1].iso, line: i };
  });
  // De-duplicate identical hits.
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = h.date + '|' + h.start + '|' + h.end + '|' + h.kind;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
