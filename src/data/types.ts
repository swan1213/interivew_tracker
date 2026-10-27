/** Domain types for InterviewFlow AI. */

export type Cat =
  | 'action' | 'invite' | 'avail' | 'confirmed' | 'applied'
  | 'status' | 'rejected' | 'auto' | 'offer' | 'review' | 'sent' | 'other';
export type Pri = 'critical' | 'high' | 'normal' | 'low';
export type StageKey =
  | 'applied' | 'review' | 'screen' | 'sched' | 'confirmed'
  | 'tech' | 'final' | 'offer' | 'hired' | 'closed';
export type EvStage = 'screen' | 'tech' | 'mgr' | 'final' | 'offer' | 'busy';
export type IvStatus = 'none' | 'awaiting' | 'confirmed';
export type EmailMode = 'avail' | 'confirm' | 'resched' | 'assess';
export type Tone = 'professional' | 'friendly' | 'concise' | 'confident';
export type Tz = 'ET' | 'AST' | 'PT' | 'UTC';
export type Page = 'dash' | 'inbox' | 'cal' | 'track' | 'analytics' | 'accounts' | 'team' | 'settings';
/** Workspace role: admin manages roles, member uses everything else, guest sees Analytics only. */
export type Role = 'admin' | 'member' | 'guest';
export interface Member {
  id: string;
  name: string;
  /** Empty for the owner on a real workspace until they set one. */
  email: string;
  role: Role;
  /** Workspace owner from the server's ADMIN_EMAIL: always admin, cannot be removed. */
  owner?: boolean;
}
export type InboxView =
  | 'inbox' | 'action' | 'invite' | 'avail' | 'status'
  | 'applied' | 'offers' | 'rejected' | 'auto' | 'sent' | 'other';
export type CalView = 'month' | 'week' | 'day' | 'agenda';
export type SortKey = 'newest' | 'oldest' | 'priority' | 'deadline';
export type CompMode = 'reply' | 'replyall' | 'forward';
export type ThemePref = 'light' | 'dark' | 'auto';
export type ProviderKind = 'Gmail' | 'Outlook' | 'Google Workspace';

export interface Account {
  id: string;
  label: string;
  addr: string;
  provider: ProviderKind;
  color: string;
  initial: string;
  sendAs: string;
  sync: string;
  /** Google Calendar sync is allowed for this mailbox (undefined in the demo). */
  calendar?: boolean;
}

export interface Attachment { name: string; size: string }

export interface ThreadMsg {
  /** Mailbox message id, to load the original HTML on demand. */
  id?: string;
  from: string;
  addr: string;
  when: string;
  body: string;
  atts?: Attachment[];
  mine?: boolean;
  first?: boolean;
}

export interface Email {
  /** Everyone else in the conversation (lower-case addresses), for "all mail with this person". */
  peers?: string[];
  id: string;
  acct: string;
  fromName: string;
  fromAddr: string;
  company: string;
  role: string;
  recruiter: string;
  subject: string;
  /** Minutes since received, relative to the provider clock. */
  ago: number;
  /** Display time label. */
  time: string;
  cat: Cat;
  /** Secondary classification, if any. */
  sec: Cat | '';
  pri: Pri;
  /** AI confidence, 0-100. */
  conf: number;
  unread: boolean;
  starred: boolean;
  /** Needs an action from the user. */
  needs: boolean;
  ivStatus: IvStatus;
  stage: string;
  action: string;
  deadline: string;
  /** Sortable ISO date; '9999' when none. */
  deadlineKey: string;
  mode?: EmailMode;
  /** Number of time slots the recruiter asked for. */
  need?: number;
  /** Slot length in hours. */
  slotLen?: number;
  /** Dates the recruiter offered for availability. */
  windowDates?: string[];
  /** Reschedule options as [date, startHour]. */
  opts?: [string, number][];
  /** Linked calendar event id. */
  evId?: string;
  /** The calendar invitation this email is about was deleted or declined in Google Calendar. */
  evRemoved?: boolean;
  canReply: boolean;
  replyKind: string;
  summary: string;
  facts: string[];
  assumptions: string[];
  times: { label: string }[];
  atts?: Attachment[];
  body: string;
  thread: ThreadMsg[];
  /** User override of the AI category. */
  catOv?: Cat;
  done?: boolean;
  replied?: boolean;
  archived?: boolean;
}

export interface TimelineItem { text: string; when: string; src: string; cls: string }
export interface AiSuggestion { stage: StageKey; text: string }

export interface Application {
  id: string;
  co: string;
  role: string;
  stage: StageKey;
  applied: string;
  acct: string;
  pri: Pri;
  next: string;
  activity: string;
  action: string;
  emailId: string;
  notes: string;
  /** True once the user moved it manually; AI suggestions never override. */
  locked: boolean;
  ai: AiSuggestion | null;
  timeline: TimelineItem[];
  remind?: boolean;
}

export interface CalEvent {
  id: string;
  kind: 'interview' | 'busy';
  co: string;
  role: string;
  stage: EvStage;
  /** ISO date. */
  date: string;
  /** Start hour in ET, decimal. */
  start: number;
  end: number;
  platform?: string;
  link?: string;
  interviewer?: string;
  emailId?: string;
  /** Mailbox (and its Google Calendar) the event belongs to. */
  acct?: string;
  /** Google Calendar details, on busy blocks pulled from it. */
  location?: string;
  notes?: string;
  organizer?: string;
  attendees?: string[];
  htmlLink?: string;
  /** On the user's calendar. False means known from email but not added, or removed. */
  added: boolean;
  /** Reminder offsets in minutes. */
  rem?: number[];
  pendingNote?: string;
}

export interface Notif {
  id: string;
  title: string;
  text: string;
  time: string;
  unread: boolean;
  cat: Cat;
  emailId: string;
}

export interface ActivityItem { text: string; time: string; cls: string }

export type NotifKey =
  | 'newInvite' | 'avail' | 'confirm' | 'resched' | 'deadline' | 'offer'
  | 'browser' | 'desktop' | 'email';
export type AiKey = 'auto' | 'surfaceAuto' | 'showConf' | 'flagAssume';

export interface Settings {
  name: string;
  tz: Tz;
  /** 0 = Sunday … 6 = Saturday. */
  whDays: number[];
  whStart: string;
  whEnd: string;
  notif: Record<NotifKey, boolean>;
  rem: Record<string, boolean>;
  customRem: number;
  ai: Record<AiKey, boolean>;
  syncFreq: string;
}

export interface Slot { date: string; start: number }

export interface DataSnapshot {
  accts: Account[];
  emails: Email[];
  apps: Application[];
  events: CalEvent[];
  notifs: Notif[];
  activity: ActivityItem[];
  /** Interviews the app had put on Google Calendar that were deleted there; the app takes them off too. */
  calRemoved?: string[];
}

export interface OutgoingMessage {
  accountId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  /** Id of the conversation being answered. */
  inReplyTo?: string;
  mode?: CompMode;
}
