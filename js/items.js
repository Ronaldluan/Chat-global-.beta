/* STUB — substituído na etapa "Itens & Sobrevivência" */
(function () {
  const G = window.G;
  const DEFS = {
    baseball_bat: { name: 'Taco de Beisebol', cat: 'weapon', weight: 1.5, weapon: { dmg: 1.0, range: 1.3, speed: 1.0, arc: 1.2, noise: 4, durability: 40, knock: 1 } },
    canned_beans: { name: 'Feijão Enlatado', cat: 'food', weight: 0.6, food: { hunger: 0.35, thirst: 0.05, needsOpener: true } },
    water_bottle: { name: 'Garrafa d\'Água', cat: 'drink', weight: 0.8, food: { thirst: -0.5 } },
  };
  G.items = {
    DEFS,
    RECIPES: [],
    def(item) { return DEFS[item.type] || { name: item.type, cat: 'misc', weight: 0.5 }; },
    create(type, opts) { return Object.assign({ uid: G.util.uid(), type, cond: 1 }, opts || {}); },
    name(item) { return this.def(item).name; },
    weight(items) { return items.reduce((a, it) => a + (this.def(it).weight || 0), 0); },
    drawIcon(ctx, type, x, y, size) { ctx.fillStyle = '#aa8'; ctx.fillRect(x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.6); },
    fillContainer(container, roomType, containerType, rng) { if (rng() < 0.4) container.items.push(this.create(rng() < 0.5 ? 'canned_beans' : 'water_bottle')); },
  };
})();
