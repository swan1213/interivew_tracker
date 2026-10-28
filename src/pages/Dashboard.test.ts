import { describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import type { CalEvent } from '@/data/types';
import { todaysEvents, upcomingInterviews } from './Dashboard';

const busy = (id: string, co: string, date: string, start: number): CalEvent => ({ id, kind: 'busy', co, role: 'Google Calendar', stage: 'busy', date, start, end: start + 1, added: true });

describe('dashboard interview numbers', () => {
  const data = buildDemoData();
  const today = '2026-10-26';

  it('counts scheduled interviews, interview-titled calendar events and confirmed interviews without a time', () => {
    const confirmedNoTime = { ...data.emails[0], id: 'x1', cat: 'confirmed' as const, company: 'Globex', fromAddr: 'dana@globex.example', evId: undefined, done: undefined };
    const events = [...data.events, busy('gcal-1', 'Phone screen with Acme', '2026-10-27', 10), busy('gcal-2', 'Dentist', '2026-10-27', 12), busy('gcal-3', 'Interview (past)', '2026-10-20', 9)];
    const items = upcomingInterviews(events, [...data.emails, confirmedNoTime], today);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('gcal-1');
    expect(ids).not.toContain('gcal-2');
    expect(ids).not.toContain('gcal-3');
    expect(ids).toContain('mail-x1');
    expect(items.every((i) => !i.ev || i.ev.date >= today)).toBe(true);
    // Scheduled ones come first, in time order.
    const dated = items.filter((i) => i.ev).map((i) => i.ev!.date + i.ev!.start);
    expect(dated).toEqual([...dated].sort());
  });

  it('counts each meeting once and skips confirmations already on the calendar or not needing action', () => {
    const onCal: CalEvent = { ...busy('gcal-5', 'Interview with StreamNative', '2026-10-28', 14), kind: 'busy' };
    const copy: CalEvent = { id: 'ev-copy', kind: 'interview', co: 'Ppl & Biz Ops', role: 'HR screening', stage: 'screen', date: '2026-10-28', start: 14, end: 14.5, emailId: 'm1', added: false };
    const notice = { ...data.emails[0], id: 'x2', cat: 'confirmed' as const, company: 'Luma', evId: undefined, done: undefined, needs: false };
    const booked = { ...data.emails[0], id: 'x3', cat: 'confirmed' as const, company: 'StreamNative', evId: undefined, done: undefined };
    const ids = upcomingInterviews([...data.events, onCal, copy], [...data.emails, notice, booked], today).map((i) => i.id);
    expect(ids).toContain('gcal-5');
    expect(ids).not.toContain('ev-copy');
    expect(ids).not.toContain('mail-x2');
    expect(ids).not.toContain('mail-x3');
  });

  it("today's schedule includes other commitments, in time order", () => {
    const evs = todaysEvents([...data.events, busy('gcal-4', 'Team sync', today, 8)], today);
    expect(evs[0].id).toBe('gcal-4');
    expect(evs.every((v) => v.date === today && v.added)).toBe(true);
  });
});
