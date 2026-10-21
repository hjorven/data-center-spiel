// Tests fuer js/logic/engine.js und js/core/save.js. Start: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../js/core/game.js';
import { SAVE_KEY } from '../js/core/save.js';
import { createLogic, POWER_COST_PER_KW_TICK } from '../js/logic/engine.js';

const CATALOG = {
  'server-1u': { type: 'server-1u', name: 'Server 1U', category: 'server', units: 1, power: 200, ports: [{ name: 'eth0', kind: 'rj45' }], capacity: { cpu: 8, ram: 32 } },
  'server-2u': { type: 'server-2u', name: 'Server 2U', category: 'server', units: 2, power: 400, ports: [], capacity: { cpu: 24 } },
  'switch-24': { type: 'switch-24', name: 'Switch 24', category: 'switch', units: 1, ports: [] },
  'cable-rj45': { type: 'cable-rj45', name: 'Kabel', category: 'cable', units: 0, ports: [] },
};
const getItem = (type) => CATALOG[type];

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function setup(storage = null) {
  const game = createGame({ storage });
  const logic = createLogic(game, getItem);
  const events = [];
  for (const name of ['rack:deviceInstalled', 'rack:deviceRemoved', 'rack:deviceMoved', 'tick', 'money:changed']) {
    game.on(name, (payload) => events.push([name, payload]));
  }
  const buy = (type) => {
    const id = game.makeId('inv');
    game.state.inventory.push({ id, type });
    return id;
  };
  return { game, logic, events, buy, rackId: game.state.racks[0].id };
}

test('Einbau belegt Slots, nimmt aus dem Lager und sendet Event', () => {
  const { game, logic, events, buy, rackId } = setup();
  const inv = buy('server-2u');
  const result = logic.installDevice(inv, rackId, 3);
  assert.deepEqual(result, { ok: true, deviceId: inv });
  assert.equal(game.state.inventory.length, 0);
  assert.equal(game.state.racks[0].slots[3], inv);
  assert.equal(game.state.racks[0].slots[4], inv);
  assert.equal(game.state.racks[0].slots[5], null);
  assert.equal(game.state.devices[inv].slot, 3);
  assert.deepEqual(events[0], ['rack:deviceInstalled', { deviceId: inv, rackId, slot: 3 }]);
});

test('Einbau prueft Grenzen, Belegung und Typ', () => {
  const { logic, buy, rackId } = setup();
  assert.equal(logic.installDevice('gibts-nicht', rackId, 0).reason, 'not-in-inventory');
  assert.equal(logic.installDevice(buy('server-2u'), rackId, 11).reason, 'out-of-bounds');
  assert.equal(logic.installDevice(buy('cable-rj45'), rackId, 0).reason, 'not-mountable');
  logic.installDevice(buy('server-1u'), rackId, 0);
  assert.equal(logic.installDevice(buy('server-1u'), rackId, 0).reason, 'occupied');
  assert.equal(logic.installDevice(buy('server-1u'), 'rack-x', 0).reason, 'unknown-rack');
});

test('freeSlots beruecksichtigt die Hoehe', () => {
  const { logic, buy, rackId } = setup();
  logic.installDevice(buy('server-1u'), rackId, 1);
  const free = logic.freeSlots('server-2u', rackId);
  assert.ok(!free.includes(0));
  assert.ok(!free.includes(1));
  assert.ok(free.includes(2));
  assert.ok(!free.includes(11));
});

test('Ausbau gibt Slots frei und legt ins Lager zurueck', () => {
  const { game, logic, events, buy, rackId } = setup();
  const inv = buy('server-2u');
  logic.installDevice(inv, rackId, 0);
  assert.equal(logic.removeDevice(inv).ok, true);
  assert.deepEqual(game.state.racks[0].slots.slice(0, 2), [null, null]);
  assert.deepEqual(game.state.inventory, [{ id: inv, type: 'server-2u' }]);
  assert.equal(game.state.devices[inv], undefined);
  assert.deepEqual(events.at(-1), ['rack:deviceRemoved', { deviceId: inv }]);
});

test('Versetzen darf den eigenen Platz ueberlappen', () => {
  const { game, logic, buy, rackId } = setup();
  const inv = buy('server-2u');
  logic.installDevice(inv, rackId, 0);
  assert.equal(logic.moveDevice(inv, rackId, 1).ok, true);
  assert.deepEqual(game.state.racks[0].slots.slice(0, 3), [null, inv, inv]);
  assert.equal(logic.moveDevice(inv, rackId, 11).reason, 'out-of-bounds');
  assert.equal(game.state.devices[inv].slot, 1);
});

test('Rack kaufen kostet Geld', () => {
  const { game, logic } = setup();
  assert.equal(logic.buyRack(24).reason, 'no-money');
  game.earn(5000, 'test');
  const { ok, rackId } = logic.buyRack(24);
  assert.equal(ok, true);
  assert.equal(game.state.racks.at(-1).id, rackId);
  assert.equal(game.state.racks.at(-1).slots.length, 24);
  assert.equal(game.state.money, 1000 + 5000 - 1500);
});

test('Strom und Kapazitaet werden summiert', () => {
  const { logic, buy, rackId } = setup();
  logic.installDevice(buy('server-1u'), rackId, 0);
  logic.installDevice(buy('server-2u'), rackId, 1);
  logic.installDevice(buy('switch-24'), rackId, 3);
  assert.equal(logic.powerUsage(), 200 + 400 + 40);
  assert.deepEqual(logic.capacity(), { cpu: 32, ram: 32 });
});

test('Tick zieht Stromkosten in ganzen Dollar ab', () => {
  const { game, logic, events, buy, rackId } = setup();
  logic.installDevice(buy('server-1u'), rackId, 0);
  const perTick = 0.2 * POWER_COST_PER_KW_TICK;
  const ticks = Math.ceil(1 / perTick);
  for (let i = 0; i < ticks; i++) logic.tick();
  assert.equal(game.state.tick, ticks);
  assert.equal(game.state.money, 999);
  assert.ok(events.some(([name, p]) => name === 'money:changed' && p.reason === 'power'));
});

test('Speichern, Laden und Neues Spiel', () => {
  const storage = memoryStorage();
  const first = setup(storage);
  const inv = first.buy('server-1u');
  first.logic.installDevice(inv, first.rackId, 4);
  first.game.spend(100, 'test');
  assert.equal(first.game.save(), true);

  const second = createGame({ storage });
  assert.equal(second.state.money, 900);
  assert.equal(second.state.devices[inv].slot, 4);
  assert.equal(second.state.racks[0].slots[4], inv);

  const stateRef = second.state;
  second.reset();
  assert.equal(second.state, stateRef);
  assert.equal(second.state.money, 1000);
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('Kaputter oder alter Spielstand bricht nichts', () => {
  const storage = memoryStorage();
  storage.setItem(SAVE_KEY, '{kaputt');
  assert.equal(createGame({ storage }).state.money, 1000);
  storage.setItem(SAVE_KEY, JSON.stringify({ money: 42 }));
  const game = createGame({ storage });
  assert.equal(game.state.money, 42);
  assert.deepEqual(game.state.cables, []);
  assert.equal(game.state.powerDue, 0);
});
