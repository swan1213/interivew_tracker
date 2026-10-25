import { describe, expect, it } from 'vitest';
import { b64url } from './crypto';
import { humanSize, parseAddress, parseMessage, stripHtml, stripQuoted, type GmailMessage } from './mime';

describe('Gmail message parsing', () => {
  it('reads headers, prefers text/plain, collects attachments and flags', () => {
    const m: GmailMessage = {
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'UNREAD'],
      internalDate: String(Date.UTC(2026, 9, 26, 12, 34)),
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: '"Priya Raman" <priya@example.com>' },
          { name: 'To', value: 'me@gmail.com' },
          { name: 'Subject', value: 'Hello' },
          { name: 'Message-ID', value: '<abc@example.com>' },
        ],
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: b64url('Plain body\r\nline two'), size: 20 } },
              { mimeType: 'text/html', body: { data: b64url('<p>HTML body</p>'), size: 16 } },
            ],
          },
          { mimeType: 'application/pdf', filename: 'Guide.pdf', body: { attachmentId: 'a1', size: 219000 } },
        ],
      },
    };
    const p = parseMessage(m, 'me@gmail.com');
    expect(p.fromName).toBe('Priya Raman');
    expect(p.fromAddr).toBe('priya@example.com');
    expect(p.subject).toBe('Hello');
    expect(p.bodyText).toBe('Plain body\nline two');
    expect(p.atts).toEqual([{ name: 'Guide.pdf', size: '214 KB' }]);
    expect(p.labelIds).toContain('UNREAD');
    expect(p.messageId).toBe('<abc@example.com>');
    expect(p.isMine).toBe(false);
    expect(p.date).toBe('2026-10-26T12:34:00.000Z');
  });

  it('falls back to HTML and marks my own messages', () => {
    const m: GmailMessage = {
      id: 'm2',
      threadId: 't1',
      labelIds: ['SENT'],
      payload: {
        mimeType: 'text/html',
        headers: [{ name: 'From', value: 'me@gmail.com' }, { name: 'Date', value: 'Mon, 26 Oct 2026 08:00:00 GMT' }],
        body: { data: b64url('<div>Hi&nbsp;there<br>Thanks &amp; regards</div><style>p{}</style>') },
      },
    };
    const p = parseMessage(m, 'ME@gmail.com');
    expect(p.isMine).toBe(true);
    expect(p.bodyText).toBe('Hi there\nThanks & regards');
    expect(p.subject).toBe('(no subject)');
  });

  it('helpers', () => {
    expect(parseAddress('Jane <JANE@X.com>')).toEqual({ name: 'Jane', addr: 'jane@x.com' });
    expect(parseAddress('bob@x.com')).toEqual({ name: 'bob', addr: 'bob@x.com' });
    expect(humanSize(500)).toBe('500 B');
    expect(humanSize(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(stripHtml('<ul><li>a</li><li>b</li></ul>')).toBe('• a\n• b');
    expect(stripQuoted('New text\n\nOn Mon, Oct 26, 2026 at 9:00 AM Tom <t@x.com> wrote:\n> old\n> stuff')).toBe('New text');
  });
});
