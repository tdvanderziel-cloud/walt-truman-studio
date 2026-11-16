// Step 3-4 UI: start the fact-check, then review, edit and approve each claim.

export const VERDICTS = ["Klopt", "Mist context", "Misleidend", "Onjuist", "Nog onbekend"];
const VERDICT_EN = { Klopt: "TRUE", "Mist context": "MISSING CONTEXT", Misleidend: "MISLEADING", Onjuist: "FALSE", "Nog onbekend": "UNPROVEN" };
const VERDICT_CLASS = { Klopt: "v-true", "Mist context": "v-context", Misleidend: "v-misleading", Onjuist: "v-false", "Nog onbekend": "v-unproven" };
const LEANS = ["niet politiek", "links/progressief", "rechts/conservatief", "gemengd/anders"];
const SOURCE_TYPES = ["officiële instantie", "wetenschappelijk onderzoek", "nieuwsmedium", "factchecker", "overig"];
const STANCES = ["bevestigt", "weerspreekt", "nuanceert", "achtergrond"];

export function verdictBadge(verdict) {
  const span = document.createElement("span");
  span.className = "verdict " + (VERDICT_CLASS[verdict] ?? "");
  span.textContent = `${verdict} · ${VERDICT_EN[verdict] ?? ""}`;
  return span;
}

/** h = helpers from app.js: { $, el, api, timeLink, renderJob, fmtT } */
export function renderFactcheck(root, job, h) {
  const { $, el } = h;
  const section = $('[data-part="factcheck"]', root);
  section.hidden = job.analysis?.state !== "done";
  if (section.hidden) return;
  const f = job.factcheck ?? { state: "idle" };

  $('[data-part="fc-start"]', root).hidden = f.state !== "idle";
  $('[data-part="fc-running"]', root).hidden = f.state !== "running";
  $('[data-field="fc-step"]', root).textContent = "Bezig: " + (f.step ?? "…") + " (dit kan een paar minuten duren)";
  const err = $('[data-part="fc-error"]', root);
  err.hidden = f.state !== "failed";
  if (f.state === "failed") {
    err.replaceChildren(el("span", {}, "❌ " + f.error + " "), el("button", { type: "button", onclick: () => start(root, job.id, h) }, "Opnieuw proberen"));
  }

  const box = $('[data-part="fc-result"]', root);
  const key = f.state === "done" ? f.finishedAt : "";
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  if (f.state === "done") loadResult(root, job, box, h);
}

export async function start(root, id, h) {
  try {
    const job = await h.api(`/api/jobs/${encodeURIComponent(id)}/factcheck`, { method: "POST" });
    h.renderJob(job, false);
  } catch (ex) {
    alert(ex.message);
  }
}

async function loadResult(root, job, box, h) {
  const { el } = h;
  const enc = encodeURIComponent(job.id);
  const { factcheck: fc, readyForVideo } = await h.api(`/api/jobs/${enc}/factcheck`);
  box.replaceChildren();
  if (!fc) return;

  if (!fc.claims.length) {
    box.append(el("div", { class: "notice warn" }, "Er is geen controleerbare bewering gevonden in deze video. Dan maken we er geen factcheck-video van."));
  }
  for (const claim of fc.claims) box.append(claimCard(root, job, claim, h, () => reload()));

  if (fc.skipped.length) {
    box.append(el("details", { class: "result-block" }, el("summary", {}, `Overgeslagen uitspraken (${fc.skipped.length})`),
      el("ul", {}, fc.skipped.map((s) => el("li", {}, `“${s.quote}”: `, el("span", { class: "muted" }, s.reason))))));
  }

  box.append(readyForVideo.ok
    ? el("div", { class: "notice ok" }, "✅ Alle beweringen zijn goedgekeurd. Klaar voor het script en de video (volgende stappen).")
    : el("div", { class: "notice lock" }, "🔒 Video maken is geblokkeerd. ", readyForVideo.reason));

  box.append(el("p", { class: "muted small" }, "Ook als leesbaar bestand in de job-map: factcheck.md (en factcheck.json). ",
    el("button", { type: "button", class: "link-btn", onclick: () => confirm("Factcheck helemaal opnieuw doen? Je aanpassingen en goedkeuringen gaan verloren, en het kost opnieuw geld.") && start(root, job.id, h) }, "Opnieuw factchecken")));

  async function reload() {
    box.dataset.key = "";
    const fresh = await h.api(`/api/jobs/${enc}`);
    h.renderJob(fresh, false);
  }
}

function claimCard(root, job, c, h, reload) {
  const { el } = h;
  const enc = encodeURIComponent(job.id);
  const opt = (values, current) => values.map((v) => {
    const o = el("option", { value: v }, v);
    if (v === current) o.selected = true;
    return o;
  });

  const form = el("form", { class: "claim-form" });
  const field = (label, input, hint) => el("label", {}, label, hint ? el("span", { class: "muted small" }, " " + hint) : null, input);
  const verdictSel = el("select", { name: "verdict" }, opt(VERDICTS, c.verdict));
  const badgeSlot = el("span", {}, verdictBadge(c.verdict));
  verdictSel.addEventListener("change", () => badgeSlot.replaceChildren(verdictBadge(verdictSel.value)));
  const shortEn = el("input", { name: "claimShortEn", value: c.claimShortEn, maxlength: "80" });
  const wordCount = el("span", { class: "muted small" });
  const countWords = () => {
    const n = shortEn.value.trim().split(/\s+/).filter(Boolean).length;
    wordCount.textContent = ` ${n}/8 woorden`;
    wordCount.className = n > 8 ? "error small" : "muted small";
  };
  shortEn.addEventListener("input", countWords);
  countWords();

  const sourcesBox = el("div", { class: "sources" });
  const addSourceRow = (s) => {
    const row = el("div", { class: "source-row" },
      el("div", { class: "source-grid" },
        field("Titel", el("input", { "data-s": "title", value: s.title ?? "" })),
        field("Uitgever", el("input", { "data-s": "publisher", value: s.publisher ?? "" })),
        field("Datum", el("input", { "data-s": "date", value: s.date ?? "", placeholder: "JJJJ-MM-DD of JJJJ" })),
        field("Soort", el("select", { "data-s": "type" }, opt(SOURCE_TYPES, s.type ?? "nieuwsmedium"))),
        field("Wat zegt deze bron", el("select", { "data-s": "stance" }, opt(STANCES, s.stance ?? "achtergrond"))),
      ),
      field("Link", el("input", { "data-s": "url", value: s.url ?? "", type: "url" })),
      field("Bevinding", el("input", { "data-s": "finding", value: s.finding ?? "" })),
      el("div", { class: "row" },
        s.url ? el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", class: "small" }, "Bron openen ↗") : null,
        el("button", { type: "button", class: "link-btn small", onclick: () => row.remove() }, "Bron verwijderen")),
    );
    sourcesBox.append(row);
  };
  c.sources.forEach(addSourceRow);

  form.append(...[
    el("div", { class: "claim-head" },
      el("strong", {}, c.id.toUpperCase()), " ", h.timeLink(root, c.t), " ",
      badgeSlot, " ",
      el("span", { class: "status " + (c.approved ? "s-ok" : "s-wait") }, c.approved ? "Goedgekeurd" : "Nog nakijken"),
      el("span", { class: "muted small" }, ` · betrouwbaarheid: ${c.confidence}`)),
    el("blockquote", {}, `“${c.quote}”`),
    c.safetyNotes.length ? el("div", { class: "notice warn small" }, el("div", {}, el("strong", {}, "Automatische controles: "), el("ul", {}, c.safetyNotes.map((n) => el("li", {}, n))))) : null,
    field("Bewering (NL)", el("textarea", { name: "claimNl", rows: "2" }, c.claimNl)),
    el("label", {}, "Balk bovenin de video (EN, max 8 woorden)", wordCount, shortEn),
    el("div", { class: "grid3" },
      field("Oordeel", verdictSel),
      field("Betrouwbaarheid", el("select", { name: "confidence" }, opt(["hoog", "middel", "laag"], c.confidence))),
      field("Politieke lading", el("select", { name: "politicalLean" }, opt(LEANS, c.politicalLean))),
    ),
    field("Uitleg (gewone taal)", el("textarea", { name: "explanation", rows: "5" }, c.explanation)),
    field("Spreken bronnen elkaar tegen?", el("textarea", { name: "disagreementNote", rows: "2", placeholder: "Leeg laten als ze het eens zijn" }, c.disagreementNote ?? ""), ""),
    el("div", { class: "grid3" },
      field("Onderwerp", el("input", { name: "topic", value: c.topic })),
      field("Fragment begint (sec)", el("input", { name: "t", type: "number", step: "0.1", min: "0", value: String(c.t) })),
      field("Fragment eindigt (sec)", el("input", { name: "tEnd", type: "number", step: "0.1", min: "0", value: String(c.tEnd) })),
    ),
    el("h4", {}, `Bronnen (${c.sources.length})`),
    sourcesBox,
    el("button", { type: "button", class: "link-btn", onclick: () => addSourceRow({}) }, "+ Bron toevoegen"),
    el("details", {}, el("summary", { class: "small" }, "Onderzoeksverslag van Claude"), el("pre", { class: "notes" }, c.researchNotes)),
  ].filter(Boolean));

  const msg = el("p", { class: "error", hidden: "" });
  const collect = (approve) => {
    const data = Object.fromEntries(new FormData(form));
    return {
      claimNl: data.claimNl, claimShortEn: data.claimShortEn, topic: data.topic, politicalLean: data.politicalLean,
      verdict: data.verdict, confidence: data.confidence, explanation: data.explanation, disagreementNote: data.disagreementNote,
      t: Number(data.t), tEnd: Number(data.tEnd), approve,
      sources: [...sourcesBox.querySelectorAll(".source-row")].map((row) => {
        const s = {};
        row.querySelectorAll("[data-s]").forEach((i) => (s[i.dataset.s] = i.value.trim()));
        return s;
      }).filter((s) => s.url || s.title),
    };
  };
  const save = async (approve) => {
    msg.hidden = true;
    try {
      await h.api(`/api/jobs/${enc}/claims/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(collect(approve)) });
      await reload();
    } catch (ex) {
      msg.textContent = ex.message;
      msg.hidden = false;
    }
  };
  form.append(
    el("div", { class: "row" },
      el("button", { type: "button", class: "primary", onclick: () => save(true) }, c.approved ? "Opslaan en goedgekeurd houden" : "✓ Goedkeuren"),
      el("button", { type: "button", onclick: () => save(false) }, "Opslaan (nog niet goedkeuren)"),
      el("button", { type: "button", class: "link-btn danger", onclick: async () => {
        if (!confirm(`${c.id.toUpperCase()} verwijderen? Deze bewering komt dan niet in de video.`)) return;
        await h.api(`/api/jobs/${enc}/claims/${c.id}`, { method: "DELETE" });
        await reload();
      } }, "Bewering verwijderen")),
    msg,
    el("p", { class: "muted small" }, "Let op: pas je na goedkeuring iets aan, dan moet je opnieuw goedkeuren."),
  );
  return el("div", { class: "claim-card" + (c.approved ? " approved" : "") }, form);
}

/** Coverage overview: which topics and political sides have we checked? */
export async function renderCoverage(detail, h) {
  const { el } = h;
  const rows = await h.api("/api/coverage");
  const count = (key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
  const table = (title, counts) => el("div", { class: "result-block" }, el("h4", {}, title),
    Object.keys(counts).length ? el("ul", {}, Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => el("li", {}, `${k}: ${n}`))) : el("p", { class: "muted" }, "Nog niets."));
  detail.replaceChildren(el("div", { class: "card" },
    el("h2", {}, "Overzicht: onderwerpen en kanten"),
    el("p", { class: "muted" }, "Zo zie je of we beweringen van alle politieke kanten checken. Telt alle beweringen in alle jobs."),
    el("div", { class: "grid" }, table("Politieke lading", count("lean")), table("Onderwerpen", count("topic"))),
    table("Oordelen", count("verdict")),
    el("h4", {}, `Alle beweringen (${rows.length})`),
    el("table", { class: "coverage" },
      el("thead", {}, el("tr", {}, ["Datum", "Account", "Bewering", "Onderwerp", "Lading", "Oordeel", "OK"].map((t) => el("th", {}, t)))),
      el("tbody", {}, rows.map((r) => el("tr", {},
        el("td", {}, r.date), el("td", {}, r.account), el("td", {}, r.claim), el("td", {}, r.topic), el("td", {}, r.lean),
        el("td", {}, verdictBadge(r.verdict)), el("td", {}, r.approved ? "✓" : ""))))),
  ));
}
