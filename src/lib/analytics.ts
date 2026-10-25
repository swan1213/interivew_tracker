import type { Cat, Email } from '@/data/types';
import { MN } from '@/data/constants';
import { addD, dObj } from './time';
import { effCat, needsAction } from './mail';

/** One email reduced to what Analytics counts. `d` is its age in days. */
export interface Rec { acct: string; cat: Cat; d: number; needs: boolean; company: string }

export const toRec = (e: Email): Rec => ({ acct: e.acct, cat: effCat(e), d: e.ago / 1440, needs: needsAction(e), company: e.company });

/** Mail that is part of the job search: not automated, uncertain, unrelated or your own sent mail. */
export const isRecruitment = (c: Cat): boolean => !['auto', 'review', 'other', 'sent'].includes(c);

/** Status mix buckets. Every category is in exactly one, so the bars add up to the email count. */
export const BUCKETS: { k: string; l: string; cats: Cat[]; color: string }[] = [
  { k: 'act', l: 'Action required', cats: ['action'], color: '#C0540C' },
  { k: 'inv', l: 'Invites & availability', cats: ['invite', 'avail'], color: '#7E3FD6' },
  { k: 'conf', l: 'Interview confirmed', cats: ['confirmed'], color: '#1E8A4C' },
  { k: 'app', l: 'Applications & updates', cats: ['applied', 'status'], color: '#0B7AB0' },
  { k: 'rej', l: 'Rejected', cats: ['rejected'], color: '#B4486A' },
  { k: 'off', l: 'Offers', cats: ['offer'], color: '#0F8F83' },
  { k: 'sent', l: 'Sent', cats: ['sent'], color: '#3F4A66' },
  { k: 'auto', l: 'Automated / other', cats: ['auto', 'review', 'other'], color: '#6B7390' },
];

export interface Funnel { applications: number; interviewed: number; responded: number; rejected: number; offers: number }

/**
 * The job search per company: each company you have recruitment mail with is one
 * application. It "responded" with anything beyond an application receipt, reached
 * an interview with an invitation, availability request or confirmation, and so on.
 */
export function funnel(recs: Rec[]): Funnel {
  const byCo = new Map<string, Set<Cat>>();
  for (const r of recs) {
    if (!r.company || !isRecruitment(r.cat)) continue;
    const k = r.company.trim().toLowerCase();
    (byCo.get(k) || byCo.set(k, new Set()).get(k)!).add(r.cat);
  }
  const groups = [...byCo.values()];
  const count = (f: (g: Set<Cat>) => boolean) => groups.filter(f).length;
  return {
    applications: groups.length,
    interviewed: count((g) => ['invite', 'avail', 'confirmed', 'offer'].some((c) => g.has(c as Cat))),
    responded: count((g) => [...g].some((c) => c !== 'applied')),
    rejected: count((g) => g.has('rejected')),
    offers: count((g) => g.has('offer')),
  };
}

/** "31%", or a dash when there is nothing to divide by. */
export const pct = (n: number, of: number, digits = 0): string => (of ? ((n / of) * 100).toFixed(digits) + '%' : '–');

export interface Week { label: string; emails: number; invites: number }

/** Recruitment emails and interview invitations per 7-day window, oldest first, ending today. */
export function weekly(recs: Rec[], today: string, weeks = 8): Week[] {
  return Array.from({ length: weeks }, (_, i) => {
    const w = weeks - 1 - i;
    const inWeek = recs.filter((r) => r.d >= w * 7 && r.d < w * 7 + 7 && isRecruitment(r.cat));
    const start = dObj(addD(today, -(w * 7 + 6)));
    return {
      label: MN[start.getUTCMonth()] + ' ' + start.getUTCDate(),
      emails: inWeek.length,
      invites: inWeek.filter((r) => ['invite', 'avail', 'confirmed'].includes(r.cat)).length,
    };
  });
}

/** Companies with the most recruitment mail, busiest first. */
export function byCompany(recs: Rec[], top = 8): [string, number][] {
  const n = new Map<string, { name: string; n: number }>();
  for (const r of recs) {
    if (!r.company || !isRecruitment(r.cat)) continue;
    const k = r.company.trim().toLowerCase();
    const row = n.get(k) || n.set(k, { name: r.company.trim(), n: 0 }).get(k)!;
    row.n++;
  }
  return [...n.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, top).map((x) => [x.name, x.n]);
}
