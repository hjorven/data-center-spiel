// Spielregeln ohne DOM: Rack-Slots, Einbau, Ausbau, Strom und Kapazitaet.
// Owner: Thread "Spiellogik". Wird von logic.js als game.logic bereitgestellt,
// damit andere Module die Regeln nutzen koennen, ohne js/logic zu importieren.
//
// Slot-Konvention: racks[i].slots[s] ist null oder eine deviceId. Ein Geraet mit
// units = n belegt slots[slot] bis slots[slot + n - 1]. Index 0 ist oben im Rack.

// Stromverbrauch in Watt, falls ein Katalogeintrag kein power-Feld hat.
const DEFAULT_POWER = { server: 250, storage: 300, switch: 40, router: 30, patchpanel: 0, ups: 0, pdu: 0 };

// Kosten pro Kilowatt und Tick. Angefangene Dollar werden gesammelt (state.powerDue).
export const POWER_COST_PER_KW_TICK = 0.5;

// Racks werden in der Rack-Ansicht gekauft, nicht im Shop.
export const RACK_OFFERS = [
  { units: 24, price: 1500 },
  { units: 42, price: 3000 },
];

export function createLogic(game, getItem) {
  const state = () => game.state;

  function itemFor(type) {
    const item = getItem(type);
    if (!item) throw new Error(`Unbekannter Artikel: ${type}`);
    return item;
  }

  function getRack(rackId) {
    return state().racks.find((r) => r.id === rackId) || null;
  }

  function findInventory(inventoryId) {
    return state().inventory.find((entry) => entry.id === inventoryId) || null;
  }

  function takeFromInventory(inventoryId) {
    const list = state().inventory;
    const index = list.findIndex((entry) => entry.id === inventoryId);
    if (index === -1) return null;
    return list.splice(index, 1)[0];
  }

  // Prueft, ob ein Geraet des Typs ab slot ins Rack passt.
  // ignoreDeviceId: eigener Platz zaehlt als frei (fuer moveDevice).
  function canPlace(type, rackId, slot, ignoreDeviceId = null) {
    const item = getItem(type);
    if (!item) return { ok: false, reason: 'unknown-type' };
    if (!(item.units > 0) || item.category === 'rack') return { ok: false, reason: 'not-mountable' };
    const rack = getRack(rackId);
    if (!rack) return { ok: false, reason: 'unknown-rack' };
    if (!Number.isInteger(slot) || slot < 0 || slot + item.units > rack.units) {
      return { ok: false, reason: 'out-of-bounds' };
    }
    for (let i = slot; i < slot + item.units; i++) {
      const occupant = rack.slots[i];
      if (occupant !== null && occupant !== ignoreDeviceId) return { ok: false, reason: 'occupied' };
    }
    return { ok: true };
  }

  function freeSlots(type, rackId) {
    const rack = getRack(rackId);
    if (!rack) return [];
    const result = [];
    for (let s = 0; s < rack.units; s++) {
      if (canPlace(type, rackId, s).ok) result.push(s);
    }
    return result;
  }

  function fillSlots(rack, slot, units, value) {
    for (let i = slot; i < slot + units; i++) rack.slots[i] = value;
  }

  // Baut ein Geraet aus dem Inventar ein. Die Inventar-ID wird zur deviceId.
  function installDevice(inventoryId, rackId, slot) {
    const entry = findInventory(inventoryId);
    if (!entry) return { ok: false, reason: 'not-in-inventory' };
    const check = canPlace(entry.type, rackId, slot);
    if (!check.ok) return check;
    takeFromInventory(inventoryId);
    const item = itemFor(entry.type);
    const device = {
      id: entry.id,
      type: entry.type,
      rackId,
      slot,
      ports: (item.ports || []).map((p) => ({ ...p })),
    };
    state().devices[device.id] = device;
    fillSlots(getRack(rackId), slot, item.units, device.id);
    game.emit('rack:deviceInstalled', { deviceId: device.id, rackId, slot });
    return { ok: true, deviceId: device.id };
  }

  // Baut ein Geraet aus und legt es ins Inventar zurueck.
  // Kabel raeumt das Verkabelungs-Modul bei rack:deviceRemoved auf.
  function removeDevice(deviceId) {
    const device = state().devices[deviceId];
    if (!device) return { ok: false, reason: 'unknown-device' };
    const rack = getRack(device.rackId);
    if (rack) {
      rack.slots = rack.slots.map((s) => (s === deviceId ? null : s));
    }
    delete state().devices[deviceId];
    state().inventory.push({ id: device.id, type: device.type });
    game.emit('rack:deviceRemoved', { deviceId });
    return { ok: true };
  }

  // Versetzt ein Geraet. Kabel bleiben dran, deshalb kein Remove/Install-Event-Paar.
  function moveDevice(deviceId, rackId, slot) {
    const device = state().devices[deviceId];
    if (!device) return { ok: false, reason: 'unknown-device' };
    const check = canPlace(device.type, rackId, slot, deviceId);
    if (!check.ok) return check;
    const oldRack = getRack(device.rackId);
    oldRack.slots = oldRack.slots.map((s) => (s === deviceId ? null : s));
    device.rackId = rackId;
    device.slot = slot;
    fillSlots(getRack(rackId), slot, itemFor(device.type).units, deviceId);
    game.emit('rack:deviceMoved', { deviceId, rackId, slot });
    return { ok: true };
  }

  // Stellt ein gekauftes Rack (Katalog-Kategorie 'rack', units = Hoehe) auf.
  function installRack(inventoryId) {
    const entry = findInventory(inventoryId);
    if (!entry) return { ok: false, reason: 'not-in-inventory' };
    const item = getItem(entry.type);
    if (!item || item.category !== 'rack') return { ok: false, reason: 'not-a-rack' };
    takeFromInventory(inventoryId);
    const rack = { id: entry.id, type: entry.type, units: item.units, slots: Array(item.units).fill(null) };
    state().racks.push(rack);
    game.emit('rack:added', { rackId: rack.id });
    return { ok: true, rackId: rack.id };
  }

  // Kauft ein neues, leeres Rack.
  function buyRack(units) {
    const offer = RACK_OFFERS.find((o) => o.units === units);
    if (!offer) return { ok: false, reason: 'unknown-rack-size' };
    if (!game.spend(offer.price, 'rack')) return { ok: false, reason: 'no-money' };
    const rack = { id: game.makeId('rack'), units, slots: Array(units).fill(null) };
    state().racks.push(rack);
    game.emit('rack:added', { rackId: rack.id });
    return { ok: true, rackId: rack.id };
  }

  function powerOf(device) {
    const item = getItem(device.type);
    if (!item) return 0;
    return typeof item.power === 'number' ? item.power : DEFAULT_POWER[item.category] || 0;
  }

  function powerUsage() {
    return Object.values(state().devices).reduce((sum, d) => sum + powerOf(d), 0);
  }

  // Summe der Kapazitaeten aller eingebauten Geraete, z.B. { cpu: 32, ram: 160 }.
  function capacity() {
    const total = {};
    for (const device of Object.values(state().devices)) {
      const cap = getItem(device.type)?.capacity || {};
      for (const [key, value] of Object.entries(cap)) total[key] = (total[key] || 0) + value;
    }
    return total;
  }

  function powerCostPerTick() {
    return (powerUsage() / 1000) * POWER_COST_PER_KW_TICK;
  }

  // Ein Spieltick: Zaehler erhoehen, Strom abrechnen, tick senden.
  // Strom wird auch bei zu wenig Geld abgezogen (Schulden sind moeglich).
  function tick() {
    const s = state();
    s.tick++;
    s.powerDue = (s.powerDue || 0) + powerCostPerTick();
    const bill = Math.floor(s.powerDue + 1e-9);
    if (bill > 0) {
      s.powerDue -= bill;
      s.money -= bill;
      game.emit('money:changed', { money: s.money, delta: -bill, reason: 'power' });
    }
    game.emit('tick', { tick: s.tick });
  }

  return {
    canPlace,
    freeSlots,
    installDevice,
    removeDevice,
    moveDevice,
    installRack,
    buyRack,
    rackOffers: RACK_OFFERS,
    powerUsage,
    powerCostPerTick,
    capacity,
    tick,
  };
}
