import { randomBytes } from 'node:crypto';
import { cfg } from '../config';
import { b64url, sha256b64url } from '../crypto';
import { readJson, removeKey, writeJson } from '../store';

/** Create, update and delete events, and read the busy times on the user's calendars. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.modify',
  CALENDAR_SCOPE,
];

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}
export interface UserInfo { email: string; name?: string; picture?: string; email_verified?: boolean }

/** 'login' signs a person in to the app (identity only); 'connect' links a Gmail mailbox. */
export type AuthPurpose = 'login' | 'connect';
const LOGIN_SCOPES = ['openid', 'email', 'profile'];

/**
 * Pending authorization requests keyed by state; entries expire after ten minutes.
 * Kept in the store so the callback can land on a different serverless instance.
 */
const PENDING_TTL_S = 10 * 60;
const pendingKey = (state: string): string => 'auth-' + state;
interface Pending { verifier: string; at: number; purpose: AuthPurpose }

export async function beginAuth(purpose: AuthPurpose = 'connect'): Promise<{ state: string; verifier: string }> {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  await writeJson(pendingKey(state), { verifier, at: Date.now(), purpose } satisfies Pending, PENDING_TTL_S);
  return { state, verifier };
}

/** Consume a pending request: its PKCE verifier and what it was for. */
export async function takeAuthRequest(state: string): Promise<{ verifier: string; purpose: AuthPurpose } | null> {
  const p = await readJson<Pending | null>(pendingKey(state), null);
  if (!p) return null;
  await removeKey(pendingKey(state));
  return Date.now() - p.at > PENDING_TTL_S * 1000 ? null : { verifier: p.verifier, purpose: p.purpose };
}

export async function takeAuth(state: string): Promise<string | null> {
  return (await takeAuthRequest(state))?.verifier ?? null;
}

export function authUrl(state: string, verifier: string, purpose: AuthPurpose = 'connect'): string {
  const pkce = { state, code_challenge: sha256b64url(verifier), code_challenge_method: 'S256' };
  const q =
    purpose === 'login'
      ? new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: LOGIN_SCOPES.join(' '), prompt: 'select_account', ...pkce })
      : new URLSearchParams({
          client_id: cfg.clientId,
          redirect_uri: cfg.redirectUri,
          response_type: 'code',
          scope: SCOPES.join(' '),
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
          ...pkce,
        });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const j = (await r.json()) as TokenSet & { error?: string; error_description?: string };
  if (!r.ok || j.error) throw new Error('Google token error: ' + (j.error_description || j.error || r.status));
  return j;
}

export const exchangeCode = (code: string, verifier: string): Promise<TokenSet> =>
  tokenRequest({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code', code_verifier: verifier });

export const refreshAccessToken = (refreshToken: string): Promise<TokenSet> =>
  tokenRequest({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' });

export async function revokeToken(token: string): Promise<void> {
  await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }).catch(() => undefined);
}

export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!r.ok) throw new Error('Could not read the Google profile (' + r.status + ')');
  return (await r.json()) as UserInfo;
}
