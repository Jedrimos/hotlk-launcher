// Discord Rich Presence ueber die lokale Discord-IPC-Pipe (keine zusaetzliche Abhaengigkeit).
// Zeigt "Im Launcher" bzw. "Spielt in Azeroth", solange die Discord-App offen ist.
const net = require('net');
const L = require('./log');
const CLIENT_ID = '1561793111527522336';
const startedAt = Date.now();
let sock = null, ready = false, connecting = false, buf = Buffer.alloc(0), nonce = 0;
let timer = null, getRunning = null, playing = false, playSince = 0;

function frame(op, data) {
  const j = Buffer.from(JSON.stringify(data));
  const b = Buffer.alloc(8 + j.length);
  b.writeInt32LE(op, 0); b.writeInt32LE(j.length, 4); j.copy(b, 8);
  return b;
}
function activity() {
  return {
    details: playing ? 'Spielt in Azeroth' : 'Im Launcher',
    state: 'Home of the Lich King',
    assets: { large_image: 'logo', large_text: 'Home of the Lich King' },
    timestamps: { start: Math.floor((playing ? playSince : startedAt) / 1000) },
  };
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
async function tick() {
  try {
    const run = !!(await getRunning());
    if (run !== playing) { playing = run; if (run) playSince = Date.now(); push(); }
    if (!sock && !connecting) connect(0);
  } catch (e) { L.log('warn', 'presence', e && e.message); }
}
function start(runningFn) {
  getRunning = runningFn;
  if (timer) return;
  tick();
  timer = setInterval(tick, 15000);
}
function stop() { if (timer) clearInterval(timer); timer = null; try { if (sock) sock.destroy(); } catch {} }
module.exports = { start, stop };
