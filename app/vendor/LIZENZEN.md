# Fremde Bibliotheken und Daten in `app\vendor` (Stand 2026-11-12)

Alle Dateien wurden mit `npm pack` bzw. von GitHub nach `tmp\quellen\karte\` geladen, geprüft und hierher kopiert. Nichts wird beim Benutzen der App aus dem Internet nachgeladen.

| Datei | Quelle, Version | Lizenz |
|---|---|---|
| `maplibre-gl.js`, `maplibre-gl.css` | MapLibre GL JS 5.23.0 (Fassung ohne Module, Version vom 2026-04-13; Version 6 braucht zusätzliche Modul-Dateien und wurde bewusst nicht genommen) | BSD-3-Clause, `LICENSE-maplibre-gl.txt` |
| `pmtiles.js` | pmtiles 4.5.0 (npm) | BSD-3-Clause |
| `basemaps.js` | @protomaps/basemaps 5.7.2 (npm), erzeugt den Kartenstil | BSD-3-Clause |
| `fonts\Noto Sans Regular|Medium|Italic\0-255.pbf, 256-511.pbf, 8192-8447.pbf` | https://github.com/protomaps/basemaps-assets (Schriften Noto Sans, Zeichen von U+0000 bis U+01FF und U+2000 bis U+20FF (Satzzeichen wie Gedankenstrich); reicht für Deutsch) | SIL Open Font License, Text in `LICENSE-fonts-OFL.txt` |
| `sprites\light*, dark*` | https://github.com/protomaps/basemaps-assets, `sprites/v4` (abgeleitet von tangrams/icons) | MIT |
| `LICENSE-basemaps-assets.md` | README von basemaps-assets mit den Lizenzhinweisen | |

Hinweis: Die Lizenztexte liegen in diesem Ordner (`LICENSE-*`). Beim Weitergeben der App an andere müssen sie mitgeliefert werden.
