// Backtest 3 mois avec auto-apprentissage progressif
const { computeCriteriaTops, convergenceScore } = require("./apprentissage");
const { loadDB } = require("./db");
const db = loadDB();
const draws = db.draws;

const BACKTEST_SIZE = 900;
const NUM_RANGE = 90;
const LEARNING_RATE = 0.3;
const TOP_N = 15;

let weights = { freqGlob: 10, freqRecent: 10, cycleOverdue: 10, momentum: 10, retard: 10, markov2: 10, paires: 10, terminaisons: 10, jourAffinity: 10, antiRepet: 5 };

const phases = [
  { label: "Mois 1 (sans apprentissage)", exacts: 0, proches: 0, tests: 0, dist: [0,0,0,0,0,0] },
  { label: "Mois 2 (apprentissage demarre)", exacts: 0, proches: 0, tests: 0, dist: [0,0,0,0,0,0] },
  { label: "Mois 3 (apprentissage mature)", exacts: 0, proches: 0, tests: 0, dist: [0,0,0,0,0,0] },
];

const movingAvg = [];
const criteriaSucc = {};
const criteriaFail = {};
for (const k of Object.keys(weights)) { criteriaSucc[k] = 0; criteriaFail[k] = 0; }

let totalTests = 0;
const bestHits = [];
const weightHistory = [];

console.log("=== BACKTEST 3 MOIS AVEC AUTO-APPRENTISSAGE ===");
console.log("Le bot apprend apres chaque resultat et s'ameliore\n");
console.log("Poids initiaux: tous a 10 (egal)\n");

// Du plus ancien au plus recent (simulation temps reel)
const startIdx = Math.min(BACKTEST_SIZE - 1, draws.length - 101);

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

  const phase = totalTests <= 300 ? 0 : totalTests <= 600 ? 1 : 2;
  phases[phase].exacts += ex;
  phases[phase].proches += pr;
  phases[phase].tests++;
  phases[phase].dist[ex]++;

  if (ex >= 2) bestHits.push({ date: target.date, type: target.type, exacts: ex, predit: pred, reel: target.gagnants });

  movingAvg.push(ex);

  // APPRENTISSAGE apres les 30 premiers tirages
  if (totalTests > 30) {
    for (const n of target.gagnants) {
      for (const [critere, topList] of Object.entries(tops)) {
        if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
        if (topList.includes(n)) {
          criteriaSucc[critere] = (criteriaSucc[critere] || 0) + 1;
        } else {
          criteriaFail[critere] = (criteriaFail[critere] || 0) + 1;
        }
      }
    }

    // Ajuster les poids tous les 50 tirages
    if (totalTests % 50 === 0) {
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
      weightHistory.push({ test: totalTests, weights: { ...weights } });
    }
  }

  if (totalTests % 100 === 0) process.stderr.write("  " + totalTests + " tirages...\n");
}

// ═══ RESULTATS ═══

console.log("\n" + "=".repeat(65));
console.log("  RESULTATS: " + totalTests + " TIRAGES AVEC AUTO-APPRENTISSAGE");
console.log("=".repeat(65) + "\n");

console.log("=== PROGRESSION PAR MOIS ===\n");
for (let p = 0; p < 3; p++) {
  const s = phases[p];
  if (s.tests === 0) continue;
  const taux = (s.exacts / (s.tests * 5) * 100).toFixed(1);
  const avgE = (s.exacts / s.tests).toFixed(2);
  const hits2 = s.dist[2] + s.dist[3] + s.dist[4] + s.dist[5];
  console.log(s.label);
  console.log("  Taux exact: " + taux + "% | Moy: " + avgE + "/tir | 2+ exacts: " + hits2 + "/" + s.tests + " (" + (hits2/s.tests*100).toFixed(1) + "%)");
  console.log("  Distribution: 0=" + s.dist[0] + " 1=" + s.dist[1] + " 2=" + s.dist[2] + " 3=" + s.dist[3]);
  console.log("");
}

// Courbe de progression
console.log("=== COURBE DE PROGRESSION (moy mobile sur 50 tirages) ===\n");
for (let i = 50; i <= movingAvg.length; i += 50) {
  const slice = movingAvg.slice(i - 50, i);
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  const taux = (avg / 5 * 100).toFixed(1);
  const bar = "#".repeat(Math.round(parseFloat(taux) * 3));
  console.log("  Tirages " + String(i - 49).padStart(3) + "-" + String(i).padStart(3) + ": " + taux.padStart(5) + "% " + bar);
}

// Evolution des poids
console.log("\n=== EVOLUTION DES POIDS ===\n");
console.log("Poids initiaux: tous = 10");
console.log("Poids finaux:");
const sorted = Object.entries(weights).sort((a, b) => b[1] - a[1]);
for (const [k, v] of sorted) {
  const bar = "#".repeat(Math.round(v));
  console.log("  " + k.padEnd(16) + ": " + v.toFixed(1).padStart(5) + " " + bar);
}

if (weightHistory.length > 0) {
  console.log("\nEvolution des 3 meilleurs criteres:");
  for (const wh of weightHistory) {
    const top3 = Object.entries(wh.weights).filter(([k]) => k !== "antiRepet").sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + "=" + v.toFixed(0)).join(", ");
    console.log("  Apres " + String(wh.test).padStart(3) + " tirages: " + top3);
  }
}

// Comparaison
console.log("\n=== AMELIORATION: MOIS 1 vs MOIS 3 ===\n");
const debut = phases[0];
const fin = phases[2];
if (debut.tests > 0 && fin.tests > 0) {
  const tauxD = (debut.exacts / (debut.tests * 5) * 100).toFixed(1);
  const tauxF = (fin.exacts / (fin.tests * 5) * 100).toFixed(1);
  const improve = ((parseFloat(tauxF) - parseFloat(tauxD)) / parseFloat(tauxD) * 100).toFixed(0);
  const hits2D = debut.dist[2] + debut.dist[3] + debut.dist[4] + debut.dist[5];
  const hits2F = fin.dist[2] + fin.dist[3] + fin.dist[4] + fin.dist[5];
  console.log("  Mois 1 (brut, poids=10):    " + tauxD + "% exact | " + hits2D + " tirages avec 2+ exacts");
  console.log("  Mois 3 (poids optimises):   " + tauxF + "% exact | " + hits2F + " tirages avec 2+ exacts");
  console.log("");
  if (parseFloat(improve) > 0) {
    console.log("  >>> AMELIORATION: +" + improve + "% grace a l'apprentissage <<<");
  } else if (parseFloat(improve) === 0) {
    console.log("  >>> Stable (les poids initiaux etaient deja corrects)");
  } else {
    console.log("  >>> Le mois 1 avait de meilleurs donnees (saisonnier?)");
  }
}

// Meilleurs coups
console.log("\n=== MEILLEURS COUPS (2+ exacts) ===\n");
bestHits.sort((a, b) => b.exacts - a.exacts);
for (const h of bestHits.slice(0, 12)) {
  const matches = h.predit.filter(n => h.reel.includes(n));
  console.log("  " + h.date + " " + h.type.padEnd(20) + ": " + h.exacts + " EXACTS [" + matches.join(", ") + "]  predit:" + h.predit.join("-") + " vs " + h.reel.join("-"));
}
console.log("\n  Total 2+ exacts: " + bestHits.filter(h => h.exacts >= 2).length + " / " + totalTests + " (" + (bestHits.filter(h => h.exacts >= 2).length / totalTests * 100).toFixed(1) + "%)");

const hits3 = bestHits.filter(h => h.exacts >= 3);
if (hits3.length > 0) {
  console.log("\n  >>> " + hits3.length + " TIRAGES AVEC 3+ EXACTS <<<");
  for (const h of hits3) console.log("    " + h.date + " " + h.type + ": " + h.predit.join("-") + " => " + h.exacts + " EXACTS!");
}
