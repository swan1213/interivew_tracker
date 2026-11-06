import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { mongoBackend } from './mongo';

// Needs a real server: TEST_MONGODB_URI=mongodb://... npx vitest run server/src/mongo.test.ts
const uri = process.env.TEST_MONGODB_URI;

describe.skipIf(!uri)('MongoDB storage', () => {
  const dbName = () => 'iflow-test-' + randomBytes(4).toString('hex');
  const db = mongoBackend(uri!, dbName());
  const big = (n: number) => randomBytes(Math.ceil(n * 0.75)).toString('base64').slice(0, n);

  afterAll(async () => {
    const { MongoClient } = await import('mongodb');
    const c = await MongoClient.connect(uri!);
    const { databases } = await c.db().admin().listDatabases();
    for (const { name } of databases) if (name.startsWith('iflow-test-')) await c.db(name).dropDatabase();
    await c.close();
  });

  it('saves, replaces and deletes', async () => {
    expect(await db.get('a')).toBeNull();
    await db.set('a', 'one');
    await db.set('a', 'two');
    expect(await db.get('a')).toBe('two');
    await db.del('a');
    expect(await db.get('a')).toBeNull();
    await db.del('a');
  });

  it('short-lived values stop being returned once expired', async () => {
    await db.set('p', 'x', 1);
    expect(await db.get('p')).toBe('x');
    await new Promise((r) => setTimeout(r, 1100));
    expect(await db.get('p')).toBeNull();
  });

  it('a value over the 16 MB document limit round-trips, and replacing or deleting it leaves no pieces', async () => {
    const { MongoClient } = await import('mongodb');
    const name = dbName();
    const own = mongoBackend(uri!, name);
    const c = await MongoClient.connect(uri!);
    const count = () => c.db(name).collection('kv').countDocuments();

    const v = big(40 * 1024 * 1024);
    await own.set('m', v);
    expect(await own.get('m')).toBe(v);
    expect(await count()).toBe(4); // the entry and three pieces

    const v2 = big(20 * 1024 * 1024);
    await own.set('m', v2);
    expect(await own.get('m')).toBe(v2);
    expect(await count()).toBe(3);

    await own.set('m', 'small');
    expect(await own.get('m')).toBe('small');
    expect(await count()).toBe(1);

    await own.set('m', v2);
    await own.del('m');
    expect(await count()).toBe(0);
    await c.close();
  }, 120_000);

  it('says what to check when it cannot connect, without repeating the address', async () => {
    const bad = mongoBackend('mongodb://user:secret@127.0.0.1:1/?serverSelectionTimeoutMS=200', 'x');
    const e = await bad.get('a').catch((x: Error) => x);
    expect((e as Error).message).toMatch(/Could not connect to MongoDB/);
    expect((e as Error).message).not.toMatch(/secret|127\.0\.0\.1/);
  }, 30_000);
});
