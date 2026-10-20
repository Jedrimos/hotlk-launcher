const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB');
const CLASSES = { druid: ['Druide', '#ff7d0a'], hunter: ['Jäger', '#abd473'], mage: ['Magier', '#69ccf0'], paladin: ['Paladin', '#f58cba'], priest: ['Priester', '#ffffff'], rogue: ['Schurke', '#fff569'], shaman: ['Schamane', '#0070de'], warlock: ['Hexenmeister', '#9482c9'], warrior: ['Krieger', '#c79c6e'], deathknight: ['Todesritter', '#c41f3b'] };

let cfg, st = null, session = null, busy = false, running = false;
let addonsInst = [], addonsCat = [], aSub = 'inst', aClass = '', realmInfo = [], updIds = [];

// ---------- Sprache ----------
const I18N = {
  en: { 'tab.news': 'News', 'tab.server': 'Server', 'tab.addons': 'Addons', 'tab.tools': 'Tools', 'tab.settings': 'Settings', 'play.play': 'PLAY', 'play.install': 'INSTALL GAME', 'play.update': 'UPDATE GAME', 'play.packs': 'DOWNLOAD PACK', 'play.running': 'GAME RUNNING', 'play.retry': 'RETRY', 'acct': 'Sign in', 'lbl.server': 'Server', 'lbl.gfx': 'Graphics' }
};
const t = (k, de) => (cfg?.lang === 'en' && I18N.en[k]) || de;
function applyLang() {
  document.documentElement.lang = cfg.lang || 'de';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.dataset.de = el.dataset.de || el.textContent; el.textContent = t(el.dataset.i18n, el.dataset.de); });
  const ls = document.querySelectorAll('.sel label'); if (ls[0]) ls[0].textContent = t('lbl.server', 'Server'); if (ls[1]) ls[1].textContent = t('lbl.gfx', 'Grafik');
  renderPlay(); renderAuthChips();
}

// ---------- Hilfen ----------
let toastT;
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), err ? 9000 : 4000); }
const fail = (e) => toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
function setBusy(b) { busy = b; $('prog').hidden = !b; renderPlay(); }
function showProg(text, done, total) { $('prog').hidden = false; $('progTxt').textContent = text; $('progBar').style.width = total ? Math.min(100, (done / total) * 100) + '%' : '0%'; }

// ---------- Tabs ----------
document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => {
  const hub = ['settings', 'tools', 'help'].includes(b.dataset.tab);
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b || (hub && x.dataset.tab === 'settings')));
  document.querySelectorAll('.snav button').forEach((x) => x.classList.toggle('on', x.dataset.go === b.dataset.tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + b.dataset.tab));
  if (b.dataset.tab === 'addons') loadAddons();
  if (b.dataset.tab === 'server') loadServer();
  if (b.dataset.tab === 'cal' && typeof loadCal === 'function') loadCal();
  if (b.dataset.tab === 'tools') loadTools();
  if (b.dataset.tab === 'help') loadHelp();
  if (b.dataset.tab === 'admin') loadAdmin();
  if (b.dataset.tab === 'settings') renderSettings();
});
document.querySelectorAll('.subtabs button').forEach((b) => b.onclick = () => {
  aSub = b.dataset.sub;
  document.querySelectorAll('.subtabs button').forEach((x) => x.classList.toggle('on', x === b));
  renderAddons();
});
$('min').onclick = () => api.minimize();
$('close').onclick = () => api.close();

// ---------- Start ----------
async function init() {
  cfg = await api.getConfig();
  api.onProgress((p) => showProg(`${p.id === 'base' ? 'Spiel' : p.id}: ${gb(p.done)} / ${gb(p.total)} · ${gb(p.speed)}/s`, p.done, p.total));
  api.onAddonProgress((p) => showProg(p.phase === 'download' ? `Addon laden … ${p.total ? gb(p.done) + ' / ' + gb(p.total) : ''}` : p.phase === 'extract' ? 'Entpacke …' : 'Installiere …', p.done, p.total));
  api.onPhase((t) => showProg(t, 0, 0));
  fillRealms(); renderAuthChips();
  api.onData((n, d) => { if (n === 'news') renderNews(d); if (n === 'serverinfo') { refreshBanner(); if (typeof calSrv !== 'undefined') calSrv = ((d && d.events) || []).filter((e) => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '')); if (typeof renderToday === 'function') renderToday(); if (typeof renderCal === 'function' && $('v-cal').classList.contains('on')) renderCal(); } if (n === 'serverinfo' && $('v-server').classList.contains('on')) loadServer(); if (n === 'serverinfo' && typeof loadCal === 'function' && $('v-cal').classList.contains('on')) loadCal(); });
  api.restore().then((r) => { if (r?.session) { session = r.session; renderAuthChips(); greet(); } if (r?.user) $('lUser').value = r.user; });
  loadNews(); refreshStatus(); refreshRealms(); checkLauncher();
  setInterval(refreshRealms, 60000); setInterval(() => { api.news(); api.serverInfo(); }, 180000); setInterval(checkLauncher, 1800000); setInterval(async () => { running = await api.isRunning(); renderPlay(); }, 5000);
  api.isRunning().then((r) => { running = r; renderPlay(); });
  if (!cfg.gameDir) { const d = await api.detectGames(); if (d.length) { await api.setGame(d[0].dir); cfg = await api.getConfig(); } }
  await refreshStatus();
  if (!cfg.welcomeSeen) $('welcome').hidden = false;
}

// ---------- Willkommen ----------
function greet() {
  if (session) { $('heroTitle').textContent = `Willkommen daheim, ${session.username}!`; $('wTitle').textContent = `Willkommen, ${session.username}!`; }
}
const openReg = () => { api.openUrl(cfg.siteUrl + 'register'); toast('Registrierung im Browser geöffnet. Danach hier anmelden.'); };
$('lReg').onclick = (e) => { e.preventDefault(); openReg(); };
$('wReg').onclick = openReg;
$('wGo').onclick = async () => { $('welcome').hidden = true; cfg = await api.setConfig({ welcomeSeen: true }); };
$('welcomeBtn').onclick = () => { $('welcome').hidden = false; };

// ---------- News ----------
async function loadNews() { renderNews(await api.news()); }
// News-Bild laden; bei Fehler (Netz noch nicht bereit, Server kurz weg) mehrfach neu versuchen
function loadNewsImg(el, url, n) {
  const im = new Image();
  im.onload = () => { el.classList.remove('none'); el.innerHTML = ''; el.style.backgroundImage = `url('${url}')`; };
  im.onerror = () => { if (n < 5 && el.isConnected) setTimeout(() => loadNewsImg(el, url, n + 1), 3000 * (n + 1)); };
  im.src = n ? url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now() : url;
}
function renderNews(list) {
  const box = $('newsList');
  if (!Array.isArray(list) || !list.length) { box.innerHTML = '<div class="empty">Keine Neuigkeiten erreichbar.</div>'; return; }
  const abs = (u) => { try { return new URL(u, cfg.siteUrl).href; } catch { return ''; } };
  box.innerHTML = list.map((n, i) => {
    const img = abs(n.image || n.image_url || '');
    const text = n.text || n.content || n.summary || '';
    return `<article class="news" data-i="${i}" style="cursor:${n.url ? 'pointer' : 'default'}">
      <div class="img none"${img ? ` data-src="${esc(img)}"` : ''}><img src="assets/logo.png" alt=""></div>
      <div class="body"><div class="meta">${n.category ? `<span class="tag">${esc(n.category)}</span>` : ''}<span>${esc(n.date || '')}</span></div>
      <h3>${esc(n.title)}</h3><p>${esc(String(text).slice(0, 320))}</p>${n.url ? '<div class="more">Weiterlesen ›</div>' : ''}</div></article>`;
  }).join('');
  box.querySelectorAll('.img[data-src]').forEach((el) => loadNewsImg(el, el.dataset.src, 0));
  box.querySelectorAll('.news').forEach((el) => el.onclick = () => { const u = list[el.dataset.i].url; if (u) api.openUrl(abs(u)); });
}

// ---------- Status / Banner ----------
let lastVer = null;
async function checkLauncher() {
  const v = await api.launcherVersion();
  $('about').textContent = `Launcher ${v.current}` + (v.latest ? ` · aktuell: ${v.latest}` : '');
  lastVer = v;
  const vb = $('verBadge');
  vb.textContent = v.newer ? `v${v.current} → v${v.latest} ⬆` : `v${v.current}`;
  vb.classList.toggle('upd', !!v.newer);
  $('aUpd').textContent = v.newer ? 'Jetzt auf ' + v.latest + ' aktualisieren' : 'Nach Updates suchen';
  vb.title = v.newer ? 'Neue Version verfügbar, klicken zum Aktualisieren' : (v.latest ? 'Launcher ist aktuell' : 'Launcher-Version');
  vb.onclick = () => { if (v.newer) $('banner').click(); else toast(v.latest ? 'Du hast die neueste Version (' + v.current + ').' : 'Version ' + v.current); };
  if (v.newer) { const b = $('banner'); b.hidden = false; b.textContent = `Neue Launcher-Version ${v.latest} verfügbar – hier klicken zum automatischen Update.`; b.onclick = async () => { b.textContent = 'Lade Update …'; api.onUpdateProgress((p) => { b.textContent = 'Lade Update … ' + (p.total ? Math.round(p.done / p.total * 100) + ' %' : gb(p.done)); }); try { await api.updateLauncher(); } catch (e) { b.textContent = 'Update fehlgeschlagen.'; fail(e); } }; }
}
function fillRealms() {
  $('realmSel').innerHTML = cfg.realms.map((r, i) => {
    const s = realmInfo[i];
    const tail = !s ? '' : !s.up ? ' · offline' : s.online != null ? ` · ${s.online} online` : ' · erreichbar';
    return `<option value="${i}" ${i === cfg.selectedRealm ? 'selected' : ''}>${esc(r.name)}${tail}</option>`;
  }).join('');
}
async function refreshRealms() {
  try { realmInfo = await api.realmStatus(); } catch { realmInfo = []; }
  fillRealms();
  const s = realmInfo[cfg.selectedRealm];
  $('srv').querySelector('.dot').className = 'dot ' + (s ? (s.up ? 'up' : 'down') : '');
  { const w = $('playWarn'); if (w) w.hidden = !(s && !s.up); }
  $('srvTxt').textContent = !s ? '…' : !s.up ? 'Offline' : s.online != null ? `${s.online} online` : 'Online';
}
$('realmSel').onchange = async () => { cfg = await api.setConfig({ selectedRealm: +$('realmSel').value }); refreshRealms(); await refreshStatus(); };

// ---------- Konto ----------
function renderAuthChips() {
  $('acct').textContent = session ? '👤 ' + session.username + ' ▾' : t('acct', 'Anmelden') + ' ▾';
  $('admTab').hidden = !(session && (session.gmlevel || 0) >= 3);
  $('aInfo').textContent = session ? `Angemeldet als ${session.username}` : 'Nicht angemeldet.';
  $('optAuto').checked = !!cfg.autoLogin;
  $('optPb').checked = cfg.pbAddons !== false;
  renderAccounts();
}
$('acct').onclick = async (e) => {
  e.stopPropagation();
  const m = $('acctMenu');
  if (!m.hidden) { m.hidden = true; return; }
  let list = []; try { list = await api.accounts(); } catch {}
  if (!session && !list.length) return openLogin();
  m.innerHTML = list.map((a) => { const cur = session && session.username.toLowerCase() === a.u.toLowerCase(); return `<button data-u="${esc(a.u)}" class="${cur ? 'cur' : ''}">${cur ? '✓' : '👤'} ${esc(a.u)}${a.saved ? '' : ' <span class="hint">neu anmelden</span>'}</button>`; }).join('')
    + (list.length ? '<div class="sep"></div>' : '') + '<button data-act="add">＋ Anderes Konto hinzufügen</button><button data-act="reg">Neuen Account erstellen ↗</button>' + (session ? '<button data-act="out">Abmelden</button>' : '');
  m.hidden = false;
  m.querySelectorAll('[data-u]').forEach((b) => b.onclick = async () => {
    m.hidden = true;
    const a = list.find((x) => x.u === b.dataset.u);
    if (session && session.username.toLowerCase() === a.u.toLowerCase()) return;
    if (!a.saved) { $('lUser').value = a.u; $('lPass').value = ''; return openLogin(); }
    try { session = await api.switchAccount(a.u); renderAuthChips(); greet(); toast('Gewechselt zu ' + session.username); } catch (er) { fail(er); }
  });
  m.querySelector('[data-act=add]').onclick = () => { m.hidden = true; $('lUser').value = ''; $('lPass').value = ''; openLogin(); };
  m.querySelector('[data-act=reg]').onclick = () => { m.hidden = true; openReg(); };
  const o = m.querySelector('[data-act=out]'); if (o) o.onclick = async () => { m.hidden = true; await api.logout(); session = null; renderAuthChips(); $('heroTitle').textContent = 'Willkommen daheim'; };
};
document.addEventListener('click', () => { $('acctMenu').hidden = true; });
$('aOpen').onclick = openLogin;
function openLogin() { $('lErr').textContent = ''; $('loginM').hidden = false; ($('lUser').value ? $('lPass') : $('lUser')).focus(); }
$('lCancel').onclick = () => ($('loginM').hidden = true);
$('lGo').onclick = async () => {
  $('lErr').textContent = ''; $('lGo').disabled = true;
  try { session = await api.login($('lUser').value, $('lPass').value, $('lRem').checked); $('lPass').value = ''; $('loginM').hidden = true; renderAuthChips(); greet(); toast('Angemeldet als ' + session.username); }
  catch (e) { $('lErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  $('lGo').disabled = false;
};
$('lPass').onkeydown = (e) => { if (e.key === 'Enter') $('lGo').click(); };
$('aOut').onclick = async () => { await api.logout(); session = null; renderAuthChips(); $('heroTitle').textContent = 'Willkommen daheim'; };
$('optAuto').onchange = async () => { cfg = await api.setConfig({ autoLogin: $('optAuto').checked }); };
$('optPb').onchange = async () => { cfg = await api.setConfig({ pbAddons: $('optPb').checked }); };
$('optCache').onchange = async () => { cfg = await api.setConfig({ clearCacheOnSwitch: $('optCache').checked }); };
$('siteBtn').onclick = () => api.openUrl(cfg.siteUrl);

async function renderAccounts() {
  let list = []; try { list = await api.accounts(); } catch {}
  $('accList').innerHTML = list.map((a) => `<div class="li"><div class="t">👤 ${esc(a.u)}${session && session.username.toLowerCase() === a.u.toLowerCase() ? ' <span class="b ok">aktiv</span>' : ''}${a.saved ? '' : ' <span class="b">kein Passwort gespeichert</span>'}</div><button data-sw="${esc(a.u)}">Wechseln</button><button data-fg="${esc(a.u)}">Vergessen</button></div>`).join('');
  $('accList').querySelectorAll('[data-sw]').forEach((b) => b.onclick = async () => { try { session = await api.switchAccount(b.dataset.sw); renderAuthChips(); greet(); toast('Gewechselt zu ' + session.username); } catch (e) { fail(e); } });
  $('accList').querySelectorAll('[data-fg]').forEach((b) => b.onclick = async () => { await api.forgetAccount(b.dataset.fg); renderAccounts(); });
}
$('aOpen').textContent = 'Konto hinzufügen / anmelden';

// ---------- Pack-/Spielstatus ----------
const installed = () => st?.game?.installed;
const baseOk = () => !st?.base || st.base.complete;
const gfxPacks = () => Object.entries(st?.manifest?.packs || {}).filter(([id, p]) => p.kind !== 'server' && st.packs?.[id]?.allowed !== false);
const serverPacks = () => Object.entries(st?.manifest?.packs || {}).filter(([id, p]) => (p.kind === 'server' || (p.realms && !p.kind)) && st.packs?.[id]?.allowed);

async function refreshStatus() {
  try { st = await api.packStatus(); } catch (e) { st = { error: String(e.message || e) }; }
  // gewählte Grafik nur behalten, wenn es sie gibt
  // Auswahl nur verwerfen, wenn die Pack-Liste da ist und das Pack dort wirklich nicht (mehr) existiert; bei Netzfehler/anderem Realm bleibt sie erhalten
  if (cfg.activePack !== 'none' && st?.manifest?.packs && !st.manifest.packs[cfg.activePack]) { cfg = await api.setConfig({ activePack: 'none' }); }
  $('packSel').innerHTML = '<option value="none">Normal (Original)</option>' + gfxPacks().map(([id, p]) => {
    const s = st.packs?.[id];
    const tag = !s ? '' : s.installed ? (s.outdated ? ' · Update' : ' · bereit') : s.partial ? ' · unvollständig' : ` · ${gb(s.totalSize)} laden`;
    return `<option value="${id}" ${cfg.activePack === id ? 'selected' : ''}>${esc(p.name || id)}${tag}</option>`;
  }).join('');
  const notes = [];
  if (serverPacks().length) notes.push('Server-Patch für diesen Realm wird automatisch genutzt.');
  else if (Object.values(st?.manifest?.packs || {}).some((p) => p.kind === 'server')) notes.push('Server-Patches sind hier aus (anderer Realm).');
  if (st?.offline) notes.push('Offline: gespeicherte Pack-Liste.');
  $('note').textContent = notes.join(' ');
  renderPlay(); renderSettings();
}
$('packSel').onchange = async () => { cfg = await api.setConfig({ activePack: $('packSel').value }); renderPlay(); };

// Was muss vor dem Spielen noch geladen werden?
function todo() {
  if (!st || st.error) return { kind: 'error' };
  if (!installed() || st.needGame) return { kind: 'install', label: 'SPIEL INSTALLIEREN' };
  if (!baseOk()) return { kind: 'base', label: 'SPIEL AKTUALISIEREN' };
  const ids = [...serverPacks().map(([id]) => id)];
  if (cfg.activePack !== 'none') ids.push(cfg.activePack);
  const miss = ids.filter((id) => !st.packs?.[id]?.installed || st.packs[id].outdated);
  if (miss.length) return { kind: 'packs', ids: miss, label: 'PACK LADEN' };
  return { kind: 'play', label: 'SPIELEN' };
}
function renderPlay() {
  const b = $('play'), td = todo();
  b.disabled = busy;
  const K = { install: ['play.install', 'SPIEL INSTALLIEREN'], base: ['play.update', 'SPIEL AKTUALISIEREN'], packs: ['play.packs', 'PACK LADEN'], play: ['play.play', 'SPIELEN'], error: ['play.retry', 'NEU VERSUCHEN'] }[td.kind];
  b.textContent = running && td.kind === 'play' ? t('play.running', 'SPIEL LÄUFT') : t(K[0], K[1]);
  if (running && td.kind === 'play') b.disabled = true;
}
$('play').onclick = async () => {
  if (busy) return;
  const t = todo();
  try {
    if (t.kind === 'error') { await refreshStatus(); return; }
    if (t.kind === 'install' || t.kind === 'base') {
      if (!cfg.gameDir) { const d = await api.defaultTarget(); await api.setGame(d); cfg = await api.getConfig(); }
      setBusy(true); await api.syncBase(false); toast('Spiel ist bereit.');
    } else if (t.kind === 'packs') {
      setBusy(true); for (const id of t.ids) await api.download(id); toast('Pack geladen.');
    } else {
      const pf = await api.preflight();
      if (pf.errors.length) { toast(pf.errors[0], true); return; }
      if (pf.warnings.length && !confirm(pf.warnings.join('\n\n') + '\n\nTrotzdem starten?')) return;
      setBusy(true); showProg('Starte …', 0, 0); await api.play(); running = true; toast('Viel Spaß!');
    }
  } catch (e) { if (!/abbruch|abgebrochen|abort/i.test(String(e))) fail(e); else toast('Abgebrochen.'); }
  finally { setBusy(false); await refreshStatus(); running = await api.isRunning(); renderPlay(); }
};
$('cancel').onclick = () => api.cancel();

// ---------- Addons ----------
async function loadAddons() {
  const ok = installed();
  $('addonNoGame').hidden = ok; $('addonBar').hidden = !ok; $('classBar').hidden = !ok || aSub !== 'cat'; $('addonList').hidden = !ok;
  if (!ok) return;
  try { [addonsInst, addonsCat] = await Promise.all([api.addonsInstalled(), api.addonCatalog()]); } catch (e) { fail(e); }
  const cats = [...new Set(addonsCat.map((a) => a.cat))];
  $('aCat').innerHTML = '<option value="">Alle Kategorien</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  $('classBar').innerHTML = `<button class="cls on" data-c="">Alle Klassen</button>` + Object.entries(CLASSES).map(([k, [n, c]]) => `<button class="cls" data-c="${k}" style="--c:${c}">${n}</button>`).join('');
  $('classBar').querySelectorAll('.cls').forEach((b) => b.onclick = () => { aClass = b.dataset.c; $('classBar').querySelectorAll('.cls').forEach((x) => x.classList.toggle('on', x === b)); renderAddons(); });
  aClass = ''; renderAddons();
  api.addonUpdates().then((u) => { updIds = u || []; if (updIds.length) { toast(updIds.length + ' Addon-Update(s) verfügbar (im Katalog).'); renderAddons(); } }).catch(() => {});
}
['aSearch', 'aCat', 'aMods'].forEach((id) => ($(id).oninput = renderAddons));
function renderAddons() {
  if (!installed()) return;
  $('classBar').hidden = aSub !== 'cat'; $('aCat').hidden = aSub !== 'cat'; $('aModWrap').hidden = aSub !== 'inst';
  const q = $('aSearch').value.trim().toLowerCase();
  const vis = addonsInst.filter((a) => !a.module);
  $('cntInst').textContent = vis.length ? `(${vis.length})` : '';
  const box = $('addonList');
  if (aSub === 'inst') {
    const list = addonsInst.filter((a) => ($('aMods').checked || !a.module) && (!q || (a.title + a.name + a.notes).toLowerCase().includes(q)));
    box.innerHTML = list.length ? list.map((a) => `<div class="addon ${a.enabled ? '' : 'off'}"><div class="t"><div class="n">${esc(a.title)}</div><div class="d">${esc(a.notes) || '&nbsp;'}</div><div class="badges">${a.version ? `<span class="b">v${esc(a.version)}</span>` : ''}${a.author ? `<span class="b">${esc(a.author)}</span>` : ''}${a.module ? '<span class="b">Modul</span>' : ''}${a.incompatible ? '<span class="b" style="color:var(--bad)">Nicht für 3.3.5a</span>' : ''}</div></div>
      <button class="sw ${a.enabled ? 'on' : ''}" data-tog="${esc(a.name)}" title="${a.enabled ? 'Deaktivieren' : 'Aktivieren'}"></button><button data-rm="${esc(a.name)}">Entfernen</button></div>`).join('')
      : '<div class="empty">Noch keine Addons installiert. Im Katalog findest du viele beliebte.</div>';
    box.querySelectorAll('[data-tog]').forEach((b) => b.onclick = async () => { const a = addonsInst.find((x) => x.name === b.dataset.tog); try { await api.addonToggle(a.name, !a.enabled); await loadAddons(); } catch (e) { fail(e); } });
    box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => { if (!confirm(`"${b.dataset.rm}" wirklich entfernen?`)) return; try { await api.addonRemove(b.dataset.rm); await loadAddons(); } catch (e) { fail(e); } });
  } else {
    const cat = $('aCat').value;
    const list = addonsCat.filter((a) => (!cat || a.cat === cat) && (!aClass || !a.classes.length || a.classes.includes(aClass)) && (!q || (a.name + a.desc).toLowerCase().includes(q)));
    box.innerHTML = list.map((a) => `<div class="addon"><div class="t"><div class="n">${esc(a.name)}</div><div class="d">${esc(a.desc)}${a.note ? ' – ' + esc(a.note) : ''}</div><div class="badges"><span class="b">${esc(a.cat)}</span>${a.rec ? '<span class="b rec">★ Empfohlen</span>' : ''}${a.classes.map((c) => `<span class="b" style="color:${CLASSES[c][1]}">${CLASSES[c][0]}</span>`).join('')}${a.installed ? '<span class="b ok">✓ installiert</span>' : ''}${updIds.includes(a.id) ? '<span class="b rec">Update verfügbar</span>' : ''}</div></div>
      <button data-site="${esc(a.site || '')}" title="Seite des Addons im Browser öffnen">Mehr Infos ↗</button><button data-in="${a.id}" ${a.installed && !updIds.includes(a.id) ? '' : 'class="primary"'}>${updIds.includes(a.id) ? 'Aktualisieren' : a.installed ? 'Neu installieren' : 'Installieren'}</button></div>`).join('') || '<div class="empty">Nichts gefunden.</div>';
    box.querySelectorAll('[data-site]').forEach((b) => b.onclick = () => b.dataset.site && api.openUrl(b.dataset.site));
    box.querySelectorAll('[data-in]').forEach((b) => b.onclick = async () => {
      if (busy) return;
      setBusy(true);
      try { const n = await api.addonInstall(b.dataset.in); toast('Installiert: ' + n.join(', ')); await loadAddons(); } catch (e) { fail(e); }
      setBusy(false);
    });
  }
}

// ---------- Einstellungen ----------
function renderSettings() {
  if (!cfg) return;
  const g = st?.game;
  $('gDir').textContent = g?.dir || 'Noch kein Ordner gewählt';
  $('gMeta').textContent = g ? (g.installed ? `Spiel gefunden · Laufwerk ${g.drive}` : 'Hier ist noch kein Spiel (wird beim Installieren angelegt)') + (g.free != null ? ` · ${gb(g.free)} frei` : '') : '';
  $('bMeta').textContent = !st?.base ? '–' : st.base.complete ? `Alle ${st.base.files} Dateien vorhanden.` : `${st.base.missingFiles} Dateien fehlen (${gb(st.base.missingSize)}).`;
  $('optCache').checked = !!cfg.clearCacheOnSwitch;
  $('optAfter').value = cfg.afterLaunch || 'keep'; $('optBoot').checked = !!cfg.autostart; $('optDcLoc').checked = cfg.discordLocation !== false; $('optDcName').checked = cfg.discordName !== false;
  const pk = st?.manifest?.packs || {};
  $('packList').innerHTML = Object.entries(pk).map(([id, p]) => {
    const s = st.packs?.[id];
    const state = !s ? '' : s.installed ? (s.outdated ? 'Update verfügbar' : '✓ geladen') : s.partial ? 'unvollständig' : 'nicht geladen';
    const scope = p.kind === 'server' || p.realms ? ' · nur eigener Server' : '';
    return `<div class="li"><div class="t"><b>${esc(p.name || id)}</b><div class="muted">${esc(p.description || '')} · ${gb(s?.totalSize || 0)} · ${state}${scope}</div></div>
      ${s?.installed && !s.outdated ? `<button data-rmp="${id}">Löschen</button>` : `<button data-dlp="${id}">${s?.outdated ? 'Aktualisieren' : 'Laden'}</button>`}</div>`;
  }).join('') || '<div class="muted">Keine Packs verfügbar.</div>';
  $('packList').querySelectorAll('[data-dlp]').forEach((b) => b.onclick = async () => { if (busy || !installed()) return toast('Bitte zuerst das Spiel installieren.', true); setBusy(true); try { await api.download(b.dataset.dlp); } catch (e) { fail(e); } setBusy(false); refreshStatus(); });
  $('packList').querySelectorAll('[data-rmp]').forEach((b) => b.onclick = async () => { if (confirm('Pack vom PC löschen?')) { try { await api.removePack(b.dataset.rmp); } catch (e) { fail(e); } refreshStatus(); } });
  $('realmList').innerHTML = cfg.realms.map((r, i) => `<div class="li"><div class="t"><b>${esc(r.name)}</b><div class="muted">${esc(r.realmlist)}${r.key === 'home' ? ' · eigener Server' : ''}</div></div>${r.key === 'home' ? '' : `<button data-rr="${i}">Entfernen</button>`}</div>`).join('');
  $('realmList').querySelectorAll('[data-rr]').forEach((b) => b.onclick = async () => { const r = cfg.realms.filter((_, i) => i !== +b.dataset.rr); cfg = await api.setConfig({ realms: r, selectedRealm: 0 }); fillRealms(); renderSettings(); refreshRealms(); });
}
$('rAdd').onclick = async () => {
  const name = $('rName').value.trim(), host = $('rHost').value.trim();
  if (!name || !/^[\w.-]+(:\d+)?$/.test(host)) return toast('Bitte Name und gültige Adresse eingeben.', true);
  cfg = await api.setConfig({ realms: [...cfg.realms, { name, realmlist: host }] }); $('rName').value = $('rHost').value = ''; fillRealms(); renderSettings(); refreshRealms();
};
$('gPick').onclick = async () => { const d = await api.pickGame(); if (d) { cfg = await api.getConfig(); await refreshStatus(); } };
$('gDetect').onclick = async () => {
  $('gFound').innerHTML = '<div class="muted">Suche läuft …</div>';
  const r = await api.detectGames();
  $('gFound').innerHTML = r.length ? r.map((x) => `<div class="it" data-d="${esc(x.dir)}">${esc(x.dir)}${x.free != null ? ' · ' + gb(x.free) + ' frei' : ''}</div>`).join('') : '<div class="muted">Kein Spiel gefunden.</div>';
  $('gFound').querySelectorAll('.it').forEach((e) => e.onclick = async () => { await api.setGame(e.dataset.d); cfg = await api.getConfig(); $('gFound').innerHTML = ''; await refreshStatus(); });
};
const syncRun = (deep) => async () => { if (busy) return; setBusy(true); try { if (!cfg.gameDir) { await api.setGame(await api.defaultTarget()); cfg = await api.getConfig(); } await api.syncBase(deep); toast('Fertig.'); } catch (e) { fail(e); } setBusy(false); refreshStatus(); };
$('bSync').onclick = syncRun(false);
$('bDeep').onclick = syncRun(true);

// ---------- Server-Reiter ----------
const CLS_ID = { 1: 'warrior', 2: 'paladin', 3: 'hunter', 4: 'rogue', 5: 'priest', 6: 'deathknight', 7: 'shaman', 8: 'mage', 9: 'warlock', 11: 'druid' };
const RACE = { 1: 'Mensch', 2: 'Orc', 3: 'Zwerg', 4: 'Nachtelf', 5: 'Untoter', 6: 'Taure', 7: 'Gnom', 8: 'Troll', 10: 'Blutelf', 11: 'Draenei' };
async function refreshBanner() {
  const i = await api.serverInfo();
  const bn = $('srvBanner'), b = i?.banner;
  if (b && b.text && (!b.until || b.until * 1000 > Date.now())) { bn.hidden = false; bn.className = 'banner ' + (b.level === 'warn' ? 'warn' : 'info'); bn.textContent = (b.level === 'warn' ? '⚠ ' : 'ℹ ') + b.text; } else bn.hidden = true;
  return i;
}
async function loadServer() {
  const i = await refreshBanner();
  if (i) {
    $('siName').textContent = i.name || 'Server'; $('siTag').textContent = i.tagline || '';
    $('siRates').innerHTML = Object.entries(i.rates || {}).map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
    $('siMeta').textContent = [i.patch && 'Client ' + i.patch, i.restart && 'Neustart: ' + i.restart].filter(Boolean).join(' · ');
    $('siRules').innerHTML = (i.rules || []).map((r) => `<li>${esc(r)}</li>`).join('');
    $('siEvents').innerHTML = (i.events || []).length ? i.events.map((e) => `<div class="li"><div class="t"><b>${esc(e.title)}</b><div class="muted">${esc(e.date || '')} ${esc(e.text || '')}</div></div></div>`).join('') : 'Keine Ereignisse geplant.';
    $('siDiscord').hidden = !i.discord; $('siDiscord').onclick = () => api.openUrl(i.discord);
  }
  $('siSite').onclick = () => api.openUrl(cfg.siteUrl);
  const p = await api.players();
  const list = p?.players || [];
  $('plCount').textContent = p ? `(${list.length})` : '';
  $('plList').innerHTML = p ? (list.length ? list.map((x) => { const k = CLS_ID[x.class]; const c = k ? CLASSES[k] : ['?', '#ccc']; return `<div class="pl"><span class="lv">${x.level}</span><span class="nm" style="color:${c[1]}">${esc(x.name)}</span><span class="muted">${esc(RACE[x.race] || '')} ${esc(c[0])}</span></div>`; }).join('') : '<div class="muted">Gerade ist niemand online.</div>') : '<div class="muted">Liste nicht erreichbar.</div>';
}

// ---------- Werkzeuge-Reiter ----------
const RES = ['1280x720', '1366x768', '1600x900', '1920x1080', '2560x1440', '3840x2160'];
async function loadTools() {
  $('spLim').value = String(cfg.speedLimitMbit || 0); $('dcId').value = cfg.discordClientId || ''; $('lang').value = cfg.lang || 'de';
  if (!installed()) { $('dgList').innerHTML = '<div class="muted">Verfügbar, sobald das Spiel installiert ist.</div>'; return; }
  try {
    const g = await api.gfxGet();
    $('gxRes').innerHTML = [...new Set([...(g.gxResolution ? [g.gxResolution] : []), ...RES])].map((r) => `<option>${r}</option>`).join(''); if (g.gxResolution) $('gxRes').value = g.gxResolution;
    $('gxQ').innerHTML = [['1', 'Niedrig'], ['3', 'Mittel'], ['5', 'Hoch'], ['7', 'Sehr hoch'], ['10', 'Ultra']].map(([v, n]) => `<option value="${v}">${n}</option>`).join(''); if (g.graphicsQuality) $('gxQ').value = [1, 3, 5, 7, 10].reduce((a, b) => (Math.abs(b - g.graphicsQuality) < Math.abs(a - g.graphicsQuality) ? b : a)).toString();
    $('gxFar').innerHTML = [['177', 'Nah'], ['400', 'Mittel'], ['800', 'Weit'], ['1277', 'Maximal']].map(([v, n]) => `<option value="${v}">${n}</option>`).join(''); if (g.farclip) $('gxFar').value = [177, 400, 800, 1277].reduce((a, b) => (Math.abs(b - g.farclip) < Math.abs(a - g.farclip) ? b : a)).toString();
    $('gxWin').value = g.gxWindow === '1' ? '1' : '0'; $('gxMus').value = g.Sound_EnableMusic === '0' ? '0' : '1';
  } catch (e) { fail(e); }
  loadBackups(); runDiag();
  try { const c = await api.crashLatest(); $('crInfo').textContent = c ? `Letzter Bericht: ${c.file} (${new Date(c.time).toLocaleString('de-DE')})` : 'Keine Absturzberichte vorhanden. Gut so!'; $('crSend').disabled = !c; } catch {}
}
$('gxSave').onclick = async () => { try { await api.gfxSet({ gxResolution: $('gxRes').value, graphicsQuality: $('gxQ').value, farclip: $('gxFar').value, gxWindow: $('gxWin').value, gxMaximize: $('gxWin').value === '1' ? '1' : '0', Sound_EnableMusic: $('gxMus').value }); toast('Grafik gespeichert.'); } catch (e) { fail(e); } };
async function loadBackups() {
  let l = []; try { l = await api.backups(); } catch {}
  $('bkList').innerHTML = l.length ? l.map((b) => `<div class="li"><div class="t">${esc(b.name.replace(/_/g, ' '))}<div class="muted">${gb(b.size)}</div></div><button data-br="${esc(b.name)}">Wiederherstellen</button><button data-bd="${esc(b.name)}">Löschen</button></div>`).join('') : '<div class="muted">Noch keine Sicherung.</div>';
  $('bkList').querySelectorAll('[data-br]').forEach((x) => x.onclick = async () => { if (!confirm('Aktuelle Einstellungen durch diese Sicherung ersetzen? (Vorher wird automatisch gesichert.)')) return; try { x.disabled = true; x.textContent = 'Stelle wieder her …'; await api.backupRestore(x.dataset.br); toast('Wiederhergestellt.'); loadBackups(); } catch (e) { fail(e); } });
  $('bkList').querySelectorAll('[data-bd]').forEach((x) => x.onclick = async () => { await api.backupDelete(x.dataset.bd); loadBackups(); });
}
$('bkNew').onclick = async () => { const b = $('bkNew'); b.disabled = true; b.textContent = 'Sichere … (kann etwas dauern)'; try { await api.backupCreate(); toast('Gesichert.'); loadBackups(); } catch (e) { fail(e); } b.disabled = false; b.textContent = 'Jetzt sichern'; };
$('bkReset').onclick = async () => { if (!confirm('Alle Einstellungen, Tastenbelegungen und Addon-Daten zurücksetzen? Es wird vorher eine Sicherung angelegt.')) return; try { await api.wtfReset(); toast('Zurückgesetzt.'); loadBackups(); } catch (e) { fail(e); } };
async function runDiag() {
  const btn = $('dgRun'); btn.disabled = true; btn.textContent = 'Prüfe …';
  $('dgList').innerHTML = '<div class="muted">Prüfe …</div>';
  try {
    const l = await api.diagnose();
    $('dgList').innerHTML = l.map((x) => `<div class="dg ${x.level}"><span class="ic">${{ ok: '✓', info: 'ℹ', warn: '⚠', err: '✖' }[x.level]}</span><div class="t"><b>${esc(x.title)}</b><div class="muted">${esc(x.detail)}</div></div>${x.fix ? `<button data-fx="${x.fix}">${x.fix === 'errors' ? 'Löschen' : 'Beheben'}</button>` : ''}</div>`).join('');
    $('dgList').querySelectorAll('[data-fx]').forEach((b) => b.onclick = async () => { try { await api.fix(b.dataset.fx); toast('Behoben.'); runDiag(); } catch (e) { fail(e); } });
    const probs = l.filter((x) => x.level === 'err' || x.level === 'warn').length;
    toast(probs ? `${probs} Hinweis(e) gefunden.` : 'Alles in Ordnung.', false);
  } catch (e) { $('dgList').innerHTML = `<div class="dg err"><span class="ic">✖</span><div class="t">${esc(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</div></div>`; }
  btn.disabled = false; btn.textContent = 'Jetzt prüfen';
}
$('dgRun').onclick = () => runDiag();
$('crSend').onclick = async () => { try { await api.crashSend(); toast('Bericht gesendet. Danke!'); } catch (e) { fail(e); } };
$('spLim').onchange = async () => { cfg = await api.setConfig({ speedLimitMbit: +$('spLim').value }); toast('Gespeichert.'); };
$('dcSave').onclick = async () => { cfg = await api.setConfig({ discordClientId: $('dcId').value.trim() }); toast('Gespeichert. Gilt beim nächsten Spielstart.'); };
$('lang').onchange = async () => { cfg = await api.setConfig({ lang: $('lang').value }); applyLang(); };

// ---------- Admin-Reiter (nur GM-Level 3) ----------
function ask(title, fields) {
  return new Promise((res) => {
    $('askT').textContent = title;
    $('askF').innerHTML = fields.map((f) => `<label>${esc(f.label)}</label>${f.options ? `<select id="ask_${f.id}">${f.options.map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>` : `<input id="ask_${f.id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.ph || '')}">`}`).join('');
    $('askM').hidden = false;
    const done = (ok) => { $('askM').hidden = true; $('askYes').onclick = $('askNo').onclick = null; res(ok ? Object.fromEntries(fields.map((f) => [f.id, $('ask_' + f.id).value])) : null); };
    $('askYes').onclick = () => done(true); $('askNo').onclick = () => done(false);
    const first = $('ask_' + fields[0].id); if (first) first.focus();
  });
}
async function adm(action, data, okMsg) {
  try {
    const r = await api.admin(action, data || {});
    if (r.success === false) { toast(r.text || 'Der Server hat abgelehnt.', true); return r; }
    toast(okMsg || (r.text ? r.text.split('\n')[0].slice(0, 200) : 'Erledigt.'));
    return r;
  } catch (e) { fail(e); return null; }
}
const ago = (t) => (t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
function loadAdmin() { loadOv(); updPending(); }
const SECS = { pen: loadPending, rep: loadReports, ov: loadOv, acc: () => { if (!$('accRes').innerHTML) searchAcc(); }, chr: () => { if (!$('chrRes').innerHTML) searchChr(); }, ban: loadBans, nws: loadNwList, cfg: loadCfg, log: loadLog };
document.querySelectorAll('#admSubs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#admSubs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.asec').forEach((s) => (s.hidden = s.id !== 'as-' + b.dataset.as));
  (SECS[b.dataset.as] || (() => {}))();
});
async function aget(action, data) { try { return await api.admin(action, data || {}); } catch (e) { fail(e); return null; } }
const clsOf = (c) => { const k = CLS_ID[c]; return k ? CLASSES[k] : ['?', '#ccc']; };
const GMN = ['Spieler', 'Helfer', 'Game Master', 'Admin', 'Konsole'];

async function loadOv() {
  const r = await aget('overview'); if (!r) return; const o = r.overview;
  $('ovStats').innerHTML = [[o.accounts, 'Accounts'], [o.characters, 'Charaktere'], [o.online, 'Online'], [o.bans, 'Gesperrt'], [o.pending || 0, 'Wartend']].map(([v, n]) => `<div><b>${v}</b><span>${n}</span></div>`).join('');
  $('ovNew').innerHTML = o.newest.map((a) => `<div class="li"><div class="t">${esc(a.name)}</div><span class="muted">${esc(ago(a.joined))}</span><button data-open="${esc(a.name)}">Öffnen</button></div>`).join('') || '<div class="muted">Keine.</div>';
  $('ovNew').querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openAcc(b.dataset.open));
}
$('ovWeb').onclick = () => api.openUrl(cfg.siteUrl + 'admin/dashboard');
$('ovSave').onclick = () => adm('saveall', {}, 'Welt wird gespeichert.');

function showAdmSec(id) {
  document.querySelectorAll('#admSubs button').forEach((x) => x.classList.toggle('on', x.dataset.as === id));
  document.querySelectorAll('.asec').forEach((s) => (s.hidden = s.id !== 'as-' + id));
}
async function searchAcc() {
  $('accDet').hidden = true; $('accList2').hidden = false;
  const r = await aget('accounts', { q: $('accQ').value }); if (!r) return;
  $('accRes').innerHTML = r.accounts.map((a) => `<div class="addon"><div class="t"><div class="n">${esc(a.name)} ${a.online ? '<span class="b ok">online</span>' : ''}${a.banned ? '<span class="b bad">gesperrt</span>' : ''}${a.gm ? `<span class="b rec">GM ${a.gm}</span>` : ''}</div><div class="d">${esc(a.email || '')} · zuletzt ${esc(ago(a.last))}</div></div><div class="acts"><button data-open="${esc(a.name)}" class="primary">Verwalten</button></div></div>`).join('') || '<div class="empty">Keine Accounts gefunden.</div>';
  $('accRes').querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openAcc(b.dataset.open));
}
$('accGo').onclick = searchAcc; $('accQ').onkeydown = (e) => { if (e.key === 'Enter') searchAcc(); };

async function openAcc(name) {
  showAdmSec('acc'); $('accList2').hidden = true; $('accDet').hidden = false; $('accDet').innerHTML = '<div class="muted">Lade …</div>';
  const r = await aget('account_info', { name }); if (!r) { searchAcc(); return; }
  const i = r.info, me = r.me, can = i.touch;
  const maxGm = Math.min(3, me - 1);
  const gmOpts = [0, 1, 2, 3].filter((x) => x <= maxGm).map((x) => `<option value="${x}" ${x === i.gm ? 'selected' : ''}>${x} – ${GMN[x]}</option>`).join('');
  const active = i.bans.find((b) => b.active);
  $('accDet').innerHTML = `<div class="row" style="margin:0 0 12px"><button id="dBack">← Zurück</button></div>
  <div class="grid">
   <div class="card"><h3>${esc(i.name)} ${i.online ? '<span class="b ok">online</span>' : ''}${active ? '<span class="b bad">gesperrt</span>' : ''}</h3>
     <div class="form"><label>E-Mail</label><span>${esc(i.email || '–')}</span><label>Registriert</label><span>${esc(ago(i.joined))}</span><label>Letzter Login</label><span>${esc(ago(i.last))}</span><label>Letzte IP</label><span>${esc(i.ip || '–')}</span><label>GM-Level</label><span>${i.gm} – ${GMN[i.gm] || ''}</span><label>Webseiten-Rolle</label><span>${esc(i.role)}</span></div>
     ${can ? '' : '<p class="muted">Dieser Account kann von dir nicht verändert werden (gleiches oder höheres Level).</p>'}</div>
   ${can ? `<div class="card"><h3>Aktionen</h3>
     <div class="form"><label>GM-Level</label><div class="row" style="margin:0"><select id="dGm">${gmOpts}</select><button id="dGmSet" class="primary">Setzen</button></div>
     <label>Webseiten-Rolle</label><div class="row" style="margin:0"><select id="dRole"><option value="player">player</option><option value="moderator">moderator</option>${me >= 4 ? '<option value="admin">admin</option>' : ''}</select><button id="dRoleSet" class="primary">Setzen</button></div></div>
     <div class="row"><button id="dPw">Passwort zurücksetzen</button>${active ? '<button id="dUnban">Entsperren</button>' : '<button id="dBan">Sperren</button>'}${me >= 4 ? '<button id="dDel" style="color:#ff8a80;border-color:#7a2b2b">Account löschen</button>' : ''}</div></div>` : ''}
   <div class="card"><h3>Charaktere (${i.characters.length})</h3>${i.characters.map((c) => { const cl = clsOf(c.class); return `<div class="li"><div class="t"><b style="color:${cl[1]}">${esc(c.name)}</b> ${c.online ? '<span class="b ok">online</span>' : ''}<div class="muted">Level ${c.level} ${esc(RACE[c.race] || '')} ${esc(cl[0])} · ${c.gold} Gold</div></div><button data-ch="${esc(c.name)}">Verwalten</button></div>`; }).join('') || '<div class="muted">Keine Charaktere.</div>'}</div>
   <div class="card"><h3>Sperr-Verlauf</h3>${i.bans.map((b) => `<div class="li"><div class="t">${esc(ago(b.date))} · ${esc(b.reason || '')}<div class="muted">von ${esc(b.by || '?')} · ${b.permanent ? 'dauerhaft' : ''} ${b.active ? '(aktiv)' : ''}</div></div></div>`).join('') || '<div class="muted">Nie gesperrt.</div>'}</div>
  </div>`;
  $('dBack').onclick = searchAcc;
  $('accDet').querySelectorAll('[data-ch]').forEach((b) => b.onclick = () => charMenu(b.dataset.ch));
  if (!can) return;
  $('dGmSet').onclick = async () => { if (await adm('set_gm', { name, level: +$('dGm').value }, 'GM-Level gesetzt.')) openAcc(name); };
  $('dRoleSet').onclick = async () => { if (await adm('set_role', { name, role: $('dRole').value }, 'Rolle gesetzt.')) openAcc(name); };
  $('dPw').onclick = async () => { const v = await ask('Neues Passwort für ' + name, [{ id: 'p', label: 'Passwort (6–16 Zeichen)', type: 'text' }]); if (v) await adm('set_password', { name, newpass: v.p }, 'Passwort geändert.'); };
  if ($('dDel')) $('dDel').onclick = async () => {
    const v = await ask('Account endgültig löschen: ' + name, [{ id: 'c', label: 'Zur Bestätigung den Account-Namen eintippen. Das löscht den Account, ALLE Charaktere und die Webseiten-Daten – unwiderruflich.', ph: name }]);
    if (!v) return;
    if (v.c.trim().toUpperCase() !== name.toUpperCase()) { toast('Name stimmt nicht überein – nichts gelöscht.', true); return; }
    const r = await adm('account_delete', { name, confirm_name: v.c.trim() }, 'Account gelöscht.');
    if (r && r.success !== false) searchAcc();
  };
  if ($('dBan')) $('dBan').onclick = async () => { const v = await ask('Account sperren: ' + name, [{ id: 'd', label: 'Dauer', options: [['1h', '1 Stunde'], ['1d', '1 Tag'], ['7d', '7 Tage'], ['30d', '30 Tage'], ['-1', 'Dauerhaft']] }, { id: 'r', label: 'Grund', value: 'Regelverstoß' }]); if (v && (await adm('ban_account', { name, duration: v.d, reason: v.r }, 'Account gesperrt.'))) openAcc(name); };
  if ($('dUnban')) $('dUnban').onclick = async () => { if (await adm('unban_account', { name }, 'Entsperrt.')) openAcc(name); };
}

async function searchChr() {
  const r = await aget('characters', { q: $('chrQ').value, bots: $('chrBots').checked }); if (!r) return;
  $('chrRes').innerHTML = r.characters.map((c) => { const cl = clsOf(c.class); return `<div class="addon"><div class="t"><div class="n" style="color:${cl[1]}">${esc(c.name)} ${c.online ? '<span class="b ok">online</span>' : ''}</div><div class="d">Level ${c.level} ${esc(RACE[c.race] || '')} ${esc(cl[0])} · ${c.gold} Gold · Account ${esc(c.account)}</div></div><div class="acts"><button data-cm="${esc(c.name)}" class="primary">Verwalten</button><button data-ac="${esc(c.account)}">Account</button></div></div>`; }).join('') || '<div class="empty">Keine Charaktere gefunden.</div>';
  $('chrRes').querySelectorAll('[data-cm]').forEach((b) => b.onclick = () => charMenu(b.dataset.cm));
  $('chrRes').querySelectorAll('[data-ac]').forEach((b) => b.onclick = () => openAcc(b.dataset.ac));
}
$('chrGo').onclick = searchChr; $('chrQ').onkeydown = (e) => { if (e.key === 'Enter') searchChr(); };

// Aktionsmenue fuer einen Charakter (Modal mit Knoepfen)
function charMenu(n) {
  const acts = [['level', 'Level setzen'], ['revive', 'Wiederbeleben'], ['tele', 'Teleportieren'], ['gold', 'Gold senden'], ['item', 'Item senden'], ['rename', 'Umbenennung erzwingen'], ['customize', 'Aussehen ändern'], ['race', 'Rasse ändern'], ['faction', 'Fraktion ändern'], ['mute', 'Stumm schalten'], ['unmute', 'Stummschaltung aufheben'], ['kick', 'Aus dem Spiel werfen']];
  $('askT').textContent = 'Charakter: ' + n;
  $('askF').innerHTML = '<div class="cmenu">' + acts.map(([k, t]) => `<button data-k="${k}">${t}</button>`).join('') + '</div>';
  $('askM').hidden = false; $('askYes').hidden = true; $('askNo').textContent = 'Schließen';
  const close = () => { $('askM').hidden = true; $('askYes').hidden = false; $('askNo').textContent = 'Abbrechen'; $('askNo').onclick = null; };
  $('askNo').onclick = close;
  $('askF').querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => { close(); await charAct(n, b.dataset.k); });
}
async function charAct(n, k) {
  let v;
  switch (k) {
    case 'level': v = await ask('Level setzen: ' + n, [{ id: 'l', label: 'Level (1–80)', type: 'number', value: '80' }]); if (v) await adm('set_level', { name: n, level: +v.l }, 'Level gesetzt.'); break;
    case 'revive': await adm('revive', { name: n }, 'Wiederbelebt.'); break;
    case 'tele': v = await ask('Teleportieren: ' + n, [{ id: 'w', label: 'Ziel', options: [['Dalaran', 'Dalaran'], ['Stormwind', 'Sturmwind'], ['Orgrimmar', 'Orgrimmar'], ['Shattrath', 'Shattrath']] }]); if (v) await adm('teleport', { name: n, where: v.w }, 'Teleportiert.'); break;
    case 'gold': v = await ask('Gold senden an ' + n, [{ id: 'g', label: 'Gold', type: 'number', value: '100' }]); if (v) await adm('send_money', { name: n, gold: +v.g }, 'Gold per Post gesendet.'); break;
    case 'item': await itemDlg(n); break;
    case 'rename': case 'customize': if (confirm(`${n}: Beim nächsten Login wird die ${k === 'rename' ? 'Umbenennung' : 'Anpassung des Aussehens'} angeboten. Fortfahren?`)) await adm('char_flag', { name: n, flag: k }, 'Gesetzt.'); break;
    case 'race': if (confirm(`${n}: Rassenwechsel beim nächsten Login freischalten?`)) await adm('char_flag', { name: n, flag: 'changerace' }, 'Gesetzt.'); break;
    case 'faction': if (confirm(`${n}: Fraktionswechsel beim nächsten Login freischalten?`)) await adm('char_flag', { name: n, flag: 'changefaction' }, 'Gesetzt.'); break;
    case 'mute': v = await ask('Stumm schalten: ' + n, [{ id: 'm', label: 'Minuten', type: 'number', value: '30' }, { id: 'r', label: 'Grund', value: 'Regelverstoß' }]); if (v) await adm('mute', { name: n, minutes: +v.m, reason: v.r }, 'Stumm geschaltet.'); break;
    case 'unmute': await adm('unmute', { name: n }, 'Aufgehoben.'); break;
    case 'kick': if (confirm(n + ' aus dem Spiel werfen?')) await adm('kick', { name: n }, 'Gekickt.'); break;
  }
}
async function itemDlg(n) {
  const v = await ask('Item senden an ' + n, [{ id: 'q', label: 'Item suchen (Name, min. 3 Zeichen) – leer lassen, wenn die ID bekannt ist', ph: 'z.B. Frostmourne' }, { id: 'i', label: 'Item-ID', type: 'number' }, { id: 'c', label: 'Anzahl', type: 'number', value: '1' }]);
  if (!v) return;
  if (v.q.trim() && !+v.i) {
    const r = await aget('lookup_item', { q: v.q }); if (!r) return;
    if (!r.items.length) { toast('Nichts gefunden.', true); return; }
    const p = await ask('Treffer für „' + v.q + '“', [{ id: 'i', label: 'Item', options: r.items.map((x) => [x.id, `${x.name} (${x.id})`]) }, { id: 'c', label: 'Anzahl', type: 'number', value: v.c }]);
    if (p) await adm('send_item', { name: n, item: +p.i, count: +p.c }, 'Item per Post gesendet.');
    return;
  }
  await adm('send_item', { name: n, item: +v.i, count: +v.c }, 'Item per Post gesendet.');
}

$('anSend').onclick = async () => { if ($('anText').value.trim() && (await adm('announce', { text: $('anText').value }, 'Ankündigung gesendet.'))) $('anText').value = ''; };
$('motdSet').onclick = async () => { if ($('motdText').value.trim() && (await adm('set_motd', { text: $('motdText').value }, 'MOTD gesetzt.'))) $('motdText').value = ''; };
$('rsGo').onclick = async () => { if (confirm('Server wirklich neu starten? Alle Spieler werden vorher gewarnt.')) await adm('server_restart', { seconds: +$('rsSec').value }, 'Neustart geplant.'); };
$('sdGo').onclick = async () => { if (confirm('Server wirklich HERUNTERFAHREN? Er startet nicht von selbst wieder, außer Docker startet ihn neu.')) await adm('server_shutdown', { seconds: +$('rsSec').value }, 'Herunterfahren geplant.'); };
$('rsCancel').onclick = () => adm('server_restart_cancel', {}, 'Abgebrochen.');
$('svInfo').onclick = async () => { const r = await adm('server_info', {}, 'Server-Info geladen.'); if (r) $('svOut').textContent = r.text || ''; };
$('svSave').onclick = () => adm('saveall', {}, 'Welt wird gespeichert.');
$('svReload').onclick = () => adm('reload_config', {}, 'Config neu geladen.');

async function loadBans() {
  const r = await aget('bans'); if (!r) return;
  $('banRes').innerHTML = r.bans.map((b) => `<div class="addon"><div class="t"><div class="n">${esc(b.name)}</div><div class="d">${esc(b.reason || '')} · von ${esc(b.by || '?')} · ${b.permanent ? 'dauerhaft' : 'bis ' + esc(ago(b.until))}</div></div><div class="acts"><button data-open="${esc(b.name)}">Öffnen</button><button data-un="${esc(b.name)}">Entsperren</button></div></div>`).join('') || '<div class="empty">Keine aktiven Sperren.</div>';
  $('banRes').querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openAcc(b.dataset.open));
  $('banRes').querySelectorAll('[data-un]').forEach((b) => b.onclick = async () => { if (await adm('unban_account', { name: b.dataset.un }, 'Entsperrt.')) loadBans(); });
}
$('banReload').onclick = loadBans;

$('bSet').onclick = async () => { if (await adm('banner', { text: $('bText').value, level: $('bLevel').value, hours: +$('bHours').value || 6 }, 'Banner gesetzt.')) refreshBanner(); };
$('bClear').onclick = async () => { if (await adm('banner', { text: '' }, 'Banner entfernt.')) refreshBanner(); };
$('nSend').onclick = async () => { if (await adm('news', { title: $('nTitle').value, text: $('nText').value, image: $('nImg').value.trim(), category: $('nCat').value, important: $('nImp').checked }, 'News veröffentlicht.')) { $('nTitle').value = $('nText').value = $('nImg').value = ''; loadNews(); loadNwList(); } };
async function loadNwList() {
  const r = await aget('news_list'); if (!r) return;
  $('nwList').innerHTML = r.news.map((x) => `<div class="li"><div class="t">${esc(x.title)}<div class="muted">${esc(ago(x.date))} · ${esc(x.category)}</div></div><button data-nd="${x.id}">Löschen</button></div>`).join('') || '<div class="muted">Noch keine News.</div>';
  $('nwList').querySelectorAll('[data-nd]').forEach((b) => b.onclick = async () => { if (confirm('News wirklich löschen?') && (await adm('news_delete', { id: +b.dataset.nd }, 'Gelöscht.'))) { loadNwList(); loadNews(); } });
}
async function loadLog() {
  const r = await aget('audit_log'); if (!r) return;
  $('logOut').textContent = r.lines.length ? r.lines.slice().reverse().join('\n') : 'Noch keine Einträge.';
}
$('logReload').onclick = loadLog;
async function loadCfg() {
  const i = await api.serverInfo(true); if (!i) return;
  $('cfTag').value = i.tagline || ''; $('cfPatch').value = i.patch || ''; $('cfRestart').value = i.restart || ''; $('cfDiscord').value = i.discord || '';
  const r = i.rates || {}; $('cfXp').value = r.XP || ''; $('cfDrop').value = r.Drops || ''; $('cfGold').value = r.Gold || ''; $('cfHonor').value = r.Ehre || ''; $('cfRules').value = (i.rules || []).join('\n');
}
$('cfSave').onclick = async () => adm('serverinfo', { events: ((await api.serverInfo(true)) || {}).events || [], tagline: $('cfTag').value, patch: $('cfPatch').value, restart: $('cfRestart').value, discord: $('cfDiscord').value, rates: { XP: $('cfXp').value, Drops: $('cfDrop').value, Gold: $('cfGold').value, Ehre: $('cfHonor').value }, rules: $('cfRules').value.split('\n') }, 'Gespeichert. Der Launcher zeigt es beim nächsten Öffnen.');


// ---------- Hilfe, Fehler melden ----------
window.addEventListener('error', (e) => api.logError('error', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => api.logError('error', 'Promise: ' + (e.reason && e.reason.message || e.reason)));
const FAQ = [
  ['Das Spiel startet nicht oder bleibt hängen', 'Öffne den Reiter Werkzeuge und klicke auf "Jetzt prüfen". Der Launcher findet bekannte Probleme und behebt sie per Klick. Hilft das nicht, unter Einstellungen "Alles prüfen & reparieren" wählen. Läuft WoW noch im Hintergrund (Task-Manager), beende es zuerst.'],
  ['Ich komme nicht ins Spiel / "Server nicht erreichbar"', 'Oben im Launcher siehst du, ob der Server online ist. Ist er online, prüfe unter Hilfe die Systeminformationen und melde den Fehler mit angehängter Diagnose. Vergiss nicht, dass der Server sonntags um 05:00 Uhr kurz neu startet.'],
  ['Wie wechsle ich zwischen Normal und HD?', 'Unten links im Launcher bei "Grafik" das Pack wählen. Fehlt es noch, lädt der Launcher es herunter. Danach auf SPIELEN klicken.'],
  ['Wie installiere ich Addons?', 'Reiter Addons, Katalog öffnen, Klassenfilter nutzen und auf Installieren klicken. Angeboten werden nur Addons für 3.3.5a. Mit "Mehr Infos" kommst du zur Seite des Addons.'],
  ['Ich habe mein Passwort vergessen', 'Auf der Webseite gibt es "Passwort vergessen". Einen neuen Zugang kannst du auch über einen Game Master bekommen.'],
  ['Meine Tastenbelegung ist weg', 'Unter Werkzeuge gibt es Sicherungen deines WTF-Ordners. Dort kannst du eine frühere Sicherung wiederherstellen. Lege ruhig öfter eine an.'],
  ['Das Spiel ist abgestürzt', 'Der Launcher erkennt das und fragt, ob du den Bericht senden willst. Das hilft uns, den Fehler zu finden. Du kannst den letzten Absturz auch jederzeit unter Hilfe senden.'],
  ['Wie bekomme ich einen Account?', 'Im Anmeldefenster auf "Jetzt kostenlos registrieren" klicken oder auf der Webseite registrieren. Danach im Launcher mit denselben Daten anmelden.'],
  ['Kann ich mehrere Accounts nutzen?', 'Ja. Melde dich nacheinander an. Danach wechselst du oben rechts über den Namen zwischen den Accounts.'],
  ['Wo liegt die Log-Datei?', 'Unter Hilfe auf "Log-Datei zeigen" klicken. Sie wird automatisch gepflegt und bleibt unter 2 MB.']
];
const CHANGES = [
  ['0.6.7', ['Das Was-ist-neu-Fenster lässt sich wieder schließen: scrollbar, Esc oder Klick daneben']],
  ['0.6.6', ['Kalender zeigt jetzt Wochenend-Bonus und Wichtel-Adventskalender', 'Der heutige Tag im Kalender sieht wieder normal aus', 'Neuer Knopf unter Hilfe: Fehler direkt auf GitHub melden']],
  ['0.6.5', ['Das Namens-Addon (Nachname im Spiel) wird auf unserem Realm automatisch installiert', 'Das gewaehlte Grafik-Pack bleibt nach dem Start erhalten, auch wenn die Pack-Liste kurz nicht erreichbar ist']],
  ['0.6.4', ['Discord-Status: zeigt "Im Launcher" und beim Spielen Charakter, Stufe, Klasse und Zone', 'Buttons "Mitspielen" und "Launcher laden" für deine Freunde', 'Ort und Charaktername abschaltbar unter Einstellungen', 'News-Bilder laden nach, falls sie beim Start nicht ankommen', 'Die Update-Hinweise zeigen jetzt die richtige Version']],
  ['0.6.1', ['Playerbot-Addons (MultiBot, PlayerbotManager) werden jetzt für alle Spieler auf unserem Server geladen', 'Abschaltbar unter Einstellungen \u2192 Konto', 'Das Admin-Addon bleibt nur für GMs']],
  ['0.6.0', ['Richtiger Installer statt Portable-Datei: schnellerer Start', 'Updates laden nur noch die geänderten Teile', 'Kleinere Datei durch weniger Sprachpakete']],
  ['0.5.1', ['Update-Anzeige und automatisches Update über GitHub geprüft']],
  ['0.5.0', ['Neuer Reiter Kalender: WoW-Feiertage, Adventskalender und Server-Events', 'GMs können im Kalender Server-Events eintragen', 'Startseite mit "Heute los" und Online-Liste, Erinnerung vor Events', 'Versionsanzeige oben rechts mit Update-Hinweis', 'Schnellerer Start durch Cache', 'Werkzeuge und Hilfe findest du jetzt unter Einstellungen', 'Admin-Addons (MultiBot, PlayerBots, AzerothCoreAdmin) werden nur für GMs und nur auf Home of the Lich King geladen und nach dem Spiel wieder entfernt']],
  ['0.4.0', ['Neuer Reiter Hilfe: Fehler melden, Systeminfos, häufige Fragen', 'Absturz-Erkennung: Der Launcher fragt, ob der Bericht gesendet werden soll', 'Optionen: Launcher nach dem Spielstart minimieren oder schließen, mit Windows starten', 'Launcher-Log für leichtere Fehlersuche', 'Neuer Admin-Bereich für GMs (Freigaben, Accounts, Charaktere, Server, Berichte)']],
  ['0.3.0', ['Addon-Katalog mit Klassenfilter und Mehr Infos', 'Mehrere Accounts mit Schnellwechsel', 'Diagnose, Sicherungen, Grafikeinstellungen']]
];
async function loadHelp() {
  const v = await api.launcherVersion().catch(() => ({}));
  $('hpAbout').textContent = `Home of the Lich King Launcher ${v.current || ''}` + (v.latest ? ` · neueste Version: ${v.latest}` : '');
  try { const s = await api.sysinfo(); $('hpSys').innerHTML = s.map(([k, x]) => `<label>${esc(k)}</label><span>${esc(x)}</span>`).join(''); } catch (e) { fail(e); }
  $('faq').innerHTML = FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
  const i = await api.serverInfo().catch(() => null);
  $('hpDisc').hidden = !(i && i.discord); $('hpDisc').onclick = () => api.openUrl(i.discord);
}
$('hpCopy').onclick = async () => { await api.copyText(); toast('Systeminformationen kopiert.'); };
$('hpLog').onclick = () => api.openLog();
$('hpGh').onclick = async () => {
  let sys = ''; try { sys = (await api.sysinfo()).map(([k, x]) => `- ${k}: ${x}`).join('\n'); } catch {}
  const body = `**Was ist passiert?**\n\n\n**Was habe ich erwartet?**\n\n\n**Systeminformationen**\n${sys}`;
  api.openUrl('https://github.com/Jedrimos/hotlk-launcher/issues/new?body=' + encodeURIComponent(body));
};
$('hpSite').onclick = () => api.openUrl(cfg.siteUrl);
$('hpReg').onclick = openReg;
$('hpWel').onclick = () => { $('welcome').hidden = false; };
$('hpDiag').onclick = () => { document.querySelector('#tabs [data-tab="tools"]').click(); };
$('hpRepair').onclick = () => { document.querySelector('#tabs [data-tab="settings"]').click(); toast('Hier unter Spieldateien: "Alles prüfen & reparieren".'); };
let openReport = function (kind, hint) {
  $('repKind').value = kind || 'FEHLER'; $('repText').value = ''; $('repErr').textContent = ''; $('repText').placeholder = hint || 'Was ist passiert? Was hast du gemacht, kurz bevor es passiert ist?';
  $('repM').hidden = false; $('repText').focus();
};
$('hpReport').onclick = () => openReport('FEHLER');
$('hpCrash').onclick = () => openReport('ABSTURZ', 'Optional: Was hast du gemacht, als das Spiel abgestürzt ist?');
$('repNo').onclick = () => { $('repM').hidden = true; };
$('repGo').onclick = async () => {
  const b = $('repGo'); b.disabled = true; b.textContent = 'Sende …'; $('repErr').textContent = '';
  try {
    await api.sendReport({ kind: $('repKind').value, text: $('repText').value, contact: $('repContact').value, diag: $('repDiag').checked, crash: $('repCrash').checked, log: $('repLog').checked });
    $('repM').hidden = true; toast('Danke! Dein Bericht ist angekommen.');
  } catch (e) { $('repErr').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  b.disabled = false; b.textContent = 'Senden';
};
api.onCrashed((p) => { openReport('ABSTURZ', 'WoW wurde unerwartet beendet (' + p.file + '). Was hast du gerade gemacht?'); $('repT').textContent = 'WoW ist abgestürzt'; toast('WoW wurde unerwartet beendet. Du kannst den Bericht jetzt senden.', true); });
$('repM').addEventListener('transitionend', () => {});
const _openReport = openReport; openReport = function (k, h) { $('repT').textContent = 'Fehler melden / Feedback'; _openReport(k, h); };

function showView(title, text, onDelete) {
  $('viewT').textContent = title; $('viewB').textContent = text; $('viewM').hidden = false;
  $('viewDel').hidden = !onDelete; $('viewDel').onclick = async () => { if (confirm('Bericht wirklich löschen?')) { await onDelete(); $('viewM').hidden = true; } };
  $('viewCopy').onclick = async () => { await api.copyText(text); toast('Kopiert.'); };
}
$('viewNo').onclick = () => { $('viewM').hidden = true; };
async function loadReports() {
  const r = await aget('reports_list'); if (!r) return;
  $('repRes').innerHTML = r.reports.map((x) => `<div class="addon"><div class="t"><div class="n">${esc(x.name)}</div><div class="d">${esc(x.time)} · ${Math.round(x.size / 1024) || 1} KB</div></div><div class="acts"><button data-rv="${esc(x.name)}" class="primary">Lesen</button></div></div>`).join('') || '<div class="empty">Keine Berichte. Schön ruhig hier.</div>';
  $('repRes').querySelectorAll('[data-rv]').forEach((b) => b.onclick = async () => {
    const n = b.dataset.rv; const d = await aget('report_read', { name: n }); if (!d) return;
    showView(n, d.text, async () => { await adm('report_delete', { name: n }, 'Gelöscht.'); loadReports(); });
  });
}
$('repReload').onclick = loadReports;
$('optAfter').onchange = async () => { cfg = await api.setConfig({ afterLaunch: $('optAfter').value }); toast('Gespeichert.'); };
$('optDcLoc').onchange = async () => { cfg = await api.setConfig({ discordLocation: $('optDcLoc').checked }); toast('Gespeichert.'); };
$('optDcName').onchange = async () => { cfg = await api.setConfig({ discordName: $('optDcName').checked }); toast('Gespeichert.'); };
$('optBoot').onchange = async () => { try { await api.setAutostart($('optBoot').checked); cfg = await api.getConfig(); toast('Gespeichert.'); } catch (e) { fail(e); $('optBoot').checked = !$('optBoot').checked; } };
async function whatsNew() {
  const v = (await api.launcherVersion().catch(() => ({}))).current;
  if (!v || cfg.lastVersion === v) return;
  if (cfg.lastVersion) { $('newT').textContent = 'Was ist neu in ' + v; $('newB').innerHTML = CHANGES.slice(0, 1).map(([n, l]) => `<h4>Version ${n}</h4><ul>${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join(''); $('newM').hidden = false; }
  cfg = await api.setConfig({ lastVersion: v });
}
$('hpNew').onclick = () => { $('newT').textContent = 'Was ist neu?'; $('newB').innerHTML = CHANGES.map(([n, l]) => `<h4>Version ${n}</h4><ul>${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join(''); $('newM').hidden = false; };
$('newNo').onclick = () => { $('newM').hidden = true; };
$('newM').onclick = (e) => { if (e.target === $('newM')) $('newM').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('newM').hidden = true; });

// ---------- Freigaben ----------
async function updPending() {
  const r = await api.admin('overview', {}).catch(() => null); if (!r) return;
  const n = r.overview.pending || 0;
  $('penBtn').textContent = n ? `Freigaben (${n})` : 'Freigaben';
  $('admTab').textContent = n ? `Admin (${n})` : 'Admin';
}
async function loadPending() {
  const r = await aget('pending_list'); if (!r) return;
  $('penRes').innerHTML = r.pending.map((x) => `<div class="addon"><div class="t"><div class="n">${esc(x.name)}</div><div class="d">${esc(x.email || '')} · registriert ${esc(ago(x.joined))}</div></div><div class="acts"><button data-ap="${esc(x.name)}" class="primary">Freigeben</button><button data-rj="${esc(x.name)}">Ablehnen</button></div></div>`).join('') || '<div class="empty">Keine wartenden Registrierungen.</div>';
  $('penRes').querySelectorAll('[data-ap]').forEach((b) => b.onclick = async () => { if (await adm('approve', { name: b.dataset.ap }, b.dataset.ap + ' ist freigegeben.')) { loadPending(); updPending(); } });
  $('penRes').querySelectorAll('[data-rj]').forEach((b) => b.onclick = async () => { if (confirm(b.dataset.rj + ' ablehnen? Der Account bleibt gesperrt.') && (await adm('reject', { name: b.dataset.rj }, 'Abgelehnt.'))) { loadPending(); updPending(); } });
}
$('penReload').onclick = loadPending;

init().then(() => { whatsNew(); applyLang(); refreshBanner(); setInterval(refreshBanner, 120000); }).catch(fail);

document.querySelectorAll('.snav button').forEach((x) => x.onclick = () => document.querySelector(`#tabs [data-tab="${x.dataset.go}"]`).click());

$('aUpd').onclick = async () => {
  if (lastVer?.newer) return $('banner').click();
  $('aUpd').disabled = true; toast('Suche nach Updates …');
  await checkLauncher();
  $('aUpd').disabled = false;
  if (lastVer?.newer) { $('aUpd').textContent = 'Jetzt auf ' + lastVer.latest + ' aktualisieren'; toast('Neue Version ' + lastVer.latest + ' gefunden.'); }
  else toast(lastVer?.latest ? 'Du hast die neueste Version.' : 'Update-Server nicht erreichbar.', !lastVer?.latest);
};

// ---------- Tickets (Spiel-GM-Hilfe) ----------
const TKT = ['Frage', 'Fehler', 'Spieler melden', 'Sonstiges'];
async function loadTickets() {
  const r = await aget('tickets_list'); if (!r) return;
  const l = r.tickets || [];
  const n = l.filter((x) => !x.completed).length;
  $('tikRes').innerHTML = l.length ? l.map((x) => `<div class="addon"><div class="t"><div class="n">#${x.id} · ${esc(x.name)} ${x.completed ? '<span class="b ok">beantwortet</span>' : '<span class="b">offen</span>'}</div><div class="d" style="white-space:pre-wrap">${esc(x.text || '(kein Text)')}</div>${x.response ? `<div class="muted" style="margin-top:4px">Antwort: ${esc(x.response)}</div>` : ''}<div class="muted">${esc(ago(x.time))}</div></div><div class="acts"><button data-tr="${x.id}" data-n="${esc(x.name)}" class="primary">Antworten</button><button data-tc="${x.id}">Schließen</button></div></div>`).join('') : '<div class="empty">Keine offenen Tickets.</div>';
  const tb = $('admSubs').querySelector('[data-as="tik"]'); if (tb) tb.textContent = n ? `Tickets (${n})` : 'Tickets';
  $('tikRes').querySelectorAll('[data-tr]').forEach((b) => b.onclick = async () => {
    const v = await ask(`Antwort an ${b.dataset.n} (Ticket #${b.dataset.tr})`, [{ id: 't', label: 'Text (max. 250 Zeichen)', type: 'text' }]);
    if (v && v.t.trim() && await adm('ticket_reply', { id: +b.dataset.tr, text: v.t }, 'Antwort gesendet.')) loadTickets();
  });
  $('tikRes').querySelectorAll('[data-tc]').forEach((b) => b.onclick = async () => { if (confirm('Ticket #' + b.dataset.tc + ' schließen?') && await adm('ticket_close', { id: +b.dataset.tc }, 'Ticket geschlossen.')) loadTickets(); });
}
$('tikReload').onclick = loadTickets;
SECS.tik = loadTickets;
