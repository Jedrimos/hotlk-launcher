const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const cfgStore = require('./config');
const packs = require('./packs');
const detect = require('./detect');
const L = require('./log');
const gm = require('./gmaddons');

// Alle IPC-Fehler und unerwarteten Fehler in launcher.log festhalten
const _handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (ch, fn) => _handle(ch, async (...a) => { try { return await fn(...a); } catch (e) { L.log('error', ch, e && e.message); throw e; } });
process.on('uncaughtException', (e) => L.log('fatal', e));
process.on('unhandledRejection', (e) => L.log('error', 'unhandledRejection', e));

let win, cfg, abort = null;
const FOLDER = 'World of Warcraft - Home of the Lich King';

// Launcher nur einmal öffnen
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 1040, minHeight: 740, resizable: true, frame: false,
    backgroundColor: '#0b1118', show: false, icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => { cfg = cfgStore.load(); packs.setLimit((cfg.speedLimitMbit || 0) * 125000); createWindow(); if (cfg.gameDir) wowRunning().then((r) => { if (!r) gm.cleanup(cfg.gameDir, L.log).catch(() => {}); }); });
app.on('window-all-closed', () => app.quit());

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}


// ---------- Schnell-Cache: sofort aus dem Cache antworten, im Hintergrund aktualisieren ----------
const swrFile = (n) => path.join(app.getPath('userData'), 'cache-' + n + '.json');
const swrMem = {};
function swrRead(n) { if (swrMem[n] !== undefined) return swrMem[n]; try { return (swrMem[n] = JSON.parse(fs.readFileSync(swrFile(n), 'utf8'))); } catch { return (swrMem[n] = null); } }
async function swrRefresh(n, url) {
  try {
    const j = await getJson(url);
    const old = swrRead(n);
    swrMem[n] = j;
    if (JSON.stringify(old) !== JSON.stringify(j)) {
      fs.promises.writeFile(swrFile(n), JSON.stringify(j)).catch(() => {});
      if (win && !win.isDestroyed()) win.webContents.send('data:updated', n, j);
    }
    return j;
  } catch { return swrRead(n); }
}
async function swr(n, url, fresh) {
  const c = swrRead(n);
  if (c && !fresh) { swrRefresh(n, url); return c; }
  return swrRefresh(n, url);
}

async function getVersionJson() { try { return await getJson(cfg.versionUrl); } catch { return await getJson(cfg.versionUrlAlt); } }

const hasGame = (d) => d && fs.existsSync(path.join(d, 'Wow.exe'));

// realmlist.wtf in allen vorhandenen Sprachordnern setzen (Data/enUS, Data/deDE, ...)
function writeRealmlist(gameDir, host) {
  const data = path.join(gameDir, 'Data');
  let n = 0;
  for (const e of fs.readdirSync(data, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^[a-z]{2}[A-Z]{2}$/.test(e.name)) continue;
    fs.writeFileSync(path.join(data, e.name, 'realmlist.wtf'), `set realmlist ${host}\r\n`);
    n++;
  }
  if (!n) throw new Error('Kein Sprachordner in Data gefunden (z.B. deDE).');
}


// ---------- Anmeldung (Account der Webseite = Spiel-Account) ----------
let session = null;      // { username, role, gmlevel }
let sessionPass = null;  // nur im Arbeitsspeicher, für Auto-Login im Spiel
const credFile = () => path.join(app.getPath('userData'), 'cred.json');

function readCreds() {
  try {
    const o = JSON.parse(fs.readFileSync(credFile(), 'utf8'));
    if (Array.isArray(o.accounts)) return o;
    return { accounts: o.u ? [{ u: o.u, p: o.p }] : [], last: o.u };   // alte Form
  } catch { return { accounts: [], last: null }; }
}
function writeCreds(o) { fs.writeFileSync(credFile(), JSON.stringify(o)); }
function saveCred(u, p) {
  const o = readCreds();
  const entry = { u };
  if (p && safeStorage.isEncryptionAvailable()) entry.p = safeStorage.encryptString(p).toString('base64'); // Windows: DPAPI
  o.accounts = o.accounts.filter((x) => x.u.toLowerCase() !== u.toLowerCase()).concat(entry);
  o.last = u; writeCreds(o);
}
function getCred(u) {
  const x = readCreds().accounts.find((a) => a.u.toLowerCase() === String(u).toLowerCase());
  if (!x) return null;
  try { return { u: x.u, p: x.p && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(x.p, 'base64')) : null }; } catch { return { u: x.u, p: null }; }
}
function loadCred() { const o = readCreds(); return o.last ? getCred(o.last) : null; }

async function doLogin(u, p) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(cfg.loginUrl, { method: 'POST', body: JSON.stringify({ username: u, password: p }), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || 'Anmeldung fehlgeschlagen (HTTP ' + r.status + ')');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Server nicht erreichbar.');
    throw e;
  } finally { clearTimeout(t); }
}

ipcMain.handle('auth:login', async (_e, u, p, remember) => {
  const j = await doLogin(String(u || '').trim(), String(p || ''));
  session = { username: j.username, role: j.role, gmlevel: j.gmlevel };
  sessionPass = p;
  if (remember) saveCred(j.username, p);
  return session;
});
// Beim Start: gespeicherte Daten still prüfen
ipcMain.handle('auth:restore', async () => {
  const c = loadCred();
  if (!c) return { session: null, user: '' };
  if (!c.p) return { session: null, user: c.u };
  try {
    const j = await doLogin(c.u, c.p);
    session = { username: j.username, role: j.role, gmlevel: j.gmlevel }; sessionPass = c.p;
    return { session, user: c.u };
  } catch (e) { return { session: null, user: c.u, error: String(e.message || e) }; }
});
ipcMain.handle('auth:logout', () => { session = null; sessionPass = null; const o = readCreds(); o.last = null; try { writeCreds(o); } catch {} return true; });
ipcMain.handle('auth:accounts', () => readCreds().accounts.map((a) => ({ u: a.u, saved: !!a.p })));
ipcMain.handle('auth:switch', async (_e, u) => {
  const c = getCred(u);
  if (!c?.p) throw new Error('Für dieses Konto ist kein Passwort gespeichert. Bitte neu anmelden.');
  const j = await doLogin(c.u, c.p);
  session = { username: j.username, role: j.role, gmlevel: j.gmlevel }; sessionPass = c.p;
  const o = readCreds(); o.last = c.u; writeCreds(o);
  return session;
});
ipcMain.handle('auth:forget', (_e, u) => { const o = readCreds(); o.accounts = o.accounts.filter((x) => x.u.toLowerCase() !== String(u).toLowerCase()); if (o.last && o.last.toLowerCase() === String(u).toLowerCase()) o.last = null; writeCreds(o); return true; });
ipcMain.handle('auth:password', () => (session && sessionPass ? true : false));

// Account und Passwort ins Spiel-Login tippen (Windows, per SendKeys).
function sendKeysEscape(s) { return s.replace(/[+^%~(){}\[\]]/g, (c) => '{' + c + '}'); }
function autoTypeLogin(user, pass, delay) {
  if (process.platform !== 'win32') return;
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$p=$null; for($i=0;$i -lt 90 -and -not $p;$i++){ Start-Sleep 1; $p=Get-Process Wow -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1 }",
    "if(-not $p){ exit }",
    "Start-Sleep -Seconds ([int]$env:HOTLK_DELAY)",
    "(New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null",
    "Start-Sleep -Milliseconds 500",
    "[System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE 40}')",
    "[System.Windows.Forms.SendKeys]::SendWait($env:HOTLK_U)",
    "[System.Windows.Forms.SendKeys]::SendWait('{TAB}')",
    "[System.Windows.Forms.SendKeys]::SendWait($env:HOTLK_P)",
    "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"
  ].join('; ');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], {
    env: { ...process.env, HOTLK_U: sendKeysEscape(user), HOTLK_P: sendKeysEscape(pass), HOTLK_DELAY: String(delay) },
    detached: true, stdio: 'ignore', windowsHide: true
  });
  child.unref();
}

// ---------- Läuft WoW schon? ----------
function wowRunning() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('tasklist', ['/FI', 'IMAGENAME eq Wow.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => {
      resolve(!err && /"Wow\.exe"/i.test(out || ''));
    });
  });
}
ipcMain.handle('game:running', wowRunning);

// ---------- Standard-Ordner für eine Neuinstallation ----------
ipcMain.handle('game:defaultTarget', async () => {
  let need = 28e9;
  try {
    const m = await getJson(cfg.manifestUrl);
    const sum = (a) => (a || []).reduce((x, f) => x + (f.size || 0), 0);
    need = sum(m.base?.files) + Object.values(m.packs || {}).reduce((x, p) => x + sum(p.files), 0) + 2e9;
  } catch {}
  const list = [];
  for (const r of detect.roots()) list.push({ r, free: (await detect.freeBytes(r)) || 0 });
  list.sort((a, b) => b.free - a.free);
  const pick = list.find((x) => x.free >= need) || list[0];
  return pick ? path.join(pick.r, FOLDER) : '';
});

// ---------- Server-Status und Launcher-Version ----------
ipcMain.handle('server:status', async () => { try { return await getJson(cfg.statusUrl); } catch { return null; } });

const verNum = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
ipcMain.handle('launcher:version', async () => {
  const current = app.getVersion();
  try {
    const v = await getVersionJson();
    return { current, latest: v.version, newer: isNewer(v.version, current), url: v.url, notes: v.notes || '' };
  } catch { return { current, latest: null, newer: false }; }
});

ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:set', (_e, patch) => { cfg = { ...cfg, ...patch }; cfgStore.save(cfg); packs.setLimit((cfg.speedLimitMbit || 0) * 125000); return cfg; });

ipcMain.handle('game:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'WoW-Ordner wählen (enthält Wow.exe)', properties: ['openDirectory'] });
  if (r.canceled) return null;
  const d = r.filePaths[0];
  // Kein Spiel im gewählten Ordner: dort den Ordner "World of Warcraft - Home of the Lich King" verwenden
  cfg.gameDir = (hasGame(d) || path.basename(d) === FOLDER) ? d : path.join(d, FOLDER);
  cfgStore.save(cfg);
  return cfg.gameDir;
});

ipcMain.handle('news:get', async () => swr('news', cfg.newsUrl));

async function gameInfo() {
  const d = cfg.gameDir;
  if (!d) return null;
  return { dir: d, exists: fs.existsSync(d), installed: hasGame(d), drive: path.parse(d).root, free: await detect.freeBytes(d) };
}

ipcMain.handle('game:info', gameInfo);
ipcMain.handle('game:detect', async () => {
  const found = await detect.findGames();
  const out = [];
  for (const dir of found) out.push({ dir, drive: path.parse(dir).root, free: await detect.freeBytes(dir) });
  return out;
});
ipcMain.handle('game:set', async (_e, dir) => { cfg.gameDir = dir; cfgStore.save(cfg); return gameInfo(); });

// Welche Packs gelten für den gewählten Realm? Pack ohne "realms" und nicht kind:'server' = überall, sonst nur für die genannten Realm-Schlüssel.
const realmOf = () => cfg.realms[cfg.selectedRealm] || cfg.realms[0];
function packAllowed(pack, realm) {
  const scope = pack.realms || (pack.kind === 'server' ? ['home'] : null);
  return !scope || scope.includes(realm.key || '');
}
let lastManifest = null;
const manifestCache = () => path.join(app.getPath('userData'), 'manifest-cache.json');
async function loadManifest() {
  try { lastManifest = await getJson(cfg.manifestUrl); try { fs.writeFileSync(manifestCache(), JSON.stringify(lastManifest)); } catch {} return { manifest: lastManifest, offline: false }; }
  catch (e) {
    try { lastManifest = JSON.parse(fs.readFileSync(manifestCache(), 'utf8')); return { manifest: lastManifest, offline: true, error: e.message }; }
    catch { return { manifest: null, offline: true, error: e.message }; }
  }
}

ipcMain.handle('packs:status', async () => {
  const game = await gameInfo();
  const { manifest, offline, error } = await loadManifest();
  if (!manifest) return { game, error: 'Pack-Liste nicht erreichbar: ' + error };
  if (!cfg.gameDir || !fs.existsSync(cfg.gameDir)) return { game, manifest, offline, needGame: true };
  const base = await packs.baseStatus(cfg.gameDir, manifest);
  if (!hasGame(cfg.gameDir)) return { game, manifest, offline, base, needGame: true };
  const st = await packs.status(cfg.gameDir, manifest);
  const realm = realmOf();
  for (const [id, p] of Object.entries(st.packs)) p.allowed = packAllowed(manifest.packs[id], realm);
  return { game, manifest, offline, base, ...st };
});

ipcMain.handle('packs:download', async (_e, id) => {
  if (abort) throw new Error('Es läuft bereits ein Download.');
  const { manifest } = await loadManifest();
  if (!manifest) throw new Error('Pack-Liste nicht erreichbar.');
  abort = new AbortController();
  try {
    await packs.download(cfg.gameDir, id, manifest, (p) => win.webContents.send('packs:progress', p), abort.signal);
  } finally { abort = null; }
});
ipcMain.handle('base:sync', async (_e, deep) => {
  if (abort) throw new Error('Es läuft bereits ein Download.');
  if (await wowRunning()) throw new Error('WoW läuft gerade. Bitte erst beenden, sonst sind die Dateien gesperrt.');
  if (!cfg.gameDir) throw new Error('Bitte zuerst einen Ordner wählen.');
  fs.mkdirSync(cfg.gameDir, { recursive: true });
  const { manifest } = await loadManifest();
  if (!manifest) throw new Error('Pack-Liste nicht erreichbar.');
  abort = new AbortController();
  try { await packs.syncBase(cfg.gameDir, manifest, (p) => win.webContents.send('packs:progress', p), abort.signal, !!deep); }
  finally { abort = null; }
});
ipcMain.handle('packs:cancel', () => { if (abort) abort.abort(); });
ipcMain.handle('packs:remove', async (_e, id) => packs.removePack(cfg.gameDir, id));

// ---------- Realm-Status (Online-Zahl) ----------
const net = require('net');
function tcpPing(host, port, ms = 3000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const s = net.connect({ host, port }, () => { s.destroy(); resolve({ up: true, ms: Date.now() - t0 }); });
    s.setTimeout(ms, () => { s.destroy(); resolve({ up: false }); });
    s.on('error', () => resolve({ up: false }));
  });
}
ipcMain.handle('realms:status', async () => {
  return Promise.all(cfg.realms.map(async (r) => {
    if (r.key === 'home') {
      const j = await getJson(cfg.statusUrl).catch(() => null);
      if (j) { const n = j.online ?? j.players ?? j.count ?? j.online_players; return { up: j.up ?? j.status !== 'offline', online: Number.isFinite(+n) ? +n : null, exact: true }; }
    }
    return { ...(await tcpPing(r.realmlist.split(':')[0], +(r.realmlist.split(':')[1]) || 3724)), online: null, exact: false };
  }));
});

// ---------- Addons ----------
const addons = require('./addons');
let catalogCache = null;
const needGame = () => { if (!hasGame(cfg.gameDir)) throw new Error('Bitte zuerst das Spiel installieren oder den Ordner wählen.'); return cfg.gameDir; };
ipcMain.handle('addons:installed', async () => addons.scan(needGame()));
ipcMain.handle('addons:toggle', async (_e, name, on) => addons.setEnabled(needGame(), name, on));
ipcMain.handle('addons:remove', async (_e, name) => addons.remove(needGame(), name));
ipcMain.handle('addons:catalog', async () => {
  let list = null;
  if (cfg.addonsUrl) list = await getJson(cfg.addonsUrl).catch(() => null);
  if (!list) list = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
  catalogCache = list;
  return hasGame(cfg.gameDir) ? addons.annotateCatalog(cfg.gameDir, list) : list;
});
ipcMain.handle('addons:install', async (_e, id) => {
  if (abort) throw new Error('Es läuft bereits ein Download.');
  const entry = (catalogCache || []).find((x) => x.id === id);
  if (!entry) throw new Error('Unbekanntes Addon.');
  abort = new AbortController();
  try { return await addons.install(needGame(), entry, (p) => win.webContents.send('addons:progress', { id, ...p }), abort.signal); }
  finally { abort = null; }
});

ipcMain.handle('game:play', async () => {
  if (await wowRunning()) throw new Error('WoW läuft bereits. Bitte das offene Spiel benutzen oder beenden.');
  if (!hasGame(cfg.gameDir)) throw new Error('Bitte zuerst den WoW-Ordner wählen.');
  const realm = realmOf();
  if (!realm) throw new Error('Kein Realm gewählt.');
  const { manifest } = await loadManifest();
  let want = [];
  if (manifest) {
    const st = await packs.status(cfg.gameDir, manifest);
    // Server-Patches (kind:'server') laufen automatisch auf dem eigenen Realm; das Grafik-Pack nur, wenn gewählt
    const ids = Object.keys(manifest.packs).filter((id) => {
      const p = manifest.packs[id];
      if (!packAllowed(p, realm)) return false;
      return p.kind === 'server' || (p.realms && !p.kind) ? true : cfg.activePack === id;
    });
    for (const id of ids) {
      if (!st.packs[id]?.installed) throw new Error(`Das Pack "${manifest.packs[id].name || id}" ist nicht vollständig geladen.`);
    }
    want = ids;
  }
  const phase = (t) => win.webContents.send('game:phase', t);
  // Admin-Addons parallel zum Pack-Umstellen vorbereiten
  let gmJob = Promise.resolve();
  if (realm.key === 'home' && session && (session.gmlevel || 0) >= 1 && cfg.gmAddons !== false) {
    gmJob = gm.cleanup(cfg.gameDir, L.log).then(() => gm.setup(cfg.gameDir, session, phase, null, L.log, app.getPath('userData')))
      .then((f) => { if (f.length) L.log('info', 'GM-Addons installiert', f.join(',')); }).catch((e) => L.log('warn', 'GM-Addons', e.message));
  } else gmJob = gm.cleanup(cfg.gameDir, L.log).catch(() => {});
  const t0 = Date.now();
  abort = new AbortController();
  try { await packs.applySet(cfg.gameDir, manifest || { packs: {} }, want, cfg.clearCacheOnSwitch, phase, abort.signal); }
  catch (e) { await gmJob; await gm.cleanup(cfg.gameDir, L.log).catch(() => {}); throw e; }
  finally { const was = abort && abort.signal.aborted; abort = null; if (was) { await gmJob; await gm.cleanup(cfg.gameDir, L.log).catch(() => {}); throw new Error('Start abgebrochen.'); } }
  phase('Starte WoW … (Packs umgestellt in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  await gmJob;
  writeRealmlist(cfg.gameDir, realm.realmlist);
  spawn(path.join(cfg.gameDir, 'Wow.exe'), [], { cwd: cfg.gameDir, detached: true, stdio: 'ignore' }).unref();
  L.log('info', 'WoW gestartet', realm.name, 'Pack', cfg.activePack);
  afterLaunch();
  if (cfg.autoLogin && session && sessionPass) autoTypeLogin(session.username, sessionPass, cfg.autoDelay || 9);
  setTimeout(() => discordSet(true), 8000);
  return true;
});


// ---------- Start-Check ----------
ipcMain.handle('game:preflight', async () => {
  const errors = [], warnings = [];
  if (!hasGame(cfg.gameDir)) { errors.push('Das Spiel ist nicht installiert.'); return { errors, warnings }; }
  const realm = realmOf();
  const d = await tools.diagnose(cfg.gameDir, realm, true);
  for (const x of d) if (x.level === 'err') errors.push(x.title + ' – ' + x.detail);
  const host = realm.realmlist.split(':');
  const p = await tcpPing(host[0], +host[1] || 3724, 1500);
  if (!p.up) warnings.push(`Der Server „${realm.name}“ antwortet gerade nicht. Das Spiel startet, aber die Anmeldung wird scheitern.`);
  if (cfg.autoLogin && !(session && sessionPass)) warnings.push('Du bist nicht angemeldet. Im Spiel musst du Account und Passwort selbst eingeben.');
  return { errors, warnings };
});

// ---------- Werkzeuge ----------
const tools = require('./tools');
const G = () => { if (!hasGame(cfg.gameDir)) throw new Error('Bitte zuerst das Spiel installieren.'); return cfg.gameDir; };
ipcMain.handle('tools:backups', () => tools.backupList(G()));
ipcMain.handle('tools:backupCreate', async () => { if (await wowRunning()) throw new Error('Bitte erst WoW beenden.'); return tools.backupCreate(G(), 'manuell'); });
ipcMain.handle('tools:backupRestore', async (_e, n) => { if (await wowRunning()) throw new Error('Bitte erst WoW beenden.'); return tools.backupRestore(G(), n); });
ipcMain.handle('tools:backupDelete', (_e, n) => tools.backupDelete(G(), n));
ipcMain.handle('tools:wtfReset', async () => { if (await wowRunning()) throw new Error('Bitte erst WoW beenden.'); return tools.wtfReset(G()); });
ipcMain.handle('tools:gfxGet', () => tools.gfxGet(G()));
ipcMain.handle('tools:gfxSet', async (_e, patch) => { if (await wowRunning()) throw new Error('Bitte erst WoW beenden, sonst überschreibt es die Einstellungen.'); return tools.gfxSet(G(), patch); });
ipcMain.handle('tools:diagnose', () => tools.diagnose(G(), realmOf()));
ipcMain.handle('tools:fix', async (_e, id) => tools.fix(G(), id, realmOf(), packs));
ipcMain.handle('tools:crashLatest', () => tools.crashLatest(G()));
async function postJson(url, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || 'Server antwortet mit HTTP ' + r.status);
    return j;
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'Server nicht erreichbar.' : e.message); } finally { clearTimeout(t); }
}
ipcMain.handle('tools:crashSend', async () => {
  if (!session) throw new Error('Bitte zuerst anmelden.');
  const c = tools.crashLatest(G());
  if (!c) throw new Error('Keine Fehlerdatei gefunden.');
  await postJson(cfg.crashUrl, { username: session.username, version: app.getVersion(), file: c.file, time: c.time, text: c.text });
  return true;
});

// ---------- Server-Info, Online-Liste, Betreiber ----------
ipcMain.handle('server:info', async (_e, fresh) => swr('serverinfo', cfg.serverInfoUrl, !!fresh));
ipcMain.handle('server:players', async () => { try { return await getJson(cfg.playersUrl); } catch { return null; } });
ipcMain.handle('admin:run', async (_e, action, data) => {
  if (!session || !sessionPass) throw new Error('Bitte anmelden.');
  if ((session.gmlevel || 0) < 3) throw new Error('Dafür brauchst du GM-Rechte (Level 3).');
  return postJson(cfg.adminUrl, { username: session.username, password: sessionPass, action, ...data });
});

// ---------- Launcher-Selbstupdate (portable .exe) ----------
ipcMain.handle('launcher:update', async () => {
  const v = await getVersionJson();
  if (!isNewer(v.version, app.getVersion())) throw new Error('Du hast schon die neueste Version.');
  const target = process.env.PORTABLE_EXECUTABLE_FILE;
  const url = v.exe || (cfg.siteUrl + 'download/files/HomeOfTheLichKing-Launcher.exe');
  if (!target || process.platform !== 'win32') { shell.openExternal(v.url || url); throw new Error('Automatisches Update geht nur mit der fertigen .exe. Download im Browser geöffnet.'); }
  const tmp = target + '.new';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download fehlgeschlagen: HTTP ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  const out = fs.createWriteStream(tmp); const rd = res.body.getReader(); let done = 0; const h = require('crypto').createHash('sha256');
  for (;;) {
    const { done: fin, value } = await rd.read(); if (fin) break;
    h.update(value); if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    done += value.length; win.webContents.send('update:progress', { done, total });
  }
  await new Promise((r) => out.end(r));
  if (v.sha256 && h.digest('hex') !== String(v.sha256).toLowerCase()) { fs.rmSync(tmp, { force: true }); throw new Error('Prüfsumme der neuen Version stimmt nicht.'); }
  const bat = path.join(app.getPath('temp'), 'hotlk-update.cmd');
  fs.writeFileSync(bat, `@echo off\r\nping 127.0.0.1 -n 4 >nul\r\n:retry\r\nmove /y "${tmp}" "${target}" >nul 2>&1\r\nif errorlevel 1 (ping 127.0.0.1 -n 2 >nul & goto retry)\r\nstart "" "${target}"\r\ndel "%~f0"\r\n`);
  spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.exit(0);
});

// ---------- Addon-Updates ----------
ipcMain.handle('addons:updates', async () => {
  if (!hasGame(cfg.gameDir)) return [];
  return catalogCache ? addons.checkUpdates(cfg.gameDir, catalogCache) : [];
});

// ---------- Discord-Presence (nur mit eigener Application-ID in den Einstellungen) ----------
let rpc = null, rpcStart = 0;
function discordSet(active) {
  if (!cfg.discordClientId || process.platform !== 'win32') return;
  if (!active) { if (rpc) { try { rpc.destroy(); } catch {} rpc = null; } return; }
  if (rpc) return;
  const frame = (op, obj) => { const b = Buffer.from(JSON.stringify(obj)); const h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(b.length, 4); return Buffer.concat([h, b]); };
  let sock; try { sock = net.connect('\\\\?\\pipe\\discord-ipc-0'); } catch { return; }
  rpc = sock; rpcStart = Math.floor(Date.now() / 1000);
  sock.on('error', () => { rpc = null; }); sock.on('close', () => { rpc = null; });
  sock.on('connect', () => sock.write(frame(0, { v: 1, client_id: cfg.discordClientId })));
  let ready = false;
  sock.on('data', () => {
    if (ready) return; ready = true;
    sock.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: String(Date.now()), args: { pid: process.pid, activity: { details: realmOf().name, state: session ? 'Spielt als ' + session.username : 'Spielt WoW', timestamps: { start: rpcStart } } } }));
  });
}
setInterval(async () => { discordSet(await wowRunning()); }, 15000);

ipcMain.handle('win:min', () => win.minimize());
ipcMain.handle('win:close', () => win.close());
ipcMain.handle('open:url', (_e, u) => { if (/^https?:/.test(u)) shell.openExternal(u); });


// ---------- Nach dem Start, Absturz-Erkennung ----------
let watching = false;
function afterLaunch() {
  const mode = cfg.afterLaunch || 'keep';
  const t0 = Date.now();
  const gmOn = gm.active(cfg.gameDir);
  if (mode === 'close' && !gmOn) { setTimeout(() => app.quit(), 4000); return; }
  if (mode === 'minimize' && win) win.minimize();
  if (watching) return;
  watching = true;
  let seen = false;
  const iv = setInterval(async () => {
    const r = await wowRunning();
    if (r) { seen = true; return; }
    if (!seen && Date.now() - t0 < 60000) return;
    clearInterval(iv); watching = false;
    await gm.cleanup(cfg.gameDir, L.log).catch(() => {});
    if (mode === 'close') { app.quit(); return; }
    L.log('info', 'WoW beendet nach', Math.round((Date.now() - t0) / 60000), 'min');
    if (!win) return;
    if (mode === 'minimize') { win.restore(); win.focus(); }
    try {
      const c = tools.crashLatest(cfg.gameDir);
      if (c && new Date(c.time).getTime() > t0 - 2000) { L.log('warn', 'Absturzdatei', c.file); win.webContents.send('game:crashed', { file: c.file }); }
    } catch {}
  }, 4000);
}

// ---------- Hilfe, Fehler melden ----------
const os = require('os');
function sysinfo() {
  const g = hasGame(cfg.gameDir);
  let wow = 'nicht installiert';
  try { if (g) wow = 'Wow.exe ' + Math.round(fs.statSync(path.join(cfg.gameDir, 'Wow.exe')).size / 1024) + ' KB'; } catch {}
  const r = (() => { try { return realmOf(); } catch { return null; } })();
  return [
    ['Launcher', app.getVersion()], ['Electron', process.versions.electron],
    ['System', `${os.type()} ${os.release()} ${os.arch()}`], ['Prozessor', (os.cpus()[0] || {}).model || '?'],
    ['Arbeitsspeicher', Math.round(os.totalmem() / 1e9) + ' GB'],
    ['Spielordner', cfg.gameDir || '-'], ['Spiel', wow], ['Server', r ? r.name : '-'],
    ['Grafik-Pack', cfg.activePack || 'none'], ['Account', session ? session.username : '-'], ['Sprache', cfg.lang || 'de']
  ];
}
const sysText = () => sysinfo().map(([k, v]) => `${k}: ${v}`).join('\n');
ipcMain.handle('support:sysinfo', () => sysinfo());
ipcMain.handle('support:copy', (_e, text) => { require('electron').clipboard.writeText(String(text || sysText())); return true; });
ipcMain.handle('support:openLog', () => { shell.showItemInFolder(L.file()); return true; });
ipcMain.handle('support:log', (_e, level, msg) => { L.log(level === 'error' ? 'renderer-error' : 'renderer', String(msg).slice(0, 2000)); return true; });
ipcMain.handle('support:report', async (_e, o) => {
  const kind = ['FEHLER', 'IDEE', 'FRAGE', 'ABSTURZ'].includes(o.kind) ? o.kind : 'FEHLER';
  const text = String(o.text || '').trim();
  if (text.length < 5 && kind !== 'ABSTURZ') throw new Error('Bitte beschreibe kurz, was passiert ist.');
  const parts = [`Art: ${kind}`, `Kontakt: ${String(o.contact || '-').slice(0, 100)}`, '', 'NACHRICHT', text.slice(0, 4000) || '(keine Beschreibung)', '', 'SYSTEM', sysText()];
  if (o.diag && hasGame(cfg.gameDir)) {
    try { const d = await tools.diagnose(cfg.gameDir, realmOf(), true); parts.push('', 'DIAGNOSE', ...d.map((x) => `[${x.level}] ${x.title} - ${x.detail}`)); } catch (e) { parts.push('', 'DIAGNOSE fehlgeschlagen: ' + e.message); }
  }
  if (o.crash && hasGame(cfg.gameDir)) { const c = tools.crashLatest(cfg.gameDir); if (c) parts.push('', 'LETZTE FEHLERDATEI ' + c.file + ' (' + c.time + ')', c.text.slice(0, 12000)); }
  if (o.log) parts.push('', 'LAUNCHER-LOG (letzte 120 Zeilen)', L.tail(120));
  await postJson(cfg.crashUrl, { username: session ? session.username : 'GAST', version: app.getVersion(), file: 'REPORT_' + kind, time: new Date().toISOString(), text: parts.join('\n').slice(0, 30000) });
  L.log('info', 'Bericht gesendet', kind);
  return true;
});
ipcMain.handle('win:autostart', (_e, on) => {
  cfg = { ...cfg, autostart: !!on }; cfgStore.save(cfg);
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath }); } catch (e) { L.log('error', 'autostart', e.message); throw new Error('Autostart konnte nicht gesetzt werden.'); }
  return true;
});
