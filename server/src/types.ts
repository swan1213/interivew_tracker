import type { Cat, EmailMode, Pri } from '../../src/data/types';

/** A connected mailbox as stored on disk. Tokens are encrypted; never sent to the browser. */
export interface StoredAccount {
  id: string;
  email: string;
  name: string;
  provider: 'Gmail' | 'Outlook';
  color: string;
  initial: string;
  refreshToken: string;
  accessToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  lastSync: string | null;
  /** Changes whenever a sync changes the stored mail. */
  mailRev?: string;
  scopes: string[];
  /** Set when the provider refused the refresh token (expired or revoked); cleared by connecting again. */
  authError?: string;
}

export interface Attachment { name: string; size: string }

/** One Gmail message after parsing. */
export interface ParsedMessage {
  id: string;
  threadId: string;
  fromName: string;
  fromAddr: string;
  to: string;
  subject: string;
  /** ISO timestamp. */
  date: string;
  bodyText: string;
  atts: Attachment[];
  labelIds: string[];
  messageId: string;
  inReplyTo: string;
  references: string;
  /** Sent by the account owner. */
  isMine: boolean;
}

export interface TimeHit {
  /** ISO date. */
  date: string;
  /** Decimal hours in the source zone; undefined for date-only hits. */
  start?: number;
  end?: number;
  zone?: string;
  label: string;
  kind: 'meeting' | 'deadline' | 'original';
}

/** What the classifier (rules or Claude) says about one message. */
export interface Classification {
  classifier: 'rules' | 'claude';
  /** RULES_VERSION of the rules that produced a 'rules' classification. */
  rulesVersion?: number;
  jobRelated: boolean;
  cat: Cat;
  sec: Cat | '';
  pri: Pri;
  conf: number;
  company: string;
  role: string;
  recruiter: string;
  stage: string;
  action: string;
  deadline: string;
  /** ISO date or '9999' when none. */
  deadlineKey: string;
  needs: boolean;
  canReply: boolean;
  replyKind: string;
  mode?: EmailMode;
  need?: number;
  slotLen?: number;
  windowDates?: string[];
  opts?: [string, number][];
  summary: string;
  facts: string[];
  assumptions: string[];
  times: TimeHit[];
  platform?: string;
  link?: string;
  interviewer?: string;
  /** For a confirmed interview: the event in ET decimal hours. */
  event?: { date: string; start: number; end: number };
}

export interface StoredThread {
  id: string;
  messages: ParsedMessage[];
  /** Classification of the latest inbound message, keyed by that message's id. */
  classifiedId?: string;
  classification?: Classification;
  /** Classified by the rules only because a sync ran short of time; the model refines it on a later sync. */
  aiPending?: boolean;
}

/** What a sync needs to know to tell that nothing changed, without moving the whole mailbox. Ids are shortened. */
export interface SyncIndex {
  known: string[];
  /** Fetched once and dropped (not job related), so they are not refetched. */
  skipped: string[];
  /** Gmail's state of the stored mail at the last finished sync; empty when the next sync must look in the mailbox. */
  digest: string;
}

export interface MailStore {
  threads: Record<string, StoredThread>;
  /** From before the sync index; empty once an account has one. */
  skipped: string[];
  lastSync: string | null;
}
