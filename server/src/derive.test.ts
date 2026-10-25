import { describe, expect, it } from 'vitest';
import { calendarKey, conversationGroups } from './derive';
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
