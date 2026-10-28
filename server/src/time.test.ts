import { describe, expect, it } from 'vitest';
import { extractDateTimes, lab, nextBusinessDays, relLabel, timeLabel, zoneToEt } from './time';

const REF = new Date('2026-10-26T09:00:00');

describe('date and time extraction', () => {
  it('pairs a date line with the time line after it', () => {
    const hits = extractDateTimes('Date: Tuesday, October 27\nTime: 11:00 AM to 12:00 PM ET\nFormat: Chime', REF);
    expect(hits).toEqual([{ date: '2026-10-27', start: 11, end: 12, zone: 'ET', label: 'Tue, Oct 27 · 11:00 AM–12:00 PM ET', kind: 'meeting' }]);
  });

  it('reads bullets with date and time on one line and flags the original slot', () => {
    const text = "Could we move Wednesday's interview (Oct 28, 3:00 PM ET)? I can offer:\n• Tuesday, Oct 27 at 11:30 AM ET\n• Thursday, Oct 29 at 1:00 PM ET";
    const hits = extractDateTimes(text, REF);
    expect(hits.map((h) => h.kind)).toEqual(['original', 'meeting', 'meeting']);
    expect(hits[1]).toMatchObject({ date: '2026-10-27', start: 11.5 });
    expect(hits[2]).toMatchObject({ date: '2026-10-29', start: 13 });
  });

  it('treats "by <time> tomorrow" as a deadline and resolves relative days', () => {
    const hits = extractDateTimes('If you can get it to me by 5:00 PM ET tomorrow, that would be ideal.', REF);
    expect(hits).toEqual([{ date: '2026-10-27', start: 17, end: undefined, zone: 'ET', label: 'Tue, Oct 27 · 5:00 PM ET', kind: 'deadline' }]);
    expect(extractDateTimes('Call today, 3:30 to 4:00 PM ET', REF)[0]).toMatchObject({ date: '2026-10-26', start: 15.5, end: 16, kind: 'meeting' });
  });

  it('handles date-only mentions, numeric dates and year rollover', () => {
    expect(extractDateTimes('between Tuesday, Oct 27 and Friday, Oct 30', REF).map((h) => h.date)).toEqual(['2026-10-27', '2026-10-30']);
    expect(extractDateTimes('Deadline 11/02/2026', REF)[0]).toMatchObject({ date: '2026-11-02', kind: 'deadline' });
    expect(extractDateTimes('See you Jan 5 at 9 AM PT', REF)[0]).toMatchObject({ date: '2027-01-05', start: 9, zone: 'PT' });
    expect(extractDateTimes('Room 4 opens at 10', REF)).toEqual([]);
  });

  it('labels', () => {
    expect(lab('2026-10-26')).toBe('Mon, Oct 26');
    expect(timeLabel('2026-10-26T08:34:00', new Date('2026-10-26T09:12:00'))).toBe('8:34 AM');
    expect(timeLabel('2026-10-24T08:34:00', new Date('2026-10-26T09:12:00'))).toBe('Sat');
    expect(timeLabel('2026-09-01T08:34:00', new Date('2026-10-26T09:12:00'))).toBe('Sep 1');
    expect(relLabel('2026-10-26T08:34:00', new Date('2026-10-26T09:12:00'))).toBe('38 min ago');
    expect(relLabel('2026-10-26T03:42:00', new Date('2026-10-26T09:12:00'))).toBe('5h ago');
    expect(relLabel('2026-10-25T20:00:00', new Date('2026-10-26T09:12:00'))).toBe('Yesterday');
    expect(nextBusinessDays('2026-10-24', 3)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(zoneToEt('PT')).toBe(3);
    expect(zoneToEt('ADT')).toBe(-1);
    expect(extractDateTimes('Your interview is Wed Oct 28 at 10 PM ADT', REF)[0]).toMatchObject({ start: 10 + 12, zone: 'ADT' });
    expect(zoneToEt(undefined)).toBe(0);
  });
});

describe('zones written after a time', () => {
  it('reads GMT offsets, zone names and parenthesized abbreviations', () => {
    const at = (text: string) => extractDateTimes(text, REF)[0];
    expect(at('Date/Time: Oct 28, 2026 3:00pm-3:30pm (GMT-03:00) Atlantic Time (Canada)').zone).toBe('GMT-03:00');
    expect(at('Wednesday Oct 28, 2026 ⋅ 1pm – 1:30pm Atlantic Time - Halifax').zone).toBe('ADT');
    expect(at('Wednesday, October 28, 2026 - 8:30 PM - 9:00 PM (ADT) - Recruiter Screen').zone).toBe('ADT');
    expect(zoneToEt('GMT-03:00')).toBe(-1);
    expect(zoneToEt('GMT-07:00')).toBe(3);
  });
});
