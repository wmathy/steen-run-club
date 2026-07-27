# Steen Run Club

Multi-user web app for **Steen Run Club**: each person gets a persistent, personalized running-coach conversation (assessment → periodized plans → daily feedback → dynamic adjustments → recovery advice), plus a run log, structured training plans, dashboard, and optional Google Calendar / Strava sync.

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind CSS
- **xAI Grok** via Vercel AI SDK (`ai` + `@ai-sdk/xai`), model `grok-4.5`
- **Auth**: email/password (bcrypt) + encrypted session cookies (`iron-session`)
- **DB**: Prisma + SQLite (local), Postgres-ready for production
- **Tools**: coach can `save_run`, `save_or_update_plan`, `get_recent_runs`, `get_current_plan`, `update_coach_profile`, `create_calendar_events`

## Quick start

```bash
cd running-coach
cp .env.example .env
# Add your XAI_API_KEY and a long SESSION_SECRET (>= 32 chars)

npm install
npx prisma db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and start chatting with the coach.

### Required env vars

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | SQLite path or Postgres URL |
| `SESSION_SECRET` | Iron-session encryption key (min 32 chars) |
| `XAI_API_KEY` | xAI API key (server-only) |

### Optional Google Calendar

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | e.g. `http://localhost:3000/api/calendar/callback` |
| `NEXT_PUBLIC_APP_URL` | App origin for redirects |

Without Google credentials, the Settings page shows a clear scaffold/“coming soon” state. Plans still work fully in-app.

### Optional Strava (auto-import runs)

| Variable | Purpose |
|----------|---------|
| `STRAVA_CLIENT_ID` | From [Strava API settings](https://www.strava.com/settings/api) |
| `STRAVA_CLIENT_SECRET` | App secret |
| `STRAVA_REDIRECT_URI` | e.g. `http://localhost:3000/api/strava/callback` |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Shared secret for webhook subscription (production auto-sync) |

1. Create an API application at https://www.strava.com/settings/api  
2. Set **Authorization Callback Domain** to `localhost` (dev) or your production domain (no `https://`)  
3. Put Client ID / Secret in `.env` and restart the server  
4. In Steen Run Club: **Settings → Connect Strava** (imports last ~30 days of runs)  
5. **Sync now** pulls newer activities on demand  

**COROS users:** connect COROS → Strava in the COROS app, then connect Strava → Steen Run Club.

**Webhooks (true push after each activity):** require a public HTTPS URL. After deploy:

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=$STRAVA_CLIENT_ID \
  -F client_secret=$STRAVA_CLIENT_SECRET \
  -F callback_url=https://YOUR_DOMAIN/api/strava/webhook \
  -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
```

Locally, use **Sync now** (webhooks need a tunnel like ngrok for localhost).

## Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run start    # start production server
npx prisma db push          # sync schema (dev)
npx prisma migrate dev      # named migrations (optional)
npx prisma studio           # browse data
```

## Database (Postgres)

This app uses **Postgres** (via Prisma + `@prisma/adapter-pg`).  
SQLite is not used — Vercel serverless needs a hosted database.

**Recommended free option:** [Neon](https://console.neon.tech)

1. Create a project → copy the **pooled** connection string  
2. Put it in `.env` as `DATABASE_URL=...`  
3. Run:

```bash
npx prisma db push
npm run dev
```

## Deploy to Vercel (friends can test)

### One-time setup

1. **Postgres (Neon)** — free project, copy connection string  
2. **GitHub** — repo pushed (e.g. `steen-run-club`)  
3. **Vercel** — import the repo from GitHub  

### Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | ✅ | Neon **pooled** URL (`sslmode=require`) |
| `SESSION_SECRET` | ✅ | Random ≥ 32 chars |
| `XAI_API_KEY` | ✅ | xAI key (server only) |
| `NEXT_PUBLIC_APP_URL` | ✅ | `https://your-app.vercel.app` |
| `STRAVA_CLIENT_ID` | optional | Same app as local |
| `STRAVA_CLIENT_SECRET` | optional | |
| `STRAVA_REDIRECT_URI` | optional | `https://your-app.vercel.app/api/strava/callback` |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | optional | Same as local |

After first deploy, update **Strava API** Authorization Callback Domain to your Vercel host (e.g. `your-app.vercel.app` — no `https://`).

### Deploy checklist

- [ ] `SESSION_SECRET` random ≥ 32 chars (unique per environment)
- [ ] `XAI_API_KEY` set (server-only; never `NEXT_PUBLIC_`)
- [ ] `DATABASE_URL` Neon Postgres (not SQLite)
- [ ] `NEXT_PUBLIC_APP_URL` matches the live URL
- [ ] Strava callback domain updated for production host
- [ ] Postgres `DATABASE_URL` (not SQLite) for production
- [ ] Optional Google OAuth vars if calendar sync is needed
- [ ] `NEXT_PUBLIC_APP_URL` and `GOOGLE_REDIRECT_URI` match the deployed origin
- [ ] Do not commit `*.db` or `.env` (gitignored)

## Security notes (MVP)

- **Sessions:** iron-session encrypted cookies; `SESSION_SECRET` required; 14-day maxAge; SameSite=Lax + httpOnly. No server-side session revocation list yet (logout clears cookie on that client).
- **Google tokens:** access/refresh tokens are encrypted at rest with AES-256-GCM using a key derived from `SESSION_SECRET`. Residual risk: if an attacker has both the database and `SESSION_SECRET`, tokens can be recovered. Protect backups and secrets accordingly.
- **Google OAuth state:** signed HMAC state bound to the logged-in session nonce (CSRF / account-linking protection).
- **Rate limits:** in-memory per IP/user for auth and chat (resets on process restart; use Redis for multi-instance production).
- **Chat history:** server loads prior messages from the DB and only appends the latest user turn — clients cannot rewrite history.
- **SQLite files:** `*.db` is gitignored; never commit local databases (password hashes, messages, tokens).

## Features

- **Auth** — sign up / login / logout; data isolated per user
- **Coach chat** — streaming Grok responses with tool calling and persisted history
- **Run log** — manual entry + coach `save_run` tool
- **Training plans** — weeks/days/workouts stored when coach calls `save_or_update_plan`
- **Dashboard** — 7/30-day mileage, recent runs, upcoming workouts
- **Coach memory** — `CoachProfile` injected into system prompt; editable in Settings
- **Google Calendar** — OAuth scaffolding + event create helper when configured

## Future ideas

- Strava / Garmin / Coros import
- Wearable HR / pace analytics
- Push notifications for workouts
- Shared training groups

## Safety note

The coach system prompt forbids encouraging training through injury and recommends medical care when appropriate. This is not medical advice.
