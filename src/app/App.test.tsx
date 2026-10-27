// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import { provider, setProvider } from '@/data/provider';
import type { Page } from '@/data/types';
import { seedMembers } from '@/lib/roles';
import { DEFAULT_SETTINGS, useStore, type AppState } from '@/store/store';
import { trackedApps } from '@/store/selectors';
import { App } from './App';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function reset(patch: Partial<AppState> = {}) {
  const d = buildDemoData();
  act(() => {
    useStore.setState({
      ...d, selId: 'e1', page: 'dash', view: 'inbox', calView: 'week', calDate: '2026-10-26', compOpen: false, aiDraft: '', S: DEFAULT_SETTINGS,
      schedOpen: false, addCalOpen: false, sendOpen: false, cfOpen: false, addAcctOpen: false, notifOpen: false, acMenuOpen: false, appSel: '', calSel: '', toast: '',
      themePref: 'light', q: '', acctFilter: 'all', members: seedMembers('Jordan Lee', true), meId: 'owner', userMenuOpen: false,
      ...patch,
    });
  });
}

let container: HTMLDivElement;
let root: Root;

function mount(): string {
  act(() => {
    root.render(<App />);
  });
  return container.innerHTML;
}

const click = (sel: string) => {
  const el = container.querySelector<HTMLElement>(sel);
  if (!el) throw new Error('No element for ' + sel);
  act(() => {
    el.click();
  });
};

describe('App', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    reset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const pages: Page[] = ['dash', 'inbox', 'cal', 'track', 'analytics', 'accounts', 'team', 'settings'];
  for (const page of pages) {
    it('renders the ' + page + ' page', () => {
      reset({ page });
      const html = mount();
      expect(html).toContain('InterviewFlow AI');
      expect(html.length).toBeGreaterThan(5000);
    });
  }

  it('keeps the URL in step with the page', () => {
    reset({ page: 'inbox', view: 'offers' });
    mount();
    expect(window.location.pathname).toBe('/inbox/offers');
    act(() => useStore.getState().go('cal', { calView: 'agenda' }));
    expect(window.location.pathname).toBe('/calendar/agenda');
    expect(document.title).toContain('Calendar');
  });

  it('dashboard briefing is built from the data', () => {
    const html = mount();
    expect(html).toContain('Good morning, Jordan');
    expect(html).toContain('Amazon confirmed a technical interview tomorrow at 11:00 AM ET');
    expect(html).toContain('conflicts with your doctor appointment');
  });

  it('clicking a priority item opens it in the inbox and marks it read', () => {
    mount();
    click('.pr');
    const s = useStore.getState();
    expect(s.page).toBe('inbox');
    expect(container.querySelector('.dsubj h2')?.textContent).toBeTruthy();
    expect(s.emails.find((e) => e.id === s.selId)?.unread).toBe(false);
  });

  it('inbox detail shows insights, next action and reply assistant; generating a draft shows it', () => {
    reset({ page: 'inbox', selId: 'e1' });
    let html = mount();
    expect(html).toContain('AI summary');
    expect(html).not.toContain('AI assumptions');
    expect(html).not.toContain('Related application');
    expect(html).not.toContain('Needs reply today');
    expect(html).toContain('96% confidence');
    expect(html).toContain('Schedule interview');
    expect(html).toContain('AI reply assistant');
    const gen = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Generate reply'));
    act(() => gen?.click());
    html = container.innerHTML;
    expect(html).toContain('Dear Priya,');
    expect(html).toContain('Insert into composer');
  });

  it('a long inbox is shown 50 conversations a page, with newer / older navigation', () => {
    const base = buildDemoData().emails[0];
    const many = Array.from({ length: 120 }, (_, i) => ({ ...base, id: 'm' + i, subject: 'Message ' + i, unread: false }));
    reset({ page: 'inbox', selId: 'm0', emails: many });
    mount();
    const range = () => container.querySelector('.lcount')?.textContent;
    expect(range()).toBe('1–50 of 120');
    expect(container.querySelectorAll('.er')).toHaveLength(50);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Newer"]')!.disabled).toBe(true);
    click('[aria-label="Older"]');
    expect(range()).toBe('51–100 of 120');
    click('[aria-label="Older"]');
    expect(range()).toBe('101–120 of 120');
    expect(container.querySelectorAll('.er')).toHaveLength(20);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Older"]')!.disabled).toBe(true);
    // Another view starts again at the first page.
    act(() => useStore.getState().openView('action'));
    act(() => useStore.getState().openView('inbox'));
    expect(range()).toBe('1–50 of 120');
  });

  it('a message with an HTML version is shown as its sender laid it out, in a sandboxed frame', async () => {
    const demo = provider;
    const asked: string[] = [];
    setProvider(Object.assign(Object.create(demo), { messageHtml: async (emailId: string, msgId: string) => (asked.push(emailId + '/' + msgId), '<table><tr><td>HOURS WORKED</td><td>15:14</td></tr></table>') }));
    try {
      const d = buildDemoData();
      const emails = d.emails.map((e) => (e.id === 'e1' ? { ...e, thread: e.thread.map((m, i) => ({ ...m, id: 'msg' + i })) } : e));
      reset({ page: 'inbox', selId: 'e1', emails });
      mount();
      await act(async () => {
        await Promise.resolve();
      });
      const frame = container.querySelector<HTMLIFrameElement>('iframe.hframe');
      expect(frame).not.toBeNull();
      expect(frame!.getAttribute('sandbox')).not.toContain('allow-scripts');
      expect(frame!.getAttribute('srcdoc')).toContain('<td>15:14</td>');
      expect(asked[0]).toMatch(/^e1\/msg\d$/);
    } finally {
      setProvider(demo);
    }
  });

  it('scheduling flow: pick slots, generate, confirm send', () => {
    reset({ page: 'inbox', selId: 'e1' });
    mount();
    const sched = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Schedule interview');
    act(() => sched?.click());
    expect(container.innerHTML).toContain('Schedule interview: Microsoft');
    const slots = Array.from(container.querySelectorAll<HTMLButtonElement>('.slot')).filter((b) => !b.disabled);
    act(() => slots[0].click());
    act(() => slots[1].click());
    act(() => slots[2].click());
    expect(container.innerHTML).not.toContain('selected');
    expect(container.querySelectorAll('.slot.on')).toHaveLength(3);
    click('.mft .btn.pri');
    expect(useStore.getState().schedOpen).toBe(false);
    expect(container.querySelector('.comp textarea')).toBeTruthy();
    click('.comp .btn.pri');
    expect(container.innerHTML).toContain('Send this reply?');
    const send = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send now');
    act(() => send?.click());
    const e1 = useStore.getState().emails.find((e) => e.id === 'e1')!;
    expect(e1.ivStatus).toBe('awaiting');
    expect(container.innerHTML).toContain('Awaiting confirmation');
  });

  it('calendar views render and the event panel opens', () => {
    reset({ page: 'cal', calView: 'month' });
    expect(mount()).toContain('October 2026');
    reset({ page: 'cal', calView: 'day', calSel: 'v1' });
    expect(mount()).toContain('Offer discussion call');
    reset({ page: 'cal', calView: 'agenda' });
    expect(mount()).toContain('Agenda · next 14 days');
    reset({ page: 'cal', calView: 'week' });
    mount();
    click('.ev.st-mgr');
    expect(useStore.getState().calSel).toBe('v3');
    expect(container.innerHTML).toContain('Hiring manager interview');
    click('[aria-label="Close event details"]');
    expect(useStore.getState().calSel).toBe('');
    click('.ev.st-mgr');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useStore.getState().calSel).toBe('');
  });

  it('calendar shows one account at a time and keeps past meetings', () => {
    const d = buildDemoData();
    const mine = d.emails.find((e) => e.id === 'e7')!.acct;
    const other = d.accts.find((a) => a.id !== mine)!.id;
    reset({ page: 'cal', calView: 'week', acctFilter: mine });
    mount();
    expect(container.querySelector('select[aria-label="Calendar account"]')).not.toBeNull();
    expect(container.querySelector('.ev.st-mgr')).not.toBeNull();
    reset({ page: 'cal', calView: 'week', acctFilter: other });
    mount();
    expect(container.querySelector('.ev.st-mgr')).toBeNull();
    reset({ page: 'cal', calView: 'week', calDate: '2026-10-19' });
    mount();
    expect(container.querySelectorAll('.ev.past').length).toBeGreaterThan(0);
  });

  it('tracker filters by account, applied date and status', () => {
    reset({ page: 'track', trFrom: '', trTo: '', trStage: 'all' });
    mount();
    const cards = () => container.querySelectorAll('.kc').length;
    const total = useStore.getState().apps.length;
    expect(cards()).toBe(total);
    const pick = (label: string, value: string) => {
      const sel = container.querySelector<HTMLInputElement | HTMLSelectElement>('[aria-label="' + label + '"]')!;
      act(() => {
        // React tracks the value itself: set it through the native setter, then fire input + change.
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value')!.set!.call(sel, value);
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    pick('Account', 'w1');
    const inW1 = useStore.getState().apps.filter((a) => a.acct === 'w1').length;
    expect(cards()).toBe(inW1);
    expect(container.textContent).toContain(inW1 + ' of ' + total + ' applications');
    pick('Account', 'all');
    pick('Status', 'review');
    expect(container.querySelectorAll('.kcol')).toHaveLength(1);
    expect(cards()).toBe(trackedApps(useStore.getState()).filter((a) => a.stage === 'review').length);
    pick('Status', 'all');
    pick('Applied from', '2026-10-20');
    const since20 = cards();
    expect(since20).toBeLessThan(total);
    expect(since20).toBeGreaterThan(0);
    pick('Applied to', '2026-10-22');
    expect(cards()).toBeLessThan(since20);
    click('.trf .btn');
    expect(cards()).toBe(total);
    click('[aria-label="Applied in"] button:nth-child(2)');
    expect(useStore.getState().trFrom).toBe('2026-10-26');
    expect(useStore.getState().trTo).toBe(useStore.getState().today);
    click('[aria-label="Applied in"] button:nth-child(2)');
    expect(useStore.getState().trFrom).toBe('');
  });

  it('sidebar counts follow the selected account', () => {
    reset({ page: 'inbox' });
    mount();
    const actionCnt = () => container.querySelector('[title="Action Required"] .cnt')?.textContent;
    const all = actionCnt();
    act(() => useStore.getState().patch({ acctFilter: 'w1' }));
    expect(actionCnt()).not.toBe(all);
    expect(Number(actionCnt() || 0)).toBe(useStore.getState().emails.filter((e) => e.acct === 'w1' && !e.archived && e.needs && !e.done).length);
  });

  it('tracker: accepting an AI suggestion moves the card', () => {
    reset({ page: 'track' });
    mount();
    // The demo's suggestion: Meridian Labs, Applied → Under Review.
    const accept = Array.from(container.querySelectorAll('.kc .ai .btn.pri'))[0] as HTMLButtonElement;
    act(() => accept.click());
    const a14 = useStore.getState().apps.find((a) => a.id === 'a14')!;
    expect(a14.stage).toBe('review');
    expect(a14.locked).toBe(false);
    expect(container.innerHTML).toContain('Meridian Labs moved to Under Review');
    click('.kcm');
    expect(container.innerHTML).toContain('Application detail');
  });

  it('modals render from state', () => {
    reset({ page: 'inbox', selId: 'e2', addCalOpen: true, addCalEv: 'v2' });
    expect(mount()).toContain('Add to calendar?');
    reset({ page: 'accounts', addAcctOpen: true });
    expect(mount()).toContain('Add email account');
    reset({ page: 'settings', cfOpen: true, cf: { kind: 'clear', title: 'Delete synced demo mail?', body: 'x', label: 'Delete', arg: '' } });
    expect(mount()).toContain('Delete synced demo mail?');
  });

  it('theme class follows the preference and the toggle', () => {
    reset({ themePref: 'dark' });
    expect(mount()).toContain('if if-root dark');
    click('button[aria-label="Switch light or dark theme"]');
    expect(container.querySelector('.if-root')?.className).toBe('if if-root');
  });

  it('empty inbox offers to restore demo mail', () => {
    reset({ page: 'inbox', emails: [], selId: '' });
    const html = mount();
    expect(html).toContain('Restore demo mail');
    expect(html).toContain('Select a conversation');
    const restore = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Restore demo mail');
    act(() => restore?.click());
    expect(useStore.getState().emails).toHaveLength(12);
  });

  it('Escape closes the topmost dialog', () => {
    reset({ page: 'inbox', selId: 'e1', schedOpen: true });
    mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useStore.getState().schedOpen).toBe(false);
  });

  it('a guest sees only Analytics in the sidebar and no inbox tools', () => {
    reset({ meId: 'm-morgan', page: 'inbox' });
    const html = mount();
    expect(useStore.getState().page).toBe('analytics');
    expect(window.location.pathname).toBe('/analytics');
    const labels = Array.from(container.querySelectorAll('.nav .ni .lbl')).map((n) => n.textContent);
    expect(labels).toEqual(['Analytics']);
    expect(container.querySelector('.srch')).toBeNull();
    expect(container.querySelector('.acsw')).toBeNull();
    expect(container.querySelector('button[aria-label^="Notifications"]')).toBeNull();
    expect(html).toContain('Guest view');
  });

  it('admins see Team & Roles; members do not', () => {
    mount();
    const labels = () => Array.from(container.querySelectorAll('.nav .ni .lbl')).map((n) => n.textContent);
    expect(labels()).toContain('Team & Roles');
    act(() => useStore.getState().switchUser('m-alex'));
    expect(labels()).not.toContain('Team & Roles');
    expect(labels()).toContain('Unified Inbox');
  });

  it('the user menu switches user', () => {
    mount();
    click('button.avatar');
    expect(container.innerHTML).toContain('Switch user');
    const morgan = Array.from(container.querySelectorAll<HTMLButtonElement>('.pop .nt')).find((b) => b.textContent?.includes('Morgan Patel'));
    act(() => morgan?.click());
    expect(useStore.getState().meId).toBe('m-morgan');
    expect(useStore.getState().page).toBe('analytics');
  });

  it('team page adds a person and shows validation errors', async () => {
    reset({ page: 'team' });
    mount();
    expect(container.innerHTML).toContain('What each role can do');
    const setVal = (sel: string, v: string) => {
      const el = container.querySelector<HTMLInputElement>(sel)!;
      act(() => {
        const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
        proto.set!.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    const addBtn = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Add person')!;
    await act(async () => {
      addBtn().click();
    });
    expect(container.innerHTML).toContain('Enter a name.');
    setVal('#tm-name', 'Kim Lee');
    setVal('#tm-email', 'kim@example.com');
    await act(async () => {
      addBtn().click();
    });
    expect(useStore.getState().members.some((m) => m.email === 'kim@example.com')).toBe(true);
    expect(container.innerHTML).toContain('Kim Lee');
  });
});
