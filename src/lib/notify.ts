import type { CalEvent, Email, Notif, NotifKey, Settings } from '@/data/types';
import { effCat } from './mail';
import { etInstant, fmtT, lab, tzOffset } from './time';

/** What a browser notification says, the email it opens on click, and the meeting its Join button opens. */
export interface Alert {
  key: string;
  title: string;
  body: string;
  emailId?: string;
  link?: string;
  /** Stays on screen until dismissed (interview reminders). */
  sticky?: boolean;
}

/** Mail newer than this is still news; anything older is never announced (first run, turning the switch on). */
const FRESH_MIN = 120;
/** A reminder is shown up to this late (the tab was asleep), then skipped. */
const LATE_MS = 10 * 60_000;

const BOOKING = /\b(invitation|invite|booked|booking|scheduled|confirmed|calendar|calendly)\b/i;
const REMINDER = /\breminder\b/i;

/** A conversation's notification identity: changes when a message arrives in it. */
export const mailKey = (e: Email): string => e.id + ':' + e.thread.length;

/** Why this email deserves a browser notification, if it does: starred, a calendar booking, or a reminder. */
export function mailReason(e: Email): string | null {
  if (e.archived || effCat(e) === 'sent' || e.thread[e.thread.length - 1]?.mine) return null;
  if (REMINDER.test(e.subject)) return 'Reminder';
  if (effCat(e) === 'confirmed' || (e.evId && BOOKING.test(e.subject)) || /^(updated )?invitation:/i.test(e.subject)) return 'Interview booked';
  if (e.starred) return 'Starred';
  return null;
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** "Tue, Nov 4, 2:00 PM ET" for a stored ET date and hour, in the zone chosen in Settings. */
export const whenLabel = (date: string, start: number, S: Settings): string =>
  lab(date) + ', ' + fmtT(start + tzOffset(S.tz, etInstant(date, start))) + ' ' + S.tz;

/** A meeting link as something a browser can open ("zoom.us/j/1" → "https://zoom.us/j/1"). */
const href = (link?: string): string | undefined => (!link ? undefined : /^https?:\/\//i.test(link) ? link : 'https://' + link);

/**
 * What the notification says about an email: the subject, who sent it and for which role,
 * the interview time if one is booked (or the time asked about, or the deadline), and the gist.
 */
export function mailBody(e: Email, v: CalEvent | undefined, S: Settings): string {
  const who = [e.fromName, e.role].filter(Boolean).join(' · ');
  const when = v
    ? '🗓 ' + whenLabel(v.date, v.start, S) + (v.platform ? ' · ' + v.platform : '')
    : e.times[0]?.label ? '🗓 ' + e.times[0].label
    : e.deadline ? '⏰ Due ' + e.deadline
    : '';
  return [e.subject, who, when, e.summary && e.summary !== e.subject ? clip(e.summary, 160) : ''].filter(Boolean).join('\n');
}

/** Notifications for mail not announced before; every current conversation is marked seen. */
export function mailAlerts(emails: Email[], seen: Set<string>, events: CalEvent[], S: Settings): Alert[] {
  const out: Alert[] = [];
  for (const e of emails) {
    const k = mailKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    const why = e.ago <= FRESH_MIN ? mailReason(e) : null;
    if (!why) continue;
    const v = events.find((x) => x.kind === 'interview' && (x.id === e.evId || x.emailId === e.id));
    out.push({ key: k, title: why + ' · ' + (e.company || e.fromName), body: mailBody(e, v, S), emailId: e.id, link: href(v?.link) });
  }
  return out;
}

/** Reminder offsets (minutes) for an event: its own, or the ones switched on in Settings. */
export function reminderOffsets(v: CalEvent, S: Settings): number[] {
  if (v.rem) return v.rem;
  return Object.keys(S.rem).filter((k) => S.rem[k]).map(Number);
}

const before = (m: number): string => (m >= 1440 && m % 1440 === 0 ? m / 1440 + (m === 1440 ? ' day' : ' days') : m >= 60 && m % 60 === 0 ? m / 60 + (m === 60 ? ' hour' : ' hours') : m + ' minutes');

/** Interview reminders due now, not yet fired. */
export function reminderAlerts(events: CalEvent[], S: Settings, fired: Set<string>, now: Date): Alert[] {
  const out: Alert[] = [];
  for (const v of events) {
    if (v.kind !== 'interview' || !v.added) continue;
    const at = etInstant(v.date, v.start).getTime();
    for (const m of reminderOffsets(v, S)) {
      const k = v.id + '@' + v.date + 'T' + v.start + '-' + m;
      const due = at - m * 60_000;
      if (fired.has(k) || now.getTime() < due || now.getTime() > Math.min(at, due + LATE_MS)) continue;
      fired.add(k);
      const mins = Math.round((v.end - v.start) * 60);
      const body = [
        v.role,
        '🗓 ' + whenLabel(v.date, v.start, S) + (mins > 0 ? ' (' + mins + ' min)' : '') + (v.platform ? ' · ' + v.platform : ''),
        v.interviewer ? 'With ' + v.interviewer : '',
        v.link ? '🔗 ' + v.link : '',
      ].filter(Boolean).join('\n');
      out.push({ key: k, title: 'Interview in ' + before(m) + ' · ' + v.co, body, emailId: v.emailId || undefined, link: href(v.link), sticky: true });
    }
  }
  return out;
}

/** The Settings switch that controls a bell notification; action requests have none and always show. */
const bellSwitch = (n: Notif): NotifKey | null =>
  /reschedul/i.test(n.title) ? 'resched'
  : /assessment/i.test(n.title) ? 'deadline'
  : n.cat === 'invite' ? 'newInvite'
  : n.cat === 'avail' ? 'avail'
  : n.cat === 'confirmed' ? 'confirm'
  : n.cat === 'offer' ? 'offer'
  : null;

/** Bell notifications the Settings switches allow. */
export const bellNotifs = (notifs: Notif[], S: Settings): Notif[] => notifs.filter((n) => {
  const k = bellSwitch(n);
  return !k || S.notif[k];
});
