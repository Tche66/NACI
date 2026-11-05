// Backtest v4 vs v3 vs hasard — 1500 tirages (5 mois)
const { computeCriteriaTops, convergenceScore, DEFAULT_WEIGHTS, walkForwardLearn } = require("./apprentissage");
const { loadDB } = require("./db");
const db = loadDB();
const draws = db.draws;
const N = 90;

const TEST_SIZE = 1500;
const LEARN_BLOCK = 300;

// v4: walk-forward avec proba conditionnelle
let v4W = { ...DEFAULT_WEIGHTS };
const v4Stats = { exacts: 0, tests: 0, dist: [0,0,0,0,0,0], proches: 0 };

// v3: anciens poids fixes
const v3W = { freqGlob: 14, freqRecent: 20, cycleOverdue: 3, momentum: 22, retard: 5, markov2: 8, paires: 6, terminaisons: 12, jourAffinity: 10, antiRepet: 5 };
const v3Stats = { exacts: 0, tests: 0, dist: [0,0,0,0,0,0], proches: 0 };

// Hasard
const hasStats = { exacts: 0, tests: 0, dist: [0,0,0,0,0,0] };

// Walk-forward compteurs
const criteriaSucc = {};
const criteriaFail = {};
for (const k of Object.keys(v4W)) { criteriaSucc[k] = 0; criteriaFail[k] = 0; }

// Phases
const phases = [
  { label: "Bloc 1 (0-500)", v4e: 0, v3e: 0, t: 0 },
  { label: "Bloc 2 (500-1000)", v4e: 0, v3e: 0, t: 0 },
  { label: "Bloc 3 (1000-1500)", v4e: 0, v3e: 0, t: 0 },
];

let totalTests = 0;
const bestHits = [];
const t0 = Date.now();

console.log("=== BACKTEST COMPARATIF v4 vs v3 vs HASARD ===");
console.log(TEST_SIZE + " tirages, walk-forward tous les " + LEARN_BLOCK + " tirages\n");

// Du plus ancien au plus recent
const startIdx = Math.min(TEST_SIZE - 1, draws.length - 101);

for (let i = startIdx; i >= 0; i--) {
  const target = draws[i];
  const hist = draws.slice(i + 1);
  const filt = hist.filter(d => d.type === target.type);
  if (filt.length < 20) continue;

  const parts = target.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let jour = null;
  if (parts) { const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1])); jour = dt.getDay(); }

  const tops = computeCriteriaTops(filt, hist, 15, jour);
  if (!tops) continue;

  const real = new Set(target.gagnants);
  totalTests++;

  function predict(w) {
    const ranked = convergenceScore(tops, w);
    const imps = ranked.filter(r => r.num % 2 === 1);
    const prs = ranked.filter(r => r.num % 2 === 0);
    if (prs.length >= 2 && imps.length >= 3)
      return [...prs.slice(0, 2).map(r => r.num), ...imps.slice(0, 3).map(r => r.num)].sort((a, b) => a - b);
    return ranked.slice(0, 5).map(r => r.num).sort((a, b) => a - b);
  }

  function count(pred, stats) {
    let ex = 0, pr = 0;
    for (const n of pred) {
      if (real.has(n)) ex++;
      else { for (const r of real) { if (Math.abs(r - n) <= 2) { pr++; break; } } }
    }
    stats.exacts += ex;
    stats.proches = (stats.proches || 0) + pr;
    stats.tests++;
    stats.dist[ex]++;
    return ex;
  }

  // v4
  const v4pred = predict(v4W);
  const v4ex = count(v4pred, v4Stats);

  // v3
  const v3pred = predict(v3W);
  count(v3pred, v3Stats);

  // Hasard
  const rn = new Set();
  while (rn.size < 5) rn.add(Math.floor(Math.random() * N) + 1);
  count([...rn], hasStats);

  if (v4ex >= 2) bestHits.push({ date: target.date, type: target.type, exacts: v4ex, predit: v4pred, reel: target.gagnants });

  // Phase
  const p = totalTests <= 500 ? 0 : totalTests <= 1000 ? 1 : 2;
  phases[p].v4e += v4ex;
  phases[p].v3e += count(v3pred, {exacts:0,tests:0,dist:[0,0,0,0,0,0]}) || 0;
  // re-count for phase v3 (hacky but simple)
  phases[p].t++;

  // Walk-forward: apprendre des resultats
  if (totalTests > 50) {
    for (const n of target.gagnants) {
      for (const [critere, topList] of Object.entries(tops)) {
        if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
        if (topList.includes(n)) criteriaSucc[critere] = (criteriaSucc[critere] || 0) + 1;
        else criteriaFail[critere] = (criteriaFail[critere] || 0) + 1;
      }
    }

    if (totalTests % LEARN_BLOCK === 0) {
      for (const k of Object.keys(v4W)) {
        if (k === "antiRepet") continue;
        const succ = criteriaSucc[k] || 0;
        const fail = criteriaFail[k] || 0;
        const total = succ + fail;
        if (total === 0) continue;
        const rate = succ / total;
        const baseline = 15 / N;
        const lift = rate / baseline;
        v4W[k] = Math.max(3, Math.min(30, v4W[k] + (lift - 1) * 2.5));
      }
      for (const k of Object.keys(criteriaSucc)) { criteriaSucc[k] = 0; criteriaFail[k] = 0; }
      process.stderr.write("  [" + totalTests + "] Poids adaptes: " +
        Object.entries(v4W).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>k+"="+v.toFixed(0)).join(", ") + "\n");
    }
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ═══ RESULTATS ═══
console.log("\n" + "=".repeat(65));
console.log("  RESULTATS — " + totalTests + " TIRAGES (" + elapsed + "s)");
console.log("=".repeat(65) + "\n");

function showStats(name, s) {
  const rate = (s.exacts / (s.tests * 5) * 100).toFixed(2);
  const avg = (s.exacts / s.tests).toFixed(2);
  const h2 = s.dist[2] + s.dist[3] + s.dist[4] + s.dist[5];
  const h3 = s.dist[3] + s.dist[4] + s.dist[5];
  const prRate = s.proches ? ((s.exacts + s.proches) / (s.tests * 5) * 100).toFixed(1) : "—";
  console.log(name.padEnd(20) + "| Taux: " + rate.padStart(6) + "% | Moy: " + avg + "/tir | 2+: " + h2 + " | 3+: " + h3 + " | +proches: " + prRate + "%");
  console.log(" ".repeat(20) + "| 0=" + s.dist[0] + " 1=" + s.dist[1] + " 2=" + s.dist[2] + " 3=" + s.dist[3] + " 4=" + s.dist[4] + " 5=" + s.dist[5]);
}

console.log("=== COMPARAISON DIRECTE ===\n");
showStats("BOT v4 (nouveau)", v4Stats);
console.log("");
showStats("BOT v3 (ancien)", v3Stats);
console.log("");
showStats("HASARD", hasStats);

const v4r = v4Stats.exacts / (v4Stats.tests * 5);
const v3r = v3Stats.exacts / (v3Stats.tests * 5);
const hr = hasStats.exacts / (hasStats.tests * 5);

console.log("\n=== GAINS ===\n");
console.log("  v4 vs Hasard:  x" + (v4r / hr).toFixed(3) + " (+" + ((v4r / hr - 1) * 100).toFixed(1) + "%)");
console.log("  v4 vs v3:      x" + (v4r / v3r).toFixed(3) + " (+" + ((v4r / v3r - 1) * 100).toFixed(1) + "%)");
console.log("  v3 vs Hasard:  x" + (v3r / hr).toFixed(3) + " (+" + ((v3r / hr - 1) * 100).toFixed(1) + "%)");

console.log("\n=== PROGRESSION PAR BLOC (v4 apprend) ===\n");
for (const p of phases) {
  if (p.t === 0) continue;
  const v4t = (p.v4e / (p.t * 5) * 100).toFixed(1);
  console.log(p.label.padEnd(25) + "v4: " + v4t + "%  (" + p.t + " tirages)");
}

console.log("\n=== POIDS FINAUX v4 (appris) ===\n");
const sorted = Object.entries(v4W).sort((a, b) => b[1] - a[1]);
for (const [k, v] of sorted) {
  const init = DEFAULT_WEIGHTS[k] || 10;
  const delta = v - init;
  const bar = "#".repeat(Math.round(v));
  console.log("  " + k.padEnd(16) + v.toFixed(1).padStart(6) + " (" + (delta >= 0 ? "+" : "") + delta.toFixed(1) + ")  " + bar);
}

console.log("\n=== MEILLEURS COUPS v4 ===\n");
bestHits.sort((a, b) => b.exacts - a.exacts);
for (const h of bestHits.slice(0, 15)) {
  const m = h.predit.filter(n => h.reel.includes(n));
  console.log("  " + h.date + " " + h.type.padEnd(20) + ": " + h.exacts + " exacts [" + m.join(",") + "]");
}
const h3 = bestHits.filter(h => h.exacts >= 3);
console.log("\n  Total 2+: " + bestHits.length + "/" + totalTests + " (" + (bestHits.length / totalTests * 100).toFixed(1) + "%)");
if (h3.length > 0) console.log("  Total 3+: " + h3.length + " !!!");

console.log("\n=== VERDICT ===\n");
if (v4r > v3r) {
  console.log("  v4 GAGNE vs v3: +" + ((v4r / v3r - 1) * 100).toFixed(1) + "% d'amelioration");
} else if (v4r === v3r) {
  console.log("  v4 = v3 (egal)");
} else {
  console.log("  v3 reste meilleur sur cette periode (+" + ((v3r / v4r - 1) * 100).toFixed(1) + "%)");
}
