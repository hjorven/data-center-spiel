// Tests fuer Netzwerk- und Auftragslogik. Start: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Eigener kleiner Katalog, damit die Tests nicht vom Stand des Shops abhaengen.
const ports = (count, kind, prefix) => Array.from({ length: count }, (_, i) => ({ name: `${prefix}${i + 1}`, kind }));
const CATALOG = [
  { type: 'pdu-8', category: 'pdu', units: 1, ports: ports(8, 'power-out', 'out') },
  { type: 'router-basic', category: 'router', units: 1, ports: [...ports(4, 'rj45', 'ge'), ...ports(2, 'sfp', 'sfp'), ...ports(1, 'power', 'psu')] },
  { type: 'switch-24', category: 'switch', units: 1, ports: [...ports(24, 'rj45', 'ge'), ...ports(2, 'sfp', 'sfp'), ...ports(1, 'power', 'psu')] },
  { type: 'server-1u', category: 'server', units: 1, ports: [...ports(2, 'rj45', 'eth'), ...ports(1, 'power', 'psu')] },
];
const getItem = (type) => CATALOG.find((i) => i.type === type);
import { canConnect, findUplink, isPowered, redundantPaths } from '../js/cabling/network.js';
import { evaluateOrder, completeOrder, acceptOrder, createOrder, ORDER_TEMPLATES, tickOrders, runningIncome } from '../js/orders/orderLogic.js';

let n = 0;
function setup() {
  const state = { money: 0, tick: 0, inventory: [], racks: [{ id: 'r1', units: 12 }], devices: {}, cables: [], orders: [] };
  const ctx = { state, getItem, powerModeled: true };
  const add = (type) => {
    const id = `${type}#${n++}`;
    state.devices[id] = { id, type, rackId: 'r1', slot: 0, ports: getItem(type).ports };
    return id;
  };
  const wire = (a, pa, b, pb) => {
    const r = canConnect(ctx, { deviceId: a, port: pa }, { deviceId: b, port: pb });
    assert.ok(r.ok, r.reason);
    state.cables.push({ id: `c${n++}`, from: { deviceId: a, port: pa }, to: { deviceId: b, port: pb }, cableType: r.cableType });
  };
  return { state, ctx, add, wire };
}

const portsOf = (type, kind) => getItem(type).ports.filter((p) => p.kind === kind).map((p) => p.name);

function basicNet() {
  const t = setup();
  const pdu = t.add('pdu-8');
  const router = t.add('router-basic');
  const sw = t.add('switch-24');
  const srv = t.add('server-1u');
  t.wire(router, 'psu1', pdu, 'out1');
  t.wire(sw, 'psu1', pdu, 'out2');
  t.wire(srv, 'psu1', pdu, 'out3');
  t.wire(sw, portsOf('switch-24', 'rj45')[0], router, portsOf('router-basic', 'rj45')[0]);
  t.wire(srv, 'eth1', sw, portsOf('switch-24', 'rj45')[1]);
  return { ...t, pdu, router, sw, srv };
}

test('Ports pruefen: falscher Typ, belegt, Strom', () => {
  const t = setup();
  const pdu = t.add('pdu-8');
  const srv = t.add('server-1u');
  const sw = t.add('switch-24');
  assert.equal(canConnect(t.ctx, { deviceId: srv, port: 'eth1' }, { deviceId: pdu, port: 'out1' }).ok, false);
  assert.equal(canConnect(t.ctx, { deviceId: srv, port: 'psu1' }, { deviceId: sw, port: 'psu1' }).ok, false);
  assert.equal(canConnect(t.ctx, { deviceId: srv, port: 'eth1' }, { deviceId: srv, port: 'eth2' }).ok, false);
  t.wire(srv, 'psu1', pdu, 'out1');
  assert.equal(canConnect(t.ctx, { deviceId: sw, port: 'psu1' }, { deviceId: pdu, port: 'out1' }).ok, false);
});

test('Server mit Strom und Switch erreicht den Router', () => {
  const t = basicNet();
  assert.ok(isPowered(t.ctx, t.srv));
  assert.ok(findUplink(t.ctx, t.srv));
  assert.equal(findUplink(t.ctx, t.srv, { requireFiber: true }), null);
});

test('Switch ohne Strom unterbricht die Verbindung', () => {
  const t = basicNet();
  t.state.cables = t.state.cables.filter((c) => !(c.from.deviceId === t.sw && c.cableType === 'power'));
  assert.equal(findUplink(t.ctx, t.srv), null);
});

test('Server leiten nicht weiter', () => {
  const t = basicNet();
  const srv2 = t.add('server-1u');
  t.wire(srv2, 'psu1', t.pdu, 'out4');
  t.wire(srv2, 'eth1', t.srv, 'eth2');
  assert.equal(findUplink(t.ctx, srv2), null);
});

test('Glasfaser und Redundanz', () => {
  const t = basicNet();
  const sw2 = t.add('switch-24');
  t.wire(sw2, 'psu1', t.pdu, 'out4');
  t.wire(sw2, portsOf('switch-24', 'sfp')[0], t.router, portsOf('router-basic', 'sfp')[0]);
  assert.equal(redundantPaths(t.ctx, t.srv), 1);
  t.wire(t.srv, 'eth2', sw2, portsOf('switch-24', 'rj45')[0]);
  assert.equal(redundantPaths(t.ctx, t.srv), 2);
  assert.ok(findUplink(t.ctx, t.srv, { requireFiber: true }));
});

test('Auftrag pruefen, abliefern, Geraete reservieren, laufende Einnahmen', () => {
  const t = basicNet();
  const tpl = ORDER_TEMPLATES.find((x) => x.id === 'web-small');
  const o1 = createOrder(tpl, { id: 'o1', tick: 0 });
  const o2 = createOrder(tpl, { id: 'o2', tick: 0 });
  t.state.orders.push(o1, o2);
  assert.ok(acceptOrder(o1, 0));
  assert.ok(acceptOrder(o2, 0));
  assert.ok(evaluateOrder(t.ctx, o1).ok);
  const r = completeOrder(t.ctx, o1, 10);
  assert.ok(r.ok);
  assert.equal(r.payout, tpl.reward);
  // Der einzige Server gehoert jetzt o1, o2 ist nicht erfuellt.
  assert.equal(evaluateOrder(t.ctx, o2).ok, false);
  assert.equal(runningIncome(t.ctx), tpl.monthly);
  // Kabel weg: Kunde gestoert, keine Einnahmen
  t.state.cables = t.state.cables.filter((c) => c.from.deviceId !== t.srv || c.cableType === 'power');
  assert.equal(runningIncome(t.ctx), 0);
});

test('Verspaetung halbiert, doppelte Frist laesst scheitern', () => {
  const t = basicNet();
  const tpl = ORDER_TEMPLATES.find((x) => x.id === 'web-small');
  const o = createOrder(tpl, { id: 'o', tick: 0 });
  t.state.orders.push(o);
  acceptOrder(o, 0);
  const late = completeOrder(t.ctx, { ...o }, tpl.durationTicks + 5);
  assert.equal(late.payout, Math.round(tpl.reward / 2));
  const ev = tickOrders(t.ctx, { tick: tpl.durationTicks * 2 + 1, catalog: CATALOG, makeId: (p) => `${p}-${n++}`, rand: () => 0 });
  assert.equal(ev.failed.length, 1);
  assert.equal(o.status, 'failed');
});

test('Boerse fuellt sich mit Angeboten, die der Katalog erfuellen kann', () => {
  const t = setup();
  let ids = 0;
  for (let tick = 1; tick <= 200; tick++) tickOrders(t.ctx, { tick, catalog: CATALOG, makeId: () => `o${ids++}` });
  const open = t.state.orders.filter((o) => o.status === 'open');
  assert.equal(open.length, 3);
  assert.ok(open.every((o) => ORDER_TEMPLATES.find((x) => x.id === o.templateId).level === 1));
});
