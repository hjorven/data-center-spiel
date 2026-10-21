// Spiellogik: Game-Loop, HUD, Rack-Ansicht, Einbau von Geraeten.
// Owner: Thread "Spiellogik".
//
// Stellt die Regeln als game.logic bereit (siehe engine.js und README),
// damit andere Module sie nutzen koennen, ohne js/logic zu importieren.

import { getItem } from '../shop/catalog.js';
import { createLogic } from './engine.js';

const TICK_MS = 1000;
const AUTOSAVE_EVERY_TICKS = 10;

const REASON_TEXT = {
  'not-in-inventory': 'Nicht im Lager.',
  'not-mountable': 'Kann nicht ins Rack eingebaut werden.',
  'unknown-rack': 'Rack nicht gefunden.',
  'out-of-bounds': 'Passt dort nicht ins Rack.',
  occupied: 'Platz ist belegt.',
  'no-money': 'Nicht genug Geld.',
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function formatMoney(value) {
  return `${Math.floor(value).toLocaleString('de-DE')} $`;
}

export function mountLogic(roots, game) {
  const { rack: rackEl, hud: hudEl } = roots;
  const logic = createLogic(game, getItem);
  game.logic = logic;

  // Auswahl in der Rack-Ansicht: ein Lager-Eintrag (zum Einbauen) oder ein Geraet (zum Versetzen).
  let selection = null;
  let message = '';
  let timer = null;

  // ---- Game-Loop ----

  function step() {
    logic.tick();
    if (game.state.tick % AUTOSAVE_EVERY_TICKS === 0) game.save();
  }

  function start() {
    if (!timer) timer = setInterval(step, TICK_MS);
    renderHud();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    renderHud();
  }

  logic.start = start;
  logic.stop = stop;
  logic.isRunning = () => timer !== null;

  window.addEventListener('beforeunload', () => game.save());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') game.save();
  });

  // ---- HUD ----

  function renderHud() {
    const s = game.state;
    const cap = logic.capacity();
    const capText = ['cpu', 'ram', 'storage']
      .filter((k) => cap[k])
      .map((k) => `${k.toUpperCase()} ${cap[k]}`)
      .join(' / ');
    hudEl.innerHTML = `
      <span class="logic-hud-item ${s.money < 0 ? 'logic-negative' : ''}">Geld: <b>${formatMoney(s.money)}</b></span>
      <span class="logic-hud-item">Tick: ${s.tick}</span>
      <span class="logic-hud-item">Strom: ${logic.powerUsage()} W (${logic.powerCostPerTick().toFixed(2)} $/Tick)</span>
      ${capText ? `<span class="logic-hud-item">${escapeHtml(capText)}</span>` : ''}
      <button type="button" data-action="toggle">${timer ? 'Pause' : 'Weiter'}</button>
      <button type="button" data-action="reset">Neues Spiel</button>
    `;
  }

  hudEl.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'toggle') (timer ? stop : start)();
    if (action === 'reset' && confirm('Spielstand loeschen und neu anfangen?')) game.reset();
  });

  // ---- Rack-Ansicht ----

  function selectedType() {
    if (!selection) return null;
    if (selection.kind === 'inventory') {
      return game.state.inventory.find((e) => e.id === selection.id)?.type || null;
    }
    return game.state.devices[selection.id]?.type || null;
  }

  function validSlots(rackId) {
    const type = selectedType();
    if (!type) return new Set();
    if (selection.kind === 'inventory') return new Set(logic.freeSlots(type, rackId));
    const rack = game.state.racks.find((r) => r.id === rackId);
    const result = new Set();
    for (let s = 0; s < rack.units; s++) {
      if (logic.canPlace(type, rackId, s, selection.id).ok) result.add(s);
    }
    return result;
  }

  function renderInventory() {
    const entries = game.state.inventory.filter((e) => {
      const item = getItem(e.type);
      return item && (item.category === 'rack' || item.units > 0);
    });
    if (entries.length === 0) {
      return '<p class="logic-hint">Lager ist leer. Kaufe Geraete im Shop.</p>';
    }
    return `<ul class="logic-inventory">${entries
      .map((e) => {
        const item = getItem(e.type);
        const isRack = item.category === 'rack';
        const active = selection?.kind === 'inventory' && selection.id === e.id;
        return `<li>
          <span>${escapeHtml(item.name)} <small>${item.units} HE</small></span>
          ${isRack
            ? `<button type="button" data-action="place-rack" data-id="${escapeHtml(e.id)}">Aufstellen</button>`
            : `<button type="button" class="${active ? 'logic-active' : ''}" data-action="pick" data-id="${escapeHtml(e.id)}">${active ? 'Abbrechen' : 'Einbauen'}</button>`}
        </li>`;
      })
      .join('')}</ul>`;
  }

  function renderRack(rack, index) {
    const valid = validSlots(rack.id);
    const cells = [];
    for (let s = 0; s < rack.units; s++) {
      cells.push(`<div class="logic-unit-label" style="grid-row:${s + 1}">${rack.units - s}</div>`);
      if (rack.slots[s] === null) {
        const ok = valid.has(s);
        cells.push(`<button type="button" class="logic-slot ${ok ? 'logic-slot-valid' : ''}"
          style="grid-row:${s + 1}" data-action="slot" data-rack="${escapeHtml(rack.id)}" data-slot="${s}"
          ${ok ? '' : 'tabindex="-1"'} aria-label="Einheit ${rack.units - s}"></button>`);
      }
    }
    const devices = Object.values(game.state.devices).filter((d) => d.rackId === rack.id);
    for (const device of devices) {
      const item = getItem(device.type);
      const units = item?.units || 1;
      const active = selection?.kind === 'device' && selection.id === device.id;
      cells.push(`<button type="button"
        class="logic-device logic-device-${escapeHtml(item?.category || 'unknown')} ${active ? 'logic-active' : ''}"
        style="grid-row:${device.slot + 1} / span ${units}" data-action="device" data-id="${escapeHtml(device.id)}">
        ${escapeHtml(item?.name || device.type)}</button>`);
    }
    return `<figure class="logic-rack">
      <figcaption>Rack ${index + 1} <small>${rack.units} HE</small></figcaption>
      <div class="logic-rack-grid" style="grid-template-rows:repeat(${rack.units}, var(--logic-unit-h))">${cells.join('')}</div>
    </figure>`;
  }

  function renderSelectionBar() {
    if (selection?.kind !== 'device') return '';
    const device = game.state.devices[selection.id];
    if (!device) return '';
    const item = getItem(device.type);
    return `<div class="logic-selection">
      <span>${escapeHtml(item?.name || device.type)} ausgewaehlt. Freien Platz anklicken zum Versetzen.</span>
      <button type="button" data-action="remove" data-id="${escapeHtml(device.id)}">Ausbauen</button>
    </div>`;
  }

  function renderView() {
    rackEl.innerHTML = `
      <h2>Rack</h2>
      <section class="logic-section">
        <h3>Lager</h3>
        ${renderInventory()}
      </section>
      ${renderSelectionBar()}
      ${message ? `<p class="logic-message" role="status">${escapeHtml(message)}</p>` : ''}
      <div class="logic-racks">${game.state.racks.map(renderRack).join('')}</div>
      <div class="logic-buy">
        ${logic.rackOffers
          .map((o) => `<button type="button" data-action="buy-rack" data-units="${o.units}"
            ${game.state.money < o.price ? 'disabled' : ''}>Rack ${o.units} HE kaufen (${formatMoney(o.price)})</button>`)
          .join('')}
      </div>
    `;
  }

  function report(result) {
    message = result.ok ? '' : REASON_TEXT[result.reason] || 'Das geht nicht.';
  }

  rackEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id, rack } = button.dataset;
    message = '';

    if (action === 'pick') {
      const same = selection?.kind === 'inventory' && selection.id === id;
      selection = same ? null : { kind: 'inventory', id };
    } else if (action === 'device') {
      const same = selection?.kind === 'device' && selection.id === id;
      selection = same ? null : { kind: 'device', id };
    } else if (action === 'slot' && selection) {
      const slot = Number(button.dataset.slot);
      const result = selection.kind === 'inventory'
        ? logic.installDevice(selection.id, rack, slot)
        : logic.moveDevice(selection.id, rack, slot);
      report(result);
      if (result.ok) selection = null;
    } else if (action === 'remove') {
      report(logic.removeDevice(id));
      selection = null;
    } else if (action === 'buy-rack') {
      report(logic.buyRack(Number(button.dataset.units)));
    } else if (action === 'place-rack') {
      report(logic.installRack(id));
    }
    renderView();
    renderHud();
  });

  // ---- Events ----

  game.on('money:changed', () => {
    renderHud();
    renderView();
  });
  game.on('tick', renderHud);
  for (const name of ['shop:purchased', 'shop:sold', 'rack:deviceInstalled', 'rack:deviceRemoved', 'rack:deviceMoved', 'rack:added']) {
    game.on(name, () => {
      renderView();
      renderHud();
    });
  }
  game.on('game:reset', () => {
    selection = null;
    message = '';
    renderView();
    renderHud();
  });

  renderView();
  start();
}
