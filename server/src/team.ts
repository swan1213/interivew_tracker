/**
 * Who may use the workspace, and with which role. Stored in team.json in the
 * data directory. The owner emails from ADMIN_EMAIL are always admins and can
 * never be demoted or removed, so the workspace can't lock itself out.
 */
import type { Role } from '../../src/data/types';
import { cfg } from './config';
import { readJson, writeJson } from './store';

export interface TeamMember {
  email: string;
  name: string;
  role: Role;
  /** Set from ADMIN_EMAIL: always admin, cannot be changed or removed. */
  owner?: boolean;
}

const FILE = 'team.json';
const ROLES: Role[] = ['admin', 'member', 'guest'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normEmail = (e: string): string => String(e || '').trim().toLowerCase();
export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role);

function stored(): TeamMember[] {
  const t = readJson<unknown>(FILE, []);
  if (!Array.isArray(t)) return [];
  return t
    .filter((m): m is TeamMember => !!m && typeof m.email === 'string' && typeof m.name === 'string' && isRole(m.role))
    .map((m) => ({ email: normEmail(m.email), name: m.name, role: m.role }));
}

const save = (rows: TeamMember[]): void => writeJson(FILE, rows.map(({ email, name, role }) => ({ email, name, role })));

/** Everyone on the team, owners first. */
export function listTeam(): TeamMember[] {
  const owners = cfg.adminEmails;
  const rows = stored();
  const ownerRows: TeamMember[] = owners.map((email) => ({ email, name: rows.find((m) => m.email === email)?.name || email, role: 'admin', owner: true }));
  return [...ownerRows, ...rows.filter((m) => !owners.includes(m.email))];
}

export const findMember = (email: string): TeamMember | undefined => listTeam().find((m) => m.email === normEmail(email));

/** The role for an email, or null when that person is not on the team. */
export const roleFor = (email: string): Role | null => findMember(email)?.role ?? null;

export interface TeamResult { status: number; error?: string; member?: TeamMember }

export function addTeamMember(name: string, email: string, role: unknown): TeamResult {
  const e = normEmail(email);
  const n = String(name || '').trim();
  if (!n) return { status: 400, error: 'Enter a name.' };
  if (!EMAIL_RE.test(e)) return { status: 400, error: 'Enter a valid email address.' };
  if (!isRole(role)) return { status: 400, error: 'Choose a role: admin, member or guest.' };
  if (findMember(e)) return { status: 409, error: 'Someone with that email is already on the team.' };
  const member: TeamMember = { email: e, name: n, role };
  save(stored().concat([member]));
  return { status: 201, member };
}

export function setTeamRole(email: string, role: unknown): TeamResult {
  const e = normEmail(email);
  if (!isRole(role)) return { status: 400, error: 'Choose a role: admin, member or guest.' };
  const m = findMember(e);
  if (!m) return { status: 404, error: 'That person is not on the team.' };
  if (m.owner) return { status: 409, error: 'The workspace owner is always an admin.' };
  save(stored().map((x) => (x.email === e ? { ...x, role } : x)));
  return { status: 200, member: { ...m, role } };
}

export function removeTeamMember(email: string, actorEmail: string): TeamResult {
  const e = normEmail(email);
  const m = findMember(e);
  if (!m) return { status: 404, error: 'That person is not on the team.' };
  if (m.owner) return { status: 409, error: 'The workspace owner cannot be removed.' };
  if (e === normEmail(actorEmail)) return { status: 409, error: 'You cannot remove yourself. Ask another admin to do it.' };
  save(stored().filter((x) => x.email !== e));
  return { status: 200, member: m };
}

/** Keep the display name current from the Google profile on each sign-in. */
export function rememberName(email: string, name: string): void {
  const e = normEmail(email);
  const n = String(name || '').trim();
  if (!n) return;
  const rows = stored();
  const row = rows.find((x) => x.email === e);
  if (row) {
    if (row.name === n) return;
    save(rows.map((x) => (x.email === e ? { ...x, name: n } : x)));
  } else if (cfg.adminEmails.includes(e)) {
    save(rows.concat([{ email: e, name: n, role: 'admin' }]));
  }
}
