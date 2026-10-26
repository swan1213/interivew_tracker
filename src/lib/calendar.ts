import type { CalEvent } from '@/data/types';

/** A Google Calendar event whose title says it is an interview. */
export const looksLikeInterview = (title: string): boolean => /\b(interview|screen(ing)?|recruiter|hiring manager|onsite|on-site|technical|panel|final round)\b/i.test(title);

/** Events that are actually on the user's calendar. */
export const activeEvents = (evs: CalEvent[]): CalEvent[] => evs.filter((v) => v.added);

/** The first active event overlapping [s, e) on `date`, excluding `excl`. */
export function busyAt(active: CalEvent[], date: string, s: number, e: number, excl?: string | null): CalEvent | null {
  return active.find((v) => v.added !== false && v.id !== excl && v.date === date && s < v.end && v.start < e) || null;
}

/** An interview: one made in the app, or a synced calendar event whose title says it is one. */
export const isInterview = (v: CalEvent): boolean => v.kind === 'interview' || looksLikeInterview(v.co);

/** Every other active event that overlaps `v` where at least one side is an interview, earliest first. */
export function conflictsOf(v: CalEvent, active: CalEvent[]): CalEvent[] {
  if (!v.added) return [];
  return active
    .filter((o) => o.added && o.id !== v.id && o.date === v.date && v.start < o.end && o.start < v.end && (isInterview(v) || isInterview(o)))
    .sort((a, b) => a.start - b.start);
}

export function conflictOf(v: CalEvent, active: CalEvent[]): CalEvent | null {
  return conflictsOf(v, active)[0] || null;
}

export function conflictCount(active: CalEvent[]): number {
  return active.filter((x) => isInterview(x) && conflictOf(x, active)).length;
}

/** Each clashing pair once, in date and time order. */
export function conflictPairs(active: CalEvent[]): [CalEvent, CalEvent][] {
  const out: [CalEvent, CalEvent][] = [];
  const sorted = [...active].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  sorted.forEach((v, i) => {
    for (const o of conflictsOf(v, active)) if (sorted.indexOf(o) > i) out.push([v, o]);
  });
  return out;
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
