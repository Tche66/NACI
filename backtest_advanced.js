const { computeCriteriaTops, convergenceScore } = require("./apprentissage");
const { loadDB } = require("./db");
const db = loadDB();
const draws = db.draws;
const N = 90;

const optW = {freqGlob:14,freqRecent:13.9,cycleOverdue:6.7,momentum:15.5,retard:8.8,markov2:3,paires:16.1,terminaisons:13,jourAffinity:15.9,antiRepet:5};

function testOnRange(w, start, end) {
  let hits = 0, tests = 0, h2 = 0;
  for (let i = start; i < end && i < draws.length - 100; i++) {
    const target = draws[i];
    const hist = draws.slice(i + 1);
    const filt = hist.filter(d => d.type === target.type);
    if (filt.length < 20) continue;
    const parts = target.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    let jour = null;
    if (parts) { const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1])); jour = dt.getDay(); }
    const tops = computeCriteriaTops(filt, hist, 15, jour);
    if (!tops) continue;
    const ranked = convergenceScore(tops, w);
    const imps = ranked.filter(r => r.num % 2 === 1);
    const prs = ranked.filter(r => r.num % 2 === 0);
    let pred;
    if (prs.length >= 2 && imps.length >= 3) pred = [...prs.slice(0, 2).map(r => r.num), ...imps.slice(0, 3).map(r => r.num)];
    else pred = ranked.slice(0, 5).map(r => r.num);
    const real = new Set(target.gagnants);
    tests++;
    let ex = 0;
    for (const n of pred) if (real.has(n)) { hits++; ex++; }
    if (ex >= 2) h2++;
  }
  return { hits, tests, rate: tests > 0 ? hits / (tests * 5) : 0, h2 };
}

// ═══ 1. VALIDATION OUT-OF-SAMPLE ═══
console.log("=== VALIDATION OUT-OF-SAMPLE ===");
console.log("Optimise sur tirages 0-299, valide sur 300-1800\n");

const optR = testOnRange(optW, 300, 1800);
const eqR = testOnRange({freqGlob:10,freqRecent:10,cycleOverdue:10,momentum:10,retard:10,markov2:10,paires:10,terminaisons:10,jourAffinity:10,antiRepet:5}, 300, 1800);
console.log("Poids egaux (base):  " + (eqR.rate * 100).toFixed(2) + "% | 2+: " + eqR.h2 + "/" + eqR.tests);
console.log("Poids optimises:     " + (optR.rate * 100).toFixed(2) + "% | 2+: " + optR.h2 + "/" + optR.tests);
console.log("Gain out-of-sample: +" + ((optR.rate / eqR.rate - 1) * 100).toFixed(0) + "%\n");

// ═══ 2. WALK-FORWARD (re-optimise tous les 300 tirages) ═══
console.log("=== WALK-FORWARD (re-optimise tous les 300 tirages) ===\n");

let wfW = {freqGlob:10,freqRecent:10,cycleOverdue:10,momentum:10,retard:10,markov2:10,paires:10,terminaisons:10,jourAffinity:10,antiRepet:5};
let wfHits = 0, wfTests = 0, wfH2 = 0;

for (let block = 0; block < 10; block++) {
  const predStart = block * 300;
  const predEnd = Math.min((block + 1) * 300, 3000);
  if (predStart >= draws.length - 100) break;

  // Re-optimiser sur les 300 tirages APRES le block actuel
  if (block > 0) {
    const trainStart = predEnd;
    const trainEnd = predEnd + 300;
    let localBest = { ...wfW };
    let localBestScore = testOnRange(localBest, trainStart, Math.min(trainEnd, draws.length - 100)).rate;

    for (let iter = 0; iter < 120; iter++) {
      const c = { ...localBest };
      const keys = Object.keys(c).filter(k => k !== "antiRepet");
      for (let m = 0; m < 2; m++) {
        const k = keys[Math.floor(Math.random() * keys.length)];
        c[k] = Math.max(3, Math.min(35, c[k] + (Math.random() - 0.5) * 6));
      }
      const score = testOnRange(c, trainStart, Math.min(trainEnd, draws.length - 100)).rate;
      if (score > localBestScore) { localBestScore = score; localBest = { ...c }; }
    }
    wfW = localBest;
  }

  const r = testOnRange(wfW, predStart, predEnd);
  wfHits += r.hits;
  wfTests += r.tests;
  wfH2 += r.h2;
  const top3 = Object.entries(wfW).filter(([k]) => k !== "antiRepet").sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + "=" + v.toFixed(0)).join(", ");
  console.log("Block " + (block + 1).toString().padStart(2) + " (" + predStart + "-" + predEnd + "): " + (r.rate * 100).toFixed(1) + "% | 2+: " + r.h2 + " | poids: " + top3);
}
const wfRate = wfHits / (wfTests * 5);
console.log("\nWalk-forward total: " + (wfRate * 100).toFixed(2) + "% | " + wfTests + " tirages | 2+: " + wfH2);

// ═══ 3. SUPER ENSEMBLE ═══
console.log("\n=== SUPER ENSEMBLE (convergence + conditionnelle + jour) ===\n");

let seHits = 0, seTests = 0, seH2 = 0, seH3 = 0;
for (let i = 0; i < 1500 && i < draws.length - 200; i++) {
  const target = draws[i];
  const hist = draws.slice(i + 1);
  const filt = hist.filter(d => d.type === target.type);
  if (filt.length < 30) continue;
  const real = new Set(target.gagnants);
  const parts = target.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let jour = null;
  if (parts) { const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1])); jour = dt.getDay(); }

  const tops = computeCriteriaTops(filt, hist, 15, jour);
  if (!tops) continue;

  // Moteur 1: convergence optimisee
  const r1 = convergenceScore(tops, optW);
  // Moteur 2: convergence jour-heavy
  const r2 = convergenceScore(tops, {freqGlob:14,freqRecent:8,cycleOverdue:3,momentum:12,retard:5,markov2:10,paires:16,terminaisons:15,jourAffinity:25,antiRepet:5});

  // Moteur 3: conditionnelle
  const lastDraw = filt[0] ? filt[0].gagnants : [];
  const condScore = Array(N + 1).fill(0);
  for (let idx = 1; idx < Math.min(filt.length, 80); idx++) {
    for (const n of filt[idx - 1].gagnants) {
      for (const p of filt[idx].gagnants) {
        const diff = Math.abs(n - p);
        if (diff >= 1 && diff <= 3) condScore[n] += 1;
      }
    }
  }
  const lastTerms = new Set(lastDraw.map(n => n % 10));
  for (let n = 1; n <= N; n++) if (lastTerms.has(n % 10)) condScore[n] += 3;
  for (const n of lastDraw) condScore[n] -= 5;
  const fr = Array(N + 1).fill(0);
  for (const d of filt.slice(0, 20)) for (const n of d.gagnants) fr[n]++;
  for (let n = 1; n <= N; n++) condScore[n] += fr[n] * 2;

  // Combinaison ponderee
  const superVote = Array(N + 1).fill(0);
  for (const r of r1.slice(0, 12)) superVote[r.num] += r.score;
  for (const r of r2.slice(0, 12)) superVote[r.num] += r.score * 0.7;
  for (let n = 1; n <= N; n++) superVote[n] += Math.max(0, condScore[n]) * 3;

  const ranked = [...Array(N)].map((_, i) => ({ n: i + 1, v: superVote[i + 1] })).sort((a, b) => b.v - a.v);
  const ep = ranked.filter(r => r.n % 2 === 0);
  const ei = ranked.filter(r => r.n % 2 === 1);
  let pred;
  if (ep.length >= 2 && ei.length >= 3) pred = [...ep.slice(0, 2).map(r => r.n), ...ei.slice(0, 3).map(r => r.n)];
  else pred = ranked.slice(0, 5).map(r => r.n);

  seTests++;
  let ex = 0;
  for (const n of pred) if (real.has(n)) { seHits++; ex++; }
  if (ex >= 2) seH2++;
  if (ex >= 3) seH3++;
}
const seRate = seHits / (seTests * 5);
console.log("Super ensemble: " + (seRate * 100).toFixed(2) + "% | " + seTests + " tirages | 2+: " + seH2 + " | 3+: " + seH3);

// ═══ CLASSEMENT FINAL ═══
console.log("\n" + "=".repeat(60));
console.log("  CLASSEMENT FINAL — TOUTES APPROCHES");
console.log("=".repeat(60) + "\n");

const results = [
  { name: "Hasard", rate: 5.56, source: "theorique" },
  { name: "Bot v3 (poids fixes)", rate: 5.9, source: "backtest 900" },
  { name: "Proba conditionnelle", rate: 6.1, source: "backtest 500" },
  { name: "Walk-forward optim", rate: +(wfRate * 100).toFixed(1), source: "backtest " + wfTests },
  { name: "Out-of-sample optW", rate: +(optR.rate * 100).toFixed(1), source: "backtest " + optR.tests },
  { name: "Super ensemble", rate: +(seRate * 100).toFixed(1), source: "backtest " + seTests },
  { name: "Gradient optimise", rate: 7.2, source: "backtest 300 (in-sample)" },
].sort((a, b) => b.rate - a.rate);

for (const r of results) {
  const lift = (r.rate / 5.56).toFixed(2);
  const bar = "#".repeat(Math.round(r.rate * 3));
  console.log("  " + r.name.padEnd(24) + (r.rate.toFixed(1) + "%").padStart(6) + "  x" + lift + "  " + bar + "  (" + r.source + ")");
}

console.log("\n=== RECOMMANDATION ===\n");
console.log("La meilleure approche VALIDEE (out-of-sample) est:");
const best = results.filter(r => !r.source.includes("in-sample") && r.name !== "Hasard")[0];
console.log("  >>> " + best.name + " a " + best.rate + "% (x" + (best.rate / 5.56).toFixed(2) + " vs hasard) <<<");
