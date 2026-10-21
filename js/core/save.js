// Speichern und Laden des Spielzustands im localStorage.
// Der State ist reines JSON. Beim Laden werden fehlende Felder mit den
// Startwerten aufgefuellt, damit alte Spielstaende nach Updates weiter laden.

export const SAVE_KEY = 'data-center-spiel:save';

export function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function saveState(state, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Gibt den gespeicherten State zurueck, oder null wenn keiner da oder er kaputt ist.
export function loadState(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function clearState(storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // Speicher nicht verfuegbar, das Spiel laeuft trotzdem.
  }
}

// Ueberschreibt target in place mit base + saved. Die Objekt-Referenz bleibt
// gleich, damit Module, die game.state halten, nichts verpassen.
export function applyState(target, base, saved = {}) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, base, saved);
  return target;
}
