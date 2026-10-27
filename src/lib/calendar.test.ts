import { describe, expect, it } from 'vitest';
import type { CalEvent } from '@/data/types';
import type { Application } from '@/data/types';
import { conflictPairs, conflictsOf, isInterviewMeeting, layoutLanes, meetingMentions, meetingStages } from './calendar';

const ev = (id: string, start: number, end: number): CalEvent => ({ id, kind: 'interview', co: id, role: '', stage: 'screen', date: '2026-10-27', start, end, added: true });
const lanes = (m: Map<string, { lane: number; lanes: number }>) => Object.fromEntries([...m].map(([id, l]) => [id, l.lane + '/' + l.lanes]));

describe('side-by-side lanes for overlapping events', () => {
  it('gives events at the same time their own columns', () => {
    expect(lanes(layoutLanes([ev('a', 10, 11), ev('b', 10, 11), ev('c', 10, 11)]))).toEqual({ a: '0/3', b: '1/3', c: '2/3' });
  });

  it('reuses a freed column and splits only the overlapping group', () => {
    const out = layoutLanes([ev('long', 9, 12), ev('x', 9.5, 10), ev('y', 10, 10.5), ev('later', 13, 14)]);
    expect(lanes(out)).toEqual({ long: '0/2', x: '1/2', y: '1/2', later: '0/1' });
  });

  it('treats short events by their drawn height', () => {
    expect(lanes(layoutLanes([ev('a', 10, 10.1), ev('b', 10.2, 10.5)]))).toEqual({ a: '0/1', b: '0/1' });
    expect(lanes(layoutLanes([ev('a', 10, 10.1), ev('b', 10.2, 10.5)], 0.5))).toEqual({ a: '0/2', b: '1/2' });
  });
});

describe('interview conflicts', () => {
  const busy = (id: string, co: string, start: number, end: number): CalEvent => ({ ...ev(id, start, end), kind: 'busy', co, stage: 'busy' });

  it('flags two synced Google Calendar interviews at the same time', () => {
    const a = busy('g1', 'Luma | Interview - Joshua Shin', 22, 22.5);
    const b = busy('g2', 'Acme technical interview', 22, 23);
    expect(conflictsOf(a, [a, b]).map((x) => x.id)).toEqual(['g2']);
    expect(conflictPairs([a, b]).map(([x, y]) => x.id + '+' + y.id)).toEqual(['g1+g2']);
  });

  it('ignores overlaps between ordinary commitments and events not on the calendar', () => {
    const lunch = busy('l', 'Lunch with Sam', 12, 13);
    const gym = busy('g', 'Gym', 12, 13);
    const pending = { ...ev('p', 12, 13), added: false };
    expect(conflictPairs([lunch, gym, pending])).toEqual([]);
  });

  it('lists every event an interview overlaps', () => {
    const iv = ev('iv', 10, 12);
    const out = conflictsOf(iv, [iv, busy('d', 'Dentist', 11, 12), busy('s', 'Recruiter screen', 10, 10.5)]);
    expect(out.map((x) => x.id)).toEqual(['s', 'd']);
  });
});

describe('meetings that count as interviews', () => {
  const busy = (co: string, more: Partial<CalEvent> = {}): CalEvent => ({ ...ev('b', 10, 11), kind: 'busy', stage: 'busy', co, ...more });
  const own = ['me@gmail.com'];

  it('counts recruiter calls with someone else, whatever the title', () => {
    expect(isInterviewMeeting(busy('Joshua Shin and Ryan Demmer', { organizer: 'rdemmer@collectors.com' }), own)).toBe(true);
    expect(isInterviewMeeting(busy('Virtual Call with OpenAI', { attendees: ['me@gmail.com', 'yoshi@openai.com'] }), own)).toBe(true);
    expect(isInterviewMeeting(busy('Interview with NICE'), own)).toBe(true);
  });

  it('skips events alone, events where only you are a guest, and info sessions', () => {
    expect(isInterviewMeeting(busy('OPtio'), own)).toBe(false);
    expect(isInterviewMeeting(busy('Gym', { attendees: ['ME@gmail.com'] }), own)).toBe(false);
    expect(isInterviewMeeting(busy('EF Language Abroad Info Session', { organizer: 'zoom.ils - ef.com' }), own)).toBe(false);
  });

  it('matches a company to a meeting by title, organizer or guests', () => {
    expect(meetingMentions(busy('Interview with Rebuy, Inc.'), 'Rebuy Inc.')).toBe(true);
    expect(meetingMentions(busy('Quick chat', { organizer: 'santiago@getclera.com' }), 'Clera')).toBe(true);
    expect(meetingMentions(busy('Interview with Socket'), 'Docker')).toBe(false);
    expect(meetingMentions(busy('Anything'), 'AI')).toBe(false);
  });
});

describe('tracker stages from calendar meetings', () => {
  const app = (co: string, more: Partial<Application> = {}): Application => ({ id: 'app-' + co, co, role: '', stage: 'review', applied: 'Sep 1', acct: 'g1', pri: 'normal', next: '', activity: '', action: 'None', emailId: '', notes: '', locked: false, ai: null, timeline: [], ...more });
  const meet = (id: string, co: string, date: string, more: Partial<CalEvent> = {}): CalEvent => ({ ...ev(id, 13, 14), kind: 'busy', stage: 'busy', co, date, organizer: 'recruiter@acme.example', ...more });
  const stages = (apps: Application[], evs: CalEvent[]) => Object.fromEntries(meetingStages(apps, evs, [], '2026-10-27').map((a) => [a.co, a.stage]));

  it('one meeting is the first interview, two or more the next step; none stays where the mail put it', () => {
    const evs = [meet('1', 'Interview with Decagon', '2026-10-21'), meet('2', 'Interview with FalconX', '2026-10-07'), meet('3', 'Interview with FalconX', '2026-10-13')];
    expect(stages([app('Decagon'), app('FalconX'), app('Chime', { stage: 'applied' })], evs)).toEqual({ Decagon: 'first', FalconX: 'next', Chime: 'applied' });
  });

  it('keeps manual moves, offers and rejections; old interview stages without a meeting go back to review', () => {
    const evs = [meet('1', 'Interview with Acme', '2026-10-21'), meet('2', 'Interview with Acme', '2026-10-28')];
    expect(stages([app('Acme', { stage: 'closed' })], evs)).toEqual({ Acme: 'closed' });
    expect(stages([app('Acme', { stage: 'review', locked: true })], evs)).toEqual({ Acme: 'review' });
    expect(stages([app('Old', { stage: 'final' as Application['stage'], locked: true }), app('Gone', { stage: 'sched' as Application['stage'] })], evs)).toEqual({ Old: 'next', Gone: 'review' });
  });

  it('shows the upcoming meeting as the next step', () => {
    const [a] = meetingStages([app('Acme')], [meet('1', 'Interview with Acme', '2026-10-28')], [], '2026-10-27');
    expect(a.next).toMatch(/Oct 28, 1:00 PM ET/);
  });
});

describe('technical interviews', () => {
  const app = (co: string): Application => ({ id: 'app-' + co, co, role: '', stage: 'review', applied: 'Sep 1', acct: 'g1', pri: 'normal', next: '', activity: '', action: 'None', emailId: '', notes: '', locked: false, ai: null, timeline: [] });
  const meet = (id: string, co: string, date: string): CalEvent => ({ ...ev(id, 13, 14), kind: 'busy', stage: 'busy', co, date, organizer: 'recruiter@x.example' });
  const stageOf = (evs: CalEvent[]) => meetingStages([app('Fluidstack')], evs, [], '2026-10-27')[0].stage;

  it('goes to Technical Interview when the latest meeting is a technical round, booked or held', () => {
    expect(stageOf([meet('1', 'Recruiter screen with Fluidstack', '2026-09-20'), meet('2', 'Technical Interview with Fluidstack', '2026-11-02')])).toBe('tech');
    expect(stageOf([meet('1', 'Fluidstack coding round', '2026-09-20')])).toBe('tech');
  });

  it('moves on to Next Step after the technical round', () => {
    expect(stageOf([meet('1', 'Technical Interview with Fluidstack', '2026-09-25'), meet('2', 'Hiring Manager Interview with Fluidstack', '2026-09-29')])).toBe('next');
  });
});

describe('which company a meeting belongs to', () => {
  const app = (co: string): Application => ({ id: 'app-' + co, co, role: '', stage: 'applied', applied: 'Sep 1', acct: 'g1', pri: 'normal', next: '', activity: '', action: 'None', emailId: '', notes: '', locked: false, ai: null, timeline: [] });
  const meet = (id: string, co: string, organizer?: string): CalEvent => ({ ...ev(id, 13, 14), kind: 'busy', stage: 'busy', co, date: '2026-10-28', organizer });
  const owner = (apps: string[], v: CalEvent) => meetingStages(apps.map(app), [v], [], '2026-10-27').filter((a) => a.meetings).map((a) => a.co);

  it('goes to the one company it names, not to names made of generic words', () => {
    expect(owner(['Inc', 'Rebuy'], meet('1', 'Interview with Rebuy, Inc.', 'Interview Calendar'))).toEqual(['Rebuy']);
    expect(owner(['Greenhouse', 'Schedule', 'StreamNative'], meet('2', 'Interview with StreamNative', 'StreamNative Interviewer Calendar'))).toEqual(['StreamNative']);
    expect(owner(['Chat', 'Hiring', 'Engine'], meet('3', 'Hiring Manager Chat- Cloud Engineer- Joshua Shin', 'Boucher, Louisa'))).toEqual([]);
  });

  it('uses the organizer domain, but not the person in front of the @', () => {
    expect(owner(['Devin', 'Luma'], meet('4', 'Luma | Interview - Joshua Shin', 'devin@lumalabs.ai'))).toEqual(['Luma']);
    expect(owner(['Artemis'], meet('5', 'Artemis Interview (Virtual)', 'anthony@artemissecurity.com'))).toEqual(['Artemis']);
    expect(owner(['Alt'], meet('6', 'Joshua Shin and Kate', 'kate@saltlabs.example'))).toEqual([]);
  });
});

describe('meetings that are not about this application', () => {
  const app = (co: string, applied = 'Oct 27'): Application => ({ id: 'app-' + co, co, role: '', stage: 'applied', applied, acct: 'g1', pri: 'normal', next: '', activity: '', action: 'None', emailId: '', notes: '', locked: false, ai: null, timeline: [] });
  const meet = (id: string, co: string, date: string, organizer?: string): CalEvent => ({ ...ev(id, 13, 14), kind: 'busy', stage: 'busy', co, date, organizer });
  const stage = (a: Application, evs: CalEvent[]) => meetingStages([a], evs, [], '2026-10-27')[0].stage;

  it("ignores a recruiter's name and meetings from before the company's first email", () => {
    // "Hanna" was read from a Nordic application; Evan Hanna ran a MillerKnoll screen in June.
    expect(stage(app('Hanna'), [meet('1', 'Joshua Shin - MillerKnoll Phone Screen', '2026-06-10', 'Evan Hanna')])).toBe('applied');
    expect(stage(app('Hanna', 'Jun 1'), [meet('1', 'Joshua Shin - MillerKnoll Phone Screen', '2026-06-10', 'Evan Hanna')])).toBe('applied');
    expect(stage(app('Socket'), [meet('2', 'Interview with Socket', '2026-06-10')])).toBe('applied');
    expect(stage(app('Socket'), [meet('2', 'Interview with Socket', '2026-10-28')])).toBe('first');
  });

  it('counts the same interview entered twice on one day once', () => {
    expect(stage(app('Ingram Content', 'Oct 15'), [meet('1', 'Phone interview - Ingram Content Group', '2026-10-22'), meet('2', 'Phone interview - Ingram Content Group', '2026-10-22')])).toBe('first');
  });
});
