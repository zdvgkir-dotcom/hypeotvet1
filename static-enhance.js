(() => {
  const btn = document.getElementById("themeToggle");
  const apply = (m) => {
    const d = m === "dark";
    if (d) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {}
    if (btn) btn.textContent = d ? "Бумага" : "Ночь";
  };
  apply(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  btn?.addEventListener("click", () => apply(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  document.querySelectorAll(".content pre").forEach((pre) => {
    const w = document.createElement("div"); w.className = "codeblock";
    pre.parentNode.insertBefore(w, pre); w.appendChild(pre);
    const b = document.createElement("button"); b.type = "button"; b.className = "codeblock__copy"; b.textContent = "Скопировать";
    b.addEventListener("click", () => { navigator.clipboard?.writeText(pre.innerText.trim()); b.textContent = "Скопировано"; setTimeout(() => b.textContent = "Скопировать", 1600); });
    w.appendChild(b);
  });
  const share = document.getElementById("shareBtn");
  share?.addEventListener("click", () => { navigator.clipboard?.writeText(location.href); share.textContent = "Ссылка скопирована"; setTimeout(() => share.textContent = "Скопировать ссылку", 1800); });
  document.getElementById("searchForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("searchInput").value.trim();
    if (v) location.href = (document.body.dataset.base || "/") + "#/search?q=" + encodeURIComponent(v);
  });
})();