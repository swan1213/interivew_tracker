import type { Account, CalEvent, DataSnapshot, OutgoingMessage } from './types';
import { buildDemoData, DEMO_NOW_HOUR, DEMO_TODAY } from './demo';

export interface Clock {
  /** ISO date the UI treats as "today". */
  today: string;
  /** Current hour of day as a decimal, in ET. */
  nowHour: number;
}
export interface SyncResult {
  newMessages: number;
  errors?: string[];
}

/**
 * Boundary between the UI and a mail backend.
 *
 * `DemoMailProvider` holds fictional data in the browser. `ApiMailProvider`
 * (src/data/apiProvider.ts) talks to the server, which holds Google OAuth
 * tokens and syncs Gmail. The UI does not know which one is active.
 */
export interface MailProvider {
  readonly id: string;
  readonly isDemo: boolean;
  clock(): Clock;
  load(): Promise<DataSnapshot>;
  sync(accountId?: string): Promise<SyncResult>;
  send(msg: OutgoingMessage): Promise<{ id: string }>;
  /** Resolves with the new account, or null when the provider navigated away to sign in. */
  connectAccount(kind: 'Gmail' | 'Outlook', existing: Account[], sendAs: string): Promise<Account | null>;
  disconnectAccount(id: string): Promise<void>;
  markRead?(id: string): Promise<void>;
  setStar?(id: string, on: boolean): Promise<void>;
  archive?(id: string): Promise<void>;
  /** Create or update the interview on the user's Google Calendar. */
  pushEvent?(ev: CalEvent): Promise<void>;
  /** Take the interview off the user's Google Calendar. */
  removeEvent?(id: string): Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class DemoMailProvider implements MailProvider {
  readonly id = 'demo';
  readonly isDemo = true;

  clock(): Clock {
    return { today: DEMO_TODAY, nowHour: DEMO_NOW_HOUR };
  }

  async load(): Promise<DataSnapshot> {
    return buildDemoData();
  }

  async sync(accountId?: string): Promise<SyncResult> {
    await wait(accountId ? 1000 : 1200);
    return { newMessages: 0 };
  }

  async send(_msg: OutgoingMessage): Promise<{ id: string }> {
    await wait(120);
    return { id: 'demo-' + Date.now().toString(36) };
  }

  async connectAccount(kind: 'Gmail' | 'Outlook', existing: Account[], sendAs: string): Promise<Account> {
    await wait(200);
    const n = existing.length + 1;
    const gmail = kind === 'Gmail';
    return {
      id: 'x' + n,
      label: 'New ' + kind + ' account',
      addr: 'new.account' + n + '@' + (gmail ? 'gmail.example' : 'outlook.example'),
      provider: kind,
      color: gmail ? '#3F6FD8' : '#0F7C8C',
      initial: gmail ? 'G' : 'O',
      sendAs,
      sync: 'Synced just now',
    };
  }

  async disconnectAccount(_id: string): Promise<void> {
    /* Demo: nothing to revoke. */
  }
}

/** The active provider. `detectRuntime()` swaps in the API provider before the app mounts. */
export let provider: MailProvider = new DemoMailProvider();

export function setProvider(p: MailProvider): void {
  provider = p;
}
