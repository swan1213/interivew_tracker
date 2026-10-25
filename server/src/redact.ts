import type { Application, CalEvent, DataSnapshot, Email } from '../../src/data/types';

/**
 * What a guest receives: enough to draw the Analytics page (categories, dates,
 * accounts, pipeline stages), and no mail content. Subjects, senders, bodies,
 * summaries, company and role names, notes and meeting links are removed.
 * Company names are replaced by stable placeholders so events still map to
 * applications.
 */
export function redactForGuest(s: DataSnapshot): DataSnapshot {
  const coIds = new Map<string, string>();
  const co = (name: string): string => {
    if (!name) return '';
    let id = coIds.get(name);
    if (!id) {
      id = 'Company ' + (coIds.size + 1);
      coIds.set(name, id);
    }
    return id;
  };

  const emails: Email[] = s.emails.map((e) => ({
    id: e.id, acct: e.acct, ago: e.ago, time: e.time, cat: e.cat, sec: e.sec, pri: e.pri, conf: e.conf,
    unread: e.unread, starred: e.starred, needs: e.needs, ivStatus: e.ivStatus, deadlineKey: e.deadlineKey,
    canReply: false, done: e.done, replied: e.replied, archived: e.archived,
    fromName: '', fromAddr: '', company: '', role: '', recruiter: '', subject: '', stage: '', action: '', deadline: '',
    replyKind: '', summary: '', facts: [], assumptions: [], times: [], body: '', thread: [],
  }));

  const apps: Application[] = s.apps.map((a) => ({
    id: a.id, co: co(a.co), role: '', stage: a.stage, applied: a.applied, acct: a.acct, pri: a.pri,
    next: '', activity: '', action: '', emailId: a.emailId, notes: '', locked: a.locked, ai: null, timeline: [],
  }));

  const events: CalEvent[] = s.events.map((v) => ({
    id: v.id, kind: v.kind, co: co(v.co), role: '', stage: v.stage, date: v.date, start: v.start, end: v.end, emailId: v.emailId, added: v.added,
  }));

  return { accts: s.accts.map((a) => ({ ...a, sendAs: '' })), emails, apps, events, notifs: [], activity: [] };
}
