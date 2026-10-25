import type { CalEvent } from '@/data/types';

/** A Google Calendar event whose title says it is an interview. */
export const looksLikeInterview = (title: string): boolean => /\b(interview|screen(ing)?|recruiter|hiring manager|onsite|on-site|technical|panel|final round)\b/i.test(title);

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

export interface Lane {
  /** Column this event sits in, from 0. */
  lane: number;
  /** Columns its overlapping group is split into. */
  lanes: number;
}

/**
 * Side-by-side columns for one day's events so overlapping ones don't hide each
 * other. Events that overlap, directly or through a chain, form a group that
 * shares the width; each takes the leftmost column that is free at its start.
 * `minDur` is the shortest an event is drawn (hours), so short events that look
 * overlapping on screen get columns too.
 */
export function layoutLanes(evs: CalEvent[], minDur = 0): Map<string, Lane> {
  const out = new Map<string, Lane>();
  const sorted = [...evs].sort((a, b) => a.start - b.start || b.end - a.end);
  const endOf = (v: CalEvent) => Math.max(v.end, v.start + minDur);
  let group: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    group.forEach((g) => out.set(g.id, { lane: g.lane, lanes: laneEnds.length }));
    group = [];
    laneEnds = [];
  };
  for (const v of sorted) {
    if (v.start >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= v.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = endOf(v);
    group.push({ id: v.id, lane });
    groupEnd = Math.max(groupEnd, endOf(v));
  }
  close();
  return out;
}
