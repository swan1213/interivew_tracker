/**
 * Sign-in sessions: an HMAC-signed, HttpOnly cookie holding the signed-in email.
 * The role is looked up from the team on every request, so a role change or a
 * removal takes effect immediately without waiting for the cookie to expire.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../src/data/types';
import { cfg, tokenSecret } from './config';
import { b64url, fromB64url } from './crypto';
import { findMember, normEmail } from './team';

export const SESSION_COOKIE = 'iflow_session';
const MAX_AGE_S = 7 * 24 * 3600;
const RANK: Record<Role, number> = { guest: 0, member: 1, admin: 2 };

export interface Session { email: string; name: string; exp: number }
export interface SignedInUser { email: string; name: string; role: Role; owner: boolean }

const key = (): Buffer => createHash('sha256').update('iflow-session:' + tokenSecret()).digest();
const mac = (body: string): string => b64url(createHmac('sha256', key()).update(body).digest());

export function signSession(s: Session): string {
  const body = b64url(JSON.stringify(s));
  return body + '.' + mac(body);
}

export function verifySession(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const got = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(body));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(fromB64url(body).toString('utf8')) as Session;
    if (typeof s.email !== 'string' || typeof s.exp !== 'number' || s.exp < now) return null;
    return { email: normEmail(s.email), name: String(s.name || ''), exp: s.exp };
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

const cookieTail = (): string => '; Path=/; HttpOnly; SameSite=Lax' + (cfg.appUrl.startsWith('https:') ? '; Secure' : '');

export function setSessionCookie(res: Response, email: string, name: string): void {
  const v = signSession({ email: normEmail(email), name, exp: Date.now() + MAX_AGE_S * 1000 });
  res.append('Set-Cookie', SESSION_COOKIE + '=' + encodeURIComponent(v) + cookieTail() + '; Max-Age=' + MAX_AGE_S);
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', SESSION_COOKIE + '=' + cookieTail() + '; Max-Age=0');
}

export const sessionOf = (req: Request): Session | null => verifySession(readCookie(req, SESSION_COOKIE));

/** The signed-in person with their current role, or the reason there is none. */
export type AuthCode = 'signed_out' | 'not_on_team' | 'forbidden';

export async function userOf(req: Request): Promise<{ user?: SignedInUser; status?: 401 | 403; error?: string; code?: AuthCode }> {
  const s = sessionOf(req);
  if (!s) return { status: 401, error: 'Sign in to continue.', code: 'signed_out' };
  const m = await findMember(s.email);
  if (!m) return { status: 403, error: s.email + ' is not on this workspace’s team. Ask an admin to add you.', code: 'not_on_team' };
  return { user: { email: m.email, name: m.name !== m.email ? m.name : s.name || m.email, role: m.role, owner: !!m.owner } };
}

export const atLeast = (role: Role, min: Role): boolean => RANK[role] >= RANK[min];

/** Middleware: 401 without a session, 403 when the role is below `min`. Puts the user on res.locals.user. */
export function requireRole(min: Role) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const r = await userOf(req);
    if (!r.user) {
      if (r.status === 403) clearSessionCookie(res);
      res.status(r.status || 401).json({ error: r.error, code: r.code });
      return;
    }
    if (!atLeast(r.user.role, min)) {
      res.status(403).json({ error: 'Your role (' + r.user.role + ') does not allow this.', code: 'forbidden' });
      return;
    }
    res.locals.user = r.user;
    next();
  };
}
