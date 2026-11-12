const TOKEN_KEY = "nur_grab_token";
const DEFAULT_PIN = "384750";

function safeGet() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function safeSet(v) {
  try {
    localStorage.setItem(TOKEN_KEY, v);
  } catch {
    /* private mode */
  }
  try {
    sessionStorage.setItem(TOKEN_KEY, v);
  } catch {
    /* ignore */
  }
}

function getToken() {
  const boot = window.__NUR_TOKEN__ ? String(window.__NUR_TOKEN__).trim() : "";
  const q = new URLSearchParams(location.search);
  const fromUrl = String(q.get("token") || q.get("pin") || "").trim();
  const raw = boot || fromUrl || safeGet().trim();
  if (raw) safeSet(raw);
  return raw;
}

function apiUrl(path) {
  let root = location.pathname || "/";
  if (root.endsWith("index.html")) root = root.slice(0, -"index.html".length);
  root = root.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : "/" + path;
  return `${location.origin}${root}/api${p}`;
}

let token = getToken();
let lastKind = "movie";
let seriesMode = "auto";
let lastPreview = [];
let selectedIndex = 0;

const logEl = document.getElementById("log");
const badge = document.getElementById("badge");
const authGate = document.getElementById("authGate");
const authError = document.getElementById("authError");
const results = document.getElementById("results");
const resultsWrap = document.getElementById("resultsWrap");
const posterCard = document.getElementById("posterCard");
const posterImg = document.getElementById("posterImg");
const posterEmpty = document.getElementById("posterEmpty");
const posterTitle = document.getElementById("posterTitle");
const posterSub = document.getElementById("posterSub");
const posterOverview = document.getElementById("posterOverview");
const confirmBar = document.getElementById("confirmBar");
const confirmLabel = document.getElementById("confirmLabel");
const confirmPoster = document.getElementById("confirmPoster");
const torrentList = document.getElementById("torrentList");
const meta = document.getElementById("meta");
const tokenInput = document.getElementById("tokenInput");
const seriesModesEl = document.getElementById("seriesModes");
const browseTabs = document.getElementById("browseTabs");
const btnConfirmReco = document.getElementById("btnConfirmReco");

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.textContent = `${line}\n${logEl.textContent}`.slice(0, 6000);
}

function fmtSize(n) {
  const x = Number(n) || 0;
  if (x > 1e9) return (x / 1e9).toFixed(1) + " Go";
  if (x > 1e6) return (x / 1e6).toFixed(0) + " Mo";
  return (x / 1e3).toFixed(0) + " Ko";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function api(path, opts = {}) {
  const headers = Object.assign(
    { Accept: "application/json" },
    opts.headers || {}
  );
  if (token) {
    headers["X-Nur-Token"] = token;
    headers["Authorization"] = "Bearer " + token;
  }
  if (opts.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  let url = apiUrl(path);
  if (token) {
    const u = new URL(url);
    u.searchParams.set("pin", token);
    url = u.toString();
  }
  let r;
  try {
    r = await fetch(url, { ...opts, headers, credentials: "same-origin" });
  } catch (e) {
    throw new Error("Réseau KO — vérifie Ultra / 4G");
  }
  const data = await r.json().catch(() => ({
    ok: false,
    error: "Réponse invalide (" + r.status + ")",
  }));
  if (r.status === 401) {
    showAuth(true, data.error || "Code incorrect");
    throw new Error(data.error || "Non autorisé");
  }
  return data;
}

function showAuth(on, errMsg) {
  authGate.hidden = !on;
  authGate.style.display = on ? "grid" : "none";
  authGate.setAttribute("aria-hidden", on ? "false" : "true");
  if (on && tokenInput && !tokenInput.value) {
    tokenInput.value = DEFAULT_PIN;
  }
  if (authError) {
    authError.textContent = errMsg || "";
    authError.hidden = !errMsg;
  }
}

function syncSeriesUi() {
  seriesModesEl.hidden = lastKind !== "tv";
  document.querySelectorAll("#seriesModes .chip").forEach((b) => {
    b.classList.toggle("on", b.getAttribute("data-mode") === seriesMode);
  });
}

function clearResults() {
  lastPreview = [];
  selectedIndex = 0;
  resultsWrap.hidden = true;
  posterCard.hidden = true;
  confirmBar.hidden = true;
  btnConfirmReco.hidden = true;
  results.innerHTML = "";
  meta.textContent = "";
}

function updatePoster(pick) {
  const label = pick.metaTitle || pick.cleanTitle || "—";
  const year = pick.metaYear || pick.cleanYear || "";
  posterTitle.textContent = label;
  const bits = [];
  if (year) bits.push(year);
  bits.push(lastKind === "tv" ? "Série" : "Film");
  if (pick.qualityLabel) bits.push(pick.qualityLabel);
  posterSub.textContent = bits.join(" · ");
  posterOverview.textContent = pick.overview || "";
  posterCard.hidden = false;
  if (pick.poster) {
    posterImg.src = pick.poster;
    posterImg.alt = label;
    posterImg.hidden = false;
    posterEmpty.hidden = true;
    confirmPoster.src = pick.poster;
    confirmPoster.hidden = false;
  } else {
    posterImg.removeAttribute("src");
    posterImg.hidden = true;
    posterEmpty.hidden = false;
    confirmPoster.hidden = true;
  }
}

function renderResults() {
  if (!lastPreview.length) {
    clearResults();
    return;
  }
  resultsWrap.hidden = false;
  confirmBar.hidden = false;
  const recoCount = lastPreview.filter((p) => p.reco).length;
  btnConfirmReco.hidden = !(lastKind === "tv" && recoCount > 1);

  results.innerHTML = lastPreview
    .map((p, i) => {
      const sel = i === selectedIndex ? " selected" : "";
      const thumb = p.poster
        ? `<img class="rthumb" src="${escapeHtml(p.poster)}" alt="" loading="lazy" />`
        : `<span class="rthumb placeholder">—</span>`;
      const badges = [];
      if (p.reco) badges.push(`<span class="tag reco">RECO</span>`);
      if (p.freeleech) badges.push(`<span class="tag fl">FL</span>`);
      if (p.qualityLabel)
        badges.push(
          `<span class="tag q">${escapeHtml(p.qualityLabel)}</span>`
        );
      if (p.season != null)
        badges.push(`<span class="tag">S${String(p.season).padStart(2, "0")}</span>`);
      const stats = [
        fmtSize(p.size),
        `${p.seeders || 0} seeds`,
        p.grabs ? `${p.grabs} dl` : null,
        p.score != null ? `★${p.score}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
      <button type="button" class="result-row${sel}" data-i="${i}">
        <span class="rk">#${i + 1}</span>
        ${thumb}
        <span class="rbody">
          <div class="rtags">${badges.join("")}</div>
          <div class="rt">${escapeHtml(p.title)}</div>
          <div class="rm">${escapeHtml(
            p.metaTitle
              ? p.metaTitle + (p.metaYear ? " (" + p.metaYear + ")" : "")
              : ""
          )}${p.metaTitle ? " · " : ""}${stats}</div>
        </span>
      </button>`;
    })
    .join("");
  results.querySelectorAll(".result-row").forEach((btn) => {
    btn.onclick = () => {
      selectedIndex = Number(btn.getAttribute("data-i"));
      renderResults();
      btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
  });
  const pick = lastPreview[selectedIndex];
  updatePoster(pick);
  const via = lastKind === "tv" ? "qBit" : "TX";
  confirmLabel.textContent = pick.reco
    ? `Reco → ${via} · ${pick.qualityLabel || ""} · ${
        pick.metaTitle || pick.cleanTitle || pick.title
      }`
    : `#${selectedIndex + 1} → ${via} · ${
        pick.metaTitle || pick.cleanTitle || pick.title
      }`;
}

async function refreshStatus() {
  const s = await api("/status");
  const parts = [];
  if (s.qbit?.ok) parts.push(`qBit ${s.qbit.torrents}`);
  else parts.push("qBit KO");
  if (s.transmission?.ok) parts.push(`TX ${s.transmission.torrents}`);
  else parts.push("TX KO");
  if (s.c411?.ok) parts.push("C411");
  else parts.push("C411 ?");
  badge.textContent = parts.join(" · ");
  badge.className =
    s.qbit?.ok && s.transmission?.ok && s.c411?.ok ? "sub ok" : "sub bad";
}

async function refreshList() {
  const r = await api("/list");
  if (!r.ok) {
    torrentList.innerHTML = `<div class="item"><div class="name">${escapeHtml(r.error)}</div></div>`;
    return;
  }
  if (!r.torrents?.length) {
    torrentList.innerHTML = `<div class="item"><div class="name">Aucun torrent</div></div>`;
    return;
  }
  torrentList.innerHTML = r.torrents
    .slice(0, 20)
    .map(
      (t) => `
    <div class="item">
      <div class="name">[${escapeHtml(t.client)}] ${escapeHtml(t.name)}</div>
      <div class="pct">${t.progress}%</div>
      <div class="meta">${escapeHtml(t.state)} · ${fmtSize(t.size)} · ${((t.dlspeed || 0) / 1024).toFixed(0)} KiB/s</div>
    </div>`
    )
    .join("");
}

async function loadBrowseTabs() {
  try {
    const r = await api("/sections");
    const sections = r.sections || [];
    browseTabs.innerHTML = sections
      .map(
        (s) =>
          `<button type="button" class="chip browse" data-section="${escapeHtml(
            s.id
          )}">${escapeHtml(s.label)}</button>`
      )
      .join("");
    browseTabs.querySelectorAll(".browse").forEach((btn) => {
      btn.onclick = () => runBrowse(btn.getAttribute("data-section"));
    });
  } catch (e) {
    browseTabs.innerHTML = `<span class="hint">${escapeHtml(e.message || e)}</span>`;
  }
}

async function runBrowse(section) {
  log(`C411 · ${section}…`);
  clearResults();
  const r = await api(`/browse?section=${encodeURIComponent(section)}&limit=40`);
  if (!r.ok) return log("Échec: " + r.error);
  lastKind = r.kind === "tv" ? "tv" : "movie";
  document.querySelectorAll(".kind").forEach((b) => {
    b.classList.toggle("on", b.getAttribute("data-kind") === lastKind);
  });
  syncSeriesUi();
  lastPreview = r.preview || [];
  selectedIndex = 0;
  meta.textContent = `${r.label} · ${r.totalFr || 0} FR · ${lastPreview.length} affichés`;
  renderResults();
  log(`${lastPreview.length} sorties — reco en #1 si FR`);
}

async function runSearch() {
  const query = document.getElementById("query").value.trim();
  if (!query) return log("Titre manquant");
  log(`Recherche: ${query}…`);
  clearResults();
  const body = {
    query,
    kind: lastKind,
    autoAdd: false,
    seriesMode: lastKind === "tv" ? seriesMode : "list",
  };
  const r = await api("/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!r.ok) return log("Échec: " + r.error);
  lastPreview = r.preview || [];
  selectedIndex = Math.max(
    0,
    lastPreview.findIndex((p) => p.reco)
  );
  if (selectedIndex < 0) selectedIndex = 0;
  const plan = r.seriesPlan
    ? ` · plan ${r.seriesPlan.mode} (${r.seriesPlan.pickCount})`
    : "";
  meta.textContent = `${r.totalFr || lastPreview.length} FR · ${
    r.recoReason || "Reco auto"
  }${plan}`;
  renderResults();
  log(`${lastPreview.length} résultats — ${r.recoReason || "OK"}`);
}

async function confirmDownload() {
  const pick = lastPreview[selectedIndex];
  if (!pick) return;
  const via = lastKind === "tv" ? "qBittorrent" : "Transmission";
  const film = pick.metaTitle || pick.cleanTitle || pick.title;
  if (
    !window.confirm(
      `DL sur ${via} ?\n\n${film}\n${pick.qualityLabel || ""} · ${fmtSize(
        pick.size
      )}\n${pick.title}`
    )
  ) {
    log("Annulé");
    return;
  }
  log(`Confirmé → ${via}`);
  const r = await api("/confirm", {
    method: "POST",
    body: JSON.stringify({ kind: lastKind, pick }),
  });
  if (!r.ok) return log("Échec: " + r.error);
  log(`OK [${r.client}] → ${r.savePath}`);
  clearResults();
  await refreshList();
  await refreshStatus();
}

async function confirmAllReco() {
  const picks = lastPreview.filter((p) => p.reco);
  if (!picks.length) return;
  if (
    !window.confirm(
      `Télécharger ${picks.length} release(s) reco (saisons / intégrale) ?`
    )
  ) {
    log("Annulé");
    return;
  }
  log(`DL ${picks.length} recos…`);
  const r = await api("/confirm-many", {
    method: "POST",
    body: JSON.stringify({ kind: lastKind, picks }),
  });
  if (!r.ok) return log("Échec: " + (r.error || "partiel"));
  log(`OK ${r.addedCount}/${r.total} ajoutés`);
  clearResults();
  await refreshList();
  await refreshStatus();
}

document.querySelectorAll(".kind").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".kind").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    lastKind = btn.getAttribute("data-kind");
    syncSeriesUi();
  };
});

document.querySelectorAll("#seriesModes .chip").forEach((btn) => {
  btn.onclick = () => {
    seriesMode = btn.getAttribute("data-mode");
    syncSeriesUi();
  };
});

document.getElementById("btnSearch").onclick = () => runSearch();
document.getElementById("btnConfirm").onclick = () => confirmDownload();
btnConfirmReco.onclick = () => confirmAllReco();
document.getElementById("btnCancel").onclick = () => {
  clearResults();
  log("Sélection effacée");
};
document.getElementById("btnRefresh").onclick = async () => {
  await refreshStatus();
  await refreshList();
};
document.getElementById("query").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

async function unlockWithCode(raw) {
  const v = String(raw || "").trim();
  if (!v) {
    showAuth(true, "Entre le PIN " + DEFAULT_PIN);
    return false;
  }
  token = v;
  safeSet(v);
  if (location.pathname === "/grab") {
    const u = new URL(location.href);
    u.pathname = "/grab/";
    u.searchParams.set("pin", v);
    location.replace(u.toString());
    return true;
  }
  try {
    showAuth(true, "Vérification…");
    await api("/status");
    showAuth(false);
    log("Connecté");
    await refreshStatus();
    await refreshList();
    await loadBrowseTabs();
    return true;
  } catch (e) {
    showAuth(true, "Refusé — PIN = " + DEFAULT_PIN + " (pas le mdp Ultra)");
    return false;
  }
}

document.getElementById("btnSaveToken").onclick = () =>
  unlockWithCode(tokenInput.value);

tokenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlockWithCode(tokenInput.value);
});

async function boot() {
  if (location.pathname === "/grab") {
    const u = new URL(location.href);
    u.pathname = "/grab/";
    location.replace(u.toString());
    return;
  }

  if (!token) {
    showAuth(true);
    tokenInput.value = DEFAULT_PIN;
    return;
  }

  showAuth(false);
  syncSeriesUi();
  try {
    log("Mobile → Ultra");
    await refreshStatus();
    await refreshList();
    await loadBrowseTabs();
  } catch (e) {
    log(String(e.message || e));
    showAuth(true, String(e.message || e));
    tokenInput.value = DEFAULT_PIN;
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
  try {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }
}

boot();
