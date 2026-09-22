const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

// Tracks what the bot is waiting for from a user's next text message,
// since Telegraf has no built-in multi-step form support.
const pending = new Map();

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const SECTOR_TITLES = { base: '🧱 Базовый', personal: '🧍 Личный' };

function displayName(ctx) {
  return (
    [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'Без имени'
  );
}

function participantFor(ctx) {
  return db.getOrCreateParticipant(ctx.from.id, displayName(ctx));
}

function formatNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

// '2026-09-15' → '15.09'
function shortDate(isoDate) {
  const [, m, d] = isoDate.split('-');
  return `${d}.${m}`;
}

function periodText(start, end) {
  return start === end ? shortDate(start) : `${shortDate(start)}–${shortDate(end)}`;
}

function groupKeyboard(currentGroupKey) {
  return Markup.inlineKeyboard(
    db.GROUPS.map((group) => [
      Markup.button.callback(`${group.key === currentGroupKey ? '✅ ' : ''}${group.name}`, `group:${group.key}`),
    ])
  );
}

function sectorMenu(participant) {
  const group = db.getGroup(participant.group_key);
  return {
    text: `Группа: ${group.name}\n\nВыберите раздел:\n` +
      '🧱 Базовый — общие показатели группы с фиксированным минимумом\n' +
      '🧍 Личный — ваши собственные показатели',
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback(SECTOR_TITLES.base, 'sector:base')],
      [Markup.button.callback(SECTOR_TITLES.personal, 'sector:personal')],
      [Markup.button.callback('🔁 Сменить группу', 'groups')],
    ]),
  };
}

// Inline month calendar. Picking a period takes two taps: the first day
// (start is '-') and then the last day, which is carried in the callback
// data so the bot stays stateless between the two taps.
function calendarKeyboard(sector, start, year, month) {
  const today = db.formatDate(new Date());
  const noop = (label) => Markup.button.callback(label, 'noop');
  const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const prev = month === 0 ? [year - 1, 11] : [year, month - 1];
  const next = month === 11 ? [year + 1, 0] : [year, month + 1];
  const startKey = start || '-';

  const rows = [
    [
      Markup.button.callback('‹', `caln:${sector}:${startKey}:${ym(...prev)}`),
      noop(`${MONTHS[month]} ${year}`),
      ym(...next) <= today.slice(0, 7)
        ? Markup.button.callback('›', `caln:${sector}:${startKey}:${ym(...next)}`)
        : noop(' '),
    ],
    WEEKDAYS.map(noop),
  ];

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let week = Array((first.getDay() + 6) % 7).fill(null).map(() => noop(' '));
  for (let day = 1; day <= daysInMonth; day++) {
    const date = db.formatDate(new Date(year, month, day));
    const selectable = date <= today && (!start || date >= start);
    const label = date === start ? `[${day}]` : String(day);
    week.push(selectable ? Markup.button.callback(label, `cal:${sector}:${startKey}:${date}`) : noop('·'));
    if (week.length === 7) {
      rows.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(noop(' '));
    rows.push(week);
  }
  rows.push([Markup.button.callback('⬅️ Назад', 'menu')]);
  return Markup.inlineKeyboard(rows);
}

function calendarPrompt(sector, start) {
  return start
    ? `${SECTOR_TITLES[sector]}\n\nНачало периода: ${shortDate(start)}.\n` +
        'Теперь выберите дату КОНЦА периода (если это один день — нажмите ту же дату ещё раз):'
    : `${SECTOR_TITLES[sector]}\n\nЗа какой период вы вносите показатели?\nВыберите дату НАЧАЛА периода:`;
}

function metricButtonLabel(metric) {
  const icon = !metric.hasValue ? '⚪' : metric.isGreen ? '🟢' : '🔴';
  const value = metric.hasValue ? formatNum(metric.value) : '—';
  return `${icon} ${metric.name}: ${value}/${formatNum(metric.minValue)}`;
}

function metricsScreen(participant, sector) {
  const { period_start: start, period_end: end } = participant;
  const metrics = db.listMetrics(participant, sector, start, end);
  const buttons = metrics.map((metric) =>
    sector === 'base'
      ? [Markup.button.callback(metricButtonLabel(metric), `metric:edit:${metric.id}`)]
      : [
          Markup.button.callback(metricButtonLabel(metric), `metric:edit:${metric.id}`),
          Markup.button.callback('🗑', `personal:delete:${metric.id}`),
        ]
  );
  if (sector === 'personal') buttons.push([Markup.button.callback('➕ Добавить', 'personal:add')]);
  buttons.push([Markup.button.callback('📅 Сменить период', `sector:${sector}`)]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'menu')]);

  let header = `${SECTOR_TITLES[sector]} · период ${periodText(start, end)}`;
  if (sector === 'base') header = `Группа ${participant.group_key} · ${header}`;
  const hint = metrics.length
    ? 'Нажмите на показатель, чтобы ввести значение за этот период:'
    : 'Здесь пока пусто. Добавьте свой первый показатель:';
  return { text: `${header}\n\n${hint}`, keyboard: Markup.inlineKeyboard(buttons) };
}

// Telegram rejects answers to button taps older than ~15 seconds — e.g. taps
// made while the server was off and delivered on the next start. The answer
// only dismisses the spinner on the button, so failing it must not stop the
// handler from showing the menu.
async function answer(ctx, text) {
  try {
    await ctx.answerCbQuery(text);
  } catch (error) {
    console.warn('answerCbQuery failed:', error.description || error.message);
  }
}

// Screens that need a group or a period send the user back a step when the
// state is missing (e.g. a tap on an old message from before groups existed).
async function requireGroup(ctx, participant) {
  if (db.getGroup(participant.group_key)) return true;
  await ctx.reply('Сначала выберите вашу группу:', groupKeyboard(null));
  return false;
}

function createBot(token) {
  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    const participant = participantFor(ctx);
    pending.delete(ctx.from.id);
    await ctx.reply(`Привет, ${displayName(ctx)}! 👋\n\nК какой группе вы относитесь?`, groupKeyboard(participant.group_key));
  });

  bot.action('noop', (ctx) => answer(ctx));

  bot.action('groups', async (ctx) => {
    const participant = participantFor(ctx);
    pending.delete(ctx.from.id);
    await ctx.editMessageText('К какой группе вы относитесь?', groupKeyboard(participant.group_key));
    await answer(ctx);
  });

  bot.action(/^group:(.+)$/, async (ctx) => {
    const group = db.getGroup(ctx.match[1]);
    if (!group) return answer(ctx, 'Такой группы нет');
    const participant = participantFor(ctx);
    db.setParticipantGroup(participant.id, group.key);
    const menu = sectorMenu(participantFor(ctx));
    await ctx.editMessageText(menu.text, menu.keyboard);
    await answer(ctx, `Группа ${group.name}`);
  });

  bot.action('menu', async (ctx) => {
    pending.delete(ctx.from.id);
    const participant = participantFor(ctx);
    await answer(ctx);
    if (!(await requireGroup(ctx, participant))) return;
    const menu = sectorMenu(participant);
    await ctx.editMessageText(menu.text, menu.keyboard);
  });

  bot.action(/^sector:(base|personal)$/, async (ctx) => {
    const sector = ctx.match[1];
    const participant = participantFor(ctx);
    pending.delete(ctx.from.id);
    await answer(ctx);
    if (!(await requireGroup(ctx, participant))) return;
    const now = new Date();
    await ctx.editMessageText(
      calendarPrompt(sector, null),
      calendarKeyboard(sector, null, now.getFullYear(), now.getMonth())
    );
  });

  bot.action(/^caln:(base|personal):([\d-]+):(\d{4})-(\d{2})$/, async (ctx) => {
    const [, sector, startKey, year, month] = ctx.match;
    const start = startKey === '-' ? null : startKey;
    await answer(ctx);
    await ctx.editMessageText(
      calendarPrompt(sector, start),
      calendarKeyboard(sector, start, Number(year), Number(month) - 1)
    );
  });

  bot.action(/^cal:(base|personal):([\d-]+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const [, sector, startKey, date] = ctx.match;
    await answer(ctx);
    if (startKey === '-') {
      const d = db.parseDate(date);
      await ctx.editMessageText(
        calendarPrompt(sector, date),
        calendarKeyboard(sector, date, d.getFullYear(), d.getMonth())
      );
      return;
    }
    const participant = participantFor(ctx);
    if (!(await requireGroup(ctx, participant))) return;
    db.setParticipantPeriod(participant.id, startKey, date);
    const screen = metricsScreen(participantFor(ctx), sector);
    await ctx.editMessageText(screen.text, screen.keyboard);
  });

  bot.action(/^metric:edit:(\d+)$/, async (ctx) => {
    const metricId = Number(ctx.match[1]);
    const metric = db.getMetricById(metricId);
    const participant = participantFor(ctx);
    if (!metric || metric.participant_id !== participant.id) {
      await answer(ctx, 'Показатель не найден');
      return;
    }
    await answer(ctx);
    if (!participant.period_start) {
      await ctx.reply('Сначала выберите период:', Markup.inlineKeyboard([
        [Markup.button.callback('📅 Выбрать период', `sector:${metric.sector}`)],
      ]));
      return;
    }
    pending.set(ctx.from.id, { action: 'set_value', metricId });
    await ctx.reply(
      `Введите значение «${metric.name}» за ${periodText(participant.period_start, participant.period_end)} ` +
        `(минимум для зелёного статуса: ${formatNum(metric.min_value)}):`
    );
  });

  bot.action('personal:add', async (ctx) => {
    pending.set(ctx.from.id, { action: 'add_personal_name' });
    await answer(ctx);
    await ctx.reply('Введите название нового показателя:');
  });

  bot.action(/^personal:delete:(\d+)$/, async (ctx) => {
    const metricId = Number(ctx.match[1]);
    const participant = participantFor(ctx);
    db.deleteMetric(metricId, participant.id);
    await answer(ctx, 'Удалено');
    const screen = metricsScreen(participant, 'personal');
    await ctx.editMessageText(screen.text, screen.keyboard);
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
      const participant = participantFor(ctx);
      const metric = db.getMetricById(state.metricId);
      db.recordValue(state.metricId, value, participant.period_start, participant.period_end);
      pending.delete(ctx.from.id);

      const status = value >= metric.min_value ? '🟢 зелёный' : '🔴 красный';
      await ctx.reply(
        `Сохранено: ${metric.name} = ${formatNum(value)} за ${periodText(participant.period_start, participant.period_end)} (${status})`
      );
      const screen = metricsScreen(participant, metric.sector);
      await ctx.reply(screen.text, screen.keyboard);
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
      const participant = participantFor(ctx);
      pending.set(ctx.from.id, { action: 'add_personal_value', name: state.name, min });
      await ctx.reply(
        `Теперь введите значение за ${periodText(participant.period_start, participant.period_end)} (или 0, если ещё не начинали):`
      );
      return;
    }

    if (state.action === 'add_personal_value') {
      const value = parseFloat(text.replace(',', '.'));
      if (Number.isNaN(value)) {
        await ctx.reply('Введите число, например 0 или 3:');
        return;
      }
      const participant = participantFor(ctx);
      const metric = db.addPersonalMetric(participant.id, state.name, state.min);
      db.recordValue(metric.id, value, participant.period_start, participant.period_end);
      pending.delete(ctx.from.id);
      await ctx.reply(`Добавлено: «${state.name}» (минимум ${formatNum(state.min)}).`);
      const screen = metricsScreen(participant, 'personal');
      await ctx.reply(screen.text, screen.keyboard);
      return;
    }
  });

  // Without this, any error inside a handler crashes the whole server.
  bot.catch((error, ctx) => {
    console.error(`Error handling update ${ctx.update.update_id}:`, error);
  });

  return bot;
}

module.exports = { createBot };
