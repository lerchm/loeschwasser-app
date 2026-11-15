// Offline-Betrieb in der Seite: Service Worker anmelden, Status zeigen, Update auf Antippen.
// Die Logik (Texte, Prüfung der Dateien) steckt in offline-hilfen.js (klassisches Skript, globalThis.OfflineHilfen).
// Nachrichten des Service Workers: siehe tools/sw-vorlage.js. Planungsdaten liegen in localStorage und werden hier nie angefasst.

const ENTWICKLUNG = 'Entwicklungsstand: kein Offline-Paket';

// Datum "12.11.2026" aus dem Bauzeitpunkt (ISO) von dateien.json; bei Unklarem leer
function datumVon(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// Startet den Offline-Betrieb. Wirft nie. `umg` ersetzt in Tests navigator, document, fetch, location, caches.
export async function startOffline(umg = {}) {
  const nav = umg.navigator ?? globalThis.navigator ?? {};
  const doc = umg.document ?? globalThis.document;
  const holen = umg.fetch ?? globalThis.fetch?.bind(globalThis);
  const ort = umg.location ?? globalThis.location;
  const zeitgeber = umg.setTimeout ?? globalThis.setTimeout?.bind(globalThis);
  const zeitStop = umg.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis);
  const H = globalThis.OfflineHilfen;
  const el = (id) => doc?.getElementById?.(id) ?? null;

  let laufendeVersion = null; // Version, die diese Seite gerade steuert (Meldungen anderer Versionen werden ignoriert)
  let datum = '';

  function zeigeStatus(z) {
    const e = el('offlineStatus');
    if (!e) return;
    e.dataset.zustand = z.zustand;
    e.textContent = H.statusText({ datum, ...z });
  }
  // Zwischenstände ohne Zahlen (kein Wort "bereit", solange der Service Worker nichts bestätigt hat)
  function zeigeText(zustand, text) {
    const e = el('offlineStatus');
    if (!e) return;
    e.dataset.zustand = zustand;
    e.textContent = text;
  }

  try {
    if (!nav.serviceWorker) { zeigeStatus({ zustand: 'nicht-moeglich' }); return; }

    // Nur mit Offline-Paket (dist): dateien.json liegt neben dem Wurzelordner. Im Entwicklungsmodus gibt es sie nicht.
    let liste = null;
    try {
      const antwort = await holen('../dateien.json', { cache: 'no-store' });
      if (antwort && antwort.ok) liste = await antwort.json();
    } catch (e) { liste = null; }
    if (!liste || typeof liste.version !== 'string' || !Array.isArray(liste.dateien)) {
      const e = el('offlineStatus');
      if (e) { e.dataset.zustand = 'entwicklung'; e.textContent = ENTWICKLUNG; }
      return;
    }
    laufendeVersion = liste.version;
    datum = datumVon(liste.gebaut);
    const v = el('infoVersion');
    if (v) v.textContent = `Version ${liste.version}${datum ? ' vom ' + datum : ''}`;

    const sw = nav.serviceWorker;
    const hatteSteuerung = Boolean(sw.controller);
    let neuLadenErlaubt = hatteSteuerung;
    let schonNeuGeladen = false;
    let antwortWarten = null; // Zeitgeber: Antwort des steuernden Workers auf frage-status

    // Nachrichten zuerst anmelden, damit keine verloren geht
    sw.addEventListener?.('message', (ereignis) => {
      const n = ereignis.data || {};
      if (n.typ === 'status') {
        if (n.version !== laufendeVersion) return; // Meldung einer Update-Installation: Anzeige der laufenden Version bleibt
        if (antwortWarten !== null) { zeitStop?.(antwortWarten); antwortWarten = null; }
        zeigeStatus(n);
      } else if (n.typ === 'neue-version-bereit') {
        if (n.version !== laufendeVersion) zeigeUpdate();
      }
    });
    // Neue Version eingeschaltet: in jedem Tab neu laden (nicht beim allerersten Einschalten der Erstinstallation)
    sw.addEventListener?.('controllerchange', () => {
      // Ein Tab, der beim ersten Einschalten noch ungesteuert war, lässt das erste Ereignis durch (Erstinstallation).
      // Jedes spätere bedeutet: eine neue Version wurde eingeschaltet, dann lädt auch dieser Tab neu (sonst Mischstand).
      if (!neuLadenErlaubt) { neuLadenErlaubt = true; return; }
      if (schonNeuGeladen) return;
      schonNeuGeladen = true;
      ort?.reload?.();
    });

    let registrierung = null;
    function zeigeUpdate() {
      const k = el('updateKnopf');
      if (!k) return;
      k.hidden = false;
      k.disabled = false;
      k.textContent = 'Neue Version bereit: jetzt laden';
    }
    const k = el('updateKnopf');
    if (k) {
      k.addEventListener('click', () => {
        // Die neue Version wartet (registration.waiting), sie steuert noch nicht
        // Die Meldung kann kommen, solange die neue Version noch "installing" ist: dann auf "installed" warten
        const wartend = registrierung?.waiting || registrierung?.installing;
        if (!wartend) return;
        neuLadenErlaubt = true;
        k.disabled = true;
        k.textContent = 'Wird umgeschaltet …';
        let gesendet = false;
        const senden = () => {
          if (gesendet) return;
          gesendet = true;
          (registrierung.waiting || wartend).postMessage({ typ: 'jetzt-umschalten' });
        };
        if (wartend.state === 'installing') {
          wartend.addEventListener?.('statechange', () => { if (wartend.state === 'installed') senden(); });
        } else {
          senden();
        }
        // Kam nach 10 s kein Wechsel (controllerchange lädt die Seite neu), wieder bedienbar machen
        zeitgeber?.(() => {
          k.disabled = false;
          k.textContent = 'Umschalten hat nicht geklappt. Bitte erneut tippen.';
        }, 10000);
      });
    }

    registrierung = await sw.register('../sw.js', { scope: '../', updateViaCache: 'none' });
    neuLadenErlaubt = neuLadenErlaubt || Boolean(registrierung.active);

    // Speicher dauerhaft anfordern (Ergebnis egal)
    try { await nav.storage?.persist?.(); } catch (e) { /* egal */ }

    // Hinweis fürs iPhone
    const hinweis = el('offlineHinweis');
    if (hinweis) {
      const ua = nav.userAgent || '';
      const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
      const standalone = nav.standalone === true || Boolean(globalThis.matchMedia?.('(display-mode: standalone)')?.matches);
      hinweis.textContent = H.installiertHinweis({ ios, standalone });
    }

    // Update, das schon fertig geladen wartet, bevor diese Seite geöffnet wurde
    if (registrierung.waiting && (hatteSteuerung || registrierung.active)) zeigeUpdate();

    zeigeText('pruefe', 'Offline-Status wird geprüft …');
    if (hatteSteuerung) {
      // Der steuernde Worker prüft seinen Cache selbst (im Worker stimmen die Schlüssel) und meldet Status samt Version.
      // So heißt "bereit": dieser Worker steuert die Seite UND hat diese Version vollständig.
      antwortWarten = zeitgeber?.(() => {
        antwortWarten = null;
        zeigeText('unklar', 'Offline-Status unklar, bitte mit Internet neu öffnen.');
      }, 5000) ?? null;
      try { sw.controller.postMessage({ typ: 'frage-status' }); } catch (e) { /* Zeitgeber meldet "unklar" */ }
    } else {
      // Erstinstallation läuft: der Service Worker meldet den Fortschritt
      try { (registrierung.installing || registrierung.waiting || registrierung.active)?.postMessage({ typ: 'frage-status' }); } catch (e) { /* egal */ }
    }

    // Auf Neuerungen prüfen: beim Start (der Browser prüft sw.js bei Navigation von selbst; register mit gleicher Adresse löst kein Update aus) und wenn die App wieder in den Vordergrund kommt
    doc?.addEventListener?.('visibilitychange', () => {
      if (doc.visibilityState === 'visible') registrierung.update().catch(() => {});
    });
  } catch (fehler) {
    // Anmeldung abgelehnt (z. B. kein sicherer Zugang, privates Fenster): App läuft online weiter
    try { zeigeStatus({ zustand: 'nicht-moeglich' }); } catch (e) { /* egal */ }
  }
}
