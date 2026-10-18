// Addon-Verwaltung: installierte Addons lesen, aktivieren/deaktivieren, entfernen, aus Zip installieren.
//  - Aktiv:       <Spiel>/Interface/AddOns/<Name>
//  - Deaktiviert: <Spiel>/Interface/AddOns_disabled/<Name>   (Ordner wird verschoben, WoW sieht ihn nicht)
//  - Merkliste:   <Spiel>/Data/_launcher/addons.json         (welcher Katalog-Eintrag hat welche Ordner angelegt)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const ADDONS = (g) => path.join(g, 'Interface', 'AddOns');
const DISABLED = (g) => path.join(g, 'Interface', 'AddOns_disabled');
const META = (g) => path.join(g, 'Data', '_launcher', 'addons.json');

const safeName = (n) => typeof n === 'string' && n.length > 0 && n.length < 120 && !/[\\/:*?"<>|]/.test(n) && n !== '.' && n !== '..';
const stripColors = (s) => String(s || '').replace(/\|c[0-9a-fA-F]{8}/g, '').replace(/\|r/g, '').replace(/\|T.*?\|t/g, '').trim();

function parseToc(file) {
  const meta = {};
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch { return meta; }
  for (const line of txt.split(/\r?\n/)) {
    const m = /^##\s*([^:]+):\s*(.*)$/.exec(line);
    if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return meta;
}

// .toc im Ordner finden; bevorzugt die, die so heißt wie der Ordner
function findToc(dir) {
  let names;
  try { names = fs.readdirSync(dir).filter((f) => /\.toc$/i.test(f)); } catch { return null; }
  if (!names.length) return null;
  const base = path.basename(dir).toLowerCase();
  const own = names.find((f) => f.slice(0, -4).toLowerCase() === base);
  const pick = own || names.sort((a, b) => a.length - b.length)[0];
  return { file: path.join(dir, pick), name: pick.slice(0, -4) };
}

async function scanDir(root, enabled) {
  let ents;
  try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    if (!e.isDirectory() || /^Blizzard_/i.test(e.name)) continue;
    const t = findToc(path.join(root, e.name));
    if (!t) continue;
    const m = parseToc(t.file);
    const hasDeps = !!(m.dependencies || m.requireddeps || m.dep1);
    const isLib = /^(lib|ace|callbackhandler|ctl$)/i.test(e.name) || /library/i.test(m['x-category'] || '') || /^lib/i.test(stripColors(m.title || ''));
    out.push({
      name: e.name,
      title: stripColors(m['title-dede'] || m.title || e.name) || e.name,
      notes: stripColors(m['notes-dede'] || m.notes || ''),
      version: m.version || '',
      author: stripColors(m.author || ''),
      enabled,
      interface: parseInt(m.interface, 10) || 0,
      incompatible: (parseInt(m.interface, 10) || 0) > 30300,   // neuer als WotLK 3.3.5a (30300)
      module: hasDeps || isLib,   // Zusatzmodule/Bibliotheken: standardmäßig ausgeblendet
    });
  }
  return out;
}

async function scan(gameDir) {
  const all = [...(await scanDir(ADDONS(gameDir), true)), ...(await scanDir(DISABLED(gameDir), false))];
  all.sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
  return all;
}

async function setEnabled(gameDir, name, enable) {
  if (!safeName(name)) throw new Error('Ungültiger Addon-Name.');
  const from = path.join(enable ? DISABLED(gameDir) : ADDONS(gameDir), name);
  const to = path.join(enable ? ADDONS(gameDir) : DISABLED(gameDir), name);
  if (!fs.existsSync(from)) throw new Error('Addon nicht gefunden: ' + name);
  if (fs.existsSync(to)) throw new Error(`Es gibt schon ein "${name}" auf der anderen Seite. Bitte erst entfernen.`);
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await moveDir(from, to);
}

// Windows meldet bei rename oft EPERM/EBUSY/EACCES (Virenscanner, Explorer, Indexer halten den Ordner kurz offen).
// Deshalb: mehrmals mit Pause erneut versuchen, danach kopieren + löschen.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Schreibschutz-Attribut (häufig bei entpackten Addons) rekursiv entfernen - sonst verweigert Windows Verschieben/Löschen mit EPERM
async function clearReadonly(dir) {
  try { await fsp.chmod(dir, 0o777); } catch {}
  let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await clearReadonly(p);
    else { try { await fsp.chmod(p, 0o666); } catch {} }
  }
}
async function moveDir(from, to) {
  let last;
  await clearReadonly(from);
  for (let i = 0; i < 6; i++) {
    try { await fsp.rename(from, to); return; }
    catch (e) {
      last = e;
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code)) throw e;
      await sleep(250 * (i + 1));
    }
  }
  try {
    await fsp.cp(from, to, { recursive: true });
    try { await fsp.rm(from, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (e) {
      await fsp.rm(to, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
  } catch (e) {
    throw new Error('Addon-Ordner ist gesperrt (läuft WoW noch oder ein Programm hat den Ordner offen?). Bitte WoW schließen und erneut versuchen. (' + (e.code || last.code) + ')');
  }
}

async function readMeta(gameDir) { try { return JSON.parse(await fsp.readFile(META(gameDir), 'utf8')); } catch { return {}; } }
async function writeMeta(gameDir, m) { await fsp.mkdir(path.dirname(META(gameDir)), { recursive: true }); await fsp.writeFile(META(gameDir), JSON.stringify(m, null, 1)); }

async function remove(gameDir, name) {
  if (!safeName(name)) throw new Error('Ungültiger Addon-Name.');
  for (const root of [ADDONS(gameDir), DISABLED(gameDir)]) {
    const d = path.join(root, name);
    await clearReadonly(d);
    await fsp.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  const m = await readMeta(gameDir);
  for (const id of Object.keys(m)) { m[id] = m[id].filter((n) => n !== name); if (!m[id].length) delete m[id]; }
  await writeMeta(gameDir, m);
}

// Katalog-Einträge mit "installiert"-Status versehen
async function annotateCatalog(gameDir, entries) {
  const have = new Set((await scan(gameDir)).map((a) => a.name.toLowerCase()));
  const meta = await readMeta(gameDir);
  return entries.map((e) => {
    const folders = meta[e.id] || [];
    const byMeta = folders.length > 0 && folders.every((f) => have.has(f.toLowerCase()));
    const byName = have.has(String(e.id).toLowerCase()) || have.has(String(e.name).replace(/\s+/g, '').toLowerCase());
    return { ...e, installed: byMeta || byName };
  });
}

// ---------- Installation aus Zip ----------
async function download(url, dest, onProgress, signal) {
  const res = await fetch(url, { signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let done = 0;
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      done += value.length; onProgress && onProgress(done, total);
    }
  } finally { await new Promise((r) => out.end(r)); }
  const fd = await fsp.open(dest, 'r'); const b = Buffer.alloc(2); await fd.read(b, 0, 2, 0); await fd.close();
  if (b.toString() !== 'PK') throw new Error('Die heruntergeladene Datei ist kein Zip (Link veraltet?).');
}

function unzip(zip, dest) {
  return new Promise((resolve, reject) => {
    const cb = (err, _o, se) => (err ? reject(new Error('Entpacken fehlgeschlagen: ' + (se || err.message).toString().trim().slice(0, 200))) : resolve());
    if (process.platform === 'win32') {
      const q = (s) => s.replace(/'/g, "''");
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(dest)}' -Force`], { windowsHide: true }, cb);
    } else execFile('unzip', ['-q', '-o', zip, '-d', dest], cb);
  });
}

// Alle Addon-Ordner im entpackten Archiv finden. Ein Addon = Ordner mit .toc.
// Der Zielname kommt aus der .toc (so wird "Name-master" automatisch zu "Name").
function collect(root) {
  const found = [];
  (function walk(dir, depth) {
    const t = findToc(dir);
    if (t) {
      const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
      const modules = subs.filter((e) => { const st = findToc(path.join(dir, e.name)); return st && st.name.toLowerCase() === e.name.toLowerCase(); }).map((e) => e.name);
      found.push({ src: dir, name: t.name, exclude: new Set(modules) });   // Module (z.B. Bagnon_Config) separat installieren
      for (const m of modules) walk(path.join(dir, m), depth + 1);
      return;
    }
    if (depth > 4) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !/^(\.|__MACOSX|docs?$)/i.test(e.name)) walk(path.join(dir, e.name), depth + 1);
    }
  })(root, 0);
  return found;
}

async function install(gameDir, entry, onPhase, signal) {
  if (!entry?.url || !/^https:\/\//.test(entry.url)) throw new Error('Kein gültiger Download-Link.');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hotlk-addon-'));
  try {
    const zip = path.join(tmp, 'addon.zip'), out = path.join(tmp, 'x');
    onPhase({ phase: 'download', done: 0, total: 0 });
    let cached = false;
    if (entry.cacheZip) {                                                   // Zip-Cache: 3 Tage gueltig, spart den Download
      try { const stt = fs.statSync(entry.cacheZip); if (Date.now() - stt.mtimeMs < 3 * 864e5 && stt.size > 1000) { fs.copyFileSync(entry.cacheZip, zip); cached = true; } } catch {}
    }
    if (!cached) {
      await download(entry.url, zip, (d, t) => onPhase({ phase: 'download', done: d, total: t }), signal);
      if (entry.cacheZip) { try { fs.copyFileSync(zip, entry.cacheZip); } catch {} }
    }
    onPhase({ phase: 'extract' });
    await fsp.mkdir(out);
    await unzip(zip, out);
    const addons = collect(out);
    if (!addons.length) throw new Error('Im Archiv wurde kein Addon (.toc) gefunden.');
    // Nur Addons für WotLK 3.3.5a (Interface 30300): neuere Versionen (Cata/MoP/Retail) funktionieren nicht
    const bad = addons.filter((x) => { const t = findToc(x.src); return t && (parseInt(parseToc(t.file).interface, 10) || 0) > 30300; });
    if (bad.length) throw new Error(`Dieses Addon ist nicht für WoW 3.3.5a (Interface ${parseInt(parseToc(findToc(bad[0].src).file).interface, 10)}). Es wurde nicht installiert.`);
    onPhase({ phase: 'copy' });
    await fsp.mkdir(ADDONS(gameDir), { recursive: true });
    const names = [];
    for (const a of addons) {
      if (!safeName(a.name)) continue;
      const dest = path.join(ADDONS(gameDir), a.name);
      await fsp.rm(dest, { recursive: true, force: true });                         // Update: alte Version ersetzen
      await fsp.rm(path.join(DISABLED(gameDir), a.name), { recursive: true, force: true });
      fs.cpSync(a.src, dest, { recursive: true, filter: (s) => !a.exclude.has(path.relative(a.src, s).split(path.sep)[0]) });
      names.push(a.name);
    }
    const m = await readMeta(gameDir); m[entry.id] = names; await writeMeta(gameDir, m);
    await recordSha(gameDir, entry);
    return names;
  } finally { await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

// ---------- Updates: GitHub-Commit beim Installieren merken, später vergleichen ----------
const SHA = (g) => path.join(g, 'Data', '_launcher', 'addons-sha.json');
const ghRepo = (url) => { const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/archive\/refs\/heads\/(.+)\.zip$/.exec(url || ''); return m ? { o: m[1], r: m[2], b: m[3] } : null; };
async function latestSha(entry) {
  const g = ghRepo(entry.url);
  if (!g) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${g.o}/${g.r}/commits/${encodeURIComponent(g.b)}`, { headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'hotlk-launcher' } });
    return r.ok ? (await r.text()).trim() : null;
  } catch { return null; }
}
const readSha = (g) => { try { return JSON.parse(fs.readFileSync(SHA(g), 'utf8')); } catch { return {}; } };
async function recordSha(gameDir, entry) {
  const sha = await latestSha(entry); if (!sha) return;
  const m = readSha(gameDir); m[entry.id] = sha;
  await fsp.mkdir(path.dirname(SHA(gameDir)), { recursive: true }); await fsp.writeFile(SHA(gameDir), JSON.stringify(m));
}
// Liefert die Katalog-IDs, zu denen es auf GitHub Neueres gibt
async function checkUpdates(gameDir, catalog) {
  const m = readSha(gameDir), out = [];
  for (const e of catalog) {
    if (!m[e.id]) continue;
    const s = await latestSha(e);
    if (s && s !== m[e.id]) out.push(e.id);
  }
  return out;
}

module.exports = { checkUpdates, recordSha, scan, setEnabled, remove, annotateCatalog, install, collect, findToc, parseToc };
