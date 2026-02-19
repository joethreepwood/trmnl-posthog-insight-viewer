#!/usr/bin/env node
/**
 * generate-preview.js
 * Fetches the current /markup output from the running dev server,
 * wraps it in an 800×480 TRMNL screen shell, and opens preview.html.
 *
 * Usage:
 *   node generate-preview.js
 *   npm run preview
 *
 * Requires the server to be running first:
 *   npm run dev    (in another terminal)
 */

const fetch  = require('node-fetch');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

require('dotenv').config();

const PORT           = process.env.PORT || 3000;
const PLUGIN_ID      = process.argv[2] || 'test';
const PREVIEW_PATH   = path.join(__dirname, 'preview.html');
const MARKUP_URL     = `http://localhost:${PORT}/markup?plugin_setting_id=${PLUGIN_ID}`;

async function main() {
  console.log(`Fetching: ${MARKUP_URL}`);

  let res;
  try {
    res = await fetch(MARKUP_URL);
  } catch (e) {
    console.error(`\nCould not connect to server on port ${PORT}.`);
    console.error('Start it first with:  npm run dev\n');
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Server returned ${res.status}`);
    process.exit(1);
  }

  const { markup, refresh_rate } = await res.json();

  if (!markup) {
    console.error('No markup returned from server');
    process.exit(1);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TRMNL Preview – ${PLUGIN_ID}</title>
  <link rel="stylesheet" href="https://usetrmnl.com/css/latest/plugins.css">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #555;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .meta {
      color: #ddd;
      font-size: 12px;
      letter-spacing: 0.05em;
    }
    /* Mirrors the TRMNL hardware screen */
    .screen {
      width: 800px;
      height: 480px;
      background: white;
      position: relative;
      overflow: hidden;
      container-type: size;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
  </style>
</head>
<body>
  <div class="meta">800 × 480 · plugin_setting_id: ${PLUGIN_ID} · refresh: ${refresh_rate}s</div>
  <div class="screen">${markup}</div>
</body>
</html>`;

  fs.writeFileSync(PREVIEW_PATH, html, 'utf8');
  console.log(`Written: ${PREVIEW_PATH}`);

  // Open in default browser (macOS: open, Linux: xdg-open, Windows: start)
  const opener =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'start' : 'xdg-open';

  try {
    execSync(`${opener} "${PREVIEW_PATH}"`);
  } catch {
    console.log(`Open manually: file://${PREVIEW_PATH}`);
  }
}

main();
