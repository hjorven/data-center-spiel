// Auftragslogik ohne DOM: erzeugen, pruefen, abrechnen.
// Auftraege liegen in game.state.orders als Array:
// { id, title, customer, text, status: 'open'|'active'|'done'|'failed', reward, monthly,
//   requirements: { servers, storage, fiber, redundant }, createdTick, expiresTick,
//   durationTicks, deadlineTick, deviceIds, completedTick, payout, late }

import { isPowered, findUplink, redundantPaths, deviceInfo } from '../cabling/network.js';

export const BOARD_SIZE = 3;          // so viele Angebote liegen gleichzeitig aus
export const NEW_ORDER_EVERY = 30;    // Ticks bis zum naechsten Angebot
export const OFFER_LIFETIME = 300;    // Ticks, bis ein nicht angenommenes Angebot verschwindet
export const INCOME_EVERY = 60;       // Ticks zwischen zwei laufenden Zahlungen

const CUSTOMERS = [
  'Bäckerei Krume', 'Pixelwerk GmbH', 'Stadtwerke Nordheim', 'FitFabrik', 'Kanzlei Lehmann',
  'Spielhaus Online', 'Hofladen Grün', 'Datenfluss AG', 'Radio Welle 7', 'Uni Südtal',
];

// level: ab welcher Spielerstufe der Auftrag vorkommt. needs: Kategorien, die es im Katalog geben muss.
export const ORDER_TEMPLATES = [
  {
    id: 'web-small', level: 1, title: 'Kleine Webseite', needs: ['server', 'router'],
    text: 'Ein Server mit Internetanbindung.',
    requirements: { servers: 1 }, reward: 700, monthly: 40, durationTicks: 300,
  },
  {
    id: 'web-shop', level: 1, title: 'Onlineshop', needs: ['server', 'switch', 'router'],
    text: 'Zwei Server, beide online.',
    requirements: { servers: 2 }, reward: 1500, monthly: 90, durationTicks: 420,
  },
  {
    id: 'backup', level: 2, title: 'Backup-Speicher', needs: ['server', 'storage', 'router'],
    text: 'Ein Server und ein Storage-System, beide online.',
    requirements: { servers: 1, storage: 1 }, reward: 2200, monthly: 140, durationTicks: 480,
  },
  {
    id: 'streaming', level: 2, title: 'Streaming-Plattform', needs: ['server', 'switch', 'router', 'sfp'],
    text: 'Drei Server, deren Weg ins Internet über Glasfaser läuft.',
    requirements: { servers: 3, fiber: true }, reward: 3800, monthly: 260, durationTicks: 600,
  },
  {
    id: 'banking', level: 3, title: 'Ausfallsicheres Banking', needs: ['server', 'switch', 'router'],
    text: 'Zwei Server, jeder über zwei verschiedene Switches mit dem Internet verbunden.',
    requirements: { servers: 2, redundant: true }, reward: 5200, monthly: 380, durationTicks: 720,
  },
  {
    id: 'cluster', level: 3, title: 'Rechencluster', needs: ['server', 'storage', 'switch', 'router', 'sfp'],
    text: 'Sechs Server und zwei Storage-Systeme, alles über Glasfaser angebunden.',
    requirements: { servers: 6, storage: 2, fiber: true }, reward: 9000, monthly: 650, durationTicks: 900,
  },
];

// Welche Kategorien (und 'sfp' fuer Glasfaser-Ports) der Katalog anbietet.
export function catalogFeatures(catalog) {
  const set = new Set();
  for (const item of catalog) {
    set.add(item.category);
    if ((item.ports || []).some((p) => (p.kind ?? p.type) === 'sfp')) set.add('sfp');
  }
  return set;
}

export function availableTemplates(catalog, level) {
  const features = catalogFeatures(catalog);
  return ORDER_TEMPLATES.filter((t) => t.level <= level && t.needs.every((n) => features.has(n)));
}

export function playerLevel(orders) {
  const done = orders.filter((o) => o.status === 'done').length;
  return Math.min(3, 1 + Math.floor(done / 3));
}

export function createOrder(template, { id, tick, rand = Math.random }) {
  return {
    id,
    templateId: template.id,
    title: template.title,
    customer: CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)],
    text: template.text,
    status: 'open',
    reward: template.reward,
    monthly: template.monthly,
    requirements: { ...template.requirements },
    createdTick: tick,
    expiresTick: tick + OFFER_LIFETIME,
    durationTicks: template.durationTicks,
    deadlineTick: null,
    deviceIds: [],
  };
}

export function acceptOrder(order, tick) {
  if (order.status !== 'open') return false;
  order.status = 'active';
  order.deadlineTick = tick + order.durationTicks;
  return true;
}

// Geraete, die schon einem erledigten Auftrag gehoeren, zaehlen fuer neue Auftraege nicht.
export function reservedDevices(orders) {
  const ids = new Set();
  for (const o of orders) if (o.status === 'done') for (const id of o.deviceIds || []) ids.add(id);
  return ids;
}

function deviceMeets(ctx, id, req) {
  if (!isPowered(ctx, id)) return false;
  if (!findUplink(ctx, id, { requireFiber: !!req.fiber })) return false;
  if (req.redundant && redundantPaths(ctx, id, { requireFiber: !!req.fiber }) < 2) return false;
  return true;
}

const NEED_KEYS = [
  { key: 'servers', category: 'server', label: 'Server' },
  { key: 'storage', category: 'storage', label: 'Storage' },
];

// Prueft, ob ein Auftrag mit dem aktuellen Aufbau erfuellt waere.
// Ergebnis: { ok, checks: [{ label, need, have, ok, detail }], deviceIds }
export function evaluateOrder(ctx, order) {
  const req = order.requirements;
  const reserved = reservedDevices(ctx.state.orders);
  const free = Object.keys(ctx.state.devices).filter((id) => !reserved.has(id));
  const checks = [];
  const deviceIds = [];
  for (const { key, category, label } of NEED_KEYS) {
    const need = req[key] || 0;
    if (!need) continue;
    const candidates = free.filter((id) => deviceInfo(ctx, id)?.category === category);
    const good = candidates.filter((id) => deviceMeets(ctx, id, req));
    let detail = `${Math.min(good.length, need)} von ${need} bereit`;
    if (candidates.length < need) detail += `, nur ${candidates.length} freie eingebaut`;
    else if (good.length < need) detail += `, ${candidates.length - good.length} ohne ${missingHint(ctx, candidates.find((id) => !good.includes(id)), req)}`;
    checks.push({ label, need, have: good.length, ok: good.length >= need, detail });
    deviceIds.push(...good.slice(0, need));
  }
  return { ok: checks.length > 0 && checks.every((c) => c.ok), checks, deviceIds };
}

// Kurzer Hinweis, was einem Geraet noch fehlt.
function missingHint(ctx, id, req) {
  if (!id) return 'Anbindung';
  if (!isPowered(ctx, id)) return 'Strom';
  if (!findUplink(ctx, id)) return 'Internet';
  if (req.fiber && !findUplink(ctx, id, { requireFiber: true })) return 'Glasfaser-Weg';
  return 'zweiten Switch';
}

export function requirementSummary(req) {
  const parts = [];
  if (req.servers) parts.push(`${req.servers}x Server`);
  if (req.storage) parts.push(`${req.storage}x Storage`);
  if (req.fiber) parts.push('Glasfaser');
  if (req.redundant) parts.push('2 Switches je Gerät');
  return parts.join(' · ');
}

// Liefert den Auftrag ab. Nach der Frist gibt es nur die halbe Belohnung.
export function completeOrder(ctx, order, tick) {
  if (order.status !== 'active') return { ok: false, reason: 'Auftrag ist nicht aktiv.' };
  const result = evaluateOrder(ctx, order);
  if (!result.ok) return { ok: false, reason: 'Die Anforderungen sind noch nicht erfüllt.', result };
  const late = tick > order.deadlineTick;
  order.status = 'done';
  order.deviceIds = result.deviceIds;
  order.completedTick = tick;
  order.late = late;
  order.payout = late ? Math.round(order.reward / 2) : order.reward;
  return { ok: true, payout: order.payout, late };
}

// Ein erledigter Auftrag laeuft, solange alle seine Geraete noch die Anforderungen erfuellen.
export function isRunning(ctx, order) {
  return order.status === 'done'
    && order.deviceIds.every((id) => ctx.state.devices[id] && deviceMeets(ctx, id, order.requirements));
}

export function runningIncome(ctx) {
  return ctx.state.orders.filter((o) => isRunning(ctx, o)).reduce((sum, o) => sum + (o.monthly || 0), 0);
}

// Ein Tick: Angebote verfallen, aktive Auftraege scheitern nach doppelter Frist,
// neue Angebote kommen dazu, laufende Einnahmen werden faellig.
// Gibt zurueck, was passiert ist, damit der Aufrufer Events senden kann.
export function tickOrders(ctx, { tick, catalog, makeId, rand = Math.random }) {
  const orders = ctx.state.orders;
  const events = { created: [], failed: [], expired: [], income: 0 };

  for (const o of orders) {
    if (o.status === 'open' && tick >= o.expiresTick) events.expired.push(o);
    if (o.status === 'active' && tick > o.deadlineTick + o.durationTicks) {
      o.status = 'failed';
      events.failed.push(o);
    }
  }
  if (events.expired.length) {
    ctx.state.orders = orders.filter((o) => !events.expired.includes(o));
  }

  const open = ctx.state.orders.filter((o) => o.status === 'open').length;
  const due = open === 0 || tick % NEW_ORDER_EVERY === 0;
  if (open < BOARD_SIZE && due) {
    const pool = availableTemplates(catalog, playerLevel(ctx.state.orders));
    if (pool.length) {
      const t = pool[Math.floor(rand() * pool.length)];
      const order = createOrder(t, { id: makeId('order'), tick, rand });
      ctx.state.orders.push(order);
      events.created.push(order);
    }
  }

  if (tick > 0 && tick % INCOME_EVERY === 0) events.income = runningIncome(ctx);
  return events;
}
