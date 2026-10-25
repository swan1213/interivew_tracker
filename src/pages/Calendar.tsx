import type { CSSProperties } from 'react';
import { drag, useStore } from '@/store/store';
import { provider } from '@/data/provider';
import { DN, GRID_END_HOUR, GRID_START_HOUR, HOUR_PX, MFULL, MN, STG } from '@/data/constants';
import type { Account, CalEvent, CalView } from '@/data/types';
import { activeEvents, conflictCount, conflictOf, layoutLanes, type Lane } from '@/lib/calendar';
import { addD, dObj, fmtT, hourLab, hrs, iso, lab, minutesLabel, mondayOf, rel, tzOffset } from '@/lib/time';
import { cx } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { AcDot, Empty, Fact, Seg } from '@/ui/bits';

/** Calendars shown in the header, one per mailbox in its color; the demo shows its fictional ones. */
function calendarSources(accts: Account[]): { label: string; color: string; title: string }[] {
  if (provider.isDemo) return ['Google Calendar synced', 'Microsoft Calendar synced'].map((label) => ({ label, color: 'var(--ok)', title: label }));
  return accts.map((a) =>
    a.calendar
      ? { label: a.addr, color: a.color, title: 'Google Calendar synced for ' + a.addr }
      : { label: a.addr + ' · reconnect for calendar', color: 'var(--warn)', title: 'Connect ' + a.addr + ' again and allow Google Calendar access' },
  );
}

/** The mailbox an event belongs to. */
const acctOf = (accts: Account[], v: CalEvent): Account | undefined => (v.acct ? accts.find((a) => a.id === v.acct) : undefined);

/** A stripe in the mailbox color down the event's left edge, plus the selection ring. */
function accent(a: Account | undefined, selected = false): CSSProperties | undefined {
  const shadows = [a ? 'inset 3px 0 0 ' + a.color : '', selected ? '0 0 0 2px var(--ac)' : ''].filter(Boolean);
  return shadows.length ? { boxShadow: shadows.join(', ') } : undefined;
}

/** Meeting links in mail often lack a scheme. */
const href = (link: string): string => (/^https?:\/\//i.test(link) ? link : 'https://' + link);

function LinkOut({ url, children }: { url: string; children?: string }) {
  return (
    <a href={href(url)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ac)', wordBreak: 'break-all' }}>
      {children || url}
    </a>
  );
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const CAL_TABS: { k: CalView; l: string }[] = [
  { k: 'month', l: 'Month' },
  { k: 'week', l: 'Week' },
  { k: 'day', l: 'Day' },
  { k: 'agenda', l: 'Agenda' },
];

export function CalendarPage() {
  const st = useStore();
  const S = st.S;
  const off = tzOffset(S.tz);
  const view = st.calView;
  const cd = st.calDate;
  const ws = hrs(S.whStart);
  const we = hrs(S.whEnd);
  const active = activeEvents(st.events);
  const days = view === 'day' ? [cd] : range(7).map((i) => addD(mondayOf(cd), i));
  const m0 = dObj(cd);

  let title: string;
  if (view === 'month') title = MFULL[m0.getUTCMonth()] + ' ' + m0.getUTCFullYear();
  else if (view === 'day') title = lab(cd) + ', ' + m0.getUTCFullYear();
  else if (view === 'agenda') title = 'Agenda · next 14 days';
  else {
    const a = dObj(days[0]);
    const b = dObj(days[6]);
    title = MN[a.getUTCMonth()] + ' ' + a.getUTCDate() + ' – ' + (a.getUTCMonth() !== b.getUTCMonth() ? MN[b.getUTCMonth()] + ' ' : '') + b.getUTCDate() + ', ' + b.getUTCFullYear();
  }

  const step = (dir: -1 | 1) => () => {
    if (view === 'month') {
      const d = dObj(cd);
      d.setUTCMonth(d.getUTCMonth() + dir);
      st.patch({ calDate: iso(d) });
    } else {
      st.patch({ calDate: addD(cd, dir * (view === 'day' ? 1 : view === 'agenda' ? 14 : 7)) });
    }
  };

  const selected = st.calSel ? active.find((x) => x.id === st.calSel) : undefined;
  const ncf = conflictCount(active);
  const availText = S.whDays.slice().sort().map((d) => DN[d]).join(', ') + ' · ' + fmtT(ws + off) + ' to ' + fmtT(we + off) + ' ' + S.tz;

  return (
    <div className="cal">
      <div className="ctool">
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 650, letterSpacing: '-.015em', minWidth: 150 }}>{title}</h1>
        <div className="ln">
          <button type="button" className="ib" onClick={step(-1)} aria-label="Previous">
            <Icon name="chevL" />
          </button>
          <button type="button" className="btn sm" onClick={() => st.patch({ calDate: st.today })}>
            Today
          </button>
          <button type="button" className="ib" onClick={step(1)} aria-label="Next">
            <Icon name="chevR" />
          </button>
        </div>
        <Seg value={view} options={CAL_TABS} onChange={(k) => st.patch({ calView: k })} ariaLabel="Calendar view" />
        <span className="sp" />
        <label className="ln mini">
          Time zone
          <select className="sel" value={S.tz} onChange={(e) => st.setS((x) => void (x.tz = e.target.value as typeof x.tz))}>
            <option value="ET">Eastern (ET)</option>
            <option value="PT">Pacific (PT)</option>
            <option value="UTC">UTC</option>
          </select>
        </label>
        {calendarSources(st.accts).map((c) => (
          <span key={c.label} className="tag" title={c.title}>
            <span className="cdot" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>

      <div className="calbody">
        <div className="calmain">
          {(view === 'week' || view === 'day') && <WeekGrid days={days} active={active} />}
          {view === 'month' && <MonthGrid active={active} />}
          {view === 'agenda' && <Agenda active={active} />}
        </div>

        <aside className="calside" aria-label="Event details">
          {selected ? (
            <EventPanel v={selected} active={active} />
          ) : (
            <>
              <div className="mut">Select an event to see details, reminders and conflicts.</div>
              <div>
                <span className="fl">Stage colors</span>
                <div className="stagebox">
                  {(['screen', 'tech', 'mgr', 'final', 'offer', 'busy'] as const).map((k) => (
                    <span key={k} className={cx('chip', STG[k].cls)}>
                      {STG[k].label}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="card" style={{ padding: 12 }}>
            <span className="fl">Your availability</span>
            <b style={{ fontWeight: 600 }}>{availText}</b>
            <div className="mut">Shaded green in Week and Day. Slot suggestions respect this window and existing events.</div>
          </div>
          <div className="card" style={{ padding: 12 }}>
            <span className="fl">Conflict check</span>
            <b style={{ fontWeight: 600 }}>{ncf ? ncf + ' interview' + (ncf > 1 ? 's' : '') + ' overlap another event' : 'No conflicts across your calendars'}</b>
          </div>
        </aside>
      </div>
    </div>
  );
}

function WeekGrid({ days, active }: { days: string[]; active: CalEvent[] }) {
  const st = useStore();
  const off = tzOffset(st.S.tz);
  const ws = hrs(st.S.whStart);
  const we = hrs(st.S.whEnd);
  const hours = range(GRID_END_HOUR - GRID_START_HOUR).map((i) => GRID_START_HOUR + i);
  return (
    <div className="wk">
      <div className="wkh">
        <div style={{ height: 44 }} />
        <div>
          {hours.map((h) => (
            <div key={h} className="hrl">
              {hourLab(h + off)}
            </div>
          ))}
        </div>
      </div>
      {days.map((dt) => {
        const dow = dObj(dt).getUTCDay();
        const evs = active.filter((v) => v.date === dt);
        // Events are drawn at least 22px tall, so lay them out by that height too.
        const lanes = layoutLanes(evs, 22 / HOUR_PX);
        return (
          <div className="wkc" key={dt}>
            <div className={cx('wkhead', dt === st.today && 'today')}>
              <span>{DN[dow]}</span>
              <b>{dObj(dt).getUTCDate()}</b>
            </div>
            <div
              className="hrs"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                st.dropEventAt(dt, e.clientY - r.top);
              }}
            >
              <div
                className="avail"
                style={{ top: (ws - GRID_START_HOUR) * HOUR_PX, height: Math.max(0, (we - ws) * HOUR_PX), display: st.S.whDays.includes(dow) ? 'block' : 'none' }}
                title="Your interview availability"
              />
              {evs.map((v) => (
                <EventBlock key={v.id} v={v} active={active} lane={lanes.get(v.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventBlock({ v, active, lane }: { v: CalEvent; active: CalEvent[]; lane?: Lane }) {
  const st = useStore();
  const off = tzOffset(st.S.tz);
  const isIv = v.kind === 'interview';
  const c = isIv ? conflictOf(v, active) : null;
  const h = Math.max(22, (v.end - v.start) * HOUR_PX - 2);
  const sel = st.calSel === v.id;
  const cols = lane?.lanes || 1;
  // Overlapping events share the column width side by side.
  const place: CSSProperties = cols > 1 ? { left: 'calc(' + ((lane!.lane / cols) * 100).toFixed(3) + '% + 2px)', width: 'calc(' + (100 / cols).toFixed(3) + '% - 4px)', right: 'auto' } : {};
  const when = fmtT(v.start + off) + '–' + fmtT(v.end + off);
  return (
    <button
      type="button"
      className={cx('ev', STG[v.stage].cls, !isIv && 'busy', sel && 'sel3', c && 'cf')}
      style={{ top: (v.start - GRID_START_HOUR) * HOUR_PX, height: h, ...place, ...accent(acctOf(st.accts, v), sel) }}
      title={v.co + (v.role ? ' · ' + v.role : '') + '\n' + when + (v.platform ? '\n' + v.platform : '')}
      onClick={() => st.patch({ calSel: v.id })}
      draggable={isIv}
      onDragStart={(e) => {
        drag.ev = v.id;
        try {
          e.dataTransfer.setData('text/plain', v.id);
        } catch {
          /* ignore */
        }
      }}
      aria-label={v.co + ', ' + v.role + ', ' + lab(v.date) + ' ' + fmtT(v.start + off)}
    >
      <b>{v.co}</b>
      {h > 40 ? when : ''}
    </button>
  );
}

function MonthGrid({ active }: { active: CalEvent[] }) {
  const st = useStore();
  const off = tzOffset(st.S.tz);
  const m0 = dObj(st.calDate);
  const first = iso(new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth(), 1)));
  const gridStart = mondayOf(first);
  const month = m0.getUTCMonth();
  return (
    <div className="mgrid">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((t) => (
        <div className="mh2" key={t}>
          {t}
        </div>
      ))}
      {range(42).map((i) => {
        const dt = addD(gridStart, i);
        const o = dObj(dt);
        const es = active.filter((v) => v.date === dt).sort((a, b) => a.start - b.start);
        return (
          <button key={dt} type="button" className={cx('mc', o.getUTCMonth() !== month && 'dim')} onClick={() => st.patch({ calDate: dt, calView: 'day' })} aria-label={lab(dt) + (es.length ? ', ' + es.length + ' events' : '')}>
            <span className={cx('dnum', dt === st.today && 'today')}>{o.getUTCDate()}</span>
            {es.slice(0, 3).map((v) => (
              <span key={v.id} className={cx('mev', STG[v.stage].cls)} style={accent(acctOf(st.accts, v))}>
                {fmtT(v.start + off).replace(':00', '')} {v.co}
              </span>
            ))}
            {es.length > 3 && <span className="mut">+{es.length - 3} more</span>}
          </button>
        );
      })}
    </div>
  );
}

function Agenda({ active }: { active: CalEvent[] }) {
  const st = useStore();
  const off = tzOffset(st.S.tz);
  const days = range(14)
    .map((i) => addD(st.calDate, i))
    .map((dt) => ({ dt, es: active.filter((v) => v.date === dt).sort((a, b) => a.start - b.start) }))
    .filter((d) => d.es.length);
  return (
    <div className="ag">
      {days.map(({ dt, es }) => {
        const r = rel(dt, st.today);
        return (
          <div className="agd" key={dt}>
            <h3>{r + (r === lab(dt) ? '' : ' · ' + lab(dt))}</h3>
            {es.map((v) => {
              const isIv = v.kind === 'interview';
              const conflict = isIv && !!conflictOf(v, active);
              const a = acctOf(st.accts, v);
              const where = [v.platform, v.location && v.location !== v.link ? v.location : ''].filter(Boolean).join(' · ');
              return (
                <button key={v.id} type="button" className="agi" onClick={() => st.patch({ calSel: v.id, calView: 'week', calDate: dt })}>
                  <span className="tm">
                    {fmtT(v.start + off)}
                    <small>{minutesLabel(v)}</small>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600 }}>
                      {v.co}: {v.role}
                    </b>
                    <div className="mini">{isIv ? v.platform + ' · with ' + v.interviewer : where || 'Existing commitment'}</div>
                  </span>
                  {a && <AcDot color={a.color} initial={a.initial} size={16} title={a.addr} />}
                  {conflict && (
                    <span className="chip" style={{ ['--c' as string]: 'var(--bad)', ['--cb' as string]: 'var(--badb)' }}>
                      Conflict
                    </span>
                  )}
                  <span className={cx('chip', STG[v.stage].cls)}>{STG[v.stage].label}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      {days.length === 0 && <Empty title="Nothing scheduled" text="No interviews or commitments in this range." />}
    </div>
  );
}

function EventPanel({ v, active }: { v: CalEvent; active: CalEvent[] }) {
  const st = useStore();
  const S = st.S;
  const off = tzOffset(S.tz);
  const c = conflictOf(v, active);
  const isIv = v.kind === 'interview';
  const remDefs: [number, string][] = [
    [1440, '24 hours'],
    [60, '1 hour'],
    [30, '30 min'],
    [10, '10 min'],
    [S.customRem, S.customRem + ' min (custom)'],
  ];
  const linkedEmail = v.emailId ? st.emails.find((e) => e.id === v.emailId) : undefined;
  const a = acctOf(st.accts, v);
  const guests = v.attendees || [];
  return (
    <>
      <div>
        <div className="ln wrap" style={{ marginBottom: 6 }}>
          <span className={cx('chip', STG[v.stage].cls)}>{STG[v.stage].label}</span>
          {c && (
            <span className="chip" style={{ ['--c' as string]: 'var(--bad)', ['--cb' as string]: 'var(--badb)' }}>
              Scheduling conflict
            </span>
          )}
        </div>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>{v.co}</h2>
        <div className="mini">{v.role + (v.pendingNote ? ' · ' + v.pendingNote : '')}</div>
      </div>
      <div className="fgrid" style={{ gridTemplateColumns: '1fr', margin: 0 }}>
        <Fact label={'When (' + S.tz + ')'}>
          {rel(v.date, st.today)} · {fmtT(v.start + off)} to {fmtT(v.end + off)}
        </Fact>
        {a && (
          <Fact label="Calendar">
            <span className="ln" style={{ gap: 6 }}>
              <AcDot color={a.color} initial={a.initial} size={16} />
              {a.addr}
            </span>
          </Fact>
        )}
        {!isIv && v.platform && <Fact label="Platform">{v.platform}</Fact>}
        {!isIv && v.link && (
          <Fact label="Meeting link">
            <LinkOut url={v.link} />
          </Fact>
        )}
        {!isIv && v.location && v.location !== v.link && <Fact label="Location">{v.location}</Fact>}
        {!isIv && v.organizer && <Fact label="Organizer">{v.organizer}</Fact>}
        {!isIv && guests.length > 0 && <Fact label={'Guests (' + guests.length + ')'}>{guests.slice(0, 8).join(', ') + (guests.length > 8 ? ' and ' + (guests.length - 8) + ' more' : '')}</Fact>}
        {isIv && (
          <>
            <Fact label="Interviewer">{v.interviewer}</Fact>
            <Fact label="Platform">{v.platform}</Fact>
            <Fact label="Meeting link">{v.link ? <LinkOut url={v.link} /> : 'Not stated'}</Fact>
            <Fact label="Synced to">{provider.isDemo ? 'Google Calendar and Microsoft Calendar' : v.added && st.accts.some((a) => a.calendar) ? 'Google Calendar' : 'Not synced'}</Fact>
          </>
        )}
      </div>
      {c && (
        <div className="act" style={{ fontSize: 12 }}>
          This overlaps with {c.co}. Move one of them or reschedule.
        </div>
      )}
      {!isIv && v.notes && (
        <div>
          <span className="fl">Notes</span>
          <div className="mini" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
            {v.notes}
          </div>
        </div>
      )}
      {!isIv && (v.link || v.htmlLink) && (
        <div className="ln wrap">
          {v.link && (
            <a className="btn sm pri" href={href(v.link)} target="_blank" rel="noopener noreferrer">
              Join meeting
            </a>
          )}
          {v.htmlLink && (
            <a className="btn sm" href={v.htmlLink} target="_blank" rel="noopener noreferrer">
              Open in Google Calendar
            </a>
          )}
        </div>
      )}
      {isIv && (
        <>
          <div>
            <span className="fl">Reminders</span>
            <div className="stagebox">
              {remDefs.map(([m, label]) => {
                const on = (v.rem || []).includes(m);
                return (
                  <button key={label} type="button" className={cx('tog', on && 'on')} onClick={() => st.toggleReminder(v.id, m)} aria-pressed={on}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="fl" htmlFor="ev-title">
              Edit event
            </label>
            <input id="ev-title" className="inp" value={v.co} onChange={(e) => st.renameEvent(v.id, e.target.value)} aria-label="Event title" />
            <div className="ln wrap" style={{ marginTop: 6 }}>
              <button type="button" className="btn sm" onClick={() => st.shiftEvent(v.id, -1)}>
                30 min earlier
              </button>
              <button type="button" className="btn sm" onClick={() => st.shiftEvent(v.id, 1)}>
                30 min later
              </button>
            </div>
            <div className="mut" style={{ marginTop: 6 }}>
              Tip: drag an event to another time in Week or Day view.
            </div>
          </div>
          <div className="ln wrap">
            <button type="button" className="btn sm" onClick={() => (v.emailId ? st.openEmail(v.emailId) : st.showToast('No email linked to this event.'))}>
              <Icon name="mail" sm />
              Open email
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                if (linkedEmail && linkedEmail.mode === 'resched' && !linkedEmail.done) {
                  st.openEmail(linkedEmail.id);
                  st.openSched('resched');
                } else st.showToast('Reschedule: reply to the recruiter with new times.');
              }}
            >
              Reschedule
            </button>
            <button
              type="button"
              className="btn sm dng"
              onClick={() => st.ask('removeEv', 'Remove from calendar?', 'This removes "' + v.co + '" from your connected calendars. The email stays in your inbox.', 'Remove', v.id)}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </>
  );
}
