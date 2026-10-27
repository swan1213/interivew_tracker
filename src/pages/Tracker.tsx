import { drag, useStore, type AppState } from '@/store/store';
import { getAcct, trackedApps } from '@/store/selectors';
import { STAGES } from '@/data/constants';
import type { Application, StageKey } from '@/data/types';
import { appliedDay } from '@/lib/mail';
import { addD, iso, mondayOf } from '@/lib/time';
import { cx } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { AcDot, CoBadge, Fact, PriBadge, Seg } from '@/ui/bits';

type Range = AppState['trRange'];
const RANGES: { k: Range; l: string }[] = [
  { k: 'today', l: 'Today' },
  { k: 'week', l: 'Week' },
  { k: 'month', l: 'Month' },
  { k: 'year', l: 'Year' },
];

/** First and last day of today, this week (Monday to Sunday), this month or this year; empty for any time. */
function period(k: Range, today: string): [string, string] {
  if (k === 'today') return [today, today];
  if (k === 'week') return [mondayOf(today), addD(mondayOf(today), 6)];
  if (k === 'month') return [today.slice(0, 8) + '01', addD(iso(new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1))), -1)];
  if (k === 'year') return [today.slice(0, 5) + '01-01', today.slice(0, 5) + '12-31'];
  return ['', ''];
}

export function Tracker() {
  const st = useStore();
  const [from, to] = period(st.trRange, st.today);
  const all = trackedApps(st);
  const within = (d: string | null | undefined) => !!d && d >= from && d <= to;
  // In the period: applied then, or a meeting with the company falls in it.
  const apps = all.filter((a) => {
    if (st.acctFilter !== 'all' && a.acct !== st.acctFilter) return false;
    return !from || within(appliedDay(a.applied, st.today)) || (a.meetings || []).some(within);
  });
  const stages = st.trStage === 'all' ? STAGES : STAGES.filter((s) => s.k === st.trStage);
  const shown = st.trStage === 'all' ? apps.length : apps.filter((a) => a.stage === st.trStage).length;
  const filtered = st.acctFilter !== 'all' || !!st.trRange || st.trStage !== 'all';
  const nAi = apps.filter((x) => x.ai && !x.locked).length;
  const app = all.find((x) => x.id === st.appSel);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative' }}>
      <div className="scroll" style={{ flex: 'none', paddingBottom: 10, overflow: 'visible' }}>
        <div className="ph" style={{ marginBottom: 0 }}>
          <div>
            <h1>Application tracker</h1>
            <p>
              {filtered ? shown + ' of ' + all.length + ' applications' : all.length + ' applications tracked across ' + st.accts.length + ' account' + (st.accts.length === 1 ? '' : 's')} · drag cards between columns; your manual moves are never overwritten by AI suggestions.
            </p>
          </div>
          <div className="ln wrap trf">
            <Seg value={st.trRange} options={RANGES} onChange={(k) => st.patch({ trRange: st.trRange === k ? '' : k })} ariaLabel="Applied in" />
            <select className="sel" value={st.acctFilter} onChange={(e) => st.patch({ acctFilter: e.target.value })} aria-label="Account">
              <option value="all">All accounts</option>
              {st.accts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <select className="sel" value={st.trStage} onChange={(e) => st.patch({ trStage: e.target.value as StageKey | 'all' })} aria-label="Status">
              <option value="all">All statuses</option>
              {STAGES.map((s) => (
                <option key={s.k} value={s.k}>
                  {s.l}
                </option>
              ))}
            </select>
            {filtered && (
              <button type="button" className="btn sm" onClick={() => st.patch({ acctFilter: 'all', trRange: '', trStage: 'all' })}>
                Clear
              </button>
            )}
            {nAi > 0 && <span className="tag">{nAi} AI suggestion{nAi === 1 ? '' : 's'}</span>}
          </div>
        </div>
      </div>

      <div className="kan">
        {stages.map((s) => {
          const cards = apps.filter((a) => a.stage === s.k);
          return (
            <section
              key={s.k}
              className={cx('kcol', st.overCol === s.k && 'over')}
              aria-label={s.l}
              onDragOver={(e) => {
                e.preventDefault();
                st.setOverCol(s.k);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) st.setOverCol('');
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = drag.app;
                drag.app = '';
                st.setOverCol('');
                if (id) st.moveApp(id, s.k, true);
              }}
            >
              <div className="kch">
                <span className="cdot" style={{ background: s.c }} />
                {s.l}
                <span className="cnt">{cards.length}</span>
              </div>
              <div className="kcl">
                {cards.map((a) => (
                  <Card key={a.id} a={a} />
                ))}
                {cards.length === 0 && (
                  <div className="mut" style={{ padding: '14px 8px', textAlign: 'center' }}>
                    {s.k === 'hired' ? 'No accepted offers yet' : 'Drop applications here'}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {app && <AppDrawer a={app} />}
    </div>
  );
}

function Card({ a }: { a: Application }) {
  const st = useStore();
  const ac = getAcct(st.accts, a.acct);
  return (
    <div
      className="kc"
      draggable
      onDragStart={(e) => {
        drag.app = a.id;
        e.currentTarget.classList.add('dragging');
        try {
          e.dataTransfer.setData('text/plain', a.id);
        } catch {
          /* ignore */
        }
      }}
      onDragEnd={(e) => {
        e.currentTarget.classList.remove('dragging');
        st.setOverCol('');
      }}
    >
      <button type="button" className="kcm" onClick={() => st.patch({ appSel: a.id })} aria-label={'Open ' + a.co + ' ' + a.role}>
        <span className="ln">
          <CoBadge name={a.co} size={26} radius={7} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontWeight: 650, display: 'block' }}>{a.co}</b>
            <span className="mini">{a.role}</span>
          </span>
          <AcDot color={ac.color} initial={ac.initial} size={16} title={ac.addr} />
        </span>
        <span className="ln wrap">
          <PriBadge p={a.pri} />
          <span className="mut">Applied {a.applied}</span>
          {a.locked && (
            <span className="tag" title="Moved by you">
              Manual
            </span>
          )}
        </span>
        {a.next && (
          <span className="nx">
            <b style={{ fontWeight: 600 }}>Next:</b> {a.next}
          </span>
        )}
        <span className="mini">{a.activity}</span>
        <span className="mini">
          <b style={{ fontWeight: 600 }}>To do:</b> {a.action}
        </span>
      </button>
      {a.ai && !a.locked && (
        <div className="ai">
          <span>
            <b style={{ fontWeight: 650 }}>AI suggests</b> {a.ai.text}
          </span>
          <span className="ln">
            <button type="button" className="btn sm pri" onClick={() => a.ai && st.moveApp(a.id, a.ai.stage, false)}>
              Accept
            </button>
            <button type="button" className="btn sm" onClick={() => st.dismissAi(a.id)}>
              Dismiss
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function AppDrawer({ a }: { a: Application }) {
  const st = useStore();
  const ac = getAcct(st.accts, a.acct);
  return (
    <aside className="drawer" aria-label="Application detail">
      <div className="mhd">
        <div className="ln">
          <CoBadge name={a.co} />
          <div>
            <h3>{a.co}</h3>
            <span className="mini">{a.role}</span>
          </div>
        </div>
        <button type="button" className="ib" onClick={() => st.patch({ appSel: '' })} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="db">
        <div className="fgrid" style={{ margin: 0 }}>
          <div>
            <span>Status</span>
            <select className="sel" style={{ width: '100%' }} value={a.stage} onChange={(e) => st.moveApp(a.id, e.target.value as StageKey, true)} aria-label="Update status">
              {STAGES.map((s) => (
                <option key={s.k} value={s.k}>
                  {s.l}
                </option>
              ))}
            </select>
          </div>
          <Fact label="Applied">{a.applied}</Fact>
          <Fact label="Account">{ac.addr}</Fact>
          <Fact label="Priority">
            <PriBadge p={a.pri} />
          </Fact>
          <Fact label="Next interview">{a.next || 'None scheduled'}</Fact>
          <Fact label="Required action">{a.action}</Fact>
        </div>
        <div>
          <span className="fl">Timeline</span>
          <div className="tl" style={{ padding: 0 }}>
            {a.timeline.map((t, i) => (
              <div className="tli" key={i}>
                <span className={cx('cdot', t.cls)} />
                <div>
                  <p>{t.text}</p>
                  <span className="mut">
                    {t.when} · {t.src}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="fl" htmlFor="app-notes">
            Notes
          </label>
          <textarea id="app-notes" className="inp" value={a.notes} onChange={(e) => st.setAppNotes(a.id, e.target.value)} placeholder="Interview prep, contacts, salary range…" />
        </div>
        <div className="ln wrap">
          <button type="button" className="btn sm" onClick={() => st.toggleAppRemind(a.id)} aria-pressed={!!a.remind}>
            <Icon name="bell" sm />
            {a.remind ? 'Reminder set' : 'Set reminder'}
          </button>
          {a.emailId && (
            <button type="button" className="btn sm" onClick={() => st.openEmail(a.emailId)}>
              <Icon name="mail" sm />
              Open related email
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
