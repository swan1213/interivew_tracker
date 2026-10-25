import type { Member, Page, Role } from '@/data/types';

/**
 * Workspace roles.
 * - admin: everything, plus adding people and changing roles
 * - member: everything except managing roles
 * - guest: the Analytics page only
 */
export const ROLES: { k: Role; l: string; desc: string; cls: string }[] = [
  { k: 'admin', l: 'Admin', desc: 'Full access, plus adding people and changing their roles.', cls: 'cat-invite' },
  { k: 'member', l: 'Member', desc: 'Inbox, calendar, tracker, analytics, accounts and settings. Cannot manage roles.', cls: 'cat-confirmed' },
  { k: 'guest', l: 'Guest', desc: 'Analytics only. No mail, calendar, tracker, accounts or settings.', cls: 'cat-auto' },
];

export const roleMeta = (r: Role): (typeof ROLES)[number] => ROLES.find((x) => x.k === r) ?? ROLES[2];
export const isRole = (x: unknown): x is Role => x === 'admin' || x === 'member' || x === 'guest';

const GUEST_PAGES: Page[] = ['analytics'];

/** Whether a role may open a page. */
export function canSee(role: Role, page: Page): boolean {
  if (role === 'admin') return true;
  if (role === 'member') return page !== 'team';
  return GUEST_PAGES.includes(page);
}

/** Where a role lands when it opens the app or reaches a page it may not see. */
export const homePage = (role: Role): Page => (role === 'guest' ? 'analytics' : 'dash');

export const canManageRoles = (role: Role): boolean => role === 'admin';

/** The person currently using the app. */
export function currentMember(s: { members: Member[]; meId: string }): Member | undefined {
  return s.members.find((m) => m.id === s.meId) ?? s.members[0];
}

/** Role of the current user; an empty team falls back to the most restricted role. */
export const currentRole = (s: { members: Member[]; meId: string }): Role => currentMember(s)?.role ?? 'guest';

export const OWNER_ID = 'owner';

/** Starting team: the workspace owner as admin, plus two fictional people in the demo. */
export function seedMembers(ownerName: string, demo: boolean): Member[] {
  const owner: Member = { id: OWNER_ID, name: ownerName.trim() || 'You', email: demo ? 'jordan.lee@example.com' : '', role: 'admin' };
  if (!demo) return [owner];
  return [
    owner,
    { id: 'm-alex', name: 'Alex Rivera', email: 'alex.rivera@example.com', role: 'member' },
    { id: 'm-morgan', name: 'Morgan Patel', email: 'morgan.patel@example.com', role: 'guest' },
  ];
}

/** Saved team if it is well-formed and still has an admin, otherwise the seed. */
export function restoreMembers(saved: unknown, ownerName: string, demo: boolean): Member[] {
  if (Array.isArray(saved)) {
    const ok = saved.filter(
      (m): m is Member => !!m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.email === 'string' && isRole(m.role),
    );
    if (ok.some((m) => m.role === 'admin')) return ok;
  }
  return seedMembers(ownerName, demo);
}

/** Saved current user if still on the team, otherwise the first admin. */
export function restoreMeId(saved: unknown, members: Member[]): string {
  if (typeof saved === 'string' && members.some((m) => m.id === saved)) return saved;
  return (members.find((m) => m.role === 'admin') ?? members[0])?.id ?? '';
}

/** Replace a member by id, or put them first when missing. */
export function upsertMember(members: Member[], m: Member): Member[] {
  return members.some((x) => x.id === m.id) ? members.map((x) => (x.id === m.id ? { ...x, ...m } : x)) : [m, ...members];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validation message for adding a person, or '' when valid. */
export function newMemberError(members: Member[], name: string, email: string): string {
  if (!name.trim()) return 'Enter a name.';
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return 'Enter a valid email address.';
  if (members.some((m) => m.email.toLowerCase() === e)) return 'Someone with that email is already on the team.';
  return '';
}

const adminCount = (members: Member[]): number => members.filter((m) => m.role === 'admin').length;

/** Why a role change is not allowed, or '' when it is. */
export function roleChangeError(members: Member[], id: string, role: Role): string {
  const m = members.find((x) => x.id === id);
  if (!m) return 'That person is no longer on the team.';
  if (m.owner && role !== 'admin') return 'The workspace owner is always an admin.';
  if (m.role === 'admin' && role !== 'admin' && adminCount(members) === 1) return 'The workspace needs at least one admin. Make someone else an admin first.';
  return '';
}

/** Why removing a person is not allowed, or '' when it is. */
export function removeMemberError(members: Member[], id: string, meId: string): string {
  if (id === meId) return 'You cannot remove yourself. Ask another admin to do it.';
  const m = members.find((x) => x.id === id);
  if (!m) return 'That person is no longer on the team.';
  if (m.owner) return 'The workspace owner cannot be removed.';
  if (m.role === 'admin' && adminCount(members) === 1) return 'The workspace needs at least one admin.';
  return '';
}
