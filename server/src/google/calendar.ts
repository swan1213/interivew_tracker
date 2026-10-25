import { cfg } from '../config';
import type { StoredAccount } from '../types';
import { accessTokenFor } from './gmail';
import { CALENDAR_SCOPE } from './oauth';

/** The subset of a Google Calendar event the app reads and writes. */
export interface GEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarApi {
  /** Timed and all-day events on the primary calendar in [timeMin, timeMax), recurring ones expanded. */
  listEvents(timeMin: string, timeMax: string): Promise<GEvent[]>;
  insert(ev: GEvent): Promise<GEvent>;
  /** Replace an event; rejects with status 404/410 when it no longer exists. */
  update(id: string, ev: GEvent): Promise<GEvent>;
  remove(id: string): Promise<void>;
}

export class CalendarError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export class RealCalendar implements CalendarApi {
  constructor(private acct: StoredAccount) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await accessTokenFor(this.acct);
    const r = await fetch(BASE + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new CalendarError(r.status, 'Calendar API ' + r.status + (text ? ': ' + text.slice(0, 300) : ''));
    }
    return (r.status === 204 ? undefined : await r.json()) as T;
  }

  async listEvents(timeMin: string, timeMax: string): Promise<GEvent[]> {
    const out: GEvent[] = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      if (pageToken) q.set('pageToken', pageToken);
      const j = await this.call<{ items?: GEvent[]; nextPageToken?: string }>('?' + q.toString());
      out.push(...(j.items || []));
      pageToken = j.nextPageToken || '';
    } while (pageToken && out.length < 1000);
    return out;
  }

  insert(ev: GEvent): Promise<GEvent> {
    return this.call<GEvent>('', { method: 'POST', body: JSON.stringify(ev) });
  }

  update(id: string, ev: GEvent): Promise<GEvent> {
    return this.call<GEvent>('/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(ev) });
  }

  async remove(id: string): Promise<void> {
    await this.call('/' + encodeURIComponent(id), { method: 'DELETE' });
  }
}

/** In-memory calendar for GOOGLE_MOCK and tests. */
export class MockCalendar implements CalendarApi {
  private static instances = new Map<string, MockCalendar>();
  static for(accountId: string): MockCalendar {
    let m = MockCalendar.instances.get(accountId);
    if (!m) {
      m = new MockCalendar();
      MockCalendar.instances.set(accountId, m);
    }
    return m;
  }

  readonly events = new Map<string, GEvent>();
  private seq = 0;

  async listEvents(timeMin: string, timeMax: string): Promise<GEvent[]> {
    const lo = Date.parse(timeMin);
    const hi = Date.parse(timeMax);
    return Array.from(this.events.values()).filter((e) => {
      const s = Date.parse(e.start?.dateTime || e.start?.date || '');
      return s >= lo && s < hi;
    });
  }

  async insert(ev: GEvent): Promise<GEvent> {
    const id = 'mock-ev-' + ++this.seq;
    const saved = { ...ev, id, status: 'confirmed' };
    this.events.set(id, saved);
    return saved;
  }

  async update(id: string, ev: GEvent): Promise<GEvent> {
    if (!this.events.has(id)) throw new CalendarError(404, 'mock: no event ' + id);
    const saved = { ...ev, id, status: 'confirmed' };
    this.events.set(id, saved);
    return saved;
  }

  async remove(id: string): Promise<void> {
    if (!this.events.delete(id)) throw new CalendarError(410, 'mock: event ' + id + ' already deleted');
  }
}

/** Accounts connected before calendar sync existed lack the scope until they connect again. */
export const hasCalendar = (acct: StoredAccount): boolean => cfg.mock || acct.scopes.includes(CALENDAR_SCOPE);

export function calendarFor(acct: StoredAccount): CalendarApi {
  if (cfg.mock) return MockCalendar.for(acct.id);
  return new RealCalendar(acct);
}
