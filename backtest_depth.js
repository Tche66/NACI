// Backtest SUPER COMBO avec differentes profondeurs d'entrainement (6m a 5 ans)
const { loadDB } = require("./db");
const {
  computeCriteriaTops, convergenceScore, walkForwardLearn,
  DEFAULT_WEIGHTS, DRAW_CATEGORIES, getCategoryForType,
} = require("./apprentissage");

const db = loadDB();
const sorted = [...db.draws].reverse();
console.log("Base:", sorted.length, "tirages,", sorted[0]?.date, "a", sorted[sorted.length - 1]?.date);

function parseDate(s) {
  const p = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return p ? new Date(parseInt(p[3]), parseInt(p[2]) - 1, parseInt(p[1])) : new Date(0);
}

function ajuster(nums, ranked) {
  let att = [...nums];
  for (let iter = 0; iter < 20; iter++) {
    const s = att.reduce((a, b) => a + b, 0);
    const p = att.filter(n => n % 2 === 0).length;
    const h = att.filter(n => n > 45).length;
    if (s >= 160 && s <= 290 && p >= 1 && p <= 4 && h >= 1 && h <= 4) return att.sort((a, b) => a - b);
    let idx, cond;
    if (s < 160) { idx = att.indexOf(Math.min(...att)); cond = r => r.num > att[idx] && !att.includes(r.num); }
    else if (s > 290) { idx = att.indexOf(Math.max(...att)); cond = r => r.num < att[idx] && !att.includes(r.num); }
    else if (p < 1) { idx = att.findIndex(n => n % 2 === 1); cond = r => r.num % 2 === 0 && !att.includes(r.num); }
    else if (p > 4) { idx = att.findIndex(n => n % 2 === 0); cond = r => r.num % 2 === 1 && !att.includes(r.num); }
    else if (h < 1) { idx = att.findIndex(n => n <= 45); cond = r => r.num > 45 && !att.includes(r.num); }
    else if (h > 4) { idx = att.findIndex(n => n > 45); cond = r => r.num <= 45 && !att.includes(r.num); }
    else break;
    if (idx < 0) idx = att.length - 1;
    const rep = ranked.find(cond);
    if (rep) att[idx] = rep.num; else break;
  }
  return att.sort((a, b) => a - b);
}

function runTest(trainMonths, testMonths) {
  const lastDate = parseDate(sorted[sorted.length - 1].date);
  const testStart = new Date(lastDate);
  testStart.setMonth(testStart.getMonth() - testMonths);

  let startIdx = sorted.findIndex(d => parseDate(d.date) >= testStart);
  if (startIdx < 100) startIdx = 100;

  const trainCutoff = new Date(testStart);
  trainCutoff.setMonth(trainCutoff.getMonth() - trainMonths);

  const trainData = sorted.filter(d => {
    const dt = parseDate(d.date);
    return dt >= trainCutoff && dt < testStart;
  }).reverse();

  let globalW = { ...DEFAULT_WEIGHTS };
  let catW = {};
  if (trainData.length >= 200) {
    globalW = walkForwardLearn(trainData, Math.min(300, Math.floor(trainData.length / 4)), 5, globalW);
    for (const [cat, types] of Object.entries(DRAW_CATEGORIES)) {
      const cd = trainData.filter(d => types.includes(d.type));
      if (cd.length >= 100) catW[cat] = walkForwardLearn(cd, Math.min(100, Math.floor(cd.length / 3)), 3, { ...globalW });
    }
  }

  let comboPerf = { CONV: 1.0, EQ: 1.0, COND: 1.0, MARKOV: 1.0, JOUR: 1.0 };
  const COMBO_KEYS = ["CONV", "EQ", "COND", "MARKOV", "JOUR"];

  const res = { t: 0, h: 0, h0: 0, h1: 0, h2: 0, h3: 0, trainSize: trainData.length };
  const resSingle = { t: 0, h: 0, h0: 0, h1: 0, h2: 0, h3: 0 };
  const byMonth = {};
  let learnBatch = 0;

  for (let i = startIdx; i < sorted.length; i++) {
    const target = sorted[i];
    const hist = sorted.slice(0, i).reverse();
    const filtered = hist.filter(d => d.type === target.type);
    if (filtered.length < 20) continue;

    const jour = parseDate(target.date).getDay();
    const cat = getCategoryForType(target.type);
    const w = catW[cat] || globalW;
    const tops = computeCriteriaTops(filtered, hist, 15, jour);
    if (!tops) continue;

    const ranked = convergenceScore(tops, w);
    const real = new Set(target.gagnants);

    const combos = {};
    combos.CONV = ajuster(ranked.slice(0, 5).map(r => r.num), ranked);
    const imps = ranked.filter(r => r.num % 2 === 1);
    const prs = ranked.filter(r => r.num % 2 === 0);
    combos.EQ = ajuster([...prs.slice(0, 2).map(r => r.num), ...imps.slice(0, 3).map(r => r.num)], ranked);
    const condC = ranked.filter(r => r.votes >= 2 && r.criteria.includes("conditionnel")).slice(0, 7);
    combos.COND = condC.length >= 5 ? ajuster(condC.slice(0, 5).map(r => r.num), ranked) : combos.CONV;
    const mkC = ranked.filter(r => r.votes >= 2 && r.criteria.includes("markov2")).slice(0, 7);
    combos.MARKOV = mkC.length >= 5 ? ajuster(mkC.slice(0, 5).map(r => r.num), ranked) : combos.CONV;
    const jrC = ranked.filter(r => r.votes >= 2 && r.criteria.includes("jourAffinity")).slice(0, 7);
    combos.JOUR = jrC.length >= 5 ? ajuster(jrC.slice(0, 5).map(r => r.num), ranked) : combos.CONV;

    const numScore = {};
    for (const key of COMBO_KEYS) {
      const perf = comboPerf[key];
      for (let rank = 0; rank < combos[key].length; rank++) {
        const n = combos[key][rank];
        numScore[n] = (numScore[n] || 0) + perf * (1.2 - rank * 0.1);
      }
    }
    const superNums = ajuster(
      Object.entries(numScore).map(([n, s]) => ({ num: parseInt(n), score: s }))
        .sort((a, b) => b.score - a.score).slice(0, 5).map(c => c.num),
      ranked
    );

    const hSuper = superNums.filter(n => real.has(n)).length;
    res.t++; res.h += hSuper; res["h" + Math.min(hSuper, 3)]++;

    const hSingle = combos.CONV.filter(n => real.has(n)).length;
    resSingle.t++; resSingle.h += hSingle; resSingle["h" + Math.min(hSingle, 3)]++;

    const td = parseDate(target.date);
    const mk = String(td.getMonth() + 1).padStart(2, "0") + "/" + td.getFullYear();
    if (!byMonth[mk]) byMonth[mk] = { t: 0, h: 0 };
    byMonth[mk].t++; byMonth[mk].h += hSuper;

    for (const key of COMBO_KEYS) {
      const ch = combos[key].filter(n => real.has(n)).length;
      if (ch > 0) comboPerf[key] = Math.min(2.0, comboPerf[key] * 0.95 + 0.1);
      else comboPerf[key] = Math.max(0.3, comboPerf[key] * 0.97 - 0.01);
    }

    for (const n of target.gagnants) {
      for (const [critere, topList] of Object.entries(tops)) {
        if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
        if (globalW[critere] !== undefined) {
          if (topList.includes(n)) globalW[critere] = Math.min(30, globalW[critere] + 0.15);
          else globalW[critere] = Math.max(3, globalW[critere] - 0.03);
        }
        if (catW[cat] && catW[cat][critere] !== undefined) {
          if (topList.includes(n)) catW[cat][critere] = Math.min(30, catW[cat][critere] + 0.2);
          else catW[cat][critere] = Math.max(3, catW[cat][critere] - 0.04);
        }
      }
    }

    learnBatch++;
    if (learnBatch >= 100) {
      const recent = sorted.slice(Math.max(0, i - 2000), i).reverse();
      if (recent.length >= 300) {
        globalW = walkForwardLearn(recent, 300, 4, globalW);
        for (const [c2, types] of Object.entries(DRAW_CATEGORIES)) {
          const cr = recent.filter(d => types.includes(d.type));
          if (cr.length >= 100) catW[c2] = walkForwardLearn(cr, Math.min(100, Math.floor(cr.length / 3)), 3, catW[c2] || globalW);
        }
      }
      learnBatch = 0;
    }
  }

  return { super: res, single: resSingle, comboPerf: { ...comboPerf }, byMonth };
}

const configs = [
  { train: 6, test: 6, label: "Train 6m" },
  { train: 12, test: 6, label: "Train 12m (1 an)" },
  { train: 24, test: 6, label: "Train 24m (2 ans)" },
  { train: 36, test: 6, label: "Train 36m (3 ans)" },
  { train: 48, test: 6, label: "Train 48m (4 ans)" },
  { train: 60, test: 6, label: "Train 60m (5 ans)" },
];

const eR = 5 * 5 / 90;
console.log("");
console.log("=".repeat(75));
console.log("  SUPER COMBO + AUTO-LEARN — BACKTEST (test 6 derniers mois)");
console.log("=".repeat(75));
console.log("");
console.log("  " + "Config".padEnd(26) + "Train".padStart(6) + "   Avg".padStart(7) + "   Lift".padStart(7) + "  >=1%".padStart(7) + "  >=2%".padStart(7) + "  2+cnt".padStart(7));
console.log("  " + "-".repeat(70));

const allR = [];
for (const cfg of configs) {
  process.stderr.write("  " + cfg.label + "... ");
  const r = runTest(cfg.train, cfg.test);
  const s = r.super;
  const avg = (s.h / s.t).toFixed(3);
  const lift = (s.h / s.t / eR).toFixed(2);
  const p1 = ((1 - s.h0 / s.t) * 100).toFixed(1);
  const p2 = ((s.h2 + s.h3) / s.t * 100).toFixed(1);
  console.log("  " + cfg.label.padEnd(26) + String(s.trainSize).padStart(6) + avg.padStart(7) + ("x" + lift).padStart(7) + (p1 + "%").padStart(7) + (p2 + "%").padStart(7) + String(s.h2 + s.h3).padStart(7));
  allR.push({ ...cfg, r });
  process.stderr.write("OK\n");
}

console.log("  " + "HASARD".padEnd(26) + "     -" + "  0.278" + "  x1.00" + " 25.4%" + "  2.3%" + "      -");

console.log("");
console.log("  CONVERGENCE seul (comparaison):");
console.log("  " + "Config".padEnd(26) + "   Avg".padStart(7) + "   Lift".padStart(7) + "  >=2%".padStart(7) + "  2+cnt".padStart(7));
console.log("  " + "-".repeat(54));
for (const a of allR) {
  const s = a.r.single;
  const avg = (s.h / s.t).toFixed(3);
  const lift = (s.h / s.t / eR).toFixed(2);
  const p2 = ((s.h2 + s.h3) / s.t * 100).toFixed(1);
  console.log("  " + a.label.padEnd(26) + avg.padStart(7) + ("x" + lift).padStart(7) + (p2 + "%").padStart(7) + String(s.h2 + s.h3).padStart(7));
}

console.log("");
console.log("  Poids combo finaux:");
for (const a of allR) {
  const cp = a.r.comboPerf;
  const s = Object.entries(cp).sort((a, b) => b[1] - a[1]);
  console.log("  " + a.label.padEnd(26) + s.map(([k, v]) => k + "=" + v.toFixed(2)).join(", "));
}

console.log("");
console.log("  Evolution mensuelle (meilleur config):");
const bestIdx = allR.reduce((bi, r, i) => (r.r.super.h / r.r.super.t) > (allR[bi].r.super.h / allR[bi].r.super.t) ? i : bi, 0);
const best = allR[bestIdx];
console.log("  -> " + best.label);
for (const [m, s] of Object.entries(best.r.byMonth).sort()) {
  const avg = (s.h / s.t).toFixed(3);
  console.log("    " + m + ": " + s.t + " pred, avg=" + avg);
}
