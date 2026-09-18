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

app.get('/api/dashboard', requireApiToken, (req, res) => {
  res.json({ participants: db.allParticipantsWithHabits() });
});

app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});

const bot = createBot(BOT_TOKEN);
bot.launch();
console.log('Telegram bot started (long polling)');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
