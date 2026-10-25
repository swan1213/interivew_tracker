import { describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import { mergeSnapshot } from './merge';

describe('merging a server snapshot with local workflow state', () => {
  const server = buildDemoData();

  it('server owns mail and flags; local keeps overrides and done state', () => {
    const local = buildDemoData();
    local.emails = local.emails.map((e) => (e.id === 'e1' ? { ...e, catOv: 'status' as const, done: true, unread: false } : e));
    const serverCopy = { ...server, emails: server.emails.map((e) => (e.id === 'e1' ? { ...e, unread: true, body: 'updated body' } : e)) };
    const out = mergeSnapshot(local, serverCopy);
    const e1 = out.emails.find((e) => e.id === 'e1')!;
    expect(e1.catOv).toBe('status');
    expect(e1.conf).toBe(100);
    expect(e1.done).toBe(true);
    expect(e1.unread).toBe(true);
    expect(e1.body).toBe('updated body');
    expect(out.emails.some((e) => e.id === 'e-removed')).toBe(false);
  });

  it('local kanban moves survive and a differing server stage becomes a suggestion', () => {
    const local = buildDemoData();
    local.apps = local.apps.map((a) => (a.id === 'a1' ? { ...a, stage: 'tech' as const, locked: true, notes: 'prep notes' } : a.id === 'a2' ? { ...a, stage: 'review' as const, locked: false } : a));
    const out = mergeSnapshot(local, server);
    const a1 = out.apps.find((a) => a.id === 'a1')!;
    expect(a1.stage).toBe('tech');
    expect(a1.locked).toBe(true);
    expect(a1.notes).toBe('prep notes');
    expect(a1.ai).toBeNull();
    const a2 = out.apps.find((a) => a.id === 'a2')!;
    expect(a2.stage).toBe('review');
    expect(a2.ai).toEqual({ stage: 'confirmed', text: 'moving to Interview Confirmed based on the latest email.' });
  });

  it('events added locally stay added and moved times are kept', () => {
    const local = buildDemoData();
    local.events = local.events.map((v) => (v.id === 'v2' ? { ...v, added: true, start: 13, end: 14, rem: [10] } : v));
    const out = mergeSnapshot(local, server);
    expect(out.events.find((v) => v.id === 'v2')).toMatchObject({ added: true, start: 13, end: 14, rem: [10] });
  });

  it('new server items are added and read notifications stay read', () => {
    const local = { ...buildDemoData(), emails: [], apps: [], events: [] };
    local.notifs = local.notifs.map((n) => ({ ...n, unread: false }));
    const out = mergeSnapshot(local, server);
    expect(out.emails).toHaveLength(12);
    expect(out.apps).toHaveLength(16);
    expect(out.notifs.every((n) => !n.unread)).toBe(true);
    expect(out.accts).toEqual(server.accts);
  });

  it('Google Calendar busy blocks follow the server; stale ones are dropped', () => {
    const busy = (id: string, start: number) => ({ id, kind: 'busy' as const, co: 'Standup', role: 'Google Calendar', stage: 'busy' as const, date: '2026-10-27', start, end: start + 0.5, added: true });
    const local = { ...buildDemoData() };
    local.events = [...local.events, busy('gcal-g1-moved', 9), busy('gcal-g1-deleted', 13)];
    const out = mergeSnapshot(local, { ...server, events: [...server.events, busy('gcal-g1-moved', 10)] });
    expect(out.events.find((v) => v.id === 'gcal-g1-moved')?.start).toBe(10);
    expect(out.events.some((v) => v.id === 'gcal-g1-deleted')).toBe(false);
    // Hand-made busy blocks (the demo's) are local and stay.
    expect(out.events.some((v) => v.id === 'b1')).toBe(true);
  });
});
