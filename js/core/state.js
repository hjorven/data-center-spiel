// Gemeinsamer Spielzustand. Die Form dieses Objekts ist der Vertrag
// zwischen den Modulen. Neue Felder nur hinzufuegen, nie umbenennen
// oder entfernen, ohne die anderen Module anzupassen.

export function createInitialState() {
  return {
    money: 1000,
    tick: 0,

    // Angefangene Stromkosten, die noch keinen ganzen Dollar ergeben (js/logic).
    powerDue: 0,

    // Gekaufte, noch nicht eingebaute Geraete: [{ id, type }]
    inventory: [],

    // Racks mit Hoeheneinheiten (U). slots[i] ist null oder eine deviceId.
    racks: [
      { id: 'rack-1', units: 12, slots: Array(12).fill(null) },
    ],

    // Eingebaute Geraete: { [deviceId]: { id, type, rackId, slot, ports: [...] } }
    devices: {},

    // Kabel: [{ id, from: { deviceId, port }, to: { deviceId, port }, cableType }]
    cables: [],

    // Auftraege: [{ id, title, status: 'open'|'done'|'failed', reward, requirements }]
    orders: [],
  };
}

let nextId = 1;
export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${nextId++}`;
}
