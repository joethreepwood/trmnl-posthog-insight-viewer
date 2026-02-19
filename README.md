# TRMNL PostHog Insight Viewer

A TRMNL plugin that fetches a public PostHog shared insight and renders it on your TRMNL e-ink display (800×480, black and white).

## Features

- Displays the primary metric from any PostHog shared insight (Trends, Funnels, Retention, etc.)
- Renders an SVG sparkline for trend data
- Uses TRMNL's design system classes for crisp e-ink rendering
- Per-user settings stored in a local SQLite database
- Full TRMNL OAuth install / uninstall flow

---

## Project structure

```
index.js        — Express server (all route handlers)
db.js           — SQLite helpers (better-sqlite3)
posthog.js      — Fetches and parses PostHog shared insight API
markup.js       — Renders TRMNL-compatible HTML markup
.env.example    — Environment variable template
.gitignore
README.md
```

---

## Running locally with ngrok

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your TRMNL credentials (see "Register the plugin" below for where to get them).

```env
TRMNL_CLIENT_ID=your_client_id
TRMNL_CLIENT_SECRET=your_client_secret
PORT=3000
```

### 3. Start the server

```bash
npm start
```

Or with auto-reload during development (Node 18+):

```bash
npm run dev
```

### 4. Expose it with ngrok

```bash
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL — this is your **plugin base URL**.

### 5. Test endpoints manually

| Endpoint | Purpose |
|---|---|
| `GET /health` | Smoke test |
| `GET /install?token=TEST&installation_callback_url=http://localhost` | Simulates OAuth install |
| `GET /markup?plugin_setting_id=TEST` | Preview the markup output |
| `GET /settings?plugin_setting_id=TEST` | Open the settings form |

---

## Registering the plugin on TRMNL

1. Log in to [usetrmnl.com](https://usetrmnl.com) and go to **Developers → New Plugin**.
2. Set the plugin name (e.g. "PostHog Insight").
3. Under **OAuth**, fill in:
   - **Redirect URI / Install URL**: `https://your-ngrok-url.ngrok-free.app/install`
   - **Webhook URL (Install success)**: `https://your-ngrok-url.ngrok-free.app/install/success`
   - **Settings URL**: `https://your-ngrok-url.ngrok-free.app/settings`
   - **Uninstall URL**: `https://your-ngrok-url.ngrok-free.app/uninstall`
4. Under **Markup**, set the **Polling URL** to:
   `https://your-ngrok-url.ngrok-free.app/markup`
5. Save. TRMNL will show you a **Client ID** and **Client Secret** — copy them into your `.env`.
6. Click **Install Plugin** on your TRMNL account to trigger the OAuth flow.
7. After install, open the **Settings** URL, paste your PostHog shared insight URL, and save.

### Getting a PostHog shared insight URL

1. Open any insight in PostHog.
2. Click **Share** (top-right) → enable **Share publicly**.
3. Copy the link — it looks like `https://app.posthog.com/shared/AbCdEfGh123`.

Paste that URL into the plugin's settings form.

---

## Deploying to Render (free tier)

Render's free web services spin down after inactivity but work fine for TRMNL plugins (TRMNL polls on its own schedule).

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create trmnl-ph-insight-viewer --public --push --source .
```

### 2. Create a new Web Service on Render

1. Go to [render.com](https://render.com) and click **New → Web Service**.
2. Connect your GitHub repo.
3. Set:
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
4. Under **Environment Variables**, add:
   - `TRMNL_CLIENT_ID`
   - `TRMNL_CLIENT_SECRET`
   - `PORT` → `10000` (Render's default)

### 3. Persistent disk for SQLite

Free Render services have an ephemeral filesystem — the SQLite file is lost on every deploy/restart.

**Option A (quick, fine for testing):** Accept data loss on restart. User settings will need to be re-entered after deploys.

**Option B (recommended for production):** Add a Render **Disk**:
1. In your service settings, go to **Disks → Add Disk**.
2. Mount path: `/data`
3. Set `DB_PATH=/data/data.sqlite` in environment variables.

### 4. Update plugin URLs on TRMNL

Replace the ngrok URLs with your `https://your-service.onrender.com` URL in the TRMNL developer settings.

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `TRMNL_CLIENT_ID` | Yes | OAuth client ID from TRMNL developer portal |
| `TRMNL_CLIENT_SECRET` | Yes | OAuth client secret from TRMNL developer portal |
| `PORT` | No | Port to listen on (default: `3000`) |
| `DB_PATH` | No | Path to SQLite file (default: `./data.sqlite`) |

---

## How it works

1. **Install**: TRMNL sends the user to `/install?token=…&installation_callback_url=…`. The server exchanges the token for a permanent access token via TRMNL's OAuth endpoint and stores it in SQLite.
2. **Settings**: The user visits `/settings?plugin_setting_id=…`, pastes their PostHog shared URL, and saves.
3. **Markup**: TRMNL polls `/markup?plugin_setting_id=…` on its refresh schedule. The server fetches the PostHog shared insight API, extracts the key metric, and returns TRMNL-compatible HTML markup with a sparkline.
4. **Uninstall**: TRMNL calls `/uninstall` and the installation record is deleted.

## License

MIT
