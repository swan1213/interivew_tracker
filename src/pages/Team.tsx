import { useEffect, useState } from 'react';
import { useStore } from '@/store/store';
import { provider } from '@/data/provider';
import type { Role } from '@/data/types';
import { ROLES, roleChangeError, removeMemberError } from '@/lib/roles';
import { Icon } from '@/ui/Icon';
import { AcDot, RoleChip } from '@/ui/bits';

const COLORS: Record<Role, string> = { admin: '#4F46E5', member: '#15803D', guest: '#6B7390' };

export function Team() {
  const st = useStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [err, setErr] = useState('');
  const loadTeam = st.loadTeam;
  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const add = async () => {
    const e = await st.addMember(name, email, role);
    setErr(e);
    if (!e) {
      setName('');
      setEmail('');
      setRole('member');
    }
  };

  return (
    <div className="scroll">
      <div className="ph">
        <div>
          <h1>Team &amp; roles</h1>
          <p>Choose who can see what in this workspace. Only admins can add people or change roles.</p>
        </div>
      </div>
      <div className="setg">
        <section className="card acc" aria-label="Members">
          <b style={{ fontWeight: 650 }}>Members</b>
          <div>
            {st.members.map((m) => {
              const me = m.id === st.meId;
              const removeBlock = removeMemberError(st.members, m.id, st.meId);
              return (
                <div className="srow" key={m.id}>
                  <AcDot color={COLORS[m.role]} initial={(m.name.trim().charAt(0) || '?').toUpperCase()} size={28} />
                  <div className="tx">
                    <b>
                      {m.name}
                      {me && (
                        <span className="tag" style={{ marginLeft: 6 }}>
                          You
                        </span>
                      )}
                      {m.owner && (
                        <span className="tag" style={{ marginLeft: 6 }} title="Set by ADMIN_EMAIL on the server">
                          Owner
                        </span>
                      )}
                    </b>
                    <span>{m.email || 'No email set'}</span>
                  </div>
                  <select
                    className="sel"
                    style={{ height: 30 }}
                    value={m.role}
                    onChange={(e) => st.setMemberRole(m.id, e.target.value as Role)}
                    aria-label={'Role for ' + m.name}
                  >
                    {ROLES.map((r) => (
                      <option key={r.k} value={r.k} disabled={!!roleChangeError(st.members, m.id, r.k)}>
                        {r.l}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="ib"
                    disabled={!!removeBlock}
                    title={removeBlock || 'Remove ' + m.name}
                    aria-label={'Remove ' + m.name}
                    onClick={() => st.ask('removeMember', 'Remove ' + m.name + '?', m.name + ' will lose access to this workspace. You can add them again later.', 'Remove', m.id)}
                    style={removeBlock ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
                  >
                    <Icon name="x" sm />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card acc" aria-label="Add a person">
          <b style={{ fontWeight: 650 }}>Add a person</b>
          <div>
            <label className="fl" htmlFor="tm-name">
              Name
            </label>
            <input id="tm-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label className="fl" htmlFor="tm-email">
              Email
            </label>
            <input
              id="tm-email"
              className="inp"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="fl" htmlFor="tm-role">
              Role
            </label>
            <select id="tm-role" className="sel" style={{ width: '100%', height: 32 }} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r.k} value={r.k}>
                  {r.l}
                </option>
              ))}
            </select>
          </div>
          {err && (
            <div className="mini" role="alert" style={{ color: 'var(--bad)' }}>
              {err}
            </div>
          )}
          <div>
            <button type="button" className="btn pri sm" onClick={add}>
              <Icon name="plus" sm />
              Add person
            </button>
          </div>
        </section>

        <section className="card acc" aria-label="What each role can do">
          <b style={{ fontWeight: 650 }}>What each role can do</b>
          {ROLES.map((r) => (
            <div className="srow" key={r.k}>
              <RoleChip role={r.k} />
              <div className="tx">
                <span>{r.desc}</span>
              </div>
            </div>
          ))}
          <div className="mut">
            {provider.isDemo
              ? 'Demo workspace: roles are previewed in this browser. Switch user from the avatar menu.'
              : 'People sign in with Google using the email listed here. The server checks the role on every request, so a change applies right away.'}
          </div>
        </section>
      </div>
    </div>
  );
}
