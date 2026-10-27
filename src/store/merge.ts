import type { Application, CalEvent, DataSnapshot, Email, Notif } from '@/data/types';
import type { Data } from './store';

/** A busy block pulled from Google Calendar; one the server no longer sends was deleted or moved there. */
const isPulledBusy = (v: CalEvent): boolean => v.kind === 'busy' && v.id.startsWith('gcal-');

/**
 * Combine a fresh server snapshot with what the browser already holds.
 *
 * The server owns the mail itself (existence, thread text, read/starred/archived
 * from Gmail labels) and the derived applications and events. The browser owns
 * the user's workflow: category overrides, actions marked done, manual kanban
 * moves, notes, reminders, events added to the calendar, notifications read.
 */
export function mergeSnapshot(local: Data, server: DataSnapshot): Data {
  const lEmail = new Map(local.emails.map((e) => [e.id, e]));
  const emails: Email[] = server.emails.map((e) => {
    const l = lEmail.get(e.id);
    if (!l) return e;
    return {
      ...e,
      catOv: l.catOv,
      conf: l.catOv ? 100 : e.conf,
      done: l.done || e.done,
      replied: l.replied || e.replied,
    };
  });

  const lApp = new Map(local.apps.map((a) => [a.id, a]));
  const serverIds = new Set(server.apps.map((a) => a.id));
  // The server re-derives every application from the current mail; the browser keeps only what
  // the user did to a card. A card the user never moved follows the server's stage, so a stage
  // from an earlier (since corrected) classification never lingers.
  const apps: Application[] = server.apps.map((s) => {
    const l = lApp.get(s.id);
    if (!l) return s;
    return {
      ...s,
      role: s.role || l.role,
      emailId: s.emailId || l.emailId,
      next: s.next || l.next,
      stage: l.locked ? l.stage : s.stage,
      locked: l.locked,
      notes: l.notes,
      remind: l.remind,
      ai: null,
    };
  });
  // An application the server no longer derives (its mail was archived or reclassified) stays
  // only if the user worked on it, and only while its mailbox is connected.
  const connected = new Set(server.accts.map((a) => a.id));
  const touched = (a: Application) => a.locked || !!a.notes || !!a.remind;
  local.apps.forEach((a) => {
    if (!serverIds.has(a.id) && connected.has(a.acct) && touched(a)) apps.push(a);
  });

  const lEv = new Map(local.events.map((v) => [v.id, v]));
  // Interviews deleted in Google Calendar come off the app's calendar too.
  const removed = new Set(server.calRemoved || []);
  const events: CalEvent[] = server.events.map((s) => {
    const l = lEv.get(s.id);
    // Busy blocks mirror the user's Google Calendar, so the server copy wins.
    if (!l || s.kind === 'busy') return s;
    return { ...s, added: l.added && !removed.has(s.id), rem: l.rem, date: l.date, start: l.start, end: l.end, co: l.co, pendingNote: l.pendingNote };
  });
  const serverEv = new Set(server.events.map((v) => v.id));
  local.events.forEach((v) => {
    const acct = v.acct || v.emailId?.split(':')[0];
    if (!serverEv.has(v.id) && !isPulledBusy(v) && !removed.has(v.id) && (!acct || connected.has(acct))) events.push(v);
  });

  const lNotif = new Map(local.notifs.map((n) => [n.id, n]));
  const notifs: Notif[] = server.notifs.map((n) => {
    const l = lNotif.get(n.id);
    return l && !l.unread ? { ...n, unread: false } : n;
  });

  return { accts: server.accts, emails, apps, events, notifs, activity: server.activity };
}
