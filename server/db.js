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

  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    completed_on TEXT NOT NULL,
    UNIQUE(habit_id, completed_on)
  );
`);

function getOrCreateParticipant(telegramId, displayName) {
  const existing = db.prepare('SELECT * FROM participants WHERE telegram_id = ?').get(telegramId);
  if (existing) return existing;
  const info = db
    .prepare('INSERT INTO participants (telegram_id, display_name) VALUES (?, ?)')
    .run(telegramId, displayName);
  return db.prepare('SELECT * FROM participants WHERE id = ?').get(info.lastInsertRowid);
}

function addHabit(participantId, name) {
  const info = db
    .prepare('INSERT INTO habits (participant_id, name) VALUES (?, ?)')
    .run(participantId, name);
  return db.prepare('SELECT * FROM habits WHERE id = ?').get(info.lastInsertRowid);
}

function listHabits(participantId) {
  return db
    .prepare('SELECT * FROM habits WHERE participant_id = ? ORDER BY created_at ASC')
    .all(participantId);
}

function getHabitById(habitId) {
  return db.prepare('SELECT * FROM habits WHERE id = ?').get(habitId);
}

function deleteHabit(habitId, participantId) {
  db.prepare('DELETE FROM habits WHERE id = ? AND participant_id = ?').run(habitId, participantId);
}

function isCompletedOn(habitId, dateStr) {
  return !!db
    .prepare('SELECT 1 FROM completions WHERE habit_id = ? AND completed_on = ?')
    .get(habitId, dateStr);
}

function toggleCompletion(habitId, dateStr) {
  if (isCompletedOn(habitId, dateStr)) {
    db.prepare('DELETE FROM completions WHERE habit_id = ? AND completed_on = ?').run(habitId, dateStr);
    return false;
  }
  db.prepare('INSERT INTO completions (habit_id, completed_on) VALUES (?, ?)').run(habitId, dateStr);
  return true;
}

function completedDates(habitId) {
  return db
    .prepare('SELECT completed_on FROM completions WHERE habit_id = ? ORDER BY completed_on DESC')
    .all(habitId)
    .map((row) => row.completed_on);
}

function allParticipantsWithHabits() {
  const participants = db.prepare('SELECT * FROM participants ORDER BY display_name ASC').all();
  return participants.map((participant) => {
    const habits = listHabits(participant.id).map((habit) => ({
      id: habit.id,
      name: habit.name,
      completedDates: completedDates(habit.id),
    }));
    return {
      id: participant.id,
      telegramId: participant.telegram_id,
      displayName: participant.display_name,
      habits,
    };
  });
}

module.exports = {
  getOrCreateParticipant,
  addHabit,
  listHabits,
  getHabitById,
  deleteHabit,
  toggleCompletion,
  isCompletedOn,
  completedDates,
  allParticipantsWithHabits,
};
