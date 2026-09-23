const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

const dbPath = path.join(config.dataDir, 'habits.sqlite');
const db = new Database(dbPath);
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

  CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT
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
addColumnIfMissing('participants', 'entry_mode', "TEXT NOT NULL DEFAULT 'today'");
addColumnIfMissing('participants', 'reminders', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('metric_entries', 'period_start', 'TEXT', () => {
  db.exec("UPDATE metric_entries SET period_start = date(recorded_at, 'localtime')");
});
addColumnIfMissing('metric_entries', 'period_end', 'TEXT', () => {
  db.exec("UPDATE metric_entries SET period_end = date(recorded_at, 'localtime')");
});
db.exec('CREATE INDEX IF NOT EXISTS idx_metric_entries_period ON metric_entries(metric_id, period_end)');

// Version 1: entries now add up instead of the latest one replacing the
// others. Before that, re-entering a value for the same period overwrote it,
// so only the latest entry per period is kept. The database is backed up first.
if (db.pragma('user_version', { simple: true }) < 1) {
  const hasEntries = db.prepare('SELECT COUNT(*) AS n FROM metric_entries').get().n > 0;
  if (hasEntries) {
    const backup = path.join(config.dataDir, `habits.backup-before-sums-${Date.now()}.sqlite`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    console.log(`Migrating entries to sums; backup saved to ${backup}`);
  }
  db.exec(`
    DELETE FROM metric_entries WHERE id NOT IN (
      SELECT MAX(id) FROM metric_entries GROUP BY metric_id, period_start, period_end
    )
  `);
  db.pragma('user_version = 1');
}

const getGroup = config.getGroup;

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

function addDays(isoDate, days) {
  const d = parseDate(isoDate);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

// Inclusive number of days in [from, to]. Rounding absorbs DST shifts.
function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000) + 1;
}

// Monday-to-Sunday week containing the date.
function weekOf(isoDate) {
  const d = parseDate(isoDate);
  const start = addDays(isoDate, -((d.getDay() + 6) % 7));
  return { start, end: addDays(start, 6) };
}

function getOrCreateParticipant(telegramId, displayName) {
  const existing = db.prepare('SELECT * FROM participants WHERE telegram_id = ?').get(telegramId);
  if (existing) return existing;
  const info = db
    .prepare('INSERT INTO participants (telegram_id, display_name) VALUES (?, ?)')
    .run(telegramId, displayName);
  return db.prepare('SELECT * FROM participants WHERE id = ?').get(info.lastInsertRowid);
}

function getParticipant(participantId) {
  return db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId);
}

function setParticipantGroup(participantId, groupKey) {
  db.prepare('UPDATE participants SET group_key = ? WHERE id = ?').run(groupKey, participantId);
}

// 'today' | 'yesterday' | 'week' | 'lastweek' | 'YYYY-MM-DD' — the day or
// week the bot records values for. Stored as a mode rather than dates so
// "today" still means today after midnight.
function setEntryMode(participantId, mode) {
  db.prepare('UPDATE participants SET entry_mode = ? WHERE id = ?').run(mode, participantId);
}

function setReminders(participantId, enabled) {
  db.prepare('UPDATE participants SET reminders = ? WHERE id = ?').run(enabled ? 1 : 0, participantId);
}

function participantsForReminders() {
  return db.prepare('SELECT * FROM participants WHERE group_key IS NOT NULL AND reminders = 1').all();
}

function getState(key) {
  const row = db.prepare('SELECT value FROM bot_state WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setState(key, value) {
  db.prepare('INSERT INTO bot_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  );
}

// The participant's row for a group metric, created on first use. Rows are
// shared by key across groups, so switching groups keeps common history.
function baseMetricRow(participantId, definition) {
  db.prepare(
    "INSERT OR IGNORE INTO metrics (participant_id, sector, key, name, min_value) VALUES (?, 'base', ?, ?, 0)"
  ).run(participantId, definition.key, definition.name);
  return db.prepare('SELECT * FROM metrics WHERE participant_id = ? AND key = ?').get(participantId, definition.key);
}

// Personal metrics are always summed numbers; their weekly target is stored
// in min_value.
function personalDefinition(row) {
  return { key: null, name: row.name, type: 'count', aggregate: 'sum', target: row.min_value, unit: '' };
}

function entriesOverlapping(metricId, from, to) {
  return db
    .prepare(
      `SELECT id, value, period_start, period_end, recorded_at FROM metric_entries
       WHERE metric_id = ? AND period_start <= ? AND period_end >= ?
       ORDER BY period_start ASC, id ASC`
    )
    .all(metricId, to, from);
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Total of a metric over [from, to]. Summed metrics add up entries; an entry
// for a longer period (e.g. a whole week) counts in proportion to the days it
// shares with the window. 'max' metrics (scores) take the best entry.
function aggregate(entries, definition, from, to) {
  if (!entries.length) return null;
  if (definition.aggregate === 'max') return Math.max(...entries.map((e) => e.value));
  const total = entries.reduce((sum, e) => {
    const shared = daysBetween(e.period_start > from ? e.period_start : from, e.period_end < to ? e.period_end : to);
    return sum + (e.value * shared) / daysBetween(e.period_start, e.period_end);
  }, 0);
  return round(total);
}

// Targets are per week; a window of another length gets a proportional share,
// except for 'max' metrics, where the best result has to reach the target.
function targetFor(definition, from, to) {
  if (definition.aggregate === 'max') return definition.target;
  return round((definition.target * daysBetween(from, to)) / 7);
}

function toStatus(row, definition, from, to) {
  const total = aggregate(entriesOverlapping(row.id, from, to), definition, from, to);
  const target = targetFor(definition, from, to);
  return {
    id: row.id,
    key: row.key,
    name: definition.name,
    type: definition.type,
    aggregate: definition.aggregate,
    unit: definition.unit,
    weeklyTarget: definition.target,
    minValue: target,
    value: total === null ? 0 : total,
    hasValue: total !== null,
    isGreen: total !== null && total >= target,
  };
}

// Metrics of one sector with their totals for [from, to]. Base metrics follow
// the participant's group definition and its order.
function listMetrics(participant, sector, from, to) {
  if (sector === 'base') {
    const group = getGroup(participant.group_key);
    if (!group) return [];
    return group.metrics.map((definition) => toStatus(baseMetricRow(participant.id, definition), definition, from, to));
  }
  return db
    .prepare("SELECT * FROM metrics WHERE participant_id = ? AND sector = 'personal' ORDER BY id ASC")
    .all(participant.id)
    .map((row) => toStatus(row, personalDefinition(row), from, to));
}

// A metric row with its current definition (from the group config for base
// metrics). Null when the metric is gone or belongs to someone else.
function metricForParticipant(metricId, participant) {
  const row = db.prepare('SELECT * FROM metrics WHERE id = ?').get(metricId);
  if (!row || row.participant_id !== participant.id) return null;
  if (row.sector === 'personal') return { row, definition: personalDefinition(row) };
  for (const group of config.getConfig().groups) {
    const definition = group.metrics.find((m) => m.key === row.key);
    // Prefer the participant's own group when the key exists in several.
    if (definition && group.key === participant.group_key) return { row, definition };
  }
  for (const group of config.getConfig().groups) {
    const definition = group.metrics.find((m) => m.key === row.key);
    if (definition) return { row, definition };
  }
  return null;
}

function metricStatus(metricId, participant, from, to) {
  const metric = metricForParticipant(metricId, participant);
  return metric ? toStatus(metric.row, metric.definition, from, to) : null;
}

function addPersonalMetric(participantId, name, weeklyTarget) {
  const info = db
    .prepare('INSERT INTO metrics (participant_id, sector, key, name, min_value) VALUES (?, ?, NULL, ?, ?)')
    .run(participantId, 'personal', name, weeklyTarget);
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

function isCheckedOn(metricId, date) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM metric_entries WHERE metric_id = ? AND period_start = ? AND period_end = ? AND value > 0')
      .get(metricId, date, date)
  );
}

// One tap on a yes/no metric: marks the day, or unmarks it if already marked.
// Returns whether the day is marked afterwards.
function toggleCheck(metricId, date) {
  if (isCheckedOn(metricId, date)) {
    db.prepare('DELETE FROM metric_entries WHERE metric_id = ? AND period_start = ? AND period_end = ?').run(
      metricId,
      date,
      date
    );
    return false;
  }
  recordValue(metricId, 1, date, date);
  return true;
}

// Removes the participant's most recent entry and returns what was removed.
function deleteLastEntry(participantId) {
  const entry = db
    .prepare(
      `SELECT e.id, e.value, e.period_start, e.period_end, m.name FROM metric_entries e
       JOIN metrics m ON m.id = e.metric_id
       WHERE m.participant_id = ?
       ORDER BY e.id DESC LIMIT 1`
    )
    .get(participantId);
  if (!entry) return null;
  db.prepare('DELETE FROM metric_entries WHERE id = ?').run(entry.id);
  return entry;
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

// Place of a participant in their group by % of weekly targets met, with
// ties sharing a place (1, 2, 2, 4).
function groupRank(participant, from, to) {
  const percents = participantsInGroup(participant.group_key).map((p) => ({
    id: p.id,
    percent: percentGreen(listMetrics(p, 'base', from, to)),
  }));
  const mine = percents.find((p) => p.id === participant.id);
  if (!mine) return null;
  return { place: 1 + percents.filter((p) => p.percent > mine.percent).length, of: percents.length };
}

const HISTORY_WEEKS = 12;

// One participant for the detail sheet: totals for the window, the entries
// made in it, and weekly totals for the last weeks up to the window's end.
function participantDetail(participantId, from, to) {
  const participant = getParticipant(participantId);
  if (!participant) return null;
  const summary = participantSummary(participant, from, to);
  const group = getGroup(participant.group_key);
  const lastWeek = weekOf(to);
  const weeks = Array.from({ length: HISTORY_WEEKS }, (_, i) => {
    const start = addDays(lastWeek.start, -7 * (HISTORY_WEEKS - 1 - i));
    return { start, end: addDays(start, 6) };
  });

  summary.metrics = summary.metrics.map((metric) => {
    const definition = group.metrics.find((m) => m.key === metric.key);
    return {
      ...metric,
      entries: entriesOverlapping(metric.id, from, to).map((e) => ({
        value: e.value,
        periodStart: e.period_start,
        periodEnd: e.period_end,
        recordedAt: toIsoUtc(e.recorded_at),
      })),
      weeks: weeks.map((week) => {
        const total = aggregate(entriesOverlapping(metric.id, week.start, week.end), definition, week.start, week.end);
        return { weekStart: week.start, value: total === null ? 0 : total, hasValue: total !== null };
      }),
    };
  });
  return summary;
}

// Monday-to-Sunday weeks that overlap [from, to], oldest first.
function weeksOverlapping(from, to) {
  const weeks = [];
  for (let start = weekOf(from).start; start <= to; start = addDays(start, 7)) {
    weeks.push({ start, end: addDays(start, 6) });
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
  getGroup,
  formatDate,
  parseDate,
  isValidDate,
  addDays,
  weekOf,
  getOrCreateParticipant,
  getParticipant,
  setParticipantGroup,
  setEntryMode,
  setReminders,
  participantsForReminders,
  getState,
  setState,
  listMetrics,
  metricForParticipant,
  metricStatus,
  addPersonalMetric,
  deleteMetric,
  recordValue,
  isCheckedOn,
  toggleCheck,
  deleteLastEntry,
  percentGreen,
  groupRank,
  dashboardSnapshot,
  participantDetail,
  dashboardHistory,
};
