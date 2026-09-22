require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { createBot } = require('./bot');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_TOKEN = process.env.API_TOKEN;

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

function requireApiToken(req, res, next) {
  const provided = req.get('x-api-token') || req.query.token;
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
  res.json({
    groups: db.GROUPS.map((g) => ({
      key: g.key,
      name: g.name,
      metrics: g.metrics.map((m) => ({ key: m.key, name: m.name, minValue: m.min })),
    })),
  });
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
bot.launch();
console.log('Telegram bot started (long polling)');

// Stop both the bot and the HTTP server; stopping only the bot leaves the
// process running and still holding the port.
function shutdown(signal) {
  bot.stop(signal);
  server.close(() => process.exit(0));
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
