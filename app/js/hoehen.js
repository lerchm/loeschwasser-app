// Höhenraster lesen und Höhen an beliebigen Punkten berechnen (getestet in tests/hoehen.test.js).
//
// Dateiformat (festgelegt, siehe docs/karte-daten.md):
//   hoehen.bin  = Int16 little-endian, Höhe in Dezimetern, Zeilen von Nord nach Süd, je Zeile von West nach Ost, -32768 = keine Daten.
//   hoehen.json = { west, south, east, north, spalten, zeilen, einheit: "dm", nodata: -32768, quelle, stand, rasterM }
//                 (Grad WGS84). west/east/north/south sind die Lagen der RANDPUNKTE des Rasters (Punkt-Konvention):
//                 Spalte i liegt bei west + i * (east - west) / (spalten - 1), Zeile j bei north - j * (north - south) / (zeilen - 1).

// Erzeugt das Höhenraster. meta: Inhalt von hoehen.json, daten: Int16Array der Werte.
export function erzeugeHoehenraster(meta, daten) {
  const { west, south, east, north, spalten, zeilen } = meta;
  const nodata = meta.nodata ?? -32768;
  if (!(spalten >= 2) || !(zeilen >= 2)) throw new Error('Höhenraster: zu wenige Spalten oder Zeilen');
  if (daten.length !== spalten * zeilen) throw new Error(`Höhenraster: ${daten.length} Werte, erwartet ${spalten * zeilen}`);

  // Höhe in Metern an (lat, lon) oder null: außerhalb des Rasters oder wenn einer der vier Nachbarpunkte keine Daten hat
  function hoeheAn(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const x = ((lon - west) / (east - west)) * (spalten - 1);
    const y = ((north - lat) / (north - south)) * (zeilen - 1);
    if (x < 0 || y < 0 || x > spalten - 1 || y > zeilen - 1) return null;
    const i = Math.min(Math.floor(x), spalten - 2);
    const j = Math.min(Math.floor(y), zeilen - 2);
    const fx = x - i;
    const fy = y - j;
    const w = daten[j * spalten + i];
    const o = daten[j * spalten + i + 1];
    const sw = daten[(j + 1) * spalten + i];
    const so = daten[(j + 1) * spalten + i + 1];
    if (w === nodata || o === nodata || sw === nodata || so === nodata) return null;
    const oben = w + (o - w) * fx;
    const unten = sw + (so - sw) * fx;
    return (oben + (unten - oben) * fy) / 10; // Dezimeter in Meter
  }

  return { hoeheAn, grenzen: { west, south, east, north } };
}

// Lädt hoehen.json und hoehen.bin aus dem Ordner basisUrl (z. B. "daten/"). "holen" ist fetch (austauschbar für Tests).
export async function ladeHoehenraster(basisUrl, holen = (...a) => fetch(...a)) {
  const basis = basisUrl.endsWith('/') ? basisUrl : `${basisUrl}/`;
  const mAntwort = await holen(`${basis}hoehen.json`);
  if (!mAntwort.ok) throw new Error(`hoehen.json nicht gefunden (Status ${mAntwort.status})`);
  const meta = await mAntwort.json();
  const bAntwort = await holen(`${basis}hoehen.bin`);
  if (!bAntwort.ok) throw new Error(`hoehen.bin nicht gefunden (Status ${bAntwort.status})`);
  const buf = await bAntwort.arrayBuffer();
  const erwartet = meta.spalten * meta.zeilen * 2;
  if (buf.byteLength !== erwartet) throw new Error(`hoehen.bin hat ${buf.byteLength} Bytes, erwartet ${erwartet}`);
  const dv = new DataView(buf);
  const daten = new Int16Array(meta.spalten * meta.zeilen);
  for (let k = 0; k < daten.length; k++) daten[k] = dv.getInt16(k * 2, true);
  return erzeugeHoehenraster(meta, daten);
}
