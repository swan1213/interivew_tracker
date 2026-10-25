import type { Account, DataSnapshot, Member, OutgoingMessage, Role } from './types';
import type { Clock, MailProvider, SyncResult } from './provider';

export interface ApiHealth {
  configured: boolean;
  mock: boolean;
  provider: string;
  ai: boolean;
  /** Sign-in is required (true whenever Google is configured). */
  auth?: boolean;
}

async function call<T>(url: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', json?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    cache: 'no-store',
  });
  const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  // Session expired or access removed: reload so the sign-in screen shows.
  if ((r.status === 401 || data.code === 'not_on_team') && typeof window !== 'undefined' && !url.startsWith('/api/auth/')) window.location.assign('/');
  if (!r.ok) throw new Error(data.error || 'Request failed (' + r.status + ')');
  return data as T;
}

const enc = encodeURIComponent;

/** The signed-in person, as the server reports it. */
export interface SessionUser { email: string; name: string; role: Role; owner: boolean }
export interface ServerMember { email: string; name: string; role: Role; owner?: boolean }

/** Server team rows use the email as the id. */
export const toMember = (m: ServerMember): Member => ({ id: m.email, name: m.name, email: m.email, role: m.role, owner: !!m.owner });

/** Sign-in session and team management. The server enforces the role on every call. */
export const authApi = {
  me: () => call<{ user: SessionUser }>('/api/auth/me'),
  logout: () => call<{ ok: boolean }>('/api/auth/logout', 'POST', {}),
  team: () => call<{ team: ServerMember[] }>('/api/team'),
  addMember: (name: string, email: string, role: Role) => call<{ team: ServerMember[] }>('/api/team', 'POST', { name, email, role }),
  setRole: (email: string, role: Role) => call<{ team: ServerMember[] }>('/api/team/' + enc(email), 'PATCH', { role }),
  removeMember: (email: string) => call<{ team: ServerMember[] }>('/api/team/' + enc(email), 'DELETE'),
};

/** Talks to the server, which owns OAuth tokens and the Gmail sync. */
export class ApiMailProvider implements MailProvider {
  readonly id = 'gmail';
  readonly isDemo = false;

  constructor(readonly health: ApiHealth) {}

  clock(): Clock {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return { today: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), nowHour: d.getHours() + d.getMinutes() / 60 };
  }

  async load(): Promise<DataSnapshot> {
    return (await call<{ snapshot: DataSnapshot }>('/api/snapshot')).snapshot;
  }

  async sync(accountId?: string): Promise<SyncResult> {
    return call<SyncResult>('/api/sync', 'POST', { accountId });
  }

  async send(msg: OutgoingMessage): Promise<{ id: string }> {
    if (!msg.inReplyTo) throw new Error('Nothing to reply to.');
    return call<{ id: string }>('/api/mail/' + enc(msg.inReplyTo) + '/send', 'POST', { accountId: msg.accountId, body: msg.body, mode: msg.mode, to: msg.to });
  }

  async connectAccount(kind: 'Gmail' | 'Outlook'): Promise<Account | null> {
    if (kind !== 'Gmail') throw new Error('Outlook / Microsoft 365 sign-in is not set up yet. Google sign-in is available.');
    window.location.assign('/api/auth/google/start');
    return null;
  }

  async disconnectAccount(id: string): Promise<void> {
    await call('/api/accounts/' + enc(id), 'DELETE');
  }

  async markRead(id: string): Promise<void> {
    await call('/api/mail/' + enc(id) + '/read', 'POST', {});
  }

  async setStar(id: string, on: boolean): Promise<void> {
    await call('/api/mail/' + enc(id) + '/star', 'POST', { on });
  }

  async archive(id: string): Promise<void> {
    await call('/api/mail/' + enc(id) + '/archive', 'POST', {});
  }
}
