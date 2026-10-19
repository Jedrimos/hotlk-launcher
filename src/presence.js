// Discord Rich Presence ueber die lokale Discord-IPC-Pipe (keine zusaetzliche Abhaengigkeit).
// Zeigt "Im Launcher" bzw. "Spielt in Azeroth", solange die Discord-App offen ist.
const net = require('net');
const L = require('./log');
const CLIENT_ID = '1561793111527522336';
const startedAt = Date.now();
let sock = null, ready = false, connecting = false, buf = Buffer.alloc(0), nonce = 0;
let timer = null, getRunning = null, getAuth = null, playing = false, playSince = 0;
let info = null, lastInfoAt = 0, showName = true;
const CLASSES = { 1: 'Krieger', 2: 'Paladin', 3: 'J\u00e4ger', 4: 'Schurke', 5: 'Priester', 6: 'Todesritter', 7: 'Schamane', 8: 'Magier', 9: 'Hexenmeister', 11: 'Druide' };

function frame(op, data) {
  const j = Buffer.from(JSON.stringify(data));
  const b = Buffer.alloc(8 + j.length);
  b.writeInt32LE(op, 0); b.writeInt32LE(j.length, 4); j.copy(b, 8);
  return b;
}
function activity() {
  const a = {
    assets: { large_image: 'logo', large_text: 'Home of the Lich King' },
    buttons: [
      { label: 'Mitspielen', url: 'https://wow.jedrimos.dedyn.io/' },
      { label: 'Launcher laden', url: 'https://github.com/Jedrimos/hotlk-launcher/releases/latest' },
    ],
  };
  if (!playing) {
    a.details = 'Im Launcher'; a.state = 'Home of the Lich King';
    a.timestamps = { start: Math.floor(startedAt / 1000) };
  } else if (info && info.online) {
    a.details = (showName ? info.name + ' \u2013 ' : '') + 'Stufe ' + info.level + ' ' + (CLASSES[info.class] || '');
    a.state = info.zone || 'Azeroth';
    a.timestamps = { start: Math.floor(playSince / 1000) };
  } else {
    a.details = 'Spielt World of Warcraft';
    a.timestamps = { start: Math.floor(playSince / 1000) };
  }
  return a;
}
function push() {
  if (!sock || !ready) return;
  try { sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity() }, nonce: String(++nonce) })); } catch {}
}
function connect(i) {
  if (i > 9) { connecting = false; return; }
  connecting = true;
  let ok = false;
  const s = net.connect('\\\\?\\pipe\\discord-ipc-' + i);
  s.once('connect', () => { ok = true; sock = s; connecting = false; s.write(frame(0, { v: 1, client_id: CLIENT_ID })); });
  s.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 8) {
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) break;
      let msg = null;
      try { msg = JSON.parse(buf.slice(8, 8 + len).toString()); } catch {}
      buf = buf.slice(8 + len);
      if (msg && msg.evt === 'READY') { ready = true; push(); }
    }
  });
  s.on('error', () => { if (!ok) connect(i + 1); });
  s.on('close', () => { if (sock === s) { sock = null; ready = false; } connecting = false; });
}
async function fetchInfo() {
  const au = getAuth && getAuth();
  showName = !(au && au.showName === false);
  if (!au || !au.url || !au.username || !au.password) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(au.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: au.username, password: au.password }), signal: ctl.signal });
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch { return null; } finally { clearTimeout(t); }
}
async function tick() {
  try {
    const run = !!(await getRunning());
    let changed = false;
    if (run !== playing) { playing = run; if (run) playSince = Date.now(); if (!run) info = null; changed = true; }
    if (playing && Date.now() - lastInfoAt >= 60000) {
      lastInfoAt = Date.now();
      const n = await fetchInfo();
      if (JSON.stringify(n) !== JSON.stringify(info)) { info = n; changed = true; }
    }
    if (changed) push();
    if (!sock && !connecting) connect(0);
  } catch (e) { L.log('warn', 'presence', e && e.message); }
}
function start(runningFn, authFn) {
  getRunning = runningFn; getAuth = authFn;
  if (timer) return;
  tick();
  timer = setInterval(tick, 15000);
}
function stop() { if (timer) clearInterval(timer); timer = null; try { if (sock) sock.destroy(); } catch {} }
module.exports = { start, stop };
