// Sucht WoW-Installationen (Wow.exe + Data-Ordner) auf allen Laufwerken.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const SKIP = new Set(['windows', '$recycle.bin', 'system volume information', 'programdata', 'appdata', 'node_modules',
  'recovery', 'perflogs', '$windows.~bt', '$winreagent', '.git', 'windowsapps', 'winsxs', 'drivers']);
const HINT = /wow|warcraft|game|spiel|blizzard|client|lich|private|server|3\.3\.5|wotlk|azeroth/i;

function roots() {
  if (process.platform !== 'win32') return [os.homedir()];
  const r = [];
  for (let c = 65; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; try { if (fs.existsSync(d)) r.push(d); } catch {} }
  return r;
}

async function isGame(dir) {
  try {
    await fsp.access(path.join(dir, 'Wow.exe'));
    const st = await fsp.stat(path.join(dir, 'Data'));
    return st.isDirectory();
  } catch { return false; }
}

// Breitensuche. Bis Tiefe 3 immer, tiefer nur in Ordnern mit passendem Namen.
async function findGames(rootList = roots(), { maxMs = 25000, maxHits = 12 } = {}) {
  const t0 = Date.now(), hits = [];
  for (const root of rootList) {
    let level = [{ dir: root, depth: 0 }];
    while (level.length && hits.length < maxHits && Date.now() - t0 < maxMs) {
      const next = [];
      for (const { dir, depth } of level) {
        if (Date.now() - t0 > maxMs) break;
        if (await isGame(dir)) { hits.push(dir); continue; }      // gefunden: nicht tiefer
        if (depth >= 5) continue;
        let ents;
        try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
          if (!e.isDirectory() || SKIP.has(e.name.toLowerCase())) continue;
          if (depth >= 3 && !HINT.test(e.name) && !HINT.test(path.basename(dir))) continue;
          next.push({ dir: path.join(dir, e.name), depth: depth + 1 });
        }
      }
      level = next;
    }
  }
  return hits;
}

async function freeBytes(dir) {
  try {
    let p = dir;
    while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
    const s = await fsp.statfs(p);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; }
}

module.exports = { roots, findGames, isGame, freeBytes };
