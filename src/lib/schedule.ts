import type { CalEvent, Email, Settings } from '@/data/types';
import { busyAt } from './calendar';
import { dObj, fmtT, hrs, lab, tzOffset } from './time';
import { firstName, isPersonName } from './util';

export interface SlotVM {
  key: string;
  label: string;
  busy: boolean;
  on: boolean;
  title: string;
}
export interface SchedDay { label: string; sub: string; slots: SlotVM[] }
export interface SchedVM {
  title: string;
  sub: string;
  hint: string;
  days: SchedDay[];
  cantGen: boolean;
  /** Times the email asked for: the least to offer. */
  need: number;
}

export type SchedMode = 'avail' | 'resched';

/** Slot key "YYYY-MM-DD|startHour". */
export const slotKey = (date: string, start: number): string => date + '|' + start;
export function parseSlotKey(k: string): { date: string; start: number } {
  const [date, h] = k.split('|');
  return { date, start: parseFloat(h) };
}

/**
 * Build the "Schedule interview" / "Pick a new time" dialog model.
 * Availability mode offers hourly slots inside the user's window on the dates
 * the recruiter named; reschedule mode offers exactly the recruiter's options.
 */
export function buildSched(e: Email | undefined, mode: SchedMode, sel: string[], S: Settings, active: CalEvent[]): SchedVM {
  if (!e) return { title: '', sub: '', hint: '', days: [], cantGen: true, need: 1 };
  const off = tzOffset(S.tz);
  const tz = S.tz;
  const days: SchedDay[] = [];

  const mk = (date: string, s: number, len: number): SlotVM => {
    const key = slotKey(date, s);
    const b = busyAt(active, date, s, s + len, mode === 'resched' ? e.evId ?? null : null);
    const on = sel.includes(key);
    return {
      key,
      label: fmtT(s + off),
      busy: !!b,
      on,
      title: b ? 'Conflicts with ' + b.co + (b.kind === 'interview' ? ' (interview)' : '') : 'Select ' + fmtT(s + off) + ' ' + tz,
    };
  };
  const dayOf = (d: string, slots: SlotVM[]): SchedDay => {
    const [dn, rest] = lab(d).split(', ');
    return { label: dn, sub: rest, slots };
  };

  if (mode === 'resched') {
    const byDate: Record<string, number[]> = {};
    (e.opts || []).forEach(([d, h]) => {
      (byDate[d] = byDate[d] || []).push(h);
    });
    Object.keys(byDate).sort().forEach((d) => days.push(dayOf(d, byDate[d].map((s) => mk(d, s, 1)))));
  } else {
    const ws = hrs(S.whStart);
    const we = hrs(S.whEnd);
    const len = e.slotLen || 1;
    (e.windowDates || []).forEach((d) => {
      const dow = dObj(d).getUTCDay();
      if (!S.whDays.includes(dow)) return;
      const slots: SlotVM[] = [];
      for (let s = ws; s + len <= we + 1e-9; s += 1) slots.push(mk(d, s, len));
      days.push(dayOf(d, slots));
    });
  }

  const need = mode === 'resched' ? 1 : e.need || 1;
  const who = isPersonName(e.recruiter) ? firstName(e.recruiter) : 'the recruiter';
  const company = e.company || 'the recruiter';
  return {
    title: mode === 'resched' ? 'Pick a new time with ' + company : 'Schedule interview: ' + company,
    sub:
      (mode === 'resched'
        ? 'Choose one of the times ' + who + ' proposed. '
        : need > 1 ? 'Choose at least ' + need + ' times to offer (' + need + ' requested). ' : 'Choose the times to offer. ') +
      'Times shown in ' + tz + '.',
    hint:
      mode === 'resched'
        ? 'Times that overlap an existing event are crossed out. Nothing is confirmed until ' + company + ' replies.'
        : 'Slots follow your availability (' + fmtT(hrs(S.whStart) + off) + ' to ' + fmtT(hrs(S.whEnd) + off) + ' ' + tz + '). Crossed-out slots conflict with your calendar. Sending availability does not confirm an interview.',
    days,
    cantGen: sel.length < need,
    need,
  };
}
