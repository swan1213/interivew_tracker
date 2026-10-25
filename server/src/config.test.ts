import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cfg, loadEnvFile } from './config';

const dir = mkdtempSync(join(tmpdir(), 'iflow-env-'));
const file = join(dir, '.env');

describe('.env loading', () => {
  afterEach(() => {
    delete process.env.IFLOW_TEST_A;
    delete process.env.IFLOW_TEST_B;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('reads keys, strips quotes, ignores comments and keeps shell values', () => {
    process.env.IFLOW_TEST_B = 'from-shell';
    writeFileSync(file, '# comment\nIFLOW_TEST_A="quoted value"\nIFLOW_TEST_B=from-file\n\nNOT_A_LINE\n');
    loadEnvFile(file);
    expect(process.env.IFLOW_TEST_A).toBe('quoted value');
    expect(process.env.IFLOW_TEST_B).toBe('from-shell');
  });

  it('picks up credentials pasted into a previously empty .env after an in-process reload', () => {
    writeFileSync(file, 'GOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\n');
    loadEnvFile(file);
    expect(cfg.configured).toBe(false);
    writeFileSync(file, 'GOOGLE_CLIENT_ID=abc.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=GOCSPX-x\n');
    loadEnvFile(file);
    expect(cfg.clientId).toBe('abc.apps.googleusercontent.com');
    expect(cfg.configured).toBe(true);
    expect(cfg.redirectUri).toBe(cfg.appUrl + '/api/auth/google/callback');
  });
});
