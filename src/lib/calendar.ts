import type { Application, CalEvent, StageKey } from '@/data/types';
import { appliedDay } from './mail';
import { addD, fmtT, lab } from './time';

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

/** Meetings with other people that are not part of a hiring process. */
const NOT_INTERVIEW = /\b(info session|webinar|test call|office hours|workshop|class|lesson|birthday|holiday|dentist|doctor)\b/i;

/**
 * A meeting that counts toward interviews scheduled: an interview by kind or title, or, on a
 * job-search calendar, any meeting with someone else (recruiter calls are often titled
 * "Joshua Shin and Jane Doe"). `own` lists the user's addresses, so being a guest yourself doesn't count.
 */
export function isInterviewMeeting(v: CalEvent, own: string[] = []): boolean {
  if (isInterview(v)) return true;
  if (NOT_INTERVIEW.test(v.co)) return false;
  const mine = new Set(own.map((a) => a.toLowerCase()));
  return !!v.organizer || (v.attendees || []).some((g) => !mine.has(g.toLowerCase()));
}

/**
 * Words that say nothing about which company a meeting is with. A company name made only of these
 * (mail parsing sometimes yields "Chat", "Inc" or "Greenhouse") never matches a meeting.
 */
const GENERIC = new Set(
  ('inc llc ltd corp gmbh the and with for chat call meeting interview interviews hiring team talent recruiting recruiter careers jobs job ' +
    'app apps schedule scheduling calendar greenhouse lever ashby workday calendly gem zoom teams google gmail outlook video phone screen ' +
    'intro sync engineer engineering software manager senior candidate virtual round new invite people global find').split(' '),
);

/** Words of a company name to look for in a meeting ("rebuy" for "Rebuy, Inc."). */
const coWords = (co: string): string[] =>
  co
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

/** An organizer that is a company's shared calendar ("StreamNative Interviewer Calendar"), not a person. */
const ORG_CALENDAR = /\b(calendar|interviews?|interviewer|recruiting|talent|careers|jobs|hiring|scheduling)\b/i;

const wordsOf = (s: string): string => ' ' + s.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';

/**
 * How well a meeting points at a company, 0 when it doesn't: every word of the name as a whole word in
 * the title or the organizer's name, or inside an organizer or guest email domain ("artemissecurity.com"
 * for Artemis). A domain match counts most; longer names beat shorter ones.
 */
export function meetingScore(v: CalEvent, company: string): number {
  const words = coWords(company);
  if (!words.length) return 0;
  const people = [v.organizer || '', ...(v.attendees || [])];
  // A person's name is not a company ("Evan Hanna" is a MillerKnoll recruiter); a shared calendar's name is.
  const calendars = people.filter((p) => !p.includes('@') && ORG_CALENDAR.test(p));
  const title = wordsOf(v.co + ' ' + calendars.join(' '));
  const domains = people.map((p) => p.split('@')[1] || '').join(' ').toLowerCase();
  const inTitle = words.every((w) => title.includes(' ' + w + ' '));
  // Inside a domain only longer words count: "alt" turns up in too many unrelated domains.
  const inDomain = !!domains && words.every((w) => w.length >= 4 && domains.includes(w));
  if (!inTitle && !inDomain) return 0;
  return (inDomain ? 2 : 0) + (inTitle ? 1 : 0) + words.join('').length / 100;
}

/** The calendar meeting is with the company (see meetingScore). */
export const meetingMentions = (v: CalEvent, company: string): boolean => meetingScore(v, company) > 0;

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

/** Stage keys from before First / Technical / Next Step Interview replaced the five interview columns. */
const OLD_STAGE: Record<string, StageKey> = { screen: 'first', sched: 'first', confirmed: 'first', final: 'next' };

/** A meeting title for a technical round. */
export const isTechnical = (title: string): boolean => /\b(technical|tech screen|coding|system design|pair programming|take[- ]home|assessment)\b/i.test(title);

/** Stages the calendar never overrides: the outcome is known. */
const SETTLED: StageKey[] = ['offer', 'hired', 'closed'];

/**
 * Tracker stages from the calendar: when the company's latest meeting (past or booked) is a technical
 * round it is at Technical Interview; otherwise meetings on one day are First Interview, on two or more
 * days Next Step Interview. Each meeting belongs to the one company it matches best, and only from a few
 * days before the company's first email. Cards you moved yourself, and
 * offers, hires and rejections, keep their stage. `next` shows the upcoming meeting when there is one,
 * `meetings` and `meetingIds` list the meetings. A meeting that matches no application still gets a
 * card of its own (`fromCal`), named after the organizer's company, so every interview is on the board.
 */
export function meetingStages(apps: Application[], events: CalEvent[], own: string[], today: string): Application[] {
  const meetings = events.filter((v) => v.added && isInterviewMeeting(v, own)).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const byApp = new Map<string, CalEvent[]>();
  const loose = new Map<string, { name: string; evs: CalEvent[] }>();
  const add = <T,>(m: Map<string, T[]>, k: string, v: T) => (m.get(k) || m.set(k, []).get(k)!).push(v);
  // A meeting well before the company's first email is about something else.
  const since = new Map(apps.map((a) => [a.id, addD(appliedDay(a.applied, today) || '0000-01-01', -3)]));
  for (const v of meetings) {
    let best: Application | undefined;
    let top = 0;
    for (const a of apps) {
      const s = a.emailId && v.emailId === a.emailId ? 10 : v.date < since.get(a.id)! ? 0 : meetingScore(v, a.co);
      if (s > top) [best, top] = [a, s];
    }
    if (best) add(byApp, best.id, v);
    else {
      const who = meetingCompany(v, own);
      const g = loose.get(who.key) || loose.set(who.key, { name: who.name, evs: [] }).get(who.key)!;
      g.evs.push(v);
    }
  }
  const staged = (a: Application, mine: CalEvent[]): Application => {
    const stage = OLD_STAGE[a.stage] || a.stage;
    const found = mine.length ? { meetings: mine.map((v) => v.date), meetingIds: mine.map((v) => v.id) } : {};
    if (a.locked || SETTLED.includes(stage)) return stage === a.stage && !mine.length ? a : { ...a, stage, ...found };
    if (!mine.length) return stage === 'first' || stage === 'tech' || stage === 'next' ? { ...a, stage: 'review' } : a;
    const up = mine.find((v) => v.date >= today);
    // Rounds are counted by day: two entries on one day are usually the same interview twice.
    const rounds = new Set(mine.map((v) => v.date)).size;
    return { ...a, ...found, stage: isTechnical(mine[mine.length - 1].co) ? 'tech' : rounds > 1 ? 'next' : 'first', next: up ? lab(up.date) + ', ' + fmtT(up.start) + ' ET' : a.next };
  };
  const fromCal = [...loose].map(([key, { name, evs }]): Application => {
    const first = evs[0];
    const last = evs[evs.length - 1];
    return staged(
      {
        id: 'cal-' + key, co: name, role: first.co.trim(), stage: 'review', applied: lab(first.date).replace(/^\w+, /, ''), acct: first.acct || '', pri: 'normal', next: '',
        activity: 'Meeting on your calendar, ' + lab(last.date), action: 'None', emailId: '', notes: '', locked: false, ai: null, fromCal: true,
        timeline: [...evs].reverse().map((v) => ({ text: v.co.trim(), when: lab(v.date) + ', ' + fmtT(v.start) + ' ET', src: 'Calendar', cls: 'cat-confirmed' })),
      },
      evs,
    );
  });
  return [...apps.map((a) => staged(a, byApp.get(a.id) || [])), ...fromCal];
}

/** Mail and scheduling services: their domain says nothing about the employer. */
const SERVICE_DOMAIN = /(^|\.)(gmail|googlemail|google|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail|calendly|zoom|greenhouse|ashbyhq|lever|gem|goodtime|paradox|myworkday|workday|smartrecruiters|icims|jobvite|teams|microsoft|calendar|linkedin)\./i;

/** Who a meeting is with, for a card of its own: the organizer's or a guest's company domain, else its title. */
export function meetingCompany(v: CalEvent, own: string[]): { key: string; name: string } {
  const mine = new Set(own.map((a) => a.toLowerCase()));
  const domain = [v.organizer || '', ...(v.attendees || [])]
    .filter((p) => p.includes('@') && !mine.has(p.toLowerCase()))
    .map((p) => p.split('@')[1].toLowerCase())
    .find((d) => !SERVICE_DOMAIN.test(d + '.'));
  const named = titleCompany(v.co);
  let name = named.name;
  if (domain && !named.sure) {
    const parts = domain.split('.');
    const base = parts.length > 2 && /^(co|com|org|net|ac)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
    name = base.charAt(0).toUpperCase() + base.slice(1);
  }
  return { key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name };
}

const ROLEISH = /\b(interview|engineer|developer|manager|senior|sr|staff|lead|principal|architect|screen|call|chat|meeting|round|role|contract|remote|joshua|shin)\b/i;
const short = (s: string) => {
  const t = s.trim().replace(/[!.:,]+$/, '');
  return t && t.split(/\s+/).length <= 4 && !ROLEISH.test(t) ? t : '';
};

/**
 * The company named in a meeting title: "Interview with X", "X | Interview", "Interview | X",
 * "Interview – X" or "… at X" (`sure`). Otherwise the title without your name.
 */
export function titleCompany(title: string): { name: string; sure: boolean } {
  const t = title.replace(/​/g, '').trim();
  const withX = t.match(/\b(?:with|at)\s+([A-Z][\w&.'’ -]*?)(?=\s*(?:[|:(@,–]|\s-\s|!|$))/);
  const segs = t.split(/\s*[|–]\s*|\s+-\s+/);
  const name = (withX && short(withX[1])) || short(segs[0]) || short(segs[segs.length - 1]);
  if (name) return { name, sure: true };
  const rest = t
    // Your name goes, with the "and" / "+" / "/" joining it to the other person.
    .replace(/(\s(and|&|\+|\/)\s*)?\bJoshua(\s+S(hin)?)?\b(\s*(and|&|\+|\/)\s)?/gi, ' ')
    .replace(/\s*[-–|:,/+]\s*(?=[-–|:,/+]|$)/g, '')
    .replace(/^[\s\-–|:,/+]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { name: rest || t, sure: false };
}
