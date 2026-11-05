// ═══════════════════════════════════════════════════════════
//  MOTEUR D'APPRENTISSAGE v4 — WALK-FORWARD + CONDITIONNEL
//  Poids issus du backtest 12 mois (3575 tirages)
//  Integre: convergence, proba conditionnelle, walk-forward
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const { loadDB } = require("./db");

const NUM_RANGE = 90;
const LEARN_PATH = path.join(__dirname, "apprentissage_state.json");

// Poids appris par backtest 24 mois (5429 tirages avec apprentissage continu)
// 5 criteres dominants: jourAffinity, freqGlob, markov2, paires, terminaisons
const DEFAULT_WEIGHTS = {
  jourAffinity: 29.5, freqGlob: 29.2, markov2: 29.2, paires: 29.0,
  terminaisons: 28.0, conditionnel: 21.1, retard: 7.5, antiRepet: 7.0,
  freqRecent: 6.9, momentum: 6.1, cycleOverdue: 3.4,
};

function loadLearnState() {
  if (!fs.existsSync(LEARN_PATH)) return {
    criteriaWeights: { ...DEFAULT_WEIGHTS },
    topNPerCriteria: 15,
    lastBacktest: null,
    backtestHistory: [],
    version: 4,
  };
  const state = JSON.parse(fs.readFileSync(LEARN_PATH, "utf8"));
  if (!state.version || state.version < 4) {
    state.criteriaWeights = { ...DEFAULT_WEIGHTS };
    state.version = 4;
    state.backtestHistory = state.backtestHistory || [];
    saveLearnState(state);
  }
  return state;
}

function saveLearnState(state) {
  fs.writeFileSync(LEARN_PATH, JSON.stringify(state, null, 2), "utf8");
}

// ═══ CRITERES DE SCORING INDEPENDANTS ═══
function computeCriteriaTops(filtered, allDraws, topN, jourSemaine) {
  if (filtered.length < 20) return null;

  const freq = Array(NUM_RANGE + 1).fill(0);
  const freqR = Array(NUM_RANGE + 1).fill(0);
  const lastSeen = Array(NUM_RANGE + 1).fill(filtered.length);
  const mom = Array(NUM_RANGE + 1).fill(0);

  for (const d of filtered) for (const n of d.gagnants) freq[n]++;
  for (const d of filtered.slice(0, 30)) for (const n of d.gagnants) freqR[n]++;
  for (let idx = 0; idx < filtered.length; idx++)
    for (const n of filtered[idx].gagnants) if (lastSeen[n] === filtered.length) lastSeen[n] = idx;
  for (const d of filtered.slice(0, 15)) for (const n of d.gagnants) mom[n]++;

  // Cycles
  const positions = {};
  for (let i = 1; i <= NUM_RANGE; i++) positions[i] = [];
  for (let idx = 0; idx < filtered.length; idx++)
    for (const n of filtered[idx].gagnants) positions[n].push(idx);
  const overdueRatio = Array(NUM_RANGE + 1).fill(0);
  for (let i = 1; i <= NUM_RANGE; i++) {
    const gaps = [];
    for (let j = 1; j < positions[i].length; j++) gaps.push(positions[i][j] - positions[i][j - 1]);
    if (gaps.length >= 3) {
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      overdueRatio[i] = lastSeen[i] / avg;
    }
  }

  // Markov ordre 2
  const markov = Array(NUM_RANGE + 1).fill(0);
  if (filtered.length > 2) {
    const l1 = new Set(filtered[0].gagnants);
    const l2 = new Set(filtered[1].gagnants);
    for (let idx = 2; idx < filtered.length; idx++) {
      const m1 = filtered[idx].gagnants.some(n => l1.has(n));
      const m2 = filtered[idx].gagnants.some(n => l2.has(n));
      if (m1 || m2) for (const n of filtered[idx - 1].gagnants) markov[n] += (m1 && m2 ? 2 : 1);
    }
  }

  // Paires
  const pairBoost = Array(NUM_RANGE + 1).fill(0);
  const paires = {};
  for (const d of filtered.slice(0, 200)) {
    const s = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) {
        const k = `${s[i]}-${s[j]}`;
        paires[k] = (paires[k] || 0) + 1;
      }
  }
  for (const [k, c] of Object.entries(paires).sort((a, b) => b[1] - a[1]).slice(0, 50)) {
    const [a, b] = k.split("-").map(Number);
    pairBoost[a] += c;
    pairBoost[b] += c;
  }

  // Jour affinity
  const jourFreq = Array(NUM_RANGE + 1).fill(0);
  if (jourSemaine !== undefined && jourSemaine !== null) {
    for (const d of allDraws) {
      const parts = d.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!parts) continue;
      const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
      if (dt.getDay() === jourSemaine) for (const n of d.gagnants) jourFreq[n]++;
    }
  }

  // Terminaisons chaudes
  const termFreq = Array(10).fill(0);
  const termFreqR = Array(10).fill(0);
  for (const d of filtered) for (const n of d.gagnants) termFreq[n % 10]++;
  for (const d of filtered.slice(0, 30)) for (const n of d.gagnants) termFreqR[n % 10]++;
  const termScores = termFreq.map((f, i) => ({ term: i, score: f * 0.3 + termFreqR[i] * 0.7 }));
  termScores.sort((a, b) => b.score - a.score);
  const termBoost = Array(NUM_RANGE + 1).fill(0);
  const hotTerms = new Set(termScores.slice(0, 5).map(t => t.term));
  for (let i = 1; i <= NUM_RANGE; i++) if (hotTerms.has(i % 10)) termBoost[i] = freq[i];

  // ═══ PROBABILITES CONDITIONNELLES (nouveau critere v4) ═══
  const condScore = Array(NUM_RANGE + 1).fill(0);
  const lastDraw = filtered[0] ? filtered[0].gagnants : [];
  const lastDrawSet = new Set(lastDraw);

  // Cond 1: voisins du tirage precedent (+/-1 a +/-3)
  for (let idx = 1; idx < Math.min(filtered.length, 100); idx++) {
    for (const n of filtered[idx - 1].gagnants) {
      for (const p of filtered[idx].gagnants) {
        const diff = Math.abs(n - p);
        if (diff >= 1 && diff <= 3) condScore[n] += 1;
      }
    }
  }

  // Cond 2: meme terminaison que dernier tirage
  const lastTerms = new Set(lastDraw.map(n => n % 10));
  for (let i = 1; i <= NUM_RANGE; i++) if (lastTerms.has(i % 10)) condScore[i] += 3;

  // Cond 3: dizaines chaudes recentes
  const hotDiz = new Set();
  for (let n = 1; n <= NUM_RANGE; n++) if (freqR[n] >= 3) hotDiz.add(Math.floor((n - 1) / 10));
  for (let n = 1; n <= NUM_RANGE; n++) if (hotDiz.has(Math.floor((n - 1) / 10))) condScore[n] += 2;

  // Cond 4: pas dans dernier tirage (anti-repetition)
  for (const n of lastDraw) condScore[n] -= 5;

  // Cond 5: cycle conforme (0.8x a 2.0x du cycle moyen)
  for (let n = 1; n <= NUM_RANGE; n++) {
    if (overdueRatio[n] >= 0.8 && overdueRatio[n] <= 2.0) condScore[n] += 4;
  }

  // Cond 6: boost frequence recente dans le score conditionnel
  for (let n = 1; n <= NUM_RANGE; n++) condScore[n] += freqR[n] * 2;

  const rank = (arr) => [...Array(NUM_RANGE)].map((_, i) => ({ n: i + 1, v: arr[i + 1] })).sort((a, b) => b.v - a.v).slice(0, topN).map(x => x.n);

  return {
    freqGlob: rank(freq),
    freqRecent: rank(freqR),
    cycleOverdue: rank(overdueRatio),
    momentum: rank(mom),
    retard: rank(lastSeen),
    markov2: rank(markov),
    paires: rank(pairBoost),
    terminaisons: rank(termBoost),
    conditionnel: rank(condScore),
    jourAffinity: jourFreq.some(v => v > 0) ? rank(jourFreq) : null,
    lastDrawNums: lastDrawSet,
    _raw: { freq, freqR, overdueRatio, momentum: mom, lastSeen, markov, pairBoost, jourFreq, termBoost, condScore },
  };
}

// ═══ SCORING PAR CONVERGENCE ═══
function convergenceScore(tops, weights) {
  const scores = Array(NUM_RANGE + 1).fill(0);
  const votes = Array(NUM_RANGE + 1).fill(0);
  const inCriteria = {};
  for (let i = 1; i <= NUM_RANGE; i++) inCriteria[i] = [];

  for (const [critere, topList] of Object.entries(tops)) {
    if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
    const w = weights[critere] || 10;
    for (let rank = 0; rank < topList.length; rank++) {
      const n = topList[rank];
      const rankBonus = 1 - rank / topList.length;
      scores[n] += w * rankBonus;
      votes[n]++;
      inCriteria[n].push(critere);
    }
  }

  // Anti-repetition
  if (tops.lastDrawNums) {
    for (const n of tops.lastDrawNums) scores[n] -= (weights.antiRepet || 7);
  }

  // Bonus de convergence multiplicatif
  for (let i = 1; i <= NUM_RANGE; i++) {
    if (votes[i] >= 5) scores[i] *= 1.6;
    else if (votes[i] >= 4) scores[i] *= 1.4;
    else if (votes[i] >= 3) scores[i] *= 1.2;
    else if (votes[i] >= 2) scores[i] *= 1.05;
    else scores[i] *= 0.6;
  }

  // Bonus impair (les impairs gagnent plus souvent — prouve par backtest)
  for (let i = 1; i <= NUM_RANGE; i++) {
    if (i % 2 === 1) scores[i] *= 1.03;
  }

  const ranked = [];
  for (let i = 1; i <= NUM_RANGE; i++) {
    ranked.push({ num: i, score: +scores[i].toFixed(2), votes: votes[i], criteria: inCriteria[i] });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

// ═══ WALK-FORWARD LEARNING ═══
function walkForwardLearn(draws, blockSize, nBlocks) {
  blockSize = blockSize || 200;
  nBlocks = nBlocks || 5;
  const TOP_N = 15;
  let weights = { ...DEFAULT_WEIGHTS };
  const criteriaSucc = {};
  const criteriaFail = {};

  for (let block = 0; block < nBlocks; block++) {
    const start = block * blockSize;
    const end = Math.min(start + blockSize, draws.length - 100);
    if (start >= draws.length - 100) break;

    // Reset compteurs
    for (const k of Object.keys(weights)) { criteriaSucc[k] = 0; criteriaFail[k] = 0; }

    for (let i = start; i < end; i++) {
      const target = draws[i];
      const hist = draws.slice(i + 1);
      const filt = hist.filter(d => d.type === target.type);
      if (filt.length < 20) continue;

      const parts = target.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      let jour = null;
      if (parts) { const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1])); jour = dt.getDay(); }

      const tops = computeCriteriaTops(filt, hist, TOP_N, jour);
      if (!tops) continue;

      for (const n of target.gagnants) {
        for (const [critere, topList] of Object.entries(tops)) {
          if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
          if (topList.includes(n)) criteriaSucc[critere] = (criteriaSucc[critere] || 0) + 1;
          else criteriaFail[critere] = (criteriaFail[critere] || 0) + 1;
        }
      }
    }

    // Ajuster les poids
    for (const k of Object.keys(weights)) {
      if (k === "antiRepet") continue;
      const succ = criteriaSucc[k] || 0;
      const fail = criteriaFail[k] || 0;
      const total = succ + fail;
      if (total === 0) continue;
      const rate = succ / total;
      const baseline = TOP_N / NUM_RANGE;
      const lift = rate / baseline;
      weights[k] = Math.max(3, Math.min(30, weights[k] + (lift - 1) * 2.5));
    }
  }

  return weights;
}

// ═══ PREDICTION PAR CONVERGENCE v4 ═══
function predictConvergence(draws, typeFilter, jourSemaine) {
  const filtered = typeFilter ? draws.filter(d => d.type === typeFilter) : draws;
  if (filtered.length < 20) return null;

  const state = loadLearnState();
  const tops = computeCriteriaTops(filtered, draws, state.topNPerCriteria || 15, jourSemaine);
  if (!tops) return null;

  const ranked = convergenceScore(tops, state.criteriaWeights);

  function valide(nums) {
    const s = nums.reduce((a, b) => a + b, 0);
    const p = nums.filter(n => n % 2 === 0).length;
    const h = nums.filter(n => n > 45).length;
    return s >= 160 && s <= 290 && p >= 1 && p <= 4 && h >= 1 && h <= 4;
  }

  function ajuster(nums) {
    let att = [...nums];
    for (let iter = 0; iter < 20; iter++) {
      if (valide(att)) return att.sort((a, b) => a - b);
      const s = att.reduce((a, b) => a + b, 0);
      const p = att.filter(n => n % 2 === 0).length;
      const h = att.filter(n => n > 45).length;
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

  const combos = [];

  // Combo 1: CONVERGENCE PURE
  combos.push({
    nom: "CONVERGENCE",
    nums: ajuster(ranked.slice(0, 5).map(r => r.num)),
    confiance: "HAUTE",
    detail: ranked.slice(0, 5).map(r => `N${r.num}(${r.votes}crit)`).join(", "),
  });

  // Combo 2: CONVERGENCE EQUILIBREE (2P+3I)
  const imps = ranked.filter(r => r.num % 2 === 1);
  const prs = ranked.filter(r => r.num % 2 === 0);
  const eq = ajuster([...prs.slice(0, 2).map(r => r.num), ...imps.slice(0, 3).map(r => r.num)]);
  if (eq.length === 5) combos.push({ nom: "CONVERGENCE EQ", nums: eq, confiance: "HAUTE" });

  // Combo 3: CONDITIONNEL+ (proba conditionnelle confirme par convergence)
  const condConv = ranked.filter(r => r.votes >= 2 && r.criteria.includes("conditionnel")).slice(0, 7);
  if (condConv.length >= 5) {
    combos.push({ nom: "CONDITIONNEL+", nums: ajuster(condConv.slice(0, 5).map(r => r.num)), confiance: "HAUTE" });
  }

  // Combo 4: MARKOV+ (markov confirme par convergence)
  const mkConv = ranked.filter(r => r.votes >= 2 && r.criteria.includes("markov2")).slice(0, 7);
  if (mkConv.length >= 5) {
    combos.push({ nom: "MARKOV+", nums: ajuster(mkConv.slice(0, 5).map(r => r.num)), confiance: "HAUTE" });
  }

  // Combo 5: JOUR+ (jour affinity confirme par convergence)
  if (jourSemaine !== undefined && jourSemaine !== null) {
    const jourConv = ranked.filter(r => r.votes >= 2 && r.criteria.includes("jourAffinity")).slice(0, 7);
    if (jourConv.length >= 5) {
      combos.push({ nom: "JOUR+", nums: ajuster(jourConv.slice(0, 5).map(r => r.num)), confiance: "MOYENNE" });
    }
  }

  return {
    top20: ranked.slice(0, 20),
    combos,
    nbTirages: filtered.length,
    dernier: filtered[0],
    weights: state.criteriaWeights,
  };
}

// ═══ LEARN AND ADAPT (walk-forward) ═══
function learnAndAdapt() {
  const db = loadDB();
  if (db.draws.length < 500) return null;

  // Walk-forward sur les 1500 derniers tirages, 5 blocs de 300
  const learnedWeights = walkForwardLearn(db.draws, 300, 5);

  const state = loadLearnState();
  state.criteriaWeights = learnedWeights;
  state.lastBacktest = new Date().toISOString();
  state.backtestHistory.push({ date: state.lastBacktest, weights: { ...learnedWeights } });
  if (state.backtestHistory.length > 20) state.backtestHistory = state.backtestHistory.slice(-20);
  state.version = 4;
  saveLearnState(state);

  console.log("[LEARN v4] Walk-forward termine. Poids:");
  const sorted = Object.entries(learnedWeights).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted.slice(0, 5)) console.log("  " + k + ": " + v.toFixed(1));

  return state;
}

module.exports = {
  loadLearnState, saveLearnState,
  computeCriteriaTops, convergenceScore,
  walkForwardLearn, predictConvergence, learnAndAdapt,
  DEFAULT_WEIGHTS,
};
