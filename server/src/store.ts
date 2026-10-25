import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cfg } from './config';
import type { MailStore, StoredAccount } from './types';

/**
 * Key-value storage for accounts, mail and the team. JSON files in the data
 * directory by default; Upstash Redis when its REST credentials are set, which
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

function redisBackend(url: string, token: string): Backend {
  const cmd = async (...args: string[]): Promise<unknown> => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(args) });
    const j = (await r.json().catch(() => ({}))) as { result?: unknown; error?: string };
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
  const want = cfg.redisUrl ? 'redis:' + cfg.redisUrl : 'file:' + cfg.dataDir;
  if (backend && backendFor === want) return backend;
  if (!cfg.redisUrl && process.env.VERCEL) {
    throw new Error('No storage configured. Vercel does not keep files, so add Upstash Redis (Vercel → Storage) to set KV_REST_API_URL and KV_REST_API_TOKEN, then redeploy.');
  }
  backend = cfg.redisUrl ? redisBackend(cfg.redisUrl, cfg.redisToken) : fileBackend();
  backendFor = want;
  return backend;
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  const raw = await store().get(name);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const writeJson = (name: string, data: unknown, ttlS?: number): Promise<void> => store().set(name, JSON.stringify(data), ttlS);

export const removeKey = (name: string): Promise<void> => store().del(name);

export const readAccounts = (): Promise<StoredAccount[]> => readJson<StoredAccount[]>('accounts.json', []);
export const writeAccounts = (a: StoredAccount[]): Promise<void> => writeJson('accounts.json', a);

export const mailFile = (accountId: string): string => 'mail-' + accountId + '.json';
export const readMail = (accountId: string): Promise<MailStore> => readJson<MailStore>(mailFile(accountId), { threads: {}, skipped: [], lastSync: null });
export const writeMail = (accountId: string, m: MailStore): Promise<void> => writeJson(mailFile(accountId), m);
