/* STUB — substituído na etapa "Jogador" */
(function () {
  const G = window.G;
  const P = (G.player = {});
  P.create = function (spawn, opts) {
    return { x: spawn.x, y: spawn.y, dir: 0, hp: 100, alive: true, moving: false, running: false, sneaking: false, aiming: false,
      name: (opts && opts.name) || 'Sobrevivente', inventory: { name: 'Inventário', items: [], capacity: 12 }, equipped: { main: null, off: null },
      action: null, anim: { state: 'idle', t: 0 }, flashlightOn: false };
  };
  P.update = function (dt) {
    const p = G.state.player, I = G.input;
    let sx = 0, sy = 0;
    if (I.down('KeyW')) sy -= 1; if (I.down('KeyS')) sy += 1; if (I.down('KeyA')) sx -= 1; if (I.down('KeyD')) sx += 1;
    p.moving = !!(sx || sy);
    if (p.moving) { const d = G.iso.screenDirToWorld(sx, sy); G.world.moveEntity(p, d.x * dt * 3, d.y * dt * 3, 0.28); p.dir = Math.atan2(d.y, d.x); }
  };
  P.getInteractions = function () { return []; };
  P.damage = function () {};
})();
