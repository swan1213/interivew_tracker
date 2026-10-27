import { describe, expect, it } from 'vitest';
import type { CalEvent } from '@/data/types';
import { conflictPairs, conflictsOf, isInterviewMeeting, layoutLanes, meetingMentions } from './calendar';

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
