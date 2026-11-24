#!/usr/bin/env node
/**
 * Telegram-бот «ХайпОтвет» (без внешних зависимостей, работает на Node 18+).
 * Функции:
 *  - Deep Linking: /start q_<id> (или n_<idx>) — сразу присылает карточку конкретного вопроса с сайта
 *  - Команда /status (и /start status) — актуальный статус сервисов из редактируемого файла bot/status.txt
 *  - Подписка на обновления (/subscribe, /unsubscribe, хранится в bot/subscribers.json)
 *  - Приём предложенных вопросов (пересылка админу + Reply прямо пользователю)
 *  - Поиск по всей базе из 1 000+ разборов сайта и случайный разбор
 *
 * Запуск: node bot.mjs (из папки bot) или node bot/bot.mjs (из корня)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const BOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(BOT_DIR, "..");
const ENV_PATH = path.join(BOT_DIR, ".env");
const STATE_PATH = path.join(BOT_DIR, "state.json");
const SUGGESTIONS_PATH = path.join(BOT_DIR, "suggestions.json");
const SUBSCRIBERS_PATH = path.join(BOT_DIR, "subscribers.json");
const STATUS_PATH = path.join(BOT_DIR, "status.txt");

/* ---------- Load .env ---------- */
const loadEnv = () => {
  if (!fs.existsSync(ENV_PATH)) return;
  for (const raw of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
};
loadEnv();

const TOKEN = process.env.BOT_TOKEN;
const SITE_URL = (process.env.SITE_URL || "https://hypeotvet.netlify.app").replace(/\/+$/, "");
const CHANNEL_URL = process.env.CHANNEL_URL || "https://t.me/hypeotvet";
if (!TOKEN) {
  console.error("Ошибка: не задан BOT_TOKEN в bot/.env");
  process.exit(1);
}

/* ---------- Load site Q&A base (1000+ questions) ---------- */
const sandbox = { window: {} };
vm.createContext(sandbox);
const runJs = (f) => vm.runInContext(fs.readFileSync(f, "utf8"), sandbox, { filename: f });
runJs(path.join(ROOT, "data.js"));
const packDir = path.join(ROOT, "data");
if (fs.existsSync(packDir)) {
  for (const f of fs.readdirSync(packDir).filter((x) => x.endsWith(".js")).sort()) {
    runJs(path.join(packDir, f));
  }
}
const { categories, questions } = sandbox.window.SITE_DATA;
const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
const qById = Object.fromEntries(questions.map((q) => [q.id, q]));

/* ---------- Persistent state & subscribers ---------- */
let state = { adminChatId: process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null, replyMap: {} };
try {
  if (fs.existsSync(STATE_PATH)) {
    state = { ...state, ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) };
    if (process.env.ADMIN_CHAT_ID) state.adminChatId = Number(process.env.ADMIN_CHAT_ID);
  }
} catch {}
const saveState = () => {
  const keys = Object.keys(state.replyMap);
  if (keys.length > 500) {
    for (const k of keys.slice(0, keys.length - 500)) delete state.replyMap[k];
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
};

const loadSubs = () => {
  try { return new Set(JSON.parse(fs.readFileSync(SUBSCRIBERS_PATH, "utf8"))); }
  catch { return new Set(); }
};
const subs = loadSubs();
const saveSubs = () => fs.writeFileSync(SUBSCRIBERS_PATH, JSON.stringify([...subs], null, 2), "utf8");

const saveSuggestion = (entry) => {
  let list = [];
  try { if (fs.existsSync(SUGGESTIONS_PATH)) list = JSON.parse(fs.readFileSync(SUGGESTIONS_PATH, "utf8")); } catch {}
  list.unshift(entry);
  fs.writeFileSync(SUGGESTIONS_PATH, JSON.stringify(list.slice(0, 1000), null, 2), "utf8");
};

const SETUP_CODE = crypto.randomBytes(3).toString("hex");
const userMode = new Map();

const htmlToPlain = (html) =>
  String(html)
    .replace(/<h[23][^>]*>(.*?)<\/h[23]>/gi, "\n\n$1:\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|tr|div|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/* ---------- Search helper ---------- */
const searchBase = (query) => {
  const words = query.toLowerCase().replace(/ё/g, "е").split(/[\s,.;:!?/\\()«»"']+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  return questions
    .map((q) => {
      const title = q.title.toLowerCase().replace(/ё/g, "е");
      const body = (q.short + " " + (q.keywords || "")).toLowerCase().replace(/ё/g, "е");
      let score = 0;
      for (const w of words) {
        const stem = w.length > 5 ? w.slice(0, -2) : w;
        if (title.includes(stem)) score += 6;
        else if (body.includes(stem)) score += 2;
      }
      return { q, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.q);
};

/* ---------- Telegram Bot API wrapper ---------- */
const tg = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`TG ${method}: ${data.description || res.status}`);
  return data.result;
};

const mainMenu = (chatId) => ({
  inline_keyboard: [
    [{ text: "Предложить вопрос для разбора", callback_data: "mode:suggest" }],
    [{ text: "Найти ответ в базе (" + questions.length + ")", callback_data: "mode:search" }],
    [
      { text: "Случайный разбор", callback_data: "random" },
      { text: "Статус сервисов", callback_data: "status" }
    ],
    [
      { text: subs.has(chatId) ? "Отписаться от обновлений" : "Подписаться на обновления", callback_data: subs.has(chatId) ? "sub:off" : "sub:on" }
    ],
    [
      { text: "Открыть сайт", url: SITE_URL },
      { text: "Наш Telegram-канал", url: CHANNEL_URL }
    ]
  ]
});

const sendWelcome = (chatId) =>
  tg("sendMessage", {
    chat_id: chatId,
    text:
      `Привет! Это бот «ХайпОтвет».\n\n` +
      `В базе уже ${questions.length} разборов по ${categories.length} темам: ремонт и сантехника, ЖКХ и Госуслуги, смартфоны и iCloud, авто, права, игры и нейросети.\n\n` +
      `Напишите свой вопрос прямо сюда или выберите действие ниже:`,
    reply_markup: mainMenu(chatId)
  });

const sendQuestionCard = (chatId, q) => {
  const c = catById[q.cat];
  const plain = htmlToPlain(q.answer);
  const excerpt = plain.length > 1400 ? plain.slice(0, 1400).trim() + "…" : plain;
  const subBtn = subs.has(chatId)
    ? { text: "Вы подписаны на апдейты (отписаться)", callback_data: "sub:off" }
    : { text: "Подписаться на обновления разборов", callback_data: "sub:on" };

  return tg("sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    text:
      `Шпаргалка · ${c.title}\n\n` +
      `${q.title}\n\n` +
      `Коротко: ${q.short}\n\n` +
      `${excerpt}\n\n` +
      `Полная версия с таблицами и интерактивом:\n${SITE_URL}/q/${q.id}/`,
    reply_markup: {
      inline_keyboard: [
        [subBtn],
        [
          { text: "Открыть на сайте", url: `${SITE_URL}/q/${q.id}/` },
          { text: "Наш канал", url: CHANNEL_URL }
        ],
        [{ text: "Найти другой вопрос", callback_data: "mode:search" }]
      ]
    }
  });
};

const sendStatus = (chatId) => {
  const txt = fs.existsSync(STATUS_PATH)
    ? fs.readFileSync(STATUS_PATH, "utf8").trim()
    : `Актуальные разборы по доступным сервисам смотрите на сайте: ${SITE_URL}/c/access/`;
  return tg("sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    text: txt,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Раздел «Нейросети без VPN»", url: `${SITE_URL}/c/neuro/` }],
        [{ text: "Раздел «Сервисы и оплаты в РФ»", url: `${SITE_URL}/c/access/` }],
        [{ text: "Предложить вопрос", callback_data: "mode:suggest" }]
      ]
    }
  });
};

const sendRandom = (chatId) => {
  const q = questions[Math.floor(Math.random() * questions.length)];
  return sendQuestionCard(chatId, q);
};

const handleSearch = async (chatId, query) => {
  const found = searchBase(query);
  if (!found.length) {
    return tg("sendMessage", {
      chat_id: chatId,
      text: `По запросу «${query}» готового разбора пока нет.\nХотите отправить этот вопрос автору на разбор?`,
      reply_markup: {
        inline_keyboard: [[{ text: "Да, предложить этот вопрос", callback_data: "mode:suggest" }]]
      }
    });
  }
  const lines = found.map((q, i) => `${i + 1}. ${q.title}\n${q.short}\n${SITE_URL}/q/${q.id}/`);
  return tg("sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    text: `Нашёл в базе по запросу «${query}»:\n\n${lines.join("\n\n")}`,
    reply_markup: {
      inline_keyboard: [[{ text: "Предложить другой вопрос", callback_data: "mode:suggest" }]]
    }
  });
};

const handleSuggestion = async (msg, text) => {
  const chatId = msg.chat.id;
  const from = msg.from || {};
  const userLabel = from.username ? `@${from.username}` : [from.first_name, from.last_name].filter(Boolean).join(" ") || `ID ${chatId}`;

  saveSuggestion({ chatId, user: userLabel, text, at: new Date().toISOString() });

  if (state.adminChatId && state.adminChatId !== chatId) {
    const sent = await tg("sendMessage", {
      chat_id: state.adminChatId,
      text: `Новый вопрос от ${userLabel} (id: ${chatId}):\n\n${text}\n\n(Чтобы ответить пользователю — сделайте Reply на это сообщение)`
    });
    state.replyMap[String(sent.message_id)] = chatId;
    saveState();
  } else {
    console.log(`[Вопрос от ${userLabel}]: ${text}`);
  }

  const alsoFound = searchBase(text).slice(0, 2);
  let reply = "Спасибо! Вопрос принят и передан в редакцию «ХайпОтвет».";
  if (alsoFound.length) {
    reply += "\n\nВозможно, вам уже подойдут эти готовые разборы:\n" +
      alsoFound.map((q) => `— ${q.title}\n${SITE_URL}/q/${q.id}/`).join("\n");
  }
  userMode.delete(chatId);
  return tg("sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    text: reply,
    reply_markup: mainMenu(chatId)
  });
};

/* ---------- Update handler ---------- */
const handleUpdate = async (u) => {
  if (u.callback_query) {
    const cq = u.callback_query;
    const chatId = cq.message.chat.id;
    await tg("answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    if (cq.data === "mode:suggest") {
      userMode.set(chatId, "suggest");
      return tg("sendMessage", {
        chat_id: chatId,
        text: "Напишите одним сообщением вопрос, который нужно разобрать на сайте (если скопировали его с сайта — просто вставьте и отправьте)."
      });
    }
    if (cq.data === "mode:search") {
      userMode.set(chatId, "search");
      return tg("sendMessage", {
        chat_id: chatId,
        text: "Напишите ключевые слова для поиска по базе (например: «засор в раковине», «пополнить стим», «показания воды»)."
      });
    }
    if (cq.data === "random") return sendRandom(chatId);
    if (cq.data === "status") return sendStatus(chatId);
    if (cq.data === "sub:on") {
      subs.add(chatId);
      saveSubs();
      return tg("sendMessage", { chat_id: chatId, text: "Готово! Вы подписаны на важные обновления разборов. Отписаться можно в любой момент командой /unsubscribe." });
    }
    if (cq.data === "sub:off") {
      subs.delete(chatId);
      saveSubs();
      return tg("sendMessage", { chat_id: chatId, text: "Вы отписаны от обновлений бота." });
    }
    return;
  }

  const msg = u.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Admin reply to forwarded user suggestion
  if (state.adminChatId && chatId === state.adminChatId && msg.reply_to_message) {
    const target = state.replyMap[String(msg.reply_to_message.message_id)];
    if (target) {
      await tg("sendMessage", { chat_id: target, text: `Ответ от редакции «ХайпОтвет»:\n\n${text}` });
      return tg("sendMessage", { chat_id: chatId, text: "Ответ отправлен пользователю." });
    }
  }

  if (text === "/myid") return tg("sendMessage", { chat_id: chatId, text: `Ваш Telegram Chat ID: ${chatId}` });
  if (text === "/stats" && state.adminChatId && chatId === state.adminChatId) {
    return tg("sendMessage", { chat_id: chatId, text: `Вопросов в базе: ${questions.length}\nПодписчиков на обновления в боте: ${subs.size}` });
  }
  if (text.startsWith("/setadmin ")) {
    const code = text.slice("/setadmin ".length).trim();
    if (code === SETUP_CODE) {
      state.adminChatId = chatId;
      saveState();
      return tg("sendMessage", { chat_id: chatId, text: `Готово! Теперь вы администратор (ID ${chatId}). Все предложенные вопросы будут приходить сюда.` });
    }
    return tg("sendMessage", { chat_id: chatId, text: "Неверный код настройки. Посмотрите актуальный код в терминале при запуске бота." });
  }
  if (text === "/status") return sendStatus(chatId);
  if (text === "/subscribe") {
    subs.add(chatId); saveSubs();
    return tg("sendMessage", { chat_id: chatId, text: "Вы подписаны на обновления разборов. Отписаться: /unsubscribe." });
  }
  if (text === "/unsubscribe") {
    subs.delete(chatId); saveSubs();
    return tg("sendMessage", { chat_id: chatId, text: "Вы отписаны от обновлений." });
  }
  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] || "";
    if (payload === "suggest") {
      userMode.set(chatId, "suggest");
      return tg("sendMessage", {
        chat_id: chatId,
        text: "Отправьте ваш вопрос следующим сообщением (если скопировали его на сайте — просто вставьте). Он сразу попадёт в редакцию «ХайпОтвет»."
      });
    }
    if (payload === "status") return sendStatus(chatId);
    if (payload.startsWith("q_")) {
      const q = qById[payload.slice(2)];
      if (q) return sendQuestionCard(chatId, q);
    }
    if (payload.startsWith("n_")) {
      const q = questions[Number(payload.slice(2))];
      if (q) return sendQuestionCard(chatId, q);
    }
    userMode.delete(chatId);
    return sendWelcome(chatId);
  }
  if (text === "/random") return sendRandom(chatId);
  if (text.startsWith("/find ")) return handleSearch(chatId, text.slice(6).trim());

  const mode = userMode.get(chatId);
  if (mode === "search") {
    userMode.delete(chatId);
    return handleSearch(chatId, text);
  }
  return handleSuggestion(msg, text);
};

/* ---------- Startup & Long Polling ---------- */
const start = async () => {
  const me = await tg("getMe");
  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "Главное меню" },
      { command: "status", description: "Актуальный статус сервисов" },
      { command: "random", description: "Случайный разбор" },
      { command: "subscribe", description: "Подписаться на обновления" },
      { command: "unsubscribe", description: "Отписаться от обновлений" }
    ]
  }).catch(() => {});

  console.log(`Бот запущен: @${me.username} (${me.first_name})`);
  console.log(`Загружено вопросов из базы сайта: ${questions.length}, подписчиков: ${subs.size}`);
  if (!state.adminChatId) {
    console.log(`\nЧтобы вопросы приходили вам в личку, отправьте боту @${me.username} команду:`);
    console.log(`  /setadmin ${SETUP_CODE}\n`);
  } else {
    console.log(`Администратор привязан: chat_id=${state.adminChatId}`);
  }

  let offset = 0;
  while (true) {
    try {
      const updates = await tg("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u).catch((err) => console.error("Ошибка обработки:", err.message));
      }
    } catch (err) {
      console.error("Ошибка polling:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
};

start().catch((err) => {
  console.error("Не удалось запустить бота:", err.message);
  process.exit(1);
});
