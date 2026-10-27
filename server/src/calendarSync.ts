/**
 * Two-way Google Calendar sync.
 * Push: an interview the user adds, moves or removes in the app is created,
 * updated or deleted on the Google Calendar of the mailbox it came from.
 * Pull: other events on connected calendars become busy blocks, so the slot
 * picker and conflict checks see real commitments.
 * Stored as calendar.json: which Google event mirrors which app event, and the
 * busy blocks last pulled per account.
 */
import type { CalEvent } from '../../src/data/types';
import { calendarFor, CalendarError, hasCalendar, type CalendarApi, type GEvent } from './google/calendar';
import { readJson, writeJson } from './store';
import { addDays } from './time';
import type { StoredAccount } from './types';

const FILE = 'calendar.json';
/** App times are Eastern; Google converts for the viewer. */
const ET = 'America/New_York';
/** Window pulled on each sync: past meetings stay visible on the calendar. */
const HISTORY_DAYS = 180;
const AHEAD_DAYS = 60;
/** App interviews older than this are over and no longer checked against Google. */
const PAST_DAYS = 1;

export interface CalendarStore {
  /** App interviews on a calendar; `date` (ISO day, ET) lets past ones be forgotten instead of re-checked forever. */
  links: Record<string, { accountId: string; gid: string; date?: string }>;
  busy: Record<string, CalEvent[]>;
  /** App interviews whose Google event was deleted there, with when that was noticed; the app takes them off its calendar. */
  removed: Record<string, string>;
}

export const readCalendar = async (): Promise<CalendarStore> => {
  const c = await readJson<Partial<CalendarStore>>(FILE, {});
  return { links: c.links || {}, busy: c.busy || {}, removed: c.removed || {} };
};

/** Linked events checked one by one per sync, at most. */
const VERIFY_MAX = 30;
const writeCalendar = (c: CalendarStore): Promise<void> => writeJson(FILE, c);

// Accounts sync in parallel; read-modify-write of the shared calendar file runs one at a time so none is lost.
let calQueue: Promise<unknown> = Promise.resolve();
function updateCalendar(fn: (c: CalendarStore) => void): Promise<void> {
  const run = calQueue.then(async () => {
    const c = await readCalendar();
    fn(c);
    await writeCalendar(c);
  });
  calQueue = run.catch(() => undefined);
  return run;
}

/** All pulled busy blocks, for the snapshot. */
export const busyEvents = (c: CalendarStore, accounts: StoredAccount[]): CalEvent[] => accounts.flatMap((a) => c.busy[a.id] || []);

/** Forget an account's links and busy blocks when it is disconnected. */
export async function dropCalendarAccount(accountId: string): Promise<void> {
  await updateCalendar((c) => {
    delete c.busy[accountId];
    for (const [id, l] of Object.entries(c.links)) if (l.accountId === accountId) delete c.links[id];
  });
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "2026-10-27" + 14.5 → "2026-10-27T14:30:00"; hours past midnight roll into the next day. */
export function etDateTime(date: string, hour: number): string {
  const day = Math.floor(hour / 24);
  const mins = Math.round((hour - day * 24) * 60);
  return (day ? addDays(date, day) : date) + 'T' + pad(Math.floor(mins / 60)) + ':' + pad(mins % 60) + ':00';
}

/** Eastern date and decimal hour of an RFC 3339 timestamp. */
export function etParts(iso: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour) + Number(p.minute) / 60 };
}

export function toGoogleEvent(ev: CalEvent): GEvent {
  const has = (s?: string) => !!s && s !== 'Not stated';
  const details = [
    has(ev.interviewer) ? 'Interviewer: ' + ev.interviewer : '',
    has(ev.platform) ? 'Platform: ' + ev.platform : '',
    ev.link ? 'Link: ' + ev.link : '',
    ev.pendingNote || '',
  ].filter(Boolean);
  return {
    summary: ev.co + ' · ' + ev.role,
    description: [...details, ...(details.length ? [''] : []), 'Added by InterviewFlow AI'].join('\n'),
    ...(ev.link ? { location: ev.link } : {}),
    start: { dateTime: etDateTime(ev.date, ev.start), timeZone: ET },
    end: { dateTime: etDateTime(ev.date, ev.end), timeZone: ET },
    reminders: { useDefault: false, overrides: (ev.rem || []).slice(0, 5).map((minutes) => ({ method: 'popup', minutes })) },
    extendedProperties: { private: { iflowId: ev.id } },
  };
}

/** Event descriptions are often HTML; keep readable text with line breaks. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500);
}

const MEETING_URL = /https?:\/\/[^\s<>"]*(zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com|webex\.com|chime\.aws)[^\s<>"]*/i;
const PLATFORMS: [RegExp, string][] = [[/zoom\./i, 'Zoom'], [/teams\./i, 'Microsoft Teams'], [/meet\.google/i, 'Google Meet'], [/webex/i, 'Webex'], [/chime/i, 'Amazon Chime']];

/** The video link and its service: Google Meet / conference data first, else a meeting URL in the location or notes. */
function meetingOf(g: GEvent, notes: string): { link?: string; platform?: string } {
  const video = g.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  const link = g.hangoutLink || video || MEETING_URL.exec(g.location || '')?.[0] || MEETING_URL.exec(notes)?.[0];
  if (!link) return {};
  return { link, platform: g.conferenceData?.conferenceSolution?.name || PLATFORMS.find(([re]) => re.test(link))?.[1] || 'Video call' };
}

/** A Google event as a busy block, or null for events that don't block time. */
export function toBusy(acct: StoredAccount, g: GEvent): CalEvent | null {
  if (!g.id || g.status === 'cancelled' || g.transparency === 'transparent') return null;
  // Our own interviews are already in the app; all-day events don't block a time slot.
  if (g.extendedProperties?.private?.iflowId || !g.start?.dateTime || !g.end?.dateTime) return null;
  if (g.attendees?.some((x) => x.self && x.responseStatus === 'declined')) return null;
  const s = etParts(g.start.dateTime);
  const e = etParts(g.end.dateTime);
  const end = e.date === s.date ? e.hour : 24;
  if (end <= s.hour) return null;
  const notes = plainText(g.description || '');
  const who = (p: { email?: string; displayName?: string }) => p.displayName || p.email || '';
  const attendees = (g.attendees || []).filter((x) => !x.resource).map(who).filter(Boolean).slice(0, 25);
  return {
    id: 'gcal-' + acct.id + '-' + g.id,
    kind: 'busy',
    co: g.summary || 'Busy',
    role: acct.provider === 'Outlook' ? 'Outlook Calendar' : 'Google Calendar',
    stage: 'busy',
    date: s.date,
    start: s.hour,
    end,
    added: true,
    acct: acct.id,
    ...meetingOf(g, notes),
    ...(g.location ? { location: g.location } : {}),
    ...(notes ? { notes } : {}),
    ...(g.organizer && !g.organizer.self && who(g.organizer) ? { organizer: who(g.organizer) } : {}),
    ...(attendees.length ? { attendees } : {}),
    ...(g.htmlLink ? { htmlLink: g.htmlLink } : {}),
  };
}

/** Pull the account's calendar into busy blocks. */
export async function syncCalendar(acct: StoredAccount, api: CalendarApi = calendarFor(acct), now: Date = new Date()): Promise<{ busy: number; deleted: number }> {
  const day = 86_400_000;
  const items = await api.listEvents(new Date(now.getTime() - HISTORY_DAYS * day).toISOString(), new Date(now.getTime() + AHEAD_DAYS * day).toISOString());
  const busy = items.map((g) => toBusy(acct, g)).filter((v): v is CalEvent => !!v);

  // Interviews the app put on this calendar but missing from the listing: outside the
  // window, or deleted in Google Calendar. A lookup tells which. Links to interviews that are
  // over are forgotten, so the lookups stay on the ones that can still change.
  const present = new Set(items.map((g) => g.id));
  const today = etParts(now.toISOString()).date;
  const mine = Object.entries((await readCalendar()).links).filter(([, l]) => l.accountId === acct.id);
  const past = new Set(mine.filter(([, l]) => l.date && l.date < addDays(today, -PAST_DAYS)).map(([id]) => id));
  const deleted: string[] = [];
  const dated: Record<string, string> = {};
  // Linked before dates were kept: learn the date, and forget the link if the interview is over.
  const learn = (evId: string, g: GEvent) => {
    if (!g.start?.dateTime) return;
    const d = etParts(g.start.dateTime).date;
    if (d < addDays(today, -PAST_DAYS)) past.add(evId);
    else dated[evId] = d;
  };
  const listed = new Map(items.map((g) => [g.id, g]));
  for (const [evId, l] of mine) if (!l.date && !past.has(evId) && listed.has(l.gid)) learn(evId, listed.get(l.gid)!);
  for (const [evId, l] of mine.filter(([id, l]) => !past.has(id) && !present.has(l.gid)).slice(0, VERIFY_MAX)) {
    try {
      const g = await api.get(l.gid);
      if (g.status === 'cancelled') deleted.push(evId);
      else if (!l.date) learn(evId, g);
    } catch (e) {
      if (gone(e)) deleted.push(evId);
    }
  }

  await updateCalendar((c) => {
    c.busy[acct.id] = busy;
    for (const id of deleted) {
      delete c.links[id];
      c.removed[id] = now.toISOString();
    }
    for (const id of past) delete c.links[id];
    for (const [id, d] of Object.entries(dated)) if (c.links[id]) c.links[id].date = d;
  });
  return { busy: busy.length, deleted: deleted.length };
}

export class NoCalendarError extends Error {}

/** The calendar an event belongs on: where it is already, else its mailbox, else any connected calendar. */
function calendarAccount(ev: CalEvent, accounts: StoredAccount[], linked?: string): StoredAccount {
  const byId = (id?: string) => accounts.find((a) => a.id === id && hasCalendar(a));
  const a = byId(linked) || byId(ev.emailId?.split(':')[0]) || accounts.find(hasCalendar);
  if (!a) throw new NoCalendarError('Connect your Gmail again and allow Google Calendar access to sync interviews.');
  return a;
}

const gone = (e: unknown): boolean => e instanceof CalendarError && (e.status === 404 || e.status === 410);

/** Create or update the Google event mirroring an app interview. */
export async function pushEvent(ev: CalEvent, accounts: StoredAccount[], apiFor: (a: StoredAccount) => CalendarApi = calendarFor): Promise<{ gid: string; accountId: string }> {
  const c = await readCalendar();
  const link = c.links[ev.id];
  const acct = calendarAccount(ev, accounts, link?.accountId);
  const api = apiFor(acct);
  const body = toGoogleEvent(ev);
  let gid = '';
  if (link && link.accountId === acct.id) {
    try {
      gid = (await api.update(link.gid, body)).id || link.gid;
    } catch (e) {
      // Deleted in Google Calendar: put it back, since the app still has it on the calendar.
      if (!gone(e)) throw e;
    }
  }
  if (!gid) gid = (await api.insert(body)).id || '';
  await updateCalendar((c) => {
    c.links[ev.id] = { accountId: acct.id, gid, date: ev.date };
    // Added again from the app: no longer counts as deleted in Google.
    delete c.removed[ev.id];
  });
  return { gid, accountId: acct.id };
}

/** Delete the Google event mirroring an app interview, if there is one. */
export async function removeEvent(id: string, accounts: StoredAccount[], apiFor: (a: StoredAccount) => CalendarApi = calendarFor): Promise<boolean> {
  const link = (await readCalendar()).links[id];
  if (!link) return false;
  const acct = accounts.find((a) => a.id === link.accountId);
  if (acct) {
    try {
      await apiFor(acct).remove(link.gid);
    } catch (e) {
      if (!gone(e)) throw e;
    }
  }
  await updateCalendar((c) => void delete c.links[id]);
  return true;
}
