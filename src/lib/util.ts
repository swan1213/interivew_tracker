import { COLORS, PRI } from '@/data/constants';
import type { Pri } from '@/data/types';

export const initialOf = (s?: string): string => (s || '?').trim().charAt(0).toUpperCase();

/** Stable color for a name. */
export function colorOf(s?: string): string {
  let h = 0;
  const t = s || '';
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 997;
  return COLORS[h % COLORS.length];
}

export function priV(p: Pri): { priCls: string; priLabel: string; bars: number } {
  const x = PRI[p] ?? PRI.normal;
  return { priCls: 'pri-' + p, priLabel: x.label, bars: x.bars };
}

export const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 2) + '…' : s);

/** Join class names, dropping falsy values. */
export const cx = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ');

export const firstName = (full: string): string => full.trim().split(/\s+/)[0] || full;

/** True when the string looks like "First Last". */
export const isPersonName = (s: string): boolean => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(s || '');
