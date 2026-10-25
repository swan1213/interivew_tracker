import { ApiMailProvider, type ApiHealth, type SessionUser } from './apiProvider';
import { setProvider } from './provider';

export interface Runtime {
  /** The API responded, so a server is present. */
  apiAvailable: boolean;
  /** Google sign-in can run (credentials set, or mock mode). */
  configured: boolean;
  mock: boolean;
  /** An Anthropic key is set on the server, so classification uses the model. */
  ai: boolean;
  /** The server requires sign-in. */
  auth: boolean;
  /** Who is signed in, or null. */
  user: SessionUser | null;
  /** Why sign-in failed or access was refused, shown on the sign-in screen. */
  authError: string;
}

export const runtime: Runtime = { apiAvailable: false, configured: false, mock: false, ai: false, auth: false, user: null, authError: '' };

/** Ask the server what it can do and pick the matching provider. Falls back to the demo. */
export async function detectRuntime(): Promise<Runtime> {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (!r.ok) return runtime;
    const h = (await r.json()) as ApiHealth;
    runtime.apiAvailable = true;
    runtime.configured = !!h.configured;
    runtime.mock = !!h.mock;
    runtime.ai = !!h.ai;
    if (h.configured) {
      setProvider(new ApiMailProvider(h));
      runtime.auth = true;
      const q = new URLSearchParams(window.location.search);
      const err = q.get('auth_error');
      if (err) {
        runtime.authError = err;
        q.delete('auth_error');
        window.history.replaceState(null, '', window.location.pathname + (q.toString() ? '?' + q.toString() : ''));
      }
      const me = await fetch('/api/auth/me', { cache: 'no-store' });
      const body = (await me.json().catch(() => ({}))) as { user?: SessionUser; error?: string };
      if (me.ok && body.user) runtime.user = body.user;
      else if (me.status === 403 && body.error) runtime.authError = body.error;
    }
  } catch {
    /* No API (static hosting, preview): stay on the demo provider. */
  }
  return runtime;
}
