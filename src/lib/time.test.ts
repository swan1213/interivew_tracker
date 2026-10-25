import { describe, expect, it } from 'vitest';
import { addD, durationWords, fmtT, hourLab, hrs, lab, mondayOf, rel, slotLabel, tzOffset } from './time';

describe('time helpers', () => {
  it('formats decimal hours as 12-hour clock', () => {
    expect(fmtT(9.2)).toBe('9:12 AM');
    expect(fmtT(11)).toBe('11:00 AM');
    expect(fmtT(12)).toBe('12:00 PM');
    expect(fmtT(13.5)).toBe('1:30 PM');
    expect(fmtT(0)).toBe('12:00 AM');
    expect(fmtT(15.999)).toBe('4:00 PM');
  });

  it('formats hour labels', () => {
    expect(hourLab(8)).toBe('8 AM');
    expect(hourLab(12)).toBe('12 PM');
    expect(hourLab(18)).toBe('6 PM');
    expect(hourLab(-1)).toBe('11 PM');
  });

  it('does date arithmetic in UTC', () => {
    expect(addD('2026-10-26', 1)).toBe('2026-10-27');
    expect(addD('2026-10-31', 1)).toBe('2026-11-01');
    expect(mondayOf('2026-10-29')).toBe('2026-10-26');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19');
    expect(lab('2026-10-26')).toBe('Mon, Oct 26');
  });

  it('labels relative days', () => {
    expect(rel('2026-10-26', '2026-10-26')).toBe('Today');
    expect(rel('2026-10-27', '2026-10-26')).toBe('Tomorrow');
    expect(rel('2026-10-28', '2026-10-26')).toBe('Wed, Oct 28');
  });

  it('parses HH:MM and applies zone offsets', () => {
    expect(hrs('10:30')).toBe(10.5);
    expect(hrs(undefined)).toBe(0);
    expect(tzOffset('ET')).toBe(0);
    expect(tzOffset('PT')).toBe(-3);
    expect(slotLabel('2026-10-27', 11, tzOffset('PT'), 'PT')).toBe('Tue, Oct 27 at 8:00 AM PT');
  });

  it('describes durations', () => {
    expect(durationWords({ start: 11, end: 12 })).toBe('one hour');
    expect(durationWords({ start: 13, end: 15 })).toBe('two hours');
    expect(durationWords({ start: 10, end: 10.75 })).toBe('45 minutes');
  });
});
