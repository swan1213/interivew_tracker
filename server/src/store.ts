import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cfg } from './config';
import { mongoBackend } from './mongo';
import type { MailStore, StoredAccount, SyncIndex } from './types';

/**
 * Key-value storage for accounts, mail and the team. JSON files in the data
 * directory by default; MongoDB (or Upstash Redis) when configured, which
 * serverless hosts (Vercel) need because their disk does not persist.
 */
interface Backend {
  get(key: string): Promise<string | null>;
  /** `ttlS` marks short-lived data (pending sign-ins) that expires on its own. */
  set(key: string, value: string, ttlS?: number): Promise<void>;
  del(key: string): Promise<void>;
}

function fileBackend(): Backend {
  const file = (key: string): string => {
    mkdirSync(cfg.dataDir, { recursive: true });
    return resolve(cfg.dataDir, key);
  };
  // A single long-running process: short-lived keys can live in memory.
  const temp = new Map<string, { value: string; exp: number }>();
  return {
    async get(key) {
      const t = temp.get(key);
      if (t) return t.exp > Date.now() ? t.value : (temp.delete(key), null);
      const f = file(key);
      return existsSync(f) ? readFileSync(f, 'utf8') : null;
    },
    async set(key, value, ttlS) {
      if (ttlS) {
        temp.set(key, { value, exp: Date.now() + ttlS * 1000 });
        for (const [k, v] of temp) if (v.exp <= Date.now()) temp.delete(k);
        return;
      }
      // Atomic write: temp file then rename.
      const f = file(key);
      writeFileSync(f + '.tmp', value, 'utf8');
      renameSync(f + '.tmp', f);
    },
    async del(key) {
      temp.delete(key);
      const f = file(key);
      if (existsSync(f)) unlinkSync(f);
    },
  };
}

export const STORAGE_FULL = 'Storage is blocked: the Upstash database has used up its plan allowance. Mail cannot load or save until the allowance resets or a new database is connected.';

function redisBackend(url: string, token: string): Backend {
  const cmd = async (...args: string[]): Promise<unknown> => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(args) });
    const j = (await r.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (/plan limits?\b/i.test(j.error || '')) throw new Error(STORAGE_FULL);
    if (!r.ok || j.error) throw new Error('Redis error: ' + (j.error || r.status));
    return j.result;
  };
  const k = (key: string): string => 'iflow:' + key;
  return {
    async get(key) {
      const v = await cmd('GET', k(key));
      return typeof v === 'string' ? v : null;
    },
    async set(key, value, ttlS) {
      await (ttlS ? cmd('SET', k(key), value, 'EX', String(ttlS)) : cmd('SET', k(key), value));
    },
    async del(key) {
      await cmd('DEL', k(key));
    },
  };
}

let backend: Backend | null = null;
let backendFor = '';
function store(): Backend {
  // Fake Google (dev:mock, tests) must never write its demo mailbox into a real Redis named in .env.
  const mongoUri = cfg.mock ? '' : cfg.mongoUri;
  const redisUrl = cfg.mock ? '' : cfg.redisUrl;
  const want = mongoUri ? 'mongo:' + mongoUri + '/' + cfg.mongoDb : redisUrl ? 'redis:' + redisUrl : 'file:' + cfg.dataDir;
  if (backend && backendFor === want) return backend;
  if (!mongoUri && !redisUrl && process.env.VERCEL) {
    throw new Error('No storage configured. Vercel does not keep files, so set MONGODB_URI to a MongoDB connection string, then redeploy.');
  }
  backend = mongoUri ? mongoBackend(mongoUri, cfg.mongoDb) : redisUrl ? redisBackend(redisUrl, cfg.redisToken) : fileBackend();
  backendFor = want;
  return backend;
}

// All but small values are gzipped: about a sixth of the size, well inside Redis request limits,
// and every byte moved counts against the database's bandwidth allowance.
const GZ = 'gz1:';
const GZ_FROM = 4 * 1024;

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  const raw = await store().get(name);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw.startsWith(GZ) ? gunzipSync(Buffer.from(raw.slice(GZ.length), 'base64')).toString('utf8') : raw) as T;
  } catch {
    // Never fall back to empty here: the next write would replace the stored data with nothing.
    throw new Error('Stored data "' + name + '" could not be read.');
  }
}

export const writeJson = (name: string, data: unknown, ttlS?: number): Promise<void> => {
  const json = JSON.stringify(data);
  return store().set(name, json.length < GZ_FROM ? json : GZ + gzipSync(json).toString('base64'), ttlS);
};

export const removeKey = (name: string): Promise<void> => store().del(name);

export const readAccounts = (): Promise<StoredAccount[]> => readJson<StoredAccount[]>('accounts.json', []);
export const writeAccounts = (a: StoredAccount[]): Promise<void> => writeJson('accounts.json', a);

// Token refreshes, sync times and connects for different accounts run in parallel; their
// read-modify-writes of the shared accounts list take turns so none overwrites another.
let accountsQueue: Promise<unknown> = Promise.resolve();
export function updateAccounts(fn: (accts: StoredAccount[]) => StoredAccount[]): Promise<void> {
  const run = accountsQueue.then(async () => writeAccounts(fn(await readAccounts())));
  accountsQueue = run.catch(() => undefined);
  return run;
}

export const mailFile = (accountId: string): string => 'mail-' + accountId + '.json';
export const readMail = (accountId: string): Promise<MailStore> => readJson<MailStore>(mailFile(accountId), { threads: {}, skipped: [], lastSync: null });
export const writeMail = (accountId: string, m: MailStore): Promise<void> => writeJson(mailFile(accountId), m);

export const syncIndexFile = (accountId: string): string => 'sync-' + accountId + '.json';
export const readSyncIndex = (accountId: string): Promise<SyncIndex | null> => readJson<SyncIndex | null>(syncIndexFile(accountId), null);
export const writeSyncIndex = (accountId: string, x: SyncIndex): Promise<void> => writeJson(syncIndexFile(accountId), x);
