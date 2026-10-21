// Minimaler Event-Bus. Module kommunizieren nur ueber Events und den
// gemeinsamen State, nie durch direkte Imports untereinander.
// Alle Eventnamen sind in README.md unter "Events" dokumentiert.

export function createEventBus() {
  const listeners = new Map();

  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    emit(name, payload) {
      for (const fn of listeners.get(name) ?? []) fn(payload);
    },
  };
}
