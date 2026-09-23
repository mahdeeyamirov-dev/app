const path = require('path');
const fs = require('fs');

// Groups, their metrics and the reminder schedule live in data/config.json,
// not in code. It is created from config.default.json on first start, edited
// from the Mac app (PUT /api/config) or by hand; hand edits are picked up
// without a restart.
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const configPath = path.join(dataDir, 'config.json');
const defaultPath = path.join(__dirname, 'config.default.json');

const TYPES = ['count', 'check'];
const AGGREGATES = ['sum', 'max'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

class ConfigError extends Error {}

// Keys identify a group or metric across renames: a participant's metric row
// (and its history) is matched by key, so an existing key is never changed.
function makeKey(name, taken, { upper, fallback }) {
  let base = String(name)
    .trim()
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (upper) base = base.toUpperCase();
  if (!base) base = fallback;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

function validKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(key);
}

function normalizeMetric(input, where, takenKeys) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ConfigError(`${where}: пустое название пункта`);
  const type = input.type === undefined ? 'count' : input.type;
  if (!TYPES.includes(type)) throw new ConfigError(`${where}, «${name}»: неизвестный тип ${type}`);
  const aggregate = type === 'check' ? 'sum' : input.aggregate === undefined ? 'sum' : input.aggregate;
  if (!AGGREGATES.includes(aggregate)) throw new ConfigError(`${where}, «${name}»: неизвестный способ подсчёта ${aggregate}`);
  const target = Number(input.target);
  if (!Number.isFinite(target) || target < 0) throw new ConfigError(`${where}, «${name}»: цель должна быть числом ≥ 0`);
  const unit = typeof input.unit === 'string' ? input.unit.trim().slice(0, 16) : '';

  const key = validKey(input.key) && !takenKeys.has(input.key)
    ? input.key
    : makeKey(name, takenKeys, { upper: true, fallback: 'M' });
  takenKeys.add(key);
  return { key, name, type, aggregate, target, unit };
}

function normalizeConfig(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.groups)) {
    throw new ConfigError('Ожидается объект с массивом groups');
  }
  for (const field of ['reminderTime', 'summaryTime']) {
    const value = input[field];
    if (value !== null && value !== undefined && value !== '' && !TIME_RE.test(value)) {
      throw new ConfigError(`${field}: время должно быть в формате ЧЧ:ММ`);
    }
  }

  const groupKeys = new Set();
  const groups = input.groups.map((group, index) => {
    const name = group && typeof group.name === 'string' ? group.name.trim() : '';
    if (!name) throw new ConfigError(`Группа №${index + 1}: пустое название`);
    const key = validKey(group.key) && !groupKeys.has(group.key)
      ? group.key
      : makeKey(name, groupKeys, { upper: false, fallback: 'group' });
    groupKeys.add(key);
    const metricKeys = new Set();
    const metrics = (Array.isArray(group.metrics) ? group.metrics : []).map((metric) =>
      normalizeMetric(metric || {}, `Группа «${name}»`, metricKeys)
    );
    return { key, name, metrics };
  });

  return {
    reminderTime: input.reminderTime || null,
    summaryTime: input.summaryTime || null,
    groups,
  };
}

let current = null;
let loadedMtime = 0;

function readFile(file) {
  return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// Re-reads the file when its modification time changes. A broken hand edit
// is logged and the last good config stays in use.
function getConfig() {
  if (!fs.existsSync(configPath)) {
    saveConfig(readFile(defaultPath));
  }
  const mtime = fs.statSync(configPath).mtimeMs;
  if (!current || mtime !== loadedMtime) {
    try {
      current = readFile(configPath);
    } catch (error) {
      console.error(`Не удалось прочитать ${configPath}: ${error.message}`);
      if (!current) throw error;
    }
    loadedMtime = mtime;
  }
  return current;
}

// Validates, then writes through a temp file so a crash mid-write can't leave
// a half-written config behind.
function saveConfig(input) {
  const config = normalizeConfig(input);
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, configPath);
  current = config;
  loadedMtime = fs.statSync(configPath).mtimeMs;
  return config;
}

function getGroup(groupKey) {
  return getConfig().groups.find((group) => group.key === groupKey) || null;
}

module.exports = { dataDir, configPath, ConfigError, getConfig, saveConfig, getGroup };
