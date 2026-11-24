#!/usr/bin/env node
/**
 * Генератор статических SEO-страниц «ХайпОтвет» для Google и Яндекса.
 * Запуск: node build-seo.mjs [https://hypeotvet.netlify.app]
 *
 * Что собирает в dist/:
 *  - dist/index.html — полноценный статический HTML с чистыми ссылками /c/<id>/ и /q/<id>/ + живой поиск поверх DOM
 *  - dist/categories/index.html, dist/c/<cat>/index.html — все 30 разделов
 *  - dist/q/<id>/index.html — 1017+ страниц вопросов с FAQPage JSON-LD, кольцевой перелинковкой и Deep Link в бота
 *  - dist/tools/index.html, dist/saved/index.html, dist/about/index.html
 *  - dist/sitemap.xml, dist/robots.txt, dist/netlify.toml
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const SITE_URL = (process.argv[2] || "https://hypeotvet.netlify.app").replace(/\/+$/, "");
const SITE_DOMAIN = SITE_URL.replace(/^https?:\/\//, "");
const SITE_NAME = "ХайпОтвет";
const TG_URL = "https://t.me/hypeotvet";
const TG_BOT = "HypeOtvet_app";

// Load data.js + data/pack-*.js in a clean VM sandbox
const sandbox = { window: {} };
vm.createContext(sandbox);
const loadScript = (file) => vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
loadScript(path.join(ROOT, "data.js"));
const packDir = path.join(ROOT, "data");
const packs = fs.readdirSync(packDir).filter((f) => f.endsWith(".js")).sort();
for (const p of packs) loadScript(path.join(packDir, p));

const { categories, questions } = sandbox.window.SITE_DATA;
const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
const catIndex = Object.fromEntries(categories.map((c, i) => [c.id, String(i + 1).padStart(2, "0")]));
const qIndexById = Object.fromEntries(questions.map((q, i) => [q.id, i]));

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const stripHtml = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const plural = (n, [one, few, many]) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
const qWord = (n) => `${n} ${plural(n, ["вопрос", "вопроса", "вопросов"])}`;
const readTime = (q) => Math.max(1, Math.round(stripHtml(q.answer).split(/\s+/).length / 180));
const writeFile = (rel, content) => {
  const full = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
};

// Telegram deep-link payload (<= 64 chars, only [A-Za-z0-9_-])
const botDeepLink = (q) => {
  const slugPayload = "q_" + q.id;
  const payload = slugPayload.length <= 64 && /^[A-Za-z0-9_-]+$/.test(slugPayload)
    ? slugPayload
    : "n_" + qIndexById[q.id];
  return `https://t.me/${TG_BOT}?start=${payload}`;
};

const interleaveByCat = (list, priority = []) => {
  const groups = new Map();
  for (const id of priority) groups.set(id, []);
  for (const c of categories) if (!groups.has(c.id)) groups.set(c.id, []);
  for (const q of list) {
    if (!groups.has(q.cat)) groups.set(q.cat, []);
    groups.get(q.cat).push(q);
  }
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const arr of groups.values()) {
      if (arr.length) {
        out.push(arr.shift());
        added = true;
      }
    }
  }
  return out;
};

// Circular neighbor selection within the same category -> every article gets 6 diverse sibling links
const getSiblingLinks = (catList, currentId, count = 6) => {
  const idx = catList.findIndex((x) => x.id === currentId);
  if (idx === -1 || catList.length <= 1) return [];
  const res = [];
  const offsets = [-2, -1, 1, 2, 3, 4];
  for (const off of offsets) {
    const pick = catList[(idx + off + catList.length * 4) % catList.length];
    if (pick && pick.id !== currentId && !res.includes(pick)) res.push(pick);
    if (res.length >= count) break;
  }
  return res;
};

const WIDGET_MAP = {
  "proverit-bu-iphone": "iphone-check",
  "p12-hs-proverka-kvartiry-arenda": "rent-check",
  "ip-ili-samozanyatost": "npd-calc",
  "p09-mn-cheki-moj-nalog": "npd-calc",
  "vybor-pauerbanka": "powerbank-calc",
  "popolnit-steam-v-rossii": "steam-calc"
};

const STATUS_CATS = new Set(["neuro", "access", "games"]);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// Copy styles, assets, verification files
fs.copyFileSync(path.join(ROOT, "styles.css"), path.join(DIST, "styles.css"));
if (fs.existsSync(path.join(ROOT, "assets", "logo", "logo-dark.svg"))) {
  fs.cpSync(path.join(ROOT, "assets"), path.join(DIST, "assets"), { recursive: true });
}
for (const f of fs.readdirSync(ROOT)) {
  if (/^(google|yandex_)[a-z0-9._-]+\.html$/i.test(f)) {
    fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
  }
}

// Compact search index JSON for instant live search on static site (~160KB gzip ~40KB)
const searchIndex = questions.map((q) => [q.id, q.cat, q.title, q.short, q.keywords || ""]);
writeFile("search-index.json", JSON.stringify({
  cats: Object.fromEntries(categories.map((c) => [c.id, [catIndex[c.id], c.title]])),
  items: searchIndex
}));

// Progressive enhancement script for ALL static SEO pages
const enhanceJs = `(() => {
  const SITE_NAME = ${JSON.stringify(SITE_NAME)};
  const SITE_DOMAIN = ${JSON.stringify(SITE_DOMAIN)};
  const TG_BOT = ${JSON.stringify(TG_BOT)};
  const BASE = document.body.dataset.base || "/";
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmtMoney = (n) => Math.round(n).toLocaleString("ru-RU") + " ₽";

  /* Theme */
  const tBtn = document.getElementById("themeToggle");
  const applyTheme = (m) => {
    const d = m === "dark";
    if (d) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {}
    if (tBtn) { tBtn.textContent = d ? "Бумага" : "Ночь"; tBtn.setAttribute("aria-pressed", String(d)); }
  };
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  tBtn?.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  /* Bookmarks */
  const getSaved = () => { try { return JSON.parse(localStorage.getItem("saved:ids") || "[]"); } catch { return []; } };
  const setSaved = (ids) => { try { localStorage.setItem("saved:ids", JSON.stringify(ids)); } catch {} syncBadge(); };
  const syncBadge = () => {
    const b = document.getElementById("savedBadge");
    if (!b) return;
    const n = getSaved().length;
    b.textContent = String(n);
    b.hidden = n === 0;
  };
  syncBadge();

  /* Copy buttons on code blocks */
  document.querySelectorAll(".content pre").forEach((pre) => {
    if (pre.parentElement?.classList.contains("codeblock")) return;
    const w = document.createElement("div"); w.className = "codeblock";
    pre.parentNode.insertBefore(w, pre); w.appendChild(pre);
    const b = document.createElement("button"); b.type = "button"; b.className = "codeblock__copy"; b.textContent = "Скопировать";
    b.addEventListener("click", () => { navigator.clipboard?.writeText(pre.innerText.trim()); b.textContent = "Скопировано"; setTimeout(() => b.textContent = "Скопировать", 1600); });
    w.appendChild(b);
  });

  /* Article actions: vote, bookmark, share, story card PNG */
  const articleEl = document.querySelector("[data-qid]");
  if (articleEl) {
    const qid = articleEl.dataset.qid;
    const qTitle = articleEl.dataset.qtitle || "";
    const qShort = articleEl.dataset.qshort || "";
    const cNum = articleEl.dataset.cnum || "";
    const cTitle = articleEl.dataset.ctitle || "";

    const vote = (() => { try { return localStorage.getItem("vote:" + qid); } catch { return null; } })();
    articleEl.querySelectorAll("[data-vote]").forEach((b) => {
      if (b.dataset.vote === vote) b.setAttribute("aria-pressed", "true");
      b.addEventListener("click", () => {
        try { localStorage.setItem("vote:" + qid, b.dataset.vote); } catch {}
        articleEl.querySelectorAll("[data-vote]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
    });

    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) {
      const renderSave = () => {
        const has = getSaved().includes(qid);
        saveBtn.setAttribute("aria-pressed", String(has));
        saveBtn.textContent = has ? "В сохранённом" : "Сохранить";
      };
      renderSave();
      saveBtn.addEventListener("click", () => {
        const list = getSaved();
        setSaved(list.includes(qid) ? list.filter((x) => x !== qid) : [qid, ...list]);
        renderSave();
      });
    }

    const shareBtn = document.getElementById("shareBtn");
    shareBtn?.addEventListener("click", () => {
      navigator.clipboard?.writeText(location.href);
      shareBtn.textContent = "Ссылка скопирована";
      setTimeout(() => (shareBtn.textContent = "Скопировать ссылку"), 1800);
    });

    const cardBtn = document.getElementById("cardBtn");
    cardBtn?.addEventListener("click", () => {
      const W = 1080, H = 1350, P = 84;
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d");
      const dark = document.documentElement.dataset.theme === "dark";
      const col = dark
        ? { bg: "#141310", card: "#1b1a15", ink: "#eee9dc", muted: "#b5ae9c", rule: "#343129", marker: "#e6c645" }
        : { bg: "#f5f2ea", card: "#fbf9f4", ink: "#17150f", muted: "#4a463c", rule: "#d6cfbf", marker: "#ffe15a" };
      ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);
      const wrap = (text, maxW, font, lh) => {
        ctx.font = font;
        const lines = []; let cur = "";
        for (const w of text.split(/\\s+/)) {
          const t = cur ? cur + " " + w : w;
          if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
        }
        if (cur) lines.push(cur);
        return { lines, lh };
      };
      ctx.fillStyle = col.ink; ctx.font = "700 38px Georgia, serif"; ctx.fillText(SITE_NAME, P, 108);
      ctx.fillStyle = col.muted; ctx.font = "500 26px system-ui, sans-serif"; ctx.fillText("Раздел " + cNum + " / " + cTitle, P, 158);
      ctx.fillStyle = col.ink; ctx.fillRect(P, 186, W - P * 2, 3);
      const t = wrap(qTitle, W - P * 2, "700 58px Georgia, serif", 72);
      let y = 278; ctx.fillStyle = col.ink; ctx.font = "700 58px Georgia, serif";
      for (const line of t.lines.slice(0, 5)) { ctx.fillText(line, P, y); y += t.lh; }
      y += 34;
      const s = wrap(qShort, W - P * 2 - 76, "400 34px system-ui, sans-serif", 50);
      const boxH = Math.max(220, s.lines.length * s.lh + 116);
      ctx.fillStyle = col.card; ctx.fillRect(P, y, W - P * 2, boxH);
      ctx.fillStyle = col.marker; ctx.fillRect(P, y, 14, boxH);
      ctx.fillStyle = col.muted; ctx.font = "600 24px system-ui, sans-serif"; ctx.fillText("КОРОТКИЙ ОТВЕТ", P + 44, y + 54);
      ctx.fillStyle = col.ink; ctx.font = "400 34px system-ui, sans-serif";
      let sy = y + 108;
      for (const line of s.lines.slice(0, 8)) { ctx.fillText(line, P + 44, sy); sy += s.lh; }
      ctx.fillStyle = col.rule; ctx.fillRect(P, H - 150, W - P * 2, 2);
      ctx.fillStyle = col.ink; ctx.font = "600 28px system-ui, sans-serif"; ctx.fillText("Полный разбор по шагам — на " + SITE_NAME, P, H - 96);
      ctx.fillStyle = col.muted; ctx.font = "500 24px ui-monospace, Consolas, monospace"; ctx.fillText(SITE_DOMAIN + "/q/" + qid + "/", P, H - 56);
      const a = document.createElement("a"); a.download = "hypeotvet-" + qid + ".png"; a.href = cv.toDataURL("image/png"); a.click();
      cardBtn.textContent = "Карточка скачана";
      setTimeout(() => (cardBtn.textContent = "Карточка для сторис"), 1800);
    });
  }

  /* Category filter pills on static /c/<id>/ pages */
  const filterBar = document.querySelector("[data-cat-filters]");
  if (filterBar) {
    const items = [...document.querySelectorAll("[data-qrow]")];
    filterBar.querySelectorAll("[data-f]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = btn.dataset.f;
        filterBar.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        for (const li of items) {
          const show = f === "all" || (f === "hot" && li.dataset.hot === "1") || (f === "new" && li.dataset.new === "1");
          li.hidden = !show;
        }
      });
    });
  }

  /* Interactive Widgets */
  document.querySelectorAll("[data-widget]").forEach((el) => {
    const type = el.dataset.widget;
    if (type === "iphone-check" || type === "rent-check") {
      const key = "check:" + type;
      const boxes = [...el.querySelectorAll('input[type="checkbox"]')];
      const prog = el.querySelector("[data-progress]");
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
      boxes.forEach((b, i) => { b.checked = Boolean(saved[i]); });
      const sync = () => {
        const st = boxes.map((b) => b.checked);
        prog.textContent = "Проверено " + st.filter(Boolean).length + " из " + boxes.length;
        try { localStorage.setItem(key, JSON.stringify(st)); } catch {}
      };
      sync();
      boxes.forEach((b) => b.addEventListener("change", sync));
      el.querySelector("[data-reset]")?.addEventListener("click", () => { boxes.forEach((b) => (b.checked = false)); sync(); });
    }
    if (type === "npd-calc") {
      const s = el.querySelector("#npdSum"), t = el.querySelector("#npdType"), b = el.querySelector("#npdBonus"), out = el.querySelector("#npdOut");
      const calc = () => {
        const sum = Math.max(0, Number(s.value) || 0), base = Number(t.value);
        const rate = b.checked ? (base === 4 ? 3 : 4) : base;
        const tax = sum * (rate / 100), net = sum - tax, gross = sum / (1 - rate / 100);
        out.innerHTML = '<div class="widget__stat"><span>Налог (' + rate + '%)</span><b>' + fmtMoney(tax) + '</b></div><div class="widget__stat"><span>Чистыми на руки</span><b>' + fmtMoney(net) + '</b></div><div class="widget__stat"><span>Выставить, чтобы на руки ' + fmtMoney(sum) + '</span><b>' + fmtMoney(gross) + '</b></div>';
      };
      calc(); [s, t, b].forEach((x) => { x.addEventListener("input", calc); x.addEventListener("change", calc); });
    }
    if (type === "powerbank-calc") {
      const c = el.querySelector("#pbCap"), p = el.querySelector("#pbPhone"), out = el.querySelector("#pbOut"), hint = el.querySelector("#pbHint");
      const calc = () => {
        const cap = Math.max(1000, Number(c.value) || 0), ph = Math.max(1000, Number(p.value) || 1);
        const charges = ((cap * 0.62) / ph).toFixed(1).replace(".", ","), wh = (cap * 3.7) / 1000, ok = wh <= 100;
        out.innerHTML = '<div class="widget__stat"><span>Полных зарядок</span><b>~' + charges + '</b></div><div class="widget__stat"><span>Энергия (при 3,7 В)</span><b>' + wh.toFixed(1).replace(".", ",") + ' Вт·ч</b></div><div class="widget__stat"><span>В ручную кладь</span><b>' + (ok ? "Можно" : "Нужно согласие") + '</b></div>';
        hint.textContent = ok ? "До 100 Вт·ч пауэрбанк свободно пускают в ручную кладь большинства авиакомпаний (в багаж сдавать нельзя)." : "Выше 100 Вт·ч требуется предварительное одобрение авиакомпании, свыше 160 Вт·ч запрещено.";
      };
      calc(); [c, p].forEach((x) => x.addEventListener("input", calc));
    }
    if (type === "steam-calc") {
      const w = el.querySelector("#stWant"), f = el.querySelector("#stFee"), out = el.querySelector("#stOut");
      const calc = () => {
        const want = Math.max(0, Number(w.value) || 0), pct = Math.max(0, Number(f.value) || 0);
        const pay = want * (1 + pct / 100), fee = pay - want;
        out.innerHTML = '<div class="widget__stat"><span>К оплате с карты</span><b>' + fmtMoney(pay) + '</b></div><div class="widget__stat"><span>Комиссия</span><b>' + fmtMoney(fee) + '</b></div><div class="widget__stat"><span>Придёт в Steam</span><b>' + fmtMoney(want) + '</b></div>';
      };
      calc(); [w, f].forEach((x) => x.addEventListener("input", calc));
    }
  });

  /* Lazy-loaded Smart Search (layout fix + synonyms) + Saved page + Random button */
  const EN = "\`qwertyuiop[]asdfghjkl;'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:\\"ZXCVBNM<>?";
  const RU = "ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";
  const enToRu = Object.fromEntries([...EN].map((c, i) => [c, RU[i]]));
  const ruToEn = Object.fromEntries([...RU].map((c, i) => [c, EN[i]]));
  const conv = (s, m) => [...s].map((ch) => m[ch] || ch).join("");
  const SYNS = [["айфон","iphone","эпл","apple","ios"],["андроид","андройд","android","сяоми","xiaomi"],["стим","steam"],["впн","vpn"],["дипсик","deepseek"],["чатгпт","chatgpt","гпт"],["нейронка","нейросеть","ии"],["тг","телега","телеграм","telegram"],["вб","wildberries"],["озон","ozon"],["авито","avito"],["жкх","коммуналка","счетчик","показания"],["прописка","регистрация"],["госы","госуслуги"],["омс","поликлиника","врач"],["ноут","ноутбук"],["пк","комп","компьютер"],["павербанк","пауэрбанк","powerbank"],["пс5","playstation","ps5"],["вайфай","wifi","роутер"],["айклауд","icloud"]];
  const expand = (w) => {
    const out = new Set([w.replace(/ё/g, "е")]);
    const c = w.replace(/ё/g, "е");
    if (c.length > 5) out.add(c.slice(0, -2));
    for (const g of SYNS) if (g.some((x) => x === c || (c.length >= 4 && x.startsWith(c)))) g.forEach((x) => out.add(x));
    return [...out];
  };

  let idxPromise = null;
  const loadIndex = () => idxPromise || (idxPromise = fetch(BASE + "search-index.json").then((r) => r.json()));

  const runSearch = (data, raw) => {
    const score = (q) => {
      const ws = q.toLowerCase().trim().split(/[\\s,.;:!?/\\\\()«»"']+/).filter((w) => w.length > 1);
      if (!ws.length) return [];
      const ex = ws.map(expand);
      return data.items.map((it) => {
        const t = it[2].toLowerCase().replace(/ё/g, "е");
        const b = (it[3] + " " + it[4]).toLowerCase().replace(/ё/g, "е");
        let sc = 0, hits = 0;
        for (const vs of ex) {
          let h = 0;
          for (const v of vs) { if (t.includes(v)) h = Math.max(h, 6); else if (b.includes(v)) h = Math.max(h, 2); }
          if (h) hits++; sc += h;
        }
        if (hits === ex.length && ex.length > 1) sc += 6;
        return [it, sc];
      }).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    };
    const direct = score(raw);
    if (direct.length) return { items: direct, corrected: "" };
    const lat = /[a-z]/i.test(raw), cyr = /[а-яё]/i.test(raw);
    const alt = lat && !cyr ? conv(raw, enToRu) : cyr && !lat ? conv(raw, ruToEn) : "";
    if (alt && alt !== raw) {
      const r = score(alt);
      if (r.length) return { items: r, corrected: alt };
    }
    return { items: [], corrected: "" };
  };

  /* Live Hero search on static Home */
  const heroInput = document.getElementById("heroInput");
  const heroSuggest = document.getElementById("heroSuggest");
  const suggestLabel = document.getElementById("suggestLabel");
  const suggestCount = document.getElementById("suggestCount");
  if (heroInput && heroSuggest) {
    const defaultHtml = heroSuggest.innerHTML;
    const defaultCount = suggestCount?.textContent || "";
    const renderHero = async (val, limit = 6) => {
      const v = val.trim();
      if (!v) {
        if (suggestLabel) suggestLabel.textContent = "Часто ищут";
        if (suggestCount) suggestCount.textContent = defaultCount;
        heroSuggest.innerHTML = defaultHtml;
        return;
      }
      const data = await loadIndex();
      const { items, corrected } = runSearch(data, v);
      if (suggestLabel) suggestLabel.textContent = corrected ? "Исправлена раскладка: «" + corrected + "»" : "Найденные разборы";
      if (suggestCount) suggestCount.textContent = "Найдено: " + items.length;
      if (!items.length) {
        heroSuggest.innerHTML = '<p class="suggest__empty">Точного совпадения нет. Попробуйте другие слова или <a href="https://t.me/' + TG_BOT + '?start=suggest" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">предложите вопрос боту</a>.</p>';
        return;
      }
      heroSuggest.innerHTML = "<ul>" + items.slice(0, limit).map((it) =>
        '<li><a href="' + BASE + "q/" + it[0] + '/"><span class="suggest__q">' + esc(it[2]) + '</span><span class="suggest__cat">' + esc((data.cats[it[1]] || ["", ""])[1]) + "</span></a></li>"
      ).join("") + "</ul>";
    };
    heroInput.addEventListener("input", () => renderHero(heroInput.value, 6));
    document.getElementById("heroForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      renderHero(heroInput.value, 20);
    });
    const urlQ = new URLSearchParams(location.search).get("q");
    if (urlQ) { heroInput.value = urlQ; renderHero(urlQ, 20); }
  }

  /* Header search on subpages -> redirects to /?q=... */
  document.getElementById("searchForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("searchInput").value.trim();
    if (v) location.href = BASE + "?q=" + encodeURIComponent(v);
  });

  /* Saved page (/saved/) */
  const savedRoot = document.getElementById("savedRoot");
  if (savedRoot) {
    loadIndex().then((data) => {
      const byId = Object.fromEntries(data.items.map((it) => [it[0], it]));
      const draw = () => {
        const ids = getSaved().filter((id) => byId[id]);
        if (!ids.length) {
          savedRoot.innerHTML = '<div class="empty"><strong>Пока ничего не сохранено</strong>Откройте любой разбор и нажмите «Сохранить» — он появится здесь. <a href="' + BASE + 'categories/">Выбрать тему</a></div>';
          return;
        }
        savedRoot.innerHTML = '<div style="margin:20px 0"><button type="button" class="btn" id="clearSaved">Очистить всё (' + ids.length + ')</button></div><ul class="qlist">' +
          ids.map((id) => {
            const it = byId[id];
            return '<li class="qitem-row"><a class="qitem" href="' + BASE + 'q/' + it[0] + '/"><div class="qitem__title">' + esc(it[2]) + '</div><p class="qitem__short">' + esc(it[3]) + '</p><div class="meta"><span>' + esc((data.cats[it[1]] || ["", ""])[1]) + '</span></div></a><button type="button" class="btn" data-rm="' + it[0] + '">Убрать</button></li>';
          }).join("") + "</ul>";
        document.getElementById("clearSaved")?.addEventListener("click", () => { setSaved([]); draw(); });
        savedRoot.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { setSaved(getSaved().filter((x) => x !== b.dataset.rm)); draw(); }));
      };
      draw();
    });
  }

  /* Random button in footer */
  document.getElementById("randomBtn")?.addEventListener("click", async () => {
    const data = await loadIndex();
    const pick = data.items[Math.floor(Math.random() * data.items.length)];
    if (pick) location.href = BASE + "q/" + pick[0] + "/";
  });
})();`;
writeFile("static-enhance.js", enhanceJs);

/* ---------- Widget HTML builder (shared with /tools/ & /q/) ---------- */
const CHECKLISTS = {
  "iphone-check": {
    title: "Интерактивный чек-лист проверки б/у iPhone",
    items: [
      "В Настройках нет чужого Apple ID, телефон сброшен до экрана приветствия",
      "Серийный номер и IMEI на коробке, в Настройках и на лотке SIM совпадают",
      "Проверен серийный номер на checkcoverage.apple.com",
      "Проверен раздел «История деталей и обслуживания» (замены экрана/батареи)",
      "Включается и работает True Tone и автояркость экрана",
      "На белом и чёрном фоне нет битых пикселей, пятен и выгорания",
      "Face ID / Touch ID успешно настраивается с первого раза",
      "Сделаны тестовые фото на все объективы и видео со звуком (микрофоны + динамики)",
      "Проверено состояние аккумулятора (адекватный износ, не подозрительные 100% на старом аппарате)",
      "Вставлена своя SIM-карта, проверены звонок, Wi-Fi, Bluetooth и зарядка кабелем"
    ]
  },
  "rent-check": {
    title: "Интерактивный чек-лист проверки квартиры перед съёмом",
    items: [
      "Проверен паспорт собственника и свежая выписка ЕГРН (ФИО совпадают)",
      "Если собственников несколько — есть письменное согласие остальных или нотариальная доверенность",
      "Проверена исправность сантехники, напора воды, слива и отсутствие течей под раковиной",
      "Проверена вся бытовая техника: стиральная машина, холодильник, плита, духовка, кондиционер",
      "Сфотографированы все имеющиеся царапины, сколы, пятна на мебели и обоях",
      "Зафиксированы показания счётчиков воды, света и газа на дату заезда",
      "Уточнено, кто платит за коммуналку (всё, только счётчики или фиксированная сумма)",
      "В договоре прописаны срок, запрет внезапного поднятия цены и условия возврата залога",
      "Подписан акт приёма-передачи с описью техники и получен документ о передаче денег",
      "Никаких предоплат «за просмотр» или «доступ к базе квартир» до осмотра не переводилось"
    ]
  }
};

const widgetHTML = (type) => {
  if (CHECKLISTS[type]) {
    const cfg = CHECKLISTS[type];
    return `<section class="widget" data-widget="${type}"><div class="widget__head"><h3 class="widget__title">${esc(cfg.title)}</h3><span class="widget__meta" data-progress>0 из ${cfg.items.length}</span></div><ul class="widget__checks">${cfg.items.map((txt, i) => `<li><label><input type="checkbox" data-idx="${i}" /><span>${esc(txt)}</span></label></li>`).join("")}</ul><div class="widget__bar"><button type="button" class="btn" data-reset>Сбросить отметки</button><span class="widget__meta">Отметки сохраняются в этом браузере</span></div></section>`;
  }
  if (type === "npd-calc") {
    return `<section class="widget" data-widget="npd-calc"><div class="widget__head"><h3 class="widget__title">Калькулятор налога самозанятого (НПД)</h3><span class="widget__meta">4% физлица / 6% компании</span></div><div class="widget__grid"><div><label class="field-label" for="npdSum">Сумма поступления, ₽</label><input class="field-input" id="npdSum" type="number" min="0" step="500" value="50000" /></div><div><label class="field-label" for="npdType">Кто платит</label><select class="field-input" id="npdType"><option value="4">Физическое лицо (4%)</option><option value="6">ИП или компания (6%)</option></select></div></div><label class="widget__toggle"><input type="checkbox" id="npdBonus" /> Учитывать стартовый налоговый бонус 10 000 ₽ (ставка 3% / 4%)</label><div class="widget__out" id="npdOut"></div><p class="widget__hint">Лимит дохода для самозанятых — 2,4 млн ₽ в год. Оплата налога — до 28-го числа следующего месяца.</p></section>`;
  }
  if (type === "powerbank-calc") {
    return `<section class="widget" data-widget="powerbank-calc"><div class="widget__head"><h3 class="widget__title">Калькулятор реальных зарядок пауэрбанка</h3><span class="widget__meta">КПД ~62% + проверка самолёта</span></div><div class="widget__grid"><div><label class="field-label" for="pbCap">Ёмкость пауэрбанка, мА·ч</label><input class="field-input" id="pbCap" type="number" min="1000" max="60000" step="1000" value="20000" /></div><div><label class="field-label" for="pbPhone">Батарея смартфона, мА·ч</label><input class="field-input" id="pbPhone" type="number" min="1500" max="12000" step="100" value="5000" /></div></div><div class="widget__out" id="pbOut"></div><p class="widget__hint" id="pbHint"></p></section>`;
  }
  if (type === "steam-calc") {
    return `<section class="widget" data-widget="steam-calc"><div class="widget__head"><h3 class="widget__title">Калькулятор пополнения Steam</h3><span class="widget__meta">Оценка итоговой суммы с комиссией</span></div><div class="widget__grid"><div><label class="field-label" for="stWant">Нужно получить на Steam, ₽</label><input class="field-input" id="stWant" type="number" min="50" step="100" value="1500" /></div><div><label class="field-label" for="stFee">Комиссия и конвертация, %</label><input class="field-input" id="stFee" type="number" min="0" max="35" step="0.5" value="8" /></div></div><div class="widget__out" id="stOut"></div><p class="widget__hint">Фактическая сумма может отличаться на 1–3% из-за курса конвертации валют в момент платежа.</p></section>`;
  }
  return "";
};

/* ---------- Shared HTML Shell ---------- */
const shell = ({ title, desc, canonical, base, bodyHtml, ldJson, nav = "", isHome = false, ogType = "article" }) => `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <link rel="icon" type="image/svg+xml" href="${base}assets/logo/logo-dark.svg" />
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <script>(function(){try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark";}catch(e){}})();</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Literata:ital,opsz,wght@0,7..72,500;0,7..72,600;0,7..72,700;1,7..72,500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${base}styles.css" />
  ${ldJson ? `<script type="application/ld+json">${JSON.stringify(ldJson).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body class="${isHome ? "is-home" : ""}" data-base="${base}">
  <header class="header">
    <div class="container header__inner">
      <a href="${base}" class="logo" aria-label="${SITE_NAME} — на главную">Хайп<span>Ответ</span></a>
      <form class="search" id="searchForm" role="search" autocomplete="off">
        <label for="searchInput" class="visually-hidden">Поиск по вопросам</label>
        <input type="search" id="searchInput" placeholder="Поиск по вопросам" />
        <button type="submit">Найти</button>
      </form>
      <nav class="nav" aria-label="Основная навигация">
        <a href="${base}"${nav === "home" ? ' aria-current="page"' : ""}>Главная</a>
        <a href="${base}categories/"${nav === "categories" ? ' aria-current="page"' : ""}>Темы</a>
        <a href="${base}tools/"${nav === "tools" ? ' aria-current="page"' : ""}>Инструменты</a>
        <a href="${base}saved/"${nav === "saved" ? ' aria-current="page"' : ""}>Сохранённое<span class="nav__badge" id="savedBadge" hidden>0</span></a>
      </nav>
      <button type="button" class="theme-btn" id="themeToggle">Ночь</button>
    </div>
  </header>
  <main class="container">${bodyHtml}</main>
  <footer class="footer">
    <div class="container footer__inner">
      <div>
        <div class="footer__brand">${SITE_NAME}</div>
        <div class="footer__links">
          <a href="${base}categories/">Все темы</a>
          <a href="${base}tools/">Калькуляторы и чек-листы</a>
          <a href="${base}saved/">Сохранённое</a>
          <a href="${base}about/">О сайте и правила</a>
          <a href="https://t.me/${TG_BOT}?start=suggest" target="_blank" rel="noopener noreferrer">Предложить вопрос</a>
          <button type="button" class="link-btn" id="randomBtn">Случайный вопрос</button>
        </div>
      </div>
      <p class="footer__muted">Коротко и по делу о том, что спрашивают в Reels, TikTok и Shorts: ремонт, ЖКХ, Госуслуги, авто, права, смартфоны, игры, приложения и нейросети. Условия сервисов и законы меняются — перепроверяйте детали перед оплатой или подачей заявлений.</p>
    </div>
  </footer>
  <script src="${base}static-enhance.js"></script>
</body>
</html>`;

const qRowStatic = (q, base, { showCat = true, showShort = false } = {}) => {
  const c = catById[q.cat];
  return `<li data-qrow data-hot="${q.hot ? 1 : 0}" data-new="${q.isNew ? 1 : 0}"><a class="qitem" href="${base}q/${q.id}/"><div class="qitem__title">${esc(q.title)}</div>${showShort ? `<p class="qitem__short">${esc(q.short)}</p>` : ""}<div class="meta">${q.hot ? '<span class="tag tag--hot">Хайп</span>' : ""}${q.isNew ? '<span class="tag tag--new">Новое</span>' : ""}${showCat ? `<span>${esc(c.title)}</span>` : ""}<span>${readTime(q)} мин чтения</span>${WIDGET_MAP[q.id] ? "<span>Есть интерактив</span>" : ""}</div></a></li>`;
};

const catIndexRows = (base) =>
  categories
    .map((c) => {
      const n = questions.filter((q) => q.cat === c.id).length;
      return `<li><a class="index__row" href="${base}c/${c.id}/"><span class="index__num">${catIndex[c.id]}</span><span class="index__title">${esc(c.title)}</span><span class="index__count">${qWord(n)}</span><span class="index__desc">${esc(c.desc)}</span></a></li>`;
    })
    .join("");

/* ---------- 1. Static Pre-rendered Home (dist/index.html) ---------- */
const hotMixed = interleaveByCat(questions.filter((q) => q.hot), [
  "diy-repair", "phones", "zhkh", "cleaning-home", "auto-care",
  "gosuslugi", "housing", "travel", "health", "kitchen-food", "life-skills",
  "games", "security", "access", "neuro", "apps", "crypto-fin", "pc", "gadgets", "home-tech"
]);
const freshMixed = interleaveByCat(questions.filter((q) => q.isNew), [
  "diy-repair", "cleaning-home", "kitchen-food", "auto-care", "life-skills",
  "housing", "travel", "health", "zhkh", "gosuslugi"
]).slice(0, 10);
const heroDefaults = hotMixed.slice(0, 5);

writeFile(
  "index.html",
  shell({
    title: `${SITE_NAME} — ответы на вопросы, которые все гуглят`,
    desc: `Более 1000 пошаговых разборов вопросов из Reels, TikTok и поиска: ремонт, сантехника и быт, ЖКХ, Госуслуги, авто, права, смартфоны, игры, приложения и нейросети.`,
    canonical: `${SITE_URL}/`,
    base: "./",
    nav: "home",
    isHome: true,
    ogType: "website",
    ldJson: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      potentialAction: {
        "@type": "SearchAction",
        target: `${SITE_URL}/?q={search_term_string}`,
        "query-input": "required name=search_term_string"
      }
    },
    bodyHtml: `
      <section class="hero" aria-labelledby="heroTitle">
        <h1 id="heroTitle">Ответы на то, что <span class="marker">все гуглят</span> после рилсов</h1>
        <p class="hero__lede">Ремонт, сантехника и быт, ЖКХ и Госуслуги, авто, права, смартфоны, игры, приложения и нейросети — более 1 000 разборов по шагам, без воды.</p>
        <form class="qsearch" id="heroForm" role="search" autocomplete="off">
          <label class="qsearch__label" for="heroInput">Задайте вопрос так, как спросили бы поисковик (понимает раскладку и синонимы)</label>
          <div class="qsearch__field">
            <input id="heroInput" type="search" placeholder="засор в раковине, поменять розетку, передать показания, стим" aria-describedby="suggestHead" aria-controls="heroSuggest" />
            <button type="submit">Найти ответ</button>
          </div>
          <div class="suggest">
            <div class="suggest__head" id="suggestHead"><span id="suggestLabel">Часто ищут</span><span id="suggestCount">${questions.length} разборов в базе</span></div>
            <div id="heroSuggest" aria-live="polite"><ul>${heroDefaults
              .map((q) => `<li><a href="./q/${q.id}/"><span class="suggest__q">${esc(q.title)}</span><span class="suggest__cat">${esc(catById[q.cat].title)}</span></a></li>`)
              .join("")}</ul></div>
          </div>
        </form>
      </section>

      <section class="section" aria-labelledby="topicsTitle">
        <div class="section__head">
          <h2 class="section__title" id="topicsTitle">Темы</h2>
          <span class="section__aside">${categories.length} разделов · <a href="./tools/">Калькуляторы и чек-листы</a></span>
        </div>
        <ol class="index">${catIndexRows("./")}</ol>
      </section>

      <section class="section" aria-labelledby="hotTitle">
        <div class="section__head">
          <h2 class="section__title" id="hotTitle">Горячие вопросы</h2>
          <span class="section__aside">Техника, повседневка, законы, приложения и нейросети</span>
        </div>
        <ul class="qlist">${hotMixed.slice(5, 17).map((q) => qRowStatic(q, "./", { showShort: true })).join("")}</ul>
      </section>

      <section class="section" aria-labelledby="freshTitle">
        <div class="section__head"><h2 class="section__title" id="freshTitle">Новые разборы</h2></div>
        <ul class="qlist">${freshMixed.map((q) => qRowStatic(q, "./")).join("")}</ul>
      </section>`
  })
);

const sitemapUrls = [
  `${SITE_URL}/`,
  `${SITE_URL}/categories/`,
  `${SITE_URL}/tools/`,
  `${SITE_URL}/about/`
];

/* ---------- 2. Categories, Tools, Saved, About ---------- */
writeFile(
  "categories/index.html",
  shell({
    title: `Все темы — ${SITE_NAME}`,
    desc: `${categories.length} разделов и ${qWord(questions.length)}: ремонт, сантехника, быт, ЖКХ, Госуслуги, авто, права, смартфоны, игры и нейросети.`,
    canonical: `${SITE_URL}/categories/`,
    base: "../",
    nav: "categories",
    ogType: "website",
    bodyHtml: `
      <nav class="crumbs" aria-label="Навигационная цепочка"><ol><li><a href="../">Главная</a></li><li><span aria-current="page">Темы</span></li></ol></nav>
      <header class="pagehead"><h1>Все темы</h1><p>${categories.length} разделов и ${qWord(questions.length)} — выберите, с чего начать.</p></header>
      <ol class="index">${catIndexRows("../")}</ol>`
  })
);

writeFile(
  "tools/index.html",
  shell({
    title: `Калькуляторы и чек-листы — ${SITE_NAME}`,
    desc: "Бесплатные онлайн-калькуляторы (самозанятость НПД, пауэрбанк, пополнение Steam) и чек-листы проверки б/у iPhone и аренды квартиры.",
    canonical: `${SITE_URL}/tools/`,
    base: "../",
    nav: "tools",
    ogType: "website",
    bodyHtml: `
      <nav class="crumbs" aria-label="Навигационная цепочка"><ol><li><a href="../">Главная</a></li><li><span aria-current="page">Инструменты</span></li></ol></nav>
      <header class="pagehead"><h1>Калькуляторы и чек-листы</h1><p>Интерактивные помощники для повседневных расчётов и проверок — работают прямо в браузере, без регистрации.</p></header>
      <div class="tools-grid">${widgetHTML("npd-calc")}${widgetHTML("powerbank-calc")}${widgetHTML("steam-calc")}${widgetHTML("iphone-check")}${widgetHTML("rent-check")}</div>`
  })
);

writeFile(
  "saved/index.html",
  shell({
    title: `Сохранённое — ${SITE_NAME}`,
    desc: "Ваши сохранённые разборы и шпаргалки на сайте ХайпОтвет.",
    canonical: `${SITE_URL}/saved/`,
    base: "../",
    nav: "saved",
    ogType: "website",
    bodyHtml: `
      <nav class="crumbs" aria-label="Навигационная цепочка"><ol><li><a href="../">Главная</a></li><li><span aria-current="page">Сохранённое</span></li></ol></nav>
      <header class="pagehead"><h1>Сохранённые разборы</h1><p>Закладки хранятся локально в вашем браузере — удобно держать под рукой нужные инструкции.</p></header>
      <div id="savedRoot"><p class="empty">Загрузка сохранённых разборов…</p></div>`
  })
);

writeFile(
  "about/index.html",
  shell({
    title: `О сайте и правила — ${SITE_NAME}`,
    desc: "Справочный характер материалов, конфиденциальность и связь через Telegram.",
    canonical: `${SITE_URL}/about/`,
    base: "../",
    ogType: "website",
    bodyHtml: `
      <nav class="crumbs" aria-label="Навигационная цепочка"><ol><li><a href="../">Главная</a></li><li><span aria-current="page">О сайте и правила</span></li></ol></nav>
      <article class="article">
        <h1>О сайте и правила использования</h1>
        <div class="content" style="margin-top:24px">
          <h2>Справочный характер материалов</h2>
          <p>Все статьи, калькуляторы и чек-листы на сайте <b>${SITE_NAME}</b> носят исключительно информационно-справочный характер и не заменяют консультацию врача, юриста или финансового специалиста.</p>
          <h2>Конфиденциальность</h2>
          <p>Сайт не собирает персональные данные и не использует сторонние рекламные трекеры. Закладки, тема и чек-листы хранятся локально в браузере пользователя (<code>localStorage</code>). Переход в Telegram осуществляется добровольно.</p>
          <h2>Связь</h2>
          <p>Предложить вопрос или сообщить об ошибке: <a href="https://t.me/${TG_BOT}?start=suggest" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Telegram-бот @${TG_BOT}</a> · <a href="${TG_URL}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Telegram-канал</a>.</p>
        </div>
      </article>`
  })
);

/* ---------- 3. Category Pages (dist/c/<id>/index.html) ---------- */
const byCategory = Object.fromEntries(categories.map((c) => [c.id, questions.filter((q) => q.cat === c.id)]));

for (const c of categories) {
  const list = byCategory[c.id];
  const url = `${SITE_URL}/c/${c.id}/`;
  sitemapUrls.push(url);
  const hotCount = list.filter((q) => q.hot).length;
  const newCount = list.filter((q) => q.isNew).length;

  writeFile(
    `c/${c.id}/index.html`,
    shell({
      title: `${c.title} — ${SITE_NAME}`,
      desc: `${c.desc}. ${qWord(list.length)} с подробными пошаговыми ответами.`,
      canonical: url,
      base: "../../",
      nav: "categories",
      ogType: "website",
      ldJson: {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Главная", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Темы", item: `${SITE_URL}/categories/` },
          { "@type": "ListItem", position: 3, name: c.title, item: url }
        ]
      },
      bodyHtml: `
        <nav class="crumbs" aria-label="Навигационная цепочка"><ol><li><a href="../../">Главная</a></li><li><a href="../../categories/">Темы</a></li><li><span aria-current="page">${esc(c.title)}</span></li></ol></nav>
        <header class="pagehead"><span class="pagehead__num">Раздел ${catIndex[c.id]}</span><h1>${esc(c.title)}</h1><p>${esc(c.desc)}. ${qWord(list.length)}.</p></header>
        <div class="filters" role="group" aria-label="Фильтр вопросов" data-cat-filters>
          <button type="button" class="filter" data-f="all" aria-pressed="true">Все (${list.length})</button>
          <button type="button" class="filter" data-f="hot" aria-pressed="false">Хайп (${hotCount})</button>
          <button type="button" class="filter" data-f="new" aria-pressed="false">Новое (${newCount})</button>
        </div>
        <ul class="qlist">${list.map((q) => qRowStatic(q, "../../", { showCat: false, showShort: true })).join("")}</ul>`
    })
  );
}

/* ---------- 4. Question Pages (dist/q/<id>/index.html) ---------- */
for (let qi = 0; qi < questions.length; qi++) {
  const q = questions[qi];
  const c = catById[q.cat];
  const url = `${SITE_URL}/q/${q.id}/`;
  sitemapUrls.push(url);

  // Circular sibling links inside same category (so EVERY article gets 6 incoming links!)
  const related = getSiblingLinks(byCategory[q.cat], q.id, 6);
  // Rotated cross-category hot links (distributes link juice across all hot articles)
  const otherHot = [];
  for (let k = 0; k < hotMixed.length && otherHot.length < 5; k++) {
    const cand = hotMixed[(qi + k) % hotMixed.length];
    if (cand.cat !== q.cat && !otherHot.includes(cand)) otherHot.push(cand);
  }

  const deepLink = botDeepLink(q);
  const wType = WIDGET_MAP[q.id];
  const isStatusCat = STATUS_CATS.has(q.cat);

  const ldJson = [
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: q.title,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${q.short} ${stripHtml(q.answer)}`
          }
        }
      ]
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: c.title, item: `${SITE_URL}/c/${c.id}/` },
        { "@type": "ListItem", position: 3, name: q.title, item: url }
      ]
    }
  ];

  writeFile(
    `q/${q.id}/index.html`,
    shell({
      title: `${q.title} — ${SITE_NAME}`,
      desc: q.short,
      canonical: url,
      base: "../../",
      ldJson,
      bodyHtml: `
        <nav class="crumbs" aria-label="Навигационная цепочка"><ol><li><a href="../../">Главная</a></li><li><a href="../../c/${c.id}/">${esc(c.title)}</a></li><li><span aria-current="page">Вопрос</span></li></ol></nav>
        <div class="layout">
          <article class="article" data-qid="${esc(q.id)}" data-qtitle="${esc(q.title)}" data-qshort="${esc(q.short)}" data-cnum="${catIndex[c.id]}" data-ctitle="${esc(c.title)}">
            <h1>${esc(q.title)}</h1>
            <div class="meta">${q.hot ? '<span class="tag tag--hot">Хайп</span>' : ""}${q.isNew ? '<span class="tag tag--new">Новое</span>' : ""}<a href="../../c/${c.id}/">${esc(c.title)}</a><span>${readTime(q)} мин чтения</span></div>
            <div class="lede"><b>Коротко</b>${esc(q.short)}</div>
            <div class="content">${q.answer}</div>
            ${wType ? widgetHTML(wType) : ""}
            <div class="actions">
              <span class="actions__label" id="voteLabel">Ответ помог?</span>
              <button type="button" class="btn" data-vote="up" aria-pressed="false" aria-describedby="voteLabel">Да</button>
              <button type="button" class="btn" data-vote="down" aria-pressed="false" aria-describedby="voteLabel">Нет</button>
              <div class="actions__right">
                <button type="button" class="btn" id="saveBtn" aria-pressed="false">Сохранить</button>
                <button type="button" class="btn" id="cardBtn">Карточка для сторис</button>
                <button type="button" class="btn" id="shareBtn">Скопировать ссылку</button>
              </div>
            </div>
            <div class="cta-strip">
              <div class="cta-strip__text">
                <b>Открыть эту шпаргалку в Telegram</b>
                <span>${isStatusCat
                  ? "Бот пришлёт короткую карточку именно этого вопроса, а по команде /status покажет актуальный статус доступных сервисов на сегодня."
                  : "Чтобы не потерять ответ под рукой и получать обновления по теме."}</span>
              </div>
              <div class="cta-strip__btns">
                <a class="btn btn--primary" href="${deepLink}" target="_blank" rel="noopener noreferrer">Открыть в боте</a>
                ${isStatusCat
                  ? `<a class="btn" href="https://t.me/${TG_BOT}?start=status" target="_blank" rel="noopener noreferrer">Статус сервисов (/status)</a>`
                  : `<a class="btn" href="${TG_URL}" target="_blank" rel="noopener noreferrer">Канал в Telegram</a>`}
              </div>
            </div>
          </article>
          <aside class="sidebar" aria-label="Похожие и горячие вопросы">
            <section class="side"><h2>Похожие в «${esc(c.title)}»</h2><ul>${related.map((r) => `<li><a href="../${r.id}/">${esc(r.title)}</a></li>`).join("")}</ul></section>
            <section class="side"><h2>Горячее в других темах</h2><ul>${otherHot.map((r) => `<li><a href="../${r.id}/">${esc(r.title)}</a></li>`).join("")}</ul></section>
          </aside>
        </div>`
    })
  );
}

/* ---------- 5. sitemap.xml, robots.txt, netlify.toml ---------- */
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
  .map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`)
  .join("\n")}\n</urlset>\n`;
writeFile("sitemap.xml", sitemap);
writeFile("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);

writeFile("netlify.toml", `[build.processing]
  skip_processing = false

[build.processing.html]
  pretty_urls = true

[[headers]]
  for = "/styles.css"
  [headers.values]
    Cache-Control = "public, max-age=604800"

[[headers]]
  for = "/static-enhance.js"
  [headers.values]
    Cache-Control = "public, max-age=604800"

[[headers]]
  for = "/search-index.json"
  [headers.values]
    Cache-Control = "public, max-age=3600"

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
`);

console.log(`SEO build complete: ${sitemapUrls.length} URLs (${questions.length} question pages, ${categories.length} category pages, pre-rendered static home + tools + saved) -> dist/`);
