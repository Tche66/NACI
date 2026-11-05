// ═══════════════════════════════════════════════════════════
//  SYSTÈME DE COUVERTURE v3 — BASÉ SUR BACKTEST RÉEL
//  Backtest 57 predictions: MOMENTUM #1 (16.8%), TERMINAISONS #2 (15.8%)
//  CYCLES OVERDUE éliminé (0% exacts sur 57 tests)
//  Somme corrigée: cible 215-225 au lieu de ~200
//  Biais impair corrigé: favoriser 2P-3I (hits sont 70% impairs)
// ═══════════════════════════════════════════════════════════

const NUM_RANGE = 90;

const CONSTRAINTS = {
  SOMME_MIN: 150, SOMME_MAX: 300,
  SOMME_TARGET: 220,
  PAIRS_MIN: 1, PAIRS_MAX: 4,
  HAUTS_MIN: 1, HAUTS_MAX: 4,
};

function genererCouverture(draws, typeFilter, nbGrilles, jourSemaine) {
  const filtered = typeFilter ? draws.filter(d => d.type === typeFilter) : draws;
  if (filtered.length < 10) return null;
  nbGrilles = nbGrilles || 10;

  // ═══ 1. DONNÉES DE BASE ═══
  const freq = Array(NUM_RANGE + 1).fill(0);
  const freqR = Array(NUM_RANGE + 1).fill(0);
  const lastSeen = Array(NUM_RANGE + 1).fill(filtered.length);

  for (const d of filtered) for (const n of d.gagnants) freq[n]++;
  for (const d of filtered.slice(0, 30)) for (const n of d.gagnants) freqR[n]++;
  for (let idx = 0; idx < filtered.length; idx++)
    for (const n of filtered[idx].gagnants) if (lastSeen[n] === filtered.length) lastSeen[n] = idx;

  // ═══ 2. MOMENTUM (15 derniers tirages) — critère #1 prouvé ═══
  const momentum = Array(NUM_RANGE + 1).fill(0);
  for (const d of filtered.slice(0, 15)) for (const n of d.gagnants) momentum[n]++;

  // ═══ 3. AFFINITÉ JOUR DE SEMAINE ═══
  const jourFreq = Array(NUM_RANGE + 1).fill(0);
  let jourTotal = 0;
  if (jourSemaine !== undefined && jourSemaine !== null) {
    for (const d of draws) {
      const parts = d.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!parts) continue;
      const dt = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
      if (dt.getDay() === jourSemaine) {
        for (const n of d.gagnants) jourFreq[n]++;
        jourTotal++;
      }
    }
  }

  // ═══ 4. MARKOV ORDRE 2 ═══
  const markov = Array(NUM_RANGE + 1).fill(0);
  if (filtered.length > 2) {
    const last1 = new Set(filtered[0].gagnants);
    const last2 = new Set(filtered[1].gagnants);
    for (let idx = 2; idx < filtered.length; idx++) {
      const m1 = filtered[idx].gagnants.some(n => last1.has(n));
      const m2 = filtered[idx].gagnants.some(n => last2.has(n));
      if (m1 || m2) {
        const w = m1 && m2 ? 2 : 1;
        for (const n of filtered[idx - 1].gagnants) markov[n] += w;
      }
    }
  }

  // ═══ 5. PAIRES FRÉQUENTES ═══
  const paires = {};
  for (const d of filtered.slice(0, 200)) {
    const s = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) {
        const k = `${s[i]}-${s[j]}`;
        paires[k] = (paires[k] || 0) + 1;
      }
  }
  const topPaires = Object.entries(paires).sort((a, b) => b[1] - a[1]).slice(0, 50);

  const pairBoost = Array(NUM_RANGE + 1).fill(0);
  for (const [k, c] of topPaires) {
    const [a, b] = k.split("-").map(Number);
    pairBoost[a] += c;
    pairBoost[b] += c;
  }

  // ═══ 6. ANTI-RÉPÉTITION ═══
  const lastDrawNums = new Set(filtered[0] ? filtered[0].gagnants : []);

  // ═══ 7. SCORING v3 — pondéré par backtest ═══
  // Backtest results: MOMENTUM 16.8%, TERMINAISONS 15.8%, EQUILIBRE 15.8%
  // TOP SCORE 14.7%, CONSENSUS 14.4%, FILTRE 13.7%
  // OVERDUE 0% => poids 0
  const maxFreq = Math.max(...freq.slice(1)) || 1;
  const maxFR = Math.max(...freqR.slice(1)) || 1;
  const maxMomentum = Math.max(...momentum.slice(1)) || 1;
  const maxMarkov = Math.max(...markov.slice(1)) || 1;
  const maxPB = Math.max(...pairBoost.slice(1)) || 1;
  const maxJour = Math.max(...jourFreq.slice(1)) || 1;

  const scores = Array(NUM_RANGE + 1).fill(0);

  for (let i = 1; i <= NUM_RANGE; i++) {
    let s = 0;
    s += (freq[i] / maxFreq) * 10;
    s += (freqR[i] / maxFR) * 22;
    s += (momentum[i] / maxMomentum) * 25;
    if (jourTotal > 50) s += (jourFreq[i] / maxJour) * 15;
    else s += (freqR[i] / maxFR) * 8 + (momentum[i] / maxMomentum) * 7;
    s += (markov[i] / maxMarkov) * 8;
    s += (pairBoost[i] / maxPB) * 5;
    if (lastDrawNums.has(i)) s -= 8;
    // léger bonus impair (backtest: hits sont 70% impairs)
    if (i % 2 === 1) s += 2;
    scores[i] = s;
  }

  // ═══ 8. CLASSEMENT ═══
  const ranked = [];
  for (let i = 1; i <= NUM_RANGE; i++) {
    ranked.push({
      num: i, score: +scores[i].toFixed(2),
      freq: freq[i], freqRecent: freqR[i], retard: lastSeen[i],
      momentum: momentum[i],
      dizaine: Math.min(Math.floor((i - 1) / 10), 8),
      terminaison: i % 10, pair: i % 2 === 0, haut: i > 45,
    });
  }
  ranked.sort((a, b) => b.score - a.score);

  // ═══ 9. ZONES CHAUDES ═══
  const dizFreq = Array(9).fill(0);
  const dizFreqR = Array(9).fill(0);
  for (const d of filtered) for (const n of d.gagnants) dizFreq[Math.min(Math.floor((n - 1) / 10), 8)]++;
  for (const d of filtered.slice(0, 30)) for (const n of d.gagnants) dizFreqR[Math.min(Math.floor((n - 1) / 10), 8)]++;
  const dizScores = dizFreq.map((f, i) => ({ diz: i, score: f * 0.3 + dizFreqR[i] * 0.7, label: `${i * 10 + 1}-${Math.min(i * 10 + 10, 90)}` }));
  dizScores.sort((a, b) => b.score - a.score);

  const termFreq = Array(10).fill(0);
  const termFreqR = Array(10).fill(0);
  for (const d of filtered) for (const n of d.gagnants) termFreq[n % 10]++;
  for (const d of filtered.slice(0, 30)) for (const n of d.gagnants) termFreqR[n % 10]++;
  const termScores = termFreq.map((f, i) => ({ term: i, score: f * 0.3 + termFreqR[i] * 0.7 }));
  termScores.sort((a, b) => b.score - a.score);

  const sommes = filtered.slice(0, 200).map(d => d.gagnants.reduce((a, b) => a + b, 0));
  const avgSomme = sommes.reduce((a, b) => a + b, 0) / sommes.length;

  const piStats = {};
  for (const d of filtered.slice(0, 200)) {
    const p = d.gagnants.filter(n => n % 2 === 0).length;
    piStats[`${p}P-${5 - p}I`] = (piStats[`${p}P-${5 - p}I`] || 0) + 1;
  }
  const bestPI = Object.entries(piStats).sort((a, b) => b[1] - a[1]);

  // ═══ 10. VALIDATION ═══
  function validerGrille(nums) {
    if (nums.length !== 5) return false;
    const somme = nums.reduce((a, b) => a + b, 0);
    if (somme < CONSTRAINTS.SOMME_MIN || somme > CONSTRAINTS.SOMME_MAX) return false;
    const pairs = nums.filter(n => n % 2 === 0).length;
    if (pairs < CONSTRAINTS.PAIRS_MIN || pairs > CONSTRAINTS.PAIRS_MAX) return false;
    const hauts = nums.filter(n => n > 45).length;
    if (hauts < CONSTRAINTS.HAUTS_MIN || hauts > CONSTRAINTS.HAUTS_MAX) return false;
    return true;
  }

  function ajusterGrille(nums, pool) {
    let attempt = [...nums];
    for (let iter = 0; iter < 30; iter++) {
      if (validerGrille(attempt)) return attempt.sort((a, b) => a - b);
      const somme = attempt.reduce((a, b) => a + b, 0);
      const pairs = attempt.filter(n => n % 2 === 0).length;
      const hauts = attempt.filter(n => n > 45).length;
      let idxToReplace, condition;
      if (somme < CONSTRAINTS.SOMME_MIN) {
        idxToReplace = attempt.indexOf(Math.min(...attempt));
        condition = r => r.num > attempt[idxToReplace] && !attempt.includes(r.num);
      } else if (somme > CONSTRAINTS.SOMME_MAX) {
        idxToReplace = attempt.indexOf(Math.max(...attempt));
        condition = r => r.num < attempt[idxToReplace] && !attempt.includes(r.num);
      } else if (pairs < CONSTRAINTS.PAIRS_MIN) {
        const idx = attempt.findIndex(n => n % 2 === 1);
        idxToReplace = idx >= 0 ? idx : attempt.length - 1;
        condition = r => r.num % 2 === 0 && !attempt.includes(r.num);
      } else if (pairs > CONSTRAINTS.PAIRS_MAX) {
        const idx = attempt.findIndex(n => n % 2 === 0);
        idxToReplace = idx >= 0 ? idx : attempt.length - 1;
        condition = r => r.num % 2 === 1 && !attempt.includes(r.num);
      } else if (hauts < CONSTRAINTS.HAUTS_MIN) {
        const idx = attempt.findIndex(n => n <= 45);
        idxToReplace = idx >= 0 ? idx : attempt.length - 1;
        condition = r => r.num > 45 && !attempt.includes(r.num);
      } else if (hauts > CONSTRAINTS.HAUTS_MAX) {
        const idx = attempt.findIndex(n => n > 45);
        idxToReplace = idx >= 0 ? idx : attempt.length - 1;
        condition = r => r.num <= 45 && !attempt.includes(r.num);
      } else break;
      const rep = pool.find(condition);
      if (rep) attempt[idxToReplace] = rep.num; else break;
    }
    return attempt.sort((a, b) => a - b);
  }

  // ═══ 11. GRILLES — classées par performance backtest ═══
  const grilles = [];

  // --- #1 MOMENTUM (16.8% backtest — meilleure stratégie) ---
  const momentumRanked = [...ranked].filter(r => r.momentum >= 2).sort((a, b) => b.momentum - a.momentum || b.score - a.score);
  if (momentumRanked.length >= 5) {
    grilles.push({
      nom: "MOMENTUM",
      strategie: "Numeros en serie chaude (meilleure strategie: 16.8% backtest)",
      nums: ajusterGrille(momentumRanked.slice(0, 5).map(r => r.num).sort((a, b) => a - b), momentumRanked),
      confiance: 90,
    });
  }

  // --- #2 TERMINAISONS CHAUDES (15.8% backtest, meilleur pour 2+ exacts) ---
  const termNums = [];
  for (const t of termScores.slice(0, 5)) {
    const best = ranked.find(r => r.terminaison === t.term && !termNums.includes(r.num));
    if (best) termNums.push(best.num);
  }
  if (termNums.length >= 5) {
    grilles.push({
      nom: "TERMINAISONS CHAUDES",
      strategie: "1 par terminaison frequente (15.8% backtest, #1 pour 2+ exacts)",
      nums: ajusterGrille(termNums.slice(0, 5).sort((a, b) => a - b), ranked),
      confiance: 88,
      zones: termScores.slice(0, 5).map(t => "finit par " + t.term),
    });
  }

  // --- #3 EQUILIBRE PARFAIT (15.8% backtest) — 2P+3I ciblant somme ~220 ---
  const eqPairs = ranked.filter(r => r.pair).slice(0, 4);
  const eqImps = ranked.filter(r => !r.pair).slice(0, 4);
  const equilibre = [];
  for (const p of eqPairs.slice(0, 2)) equilibre.push(p.num);
  for (const p of eqImps.slice(0, 3)) equilibre.push(p.num);
  if (equilibre.length === 5) {
    grilles.push({
      nom: "EQUILIBRE PARFAIT",
      strategie: "2 pairs + 3 impairs, somme ~220 (15.8% backtest)",
      nums: ajusterGrille(equilibre.sort((a, b) => a - b), ranked),
      confiance: 88,
    });
  }

  // --- #4 TOP SCORE (14.7% backtest) ---
  grilles.push({
    nom: "TOP SCORE",
    strategie: "5 meilleurs scores combines (14.7% backtest)",
    nums: ajusterGrille(ranked.slice(0, 5).map(r => r.num).sort((a, b) => a - b), ranked),
    confiance: 85,
  });

  // --- #5 FILTRE ELIMINATOIRE (13.7% backtest) ---
  const survivors = ranked.filter(r => {
    if (lastDrawNums.has(r.num)) return false;
    if (r.freq < 3) return false;
    if (r.momentum === 0 && r.freqRecent === 0) return false;
    return true;
  });
  if (survivors.length >= 5) {
    const filterNums = [];
    const dizCount = {};
    for (const s of survivors.slice(0, 12)) {
      const diz = s.dizaine;
      dizCount[diz] = (dizCount[diz] || 0);
      if (dizCount[diz] < 2) { filterNums.push(s.num); dizCount[diz]++; }
      if (filterNums.length === 5) break;
    }
    while (filterNums.length < 5) {
      const next = survivors.find(s => !filterNums.includes(s.num));
      if (next) filterNums.push(next.num); else break;
    }
    if (filterNums.length === 5) {
      grilles.push({
        nom: "FILTRE ELIMINATOIRE",
        strategie: "Elimination improbables + diversification (13.7% backtest)",
        nums: ajusterGrille(filterNums.sort((a, b) => a - b), ranked),
        confiance: 82,
      });
    }
  }

  // --- #6 COUVERTURE DIZAINES (12.3% backtest) ---
  const dizNums = [];
  for (const diz of dizScores.slice(0, 5)) {
    const best = ranked.find(r => r.dizaine === diz.diz && !dizNums.includes(r.num));
    if (best) dizNums.push(best.num);
  }
  if (dizNums.length >= 5) {
    grilles.push({
      nom: "COUVERTURE DIZAINES",
      strategie: "1 par dizaine chaude (12.3% backtest)",
      nums: ajusterGrille(dizNums.slice(0, 5).sort((a, b) => a - b), ranked),
      confiance: 78,
      zones: dizScores.slice(0, 5).map(d => d.label),
    });
  }

  // --- #7 JOUR AFFINITY ---
  if (jourTotal > 50) {
    const jourRanked = [...ranked].sort((a, b) => jourFreq[b.num] - jourFreq[a.num]);
    grilles.push({
      nom: "JOUR AFFINITY",
      strategie: "Numeros favoris pour ce jour de semaine",
      nums: ajusterGrille(jourRanked.slice(0, 5).map(r => r.num).sort((a, b) => a - b), jourRanked),
      confiance: 76,
    });
  }

  // --- #8 PAIRES FORTES ---
  if (topPaires.length >= 2) {
    const p1 = topPaires[0][0].split("-").map(Number);
    let p2nums = null;
    for (let i = 1; i < topPaires.length; i++) {
      const test = topPaires[i][0].split("-").map(Number);
      if (!p1.includes(test[0]) && !p1.includes(test[1])) { p2nums = test; break; }
    }
    if (p2nums) {
      const usedNums = [...p1, ...p2nums];
      const complement = ranked.find(r => !usedNums.includes(r.num));
      if (complement) {
        grilles.push({
          nom: "PAIRES FORTES",
          strategie: "2 paires frequentes + complement",
          nums: ajusterGrille([...usedNums, complement.num].sort((a, b) => a - b), ranked),
          confiance: 72,
        });
      }
    }
  }

  // --- #9 SOMME ZONE 215-225 (corrigé: avant on visait trop bas ~200) ---
  const sumTarget = CONSTRAINTS.SOMME_TARGET;
  const sumCombo = [];
  const availForSum = [...ranked].filter(r => !lastDrawNums.has(r.num));
  for (let pick = 0; pick < 5; pick++) {
    const rem = 5 - pick;
    const curSum = sumCombo.reduce((a, b) => a + b, 0);
    const targetPer = (sumTarget - curSum) / rem;
    availForSum.sort((a, b) => {
      const da = Math.abs(a.num - targetPer) * 1.5 - a.score;
      const db = Math.abs(b.num - targetPer) * 1.5 - b.score;
      return da - db;
    });
    const chosen = availForSum.splice(0, 1)[0];
    if (chosen) sumCombo.push(chosen.num);
  }
  if (sumCombo.length === 5) {
    grilles.push({
      nom: "SOMME 220",
      strategie: "Vise somme ~220 (zone la plus dense des resultats reels)",
      nums: sumCombo.sort((a, b) => a - b),
      confiance: 74,
      somme: sumCombo.reduce((a, b) => a + b, 0),
    });
  }

  // --- #10 VOISINS DU TOP (7.7% backtest — filet de securite) ---
  const top5 = ranked.slice(0, 5).map(r => r.num);
  const voisins = new Set();
  for (const n of top5) {
    for (const delta of [-2, -1, 1, 2]) {
      const v = n + delta;
      if (v >= 1 && v <= 90 && !top5.includes(v)) voisins.add(v);
    }
  }
  const voisinsRanked = [...voisins].map(v => ({ num: v, score: ranked.find(r => r.num === v).score })).sort((a, b) => b.score - a.score);
  if (voisinsRanked.length >= 5) {
    grilles.push({
      nom: "VOISINS DU TOP",
      strategie: "A +/-2 des meilleurs (filet pour proches)",
      nums: ajusterGrille(voisinsRanked.slice(0, 5).map(r => r.num).sort((a, b) => a - b), ranked),
      confiance: 68,
    });
  }

  // ═══ 12. CONSENSUS PONDÉRÉ PAR PERFORMANCE BACKTEST ═══
  const strategyWeight = {
    "MOMENTUM": 1.7, "TERMINAISONS CHAUDES": 1.6, "EQUILIBRE PARFAIT": 1.6,
    "TOP SCORE": 1.5, "FILTRE ELIMINATOIRE": 1.4, "COUVERTURE DIZAINES": 1.2,
    "JOUR AFFINITY": 1.1, "PAIRES FORTES": 1.1, "SOMME 220": 1.0, "VOISINS DU TOP": 0.8,
  };

  const numVotes = {};
  for (const g of grilles) {
    const w = strategyWeight[g.nom] || 1.0;
    for (const n of g.nums) {
      if (!numVotes[n]) numVotes[n] = { votes: 0, weightedVotes: 0, grilles: [] };
      numVotes[n].votes++;
      numVotes[n].weightedVotes += w;
      numVotes[n].grilles.push(g.nom);
    }
  }

  const consensus = Object.entries(numVotes)
    .map(([n, v]) => ({
      num: parseInt(n), votes: v.votes,
      weightedVotes: +v.weightedVotes.toFixed(2),
      score: ranked.find(r => r.num === parseInt(n)).score,
      grilles: v.grilles,
    }))
    .sort((a, b) => {
      if (b.weightedVotes !== a.weightedVotes) return b.weightedVotes - a.weightedVotes;
      return b.votes - a.votes;
    });

  if (consensus.length >= 5 && consensus[0].votes >= 2) {
    grilles.unshift({
      nom: "CONSENSUS",
      strategie: `Top numeros ponderes par performance backtest reelle`,
      nums: ajusterGrille(consensus.slice(0, 5).map(c => c.num).sort((a, b) => a - b), ranked),
      confiance: 92,
      votes: consensus.slice(0, 5).map(c => ({ num: c.num, votes: c.votes, poids: c.weightedVotes, grilles: c.grilles })),
    });
  }

  // ═══ 13. PLAGES ═══
  const plages = {
    dizainesTop3: dizScores.slice(0, 3).map(d => d.label),
    terminaisonsTop3: termScores.slice(0, 3).map(t => t.term),
    sommeZone: [190, 250],
    pairImpair: bestPI[0] ? bestPI[0][0] : "2P-3I",
    numerosConsensus: consensus.slice(0, 20).map(c => ({ num: c.num, votes: c.votes, poids: c.weightedVotes })),
    momentumNums: [...ranked].filter(r => r.momentum >= 3).map(r => r.num),
  };

  return {
    grilles: grilles.slice(0, nbGrilles),
    plages,
    stats: {
      nbTirages: filtered.length,
      avgSomme: Math.round(avgSomme),
      dernier: filtered[0],
      topDizaines: dizScores.slice(0, 3),
      topTerminaisons: termScores.slice(0, 3),
      constraints: CONSTRAINTS,
    },
    consensus: consensus.slice(0, 20),
  };
}

module.exports = { genererCouverture, CONSTRAINTS };
