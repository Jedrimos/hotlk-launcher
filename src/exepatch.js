// Home of the Lich King: eigene Login-Oberfläche (Nachname in Charaktererstellung/-wahl).
// Der WoW-Client prüft seine Login-Dateien (GlueXML) gegen eine Signatur und bricht bei Änderungen ab.
// Für unseren Realm legen wir deshalb lokal eine Kopie "Wow-HotLK.exe" an, in der diese Prüfung abgeschaltet ist.
// Die Original-Wow.exe bleibt unverändert; es wird nichts heruntergeladen. Passen die erwarteten Bytes nicht
// (anderer Client-Build), wird nicht gepatcht und der Launcher startet die normale Wow.exe ohne die Login-Dateien.
const fs = require('fs');
const path = require('path');

const PATCHES = [
  { va: 0x4da7e5, from: '83f8037734', to: '6a03589090' },     // Ergebnis der Signaturprüfung = "gültig"
  { va: 0x4da8eb, from: '0f852dffffff', to: '909090909090' }   // Hash-Vergleich der Login-Oberfläche überspringen
];
const fileOffset = (va) => va - 0x401000 + 0x400;               // .text von Wow.exe 3.3.5a (12340)

function patchBuffer(buf) {
  for (const p of PATCHES) {
    const o = fileOffset(p.va), len = p.from.length / 2;
    if (o + len > buf.length) return null;
    const cur = buf.subarray(o, o + len).toString('hex');
    if (cur === p.from) Buffer.from(p.to, 'hex').copy(buf, o);
    else if (cur !== p.to) return null;
  }
  return buf;
}

// Liefert den Pfad zur gepatchten Exe oder null, wenn sie nicht erzeugt werden kann.
function ensure(gameDir, log = () => {}) {
  const src = path.join(gameDir, 'Wow.exe');
  const dst = path.join(gameDir, 'Wow-HotLK.exe');
  try {
    const ss = fs.statSync(src);
    try { const ds = fs.statSync(dst); if (ds.size === ss.size && ds.mtimeMs >= ss.mtimeMs) return dst; } catch {}
    const buf = patchBuffer(fs.readFileSync(src));
    if (!buf) { log('warn', 'Wow-HotLK.exe', 'Wow.exe passt nicht zum erwarteten Client, kein Patch'); return null; }
    const tmp = dst + '.tmp';
    fs.writeFileSync(tmp, buf);
    try { fs.renameSync(tmp, dst); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} if (fs.existsSync(dst)) return dst; throw e; }
    log('info', 'Wow-HotLK.exe erzeugt');
    return dst;
  } catch (e) { log('warn', 'Wow-HotLK.exe', e.message); return null; }
}

module.exports = { ensure, patchBuffer, PATCHES };
