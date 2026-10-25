# InterviewFlow AI

A unified job-search inbox. It pulls recruiter mail from several accounts into one place, classifies each message (interview invitation, availability request, confirmation, offer, rejection, automated, …), extracts the facts that matter (company, role, stage, deadline, meeting times), drafts replies you approve before anything is sent, and keeps an application tracker and interview calendar in step with the mail.

This repository implements the InterviewFlow AI design canvas as a React + TypeScript single-page app. It ships with a **demo mail provider** that holds fictional data in the browser; connecting real Gmail or Outlook accounts requires an OAuth backend (see *Production path*).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve dist/ locally
npm test           # vitest: logic tests + DOM render tests
npm run typecheck  # tsc --noEmit
```

Requires Node 20 or newer.

## What's in the app

| Page | Route | What it does |
| --- | --- | --- |
| Dashboard | `/` | KPIs, AI daily briefing built from live data, priority inbox, pipeline bars, today's schedule, upcoming interviews with "not on calendar" and "reschedule requested" warnings, recent activity. |
| Unified inbox | `/inbox`, `/inbox/:view` | Smart views (Action Required, Invitations, Availability, Updates, Confirmations, Offers, Rejections, Automated), saved filters, account/category/priority/company/date/interview-status filters, sort, search. Detail pane shows routing (received-in / replies-from), next action with one-click actions, AI Insights (summary, extracted fields, stated facts vs. unverified assumptions, confidence), the thread, the AI reply assistant (tone, regenerate, shorter, more professional) and a composer with a confirm-before-send dialog. |
| Calendar | `/calendar`, `/calendar/:view` | Month, week, day and agenda views. Interviews are draggable in week/day; drops snap to 30 minutes and report conflicts. Availability window shaded. Event panel: reminders, rename, nudge ±30 min, open email, reschedule, remove. Time-zone switch (ET/PT/UTC). |
| Application tracker | `/tracker` | Kanban over ten stages. Drag cards between columns (manual moves are locked and never overwritten by AI). AI suggestions can be accepted or dismissed. Drawer with status, timeline, notes, reminder, linked email. |
| Analytics | `/analytics` | Email status by account (range + account filters), status mix, interviews per account, KPI tiles, weekly activity, applications by status/company, email activity by account. |
| Connected accounts | `/accounts` | Per-account cards (sync, unread, send-as identity, permissions), refresh, view inbox, disconnect (removes that account's mail), add account dialog. |
| Team & roles | `/team` | Admins only. Members list with a role per person (admin, member, guest), add a person by Google email, change a role, remove a person. The owner (`ADMIN_EMAIL`) is always an admin. |
| Settings | `/settings` | Profile, time zone, theme (light/dark/system), interview availability (days + window), notification toggles, reminder defaults, AI classification options, default reply tone, sync frequency, delete/reset demo data. |

Roles: **admin** sees everything and manages roles; **member** sees everything except *Team & roles*; **guest** sees only *Analytics* (no inbox, calendar, tracker, accounts, settings, search, sync or notifications). Any other page a guest opens, by link, back button or URL, lands on Analytics.

With Google configured, everyone signs in with Google and the **server enforces the role on every API request**; see *Sign-in and roles* below. In the demo (no server credentials) there is no sign-in, and the avatar menu switches between three fictional people to preview each role.

Scheduling flow: an availability request opens a slot picker constrained to the dates the recruiter named, your availability window and your calendar (conflicting slots are crossed out). Choosing the requested number of slots generates a reply in the composer. Sending marks the thread *Awaiting confirmation* and moves the application to *Interview Scheduling*; nothing is ever marked confirmed until the recruiter confirms. A reschedule request offers exactly the recruiter's options; the original event stays on the calendar until confirmed.

Preferences and workspace state persist in `localStorage` (`iflow.prefs.v1`, `iflow.data.v1`). *Settings → Reset demo workspace* restores the sample data.

## Project layout

```
src/
  data/        types, constants (categories, stages, icons), demo dataset, MailProvider interface + DemoMailProvider
  lib/         pure logic: time/zone helpers, inbox filtering & search, calendar conflicts, reply generation, slot picker model, storage
  store/       zustand store (all state + actions), URL ↔ page mapping, shared selectors
  app/         App shell, Sidebar, TopBar, hooks (URL sync, Escape, click-outside)
  pages/       Dashboard, Inbox, Calendar, Tracker, Analytics, Accounts, Settings
  modals/      Schedule, Add-to-calendar, Confirm-send, Confirm, Add-account
  ui/          Icon and small presentational pieces (chips, priority bars, switches, modal frame)
  styles/      app.css: the design system from the canvas (CSS variables, light/dark)
```

The demo clock is pinned to **Monday, Oct 26 2026** so the sample inbox and calendar stay coherent; a real provider returns the actual date from `clock()`.

## Connect your Gmail

Out of the box the app runs on demo data. Real Gmail needs a Google OAuth client; the app's own server (started by `npm run dev` alongside Vite) handles the sign-in, keeps the tokens, syncs mail through the Gmail API, classifies it, and sends replies you approve.

1. **Create the OAuth client** in [Google Cloud Console](https://console.cloud.google.com/):
   - Create or pick a project, then *APIs & Services → Library* and enable the **Gmail API**.
   - *APIs & Services → OAuth consent screen*: External, fill in the app name and your email, add the scope `https://www.googleapis.com/auth/gmail.modify`, and add your own Gmail address under **Test users**.
   - *APIs & Services → Credentials → Create credentials → OAuth client ID*, type **Web application**. Add the authorized redirect URI `http://localhost:5173/api/auth/google/callback` (replace the origin if `APP_URL` differs).
2. **Configure the app**: copy `.env.example` to `.env`, paste `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, keep `APP_URL=http://localhost:5173`.
3. **Run** `npm run dev`, open the app, go to *Connected accounts → Add account → Continue with Google*. Approve the consent screen; Google warns that the app is unverified while it is in testing status, which is expected for a personal app. You land back on the accounts page and the first sync starts.

What happens next:

- Sync pulls the last 60 days of mail (`GMAIL_SYNC_QUERY`), keeps only messages with a job-search signal (`GMAIL_JOB_FILTER`), and classifies each thread. Opening a message marks it read in Gmail; starring and archiving write back too.
- Classification uses **keyword rules** by default. Set `ANTHROPIC_API_KEY` to have Claude read each recruiter email and fill in category, summary, stated facts vs. assumptions, meeting times and deadlines (model: `ANTHROPIC_MODEL`, default `claude-opus-5-5`).
- Replies are sent through the Gmail API in the original thread, only when you click *Send now*.
- *Disconnect* revokes the token and deletes the mail cached for that account.

Notes and limits:

- While the Google app is in **Testing** status, refresh tokens expire after 7 days and you must connect again. Publishing the app (and passing Google's verification for the Gmail scope) removes that limit; a Google Workspace account can instead mark the app *Internal*.
- Tokens are encrypted at rest in `server/data/` (key in `server/data/secret.key` or `TOKEN_SECRET`). That folder is ignored by git.
- Outlook / Microsoft 365 is not wired yet; the provider interface is ready for it.
- `npm run dev:mock` runs the same flow against a fake Google (instant sign-in, demo mailbox in Gmail format) for development without credentials.
- Once Google is configured, everyone must sign in; see *Sign-in and roles*.

### Production

`npm run build` then `npm start` serves the built app and the API from one Node process on port 8787 (set `PORT`). Set `APP_URL` to that origin and register `${APP_URL}/api/auth/google/callback` with Google.

### Provider boundary

Everything the UI needs sits behind `MailProvider` in `src/data/provider.ts` (`clock`, `load`, `sync`, `send`, `connectAccount`, `disconnectAccount`, plus optional `markRead`, `setStar`, `archive`). `DemoMailProvider` holds fictional data; `ApiMailProvider` talks to the server. `detectRuntime()` picks one from `/api/health` before the app mounts. The server owns the mail and the derived applications and events; the browser owns workflow state (category overrides, done flags, manual kanban moves, notes, calendar additions), merged in `src/store/merge.ts`.

## Sign-in and roles

When Google is configured (or `npm run dev:mock` is running), the app opens on a sign-in screen. People sign in with Google; only addresses on the team get in.

- **Owner.** `ADMIN_EMAIL` (default `winterhot223@gmail.com`, comma-separated for several) is always an admin and can't be demoted or removed, so the workspace can't lock itself out. Sign in with that account first, then add people under *Team & roles*.
- **Server checks.** The session is an HMAC-signed, HttpOnly, SameSite=Lax cookie (7 days) that holds only the email. The role is looked up in `server/data/team.json` on every request, so a role change or removal applies on the next request.
- **What each role may call.** Guest: `/api/snapshot` only, and it receives a redacted copy with no subjects, senders, bodies, summaries, company or role names, notes or meeting links (enough to draw Analytics). Member: also sync, read/star/archive, send replies, connect and disconnect mailboxes. Admin: also `/api/team`.
- **Sign-in uses the same redirect URI** as connecting Gmail (`/api/auth/google/callback`), with identity-only scopes (`openid email profile`). Nothing new to register in Google Cloud.
- **Google testing mode.** While the OAuth app is in *Testing* status, Google only lets listed test users sign in. Add every teammate's Google address under *OAuth consent screen → Test users*, or publish the app.
- **Mock mode.** `npm run dev:mock` shows an email box on the sign-in screen; leave it empty to sign in as the owner, or type a teammate's address to try their role.

## Testing

`npm test` runs 60 tests: pure-logic tests for time, filtering, reply generation and the slot picker; store tests for the end-to-end flows (open/read, schedule → send, add to calendar, kanban moves, drag-drop snapping, disconnect, reset); and DOM render tests that mount the real app in jsdom for every page and modal and drive the main flows through clicks.
