import type { Tz } from '@/data/types';
import { DN, MN } from '@/data/constants';

/** The display zones offered in Settings and on the Calendar, with the IANA zone that defines each. */
export const TIME_ZONES: { k: Tz; l: string; short: string; zone: string }[] = [
  { k: 'ET', l: 'Eastern Time (ET)', short: 'Eastern (ET)', zone: 'America/New_York' },
  { k: 'AST', l: 'Atlantic Time (AST)', short: 'Atlantic (AST)', zone: 'America/Halifax' },
  { k: 'PT', l: 'Pacific Time (PT)', short: 'Pacific (PT)', zone: 'America/Los_Angeles' },
  { k: 'UTC', l: 'UTC', short: 'UTC', zone: 'UTC' },
];

/** Minutes `zone` is ahead of UTC at `at`. */
function utcOffsetMin(zone: string, at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)]),
  );
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at.getTime()) / 60000);
}

/**
 * Hour offset to apply to stored ET hours for display in the given zone, from the real
 * zone rules at `at`, so daylight saving changes (and zones that don't observe it) are right.
 */
export function tzOffset(tz: Tz, at: Date = new Date()): number {
  const zone = TIME_ZONES.find((z) => z.k === tz)?.zone;
  if (!zone || tz === 'ET') return 0;
  return (utcOffsetMin(zone, at) - utcOffsetMin('America/New_York', at)) / 60;
}

/** 13.5 → "1:30 PM" */
export function fmtT(h: number): string {
  let H = Math.floor(h + 1e-9);
  let m = Math.round((h - H) * 60);
  if (m === 60) { H += 1; m = 0; }
  const hh = ((H % 24) + 24) % 24;
  const ap = hh >= 12 ? 'PM' : 'AM';
  let x = hh % 12;
  if (x === 0) x = 12;
  return `${x}:${m < 10 ? '0' : ''}${m} ${ap}`;
}

/** 13 → "1 PM" */
export function hourLab(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const ap = hh >= 12 ? 'PM' : 'AM';
  let x = hh % 12;
  if (x === 0) x = 12;
  return `${x} ${ap}`;
}

export const dObj = (s: string): Date => new Date(s + 'T00:00:00Z');
export const iso = (d: Date): string => d.toISOString().slice(0, 10);

export function addD(s: string, n: number): string {
  const d = dObj(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** "2026-10-26" → "Mon, Oct 26" */
export function lab(s: string): string {
  const d = dObj(s);
  return `${DN[d.getUTCDay()]}, ${MN[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Today", "Tomorrow", or lab(). */
export function rel(s: string, today: string): string {
  if (s === today) return 'Today';
  if (s === addD(today, 1)) return 'Tomorrow';
  return lab(s);
}

export function mondayOf(s: string): string {
  const d = dObj(s);
  return addD(s, -((d.getUTCDay() + 6) % 7));
}

/** "10:30" → 10.5 */
export function hrs(str: string | undefined): number {
  const p = String(str || '0:0').split(':');
  return parseInt(p[0], 10) + (parseInt(p[1], 10) || 0) / 60;
}

export function slotLabel(date: string, start: number, off: number, tz: Tz): string {
  return `${lab(date)} at ${fmtT(start + off)} ${tz}`;
}

export function minutesLabel(v: { start: number; end: number }): string {
  return Math.round((v.end - v.start) * 60) + ' min';
}

export function durationWords(v: { start: number; end: number }): string {
  const mins = Math.round((v.end - v.start) * 60);
  if (mins === 60) return 'one hour';
  if (mins === 120) return 'two hours';
  if (mins % 60 === 0) return mins / 60 + ' hours';
  return mins + ' minutes';
}

export function daysBetween(a: string, b: string): number {
  return Math.round((dObj(a).getTime() - dObj(b).getTime()) / 86400000);
}
