// Auftraege: Kundenauftraege erzeugen, pruefen und belohnen.
// Owner: Thread "Verkabelung und Auftraege".
//
// Ablauf: Angebote erscheinen auf der Auftragsboerse, der Spieler nimmt eines an,
// baut und verkabelt die geforderten Geraete und liefert ab. Erledigte Auftraege
// bringen laufende Einnahmen, solange ihre Geraete online bleiben.

import { CATALOG, getItem } from '../shop/catalog.js';
import {
  evaluateOrder, acceptOrder, completeOrder, tickOrders, isRunning, runningIncome,
  requirementSummary, INCOME_EVERY,
} from './orderLogic.js';

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

function formatTicks(ticks) {
  const t = Math.max(0, ticks);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function mountOrders(rootEl, game) {
  const ctx = {
    get state() { return game.state; },
    getItem,
    powerModeled: CATALOG.some((item) => item.category === 'pdu'),
  };
  let message = null;

  rootEl.classList.add('orders-root');

  const tick = () => game.state.tick || 0;

  function ensureState() {
    if (!Array.isArray(game.state.orders)) game.state.orders = [];
  }

  function flash(text, kind = 'info') {
    message = { text, kind };
    render();
  }

  // ---------- Aktionen ----------

  function accept(order) {
    if (!acceptOrder(order, tick())) return;
    game.emit('order:accepted', { order });
    flash(`Auftrag angenommen: ${order.title} für ${order.customer}.`);
  }

  function decline(order) {
    game.state.orders = game.state.orders.filter((o) => o !== order);
    render();
  }

  function deliver(order) {
    const result = completeOrder(ctx, order, tick());
    if (!result.ok) return flash(result.reason, 'error');
    game.earn(result.payout, 'order');
    game.emit('order:completed', { order });
    flash(result.late
      ? `${order.customer} zahlt wegen Verspätung nur ${result.payout} $.`
      : `${order.customer} zahlt ${result.payout} $. Laufend kommen ${order.monthly} $ pro Minute dazu.`, 'success');
  }

  // ---------- Rendering ----------

  function activeTimer(order) {
    const left = order.deadlineTick - tick();
    return left < 0 ? `verspätet, ${formatTicks(left + order.durationTicks)} bis Abbruch` : formatTicks(left);
  }

  function offerTimer(order) {
    return formatTicks(order.expiresTick - tick());
  }

  // Jede Sekunde nur die Zeiten aktualisieren, damit Buttons nicht unter dem Mauszeiger neu entstehen.
  function updateTimers() {
    for (const node of rootEl.querySelectorAll('.orders-timer[data-order]')) {
      const order = game.state.orders.find((o) => o.id === node.dataset.order);
      if (order) node.textContent = order.status === 'active' ? activeTimer(order) : offerTimer(order);
    }
  }

  function renderChecks(order) {
    const result = evaluateOrder(ctx, order);
    return {
      ok: result.ok,
      node: el('ul', { class: 'orders-checks' }, result.checks.map((c) => el('li', {
        class: c.ok ? 'orders-check-ok' : 'orders-check-open',
      }, [
        el('span', { class: 'orders-check-mark', 'aria-hidden': 'true', text: c.ok ? '✓' : '○' }),
        el('span', { text: `${c.label}: ${c.detail}` }),
      ]))),
    };
  }

  function renderActive(order) {
    const left = order.deadlineTick - tick();
    const late = left < 0;
    const { ok, node } = renderChecks(order);
    return el('article', { class: `orders-card orders-active${late ? ' orders-late' : ''}` }, [
      el('header', { class: 'orders-card-head' }, [
        el('strong', { text: order.title }),
        el('span', { class: 'orders-timer', 'data-order': order.id, text: activeTimer(order) }),
      ]),
      el('p', { class: 'orders-customer', text: `${order.customer}: ${order.text}` }),
      node,
      el('footer', { class: 'orders-card-foot' }, [
        el('span', { class: 'orders-reward', text: `${late ? Math.round(order.reward / 2) : order.reward} $ + ${order.monthly} $/Min` }),
        el('button', { type: 'button', class: 'orders-primary', disabled: !ok, onclick: () => deliver(order), text: 'Abliefern' }),
      ]),
    ]);
  }

  function renderOffer(order) {
    return el('article', { class: 'orders-card orders-offer' }, [
      el('header', { class: 'orders-card-head' }, [
        el('strong', { text: order.title }),
        el('span', { class: 'orders-timer', 'data-order': order.id, title: 'Angebot läuft ab in', text: offerTimer(order) }),
      ]),
      el('p', { class: 'orders-customer', text: `${order.customer}: ${order.text}` }),
      el('p', { class: 'orders-req', text: `${requirementSummary(order.requirements)} · Zeit ${formatTicks(order.durationTicks)}` }),
      el('footer', { class: 'orders-card-foot' }, [
        el('span', { class: 'orders-reward', text: `${order.reward} $ + ${order.monthly} $/Min` }),
        el('span', { class: 'orders-actions' }, [
          el('button', { type: 'button', onclick: () => decline(order), text: 'Ablehnen' }),
          el('button', { type: 'button', class: 'orders-primary', onclick: () => accept(order), text: 'Annehmen' }),
        ]),
      ]),
    ]);
  }

  function renderDone(order) {
    const running = isRunning(ctx, order);
    return el('li', { class: running ? 'orders-running' : 'orders-broken' }, [
      el('span', { text: `${order.title} (${order.customer})` }),
      el('span', { class: 'orders-done-state', text: running ? `${order.monthly} $/Min` : 'gestört' }),
    ]);
  }

  function section(title, items, emptyText) {
    return el('section', { class: 'orders-section' }, [
      el('h3', { text: title }),
      items.length ? items : el('p', { class: 'orders-muted', text: emptyText }),
    ]);
  }

  function render() {
    ensureState();
    const orders = game.state.orders;
    const active = orders.filter((o) => o.status === 'active');
    const open = orders.filter((o) => o.status === 'open');
    const done = orders.filter((o) => o.status === 'done');
    const failed = orders.filter((o) => o.status === 'failed').length;
    const income = runningIncome(ctx);
    const hasRouter = CATALOG.some((i) => i.category === 'router');

    rootEl.replaceChildren(...[
      el('h2', { text: 'Aufträge' }),
      message ? el('p', { class: `orders-message orders-message-${message.kind}`, role: 'status', text: message.text }) : null,
      section('Aktiv', active.map(renderActive), 'Kein aktiver Auftrag. Nimm unten ein Angebot an.'),
      section('Angebote', open.map(renderOffer), hasRouter ? 'Gleich kommen neue Anfragen.' : 'Ohne Router im Shop sind keine Aufträge möglich.'),
      done.length ? el('section', { class: 'orders-section' }, [
        el('h3', { text: `Kunden · ${income} $/Min${failed ? ` · ${failed} gescheitert` : ''}` }),
        el('ul', { class: 'orders-done' }, done.map(renderDone)),
      ]) : null,
    ].filter(Boolean));
  }

  // ---------- Spielzeit ----------

  function onTick({ tick: t }) {
    ensureState();
    const events = tickOrders(ctx, { tick: t, catalog: CATALOG, makeId: game.makeId });
    for (const order of events.created) game.emit('order:created', { order });
    for (const order of events.failed) {
      game.emit('order:failed', { order });
      message = { text: `${order.customer} hat den Auftrag ${order.title} abgebrochen.`, kind: 'error' };
    }
    if (events.income > 0) game.earn(events.income, 'order');
    const justLate = game.state.orders.some((o) => o.status === 'active' && o.deadlineTick === t - 1);
    const changed = events.created.length || events.failed.length || events.expired.length || events.income > 0 || justLate;
    if (changed) render();
    else updateTimers();
  }

  game.on('tick', onTick);
  for (const name of ['cable:connected', 'cable:disconnected', 'rack:deviceInstalled', 'rack:deviceRemoved', 'rack:deviceMoved', 'game:loaded', 'game:reset']) {
    game.on(name, () => render());
  }

  ensureState();
  render();
  return { render, incomeEvery: INCOME_EVERY };
}
