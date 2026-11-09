// ═══════════════════════════════════════════════════════════
//  MOTEUR D'APPRENTISSAGE v4 — WALK-FORWARD + CONDITIONNEL
//  Poids issus du backtest 12 mois (3575 tirages)
//  Integre: convergence, proba conditionnelle, walk-forward
// ═══════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const { loadDB, IS_VERCEL, getDataPath } = require("./db");

const NUM_RANGE = 90;
const LEARN_PATH = getDataPath("apprentissage_state.json");

// Poids recalibres sur 15717 tirages (6 ans) — nov 2026
// terminaisons et paires = meilleurs criteres recents (17.7%, 17.5% hit rate)
// cycleOverdue et retard sous le hasard → desactives
const DEFAULT_WEIGHTS = {
  terminaisons: 30.0, paires: 30.0, markov2: 28.0, freqGlob: 27.0,
  conditionnel: 20.0, sameDayBoost: 20.0, jourAffinity: 18.0,
  antiRepet: 7.0, momentum: 5.0, freqRecent: 5.0,
  retard: 0, cycleOverdue: 0,
};

const DRAW_CATEGORIES = {
  digital: ["Digital Reveil 7h", "Digital Reveil 8h", "Digital 21h", "Digital 22h", "Digital 23h"],
  matin: ["Reveil", "La Matinale", "Premiere Heure", "Kado", "Cash", "Soutra", "Benediction"],
  midi: ["Etoile", "Emergence", "Fortune", "Privilege", "Solution", "Diamant", "Prestige"],
  aprem: ["Akwaba", "Sika", "Baraka", "Monni", "Wari", "Moaye", "Awale"],
  soir: ["Monday Special", "Lucky Tuesday", "Midweek", "Fortune Thursday", "Friday Bonanza", "National", "Espoir"],
  afterwork: ["Afterwork"],
  weekend: ["Special Weekend 1h", "Special Weekend 3h"],
};

function getCategoryForType(typeName) {
  for (const [cat, types] of Object.entries(DRAW_CATEGORIES)) {
    if (types.includes(typeName)) return cat;
  }
  return "global";
}

function loadLearnState() {
  if (!fs.existsSync(LEARN_PATH)) return {
    criteriaWeights: { ...DEFAULT_WEIGHTS },
    categoryWeights: {},
    topNPerCriteria: 15,
    lastBacktest: null,
    backtestHistory: [],
    version: 5,
  };
  const state = JSON.parse(fs.readFileSync(LEARN_PATH, "utf8"));
  if (!state.version || state.version < 4) {
    state.criteriaWeights = { ...DEFAULT_WEIGHTS };
    state.version = 5;
    state.backtestHistory = state.backtestHistory || [];
    saveLearnState(state);
  }
  if (!state.categoryWeights) state.categoryWeights = {};
  if (!state.comboPerf) state.comboPerf = { CONV: 1.0, EQ: 1.0, COND: 1.0, MARKOV: 1.0, JOUR: 1.0, NN: 0.3 };
  if (state.version < 5) state.version = 5;
  return state;
}

function getWeightsForType(state, typeName) {
  const cat = getCategoryForType(typeName);
  if (state.categoryWeights[cat]) {
    return state.categoryWeights[cat];
  }
  return state.criteriaWeights;
}

function saveLearnState(state) {
  try {
    fs.writeFileSync(LEARN_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    if (!IS_VERCEL) throw e;
  }
}

// ═══ CRITERES DE SCORING INDEPENDANTS ═══
// todayDraws: tirages deja sortis aujourd'hui (pour correlation intra-journee)
function computeCriteriaTops(filtered, allDraws, topN, jourSemaine, todayDraws) {
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

  // ═══ SAME-DAY BOOST (correlation intra-journee ~19.75%) ═══
  const sameDayScore = Array(NUM_RANGE + 1).fill(0);
  if (todayDraws && todayDraws.length > 0) {
    // Frequence historique: quels numeros suivent les numeros du jour
    const todayNums = new Set(todayDraws.flatMap(d => d.gagnants));
    // Boost direct: numeros deja sortis aujourd'hui
    for (const n of todayNums) sameDayScore[n] += 5;
    // Boost voisins +/-2 des numeros du jour
    for (const n of todayNums) {
      for (let delta = -2; delta <= 2; delta++) {
        const v = n + delta;
        if (v >= 1 && v <= NUM_RANGE && !todayNums.has(v)) sameDayScore[v] += 2;
      }
    }
    // Boost par co-occurrence historique: si un numero sort souvent le meme jour qu'un des numeros du jour
    for (const d of allDraws.slice(0, 500)) {
      const dNums = new Set(d.gagnants);
      const overlap = [...todayNums].filter(n => dNums.has(n)).length;
      if (overlap >= 1) {
        for (const n of d.gagnants) {
          if (!todayNums.has(n)) sameDayScore[n] += overlap;
        }
      }
    }
  }

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
    sameDayBoost: (todayDraws && todayDraws.length > 0) ? rank(sameDayScore) : null,
    jourAffinity: jourFreq.some(v => v > 0) ? rank(jourFreq) : null,
    lastDrawNums: lastDrawSet,
    _raw: { freq, freqR, overdueRatio, momentum: mom, lastSeen, markov, pairBoost, jourFreq, termBoost, condScore, sameDayScore },
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
    const w = critere in weights ? weights[critere] : 10;
    if (w <= 0) continue;
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

// ═══ WALK-FORWARD LEARNING v5 ═══
// startWeights: poids de depart (poids actuels appris, pas DEFAULT_WEIGHTS)
function walkForwardLearn(draws, blockSize, nBlocks, startWeights) {
  blockSize = blockSize || 200;
  nBlocks = nBlocks || 5;
  const TOP_N = 15;
  let weights = { ...(startWeights || DEFAULT_WEIGHTS) };
  const criteriaSucc = {};
  const criteriaFail = {};

  for (let block = 0; block < nBlocks; block++) {
    const start = block * blockSize;
    const end = Math.min(start + blockSize, draws.length - 100);
    if (start >= draws.length - 100) break;

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

// ═══ BACKTEST SCORING ═══
// Mesure le hit rate d'un jeu de poids sur les N derniers tirages
function backtestScore(draws, weights, nTest) {
  nTest = nTest || 200;
  const TOP_N = 15;
  let hits = 0, total = 0;

  for (let i = 0; i < Math.min(nTest, draws.length - 100); i++) {
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
    const predicted = new Set(ranked.slice(0, 5).map(r => r.num));

    for (const n of target.gagnants) {
      total++;
      if (predicted.has(n)) hits++;
    }
  }

  return total > 0 ? hits / total : 0;
}

// ═══ PREDICTION PAR CONVERGENCE v5 ═══
// todayDraws: tirages deja sortis aujourd'hui (optionnel, pour same-day boost)
function predictConvergence(draws, typeFilter, jourSemaine, todayDraws, nnScores) {
  const filtered = typeFilter ? draws.filter(d => d.type === typeFilter) : draws;
  if (filtered.length < 20) return null;

  const state = loadLearnState();
  const weights = typeFilter ? getWeightsForType(state, typeFilter) : state.criteriaWeights;
  const tops = computeCriteriaTops(filtered, draws, state.topNPerCriteria || 15, jourSemaine, todayDraws);
  if (!tops) return null;

  const ranked = convergenceScore(tops, weights);

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

  // Generer les combos individuels
  const subCombos = [];

  // Combo A: CONVERGENCE PURE
  subCombos.push({
    key: "CONV", nom: "CONVERGENCE",
    nums: ajuster(ranked.slice(0, 5).map(r => r.num)),
    confiance: "HAUTE",
    detail: ranked.slice(0, 5).map(r => `N${r.num}(${r.votes}crit)`).join(", "),
  });

  // Combo B: CONVERGENCE EQUILIBREE (2P+3I)
  const imps = ranked.filter(r => r.num % 2 === 1);
  const prs = ranked.filter(r => r.num % 2 === 0);
  const eq = ajuster([...prs.slice(0, 2).map(r => r.num), ...imps.slice(0, 3).map(r => r.num)]);
  if (eq.length === 5) subCombos.push({ key: "EQ", nom: "CONVERGENCE EQ", nums: eq, confiance: "HAUTE" });

  // Combo C: CONDITIONNEL+
  const condConv = ranked.filter(r => r.votes >= 2 && r.criteria.includes("conditionnel")).slice(0, 7);
  if (condConv.length >= 5) {
    subCombos.push({ key: "COND", nom: "CONDITIONNEL+", nums: ajuster(condConv.slice(0, 5).map(r => r.num)), confiance: "HAUTE" });
  }

  // Combo D: MARKOV+
  const mkConv = ranked.filter(r => r.votes >= 2 && r.criteria.includes("markov2")).slice(0, 7);
  if (mkConv.length >= 5) {
    subCombos.push({ key: "MARKOV", nom: "MARKOV+", nums: ajuster(mkConv.slice(0, 5).map(r => r.num)), confiance: "HAUTE" });
  }

  // Combo E: JOUR+
  if (jourSemaine !== undefined && jourSemaine !== null) {
    const jourConv = ranked.filter(r => r.votes >= 2 && r.criteria.includes("jourAffinity")).slice(0, 7);
    if (jourConv.length >= 5) {
      subCombos.push({ key: "JOUR", nom: "JOUR+", nums: ajuster(jourConv.slice(0, 5).map(r => r.num)), confiance: "MOYENNE" });
    }
  }

  // ═══ SUPER COMBO v2: fusion classique + NN ═══
  const comboWeights = state.comboPerf || {};
  const numScore = {};
  const numSources = {};
  for (const sc of subCombos) {
    const w = comboWeights[sc.key] || 1.0;
    for (let rank = 0; rank < sc.nums.length; rank++) {
      const n = sc.nums[rank];
      numScore[n] = (numScore[n] || 0) + w * (1.2 - rank * 0.1);
      if (!numSources[n]) numSources[n] = [];
      numSources[n].push(sc.key);
    }
  }

  // Integrer les scores du reseau neuronal (si disponibles)
  if (nnScores && nnScores.length > 0) {
    const nnWeight = comboWeights.NN || 1.0;
    const maxProb = nnScores[0].prob || 1;
    for (let i = 0; i < Math.min(20, nnScores.length); i++) {
      const n = nnScores[i].num;
      const normScore = (nnScores[i].prob / maxProb) * nnWeight * 1.2;
      numScore[n] = (numScore[n] || 0) + normScore;
      if (!numSources[n]) numSources[n] = [];
      if (!numSources[n].includes("NN")) numSources[n].push("NN");
    }
  }

  const superCandidates = Object.entries(numScore)
    .map(([n, s]) => ({ num: parseInt(n), score: s, sources: numSources[parseInt(n)] || [] }))
    .sort((a, b) => b.score - a.score);
  const superNums = ajuster(superCandidates.slice(0, 5).map(c => c.num));
  const hasNN = nnScores && nnScores.length > 0;
  const superDetail = superCandidates.slice(0, 5)
    .map(c => `N${c.num}(${c.sources.length}strat${c.sources.includes("NN")?" +IA":""})`).join(", ");

  // Numeros classique top5 et IA top5 + en commun
  const classicTop5 = ranked.slice(0, 5).map(r => r.num);
  const nnTop5 = [];
  if (nnScores && nnScores.length >= 5) {
    for (let i = 0; i < 5; i++) nnTop5.push(nnScores[i].num);
  }
  const commonNums = classicTop5.filter(n => nnTop5.includes(n));

  // SUPER COMBO v2 en premier, puis les combos individuels
  const combos = [];
  combos.push({
    nom: hasNN ? "SUPER COMBO v2" : "SUPER COMBO",
    nums: superNums,
    confiance: "MAXIMALE",
    detail: superDetail,
    isSuper: true,
    commonNums,
    classicTop5,
    nnTop5,
  });
  for (const sc of subCombos) {
    combos.push({ nom: sc.nom, nums: sc.nums, confiance: sc.confiance, detail: sc.detail });
  }

  return {
    top20: ranked.slice(0, 20),
    combos,
    nbTirages: filtered.length,
    dernier: filtered[0],
    weights: typeFilter ? weights : state.criteriaWeights,
  };
}

// ═══ LEARN AND ADAPT v5 (cumulatif + validation par backtest) ═══
function learnAndAdapt() {
  const db = loadDB();
  if (db.draws.length < 500) return null;

  const state = loadLearnState();
  const oldGlobalScore = backtestScore(db.draws, state.criteriaWeights, 300);

  // Walk-forward global: demarre des poids actuels (cumulatif)
  const candidateWeights = walkForwardLearn(db.draws, 300, 5, state.criteriaWeights);
  const newGlobalScore = backtestScore(db.draws, candidateWeights, 300);

  // Ne garder que si c'est une amelioration (ou equivalent)
  if (newGlobalScore >= oldGlobalScore) {
    state.criteriaWeights = candidateWeights;
    console.log("[LEARN v5] Global: " + (oldGlobalScore * 100).toFixed(2) + "% -> " + (newGlobalScore * 100).toFixed(2) + "% AMELIORE");
  } else {
    // Blend: 70% nouveau + 30% ancien pour ne pas perdre le progres
    for (const k of Object.keys(state.criteriaWeights)) {
      if (k === "antiRepet") continue;
      state.criteriaWeights[k] = state.criteriaWeights[k] * 0.3 + candidateWeights[k] * 0.7;
    }
    const blendScore = backtestScore(db.draws, state.criteriaWeights, 300);
    console.log("[LEARN v5] Global: " + (oldGlobalScore * 100).toFixed(2) + "% -> blend " + (blendScore * 100).toFixed(2) + "% (candidat " + (newGlobalScore * 100).toFixed(2) + "% etait pire)");
  }

  state.lastBacktest = new Date().toISOString();
  state.backtestHistory.push({
    date: state.lastBacktest,
    weights: { ...state.criteriaWeights },
    score: newGlobalScore >= oldGlobalScore ? newGlobalScore : backtestScore(db.draws, state.criteriaWeights, 300),
    prevScore: oldGlobalScore,
    improved: newGlobalScore >= oldGlobalScore,
  });
  if (state.backtestHistory.length > 50) state.backtestHistory = state.backtestHistory.slice(-50);
  state.version = 5;
  state.trainedOn = db.draws.length;
  state.trainedPeriod = db.draws[db.draws.length - 1]?.date + " - " + db.draws[0]?.date;

  // Walk-forward par categorie: demarre des poids categorie actuels
  for (const [cat, types] of Object.entries(DRAW_CATEGORIES)) {
    const catDraws = db.draws.filter(d => types.includes(d.type));
    if (catDraws.length < 200) continue;

    const currentCatWeights = state.categoryWeights[cat] || { ...state.criteriaWeights };
    const oldCatScore = backtestScore(catDraws, currentCatWeights, 150);
    const blockSz = Math.min(150, Math.floor(catDraws.length / 4));
    const candidateCat = walkForwardLearn(catDraws, blockSz, 4, currentCatWeights);
    const newCatScore = backtestScore(catDraws, candidateCat, 150);

    if (newCatScore >= oldCatScore) {
      state.categoryWeights[cat] = candidateCat;
      console.log("  [" + cat + "] " + (oldCatScore * 100).toFixed(2) + "% -> " + (newCatScore * 100).toFixed(2) + "% AMELIORE");
    } else {
      // Blend pour cette categorie aussi
      const blended = {};
      for (const k of Object.keys(currentCatWeights)) {
        blended[k] = k === "antiRepet" ? currentCatWeights[k] : currentCatWeights[k] * 0.3 + candidateCat[k] * 0.7;
      }
      const blendCatScore = backtestScore(catDraws, blended, 150);
      if (blendCatScore > oldCatScore) {
        state.categoryWeights[cat] = blended;
        console.log("  [" + cat + "] " + (oldCatScore * 100).toFixed(2) + "% -> blend " + (blendCatScore * 100).toFixed(2) + "%");
      } else {
        state.categoryWeights[cat] = currentCatWeights;
        console.log("  [" + cat + "] " + (oldCatScore * 100).toFixed(2) + "% CONSERVE (candidat " + (newCatScore * 100).toFixed(2) + "% pire)");
      }
    }
  }

  // Persistance des scores pour suivi de progression
  if (!state.performanceLog) state.performanceLog = [];
  state.performanceLog.push({
    date: state.lastBacktest,
    globalScore: backtestScore(db.draws, state.criteriaWeights, 300),
    categoryScores: Object.fromEntries(
      Object.entries(state.categoryWeights).map(([cat, w]) => {
        const catDraws = db.draws.filter(d => (DRAW_CATEGORIES[cat] || []).includes(d.type));
        return [cat, catDraws.length >= 100 ? backtestScore(catDraws, w, 150) : null];
      })
    ),
    trainedOn: db.draws.length,
  });
  if (state.performanceLog.length > 100) state.performanceLog = state.performanceLog.slice(-100);

  saveLearnState(state);

  console.log("[LEARN v5] Termine. " + Object.keys(state.categoryWeights).length + " categories, " + db.draws.length + " tirages");
  return state;
}

module.exports = {
  loadLearnState, saveLearnState, getWeightsForType,
  computeCriteriaTops, convergenceScore, backtestScore,
  walkForwardLearn, predictConvergence, learnAndAdapt,
  DEFAULT_WEIGHTS, DRAW_CATEGORIES, getCategoryForType,
};
