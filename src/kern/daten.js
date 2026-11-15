// Tabellen für den Rechenkern.
// Alle Werte wörtlich aus Quellen, siehe docs\oebfv-wasserfoerderung-tabellen.md
// Quelle A: Landesfeuerwehrschule Tirol, "Wasserförderung über lange Wegstrecken, Merkregeln"
//           (Datei MA_Falter Wasserförderung.pdf), Seiten 4 bis 6
// Quelle B: ÖBFV "Bestimmungen FLA GOLD ÖBFV 2005", Version 4, Oktober 2022

// Verlust durch Reibung, B-Druckschlauch synthetisch 75 mm, bar je 100 m (Quelle A, S. 4)
export const RV_B75_PRO_100M = [
  { q: 200, bar: 0.10 },
  { q: 400, bar: 0.25 },
  { q: 600, bar: 0.50 },
  { q: 800, bar: 1.00 },
  { q: 1000, bar: 1.50 },
  { q: 1200, bar: 2.50 },
  { q: 1600, bar: 5.00 },
];

// Pumpenleistung in Prozent bei verschiedenen Saughöhen (Quelle A, S. 4)
// Saughöhe in Meter, Fördermengen sind auf 3 m geodätische Saughöhe bezogen
export const SAUGHOEHE_PROZENT = [
  { hs: 3, prozent: 100 },
  { hs: 4, prozent: 90 },
  { hs: 5, prozent: 80 },
  { hs: 6, prozent: 70 },
  { hs: 7, prozent: 60 },
  { hs: 7.5, prozent: 50 },
];

// Wasserlieferung aus Strahlrohren in l/min je Druck am Strahlrohr (Quelle A, S. 5)
export const STRAHLROHR_LIEFERMENGE = {
  'C9':  { 4: 105, 5: 120, 6: 130, 7: 140, 10: 170 },
  'C12': { 4: 188, 5: 210, 6: 230, 7: 249, 10: 299 },
  'B16': { 4: 334, 5: 373, 6: 409, 7: 441, 10: 528 },
  'B22': { 4: 636, 5: 711, 6: 778, 7: 841, 10: 1005 },
};

// Garantiepunkte Tragkraftspritzen (Quelle A, S. 4): Förderstrom bei 10 bar, 3 m Saughöhe
export const PUMPEN_NENN = {
  'TS 8':  { q: 800,  bar: 10 },
  'TS 12': { q: 1200, bar: 10 },
  'TS 15': { q: 1500, bar: 10 },
};

// Regeln aus Quelle A (Merkregeln)
export const REGELN = {
  steigungBarJe10m: 1,        // 10 m Steigung = 1 bar Druckverlust, 10 m Gefälle = 1 bar Gewinn
  edMinBar: 1.5,              // Eingangsdruck an der nächsten TS nicht unter 1,5 bar
  adMaxBar: 10,               // Ausgangsdruck: 10 bar bei Nennfördermenge (8 bar bei Langzeiteinsätzen)
  adLangzeitBar: 8,
  verteilerZuschlagBar: 1,    // Verteiler: Strahlrohrdruck + 1 bar
  schlauchLaengeM: 20,        // genormte B-Schlauchlänge (Quelle B, Frage 99: 5, 15 oder 20 m)
  // Verlegen der Förderleitung (Quelle A, S. 5): 6 B-Druckschläuche für 100 m Naturmaß.
  // Das sind 120 m Schlauch je 100 m Weg, also Faktor 1,2 (Festlegung Michael 2026-11-11).
  schlaeucheJe100mNaturmass: 6,
};

// Schlauchlänge in Metern je Meter Naturmaß (Weg im Gelände)
export const SCHLAUCH_FAKTOR =
  (REGELN.schlaeucheJe100mNaturmass * REGELN.schlauchLaengeM) / 100;
