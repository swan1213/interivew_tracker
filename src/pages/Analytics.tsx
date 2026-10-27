import { useStore } from '@/store/store';
import { getAcct, trackedApps } from '@/store/selectors';
import { provider } from '@/data/provider';
import { STAGES } from '@/data/constants';
import type { CalEvent } from '@/data/types';
import { isInterviewMeeting, meetingMentions } from '@/lib/calendar';
import { BUCKETS, byCompany, funnel, isRecruitment, pct, toRec, weekly, type Rec } from '@/lib/analytics';
import { daysBetween } from '@/lib/time';
import { cx } from '@/lib/util';
import { AcDot, Empty, RowBar } from '@/ui/bits';

export function Analytics() {
  const st = useStore();
  const days = st.anRange === 'all' ? 99999 : parseInt(st.anRange, 10);
  const inAcct = (id: string) => st.anAcct === 'all' || id === st.anAcct;
  const connected = st.accts.filter((a) => inAcct(a.id));
  const recs: Rec[] = st.emails.filter((e) => connected.some((a) => a.id === e.acct)).map(toRec);
  const inRange = recs.filter((r) => r.d <= days);

  const evAcct = (v: CalEvent) => {
    if (v.acct) return v.acct;
    const em = v.emailId ? st.emails.find((e) => e.id === v.emailId) : undefined;
    if (em) return em.acct;
    return st.apps.find((a) => a.co === v.co)?.acct || '';
  };
  // Interview meetings on the calendar in the range, before or after today: ones you added, and
  // calendar meetings with someone else. A "confirmed" email adds one only when no meeting covers it.
  const own = st.accts.map((a) => a.addr);
  const evRows = st.events.filter((v) => v.added && Math.abs(daysBetween(st.today, v.date)) <= days && isInterviewMeeting(v, own));
  const covered = (r: Rec) => evRows.some((v) => v.emailId === r.id || meetingMentions(v, r.company));

  const accRows = connected.map((a) => {
    const rs = inRange.filter((r) => r.acct === a.id);
    const c = (f: (r: Rec) => boolean) => rs.filter(f).length;
    const conf = c((r) => r.cat === 'confirmed');
    return {
      id: a.id, label: a.label, addr: a.addr, color: a.color, initial: a.initial,
      n: rs.length,
      act: c((r) => r.needs),
      inv: c((r) => r.cat === 'avail' || r.cat === 'invite'),
      conf,
      app: c((r) => r.cat === 'applied' || r.cat === 'status'),
      rej: c((r) => r.cat === 'rejected'),
      off: c((r) => r.cat === 'offer'),
      sched: evRows.filter((v) => evAcct(v) === a.id).length + c((r) => r.cat === 'confirmed' && !covered(r)),
      recruiting: c((r) => isRecruitment(r.cat)),
    };
  });
  type Row = (typeof accRows)[number];
  type NumKey = 'n' | 'act' | 'inv' | 'conf' | 'app' | 'rej' | 'off' | 'sched';
  const sum = (k: NumKey | 'recruiting') => accRows.reduce((s, r) => s + r[k], 0);
  const mxS = Math.max(1, ...accRows.map((r) => r.sched));
  const mix = BUCKETS.map((b) => ({ ...b, n: inRange.filter((r) => b.cats.includes(r.cat)).length }));
  const tN = inRange.length || 1;
  const rangeLabel = st.anRange === 'all' ? 'All time' : 'Last ' + st.anRange + ' days';

  const apps = trackedApps(st).filter((a) => inAcct(a.acct));
  const counts = STAGES.map((s) => ({ label: s.l, color: s.c, n: apps.filter((a) => a.stage === s.k).length }));
  const total = counts.reduce((s, c) => s + c.n, 0) || 1;
  let acc = 0;
  const donut =
    'conic-gradient(' +
    (counts
      .filter((c) => c.n)
      .map((c) => {
        const a0 = (acc / total) * 360;
        acc += c.n;
        return c.color + ' ' + a0 + 'deg ' + (acc / total) * 360 + 'deg';
      })
      .join(',') || 'var(--bd) 0deg 360deg') +
    ')';

  const f = funnel(inRange);
  // Tiles count companies (two offer emails from one company are one offer); the table above counts emails.
  // Each tile shows both so the numbers can be matched up.
  const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
  const cos = (n: number) => (n === 1 ? 'company' : 'companies');
  const mailN = (cats: string[]) => inRange.filter((r) => cats.includes(r.cat)).length;
  const ofCos = (n: number) => n + ' of ' + plural(f.applications, 'company', 'companies');
  const tiles = [
    { label: 'Applications', n: String(f.applications), sub: cos(f.applications) + ' · ' + plural(inRange.filter((r) => isRecruitment(r.cat)).length, 'email'), tip: 'Companies you have recruitment mail with in this range' },
    { label: 'Reached an interview', n: String(f.interviewed), sub: cos(f.interviewed) + ' · ' + plural(mailN(['invite', 'avail', 'confirmed', 'offer']), 'email'), tip: 'Companies that invited you, asked for your availability or confirmed an interview' },
    { label: 'Interview conversion', n: pct(f.interviewed, f.applications, 1), sub: ofCos(f.interviewed), tip: f.interviewed + ' of ' + f.applications + ' companies reached an interview' },
    { label: 'Response rate', n: pct(f.responded, f.applications), sub: ofCos(f.responded), tip: f.responded + ' of ' + f.applications + ' companies wrote back beyond an application receipt' },
    { label: 'Rejection rate', n: pct(f.rejected, f.applications), sub: ofCos(f.rejected), tip: f.rejected + ' of ' + f.applications + ' companies sent a rejection' },
    { label: 'Offers received', n: String(f.offers), sub: cos(f.offers) + ' · ' + plural(mailN(['offer']), 'email'), tip: 'Companies that sent an offer; several emails from one company count once' },
  ];

  const weeks = weekly(recs, st.today);
  const mxW = Math.max(1, ...weeks.map((w) => w.emails));
  const companies = byCompany(inRange);
  const mxC = Math.max(1, ...companies.map(([, n]) => n));
  const mxA = Math.max(1, ...accRows.map((r) => r.recruiting));

  const COLS: { k: NumKey; l: string; color?: string }[] = [
    { k: 'n', l: 'Emails' },
    { k: 'act', l: 'Action needed', color: BUCKETS[0].color },
    { k: 'inv', l: 'Invites & availability', color: BUCKETS[1].color },
    { k: 'conf', l: 'Interview confirmed', color: BUCKETS[2].color },
    { k: 'app', l: 'Applications & updates', color: BUCKETS[3].color },
    { k: 'rej', l: 'Rejected', color: BUCKETS[4].color },
    { k: 'off', l: 'Offers', color: BUCKETS[5].color },
    { k: 'sched', l: 'Interviews scheduled' },
  ];
  const rowCells = (r: Pick<Row, NumKey>) =>
    COLS.map((col) => (
      <td key={col.k} className={cx('num', r[col.k] === 0 && 'zero', col.k === 'sched' && 'key')}>
        {r[col.k]}
      </td>
    ));
  const totals = { n: sum('n'), act: sum('act'), inv: sum('inv'), conf: sum('conf'), app: sum('app'), rej: sum('rej'), off: sum('off'), sched: sum('sched') };
  const scope = rangeLabel + ' · ' + (st.anAcct === 'all' ? 'every connected account' : getAcct(st.accts, st.anAcct).addr);

  return (
    <div className="scroll">
      <div className="ph">
        <div>
          <h1>Analytics</h1>
          <p>{provider.isDemo ? 'Computed from the fictional demo inbox.' : 'Computed from your synced mail and calendar.'}</p>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 14 }} aria-label="Email status by account">
        <div className="ch">
          <h2>Email status by account</h2>
          <div className="ln wrap">
            <select className="sel" value={st.anRange} onChange={(e) => st.patch({ anRange: e.target.value })} aria-label="Date range">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="all">All time</option>
            </select>
            <select className="sel" value={st.anAcct} onChange={(e) => st.patch({ anAcct: e.target.value })} aria-label="Account">
              <option value="all">All accounts</option>
              {st.accts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="cb">
          <div className="mut" style={{ marginBottom: 8 }}>
            {scope}. Every count here is emails; the tiles further down count companies. Action needed counts emails still waiting on you, whatever their category.
          </div>
          <div className="atw">
            <table className="atab">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  {COLS.map((col) => (
                    <th scope="col" key={col.k} className={cx('num', col.k === 'sched' && 'key')}>
                      <span className="th">
                        {col.color && <span className="cdot" style={{ background: col.color }} />}
                        {col.l}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accRows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      <span className="ln">
                        <AcDot color={r.color} initial={r.initial} size={26} />
                        <span style={{ minWidth: 0 }}>
                          <b>{r.label}</b>
                          <span className="mut">{r.addr}</span>
                        </span>
                      </span>
                    </th>
                    {rowCells(r)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{st.anAcct === 'all' ? 'All accounts' : 'Selected account'}</th>
                  {rowCells(totals)}
                </tr>
              </tfoot>
            </table>
          </div>
          {totals.n === 0 && <Empty title="No emails in this range" text="Try a longer date range." style={{ padding: 20 }} />}
        </div>
      </section>

      <div className="dgrid" style={{ marginBottom: 14 }}>
        <section className="card">
          <div className="ch">
            <h2>Status mix</h2>
            <span className="hint">{rangeLabel}</span>
          </div>
          <div className="cb">
            {mix.map((b) => (
              <RowBar key={b.k} name={b.l} n={b.n} pct={Math.round((b.n / tN) * 100)} color={b.color} title={b.n + ' of ' + inRange.length + ' emails'} />
            ))}
          </div>
        </section>
        <section className="card">
          <div className="ch">
            <h2>Interviews scheduled per account</h2>
            <span className="hint">{rangeLabel}</span>
          </div>
          <div className="cb">
            {accRows.map((r) => (
              <RowBar
                key={r.id}
                name={r.label}
                n={r.sched}
                pct={Math.round((r.sched / mxS) * 100)}
                color={r.color}
                nameWidth={120}
                title={r.sched + ' interviews scheduled'}
                lead={<AcDot color={r.color} initial={r.initial} size={18} />}
              />
            ))}
            <div className="mut" style={{ marginTop: 8 }}>
              Counts meetings on your calendar with recruiters and interviewers (before and after today), plus confirmed-interview emails that have no meeting on the calendar yet.
            </div>
          </div>
        </section>
      </div>

      <div className="kpis">
        {tiles.map((k) => (
          <div className="kpi" key={k.label} title={k.tip}>
            <span className="l">{k.label}</span>
            <span className="n">{k.n}</span>
            <span className="s">{k.sub}</span>
          </div>
        ))}
      </div>
      <div className="mut" style={{ margin: '-6px 0 14px' }}>
        Per company, {rangeLabel.toLowerCase()}: each company you have recruitment mail with counts as one application, and several emails from one company count once.
      </div>

      <div className="dgrid">
        <section className="card">
          <div className="ch">
            <h2>Weekly recruitment activity</h2>
            <span className="hint">Last 8 weeks</span>
          </div>
          <div className="cb">
            <div className="lg">
              <span>
                <span className="cdot" style={{ background: 'var(--ac)' }} />
                Recruitment emails
              </span>
              <span>
                <span className="cdot" style={{ background: 'var(--ok)' }} />
                Interview invites
              </span>
            </div>
            <div className="cols">
              {weeks.map((w) => (
                <div className="colg" key={w.label} title={'Week of ' + w.label + ': ' + w.emails + ' recruitment emails, ' + w.invites + ' interview invites'}>
                  <div className="pair">
                    <i style={{ height: Math.round((w.emails / mxW) * 100) + '%', background: 'var(--ac)' }} />
                    <i style={{ height: Math.round((w.invites / mxW) * 100) + '%', background: 'var(--ok)' }} />
                  </div>
                  <span>{w.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="card">
          <div className="ch">
            <h2>Applications by status</h2>
            <span className="hint">{apps.length} in the tracker</span>
          </div>
          <div className="cb" style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="donut" style={{ background: donut }} role="img" aria-label="Applications by status donut" />
            <div style={{ flex: 1, minWidth: 180 }}>
              {counts.map((s) => (
                <div className="rowbar" style={{ padding: '2px 0' }} key={s.label}>
                  <span className="cdot" style={{ background: s.color }} />
                  <span className="nm" style={{ width: 'auto', flex: 1 }}>
                    {s.label}
                  </span>
                  <span className="v">{s.n}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="card">
          <div className="ch">
            <h2>Recruitment mail by company</h2>
            <span className="hint">{rangeLabel}</span>
          </div>
          <div className="cb">
            {companies.map(([name, n]) => (
              <RowBar key={name} name={name} n={n} pct={Math.round((n / mxC) * 100)} title={n + ' recruitment emails'} />
            ))}
            {companies.length === 0 && <Empty title="No recruitment mail in this range" style={{ padding: 20 }} />}
          </div>
        </section>
        <section className="card">
          <div className="ch">
            <h2>Recruitment mail by account</h2>
            <span className="hint">{rangeLabel}</span>
          </div>
          <div className="cb">
            {accRows.map((r) => (
              <RowBar key={r.id} name={r.label} n={r.recruiting} pct={Math.round((r.recruiting / mxA) * 100)} color={r.color} nameWidth={120} title={r.recruiting + ' recruitment emails'} lead={<AcDot color={r.color} initial={r.initial} size={18} />} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
