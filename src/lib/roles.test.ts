import { describe, expect, it } from 'vitest';
import type { Page } from '@/data/types';
import {
  canSee, currentRole, homePage, newMemberError, removeMemberError, restoreMeId, restoreMembers, roleChangeError, seedMembers,
} from './roles';

const PAGES: Page[] = ['dash', 'inbox', 'cal', 'track', 'analytics', 'accounts', 'team', 'settings'];

describe('roles', () => {
  it('guests see only Analytics', () => {
    expect(PAGES.filter((p) => canSee('guest', p))).toEqual(['analytics']);
    expect(homePage('guest')).toBe('analytics');
  });

  it('members see everything except team management', () => {
    expect(PAGES.filter((p) => !canSee('member', p))).toEqual(['team']);
    expect(homePage('member')).toBe('dash');
  });

  it('admins see every page', () => {
    expect(PAGES.every((p) => canSee('admin', p))).toBe(true);
  });

  it('seeds the owner as admin, with sample people in the demo', () => {
    expect(seedMembers('Jordan Lee', false)).toEqual([{ id: 'owner', name: 'Jordan Lee', email: '', role: 'admin' }]);
    expect(seedMembers('Jordan Lee', true).map((m) => m.role)).toEqual(['admin', 'member', 'guest']);
  });

  it('restores a saved team only when it is well-formed and has an admin', () => {
    const saved = [{ id: 'a', name: 'A', email: 'a@x.com', role: 'admin' }, { id: 'b', name: 'B', email: 'b@x.com', role: 'guest' }];
    expect(restoreMembers(saved, 'Me', false)).toEqual(saved);
    expect(restoreMembers([{ id: 'b', name: 'B', email: 'b@x.com', role: 'guest' }], 'Me', false)[0].id).toBe('owner');
    expect(restoreMembers([{ id: 'c', name: 'C', email: 'c@x.com', role: 'boss' }], 'Me', false)[0].id).toBe('owner');
    expect(restoreMembers('nope', 'Me', false)[0].role).toBe('admin');
  });

  it('falls back to the first admin when the saved user is gone', () => {
    const team = seedMembers('Me', true);
    expect(restoreMeId('m-morgan', team)).toBe('m-morgan');
    expect(restoreMeId('ghost', team)).toBe('owner');
    expect(currentRole({ members: team, meId: 'm-morgan' })).toBe('guest');
    expect(currentRole({ members: [], meId: '' })).toBe('guest');
  });

  it('validates new people', () => {
    const team = seedMembers('Me', true);
    expect(newMemberError(team, ' ', 'x@y.com')).toBe('Enter a name.');
    expect(newMemberError(team, 'Kim', 'not-an-email')).toBe('Enter a valid email address.');
    expect(newMemberError(team, 'Kim', 'Alex.Rivera@example.com')).toContain('already on the team');
    expect(newMemberError(team, 'Kim', 'kim@example.com')).toBe('');
  });

  it('never leaves the workspace without an admin', () => {
    const team = seedMembers('Me', true);
    expect(roleChangeError(team, 'owner', 'guest')).toContain('at least one admin');
    expect(roleChangeError(team, 'm-alex', 'admin')).toBe('');
    const two = team.map((m) => (m.id === 'm-alex' ? { ...m, role: 'admin' as const } : m));
    expect(roleChangeError(two, 'owner', 'member')).toBe('');
    expect(removeMemberError(team, 'owner', 'owner')).toContain('cannot remove yourself');
    expect(removeMemberError(team, 'm-morgan', 'owner')).toBe('');
  });
});
