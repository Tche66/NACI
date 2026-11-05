const ExcelJS = require("exceljs");
const https = require("https");

// ═══════════════════════════════════════════════════════════════
//  LONACI LOTO BONHEUR — MOTEUR D'ANALYSE STATISTIQUE COMPLET
// ═══════════════════════════════════════════════════════════════

const MONTHS_FR = [
  "janvier","février","mars","avril","mai","juin",
  "juillet","août","septembre","octobre","novembre","décembre",
];
const NUM_RANGE = 90;
const DRAW_SIZE = 5;

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

function getLast12Months() {
  const months = [];
  const now = new Date(2026, 9);
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i);
    months.push(`${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`);
  }
  return months;
}

function parseNums(str) {
  if (!str || str.includes(".")) return null;
  return str.split("-").map((n) => parseInt(n.trim())).filter((n) => n >= 1 && n <= 90);
}

function extractYear(s) { const m = s.match(/(\d{4})/); return m ? m[1] : "2026"; }

async function loadAllDraws() {
  const months = getLast12Months();
  const draws = [];
  for (const m of months) {
    console.log(`  Chargement: ${m}...`);
    try {
      const json = await fetchJSON(`https://lotobonheur.ci/api/results?monthYear=${encodeURIComponent(m)}`);
      if (!json.drawsResultsWeekly) continue;
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
            if (wn && wn.length === 5) {
              draws.push({ date: dateStr, type: d.drawName, gagnants: wn, machine: mn });
            }
          }
        }
      }
    } catch (e) { console.log(`  ERREUR: ${e.message}`); }
  }
  return draws;
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 1 — FRÉQUENCE & TEMPÉRATURE
// ═══════════════════════════════════════════════════════════════

function analyseFrequence(draws) {
  const freq = Array(NUM_RANGE + 1).fill(0);
  const recent = Array(NUM_RANGE + 1).fill(0); // 50 derniers tirages
  const last50 = draws.slice(0, 50);
  const freqRecent = Array(NUM_RANGE + 1).fill(0);

  for (const d of draws) for (const n of d.gagnants) freq[n]++;
  for (const d of last50) for (const n of d.gagnants) freqRecent[n]++;

  const totalNums = draws.length * DRAW_SIZE;
  const expected = totalNums / NUM_RANGE;

  const result = [];
  for (let i = 1; i <= NUM_RANGE; i++) {
    const ecart = ((freq[i] - expected) / expected) * 100;
    result.push({
      num: i, freq: freq[i], freqRecent: freqRecent[i],
      pct: (freq[i] / totalNums * 100),
      ecart,
      temperature: freqRecent[i] >= 5 ? "CHAUD" : freqRecent[i] >= 3 ? "TIEDE" : "FROID",
    });
  }
  return result.sort((a, b) => b.freq - a.freq);
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 2 — RETARD (GAP ANALYSIS)
// ═══════════════════════════════════════════════════════════════

function analyseRetard(draws) {
  const lastSeen = {};
  for (let i = 1; i <= NUM_RANGE; i++) lastSeen[i] = -1;

  for (let idx = 0; idx < draws.length; idx++) {
    for (const n of draws[idx].gagnants) {
      if (lastSeen[n] === -1) lastSeen[n] = idx;
    }
  }

  const gaps = [];
  for (let i = 1; i <= NUM_RANGE; i++) {
    const retard = lastSeen[i] === -1 ? draws.length : lastSeen[i];
    gaps.push({ num: i, retard, status: retard >= 30 ? "TRÈS EN RETARD" : retard >= 15 ? "EN RETARD" : "NORMAL" });
  }
  return gaps.sort((a, b) => b.retard - a.retard);
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 3 — ANALYSE BINAIRE
// ═══════════════════════════════════════════════════════════════

function analyseBinaire(draws) {
  const bitFreq = Array(7).fill(null).map(() => ({ zero: 0, one: 0 }));
  let totalNums = 0;

  for (const d of draws) {
    for (const n of d.gagnants) {
      const bin = n.toString(2).padStart(7, "0");
      for (let b = 0; b < 7; b++) {
        if (bin[b] === "1") bitFreq[b].one++;
        else bitFreq[b].zero++;
      }
      totalNums++;
    }
  }

  const bitAnalysis = bitFreq.map((bf, i) => ({
    bit: `Bit ${6 - i} (valeur ${Math.pow(2, 6 - i)})`,
    position: 6 - i,
    valeur: Math.pow(2, 6 - i),
    zeros: bf.zero,
    ones: bf.one,
    ratioBit1: (bf.one / (bf.zero + bf.one) * 100).toFixed(2) + "%",
    tendance: bf.one > bf.zero ? "1 dominant" : "0 dominant",
  }));

  const sumBits = [];
  for (const d of draws) {
    const total = d.gagnants.reduce((s, n) => s + n.toString(2).split("1").length - 1, 0);
    sumBits.push(total);
  }
  const avgBits = sumBits.reduce((a, b) => a + b, 0) / sumBits.length;

  const parityBin = { pairBin: 0, impairBin: 0 };
  for (const d of draws) {
    for (const n of d.gagnants) {
      const bits1 = n.toString(2).split("1").length - 1;
      if (bits1 % 2 === 0) parityBin.pairBin++;
      else parityBin.impairBin++;
    }
  }

  const xorPatterns = [];
  for (const d of draws) {
    let xorResult = 0;
    for (const n of d.gagnants) xorResult ^= n;
    xorPatterns.push(xorResult);
  }
  const xorFreq = {};
  for (const x of xorPatterns) xorFreq[x] = (xorFreq[x] || 0) + 1;
  const topXor = Object.entries(xorFreq).sort((a, b) => b[1] - a[1]).slice(0, 20);

  return { bitAnalysis, avgBits, parityBin, topXor };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 4 — PAIRES & TRIPLETS FRÉQUENTS
// ═══════════════════════════════════════════════════════════════

function analysePaires(draws) {
  const paires = {};
  const triplets = {};

  for (const d of draws) {
    const sorted = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}-${sorted[j]}`;
        paires[key] = (paires[key] || 0) + 1;
        for (let k = j + 1; k < sorted.length; k++) {
          const tkey = `${sorted[i]}-${sorted[j]}-${sorted[k]}`;
          triplets[tkey] = (triplets[tkey] || 0) + 1;
        }
      }
    }
  }

  const topPaires = Object.entries(paires).sort((a, b) => b[1] - a[1]).slice(0, 50);
  const topTriplets = Object.entries(triplets).sort((a, b) => b[1] - a[1]).slice(0, 30);

  return { topPaires, topTriplets };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 5 — DISTRIBUTION SOMMES / PAIR-IMPAIR / HAUT-BAS
// ═══════════════════════════════════════════════════════════════

function analyseDistribution(draws) {
  const sommes = [];
  const pairImpair = {};
  const hautBas = {};

  for (const d of draws) {
    const sum = d.gagnants.reduce((a, b) => a + b, 0);
    sommes.push(sum);

    const pairs = d.gagnants.filter((n) => n % 2 === 0).length;
    const impairs = 5 - pairs;
    const piKey = `${pairs}P-${impairs}I`;
    pairImpair[piKey] = (pairImpair[piKey] || 0) + 1;

    const hauts = d.gagnants.filter((n) => n > 45).length;
    const bas = 5 - hauts;
    const hbKey = `${hauts}H-${bas}B`;
    hautBas[hbKey] = (hautBas[hbKey] || 0) + 1;
  }

  const avgSomme = sommes.reduce((a, b) => a + b, 0) / sommes.length;
  const minSomme = Math.min(...sommes);
  const maxSomme = Math.max(...sommes);
  const stdDev = Math.sqrt(sommes.reduce((s, v) => s + (v - avgSomme) ** 2, 0) / sommes.length);

  const sommeBuckets = {};
  for (const s of sommes) {
    const bucket = `${Math.floor(s / 25) * 25}-${Math.floor(s / 25) * 25 + 24}`;
    sommeBuckets[bucket] = (sommeBuckets[bucket] || 0) + 1;
  }

  return {
    avgSomme: avgSomme.toFixed(1), minSomme, maxSomme, stdDev: stdDev.toFixed(1),
    sommeBuckets: Object.entries(sommeBuckets).sort((a, b) => {
      const na = parseInt(a[0]); const nb = parseInt(b[0]); return na - nb;
    }),
    pairImpair: Object.entries(pairImpair).sort((a, b) => b[1] - a[1]),
    hautBas: Object.entries(hautBas).sort((a, b) => b[1] - a[1]),
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 6 — DERNIER CHIFFRE (TERMINAISON)
// ═══════════════════════════════════════════════════════════════

function analyseTerminaison(draws) {
  const termFreq = Array(10).fill(0);
  for (const d of draws) {
    for (const n of d.gagnants) termFreq[n % 10]++;
  }
  const total = draws.length * DRAW_SIZE;
  return termFreq.map((f, i) => ({
    terminaison: i, freq: f, pct: (f / total * 100).toFixed(2) + "%",
  })).sort((a, b) => b.freq - a.freq);
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 7 — DIZAINES (1-9, 10-19, ..., 80-90)
// ═══════════════════════════════════════════════════════════════

function analyseDizaines(draws) {
  const dizFreq = {};
  const labels = ["01-09","10-19","20-29","30-39","40-49","50-59","60-69","70-79","80-90"];
  for (const l of labels) dizFreq[l] = 0;

  for (const d of draws) {
    for (const n of d.gagnants) {
      const idx = Math.min(Math.floor((n - 1) / 10), 8);
      dizFreq[labels[idx]]++;
    }
  }
  const total = draws.length * DRAW_SIZE;
  return labels.map((l) => ({ dizaine: l, freq: dizFreq[l], pct: (dizFreq[l] / total * 100).toFixed(2) + "%" }));
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 8 — CONSECUTIFS & ÉCARTS ENTRE NUMÉROS
// ═══════════════════════════════════════════════════════════════

function analyseConsecutifs(draws) {
  let withConsecutif = 0;
  const ecarts = [];

  for (const d of draws) {
    const sorted = [...d.gagnants].sort((a, b) => a - b);
    let hasConsec = false;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      ecarts.push(gap);
      if (gap === 1) hasConsec = true;
    }
    if (hasConsec) withConsecutif++;
  }

  const avgEcart = ecarts.reduce((a, b) => a + b, 0) / ecarts.length;
  return {
    pctConsecutif: (withConsecutif / draws.length * 100).toFixed(1) + "%",
    countConsecutif: withConsecutif,
    avgEcart: avgEcart.toFixed(1),
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 9 — CHAÎNES DE MARKOV (TRANSITIONS)
// ═══════════════════════════════════════════════════════════════

function analyseMarkov(draws) {
  const transitions = {};
  for (let i = 1; i < draws.length; i++) {
    for (const prev of draws[i].gagnants) {
      for (const next of draws[i - 1].gagnants) {
        const key = `${prev}→${next}`;
        transitions[key] = (transitions[key] || 0) + 1;
      }
    }
  }
  return Object.entries(transitions).sort((a, b) => b[1] - a[1]).slice(0, 50);
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 10 — NOMBRES PREMIERS & FIBONACCI
// ═══════════════════════════════════════════════════════════════

function analyseSpeciaux(draws) {
  function isPrime(n) {
    if (n < 2) return false;
    for (let i = 2; i <= Math.sqrt(n); i++) if (n % i === 0) return false;
    return true;
  }
  const primes = new Set();
  for (let i = 1; i <= 90; i++) if (isPrime(i)) primes.add(i);

  const fibs = new Set();
  let a = 1, b = 1;
  while (b <= 90) { fibs.add(b); [a, b] = [b, a + b]; }

  let primeCount = 0, fibCount = 0, total = 0;
  for (const d of draws) {
    for (const n of d.gagnants) {
      total++;
      if (primes.has(n)) primeCount++;
      if (fibs.has(n)) fibCount++;
    }
  }

  return {
    primesPct: (primeCount / total * 100).toFixed(2),
    primesExpected: (primes.size / NUM_RANGE * 100).toFixed(2),
    fibPct: (fibCount / total * 100).toFixed(2),
    fibExpected: (fibs.size / NUM_RANGE * 100).toFixed(2),
    primesSet: [...primes],
    fibsSet: [...fibs],
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 11 — CHI-CARRÉ (UNIFORMITÉ)
// ═══════════════════════════════════════════════════════════════

function chiCarre(draws) {
  const freq = Array(NUM_RANGE + 1).fill(0);
  for (const d of draws) for (const n of d.gagnants) freq[n]++;
  const total = draws.length * DRAW_SIZE;
  const expected = total / NUM_RANGE;

  let chiSq = 0;
  for (let i = 1; i <= NUM_RANGE; i++) {
    chiSq += ((freq[i] - expected) ** 2) / expected;
  }
  const df = NUM_RANGE - 1;
  const critical95 = 112.02; // df=89, alpha=0.05
  const critical99 = 122.94;

  return {
    chiSq: chiSq.toFixed(2),
    df,
    critical95: critical95.toFixed(2),
    critical99: critical99.toFixed(2),
    uniform95: chiSq < critical95 ? "OUI — distribution uniforme" : "NON — biais détecté",
    uniform99: chiSq < critical99 ? "OUI — distribution uniforme" : "NON — biais détecté",
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 12 — TENDANCES GLISSANTES (MOVING AVERAGES)
// ═══════════════════════════════════════════════════════════════

function analyseTendances(draws) {
  const windows = [10, 20, 50];
  const trends = {};

  for (const w of windows) {
    const freqWindow = Array(NUM_RANGE + 1).fill(0);
    const slice = draws.slice(0, w);
    for (const d of slice) for (const n of d.gagnants) freqWindow[n]++;

    const hotNums = [];
    for (let i = 1; i <= NUM_RANGE; i++) hotNums.push({ num: i, freq: freqWindow[i] });
    hotNums.sort((a, b) => b.freq - a.freq);

    trends[`last${w}`] = {
      top10: hotNums.slice(0, 10),
      cold10: hotNums.slice(-10).reverse(),
    };
  }
  return trends;
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 13 — CORRÉLATION GAGNANTS ↔ MACHINE
// ═══════════════════════════════════════════════════════════════

function analyseCorrelation(draws) {
  const drawsWithMachine = draws.filter((d) => d.machine && d.machine.length === 5);
  const coOccurrences = {};
  let matchCount = 0, totalPairs = 0;

  for (const d of drawsWithMachine) {
    const machSet = new Set(d.machine);
    for (const g of d.gagnants) {
      if (machSet.has(g)) matchCount++;
    }
    totalPairs += 5;

    for (const g of d.gagnants) {
      for (const m of d.machine) {
        const key = `G${g}↔M${m}`;
        coOccurrences[key] = (coOccurrences[key] || 0) + 1;
      }
    }
  }

  const sumDiffs = [];
  for (const d of drawsWithMachine) {
    const sg = d.gagnants.reduce((a, b) => a + b, 0);
    const sm = d.machine.reduce((a, b) => a + b, 0);
    sumDiffs.push(Math.abs(sg - sm));
  }
  const avgDiff = sumDiffs.reduce((a, b) => a + b, 0) / sumDiffs.length;

  return {
    matchPct: (matchCount / totalPairs * 100).toFixed(2),
    avgSumDiff: avgDiff.toFixed(1),
    topCoOccurrences: Object.entries(coOccurrences).sort((a, b) => b[1] - a[1]).slice(0, 30),
  };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 14 — SCORING COMBINÉ & PRÉDICTIONS
// ═══════════════════════════════════════════════════════════════

function genererPredictions(draws) {
  const scores = Array(NUM_RANGE + 1).fill(0);
  const details = Array(NUM_RANGE + 1).fill(null).map(() => ({}));

  // --- Score 1: Fréquence globale (poids: 15) ---
  const freq = Array(NUM_RANGE + 1).fill(0);
  for (const d of draws) for (const n of d.gagnants) freq[n]++;
  const maxFreq = Math.max(...freq.slice(1));
  for (let i = 1; i <= NUM_RANGE; i++) {
    const s = (freq[i] / maxFreq) * 15;
    scores[i] += s;
    details[i].freqGlobale = +s.toFixed(2);
  }

  // --- Score 2: Fréquence récente (50 derniers, poids: 20) ---
  const freqR = Array(NUM_RANGE + 1).fill(0);
  for (const d of draws.slice(0, 50)) for (const n of d.gagnants) freqR[n]++;
  const maxFreqR = Math.max(...freqR.slice(1));
  for (let i = 1; i <= NUM_RANGE; i++) {
    const s = (freqR[i] / maxFreqR) * 20;
    scores[i] += s;
    details[i].freqRecente = +s.toFixed(2);
  }

  // --- Score 3: Retard (bonus aux retardataires, poids: 15) ---
  const lastSeen = Array(NUM_RANGE + 1).fill(draws.length);
  for (let idx = 0; idx < draws.length; idx++) {
    for (const n of draws[idx].gagnants) {
      if (lastSeen[n] === draws.length) lastSeen[n] = idx;
    }
  }
  const maxRetard = Math.max(...lastSeen.slice(1));
  for (let i = 1; i <= NUM_RANGE; i++) {
    const s = (lastSeen[i] / maxRetard) * 15;
    scores[i] += s;
    details[i].retard = +s.toFixed(2);
  }

  // --- Score 4: Tendance haussière (poids: 15) ---
  const freqFirst100 = Array(NUM_RANGE + 1).fill(0);
  const freqLast100 = Array(NUM_RANGE + 1).fill(0);
  for (const d of draws.slice(0, 100)) for (const n of d.gagnants) freqFirst100[n]++;
  for (const d of draws.slice(-100)) for (const n of d.gagnants) freqLast100[n]++;
  for (let i = 1; i <= NUM_RANGE; i++) {
    const trend = freqFirst100[i] - freqLast100[i];
    const s = Math.max(0, (trend / 10) * 15);
    scores[i] += s;
    details[i].tendance = +s.toFixed(2);
  }

  // --- Score 5: Position dans les paires fréquentes (poids: 10) ---
  const pairScore = Array(NUM_RANGE + 1).fill(0);
  const paires = {};
  for (const d of draws) {
    const sorted = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}-${sorted[j]}`;
        paires[key] = (paires[key] || 0) + 1;
      }
  }
  const topPairs = Object.entries(paires).sort((a, b) => b[1] - a[1]).slice(0, 100);
  for (const [key, count] of topPairs) {
    const [a, b] = key.split("-").map(Number);
    pairScore[a] += count;
    pairScore[b] += count;
  }
  const maxPairScore = Math.max(...pairScore.slice(1)) || 1;
  for (let i = 1; i <= NUM_RANGE; i++) {
    const s = (pairScore[i] / maxPairScore) * 10;
    scores[i] += s;
    details[i].paires = +s.toFixed(2);
  }

  // --- Score 6: Terminaison favorable (poids: 5) ---
  const termFreq = Array(10).fill(0);
  for (const d of draws) for (const n of d.gagnants) termFreq[n % 10]++;
  const maxTerm = Math.max(...termFreq);
  for (let i = 1; i <= NUM_RANGE; i++) {
    const s = (termFreq[i % 10] / maxTerm) * 5;
    scores[i] += s;
    details[i].terminaison = +s.toFixed(2);
  }

  // --- Score 7: Bits chauds (poids: 10) ---
  const bitOnes = Array(7).fill(0);
  let totalNums = 0;
  for (const d of draws.slice(0, 50)) {
    for (const n of d.gagnants) {
      const bin = n.toString(2).padStart(7, "0");
      for (let b = 0; b < 7; b++) if (bin[b] === "1") bitOnes[b]++;
      totalNums++;
    }
  }
  const bitRatios = bitOnes.map((o) => o / totalNums);
  for (let i = 1; i <= NUM_RANGE; i++) {
    const bin = i.toString(2).padStart(7, "0");
    let bitScore = 0;
    for (let b = 0; b < 7; b++) {
      if (bin[b] === "1") bitScore += bitRatios[b];
      else bitScore += (1 - bitRatios[b]);
    }
    const s = (bitScore / 7) * 10;
    scores[i] += s;
    details[i].binaire = +s.toFixed(2);
  }

  // --- Score 8: Markov — successeur probable (poids: 10) ---
  const lastDraw = draws[0].gagnants;
  const markovScore = Array(NUM_RANGE + 1).fill(0);
  for (let idx = 1; idx < draws.length; idx++) {
    for (const prev of draws[idx].gagnants) {
      if (lastDraw.includes(prev)) {
        for (const next of draws[idx - 1].gagnants) {
          markovScore[next]++;
        }
      }
    }
  }
  const maxMarkov = Math.max(...markovScore.slice(1)) || 1;
  for (let i = 1; i <= NUM_RANGE; i++) {
    const s = (markovScore[i] / maxMarkov) * 10;
    scores[i] += s;
    details[i].markov = +s.toFixed(2);
  }

  // --- Classement final ---
  const ranked = [];
  for (let i = 1; i <= NUM_RANGE; i++) {
    ranked.push({ num: i, score: +scores[i].toFixed(2), details: details[i] });
  }
  ranked.sort((a, b) => b.score - a.score);

  // --- Génération des combinaisons ---
  const top15 = ranked.slice(0, 15).map((r) => r.num);

  const combos = [];
  // Combo 1: Top 5 absolu
  combos.push({ nom: "TOP SCORE ABSOLU", nums: ranked.slice(0, 5).map((r) => r.num).sort((a, b) => a - b) });

  // Combo 2: Mix chaud + retardataire
  const hotNums = ranked.filter((r) => r.details.freqRecente >= 15).slice(0, 3).map((r) => r.num);
  const coldNums = ranked.filter((r) => r.details.retard >= 10).slice(0, 2).map((r) => r.num);
  if (hotNums.length + coldNums.length >= 5) {
    combos.push({ nom: "MIX CHAUD + RETARD", nums: [...hotNums, ...coldNums].slice(0, 5).sort((a, b) => a - b) });
  }

  // Combo 3: Meilleur profil binaire
  const binRanked = [...ranked].sort((a, b) => b.details.binaire - a.details.binaire);
  combos.push({ nom: "PROFIL BINAIRE OPTIMAL", nums: binRanked.slice(0, 5).map((r) => r.num).sort((a, b) => a - b) });

  // Combo 4: Markov dominant
  const markovRanked = [...ranked].sort((a, b) => b.details.markov - a.details.markov);
  combos.push({ nom: "CHAÎNE DE MARKOV", nums: markovRanked.slice(0, 5).map((r) => r.num).sort((a, b) => a - b) });

  // Combo 5: Équilibré pair/impair + haut/bas
  const pairs = ranked.filter((r) => r.num % 2 === 0).slice(0, 3).map((r) => r.num);
  const impairs = ranked.filter((r) => r.num % 2 === 1).slice(0, 2).map((r) => r.num);
  combos.push({ nom: "ÉQUILIBRÉ PAIR/IMPAIR", nums: [...pairs, ...impairs].sort((a, b) => a - b) });

  // Combo 6: Diversité dizaines
  const byDiz = {};
  for (const r of ranked) {
    const diz = Math.floor((r.num - 1) / 10);
    if (!byDiz[diz]) byDiz[diz] = [];
    byDiz[diz].push(r.num);
  }
  const diverseNums = [];
  const dizKeys = Object.keys(byDiz).sort((a, b) => a - b);
  for (const k of dizKeys) {
    if (diverseNums.length < 5) diverseNums.push(byDiz[k][0]);
  }
  while (diverseNums.length < 5) {
    for (const k of dizKeys) {
      if (diverseNums.length < 5 && byDiz[k].length > 1) {
        const next = byDiz[k].find((n) => !diverseNums.includes(n));
        if (next) diverseNums.push(next);
      }
    }
  }
  combos.push({ nom: "DIVERSITÉ DIZAINES", nums: diverseNums.slice(0, 5).sort((a, b) => a - b) });

  // Combo 7: Best paires combo
  const topPairNums = [];
  for (const [key] of topPairs.slice(0, 10)) {
    const [a, b] = key.split("-").map(Number);
    if (!topPairNums.includes(a)) topPairNums.push(a);
    if (!topPairNums.includes(b)) topPairNums.push(b);
  }
  combos.push({ nom: "PAIRES DOMINANTES", nums: topPairNums.slice(0, 5).sort((a, b) => a - b) });

  // Combo 8: Somme optimale (~225)
  const targetSum = 225;
  const sumCombo = [];
  const available = [...ranked];
  for (let pick = 0; pick < 5; pick++) {
    const remaining = 5 - pick;
    const currentSum = sumCombo.reduce((a, b) => a + b, 0);
    const targetPer = (targetSum - currentSum) / remaining;
    available.sort((a, b) => {
      const da = Math.abs(a.num - targetPer) - a.score * 0.1;
      const db = Math.abs(b.num - targetPer) - b.score * 0.1;
      return da - db;
    });
    const chosen = available.splice(0, 1)[0];
    sumCombo.push(chosen.num);
  }
  combos.push({
    nom: `SOMME OPTIMALE (~${targetSum})`,
    nums: sumCombo.sort((a, b) => a - b),
    somme: sumCombo.reduce((a, b) => a + b, 0),
  });

  return { ranked, combos, lastDraw };
}

// ═══════════════════════════════════════════════════════════════
//  MODULE 15 — PRÉDICTIONS PAR TYPE DE TIRAGE
// ═══════════════════════════════════════════════════════════════

function predictionParTirage(draws) {
  const types = {};
  for (const d of draws) {
    if (!types[d.type]) types[d.type] = [];
    types[d.type].push(d);
  }

  const predictions = {};
  for (const [type, typeDraws] of Object.entries(types)) {
    if (typeDraws.length < 20) continue;

    const freq = Array(NUM_RANGE + 1).fill(0);
    const freqR = Array(NUM_RANGE + 1).fill(0);
    const recent = typeDraws.slice(0, Math.min(20, typeDraws.length));

    for (const d of typeDraws) for (const n of d.gagnants) freq[n]++;
    for (const d of recent) for (const n of d.gagnants) freqR[n]++;

    const scored = [];
    for (let i = 1; i <= NUM_RANGE; i++) {
      scored.push({ num: i, score: freq[i] * 0.4 + freqR[i] * 0.6 });
    }
    scored.sort((a, b) => b.score - a.score);

    predictions[type] = {
      nbTirages: typeDraws.length,
      top10: scored.slice(0, 10),
      combo: scored.slice(0, 5).map((s) => s.num).sort((a, b) => a - b),
    };
  }
  return predictions;
}

// ═══════════════════════════════════════════════════════════════
//  GÉNÉRATION EXCEL COMPLET
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  LONACI LOTO BONHEUR — ANALYSE STATISTIQUE      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("Chargement des données (12 mois)...");
  const draws = await loadAllDraws();
  console.log(`\n✓ ${draws.length} tirages chargés\n`);

  console.log("Analyse en cours...");
  const freqData = analyseFrequence(draws);
  const retardData = analyseRetard(draws);
  const binaireData = analyseBinaire(draws);
  const pairesData = analysePaires(draws);
  const distData = analyseDistribution(draws);
  const termData = analyseTerminaison(draws);
  const dizData = analyseDizaines(draws);
  const consData = analyseConsecutifs(draws);
  const markovData = analyseMarkov(draws);
  const specData = analyseSpeciaux(draws);
  const chiData = chiCarre(draws);
  const tendData = analyseTendances(draws);
  const corrData = analyseCorrelation(draws);
  const predData = genererPredictions(draws);
  const typePredData = predictionParTirage(draws);
  console.log("✓ 15 modules d'analyse terminés\n");

  const wb = new ExcelJS.Workbook();
  wb.creator = "LONACI Analyse Statistique";

  const greenHeader = {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D32" } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: { top: {style:"thin"}, bottom: {style:"thin"}, left: {style:"thin"}, right: {style:"thin"} },
  };
  const blueHeader = { ...greenHeader, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } } };
  const purpleHeader = { ...greenHeader, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF6A1B9A" } } };
  const orangeHeader = { ...greenHeader, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFEF6C00" } } };
  const redHeader = { ...greenHeader, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFC62828" } } };
  const tealHeader = { ...greenHeader, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF00695C" } } };

  function applyHeader(ws, style) {
    ws.getRow(1).eachCell((cell) => {
      cell.font = style.font; cell.fill = style.fill;
      cell.alignment = style.alignment; cell.border = style.border;
    });
    ws.getRow(1).height = 25;
  }
  function applyBorder(cell) {
    cell.border = {
      top: {style:"thin",color:{argb:"FFE0E0E0"}}, bottom: {style:"thin",color:{argb:"FFE0E0E0"}},
      left: {style:"thin",color:{argb:"FFE0E0E0"}}, right: {style:"thin",color:{argb:"FFE0E0E0"}},
    };
    cell.alignment = { horizontal: "center" };
  }

  // ═══════════ FEUILLE 1: PRÉDICTIONS ═══════════
  const wsPred = wb.addWorksheet("⭐ PRÉDICTIONS");
  wsPred.getColumn(1).width = 30;
  wsPred.getColumn(2).width = 10;
  wsPred.getColumn(3).width = 10;
  wsPred.getColumn(4).width = 10;
  wsPred.getColumn(5).width = 10;
  wsPred.getColumn(6).width = 10;
  wsPred.getColumn(7).width = 14;

  let row = 1;
  const titleRow = wsPred.getRow(row);
  titleRow.getCell(1).value = "STRATÉGIE DE PRÉDICTION — LOTO BONHEUR";
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FF2E7D32" } };
  row += 2;

  const r2 = wsPred.getRow(row);
  r2.getCell(1).value = `Dernier tirage analysé: ${draws[0].date} (${draws[0].type})`;
  r2.getCell(1).font = { italic: true, size: 11 };
  row++;
  const r3 = wsPred.getRow(row);
  r3.getCell(1).value = `Derniers numéros gagnants: ${draws[0].gagnants.join(" - ")}`;
  r3.getCell(1).font = { italic: true, size: 11 };
  row += 2;

  const r5 = wsPred.getRow(row);
  r5.getCell(1).value = "COMBINAISONS RECOMMANDÉES";
  r5.getCell(1).font = { bold: true, size: 14, color: { argb: "FFC62828" } };
  row += 1;

  const comboHeaderRow = wsPred.getRow(row);
  ["Stratégie", "N°1", "N°2", "N°3", "N°4", "N°5", "Somme"].forEach((h, i) => {
    comboHeaderRow.getCell(i + 1).value = h;
  });
  applyHeader(wsPred, { ...redHeader, font: greenHeader.font, fill: redHeader.fill, alignment: greenHeader.alignment, border: greenHeader.border });
  wsPred.getRow(row).eachCell((cell) => {
    cell.font = redHeader.font; cell.fill = redHeader.fill;
    cell.alignment = redHeader.alignment; cell.border = redHeader.border;
  });
  row++;

  for (const combo of predData.combos) {
    const cr = wsPred.getRow(row);
    cr.getCell(1).value = combo.nom;
    cr.getCell(1).font = { bold: true };
    cr.getCell(1).alignment = { horizontal: "left" };
    combo.nums.forEach((n, i) => {
      cr.getCell(i + 2).value = n;
      cr.getCell(i + 2).font = { bold: true, size: 13, color: { argb: "FFC62828" } };
      cr.getCell(i + 2).alignment = { horizontal: "center" };
      cr.getCell(i + 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
    });
    cr.getCell(7).value = combo.nums.reduce((a, b) => a + b, 0);
    cr.getCell(7).alignment = { horizontal: "center" };
    row++;
  }
  row += 2;

  // Top 20 numéros par score
  const r20 = wsPred.getRow(row);
  r20.getCell(1).value = "TOP 20 NUMÉROS PAR SCORE COMBINÉ";
  r20.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1565C0" } };
  row++;

  const scoreHeaders = ["Rang","Numéro","Score","Fréq.","Récent","Retard","Tendance","Paires","Binaire","Markov","Termin."];
  const shRow = wsPred.getRow(row);
  scoreHeaders.forEach((h, i) => {
    shRow.getCell(i + 1).value = h;
    shRow.getCell(i + 1).font = blueHeader.font;
    shRow.getCell(i + 1).fill = blueHeader.fill;
    shRow.getCell(i + 1).alignment = blueHeader.alignment;
    shRow.getCell(i + 1).border = blueHeader.border;
  });
  row++;

  for (let i = 0; i < 20; i++) {
    const item = predData.ranked[i];
    const sr = wsPred.getRow(row);
    const vals = [i + 1, item.num, item.score, item.details.freqGlobale, item.details.freqRecente,
      item.details.retard, item.details.tendance, item.details.paires, item.details.binaire, item.details.markov, item.details.terminaison];
    vals.forEach((v, ci) => {
      sr.getCell(ci + 1).value = v;
      applyBorder(sr.getCell(ci + 1));
    });
    if (i < 5) {
      sr.getCell(2).font = { bold: true, size: 12, color: { argb: "FFC62828" } };
      sr.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
    }
    row++;
  }

  // ═══════════ FEUILLE 2: FRÉQUENCE & TEMPÉRATURE ═══════════
  const wsFreq = wb.addWorksheet("Fréquence & Température");
  wsFreq.columns = [
    { header: "Numéro", key: "num", width: 10 },
    { header: "Fréquence", key: "freq", width: 12 },
    { header: "Freq. 50 derniers", key: "freqRecent", width: 18 },
    { header: "% Global", key: "pct", width: 12 },
    { header: "Écart vs attendu", key: "ecart", width: 16 },
    { header: "Température", key: "temperature", width: 14 },
  ];
  applyHeader(wsFreq, greenHeader);
  for (const item of freqData) {
    const r = wsFreq.addRow({ num: item.num, freq: item.freq, freqRecent: item.freqRecent,
      pct: item.pct.toFixed(2) + "%", ecart: item.ecart.toFixed(1) + "%", temperature: item.temperature });
    r.eachCell((c) => applyBorder(c));
    if (item.temperature === "CHAUD") r.getCell(6).font = { bold: true, color: { argb: "FFC62828" } };
    if (item.temperature === "FROID") r.getCell(6).font = { color: { argb: "FF1565C0" } };
  }

  // ═══════════ FEUILLE 3: RETARD ═══════════
  const wsRet = wb.addWorksheet("Retard (Gap)");
  wsRet.columns = [
    { header: "Numéro", key: "num", width: 10 },
    { header: "Retard (tirages)", key: "retard", width: 18 },
    { header: "Statut", key: "status", width: 20 },
  ];
  applyHeader(wsRet, orangeHeader);
  for (const item of retardData) {
    const r = wsRet.addRow(item);
    r.eachCell((c) => applyBorder(c));
    if (item.status.includes("TRÈS")) r.getCell(3).font = { bold: true, color: { argb: "FFC62828" } };
  }

  // ═══════════ FEUILLE 4: ANALYSE BINAIRE ═══════════
  const wsBin = wb.addWorksheet("Analyse Binaire");
  wsBin.getColumn(1).width = 25;
  wsBin.getColumn(2).width = 12;
  wsBin.getColumn(3).width = 12;
  wsBin.getColumn(4).width = 12;
  wsBin.getColumn(5).width = 15;
  wsBin.getColumn(6).width = 15;

  let brow = 1;
  wsBin.getRow(brow).getCell(1).value = "ANALYSE DES BITS (représentation binaire 7 bits)";
  wsBin.getRow(brow).getCell(1).font = { bold: true, size: 14, color: { argb: "FF6A1B9A" } };
  brow += 2;

  ["Position", "Valeur", "Nb de 0", "Nb de 1", "Ratio bit=1", "Tendance"].forEach((h, i) => {
    wsBin.getRow(brow).getCell(i + 1).value = h;
    wsBin.getRow(brow).getCell(i + 1).font = purpleHeader.font;
    wsBin.getRow(brow).getCell(i + 1).fill = purpleHeader.fill;
    wsBin.getRow(brow).getCell(i + 1).alignment = purpleHeader.alignment;
    wsBin.getRow(brow).getCell(i + 1).border = purpleHeader.border;
  });
  brow++;

  for (const b of binaireData.bitAnalysis) {
    const r = wsBin.getRow(brow);
    [b.bit, b.valeur, b.zeros, b.ones, b.ratioBit1, b.tendance].forEach((v, i) => {
      r.getCell(i + 1).value = v;
      applyBorder(r.getCell(i + 1));
    });
    brow++;
  }
  brow += 2;

  wsBin.getRow(brow).getCell(1).value = "Moyenne bits à 1 par numéro:";
  wsBin.getRow(brow).getCell(2).value = binaireData.avgBits.toFixed(2);
  brow++;
  wsBin.getRow(brow).getCell(1).value = "Parité binaire (nb bits=1 pair):";
  wsBin.getRow(brow).getCell(2).value = binaireData.parityBin.pairBin;
  brow++;
  wsBin.getRow(brow).getCell(1).value = "Parité binaire (nb bits=1 impair):";
  wsBin.getRow(brow).getCell(2).value = binaireData.parityBin.impairBin;
  brow += 2;

  wsBin.getRow(brow).getCell(1).value = "TOP 20 RÉSULTATS XOR DES 5 NUMÉROS";
  wsBin.getRow(brow).getCell(1).font = { bold: true, size: 12, color: { argb: "FF6A1B9A" } };
  brow++;
  ["Valeur XOR", "Fréquence"].forEach((h, i) => {
    wsBin.getRow(brow).getCell(i + 1).value = h;
    wsBin.getRow(brow).getCell(i + 1).font = purpleHeader.font;
    wsBin.getRow(brow).getCell(i + 1).fill = purpleHeader.fill;
    wsBin.getRow(brow).getCell(i + 1).alignment = purpleHeader.alignment;
  });
  brow++;
  for (const [val, freq] of binaireData.topXor) {
    const r = wsBin.getRow(brow);
    r.getCell(1).value = `${val} (${parseInt(val).toString(2).padStart(7,"0")})`;
    r.getCell(2).value = freq;
    applyBorder(r.getCell(1)); applyBorder(r.getCell(2));
    brow++;
  }

  // ═══════════ FEUILLE 5: PAIRES & TRIPLETS ═══════════
  const wsPair = wb.addWorksheet("Paires & Triplets");
  wsPair.getColumn(1).width = 8; wsPair.getColumn(2).width = 15;
  wsPair.getColumn(3).width = 12; wsPair.getColumn(4).width = 5;
  wsPair.getColumn(5).width = 8; wsPair.getColumn(6).width = 18;
  wsPair.getColumn(7).width = 12;

  let prow = 1;
  wsPair.getRow(prow).getCell(1).value = "TOP 50 PAIRES";
  wsPair.getRow(prow).getCell(1).font = { bold: true, size: 14, color: { argb: "FF1565C0" } };
  wsPair.getRow(prow).getCell(5).value = "TOP 30 TRIPLETS";
  wsPair.getRow(prow).getCell(5).font = { bold: true, size: 14, color: { argb: "FF6A1B9A" } };
  prow++;

  ["Rang","Paire","Fréquence","","Rang","Triplet","Fréquence"].forEach((h, i) => {
    wsPair.getRow(prow).getCell(i + 1).value = h;
    if (h) {
      const style = i < 4 ? blueHeader : purpleHeader;
      wsPair.getRow(prow).getCell(i + 1).font = style.font;
      wsPair.getRow(prow).getCell(i + 1).fill = style.fill;
      wsPair.getRow(prow).getCell(i + 1).alignment = style.alignment;
    }
  });
  prow++;

  const maxRows = Math.max(pairesData.topPaires.length, pairesData.topTriplets.length);
  for (let i = 0; i < maxRows; i++) {
    const r = wsPair.getRow(prow);
    if (i < pairesData.topPaires.length) {
      r.getCell(1).value = i + 1; r.getCell(2).value = pairesData.topPaires[i][0]; r.getCell(3).value = pairesData.topPaires[i][1];
      applyBorder(r.getCell(1)); applyBorder(r.getCell(2)); applyBorder(r.getCell(3));
    }
    if (i < pairesData.topTriplets.length) {
      r.getCell(5).value = i + 1; r.getCell(6).value = pairesData.topTriplets[i][0]; r.getCell(7).value = pairesData.topTriplets[i][1];
      applyBorder(r.getCell(5)); applyBorder(r.getCell(6)); applyBorder(r.getCell(7));
    }
    prow++;
  }

  // ═══════════ FEUILLE 6: DISTRIBUTION ═══════════
  const wsDist = wb.addWorksheet("Distribution");
  wsDist.getColumn(1).width = 25; wsDist.getColumn(2).width = 15;
  wsDist.getColumn(3).width = 5; wsDist.getColumn(4).width = 25; wsDist.getColumn(5).width = 15;

  let drow = 1;
  wsDist.getRow(drow).getCell(1).value = "ANALYSE DES SOMMES";
  wsDist.getRow(drow).getCell(1).font = { bold: true, size: 14, color: { argb: "FF00695C" } };
  drow++;
  const summaryItems = [
    ["Somme moyenne", distData.avgSomme],
    ["Somme minimum", distData.minSomme],
    ["Somme maximum", distData.maxSomme],
    ["Écart-type", distData.stdDev],
  ];
  for (const [k, v] of summaryItems) {
    wsDist.getRow(drow).getCell(1).value = k;
    wsDist.getRow(drow).getCell(1).font = { bold: true };
    wsDist.getRow(drow).getCell(2).value = v;
    drow++;
  }
  drow++;

  wsDist.getRow(drow).getCell(1).value = "Plage de sommes";
  wsDist.getRow(drow).getCell(2).value = "Fréquence";
  wsDist.getRow(drow).getCell(1).font = tealHeader.font; wsDist.getRow(drow).getCell(1).fill = tealHeader.fill;
  wsDist.getRow(drow).getCell(2).font = tealHeader.font; wsDist.getRow(drow).getCell(2).fill = tealHeader.fill;
  drow++;
  for (const [range, count] of distData.sommeBuckets) {
    wsDist.getRow(drow).getCell(1).value = range;
    wsDist.getRow(drow).getCell(2).value = count;
    applyBorder(wsDist.getRow(drow).getCell(1)); applyBorder(wsDist.getRow(drow).getCell(2));
    drow++;
  }
  drow += 2;

  wsDist.getRow(drow).getCell(1).value = "PAIR / IMPAIR";
  wsDist.getRow(drow).getCell(1).font = { bold: true, size: 14, color: { argb: "FF00695C" } };
  wsDist.getRow(drow).getCell(4).value = "HAUT (>45) / BAS (≤45)";
  wsDist.getRow(drow).getCell(4).font = { bold: true, size: 14, color: { argb: "FF00695C" } };
  drow++;

  ["Distribution","Fréquence","","Distribution","Fréquence"].forEach((h, i) => {
    wsDist.getRow(drow).getCell(i + 1).value = h;
    if (h) { wsDist.getRow(drow).getCell(i + 1).font = tealHeader.font; wsDist.getRow(drow).getCell(i + 1).fill = tealHeader.fill; }
  });
  drow++;

  const maxPI = Math.max(distData.pairImpair.length, distData.hautBas.length);
  for (let i = 0; i < maxPI; i++) {
    const r = wsDist.getRow(drow);
    if (i < distData.pairImpair.length) {
      r.getCell(1).value = distData.pairImpair[i][0]; r.getCell(2).value = distData.pairImpair[i][1];
      applyBorder(r.getCell(1)); applyBorder(r.getCell(2));
    }
    if (i < distData.hautBas.length) {
      r.getCell(4).value = distData.hautBas[i][0]; r.getCell(5).value = distData.hautBas[i][1];
      applyBorder(r.getCell(4)); applyBorder(r.getCell(5));
    }
    drow++;
  }

  // ═══════════ FEUILLE 7: TERMINAISONS & DIZAINES ═══════════
  const wsTerm = wb.addWorksheet("Terminaisons & Dizaines");
  wsTerm.getColumn(1).width = 14; wsTerm.getColumn(2).width = 12; wsTerm.getColumn(3).width = 14;
  wsTerm.getColumn(4).width = 5;
  wsTerm.getColumn(5).width = 14; wsTerm.getColumn(6).width = 12; wsTerm.getColumn(7).width = 14;

  let trow = 1;
  wsTerm.getRow(trow).getCell(1).value = "TERMINAISONS (dernier chiffre)";
  wsTerm.getRow(trow).getCell(1).font = { bold: true, size: 14, color: { argb: "FFEF6C00" } };
  wsTerm.getRow(trow).getCell(5).value = "DIZAINES";
  wsTerm.getRow(trow).getCell(5).font = { bold: true, size: 14, color: { argb: "FFEF6C00" } };
  trow++;

  ["Terminaison","Fréquence","% du total","","Dizaine","Fréquence","% du total"].forEach((h, i) => {
    wsTerm.getRow(trow).getCell(i + 1).value = h;
    if (h) { wsTerm.getRow(trow).getCell(i + 1).font = orangeHeader.font; wsTerm.getRow(trow).getCell(i + 1).fill = orangeHeader.fill; }
  });
  trow++;

  const maxTD = Math.max(termData.length, dizData.length);
  for (let i = 0; i < maxTD; i++) {
    const r = wsTerm.getRow(trow);
    if (i < termData.length) {
      r.getCell(1).value = termData[i].terminaison; r.getCell(2).value = termData[i].freq; r.getCell(3).value = termData[i].pct;
      applyBorder(r.getCell(1)); applyBorder(r.getCell(2)); applyBorder(r.getCell(3));
    }
    if (i < dizData.length) {
      r.getCell(5).value = dizData[i].dizaine; r.getCell(6).value = dizData[i].freq; r.getCell(7).value = dizData[i].pct;
      applyBorder(r.getCell(5)); applyBorder(r.getCell(6)); applyBorder(r.getCell(7));
    }
    trow++;
  }

  // ═══════════ FEUILLE 8: MARKOV ═══════════
  const wsMarkov = wb.addWorksheet("Chaînes Markov");
  wsMarkov.columns = [
    { header: "Rang", key: "rang", width: 8 },
    { header: "Transition", key: "trans", width: 18 },
    { header: "Fréquence", key: "freq", width: 12 },
  ];
  applyHeader(wsMarkov, purpleHeader);
  markovData.forEach(([trans, freq], i) => {
    const r = wsMarkov.addRow({ rang: i + 1, trans, freq });
    r.eachCell((c) => applyBorder(c));
  });

  // ═══════════ FEUILLE 9: CHI-CARRÉ & STATS ═══════════
  const wsChi = wb.addWorksheet("Tests Statistiques");
  wsChi.getColumn(1).width = 35; wsChi.getColumn(2).width = 25;

  let crow = 1;
  wsChi.getRow(crow).getCell(1).value = "TEST CHI-CARRÉ D'UNIFORMITÉ";
  wsChi.getRow(crow).getCell(1).font = { bold: true, size: 14, color: { argb: "FFC62828" } };
  crow += 2;

  const chiItems = [
    ["Valeur Chi²", chiData.chiSq],
    ["Degrés de liberté", chiData.df],
    ["Seuil critique (95%)", chiData.critical95],
    ["Seuil critique (99%)", chiData.critical99],
    ["Uniforme à 95%?", chiData.uniform95],
    ["Uniforme à 99%?", chiData.uniform99],
  ];
  for (const [k, v] of chiItems) {
    wsChi.getRow(crow).getCell(1).value = k; wsChi.getRow(crow).getCell(1).font = { bold: true };
    wsChi.getRow(crow).getCell(2).value = v;
    crow++;
  }
  crow += 2;

  wsChi.getRow(crow).getCell(1).value = "NOMBRES SPÉCIAUX";
  wsChi.getRow(crow).getCell(1).font = { bold: true, size: 14, color: { argb: "FFC62828" } };
  crow += 2;
  const specItems = [
    ["% nombres premiers tirés", specData.primesPct + "%"],
    ["% attendu (uniforme)", specData.primesExpected + "%"],
    ["Biais premiers?", Math.abs(parseFloat(specData.primesPct) - parseFloat(specData.primesExpected)) > 2 ? "OUI" : "NON"],
    ["% Fibonacci tirés", specData.fibPct + "%"],
    ["% attendu (uniforme)", specData.fibExpected + "%"],
    ["Biais Fibonacci?", Math.abs(parseFloat(specData.fibPct) - parseFloat(specData.fibExpected)) > 2 ? "OUI" : "NON"],
  ];
  for (const [k, v] of specItems) {
    wsChi.getRow(crow).getCell(1).value = k; wsChi.getRow(crow).getCell(1).font = { bold: true };
    wsChi.getRow(crow).getCell(2).value = v;
    crow++;
  }
  crow += 2;

  wsChi.getRow(crow).getCell(1).value = "CONSÉCUTIFS";
  wsChi.getRow(crow).getCell(1).font = { bold: true, size: 14, color: { argb: "FFC62828" } };
  crow++;
  wsChi.getRow(crow).getCell(1).value = "% tirages avec consécutifs"; wsChi.getRow(crow).getCell(2).value = consData.pctConsecutif; crow++;
  wsChi.getRow(crow).getCell(1).value = "Écart moyen entre numéros"; wsChi.getRow(crow).getCell(2).value = consData.avgEcart; crow++;
  crow += 2;

  wsChi.getRow(crow).getCell(1).value = "CORRÉLATION GAGNANTS ↔ MACHINE";
  wsChi.getRow(crow).getCell(1).font = { bold: true, size: 14, color: { argb: "FFC62828" } };
  crow++;
  wsChi.getRow(crow).getCell(1).value = "% numéros identiques G/M"; wsChi.getRow(crow).getCell(2).value = corrData.matchPct + "%"; crow++;
  wsChi.getRow(crow).getCell(1).value = "Écart moyen sommes G vs M"; wsChi.getRow(crow).getCell(2).value = corrData.avgSumDiff; crow++;

  // ═══════════ FEUILLE 10: TENDANCES GLISSANTES ═══════════
  const wsTrend = wb.addWorksheet("Tendances Glissantes");
  wsTrend.getColumn(1).width = 20;
  for (let i = 2; i <= 11; i++) wsTrend.getColumn(i).width = 10;

  let trrow = 1;
  for (const [period, data] of Object.entries(tendData)) {
    wsTrend.getRow(trrow).getCell(1).value = `TOP 10 CHAUDS — ${period.replace("last", "derniers ")} tirages`;
    wsTrend.getRow(trrow).getCell(1).font = { bold: true, size: 12, color: { argb: "FFC62828" } };
    trrow++;
    for (let i = 0; i < 10; i++) {
      wsTrend.getRow(trrow).getCell(1).value = `#${i + 1}`;
      wsTrend.getRow(trrow).getCell(2).value = `N°${data.top10[i].num}`;
      wsTrend.getRow(trrow).getCell(3).value = `${data.top10[i].freq}x`;
      applyBorder(wsTrend.getRow(trrow).getCell(1));
      applyBorder(wsTrend.getRow(trrow).getCell(2));
      applyBorder(wsTrend.getRow(trrow).getCell(3));
      trrow++;
    }
    trrow++;

    wsTrend.getRow(trrow).getCell(1).value = `TOP 10 FROIDS — ${period.replace("last", "derniers ")} tirages`;
    wsTrend.getRow(trrow).getCell(1).font = { bold: true, size: 12, color: { argb: "FF1565C0" } };
    trrow++;
    for (let i = 0; i < 10; i++) {
      wsTrend.getRow(trrow).getCell(1).value = `#${i + 1}`;
      wsTrend.getRow(trrow).getCell(2).value = `N°${data.cold10[i].num}`;
      wsTrend.getRow(trrow).getCell(3).value = `${data.cold10[i].freq}x`;
      applyBorder(wsTrend.getRow(trrow).getCell(1));
      applyBorder(wsTrend.getRow(trrow).getCell(2));
      applyBorder(wsTrend.getRow(trrow).getCell(3));
      trrow++;
    }
    trrow += 2;
  }

  // ═══════════ FEUILLE 11: PRÉDICTIONS PAR TIRAGE ═══════════
  const wsType = wb.addWorksheet("Prédictions par Tirage");
  wsType.getColumn(1).width = 22;
  wsType.getColumn(2).width = 12;
  for (let i = 3; i <= 7; i++) wsType.getColumn(i).width = 8;
  wsType.getColumn(8).width = 14;

  let tyrow = 1;
  wsType.getRow(tyrow).getCell(1).value = "PRÉDICTIONS PAR TYPE DE TIRAGE";
  wsType.getRow(tyrow).getCell(1).font = { bold: true, size: 14, color: { argb: "FF2E7D32" } };
  tyrow += 2;

  ["Tirage","Nb tirages","N°1","N°2","N°3","N°4","N°5","Somme"].forEach((h, i) => {
    wsType.getRow(tyrow).getCell(i + 1).value = h;
    wsType.getRow(tyrow).getCell(i + 1).font = greenHeader.font;
    wsType.getRow(tyrow).getCell(i + 1).fill = greenHeader.fill;
    wsType.getRow(tyrow).getCell(i + 1).alignment = greenHeader.alignment;
    wsType.getRow(tyrow).getCell(i + 1).border = greenHeader.border;
  });
  tyrow++;

  const sortedTypes = Object.entries(typePredData).sort((a, b) => b[1].nbTirages - a[1].nbTirages);
  for (const [type, data] of sortedTypes) {
    const r = wsType.getRow(tyrow);
    r.getCell(1).value = type;
    r.getCell(1).alignment = { horizontal: "left" };
    r.getCell(2).value = data.nbTirages;
    data.combo.forEach((n, i) => {
      r.getCell(i + 3).value = n;
      r.getCell(i + 3).font = { bold: true, color: { argb: "FFC62828" } };
      r.getCell(i + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
    });
    r.getCell(8).value = data.combo.reduce((a, b) => a + b, 0);
    r.eachCell((c) => applyBorder(c));
    tyrow++;
  }

  // ═══════════ SAUVEGARDER ═══════════
  const filename = "C:/Users/hp/lonaci-scraper/LONACI_Analyse_Strategie_24mois.xlsx";
  await wb.xlsx.writeFile(filename);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  FICHIER EXCEL GÉNÉRÉ AVEC SUCCÈS !              ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\nFichier: ${filename}`);
  console.log("\n11 FEUILLES D'ANALYSE:");
  console.log("  1.  ⭐ PRÉDICTIONS — combinaisons recommandées + scoring");
  console.log("  2.  Fréquence & Température — chaud/tiède/froid");
  console.log("  3.  Retard (Gap) — numéros en retard");
  console.log("  4.  Analyse Binaire — bits, XOR, parité binaire");
  console.log("  5.  Paires & Triplets — combinaisons fréquentes");
  console.log("  6.  Distribution — sommes, pair/impair, haut/bas");
  console.log("  7.  Terminaisons & Dizaines — dernier chiffre, tranches");
  console.log("  8.  Chaînes Markov — transitions entre tirages");
  console.log("  9.  Tests Statistiques — Chi², premiers, Fibonacci, corrélation");
  console.log("  10. Tendances Glissantes — fenêtres 10/20/50");
  console.log("  11. Prédictions par Tirage — combo par type de jeu");

  // --- Résumé console ---
  console.log("\n═══ RÉSUMÉ RAPIDE ═══");
  console.log(`\nTop 5 numéros (score combiné): ${predData.ranked.slice(0, 5).map(r => r.num).join(", ")}`);
  console.log(`Combo recommandée #1: ${predData.combos[0].nums.join(" - ")}`);
  console.log(`Chi² uniformité (95%): ${chiData.uniform95}`);
  console.log(`Somme moyenne: ${distData.avgSomme} (écart-type: ${distData.stdDev})`);
  console.log(`Distribution pair/impair la plus fréquente: ${distData.pairImpair[0][0]} (${distData.pairImpair[0][1]}x)`);
}

main().catch(console.error);
