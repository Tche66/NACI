// BACKTEST 5 MOIS (~1500 tirages) — Le bot apprend de CHAQUE prediction
// Simule exactement le comportement reel: predict → resultat → ajuste poids → repeat
const { computeCriteriaTops, convergenceScore, DEFAULT_WEIGHTS } = require("./apprentissage");
const { loadDB } = require("./db");
const db = loadDB();
const draws = db.draws;
const N = 90;

const TEST_SIZE = 1500;
const TOP_N = 15;

// Le bot demarre avec les poids par defaut
let weights = { ...DEFAULT_WEIGHTS };

// Stats par mois (5 mois de 300 tirages)
const mois = [];
for (let i = 0; i < 5; i++) mois.push({ exacts: 0, proches: 0, tests: 0, dist: [0,0,0,0,0,0] });

// Hasard pour comparer
const hasMois = [];
for (let i = 0; i < 5; i++) hasMois.push({ exacts: 0, tests: 0, dist: [0,0,0,0,0,0] });

// Moving average
const movingExacts = [];
let totalTests = 0;
const bestHits = [];
const weightsLog = [];

const t0 = Date.now();
console.log("================================================================");
console.log("  BACKTEST 5 MOIS — APPRENTISSAGE PAR PREDICTION");
console.log("  Chaque resultat ajuste les poids du bot en temps reel");
console.log("================================================================\n");
console.log("Poids de depart:");
const initSorted = Object.entries(weights).sort((a,b) => b[1] - a[1]);
for (const [k,v] of initSorted.slice(0,5)) console.log("  " + k + ": " + v);
console.log("");

// Du plus ancien au plus recent (temps reel)
const startIdx = Math.min(TEST_SIZE - 1, draws.length - 101);

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

  // ═══ PREDICTION avec les poids actuels ═══
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

  // Compter exacts et proches
  let ex = 0, pr = 0;
  for (const n of pred) {
    if (real.has(n)) ex++;
    else { for (const r of real) { if (Math.abs(r - n) <= 2) { pr++; break; } } }
  }

  // Stats mois
  const m = Math.min(Math.floor((totalTests - 1) / 300), 4);
  mois[m].exacts += ex;
  mois[m].proches += pr;
  mois[m].tests++;
  mois[m].dist[ex]++;

  // Hasard
  const rn = new Set();
  while (rn.size < 5) rn.add(Math.floor(Math.random() * N) + 1);
  let hasEx = 0;
  for (const n of rn) if (real.has(n)) hasEx++;
  hasMois[m].exacts += hasEx;
  hasMois[m].tests++;
  hasMois[m].dist[hasEx]++;

  movingExacts.push(ex);
  if (ex >= 2) bestHits.push({ date: target.date, type: target.type, exacts: ex, predit: pred, reel: target.gagnants });

  // ═══ APPRENTISSAGE: ajuster poids apres CHAQUE tirage ═══
  for (const n of target.gagnants) {
    for (const [critere, topList] of Object.entries(tops)) {
      if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
      const w = weights[critere];
      if (w === undefined) continue;
      if (topList.includes(n)) {
        weights[critere] = Math.min(30, w + 0.15);
      } else {
        weights[critere] = Math.max(3, w - 0.03);
      }
    }
  }

  // Log poids tous les 100 tirages
  if (totalTests % 100 === 0) {
    const top3 = Object.entries(weights).filter(([k])=>k!=='antiRepet').sort((a,b)=>b[1]-a[1]).slice(0,3);
    weightsLog.push({ t: totalTests, top3, weights: { ...weights } });
  }
  if (totalTests % 300 === 0) process.stderr.write("  " + totalTests + " tirages...\n");
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ═══ RESULTATS ═══
console.log("\n" + "=".repeat(65));
console.log("  RESULTATS: " + totalTests + " TIRAGES (" + elapsed + "s)");
console.log("=".repeat(65));

// Progression mois par mois
console.log("\n=== PROGRESSION MOIS PAR MOIS ===\n");
console.log("        " + "Bot".padStart(12) + "  " + "Hasard".padStart(12) + "  " + "Gain".padStart(8) + "  " + "2+ exacts".padStart(10));
console.log("-".repeat(60));

for (let m = 0; m < 5; m++) {
  const s = mois[m];
  const h = hasMois[m];
  if (s.tests === 0) continue;
  const botR = (s.exacts / (s.tests * 5) * 100).toFixed(1);
  const hasR = (h.exacts / (h.tests * 5) * 100).toFixed(1);
  const gain = (parseFloat(botR) / parseFloat(hasR) * 100 - 100).toFixed(0);
  const h2 = s.dist[2] + s.dist[3] + s.dist[4] + s.dist[5];
  const label = "Mois " + (m + 1);
  console.log(label.padEnd(8) + (botR + "%").padStart(12) + "  " + (hasR + "%").padStart(12) + "  " + (gain > 0 ? "+" + gain + "%" : gain + "%").padStart(8) + "  " + (h2 + "/" + s.tests).padStart(10));
}

// Totaux
const totalBot = mois.reduce((s, m) => s + m.exacts, 0);
const totalHas = hasMois.reduce((s, m) => s + m.exacts, 0);
const totalT = mois.reduce((s, m) => s + m.tests, 0);
const botPct = (totalBot / (totalT * 5) * 100).toFixed(2);
const hasPct = (totalHas / (totalT * 5) * 100).toFixed(2);
console.log("-".repeat(60));
console.log("TOTAL".padEnd(8) + (botPct + "%").padStart(12) + "  " + (hasPct + "%").padStart(12) + "  " + ("x" + (totalBot / totalHas).toFixed(2)).padStart(8));

// Courbe detaillee
console.log("\n=== COURBE (par 50 tirages) ===\n");
for (let i = 50; i <= movingExacts.length; i += 50) {
  const slice = movingExacts.slice(i - 50, i);
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  const pct = (avg / 5 * 100).toFixed(1);
  const bar = "#".repeat(Math.round(parseFloat(pct) * 2));
  const marker = (i % 300 === 0) ? " <-- mois " + (i / 300) : "";
  console.log("  " + String(i).padStart(4) + ": " + pct.padStart(5) + "% " + bar + marker);
}

// Evolution des poids
console.log("\n=== EVOLUTION DES POIDS (le bot apprend) ===\n");
for (const wl of weightsLog) {
  console.log("  Apres " + String(wl.t).padStart(4) + " tirages: " + wl.top3.map(([k, v]) => k + "=" + v.toFixed(1)).join("  "));
}

console.log("\n=== POIDS FINAUX ===\n");
const finalSorted = Object.entries(weights).sort((a, b) => b[1] - a[1]);
for (const [k, v] of finalSorted) {
  const init = DEFAULT_WEIGHTS[k] || 10;
  const delta = v - init;
  const bar = "#".repeat(Math.round(v));
  console.log("  " + k.padEnd(16) + v.toFixed(1).padStart(6) + " (" + (delta >= 0 ? "+" : "") + delta.toFixed(1) + ")  " + bar);
}

// Meilleurs coups
console.log("\n=== MEILLEURS COUPS ===\n");
bestHits.sort((a, b) => b.exacts - a.exacts);
const h3 = bestHits.filter(h => h.exacts >= 3);
const h2 = bestHits.filter(h => h.exacts >= 2);
if (h3.length > 0) {
  console.log("  >>> " + h3.length + " TIRAGES A 3+ EXACTS <<<");
  for (const h of h3) {
    const m = h.predit.filter(n => h.reel.includes(n));
    console.log("  " + h.date + " " + h.type.padEnd(20) + ": " + h.predit.join("-") + " => " + h.exacts + " EXACTS [" + m.join(",") + "]");
  }
  console.log("");
}
console.log("  2+ exacts: " + h2.length + " / " + totalTests + " (" + (h2.length / totalTests * 100).toFixed(1) + "%)");
console.log("  Derniers:");
for (const h of h2.slice(0, 10)) {
  const m = h.predit.filter(n => h.reel.includes(n));
  console.log("    " + h.date + " " + h.type.padEnd(20) + ": " + h.exacts + " [" + m.join(",") + "]");
}

// Verdict
console.log("\n" + "=".repeat(65));
console.log("  VERDICT FINAL");
console.log("=".repeat(65) + "\n");

const m1r = mois[0].tests > 0 ? mois[0].exacts / (mois[0].tests * 5) * 100 : 0;
const m5r = mois[4].tests > 0 ? mois[4].exacts / (mois[4].tests * 5) * 100 : 0;
const improve = m1r > 0 ? ((m5r / m1r - 1) * 100).toFixed(0) : "?";

console.log("  Mois 1 (debut):     " + m1r.toFixed(1) + "%");
console.log("  Mois 5 (fin):       " + m5r.toFixed(1) + "%");
console.log("  Amelioration:       " + (improve > 0 ? "+" : "") + improve + "%");
console.log("  Bot vs Hasard:      x" + (totalBot / totalHas).toFixed(2));
console.log("  Tirages 3+ exacts:  " + h3.length);
console.log("  Tirages 2+ exacts:  " + h2.length);
