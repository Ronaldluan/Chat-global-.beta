/* STUB — substituído na etapa "Zumbis" */
(function () {
  const G = window.G;
  G.zombies = {
    init(state) { state.zombies = []; },
    update() {},
    spawn(x, y) { const z = { id: G.util.uid(), x, y, dir: 0, hp: 1, state: 'idle' }; G.state.zombies.push(z); return z; },
    hit() { return false; },
    near(x, y, r) { return G.state.zombies.filter((z) => G.util.dist(x, y, z.x, z.y) < r); },
  };
})();
