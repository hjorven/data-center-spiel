# Data Center Spiel

Browser-Spiel: Geraete im Shop kaufen, ins Rack einbauen, verkabeln und Kundenauftraege erledigen.
Reines HTML/CSS/JS mit ES-Modulen, kein Build-Schritt. Gehostet ueber GitHub Pages.

## Lokal starten

ES-Module brauchen einen Webserver (nicht per `file://` oeffnen):

```bash
python3 -m http.server 8000
```

Dann `http://localhost:8000` oeffnen. Der Spielzustand ist in der Konsole als `window.game` erreichbar.

## Deployment

Jeder Push auf `main` deployt automatisch ueber `.github/workflows/pages.yml`.
Einmalig in den Repo-Einstellungen: **Settings > Pages > Source: GitHub Actions**.

## Ordnerstruktur

```
index.html            Layout mit einem Container pro Modul
css/main.css          Globale Variablen und Layout
css/<modul>.css       Styles je Modul, Klassen mit Praefix .<modul>-
js/main.js            Einstieg, haengt die Module ein
js/core/              Gemeinsamer Vertrag: State, Event-Bus, game-Objekt
js/logic/             Spiellogik: Game-Loop, HUD, Rack, Einbau
js/shop/              Shop und Katalog
js/cabling/           Verkabelung
js/orders/            Auftraege
```

## Modulgrenzen

| Bereich | Dateien | Container | Einstieg | Owner |
|---|---|---|---|---|
| Spiellogik | `js/logic/`, `css/logic.css` | `#view-rack`, `#hud` | `mountLogic({ rack, hud }, game)` | Thread Spiellogik |
| Shop | `js/shop/`, `css/shop.css` | `#view-shop` | `mountShop(rootEl, game)` | Thread Shop |
| Verkabelung | `js/cabling/`, `css/cabling.css` | `#view-cabling` | `mountCabling(rootEl, game)` | Thread Verkabelung und Auftraege |
| Auftraege | `js/orders/`, `css/orders.css` | `#view-orders` | `mountOrders(rootEl, game)` | Thread Verkabelung und Auftraege |
| Kern | `js/core/`, `js/main.js`, `index.html`, `css/main.css` | - | - | gemeinsam, nur abgestimmt aendern |

Regeln:

1. Jedes Modul aendert nur seine eigenen Dateien.
2. Module importieren sich nicht gegenseitig. Ausnahme: `js/shop/catalog.js` darf von allen gelesen werden.
3. Kommunikation laeuft ueber `game.state` und Events (`game.on`, `game.emit`).
4. Aenderungen am Kern (`js/core/`, `state`-Form, neue Events) im README dokumentieren und kurz absprechen.
5. Neue Felder im State nur hinzufuegen, nicht umbenennen oder entfernen.

## Das game-Objekt

```js
game.state        // Spielzustand, siehe js/core/state.js
game.on(name, fn) // Event abonnieren, gibt eine Abmelde-Funktion zurueck
game.emit(name, payload)
game.spend(amount, reason) // false, wenn zu wenig Geld
game.earn(amount, reason)
game.makeId(prefix)
game.save()       // Spielstand in localStorage sichern (logic macht Autosave alle 10 Ticks)
game.reset()      // Neues Spiel: Speicher loeschen, State zuruecksetzen, sendet game:reset
```

`createGame()` laedt einen vorhandenen Spielstand aus dem localStorage (`js/core/save.js`),
bevor die Module eingehaengt werden. `game.state` bleibt dabei dasselbe Objekt, Module sollen
den State aber immer frisch lesen und keine Teile davon dauerhaft zwischenspeichern.

### game.logic (von js/logic bereitgestellt)

Regeln fuer Racks und Geraete, damit andere Module sie nutzen koennen, ohne `js/logic` zu importieren.
Rueckgabe der Aktionen: `{ ok: true, ... }` oder `{ ok: false, reason }`.

```js
game.logic.installDevice(inventoryId, rackId, slot) // Inventar-ID wird zur deviceId
game.logic.removeDevice(deviceId)                   // zurueck ins Inventar, Kabel raeumt cabling auf
game.logic.moveDevice(deviceId, rackId, slot)
game.logic.canPlace(type, rackId, slot)
game.logic.freeSlots(type, rackId)                  // alle passenden Start-Slots
game.logic.buyRack(units)                           // units aus game.logic.rackOffers (24, 42)
game.logic.powerUsage()                             // Watt aller eingebauten Geraete
game.logic.powerCostPerTick()
game.logic.capacity()                               // Summe aus Katalog capacity, z.B. { cpu, ram, storage }
game.logic.start() / stop() / isRunning()           // Game-Loop, 1 Tick pro Sekunde
```

Slots: `racks[i].slots[s]` ist `null` oder eine deviceId, Index 0 ist oben im Rack.
Ein Geraet mit `units = n` belegt `slots[slot]` bis `slots[slot + n - 1]`.
Strom kostet pro Tick `Watt / 1000 * 0.5 $` und wird in ganzen Dollar abgezogen (Schulden moeglich).

## Events

| Event | Payload | Wer sendet |
|---|---|---|
| `game:started` | `{}` | main.js |
| `tick` | `{ tick }` | logic |
| `money:changed` | `{ money, delta, reason }` | core (spend/earn) |
| `shop:purchased` | `{ item, inventoryId }` | shop |
| `rack:deviceInstalled` | `{ deviceId, rackId, slot }` | logic |
| `rack:deviceRemoved` | `{ deviceId }` | logic |
| `rack:deviceMoved` | `{ deviceId, rackId, slot }` | logic |
| `rack:added` | `{ rackId }` | logic |
| `game:saved` | `{}` | core (save) |
| `game:reset` | `{}` | core (reset), danach neu rendern |
| `cable:connected` | `{ cable }` | cabling |
| `cable:disconnected` | `{ cableId }` | cabling |
| `order:created` | `{ order }` | orders |
| `order:completed` | `{ order }` | orders |
| `order:failed` | `{ order }` | orders |

Neue Events hier eintragen, bevor sie verwendet werden.

## Tests

```bash
npm test
```

Laeuft mit dem eingebauten Test-Runner von Node (ab Version 20), ohne Abhaengigkeiten.

## Arbeitsweise

Jeder Bereich arbeitet auf einem eigenen Branch (`feature/logic`, `feature/shop`, `feature/cabling-orders`) und oeffnet einen Pull Request gegen `main`.
