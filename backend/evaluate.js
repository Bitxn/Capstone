/**
 * PromptPilot evaluation harness.
 *
 * Usage (backend must be running on http://localhost:3001):
 *   node evaluate.js                 # full run (20 prompts x 3 edits)
 *   node evaluate.js --delay 6000    # wait 6 s between API calls (free-tier quota)
 *   node evaluate.js --limit 5       # quick smoke test on the first 5 prompts
 *
 * Output: results.json, results.csv, and a printed summary.
 * Nothing here is fabricated: every number comes from running system.
 */
const fs = require("fs");

const API = process.env.API_BASE || "http://localhost:3001";
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const DELAY = opt("delay", 4000);
const LIMIT = opt("limit", Infinity);

// Three specificity levels, written to mimic real non-expert users.
const PROMPTS = [
  // --- vague (V) ---
  ["V", "a website for my bakery"],
  ["V", "portfolio site"],
  ["V", "simple calculator"],
  ["V", "a college erp portal"],
  ["V", "landing page for my app"],
  ["V", "website for a gym"],
  // --- moderate (M) ---
  ["M", "A portfolio for my photography work, dark theme, minimal, with a gallery grid and a contact form"],
  ["M", "Homepage for a rustic bakery with a menu section, opening hours and an order form"],
  ["M", "A personal blog landing page with an about section, three featured posts and a newsletter signup"],
  ["M", "Stationery shop inventory and billing system with a product table and a bill total"],
  ["M", "Landing page for a SaaS product with pricing in three tiers and an FAQ accordion"],
  ["M", "Event page for a college tech fest with a schedule, speakers and a registration form"],
  ["M", "Dentist clinic website with services, doctor profiles and an appointment form"],
  // --- detailed (D) ---
  ["D", "Restaurant website: sticky nav (Home, Menu, Reservations, Contact), hero with a warm earthy palette, a seasonal menu in three cards, a reservation form with date, time and guests, and a footer with opening hours. Mobile responsive."],
  ["D", "Online course landing page: hero with call to action, four feature cards, a curriculum accordion with six modules, instructor bio, testimonial slider using useState, and an enrol button that shows a confirmation message."],
  ["D", "Personal finance tracker: form to add income or expense with category, a list of transactions, running balance, and a filter by category. All state in React, no external libraries."],
  ["D", "Travel agency site: full-width hero, destination cards with price and rating, a search filter by price using a range input, and a contact section. Use a blue and white palette."],
  ["D", "Quiz app: five multiple-choice questions on general science, one at a time, score at the end, restart button, progress bar."],
  ["D", "Real-estate listing page: property grid with image placeholders, filter by bedrooms, a favourites toggle on each card, and an enquiry form."],
  ["D", "Fitness trainer portfolio: hero, services, three pricing plans, before/after transformation cards, booking form, and dark mode toggle."],
];

// Edits modelled on the feedback types reported in the HCI literature:
// positive instruction, negative instruction, and a local-scope change.
const EDITS = [
  ["positive", "Change the primary colour of the site to deep green."],
  ["negative", "Make the hero section less cluttered."],
  ["local", "Add a footer with copyright text and social links."],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const t0 = Date.now();
  let status = 0, json = null, err = null;
  try {
    const res = await fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    status = res.status;
    json = await res.json().catch(() => null);
  } catch (e) {
    err = e.message;
  }
  return { ms: Date.now() - t0, status, json, err };
}

// Fraction of lines of `before` that still appear in `after` (preservation).
function preserved(before, after) {
  const a = before.split("\n").map((s) => s.trim()).filter(Boolean);
  const bset = new Set(after.split("\n").map((s) => s.trim()));
  if (!a.length) return 1;
  return a.filter((l) => bset.has(l)).length / a.length;
}

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p95 = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};

(async () => {
  const health = await fetch(API + "/api/health").then((r) => r.json()).catch(() => null);
  if (!health) {
    console.error("Backend not reachable at " + API);
    process.exit(1);
  }
  console.log("Health:", JSON.stringify(health));

  const rows = [];
  const prompts = PROMPTS.slice(0, LIMIT);

  for (let i = 0; i < prompts.length; i++) {
    const [level, prompt] = prompts[i];
    console.log(`\n[${i + 1}/${prompts.length}] (${level}) ${prompt.slice(0, 70)}`);

    const g = await post("/api/generate", { prompt });
    const ok = g.status === 201 && g.json?.code;
    rows.push({
      prompt_id: i + 1, level, stage: "generate", edit_type: "",
      ok: ok ? 1 : 0, http: g.status, latency_ms: g.ms,
      provider: g.json?.provider || "", lines: ok ? g.json.code.split("\n").length : 0,
      preserved: "", error: ok ? "" : (g.json?.error || g.json?.message || g.err || ""),
    });
    console.log(`   generate: ${ok ? "OK" : "FAIL"} ${g.ms} ms ${g.json?.provider || ""}`);
    await sleep(DELAY);
    if (!ok) continue;

    let code = g.json.code;
    const projectId = g.json.projectId;

    // Preview endpoint must serve a page for the new project.
    const pv = await fetch(API + `/preview/${projectId}`).catch(() => null);
    rows.push({
      prompt_id: i + 1, level, stage: "preview", edit_type: "",
      ok: pv && pv.ok ? 1 : 0, http: pv ? pv.status : 0, latency_ms: "",
      provider: "", lines: "", preserved: "", error: "",
    });

    for (const [type, instruction] of EDITS) {
      const e = await post("/api/edit", { projectId, currentCode: code, editPrompt: instruction });
      const eok = e.status === 200 && e.json?.code;
      const keep = eok ? preserved(code, e.json.code) : "";
      rows.push({
        prompt_id: i + 1, level, stage: "edit", edit_type: type,
        ok: eok ? 1 : 0, http: e.status, latency_ms: e.ms,
        provider: e.json?.provider || "", lines: eok ? e.json.code.split("\n").length : 0,
        preserved: eok ? keep.toFixed(3) : "",
        error: eok ? "" : (e.json?.error || e.json?.message || e.err || ""),
      });
      console.log(`   edit/${type}: ${eok ? "OK" : "FAIL"} ${e.ms} ms preserved=${eok ? keep.toFixed(2) : "-"}`);
      if (eok) code = e.json.code;
      await sleep(DELAY);
    }

    // Publish the final version and confirm the public URL resolves.
    const p = await post("/api/publish", { projectId, code, name: prompt.slice(0, 40) });
    let pubOk = 0;
    if (p.status === 201 && p.json?.url) {
      const r = await fetch(API + p.json.url).catch(() => null);
      pubOk = r && r.ok ? 1 : 0;
    }
    rows.push({
      prompt_id: i + 1, level, stage: "publish", edit_type: "",
      ok: pubOk, http: p.status, latency_ms: p.ms, provider: "", lines: "",
      preserved: "", error: pubOk ? "" : (p.json?.error || p.err || ""),
    });
    console.log(`   publish: ${pubOk ? "OK" : "FAIL"} ${p.ms} ms`);
    await sleep(DELAY);
  }

  fs.writeFileSync("results.json", JSON.stringify(rows, null, 2));
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(",")].concat(
    rows.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(","))
  );
  fs.writeFileSync("results.csv", csv.join("\n"));

  // ---------------- summary ----------------
  const by = (f) => rows.filter(f);
  const gens = by((r) => r.stage === "generate");
  const eds = by((r) => r.stage === "edit");
  const pubs = by((r) => r.stage === "publish");
  const lat = (rs) => rs.filter((r) => r.ok).map((r) => r.latency_ms);

  console.log("\n================ SUMMARY ================");
  console.log(`Generation success : ${gens.filter((r) => r.ok).length}/${gens.length} (${pct(gens.filter((r) => r.ok).length, gens.length)})`);
  for (const lv of ["V", "M", "D"]) {
    const g = gens.filter((r) => r.level === lv);
    console.log(`  level ${lv}         : ${g.filter((r) => r.ok).length}/${g.length}`);
  }
  console.log(`Generation latency : median ${median(lat(gens))} ms, p95 ${p95(lat(gens))} ms`);
  console.log(`Edit success       : ${eds.filter((r) => r.ok).length}/${eds.length} (${pct(eds.filter((r) => r.ok).length, eds.length)})`);
  for (const t of ["positive", "negative", "local"]) {
    const e = eds.filter((r) => r.edit_type === t);
    const pr = e.filter((r) => r.ok).map((r) => Number(r.preserved));
    console.log(`  ${t.padEnd(9)}: ${e.filter((r) => r.ok).length}/${e.length}, median line-preservation ${median(pr).toFixed(3)}`);
  }
  console.log(`Edit latency       : median ${median(lat(eds))} ms, p95 ${p95(lat(eds))} ms`);
  console.log(`Publish success    : ${pubs.filter((r) => r.ok).length}/${pubs.length}`);
  const prov = {};
  rows.filter((r) => r.provider).forEach((r) => (prov[r.provider] = (prov[r.provider] || 0) + 1));
  console.log("Provider usage     :", JSON.stringify(prov));
  console.log("Wrote results.json and results.csv");
})();
