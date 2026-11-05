// BACKTEST MAXIMUM — 24 mois (~5500 tirages) avec apprentissage par prediction
const { computeCriteriaTops, convergenceScore, DEFAULT_WEIGHTS } = require("./apprentissage");
const { loadDB } = require("./db");
const db = loadDB();
const draws = db.draws;
const N = 90;

const TEST_SIZE = 5500;
const TOP_N = 15;

let weights = { ...DEFAULT_WEIGHTS };

// 12 phases de ~460 tirages (2 mois chacune)
const NB_PHASES = 12;
const phases = [];
for (let i = 0; i < NB_PHASES; i++) phases.push({ exacts: 0, proches: 0, tests: 0, dist: [0,0,0,0,0,0] });
const hasPh = [];
for (let i = 0; i < NB_PHASES; i++) hasPh.push({ exacts: 0, tests: 0 });

const movingExacts = [];
let totalTests = 0;
const bestHits = [];
const weightsLog = [];

const t0 = Date.now();
console.log("================================================================");
console.log("  BACKTEST 24 MOIS MAXIMUM — APPRENTISSAGE CONTINU");
console.log("  Le bot part de zero et apprend de chaque tirage");
console.log("================================================================\n");

const startIdx = Math.min(TEST_SIZE - 1, draws.length - 101);
const PHASE_SIZE = Math.ceil(Math.min(TEST_SIZE, startIdx + 1) / NB_PHASES);

for (let i = startIdx; i >= 0; i--) {
  const target = draws[i];
  const hist = draws.slice(i + 1);
  const filt = hist.filter(d => d.type === target.type);
  if (filt.length < 20) continue;

  const parts = target.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let jour = null;
  if (parts) { const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1])); jour = dt.getDay(); }

  const tops = computeCriteriaTops(filt, hist, TOP_N, jour);
  if (!tops) continue;

  const ranked = convergenceScore(tops, weights);
  const imps = ranked.filter(r => r.num % 2 === 1);
  const prs = ranked.filter(r => r.num % 2 === 0);
  let pred;
  if (prs.length >= 2 && imps.length >= 3)
    pred = [...prs.slice(0, 2).map(r => r.num), ...imps.slice(0, 3).map(r => r.num)].sort((a, b) => a - b);
  else
    pred = ranked.slice(0, 5).map(r => r.num).sort((a, b) => a - b);

  const real = new Set(target.gagnants);
  totalTests++;

  let ex = 0, pr = 0;
  for (const n of pred) {
    if (real.has(n)) ex++;
    else { for (const r of real) { if (Math.abs(r - n) <= 2) { pr++; break; } } }
  }

  const ph = Math.min(Math.floor((totalTests - 1) / PHASE_SIZE), NB_PHASES - 1);
  phases[ph].exacts += ex;
  phases[ph].proches += pr;
  phases[ph].tests++;
  phases[ph].dist[ex]++;

  // Hasard
  const rn = new Set();
  while (rn.size < 5) rn.add(Math.floor(Math.random() * N) + 1);
  let hEx = 0;
  for (const n of rn) if (real.has(n)) hEx++;
  hasPh[ph].exacts += hEx;
  hasPh[ph].tests++;

  movingExacts.push(ex);
  if (ex >= 2) bestHits.push({ date: target.date, type: target.type, exacts: ex, predit: pred, reel: target.gagnants });

  // APPRENTISSAGE par prediction
  for (const n of target.gagnants) {
    for (const [critere, topList] of Object.entries(tops)) {
      if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
      const w = weights[critere];
      if (w === undefined) continue;
      if (topList.includes(n)) weights[critere] = Math.min(30, w + 0.15);
      else weights[critere] = Math.max(3, w - 0.03);
    }
  }

  if (totalTests % 200 === 0) {
    const top3 = Object.entries(weights).filter(([k]) => k !== "antiRepet").sort((a, b) => b[1] - a[1]).slice(0, 3);
    weightsLog.push({ t: totalTests, top3 });
  }
  if (totalTests % 500 === 0) process.stderr.write("  " + totalTests + " / ~" + (startIdx + 1) + "\n");
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ═══ RESULTATS ═══
console.log("\n" + "=".repeat(70));
console.log("  RESULTATS: " + totalTests + " TIRAGES SUR 24 MOIS (" + elapsed + "s)");
console.log("=".repeat(70));

console.log("\n=== PROGRESSION (le bot apprend au fil des mois) ===\n");
console.log("Phase".padEnd(10) + "Bot".padStart(8) + "Hasard".padStart(8) + "  Gain".padStart(8) + "  2+".padStart(5) + "  3+".padStart(5) + "  Tests".padStart(7));
console.log("-".repeat(55));

for (let p = 0; p < NB_PHASES; p++) {
  const s = phases[p];
  const h = hasPh[p];
  if (s.tests === 0) continue;
  const bR = (s.exacts / (s.tests * 5) * 100).toFixed(1);
  const hR = (h.exacts / (h.tests * 5) * 100).toFixed(1);
  const gain = parseFloat(hR) > 0 ? ((parseFloat(bR) / parseFloat(hR) - 1) * 100).toFixed(0) : "?";
  const h2 = s.dist[2] + s.dist[3] + s.dist[4] + s.dist[5];
  const h3 = s.dist[3] + s.dist[4] + s.dist[5];
  const label = "Ph " + (p + 1);
  console.log(label.padEnd(10) + (bR + "%").padStart(8) + (hR + "%").padStart(8) + ("+" + gain + "%").padStart(8) + String(h2).padStart(5) + String(h3).padStart(5) + String(s.tests).padStart(7));
}

const tBot = phases.reduce((s, p) => s + p.exacts, 0);
const tHas = hasPh.reduce((s, p) => s + p.exacts, 0);
const tT = phases.reduce((s, p) => s + p.tests, 0);
console.log("-".repeat(55));
console.log("TOTAL".padEnd(10) + ((tBot / (tT * 5) * 100).toFixed(1) + "%").padStart(8) + ((tHas / (tT * 5) * 100).toFixed(1) + "%").padStart(8) + ("x" + (tBot / tHas).toFixed(2)).padStart(8));

// Courbe
console.log("\n=== COURBE DE PROGRESSION (par 200 tirages) ===\n");
for (let i = 200; i <= movingExacts.length; i += 200) {
  const slice = movingExacts.slice(i - 200, i);
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  const pct = (avg / 5 * 100).toFixed(1);
  const bar = "#".repeat(Math.round(parseFloat(pct) * 2));
  console.log("  " + String(i).padStart(5) + ": " + pct.padStart(5) + "% " + bar);
}

// Poids
console.log("\n=== EVOLUTION DES POIDS ===\n");
for (const wl of weightsLog) {
  console.log("  " + String(wl.t).padStart(5) + " tirages: " + wl.top3.map(([k, v]) => k + "=" + v.toFixed(1)).join("  "));
}

console.log("\n=== POIDS FINAUX ===\n");
const finalS = Object.entries(weights).sort((a, b) => b[1] - a[1]);
for (const [k, v] of finalS) {
  const init = DEFAULT_WEIGHTS[k] || 10;
  const bar = "#".repeat(Math.round(v));
  console.log("  " + k.padEnd(16) + v.toFixed(1).padStart(6) + " (init=" + init + ")  " + bar);
}

// Meilleurs coups
const h3all = bestHits.filter(h => h.exacts >= 3);
const h2all = bestHits.filter(h => h.exacts >= 2);
console.log("\n=== MEILLEURS COUPS ===\n");
console.log("  3+ exacts: " + h3all.length + " / " + totalTests);
console.log("  2+ exacts: " + h2all.length + " / " + totalTests + " (" + (h2all.length / totalTests * 100).toFixed(1) + "%)");
if (h3all.length > 0) {
  console.log("\n  >>> TIRAGES A 3+ EXACTS <<<");
  for (const h of h3all) {
    const m = h.predit.filter(n => h.reel.includes(n));
    console.log("  " + h.date + " " + h.type.padEnd(20) + ": " + h.predit.join("-") + " => " + h.exacts + " [" + m.join(",") + "]");
  }
}

// Verdict
console.log("\n" + "=".repeat(70));
console.log("  VERDICT FINAL — 24 MOIS");
console.log("=".repeat(70) + "\n");
const p1 = phases[0], pLast = phases[NB_PHASES - 1].tests > 0 ? phases[NB_PHASES - 1] : phases[NB_PHASES - 2];
const r1 = p1.tests > 0 ? (p1.exacts / (p1.tests * 5) * 100) : 0;
const rL = pLast.tests > 0 ? (pLast.exacts / (pLast.tests * 5) * 100) : 0;
const imp = r1 > 0 ? ((rL / r1 - 1) * 100).toFixed(0) : "?";
console.log("  Phase 1 (debut):      " + r1.toFixed(1) + "%");
console.log("  Derniere phase:       " + rL.toFixed(1) + "%");
console.log("  Amelioration:         " + (imp > 0 ? "+" : "") + imp + "%");
console.log("  Bot global:           " + (tBot / (tT * 5) * 100).toFixed(2) + "%");
console.log("  Hasard global:        " + (tHas / (tT * 5) * 100).toFixed(2) + "%");
console.log("  Avantage:             x" + (tBot / tHas).toFixed(3));
console.log("  Total 3+ exacts:      " + h3all.length);
console.log("  Total 2+ exacts:      " + h2all.length);
