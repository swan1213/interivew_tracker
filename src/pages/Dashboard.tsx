import { useStore, type AppState } from '@/store/store';
import { actionCount, visibleAll } from '@/store/selectors';
import { provider } from '@/data/provider';
import { DFULL, MN, PRI_RANK, STAGES, STG, type IconName } from '@/data/constants';
import type { CalEvent, Email } from '@/data/types';
import { effCat, needsAction } from '@/lib/mail';
import { activeEvents, busyAt } from '@/lib/calendar';
import { dObj, fmtT, lab, minutesLabel, rel, tzOffset } from '@/lib/time';
import { cx, firstName, truncate } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { CatChip, CoBadge, Empty, PriBadge, RowBar } from '@/ui/bits';

interface Kpi { label: string; icon: IconName; n: number; hot?: boolean; go: () => void }

/** One-paragraph daily briefing built only from facts in the workspace. */
export function buildBriefing(st: AppState, all: Email[], actionN: number, unreadRec: number, waiting: number, todayEvs: CalEvent[]): string {
  const off = tzOffset(st.S.tz);
  const tz = st.S.tz;
  const active = activeEvents(st.events);
  let brief =
    'You have ' + unreadRec + ' unread recruitment email' + (unreadRec === 1 ? '' : 's') + ' across ' + st.accts.length + ' connected account' + (st.accts.length === 1 ? '' : 's') + '. ' +
    actionN + ' need' + (actionN === 1 ? 's' : '') + ' your attention' +
    (waiting ? ', including ' + waiting + ' recruiter' + (waiting > 1 ? 's' : '') + ' waiting for your availability' : '') + '. ';
  const nxt = todayEvs.find((v) => v.start > st.nowHour);
  brief += nxt
    ? 'Your next scheduled event is today at ' + fmtT(nxt.start + off) + ' ' + tz + ': ' + nxt.co + ' ' + nxt.role.toLowerCase() + '. '
    : 'Nothing else is scheduled today. ';

  // Interviews confirmed by email but not yet on the calendar.
  st.events
    .filter((v) => v.kind === 'interview' && !v.added && v.emailId && v.date >= st.today)
    .filter((v) => {
      const e = all.find((x) => x.id === v.emailId);
      return e && needsAction(e);
    })
    .forEach((v) => {
      brief += v.co + ' confirmed a ' + v.role.split(',')[0].toLowerCase() + ' ' + rel(v.date, st.today).toLowerCase() + ' at ' + fmtT(v.start + off) + ' ' + tz + ", but it isn't on your calendar yet. ";
    });

  // Open reschedule requests, with any option that collides with an existing commitment.
  all
    .filter((e) => e.mode === 'resched' && needsAction(e) && e.opts && e.opts.length)
    .forEach((e) => {
      const ev = e.evId ? st.events.find((v) => v.id === e.evId) : undefined;
      const origDay = ev ? DFULL[dObj(ev.date).getUTCDay()] : 'the interview';
      const clash = (e.opts || []).map(([d, h]) => busyAt(active, d, h, h + 1, e.evId)).find(Boolean);
      const clashName = clash ? (clash.kind === 'interview' ? clash.co + ' interview' : clash.co.toLowerCase()) : '';
      brief += e.company + ' asked to reschedule ' + origDay + (clash ? '; one of their proposed times conflicts with your ' + clashName + '.' : '; pick one of their proposed times.') + ' ';
    });
  return brief.trim();
}

export function Dashboard() {
  const st = useStore();
  const all = visibleAll(st.emails, st.accts);
  const off = tzOffset(st.S.tz);
  const actionN = actionCount(all);
  const unreadRec = all.filter((e) => e.unread && effCat(e) !== 'auto').length;
  const waiting = all.filter((e) => (effCat(e) === 'avail' || e.sec === 'avail' || e.mode === 'avail') && needsAction(e)).length;
  const offers = all.filter((e) => effCat(e) === 'offer').length;
  const priority = all
    .filter(needsAction)
    .sort((a, b) => PRI_RANK[a.pri] - PRI_RANK[b.pri] || a.ago - b.ago)
    .slice(0, 5);

  const interviews = st.events.filter((v) => v.kind === 'interview');
  const todayEvs = interviews.filter((v) => v.added && v.date === st.today).sort((a, b) => a.start - b.start);
  const upcoming = interviews
    .filter((v) => v.date >= st.today && (v.added || v.emailId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const upcomingAdded = interviews.filter((v) => v.added && v.date >= st.today).length;
  const briefing = buildBriefing(st, all, actionN, unreadRec, waiting, todayEvs);

  const d = dObj(st.today);
  const greeting = st.nowHour < 12 ? 'Good morning' : st.nowHour < 17 ? 'Good afternoon' : 'Good evening';

  const kpis: Kpi[] = [
    { label: 'Connected accounts', icon: 'plug', n: st.accts.length, go: () => st.go('accounts') },
    { label: 'Total applications', icon: 'kanban', n: st.apps.length, go: () => st.go('track') },
    { label: 'Unread recruitment emails', icon: 'mail', n: unreadRec, go: () => st.go('inbox', { view: 'inbox', unreadOnly: true, savedKey: '' }) },
    { label: 'Action required', icon: 'bolt', n: actionN, hot: true, go: () => st.openView('action') },
    { label: 'Upcoming interviews', icon: 'video', n: upcomingAdded, go: () => st.go('cal', { calView: 'agenda', calDate: st.today }) },
    { label: 'Availability requests', icon: 'clock', n: waiting, hot: true, go: () => st.openView('avail') },
    { label: 'Offers received', icon: 'award', n: offers, go: () => st.openView('offers') },
  ];

  const maxN = Math.max(1, ...STAGES.map((s) => st.apps.filter((a) => a.stage === s.k).length));

  return (
    <div className="scroll">
      <div className="ph">
        <div>
          <h1>
            {greeting}, {firstName(st.S.name)}
          </h1>
          <p>
            {DFULL[d.getUTCDay()]}, {MN[d.getUTCMonth()]} {d.getUTCDate()} · {provider.isDemo ? 'demo workspace' : 'workspace'} · {st.accts.length} account{st.accts.length === 1 ? '' : 's'} synced
          </p>
        </div>
        <div className="ln wrap">
          <button type="button" className="btn" onClick={() => st.go('cal')}>
            <Icon name="cal" sm />
            Open calendar
          </button>
          <button type="button" className="btn pri" onClick={() => st.openView('action')}>
            <Icon name="bolt" sm />
            Triage action items
          </button>
        </div>
      </div>

      {!provider.isDemo && st.accts.length === 0 && (
        <section className="brief" aria-label="Get started" style={{ marginBottom: 14 }}>
          <span className="spark">
            <Icon name="plug" sm />
            Get started
          </span>
          <p>{st.loading ? 'Loading your workspace…' : 'No email account is connected yet. Connect your Gmail and InterviewFlow will sync the last 60 days of mail, keep what looks job-related, and sort it into the views on the left.'}</p>
          <div className="ln wrap">
            <button type="button" className="btn pri" onClick={() => st.patch({ addAcctOpen: true })}>
              <Icon name="plus" sm />
              Connect Gmail
            </button>
            <span className="tag">Tokens stay on the server</span>
            <span className="tag">Nothing is sent without your click</span>
          </div>
        </section>
      )}
      <div className="kpis">
        {kpis.map((k) => (
          <button key={k.label} type="button" className={cx('kpi', k.hot && k.n > 0 && 'hot')} onClick={k.go}>
            <span className="l">
              <Icon name={k.icon} sm />
              {k.label}
            </span>
            <span className="n">{k.n}</span>
          </button>
        ))}
      </div>

      <div className="dgrid">
        <div className="stack">
          <section className="brief" aria-label="AI daily briefing">
            <span className="spark">
              <Icon name="spark" sm />
              AI daily briefing
            </span>
            <p>{briefing}</p>
            <div className="ln wrap">
              <span className="tag">{provider.isDemo ? 'Generated from demo data' : 'Generated from your inbox and calendar'}</span>
              <span className="tag">Only stated facts are scheduled</span>
            </div>
          </section>

          <section className="card" aria-label="Priority inbox">
            <div className="ch">
              <h2>
                <Icon name="bolt" sm />
                Priority inbox
              </h2>
              <button type="button" className="btn ghost sm" onClick={() => st.openView('inbox')}>
                Open inbox
              </button>
            </div>
            {priority.map((e) => {
              const who = e.company || e.fromName;
              return (
                <button key={e.id} type="button" className="pr" onClick={() => st.openEmail(e.id)}>
                  <CoBadge name={who} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="t">
                      {who}: {truncate(e.subject, 52)}
                    </span>
                    <div className="a">Action: {e.action}</div>
                  </span>
                  <span className="m">
                    <CatChip cat={effCat(e)} />
                    <PriBadge p={e.pri} />
                  </span>
                </button>
              );
            })}
            {priority.length === 0 && <Empty title="Inbox zero on priorities" text="Nothing needs you right now." />}
          </section>

          <section className="card" aria-label="Application pipeline">
            <div className="ch">
              <h2>
                <Icon name="kanban" sm />
                Application pipeline
              </h2>
              <button type="button" className="btn ghost sm" onClick={() => st.go('track')}>
                Open tracker
              </button>
            </div>
            <div className="cb">
              {STAGES.map((s) => {
                const n = st.apps.filter((a) => a.stage === s.k).length;
                return <RowBar key={s.k} name={s.l} n={n} pct={Math.round((n / maxN) * 100)} color={s.c} title={s.l + ': ' + n + ' applications'} />;
              })}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-label="Today's schedule">
            <div className="ch">
              <h2>
                <Icon name="cal" sm />
                Today's schedule
              </h2>
              <span className="hint">
                {lab(st.today)} · {st.S.tz}
              </span>
            </div>
            {todayEvs.map((v) => (
              <button key={v.id} type="button" className="sched" onClick={() => st.go('cal', { calView: 'day', calDate: v.date, calSel: v.id })}>
                <span className="tm">
                  {fmtT(v.start + off)}
                  <small>{minutesLabel(v)}</small>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontWeight: 600 }}>
                    {v.co}: {v.role}
                  </b>
                  <div className="mini">
                    {v.platform} · {v.link} · with {v.interviewer}
                  </div>
                </span>
                <span className={cx('chip', STG[v.stage].cls)}>{STG[v.stage].label}</span>
              </button>
            ))}
            {todayEvs.length === 0 && <Empty title="No interviews today" style={{ padding: 24 }} />}
          </section>

          <section className="card" aria-label="Upcoming interviews">
            <div className="ch">
              <h2>
                <Icon name="video" sm />
                Upcoming interviews
              </h2>
              <button type="button" className="btn ghost sm" onClick={() => st.go('cal', { calView: 'agenda', calDate: st.today })}>
                Agenda
              </button>
            </div>
            {upcoming.map((v) => {
              const em = v.emailId ? all.find((e) => e.id === v.emailId) : undefined;
              const resched = !!em && em.mode === 'resched' && needsAction(em);
              const warn = !v.added || resched;
              return (
                <button
                  key={v.id}
                  type="button"
                  className="sched"
                  onClick={() => (v.added ? st.go('cal', { calView: 'week', calDate: v.date, calSel: v.id }) : st.openEmail(v.emailId || ''))}
                >
                  <span className="tm">
                    {rel(v.date, st.today).replace(/, .*/, '')}
                    <small>{fmtT(v.start + off)}</small>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600 }}>
                      {v.co}: {v.role}
                    </b>
                    <div className="mini">
                      {v.platform} · {v.interviewer}
                    </div>
                    {warn && (
                      <div className="mini" style={{ color: 'var(--warn)', fontWeight: 600 }}>
                        {!v.added ? 'Confirmed by email but not on your calendar yet' : 'Reschedule requested. Original time held.'}
                      </div>
                    )}
                  </span>
                  <span className={cx('chip', STG[v.stage].cls)}>{STG[v.stage].label}</span>
                </button>
              );
            })}
            {upcoming.length === 0 && <Empty title="No upcoming interviews" style={{ padding: 24 }} />}
          </section>

          <section className="card" aria-label="Recent activity">
            <div className="ch">
              <h2>
                <Icon name="clock" sm />
                Recent activity
              </h2>
            </div>
            <div className="tl">
              {st.activity.map((a, i) => (
                <div className="tli" key={i}>
                  <span className={cx('cdot', a.cls)} />
                  <div>
                    <p>{a.text}</p>
                    <span className="mut">{a.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
