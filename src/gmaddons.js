// Admin-/GM-Addons: werden nur fuer GMs und nur auf dem eigenen Realm installiert
// und nach dem Spiel (bzw. beim Launcher-Start) wieder entfernt.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const addons = require('./addons');

const REALM_NAME = 'Home of the Lich King';
const MARK = (g) => path.join(g, 'Data', '_launcher', 'gmaddons.json');

const LIST = [
  { id: 'gm-multibot', name: 'MultiBot', url: 'https://github.com/Wishmaster117/MultiBot/archive/refs/heads/main.zip', minGm: 1 },
  { id: 'gm-playerbots', name: 'PlayerBots', url: 'https://github.com/whipowill/wow-addon-playerbots/archive/refs/heads/master.zip', minGm: 1 },
  { id: 'gm-pbmanager', name: 'PlayerbotManager', url: 'https://github.com/Lichborne-AC/PlayerbotManager/archive/refs/heads/master.zip', minGm: 1 },
  { id: 'gm-acadmin', name: 'AzerothCoreAdmin', url: 'https://github.com/LightDestory/AzerothCoreAdmin/archive/refs/heads/master.zip', minGm: 1 }
];

const GUARD = `if GetRealmName and GetRealmName() and GetRealmName() ~= "" and GetRealmName() ~= "${REALM_NAME}" then return end `;

function readMark(g) { try { return JSON.parse(fs.readFileSync(MARK(g), 'utf8')); } catch { return { folders: [] }; } }
async function writeMark(g, m) { await fsp.mkdir(path.dirname(MARK(g)), { recursive: true }); await fsp.writeFile(MARK(g), JSON.stringify(m)); }
const active = (g) => readMark(g).folders.length > 0;

// Realm-Sperre oben in jede Lua-Datei des Addons setzen (gleiche Zeile, damit Zeilennummern stimmen)
function guardFolder(dir) {
  const toc = addons.findToc(dir);
  if (!toc) return;
  const lines = fs.readFileSync(toc.file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const rel of lines) {
    if (!/\.lua$/i.test(rel)) continue;
    const f = path.join(dir, rel.replace(/\\/g, path.sep));
    if (!f.startsWith(dir) || !fs.existsSync(f)) continue;
    let s = fs.readFileSync(f, 'utf8');
    if (s.includes('Home of the Lich King') && s.startsWith('if GetRealmName')) continue;
    s = s.replace(/^﻿/, '');
    fs.writeFileSync(f, GUARD + s);
  }
}

async function cleanup(gameDir, log) {
  const m = readMark(gameDir);
  if (!m.folders.length) return false;
  const left = [];
  for (const n of m.folders) {
    try { await addons.remove(gameDir, n); } catch (e) { left.push(n); log && log('warn', 'GM-Addon bleibt', n, e.message); }
  }
  await writeMark(gameDir, { folders: left });
  if (!left.length) log && log('info', 'GM-Addons entfernt');
  return left.length === 0;
}

async function setup(gameDir, session, onPhase, signal, log, cacheDir) {
  const lvl = session?.gmlevel || 0;
  const want = LIST.filter((a) => lvl >= a.minGm);
  const folders = [];
  for (const a of want) {
    onPhase('GM-Addon ' + a.name + ' …');
    try {
      const names = await addons.install(gameDir, cacheDir ? { ...a, cacheZip: path.join(cacheDir, 'gmzip-' + a.id + '.zip') } : a, () => {}, signal);
      for (const n of names) {
        guardFolder(path.join(gameDir, 'Interface', 'AddOns', n));
        if (!folders.includes(n)) folders.push(n);
      }
      await writeMark(gameDir, { folders });   // nach jedem Addon sichern, falls etwas abbricht
    } catch (e) { log && log('warn', 'GM-Addon fehlgeschlagen', a.name, e.message); onPhase('GM-Addon ' + a.name + ' nicht geladen: ' + e.message); }
  }
  return folders;
}

module.exports = { setup, cleanup, active, LIST, REALM_NAME };
