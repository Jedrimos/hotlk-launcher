const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Hier die URLs anpassen, sobald manifest.json / news.json auf der Seite liegen.
const DEFAULTS = {
  gameDir: '',
  selectedRealm: 0,
  activePack: 'none',
  welcomeSeen: false,
  clearCacheOnSwitch: false,
  manifestUrl: 'https://wow.jedrimos.dedyn.io/launcher/manifest.json',
  newsUrl: 'https://wow.jedrimos.dedyn.io/launcher/api/news.php',
  statusUrl: 'https://wow.jedrimos.dedyn.io/launcher/api/status.php',
  versionUrl: 'https://github.com/Jedrimos/hotlk-launcher/releases/latest/download/version.json',
  versionUrlAlt: 'https://wow.jedrimos.dedyn.io/launcher/version.json',
  loginUrl: 'https://wow.jedrimos.dedyn.io/launcher/api/login.php',
  serverInfoUrl: 'https://wow.jedrimos.dedyn.io/launcher/serverinfo.json',
  playersUrl: 'https://wow.jedrimos.dedyn.io/launcher/api/players.php',
  crashUrl: 'https://wow.jedrimos.dedyn.io/launcher/api/crash.php',
  adminUrl: 'https://wow.jedrimos.dedyn.io/launcher/api/admin.php',
  discordClientId: '',
  speedLimitMbit: 0,
  lang: 'de',
  autoLogin: true,
  afterLaunch: 'keep',
  autostart: false,
  lastVersion: '',
  autoDelay: 9,
  siteUrl: 'https://wow.jedrimos.dedyn.io/',
  realms: [
    { key: 'home', name: 'Home of the Lich King', realmlist: 'logonwow.jedrimos.dedyn.io' }
  ]
};

const file = () => path.join(app.getPath('userData'), 'config.json');

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const { manifestUrl, newsUrl, loginUrl, siteUrl, statusUrl, versionUrl, versionUrlAlt, serverInfoUrl, playersUrl, crashUrl, adminUrl } = DEFAULTS;
    // eigener Realm bekommt immer den Schlüssel 'home'
    if (Array.isArray(saved.realms)) saved.realms = saved.realms.map((r) => (r.realmlist === DEFAULTS.realms[0].realmlist ? { ...r, key: 'home' } : r));
    if (saved.activePack === 'normal') saved.activePack = 'none';
    return { ...DEFAULTS, ...saved, manifestUrl, newsUrl, loginUrl, siteUrl, statusUrl, versionUrl, versionUrlAlt, serverInfoUrl, playersUrl, crashUrl, adminUrl };
  } catch {
    return { ...DEFAULTS };
  }
}
function save(cfg) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
}
module.exports = { load, save };
