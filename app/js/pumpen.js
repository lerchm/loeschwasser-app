// Pumpen für die Auswahl. Wert q = Förderstrom in l/min bei 10 bar und 3 m Saughöhe.
// Es werden nur Garantiepunkte bzw. Nennwerte aus den Originalunterlagen verwendet (siehe docs\pumpen-herstellerangaben.csv).
// Stand der Daten: 2026-11-11
export const PUMPEN = [
  { id: 'ts8', name: 'TS 8', q: 800, quelle: 'Landesfeuerwehrschule Tirol, Garantiepunkt 800 l/min bei 10 bar' },
  { id: 'ts12', name: 'TS 12', q: 1200, quelle: 'Landesfeuerwehrschule Tirol, Garantiepunkt 1200 l/min bei 10 bar' },
  { id: 'ts15', name: 'TS 15', q: 1500, quelle: 'Landesfeuerwehrschule Tirol, Garantiepunkt 1500 l/min bei 10 bar' },
  { id: 'fox96', name: 'Rosenbauer FOX (1996)', q: 1200, quelle: 'Anleitung 1996, S. 12: 1200 l/min bei 10 bar (DIN 14420)' },
  { id: 'fox3', name: 'Rosenbauer FOX III', q: 1500, quelle: 'Prospekt: PFPN 10-1500, Garantieleistung 1500 l/min bei 10 bar' },
  { id: 'fox4', name: 'Rosenbauer FOX 4', q: 1500, quelle: 'Anleitung S. 106: Nennförderstrom 1500 l/min bei 10 bar' },
  { id: 'up4', name: 'Ziegler Ultra Power 4', q: 1500, quelle: 'Broschüre S. 4: Garantiepunkt 1500 l/min bei 10 bar' },
  { id: 'zl1000', name: 'PF ZL1000', q: 750, quelle: 'Datenblatt: 750 l/min bei 10 bar' },
  { id: 'hf1000', name: 'PF hydrofighter PFPN 10-1000', q: 1000, quelle: 'Datenblatt: 1000 l/min bei 10 bar' },
  { id: 'hf1500', name: 'PF hydrofighter PFPN 10-1500', q: 1500, quelle: 'Datenblatt: 1500 l/min bei 10 bar' },
  { id: 'hf2000', name: 'PF hydrofighter PFPN 10-2000', q: 2000, quelle: 'Datenblatt: 2000 l/min bei 10 bar' },
];

export const EIGENE_PUMPE_ID = 'eigene';

export function pumpeNachId(id) {
  return PUMPEN.find((p) => p.id === id) ?? null;
}
