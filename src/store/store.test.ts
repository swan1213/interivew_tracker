import { beforeEach, describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import { GRID_END_HOUR, GRID_START_HOUR, HOUR_PX } from '@/data/constants';
import { seedMembers } from '@/lib/roles';
import { DEFAULT_SETTINGS, drag, useStore } from './store';

function reset() {
  const d = buildDemoData();
  useStore.setState({
    ...d, selId: 'e1', page: 'dash', view: 'inbox', compOpen: false, compText: '', aiDraft: '', chosen: [], schedSel: [],
    sendOpen: false, schedOpen: false, addCalOpen: false, cfOpen: false, calSel: '', appSel: '', toast: '', S: DEFAULT_SETTINGS, tone: 'professional',
    mods: { short: false, prof: false }, variant: 0, acctFilter: 'all', anAcct: 'all', compFrom: 'g1',
    members: seedMembers('Jordan Lee', true), meId: 'owner', userMenuOpen: false,
  });
}
const st = () => useStore.getState();

describe('store actions', () => {
  beforeEach(reset);

  it('opening an email selects it, marks it read and lands on the inbox', () => {
    expect(st().emails.find((e) => e.id === 'e2')!.unread).toBe(true);
    st().openEmail('e2');
    expect(st().page).toBe('inbox');
    expect(st().selId).toBe('e2');
    expect(st().emails.find((e) => e.id === 'e2')!.unread).toBe(false);
  });

  it('opening an email hidden by the current smart view falls back to the unified view', () => {
    st().openView('offers');
    st().openEmail('e3');
    expect(st().view).toBe('inbox');
    st().openView('offers');
    st().openEmail('e9');
    expect(st().view).toBe('offers');
  });

  it('manual kanban moves lock the card and clear AI suggestions', () => {
    st().moveApp('a7', 'next', true);
    const a = st().apps.find((x) => x.id === 'a7')!;
    expect(a.stage).toBe('next');
    expect(a.locked).toBe(true);
    expect(a.ai).toBeNull();
    expect(a.timeline[0].src).toBe('You (manual, kept)');
    expect(st().activity[0].text).toBe('Atlassian moved to Next Step Interview');
  });

  it('accepting an AI suggestion moves without locking', () => {
    st().moveApp('a8', 'next', false);
    const a = st().apps.find((x) => x.id === 'a8')!;
    expect(a.stage).toBe('next');
    expect(a.locked).toBe(false);
  });

  it('sending an availability reply marks the thread awaiting and updates the tracker', () => {
    st().openEmail('e1');
    st().openSched('avail');
    st().toggleSlot('2026-10-27|9');
    st().toggleSlot('2026-10-28|11');
    expect(st().schedSel).toHaveLength(2);
    st().toggleSlot('2026-10-29|11');
    st().toggleSlot('2026-10-30|11'); // more than the 3 asked for is fine, with no upper limit
    st().toggleSlot('2026-10-30|13');
    st().toggleSlot('2026-10-30|15');
    expect(st().schedSel).toHaveLength(6);
    st().toggleSlot('2026-10-30|15'); // clicking again deselects
    expect(st().schedSel).toHaveLength(5);
    st().genSchedReply();
    expect(st().schedOpen).toBe(false);
    expect(st().compOpen).toBe(true);
    expect(st().compText).toContain('• Tue, Oct 27 at 9:00 AM ET');
    st().askSend();
    st().confirmSend();
    const e = st().emails.find((x) => x.id === 'e1')!;
    expect(e.done).toBe(true);
    expect(e.ivStatus).toBe('awaiting');
    expect(e.thread[e.thread.length - 1].mine).toBe(true);
    expect(st().apps.find((a) => a.co === 'Microsoft')!.next).toBe('Awaiting confirmation (you sent availability)');
    expect(st().compOpen).toBe(false);
  });

  it('refuses to send an empty composer', () => {
    st().openEmail('e5');
    st().openComp('reply');
    st().askSend();
    st().confirmSend();
    expect(st().sendOpen).toBe(true);
    expect(st().emails.find((x) => x.id === 'e5')!.done).toBeUndefined();
  });

  it('no-reply senders cannot open a reply composer', () => {
    st().openEmail('e8');
    st().openComp('reply');
    expect(st().compOpen).toBe(false);
    expect(st().toast).toContain('no-reply');
    st().openComp('forward');
    expect(st().compOpen).toBe(true);
  });

  it('adding a confirmed interview to the calendar completes the email and syncs the tracker', () => {
    st().openEmail('e2');
    st().openAddCal('v2');
    st().confirmAddCal();
    expect(st().events.find((v) => v.id === 'v2')!.added).toBe(true);
    const e = st().emails.find((x) => x.id === 'e2')!;
    expect(e.done).toBe(true);
    expect(e.ivStatus).toBe('confirmed');
    expect(st().apps.find((a) => a.co === 'Amazon')!.next).toBe('Tomorrow, 11:00 AM ET');
    expect(st().calSel).toBe('v2');
  });

  it('dragging an event snaps to half hours, clamps to the grid and reports conflicts', () => {
    drag.ev = 'v3';
    st().dropEventAt('2026-10-29', (13 - GRID_START_HOUR) * HOUR_PX + 10); // ~13:10 → 13:00, overlaps doctor appointment
    const v = st().events.find((x) => x.id === 'v3')!;
    expect(v.date).toBe('2026-10-29');
    expect(v.start).toBe(13);
    expect(v.end).toBe(14);
    expect(st().toast).toContain('conflicts with Doctor appointment');
    drag.ev = 'v3';
    st().dropEventAt('2026-10-30', 9999);
    expect(st().events.find((x) => x.id === 'v3')!.end).toBe(GRID_END_HOUR);
  });

  it('disconnecting an account removes its mail and resets filters that pointed at it', () => {
    useStore.setState({ acctFilter: 'w1', compFrom: 'w1' });
    st().ask('disconnect', 'x', 'y', 'Disconnect', 'w1');
    st().confirmCf();
    expect(st().accts.map((a) => a.id)).toEqual(['g1', 'o1']);
    expect(st().emails.some((e) => e.acct === 'w1')).toBe(false);
    expect(st().acctFilter).toBe('all');
    expect(st().compFrom).toBe('g1');
  });

  it('clearing demo mail then clearing filters restores it', () => {
    st().ask('clear', 'x', 'y', 'Delete');
    st().confirmCf();
    expect(st().emails).toHaveLength(0);
    st().clearFilters();
    expect(st().emails).toHaveLength(12);
    expect(st().selId).toBe('e1');
  });

  it('reclassification overrides the AI and is reflected in confidence', () => {
    st().openEmail('e12');
    st().reclassify('status');
    const e = st().emails.find((x) => x.id === 'e12')!;
    expect(e.catOv).toBe('status');
    expect(e.conf).toBe(100);
  });

  it('settings updates are immutable', () => {
    const before = st().S;
    st().setS((x) => void (x.whDays = [2]));
    expect(st().S.whDays).toEqual([2]);
    expect(before.whDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('theme toggle flips between light and dark', () => {
    useStore.setState({ themePref: 'light' });
    st().toggleTheme();
    expect(st().themePref).toBe('dark');
    st().toggleTheme();
    expect(st().themePref).toBe('light');
  });
});

describe('team and roles', () => {
  beforeEach(reset);

  it('a guest is held on Analytics whatever page is requested', () => {
    st().switchUser('m-morgan');
    expect(st().page).toBe('analytics');
    st().go('inbox');
    expect(st().page).toBe('analytics');
    st().openEmail('e2');
    expect(st().page).toBe('analytics');
    st().patch({ page: 'settings' });
    expect(st().page).toBe('analytics');
    st().switchUser('owner');
    st().go('inbox');
    expect(st().page).toBe('inbox');
  });

  it('a member cannot open team management but can use the rest', () => {
    st().switchUser('m-alex');
    st().go('team');
    expect(st().page).toBe('dash');
    st().go('track');
    expect(st().page).toBe('track');
  });

  it('switching user closes open dialogs', () => {
    st().patch({ schedOpen: true, compOpen: true, userMenuOpen: true });
    st().switchUser('m-alex');
    expect(st().schedOpen).toBe(false);
    expect(st().compOpen).toBe(false);
    expect(st().userMenuOpen).toBe(false);
    expect(st().meId).toBe('m-alex');
  });

  it('admins add people and change roles', async () => {
    expect(await st().addMember('Kim Lee', 'Kim@Example.com', 'guest')).toBe('');
    const kim = st().members.find((m) => m.email === 'kim@example.com')!;
    expect(kim.role).toBe('guest');
    expect(await st().addMember('Kim Again', 'kim@example.com', 'member')).toContain('already on the team');
    st().setMemberRole(kim.id, 'member');
    expect(st().members.find((m) => m.id === kim.id)!.role).toBe('member');
  });

  it('keeps at least one admin', () => {
    st().setMemberRole('owner', 'guest');
    expect(st().members.find((m) => m.id === 'owner')!.role).toBe('admin');
    expect(st().toast).toContain('at least one admin');
  });

  it('an admin who hands over and demotes themselves loses the team page', () => {
    st().go('team');
    st().setMemberRole('m-alex', 'admin');
    st().setMemberRole('owner', 'member');
    expect(st().members.find((m) => m.id === 'owner')!.role).toBe('member');
    expect(st().page).toBe('dash');
  });

  it('non-admins cannot change the team', async () => {
    st().switchUser('m-alex');
    expect(await st().addMember('Kim', 'kim@example.com', 'admin')).toBe('Only admins can add people.');
    st().setMemberRole('m-alex', 'admin');
    expect(st().members.find((m) => m.id === 'm-alex')!.role).toBe('member');
    st().ask('removeMember', 'Remove?', '', 'Remove', 'm-morgan');
    st().confirmCf();
    expect(st().members.some((m) => m.id === 'm-morgan')).toBe(true);
  });

  it('removing a person goes through the confirm dialog', () => {
    st().ask('removeMember', 'Remove Morgan?', '', 'Remove', 'm-morgan');
    st().confirmCf();
    expect(st().members.some((m) => m.id === 'm-morgan')).toBe(false);
    st().ask('removeMember', 'Remove me?', '', 'Remove', 'owner');
    st().confirmCf();
    expect(st().members.some((m) => m.id === 'owner')).toBe(true);
  });
});
