import { cfg } from '../config';
import { sha256b64url } from '../crypto';
import type { TokenSet, UserInfo } from '../google/oauth';

/** Delegated Microsoft Graph permissions: read and file mail, send on approval, and the calendar. */
export const MS_SCOPES = ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite'];

const authority = (): string => 'https://login.microsoftonline.com/' + encodeURIComponent(cfg.msTenant) + '/oauth2/v2.0';

/** Microsoft sign-in page for connecting an Outlook.com or Microsoft 365 mailbox (PKCE). */
export function msAuthUrl(state: string, verifier: string): string {
  const q = new URLSearchParams({
    client_id: cfg.msClientId,
    redirect_uri: cfg.msRedirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: MS_SCOPES.join(' '),
    prompt: 'select_account',
    state,
    code_challenge: sha256b64url(verifier),
    code_challenge_method: 'S256',
  });
  return authority() + '/authorize?' + q.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const r = await fetch(authority() + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.msClientId, client_secret: cfg.msClientSecret, scope: MS_SCOPES.join(' '), ...body }).toString(),
  });
  const j = (await r.json()) as TokenSet & { error?: string; error_description?: string };
  if (!r.ok || j.error) throw new Error('Microsoft token error: ' + (j.error_description?.split('\r\n')[0] || j.error || r.status));
  return j;
}

export const msExchangeCode = (code: string, verifier: string): Promise<TokenSet> =>
  tokenRequest({ code, redirect_uri: cfg.msRedirectUri, grant_type: 'authorization_code', code_verifier: verifier });

/** Microsoft rotates refresh tokens: the response carries a new one to store. */
export const msRefreshAccessToken = (refreshToken: string): Promise<TokenSet> => tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });

/** The signed-in mailbox's address and name. Personal accounts may have no `mail`, only the sign-in name. */
export async function msUserInfo(accessToken: string): Promise<UserInfo> {
  const r = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!r.ok) throw new Error('Could not read the Microsoft profile (' + r.status + ')');
  const me = (await r.json()) as { displayName?: string; mail?: string | null; userPrincipalName?: string };
  return { email: me.mail || me.userPrincipalName || '', name: me.displayName || undefined };
}

/** A fake Outlook mailbox for mock mode and tests. */
export const MOCK_MS_USER: UserInfo = { email: 'jordan.lee@outlook.example', name: 'Jordan Lee' };
