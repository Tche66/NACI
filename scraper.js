const ExcelJS = require("exceljs");
const https = require("https");

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function getLast12Months() {
  const months = [];
  const now = new Date(2026, 9); // octobre 2026
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i);
    months.push({
      label: `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
    });
  }
  return months;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`JSON parse error for ${url}: ${data.slice(0, 200)}`));
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function parseNumbers(str) {
  if (!str || str.includes(".")) return ["", "", "", "", ""];
  return str
    .split("-")
    .map((n) => n.trim())
    .filter((n) => n && n !== "");
}

function extractYear(dateStr) {
  const match = dateStr.match(/\d{2}\/\d{2}\/(\d{4})/);
  return match ? match[1] : "";
}

function parseDrawResults(json) {
  const rows = [];
  if (!json.drawsResultsWeekly) return rows;

  for (const week of json.drawsResultsWeekly) {
    const weekYear = extractYear(week.startDate || week.endDate || "");

    for (const day of week.drawResultsDaily || []) {
      const rawDate = day.date || "";
      const dateMatch = rawDate.match(/(\d{2}\/\d{2})/);
      const dayDate = dateMatch ? `${dateMatch[1]}/${weekYear}` : rawDate;
      const dayName = rawDate.replace(/\d{2}\/\d{2}/, "").trim();

      const allDraws = [
        ...(day.drawResults?.nightDraws || []),
        ...(day.drawResults?.standardDraws || []),
      ];

      for (const draw of allDraws) {
        if (!draw.drawName || draw.drawName === "-") continue;

        const wn = parseNumbers(draw.winningNumbers);
        const mn = parseNumbers(draw.machineNumbers);

        rows.push({
          date: dayDate,
          jour: dayName,
          tirage: draw.drawName,
          g1: wn[0] || "", g2: wn[1] || "", g3: wn[2] || "", g4: wn[3] || "", g5: wn[4] || "",
          m1: mn[0] || "", m2: mn[1] || "", m3: mn[2] || "", m4: mn[3] || "", m5: mn[4] || "",
        });
      }
    }
  }
  return rows;
}

async function main() {
  const months = getLast12Months();
  console.log(`Récupération des résultats pour ${months.length} mois...\n`);

  let allRows = [];

  for (const m of months) {
    const url = `https://lotobonheur.ci/api/results?monthYear=${encodeURIComponent(m.label)}`;
    console.log(`  -> ${m.label}...`);
    try {
      const json = await fetchJSON(url);
      const rows = parseDrawResults(json);
      allRows.push(...rows);
      console.log(`     ${rows.length} tirages trouvés`);
    } catch (err) {
      console.error(`     ERREUR: ${err.message}`);
    }
  }

  console.log(`\nTotal: ${allRows.length} tirages récupérés`);

  // --- Création du fichier Excel ---
  const wb = new ExcelJS.Workbook();
  wb.creator = "LONACI Scraper";
  wb.created = new Date();

  // ============ FEUILLE 1 : Tous les résultats ============
  const ws = wb.addWorksheet("Tous les résultats");

  ws.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Jour", key: "jour", width: 12 },
    { header: "Tirage", key: "tirage", width: 22 },
    { header: "G1", key: "g1", width: 6 },
    { header: "G2", key: "g2", width: 6 },
    { header: "G3", key: "g3", width: 6 },
    { header: "G4", key: "g4", width: 6 },
    { header: "G5", key: "g5", width: 6 },
    { header: "M1", key: "m1", width: 6 },
    { header: "M2", key: "m2", width: 6 },
    { header: "M3", key: "m3", width: 6 },
    { header: "M4", key: "m4", width: 6 },
    { header: "M5", key: "m5", width: 6 },
  ];

  const headerStyle = {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D32" } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    },
  };

  ws.getRow(1).eachCell((cell) => {
    cell.font = headerStyle.font;
    cell.fill = headerStyle.fill;
    cell.alignment = headerStyle.alignment;
    cell.border = headerStyle.border;
  });
  ws.getRow(1).height = 25;

  const gagnantFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } };
  const machineFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3E0" } };

  for (const row of allRows) {
    const r = ws.addRow(row);
    r.eachCell((cell, colNumber) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE0E0E0" } },
        bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
        left: { style: "thin", color: { argb: "FFE0E0E0" } },
        right: { style: "thin", color: { argb: "FFE0E0E0" } },
      };
      if (colNumber >= 4 && colNumber <= 8) {
        cell.fill = gagnantFill;
        cell.alignment = { horizontal: "center" };
        cell.font = { bold: true };
      }
      if (colNumber >= 9 && colNumber <= 13) {
        cell.fill = machineFill;
        cell.alignment = { horizontal: "center" };
      }
    });
  }

  ws.autoFilter = { from: "A1", to: "M1" };

  // ============ FEUILLE 2 : Fréquence des numéros (gagnants) ============
  const wsFreq = wb.addWorksheet("Fréquence Gagnants");

  const freqMap = {};
  for (let i = 1; i <= 90; i++) freqMap[i] = 0;

  for (const row of allRows) {
    for (const n of [row.g1, row.g2, row.g3, row.g4, row.g5]) {
      const num = parseInt(n);
      if (num >= 1 && num <= 90) freqMap[num]++;
    }
  }

  const freqSorted = Object.entries(freqMap)
    .map(([num, count]) => ({ num: parseInt(num), count }))
    .sort((a, b) => b.count - a.count);

  wsFreq.columns = [
    { header: "Rang", key: "rang", width: 8 },
    { header: "Numéro", key: "num", width: 10 },
    { header: "Fréquence", key: "count", width: 12 },
    { header: "% Apparition", key: "pct", width: 14 },
  ];

  wsFreq.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1565C0" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = headerStyle.border;
  });
  wsFreq.getRow(1).height = 25;

  const totalTirages = allRows.length;
  freqSorted.forEach((item, idx) => {
    const r = wsFreq.addRow({
      rang: idx + 1,
      num: item.num,
      count: item.count,
      pct: totalTirages > 0 ? `${((item.count / (totalTirages * 5)) * 100).toFixed(2)}%` : "0%",
    });
    r.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE0E0E0" } },
        bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
        left: { style: "thin", color: { argb: "FFE0E0E0" } },
        right: { style: "thin", color: { argb: "FFE0E0E0" } },
      };
    });
    if (idx < 10) {
      r.getCell("num").font = { bold: true, color: { argb: "FFD32F2F" } };
      r.getCell("count").font = { bold: true, color: { argb: "FFD32F2F" } };
    }
  });

  // ============ FEUILLE 3 : Fréquence des numéros machine ============
  const wsFreqM = wb.addWorksheet("Fréquence Machine");

  const freqMapM = {};
  for (let i = 1; i <= 90; i++) freqMapM[i] = 0;

  for (const row of allRows) {
    for (const n of [row.m1, row.m2, row.m3, row.m4, row.m5]) {
      const num = parseInt(n);
      if (num >= 1 && num <= 90) freqMapM[num]++;
    }
  }

  const freqSortedM = Object.entries(freqMapM)
    .map(([num, count]) => ({ num: parseInt(num), count }))
    .sort((a, b) => b.count - a.count);

  wsFreqM.columns = [
    { header: "Rang", key: "rang", width: 8 },
    { header: "Numéro", key: "num", width: 10 },
    { header: "Fréquence", key: "count", width: 12 },
    { header: "% Apparition", key: "pct", width: 14 },
  ];

  wsFreqM.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEF6C00" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = headerStyle.border;
  });
  wsFreqM.getRow(1).height = 25;

  const totalAvecMachine = allRows.filter((r) => r.m1 !== "").length;
  freqSortedM.forEach((item, idx) => {
    const r = wsFreqM.addRow({
      rang: idx + 1,
      num: item.num,
      count: item.count,
      pct: totalAvecMachine > 0 ? `${((item.count / (totalAvecMachine * 5)) * 100).toFixed(2)}%` : "0%",
    });
    r.eachCell((cell) => {
      cell.alignment = { horizontal: "center" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE0E0E0" } },
        bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
        left: { style: "thin", color: { argb: "FFE0E0E0" } },
        right: { style: "thin", color: { argb: "FFE0E0E0" } },
      };
    });
    if (idx < 10) {
      r.getCell("num").font = { bold: true, color: { argb: "FFE65100" } };
      r.getCell("count").font = { bold: true, color: { argb: "FFE65100" } };
    }
  });

  // ============ FEUILLE 4 : Stats par type de tirage ============
  const wsStats = wb.addWorksheet("Stats par tirage");

  const tirageStats = {};
  for (const row of allRows) {
    if (!tirageStats[row.tirage]) {
      tirageStats[row.tirage] = { count: 0, nums: {} };
      for (let i = 1; i <= 90; i++) tirageStats[row.tirage].nums[i] = 0;
    }
    tirageStats[row.tirage].count++;
    for (const n of [row.g1, row.g2, row.g3, row.g4, row.g5]) {
      const num = parseInt(n);
      if (num >= 1 && num <= 90) tirageStats[row.tirage].nums[num]++;
    }
  }

  wsStats.columns = [
    { header: "Type de tirage", key: "tirage", width: 22 },
    { header: "Nb tirages", key: "count", width: 12 },
    { header: "Top 1", key: "top1", width: 8 },
    { header: "Freq 1", key: "freq1", width: 8 },
    { header: "Top 2", key: "top2", width: 8 },
    { header: "Freq 2", key: "freq2", width: 8 },
    { header: "Top 3", key: "top3", width: 8 },
    { header: "Freq 3", key: "freq3", width: 8 },
    { header: "Top 4", key: "top4", width: 8 },
    { header: "Freq 4", key: "freq4", width: 8 },
    { header: "Top 5", key: "top5", width: 8 },
    { header: "Freq 5", key: "freq5", width: 8 },
  ];

  wsStats.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6A1B9A" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = headerStyle.border;
  });
  wsStats.getRow(1).height = 25;

  const sortedTirages = Object.entries(tirageStats).sort((a, b) => b[1].count - a[1].count);
  for (const [tirage, stats] of sortedTirages) {
    const topNums = Object.entries(stats.nums)
      .map(([n, c]) => ({ n: parseInt(n), c }))
      .sort((a, b) => b.c - a.c)
      .slice(0, 5);

    const rowData = { tirage, count: stats.count };
    topNums.forEach((t, i) => {
      rowData[`top${i + 1}`] = t.n;
      rowData[`freq${i + 1}`] = t.c;
    });

    const r = wsStats.addRow(rowData);
    r.eachCell((cell, colNumber) => {
      cell.alignment = { horizontal: "center" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE0E0E0" } },
        bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
        left: { style: "thin", color: { argb: "FFE0E0E0" } },
        right: { style: "thin", color: { argb: "FFE0E0E0" } },
      };
      if (colNumber === 1) cell.alignment = { horizontal: "left" };
    });
  }

  // ============ FEUILLE 5 : Résumé ============
  const wsSummary = wb.addWorksheet("Résumé");

  wsSummary.getColumn(1).width = 30;
  wsSummary.getColumn(2).width = 25;

  const summaryData = [
    ["RÉSUMÉ - LOTO BONHEUR", ""],
    ["", ""],
    ["Période couverte", `${months[months.length - 1].label} → ${months[0].label}`],
    ["Total des tirages", allRows.length],
    ["Types de tirages distincts", Object.keys(tirageStats).length],
    ["", ""],
    ["TOP 10 NUMÉROS GAGNANTS", ""],
    ...freqSorted.slice(0, 10).map((item, i) => [
      `#${i + 1} - Numéro ${item.num}`,
      `${item.count} fois`,
    ]),
    ["", ""],
    ["TOP 10 NUMÉROS MACHINE", ""],
    ...freqSortedM.slice(0, 10).map((item, i) => [
      `#${i + 1} - Numéro ${item.num}`,
      `${item.count} fois`,
    ]),
  ];

  for (const [idx, [col1, col2]] of summaryData.entries()) {
    const r = wsSummary.addRow([col1, col2]);
    if (idx === 0) {
      r.getCell(1).font = { bold: true, size: 16, color: { argb: "FF2E7D32" } };
    }
    if (col1 === "TOP 10 NUMÉROS GAGNANTS" || col1 === "TOP 10 NUMÉROS MACHINE") {
      r.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1565C0" } };
    }
    if (col1.startsWith("#")) {
      r.getCell(1).font = { bold: true };
    }
  }

  // Sauvegarder
  const filename = "C:/Users/hp/lonaci-scraper/LONACI_Resultats_24mois.xlsx";
  await wb.xlsx.writeFile(filename);
  console.log(`\nFichier Excel créé : ${filename}`);
  console.log("Feuilles :");
  console.log("  1. Tous les résultats - données brutes avec filtres");
  console.log("  2. Fréquence Gagnants - classement des 90 numéros gagnants");
  console.log("  3. Fréquence Machine - classement des 90 numéros machine");
  console.log("  4. Stats par tirage - top 5 numéros par type de jeu");
  console.log("  5. Résumé - vue d'ensemble et top 10");
}

main().catch(console.error);
