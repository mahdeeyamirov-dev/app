const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

function addDays(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function currentStreak(completedDatesDesc) {
  const set = new Set(completedDatesDesc);
  let streak = 0;
  let day = todayStr();
  while (set.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

function dayWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

function createBot(token) {
  const bot = new Telegraf(token);

  bot.start((ctx) => {
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'Без имени';
    db.getOrCreateParticipant(ctx.from.id, name);
    ctx.reply(
      `Привет, ${name}! 👋\n\n` +
        'Я помогу отслеживать привычки.\n\n' +
        'Команды:\n' +
        '/add <название> — добавить привычку\n' +
        '/today — отметить привычки за сегодня\n' +
        '/habits — список привычек и серии\n' +
        '/delete — удалить привычку'
    );
  });

  bot.command('add', (ctx) => {
    const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!name) {
      return ctx.reply('Напишите название после команды, например:\n/add Читать 20 минут');
    }
    const participant = db.getOrCreateParticipant(ctx.from.id, ctx.from.first_name || 'Без имени');
    db.addHabit(participant.id, name);
    ctx.reply(`Привычка «${name}» добавлена. Используйте /today, чтобы отмечать выполнение.`);
  });

  bot.command('today', (ctx) => {
    const participant = db.getOrCreateParticipant(ctx.from.id, ctx.from.first_name || 'Без имени');
    const habits = db.listHabits(participant.id);
    if (habits.length === 0) {
      return ctx.reply('У вас пока нет привычек. Добавьте первую: /add Название');
    }
    const today = todayStr();
    const buttons = habits.map((habit) => {
      const done = db.isCompletedOn(habit.id, today);
      const label = `${done ? '✅' : '⬜️'} ${habit.name}`;
      return [Markup.button.callback(label, `toggle:${habit.id}`)];
    });
    ctx.reply('Отметьте, что выполнили сегодня:', Markup.inlineKeyboard(buttons));
  });

  bot.action(/toggle:(\d+)/, async (ctx) => {
    const habitId = Number(ctx.match[1]);
    const habit = db.getHabitById(habitId);
    if (!habit) {
      await ctx.answerCbQuery('Привычка не найдена');
      return;
    }
    const today = todayStr();
    db.toggleCompletion(habitId, today);

    const participant = db.getOrCreateParticipant(ctx.from.id, ctx.from.first_name || 'Без имени');
    const habits = db.listHabits(participant.id);
    const buttons = habits.map((h) => {
      const done = db.isCompletedOn(h.id, today);
      const label = `${done ? '✅' : '⬜️'} ${h.name}`;
      return [Markup.button.callback(label, `toggle:${h.id}`)];
    });
    await ctx.editMessageReplyMarkup({ inline_keyboard: buttons.map((row) => row.map((b) => b)) });
    await ctx.answerCbQuery(db.isCompletedOn(habitId, today) ? 'Отмечено ✅' : 'Отметка снята');
  });

  bot.command('habits', (ctx) => {
    const participant = db.getOrCreateParticipant(ctx.from.id, ctx.from.first_name || 'Без имени');
    const habits = db.listHabits(participant.id);
    if (habits.length === 0) {
      return ctx.reply('У вас пока нет привычек. Добавьте первую: /add Название');
    }
    const lines = habits.map((habit) => {
      const dates = db.completedDates(habit.id);
      const streak = currentStreak(dates);
      const streakText = streak > 0 ? `серия: ${streak} ${dayWord(streak)}` : 'пока без серии';
      return `• ${habit.name} — ${streakText}`;
    });
    ctx.reply(lines.join('\n'));
  });

  bot.command('delete', (ctx) => {
    const participant = db.getOrCreateParticipant(ctx.from.id, ctx.from.first_name || 'Без имени');
    const habits = db.listHabits(participant.id);
    if (habits.length === 0) {
      return ctx.reply('У вас пока нет привычек для удаления.');
    }
    const buttons = habits.map((habit) => [Markup.button.callback(`🗑 ${habit.name}`, `delete:${habit.id}`)]);
    ctx.reply('Какую привычку удалить?', Markup.inlineKeyboard(buttons));
  });

  bot.action(/delete:(\d+)/, async (ctx) => {
    const habitId = Number(ctx.match[1]);
    const participant = db.getOrCreateParticipant(ctx.from.id, ctx.from.first_name || 'Без имени');
    db.deleteHabit(habitId, participant.id);
    await ctx.editMessageText('Привычка удалена.');
    await ctx.answerCbQuery();
  });

  return bot;
}

module.exports = { createBot, currentStreak, todayStr };
