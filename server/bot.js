const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

// Tracks what the bot is waiting for from a user's next text message,
// since Telegraf has no built-in multi-step form support.
const pending = new Map();

function displayName(ctx) {
  return (
    [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'Без имени'
  );
}

function formatNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🧱 Базовый', 'sector:base')],
    [Markup.button.callback('🧍 Личный', 'sector:personal')],
  ]);
}

function metricButtonLabel(metric) {
  return `${metric.isGreen ? '🟢' : '🔴'} ${metric.name}: ${formatNum(metric.value)}/${formatNum(metric.minValue)}`;
}

function renderBaseKeyboard(participantId) {
  const metrics = db.listMetrics(participantId, 'base');
  const buttons = metrics.map((metric) => [
    Markup.button.callback(metricButtonLabel(metric), `metric:edit:${metric.id}`),
  ]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'menu')]);
  return Markup.inlineKeyboard(buttons);
}

function renderPersonalKeyboard(participantId) {
  const metrics = db.listMetrics(participantId, 'personal');
  const buttons = metrics.map((metric) => [
    Markup.button.callback(metricButtonLabel(metric), `metric:edit:${metric.id}`),
    Markup.button.callback('🗑', `personal:delete:${metric.id}`),
  ]);
  buttons.push([Markup.button.callback('➕ Добавить', 'personal:add')]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'menu')]);
  return Markup.inlineKeyboard(buttons);
}

function createBot(token) {
  const bot = new Telegraf(token);

  bot.start((ctx) => {
    db.getOrCreateParticipant(ctx.from.id, displayName(ctx));
    pending.delete(ctx.from.id);
    ctx.reply(
      `Привет, ${displayName(ctx)}! 👋\n\nВыберите раздел:\n` +
        '🧱 Базовый — общие показатели с фиксированным минимумом\n' +
        '🧍 Личный — ваши собственные показатели',
      mainMenuKeyboard()
    );
  });

  bot.action('menu', async (ctx) => {
    pending.delete(ctx.from.id);
    await ctx.editMessageText('Выберите раздел:', mainMenuKeyboard());
    await ctx.answerCbQuery();
  });

  bot.action('sector:base', async (ctx) => {
    const participant = db.getOrCreateParticipant(ctx.from.id, displayName(ctx));
    db.ensureBaseMetrics(participant.id);
    await ctx.editMessageText(
      'Базовый раздел. Нажмите на показатель, чтобы ввести новое значение:',
      renderBaseKeyboard(participant.id)
    );
    await ctx.answerCbQuery();
  });

  bot.action('sector:personal', async (ctx) => {
    const participant = db.getOrCreateParticipant(ctx.from.id, displayName(ctx));
    const metrics = db.listMetrics(participant.id, 'personal');
    if (metrics.length === 0) {
      await ctx.editMessageText(
        'Личный раздел пуст. Добавьте свой первый показатель:',
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Добавить', 'personal:add')],
          [Markup.button.callback('⬅️ Назад', 'menu')],
        ])
      );
    } else {
      await ctx.editMessageText(
        'Личный раздел. Нажмите на показатель, чтобы ввести новое значение:',
        renderPersonalKeyboard(participant.id)
      );
    }
    await ctx.answerCbQuery();
  });

  bot.action(/metric:edit:(\d+)/, async (ctx) => {
    const metricId = Number(ctx.match[1]);
    const metric = db.getMetricById(metricId);
    if (!metric) {
      await ctx.answerCbQuery('Показатель не найден');
      return;
    }
    pending.set(ctx.from.id, { action: 'set_value', metricId });
    await ctx.answerCbQuery();
    await ctx.reply(
      `Введите новое значение для «${metric.name}» (минимум для зелёного статуса: ${formatNum(metric.min_value)}):`
    );
  });

  bot.action('personal:add', async (ctx) => {
    pending.set(ctx.from.id, { action: 'add_personal_name' });
    await ctx.answerCbQuery();
    await ctx.reply('Введите название нового показателя:');
  });

  bot.action(/personal:delete:(\d+)/, async (ctx) => {
    const metricId = Number(ctx.match[1]);
    const participant = db.getOrCreateParticipant(ctx.from.id, displayName(ctx));
    db.deleteMetric(metricId, participant.id);
    await ctx.answerCbQuery('Удалено');
    const metrics = db.listMetrics(participant.id, 'personal');
    if (metrics.length === 0) {
      await ctx.editMessageText(
        'Личный раздел пуст. Добавьте свой первый показатель:',
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Добавить', 'personal:add')],
          [Markup.button.callback('⬅️ Назад', 'menu')],
        ])
      );
    } else {
      await ctx.editMessageText('Личный раздел:', renderPersonalKeyboard(participant.id));
    }
  });

  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;

    const state = pending.get(ctx.from.id);
    if (!state) {
      await ctx.reply('Нажмите /start, чтобы открыть меню.');
      return;
    }
    const text = ctx.message.text.trim();

    if (state.action === 'set_value') {
      const value = parseFloat(text.replace(',', '.'));
      if (Number.isNaN(value)) {
        await ctx.reply('Это не похоже на число. Введите значение ещё раз, например 25 или 2100:');
        return;
      }
      const metric = db.getMetricById(state.metricId);
      db.recordValue(state.metricId, value);
      pending.delete(ctx.from.id);

      const participant = db.getOrCreateParticipant(ctx.from.id, displayName(ctx));
      const status = value >= metric.min_value ? '🟢 зелёный' : '🔴 красный';
      await ctx.reply(`Сохранено: ${metric.name} = ${formatNum(value)} (${status})`);

      if (metric.sector === 'base') {
        await ctx.reply('Базовый раздел:', renderBaseKeyboard(participant.id));
      } else {
        await ctx.reply('Личный раздел:', renderPersonalKeyboard(participant.id));
      }
      return;
    }

    if (state.action === 'add_personal_name') {
      if (!text) {
        await ctx.reply('Название не может быть пустым, попробуйте ещё раз:');
        return;
      }
      pending.set(ctx.from.id, { action: 'add_personal_min', name: text });
      await ctx.reply(`Название: «${text}». Теперь введите минимальное значение для зелёного статуса (число):`);
      return;
    }

    if (state.action === 'add_personal_min') {
      const min = parseFloat(text.replace(',', '.'));
      if (Number.isNaN(min)) {
        await ctx.reply('Введите число, например 5 или 20:');
        return;
      }
      pending.set(ctx.from.id, { action: 'add_personal_value', name: state.name, min });
      await ctx.reply('Теперь введите текущее значение (или 0, если ещё не начинали):');
      return;
    }

    if (state.action === 'add_personal_value') {
      const value = parseFloat(text.replace(',', '.'));
      if (Number.isNaN(value)) {
        await ctx.reply('Введите число, например 0 или 3:');
        return;
      }
      const participant = db.getOrCreateParticipant(ctx.from.id, displayName(ctx));
      const metric = db.addPersonalMetric(participant.id, state.name, state.min);
      db.recordValue(metric.id, value);
      pending.delete(ctx.from.id);
      await ctx.reply(`Добавлено: «${state.name}» (минимум ${formatNum(state.min)}).`);
      await ctx.reply('Личный раздел:', renderPersonalKeyboard(participant.id));
      return;
    }
  });

  return bot;
}

module.exports = { createBot };
