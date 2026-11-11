# FieldProof — release 1

Verified attendance, live checklists and customer sign-off for facility management, cleaning, construction, repair and maintenance companies. Built to the approved functional specification (v0.1).

- **Web app** for admins, supervisors and customers, which also works on phones and can be installed to the home screen (Android and iPhone) for workers, including **offline** check-in and checklists.
- **Backend API and admin dashboard** with GPS-verified check-in, automatic rules, audit log, hours and earnings.
- **Four languages**: English, French, Kreol Morisien and Arabic (full right-to-left layout).

The native iOS/Android store apps are release 2 (spec section 12). The installable web app covers the same worker features today.

## Run it locally

Requires Node.js 20 or newer.

```bash
npm run install:all      # installs server and web dependencies
npm run build            # builds the web app into web/dist
npm run seed             # optional: demo company with 14 days of history
npm start                # http://localhost:3000
```

Demo accounts (password `Demo1234!` for all) after `npm run seed`:

| Role | Email |
| --- | --- |
| Admin | admin@example.com |
| Supervisor | supervisor@example.com, supervisor2@example.com |
| Worker | worker@example.com, ravi@example.com, yusuf@example.com, sophie@example.com, nadia@example.com |
| Customer | customer@example.com, customer2@example.com, customer3@example.com (French) |

For development with hot reload, run `npm run dev:server` and `npm run dev:web` in two terminals and open http://localhost:5173 (the web dev server forwards `/api` to port 3000). Set `APP_URL=http://localhost:5173` in `server/.env` so emailed links point to it.

Without SMTP settings, invitation and reset emails are printed in the server console; admins also see each invitation link on screen to share by SMS or WhatsApp.

## What is built

| Area | Requirements covered |
| --- | --- |
| Accounts | Email + password, invitations by link, password reset, role-based access, 12-hour web sessions or 30 days with "keep me signed in", privacy consent, data export, customer self-deletion (FR-ACC-01, 03–06) |
| Company setup | Services with checklist templates, SLA and default pay; customers and sites with map pin and check-in radius; skills (FR-SET-01–04) |
| Worker pay | Base salary (monthly or hourly), per-job pay (hourly, daily, fixed), worker earnings view, CSV export (FR-PAY-01–04) |
| Jobs | Create (incl. recurring daily/weekly/monthly), assign supervisor with expertise suggestions, assign workers ranked by skill, working days and conflicts, overlap warning, list and week views, calendar export (FR-JOB-01–04, 06) |
| Attendance | GPS check-in with distance, accuracy and verification against the site area, reason required when outside, late flag, check-out, hours (FR-ATT-01–04, 06) |
| Checklist | Tick, photo, note and number items; photos compressed on the phone and stamped with time and place; live progress for customer and supervisor (FR-CHK-01–03) |
| Completion | Submit blocked until required items are done, customer approve (with rating) or reject (reason, comment, photos), rework, admin review after too many rejections (FR-CMP-01–04, 06) |
| Automatic rules | Arrival auto-confirms after 30 min if verified; work auto-approves after 48 h; late alert after 15 min. All configurable per company (BR-01–14) |
| Notifications | In-app (live), email, web push for every status change (FR-NOT-01) |
| Reporting | Dashboard (today, late, flagged, disputes, rework, SLA breaches, 14-day trend, rejection reasons), append-only audit log (FR-RPT-01–02) |
| Offline | Worker actions saved on the phone with device time and GPS and synced in order; replays are ignored by the server (NFR-04, BR-09) |

Not in release 1, as agreed: quotes and online booking, SMS, Google/Apple sign-in, signatures, overtime rules, accounting/CRM integrations, native store apps.

## Architecture

```
fieldproof/
├── server/                 Node.js + Express API, SQLite database
│   ├── src/
│   │   ├── app.js          app wiring, security headers, error handling
│   │   ├── auth.js         sessions (signed http-only cookie), roles, CSRF guard
│   │   ├── scheduler.js    time-based rules (auto-confirm, auto-approve, late alerts)
│   │   ├── migrations/     database schema (001_init.sql)
│   │   ├── lib/            geo-fence maths, earnings, job access rules, email/push/live events, messages
│   │   └── routes/         auth, account, setup (company/people/customers/services), jobs, misc
│   ├── scripts/            seed.js (demo data), vapid.js (push keys)
│   └── test/               API tests for the core loop and rules
└── web/                    React + Vite single-page app, installable (manifest + service worker)
    ├── public/sw.js        offline app shell + push notifications
    ├── src/offline.js      offline outbox for field actions
    ├── src/i18n/           en, fr, mfe (Kreol Morisien), ar
    ├── src/pages/          one file per screen
    └── scripts/check-i18n.mjs  checks every key exists in all four languages
```

**Why this stack.** One Node.js process serves the API and the web app, and SQLite keeps all data in a single file. That runs on the smallest paid server or a free tier, has nothing else to operate, and fits the stated budget. When usage grows, the SQL is standard enough to move to PostgreSQL. Trade-off: one server instance only (no horizontal scaling) until that move.

**Data separation.** Every record carries `company_id`, and every query filters by the signed-in user's company. Customers only see their own jobs; supervisors their own jobs and team; workers the jobs they are assigned to. Tests T9 and T10 check this.

**Integrity.** Attendance, decisions and the audit log cannot be updated or deleted (database triggers). Server time is the source of truth; offline actions keep the device time and are flagged.

## Environment variables

See `server/.env.example`. The important ones:

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Required in production. Signs session cookies. |
| `APP_URL` | Public address, used in email and notification links. |
| `DATABASE_FILE`, `UPLOAD_DIR` | Where data and photos are stored. Back these up. |
| `SMTP_*`, `MAIL_FROM` | Email delivery. Optional; without it emails go to the log. |
| `VAPID_*` | Web push. Generate with `npm --prefix server run vapid`. |
| `SIGNUP_CODE` | If set, registering a new company requires this code. |
| `TRUST_PROXY` | `true` behind a reverse proxy. |

## Tests

```bash
npm test
```

Runs 24 API tests covering the spec's scenarios T1–T13 and rules BR-01–13 (verified and flagged check-ins, offline sync and replay protection, auto-confirm, auto-approve, late alerts, required items and photos, rejection and admin review, overlap warning, one check-in at a time, customer and company isolation, pay calculations, account deletion, append-only records, roles, CSRF and session revocation, dashboard, recurring jobs), then checks all 711 translation keys exist in the four languages.

The core loop was also run end to end in a mobile browser: GPS check-in outside the area with a reason, photo checklist item, an item saved offline and synced, submit, and customer approval.

## Known limitations

- **Native store apps are not built.** Workers use the installable web app. iOS shows web push only when the app is added to the home screen (iOS 16.4+).
- **Camera-only photos cannot be enforced in a browser** (BR-07). The app opens the camera directly on phones, but a determined user could pick a gallery photo. Each photo still records the time and GPS at upload.
- **GPS spoofing apps cannot be detected from a browser.** Mitigations: customer arrival confirmation and flagged check-ins. Detection comes with the native app.
- **Translations** in Kreol Morisien and Arabic need review by native speakers (assumption A6).
- **Maps** use OpenStreetMap tiles and address search, which suit low traffic. For heavy use, switch to a paid tile provider (one line in `web/src/components/SiteMap.jsx`).
- **Earnings are estimates**; payroll stays outside the app (assumption A2).
- **Single server** with SQLite. Fine for the release 1 target (about 20 companies and 1,000 workers).
- **Legal**: retention periods and registration with the Mauritius Data Protection Office need confirmation from your legal adviser before launch.

See `DEPLOY.md` to put it online.
