import type { CalEvent, Email, Slot, Tone, Tz } from '@/data/types';
import { effCat } from './mail';
import { durationWords, fmtT, hrs, lab, rel, slotLabel, tzOffset } from './time';
import { firstName, isPersonName } from './util';

export interface ReplyOpts {
  tone: Tone;
  variant: number;
  mods: { short: boolean; prof: boolean };
  chosen: Slot[];
  /** The user's display name for the signature. */
  name: string;
  whStart: string;
  whEnd: string;
  tz: Tz;
  /** Calendar event linked to the email, if any. */
  ev?: CalEvent | null;
  today: string;
}

interface Line { t: string; opt?: boolean }

/**
 * The substantive lines of a reply, derived from what the email asks for.
 * Lines marked `opt` are dropped by the "Make shorter" modifier.
 */
export function coreLines(e: Email, o: ReplyOpts): Line[] {
  const off = tzOffset(o.tz);
  const tz = o.tz;
  const sl = o.chosen.map((c) => slotLabel(c.date, c.start, off, tz));
  const wh = `Mon to Fri, ${fmtT(hrs(o.whStart) + off)} to ${fmtT(hrs(o.whEnd) + off)} ${tz}`;
  const c = effCat(e);
  const ev = o.ev || null;

  if (e.mode === 'avail') {
    if (sl.length) {
      const intro = /screen/i.test(e.stage)
        ? 'I would be glad to schedule the screening call. '
        : /manager/i.test(e.stage)
          ? 'I would be glad to speak with the hiring manager. '
          : 'I would be glad to set up the conversation. ';
      return [
        { t: intro + 'These times work for me (' + tz + '):\n' + sl.map((s) => '• ' + s).join('\n') },
        { t: 'Please let me know which suits you best, and I will watch for the invitation.' },
        { t: 'If none of these fit, I am happy to find another time.', opt: true },
      ];
    }
    return [{ t: 'I am generally available ' + wh + '. Could you suggest a few times in that window?' }];
  }

  if (e.mode === 'resched') {
    if (sl.length) {
      return [
        { t: 'No problem at all. ' + sl[0] + ' works for me. Please send an updated invitation when convenient.' },
        { t: 'I will keep the same ' + (ev?.platform || 'meeting') + ' link unless you advise otherwise.', opt: true },
      ];
    }
    return [{ t: 'No problem at all. Could you let me know which of your proposed times is still open? I am flexible.' }];
  }

  if (e.mode === 'confirm') {
    const when = ev ? ' on ' + lab(ev.date) + ' at ' + fmtT(ev.start + off) + ' ' + tz + ' (about ' + durationWords(ev) + ')' : '';
    const guide = !!e.atts?.length && /guide/i.test(e.atts[0].name);
    const att = e.atts?.length
      ? ' I have received the ' + (guide ? 'interview guide and will review it' : 'attached materials and will review them') + ' beforehand.'
      : '';
    return [
      { t: 'I confirm I will join the ' + (ev?.platform || 'interview') + ' session' + when + '.' + att },
      { t: 'Please let me know if there is anything else I should prepare.', opt: true },
    ];
  }

  if (c === 'offer') {
    const call = ev ? ' before our call ' + rel(ev.date, o.today).toLowerCase() + ' at ' + fmtT(ev.start + off) + ' ' + tz : '';
    const docs = e.atts && e.atts.length > 1 ? 'letter and benefits overview' : 'offer letter';
    const lines: Line[] = [
      { t: 'I am delighted to receive the offer. I will review the ' + docs + call + '.' },
      { t: 'On the call I would like to discuss [topics, for example compensation, start date, team].' },
    ];
    if (e.deadline) lines.push({ t: 'I will aim to return the signed letter ahead of ' + e.deadline.replace(/^[A-Za-z]{3}, /, '') + '.', opt: true });
    return lines;
  }

  if (c === 'action' && /resume|cv\b/i.test(e.action)) {
    return [
      { t: 'Please find my updated resume attached (PDF), revised as you requested.' },
      { t: '[Attach your updated resume (PDF) before sending]' },
      { t: 'I am happy to share more detail on any project if useful.', opt: true },
    ];
  }

  if (c === 'status') {
    return [
      { t: 'I remain very interested in the ' + (e.role || 'role') + ' role.' },
      { t: 'If it helps the team during review, I am glad to provide additional examples of my work.', opt: true },
    ];
  }

  if (c === 'rejected') {
    return [
      { t: 'I appreciate you letting me know, and the time your team spent reviewing my application.' },
      { t: 'I would welcome being considered for future roles at ' + (e.company || 'your company') + '.', opt: true },
    ];
  }

  if (c === 'review') {
    return [{ t: 'Could you share a bit more about what you have in mind, for example a specific role or topic? I would be glad to find a time once I understand the context.' }];
  }

  return [{ t: 'Please let me know if there is anything further you need from me.' }];
}

/** Compose a full reply: greeting, opener, core lines, sign-off. */
export function genText(e: Email | undefined, o: ReplyOpts): string {
  if (!e) return '';
  const tone: Tone = o.mods.prof ? 'professional' : o.tone;
  const person = isPersonName(e.recruiter);
  const first = person ? firstName(e.recruiter) : 'team';
  const greet = (tone === 'professional' ? 'Dear ' : 'Hi ') + first + ',';
  const v = o.variant % 2;
  const c = effCat(e);
  const generic = !e.role || c === 'rejected' || c === 'review' || c === 'status';
  const role = e.role || 'role';
  const co = e.company || 'your team';

  const opens: Record<Tone, [string, string]> = generic
    ? {
        professional: ['Thank you for your message.', 'Thank you for getting in touch.'],
        friendly: ['Thanks so much for reaching out!', 'Thanks for the note!'],
        concise: ['', ''],
        confident: ['Thank you for reaching out.', 'Thank you for your message.'],
      }
    : {
        professional: [
          'Thank you for your email regarding the ' + role + ' position at ' + co + '.',
          'Thank you for getting in touch about the ' + role + ' opportunity.',
        ],
        friendly: [
          'Thanks so much for reaching out about the ' + role + ' role. I am really excited about ' + co + '!',
          'Thanks for the note, and for thinking of me for the ' + role + ' role!',
        ],
        concise: ['', ''],
        confident: [
          'Thank you for reaching out. This role is a strong match for my background, and I am keen to move forward.',
          'Thank you. I am looking forward to discussing how I can contribute at ' + co + '.',
        ],
      };
  const closes: Record<Tone, string> = {
    professional: 'Kind regards,',
    friendly: 'Thanks again, and have a great week!',
    concise: 'Best,',
    confident: 'Looking forward to speaking,',
  };

  const core = coreLines(e, o)
    .filter((l) => !(o.mods.short && l.opt))
    .map((l) => l.t)
    .join('\n\n');
  const open = o.mods.short ? '' : opens[tone][v];
  const close = o.mods.short ? 'Best,' : closes[tone];
  return [greet, open, core, close + '\n' + o.name].filter((x) => x !== '').join('\n\n');
}
