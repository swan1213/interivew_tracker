import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cfg } from './config';
import type { MailStore, StoredAccount } from './types';

function file(name: string): string {
  mkdirSync(cfg.dataDir, { recursive: true });
  return resolve(cfg.dataDir, name);
}

export function readJson<T>(name: string, fallback: T): T {
  const f = file(name);
  if (!existsSync(f)) return fallback;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write: temp file then rename. */
export function writeJson(name: string, data: unknown): void {
  const f = file(name);
  const tmp = f + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, f);
}

export function removeFile(name: string): void {
  const f = file(name);
  if (existsSync(f)) unlinkSync(f);
}

export const readAccounts = (): StoredAccount[] => readJson<StoredAccount[]>('accounts.json', []);
export const writeAccounts = (a: StoredAccount[]): void => writeJson('accounts.json', a);

export const mailFile = (accountId: string): string => 'mail-' + accountId + '.json';
export const readMail = (accountId: string): MailStore => readJson<MailStore>(mailFile(accountId), { threads: {}, skipped: [], lastSync: null });
export const writeMail = (accountId: string, m: MailStore): void => writeJson(mailFile(accountId), m);
