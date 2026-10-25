import type { Application, CalEvent, DataSnapshot, Email, Notif } from '@/data/types';
import { stageLabel } from '@/data/constants';
import type { Data } from './store';

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
  const apps: Application[] = server.apps.map((s) => {
    const l = lApp.get(s.id);
    if (!l) return s;
    const suggest = !l.locked && s.stage !== l.stage;
    return {
      ...l,
      role: l.role || s.role,
      activity: s.activity,
      action: s.action,
      emailId: s.emailId || l.emailId,
      next: s.next || l.next,
      pri: s.pri,
      ai: suggest ? { stage: s.stage, text: 'moving to ' + stageLabel(s.stage) + ' based on the latest email.' } : l.locked ? null : l.ai,
    };
  });
  // Keep local-only applications (e.g. a company whose mail was archived).
  local.apps.forEach((a) => {
    if (!serverIds.has(a.id)) apps.push(a);
  });

  const lEv = new Map(local.events.map((v) => [v.id, v]));
  const events: CalEvent[] = server.events.map((s) => {
    const l = lEv.get(s.id);
    return l ? { ...s, added: l.added, rem: l.rem, date: l.date, start: l.start, end: l.end, co: l.co, pendingNote: l.pendingNote } : s;
  });
  const serverEv = new Set(server.events.map((v) => v.id));
  local.events.forEach((v) => {
    if (!serverEv.has(v.id)) events.push(v);
  });

  const lNotif = new Map(local.notifs.map((n) => [n.id, n]));
  const notifs: Notif[] = server.notifs.map((n) => {
    const l = lNotif.get(n.id);
    return l && !l.unread ? { ...n, unread: false } : n;
  });

  return { accts: server.accts, emails, apps, events, notifs, activity: server.activity };
}
