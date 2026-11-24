/**
 * Netlify Function (24/7 Telegram Webhook) для бота «ХайпОтвет».
 * URL после деплоя: https://hypeotvet.netlify.app/.netlify/functions/telegram-bot
 *
 * Переменные окружения в Netlify (Site configuration -> Environment variables):
 *  - BOT_TOKEN       (обязательно) токен от @BotFather
 *  - ADMIN_CHAT_ID   (рекомендуется) ваш Telegram Chat ID (узнать командой /myid в боте)
 *  - SITE_URL        (опционально, по умолчанию https://hypeotvet.netlify.app)
 *  - CHANNEL_URL     (опционально, по умолчанию https://t.me/hypeotvet)
 *  - WEBHOOK_SECRET  (опционально) секрет заголовка X-Telegram-Bot-Api-Secret-Token
 */
import fs from "node:fs";
import path from "node:path";

const SITE_URL = (process.env.SITE_URL || "https://hypeotvet.netlify.app").replace(/\/+$/, "");
const CHANNEL_URL = process.env.CHANNEL_URL || "https://t.me/hypeotvet";

const readFirstExisting = (candidates) => {
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
};

let cache = null;
const getData = () => {
  if (cache) return cache;
  const raw = readFirstExisting([
    path.join(process.cwd(), "dist", "bot-data.json"),
    path.resolve("dist/bot-data.json")
  ]);
  const parsed = raw ? JSON.parse(raw) : { cats: {}, questions: [] };
  const qById = Object.fromEntries(parsed.questions.map((q) => [q.id, q]));
  const statusTxt =
    readFirstExisting([
      path.join(process.cwd(), "bot", "status.txt"),
      path.resolve("bot/status.txt")
    ]) || `Актуальные разборы смотрите на сайте: ${SITE_URL}/c/access/`;
  cache = { ...parsed, qById, statusTxt: statusTxt.trim() };
  return cache;
};

const tg = async (token, method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return res.json();
};

const searchBase = (questions, query) => {
  const words = query
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[\s,.;:!?/\\()«»"']+/)
    .filter((w) => w.length > 1);
  if (!words.length) return [];
  return questions
    .map((q) => {
      const title = q.title.toLowerCase().replace(/ё/g, "е");
      const body = (q.short + " " + (q.kw || "")).toLowerCase().replace(/ё/g, "е");
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

const mainMenu = (count) => ({
  inline_keyboard: [
    [{ text: "Предложить вопрос для разбора", callback_data: "mode:suggest" }],
    [{ text: `Найти ответ в базе (${count})`, callback_data: "mode:search" }],
    [
      { text: "Случайный разбор", callback_data: "random" },
      { text: "Статус сервисов", callback_data: "status" }
    ],
    [
      { text: "Открыть сайт", url: SITE_URL },
      { text: "Наш Telegram-канал", url: CHANNEL_URL }
    ]
  ]
});

const sendWelcome = (token, chatId, data) =>
  tg(token, "sendMessage", {
    chat_id: chatId,
    text:
      `Привет! Это бот «ХайпОтвет».\n\n` +
      `В базе уже ${data.questions.length} разборов по ${Object.keys(data.cats).length} темам: ремонт и сантехника, ЖКХ и Госуслуги, смартфоны и iCloud, авто, права, игры и нейросети.\n\n` +
      `Напишите свой вопрос прямо сюда (я сразу поищу ответ в базе) или выберите действие ниже:`,
    reply_markup: mainMenu(data.questions.length)
  });

const sendQuestionCard = (token, chatId, data, q) =>
  tg(token, "sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    text:
      `Шпаргалка · ${data.cats[q.cat] || ""}\n\n` +
      `${q.title}\n\n` +
      `Коротко: ${q.short}\n\n` +
      `${q.ex}\n\n` +
      `Полная версия с таблицами и интерактивом:\n${SITE_URL}/q/${q.id}/`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Открыть на сайте", url: `${SITE_URL}/q/${q.id}/` },
          { text: "Наш канал", url: CHANNEL_URL }
        ],
        [
          { text: "Ещё случайный", callback_data: "random" },
          { text: "Поиск по базе", callback_data: "mode:search" }
        ]
      ]
    }
  });

const sendStatus = (token, chatId, data) =>
  tg(token, "sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    text: data.statusTxt,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Раздел «Нейросети без VPN»", url: `${SITE_URL}/c/neuro/` }],
        [{ text: "Раздел «Сервисы и оплаты в РФ»", url: `${SITE_URL}/c/access/` }],
        [{ text: "Предложить вопрос", callback_data: "mode:suggest" }]
      ]
    }
  });

const handleSearch = (token, chatId, data, query) => {
  const found = searchBase(data.questions, query);
  if (!found.length) {
    return tg(token, "sendMessage", {
      chat_id: chatId,
      text: `По запросу «${query}» готового разбора пока нет.\nНажмите кнопку ниже, чтобы отправить этот вопрос редакции на разбор:`,
      reply_markup: {
        inline_keyboard: [[{ text: "Предложить этот вопрос", callback_data: "mode:suggest" }]]
      }
    });
  }
  const lines = found.map((q, i) => `${i + 1}. ${q.title}\n${q.short}\n${SITE_URL}/q/${q.id}/`);
  return tg(token, "sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    text: `Нашёл в базе по запросу «${query}»:\n\n${lines.join("\n\n")}`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Нет нужного — предложить свой вопрос", callback_data: "mode:suggest" }],
        [{ text: "Главное меню", callback_data: "menu" }]
      ]
    }
  });
};

const handleSuggestion = async (token, adminChatId, msg, data, text) => {
  const chatId = msg.chat.id;
  const from = msg.from || {};
  const userLabel = from.username
    ? `@${from.username}`
    : [from.first_name, from.last_name].filter(Boolean).join(" ") || `ID ${chatId}`;

  if (adminChatId && adminChatId !== chatId) {
    await tg(token, "sendMessage", {
      chat_id: adminChatId,
      text:
        `Новый вопрос от ${userLabel}:\n\n${text}\n\n` +
        `(Чтобы ответить пользователю — сделайте Reply на это сообщение)\n[#id:${chatId}]`
    });
  }

  const also = searchBase(data.questions, text).slice(0, 2);
  let reply = "Спасибо! Вопрос принят и передан в редакцию «ХайпОтвет».";
  if (also.length) {
    reply +=
      "\n\nВозможно, вам уже подойдут эти готовые разборы:\n" +
      also.map((q) => `— ${q.title}\n${SITE_URL}/q/${q.id}/`).join("\n");
  }
  return tg(token, "sendMessage", {
    chat_id: chatId,
    disable_web_page_preview: true,
    text: reply,
    reply_markup: mainMenu(data.questions.length)
  });
};

export default async (req) => {
  if (req.method === "GET") {
    const data = getData();
    return new Response(
      JSON.stringify({ ok: true, bot: "HypeOtvet", questions: data.questions.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const token = process.env.BOT_TOKEN;
  if (!token) {
    return new Response("BOT_TOKEN is not configured", { status: 500 });
  }
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }

  const adminChatId = process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null;
  const data = getData();

  let u;
  try {
    u = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    if (u.callback_query) {
      const cq = u.callback_query;
      const chatId = cq.message.chat.id;
      await tg(token, "answerCallbackQuery", { callback_query_id: cq.id });
      if (cq.data === "menu") await sendWelcome(token, chatId, data);
      else if (cq.data === "random") {
        const q = data.questions[Math.floor(Math.random() * data.questions.length)];
        if (q) await sendQuestionCard(token, chatId, data, q);
      } else if (cq.data === "status") {
        await sendStatus(token, chatId, data);
      } else if (cq.data === "mode:suggest") {
        await tg(token, "sendMessage", {
          chat_id: chatId,
          text: "[Предложить вопрос] Напишите ваш вопрос в ответ на это сообщение — он сразу попадёт в редакцию «ХайпОтвет».",
          reply_markup: { force_reply: true, input_field_placeholder: "Ваш вопрос…" }
        });
      } else if (cq.data === "mode:search") {
        await tg(token, "sendMessage", {
          chat_id: chatId,
          text: "[Поиск по базе] Напишите ключевые слова в ответ на это сообщение (например: засор, стим, показания воды).",
          reply_markup: { force_reply: true, input_field_placeholder: "Ключевые слова…" }
        });
      }
      return new Response("OK", { status: 200 });
    }

    const msg = u.message;
    if (!msg || !msg.text) return new Response("OK", { status: 200 });
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Stateless admin reply -> extract [#id:12345] from replied message text
    if (adminChatId && chatId === adminChatId && msg.reply_to_message?.text) {
      const m = msg.reply_to_message.text.match(/\[#id:(-?\d+)\]/);
      if (m) {
        await tg(token, "sendMessage", {
          chat_id: Number(m[1]),
          text: `Ответ от редакции «ХайпОтвет»:\n\n${text}`
        });
        await tg(token, "sendMessage", { chat_id: chatId, text: "Ответ отправлен пользователю." });
        return new Response("OK", { status: 200 });
      }
    }

    if (text === "/myid") {
      await tg(token, "sendMessage", { chat_id: chatId, text: `Ваш Telegram Chat ID: ${chatId}` });
      return new Response("OK", { status: 200 });
    }
    if (text === "/status") {
      await sendStatus(token, chatId, data);
      return new Response("OK", { status: 200 });
    }
    if (text === "/random") {
      const q = data.questions[Math.floor(Math.random() * data.questions.length)];
      if (q) await sendQuestionCard(token, chatId, data, q);
      return new Response("OK", { status: 200 });
    }
    if (text.startsWith("/find ")) {
      await handleSearch(token, chatId, data, text.slice(6).trim());
      return new Response("OK", { status: 200 });
    }
    if (text.startsWith("/suggest ")) {
      await handleSuggestion(token, adminChatId, msg, data, text.slice(9).trim());
      return new Response("OK", { status: 200 });
    }
    if (text.startsWith("/start")) {
      const payload = text.split(/\s+/)[1] || "";
      if (payload === "suggest") {
        await tg(token, "sendMessage", {
          chat_id: chatId,
          text: "[Предложить вопрос] Отправьте ваш вопрос в ответ на это сообщение (если скопировали на сайте — просто вставьте).",
          reply_markup: { force_reply: true, input_field_placeholder: "Ваш вопрос…" }
        });
      } else if (payload === "status") {
        await sendStatus(token, chatId, data);
      } else if (payload.startsWith("q_") && data.qById[payload.slice(2)]) {
        await sendQuestionCard(token, chatId, data, data.qById[payload.slice(2)]);
      } else if (payload.startsWith("n_") && data.questions[Number(payload.slice(2))]) {
        await sendQuestionCard(token, chatId, data, data.questions[Number(payload.slice(2))]);
      } else {
        await sendWelcome(token, chatId, data);
      }
      return new Response("OK", { status: 200 });
    }

    // Stateless ForceReply routing
    const replied = msg.reply_to_message?.text || "";
    if (replied.startsWith("[Поиск по базе]")) {
      await handleSearch(token, chatId, data, text);
      return new Response("OK", { status: 200 });
    }
    if (replied.startsWith("[Предложить вопрос]")) {
      await handleSuggestion(token, adminChatId, msg, data, text);
      return new Response("OK", { status: 200 });
    }

    // Default: search first if matches exist, otherwise offer/forward suggestion
    const found = searchBase(data.questions, text);
    if (found.length) {
      await handleSearch(token, chatId, data, text);
    } else {
      await handleSuggestion(token, adminChatId, msg, data, text);
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  return new Response("OK", { status: 200 });
};
