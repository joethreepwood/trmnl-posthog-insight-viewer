const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS installations (
        plugin_setting_id TEXT PRIMARY KEY,
        access_token       TEXT NOT NULL,
        posthog_url        TEXT,
        created_at         INTEGER DEFAULT (unixepoch()),
        updated_at         INTEGER DEFAULT (unixepoch())
      )
    `);
  }
  return db;
}

function upsertInstallation(pluginSettingId, accessToken) {
  const db = getDb();
  db.prepare(`
    INSERT INTO installations (plugin_setting_id, access_token)
    VALUES (?, ?)
    ON CONFLICT(plugin_setting_id) DO UPDATE SET
      access_token = excluded.access_token,
      updated_at   = unixepoch()
  `).run(pluginSettingId, accessToken);
}

function setPosthogUrl(pluginSettingId, posthogUrl) {
  const db = getDb();
  db.prepare(`
    UPDATE installations
    SET posthog_url = ?, updated_at = unixepoch()
    WHERE plugin_setting_id = ?
  `).run(posthogUrl, pluginSettingId);
}

function getInstallation(pluginSettingId) {
  return getDb()
    .prepare('SELECT * FROM installations WHERE plugin_setting_id = ?')
    .get(pluginSettingId);
}

function deleteInstallation(pluginSettingId) {
  getDb()
    .prepare('DELETE FROM installations WHERE plugin_setting_id = ?')
    .run(pluginSettingId);
}

function getInstallationByToken(accessToken) {
  return getDb()
    .prepare('SELECT * FROM installations WHERE access_token = ?')
    .get(accessToken);
}

module.exports = {
  upsertInstallation,
  setPosthogUrl,
  getInstallation,
  getInstallationByToken,
  deleteInstallation,
};
