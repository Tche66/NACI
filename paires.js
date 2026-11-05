const ExcelJS = require("exceljs");
const { loadDB } = require("./db");

const NUM_RANGE = 90;

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

function scorePaires(draws, typeFilter) {
  const filtered = typeFilter ? draws.filter((d) => d.type === typeFilter) : draws;
  if (filtered.length < 10) return null;

  const pairFreq = {};
  const pairFreqRecent = {};
  const recent = filtered.slice(0, 30);

  // Fréquence globale de chaque paire
  for (const d of filtered) {
    const sorted = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}-${sorted[j]}`;
        pairFreq[key] = (pairFreq[key] || 0) + 1;
      }
    }
  }

  // Fréquence récente (30 derniers)
  for (const d of recent) {
    const sorted = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}-${sorted[j]}`;
        pairFreqRecent[key] = (pairFreqRecent[key] || 0) + 1;
      }
    }
  }

  // Retard de chaque paire
  const pairLastSeen = {};
  for (let idx = 0; idx < filtered.length; idx++) {
    const sorted = [...filtered[idx].gagnants].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}-${sorted[j]}`;
        if (!(key in pairLastSeen)) pairLastSeen[key] = idx;
      }
    }
  }

  // Markov paires — quelles paires suivent le dernier tirage
  const lastNums = filtered[0] ? filtered[0].gagnants : [];
  const markovPair = {};
  for (let idx = 1; idx < filtered.length; idx++) {
    const hasMatch = filtered[idx].gagnants.some((n) => lastNums.includes(n));
    if (hasMatch && filtered[idx - 1]) {
      const sorted = [...filtered[idx - 1].gagnants].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]}-${sorted[j]}`;
          markovPair[key] = (markovPair[key] || 0) + 1;
        }
      }
    }
  }

  // Analyse binaire des paires — compatibilité XOR
  const xorFreq = {};
  for (const d of filtered.slice(0, 100)) {
    const sorted = [...d.gagnants].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const xor = sorted[i] ^ sorted[j];
        xorFreq[xor] = (xorFreq[xor] || 0) + 1;
      }
    }
  }
  const topXorValues = Object.entries(xorFreq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([v]) => parseInt(v));

  // Scoring combiné
  const allPairs = Object.keys(pairFreq);
  const maxFreq = Math.max(...Object.values(pairFreq)) || 1;
  const maxFreqR = Math.max(...Object.values(pairFreqRecent)) || 1;
  const maxMarkov = Math.max(...Object.values(markovPair), 1);

  const scored = [];
  for (const key of allPairs) {
    const [a, b] = key.split("-").map(Number);
    const retard = pairLastSeen[key] ?? filtered.length;

    let score = 0;

    // Fréquence globale (20pts)
    score += (pairFreq[key] / maxFreq) * 20;

    // Fréquence récente (30pts)
    score += ((pairFreqRecent[key] || 0) / maxFreqR) * 30;

    // Retard — bonus aux paires fréquentes mais en retard (15pts)
    if (pairFreq[key] >= 3 && retard >= 5) {
      score += Math.min(retard / 20, 1) * 15;
    }

    // Markov (20pts)
    score += ((markovPair[key] || 0) / maxMarkov) * 20;

    // Compatibilité binaire XOR (10pts)
    const xor = a ^ b;
    if (topXorValues.includes(xor)) score += 10;

    // Équilibre pair/impair (5pts)
    if ((a % 2) !== (b % 2)) score += 5;

    scored.push({
      paire: key,
      a, b,
      score: +score.toFixed(2),
      freqGlobale: pairFreq[key],
      freqRecente: pairFreqRecent[key] || 0,
      retard,
      markov: markovPair[key] || 0,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    top30: scored.slice(0, 30),
    nbTirages: filtered.length,
    dernierTirage: filtered[0],
  };
}

function selectBestTwo(pairesResult) {
  if (!pairesResult || pairesResult.top30.length < 2) return null;

  const best = pairesResult.top30[0];

  // 2e paire : la meilleure qui n'a aucun numéro en commun avec la 1ère
  let second = null;
  for (let i = 1; i < pairesResult.top30.length; i++) {
    const p = pairesResult.top30[i];
    if (p.a !== best.a && p.a !== best.b && p.b !== best.a && p.b !== best.b) {
      second = p;
      break;
    }
  }
  if (!second) second = pairesResult.top30[1];

  return { paire1: best, paire2: second };
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
  const dateSafe = dateStr.replace(/\//g, "-");
  const tiragesDuJour = JOURS_TIRAGES[jourSemaine] || [];

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║  PAIRES DU JOUR — ${jourNom.toUpperCase()} ${dateStr}`.padEnd(59) + "║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\nBase: ${db.draws.length} tirages | Tirages du jour: ${tiragesDuJour.length}\n`);

  // ═══ PAIRES GLOBALES ═══
  console.log("═══ PAIRES GLOBALES (tous tirages) ═══\n");
  const globalResult = scorePaires(db.draws, null);
  const globalBest = selectBestTwo(globalResult);

  if (globalBest) {
    console.log(`  PAIRE 1 ► ${String(globalBest.paire1.a).padStart(2,"0")} - ${String(globalBest.paire1.b).padStart(2,"0")}  (score: ${globalBest.paire1.score} | freq: ${globalBest.paire1.freqGlobale}x | récent: ${globalBest.paire1.freqRecente}x)`);
    console.log(`  PAIRE 2 ► ${String(globalBest.paire2.a).padStart(2,"0")} - ${String(globalBest.paire2.b).padStart(2,"0")}  (score: ${globalBest.paire2.score} | freq: ${globalBest.paire2.freqGlobale}x | récent: ${globalBest.paire2.freqRecente}x)`);
  }

  // ═══ PAIRES PAR TIRAGE ═══
  console.log(`\n═══ PAIRES PAR TIRAGE (${jourNom}) ═══\n`);

  const allResults = [];

  for (const tirage of tiragesDuJour) {
    const result = scorePaires(db.draws, tirage);
    const best = selectBestTwo(result);

    if (best) {
      console.log(`  ${tirage.padEnd(22)} PAIRE 1: ${String(best.paire1.a).padStart(2,"0")}-${String(best.paire1.b).padStart(2,"0")} (${best.paire1.score}pts)   PAIRE 2: ${String(best.paire2.a).padStart(2,"0")}-${String(best.paire2.b).padStart(2,"0")} (${best.paire2.score}pts)`);
      allResults.push({ tirage, best, result });
    } else {
      console.log(`  ${tirage.padEnd(22)} données insuffisantes`);
    }
  }

  // ═══ SUPER PAIRES DU JOUR — les 2 paires qui reviennent le plus ═══
  const pairVotes = {};
  for (const { best } of allResults) {
    const k1 = best.paire1.paire;
    const k2 = best.paire2.paire;
    pairVotes[k1] = (pairVotes[k1] || { key: k1, a: best.paire1.a, b: best.paire1.b, votes: 0, totalScore: 0 });
    pairVotes[k1].votes++;
    pairVotes[k1].totalScore += best.paire1.score;
    pairVotes[k2] = (pairVotes[k2] || { key: k2, a: best.paire2.a, b: best.paire2.b, votes: 0, totalScore: 0 });
    pairVotes[k2].votes++;
    pairVotes[k2].totalScore += best.paire2.score;
  }

  const superPairs = Object.values(pairVotes).sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return b.totalScore - a.totalScore;
  });

  const superPaire1 = superPairs[0];
  let superPaire2 = null;
  for (let i = 1; i < superPairs.length; i++) {
    if (superPairs[i].a !== superPaire1.a && superPairs[i].a !== superPaire1.b &&
        superPairs[i].b !== superPaire1.a && superPairs[i].b !== superPaire1.b) {
      superPaire2 = superPairs[i];
      break;
    }
  }
  if (!superPaire2 && superPairs.length > 1) superPaire2 = superPairs[1];

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  ⭐ SUPER PAIRES DU JOUR — À SUIVRE TOUTE LA JOURNÉE   ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  if (superPaire1) {
    console.log(`║  PAIRE 1 ►  ${String(superPaire1.a).padStart(2,"0")} — ${String(superPaire1.b).padStart(2,"0")}   (${superPaire1.votes} tirages la recommandent)`.padEnd(59) + "║");
  }
  if (superPaire2) {
    console.log(`║  PAIRE 2 ►  ${String(superPaire2.a).padStart(2,"0")} — ${String(superPaire2.b).padStart(2,"0")}   (${superPaire2.votes} tirages la recommandent)`.padEnd(59) + "║");
  }
  console.log("╚══════════════════════════════════════════════════════════╝");

  // ═══ EXCEL ═══
  const wb = new ExcelJS.Workbook();

  function applyBorder(cell) {
    cell.border = {
      top:{style:"thin",color:{argb:"FFE0E0E0"}}, bottom:{style:"thin",color:{argb:"FFE0E0E0"}},
      left:{style:"thin",color:{argb:"FFE0E0E0"}}, right:{style:"thin",color:{argb:"FFE0E0E0"}},
    };
    cell.alignment = { horizontal: "center" };
  }

  // ═══ Feuille 1 : SUPER PAIRES + résumé ═══
  const ws1 = wb.addWorksheet(`Paires ${dateSafe}`);
  ws1.getColumn(1).width = 24;
  ws1.getColumn(2).width = 14;
  ws1.getColumn(3).width = 14;
  ws1.getColumn(4).width = 14;
  ws1.getColumn(5).width = 14;
  ws1.getColumn(6).width = 14;
  ws1.getColumn(7).width = 14;

  let row = 1;
  ws1.getRow(row).getCell(1).value = `PAIRES DU JOUR — ${jourNom} ${dateStr}`;
  ws1.getRow(row).getCell(1).font = { bold: true, size: 16, color: { argb: "FF2E7D32" } };
  row += 2;

  // Super paires encadré
  ws1.getRow(row).getCell(1).value = "⭐ SUPER PAIRES À SUIVRE";
  ws1.getRow(row).getCell(1).font = { bold: true, size: 14, color: { argb: "FFC62828" } };
  row += 1;

  ws1.getRow(row).getCell(1).value = "Ces 2 paires sont les plus recommandées par l'ensemble des tirages du jour.";
  ws1.getRow(row).getCell(1).font = { italic: true, size: 10, color: { argb: "FF666666" } };
  row += 2;

  if (superPaire1) {
    ["","Numéro A","Numéro B","Votes","Score total"].forEach((h, i) => {
      ws1.getRow(row).getCell(i + 1).value = h;
      if (h) {
        ws1.getRow(row).getCell(i + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        ws1.getRow(row).getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC62828" } };
        ws1.getRow(row).getCell(i + 1).alignment = { horizontal: "center" };
      }
    });
    row++;

    const bigNumStyle = { bold: true, size: 22, color: { argb: "FFC62828" } };
    const bigFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };

    const r1 = ws1.getRow(row);
    r1.height = 35;
    r1.getCell(1).value = "PAIRE 1";
    r1.getCell(1).font = { bold: true, size: 14 };
    r1.getCell(2).value = superPaire1.a;
    r1.getCell(2).font = bigNumStyle; r1.getCell(2).fill = bigFill; r1.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    r1.getCell(3).value = superPaire1.b;
    r1.getCell(3).font = bigNumStyle; r1.getCell(3).fill = bigFill; r1.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
    r1.getCell(4).value = `${superPaire1.votes} tirages`;
    r1.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
    r1.getCell(5).value = superPaire1.totalScore.toFixed(1);
    r1.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
    row++;

    if (superPaire2) {
      const r2 = ws1.getRow(row);
      r2.height = 35;
      r2.getCell(1).value = "PAIRE 2";
      r2.getCell(1).font = { bold: true, size: 14 };
      r2.getCell(2).value = superPaire2.a;
      r2.getCell(2).font = bigNumStyle; r2.getCell(2).fill = bigFill; r2.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
      r2.getCell(3).value = superPaire2.b;
      r2.getCell(3).font = bigNumStyle; r2.getCell(3).fill = bigFill; r2.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      r2.getCell(4).value = `${superPaire2.votes} tirages`;
      r2.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
      r2.getCell(5).value = superPaire2.totalScore.toFixed(1);
      r2.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
    }
    row += 3;
  }

  // Tableau paires par tirage
  ws1.getRow(row).getCell(1).value = "DÉTAIL PAR TIRAGE";
  ws1.getRow(row).getCell(1).font = { bold: true, size: 14, color: { argb: "FF1565C0" } };
  row++;

  ["Tirage","Paire 1 - A","Paire 1 - B","Score P1","Paire 2 - A","Paire 2 - B","Score P2"].forEach((h, i) => {
    ws1.getRow(row).getCell(i + 1).value = h;
    ws1.getRow(row).getCell(i + 1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    ws1.getRow(row).getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } };
    ws1.getRow(row).getCell(i + 1).alignment = { horizontal: "center" };
  });
  row++;

  for (const { tirage, best } of allResults) {
    const r = ws1.getRow(row);
    r.getCell(1).value = tirage;
    r.getCell(1).font = { bold: true };
    r.getCell(1).alignment = { horizontal: "left" };
    r.getCell(2).value = best.paire1.a;
    r.getCell(2).font = { bold: true, size: 13, color: { argb: "FF1565C0" } };
    r.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F2FD" } };
    r.getCell(3).value = best.paire1.b;
    r.getCell(3).font = { bold: true, size: 13, color: { argb: "FF1565C0" } };
    r.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F2FD" } };
    r.getCell(4).value = best.paire1.score;
    r.getCell(5).value = best.paire2.a;
    r.getCell(5).font = { bold: true, size: 13, color: { argb: "FFEF6C00" } };
    r.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3E0" } };
    r.getCell(6).value = best.paire2.b;
    r.getCell(6).font = { bold: true, size: 13, color: { argb: "FFEF6C00" } };
    r.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3E0" } };
    r.getCell(7).value = best.paire2.score;
    r.eachCell((c) => applyBorder(c));
    row++;
  }
  row += 2;

  // Top 20 paires globales
  ws1.getRow(row).getCell(1).value = "TOP 20 PAIRES GLOBALES";
  ws1.getRow(row).getCell(1).font = { bold: true, size: 14, color: { argb: "FF6A1B9A" } };
  row++;

  ["Rang","Paire","Score","Fréq. globale","Fréq. récente","Retard","Markov"].forEach((h, i) => {
    ws1.getRow(row).getCell(i + 1).value = h;
    ws1.getRow(row).getCell(i + 1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    ws1.getRow(row).getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6A1B9A" } };
    ws1.getRow(row).getCell(i + 1).alignment = { horizontal: "center" };
  });
  row++;

  for (let i = 0; i < 20; i++) {
    const p = globalResult.top30[i];
    const r = ws1.getRow(row);
    r.getCell(1).value = i + 1;
    r.getCell(2).value = `${String(p.a).padStart(2,"0")} - ${String(p.b).padStart(2,"0")}`;
    r.getCell(3).value = p.score;
    r.getCell(4).value = p.freqGlobale;
    r.getCell(5).value = p.freqRecente;
    r.getCell(6).value = p.retard;
    r.getCell(7).value = p.markov;
    r.eachCell((c) => applyBorder(c));
    if (i < 5) {
      r.getCell(2).font = { bold: true, color: { argb: "FFC62828" } };
    }
    row++;
  }

  // ═══ Feuille 2 : Paires 7 jours ═══
  const ws7 = wb.addWorksheet("Paires 7 jours");
  ws7.getColumn(1).width = 18;
  ws7.getColumn(2).width = 22;
  ws7.getColumn(3).width = 10;
  ws7.getColumn(4).width = 10;
  ws7.getColumn(5).width = 10;
  ws7.getColumn(6).width = 10;

  let r7 = 1;
  ws7.getRow(r7).getCell(1).value = "PAIRES — 7 PROCHAINS JOURS";
  ws7.getRow(r7).getCell(1).font = { bold: true, size: 16, color: { argb: "FF2E7D32" } };
  r7 += 2;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const fJour = futureDate.getDay();
    const fNom = JOURS_NOMS[fJour];
    const fDate = `${String(futureDate.getDate()).padStart(2,"0")}-${String(futureDate.getMonth()+1).padStart(2,"0")}-${futureDate.getFullYear()}`;
    const fTirages = JOURS_TIRAGES[fJour] || [];

    ws7.getRow(r7).getCell(1).value = `${fNom} ${fDate}`;
    ws7.getRow(r7).getCell(1).font = { bold: true, size: 13, color: { argb: "FF1565C0" } };
    r7++;

    ["Tirage","","Paire 1 A","Paire 1 B","Paire 2 A","Paire 2 B"].forEach((h, i) => {
      if (!h) return;
      ws7.getRow(r7).getCell(i + 1).value = h;
      ws7.getRow(r7).getCell(i + 1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      ws7.getRow(r7).getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF37474F" } };
      ws7.getRow(r7).getCell(i + 1).alignment = { horizontal: "center" };
    });
    r7++;

    for (const tirage of fTirages) {
      const result = scorePaires(db.draws, tirage);
      const best = selectBestTwo(result);
      const r = ws7.getRow(r7);
      r.getCell(1).value = tirage;
      r.getCell(1).font = { bold: true, size: 10 };
      r.getCell(1).alignment = { horizontal: "left" };

      if (best) {
        r.getCell(3).value = best.paire1.a;
        r.getCell(3).font = { bold: true, color: { argb: "FFC62828" } };
        r.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
        r.getCell(4).value = best.paire1.b;
        r.getCell(4).font = { bold: true, color: { argb: "FFC62828" } };
        r.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEBEE" } };
        r.getCell(5).value = best.paire2.a;
        r.getCell(5).font = { bold: true, color: { argb: "FFEF6C00" } };
        r.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3E0" } };
        r.getCell(6).value = best.paire2.b;
        r.getCell(6).font = { bold: true, color: { argb: "FFEF6C00" } };
        r.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3E0" } };
      } else {
        r.getCell(3).value = "—";
        r.getCell(3).font = { italic: true, color: { argb: "FF999999" } };
      }
      r.eachCell((c) => applyBorder(c));
      r7++;
    }
    r7++;
  }

  const filename = `C:/Users/hp/lonaci-scraper/PAIRES_${dateSafe}.xlsx`;
  await wb.xlsx.writeFile(filename);

  console.log(`\nFichier: ${filename}`);
  console.log("Feuilles:");
  console.log(`  1. Paires ${dateSafe} — super paires + détail par tirage + top 20`);
  console.log("  2. Paires 7 jours — prédictions paires semaine complète");
}

main().catch(console.error);
