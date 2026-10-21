// Einstiegspunkt. Erzeugt das Spiel und haengt jedes Modul in seinen
// Container in index.html ein. Hier keine Spiellogik einbauen.

import { createGame } from './core/game.js';
import { mountLogic } from './logic/logic.js';
import { mountShop } from './shop/shop.js';
import { mountCabling } from './cabling/cabling.js';
import { mountOrders } from './orders/orders.js';

const game = createGame();
const $ = (id) => document.getElementById(id);

mountLogic({ rack: $('view-rack'), hud: $('hud') }, game);
mountShop($('view-shop'), game);
mountCabling($('view-cabling'), game);
mountOrders($('view-orders'), game);

game.emit('game:started', {});

// Zum Debuggen in der Browser-Konsole
window.game = game;
