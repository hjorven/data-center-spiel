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
```

## Events

| Event | Payload | Wer sendet |
|---|---|---|
| `game:started` | `{}` | main.js |
| `tick` | `{ tick }` | logic |
| `money:changed` | `{ money, delta, reason }` | core (spend/earn) |
| `shop:purchased` | `{ item, inventoryId }` | shop |
| `rack:deviceInstalled` | `{ deviceId, rackId, slot }` | logic |
| `rack:deviceRemoved` | `{ deviceId }` | logic |
| `cable:connected` | `{ cable }` | cabling |
| `cable:disconnected` | `{ cableId }` | cabling |
| `order:created` | `{ order }` | orders |
| `order:accepted` | `{ order }` | orders |
| `order:completed` | `{ order }` | orders |
| `order:failed` | `{ order }` | orders |

Neue Events hier eintragen, bevor sie verwendet werden.

## Verkabelung und Auftraege

- `js/cabling/network.js` ist die gemeinsame Netzwerklogik (Ports, Strom, Weg zum Router). `js/orders` importiert sie, beide Module gehoeren demselben Thread.
- Ein Kabel verbindet zwei freie Ports gleichen Typs (`rj45`, `sfp`) oder ein Netzteil (`power`) mit einer Steckdose (`power-out`) einer PDU.
- Beim Verbinden nimmt die Verkabelung ein passendes Kabel (`category: 'cable'`, Feld `cableType`) aus `state.inventory`. Liegt keins im Lager, wird es zum Katalogpreis per `game.spend` gekauft. Entfernte Kabel kommen ins Lager zurueck.
- Auf `rack:deviceRemoved` entfernt die Verkabelung alle Kabel des Geraets und sendet je Kabel `cable:disconnected`.
- Ein Geraet ist online, wenn es Strom hat (nur geprueft, wenn der Katalog eine PDU hat) und ueber Switches oder Patchpanels einen Router mit Strom erreicht. Der Router gilt als Internet.
- Auftraege liegen in `state.orders` mit `status: 'open' | 'active' | 'done' | 'failed'`. Angebote erscheinen nach Spielerstufe, angenommene Auftraege haben eine Frist in Ticks. Nach der Frist gibt es die halbe Belohnung, nach doppelter Frist scheitert der Auftrag. Erledigte Auftraege reservieren ihre Geraete und zahlen alle 60 Ticks laufende Einnahmen, solange die Geraete online sind.

## Tests

```bash
node --test
```

## Arbeitsweise

Jeder Bereich arbeitet auf einem eigenen Branch (`feature/logic`, `feature/shop`, `feature/cabling-orders`) und oeffnet einen Pull Request gegen `main`.
