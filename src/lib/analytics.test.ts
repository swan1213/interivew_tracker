import { describe, expect, it } from 'vitest';
import type { Cat } from '@/data/types';
import { BUCKETS, byCompany, funnel, pct, weekly, type Rec } from './analytics';

const r = (company: string, cat: Cat, d = 1): Rec => ({ acct: 'g1', cat, d, needs: false, company });

describe('analytics', () => {
  it('puts every category in exactly one status-mix bucket', () => {
    const cats: Cat[] = ['action', 'invite', 'avail', 'confirmed', 'applied', 'status', 'rejected', 'auto', 'offer', 'review', 'sent', 'other'];
    for (const c of cats) expect(BUCKETS.filter((b) => b.cats.includes(c))).toHaveLength(1);
  });

  it('counts the funnel per company, ignoring automated and unrelated mail', () => {
    const recs = [
      r('Acme', 'applied'), r('acme', 'invite'),
      r('Beta', 'applied'),
      r('Gamma', 'applied'), r('Gamma', 'rejected'),
      r('Delta', 'confirmed'), r('Delta', 'offer'),
      r('News Co', 'other'), r('Bot', 'auto'), r('', 'applied'),
    ];
    expect(funnel(recs)).toEqual({ applications: 4, interviewed: 2, responded: 3, rejected: 1, offers: 1 });
    expect(pct(2, 4, 1)).toBe('50.0%');
    expect(pct(1, 0)).toBe('–');
  });

  it('buckets the last weeks oldest first and ranks companies', () => {
    const recs = [r('Acme', 'applied', 0.5), r('Acme', 'invite', 2), r('Beta', 'applied', 8), r('Beta', 'auto', 3), r('Old', 'applied', 70)];
    const w = weekly(recs, '2026-10-25', 2);
    expect(w).toEqual([{ label: 'Oct 12', emails: 1, invites: 0 }, { label: 'Oct 19', emails: 2, invites: 1 }]);
    expect(byCompany(recs)).toEqual([['Acme', 2], ['Beta', 1], ['Old', 1]]);
  });
});
