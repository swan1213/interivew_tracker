import type { CSSProperties } from 'react';
import { ICONS, type IconName } from '@/data/constants';
import { cx } from '@/lib/util';

export function Icon({ name, sm, className, style }: { name: IconName; sm?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <svg className={cx('ic', sm && 'sm', className)} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      <path d={ICONS[name]} />
    </svg>
  );
}
