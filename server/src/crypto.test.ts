import { describe, expect, it } from 'vitest';
import { b64url, decrypt, encrypt, fromB64url, sha256b64url } from './crypto';
import { authUrl, beginAuth, takeAuth } from './google/oauth';
import { buildRawReply } from './google/gmail';

describe('token encryption and OAuth helpers', () => {
  it('encrypts and decrypts round trip, and rejects a wrong key', () => {
    const packed = encrypt('refresh-token-123', 'secret-a');
    expect(packed).not.toContain('refresh-token-123');
    expect(decrypt(packed, 'secret-a')).toBe('refresh-token-123');
    expect(() => decrypt(packed, 'secret-b')).toThrow();
  });

  it('base64url helpers', () => {
    expect(fromB64url(b64url('héllo wörld')).toString('utf8')).toBe('héllo wörld');
    expect(b64url('??>')).not.toMatch(/[+/=]/);
    expect(sha256b64url('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it('PKCE state is single use and the auth URL carries the challenge', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id-123';
    process.env.APP_URL = 'http://localhost:5173';
    const { state, verifier } = beginAuth();
    const url = new URL(authUrl(state, verifier));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id-123');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/google/callback');
    expect(url.searchParams.get('code_challenge')).toBe(sha256b64url(verifier));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('gmail.modify');
    expect(takeAuth(state)).toBe(verifier);
    expect(takeAuth(state)).toBeNull();
    expect(takeAuth('nope')).toBeNull();
  });

  it('builds a threaded RFC 2822 reply', () => {
    const raw = buildRawReply({ fromName: 'Jordan Lee', fromAddr: 'me@gmail.com', to: 'Priya <p@x.com>', subject: 'Re: Héllo', body: 'Thanks!\nJordan', inReplyTo: '<a@x>', references: '<a@x>' });
    const text = fromB64url(raw).toString('utf8');
    expect(text).toContain('From: Jordan Lee <me@gmail.com>');
    expect(text).toContain('In-Reply-To: <a@x>');
    expect(text).toContain('Subject: =?UTF-8?B?');
    const body = text.split('\r\n\r\n')[1];
    expect(Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8')).toBe('Thanks!\nJordan');
  });
});
