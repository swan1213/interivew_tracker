import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CalEvent } from '../../src/data/types';

// Scratch data directory and fake Google before any server module loads.
process.env.IFLOW_DATA_DIR = mkdtempSync(join(tmpdir(), 'iflow-cal-'));
process.env.GOOGLE_MOCK = '1';
delete process.env.ADMIN_EMAIL;
delete process.env.TOKEN_SECRET;

const OWNER = 'winterhot223@gmail.com';
const iv = (over: Partial<CalEvent> = {}): CalEvent => ({
  id: 'ev-g1:t1', kind: 'interview', co: 'Amazon', role: 'Technical interview', stage: 'tech', date: '2026-10-27', start: 11, end: 12,
  platform: 'Chime', link: 'chime.example/123', interviewer: 'Sam Ortiz', emailId: 'g1:t1', added: true, rem: [1440, 60], ...over,
});
const acct = (id: string, scopes: string[]) => ({
  id, email: id + '@gmail.example', name: id, provider: 'Gmail' as const, color: '#3F6FD8', initial: 'G', refreshToken: 'x', accessToken: 'x', expiresAt: 0, lastSync: null, scopes,
});

describe('calendar mapping', () => {
  it('writes Eastern wall-clock times and rolls past midnight', async () => {
    const { etDateTime, etParts } = await import('./calendarSync');
    expect(etDateTime('2026-10-27', 14.5)).toBe('2026-10-27T14:30:00');
    expect(etDateTime('2026-10-31', 24.25)).toBe('2026-11-01T00:15:00');
    // 18:00 UTC is 2 PM EDT in October and 1 PM EST in December.
    expect(etParts('2026-10-27T18:00:00Z')).toEqual({ date: '2026-10-27', hour: 14 });
    expect(etParts('2026-12-01T18:30:00Z')).toEqual({ date: '2026-12-01', hour: 13.5 });
  });

  it('turns an interview into a Google event with reminders and a back-reference', async () => {
    const { toGoogleEvent } = await import('./calendarSync');
    const g = toGoogleEvent(iv());
    expect(g.summary).toBe('Amazon · Technical interview');
    expect(g.start).toEqual({ dateTime: '2026-10-27T11:00:00', timeZone: 'America/New_York' });
    expect(g.end?.dateTime).toBe('2026-10-27T12:00:00');
    expect(g.location).toBe('chime.example/123');
    expect(g.description).toContain('Interviewer: Sam Ortiz');
    expect(g.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 60 }] });
    expect(g.extendedProperties?.private?.iflowId).toBe('ev-g1:t1');
    expect(toGoogleEvent(iv({ platform: 'Not stated', interviewer: 'Not stated', link: '' })).description).toBe('Added by InterviewFlow AI');
  });

  it('keeps only events that block time as busy blocks', async () => {
    const { toBusy } = await import('./calendarSync');
    const a = acct('g1', []);
    const timed = { id: 'x', summary: 'Dentist', start: { dateTime: '2026-10-27T18:00:00Z' }, end: { dateTime: '2026-10-27T19:00:00Z' } };
    expect(toBusy(a, timed)).toEqual({ id: 'gcal-g1-x', kind: 'busy', co: 'Dentist', role: 'Google Calendar', stage: 'busy', date: '2026-10-27', start: 14, end: 15, added: true, acct: 'g1' });
    expect(toBusy(a, { ...timed, transparency: 'transparent' })).toBeNull();
    expect(toBusy(a, { ...timed, status: 'cancelled' })).toBeNull();
    expect(toBusy(a, { ...timed, attendees: [{ self: true, responseStatus: 'declined' }] })).toBeNull();
    expect(toBusy(a, { ...timed, extendedProperties: { private: { iflowId: 'ev-1' } } })).toBeNull();
    expect(toBusy(a, { id: 'y', start: { date: '2026-10-27' }, end: { date: '2026-10-28' } })).toBeNull();
    // Runs past midnight: blocked until the end of its first day.
    expect(toBusy(a, { id: 'z', start: { dateTime: '2026-10-28T02:00:00Z' }, end: { dateTime: '2026-10-28T06:00:00Z' } })?.end).toBe(24);
  });
});

describe('meeting details, account colors and Gmail rate limits', () => {
  it('carries the meeting link, place, people and readable notes', async () => {
    const { toBusy } = await import('./calendarSync');
    const v = toBusy(acct('g1', []), {
      id: 'm', summary: 'Design review', location: 'Room 4B', htmlLink: 'https://calendar.google.com/event?eid=m',
      start: { dateTime: '2026-10-27T18:00:00Z' }, end: { dateTime: '2026-10-27T19:00:00Z' },
      description: '<p>Agenda:</p><ul><li>Specs &amp; risks</li></ul>Join: https://zoom.us/j/123?pwd=x',
      organizer: { email: 'lead@corp.example', displayName: 'Dana Lead' },
      attendees: [{ email: 'me@x.example', self: true }, { email: 'sam@corp.example', displayName: 'Sam' }, { email: 'room@resource.example', resource: true }],
    })!;
    expect(v.link).toBe('https://zoom.us/j/123?pwd=x');
    expect(v.platform).toBe('Zoom');
    expect(v.location).toBe('Room 4B');
    expect(v.organizer).toBe('Dana Lead');
    expect(v.attendees).toEqual(['me@x.example', 'Sam']);
    expect(v.notes).toBe('Agenda:\nSpecs & risks\nJoin: https://zoom.us/j/123?pwd=x');
    expect(v.htmlLink).toContain('calendar.google.com');
    const meet = toBusy(acct('g1', []), { id: 'n', hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceData: { conferenceSolution: { name: 'Google Meet' } }, organizer: { self: true, email: 'me@x.example' }, start: { dateTime: '2026-10-27T18:00:00Z' }, end: { dateTime: '2026-10-27T18:30:00Z' } })!;
    expect([meet.link, meet.platform, meet.organizer]).toEqual(['https://meet.google.com/abc-defg-hij', 'Google Meet', undefined]);
  });

  it('gives each mailbox its own color, keeping colors already distinct', async () => {
    const { accountColors, ACCOUNT_COLORS } = await import('./derive');
    const same = [acct('a', []), acct('b', []), acct('c', [])].map((x) => ({ ...x, color: '#3F6FD8' }));
    expect([...accountColors(same).values()]).toEqual(ACCOUNT_COLORS.slice(0, 3));
    const mixed = [{ ...acct('a', []), color: '#7C3AED' }, { ...acct('b', []), color: '#7C3AED' }];
    expect([...accountColors(mixed).values()]).toEqual(['#7C3AED', '#3F6FD8']);
  });

  it('recognizes Gmail rate limiting and keeps Google errors short', async () => {
    const { googleError, isRateLimited } = await import('./google/gmail');
    const quota = JSON.stringify({ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost'", errors: [{ reason: 'rateLimitExceeded' }] } });
    expect(isRateLimited(403, quota)).toBe(true);
    expect(isRateLimited(429, '')).toBe(true);
    expect(isRateLimited(403, JSON.stringify({ error: { message: 'Insufficient Permission' } }))).toBe(false);
    expect(googleError(403, quota)).toBe("Quota exceeded for quota metric 'Total Query Cost'");
    expect(googleError(500, 'oops')).toBe('oops');
  });
});

describe('push and pull with the mock calendar', () => {
  it('creates, updates, recreates after deletion in Google, and removes', async () => {
    const { pushEvent, removeEvent, readCalendar } = await import('./calendarSync');
    const { MockCalendar } = await import('./google/calendar');
    const cal = new MockCalendar();
    const accounts = [acct('g0', []), acct('g1', ['https://www.googleapis.com/auth/calendar.events'])];
    // The interview came from g1's mailbox, so it goes on g1's calendar.
    const used: string[] = [];
    const apiFor = (a: { id: string }) => (used.push(a.id), cal);

    const first = await pushEvent(iv(), accounts, apiFor);
    expect(cal.events.get(first.gid)?.start?.dateTime).toBe('2026-10-27T11:00:00');
    const moved = await pushEvent(iv({ start: 15, end: 16 }), accounts, apiFor);
    expect(moved.gid).toBe(first.gid);
    expect(cal.events.size).toBe(1);
    expect(cal.events.get(first.gid)?.start?.dateTime).toBe('2026-10-27T15:00:00');

    cal.events.clear();
    const back = await pushEvent(iv(), accounts, apiFor);
    expect(cal.events.has(back.gid)).toBe(true);
    expect(used.every((id) => id === 'g1')).toBe(true);

    expect(await removeEvent(iv().id, accounts, apiFor)).toBe(true);
    expect(cal.events.size).toBe(0);
    expect((await readCalendar()).links[iv().id]).toBeUndefined();
    expect(await removeEvent(iv().id, accounts, apiFor)).toBe(false);
  });

  it('pulls busy blocks for an account and skips its own interviews', async () => {
    const { syncCalendar, readCalendar, toGoogleEvent } = await import('./calendarSync');
    const { MockCalendar } = await import('./google/calendar');
    const cal = new MockCalendar();
    const now = new Date('2026-10-26T13:00:00Z');
    await cal.insert({ summary: 'Team sync', start: { dateTime: '2026-10-27T19:00:00Z' }, end: { dateTime: '2026-10-27T19:30:00Z' } });
    await cal.insert({ summary: 'Far future', start: { dateTime: '2027-03-01T15:00:00Z' }, end: { dateTime: '2027-03-01T16:00:00Z' } });
    await cal.insert({ ...toGoogleEvent(iv()), start: { dateTime: '2026-10-27T15:00:00Z' }, end: { dateTime: '2026-10-27T16:00:00Z' } });
    expect(await syncCalendar(acct('g2', []), cal, now)).toEqual({ busy: 1 });
    expect((await readCalendar()).busy.g2.map((v) => [v.co, v.date, v.start, v.end])).toEqual([['Team sync', '2026-10-27', 15, 15.5]]);
  });
});

describe('calendar API', () => {
  let server: Server;
  let base = '';
  let cookie = '';

  beforeAll(async () => {
    const { createApi } = await import('./api');
    server = createApi().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const login = await fetch(base + '/auth/login?as=' + encodeURIComponent(OWNER), { redirect: 'manual' });
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const req = (path: string, method = 'GET', body?: unknown, c = cookie) =>
    fetch(base + path, { method, redirect: 'manual', headers: { cookie: c, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

  it('asks for a connected calendar before pushing', async () => {
    const r = await req('/calendar/events/' + encodeURIComponent(iv().id), 'PUT', { event: iv() });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('calendar_scope');
  });

  it('pushes, moves and removes an interview, and pulls busy time into the snapshot', async () => {
    const start = await req('/auth/google/start');
    // The API is mounted at / here, not /api.
    await req(start.headers.get('location')!.replace(/^\/api/, ''));
    const { readAccounts } = await import('./store');
    const { MockCalendar } = await import('./google/calendar');
    const [a] = await readAccounts();
    const cal = MockCalendar.for(a.id);
    const path = '/calendar/events/' + encodeURIComponent(iv().id);

    expect((await req(path, 'PUT', { event: iv({ end: 10 }) })).status).toBe(400);
    expect((await req(path, 'PUT', { event: iv() })).status).toBe(200);
    expect((await req(path, 'PUT', { event: iv({ start: 13, end: 14 }) })).status).toBe(200);
    expect([...cal.events.values()].map((g) => g.start?.dateTime)).toEqual(['2026-10-27T13:00:00']);

    const soon = new Date(Date.now() + 86_400_000);
    await cal.insert({ summary: 'Gym', start: { dateTime: soon.toISOString() }, end: { dateTime: new Date(soon.getTime() + 3_600_000).toISOString() } });
    expect((await (await req('/sync', 'POST', {})).json()).errors).toEqual([]);
    const snap = (await (await req('/snapshot')).json()).snapshot;
    expect(snap.events.filter((v: CalEvent) => v.kind === 'busy').map((v: CalEvent) => v.co)).toEqual(['Gym']);
    expect(snap.accts[0].calendar).toBe(true);

    expect(await (await req(path, 'DELETE')).json()).toEqual({ removed: true });
    expect([...cal.events.values()].map((g) => g.summary)).toEqual(['Gym']);
  });

  it('keeps guests out', async () => {
    await req('/team', 'POST', { name: 'Gail', email: 'guest@example.com', role: 'guest' });
    const g = await fetch(base + '/auth/login?as=guest%40example.com', { redirect: 'manual' });
    const guest = (g.headers.get('set-cookie') || '').split(';')[0];
    expect((await req('/calendar/events/x', 'PUT', { event: iv({ id: 'x' }) }, guest)).status).toBe(403);
    expect((await req('/calendar/events/x', 'DELETE', undefined, guest)).status).toBe(403);
  });
});
