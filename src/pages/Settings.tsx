import { useStore } from '@/store/store';
import { provider } from '@/data/provider';
import { DN } from '@/data/constants';
import type { AiKey, NotifKey, ThemePref, Tone, Tz } from '@/data/types';
import { fmtT, hrs, TIME_ZONES, tzOffset } from '@/lib/time';
import { cx } from '@/lib/util';
import { Seg, Switch } from '@/ui/bits';

const NOTIF_ROWS: { k: NotifKey; title: string; desc: string; disabled?: boolean }[] = [
  { k: 'newInvite', title: 'New interview invitations', desc: 'In-app notification' },
  { k: 'avail', title: 'Availability requests', desc: 'In-app notification' },
  { k: 'confirm', title: 'Interview confirmations', desc: 'In-app notification' },
  { k: 'resched', title: 'Reschedules and cancellations', desc: 'In-app notification' },
  { k: 'deadline', title: 'Assessment deadlines', desc: 'In-app notification' },
  { k: 'offer', title: 'Offers', desc: 'In-app notification' },
  { k: 'browser', title: 'Browser notifications', desc: 'Prepared for a future integration', disabled: true },
  { k: 'desktop', title: 'Desktop notifications', desc: 'Prepared for a future integration', disabled: true },
  { k: 'email', title: 'Email digests', desc: 'Prepared for a future integration', disabled: true },
];
const REM_ROWS: { m: string; title: string }[] = [
  { m: '1440', title: '24 hours before' },
  { m: '60', title: '1 hour before' },
  { m: '30', title: '30 minutes before' },
  { m: '10', title: '10 minutes before' },
];
const AI_ROWS: { k: AiKey; title: string; desc: string }[] = [
  { k: 'auto', title: 'Classify new mail automatically', desc: 'Meaning-based, not keyword matching' },
  { k: 'surfaceAuto', title: 'Surface actionable no-reply mail', desc: 'A no-reply sender with a deadline still counts as actionable' },
  { k: 'showConf', title: 'Show confidence scores', desc: 'In the AI Insights panel' },
  { k: 'flagAssume', title: 'Mark AI assumptions separately', desc: 'Stated facts and inferences never mix' },
];
const THEME_TABS: { k: ThemePref; l: string }[] = [
  { k: 'light', l: 'Light' },
  { k: 'dark', l: 'Dark' },
  { k: 'auto', l: 'System' },
];

export function SettingsPage() {
  const st = useStore();
  const S = st.S;
  const off = tzOffset(S.tz);
  const availText = S.whDays.slice().sort().map((d) => DN[d]).join(', ') + ' · ' + fmtT(hrs(S.whStart) + off) + ' to ' + fmtT(hrs(S.whEnd) + off) + ' ' + S.tz;

  return (
    <div className="scroll">
      <div className="ph">
        <div>
          <h1>Settings</h1>
          <p>Preferences are saved in this browser when storage is available.</p>
        </div>
      </div>
      <div className="setg">
        <section className="card acc">
          <b style={{ fontWeight: 650 }}>Profile and time</b>
          <div>
            <label className="fl" htmlFor="nm">
              Display name
            </label>
            <input id="nm" className="inp" value={S.name} onChange={(e) => st.setS((x) => void (x.name = e.target.value))} />
          </div>
          <div>
            <label className="fl" htmlFor="tz2">
              Default time zone
            </label>
            <select id="tz2" className="sel" style={{ width: '100%', height: 32 }} value={S.tz} onChange={(e) => st.setS((x) => void (x.tz = e.target.value as Tz))}>
              {TIME_ZONES.map((z) => (
                <option key={z.k} value={z.k}>
                  {z.l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="fl">Theme</span>
            <Seg value={st.themePref} options={THEME_TABS} onChange={st.setThemePref} ariaLabel="Theme" />
          </div>
        </section>

        <section className="card acc">
          <b style={{ fontWeight: 650 }}>Interview availability</b>
          <div className="stagebox">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = S.whDays.includes(d);
              return (
                <button key={d} type="button" className={cx('tog', on && 'on')} aria-pressed={on} onClick={() => st.setS((x) => void (x.whDays = on ? x.whDays.filter((y) => y !== d) : x.whDays.concat([d])))}>
                  {DN[d]}
                </button>
              );
            })}
          </div>
          <div className="ln wrap">
            <label className="ln mini">
              From
              <input className="inp" style={{ width: 110 }} type="time" value={S.whStart} onChange={(e) => e.target.value && st.setS((x) => void (x.whStart = e.target.value))} />
            </label>
            <label className="ln mini">
              To
              <input className="inp" style={{ width: 110 }} type="time" value={S.whEnd} onChange={(e) => e.target.value && st.setS((x) => void (x.whEnd = e.target.value))} />
            </label>
          </div>
          <div className="mut">
            Used for AI slot suggestions, in {S.tz}. Currently: {availText}
          </div>
        </section>

        <section className="card acc">
          <b style={{ fontWeight: 650 }}>Notifications</b>
          {NOTIF_ROWS.map((r) => (
            <div className="srow" key={r.k}>
              <div className="tx">
                <b>{r.title}</b>
                <span>{r.desc}</span>
              </div>
              <Switch on={S.notif[r.k]} disabled={r.disabled} label={r.title} onToggle={() => st.setS((x) => void (x.notif[r.k] = !x.notif[r.k]))} />
            </div>
          ))}
        </section>

        <section className="card acc">
          <b style={{ fontWeight: 650 }}>Interview reminders</b>
          {REM_ROWS.map((r) => (
            <div className="srow" key={r.m}>
              <div className="tx">
                <b>{r.title}</b>
              </div>
              <Switch on={!!S.rem[r.m]} label={r.title} onToggle={() => st.setS((x) => void (x.rem[r.m] = !x.rem[r.m]))} />
            </div>
          ))}
          <div>
            <label className="fl" htmlFor="cr">
              Custom reminder (minutes before)
            </label>
            <input id="cr" className="inp" type="number" min={1} value={S.customRem} onChange={(e) => st.setS((x) => void (x.customRem = Math.max(1, parseInt(e.target.value, 10) || 15)))} style={{ width: 120 }} />
          </div>
        </section>

        <section className="card acc">
          <b style={{ fontWeight: 650 }}>AI classification and replies</b>
          {AI_ROWS.map((r) => (
            <div className="srow" key={r.k}>
              <div className="tx">
                <b>{r.title}</b>
                <span>{r.desc}</span>
              </div>
              <Switch on={S.ai[r.k]} label={r.title} onToggle={() => st.setS((x) => void (x.ai[r.k] = !x.ai[r.k]))} />
            </div>
          ))}
          <div>
            <label className="fl" htmlFor="rt">
              Default reply tone
            </label>
            <select id="rt" className="sel" style={{ width: '100%', height: 32 }} value={st.tone} onChange={(e) => st.setTone(e.target.value as Tone)}>
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="concise">Concise</option>
              <option value="confident">Confident</option>
            </select>
          </div>
        </section>

        <section className="card acc">
          <b style={{ fontWeight: 650 }}>Sync and privacy</b>
          <div>
            <label className="fl" htmlFor="sy">
              Sync frequency
            </label>
            <select id="sy" className="sel" style={{ width: '100%', height: 32 }} value={S.syncFreq} onChange={(e) => st.setS((x) => void (x.syncFreq = e.target.value))}>
              <option value="1">Every minute</option>
              <option value="5">Every 5 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="manual">Manual only</option>
            </select>
          </div>
          <div className="ln wrap">
            <button type="button" className="btn sm" onClick={st.refreshAll}>
              Sync now
            </button>
            <button
              type="button"
              className="btn sm dng"
              onClick={() => st.ask('clear', 'Delete synced ' + (provider.isDemo ? 'demo ' : '') + 'mail?', provider.isDemo ? 'This removes all fictional messages from this workspace. You can restore them from the inbox.' : 'This removes every synced message from this device. Mail stays on the server.', 'Delete')}
            >
              Delete synced {provider.isDemo ? 'demo ' : ''}data…
            </button>
            {provider.isDemo && (
              <button type="button" className="btn sm" onClick={st.resetDemo}>
                Reset demo workspace
              </button>
            )}
          </div>
          <div className="mut">In production, disconnecting an account removes its synced messages and revokes tokens.</div>
        </section>
      </div>
    </div>
  );
}
