import { useStore } from '@/store/store';
import { unreadCount, visibleAll } from '@/store/selectors';
import { provider } from '@/data/provider';
import { runtime } from '@/data/runtime';
import { Icon } from '@/ui/Icon';
import { AcDot, Fact } from '@/ui/bits';

export function Accounts() {
  const st = useStore();
  const all = visibleAll(st.emails, st.accts);
  const real = !provider.isDemo;
  return (
    <div className="scroll">
      <div className="ph">
        <div>
          <h1>Connected accounts</h1>
          <p>
            Unified inbox plus a separate inbox per account.
            {real ? ' Google sign-in through OAuth; tokens stay on the server and are never sent to the browser.' : ' Demo only: no real OAuth happens here.'}
          </p>
        </div>
        <button type="button" className="btn pri" onClick={() => st.patch({ addAcctOpen: true })}>
          <Icon name="plus" sm />
          Add account
        </button>
      </div>
      <div className="dgrid">
        {st.accts.map((a) => (
          <section className="card acc" key={a.id}>
            <div className="ln">
              <AcDot color={a.color} initial={a.initial} size={34} style={{ fontSize: 14, borderRadius: 9 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontWeight: 650 }}>{a.label}</b>
                <div className="mini">{a.addr}</div>
              </div>
              <span className="tag">{a.provider}</span>
            </div>
            <div className="fgrid" style={{ margin: 0 }}>
              <Fact label="Sync">{a.sync}</Fact>
              <Fact label="Unread">{unreadCount(all, a.id)}</Fact>
              <Fact label="Send-as identity">{a.sendAs}</Fact>
              <Fact label="Permissions">{real ? 'Read, label, send on approval' : 'Read, send on approval'}</Fact>
            </div>
            <div className="ln wrap">
              <button type="button" className="btn sm" onClick={() => st.refreshAccount(a.id)}>
                <Icon name="refresh" sm />
                Refresh
              </button>
              <button type="button" className="btn sm" onClick={() => st.go('inbox', { view: 'inbox', acctFilter: a.id })}>
                View inbox
              </button>
              <button
                type="button"
                className="btn sm dng"
                onClick={() =>
                  st.ask(
                    'disconnect',
                    'Disconnect ' + a.addr + '?',
                    real
                      ? 'This revokes the Google token and deletes the mail synced for this account from the server and this browser.'
                      : 'In production this revokes access tokens and deletes the synced messages for this account. In this demo it removes its fictional mail.',
                    'Disconnect',
                    a.id,
                  )
                }
              >
                Disconnect
              </button>
            </div>
          </section>
        ))}
        {st.accts.length === 0 && (
          <section className="card acc">
            <b style={{ fontWeight: 650 }}>No accounts connected</b>
            <div className="mini">{real ? 'Add your Gmail to start syncing recruiter mail.' : 'Add a Gmail or Outlook account to start syncing recruiter mail.'}</div>
            <div>
              <button type="button" className="btn pri sm" onClick={() => st.patch({ addAcctOpen: true })}>
                <Icon name="plus" sm />
                Add account
              </button>
            </div>
          </section>
        )}
        <section className="card acc">
          <b style={{ fontWeight: 650 }}>{real ? 'How this works' : 'Security design (production path)'}</b>
          <ul className="mini" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>OAuth with minimum scopes; tokens never reach the browser</li>
            <li>Encrypted token storage with server-side refresh</li>
            <li>User-isolated mail data; disconnect deletes synced data</li>
            <li>AI replies are drafts only; sending always needs your click</li>
            {real && <li>Classification: {runtime.ai ? 'Claude reads each recruiter email and extracts the details' : 'keyword rules (add ANTHROPIC_API_KEY to use Claude)'}</li>}
            {real && runtime.mock && <li>Mock Google is active: sign-in is simulated and the mailbox is demo data</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
