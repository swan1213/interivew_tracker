import { describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import type { Email } from '@/data/types';
import type { InboxFilters } from './mail';
import { appliedDay, effCat, tidyBody, filterEmails, inView, matchSaved, participants, previewOf, rangeDays, receivedDay, senderName, sortEmails, type RangeFilter } from './mail';

const base: InboxFilters = {
  view: 'inbox', acctFilter: 'all', catFilter: 'all', priFilter: 'all', coFilter: 'all', peer: '', rangeFilter: 'all', rangeFrom: '', rangeTo: '', today: '2026-10-26', nowHour: 9.2, ivFilter: 'all',
  unreadOnly: false, actionOnly: false, savedKey: '', q: '', sortKey: 'newest',
};
const data = buildDemoData();
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('message body display', () => {
  it('drops zero-width padding and collapses blank runs', () => {
    const raw = 'Message from Spark Hire\n\n ‌͏ \n\n\n   \n \n\nHi Joshua,\n\n\n\nThanks.\n\n\n';
    expect(tidyBody(raw)).toBe('Message from Spark Hire\n\nHi Joshua,\n\nThanks.');
  });
});

describe('applied day', () => {
  it('reads "Oct 8" as this year, or last year when that is still ahead', () => {
    expect(appliedDay('Oct 8', '2026-10-27')).toBe('2026-10-08');
    expect(appliedDay('Dec 30', '2026-10-27')).toBe('2025-12-30');
    expect(appliedDay('', '2026-10-27')).toBe('');
  });
});

describe('inbox filtering', () => {
  it('shows everything in the unified view, newest first', () => {
    const rows = filterEmails(data.emails, base, data.apps);
    expect(rows).toHaveLength(12);
    expect(rows[0].id).toBe('e1');
    expect(rows[rows.length - 1].id).toBe('e12');
  });

  it('smart views match primary or secondary categories', () => {
    expect(ids(filterEmails(data.emails, { ...base, view: 'action' }, data.apps)).sort()).toEqual(['e1', 'e10', 'e2', 'e4', 'e7', 'e8', 'e9']);
    // e7 is a reschedule request: an action, not a request for availability.
    expect(ids(filterEmails(data.emails, { ...base, view: 'avail' }, data.apps)).sort()).toEqual(['e1', 'e10']);
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
    expect(ids(filterEmails(data.emails, { ...base, q: 'under review' }, data.apps))).toContain('e1');
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
    const byDl = sortEmails(data.emails, 'deadline', '2026-10-26');
    expect(byDl[0].deadlineKey).toBe('2026-10-27');
    expect(byDl[byDl.length - 1].deadlineKey).toBe('9999');
  });

  it('puts upcoming deadlines first and passed or missing ones after, newest first', () => {
    const mk = (id: string, deadlineKey: string, ago: number) => ({ id, deadlineKey, ago, needs: false }) as Email;
    const list = [mk('none-new', '9999', 5), mk('past', '2026-10-01', 1), mk('later', '2026-11-05', 50), mk('soon', '2026-10-27', 90), mk('bad', '', 2), mk('today', '2026-10-26', 300)];
    expect(sortEmails(list, 'deadline', '2026-10-26').map((e) => e.id)).toEqual(['today', 'soon', 'later', 'past', 'bad', 'none-new']);
  });

  it('builds a preview from the body', () => {
    const p = previewOf(data.emails[0]);
    expect(p.startsWith('Thanks for your interest')).toBe(true);
    expect(p.length).toBeLessThanOrEqual(110);
  });

  it('peer shows every conversation with one address, sent or received', () => {
    const emails = [
      { ...data.emails[0], id: 'in', fromAddr: 'Sam@Corp.example', peers: ['sam@corp.example'] },
      { ...data.emails[1], id: 'cc', fromAddr: 'ana@hire.example', peers: ['ana@hire.example', 'sam@corp.example'] },
      { ...data.emails[2], id: 'other', fromAddr: 'x@y.example', peers: ['x@y.example'] },
    ];
    expect(ids(filterEmails(emails, { ...base, peer: 'sam@corp.example' }, data.apps)).sort()).toEqual(['cc', 'in']);
  });
});

describe('date range filter', () => {
  const at = (ago: number) => ({ ago }) as Email;
  const range = (rangeFilter: RangeFilter, rangeFrom = '', rangeTo = '') => rangeDays({ rangeFilter, rangeFrom, rangeTo }, '2026-10-26');

  it('places an email on the calendar day it arrived, not a rolling 24 hours', () => {
    // 9:12 AM now: 9 hours ago is still today, 10 hours ago was last night.
    expect(receivedDay(at(9 * 60), '2026-10-26', 9.2)).toBe('2026-10-26');
    expect(receivedDay(at(10 * 60), '2026-10-26', 9.2)).toBe('2026-10-25');
    expect(receivedDay(at(9.2 * 60 + 1440), '2026-10-26', 9.2)).toBe('2026-10-25');
  });

  it('covers the expected days for each choice', () => {
    expect(range('today')).toEqual(['2026-10-26', '2026-10-26']);
    expect(range('yesterday')).toEqual(['2026-10-25', '2026-10-25']);
    expect(range('week')).toEqual(['2026-10-20', '2026-10-26']);
    expect(range('days30')).toEqual(['2026-09-27', '2026-10-26']);
    expect(range('month')).toEqual(['2026-10-01', '2026-10-26']);
    expect(range('lastMonth')).toEqual(['2026-09-01', '2026-09-30']);
    expect(range('custom', '2026-10-10', '2026-10-01')).toEqual(['2026-10-01', '2026-10-10']);
    expect(range('custom', '2026-10-10')).toEqual(['2026-10-10', '']);
    expect(range('all')).toEqual(['', '']);
  });

  it('filters the inbox by those days', () => {
    const all = filterEmails(data.emails, base, data.apps);
    const today = filterEmails(data.emails, { ...base, rangeFilter: 'today' }, data.apps);
    const older = filterEmails(data.emails, { ...base, rangeFilter: 'custom', rangeTo: '2026-10-25' }, data.apps);
    expect(today.length).toBeGreaterThan(0);
    expect(today.every((e) => receivedDay(e, base.today, base.nowHour) === '2026-10-26')).toBe(true);
    expect(today.length + older.length).toBe(all.length);
  });
});

describe('sender line', () => {
  const msg = (from: string, addr: string, mine = false) => ({ from, addr, when: '', body: '', mine });
  it('names machine senders after the company, else the sending domain', () => {
    expect(senderName('no-reply', 'no-reply@mindbodyonline.com', 'Playlist')).toBe('Playlist');
    expect(senderName('no-reply', 'no-reply@mindbodyonline.com')).toBe('Mindbodyonline');
    expect(senderName('', 'notifications@greenhouse.io')).toBe('Greenhouse');
    expect(senderName('Priya Raman', 'priya@example.com', 'Microsoft')).toBe('Priya Raman');
  });
  it('lists who took part, Gmail style', () => {
    const base = { fromName: 'Tom Nguyen', fromAddr: 'tom@atlassian.example', company: 'Atlassian' };
    expect(participants({ ...base, thread: [msg('Tom Nguyen', 'tom@atlassian.example')] })).toBe('Tom Nguyen');
    expect(participants({ ...base, thread: [msg('Tom Nguyen', 'tom@atlassian.example'), msg('Jordan Lee', 'j@x.example', true), msg('Tom Nguyen', 'tom@atlassian.example')] })).toBe('Tom, me');
    expect(participants({ ...base, thread: [msg('no-reply', 'no-reply@mindbodyonline.com'), msg('no-reply', 'no-reply@mindbodyonline.com')], company: 'Playlist' })).toBe('Playlist');
    expect(participants({ ...base, thread: [msg('Ann Lee', 'a@x'), msg('Bo Kim', 'b@x'), msg('Cy Ray', 'c@x'), msg('Di Fox', 'd@x')] })).toBe('Ann .. Di');
    expect(participants({ ...base, thread: [] })).toBe('Tom Nguyen');
  });
});
