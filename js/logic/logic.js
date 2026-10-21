// Spiellogik: Game-Loop, HUD, Rack-Ansicht, Einbau von Geraeten.
// Owner: Thread "Spiellogik".

const TICK_MS = 1000;

export function mountLogic(roots, game) {
  const { rack: rackEl, hud: hudEl } = roots;

  function renderHud() {
    hudEl.textContent = `Geld: ${game.state.money} $  |  Tick: ${game.state.tick}`;
  }

  function renderRack() {
    rackEl.innerHTML = '<h2>Rack</h2><p class="logic-placeholder">Rack-Ansicht folgt.</p>';
  }

  game.on('money:changed', renderHud);
  game.on('tick', renderHud);

  setInterval(() => {
    game.state.tick++;
    game.emit('tick', { tick: game.state.tick });
  }, TICK_MS);

  renderHud();
  renderRack();
}
