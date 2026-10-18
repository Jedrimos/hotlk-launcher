# Home of the Lich King Launcher

Launcher fuer den WoW-Server **Home of the Lich King** (WotLK 3.3.5a): Spiel- und Pack-Verwaltung, Addons, Kalender, Server-Infos, Updates.

## Entwickeln
```
npm install
npm start
```

## Bauen
```
npm run dist
```
Die fertige Datei liegt in `dist/HomeOfTheLichKing-Launcher.exe`.

## Neue Version veroeffentlichen
1. In `package.json` die Version erhoehen und committen.
2. Tag setzen und pushen, z. B. `git tag v0.5.0 && git push origin v0.5.0`.
3. GitHub Actions baut die Exe und legt Release samt `version.json` an. Der Launcher erkennt das Update selbst.
