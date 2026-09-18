const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'habits.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    sector TEXT NOT NULL CHECK (sector IN ('base', 'personal')),
    key TEXT,
    name TEXT NOT NULL,
    min_value REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(participant_id, key)
  );

  CREATE TABLE IF NOT EXISTS metric_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id INTEGER NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
    value REAL NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_metric_entries_metric_id ON metric_entries(metric_id, recorded_at);
`);

// Fixed base-sector metrics shared by every participant. `key` must stay
// stable — it is how a participant's row is matched across restarts.
const BASE_METRICS = [
  { key: 'SAT', name: 'SAT', min: 2100 },
  { key: 'MP3', name: 'MP3', min: 30 },
  { key: 'SLEEP', name: 'SLEEP', min: 2 },
  { key: 'DIET', name: 'DIET', min: 1 },
  { key: 'BOOK', name: 'BOOK', min: 20 },
  { key: 'BOOK_PRO', name: 'BOOK PRO', min: 14 },
  { key: 'RNK', name: 'RNK', min: 20 },
  { key: 'SHIELD', name: 'Shield', min: 100 },
];

function getOrCreateParticipant(telegramId, displayName) {
  const existing = db.prepare('SELECT * FROM participants WHERE telegram_id = ?').get(telegramId);
  if (existing) return existing;
  const info = db
    .prepare('INSERT INTO participants (telegram_id, display_name) VALUES (?, ?)')
    .run(telegramId, displayName);
  return db.prepare('SELECT * FROM participants WHERE id = ?').get(info.lastInsertRowid);
}

function ensureBaseMetrics(participantId) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO metrics (participant_id, sector, key, name, min_value) VALUES (?, ?, ?, ?, ?)'
  );
  for (const metric of BASE_METRICS) {
    insert.run(participantId, 'base', metric.key, metric.name, metric.min);
  }
}

function latestValue(metricId) {
  const row = db
    .prepare('SELECT value FROM metric_entries WHERE metric_id = ? ORDER BY recorded_at DESC LIMIT 1')
    .get(metricId);
  return row ? row.value : 0;
}

function valueAsOf(metricId, isoDateTime) {
  const row = db
    .prepare(
      'SELECT value FROM metric_entries WHERE metric_id = ? AND recorded_at <= ? ORDER BY recorded_at DESC LIMIT 1'
    )
    .get(metricId, isoDateTime);
  return row ? row.value : 0;
}

function listMetrics(participantId, sector) {
  const metrics = db
    .prepare('SELECT * FROM metrics WHERE participant_id = ? AND sector = ? ORDER BY id ASC')
    .all(participantId, sector);
  return metrics.map((metric) => {
    const value = latestValue(metric.id);
    return {
      id: metric.id,
      key: metric.key,
      name: metric.name,
      minValue: metric.min_value,
      value,
      isGreen: value >= metric.min_value,
    };
  });
}

function getMetricById(metricId) {
  return db.prepare('SELECT * FROM metrics WHERE id = ?').get(metricId);
}

function addPersonalMetric(participantId, name, minValue) {
  const info = db
    .prepare('INSERT INTO metrics (participant_id, sector, key, name, min_value) VALUES (?, ?, NULL, ?, ?)')
    .run(participantId, 'personal', name, minValue);
  return db.prepare('SELECT * FROM metrics WHERE id = ?').get(info.lastInsertRowid);
}

function deleteMetric(metricId, participantId) {
  db.prepare("DELETE FROM metrics WHERE id = ? AND participant_id = ? AND sector = 'personal'").run(
    metricId,
    participantId
  );
}

function recordValue(metricId, value) {
  db.prepare('INSERT INTO metric_entries (metric_id, value) VALUES (?, ?)').run(metricId, value);
}

function dashboardSnapshot() {
  const participants = db.prepare('SELECT * FROM participants ORDER BY display_name ASC').all();
  return participants.map((participant) => {
    const metrics = listMetrics(participant.id, 'base');
    const greenCount = metrics.filter((m) => m.isGreen).length;
    const percentGreen = metrics.length ? Math.round((greenCount / metrics.length) * 100) : 0;
    return {
      id: participant.id,
      telegramId: participant.telegram_id,
      displayName: participant.display_name,
      percentGreen,
      metrics,
    };
  });
}

function isoWeekEndDates(count) {
  // Returns ISO datetime strings for the end of each of the last `count`
  // ISO weeks (Mon-Sun, UTC), oldest first, including the current week.
  const now = new Date();
  const day = now.getUTCDay() === 0 ? 7 : now.getUTCDay(); // 1=Mon..7=Sun
  const daysUntilSunday = 7 - day;
  const currentWeekEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday, 23, 59, 59)
  );
  const ends = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(currentWeekEnd);
    d.setUTCDate(d.getUTCDate() - i * 7);
    ends.push(d.toISOString().slice(0, 19).replace('T', ' '));
  }
  return ends;
}

function dashboardHistory(weeks = 6) {
  const participants = db.prepare('SELECT * FROM participants ORDER BY display_name ASC').all();
  const weekEnds = isoWeekEndDates(weeks);

  return participants.map((participant) => {
    const baseMetrics = db
      .prepare("SELECT * FROM metrics WHERE participant_id = ? AND sector = 'base'")
      .all(participant.id);

    const weeklyPercents = weekEnds.map((weekEnd) => {
      if (baseMetrics.length === 0) return 0;
      const greenCount = baseMetrics.filter((metric) => valueAsOf(metric.id, weekEnd) >= metric.min_value).length;
      return Math.round((greenCount / baseMetrics.length) * 100);
    });

    return {
      id: participant.id,
      telegramId: participant.telegram_id,
      displayName: participant.display_name,
      weeklyPercents,
      currentPercent: weeklyPercents[weeklyPercents.length - 1] ?? 0,
    };
  });
}

module.exports = {
  BASE_METRICS,
  getOrCreateParticipant,
  ensureBaseMetrics,
  listMetrics,
  getMetricById,
  addPersonalMetric,
  deleteMetric,
  recordValue,
  dashboardSnapshot,
  dashboardHistory,
};
