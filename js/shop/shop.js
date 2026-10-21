// Shop: Katalog anzeigen, Geraete und Kabel kaufen, Inventar verkaufen.
// Owner: Thread "Shop".
//
// Kauf:    { id, type } wird an game.state.inventory angehaengt,
//          Event shop:purchased { item, inventoryId }.
// Verkauf: Eintrag wird aus game.state.inventory entfernt, Erstattung per
//          game.earn, Event shop:sold { item, inventoryId, refund }.
//
// game.state wird immer frisch gelesen, weil der Stand neu geladen werden kann.

import { CATALOG, CATEGORIES, getItem, sellPrice, specLabels } from './catalog.js';

const money = (n) => `${Math.floor(n).toLocaleString('de-DE')} $`;

export function buyItem(game, type, qty = 1) {
  const item = getItem(type);
  if (!item || qty < 1) return { ok: false, reason: 'Unbekannter Artikel' };
  const total = item.price * qty;
  if (!game.spend(total, `shop:${type}`)) return { ok: false, reason: 'Nicht genug Geld' };
  for (let i = 0; i < qty; i++) {
    const inventoryId = game.makeId('inv');
    game.state.inventory.push({ id: inventoryId, type });
    game.emit('shop:purchased', { item, inventoryId });
  }
  return { ok: true, total };
}

export function sellItem(game, type) {
  const item = getItem(type);
  const inv = game.state.inventory;
  const index = inv.findLastIndex((entry) => entry.type === type);
  if (!item || index < 0) return { ok: false, reason: 'Nicht im Inventar' };
  const [entry] = inv.splice(index, 1);
  const refund = sellPrice(item);
  game.earn(refund, `shop:sell:${type}`);
  game.emit('shop:sold', { item, inventoryId: entry.id, refund });
  return { ok: true, total: refund };
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Events, nach denen sich Geld oder Inventar geaendert haben koennen.
const REFRESH_EVENTS = [
  'game:started', 'game:reset', 'money:changed', 'shop:purchased', 'shop:sold',
  'rack:deviceInstalled', 'rack:deviceRemoved', 'cable:connected', 'cable:disconnected',
];

export function mountShop(rootEl, game) {
  let category = CATEGORIES[0].id;
  let toastTimer = null;
  let lastSignature = '';

  rootEl.classList.add('shop');

  const balance = el('span', { class: 'shop-balance' });
  const tabs = el('div', { class: 'shop-tabs', role: 'tablist', 'aria-label': 'Kategorien' });
  const list = el('ul', { class: 'shop-list' });
  const invCount = el('span', { class: 'shop-inv-total' });
  const inventory = el('div', { class: 'shop-inventory' });
  const toast = el('div', { class: 'shop-toast', role: 'status', 'aria-live': 'polite' });

  rootEl.replaceChildren(
    el('div', { class: 'shop-header' }, el('h2', {}, 'Shop'), balance),
    tabs,
    list,
    el('details', { class: 'shop-inv', open: true },
      el('summary', {}, 'Inventar ', invCount),
      inventory,
    ),
    toast,
  );

  function notify(text, isError) {
    toast.textContent = text;
    toast.className = `shop-toast is-visible${isError ? ' is-error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'shop-toast'; }, 2000);
  }

  function buy(item, qty) {
    const res = buyItem(game, item.type, qty);
    notify(res.ok ? `${qty}x ${item.name} gekauft` : res.reason, !res.ok);
  }

  function ownedCount(type) {
    return game.state.inventory.filter((entry) => entry.type === type).length;
  }

  function renderTabs() {
    tabs.replaceChildren(...CATEGORIES.map((c) => el('button', {
      class: `shop-tab${c.id === category ? ' is-active' : ''}`,
      role: 'tab',
      'aria-selected': String(c.id === category),
      onclick: () => { category = c.id; render(); },
    }, c.name)));
  }

  function renderList() {
    const funds = game.state.money;
    const items = CATALOG.filter((item) => item.category === category);
    const isCable = category === 'cable';
    list.replaceChildren(...items.map((item) => {
      const owned = ownedCount(item.type);
      const buttons = (isCable ? [1, 10] : [1]).map((qty) => el('button', {
        class: 'shop-buy',
        disabled: item.price * qty > funds,
        title: item.price * qty > funds ? 'Nicht genug Geld' : `${money(item.price * qty)}`,
        onclick: () => buy(item, qty),
      }, isCable ? `+${qty}` : 'Kaufen'));
      return el('li', { class: `shop-item cat-${item.category}` },
        el('div', { class: 'shop-item-main' },
          el('div', { class: 'shop-item-title' },
            el('span', { class: 'shop-item-name' }, item.name),
            owned ? el('span', { class: 'shop-owned', title: 'Im Inventar' }, `${owned}x`) : null,
          ),
          el('p', { class: 'shop-desc' }, item.description),
          el('ul', { class: 'shop-specs' }, specLabels(item).map((s) => el('li', {}, s))),
        ),
        el('div', { class: 'shop-item-buy' },
          el('span', { class: 'shop-price' }, money(item.price)),
          el('div', { class: 'shop-buy-row' }, buttons),
        ),
      );
    }));
  }

  function renderInventory() {
    const counts = new Map();
    for (const entry of game.state.inventory) {
      counts.set(entry.type, (counts.get(entry.type) || 0) + 1);
    }
    invCount.textContent = `(${game.state.inventory.length})`;
    if (!counts.size) {
      inventory.replaceChildren(el('p', { class: 'shop-empty' }, 'Noch nichts auf Lager.'));
      return;
    }
    inventory.replaceChildren(el('ul', { class: 'shop-inv-list' },
      [...counts].map(([type, count]) => {
        const item = getItem(type);
        return el('li', { class: `shop-inv-item cat-${item?.category || 'other'}` },
          el('span', { class: 'shop-inv-name' }, item?.name || type),
          el('span', { class: 'shop-inv-count' }, `${count}x`),
          item ? el('button', {
            class: 'shop-sell',
            title: `Ein Stueck fuer ${money(sellPrice(item))} verkaufen`,
            onclick: () => {
              const res = sellItem(game, type);
              notify(res.ok ? `${item.name} verkauft (+${money(res.total)})` : res.reason, !res.ok);
            },
          }, `Verkaufen ${money(sellPrice(item))}`) : null,
        );
      })));
  }

  function signature() {
    return `${game.state.money}|${game.state.inventory.map((e) => e.id).join(',')}`;
  }

  function render() {
    lastSignature = signature();
    balance.textContent = money(game.state.money);
    renderTabs();
    renderList();
    renderInventory();
  }

  const offs = REFRESH_EVENTS.map((name) => game.on(name, render));
  // Fallback fuer Aenderungen ohne Event (z.B. Laden eines Spielstands).
  offs.push(game.on('tick', () => { if (signature() !== lastSignature) render(); }));

  render();
  return () => { offs.forEach((off) => off()); clearTimeout(toastTimer); rootEl.replaceChildren(); };
}
