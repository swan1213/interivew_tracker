/**
 * The Outlook calendar through Microsoft Graph, behind the same CalendarApi the Google calendar
 * uses: Graph events are turned into Google-shaped events and back, so busy blocks, conflict
 * checks and pushing interviews work the same for both.
 */
import { CalendarError, type CalendarApi, type GEvent } from '../google/calendar';
import type { StoredAccount } from '../types';
import { graph, graphAll, type GraphOpts } from './graph';

/** Marks events the app created, like Google's private extended property. */
export const IFLOW_PROP = 'String {6d1f7c52-8a0e-4b5b-9d3c-2f61a3e4b7c9} Name iflowId';

interface Who { emailAddress?: { name?: string; address?: string } }
export interface GraphEvent {
  id: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  showAs?: string;
  responseStatus?: { response?: string };
  attendees?: (Who & { type?: string; status?: { response?: string } })[];
  organizer?: Who;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingProvider?: string;
  webLink?: string;
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
  singleValueExtendedProperties?: { id: string; value: string }[];
}

const FIELDS = 'id,subject,body,location,start,end,isAllDay,isCancelled,isOrganizer,showAs,responseStatus,attendees,organizer,onlineMeeting,onlineMeetingProvider,webLink';
const EXPAND = '$expand=' + encodeURIComponent("singleValueExtendedProperties($filter=id eq '" + IFLOW_PROP + "')");
/** Times come back in UTC (without a zone suffix) so they convert exactly. */
const UTC: GraphOpts = { prefer: ['outlook.timezone="UTC"'], fail: (status, message) => new CalendarError(status, message) };

/** Graph's UTC "2026-10-28T14:00:00.0000000" as an RFC 3339 instant. */
const utc = (dt?: string): string => (dt ? dt.replace(/\.\d+$/, '').replace(/(Z|[+-]\d\d:\d\d)?$/, (m) => m || 'Z') : '');

/** IANA zones the app writes, as the Windows names Graph knows best. */
const WINDOWS_ZONE: Record<string, string> = { 'America/New_York': 'Eastern Standard Time', UTC: 'UTC' };

/** A Graph event in the shape of a Google Calendar event. */
export function toGEvent(e: GraphEvent): GEvent {
  const iflowId = e.singleValueExtendedProperties?.find((p) => p.id.toLowerCase() === IFLOW_PROP.toLowerCase())?.value;
  const attendees = (e.attendees || []).map((a) => ({
    email: a.emailAddress?.address,
    displayName: a.emailAddress?.name,
    resource: a.type === 'resource',
    responseStatus: a.status?.response,
  }));
  // Graph reports your own answer separately; Google lists it as the attendee marked `self`.
  if (e.responseStatus?.response === 'declined') attendees.push({ email: undefined, displayName: undefined, resource: false, responseStatus: 'declined', self: true } as (typeof attendees)[number]);
  return {
    id: e.id,
    status: e.isCancelled ? 'cancelled' : 'confirmed',
    summary: e.subject,
    description: e.body?.content,
    location: e.location?.displayName || undefined,
    transparency: e.showAs === 'free' ? 'transparent' : undefined,
    start: e.isAllDay ? { date: (e.start?.dateTime || '').slice(0, 10) } : { dateTime: utc(e.start?.dateTime) },
    end: e.isAllDay ? { date: (e.end?.dateTime || '').slice(0, 10) } : { dateTime: utc(e.end?.dateTime) },
    attendees,
    organizer: { email: e.organizer?.emailAddress?.address, displayName: e.organizer?.emailAddress?.name, self: !!e.isOrganizer },
    ...(e.onlineMeeting?.joinUrl ? { conferenceData: { entryPoints: [{ entryPointType: 'video', uri: e.onlineMeeting.joinUrl }], conferenceSolution: { name: e.onlineMeetingProvider === 'teamsForBusiness' ? 'Microsoft Teams' : 'Video call' } } } : {}),
    htmlLink: e.webLink,
    ...(iflowId ? { extendedProperties: { private: { iflowId } } } : {}),
  };
}

/** A Google-shaped event the app built, as a Graph event body. */
export function fromGEvent(g: GEvent): Record<string, unknown> {
  const zone = (z?: string) => WINDOWS_ZONE[z || ''] || z || 'UTC';
  const firstReminder = g.reminders?.overrides?.[0]?.minutes;
  return {
    subject: g.summary || '',
    body: { contentType: 'text', content: g.description || '' },
    ...(g.location ? { location: { displayName: g.location } } : {}),
    start: { dateTime: g.start?.dateTime, timeZone: zone(g.start?.timeZone) },
    end: { dateTime: g.end?.dateTime, timeZone: zone(g.end?.timeZone) },
    isReminderOn: firstReminder !== undefined,
    ...(firstReminder !== undefined ? { reminderMinutesBeforeStart: firstReminder } : {}),
    ...(g.extendedProperties?.private?.iflowId ? { singleValueExtendedProperties: [{ id: IFLOW_PROP, value: g.extendedProperties.private.iflowId }] } : {}),
  };
}

export class OutlookCalendar implements CalendarApi {
  constructor(private acct: StoredAccount) {}

  /** Events in the window with recurring ones expanded into occurrences, like Google's singleEvents. */
  async listEvents(timeMin: string, timeMax: string): Promise<GEvent[]> {
    const q = 'startDateTime=' + encodeURIComponent(timeMin) + '&endDateTime=' + encodeURIComponent(timeMax) + '&$top=250&$select=' + FIELDS + '&' + EXPAND;
    return (await graphAll<GraphEvent>(this.acct, '/me/calendarView?' + q, 1000, UTC)).map(toGEvent);
  }

  /**
   * Looked up in the calendar itself: an event the user deleted sits in Deleted Items under the same
   * id, where /me/events still finds it; the calendar doesn't, so the deletion is noticed (404).
   */
  async get(id: string): Promise<GEvent> {
    return toGEvent(await graph<GraphEvent>(this.acct, '/me/calendar/events/' + encodeURIComponent(id) + '?$select=' + FIELDS + '&' + EXPAND, {}, UTC));
  }

  async insert(ev: GEvent): Promise<GEvent> {
    return toGEvent(await graph<GraphEvent>(this.acct, '/me/events', { method: 'POST', body: JSON.stringify(fromGEvent(ev)) }, UTC));
  }

  async update(id: string, ev: GEvent): Promise<GEvent> {
    return toGEvent(await graph<GraphEvent>(this.acct, '/me/events/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(fromGEvent(ev)) }, UTC));
  }

  async remove(id: string): Promise<void> {
    await graph(this.acct, '/me/events/' + encodeURIComponent(id), { method: 'DELETE' }, UTC);
  }
}
