import { STRAHLROHRE, berechne, wasserbedarf, einsatzPumpen, einsatzSchlaeuche, einsatzStrahlrohre, einsatzGeraete } from './berechnung.js';
import { PUMPEN, EIGENE_PUMPE_ID, pumpeNachId } from './pumpen.js';
import { strahlrohrLiefermenge } from '../../src/kern/foerderung.js';
import { erzeugeKarte } from './karte.js';
import { ladeHoehenraster } from './hoehen.js';
import { starteWegkarte } from './wegkarte.js';
import { startOffline } from './offline.js';
import { normalisiereWeg, faktorHinweis, warnText, abweichungWarnt, wegVeraltet, profilFuerRechnung } from './weg.js';

const $ = (id) => document.getElementById(id);
const SPEICHER = 'loeschwasser-app-v1';

const neuesFahrzeug = (name) => ({ id: 'fz' + Date.now() + Math.floor(Math.random() * 1000), name, pumpen: {}, bSchlaeuche: '', strahlrohre: leereRohre(), geraete: [] });
function leereRohre() { return { C9: '', C12: '', B16: '', B22: '' }; }

const standard = () => {
  const f = neuesFahrzeug('Fahrzeug 1');
  return {
    strahlrohre: {},
    eigen: { anzahl: 0, q: '', bar: '' },
    weg: { laengeM: '', hoeheM: '', punkte: [], quelle: 'hand' },
    saughoeheM: '3',
    modus: 'einsatz', // 'einsatz': Pumpen der ausgewählten Fahrzeuge, 'training': Pumpen frei wählen
    pumpen: {}, // Training: id -> { anzahl, alterungProzent, eigeneQ }
    feuerwehr: { name: 'Meine Feuerwehr' },
    fahrzeuge: [f], // Einsatz: Fahrzeuge der Feuerwehr mit Ausrüstung
    ausgewaehlt: [f.id], // Fahrzeuge, die ausrücken
    geraeteWahl: {}, // Einsatz: Gerät (key) -> geplante Anzahl
    theme: 'dark',
  };
};

function laden() {
  const z = standard();
  try {
    const roh = localStorage.getItem(SPEICHER);
    if (roh) {
      const alt = JSON.parse(roh);
      Object.assign(z, alt);
      if (alt.pumpe) { z.saughoeheM = alt.pumpe.saughoeheM ?? z.saughoeheM; delete z.pumpe; } // erste Fassung: eine Pumpe
      if (Array.isArray(alt.listen)) { // zweite Fassung: Listen waren die Fahrzeuge
        z.fahrzeuge = alt.listen.map((l) => ({ id: l.id, name: l.name, pumpen: l.pumpen ?? {}, bSchlaeuche: l.bSchlaeuche ?? '', strahlrohre: leereRohre() }));
        z.ausgewaehlt = alt.aktiveListe ? [alt.aktiveListe] : z.fahrzeuge.map((f) => f.id);
        delete z.listen; delete z.aktiveListe; delete z.nutzen;
      }
      z.weg = normalisiereWeg(z.weg);
      if (!z.feuerwehr || typeof z.feuerwehr !== 'object') z.feuerwehr = { name: 'Meine Feuerwehr' };
      if (!Array.isArray(z.fahrzeuge)) z.fahrzeuge = [];
      for (const f of z.fahrzeuge) { f.strahlrohre = { ...leereRohre(), ...(f.strahlrohre ?? {}) }; delete f.standrohre; if (!Array.isArray(f.geraete)) f.geraete = []; }
      z.ausgewaehlt = (z.ausgewaehlt ?? []).filter((id) => z.fahrzeuge.some((f) => f.id === id));
    }
  } catch (e) { /* Speicher nicht verfügbar: ohne Speichern weiter */ }
  return z;
}
function speichern() {
  try { localStorage.setItem(SPEICHER, JSON.stringify(zustand)); } catch (e) { /* ignorieren */ }
}

const zustand = laden();
const istEinsatz = () => zustand.modus === 'einsatz';
// Geräte der ausgewählten Fahrzeuge mit der in dieser Planung gewählten Anzahl (nur Einsatz)
function gewaehlteGeraete() {
  if (!istEinsatz()) return [];
  return einsatzGeraete(ausgewaehlteFahrzeuge()).map((g) => ({ ...g, anzahl: Number(zustand.geraeteWahl[g.key]) || 0 }));
}
const bedarfEingabe = () => ({ strahlrohre: zustand.strahlrohre, eigen: zustand.eigen, geraete: gewaehlteGeraete() });
const ausgewaehlteFahrzeuge = () => zustand.fahrzeuge.filter((f) => zustand.ausgewaehlt.includes(f.id));
let bearbeiteId = null; // Fahrzeug, das gerade bearbeitet wird
let korrektur = false; // true: man ist vom Ergebnis zum Ändern zurückgesprungen

// ---------- Navigation ----------
const titel = {
  's-start': 'Wasserförderung', 's-wasser': 'Wasserbedarf', 's-weg': 'Weg', 's-pumpe': 'Pumpen',
  's-listen': 'Fahrzeuge', 's-bestand': 'Fahrzeug', 's-ergebnis': 'Ergebnis', 's-info': 'Info und Rechtliches',
};
const ablauf = ['s-wasser', 's-weg', 's-ergebnis'];
let aktuell = 's-start';
const verlauf = [];

function zeige(id, merken = true) {
  if (aktuell === 's-weg' && id !== 's-weg') wegkarte?.standortEntfernen(); // Standort nicht länger anzeigen als nötig
  if (merken && aktuell !== id) verlauf.push(aktuell);
  aktuell = id;
  if (id === 's-start' || id === 's-ergebnis') korrektur = false;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  $('title').textContent = titel[id];
  $('back').style.visibility = id === 's-start' ? 'hidden' : 'visible';
  const imAblauf = ablauf.includes(id);
  $('bottom').style.display = imAblauf ? 'flex' : 'none';
  if (imAblauf) {
    const letzter = ablauf.indexOf(id) === ablauf.length - 1;
    $('next').textContent = korrektur ? 'Zum Ergebnis' : letzter ? 'Neu' : 'Weiter';
    $('prev').style.display = korrektur ? 'none' : 'flex';
  }
  if (id === 's-ergebnis') zeigeErgebnis();
  if (id === 's-wasser') { baueGeraeteWahl(); rohrHinweise(); aktualisiereSumme(); }
  if (id === 's-start') zeigeStart();
  if (id === 's-weg') zeigeKarte();
  if (id === 's-listen') baueFahrzeuge();
  if (id === 's-bestand') baueBestand();
  neuZeichnen();
}
// Erzwingt ein sauberes Neuzeichnen und setzt das Scrollen zurück (gegen stehengebliebene Bildreste im Browser)
function neuZeichnen() {
  const main = document.querySelector('main');
  main.style.display = 'none';
  void main.offsetHeight;
  main.style.display = '';
  main.scrollTop = 0;
  requestAnimationFrame(() => { main.scrollTop = 0; });
}
const zurueck = () => zeige(verlauf.pop() || 's-start', false);
// Vom Ergebnis direkt zu einer Eingabe springen; danach geht es mit einem Knopf zurück zum Ergebnis
function aendernNach(id) {
  korrektur = ablauf.includes(id);
  zeige(id);
}

document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => zeige(b.dataset.go)));
$('back').onclick = zurueck;
$('prev').onclick = () => { const i = ablauf.indexOf(aktuell); zeige(i > 0 ? ablauf[i - 1] : 's-start', false); };
$('next').onclick = () => {
  if (korrektur) { korrektur = false; verlauf.length = 0; verlauf.push('s-start'); zeige('s-ergebnis', false); return; }
  const i = ablauf.indexOf(aktuell);
  if (i < ablauf.length - 1) zeige(ablauf[i + 1]);
  else { verlauf.length = 0; zeige('s-start', false); }
};
$('pumpeFertig').onclick = zurueck;
$('listenFertig').onclick = zurueck;
$('bestandFertig').onclick = zurueck;

// ---------- Tag / Nacht ----------
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('theme').textContent = t === 'dark' ? 'Tag' : 'Nacht';
  zustand.theme = t;
  speichern();
}
$('theme').onclick = () => setTheme(zustand.theme === 'dark' ? 'light' : 'dark');

// ---------- Einsatz / Training ----------
function zeigeModus() {
  document.querySelectorAll('#modus button').forEach((b) => b.classList.toggle('sel', b.dataset.m === zustand.modus));
  $('modusHinweis').textContent = istEinsatz()
    ? 'Einsatz: Pumpen und Schläuche kommen von den ausgewählten Fahrzeugen der Feuerwehr.'
    : 'Training: Pumpen frei wählen, zum Durchspielen. Die Fahrzeuge der Feuerwehr werden nicht verwendet.';
  $('statusText').textContent = istEinsatz() ? 'Einsatz · Daten 11.11.2026' : 'TRAINING · Daten 11.11.2026';
  $('startPumpeBtn').style.display = istEinsatz() ? 'none' : 'flex';
}
document.querySelectorAll('#modus button').forEach((b) => {
  b.onclick = () => { zustand.modus = b.dataset.m; speichern(); zeigeStart(); };
});
function zeigeStart() {
  zeigeModus();
  const n = zustand.fahrzeuge.length;
  $('startListeText').textContent = `${zustand.feuerwehr.name} · ${zustand.ausgewaehlt.length} von ${n} ${n === 1 ? 'Fahrzeug' : 'Fahrzeugen'} ausgewählt`;
  $('startPumpe').textContent = pumpenText();
}

// ---------- Wasserbedarf ----------
function baueRohre() {
  const box = $('rohre');
  box.innerHTML = '';
  for (const r of STRAHLROHRE) {
    const je = strahlrohrLiefermenge(r.id, r.bar);
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<div class="row"><span style="font-size:19px"><b></b><br><span class="hint"></span></span>
      <div class="stepper"><button aria-label="weniger">−</button><span>0</span><button aria-label="mehr">+</button></div></div>`;
    div.querySelector('b').textContent = r.name;
    div.querySelector('.hint').dataset.basis = `${je} l/min bei ${r.bar} bar`;
    div.dataset.rohr = r.id;
    const zahl = div.querySelector('.stepper span');
    const [minus, , plus] = div.querySelector('.stepper').children;
    zahl.textContent = zustand.strahlrohre[r.id] ?? 0;
    const setze = (d) => {
      const n = Math.max(0, (Number(zustand.strahlrohre[r.id]) || 0) + d);
      zustand.strahlrohre[r.id] = n;
      zahl.textContent = n;
      aktualisiereSumme();
    };
    minus.onclick = () => setze(-1);
    plus.onclick = () => setze(1);
    box.appendChild(div);
  }
}
// Im Einsatz zeigt jede Strahlrohr-Art, wie viele die ausgewählten Fahrzeuge haben
function baueGeraeteWahl() {
  const box = $('geraeteWahl');
  box.innerHTML = '';
  if (!istEinsatz()) return;
  for (const g of einsatzGeraete(ausgewaehlteFahrzeuge())) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<div class="row"><span style="font-size:19px"><b class="n"></b><br><span class="hint s"></span></span>
      <div class="stepper"><button aria-label="weniger">−</button><span class="z">0</span><button aria-label="mehr">+</button></div></div>`;
    div.querySelector('.n').textContent = g.name;
    const okQ = Number(g.q) > 0 && Number(g.bar) > 0;
    div.querySelector('.s').textContent = (okQ ? `${g.q} l/min bei ${g.bar} bar` : 'Liter und Druck fehlen im Fahrzeug') + ` · vorhanden: ${g.vorhanden}`;
    const z = div.querySelector('.z');
    z.textContent = Number(zustand.geraeteWahl[g.key]) || 0;
    const [minus, , plus] = div.querySelector('.stepper').children;
    const setze = (d) => {
      const n = Math.max(0, (Number(zustand.geraeteWahl[g.key]) || 0) + d);
      zustand.geraeteWahl[g.key] = n; z.textContent = n; aktualisiereSumme();
    };
    minus.onclick = () => setze(-1);
    plus.onclick = () => setze(1);
    box.appendChild(div);
  }
}
function rohrHinweise() {
  const vorhanden = istEinsatz() ? einsatzStrahlrohre(ausgewaehlteFahrzeuge()) : null;
  document.querySelectorAll('#rohre .card').forEach((card) => {
    const h = card.querySelector('.hint');
    const v = vorhanden ? vorhanden[card.dataset.rohr] : '';
    h.textContent = h.dataset.basis + (vorhanden ? (v === '' ? ' · Bestand nicht eingetragen' : ` · vorhanden: ${v}`) : '');
  });
}
$('eigenStepper').children[0].onclick = () => eigenAnzahl(-1);
$('eigenStepper').children[2].onclick = () => eigenAnzahl(1);
function eigenAnzahl(d) {
  zustand.eigen.anzahl = Math.max(0, (Number(zustand.eigen.anzahl) || 0) + d);
  $('eigenAnzahl').textContent = zustand.eigen.anzahl;
  aktualisiereSumme();
}
$('eigenQ').oninput = (e) => { zustand.eigen.q = e.target.value; aktualisiereSumme(); };
$('eigenBar').oninput = (e) => { zustand.eigen.bar = e.target.value; aktualisiereSumme(); };

function aktualisiereSumme() {
  try {
    const b = wasserbedarf(bedarfEingabe());
    $('summeQ').textContent = `${Math.round(b.q * 10) / 10} l/min`;
    $('summeBar').textContent = b.q > 0
      ? `Druck am Verteiler: ${b.barMax} bar am Strahlrohr + 1 bar = ${b.barMax + 1} bar`
      : 'Druck am Verteiler: noch kein Strahlrohr gewählt';
  } catch (e) {
    $('summeQ').textContent = '–';
    $('summeBar').textContent = e.message;
  }
  speichern();
}

// ---------- Weg und Saughöhe ----------
let karte = null;
let wegkarte = null;
function felderNeuFuellen() { $('laenge').value = zustand.weg.laengeM; $('hoehe').value = zustand.weg.hoeheM; }
function zeigeKarte() {
  if (karte) { karte.map.resize(); wegkarte?.neuZeichnen(); return; }
  try {
    karte = erzeugeKarte($('karte'));
    // Höhendatei laden (fehlt sie, bleibt die Karte nutzbar, nur ohne Höhen)
    ladeHoehenraster('daten/').catch(() => null).then((hoehen) => {
      wegkarte = starteWegkarte({ karte, hoehen, zustandWeg: zustand.weg, geaendert: speichern, felderNeu: felderNeuFuellen });
    });
    karte.fehler(() => {
      $('karteFehler').style.display = '';
      $('karteFehler').textContent = 'Die Karten-Datei konnte nicht geladen werden. Weglänge und Höhe lassen sich unten von Hand eintragen.';
    });
  } catch (e) {
    $('karteFehler').style.display = '';
    $('karteFehler').textContent = 'Die Karte steht nicht zur Verfügung. Weglänge und Höhe lassen sich unten von Hand eintragen.';
  }
}
$('laenge').oninput = (e) => { zustand.weg.laengeM = e.target.value; zustand.weg.quelle = 'hand'; speichern(); };
$('hoehe').oninput = (e) => { zustand.weg.hoeheM = e.target.value; zustand.weg.quelle = 'hand'; speichern(); };
$('saug').oninput = (e) => { zustand.saughoeheM = e.target.value; speichern(); };

// ---------- Pumpen: gemeinsamer Baukasten für Training und Fahrzeuge ----------
const pumpenName = (id) => (id === EIGENE_PUMPE_ID ? 'Eigene Pumpe' : pumpeNachId(id)?.name ?? id);
const alterText = (e) => (Number(e.alterungProzent) > 0 ? ` (${e.alterungProzent} % Alterung)` : '');

function eintrag(daten, id) {
  if (!daten[id]) daten[id] = { anzahl: 0, alterungProzent: 0, eigeneQ: '' };
  return daten[id];
}
// Zeigt nur die gewählten Pumpen als Karte (Anzahl, Alterung); weitere kommen über "+ Pumpe hinzufügen"
// "daten" ist Training oder ein Fahrzeug, "geaendert" wird nach jeder Änderung aufgerufen
function baueAuswahl(box, daten, geaendert = () => {}) {
  box.innerHTML = '';
  const alle = [...PUMPEN.map((p) => ({ id: p.id, name: p.name, sub: `${p.q} l/min bei 10 bar` })),
    { id: EIGENE_PUMPE_ID, name: 'Eigene Pumpe', sub: 'Förderstrom selbst eintragen' }];
  const gewaehlt = alle.filter((p) => Number(daten[p.id]?.anzahl) > 0);
  if (gewaehlt.length === 0) {
    const leer = document.createElement('p'); leer.className = 'hint'; leer.textContent = 'Noch keine Pumpe. Mit "+ Pumpe hinzufügen" auswählen.'; box.appendChild(leer);
  }
  for (const p of gewaehlt) {
    const e = eintrag(daten, p.id);
    const card = document.createElement('div');
    card.className = 'card';
    card.style.background = 'var(--panel2)';
    card.innerHTML = `<div class="row"><span style="font-size:19px"><b class="n"></b><br><span class="hint s"></span></span>
        <div class="stepper"><button aria-label="weniger">−</button><span class="z">0</span><button aria-label="mehr">+</button></div></div>
      <div class="detail" style="display:flex;flex-direction:column;gap:12px">
        ${p.id === EIGENE_PUMPE_ID ? '<div class="field"><label class="lbl">Förderstrom in l/min bei 10 bar (3 m Saughöhe)</label><input class="q" type="text" inputmode="decimal" autocomplete="off" placeholder="z. B. 1000"></div>' : ''}
        <label class="lbl">Alterung dieser Pumpe</label>
        <div class="seg"><button data-w="0">0 %</button><button data-w="10">10 %</button><button data-w="20">20 %</button></div>
      </div>`;
    card.querySelector('.n').textContent = p.name;
    card.querySelector('.s').textContent = p.sub;
    const z = card.querySelector('.z');
    const [minus, , plus] = card.querySelector('.stepper').children;
    const zeigeStand = () => {
      z.textContent = e.anzahl;
      card.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('sel', Number(b.dataset.w) === Number(e.alterungProzent)));
    };
    minus.onclick = () => {
      e.anzahl = Math.max(0, (Number(e.anzahl) || 0) - 1); speichern();
      if (e.anzahl === 0) baueAuswahl(box, daten, geaendert); else zeigeStand();
      geaendert();
    };
    plus.onclick = () => { e.anzahl = (Number(e.anzahl) || 0) + 1; zeigeStand(); speichern(); geaendert(); };
    card.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => { e.alterungProzent = Number(b.dataset.w); zeigeStand(); speichern(); }));
    const q = card.querySelector('.q');
    if (q) { q.value = e.eigeneQ ?? ''; q.oninput = (ev) => { e.eigeneQ = ev.target.value; speichern(); }; }
    zeigeStand();
    box.appendChild(card);
  }
  // Auswahl weiterer Pumpen
  const picker = document.createElement('div');
  picker.className = 'tiles';
  picker.style.display = 'none';
  for (const p of alle) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.innerHTML = '<span><span class="n"></span><small></small></span><span class="chk" style="visibility:visible">+</span>';
    b.querySelector('.n').textContent = p.name;
    b.querySelector('small').textContent = p.sub;
    b.onclick = () => { const e = eintrag(daten, p.id); e.anzahl = (Number(e.anzahl) || 0) + 1; speichern(); baueAuswahl(box, daten, geaendert); geaendert(); };
    picker.appendChild(b);
  }
  const hinzu = document.createElement('button');
  hinzu.className = 'btn';
  hinzu.style.minHeight = '64px';
  hinzu.style.fontSize = '18px';
  hinzu.textContent = '+ Pumpe hinzufügen';
  hinzu.onclick = () => { const offen = picker.style.display !== 'none'; picker.style.display = offen ? 'none' : 'flex'; hinzu.textContent = offen ? '+ Pumpe hinzufügen' : 'Auswahl schließen'; };
  box.append(hinzu, picker);
}
function trainingPumpenListe() {
  return Object.entries(zustand.pumpen).map(([id, e]) => ({ id, ...e }));
}
function pumpenListe() { return istEinsatz() ? einsatzPumpen(ausgewaehlteFahrzeuge()) : trainingPumpenListe(); }
function anzahlPumpen(liste) { return liste.reduce((s, e) => s + (Number(e.anzahl) || 0), 0); }
function pumpenText() {
  if (istEinsatz()) {
    const fz = ausgewaehlteFahrzeuge();
    const n = anzahlPumpen(einsatzPumpen(fz));
    return fz.length === 0 ? 'kein Fahrzeug ausgewählt' : `${fz.map((f) => f.name).join(', ')} · ${n} ${n === 1 ? 'Pumpe' : 'Pumpen'} · Saughöhe ${zustand.saughoeheM || 3} m`;
  }
  const teile = trainingPumpenListe().filter((e) => Number(e.anzahl) > 0).map((e) => `${e.anzahl} × ${pumpenName(e.id)}${alterText(e)}`);
  return `${teile.length ? teile.join(', ') : 'keine Pumpe gewählt'} · Saughöhe ${zustand.saughoeheM || 3} m`;
}

// ---------- Feuerwehr mit Fahrzeugen ----------
function fahrzeugText(f) {
  const n = anzahlPumpen(Object.values(f.pumpen));
  const r = Object.values(f.strahlrohre ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
  return `${n} ${n === 1 ? 'Pumpe' : 'Pumpen'} · ${f.bSchlaeuche === '' ? 'B-Schläuche nicht eingetragen' : f.bSchlaeuche + ' B-Schläuche'} · ${r} Strahlrohre · ${(f.geraete ?? []).reduce((s, g) => s + (Number(g.anzahl) || 0), 0)} Geräte`;
}
function baueFahrzeuge() {
  $('ffName').value = zustand.feuerwehr.name;
  const box = $('fahrzeugListe');
  box.innerHTML = '';
  if (zustand.fahrzeuge.length === 0) {
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Noch kein Fahrzeug. Mit "+ Neues Fahrzeug" anlegen.'; box.appendChild(p);
  }
  for (const f of zustand.fahrzeuge) {
    const zeile = document.createElement('div');
    zeile.style.cssText = 'display:flex;gap:10px;align-items:stretch';
    const wahl = document.createElement('button');
    wahl.className = 'tile' + (zustand.ausgewaehlt.includes(f.id) ? ' sel' : '');
    wahl.style.cssText = 'flex:1 1 0;min-width:0';
    wahl.innerHTML = '<span><span class="n"></span><small></small></span><span class="chk">✔</span>';
    wahl.querySelector('.n').textContent = f.name;
    wahl.querySelector('small').textContent = fahrzeugText(f);
    wahl.onclick = () => {
      const i = zustand.ausgewaehlt.indexOf(f.id);
      if (i >= 0) zustand.ausgewaehlt.splice(i, 1); else zustand.ausgewaehlt.push(f.id);
      wahl.classList.toggle('sel', i < 0);
      speichern();
    };
    const bearb = document.createElement('button');
    bearb.className = 'btn';
    bearb.style.cssText = 'width:auto;flex:none;min-width:96px;font-size:17px;padding:8px 10px';
    bearb.textContent = 'Ändern';
    bearb.onclick = () => { bearbeiteId = f.id; zeige('s-bestand'); };
    zeile.append(wahl, bearb);
    box.appendChild(zeile);
  }
}
$('ffName').oninput = (e) => { zustand.feuerwehr.name = e.target.value || 'Meine Feuerwehr'; speichern(); };
$('fahrzeugNeu').onclick = () => {
  const f = neuesFahrzeug(`Fahrzeug ${zustand.fahrzeuge.length + 1}`);
  zustand.fahrzeuge.push(f);
  zustand.ausgewaehlt.push(f.id);
  bearbeiteId = f.id;
  speichern();
  zeige('s-bestand');
};
function bearbeitetes() { return zustand.fahrzeuge.find((f) => f.id === bearbeiteId) ?? zustand.fahrzeuge[0]; }
function baueBestand() {
  const f = bearbeitetes();
  if (!f) { zurueck(); return; }
  $('fzName').value = f.name;
  $('abPumpen').open = true; // Einstieg immer bei den Pumpen
  baueAuswahl($('listenPumpen'), f.pumpen, aktualisiereTitel);
  $('bAnzahl').textContent = f.bSchlaeuche === '' ? '–' : f.bSchlaeuche;
  baueFzRohre(f);
  baueFzGeraete(f);
  aktualisiereTitel();
}
// Überschriften der Abschnitte mit Kurzinfo
function aktualisiereTitel() {
  const f = bearbeitetes();
  if (!f) return;
  const n = anzahlPumpen(Object.values(f.pumpen));
  const r = Object.values(f.strahlrohre ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
  $('sumPumpen').textContent = `Pumpen · ${n}`;
  $('sumSchlauch').textContent = `B-Schläuche · ${f.bSchlaeuche === '' ? '–' : f.bSchlaeuche}`;
  $('sumRohre').textContent = `Strahlrohre · ${r}`;
  $('sumGeraete').textContent = `Geräte · ${(f.geraete ?? []).reduce((s, g) => s + (Number(g.anzahl) || 0), 0)}`;
}
// Strahlrohre des Fahrzeugs: je Art ein Zähler, "–" = nicht eingetragen
function baueFzRohre(f) {
  const box = $('fzRohre');
  box.innerHTML = '';
  for (const r of STRAHLROHRE) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span style="font-size:19px"><b class="n"></b><br><span class="hint s"></span></span><div class="stepper"><button aria-label="weniger">−</button><span class="z"></span><button aria-label="mehr">+</button></div>';
    row.querySelector('.n').textContent = r.name;
    row.querySelector('.s').textContent = `${strahlrohrLiefermenge(r.id, r.bar)} l/min bei ${r.bar} bar`;
    const z = row.querySelector('.z');
    const zeige = () => { z.textContent = f.strahlrohre[r.id] === '' ? '–' : f.strahlrohre[r.id]; };
    const [minus, , plus] = row.querySelector('.stepper').children;
    minus.onclick = () => {
      const v = f.strahlrohre[r.id];
      f.strahlrohre[r.id] = v === '' ? '' : (Number(v) <= 0 ? '' : Number(v) - 1);
      zeige(); speichern(); aktualisiereTitel();
    };
    plus.onclick = () => { f.strahlrohre[r.id] = (f.strahlrohre[r.id] === '' ? 0 : Number(f.strahlrohre[r.id])) + 1; zeige(); speichern(); aktualisiereTitel(); };
    zeige();
    box.appendChild(row);
  }
}
// Geräte des Fahrzeugs: je Gerät Name, Liter je Stück, Druck, Anzahl (0 = Gerät entfernen)
function baueFzGeraete(f) {
  const box = $('fzGeraete');
  box.innerHTML = '';
  if (f.geraete.length === 0) {
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Noch kein Gerät.'; box.appendChild(p);
  }
  for (const g of f.geraete) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.background = 'var(--panel2)';
    card.innerHTML = `<div class="field"><label class="lbl">Name</label><input class="gn" type="text" autocomplete="off" placeholder="z. B. Hohlstrahlrohr"></div>
      <div class="two">
        <div class="field"><label class="lbl">Liter/min je Stück</label><input class="gq" type="text" inputmode="decimal" autocomplete="off" placeholder="z. B. 200"></div>
        <div class="field"><label class="lbl">Druck in bar</label><input class="gb" type="text" inputmode="decimal" autocomplete="off" placeholder="z. B. 6"></div>
      </div>
      <div class="row"><span style="font-size:18px"><b>Anzahl</b><br><span class="hint">bei 0 wird das Gerät entfernt</span></span>
        <div class="stepper"><button aria-label="weniger">−</button><span class="z"></span><button aria-label="mehr">+</button></div></div>`;
    const gn = card.querySelector('.gn'); gn.value = g.name; gn.oninput = (e) => { g.name = e.target.value; speichern(); };
    const gq = card.querySelector('.gq'); gq.value = g.q; gq.oninput = (e) => { g.q = e.target.value; speichern(); };
    const gb = card.querySelector('.gb'); gb.value = g.bar; gb.oninput = (e) => { g.bar = e.target.value; speichern(); };
    const z = card.querySelector('.z'); z.textContent = g.anzahl;
    const [minus, , plus] = card.querySelector('.stepper').children;
    minus.onclick = () => {
      g.anzahl = Math.max(0, (Number(g.anzahl) || 0) - 1);
      if (g.anzahl === 0) f.geraete = f.geraete.filter((x) => x !== g);
      speichern();
      if (g.anzahl === 0) baueFzGeraete(f); else z.textContent = g.anzahl;
      aktualisiereTitel();
    };
    plus.onclick = () => { g.anzahl = (Number(g.anzahl) || 0) + 1; z.textContent = g.anzahl; speichern(); aktualisiereTitel(); };
    box.appendChild(card);
  }
}
$('geraetNeu').onclick = () => {
  const f = bearbeitetes();
  f.geraete.push({ id: 'g' + Date.now() + Math.floor(Math.random() * 1000), name: '', q: '', bar: '', anzahl: 1 });
  speichern(); baueFzGeraete(f); aktualisiereTitel();
};
// Es ist immer nur ein Abschnitt offen
document.querySelectorAll('details.abschnitt').forEach((d) => {
  d.addEventListener('toggle', () => {
    if (d.open) document.querySelectorAll('details.abschnitt').forEach((o) => { if (o !== d) o.open = false; });
  });
});
$('fzName').oninput = (e) => { const f = bearbeitetes(); if (f) { f.name = e.target.value || 'Ohne Namen'; speichern(); } };
$('bSteller').children[0].onclick = () => {
  const f = bearbeitetes();
  f.bSchlaeuche = f.bSchlaeuche === '' ? '' : (Number(f.bSchlaeuche) <= 0 ? '' : Number(f.bSchlaeuche) - 1);
  $('bAnzahl').textContent = f.bSchlaeuche === '' ? '–' : f.bSchlaeuche; speichern(); aktualisiereTitel();
};
$('bSteller').children[2].onclick = () => {
  const f = bearbeitetes();
  f.bSchlaeuche = (f.bSchlaeuche === '' ? 0 : Number(f.bSchlaeuche)) + 1;
  $('bAnzahl').textContent = f.bSchlaeuche; speichern(); aktualisiereTitel();
};
$('fahrzeugLoeschen').onclick = () => {
  const f = bearbeitetes();
  if (!f) return;
  if (!window.confirm(`Fahrzeug "${f.name}" wirklich löschen?\nDas kann nicht rückgängig gemacht werden.`)) return;
  zustand.fahrzeuge = zustand.fahrzeuge.filter((x) => x.id !== f.id);
  zustand.ausgewaehlt = zustand.ausgewaehlt.filter((id) => id !== f.id);
  bearbeiteId = null;
  speichern();
  zurueck();
};

// ---------- Ergebnis ----------
const fmt = (n, stellen = 1) => String(Math.round(n * 10 ** stellen) / 10 ** stellen).replace('.', ',');

function eingabeFuerRechnung() {
  const e = { strahlrohre: zustand.strahlrohre, eigen: zustand.eigen, geraete: gewaehlteGeraete(), weg: { ...zustand.weg, profil: profilFuerRechnung(zustand.weg) }, saughoeheM: zustand.saughoeheM, pumpen: pumpenListe() };
  if (istEinsatz()) {
    const fz = ausgewaehlteFahrzeuge();
    e.vorhandeneB = einsatzSchlaeuche(fz);
    e.vorhandeneRohre = einsatzStrahlrohre(fz);
    e.pumpenQuelle = 'liste';
  }
  return e;
}

function zeigeErgebnis() {
  const e = berechne(eingabeFuerRechnung());
  const fh = faktorHinweis(zustand.weg.quelle);
  $('faktorHinweisBox').style.display = fh ? '' : 'none';
  $('faktorHinweis').textContent = fh;
  // Mit Höhenprofil gerechnet (übernommener Kartenweg)? Dann braucht es keine Warnung wegen ungleichmäßiger Steigung.
  const profilGenutzt = e.weg?.profilGenutzt === true;
  $('profilGenutztErgebnis').style.display = profilGenutzt ? '' : 'none';
  // Sonst (von Hand geändert, Weg nach dem Übernehmen geändert, keine Höhendaten): Warnung für den eingezeichneten Weg
  const warnt = !profilGenutzt && abweichungWarnt(zustand.weg.abweichung);
  $('wegWarnErgebnis').style.display = warnt ? '' : 'none';
  if (warnt) $('wegWarnErgebnis').textContent = `⚠ ${warnText(zustand.weg.abweichung, zustand.weg.quelle === 'hand')}`;
  const veraltet = wegVeraltet(zustand.weg);
  $('wegVeraltetErgebnis').style.display = veraltet ? '' : 'none';
  if (veraltet) $('wegVeraltetErgebnis').textContent = '⚠ Der eingezeichnete Weg wurde nach dem Übernehmen geändert. Länge und Höhe in dieser Rechnung stammen noch vom zuletzt übernommenen Weg. Auf der Seite Weg "Weg übernehmen" antippen.';
  const hoeheOffen = zustand.weg.quelle === 'karte' && zustand.weg.punkte.length >= 2 && zustand.weg.abweichung === null && !veraltet;
  $('hoeheOffenErgebnis').style.display = hoeheOffen ? '' : 'none';
  if (hoeheOffen) $('hoeheOffenErgebnis').textContent = '⚠ Für den Kartenweg gab es keine Höhendaten. Der Höhenunterschied wurde von Hand eingetragen oder zählt als 0 m.';
  const v = $('verdict');
  v.className = 'verdict' + (e.status === 'machbar' ? '' : ' warn');
  v.innerHTML = '';
  v.append((e.status === 'machbar' ? '✔ ' : '⚠ ') + e.titel);
  if (e.status === 'machbar') {
    const s = document.createElement('small');
    s.textContent = `mit ${e.anzahlPumpen} ${e.anzahlPumpen === 1 ? 'Pumpe' : 'Pumpen'}`;
    v.appendChild(s);
  }
  $('trainingTag').style.display = istEinsatz() ? 'none' : 'inline-block';

  const gruende = [...e.gruende];
  const tipps = [...(e.tipps ?? [])];
  if (istEinsatz() && e.status === 'eingabe_fehlt' && /Pumpe/.test(gruende[0] ?? '') && !/Eigene Pumpe/.test(gruende[0])) {
    gruende[0] = ausgewaehlteFahrzeuge().length === 0
      ? 'Es ist kein Fahrzeug ausgewählt. Bitte unter "Fahrzeuge der Feuerwehr" Fahrzeuge anhaken.'
      : 'Die ausgewählten Fahrzeuge haben keine Pumpe. Bitte unter "Fahrzeuge der Feuerwehr" Pumpen eintragen.';
  }
  $('gruendeBox').style.display = gruende.length ? 'block' : 'none';
  const ul = $('gruende');
  ul.innerHTML = '';
  for (const g of gruende) { const li = document.createElement('li'); li.textContent = g; ul.appendChild(li); }
  if (istEinsatz() && e.status === 'machbar' && !e.schlauchGeprueft) {
    tipps.push('B-Schläuche sind bei den Fahrzeugen nicht eingetragen, die Schlauchzahl wurde nicht gegen den Bestand geprüft.');
  }
  if (istEinsatz() && e.status === 'machbar' && !e.rohreGeprueft && Object.values(zustand.strahlrohre).some((n) => Number(n) > 0)) {
    tipps.push('Strahlrohre sind bei den Fahrzeugen nicht eingetragen, sie wurden nicht gegen den Bestand geprüft.');
  }
  $('tippsBox').style.display = tipps.length ? 'flex' : 'none';
  const tl = $('tipps');
  tl.innerHTML = '';
  for (const t of tipps) { const li = document.createElement('li'); li.textContent = t; tl.appendChild(li); }

  baueAendern(e);

  const ok = e.anzahlPumpen !== undefined;
  const kpi = $('kpi');
  kpi.innerHTML = '';
  const kachel = (wert, text) => {
    const d = document.createElement('div');
    const b = document.createElement('b'); b.textContent = wert;
    const s = document.createElement('span'); s.textContent = text;
    d.append(b, s); kpi.appendChild(d);
  };
  if (e.q) kachel(`${fmt(e.q, 0)} l/min`, 'Förderstrom');
  if (e.edEnde) kachel(`${fmt(e.edEnde)} bar`, 'verlangt am Verteiler');
  if (ok) {
    kachel(String(e.schlauchB), 'B-Schläuche (Merkregel)');
    kachel(e.druckEnde === null ? '–' : `${fmt(e.druckEnde)} bar`, 'Druck am Ende');
    kachel(String(e.anzahlPumpen), e.anzahlPumpen === 1 ? 'Pumpe' : 'Pumpen');
  }
  $('standorteBox').style.display = ok ? 'block' : 'none';
  const st = $('standorte');
  st.innerHTML = '';
  if (ok) {
    e.pumpenNaturmassM.forEach((m, i) => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = `${i === 0 ? 'Pumpe 1 (Entnahme)' : `Pumpe ${i + 1}`}${e.pumpenNamen?.[i] ? ` · ${e.pumpenNamen[i]}` : ''}`;
      const b = document.createElement('b'); b.textContent = `${fmt(m, 0)} m`;
      li.append(a, b); st.appendChild(li);
    });
  }
  $('annahmen').textContent = e.q
    ? `Annahmen: Schlauch B 75 mm, ${istEinsatz() ? 'Fahrzeuge ' : 'Training: '}${pumpenText()}, Verteiler = Strahlrohrdruck + 1 bar, Ausgangsdruck 10 bar, Mindest-Eingangsdruck 1,5 bar, Datenstand 11.11.2026 (Landesfeuerwehrschule Tirol, ÖBFV, Hersteller). Planungshilfe, ersetzt nicht die Entscheidung des Einsatzleiters.`
    : 'Planungshilfe. Ersetzt nicht die Entscheidung des Einsatzleiters.';
}

// Springt zur passenden Eingabe zurück; dort gibt es "Zum Ergebnis"
function baueAendern(e) {
  const box = $('aendernInhalt');
  box.innerHTML = '';
  const knopf = (text, unter, ziel) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.innerHTML = '<span class="t"></span><small></small>';
    b.querySelector('.t').textContent = text;
    b.querySelector('small').textContent = unter;
    b.onclick = () => aendernNach(ziel);
    box.appendChild(b);
  };
  let wasser = 'noch nichts gewählt';
  try { const w = wasserbedarf(bedarfEingabe()); if (w.q > 0) wasser = `${fmt(w.q, 0)} l/min`; } catch (x) { wasser = 'bitte prüfen'; }
  knopf('Wassermenge ändern', wasser, 's-wasser');
  const laenge = zustand.weg.laengeM === '' ? '–' : `${zustand.weg.laengeM} m`;
  knopf('Weg und Saughöhe ändern', `${laenge}, Höhe ${zustand.weg.hoeheM === '' ? 0 : zustand.weg.hoeheM} m, Saughöhe ${zustand.saughoeheM || 3} m`, 's-weg');
  if (istEinsatz()) knopf('Fahrzeuge ändern', pumpenText(), 's-listen');
  else knopf('Pumpen ändern (Training)', pumpenText(), 's-pumpe');
}

// ---------- Start ----------
function fuelleEingaben() {
  $('eigenAnzahl').textContent = zustand.eigen.anzahl;
  $('eigenQ').value = zustand.eigen.q;
  $('eigenBar').value = zustand.eigen.bar;
  $('laenge').value = zustand.weg.laengeM;
  $('hoehe').value = zustand.weg.hoeheM;
  $('saug').value = zustand.saughoeheM;
}

baueRohre();
baueAuswahl($('pumpen'), zustand.pumpen);
fuelleEingaben();
aktualisiereSumme();
setTheme(zustand.theme === 'light' ? 'light' : 'dark');
zeige('s-start', false);
startOffline(); // Offline-Status, Service Worker, Update-Knopf (wirft nie)

// Für die Prüfung im Browser
window.__app = { zustand, zeige, karteInfo: () => karte, wegkarteInfo: () => wegkarte, berechne: () => berechne(eingabeFuerRechnung()) };
