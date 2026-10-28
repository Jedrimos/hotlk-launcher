// Pack-Verwaltung: Download (mit Resume + SHA256), Gedächtnis, Aktivieren per Hardlink/Kopie.
//
//  - Gespeichert wird in  <Spiel>/Data/_launcher/packs/<id>/<relativer Pfad>
//  - "Aktivieren" verknüpft die Dateien der gewünschten Packs an ihren Zielort (z.B. Data/patch-4.MPQ)
//    und entfernt vorher alles, was ein früher aktives Pack dort abgelegt hat. Eigene Dateien des Nutzers
//    an gleicher Stelle werden gesichert und beim Deaktivieren zurückgelegt.
//  - Pro Spielordner merkt sich <Spiel>/Data/_launcher/state.json:
//        verified: { "<packId>/<pfad>": "<sha256>" }  -> welche Version der Datei lokal liegt
//        active:   [packIds]                           -> aktuell eingehängte Packs
//        linked:   { packId: [pfade] }
//    Ändert der Server eine Datei (neue Prüfsumme im Manifest), gilt das Pack als "veraltet".
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const STORE = (gameDir) => path.join(gameDir, 'Data', '_launcher');
const packDir = (gameDir, id) => path.join(STORE(gameDir), 'packs', id);
const stateFile = (gameDir) => path.join(STORE(gameDir), 'state.json');

// Nur relative Pfade innerhalb des Spielordners erlauben (Schutz vor "../")
function safeRel(rel) {
  const norm = path.normalize(rel).replace(/^([/\\])+/, '');
  if (norm.startsWith('..') || path.isAbsolute(norm)) throw new Error('Ungültiger Pfad im Manifest: ' + rel);
  return norm;
}
// Addons verwaltet der Launcher separat; sie gehören nie ins Basis-Manifest
const isAddonPath = (rel) => /^interface[\\/]addons[\\/]/i.test(rel);

async function readState(gameDir) {
  let st;
  try { st = JSON.parse(await fsp.readFile(stateFile(gameDir), 'utf8')); } catch { st = {}; }
  // alte Form (active: 'hd', linked: [...]) umwandeln
  if (typeof st.active === 'string') st.active = [st.active];
  if (Array.isArray(st.linked)) st.linked = st.active?.length ? { [st.active[0]]: st.linked } : {};
  return { active: st.active || [], linked: st.linked || {}, verified: st.verified || {} };
}
async function writeState(gameDir, st) {
  await fsp.mkdir(STORE(gameDir), { recursive: true });
  await fsp.writeFile(stateFile(gameDir), JSON.stringify(st, null, 1));
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Größe prüfen; bei "deep" zusätzlich die Prüfsumme
async function fileOk(file, entry, deep) {
  try {
    const st = await fsp.stat(file);
    if (entry.size && st.size !== entry.size) return false;
    if (deep && entry.sha256) return (await sha256(file)) === entry.sha256.toLowerCase();
    return true;
  } catch { return false; }
}

// Pack-Datei: Größe passt UND gemerkte Version entspricht dem Manifest
function verifiedOk(st, id, entry, rel, sizeOk) {
  if (!sizeOk) return false;
  if (!entry.sha256) return true;
  const known = st.verified[id + '/' + rel.split(path.sep).join('/')];
  if (!known) return true;                       // ältere Downloads ohne Eintrag: Größe genügt
  return known === entry.sha256.toLowerCase();   // Server hat die Datei geändert -> veraltet
}

// Status aller Packs eines Spielordners
async function status(gameDir, manifest) {
  const st = await readState(gameDir);
  const out = { active: st.active, packs: {} };
  for (const [id, pack] of Object.entries(manifest.packs || {})) {
    let have = 0, missingSize = 0, outdated = 0;
    for (const f of pack.files) {
      const rel = safeRel(f.path);
      const exists = await fileOk(path.join(packDir(gameDir, id), rel), f, false);
      if (exists && verifiedOk(st, id, f, rel, true)) have++;
      else { missingSize += f.size || 0; if (exists) outdated++; }
    }
    out.packs[id] = {
      kind: pack.kind || 'graphics',
      realms: pack.realms || null,
      installed: have === pack.files.length && pack.files.length > 0,
      partial: have > 0 && have < pack.files.length,
      outdated: outdated > 0,
      files: pack.files.length,
      have,
      missingFiles: pack.files.length - have,
      missingSize,
      totalSize: pack.files.reduce((a, f) => a + (f.size || 0), 0)
    };
  }
  return out;
}

// Datei entfernen; bei Schreibschutz freigeben, bei Sperre (Spiel läuft) verständlich melden
async function forceRemove(file) {
  try { await fsp.rm(file, { force: true }); return; } catch (e) {
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
    try { await fsp.chmod(file, 0o666); await fsp.rm(file, { force: true }); return; } catch {}
    throw new Error(`„${path.basename(file)}“ ist gesperrt. Bitte WoW beenden und prüfen, ob der Ordner schreibgeschützt ist (Rechtsklick → Eigenschaften).`);
  }
}

// Download-Begrenzung (Bytes pro Sekunde, 0 = unbegrenzt)
let limitBps = 0;
function setLimit(bps) { limitBps = Math.max(0, +bps || 0); }
let winStart = Date.now(), winBytes = 0;
async function throttle(n) {
  if (!limitBps) return;
  winBytes += n;
  const due = winStart + (winBytes / limitBps) * 1000, now = Date.now();
  if (due > now) await new Promise((r) => setTimeout(r, due - now));
  if (Date.now() - winStart > 5000) { winStart = Date.now(); winBytes = 0; }
}

// Einzelne Datei laden, bei Abbruch per Range fortsetzen
async function downloadFile(url, dest, entry, onBytes, signal) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let start = 0;
  try { start = (await fsp.stat(part)).size; } catch {}
  if (entry.size && start > entry.size) { await fsp.rm(part, { force: true }); start = 0; }

  const headers = start ? { Range: `bytes=${start}-` } : {};
  const res = await fetch(url, { headers, signal });
  if (res.status === 416) { await fsp.rm(part, { force: true }); return downloadFile(url, dest, entry, onBytes, signal); }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} für ${url}`);
  if (res.status === 200 && start) { await fsp.rm(part, { force: true }); start = 0; } // Server kennt kein Range

  onBytes(start, true);
  const out = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      onBytes(value.length, false);
      await throttle(value.length);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (entry.sha256) {
    const got = await sha256(part);
    if (got !== entry.sha256.toLowerCase()) {
      await fsp.rm(part, { force: true });
      throw new Error(`Prüfsumme falsch: ${entry.path}`);
    }
  }
  await forceRemove(dest);
  await fsp.rename(part, dest);
}

// Dateiliste nach destFn(file) laden; fehlende/falsche Dateien werden (nach)geladen.
// okFn(file, dest) -> true, wenn die Datei schon aktuell ist; onFile(file) nach jedem erfolgreichen Download.
async function fetchFiles(files, destFn, okFn, onFile, id, onProgress, signal, deep) {
  const total = files.reduce((a, f) => a + (f.size || 0), 0);
  let done = 0, lastEmit = 0, t0 = Date.now(), base = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 200) return;
    lastEmit = now;
    onProgress({ id, done, total, speed: (done - base) / Math.max(1, (now - t0) / 1000) });
  };
  for (const f of files) {
    const dest = destFn(f);
    if (await okFn(f, dest, deep)) { done += f.size || 0; emit(true); continue; }
    if (deep) await forceRemove(dest);
    base = done; t0 = Date.now();
    await downloadFile(f.url, dest, f, (n, resumed) => { done += n; emit(resumed); }, signal);
    if (onFile) await onFile(f);
  }
  emit(true);
}

// Pack laden bzw. auf den Stand des Manifests bringen
async function download(gameDir, id, manifest, onProgress, signal) {
  const pack = manifest.packs[id];
  if (!pack) throw new Error('Unbekanntes Pack: ' + id);
  const st = await readState(gameDir);
  const key = (f) => id + '/' + safeRel(f.path).split(path.sep).join('/');
  await fetchFiles(
    pack.files,
    (f) => path.join(packDir(gameDir, id), safeRel(f.path)),
    async (f, dest, deep) => (await fileOk(dest, f, deep)) && verifiedOk(st, id, f, safeRel(f.path), true),
    async (f) => { st.verified[key(f)] = (f.sha256 || '').toLowerCase(); await writeState(gameDir, st); },
    id, onProgress, signal, false
  );
  // Gedächtnis auffrischen: alles, was jetzt passt, gilt als geladen
  for (const f of pack.files) if (f.sha256) st.verified[key(f)] = f.sha256.toLowerCase();
  await writeState(gameDir, st);
}

// Basis-Client direkt im Spielordner installieren bzw. reparieren (deep = Hashes prüfen)
async function syncBase(gameDir, manifest, onProgress, signal, deep) {
  const files = (manifest.base?.files || []).filter((f) => !isAddonPath(f.path));
  if (!files.length) throw new Error('Das Manifest enthält keinen Basis-Client.');
  const st = await readState(gameDir);
  const linked = new Set(Object.values(st.linked).flat().map((r) => r.split(path.sep).join('/')));
  // Dateien, die gerade ein Pack belegt, nicht anfassen
  const todo = files.filter((f) => !linked.has(safeRel(f.path).split(path.sep).join('/')));
  await fetchFiles(todo, (f) => path.join(gameDir, safeRel(f.path)), (f, dest, d) => fileOk(dest, f, d), null, 'base', onProgress, signal, deep);
}

async function baseStatus(gameDir, manifest) {
  const files = (manifest.base?.files || []).filter((f) => !isAddonPath(f.path));
  if (!files.length) return null;
  let have = 0, missingSize = 0;
  for (const f of files) {
    if (await fileOk(path.join(gameDir, safeRel(f.path)), f, false)) have++;
    else missingSize += f.size || 0;
  }
  return { files: files.length, have, complete: have === files.length, totalSize: files.reduce((a, f) => a + (f.size || 0), 0), missingSize, missingFiles: files.length - have };
}

// Cache leeren, aber nie am Start scheitern (Datei gesperrt, schreibgeschützt, Spiel läuft noch ...)
async function clearCache(gameDir) {
  try { await fsp.rm(path.join(gameDir, 'Cache'), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); return true; }
  catch { return false; }
}

// Alle eingehängten Packs entfernen und gesicherte Originaldateien zurücklegen
async function deactivate(gameDir) {
  const st = await readState(gameDir);
  for (const rels of Object.values(st.linked)) {
    for (const rel of rels) {
      try { await fsp.rm(path.join(gameDir, safeRel(rel)), { force: true }); } catch {}
      const bak = path.join(STORE(gameDir), 'backup', safeRel(rel));
      try { await fsp.rename(bak, path.join(gameDir, safeRel(rel))); } catch {}
    }
  }
  st.active = []; st.linked = {};
  await writeState(gameDir, st);
}

// Gewünschte Packs einhängen (Reihenfolge = Priorität, spätere gewinnen). Leere Liste = Original.
async function applySet(gameDir, manifest, ids, clearCacheToo, onPhase = () => {}, signal) {
  const st = await readState(gameDir);
  const same = st.active.length === ids.length && st.active.every((v, i) => v === ids[i]);
  let intact = same;
  if (same) {   // Links noch da?
    for (const id of ids) for (const rel of st.linked[id] || []) {
      // Nicht nur "ist da", sondern "ist wirklich die aktuelle Pack-Datei" (sonst bleibt nach einem Pack-Update die alte Version liegen)
      try {
        const a = fs.statSync(path.join(gameDir, safeRel(rel))), b = fs.statSync(path.join(packDir(gameDir, id), safeRel(rel)));
        if (a.size !== b.size || !(a.ino === b.ino || Math.abs(a.mtimeMs - b.mtimeMs) < 2000)) intact = false;
      } catch { intact = false; }
    }
  }
  if (same && intact) return false;                     // nichts zu tun
  onPhase('Alte Packs werden ausgehängt …');
  await deactivate(gameDir);
  const linkedAll = {};
  const undo = async () => { st.linked = linkedAll; st.active = []; await writeState(gameDir, st); await deactivate(gameDir); };
  for (const id of ids) {
    const pack = manifest.packs[id];
    if (!pack) throw new Error('Unbekanntes Pack: ' + id);
    linkedAll[id] = [];
    for (const f of pack.files) {
      const rel = safeRel(f.path);
      const src = path.join(packDir(gameDir, id), rel);
      const dst = path.join(gameDir, rel);
      if (signal?.aborted) { await undo(); throw new Error('Abgebrochen'); }
      if (!(await fileOk(src, f, false))) throw new Error(`Pack "${pack.name || id}" ist nicht vollständig geladen (${f.path}).`);
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      // Datei des Nutzers oder eines anderen Packs an gleicher Stelle sichern statt überschreiben
      try {
        await fsp.access(dst);
        const bak = path.join(STORE(gameDir), 'backup', rel);
        await fsp.mkdir(path.dirname(bak), { recursive: true });
        if (!fs.existsSync(bak)) await fsp.rename(dst, bak); else await fsp.rm(dst, { force: true });
      } catch {}
      onPhase(`Pack „${pack.name || id}“ wird eingehängt: ${path.basename(rel)} …`);
      try { await fsp.link(src, dst); } catch { onPhase(`Kopiere ${path.basename(rel)} (dieses Laufwerk kann keine Verknüpfungen, das dauert) …`); await fsp.copyFile(src, dst); try { const t = fs.statSync(src); await fsp.utimes(dst, t.atime, t.mtime); } catch {} }
      linkedAll[id].push(rel);
      if (signal?.aborted) { await undo(); throw new Error('Abgebrochen'); }
    }
  }
  const st2 = await readState(gameDir);
  st2.active = ids.slice(); st2.linked = linkedAll;
  await writeState(gameDir, st2);
  if (clearCacheToo) clearCache(gameDir).catch(() => {});   // im Hintergrund, blockiert den Start nicht
  return true;
}

async function removePack(gameDir, id) {
  const st = await readState(gameDir);
  if (st.active.includes(id)) await deactivate(gameDir);
  await fsp.rm(packDir(gameDir, id), { recursive: true, force: true });
  const st2 = await readState(gameDir);
  for (const k of Object.keys(st2.verified)) if (k.startsWith(id + '/')) delete st2.verified[k];
  await writeState(gameDir, st2);
}

module.exports = { setLimit, clearCache, status, download, syncBase, baseStatus, applySet, deactivate, removePack, isAddonPath };
