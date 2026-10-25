import type { Cat, EvStage, InboxView, Pri, StageKey, Tone } from './types';

export const ICONS = {
  flow: 'M4 6h6a4 4 0 014 4 4 4 0 004 4h2 M17 11l3 3-3 3 M4 18h5',
  dash: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9z',
  cal: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20z M12 6v6l4 2',
  video: 'M23 7l-7 5 7 5z M3 5h11a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2z',
  refresh: 'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0020.49 15',
  checkc: 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
  check: 'M20 6L9 17l-5-5',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8',
  award: 'M12 15a7 7 0 100-14 7 7 0 000 14z M8.21 13.89L7 23l5-3 5 3-1.21-9.12',
  xc: 'M12 22a10 10 0 100-20 10 10 0 000 20z M15 9l-6 6 M9 9l6 6',
  bot: 'M12 8V4H8 M4 8h16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2v-8a2 2 0 012-2z M9 14h.01 M15 14h.01',
  kanban: 'M3 3h18v18H3z M9 3v18 M15 3v12',
  chart: 'M18 20V10 M12 20V4 M6 20v-6',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  plug: 'M12 22v-5 M9 8V2 M15 8V2 M18 8v5a6 6 0 01-12 0V8z',
  bell: 'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 01-3.46 0',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16z M21 21l-4.35-4.35',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10z M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 3v4 M21 5h-4',
  send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4z',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
  chevL: 'M15 18l-6-6 6-6',
  chevR: 'M9 18l6-6-6-6',
  chevD: 'M6 9l6 6 6-6',
  chevU: 'M18 15l-6-6-6 6',
  panel: 'M3 3h18v18H3z M9 3v18',
  plus: 'M12 5v14 M5 12h14',
  reply: 'M9 17l-5-5 5-5 M20 18v-2a4 4 0 00-4-4H4',
  archive: 'M21 8v13H3V8 M1 3h22v5H1z M10 12h4',
  fwd: 'M15 17l5-5-5-5 M4 18v-2a4 4 0 014-4h12',
  x: 'M18 6L6 18 M6 6l12 12',
  mail: 'M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z M22 6l-10 7L2 6',
  updown: 'M7 15l5 5 5-5 M7 9l5-5 5 5',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20z M12 16v-4 M12 8h.01',
  help: 'M12 22a10 10 0 100-20 10 10 0 000 20z M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3 M12 17h.01',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75',
} as const;
export type IconName = keyof typeof ICONS;

export const CAT: Record<Cat, { l: string; i: IconName }> = {
  action: { l: 'Action Required', i: 'bolt' },
  invite: { l: 'Interview Invitation', i: 'video' },
  avail: { l: 'Availability Requested', i: 'clock' },
  confirmed: { l: 'Interview Confirmed', i: 'checkc' },
  applied: { l: 'Application Received', i: 'file' },
  status: { l: 'Status Update', i: 'info' },
  rejected: { l: 'Rejected', i: 'xc' },
  auto: { l: 'Automated / No-Reply', i: 'bot' },
  offer: { l: 'Offer', i: 'award' },
  review: { l: 'Needs Review', i: 'help' },
  sent: { l: 'Sent', i: 'send' },
};
export const CAT_KEYS = Object.keys(CAT) as Cat[];

export const STAGES: { k: StageKey; l: string; c: string }[] = [
  { k: 'applied', l: 'Applied', c: '#6B7390' },
  { k: 'review', l: 'Under Review', c: '#0B7AB0' },
  { k: 'screen', l: 'Recruiter Screening', c: '#8B3FD6' },
  { k: 'sched', l: 'Interview Scheduling', c: '#C0540C' },
  { k: 'confirmed', l: 'Interview Confirmed', c: '#1E8A4C' },
  { k: 'tech', l: 'Technical Interview', c: '#4F46E5' },
  { k: 'final', l: 'Final Interview', c: '#0E8F83' },
  { k: 'offer', l: 'Offer Received', c: '#B7791F' },
  { k: 'hired', l: 'Hired', c: '#15803D' },
  { k: 'closed', l: 'Rejected / Closed', c: '#9A5A66' },
];
export const stageLabel = (k: StageKey): string => STAGES.find((s) => s.k === k)?.l ?? k;

export const STG: Record<EvStage, { cls: string; label: string }> = {
  screen: { cls: 'st-screen', label: 'Recruiter screen' },
  tech: { cls: 'st-tech', label: 'Technical' },
  mgr: { cls: 'st-mgr', label: 'Hiring manager' },
  final: { cls: 'st-final', label: 'Final' },
  offer: { cls: 'st-offer', label: 'Offer call' },
  busy: { cls: 'st-busy', label: 'Busy' },
};

export const COLORS = ['#4F46E5', '#0F766E', '#B45309', '#BE185D', '#1D4ED8', '#6D28D9', '#0E7490', '#15803D'];
export const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MFULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const PRI: Record<Pri, { label: string; bars: number }> = {
  critical: { label: 'Critical', bars: 3 },
  high: { label: 'High', bars: 2 },
  normal: { label: 'Normal', bars: 1 },
  low: { label: 'Low', bars: 0 },
};
export const PRI_RANK: Record<Pri, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export const TONES: { k: Tone; l: string }[] = [
  { k: 'professional', l: 'Professional' },
  { k: 'friendly', l: 'Friendly' },
  { k: 'concise', l: 'Concise' },
  { k: 'confident', l: 'Confident' },
];

export const INBOX_TITLES: Record<InboxView, string> = {
  inbox: 'Unified inbox',
  action: 'Action required',
  invite: 'Interview invitations',
  avail: 'Availability requests',
  status: 'Application updates',
  applied: 'Application confirmations',
  offers: 'Offers',
  rejected: 'Rejections',
  auto: 'Automated / no-reply',
  sent: 'Sent',
};

export const SAVED_FILTERS: { k: string; l: string }[] = [
  { k: 'reply', l: 'Needs reply today' },
  { k: 'week', l: 'Interviews this week' },
  { k: 'wait', l: 'Waiting for confirmation' },
  { k: 'new', l: 'New recruiter messages' },
  { k: 'high', l: 'High priority' },
  { k: 'unreadapp', l: 'Unread applications' },
];

export const PREFS_KEY = 'iflow.prefs.v1';
export const DATA_KEY = 'iflow.data.v1';
export const DATA_VERSION = 1;

/** Calendar grid: first hour shown, last hour shown, and pixel height per hour. */
/** Week and day views cover the whole day (ET) and scroll; they open at the current time. */
export const GRID_START_HOUR = 0;
export const GRID_END_HOUR = 24;
export const HOUR_PX = 52;
