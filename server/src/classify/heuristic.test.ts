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
