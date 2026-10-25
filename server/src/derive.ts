/**
 * Turn stored, classified threads into the shapes the UI renders:
 * emails, applications, calendar events, notifications and activity.
 * Everything here is derived; user workflow state (manual kanban moves,
 * notes, events added to the calendar) lives in the browser and is merged there.
 */
import type { Account, ActivityItem, Application, CalEvent, DataSnapshot, Email, EvStage, Notif, StageKey, ThreadMsg } from '../../src/data/types';
import { hasCalendar } from './google/calendar';
import { agoMinutes, fmtT, lab, relLabel, timeLabel, whenLabel } from './time';
import type { MailStore, StoredAccount, StoredThread } from './types';

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string): string => {
  const d = new Date(iso);
  return MN[d.getMonth()] + ' ' + d.getDate();
};
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const PHRASE: Record<string, string> = {
  avail: 'asked for your availability',
  invite: 'invited you to interview',
  confirmed: 'confirmed your interview',
  offer: 'sent an offer',
  rejected: 'closed your application',
  applied: 'acknowledged your application',
  status: 'sent an application update',
  action: 'requested information',
  review: 'sent a message',
  auto: 'sent an automated message',
};
const NOTIF_TITLE: Record<string, string> = {
  avail: 'New availability request',
  invite: 'Interview invitation',
  confirmed: 'Interview confirmed',
  offer: 'Offer received',
  action: 'Recruiter requesting information',
};
const STAGE_OF_CAT: Partial<Record<string, StageKey>> = { applied: 'applied', status: 'review', invite: 'sched', avail: 'sched', confirmed: 'confirmed', offer: 'offer', rejected: 'closed' };

export function evStageOf(stageText: string): EvStage {
  const t = stageText.toLowerCase();
  if (/technical|coding|system design/.test(t)) return 'tech';
  if (/hiring manager/.test(t)) return 'mgr';
  if (/final|panel|onsite|on-site/.test(t)) return 'final';
  if (/offer/.test(t)) return 'offer';
  return 'screen';
}

export function accountView(a: StoredAccount, now: Date): Account {
  return {
    id: a.id,
    label: a.name && a.name !== a.email ? a.name + ' · Gmail' : a.email,
    addr: a.email,
    provider: 'Gmail',
    color: a.color,
    initial: a.initial,
    sendAs: a.name || a.email,
    calendar: hasCalendar(a),
    sync: a.lastSync ? 'Synced ' + relLabel(a.lastSync, now).toLowerCase().replace(/^just now$/, 'just now') : 'Not synced yet',
  };
}

export function threadToEmail(acct: StoredAccount, t: StoredThread, now: Date): Email | null {
  const msgs = [...t.messages].sort((a, b) => a.date.localeCompare(b.date));
  const head = [...msgs].reverse().find((m) => !m.isMine);
  const cls = t.classification;
  if (!head || !cls) return null;
  const latest = msgs[msgs.length - 1];
  const replied = latest.isMine;
  const id = acct.id + ':' + t.id;
  const labels = head.labelIds;
  const thread: ThreadMsg[] = msgs.map((m, i) => ({
    from: m.isMine ? 'You (' + (acct.name || acct.email) + ')' : m.fromName,
    addr: m.fromAddr,
    when: whenLabel(m.date),
    body: m.bodyText,
    atts: m.atts,
    mine: m.isMine,
    first: i === 0,
  }));
  const awaiting = !!cls.mode && (cls.mode === 'avail' || cls.mode === 'resched') && replied;
  return {
    id,
    acct: acct.id,
    fromName: head.fromName,
    fromAddr: head.fromAddr,
    company: cls.company,
    role: cls.role,
    recruiter: cls.recruiter,
    subject: head.subject,
    ago: agoMinutes(head.date, now),
    time: timeLabel(head.date, now),
    cat: cls.cat,
    sec: cls.sec,
    pri: cls.pri,
    conf: cls.conf,
    unread: labels.includes('UNREAD'),
    starred: msgs.some((m) => m.labelIds.includes('STARRED')),
    needs: cls.needs,
    ivStatus: cls.cat === 'confirmed' ? 'confirmed' : awaiting ? 'awaiting' : 'none',
    stage: cls.stage,
    action: cls.action,
    deadline: cls.deadline,
    deadlineKey: cls.deadlineKey,
    mode: cls.mode,
    need: cls.need,
    slotLen: cls.slotLen,
    windowDates: cls.windowDates,
    opts: cls.opts,
    evId: cls.event ? 'ev-' + id : undefined,
    canReply: cls.canReply,
    replyKind: cls.replyKind,
    summary: cls.summary,
    facts: cls.facts,
    assumptions: cls.assumptions,
    times: cls.times.map((h) => ({ label: h.label })),
    atts: head.atts,
    body: head.bodyText,
    thread,
    done: replied && cls.needs ? true : undefined,
    replied: replied || undefined,
    archived: !labels.includes('INBOX') && !labels.includes('SENT') ? true : undefined,
  };
}

export function buildSnapshot(accounts: StoredAccount[], mails: Record<string, MailStore>, now: Date = new Date()): DataSnapshot {
  const accts = accounts.map((a) => accountView(a, now));
  const emails: Email[] = [];
  const stageText = new Map<string, string>();
  for (const a of accounts) {
    const mail = mails[a.id];
    if (!mail) continue;
    for (const t of Object.values(mail.threads)) {
      const e = threadToEmail(a, t, now);
      if (!e) continue;
      emails.push(e);
      if (t.classification) stageText.set(e.id, t.classification.stage);
    }
  }
  emails.sort((a, b) => a.ago - b.ago);

  // Calendar events from confirmed interviews with a concrete time.
  const events: CalEvent[] = [];
  for (const a of accounts) {
    const mail = mails[a.id];
    if (!mail) continue;
    for (const t of Object.values(mail.threads)) {
      const cls = t.classification;
      if (!cls?.event) continue;
      const id = a.id + ':' + t.id;
      const e = emails.find((x) => x.id === id);
      if (!e) continue;
      events.push({
        id: 'ev-' + id,
        kind: 'interview',
        co: cls.company || e.fromName,
        role: cls.cat === 'offer' ? 'Offer discussion call' : cls.stage || 'Interview',
        stage: cls.cat === 'offer' ? 'offer' : evStageOf(cls.stage),
        date: cls.event.date,
        start: cls.event.start,
        end: cls.event.end,
        platform: cls.platform || 'Not stated',
        link: cls.link || '',
        interviewer: cls.interviewer || cls.recruiter || 'Not stated',
        emailId: id,
        added: false,
        rem: [1440, 60],
      });
    }
  }

  // Applications: one per company, stage from the most recent stage-defining email.
  const groups = new Map<string, Email[]>();
  for (const e of emails) {
    if (!e.company || e.cat === 'auto' || e.cat === 'review' || e.archived) continue;
    const k = slug(e.company);
    if (!k) continue;
    (groups.get(k) || groups.set(k, []).get(k)!).push(e);
  }
  const apps: Application[] = [];
  for (const [k, list] of groups) {
    const byNew = [...list].sort((a, b) => a.ago - b.ago);
    const latest = byNew[0];
    const oldest = byNew[byNew.length - 1];
    const stageMail = byNew.find((e) => STAGE_OF_CAT[e.cat]);
    const stage: StageKey = stageMail ? STAGE_OF_CAT[stageMail.cat]! : 'review';
    const ev = events.find((v) => v.emailId && list.some((e) => e.id === v.emailId));
    const oldestDate = new Date(now.getTime() - oldest.ago * 60000).toISOString();
    const latestDate = new Date(now.getTime() - latest.ago * 60000).toISOString();
    const activity = latest.company + ' ' + (PHRASE[latest.cat] || 'sent a message') + ', ' + relLabel(latestDate, now).toLowerCase();
    apps.push({
      id: 'app-' + k,
      co: latest.company,
      role: byNew.find((e) => e.role)?.role || '',
      stage,
      applied: shortDate(oldestDate),
      acct: latest.acct,
      pri: latest.pri,
      next: ev ? lab(ev.date) + ', ' + fmtT(ev.start) + ' ET' : '',
      activity,
      action: latest.needs && !latest.done ? latest.action : 'None',
      emailId: latest.id,
      notes: '',
      locked: false,
      ai: null,
      timeline: [
        { text: activity, when: 'Latest', src: 'Email', cls: 'cat-' + latest.cat },
        { text: 'First email from ' + latest.company + (stageText.get(oldest.id) ? ': ' + stageText.get(oldest.id) : ''), when: shortDate(oldestDate), src: 'Email', cls: 'cat-applied' },
      ],
    });
  }
  apps.sort((a, b) => a.co.localeCompare(b.co));

  const notifs: Notif[] = emails
    .filter((e) => e.needs && !e.done && e.ago <= 14 * 1440 && !e.archived)
    .slice(0, 12)
    .map((e) => ({
      id: 'n-' + e.id,
      title: e.mode === 'assess' ? 'Assessment deadline approaching' : e.mode === 'resched' ? 'Interview rescheduling requested' : NOTIF_TITLE[e.cat] || 'Action required',
      text: e.summary.length > 120 ? e.summary.slice(0, 118) + '…' : e.summary,
      time: relLabel(new Date(now.getTime() - e.ago * 60000).toISOString(), now),
      unread: e.unread,
      cat: e.cat,
      emailId: e.id,
    }));

  const activity: ActivityItem[] = emails
    .filter((e) => e.cat !== 'auto')
    .slice(0, 8)
    .map((e) => ({
      text: (e.company || e.fromName) + ' ' + (PHRASE[e.cat] || 'sent a message'),
      time: relLabel(new Date(now.getTime() - e.ago * 60000).toISOString(), now),
      cls: 'cat-' + e.cat,
    }));

  return { accts, emails, apps, events, notifs, activity };
}
