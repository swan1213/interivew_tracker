import { describe, expect, it } from 'vitest';
import { buildSnapshot, calendarKey, conversationGroups } from './derive';
import type { CalEvent } from '../../src/data/types';
import type { Classification, StoredAccount } from './types';
import type { ParsedMessage, StoredThread } from './types';

const eid = (id: string) => Buffer.from(id + ' me@gmail.com').toString('base64url');
const msg = (threadId: string, subject: string, date: string, body = ''): ParsedMessage => ({
  id: threadId + '-m', threadId, fromName: 'Devin Collins', fromAddr: 'devin@lumalabs.ai', to: 'me@gmail.com', subject, date,
  bodyText: body, atts: [], labelIds: ['INBOX'], messageId: '', inReplyTo: '', references: '', isMine: false,
});
const thread = (id: string, subject: string, date: string, body = ''): StoredThread => ({ id, messages: [msg(id, subject, date, body)] });

describe('conversationGroups', () => {
  it('folds calendar notices for one event into the latest thread', () => {
    const link = 'https://calendar.google.com/calendar/event?action=VIEW&eid=' + eid('abc123');
    const groups = conversationGroups([
      thread('t1', 'Invitation from an unknown sender: Luma | Interview - Joshua Shin @ Wed Oct 28, 2026 10pm - 10:30pm (ADT) (me@gmail.com)', '2026-10-23T10:00:00Z', link),
      thread('t2', 'Updated invitation: Luma | Interview - Joshua Shin @ Wed Oct 28, 2026 9pm - 9:30pm (ADT) (me@gmail.com)', '2026-10-23T11:00:00Z', link),
      thread('t3', 'Canceled event from an unknown sender: Luma | Interview - Joshua Shin @ Wed Oct 28, 2026 9pm (ADT) (me@gmail.com)', '2026-10-23T12:00:00Z', link),
      thread('t4', 'Your application to Luma', '2026-10-22T09:00:00Z'),
    ]);
    expect([...groups.keys()].sort()).toEqual(['t3', 't4']);
    expect(groups.get('t3')!.map((t) => t.id)).toEqual(['t3', 't2', 't1']);
  });

  it('falls back to organizer and title when there is no event link', () => {
    const a = thread('a', 'Invitation: Interview - Joshua Shin @ Wed Oct 28, 2026 10pm (ADT) (me@gmail.com)', '2026-10-23T10:00:00Z');
    const b = thread('b', 'Canceled event: Interview - Joshua Shin @ Wed Oct 28, 2026 10pm (ADT) (me@gmail.com)', '2026-10-23T11:00:00Z');
    expect(calendarKey(a)).toBe(calendarKey(b));
    expect(calendarKey(thread('c', 'Interview - Joshua Shin', '2026-10-23T10:00:00Z'))).toBe('');
  });
});

describe('interviews from calendar invitations', () => {
  const acct = { id: 'g1', email: 'me@gmail.com', name: 'Me', provider: 'Gmail', color: '#3F6FD8', initial: 'M', refreshToken: '', accessToken: '', expiresAt: 0, lastSync: null, scopes: ['https://www.googleapis.com/auth/calendar.events'] } as StoredAccount;
  const now = new Date('2026-10-26T12:00:00Z');
  const invite = (): StoredThread => {
    const t = thread('t1', 'Invitation: Interview - Joshua Shin @ Wed Oct 28, 2026 10pm (ADT) (me@gmail.com)', '2026-10-25T10:00:00Z', 'Join: https://calendar.google.com/calendar/event?action=VIEW&eid=' + eid('abc123'));
    t.classification = { cat: 'confirmed', company: 'Luma', stage: 'Interview', times: [], facts: [], assumptions: [], event: { date: '2026-10-28', start: 21, end: 21.5 } } as unknown as Classification;
    return t;
  };
  const busy = (id: string): CalEvent => ({ id: 'gcal-g1-' + id, kind: 'busy', co: 'Interview - Joshua Shin', role: 'Google Calendar', stage: 'busy', date: '2026-10-28', start: 21, end: 21.5, added: true, acct: 'g1' });
  const snap = (cal?: CalEvent[]) => buildSnapshot([acct], { g1: { threads: { t1: invite() }, skipped: [], lastSync: null } }, now, cal ? { g1: cal } : {});

  it('points at the event on Google Calendar instead of adding a copy', () => {
    const s = snap([busy('abc123')]);
    expect(s.events).toEqual([]);
    expect(s.emails[0].evId).toBe('gcal-g1-abc123');
  });

  it('drops the interview once the event is deleted in Google Calendar', () => {
    const s = snap([busy('other')]);
    expect(s.events).toEqual([]);
    expect(s.emails[0]).toMatchObject({ evId: undefined, evRemoved: true });
  });

  it('keeps its own event while the calendar has not been synced', () => {
    expect(snap().events.map((v) => v.id)).toEqual(['ev-g1:t1']);
  });
});
