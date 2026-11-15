// Weg auf der Karte: Länge, Höhenprofil, Warnung. Reine Rechenfunktionen ohne Oberfläche (getestet in tests/weg.test.js).
// Punkte sind { lat, lon } in Grad (WGS84). Höhen in Metern über Adria.

export const WARN_SCHWELLE_M = 5; // Warnung, wenn das Gelände mehr als 5 m über oder unter der geraden Linie Start-Ziel liegt (5 m = ca. 0,5 bar). Der Rechenkern geht von gleichmäßiger Steigung aus.
export const PROBE_M = 10; // Abstand der Profilpunkte entlang des Wegs
const ERDRADIUS_M = 6371008.8;
const GLEICH_M = 1e-6; // Profilpunkte, die näher beieinander liegen, zählen als ein Punkt

const rad = (grad) => (grad * Math.PI) / 180;

// Entfernung zwischen zwei Punkten in Metern (Haversine)
export function distanzM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * ERDRADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Länge des Wegs (Summe der geraden Teilstücke), 0 bei weniger als 2 Punkten
export function wegLaengeM(punkte) {
  let summe = 0;
  for (let i = 1; i < punkte.length; i++) summe += distanzM(punkte[i - 1], punkte[i]);
  return summe;
}

// Profilpunkte { s, lat, lon }: Start, alle Wegpunkte (Knicke), jeder 10-m-Schritt dazwischen, Ziel
function profilPunkte(punkte, gesamt) {
  const knoten = [];
  let s = 0;
  punkte.forEach((p, i) => {
    if (i > 0) s += distanzM(punkte[i - 1], p);
    if (knoten.length === 0 || s - knoten[knoten.length - 1].s > GLEICH_M) knoten.push({ s, lat: p.lat, lon: p.lon });
  });
  const dazu = [];
  for (let m = PROBE_M; m < gesamt - GLEICH_M; m += PROBE_M) {
    if (knoten.some((k) => Math.abs(k.s - m) <= GLEICH_M)) continue;
    let j = 1;
    while (j < knoten.length - 1 && knoten[j].s < m) j++;
    const a = knoten[j - 1];
    const b = knoten[j];
    const f = (m - a.s) / (b.s - a.s);
    dazu.push({ s: m, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
  }
  return [...knoten, ...dazu].sort((x, y) => x.s - y.s);
}

// Alle Angaben zum Weg. hoeheAn(lat, lon) liefert die Höhe in m oder null (keine Daten).
export function wegInfo(punkte, hoeheAn) {
  const laengeM = wegLaengeM(punkte);
  const leer = { laengeM, keineHoehe: false, startH: null, zielH: null, hoeheM: null, hoechsterH: null, hoechsterS: null, profil: null, ueberLinieM: null, unterLinieM: null, warnung: false };
  if (!(laengeM > 0)) return leer;
  const proben = profilPunkte(punkte, laengeM);
  const profil = proben.map((p) => ({ s: p.s, h: hoeheAn(p.lat, p.lon) }));
  if (profil.some((p) => p.h === null || p.h === undefined || !Number.isFinite(p.h))) return { ...leer, keineHoehe: true };
  const startH = profil[0].h;
  const zielH = profil[profil.length - 1].h;
  let hoechster = profil[0];
  let ueber = 0; // größte Höhe des Geländes über der geraden Linie Start-Ziel
  let unter = 0; // größte Tiefe unter dieser Linie
  for (const p of profil) {
    if (p.h > hoechster.h) hoechster = p;
    const linie = startH + ((zielH - startH) * p.s) / laengeM;
    ueber = Math.max(ueber, p.h - linie);
    unter = Math.max(unter, linie - p.h);
  }
  return {
    laengeM,
    keineHoehe: false,
    startH,
    zielH,
    hoeheM: Math.round((zielH - startH) * 10) / 10 || 0,
    hoechsterH: hoechster.h,
    hoechsterS: hoechster.s,
    profil,
    ueberLinieM: ueber,
    unterLinieM: unter,
    warnung: ueber > WARN_SCHWELLE_M || unter > WARN_SCHWELLE_M,
  };
}

const gueltigerPunkt = (p) => p && typeof p === 'object' && Number.isFinite(p.lat) && Number.isFinite(p.lon);
const gueltigeAbweichung = (a) => a && typeof a === 'object' && Number.isFinite(a.ueberM) && Number.isFinite(a.unterM) && a.ueberM >= 0 && a.unterM >= 0;
const gueltigesProfil = (pf) => Array.isArray(pf) && pf.length >= 2 && pf.every((x) => x && Number.isFinite(x.s) && Number.isFinite(x.h)) && pf[0].s === 0 && pf.every((x, i) => i === 0 || x.s > pf[i - 1].s);
const alsText = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

// Weg-Zustand aus dem Speicher: fehlende Felder ergänzen (ältere Fassungen hatten nur laengeM/hoeheM), Ungültiges verwerfen
// Ergebnis: { laengeM, hoeheM, punkte, quelle, abweichung, uebernommenSig, uebernommenProfil }
export function normalisiereWeg(w) {
  const roh = w && typeof w === 'object' ? w : {};
  return {
    laengeM: alsText(roh.laengeM),
    hoeheM: alsText(roh.hoeheM),
    punkte: Array.isArray(roh.punkte) ? roh.punkte.filter(gueltigerPunkt).map((p) => ({ lat: p.lat, lon: p.lon })) : [],
    quelle: roh.quelle === 'karte' ? 'karte' : 'hand',
    abweichung: gueltigeAbweichung(roh.abweichung) ? { ueberM: roh.abweichung.ueberM, unterM: roh.abweichung.unterM } : null, // Abweichung des Geländes von der geraden Linie Start-Ziel (aktueller Kartenweg), null ohne Höhendaten
    uebernommenSig: typeof roh.uebernommenSig === 'string' ? roh.uebernommenSig : '', // Signatur der Punkte beim letzten "Weg übernehmen"
    uebernommenProfil: gueltigesProfil(roh.uebernommenProfil) ? roh.uebernommenProfil.map((x) => ({ s: x.s, h: x.h })) : null, // Höhenprofil des übernommenen Wegs [{ s, h }] für den Rechenkern
  };
}

// Hinweis im Ergebnis, wenn die Länge von der Karte stammt
export function faktorHinweis(quelle) {
  if (quelle !== 'karte') return '';
  return 'Die Weglänge stammt von der Karte. Die Merkregel rechnet 6 B-Schläuche je 100 m mit einem Zuschlag von 1,2 auf das Naturmaß. Bei einem eingezeichneten Weg kann dieser Zuschlag teilweise doppelt zählen; die Schlauchzahl ist dann eher großzügig.';
}

// Abweichung des Geländes von der geraden Linie Start-Ziel in Metern (auf 0,1 m gerundet), null ohne Höhendaten
export function abweichungVon(info) {
  if (!info || info.keineHoehe || !info.profil) return null;
  const rund = (m) => Math.round(m * 10) / 10;
  return { ueberM: rund(info.ueberLinieM), unterM: rund(info.unterLinieM) };
}

// Soll gewarnt werden? (mehr als 5 m über oder unter der Linie)
export function abweichungWarnt(abw) {
  return !!abw && (abw.ueberM > WARN_SCHWELLE_M || abw.unterM > WARN_SCHWELLE_M);
}

const komma = (zahl) => String(zahl).replace('.', ',');

// Warntext. vonHand: Länge/Höhe wurden nach dem Übernehmen von Hand geändert (die Warnung gilt trotzdem für den eingezeichneten Weg)
export function warnText(abw, vonHand = false) {
  const ueber = abw.ueberM > WARN_SCHWELLE_M;
  const unter = abw.unterM > WARN_SCHWELLE_M;
  let lage = 'Das Gelände liegt zwischen Start und Ziel ';
  if (ueber && unter) lage += `bis ${komma(abw.ueberM)} m über und bis ${komma(abw.unterM)} m unter der geraden Linie von Start zu Ziel.`;
  else if (ueber) lage += `bis ${komma(abw.ueberM)} m über der geraden Linie von Start zu Ziel.`;
  else lage += `bis ${komma(abw.unterM)} m unter der geraden Linie von Start zu Ziel.`;
  let text = `${lage} Die App rechnet aber mit gleichmäßiger Steigung zwischen Start und Ziel. Dadurch können Pumpenstandorte und Druck falsch sein. Die App rechnet das noch nicht.`;
  if (vonHand) text += ' Länge und Höhe wurden von Hand geändert; die Warnung gilt für den eingezeichneten Weg.';
  return text;
}

// Eindeutige Kennung der Wegpunkte (zum Erkennen, ob der Weg nach "Weg übernehmen" geändert wurde); leer ohne Punkte
export function wegSignatur(punkte) {
  return punkte.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(';');
}

// Wurde der Kartenweg nach dem letzten "Weg übernehmen" geändert? Dann stimmen Länge und Höhe nicht mehr zum Weg.
export function wegVeraltet(w) {
  return w.quelle === 'karte' && typeof w.uebernommenSig === 'string' && w.uebernommenSig !== '' && w.uebernommenSig !== wegSignatur(w.punkte);
}

// Höhenprofil für den Rechenkern: [{ s, h }] mit s = Weg in m ab Start (waagrecht gemessen), h = Höhe in m, auf 0,1 m gerundet.
// Punkte, die nach dem Runden (auf 5 cm) aufeinander fallen, werden zusammengelegt; Start und Ziel bleiben erhalten.
// null ohne Höhendaten oder ohne Weg.
export function profilFuerKern(info) {
  if (!info || info.keineHoehe || !info.profil || info.profil.length < 2) return null;
  const rund = (x) => Math.round(x * 10) / 10;
  const aus = [];
  info.profil.forEach((p, i) => {
    const punkt = { s: Math.round(p.s * 100) / 100, h: rund(p.h) };
    const letzter = aus[aus.length - 1];
    if (letzter && punkt.s - letzter.s < 0.05) {
      if (i === info.profil.length - 1) aus[aus.length - 1] = punkt; // das Ziel darf nicht verloren gehen
      return;
    }
    aus.push(punkt);
  });
  aus[0].s = 0;
  return aus.length >= 2 ? aus : null;
}

// Profil, mit dem gerechnet wird: nur für den übernommenen Kartenweg (Länge und Höhe nicht von Hand geändert, Weg nicht nach
// dem Übernehmen geändert). Sonst null: dann rechnet die App mit gleichmäßiger Steigung zwischen Start und Ziel.
export function profilFuerRechnung(w) {
  if (w.quelle !== 'karte' || wegVeraltet(w)) return null;
  if (typeof w.uebernommenSig !== 'string' || w.uebernommenSig === '') return null;
  return gueltigesProfil(w.uebernommenProfil) ? w.uebernommenProfil : null;
}
