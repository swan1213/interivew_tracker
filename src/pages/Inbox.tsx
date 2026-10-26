import { useState, type ChangeEvent } from 'react';
import { useStore, type AppState, type StateFields } from '@/store/store';
import { getAcct, visibleAll } from '@/store/selectors';
import { provider } from '@/data/provider';
import { CAT, CAT_KEYS, INBOX_TITLES, SAVED_FILTERS, TONES } from '@/data/constants';
import type { CalEvent, Cat, Email } from '@/data/types';
import { companyLine, effCat, filterEmails, firstLink, isNoReply, needsAction, previewOf, RANGE_OPTIONS, rangeDays, replySubject } from '@/lib/mail';
import { addD, lab } from '@/lib/time';
import { cx, truncate } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { AcDot, CatChip, CoBadge, Empty, Fact, PriBadge } from '@/ui/bits';

export function Inbox() {
  const st = useStore();
  const all = visibleAll(st.emails, st.accts);
  const rows = filterEmails(all, st, st.apps);
  return (
    <div className="inbox">
      <MessageList all={all} rows={rows} />
      <MessageDetail all={all} rows={rows} />
    </div>
  );
}

/* ------------------------------------------------------------------ list */

function MessageList({ all, rows }: { all: Email[]; rows: Email[] }) {
  const st = useStore();
  const title = st.peer ? 'All mail with ' + st.peer : st.acctFilter !== 'all' && st.view === 'inbox' ? getAcct(st.accts, st.acctFilter).label : INBOX_TITLES[st.view];
  const companies = Array.from(new Set(all.map((e) => e.company).filter(Boolean))).sort();
  const [rFrom, rTo] = rangeDays(st, st.today);
  // The exact days a range covers, as a hover hint on the picker.
  const rangeTitle = rFrom || rTo ? (rFrom ? lab(rFrom) : 'Any date') + (rTo && rTo !== rFrom ? ' to ' + lab(rTo) : rTo ? '' : ' onward') : 'All dates';
  const sel = (key: keyof StateFields) => (ev: ChangeEvent<HTMLSelectElement>) => st.patch({ [key]: ev.target.value } as Partial<StateFields>);

  return (
    <section className="lcol" aria-label="Message list">
      <div className="lhead">
        <h1>
          {title} <span className="cnt">{rows.length}</span>
          <span className="sp" />
          {st.peer && (
            <button type="button" className="btn ghost sm" onClick={() => st.showPeer('')} aria-label="Show everyone's mail">
              <Icon name="x" sm />
            </button>
          )}
          <button type="button" className="btn ghost sm" onClick={st.refreshAll} aria-label="Refresh">
            <Icon name="refresh" sm />
          </button>
        </h1>
        <div className="saved" aria-label="Saved filters">
          {SAVED_FILTERS.map((s) => (
            <button key={s.k} type="button" className={cx('tog', st.savedKey === s.k && 'on')} aria-pressed={st.savedKey === s.k} onClick={() => st.patch({ savedKey: st.savedKey === s.k ? '' : s.k })}>
              {s.l}
            </button>
          ))}
        </div>
        <div className="frow">
          <select className="sel" value={st.acctFilter} onChange={sel('acctFilter')} aria-label="Account filter">
            <option value="all">All accounts</option>
            {st.accts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <select className="sel" value={st.catFilter} onChange={sel('catFilter')} aria-label="Category filter">
            <option value="all">All categories</option>
            {CAT_KEYS.map((k) => (
              <option key={k} value={k}>
                {CAT[k].l}
              </option>
            ))}
          </select>
          <select className="sel" value={st.priFilter} onChange={sel('priFilter')} aria-label="Priority filter">
            <option value="all">Any priority</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="frow">
          <select className="sel" value={st.coFilter} onChange={sel('coFilter')} aria-label="Company filter">
            <option value="all">All companies</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="sel" value={st.rangeFilter} onChange={sel('rangeFilter')} aria-label="Date range" title={rangeTitle}>
            {RANGE_OPTIONS.map((r) => (
              <option key={r.k} value={r.k}>
                {r.l}
              </option>
            ))}
          </select>
          <select className="sel" value={st.ivFilter} onChange={sel('ivFilter')} aria-label="Interview status">
            <option value="all">Any interview status</option>
            <option value="awaiting">Awaiting reply</option>
            <option value="confirmed">Confirmed</option>
            <option value="none">No interview</option>
          </select>
        </div>
        {st.rangeFilter === 'custom' && (
          <div className="frow drange">
            <label className="ln mini">
              From
              <input type="date" className="inp" value={st.rangeFrom} max={st.today} onChange={(ev) => st.patch({ rangeFrom: ev.target.value })} aria-label="From date" />
            </label>
            <label className="ln mini">
              To
              <input type="date" className="inp" value={st.rangeTo} max={st.today} onChange={(ev) => st.patch({ rangeTo: ev.target.value })} aria-label="To date" />
            </label>
            {(st.rangeFrom || st.rangeTo) && (
              <button type="button" className="btn ghost sm" onClick={() => st.patch({ rangeFrom: '', rangeTo: '' })}>
                Clear dates
              </button>
            )}
          </div>
        )}
        <div className="frow">
          <button type="button" className={cx('tog', st.unreadOnly && 'on')} aria-pressed={st.unreadOnly} onClick={() => st.patch({ unreadOnly: !st.unreadOnly })}>
            Unread only
          </button>
          <button type="button" className={cx('tog', st.actionOnly && 'on')} aria-pressed={st.actionOnly} onClick={() => st.patch({ actionOnly: !st.actionOnly })}>
            Action required only
          </button>
          <select className="sel" value={st.sortKey} onChange={sel('sortKey')} aria-label="Sort" style={{ marginLeft: 'auto' }}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="priority">Priority</option>
            <option value="deadline">Approaching deadline</option>
          </select>
        </div>
      </div>

      <div className="elist">
        {(st.syncing || st.loading) && (
          <>
            <div className="skel" />
            <div className="skel" />
          </>
        )}
        {rows.map((e) => (
          <EmailRow key={e.id} e={e} selected={e.id === st.selId} />
        ))}
        {rows.length === 0 && !st.loading && (
          <Empty
            icon="inbox"
            title={st.accts.length === 0 && !provider.isDemo ? 'No account connected' : st.emails.length === 0 && !provider.isDemo ? 'No recruiter mail yet' : 'No messages match'}
            text={
              st.accts.length === 0 && !provider.isDemo
                ? 'Connect your Gmail in Connected Accounts to start syncing.'
                : st.emails.length === 0 && !provider.isDemo
                  ? 'Sync pulls the last 60 days of sent and received mail.'
                  : 'Try clearing filters or searching a different company.'
            }
          >
            {st.accts.length === 0 && !provider.isDemo ? (
              <button type="button" className="btn sm pri" onClick={() => st.patch({ addAcctOpen: true })}>
                Add account
              </button>
            ) : st.emails.length === 0 && !provider.isDemo ? (
              <button type="button" className="btn sm" onClick={st.refreshAll}>
                Sync now
              </button>
            ) : (
              <button type="button" className="btn sm" onClick={st.clearFilters}>
                {st.emails.length === 0 ? 'Restore demo mail' : 'Clear filters'}
              </button>
            )}
          </Empty>
        )}
      </div>
    </section>
  );
}

function EmailRow({ e, selected }: { e: Email; selected: boolean }) {
  const openEmail = useStore((s) => s.openEmail);
  const toggleStar = useStore((s) => s.toggleStar);
  const accts = useStore((s) => s.accts);
  const c = effCat(e);
  const ac = getAcct(accts, e.acct);
  return (
    <div className={cx('er', e.unread && 'unread', selected && 'sel2')}>
      <button
        type="button"
        className="erb"
        onClick={() => openEmail(e.id)}
        aria-label={e.fromName + ', ' + e.subject + ', ' + CAT[c].l + (e.unread ? ', unread' : '')}
        aria-current={selected ? 'true' : undefined}
      >
        <span className="ud" />
        <CoBadge name={e.company || e.fromName} />
        <span className="body">
          <span className="l1">
            <span className="snd">
              {e.fromName}
              {e.thread.length > 1 ? ' (' + e.thread.length + ')' : ''}
              {e.company ? ' · ' + e.company : ''}
            </span>
            <span className="mut">{e.time}</span>
          </span>
          <div className="sub">{e.subject}</div>
          <div className="pv">{companyLine(e)}</div>
          <div className="pv">{previewOf(e)}</div>
          <span className="l3">
            <CatChip cat={c} />
            {(e.pri === 'critical' || e.pri === 'high') && <PriBadge p={e.pri} />}
            <AcDot color={ac.color} initial={ac.initial} size={16} title={'Received in ' + ac.addr} />
          </span>
        </span>
      </button>
      <button type="button" className={cx('starb', e.starred && 'on')} onClick={() => toggleStar(e.id)} aria-label={e.starred ? 'Unstar message' : 'Star message'} aria-pressed={e.starred}>
        <Icon name="star" sm />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- detail */

interface DetailAction { label: string; primary: boolean; run: () => void }

/** The one or two next-step buttons for an email that still needs action. */
function detailActions(e: Email, ev: CalEvent | undefined, st: AppState): DetailAction[] {
  if (!needsAction(e)) return [];
  const c = effCat(e);
  const acts: DetailAction[] = [];
  // Scheduling by reply needs someone to read the reply; a no-reply sender schedules through a link.
  const byReply = e.canReply && !isNoReply(e.fromAddr);
  if (e.mode === 'avail' && byReply) {
    acts.push({ label: 'Schedule interview', primary: true, run: () => st.openSched('avail') });
    acts.push({ label: 'Open calendar', primary: false, run: () => st.go('cal', { calView: 'week', calDate: st.today }) });
  } else if (e.mode === 'resched' && byReply) {
    acts.push({ label: 'Pick a new time', primary: true, run: () => st.openSched('resched') });
    acts.push({ label: 'Open calendar', primary: false, run: () => st.go('cal', { calView: 'week', calDate: st.today, calSel: e.evId || '' }) });
  } else if (e.mode === 'confirm') {
    if (ev && !ev.added) acts.push({ label: 'Add to calendar', primary: true, run: () => st.openAddCal(ev.id) });
    else if (ev) acts.push({ label: 'View on calendar', primary: true, run: () => st.go('cal', { calView: 'week', calDate: ev.date, calSel: ev.id }) });
  } else if (e.mode === 'assess') {
    const link = firstLink(e.body);
    acts.push({ label: 'Open assessment', primary: true, run: () => st.showToast(provider.isDemo ? 'Demo: the assessment link would open here' + (link ? ' (' + link + ').' : '.') : 'Opening ' + link) });
    if (e.deadlineKey !== '9999') {
      const day = addD(e.deadlineKey, -1);
      acts.push({ label: 'Remind me ' + lab(day).replace(',', ''), primary: false, run: () => st.showToast('Reminder set for ' + lab(day) + (provider.isDemo ? ' (demo).' : '.')) });
    }
  } else if (c === 'offer') {
    acts.push({ label: 'Draft reply', primary: true, run: st.genReply });
    if (ev) acts.push({ label: 'Open call event', primary: false, run: () => st.go('cal', { calView: 'day', calDate: ev.date, calSel: ev.id }) });
  } else if (c === 'action') {
    acts.push({ label: 'Draft reply', primary: true, run: st.genReply });
  }
  return acts;
}

function MessageDetail({ all, rows }: { all: Email[]; rows: Email[] }) {
  const st = useStore();
  const e = all.find((x) => x.id === st.selId);
  if (!e) {
    return (
      <section className="dcol" aria-label="Message detail">
        <Empty icon="mail" title="Select a conversation" text="The AI summary, extracted details and a suggested reply appear here." />
      </section>
    );
  }
  const c = effCat(e);
  const ac = getAcct(st.accts, e.acct);
  const app = st.apps.find((a) => a.co === e.company);
  const ev = e.evId ? st.events.find((v) => v.id === e.evId) : undefined;
  const need = needsAction(e);
  const acts = detailActions(e, ev, st);
  const nextId = rows.find((x) => x.id !== e.id)?.id ?? '';
  const assumptions = e.assumptions.length ? e.assumptions : ['Nothing inferred'];

  return (
    <section className="dcol" aria-label="Message detail">
      <div className="dhead">
        <div className="dtop">
          <div className="ln wrap">
            <CatChip cat={c} />
            {e.sec && e.sec !== c && <CatChip cat={e.sec} dash withIcon={false} />}
            <PriBadge p={e.pri} suffix="priority" />
            {e.catOv && <span className="tag">Reclassified by you</span>}
            {e.ivStatus === 'awaiting' && <span className="tag">Awaiting confirmation</span>}
          </div>
          <div className="ln wrap">
            <button type="button" className="btn sm" onClick={() => st.openComp('reply')}>
              <Icon name="reply" sm />
              Reply
            </button>
            <button type="button" className="btn sm" onClick={() => st.openComp('replyall')}>
              Reply all
            </button>
            <button type="button" className="btn sm" onClick={() => st.openComp('forward')}>
              <Icon name="fwd" sm />
              Forward
            </button>
            <button type="button" className="btn sm" onClick={() => st.archive(e.id, nextId)}>
              <Icon name="archive" sm />
              Archive
            </button>
            <label className="ln mini">
              Category
              <select className="sel" value={c} onChange={(ev2) => st.reclassify(ev2.target.value as Cat)} aria-label="Change classification">
                {CAT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {CAT[k].l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <h2>{e.subject}</h2>
      </div>

      <div className="dscroll">
        <div className="route">
          <AcDot color={ac.color} initial={ac.initial} size={20} />
          <span>
            Received in <b>{ac.addr}</b>
          </span>
          <Icon name="chevR" sm />
          <span>
            Replies send from <b>{ac.addr}</b> as {ac.sendAs}
          </span>
          <span className="sp" />
          <span className="mut">
            {e.cat === 'sent' ? '' : 'From '}
            {e.fromName} &lt;{e.fromAddr}&gt;
          </span>
          {e.fromAddr && st.peer !== e.fromAddr.toLowerCase() && (
            <button type="button" className="btn ghost sm" onClick={() => st.showPeer(e.fromAddr)} title={'Every conversation with ' + e.fromAddr + ', sent and received'}>
              <Icon name="mail" sm />
              All mail with this person
            </button>
          )}
        </div>

        {need && e.action && (
          <div className="act">
            <Icon name="bolt" />
            <span className="sp">
              <b>Next action:</b> {e.action}
              {e.deadline && (
                <>
                  {' · '}
                  <b>Due {e.deadline}</b>
                </>
              )}
            </span>
            {acts.map((a) => (
              <button key={a.label} type="button" className={cx('btn sm', a.primary && 'pri')} onClick={a.run}>
                {a.label}
              </button>
            ))}
          </div>
        )}

        <section className="ins" aria-label="AI insights">
          <button type="button" className="insh" onClick={st.toggleIns} aria-expanded={st.insOpen}>
            <Icon name="spark" sm style={{ color: 'var(--ac)' }} />
            <b style={{ fontWeight: 650 }}>AI Insights</b>
            <span className="mut" style={{ flex: 1 }}>
              {truncate(e.summary, 60)}
            </span>
            {st.S.ai.showConf && (
              <span className="conf">
                <span className="bar">
                  <i style={{ width: e.conf + '%' }} />
                </span>
                {e.conf}% confidence
              </span>
            )}
            <Icon name={st.insOpen ? 'chevU' : 'chevD'} sm />
          </button>
          {st.insOpen && (
            <div className="insb">
              <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.55 }}>{e.summary}</p>
              <div className="fgrid" style={{ marginTop: 0 }}>
                <Fact label="Company">{e.company || 'Not detected'}</Fact>
                <Fact label="Position">{e.role || 'Not stated'}</Fact>
                <Fact label="Recruiter">{e.recruiter || 'Not stated'}</Fact>
                <Fact label="Interview stage">{e.stage || 'Not applicable'}</Fact>
                <Fact label="Required action">{e.action}</Fact>
                <Fact label="Deadline">{e.deadline || 'Not stated'}</Fact>
              </div>
              {e.times.length > 0 && (
                <div>
                  <span className="fl">Meeting times stated in the email ({st.S.tz})</span>
                  <div className="ln wrap">
                    {e.times.map((t) => (
                      <span className="tag" key={t.label}>
                        <Icon name="clock" sm />
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {st.S.ai.flagAssume ? (
                <div className="two">
                  <div className="facts">
                    <h4>
                      <Icon name="check" sm />
                      Stated in the email
                    </h4>
                    <ul>
                      {e.facts.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="facts inf">
                    <h4>
                      <Icon name="spark" sm />
                      AI assumptions (unverified)
                    </h4>
                    <ul>
                      {assumptions.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="facts">
                  <h4>
                    <Icon name="check" sm />
                    Extracted details
                  </h4>
                  <ul>
                    {e.facts.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                    {e.assumptions.map((f) => (
                      <li key={f}>{f} (inferred)</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="ln wrap">
                <span className="mini">Related application:</span>
                {app ? (
                  <button type="button" className="btn sm" onClick={() => st.go('track', { appSel: app.id })}>
                    <Icon name="kanban" sm />
                    {app.co}: {stageName(st, app.stage)}
                  </button>
                ) : (
                  <span className="mut">None matched</span>
                )}
              </div>
            </div>
          )}
        </section>

        <Thread key={e.id} e={e} />

        {e.canReply && <ReplyAssistant e={e} />}
        {st.compOpen && <Composer e={e} />}
      </div>
    </section>
  );
}

import { stageLabel } from '@/data/constants';
import { colorOf } from '@/lib/util';
const stageName = (_st: AppState, k: Parameters<typeof stageLabel>[0]) => stageLabel(k);
const colorFor = (name: string) => colorOf(name);

/** The conversation laid out like a mail client: one card, a row per message, older ones folded. */
function Thread({ e }: { e: Email }) {
  const st = useStore();
  const n = e.thread.length;
  const [open, setOpen] = useState<Set<number>>(() => new Set(n <= 2 ? e.thread.map((_, i) => i) : [n - 1]));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const other = e.thread.find((m) => !m.mine)?.from || e.fromName;
  const folded = n > 2 ? e.thread.slice(0, -1).filter((_, i) => !open.has(i)).length : 0;

  return (
    <section className="thread" aria-label="Conversation">
      {e.thread.map((m, i) => {
        const isOpen = open.has(i);
        const color = m.mine ? 'var(--acb)' : colorFor(m.from);
        return (
          <article className={cx('tmsg', !isOpen && 'fold')} key={i} onClick={isOpen ? undefined : () => toggle(i)}>
            <span className="tav" style={{ background: color }} aria-hidden="true">
              {m.from.trim().charAt(0).toUpperCase()}
            </span>
            <div className="tmb">
              <button type="button" className="tmh" onClick={(ev) => { ev.stopPropagation(); toggle(i); }} aria-expanded={isOpen} disabled={i === n - 1}>
                <span className="who">
                  <b>{m.from}</b>
                  {isOpen && <span className="addr">&lt;{m.addr}&gt;</span>}
                </span>
                <span className="when">{m.when}</span>
              </button>
              {isOpen ? (
                <>
                  <div className="to">
                    to {m.mine ? other : 'me'}
                    {!m.mine && st.peer !== m.addr.toLowerCase() && (
                      <button type="button" className="lnk" onClick={() => st.showPeer(m.addr)} title={'All mail with ' + m.addr}>
                        All mail with {m.from.split(' ')[0]}
                      </button>
                    )}
                  </div>
                  <div className="tbody">{m.body}</div>
                  {!!m.atts?.length && (
                    <div className="tatt">
                      {m.atts.map((at) => (
                        <span className="att" key={at.name}>
                          <Icon name="clip" sm />
                          {at.name} <span className="mut">{at.size}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="snip">{m.body.replace(/\s+/g, ' ')}</div>
              )}
            </div>
          </article>
        );
      })}
      {folded > 1 && (
        <button type="button" className="tmore" onClick={() => setOpen(new Set(e.thread.map((_, i) => i)))}>
          Expand all {n} messages
        </button>
      )}
      {!st.compOpen && (
        <div className="tact">
          <button type="button" className="pill" onClick={() => st.openComp('reply')}>
            <Icon name="reply" sm />
            Reply
          </button>
          {e.peers && e.peers.length > 1 && (
            <button type="button" className="pill" onClick={() => st.openComp('replyall')}>
              <Icon name="reply" sm />
              Reply all
            </button>
          )}
          <button type="button" className="pill" onClick={() => st.openComp('forward')}>
            <Icon name="fwd" sm />
            Forward
          </button>
        </div>
      )}
    </section>
  );
}

function ReplyAssistant({ e }: { e: Email }) {
  const st = useStore();
  const activeTone = st.mods.prof ? 'professional' : st.tone;
  return (
    <section className="aid" aria-label="AI reply assistant">
      <div className="ln wrap">
        <span className="spark">
          <Icon name="spark" sm />
          AI reply assistant
        </span>
        <span className="mut" style={{ flex: 1 }}>
          {e.replyKind} · nothing is sent without your approval
        </span>
      </div>
      <div className="ln wrap">
        <span className="mini">Tone</span>
        <div className="tones">
          {TONES.map((t) => (
            <button key={t.k} type="button" className={cx('tog', activeTone === t.k && 'on')} aria-pressed={activeTone === t.k} onClick={() => st.pickTone(t.k)}>
              {t.l}
            </button>
          ))}
        </div>
      </div>
      {!st.aiDraft ? (
        <div className="ln wrap">
          <button type="button" className="btn pri" onClick={st.genReply}>
            <Icon name="spark" sm />
            Generate reply
          </button>
          <span className="mut">Uses your tone, the thread and your account identity.</span>
        </div>
      ) : (
        <>
          <div className="draft">{st.aiDraft}</div>
          <div className="ln wrap">
            <button type="button" className="btn sm" onClick={st.regen}>
              Regenerate
            </button>
            <button type="button" className="btn sm" onClick={st.shorter}>
              Make shorter
            </button>
            <button type="button" className="btn sm" onClick={st.moreProf}>
              Make more professional
            </button>
            <span className="sp" />
            <button type="button" className="btn pri sm" onClick={st.insertDraft}>
              Insert into composer
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Composer({ e }: { e: Email }) {
  const st = useStore();
  const fwd = st.compMode === 'forward';
  const subject = replySubject(e.subject, fwd);
  const modeLabel = st.compMode === 'replyall' ? 'Reply all' : fwd ? 'Forward' : 'Reply';
  const people = Array.from(new Set(st.accts.map((a) => a.addr).concat(st.emails.flatMap((x) => x.peers || []))));
  return (
    <section className="comp" aria-label="Composer">
      <div className="cr">
        <span className="k">From</span>
        <select className="sel" value={st.compFrom} onChange={(ev) => st.patch({ compFrom: ev.target.value })} aria-label="Send from account">
          {st.accts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.addr} ({a.sendAs})
            </option>
          ))}
        </select>
        <span className="mut">{fwd ? 'Sent as a new conversation with the original quoted' : 'Stays in this conversation'}</span>
      </div>
      <div className="cr">
        <span className="k">To</span>
        <input
          className="cto"
          type="text"
          list="comp-people"
          value={st.compTo}
          onChange={(ev) => st.patch({ compTo: ev.target.value })}
          placeholder="name@example.com, separate several with commas"
          aria-label="Recipients"
          autoFocus={fwd}
        />
        <datalist id="comp-people">
          {people.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <span className="tag">{modeLabel}</span>
      </div>
      <div className="cr">
        <span className="k">Subject</span>
        <span>{subject}</span>
      </div>
      <textarea
        aria-label="Message body"
        value={st.compText}
        onChange={(ev) => st.patch({ compText: ev.target.value })}
        placeholder={fwd ? 'Add a note above the forwarded message' : 'Write your reply, or generate one above. You review everything before it sends.'}
        autoFocus={!fwd}
        ref={(el) => {
          // Start typing above the quoted original when forwarding.
          if (el && fwd && document.activeElement !== el && el.selectionStart === el.value.length) el.setSelectionRange(0, 0);
        }}
      />
      <div className="cr" style={{ borderTop: '1px solid var(--bd)', borderBottom: 0 }}>
        <button type="button" className="btn pri" onClick={st.askSend}>
          <Icon name="send" sm />
          Send…
        </button>
        <button type="button" className="btn ghost" onClick={st.closeComp}>
          Discard
        </button>
        <span className="mut">AI drafts are always editable and never auto-sent.</span>
      </div>
    </section>
  );
}
