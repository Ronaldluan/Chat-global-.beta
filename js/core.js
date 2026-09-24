/* =====================================================================
 * VALE QUIETO — core.js
 * Namespace global, constantes, utilidades, projeção isométrica,
 * barramento de eventos e entrada. Carregado PRIMEIRO.
 * Sem módulos ES: tudo pendura em window.G para abrir via file://.
 * ===================================================================== */
(function () {
  'use strict';

  const G = (window.G = window.G || {});

  // ------------------------------------------------------------------
  // Constantes compartilhadas (CONTRATO — não renomear)
  // ------------------------------------------------------------------
  G.CONST = {
    TILE_W: 64,            // largura do losango isométrico em px
    TILE_H: 32,            // altura do losango isométrico em px
    WALL_H: 80,            // altura visual de uma parede em px
    MAP_W: 180,            // tamanho do mapa em tiles
    MAP_H: 180,
    MINUTES_PER_SECOND: 1, // 1 s real = 1 min de jogo (1 dia = 24 min)
    START_HOUR: 9,         // o jogo começa às 9h do dia 1 (julho)
    PLAYER_RADIUS: 0.28,
    ZOMBIE_RADIUS: 0.3,
  };

  // Tipos de piso (state.map.floor)
  G.FLOOR = {
    NONE: 0, GRASS: 1, DIRT: 2, ASPHALT: 3, SIDEWALK: 4, WOOD: 5,
    TILE: 6, CARPET: 7, CONCRETE: 8, WATER: 9, ROAD_LINE: 10, GRAVEL: 11,
    DARK_GRASS: 12, SAND: 13, LINOLEUM: 14,
    DOCK: 15,   // píer/ponte de madeira sobre água (render: água por baixo)
    PORCH: 16,  // varanda/deck de madeira externo
    POOL: 17,   // piscina (bloqueia andar como água)
  };

  // Tipos de parede/estrutura (state.map.wall) — ocupam o tile inteiro
  G.WALL = {
    NONE: 0, WOOD: 1, BRICK: 2, PLASTER: 3, FENCE_WOOD: 4, FENCE_METAL: 5,
    DOOR: 6, WINDOW: 7, GARAGE_DOOR: 8, HEDGE: 9, CONCRETE: 10, GLASS: 11,
    FENCE_GATE: 12, // portão de cerca (abre/fecha/tranca como porta; não bloqueia visão)
  };

  // Bits de state.map.wallState
  G.WS = {
    OPEN: 1,        // porta/janela aberta
    BROKEN: 2,      // janela quebrada / porta arrombada
    LOCKED: 4,      // trancada
    BARRICADE_MASK: 0x70, // bits 4-6: nível de barricada 0..4
    BARRICADE_SHIFT: 4,
    CURTAIN: 128,   // janela com cortina fechada (bloqueia visão)
  };

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  const U = (G.util = {});
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.dist2 = (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  U.angle = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  U.angleDiff = (a, b) => {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  U.smoothstep = (a, b, x) => {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  let _uid = 1;
  U.uid = () => _uid++;

  // PRNG determinístico (mulberry32). G.util.rng(seed) -> função () => [0,1)
  U.rng = function (seed) {
    let a = seed >>> 0;
    const f = function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)); // inclusivo
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    f.range = (lo, hi) => lo + f() * (hi - lo);
    return f;
  };
  // RNG não-determinístico de gameplay (combate, AI) — pode ser trocado por seed
  U.rand = U.rng((Math.random() * 1e9) | 0);

  // Hash 2D estável (para variação visual de tiles): inteiro -> [0,1)
  U.hash2 = function (x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 982451653) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // Ruído de valor 2D suave (para terreno, nuvens, etc.)
  U.noise2 = function (x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = U.hash2(xi, yi, s), b = U.hash2(xi + 1, yi, s);
    const c = U.hash2(xi, yi + 1, s), d = U.hash2(xi + 1, yi + 1, s);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  };

  // Formata minutos de jogo -> "Dia 3, 14:05"
  U.formatTime = function (totalMin) {
    const day = Math.floor(totalMin / 1440) + 1;
    const m = Math.floor(totalMin % 1440);
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return { day, hh, mm, text: `Dia ${day}, ${hh}:${mm}` };
  };

  // ------------------------------------------------------------------
  // Projeção isométrica (coordenadas do mundo em TILES, floats)
  // Tile (tx,ty) ocupa [tx,tx+1)x[ty,ty+1). Centro = tx+0.5.
  // tela = ((x - y) * TW/2, (x + y) * TH/2) - camera
  // ------------------------------------------------------------------
  const ISO = (G.iso = {});
  ISO.toScreen = function (x, y, cam) {
    const c = cam || G.camera;
    return {
      x: (x - y) * (G.CONST.TILE_W / 2) * c.zoom - c.ox,
      y: (x + y) * (G.CONST.TILE_H / 2) * c.zoom - c.oy,
    };
  };
  ISO.toWorld = function (sx, sy, cam) {
    const c = cam || G.camera;
    const a = (sx + c.ox) / ((G.CONST.TILE_W / 2) * c.zoom); // x - y
    const b = (sy + c.oy) / ((G.CONST.TILE_H / 2) * c.zoom); // x + y
    return { x: (a + b) / 2, y: (b - a) / 2 };
  };
  // Converte direção de tela (dx,dy) em direção de mundo normalizada
  ISO.screenDirToWorld = function (dx, dy) {
    // inverso da matriz iso (sem zoom/offset), usando proporção 2:1
    const wx = dx / 2 + dy; // aproximação: tela->mundo com TH = TW/2
    const wy = -dx / 2 + dy;
    const l = Math.hypot(wx, wy) || 1;
    return { x: wx / l, y: wy / l };
  };

  // Câmera: segue o jogador. ox/oy são o deslocamento em px de tela.
  G.camera = { x: 70, y: 70, zoom: 1, ox: 0, oy: 0, shake: 0, viewW: 800, viewH: 600 };
  G.camera.update = function (dt) {
    const c = G.camera;
    const tw = (G.CONST.TILE_W / 2) * c.zoom, th = (G.CONST.TILE_H / 2) * c.zoom;
    let sx = (c.x - c.y) * tw, sy = (c.x + c.y) * th;
    if (c.shake > 0) {
      sx += (Math.random() - 0.5) * c.shake * 14;
      sy += (Math.random() - 0.5) * c.shake * 14;
      c.shake = Math.max(0, c.shake - dt * 3);
    }
    c.ox = Math.round(sx - c.viewW / 2);
    c.oy = Math.round(sy - c.viewH / 2);
  };

  // ------------------------------------------------------------------
  // Barramento de eventos. Ver docs/ARCHITECTURE.md para a lista oficial.
  // ------------------------------------------------------------------
  const listeners = {};
  G.events = {
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return fn; },
    off(name, fn) { const l = listeners[name]; if (l) listeners[name] = l.filter((f) => f !== fn); },
    emit(name, data) {
      const l = listeners[name];
      if (!l) return;
      for (let i = 0; i < l.length; i++) {
        try { l[i](data || {}); } catch (e) { console.error('[evento ' + name + ']', e); }
      }
    },
  };

  // Mensagem curta para o jogador (UI mostra; ex: "Está trancada.")
  G.say = function (text, kind) { G.events.emit('message', { text, kind: kind || 'info' }); };

  // ------------------------------------------------------------------
  // Entrada (teclado + mouse). Módulos LEEM daqui; UI pode bloquear.
  // ------------------------------------------------------------------
  const I = (G.input = {
    keys: {},          // KeyboardEvent.code -> true enquanto pressionada
    pressed: {},       // code -> true apenas no frame em que foi pressionada
    mouse: { sx: 0, sy: 0, wx: 0, wy: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0 },
    blocked: false,    // true quando a UI captura o teclado (ex: campo de texto)
  });
  I.down = (code) => !I.blocked && !!I.keys[code];
  I.hit = (code) => !I.blocked && !!I.pressed[code];
  I.endFrame = function () {
    I.pressed = {};
    I.mouse.leftPressed = false;
    I.mouse.rightPressed = false;
    I.mouse.wheel = 0;
  };
  I.attach = function (canvas) {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!I.keys[e.code]) I.pressed[e.code] = true;
      I.keys[e.code] = true;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { I.keys[e.code] = false; });
    window.addEventListener('blur', () => { I.keys = {}; I.mouse.left = I.mouse.right = false; });
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      I.mouse.sx = e.clientX - r.left;
      I.mouse.sy = e.clientY - r.top;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { I.mouse.left = true; I.mouse.leftPressed = true; }
      if (e.button === 2) { I.mouse.right = true; I.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) I.mouse.left = false;
      if (e.button === 2) I.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { I.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  };
  I.updateWorldMouse = function () {
    const w = G.iso.toWorld(I.mouse.sx, I.mouse.sy);
    I.mouse.wx = w.x;
    I.mouse.wy = w.y;
  };

  // Parâmetros de URL úteis para teste: ?autostart=1&seed=123&debug=1&hour=22
  G.params = (function () {
    const p = {};
    try { new URLSearchParams(location.search).forEach((v, k) => (p[k] = v)); } catch (e) { /* file:// antigo */ }
    return p;
  })();
})();
