// Studio front-end. Plain JavaScript, no build step.

const STATUS = {
  fetching: { label: "Ophalen…", cls: "s-busy" },
  needs_upload: { label: "Wacht op upload", cls: "s-wait" },
  needs_source: { label: "Bron aanvullen", cls: "s-wait" },
  ready: { label: "Klaar voor analyse", cls: "s-ok" },
};
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
    const st = STATUS[job.status] ?? { label: job.status, cls: "" };
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

  const st = STATUS[job.status] ?? { label: job.status, cls: "" };
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
    next.innerHTML = '<div class="notice ok">✅ Video en bron zijn compleet. De analyse (stap 2) bouwen we hierna.</div>';
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

  if (job.status === "fetching") {
    pollTimer = setTimeout(async () => {
      if (currentId !== job.id) return;
      try {
        const fresh = await api("/api/jobs/" + encodeURIComponent(job.id));
        renderJob(fresh, false);
        if (fresh.status !== "fetching") refreshList();
      } catch {
        /* try again on next open */
      }
    }, 1500);
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

  $('[data-action="retry"]', root).addEventListener("click", async () => {
    await api(`/api/jobs/${enc}/retry-download`, { method: "POST" });
    const job = await api(`/api/jobs/${enc}`);
    renderJob({ ...job, status: "fetching", error: null }, false);
  });
}

refreshList();
if (currentId) openJob(currentId).catch(() => (currentId = null));
