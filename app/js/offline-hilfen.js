// Offline-Hilfen: reine Logik für den Service Worker und die Seite (getestet in tests/offline-hilfen.test.js).
// Klassisches Skript ohne export: der Service Worker lädt es per importScripts, die Seite per <script>.
// Alles hängt an globalThis.OfflineHilfen. Genutzt werden nur Response, Request, Blob, crypto.subtle, TextEncoder.
(function () {
  const NICHT_ERFUELLBAR = 'unerfuellbar';

  // Range-Kopf (z. B. "bytes=0-99") für eine Datei der Größe `groesse`.
  // Ergebnis: { start, ende } (ende einschließlich), 'unerfuellbar' oder null (keine/unverständliche Angabe, dann ganze Datei).
  function bereich(kopf, groesse) {
    if (typeof kopf !== 'string') return null;
    const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(kopf);
    if (!m || (m[1] === '' && m[2] === '')) return null;
    if (m[1] === '') {
      // Suffix: die letzten N Bytes
      const n = Number(m[2]);
      if (n === 0 || groesse === 0) return NICHT_ERFUELLBAR;
      return { start: Math.max(0, groesse - n), ende: groesse - 1 };
    }
    const start = Number(m[1]);
    if (start >= groesse) return NICHT_ERFUELLBAR;
    if (m[2] === '') return { start, ende: groesse - 1 };
    const ende = Number(m[2]);
    if (ende < start) return NICHT_ERFUELLBAR;
    return { start, ende: Math.min(ende, groesse - 1) };
  }

  // Achtung: Pfade in dateien.json müssen reines ASCII sein (keine Umlaute). Leerzeichen sind erlaubt (getestet): Der Browser
  // kodiert Anfrage-URLs prozentweise, ein Cache-Schlüssel wird beim Ablegen und Suchen gleich aufgelöst.
  // Relativer Pfad zur Basis, ohne Suchanhang und #; Ordner (endet auf / oder leer) bekommen index.html.
  function cacheSchluessel(url, basis) {
    let pfad = String(url).split('#')[0].split('?')[0];
    if (pfad.startsWith(basis)) pfad = pfad.slice(basis.length);
    if (pfad === '' || pfad.endsWith('/')) pfad += 'index.html';
    return pfad;
  }

  // Antwort für eine Anfrage aus dem Cache (mit Range-Unterstützung), sonst undefined.
  // Der Inhalt wird als Blob geschnitten, damit nicht pro Anfrage die ganze Datei kopiert wird.
  async function antwortAusCache(anfrage, cache, basis) {
    const treffer = await cache.match(cacheSchluessel(anfrage.url, basis));
    if (!treffer) return undefined;
    const kopf = anfrage.headers.get('range');
    const typ = treffer.headers.get('Content-Type');
    const blob = await treffer.blob();
    const groesse = blob.size;
    const mitTyp = (h) => { if (typ) h['Content-Type'] = typ; return h; };
    const b = bereich(kopf, groesse);
    if (b === null) {
      return new Response(blob, { status: 200, headers: mitTyp({ 'Content-Length': String(groesse), 'Accept-Ranges': 'bytes' }) });
    }
    if (b === NICHT_ERFUELLBAR) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${groesse}` } });
    }
    const teil = blob.slice(b.start, b.ende + 1);
    return new Response(teil, {
      status: 206,
      headers: mitTyp({
        'Content-Range': `bytes ${b.start}-${b.ende}/${groesse}`,
        'Content-Length': String(b.ende - b.start + 1),
        'Accept-Ranges': 'bytes',
      }),
    });
  }

  function hexVon(bytes) {
    return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('');
  }

  // Lädt die Liste nacheinander in den Cache. Jede Datei muss ok sein und Größe und SHA-256 stimmen.
  // Beim ersten Fehler wird geworfen; fortschritt(gesamt, gesamt, …) kommt nur, wenn alles geladen und geprüft ist.
  async function ladeInCache(cache, liste, basis, holen, fortschritt) {
    let bytesGesamt = 0;
    for (let i = 0; i < liste.length; i++) {
      const { pfad, groesse, sha256 } = liste[i];
      const antwort = await holen(basis + pfad);
      if (!antwort || !antwort.ok) throw new Error(`Laden fehlgeschlagen: ${pfad} (Status ${antwort ? antwort.status : 'keine Antwort'})`);
      const inhalt = await antwort.arrayBuffer();
      if (inhalt.byteLength !== groesse) throw new Error(`Falsche Größe: ${pfad} (${inhalt.byteLength} statt ${groesse} Bytes)`);
      const hash = hexVon(await crypto.subtle.digest('SHA-256', inhalt));
      if (hash !== String(sha256).toLowerCase()) throw new Error(`Falsche Prüfsumme: ${pfad}`);
      const headers = {};
      const typ = antwort.headers.get('Content-Type');
      if (typ) headers['Content-Type'] = typ;
      await cache.put(cacheSchluessel(basis + pfad, basis), new Response(new Blob([inhalt]), { status: 200, headers }));
      bytesGesamt += inhalt.byteLength;
      fortschritt(i + 1, liste.length, bytesGesamt);
    }
  }

  // Pfade der Liste, die im Cache fehlen oder deren Größe nicht stimmt.
  async function fehlende(cache, liste, basis) {
    const fehlt = [];
    for (const { pfad, groesse } of liste) {
      const treffer = await cache.match(cacheSchluessel(basis + pfad, basis));
      if (!treffer) { fehlt.push(pfad); continue; }
      const blob = await treffer.blob();
      if (blob.size !== groesse) fehlt.push(pfad);
    }
    return fehlt;
  }

  function statusText(z) {
    switch (z.zustand) {
      case 'bereit': return `Offline bereit ✓ · Version ${z.version} · ${z.datum}`;
      case 'laedt': return `Daten werden geladen … ${z.fertig} von ${z.gesamt} Dateien (${z.mb} MB). Bitte im WLAN.`;
      case 'unvollstaendig': {
        // Der Service Worker meldet fertig/gesamt, die Seite früher `fehlend`; ohne verlässliche Zahl kein Zahlenwort
        const n = Number.isFinite(z.fehlend) ? z.fehlend : (z.gesamt > 0 && Number.isFinite(z.fertig) ? z.gesamt - z.fertig : 0);
        if (!(n > 0)) return 'Offline NICHT vollständig. Bitte mit Internet öffnen.';
        return `Offline NICHT vollständig: ${n} ${n === 1 ? 'Datei fehlt' : 'Dateien fehlen'}. Bitte mit Internet öffnen.`;
      }
      case 'nicht-moeglich': return 'Offline nicht möglich auf diesem Gerät. Die App läuft nur mit Internet.';
      case 'speicher-voll': return 'Speicher voll: Daten konnten nicht geladen werden. Platz schaffen und neu öffnen.';
      default: return '';
    }
  }

  // Hinweis nur auf dem iPhone im Browser-Tab (dort räumt Safari nach etwa 7 Tagen auf).
  function installiertHinweis(ist) {
    if (ist.ios && !ist.standalone) {
      return 'Tipp für das iPhone: Über „Teilen“ → „Zum Home-Bildschirm“ installieren, sonst löscht Safari die Daten nach etwa 7 Tagen.';
    }
    return '';
  }

  globalThis.OfflineHilfen = { bereich, cacheSchluessel, antwortAusCache, ladeInCache, fehlende, statusText, installiertHinweis };
})();
