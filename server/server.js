require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const config = require('./config');
const { createBot, startScheduler } = require('./bot');

const PORT = process.env.PORT || 3000;
// Trimmed: values pasted into a hosting dashboard often pick up a stray
// space or newline, which would make every request fail as unauthorized.
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const API_TOKEN = (process.env.API_TOKEN || '').trim();

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is not set. Get one from @BotFather and put it in .env');
  process.exit(1);
}
if (!API_TOKEN) {
  console.error('API_TOKEN is not set. Pick any secret string and put it in .env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

function requireApiToken(req, res, next) {
  const provided = (req.get('x-api-token') || req.query.token || '').trim();
  if (provided !== API_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/health', (req, res) => res.json({ ok: true }));

// Dashboard queries take ?group=90-93&from=YYYY-MM-DD&to=YYYY-MM-DD.
// The window defaults to today; an unknown group is a 400.
function dashboardQuery(req, res) {
  const group = db.getGroup(req.query.group);
  if (!group) {
    res.status(400).json({ error: 'unknown group' });
    return null;
  }
  const today = db.formatDate(new Date());
  const from = db.isValidDate(req.query.from) ? req.query.from : today;
  const to = db.isValidDate(req.query.to) ? req.query.to : from;
  if (from > to) {
    res.status(400).json({ error: 'from is after to' });
    return null;
  }
  return { group, from, to };
}

app.get('/api/groups', requireApiToken, (req, res) => {
  res.json({ groups: config.getConfig().groups });
});

// The whole editable config: groups, their metrics and the reminder times.
// The Mac app loads it, edits it and saves it back in one piece.
app.get('/api/config', requireApiToken, (req, res) => {
  res.json(config.getConfig());
});

app.put('/api/config', requireApiToken, (req, res) => {
  try {
    res.json(config.saveConfig(req.body));
  } catch (error) {
    if (error instanceof config.ConfigError) return res.status(400).json({ error: error.message });
    throw error;
  }
});

app.get('/api/dashboard/base', requireApiToken, (req, res) => {
  const q = dashboardQuery(req, res);
  if (!q) return;
  res.json({ from: q.from, to: q.to, participants: db.dashboardSnapshot(q.group.key, q.from, q.to) });
});

app.get('/api/dashboard/base/participants/:id', requireApiToken, (req, res) => {
  const q = dashboardQuery(req, res);
  if (!q) return;
  const detail = db.participantDetail(parseInt(req.params.id, 10), q.from, q.to);
  if (!detail) return res.status(404).json({ error: 'not found' });
  res.json(detail);
});

app.get('/api/dashboard/base/history', requireApiToken, (req, res) => {
  const q = dashboardQuery(req, res);
  if (!q) return;
  res.json({ from: q.from, to: q.to, ...db.dashboardHistory(q.group.key, q.from, q.to) });
});

const server = app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});

const bot = createBot(BOT_TOKEN);
// Telegram allows one polling connection per token: a second copy of the
// server (e.g. the local one still running after moving to the cloud) gets 409.
bot.launch().catch((error) => {
  if (error.response && error.response.error_code === 409) {
    console.error('Этот бот уже запущен в другом месте (409 Conflict). Остановите другой экземпляр сервера.');
  } else {
    console.error('Telegram bot failed:', error);
  }
  process.exit(1);
});
console.log(`Telegram bot started (long polling), time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
bot.telegram
  .setMyCommands([
    { command: 'menu', description: 'Отметить выполненное' },
    { command: 'week', description: 'Прогресс за неделю' },
    { command: 'start', description: 'Начать заново / выбрать группу' },
  ])
  .catch((error) => console.warn('setMyCommands failed:', error.description || error.message));
const stopScheduler = startScheduler(bot);

// Stop both the bot and the HTTP server; stopping only the bot leaves the
// process running and still holding the port.
function shutdown(signal) {
  stopScheduler();
  try {
    bot.stop(signal);
  } catch (error) {
    // Not polling yet (or anymore) — nothing to stop.
  }
  server.close(() => process.exit(0));
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
