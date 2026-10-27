import type { Account, ActivityItem, Application, CalEvent, DataSnapshot, Email, Notif } from './types';

/** The demo workspace is anchored to a fixed Monday so the sample data stays coherent. */
export const DEMO_TODAY = '2026-10-26';
export const DEMO_NOW_HOUR = 9.2;

type EmailSeed = Omit<Email, 'thread'> & { thread?: Email['thread'] };

export function buildDemoData(): DataSnapshot {
  const accts: Account[] = [
    { id: 'g1', label: 'Personal Gmail', addr: 'jordan.lee@gmail.com', provider: 'Gmail', color: '#3F6FD8', initial: 'G', sendAs: 'Jordan Lee', sync: 'Synced 1 min ago' },
    { id: 'o1', label: 'Outlook Job Search', addr: 'jlee.career@outlook.com', provider: 'Outlook', color: '#0F7C8C', initial: 'O', sendAs: 'Jordan Lee', sync: 'Synced 3 min ago' },
    { id: 'w1', label: 'Leeworks Workspace', addr: 'jordan@leeworks.io', provider: 'Google Workspace', color: '#B4531A', initial: 'W', sendAs: 'Jordan Lee, Leeworks', sync: 'Synced 1 min ago' },
  ];

  const seeds: EmailSeed[] = [
    {
      id: 'e1', acct: 'g1', fromName: 'Priya Raman', fromAddr: 'priya.raman@msft-recruiting.example', company: 'Microsoft', role: 'Software Engineer II, Azure Platform', recruiter: 'Priya Raman',
      subject: 'Your availability for a 45-minute hiring manager conversation', ago: 38, time: '8:34 AM', cat: 'avail', sec: 'invite', pri: 'high', conf: 96, unread: true, starred: false, needs: true, ivStatus: 'none',
      stage: 'Hiring manager conversation (inferred)', action: 'Reply with three available time slots', deadline: '', deadlineKey: '9999', mode: 'avail', need: 3, slotLen: 0.75,
      windowDates: ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'], canReply: true, replyKind: 'Availability reply',
      summary: 'Priya wants three time options between Oct 27 and Oct 30 for a 45-minute call with the hiring manager, Daniel Okafor. A Teams link follows once a time is agreed.',
      facts: ['Asks for three possible times between Tue Oct 27 and Fri Oct 30', 'Call is 45 minutes with hiring manager Daniel Okafor', 'A Teams link will be sent after a time is confirmed'],
      assumptions: ['No reply deadline is stated; about 2 business days is a typical expectation', 'This is the hiring manager stage, inferred from the description'],
      times: [],
      body: "Hi Jordan,\n\nThanks for your interest in the Software Engineer II role on our Azure Platform team. We'd like to set up a 45-minute conversation with the hiring manager, Daniel Okafor.\n\nCould you share three times that work for you between Tuesday, Oct 27 and Friday, Oct 30? Please include your time zone.\n\nA Teams link will be sent once we lock in a time.\n\nBest,\nPriya Raman\nSenior Technical Recruiter, Microsoft (fictional demo)",
    },
    {
      id: 'e2', acct: 'w1', fromName: 'Elena Brooks', fromAddr: 'elena.brooks@amzn-talent.example', company: 'Amazon', role: 'SDE II, Retail Systems', recruiter: 'Elena Brooks',
      subject: 'Confirmed: Technical interview, Tue Oct 27 at 11:00 AM ET', ago: 95, time: '7:37 AM', cat: 'confirmed', sec: '', pri: 'critical', conf: 98, unread: true, starred: true, needs: true, ivStatus: 'confirmed',
      stage: 'Technical interview', action: 'Add the interview to your calendar and review the guide', deadline: '', deadlineKey: '2026-10-27', mode: 'confirm', evId: 'v2', canReply: true, replyKind: 'Interview confirmation',
      summary: 'Amazon confirmed a 1-hour technical interview on Tuesday, Oct 27 from 11:00 AM to 12:00 PM ET over Amazon Chime with Marcus Hale. An interview guide is attached.',
      facts: ['Date and time: Tue Oct 27, 11:00 AM to 12:00 PM ET', 'Platform: Amazon Chime, link in the email', 'Interviewer: Marcus Hale, SDE III', 'Interview guide PDF attached'],
      assumptions: ['The session likely includes live coding (the format is not stated)'],
      times: [{ label: 'Tue, Oct 27 · 11:00 AM–12:00 PM ET' }],
      atts: [{ name: 'Interview_Guide.pdf', size: '214 KB' }],
      body: "Hi Jordan,\n\nGreat news: your technical interview is confirmed.\n\nDate: Tuesday, October 27\nTime: 11:00 AM to 12:00 PM ET\nFormat: Amazon Chime (link: chime.example/interview/7421)\nInterviewer: Marcus Hale, SDE III\n\nPlease review the attached interview guide beforehand and join a couple of minutes early.\n\nBest,\nElena Brooks\nAmazon University Recruiting (fictional demo)",
    },
    {
      id: 'e3', acct: 'o1', fromName: 'Stripe Careers', fromAddr: 'no-reply@stripe-jobs.example', company: 'Stripe', role: 'Backend Engineer, Payments', recruiter: 'Automated (ATS)',
      subject: 'We received your application: Backend Engineer, Payments', ago: 140, time: '6:52 AM', cat: 'applied', sec: 'auto', pri: 'low', conf: 99, unread: false, starred: false, needs: false, ivStatus: 'none',
      stage: 'Application received', action: 'None. No reply needed', deadline: '', deadlineKey: '9999', canReply: false, replyKind: 'No-reply sender',
      summary: 'Automated acknowledgment that Stripe received your application. It is not an interview invitation.',
      facts: ['Application for Backend Engineer, Payments was received', 'Sent from a no-reply address'], assumptions: ['A recruiter will review it in the coming weeks (not stated)'], times: [],
      body: "Hi Jordan,\n\nThank you for applying to Stripe. We have received your application for Backend Engineer, Payments and our team will review it.\n\nThis is an automated message, please do not reply.\n\nStripe Talent (fictional demo)",
    },
    {
      id: 'e4', acct: 'g1', fromName: 'Hannah Weiss', fromAddr: 'hannah.weiss@ddog-hiring.example', company: 'Datadog', role: 'Senior Software Engineer, Observability', recruiter: 'Hannah Weiss',
      subject: 'Could you send an updated resume?', ago: 190, time: '6:02 AM', cat: 'action', sec: '', pri: 'high', conf: 94, unread: true, starred: false, needs: true, ivStatus: 'none',
      stage: 'Resume review', action: 'Send an updated resume (PDF)', deadline: 'Tue, Oct 27 by 5:00 PM ET', deadlineKey: '2026-10-27', canReply: true, replyKind: 'Additional information',
      summary: 'Hannah asks for an updated resume that highlights recent distributed-systems work, due by end of day tomorrow.',
      facts: ['Requests an updated resume, PDF preferred', 'Deadline: Tue Oct 27, 5:00 PM ET', 'Wants recent distributed-systems projects highlighted'], assumptions: ['The resume gates an interview invitation (not stated)'], times: [],
      body: "Hi Jordan,\n\nThanks for applying for the Senior Software Engineer, Observability role. Before we move you to the next step, could you send an updated resume (PDF preferred) that highlights your most recent distributed-systems work?\n\nIf you can get it to me by 5:00 PM ET tomorrow, Tuesday, that would be ideal.\n\nThank you,\nHannah Weiss\nTalent Partner, Datadog (fictional demo)",
    },
    {
      id: 'e5', acct: 'o1', fromName: 'Shopify Talent', fromAddr: 'talent-updates@shopify-careers.example', company: 'Shopify', role: 'Staff Developer, Checkout', recruiter: 'Talent team',
      subject: 'An update on your application', ago: 1380, time: 'Sun', cat: 'status', sec: '', pri: 'normal', conf: 91, unread: true, starred: false, needs: false, ivStatus: 'none',
      stage: 'Team review', action: 'None required', deadline: '', deadlineKey: '9999', canReply: true, replyKind: 'Recruiter follow-up',
      summary: 'Your application moved to team review. Shopify says this can take up to two weeks. No action needed.',
      facts: ['Application is now in team review', 'Review can take up to two weeks'], assumptions: ['No interview has been scheduled yet'], times: [],
      body: "Hi Jordan,\n\nA quick update: your application for Staff Developer, Checkout is now with the hiring team for review. This stage can take up to two weeks. We will be in touch with next steps.\n\nThank you for your patience,\nShopify Talent Team (fictional demo)",
    },
    {
      id: 'e6', acct: 'g1', fromName: 'Coinbase Recruiting', fromAddr: 'recruiting@cb-careers.example', company: 'Coinbase', role: 'Software Engineer, Payments Infra', recruiter: 'Recruiting team',
      subject: 'Your application to Coinbase', ago: 2900, time: 'Oct 24', cat: 'rejected', sec: '', pri: 'low', conf: 97, unread: false, starred: false, needs: false, ivStatus: 'none',
      stage: 'Closed', action: 'None. Consider a short thank-you', deadline: '', deadlineKey: '9999', canReply: true, replyKind: 'Gracious reply',
      summary: 'Coinbase decided not to move forward with your application for this role.',
      facts: ['Decision: will not proceed with your application', 'Role: Software Engineer, Payments Infra'], assumptions: ['Future roles may still be open to you (not stated)'], times: [],
      body: "Hi Jordan,\n\nThank you for your interest in Coinbase. After careful consideration we have decided to move forward with other candidates for the Software Engineer, Payments Infra role.\n\nWe appreciate the time you invested and wish you the best in your search.\n\nCoinbase Recruiting (fictional demo)",
    },
    {
      id: 'e7', acct: 'w1', fromName: 'Tom Nguyen', fromAddr: 'tom.nguyen@atl-people.example', company: 'Atlassian', role: 'Senior Engineer, Jira Platform', recruiter: 'Tom Nguyen',
      subject: 'Re: Interview this Wednesday: can we reschedule?', ago: 70, time: '8:02 AM', cat: 'action', sec: 'avail', pri: 'high', conf: 95, unread: true, starred: false, needs: true, ivStatus: 'confirmed',
      stage: 'Hiring manager interview (reschedule requested)', action: 'Choose one of the three new times', deadline: '', deadlineKey: '2026-10-28', mode: 'resched', need: 1, evId: 'v3', canReply: true, replyKind: 'Rescheduling reply',
      summary: "Tom needs to move Wednesday's 3:00 PM ET hiring manager interview and offers three alternatives. The original time stays on your calendar until a new one is confirmed.",
      facts: ['Original: Wed Oct 28, 3:00 PM ET', 'Option 1: Tue Oct 27, 11:30 AM ET', 'Option 2: Thu Oct 29, 1:00 PM ET', 'Option 3: Fri Oct 30, 10:30 AM ET', 'The same Zoom link will be reused'], assumptions: ['Interview length stays at 1 hour (not restated)'],
      times: [{ label: 'Tue, Oct 27 · 11:30 AM' }, { label: 'Thu, Oct 29 · 1:00 PM' }, { label: 'Fri, Oct 30 · 10:30 AM' }],
      opts: [['2026-10-27', 11.5], ['2026-10-29', 13], ['2026-10-30', 10.5]],
      thread: [{ from: 'Tom Nguyen', addr: 'tom.nguyen@atl-people.example', when: 'Wed, Oct 21 · 4:15 PM', body: "Hi Jordan,\n\nYour hiring manager interview is set for Wednesday, Oct 28 at 3:00 PM ET on Zoom (zoom.example/j/553108). Looking forward to it.\n\nTom" }],
      body: "Hi Jordan,\n\nI'm so sorry to ask, but something came up on our side. Could we move Wednesday's interview (Oct 28, 3:00 PM ET)? I can offer:\n\n• Tuesday, Oct 27 at 11:30 AM ET\n• Thursday, Oct 29 at 1:00 PM ET\n• Friday, Oct 30 at 10:30 AM ET\n\nThe same Zoom link will work. Thanks for your flexibility.\n\nTom Nguyen\nPeople Partner, Atlassian (fictional demo)",
    },
    {
      id: 'e8', acct: 'o1', fromName: 'Vercel Talent Platform', fromAddr: 'no-reply@vercel-talent.example', company: 'Vercel', role: 'Developer Experience Engineer', recruiter: 'Automated (ATS)',
      subject: 'Your technical assessment is ready. Complete by Oct 30', ago: 260, time: '4:52 AM', cat: 'action', sec: 'auto', pri: 'high', conf: 93, unread: true, starred: false, needs: true, ivStatus: 'none',
      stage: 'Technical assessment', action: 'Complete the 90-minute take-home assessment', deadline: 'Fri, Oct 30 by 11:59 PM PT', deadlineKey: '2026-10-30', mode: 'assess', canReply: false, replyKind: 'No-reply sender, cannot reply',
      summary: 'Automated invitation to a 90-minute take-home assessment. It came from a no-reply address but contains a real deadline, so it is surfaced as actionable.',
      facts: ['Assessment length: about 90 minutes', 'Deadline: Fri Oct 30, 11:59 PM PT', 'Link to the assessment is in the email'], assumptions: ['The link expires at the deadline (not stated)', 'Passing it leads to a technical interview (inferred from the process)'], times: [],
      body: "Hi Jordan,\n\nYou have been invited to complete a technical assessment for Developer Experience Engineer. The assessment takes about 90 minutes and must be submitted by Friday, October 30 at 11:59 PM PT.\n\nStart here: assess.vercel-talent.example/jlee\n\nThis is an automated message from our applicant tracking system. Replies are not monitored.\n\nVercel Talent (fictional demo)",
    },
    {
      id: 'e9', acct: 'w1', fromName: 'Grace Imani', fromAddr: 'grace.imani@northwind-cloud.example', company: 'Northwind Cloud', role: 'Senior Platform Engineer', recruiter: 'Grace Imani',
      subject: 'Offer letter and next steps: Senior Platform Engineer', ago: 330, time: '3:42 AM', cat: 'offer', sec: 'action', pri: 'critical', conf: 97, unread: true, starred: true, needs: true, ivStatus: 'confirmed',
      stage: 'Offer', action: "Review the attached offer letter and join today's call", deadline: 'Mon, Nov 2', deadlineKey: '2026-11-02', canReply: true, replyKind: 'Offer discussion', evId: 'v1',
      summary: 'Northwind Cloud extended an offer. Compensation and terms are in the attached letter (not quoted in the email). A call is set for today at 3:30 PM ET and a signed copy is requested by Nov 2.',
      facts: ['Offer letter and benefits overview attached', 'Call today, 3:30 to 4:00 PM ET on Zoom', 'Signed letter requested by Mon Nov 2'], assumptions: ['Terms are negotiable (not stated)'],
      times: [{ label: 'Today · 3:30–4:00 PM ET' }],
      atts: [{ name: 'Offer_Letter.pdf', size: '188 KB' }, { name: 'Benefits_Overview.pdf', size: '402 KB' }],
      body: "Hi Jordan,\n\nWe're delighted to extend an offer for the Senior Platform Engineer role. The full offer letter and a benefits overview are attached.\n\nI've set a call for today, 3:30 to 4:00 PM ET (zoom.example/j/884201) to walk through the details and answer questions. If everything looks good, please return the signed letter by Monday, November 2.\n\nCongratulations,\nGrace Imani\nHead of Talent, Northwind Cloud (fictional demo)",
    },
    {
      id: 'e10', acct: 'g1', fromName: 'Lena Fischer', fromAddr: 'lena.fischer@halcyon-health.example', company: 'Halcyon Health', role: 'Full-Stack Engineer', recruiter: 'Lena Fischer',
      subject: 'Invitation: HR screening call', ago: 2050, time: 'Sat', cat: 'invite', sec: 'avail', pri: 'normal', conf: 90, unread: true, starred: false, needs: true, ivStatus: 'none',
      stage: 'HR screening', action: 'Share a time for a 30-minute screening call', deadline: '', deadlineKey: '9999', mode: 'avail', need: 2, slotLen: 0.5, windowDates: ['2026-10-27', '2026-10-28', '2026-10-29'], canReply: true, replyKind: 'Availability reply',
      summary: 'Halcyon Health invites you to a 30-minute HR screening and asks which time early this week suits you.',
      facts: ['30-minute HR screening call', 'Asks for a time early next week'], assumptions: ['Call will be by phone or video (not stated)'], times: [],
      body: "Hi Jordan,\n\nWe'd like to invite you to a 30-minute HR screening call for the Full-Stack Engineer role. Please let me know which time early next week works for you and I'll send an invite.\n\nBest,\nLena Fischer\nTalent Acquisition, Halcyon Health (fictional demo)",
    },
    {
      id: 'e11', acct: 'o1', fromName: 'JobBoard Alerts', fromAddr: 'alerts@jobboard.example', company: '', role: '', recruiter: '',
      subject: '12 new roles match: Senior Engineer, Remote', ago: 600, time: 'Sun', cat: 'auto', sec: '', pri: 'low', conf: 99, unread: false, starred: false, needs: false, ivStatus: 'none',
      stage: '', action: 'None. Job alert digest', deadline: '', deadlineKey: '9999', canReply: false, replyKind: 'No-reply sender',
      summary: 'Daily job alert digest. It contains no recruiter message and no deadline.', facts: ['12 new listings matched your saved search'], assumptions: [], times: [],
      body: "12 new roles match your saved search: Senior Engineer, Remote.\n\nView all listings on JobBoard. To stop these alerts, update your preferences.\n\n(fictional demo)",
    },
    {
      id: 'e12', acct: 'w1', fromName: 'Sam Ortiz', fromAddr: 'sam.ortiz@lumen-robotics.example', company: 'Lumen Robotics', role: '', recruiter: 'Sam Ortiz',
      subject: 'Quick question about your background', ago: 4300, time: 'Oct 23', cat: 'review', sec: '', pri: 'normal', conf: 41, unread: true, starred: false, needs: false, ivStatus: 'none',
      stage: '', action: 'Decide whether to reply', deadline: '', deadlineKey: '9999', canReply: true, replyKind: 'Clarifying reply',
      summary: 'Low-confidence message. It could be recruiter outreach or networking, but no role or request is named.', facts: ['Sender is at Lumen Robotics', 'Asks for a short chat; no role mentioned'], assumptions: ['Could be talent sourcing (unverified)', 'Could be a networking intro via a mutual contact (unverified)'], times: [],
      body: "Hi Jordan,\n\nA friend mentioned you're doing interesting work. Do you have a few minutes sometime to chat about what you're up to? No specific role in mind yet.\n\nSam Ortiz\nLumen Robotics (fictional demo)",
    },
  ];

  const emails: Email[] = seeds.map((s) => {
    const thread = (s.thread || []).concat([{ from: s.fromName, addr: s.fromAddr, when: s.time, body: s.body, atts: s.atts || [], first: true }]);
    return { ...s, thread: thread.slice(-2) };
  });

  const acctLabel = (id: string) => accts.find((a) => a.id === id)?.label ?? 'an account';
  const appSeeds: Omit<Application, 'timeline'>[] = [
    { id: 'a1', co: 'Microsoft', role: 'Software Engineer II, Azure', stage: 'review', applied: 'Oct 8', acct: 'g1', pri: 'high', next: 'Waiting on your availability', activity: 'Recruiter asked for times, 38 min ago', action: 'Send 3 time slots', emailId: 'e1', notes: '', locked: false, ai: null },
    { id: 'a2', co: 'Amazon', role: 'SDE II, Retail Systems', stage: 'review', applied: 'Oct 3', acct: 'w1', pri: 'critical', next: 'Tue Oct 27, 11:00 AM ET (not on calendar yet)', activity: 'Technical interview confirmed, 95 min ago', action: 'Add to calendar, review guide', emailId: 'e2', notes: '', locked: false, ai: null },
    { id: 'a3', co: 'Stripe', role: 'Backend Engineer, Payments', stage: 'applied', applied: 'Oct 26', acct: 'o1', pri: 'low', next: '', activity: 'Application received, 2h ago', action: 'None', emailId: 'e3', notes: '', locked: false, ai: null },
    { id: 'a4', co: 'Datadog', role: 'Senior SWE, Observability', stage: 'review', applied: 'Oct 14', acct: 'g1', pri: 'high', next: '', activity: 'Resume requested, 3h ago', action: 'Send resume by Oct 27, 5 PM', emailId: 'e4', notes: '', locked: false, ai: null },
    { id: 'a5', co: 'Shopify', role: 'Staff Developer, Checkout', stage: 'review', applied: 'Oct 11', acct: 'o1', pri: 'normal', next: '', activity: 'Moved to team review, yesterday', action: 'None', emailId: 'e5', notes: '', locked: false, ai: null },
    { id: 'a6', co: 'Coinbase', role: 'SWE, Payments Infra', stage: 'closed', applied: 'Oct 2', acct: 'g1', pri: 'low', next: '', activity: 'Rejected, Oct 24', action: 'None', emailId: 'e6', notes: '', locked: false, ai: null },
    { id: 'a7', co: 'Atlassian', role: 'Senior Engineer, Jira Platform', stage: 'first', applied: 'Sep 29', acct: 'w1', pri: 'high', next: 'Wed Oct 28, 3:00 PM ET (reschedule requested)', activity: 'Reschedule request, 70 min ago', action: 'Pick a new time', emailId: 'e7', notes: '', locked: false, ai: null },
    { id: 'a8', co: 'Vercel', role: 'Developer Experience Engineer', stage: 'review', applied: 'Oct 15', acct: 'o1', pri: 'high', next: 'Assessment due Oct 30', activity: 'Assessment invitation, 4h ago', action: 'Complete assessment', emailId: 'e8', notes: '', locked: false, ai: null },
    { id: 'a9', co: 'Northwind Cloud', role: 'Senior Platform Engineer', stage: 'offer', applied: 'Sep 18', acct: 'w1', pri: 'critical', next: 'Offer call today, 3:30 PM ET', activity: 'Offer letter received, 5h ago', action: 'Review offer, sign by Nov 2', emailId: 'e9', notes: '', locked: false, ai: null },
    { id: 'a10', co: 'Halcyon Health', role: 'Full-Stack Engineer', stage: 'review', applied: 'Oct 17', acct: 'g1', pri: 'normal', next: '', activity: 'Screening invitation, Sat', action: 'Share a time', emailId: 'e10', notes: '', locked: false, ai: null },
    { id: 'a11', co: 'Orbit Systems', role: 'Principal Engineer', stage: 'first', applied: 'Sep 22', acct: 'w1', pri: 'high', next: 'Final panel, Tue Nov 3, 1:00 PM ET', activity: 'Panel confirmed, Oct 22', action: 'Prepare system design talk', emailId: '', notes: '', locked: false, ai: null },
    { id: 'a12', co: 'Fathom Data', role: 'Staff Data Engineer', stage: 'first', applied: 'Sep 30', acct: 'o1', pri: 'normal', next: 'Awaiting feedback', activity: 'Technical round done, Oct 22', action: 'Send thank-you note', emailId: '', notes: '', locked: false, ai: null },
    { id: 'a13', co: 'Cobalt AI', role: 'ML Platform Engineer', stage: 'applied', applied: 'Oct 25', acct: 'g1', pri: 'normal', next: '', activity: 'Applied via careers page', action: 'None', emailId: '', notes: '', locked: false, ai: null },
    { id: 'a14', co: 'Meridian Labs', role: 'Backend Engineer', stage: 'applied', applied: 'Oct 24', acct: 'o1', pri: 'low', next: '', activity: 'Applied via referral', action: 'None', emailId: '', notes: '', locked: false, ai: { stage: 'review', text: 'moving to Under Review: your referrer says the team is reading your resume.' } },
    { id: 'a15', co: 'Nimbus Cloud', role: 'Site Reliability Engineer', stage: 'closed', applied: 'Sep 12', acct: 'g1', pri: 'low', next: '', activity: 'Position filled, Oct 9', action: 'None', emailId: '', notes: '', locked: false, ai: null },
    { id: 'a16', co: 'Pioneer Bank Tech', role: 'Senior Java Engineer', stage: 'review', applied: 'Oct 9', acct: 'w1', pri: 'normal', next: '', activity: 'Recruiter reviewing, Oct 20', action: 'Follow up Nov 2', emailId: '', notes: '', locked: false, ai: null },
  ];
  const apps: Application[] = appSeeds.map((a) => {
    const timeline = [{ text: 'Applied through ' + acctLabel(a.acct), when: a.applied, src: 'You', cls: 'cat-applied' }];
    if (a.activity) timeline.unshift({ text: a.activity, when: 'Latest', src: 'Email', cls: 'cat-status' });
    return { ...a, timeline };
  });

  const events: CalEvent[] = [
    { id: 'v1', kind: 'interview', co: 'Northwind Cloud', role: 'Offer discussion call', stage: 'offer', date: '2026-10-26', start: 15.5, end: 16, platform: 'Zoom', link: 'zoom.example/j/884201', interviewer: 'Grace Imani', emailId: 'e9', added: true, rem: [1440, 60] },
    { id: 'v2', kind: 'interview', co: 'Amazon', role: 'Technical interview, SDE II', stage: 'tech', date: '2026-10-27', start: 11, end: 12, platform: 'Amazon Chime', link: 'chime.example/interview/7421', interviewer: 'Marcus Hale', emailId: 'e2', added: false, rem: [1440, 60] },
    { id: 'v3', kind: 'interview', co: 'Atlassian', role: 'Hiring manager interview', stage: 'mgr', date: '2026-10-28', start: 15, end: 16, platform: 'Zoom', link: 'zoom.example/j/553108', interviewer: 'Tom Nguyen', emailId: 'e7', added: true, rem: [1440, 60], pendingNote: '' },
    { id: 'v4', kind: 'interview', co: 'Orbit Systems', role: 'Final panel interview', stage: 'final', date: '2026-11-03', start: 13, end: 15, platform: 'Google Meet', link: 'meet.example/orb-final', interviewer: 'Panel of 4', emailId: '', added: true, rem: [1440, 60] },
    { id: 'v5', kind: 'interview', co: 'Microsoft', role: 'Recruiter screen', stage: 'screen', date: '2026-10-22', start: 14, end: 14.5, platform: 'Teams', link: 'teams.example/m/2201', interviewer: 'Priya Raman', emailId: '', added: true, rem: [60] },
    { id: 'v6', kind: 'interview', co: 'Fathom Data', role: 'Technical interview', stage: 'tech', date: '2026-10-22', start: 10.5, end: 11.5, platform: 'Zoom', link: 'zoom.example/j/110947', interviewer: 'Ravi Menon', emailId: '', added: true, rem: [60] },
    { id: 'b1', kind: 'busy', co: 'Dentist', role: 'Personal', stage: 'busy', date: '2026-10-26', start: 14, end: 15, added: true },
    { id: 'b2', kind: 'busy', co: 'Lunch with Sam', role: 'Personal', stage: 'busy', date: '2026-10-28', start: 12, end: 13, added: true },
    { id: 'b3', kind: 'busy', co: 'Doctor appointment', role: 'Personal', stage: 'busy', date: '2026-10-29', start: 13, end: 14, added: true },
    { id: 'b4', kind: 'busy', co: 'Current job: team sync', role: 'Work calendar (Microsoft)', stage: 'busy', date: '2026-10-27', start: 15, end: 15.5, added: true },
  ];

  const notifs: Notif[] = [
    { id: 'n1', title: 'New availability request', text: 'Microsoft wants three times for a hiring manager call.', time: '38 min ago', unread: true, cat: 'avail', emailId: 'e1' },
    { id: 'n2', title: 'Interview confirmed', text: 'Amazon technical interview, Tue 11:00 AM ET. Not on your calendar yet.', time: '95 min ago', unread: true, cat: 'confirmed', emailId: 'e2' },
    { id: 'n3', title: 'Interview rescheduling requested', text: 'Atlassian asked to move Wed Oct 28 at 3:00 PM ET.', time: '70 min ago', unread: true, cat: 'action', emailId: 'e7' },
    { id: 'n4', title: 'Scheduling conflict detected', text: "Atlassian's Thu 1:00 PM option overlaps your doctor appointment.", time: '70 min ago', unread: true, cat: 'review', emailId: 'e7' },
    { id: 'n5', title: 'Offer received', text: 'Northwind Cloud sent an offer letter. Call today at 3:30 PM ET.', time: '5h ago', unread: true, cat: 'offer', emailId: 'e9' },
    { id: 'n6', title: 'Recruiter requesting information', text: 'Datadog needs an updated resume by Tue 5:00 PM ET.', time: '3h ago', unread: false, cat: 'action', emailId: 'e4' },
    { id: 'n7', title: 'Assessment deadline approaching', text: 'Vercel assessment is due Fri Oct 30, 11:59 PM PT.', time: '4h ago', unread: false, cat: 'action', emailId: 'e8' },
    { id: 'n8', title: 'Upcoming interview', text: 'Northwind Cloud call today at 3:30 PM ET. Reminder set for 1 hour before.', time: 'Today', unread: false, cat: 'confirmed', emailId: 'e9' },
  ];

  const activity: ActivityItem[] = [
    { text: 'Microsoft asked for your availability', time: '38 min ago', cls: 'cat-avail' },
    { text: 'Atlassian requested a reschedule', time: '70 min ago', cls: 'cat-action' },
    { text: 'Amazon confirmed your technical interview', time: '95 min ago', cls: 'cat-confirmed' },
    { text: 'Datadog requested an updated resume', time: '3 hours ago', cls: 'cat-action' },
    { text: 'Stripe acknowledged your application', time: '2 hours ago', cls: 'cat-applied' },
    { text: 'Coinbase application marked Rejected / Closed', time: 'Oct 24', cls: 'cat-rejected' },
  ];

  return { accts, emails, apps, events, notifs, activity };
}
