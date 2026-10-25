import type { CSSProperties, ReactNode } from 'react';
import type { Cat, Pri, Role } from '@/data/types';
import { CAT, type IconName } from '@/data/constants';
import { colorOf, cx, initialOf, priV } from '@/lib/util';
import { roleMeta } from '@/lib/roles';
import { Icon } from './Icon';

export function CatChip({ cat, dash, withIcon = true, className }: { cat: Cat; dash?: boolean; withIcon?: boolean; className?: string }) {
  return (
    <span className={cx('chip', 'cat-' + cat, dash && 'dash', className)}>
      {withIcon && <Icon name={CAT[cat].i} />}
      {CAT[cat].l}
    </span>
  );
}

export function RoleChip({ role }: { role: Role }) {
  const r = roleMeta(role);
  return <span className={cx('chip', r.cls)}>{r.l}</span>;
}

export function PriBadge({ p, suffix }: { p: Pri; suffix?: string }) {
  const v = priV(p);
  return (
    <span className={cx('pri', v.priCls)}>
      <i>
        <s className={v.bars >= 1 ? 'on' : ''} />
        <s className={v.bars >= 2 ? 'on' : ''} />
        <s className={v.bars >= 3 ? 'on' : ''} />
      </i>
      {v.priLabel}
      {suffix ? ' ' + suffix : ''}
    </span>
  );
}

/** Account dot: colored square with the provider initial. */
export function AcDot({ color, initial, size, title, style }: { color: string; initial: string; size?: number; title?: string; style?: CSSProperties }) {
  const s: CSSProperties = {
    background: color,
    ...(size ? { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)), borderRadius: Math.max(5, Math.round(size * 0.28)) } : {}),
    ...style,
  };
  return (
    <span className="acdot" style={s} title={title}>
      {initial}
    </span>
  );
}

/** Company badge: stable color per name, first letter. */
export function CoBadge({ name, size = 30, radius = 8 }: { name: string; size?: number; radius?: number }) {
  return (
    <span
      className="co"
      style={{ width: size, height: size, borderRadius: radius, display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 650, background: colorOf(name), flex: 'none', fontSize: size <= 26 ? 12 : 13 }}
    >
      {initialOf(name)}
    </span>
  );
}

export function Switch({ on, onToggle, disabled, label }: { on: boolean; onToggle: () => void; disabled?: boolean; label: string }) {
  return <button type="button" className={cx('sw', on && 'on')} onClick={onToggle} disabled={disabled} role="switch" aria-checked={on} aria-label={label} />;
}

export function Seg<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { k: T; l: string }[]; onChange: (k: T) => void; ariaLabel?: string }) {
  return (
    <div className="seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.k} type="button" role="tab" className={o.k === value ? 'on' : ''} aria-selected={o.k === value} onClick={() => onChange(o.k)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Modal({ children, size, label, role = 'dialog', onClose }: { children: ReactNode; size?: 'sm' | 'lg'; label: string; role?: 'dialog' | 'alertdialog'; onClose?: () => void }) {
  return (
    <div
      className="modalbg"
      onMouseDown={(e) => {
        if (onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cx('modal', size)} role={role} aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, children, style }: { icon?: IconName; title: string; text?: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="empty" style={style}>
      {icon && <Icon name={icon} />}
      <b>{title}</b>
      {text && <span>{text}</span>}
      {children}
    </div>
  );
}

/** One label/value pair inside a `.fgrid`. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

/** Horizontal bar row used in dashboard and analytics cards. */
export function RowBar({ name, n, pct, color, title, nameWidth, lead }: { name: string; n: number | string; pct: number; color?: string; title?: string; nameWidth?: number; lead?: ReactNode }) {
  return (
    <div className="rowbar" title={title}>
      {lead}
      <span className="nm" style={nameWidth ? { width: nameWidth } : undefined}>
        {name}
      </span>
      <span className="bar">
        <i style={{ width: pct + '%', ...(color ? { background: color } : {}) }} />
      </span>
      <span className="v">{n}</span>
    </div>
  );
}
