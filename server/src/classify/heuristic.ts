/**
 * Rule-based classifier. It runs when no Anthropic API key is configured and as the
 * fallback when the model call fails. Every field the UI shows is derived here from
 * explicit patterns, so nothing is invented: when a fact is not in the text, the
 * field stays empty and the UI shows "Not stated".
 */
import type { Cat, EmailMode, Pri } from '../../../src/data/types';
import { addDays, businessDaysBetween, extractDateTimes, fmtT, isoLocal, lab, nextBusinessDays, zoneToEt } from '../time';
import type { Classification, ParsedMessage, TimeHit } from '../types';
import { cleanBody, stripQuoted } from '../mime';

/** Bumped whenever the rules change, so mail they classified earlier is classified again (no model involved). */
export const RULES_VERSION = 8;

/** Newsletter and blog platforms: their posts talk about offers and interviews but never make one. */
const NEWSLETTER_FROM = /@([\w-]+\.)*(substack\.com|beehiiv\.com|medium\.com|ghost\.io|buttondown\.email|convertkit\.com|kit\.com|mailchimp\.com|mcsv\.net|mailerlite\.com|sendinblue\.com|brevo\.com|hubspotemail\.net)$/i;
const NEWSLETTER_BODY = /\bview (this|the) (post|email|newsletter|issue) (on the web|online|in (your )?browser)\b|\bread (it )?online\b|\bmanage (your )?(subscription|email preferences)\b/i;

/**
 * Job-alert mailing lists ("New jobs have been posted", "Apply to 36,427 jobs now"). Their listings
 * are full of phrases like "available days" or "next steps" that read like a recruiter's request.
 */
const JOB_ALERT_FROM = /^(job-?)?alerts?@|@(job-?)?alerts?\.|^jobs?-?(no-?reply|alerts?|notifications?)@|^job-?alerts?[\w.+-]*@/i;
const JOB_ALERT_BODY = /\bjob alerts?\b|\bemail alerts? (that|which) match\b|\bnew [\w -]{0,30}\bjobs?\b[^.\n]{0,40}\bhave been posted\b|\bapply to [\d,]+ (new )?jobs\b|\bjobs? (that )?match(es|ing)? your (search|profile|preferences|alert)\b|\b(recommended|suggested) jobs for you\b|\bjobs you (may|might) (like|be interested in)\b|\bnew jobs? for you\b/i;

/** A job-alert digest: from an alerts address, or alert wording in bulk / no-reply mail. */
export function isJobAlert(p: Pick<ParsedMessage, 'fromAddr' | 'subject' | 'bodyText'>): boolean {
  if (JOB_ALERT_FROM.test(p.fromAddr)) return true;
  const text = p.subject + '\n' + p.bodyText.slice(0, 8000);
  return JOB_ALERT_BODY.test(text) && (/\bunsubscribe\b/i.test(text) || NOREPLY.test(p.fromAddr));
}

/** Subjects of application receipts ("Thanks for applying to X", "Application received"). */
const RECEIPT_SUBJECT = /\b(thanks? (you )?for (applying|your application|your interest|submitting)|application (received|submitted|confirmation|complete)|received your\b[^\n]{0,80}\bapplication|(we('ve)?|we have) got your application|we got your application|your application (to|for|at|with|has been|was|is in))\b/i;

/**
 * Notices a calendar sends about a meeting ("Invitation: Interview with X @ Tue Oct 13, 2026 11am",
 * "Updated invitation: ...", "Canceled event: ..."). The meeting is already on the calendar; their
 * "Reschedule" and "Add to calendar" links are not a request.
 */
const CAL_NOTICE = /^(?:(?:updated |new )?invitation(?: from an unknown sender)?|accepted|declined|tentatively accepted|reminder|appointment booked|(?:canceled|cancelled) (?:event|invitation)(?: from an unknown sender)?|event (?:canceled|cancelled))\s*:[^\n]*@ (?:mon|tue|wed|thu|fri|sat|sun)\b/i;
const CAL_CANCELED = /^(?:canceled|cancelled|event (?:canceled|cancelled))/i;

/**
 * Sentences about what may happen later ("if selected, a recruiter will contact you to schedule a screen",
 * "our process typically includes an assessment"). They describe the process; nobody is asking yet.
 */
const LATER = /\b(if (selected|we|you('re| are) (selected|shortlisted)|your (application|background|skills|experience|qualifications|profile|resume)|there('s| is) a (match|fit)|it's a (match|fit))|should (we|your)|once (we|your)|in the event|(will|'ll) (be in touch|reach out|contact you|get in touch|let you know)|may (include|involve)|could (include|involve)|typically|process (includes?|consists|involves|looks like)|what('s| is| happens) next|what to expect)\b/i;

/** "Reschedule" offered as an option (a link, "if you need to reschedule"), not asked for. */
const RESCHED_OPTION = /^\s*reschedule( (interview|meeting|event|call))?\s*$|\b(if you (need|have|want) to|(if|should) you\b[^.!?]{0,40}\bneed to reschedul\w*|should you need to|need to make changes|(link|here|button|page|click) to (cancel or )?reschedule|to cancel or reschedule|cancel(ling)? or reschedul\w*|reschedul\w* or cancel\w*|reschedule:|reschedule (here|this|your|using|via|through|by|at))\b|\breschedule\s*(<|\(|https?:)/i;
const ASSESS_TERM = /\b(assessments?|take-home|take home|coding challenge|hackerrank|codility|online test|technical test)\b/i;
/** Reminders and notices of a booked interview ("Interview reminder: ...", "Your interview with X is scheduled for ..."). */
const BOOKED_SUBJECT = /\b(interview|meeting|call) confirmation\b|\byou(['’]re| are) scheduled\b|\b(interview|meeting|call) reminder\b|\breminder\b[^\n]*\b(interview|meeting|call)\b|\b(interview|meeting|call)\b[^\n]*\bis (scheduled|confirmed|coming up|tomorrow|today)\b/i;

/** An assessment is assigned, not just mentioned: a link, a request to take it, or a reminder. */
const ASSESS_ASK = /\b(please|complete|take|start|begin|click|invit\w*|next step|link|access|finish|expires?|reminder|haven't completed|received the)\b/i;
/** Subjects that do ask to schedule, even when they also thank you for applying. */
const SCHEDULING_SUBJECT = /\b(interview|schedul\w*|availability|invitation|invite|next steps?|call|chat|meet)\b/i;

/**
 * Sentences that mention an offer without making one: scam warnings anywhere in the sentence, and
 * conditions placed before the offer ("if we extend an offer", "before an offer"). A condition after
 * it ("sign it before Friday") or the month May ("starting May 4") leaves a real offer alone.
 */
const OFFER_WARNING = /\b(fraud\w*|scam\w*|phishing|suspicious|falsely|impersonat\w*|never|beware|caution\w*)\b/i;
const OFFER_CONDITION = /\b([Ii]f|[Oo]nce|[Bb]efore|[Ww]hether|may|might|[Ss]hould you)\b(?=[^.!?]*\boffer)/;
const isHedged = (s: string): boolean => OFFER_WARNING.test(s) || OFFER_CONDITION.test(s);

const NOREPLY = /no-?reply|do-?not-?reply|^notifications?@|^alerts?@|mailer-daemon|^noreply|^news(letter)?@|^updates?@/i;
const NOREPLY_BODY = /\b(do not reply|please don't reply|replies are not monitored|automated (message|email|notification)|this (is an|mailbox is) (automated|unmonitored))\b/i;
const ORG_WORDS = /^(recruiting|recruitment|talent|careers?|team|hiring|people|hr|acquisition|partner|university|platform|alerts?|group|staffing|jobs?|notifications?|updates?|support|inc\.?|llc|ltd\.?|corp\.?)$/i;
const TITLE_WORD = /\b(engineer|developer|manager|designer|analyst|scientist|architect|lead|director|intern|specialist|consultant|sde|swe|researcher|administrator|technician|coordinator|associate|executive|officer|head of|principal|staff|senior|junior)\b/i;
const JOB_WORDS = /\b(interview|recruit\w*|application|applied|applying|position|role|roles|hiring|candidate|resume|résumé|cv|offer|assessment|talent|career|careers|job|jobs|opening|opportunity|screening|onboarding|take-home|hiring manager|referral)\b/i;
const CLOSING = /^(best|best regards|kind regards|regards|warm regards|thanks|thank you|many thanks|sincerely|cheers|congratulations|talk soon|all the best)[,!.]?\s*$/i;
const PERSON = /^[A-Z][a-z'’-]+(?: [A-Z][a-z'’-]+){1,2}$/;
/** Words that mark a capitalized phrase as an organization rather than a person. */
const COMPANY_WORDS = /^(robotics|cloud|labs?|systems?|technolog(?:y|ies)|tech|software|solutions?|health|healthcare|bank|data|ai|inc\.?|corp\.?|co\.?|llc|ltd\.?|group|team|talent|recruiting|recruitment|careers?|hiring|people|hr|acquisition|partners?|platform|alerts?|university|networks?|digital|media|studios?|games|capital|ventures?|energy|financial|finance|insurance|logistics|security|analytics|consulting|services|global|international|holdings|industries|engineering|dynamics|computing|mobile|interactive|foods?|retail|automotive|motors|airlines|pharma|biotech|therapeutics|sciences?|notifications?|updates?|support|jobs?|staffing|agency|associates|enterprises?|innovations?|intelligence|payments?|commerce|works|design|creative|marketing)$/i;
/** Lines like "Talent Partner, Datadog": the part before the comma must read as a job title. */
const SIG_TITLE = /(recruit|talent|partner|manager|director|head|lead|coordinator|specialist|acquisition|sourc|people|\bhr\b|human resources|engineer|officer|president|founder|ceo|cto|coo|hiring|associate|consultant|analyst|executive|assistant)/i;

export const isPerson = (s: string): boolean => {
  const t = (s || '').trim();
  if (!PERSON.test(t)) return false;
  return !t.split(/\s+/).some((w) => COMPANY_WORDS.test(w));
};

export function isJobRelated(p: ParsedMessage): boolean {
  return JOB_WORDS.test(p.subject + '\n' + p.bodyText.slice(0, 5000));
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, 'a couple of': 2, 'a few': 2, several: 3, some: 2 };

function cleanOrg(s: string): string {
  let words = s.replace(/\(.*?\)/g, '').replace(/[|•·].*$/, '').trim().split(/\s+/);
  while (words.length > 1 && ORG_WORDS.test(words[words.length - 1])) words.pop();
  while (words.length > 1 && /^(the|at|from)$/i.test(words[0])) words.shift();
  return words.join(' ').replace(/[,.;:]+$/, '').trim();
}

/** Company name from signature, sender name, subject, body or domain, in that order. */
export function extractCompany(p: ParsedMessage, body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-4);
  for (const raw of tail) {
    const line = raw.replace(/\(.*?\)/g, '').trim();
    if (!line || /@|https?:|\.com\b/i.test(line) || isPerson(line) || CLOSING.test(line)) continue;
    const comma = line.match(/^([A-Z][^,:]{2,40}),\s*([A-Z][\w&.'’ -]{1,40})$/);
    if (comma && SIG_TITLE.test(comma[1])) {
      const c = cleanOrg(comma[2]);
      if (c && !TITLE_WORD.test(c)) return c;
    }
    const atm = line.match(/\b(?:at|@)\s+([A-Z][\w&.'’-]+(?:\s+[A-Z][\w&.'’-]+){0,2})$/);
    if (atm) return cleanOrg(atm[1]);
    if (/^[A-Z][\w&.'’-]+(?:\s+[A-Z][\w&.'’-]+){0,3}$/.test(line) && !TITLE_WORD.test(line)) {
      const c = cleanOrg(line);
      if (c.length >= 3) return c;
    }
  }
  if (!isPerson(p.fromName) && /^[A-Z]/.test(p.fromName) && !/@/.test(p.fromName)) {
    const c = cleanOrg(p.fromName);
    if (c.length >= 3 && !/^(hi|hello|team)$/i.test(c)) return c;
  }
  const subj = p.subject.match(/\b(?:at|to|with|from|join)\s+([A-Z][\w&'’-]+(?:\s+[A-Z][\w&'’-]+)?)/);
  if (subj) return cleanOrg(subj[1]);
  const bodyM = body.match(/\b(?:applying to|interest in|application (?:to|with)|position at|role at|team at|opportunity at|join(?:ing)?|welcome to|offer from)\s+([A-Z][\w&'’-]+(?:\s+[A-Z][\w&'’-]+)?)/);
  if (bodyM) return cleanOrg(bodyM[1]);
  const dom = p.fromAddr.split('@')[1] || '';
  const label = dom.split('.')[0].replace(/-(recruiting|talent|careers?|jobs?|hiring|people|hr|mail|email)$/i, '');
  if (!label || /^(gmail|outlook|hotmail|yahoo|icloud|proton|mail)$/i.test(label)) return '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function extractRole(p: ParsedMessage, body: string): string {
  const colon = p.subject.match(/:\s*([A-Z][^\n]{3,80})$/);
  if (colon && TITLE_WORD.test(colon[1]) && !/\b(confirmed|interview|invitation)\b/i.test(colon[1])) return colon[1].trim();
  const subjFor = p.subject.match(/\bfor (?:the |an? |our )?([A-Z][^\n:]{3,80}?)(?:\s+(?:role|position|opening|opportunity))?\s*$/);
  if (subjFor && TITLE_WORD.test(subjFor[1])) return subjFor[1].trim();
  const pats = [
    /\b(?:for|in|to) (?:the|our|an?) ([A-Z][\w\s,/&+-]{3,70}?) (?:role|position|opening|opportunity|team)\b/,
    /\bapplication for ([A-Z][\w\s,/&+-]{3,70}?) (?:is|has|was|at|with)\b/,
    /\b(?:offer|assessment|interview) for (?:the )?([A-Z][\w\s,/&+-]{3,70}?)(?:\.|,? (?:role|position)|\n)/,
    /\brole of ([A-Z][\w\s,/&+-]{3,70}?)[.,\n]/,
  ];
  for (const re of pats) {
    const m = body.match(re);
    if (m && TITLE_WORD.test(m[1])) return m[1].replace(/\s+/g, ' ').trim();
  }
  return '';
}

export function extractRecruiter(p: ParsedMessage, body: string, noReply: boolean): string {
  if (isPerson(p.fromName)) return p.fromName.trim();
  const lines = body.split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (CLOSING.test(lines[i])) {
      const next = lines.slice(i + 1).find((l) => l);
      if (next && isPerson(next.replace(/\(.*?\)/g, '').trim())) return next.replace(/\(.*?\)/g, '').trim();
    }
  }
  if (noReply) return 'Automated (ATS)';
  return p.fromName.trim();
}

const FIELD_LINE = /^(date|time|when|where|format|platform|location|interviewer|interviewers|duration|link|deadline|start here|join|dial-in|meeting id|passcode)\s*:/i;

/** The first prose sentences of a message: greeting, field lines, bullets and URLs left out. */
export function firstSentences(body: string, n: number, cap: number): string {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !FIELD_LINE.test(l) && !/^[•*\-•]/.test(l) && !/^(https?:\/\/|\S+\.\S+\/)\S*$/.test(l) && !CLOSING.test(l) && !/\(fictional demo\)$/.test(l) && !isPerson(l));
  if (lines.length && /^(hi|hello|dear|hey|good (morning|afternoon|evening))\b/i.test(lines[0])) lines.shift();
  const text = lines.join(' ').replace(/\s+/g, ' ');
  // Split only on sentence punctuation followed by whitespace, so dots inside URLs and names survive.
  const sents = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter(Boolean);
  let out = sents.slice(0, n).join(' ').trim();
  if (out.length > cap) out = out.slice(0, cap - 1).replace(/\s+\S*$/, '') + '…';
  return out;
}

function platformOf(text: string): string | undefined {
  const m = text.match(/\b(zoom|microsoft teams|teams|google meet|meet\.google|amazon chime|chime|webex|phone call|phone screen|by phone)\b/i);
  if (!m) return undefined;
  const v = m[1].toLowerCase();
  if (v.includes('teams')) return 'Teams';
  if (v.includes('meet')) return 'Google Meet';
  if (v.includes('chime')) return 'Amazon Chime';
  if (v.includes('phone')) return 'Phone';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function linkOf(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)>\]]+|\b[\w.-]+\.(?:example|com|io|net|org|co|dev|us)\/[^\s)>\]]+/);
  return m ? m[0].replace(/[.,;:]+$/, '') : undefined;
}

function interviewerOf(text: string): string | undefined {
  const m = text.match(/\b(?:[Ii]nterviewers?|[Ww]ith|[Hh]iring manager|[Mm]eet)[:,]?\s+(?:the\s+)?(?:hiring manager,?\s+)?([A-Z][a-z'’-]+ [A-Z][a-z'’-]+)\b/);
  return m && isPerson(m[1]) ? m[1] : undefined;
}

function stageFor(cat: Cat, mode: EmailMode | undefined, text: string): string {
  const kind = /\b(technical|coding|system design)\b/i.test(text) ? 'Technical interview'
    : /\b(hiring manager)\b/i.test(text) ? 'Hiring manager conversation'
    : /\b(final|panel|onsite|on-site)\b/i.test(text) ? 'Final interview'
    : /\b(hr|phone|recruiter)\s+(screen|screening|call)\b/i.test(text) || /\bscreening\b/i.test(text) ? 'HR screening'
    : 'Interview';
  switch (cat) {
    case 'avail':
    case 'invite': return kind + (kind === 'Interview' ? ' scheduling' : ' (inferred)');
    case 'confirmed': return kind;
    case 'offer': return 'Offer';
    case 'rejected': return 'Closed';
    case 'applied': return 'Application received';
    case 'status': return 'Under review';
    case 'action':
      if (mode === 'resched') return kind + ' (reschedule requested)';
      if (mode === 'assess') return 'Technical assessment';
      if (/resume|résumé|cv\b/i.test(text)) return 'Resume review';
      return 'Follow-up requested';
    default: return '';
  }
}

export function classifyHeuristic(p: ParsedMessage, now: Date = new Date()): Classification {
  const body = stripQuoted(cleanBody(p.bodyText));
  // Curly apostrophes (We’ve) read like straight ones, so phrases match either way.
  const text = (p.subject + '\n' + body).replace(/[‘’]/g, "'");
  const ref = new Date(p.date);
  const noReply = NOREPLY.test(p.fromAddr) || NOREPLY_BODY.test(body);
  const has = (re: RegExp) => re.test(text);

  // Offers count only in plain statements, not in fraud warnings ("never share details as part of a job offer")
  // or conditions ("if we extend an offer"). "Job offer" / "formal offer" also show up where a receipt
  // describes the process ("...then we'll talk about a formal offer"), so those need more than that.
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const plain = sentences.filter((s) => !isHedged(s));
  const inPlain = (re: RegExp) => plain.some((s) => re.test(s));
  // Requests are read only from sentences that ask now, not from ones describing what may come later.
  const asking = sentences.filter((s) => !LATER.test(s));
  const asks = (re: RegExp) => asking.some((s) => re.test(s));
  const calNotice = CAL_NOTICE.test(p.subject);
  const strongOffer = inPlain(/\b(offer letter|pleased to (offer|extend)|extend (you )?(an|the) offer|delighted to extend|offer of employment)\b/i);
  const looseOffer = inPlain(/\b(job offer|formal offer)\b/i);
  const rejectHit = has(/\b(not (be )?moving forward|move forward with other|proceed with other candidates|unfortunately|not selected|no longer under consideration|regret to inform|decided not to|will not be (moving|proceeding)|position has been filled|(have|has) filled the (position|role)|pursue other candidates)\b/i);
  const reschedHit = !calNotice && asking.some((s) => !RESCHED_OPTION.test(s) && /\breschedul\w*|\bmove (our|the|this|your|[a-z]+day'?s) (interview|call|meeting|conversation)|\bnew time\b|\bpush (back|our)/i.test(s));
  const confirmedHit = has(/\b(interview|call|session|meeting|conversation)\b[^.\n]{0,60}\b(is |has been )?(confirmed|scheduled|booked|set)\b|\bconfirmed:|\bconfirmation\b[^.\n]{0,40}\binterview|\bis confirmed\b|\b(pleased|happy|excited|writing) to confirm (your|our|the) (upcoming )?(\w+ ){0,3}(interview|call|meeting|conversation|chat)\b|\bcalendar invite\b/i);
  // "Feel free to update your profile at any time" and "provide an update by the time..." are not asking for times.
  const availHit = asks(/\b(availability|available|(are|you're|you are) free)\b[^.\n]{0,80}\b(time|times|slot|slots|day|days|week)\b|\b(share|send|provide|suggest|let me know|let us know)\b[^.\n]{0,40}\b(your (availability|available times?)|(a few|some|two|three|couple of|several|\d) (times?|slots?)|time slots?|what time works|times? that works?|availability)\b|\bwhat (times?|days?) work|\bat what time\b|\bwhen (are|would|will) you|\bwhich time\b/i);
  const inviteHit = asks(/\blink to (book|schedule)\b|\b(book|schedule|pick|select|choose) (a|some) (time|slot)\b|\binvit(e|ed|ation)\b[^.\n]{0,60}\b(interview|call|screen|screening|conversation|chat)\b|\b(would like|we'd like|like|want) to (schedule|set up|arrange|invite you|speak|talk|chat)\b|\bnext (step|round)\b[^.\n]{0,60}\b(interview|call|conversation)/i);
  const assessHit = asking.map((s) => s.replace(/\S*https?:\/\/\S+/g, '')).some((s) => ASSESS_TERM.test(s) && ASSESS_ASK.test(s) && !/\b(assessment (report|of|partner)|(has been|was) (completed|submitted)|refrain|ai tools?)\b/i.test(s));
  const testHit = asks(/\b(start|take|access) (the|a|an|this) (\w+ ){0,3}(test|evaluation)\b/i);
  const actionHit = assessHit || testHit || asks(/\bplease (send|complete|submit|provide|fill|upload|sign|return|confirm)\b|\b(could|can|would) you (please )?(send|provide|share|complete|submit|confirm|fill)\b|\bdeadline\b|\bdue (by|on)\b|\bno later than\b/i);
  const appliedHit = has(/\b(received your application|thank you for applying|thanks for applying|thank(s| you) for your application|application (has been |was )?(received|submitted)|we('ve| have) received your (application|submission)|successfully (submitted|applied))\b/i);
  const statusHit = has(/\b(update on your application|status of your application|under review|still reviewing|being reviewed|moved to the next stage|with the hiring team|reviewing your application)\b/i);
  const autoHit = noReply || has(/\b(job alert|new (roles|jobs|positions) (match|for you)|roles match|unsubscribe|newsletter|digest|weekly (roundup|summary))\b/i);
  const subjInvite = /\binvit/i.test(p.subject);
  const subjAvail = /\bavailab/i.test(p.subject);

  // Mailing-list mail (an unsubscribe footer) never carries a real offer.
  const bulk = /\bunsubscribe\b/i.test(body);
  const newsletter = NEWSLETTER_FROM.test(p.fromAddr) || NEWSLETTER_BODY.test(body);
  const jobAlert = isJobAlert(p);
  const offerHit = !bulk && !newsletter && !jobAlert && (strongOffer || (looseOffer && !appliedHit && !statusHit));

  let cat: Cat;
  let sec: Cat | '' = '';
  let conf: number;
  let mode: EmailMode | undefined;
  // A newsletter post about interviews is reading material, not a request.
  if (newsletter) { cat = 'auto'; conf = 90; }
  // A job alert lists openings; nobody there is asking you anything.
  else if (jobAlert) { cat = 'auto'; conf = 92; }
  // A calendar's own notice: the meeting is booked (or canceled); nothing to schedule.
  else if (calNotice) { cat = CAL_CANCELED.test(p.subject) ? 'status' : 'confirmed'; conf = 95; }
  else if (offerHit) { cat = 'offer'; conf = 92; }
  else if (rejectHit && !confirmedHit) { cat = 'rejected'; conf = 88; }
  // A reminder of a booked interview; "complete your interview" reminders are for one-way video interviews.
  else if (BOOKED_SUBJECT.test(p.subject) && !reschedHit && !/\bcomplete\b/i.test(p.subject)) { cat = 'confirmed'; conf = 90; }
  // An application receipt often carries a copy of the form or résumé ("available from...", "when would you
  // start"), which reads like a scheduling request. Its subject says what it is; an assessment still counts.
  // A person writing "Thanks for applying, when are you free?" is still asking.
  else if (RECEIPT_SUBJECT.test(p.subject) && !SCHEDULING_SUBJECT.test(p.subject) && (noReply || !(availHit || inviteHit))) {
    if (assessHit || testHit) { cat = 'action'; conf = 84; mode = 'assess'; }
    else { cat = statusHit && !appliedHit ? 'status' : 'applied'; conf = 92; }
  }
  else if (reschedHit && (availHit || inviteHit || confirmedHit || actionHit || /\b(interview|call)\b/i.test(text))) { cat = 'action'; sec = 'avail'; conf = 90; mode = 'resched'; }
  else if (confirmedHit && !availHit) { cat = 'confirmed'; conf = 90; }
  else if (availHit || inviteHit) {
    if (availHit && inviteHit) {
      if (subjInvite && !subjAvail) { cat = 'invite'; sec = 'avail'; }
      else { cat = 'avail'; sec = 'invite'; }
      conf = 90;
    } else if (availHit) { cat = 'avail'; conf = 86; }
    else { cat = 'invite'; conf = 84; }
    mode = 'avail';
  }
  else if (actionHit) { cat = 'action'; conf = 84; if (assessHit || testHit) mode = 'assess'; }
  else if (appliedHit) { cat = 'applied'; conf = 92; }
  else if (statusHit) { cat = 'status'; conf = 84; }
  else if (autoHit) { cat = 'auto'; conf = 80; }
  else { cat = 'review'; conf = 40; }
  if (noReply && cat !== 'auto' && !sec) sec = 'auto';
  if (cat === 'auto' && (appliedHit || statusHit)) { cat = appliedHit ? 'applied' : 'status'; sec = 'auto'; conf = 85; }

  // Dates and times
  const hits = extractDateTimes(body, ref);
  const meeting = hits.filter((h) => h.kind === 'meeting');
  const timed = meeting.filter((h) => h.start !== undefined);
  const deadlineHit = hits.find((h) => h.kind === 'deadline');
  const refIso = isoLocal(ref);

  const company = extractCompany(p, body);
  const role = extractRole(p, body);
  const recruiter = extractRecruiter(p, body, noReply);
  const platform = platformOf(text);
  const link = linkOf(body);
  const interviewer = interviewerOf(body);

  // Scheduling details
  let need: number | undefined;
  let slotLen: number | undefined;
  let windowDates: string[] | undefined;
  let opts: [string, number][] | undefined;
  let event: Classification['event'];
  if (mode === 'avail') {
    const nm = body.match(/\b(one|two|three|four|five|a couple of|a few|several|some|\d)\b[^.\n]{0,25}\b(times?|slots?|options?|windows?)\b/i);
    need = nm ? (WORD_NUM[nm[1].toLowerCase()] ?? parseInt(nm[1], 10) ?? 2) : 2;
    if (!need || need > 5) need = 2;
    const lm = body.match(/\b(\d{2,3})[- ]?(?:min|minute)s?\b/i) || p.subject.match(/\b(\d{2,3})[- ]?(?:min|minute)s?\b/i);
    const hm = body.match(/\b(\d|one|two)[- ]hour\b/i);
    slotLen = lm ? Math.min(2, parseInt(lm[1], 10) / 60) : hm ? (WORD_NUM[hm[1].toLowerCase()] ?? parseInt(hm[1], 10)) : 1;
    const dateOnly = meeting.filter((h) => h.start === undefined).map((h) => h.date).sort();
    windowDates = dateOnly.length >= 2 ? businessDaysBetween(dateOnly[0], dateOnly[dateOnly.length - 1]) : dateOnly.length === 1 ? [dateOnly[0]] : nextBusinessDays(isoLocal(now) > refIso ? isoLocal(now) : refIso, 5);
    if (!windowDates.length) windowDates = nextBusinessDays(isoLocal(now), 5);
  }
  if (mode === 'resched') {
    opts = timed.map((h) => [h.date, h.start! + zoneToEt(h.zone)] as [string, number]);
    need = 1;
  }
  if ((cat === 'confirmed' || cat === 'offer') && timed.length && !calNotice) {
    const h = timed[0];
    const start = h.start! + zoneToEt(h.zone);
    const end = h.end !== undefined ? h.end + zoneToEt(h.zone) : start + 1;
    event = { date: h.date, start, end: end > start ? end : start + 1 };
    if (cat === 'confirmed') mode = 'confirm';
  }

  // Deadline
  let deadline = '';
  let deadlineKey = '9999';
  if (deadlineHit) {
    deadlineKey = deadlineHit.date;
    deadline = lab(deadlineHit.date) + (deadlineHit.start !== undefined ? ' by ' + fmtT(deadlineHit.start) + (deadlineHit.zone ? ' ' + deadlineHit.zone : '') : '');
  } else if (cat === 'confirmed' && event) {
    deadlineKey = event.date;
  }

  // Priority
  let pri: Pri;
  if (cat === 'offer') pri = 'critical';
  else if (cat === 'confirmed') pri = event && event.date <= addDays(isoLocal(now), 2) ? 'critical' : 'high';
  else if (cat === 'action' || cat === 'avail' || cat === 'invite') pri = 'high';
  else if (cat === 'status' || cat === 'review') pri = 'normal';
  else pri = 'low';

  const needs = !calNotice && (cat === 'avail' || cat === 'invite' || cat === 'confirmed' || cat === 'offer' || cat === 'action');
  const canReply = !noReply;

  const replyKind =
    cat === 'avail' || cat === 'invite' ? 'Availability reply'
    : cat === 'confirmed' ? 'Interview confirmation'
    : cat === 'offer' ? 'Offer discussion'
    : cat === 'rejected' ? 'Gracious reply'
    : cat === 'status' ? 'Recruiter follow-up'
    : cat === 'action' ? (mode === 'resched' ? 'Rescheduling reply' : 'Additional information')
    : cat === 'review' ? 'Clarifying reply'
    : noReply ? 'No-reply sender' : 'Acknowledgement';

  const action =
    cat === 'avail' || cat === 'invite' ? 'Reply with ' + (need || 2) + ' available time slot' + ((need || 2) > 1 ? 's' : '')
    : calNotice ? (cat === 'status' ? 'None. The meeting was canceled' : 'None. The meeting is on your calendar')
    : cat === 'confirmed' ? 'Add the interview to your calendar' + (p.atts.length ? ' and review the attachment' : '')
    : cat === 'offer' ? 'Review the offer' + (deadline ? ' and reply by ' + deadline : '')
    : cat === 'rejected' ? 'None. Consider a short thank-you'
    : cat === 'applied' ? 'None. No reply needed'
    : cat === 'status' ? 'None required'
    : cat === 'action' ? (mode === 'resched' ? 'Choose one of the proposed times' : mode === 'assess' ? 'Complete the assessment' + (deadline ? ' by ' + deadline : '') : /resume|résumé|cv\b/i.test(text) ? 'Send an updated resume' + (deadline ? ' by ' + deadline : '') : 'Reply with the requested information')
    : cat === 'review' ? 'Decide whether to reply'
    : 'None';

  // Facts: concrete lines from the email, never inferred.
  const facts: string[] = [];
  const lines = body.split('\n').map((l) => l.replace(/^[•*\-•]\s*/, '').trim()).filter((l) => l && l.length < 160);
  for (const l of lines) {
    if (facts.length >= 5) break;
    if (/^(date|time|format|interviewer|interviewers|location|platform|deadline|where|when|link|duration)\s*:/i.test(l) || extractDateTimes(l, ref).length || /\b(attached|attachment)\b/i.test(l)) {
      if (!facts.includes(l) && !CLOSING.test(l)) facts.push(l.replace(/\s+/g, ' '));
    }
  }
  if (noReply) facts.push('Sent from a no-reply address');
  p.atts.forEach((a) => {
    if (facts.length < 6) facts.push('Attachment: ' + a.name + (a.size ? ' (' + a.size + ')' : ''));
  });
  if (!facts.length) facts.push(firstSentences(body, 1, 120));

  const times: TimeHit[] = timed.filter((h) => h.start !== undefined);

  return {
    classifier: 'rules',
    rulesVersion: RULES_VERSION,
    jobRelated: isJobRelated(p),
    cat, sec, pri, conf: company ? conf : Math.max(30, conf - 10),
    company, role, recruiter,
    stage: stageFor(cat, mode, text),
    action, deadline, deadlineKey, needs, canReply, replyKind,
    mode, need, slotLen, windowDates, opts,
    summary: firstSentences(body, 2, 220),
    facts,
    assumptions: ['Classified by keyword rules; no AI model is configured, so nothing beyond the text was inferred'],
    times,
    platform, link, interviewer, event,
  };
}
