import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Repository root (two levels up from server/src). */
export const ROOT = resolve(here, '..', '..');

/**
 * Minimal .env loader: KEY=value lines, optional quotes. A value set in the real
 * shell environment always wins; values this loader set earlier are refreshed, so
 * editing .env while the dev server is running (Vite restarts in-process) takes effect.
 */
const loadedKeys: Set<string> = ((globalThis as unknown as { __iflowEnvKeys?: Set<string> }).__iflowEnvKeys ||= new Set<string>());
export function loadEnvFile(file = resolve(ROOT, '.env')): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key] || loadedKeys.has(key)) {
      process.env[key] = val;
      loadedKeys.add(key);
    }
  }
}
// Tests set their own environment; .env may point at real Google credentials or a production Redis.
if (!process.env.VITEST) loadEnvFile();

/** Runtime configuration, read lazily so tests and mock mode can set env first. */
export const cfg = {
  get dataDir(): string {
    return process.env.IFLOW_DATA_DIR || resolve(ROOT, 'server', 'data');
  },
  /** GOOGLE_MOCK=1 replaces Google with an in-process fake (dev and tests). */
  get mock(): boolean {
    return process.env.GOOGLE_MOCK === '1';
  },
  get clientId(): string {
    return process.env.GOOGLE_CLIENT_ID || '';
  },
  get clientSecret(): string {
    return process.env.GOOGLE_CLIENT_SECRET || '';
  },
  get appUrl(): string {
    return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  },
  get redirectUri(): string {
    return cfg.appUrl + '/api/auth/google/callback';
  },
  /** Microsoft app registration (Microsoft Entra ID), for connecting Outlook.com and Microsoft 365 mailboxes. */
  get msClientId(): string {
    return process.env.MICROSOFT_CLIENT_ID || '';
  },
  get msClientSecret(): string {
    return process.env.MICROSOFT_CLIENT_SECRET || '';
  },
  /** 'common' accepts personal Microsoft accounts and work or school accounts. */
  get msTenant(): string {
    return process.env.MICROSOFT_TENANT || 'common';
  },
  get msRedirectUri(): string {
    return cfg.appUrl + '/api/auth/microsoft/callback';
  },
  /** Outlook mailboxes can be connected (credentials set, or mock mode). */
  get msConfigured(): boolean {
    return cfg.mock || (!!cfg.msClientId && !!cfg.msClientSecret);
  },
  get anthropicKey(): string {
    return process.env.ANTHROPIC_API_KEY || '';
  },
  get anthropicModel(): string {
    return process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
  },
  get syncQuery(): string {
    return process.env.GMAIL_SYNC_QUERY || 'newer_than:60d -in:spam -in:trash';
  },
  /** Every sent and received message is kept; GMAIL_JOB_FILTER=on drops received mail with no job-search signal. */
  get jobFilter(): boolean {
    return process.env.GMAIL_JOB_FILTER === 'on';
  },
  /** Newest messages listed per sync, a safety cap well above 60 days of a busy inbox. */
  get maxMessages(): number {
    return parseInt(process.env.GMAIL_MAX_MESSAGES || '3000', 10);
  },
  /** New conversations fetched and classified per sync request; the rest wait for the next one, so no request runs too long. */
  get syncBatch(): number {
    return parseInt(process.env.GMAIL_SYNC_BATCH || '200', 10);
  },
  /**
   * Time one sync request may spend per account before saving what it has. Kept well under
   * Vercel's 60-second function limit, so work done is never lost to a timeout.
   */
  get syncBudgetMs(): number {
    return parseInt(process.env.GMAIL_SYNC_BUDGET_MS || '40000', 10);
  },
  /**
   * Workspace owners: always admin, cannot be demoted or removed.
   * ADMIN_EMAIL takes one address or a comma-separated list.
   */
  get adminEmails(): string[] {
    return (process.env.ADMIN_EMAIL || 'winterhot223@gmail.com')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  /** Upstash Redis REST endpoint; Vercel's Upstash integration sets the KV_* names. Empty means files in dataDir. */
  get redisUrl(): string {
    return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  },
  get redisToken(): string {
    return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  },
  /** True when Google sign-in can actually run. */
  get configured(): boolean {
    return cfg.mock || (!!cfg.clientId && !!cfg.clientSecret);
  },
};

/** Secret used to encrypt tokens at rest. Generated once and kept outside git when not provided. */
export function tokenSecret(): string {
  if (process.env.TOKEN_SECRET) return process.env.TOKEN_SECRET;
  if (process.env.VERCEL) throw new Error('Set TOKEN_SECRET (a long random string) in the Vercel project settings, then redeploy.');
  mkdirSync(cfg.dataDir, { recursive: true });
  const f = resolve(cfg.dataDir, 'secret.key');
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(f, 'utf8').trim();
}
