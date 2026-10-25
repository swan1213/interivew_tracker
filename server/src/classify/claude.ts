/**
 * Model-based classifier. Runs only when ANTHROPIC_API_KEY is set; the rules
 * result is passed in as a baseline and as the fallback for any structured
 * field the model leaves empty.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Cat, EmailMode, Pri } from '../../../src/data/types';
import { cfg } from '../config';
import { stripQuoted } from '../mime';
import { fmtT, isoLocal, lab } from '../time';
import type { Classification, ParsedMessage, TimeHit } from '../types';

const CATS = ['action', 'invite', 'avail', 'confirmed', 'applied', 'status', 'rejected', 'auto', 'offer', 'review'] as const;

const Output = z.object({
  job_related: z.boolean().describe('False for mail with no connection to a job search (newsletters, personal mail, receipts).'),
  category: z.enum(CATS),
  secondary: z.enum([...CATS, 'none']).describe('A second category that also applies, or none.'),
  priority: z.enum(['critical', 'high', 'normal', 'low']),
  confidence: z.number().describe('0-100 confidence in the category.'),
  company: z.string().describe('Hiring company as named in the email; empty string if not stated.'),
  role: z.string().describe('Job title as stated; empty string if not stated.'),
  recruiter: z.string().describe("Sender's name if a person, else 'Automated (ATS)' for no-reply systems, else the team name."),
  stage: z.string().describe("Interview stage in a few words, e.g. 'Technical interview', 'HR screening', 'Offer'. Append '(inferred)' if not stated."),
  action: z.string().describe("What the reader must do, in one short imperative sentence, or 'None'."),
  deadline_text: z.string().describe("Deadline as the reader would say it, e.g. 'Tue, Oct 27 by 5:00 PM ET'; empty if none."),
  deadline_date: z.string().describe('Deadline as YYYY-MM-DD; empty if none.'),
  needs_action: z.boolean(),
  reply_kind: z.string().describe("Kind of reply expected, e.g. 'Availability reply', 'Interview confirmation', 'No-reply sender'."),
  mode: z.enum(['avail', 'confirm', 'resched', 'assess', 'none']).describe('avail = recruiter asks for times; confirm = interview time is fixed; resched = asks to move an existing interview; assess = take-home or online assessment.'),
  slots_requested: z.number().describe('How many time options the recruiter asked for (0 if not applicable).'),
  slot_minutes: z.number().describe('Meeting length in minutes if stated, else 0.'),
  window_dates: z.array(z.string()).describe('YYYY-MM-DD dates the recruiter offered for availability; empty if none stated.'),
  options: z.array(z.object({ date: z.string(), start_hour_et: z.number() })).describe('For a reschedule: each proposed time, in Eastern time decimal hours (13.5 = 1:30 PM).'),
  summary: z.string().describe('Two sentences, plain, stating only what the email says.'),
  facts: z.array(z.string()).describe('Up to 6 concrete statements taken from the email (dates, times, platform, people, attachments, deadlines).'),
  assumptions: z.array(z.string()).describe("Up to 3 things a reader might infer that the email does NOT state, each ending with '(not stated)' or '(inferred)'."),
  times: z.array(z.object({ date: z.string(), start_hour: z.number(), end_hour: z.number(), zone: z.string() })).describe('Concrete meeting times stated in the email, in the zone the email uses (zone label like ET, PT, UTC). end_hour = start_hour + 1 if no end is stated.'),
  platform: z.string().describe('Zoom, Teams, Google Meet, Amazon Chime, Phone, … or empty.'),
  link: z.string().describe('Meeting or assessment link if present, else empty.'),
  interviewer: z.string().describe('Interviewer or hiring manager name if stated, else empty.'),
  has_event: z.boolean().describe('True when a confirmed interview or scheduled call has a concrete date and time.'),
  event_date: z.string().describe('YYYY-MM-DD of that event, or empty.'),
  event_start_hour_et: z.number().describe('Start in Eastern time decimal hours, or 0.'),
  event_end_hour_et: z.number().describe('End in Eastern time decimal hours, or 0.'),
});
type Out = z.infer<typeof Output>;

const SYSTEM = `You classify emails for a job seeker's inbox and extract scheduling details. Work only from the email text and the thread context given. Never invent facts: if something is not stated, leave the field empty and, if useful, note it under assumptions.

Categories:
- action: the sender asks the reader to do something (send a resume, complete an assessment, pick a new time, sign a form).
- invite: an invitation to interview or to a call, without a fixed time yet.
- avail: the sender asks for the reader's availability or time options.
- confirmed: an interview or call with a fixed date and time.
- applied: an acknowledgement that an application was received.
- status: an update on an application with nothing to do.
- rejected: the reader is not moving forward.
- auto: automated mail with no personal request (job alerts, digests, no-reply notices).
- offer: a job offer or offer details.
- review: unclear, low-confidence, or does not fit.

Priority: offers and interviews within two days are critical; requests with deadlines, invitations and availability asks are high; updates are normal; acknowledgements, rejections and automated mail are low.

Time rules: dates are YYYY-MM-DD, resolved against the email's own date. Hours are decimal (9.5 = 9:30 AM, 15 = 3:00 PM). Convert to Eastern time where a field asks for ET (PT + 3, CT + 1, MT + 2, UTC - 4). A time preceded by "by", "before", "due", "no later than" is a deadline, not a meeting time. When an email asks to move an existing interview, the existing time is not an option; the alternatives are.

Separate what the email states from what a reader might infer. Facts quote or closely paraphrase the email. Assumptions are inferences and must say so.`;

let client: Anthropic | null = null;
const getClient = (): Anthropic => (client ||= new Anthropic({ apiKey: cfg.anthropicKey }));

function toHits(o: Out): TimeHit[] {
  return o.times
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    .map((t) => {
      const end = t.end_hour > t.start_hour ? t.end_hour : undefined;
      const zone = t.zone ? t.zone.toUpperCase() : undefined;
      return { date: t.date, start: t.start_hour, end, zone, kind: 'meeting' as const, label: lab(t.date) + ' · ' + fmtT(t.start_hour) + (end !== undefined ? '–' + fmtT(end) : '') + (zone ? ' ' + zone : '') };
    });
}

export async function classifyWithClaude(head: ParsedMessage, thread: ParsedMessage[], rules: Classification, now: Date = new Date()): Promise<Classification> {
  const body = stripQuoted(head.bodyText).slice(0, 12000);
  const earlier = thread
    .filter((m) => m.id !== head.id)
    .slice(-3)
    .map((m) => '--- ' + (m.isMine ? 'Reader' : m.fromName) + ' on ' + m.date.slice(0, 10) + ' ---\n' + stripQuoted(m.bodyText).slice(0, 1500))
    .join('\n\n');
  const user =
    'Today is ' + isoLocal(now) + '. The email below was received on ' + head.date.slice(0, 10) + '.\n\n' +
    'From: ' + head.fromName + ' <' + head.fromAddr + '>\nSubject: ' + head.subject + '\nAttachments: ' + (head.atts.map((a) => a.name).join(', ') || 'none') + '\n\n' +
    body + (earlier ? '\n\n=== Earlier messages in this thread ===\n' + earlier : '');

  const response = await getClient().messages.parse({
    model: cfg.anthropicModel,
    max_tokens: 8000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: zodOutputFormat(Output), effort: 'low' },
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('model declined to classify this message');
  const o = response.parsed_output;
  if (!o) throw new Error('model returned no structured output');

  const cat = o.category as Cat;
  const sec: Cat | '' = o.secondary === 'none' || o.secondary === o.category ? '' : (o.secondary as Cat);
  const mode: EmailMode | undefined = o.mode === 'none' ? undefined : o.mode;
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const deadlineKey = isoRe.test(o.deadline_date) ? o.deadline_date : rules.deadlineKey;
  const event =
    o.has_event && isoRe.test(o.event_date) && o.event_end_hour_et > o.event_start_hour_et
      ? { date: o.event_date, start: o.event_start_hour_et, end: o.event_end_hour_et }
      : rules.event;
  const windowDates = o.window_dates.filter((d) => isoRe.test(d));
  const opts = o.options.filter((x) => isoRe.test(x.date)).map((x) => [x.date, x.start_hour_et] as [string, number]);

  return {
    classifier: 'claude',
    jobRelated: o.job_related,
    cat,
    sec,
    pri: o.priority as Pri,
    conf: Math.max(0, Math.min(100, Math.round(o.confidence))),
    company: o.company || rules.company,
    role: o.role || rules.role,
    recruiter: o.recruiter || rules.recruiter,
    stage: o.stage,
    action: o.action || rules.action,
    deadline: o.deadline_text || (deadlineKey !== '9999' ? rules.deadline : ''),
    deadlineKey,
    needs: o.needs_action,
    canReply: rules.canReply,
    replyKind: o.reply_kind || rules.replyKind,
    mode,
    need: mode === 'avail' ? o.slots_requested || rules.need || 2 : mode === 'resched' ? 1 : undefined,
    slotLen: mode === 'avail' ? (o.slot_minutes ? o.slot_minutes / 60 : rules.slotLen || 1) : undefined,
    windowDates: mode === 'avail' ? (windowDates.length ? windowDates : rules.windowDates) : undefined,
    opts: mode === 'resched' ? (opts.length ? opts : rules.opts) : undefined,
    summary: o.summary || rules.summary,
    facts: o.facts.length ? o.facts.slice(0, 6) : rules.facts,
    assumptions: o.assumptions.slice(0, 3),
    times: toHits(o),
    platform: o.platform || rules.platform,
    link: o.link || rules.link,
    interviewer: o.interviewer || rules.interviewer,
    event,
  };
}
