// Das game-Objekt wird an jedes Modul uebergeben: mountX(rootEl, game).
// Es buendelt State, Event-Bus und Hilfsfunktionen.

import { createEventBus } from './events.js';
import { createInitialState, makeId } from './state.js';
import { saveState, loadState, clearState, applyState, defaultStorage } from './save.js';

export function createGame({ storage = defaultStorage() } = {}) {
  const bus = createEventBus();
  const state = createInitialState();
  const saved = loadState(storage);
  if (saved) applyState(state, createInitialState(), saved);

  const game = {
    state,
    on: bus.on,
    emit: bus.emit,
    makeId,

    // Geld aendern. Gibt false zurueck, wenn nicht genug Geld da ist.
    spend(amount, reason) {
      if (state.money < amount) return false;
      state.money -= amount;
      bus.emit('money:changed', { money: state.money, delta: -amount, reason });
      return true;
    },
    earn(amount, reason) {
      state.money += amount;
      bus.emit('money:changed', { money: state.money, delta: amount, reason });
    },

    // Spielstand im localStorage sichern. Gibt false zurueck, wenn das nicht geht.
    save() {
      const ok = saveState(state, storage);
      if (ok) bus.emit('game:saved', {});
      return ok;
    },
    // Neues Spiel: Speicher loeschen, State auf Startwerte. Module rendern auf game:reset neu.
    reset() {
      clearState(storage);
      applyState(state, createInitialState());
      bus.emit('game:reset', {});
    },
  };

  return game;
}
