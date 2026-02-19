require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch');
const db = require('./db');
const { fetchInsight } = require('./posthog');
const { renderMarkup, renderError, renderNoConfig } = require('./markup');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
  TRMNL_CLIENT_ID,
  TRMNL_CLIENT_SECRET,
  PORT = 3000,
} = process.env;

// ---------------------------------------------------------------------------
// GET /install
// TRMNL redirects the user here with ?token=<code>&installation_callback_url=<url>
// ---------------------------------------------------------------------------
app.get('/install', async (req, res) => {
  const { token, installation_callback_url } = req.query;

  if (!token || !installation_callback_url) {
    return res.status(400).send('Missing token or installation_callback_url');
  }

  try {
    // Exchange the temporary token for a permanent access token
    const tokenRes = await fetch('https://trmnl.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: token,
        client_id: TRMNL_CLIENT_ID,
        client_secret: TRMNL_CLIENT_SECRET,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('Token exchange failed:', tokenRes.status, body);
      return res.status(502).send('Failed to exchange token with TRMNL');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const pluginSettingId = tokenData.plugin_setting_id || tokenData.id;

    if (!accessToken || !pluginSettingId) {
      console.error('Unexpected token response:', tokenData);
      return res.status(502).send('Unexpected response from TRMNL token endpoint');
    }

    // Persist the installation
    db.upsertInstallation(pluginSettingId, accessToken);
    console.log(`Installed: plugin_setting_id=${pluginSettingId}`);

    // Redirect back to TRMNL to complete the install flow
    return res.redirect(installation_callback_url);
  } catch (err) {
    console.error('Install error:', err);
    return res.status(500).send('Internal server error during installation');
  }
});

// ---------------------------------------------------------------------------
// POST /install/success
// TRMNL notifies us when installation is confirmed
// ---------------------------------------------------------------------------
app.post('/install/success', (req, res) => {
  console.log('Install success webhook received:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// GET /settings
// Show a form for the user to enter their PostHog shared insight URL
// ---------------------------------------------------------------------------
app.get('/settings', (req, res) => {
  const { plugin_setting_id, saved, error } = req.query;

  if (!plugin_setting_id) {
    return res.status(400).send('Missing plugin_setting_id');
  }

  const installation = db.getInstallation(plugin_setting_id);
  const currentUrl   = installation ? (installation.posthog_url || '') : '';

  const savedBanner = saved === '1'
    ? `<div class="banner banner--success">✓ Settings saved. Your display will update on the next refresh.</div>`
    : '';
  const errorBanner = error
    ? `<div class="banner banner--error">⚠ ${escAttr(decodeURIComponent(error))}</div>`
    : '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PostHog Insight – Settings</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #111;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 2rem;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
    }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    p.subtitle { font-size: 0.875rem; color: #666; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.875rem; font-weight: 600; margin-bottom: 0.375rem; }
    input[type="url"] {
      width: 100%;
      padding: 0.625rem 0.75rem;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-size: 0.9rem;
      outline: none;
      transition: border-color .15s;
    }
    input[type="url"]:focus { border-color: #1d4ed8; }
    .hint { font-size: 0.75rem; color: #888; margin-top: 0.375rem; line-height: 1.5; }
    button {
      margin-top: 1.25rem;
      width: 100%;
      padding: 0.625rem;
      background: #111;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background .15s;
    }
    button:hover { background: #333; }
    .banner {
      margin-top: 1rem;
      padding: 0.625rem 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
      line-height: 1.5;
    }
    .banner--success {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #166534;
    }
    .banner--error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }
    .examples { margin-top: 0.5rem; font-size: 0.75rem; color: #888; }
    .examples code {
      display: block;
      margin-top: 0.2rem;
      font-family: monospace;
      background: #f3f4f6;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>PostHog Insight Viewer</h1>
    <p class="subtitle">Connect a public PostHog shared insight to your TRMNL display.</p>

    <form method="POST" action="/settings">
      <input type="hidden" name="plugin_setting_id" value="${escAttr(plugin_setting_id)}">

      <label for="posthog_url">PostHog shared insight URL</label>
      <input
        type="url"
        id="posthog_url"
        name="posthog_url"
        placeholder="https://us.posthog.com/shared/AbCdEf123"
        value="${escAttr(currentUrl)}"
        required
        autocomplete="off"
      >
      <p class="hint">
        In PostHog, open an insight → click <strong>Share</strong> → enable public sharing → copy the link.
        The URL must be publicly accessible (no login required).
      </p>
      <div class="examples">
        Accepted formats:
        <code>https://us.posthog.com/shared/&lt;token&gt;</code>
        <code>https://eu.posthog.com/shared/&lt;token&gt;</code>
        <code>https://app.posthog.com/shared/&lt;token&gt;</code>
      </div>

      <button type="submit">Save settings</button>
    </form>
    ${savedBanner}
    ${errorBanner}
  </div>
</body>
</html>`);
});

// ---------------------------------------------------------------------------
// POST /settings
// Save the PostHog URL for this installation
// ---------------------------------------------------------------------------
app.post('/settings', (req, res) => {
  const { plugin_setting_id, posthog_url } = req.body;

  if (!plugin_setting_id) {
    return res.status(400).send('Missing plugin_setting_id');
  }

  const urlError = validatePosthogUrl(posthog_url);
  if (urlError) {
    return res.redirect(
      `/settings?plugin_setting_id=${encodeURIComponent(plugin_setting_id)}` +
      `&error=${encodeURIComponent(urlError)}`
    );
  }

  db.setPosthogUrl(plugin_setting_id, posthog_url.trim());
  console.log(`Settings saved: plugin_setting_id=${plugin_setting_id} url=${posthog_url}`);

  // Redirect back to the settings form with a confirmation
  res.redirect(`/settings?plugin_setting_id=${encodeURIComponent(plugin_setting_id)}&saved=1`);
});

// ---------------------------------------------------------------------------
// POST /markup
// TRMNL polls this endpoint to refresh the plugin display.
//
// Request: application/x-www-form-urlencoded
//   user_uuid  — UUID of the TRMNL user
//   trmnl      — URL-encoded JSON blob with user/device/plugin metadata
//                (includes plugin_setting_id, instance_name, etc.)
//
// Also supports GET with ?plugin_setting_id=... for local dev convenience.
//
// Response: application/json with all 4 layout variants required for
// marketplace publication:
//   markup                  — full screen (800×480)
//   markup_half_vertical    — left half (400×480)
//   markup_half_horizontal  — top half  (800×240)
//   markup_quadrant         — quarter   (400×240)
//   refresh_rate            — seconds between polls
// ---------------------------------------------------------------------------
app.post('/markup', handleMarkup);
app.get('/markup',  handleMarkup); // convenience for local dev / seed-test.js

async function handleMarkup(req, res) {
  // Resolve plugin_setting_id from body (TRMNL production) or query (local dev)
  let pluginSettingId = req.query.plugin_setting_id || null;

  if (!pluginSettingId && req.body) {
    // TRMNL sends: user_uuid=...&trmnl=%7B%22plugin_setting_id%22%3A123%2C...%7D
    try {
      const trmnlRaw = req.body.trmnl;
      if (trmnlRaw) {
        const trmnlData = JSON.parse(
          typeof trmnlRaw === 'string' ? trmnlRaw : JSON.stringify(trmnlRaw)
        );
        pluginSettingId =
          trmnlData.plugin_setting_id ||
          trmnlData.user?.plugin_setting_id ||
          null;
        if (pluginSettingId) pluginSettingId = String(pluginSettingId);
      }
    } catch (e) {
      console.warn('Could not parse trmnl body:', e.message);
    }

    // Fallback: some versions send plugin_setting_id directly in the body
    if (!pluginSettingId && req.body.plugin_setting_id) {
      pluginSettingId = String(req.body.plugin_setting_id);
    }

    // Fallback: user_uuid in body (older TRMNL firmware)
    if (!pluginSettingId && req.body.user_uuid) {
      // Look up by access_token from Authorization header
      const auth = req.headers.authorization || '';
      const token = auth.replace(/^Bearer\s+/i, '').trim();
      if (token) {
        const inst = db.getInstallationByToken(token);
        if (inst) pluginSettingId = inst.plugin_setting_id;
      }
    }
  }

  const noConfigResponse = {
    markup:                 renderNoConfig(),
    markup_half_vertical:   renderNoConfig(),
    markup_half_horizontal: renderNoConfig(),
    markup_quadrant:        renderNoConfig(),
    refresh_rate: 300,
  };

  if (!pluginSettingId) {
    return res.json(noConfigResponse);
  }

  const installation = db.getInstallation(pluginSettingId);

  if (!installation) {
    const errMarkup = renderError('Installation not found. Please reinstall the plugin.');
    return res.json({
      markup:                 errMarkup,
      markup_half_vertical:   errMarkup,
      markup_half_horizontal: errMarkup,
      markup_quadrant:        errMarkup,
      refresh_rate: 300,
    });
  }

  if (!installation.posthog_url) {
    return res.json(noConfigResponse);
  }

  try {
    const insight = await fetchInsight(installation.posthog_url);
    const full    = renderMarkup({ ...insight, posthogUrl: installation.posthog_url });
    const errMsg  = null;

    return res.json({
      markup:                 full,
      markup_half_vertical:   full,   // same content; TRMNL crops to fit
      markup_half_horizontal: full,
      markup_quadrant:        full,
      refresh_rate: 1800, // 30 minutes
    });
  } catch (err) {
    console.error('Markup fetch error:', err.message);
    const errMarkup = renderError(`Could not load insight: ${err.message}`);
    return res.json({
      markup:                 errMarkup,
      markup_half_vertical:   errMarkup,
      markup_half_horizontal: errMarkup,
      markup_quadrant:        errMarkup,
      refresh_rate: 300,
    });
  }
}

// ---------------------------------------------------------------------------
// DELETE /uninstall  (TRMNL may also POST with method override)
// ---------------------------------------------------------------------------
app.delete('/uninstall', handleUninstall);
app.post('/uninstall', handleUninstall);

function handleUninstall(req, res) {
  // TRMNL sends: { user_uuid: "..." } with Authorization: Bearer <access_token>
  // Try multiple strategies to identify the installation to remove.

  // Strategy 1: explicit plugin_setting_id (dev/fallback)
  let pluginSettingId =
    req.body?.plugin_setting_id ||
    req.query?.plugin_setting_id;

  // Strategy 2: look up by Bearer token
  if (!pluginSettingId) {
    const auth  = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      const inst = db.getInstallationByToken(token);
      if (inst) pluginSettingId = inst.plugin_setting_id;
    }
  }

  if (pluginSettingId) {
    db.deleteInstallation(pluginSettingId);
    console.log(`Uninstalled: plugin_setting_id=${pluginSettingId}`);
  } else {
    console.warn('Uninstall received but could not identify installation:', req.body);
  }

  res.sendStatus(200);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`TRMNL PostHog plugin running on http://localhost:${PORT}`);
  if (!TRMNL_CLIENT_ID || !TRMNL_CLIENT_SECRET) {
    console.warn('WARNING: TRMNL_CLIENT_ID or TRMNL_CLIENT_SECRET not set in .env');
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that the URL is a real PostHog shared insight link.
 * Returns null if valid, or an error string if not.
 *
 * Accepted hosts:
 *   us.posthog.com, eu.posthog.com, app.posthog.com
 *   (plus any self-hosted instance — relaxed to just require /shared/<token>)
 *
 * Strict check for known cloud hosts; loose check for self-hosted.
 */
const POSTHOG_CLOUD_HOSTS = new Set([
  'us.posthog.com',
  'eu.posthog.com',
  'app.posthog.com',
]);

function validatePosthogUrl(raw) {
  if (!raw || typeof raw !== 'string') return 'PostHog URL is required.';

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'PostHog URL is not a valid URL.';
  }

  if (url.protocol !== 'https:') {
    return 'PostHog URL must use HTTPS.';
  }

  if (!url.pathname.match(/^\/shared\/[A-Za-z0-9_-]+/)) {
    return 'PostHog URL must include a /shared/<token> path. ' +
           'In PostHog: open an insight → Share → Copy link.';
  }

  // Warn (but allow) unknown hosts — covers self-hosted PostHog instances
  // For cloud, enforce the known hosts list
  const isKnownCloud = ['posthog.com'].some((d) => url.hostname.endsWith(d));
  if (isKnownCloud && !POSTHOG_CLOUD_HOSTS.has(url.hostname)) {
    return `Unrecognised PostHog cloud host "${url.hostname}". ` +
           'Expected us.posthog.com, eu.posthog.com, or app.posthog.com.';
  }

  return null; // valid
}

function escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
