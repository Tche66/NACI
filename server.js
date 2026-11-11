const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { loadDB, saveDB, mergeDraws, IS_VERCEL, getDataPath } = require("./db");
const { TIRAGES_COMPLET, JOURS_NOMS, getTiragesJour, getNomsTiragesJour } = require("./horaires");
const { genererCouverture, CONSTRAINTS } = require("./couverture");
const { learnAndAdapt, loadLearnState, predictConvergence, DEFAULT_WEIGHTS, DRAW_CATEGORIES, getCategoryForType, computeCriteriaTops, convergenceScore, backtestScore } = require("./apprentissage");
const { NeuralNet, trainNeural, predictNeural, MODEL_PATH } = require("./neural");
const { LSTMNet, trainLSTM, predictLSTM, LSTM_MODEL_PATH } = require("./lstm");

const app = express();
const PORT = 3000;
const NUM_RANGE = 90;

// NN global — charge ou entraine au demarrage
let neuralNet = null;
function loadOrTrainNN(db) {
  try {
    if (require("fs").existsSync(MODEL_PATH)) {
      neuralNet = NeuralNet.load(MODEL_PATH);
      console.log("[NN] Modele charge depuis " + MODEL_PATH);
    } else {
      console.log("[NN] Entrainement du reseau de neurones...");
      neuralNet = trainNeural(db.draws, 5, 48, 24);
      neuralNet.save(MODEL_PATH);
      console.log("[NN] Modele entraine et sauvegarde.");
    }
  } catch (e) { console.log("[NN] Erreur:", e.message); }
}

// LSTM global
let lstmNet = null;
function loadOrTrainLSTM(db) {
  try {
    if (fs.existsSync(LSTM_MODEL_PATH)) {
      lstmNet = LSTMNet.load(LSTM_MODEL_PATH);
      if (lstmNet) console.log("[LSTM] Modele charge depuis " + LSTM_MODEL_PATH);
      else throw new Error("Format incompatible");
    } else {
      console.log("[LSTM] Entrainement du LSTM...");
      lstmNet = trainLSTM(db.draws, 5);
      lstmNet.save(LSTM_MODEL_PATH);
      console.log("[LSTM] Modele entraine et sauvegarde.");
    }
  } catch (e) { console.log("[LSTM] Erreur:", e.message); lstmNet = null; }
}
const HISTORY_PATH = getDataPath("historique_predictions.json");

const MONTHS_FR = [
  "janvier","février","mars","avril","mai","juin",
  "juillet","août","septembre","octobre","novembre","décembre",
];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("JSON error")); } });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function parseNums(str) {
  if (!str || str.includes(".")) return null;
  return str.split("-").map((n) => parseInt(n.trim())).filter((n) => n >= 1 && n <= 90);
}
function extractYear(s) { const m = s.match(/(\d{4})/); return m ? m[1] : new Date().getFullYear().toString(); }
function parseAPIDraws(json) {
  const draws = [];
  if (!json.drawsResultsWeekly) return draws;
  for (const week of json.drawsResultsWeekly) {
    const yr = extractYear(week.startDate || week.endDate || "");
    for (const day of week.drawResultsDaily || []) {
      const rawDate = day.date || "";
      const dm = rawDate.match(/(\d{2})\/(\d{2})/);
      const dateStr = dm ? `${dm[1]}/${dm[2]}/${yr}` : rawDate;
      const allD = [...(day.drawResults?.nightDraws || []), ...(day.drawResults?.standardDraws || [])];
      for (const d of allD) {
        if (!d.drawName || d.drawName === "-") continue;
        const wn = parseNums(d.winningNumbers);
        const mn = parseNums(d.machineNumbers);
        if (wn && wn.length === 5) draws.push({ date: dateStr, type: d.drawName, gagnants: wn, machine: mn });
      }
    }
  }
  return draws;
}

// ═══ HISTORIQUE PRÉDICTIONS ═══
function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return { predictions: [], analyses: [] };
  return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
}
function saveHistory(h) {
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(h, null, 2), "utf8");
  } catch (e) {
    if (!IS_VERCEL) throw e;
  }
}

// ═══ SCORING 5 NUMÉROS (v3 — basé sur backtest réel) ═══
function scoring5(draws, typeFilter, weights, jourSemaine) {
  const filtered = typeFilter ? draws.filter((d) => d.type === typeFilter) : draws;
  if (filtered.length < 10) return null;

  const scores = Array(NUM_RANGE + 1).fill(0);

  const freq = Array(NUM_RANGE + 1).fill(0);
  for (const d of filtered) for (const n of d.gagnants) freq[n]++;
  const maxFreq = Math.max(...freq.slice(1)) || 1;

  const freqR = Array(NUM_RANGE + 1).fill(0);
  for (const d of filtered.slice(0, 30)) for (const n of d.gagnants) freqR[n]++;
  const maxFR = Math.max(...freqR.slice(1)) || 1;

  const lastSeen = Array(NUM_RANGE + 1).fill(filtered.length);
  for (let idx = 0; idx < filtered.length; idx++)
    for (const n of filtered[idx].gagnants) if (lastSeen[n] === filtered.length) lastSeen[n] = idx;

  const momentum = Array(NUM_RANGE + 1).fill(0);
  for (const d of filtered.slice(0, 15)) for (const n of d.gagnants) momentum[n]++;
  const maxMomentum = Math.max(...momentum.slice(1)) || 1;

  const jourFreq = Array(NUM_RANGE + 1).fill(0);
  let jourTotal = 0;
  if (jourSemaine !== undefined && jourSemaine !== null) {
    for (const d of draws) {
      const parts = d.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!parts) continue;
      const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
      if (dt.getDay() === jourSemaine) { for (const n of d.gagnants) jourFreq[n]++; jourTotal++; }
    }
  }
  const maxJour = Math.max(...jourFreq.slice(1)) || 1;

  const mk = Array(NUM_RANGE + 1).fill(0);
  if (filtered.length > 2) {
    const last1 = new Set(filtered[0].gagnants);
    const last2 = new Set(filtered[1].gagnants);
    for (let idx = 2; idx < filtered.length; idx++) {
      const m1 = filtered[idx].gagnants.some(n => last1.has(n));
      const m2 = filtered[idx].gagnants.some(n => last2.has(n));
      if (m1 || m2) { const wt = m1 && m2 ? 2 : 1; for (const n of filtered[idx - 1].gagnants) mk[n] += wt; }
    }
  }
  const maxM = Math.max(...mk.slice(1)) || 1;

  const ps = Array(NUM_RANGE + 1).fill(0);
  const paires = {};
  for (const d of filtered.slice(0, 200)) {
    const s = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = `${s[i]}-${s[j]}`; paires[k] = (paires[k] || 0) + 1; }
  }
  for (const [k, c] of Object.entries(paires).sort((a, b) => b[1] - a[1]).slice(0, 50)) {
    const [a, b] = k.split("-").map(Number); ps[a] += c; ps[b] += c;
  }
  const maxPS = Math.max(...ps.slice(1)) || 1;

  const lastDrawNums = new Set(filtered[0] ? filtered[0].gagnants : []);

  // v3 weights — backtest-proven: momentum #1, overdue eliminated
  const w = weights || { freqGlob: 10, freqRecent: 22, momentum: 25, jourAffinity: 15, markov2: 8, paires: 5, antiRepet: 8, oddBonus: 2 };

  for (let i = 1; i <= NUM_RANGE; i++) {
    scores[i] += (freq[i] / maxFreq) * (w.freqGlob || 10);
    scores[i] += (freqR[i] / maxFR) * (w.freqRecent || 22);
    scores[i] += (momentum[i] / maxMomentum) * (w.momentum || 25);
    if (jourTotal > 50) scores[i] += (jourFreq[i] / maxJour) * (w.jourAffinity || 15);
    else scores[i] += (freqR[i] / maxFR) * 8 + (momentum[i] / maxMomentum) * 7;
    scores[i] += (mk[i] / maxM) * (w.markov2 || 8);
    scores[i] += (ps[i] / maxPS) * (w.paires || 5);
    if (lastDrawNums.has(i)) scores[i] -= (w.antiRepet || 8);
    if (i % 2 === 1) scores[i] += (w.oddBonus || 2);
  }

  const ranked = [];
  for (let i = 1; i <= NUM_RANGE; i++) ranked.push({
    num: i, score: +scores[i].toFixed(2), freq: freq[i], freqRecent: freqR[i],
    retard: lastSeen[i], momentum: momentum[i],
  });
  ranked.sort((a, b) => b.score - a.score);

  // Validation: somme entre 150-300, 1-4 pairs, 1-4 hauts
  function valide(nums) {
    const s = nums.reduce((a, b) => a + b, 0);
    const p = nums.filter(n => n % 2 === 0).length;
    const h = nums.filter(n => n > 45).length;
    return s >= 150 && s <= 300 && p >= 1 && p <= 4 && h >= 1 && h <= 4;
  }

  function ajuster(nums) {
    let att = [...nums];
    for (let iter = 0; iter < 15; iter++) {
      if (valide(att)) return att;
      const s = att.reduce((a, b) => a + b, 0);
      if (s < 150) {
        const rep = ranked.find(r => r.num > 50 && !att.includes(r.num));
        if (rep) { att[att.length - 1] = rep.num; att.sort((a, b) => a - b); }
      } else if (s > 300) {
        const rep = ranked.find(r => r.num < 40 && !att.includes(r.num));
        if (rep) { att[att.length - 1] = rep.num; att.sort((a, b) => a - b); }
      } else break;
    }
    return att;
  }

  const combos = [];

  // Combo 1: TOP SCORE
  combos.push({ nom: "TOP SCORE", nums: ajuster(ranked.slice(0, 5).map(r => r.num).sort((a, b) => a - b)), confiance: "HAUTE" });

  // Combo 2: OVERDUE
  const overdueRanked = [...ranked].filter(r => r.overdue >= 1.5).sort((a, b) => b.overdue - a.overdue);
  if (overdueRanked.length >= 5) {
    combos.push({ nom: "CYCLES OVERDUE", nums: ajuster(overdueRanked.slice(0, 5).map(r => r.num).sort((a, b) => a - b)), confiance: "HAUTE" });
  }

  // Combo 3: MOMENTUM
  const momRanked = [...ranked].filter(r => r.momentum >= 2).sort((a, b) => b.momentum - a.momentum || b.score - a.score);
  if (momRanked.length >= 5) {
    combos.push({ nom: "MOMENTUM", nums: ajuster(momRanked.slice(0, 5).map(r => r.num).sort((a, b) => a - b)), confiance: "MOYENNE" });
  }

  // Combo 4: ÉQUILIBRÉ 2P+3I
  const rp = ranked.filter(r => r.num % 2 === 0).slice(0, 2).map(r => r.num);
  const ri = ranked.filter(r => r.num % 2 === 1).slice(0, 3).map(r => r.num);
  combos.push({ nom: "ÉQUILIBRÉ", nums: [...rp, ...ri].sort((a, b) => a - b), confiance: "HAUTE" });

  return { top20: ranked.slice(0, 20), combos, nbTirages: filtered.length, dernier: filtered[0] };
}

// ═══ SCORING PAIRES ═══
function scoringPaires(draws, typeFilter) {
  const filtered = typeFilter ? draws.filter((d) => d.type === typeFilter) : draws;
  if (filtered.length < 10) return null;
  const pf = {}, pfr = {}, pls = {};
  for (const d of filtered) { const s = [...d.gagnants].sort((a, b) => a - b); for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = `${s[i]}-${s[j]}`; pf[k] = (pf[k] || 0) + 1; } }
  for (const d of filtered.slice(0, 30)) { const s = [...d.gagnants].sort((a, b) => a - b); for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = `${s[i]}-${s[j]}`; pfr[k] = (pfr[k] || 0) + 1; } }
  for (let idx = 0; idx < filtered.length; idx++) { const s = [...filtered[idx].gagnants].sort((a, b) => a - b); for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = `${s[i]}-${s[j]}`; if (!(k in pls)) pls[k] = idx; } }
  const ln = filtered[0] ? filtered[0].gagnants : [];
  const mk = {};
  for (let idx = 1; idx < filtered.length; idx++) { if (filtered[idx].gagnants.some((n) => ln.includes(n)) && filtered[idx - 1]) { const s = [...filtered[idx - 1].gagnants].sort((a, b) => a - b); for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = `${s[i]}-${s[j]}`; mk[k] = (mk[k] || 0) + 1; } } }
  const maxF = Math.max(...Object.values(pf)) || 1;
  const maxFR = Math.max(...Object.values(pfr), 1);
  const maxMK = Math.max(...Object.values(mk), 1);
  const scored = Object.keys(pf).map((key) => {
    const [a, b] = key.split("-").map(Number);
    const retard = pls[key] ?? filtered.length;
    let score = (pf[key] / maxF) * 20 + ((pfr[key] || 0) / maxFR) * 30 + ((mk[key] || 0) / maxMK) * 20;
    if (pf[key] >= 3 && retard >= 5) score += Math.min(retard / 20, 1) * 15;
    if ((a ^ b) > 10 && (a ^ b) < 80) score += 10;
    if ((a % 2) !== (b % 2)) score += 5;
    return { paire: key, a, b, score: +score.toFixed(2), freq: pf[key], freqRecent: pfr[key] || 0, retard, markov: mk[key] || 0 };
  }).sort((a, b) => b.score - a.score);
  const best1 = scored[0];
  let best2 = null;
  for (let i = 1; i < scored.length; i++) { if (scored[i].a !== best1.a && scored[i].a !== best1.b && scored[i].b !== best1.a && scored[i].b !== best1.b) { best2 = scored[i]; break; } }
  if (!best2 && scored.length > 1) best2 = scored[1];
  return { top20: scored.slice(0, 20), paire1: best1, paire2: best2, nbTirages: filtered.length };
}

// ═══ COMPARAISON PRÉDICTIONS vs RÉSULTATS ═══
function comparerPredictionResultat(prediction, resultat, machine) {
  const predNums = prediction;
  const resNums = resultat;
  const machNums = machine || [];
  const matches = predNums.filter(n => resNums.includes(n));
  const machineMatches = predNums.filter(n => !resNums.includes(n) && machNums.includes(n));
  const predSet = new Set(predNums);
  const resSet = new Set(resNums);
  const procheDe1 = [];
  for (const n of predNums) {
    if (!resSet.has(n)) {
      if (resSet.has(n - 1) || resSet.has(n + 1)) procheDe1.push({ predit: n, reel: resSet.has(n-1) ? n-1 : n+1, ecart: 1 });
      else if (resSet.has(n - 2) || resSet.has(n + 2)) procheDe1.push({ predit: n, reel: resSet.has(n-2) ? n-2 : n+2, ecart: 2 });
    }
  }
  const memeDizaine = [];
  for (const n of predNums) {
    if (!resSet.has(n)) {
      const diz = Math.floor(n / 10);
      for (const r of resNums) {
        if (!predSet.has(r) && Math.floor(r / 10) === diz) {
          memeDizaine.push({ predit: n, reel: r, dizaine: `${diz*10}-${diz*10+9}` });
          break;
        }
      }
    }
  }
  const memeTerminaison = [];
  for (const n of predNums) {
    if (!resSet.has(n)) {
      const term = n % 10;
      for (const r of resNums) {
        if (!predSet.has(r) && r % 10 === term) {
          memeTerminaison.push({ predit: n, reel: r, terminaison: term });
          break;
        }
      }
    }
  }
  return {
    nbExacts: matches.length,
    exacts: matches,
    nbMachineExacts: machineMatches.length,
    machineExacts: machineMatches,
    proches: procheDe1,
    memeDizaine,
    memeTerminaison,
    score: matches.length * 20 + machineMatches.length * 10 + procheDe1.length * 8 + memeDizaine.length * 3 + memeTerminaison.length * 2,
    maxScore: 100,
  };
}

function analyserEchecs(history) {
  if (history.analyses.length < 3) return null;
  const recent = history.analyses.slice(-30);
  let totalCompared = 0;
  const critereScores = { markov2: 0, jourAffinity: 0, freqGlob: 0, paires: 0, terminaisons: 0, conditionnel: 0, momentum: 0, freqRecent: 0, retard: 0, cycleOverdue: 0 };
  for (const a of recent) {
    if (!a.comparaisons) continue;
    for (const c of a.comparaisons) {
      if (!c.comp) continue;
      totalCompared++;
      if (c.comp.nbExacts >= 2) {
        critereScores.markov2 += 2;
        critereScores.jourAffinity += 2;
        critereScores.conditionnel += 1;
      } else if (c.comp.nbExacts === 1) {
        critereScores.markov2 += 1;
        critereScores.freqGlob += 1;
      }
      if (c.comp.proches.length >= 2) {
        critereScores.terminaisons += 1;
        critereScores.paires += 1;
      }
      if (c.comp.nbExacts === 0 && c.comp.proches.length === 0) {
        critereScores.cycleOverdue -= 1;
        critereScores.retard -= 1;
      }
    }
  }
  if (totalCompared === 0) return null;
  const base = { ...DEFAULT_WEIGHTS };
  delete base.antiRepet;
  const adjusted = {};
  for (const k of Object.keys(base)) {
    adjusted[k] = Math.max(3, Math.min(30, base[k] + (critereScores[k] || 0)));
  }
  adjusted.antiRepet = DEFAULT_WEIGHTS.antiRepet;
  return { adjusted, critereScores, totalCompared, nbAnalyses: recent.length };
}

// ═══ FRÉQUENCE / DISTRIBUTION ═══
function analyseFrequence(draws) {
  const freq = Array(NUM_RANGE + 1).fill(0);
  const freqR = Array(NUM_RANGE + 1).fill(0);
  for (const d of draws) for (const n of d.gagnants) freq[n]++;
  for (const d of draws.slice(0, 50)) for (const n of d.gagnants) freqR[n]++;
  const total = draws.length * 5;
  const expected = total / NUM_RANGE;
  const result = [];
  for (let i = 1; i <= NUM_RANGE; i++) {
    result.push({ num: i, freq: freq[i], freqRecent: freqR[i], pct: +(freq[i] / total * 100).toFixed(2), ecart: +((freq[i] - expected) / expected * 100).toFixed(1), temp: freqR[i] >= 5 ? "CHAUD" : freqR[i] >= 3 ? "TIEDE" : "FROID" });
  }
  return result.sort((a, b) => b.freq - a.freq);
}

function analyseDistribution(draws) {
  const sommes = draws.map((d) => d.gagnants.reduce((a, b) => a + b, 0));
  const avg = sommes.reduce((a, b) => a + b, 0) / sommes.length;
  const pi = {}; const hb = {};
  for (const d of draws) {
    const p = d.gagnants.filter((n) => n % 2 === 0).length;
    pi[`${p}P-${5-p}I`] = (pi[`${p}P-${5-p}I`] || 0) + 1;
    const h = d.gagnants.filter((n) => n > 45).length;
    hb[`${h}H-${5-h}B`] = (hb[`${h}H-${5-h}B`] || 0) + 1;
  }
  return { avgSomme: +avg.toFixed(1), minSomme: Math.min(...sommes), maxSomme: Math.max(...sommes), pairImpair: Object.entries(pi).sort((a, b) => b[1] - a[1]), hautBas: Object.entries(hb).sort((a, b) => b[1] - a[1]) };
}

// ═══ AUTO-UPDATE TIMER ═══
const HEURES_CHECK = ["07:05","08:05","10:05","13:05","16:05","18:05","18:40","21:05","22:05","23:05"];
let lastAutoCheck = "";

async function autoUpdate() {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const checkKey = `${now.toDateString()}-${hhmm}`;
  if (checkKey === lastAutoCheck) return;
  const shouldCheck = HEURES_CHECK.some(h => hhmm === h);
  if (!shouldCheck) return;
  lastAutoCheck = checkKey;
  console.log(`[AUTO] Vérification à ${hhmm}...`);
  try {
    const db = loadDB();
    const m = `${MONTHS_FR[now.getMonth()]} ${now.getFullYear()}`;
    const json = await fetchJSON(`https://lotobonheur.ci/api/results?monthYear=${encodeURIComponent(m)}`);
    const newDraws = parseAPIDraws(json);
    const added = mergeDraws(db.draws, newDraws);
    if (added > 0) {
      saveDB(db);
      console.log(`[AUTO] +${added} nouveaux tirages ! Total: ${db.draws.length}`);
      autoSavePredictions(db);
      autoCompare(db);
    } else {
      console.log(`[AUTO] Pas de nouveaux tirages.`);
      autoSavePredictions(db);
      autoCompare(db);
    }
  } catch (e) { console.log(`[AUTO] Erreur: ${e.message}`); }
}

function autoCompare(db) {
  const history = loadHistory();
  const pendingPreds = history.predictions.filter(p => !p.compared);
  if (pendingPreds.length === 0) return;

  const byDate = {};
  for (const p of pendingPreds) {
    if (!byDate[p.date]) byDate[p.date] = [];
    byDate[p.date].push(p);
  }

  let totalCompared = 0;
  let learnUpdated = false;

  for (const [dateStr, preds] of Object.entries(byDate)) {
    const dateDraws = db.draws.filter(d => d.date === dateStr);
    if (dateDraws.length === 0) continue;

    const analyse = { date: dateStr, timestamp: new Date().toISOString(), comparaisons: [] };

    for (const pred of preds) {
      const realDraw = dateDraws.find(d => d.type === pred.tirage);
      if (!realDraw) continue;
      const comp = comparerPredictionResultat(pred.nums, realDraw.gagnants, realDraw.machine);

      let neuralPred = null, neuralComp = null;
      if (pred.allCombos) {
        const nc = pred.allCombos.find(c => c.nom === "NEURAL");
        if (nc && nc.nums) {
          neuralPred = nc.nums;
          neuralComp = comparerPredictionResultat(nc.nums, realDraw.gagnants, realDraw.machine);
        }
      }

      analyse.comparaisons.push({
        tirage: pred.tirage,
        prediction: pred.nums,
        resultat: realDraw.gagnants,
        machine: realDraw.machine || [],
        comp,
        neuralPrediction: neuralPred,
        neuralComp,
      });
      pred.compared = true;
      pred.resultat = realDraw.gagnants;
      pred.machine = realDraw.machine || [];
      pred.nbExacts = comp.nbExacts;
      pred.nbMachineExacts = comp.nbMachineExacts;
      totalCompared++;

      try {
        const { computeCriteriaTops, loadLearnState, saveLearnState } = require("./apprentissage");
        const filtered = db.draws.filter(d => d.type === pred.tirage);
        if (filtered.length >= 20) {
          const parts2 = realDraw.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          let jour = null;
          if (parts2) { const dt = new Date(parseInt(parts2[3]), parseInt(parts2[2]) - 1, parseInt(parts2[1])); jour = dt.getDay(); }
          const tops = computeCriteriaTops(filtered, db.draws, 15, jour);
          if (tops) {
            const state = loadLearnState();
            const realNums = realDraw.gagnants;
            const cat = getCategoryForType(pred.tirage);
            if (!state.categoryWeights[cat]) state.categoryWeights[cat] = { ...state.criteriaWeights };
            for (const n of realNums) {
              for (const [critere, topList] of Object.entries(tops)) {
                if (!topList || critere.startsWith("_") || critere === "lastDrawNums") continue;
                const wg = state.criteriaWeights[critere];
                if (wg !== undefined) {
                  if (topList.includes(n)) state.criteriaWeights[critere] = Math.min(30, wg + 0.15);
                  else state.criteriaWeights[critere] = Math.max(3, wg - 0.03);
                }
                const wc = state.categoryWeights[cat][critere];
                if (wc !== undefined) {
                  if (topList.includes(n)) state.categoryWeights[cat][critere] = Math.min(30, wc + 0.2);
                  else state.categoryWeights[cat][critere] = Math.max(3, wc - 0.04);
                }
              }
            }
            if (pred.allCombos && pred.allCombos.length > 0) {
              if (!state.comboPerf) state.comboPerf = { CONV: 1.0, EQ: 1.0, COND: 1.0, MARKOV: 1.0, JOUR: 1.0, NN: 0.3 };
              if (state.comboPerf.NN === undefined) state.comboPerf.NN = 0.3;
              const comboKeyMap = { "CONVERGENCE": "CONV", "CONVERGENCE EQ": "EQ", "CONDITIONNEL+": "COND", "MARKOV+": "MARKOV", "JOUR+": "JOUR", "NEURAL": "NN" };
              for (const combo of pred.allCombos) {
                const key = comboKeyMap[combo.nom];
                if (!key || state.comboPerf[key] === undefined) continue;
                const comboHits = (combo.nums || []).filter(n => realNums.includes(n)).length;
                if (comboHits > 0) state.comboPerf[key] = Math.min(2.0, state.comboPerf[key] * 0.95 + 0.1);
                else state.comboPerf[key] = Math.max(0.3, state.comboPerf[key] * 0.97 - 0.01);
              }
            }
            saveLearnState(state);
            learnUpdated = true;
          }
        }
      } catch (e) { /* silencieux */ }
    }

    if (analyse.comparaisons.length > 0) {
      const existingAnalyse = history.analyses.find(a => a.date === dateStr);
      if (existingAnalyse) {
        existingAnalyse.comparaisons.push(...analyse.comparaisons);
        existingAnalyse.timestamp = analyse.timestamp;
      } else {
        history.analyses.push(analyse);
      }
    }
  }

  if (totalCompared > 0) {
    saveHistory(history);
    console.log(`[AUTO] Compare ${totalCompared} predictions sur ${Object.keys(byDate).length} jour(s)` + (learnUpdated ? " — poids ajustes" : ""));

    if (neuralNet && history.analyses.length % 10 === 0) {
      try {
        console.log("[NN] Re-entrainement incremental...");
        neuralNet = trainNeural(db.draws, 2, 48, 24);
        neuralNet.save(MODEL_PATH);
        console.log("[NN] Modele mis a jour.");
      } catch (e) { console.log("[NN] Erreur re-entrainement:", e.message); }
    }
  }
}

// ═══ SAUVEGARDE AUTO DES PREDICTIONS ═══
// Sauvegarde automatiquement les predictions de chaque tirage a venir
function autoSavePredictions(db) {
  const now = new Date();
  const todayStr = now.toLocaleDateString("fr-FR");
  const history = loadHistory();
  const jour = now.getDay();
  const tiragesInfo = getTiragesJour(jour);

  // Tirages deja sortis aujourd'hui (pour same-day boost)
  const todayDraws = db.draws.filter(d => d.date === todayStr);

  let saved = 0;
  for (const t of tiragesInfo) {
    // Verifier si deja sauvegarde
    const exists = history.predictions.find(p => p.date === todayStr && p.tirage === t.nom);
    if (exists) continue;

    // Calculer scores NN puis prediction convergence avec fusion
    let nnScores = null;
    if (neuralNet) { try { nnScores = predictNeural(neuralNet, db.draws, t.nom, jour, todayDraws); } catch (e) {} }
    const conv = predictConvergence(db.draws, t.nom, jour, todayDraws, nnScores);
    if (!conv || !conv.combos || conv.combos.length === 0) continue;

    // Ajouter combo NEURAL seul (pour comparaison)
    if (nnScores) {
      conv.combos.push({ nom: "NEURAL", nums: nnScores.slice(0, 5).map(s => s.num).sort((a, b) => a - b), confiance: "IA", isNeural: true });
    }

    history.predictions.push({
      date: todayStr,
      tirage: t.nom,
      heure: t.heure,
      nums: conv.combos[0].nums,
      allCombos: conv.combos.map(c => ({ nom: c.nom, nums: c.nums })),
      compared: false,
      savedAt: now.toISOString(),
      auto: true,
    });
    saved++;
  }

  if (saved > 0) {
    saveHistory(history);
    console.log(`[AUTO-SAVE] ${saved} predictions sauvegardees pour ${todayStr}`);
  }
}

// ═══ RATTRAPAGE RESULTATS MANQUES ═══
async function catchUpResults() {
  const history = loadHistory();
  const pendingPreds = history.predictions.filter(p => !p.compared);
  if (pendingPreds.length === 0) return;

  const missingMonths = new Set();
  for (const p of pendingPreds) {
    const parts = p.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!parts) continue;
    const month = parseInt(parts[2]) - 1;
    const year = parseInt(parts[3]);
    missingMonths.add(`${MONTHS_FR[month]} ${year}`);
  }

  if (missingMonths.size === 0) return;
  console.log(`[CATCHUP] ${pendingPreds.length} predictions non comparees sur ${missingMonths.size} mois`);

  const db = loadDB();
  let totalNew = 0;
  for (const m of missingMonths) {
    try {
      const json = await fetchJSON(`https://lotobonheur.ci/api/results?monthYear=${encodeURIComponent(m)}`);
      const newDraws = parseAPIDraws(json);
      totalNew += mergeDraws(db.draws, newDraws);
    } catch (e) { console.log(`[CATCHUP] Erreur pour ${m}: ${e.message}`); }
  }

  if (totalNew > 0) {
    saveDB(db);
    console.log(`[CATCHUP] +${totalNew} tirages recuperes`);
  }

  autoCompare(db);
  const remaining = loadHistory().predictions.filter(p => !p.compared).length;
  console.log(`[CATCHUP] Termine — ${remaining} predictions encore en attente`);
}

if (!IS_VERCEL) setInterval(autoUpdate, 60000);

// ═══ ROUTES API ═══
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/api/status", (req, res) => {
  const db = loadDB();
  const history = loadHistory();
  res.json({ nbTirages: db.draws.length, lastUpdate: db.lastUpdate, nbPredictions: history.predictions.length, nbAnalyses: history.analyses.length });
});

app.post("/api/update", async (req, res) => {
  try {
    const db = loadDB();
    const now = new Date();
    let totalNew = 0;
    for (let i = 0; i < 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i);
      const m = `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
      const json = await fetchJSON(`https://lotobonheur.ci/api/results?monthYear=${encodeURIComponent(m)}`);
      totalNew += mergeDraws(db.draws, parseAPIDraws(json));
    }
    saveDB(db);
    if (totalNew > 0) autoCompare(db);
    res.json({ success: true, newDraws: totalNew, total: db.draws.length });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/api/horaires/:jour", (req, res) => {
  const jour = parseInt(req.params.jour);
  res.json({ jour, jourNom: JOURS_NOMS[jour], tirages: getTiragesJour(jour) });
});

app.get("/api/predictions/:jour", (req, res) => {
  const db = loadDB();
  if (db.draws.length === 0) return res.json({ error: "Base vide" });
  const jour = parseInt(req.params.jour);
  const tiragesInfo = getTiragesJour(jour);
  const learnState = loadLearnState();

  // Tirages du jour pour same-day boost
  const now = new Date();
  const todayStr = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const todayDraws = db.draws.filter(d => d.date === todayStr);

  // Scores NN globaux pour la fusion
  let globalNN = null;
  if (neuralNet) { try { globalNN = predictNeural(neuralNet, db.draws, null, jour, todayDraws); } catch (e) {} }

  // Prediction par convergence + fusion NN (SUPER COMBO v2)
  const globalConv = predictConvergence(db.draws, null, jour, todayDraws, globalNN);

  // Predictions classiques en backup
  const history = loadHistory();
  const learnResult = analyserEchecs(history);
  const weights = learnResult ? learnResult.adjusted : undefined;

  const parTirage = [];
  for (const t of tiragesInfo) {
    // Calculer scores NN pour ce tirage
    let nnScores = null;
    if (neuralNet) { try { nnScores = predictNeural(neuralNet, db.draws, t.nom, jour, todayDraws); } catch (e) {} }

    // Convergence avec fusion NN integree (SUPER COMBO v2)
    const convPred = predictConvergence(db.draws, t.nom, jour, todayDraws, nnScores);
    const classicPred = scoring5(db.draws, t.nom, weights, jour);
    const pair = scoringPaires(db.draws, t.nom);

    // Ajouter combo NEURAL seul (pour comparaison)
    let pred = convPred || classicPred;
    if (nnScores && pred && pred.combos) {
      const nnNums = nnScores.slice(0, 5).map(s => s.num).sort((a, b) => a - b);
      const nnDetail = nnScores.slice(0, 5).map(s => "N" + s.num + "(" + (s.prob * 100).toFixed(0) + "%)").join(", ");
      pred.combos.push({ nom: "NEURAL", nums: nnNums, confiance: "IA", detail: nnDetail, isNeural: true });
    }

    // Ajouter combo LSTM (3eme source)
    if (lstmNet && pred && pred.combos) {
      try {
        const lstmScores = predictLSTM(lstmNet, db.draws, t.nom, jour, todayDraws);
        if (lstmScores) {
          const lstmNums = lstmScores.slice(0, 5).map(s => s.num).sort((a, b) => a - b);
          pred.combos.push({ nom: "LSTM", nums: lstmNums, confiance: "LSTM", isLSTM: true });
        }
      } catch (e) {}
    }

    parTirage.push({
      tirage: t.nom, heure: t.heure, type: t.type,
      prediction: pred,
      paire: pair ? { p1: pair.paire1, p2: pair.paire2 } : null,
    });
  }
  res.json({
    jour, jourNom: JOURS_NOMS[jour],
    global: globalConv || scoring5(db.draws, null, weights, jour),
    parTirage, nbTirages: db.draws.length,
    weights: learnResult,
    learnState: { criteriaWeights: learnState.criteriaWeights, lastBacktest: learnState.lastBacktest },
  });
});

app.get("/api/paires/:jour", (req, res) => {
  const db = loadDB();
  if (db.draws.length === 0) return res.json({ error: "Base vide" });
  const jour = parseInt(req.params.jour);
  const tiragesInfo = getTiragesJour(jour);
  const global = scoringPaires(db.draws, null);
  const parTirage = [];
  const votes = {};
  for (const t of tiragesInfo) {
    const r = scoringPaires(db.draws, t.nom);
    parTirage.push({ tirage: t.nom, heure: t.heure, type: t.type, result: r });
    if (r) {
      [r.paire1, r.paire2].filter(Boolean).forEach((p) => {
        votes[p.paire] = votes[p.paire] || { ...p, votes: 0, totalScore: 0 };
        votes[p.paire].votes++;
        votes[p.paire].totalScore += p.score;
      });
    }
  }
  const sp = Object.values(votes).sort((a, b) => b.votes !== a.votes ? b.votes - a.votes : b.totalScore - a.totalScore);
  const sp1 = sp[0] || null;
  let sp2 = null;
  if (sp1) for (let i = 1; i < sp.length; i++) { if (sp[i].a !== sp1.a && sp[i].a !== sp1.b && sp[i].b !== sp1.a && sp[i].b !== sp1.b) { sp2 = sp[i]; break; } }
  if (!sp2 && sp.length > 1) sp2 = sp[1];
  res.json({ jour, jourNom: JOURS_NOMS[jour], global, parTirage, superPaire1: sp1, superPaire2: sp2 });
});

app.post("/api/save-predictions", (req, res) => {
  const { predictions } = req.body;
  if (!predictions || !predictions.length) return res.json({ error: "Pas de prédictions" });
  const history = loadHistory();
  for (const p of predictions) {
    const exists = history.predictions.find(h => h.date === p.date && h.tirage === p.tirage);
    if (!exists) history.predictions.push({ ...p, compared: false, savedAt: new Date().toISOString() });
  }
  saveHistory(history);
  res.json({ success: true, saved: predictions.length });
});

app.post("/api/compare-now", async (req, res) => {
  try {
    const db = loadDB();
    const now = new Date();
    const m = `${MONTHS_FR[now.getMonth()]} ${now.getFullYear()}`;
    const json = await fetchJSON(`https://lotobonheur.ci/api/results?monthYear=${encodeURIComponent(m)}`);
    const added = mergeDraws(db.draws, parseAPIDraws(json));
    if (added > 0) saveDB(db);
    autoSavePredictions(db);
    autoCompare(db);
    const history = loadHistory();
    const todayStr = now.toLocaleDateString("fr-FR");
    const todayAnalyse = history.analyses.filter(a => a.date === todayStr);
    const learnState = loadLearnState();
    res.json({ success: true, newDraws: added, analyses: todayAnalyse, weightsAfterLearn: learnState.criteriaWeights });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/api/historique", (req, res) => {
  const history = loadHistory();
  const recent = history.analyses.slice(-14);
  const stats = { totalPredictions: 0, totalExacts: 0, totalProches: 0, totalComparisons: 0, totalMachineExacts: 0, neuralExacts: 0, neuralMachineExacts: 0, neuralComparisons: 0, parTirage: {} };
  const dailySummary = [];
  for (const a of history.analyses) {
    let dayExacts = 0, dayProches = 0, dayMachine = 0, dayComps = 0, dayNNExacts = 0, dayNNComps = 0;
    for (const c of (a.comparaisons || [])) {
      if (!c.comp) continue;
      stats.totalComparisons++;
      stats.totalExacts += c.comp.nbExacts;
      stats.totalProches += c.comp.proches.length;
      stats.totalMachineExacts += c.comp.nbMachineExacts || 0;
      stats.totalPredictions += 5;
      dayComps++; dayExacts += c.comp.nbExacts; dayProches += c.comp.proches.length; dayMachine += c.comp.nbMachineExacts || 0;
      if (c.neuralComp) {
        stats.neuralComparisons++;
        stats.neuralExacts += c.neuralComp.nbExacts;
        stats.neuralMachineExacts += c.neuralComp.nbMachineExacts || 0;
        dayNNComps++; dayNNExacts += c.neuralComp.nbExacts;
      }
      if (!stats.parTirage[c.tirage]) stats.parTirage[c.tirage] = { total: 0, exacts: 0, proches: 0, machine: 0, count: 0 };
      stats.parTirage[c.tirage].count++;
      stats.parTirage[c.tirage].exacts += c.comp.nbExacts;
      stats.parTirage[c.tirage].proches += c.comp.proches.length;
      stats.parTirage[c.tirage].machine += c.comp.nbMachineExacts || 0;
      stats.parTirage[c.tirage].total += 5;
    }
    if (dayComps > 0) {
      dailySummary.push({ date: a.date, comparaisons: dayComps, exacts: dayExacts, proches: dayProches, machine: dayMachine, taux: +(dayExacts / (dayComps * 5) * 100).toFixed(1), nnExacts: dayNNExacts, nnComps: dayNNComps });
    }
  }
  const learnResult = analyserEchecs(history);
  const learnState = loadLearnState();
  res.json({ recent, allAnalyses: history.analyses, dailySummary, stats, learning: learnResult, v4Weights: learnState.criteriaWeights, lastBacktest: learnState.lastBacktest, autoSavedCount: history.predictions.filter(p => p.auto).length });
});

app.get("/api/couverture/:jour", (req, res) => {
  const db = loadDB();
  if (db.draws.length === 0) return res.json({ error: "Base vide" });
  const jour = parseInt(req.params.jour);
  const tiragesInfo = getTiragesJour(jour);
  const nbGrilles = parseInt(req.query.n) || 12;
  const global = genererCouverture(db.draws, null, nbGrilles, jour);
  const parTirage = [];
  for (const t of tiragesInfo) {
    const couv = genererCouverture(db.draws, t.nom, nbGrilles, jour);
    parTirage.push({ tirage: t.nom, heure: t.heure, type: t.type, couverture: couv });
  }
  res.json({ jour, jourNom: JOURS_NOMS[jour], global, parTirage });
});

app.get("/api/frequence", (req, res) => {
  const db = loadDB();
  if (db.draws.length === 0) return res.json({ error: "Base vide" });
  res.json(analyseFrequence(db.draws));
});

app.get("/api/distribution", (req, res) => {
  const db = loadDB();
  if (db.draws.length === 0) return res.json({ error: "Base vide" });
  res.json(analyseDistribution(db.draws));
});

app.post("/api/backtest", (req, res) => {
  try {
    const state = learnAndAdapt();
    if (!state) return res.json({ error: "Pas assez de donnees" });
    res.json({ success: true, weights: state.criteriaWeights, lastBacktest: state.lastBacktest });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/api/backtest-custom", (req, res) => {
  try {
    const { periode = 6, tirages = [], mise = 100, mode = "chance3", source = "both", dateDebut, dateFin } = req.body || {};
    const db = loadDB();
    if (db.draws.length < 200) return res.json({ error: "Pas assez de donnees" });
    const state = loadLearnState();

    const PARIS = {
      "1n":   { pick: 1, gains: { 1: 1100 } },
      "1ndc": { pick: 1, gains: { 1: 550 } },
      "2n":   { pick: 2, gains: { 2: 24000 } },
      "2ndc": { pick: 2, gains: { 2: 12000 } },
      "3n":   { pick: 3, gains: { 3: 200000 } },
      "3ndc": { pick: 3, gains: { 3: 100000 } },
      "ch3":  { pick: 3, gains: { 2: 6000, 3: 175000 } },
      "ch3dc":{ pick: 3, gains: { 2: 3000, 3: 87500 } },
      "ch4":  { pick: 4, gains: { 2: 3000, 3: 30000, 4: 1000000 } },
      "ch4dc":{ pick: 4, gains: { 2: 1500, 3: 15000, 4: 500000 } },
      "ch5":  { pick: 5, gains: { 2: 2000, 3: 10000, 4: 200000, 5: 5000000 } },
      "ch5dc":{ pick: 5, gains: { 2: 1000, 3: 5000, 4: 100000, 5: 2500000 } },
    };
    const pari = PARIS[mode] || PARIS["ch4dc"];
    const pickN = pari.pick;
    const gainsTable = pari.gains;
    const isDC = mode.includes("dc");

    function parseDt(s) {
      const p = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      return p ? new Date(parseInt(p[3]), parseInt(p[2]) - 1, parseInt(p[1])) : null;
    }
    function ajusterBT(nums, ranked) {
      let att = [...nums];
      for (let it = 0; it < 20; it++) {
        const s = att.reduce((a, b) => a + b, 0);
        const p = att.filter(n => n % 2 === 0).length;
        const h = att.filter(n => n > 45).length;
        if (s >= 160 && s <= 290 && p >= 1 && p <= 4 && h >= 1 && h <= 4) return att.sort((a, b) => a - b);
        let idx, cond;
        if (s < 160) { idx = att.indexOf(Math.min(...att)); cond = r => r.num > att[idx] && !att.includes(r.num); }
        else if (s > 290) { idx = att.indexOf(Math.max(...att)); cond = r => r.num < att[idx] && !att.includes(r.num); }
        else break;
        if (idx < 0) idx = att.length - 1;
        const rep = ranked.find(cond);
        if (rep) att[idx] = rep.num; else break;
      }
      return att.sort((a, b) => a - b);
    }

    const lastDate = parseDt(db.draws[0].date);
    let cutoff, endDate;
    if (dateDebut && dateFin) {
      const [dm, dy] = dateDebut.split("/").map(Number);
      const [fm, fy] = dateFin.split("/").map(Number);
      cutoff = new Date(dy, dm - 1, 1);
      endDate = new Date(fy, fm, 0, 23, 59, 59);
    } else {
      cutoff = new Date(lastDate);
      cutoff.setMonth(cutoff.getMonth() - Math.min(Math.max(periode, 1), 24));
      endDate = null;
    }
    const tirageSet = tirages.length > 0 ? new Set(tirages) : null;

    const hitDist = { bot: [0,0,0,0,0,0], ia: [0,0,0,0,0,0], lstm: [0,0,0,0,0,0] };
    const monthly = {};
    const perDraw = {};
    const winList = [];
    let totalPlays = 0, totalGainBot = 0, totalGainIA = 0, totalGainLSTM = 0;

    // DC = UP/DOWN: matchs comptes separement gagnants vs machine, on prend le meilleur
    function countHitsDC(nums, gagnants, machine) {
      const gSet = new Set(gagnants);
      const mSet = new Set(machine);
      const hitsG = nums.filter(n => gSet.has(n)).length;
      const hitsM = nums.filter(n => mSet.has(n)).length;
      return Math.max(hitsG, hitsM);
    }
    function countHitsStd(nums, gagnants) {
      const gSet = new Set(gagnants);
      return nums.filter(n => gSet.has(n)).length;
    }

    for (let i = 0; i < db.draws.length; i++) {
      const target = db.draws[i];
      const dt = parseDt(target.date);
      if (!dt || dt < cutoff) break;
      if (endDate && dt > endDate) continue;
      if (tirageSet && !tirageSet.has(target.type)) continue;

      const hist = db.draws.slice(i + 1);
      const filtered = hist.filter(d => d.type === target.type);
      if (filtered.length < 20) continue;

      const jour = dt.getDay();
      const cat = getCategoryForType(target.type);
      const w = state.categoryWeights[cat] || state.criteriaWeights;
      const tops = computeCriteriaTops(filtered, hist, 15, jour);
      if (!tops) continue;

      const ranked = convergenceScore(tops, w);
      const botAll = pickN >= 5 ? ajusterBT(ranked.slice(0, 5).map(r => r.num), ranked) : ranked.slice(0, 5).map(r => r.num);
      const botNums = botAll.slice(0, pickN);
      let iaNums = [], iaAll = [];
      if (neuralNet) {
        const nnS = predictNeural(neuralNet, hist, target.type, jour);
        if (nnS && nnS.length >= 5) { iaAll = nnS.slice(0, 5).map(s => s.num); iaNums = iaAll.slice(0, pickN).sort((a, b) => a - b); }
      }
      let lstmNums = [], lstmAll = [];
      if (lstmNet) {
        try {
          const lS = predictLSTM(lstmNet, hist, target.type, jour);
          if (lS && lS.length >= 5) { lstmAll = lS.slice(0, 5).map(s => s.num); lstmNums = lstmAll.slice(0, pickN).sort((a, b) => a - b); }
        } catch (e) {}
      }

      // Filtre consensus: top3 de 2+ sources en commun
      const top3Counts = {};
      for (const n of botAll.slice(0, 3)) top3Counts[n] = (top3Counts[n] || 0) + 1;
      for (const n of iaAll.slice(0, 3)) top3Counts[n] = (top3Counts[n] || 0) + 1;
      for (const n of lstmAll.slice(0, 3)) top3Counts[n] = (top3Counts[n] || 0) + 1;
      const hasConsensus = Object.values(top3Counts).some(c => c >= 2);
      if (source === "consensus" && !hasConsensus) continue;

      const mach = (target.machine || []).filter(n => n > 0);
      const hasMachine = mach.length > 0;

      const useSrcBot = source === "all" || source === "both" || source === "bot";
      const useSrcIA = source === "all" || source === "both" || source === "ia";
      const useSrcLSTM = source === "all" || source === "lstm" || source === "consensus";

      // DC = UP ou DOWN (gagnants OU machine, pas combine)
      const botH = useSrcBot ? (isDC && hasMachine ? countHitsDC(botNums, target.gagnants, mach) : countHitsStd(botNums, target.gagnants)) : 0;
      const iaH = (useSrcIA && iaNums.length > 0) ? (isDC && hasMachine ? countHitsDC(iaNums, target.gagnants, mach) : countHitsStd(iaNums, target.gagnants)) : 0;
      const lstmH = (useSrcLSTM && lstmNums.length > 0) ? (isDC && hasMachine ? countHitsDC(lstmNums, target.gagnants, mach) : countHitsStd(lstmNums, target.gagnants)) : 0;

      if (useSrcBot) hitDist.bot[Math.min(botH, pickN)]++;
      if (useSrcIA && iaNums.length > 0) hitDist.ia[Math.min(iaH, pickN)]++;
      if (useSrcLSTM && lstmNums.length > 0) hitDist.lstm[Math.min(lstmH, pickN)]++;

      const botGain = useSrcBot ? (gainsTable[Math.min(botH, pickN)] || 0) * (mise / 100) : 0;
      const iaGain = (useSrcIA && iaNums.length > 0) ? (gainsTable[Math.min(iaH, pickN)] || 0) * (mise / 100) : 0;
      const lstmGain = (useSrcLSTM && lstmNums.length > 0) ? (gainsTable[Math.min(lstmH, pickN)] || 0) * (mise / 100) : 0;
      totalGainBot += botGain;
      totalGainIA += iaGain;
      totalGainLSTM += lstmGain;
      totalPlays++;

      const nSources = (source === "all" ? 3 : source === "both" ? 2 : source === "consensus" ? 1 : 1);
      const mKey = String(dt.getMonth() + 1).padStart(2, "0") + "/" + dt.getFullYear();
      if (!monthly[mKey]) monthly[mKey] = { plays: 0, dep: 0, gainBot: 0, gainIA: 0, gainLSTM: 0 };
      const pariBySrc = nSources * mise;
      monthly[mKey].plays++;
      monthly[mKey].dep += pariBySrc;
      monthly[mKey].gainBot += botGain;
      monthly[mKey].gainIA += iaGain;
      monthly[mKey].gainLSTM += lstmGain;

      if (!perDraw[target.type]) perDraw[target.type] = { plays: 0, dep: 0, gain: 0, wins: 0 };
      perDraw[target.type].plays++;
      perDraw[target.type].dep += pariBySrc;
      perDraw[target.type].gain += botGain + iaGain + lstmGain;
      if (botGain > 0 || iaGain > 0 || lstmGain > 0) perDraw[target.type].wins++;

      if (botGain > 0 || iaGain > 0 || lstmGain > 0) {
        winList.push({
          date: target.date, tirage: target.type,
          botNums: (source !== "ia" && source !== "lstm") ? botNums : [],
          iaNums: (source !== "bot" && source !== "lstm") ? iaNums : [],
          lstmNums: (source !== "bot" && source !== "ia") ? lstmNums : [],
          resultat: target.gagnants,
          machine: mach,
          botHits: botH, iaHits: iaH, lstmHits: lstmH,
          botGain, iaGain, lstmGain,
          gainTotal: botGain + iaGain + lstmGain,
        });
      }
    }

    const nSources = (source === "all" ? 3 : source === "both" ? 2 : source === "consensus" ? 1 : 1);
    const pariBySrc = nSources * mise;
    const totalDep = totalPlays * pariBySrc;
    const totalGain = totalGainBot + totalGainIA + totalGainLSTM;
    const profit = totalGain - totalDep;

    const monthlyArr = Object.entries(monthly).sort().map(([m, v]) => ({
      mois: m, ...v, gain: v.gainBot + v.gainIA + (v.gainLSTM || 0), profit: v.gainBot + v.gainIA + (v.gainLSTM || 0) - v.dep,
    }));
    const perDrawArr = Object.entries(perDraw).sort((a, b) => b[1].gain - a[1].gain).map(([t, v]) => ({
      tirage: t, ...v, profit: v.gain - v.dep, roi: v.dep > 0 ? +((v.gain - v.dep) / v.dep * 100).toFixed(1) : 0,
    }));
    winList.sort((a, b) => b.gainTotal - a.gainTotal);

    res.json({
      success: true,
      params: { periode, tirages: tirages.length > 0 ? tirages : "tous", mise, mode, source, dateDebut: dateDebut || null, dateFin: dateFin || null },
      summary: { totalPlays, totalDep, totalGain, totalGainBot, totalGainIA, totalGainLSTM, profit, roi: totalDep > 0 ? +(profit / totalDep * 100).toFixed(1) : 0 },
      hitDist,
      monthly: monthlyArr,
      perDraw: perDrawArr,
      wins: winList.slice(0, 50),
      totalWins: winList.length,
    });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/api/train-learn", (req, res) => {
  try {
    const db = loadDB();
    const stateBefore = loadLearnState();
    const scoreBefore = backtestScore(db.draws, stateBefore.criteriaWeights, 300);
    console.log("[LEARN] Apprentissage demande...");
    const result = learnAndAdapt();
    if (!result) return res.json({ error: "Pas assez de donnees" });
    const scoreAfter = backtestScore(db.draws, result.criteriaWeights, 300);
    console.log("[LEARN] Termine: " + (scoreBefore * 100).toFixed(2) + "% -> " + (scoreAfter * 100).toFixed(2) + "%");
    res.json({
      success: true,
      scoreBefore: +(scoreBefore * 100).toFixed(2),
      scoreAfter: +(scoreAfter * 100).toFixed(2),
      delta: +((scoreAfter - scoreBefore) * 100).toFixed(2),
      weights: result.criteriaWeights,
      categories: Object.keys(result.categoryWeights).length,
      trainedOn: result.trainedOn,
    });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post("/api/train-nn", (req, res) => {
  try {
    const db = loadDB();
    console.log("[NN] Re-entrainement complet demande...");
    neuralNet = trainNeural(db.draws, 5, 32);
    neuralNet.save(MODEL_PATH);
    console.log("[NN] Modele re-entraine et sauvegarde.");
    res.json({ success: true, message: "NN re-entraine sur " + db.draws.length + " tirages" });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get("/api/learn-state", (req, res) => {
  const state = loadLearnState();
  const progression = (state.performanceLog || []).map(p => ({
    date: p.date,
    global: p.globalScore ? +(p.globalScore * 100).toFixed(2) : null,
    categories: p.categoryScores ? Object.fromEntries(
      Object.entries(p.categoryScores).map(([k, v]) => [k, v ? +(v * 100).toFixed(2) : null])
    ) : {},
    trainedOn: p.trainedOn,
  }));
  const history = (state.backtestHistory || []).slice(-10).map(h => ({
    date: h.date,
    score: h.score ? +(h.score * 100).toFixed(2) : null,
    prevScore: h.prevScore ? +(h.prevScore * 100).toFixed(2) : null,
    improved: h.improved,
  }));
  res.json({ ...state, progression, recentHistory: history });
});

app.get("/api/performance", (req, res) => {
  const history = loadHistory();
  const preds = history.predictions.filter(p => p.compared);
  if (preds.length === 0) return res.json({ error: "Aucune comparaison" });

  const eRandom = 5 * 5 / 90;
  const totalHits = preds.reduce((s, p) => s + (p.nbExacts || 0), 0);
  const avgHits = totalHits / preds.length;

  // Par type de tirage
  const byType = {};
  for (const p of preds) {
    if (!byType[p.tirage]) byType[p.tirage] = { total: 0, hits: 0, max: 0 };
    byType[p.tirage].total++;
    byType[p.tirage].hits += (p.nbExacts || 0);
    if ((p.nbExacts || 0) > byType[p.tirage].max) byType[p.tirage].max = p.nbExacts;
  }
  const typePerf = Object.entries(byType).map(([t, s]) => ({
    tirage: t, category: getCategoryForType(t),
    total: s.total, hits: s.hits, max: s.max,
    avg: +(s.hits / s.total).toFixed(3),
    lift: +((s.hits / s.total) / eRandom).toFixed(2),
  })).sort((a, b) => b.avg - a.avg);

  // Par categorie
  const byCat = {};
  for (const p of preds) {
    const cat = getCategoryForType(p.tirage);
    if (!byCat[cat]) byCat[cat] = { total: 0, hits: 0 };
    byCat[cat].total++;
    byCat[cat].hits += (p.nbExacts || 0);
  }
  const catPerf = Object.entries(byCat).map(([c, s]) => ({
    category: c, total: s.total, hits: s.hits,
    avg: +(s.hits / s.total).toFixed(3),
    lift: +((s.hits / s.total) / eRandom).toFixed(2),
  })).sort((a, b) => b.avg - a.avg);

  // Par semaine
  const byWeek = {};
  for (const p of preds) {
    const parts = p.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!parts) continue;
    const d = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
    const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());
    const wk = ws.toISOString().slice(0, 10);
    if (!byWeek[wk]) byWeek[wk] = { total: 0, hits: 0 };
    byWeek[wk].total++;
    byWeek[wk].hits += (p.nbExacts || 0);
  }
  const weekPerf = Object.entries(byWeek).sort().map(([w, s]) => ({
    week: w, total: s.total, hits: s.hits,
    avg: +(s.hits / s.total).toFixed(3),
  }));

  // Top predictions
  const best = preds.filter(p => (p.nbExacts || 0) >= 2).sort((a, b) => b.nbExacts - a.nbExacts).slice(0, 10).map(p => ({
    date: p.date, tirage: p.tirage, nbExacts: p.nbExacts,
    prediction: p.nums, resultat: p.resultat,
    communs: p.nums.filter(n => (p.resultat || []).includes(n)),
  }));

  // ═══ TRACKING IA vs CLASSIQUE ═══
  const nnByWeek = {};
  let nnTotal = 0, nnHits = 0, classicWins = 0, nnWins = 0, ties = 0;
  for (const a of history.analyses) {
    for (const c of (a.comparaisons || [])) {
      if (!c.comp || !c.neuralComp) continue;
      const parts2 = a.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (parts2) {
        const d2 = new Date(parseInt(parts2[3]), parseInt(parts2[2]) - 1, parseInt(parts2[1]));
        const ws2 = new Date(d2); ws2.setDate(d2.getDate() - d2.getDay());
        const wk2 = ws2.toISOString().slice(0, 10);
        if (!nnByWeek[wk2]) nnByWeek[wk2] = { total: 0, hits: 0 };
        nnByWeek[wk2].total++;
        nnByWeek[wk2].hits += c.neuralComp.nbExacts;
      }
      nnTotal++;
      nnHits += c.neuralComp.nbExacts;
      if (c.comp.nbExacts > c.neuralComp.nbExacts) classicWins++;
      else if (c.neuralComp.nbExacts > c.comp.nbExacts) nnWins++;
      else ties++;
    }
  }
  const nnWeekPerf = Object.entries(nnByWeek).sort().map(([w, s]) => ({
    week: w, total: s.total, hits: s.hits, avg: +(s.hits / s.total).toFixed(3),
  }));
  const vsIA = {
    nnTotal, nnHits, nnAvg: nnTotal > 0 ? +(nnHits / nnTotal).toFixed(3) : 0,
    nnLift: nnTotal > 0 ? +((nnHits / nnTotal) / eRandom).toFixed(2) : 0,
    classicWins, nnWins, ties,
    nnByWeek: nnWeekPerf,
  };

  // Poids par categorie (etat actuel de l'apprentissage)
  const state = loadLearnState();

  res.json({
    total: preds.length, totalHits, avgHits: +avgHits.toFixed(3),
    eRandom: +eRandom.toFixed(3), lift: +(avgHits / eRandom).toFixed(2),
    byType: typePerf, byCategory: catPerf, byWeek: weekPerf, best, vsIA,
    categoryWeights: state.categoryWeights,
    globalWeights: state.criteriaWeights,
  });
});

app.get("/api/resultats", (req, res) => {
  const db = loadDB();
  res.json(db.draws.slice(0, 100));
});

app.get("/api/resultats-jour", (req, res) => {
  const db = loadDB();
  const now = new Date();
  const todayStr = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const todayDraws = db.draws.filter(d => d.date === todayStr);
  const jour = now.getDay();
  const tiragesInfo = getTiragesJour(jour);
  const horaires = {};
  for (const t of tiragesInfo) horaires[t.nom] = t.heure;
  todayDraws.sort((a, b) => (horaires[a.type] || "").localeCompare(horaires[b.type] || ""));
  res.json({ date: todayStr, jourNom: JOURS_NOMS[jour], tirages: todayDraws, horaires });
});

app.get("/api/semaine", (req, res) => {
  const db = loadDB();
  if (db.draws.length === 0) return res.json({ error: "Base vide" });
  const now = new Date();

  // Performance par jour (backtest data from rapport)
  const jourPerf = { 0: 6.9, 1: 5.6, 2: 5.7, 3: 6.0, 4: 6.5, 5: 6.2, 6: 4.7 };

  // Types les plus performants
  const topTypes = new Set(["Special Weekend 3h", "Prestige", "Akwaba", "Reveil", "Diamant", "Digital Reveil 7h", "Awale", "Digital 23h"]);

  const jours = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const j = d.getDay();
    const tiragesInfo = getTiragesJour(j);
    const preds = [];
    for (const t of tiragesInfo) {
      const conv = predictConvergence(db.draws, t.nom, j);
      const pair = scoringPaires(db.draws, t.nom);

      // Ajouter combo NEURAL pour la semaine aussi
      let nnCombo = null;
      if (neuralNet && conv) {
        try {
          const nnS = predictNeural(neuralNet, db.draws, t.nom, j, []);
          if (nnS) nnCombo = nnS.slice(0, 5).map(s => s.num).sort((a, b) => a - b);
        } catch (e) { /* silencieux */ }
      }

      // Ajouter combo LSTM pour la semaine
      let lstmCombo = null;
      if (lstmNet && conv) {
        try {
          const lS = predictLSTM(lstmNet, db.draws, t.nom, j, []);
          if (lS) lstmCombo = lS.slice(0, 5).map(s => s.num).sort((a, b) => a - b);
        } catch (e) { /* silencieux */ }
      }

      const combos = conv ? conv.combos.slice(0, 3) : null;
      if (combos && nnCombo) combos.push({ nom: "NEURAL", nums: nnCombo, confiance: "IA" });
      if (combos && lstmCombo) combos.push({ nom: "LSTM", nums: lstmCombo, confiance: "LSTM" });

      preds.push({
        tirage: t.nom, heure: t.heure, type: t.type,
        combo: conv ? conv.combos[0].nums : null,
        combos,
        neural: nnCombo,
        lstm: lstmCombo,
        paire1: pair ? pair.paire1 : null,
        paire2: pair ? pair.paire2 : null,
        isTop: topTypes.has(t.nom),
        nbTirages: conv ? conv.nbTirages : 0,
      });
    }
    jours.push({
      date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      jour: JOURS_NOMS[j],
      jourIdx: j,
      perf: jourPerf[j] || 5.6,
      predictions: preds,
    });
  }
  res.json(jours);
});

if (IS_VERCEL) {
  // Vercel serverless — charger le NN si dispo, pas de timers
  const db = loadDB();
  try {
    if (fs.existsSync(path.join(__dirname, "neural_model.json"))) {
      neuralNet = NeuralNet.load(path.join(__dirname, "neural_model.json"));
    }
    if (fs.existsSync(path.join(__dirname, "lstm_model.json"))) {
      lstmNet = LSTMNet.load(path.join(__dirname, "lstm_model.json"));
    }
  } catch (e) {}
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  LONACI DASHBOARD — http://localhost:${PORT}        ║`);
    console.log(`║  Auto-update activé (toutes les minutes)         ║`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
    autoUpdate();
    const db = loadDB();
    try { learnAndAdapt(); } catch (e) { console.log("[LEARN] Erreur backtest:", e.message); }
    loadOrTrainNN(db);
    loadOrTrainLSTM(db);
    try { autoSavePredictions(db); } catch (e) { console.log("[AUTO-SAVE] Erreur:", e.message); }
    catchUpResults().catch(e => console.log("[CATCHUP] Erreur:", e.message));
  });
}
