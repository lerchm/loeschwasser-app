// Rechenkern Löschwasserförderung (nur B-Schlauch 75 mm, siehe CLAUDE.md).
// Regel aus ÖBFV FLA Gold: Gibt es keinen Tabellenwert, gilt der nächsthöhere Tabellenwert.
// Es wird nichts geschätzt: außerhalb der Tabellen gibt es einen Fehler statt eines Ersatzwerts.
import {
  RV_B75_PRO_100M,
  SAUGHOEHE_PROZENT,
  STRAHLROHR_LIEFERMENGE,
  PUMPEN_NENN,
  REGELN,
  SCHLAUCH_FAKTOR,
} from './daten.js';

const EPS = 1e-9;

function pruefeZahl(wert, name) {
  if (typeof wert !== 'number' || !Number.isFinite(wert)) {
    throw new TypeError(`${name} muss eine Zahl sein`);
  }
}

// Reibungsverlust in bar je 100 m für B 75 mm bei Förderstrom q (l/min)
export function reibungsverlustPro100m(q) {
  pruefeZahl(q, 'Förderstrom');
  if (q < 0) throw new RangeError('Förderstrom darf nicht negativ sein');
  if (q === 0) return 0;
  const hoechster = RV_B75_PRO_100M[RV_B75_PRO_100M.length - 1].q;
  if (q > hoechster) {
    throw new RangeError(`Förderstrom ${q} l/min liegt außerhalb der Tabelle (max. ${hoechster} l/min)`);
  }
  // nächsthöherer Tabellenwert
  return RV_B75_PRO_100M.find((z) => z.q >= q - EPS).bar;
}

// Reibungsverlust in bar für eine Schlauchleitung
export function reibungsverlust(q, laengeM) {
  pruefeZahl(laengeM, 'Länge');
  if (laengeM < 0) throw new RangeError('Länge darf nicht negativ sein');
  return (reibungsverlustPro100m(q) * laengeM) / 100;
}

// Höhenverlust in bar: Steigung (hoeheM > 0) kostet Druck, Gefälle (hoeheM < 0) bringt Druck
export function hoehenverlust(hoeheM) {
  pruefeZahl(hoeheM, 'Höhenunterschied');
  return (hoeheM / 10) * REGELN.steigungBarJe10m;
}

// Anteil der Pumpenleistung (0 bis 1) bei geodätischer Saughöhe hs (m); nächsthöhere Saughöhe der Tabelle
export function saughoeheFaktor(hs) {
  pruefeZahl(hs, 'Saughöhe');
  if (hs < 0) throw new RangeError('Saughöhe darf nicht negativ sein');
  const hoechste = SAUGHOEHE_PROZENT[SAUGHOEHE_PROZENT.length - 1].hs;
  if (hs > hoechste) {
    throw new RangeError(`Saughöhe ${hs} m liegt außerhalb der Tabelle (max. ${hoechste} m)`);
  }
  return SAUGHOEHE_PROZENT.find((z) => z.hs >= hs - EPS).prozent / 100;
}

// Förderstrom einer Pumpe in l/min bei ihrem Nennausgangsdruck.
// Alterung: X % Alterung = X % weniger Förderstrom bei gleichem Druck (Festlegung Michael).
export function pumpenFoerderstrom(pumpe, { saughoeheM = 3, alterungProzent = 0 } = {}) {
  const nenn = typeof pumpe === 'string' ? PUMPEN_NENN[pumpe] : pumpe;
  if (!nenn) throw new RangeError(`Unbekannte Pumpe: ${pumpe}`);
  pruefeZahl(alterungProzent, 'Alterung');
  if (alterungProzent < 0 || alterungProzent >= 100) {
    throw new RangeError('Alterung muss zwischen 0 und unter 100 Prozent liegen');
  }
  return nenn.q * saughoeheFaktor(saughoeheM) * (1 - alterungProzent / 100);
}

// Prüft, ob eine Pumpe den verlangten Förderstrom schafft.
// Bekannt ist nur der Nennpunkt (Förderstrom bei 10 bar, 3 m Saughöhe, siehe daten.js). Bei kleinerem
// Ausgangsdruck liefert die Pumpe mehr, bei diesem Kern rechnen wir bewusst mit dem Nennwert (auf der sicheren Seite).
// Saughöhe und Alterung vermindern den Förderstrom (Saughöhe: Tabelle, Alterung: Festlegung Michael).
export function pumpePruefen({ pumpe, q, saughoeheM = 3, alterungProzent = 0 }) {
  pruefeZahl(q, 'Förderstrom');
  const verfuegbar = pumpenFoerderstrom(pumpe, { saughoeheM, alterungProzent });
  return {
    ok: q <= verfuegbar + EPS,
    benoetigt: q,
    verfuegbar,
    fehlt: Math.max(0, q - verfuegbar),
  };
}

// Wasserlieferung eines Strahlrohrs in l/min bei einem Druck laut Tabelle (kein Zwischenwert)
export function strahlrohrLiefermenge(rohr, bar) {
  const zeile = STRAHLROHR_LIEFERMENGE[rohr];
  if (!zeile) throw new RangeError(`Unbekanntes Strahlrohr: ${rohr}`);
  const wert = zeile[bar];
  if (wert === undefined) {
    throw new RangeError(`Für ${rohr} gibt es bei ${bar} bar keinen Tabellenwert`);
  }
  return wert;
}

// Mögliche Länge einer Förderstrecke bis zur nächsten Pumpe (Formeln der Landesfeuerwehrschule):
// eben:      L = (AD − ED) / RV × 100
// Steigung:  L = (AD − ED − DV) / RV × 100
// Gefälle:   L = (AD − ED + DG) / RV × 100   (hier: hoeheM negativ)
// hoeheM ist der Höhenunterschied der Strecke (Steigung positiv, Gefälle negativ).
export function streckenLaenge({ q, ad, ed, hoeheM = 0 }) {
  pruefeZahl(ad, 'Ausgangsdruck');
  pruefeZahl(ed, 'Eingangsdruck');
  const rv = reibungsverlustPro100m(q);
  if (rv === 0) throw new RangeError('Bei Förderstrom 0 ist die Länge unbegrenzt');
  return ((ad - ed - hoehenverlust(hoeheM)) / rv) * 100;
}

// Nötiger Ausgangsdruck der Pumpe für eine Strecke: AD = ED + RV + DV
export function ausgangsdruck({ q, laengeM, hoeheM = 0, ed }) {
  pruefeZahl(ed, 'Eingangsdruck');
  return ed + reibungsverlust(q, laengeM) + hoehenverlust(hoeheM);
}

// Höhe entlang des Wegs durch lineare Zwischenwerte zwischen den Profilpunkten { s, h } (s in m)
function hoeheBei(profil, s) {
  if (s <= profil[0].s) return profil[0].h;
  const letzter = profil[profil.length - 1];
  if (s >= letzter.s) return letzter.h;
  for (let i = 1; i < profil.length; i++) {
    if (s <= profil[i].s) {
      const a = profil[i - 1];
      const b = profil[i];
      return a.h + ((b.h - a.h) * (s - a.s)) / (b.s - a.s);
    }
  }
  return letzter.h;
}

// Schlauchbedarf nach Merkregel der Landesfeuerwehrschule: 6 B-Druckschläuche für 100 m Naturmaß
// (Faktor 1,2: 120 m Schlauch je 100 m Weg).
export function schlauchBedarf(naturmassM, schlauchFaktor = SCHLAUCH_FAKTOR, schlauchLaengeM = REGELN.schlauchLaengeM) {
  pruefeZahl(naturmassM, 'Naturmaß');
  if (naturmassM < 0) throw new RangeError('Naturmaß darf nicht negativ sein');
  const schlauchM = naturmassM * schlauchFaktor;
  return {
    schlauchM,
    schlauchB: Math.max(0, Math.ceil(schlauchM / schlauchLaengeM - EPS)),
  };
}

// Pumpen entlang eines Wegs platzieren.
// profil: [{ s: Naturmaß in m (Weg im Gelände), h: Höhe in m }], aufsteigend nach s, beginnt bei s = 0
// q: Förderstrom l/min; ad: Ausgangsdruck jeder Pumpe; edMin: Mindest-Eingangsdruck der nächsten Pumpe
// edEnde: Mindestdruck am Ende (Verteiler: Strahlrohrdruck + 1 bar), Pflichtangabe
// schlauchFaktor: Meter Schlauch je Meter Naturmaß (Standard 1,2 nach Merkregel, siehe daten.js)
// pumpe: optional { pumpe, saughoeheM, alterungProzent }. Die erste Pumpe (Entnahme) saugt mit saughoeheM an,
//        alle weiteren Pumpen bekommen Wasser mit Druck aus der Leitung (keine Saughöhe). Alterung gilt für alle.
// Reibungsverlust wird auf die tatsächliche Schlauchlänge gerechnet, die Höhe am Weg im Gelände.
// Pumpen stehen immer an Kupplungen, also an Vielfachen der Schlauchlänge (20 m Schlauch).
export function planeStrecke({
  q,
  profil,
  ad = REGELN.adMaxBar,
  edMin = REGELN.edMinBar,
  edEnde,
  schlauchFaktor = SCHLAUCH_FAKTOR,
  schlauchLaengeM = REGELN.schlauchLaengeM,
  pumpe = null,
}) {
  pruefeZahl(edEnde, 'Druck am Ende (Verteiler)');
  pruefeZahl(schlauchFaktor, 'Schlauchfaktor');
  if (schlauchFaktor <= 0) throw new RangeError('Der Schlauchfaktor muss größer als 0 sein');
  if (!Array.isArray(profil) || profil.length < 2) {
    throw new RangeError('Das Profil braucht mindestens zwei Punkte');
  }
  if (profil[0].s !== 0) throw new RangeError('Das Profil muss bei s = 0 beginnen');
  if (ad > REGELN.adMaxBar + EPS) {
    throw new RangeError(`Ausgangsdruck ${ad} bar liegt über dem Höchstwert ${REGELN.adMaxBar} bar`);
  }
  const naturEnde = profil[profil.length - 1].s;
  const schlauchEnde = naturEnde * schlauchFaktor; // m Schlauch
  const rvJeM = reibungsverlustPro100m(q) / 100; // bar je m Schlauch
  const natur = (schlauchPos) => schlauchPos / schlauchFaktor;

  const pumpenSchlauchM = [0];
  let pPumpe = 0; // Schlauchposition der letzten Pumpe
  let pos = 0;
  let druckEnde = null;

  const druckBei = (px) =>
    ad -
    rvJeM * (px - pPumpe) -
    hoehenverlust(hoeheBei(profil, natur(px)) - hoeheBei(profil, natur(pPumpe)));

  while (pos < schlauchEnde - EPS) {
    const naechster = Math.min(pos + schlauchLaengeM, schlauchEnde);
    const istEnde = naechster >= schlauchEnde - EPS;
    const verlangt = istEnde ? edEnde : edMin;
    if (druckBei(naechster) < verlangt - EPS) {
      if (pos === pPumpe) {
        throw new RangeError(
          `Strecke bei ${natur(pos).toFixed(0)} m nicht überbrückbar: schon der nächste Schlauch unterschreitet ${verlangt} bar`
        );
      }
      pumpenSchlauchM.push(pos);
      pPumpe = pos;
      continue; // gleichen Schritt mit neuer Pumpe noch einmal prüfen
    }
    pos = naechster;
    if (istEnde) druckEnde = druckBei(pos);
  }

  let pumpenpruefung = null;
  let foerderstromMoeglich = null;
  if (pumpe) {
    pumpenpruefung = pumpenSchlauchM.map((_, i) =>
      pumpePruefen({
        pumpe: pumpe.pumpe,
        q,
        saughoeheM: i === 0 ? pumpe.saughoeheM ?? 3 : 3,
        alterungProzent: pumpe.alterungProzent ?? 0,
      })
    );
    foerderstromMoeglich = pumpenpruefung.every((x) => x.ok);
  }

  return {
    pumpenpruefung,
    foerderstromMoeglich,
    pumpen: pumpenSchlauchM.map(natur), // Naturmaß in m
    pumpenSchlauchM,
    anzahlPumpen: pumpenSchlauchM.length,
    schlauchM: schlauchEnde,
    schlauchB: Math.max(0, Math.ceil(schlauchEnde / schlauchLaengeM - EPS)),
    druckEnde,
  };
}
