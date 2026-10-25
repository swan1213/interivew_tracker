import { useStore } from '@/store/store';
import { getAcct, visibleAll } from '@/store/selectors';
import { provider } from '@/data/provider';
import { STAGES } from '@/data/constants';
import type { Cat } from '@/data/types';
import { effCat, needsAction } from '@/lib/mail';
import { daysBetween } from '@/lib/time';
import { AcDot, Empty, RowBar } from '@/ui/bits';

interface Rec { acct: string; cat: Cat; d: number; needs: boolean }

/**
 * Fictional eight-week history mixed with the live inbox so the tables have
 * enough volume to read. A real provider replaces this with stored mail.
 */
function demoHistory(acctIds: string[]): Rec[] {
  const cyc: Cat[] = [
    ...Array<Cat>(8).fill('applied'), ...Array<Cat>(5).fill('status'), ...Array<Cat>(4).fill('rejected'),
    ...Array<Cat>(2).fill('action'), ...Array<Cat>(2).fill('avail'), ...Array<Cat>(2).fill('invite'),
    ...Array<Cat>(3).fill('confirmed'), 'auto', 'offer',
  ];
  const out: Rec[] = [];
  for (let i = 0; i < 150 && acctIds.length; i++) {
    out.push({ acct: acctIds[(i * 7 + Math.floor(i / 3)) % acctIds.length], cat: cyc[(i * 5 + Math.floor(i / 4)) % cyc.length], d: 4 + ((i * 37) % 570) / 10, needs: false });
  }
  return out;
}

const WEEKS: [string, number, number][] = [
  ['Sep 7', 14, 1], ['Sep 14', 22, 2], ['Sep 21', 31, 3], ['Sep 28', 27, 2],
  ['Oct 5', 38, 4], ['Oct 12', 35, 3], ['Oct 19', 46, 5], ['Oct 26', 12, 3],
];
const BY_COMPANY: [string, number][] = [
  ['Microsoft', 4], ['Amazon', 3], ['Stripe', 3], ['Datadog', 2], ['Shopify', 2], ['Atlassian', 2], ['Coinbase', 2], ['Vercel', 1],
];
const BY_ACCOUNT_N: Record<string, number> = { g1: 74, o1: 58, w1: 41 };

export function Analytics() {
  const st = useStore();
  const all = visibleAll(st.emails, st.accts);
  const days = st.anRange === 'all' ? 99999 : parseInt(st.anRange, 10);
  const rec: Rec[] = st.emails
    .filter((e) => st.accts.some((a) => a.id === e.acct))
    .map((e) => ({ acct: e.acct, cat: effCat(e), d: e.ago / 1440, needs: needsAction(e) }));
  if (provider.isDemo) rec.push(...demoHistory(st.accts.map((a) => a.id)));

  const evAcct = (v: { emailId?: string; co: string }) => {
    const em = v.emailId ? st.emails.find((e) => e.id === v.emailId) : undefined;
    if (em) return em.acct;
    const ap = st.apps.find((a) => a.co === v.co);
    return ap ? ap.acct : '';
  };
  // Calendar interviews not already represented by a "confirmed" email.
  const evRows = st.events
    .filter((v) => v.kind === 'interview' && v.added && daysBetween(st.today, v.date) <= days)
    .filter((v) => {
      const em = v.emailId ? st.emails.find((e) => e.id === v.emailId) : undefined;
      return !(em && effCat(em) === 'confirmed');
    });

  const accRows = st.accts
    .filter((a) => st.anAcct === 'all' || a.id === st.anAcct)
    .map((a) => {
      const rs = rec.filter((r) => r.acct === a.id && r.d <= days);
      const c = (f: (r: Rec) => boolean) => rs.filter(f).length;
      const sched = c((r) => r.cat === 'confirmed') + evRows.filter((v) => evAcct(v) === a.id).length;
      return {
        id: a.id, label: a.label, addr: a.addr, color: a.color, initial: a.initial,
        n: rs.length,
        act: c((r) => r.cat === 'action' || r.needs),
        inv: c((r) => r.cat === 'avail' || r.cat === 'invite'),
        conf: c((r) => r.cat === 'confirmed'),
        app: c((r) => r.cat === 'applied' || r.cat === 'status'),
        rej: c((r) => r.cat === 'rejected'),
        off: c((r) => r.cat === 'offer'),
        auto: c((r) => r.cat === 'auto' || r.cat === 'review'),
        sched,
      };
    });
  type Row = (typeof accRows)[number];
  type NumKey = 'n' | 'act' | 'inv' | 'conf' | 'app' | 'rej' | 'off' | 'auto' | 'sched';
  const sum = (k: NumKey) => accRows.reduce((s, r) => s + r[k], 0);
  const mxS = Math.max(1, ...accRows.map((r) => r.sched));
  const tN = sum('n') || 1;
  const mix: [string, NumKey, string][] = [
    ['Action needed', 'act', '#C0540C'], ['Invites & availability', 'inv', '#7E3FD6'], ['Interview confirmed', 'conf', '#1E8A4C'],
    ['Applications & updates', 'app', '#0B7AB0'], ['Rejected', 'rej', '#B4486A'], ['Offers', 'off', '#0F8F83'], ['Automated / other', 'auto', '#6B7390'],
  ];
  const rangeLabel = st.anRange === 'all' ? 'All time' : 'Last ' + st.anRange + ' days';

  const counts = STAGES.map((s) => ({ label: s.l, color: s.c, n: st.apps.filter((a) => a.stage === s.k).length }));
  const total = counts.reduce((s, c) => s + c.n, 0) || 1;
  let acc = 0;
  const donut =
    'conic-gradient(' +
    counts
      .filter((c) => c.n)
      .map((c) => {
        const a0 = (acc / total) * 360;
        acc += c.n;
        return c.color + ' ' + a0 + 'deg ' + (acc / total) * 360 + 'deg';
      })
      .join(',') +
    ')';

  const byAccount = st.accts.map((a) => ({ name: a.label, color: a.color, initial: a.initial, n: BY_ACCOUNT_N[a.id] || 12 }));
  const mxA = Math.max(1, ...byAccount.map((b) => b.n));
  const offers = all.filter((e) => effCat(e) === 'offer').length;
  const tiles = [
    { label: 'Applications submitted', n: '212', tip: 'Demo data' },
    { label: 'Interview invitations', n: '19', tip: 'Demo data' },
    { label: 'Interview conversion', n: '9.0%', tip: '19 invitations / 212 applications (demo)' },
    { label: 'Response rate', n: '31%', tip: 'Demo data' },
    { label: 'Rejection rate', n: '22%', tip: 'Demo data' },
    { label: 'Offers received', n: String(offers), tip: 'Computed from your inbox' },
  ];

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
  const totals = { n: sum('n'), act: sum('act'), inv: sum('inv'), conf: sum('conf'), app: sum('app'), rej: sum('rej'), off: sum('off'), auto: sum('auto'), sched: sum('sched') };

  return (
    <div className="scroll">
      <div className="ph">
        <div>
          <h1>Analytics</h1>
          <p>{provider.isDemo ? 'Clearly labeled demonstration data. Not real performance.' : 'Computed from your synced mail and calendar.'}</p>
        </div>
        {provider.isDemo && <span className="tag">Demo data · last 8 weeks</span>}
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
            {rangeLabel} · {st.anAcct === 'all' ? 'every connected account' : getAcct(st.accts, st.anAcct).addr}
            {provider.isDemo ? ' · includes fictional demo history' : ''}
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
            {mix.map(([label, k, color]) => (
              <RowBar key={k} name={label} n={sum(k)} pct={Math.round((sum(k) / tN) * 100)} color={color} title={sum(k) + ' emails'} />
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
              Counts confirmed-interview emails plus calendar interviews not already covered by one.{provider.isDemo ? ' Demo history is fictional.' : ''}
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

      <div className="dgrid">
        <section className="card">
          <div className="ch">
            <h2>Weekly recruitment activity</h2>
          </div>
          <div className="cb">
            <div className="lg">
              <span>
                <span className="cdot" style={{ background: 'var(--ac)' }} />
                Recruiter emails
              </span>
              <span>
                <span className="cdot" style={{ background: 'var(--ok)' }} />
                Interview invites
              </span>
            </div>
            <div className="cols">
              {WEEKS.map(([label, a, b]) => (
                <div className="colg" key={label} title={'Week of ' + label + ': ' + a + ' recruiter emails, ' + b + ' interview invites (demo)'}>
                  <div className="pair">
                    <i style={{ height: Math.round((a / 50) * 100) + '%', background: 'var(--ac)' }} />
                    <i style={{ height: Math.round((b / 50) * 100) + 6 + '%', background: 'var(--ok)' }} />
                  </div>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="card">
          <div className="ch">
            <h2>Applications by status</h2>
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
            <h2>Applications by company</h2>
            <span className="hint">demo counts</span>
          </div>
          <div className="cb">
            {BY_COMPANY.map(([name, n]) => (
              <RowBar key={name} name={name} n={n} pct={Math.round((n / 4) * 100)} title={n + ' applications'} />
            ))}
          </div>
        </section>
        <section className="card">
          <div className="ch">
            <h2>Email activity by account</h2>
          </div>
          <div className="cb">
            {byAccount.map((b) => (
              <RowBar key={b.name} name={b.name} n={b.n} pct={Math.round((b.n / mxA) * 100)} color={b.color} nameWidth={120} title={b.n + ' recruitment emails'} lead={<AcDot color={b.color} initial={b.initial} size={18} />} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
