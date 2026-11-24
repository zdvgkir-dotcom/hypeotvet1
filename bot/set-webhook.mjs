#!/usr/bin/env node
/**
 * Один раз привязывает Telegram-бота к вашей 24/7 функции на Netlify.
 * Запуск: node bot/set-webhook.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(BOT_DIR, ".env");

if (fs.existsSync(ENV_PATH)) {
  for (const raw of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const TOKEN = process.env.BOT_TOKEN;
const SITE_URL = (process.env.SITE_URL || "https://hypeotvet.netlify.app").replace(/\/+$/, "");
const WEBHOOK_URL = `${SITE_URL}/.netlify/functions/telegram-bot`;

if (!TOKEN) {
  console.error("Не найден BOT_TOKEN в bot/.env");
  process.exit(1);
}

const tg = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return res.json();
};

const run = async () => {
  // Сначала проверим, что сама функция на Netlify отвечает
  const health = await fetch(WEBHOOK_URL);
  const healthText = await health.text();
  if (!health.ok) {
    console.error(`Функция ${WEBHOOK_URL} пока не отвечает (${health.status}): ${healthText}`);
    console.error("Дождитесь статуса Published на Netlify и повторите запуск.");
    process.exit(1);
  }
  console.log("Netlify Function отвечает:", healthText);

  const set = await tg("setWebhook", {
    url: WEBHOOK_URL,
    allowed_updates: ["message", "callback_query"],
    ...(process.env.WEBHOOK_SECRET ? { secret_token: process.env.WEBHOOK_SECRET } : {})
  });
  console.log("setWebhook:", set);

  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "Главное меню" },
      { command: "status", description: "Актуальный статус сервисов" },
      { command: "random", description: "Случайный разбор" },
      { command: "myid", description: "Узнать свой Telegram ID" }
    ]
  });

  const info = await tg("getWebhookInfo");
  console.log("Текущий Webhook:", info.result?.url, "pending:", info.result?.pending_update_count);
};

run().catch((e) => {
  console.error("Ошибка:", e.message);
  process.exit(1);
});
