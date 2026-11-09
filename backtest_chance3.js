// Simulation CORRIGEE — Chance 3+ = 3 numeros (pas 5)
// Bot top 3 + IA top 3, Double Chance, 100F chaque
const { loadDB } = require("./db");
const { computeCriteriaTops, convergenceScore, loadLearnState, getCategoryForType } = require("./apprentissage");
const { NeuralNet, predictNeural, MODEL_PATH } = require("./neural");
const db = loadDB(), draws = db.draws, state = loadLearnState();
const nn = NeuralNet.load(MODEL_PATH);

const TOP_DRAWS = {
  0:["Benediction","Prestige","Digital 23h"],
  1:["Akwaba","Monday Special","Digital 23h"],
  2:["Sika","Lucky Tuesday","Digital 23h"],
  3:["Midweek","Baraka","Digital 23h"],
  4:["Fortune Thursday","Digital 23h","Digital Reveil 7h"],
  5:["Friday Bonanza","Digital 23h","Digital Reveil 7h"],
  6:["Special Weekend 3h","Diamant","Digital 23h"],
};

const GAINS_STD = {2: 6000, 3: 175000};
const GAINS_DC  = {2: 3000, 3: 87500};

function parseDate(s) {
  const p = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return p ? new Date(parseInt(p[3]), parseInt(p[2]) - 1, parseInt(p[1])) : null;
}

const lastDate = parseDate(draws[0].date);
const start = new Date(lastDate);
start.setMonth(start.getMonth() - 6);

const R = {
  bot3std: {h0:0,h1:0,h2:0,h3:0,gain:0,dep:0,n:0},
  ia3std:  {h0:0,h1:0,h2:0,h3:0,gain:0,dep:0,n:0},
  bot3dc:  {h0:0,h1:0,h2:0,h3:0,gain:0,dep:0,n:0},
  ia3dc:   {h0:0,h1:0,h2:0,h3:0,gain:0,dep:0,n:0},
};
const wins = [];
const monthly = {};

process.stderr.write("Simulation Chance 3+ corrigee (3 nums)...\n");

for (let i = 0; i < draws.length; i++) {
  const t = draws[i], dt = parseDate(t.date);
  if (!dt || dt < start) break;
  const jour = dt.getDay(), topD = TOP_DRAWS[jour];
  if (!topD || !topD.includes(t.type)) continue;

  const hist = draws.slice(i + 1);
  const filt = hist.filter(d => d.type === t.type);
  if (filt.length < 20) continue;

  const cat = getCategoryForType(t.type);
  const w = state.categoryWeights[cat] || state.criteriaWeights;
  const tops = computeCriteriaTops(filt, hist, 15, jour);
  if (!tops) continue;
  const ranked = convergenceScore(tops, w);

  const bot3 = ranked.slice(0, 3).map(r => r.num);
  const nnS = predictNeural(nn, hist, t.type, jour);
  const ia3 = nnS && nnS.length >= 3 ? nnS.slice(0, 3).map(s => s.num) : [];

  const gSet = new Set(t.gagnants);
  const mach = (t.machine || []).filter(n => n > 0);
  const gmSet = new Set([...t.gagnants, ...mach]);
  const hasMach = mach.length > 0;

  const b3g = bot3.filter(n => gSet.has(n)).length;
  const b3gm = bot3.filter(n => gmSet.has(n)).length;
  const i3g = ia3.length > 0 ? ia3.filter(n => gSet.has(n)).length : -1;
  const i3gm = ia3.length > 0 ? ia3.filter(n => gmSet.has(n)).length : -1;

  R.bot3std.n++; R.bot3std.dep += 100; R.bot3std["h" + b3g]++;
  R.bot3std.gain += (GAINS_STD[b3g] || 0);

  if (i3g >= 0) { R.ia3std.n++; R.ia3std.dep += 100; R.ia3std["h" + i3g]++; R.ia3std.gain += (GAINS_STD[i3g] || 0); }

  const b3dc = hasMach ? b3gm : b3g;
  const cDC = hasMach ? GAINS_DC : GAINS_STD;
  R.bot3dc.n++; R.bot3dc.dep += 100; R.bot3dc["h" + Math.min(b3dc, 3)]++;
  R.bot3dc.gain += (cDC[Math.min(b3dc, 3)] || 0);

  const i3dc = hasMach ? i3gm : i3g;
  if (i3dc >= 0) { R.ia3dc.n++; R.ia3dc.dep += 100; R.ia3dc["h" + Math.min(i3dc, 3)]++; R.ia3dc.gain += (cDC[Math.min(i3dc, 3)] || 0); }

  const gBot = cDC[Math.min(b3dc, 3)] || 0;
  const gIA = i3dc >= 0 ? (cDC[Math.min(i3dc, 3)] || 0) : 0;
  const gTotal = gBot + gIA;

  const mk = String(dt.getMonth() + 1).padStart(2, "0") + "/" + dt.getFullYear();
  if (!monthly[mk]) monthly[mk] = {dep: 0, gain: 0, plays: 0};
  monthly[mk].dep += 200; monthly[mk].gain += gTotal; monthly[mk].plays++;

  if (gTotal > 0) {
    wins.push({date: t.date, tirage: t.type, bot3, ia3, reel: t.gagnants, machine: mach, b3dc, i3dc: i3dc >= 0 ? i3dc : 0, gBot, gIA, gain: gTotal});
  }
  if (R.bot3dc.n % 100 === 0) process.stderr.write("  " + R.bot3dc.n + " tirages...\n");
}

const daysSet = new Set();
for (let i = 0; i < draws.length; i++) {
  const dt = parseDate(draws[i].date);
  if (dt && dt >= start) { const topD = TOP_DRAWS[dt.getDay()]; if (topD && topD.includes(draws[i].type)) daysSet.add(draws[i].date); }
}
const jj = daysSet.size;

console.log("=".repeat(60));
console.log("  CHANCE 3+ CORRIGE — ON JOUE 3 NUMEROS (pas 5)");
console.log("  Bot top 3 + IA top 3 = 2 paris x 100F par tirage");
console.log("  3 tirages recommandes par jour = 600F/jour");
console.log("=".repeat(60));
console.log("");
console.log("Periode: 6 mois | Jours: " + jj + " | Tirages: " + R.bot3dc.n);
console.log("");

console.log("--- COMPARAISON DES 4 STRATEGIES ---");
console.log("");
const strats = [
  ["Bot 3 nums Standard", R.bot3std],
  ["IA 3 nums Standard", R.ia3std],
  ["Bot 3 nums Dbl Chance", R.bot3dc],
  ["IA 3 nums Dbl Chance", R.ia3dc],
];
console.log("  " + "Strategie".padEnd(26) + "Paris".padStart(6) + "   Dep".padStart(10) + "  Gains".padStart(10) + "  Profit".padStart(10) + "   ROI".padStart(8) + "  2/3".padStart(5) + "  3/3".padStart(5));
console.log("  " + "-".repeat(78));
for (const [name, r] of strats) {
  const pf = r.gain - r.dep, roi = r.dep > 0 ? (pf / r.dep * 100).toFixed(0) : "0";
  console.log("  " + name.padEnd(26) + String(r.n).padStart(5) + String(r.dep).padStart(9) + "F" + String(r.gain).padStart(9) + "F" + (pf >= 0 ? "  +" : " ") + String(Math.abs(pf)).padStart(8) + "F" + String(roi + "%").padStart(8) + String(r.h2).padStart(5) + String(r.h3).padStart(5));
}

const bestDep = jj * 600;
const bestGain = R.bot3dc.gain + R.ia3dc.gain;
const bestPf = bestGain - bestDep;
console.log("");
console.log("=".repeat(60));
console.log("  BILAN: Bot+IA top3 Chance 3+ Double Chance");
console.log("  Depense:  " + bestDep.toLocaleString() + "F (" + jj + " jours x 600F)");
console.log("  Gains:    " + bestGain.toLocaleString() + "F");
console.log("  Profit:   " + (bestPf >= 0 ? "+" : "") + bestPf.toLocaleString() + "F");
console.log("  ROI:      " + (bestPf / bestDep * 100).toFixed(1) + "%");
console.log("  Gagnants: " + wins.length + " / " + (R.bot3dc.n * 2) + " paris");
console.log("=".repeat(60));
console.log("");

console.log("--- PAR MOIS ---");
for (const [mk, mv] of Object.entries(monthly).sort()) {
  const pf = mv.gain - mv.dep;
  console.log("  " + mk + ": " + mv.plays + " tirages | dep=" + mv.dep.toLocaleString() + "F | gain=" + mv.gain.toLocaleString() + "F | " + (pf >= 0 ? "+" : "") + pf.toLocaleString() + "F");
}

console.log("");
console.log("--- TIRAGES GAGNANTS (" + wins.length + ") ---");
wins.sort((a, b) => b.gain - a.gain);
for (const w of wins) {
  const src = w.gBot > 0 && w.gIA > 0 ? "BOT+IA" : w.gBot > 0 ? "BOT" : "IA";
  console.log("  " + w.date + " " + w.tirage.padEnd(22) + " " + src.padEnd(8) + w.gain.toLocaleString() + "F");
  if (w.gBot > 0) console.log("    Bot[" + w.bot3.join(",") + "] " + w.b3dc + "/3 vs G[" + w.reel.join(",") + "]" + (w.machine.length > 0 ? " M[" + w.machine.join(",") + "]" : ""));
  if (w.gIA > 0) console.log("    IA[" + w.ia3.join(",") + "] " + w.i3dc + "/3 vs G[" + w.reel.join(",") + "]" + (w.machine.length > 0 ? " M[" + w.machine.join(",") + "]" : ""));
}
