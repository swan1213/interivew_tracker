import { useStore, type AppState } from '@/store/store';
import { actionCount, eventAccount, getAcct, trackedApps, visibleAll } from '@/store/selectors';
import { provider } from '@/data/provider';
import { DFULL, MN, PRI_RANK, STAGES, STG, type IconName } from '@/data/constants';
import type { CalEvent, Email } from '@/data/types';
import { effCat, inView, needsAction } from '@/lib/mail';
import { currentMember } from '@/lib/roles';
import { activeEvents, busyAt, isInterviewMeeting, meetingMentions } from '@/lib/calendar';
import { dObj, fmtT, lab, minutesLabel, rel, tzOffset } from '@/lib/time';
import { cx, firstName, truncate } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { CatChip, CoBadge, Empty, PriBadge, RowBar, stripe, Whose } from '@/ui/bits';

interface Kpi { label: string; icon: IconName; n: number; hot?: boolean; go: () => void }

/** Mail that counts toward the job-search numbers (not your own sent mail, automated or unrelated mail). */
const isRecruitment = (e: Email): boolean => !['auto', 'other', 'sent'].includes(effCat(e));

const PERSONAL_MAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail)\./i;

/** A calendar meeting with the same company as an email: named in it, or someone from the sender's own domain on it. */
function sameParty(e: Email, v: CalEvent): boolean {
  if (e.company && meetingMentions(v, e.company)) return true;
  const dom = (e.fromAddr.split('@')[1] || '').toLowerCase();
  if (!dom || PERSONAL_MAIL.test(dom)) return false;
  return [v.organizer || '', ...(v.attendees || [])].some((p) => p.toLowerCase().endsWith('@' + dom));
}

/** One row of Upcoming interviews: a scheduled event, or an interview confirmed by email whose time wasn't stated. */
export interface UpcomingItem { id: string; ev?: CalEvent; email?: Email }

export function upcomingInterviews(events: CalEvent[], all: Email[], today: string, own: string[] = []): UpcomingItem[] {
  const active = activeEvents(events);
  // Interviews on the calendar, by the same rule as the Calendar and the Tracker.
  const onCal = active.filter((v) => v.date >= today && isInterviewMeeting(v, own));
  const byId = new Map(all.map((e) => [e.id, e]));
  // An interview from an email that isn't on the calendar. The calendar wins when it already has a meeting at
  // that time, or one with that sender's company that day (the email's time may since have moved or been canceled).
  const fromMail = events.filter((v) => {
    if (v.added || v.kind !== 'interview' || !v.emailId || v.date < today) return false;
    const e = byId.get(v.emailId);
    return !onCal.some((c) => c.date === v.date && ((c.start < v.end && v.start < c.end) || (!!e && sameParty(e, c))));
  });
  const evs = [...onCal, ...fromMail].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const withEvent = new Set(evs.map((v) => v.emailId).filter(Boolean));
  // Confirmed by email this past week with no time stated: still to act on, and not a company with a meeting on the calendar (once each).
  const seen = new Set<string>();
  const untimed = all.filter((e) => {
    if (effCat(e) !== 'confirmed' || !needsAction(e) || e.ago > 7 * 1440 || e.evId || e.evRemoved || withEvent.has(e.id)) return false;
    const co = (e.company || e.fromAddr).toLowerCase();
    if (seen.has(co) || active.some((v) => sameParty(e, v))) return false;
    seen.add(co);
    return true;
  });
  return [...evs.map((ev) => ({ id: ev.id, ev })), ...untimed.map((email) => ({ id: 'mail-' + email.id, email }))];
}

/** Today's events in time order: interviews on the calendar and your other commitments. */
export const todaysEvents = (events: CalEvent[], today: string): CalEvent[] => activeEvents(events).filter((v) => v.date === today).sort((a, b) => a.start - b.start);

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
    ? 'Your next scheduled event is today at ' + fmtT(nxt.start + off) + ' ' + tz + ': ' + nxt.co + (nxt.kind === 'interview' ? ' ' + nxt.role.toLowerCase() : '') + '. '
    : 'Nothing else is scheduled today. ';

  // Interviews confirmed by email but not yet on the calendar (once per company).
  const told = new Set<string>();
  const once = (co: string) => !told.has(co) && !!told.add(co);
  st.events
    .filter((v) => v.kind === 'interview' && !v.added && v.emailId && v.date >= st.today && !active.some((c) => c.date === v.date && c.start < v.end && v.start < c.end))
    .filter((v) => {
      const e = all.find((x) => x.id === v.emailId);
      return e && needsAction(e) && once('cal:' + v.co);
    })
    .forEach((v) => {
      brief += v.co + ' confirmed a ' + v.role.split(',')[0].toLowerCase() + ' ' + rel(v.date, st.today).toLowerCase() + ' at ' + fmtT(v.start + off) + ' ' + tz + ", but it isn't on your calendar yet. ";
    });

  // Open reschedule requests (once per company), with any option that collides with an existing commitment.
  all
    .filter((e) => e.mode === 'resched' && needsAction(e) && e.opts && e.opts.length && once('resched:' + (e.company || e.fromAddr)))
    .forEach((e) => {
      const ev = e.evId ? st.events.find((v) => v.id === e.evId) : undefined;
      const origDay = ev ? DFULL[dObj(ev.date).getUTCDay()] : 'the interview';
      const clash = (e.opts || []).map(([d, h]) => busyAt(active, d, h, h + 1, e.evId)).find(Boolean);
      const clashName = clash ? (clash.kind === 'interview' ? clash.co + ' interview' : clash.co.toLowerCase()) : '';
      brief += (e.company || e.fromName) + ' asked to reschedule ' + origDay + (clash ? '; one of their proposed times conflicts with your ' + clashName + '.' : '; pick one of their proposed times.') + ' ';
    });
  return brief.trim();
}

export function Dashboard() {
  const st = useStore();
  const all = visibleAll(st.emails, st.accts);
  const off = tzOffset(st.S.tz);
  const actionN = actionCount(all);
  const unreadRec = all.filter((e) => e.unread && isRecruitment(e)).length;
  // The same rule as the Availability Requests view, so the number matches the list it opens.
  const waiting = all.filter((e) => inView(e, 'avail') && needsAction(e)).length;
  const offers = all.filter((e) => effCat(e) === 'offer').length;
  const priority = all
    .filter(needsAction)
    .sort((a, b) => PRI_RANK[a.pri] - PRI_RANK[b.pri] || a.ago - b.ago)
    .slice(0, 5);

  // With several mailboxes, every row says whose it is.
  const many = st.accts.length > 1;
  const mailAcct = (e: Email) => (many ? getAcct(st.accts, e.acct) : undefined);
  const evAcct = (v: CalEvent) => (many ? eventAccount(st.accts, all, v) : undefined);

  const todayEvs = todaysEvents(st.events, st.today);
  const upcoming = upcomingInterviews(st.events, all, st.today, st.accts.map((a) => a.addr));
  const briefing = buildBriefing(st, all, actionN, unreadRec, waiting, todayEvs);

  const d = dObj(st.today);
  // Greet in the viewer's own time; event times stay in ET.
  const localHour = provider.isDemo ? st.nowHour : new Date().getHours();
  const greeting = localHour < 12 ? 'Good morning' : localHour < 17 ? 'Good afternoon' : 'Good evening';
  const me = currentMember(st)?.name || st.S.name;
  const myName = firstName(me.includes('@') ? me.split('@')[0] : me);

  const kpis: Kpi[] = [
    { label: 'Connected accounts', icon: 'plug', n: st.accts.length, go: () => st.go('accounts') },
    { label: 'Total applications', icon: 'kanban', n: st.apps.length, go: () => st.go('track') },
    { label: 'Unread recruitment emails', icon: 'mail', n: unreadRec, go: () => st.go('inbox', { view: 'inbox', unreadOnly: true, readOnly: false, savedKey: '' }) },
    { label: 'Action required', icon: 'bolt', n: actionN, hot: true, go: () => st.openView('action') },
    { label: 'Upcoming interviews', icon: 'video', n: upcoming.length, go: () => st.go('cal', { calView: 'agenda', calDate: st.today }) },
    { label: 'Availability requests', icon: 'clock', n: waiting, hot: true, go: () => st.openView('avail') },
    { label: 'Offers received', icon: 'award', n: offers, go: () => st.openView('offers') },
  ];

  const tracked = trackedApps(st);
  const maxN = Math.max(1, ...STAGES.map((s) => tracked.filter((a) => a.stage === s.k).length));

  return (
    <div className="scroll">
      <div className="ph">
        <div>
          <h1>
            {greeting}, {myName}
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
          <p>{st.loading ? 'Loading your workspace…' : 'No email account is connected yet. Connect your Gmail and InterviewFlow will sync the last 60 days of sent and received mail and sort it into the views on the left.'}</p>
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
              const a = mailAcct(e);
              return (
                <button key={e.id} type="button" className="pr" onClick={() => st.openEmail(e.id)} style={stripe(a)}>
                  <CoBadge name={who} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="t">
                      {who}: {truncate(e.subject, 52)}
                    </span>
                    <div className="a">Action: {e.action}</div>
                    <Whose a={a} accts={st.accts} />
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
                const n = tracked.filter((a) => a.stage === s.k).length;
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
            {todayEvs.map((v) => {
              const a = evAcct(v);
              return (
                <button key={v.id} type="button" className="sched" onClick={() => st.go('cal', { calView: 'day', calDate: v.date, calSel: v.id })} style={stripe(a)}>
                  <span className="tm">
                    {fmtT(v.start + off)}
                    <small>{minutesLabel(v)}</small>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600 }}>{v.kind === 'interview' ? v.co + ': ' + v.role : v.co}</b>
                    <div className="mini">
                      {(v.kind === 'interview' ? [v.platform, v.link, v.interviewer && 'with ' + v.interviewer] : [v.platform, v.location]).filter(Boolean).join(' · ')}
                    </div>
                    <Whose a={a} accts={st.accts} />
                  </span>
                  <span className={cx('chip', STG[v.stage].cls)}>{STG[v.stage].label}</span>
                </button>
              );
            })}
            {todayEvs.length === 0 && <Empty title="Nothing scheduled today" style={{ padding: 24 }} />}
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
            {upcoming.map(({ id, ev: v, email }) => {
              if (!v) {
                const e = email!;
                const a = mailAcct(e);
                return (
                  <button key={id} type="button" className="sched" onClick={() => st.openEmail(e.id)} style={stripe(a)}>
                    <span className="tm">
                      Time
                      <small>not stated</small>
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontWeight: 600 }}>
                        {e.company || e.fromName}: {e.role || e.stage || 'Interview'}
                      </b>
                      <div className="mini" style={{ color: 'var(--warn)', fontWeight: 600 }}>
                        Confirmed by email; open it to see when and add it to your calendar
                      </div>
                      <Whose a={a} accts={st.accts} />
                    </span>
                    <CatChip cat="confirmed" />
                  </button>
                );
              }
              const em = v.emailId ? all.find((e) => e.id === v.emailId) : undefined;
              const resched = !!em && em.mode === 'resched' && needsAction(em);
              const warn = (v.kind === 'interview' && !v.added) || resched;
              const a = evAcct(v);
              return (
                <button
                  key={v.id}
                  type="button"
                  className="sched"
                  style={stripe(a)}
                  onClick={() => (v.added ? st.go('cal', { calView: 'week', calDate: v.date, calSel: v.id }) : st.openEmail(v.emailId || ''))}
                >
                  <span className="tm">
                    {rel(v.date, st.today).replace(/, .*/, '')}
                    <small>{fmtT(v.start + off)}</small>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600 }}>{v.kind === 'interview' ? v.co + ': ' + v.role : v.co}</b>
                    <div className="mini">{(v.kind === 'interview' ? [v.platform, v.interviewer] : [v.platform, v.location]).filter(Boolean).join(' · ')}</div>
                    {warn && (
                      <div className="mini" style={{ color: 'var(--warn)', fontWeight: 600 }}>
                        {!v.added ? 'Confirmed by email but not on your calendar yet' : 'Reschedule requested. Original time held.'}
                      </div>
                    )}
                    <Whose a={a} accts={st.accts} />
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
