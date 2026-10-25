import type { CalEvent } from '@/data/types';
import { provider } from '@/data/provider';
import { runtime } from '@/data/runtime';
import { loadJSON, saveJSON } from '@/lib/storage';

interface SyncedStore {
  getState(): { events: CalEvent[]; loading: boolean; say: (msg: string) => void };
  subscribe(fn: (s: { events: CalEvent[]; loading: boolean }) => void): () => void;
}

/** Everything Google Calendar shows for an interview; a change to any of it is pushed. */
const signature = (v: CalEvent): string => JSON.stringify([v.date, v.start, v.end, v.co, v.role, v.platform, v.link, v.interviewer, v.rem, v.pendingNote]);

/**
 * Mirrors the interviews on the app calendar to Google Calendar. Adding, moving,
 * renaming, re-timing a reminder or removing an interview is sent to the server
 * shortly after it happens. What was last sent is remembered per user, so a
 * reload pushes nothing and a change made while offline goes out next time.
 */
export function startCalendarSync(store: SyncedStore): void {
  const p = provider;
  if (!p.pushEvent || !p.removeEvent || !runtime.user || runtime.user.role === 'guest') return;
  const key = 'iflow.gcal.' + runtime.user.email;
  const sent: Record<string, string> = loadJSON<Record<string, string>>(key) || {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let warned = '';

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 800);
  };

  async function flush(): Promise<void> {
    const s = store.getState();
    // Until the first snapshot arrives the event list is empty, which would look like "remove everything".
    if (s.loading) return schedule();
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const want = new Map(s.events.filter((v) => v.kind === 'interview' && v.added).map((v) => [v.id, v]));
      for (const [id, v] of want) {
        const sig = signature(v);
        if (sent[id] === sig) continue;
        await p.pushEvent!(v);
        sent[id] = sig;
        saveJSON(key, sent);
      }
      for (const id of Object.keys(sent)) {
        if (want.has(id)) continue;
        await p.removeEvent!(id);
        delete sent[id];
        saveJSON(key, sent);
      }
      warned = '';
    } catch (e) {
      // Say it once; the next calendar change retries.
      const msg = (e as Error).message;
      if (msg !== warned) store.getState().say('Google Calendar: ' + msg);
      warned = msg;
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  }

  let last = store.getState().events;
  store.subscribe((s) => {
    if (s.events === last) return;
    last = s.events;
    schedule();
  });
  schedule();
}
