import type { Tz } from '@/data/types';
import { DN, MN } from '@/data/constants';

/** Hour offset to apply to stored ET hours for display in the given zone. */
export function tzOffset(tz: Tz): number {
  return { ET: 0, PT: -3, UTC: 4 }[tz] ?? 0;
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
