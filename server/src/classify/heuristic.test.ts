import { describe, expect, it } from 'vitest';
import { demoAsGmail, MOCK_USER } from '../google/mock';
import { parseMessage } from '../mime';
import type { ParsedMessage } from '../types';
import { classifyHeuristic, extractCompany, isJobAlert, isJobRelated } from './heuristic';

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

describe('newsletters and mailing-list mail', () => {
  const nl = (fromAddr: string, subject: string, bodyText: string): ParsedMessage => ({
    id: 'n', threadId: 'tn', fromName: 'Samaya', fromAddr, to: 'me@gmail.com', subject, date: '2026-10-06T20:53:00Z',
    bodyText, atts: [], labelIds: ['INBOX'], messageId: '', inReplyTo: '', references: '', isMine: false,
  });

  it('a Substack post about landing a job offer is automated mail, not an offer', () => {
    const c = classifyHeuristic(
      nl('uxdesigncourses@substack.com', 'UX Challenge #5: How to answer the "tell me about your UX process" question in a UX job interview.',
        'View this post on the web at https://uxdesigncourses.substack.com/p/ux-challenge-5\n\nYour POV: you are interviewing for your dream UX job. Vish went through 5 rounds of interviews, finally landing a job offer. Join us on Sat Feb 20 at 3:00 PM ET.'),
      NOW,
    );
    expect(c.cat).toBe('auto');
    expect(c.needs).toBe(false);
  });

  it('mail with an unsubscribe footer is never an offer', () => {
    const c = classifyHeuristic(nl('news@careers.example', 'Career tips', 'How I got my job offer in 30 days.\nUnsubscribe from these emails.'), NOW);
    expect(c.cat).not.toBe('offer');
  });
});

describe('job alerts', () => {
  const alert = (fromAddr: string, subject: string, bodyText: string): ParsedMessage => ({
    id: 'j', threadId: 'tj', fromName: 'Virtual Vocations', fromAddr, to: 'me@gmail.com', subject, date: '2026-10-27T16:06:00Z',
    bodyText, atts: [], labelIds: ['INBOX'], messageId: '', inReplyTo: '', references: '', isMine: false,
  });
  const body =
    'Hello Yukimaru,\n\nNew telecommute jobs for Tuesday have been posted at virtualvocations.com.\nApply to 36,427 jobs now!\n\n' +
    'Be one of the first to apply and be considered for these positions.\n\n[Open to you] Building Systems Engineer\n' +
    "Interview available in the next few days. Next steps: let us know which times work.\n\nEmail alerts that match 'Engineering'\nAutomation QA Engineer";

  it('a job-alert digest is automated mail, whatever its listings say', () => {
    const c = classifyHeuristic(alert('jobalerts@alerts.virtualvocations.com', 'Apply for Automation QA Engineer', body), NOW);
    expect(c.cat).toBe('auto');
    expect(c.mode).toBeUndefined();
    expect(c.needs).toBe(false);
  });

  it("alert wording counts in bulk mail, not in a recruiter's own message", () => {
    expect(isJobAlert(alert('digest@jobs.example', 'New jobs for you', 'New jobs for you this week.\nUnsubscribe'))).toBe(true);
    const recruiter = alert('dana@acme.example', 'Interview at Acme', 'I found your profile through a job alert. Could you share a few times that work for a call next week?');
    expect(isJobAlert(recruiter)).toBe(false);
    expect(classifyHeuristic(recruiter, NOW).cat).toBe('avail');
  });
});

describe('offers with dates and deadlines', () => {
  const offer = (bodyText: string): ParsedMessage => ({
    id: 'o', threadId: 'to', fromName: 'Dana Reyes', fromAddr: 'dana@acme.example', to: 'me@gmail.com', subject: 'Your offer from Acme', date: '2026-10-23T15:00:00Z',
    bodyText, atts: [], labelIds: ['INBOX'], messageId: '', inReplyTo: '', references: '', isMine: false,
  });

  it('a real offer that mentions May or a deadline is still an offer', () => {
    expect(classifyHeuristic(offer('We are pleased to offer you the Software Engineer role, starting May 4.'), NOW).cat).toBe('offer');
    expect(classifyHeuristic(offer('Attached is your offer letter; please sign it before Friday.'), NOW).cat).toBe('offer');
  });

  it('a condition placed before the offer is not one', () => {
    expect(classifyHeuristic(offer('If the team agrees, we will extend you an offer next week.'), NOW).cat).not.toBe('offer');
  });
});

describe('receipts, calendar notices and booked interviews are not requests', () => {
  const msg = (fromAddr: string, subject: string, bodyText: string): ParsedMessage => ({
    id: 'm', threadId: 'tm', fromName: 'Recruiting', fromAddr, to: 'me@gmail.com', subject, date: '2026-10-28T15:00:00Z',
    bodyText, atts: [], labelIds: ['INBOX'], messageId: '', inReplyTo: '', references: '', isMine: false,
  });
  const c = (fromAddr: string, subject: string, bodyText: string) => classifyHeuristic(msg(fromAddr, subject, bodyText), NOW);

  it('a receipt that describes a possible assessment later is a receipt', () => {
    const r = c('no-reply@boomi.com', 'Thanks for applying for the Senior Presales Systems Engineer role with Boomi!',
      'Your application has been received.\nIf we determine it\'s a match, we\'ll reach out to schedule the next steps. This is typically an interview with the Hiring Manager but could include an assessment.');
    expect(r.cat).toBe('applied');
    expect(r.mode).toBeUndefined();
  });

  it('a receipt saying a recruiter will contact you if selected is a receipt', () => {
    const r = c('collegeboard@myworkday.com', 'College Board: Thank You for Applying',
      "We've received your application for the position of Full Stack Engineer.\n*If selected, a recruiter will contact you to schedule a phone or video screen.\nIt is a priority of ours to provide an update to every applicant by the time a search has been filled.");
    expect(r.cat).toBe('applied');
    const sga = c('humanresources@sgainc.com', 'Application Received for Job #26-02396', 'We have received your resume. Please feel free to update your information with us at any time.');
    expect(sga.cat).toBe('applied');
  });

  it("a receipt whose privacy notice says \"after which time\" is a receipt", () => {
    const r = c('ascensushr@myworkday.com', 'Thank you for your application!',
      'Thank you for expressing interest in a career opportunity at Ascensus for the position of Software Engineer . The information you provided is currently being reviewed.\n\nHow long do we keep your data?\nIf you were not hired, your application will be held for a one-year period after which time it will be destroyed.');
    expect(r.cat).toBe('applied');
    expect(r.mode).toBeUndefined();
    const ask = c('jane@acme.com', 'Interview', 'Hi Gregory, we would like to meet. Which time works best for you: Tuesday or Wednesday?');
    expect(ask.cat).toBe('avail');
  });

  it('a receipt without receipt wording in the subject is still a receipt', () => {
    const r = c('no-reply@ashbyhq.com', 'Your FutureFit AI app is in good hands, Gregory!',
      "Thanks for applying for the Software Engineer role at FutureFit AI. We're excited to meet you! Our team will review yours for initial fit as soon as we can. We're committed to letting you know whether there's a fit either way.");
    expect(r.cat).toBe('applied');
  });

  it('a real assessment is still an assessment', () => {
    const r = c('no-reply@array.com', 'Array Next Steps', 'The next step in our process is several assessments. Assessment 1 takes 15 minutes: https://www.ondemandassessment.com/link/x');
    expect(r.cat).toBe('action');
    expect(r.mode).toBe('assess');
  });

  it("a calendar notice is a booked meeting: its Reschedule link asks nothing", () => {
    const r = c('valerie@mechanize.work', 'Invitation from an unknown sender: Joshua Shin and Valerie Kendrick @ Thu Oct 29, 2026 2:40pm - 3:10pm (PDT) (me@gmail.com)',
      "This event isn't in your calendar yet.\nEvent Name\nMechanize interview\nNeed to make changes to this event?\nCancel: https://calendly.com/cancellations/x\nReschedule: https://calendly.com/reschedulings/x");
    expect(r.cat).toBe('confirmed');
    expect(r.mode).toBeUndefined();
    expect(r.needs).toBe(false);
    expect(c('anthony@artemissecurity.com', 'Updated invitation: Artemis Interview (Virtual) @ Wed Oct 28, 2026 1pm - 1:30pm (ADT) (me@gmail.com)', 'This event has been updated\nChanged: time').cat).toBe('confirmed');
    expect(c('devin@lumalabs.ai', 'Canceled event from an unknown sender: Luma | Interview @ Wed Oct 28, 2026 10pm - 10:30pm (ADT)', 'This event has been canceled and removed from your calendar.').cat).toBe('status');
  });

  it('an interview reminder offering to reschedule is a booked interview', () => {
    const r = c('no-reply@bluevine.com', 'Interview reminder: Lead AI Solutions Engineer at Bluevine - US',
      'Reminder: Your interview with Bluevine - US is coming up.\nIf you have any questions or need to reschedule, please reach out.');
    expect(r.cat).toBe('confirmed');
  });

  it('a recruiter asking to reschedule is still a reschedule request', () => {
    const r = c('c-liz.houghton@rithum.com', 'Missed Interview – Next Steps',
      "We had an interview scheduled today, but it appears we missed each other. Please let me know if you're still interested in the role and would like to reschedule.");
    expect(r.mode).toBe('resched');
  });
});

describe('NiCE: roles and updates under an application subject', () => {
  const msg = (fromAddr: string, subject: string, bodyText: string): ParsedMessage => ({
    id: 'm', threadId: 'tm', fromName: 'NiCE', fromAddr, to: 'me@gmail.com', subject, date: '2026-10-28T15:00:00Z',
    bodyText, atts: [], labelIds: ['INBOX'], messageId: '', inReplyTo: '', references: '', isMine: false,
  });
  const c = (fromAddr: string, subject: string, bodyText: string) => classifyHeuristic(msg(fromAddr, subject, bodyText), NOW);

  it('reads the role after "the role of:" and "the following position:"', () => {
    expect(c('no-reply@eu.greenhouse-mail.io', 'Thank you for applying to NICE', 'Hi Joshua\nThanks for your interest in NiCE and your application for the role of: Senior Partner Success Implementation Engineer.\nSo, what happens next?').role)
      .toBe('Senior Partner Success Implementation Engineer');
    expect(c('jordan@nice.com', 'NICE Interview Confirmation', "We're happy to confirm your upcoming interview for the following position: Portfolio Solution Engineer, Actimize.\nInterview details:").role)
      .toBe('Portfolio Solution Engineer, Actimize');
  });

  it('a role that is no longer open is a rejection', () => {
    const r = c('no-reply@nice.com', 'Your Job Application – NiCE', 'Thanks for applying for the following role at NiCE: Software Engineer, AI.\nWe were impressed with your application; however, this role is no longer open.');
    expect(r.cat).toBe('rejected');
    expect(r.role).toBe('Software Engineer, AI');
  });

  it("a recruiter's reschedule note under an application subject is an update", () => {
    expect(c('jordan@nice.com', 'Regarding your application to NICE', 'Hi Josh, I need to reschedule your interview this morning. I just resent you my calendar link to reschedule.').cat).toBe('status');
  });
});
