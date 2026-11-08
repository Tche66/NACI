const fs = require("fs");
const path = require("path");

const IS_VERCEL = !!process.env.VERCEL;

function getDataPath(filename) {
  return path.join(__dirname, filename);
}

const DB_PATH = getDataPath("lonaci_db.json");

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { draws: [], lastUpdate: null };
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(db) {
  db.lastUpdate = new Date().toISOString();
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    if (!IS_VERCEL) throw e;
  }
}

function drawKey(d) {
  return `${d.date}|${d.type}|${d.gagnants.join(",")}`;
}

function mergeDraws(existing, newDraws) {
  const seen = new Set(existing.map(drawKey));
  let added = 0;
  for (const d of newDraws) {
    const key = drawKey(d);
    if (!seen.has(key)) {
      existing.push(d);
      seen.add(key);
      added++;
    }
  }
  existing.sort((a, b) => {
    const da = parseDate(a.date);
    const db = parseDate(b.date);
    return db - da;
  });
  return added;
}

function parseDate(dateStr) {
  const m = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return 0;
  return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])).getTime();
}

module.exports = { loadDB, saveDB, mergeDraws, drawKey, parseDate, DB_PATH, IS_VERCEL, getDataPath };
