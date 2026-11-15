// Service Worker der Löschwasser-App. Vorlage: tools/deploy-bauen.py ersetzt 22530c2cb0ea und schreibt dist/sw.js.
// Klassischer Worker im Wurzelordner der Webseite. Nur Kleber: die Logik (Range, Cache-Schlüssel, Laden mit Prüfung,
// fehlende Dateien) steckt in app/js/offline-hilfen.js und ist dort getestet. Abläufe getestet in tests/deploy.test.js.
//
// Nachrichten Seite -> SW: {typ:'frage-status'} (Antwort an den Absender), {typ:'jetzt-umschalten'} (wartende Version einschalten).
// Nachrichten SW -> Seite: {typ:'status', zustand, fertig, gesamt, mb, version}, {typ:'neue-version-bereit', version}.
// Die Seite vergleicht `version` mit der Version, die sie gerade steuert (Meldungen einer Update-Installation tragen die neue).
importScripts('app/js/offline-hilfen.js');

const VERSION = '22530c2cb0ea';
const CACHE = 'lw-' + VERSION;
const BASIS = self.registration.scope; // z. B. https://<konto>.github.io/<repo>/ (endet auf /)
const H = self.OfflineHilfen;

// Status dieses Worker-Durchlaufs während der Installation. Nach einem Neustart des Workers ist er leer,
// dann wird der Status aus dem Cache berechnet (aktuellerStatus).
let status = null;

const mb = (bytes) => Math.round(bytes / 104857.6) / 10;
const statusObjekt = (zustand, fertig, gesamt, bytes) => ({ typ: 'status', zustand, fertig, gesamt, mb: mb(bytes), version: VERSION });

// An alle Fenster, auch an solche, die (beim ersten Mal) noch nicht von diesem Worker gesteuert werden. Wirft nie.
async function anAlleFenster(nachricht) {
  try {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenster) f.postMessage(nachricht);
  } catch (e) { /* kein Fenster erreichbar: egal */ }
}

// Statusmeldungen laufen hintereinander, damit nie ein später Fortschritt nach "bereit" ankommt.
let kette = Promise.resolve();
function setzeStatus(zustand, fertig, gesamt, bytes) {
  const s = statusObjekt(zustand, fertig, gesamt, bytes);
  status = s;
  kette = kette.then(() => anAlleFenster(s));
  return kette;
}

async function installieren() {
  const update = Boolean(self.registration.active); // läuft schon eine Version, ist das ein Update
  let gesamt = 0;
  let bytes = 0;
  // Gab es lw-<VERSION> schon (z. B. der aktive Cache, wenn nur eine importierte Datei anders ist und sw.js gleich),
  // darf ein Fehler ihn nicht löschen. Vorgabe true: nur löschen, was diese Installation sicher selbst angelegt hat.
  let vorher = true;
  status = statusObjekt('laedt', 0, 0, 0);
  try {
    vorher = await caches.has(CACHE);
    const antwort = await fetch(BASIS + 'dateien.json', { cache: 'no-store' });
    if (!antwort.ok) throw new Error('dateien.json: Status ' + antwort.status);
    const text = await antwort.text();
    const liste = JSON.parse(text);
    if (liste.version !== VERSION) throw new Error('dateien.json gehört zu Version ' + liste.version + ', nicht ' + VERSION);
    gesamt = liste.dateien.length;
    await setzeStatus('laedt', 0, gesamt, 0);
    const cache = await caches.open(CACHE);
    // 'no-cache': der Browser darf nachfragen (304), liefert aber nie eine veraltete Datei aus dem HTTP-Zwischenspeicher
    const holen = (url) => fetch(url, { cache: 'no-cache' });
    await H.ladeInCache(cache, liste.dateien, BASIS, holen, (f, g, b) => { bytes = b; setzeStatus('laedt', f, g, b); });
    // Die Liste selbst mitlegen: daran prüft die Seite offline, ob alles da ist
    await cache.put('dateien.json', new Response(text, { headers: { 'Content-Type': 'application/json' } }));
  } catch (fehler) {
    // Halb geladene Version wegwerfen (nur wenn diese Installation den Cache neu angelegt hat).
    // Die Installation scheitert, die alte Version bleibt aktiv. Ein schon vorhandener Teil-Cache ist harmlos,
    // aktuellerStatus prüft ihn mit fehlende().
    if (!vorher) {
      try { await caches.delete(CACHE); } catch (e) { /* nichts zu löschen */ }
    }
    await setzeStatus(fehler && fehler.name === 'QuotaExceededError' ? 'speicher-voll' : 'unvollstaendig', 0, gesamt, 0);
    throw fehler;
  }
  await setzeStatus('bereit', gesamt, gesamt, bytes);
  if (update) {
    // Nie selbst umschalten (nicht mitten im Einsatz). Die Seite fragt und schickt {typ:'jetzt-umschalten'}.
    await anAlleFenster({ typ: 'neue-version-bereit', version: VERSION });
  } else {
    await self.skipWaiting(); // allererste Installation: sofort einschalten
  }
}

// Status aus dem eigenen Cache: bereit nur, wenn jede Datei der Liste mit richtiger Größe da ist.
async function aktuellerStatus() {
  if (status && status.zustand !== 'bereit') return status; // Installation läuft gerade oder ist gescheitert
  try {
    if (!(await caches.has(CACHE))) return statusObjekt('unvollstaendig', 0, 0, 0);
    const cache = await caches.open(CACHE);
    const eintrag = await cache.match('dateien.json');
    if (!eintrag) return statusObjekt('unvollstaendig', 0, 0, 0);
    const dateien = (await eintrag.json()).dateien;
    const fehlt = new Set(await H.fehlende(cache, dateien, BASIS));
    const bytes = dateien.reduce((s, d) => s + (fehlt.has(d.pfad) ? 0 : d.groesse), 0);
    return statusObjekt(fehlt.size ? 'unvollstaendig' : 'bereit', dateien.length - fehlt.size, dateien.length, bytes);
  } catch (e) {
    return statusObjekt('unvollstaendig', 0, 0, 0);
  }
}

async function antworten(anfrage) {
  try {
    if (await caches.has(CACHE)) {
      const antwort = await H.antwortAusCache(anfrage, await caches.open(CACHE), BASIS);
      if (antwort) return antwort;
    }
  } catch (e) { /* Cache nicht lesbar: Netz versuchen */ }
  return fetch(anfrage);
}

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(installieren());
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil((async () => {
    // Erst jetzt (Version eingeschaltet) die alten Versionen löschen. Fremde Caches (ohne lw-) bleiben.
    const namen = await caches.keys();
    await Promise.all(namen.filter((n) => n.startsWith('lw-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
    await anAlleFenster(await aktuellerStatus());
  })());
});

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  // Nur eigene Herkunft innerhalb des Bereichs und nur GET. Alles andere geht unverändert ans Netz.
  if (anfrage.method !== 'GET') return;
  if (new URL(anfrage.url).origin !== self.location.origin || !anfrage.url.startsWith(BASIS)) return;
  ereignis.respondWith(antworten(anfrage));
});

self.addEventListener('message', (ereignis) => {
  const daten = ereignis.data || {};
  if (daten.typ === 'jetzt-umschalten') {
    ereignis.waitUntil(self.skipWaiting()); // wirkt nur bei einer wartenden Version; den Neuladen-Ablauf macht die Seite (controllerchange)
  } else if (daten.typ === 'frage-status') {
    ereignis.waitUntil(aktuellerStatus().then((s) => { if (ereignis.source) ereignis.source.postMessage(s); }));
  }
});
