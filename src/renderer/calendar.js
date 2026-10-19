// ---------- Kalender: WoW-Feiertage, Adventskalender, Server-Events ----------
let calY, calM, calSel, calSrv = [];
const pad2 = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1, d + n); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451); const x = h + l - 7 * m + 114; return iso(y, Math.floor(x / 31) - 1, (x % 31) + 1); }
function wowEvents(y) {
  const ev = [];
  const add = (t, s, e, txt) => ev.push({ kind: 'wow', title: t, start: s, end: e || s, text: txt || '' });
  add('Mondfest', iso(y, 0, 25), iso(y, 1, 8), 'Elders besuchen, Feuerwerk, Mondfest-Gegenstände.');
  add('Liebe liegt in der Luft', iso(y, 1, 7), iso(y, 1, 21), 'Boss-Schatzkisten in den Hauptstädten.');
  add('Kinderwoche', iso(y, 4, 1), iso(y, 4, 7), 'Waisen-Quests.');
  const ea = easter(y); add('Nobelgarten', ea, addDays(ea, 6), 'Eiersuche und Schokoladeneier.');
  add('Sonnenwendfest', iso(y, 5, 21), iso(y, 6, 5), 'Feuer, Fackeln und Feuerwerk.');
  add('Piratentag', iso(y, 8, 19), iso(y, 8, 19), 'Sprich wie ein Pirat.');
  add('Erntefest', iso(y, 8, 21), iso(y, 8, 28), 'Festessen in den Hauptstädten.');
  add('Braufest', iso(y, 8, 20), iso(y, 9, 6), 'Bier, Fässer und Widder-Rennen.');
  add('Schlotternächte', iso(y, 9, 18), iso(y, 10, 1), 'Süßes oder Saures, Kürbisse, Reiter ohne Kopf.');
  add('Tag der Toten', iso(y, 10, 1), iso(y, 10, 2));
  add('Pilgerfreudenfest', iso(y, 10, 22), iso(y, 10, 28), 'Festtafeln und Pilgerausrüstung.');
  add('Winterhauch', iso(y, 11, 15), iso(y + 1, 0, 2), 'Geschenke unter dem Baum, Schneebälle, Greatfather Winter.');
  for (let m = 0; m < 12; m++) { const d = new Date(y, m, 1); const off = (7 - d.getDay()) % 7; add('Dunkelmond-Jahrmarkt', iso(y, m, 1 + off), iso(y, m, 7 + off), 'Karten, Tränke und Schnickschnack.'); }
  return ev;
}
function adventEvents(y) {
  const ev = [];
  for (let d = 1; d <= 24; d++) ev.push({ kind: 'adv', title: `Adventskalender, Tür ${d}`, start: iso(y, 11, d), end: iso(y, 11, d), text: 'Neue Tür im Wichtel-Adventskalender, die Tür öffnet sich im Spiel.' });
  return ev;
}
function bonusEvents(y) {
  const ev = [];
  for (let m = 0; m < 12; m++) {
    if (y === 2026 && m < 10) continue;                                    // erster Bonus: 07.11.2026
    const d = new Date(y, m, 1), off = (6 - d.getDay() + 7) % 7;
    ev.push({ kind: 'bonus', title: 'Wochenend-Bonus', start: iso(y, m, 1 + off), end: iso(y, m, 2 + off), text: '4x Erfahrung und Ehre, das ganze Wochenende.' });
  }
  return ev;
}
function allEvents(y) {
  const ev = [...wowEvents(y - 1), ...wowEvents(y), ...adventEvents(y), ...bonusEvents(y)];
  for (const e of calSrv) ev.push({ kind: 'srv', id: e.id, title: e.title, start: e.date, end: e.end || e.date, text: e.text || '', time: e.time });
  return ev;
}
const onDay = (ev, d) => ev.filter((e) => e.start <= d && d <= e.end);

async function loadCal() {
  if (calY == null) { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); calSel = iso(calY, calM, n.getDate()); }
  const i = await api.serverInfo();
  calSrv = (i?.events || []).filter((e) => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''));
  $('calAdd').hidden = !(session && (session.gmlevel || 0) >= 3);
  renderCal();
}
function renderCal() {
  const mn = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  $('calTitle').textContent = `${mn[calM]} ${calY}`;
  const ev = allEvents(calY);
  const first = new Date(calY, calM, 1), lead = (first.getDay() + 6) % 7, dim = new Date(calY, calM + 1, 0).getDate();
  const today = (() => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()); })();
  let h = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((x) => `<div class="ch">${x}</div>`).join('');
  for (let k = 0; k < lead; k++) h += '<div class="cd off"></div>';
  for (let d = 1; d <= dim; d++) {
    const s = iso(calY, calM, d), list = onDay(ev, s).sort((a, b) => (a.kind === 'srv' ? -1 : 1) - (b.kind === 'srv' ? -1 : 1));
    h += `<div class="cd${s === today ? ' now' : ''}${s === calSel ? ' sel' : ''}" data-d="${s}"><b>${d}</b>${list.slice(0, 3).map((e) => `<span class="ce ${e.kind}">${esc(e.title)}</span>`).join('')}${list.length > 3 ? `<span class="muted">+${list.length - 3}</span>` : ''}</div>`;
  }
  $('calGrid').innerHTML = h;
  $('calGrid').querySelectorAll('[data-d]').forEach((c) => c.onclick = () => { calSel = c.dataset.d; renderCal(); });
  const sel = onDay(ev, calSel);
  const dt = calSel.split('-').reverse().join('.');
  $('calDay').innerHTML = `<h3>${dt}</h3>` + (sel.length ? sel.map((e) => `<div class="li"><div class="t"><span class="ce ${e.kind}">${e.kind === 'srv' ? 'Server' : e.kind === 'adv' ? 'Advent' : e.kind === 'bonus' ? 'Bonus' : 'WoW'}</span> <b>${esc(e.title)}</b>${e.time ? ' · ' + esc(e.time) + ' Uhr' : ''}<div class="muted">${e.start !== e.end ? `${e.start.split('-').reverse().join('.')} bis ${e.end.split('-').reverse().join('.')} · ` : ''}${esc(e.text)}</div></div>${e.kind === 'srv' && session && (session.gmlevel || 0) >= 3 ? `<button data-del="${esc(e.id || '')}" data-t="${esc(e.title)}" data-s="${e.start}">Löschen</button>` : ''}</div>`).join('') : '<div class="muted">Nichts geplant.</div>');
  $('calDay').querySelectorAll('[data-del]').forEach((b) => b.onclick = () => delCalEvent(b.dataset.del, b.dataset.t, b.dataset.s));
  $('evDate').value = calSel;
}
$('calPrev').onclick = () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCal(); };
$('calNext').onclick = () => { calM++; if (calM > 11) { calM = 0; calY++; } renderCal(); };
$('calToday').onclick = () => { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); calSel = iso(calY, calM, n.getDate()); renderCal(); };

async function saveCalEvents(list, okMsg) {
  const cur = (await api.serverInfo(true)) || {};
  const r = await adm('serverinfo', { ...cur, events: list }, okMsg);
  if (!r || r.success === false) return false;
  const chk = await api.serverInfo(true);                                  // pruefen, ob der Server die Events wirklich behalten hat
  if (!(chk?.events || []).length && list.length) { toast('Der Server hat die Events nicht gespeichert (admin.php kennt "events" noch nicht).', true); return false; }
  calSrv = chk.events || []; renderCal(); return true;
}
$('evSave').onclick = async () => {
  const title = $('evTitle').value.trim(), date = $('evDate').value, end = $('evEnd').value || date;
  if (!title || !date) return toast('Titel und Datum fehlen.', true);
  if (end < date) return toast('Das Ende liegt vor dem Beginn.', true);
  const ev = { id: Date.now().toString(36), title, date, end, time: $('evTime').value || '', text: $('evText').value.trim() };
  if (await saveCalEvents([...calSrv, ev], 'Event gespeichert.')) { $('evTitle').value = ''; $('evText').value = ''; $('evEnd').value = ''; $('evTime').value = ''; }
};
async function delCalEvent(id, title, start) {
  const list = calSrv.filter((e) => (id ? e.id !== id : !(e.title === title && e.date === start)));
  await saveCalEvents(list, 'Event gelöscht.');
}


// ---------- "Heute los" auf der Startseite + Erinnerungen ----------
const fmtD = (s) => s.split('-').reverse().join('.');
async function renderToday() {
  if (!calSrv.length) { try { const i = await api.serverInfo(); calSrv = (i?.events || []).filter((e) => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '')); } catch {} }
  const n = new Date(), td = iso(n.getFullYear(), n.getMonth(), n.getDate());
  const ev = allEvents(n.getFullYear()), items = [];
  for (const e of onDay(ev, td).filter((e) => e.kind === 'adv')) items.push(['🎁', e.title, 'Heute neu']);
  for (const e of onDay(ev, td).filter((e) => e.kind === 'bonus')) items.push(['⚡', e.title, 'läuft bis ' + fmtD(e.end)]);
  for (const e of onDay(ev, td).filter((e) => e.kind === 'srv')) items.push(['📅', e.title, 'Heute' + (e.time ? ' um ' + e.time + ' Uhr' : '')]);
  const nxt = ev.filter((e) => e.kind === 'srv' && e.start > td).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (nxt) items.push(['⏭', nxt.title, 'am ' + fmtD(nxt.start) + (nxt.time ? ', ' + nxt.time + ' Uhr' : '')]);
  for (const e of onDay(ev, td).filter((e) => e.kind === 'wow').slice(0, 2)) items.push(['🎃', e.title, 'läuft bis ' + fmtD(e.end)]);
  $('today').innerHTML = `<div class="tcard"><h3>Heute los</h3>${items.length ? items.map((x) => `<div class="ti"><span>${x[0]}</span><b>${esc(x[1])}</b><span class="muted">${esc(x[2])}</span></div>`).join('') : '<div class="muted">Heute ist nichts Besonderes geplant.</div>'}</div><div class="tcard"><h3>Online <span id="tdCnt" class="muted"></span></h3><div id="tdPl" class="muted">…</div></div>`;
  const hasToday = onDay(ev, td).some((e) => e.kind === 'srv');
  const tb = document.querySelector('#tabs [data-tab="cal"]'); if (tb) tb.textContent = hasToday ? 'Kalender •' : 'Kalender';
  api.players().then((p) => {
    const l = p?.players || [];
    $('tdCnt').textContent = p ? `(${l.length})` : '';
    $('tdPl').innerHTML = p ? (l.length ? l.slice(0, 8).map((x) => `<span class="pl2">${esc(x.name)} <span class="muted">${x.level}</span></span>`).join('') + (l.length > 8 ? ` <span class="muted">+${l.length - 8}</span>` : '') : 'Gerade ist niemand online.') : 'Liste nicht erreichbar.';
  }).catch(() => {});
}
const remindSeen = new Set();
function remindCheck() {
  const n = new Date(), td = iso(n.getFullYear(), n.getMonth(), n.getDate());
  for (const e of calSrv) {
    if (e.date !== td || !/^\d{2}:\d{2}$/.test(e.time || '')) continue;
    const [h, m] = e.time.split(':').map(Number), diff = (h * 60 + m) - (n.getHours() * 60 + n.getMinutes());
    const key = (e.id || e.title) + td;
    if (diff <= 15 && diff >= 0 && !remindSeen.has(key)) {
      remindSeen.add(key);
      const msg = `${e.title} startet ${diff ? 'in ' + diff + ' Minuten' : 'jetzt'} (${e.time} Uhr)`;
      toast('📅 ' + msg);
      try { new Notification('Home of the Lich King', { body: msg, silent: false }); } catch {}
    }
  }
}
setInterval(remindCheck, 60000); setInterval(renderToday, 120000);
renderToday().then(remindCheck);
