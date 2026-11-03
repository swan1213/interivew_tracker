import { describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import type { CalEvent, Email, Notif } from '@/data/types';
import { DEFAULT_SETTINGS } from '@/store/store';
import { bellNotifs, mailAlerts, mailKey, mailReason, reminderAlerts } from './notify';
import { etInstant } from './time';

const [base] = buildDemoData().emails;
const mail = (p: Partial<Email>): Email => ({ ...base, id: 'm' + Math.random(), cat: 'status', catOv: undefined, starred: false, archived: false, ago: 5, evId: undefined, subject: 'Update on your application', thread: [{ from: 'Ann', addr: 'ann@co.example', when: '', body: '' }], ...p });

describe('which mail gets a browser notification', () => {
  it('starred mail, calendar bookings and reminder emails only', () => {
    expect(mailReason(mail({ starred: true }))).toBe('Starred');
    expect(mailReason(mail({ cat: 'confirmed', subject: 'Your interview is confirmed' }))).toBe('Interview booked');
    expect(mailReason(mail({ subject: 'Invitation: Interview with Acme @ Tue Nov 4' }))).toBe('Interview booked');
    expect(mailReason(mail({ subject: 'Reminder: your interview tomorrow' }))).toBe('Reminder');
    expect(mailReason(mail({ cat: 'invite' }))).toBeNull();
    expect(mailReason(mail({ cat: 'rejected' }))).toBeNull();
    expect(mailReason(mail({ cat: 'offer' }))).toBeNull();
  });

  it('never for my own reply or archived mail', () => {
    expect(mailReason(mail({ starred: true, thread: [{ from: 'Me', addr: 'me@x.example', when: '', body: '', mine: true }] }))).toBeNull();
    expect(mailReason(mail({ starred: true, archived: true }))).toBeNull();
  });

  it('announces each new message once, and not old mail', () => {
    const seen = new Set<string>();
    const fresh = mail({ starred: true });
    const old = mail({ starred: true, ago: 600 });
    expect(mailAlerts([fresh, old], seen, [], DEFAULT_SETTINGS).map((a) => a.emailId)).toEqual([fresh.id]);
    expect(mailAlerts([fresh, old], seen, [], DEFAULT_SETTINGS)).toEqual([]);
    expect(seen.has(mailKey(old))).toBe(true);
    // A new message in the starred conversation.
    const reply = { ...fresh, thread: fresh.thread.concat([{ from: 'Ann', addr: 'ann@co.example', when: '', body: '' }]) };
    expect(mailAlerts([reply], seen, [], DEFAULT_SETTINGS)).toHaveLength(1);
  });
});

describe('what a mail notification says', () => {
  it('who, which role, when the interview is booked, and the gist; Join opens the meeting', () => {
    const e = mail({ cat: 'confirmed', company: 'Acme', fromName: 'Jane Doe', role: 'Senior Engineer', subject: 'Interview confirmed', summary: 'Your technical interview with Acme is confirmed.', evId: 'v9' });
    const v: CalEvent = { id: 'v9', kind: 'interview', co: 'Acme', role: 'Tech', stage: 'tech', date: '2026-11-04', start: 14, end: 15, platform: 'Zoom', link: 'zoom.us/j/1', added: true };
    const [a] = mailAlerts([e], new Set(), [v], { ...DEFAULT_SETTINGS, tz: 'PT' });
    expect(a.title).toBe('Interview booked · Acme');
    expect(a.body.split('\n')).toEqual(['Interview confirmed', 'Jane Doe · Senior Engineer', '🗓 Wed, Nov 4, 11:00 AM PT · Zoom', 'Your technical interview with Acme is confirmed.']);
    expect(a.link).toBe('https://zoom.us/j/1');
  });

  it('a deadline when there is no interview time', () => {
    const [a] = mailAlerts([mail({ starred: true, deadline: 'Fri, Nov 6', times: [], summary: '' })], new Set(), [], DEFAULT_SETTINGS);
    expect(a.body).toContain('⏰ Due Fri, Nov 6');
    expect(a.link).toBeUndefined();
  });
});

describe('interview reminders', () => {
  const v: CalEvent = { id: 'v1', kind: 'interview', co: 'Acme', role: 'Tech interview', stage: 'tech', date: '2026-11-04', start: 14, end: 15, platform: 'Zoom', added: true, rem: [60] };
  const at = etInstant(v.date, v.start).getTime();

  it('fires once when due, and not when long past', () => {
    const fired = new Set<string>();
    expect(reminderAlerts([v], DEFAULT_SETTINGS, fired, new Date(at - 61 * 60_000))).toEqual([]);
    const [a] = reminderAlerts([v], DEFAULT_SETTINGS, fired, new Date(at - 59 * 60_000));
    expect(a.title).toBe('Interview in 1 hour · Acme');
    expect(a.body.split('\n')).toEqual(['Tech interview', '🗓 Wed, Nov 4, 2:00 PM ET (60 min) · Zoom']);
    expect(a.sticky).toBe(true);
    expect(reminderAlerts([v], DEFAULT_SETTINGS, fired, new Date(at - 58 * 60_000))).toEqual([]);
    expect(reminderAlerts([v], DEFAULT_SETTINGS, new Set(), new Date(at - 30 * 60_000))).toEqual([]);
  });

  it('uses the Settings reminders when the event has none, and skips events not on the calendar', () => {
    const own = { ...v, rem: undefined };
    expect(reminderAlerts([own], DEFAULT_SETTINGS, new Set(), new Date(at - 1439 * 60_000))[0].title).toBe('Interview in 1 day · Acme');
    expect(reminderAlerts([{ ...v, added: false }], DEFAULT_SETTINGS, new Set(), new Date(at - 59 * 60_000))).toEqual([]);
  });

  it('reads stored hours as Eastern time', () => {
    expect(etInstant('2026-11-04', 14).toISOString()).toBe('2026-11-04T19:00:00.000Z');
    expect(etInstant('2026-07-04', 14).toISOString()).toBe('2026-07-04T18:00:00.000Z');
  });
});

describe('the notification bell', () => {
  it('follows the Settings switches; action requests always show', () => {
    const n = (cat: Notif['cat'], title: string): Notif => ({ id: cat + title, title, text: '', time: '', unread: true, cat, emailId: '' });
    const all = [n('invite', 'Interview invitation'), n('offer', 'Offer received'), n('action', 'Assessment deadline approaching'), n('action', 'Recruiter requesting information')];
    expect(bellNotifs(all, DEFAULT_SETTINGS)).toHaveLength(4);
    const S = { ...DEFAULT_SETTINGS, notif: { ...DEFAULT_SETTINGS.notif, newInvite: false, offer: false, deadline: false } };
    expect(bellNotifs(all, S).map((x) => x.title)).toEqual(['Recruiter requesting information']);
  });
});
