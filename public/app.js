import { renderCoverage, renderFactcheck, start as startFactcheck } from "./factcheck.js";

// Studio front-end. Plain JavaScript, no build step.

const STATUS = {
  fetching: { label: "Ophalen…", cls: "s-busy" },
  needs_upload: { label: "Wacht op upload", cls: "s-wait" },
  needs_source: { label: "Bron aanvullen", cls: "s-wait" },
  ready: { label: "Klaar voor analyse", cls: "s-ok" },
};
/** Status label, taking the analysis state into account. */
function statusOf(job) {
  if (job.status === "ready") {
    const a = job.analysis?.state;
    if (a === "running") return { label: "Analyse loopt…", cls: "s-busy" };
    if (a === "done") return { label: "Analyse klaar", cls: "s-ok" };
    if (a === "failed") return { label: "Analyse mislukt", cls: "s-bad" };
  }
  return STATUS[job.status] ?? { label: job.status, cls: "" };
}
const PLATFORMS = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X", other: "Anders" };

const $ = (sel, root = document) => root.querySelector(sel);
let currentId = new URLSearchParams(location.hash.slice(1)).get("job");
let pollTimer = null;

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fout ${res.status}`);
  return data;
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
}

// ---------- job list ----------
async function refreshList() {
  const jobs = await api("/api/jobs");
  const ul = $("#job-list");
  ul.replaceChildren();
  if (!jobs.length) {
    ul.innerHTML = '<li class="muted">Nog geen jobs.</li>';
    return;
  }
  for (const job of jobs) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "job-item" + (job.id === currentId ? " active" : "");
    const st = statusOf(job);
    btn.innerHTML = `<span class="job-name"></span><span class="dot ${st.cls}" title="${st.label}"></span>`;
    $(".job-name", btn).textContent = job.id;
    btn.addEventListener("click", () => openJob(job.id));
    li.append(btn);
    ul.append(li);
  }
}

// ---------- new job ----------
$("#new-job").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#new-job-error");
  err.hidden = true;
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const job = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: $("#url").value.trim(), skipDownload: $("#skip-download").checked }),
    });
    $("#url").value = "";
    await openJob(job.id);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---------- job detail ----------
async function openJob(id) {
  currentId = id;
  history.replaceState(null, "", "#job=" + encodeURIComponent(id));
  clearTimeout(pollTimer);
  const job = await api("/api/jobs/" + encodeURIComponent(id));
  renderJob(job, true);
  refreshList();
}

function renderJob(job, full) {
  const detail = $("#detail");
  let root = $(".job-view", detail);
  if (full || !root || root.dataset.id !== job.id) {
    root = $("#job-template").content.firstElementChild.cloneNode(true);
    root.classList.add("job-view");
    root.dataset.id = job.id;
    detail.replaceChildren(root);
    wireJob(root, job.id);
    fillSourceForm(root, job);
  }

  const st = statusOf(job);
  $('[data-field="id"]', root).textContent = job.id;
  $('[data-field="created"]', root).textContent = "Aangemaakt " + fmtDateTime(job.createdAt);
  const stEl = $('[data-field="status"]', root);
  stEl.textContent = st.label;
  stEl.className = "status " + st.cls;

  const link = $('[data-field="url"]', root);
  link.href = job.source.url;
  link.textContent = job.source.url;
  $('[data-field="platform"]', root).textContent = PLATFORMS[job.source.platform] ?? job.source.platform;

  $('[data-part="fetching"]', root).hidden = job.status !== "fetching";
  const errEl = $('[data-part="error"]', root);
  errEl.hidden = !job.error;
  errEl.textContent = job.error ?? "";
  $('[data-part="upload"]', root).hidden = !(job.status === "needs_upload" || (job.video && root.dataset.replace));

  // Video preview (only re-create when the file changes)
  const box = $('[data-part="video-box"]', root);
  const videoKey = job.video ? job.video.file + job.updatedAt : "";
  if (job.video && box.dataset.key !== job.video.file + (job.source.retrievedAt ?? "")) {
    box.dataset.key = job.video.file + (job.source.retrievedAt ?? "");
    const v = document.createElement("video");
    v.controls = true;
    v.preload = "metadata";
    v.src = `/api/jobs/${encodeURIComponent(job.id)}/video?v=${encodeURIComponent(videoKey)}`;
    const replace = document.createElement("button");
    replace.type = "button";
    replace.className = "link-btn";
    replace.textContent = "Ander bestand uploaden";
    replace.addEventListener("click", () => {
      root.dataset.replace = "1";
      $('[data-part="upload"]', root).hidden = false;
    });
    box.replaceChildren(v, replace);
  }
  $('[data-field="video-meta"]', root).textContent = job.video
    ? `${job.video.durationSec} sec · ${job.video.width}×${job.video.height}${job.video.hasAudio ? "" : " · geen geluid"} · ${job.source.retrievedVia === "upload" ? "geüpload" : "opgehaald met yt-dlp"}`
    : "";

  // Fill source fields that were empty in the form but now arrived from yt-dlp.
  if (!full) fillSourceForm(root, job, true);

  const next = $('[data-part="next"]', root);
  if (job.status === "ready") {
    next.innerHTML = '<div class="notice ok">✅ Video en bron zijn compleet.</div>';
  } else if (job.status === "needs_source") {
    next.innerHTML = "";
    const n = document.createElement("div");
    n.className = "notice warn";
    n.textContent = "Nog nodig voor de bronvermelding: " + job.missingSource.join(", ") + ".";
    next.append(n);
  } else {
    next.innerHTML = "";
  }

  const log = $('[data-field="log"]', root);
  log.replaceChildren(
    ...job.log.map((l) => {
      const li = document.createElement("li");
      const dur = l.durationMs != null ? ` (${(l.durationMs / 1000).toFixed(1)} s)` : "";
      li.textContent = `${fmtDateTime(l.at)} · ${l.step} · ${l.message}${dur}`;
      return li;
    }),
  );

  renderAnalysis(root, job);
  renderFactcheck(root, job, helpers());

  const busy = (j) => j.status === "fetching" || j.analysis?.state === "running" || j.factcheck?.state === "running";
  clearTimeout(pollTimer);
  if (busy(job)) {
    pollTimer = setTimeout(async () => {
      if (currentId !== job.id) return;
      try {
        const fresh = await api("/api/jobs/" + encodeURIComponent(job.id));
        renderJob(fresh, false);
        if (!busy(fresh)) refreshList();
      } catch {
        /* try again on next open */
      }
    }, 1500);
  }
}

// ---------- step 2: analysis ----------
const AI_CLASS = {
  "geen duidelijke aanwijzingen": "s-ok",
  "enkele aanwijzingen": "s-wait",
  "sterke aanwijzingen": "s-bad",
  "niet te beoordelen": "",
};

function fmtT(sec) {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${(sec - m * 60).toFixed(1).padStart(4, "0")}`;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

/** Clickable timestamp that jumps the preview video to that moment. */
function timeLink(root, t) {
  return el("button", {
    type: "button",
    class: "time",
    title: "Spring naar dit moment in de video",
    onclick: () => {
      const v = $(".video-box video", root);
      if (v) {
        v.currentTime = t;
        v.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
  }, fmtT(t));
}

function renderAnalysis(root, job) {
  const section = $('[data-part="analysis"]', root);
  section.hidden = job.status !== "ready";
  if (section.hidden) return;
  const a = job.analysis ?? { state: "idle" };

  $('[data-field="cost"]', root).textContent = job.totalCostUsd ? `Kosten tot nu toe: $${job.totalCostUsd.toFixed(2)}` : "";
  $('[data-part="analysis-start"]', root).hidden = a.state !== "idle";
  $('[data-part="analysis-running"]', root).hidden = a.state !== "running";
  $('[data-field="analysis-step"]', root).textContent = "Bezig: " + (a.step ?? "…");
  const err = $('[data-part="analysis-error"]', root);
  err.hidden = a.state !== "failed";
  if (a.state === "failed") {
    err.replaceChildren(
      el("span", {}, "❌ " + a.error + " "),
      el("button", { type: "button", "data-action": "analyze-again", onclick: () => doAnalyze(root, job.id) }, "Opnieuw proberen"),
    );
  }

  const box = $('[data-part="analysis-result"]', root);
  const key = a.state === "done" ? a.finishedAt : "";
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  if (a.state === "done") loadAnalysisResult(root, job, box);
}

async function loadAnalysisResult(root, job, box) {
  const enc = encodeURIComponent(job.id);
  const { analysis: an, frames, segments } = await api(`/api/jobs/${enc}/analysis`);
  if (!an) return;

  const m = an.manipulation;
  box.append(
    el("div", { class: "result-block" },
      el("h4", {}, "Samenvatting"),
      el("p", {}, an.summary),
      el("p", { class: "muted small" }, `Gesproken taal: ${an.spokenLanguage} · ${frames.length} beelden bekeken`),
    ),
    el("div", { class: "result-block" },
      el("h4", {}, "AI-gegenereerd of bewerkt? ", el("span", { class: "muted small" }, "(inschatting, nooit zeker)")),
      el("p", {}, el("span", { class: "status " + (AI_CLASS[m.assessment] ?? "") }, m.assessment), " ", m.explanation),
      m.signals.length ? el("ul", {}, m.signals.map((s) => el("li", {}, timeLink(root, s.t), " ", s.observation, el("span", { class: "muted" }, ` (${s.whyItMatters})`)))) : null,
    ),
  );

  if (an.speakers.length) {
    box.append(el("div", { class: "result-block" }, el("h4", {}, "Sprekers"),
      el("ul", {}, an.speakers.map((p) => el("li", {}, el("strong", {}, p.label + ": "), p.description)))));
  }

  box.append(el("div", { class: "result-block" }, el("h4", {}, "Scènes"),
    el("ul", { class: "timeline" }, an.scenes.map((s) => el("li", {}, timeLink(root, s.start), " ", s.description)))));

  box.append(el("div", { class: "result-block" }, el("h4", {}, "Tekst in beeld"),
    an.onScreenText.length
      ? el("ul", { class: "timeline" }, an.onScreenText.map((t) => el("li", {}, timeLink(root, t.t), " ", el("span", { class: "tag" }, t.kind), " “", t.text, "”")))
      : el("p", { class: "muted" }, "Geen tekst in beeld gevonden.")));

  box.append(el("details", { class: "result-block", open: "" },
    el("summary", {}, `Transcript (${segments.length} stukken)`),
    segments.length
      ? el("ul", { class: "timeline transcript" }, segments.map((s) => el("li", {}, timeLink(root, s.start), s.speaker ? el("span", { class: "muted small" }, ` ${s.speaker} `) : " ", s.text)))
      : el("p", { class: "muted" }, "Geen gesproken tekst.")));

  box.append(el("details", { class: "result-block" },
    el("summary", {}, `Beelden (${frames.length})`),
    el("div", { class: "frames" }, frames.map((f) =>
      el("figure", { onclick: () => $(".video-box video", root) && ($(".video-box video", root).currentTime = f.t) },
        el("img", { src: `/api/jobs/${enc}/${f.file}`, loading: "lazy", alt: `Beeld op ${fmtT(f.t)}` }),
        el("figcaption", {}, fmtT(f.t) + (f.reason === "scene" ? " · wissel" : "")))))));

  if (an.notes.length) {
    box.append(el("div", { class: "result-block" }, el("h4", {}, "Opmerkingen voor de factchecker"),
      el("ul", {}, an.notes.map((n) => el("li", {}, n)))));
  }

  if (job.costs?.length) {
    box.append(el("details", { class: "result-block" }, el("summary", {}, `Kosten ($${job.totalCostUsd.toFixed(2)})`),
      el("ul", { class: "small" }, job.costs.map((c) => el("li", {}, `${c.step} · ${c.service} · ${c.detail} · $${c.usd.toFixed(3)}`)))));
  }

  box.append(el("p", { class: "muted small" },
    "Alles staat ook in de job-map: analysis.md, transcript.txt en frames/. ",
    el("button", { type: "button", class: "link-btn", onclick: () => confirm("Analyse opnieuw doen? Dit kost opnieuw geld.") && doAnalyze(root, job.id) }, "Opnieuw analyseren")));
}

async function doAnalyze(root, id) {
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(id)}/analyze`, { method: "POST" });
    renderJob(job, false);
  } catch (ex) {
    alert(ex.message);
  }
}

function fillSourceForm(root, job, onlyEmpty = false) {
  const form = $('[data-form="source"]', root);
  for (const name of ["account", "accountName", "postDate", "title"]) {
    const input = form.elements[name];
    if (onlyEmpty && input.value) continue;
    if (document.activeElement === input) continue;
    input.value = job.source[name] ?? "";
  }
}

function wireJob(root, id) {
  const enc = encodeURIComponent(id);

  $('[data-form="source"]', root).addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const errEl = $('[data-part="source-error"]', root);
    errEl.hidden = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const job = await api(`/api/jobs/${enc}/source`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      fillSourceForm(root, job);
      renderJob(job, false);
      refreshList();
      const saved = $('[data-part="saved"]', root);
      saved.hidden = false;
      setTimeout(() => (saved.hidden = true), 2000);
    } catch (ex) {
      errEl.textContent = ex.message;
      errEl.hidden = false;
    }
  });

  $('[data-form="upload"]', root).addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const progress = $('[data-part="upload-progress"]', root);
    const errEl = $('[data-part="error"]', root);
    progress.hidden = false;
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const job = await api(`/api/jobs/${enc}/upload`, { method: "POST", body: new FormData(form) });
      delete root.dataset.replace;
      renderJob(job, false);
      refreshList();
    } catch (ex) {
      errEl.textContent = ex.message;
      errEl.hidden = false;
    } finally {
      progress.hidden = true;
      form.querySelectorAll("button").forEach((b) => (b.disabled = false));
      form.reset();
    }
  });

  $('[data-action="analyze"]', root).addEventListener("click", () => doAnalyze(root, id));
  $('[data-action="factcheck"]', root).addEventListener("click", () => startFactcheck(root, id, helpers()));

  $('[data-action="retry"]', root).addEventListener("click", async () => {
    await api(`/api/jobs/${enc}/retry-download`, { method: "POST" });
    const job = await api(`/api/jobs/${enc}`);
    renderJob({ ...job, status: "fetching", error: null }, false);
  });
}

function helpers() {
  return { $, el, api, timeLink, renderJob, fmtT };
}

$("#show-coverage").addEventListener("click", async () => {
  currentId = null;
  clearTimeout(pollTimer);
  history.replaceState(null, "", "#overzicht");
  await renderCoverage($("#detail"), helpers());
  refreshList();
});

refreshList();
if (currentId) openJob(currentId).catch(() => (currentId = null));
