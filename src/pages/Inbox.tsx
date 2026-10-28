import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type AppState } from '@/store/store';
import { getAcct, visibleAll } from '@/store/selectors';
import { provider } from '@/data/provider';
import { CAT, CAT_KEYS, INBOX_TITLES, TONES } from '@/data/constants';
import type { CalEvent, Cat, Email, ThreadMsg } from '@/data/types';
import { effCat, filterEmails, firstLink, isNoReply, needsAction, participants, previewOf, replySubject, senderName, tidyBody } from '@/lib/mail';
import { activeEvents, isInterviewMeeting, meetingMentions } from '@/lib/calendar';
import { addD, lab } from '@/lib/time';
import { colorOf, cx } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { AcDot, CatChip, Empty, Linked, PriBadge } from '@/ui/bits';

export function Inbox() {
  const st = useStore();
  const all = visibleAll(st.emails, st.accts);
  const rows = filterEmails(all, st, st.apps);
  return (
    <div className="inbox">
      <MessageList rows={rows} />
      <MessageDetail all={all} rows={rows} />
    </div>
  );
}

/* ------------------------------------------------------------------ list */

/** Conversations per page, like Gmail. */
const PAGE_SIZE = 50;
const num = (n: number) => n.toLocaleString('en-US');

function MessageList({ rows }: { rows: Email[] }) {
  const st = useStore();
  const title = st.peer ? 'All mail with ' + st.peer : st.acctFilter !== 'all' && st.view === 'inbox' ? getAcct(st.accts, st.acctFilter).label : INBOX_TITLES[st.view];
  // Filters set from elsewhere (a dashboard tile, say) have no picker here, so say they are on and offer to clear them.
  const narrowed = [st.unreadOnly && 'Unread', st.actionOnly && 'Action required', st.catFilter !== 'all' && CAT[st.catFilter].l, st.priFilter !== 'all' && st.priFilter + ' priority', st.coFilter !== 'all' && st.coFilter, st.ivFilter !== 'all' && 'Interview ' + st.ivFilter, st.rangeFilter !== 'all' && 'Date range', st.savedKey && 'Saved view'].filter(Boolean);

  // Paging starts over whenever the list itself changes (another view, account, search or filter).
  const listKey = [st.view, st.acctFilter, st.peer, st.q, narrowed.join()].join('|');
  const [pg, setPg] = useState({ key: listKey, n: 0 });
  if (pg.key !== listKey) setPg({ key: listKey, n: 0 });
  const listRef = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = pg.key === listKey ? Math.min(pg.n, pages - 1) : 0;
  const first = page * PAGE_SIZE;
  const shown = rows.slice(first, first + PAGE_SIZE);
  const goPage = (n: number) => {
    setPg({ key: listKey, n });
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const range = rows.length ? num(first + 1) + '–' + num(first + shown.length) + ' of ' + num(rows.length) : 'No conversations';

  return (
    <section className="lcol" aria-label="Message list">
      <div className="lhead">
        <h1>
          <span className="ttl">{title}</span>
          <span className="sp" />
          <span className="lcount" aria-live="polite">
            {range}
          </span>
          <button type="button" className="ib" onClick={() => goPage(page - 1)} disabled={page === 0} aria-label="Newer" title="Newer">
            <Icon name="chevL" sm />
          </button>
          <button type="button" className="ib" onClick={() => goPage(page + 1)} disabled={page >= pages - 1} aria-label="Older" title="Older">
            <Icon name="chevR" sm />
          </button>
          {st.peer && (
            <button type="button" className="ib" onClick={() => st.showPeer('')} aria-label="Show everyone's mail" title="Show everyone's mail">
              <Icon name="x" sm />
            </button>
          )}
          <button type="button" className="ib" onClick={st.refreshAll} aria-label="Refresh" title="Refresh">
            <Icon name="refresh" sm />
          </button>
        </h1>
        {narrowed.length > 0 && (
          <div className="narrow">
            <span>Filtered: {narrowed.join(', ')}</span>
            <button type="button" className="lnk" onClick={() => st.patch({ unreadOnly: false, actionOnly: false, catFilter: 'all', priFilter: 'all', coFilter: 'all', ivFilter: 'all', rangeFilter: 'all', rangeFrom: '', rangeTo: '', savedKey: '' })}>
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="elist" ref={listRef}>
        {(st.syncing || st.loading) && (
          <>
            <div className="skel" />
            <div className="skel" />
          </>
        )}
        {shown.map((e) => (
          <EmailRow key={e.id} e={e} selected={e.id === st.selId} />
        ))}
        {pages > 1 && (
          <div className="lfoot">
            <button type="button" className="btn sm ghost" onClick={() => goPage(page - 1)} disabled={page === 0}>
              <Icon name="chevL" sm />
              Newer
            </button>
            <span className="mut">
              Page {num(page + 1)} of {num(pages)}
            </span>
            <button type="button" className="btn sm ghost" onClick={() => goPage(page + 1)} disabled={page >= pages - 1}>
              Older
              <Icon name="chevR" sm />
            </button>
          </div>
        )}
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
  const who = participants(e);
  const lead = senderName(e.fromName, e.fromAddr, e.company);
  return (
    <div className={cx('er', e.unread && 'unread', selected && 'sel2')}>
      <button
        type="button"
        className="erb"
        onClick={() => openEmail(e.id)}
        aria-label={who + ', ' + e.subject + ', ' + CAT[c].l + (e.unread ? ', unread' : '')}
        aria-current={selected ? 'true' : undefined}
      >
        <span className="eav" style={{ background: colorOf(lead) }} aria-hidden="true">
          {lead.charAt(0).toUpperCase()}
        </span>
        <span className="body">
          <span className="l1">
            <span className="snd">
              {who}
              {e.thread.length > 1 && <span className="tn"> ({e.thread.length})</span>}
            </span>
            <span className="tm2">{e.time}</span>
          </span>
          <span className="sub">{e.subject || '(no subject)'}</span>
          <span className="pv">{previewOf(e)}</span>
          <span className="l3">
            <CatChip cat={c} withIcon={false} className="lbl" />
            {(e.pri === 'critical' || e.pri === 'high') && <PriBadge p={e.pri} />}
            {accts.length > 1 && <AcDot color={ac.color} initial={ac.initial} size={14} title={'Received in ' + ac.addr} />}
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

/** A meeting from today on that this email's company already has on the calendar. */
function bookedMeeting(e: Email, st: Pick<AppState, 'events' | 'accts' | 'today'>): CalEvent | undefined {
  const own = st.accts.map((a) => a.addr);
  return activeEvents(st.events)
    .filter((v) => v.date >= st.today && isInterviewMeeting(v, own) && (v.emailId === e.id || v.id === e.evId || (!!e.company && meetingMentions(v, e.company))))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)[0];
}

/** The one or two next-step buttons for an email that still needs action. */
function detailActions(e: Email, ev: CalEvent | undefined, st: AppState): DetailAction[] {
  if (!needsAction(e)) return [];
  const c = effCat(e);
  const acts: DetailAction[] = [];
  // Scheduling by reply needs someone to read the reply; a no-reply sender schedules through a link.
  const byReply = e.canReply && !isNoReply(e.fromAddr);
  // Nothing to schedule when the meeting is already on the calendar.
  const booked = e.mode === 'avail' ? bookedMeeting(e, st) : undefined;
  if (booked) {
    acts.push({ label: 'View on calendar', primary: true, run: () => st.go('cal', { calView: 'week', calDate: booked.date, calSel: booked.id }) });
  } else if (e.mode === 'avail' && byReply) {
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
        <Empty icon="mail" title="Select a conversation" text="Pick a message on the left to read it here." />
      </section>
    );
  }
  const c = effCat(e);
  const ac = getAcct(st.accts, e.acct);
  const ev = e.evId ? st.events.find((v) => v.id === e.evId) : undefined;
  const need = needsAction(e);
  const acts = detailActions(e, ev, st);
  const nextId = rows.find((x) => x.id !== e.id)?.id ?? '';

  return (
    <section className="dcol" aria-label="Message detail">
      <div className="dbar" role="toolbar" aria-label="Conversation actions">
        <button type="button" className="ib" onClick={() => st.archive(e.id, nextId)} aria-label="Archive" title="Archive">
          <Icon name="archive" sm />
        </button>
        <span className="dsep" />
        <label className="dlabel" title="Move to category">
          <span className="mut">Category</span>
          <select className="sel" value={c} onChange={(ev2) => st.reclassify(ev2.target.value as Cat)} aria-label="Change classification">
            {CAT_KEYS.map((k) => (
              <option key={k} value={k}>
                {CAT[k].l}
              </option>
            ))}
          </select>
        </label>
        <span className="sp" />
        <button type="button" className="ib" onClick={() => st.openComp('reply')} aria-label="Reply" title="Reply">
          <Icon name="reply" sm />
        </button>
        <button type="button" className="ib" onClick={() => st.openComp('forward')} aria-label="Forward" title="Forward">
          <Icon name="fwd" sm />
        </button>
      </div>

      <div className="dscroll">
        <div className="dsubj">
          <h2>{e.subject || '(no subject)'}</h2>
          <CatChip cat={c} withIcon={false} className="lbl" />
          {e.sec && e.sec !== c && <CatChip cat={e.sec} dash withIcon={false} className="lbl" />}
          {(e.pri === 'critical' || e.pri === 'high') && <PriBadge p={e.pri} suffix="priority" />}
          {e.catOv && <span className="tag">Reclassified by you</span>}
          {e.ivStatus === 'awaiting' && <span className="tag">Awaiting confirmation</span>}
        </div>

        {need && (acts.length > 0 || e.deadline) && (
          <div className="dacts">
            {acts.map((a) => (
              <button key={a.label} type="button" className={cx('btn', a.primary && 'pri')} onClick={a.run}>
                {a.label}
              </button>
            ))}
            {e.deadline && (
              <span className="due">
                <Icon name="clock" sm />
                Due {e.deadline}
              </span>
            )}
          </div>
        )}

        <section className="ins" aria-label="AI insights">
          <div className="insh">
            <Icon name="spark" sm style={{ color: 'var(--ac)' }} />
            <b>AI summary</b>
            <span className="sp" />
            {st.S.ai.showConf && <span className="mut">{e.conf}% confidence</span>}
          </div>
          <p>
            <Linked text={e.summary} />
          </p>
          {e.times.length > 0 && (
            <div className="ln wrap">
              <span className="mini">Times in the email ({st.S.tz})</span>
              {e.times.map((t) => (
                <span className="tag" key={t.label}>
                  <Icon name="clock" sm />
                  {t.label}
                </span>
              ))}
            </div>
          )}
        </section>

        <Thread key={e.id} e={e} acctAddr={ac.addr} />

        {e.canReply && <ReplyAssistant e={e} />}
        {st.compOpen && <Composer e={e} />}
      </div>
    </section>
  );
}

/** HTML bodies already loaded this session, by email id + message id ('' = the message has none). */
const htmlCache = new Map<string, string>();

/** A message as its sender laid it out (HTML, loaded on open), else as text. */
function MsgBody({ emailId, m }: { emailId: string; m: ThreadMsg }) {
  const key = m.id && provider.messageHtml ? emailId + '/' + m.id : '';
  const [, loaded] = useState(0);
  const html = key ? htmlCache.get(key) : '';
  useEffect(() => {
    if (!key || htmlCache.has(key) || !m.id || !provider.messageHtml) return;
    let live = true;
    provider
      .messageHtml(emailId, m.id)
      .catch(() => '')
      .then((h) => {
        htmlCache.set(key, h);
        if (live) loaded((x) => x + 1);
      });
    return () => {
      live = false;
    };
  }, [key, emailId, m.id]);
  if (html) return <HtmlFrame html={html} />;
  if (html === undefined) return <div className="tbody mut">Loading message…</div>;
  return (
    <div className="tbody">
      <Linked text={tidyBody(m.body)} />
    </div>
  );
}

/** Frame styles: a white page like Gmail's, images fit the width, quoted history hidden. */
const FRAME_HEAD =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; frame-src \'none\'; form-action \'none\'">' +
  '<base target="_blank"><style>html{overflow-y:hidden;overflow-x:auto}body{margin:0;padding:16px;background:#fff;color:#222;font:14px/1.5 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}' +
  'img{max-width:100%}.gmail_quote,blockquote[type=cite],#divRplyFwdMsg,#divRplyFwdMsg~*{display:none}</style></head><body>';

/**
 * Email HTML in a sandboxed frame: no scripts, links open in a new tab, and the frame grows to its
 * content so the conversation scrolls as one page.
 */
function HtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const doc = useMemo(() => FRAME_HEAD + html + '</body></html>', [html]);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    const fit = () => {
      const d = f.contentDocument;
      if (!d?.documentElement) return;
      setHeight(Math.max(40, d.documentElement.scrollHeight));
      if (!ro && typeof ResizeObserver !== 'undefined' && d.body) {
        ro = new ResizeObserver(() => setHeight(Math.max(40, d.documentElement.scrollHeight)));
        ro.observe(d.body);
      }
    };
    f.addEventListener('load', fit);
    fit();
    return () => {
      f.removeEventListener('load', fit);
      ro?.disconnect();
    };
  }, [doc]);
  return (
    <iframe
      ref={ref}
      className="hframe"
      title="Message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height }}
    />
  );
}

/** The conversation laid out like a mail client: one card, a row per message, older ones folded. */
function Thread({ e, acctAddr }: { e: Email; acctAddr: string }) {
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
        const name = m.mine ? m.from : senderName(m.from, m.addr, e.company);
        const color = m.mine ? 'var(--acb)' : colorOf(name);
        return (
          <article className={cx('tmsg', !isOpen && 'fold')} key={i} onClick={isOpen ? undefined : () => toggle(i)}>
            <span className="tav" style={{ background: color }} aria-hidden="true">
              {name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="tmb">
              <button type="button" className="tmh" onClick={(ev) => { ev.stopPropagation(); toggle(i); }} aria-expanded={isOpen} disabled={i === n - 1}>
                <span className="who">
                  <b>{name}</b>
                  {isOpen && <span className="addr">&lt;{m.addr}&gt;</span>}
                </span>
                <span className="when">{m.when}</span>
              </button>
              {isOpen ? (
                <>
                  <div className="to">
                    to {m.mine ? other : <span title={acctAddr}>me ({acctAddr})</span>}
                  </div>
                  <MsgBody emailId={e.id} m={m} />
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
