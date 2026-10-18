// Werkzeuge: WTF-Sicherung, Grafik (Config.wtf), Diagnose, Absturzberichte
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const WTF = (g) => path.join(g, 'WTF');
const BK = (g) => path.join(g, 'Data', '_launcher', 'wtf-backups');
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

// ---------- WTF-Sicherung ----------
async function dirSize(d) {
  let n = 0;
  try { for (const e of await fsp.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? await dirSize(p) : (await fsp.stat(p)).size; } } catch {}
  return n;
}
async function backupList(g) {
  let names = [];
  try { names = (await fsp.readdir(BK(g), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch {}
  names.sort().reverse();
  const out = [];
  for (const n of names) out.push({ name: n, size: await dirSize(path.join(BK(g), n)) });
  return out;
}
async function backupCreate(g, label) {
  if (!fs.existsSync(WTF(g))) throw new Error('Es gibt noch keinen WTF-Ordner (starte das Spiel einmal).');
  const name = stamp() + (label ? '_' + label.replace(/[^\w-]/g, '') : '');
  await fsp.mkdir(BK(g), { recursive: true });
  await fsp.cp(WTF(g), path.join(BK(g), name), { recursive: true });   // asynchron, blockiert die Oberfläche nicht
  const all = await backupList(g);                       // nur die letzten 10 behalten
  for (const o of all.slice(10)) await fsp.rm(path.join(BK(g), o.name), { recursive: true, force: true });
  return name;
}
async function backupRestore(g, name) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('Ungültiger Name.');
  const src = path.join(BK(g), name);
  if (!fs.existsSync(src)) throw new Error('Sicherung nicht gefunden.');
  if (fs.existsSync(WTF(g))) await backupCreate(g, 'vor-wiederherstellung');
  await fsp.rm(WTF(g), { recursive: true, force: true });
  await fsp.cp(src, WTF(g), { recursive: true });
}
async function backupDelete(g, name) {
  if (!/^[\w.-]+$/.test(name)) throw new Error('Ungültiger Name.');
  await fsp.rm(path.join(BK(g), name), { recursive: true, force: true });
}
async function wtfReset(g) {            // sichern, dann löschen -> Spiel legt alles neu an
  if (!fs.existsSync(WTF(g))) return;
  await backupCreate(g, 'vor-reset');
  await fsp.rm(WTF(g), { recursive: true, force: true });
}

// ---------- Grafik (WTF/Config.wtf, Zeilen: SET name "wert") ----------
const CFG = (g) => path.join(WTF(g), 'Config.wtf');
function readCfg(g) {
  let txt = '';
  try { txt = fs.readFileSync(CFG(g), 'utf8'); } catch {}
  const o = {};
  for (const l of txt.split(/\r?\n/)) { const m = /^SET\s+(\w+)\s+"(.*)"\s*$/.exec(l); if (m) o[m[1]] = m[2]; }
  return o;
}
function writeCfg(g, patch) {
  fs.mkdirSync(WTF(g), { recursive: true });
  let lines = [];
  try { lines = fs.readFileSync(CFG(g), 'utf8').split(/\r?\n/).filter((l) => l.length); } catch {}
  try { fs.chmodSync(CFG(g), 0o666); } catch {}
  for (const [k, v] of Object.entries(patch)) {
    if (!/^\w+$/.test(k) || /["\r\n]/.test(String(v))) throw new Error('Ungültiger Wert für ' + k);
    const i = lines.findIndex((l) => new RegExp('^SET\\s+' + k + '\\s', 'i').test(l));
    const line = `SET ${k} "${v}"`;
    if (i >= 0) lines[i] = line; else lines.push(line);
  }
  fs.writeFileSync(CFG(g), lines.join('\r\n') + '\r\n');
}
const GFX_KEYS = ['gxResolution', 'gxWindow', 'gxMaximize', 'graphicsQuality', 'farclip', 'MasterSoundEnabled', 'Sound_EnableMusic'];
function gfxGet(g) { const c = readCfg(g); const o = {}; for (const k of GFX_KEYS) o[k] = c[k] ?? null; return o; }
function gfxSet(g, patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch)) if (GFX_KEYS.includes(k) && v !== null && v !== undefined) clean[k] = String(v);
  if (clean.gxResolution && !/^\d{3,5}x\d{3,5}$/.test(clean.gxResolution)) throw new Error('Auflösung ungültig.');
  writeCfg(g, clean);
}

// ---------- Diagnose ----------
async function diagnose(g, realm, quick) {
  const out = [];
  const add = (id, level, title, detail, fix) => out.push({ id, level, title, detail, fix });
  if (!fs.existsSync(path.join(g, 'Wow.exe'))) { add('exe', 'err', 'Wow.exe fehlt', 'Der Spielordner ist unvollständig. Unter „Spieldateien“ alles prüfen & reparieren.'); return out; }
  const data = path.join(g, 'Data');
  for (const f of ['common.MPQ', 'expansion.MPQ', 'lichking.MPQ', 'patch.MPQ', 'patch-2.MPQ', 'patch-3.MPQ']) {
    if (!fs.existsSync(path.join(data, f))) add('mpq:' + f, 'warn', `${f} fehlt`, 'Kern-Datei des Spiels fehlt. Bitte „Alles prüfen & reparieren“ ausführen.');
  }
  let loc = [];
  try { loc = fs.readdirSync(data).filter((n) => /^[a-z]{2}[A-Z]{2}$/.test(n)); } catch {}
  if (!loc.length) add('locale', 'err', 'Kein Sprachordner', 'In Data fehlt ein Sprachordner wie deDE.');
  else {
    const want = realm?.realmlist;
    for (const l of loc) {
      let cur = '';
      try { cur = fs.readFileSync(path.join(data, l, 'realmlist.wtf'), 'utf8').trim(); } catch {}
      if (want && !new RegExp('^set realmlist ' + want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i').test(cur)) { add('realmlist', 'warn', 'Realmlist passt nicht', `In ${l} steht „${cur || 'nichts'}“. Der Launcher setzt sie beim Start automatisch.`, 'realmlist'); break; }
    }
  }
  try { if (!(fs.statSync(CFG(g)).mode & 0o200)) add('readonly', 'warn', 'Config.wtf ist schreibgeschützt', 'Grafikeinstellungen lassen sich nicht speichern.', 'readonly'); } catch {}
  const cache = quick ? 0 : await dirSize(path.join(g, 'Cache'));
  if (cache > 300e6) add('cache', 'warn', 'Cache ist groß', `${(cache / 1e6).toFixed(0)} MB. Ein Leeren behebt oft Hänger und falsche Items.`, 'cache');
  let errs = [];
  try { errs = fs.readdirSync(path.join(g, 'Errors')); } catch {}
  if (errs.length) add('errors', 'info', `${errs.length} alte Fehlerdatei(en) im Ordner Errors`, 'Sie sind nur Altlasten und können gelöscht werden. Wenn du sie dem Server zeigen willst, sende vorher unter „Absturzberichte“ den letzten Bericht.', 'errors');
  if (!out.some((x) => x.level === 'err' || x.level === 'warn')) out.unshift({ id: 'ok', level: 'ok', title: 'Alles in Ordnung', detail: 'Keine bekannten Probleme gefunden.' });
  return out;
}
async function fix(g, id, realm, packs) {
  if (id === 'cache') return packs.clearCache(g);
  if (id === 'errors') {
    const dir = path.join(g, 'Errors');
    let ok = 0, bad = 0;
    for (const n of fs.readdirSync(dir)) {
      if (!/\.(txt|log|dmp)$/i.test(n)) continue;
      const f = path.join(dir, n);
      try { fs.rmSync(f, { force: true }); ok++; }
      catch { try { fs.chmodSync(f, 0o666); fs.rmSync(f, { force: true }); ok++; } catch { bad++; } }   // schreibgeschützt: Schutz aufheben
    }
    if (bad) throw new Error(`${ok} gelöscht, ${bad} nicht möglich (Dateien gesperrt oder Ordner schreibgeschützt). Läuft WoW noch?`);
    return true;
  }
  if (id === 'readonly') { fs.chmodSync(CFG(g), 0o666); return true; }
  if (id === 'realmlist' && realm) {
    for (const l of fs.readdirSync(path.join(g, 'Data')).filter((n) => /^[a-z]{2}[A-Z]{2}$/.test(n))) fs.writeFileSync(path.join(g, 'Data', l, 'realmlist.wtf'), `set realmlist ${realm.realmlist}\r\n`);
    return true;
  }
  throw new Error('Keine Reparatur für ' + id);
}

// ---------- Absturzberichte ----------
function crashLatest(g) {
  const dir = path.join(g, 'Errors');
  let files = [];
  try { files = fs.readdirSync(dir).filter((n) => /\.(txt|log)$/i.test(n)).map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t); } catch {}
  if (!files.length) return null;
  const f = files[0];
  const text = fs.readFileSync(path.join(dir, f.n), 'utf8').slice(0, 30000);
  return { file: f.n, time: new Date(f.t).toISOString(), text };
}

module.exports = { backupList, backupCreate, backupRestore, backupDelete, wtfReset, gfxGet, gfxSet, diagnose, fix, crashLatest };
