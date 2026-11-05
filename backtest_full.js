// BACKTEST 12 MOIS — ~3600 tirages avec auto-apprentissage progressif
const { computeCriteriaTops, convergenceScore } = require("./apprentissage");
const { loadDB } = require("./db");
const db = loadDB();
const draws = db.draws;

const BACKTEST_SIZE = 3600;
const NUM_RANGE = 90;
const LEARNING_RATE = 0.25;
const TOP_N = 15;
const ADJUST_EVERY = 80;

// Poids de depart (egal)
let weights = { freqGlob: 10, freqRecent: 10, cycleOverdue: 10, momentum: 10, retard: 10, markov2: 10, paires: 10, terminaisons: 10, jourAffinity: 10, antiRepet: 5 };

// 6 phases de ~600 tirages (2 mois chacune)
const NB_PHASES = 6;
const PHASE_SIZE = Math.ceil(BACKTEST_SIZE / NB_PHASES);
const phases = [];
for (let p = 0; p < NB_PHASES; p++) {
  phases.push({ exacts: 0, proches: 0, tests: 0, dist: [0,0,0,0,0,0] });
}

const movingAvg = [];
const criteriaSucc = {};
const criteriaFail = {};
for (const k of Object.keys(weights)) { criteriaSucc[k] = 0; criteriaFail[k] = 0; }

let totalTests = 0;
const bestHits = [];
const weightHistory = [];

// Hasard pour comparer
const hasardStats = { exacts: 0, tests: 0, dist: [0,0,0,0,0,0] };

// Par type
const typeStats = {};

console.log("================================================================");
console.log("  BACKTEST 12 MOIS AVEC AUTO-APPRENTISSAGE");
console.log("  ~3600 tirages | Le bot part de zero et apprend");
console.log("================================================================\n");

const startIdx = Math.min(BACKTEST_SIZE - 1, draws.length - 101);
const t0 = Date.now();

for (let i = startIdx; i >= 0; i--) {
  const target = draws[i];
  const history = draws.slice(i + 1);
  const filtered = history.filter(d => d.type === target.type);
  if (filtered.length < 20) continue;

  const parts = target.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let jour = null;
  if (parts) {
    const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
    jour = dt.getDay();
  }

  const tops = computeCriteriaTops(filtered, history, TOP_N, jour);
  if (!tops) continue;

  const ranked = convergenceScore(tops, weights);

  // Prediction equilibree (2P+3I)
  const imps = ranked.filter(r => r.num % 2 === 1);
  const prs = ranked.filter(r => r.num % 2 === 0);
  let pred;
  if (prs.length >= 2 && imps.length >= 3) {
    pred = [...prs.slice(0, 2).map(r => r.num), ...imps.slice(0, 3).map(r => r.num)].sort((a, b) => a - b);
  } else {
    pred = ranked.slice(0, 5).map(r => r.num).sort((a, b) => a - b);
  }

  const realNums = new Set(target.gagnants);
  totalTests++;

  let ex = 0, pr = 0;
  for (const n of pred) {
    if (realNums.has(n)) ex++;
    else { for (const r of realNums) { if (Math.abs(r - n) <= 2) { pr++; break; } } }
  }

  // Phase
  const phase = Math.min(Math.floor((totalTests - 1) / PHASE_SIZE), NB_PHASES - 1);
  phases[phase].exacts += ex;
  phases[phase].proches += pr;
  phases[phase].tests++;
  phases[phase].dist[ex]++;

  // Par type
  if (!typeStats[target.type]) typeStats[target.type] = { exacts: 0, tests: 0, dist: [0,0,0,0,0,0] };
  typeStats[target.type].exacts += ex;
  typeStats[target.type].tests++;
  typeStats[target.type].dist[ex]++;

  if (ex >= 2) bestHits.push({ date: target.date, type: target.type, exacts: ex, predit: pred, reel: target.gagnants });
  movingAvg.push(ex);

  // Hasard
  const randN = new Set();
  while (randN.size < 5) randN.add(Math.floor(Math.random() * 90) + 1);
  let randEx = 0;
  for (const n of randN) if (realNums.has(n)) randEx++;
  hasardStats.exacts += randEx;
  hasardStats.tests++;
  hasardStats.dist[randEx]++;

  // APPRENTISSAGE
  if (totalTests > 50) {
    for (const n of target.gagnants) {
      for (const [critere, topList] of Object.entries(tops)) {
        if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
        if (topList.includes(n)) criteriaSucc[critere] = (criteriaSucc[critere] || 0) + 1;
        else criteriaFail[critere] = (criteriaFail[critere] || 0) + 1;
      }
    }

    if (totalTests % ADJUST_EVERY === 0) {
      for (const k of Object.keys(weights)) {
        if (k === "antiRepet") continue;
        const succ = criteriaSucc[k] || 0;
        const fail = criteriaFail[k] || 0;
        const total = succ + fail;
        if (total === 0) continue;
        const rate = succ / total;
        const baseline = TOP_N / NUM_RANGE;
        const lift = rate / baseline;
        weights[k] = Math.max(3, Math.min(35, weights[k] + (lift - 1) * LEARNING_RATE * 10));
      }
      for (const k of Object.keys(criteriaSucc)) { criteriaSucc[k] = 0; criteriaFail[k] = 0; }
      weightHistory.push({ test: totalTests, w: { ...weights } });
    }
  }

  if (totalTests % 500 === 0) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stderr.write("  " + totalTests + " tirages... (" + elapsed + "s)\n");
  }
}

const totalTime = ((Date.now() - t0) / 1000).toFixed(1);

// ═══ RESULTATS ═══
console.log("\n" + "=".repeat(65));
console.log("  BACKTEST 12 MOIS: " + totalTests + " TIRAGES (" + totalTime + "s)");
console.log("=".repeat(65) + "\n");

// Phases
const moisLabels = ["Mois 1-2", "Mois 3-4", "Mois 5-6", "Mois 7-8", "Mois 9-10", "Mois 11-12"];
console.log("=== PROGRESSION (le bot apprend au fil du temps) ===\n");
console.log("Periode".padEnd(14) + "Taux exact".padStart(11) + "  Moy/tir".padStart(9) + "  2+ exacts".padStart(11) + "  0-exact".padStart(9) + "  1-exact".padStart(9));
console.log("-".repeat(65));
for (let p = 0; p < NB_PHASES; p++) {
  const s = phases[p];
  if (s.tests === 0) continue;
  const taux = (s.exacts / (s.tests * 5) * 100).toFixed(1);
  const avg = (s.exacts / s.tests).toFixed(2);
  const h2 = s.dist[2] + s.dist[3] + s.dist[4] + s.dist[5];
  console.log(
    moisLabels[p].padEnd(14) +
    (taux + "%").padStart(11) +
    avg.padStart(9) +
    (h2 + "/" + s.tests + " (" + (h2/s.tests*100).toFixed(1) + "%)").padStart(18) +
    ((s.dist[0]/s.tests*100).toFixed(0) + "%").padStart(9) +
    ((s.dist[1]/s.tests*100).toFixed(0) + "%").padStart(9)
  );
}

// Total bot vs hasard
const botRate = phases.reduce((s,p) => s+p.exacts, 0) / (phases.reduce((s,p) => s+p.tests, 0) * 5);
const hasRate = hasardStats.exacts / (hasardStats.tests * 5);
const totalEx = phases.reduce((s,p) => s+p.exacts, 0);
const totalTe = phases.reduce((s,p) => s+p.tests, 0);
console.log("-".repeat(65));
console.log(("BOT TOTAL").padEnd(14) + ((botRate*100).toFixed(1)+"%").padStart(11) + (totalEx/totalTe).toFixed(2).padStart(9));
console.log(("HASARD").padEnd(14) + ((hasRate*100).toFixed(1)+"%").padStart(11) + (hasardStats.exacts/hasardStats.tests).toFixed(2).padStart(9));
console.log("");
console.log("  Bot vs Hasard: x" + (botRate/hasRate).toFixed(2));

// Courbe
console.log("\n=== COURBE DE PROGRESSION (par 100 tirages) ===\n");
for (let i = 100; i <= movingAvg.length; i += 100) {
  const slice = movingAvg.slice(i - 100, i);
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  const taux = (avg / 5 * 100).toFixed(1);
  const bar = "#".repeat(Math.round(parseFloat(taux) * 2));
  console.log("  " + String(i-99).padStart(4) + "-" + String(i).padStart(4) + ": " + taux.padStart(5) + "% " + bar);
}

// Poids finaux
console.log("\n=== POIDS FINAUX (appris sur 12 mois) ===\n");
const sorted = Object.entries(weights).sort((a, b) => b[1] - a[1]);
for (const [k, v] of sorted) {
  const bar = "#".repeat(Math.round(v * 1.5));
  const init = k === "antiRepet" ? 5 : 10;
  const delta = v - init;
  console.log("  " + k.padEnd(16) + v.toFixed(1).padStart(6) + "  (" + (delta >= 0 ? "+" : "") + delta.toFixed(1) + ")  " + bar);
}

// Evolution
if (weightHistory.length > 0) {
  console.log("\n=== EVOLUTION DES POIDS ===\n");
  for (const wh of [weightHistory[0], weightHistory[Math.floor(weightHistory.length/4)], weightHistory[Math.floor(weightHistory.length/2)], weightHistory[Math.floor(weightHistory.length*3/4)], weightHistory[weightHistory.length-1]]) {
    if (!wh) continue;
    const top = Object.entries(wh.w).filter(([k]) => k !== "antiRepet").sort((a,b) => b[1]-a[1]);
    console.log("  Apres " + String(wh.test).padStart(4) + " tirages: " + top.slice(0,4).map(([k,v]) => k + "=" + v.toFixed(1)).join("  "));
  }
}

// Top types
console.log("\n=== TOP 15 TYPES DE TIRAGE ===\n");
const typeRanked = Object.entries(typeStats).map(([t, s]) => ({
  type: t, taux: s.exacts / (s.tests * 5), ...s,
  h2: s.dist[2] + s.dist[3] + s.dist[4] + s.dist[5],
})).filter(t => t.tests >= 20).sort((a, b) => b.taux - a.taux);
console.log("Type".padEnd(24) + "Taux".padStart(7) + "Tests".padStart(7) + "Exacts".padStart(7) + " 2+hits".padStart(7));
for (const t of typeRanked.slice(0, 15)) {
  console.log(t.type.padEnd(24) + ((t.taux*100).toFixed(1)+"%").padStart(7) + String(t.tests).padStart(7) + String(t.exacts).padStart(7) + String(t.h2).padStart(7));
}

// Pires types
console.log("\n=== 5 PIRES TYPES ===\n");
for (const t of typeRanked.slice(-5).reverse()) {
  console.log(t.type.padEnd(24) + ((t.taux*100).toFixed(1)+"%").padStart(7) + String(t.tests).padStart(7));
}

// Meilleurs coups
console.log("\n=== MEILLEURS COUPS ===\n");
bestHits.sort((a, b) => b.exacts - a.exacts);
const h3 = bestHits.filter(h => h.exacts >= 3);
const h2 = bestHits.filter(h => h.exacts >= 2);
console.log("  3+ exacts: " + h3.length + " fois sur " + totalTests);
console.log("  2+ exacts: " + h2.length + " fois sur " + totalTests + " (" + (h2.length/totalTests*100).toFixed(1) + "%)");

if (h3.length > 0) {
  console.log("\n  >>> TIRAGES A 3+ EXACTS <<<");
  for (const h of h3) {
    const matches = h.predit.filter(n => h.reel.includes(n));
    console.log("  " + h.date + " " + h.type.padEnd(20) + ": predit " + h.predit.join("-") + " reel " + h.reel.join("-") + " => " + h.exacts + " [" + matches.join(",") + "]");
  }
}

console.log("\n  Derniers 2+ exacts:");
for (const h of h2.slice(0, 15)) {
  const matches = h.predit.filter(n => h.reel.includes(n));
  console.log("  " + h.date + " " + h.type.padEnd(20) + ": " + h.exacts + " exacts [" + matches.join(",") + "]");
}

// Comparaison debut vs fin
console.log("\n=== VERDICT FINAL ===\n");
const p0 = phases[0], pN = phases[NB_PHASES - 1];
if (p0.tests > 0 && pN.tests > 0) {
  const t0 = (p0.exacts / (p0.tests * 5) * 100).toFixed(1);
  const tN = (pN.exacts / (pN.tests * 5) * 100).toFixed(1);
  const imp = ((parseFloat(tN) - parseFloat(t0)) / parseFloat(t0) * 100).toFixed(0);
  console.log("  Debut (poids egal):   " + t0 + "% exact");
  console.log("  Fin (12 mois appris): " + tN + "% exact");
  console.log("  Hasard:               " + (hasRate*100).toFixed(1) + "% exact");
  console.log("");
  console.log("  Amelioration debut->fin: " + (imp > 0 ? "+" : "") + imp + "%");
  console.log("  Avantage vs hasard:      x" + (botRate/hasRate).toFixed(2));
  console.log("  Total 3+ exacts:         " + h3.length);
  console.log("  Total 2+ exacts:         " + h2.length + " (" + (h2.length/totalTests*100).toFixed(1) + "%)");
}
