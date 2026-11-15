// Verbindung zwischen Oberfläche und Rechenkern. Keine Oberfläche hier, damit alles testbar bleibt.
import { planeStrecke, pumpePruefen, strahlrohrLiefermenge } from '../../src/kern/foerderung.js';
import { pumpeNachId, EIGENE_PUMPE_ID } from './pumpen.js';

// Mehrzweckstrahlrohre mit ihrem Nenndruck (fett markierte Werte der Tabelle, Landesfeuerwehrschule Tirol)
export const STRAHLROHRE = [
  { id: 'C9', name: 'C-Strahlrohr 9 mm', bar: 4 },
  { id: 'C12', name: 'C-Strahlrohr 12 mm', bar: 5 },
  { id: 'B16', name: 'B-Strahlrohr 16 mm', bar: 6 },
  { id: 'B22', name: 'B-Strahlrohr 22 mm', bar: 7 },
];

function zahl(x) {
  const n = typeof x === 'string' ? Number(x.replace(',', '.')) : x;
  return Number.isFinite(n) ? n : NaN;
}

// strahlrohre: { C9: Anzahl, C12: Anzahl, ... }, eigen: { anzahl, q, bar } (z. B. Hohlstrahlrohr, Hydroschild)
export function wasserbedarf({ strahlrohre = {}, eigen = null, geraete = [] } = {}) {
  let q = 0;
  let barMax = 0;
  const teile = [];
  for (const r of STRAHLROHRE) {
    const n = zahl(strahlrohre[r.id] ?? 0);
    if (n > 0) {
      const je = strahlrohrLiefermenge(r.id, r.bar);
      q += n * je;
      barMax = Math.max(barMax, r.bar);
      teile.push({ name: r.name, anzahl: n, qJe: je, bar: r.bar });
    }
  }
  if (eigen) {
    const n = zahl(eigen.anzahl ?? 0);
    const qe = zahl(eigen.q);
    const be = zahl(eigen.bar);
    if (n > 0) {
      if (!(qe > 0) || !(be > 0)) {
        throw new RangeError('Eigenes Gerät: Liter pro Minute und Druck (bar) müssen größer als 0 sein');
      }
      q += n * qe;
      barMax = Math.max(barMax, be);
      teile.push({ name: 'Eigenes Gerät', anzahl: n, qJe: qe, bar: be });
    }
  }
  // Geräte aus den Fahrzeugen (z. B. Hohlstrahlrohr, Hydroschild): Name, Liter je Stück, Druck, Anzahl
  for (const g of geraete) {
    const n = zahl(g.anzahl ?? 0);
    if (!(n > 0)) continue;
    const qg = zahl(g.q);
    const bg = zahl(g.bar);
    if (!(qg > 0) || !(bg > 0)) {
      throw new RangeError(`${g.name || 'Gerät'}: Liter pro Minute und Druck (bar) müssen im Fahrzeug eingetragen sein`);
    }
    q += n * qg;
    barMax = Math.max(barMax, bg);
    teile.push({ name: g.name || 'Gerät', anzahl: n, qJe: qg, bar: bg });
  }
  return { q, barMax, teile };
}

// Eingabe: { strahlrohre, eigen, weg: { laengeM, hoeheM, profil? }, pumpe: { id, eigeneQ, saughoeheM, alterungProzent } }
// weg.profil (optional): [{ s, h }] Höhenprofil entlang des Wegs (s in m ab Start, aufsteigend, beginnt bei 0). Wird benutzt, wenn
// es gültig ist und sein Ende höchstens 1 % von laengeM abweicht (dann auf laengeM gestreckt); sonst rechnet die Funktion mit
// gleichmäßiger Steigung (laengeM, hoeheM). Das Ergebnis meldet in weg.profilGenutzt, was gilt.
// Ergebnis: { status: 'machbar' | 'nicht_machbar' | 'eingabe_fehlt', titel, gruende: [...], ... }
const PROFIL_TOLERANZ = 0.01;
function profilNutzen(profil, laengeM) {
  if (!Array.isArray(profil) || profil.length < 2) return null;
  const ok = profil.every((p, i) => p && Number.isFinite(p.s) && Number.isFinite(p.h) && (i === 0 ? p.s === 0 : p.s > profil[i - 1].s));
  if (!ok) return null;
  const ende = profil[profil.length - 1].s;
  if (Math.abs(ende / laengeM - 1) > PROFIL_TOLERANZ) return null;
  const faktor = laengeM / ende;
  return profil.map((p) => ({ s: p.s * faktor, h: p.h }));
}

export function berechne(eingabe) {
  const gruende = [];
  let bedarf;
  try {
    bedarf = wasserbedarf(eingabe);
  } catch (e) {
    return { status: 'eingabe_fehlt', titel: 'Eingabe prüfen', gruende: [e.message] };
  }
  if (!(bedarf.q > 0)) {
    return { status: 'eingabe_fehlt', titel: 'Eingabe fehlt', gruende: ['Bitte mindestens ein Strahlrohr wählen.'] };
  }
  const laengeM = zahl(eingabe.weg?.laengeM);
  const hoeheM = zahl(eingabe.weg?.hoeheM ?? 0);
  if (!(laengeM > 0)) {
    return { status: 'eingabe_fehlt', titel: 'Eingabe fehlt', gruende: ['Bitte die Weglänge in Metern eintragen (größer als 0).'] };
  }
  if (!Number.isFinite(hoeheM)) {
    return { status: 'eingabe_fehlt', titel: 'Eingabe prüfen', gruende: ['Der Höhenunterschied muss eine Zahl sein (Steigung +, Gefälle −).'] };
  }

  // Pumpen: entweder eine Liste mit Anzahl je Pumpe (eingabe.pumpen, begrenzt) oder eine einzelne Pumpenart
  // ohne Begrenzung (eingabe.pumpe, gleiche Pumpen so oft wie nötig).
  const saughoeheM = zahl(eingabe.saughoeheM ?? eingabe.pumpe?.saughoeheM ?? 3);
  const verfuegbar = baueListe(eingabe);
  if (verfuegbar.fehler) {
    return { status: 'eingabe_fehlt', titel: 'Eingabe fehlt', gruende: [verfuegbar.fehler] };
  }
  const { pumpen: liste, unbegrenzt } = verfuegbar;

  const edEnde = bedarf.barMax + 1; // Verteiler: Strahlrohrdruck + 1 bar
  const profil = profilNutzen(eingabe.weg?.profil, laengeM);
  const basis = {
    q: bedarf.q,
    edEnde,
    teile: bedarf.teile,
    weg: { laengeM, hoeheM, profilGenutzt: profil !== null },
    annahmen: { saughoeheM },
  };

  let r;
  try {
    r = planeStrecke({
      q: bedarf.q,
      profil: profil ?? [{ s: 0, h: 0 }, { s: laengeM, h: hoeheM }],
      edEnde,
    });
  } catch (e) {
    return { ...basis, status: 'nicht_machbar', titel: 'NICHT MACHBAR', gruende: [e.message] };
  }

  // jeder Standort bekommt eine Pumpe; stärkste Pumpe an die Wasserentnahme (Merkregel der Schule)
  const zuordnung = [];
  for (let i = 0; i < r.anzahlPumpen; i++) {
    const pumpe = unbegrenzt ? liste[0] : liste[i];
    if (!pumpe) {
      zuordnung.push({ pumpe: null, pruefung: null });
      continue;
    }
    zuordnung.push({
      pumpe,
      pruefung: pumpePruefen({
        pumpe: { q: pumpe.q, bar: 10 },
        q: bedarf.q,
        saughoeheM: i === 0 ? saughoeheM : 3,
        alterungProzent: pumpe.alterungProzent,
      }),
    });
  }

  const satz = (wer, pumpe, x) =>
    `${wer} (${pumpe.name}) ${wer.startsWith('Pumpen ') ? 'schaffen' : 'schafft'} ${Math.floor(x.verfuegbar)} l/min, gebraucht werden ${Math.ceil(x.benoetigt)} l/min (es fehlen ${Math.ceil(x.fehlt)} l/min).`;
  const z0 = zuordnung[0];
  if (z0.pruefung && !z0.pruefung.ok) gruende.push(satz('Pumpe 1 (Entnahme)', z0.pumpe, z0.pruefung));
  // weitere Pumpen: gleiche Pumpe mit gleichem Ergebnis hintereinander zusammenfassen
  let i = 1;
  while (i < zuordnung.length) {
    const z = zuordnung[i];
    if (!z.pumpe || z.pruefung.ok) { i++; continue; }
    let j = i;
    while (
      j + 1 < zuordnung.length &&
      zuordnung[j + 1].pumpe &&
      !zuordnung[j + 1].pruefung.ok &&
      zuordnung[j + 1].pumpe.name === z.pumpe.name &&
      zuordnung[j + 1].pruefung.verfuegbar === z.pruefung.verfuegbar
    ) j++;
    const wer = i === j ? `Pumpe ${i + 1}` : `Pumpen ${i + 1} bis ${j + 1}`;
    gruende.push(satz(wer, z.pumpe, z.pruefung));
    i = j + 1;
  }
  const aus = eingabe.pumpenQuelle === 'liste'; // Einsatz: Pumpen aus der Materialliste der Feuerwehr
  const fehlende = zuordnung.filter((z) => !z.pumpe).length;
  if (fehlende > 0) {
    gruende.push(
      `Es werden ${r.anzahlPumpen} Pumpen gebraucht, ${aus ? 'in der Liste sind' : 'gewählt sind'} ${r.anzahlPumpen - fehlende} (es ${fehlende === 1 ? 'fehlt' : 'fehlen'} ${fehlende} ${fehlende === 1 ? 'Pumpe' : 'Pumpen'}).`
    );
  }

  // Tipps, was sich ändern lässt (nur wenn nicht machbar)
  const tipps = [];
  const bewertet = zuordnung.filter((z) => z.pruefung);
  if (bewertet.some((z) => !z.pruefung.ok)) {
    const schwaechste = Math.min(...bewertet.map((z) => z.pruefung.verfuegbar));
    tipps.push(`Weniger Wasser: bis ${Math.floor(schwaechste)} l/min schaffen alle gewählten Pumpen. Oder stärkere Pumpen ${aus ? 'verwenden' : 'wählen'}.`);
  }
  if (fehlende > 0) {
    tipps.push(
      `${fehlende} weitere ${fehlende === 1 ? 'Pumpe' : 'Pumpen'} ${aus ? 'in die Liste eintragen' : 'wählen'}, jede mit mindestens ${Math.ceil(bedarf.q)} l/min. Oder weniger Wasser, dann sinkt der Druckverlust und es werden weniger Pumpen gebraucht.`
    );
  }

  // B-Schläuche der Materialliste: nur prüfen, wenn eine Zahl eingetragen ist (leer = nicht geprüft)
  const vb = eingabe.vorhandeneB;
  const vorhandeneB = vb === null || vb === undefined || vb === '' ? NaN : zahl(vb);
  let schlauchGeprueft = false;
  if (Number.isFinite(vorhandeneB)) {
    schlauchGeprueft = true;
    if (r.schlauchB > vorhandeneB) {
      gruende.push(`Es werden ${r.schlauchB} B-Schläuche (20 m) gebraucht, vorhanden sind ${vorhandeneB} (es ${r.schlauchB - vorhandeneB === 1 ? 'fehlt' : 'fehlen'} ${r.schlauchB - vorhandeneB}).`);
      tipps.push('Die Schlauchzahl hängt nur von der Weglänge ab (Merkregel). Mehr Schläuche bereitstellen oder einen kürzeren Weg wählen.');
    }
  }

  // Strahlrohre der Fahrzeuge: je Art nur prüfen, wenn eine Zahl eingetragen ist (leer = nicht geprüft)
  let rohreGeprueft = false;
  const vr = eingabe.vorhandeneRohre;
  if (vr) {
    for (const rohr of STRAHLROHRE) {
      const geplant = zahl(eingabe.strahlrohre?.[rohr.id] ?? 0);
      const v = vr[rohr.id];
      const vorhanden = v === '' || v === null || v === undefined ? NaN : zahl(v);
      if (!(geplant > 0) || !Number.isFinite(vorhanden)) continue;
      rohreGeprueft = true;
      if (geplant > vorhanden) {
        const fehlt = geplant - vorhanden;
        gruende.push(`Es werden ${geplant} × ${rohr.name} gebraucht, vorhanden sind ${vorhanden} (es ${fehlt === 1 ? 'fehlt' : 'fehlen'} ${fehlt}).`);
        tipps.push(`Weniger ${rohr.name} wählen (Wassermenge ändern) oder ein weiteres Fahrzeug ausrücken lassen.`);
      }
    }
  }

  // Geräte der Fahrzeuge: nur prüfen, wenn "vorhanden" eine Zahl ist
  let geraeteGeprueft = false;
  for (const g of eingabe.geraete ?? []) {
    const geplant = zahl(g.anzahl ?? 0);
    const vorhanden = g.vorhanden === '' || g.vorhanden === null || g.vorhanden === undefined ? NaN : zahl(g.vorhanden);
    if (!(geplant > 0) || !Number.isFinite(vorhanden)) continue;
    geraeteGeprueft = true;
    if (geplant > vorhanden) {
      const fehlt = geplant - vorhanden;
      gruende.push(`Es werden ${geplant} × ${g.name} gebraucht, vorhanden sind ${vorhanden} (es ${fehlt === 1 ? 'fehlt' : 'fehlen'} ${fehlt}).`);
      tipps.push(`Weniger ${g.name} wählen (Wassermenge ändern) oder ein weiteres Fahrzeug ausrücken lassen.`);
    }
  }

  return {
    ...basis,
    geraeteGeprueft,
    rohreGeprueft,
    schlauchGeprueft,
    tipps,
    status: gruende.length === 0 ? 'machbar' : 'nicht_machbar',
    titel: gruende.length === 0 ? 'MACHBAR' : 'NICHT MACHBAR',
    gruende,
    anzahlPumpen: r.anzahlPumpen,
    pumpenNaturmassM: r.pumpen,
    pumpenNamen: zuordnung.map((z) => (z.pumpe ? z.pumpe.name : null)),
    schlauchB: r.schlauchB,
    schlauchM: r.schlauchM,
    druckEnde: r.druckEnde,
    pumpenpruefung: zuordnung.map((z) => z.pruefung),
  };
}

// Baut die Pumpenliste, stärkste (nach Alterung) zuerst.
// eingabe.pumpen: [{ id, anzahl, eigeneQ, alterungProzent }] oder eingabe.pumpe: { id, eigeneQ, alterungProzent }
function baueListe(eingabe) {
  const nennwert = (id, eigeneQ) => {
    if (id === EIGENE_PUMPE_ID) {
      const q10 = zahl(eigeneQ);
      return q10 > 0 ? { name: 'Eigene Pumpe', q: q10 } : null;
    }
    const bekannt = pumpeNachId(id);
    return bekannt ? { name: bekannt.name, q: bekannt.q } : null;
  };
  if (Array.isArray(eingabe.pumpen)) {
    const liste = [];
    for (const e of eingabe.pumpen) {
      const n = zahl(e.anzahl ?? 0);
      if (!(n > 0)) continue;
      const w = nennwert(e.id, e.eigeneQ);
      if (!w) {
        return { fehler: e.id === EIGENE_PUMPE_ID
          ? 'Eigene Pumpe: bitte den Förderstrom in l/min bei 10 bar eintragen.'
          : 'Unbekannte Pumpe in der Auswahl.' };
      }
      const alt = zahl(e.alterungProzent ?? 0);
      for (let k = 0; k < n; k++) liste.push({ ...w, alterungProzent: alt, wirksam: w.q * (1 - alt / 100) });
    }
    if (liste.length === 0) return { fehler: 'Bitte mindestens eine Pumpe wählen (Anzahl größer als 0).' };
    liste.sort((a, b) => b.wirksam - a.wirksam);
    return { pumpen: liste, unbegrenzt: false };
  }
  const p = eingabe.pumpe ?? {};
  if (p.id === EIGENE_PUMPE_ID && !(zahl(p.eigeneQ) > 0)) {
    return { fehler: 'Eigene Pumpe: bitte den Förderstrom in l/min bei 10 bar eintragen.' };
  }
  const w = nennwert(p.id, p.eigeneQ);
  if (!w) return { fehler: 'Bitte eine Pumpe wählen.' };
  return { pumpen: [{ ...w, alterungProzent: zahl(p.alterungProzent ?? 0) }], unbegrenzt: true };
}

// ---- Feuerwehr mit mehreren Fahrzeugen (Einsatz) ----
// fahrzeuge: [{ id, name, pumpen: { pumpenId: { anzahl, alterungProzent, eigeneQ } }, bSchlaeuche: Zahl oder '' }]
// Die Pumpen aller ausgewählten Fahrzeuge werden zusammengelegt (jedes Fahrzeug behält seine Alterungswerte).
export function einsatzPumpen(fahrzeuge) {
  const eintraege = [];
  for (const f of fahrzeuge) {
    for (const [id, e] of Object.entries(f.pumpen ?? {})) {
      const n = zahl(e.anzahl ?? 0);
      if (n > 0) eintraege.push({ id, anzahl: n, alterungProzent: e.alterungProzent ?? 0, eigeneQ: e.eigeneQ });
    }
  }
  return eintraege;
}

// Summe der eingetragenen B-Schläuche (je 20 m) aller ausgewählten Fahrzeuge.
// Ist bei keinem Fahrzeug eine Zahl eingetragen, kommt '' zurück (= nicht prüfen).
export function einsatzSchlaeuche(fahrzeuge) {
  let summe = 0;
  let eingetragen = false;
  for (const f of fahrzeuge) {
    const n = f.bSchlaeuche === '' || f.bSchlaeuche === null || f.bSchlaeuche === undefined ? NaN : zahl(f.bSchlaeuche);
    if (Number.isFinite(n)) { summe += n; eingetragen = true; }
  }
  return eingetragen ? summe : '';
}

// Summe der eingetragenen Strahlrohre je Art aller ausgewählten Fahrzeuge ('' = bei keinem Fahrzeug eingetragen)
export function einsatzStrahlrohre(fahrzeuge) {
  const ergebnis = {};
  for (const rohr of STRAHLROHRE) {
    let summe = 0;
    let eingetragen = false;
    for (const f of fahrzeuge) {
      const v = f.strahlrohre?.[rohr.id];
      const n = v === '' || v === null || v === undefined ? NaN : zahl(v);
      if (Number.isFinite(n)) { summe += n; eingetragen = true; }
    }
    ergebnis[rohr.id] = eingetragen ? summe : '';
  }
  return ergebnis;
}

// Geräte aller ausgewählten Fahrzeuge zusammenfassen: gleiche Geräte (Name, Liter, Druck) werden addiert.
// fahrzeuge: [{ geraete: [{ name, q, bar, anzahl }] }] -> [{ key, name, q, bar, vorhanden }]
export function einsatzGeraete(fahrzeuge) {
  const karte = new Map();
  for (const f of fahrzeuge) {
    for (const g of f.geraete ?? []) {
      const n = zahl(g.anzahl ?? 0);
      if (!(n > 0)) continue;
      const name = String(g.name ?? '').trim() || 'Gerät';
      const key = `${name}|${g.q}|${g.bar}`;
      const alt = karte.get(key);
      if (alt) alt.vorhanden += n;
      else karte.set(key, { key, name, q: g.q, bar: g.bar, vorhanden: n });
    }
  }
  return [...karte.values()];
}
