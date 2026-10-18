// Erzeugt manifest.json aus zwei Client-Ordnern.
//   node tools/make-manifest.js <NormalOrdner> <HDOrdner> <BasisURL> [Ausgabeordner]
// Beispiel:
//   node tools/make-manifest.js "E:\WoW-Normal" "E:\WoW-HD" https://wow.jedrimos.dedyn.io/launcher/files out
//
// Ergebnis im Ausgabeordner:
//   manifest.json          -> auf die Seite nach /launcher/manifest.json
//   files/normal/...      -> Normal-Client ohne Cache/WTF/Logs (Hardlinks, kein Extra-Platz)
//   files/hd/...          -> NUR die Dateien, die im HD-Client anders oder neu sind (Delta)
//   Hochladen: out\\manifest.json und out\\files auf den Server (siehe Anleitung).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [normalDir, hdDir, baseUrl, outDir = 'out'] = process.argv.slice(2);
if (!normalDir || !hdDir || !baseUrl) { console.error('Aufruf: node make-manifest.js <Normal> <HD> <BasisURL> [Ausgabe]'); process.exit(1); }

// Von Spiel/Launcher erzeugte Ordner, die nicht verteilt werden
const SKIP = /^(Cache|Logs|Errors|Screenshots|WTF|Data[\\/]_launcher)([\\/]|$)|\.part$|^(Thumbs\.db|desktop\.ini)$/i;

function walk(root, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (SKIP.test(r)) continue;
    if (e.isDirectory()) walk(root, r, out); else if (e.isFile()) out.push(r);
  }
  return out;
}
const sha = (f) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const url = (kind, rel) => `${baseUrl.replace(/\/$/, '')}/${kind}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;

(async () => {
  const nFiles = walk(normalDir), hFiles = walk(hdDir);
  console.log(`Normal: ${nFiles.length} Dateien, HD: ${hFiles.length} Dateien. Berechne Prüfsummen…`);
  const base = [], nHash = new Map();
  let i = 0;
  for (const rel of nFiles) {
    const f = path.join(normalDir, rel), size = fs.statSync(f).size, sum = await sha(f);
    nHash.set(rel, sum);
    // Normal-Client sauber (ohne Cache/WTF/Logs) bereitstellen: Hardlink, sonst Kopie
    const ln = path.join(outDir, 'files', 'normal', rel);
    fs.mkdirSync(path.dirname(ln), { recursive: true });
    try { fs.rmSync(ln, { force: true }); fs.linkSync(f, ln); } catch { fs.copyFileSync(f, ln); }
    base.push({ path: rel.split(path.sep).join('/'), url: url('normal', rel), size, sha256: sum });
    if (++i % 25 === 0) process.stdout.write(`\r  normal ${i}/${nFiles.length}`);
  }
  console.log();
  const delta = []; i = 0;
  for (const rel of hFiles) {
    const f = path.join(hdDir, rel), size = fs.statSync(f).size;
    const nsz = nHash.has(rel) ? fs.statSync(path.join(normalDir, rel)).size : -1;
    const sum = (nsz === size || nsz === -1) ? await sha(f) : null;
    if (nsz === size && sum === nHash.get(rel)) continue; // identisch -> kein Delta
    const s = sum || await sha(f);
    delta.push({ path: rel.split(path.sep).join('/'), url: url('hd', rel), size, sha256: s });
    const dst = path.join(outDir, 'files', 'hd', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(f, dst);
    if (++i % 25 === 0) process.stdout.write(`\r  hd ${i}`);
  }
  console.log();
  const removed = nFiles.filter(r => !hFiles.includes(r));
  const manifest = {
    version: 1,
    base: { name: 'WoW 3.3.5a (Normal)', files: base },
    packs: { hd: { name: 'HD-Pack', description: 'Hochauflösende Texturen und Modelle', files: delta } }
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const mb = (a) => (a.reduce((x, f) => x + f.size, 0) / 1e6).toFixed(0);
  console.log(`\nFertig. Basis: ${base.length} Dateien (${mb(base)} MB), HD-Delta: ${delta.length} Dateien (${mb(delta)} MB).`);
  if (removed.length) console.log(`Hinweis: ${removed.length} Dateien gibt es nur im Normal-Client (HD löscht nichts, werden ignoriert).`);
  console.log(`Ausgabe: ${path.resolve(outDir)}`);
})();
