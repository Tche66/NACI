const https = require("https");
const { loadDB, saveDB, mergeDraws } = require("./db");

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
        if (wn && wn.length === 5) {
          draws.push({ date: dateStr, type: d.drawName, gagnants: wn, machine: mn });
        }
      }
    }
  }
  return draws;
}

async function update(fullReload) {
  const db = loadDB();
  console.log(`Base actuelle: ${db.draws.length} tirages`);
  console.log(`Dernière MAJ: ${db.lastUpdate || "jamais"}\n`);

  const now = new Date();
  let monthsToFetch;

  if (fullReload || db.draws.length === 0) {
    console.log("Mode: CHARGEMENT COMPLET (24 mois)\n");
    monthsToFetch = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i);
      monthsToFetch.push(`${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`);
    }
  } else {
    console.log("Mode: MISE À JOUR (2 derniers mois)\n");
    monthsToFetch = [];
    for (let i = 0; i < 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i);
      monthsToFetch.push(`${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`);
    }
  }

  let totalNew = 0;
  for (const m of monthsToFetch) {
    console.log(`  Chargement: ${m}...`);
    try {
      const json = await fetchJSON(`https://lotobonheur.ci/api/results?monthYear=${encodeURIComponent(m)}`);
      const newDraws = parseAPIDraws(json);
      const added = mergeDraws(db.draws, newDraws);
      console.log(`     ${newDraws.length} tirages lus, ${added} nouveaux`);
      totalNew += added;
    } catch (e) {
      console.error(`     ERREUR: ${e.message}`);
    }
  }

  saveDB(db);
  console.log(`\n✓ ${totalNew} nouveaux tirages ajoutés`);
  console.log(`✓ Total en base: ${db.draws.length} tirages`);
  console.log(`✓ Sauvegardé dans lonaci_db.json`);
}

const arg = process.argv[2];
if (arg === "--full") {
  update(true).catch(console.error);
} else {
  update(false).catch(console.error);
}
