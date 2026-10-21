// Netzwerklogik ohne DOM: Ports, Kabel, Strom und Internet-Anbindung.
// Wird von js/cabling (Verkabelung) und js/orders (Auftragspruefung) genutzt,
// beide Module gehoeren demselben Thread.
//
// ctx = { state, getItem, powerModeled }
//   state        game.state
//   getItem      getItem aus js/shop/catalog.js
//   powerModeled true, wenn der Katalog eine Stromleiste (category 'pdu') hat.
//                Sonst gilt jedes Geraet als mit Strom versorgt.

export const CABLE_NAMES = {
  rj45: 'Kupferkabel (RJ45)',
  sfp: 'Glasfaser (SFP)',
  power: 'Stromkabel',
};

// Geraete, die Netzwerkverkehr weiterleiten. Server und Storage tun das nie.
const FORWARDING = new Set(['switch', 'patchpanel', 'router']);

export function deviceInfo(ctx, deviceId) {
  const device = ctx.state.devices[deviceId];
  if (!device) return null;
  const item = ctx.getItem(device.type ?? device.typeId) || {};
  const ports = (device.ports ?? item.ports ?? []).map((p, i) => ({
    id: p.name ?? p.id ?? String(i),
    type: p.kind ?? p.type,
  }));
  return {
    id: deviceId,
    name: item.name ?? device.type ?? deviceId,
    category: item.category ?? device.category ?? 'unknown',
    rackId: device.rackId,
    slot: device.slot ?? device.u ?? 0,
    units: item.units ?? 1,
    ports,
  };
}

export function findPort(ctx, ref) {
  const info = deviceInfo(ctx, ref.deviceId);
  return info ? info.ports.find((p) => p.id === ref.port) || null : null;
}

export function sameRef(a, b) {
  return a.deviceId === b.deviceId && a.port === b.port;
}

export function cableAt(state, ref) {
  return state.cables.find((c) => sameRef(c.from, ref) || sameRef(c.to, ref)) || null;
}

export function cableTypeFor(portType) {
  return portType === 'power' || portType === 'power-out' ? 'power' : portType;
}

// Strom: 'power-out' (Stromleiste) passt nur zu 'power' (Netzteil eines Geraets).
function compatible(a, b) {
  if (a === 'power-out') return b === 'power';
  if (b === 'power-out') return a === 'power';
  if (a === 'power' || b === 'power') return false;
  return a === b;
}

// Gibt { ok: true, cableType } oder { ok: false, reason } zurueck.
export function canConnect(ctx, a, b) {
  if (a.deviceId === b.deviceId) return { ok: false, reason: 'Ein Gerät kann nicht mit sich selbst verbunden werden.' };
  const pa = findPort(ctx, a);
  const pb = findPort(ctx, b);
  if (!pa || !pb) return { ok: false, reason: 'Port nicht gefunden.' };
  if (cableAt(ctx.state, a) || cableAt(ctx.state, b)) return { ok: false, reason: 'Einer der Ports ist schon belegt.' };
  if (!compatible(pa.type, pb.type)) {
    return { ok: false, reason: `${portLabel(pa.type)} passt nicht zu ${portLabel(pb.type)}.` };
  }
  return { ok: true, cableType: cableTypeFor(pa.type) };
}

export function portLabel(type) {
  return { rj45: 'RJ45', sfp: 'SFP', power: 'Netzteil', 'power-out': 'Steckdose' }[type] ?? type;
}

export function neighbours(state, deviceId, cableType) {
  const result = [];
  for (const c of state.cables) {
    if (cableType && c.cableType !== cableType) continue;
    if (c.from.deviceId === deviceId) result.push({ deviceId: c.to.deviceId, cable: c });
    else if (c.to.deviceId === deviceId) result.push({ deviceId: c.from.deviceId, cable: c });
  }
  return result;
}

function categoryOf(ctx, deviceId) {
  return deviceInfo(ctx, deviceId)?.category ?? null;
}

export function isPowered(ctx, deviceId) {
  if (!ctx.powerModeled) return true;
  const info = deviceInfo(ctx, deviceId);
  if (!info) return false;
  if (info.category === 'pdu') return true;
  if (!info.ports.some((p) => p.type === 'power')) return true;
  return neighbours(ctx.state, deviceId, 'power').some((n) => categoryOf(ctx, n.deviceId) === 'pdu');
}

// Breitensuche vom Geraet zu einem Router (gilt als Internet).
// options.requireFiber: auf dem Weg muss mindestens ein Glasfaserkabel liegen.
// options.via: der erste Hop muss dieses Geraet sein.
export function findUplink(ctx, startId, options = {}) {
  const queue = [{ id: startId, fiber: false, first: null }];
  const seen = new Set([`${startId}|false`]);
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighbours(ctx.state, cur.id)) {
      if (n.cable.cableType === 'power') continue;
      const first = cur.first ?? n.deviceId;
      if (options.via && first !== options.via) continue;
      if (!isPowered(ctx, n.deviceId)) continue;
      const fiber = cur.fiber || n.cable.cableType === 'sfp';
      const category = categoryOf(ctx, n.deviceId);
      if (category === 'router' && (!options.requireFiber || fiber)) return { routerId: n.deviceId, fiber };
      if (!FORWARDING.has(category)) continue;
      const key = `${n.deviceId}|${fiber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ id: n.deviceId, fiber, first });
    }
  }
  return null;
}

// Anzahl verschiedener direkt angeschlossener Switches, ueber die das Geraet den Router erreicht.
export function redundantPaths(ctx, deviceId, options = {}) {
  const hops = new Set(
    neighbours(ctx.state, deviceId)
      .filter((n) => n.cable.cableType !== 'power' && categoryOf(ctx, n.deviceId) === 'switch')
      .map((n) => n.deviceId),
  );
  let count = 0;
  for (const via of hops) if (findUplink(ctx, deviceId, { ...options, via })) count++;
  return count;
}

export function deviceStatus(ctx, deviceId) {
  const powered = isPowered(ctx, deviceId);
  const category = categoryOf(ctx, deviceId);
  if (category === 'router') return { powered, online: powered };
  if (category === 'pdu') return { powered: true, online: null };
  return { powered, online: powered && !!findUplink(ctx, deviceId) };
}
