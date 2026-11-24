(() => {
  /* Настройки вашего проекта — подставьте реальные ссылки перед публикацией */
  const SITE_CONFIG = {
    siteName: "ХайпОтвет",
    siteDomain: "hypeotvet.netlify.app",
    telegramChannelUrl: "https://t.me/hypeotvet",
    telegramBotHandle: "hypeotvet_app"
  };

  const { categories, questions } = window.SITE_DATA;
  const app = document.getElementById("app");
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const qById = Object.fromEntries(questions.map((q) => [q.id, q]));
  const catIndex = Object.fromEntries(categories.map((c, i) => [c.id, String(i + 1).padStart(2, "0")]));

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  const plural = (n, [one, few, many]) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };
  const qWord = (n) => `${n} ${plural(n, ["вопрос", "вопроса", "вопросов"])}`;
  const countIn = (catId) => questions.filter((q) => q.cat === catId).length;
  const fmtMoney = (n) => Math.round(n).toLocaleString("ru-RU") + " ₽";

  const readTime = (q) => {
    const words = q.answer.replace(/<[^>]+>/g, " ").split(/\s+/).length;
    return Math.max(1, Math.round(words / 180));
  };

  /* ---------- Theme ---------- */
  const themeBtn = document.getElementById("themeToggle");
  const applyTheme = (mode) => {
    const isDark = mode === "dark";
    if (isDark) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", isDark ? "dark" : "light"); } catch { }
    if (themeBtn) {
      themeBtn.textContent = isDark ? "Бумага" : "Ночь";
      themeBtn.setAttribute("aria-pressed", String(isDark));
    }
  };
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  themeBtn?.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  /* ---------- Bookmarks (localStorage) ---------- */
  const getSaved = () => {
    try { return JSON.parse(localStorage.getItem("saved:ids") || "[]").filter((id) => qById[id]); }
    catch { return []; }
  };
  const setSaved = (ids) => {
    try { localStorage.setItem("saved:ids", JSON.stringify(ids)); } catch { }
    updateSavedBadge();
  };
  const isSaved = (id) => getSaved().includes(id);
  const toggleSaved = (id) => {
    const list = getSaved();
    const next = list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
    setSaved(next);
    return next.includes(id);
  };
  const updateSavedBadge = () => {
    const badge = document.getElementById("savedBadge");
    if (!badge) return;
    const n = getSaved().length;
    badge.textContent = String(n);
    badge.hidden = n === 0;
  };
  updateSavedBadge();

  /* ---------- Smart search: keyboard layout + synonyms ---------- */
  const EN_CHARS = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?";
  const RU_CHARS = "ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,";
  const enToRu = Object.fromEntries([...EN_CHARS].map((c, i) => [c, RU_CHARS[i]]));
  const ruToEn = Object.fromEntries([...RU_CHARS].map((c, i) => [c, EN_CHARS[i]]));
  const convertLayout = (str, map) => [...str].map((ch) => map[ch] || ch).join("");

  const SYNONYMS = [
    ["айфон", "iphone", "эпл", "apple", "ios"],
    ["андроид", "андройд", "android", "сяоми", "xiaomi", "самсунг", "samsung"],
    ["стим", "steam"],
    ["впн", "vpn"],
    ["дипсик", "deepseek"],
    ["чатгпт", "chatgpt", "гпт", "gpt"],
    ["нейронка", "нейросеть", "ии", "ai"],
    ["тг", "телега", "телеграм", "telegram"],
    ["вб", "вайлдберриз", "wildberries"],
    ["озон", "ozon"],
    ["авито", "avito"],
    ["жкх", "коммуналка", "квартплата", "счетчик", "счётчик", "показания"],
    ["прописка", "регистрация", "выписаться"],
    ["госы", "госуслуги"],
    ["омс", "поликлиника", "врач", "диспансеризация"],
    ["ноут", "ноутбук", "макбук", "macbook"],
    ["пк", "комп", "компьютер"],
    ["павербанк", "пауэрбанк", "powerbank"],
    ["пс5", "плейстейшн", "playstation", "ps5", "ps4"],
    ["иксбокс", "xbox"],
    ["ютуб", "youtube", "рутуб", "rutube"],
    ["дискорд", "discord"],
    ["аренда", "снять", "квартира", "залог"],
    ["билеты", "авиабилеты", "самолет", "самолёт", "ржд"],
    ["вайфай", "wifi", "wi-fi", "роутер"],
    ["айклауд", "icloud", "эплайди"]
  ];

  const expandWord = (w) => {
    const out = new Set([w]);
    const clean = w.replace(/ё/g, "е");
    out.add(clean);
    if (clean.length > 5) out.add(clean.slice(0, -2));
    for (const group of SYNONYMS) {
      if (group.some((g) => g === clean || (clean.length >= 4 && g.startsWith(clean)))) {
        for (const g of group) out.add(g.replace(/ё/g, "е"));
      }
    }
    return [...out];
  };

  const splitWords = (query) =>
    query.toLowerCase().trim().split(/[\s,.;:!?/\\()«»"']+/).filter((w) => w.length > 1);

  const scoreQuery = (query) => {
    const words = splitWords(query);
    if (!words.length) return [];
    const expanded = words.map(expandWord);
    return questions
      .map((q) => {
        const title = q.title.toLowerCase().replace(/ё/g, "е");
        const body = (q.short + " " + q.answer.replace(/<[^>]+>/g, " ") + " " + (q.keywords || "")).toLowerCase().replace(/ё/g, "е");
        let score = 0;
        let matchedTerms = 0;
        for (const variants of expanded) {
          let hit = 0;
          for (const v of variants) {
            if (title.includes(v)) hit = Math.max(hit, 6);
            else if (body.includes(v)) hit = Math.max(hit, 2);
          }
          if (hit) matchedTerms++;
          score += hit;
        }
        if (matchedTerms === expanded.length && expanded.length > 1) score += 6;
        return { q, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.q);
  };

  const smartSearch = (rawQuery) => {
    const q = (rawQuery || "").trim();
    if (!q) return { items: [], corrected: "" };
    const direct = scoreQuery(q);
    if (direct.length) return { items: direct, corrected: "" };
    const hasLat = /[a-z]/i.test(q);
    const hasCyr = /[а-яё]/i.test(q);
    const alt = hasLat && !hasCyr ? convertLayout(q, enToRu) : hasCyr && !hasLat ? convertLayout(q, ruToEn) : "";
    if (alt && alt !== q) {
      const altRes = scoreQuery(alt);
      if (altRes.length) return { items: altRes, corrected: alt };
    }
    return { items: [], corrected: "" };
  };

  const highlight = (text, query) => {
    const safe = esc(text);
    const words = splitWords(query || "")
      .flatMap(expandWord)
      .filter((w) => w.length > 2)
      .slice(0, 12)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return safe;
    return safe.replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>");
  };

  /* ---------- Interactive Widgets ---------- */
  const WIDGET_MAP = {
    "proverit-bu-iphone": "iphone-check",
    "p12-hs-proverka-kvartiry-arenda": "rent-check",
    "ip-ili-samozanyatost": "npd-calc",
    "p09-mn-cheki-moj-nalog": "npd-calc",
    "vybor-pauerbanka": "powerbank-calc",
    "popolnit-steam-v-rossii": "steam-calc"
  };

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
      return `
        <section class="widget" data-widget="${type}">
          <div class="widget__head">
            <h3 class="widget__title">${esc(cfg.title)}</h3>
            <span class="widget__meta" data-progress>0 из ${cfg.items.length}</span>
          </div>
          <ul class="widget__checks">
            ${cfg.items.map((txt, i) => `<li><label><input type="checkbox" data-idx="${i}" /><span>${esc(txt)}</span></label></li>`).join("")}
          </ul>
          <div class="widget__bar">
            <button type="button" class="btn" data-reset>Сбросить отметки</button>
            <span class="widget__meta">Отметки сохраняются в этом браузере</span>
          </div>
        </section>`;
    }
    if (type === "npd-calc") {
      return `
        <section class="widget" data-widget="npd-calc">
          <div class="widget__head">
            <h3 class="widget__title">Калькулятор налога самозанятого (НПД)</h3>
            <span class="widget__meta">4% физлица / 6% компании</span>
          </div>
          <div class="widget__grid">
            <div>
              <label class="field-label" for="npdSum">Сумма поступления, ₽</label>
              <input class="field-input" id="npdSum" type="number" min="0" step="500" value="50000" />
            </div>
            <div>
              <label class="field-label" for="npdType">Кто платит</label>
              <select class="field-input" id="npdType">
                <option value="4">Физическое лицо (4%)</option>
                <option value="6">ИП или компания (6%)</option>
              </select>
            </div>
          </div>
          <label class="widget__toggle"><input type="checkbox" id="npdBonus" /> Учитывать стартовый налоговый бонус 10 000 ₽ (ставка 3% / 4%)</label>
          <div class="widget__out" id="npdOut"></div>
          <p class="widget__hint">Лимит дохода для самозанятых — 2,4 млн ₽ в год. Оплата налога — до 28-го числа следующего месяца.</p>
        </section>`;
    }
    if (type === "powerbank-calc") {
      return `
        <section class="widget" data-widget="powerbank-calc">
          <div class="widget__head">
            <h3 class="widget__title">Калькулятор реальных зарядок пауэрбанка</h3>
            <span class="widget__meta">КПД ~62% + проверка самолёта</span>
          </div>
          <div class="widget__grid">
            <div>
              <label class="field-label" for="pbCap">Ёмкость пауэрбанка, мА·ч</label>
              <input class="field-input" id="pbCap" type="number" min="1000" max="60000" step="1000" value="20000" />
            </div>
            <div>
              <label class="field-label" for="pbPhone">Батарея смартфона, мА·ч</label>
              <input class="field-input" id="pbPhone" type="number" min="1500" max="12000" step="100" value="5000" />
            </div>
          </div>
          <div class="widget__out" id="pbOut"></div>
          <p class="widget__hint" id="pbHint"></p>
        </section>`;
    }
    if (type === "steam-calc") {
      return `
        <section class="widget" data-widget="steam-calc">
          <div class="widget__head">
            <h3 class="widget__title">Калькулятор пополнения Steam</h3>
            <span class="widget__meta">Оценка итоговой суммы с комиссией</span>
          </div>
          <div class="widget__grid">
            <div>
              <label class="field-label" for="stWant">Нужно получить на Steam, ₽</label>
              <input class="field-input" id="stWant" type="number" min="50" step="100" value="1500" />
            </div>
            <div>
              <label class="field-label" for="stFee">Комиссия и конвертация, %</label>
              <input class="field-input" id="stFee" type="number" min="0" max="35" step="0.5" value="8" />
            </div>
          </div>
          <div class="widget__out" id="stOut"></div>
          <p class="widget__hint">Фактическая сумма может отличаться на 1–3% из-за курса конвертации валют в момент платежа.</p>
        </section>`;
    }
    return "";
  };

  const initWidgets = (root) => {
    root.querySelectorAll("[data-widget]").forEach((el) => {
      const type = el.dataset.widget;
      if (CHECKLISTS[type]) {
        const key = "check:" + type;
        const boxes = [...el.querySelectorAll('input[type="checkbox"]')];
        const prog = el.querySelector("[data-progress]");
        let saved = [];
        try { saved = JSON.parse(localStorage.getItem(key) || "[]"); } catch { }
        boxes.forEach((b, i) => { b.checked = Boolean(saved[i]); });
        const sync = () => {
          const state = boxes.map((b) => b.checked);
          const done = state.filter(Boolean).length;
          prog.textContent = `Проверено ${done} из ${boxes.length}`;
          try { localStorage.setItem(key, JSON.stringify(state)); } catch { }
        };
        sync();
        boxes.forEach((b) => b.addEventListener("change", sync));
        el.querySelector("[data-reset]")?.addEventListener("click", () => {
          boxes.forEach((b) => (b.checked = false));
          sync();
        });
      }
      if (type === "npd-calc") {
        const sumEl = el.querySelector("#npdSum");
        const typeEl = el.querySelector("#npdType");
        const bonusEl = el.querySelector("#npdBonus");
        const out = el.querySelector("#npdOut");
        const calc = () => {
          const sum = Math.max(0, Number(sumEl.value) || 0);
          const base = Number(typeEl.value);
          const rate = bonusEl.checked ? (base === 4 ? 3 : 4) : base;
          const tax = sum * (rate / 100);
          const net = sum - tax;
          const gross = sum / (1 - rate / 100);
          out.innerHTML = `
            <div class="widget__stat"><span>Налог (${rate}%)</span><b>${fmtMoney(tax)}</b></div>
            <div class="widget__stat"><span>Чистыми на руки</span><b>${fmtMoney(net)}</b></div>
            <div class="widget__stat"><span>Выставить, чтобы на руки ${fmtMoney(sum)}</span><b>${fmtMoney(gross)}</b></div>`;
        };
        calc();
        [sumEl, typeEl, bonusEl].forEach((x) => x.addEventListener("input", calc));
        [typeEl, bonusEl].forEach((x) => x.addEventListener("change", calc));
      }
      if (type === "powerbank-calc") {
        const capEl = el.querySelector("#pbCap");
        const phEl = el.querySelector("#pbPhone");
        const out = el.querySelector("#pbOut");
        const hint = el.querySelector("#pbHint");
        const calc = () => {
          const cap = Math.max(1000, Number(capEl.value) || 0);
          const phone = Math.max(1000, Number(phEl.value) || 1);
          const usable = cap * 0.62;
          const charges = (usable / phone).toFixed(1).replace(".", ",");
          const wh = (cap * 3.7) / 1000;
          const okPlane = wh <= 100;
          out.innerHTML = `
            <div class="widget__stat"><span>Полных зарядок</span><b>~${charges}</b></div>
            <div class="widget__stat"><span>Энергия (при 3,7 В)</span><b>${wh.toFixed(1).replace(".", ",")} Вт·ч</b></div>
            <div class="widget__stat"><span>В ручную кладь</span><b>${okPlane ? "Можно" : "Нужно согласие"}</b></div>`;
          hint.textContent = okPlane
            ? "До 100 Вт·ч пауэрбанк свободно пускают в ручную кладь большинства авиакомпаний (в багаж сдавать нельзя)."
            : "Выше 100 Вт·ч (примерно 27 000 мА·ч) требуется предварительное одобрение авиакомпании, свыше 160 Вт·ч запрещено.";
        };
        calc();
        [capEl, phEl].forEach((x) => x.addEventListener("input", calc));
      }
      if (type === "steam-calc") {
        const wantEl = el.querySelector("#stWant");
        const feeEl = el.querySelector("#stFee");
        const out = el.querySelector("#stOut");
        const calc = () => {
          const want = Math.max(0, Number(wantEl.value) || 0);
          const feePct = Math.max(0, Number(feeEl.value) || 0);
          const pay = want * (1 + feePct / 100);
          const fee = pay - want;
          out.innerHTML = `
            <div class="widget__stat"><span>К оплате с карты</span><b>${fmtMoney(pay)}</b></div>
            <div class="widget__stat"><span>Комиссия</span><b>${fmtMoney(fee)}</b></div>
            <div class="widget__stat"><span>Придёт в Steam</span><b>${fmtMoney(want)}</b></div>`;
        };
        calc();
        [wantEl, feeEl].forEach((x) => x.addEventListener("input", calc));
      }
    });
  };

  /* ---------- Code block copy buttons ---------- */
  const enhanceCodeBlocks = (root) => {
    root.querySelectorAll(".content pre").forEach((pre) => {
      if (pre.parentElement?.classList.contains("codeblock")) return;
      const wrap = document.createElement("div");
      wrap.className = "codeblock";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "codeblock__copy";
      btn.textContent = "Скопировать";
      btn.addEventListener("click", () => {
        const txt = pre.innerText || pre.textContent || "";
        navigator.clipboard?.writeText(txt.trim());
        btn.textContent = "Скопировано";
        setTimeout(() => (btn.textContent = "Скопировать"), 1600);
      });
      wrap.appendChild(btn);
    });
  };

  /* ---------- Story card PNG generator (1080x1350) ---------- */
  const exportStoryCard = (q, c) => {
    const W = 1080, H = 1350, P = 84;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const dark = document.documentElement.dataset.theme === "dark";
    const col = dark
      ? { bg: "#141310", card: "#1b1a15", ink: "#eee9dc", muted: "#b5ae9c", rule: "#343129", marker: "#e6c645" }
      : { bg: "#f5f2ea", card: "#fbf9f4", ink: "#17150f", muted: "#4a463c", rule: "#d6cfbf", marker: "#ffe15a" };

    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, W, H);

    const wrap = (text, maxW, font, lh) => {
      ctx.font = font;
      const words = text.split(/\s+/);
      const lines = [];
      let cur = "";
      for (const w of words) {
        const test = cur ? cur + " " + w : w;
        if (ctx.measureText(test).width > maxW && cur) {
          lines.push(cur);
          cur = w;
        } else cur = test;
      }
      if (cur) lines.push(cur);
      return { lines, lh };
    };

    // Header
    ctx.fillStyle = col.ink;
    ctx.font = "700 38px Georgia, serif";
    ctx.fillText(SITE_CONFIG.siteName, P, 108);
    ctx.fillStyle = col.muted;
    ctx.font = "500 26px system-ui, sans-serif";
    const catLabel = `Раздел ${catIndex[c.id]} / ${c.title}`;
    ctx.fillText(catLabel, P, 158);
    ctx.fillStyle = col.ink;
    ctx.fillRect(P, 186, W - P * 2, 3);

    // Question title
    const t = wrap(q.title, W - P * 2, "700 58px Georgia, serif", 72);
    let y = 278;
    ctx.fillStyle = col.ink;
    ctx.font = "700 58px Georgia, serif";
    for (const line of t.lines.slice(0, 5)) {
      ctx.fillText(line, P, y);
      y += t.lh;
    }

    // Marker bar & Short answer card
    y += 34;
    const s = wrap(q.short, W - P * 2 - 76, "400 34px system-ui, sans-serif", 50);
    const boxH = Math.max(220, s.lines.length * s.lh + 116);
    ctx.fillStyle = col.card;
    ctx.fillRect(P, y, W - P * 2, boxH);
    ctx.fillStyle = col.marker;
    ctx.fillRect(P, y, 14, boxH);

    ctx.fillStyle = col.muted;
    ctx.font = "600 24px system-ui, sans-serif";
    ctx.fillText("КОРОТКИЙ ОТВЕТ", P + 44, y + 54);
    ctx.fillStyle = col.ink;
    ctx.font = "400 34px system-ui, sans-serif";
    let sy = y + 108;
    for (const line of s.lines.slice(0, 8)) {
      ctx.fillText(line, P + 44, sy);
      sy += s.lh;
    }

    // Footer
    ctx.fillStyle = col.rule;
    ctx.fillRect(P, H - 150, W - P * 2, 2);
    ctx.fillStyle = col.ink;
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.fillText(`Полный разбор по шагам — на ${SITE_CONFIG.siteName}`, P, H - 96);
    ctx.fillStyle = col.muted;
    ctx.font = "500 24px ui-monospace, Consolas, monospace";
    ctx.fillText(`${SITE_CONFIG.siteDomain}/q/${q.id}`, P, H - 56);

    const a = document.createElement("a");
    a.download = `hypeotvet-${q.id}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  /* ---------- Suggest Question Modal ---------- */
  const modal = document.getElementById("suggestModal");
  const modalCat = document.getElementById("suggestCat");
  const modalText = document.getElementById("suggestText");
  const modalStatus = document.getElementById("suggestStatus");
  const modalTg = document.getElementById("suggestTgLink");

  if (modalCat) {
    modalCat.innerHTML =
      categories.map((c) => `<option value="${esc(c.title)}">${esc(c.title)}</option>`).join("") +
      '<option value="Другая тема">Другая тема</option>';
  }
  const updateModalTg = () => {
    if (!modalTg) return;
    modalTg.href = `https://t.me/${SITE_CONFIG.telegramBotHandle}?start=suggest`;
  };
  modalCat?.addEventListener("change", updateModalTg);
  modalText?.addEventListener("input", updateModalTg);
  modalTg?.addEventListener("click", () => {
    const txt = modalText?.value.trim();
    if (txt) navigator.clipboard?.writeText(`[${modalCat?.value || ""}] ${txt}`);
  });

  const openSuggestModal = (presetCat) => {
    if (!modal) return;
    if (presetCat && modalCat) modalCat.value = presetCat;
    if (modalStatus) modalStatus.textContent = "";
    updateModalTg();
    modal.showModal();
    modalText?.focus();
  };

  document.getElementById("suggestModalClose")?.addEventListener("click", () => modal?.close());
  document.getElementById("footerSuggestBtn")?.addEventListener("click", () => openSuggestModal());
  document.getElementById("suggestModalForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const txt = modalText.value.trim();
    if (!txt) return;
    const entry = { cat: modalCat.value, text: txt, at: new Date().toISOString() };
    try {
      const prev = JSON.parse(localStorage.getItem("suggested:questions") || "[]");
      prev.unshift(entry);
      localStorage.setItem("suggested:questions", JSON.stringify(prev.slice(0, 30)));
    } catch { }
    navigator.clipboard?.writeText(`Предложение вопроса (${entry.cat}): ${entry.text}`);
    modalStatus.textContent = "Вопрос сохранён в браузере и скопирован — можно отправить нам в Telegram.";
    modalText.value = "";
    updateModalTg();
  });

  document.getElementById("randomBtn")?.addEventListener("click", () => {
    const pick = questions[Math.floor(Math.random() * questions.length)];
    if (pick) location.hash = `#/q/${pick.id}`;
  });

  /* ---------- UI Templates ---------- */
  const tags = (q) =>
    `${q.hot ? '<span class="tag tag--hot">Хайп</span>' : ""}${q.isNew ? '<span class="tag tag--new">Новое</span>' : ""}`;

  const crumbs = (items) =>
    `<nav class="crumbs" aria-label="Навигационная цепочка"><ol>${items
      .map(([label, href]) => `<li>${href ? `<a href="${href}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`}</li>`)
      .join("")}</ol></nav>`;

  const qItem = (q, { query = "", showCat = true, showShort = false } = {}) => {
    const c = catById[q.cat];
    return `
      <li>
        <a class="qitem" href="#/q/${q.id}">
          <div class="qitem__title">${highlight(q.title, query)}</div>
          ${showShort ? `<p class="qitem__short">${esc(q.short)}</p>` : ""}
          <div class="meta">${tags(q)}${showCat ? `<span>${esc(c.title)}</span>` : ""}<span>${readTime(q)} мин чтения</span>${WIDGET_MAP[q.id] ? "<span>Есть интерактив</span>" : ""}</div>
        </a>
      </li>`;
  };

  const indexRow = (c) => `
    <li>
      <a class="index__row" href="#/c/${c.id}">
        <span class="index__num">${catIndex[c.id]}</span>
        <span class="index__title">${esc(c.title)}</span>
        <span class="index__count">${qWord(countIn(c.id))}</span>
        <span class="index__desc">${esc(c.desc)}</span>
      </a>
    </li>`;

  const suggestItems = (list, query) =>
    list.length
      ? `<ul>${list
        .map(
          (q) =>
            `<li><a href="#/q/${q.id}"><span class="suggest__q">${highlight(q.title, query)}</span><span class="suggest__cat">${esc(catById[q.cat].title)}</span></a></li>`
        )
        .join("")}</ul>`
      : `<p class="suggest__empty">Точного совпадения нет. Нажмите «Найти ответ» — поищем по тексту всех разборов.</p>`;

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

  function renderPaginatedList(container, list, opts, pageSize = 25) {
    let shown = Math.min(pageSize, list.length);
    const draw = () => {
      container.innerHTML = `
        <ul class="qlist">${list.slice(0, shown).map((q) => qItem(q, opts)).join("")}</ul>
        ${shown < list.length ? `<div style="margin-top:24px"><button type="button" class="btn" id="moreBtn">Показать ещё (${list.length - shown})</button></div>` : ""}`;
      document.getElementById("moreBtn")?.addEventListener("click", () => {
        shown = Math.min(list.length, shown + pageSize);
        draw();
      });
    };
    draw();
  }

  /* ---------- Pages ---------- */

  function renderHome() {
    const hot = interleaveByCat(questions.filter((q) => q.hot), [
      "diy-repair", "phones", "zhkh", "cleaning-home", "auto-care",
      "gosuslugi", "housing", "travel", "health", "kitchen-food", "life-skills",
      "games", "security", "access", "neuro", "apps", "crypto-fin", "pc", "gadgets", "home-tech"
    ]);
    const fresh = interleaveByCat(questions.filter((q) => q.isNew), [
      "diy-repair", "cleaning-home", "kitchen-food", "auto-care", "life-skills",
      "housing", "travel", "health", "zhkh", "gosuslugi"
    ]).slice(0, 10);
    const defaults = hot.slice(0, 5);
    document.title = `${SITE_CONFIG.siteName} — ответы на вопросы, которые все гуглят`;

    app.innerHTML = `
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
            <div id="heroSuggest" aria-live="polite">${suggestItems(defaults, "")}</div>
          </div>
        </form>
      </section>

      <section class="section" aria-labelledby="topicsTitle">
        <div class="section__head">
          <h2 class="section__title" id="topicsTitle">Темы</h2>
          <span class="section__aside">${categories.length} разделов · <a href="#/tools">Калькуляторы и чек-листы</a></span>
        </div>
        <ol class="index">${categories.map(indexRow).join("")}</ol>
      </section>

      <section class="section" aria-labelledby="hotTitle">
        <div class="section__head">
          <h2 class="section__title" id="hotTitle">Горячие вопросы</h2>
          <span class="section__aside">Техника, повседневка, законы, приложения и нейросети</span>
        </div>
        <ul class="qlist">${hot.slice(5, 15).map((q) => qItem(q, { showShort: true })).join("")}</ul>
      </section>

      ${fresh.length ? `
      <section class="section" aria-labelledby="freshTitle">
        <div class="section__head"><h2 class="section__title" id="freshTitle">Новые разборы</h2></div>
        <ul class="qlist">${fresh.map((q) => qItem(q)).join("")}</ul>
      </section>` : ""}
    `;

    const input = document.getElementById("heroInput");
    const box = document.getElementById("heroSuggest");
    const label = document.getElementById("suggestLabel");
    const count = document.getElementById("suggestCount");
    input.addEventListener("input", () => {
      const v = input.value.trim();
      if (!v) {
        label.textContent = "Часто ищут";
        count.textContent = `${questions.length} разборов в базе`;
        box.innerHTML = suggestItems(defaults, "");
        return;
      }
      const { items, corrected } = smartSearch(v);
      label.textContent = corrected ? `Исправлена раскладка: «${corrected}»` : "Похожие вопросы";
      count.textContent = `Найдено: ${items.length}`;
      box.innerHTML = suggestItems(items.slice(0, 6), corrected || v);
    });
    document.getElementById("heroForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) location.hash = `#/search?q=${encodeURIComponent(v)}`;
      else input.focus();
    });
  }

  function renderCategories() {
    document.title = `Все темы — ${SITE_CONFIG.siteName}`;
    app.innerHTML = `
      ${crumbs([["Главная", "#/"], ["Темы"]])}
      <header class="pagehead">
        <h1>Все темы</h1>
        <p>${categories.length} разделов и ${qWord(questions.length)} — выберите, с чего начать.</p>
      </header>
      <ol class="index">${categories.map(indexRow).join("")}</ol>`;
  }

  function renderCategory(id, filter = "all") {
    const c = catById[id];
    if (!c) return renderNotFound();
    document.title = `${c.title} — ${SITE_CONFIG.siteName}`;
    const all = questions.filter((q) => q.cat === id);
    let list = all;
    if (filter === "hot") list = all.filter((q) => q.hot);
    if (filter === "new") list = all.filter((q) => q.isNew);
    const f = (key, text) => `<button type="button" class="filter" data-f="${key}" aria-pressed="${filter === key}">${text}</button>`;

    app.innerHTML = `
      ${crumbs([["Главная", "#/"], ["Темы", "#/categories"], [c.title]])}
      <header class="pagehead">
        <span class="pagehead__num">Раздел ${catIndex[c.id]}</span>
        <h1>${esc(c.title)}</h1>
        <p>${esc(c.desc)}. ${qWord(all.length)}.</p>
      </header>
      <div class="filters" role="group" aria-label="Фильтр вопросов">
        ${f("all", `Все (${all.length})`)}${f("hot", `Хайп (${all.filter((q) => q.hot).length})`)}${f("new", `Новое (${all.filter((q) => q.isNew).length})`)}
      </div>
      <div id="catList"></div>`;

    const box = document.getElementById("catList");
    if (list.length) renderPaginatedList(box, list, { showCat: false, showShort: true }, 25);
    else box.innerHTML = '<div class="empty"><strong>Здесь пока пусто</strong>В этом фильтре нет вопросов. Посмотрите все вопросы раздела.</div>';

    app.querySelectorAll(".filter").forEach((b) =>
      b.addEventListener("click", () => {
        renderCategory(id, b.dataset.f);
        app.querySelector(`.filter[data-f="${b.dataset.f}"]`)?.focus();
      })
    );
  }

  function renderTools() {
    document.title = `Инструменты и чек-листы — ${SITE_CONFIG.siteName}`;
    app.innerHTML = `
      ${crumbs([["Главная", "#/"], ["Инструменты"]])}
      <header class="pagehead">
        <h1>Калькуляторы и чек-листы</h1>
        <p>Интерактивные помощники для повседневных расчётов и проверок — работают прямо в браузере, без регистрации.</p>
      </header>
      <div class="tools-grid">
        ${widgetHTML("npd-calc")}
        ${widgetHTML("powerbank-calc")}
        ${widgetHTML("steam-calc")}
        ${widgetHTML("iphone-check")}
        ${widgetHTML("rent-check")}
      </div>`;
    initWidgets(app);
  }

  function renderSaved() {
    const ids = getSaved();
    document.title = `Сохранённое — ${SITE_CONFIG.siteName}`;
    app.innerHTML = `
      ${crumbs([["Главная", "#/"], ["Сохранённое"]])}
      <header class="pagehead">
        <h1>Сохранённые разборы</h1>
        <p>Закладки хранятся локально в вашем браузере — удобно держать под рукой инструкции по ЖКХ, Госуслугам и проверкам.</p>
      </header>
      ${ids.length
        ? `<div style="margin:20px 0"><button type="button" class="btn" id="clearSavedBtn">Очистить всё (${ids.length})</button></div>
           <ul class="qlist">${ids.map((id) => {
          const q = qById[id];
          const c = catById[q.cat];
          return `<li class="qitem-row">
               <a class="qitem" href="#/q/${q.id}">
                 <div class="qitem__title">${esc(q.title)}</div>
                 <p class="qitem__short">${esc(q.short)}</p>
                 <div class="meta">${tags(q)}<span>${esc(c.title)}</span><span>${readTime(q)} мин чтения</span></div>
               </a>
               <button type="button" class="btn" data-unsave="${q.id}">Убрать</button>
             </li>`;
        }).join("")}</ul>`
        : '<div class="empty"><strong>Пока ничего не сохранено</strong>Откройте любой разбор и нажмите «Сохранить» — он появится здесь. <a href="#/categories">Выбрать тему</a></div>'}`;

    document.getElementById("clearSavedBtn")?.addEventListener("click", () => {
      setSaved([]);
      renderSaved();
    });
    app.querySelectorAll("[data-unsave]").forEach((b) =>
      b.addEventListener("click", () => {
        toggleSaved(b.dataset.unsave);
        renderSaved();
      })
    );
  }

  function renderQuestion(id) {
    const q = qById[id];
    if (!q) return renderNotFound();
    const c = catById[q.cat];
    document.title = `${q.title} — ${SITE_CONFIG.siteName}`;
    const related = (() => {
      const list = questions.filter((x) => x.cat === q.cat);
      const idx = list.findIndex((x) => x.id === q.id);
      const out = [];
      for (const off of [-2, -1, 1, 2, 3, 4]) {
        const pick = list[(idx + off + list.length * 4) % list.length];
        if (pick && pick.id !== q.id && !out.includes(pick)) out.push(pick);
      }
      return out.slice(0, 6);
    })();
    const hot = interleaveByCat(questions.filter((x) => x.hot && x.cat !== q.cat)).slice(0, 5);
    const vote = localStorage.getItem("vote:" + q.id);
    const saved = isSaved(q.id);
    const wType = WIDGET_MAP[q.id];
    const deepPayload = ("q_" + q.id).length <= 64 ? "q_" + q.id : "n_" + questions.indexOf(q);
    const deepLink = `https://t.me/${SITE_CONFIG.telegramBotHandle}?start=${deepPayload}`;
    const isStatusCat = ["neuro", "access", "games"].includes(q.cat);

    app.innerHTML = `
      ${crumbs([["Главная", "#/"], [c.title, `#/c/${c.id}`], ["Вопрос"]])}
      <div class="layout">
        <article class="article">
          <h1>${esc(q.title)}</h1>
          <div class="meta">${tags(q)}<a href="#/c/${c.id}">${esc(c.title)}</a><span>${readTime(q)} мин чтения</span></div>
          <div class="lede"><b>Коротко</b>${esc(q.short)}</div>
          <div class="content">${q.answer}</div>
          ${wType ? widgetHTML(wType) : ""}
          <div class="actions">
            <span class="actions__label" id="voteLabel">Ответ помог?</span>
            <button type="button" class="btn" data-vote="up" aria-pressed="${vote === "up"}" aria-describedby="voteLabel">Да</button>
            <button type="button" class="btn" data-vote="down" aria-pressed="${vote === "down"}" aria-describedby="voteLabel">Нет</button>
            <div class="actions__right">
              <button type="button" class="btn" id="saveBtn" aria-pressed="${saved}">${saved ? "В сохранённом" : "Сохранить"}</button>
              <button type="button" class="btn" id="cardBtn">Карточка для сторис</button>
              <button type="button" class="btn" id="shareBtn">Скопировать ссылку</button>
            </div>
          </div>
          <div class="cta-strip">
            <div class="cta-strip__text">
              <b>Открыть эту шпаргалку в Telegram</b>
              <span>${isStatusCat
                ? "Бот пришлёт короткую карточку именно этого вопроса, а по команде /status покажет актуальный статус сервисов на сегодня."
                : "Чтобы не потерять ответ под рукой и получать обновления по теме."}</span>
            </div>
            <div class="cta-strip__btns">
              <a class="btn btn--primary" href="${deepLink}" target="_blank" rel="noopener noreferrer">Открыть в боте</a>
              ${isStatusCat
                ? `<a class="btn" href="https://t.me/${SITE_CONFIG.telegramBotHandle}?start=status" target="_blank" rel="noopener noreferrer">Статус (/status)</a>`
                : `<button type="button" class="btn" id="articleSuggestBtn">Предложить вопрос</button>`}
            </div>
          </div>
        </article>
        <aside class="sidebar" aria-label="Другие вопросы">
          ${related.length ? `<section class="side"><h2>Ещё в разделе «${esc(c.title)}»</h2><ul>${related.map((r) => `<li><a href="#/q/${r.id}">${esc(r.title)}</a></li>`).join("")}</ul></section>` : ""}
          <section class="side"><h2>Горячее в других темах</h2><ul>${hot.map((r) => `<li><a href="#/q/${r.id}">${esc(r.title)}</a></li>`).join("")}</ul></section>
        </aside>
      </div>`;

    enhanceCodeBlocks(app);
    initWidgets(app);

    app.querySelectorAll("[data-vote]").forEach((b) =>
      b.addEventListener("click", () => {
        try { localStorage.setItem("vote:" + q.id, b.dataset.vote); } catch { }
        app.querySelectorAll("[data-vote]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      })
    );
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.addEventListener("click", () => {
      const now = toggleSaved(q.id);
      saveBtn.setAttribute("aria-pressed", String(now));
      saveBtn.textContent = now ? "В сохранённом" : "Сохранить";
    });
    const cardBtn = document.getElementById("cardBtn");
    cardBtn.addEventListener("click", () => {
      exportStoryCard(q, c);
      cardBtn.textContent = "Карточка скачана";
      setTimeout(() => (cardBtn.textContent = "Карточка для сторис"), 1800);
    });
    const share = document.getElementById("shareBtn");
    share.addEventListener("click", () => {
      navigator.clipboard?.writeText(location.href);
      share.textContent = "Ссылка скопирована";
      setTimeout(() => (share.textContent = "Скопировать ссылку"), 1800);
    });
    document.getElementById("articleSuggestBtn")?.addEventListener("click", () => openSuggestModal(c.title));
  }

  function renderSearch(query) {
    document.title = `Поиск: ${query} — ${SITE_CONFIG.siteName}`;
    const { items, corrected } = smartSearch(query);
    const activeQuery = corrected || query;
    app.innerHTML = `
      ${crumbs([["Главная", "#/"], ["Поиск"]])}
      <header class="pagehead">
        <h1>«${esc(query)}»</h1>
        <p>Найдено: ${items.length}</p>
      </header>
      ${corrected ? `<p class="search-hint">Показаны результаты для исправленной раскладки: <b>«${esc(corrected)}»</b></p>` : ""}
      <div id="searchList"></div>`;
    const box = document.getElementById("searchList");
    if (items.length) renderPaginatedList(box, items, { query: activeQuery, showShort: true }, 30);
    else box.innerHTML = '<div class="empty"><strong>Ничего не нашли</strong>Попробуйте другие слова, загляните в <a href="#/categories">список тем</a> или предложите нам этот вопрос.</div>';
  }

  function renderAbout() {
    document.title = `О сайте и правила — ${SITE_CONFIG.siteName}`;
    app.innerHTML = `
      ${crumbs([["Главная", "#/"], ["О сайте и правила"]])}
      <article class="article">
        <h1>О сайте и правила использования</h1>
        <div class="content" style="margin-top:24px">
          <h2>Зачем этот сайт</h2>
          <p><b>${SITE_CONFIG.siteName}</b> — независимая справочная база ответов на популярные вопросы из коротких видео и поиска: смартфоны и безопасность, ЖКХ и Госуслуги, аренда жилья, путешествия, медицина по ОМС, электроника, приложения и нейросети.</p>
          <h2>Справочный характер материалов</h2>
          <p>Все тексты, калькуляторы и чек-листы носят исключительно информационно-справочный характер и не являются официальной юридической, финансовой, налоговой или медицинской консультацией. Законы, тарифы, правила банков и доступность сервисов меняются — всегда перепроверяйте актуальные условия на официальных сайтах и при необходимости обращайтесь к профильному специалисту.</p>
          <h2>Конфиденциальность и данные</h2>
          <p>Сайт работает без регистрации, не использует сторонние рекламные трекеры и не собирает персональные данные на сервере. Выбранная тема оформления, закладки («Сохранённое»), отметки в чек-листах и черновики предложений хранятся только локально в вашем браузере (<code>localStorage</code>) — вы можете очистить их в любой момент.</p>
          <p>Переход в Telegram-канал или Telegram-бот происходит добровольно по вашей инициативе и регулируется политикой конфиденциальности Telegram. Пожалуйста, не отправляйте в бота паспортные данные, номера банковских карт и пароли.</p>
          <h2>Связь и правки</h2>
          <p>Если вы заметили неточность, устаревшую информацию или хотите предложить новую тему для разбора — напишите в наш <a href="https://t.me/${SITE_CONFIG.telegramBotHandle}?start=suggest" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Telegram-бот</a> или загляните в <a href="${SITE_CONFIG.telegramChannelUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Telegram-канал</a>.</p>
        </div>
      </article>`;
  }

  function renderNotFound() {
    document.title = `Страница не найдена — ${SITE_CONFIG.siteName}`;
    app.innerHTML = `<div class="empty"><strong>Такой страницы нет</strong>Возможно, ссылка устарела. <a href="#/">Вернуться на главную</a></div>`;
  }

  /* ---------- Router ---------- */
  function setChrome(route) {
    document.body.classList.toggle("is-home", route === "home");
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === route) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  let firstRender = true;
  function router() {
    const raw = location.hash.slice(1) || "/";
    const [rawPath, qs = ""] = raw.split("?");
    const parts = decodeURIComponent(rawPath).split("/").filter(Boolean);
    window.scrollTo(0, 0);

    if (!parts.length) { setChrome("home"); renderHome(); }
    else if (parts[0] === "categories") { setChrome("categories"); renderCategories(); }
    else if (parts[0] === "tools") { setChrome("tools"); renderTools(); }
    else if (parts[0] === "saved") { setChrome("saved"); renderSaved(); }
    else if (parts[0] === "about") { setChrome(""); renderAbout(); }
    else if (parts[0] === "c" && parts[1]) { setChrome("categories"); renderCategory(parts[1]); }
    else if (parts[0] === "q" && parts[1]) { setChrome(""); renderQuestion(parts[1]); }
    else if (parts[0] === "search") {
      setChrome("");
      const query = new URLSearchParams(qs).get("q") || "";
      document.getElementById("searchInput").value = query;
      renderSearch(query);
    } else { setChrome(""); renderNotFound(); }

    if (!firstRender) app.focus({ preventScroll: true });
    firstRender = false;
  }

  document.getElementById("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("searchInput").value.trim();
    if (v) location.hash = `#/search?q=${encodeURIComponent(v)}`;
  });

  window.addEventListener("hashchange", router);
  router();
})();
