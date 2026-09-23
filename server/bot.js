const { Telegraf, Markup } = require('telegraf');
const db = require('./db');
const config = require('./config');

// Tracks what the bot is waiting for from a user's next text message,
// since Telegraf has no built-in multi-step form support.
const pending = new Map();

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const SECTOR_TITLES = { base: '🧱 Пункты группы', personal: '🧍 Личные пункты' };
const MODE_RE = 'today|yesterday|week|lastweek|\\d{4}-\\d{2}-\\d{2}';

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

function rangeText(start, end) {
  return start === end ? shortDate(start) : `${shortDate(start)}–${shortDate(end)}`;
}

function unitText(metric) {
  if (metric.type === 'check') return ' дн.';
  return metric.unit ? ` ${metric.unit}` : '';
}

// The day or week values are recorded for, from the participant's stored
// mode. Anything invalid (or in the future) falls back to today.
function resolveMode(mode) {
  const today = db.formatDate(new Date());
  const day = (date, label) => ({
    mode,
    start: date,
    end: date,
    isDay: true,
    label: `${label}${label ? ', ' : ''}${WEEKDAYS_SHORT[db.parseDate(date).getDay()]} ${shortDate(date)}`,
  });
  const week = (range, label) => ({ mode, ...range, isDay: false, label: `${label} ${rangeText(range.start, range.end)}` });

  switch (mode) {
    case 'yesterday':
      return day(db.addDays(today, -1), 'вчера');
    case 'week':
      return week(db.weekOf(today), 'эту неделю');
    case 'lastweek':
      return week(db.weekOf(db.addDays(today, -7)), 'прошлую неделю');
    default:
      if (db.isValidDate(mode) && mode < today) return day(mode, '');
      return { ...day(today, 'сегодня'), mode: 'today' };
  }
}

function groupKeyboard(currentGroupKey) {
  const groups = config.getConfig().groups;
  return Markup.inlineKeyboard(
    groups.map((group) => [
      Markup.button.callback(`${group.key === currentGroupKey ? '✅ ' : ''}${group.name}`, `group:${group.key}`),
    ])
  );
}

function metricLabel(metric, period) {
  const progress = `${formatNum(metric.value)}/${formatNum(metric.minValue)}${unitText(metric)}`;
  if (metric.type === 'check' && period.isDay) {
    const done = db.isCheckedOn(metric.id, period.start);
    return `${done ? '✅' : '⬜'} ${metric.name} · ${progress}`;
  }
  const icon = metric.isGreen ? '🟢' : metric.hasValue ? '🟡' : '⚪';
  return `${icon} ${metric.name} · ${progress}`;
}

function modeRow(sector, period) {
  const button = (label, mode) =>
    Markup.button.callback(`${period.mode === mode ? '✓ ' : ''}${label}`, `mode:${sector}:${mode}`);
  const other = !['today', 'yesterday', 'week'].includes(period.mode);
  return [
    button('Сегодня', 'today'),
    button('Вчера', 'yesterday'),
    button('Неделя', 'week'),
    Markup.button.callback(other ? `✓ 📅 ${rangeText(period.start, period.end)}` : '📅 Другое', `pick:${sector}`),
  ];
}

// The main screen: a button per metric with its weekly progress, the
// day/week being recorded, and navigation.
function entryScreen(participant, sector) {
  const period = resolveMode(participant.entry_mode);
  const week = db.weekOf(period.start);
  const metrics = db.listMetrics(participant, sector, week.start, week.end);

  const rows = metrics.map((metric) => {
    const tap = Markup.button.callback(metricLabel(metric, period), `m:${metric.id}`);
    return sector === 'personal' ? [tap, Markup.button.callback('🗑', `pdel:${metric.id}`)] : [tap];
  });
  if (sector === 'personal') rows.push([Markup.button.callback('➕ Добавить свой пункт', 'padd')]);
  rows.push(modeRow(sector, period));
  rows.push([Markup.button.callback('↩️ Отменить последнюю отметку', `undo:${sector}`)]);
  rows.push(
    sector === 'base'
      ? [Markup.button.callback('🧍 Личные', 'screen:personal'), Markup.button.callback('⚙️ Настройки', 'settings')]
      : [Markup.button.callback('⬅️ Пункты группы', 'screen:base')]
  );

  const group = db.getGroup(participant.group_key);
  const lines = [
    `${group ? `Группа ${group.name} · ` : ''}${SECTOR_TITLES[sector]}`,
    `📅 Отмечаем за: ${period.label}`,
    `Прогресс за неделю ${rangeText(week.start, week.end)} — на кнопках.`,
    '',
  ];
  if (!metrics.length) {
    lines.push(sector === 'personal' ? 'Личных пунктов пока нет — добавьте первый.' : 'В группе пока нет пунктов.');
  } else if (period.isDay) {
    lines.push('Нажмите на пункт и отправьте число. Пункты с ⬜ отмечаются одним нажатием.');
  } else {
    lines.push('Режим недели: нажмите на пункт и отправьте итог сразу за всю неделю.');
  }
  return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows) };
}

// Inline month calendar for recording a past day; one tap picks the day.
function calendarKeyboard(sector, year, month) {
  const today = db.formatDate(new Date());
  const noop = (label) => Markup.button.callback(label, 'noop');
  const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const prev = month === 0 ? [year - 1, 11] : [year, month - 1];
  const next = month === 11 ? [year + 1, 0] : [year, month + 1];

  const rows = [
    [
      Markup.button.callback('‹', `pickm:${sector}:${ym(...prev)}`),
      noop(`${MONTHS[month]} ${year}`),
      ym(...next) <= today.slice(0, 7) ? Markup.button.callback('›', `pickm:${sector}:${ym(...next)}`) : noop(' '),
    ],
    WEEKDAYS.map(noop),
  ];

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let week = Array((first.getDay() + 6) % 7).fill(null).map(() => noop(' '));
  for (let day = 1; day <= daysInMonth; day++) {
    const date = db.formatDate(new Date(year, month, day));
    const label = date === today ? `[${day}]` : String(day);
    week.push(date <= today ? Markup.button.callback(label, `mode:${sector}:${date}`) : noop('·'));
    if (week.length === 7) {
      rows.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(noop(' '));
    rows.push(week);
  }
  rows.push([Markup.button.callback('🗓 Прошлая неделя целиком', `mode:${sector}:lastweek`)]);
  rows.push([Markup.button.callback('⬅️ Назад', `screen:${sector}`)]);
  return Markup.inlineKeyboard(rows);
}

function settingsScreen(participant) {
  const group = db.getGroup(participant.group_key);
  const { reminderTime, summaryTime } = config.getConfig();
  const on = participant.reminders === 1;
  const lines = [
    '⚙️ Настройки',
    '',
    `Группа: ${group ? group.name : 'не выбрана'}`,
    reminderTime
      ? `Вечернее напоминание: ${on ? `включено, в ${reminderTime}` : 'выключено'}`
      : 'Вечерние напоминания отключены администратором',
  ];
  if (summaryTime && on) lines.push(`Итоги недели: по воскресеньям в ${summaryTime}`);
  return {
    text: lines.join('\n'),
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback('🔁 Сменить группу', 'groups')],
      [Markup.button.callback(on ? '🔕 Выключить напоминания' : '🔔 Включить напоминания', on ? 'rem:off' : 'rem:on')],
      [Markup.button.callback('⬅️ Назад', 'screen:base')],
    ]),
  };
}

// Weekly progress of the group metrics, used by /week and the Sunday summary.
function progressText(participant, week, title) {
  const metrics = db.listMetrics(participant, 'base', week.start, week.end);
  const lines = [`${title} ${rangeText(week.start, week.end)}`, ''];
  for (const m of metrics) {
    const icon = m.isGreen ? '🟢' : m.hasValue ? '🔴' : '⚪';
    const best = m.aggregate === 'max' ? ' (лучший результат)' : '';
    lines.push(`${icon} ${m.name} — ${formatNum(m.value)} из ${formatNum(m.minValue)}${unitText(m)}${best}`);
  }
  const green = metrics.filter((m) => m.isGreen).length;
  lines.push('', `Выполнено: ${green} из ${metrics.length} (${db.percentGreen(metrics)}%)`);
  const rank = db.groupRank(participant, week.start, week.end);
  if (rank && rank.of > 1) lines.push(`Место в группе: ${rank.place} из ${rank.of}`);
  if (metrics.length && green === metrics.length) lines.push('🔥 Все цели недели выполнены!');
  return lines.join('\n');
}

// Result line after a number is saved, e.g. "За неделю: 84 из 150 стр., осталось 66".
function savedText(metric, value, period) {
  const when = `за ${period.label}`;
  const total = `${formatNum(metric.value)} из ${formatNum(metric.minValue)}${unitText(metric)}`;
  const left = metric.minValue - metric.value;
  let status = metric.isGreen ? ' 🟢 цель недели выполнена' : '';
  if (!metric.isGreen && metric.aggregate === 'sum') status = `, осталось ${formatNum(Math.round(left * 100) / 100)}`;

  if (metric.aggregate === 'max') {
    return `✅ ${metric.name}: ${formatNum(value)} ${when}\nЛучший за неделю: ${total}${status}`;
  }
  const added = metric.type === 'check' ? `${formatNum(value)} дн.` : `+${formatNum(value)}${unitText(metric)}`;
  return `✅ ${metric.name}: ${added} ${when}\nЗа неделю: ${total}${status}`;
}

function valuePrompt(metric, period) {
  const current = `Сейчас за неделю: ${formatNum(metric.value)} из ${formatNum(metric.minValue)}${unitText(metric)}`;
  if (metric.type === 'check') {
    return `${metric.name} за ${period.label}: сколько дней выполнено? Отправьте число от 0 до 7.\n${current}`;
  }
  if (metric.aggregate === 'max') {
    return `${metric.name} за ${period.label}: отправьте результат числом. В зачёт недели идёт лучший.\n${current}`;
  }
  const example = period.isDay ? 'например 21' : 'итог за неделю, например 150';
  return `${metric.name} за ${period.label}: сколько? Отправьте число, ${example}.\n${current}`;
}

// Accepts "21", "+21", "2,5". Anything else is null.
function parseNumber(text) {
  const match = /^\+?\d+(?:[.,]\d+)?$/.exec(text.trim());
  return match ? parseFloat(match[0].replace(',', '.')) : null;
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

// Replaces the message the button was on. Re-rendering an unchanged screen
// (e.g. tapping the mode that is already selected) is not an error.
async function show(ctx, screen) {
  try {
    await ctx.editMessageText(screen.text, screen.keyboard);
  } catch (error) {
    if (!String(error.description || '').includes('message is not modified')) throw error;
  }
}

// Screens that need a group send the user to pick one first (a new user, a
// tap on an old message, or a group that was deleted in the app).
async function requireGroup(ctx, participant) {
  if (db.getGroup(participant.group_key)) return true;
  await ctx.reply('К какой группе вы относитесь?', groupKeyboard(null));
  return false;
}

function createBot(token) {
  const bot = new Telegraf(token);

  async function openMain(ctx) {
    const participant = participantFor(ctx);
    pending.delete(ctx.from.id);
    if (!(await requireGroup(ctx, participant))) return;
    db.setEntryMode(participant.id, 'today');
    const screen = entryScreen(participantFor(ctx), 'base');
    await ctx.reply(screen.text, screen.keyboard);
  }

  bot.start(async (ctx) => {
    const participant = participantFor(ctx);
    if (!db.getGroup(participant.group_key)) {
      pending.delete(ctx.from.id);
      await ctx.reply(`Привет, ${displayName(ctx)}! 👋\n\nК какой группе вы относитесь?`, groupKeyboard(null));
      return;
    }
    await openMain(ctx);
  });

  bot.command('menu', openMain);

  bot.command('week', async (ctx) => {
    const participant = participantFor(ctx);
    if (!(await requireGroup(ctx, participant))) return;
    const week = db.weekOf(db.formatDate(new Date()));
    await ctx.reply(progressText(participant, week, '📊 Прогресс недели'));
  });

  bot.action('noop', (ctx) => answer(ctx));

  bot.action('groups', async (ctx) => {
    const participant = participantFor(ctx);
    pending.delete(ctx.from.id);
    await answer(ctx);
    await show(ctx, { text: 'К какой группе вы относитесь?', keyboard: groupKeyboard(participant.group_key) });
  });

  bot.action(/^group:(.+)$/, async (ctx) => {
    const group = db.getGroup(ctx.match[1]);
    if (!group) return answer(ctx, 'Такой группы нет');
    const participant = participantFor(ctx);
    db.setParticipantGroup(participant.id, group.key);
    db.setEntryMode(participant.id, 'today');
    await answer(ctx, `Группа ${group.name}`);
    await show(ctx, entryScreen(participantFor(ctx), 'base'));
  });

  bot.action(/^screen:(base|personal)$/, async (ctx) => {
    const participant = participantFor(ctx);
    pending.delete(ctx.from.id);
    await answer(ctx);
    if (!(await requireGroup(ctx, participant))) return;
    await show(ctx, entryScreen(participant, ctx.match[1]));
  });

  bot.action(new RegExp(`^mode:(base|personal):(${MODE_RE})$`), async (ctx) => {
    const [, sector, mode] = ctx.match;
    const participant = participantFor(ctx);
    pending.delete(ctx.from.id);
    await answer(ctx);
    if (!(await requireGroup(ctx, participant))) return;
    db.setEntryMode(participant.id, resolveMode(mode).mode);
    await show(ctx, entryScreen(participantFor(ctx), sector));
  });

  bot.action(/^pick:(base|personal)$/, async (ctx) => {
    const now = new Date();
    await answer(ctx);
    await show(ctx, {
      text: 'За какой день отметить? Выберите дату:',
      keyboard: calendarKeyboard(ctx.match[1], now.getFullYear(), now.getMonth()),
    });
  });

  bot.action(/^pickm:(base|personal):(\d{4})-(\d{2})$/, async (ctx) => {
    const [, sector, year, month] = ctx.match;
    await answer(ctx);
    await show(ctx, {
      text: 'За какой день отметить? Выберите дату:',
      keyboard: calendarKeyboard(sector, Number(year), Number(month) - 1),
    });
  });

  bot.action(/^m:(\d+)$/, async (ctx) => {
    const participant = participantFor(ctx);
    const metric = db.metricForParticipant(Number(ctx.match[1]), participant);
    if (!metric) return answer(ctx, 'Этого пункта больше нет');
    const sector = metric.row.sector;
    const period = resolveMode(participant.entry_mode);
    const week = db.weekOf(period.start);

    if (metric.definition.type === 'check' && period.isDay) {
      const done = db.toggleCheck(metric.row.id, period.start);
      await answer(ctx, done ? `✅ ${metric.definition.name}: отмечено за ${period.label}` : 'Отметка снята');
      await show(ctx, entryScreen(participant, sector));
      return;
    }

    await answer(ctx);
    const status = db.metricStatus(metric.row.id, participant, week.start, week.end);
    pending.set(ctx.from.id, { action: 'value', metricId: metric.row.id, mode: period.mode, sector });
    await ctx.reply(valuePrompt(status, period));
  });

  bot.action(/^undo:(base|personal)$/, async (ctx) => {
    const participant = participantFor(ctx);
    pending.delete(ctx.from.id);
    const removed = db.deleteLastEntry(participant.id);
    await answer(
      ctx,
      removed
        ? `Удалено: ${removed.name} ${formatNum(removed.value)} за ${rangeText(removed.period_start, removed.period_end)}`
        : 'Отметок пока нет'
    );
    if (removed) await show(ctx, entryScreen(participant, ctx.match[1]));
  });

  bot.action('settings', async (ctx) => {
    pending.delete(ctx.from.id);
    await answer(ctx);
    await show(ctx, settingsScreen(participantFor(ctx)));
  });

  bot.action(/^rem:(on|off)$/, async (ctx) => {
    const participant = participantFor(ctx);
    db.setReminders(participant.id, ctx.match[1] === 'on');
    await answer(ctx, ctx.match[1] === 'on' ? 'Напоминания включены' : 'Напоминания выключены');
    await show(ctx, settingsScreen(participantFor(ctx)));
  });

  bot.action('padd', async (ctx) => {
    pending.set(ctx.from.id, { action: 'personal_name' });
    await answer(ctx);
    await ctx.reply('Введите название нового пункта:');
  });

  bot.action(/^pdel:(\d+)$/, async (ctx) => {
    const metric = db.metricForParticipant(Number(ctx.match[1]), participantFor(ctx));
    if (!metric || metric.row.sector !== 'personal') return answer(ctx, 'Этого пункта больше нет');
    await answer(ctx);
    await show(ctx, {
      text: `Удалить «${metric.row.name}» вместе со всеми отметками?`,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('🗑 Да, удалить', `pdelok:${metric.row.id}`)],
        [Markup.button.callback('Отмена', 'screen:personal')],
      ]),
    });
  });

  bot.action(/^pdelok:(\d+)$/, async (ctx) => {
    const participant = participantFor(ctx);
    db.deleteMetric(Number(ctx.match[1]), participant.id);
    await answer(ctx, 'Удалено');
    await show(ctx, entryScreen(participant, 'personal'));
  });

  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const participant = participantFor(ctx);
    const state = pending.get(ctx.from.id);
    const text = ctx.message.text.trim();

    if (!state) {
      if (!(await requireGroup(ctx, participant))) return;
      const screen = entryScreen(participant, 'base');
      await ctx.reply(`Сначала выберите пункт кнопкой, потом отправьте число.\n\n${screen.text}`, screen.keyboard);
      return;
    }

    if (state.action === 'value') {
      const metric = db.metricForParticipant(state.metricId, participant);
      if (!metric) {
        pending.delete(ctx.from.id);
        await ctx.reply('Этого пункта больше нет. Нажмите /menu.');
        return;
      }
      const period = resolveMode(state.mode);
      const value = parseNumber(text);
      const maxDays = period.isDay ? 1 : 7;
      if (value === null) {
        await ctx.reply('Это не похоже на число. Отправьте, например, 21:');
        return;
      }
      if (metric.definition.type === 'check' && (!Number.isInteger(value) || value > maxDays)) {
        await ctx.reply(`Отправьте целое число дней от 0 до ${maxDays}:`);
        return;
      }
      db.recordValue(metric.row.id, value, period.start, period.end);
      pending.delete(ctx.from.id);

      const week = db.weekOf(period.start);
      await ctx.reply(savedText(db.metricStatus(metric.row.id, participant, week.start, week.end), value, period));
      const screen = entryScreen(participantFor(ctx), state.sector);
      await ctx.reply(screen.text, screen.keyboard);
      return;
    }

    if (state.action === 'personal_name') {
      if (!text) {
        await ctx.reply('Название не может быть пустым, попробуйте ещё раз:');
        return;
      }
      pending.set(ctx.from.id, { action: 'personal_target', name: text.slice(0, 40) });
      await ctx.reply(`Название: «${text.slice(0, 40)}». Какая цель на неделю? Отправьте число, например 5 или 150:`);
      return;
    }

    if (state.action === 'personal_target') {
      const target = parseNumber(text);
      if (target === null) {
        await ctx.reply('Отправьте число, например 5 или 150:');
        return;
      }
      db.addPersonalMetric(participant.id, state.name, target);
      pending.delete(ctx.from.id);
      await ctx.reply(`Добавлено: «${state.name}», цель ${formatNum(target)} в неделю.`);
      const screen = entryScreen(participant, 'personal');
      await ctx.reply(screen.text, screen.keyboard);
    }
  });

  // Without this, any error inside a handler crashes the whole server.
  bot.catch((error, ctx) => {
    console.error(`Error handling update ${ctx.update.update_id}:`, error);
  });

  return bot;
}

// Sends a message to everyone with reminders on. A user who blocked the bot
// gets reminders switched off instead of failing on every run.
async function broadcast(bot, build) {
  for (const participant of db.participantsForReminders()) {
    try {
      const message = build(participant);
      if (message) await bot.telegram.sendMessage(participant.telegram_id, message.text, message.extra);
    } catch (error) {
      if (error.code === 403) {
        db.setReminders(participant.id, false);
        console.warn(`Participant ${participant.id} blocked the bot; reminders switched off`);
      } else {
        console.error(`Failed to message participant ${participant.id}:`, error.description || error.message);
      }
    }
  }
}

function sendEveningReminders(bot) {
  return broadcast(bot, (participant) => {
    if (!db.getGroup(participant.group_key)) return null;
    db.setEntryMode(participant.id, 'today');
    const screen = entryScreen(db.getParticipant(participant.id), 'base');
    return {
      text: `🌙 Добрый вечер! Что сегодня сделано?\nЗабыли вчера — нажмите «Вчера».\n\n${screen.text}`,
      extra: screen.keyboard,
    };
  });
}

function sendWeeklySummaries(bot) {
  const week = db.weekOf(db.formatDate(new Date()));
  return broadcast(bot, (participant) => {
    if (!db.getGroup(participant.group_key)) return null;
    return { text: progressText(participant, week, '📊 Итоги недели'), extra: {} };
  });
}

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// A job fires once per day, at or after its time. The window keeps a server
// started late at night from sending a stale evening reminder.
const LATE_WINDOW_MINUTES = 120;

function isDue(time, now, lastRunKey) {
  if (!time) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const at = minutesOf(time);
  return nowMinutes >= at && nowMinutes < at + LATE_WINDOW_MINUTES && db.getState(lastRunKey) !== db.formatDate(now);
}

// Checks the clock every 30 seconds; the last run date is stored in the
// database, so restarts don't resend.
function startScheduler(bot) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const today = db.formatDate(now);
      const { reminderTime, summaryTime } = config.getConfig();
      if (isDue(reminderTime, now, 'last_reminder')) {
        db.setState('last_reminder', today);
        await sendEveningReminders(bot);
      }
      if (now.getDay() === 0 && isDue(summaryTime, now, 'last_summary')) {
        db.setState('last_summary', today);
        await sendWeeklySummaries(bot);
      }
    } catch (error) {
      console.error('Scheduler error:', error);
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, 30_000);
  return () => clearInterval(timer);
}

module.exports = { createBot, startScheduler };
