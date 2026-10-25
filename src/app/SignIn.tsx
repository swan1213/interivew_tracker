import { useState } from 'react';
import { runtime } from '@/data/runtime';
import { Icon } from '@/ui/Icon';

/** Shown instead of the app when the server needs a signed-in team member. */
export function SignIn() {
  const [as, setAs] = useState('');
  let dark = false;
  try {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    /* matchMedia unavailable */
  }
  const go = () => window.location.assign('/api/auth/login' + (runtime.mock && as.trim() ? '?as=' + encodeURIComponent(as.trim()) : ''));

  return (
    <div className={'if' + (dark ? ' dark' : '')} style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg)', color: 'var(--tx)' }}>
      <main className="card acc" style={{ width: 'min(400px, 100%)', padding: 24, gap: 14 }} aria-labelledby="signin-title">
        <div className="ln">
          <span className="logo">
            <Icon name="flow" />
          </span>
          <b style={{ fontSize: 15, fontWeight: 650 }}>InterviewFlow AI</b>
        </div>
        <div>
          <h1 id="signin-title" style={{ margin: 0, fontSize: 19, fontWeight: 650, letterSpacing: '-.015em' }}>
            Sign in
          </h1>
          <p className="mini" style={{ margin: '4px 0 0' }}>
            Use the Google account an admin added to this workspace.
          </p>
        </div>
        {runtime.authError && (
          <div role="alert" className="act" style={{ fontSize: 12.5 }}>
            {runtime.authError}
          </div>
        )}
        {runtime.mock && (
          <div>
            <label className="fl" htmlFor="signin-as">
              Email (mock Google)
            </label>
            <input
              id="signin-as"
              className="inp"
              type="email"
              value={as}
              placeholder="Leave empty to sign in as the owner"
              onChange={(e) => setAs(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
            />
          </div>
        )}
        <button type="button" className="btn pri" onClick={go} style={{ justifyContent: 'center', height: 36 }}>
          {runtime.mock ? 'Sign in (mock Google)' : 'Continue with Google'}
        </button>
        <p className="mut" style={{ margin: 0 }}>
          Only people on the team can sign in. Admins add people under Team &amp; roles.
        </p>
      </main>
    </div>
  );
}
