import { describe, expect, it } from 'vitest';
import { demoAsGmail, MOCK_USER } from '../google/mock';
import { parseMessage } from '../mime';
import type { ParsedMessage } from '../types';
import { classifyHeuristic, extractCompany, isJobRelated } from './heuristic';

// Anchor "now" to the demo's own clock so dates line up with the fixture text.
const NOW = new Date('2026-10-26T09:12:00');
const byThread = new Map<string, ParsedMessage[]>();
for (const m of demoAsGmail(NOW)) {
  const p = parseMessage(m, MOCK_USER.email);
  (byThread.get(p.threadId) || byThread.set(p.threadId, []).get(p.threadId)!).push(p);
}
const head = (id: string): ParsedMessage => {
  const msgs = byThread.get('t-' + id)!.sort((a, b) => a.date.localeCompare(b.date));
  return msgs[msgs.length - 1];
};
const cls = (id: string) => classifyHeuristic(head(id), NOW);

describe('rule-based classifier on the demo mailbox', () => {
  it('availability request: category, slots, window, company, role, recruiter', () => {
    const c = cls('e1');
    expect(c.cat).toBe('avail');
    expect(c.sec).toBe('invite');
    expect(c.mode).toBe('avail');
    expect(c.need).toBe(3);
    expect(c.slotLen).toBeCloseTo(0.75);
    expect(c.windowDates).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(c.company).toBe('Microsoft');
    expect(c.role).toContain('Software Engineer II');
    expect(c.recruiter).toBe('Priya Raman');
    expect(c.interviewer).toBe('Daniel Okafor');
    expect(c.needs).toBe(true);
    expect(c.pri).toBe('high');
  });

  it('confirmed interview: event in ET, platform, interviewer, attachment fact', () => {
    const c = cls('e2');
    expect(c.cat).toBe('confirmed');
    expect(c.mode).toBe('confirm');
    expect(c.event).toEqual({ date: '2026-10-27', start: 11, end: 12 });
    expect(c.platform).toBe('Amazon Chime');
    expect(c.interviewer).toBe('Marcus Hale');
    expect(c.company).toBe('Amazon');
    expect(c.pri).toBe('critical');
    expect(c.times[0].label).toBe('Tue, Oct 27 · 11:00 AM–12:00 PM ET');
    expect(c.facts.some((f) => /Interview_Guide\.pdf/.test(f))).toBe(true);
    expect(c.summary).toBe('Great news: your technical interview is confirmed. Please review the attached interview guide beforehand and join a couple of minutes early.');
  });

  it('automated acknowledgement from a no-reply address', () => {
    const c = cls('e3');
    expect(c.cat).toBe('applied');
    expect(c.sec).toBe('auto');
    expect(c.canReply).toBe(false);
    expect(c.needs).toBe(false);
    expect(c.company).toBe('Stripe');
    expect(c.role).toBe('Backend Engineer, Payments');
    expect(c.recruiter).toBe('Automated (ATS)');
  });

  it('information request with a relative deadline', () => {
    const c = cls('e4');
    expect(c.cat).toBe('action');
    expect(c.deadlineKey).toBe('2026-10-27');
    expect(c.deadline).toBe('Tue, Oct 27 by 5:00 PM ET');
    expect(c.company).toBe('Datadog');
    expect(c.role).toBe('Senior Software Engineer, Observability');
    expect(c.action).toMatch(/resume/i);
  });

  it('status update, rejection and low-confidence outreach', () => {
    expect(cls('e5').cat).toBe('status');
    expect(cls('e5').company).toBe('Shopify');
    expect(cls('e5').role).toBe('Staff Developer, Checkout');
    expect(cls('e6').cat).toBe('rejected');
    expect(cls('e6').company).toBe('Coinbase');
    const r = cls('e12');
    expect(r.cat).toBe('review');
    expect(r.conf).toBeLessThan(50);
    expect(r.company).toBe('Lumen Robotics');
    expect(r.recruiter).toBe('Sam Ortiz');
  });

  it('reschedule request: three options, original time excluded', () => {
    const c = cls('e7');
    expect(c.cat).toBe('action');
    expect(c.mode).toBe('resched');
    expect(c.sec).toBe('avail');
    expect(c.opts).toEqual([
      ['2026-10-27', 11.5],
      ['2026-10-29', 13],
      ['2026-10-30', 10.5],
    ]);
    expect(c.company).toBe('Atlassian');
    expect(c.platform).toBe('Zoom');
  });

  it('assessment from a no-reply system is actionable with a deadline in PT', () => {
    const c = cls('e8');
    expect(c.cat).toBe('action');
    expect(c.mode).toBe('assess');
    expect(c.sec).toBe('auto');
    expect(c.needs).toBe(true);
    expect(c.canReply).toBe(false);
    expect(c.deadlineKey).toBe('2026-10-30');
    expect(c.deadline).toBe('Fri, Oct 30 by 11:59 PM PT');
    expect(c.link).toBe('assess.vercel-talent.example/jlee');
    expect(c.company).toBe('Vercel');
    expect(c.role).toBe('Developer Experience Engineer');
  });

  it('offer with a call today and a signing deadline', () => {
    const c = cls('e9');
    expect(c.cat).toBe('offer');
    expect(c.pri).toBe('critical');
    expect(c.company).toBe('Northwind Cloud');
    expect(c.role).toBe('Senior Platform Engineer');
    expect(c.deadlineKey).toBe('2026-11-02');
    expect(c.event).toEqual({ date: '2026-10-26', start: 15.5, end: 16 });
    expect(c.platform).toBe('Zoom');
  });

  it('invitation that also asks for a time', () => {
    const c = cls('e10');
    expect(c.cat).toBe('invite');
    expect(c.sec).toBe('avail');
    expect(c.mode).toBe('avail');
    expect(c.need).toBe(2);
    expect(c.slotLen).toBeCloseTo(0.5);
    expect(c.windowDates!.length).toBeGreaterThan(0);
    expect(c.company).toBe('Halcyon Health');
    expect(c.role).toBe('Full-Stack Engineer');
  });

  it('job alert digest is automated and still job related', () => {
    const c = cls('e11');
    expect(c.cat).toBe('auto');
    expect(c.company).toBe('JobBoard');
    expect(isJobRelated(head('e11'))).toBe(true);
  });

  it('non-job mail is filtered out', () => {
    const p: ParsedMessage = { ...head('e12'), subject: 'Dinner on Friday?', bodyText: 'Hey, are we still on for dinner Friday? Let me know. Sam', fromAddr: 'sam@friends.example', fromName: 'Sam' };
    expect(isJobRelated(p)).toBe(false);
  });

  it('company extraction falls back from signature to sender name to domain', () => {
    const base = head('e12');
    expect(extractCompany({ ...base, fromName: 'Acme Talent Team', bodyText: 'Hello there.' }, 'Hello there.')).toBe('Acme');
    expect(extractCompany({ ...base, fromName: 'Jane Doe', fromAddr: 'jane@globex.com', bodyText: 'Hello there.' }, 'Hello there.')).toBe('Globex');
    expect(extractCompany({ ...base, fromName: 'Jane Doe', fromAddr: 'jane@gmail.com', bodyText: 'Hello there.' }, 'Hello there.')).toBe('');
  });
});

describe('receipts that describe the hiring process', () => {
  const pm = (subject: string, bodyText: string): ParsedMessage => ({
    id: 'x', threadId: 'tx', fromName: 'Wizcorp Ltd', fromAddr: 'notification@smartrecruiters.com', to: 'me@gmail.com', subject, date: '2026-10-23T22:14:00Z',
    bodyText, atts: [], labelIds: ['INBOX'], messageId: '', inReplyTo: '', references: '', isMine: false,
  });

  it('is an application receipt, not an offer, when it only mentions a formal offer later on', () => {
    const c = classifyHeuristic(pm('Application Received - now what?', 'Hi&nbsp;Joshua,\nThanks for expressing interest in&nbsp;Keywords Studios. We&#39;ll take about five&nbsp;to ten business days to review your application. We&#39;ll start talking to you about a formal offer.'), NOW);
    expect(c.cat).not.toBe('offer');
    expect(c.pri).not.toBe('critical');
    expect(c.summary).not.toContain('&nbsp;');
  });

  it('ignores offers mentioned in a fraud warning, and reads curly apostrophes', () => {
    const c = classifyHeuristic(
      pm(
        'Senior Data Engineer - Adoreal',
        'Dear Joshua,\nThank you for your interest in joining Adoreal! We’ve received your application for Senior Data Engineer.\n\n' +
          'Recruitment Fraud Notice\nAdoreal has become aware of fraudulent job offers being sent by people falsely claiming to represent us. ' +
          'Never share personal details, banking information, or Social Security numbers as part of a job offer or interview. ' +
          'Legitimate offers will never ask you to pay money upfront.',
      ),
      NOW,
    );
    expect(c.cat).toBe('applied');
    expect(c.pri).not.toBe('critical');
  });

  it('still treats a real offer as an offer', () => {
    expect(classifyHeuristic(pm('Your offer', 'We are pleased to offer you the Software Engineer position. Your offer letter is attached.'), NOW).cat).toBe('offer');
  });
});

describe('application receipts and no-reply scheduling', () => {
  const msg = (fromAddr: string, subject: string, bodyText: string): ParsedMessage => ({
    id: 'r', threadId: 'tr', fromName: 'Workable', fromAddr, to: 'me@gmail.com', subject, date: '2026-09-29T17:45:00Z',
    bodyText, atts: [], labelIds: ['INBOX'], messageId: '', inReplyTo: '', references: '', isMine: false,
  });

  it('a receipt carrying a copy of the application form is not a scheduling request', async () => {
    const { noReplyScheduling } = await import('./index');
    const form =
      'Whitespace\n\nYour application for the Software Engineer job was submitted successfully. Here is a copy of your application data.\n\n' +
      '** PERSONAL INFORMATION **\nName: Joshua Shin\n\nWhen would you be available to start? Available within 2 weeks.\n' +
      'Preferred interview times: weekdays after 2 PM, any day next week.\n2023 - 2026 Senior Software Developer at Five Rings';
    const c = noReplyScheduling(classifyHeuristic(msg('noreply@candidates.workablemail.com', 'Thanks for applying to Whitespace', form), NOW));
    expect(c.cat).toBe('applied');
    expect(c.mode).toBeUndefined();
    expect(c.needs).toBe(false);
  });

  it('a recruiter who thanks you for applying and asks for times is still asking', () => {
    const c = classifyHeuristic(msg('dana@acme.example', 'Thanks for applying to Acme', 'Hi Joshua, thanks for applying! Could you share a few times that work for a 30-minute call next week?'), NOW);
    expect(c.cat).toBe('avail');
    expect(c.mode).toBe('avail');
  });

  it('a no-reply sender asking for availability gets a booking action, not a reply-with-times flow', async () => {
    const { noReplyScheduling } = await import('./index');
    const raw = classifyHeuristic(msg('no-reply@greenhouse.example', 'Interview invitation: Acme', 'We would like to schedule an interview. Please let us know what times work for you next week: https://app.goodtime.example/book/abc'), NOW);
    const c = noReplyScheduling(raw);
    expect(c.mode).toBeUndefined();
    expect(c.need).toBeUndefined();
    expect(c.action).toMatch(/^(Book a time using the scheduling link|Follow the scheduling instructions)/);
  });
});
