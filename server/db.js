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

// Columns added after the first release. Existing databases are migrated in
// place; entries recorded before periods existed get their entry date as the
// period so their history stays visible.
function addColumnIfMissing(table, column, definition, afterAdd) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (columns.includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  if (afterAdd) afterAdd();
}

addColumnIfMissing('participants', 'group_key', 'TEXT');
addColumnIfMissing('participants', 'period_start', 'TEXT');
addColumnIfMissing('participants', 'period_end', 'TEXT');
addColumnIfMissing('metric_entries', 'period_start', 'TEXT', () => {
  db.exec("UPDATE metric_entries SET period_start = date(recorded_at, 'localtime')");
});
addColumnIfMissing('metric_entries', 'period_end', 'TEXT', () => {
  db.exec("UPDATE metric_entries SET period_end = date(recorded_at, 'localtime')");
});
db.exec('CREATE INDEX IF NOT EXISTS idx_metric_entries_period ON metric_entries(metric_id, period_end)');

// Base-sector metrics per group. `key` must stay stable — it is how a
// participant's metric row (and its history) is matched across restarts and
// group changes. Minimums live here, not in the database, so editing them
// takes effect for everyone on the next start.
const GROUPS = [
  {
    key: '90-93',
    name: '90-93',
    metrics: [
      { key: 'BOOK_PRO', name: 'BOOK PRO', min: 7 },
      { key: 'SLEEP', name: 'SLEEP', min: 2 },
      { key: 'RNK', name: 'RNK', min: 14 },
      { key: 'SAT', name: 'SAT', min: 2100 },
      { key: 'SHIELD', name: 'Shield', min: 100 },
      { key: 'BOOK', name: 'BOOK', min: 20 },
      { key: 'DIET', name: 'DIET', min: 1 },
    ],
  },
  {
    key: '81-94',
    name: '81-94',
    metrics: [
      { key: 'BOOK_PRO', name: 'BOOK PRO', min: 7 },
      { key: 'SLEEP', name: 'SLEEP', min: 1 },
      { key: 'BOOK', name: 'BOOK', min: 21 },
      { key: 'SHIELD', name: 'Shield', min: 50 },
      { key: 'SAT', name: 'SAT', min: 2100 },
      { key: 'MP3', name: 'MP3', min: 30 },
      { key: 'RNK', name: 'RNK', min: 10 },
    ],
  },
];

function getGroup(groupKey) {
  return GROUPS.find((group) => group.key === groupKey) || null;
}

// Dates are local calendar days stored as 'YYYY-MM-DD', which compare
// correctly as plain strings.
function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isValidDate(isoDate) {
  return typeof isoDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && formatDate(parseDate(isoDate)) === isoDate;
}

function getOrCreateParticipant(telegramId, displayName) {
  const existing = db.prepare('SELECT * FROM participants WHERE telegram_id = ?').get(telegramId);
  if (existing) return existing;
  const info = db
    .prepare('INSERT INTO participants (telegram_id, display_name) VALUES (?, ?)')
    .run(telegramId, displayName);
  return db.prepare('SELECT * FROM participants WHERE id = ?').get(info.lastInsertRowid);
}

function setParticipantGroup(participantId, groupKey) {
  db.prepare('UPDATE participants SET group_key = ? WHERE id = ?').run(groupKey, participantId);
  ensureBaseMetrics(participantId, groupKey);
}

function setParticipantPeriod(participantId, periodStart, periodEnd) {
  db.prepare('UPDATE participants SET period_start = ?, period_end = ? WHERE id = ?').run(
    periodStart,
    periodEnd,
    participantId
  );
}

// Creates any of the group's base metrics the participant doesn't have yet
// and syncs names/minimums with the group definition. Metrics from another
// group are left in place (hidden) so switching back keeps their history.
function ensureBaseMetrics(participantId, groupKey) {
  const group = getGroup(groupKey);
  if (!group) return;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO metrics (participant_id, sector, key, name, min_value) VALUES (?, ?, ?, ?, ?)'
  );
  const sync = db.prepare('UPDATE metrics SET name = ?, min_value = ? WHERE participant_id = ? AND key = ?');
  for (const metric of group.metrics) {
    insert.run(participantId, 'base', metric.key, metric.name, metric.min);
    sync.run(metric.name, metric.min, participantId, metric.key);
  }
}

// Value of a metric for a date window: the entry whose period overlaps the
// window, preferring the latest period and then the latest entry.
function entryForWindow(metricId, from, to) {
  return db
    .prepare(
      `SELECT value, period_start, period_end FROM metric_entries
       WHERE metric_id = ? AND period_start <= ? AND period_end >= ?
       ORDER BY period_end DESC, recorded_at DESC LIMIT 1`
    )
    .get(metricId, to, from);
}

function toStatus(metric, from, to) {
  const entry = entryForWindow(metric.id, from, to);
  const value = entry ? entry.value : 0;
  return {
    id: metric.id,
    key: metric.key,
    name: metric.name,
    minValue: metric.min_value,
    value,
    hasValue: Boolean(entry),
    // The period the shown value was entered for, so the dashboard can say
    // where a number came from.
    periodStart: entry ? entry.period_start : null,
    periodEnd: entry ? entry.period_end : null,
    isGreen: Boolean(entry) && value >= metric.min_value,
  };
}

// Metrics of one sector with their value for [from, to]. Base metrics are
// limited to the participant's group, in the group's order.
function listMetrics(participant, sector, from, to) {
  const rows = db
    .prepare('SELECT * FROM metrics WHERE participant_id = ? AND sector = ? ORDER BY id ASC')
    .all(participant.id, sector);

  let metrics = rows;
  if (sector === 'base') {
    const group = getGroup(participant.group_key);
    if (!group) return [];
    metrics = group.metrics.map((gm) => rows.find((row) => row.key === gm.key)).filter(Boolean);
  }
  return metrics.map((metric) => toStatus(metric, from, to));
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

function recordValue(metricId, value, periodStart, periodEnd) {
  db.prepare('INSERT INTO metric_entries (metric_id, value, period_start, period_end) VALUES (?, ?, ?, ?)').run(
    metricId,
    value,
    periodStart,
    periodEnd
  );
}

function lastUpdatedAt(participantId) {
  const row = db
    .prepare(
      `SELECT MAX(e.recorded_at) AS last FROM metric_entries e
       JOIN metrics m ON m.id = e.metric_id
       WHERE m.participant_id = ? AND m.sector = 'base'`
    )
    .get(participantId);
  return row && row.last ? toIsoUtc(row.last) : null;
}

// SQLite's datetime('now') is UTC without a zone marker; make it ISO 8601
// so clients parse it unambiguously.
function toIsoUtc(sqliteDateTime) {
  return sqliteDateTime.replace(' ', 'T') + 'Z';
}

function percentGreen(metrics) {
  const greenCount = metrics.filter((m) => m.isGreen).length;
  return metrics.length ? Math.round((greenCount / metrics.length) * 100) : 0;
}

function participantSummary(participant, from, to) {
  const metrics = listMetrics(participant, 'base', from, to);
  return {
    id: participant.id,
    telegramId: participant.telegram_id,
    displayName: participant.display_name,
    percentGreen: percentGreen(metrics),
    lastUpdatedAt: lastUpdatedAt(participant.id),
    metrics,
  };
}

function participantsInGroup(groupKey) {
  return db.prepare('SELECT * FROM participants WHERE group_key = ? ORDER BY display_name ASC').all(groupKey);
}

function dashboardSnapshot(groupKey, from, to) {
  return participantsInGroup(groupKey).map((participant) => participantSummary(participant, from, to));
}

function participantDetail(participantId, from, to) {
  const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId);
  if (!participant) return null;
  const summary = participantSummary(participant, from, to);
  const entriesFor = db.prepare(
    'SELECT value, period_start, period_end FROM metric_entries WHERE metric_id = ? ORDER BY period_end ASC, recorded_at ASC'
  );
  summary.metrics = summary.metrics.map((metric) => ({
    ...metric,
    entries: entriesFor
      .all(metric.id)
      .map((e) => ({ value: e.value, periodStart: e.period_start, periodEnd: e.period_end })),
  }));
  return summary;
}

// Monday-to-Sunday weeks that overlap [from, to], oldest first.
function weeksOverlapping(from, to) {
  const start = parseDate(from);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks = [];
  for (let d = start; formatDate(d) <= to; d.setDate(d.getDate() + 7)) {
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    weeks.push({ start: formatDate(d), end: formatDate(end) });
  }
  return weeks;
}

function dashboardHistory(groupKey, from, to) {
  const weeks = weeksOverlapping(from, to);
  const participants = participantsInGroup(groupKey).map((participant) => ({
    id: participant.id,
    telegramId: participant.telegram_id,
    displayName: participant.display_name,
    weeklyPercents: weeks.map((week) => percentGreen(listMetrics(participant, 'base', week.start, week.end))),
    periodPercent: percentGreen(listMetrics(participant, 'base', from, to)),
  }));
  return { weekStarts: weeks.map((w) => w.start), participants };
}

module.exports = {
  GROUPS,
  getGroup,
  formatDate,
  parseDate,
  isValidDate,
  getOrCreateParticipant,
  setParticipantGroup,
  setParticipantPeriod,
  ensureBaseMetrics,
  listMetrics,
  getMetricById,
  addPersonalMetric,
  deleteMetric,
  recordValue,
  dashboardSnapshot,
  participantDetail,
  dashboardHistory,
};
