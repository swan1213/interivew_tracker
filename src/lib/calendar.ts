import type { CalEvent } from '@/data/types';

/** Events that are actually on the user's calendar. */
export const activeEvents = (evs: CalEvent[]): CalEvent[] => evs.filter((v) => v.added);

/** The first active event overlapping [s, e) on `date`, excluding `excl`. */
export function busyAt(active: CalEvent[], date: string, s: number, e: number, excl?: string | null): CalEvent | null {
  return active.find((v) => v.added !== false && v.id !== excl && v.date === date && s < v.end && v.start < e) || null;
}

/** Another active event that overlaps `v` where at least one side is an interview. */
export function conflictOf(v: CalEvent, active: CalEvent[]): CalEvent | null {
  if (!v.added) return null;
  return (
    active.find(
      (o) => o.added && o.id !== v.id && o.date === v.date && v.start < o.end && o.start < v.end && (v.kind === 'interview' || o.kind === 'interview'),
    ) || null
  );
}

export function conflictCount(active: CalEvent[]): number {
  return active.filter((x) => x.kind === 'interview' && conflictOf(x, active)).length;
}
