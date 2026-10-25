import { describe, expect, it } from 'vitest';
import type { CalEvent } from '@/data/types';
import { layoutLanes } from './calendar';

const ev = (id: string, start: number, end: number): CalEvent => ({ id, kind: 'interview', co: id, role: '', stage: 'screen', date: '2026-10-27', start, end, added: true });
const lanes = (m: Map<string, { lane: number; lanes: number }>) => Object.fromEntries([...m].map(([id, l]) => [id, l.lane + '/' + l.lanes]));

describe('side-by-side lanes for overlapping events', () => {
  it('gives events at the same time their own columns', () => {
    expect(lanes(layoutLanes([ev('a', 10, 11), ev('b', 10, 11), ev('c', 10, 11)]))).toEqual({ a: '0/3', b: '1/3', c: '2/3' });
  });

  it('reuses a freed column and splits only the overlapping group', () => {
    const out = layoutLanes([ev('long', 9, 12), ev('x', 9.5, 10), ev('y', 10, 10.5), ev('later', 13, 14)]);
    expect(lanes(out)).toEqual({ long: '0/2', x: '1/2', y: '1/2', later: '0/1' });
  });

  it('treats short events by their drawn height', () => {
    expect(lanes(layoutLanes([ev('a', 10, 10.1), ev('b', 10.2, 10.5)]))).toEqual({ a: '0/1', b: '0/1' });
    expect(lanes(layoutLanes([ev('a', 10, 10.1), ev('b', 10.2, 10.5)], 0.5))).toEqual({ a: '0/2', b: '1/2' });
  });
});
