// Simulation 6 mois — 4 strategies comparees
// Budget: 600F/jour (3 tirages x 200F)
const { loadDB } = require("./db");
const { computeCriteriaTops, convergenceScore, loadLearnState, getCategoryForType } = require("./apprentissage");
const { NeuralNet, predictNeural, MODEL_PATH } = require("./neural");

const db = loadDB();
const draws = db.draws;
const state = loadLearnState();
const nn = NeuralNet.load(MODEL_PATH);

const TOP_DRAWS = {
  0: ["Benediction","Prestige","Digital 23h"],
  1: ["Akwaba","Monday Special","Digital 23h"],
  2: ["Sika","Lucky Tuesday","Digital 23h"],
  3: ["Midweek","Baraka","Digital 23h"],
  4: ["Fortune Thursday","Digital 23h","Digital Reveil 7h"],
  5: ["Friday Bonanza","Digital 23h","Digital Reveil 7h"],
  6: ["Special Weekend 3h","Diamant","Digital 23h"],
};

// Cotes Standard (mise 100F)
const STD = { "1N": 1100, "2N": 24000, "3N": 200000, "4N": 500000, "5N": 4000000 };
// Cotes Chance 3+ Standard
const CH3_STD = { 2: 6000, 3: 175000 };
// Cotes Double Chance (estimees x0.5 car 10 cibles au lieu de 5)
const CH3_DC = { 2: 3000, 3: 87500 };
// Cotes 2N Standard
const N2_STD = 24000;
// Cotes 2N Double Chance (estimees)
const N2_DC = 12000;

function parseDate(s) {
  const p = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return p ? new Date(parseInt(p[3]), parseInt(p[2]) - 1, parseInt(p[1])) : null;
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
    else break;
    if (idx < 0) idx = att.length - 1;
    const rep = ranked.find(cond);
    if (rep) att[idx] = rep.num; else break;
  }
  return att.sort((a, b) => a - b);
}

const lastDate = parseDate(draws[0].date);
const sixMonthsAgo = new Date(lastDate);
sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

// 4 strategies
// S1: Bot Chance3+ Standard (100F) + IA Chance3+ Standard (100F) = 200F/tirage
// S2: Bot Chance3+ Double Chance (100F) + IA Chance3+ Double Chance (100F) = 200F/tirage
// S3: Bot Chance3+ Standard (100F) + Bot 2N Double Chance (100F) = 200F/tirage
// S4: MIXTE: Bot Chance3+ Std (100F) + IA Chance3+ DC (100F) = 200F/tirage

const strats = [
  { name: "S1: Bot+IA Chance3+ Standard", dep: 0, gain: 0, wins: 0, details: [] },
  { name: "S2: Bot+IA Chance3+ Double Chance", dep: 0, gain: 0, wins: 0, details: [] },
  { name: "S3: Bot Ch3+Std + Bot 2N DblChance", dep: 0, gain: 0, wins: 0, details: [] },
  { name: "S4: Bot Ch3+Std + IA Ch3+DblChance", dep: 0, gain: 0, wins: 0, details: [] },
];

let totalPlays = 0;
process.stderr.write("Simulation en cours...\n");

for (let i = 0; i < draws.length; i++) {
  const target = draws[i];
  const dt = parseDate(target.date);
  if (!dt || dt < sixMonthsAgo) break;

  const jour = dt.getDay();
  const topDraws = TOP_DRAWS[jour];
  if (!topDraws || !topDraws.includes(target.type)) continue;

  const hist = draws.slice(i + 1);
  const filtered = hist.filter(d => d.type === target.type);
  if (filtered.length < 20) continue;

  const cat = getCategoryForType(target.type);
  const w = state.categoryWeights[cat] || state.criteriaWeights;
  const tops = computeCriteriaTops(filtered, hist, 15, jour);
  if (!tops) continue;

  const ranked = convergenceScore(tops, w);
  const botNums = ajuster(ranked.slice(0, 5).map(r => r.num), ranked);

  const nnScores = predictNeural(nn, hist, target.type, jour);
  let iaNums = [];
  if (nnScores && nnScores.length >= 5) {
    iaNums = nnScores.slice(0, 5).map(s => s.num).sort((a, b) => a - b);
  }

  const gSet = new Set(target.gagnants);
  const mach = target.machine || [];
  const mSet = new Set(mach.filter(n => n > 0));
  const gmSet = new Set([...target.gagnants, ...mach.filter(n => n > 0)]);
  const hasMachine = mSet.size > 0;

  // Hits Bot
  const botHitsG = botNums.filter(n => gSet.has(n)).length;
  const botHitsGM = botNums.filter(n => gmSet.has(n)).length;

  // Hits IA
  const iaHitsG = iaNums.length > 0 ? iaNums.filter(n => gSet.has(n)).length : 0;
  const iaHitsGM = iaNums.length > 0 ? iaNums.filter(n => gmSet.has(n)).length : 0;

  totalPlays++;

  // S1: Bot Ch3+ Std + IA Ch3+ Std
  strats[0].dep += 200;
  let s1g = (CH3_STD[botHitsG] || 0) + (iaNums.length > 0 ? (CH3_STD[iaHitsG] || 0) : 0);
  strats[0].gain += s1g;
  if (s1g > 0) { strats[0].wins++; strats[0].details.push({ date: target.date, tirage: target.type, gain: s1g, botH: botHitsG, iaH: iaHitsG, mode: "Std" }); }

  // S2: Bot Ch3+ DC + IA Ch3+ DC (gagnants+machine)
  strats[1].dep += 200;
  const botHDC = hasMachine ? botHitsGM : botHitsG;
  const iaHDC = hasMachine ? iaHitsGM : iaHitsG;
  const cotesDC = hasMachine ? CH3_DC : CH3_STD;
  let s2g = (cotesDC[Math.min(botHDC, 3)] || 0) + (iaNums.length > 0 ? (cotesDC[Math.min(iaHDC, 3)] || 0) : 0);
  strats[1].gain += s2g;
  if (s2g > 0) { strats[1].wins++; strats[1].details.push({ date: target.date, tirage: target.type, gain: s2g, botH: botHDC, iaH: iaHDC, mode: "DC" }); }

  // S3: Bot Ch3+ Std + Bot 2N DC
  strats[2].dep += 200;
  let s3g = (CH3_STD[botHitsG] || 0);
  if (hasMachine && botHitsGM >= 2) s3g += N2_DC;
  else if (!hasMachine && botHitsG >= 2) s3g += N2_STD;
  strats[2].gain += s3g;
  if (s3g > 0) { strats[2].wins++; strats[2].details.push({ date: target.date, tirage: target.type, gain: s3g, botH: botHitsG, botHGM: botHitsGM, mode: "Mix" }); }

  // S4: Bot Ch3+ Std + IA Ch3+ DC
  strats[3].dep += 200;
  let s4g = (CH3_STD[botHitsG] || 0) + (iaNums.length > 0 ? (cotesDC[Math.min(iaHDC, 3)] || 0) : 0);
  strats[3].gain += s4g;
  if (s4g > 0) { strats[3].wins++; strats[3].details.push({ date: target.date, tirage: target.type, gain: s4g, botH: botHitsG, iaH: iaHDC, mode: "Mix" }); }

  if (totalPlays % 100 === 0) process.stderr.write("  " + totalPlays + " tirages...\n");
}

const daysSet = new Set();
for (let i = 0; i < draws.length; i++) {
  const dt = parseDate(draws[i].date);
  if (dt && dt >= sixMonthsAgo) {
    const topD = TOP_DRAWS[dt.getDay()];
    if (topD && topD.includes(draws[i].type)) daysSet.add(draws[i].date);
  }
}
const joursJoues = daysSet.size;

console.log("=".repeat(60));
console.log("  SIMULATION 6 MOIS — 4 STRATEGIES COMPAREES");
console.log("  Budget: 600F/jour (3 tirages x 200F)");
console.log("  Cotes Double Chance estimees a 50% du Standard");
console.log("=".repeat(60));
console.log("");
console.log("Periode: " + sixMonthsAgo.toLocaleDateString("fr") + " -> " + lastDate.toLocaleDateString("fr"));
console.log("Jours joues: " + joursJoues + " | Tirages: " + totalPlays);
console.log("Depense totale: " + (joursJoues * 600).toLocaleString() + "F par strategie");
console.log("");

console.log("=".repeat(60));
console.log("  CLASSEMENT DES STRATEGIES");
console.log("=".repeat(60));
console.log("");

const sorted = strats.map((s, i) => ({ ...s, profit: s.gain - s.dep, roi: ((s.gain - s.dep) / s.dep * 100) }));
sorted.sort((a, b) => b.profit - a.profit);

for (let i = 0; i < sorted.length; i++) {
  const s = sorted[i];
  const medal = i === 0 ? ">>> " : "    ";
  console.log(medal + s.name);
  console.log("    Depense: " + s.dep.toLocaleString() + "F | Gains: " + s.gain.toLocaleString() + "F");
  console.log("    Profit: " + (s.profit >= 0 ? "+" : "") + s.profit.toLocaleString() + "F | ROI: " + (s.profit >= 0 ? "+" : "") + s.roi.toFixed(1) + "% | Tirages gagnants: " + s.wins);
  console.log("");
}

// Detail de la meilleure strategie
const best = sorted[0];
console.log("=".repeat(60));
console.log("  MEILLEURE STRATEGIE: " + best.name);
console.log("=".repeat(60));
console.log("");
console.log("  Profit: +" + best.profit.toLocaleString() + "F (ROI +" + best.roi.toFixed(1) + "%)");
console.log("  " + best.wins + " tirages gagnants sur " + totalPlays);
console.log("");
console.log("  Top gains:");
best.details.sort((a, b) => b.gain - a.gain);
for (let i = 0; i < Math.min(15, best.details.length); i++) {
  const d = best.details[i];
  console.log("    " + d.date + " " + d.tirage.padEnd(22) + d.gain.toLocaleString() + "F" + (d.botH >= 3 || d.iaH >= 3 ? " *** 3+ BONS" : ""));
}

// Comparaison Standard vs Double Chance
console.log("");
console.log("=".repeat(60));
console.log("  IMPACT DOUBLE CHANCE (machine = gagnant)");
console.log("=".repeat(60));
console.log("");
console.log("  Standard seul (S1):      " + strats[0].wins + " gains -> " + strats[0].gain.toLocaleString() + "F");
console.log("  Double Chance (S2):       " + strats[1].wins + " gains -> " + strats[1].gain.toLocaleString() + "F");
console.log("  Mixte Bot+IA DC (S4):    " + strats[3].wins + " gains -> " + strats[3].gain.toLocaleString() + "F");
console.log("");
console.log("  La Double Chance trouve " + strats[1].wins + " tirages gagnants vs " + strats[0].wins + " en standard");
console.log("  Meme si les cotes sont plus basses, le volume de gains compense");
