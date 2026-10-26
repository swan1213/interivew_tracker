/**
 * Turn stored, classified threads into the shapes the UI renders:
 * emails, applications, calendar events, notifications and activity.
 * Everything here is derived; user workflow state (manual kanban moves,
 * notes, events added to the calendar) lives in the browser and is merged there.
 */
import type { Account, ActivityItem, Application, CalEvent, DataSnapshot, Email, EvStage, Notif, StageKey, ThreadMsg } from '../../src/data/types';
import { hasCalendar } from './google/calendar';
import { cleanBody, parseAddress } from './mime';
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

/** Distinct mailbox colors (white text reads on each), handed out in this order. */
export const ACCOUNT_COLORS = ['#3F6FD8', '#0F7C8C', '#C2410C', '#7C3AED', '#15803D', '#BE185D', '#B45309', '#475569'];

/** One color per account: its own, unless an earlier account already shows it (accounts saved before colors were assigned all share one). */
export function accountColors(accounts: StoredAccount[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const a of accounts) {
    const c = a.color && !used.has(a.color) ? a.color : ACCOUNT_COLORS.find((x) => !used.has(x)) || a.color;
    used.add(c);
    out.set(a.id, c);
  }
  return out;
}

/** The first letter of the address, so two mailboxes don't both show "G". */
export const accountInitial = (email: string): string => (email.trim()[0] || 'G').toUpperCase();

export function accountView(a: StoredAccount, now: Date, color = a.color): Account {
  return {
    id: a.id,
    label: a.name && a.name !== a.email ? a.name + ' · ' + a.provider : a.email,
    addr: a.email,
    provider: a.provider,
    color,
    initial: accountInitial(a.email),
    sendAs: a.name || a.email,
    calendar: hasCalendar(a),
    sync: a.lastSync ? 'Synced ' + relLabel(a.lastSync, now).toLowerCase().replace(/^just now$/, 'just now') : 'Not synced yet',
  };
}

const addressesIn = (header: string): string[] => (header.match(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/g) || []).map((x) => x.toLowerCase());

export function threadToEmail(acct: StoredAccount, t: StoredThread, now: Date): Email | null {
  const msgs = [...t.messages].sort((a, b) => a.date.localeCompare(b.date));
  const cls = t.classification;
  const latest = msgs[msgs.length - 1];
  // The latest received message leads; a conversation you started with no reply yet is led by your latest message.
  const sentOnly = cls?.cat === 'sent';
  const head = sentOnly ? latest : [...msgs].reverse().find((m) => !m.isMine);
  if (!head || !cls) return null;
  const replied = !sentOnly && latest.isMine;
  // Sent mail is listed by who it went to.
  const to = sentOnly ? parseAddress(head.to.split(',')[0] || '') : null;
  const me = acct.email.toLowerCase();
  const peers = [...new Set(msgs.flatMap((m) => (m.isMine ? addressesIn(m.to) : [m.fromAddr.toLowerCase()])))].filter((x) => x && x !== me);
  const id = acct.id + ':' + t.id;
  const labels = head.labelIds;
  const thread: ThreadMsg[] = msgs.map((m, i) => ({
    from: m.isMine ? 'You (' + (acct.name || acct.email) + ')' : m.fromName,
    addr: m.fromAddr,
    when: whenLabel(m.date),
    body: cleanBody(m.bodyText),
    atts: m.atts,
    mine: m.isMine,
    first: i === 0,
  }));
  const awaiting = !!cls.mode && (cls.mode === 'avail' || cls.mode === 'resched') && replied;
  return {
    id,
    acct: acct.id,
    peers,
    fromName: to ? 'To: ' + (to.name || to.addr || 'no recipient') : head.fromName,
    fromAddr: to ? to.addr : head.fromAddr,
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
    unread: !sentOnly && labels.includes('UNREAD'),
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
    body: cleanBody(head.bodyText),
    thread,
    done: replied && cls.needs ? true : undefined,
    replied: replied || undefined,
    archived: !labels.includes('INBOX') && !labels.includes('SENT') ? true : undefined,
  };
}

// Google Calendar notices ("Invitation: …", "Updated invitation: …", "Canceled event: …") each arrive as a new
// Gmail thread. They are folded into one conversation per event so an interview reads as a single thread.
const CAL_PREFIX = /^(?:(?:updated |new )?invitation|canceled event|cancelled event|event canceled|accepted|declined|tentatively accepted|new event|updated event)(?: from an unknown sender)?(?: with note)?:\s*/i;

/** The Google Calendar event id inside a notice's links (`eid` is base64url of "<event id> <calendar>"). */
function calendarEventId(text: string): string {
  const m = text.match(/[?&]eid=([A-Za-z0-9_-]+)/);
  if (!m) return '';
  try {
    return Buffer.from(m[1], 'base64url').toString('utf8').split(' ')[0] || '';
  } catch {
    return '';
  }
}

/** A key shared by every calendar notice about the same event, or '' for ordinary mail. */
export function calendarKey(t: StoredThread): string {
  const first = [...t.messages].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!first || first.isMine || !CAL_PREFIX.test(first.subject)) return '';
  const eid = t.messages.map((m) => calendarEventId(m.bodyText)).find(Boolean);
  if (eid) return 'eid:' + eid;
  // No event link: the organizer plus the event title, without the date and time that change on updates.
  const title = first.subject
    .replace(CAL_PREFIX, '')
    .replace(/\s+@\s+.*$/, '')
    .replace(/\s*\([^()]*@[^()]*\)\s*$/, '')
    .trim()
    .toLowerCase();
  return title ? 'subj:' + first.fromAddr.toLowerCase() + '|' + title : '';
}

const lastDate = (t: StoredThread): string => t.messages.reduce((d, m) => (m.date > d ? m.date : d), '');

/** Threads grouped into conversations, keyed by the lead (latest) thread id. Most groups hold one thread. */
export function conversationGroups(threads: StoredThread[]): Map<string, StoredThread[]> {
  const byKey = new Map<string, StoredThread[]>();
  const out = new Map<string, StoredThread[]>();
  for (const t of threads) {
    const k = calendarKey(t);
    if (!k) out.set(t.id, [t]);
    else (byKey.get(k) || byKey.set(k, []).get(k)!).push(t);
  }
  for (const group of byKey.values()) {
    group.sort((a, b) => lastDate(b).localeCompare(lastDate(a)));
    out.set(group[0].id, group);
  }
  return out;
}

/** One thread holding every message of a conversation, classified as its latest thread. */
const mergeGroup = (group: StoredThread[]): StoredThread =>
  group.length === 1 ? group[0] : { ...group[0], messages: group.flatMap((t) => t.messages) };

/** Whether a pulled busy block is the Google event `eid` (or one occurrence of it). */
const isGoogleEvent = (busyId: string, acctId: string, eid: string): boolean => {
  const gid = busyId.slice(('gcal-' + acctId + '-').length);
  return gid === eid || gid.startsWith(eid + '_') || eid.startsWith(gid + '_');
};

/**
 * `busy` is each account's pulled Google Calendar, when it has been synced. An interview
 * from a calendar invitation then follows Google: the email points at the event on the
 * calendar instead of adding a copy, and an invitation deleted or declined there is dropped.
 */
export function buildSnapshot(accounts: StoredAccount[], mails: Record<string, MailStore>, now: Date = new Date(), busy: Record<string, CalEvent[]> = {}): DataSnapshot {
  const colors = accountColors(accounts);
  const accts = accounts.map((a) => accountView(a, now, colors.get(a.id)));
  const emails: Email[] = [];
  const stageText = new Map<string, string>();
  for (const a of accounts) {
    const mail = mails[a.id];
    if (!mail) continue;
    for (const group of conversationGroups(Object.values(mail.threads)).values()) {
      const t = mergeGroup(group);
      const e = threadToEmail(a, t, now);
      if (!e) continue;
      emails.push(e);
      if (t.classification) stageText.set(e.id, t.classification.stage);
    }
  }
  emails.sort((a, b) => a.ago - b.ago);

  // Calendar events from confirmed interviews with a concrete time.
  const events: CalEvent[] = [];
  // Days safely inside the window the calendar sync pulls (now − 1 day to now + 60 days, by instant):
  // today to 59 days ahead, so an event near the window's edges is never mistaken for a deleted one.
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const windowStart = day(now.getTime());
  const windowEnd = day(now.getTime() + 59 * 86_400_000);
  for (const a of accounts) {
    const mail = mails[a.id];
    if (!mail) continue;
    for (const t of Object.values(mail.threads)) {
      const cls = t.classification;
      if (!cls?.event) continue;
      const id = a.id + ':' + t.id;
      const e = emails.find((x) => x.id === id);
      if (!e) continue;
      // A Google Calendar event id only means something on a Google calendar: an invitation sent to an
      // Outlook mailbox is a different event there.
      const gcal = a.provider === 'Gmail' && hasCalendar(a) ? busy[a.id] : undefined;
      const eid = gcal ? t.messages.map((m) => calendarEventId(m.bodyText)).find(Boolean) : '';
      // Inside the window the calendar sync covers, Google's copy is the truth.
      if (gcal && eid && cls.event.date >= windowStart && cls.event.date <= windowEnd) {
        const onCal = gcal.find((b) => isGoogleEvent(b.id, a.id, eid));
        e.evId = onCal?.id;
        if (!onCal) e.evRemoved = true;
        continue;
      }
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
        acct: a.id,
        added: false,
        rem: [1440, 60],
      });
    }
  }

  // Applications: one per company, stage from the most recent stage-defining email.
  const groups = new Map<string, Email[]>();
  for (const e of emails) {
    if (!e.company || e.cat === 'auto' || e.cat === 'review' || e.cat === 'other' || e.cat === 'sent' || e.archived) continue;
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
    .filter((e) => e.cat !== 'auto' && e.cat !== 'other' && e.cat !== 'sent')
    .slice(0, 8)
    .map((e) => ({
      text: (e.company || e.fromName) + ' ' + (PHRASE[e.cat] || 'sent a message'),
      time: relLabel(new Date(now.getTime() - e.ago * 60000).toISOString(), now),
      cls: 'cat-' + e.cat,
    }));

  return { accts, emails, apps, events, notifs, activity };
}
