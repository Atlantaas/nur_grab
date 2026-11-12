const logEl = document.getElementById("log");
const badge = document.getElementById("statusBadge");
const listEl = document.getElementById("torrentList");
const ftpListEl = document.getElementById("ftpList");
const ftpPathEl = document.getElementById("ftpPath");
const c411Hint = document.getElementById("c411Hint");
const resultsList = document.getElementById("resultsList");
const resultsMeta = document.getElementById("resultsMeta");
const resultsLayout = document.getElementById("resultsLayout");
const confirmBar = document.getElementById("confirmBar");
const confirmLabel = document.getElementById("confirmLabel");
const confirmPoster = document.getElementById("confirmPoster");
const posterImg = document.getElementById("posterImg");
const posterEmpty = document.getElementById("posterEmpty");
const posterTitle = document.getElementById("posterTitle");
const posterSub = document.getElementById("posterSub");
const posterOverview = document.getElementById("posterOverview");
const seriesModesEl = document.getElementById("seriesModes");
const browseTabs = document.getElementById("browseTabs");
const btnConfirmReco = document.getElementById("btnConfirmReco");
const kindSelect = document.getElementById("kind");

let lastPreview = [];
let selectedIndex = 0;
let lastKind = "movie";
let seriesMode = "auto";

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.textContent = `${line}\n${logEl.textContent}`.slice(0, 8000);
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

function syncSeriesUi() {
  seriesModesEl.hidden = lastKind !== "tv";
  seriesModesEl.querySelectorAll(".chip").forEach((b) => {
    b.classList.toggle("on", b.getAttribute("data-mode") === seriesMode);
  });
}

function clearResults() {
  lastPreview = [];
  selectedIndex = 0;
  resultsLayout.hidden = true;
  resultsMeta.hidden = true;
  confirmBar.hidden = true;
  btnConfirmReco.hidden = true;
  resultsList.innerHTML = "";
  posterImg.hidden = true;
  posterEmpty.hidden = false;
  confirmPoster.hidden = true;
}

function updatePosterPanel(pick) {
  const label = pick.metaTitle || pick.cleanTitle || "—";
  const year = pick.metaYear || pick.cleanYear || "";
  posterTitle.textContent = label;
  const bits = [];
  if (year) bits.push(year);
  bits.push(lastKind === "tv" ? "Série" : "Film");
  if (pick.qualityLabel) bits.push(pick.qualityLabel);
  posterSub.textContent = bits.join(" · ");
  posterOverview.textContent = pick.overview || "";
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
  resultsLayout.hidden = false;
  confirmBar.hidden = false;
  const recoCount = lastPreview.filter((p) => p.reco).length;
  btnConfirmReco.hidden = !(lastKind === "tv" && recoCount > 1);

  resultsList.innerHTML = lastPreview
    .map((p, i) => {
      const sel = i === selectedIndex ? " selected" : "";
      const thumb = p.poster
        ? `<img class="rthumb" src="${escapeHtml(p.poster)}" alt="" loading="lazy" />`
        : `<span class="rthumb placeholder">—</span>`;
      const badges = [];
      if (p.reco) badges.push(`<span class="tag reco">RECO</span>`);
      if (p.freeleech) badges.push(`<span class="tag fl">FL</span>`);
      if (p.qualityLabel)
        badges.push(`<span class="tag q">${escapeHtml(p.qualityLabel)}</span>`);
      if (p.season != null)
        badges.push(
          `<span class="tag">S${String(p.season).padStart(2, "0")}</span>`
        );
      const stats = [
        fmtSize(p.size),
        `${p.seeders || 0} seeds`,
        p.grabs ? `${p.grabs} dl` : null,
        `★${p.score}`,
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
          <div class="rm">${
            p.metaTitle
              ? escapeHtml(p.metaTitle) +
                (p.metaYear ? " (" + p.metaYear + ")" : "") +
                " · "
              : ""
          }${stats}</div>
        </span>
      </button>`;
    })
    .join("");
  resultsList.querySelectorAll(".result-row").forEach((btn) => {
    btn.onclick = () => {
      selectedIndex = Number(btn.getAttribute("data-i"));
      renderResults();
    };
  });
  const pick = lastPreview[selectedIndex];
  updatePosterPanel(pick);
  confirmLabel.textContent = `Choix #${selectedIndex + 1}${
    pick.reco ? " RECO" : ""
  } → ${lastKind === "tv" ? "qBit" : "Transmission"} : ${
    pick.metaTitle || pick.cleanTitle || pick.title
  } · ${pick.qualityLabel || ""} · ${fmtSize(pick.size)}`;
}

async function refreshStatus() {
  const s = await window.grab.status();
  const q = s.qbit;
  const t = s.transmission;
  const f = s.ftp;
  const parts = [];
  if (q?.ok) parts.push(`qBit ${q.torrents}`);
  else parts.push("qBit KO");
  if (t?.ok) parts.push(`TX ${t.torrents}`);
  else parts.push("TX KO");
  if (f?.ok) parts.push("FTPS");
  else parts.push("FTPS KO");
  if (s.c411?.ok) parts.push("C411");
  else parts.push("C411 ?");
  badge.textContent = parts.join(" · ");
  badge.className =
    q?.ok && t?.ok && f?.ok && s.c411?.ok ? "badge ok" : "badge bad";
  c411Hint.textContent = s.c411?.ok
    ? "Cherche ou explore C411 → RECO pré-sélectionnée → Confirmer."
    : "Clé C411 manquante dans config.json";
}

async function refreshList() {
  const r = await window.grab.list();
  if (!r.ok) {
    listEl.innerHTML = `<div class="item"><span class="name">${escapeHtml(r.error)}</span></div>`;
    return;
  }
  if (!r.torrents.length) {
    listEl.innerHTML = `<div class="item"><span class="name">Aucun torrent</span></div>`;
    return;
  }
  listEl.innerHTML = r.torrents
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

async function refreshFtp(remotePath) {
  ftpPathEl.textContent = `FTPS ${remotePath}`;
  ftpListEl.innerHTML = `<div class="item"><span class="name">…</span></div>`;
  const r = await window.grab.ftpList({ path: remotePath });
  if (!r.ok) {
    ftpListEl.innerHTML = `<div class="item"><span class="name">${escapeHtml(r.error)}</span></div>`;
    return;
  }
  if (!r.items?.length) {
    ftpListEl.innerHTML = `<div class="item"><span class="name">(vide)</span></div>`;
    return;
  }
  ftpListEl.innerHTML = r.items
    .slice(0, 60)
    .map((it) => {
      const label = it.dir ? `📁 ${it.name}` : `📄 ${it.name}`;
      if (it.dir) {
        const next = `${r.path.replace(/\/$/, "")}/${it.name}`;
        return `<div class="item ftp-dir" data-path="${escapeHtml(next)}"><div class="name">${escapeHtml(label)}</div><div class="meta">dossier</div></div>`;
      }
      return `<div class="item"><div class="name">${escapeHtml(label)}</div><div class="meta">${fmtSize(it.size)}</div></div>`;
    })
    .join("");
  ftpListEl.querySelectorAll(".ftp-dir").forEach((el) => {
    el.style.cursor = "pointer";
    el.onclick = () => refreshFtp(el.getAttribute("data-path"));
  });
}

async function loadBrowseTabs() {
  const r = await window.grab.sections();
  const sections = r.sections || [];
  browseTabs.innerHTML = sections
    .map(
      (s) =>
        `<button type="button" class="chip" data-section="${escapeHtml(s.id)}">${escapeHtml(s.label)}</button>`
    )
    .join("");
  browseTabs.querySelectorAll("[data-section]").forEach((btn) => {
    btn.onclick = () => runBrowse(btn.getAttribute("data-section"));
  });
}

async function runBrowse(section) {
  log(`C411 browse · ${section}`);
  clearResults();
  const r = await window.grab.browse({ section, limit: 40 });
  if (!r.ok) return log("Échec: " + r.error);
  lastKind = r.kind === "tv" ? "tv" : "movie";
  kindSelect.value = lastKind;
  syncSeriesUi();
  lastPreview = r.preview || [];
  selectedIndex = 0;
  resultsMeta.hidden = false;
  resultsMeta.textContent = `${r.label} · ${r.totalFr || 0} FR · ${lastPreview.length} affichés`;
  renderResults();
}

async function runSearch() {
  const query = document.getElementById("query").value.trim();
  lastKind = kindSelect.value;
  syncSeriesUi();
  if (!query) return log("Titre manquant");
  log(`Recherche FR: ${query}…`);
  clearResults();
  const r = await window.grab.searchBest({
    query,
    kind: lastKind,
    autoAdd: false,
    seriesMode: lastKind === "tv" ? seriesMode : "list",
  });
  if (!r.ok) {
    log("Échec: " + r.error);
    return;
  }
  lastPreview = r.preview || [];
  selectedIndex = Math.max(
    0,
    lastPreview.findIndex((p) => p.reco)
  );
  if (selectedIndex < 0) selectedIndex = 0;
  resultsMeta.hidden = false;
  const plan = r.seriesPlan
    ? ` · plan ${r.seriesPlan.mode} (${r.seriesPlan.pickCount})`
    : "";
  resultsMeta.textContent = `${r.totalFr || lastPreview.length} FR · ${
    r.recoReason || "Reco auto"
  }${plan}`;
  renderResults();
  log(`Liste: ${lastPreview.length} — ${r.recoReason || "OK"}`);
}

async function confirmDownload() {
  const pick = lastPreview[selectedIndex];
  if (!pick) return log("Rien à confirmer");
  const via = lastKind === "tv" ? "qBittorrent" : "Transmission";
  const film = pick.metaTitle || pick.cleanTitle || pick.title;
  const ok = window.confirm(
    `Télécharger sur ${via} ?\n\n${film}\n${pick.qualityLabel || ""} · ${fmtSize(
      pick.size
    )}\n${pick.title}`
  );
  if (!ok) {
    log("Annulé — pas de DL");
    return;
  }
  log(`DL confirmé → ${via}: ${pick.title}`);
  const r = await window.grab.confirmAdd({ kind: lastKind, pick });
  if (!r.ok) return log("Échec: " + r.error);
  if (r.ftp?.remote) log(`Watch FTP: ${r.ftp.remote}`);
  log(`OK [${r.client}] → ${r.savePath}`);
  await refreshList();
  await refreshStatus();
}

async function confirmAllReco() {
  const picks = lastPreview.filter((p) => p.reco);
  if (!picks.length) return;
  if (!window.confirm(`DL ${picks.length} reco(s) série ?`)) {
    log("Annulé");
    return;
  }
  const r = await window.grab.confirmAddMany({ kind: lastKind, picks });
  if (!r.ok) return log("Échec: " + (r.error || "partiel"));
  log(`OK ${r.addedCount}/${r.total}`);
  await refreshList();
}

kindSelect.addEventListener("change", () => {
  lastKind = kindSelect.value;
  syncSeriesUi();
});

seriesModesEl.querySelectorAll(".chip").forEach((btn) => {
  btn.onclick = () => {
    seriesMode = btn.getAttribute("data-mode");
    syncSeriesUi();
  };
});

document.getElementById("btnBest").onclick = () => runSearch();
document.getElementById("btnConfirm").onclick = () => confirmDownload();
btnConfirmReco.onclick = () => confirmAllReco();
document.getElementById("btnCancelPick").onclick = () => {
  clearResults();
  log("Sélection effacée");
};

document.getElementById("query").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

document.getElementById("btnMagnet").onclick = async () => {
  const magnet = document.getElementById("magnet").value.trim();
  const kind = document.getElementById("magnetKind").value;
  if (!window.confirm("Envoyer ce magnet ?")) return;
  const r = await window.grab.addMagnet({ magnet, kind });
  if (!r.ok) return log("Échec: " + r.error);
  log(`OK [${r.client}] → ${r.savePath}`);
  document.getElementById("magnet").value = "";
  await refreshList();
};

document.getElementById("btnTorrent").onclick = async () => {
  const kind = document.getElementById("magnetKind").value;
  const r = await window.grab.addTorrentFile({ kind });
  if (!r.ok) return log(r.error || "annulé");
  log(`OK [${r.client}] → ${r.savePath}`);
  await refreshList();
};

document.getElementById("btnRefresh").onclick = async () => {
  await refreshList();
  await refreshStatus();
};

document.getElementById("btnFtpMovies").onclick = () =>
  refreshFtp("/media/Movies");
document.getElementById("btnFtpTv").onclick = () =>
  refreshFtp("/media/TV Shows");
document.getElementById("btnFtpWatch").onclick = () => refreshFtp("/watch");

(async () => {
  log("Nur Grab · API C411 · reco qualité/poids");
  syncSeriesUi();
  await refreshStatus();
  await refreshList();
  await loadBrowseTabs();
})();
