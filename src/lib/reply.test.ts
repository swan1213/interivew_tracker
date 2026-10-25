import { describe, expect, it } from 'vitest';
import { buildDemoData, DEMO_TODAY } from '@/data/demo';
import { genText, type ReplyOpts } from './reply';

const data = buildDemoData();
const email = (id: string) => data.emails.find((e) => e.id === id)!;
const ev = (id: string) => data.events.find((v) => v.id === id)!;
const opts = (over: Partial<ReplyOpts> = {}): ReplyOpts => ({
  tone: 'professional', variant: 0, mods: { short: false, prof: false }, chosen: [],
  name: 'Jordan Lee', whStart: '09:00', whEnd: '18:00', tz: 'ET', ev: null, today: DEMO_TODAY, ...over,
});

describe('reply assistant', () => {
  it('writes an availability reply with the chosen slots', () => {
    const t = genText(email('e1'), opts({ chosen: [{ date: '2026-10-27', start: 10.5 }, { date: '2026-10-29', start: 14.5 }] }));
    expect(t.startsWith('Dear Priya,')).toBe(true);
    expect(t).toContain('Software Engineer II, Azure Platform position at Microsoft');
    expect(t).toContain('speak with the hiring manager');
    expect(t).toContain('• Tue, Oct 27 at 10:30 AM ET');
    expect(t).toContain('• Thu, Oct 29 at 2:30 PM ET');
    expect(t.endsWith('Kind regards,\nJordan Lee')).toBe(true);
  });

  it('asks for times when none are chosen yet', () => {
    expect(genText(email('e1'), opts())).toContain('I am generally available Mon to Fri, 9:00 AM to 6:00 PM ET');
  });

  it('confirms an interview using the linked event', () => {
    const t = genText(email('e2'), opts({ ev: ev('v2') }));
    expect(t).toContain('I confirm I will join the Amazon Chime session on Tue, Oct 27 at 11:00 AM ET (about one hour).');
    expect(t).toContain('interview guide');
  });

  it('answers a reschedule with the single chosen option', () => {
    const t = genText(email('e7'), opts({ ev: ev('v3'), chosen: [{ date: '2026-10-30', start: 10.5 }] }));
    expect(t).toContain('Fri, Oct 30 at 10:30 AM ET works for me');
    expect(t).toContain('same Zoom link');
  });

  it('changes greeting and sign-off with tone, and "short" drops optional lines', () => {
    const friendly = genText(email('e5'), opts({ tone: 'friendly' }));
    expect(friendly.startsWith('Hi team,')).toBe(true);
    expect(friendly).toContain('Thanks again, and have a great week!');
    const short = genText(email('e5'), opts({ mods: { short: true, prof: false } }));
    expect(short).not.toContain('additional examples');
    expect(short).toContain('Best,\nJordan Lee');
    const prof = genText(email('e5'), opts({ tone: 'friendly', mods: { short: false, prof: true } }));
    expect(prof.startsWith('Dear team,')).toBe(true);
  });

  it('alternates openers between variants', () => {
    const a = genText(email('e4'), opts({ variant: 0 }));
    const b = genText(email('e4'), opts({ variant: 1 }));
    expect(a).not.toBe(b);
    expect(a).toContain('[Attach your updated resume (PDF) before sending]');
  });

  it('shows the offer call time from the linked event', () => {
    const t = genText(email('e9'), opts({ ev: ev('v1'), tz: 'PT' }));
    expect(t).toContain('before our call today at 12:30 PM PT');
    expect(t).toContain('ahead of Nov 2');
  });

  it('returns empty text without an email', () => {
    expect(genText(undefined, opts())).toBe('');
  });
});
