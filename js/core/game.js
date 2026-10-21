// Das game-Objekt wird an jedes Modul uebergeben: mountX(rootEl, game).
// Es buendelt State, Event-Bus und Hilfsfunktionen.

import { createEventBus } from './events.js';
import { createInitialState, makeId } from './state.js';

export function createGame() {
  const bus = createEventBus();
  const state = createInitialState();

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
  };

  return game;
}
