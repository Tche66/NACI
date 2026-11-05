const ExcelJS = require("exceljs");
const { loadDB } = require("./db");

const NUM_RANGE = 90;
const DRAW_SIZE = 5;

const JOURS_TIRAGES = {
  1: ["Reveil","Etoile","Akwaba","Monday Special","Afterwork","Digital Reveil 7h","Digital Reveil 8h","Digital 21h","Digital 22h","Digital 23h"],
  2: ["La Matinale","Emergence","Sika","Lucky Tuesday","Afterwork","Digital Reveil 7h","Digital Reveil 8h","Digital 21h","Digital 22h","Digital 23h"],
  3: ["Premiere Heure","Fortune","Baraka","Midweek","Afterwork","Digital Reveil 7h","Digital Reveil 8h","Digital 21h","Digital 22h","Digital 23h"],
  4: ["Kado","Privilege","Monni","Fortune Thursday","Afterwork","Digital Reveil 7h","Digital Reveil 8h","Digital 21h","Digital 22h","Digital 23h"],
  5: ["Cash","Solution","Wari","Friday Bonanza","Afterwork","Digital Reveil 7h","Digital Reveil 8h","Digital 21h","Digital 22h","Digital 23h"],
  6: ["Soutra","Diamant","Moaye","National","Afterwork","Digital Reveil 7h","Digital Reveil 8h","Digital 21h","Digital 22h","Digital 23h","Special Weekend 1h","Special Weekend 3h"],
  0: ["Benediction","Prestige","Awale","Espoir","Afterwork","Digital Reveil 7h","Digital Reveil 8h","Digital 21h","Digital 22h","Digital 23h","Special Weekend 1h","Special Weekend 3h"],
};

const JOURS_NOMS = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

function scoringComplet(draws, typeFilter) {
  const filtered = typeFilter ? draws.filter((d) => d.type === typeFilter) : draws;
  if (filtered.length < 10) return null;

  const scores = Array(NUM_RANGE + 1).fill(0);

  // 1. Fréquence globale (15pts)
  const freq = Array(NUM_RANGE + 1).fill(0);
  for (const d of filtered) for (const n of d.gagnants) freq[n]++;
  const maxFreq = Math.max(...freq.slice(1)) || 1;
  for (let i = 1; i <= NUM_RANGE; i++) scores[i] += (freq[i] / maxFreq) * 15;

  // 2. Fréquence récente — 30 derniers du type (25pts)
  const recent = filtered.slice(0, 30);
  const freqR = Array(NUM_RANGE + 1).fill(0);
  for (const d of recent) for (const n of d.gagnants) freqR[n]++;
  const maxFreqR = Math.max(...freqR.slice(1)) || 1;
  for (let i = 1; i <= NUM_RANGE; i++) scores[i] += (freqR[i] / maxFreqR) * 25;

  // 3. Retard — bonus progressif (15pts)
  const lastSeen = Array(NUM_RANGE + 1).fill(filtered.length);
  for (let idx = 0; idx < filtered.length; idx++) {
    for (const n of filtered[idx].gagnants) {
      if (lastSeen[n] === filtered.length) lastSeen[n] = idx;
    }
  }
  const maxRetard = Math.max(...lastSeen.slice(1)) || 1;
  for (let i = 1; i <= NUM_RANGE; i++) scores[i] += (lastSeen[i] / maxRetard) * 15;

  // 4. Tendance haussière (10pts)
  const first50 = filtered.slice(0, 50);
  const last50 = filtered.slice(-50);
  const freqF = Array(NUM_RANGE + 1).fill(0);
  const freqL = Array(NUM_RANGE + 1).fill(0);
  for (const d of first50) for (const n of d.gagnants) freqF[n]++;
  for (const d of last50) for (const n of d.gagnants) freqL[n]++;
  for (let i = 1; i <= NUM_RANGE; i++) {
    const trend = freqF[i] - freqL[i];
    scores[i] += Math.max(0, (trend / 10) * 10);
  }

  // 5. Paires fréquentes (10pts)
  const pairScore = Array(NUM_RANGE + 1).fill(0);
  const paires = {};
  for (const d of filtered) {
    const sorted = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}-${sorted[j]}`;
        paires[key] = (paires[key] || 0) + 1;
      }
  }
  const topPairs = Object.entries(paires).sort((a, b) => b[1] - a[1]).slice(0, 80);
  for (const [key, count] of topPairs) {
    const [a, b] = key.split("-").map(Number);
    pairScore[a] += count; pairScore[b] += count;
  }
  const maxPS = Math.max(...pairScore.slice(1)) || 1;
  for (let i = 1; i <= NUM_RANGE; i++) scores[i] += (pairScore[i] / maxPS) * 10;

  // 6. Profil binaire (10pts)
  const bitOnes = Array(7).fill(0);
  let totalNums = 0;
  for (const d of filtered.slice(0, 50)) {
    for (const n of d.gagnants) {
      const bin = n.toString(2).padStart(7, "0");
      for (let b = 0; b < 7; b++) if (bin[b] === "1") bitOnes[b]++;
      totalNums++;
    }
  }
  const bitRatios = bitOnes.map((o) => o / (totalNums || 1));
  for (let i = 1; i <= NUM_RANGE; i++) {
    const bin = i.toString(2).padStart(7, "0");
    let bs = 0;
    for (let b = 0; b < 7; b++) {
      if (bin[b] === "1") bs += bitRatios[b]; else bs += (1 - bitRatios[b]);
    }
    scores[i] += (bs / 7) * 10;
  }

  // 7. Markov — basé sur le dernier tirage du type (15pts)
  if (filtered.length > 1) {
    const lastNums = filtered[0].gagnants;
    const markov = Array(NUM_RANGE + 1).fill(0);
    for (let idx = 1; idx < filtered.length; idx++) {
      const hasMatch = filtered[idx].gagnants.some((n) => lastNums.includes(n));
      if (hasMatch) {
        for (const n of filtered[idx - 1].gagnants) markov[n]++;
      }
    }
    const maxM = Math.max(...markov.slice(1)) || 1;
    for (let i = 1; i <= NUM_RANGE; i++) scores[i] += (markov[i] / maxM) * 15;
  }

  const ranked = [];
  for (let i = 1; i <= NUM_RANGE; i++) ranked.push({ num: i, score: +scores[i].toFixed(2) });
  ranked.sort((a, b) => b.score - a.score);

  // Générer 4 combos
  const combos = [];

  // Combo 1: Top score
  combos.push({
    nom: "TOP SCORE",
    nums: ranked.slice(0, 5).map((r) => r.num).sort((a, b) => a - b),
    confiance: "HAUTE",
  });

  // Combo 2: Mix chaud + retard
  const hot = ranked.filter((r) => freqR[r.num] >= 3).slice(0, 3).map((r) => r.num);
  const cold = ranked.filter((r) => lastSeen[r.num] >= 10).slice(0, 3).map((r) => r.num);
  const mix = [...new Set([...hot, ...cold])].slice(0, 5);
  if (mix.length === 5) {
    combos.push({ nom: "MIX CHAUD+RETARD", nums: mix.sort((a, b) => a - b), confiance: "MOYENNE" });
  }

  // Combo 3: Équilibré pair/impair + haut/bas
  const rankPairs = ranked.filter((r) => r.num % 2 === 0).slice(0, 2).map((r) => r.num);
  const rankImpairs = ranked.filter((r) => r.num % 2 === 1).slice(0, 3).map((r) => r.num);
  combos.push({
    nom: "ÉQUILIBRÉ",
    nums: [...rankPairs, ...rankImpairs].sort((a, b) => a - b),
    confiance: "HAUTE",
  });

  // Combo 4: Somme optimale (~225)
  const targetSum = 225;
  const sumCombo = [];
  const avail = [...ranked];
  for (let pick = 0; pick < 5; pick++) {
    const rem = 5 - pick;
    const curSum = sumCombo.reduce((a, b) => a + b, 0);
    const targetPer = (targetSum - curSum) / rem;
    avail.sort((a, b) => {
      const da = Math.abs(a.num - targetPer) - a.score * 0.1;
      const db = Math.abs(b.num - targetPer) - b.score * 0.1;
      return da - db;
    });
    sumCombo.push(avail.splice(0, 1)[0].num);
  }
  combos.push({
    nom: "SOMME OPTIMALE",
    nums: sumCombo.sort((a, b) => a - b),
    confiance: "MOYENNE",
    somme: sumCombo.reduce((a, b) => a + b, 0),
  });

  return {
    top20: ranked.slice(0, 20),
    combos,
    nbTiragesAnalyses: filtered.length,
    dernierTirage: filtered[0],
  };
}

async function main() {
  const db = loadDB();
  if (db.draws.length === 0) {
    console.log("Base vide ! Lance d'abord: node update.js --full");
    return;
  }

  const now = new Date();
  const jourSemaine = now.getDay();
  const jourNom = JOURS_NOMS[jourSemaine];
  const dateStr = `${String(now.getDate()).padStart(2,"0")}/${String(now.getMonth()+1).padStart(2,"0")}/${now.getFullYear()}`;

  const tiragesDuJour = JOURS_TIRAGES[jourSemaine] || [];

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log(`║  PRÉDICTIONS DU ${jourNom.toUpperCase()} ${dateStr}`.padEnd(55) + "║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\nBase: ${db.draws.length} tirages | MAJ: ${db.lastUpdate || "?"}`);
  console.log(`Tirages prévus aujourd'hui: ${tiragesDuJour.length}\n`);

  const wb = new ExcelJS.Workbook();

  const greenHeader = {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D32" } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} },
  };
  function applyBorder(cell) {
    cell.border = {
      top:{style:"thin",color:{argb:"FFE0E0E0"}}, bottom:{style:"thin",color:{argb:"FFE0E0E0"}},
      left:{style:"thin",color:{argb:"FFE0E0E0"}}, right:{style:"thin",color:{argb:"FFE0E0E0"}},
    };
    cell.alignment = { horizontal: "center" };
  }

  // ═══════ FEUILLE RÉSUMÉ DU JOUR ═══════
  const dateSafe = dateStr.replace(/\//g, "-");
  const wsSummary = wb.addWorksheet(`${jourNom} ${dateSafe}`);
  wsSummary.getColumn(1).width = 25;
  wsSummary.getColumn(2).width = 12;
  for (let i = 3; i <= 7; i++) wsSummary.getColumn(i).width = 8;
  wsSummary.getColumn(8).width = 12;
  wsSummary.getColumn(9).width = 14;

  let row = 1;
  wsSummary.getRow(row).getCell(1).value = `PRÉDICTIONS — ${jourNom.toUpperCase()} ${dateStr}`;
  wsSummary.getRow(row).getCell(1).font = { bold: true, size: 16, color: { argb: "FF2E7D32" } };
  row += 2;

  wsSummary.getRow(row).getCell(1).value = `Base de données: ${db.draws.length} tirages analysés`;
  wsSummary.getRow(row).getCell(1).font = { italic: true };
  row += 2;

  // Prédiction globale d'abord
  console.log("═══ PRÉDICTION GLOBALE (tous tirages confondus) ═══\n");
  const globalPred = scoringComplet(db.draws, null);

  wsSummary.getRow(row).getCell(1).value = "PRÉDICTION GLOBALE (tous tirages)";
  wsSummary.getRow(row).getCell(1).font = { bold: true, size: 14, color: { argb: "FFC62828" } };
  row++;

  ["Stratégie","Confiance","N°1","N°2","N°3","N°4","N°5","Somme"].forEach((h, i) => {
    wsSummary.getRow(row).getCell(i + 1).value = h;
    const cell = wsSummary.getRow(row).getCell(i + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC62828" } };
    cell.alignment = { horizontal: "center" };
    cell.border = greenHeader.border;
  });
  row++;

  for (const combo of globalPred.combos) {
    const r = wsSummary.getRow(row);
    r.getCell(1).value = combo.nom;
    r.getCell(1).font = { bold: true };
    r.getCell(1).alignment = { horizontal: "left" };
    r.getCell(2).value = combo.confiance;
    r.getCell(2).font = { bold: true, color: { argb: combo.confiance === "HAUTE" ? "FF2E7D32" : "FFEF6C00" } };
    combo.nums.forEach((n, i) => {
      r.getCell(i + 3).value = n;
      r.getCell(i + 3).font = { bold: true, size: 14, color: { argb: "FFC62828" } };
      r.getCell(i + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
      r.getCell(i + 3).alignment = { horizontal: "center" };
    });
    r.getCell(8).value = combo.nums.reduce((a, b) => a + b, 0);
    r.getCell(8).alignment = { horizontal: "center" };
    console.log(`  ${combo.nom}: ${combo.nums.join(" - ")} (${combo.confiance})`);
    row++;
  }
  row += 2;

  // Prédictions par tirage du jour
  wsSummary.getRow(row).getCell(1).value = `PRÉDICTIONS PAR TIRAGE — ${jourNom.toUpperCase()}`;
  wsSummary.getRow(row).getCell(1).font = { bold: true, size: 14, color: { argb: "FF1565C0" } };
  row++;

  ["Tirage","Données","N°1","N°2","N°3","N°4","N°5","Somme","Confiance"].forEach((h, i) => {
    wsSummary.getRow(row).getCell(i + 1).value = h;
    const cell = wsSummary.getRow(row).getCell(i + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } };
    cell.alignment = { horizontal: "center" };
    cell.border = greenHeader.border;
  });
  row++;

  console.log(`\n═══ PRÉDICTIONS PAR TIRAGE (${jourNom}) ═══\n`);

  for (const tirage of tiragesDuJour) {
    const pred = scoringComplet(db.draws, tirage);
    const r = wsSummary.getRow(row);
    r.getCell(1).value = tirage;
    r.getCell(1).font = { bold: true };
    r.getCell(1).alignment = { horizontal: "left" };

    if (!pred) {
      r.getCell(2).value = "< 10 tirages";
      r.getCell(2).font = { italic: true, color: { argb: "FF999999" } };
      console.log(`  ${tirage}: pas assez de données`);
    } else {
      const combo = pred.combos[0];
      r.getCell(2).value = `${pred.nbTiragesAnalyses} tirages`;
      combo.nums.forEach((n, i) => {
        r.getCell(i + 3).value = n;
        r.getCell(i + 3).font = { bold: true, size: 13, color: { argb: "FF1565C0" } };
        r.getCell(i + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F2FD" } };
        r.getCell(i + 3).alignment = { horizontal: "center" };
      });
      r.getCell(8).value = combo.nums.reduce((a, b) => a + b, 0);
      r.getCell(8).alignment = { horizontal: "center" };
      r.getCell(9).value = combo.confiance;
      r.getCell(9).font = { bold: true, color: { argb: combo.confiance === "HAUTE" ? "FF2E7D32" : "FFEF6C00" } };
      console.log(`  ${tirage.padEnd(22)} → ${combo.nums.join(" - ")}  (${pred.nbTiragesAnalyses} tirages, ${combo.confiance})`);
    }
    r.eachCell((c) => applyBorder(c));
    row++;
  }
  row += 2;

  // Top 20 global
  wsSummary.getRow(row).getCell(1).value = "TOP 20 NUMÉROS DU JOUR (score global)";
  wsSummary.getRow(row).getCell(1).font = { bold: true, size: 14, color: { argb: "FF6A1B9A" } };
  row++;

  ["Rang","Numéro","Score"].forEach((h, i) => {
    wsSummary.getRow(row).getCell(i + 1).value = h;
    const cell = wsSummary.getRow(row).getCell(i + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6A1B9A" } };
    cell.alignment = { horizontal: "center" };
  });
  row++;

  for (let i = 0; i < 20; i++) {
    const item = globalPred.top20[i];
    const r = wsSummary.getRow(row);
    r.getCell(1).value = i + 1;
    r.getCell(2).value = item.num;
    r.getCell(3).value = item.score;
    r.eachCell((c) => applyBorder(c));
    if (i < 5) {
      r.getCell(2).font = { bold: true, size: 12, color: { argb: "FFC62828" } };
      r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
    }
    row++;
  }

  // ═══════ FEUILLES DÉTAILLÉES PAR TIRAGE ═══════
  for (const tirage of tiragesDuJour) {
    const pred = scoringComplet(db.draws, tirage);
    if (!pred) continue;

    const wsT = wb.addWorksheet(tirage.substring(0, 31));
    wsT.getColumn(1).width = 25; wsT.getColumn(2).width = 12;
    for (let i = 3; i <= 7; i++) wsT.getColumn(i).width = 8;
    wsT.getColumn(8).width = 12;

    let tr = 1;
    wsT.getRow(tr).getCell(1).value = `${tirage} — Prédictions ${dateStr}`;
    wsT.getRow(tr).getCell(1).font = { bold: true, size: 14, color: { argb: "FF1565C0" } };
    tr++;
    wsT.getRow(tr).getCell(1).value = `${pred.nbTiragesAnalyses} tirages analysés | Dernier: ${pred.dernierTirage.date}`;
    wsT.getRow(tr).getCell(1).font = { italic: true };
    tr++;
    wsT.getRow(tr).getCell(1).value = `Derniers gagnants: ${pred.dernierTirage.gagnants.join(" - ")}`;
    wsT.getRow(tr).getCell(1).font = { italic: true };
    tr += 2;

    wsT.getRow(tr).getCell(1).value = "COMBINAISONS";
    wsT.getRow(tr).getCell(1).font = { bold: true, size: 12, color: { argb: "FFC62828" } };
    tr++;

    for (const combo of pred.combos) {
      const r = wsT.getRow(tr);
      r.getCell(1).value = combo.nom;
      r.getCell(1).font = { bold: true };
      r.getCell(2).value = combo.confiance;
      combo.nums.forEach((n, i) => {
        r.getCell(i + 3).value = n;
        r.getCell(i + 3).font = { bold: true, size: 13, color: { argb: "FFC62828" } };
        r.getCell(i + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
        r.getCell(i + 3).alignment = { horizontal: "center" };
      });
      r.getCell(8).value = combo.nums.reduce((a, b) => a + b, 0);
      tr++;
    }
    tr += 2;

    wsT.getRow(tr).getCell(1).value = "TOP 20 NUMÉROS";
    wsT.getRow(tr).getCell(1).font = { bold: true, size: 12, color: { argb: "FF1565C0" } };
    tr++;

    ["Rang","Numéro","Score"].forEach((h, i) => {
      wsT.getRow(tr).getCell(i + 1).value = h;
      const cell = wsT.getRow(tr).getCell(i + 1);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } };
      cell.alignment = { horizontal: "center" };
    });
    tr++;

    for (let i = 0; i < 20; i++) {
      const item = pred.top20[i];
      const r = wsT.getRow(tr);
      r.getCell(1).value = i + 1;
      r.getCell(2).value = item.num;
      r.getCell(3).value = item.score;
      r.eachCell((c) => applyBorder(c));
      if (i < 5) {
        r.getCell(2).font = { bold: true, color: { argb: "FFC62828" } };
      }
      tr++;
    }
  }

  // ═══════ FEUILLE PRÉDICTIONS 7 JOURS ═══════
  const ws7 = wb.addWorksheet("7 prochains jours");
  ws7.getColumn(1).width = 18;
  ws7.getColumn(2).width = 22;
  for (let i = 3; i <= 7; i++) ws7.getColumn(i).width = 8;
  ws7.getColumn(8).width = 12;

  let r7 = 1;
  ws7.getRow(r7).getCell(1).value = "PRÉDICTIONS — 7 PROCHAINS JOURS";
  ws7.getRow(r7).getCell(1).font = { bold: true, size: 16, color: { argb: "FF2E7D32" } };
  r7 += 2;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const fJour = futureDate.getDay();
    const fNom = JOURS_NOMS[fJour];
    const fDate = `${String(futureDate.getDate()).padStart(2,"0")}/${String(futureDate.getMonth()+1).padStart(2,"0")}/${futureDate.getFullYear()}`;
    const fTirages = JOURS_TIRAGES[fJour] || [];

    ws7.getRow(r7).getCell(1).value = `${fNom} ${fDate}`;
    ws7.getRow(r7).getCell(1).font = { bold: true, size: 13, color: { argb: "FF1565C0" } };
    r7++;

    ["Tirage","","N°1","N°2","N°3","N°4","N°5","Somme"].forEach((h, i) => {
      if (!h) return;
      ws7.getRow(r7).getCell(i + 1).value = h;
      const cell = ws7.getRow(r7).getCell(i + 1);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF37474F" } };
      cell.alignment = { horizontal: "center" };
    });
    r7++;

    for (const tirage of fTirages) {
      const pred = scoringComplet(db.draws, tirage);
      const r = ws7.getRow(r7);
      r.getCell(1).value = tirage;
      r.getCell(1).font = { bold: true, size: 10 };
      r.getCell(1).alignment = { horizontal: "left" };

      if (pred) {
        const combo = pred.combos[0];
        combo.nums.forEach((n, i) => {
          r.getCell(i + 3).value = n;
          r.getCell(i + 3).font = { bold: true, color: { argb: "FFC62828" } };
          r.getCell(i + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
          r.getCell(i + 3).alignment = { horizontal: "center" };
        });
        r.getCell(8).value = combo.nums.reduce((a, b) => a + b, 0);
        r.getCell(8).alignment = { horizontal: "center" };
      } else {
        r.getCell(3).value = "Données insuffisantes";
        r.getCell(3).font = { italic: true, color: { argb: "FF999999" } };
      }
      r7++;
    }
    r7 += 1;
  }

  // Sauvegarder
  const filename = `C:/Users/hp/lonaci-scraper/PREDICTIONS_${dateStr.replace(/\//g, "-")}.xlsx`;
  await wb.xlsx.writeFile(filename);

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  FICHIER PRÉDICTIONS GÉNÉRÉ !                        ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`\nFichier: ${filename}`);
  console.log("\nFeuilles:");
  console.log(`  1. ${jourNom} ${dateStr} — résumé du jour`);
  for (const t of tiragesDuJour) {
    const pred = scoringComplet(db.draws, t);
    if (pred) console.log(`  ·  ${t} — détail + top 20`);
  }
  console.log("  ·  7 prochains jours — prédictions semaine");
}

main().catch(console.error);
