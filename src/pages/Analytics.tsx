import { useStore } from '@/store/store';
import { getAcct } from '@/store/selectors';
import { provider } from '@/data/provider';
import { STAGES } from '@/data/constants';
import type { CalEvent } from '@/data/types';
import { effCat } from '@/lib/mail';
import { looksLikeInterview } from '@/lib/calendar';
import { BUCKETS, byCompany, funnel, isRecruitment, pct, toRec, weekly, type Rec } from '@/lib/analytics';
import { daysBetween } from '@/lib/time';
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
  // Interviews on the calendar in the range (before or after today) not already counted as a "confirmed" email:
  // ones you added, and Google Calendar events titled like an interview.
  const evRows = st.events
    .filter((v) => v.added && Math.abs(daysBetween(st.today, v.date)) <= days && (v.kind === 'interview' || looksLikeInterview(v.co)))
    .filter((v) => {
      const em = v.emailId ? st.emails.find((e) => e.id === v.emailId) : undefined;
      return !(em && effCat(em) === 'confirmed');
    });

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
      sched: conf + evRows.filter((v) => evAcct(v) === a.id).length,
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

  const apps = st.apps.filter((a) => inAcct(a.acct));
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
  const tiles = [
    { label: 'Applications', n: String(f.applications), tip: 'Companies you have recruitment mail with in this range' },
    { label: 'Reached an interview', n: String(f.interviewed), tip: 'Companies that invited you, asked for your availability or confirmed an interview' },
    { label: 'Interview conversion', n: pct(f.interviewed, f.applications, 1), tip: f.interviewed + ' of ' + f.applications + ' companies reached an interview' },
    { label: 'Response rate', n: pct(f.responded, f.applications), tip: f.responded + ' of ' + f.applications + ' companies wrote back beyond an application receipt' },
    { label: 'Rejection rate', n: pct(f.rejected, f.applications), tip: f.rejected + ' of ' + f.applications + ' companies sent a rejection' },
    { label: 'Offers received', n: String(f.offers), tip: 'Companies that sent an offer' },
  ];

  const weeks = weekly(recs, st.today);
  const mxW = Math.max(1, ...weeks.map((w) => w.emails));
  const companies = byCompany(inRange);
  const mxC = Math.max(1, ...companies.map(([, n]) => n));
  const mxA = Math.max(1, ...accRows.map((r) => r.recruiting));

  const Num = ({ v, bold }: { v: number; bold?: boolean }) => <span className="num">{bold ? <b>{v}</b> : v}</span>;
  const rowCells = (r: Pick<Row, NumKey>) => (
    <>
      <Num v={r.n} />
      <Num v={r.act} />
      <Num v={r.inv} />
      <Num v={r.conf} />
      <Num v={r.app} />
      <Num v={r.rej} />
      <Num v={r.off} />
      <Num v={r.sched} bold />
    </>
  );
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
        <div className="cb" style={{ overflowX: 'auto' }}>
          <div className="mut" style={{ marginBottom: 8 }}>
            {scope}. Action needed counts emails still waiting on you, whatever their category.
          </div>
          <div className="gr hd">
            <span>Account</span>
            <span className="num">Emails</span>
            <span className="num">Action needed</span>
            <span className="num">Invites &amp; availability</span>
            <span className="num">Interview confirmed</span>
            <span className="num">Applications &amp; updates</span>
            <span className="num">Rejected</span>
            <span className="num">Offers</span>
            <span className="num">Interviews scheduled</span>
          </div>
          {accRows.map((r) => (
            <div className="gr" key={r.id}>
              <span className="ln">
                <AcDot color={r.color} initial={r.initial} />
                <span style={{ minWidth: 0 }}>
                  <b style={{ fontWeight: 600, display: 'block' }}>{r.label}</b>
                  <span className="mut">{r.addr}</span>
                </span>
              </span>
              {rowCells(r)}
            </div>
          ))}
          <div className="gr tot">
            <span>{st.anAcct === 'all' ? 'All accounts' : 'Selected account'}</span>
            {rowCells(totals)}
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
              Counts confirmed-interview emails plus interviews on your calendar not already covered by one.
            </div>
          </div>
        </section>
      </div>

      <div className="kpis">
        {tiles.map((k) => (
          <div className="kpi" key={k.label} title={k.tip}>
            <span className="l">{k.label}</span>
            <span className="n">{k.n}</span>
          </div>
        ))}
      </div>
      <div className="mut" style={{ margin: '-6px 0 14px' }}>
        Per company, {rangeLabel.toLowerCase()}: each company you have recruitment mail with counts as one application.
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
