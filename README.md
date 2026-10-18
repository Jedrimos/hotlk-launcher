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
1. In `package.json` die Version erhoehen und nach `main` pushen.
2. GitHub Actions baut den Installer (NSIS), setzt den Tag `v<Version>` und legt das Release samt `version.json` an (nur wenn es diese Version noch nicht gibt).
3. Der Launcher erkennt das Update selbst.
