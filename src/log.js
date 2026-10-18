const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const file = () => path.join(app.getPath('userData'), 'launcher.log');
function log(level, ...a) {
  try {
    const p = file();
    try { if (fs.statSync(p).size > 1e6) fs.renameSync(p, p + '.old'); } catch {}
    const msg = a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    fs.appendFileSync(p, `${new Date().toISOString()} [${level}] ${msg}\n`);
  } catch {}
}
function tail(n = 150) {
  try { return fs.readFileSync(file(), 'utf8').split('\n').filter(Boolean).slice(-n).join('\n'); } catch { return '(kein Log vorhanden)'; }
}
module.exports = { log, tail, file };
