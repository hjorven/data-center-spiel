// Verkabelung: Ports von eingebauten Geraeten verbinden.
// Owner: Thread "Verkabelung und Auftraege".
//
// Bedienung: Port anklicken und dann den Zielport anklicken, oder vom Port zum Ziel ziehen.
// Ein Klick auf ein Kabel oder einen belegten Port waehlt das Kabel aus, Entf entfernt es.
// Kabel werden aus dem Lager genommen; liegt keins passendes dort, wird es zum Katalogpreis gekauft.

import { CATALOG, getItem } from '../shop/catalog.js';
import {
  CABLE_NAMES, deviceInfo, cableAt, canConnect, sameRef, deviceStatus, portLabel,
} from './network.js';

const U_PX = 36;
const SVG_NS = 'http://www.w3.org/2000/svg';
const FALLBACK_CABLE_PRICE = { rj45: 5, sfp: 20, power: 3 };

export function createNetworkContext(game) {
  return {
    get state() { return game.state; },
    getItem,
    powerModeled: CATALOG.some((item) => item.category === 'pdu'),
  };
}

// Katalogeintrag fuer einen Kabeltyp. Ohne cableType-Feld raten wir am Namen.
export function cableItemFor(cableType) {
  return CATALOG.find((item) => item.category === 'cable' && cableTypeOfItem(item) === cableType) || null;
}

function cableTypeOfItem(item) {
  if (item.cableType) return item.cableType;
  const t = `${item.type} ${item.name}`.toLowerCase();
  if (/strom|power/.test(t)) return 'power';
  if (/sfp|fiber|faser|lwl|glas/.test(t)) return 'sfp';
  return 'rj45';
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [children].flat(Infinity)) if (c != null && c !== false) node.append(c);
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function mountCabling(rootEl, game) {
  const ctx = createNetworkContext(game);
  const ui = {
    pending: null,       // erster Port eines Kabels im Klick-Modus
    dragging: null,      // Port, von dem gerade gezogen wird
    pointer: null,       // Mausposition relativ zur Buehne
    selectedCable: null,
    message: '',
    messageKind: 'info',
  };

  rootEl.classList.add('cabling-root');
  const status = el('div', { class: 'cabling-status', 'aria-live': 'polite' });
  const stage = el('div', { class: 'cabling-stage' });
  const racksEl = el('div', { class: 'cabling-racks' });
  const svg = svgEl('svg', { class: 'cabling-svg', 'aria-hidden': 'true' });
  stage.append(racksEl, svg);
  rootEl.replaceChildren(el('h2', { text: 'Verkabelung' }), status, stage);

  function say(text, kind = 'info') {
    ui.message = text;
    ui.messageKind = kind;
    renderStatus();
  }

  // ---------- Kabel aus dem Lager nehmen und zurueckgeben ----------

  function takeCable(cableType) {
    const inv = game.state.inventory;
    const idx = inv.findIndex((entry) => {
      const item = getItem(entry.type);
      return item?.category === 'cable' && cableTypeOfItem(item) === cableType;
    });
    if (idx >= 0) {
      inv.splice(idx, 1);
      return { ok: true, source: 'Lager' };
    }
    const item = cableItemFor(cableType);
    const price = item?.price ?? FALLBACK_CABLE_PRICE[cableType] ?? 5;
    if (!game.spend(price, 'cable')) {
      return { ok: false, reason: `Kein ${CABLE_NAMES[cableType]} im Lager und zu wenig Geld (${price} $).` };
    }
    return { ok: true, source: `${price} $` };
  }

  function returnCable(cableType) {
    const item = cableItemFor(cableType);
    if (item) game.state.inventory.push({ id: game.makeId('inv'), type: item.type });
  }

  // ---------- Aktionen ----------

  function connect(a, b) {
    const check = canConnect(ctx, a, b);
    if (!check.ok) return say(check.reason, 'error');
    const taken = takeCable(check.cableType);
    if (!taken.ok) return say(taken.reason, 'error');
    const cable = {
      id: game.makeId('cable'),
      from: { deviceId: a.deviceId, port: a.port },
      to: { deviceId: b.deviceId, port: b.port },
      cableType: check.cableType,
    };
    game.state.cables.push(cable);
    game.emit('cable:connected', { cable });
    say(`${CABLE_NAMES[cable.cableType]} verlegt (${taken.source}).`);
  }

  function disconnect(cableId, { silent = false } = {}) {
    const cables = game.state.cables;
    const idx = cables.findIndex((c) => c.id === cableId);
    if (idx < 0) return;
    const [cable] = cables.splice(idx, 1);
    returnCable(cable.cableType);
    if (ui.selectedCable === cableId) ui.selectedCable = null;
    game.emit('cable:disconnected', { cableId });
    if (!silent) say(`${CABLE_NAMES[cable.cableType]} entfernt und ins Lager gelegt.`);
  }

  function cancel() {
    ui.pending = null;
    ui.dragging = null;
    ui.selectedCable = null;
    render();
  }

  // ---------- Rendering ----------

  function renderStatus() {
    const parts = [];
    if (ui.pending) {
      parts.push(el('span', { text: 'Zweiten Port anklicken. Esc bricht ab.' }),
        el('button', { type: 'button', text: 'Abbrechen', onclick: cancel }));
    } else if (ui.selectedCable) {
      const c = game.state.cables.find((x) => x.id === ui.selectedCable);
      if (c) {
        const a = deviceInfo(ctx, c.from.deviceId);
        const b = deviceInfo(ctx, c.to.deviceId);
        parts.push(
          el('span', { text: `${CABLE_NAMES[c.cableType]}: ${a?.name} ${c.from.port} zu ${b?.name} ${c.to.port}` }),
          el('button', { type: 'button', class: 'cabling-danger', text: 'Kabel entfernen', onclick: () => { disconnect(c.id); render(); } }),
          el('button', { type: 'button', text: 'Fertig', onclick: cancel }),
        );
      }
    }
    if (!parts.length) {
      const fallback = 'Port anklicken oder vom Port zum Ziel ziehen, um ein Kabel zu verlegen.';
      parts.push(el('span', { class: ui.messageKind === 'error' ? 'cabling-error' : 'cabling-muted', text: ui.message || fallback }));
    }
    status.replaceChildren(...parts);
  }

  function renderPort(info, port) {
    const ref = { deviceId: info.id, port: port.id };
    const used = !!cableAt(game.state, ref);
    const isPending = ui.pending && sameRef(ui.pending, ref);
    const from = ui.pending || ui.dragging;
    let hint = '';
    if (from && !sameRef(from, ref)) hint = canConnect(ctx, from, ref).ok ? ' cabling-port-ok' : ' cabling-port-no';
    return el('button', {
      type: 'button',
      class: `cabling-port cabling-port-${port.type}${used ? ' cabling-port-used' : ''}${isPending ? ' cabling-port-pending' : ''}${hint}`,
      title: `${port.id} (${portLabel(port.type)})${used ? ', belegt' : ''}`,
      'aria-label': `${info.name} Port ${port.id}, ${portLabel(port.type)}${used ? ', belegt' : ''}`,
      'data-device': info.id,
      'data-port': port.id,
      onpointerdown: (e) => onPortDown(e, ref),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPortActivate(ref); } },
    });
  }

  function renderDevice(info) {
    const st = deviceStatus(ctx, info.id);
    const led = st.online === null ? 'cabling-led-off' : st.online ? 'cabling-led-on' : st.powered ? 'cabling-led-warn' : 'cabling-led-off';
    const ledText = st.online === null ? 'Stromleiste' : st.online ? 'online' : st.powered ? 'kein Netz' : 'kein Strom';
    return el('div', {
      class: `cabling-device cabling-cat-${info.category}`,
      style: `top:${info.slot * U_PX}px;height:${info.units * U_PX - 3}px`,
    }, [
      el('div', { class: 'cabling-device-head' }, [
        el('span', { class: `cabling-led ${led}`, title: ledText }),
        el('span', { class: 'cabling-device-name', text: info.name }),
        el('span', { class: 'cabling-device-state', text: ledText }),
      ]),
      el('div', { class: 'cabling-ports' }, info.ports.map((p) => renderPort(info, p))),
    ]);
  }

  function renderRack(rack) {
    const units = rack.units ?? rack.heightU ?? rack.slots?.length ?? 12;
    const devices = Object.keys(game.state.devices)
      .map((id) => deviceInfo(ctx, id))
      .filter((d) => d && d.rackId === rack.id);
    const grid = [];
    for (let i = 0; i < units; i++) {
      grid.push(el('div', { class: 'cabling-unit', style: `top:${i * U_PX}px;height:${U_PX}px` },
        el('span', { class: 'cabling-unum', text: units - i })));
    }
    return el('section', { class: 'cabling-rack', 'aria-label': rack.name || rack.id }, [
      el('header', { class: 'cabling-rack-head', text: rack.name || rack.id }),
      el('div', { class: 'cabling-rack-body', style: `height:${units * U_PX}px` }, [...grid, ...devices.map(renderDevice)]),
    ]);
  }

  function renderRacks() {
    const racks = game.state.racks || [];
    const anyDevice = Object.keys(game.state.devices).length > 0;
    racksEl.replaceChildren(...racks.map(renderRack));
    if (!anyDevice) racksEl.append(el('p', { class: 'cabling-muted cabling-empty', text: 'Noch keine Geräte eingebaut. Kaufe Geräte im Shop und baue sie ins Rack ein.' }));
    requestAnimationFrame(drawCables);
  }

  function portCenter(ref) {
    const node = racksEl.querySelector(`[data-device="${CSS.escape(ref.deviceId)}"][data-port="${CSS.escape(ref.port)}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2 - s.left + stage.scrollLeft, y: r.top + r.height / 2 - s.top + stage.scrollTop };
  }

  // Kurze waagerechte Kabel haengen nach unten durch, senkrechte laufen seitlich wie im Kabelkanal.
  function cablePath(p, q) {
    const dx = Math.abs(p.x - q.x);
    const dy = Math.abs(p.y - q.y);
    if (dy > dx) {
      const side = Math.min(120, 24 + dy * 0.12);
      const x = Math.max(p.x, q.x) + side;
      return `M${p.x},${p.y} C${x},${p.y} ${x},${q.y} ${q.x},${q.y}`;
    }
    const sag = Math.min(90, 18 + dx * 0.2);
    return `M${p.x},${p.y} C${p.x},${p.y + sag} ${q.x},${q.y + sag} ${q.x},${q.y}`;
  }

  function drawCables() {
    svg.setAttribute('width', stage.scrollWidth);
    svg.setAttribute('height', stage.scrollHeight);
    const nodes = [];
    for (const c of game.state.cables) {
      const p = portCenter(c.from);
      const q = portCenter(c.to);
      if (!p || !q) continue;
      const d = cablePath(p, q);
      const selected = ui.selectedCable === c.id;
      nodes.push(svgEl('path', { d, class: `cabling-cable cabling-cable-${c.cableType}${selected ? ' cabling-cable-selected' : ''}` }));
      const hit = svgEl('path', { d, class: 'cabling-cable-hit' });
      hit.addEventListener('click', () => { ui.selectedCable = c.id; ui.pending = null; render(); });
      nodes.push(hit);
    }
    const from = ui.dragging || ui.pending;
    if (from && ui.pointer) {
      const p = portCenter(from);
      if (p) nodes.push(svgEl('path', { d: cablePath(p, ui.pointer), class: 'cabling-cable cabling-cable-draft' }));
    }
    svg.replaceChildren(...nodes);
  }

  function render() {
    if (!Array.isArray(game.state.cables)) game.state.cables = [];
    if (ui.selectedCable && !game.state.cables.some((c) => c.id === ui.selectedCable)) ui.selectedCable = null;
    renderStatus();
    renderRacks();
  }

  // ---------- Eingabe ----------

  // Gemeinsamer Weg fuer Klick und Tastatur.
  function onPortActivate(ref) {
    if (ui.pending) {
      const a = ui.pending;
      ui.pending = null;
      if (!sameRef(a, ref)) connect(a, ref);
      render();
      return;
    }
    const existing = cableAt(game.state, ref);
    if (existing) {
      ui.selectedCable = existing.id;
    } else {
      ui.pending = ref;
      ui.selectedCable = null;
    }
    render();
  }

  function onPortDown(e, ref) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    if (ui.pending || cableAt(game.state, ref)) return onPortActivate(ref);
    ui.dragging = ref;
    ui.selectedCable = null;
    updatePointer(e);
    render();
  }

  function updatePointer(e) {
    const s = stage.getBoundingClientRect();
    ui.pointer = { x: e.clientX - s.left + stage.scrollLeft, y: e.clientY - s.top + stage.scrollTop };
  }

  function onPointerMove(e) {
    if (!ui.dragging && !ui.pending) return;
    updatePointer(e);
    drawCables();
  }

  function onPointerUp(e) {
    if (!ui.dragging) return;
    const a = ui.dragging;
    ui.dragging = null;
    const target = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains('cabling-port'));
    const b = target ? { deviceId: target.dataset.device, port: target.dataset.port } : null;
    if (b && !sameRef(a, b)) connect(a, b);
    else ui.pending = a; // Losgelassen ohne Ziel: Klick-Modus, der naechste Port schliesst ab.
    render();
  }

  function onKey(e) {
    if (e.key === 'Escape' && (ui.pending || ui.selectedCable)) cancel();
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedCable && !e.target.closest?.('input, textarea')) {
      disconnect(ui.selectedCable);
      render();
    }
  }

  // Beim Ausbau eines Geraets haengen seine Kabel in der Luft. Wir nehmen sie heraus.
  function onDeviceRemoved({ deviceId }) {
    const loose = game.state.cables.filter((c) => c.from.deviceId === deviceId || c.to.deviceId === deviceId);
    for (const c of loose) disconnect(c.id, { silent: true });
    if (ui.pending?.deviceId === deviceId) ui.pending = null;
    if (loose.length) say(`${loose.length} Kabel vom ausgebauten Gerät zurück ins Lager gelegt.`);
    render();
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', drawCables);
  stage.addEventListener('scroll', drawCables);
  game.on('rack:deviceInstalled', render);
  game.on('rack:deviceMoved', render);
  game.on('rack:added', render);
  game.on('rack:deviceRemoved', onDeviceRemoved);
  game.on('game:loaded', render);
  game.on('game:reset', () => { cancel(); ui.message = ''; render(); });

  render();
  return { render };
}
