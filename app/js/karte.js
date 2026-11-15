// Karte aus lokalen Dateien (kein Internet nötig): MapLibre GL + PMTiles + Protomaps-Stil.
// Die Bibliotheken (maplibregl, pmtiles, basemaps) stehen als normale Skripte in index.html und liegen in app/vendor/.
// Karten-Datei: app/daten/karte-igls-innsbruck.pmtiles (erzeugt mit tools/karte-bauen.py, nicht in Git).

const KARTE_DATEI = 'daten/karte-igls-innsbruck.pmtiles';
const INFO_DATEI = 'daten/info.json';
const MITTE = [11.41, 47.255]; // Mitte des Testgebiets (Länge, Breite)
const NAMENSNENNUNG = ['© OpenStreetMap-Mitwirkende', 'Höhen: Datenquelle: Land Tirol - data.tirol.gv.at'];

let protokollRegistriert = false;

const absolut = (pfad) => new URL(pfad, document.baseURI).href;
const flavorFuerTheme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

function stilFuer(flavor) {
  return {
    version: 8,
    glyphs: `${absolut('vendor/fonts/')}{fontstack}/{range}.pbf`, // geschweifte Klammern nicht durch new URL() laufen lassen (würden codiert)
    sprite: absolut(`vendor/sprites/${flavor}`),
    sources: {
      protomaps: { type: 'vector', url: `pmtiles://${absolut(KARTE_DATEI)}`, attribution: NAMENSNENNUNG[0] },
    },
    layers: basemaps.layers('protomaps', basemaps.namedFlavor(flavor), { lang: 'de' }),
  };
}

// Erzeugt die Karte im Element "container". Gibt { map, grenzen, fehler } zurück:
//   grenzen: Ausdehnung des Testgebiets { west, south, east, north } (aus app/daten/info.json, sonst feste Werte)
//   fehler:  Funktion, der man einen Rückruf übergibt, der einmal aufgerufen wird, wenn die Karten-Datei nicht geladen werden kann
export function erzeugeKarte(container, optionen = {}) {
  if (typeof maplibregl === 'undefined' || typeof pmtiles === 'undefined' || typeof basemaps === 'undefined') {
    throw new Error('Kartenbibliotheken (app/vendor) nicht geladen');
  }
  if (!protokollRegistriert) {
    maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
    protokollRegistriert = true;
  }
  const grenzen = { west: 11.30, south: 47.18, east: 11.52, north: 47.33 };
  fetch(INFO_DATEI).then((a) => (a.ok ? a.json() : null)).then((i) => { if (i?.grenzen) Object.assign(grenzen, i.grenzen); }).catch(() => {});

  const map = new maplibregl.Map({
    container,
    style: stilFuer(flavorFuerTheme()),
    center: optionen.mitte ?? MITTE,
    zoom: optionen.zoom ?? 12,
    minZoom: 9,
    maxZoom: 17,
    attributionControl: { compact: false, customAttribution: NAMENSNENNUNG.slice(1) },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.doubleClickZoom.disable(); // ein Doppeltippen würde zwei Wegpunkte setzen; gezoomt wird mit den Knöpfen + und − oder mit zwei Fingern
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  // Tag/Nacht: Kartenstil folgt dem Schalter der App
  const beobachter = new MutationObserver(() => map.setStyle(stilFuer(flavorFuerTheme())));
  beobachter.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let fehlerRueckruf = null;
  let gemeldet = false;
  map.on('error', (e) => {
    const text = String(e?.error?.message ?? e?.error ?? '');
    if (gemeldet || !/pmtiles|\.pmtiles|Failed to fetch|404|Range/i.test(text)) return;
    gemeldet = true;
    fehlerRueckruf?.(text);
  });
  return { map, grenzen, fehler: (f) => { fehlerRueckruf = f; } };
}
