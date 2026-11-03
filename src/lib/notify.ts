import type { CalEvent, Email, Settings } from '@/data/types';
import { effCat } from './mail';
import { etInstant } from './time';

/** What a browser notification says, and the email it opens on click. */
export interface Alert { key: string; title: string; body: string; emailId?: string }

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

/** Notifications for mail not announced before; every current conversation is marked seen. */
export function mailAlerts(emails: Email[], seen: Set<string>): Alert[] {
  const out: Alert[] = [];
  for (const e of emails) {
    const k = mailKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    const why = e.ago <= FRESH_MIN ? mailReason(e) : null;
    if (why) out.push({ key: k, title: why + ': ' + (e.company || e.fromName), body: e.subject, emailId: e.id });
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
      out.push({ key: k, title: 'Interview in ' + before(m) + ': ' + v.co, body: [v.role, v.platform].filter(Boolean).join(' · '), emailId: v.emailId || undefined });
    }
  }
  return out;
}
