import { randomBytes } from 'node:crypto';
import type { Collection } from 'mongodb';

/** Key-value storage in one MongoDB collection, for the store. */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlS?: number): Promise<void>;
  del(key: string): Promise<void>;
}

interface Doc {
  _id: string;
  value: string;
  /** Set on a value too large for one document: where its pieces are, in order. */
  parts?: string[];
  expiresAt?: Date;
}

/** MongoDB refuses documents over 16 MB; larger values (they are base64 by then, one byte a character) go in pieces. */
const PART_CHARS = 15 * 1024 * 1024;

const NOT_REACHED = 'Could not connect to MongoDB. Check MONGODB_URI, the database user, and that Atlas Network Access allows this host.';
const FULL = 'Storage is full: the MongoDB database has reached its plan limit, so new mail cannot be saved.';

/** Plain messages for what the owner can act on; driver errors can name hosts. */
function explain(e: unknown): Error {
  const err = e as Error;
  if (/space quota/i.test(err.message || '')) return new Error(FULL);
  if (/^Mongo(ServerSelection|Network|Parse|APIError|InvalidArgument)/.test(err.name || '') || /authentication failed/i.test(err.message || '')) return new Error(NOT_REACHED);
  return err;
}

export function mongoBackend(uri: string, dbName: string): KeyValue {
  // A serverless instance handles many requests: one client, connected on first use, kept between them.
  let connecting: Promise<Collection<Doc>> | null = null;
  const connect = async (): Promise<Collection<Doc>> => {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const kv = client.db(dbName).collection<Doc>('kv');
    // Pending sign-ins remove themselves.
    await kv.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    return kv;
  };
  const withKv = async <T>(fn: (kv: Collection<Doc>) => Promise<T>): Promise<T> => {
    try {
      connecting ||= connect();
      return await fn(await connecting);
    } catch (e) {
      // Try connecting afresh next time, in case that was the failure.
      if (explain(e).message === NOT_REACHED) connecting = null;
      throw explain(e);
    }
  };

  const read = async (kv: Collection<Doc>, key: string): Promise<string | null | undefined> => {
    const d = await kv.findOne({ _id: key });
    if (!d) return null;
    // MongoDB removes expired documents about once a minute, so check.
    if (d.expiresAt && d.expiresAt.getTime() <= Date.now()) return null;
    if (!d.parts) return d.value;
    const found = await kv.find({ _id: { $in: d.parts } }).toArray();
    const byId = new Map(found.map((p) => [p._id, p.value]));
    // Undefined: a write replaced these pieces after we read the document.
    return d.parts.every((id) => byId.has(id)) ? d.parts.map((id) => byId.get(id)).join('') : undefined;
  };

  return {
    get: (key) =>
      withKv(async (kv) => {
        const first = await read(kv, key);
        return first !== undefined ? first : ((await read(kv, key)) ?? null);
      }),
    set: (key, value, ttlS) =>
      withKv(async (kv) => {
        const old = await kv.findOne({ _id: key }, { projection: { parts: 1 } });
        const doc: Doc = { _id: key, value: '' };
        if (value.length <= PART_CHARS) doc.value = value;
        else {
          // New pieces first, under a new name: anyone reading meanwhile still gets the whole old value.
          const stamp = randomBytes(6).toString('hex');
          doc.parts = [];
          for (let i = 0; i * PART_CHARS < value.length; i++) {
            const _id = key + '#' + stamp + '#' + i;
            await kv.insertOne({ _id, value: value.slice(i * PART_CHARS, (i + 1) * PART_CHARS) });
            doc.parts.push(_id);
          }
        }
        if (ttlS) doc.expiresAt = new Date(Date.now() + ttlS * 1000);
        await kv.replaceOne({ _id: key }, doc, { upsert: true });
        if (old?.parts?.length) await kv.deleteMany({ _id: { $in: old.parts } });
      }),
    del: (key) =>
      withKv(async (kv) => {
        const old = await kv.findOne({ _id: key }, { projection: { parts: 1 } });
        await kv.deleteMany({ _id: { $in: [key, ...(old?.parts || [])] } });
      }),
  };
}
