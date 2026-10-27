import { describe, expect, it } from 'vitest';
import { b64url } from './crypto';
import { cleanBody, humanSize, messageHtml, parseAddress, parseMessage, sanitizeHtml, stripHtml, stripQuoted, type GmailMessage } from './mime';

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

describe('plain-text bodies that carry HTML', () => {
  it('turns escapes into the characters they stand for', () => {
    expect(cleanBody('Hi&nbsp;Joshua, we&#39;ll be in touch &mdash; thanks &amp; regards')).toBe("Hi Joshua, we'll be in touch — thanks & regards");
  });

  it('strips tags some senders put in the text part, and leaves ordinary text alone', () => {
    expect(cleanBody('Line one<br>Line two<p>Para</p>')).toBe('Line one\nLine two\nPara');
    expect(cleanBody('Salary: 5 < 6 and AT&T is fine')).toBe('Salary: 5 < 6 and AT&T is fine');
  });
});

describe('HTML bodies for display', () => {
  it('keeps layout and images, removes anything that could run or submit', () => {
    const raw =
      '<html><head><meta http-equiv="refresh" content="0;url=https://x.example"><base href="https://evil.example/"><link rel="stylesheet" href="https://x.example/a.css"><style>td{color:#333}</style></head>' +
      '<body onload="alert(1)"><script>alert(2)</script><table><tr><td>HOURS WORKED</td><td>15:14</td></tr></table>' +
      '<img src="https://img.example/logo.png" onerror="alert(3)"><a href="javascript:alert(4)">x</a><a href="https://hubstaff.com">Hubstaff</a>' +
      '<form action="https://x.example"><input name="p"></form><iframe src="https://x.example"></iframe></body></html>';
    const s = sanitizeHtml(raw);
    expect(s).toContain('<td>15:14</td>');
    expect(s).toContain('<img src="https://img.example/logo.png">');
    expect(s).toContain('<a href="https://hubstaff.com">');
    expect(s).toContain('<style>td{color:#333}</style>');
    expect(s).not.toMatch(/script|onload|onerror|javascript:|<meta|<base|<link|<form|<input|<iframe/i);
  });

  it('takes the text/html part of a message, or nothing', () => {
    const part = (mimeType: string, text: string) => ({ mimeType, body: { data: b64url(Buffer.from(text, 'utf8')), size: text.length } });
    const msg = (parts: ReturnType<typeof part>[]): GmailMessage => ({ id: 'h', threadId: 't', payload: { mimeType: 'multipart/alternative', parts } });
    expect(messageHtml(msg([part('text/plain', 'Hi'), part('text/html', '<p>Hi <b>there</b></p>')]))).toBe('<p>Hi <b>there</b></p>');
    expect(messageHtml(msg([part('text/plain', 'Hi')]))).toBe('');
  });
});
