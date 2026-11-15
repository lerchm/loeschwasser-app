// Hilfen für "Mein Standort" (rein, getestet in tests/standort.test.js).
// Der Standort wird nur angezeigt: nicht gespeichert, nicht gesendet.

const M_PRO_GRAD = (6371008.8 * Math.PI) / 180;

// Ring um "mitte" ({ lat, lon }) mit Radius in Metern, als Liste [Länge, Breite]; erster und letzter Punkt sind gleich.
// Beginnt genau im Norden der Mitte. Für Genauigkeitskreise (wenige Meter bis einige hundert Meter) reicht die ebene Näherung.
export function kreisKoordinaten(mitte, radiusM, schritte = 48) {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return [];
  const dLat = radiusM / M_PRO_GRAD;
  const dLon = radiusM / (M_PRO_GRAD * Math.cos((mitte.lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i < schritte; i++) {
    const winkel = (2 * Math.PI * i) / schritte;
    ring.push([mitte.lon + dLon * Math.sin(winkel), mitte.lat + dLat * Math.cos(winkel)]);
  }
  ring.push([...ring[0]]);
  return ring;
}

// Text bei einem Standortfehler: 1, 2, 3 sind die Codes des Browsers; sonst 'nicht-unterstuetzt', 'unsicher' oder unbekannt
export function standortFehlerText(code) {
  switch (code) {
    case 1: return 'Der Standort ist nicht freigegeben. Erlaube den Standort für diese Seite in den Browser-Einstellungen.';
    case 2: return 'Kein GPS-Signal gefunden. Geh ins Freie und versuche es noch einmal.';
    case 3: return 'Der Standort wurde nicht rechtzeitig gefunden. Versuche es noch einmal.';
    case 'nicht-unterstuetzt': return 'Dieses Gerät oder dieser Browser kann den Standort nicht bestimmen.';
    case 'unsicher': return 'Der Standort braucht eine sichere Verbindung (HTTPS). Am Handy wird das in Etappe 5 geprüft.';
    default: return 'Der Standort konnte nicht bestimmt werden.';
  }
}
