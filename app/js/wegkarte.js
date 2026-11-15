// Weg auf der Karte einzeichnen: Punkte antippen, verschieben, löschen; Länge und Höhen anzeigen; Werte übernehmen.
// Die Rechnung steht in weg.js (getestet). Hier ist nur die Oberfläche.
import { wegInfo, abweichungVon, wegSignatur, wegVeraltet, profilFuerKern } from './weg.js';
import { kreisKoordinaten, standortFehlerText } from './standort.js';

const $ = (id) => document.getElementById(id);
const komma = (zahl) => String(zahl).replace('.', ',');
const vorzeichen = (zahl) => `${zahl > 0 ? '+' : ''}${komma(zahl)}`;

const SVG = 'http://www.w3.org/2000/svg';
function svg(name, attribute = {}, text) {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attribute)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// Höhenprofil als kleine Grafik: waagrecht der Weg in Metern, senkrecht die Höhe über Adria
function zeichneProfil(box, info) {
  const aussen = $('wegProfilBox');
  box.innerHTML = '';
  if (!info.profil) { aussen.style.display = 'none'; return; }
  aussen.style.display = '';
  const B = 320, H = 150, links = 56, rechts = 14, oben = 26, unten = 24;
  const hs = info.profil.map((p) => p.h);
  let hmin = Math.min(...hs), hmax = Math.max(...hs);
  if (hmax - hmin < 4) { const mitte = (hmax + hmin) / 2; hmin = mitte - 2; hmax = mitte + 2; }
  const x = (s) => links + (s / info.laengeM) * (B - links - rechts);
  const y = (h) => oben + (1 - (h - hmin) / (hmax - hmin)) * (H - oben - unten);
  const k = svg('svg', { viewBox: `0 0 ${B} ${H}`, role: 'img', 'aria-label': `Höhenprofil: Start ${Math.round(info.startH)} m, Ziel ${Math.round(info.zielH)} m, höchster Punkt ${Math.round(info.hoechsterH)} m` });
  k.append(svg('line', { x1: links, x2: B - rechts, y1: y(hmax), y2: y(hmax), style: 'stroke:var(--line);stroke-width:1' }));
  k.append(svg('line', { x1: links, x2: B - rechts, y1: y(hmin), y2: y(hmin), style: 'stroke:var(--line);stroke-width:1' }));
  k.append(svg('text', { x: links - 4, y: y(hmax) + 4, 'text-anchor': 'end' }, `${Math.round(hmax)} m`));
  k.append(svg('text', { x: links - 4, y: y(hmin) + 4, 'text-anchor': 'end' }, `${Math.round(hmin)} m`));
  k.append(svg('text', { x: links, y: H - 6 }, '0 m'));
  k.append(svg('text', { x: B - rechts, y: H - 6, 'text-anchor': 'end' }, `${Math.round(info.laengeM)} m`));
  const punkte = info.profil.map((p) => `${x(p.s).toFixed(1)},${y(p.h).toFixed(1)}`);
  k.append(svg('polygon', { points: `${x(0)},${y(hmin)} ${punkte.join(' ')} ${x(info.laengeM)},${y(hmin)}`, style: 'fill:var(--blue);opacity:.18' }));
  k.append(svg('polyline', { points: punkte.join(' '), style: 'fill:none;stroke:var(--blue);stroke-width:3;stroke-linejoin:round' }));
  const punkt = (s, h, farbe, beschriftung, anker) => {
    k.append(svg('circle', { cx: x(s), cy: y(h), r: 5, style: `fill:${farbe};stroke:#fff;stroke-width:2` }));
    if (beschriftung) k.append(svg('text', { x: x(s), y: y(h) - 9, 'text-anchor': anker, style: 'fill:var(--text);font-weight:700' }, beschriftung));
  };
  punkt(0, info.startH, 'var(--blue)', 'S', 'start');
  punkt(info.laengeM, info.zielH, '#c8201b', 'Z', 'end');
  if (info.hoechsterS > 0 && info.hoechsterS < info.laengeM) punkt(info.hoechsterS, info.hoechsterH, 'var(--amber)', `${Math.round(info.hoechsterH)} m`, 'middle');
  box.append(k);
}

// karte:        Ergebnis von erzeugeKarte() ({ map })
// hoehen:       Höhenraster (hoeheAn(lat, lon)) oder null, wenn die Höhendatei fehlt
// zustandWeg:   zustand.weg { laengeM, hoeheM, punkte, quelle }; wird hier direkt verändert
// geaendert:    Rückruf nach jeder Änderung (zum Speichern)
// felderNeu:    Rückruf nach "Übernehmen" (die Eingabefelder neu füllen)
export function starteWegkarte({ karte, hoehen, zustandWeg, geaendert, felderNeu }) {
  const map = karte.map;
  const hoeheAn = (lat, lon) => (hoehen ? hoehen.hoeheAn(lat, lon) : null);
  let marker = [];
  let info = null;
  let standort = null; // nur im Arbeitsspeicher: { lat, lon, genauigkeitM }; wird nie gespeichert oder gesendet
  let standortMarker = null;

  const geojson = () => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: zustandWeg.punkte.map((p) => [p.lon, p.lat]) },
  });

  // Linie in die Karte legen (nach jedem Stilwechsel Tag/Nacht neu, weil dabei alle Ebenen verschwinden)
  function linieAnlegen() {
    if (!map.getSource('weg')) {
      map.addSource('weg', { type: 'geojson', data: geojson() });
      map.addLayer({ id: 'weg-rand', type: 'line', source: 'weg', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
      map.addLayer({ id: 'weg-linie', type: 'line', source: 'weg', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1e66c8', 'line-width': 5 } });
    }
  }
  const linieAktualisieren = () => map.getSource('weg')?.setData(geojson());

  // Genauigkeitskreis um den Standort
  const kreis = () => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: standort ? [kreisKoordinaten(standort, standort.genauigkeitM)] : [] },
  });
  function standortEbenenAnlegen() {
    if (map.getSource('standort')) return;
    map.addSource('standort', { type: 'geojson', data: kreis() });
    map.addLayer({ id: 'standort-flaeche', type: 'fill', source: 'standort', paint: { 'fill-color': '#2d8cff', 'fill-opacity': 0.18 } });
    map.addLayer({ id: 'standort-rand', type: 'line', source: 'standort', paint: { 'line-color': '#2d8cff', 'line-width': 2 } });
  }
  // Ebenen anlegen, sobald ein Stil da ist, und nach jedem Stilwechsel (Tag/Nacht) wieder. "styledata" kommt zuverlässiger als
  // "style.load" und "isStyleLoaded()" (das ist false, solange noch Kacheln laden, auch wenn der Stil längst da ist).
  const ebenenSichern = () => { if (map.getStyle()) { linieAnlegen(); standortEbenenAnlegen(); } };
  map.on('styledata', ebenenSichern);
  ebenenSichern();

  function standortEntfernen() {
    standort = null;
    standortMarker?.remove();
    standortMarker = null;
    map.getSource('standort')?.setData(kreis());
    $('standortText').textContent = 'Der Standort bleibt auf diesem Gerät und wird nicht gespeichert.';
  }
  $('wegStandort').onclick = () => {
    const text = $('standortText');
    if (!window.isSecureContext) { text.textContent = standortFehlerText('unsicher'); return; }
    if (!navigator.geolocation) { text.textContent = standortFehlerText('nicht-unterstuetzt'); return; }
    text.textContent = 'Standort wird gesucht …';
    $('wegStandort').disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      $('wegStandort').disabled = false;
      standort = { lat: pos.coords.latitude, lon: pos.coords.longitude, genauigkeitM: pos.coords.accuracy };
      standortMarker?.remove();
      const el = document.createElement('div');
      el.className = 'standortpunkt';
      standortMarker = new maplibregl.Marker({ element: el }).setLngLat([standort.lon, standort.lat]).addTo(map);
      map.getSource('standort')?.setData(kreis());
      map.flyTo({ center: [standort.lon, standort.lat], zoom: Math.max(map.getZoom(), 15) });
      text.textContent = `Standort gefunden, ungefähr auf ${Math.round(standort.genauigkeitM)} m genau.`;
    }, (fehler) => {
      $('wegStandort').disabled = false;
      text.textContent = standortFehlerText(fehler?.code);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  function markerAufbauen() {
    marker.forEach((m) => m.remove());
    const n = zustandWeg.punkte.length;
    marker = zustandWeg.punkte.map((p, i) => {
      const art = i === 0 ? 'start' : i === n - 1 ? 'ziel' : 'mitte';
      const el = document.createElement('div');
      el.className = `wegpunkt ${art}`;
      el.textContent = art === 'start' ? 'S' : art === 'ziel' ? 'Z' : '';
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lon, p.lat]).addTo(map);
      m.on('drag', () => { const l = m.getLngLat(); zustandWeg.punkte[i] = { lat: l.lat, lon: l.lng }; linieAktualisieren(); });
      m.on('dragend', () => { const l = m.getLngLat(); zustandWeg.punkte[i] = { lat: l.lat, lon: l.lng }; linieAktualisieren(); $('wegUebernommen').textContent = ''; anzeigen(); geaendert(); });
      return m;
    });
  }

  function anzeigen() {
    info = wegInfo(zustandWeg.punkte, hoeheAn);
    const n = zustandWeg.punkte.length;
    $('wegLaenge').textContent = info.laengeM > 0 ? `${Math.round(info.laengeM)} m` : '–';
    $('wegHoehe').textContent = info.hoeheM === null ? '–' : `${vorzeichen(info.hoeheM)} m`;
    let text;
    if (n === 0) text = 'Tippe auf die Karte, um den Start des Wegs (Wasserentnahme) zu setzen. Danach tippst du die weiteren Punkte bis zum Ziel (Brandort).';
    else if (n === 1) text = 'Start gesetzt. Tippe auf die Karte, um den nächsten Punkt zu setzen.';
    else if (!(info.laengeM > 0)) text = 'Die Punkte liegen aufeinander. Tippe den nächsten Punkt an einer anderen Stelle.';
    else if (info.keineHoehe) text = 'Für diesen Weg liegen keine Höhendaten vor (außerhalb des geladenen Gebiets oder Höhendatei fehlt). Den Höhenunterschied bitte von Hand eintragen.';
    else text = `Start ${komma(Math.round(info.startH))} m, Ziel ${komma(Math.round(info.zielH))} m über Adria.`;
    $('wegHinweis').textContent = text;
    $('wegUebernehmen').disabled = !(info.laengeM > 0);
    zeichneProfil($('wegProfil'), info);
    zustandWeg.abweichung = abweichungVon(info); // gilt für den aktuell gezeichneten Weg, auch ohne "Weg übernehmen"
    $('wegProfilHinweis').style.display = info.profil ? '' : 'none';
    const veraltet = wegVeraltet(zustandWeg);
    $('wegVeraltet').style.display = veraltet ? '' : 'none';
    if (veraltet) {
      $('wegVeraltet').textContent = 'Der Weg wurde nach dem Übernehmen geändert. Tippe auf "Weg übernehmen", sonst rechnet die App mit dem alten Stand.';
      $('wegUebernommen').textContent = '';
    }
    $('wegZurueck').disabled = n === 0;
    $('wegLoeschen').disabled = n === 0;
  }

  function neuAufbauen(speichern) {
    $('wegUebernommen').textContent = '';
    markerAufbauen();
    linieAktualisieren();
    anzeigen();
    if (speichern) geaendert();
  }

  // Antippen setzt einen Punkt. "click" kommt von MapLibre nur bei einem Antippen, nicht beim Ziehen oder Zoomen der Karte.
  let letzterKlick = null;
  map.on('click', (e) => {
    if (e.originalEvent?.target?.closest?.('.wegpunkt')) return;
    // Doppeltippen (zwei Klicks kurz nacheinander an fast derselben Stelle) zählt nur einmal
    const jetzt = Date.now();
    if (letzterKlick && jetzt - letzterKlick.zeit < 500 && Math.hypot(e.point.x - letzterKlick.x, e.point.y - letzterKlick.y) < 20) return;
    letzterKlick = { zeit: jetzt, x: e.point.x, y: e.point.y };
    zustandWeg.punkte.push({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    neuAufbauen(true);
  });
  $('wegZurueck').onclick = () => { zustandWeg.punkte.pop(); neuAufbauen(true); };
  $('wegLoeschen').onclick = () => {
    if (zustandWeg.punkte.length >= 2 && !confirm('Den ganzen Weg löschen?')) return;
    zustandWeg.punkte.length = 0;
    neuAufbauen(true);
  };
  $('wegUebernehmen').onclick = () => {
    anzeigen();
    if (!(info.laengeM > 0)) return;
    zustandWeg.laengeM = String(Math.round(info.laengeM));
    // Ohne Höhendaten kein alter Höhenwert von einem früheren Weg: das Höhenfeld wird geleert (leer zählt als 0 m)
    zustandWeg.hoeheM = info.keineHoehe ? '' : String(info.hoeheM);
    zustandWeg.quelle = 'karte';
    zustandWeg.uebernommenSig = wegSignatur(zustandWeg.punkte);
    zustandWeg.uebernommenProfil = profilFuerKern(info); // der Rechenkern bekommt dieses Profil (null ohne Höhendaten)
    anzeigen();
    geaendert();
    felderNeu();
    $('wegUebernommen').textContent = info.keineHoehe
      ? `Länge ${zustandWeg.laengeM} m übernommen. Für diesen Weg gibt es keine Höhendaten: das Höhenfeld ist leer und zählt als 0 m. Bitte den Höhenunterschied von Hand eintragen.`
      : `Übernommen: Länge ${zustandWeg.laengeM} m, Höhenunterschied ${vorzeichen(info.hoeheM)} m.`;
  };

  markerAufbauen();
  anzeigen();
  return {
    neuZeichnen() { map.resize(); linieAktualisieren(); },
    standortEntfernen,
    info: () => info,
  };
}
