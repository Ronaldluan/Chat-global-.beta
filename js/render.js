/* =====================================================================
 * VALE QUIETO — render.js  (Etapa 2: Render)
 * Orquestra o quadro:
 *   chão (blocos em cache, construídos com orçamento) → água, decals, poças
 *   → luz quente da hora dourada (aditiva, só chão ao sol) → sombras do sol
 *   → cadáveres/itens (só visíveis) → passe vertical ordenado por
 *   profundidade (paredes finas com recorte, objetos fatiados por coluna,
 *   parapeitos de ponte, letreiros, zumbis em sprite, jogador) com raio-X
 *   suave quando algo tapa o jogador → telhados (sprites) → partículas →
 *   "névoa" da memória (fora da visão) → mapa de luz (grade + máscaras
 *   exatas dos sprites + luz das janelas, vinheta e grão) num único
 *   multiply → emissivos (postes, janelas, feixe da lanterna, faces ao sol)
 *   → neblina, chuva (só fora dos prédios), folhas → relâmpago → indicadores.
 * API: G.render.init(canvas), resize(w,h), draw(state, dt), fps, drawMs,
 *      lightAt(x,y), opts, resetMap(). Módulos internos em render-*.js.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, C = G.CONST, W = G.WALL, F = G.FLOOR, U = G.util;
  const ZPX = R.ZPX, TUNE = R.TUNE;
  let canvas = null, ctx = null, Wd = 800, Ht = 600;
  let curMap = null;
  let cutArr = null;          // recorte animado por tile (0 inteiro .. 1 baixo)
  let interiorW = null;       // paredes cujos lados visíveis são todos internos (somem sob telhado opaco)
  let roofA = null;           // opacidade do telhado por prédio (0 só com o jogador DENTRO)
  let stamp = null, stampN = 0;
  let zoomTarget = 1, lastZoomSet = 1;
  let lastFrameT = 0, fpsAcc = 0, fpsN = 0, msAcc = 0;
  let muzzleT = 0, muzzleX = 0, muzzleY = 0, muzzleZ = 1.3;
  const fadeOut = new WeakMap(); // entidades que saíram da visão: alfa decrescente
  const opts = { fov: true, roofs: true, weather: true, post: true, overlays: true, shadows: true, sync: false };

  const RD = (G.render = { fps: 0, drawMs: 0, lastMs: 0, opts, stats: {}, sec: {} });
  let secT = 0;
  function sec(name) {
    const t = performance.now();
    if (name) { const d = t - secT; const a = RD.sec[name] || (RD.sec[name] = []); a.push(d); if (a.length > 120) a.shift(); }
    secT = t;
  }
  // Luz efetiva 0..1 num ponto do mundo (ambiente/luar, interiores, lâmpadas, relâmpago, lanterna).
  RD.lightAt = function (x, y) { return R.light && R.light.lightLum ? R.light.lightLum(x, y) : 1; };

  // ------------------------------------------------------------------
  // Lista de desenho (pool reaproveitado)
  // ------------------------------------------------------------------
  const K_WALL = 0, K_OBJ = 1, K_RAIL = 2, K_SIGN = 3, K_ZOMBIE = 4, K_PLAYER = 5;
  const pool = [];
  let nList = 0;
  function push(key, kind, ref, a, b, i) {
    let e = pool[nList];
    if (!e) { e = { key: 0, kind: 0, ref: null, a: 0, b: 0, i: 0 }; pool[nList] = e; }
    e.key = key; e.kind = kind; e.ref = ref; e.a = a; e.b = b; e.i = i;
    nList++;
  }
  const sorted = [];
  function cmp(p, q) { return p.key - q.key || p.kind - q.kind || p.i - q.i; }

  // ------------------------------------------------------------------
  // Operações do mapa de luz, em ordem de desenho:
  //   OP_POLY: polígono de cor única (paredes, telhados, vidro aceso)
  //   OP_MASK: máscara exata de um sprite (objetos, zumbis): destination-out + destination-over
  //   OP_ACTOR: silhueta do jogador (desenhada ao vivo)
  // xr = 1: aplicar com o buraco do raio-X
  // ------------------------------------------------------------------
  const OP_POLY = 0, OP_MASK = 1, OP_ACTOR = 2;
  const QP = new Float32Array(1 << 16);
  const QK = new Int8Array(1 << 13), QS = new Int32Array(1 << 13), QL = new Int16Array(1 << 13), QX = new Uint8Array(1 << 13);
  const QC = new Float32Array((1 << 13) * 4);
  const QM = []; // dados das máscaras / atores
  let qpN = 0, qN = 0;
  // ops que NÃO recebem a "névoa" da memória do chão atrás delas (telhados, paredes, copas à vista)
  const DQ = new Int32Array(1 << 12);
  let dqN = 0;
  function keepSat() { if (dqN < DQ.length && qN > 0) DQ[dqN++] = qN - 1; }
  function opPoly(pts, n, r, g, b, a, xr) {
    if (qN >= QK.length - 1 || qpN + n * 2 >= QP.length) return false;
    QK[qN] = OP_POLY; QS[qN] = qpN; QL[qN] = n; QX[qN] = xr ? 1 : 0;
    for (let k = 0; k < n * 2; k++) QP[qpN++] = pts[k];
    QC[qN * 4] = r; QC[qN * 4 + 1] = g; QC[qN * 4 + 2] = b; QC[qN * 4 + 3] = a == null ? 1 : a;
    qN++;
    return true;
  }
  function maskEntry() {
    let e = QM[qN];
    if (!e) e = QM[qN] = { c: null, sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 0, dh: 0, shear: 0, baseY: 0, x: 0, y: 0, dir: 0, P: null, lk: null };
    return e;
  }
  function opMask(c, sx, sy, sw, sh, dx, dy, dw, dh, shear, baseY, r, g, b, a, xr) {
    if (qN >= QK.length - 1) return;
    const e = maskEntry();
    e.c = c; e.sx = sx; e.sy = sy; e.sw = sw; e.sh = sh; e.dx = dx; e.dy = dy; e.dw = dw; e.dh = dh; e.shear = shear; e.baseY = baseY;
    QK[qN] = OP_MASK; QX[qN] = xr === 2 ? 2 : xr ? 1 : 0;
    QC[qN * 4] = r; QC[qN * 4 + 1] = g; QC[qN * 4 + 2] = b; QC[qN * 4 + 3] = a == null ? 1 : a;
    qN++;
  }
  function opActor(x, y, dir, P, lk, r, g, b, a) {
    if (qN >= QK.length - 1) return;
    const e = maskEntry();
    e.x = x; e.y = y; e.dir = dir; e.P = P; e.lk = lk;
    QK[qN] = OP_ACTOR; QX[qN] = 0;
    QC[qN * 4] = r; QC[qN * 4 + 1] = g; QC[qN * 4 + 2] = b; QC[qN * 4 + 3] = a == null ? 1 : a;
    qN++;
  }
  const _pt = new Float32Array(64);
  const _s = [0, 0, 0], _g = [0, 0, 0], _g2 = [0, 0, 0], _e1 = [0, 0, 0], _e2 = [0, 0, 0], _s0 = [0, 0, 0], _s1 = [0, 0, 0], _s2 = [0, 0, 0];

  // chão atrás (na tela, acima) de (x,y) fora da visão? (a "névoa" da memória apareceria por trás)
  function behindHidden(vis, x, y, d) {
    const m = curMap;
    if (!vis) return false;
    for (let k = 1; k <= d; k++) {
      const bx = x - k, by = y - k;
      if (bx < 0 || by < 0) return false;
      if (vis[by * m.w + bx] < 0.7) return true;
    }
    return false;
  }
  function visNear(x, y, r) {
    const vis = R.light.vis(), m = curMap;
    if (!vis) return 1;
    let v = 0;
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
      if (xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && vis[yy * m.w + xx] > v) v = vis[yy * m.w + xx];
    }
    return v;
  }

  // ------------------------------------------------------------------
  // Preparação por mapa
  // ------------------------------------------------------------------
  const bridgeRails = []; // [x, y, side] (side: 0 N, 1 E, 2 S, 3 W)
  const signs = [];       // letreiros { b, ax, x0, x1, c (linha da fachada), key, text }
  function ensureMap(s) {
    const m = s.map;
    if (m === curMap) return;
    curMap = m;
    if (G.world.setMap) G.world.setMap(m);
    R.ground.reset(m);
    R.walls.reset(m);
    R.objects.reset(m);
    R.light.reset(m);
    R.fx.shadowReset(m);
    cutArr = new Float32Array(m.w * m.h);
    // paredes internas (todos os lados visíveis dão para dentro do mesmo prédio)
    interiorW = new Uint8Array(m.w * m.h);
    for (let i = 0; i < m.w * m.h; i++) {
      const b = m.building[i];
      if (!m.wall[i] || !b) continue;
      let inside = true;
      for (let q = 1; q < 4; q++) { const src = R.ground.qsrc(i, q); if (m.building[src] !== b || src === i) { inside = false; break; } }
      if (inside) interiorW[i] = 1;
    }
    roofA = new Float32Array(m.buildings.length + 1).fill(1);
    stamp = new Uint32Array(m.objects.length + 8); stampN = 0;
    zoomTarget = G.camera.zoom; lastZoomSet = G.camera.zoom;
    // parapeitos de ponte: bordas do tabuleiro que dão para a água
    bridgeRails.length = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      if (!R.ground.isBridge(i)) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + R.DX[d], ny = y + R.DY[d];
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        if (m.floor[ny * m.w + nx] === F.WATER) bridgeRails.push(x, y, d === 0 ? 1 : d === 1 ? 2 : d === 2 ? 3 : 0);
      }
    }
    buildSigns(m);
    if (G.fov) G.fov.compute(s);
  }
  RD.resetMap = function () { curMap = null; };
  // letreiros nas fachadas voltadas para a câmera (S/E) de prédios comerciais
  const SIGNED = { store: 1, gas_station: 1, pharmacy: 1, diner: 1, police: 1, clinic: 1, office: 1, library: 1, fire_station: 1, school: 1, motel: 1, church: 1, warehouse: 1 };
  function buildSigns(m) {
    signs.length = 0;
    for (const b of m.buildings) {
      if (!SIGNED[b.type] || !b.name) continue;
      // fachada: sul (linha y = b.y+b.h-1) ou leste (x = b.x+b.w-1), a maior entre as visíveis
      const south = b.face === 'S' || (b.face !== 'E' && b.w >= b.h);
      const L = Math.min((south ? b.w : b.h) - 2, 2 + b.name.length * 0.26);
      if (L < 2) continue;
      const along0 = (south ? b.x + b.w / 2 : b.y + b.h / 2) - L / 2;
      const line = south ? b.y + b.h - 0.5 + R.walls.T2 + 0.03 : b.x + b.w - 0.5 + R.walls.T2 + 0.03;
      const mid = Math.floor(along0 + L / 2), end = Math.floor(along0 + L);
      const tx = south ? mid : Math.floor(line), ty = south ? Math.floor(line) : mid;
      // ordena depois de todos os tiles de parede que o letreiro cobre
      const key = south ? end + ty + 1.02 : tx + end + 1.02;
      signs.push({ b, ax: south ? 'x' : 'y', s0: along0, s1: along0 + L, c: line, tx, ty, key, spr: null, S: 0 });
    }
  }

  function onStructure(e) {
    if (!curMap || !e) return;
    const x = Math.floor(e.x), y = Math.floor(e.y);
    if (!(x >= 0 && y >= 0 && x < curMap.w && y < curMap.h)) return;
    R.light.fovTileChanged(x, y);
    R.light.dirtyAt(x, y);
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= curMap.w || yy >= curMap.h) continue;
      R.walls.updateTile(yy * curMap.w + xx);
    }
  }
  function spawnP(s, x, y, z, type, n, spd, col, size, life, vx0, vy0) {
    if (!s || !s.particles) return;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, v = spd * (0.3 + Math.random() * 0.7);
      const l = life * (0.6 + Math.random() * 0.6);
      s.particles.push({ x, y, z, vx: Math.cos(a) * v + (vx0 || 0), vy: Math.sin(a) * v + (vy0 || 0), vz: Math.random() * spd * 1.2, life: l, maxLife: l, type, color: col, size: size * (0.7 + Math.random() * 0.6) });
    }
  }

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------
  RD.init = function (cv) {
    canvas = cv;
    ctx = cv.getContext('2d', { alpha: false });
    Wd = cv.width; Ht = cv.height;
    const ev = G.events;
    ['door:open', 'door:close', 'door:break', 'window:open', 'window:close', 'window:break', 'window:curtain', 'barricade:add', 'barricade:break', 'barricade:remove', 'fence:break'].forEach((n) => ev.on(n, onStructure));
    ev.on('player:attack', (e) => {
      const s = G.state; if (!s || !s.player || !e) return;
      if (e.firearm) {
        const p = s.player, d = e.dir != null ? e.dir : p.dir || 0;
        const mw = R.actors.muzzleWorld;
        muzzleX = mw ? mw[0] : p.x + Math.cos(d) * 0.75; muzzleY = mw ? mw[1] : p.y + Math.sin(d) * 0.75; muzzleZ = mw ? mw[2] : 1.35;
        muzzleT = 0.09;
        if (s.particles) s.particles.push({ x: muzzleX, y: muzzleY, z: muzzleZ, vx: 0, vy: 0, vz: 0, life: 0.07, maxLife: 0.07, type: 'muzzle', size: 4 });
        spawnP(s, muzzleX, muzzleY, muzzleZ, 'smoke', 3, 0.4, null, 2.5, 0.9, Math.cos(d) * 0.5, Math.sin(d) * 0.5);
        spawnP(s, p.x + Math.cos(d + 1.57) * 0.2, p.y + Math.sin(d + 1.57) * 0.2, 1.2, 'shell', 1, 1.2, null, 1.5, 1.6, Math.cos(d + 1.57) * 1.2, Math.sin(d + 1.57) * 1.2);
        spawnP(s, muzzleX, muzzleY, muzzleZ, 'spark', 4, 3, null, 1, 0.15, Math.cos(d) * 3, Math.sin(d) * 3);
      }
    });
    ev.on('zombie:hit', (e) => {
      const s = G.state, z = e && e.zombie; if (!s || !z) return;
      const p = s.player;
      const a = p ? Math.atan2(z.y - p.y, z.x - p.x) : 0;
      spawnP(s, z.x, z.y, 1.25, 'blood', e.killed ? 14 : 8, 1.4, null, 2.4, 0.9, Math.cos(a) * 1.6, Math.sin(a) * 1.6);
      if (s.decals && Math.random() < 0.7) s.decals.push({ x: z.x + Math.cos(a) * 0.4, y: z.y + Math.sin(a) * 0.4, type: e.killed ? 'bloodpool' : 'blood', size: e.killed ? 0.9 : 0.45, rot: Math.random() * 6.28, alpha: 0.9, t: s.time });
    });
    ev.on('player:hit', () => { const s = G.state; if (s && s.player) spawnP(s, s.player.x, s.player.y, 1.3, 'blood', 7, 1.2, null, 2.2, 0.8); });
    ev.on('game:start', () => { R.light.env.wet = 0; curMap = null; });
  };
  RD.resize = function (w, h) { Wd = w; Ht = h; };

  // ------------------------------------------------------------------
  // Zoom (roda do mouse com magnitude) e escala dos caches (com histerese)
  // ------------------------------------------------------------------
  function updateZoom(dt) {
    const cam = G.camera, I = G.input, Z = TUNE.zoom;
    if (Math.abs(cam.zoom - lastZoomSet) > 1e-6) zoomTarget = cam.zoom; // alterado externamente (debug)
    const over = G.ui && G.ui.isCapturingMouse && G.ui.isCapturingMouse();
    const wh = I && I.mouse ? +I.mouse.wheel || 0 : 0;
    if (wh && !over) zoomTarget = U.clamp(zoomTarget * Math.pow(Z.step, -U.clamp(wh, -3, 3)), Z.min, Z.max);
    zoomTarget = U.clamp(zoomTarget, Z.min, Z.max);
    const nz = Math.abs(zoomTarget - cam.zoom) < 1e-3 ? zoomTarget : U.lerp(cam.zoom, zoomTarget, 1 - Math.pow(0.0005, dt));
    if (nz !== cam.zoom) {
      // mantém o centro da câmera (preserva tremor já aplicado)
      const tw = C.TILE_W / 2, th = C.TILE_H / 2;
      const ob0 = Math.round((cam.x - cam.y) * tw * cam.zoom - cam.viewW / 2), ob1 = Math.round((cam.x + cam.y) * th * cam.zoom - cam.viewH / 2);
      const sh0 = cam.ox - ob0, sh1 = cam.oy - ob1;
      cam.zoom = nz;
      cam.ox = Math.round((cam.x - cam.y) * tw * nz - cam.viewW / 2) + sh0;
      cam.oy = Math.round((cam.x + cam.y) * th * nz - cam.viewH / 2) + sh1;
    }
    lastZoomSet = cam.zoom;
    // escala dos caches: 0.5 (longe), 1, 2 (perto) — com histerese para não ficar trocando
    let S = R.S;
    const z = cam.zoom;
    if (S === 1) { if (z > Z.s2up) S = 2; else if (z < Z.sHalfDown) S = 0.5; }
    else if (S === 2) { if (z < Z.s2down) S = z < Z.sHalfDown ? 0.5 : 1; }
    else if (z > Z.sHalfUp) S = z > Z.s2up ? 2 : 1;
    R.S = S;
    R.ground.setScale(S); R.walls.setScale(S); R.objects.setScale(S);
  }

  function pointInPoly(px, py, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  // Telhado some inteiro só com o jogador DENTRO do prédio; tapando por fora → raio-X local
  let inB = 0;
  const xr = { a: 1, str: 0, X: 0, Y: 0, r: 80, soft: 30, roof: 0, occ: false, occPrev: false, PX0: 0, PX1: 0, PY0: 0, PY1: 0 };
  function updateRoofs(s, dt) {
    const m = s.map, p = s.player;
    inB = p ? m.building[Math.floor(p.y) * m.w + Math.floor(p.x)] : 0;
    const PX = p ? (p.x - p.y) * 32 : 0, PY = p ? (p.x + p.y) * 16 : 0;
    const k = 1 - Math.exp(-dt * 7);
    xr.roof = 0;
    for (const rf of R.walls.roofs) {
      const b = rf.b;
      let t = 1;
      if (!opts.roofs) t = 0;
      else if (p && b.id === inB) t = 0;
      else if (p && p.alive !== false && !xr.roof) {
        const behind = !(p.x >= b.x + b.w - 0.3 || p.y >= b.y + b.h - 0.3);
        if (behind) {
          R.walls.roofBounds(rf);
          if (PX > rf.x0 && PX < rf.x1 && PY - 60 < rf.y1 && PY > rf.y0 && (pointInPoly(PX, PY - 30, rf.hull) || pointInPoly(PX, PY - 5, rf.hull) || pointInPoly(PX, PY - 55, rf.hull))) xr.roof = b.id;
        }
      }
      const a = roofA[b.id];
      roofA[b.id] = Math.abs(t - a) < 0.01 ? t : a + (t - a) * k;
    }
    // raio-X: força suavizada (usa a oclusão detectada no quadro anterior)
    const want = p && p.alive !== false && (xr.roof || xr.occPrev) ? 1 : 0;
    xr.str += (want - xr.str) * (1 - Math.exp(-dt * 8));
    if (Math.abs(want - xr.str) < 0.01) xr.str = want;
    xr.a = 1 + (TUNE.xray.alpha - 1) * xr.str;
    xr.X = PX; xr.Y = PY - 1.05 * ZPX; xr.r = TUNE.xray.r; xr.soft = TUNE.xray.soft;
    xr.PX0 = PX - 14; xr.PX1 = PX + 14; xr.PY0 = PY - 64; xr.PY1 = PY + 4;
    xr.occPrev = false; xr.occ = false;
    // cursor atrás de uma copa: recorte circular em volta dele
    const mo = G.input && G.input.mouse;
    cur.on = !!(mo && mo.wx === mo.wx && mo.wy === mo.wy && s.mode === 'playing' && !(G.ui && G.ui.isCapturingMouse && G.ui.isCapturingMouse()));
    if (cur.on) { cur.X = (mo.wx - mo.wy) * 32; cur.Y = (mo.wx + mo.wy) * 16; cur.D = mo.wx + mo.wy; }
    const wantC = cur.on && cur.occPrev ? 1 : 0;
    cur.str += (wantC - cur.str) * (1 - Math.exp(-dt * 10));
    if (Math.abs(wantC - cur.str) < 0.01) cur.str = wantC;
    cur.a = 1 + (TUNE.xray.alpha - 1) * cur.str; cur.r = TUNE.xray.r * 0.75; cur.soft = TUNE.xray.soft * 0.8;
    cur.occPrev = false; cur.occ = false;
  }
  const cur = { on: false, X: 0, Y: 0, D: 0, str: 0, a: 1, r: 60, soft: 30, occ: false, occPrev: false };
  // o sprite no retângulo (px iso) tapa o jogador?
  function coversPlayer(l, t, w, h) { return l < xr.PX1 && l + w > xr.PX0 && t < xr.PY1 && t + h > xr.PY0; }
  // desenha com um buraco circular suave (anéis de alfa decrescente) em volta do jogador
  function xrDraw(g, draw, rr, h) {
    h = h || xr;
    const X = h.X, Y = h.Y, r = rr || h.r, soft = h.soft, aMin = h.a;
    g.save(); g.beginPath(); g.rect(X - 4000, Y - 4000, 8000, 8000); g.arc(X, Y, r, 0, 6.2832, true); g.clip(); draw(g, 1); g.restore();
    const K = TUNE.xray.rings;
    for (let k = 0; k < K; k++) {
      const ro = r - soft * k / K, ri = r - soft * (k + 1) / K;
      g.save(); g.beginPath(); g.arc(X, Y, ro, 0, 6.2832); g.arc(X, Y, ri, 0, 6.2832, true); g.clip();
      draw(g, 1 + (aMin - 1) * (k + 1) / (K + 1));
      g.restore();
    }
    g.save(); g.beginPath(); g.arc(X, Y, r - soft, 0, 6.2832); g.clip(); draw(g, aMin); g.restore();
  }
  function cutTarget(i, x, y, p, pSum, pDiff) {
    const m = curMap;
    const b = m.building[i];
    if (!b || roofA[b] > 0.65) return 0;
    const d = x + y + 1 - pSum;
    if (d < 0.35) return 0;
    const dd = Math.abs(x - y - pDiff);
    // dentro do prédio: todas as paredes da frente dele (sem "pilares" soltos nos cantos); fora: só perto
    if (roofA[b] < 0.3 && inB === b) return 1;
    if (dd > 5 || d > 8) return 0;
    return 1;
  }

  // ------------------------------------------------------------------
  // Objetos: fatias por coluna de tela (resolve ordenação de objetos grandes)
  // ------------------------------------------------------------------
  function pushObject(o, idx) {
    if (o.type === 'rug') return;
    const x0 = o.x, y0 = o.y, x1 = o.x + o.w - 1, y1 = o.y + o.h - 1;
    if (o.w === 1 && o.h === 1) { push(x0 + y0 + 1, K_OBJ, o, -1e9, 1e9, idx); return; }
    const uMin = x0 - y1, uMax = x1 - y0;
    let prevKey = -2e9, startX = -1e9, first = true;
    for (let sI = uMin - 1; sI <= uMax; sI++) {
      const k = Math.max(keyU(x0, y0, x1, y1, sI), keyU(x0, y0, x1, y1, sI + 1));
      if (first) { prevKey = k; first = false; continue; }
      if (k !== prevKey) {
        const bx = sI * 32;
        push(prevKey, K_OBJ, o, startX, bx, idx);
        startX = bx; prevKey = k;
      }
    }
    push(prevKey, K_OBJ, o, startX, 1e9, idx);
  }
  function keyU(x0, y0, x1, y1, u) {
    const xmin = Math.max(x0, y0 + u), xmax = Math.min(x1, y1 + u);
    if (xmin > xmax) return -1e9;
    return 2 * xmax - u + 1;
  }

  // ------------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------------
  const waterT = [], puddleT = [], wallT = [], tallFront = [], roofList = [], rainPolys = [], winPatches = [], sunFaces = [];
  const view = { X0: 0, Y0: 0, X1: 0, Y1: 0 };
  const uvRange = [0, 0, 0, 0];
  const zoomT = { a: 1, e: 0, f: 0 };
  let frameN = 0, afterPlayer = false, grid = null;

  RD.draw = function (s, dt) {
    const t0 = performance.now();
    if (lastFrameT) { fpsAcc += t0 - lastFrameT; fpsN++; if (fpsAcc > 500) { RD.fps = Math.round(1000 * fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; } }
    lastFrameT = t0;
    frameN++;
    if (!ctx) return;
    if (canvas.width !== Wd || canvas.height !== Ht) { Wd = canvas.width; Ht = canvas.height; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#07090a'; ctx.fillRect(0, 0, Wd, Ht);
    if (!s || !s.map) return;
    dt = dt > 0 ? Math.min(dt, 0.25) : 0.016;
    const playing = s.mode === 'playing';
    ensureMap(s);
    updateZoom(dt);
    const cam = G.camera, z = cam.zoom, m = s.map, p = s.player && s.player.x === s.player.x ? s.player : null;
    sec();
    R.light.opts.fov = opts.fov;
    R.light.prepare(s, dt);
    const env = R.light.env;
    if (playing || s.mode === 'dead') R.fx.updateParticles(s, dt);
    if (muzzleT > 0) muzzleT -= dt;
    // orçamentos deste quadro (síncrono no começo e quando pedido: galeria, capturas)
    const sync = opts.sync || frameN < 3;
    const B = TUNE.budget;
    R.walls.budget = sync ? 1e9 : B.walls; R.walls.roofBudget = sync ? 1e9 : B.roofs;
    R.objects.budget = sync ? 1e9 : B.objects; R.actors.budget = sync ? 1e9 : B.actors;

    view.X0 = cam.ox / z; view.Y0 = cam.oy / z; view.X1 = (cam.ox + Wd) / z; view.Y1 = (cam.oy + Ht) / z;
    zoomT.a = z; zoomT.e = -cam.ox; zoomT.f = -cam.oy;
    updateRoofs(s, dt);
    lod = z < 0.8 ? 2.5 : z < 1 ? 1.5 : 1;

    // ---- chão ----
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    sec('pre');
    const gBudget = sync ? Infinity : (R.ground.stats.missing > 2 ? B.groundCold : B.ground);
    R.ground.draw(ctx, view, gBudget);
    sec('ground');

    // ---- varredura dos tiles visíveis ----
    const u0 = Math.floor(view.X0 / 32) - 3, u1 = Math.ceil(view.X1 / 32) + 3;
    const v0 = Math.floor(view.Y0 / 16) - 4, v1 = Math.ceil(view.Y1 / 16) + 20;
    uvRange[0] = u0; uvRange[1] = u1; uvRange[2] = v0; uvRange[3] = Math.ceil(view.Y1 / 16) + 3;
    nList = 0; waterT.length = 0; puddleT.length = 0; wallT.length = 0;
    if (++stampN > 4e9) { stampN = 1; stamp.fill(0); }
    const pSum = p ? p.x + p.y : 0, pDiff = p ? p.x - p.y : 0;
    const kc = 1 - Math.exp(-dt * 9);
    const wet = env.wet > 0.25;
    const seen = R.light.seen();
    for (let v = v0; v <= v1; v++) {
      const inView = v <= Math.ceil(view.Y1 / 16) + 2;
      for (let u = u0; u <= u1; u++) {
        if ((u + v) & 1) continue;
        const x = (u + v) >> 1, y = (v - u) >> 1;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const i = y * m.w + x;
        if (m.wall[i]) {
          const hb = m.building[i];
          if (!(interiorW[i] && roofA[hb] >= 0.99)) push(x + y + 1, K_WALL, null, 0, 0, i);
          if (p) { const tc = cutTarget(i, x, y, p, pSum, pDiff); const c0 = cutArr[i]; cutArr[i] = Math.abs(tc - c0) < 0.01 ? tc : c0 + (tc - c0) * kc; }
          wallT.push(i);
        }
        const oi = m.objAt[i];
        if (oi >= 0 && stamp[oi] !== stampN) {
          stamp[oi] = stampN;
          const o = m.objects[oi];
          // sob telhado opaco não aparece; com o telhado escondido, só o que já foi visto
          if (o.building && (roofA[o.building] >= 0.99 || (opts.fov && seen && !seen[o.y * m.w + o.x] && roofA[o.building] < 0.5))) { /* escondido */ }
          else pushObject(o, oi);
        }
        if (inView) {
          const f = m.floor[i];
          if (f === F.WATER) waterT.push(i);
          else if (wet && !m.building[i] && (f === F.ASPHALT || f === F.DIRT || f === F.GRAVEL || f === F.CONCRETE)) puddleT.push(i);
        }
      }
    }
    // parapeitos de ponte e letreiros (entram na ordenação)
    for (let k = 0; k < bridgeRails.length; k += 3) {
      const x = bridgeRails[k], y = bridgeRails[k + 1], sd = bridgeRails[k + 2];
      const X = (x - y) * 32, Y = (x + y) * 16;
      if (X < view.X0 - 64 || X > view.X1 + 64 || Y < view.Y0 - 64 || Y > view.Y1 + 32) continue;
      push(x + y + (sd === 0 || sd === 3 ? 0.55 : 1.45), K_RAIL, null, sd, 0, k);
    }
    for (let k = 0; k < signs.length; k++) {
      const sg = signs[k];
      const X = (sg.tx - sg.ty) * 32, Y = (sg.tx + sg.ty) * 16;
      if (X < view.X0 - 200 || X > view.X1 + 200 || Y < view.Y0 - 60 || Y > view.Y1 + 120) continue;
      if (roofA[sg.b.id] < 0.5) continue; // jogador dentro: fachada recortada
      push(sg.key, K_SIGN, sg, 0, 0, k);
    }
    sec('scan');

    // ---- grade de luz (antes: a lanterna e a luz quente dependem dela) ----
    grid = R.light.buildGrid(s, uvRange);
    sec('grid');
    // ---- água animada, decals, poças ----
    if (waterT.length) drawWater(s, env);
    R.fx.drawDecals(ctx, s, view, zoomT);
    if (wet) R.fx.drawPuddles(ctx, s, puddleT, puddleT.length, zoomT);
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    ctx.globalAlpha = 1;
    // ---- hora dourada: luz quente aditiva no chão externo (as sombras a seguir a tiram) ----
    if (grid && grid.warm && opts.post) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(grid.warm, grid.dx, grid.dy, grid.dw, grid.dh);
      ctx.globalCompositeOperation = 'source-over';
    }
    sec('groundfx');
    // ---- sombras do sol ----
    if (opts.shadows && env.sunA > 0.02) drawSunShadows(s, sync);
    sec('shadows');
    drawContactShadows(s);
    // ---- cadáveres e itens no chão (só o que se vê; somem aos poucos ao sair da visão) ----
    drawGroundThings(s, dt);

    // ---- entidades na lista ----
    const zs = s.zombies || [];
    for (let k = 0; k < zs.length; k++) {
      const zz = zs[k];
      if (!zz || !(zz.x === zz.x) || !(zz.y === zz.y)) continue;
      const X = (zz.x - zz.y) * 32, Y = (zz.x + zz.y) * 16;
      if (X < view.X0 - 40 || X > view.X1 + 40 || Y < view.Y0 - 10 || Y > view.Y1 + 80) { R.actors.track(zz, dt); continue; }
      const a = entityAlpha(zz, zz.x, zz.y, dt);
      if (a <= 0.01) { R.actors.track(zz, dt); continue; }
      push(zz.x + zz.y, K_ZOMBIE, zz, a, 0, k);
    }
    if (p) push(p.x + p.y, K_PLAYER, p, 1, 0, 0);
    sec('ents');

    // ---- passe vertical ----
    sorted.length = nList;
    for (let k = 0; k < nList; k++) sorted[k] = pool[k];
    sorted.sort(cmp);
    qN = 0; qpN = 0; dqN = 0; lfOp = -1;
    tallFront.length = 0; winPatches.length = 0; sunFaces.length = 0;
    afterPlayer = false;
    R.light.frameFlash(p);
    for (let k = 0; k < nList; k++) {
      const e = sorted[k];
      if (e.kind === K_WALL) drawWall(s, e.i, env);
      else if (e.kind === K_OBJ) drawObj(s, e.ref, e.a, e.b, dt);
      else if (e.kind === K_ZOMBIE) drawZombie(e.ref, e.a, dt, env);
      else if (e.kind === K_PLAYER) { drawPlayer(s, e.ref, dt, env); afterPlayer = true; }
      else if (e.kind === K_RAIL) drawRail(s, e.i, e.a);
      else if (e.kind === K_SIGN) drawSign(s, e.ref);
    }
    sec('vertical');
    // ---- telhados (+ árvores/postes na frente deles) ----
    if (opts.roofs) drawRoofs(s);
    sec('roofs');
    // ---- partículas (não emissivas) ----
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    R.fx.drawParticles(ctx, s, false);
    // ---- memória: "névoa" cinza fora da visão (antes do multiply) ----
    if (opts.fov) drawMemoryHaze(cam, z);
    sec('haze');
    // ---- luz ----
    applyShade(s, cam, z, env);
    sec('shade');
    // ---- emissivos ----
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    drawEmissive(s, env);
    // ---- clima ----
    const pScr0 = p ? (p.x - p.y) * 32 * z - cam.ox : Wd / 2, pScr1 = p ? ((p.x + p.y) * 16 - 30) * z - cam.oy : Ht / 2;
    if (opts.weather) {
      R.fx.drawFog(ctx, Wd, Ht, cam, pScr0, pScr1);
      ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
      drawHalos(env);
      R.fx.drawRain(ctx, Wd, Ht, playing ? dt : 0, s, rainExclude(s, cam, z), cam);
      R.fx.drawLeaves(ctx, Wd, Ht, playing ? dt : 0);
    }
    sec('emis+weather');
    // ---- pós (relâmpago) ----
    if (opts.post) R.fx.post(ctx, Wd, Ht);
    sec('post');
    // ---- indicadores ----
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (opts.overlays && s.mode !== 'dead') drawOverlays(s);
    if (G.debug && G.debug.enabled) drawDebug(s);
    xr.occPrev = xr.occ; cur.occPrev = cur.occ;
    const ms = performance.now() - t0;
    msAcc = msAcc ? msAcc * 0.92 + ms * 0.08 : ms;
    RD.drawMs = Math.round(msAcc * 100) / 100;
    RD.lastMs = ms;
    RD.stats.ops = qN; RD.stats.keep = dqN; RD.stats.list = nList;
  };

  // visibilidade de entidades dinâmicas: aparecem na hora (canSee); somem aos poucos ao sair
  function entityAlpha(e, x, y, dt) {
    if (!opts.fov) return 1;
    if (G.fov.canSee(x, y)) { fadeOut.set(e, 1); return 1; }
    const a = fadeOut.get(e);
    if (a === undefined || a <= 0) return 0;
    const na = a - dt * 3;
    fadeOut.set(e, na);
    return na > 0 ? na : 0;
  }

  // ------------------------------------------------------------------
  // Partes do quadro
  // ------------------------------------------------------------------
  function drawWater(s, env) {
    const m = s.map, t = env.t;
    const L = Math.min(1, 0.25 + env.lum);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + Math.round(200 * L) + ',' + Math.round(222 * L) + ',' + Math.round(226 * L) + ',0.2)';
    ctx.beginPath();
    for (let k = 0; k < waterT.length; k++) {
      const i = waterT[k], x = i % m.w, y = (i / m.w) | 0;
      for (let r = 0; r < 2; r++) {
        const h = R.hash(x * 3 + r, y, 55), h2 = R.hash(x, y * 3 + r, 56);
        const ph = t * (0.5 + h * 0.6) + h2 * 6.28;
        const wx = x + 0.15 + h * 0.7 + Math.sin(ph) * 0.12, wy = y + 0.15 + h2 * 0.7;
        const X = (wx - wy) * 32, Y = (wx + wy) * 16;
        const len = 5 + 5 * (0.5 + 0.5 * Math.sin(ph * 1.3));
        ctx.moveTo(X - len, Y); ctx.lineTo(X + len, Y);
      }
    }
    ctx.stroke();
    // brilhos do sol/lua
    if (env.sunA > 0.05 || env.night > 0.5) {
      ctx.fillStyle = env.night > 0.5 ? 'rgba(200,210,230,0.35)' : env.warm > 0.3 ? 'rgba(255,214,150,0.8)' : 'rgba(255,250,230,0.7)';
      for (let k = 0; k < waterT.length; k++) {
        const i = waterT[k], x = i % m.w, y = (i / m.w) | 0;
        const h = R.hash(x, y, 57);
        if (h > 0.2) continue;
        const a = Math.sin(t * 2.2 + h * 40);
        if (a < 0.6) continue;
        ctx.fillRect((x - y) * 32 + h * 100 - 10, (x + y) * 16 + 16 + R.hash(x, y, 58) * 10 - 5, 2, 1);
      }
    }
    if (env.rain > 0.1) { // anéis de chuva na água
      ctx.strokeStyle = 'rgba(200,215,225,0.25)'; ctx.beginPath();
      for (let k = 0; k < waterT.length; k += 3) {
        const i = waterT[k], x = i % m.w, y = (i / m.w) | 0;
        const h = R.hash(x, y, 59);
        const ph = (t * (1.3 + h) + h * 10) % 1;
        if (R.hash(x, (y + Math.floor(t * (1.3 + h) + h * 10)) | 0, 60) > env.rain) continue;
        const X = (x - y) * 32 + (h - 0.5) * 30, Y = (x + y) * 16 + 16;
        ctx.moveTo(X + ph * 9, Y); ctx.ellipse(X, Y, ph * 9, ph * 4.5, 0, 0, 6.283);
      }
      ctx.stroke();
    }
  }

  function drawGroundThings(s, dt) {
    const cs = s.corpses || [];
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      if (!c || !(c.x === c.x) || !(c.y === c.y)) continue;
      const X = (c.x - c.y) * 32, Y = (c.x + c.y) * 16;
      if (X < view.X0 - 60 || X > view.X1 + 60 || Y < view.Y0 - 40 || Y > view.Y1 + 40) continue;
      const a = entityAlpha(c, c.x, c.y, dt);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      R.actors.drawCorpse(ctx, c, s);
    }
    const gi = s.groundItems || [];
    for (let k = 0; k < gi.length; k++) {
      const g = gi[k];
      if (!g || !(g.x === g.x) || !(g.y === g.y)) continue;
      const X = (g.x - g.y) * 32, Y = (g.x + g.y) * 16;
      if (X < view.X0 - 20 || X > view.X1 + 20 || Y < view.Y0 - 20 || Y > view.Y1 + 20) continue;
      const a = entityAlpha(g, g.x, g.y, dt);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      drawItem(g, X, Y);
    }
    ctx.globalAlpha = 1;
  }
  const iconCache = new Map();
  function itemIcon(type) {
    let c = iconCache.get(type);
    if (c) return c;
    c = R.canvas(32, 32);
    const g = c.getContext('2d');
    try {
      if (G.items && G.items.drawIcon) G.items.drawIcon(g, type, 0, 0, 32);
      else { g.fillStyle = '#aa8'; g.fillRect(6, 6, 20, 20); }
    } catch (e) { g.fillStyle = '#aa8'; g.fillRect(6, 6, 20, 20); }
    iconCache.set(type, c);
    return c;
  }
  function drawItem(g, X, Y) {
    const it = g.item || {};
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(X, Y + 1, 7, 3, 0, 0, 6.283); ctx.fill();
    const ic = itemIcon(it.type || '?');
    const rot = (R.hash((g.x * 100) | 0, (g.y * 100) | 0, 3) - 0.5) * 0.9;
    ctx.save();
    ctx.translate(X, Y - 3);
    ctx.transform(1, 0.12 * Math.sign(rot), 0, 0.72, 0, 0);
    ctx.rotate(rot * 0.4);
    ctx.drawImage(ic, -9, -9, 18, 18);
    ctx.restore();
  }

  function drawSunShadows(s, sync) {
    const env = R.light.env, m = s.map, cam = G.camera;
    R.fx.shadowPrep();
    // sombras estáticas (cache por bloco) direto no quadro; mais marcadas e azuladas ao entardecer
    ctx.globalAlpha = Math.min(0.62, env.sunA + env.warm * 0.22);
    R.fx.drawStaticShadows(view, ctx, sync ? Infinity : TUNE.budget.shadows);
    ctx.globalAlpha = 1;
    R.fx.shadowBegin(Wd, Ht, cam);
    // entidades (dinâmicas)
    const p = s.player;
    if (p && p.alive !== false && p.x === p.x && !m.building[Math.floor(p.y) * m.w + Math.floor(p.x)]) R.fx.shadowActor(p.x, p.y, 1.7);
    const zs = s.zombies || [];
    for (let k = 0; k < zs.length; k++) {
      const zz = zs[k];
      if (!zz || zz.state === 'down' || zz.state === 'crawl' || zz.crawler || zz.state === 'dead' || !(zz.x === zz.x)) continue;
      const X = (zz.x - zz.y) * 32, Y = (zz.x + zz.y) * 16;
      if (X < view.X0 - 80 || X > view.X1 + 80 || Y < view.Y0 - 40 || Y > view.Y1 + 80) continue;
      if (opts.fov && !G.fov.canSee(zz.x, zz.y)) continue;
      if (m.building[Math.floor(zz.y) * m.w + Math.floor(zz.x)]) continue;
      R.fx.shadowActor(zz.x, zz.y, 1.65);
    }
    R.fx.shadowEnd(ctx, Math.min(0.62, env.sunA + env.warm * 0.22), null);
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.ox, -cam.oy);
  }
  function drawContactShadows(s) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    const p = s.player;
    if (p && p.alive !== false && p.x === p.x) { const X = (p.x - p.y) * 32, Y = (p.x + p.y) * 16; ctx.moveTo(X + 9, Y); ctx.ellipse(X, Y, 9, 4.2, 0, 0, 6.283); }
    const zs = s.zombies || [];
    for (let k = 0; k < zs.length; k++) {
      const zz = zs[k];
      if (!zz || !(zz.x === zz.x) || !(zz.y === zz.y)) continue;
      const X = (zz.x - zz.y) * 32, Y = (zz.x + zz.y) * 16;
      if (X < view.X0 - 20 || X > view.X1 + 20 || Y < view.Y0 - 10 || Y > view.Y1 + 70) continue;
      if (opts.fov && !G.fov.canSee(zz.x, zz.y)) continue;
      const lying = zz.state === 'down' || zz.state === 'crawl' || zz.crawler || zz.state === 'dead';
      const d = zz.dir || 0;
      ctx.moveTo(X + (lying ? 20 : 9), Y); ctx.ellipse(X, Y, lying ? 20 : 9, lying ? 9 : 4.2, lying ? Math.atan2(Math.sin(d) + Math.cos(d), (Math.cos(d) - Math.sin(d)) * 2) : 0, 0, 6.283);
    }
    ctx.fill();
  }

  // ------------------------------------------------------------------
  // Paredes: sprite(s) + faces de luz em pedaços de 1/4 de tile (cor única, sem gradiente)
  // ------------------------------------------------------------------
  function rowTile(tx, ty, fromWall, q) {
    const m = curMap;
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return fromWall;
    const i = ty * m.w + tx;
    if (m.wall[i]) return R.ground.qsrc(i, q);
    return i;
  }
  // Luz ao longo da face visível: interpola os tiles da fileira em frente à face.
  // axisX: face sul (fileira y+1, posição X); senão face leste (coluna x+1, posição Y).
  function faceSample(wallI, axisX, pos, fx, fy, out) {
    const m = curMap, x = wallI % m.w, y = (wallI / m.w) | 0;
    const f = pos - 0.5, t0 = Math.floor(f), fr = f - t0;
    const q3 = R.ground.qsrc(wallI, 3);
    let iA, iB;
    if (axisX) { iA = rowTile(t0, y + 1, q3, 0); iB = rowTile(t0 + 1, y + 1, q3, 1); }
    else { iA = rowTile(x + 1, t0, q3, 0); iB = rowTile(x + 1, t0 + 1, q3, 2); }
    R.light.shadeAt(iA, fx, fy, _e1); R.light.shadeAt(iB, fx, fy, _e2);
    out[0] = _e1[0] + (_e2[0] - _e1[0]) * fr; out[1] = _e1[1] + (_e2[1] - _e1[1]) * fr; out[2] = _e1[2] + (_e2[2] - _e1[2]) * fr;
    return out;
  }
  function needQuad(sh, x, y) {
    // compara com a grade atrás (a parte alta cobre tiles mais ao fundo)
    R.light.gridAt(x - 1, y - 1, _g); R.light.gridAt(x - 2, y - 2, _g2);
    const d1 = Math.max(Math.abs(sh[0] - _g[0]), Math.abs(sh[1] - _g[1]), Math.abs(sh[2] - _g[2]));
    const d2 = Math.max(Math.abs(sh[0] - _g2[0]), Math.abs(sh[1] - _g2[1]), Math.abs(sh[2] - _g2[2]));
    return d1 > 0.05 || d2 > 0.05;
  }
  // copas: a copa cobre tiles 2–5 atrás na tela
  function needQuadTall(sh, x, y) {
    for (let k = 2; k <= 5; k++) {
      R.light.gridAt(x - k, y - k, _g);
      if (Math.max(Math.abs(sh[0] - _g[0]), Math.abs(sh[1] - _g[1]), Math.abs(sh[2] - _g[2])) > 0.05) return true;
    }
    return false;
  }
  // parâmetros da parede em desenho (evita closures por parede)
  let wI = 0, wX = 0, wY = 0, wHp = 0, wXr = false, wKeep = false, wVis = null, wEnv = null;
  function wallFace(ax, ay, bx, by, q, fx, fy, nx, ny) {
    const axisX = ny !== 0;
    const pa = axisX ? ax : ay, pb = axisX ? bx : by;
    const pm = (pa + pb) / 2;
    faceSample(wI, axisX, pa, fx, fy, _s0); faceSample(wI, axisX, pm, fx, fy, _s1); faceSample(wI, axisX, pb, fx, fy, _s2);
    const m = curMap;
    const exterior = !m.building[R.ground.qsrc(wI, q)];
    let kA = 1;
    // face externa: contra o sol mais escura; de frente para ele mais clara (e quente ao entardecer)
    if (wEnv.sunA > 0.02 && exterior) {
      const toSun = -(nx * wEnv.sunX + ny * wEnv.sunY); // 1 = de frente para o sol
      kA = 1 - wEnv.sunA * 1.3 * (1 - Math.max(0, toSun)) + wEnv.sunA * 0.5 * Math.max(0, toSun) * Math.min(1, wEnv.sunLen / 2);
      if (wEnv.warm > 0.05 && toSun > 0.2 && !wXr) sunFaces.push(ax, ay, bx, by, wHp, wEnv.warm * toSun);
    }
    const uniform = Math.abs(_s0[0] - _s2[0]) + Math.abs(_s0[1] - _s2[1]) + Math.abs(_s0[2] - _s2[2]) + Math.abs(_s0[0] - _s1[0]) + Math.abs(_s0[1] - _s1[1]) + Math.abs(_s0[2] - _s1[2]) < 0.03 * lod;
    if (uniform) {
      const r = (_s0[0] + _s2[0]) * 0.5 * kA, g = (_s0[1] + _s2[1]) * 0.5 * kA, b = (_s0[2] + _s2[2]) * 0.5 * kA;
      // mesma luz da grade que a face cobre na tela (o próprio tile e 1–2 atrás)? então não precisa de op
      if (!wXr && !wKeep && sameAsGrid(r, g, b)) return;
      faceQuad(ax, ay, bx, by, axisX, r, g, b);
    } else {
      // dois pedaços de cor única (média das pontas) — sem gradiente
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      faceQuad(ax, ay, mx, my, axisX, (_s0[0] + _s1[0]) * 0.5 * kA, (_s0[1] + _s1[1]) * 0.5 * kA, (_s0[2] + _s1[2]) * 0.5 * kA);
      faceQuad(mx, my, bx, by, axisX, (_s1[0] + _s2[0]) * 0.5 * kA, (_s1[1] + _s2[1]) * 0.5 * kA, (_s1[2] + _s2[2]) * 0.5 * kA);
    }
  }
  let lod = 1; // tolerância das ops de luz de parede (maior em zoom baixo: menos ops, diferença invisível)
  function sameAsGrid(r, g, b) {
    for (let k = 0; k <= 2; k++) {
      R.light.gridAt(wX - k, wY - k, _g);
      if (Math.abs(r - _g[0]) > 0.035 * lod || Math.abs(g - _g[1]) > 0.035 * lod || Math.abs(b - _g[2]) > 0.035 * lod) return false;
    }
    return true;
  }
  // face vertical de cor única; se continua a face anterior (mesma linha, mesma cor), só a estende
  let lfOp = -1, lfAxis = false, lfLine = 0, lfEnd = 0, lfHp = 0, lfXr = false, lfKeep = false, lfR = 0, lfG = 0, lfB = 0;
  function faceQuad(ax, ay, bx, by, axisX, r, g, b) {
    const line = axisX ? ay : ax, p0 = axisX ? ax : ay, p1 = axisX ? bx : by;
    if (lfOp === qN - 1 && lfOp >= 0 && lfAxis === axisX && Math.abs(lfLine - line) < 1e-6 && Math.abs(lfEnd - p0) < 1e-6 && lfHp === wHp && lfXr === wXr && lfKeep === wKeep &&
      Math.abs(lfR - r) < 0.012 * lod && Math.abs(lfG - g) < 0.012 * lod && Math.abs(lfB - b) < 0.012 * lod) {
      const st = QS[lfOp];
      const B0 = (bx - by) * 32, B1 = (bx + by) * 16;
      QP[st + 2] = B0; QP[st + 3] = B1 + 1; QP[st + 4] = B0; QP[st + 5] = B1 - wHp;
      lfEnd = p1;
      return;
    }
    const A0 = (ax - ay) * 32, A1 = (ax + ay) * 16, B0 = (bx - by) * 32, B1 = (bx + by) * 16;
    _pt[0] = A0; _pt[1] = A1 + 1; _pt[2] = B0; _pt[3] = B1 + 1; _pt[4] = B0; _pt[5] = B1 - wHp; _pt[6] = A0; _pt[7] = A1 - wHp;
    if (!opPoly(_pt, 4, r, g, b, 1, wXr)) return;
    if (wKeep) keepSat();
    lfOp = qN - 1; lfAxis = axisX; lfLine = line; lfEnd = p1; lfHp = wHp; lfXr = wXr; lfKeep = wKeep; lfR = r; lfG = g; lfB = b;
  }
  let dwSprA = null, dwSprB = null, dwX = 0, dwY = 0, dwC = 0;
  function drawWallSprites(g, a) {
    // sempre a versão recortada por baixo; a inteira por cima com alfa (1 − c): sem "fantasma"
    if (dwSprB && dwC > 0.02) { g.globalAlpha = a; g.drawImage(dwSprB.c, dwX - dwSprB.L, dwY - dwSprB.TOP, dwSprB.w, dwSprB.h); }
    if (dwSprA && dwC < 0.98) { g.globalAlpha = a * (dwSprB && dwC > 0.02 ? 1 - dwC : 1); g.drawImage(dwSprA.c, dwX - dwSprA.L, dwY - dwSprA.TOP, dwSprA.w, dwSprA.h); }
    g.globalAlpha = 1;
  }
  function drawWall(s, i, env) {
    const m = s.map;
    const x = i % m.w, y = (i / m.w) | 0;
    const wv = m.wall[i];
    const fence = R.walls.isFence(wv);
    const c = fence ? 0 : cutArr[i];
    const lit = (wv === W.WINDOW || wv === W.GLASS) && env.night > 0.15 && R.light.windowLit(i);
    const X = (x - y) * 32, Y = (x + y) * 16;
    dwSprA = c < 0.98 ? R.walls.sprite(i, 0, lit) : null;
    dwSprB = c > 0.02 ? R.walls.sprite(i, 1, false) : null;
    dwX = X; dwY = Y; dwC = c;
    const ref = dwSprA || dwSprB;
    // raio-X: parede alta na frente do jogador, tapando-o
    wXr = false;
    if (ref && afterPlayer && xr.str > 0.01 && !fence && c < 0.5 && coversPlayer(X - ref.L, Y - ref.TOP, ref.w, ref.h)) { wXr = true; xr.occ = true; }
    else if (ref && afterPlayer && !fence && c < 0.5 && coversPlayer(X - ref.L, Y - ref.TOP, ref.w, ref.h * 0.8)) xr.occ = true;
    if (wXr) xrDraw(ctx, drawWallSprites); else drawWallSprites(ctx, 1);
    // faces de luz por meia-parede
    const mk = m.wallMask[i];
    const h = fence ? (wv === W.FENCE_METAL ? 1.55 : 1.35) : R.WALL_M * (1 - c) + R.walls.CUT_M * c;
    wI = i; wX = x; wY = y; wHp = h * ZPX + 3; wEnv = env;
    wVis = opts.fov ? R.light.vis() : null;
    wKeep = !!(wVis && !wXr && wVis[R.ground.qsrc(i, 3)] > 0.5 && behindHidden(wVis, x, y, 2));
    const t2 = 0.08, cx = x + 0.5, cy = y + 0.5;
    if (!mk) wallFace(cx - t2, cy + t2, cx + t2, cy + t2, 3, cx, cy + 0.3, 0, 1);
    if (mk & 1) wallFace(cx + t2, y, cx + t2, cy, 1, cx + 0.3, y + 0.25, 1, 0);
    if (mk & 8) wallFace(x, cy + t2, cx, cy + t2, 2, x + 0.25, cy + 0.3, 0, 1);
    if (mk & 2) wallFace(cx - t2, cy + t2, x + 1, cy + t2, 3, x + 0.75, cy + 0.3, 0, 1);
    if (mk & 4) wallFace(cx + t2, cy - t2, cx + t2, y + 1, 3, cx + 0.3, y + 0.75, 1, 0);
    if (wv === W.WINDOW || wv === W.GLASS) windowExtras(i, x, y, wv, c, lit, env);
  }
  // janelas: vidro aceso (luz própria) e "retângulos" de luz no chão (à noite para fora; de dia, sol para dentro)
  function windowExtras(i, x, y, wv, c, lit, env) {
    const ax = R.walls.axisOf(i);
    const glass = wv === W.GLASS;
    const o0 = glass ? 0.05 : 0.2, o1 = glass ? 0.95 : 0.8, z0 = glass ? 0.3 : 0.85, z1 = glass ? 2.15 : 2.0;
    const cx = x + 0.5, cy = y + 0.5;
    let a0x, a0y, b0x, b0y;
    if (ax === 'x') { a0x = x + o0; a0y = cy; b0x = x + o1; b0y = cy; } else { a0x = cx; a0y = y + o0; b0x = cx; b0y = y + o1; }
    if (lit && c < 0.5) {
      const A0 = (a0x - a0y) * 32, A1 = (a0x + a0y) * 16, B0 = (b0x - b0y) * 32, B1 = (b0x + b0y) * 16;
      _pt[0] = A0; _pt[1] = A1 - z0 * ZPX; _pt[2] = B0; _pt[3] = B1 - z0 * ZPX; _pt[4] = B0; _pt[5] = B1 - z1 * ZPX; _pt[6] = A0; _pt[7] = A1 - z1 * ZPX;
      opPoly(_pt, 4, 1.25, 1.1, 0.85, 1, wXr);
    }
    const m = curMap;
    const st = m.wallState[i];
    const blocked = (st & G.WS.CURTAIN) || ((st & G.WS.BARRICADE_MASK) >> G.WS.BARRICADE_SHIFT) >= 3;
    // lado de fora: normal (em mundo) apontando para o quarto-fonte externo
    let nx = 0, ny = 0;
    for (let q = 0; q < 4; q++) { const src = R.ground.qsrc(i, q); if (!m.building[src]) { nx += (src % m.w) - x; ny += ((src / m.w) | 0) - y; } }
    if (ax === 'x') { nx = 0; ny = ny > 0 ? 1 : ny < 0 ? -1 : 0; } else { ny = 0; nx = nx > 0 ? 1 : nx < 0 ? -1 : 0; }
    if (!nx && !ny) return;
    if (lit && env.night > 0.2 && winPatches.length < 240) {
      // noite: luz quente saindo pela janela e deitando no chão lá fora
      const k = env.night * (blocked ? 0.16 : 0.42);
      winPatches.push(a0x + nx * 0.08, a0y + ny * 0.08, b0x - a0x, b0y - a0y, nx * 1.7, ny * 1.7, k, 1);
    } else if (!blocked && env.sunA > 0.04 && env.night < 0.5 && winPatches.length < 240) {
      // dia: sol entrando pela janela do lado ensolarado (só visível com o telhado escondido)
      const b = m.building[i];
      if (!b || roofA[b] > 0.5) return;
      if (nx * env.sunX + ny * env.sunY >= -0.05) return; // janela não está voltada para o sol
      const L = Math.min(env.sunLen, 2.2);
      const near = z0 * L * 0.5, far = Math.min(3, z1 * L * 0.6);
      const k = (env.sunA / 0.32) * 0.38 * (1 - env.night);
      winPatches.push(a0x + env.sunX * near, a0y + env.sunY * near, b0x - a0x, b0y - a0y, env.sunX * (far - near), env.sunY * (far - near), k, 0);
    }
  }

  // Objeto (uma fatia): sprite + máscara de luz exata (alfa do próprio sprite)
  const THIN = { lamp_post: 1, clothesline: 1, swing: 1, mailbox: 1 };
  let doSpr = null, doL = 0, doT = 0, doX0 = 0, doX1 = 0, doSway = 0, doBase = 0;
  // balanço ao vento sem transformação afim (lenta): faixas horizontais deslocadas
  function swayBands(g, c, sx, sw, dx, dw, top, h, sway, baseY, S) {
    const nb = Math.max(3, Math.round(h / 44));
    const bh = h / nb;
    for (let b = 0; b < nb; b++) {
      const y0 = top + b * bh;
      const off = -sway * (y0 + bh * 0.5 - baseY);
      g.drawImage(c, sx, b * bh * S, sw, bh * S + (b < nb - 1 ? S : 0), dx + off, y0, dw, bh + (b < nb - 1 ? 1 : 0));
    }
  }
  function drawObjSprite(g, a) {
    const S = R.S;
    const spr = doSpr;
    g.globalAlpha = a;
    const full = doX0 === doL && doX1 === doL + spr.w;
    if (doSway) swayBands(g, spr.c, (doX0 - doL) * S, (doX1 - doX0) * S, doX0, doX1 - doX0, doT, spr.h, doSway, doBase, S);
    else if (full) g.drawImage(spr.c, doL, doT, spr.w, spr.h);
    else g.drawImage(spr.c, (doX0 - doL) * S, 0, (doX1 - doX0) * S, spr.h * S, doX0, doT, doX1 - doX0, spr.h);
    g.globalAlpha = 1;
  }
  function drawObj(s, o, sx0, sx1, dt) {
    const env = R.light.env;
    const lit = R.light.lightOn(o, s) && env.night > 0.15;
    const spr = R.objects.sprite(o, lit);
    if (!spr) return;
    const snap = R.objects.snap(o);
    const wx = o.x + snap[0], wy = o.y + snap[1];
    const AX = (wx - wy) * 32, AY = (wx + wy) * 16;
    const left = AX - spr.L, top = AY - spr.TOP;
    const X0 = Math.max(left, sx0), X1 = Math.min(left + spr.w, sx1);
    if (X1 <= X0) return;
    if (X1 < view.X0 || X0 > view.X1 || top > view.Y1 || top + spr.h < view.Y0) return;
    const def = R.objects.def(o.type);
    const tree = o.type === 'tree' || o.type === 'pine';
    doSpr = spr; doL = left; doT = top; doX0 = X0; doX1 = X1;
    doSway = tree || o.type === 'bush' || o.type === 'clothesline' ? swayOf(o, env) : 0;
    doBase = AY + (o.w + o.h) * 8;
    // raio-X: objeto alto na frente do jogador, tapando-o
    let xro = false, xrc = false;
    if (afterPlayer && (def.h > 2.3 || tree) && coversPlayer(X0, top, X1 - X0, spr.h * 0.85)) { xr.occ = true; xro = xr.str > 0.01; }
    else if (tree && cur.on && o.x + o.y + 1 > cur.D + 0.6 && cur.X > X0 + 6 && cur.X < X1 - 6 && cur.Y > top + 6 && cur.Y < top + spr.h * 0.8) { cur.occ = true; xrc = cur.str > 0.01; }
    if (xro) xrDraw(ctx, drawObjSprite); else if (xrc) xrDraw(ctx, drawObjSprite, 0, cur); else drawObjSprite(ctx, 1);
    // máscara de luz: objetos com altura relevante cuja luz difere do chão atrás (copas: sempre)
    if (def.h > 0.9 && !THIN[o.type]) {
      const cx = Math.floor(o.x + o.w / 2), cy = Math.floor(o.y + o.h / 2);
      const i = cy * s.map.w + cx;
      const sh = tree ? R.light.shadeAtBest(cx, cy, 1, o.x + 0.5, o.y + 0.5, _s) : R.light.shadeAt(i, o.x + o.w / 2 + 0.3, o.y + o.h / 2 + 0.3, _s);
      if (tree ? needQuadTall(sh, o.x + 0.5, o.y + 0.5) : needQuad(sh, o.x + o.w / 2, o.y + o.h / 2)) {
        const S = R.S;
        opMask(spr.c, (X0 - left) * S, 0, (X1 - X0) * S, spr.h * S, X0, top, X1 - X0, spr.h, doSway, doBase, sh[0], sh[1], sh[2], 1, xro ? 1 : xrc ? 2 : 0);
        if (!tree && !xro && opts.fov && def.h > 1.2 && visNear(cx, cy, 1) > 0.5 && behindHidden(R.light.vis(), cx, cy, Math.min(5, Math.ceil(def.h * 0.8)))) keepSat();
      }
      if (def.h > 3 && sx0 === -1e9) tallFront.push(o);
    }
  }
  function swayOf(o, env) {
    const h = R.hash(o.id, 7, 7);
    const k = o.type === 'bush' ? 0.012 : 0.03;
    return (Math.sin(env.t * (1.1 + h * 0.6) + h * 30) * 0.6 + Math.sin(env.t * 2.7 + h * 11) * 0.25 + 0.5) * env.wind * k;
  }

  // Parapeito de ponte (sprite por lado e escala)
  const railSpr = new Map();
  function railSprite(side) {
    const S = R.S, key = side + '|' + S;
    let c = railSpr.get(key);
    if (c) return c;
    const cv = R.canvas(72 * S, 68 * S), g = cv.getContext('2d', { willReadFrequently: true });
    g.setTransform(S, 0, 0, S, 36 * S, 34 * S);
    // parapeito ao longo da borda do tile (0,0)-(1,1): N (y=0.06), E (x=0.94), S (y=0.94), W (x=0.06)
    const H = 0.95;
    const P = (x, y, z) => [(x - y) * 32, (x + y) * 16 - z * ZPX];
    const along = side === 0 || side === 2;
    const c0 = side === 0 ? 0.08 : side === 2 ? 0.92 : side === 3 ? 0.08 : 0.92;
    const at = (s2, z) => (along ? P(s2, c0, z) : P(c0, s2, z));
    // mureta baixa + corrimão + pilaretes
    const face = side === 2 || side === 1;
    g.fillStyle = face ? '#a19d94' : '#8e8a82';
    let a = at(0, 0), b = at(1, 0), cc = at(1, 0.35), d = at(0, 0.35);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(cc[0], cc[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill();
    g.fillStyle = '#c4c0b6';
    a = at(0, 0.35); b = at(1, 0.35);
    g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]) - 1, Math.abs(b[0] - a[0]) + 0.5, Math.abs(b[1] - a[1]) + 2);
    g.strokeStyle = '#7c7f82'; g.lineWidth = 1.4; g.lineCap = 'round';
    for (let s2 = 0.12; s2 < 1; s2 += 0.25) { const p0 = at(s2, 0.35), p1 = at(s2, H); g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke(); }
    g.strokeStyle = '#9ea2a5'; g.lineWidth = 2;
    a = at(-0.02, H); b = at(1.02, H);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    g.strokeStyle = 'rgba(230,232,234,0.6)'; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(a[0], a[1] - 1); g.lineTo(b[0], b[1] - 1); g.stroke();
    c = { c: cv, L: 36, TOP: 34, w: 72, h: 68 };
    railSpr.set(key, c);
    return c;
  }
  function drawRail(s, k, side) {
    const x = bridgeRails[k], y = bridgeRails[k + 1];
    const spr = railSprite(side);
    const X = (x - y) * 32, Y = (x + y) * 16;
    ctx.drawImage(spr.c, X - spr.L, Y - spr.TOP, spr.w, spr.h);
    const i = y * s.map.w + x;
    const sh = R.light.shadeAt(i, x + 0.5, y + 0.5, _s);
    const S = R.S;
    opMask(spr.c, 0, 0, spr.w * S, spr.h * S, X - spr.L, Y - spr.TOP, spr.w, spr.h, 0, 0, sh[0], sh[1], sh[2], 1, false);
  }

  // Letreiro de loja na fachada (sprite por prédio): placa + nome, com desgaste
  function signSprite(sg) {
    const S = R.S;
    if (sg.spr && sg.S === S) return sg.spr;
    const b = sg.b;
    const L = sg.s1 - sg.s0, z0 = 2.08, z1 = 2.56;
    // retângulo em px isométricos relativo ao ponto (s0, c, 0) no plano da fachada
    const u = sg.ax === 'x' ? [32, 16] : [-32, 16];
    const w = Math.abs(u[0]) * L + 8, h = Math.abs(u[1]) * L + (z1 + 0.3) * ZPX + 8;
    const cv = R.canvas(w * S, h * S), g = cv.getContext('2d', { willReadFrequently: true });
    const ox = u[0] > 0 ? 4 : w - 4, oy = h - 4 - Math.max(0, u[1] * L);
    g.setTransform(S * u[0], S * u[1], 0, -S * ZPX, ox * S, oy * S);
    // fachada leste: +y corre para a esquerda na tela — espelha o eixo para o texto ler da esquerda p/ direita
    if (sg.ax === 'y') { g.translate(L, 0); g.scale(-1, 1); }
    const rng = U.rng(b.id * 131 + 7);
    const PAL = { pharmacy: ['#2f5a3e', '#e8eadc'], diner: ['#8a2a24', '#f2e6c8'], gas_station: ['#a23a2e', '#f4f0e6'], police: ['#23324a', '#e8e6de'], clinic: ['#e6e4dc', '#2a4a7a'], motel: ['#3a2e4a', '#f0c860'], church: ['#e8e4d8', '#3a3430'] };
    const pal = PAL[b.type] || [['#2a2e32', '#e8dcc0'], ['#5a3a2a', '#f0e6d0'], ['#e2ddd0', '#3a3a3a'], ['#34463a', '#e8e4d0']][(rng() * 4) | 0];
    const tilt = (rng() - 0.5) * 0.05;
    g.save(); g.translate(L / 2, (z0 + z1) / 2); g.rotate(tilt); g.translate(-L / 2, -(z0 + z1) / 2);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0.06, z0 - 0.05, L, z1 - z0);
    g.fillStyle = pal[0]; g.fillRect(0, z0, L, z1 - z0);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.03; g.strokeRect(0.02, z0 + 0.02, L - 0.04, z1 - z0 - 0.04);
    // texto (desbotado, algumas letras caídas)
    let text = b.name.toUpperCase();
    if (text.length > 26) text = text.slice(0, 26);
    let t2 = '';
    let drops = rng() < 0.5 ? 1 : 0; // no máximo uma letra caída, nunca nas pontas
    for (let k = 0; k < text.length; k++) {
      const drop = drops && k > 0 && k < text.length - 1 && text[k] !== ' ' && text[k - 1] !== ' ' && text[k + 1] !== ' ' && rng() < 0.12;
      if (drop) drops--;
      t2 += drop ? ' ' : text[k];
    }
    g.save();
    g.translate(L / 2, (z0 + z1) / 2 - 0.11);
    g.scale(1, -1);
    const fs = Math.min(0.3, (L - 0.3) / Math.max(4, t2.length) * 1.55);
    g.font = 'bold ' + fs.toFixed(3) + 'px Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = pal[1];
    g.fillText(t2, 0, 0, L - 0.2);
    g.restore();
    // ferrugem/sujeira
    for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(90,60,30,' + (0.1 + rng() * 0.2).toFixed(2) + ')'; g.fillRect(rng() * L, z0 + rng() * (z1 - z0) * 0.3, 0.05 + rng() * 0.15, 0.02 + rng() * 0.08); }
    g.restore();
    const X0 = sg.ax === 'x' ? (sg.s0 - sg.c) * 32 : (sg.c - sg.s0) * 32, Y0 = sg.ax === 'x' ? (sg.s0 + sg.c) * 16 : (sg.c + sg.s0) * 16;
    sg.spr = { c: cv, x: X0 - ox, y: Y0 - oy, w, h };
    sg.S = S;
    return sg.spr;
  }
  function drawSign(s, sg) {
    const spr = signSprite(sg);
    ctx.drawImage(spr.c, spr.x, spr.y, spr.w, spr.h);
    const i = sg.ty * s.map.w + sg.tx;
    const q = R.ground.qsrc(i, 3);
    const sh = R.light.shadeAt(q >= 0 ? q : i, sg.tx + 0.5, sg.ty + 0.9, _s);
    const S = R.S;
    opMask(spr.c, 0, 0, spr.w * S, spr.h * S, spr.x, spr.y, spr.w, spr.h, 0, 0, sh[0], sh[1], sh[2], 1, false);
  }

  // Atores
  function actorShade(x, y, sh, visible) {
    // jogador/zumbis à vista no escuro: brilho mínimo frio (luar) — legíveis, coerentes com canSee
    const e = R.light.env, am = TUNE.actorMin;
    if (visible && e.night > 0.05) {
      const k = e.night;
      if (sh[0] < am[0] * k) sh[0] = am[0] * k;
      if (sh[1] < am[1] * k) sh[1] = am[1] * k;
      if (sh[2] < am[2] * k) sh[2] = am[2] * k;
    }
    return sh;
  }
  const rimList = [];
  function drawZombie(zz, a, dt, env) {
    const spr = R.actors.zombieSprite(zz, dt);
    const X = (zz.x - zz.y) * 32, Y = (zz.x + zz.y) * 16;
    const i = Math.floor(zz.y) * curMap.w + Math.floor(zz.x);
    const sh = actorShade(zz.x, zz.y, R.light.shadeAt(i, zz.x, zz.y, _s), a > 0.5);
    if (spr) {
      if (a < 1) ctx.globalAlpha = a;
      ctx.drawImage(spr.c, X - spr.ax, Y - spr.ay, spr.w, spr.h);
      ctx.globalAlpha = 1;
      const S = R.S;
      opMask(spr.c, 0, 0, spr.w * S, spr.h * S, X - spr.ax, Y - spr.ay, spr.w, spr.h, 0, 0, sh[0], sh[1], sh[2], a, false);
      if (env.night > 0.3 && a > 0.5) rimList.push(spr, X - spr.ax, Y - spr.ay, a);
    } else {
      if (a < 1) ctx.globalAlpha = a;
      R.actors.drawZombie(ctx, zz, 0);
      ctx.globalAlpha = 1;
      const L = R.actors.last;
      if (L && L.P) opActor(zz.x, zz.y, L.dir, L.P, L.lk, sh[0], sh[1], sh[2], a);
    }
    if (a > 0.5 && opts.fov && behindHidden(R.light.vis(), Math.floor(zz.x), Math.floor(zz.y), 2)) keepSat();
  }
  function drawPlayer(s, p, dt) {
    R.actors.drawPlayer(ctx, p, dt, s);
    const i = Math.floor(p.y) * curMap.w + Math.floor(p.x);
    const sh = actorShade(p.x, p.y, R.light.shadeAt(i, p.x, p.y, _s), true);
    const L = R.actors.last;
    if (L && L.P) opActor(p.x, p.y, L.dir, L.P, L.lk, sh[0], sh[1], sh[2], 1);
    if (opts.fov && behindHidden(R.light.vis(), Math.floor(p.x), Math.floor(p.y), 2)) keepSat();
  }

  // ------------------------------------------------------------------
  // Telhados + objetos altos na frente deles
  // ------------------------------------------------------------------
  function roofShade(rf, out) {
    const m = curMap, b = rf.b, vis = R.light.vis();
    let v = 0;
    if (vis) {
      for (let k = 0; k <= 4; k++) {
        const pts = [b.x + b.w * k / 4, b.y + b.h + 0.5, b.x + b.w + 0.5, b.y + b.h * k / 4, b.x + b.w * k / 4, b.y - 1, b.x - 1, b.y + b.h * k / 4];
        for (let j = 0; j < 8; j += 2) {
          const x = Math.floor(pts[j]), y = Math.floor(pts[j + 1]);
          if (x >= 0 && y >= 0 && x < m.w && y < m.h && vis[y * m.w + x] > v) v = vis[y * m.w + x];
        }
      }
    }
    const e = R.light.env;
    const moon = 0.045 * e.night;
    // à noite o telhado (cor única) fica menos azul que o chão: mistura parcial com a luminância
    const lum = e.amb[0] * 0.3 + e.amb[1] * 0.59 + e.amb[2] * 0.11, dz = 0.45 * e.night;
    out[0] = e.amb[0] + (lum - e.amb[0]) * dz + e.flash * 0.9 + moon * 0.75;
    out[1] = e.amb[1] + (lum - e.amb[1]) * dz + e.flash * 0.9 + moon * 0.85;
    out[2] = e.amb[2] + (lum - e.amb[2]) * dz + e.flash + moon;
    if (opts.fov && vis) {
      const mk = U.lerp(TUNE.mem.day, TUNE.mem.night, e.night);
      const k = mk + (1 - mk) * v;
      out[0] *= k; out[1] *= k; out[2] *= k;
    }
    out.v = v;
    return out;
  }
  let drRf = null, drAlpha = 1;
  function drawRoofSpr(g, a) {
    const spr = R.walls.roofSprite(drRf);
    if (spr) { g.globalAlpha = drAlpha * a; g.drawImage(spr.c, spr.x, spr.y, spr.w, spr.h); g.globalAlpha = 1; }
    else R.walls.drawRoof(g, drRf, drAlpha * a);
  }
  function drawRoofs(s) {
    roofList.length = 0;
    for (const rf of R.walls.roofs) {
      if (roofA[rf.b.id] <= 0.01) continue;
      R.walls.roofBounds(rf);
      if (rf.x1 < view.X0 || rf.x0 > view.X1 || rf.y1 < view.Y0 || rf.y0 > view.Y1) continue;
      roofList.push(rf);
    }
    roofList.sort((p, q) => p.key - q.key);
    for (const rf of roofList) {
      drRf = rf; drAlpha = roofA[rf.b.id];
      const xro = rf.b.id === xr.roof && xr.str > 0.01;
      if (xro) xrDraw(ctx, drawRoofSpr); else drawRoofSpr(ctx, 1);
      const sh = roofShade(rf, _s);
      opPoly(rf.hull, rf.hull.length >> 1, sh[0], sh[1], sh[2], drAlpha, xro);
      if (opts.fov && !xro && sh.v > 0.5) keepSat();
    }
    // árvores/postes altos na frente de um telhado: redesenha recortado ao contorno do telhado
    for (const o of tallFront) {
      const snapx = o.x + o.w, snapy = o.y + o.h;
      for (const rf of roofList) {
        const b = rf.b;
        if (!(snapx - 0.5 >= b.x + b.w || snapy - 0.5 >= b.y + b.h)) continue; // não está na frente
        const ddx = Math.max(0, b.x - snapx, o.x - (b.x + b.w)), ddy = Math.max(0, b.y - snapy, o.y - (b.y + b.h));
        if (ddx + ddy > 4) continue; // longe demais para a copa alcançar o telhado
        if (roofA[b.id] < 0.05) continue;
        const spr = R.objects.sprite(o, false);
        if (!spr) continue;
        const AX = (o.x - o.y) * 32, AY = (o.x + o.y) * 16;
        const l = AX - spr.L, t = AY - spr.TOP;
        if (l > rf.x1 || l + spr.w < rf.x0 || t > rf.y1 || t + spr.h < rf.y0) continue;
        const h = rf.hull;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(h[0], h[1]); for (let k = 2; k < h.length; k += 2) ctx.lineTo(h[k], h[k + 1]); ctx.closePath(); ctx.clip();
        doSpr = spr; doL = l; doT = t; doX0 = l; doX1 = l + spr.w;
        doSway = o.type === 'tree' || o.type === 'pine' ? swayOf(o, R.light.env) : 0;
        doBase = AY + (o.w + o.h) * 8;
        const xro = xr.str > 0.01 && coversPlayer(l, t, spr.w, spr.h * 0.85);
        if (xro) xrDraw(ctx, drawObjSprite); else drawObjSprite(ctx, 1);
        ctx.restore();
        const sh = R.light.shadeAtBest(Math.floor(o.x), Math.floor(o.y), 1, o.x + 0.8, o.y + 0.8, _s);
        const S = R.S;
        opMask(spr.c, 0, 0, spr.w * S, spr.h * S, l, t, spr.w, spr.h, doSway, doBase, sh[0], sh[1], sh[2], 1, xro);
      }
    }
  }

  // ------------------------------------------------------------------
  // Memória: "névoa" cinza (dessaturação barata) antes do multiply, exceto sobre o que está à vista
  // ------------------------------------------------------------------
  let hazeC = null, hazeX = null;
  function drawMemoryHaze(cam, z) {
    if (!grid || !grid.des) return;
    const w = Math.ceil(Wd / 4), h = Math.ceil(Ht / 4);
    if (!hazeC || hazeC.width !== w || hazeC.height !== h) { hazeC = R.canvas(w, h); hazeX = hazeC.getContext('2d'); }
    const g = hazeX;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.setTransform(z * 0.25, 0, 0, z * 0.25, -cam.ox * 0.25, -cam.oy * 0.25);
    g.drawImage(grid.des, grid.dx, grid.dy, grid.dw, grid.dh);
    if (dqN) {
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      for (let j = 0; j < dqN; j++) {
        const k = DQ[j], kind = QK[k];
        if (kind === OP_POLY) {
          const st = QS[k], n = QL[k];
          const stp = n > 32 ? Math.floor(n / 16) : 1;
          g.beginPath(); g.moveTo(QP[st], QP[st + 1]);
          for (let q = stp; q < n; q += stp) g.lineTo(QP[st + q * 2], QP[st + q * 2 + 1]);
          g.closePath(); g.fill();
        } else if (kind === OP_MASK) {
          const e = QM[k];
          g.drawImage(e.c, e.sx, e.sy, e.sw, e.sh, e.dx, e.dy, e.dw, e.dh);
        } else {
          const e = QM[k];
          R.actors.drawSolid(g, e.x, e.y, e.dir, e.P, e.lk, '#000', 1);
        }
      }
      g.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(hazeC, 0, 0, w * 4, h * 4);
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Mapa de luz: grade + ops (polígonos, máscaras, atores) + janelas + vinheta + grão → multiply
  // ------------------------------------------------------------------
  let shadeC = null, shadeX = null, shW = 0, shH = 0, patchTex = null;
  function patchTexture() {
    if (patchTex) return patchTex;
    patchTex = R.canvas(16, 32);
    const g = patchTex.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 32);
    gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.55, 'rgba(255,204,140,0.55)'); gr.addColorStop(1, 'rgba(255,200,130,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 32);
    return patchTex;
  }
  let apG = null, apK = 0; // op em aplicação (para o raio-X no canvas de luz)
  function applyOp(g, a) {
    const k = apK, kind = QK[k];
    const r = QC[k * 4], gg = QC[k * 4 + 1], b = QC[k * 4 + 2], al = QC[k * 4 + 3] * a;
    if (al <= 0.003) return;
    if (kind === OP_POLY) {
      g.fillStyle = R.rgb01(r, gg, b);
      g.globalAlpha = al;
      const st = QS[k], n = QL[k];
      g.beginPath(); g.moveTo(QP[st], QP[st + 1]);
      for (let j = 1; j < n; j++) g.lineTo(QP[st + j * 2], QP[st + j * 2 + 1]);
      g.closePath(); g.fill();
    } else if (kind === OP_MASK) {
      const e = QM[k];
      g.globalCompositeOperation = 'destination-out'; g.globalAlpha = al;
      if (e.shear) swayBands(g, e.c, e.sx, e.sw, e.dx, e.dw, e.dy, e.dh, e.shear, e.baseY, R.S);
      else g.drawImage(e.c, e.sx, e.sy, e.sw, e.sh, e.dx, e.dy, e.dw, e.dh);
      g.globalCompositeOperation = 'destination-over'; g.globalAlpha = 1;
      g.fillStyle = R.rgb01(r, gg, b);
      g.fillRect(e.dx - (e.shear ? 12 : 0), e.dy, e.dw + (e.shear ? 24 : 0), e.dh);
      g.globalCompositeOperation = 'source-over';
    } else {
      const e = QM[k];
      g.globalAlpha = al;
      R.actors.drawSolid(g, e.x, e.y, e.dir, e.P, e.lk, R.rgb01(r, gg, b), 1);
    }
    g.globalAlpha = 1;
  }
  let grainPat = null, grainCtx = null;
  function applyShade(s, cam, z, env) {
    const w = Math.ceil(Wd / 2), h = Math.ceil(Ht / 2);
    if (!shadeC || shW !== w || shH !== h) { shW = w; shH = h; shadeC = R.canvas(w, h); shadeX = shadeC.getContext('2d'); }
    const g = shadeX;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.setTransform(z * 0.5, 0, 0, z * 0.5, -cam.ox * 0.5, -cam.oy * 0.5);
    if (grid) g.drawImage(grid.c, grid.dx, grid.dy, grid.dw, grid.dh);
    sec('shade:grid');
    // luz das janelas (retângulos no chão) — antes das superfícies verticais
    if (winPatches.length) {
      const tex = patchTexture();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < winPatches.length; k += 8) {
        const ox = winPatches[k], oy = winPatches[k + 1], ax = winPatches[k + 2], ay = winPatches[k + 3], bx = winPatches[k + 4], by = winPatches[k + 5];
        const z2 = z * 0.5;
        g.setTransform((ax - ay) * 32 * z2, (ax + ay) * 16 * z2, (bx - by) * 32 * z2, (bx + by) * 16 * z2, (ox - oy) * 32 * z2 - cam.ox * 0.5, (ox + oy) * 16 * z2 - cam.oy * 0.5);
        g.globalAlpha = Math.min(1, winPatches[k + 6]);
        g.drawImage(tex, 0, 0, 1, 1);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.setTransform(z * 0.5, 0, 0, z * 0.5, -cam.ox * 0.5, -cam.oy * 0.5);
    }
    // ops verticais em ordem de desenho
    apG = g;
    for (let k = 0; k < qN; k++) {
      apK = k;
      if (QX[k] === 1 && xr.str > 0.01) xrDraw(g, applyOp); else if (QX[k] === 2 && cur.str > 0.01) xrDraw(g, applyOp, 0, cur); else applyOp(g, 1);
    }
    sec('shade:ops');
    // clarão de tiro ilumina o entorno
    if (muzzleT > 0) {
      const X = (muzzleX - muzzleY) * 32, Y = (muzzleX + muzzleY) * 16 - muzzleZ * ZPX * 0.3;
      g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(X, Y, 0, X, Y, 260);
      const kk = Math.min(1, muzzleT / 0.09);
      gr.addColorStop(0, 'rgba(255,220,160,' + (0.8 * kk) + ')'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr; g.fillRect(X - 260, Y - 260, 520, 520);
      g.globalCompositeOperation = 'source-over';
    }
    // vinheta e grão entram no mesmo multiply (sem passadas extras de tela cheia)
    if (opts.post) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = 0.75 + env.night * 0.25;
      g.drawImage(R.fx.vignette(w, h), 0, 0);
      g.globalAlpha = 1;
      if (!grainPat || grainCtx !== g) { grainPat = g.createPattern(R.fx.grain(), 'repeat'); grainCtx = g; }
      g.setTransform(1, 0, 0, 1, -((Math.random() * 96) | 0), -((Math.random() * 96) | 0));
      g.fillStyle = grainPat; g.fillRect(0, 0, w + 96, h + 96);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shadeC, 0, 0, w * 2, h * 2);
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Emissivos: brilhos aditivos (postes, luminárias, janelas, sirene, máquina, lanterna, sol nas faces)
  // ------------------------------------------------------------------
  const haloCache = new Map();
  function halo(col) {
    let c = haloCache.get(col);
    if (c) return c;
    c = R.canvas(64, 64);
    const g = c.getContext('2d');
    const k = R.hex(col);
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + k[0] + ',' + k[1] + ',' + k[2] + ',1)');
    gr.addColorStop(0.2, 'rgba(' + k[0] + ',' + k[1] + ',' + k[2] + ',0.45)');
    gr.addColorStop(0.55, 'rgba(' + k[0] + ',' + k[1] + ',' + k[2] + ',0.1)');
    gr.addColorStop(1, 'rgba(' + k[0] + ',' + k[1] + ',' + k[2] + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    haloCache.set(col, c);
    return c;
  }
  let beamTex = null;
  function beamTexture() {
    if (beamTex) return beamTex;
    beamTex = R.canvas(64, 64);
    const g = beamTex.getContext('2d');
    // cone ao longo de +x: brilho que some com a distância e nas bordas
    const img = g.createImageData(64, 64), d = img.data;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const u = x / 63, v = (y - 31.5) / 31.5;
      const half = 0.1 + u * 0.9;
      const edge = Math.max(0, 1 - Math.abs(v) / half);
      const a = Math.pow(edge, 1.6) * Math.pow(1 - u, 1.3) * Math.min(1, u * 6);
      const p = (y * 64 + x) * 4;
      d[p] = 255; d[p + 1] = 240; d[p + 2] = 205; d[p + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    return beamTex;
  }
  const emis = [];
  function drawEmissive(s, env) {
    emis.length = 0;
    const m = s.map;
    const night = env.night;
    const day = Math.floor(s.time / 1440);
    for (let k = 0; k < nList; k++) {
      const e = pool[k];
      if (e.kind !== K_OBJ || e.a !== -1e9) continue;
      const o = e.ref;
      const X = (o.x - o.y) * 32, Y = (o.x + o.y) * 16;
      if (R.light.lightOn(o, s) && night > 0.12) {
        // dentro de prédio com telhado: só se o telhado sumiu
        if (o.building && roofA[o.building] > 0.5) continue;
        const spr = R.objects.sprite(o, true);
        const L = (spr && spr.light) || [o.w / 2, o.h / 2, 1.2];
        const snap = R.objects.snap(o);
        const lx = X + (L[0] - L[1] + snap[0] - snap[1]) * 32, ly = Y + (L[0] + L[1] + snap[0] + snap[1]) * 16 - L[2] * ZPX;
        const big = o.type === 'lamp_post' ? 1 : o.type === 'lamp' ? 0.7 : 0.5;
        if (occludedByRoof(lx, ly, o.x + o.w, o.y + o.h)) continue;
        emis.push(lx, ly, big * night, o.type === 'vending_machine' ? 1 : 0);
      }
      if (o.type === 'police_car' && day < 3 && (o.variant % 3 === 0 || o.wrecked)) {
        const ph = Math.floor(s.realTime * 3) % 2;
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        emis.push((cx - cy) * 32, (cx + cy) * 16 - 1.5 * ZPX, 0.35 + night * 0.65, ph ? 2 : 3);
      }
    }
    // luminárias de varanda acesas (face visível da porta)
    if (night > 0.12 && s.power) {
      const T2 = R.walls.T2;
      for (let k = 0; k < wallT.length; k++) {
        const i = wallT[k];
        if (m.wall[i] !== W.DOOR || cutArr[i] > 0.5) continue;
        const en = R.ground.entry(i);
        if (!en || !(en.ox > 0 || en.oy > 0) || !R.light.porchLit(en)) continue;
        const lx = en.oy ? en.x : en.x + 0.5 + en.ox * (T2 + 0.03), ly = en.ox ? en.y : en.y + 0.5 + en.oy * (T2 + 0.03);
        emis.push((lx - ly) * 32, (lx + ly) * 16 - 1.72 * ZPX, 0.8 * night, 0);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    // sol quente nas faces voltadas para ele (entardecer/amanhecer)
    if (sunFaces.length) {
      const wr = TUNE.warm;
      for (let k = 0; k < sunFaces.length; k += 6) {
        const ax = sunFaces[k], ay = sunFaces[k + 1], bx = sunFaces[k + 2], by = sunFaces[k + 3], hp = sunFaces[k + 4], a = sunFaces[k + 5];
        ctx.fillStyle = R.rgb01(wr[0] / 255 * 0.9, wr[1] / 255 * 0.9, wr[2] / 255 * 0.9);
        ctx.globalAlpha = Math.min(1, a * 0.9);
        const A0 = (ax - ay) * 32, A1 = (ax + ay) * 16, B0 = (bx - by) * 32, B1 = (bx + by) * 16;
        ctx.beginPath(); ctx.moveTo(A0, A1); ctx.lineTo(B0, B1); ctx.lineTo(B0, B1 - hp); ctx.lineTo(A0, A1 - hp); ctx.closePath(); ctx.fill();
      }
    }
    for (let k = 0; k < emis.length; k += 4) {
      const x = emis[k], y = emis[k + 1], a = emis[k + 2], kind = emis[k + 3];
      const img = halo(kind === 1 ? '#a8d8ff' : kind === 2 ? '#ff3020' : kind === 3 ? '#3050ff' : '#ffd08a');
      const r = kind >= 2 ? 26 : 30 + a * 16;
      ctx.globalAlpha = Math.min(1, a * (kind >= 2 ? 0.9 : 0.75));
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
      if (kind === 0) { ctx.globalAlpha = Math.min(1, a); ctx.drawImage(halo('#fff4dc'), x - 5, y - 4, 10, 8); }
    }
    // janelas acesas: brilho suave para fora
    if (night > 0.15 && s.power) {
      ctx.globalAlpha = Math.min(1, night * 0.55);
      const img = halo('#ffc878');
      for (let k = 0; k < wallT.length; k++) {
        const i = wallT[k], wv = m.wall[i];
        if (wv !== W.WINDOW && wv !== W.GLASS) continue;
        if (!R.light.windowLit(i) || cutArr[i] > 0.5) continue;
        const wb = m.building[i];
        if (wb && roofA[wb] > 0.5 && m.building[R.ground.qsrc(i, 3)] === wb) continue; // janela dos fundos, escondida pelo telhado
        const x = i % m.w, y = (i / m.w) | 0;
        ctx.drawImage(img, (x - y) * 32 - 26, (x + y + 1) * 16 - 1.45 * ZPX - 22, 52, 44);
      }
    }
    // zumbis à vista no escuro: leve contorno frio (luar)
    if (rimList.length) {
      for (let k = 0; k < rimList.length; k += 4) {
        const spr = rimList[k];
        ctx.globalAlpha = 0.16 * night * rimList[k + 3];
        ctx.drawImage(spr.c, rimList[k + 1] - 1, rimList[k + 2] - 1, spr.w, spr.h);
      }
      rimList.length = 0;
    }
    // feixe da lanterna: leve brilho no ar (mais forte com neblina/chuva)
    const p = s.player;
    if (p && p.flashlightOn && p.alive !== false && night > 0.2) {
      const d = p.dir || 0, len = TUNE.flash.r * 0.85;
      const ex = Math.cos(d), ey = Math.sin(d);
      const ox = p.x + ex * 0.4, oy = p.y + ey * 0.4;
      const X = (ox - oy) * 32, Y = (ox + oy) * 16 - 1.15 * ZPX;
      const ux = (ex - ey) * 32 * len, uy = (ex + ey) * 16 * len;
      const wv = Math.tan(TUNE.flash.half) * len;
      const vx = (-ey - ex) * 32 * wv, vy = (-ey + ex) * 16 * wv;
      ctx.save();
      ctx.transform(ux, uy, vx, vy, X, Y);
      ctx.globalAlpha = Math.min(0.5, (0.07 + env.fog * 0.2 + env.rain * 0.12) * night);
      ctx.drawImage(beamTexture(), 0, -1, 1, 2);
      ctx.restore();
    }
    // clarão do tiro
    if (muzzleT > 0) {
      const X = (muzzleX - muzzleY) * 32, Y = (muzzleX + muzzleY) * 16 - muzzleZ * ZPX;
      ctx.globalAlpha = Math.min(1, muzzleT / 0.05);
      ctx.drawImage(halo('#ffe0a0'), X - 40, Y - 40, 80, 80);
    }
    R.fx.drawParticles(ctx, s, true);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  // ponto (px isométricos) escondido atrás de um telhado opaco?
  function occludedByRoof(X, Y, ox1, oy1) {
    for (const rf of R.walls.roofs) {
      const b = rf.b;
      if (roofA[b.id] < 0.5) continue;
      if (ox1 - 0.5 >= b.x + b.w || oy1 - 0.5 >= b.y + b.h) continue; // está na frente
      R.walls.roofBounds(rf);
      if (X < rf.x0 || X > rf.x1 || Y < rf.y0 || Y > rf.y1) continue;
      if (pointInPoly(X, Y, rf.hull)) return true;
    }
    return false;
  }
  // halos maiores dentro da neblina (depois dela)
  function drawHalos(env) {
    if (env.fog < 0.1 || !emis.length) return;
    ctx.globalCompositeOperation = 'lighter';
    const img = halo('#ffd08a');
    for (let k = 0; k < emis.length; k += 4) {
      const a = emis[k + 2] * env.fog * 0.6;
      if (a < 0.02 || emis[k + 3] !== 0) continue;
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(img, emis[k] - 90, emis[k + 1] - 72, 180, 144);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  // chuva não cai dentro dos prédios cujo telhado sumiu: volume (chão até a parede) de cada parte
  function rainExclude(s, cam, z) {
    rainPolys.length = 0;
    const HM = R.WALL_M, T2 = R.walls.T2;
    for (const b of s.map.buildings) {
      if (roofA[b.id] > 0.5) continue;
      for (const pt of (b.parts && b.parts.length ? b.parts : [b])) {
        const x0 = pt.x + 0.5 - T2, y0 = pt.y + 0.5 - T2, x1 = pt.x + pt.w - 0.5 + T2, y1 = pt.y + pt.h - 0.5 + T2;
        // hexágono: base W, S, E + topo E, N, W
        const P = [[x0, y1, 0], [x1, y1, 0], [x1, y0, 0], [x1, y0, HM], [x0, y0, HM], [x0, y1, HM]];
        const poly = [];
        for (const q of P) poly.push(((q[0] - q[1]) * 32) * z - cam.ox, ((q[0] + q[1]) * 16 - q[2] * ZPX) * z - cam.oy);
        rainPolys.push(poly);
      }
    }
    return rainPolys.length ? rainPolys : null;
  }

  // Indicadores: tile sob o mouse, mira/alcance
  function drawOverlays(s) {
    const cam = G.camera, z = cam.zoom, I = G.input, p = s.player;
    if (!I || !I.mouse) return;
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    const wx = I.mouse.wx, wy = I.mouse.wy;
    if (wx === wx && wy === wy && s.mode === 'playing' && !(G.ui && G.ui.isCapturingMouse && G.ui.isCapturingMouse())) {
      const tx = Math.floor(wx), ty = Math.floor(wy);
      if (tx >= 0 && ty >= 0 && tx < s.map.w && ty < s.map.h) {
        const X = (tx - ty) * 32, Y = (tx + ty) * 16;
        ctx.strokeStyle = 'rgba(240,236,220,0.28)'; ctx.lineWidth = 1 / z;
        ctx.fillStyle = 'rgba(240,236,220,0.05)';
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + 32, Y + 16); ctx.lineTo(X, Y + 32); ctx.lineTo(X - 32, Y + 16); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    if (p && p.aiming && p.alive !== false) {
      const it = p.equipped && p.equipped.main;
      const d = it && G.items && G.items.def ? G.items.def(it) : null;
      const range = d ? (d.firearm ? d.firearm.range : d.weapon ? d.weapon.range : 1.2) || 1.2 : 1.2;
      const X = (p.x - p.y) * 32, Y = (p.x + p.y) * 16;
      ctx.setLineDash([4 / z, 5 / z]);
      ctx.strokeStyle = 'rgba(230,220,200,0.22)'; ctx.lineWidth = 1 / z;
      ctx.beginPath(); ctx.ellipse(X, Y, range * 45.25, range * 22.63, 0, 0, 6.283); ctx.stroke();
      ctx.setLineDash([]);
      const MX = (wx - wy) * 32, MY = (wx + wy) * 16;
      const dist = Math.hypot(wx - p.x, wy - p.y);
      const inR = dist <= range + 0.3;
      ctx.strokeStyle = inR ? 'rgba(230,90,70,0.7)' : 'rgba(230,220,200,0.45)';
      ctx.beginPath(); ctx.moveTo(X, Y - 42); ctx.lineTo(MX, MY - 12); ctx.stroke();
      ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.arc(MX, MY - 12, 6, 0, 6.283); ctx.moveTo(MX - 10, MY - 12); ctx.lineTo(MX - 4, MY - 12); ctx.moveTo(MX + 4, MY - 12); ctx.lineTo(MX + 10, MY - 12); ctx.moveTo(MX, MY - 22); ctx.lineTo(MX, MY - 16); ctx.moveTo(MX, MY - 8); ctx.lineTo(MX, MY - 2); ctx.stroke();
    }
  }

  function drawDebug(s) {
    const cam = G.camera, z = cam.zoom;
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    const ns = s.noises || [];
    for (const n of ns) {
      if (!n) continue;
      const X = (n.x - n.y) * 32, Y = (n.x + n.y) * 16;
      ctx.strokeStyle = 'rgba(255,200,80,' + Math.max(0, n.life || 0) * 0.5 + ')'; ctx.lineWidth = 1 / z;
      ctx.beginPath(); ctx.ellipse(X, Y, (n.radius || 1) * 45.25, (n.radius || 1) * 22.63, 0, 0, 6.283); ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = s.player || {};
    const e = R.light.env;
    const lines = [
      'FPS ' + RD.fps + '  draw ' + RD.drawMs.toFixed(2) + ' ms  zoom ' + z.toFixed(2) + '  S' + R.S,
      'tile ' + Math.floor(p.x) + ',' + Math.floor(p.y) + '  hora ' + e.hour.toFixed(2) + '  luz ' + (s.light != null ? s.light.toFixed(2) : '?') + '  amb ' + e.lum.toFixed(2) + '  luz no jogador ' + (p.x === p.x ? RD.lightAt(p.x, p.y).toFixed(2) : '-'),
      'zumbis ' + (s.zombies || []).length + '  partículas ' + (s.particles || []).length + '  decals ' + (s.decals || []).length + '  lista ' + nList + '  ops ' + qN,
      'blocos ' + R.ground.stats.chunks + ' (' + R.ground.stats.built + ' feitos, ' + R.ground.stats.missing + ' faltando)  sprites parede ' + R.walls.spriteCount() + '  obj ' + R.objects.cacheSize(),
      'chuva ' + e.rain.toFixed(2) + '  névoa ' + e.fog.toFixed(2) + '  molhado ' + e.wet.toFixed(2) + '  vento ' + e.wind.toFixed(2) + '  energia ' + (s.power ? 'sim' : 'não'),
    ];
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(8, Ht - 18 * lines.length - 14, 620, 18 * lines.length + 8);
    ctx.fillStyle = '#d8e0c8';
    for (let k = 0; k < lines.length; k++) ctx.fillText(lines[k], 14, Ht - 18 * (lines.length - k) - 2);
  }
})();
