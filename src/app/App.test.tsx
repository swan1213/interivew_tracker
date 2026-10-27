// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import type { Page } from '@/data/types';
import { seedMembers } from '@/lib/roles';
import { DEFAULT_SETTINGS, useStore, type AppState } from '@/store/store';
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

  it('tracker: accepting an AI suggestion moves the card', () => {
    reset({ page: 'track' });
    mount();
    // First suggestion in column order is Halcyon Health (Under Review → Interview Scheduling).
    const accept = Array.from(container.querySelectorAll('.kc .ai .btn.pri'))[0] as HTMLButtonElement;
    act(() => accept.click());
    const a10 = useStore.getState().apps.find((a) => a.id === 'a10')!;
    expect(a10.stage).toBe('sched');
    expect(a10.locked).toBe(false);
    expect(container.innerHTML).toContain('Halcyon Health moved to Interview Scheduling');
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
