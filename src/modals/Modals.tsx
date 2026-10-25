import { useStore } from '@/store/store';
import { getAcct, visibleAll } from '@/store/selectors';
import { provider } from '@/data/provider';
import { runtime } from '@/data/runtime';
import { STG } from '@/data/constants';
import { activeEvents, busyAt } from '@/lib/calendar';
import { buildSched } from '@/lib/schedule';
import { fmtT, lab, tzOffset } from '@/lib/time';
import { replySubject } from '@/lib/mail';
import { cx } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { AcDot, Fact, Modal } from '@/ui/bits';

export function Modals() {
  const st = useStore();
  return (
    <>
      {st.schedOpen && <ScheduleModal />}
      {st.addCalOpen && <AddCalModal />}
      {st.sendOpen && <SendModal />}
      {st.newOpen && <NewMessage />}
      {st.cfOpen && <ConfirmModal />}
      {st.addAcctOpen && <AddAccountModal />}
    </>
  );
}

function ScheduleModal() {
  const st = useStore();
  const e = st.emails.find((x) => x.id === st.selId);
  const m = buildSched(e, st.schedMode, st.schedSel, st.S, activeEvents(st.events));
  return (
    <Modal size="lg" label="Schedule interview" onClose={st.closeSched}>
      <div className="mhd">
        <div>
          <h3>{m.title}</h3>
          <span className="mini">{m.sub}</span>
        </div>
        <button type="button" className="ib" onClick={st.closeSched} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="mbd">
        <div className="steps">
          <span>
            <Icon name="check" sm />
            Request recognized
          </span>
          <span>
            <Icon name="check" sm />
            Calendars checked ({st.S.tz})
          </span>
          <span>
            <Icon name="check" sm />
            Availability window applied
          </span>
        </div>
        <div className="mini">{m.hint}</div>
        <div>
          {m.days.map((d) => (
            <div className="sday" key={d.label + d.sub}>
              <div className="dn">
                {d.label}
                <small>{d.sub}</small>
              </div>
              <div className="slots">
                {d.slots.map((s) => (
                  <button key={s.key} type="button" className={cx('slot', s.busy && 'busy', s.on && 'on')} onClick={() => st.toggleSlot(s.key)} disabled={s.busy} title={s.title} aria-pressed={s.on}>
                    {s.label}
                  </button>
                ))}
                {d.slots.length === 0 && <span className="mut">No slots inside your availability window.</span>}
              </div>
            </div>
          ))}
          {m.days.length === 0 && <div className="mut">None of the requested dates fall on your available days. Adjust availability in Settings.</div>}
        </div>
      </div>
      <div className="mft">
        <span className="mut" style={{ flex: 1 }}>
          {m.count}
        </span>
        <button type="button" className="btn" onClick={st.closeSched}>
          Cancel
        </button>
        <button type="button" className="btn pri" onClick={st.genSchedReply} disabled={m.cantGen}>
          <Icon name="spark" sm />
          Generate reply
        </button>
      </div>
    </Modal>
  );
}

function AddCalModal() {
  const st = useStore();
  const v = st.events.find((x) => x.id === st.addCalEv);
  if (!v) return null;
  const off = tzOffset(st.S.tz);
  const c = busyAt(activeEvents(st.events), v.date, v.start, v.end, v.id);
  const rems =
    Object.keys(st.S.rem)
      .filter((k) => st.S.rem[k])
      .map((k) => (k === '1440' ? '24 h' : k + ' min'))
      .join(', ') || 'none';
  return (
    <Modal size="sm" label="Add interview to calendar" onClose={st.closeAddCal}>
      <div className="mhd">
        <h3>Add to calendar?</h3>
        <button type="button" className="ib" onClick={st.closeAddCal} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="mbd">
        <div className="fgrid" style={{ gridTemplateColumns: '1fr 1fr', margin: 0 }}>
          <Fact label="Company">{v.co}</Fact>
          <Fact label="Role">{v.role}</Fact>
          <Fact label="Stage">{STG[v.stage].label}</Fact>
          <Fact label="Interviewer">{v.interviewer}</Fact>
          <Fact label="Date">{lab(v.date)}</Fact>
          <Fact label="Time">
            {fmtT(v.start + off)}–{fmtT(v.end + off)} {st.S.tz}
          </Fact>
          <Fact label="Platform">{v.platform}</Fact>
          <Fact label="Time zone">Eastern (stated in the email)</Fact>
        </div>
        <div className={cx('act', !c && 'okn')}>{c ? 'Conflict: overlaps with ' + c.co + '. You can still add it, then resolve it.' : 'No conflicts found with your existing events.'}</div>
        <div className="mut">Reminders will use your defaults: {rems}. The event is only created after you confirm.</div>
      </div>
      <div className="mft">
        <button type="button" className="btn" onClick={st.closeAddCal}>
          Not now
        </button>
        <button type="button" className="btn pri" onClick={st.confirmAddCal}>
          Add to calendar
        </button>
      </div>
    </Modal>
  );
}

function SendModal() {
  const st = useStore();
  const all = visibleAll(st.emails, st.accts);
  const e = all.find((x) => x.id === st.selId);
  const ac = getAcct(st.accts, st.compFrom);
  const empty = !st.compText.trim();
  const fwd = st.compMode === 'forward';
  const to = st.compTo.trim() || (fwd ? '' : e?.fromAddr || '');
  return (
    <Modal size="sm" label="Confirm send" role="alertdialog">
      <div className="mhd">
        <h3>{fwd ? 'Forward this message?' : 'Send this reply?'}</h3>
      </div>
      <div className="mbd">
        <div className="fgrid" style={{ gridTemplateColumns: '1fr', margin: 0 }}>
          <Fact label="From">
            {ac.addr} ({ac.sendAs})
          </Fact>
          <Fact label="To">{to || 'No recipient yet'}</Fact>
          <Fact label="Subject">{e ? replySubject(e.subject, fwd) : ''}</Fact>
        </div>
        <div className="draft" style={{ whiteSpace: 'pre-line', fontSize: 12.5, maxHeight: 160, overflow: 'auto', padding: 10, border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg)' }}>
          {st.compText}
        </div>
        {empty && <div className="act">The message is empty. Write or insert a reply first.</div>}
        {!to && <div className="act">Add at least one recipient in the To field.</div>}
        <div className="mut">{provider.isDemo ? 'Demo: nothing is actually sent. In production this goes through Gmail API or Microsoft Graph with the account above.' : 'Sends through the account above. This cannot be undone.'}</div>
      </div>
      <div className="mft">
        <button type="button" className="btn" onClick={st.closeSend}>
          Keep editing
        </button>
        <button type="button" className="btn pri" onClick={st.confirmSend} disabled={empty || !to}>
          Send now
        </button>
      </div>
    </Modal>
  );
}

function ConfirmModal() {
  const st = useStore();
  return (
    <Modal size="sm" label={st.cf.title} role="alertdialog">
      <div className="mhd">
        <h3>{st.cf.title}</h3>
      </div>
      <div className="mbd">
        <div>{st.cf.body}</div>
      </div>
      <div className="mft">
        <button type="button" className="btn" onClick={st.closeCf}>
          Cancel
        </button>
        <button type="button" className="btn pri" onClick={st.confirmCf}>
          {st.cf.label}
        </button>
      </div>
    </Modal>
  );
}

function AddAccountModal() {
  const st = useStore();
  const close = () => st.patch({ addAcctOpen: false });
  const real = !provider.isDemo;
  const item = { border: '1px solid var(--bd)', padding: 11 } as const;
  return (
    <Modal size="sm" label="Add email account" onClose={close}>
      <div className="mhd">
        <h3>Add email account</h3>
        <button type="button" className="ib" onClick={close} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="mbd">
        {real ? (
          <>
            <button type="button" className="acitem" style={item} onClick={() => st.addAccount('Gmail')}>
              <AcDot color="#3F6FD8" initial="G" />
              <span className="acmeta">
                <b>Continue with Google</b>
                <span>Gmail / Google Workspace · read, label and send on approval</span>
              </span>
            </button>
            <div className="acitem" style={{ ...item, borderStyle: 'dashed', opacity: 0.7 }} aria-disabled="true">
              <AcDot color="#0F7C8C" initial="O" />
              <span className="acmeta">
                <b>Outlook / Microsoft 365</b>
                <span>Not set up yet</span>
              </span>
            </div>
            <div className="mut">
              {runtime.mock
                ? 'Mock Google is active: sign-in completes instantly with a demo mailbox.'
                : "You'll be sent to Google to approve access, then back here. Tokens stay on the server. Only mail that looks job-related is kept, and nothing is sent without your click."}
            </div>
          </>
        ) : (
          <>
            <div className="act" style={{ fontSize: 12 }}>
              <Icon name="info" />
              <span className="sp">
                <b>Real sign-in isn't configured.</b>{' '}
                {runtime.apiAvailable
                  ? 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env and restart the dev server.'
                  : 'Start the app with its API server (npm run dev) to enable Google sign-in.'}{' '}
                See README → Connect your Gmail. The options below add fictional accounts.
              </span>
            </div>
            <button type="button" className="acitem" style={item} onClick={() => st.addAccount('Gmail')}>
              <AcDot color="#3F6FD8" initial="G" />
              <span className="acmeta">
                <b>Add a fictional Gmail account</b>
                <span>Demo data only, no sign-in</span>
              </span>
            </button>
            <button type="button" className="acitem" style={item} onClick={() => st.addAccount('Outlook')}>
              <AcDot color="#0F7C8C" initial="O" />
              <span className="acmeta">
                <b>Add a fictional Outlook account</b>
                <span>Demo data only, no sign-in</span>
              </span>
            </button>
          </>
        )}
        <div className="acitem" style={{ border: '1px dashed var(--bd)', padding: 11, opacity: 0.7 }} aria-disabled="true">
          <AcDot color="var(--tx3)" initial="I" />
          <span className="acmeta">
            <b>Other IMAP provider</b>
            <span>Coming later</span>
          </span>
        </div>
      </div>
    </Modal>
  );
}

/** A new email, not a reply: a floating window in the corner like a mail client's compose box. */
function NewMessage() {
  const st = useStore();
  const from = st.accts.find((a) => a.id === st.newFrom);
  // Suggest your other connected accounts first, then everyone you have mail with.
  const others = st.accts.filter((a) => a.id !== st.newFrom).map((a) => a.addr);
  const people = Array.from(new Set(st.emails.flatMap((e) => e.peers || []))).filter((x) => !others.includes(x) && x !== from?.addr).sort();
  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) st.sendNew();
  };
  return (
    <section className="newmsg" aria-label="New message" onKeyDown={onKey}>
      <div className="nmh">
        <b>{st.newSubject.trim() || 'New message'}</b>
        <button type="button" className="ib" onClick={st.closeNew} aria-label="Discard new message">
          <Icon name="x" sm />
        </button>
      </div>
      <label className="nmr">
        <span className="k">From</span>
        <select className="sel" value={st.newFrom} onChange={(ev) => st.patch({ newFrom: ev.target.value })} aria-label="Send from account">
          {st.accts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.sendAs ? a.sendAs + ' <' + a.addr + '>' : a.addr}
            </option>
          ))}
        </select>
      </label>
      <label className="nmr">
        <span className="k">To</span>
        <input
          type="text"
          list="nm-people"
          value={st.newTo}
          onChange={(ev) => st.patch({ newTo: ev.target.value })}
          placeholder="name@example.com, separate several with commas"
          autoFocus
          aria-label="Recipients"
        />
        <datalist id="nm-people">
          {others.concat(people).map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </label>
      <label className="nmr">
        <span className="k">Subject</span>
        <input type="text" value={st.newSubject} onChange={(ev) => st.patch({ newSubject: ev.target.value })} aria-label="Subject" />
      </label>
      <textarea value={st.newBody} onChange={(ev) => st.patch({ newBody: ev.target.value })} aria-label="Message body" placeholder="Write your message" />
      <div className="nmf">
        <button type="button" className="btn pri" onClick={st.sendNew} disabled={st.newSending}>
          <Icon name="send" sm />
          {st.newSending ? 'Sending…' : 'Send'}
        </button>
        <span className="mut" style={{ flex: 1 }}>
          {provider.isDemo ? 'Demo: nothing is delivered.' : 'Ctrl+Enter to send'}
        </span>
        <button type="button" className="btn ghost sm" onClick={st.closeNew}>
          Discard
        </button>
      </div>
    </section>
  );
}
