#!/usr/bin/env node
/**
 * seed-test.js
 * Inserts (or updates) a fake installation row so you can test /markup
 * without going through the TRMNL OAuth flow.
 *
 * Usage:
 *   node seed-test.js [posthog-url]
 *
 * Examples:
 *   node seed-test.js
 *   node seed-test.js https://app.posthog.com/shared/AbCdEf123
 */

require('dotenv').config();

const { upsertInstallation, setPosthogUrl, getInstallation } = require('./db');

const PLUGIN_SETTING_ID = 'test';
const FAKE_ACCESS_TOKEN  = 'test-access-token';

// Allow passing a real PostHog URL as a CLI argument
const posthogUrl = process.argv[2] || 'https://app.posthog.com/shared/REPLACE_ME';

upsertInstallation(PLUGIN_SETTING_ID, FAKE_ACCESS_TOKEN);
setPosthogUrl(PLUGIN_SETTING_ID, posthogUrl);

const row = getInstallation(PLUGIN_SETTING_ID);
console.log('Seeded installation:');
console.log(`  plugin_setting_id : ${row.plugin_setting_id}`);
console.log(`  access_token      : ${row.access_token}`);
console.log(`  posthog_url       : ${row.posthog_url}`);
console.log('');
console.log('Test URLs (once the server is running):');
console.log(`  Markup   : http://localhost:${process.env.PORT || 3000}/markup?plugin_setting_id=test`);
console.log(`  Settings : http://localhost:${process.env.PORT || 3000}/settings?plugin_setting_id=test`);
