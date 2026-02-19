#!/usr/bin/env bash
# test-local.sh — start the server and print ngrok setup instructions

set -e

# Resolve the directory this script lives in so it works from any cwd
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT="${PORT:-3000}"

# ── Preflight checks ──────────────────────────────────────────────────────────

if [ ! -f ".env" ]; then
  echo "⚠️  No .env file found. Copying .env.example → .env"
  cp .env.example .env
  echo "   Edit .env and add your TRMNL_CLIENT_ID and TRMNL_CLIENT_SECRET before registering the plugin."
  echo ""
fi

if [ ! -d "node_modules" ]; then
  echo "📦 node_modules not found — running npm install..."
  npm install
  echo ""
fi

# ── ngrok instructions ────────────────────────────────────────────────────────

cat <<'INSTRUCTIONS'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TRMNL PostHog Insight Viewer — Local Dev Setup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To expose this server to TRMNL, run ngrok in a second terminal:

  ngrok http 3000

Then copy the Forwarding URL (e.g. https://abc123.ngrok-free.app)
and use it as the base URL when registering your plugin on TRMNL:

  Install URL         →  https://<ngrok-url>/install
  Install success URL →  https://<ngrok-url>/install/success
  Settings URL        →  https://<ngrok-url>/settings
  Markup/polling URL  →  https://<ngrok-url>/markup
  Uninstall URL       →  https://<ngrok-url>/uninstall

To test /markup without OAuth, seed the database first (separate terminal):

  node seed-test.js [optional-posthog-url]

Then open:

  http://localhost:3000/markup?plugin_setting_id=test
  http://localhost:3000/settings?plugin_setting_id=test

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUCTIONS

echo ""
echo "🚀 Starting server on port $PORT ..."
echo ""

# Start the server (replaces this shell process so Ctrl-C stops it cleanly)
exec node index.js
