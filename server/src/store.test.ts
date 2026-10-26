import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'iflow-store-'));
process.env.IFLOW_DATA_DIR = dir;
process.env.GOOGLE_MOCK = '1';

describe('stored JSON', () => {
  it('compresses large values and reads them back unchanged', async () => {
    const store = await import('./store');
    const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: 'Thanks for applying to the Senior Engineer role. '.repeat(3) })) };
    await store.writeJson('big.json', big);
    const raw = readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith('big'))!), 'utf8');
    expect(raw.startsWith('gz1:')).toBe(true);
    expect(raw.length).toBeLessThan(JSON.stringify(big).length / 5);
    expect(await store.readJson('big.json', null)).toEqual(big);
    await store.writeJson('small.json', { a: 1 });
    expect(await store.readJson('small.json', null)).toEqual({ a: 1 });
  });

  it('refuses to treat unreadable data as empty, so it is never overwritten with nothing', async () => {
    const store = await import('./store');
    await store.writeJson('bad.json', { a: 1 });
    writeFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith('bad'))!), '{"a":', 'utf8');
    await expect(store.readJson('bad.json', {})).rejects.toThrow('could not be read');
    expect(await store.readJson('missing.json', 'fallback')).toBe('fallback');
  });
});
