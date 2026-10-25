import { describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import type { InboxFilters } from './mail';
import { effCat, filterEmails, inView, matchSaved, previewOf, sortEmails } from './mail';

const base: InboxFilters = {
  view: 'inbox', acctFilter: 'all', catFilter: 'all', priFilter: 'all', coFilter: 'all', rangeFilter: 'all', ivFilter: 'all',
  unreadOnly: false, actionOnly: false, savedKey: '', q: '', sortKey: 'newest',
};
const data = buildDemoData();
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('inbox filtering', () => {
  it('shows everything in the unified view, newest first', () => {
    const rows = filterEmails(data.emails, base, data.apps);
    expect(rows).toHaveLength(12);
    expect(rows[0].id).toBe('e1');
    expect(rows[rows.length - 1].id).toBe('e12');
  });

  it('smart views match primary or secondary categories', () => {
    expect(ids(filterEmails(data.emails, { ...base, view: 'action' }, data.apps)).sort()).toEqual(['e1', 'e10', 'e2', 'e4', 'e7', 'e8', 'e9']);
    expect(ids(filterEmails(data.emails, { ...base, view: 'avail' }, data.apps)).sort()).toEqual(['e1', 'e10', 'e7']);
    expect(ids(filterEmails(data.emails, { ...base, view: 'auto' }, data.apps)).sort()).toEqual(['e11', 'e3', 'e8']);
    expect(ids(filterEmails(data.emails, { ...base, view: 'offers' }, data.apps))).toEqual(['e9']);
  });

  it('honors a user reclassification', () => {
    const e = { ...data.emails[2], catOv: 'review' as const };
    expect(effCat(e)).toBe('review');
    expect(inView(e, 'applied')).toBe(false);
  });

  it('applies account, priority, company and date filters', () => {
    expect(ids(filterEmails(data.emails, { ...base, acctFilter: 'w1' }, data.apps)).sort()).toEqual(['e12', 'e2', 'e7', 'e9']);
    expect(ids(filterEmails(data.emails, { ...base, priFilter: 'critical' }, data.apps)).sort()).toEqual(['e2', 'e9']);
    expect(ids(filterEmails(data.emails, { ...base, coFilter: 'Datadog' }, data.apps))).toEqual(['e4']);
    expect(filterEmails(data.emails, { ...base, rangeFilter: 'today' }, data.apps).every((e) => e.ago <= 1440)).toBe(true);
    expect(ids(filterEmails(data.emails, { ...base, ivFilter: 'confirmed' }, data.apps)).sort()).toEqual(['e2', 'e7', 'e9']);
  });

  it('searches across company, role, category label and body', () => {
    expect(ids(filterEmails(data.emails, { ...base, q: 'chime' }, data.apps))).toEqual(['e2']);
    expect(ids(filterEmails(data.emails, { ...base, q: 'offer' }, data.apps))).toContain('e9');
    expect(ids(filterEmails(data.emails, { ...base, q: 'interview scheduling' }, data.apps))).toContain('e1');
    expect(filterEmails(data.emails, { ...base, q: 'zzzz-nothing' }, data.apps)).toHaveLength(0);
  });

  it('saved filters', () => {
    const e1 = data.emails.find((e) => e.id === 'e1')!;
    const e10 = data.emails.find((e) => e.id === 'e10')!;
    expect(matchSaved(e1, 'reply')).toBe(true);
    expect(matchSaved(e10, 'reply')).toBe(false); // older than a day
    expect(matchSaved(e1, 'high')).toBe(true);
    expect(matchSaved({ ...e1, ivStatus: 'awaiting' }, 'wait')).toBe(true);
  });

  it('sorts by priority and by deadline', () => {
    const byPri = sortEmails(data.emails, 'priority');
    expect(byPri[0].pri).toBe('critical');
    expect(byPri[byPri.length - 1].pri).toBe('low');
    const byDl = sortEmails(data.emails, 'deadline');
    expect(byDl[0].deadlineKey).toBe('2026-10-27');
    expect(byDl[byDl.length - 1].deadlineKey).toBe('9999');
  });

  it('builds a preview from the body', () => {
    const p = previewOf(data.emails[0]);
    expect(p.startsWith('Thanks for your interest')).toBe(true);
    expect(p.length).toBeLessThanOrEqual(110);
  });
});
