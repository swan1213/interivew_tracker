import { describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import { DEFAULT_SETTINGS } from '@/store/store';
import { activeEvents } from './calendar';
import { buildSched, parseSlotKey, slotKey } from './schedule';

const data = buildDemoData();
const email = (id: string) => data.emails.find((e) => e.id === id)!;
const active = activeEvents(data.events);

describe('scheduling dialog model', () => {
  it('offers hourly slots inside the availability window on the requested weekdays', () => {
    const m = buildSched(email('e1'), 'avail', [], DEFAULT_SETTINGS, active);
    expect(m.title).toBe('Schedule interview: Microsoft');
    expect(m.need).toBe(3);
    expect(m.days.map((d) => d.label)).toEqual(['Tue', 'Wed', 'Thu', 'Fri']);
    // 9:00 .. 17:00 start times fit a 45-minute call before 18:00
    expect(m.days[0].slots.map((s) => s.label)).toEqual(['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM']);
    expect(m.cantGen).toBe(true);
  });

  it('crosses out slots that overlap existing events', () => {
    const m = buildSched(email('e1'), 'avail', [], DEFAULT_SETTINGS, active);
    const tue = m.days[0]; // Oct 27: work sync 3:00-3:30 PM
    const busy = tue.slots.find((s) => s.label === '3:00 PM')!; // 3:00-3:45 overlaps
    expect(busy.busy).toBe(true);
    expect(busy.title).toContain('Current job: team sync');
    const thu = m.days[2]; // Oct 29: doctor 1-2 PM
    expect(thu.slots.find((s) => s.label === '1:00 PM')!.busy).toBe(true);
    expect(thu.slots.find((s) => s.label === '12:00 PM')!.busy).toBe(false);
    expect(thu.slots.find((s) => s.label === '2:00 PM')!.busy).toBe(false);
  });

  it('marks selected slots and enables generation when enough are chosen', () => {
    const sel = [slotKey('2026-10-27', 9), slotKey('2026-10-28', 11), slotKey('2026-10-30', 9)];
    const m = buildSched(email('e1'), 'avail', sel, DEFAULT_SETTINGS, active);
    expect(m.days[0].slots[0].on).toBe(true);
    expect(m.cantGen).toBe(false);
  });

  it('lets you offer as many times as you like, at least as many as the email asked for', () => {
    const sel = [9, 10, 11, 12, 13, 14, 15, 16].map((h) => slotKey('2026-10-27', h));
    const m = buildSched(email('e1'), 'avail', sel, DEFAULT_SETTINGS, active);
    expect(m.cantGen).toBe(false);
    expect(m.days[0].slots.filter((s) => s.on)).toHaveLength(8);
    expect(m.sub).toContain('Choose at least 3 times to offer (3 requested).');
  });

  it('skips days outside the configured availability', () => {
    const S = { ...DEFAULT_SETTINGS, whDays: [1, 3] }; // Mon, Wed only
    const m = buildSched(email('e1'), 'avail', [], S, active);
    expect(m.days.map((d) => d.label)).toEqual(['Wed']);
  });

  it('reschedule mode lists exactly the recruiter options and ignores the original event', () => {
    const m = buildSched(email('e7'), 'resched', [], DEFAULT_SETTINGS, active);
    expect(m.title).toBe('Pick a new time with Atlassian');
    expect(m.sub).toContain('Tom proposed');
    expect(m.days.map((d) => d.label)).toEqual(['Tue', 'Thu', 'Fri']);
    const thu = m.days[1].slots[0];
    expect(thu.label).toBe('1:00 PM');
    expect(thu.busy).toBe(true); // doctor appointment
    expect(m.days[0].slots[0].busy).toBe(false);
    expect(m.need).toBe(1);
  });

  it('round-trips slot keys', () => {
    expect(parseSlotKey(slotKey('2026-10-27', 11.5))).toEqual({ date: '2026-10-27', start: 11.5 });
  });
});
