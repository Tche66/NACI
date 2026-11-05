// ═══════════════════════════════════════════════════════════════════
//  BACKTEST SEQUENTIEL REALISTE v5
//  Simule le bot en temps reel: predire → comparer → apprendre → suivant
//  Teste differentes profondeurs d'entrainement (6, 12, 18, 24 mois)
// ═══════════════════════════════════════════════════════════════════

const { loadDB } = require("./db");
const {
  computeCriteriaTops, convergenceScore,
  walkForwardLearn, DEFAULT_WEIGHTS, DRAW_CATEGORIES, getCategoryForType,
} = require("./apprentissage");

const NUM_RANGE = 90;

function runSequentialBacktest(allDraws, testMonths, trainMonths) {
  const sorted = [...allDraws].reverse();

  const lastDate = parseDate(sorted[sorted.length - 1].date);
  const testStart = new Date(lastDate);
  testStart.setMonth(testStart.getMonth() - testMonths);

  let testStartIdx = sorted.findIndex(d => parseDate(d.date) >= testStart);
  if (testStartIdx < 100) testStartIdx = 100;

  const results = {
    trainMonths, testMonths,
    totalPredictions: 0, totalHits: 0,
    hits0: 0, hits1: 0, hits2: 0, hits3: 0, hits4: 0, hits5: 0,
    byCategory: {}, byMonth: {},
    weightEvolution: [], learningCurve: [],
  };

  const trainCutoff = new Date(testStart);
  trainCutoff.setMonth(trainCutoff.getMonth() - trainMonths);

  let trainData = sorted.filter(d => {
    const dt = parseDate(d.date);
    return dt >= trainCutoff && dt < testStart;
  });

  let globalWeights = { ...DEFAULT_WEIGHTS };
  let categoryWeights = {};

  if (trainData.length >= 200) {
    globalWeights = walkForwardLearn(trainData.reverse(), 200, 4, globalWeights);
    for (const [cat, types] of Object.entries(DRAW_CATEGORIES)) {
      const catData = trainData.filter(d => types.includes(d.type));
      if (catData.length >= 100) {
        categoryWeights[cat] = walkForwardLearn(catData, Math.min(100, Math.floor(catData.length / 3)), 3, { ...globalWeights });
      }
    }
    trainData.reverse();
  }

  results.weightEvolution.push({ phase: "initial", trainSize: trainData.length, weights: { ...globalWeights } });

  let learnBatch = 0;
  const LEARN_EVERY = 50;
  let batchHits = 0, batchTotal = 0;

  for (let i = testStartIdx; i < sorted.length; i++) {
    const target = sorted[i];
    const targetDate = parseDate(target.date);
    const historyForPred = sorted.slice(0, i).reverse();
    const filtered = historyForPred.filter(d => d.type === target.type);
    if (filtered.length < 20) continue;

    const jour = targetDate.getDay();
    const cat = getCategoryForType(target.type);
    const weights = categoryWeights[cat] || globalWeights;
    const tops = computeCriteriaTops(filtered, historyForPred, 15, jour);
    if (!tops) continue;

    const ranked = convergenceScore(tops, weights);
    const predicted = ranked.slice(0, 5).map(r => r.num);
    const realNums = target.gagnants;
    const hits = predicted.filter(n => realNums.includes(n)).length;

    results.totalPredictions++;
    results.totalHits += hits;
    results[`hits${hits}`]++;
    batchHits += hits;
    batchTotal += 5;

    if (!results.byCategory[cat]) results.byCategory[cat] = { total: 0, hits: 0, h0: 0, h1: 0, h2: 0, h3: 0 };
    results.byCategory[cat].total++;
    results.byCategory[cat].hits += hits;
    results.byCategory[cat][`h${Math.min(hits, 3)}`]++;

    const monthKey = `${String(targetDate.getMonth() + 1).padStart(2, "0")}/${targetDate.getFullYear()}`;
    if (!results.byMonth[monthKey]) results.byMonth[monthKey] = { total: 0, hits: 0 };
    results.byMonth[monthKey].total++;
    results.byMonth[monthKey].hits += hits;

    for (const n of realNums) {
      for (const [critere, topList] of Object.entries(tops)) {
        if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
        if (globalWeights[critere] !== undefined) {
          if (topList.includes(n)) globalWeights[critere] = Math.min(30, globalWeights[critere] + 0.15);
          else globalWeights[critere] = Math.max(3, globalWeights[critere] - 0.03);
        }
        if (categoryWeights[cat] && categoryWeights[cat][critere] !== undefined) {
          if (topList.includes(n)) categoryWeights[cat][critere] = Math.min(30, categoryWeights[cat][critere] + 0.2);
          else categoryWeights[cat][critere] = Math.max(3, categoryWeights[cat][critere] - 0.04);
        }
      }
    }

    learnBatch++;
    if (learnBatch >= LEARN_EVERY) {
      const recentForTrain = sorted.slice(Math.max(0, i - 1500), i).reverse();
      if (recentForTrain.length >= 200) {
        globalWeights = walkForwardLearn(recentForTrain, 200, 4, globalWeights);
        for (const [c2, types] of Object.entries(DRAW_CATEGORIES)) {
          const catRecent = recentForTrain.filter(d => types.includes(d.type));
          if (catRecent.length >= 80) {
            categoryWeights[c2] = walkForwardLearn(catRecent, Math.min(80, Math.floor(catRecent.length / 3)), 3, categoryWeights[c2] || globalWeights);
          }
        }
      }
      results.learningCurve.push({
        afterNPreds: results.totalPredictions,
        batchHitRate: +(batchHits / batchTotal * 100).toFixed(2),
        cumulHitRate: +(results.totalHits / (results.totalPredictions * 5) * 100).toFixed(2),
        globalAvg: +(results.totalHits / results.totalPredictions).toFixed(3),
      });
      learnBatch = 0;
      batchHits = 0;
      batchTotal = 0;
    }
  }

  results.avgHitsPerPred = +(results.totalHits / results.totalPredictions).toFixed(3);
  results.hitRate = +(results.totalHits / (results.totalPredictions * 5) * 100).toFixed(2);
  results.eRandom = +(5 * 5 / 90 * 100).toFixed(2);
  results.lift = +(results.avgHitsPerPred / (5 * 5 / 90)).toFixed(2);
  results.pct1plus = +((1 - results.hits0 / results.totalPredictions) * 100).toFixed(1);
  results.pct2plus = +(((results.hits2 + results.hits3 + results.hits4 + results.hits5) / results.totalPredictions) * 100).toFixed(1);
  results.finalWeights = globalWeights;
  results.finalCategoryWeights = categoryWeights;
  return results;
}

function parseDate(dateStr) {
  const p = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!p) return new Date(0);
  return new Date(parseInt(p[3]), parseInt(p[2]) - 1, parseInt(p[1]));
}

function printResults(r, label) {
  console.log("");
  console.log("=".repeat(60));
  console.log("  " + label);
  console.log("  Train: " + r.trainMonths + " mois | Test: " + r.testMonths + " mois | " + r.totalPredictions + " predictions");
  console.log("=".repeat(60));
  console.log("");
  console.log("  Moyenne:      " + r.avgHitsPerPred + " exacts/prediction");
  console.log("  Hit rate:     " + r.hitRate + "% (hasard: " + r.eRandom + "%)");
  console.log("  LIFT:         x" + r.lift);
  console.log("  P(>=1 exact): " + r.pct1plus + "%");
  console.log("  P(>=2 exact): " + r.pct2plus + "%");
  console.log("");
  console.log("  Distribution:");
  console.log("    0 exact: " + r.hits0 + " (" + (r.hits0 / r.totalPredictions * 100).toFixed(1) + "%)");
  console.log("    1 exact: " + r.hits1 + " (" + (r.hits1 / r.totalPredictions * 100).toFixed(1) + "%)");
  console.log("    2 exact: " + r.hits2 + " (" + (r.hits2 / r.totalPredictions * 100).toFixed(1) + "%)");
  console.log("    3 exact: " + r.hits3 + " (" + (r.hits3 / r.totalPredictions * 100).toFixed(1) + "%)");
  if (r.hits4) console.log("    4 exact: " + r.hits4);
  if (r.hits5) console.log("    5 exact: " + r.hits5);
  console.log("");
  console.log("  Par categorie:");
  for (const [cat, s] of Object.entries(r.byCategory).sort((a, b) => (b[1].hits / b[1].total) - (a[1].hits / a[1].total))) {
    const avg = (s.hits / s.total).toFixed(3);
    const lift = (s.hits / s.total / (5 * 5 / 90)).toFixed(2);
    console.log("    " + cat.padEnd(12) + ": " + s.total + " pred, avg=" + avg + ", lift=x" + lift + ", 2+: " + (s.h2 + s.h3));
  }
  console.log("");
  console.log("  Par mois:");
  for (const [m, s] of Object.entries(r.byMonth).sort()) {
    const avg = (s.hits / s.total).toFixed(3);
    console.log("    " + m + ": " + s.total + " pred, avg=" + avg + ", hits=" + s.hits);
  }
  if (r.learningCurve.length > 0) {
    console.log("");
    console.log("  Courbe d'apprentissage:");
    for (const p of r.learningCurve) {
      console.log("    apres " + String(p.afterNPreds).padStart(5) + " pred: batch=" + p.batchHitRate + "%, cumul=" + p.cumulHitRate + "%, avg=" + p.globalAvg);
    }
  }
}

// ═══ MAIN ═══
const db = loadDB();
const allDraws = db.draws;

console.log("BACKTEST SEQUENTIEL REALISTE — Simule le bot en temps reel");
console.log("Base: " + allDraws.length + " tirages, " + allDraws[allDraws.length - 1]?.date + " a " + allDraws[0]?.date);

const configs = [
  { trainMonths: 6, testMonths: 6, label: "TRAIN 6 MOIS" },
  { trainMonths: 12, testMonths: 6, label: "TRAIN 12 MOIS" },
  { trainMonths: 18, testMonths: 6, label: "TRAIN 18 MOIS" },
];

const allResults = [];
for (const cfg of configs) {
  process.stdout.write("\nRunning: " + cfg.label + "...");
  const r = runSequentialBacktest(allDraws, cfg.testMonths, cfg.trainMonths);
  allResults.push({ ...r, label: cfg.label });
  console.log(" DONE");
  printResults(r, cfg.label);
}

console.log("");
console.log("=".repeat(60));
console.log("  COMPARAISON FINALE");
console.log("=".repeat(60));
console.log("");
console.log("  " + "Config".padEnd(22) + "Avg".padStart(7) + "Lift".padStart(7) + ">=1".padStart(7) + ">=2".padStart(7) + "HitRate".padStart(8));
console.log("  " + "-".repeat(58));
for (const r of allResults) {
  const name = r.label;
  console.log("  " + name.padEnd(22) + r.avgHitsPerPred.toString().padStart(7) + ("x" + r.lift).padStart(7) + (r.pct1plus + "%").padStart(7) + (r.pct2plus + "%").padStart(7) + (r.hitRate + "%").padStart(8));
}
console.log("  " + "HASARD".padEnd(22) + "0.278".padStart(7) + "x1.00".padStart(7) + "25.4%".padStart(7) + " 2.3%".padStart(7) + " 5.56%".padStart(8));
