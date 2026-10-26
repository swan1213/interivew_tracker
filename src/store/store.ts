import { create } from 'zustand';
import type {
  Account, ActivityItem, Application, CalEvent, CalView, Cat, CompMode, Email, InboxView, IvStatus,
  Member, Notif, Page, Pri, Role, Settings, Slot, SortKey, StageKey, ThemePref, ThreadMsg, Tone,
} from '@/data/types';
import { buildDemoData } from '@/data/demo';
import { provider, type SyncResult } from '@/data/provider';
import { runtime } from '@/data/runtime';
import { authApi, toMember } from '@/data/apiProvider';
import { CAT, DATA_KEY, DATA_VERSION, GRID_END_HOUR, GRID_START_HOUR, HOUR_PX, PREFS_KEY, stageLabel } from '@/data/constants';
import { genText, type ReplyOpts } from '@/lib/reply';
import { forwardBlock, inView, isNoReply, replyRecipients, replySubject, type RangeFilter } from '@/lib/mail';
import { activeEvents, conflictOf } from '@/lib/calendar';
import { fmtT, lab, rel, tzOffset } from '@/lib/time';
import { parseSlotKey, type SchedMode } from '@/lib/schedule';
import { loadJSON, removeKey, saveJSON } from '@/lib/storage';
import {
  canManageRoles, canSee, currentRole, homePage, newMemberError, removeMemberError, restoreMeId, restoreMembers, roleChangeError, roleMeta, upsertMember,
} from '@/lib/roles';
import { mergeSnapshot } from './merge';
import { startCalendarSync } from './calendarSync';
import { parsePath } from './nav';

export type ConfirmKind = '' | 'disconnect' | 'clear' | 'removeEv' | 'removeMember';
export interface Confirm { kind: ConfirmKind; title: string; body: string; label: string; arg: string }
export interface Mods { short: boolean; prof: boolean }

export interface Data {
  emails: Email[];
  apps: Application[];
  events: CalEvent[];
  accts: Account[];
  notifs: Notif[];
  activity: ActivityItem[];
}
interface Prefs { themePref: ThemePref; collapsed: boolean; S: Settings; tone: Tone; members?: Member[]; meId?: string }

export interface StateFields extends Data {
  today: string;
  nowHour: number;
  page: Page;
  view: InboxView;
  // inbox
  selId: string;
  acctFilter: string;
  catFilter: Cat | 'all';
  priFilter: Pri | 'all';
  coFilter: string;
  /** Only conversations with this address, sent or received ('' = everyone). */
  peer: string;
  rangeFilter: RangeFilter;
  rangeFrom: string;
  rangeTo: string;
  ivFilter: 'all' | IvStatus;
  sortKey: SortKey;
  unreadOnly: boolean;
  actionOnly: boolean;
  savedKey: string;
  q: string;
  insOpen: boolean;
  // reply assistant
  tone: Tone;
  variant: number;
  mods: Mods;
  aiDraft: string;
  chosen: Slot[];
  // composer
  compOpen: boolean;
  compMode: CompMode;
  compFrom: string;
  compTo: string;
  compText: string;
  sendOpen: boolean;
  // dialogs
  schedOpen: boolean;
  schedMode: SchedMode;
  schedSel: string[];
  addCalOpen: boolean;
  addCalEv: string;
  cfOpen: boolean;
  cf: Confirm;
  addAcctOpen: boolean;
  toast: string;
  notifOpen: boolean;
  acMenuOpen: boolean;
  syncing: boolean;
  // calendar
  calView: CalView;
  calDate: string;
  calSel: string;
  // tracker
  appSel: string;
  overCol: string;
  // analytics
  anRange: string;
  anAcct: string;
  // prefs
  themePref: ThemePref;
  sysDark: boolean;
  collapsed: boolean;
  /** True while a server snapshot is being loaded. */
  loading: boolean;
  S: Settings;
  // team and roles
  members: Member[];
  /** The member using the app on this device. */
  meId: string;
  userMenuOpen: boolean;
}

export interface Actions {
  patch: (p: Partial<StateFields>) => void;
  /** Show a short message at the bottom of the screen. */
  say: (msg: string) => void;
  /** Pull the latest snapshot from the provider and merge it with local workflow state. */
  hydrate: () => Promise<void>;
  go: (page: Page, p?: Partial<StateFields>) => void;
  openView: (view: InboxView) => void;
  openEmail: (id: string) => void;
  toggleStar: (id: string) => void;
  archive: (id: string, nextId: string) => void;
  reclassify: (cat: Cat) => void;
  toggleIns: () => void;
  clearFilters: () => void;
  setSearch: (q: string) => void;
  /** Show every conversation with one address, like searching it in Gmail ('' clears). */
  showPeer: (addr: string) => void;
  pickTone: (tone: Tone) => void;
  genReply: () => void;
  regen: () => void;
  shorter: () => void;
  moreProf: () => void;
  insertDraft: () => void;
  openComp: (mode: CompMode) => void;
  closeComp: () => void;
  askSend: () => void;
  closeSend: () => void;
  confirmSend: () => void;
  openSched: (mode: SchedMode) => void;
  closeSched: () => void;
  toggleSlot: (key: string) => void;
  genSchedReply: () => void;
  openAddCal: (evId: string) => void;
  closeAddCal: () => void;
  confirmAddCal: () => void;
  ask: (kind: ConfirmKind, title: string, body: string, label: string, arg?: string) => void;
  closeCf: () => void;
  confirmCf: () => void;
  moveApp: (id: string, stage: StageKey, lock: boolean) => void;
  dismissAi: (id: string) => void;
  setAppNotes: (id: string, notes: string) => void;
  toggleAppRemind: (id: string) => void;
  setOverCol: (k: string) => void;
  dropEventAt: (date: string, yPx: number) => void;
  toggleReminder: (evId: string, minutes: number) => void;
  renameEvent: (evId: string, co: string) => void;
  shiftEvent: (evId: string, dir: -1 | 1) => void;
  refreshAll: () => void;
  /** Quiet sync in the background: no skeletons, no toast unless new mail arrived, errors ignored. */
  autoSync: () => Promise<void>;
  refreshAccount: (id: string) => void;
  addAccount: (kind: 'Gmail' | 'Outlook') => void;
  markAllNotifs: () => void;
  openNotif: (id: string) => void;
  setThemePref: (p: ThemePref) => void;
  toggleTheme: () => void;
  toggleSide: () => void;
  setS: (fn: (s: Settings) => void) => void;
  setTone: (tone: Tone) => void;
  showToast: (msg: string) => void;
  addAct: (text: string, cls?: string) => void;
  resetDemo: () => void;
  /** Use the app as another member. Stands in for sign-in until the server identifies users. */
  switchUser: (id: string) => void;
  /** Admin only. Resolves '' on success or a validation / server message. */
  addMember: (name: string, email: string, role: Role) => Promise<string>;
  /** Admin only. Refuses to remove the last admin. */
  setMemberRole: (id: string, role: Role) => void;
  /** Admin, signed-in workspace: fetch the team from the server. */
  loadTeam: () => Promise<void>;
  /** Signed-in workspace: end the session and return to the sign-in screen. */
  signOut: () => void;
}

export type AppState = StateFields & Actions;

export const DEFAULT_SETTINGS: Settings = {
  name: 'Jordan Lee',
  tz: 'ET',
  whDays: [1, 2, 3, 4, 5],
  whStart: '09:00',
  whEnd: '18:00',
  notif: { newInvite: true, avail: true, confirm: true, resched: true, deadline: true, offer: true, browser: false, desktop: false, email: false },
  rem: { '1440': true, '60': true, '30': false, '10': false },
  customRem: 15,
  ai: { auto: true, surfaceAuto: true, showConf: true, flagAssume: true },
  syncFreq: '5',
};

const NO_MODS: Mods = { short: false, prof: false };
const NO_CF: Confirm = { kind: '', title: '', body: '', label: '', arg: '' };

/** Drag payloads live outside React state: they change many times per second and never render. */
export const drag = { app: '', ev: '' };

let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** Off while signing out, so the cache just cleared is not written back. */
let persistOn = true;

const EMPTY_DATA: Data = { emails: [], apps: [], events: [], accts: [], notifs: [], activity: [] };
/** Demo and real mail never share a cache, and each signed-in person has their own. */
const dataKey = () => DATA_KEY + '.' + provider.id + (runtime.user ? '.' + runtime.user.email : '');

/** Saved settings, minus a saved copy of the old default window (10:30–16:30) so the current default (9:00–18:00 ET) applies. */
function savedSettings(saved: Partial<Settings> | undefined): Partial<Settings> {
  const s = { ...(saved || {}) };
  if (s.whStart === '10:30' && s.whEnd === '16:30') {
    delete s.whStart;
    delete s.whEnd;
  }
  return s;
}

function initialFields(): StateFields {
  const clock = provider.clock();
  removeKey(DATA_KEY); // pre-provider cache key from the first release
  const saved = loadJSON<{ v: number } & Data>(dataKey());
  const data: Data = saved && saved.v === DATA_VERSION && Array.isArray(saved.emails) ? saved : provider.isDemo ? buildDemoData() : EMPTY_DATA;
  const prefs = loadJSON<Partial<Prefs>>(PREFS_KEY) || {};
  const route = typeof window !== 'undefined' ? parsePath(window.location.pathname) : { page: 'dash' as Page };
  const S = { ...DEFAULT_SETTINGS, ...savedSettings(prefs.S) };
  // Signed in, the demo's sample name gives way to yours: it signs reply drafts.
  if (runtime.user && (!S.name.trim() || S.name === DEFAULT_SETTINGS.name)) S.name = runtime.user.name || runtime.user.email.split('@')[0];
  // Signed in: the server says who you are and what role you have. Demo: the locally saved team.
  const members = runtime.user ? [toMember(runtime.user)] : restoreMembers(prefs.members, S.name, provider.isDemo);
  const meId = runtime.user ? runtime.user.email : restoreMeId(prefs.meId, members);
  const role = currentRole({ members, meId });
  return {
    emails: data.emails, apps: data.apps, events: data.events, accts: data.accts, notifs: data.notifs, activity: data.activity,
    today: clock.today, nowHour: clock.nowHour,
    page: canSee(role, route.page) ? route.page : homePage(role), view: route.view ?? 'inbox',
    selId: provider.isDemo ? 'e1' : data.emails[0]?.id ?? '', acctFilter: 'all', catFilter: 'all', priFilter: 'all', coFilter: 'all', peer: '', rangeFilter: 'all', rangeFrom: '', rangeTo: '', ivFilter: 'all',
    sortKey: 'newest', unreadOnly: false, actionOnly: false, savedKey: '', q: '', insOpen: true,
    tone: prefs.tone ?? 'professional', variant: 0, mods: NO_MODS, aiDraft: '', chosen: [],
    compOpen: false, compMode: 'reply', compFrom: data.accts[0]?.id ?? '', compTo: '', compText: '', sendOpen: false,
    schedOpen: false, schedMode: 'avail', schedSel: [], addCalOpen: false, addCalEv: '', cfOpen: false, cf: NO_CF, addAcctOpen: false,
    toast: '', notifOpen: false, acMenuOpen: false, syncing: false,
    calView: route.calView ?? 'week', calDate: clock.today, calSel: '',
    appSel: '', overCol: '', anRange: '30', anAcct: 'all',
    themePref: prefs.themePref ?? 'light', sysDark: false, collapsed: prefs.collapsed ?? false,
    loading: !provider.isDemo && !saved,
    S,
    members, meId, userMenuOpen: false,
  };
}

let autoSyncing = false;

/** Rounds one sync keeps going while older mail is still waiting, so a first sync fills in the whole window. */
const MAX_SYNC_ROUNDS = 40;

export const useStore = create<AppState>()((set, get) => {
  const mapEmail = (id: string, fn: (e: Email) => Partial<Email>) =>
    set((s) => ({ emails: s.emails.map((e) => (e.id === id ? { ...e, ...fn(e) } : e)) }));
  const mapEvent = (id: string, fn: (v: CalEvent) => Partial<CalEvent>) =>
    set((s) => ({ events: s.events.map((v) => (v.id === id ? { ...v, ...fn(v) } : v)) }));
  const mapApp = (id: string, fn: (a: Application) => Partial<Application>) =>
    set((s) => ({ apps: s.apps.map((a) => (a.id === id ? { ...a, ...fn(a) } : a)) }));

  const showToast = (msg: string) => {
    set({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: '' }), 2800);
  };
  const addAct = (text: string, cls = 'cat-status') =>
    set((s) => ({ activity: [{ text, time: 'Just now', cls }, ...s.activity].slice(0, 8) }));

  const emailOf = (s: StateFields, id: string) => s.emails.find((e) => e.id === id);
  const acctOf = (s: StateFields, id: string) => s.accts.find((a) => a.id === id) || s.accts[0];
  const replyOpts = (s: StateFields, over: Partial<ReplyOpts> = {}): ReplyOpts => {
    const e = emailOf(s, s.selId);
    const ev = e?.evId ? s.events.find((v) => v.id === e.evId) ?? null : null;
    return {
      tone: s.tone, variant: s.variant, mods: s.mods, chosen: s.chosen,
      name: s.S.name, whStart: s.S.whStart, whEnd: s.S.whEnd, tz: s.S.tz, ev, today: s.today,
      ...over,
    };
  };
  /**
   * Sync, then keep syncing while the server reports older conversations still
   * waiting, reloading after each round so mail appears as it arrives.
   */
  const syncAll = async (accountId?: string): Promise<SyncResult> => {
    let newMessages = 0;
    for (let round = 0; ; round++) {
      const r = await provider.sync(accountId);
      newMessages += r.newMessages;
      if (!provider.isDemo) await get().hydrate();
      const left = (r.pending || 0) + (r.refining || 0);
      if (r.errors?.length || !left || round + 1 >= MAX_SYNC_ROUNDS) return { ...r, newMessages };
      const n = (k: number) => k + ' conversation' + (k === 1 ? '' : 's');
      showToast(r.pending ? 'Loading older mail: ' + n(r.pending) + ' to go…' : 'All mail loaded. AI is reviewing ' + n(r.refining || 0) + '…');
    }
  };

  const draftFor = (s: StateFields, over: Partial<ReplyOpts> = {}) => genText(emailOf(s, s.selId), replyOpts(s, over));

  return {
    ...initialFields(),

    patch: (p) => set(p),
    say: (msg) => showToast(msg),
    hydrate: async () => {
      if (provider.isDemo) return;
      // Placeholders only on the first load; later reloads swap the data in place.
      if (!get().accts.length) set({ loading: true });
      try {
        const [snap, me] = await Promise.all([provider.load(), authApi.me().catch(() => null)]);
        set((s) => ({
          ...mergeSnapshot(s, snap), loading: false, compFrom: s.compFrom || snap.accts[0]?.id || '',
          // Pick up a role change made by an admin since this page loaded.
          ...(me ? { members: upsertMember(s.members, toMember(me.user)), meId: me.user.email } : {}),
        }));
      } catch (err) {
        set({ loading: false });
        showToast('Could not load mail: ' + (err as Error).message);
      }
    },
    go: (page, p = {}) => set({ notifOpen: false, acMenuOpen: false, userMenuOpen: false, page, ...p }),
    openView: (view) => set({ notifOpen: false, acMenuOpen: false, page: 'inbox', view, savedKey: '' }),

    openEmail: (id) => {
      const s = get();
      const e = emailOf(s, id);
      const keepView = e ? inView(e, s.view) : true;
      set({
        selId: id, page: 'inbox', view: keepView ? s.view : 'inbox', savedKey: keepView ? s.savedKey : '',
        compOpen: false, aiDraft: '', variant: 0, mods: NO_MODS, chosen: [], notifOpen: false, acMenuOpen: false,
        emails: s.emails.map((x) => (x.id === id ? { ...x, unread: false } : x)),
      });
      if (e?.unread) void provider.markRead?.(id).catch(() => undefined);
    },
    toggleStar: (id) => {
      const e = emailOf(get(), id);
      if (!e) return;
      mapEmail(id, (x) => ({ starred: !x.starred }));
      void provider.setStar?.(id, !e.starred).catch(() => showToast('Could not update the star in Gmail.'));
    },
    archive: (id, nextId) => {
      mapEmail(id, () => ({ archived: true }));
      set({ selId: nextId, compOpen: false, aiDraft: '' });
      void provider.archive?.(id).catch(() => showToast('Could not archive in Gmail.'));
      showToast('Archived.');
    },
    reclassify: (cat) => {
      const s = get();
      mapEmail(s.selId, () => ({ catOv: cat, conf: 100 }));
      showToast('Reclassified as ' + CAT[cat].l + '. Your choice overrides the AI.');
    },
    toggleIns: () => set((s) => ({ insOpen: !s.insOpen })),
    clearFilters: () =>
      set((s) =>
        s.emails.length === 0
          ? { emails: buildDemoData().emails, selId: 'e1' }
          : { acctFilter: 'all', catFilter: 'all', priFilter: 'all', coFilter: 'all', peer: '', rangeFilter: 'all', rangeFrom: '', rangeTo: '', ivFilter: 'all', unreadOnly: false, actionOnly: false, savedKey: '', q: '' },
      ),
    setSearch: (q) => set({ q, page: 'inbox', view: 'inbox', savedKey: '' }),
    showPeer: (addr) => set({ peer: addr.trim().toLowerCase(), page: 'inbox', view: 'inbox', savedKey: '', q: '' }),

    // ---- reply assistant ----
    pickTone: (tone) =>
      set((s) => {
        const mods = { short: s.mods.short, prof: false };
        return { tone, mods, aiDraft: s.aiDraft ? draftFor(s, { tone, mods }) : '' };
      }),
    genReply: () => set((s) => ({ aiDraft: draftFor(s) })),
    regen: () => set((s) => ({ variant: s.variant + 1, aiDraft: draftFor(s, { variant: s.variant + 1 }) })),
    shorter: () =>
      set((s) => {
        const mods = { short: true, prof: s.mods.prof };
        return { mods, aiDraft: draftFor(s, { mods }) };
      }),
    moreProf: () =>
      set((s) => {
        const mods = { short: s.mods.short, prof: true };
        return { mods, aiDraft: draftFor(s, { mods }) };
      }),
    insertDraft: () => {
      const s = get();
      const e = emailOf(s, s.selId);
      set({ compOpen: true, compMode: 'reply', compFrom: e ? e.acct : s.compFrom, compTo: e ? e.fromAddr : s.compTo, compText: s.aiDraft });
      showToast('Inserted into the composer. Review before sending.');
    },

    // ---- composer ----
    openComp: (mode) => {
      const s = get();
      const e = emailOf(s, s.selId);
      if (!e) return;
      if (mode !== 'forward' && isNoReply(e.fromAddr)) {
        showToast('This is a no-reply address. Replies are not monitored.');
        return;
      }
      const me = acctOf(s, e.acct)?.addr || '';
      const fwd = mode === 'forward';
      set({
        compOpen: true, compMode: mode, compFrom: e.acct,
        compTo: fwd ? '' : replyRecipients(e, mode === 'replyall', me),
        compText: fwd ? forwardBlock(e) : s.compMode === 'forward' ? '' : s.compText || s.aiDraft || '',
      });
    },
    closeComp: () => set({ compOpen: false, compTo: '', compText: '' }),
    askSend: () => set({ sendOpen: true }),
    closeSend: () => set({ sendOpen: false }),
    confirmSend: () => {
      const s = get();
      const e = emailOf(s, s.selId);
      if (!e || !s.compText.trim()) return;
      // A reply with the To field left empty goes back to the sender.
      const to = s.compTo.trim() || (s.compMode === 'forward' ? '' : e.fromAddr);
      if (!to) {
        set({ sendOpen: false });
        showToast('Add a recipient first.');
        return;
      }
      const ac = acctOf(s, s.compFrom);
      const co = e.company;
      const fwd = s.compMode === 'forward';
      const subject = replySubject(e.subject, fwd);
      provider
        .send({ accountId: ac.id, from: ac.addr, to, subject, body: s.compText, inReplyTo: e.id, mode: s.compMode })
        .then(() => {
          if (!provider.isDemo) void get().hydrate();
        })
        .catch((err: Error) => showToast('Sending failed: ' + err.message));

      // A forward starts a new conversation with someone else: this one is not answered by it.
      if (fwd) {
        set({ sendOpen: false, compOpen: false, compTo: '', compText: '' });
        addAct('You forwarded "' + e.subject + '" to ' + to, 'cat-sent');
        showToast('Forwarded to ' + to + ' from ' + ac.addr + '.' + (provider.isDemo ? ' Demo only, nothing was delivered.' : ''));
        return;
      }
      const msg: ThreadMsg = { from: 'You (' + s.S.name + ')', addr: ac.addr, when: 'Just now', body: s.compText, mine: true, atts: [] };
      let toast = 'Reply sent from ' + ac.addr + '.' + (provider.isDemo ? ' Demo only, nothing was delivered.' : '');
      const patch: Partial<Email> = { thread: e.thread.concat([msg]), done: true, replied: true };
      if (e.mode === 'avail') {
        patch.ivStatus = 'awaiting';
        toast = 'Availability sent. Status: Awaiting confirmation (not marked confirmed).';
      }
      if (e.mode === 'resched') {
        patch.ivStatus = 'awaiting';
        toast = 'Reschedule choice sent. Original time stays until ' + (co || 'the recruiter') + ' confirms.';
      }
      let apps = s.apps;
      let events = s.events;
      if (e.mode === 'avail') {
        apps = apps.map((a) => (a.co === co ? { ...a, stage: 'sched' as StageKey, next: 'Awaiting confirmation (you sent availability)', activity: 'You replied, just now', ai: null } : a));
      }
      if (e.mode === 'resched') {
        apps = apps.map((a) => (a.co === co ? { ...a, stage: 'sched' as StageKey, next: 'Awaiting confirmation of new time', activity: 'You replied, just now', ai: null } : a));
        events = events.map((v) => (v.id === e.evId ? { ...v, pendingNote: 'Awaiting ' + (co || 'the recruiter') + ' to confirm the new time' } : v));
      }
      set({
        emails: s.emails.map((x) => (x.id === e.id ? { ...x, ...patch } : x)),
        apps, events, sendOpen: false, compOpen: false, compText: '', aiDraft: '', chosen: [],
      });
      addAct('You replied to ' + (co || e.fromName), 'cat-confirmed');
      showToast(toast);
    },

    // ---- scheduling dialog ----
    openSched: (mode) => set({ schedOpen: true, schedMode: mode, schedSel: [] }),
    closeSched: () => set({ schedOpen: false }),
    toggleSlot: (key) => {
      const s = get();
      const e = emailOf(s, s.selId);
      const need = s.schedMode === 'resched' ? 1 : e?.need || 1;
      if (s.schedMode === 'resched') {
        set({ schedSel: [key] });
        return;
      }
      if (s.schedSel.includes(key)) set({ schedSel: s.schedSel.filter((k) => k !== key) });
      else if (s.schedSel.length >= need) showToast('Select up to ' + need + ' times. Deselect one first.');
      else set({ schedSel: s.schedSel.concat([key]) });
    },
    genSchedReply: () => {
      const s = get();
      const e = emailOf(s, s.selId);
      const chosen: Slot[] = s.schedSel.map(parseSlotKey).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
      const text = draftFor(s, { chosen, variant: 0, mods: NO_MODS });
      set({ schedOpen: false, chosen, compOpen: true, compMode: 'reply', compFrom: e ? e.acct : s.compFrom, compTo: e ? e.fromAddr : s.compTo, compText: text, aiDraft: text, variant: 0, mods: NO_MODS });
      showToast('Reply drafted. Review it, then send. Nothing is confirmed yet.');
    },

    // ---- add to calendar ----
    openAddCal: (evId) => set({ addCalOpen: true, addCalEv: evId }),
    closeAddCal: () => set({ addCalOpen: false }),
    confirmAddCal: () => {
      const s = get();
      const ev = s.events.find((x) => x.id === s.addCalEv);
      if (!ev) {
        set({ addCalOpen: false });
        return;
      }
      set({
        addCalOpen: false,
        calSel: ev.id,
        events: s.events.map((v) => (v.id === ev.id ? { ...v, added: true } : v)),
        apps: s.apps.map((a) => (a.co === ev.co ? { ...a, next: rel(ev.date, s.today) + ', ' + fmtT(ev.start) + ' ET', activity: 'Added to calendar, just now' } : a)),
        emails: s.emails.map((x) => (x.id === ev.emailId ? { ...x, done: true, ivStatus: 'confirmed' as IvStatus } : x)),
      });
      addAct('You added the ' + ev.co + ' interview to your calendar', 'cat-confirmed');
      showToast('Added to calendar. Reminders are active.');
    },

    // ---- confirmations ----
    ask: (kind, title, body, label, arg = '') => set({ cfOpen: true, cf: { kind, title, body, label, arg } }),
    closeCf: () => set({ cfOpen: false }),
    confirmCf: () => {
      const s = get();
      const cf = s.cf;
      if (cf.kind === 'disconnect') {
        const id = cf.arg;
        provider
          .disconnectAccount(id)
          .then(() => {
            if (!provider.isDemo) void get().hydrate();
          })
          .catch((err: Error) => showToast('Disconnect failed on the server: ' + err.message));
        set({
          accts: s.accts.filter((a) => a.id !== id),
          emails: s.emails.filter((e) => e.acct !== id),
          acctFilter: s.acctFilter === id ? 'all' : s.acctFilter,
          anAcct: s.anAcct === id ? 'all' : s.anAcct,
          compFrom: s.compFrom === id ? (s.accts.find((a) => a.id !== id)?.id ?? '') : s.compFrom,
          cfOpen: false,
        });
        showToast('Account disconnected and its synced mail removed' + (provider.isDemo ? ' (demo).' : '.'));
      } else if (cf.kind === 'clear') {
        set({ emails: [], cfOpen: false, selId: '' });
        showToast('Synced demo mail deleted. Open the inbox to restore it.');
      } else if (cf.kind === 'removeEv') {
        set({ events: s.events.map((v) => (v.id === cf.arg ? { ...v, added: false } : v)), cfOpen: false, calSel: '' });
        showToast('Removed from your calendar.');
      } else if (cf.kind === 'removeMember') {
        const m = s.members.find((x) => x.id === cf.arg);
        const err = canManageRoles(currentRole(s)) ? removeMemberError(s.members, cf.arg, s.meId) : 'Only admins can remove people.';
        const gone = (m ? m.name : 'That person') + ' was removed from the team.';
        if (err || provider.isDemo || !m) {
          set(err ? { cfOpen: false } : { members: s.members.filter((x) => x.id !== cf.arg), cfOpen: false });
          showToast(err || gone);
        } else {
          set({ cfOpen: false });
          authApi
            .removeMember(m.email)
            .then((r) => {
              set({ members: r.team.map(toMember) });
              showToast(gone);
            })
            .catch((e: Error) => showToast(e.message));
        }
      } else {
        set({ cfOpen: false });
      }
    },

    // ---- tracker ----
    moveApp: (id, stage, lock) => {
      const a = get().apps.find((x) => x.id === id);
      if (!a || a.stage === stage) return;
      const lbl = stageLabel(stage);
      mapApp(id, (x) => ({
        stage, locked: lock, ai: null,
        timeline: [{ text: 'Moved to ' + lbl, when: 'Just now', src: lock ? 'You (manual, kept)' : 'AI suggestion accepted', cls: 'cat-confirmed' }, ...x.timeline],
      }));
      showToast(a.co + ' moved to ' + lbl + (lock ? '. Your override is preserved.' : '.'));
      addAct(a.co + ' moved to ' + lbl, 'cat-status');
    },
    dismissAi: (id) => {
      mapApp(id, () => ({ ai: null }));
      showToast('AI suggestion dismissed.');
    },
    setAppNotes: (id, notes) => mapApp(id, () => ({ notes })),
    toggleAppRemind: (id) => {
      const a = get().apps.find((x) => x.id === id);
      if (!a) return;
      mapApp(id, (x) => ({ remind: !x.remind }));
      showToast(a.remind ? 'Reminder removed.' : 'Reminder set for tomorrow, 9:00 AM.');
    },
    setOverCol: (k) => {
      if (get().overCol !== k) set({ overCol: k });
    },

    // ---- calendar ----
    dropEventAt: (date, yPx) => {
      const id = drag.ev;
      drag.ev = '';
      if (!id) return;
      const s = get();
      const v = s.events.find((x) => x.id === id);
      if (!v) return;
      const dur = v.end - v.start;
      let start = Math.round((GRID_START_HOUR + yPx / HOUR_PX) * 2) / 2;
      start = Math.max(GRID_START_HOUR, Math.min(GRID_END_HOUR - dur, start));
      const events = s.events.map((x) => (x.id === id ? { ...x, date, start, end: start + dur } : x));
      const moved = events.find((x) => x.id === id);
      const c = moved ? conflictOf(moved, activeEvents(events)) : null;
      set({ events, calSel: id });
      showToast(c ? 'Moved, but it now conflicts with ' + c.co + '.' : 'Moved to ' + lab(date) + ', ' + fmtT(start + tzOffset(s.S.tz)) + '. Reminders updated.');
    },
    toggleReminder: (evId, m) =>
      mapEvent(evId, (x) => {
        const rem = x.rem || [];
        return { rem: rem.includes(m) ? rem.filter((r) => r !== m) : rem.concat([m]) };
      }),
    renameEvent: (evId, co) => mapEvent(evId, () => ({ co })),
    shiftEvent: (evId, dir) =>
      mapEvent(evId, (x) =>
        dir < 0
          ? { start: Math.max(GRID_START_HOUR, x.start - 0.5), end: Math.max(GRID_START_HOUR + 0.5, x.end - 0.5) }
          : { start: Math.min(GRID_END_HOUR - 1, x.start + 0.5), end: Math.min(GRID_END_HOUR, x.end + 0.5) },
      ),

    // ---- accounts & sync ----
    refreshAll: () => {
      set({ syncing: true });
      syncAll()
        .then(async (r) => {
          set({ syncing: false });
          const n = get().accts.length;
          if (r.errors?.length) {
            showToast('Sync problem: ' + r.errors[0]);
            return;
          }
          if (n === 0 && !provider.isDemo) {
            showToast('No accounts connected yet. Add one in Connected Accounts.');
            return;
          }
          const fresh = r.newMessages ? r.newMessages + ' new message' + (r.newMessages === 1 ? '' : 's') + '.' : 'No new ' + (provider.isDemo ? 'demo ' : '') + 'mail.';
          showToast(n + ' account' + (n === 1 ? '' : 's') + ' synced. ' + fresh);
        })
        .catch((err: Error) => {
          set({ syncing: false });
          showToast('Sync failed: ' + err.message);
        });
    },
    autoSync: async () => {
      if (provider.isDemo || get().syncing || autoSyncing) return;
      autoSyncing = true;
      try {
        const r = await syncAll();
        if (r.newMessages) showToast(r.newMessages + ' new message' + (r.newMessages === 1 ? '' : 's') + ' synced.');
      } catch {
        /* the Sync button reports problems; background syncs stay quiet */
      } finally {
        autoSyncing = false;
      }
    },
    refreshAccount: (id) => {
      const a = get().accts.find((x) => x.id === id);
      if (!a) return;
      set((s) => ({ accts: s.accts.map((x) => (x.id === id ? { ...x, sync: 'Syncing…' } : x)) }));
      syncAll(id)
        .then((r) => {
          set((s) => ({ accts: s.accts.map((x) => (x.id === id ? { ...x, sync: 'Synced just now' } : x)) }));
          showToast(r.errors?.length ? 'Sync problem: ' + r.errors[0] : a.label + ' synced.');
        })
        .catch((err: Error) => {
          set((s) => ({ accts: s.accts.map((x) => (x.id === id ? { ...x, sync: 'Sync failed' } : x)) }));
          showToast('Sync failed: ' + err.message);
        });
    },
    addAccount: (kind) => {
      const s = get();
      provider
        .connectAccount(kind, s.accts, s.S.name)
        .then((a) => {
          if (!a) return; // the provider navigated to the sign-in page
          set((st) => ({ accts: st.accts.concat([a]), addAcctOpen: false }));
          showToast(provider.isDemo ? 'Fictional ' + kind + ' account added. No real sign-in occurred.' : a.addr + ' connected.');
        })
        .catch((err: Error) => showToast(err.message || 'Could not connect the account.'));
    },

    // ---- notifications ----
    markAllNotifs: () => set((s) => ({ notifs: s.notifs.map((n) => ({ ...n, unread: false })) })),
    openNotif: (id) => {
      const s = get();
      const n = s.notifs.find((x) => x.id === id);
      set({ notifs: s.notifs.map((x) => (x.id === id ? { ...x, unread: false } : x)), notifOpen: false });
      if (n) get().openEmail(n.emailId);
    },

    // ---- preferences ----
    setThemePref: (p) => set({ themePref: p }),
    toggleTheme: () =>
      set((s) => ({ themePref: s.themePref === 'dark' || (s.themePref === 'auto' && s.sysDark) ? 'light' : 'dark' })),
    toggleSide: () => set((s) => ({ collapsed: !s.collapsed })),
    setS: (fn) =>
      set((s) => {
        const S: Settings = JSON.parse(JSON.stringify(s.S));
        fn(S);
        return { S };
      }),
    setTone: (tone) => set({ tone }),
    showToast,
    addAct,
    resetDemo: () => {
      if (!provider.isDemo) return;
      const d = buildDemoData();
      set({ ...d, selId: 'e1', acctFilter: 'all', anAcct: 'all', calSel: '', appSel: '', compOpen: false, aiDraft: '', compFrom: d.accts[0].id });
      showToast('Demo workspace restored.');
    },

    // ---- team and roles ----
    switchUser: (id) => {
      if (!provider.isDemo) return; // signed-in workspaces switch by signing out and in
      const s = get();
      const m = s.members.find((x) => x.id === id);
      if (!m) return;
      set({
        meId: id, page: canSee(m.role, s.page) ? s.page : homePage(m.role),
        userMenuOpen: false, notifOpen: false, acMenuOpen: false, compOpen: false, sendOpen: false, schedOpen: false, addCalOpen: false, cfOpen: false, addAcctOpen: false,
        appSel: '', calSel: '',
      });
      showToast('Now using the workspace as ' + m.name + ' (' + roleMeta(m.role).l + ').');
    },
    addMember: async (name, email, role) => {
      const s = get();
      if (!canManageRoles(currentRole(s))) return 'Only admins can add people.';
      const err = newMemberError(s.members, name, email);
      if (err) return err;
      if (provider.isDemo) {
        const id = 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        set({ members: s.members.concat([{ id, name: name.trim(), email: email.trim().toLowerCase(), role }]) });
      } else {
        try {
          const r = await authApi.addMember(name.trim(), email.trim(), role);
          set({ members: r.team.map(toMember) });
        } catch (e) {
          return (e as Error).message;
        }
      }
      showToast(name.trim() + ' added as ' + roleMeta(role).l.toLowerCase() + '.');
      return '';
    },
    setMemberRole: (id, role) => {
      const s = get();
      if (!canManageRoles(currentRole(s))) {
        showToast('Only admins can change roles.');
        return;
      }
      const err = roleChangeError(s.members, id, role);
      if (err) {
        showToast(err);
        return;
      }
      const m = s.members.find((x) => x.id === id)!;
      if (m.role === role) return;
      const done = () => showToast(m.name + ' is now ' + (role === 'admin' ? 'an ' : 'a ') + roleMeta(role).l.toLowerCase() + '.');
      if (provider.isDemo) {
        set({ members: s.members.map((x) => (x.id === id ? { ...x, role } : x)) });
        done();
        return;
      }
      authApi
        .setRole(m.email, role)
        .then((r) => {
          set({ members: r.team.map(toMember) });
          done();
        })
        .catch((e: Error) => showToast(e.message));
    },
    loadTeam: async () => {
      if (provider.isDemo || !canManageRoles(currentRole(get()))) return;
      try {
        const r = await authApi.team();
        set({ members: r.team.map(toMember) });
      } catch (e) {
        showToast('Could not load the team: ' + (e as Error).message);
      }
    },
    signOut: () => {
      if (provider.isDemo) return;
      persistOn = false;
      removeKey(dataKey());
      void authApi
        .logout()
        .catch(() => undefined)
        .finally(() => window.location.assign('/'));
    },
  };
});

/* A user never stays on a page their role may not see, however the page was set. */
useStore.subscribe((s) => {
  const role = currentRole(s);
  if (!canSee(role, s.page)) useStore.setState({ page: homePage(role) });
});

/* ---- persistence and system theme (browser only) ---- */
if (typeof window !== 'undefined') {
  let t: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((s) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      if (!persistOn) return;
      saveJSON(PREFS_KEY, { themePref: s.themePref, collapsed: s.collapsed, S: s.S, tone: s.tone, members: s.members, meId: s.meId } satisfies Prefs);
      saveJSON(dataKey(), { v: DATA_VERSION, emails: s.emails, apps: s.apps, events: s.events, accts: s.accts, notifs: s.notifs, activity: s.activity });
    }, 200);
  });
  startCalendarSync(useStore);
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    useStore.setState({ sysDark: mq.matches });
    mq.addEventListener('change', (e) => useStore.setState({ sysDark: e.matches }));
  } catch {
    /* matchMedia unavailable */
  }
}
