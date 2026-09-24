/* =====================================================================
 * VALE QUIETO — render.js  (Etapa 2: Render)
 * Orquestra o quadro: chão em cache → decals/poças/cadáveres/itens →
 * sombras do sol → passe vertical ordenado por profundidade (paredes finas,
 * objetos fatiados por coluna de tela, entidades) com recorte (cutaway) e
 * telhados que somem → mapa de luz (multiply) com FOV/memória → emissivos
 * (postes, janelas acesas, clarão) → neblina, chuva, folhas → correção de
 * cor, vinheta, grão → indicadores (mouse, mira) e depuração.
 * API: G.render.init(canvas), resize(w,h), draw(state, dt), fps.
 * Módulos internos: render-core/ground/walls/objects/actors/light/fx.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, C = G.CONST, W = G.WALL, WS = G.WS, F = G.FLOOR, U = G.util;
  const ZPX = R.ZPX;
  let canvas = null, ctx = null, Wd = 800, Ht = 600;
  let curMap = null;
  let cutArr = null;          // recorte animado por tile (0 inteiro .. 1 baixo)
  let hideW = null, bGlass = null; // paredes internas e prédios com vitrine
  let roofA = null;           // alfa do telhado por prédio
  const objAlpha = new Map(); // translucidez de objetos altos que tapam o jogador
  let stamp = null, stampN = 0;
  let zoomTarget = 1, lastZoomSet = 1;
  let lastFrameT = 0, fpsAcc = 0, fpsN = 0, msAcc = 0;
  let muzzleT = 0, muzzleX = 0, muzzleY = 0, muzzleZ = 1.3;
  const opts = { fov: true, roofs: true, weather: true, post: true, overlays: true, shadows: true, fixedTime: null, satKeep: true };

  const RD = (G.render = { fps: 0, drawMs: 0, opts, stats: {}, sec: {} });
  let secT = 0;
  function sec(name) {
    const t = performance.now();
    if (name) { const d = t - secT; const a = RD.sec[name] || (RD.sec[name] = []); a.push(d); if (a.length > 120) a.shift(); }
    secT = t;
  }

  // ------------------------------------------------------------------
  // Lista de desenho (pool reaproveitado)
  // ------------------------------------------------------------------
  const K_WALL = 0, K_OBJ = 1, K_ZOMBIE = 2, K_PLAYER = 3;
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

  // Quads para o mapa de luz (em px isométricos)
  const QP = new Float32Array(1 << 17);
  const QS = new Int32Array(1 << 14), QL = new Int16Array(1 << 14), QC = new Float32Array((1 << 14) * 4), QG = new Float32Array((1 << 14) * 4);
  let qpN = 0, qN = 0;
  const QA = []; // silhuetas de atores (QL = -1)
  // quads visíveis que NÃO devem herdar a dessaturação da memória do chão atrás deles
  // (telhados, paredes e copas vistas na frente de interiores/áreas não vistas)
  const DQ = new Int32Array(1 << 12);
  let dqN = 0;
  function satKeep() { if (dqN < DQ.length && qN > 0 && opts.satKeep) DQ[dqN++] = qN - 1; }
  function visNear(x, y, r) {
    const vis = R.light.vis(), m = curMap;
    if (!vis) return 1;
    let v = 0;
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
      if (xx >= 0 && yy >= 0 && xx < m.w && yy < m.h && vis[yy * m.w + xx] > v) v = vis[yy * m.w + xx];
    }
    return v;
  }
  // o chão atrás (na tela, acima) de (x,y) está fora da visão?
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
  function actorSil(x, y, dir, P, lk, r, g, b, a) {
    if (qN >= QS.length - 1) return;
    let e = QA[qN];
    if (!e) e = QA[qN] = {};
    e.x = x; e.y = y; e.dir = dir; e.P = P; e.lk = lk; e.w = lk.weapon;
    QS[qN] = 0; QL[qN] = -1;
    QC[qN * 4] = r; QC[qN * 4 + 1] = g; QC[qN * 4 + 2] = b; QC[qN * 4 + 3] = a == null ? 1 : a;
    qN++;
  }
  function quad(pts, n, r, g, b, a) {
    if (qN >= QS.length - 1 || qpN + n * 2 >= QP.length) return;
    QS[qN] = qpN; QL[qN] = n;
    for (let k = 0; k < n * 2; k++) QP[qpN++] = pts[k];
    QC[qN * 4] = r; QC[qN * 4 + 1] = g; QC[qN * 4 + 2] = b; QC[qN * 4 + 3] = a == null ? 1 : a;
    QG[qN * 4 + 3] = 0;
    qN++;
  }
  // quad com gradiente linear do 1º ponto (cor A) ao 2º ponto (cor B)
  function quadG(pts, n, r, g, b, r2, g2, b2) {
    quad(pts, n, r, g, b, 1);
    const k = (qN - 1) * 4;
    QG[k] = r2; QG[k + 1] = g2; QG[k + 2] = b2; QG[k + 3] = 1;
  }
  const _pt = new Float32Array(64);
  const _s = [0, 0, 0], _g = [0, 0, 0], _g2 = [0, 0, 0];

  // ------------------------------------------------------------------
  // Preparação por mapa
  // ------------------------------------------------------------------
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
    // o que fica escondido sob telhado opaco (não precisa desenhar)
    hideW = new Uint8Array(m.w * m.h);
    bGlass = new Uint8Array(m.buildings.length + 1);
    for (let i = 0; i < m.w * m.h; i++) if (m.wall[i] === W.GLASS && m.building[i]) bGlass[m.building[i]] = 1;
    for (let i = 0; i < m.w * m.h; i++) {
      const b = m.building[i];
      if (!m.wall[i] || !b) continue;
      const mk = m.wallMask[i];
      const qs = [];
      if (mk & 2 || !mk) qs.push(3); if (mk & 8) qs.push(2); if (mk & 4) qs.push(3); if (mk & 1) qs.push(1);
      if (!(mk & 4) || !(mk & 2)) qs.push(3);
      let inside = true;
      for (const q of qs) { const src = R.ground.qsrc(i, q); if (m.building[src] !== b || src === i) inside = false; }
      if (inside) hideW[i] = 1;
    }
    roofA = new Float32Array(m.buildings.length + 1).fill(1);
    objAlpha.clear();
    stamp = new Uint32Array(m.objects.length + 8); stampN = 0;
    zoomTarget = G.camera.zoom; lastZoomSet = G.camera.zoom;
    if (s.fov == null && G.fov) G.fov.compute(s);
  }
  RD.resetMap = function () { curMap = null; };

  function onStructure(e) {
    if (!curMap || !e) return;
    const x = Math.floor(e.x), y = Math.floor(e.y);
    if (G.fov && G.fov.invalidate) G.fov.invalidate();
    R.light.dirtyLights();
    if (x >= 0 && y >= 0 && x < curMap.w && y < curMap.h) {
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
        if (xx < 0 || yy < 0 || xx >= curMap.w || yy >= curMap.h) continue;
        R.walls.updateTile(yy * curMap.w + xx);
      }
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
    ['door:open', 'door:close', 'door:break', 'window:open', 'window:close', 'window:break', 'barricade:add', 'barricade:break', 'barricade:remove', 'fence:break'].forEach((n) => ev.on(n, onStructure));
    ev.on('player:attack', (e) => {
      const s = G.state; if (!s || !s.player) return;
      if (e.firearm) {
        const p = s.player, d = e.dir != null ? e.dir : p.dir || 0;
        const mw = R.actors.muzzleWorld;
        muzzleX = mw ? mw[0] : p.x + Math.cos(d) * 0.75; muzzleY = mw ? mw[1] : p.y + Math.sin(d) * 0.75; muzzleZ = mw ? mw[2] : 1.35;
        muzzleT = 0.09;
        s.particles.push({ x: muzzleX, y: muzzleY, z: muzzleZ, vx: 0, vy: 0, vz: 0, life: 0.07, maxLife: 0.07, type: 'muzzle', size: 4 });
        spawnP(s, muzzleX, muzzleY, muzzleZ, 'smoke', 3, 0.4, null, 2.5, 0.9, Math.cos(d) * 0.5, Math.sin(d) * 0.5);
        spawnP(s, p.x + Math.cos(d + 1.57) * 0.2, p.y + Math.sin(d + 1.57) * 0.2, 1.2, 'shell', 1, 1.2, null, 1.5, 1.6, Math.cos(d + 1.57) * 1.2, Math.sin(d + 1.57) * 1.2);
        spawnP(s, muzzleX, muzzleY, muzzleZ, 'spark', 4, 3, null, 1, 0.15, Math.cos(d) * 3, Math.sin(d) * 3);
      }
    });
    ev.on('zombie:hit', (e) => {
      const s = G.state, z = e.zombie; if (!s || !z) return;
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
  // Zoom (roda do mouse), recorte e telhados
  // ------------------------------------------------------------------
  function updateZoom(dt) {
    const cam = G.camera, I = G.input;
    if (Math.abs(cam.zoom - lastZoomSet) > 1e-6) zoomTarget = cam.zoom; // alterado externamente (debug)
    const over = G.ui && G.ui.isCapturingMouse && G.ui.isCapturingMouse();
    if (I && I.mouse && I.mouse.wheel && !over) zoomTarget = U.clamp(zoomTarget * Math.pow(1.12, -I.mouse.wheel), 0.6, 2.0);
    zoomTarget = U.clamp(zoomTarget, 0.6, 2.0);
    const nz = Math.abs(zoomTarget - cam.zoom) < 1e-3 ? zoomTarget : U.lerp(cam.zoom, zoomTarget, 1 - Math.pow(0.0005, dt));
    if (nz !== cam.zoom) {
      // mantém o centro da câmera (preserva tremor já aplicado)
      const tw = C.TILE_W / 2, th = C.TILE_H / 2;
      const oldBase = [Math.round((cam.x - cam.y) * tw * cam.zoom - cam.viewW / 2), Math.round((cam.x + cam.y) * th * cam.zoom - cam.viewH / 2)];
      const sh = [cam.ox - oldBase[0], cam.oy - oldBase[1]];
      cam.zoom = nz;
      cam.ox = Math.round((cam.x - cam.y) * tw * nz - cam.viewW / 2) + sh[0];
      cam.oy = Math.round((cam.x + cam.y) * th * nz - cam.viewH / 2) + sh[1];
    }
    lastZoomSet = cam.zoom;
    const S = cam.zoom > 1.15 ? 2 : 1;
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
  function updateRoofs(s, dt, view) {
    const m = s.map, p = s.player;
    const inB = p ? m.building[Math.floor(p.y) * m.w + Math.floor(p.x)] : 0;
    const PX = p ? (p.x - p.y) * 32 : 0, PY = p ? (p.x + p.y) * 16 : 0;
    const k = 1 - Math.exp(-dt * 7);
    for (const rf of R.walls.roofs) {
      const b = rf.b;
      let t = 1;
      if (!opts.roofs) t = 0;
      else if (p) {
        if (b.id === inB) t = 0;
        else {
          // tapa o jogador? (jogador atrás do prédio e dentro do contorno do telhado)
          const behind = !(p.x >= b.x + b.w - 0.3 || p.y >= b.y + b.h - 0.3);
          if (behind && (pointInPoly(PX, PY - 30, rf.hull) || pointInPoly(PX, PY - 5, rf.hull) || pointInPoly(PX, PY - 55, rf.hull))) t = 0.12;
        }
      }
      const a = roofA[b.id];
      roofA[b.id] = Math.abs(t - a) < 0.01 ? t : a + (t - a) * k;
    }
  }
  function cutTarget(i, x, y, p, pSum, pDiff) {
    const m = curMap;
    const b = m.building[i];
    if (!b || roofA[b] > 0.65) return 0;
    const d = x + y + 1 - pSum;
    if (d < 0.35) return 0;
    const dd = Math.abs(x - y - pDiff);
    const inside = roofA[b] < 0.3 && m.building[Math.floor(p.y) * m.w + Math.floor(p.x)] === b;
    const Rx = inside ? 9 : 5, Ry = inside ? 14 : 8;
    if (dd > Rx || d > Ry) return 0;
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
    const keyU = (u) => {
      const xmin = Math.max(x0, y0 + u), xmax = Math.min(x1, y1 + u);
      if (xmin > xmax) return -1e9;
      return 2 * xmax - u + 1;
    };
    let prevKey = null, startX = -1e9;
    for (let sI = uMin - 1; sI <= uMax; sI++) {
      const k = Math.max(keyU(sI), keyU(sI + 1));
      if (prevKey === null) { prevKey = k; continue; }
      if (k !== prevKey) {
        const bx = sI * 32;
        push(prevKey, K_OBJ, o, startX, bx, idx);
        startX = bx; prevKey = k;
      }
    }
    push(prevKey, K_OBJ, o, startX, 1e9, idx);
  }

  // ------------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------------
  const waterT = [], puddleT = [], wallT = [];
  const view = { X0: 0, Y0: 0, X1: 0, Y1: 0 };
  const uvRange = [0, 0, 0, 0];
  const zoomT = { a: 1, e: 0, f: 0 };
  let frameN = 0;

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
    dt = dt || 0.016;
    const playing = s.mode === 'playing';
    ensureMap(s);
    updateZoom(dt);
    const cam = G.camera, z = cam.zoom, m = s.map, p = s.player;
    sec();
    R.light.opts.fov = opts.fov;
    R.light.prepare(s, dt);
    const env = R.light.env;
    if (playing || s.mode === 'dead') R.fx.updateParticles(s, dt);
    if (muzzleT > 0) muzzleT -= dt;

    view.X0 = cam.ox / z; view.Y0 = cam.oy / z; view.X1 = (cam.ox + Wd) / z; view.Y1 = (cam.oy + Ht) / z;
    zoomT.a = z; zoomT.e = -cam.ox; zoomT.f = -cam.oy;
    updateRoofs(s, dt, view);

    // ---- chão ----
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    sec('pre');
    R.ground.draw(ctx, view, frameN % 2 === 0);
    sec('ground');

    // ---- varredura dos tiles visíveis ----
    const u0 = Math.floor(view.X0 / 32) - 3, u1 = Math.ceil(view.X1 / 32) + 3;
    const v0 = Math.floor(view.Y0 / 16) - 4, v1 = Math.ceil(view.Y1 / 16) + 20;
    uvRange[0] = u0; uvRange[1] = u1; uvRange[2] = v0; uvRange[3] = Math.ceil(view.Y1 / 16) + 3;
    nList = 0; waterT.length = 0; puddleT.length = 0; wallT.length = 0;
    if (++stampN > 4e9) { stampN = 1; stamp.fill(0); }
    let txMin = 1e9, tyMin = 1e9, txMax = -1e9, tyMax = -1e9;
    const pSum = p ? p.x + p.y : 0, pDiff = p ? p.x - p.y : 0;
    const kc = 1 - Math.exp(-dt * 9);
    const wet = env.wet > 0.25;
    for (let v = v0; v <= v1; v++) {
      const vis = v <= Math.ceil(view.Y1 / 16) + 2;
      for (let u = u0; u <= u1; u++) {
        if ((u + v) & 1) continue;
        const x = (u + v) >> 1, y = (v - u) >> 1;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const i = y * m.w + x;
        if (vis) { if (x < txMin) txMin = x; if (x > txMax) txMax = x; if (y < tyMin) tyMin = y; if (y > tyMax) tyMax = y; }
        if (m.wall[i]) {
          const hb = m.building[i];
          if (!(hideW[i] && roofA[hb] >= 0.99)) push(x + y + 1, K_WALL, null, 0, 0, i);
          if (p) { const tc = cutTarget(i, x, y, p, pSum, pDiff); const c0 = cutArr[i]; cutArr[i] = Math.abs(tc - c0) < 0.01 ? tc : c0 + (tc - c0) * kc; }
          wallT.push(i);
        }
        const oi = m.objAt[i];
        if (oi >= 0 && stamp[oi] !== stampN) {
          stamp[oi] = stampN;
          const o = m.objects[oi];
          if (!(o.building && roofA[o.building] >= 0.99)) pushObject(o, oi);
        }
        if (vis) {
          const f = m.floor[i];
          if (f === F.WATER) waterT.push(i);
          else if (wet && !m.building[i] && (f === F.ASPHALT || f === F.DIRT || f === F.GRAVEL || f === F.CONCRETE)) puddleT.push(i);
        }
      }
    }

    sec('scan');
    // ---- água animada ----
    if (waterT.length) drawWater(s, env);
    // ---- decals, poças ----
    R.fx.drawDecals(ctx, s, view, zoomT);
    if (wet) R.fx.drawPuddles(ctx, s, puddleT, puddleT.length, zoomT);
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    ctx.globalAlpha = 1;
    // ---- cadáveres e itens no chão (só visíveis) ----
    drawGroundThings(s);

    sec('groundfx');
    // ---- sombras do sol ----
    if (opts.shadows && env.sunA > 0.02) drawSunShadows(s);
    sec('shadows');
    // sombra de contato das entidades (sempre)
    drawContactShadows(s);

    // ---- entidades na lista ----
    const vis = R.light.vis();
    const zs = s.zombies || [];
    for (let k = 0; k < zs.length; k++) {
      const zz = zs[k];
      const X = (zz.x - zz.y) * 32, Y = (zz.x + zz.y) * 16;
      if (X < view.X0 - 40 || X > view.X1 + 40 || Y < view.Y0 - 10 || Y > view.Y1 + 80) continue;
      const vv = opts.fov && vis ? vis[Math.floor(zz.y) * m.w + Math.floor(zz.x)] || 0 : 1;
      if (vv < 0.03) { if (R.actors.track) R.actors.track(zz, dt); continue; }
      push(zz.x + zz.y, K_ZOMBIE, zz, vv, 0, k);
    }
    if (p) push(p.x + p.y, K_PLAYER, p, 1, 0, 0);

    // ---- passe vertical ----
    sec('ents');
    R.objects.budget = frameN < 3 ? 1e9 : 7; // ms por quadro para gerar sprites novos
    sorted.length = nList;
    for (let k = 0; k < nList; k++) sorted[k] = pool[k];
    sorted.sort(cmp);
    qN = 0; qpN = 0; dqN = 0;
    const PX = p ? (p.x - p.y) * 32 : 0, PY = p ? (p.x + p.y) * 16 : 0;
    const tallFront = [];
    for (let k = 0; k < nList; k++) {
      const e = sorted[k];
      if (e.kind === K_WALL) drawWall(s, e.i, env);
      else if (e.kind === K_OBJ) drawObj(s, e.ref, e.a, e.b, PX, PY, dt, tallFront);
      else if (e.kind === K_ZOMBIE) drawZombie(e.ref, e.a, dt);
      else if (e.kind === K_PLAYER) drawPlayer(s, e.ref, dt);
    }

    sec('vertical');
    // ---- telhados (+ árvores/postes na frente deles) ----
    if (opts.roofs) drawRoofs(s, tallFront);
    sec('roofs');

    // ---- partículas (não emissivas) ----
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    R.fx.drawParticles(ctx, s, false);

    // ---- luz ----
    applyShade(s, txMin, tyMin, txMax, tyMax);
    sec('shade');

    // ---- emissivos ----
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    drawEmissive(s, env);

    // ---- clima ----
    const pScr = p ? [PX * z - cam.ox, (PY - 30) * z - cam.oy] : [Wd / 2, Ht / 2];
    if (opts.weather) {
      R.fx.drawFog(ctx, Wd, Ht, cam, pScr[0], pScr[1]);
      ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
      drawHalos(s, env, true);
      if (env.rain > 0.02 || 1) R.fx.drawRain(ctx, Wd, Ht, playing ? dt : 0, s, rainExclude(s), cam);
      R.fx.drawLeaves(ctx, Wd, Ht, playing ? dt : 0);
    }
    sec('emis+weather');
    // ---- pós ----
    if (opts.post) R.fx.post(ctx, Wd, Ht, s);
    sec('post');
    // ---- indicadores ----
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (opts.overlays && s.mode !== 'dead') drawOverlays(s);
    if (G.debug && G.debug.enabled) drawDebug(s, t0);
    const ms = performance.now() - t0;
    msAcc = msAcc ? msAcc * 0.92 + ms * 0.08 : ms;
    RD.drawMs = Math.round(msAcc * 100) / 100;
    RD.lastMs = ms;
  };

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
      ctx.fillStyle = env.night > 0.5 ? 'rgba(200,210,230,0.35)' : 'rgba(255,250,230,0.7)';
      for (let k = 0; k < waterT.length; k++) {
        const i = waterT[k], x = i % m.w, y = (i / m.w) | 0;
        const h = R.hash(x, y, 57);
        if (h > 0.2) continue;
        const a = Math.sin(t * 2.2 + h * 40);
        if (a < 0.6) continue;
        const X = (x - y) * 32 + h * 100 - 10, Y = (x + y) * 16 + 16 + R.hash(x, y, 58) * 10 - 5;
        ctx.fillRect(X, Y, 2, 1);
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

  function drawGroundThings(s) {
    const m = s.map, vis = R.light.vis(), useF = opts.fov && vis;
    const cs = s.corpses || [];
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      const X = (c.x - c.y) * 32, Y = (c.x + c.y) * 16;
      if (X < view.X0 - 60 || X > view.X1 + 60 || Y < view.Y0 - 40 || Y > view.Y1 + 40) continue;
      const vv = useF ? vis[Math.floor(c.y) * m.w + Math.floor(c.x)] || 0 : 1;
      if (vv < 0.03) continue;
      ctx.globalAlpha = vv;
      R.actors.drawCorpse(ctx, c, s);
    }
    const gi = s.groundItems || [];
    for (let k = 0; k < gi.length; k++) {
      const g = gi[k];
      const X = (g.x - g.y) * 32, Y = (g.x + g.y) * 16;
      if (X < view.X0 - 20 || X > view.X1 + 20 || Y < view.Y0 - 20 || Y > view.Y1 + 20) continue;
      const vv = useF ? vis[Math.floor(g.y) * m.w + Math.floor(g.x)] || 0 : 1;
      if (vv < 0.03) continue;
      ctx.globalAlpha = vv;
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

  function drawSunShadows(s) {
    const env = R.light.env, m = s.map, cam = G.camera;
    R.fx.shadowPrep();
    // sombras estáticas (cache por bloco) direto no quadro
    ctx.globalAlpha = env.sunA;
    R.fx.drawStaticShadows(view, ctx);
    ctx.globalAlpha = 1;
    R.fx.shadowBegin(Wd, Ht, cam);
    // entidades (dinâmicas)
    const vis = R.light.vis();
    if (s.player && s.player.alive !== false && !m.building[Math.floor(s.player.y) * m.w + Math.floor(s.player.x)]) R.fx.shadowActor(s.player.x, s.player.y, 1.7);
    const zs = s.zombies || [];
    for (let k = 0; k < zs.length; k++) {
      const zz = zs[k];
      if (zz.state === 'down' || zz.state === 'crawl' || zz.crawler || zz.state === 'dead') continue;
      const X = (zz.x - zz.y) * 32, Y = (zz.x + zz.y) * 16;
      if (X < view.X0 - 80 || X > view.X1 + 80 || Y < view.Y0 - 40 || Y > view.Y1 + 80) continue;
      if (opts.fov && vis && (vis[Math.floor(zz.y) * m.w + Math.floor(zz.x)] || 0) < 0.1) continue;
      if (m.building[Math.floor(zz.y) * m.w + Math.floor(zz.x)]) continue;
      R.fx.shadowActor(zz.x, zz.y, 1.65);
    }
    R.fx.shadowEnd(ctx, env.sunA, null);
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.ox, -cam.oy);
  }
  function drawContactShadows(s) {
    const m = s.map, vis = R.light.vis();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    const p = s.player;
    if (p && p.alive !== false) { const X = (p.x - p.y) * 32, Y = (p.x + p.y) * 16; ctx.moveTo(X + 9, Y); ctx.ellipse(X, Y, 9, 4.2, 0, 0, 6.283); }
    const zs = s.zombies || [];
    for (let k = 0; k < zs.length; k++) {
      const zz = zs[k];
      const X = (zz.x - zz.y) * 32, Y = (zz.x + zz.y) * 16;
      if (X < view.X0 - 20 || X > view.X1 + 20 || Y < view.Y0 - 10 || Y > view.Y1 + 70) continue;
      if (opts.fov && vis && (vis[Math.floor(zz.y) * m.w + Math.floor(zz.x)] || 0) < 0.1) continue;
      const lying = zz.state === 'down' || zz.state === 'crawl' || zz.crawler || zz.state === 'dead';
      ctx.moveTo(X + (lying ? 20 : 9), Y); ctx.ellipse(X, Y, lying ? 20 : 9, lying ? 9 : 4.2, lying ? Math.atan2(Math.sin(zz.dir || 0) + Math.cos(zz.dir || 0), (Math.cos(zz.dir || 0) - Math.sin(zz.dir || 0)) * 2) : 0, 0, 6.283);
    }
    ctx.fill();
  }

  // Parede: sprite(s) + quads de luz
  function wallShade(i, q, fx, fy) { return R.light.shadeAt(R.ground.qsrc(i, q), fx, fy, _s); }
  // Luz ao longo da face visível: interpola (como bilinear) os tiles da fileira em frente à face.
  // axis 'x': face sul, fileira y+1, posição X; axis 'y': face leste, coluna x+1, posição Y.
  const _e1 = [0, 0, 0], _e2 = [0, 0, 0];
  function rowTile(tx, ty, fromWall, q) {
    const m = curMap;
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return fromWall;
    const i = ty * m.w + tx;
    if (m.wall[i]) return R.ground.qsrc(i, q);
    return i;
  }
  function faceSample(wallI, axis, pos, fx, fy, out) {
    const m = curMap, x = wallI % m.w, y = (wallI / m.w) | 0;
    const f = pos - 0.5, t0 = Math.floor(f), fr = f - t0;
    let iA, iB;
    if (axis === 'x') { iA = rowTile(t0, y + 1, R.ground.qsrc(wallI, 3), 0); iB = rowTile(t0 + 1, y + 1, R.ground.qsrc(wallI, 3), 1); }
    else { iA = rowTile(x + 1, t0, R.ground.qsrc(wallI, 3), 0); iB = rowTile(x + 1, t0 + 1, R.ground.qsrc(wallI, 3), 2); }
    R.light.shadeAt(iA, fx, fy, _e1); R.light.shadeAt(iB, fx, fy, _e2);
    out[0] = _e1[0] + (_e2[0] - _e1[0]) * fr; out[1] = _e1[1] + (_e2[1] - _e1[1]) * fr; out[2] = _e1[2] + (_e2[2] - _e1[2]) * fr;
    return out;
  }
  function needQuad(sh, x, y) {
    // compara com a grade atrás (a parte alta da parede cobre tiles mais ao fundo)
    R.light.gridAt(x - 1, y - 1, _g); R.light.gridAt(x - 2, y - 2, _g2);
    const d1 = Math.max(Math.abs(sh[0] - _g[0]), Math.abs(sh[1] - _g[1]), Math.abs(sh[2] - _g[2]));
    const d2 = Math.max(Math.abs(sh[0] - _g2[0]), Math.abs(sh[1] - _g2[1]), Math.abs(sh[2] - _g2[2]));
    return d1 > 0.05 || d2 > 0.05;
  }
  function drawWall(s, i, env) {
    const m = s.map;
    const x = i % m.w, y = (i / m.w) | 0;
    const wv = m.wall[i];
    const fence = R.walls.isFence(wv);
    const c = fence ? 0 : cutArr[i];
    const lit = (wv === W.WINDOW || wv === W.GLASS) && env.night > 0.15 && R.light.windowLit(i);
    const X = (x - y) * 32, Y = (x + y) * 16;
    if (c < 0.98) {
      const spr = R.walls.sprite(i, 0, lit);
      if (spr) { if (c > 0.02) ctx.globalAlpha = 1 - c; ctx.drawImage(spr.c, X - spr.L, Y - spr.TOP, spr.w, spr.h); ctx.globalAlpha = 1; }
    }
    if (c > 0.02) {
      const spr = R.walls.sprite(i, 1, false);
      if (spr) { if (c < 0.98) ctx.globalAlpha = c; ctx.drawImage(spr.c, X - spr.L, Y - spr.TOP, spr.w, spr.h); ctx.globalAlpha = 1; }
    }
    // quads de luz por meia-parede (face visível)
    const mk = m.wallMask[i];
    const h = fence ? (wv === W.FENCE_METAL ? 1.55 : 1.35) : R.WALL_M * (1 - c) + R.walls.CUT_M * c;
    const hp = h * ZPX + 3;
    const t2 = 0.08;
    const visA = opts.fov ? R.light.vis() : null;
    const qd = (ax, ay, bx, by, q, fx, fy, nx, ny) => {
      // luz nas duas pontas da face (contínua entre segmentos vizinhos)
      const axis = ny ? 'x' : 'y';
      const sA = faceSample(i, axis, axis === 'x' ? ax : ay, fx, fy, _g), sB = faceSample(i, axis, axis === 'x' ? bx : by, fx, fy, _g2);
      // face externa voltada contra o sol fica mais escura (luz rasante ao entardecer/amanhecer)
      if (env.sunA > 0.02 && !m.building[R.ground.qsrc(i, q)]) {
        const toSun = -(nx * env.sunX + ny * env.sunY); // 1 = de frente para o sol
        const k = 1 - env.sunA * 1.3 * (1 - Math.max(0, toSun)) + env.sunA * 0.5 * Math.max(0, toSun) * Math.min(1, env.sunLen / 2);
        sA[0] *= k; sA[1] *= k; sA[2] *= k; sB[0] *= k; sB[1] *= k; sB[2] *= k;
      }
      const A0 = (ax - ay) * 32, A1 = (ax + ay) * 16, B0 = (bx - by) * 32, B1 = (bx + by) * 16;
      _pt[0] = A0; _pt[1] = A1 + 1; _pt[2] = B0; _pt[3] = B1 + 1; _pt[4] = B0; _pt[5] = B1 - hp; _pt[6] = A0; _pt[7] = A1 - hp;
      if (Math.abs(sA[0] - sB[0]) + Math.abs(sA[1] - sB[1]) + Math.abs(sA[2] - sB[2]) < 0.02) quad(_pt, 4, (sA[0] + sB[0]) / 2, (sA[1] + sB[1]) / 2, (sA[2] + sB[2]) / 2);
      else quadG(_pt, 4, sA[0], sA[1], sA[2], sB[0], sB[1], sB[2]);
      if (visA && visA[R.ground.qsrc(i, q)] > 0.5 && behindHidden(visA, x, y, 2)) satKeep();
    };
    const cx = x + 0.5, cy = y + 0.5;
    const lit2 = lit && c < 0.5;
    if (!mk) qd(cx - t2, cy + t2, cx + t2, cy + t2, 3, cx, cy + 0.3, 0, 1);
    if (mk & 1) qd(cx + t2, y, cx + t2, cy, 1, cx + 0.3, y + 0.25, 1, 0);
    if (mk & 8) qd(x, cy + t2, cx, cy + t2, 2, x + 0.25, cy + 0.3, 0, 1);
    if (mk & 2) qd(cx - t2, cy + t2, x + 1, cy + t2, 3, x + 0.75, cy + 0.3, 0, 1);
    if (mk & 4) qd(cx + t2, cy - t2, cx + t2, y + 1, 3, cx + 0.3, y + 0.75, 1, 0);
    if (lit2) {
      // vidro aceso: quad emissivo quente
      const ax = R.walls.axisOf(i);
      const o0 = wv === W.GLASS ? 0.05 : 0.2, o1 = wv === W.GLASS ? 0.95 : 0.8, z0 = wv === W.GLASS ? 0.3 : 0.85, z1 = wv === W.GLASS ? 2.15 : 2.0;
      let a0x, a0y, b0x, b0y;
      if (ax === 'x') { a0x = x + o0; a0y = cy; b0x = x + o1; b0y = cy; } else { a0x = cx; a0y = y + o0; b0x = cx; b0y = y + o1; }
      const A0 = (a0x - a0y) * 32, A1 = (a0x + a0y) * 16, B0 = (b0x - b0y) * 32, B1 = (b0x + b0y) * 16;
      _pt[0] = A0; _pt[1] = A1 - z0 * ZPX; _pt[2] = B0; _pt[3] = B1 - z0 * ZPX; _pt[4] = B0; _pt[5] = B1 - z1 * ZPX; _pt[6] = A0; _pt[7] = A1 - z1 * ZPX;
      quad(_pt, 4, 1.25, 1.1, 0.85);
    }
  }

  // Objeto (uma fatia)
  const _hull = new Float32Array(1024);
  function drawObj(s, o, sx0, sx1, PX, PY, dt, tallFront) {
    const env = R.light.env;
    const lit = !!(o.light && s.power);
    const spr = R.objects.sprite(o, lit && env.night > 0.15);
    const snap = R.objects.snap(o);
    const wx = o.x + snap[0], wy = o.y + snap[1];
    const AX = (wx - wy) * 32, AY = (wx + wy) * 16;
    const left = AX - spr.L, top = AY - spr.TOP;
    const X0 = Math.max(left, sx0), X1 = Math.min(left + spr.w, sx1);
    if (X1 <= X0) return;
    if (X1 < view.X0 || X0 > view.X1 || top > view.Y1 || top + spr.h < view.Y0) return;
    const def = R.objects.def(o.type);
    const tall = def.h > 2.3;
    // translucidez quando tapa o jogador
    let a = 1;
    if (tall && G.state && G.state.player) {
      const p = G.state.player;
      const front = o.x + o.w + o.y + o.h - 1 > p.x + p.y + 0.4;
      const over = front && PX > left + 6 && PX < left + spr.w - 6 && PY - 64 < top + spr.h - 10 && PY > top + 10;
      const prev = objAlpha.has(o.id) ? objAlpha.get(o.id) : 1;
      const tgt = over ? 0.32 : 1;
      a = Math.abs(tgt - prev) < 0.01 ? tgt : prev + (tgt - prev) * (1 - Math.exp(-dt * 8));
      if (a < 0.999 || over) objAlpha.set(o.id, a); else objAlpha.delete(o.id);
    }
    const S = R.S;
    const z = G.camera.zoom;
    const sway = (o.type === 'tree' || o.type === 'pine' || o.type === 'bush' || o.type === 'clothesline') ? swayOf(o, env) : 0;
    if (a < 1) ctx.globalAlpha = a;
    if (sway) {
      const baseY = AY + (o.w + o.h) * 8;
      ctx.setTransform(z, 0, -z * sway, z, z * sway * baseY - G.camera.ox, -G.camera.oy);
    }
    if (X0 === left && X1 === left + spr.w) ctx.drawImage(spr.c, left, top, spr.w, spr.h);
    else ctx.drawImage(spr.c, (X0 - left) * S, 0, (X1 - X0) * S, spr.h * S, X0, top, X1 - X0, spr.h);
    if (sway) ctx.setTransform(z, 0, 0, z, -G.camera.ox, -G.camera.oy);
    ctx.globalAlpha = 1;
    // quad de luz (contorno) — só na primeira fatia, para objetos com altura relevante
    if (sx0 === -1e9 && def.h > 0.9 && spr.hull.length >= 6 && o.type !== 'lamp_post' && o.type !== 'clothesline' && o.type !== 'swing' && o.type !== 'mailbox') {
      const cx = Math.floor(o.x + o.w / 2), cy = Math.floor(o.y + o.h / 2);
      const i = cy * s.map.w + cx;
      const sh = tall && (o.type === 'tree' || o.type === 'pine') ? R.light.shadeAtBest(cx, cy, 1, o.x + 0.5, o.y + 0.5, _s) : R.light.shadeAt(i, o.x + o.w / 2 + 0.3, o.y + o.h / 2 + 0.3, _s);
      if (needQuad(sh, o.x + o.w / 2, o.y + o.h / 2) || o.type === 'tree' || o.type === 'pine' || o.type === 'watchtower') {
        const n = Math.min(500, spr.hull.length >> 1);
        const baseY = (o.w + o.h) * 8;
        for (let k = 0; k < n; k++) { const hy = spr.hull[k * 2 + 1]; _hull[k * 2] = AX + spr.hull[k * 2] - (sway ? sway * (hy - baseY) : 0); _hull[k * 2 + 1] = AY + hy; }
        quad(_hull, n, sh[0], sh[1], sh[2], a);
        const visA = opts.fov ? R.light.vis() : null;
        if (visA && def.h > 1.2 && o.type !== 'tree' && o.type !== 'pine' && visNear(cx, cy, 1) > 0.5 && behindHidden(visA, cx, cy, Math.min(5, Math.ceil(def.h * 0.8)))) satKeep();
      }
      if (def.h > 3) tallFront.push(o);
    }
  }
  function swayOf(o, env) {
    const h = R.hash(o.id, 7, 7);
    const w = env.wind;
    const k = o.type === 'bush' ? 0.012 : o.type === 'clothesline' ? 0.03 : 0.03;
    return (Math.sin(env.t * (1.1 + h * 0.6) + h * 30) * 0.6 + Math.sin(env.t * 2.7 + h * 11) * 0.25 + 0.5) * w * k;
  }

  function drawZombie(zz, vv, dt) {
    if (vv < 1) ctx.globalAlpha = Math.min(1, vv * 1.2);
    R.actors.drawZombie(ctx, zz, dt);
    ctx.globalAlpha = 1;
    const i = Math.floor(zz.y) * curMap.w + Math.floor(zz.x);
    const sh = R.light.shadeAt(i, zz.x, zz.y, _s);
    const L = R.actors.last;
    if (L && L.P) { actorSil(zz.x, zz.y, L.dir, L.P, L.lk, sh[0], sh[1], sh[2], vv); if (vv > 0.5 && opts.fov && behindHidden(R.light.vis(), Math.floor(zz.x), Math.floor(zz.y), 2)) satKeep(); }
    else actorQuad(zz.x, zz.y, sh, zz.state === 'down' || zz.state === 'crawl' || zz.crawler, vv);
  }
  function drawPlayer(s, p, dt) {
    R.actors.drawPlayer(ctx, p, dt, s);
    const i = Math.floor(p.y) * curMap.w + Math.floor(p.x);
    const sh = R.light.shadeAt(i, p.x, p.y, _s);
    // o jogador sempre um pouco visível para si mesmo
    sh[0] = Math.max(sh[0], 0.16); sh[1] = Math.max(sh[1], 0.17); sh[2] = Math.max(sh[2], 0.22);
    const L = R.actors.last;
    if (L && L.P) { actorSil(p.x, p.y, L.dir, L.P, L.lk, sh[0], sh[1], sh[2], 1); if (opts.fov && behindHidden(R.light.vis(), Math.floor(p.x), Math.floor(p.y), 2)) satKeep(); }
    else actorQuad(p.x, p.y, sh, p.alive === false, 1);
  }
  function actorQuad(x, y, sh, lying, a) {
    const X = (x - y) * 32, Y = (x + y) * 16;
    if (lying) { _pt[0] = X - 30; _pt[1] = Y - 14; _pt[2] = X + 30; _pt[3] = Y - 14; _pt[4] = X + 30; _pt[5] = Y + 14; _pt[6] = X - 30; _pt[7] = Y + 14; }
    else { _pt[0] = X - 13; _pt[1] = Y - 64; _pt[2] = X + 13; _pt[3] = Y - 64; _pt[4] = X + 13; _pt[5] = Y + 5; _pt[6] = X - 13; _pt[7] = Y + 5; }
    quad(_pt, 4, sh[0], sh[1], sh[2], a);
  }

  // Telhados + objetos altos na frente deles
  let roofVis = 1;
  function roofShade(rf, out) {
    const m = curMap, b = rf.b, vis = R.light.vis(), seen = R.light.seen();
    let v = 0, sn = 0;
    const samp = (x, y) => {
      x = Math.floor(x); y = Math.floor(y);
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
      const i = y * m.w + x;
      if (vis) v = Math.max(v, vis[i]);
      if (seen && seen[i]) sn = 1;
    };
    roofVis = 1;
    for (let k = 0; k <= 4; k++) {
      samp(b.x + b.w * k / 4, b.y + b.h + 0.5); samp(b.x + b.w + 0.5, b.y + b.h * k / 4);
      samp(b.x + b.w * k / 4, b.y - 1); samp(b.x - 1, b.y + b.h * k / 4);
    }
    const e = R.light.env;
    const moon = 0.045 * e.night;
    // à noite o telhado (cor única) fica menos azul que o chão: mistura parcial com a luminância
    const lum = e.amb[0] * 0.3 + e.amb[1] * 0.59 + e.amb[2] * 0.11, dz = 0.45 * e.night;
    out[0] = e.amb[0] + (lum - e.amb[0]) * dz + e.flash * 0.9 + moon * 0.75;
    out[1] = e.amb[1] + (lum - e.amb[1]) * dz + e.flash * 0.9 + moon * 0.85;
    out[2] = e.amb[2] + (lum - e.amb[2]) * dz + e.flash + moon;
    if (opts.fov && vis) {
      roofVis = v;
      const mk = sn ? 0.5 : 0.1;
      const k = mk + (1 - mk) * v;
      out[0] *= k; out[1] *= k; out[2] *= k * (1 + 0.1 * (1 - v));
    }
    return out;
  }
  function drawRoofs(s, tallFront) {
    const list = [];
    for (const rf of R.walls.roofs) {
      const a = roofA[rf.b.id];
      if (a <= 0.01) continue;
      const h = rf.hull;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let k = 0; k < h.length; k += 2) { if (h[k] < x0) x0 = h[k]; if (h[k] > x1) x1 = h[k]; if (h[k + 1] < y0) y0 = h[k + 1]; if (h[k + 1] > y1) y1 = h[k + 1]; }
      if (x1 < view.X0 || x0 > view.X1 || y1 < view.Y0 || y0 > view.Y1) continue;
      list.push(rf);
    }
    list.sort((p, q) => p.key - q.key);
    for (const rf of list) {
      const a = roofA[rf.b.id];
      R.walls.drawRoof(ctx, rf, a);
      const sh = roofShade(rf, _s);
      quad(rf.hull, rf.hull.length >> 1, sh[0], sh[1], sh[2], a);
      if (opts.fov && roofVis > 0.5) satKeep();
    }
    // árvores/postes altos na frente de um telhado: redesenha recortado ao contorno do telhado
    for (const o of tallFront) {
      const snapx = o.x + o.w, snapy = o.y + o.h;
      for (const rf of list) {
        const b = rf.b;
        if (!(snapx - 0.5 >= b.x + b.w || snapy - 0.5 >= b.y + b.h)) continue; // não está na frente
        const ddx = Math.max(0, b.x - snapx, o.x - (b.x + b.w)), ddy = Math.max(0, b.y - snapy, o.y - (b.y + b.h));
        if (ddx + ddy > 4) continue; // longe demais para a copa alcançar o telhado
        if (roofA[b.id] < 0.05) continue;
        const spr = R.objects.sprite(o, false);
        const AX = (o.x - o.y) * 32, AY = (o.x + o.y) * 16;
        const l = AX - spr.L, t = AY - spr.TOP;
        const h = rf.hull;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (let k = 0; k < h.length; k += 2) { if (h[k] < x0) x0 = h[k]; if (h[k] > x1) x1 = h[k]; if (h[k + 1] < y0) y0 = h[k + 1]; if (h[k + 1] > y1) y1 = h[k + 1]; }
        if (l > x1 || l + spr.w < x0 || t > y1 || t + spr.h < y0) continue;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(h[0], h[1]); for (let k = 2; k < h.length; k += 2) ctx.lineTo(h[k], h[k + 1]); ctx.closePath(); ctx.clip();
        const env = R.light.env;
        const sway = (o.type === 'tree' || o.type === 'pine') ? swayOf(o, env) : 0;
        const a = objAlpha.has(o.id) ? objAlpha.get(o.id) : 1;
        ctx.globalAlpha = a;
        if (sway) { const z = G.camera.zoom, baseY = AY + (o.w + o.h) * 8; ctx.setTransform(z, 0, -z * sway, z, z * sway * baseY - G.camera.ox, -G.camera.oy); }
        ctx.drawImage(spr.c, l, t, spr.w, spr.h);
        ctx.restore();
        const sh = R.light.shadeAtBest(Math.floor(o.x), Math.floor(o.y), 1, o.x + 0.8, o.y + 0.8, _s);
        const n = Math.min(500, spr.hull.length >> 1);
        for (let k = 0; k < n; k++) { _hull[k * 2] = AX + spr.hull[k * 2]; _hull[k * 2 + 1] = AY + spr.hull[k * 2 + 1]; }
        quad(_hull, n, sh[0], sh[1], sh[2], a);
        if (opts.fov && o.type !== 'tree' && o.type !== 'pine' && visNear(Math.floor(o.x), Math.floor(o.y), 1) > 0.5) satKeep();
      }
    }
  }

  // Mapa de luz: grade + quads → multiply
  // Luz em meia resolução (multiply); máscara de dessaturação da memória em 1/4 (saturation).
  let shadeC = null, shadeX = null, shW = 0, shH = 0, satC = null, satX = null;
  function applyShade(s, tx0, ty0, tx1, ty1) {
    const cam = G.camera, z = cam.zoom;
    const w = Math.ceil(Wd / 2), h = Math.ceil(Ht / 2);
    if (!shadeC || shW !== w || shH !== h) { shW = w; shH = h; shadeC = R.canvas(w, h); shadeX = shadeC.getContext('2d', { alpha: false }); satC = R.canvas(Math.ceil(w / 2), Math.ceil(h / 2)); satX = satC.getContext('2d'); }
    const g = shadeX;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    let grid = null;
    if (tx0 > tx1) return;

    sec('shade:pre');
    grid = R.light.buildGrid(s, uvRange);
    sec('shade:grid');
    if (grid) {
      g.imageSmoothingEnabled = true;
      g.setTransform(z * 0.5, 0, 0, z * 0.5, -cam.ox * 0.5, -cam.oy * 0.5);
      g.drawImage(grid.c, grid.dx, grid.dy, grid.dw, grid.dh);
    }
    sec('shade:gridDraw');
    // quads verticais em ordem de desenho
    g.setTransform(z * 0.5, 0, 0, z * 0.5, -cam.ox * 0.5, -cam.oy * 0.5);
    let lastC = '';
    for (let k = 0; k < qN; k++) {
      const st = QS[k], n = QL[k];
      const r = QC[k * 4], gg = QC[k * 4 + 1], b = QC[k * 4 + 2], a = QC[k * 4 + 3];
      const cs = 'rgb(' + (r >= 1 ? 255 : r <= 0 ? 0 : (r * 255) | 0) + ',' + (gg >= 1 ? 255 : gg <= 0 ? 0 : (gg * 255) | 0) + ',' + (b >= 1 ? 255 : b <= 0 ? 0 : (b * 255) | 0) + ')';
      if (n < 0) { // silhueta de ator
        const e = QA[k];
        g.globalAlpha = a;
        R.actors.drawFigure(g, e.x, e.y, e.dir, e.P, e.lk, { weapon: e.w, solid: cs });
        lastC = '';
        continue;
      }
      if (QG[k * 4 + 3]) {
        const c2 = 'rgb(' + (QG[k * 4] >= 1 ? 255 : QG[k * 4] <= 0 ? 0 : (QG[k * 4] * 255) | 0) + ',' + (QG[k * 4 + 1] >= 1 ? 255 : QG[k * 4 + 1] <= 0 ? 0 : (QG[k * 4 + 1] * 255) | 0) + ',' + (QG[k * 4 + 2] >= 1 ? 255 : QG[k * 4 + 2] <= 0 ? 0 : (QG[k * 4 + 2] * 255) | 0) + ')';
        const gr = g.createLinearGradient(QP[st], QP[st + 1], QP[st + 2], QP[st + 3]);
        gr.addColorStop(0, cs); gr.addColorStop(1, c2);
        g.fillStyle = gr; lastC = '';
      } else if (cs !== lastC) { g.fillStyle = cs; lastC = cs; }
      g.globalAlpha = a;
      g.beginPath();
      g.moveTo(QP[st], QP[st + 1]);
      for (let j = 1; j < n; j++) g.lineTo(QP[st + j * 2], QP[st + j * 2 + 1]);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
    sec('shade:quads');
    RD.stats.quads = qN;
    // clarão de tiro ilumina o entorno
    if (muzzleT > 0) {
      const X = (muzzleX - muzzleY) * 32, Y = (muzzleX + muzzleY) * 16 - muzzleZ * ZPX * 0.3;
      g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(X, Y, 0, X, Y, 260);
      const k = Math.min(1, muzzleT / 0.09);
      gr.addColorStop(0, 'rgba(255,220,160,' + (0.8 * k) + ')'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr; g.fillRect(X - 260, Y - 260, 520, 520);
      g.globalCompositeOperation = 'source-over';
    }
    // máscara de dessaturação (memória), exceto o que está à vista na frente dela
    const des = grid && grid.des;
    if (des && dqN) {
      const g = satX;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, satC.width, satC.height);
      g.imageSmoothingEnabled = true;
      g.setTransform(z * 0.25, 0, 0, z * 0.25, -cam.ox * 0.25, -cam.oy * 0.25);
      g.drawImage(grid.des, grid.dx, grid.dy, grid.dw, grid.dh);
      {
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000';
        for (let j = 0; j < dqN; j++) {
          const k = DQ[j], st = QS[k], n = QL[k];
          if (n < 0) { const e = QA[k]; R.actors.drawFigure(g, e.x, e.y, e.dir, e.P, e.lk, { weapon: e.w, solid: '#000' }); continue; }
          // máscara em 1/4 de resolução: contornos longos (copas) podem ser simplificados
          const stp = n > 32 ? Math.floor(n / 16) : 1;
          g.beginPath();
          g.moveTo(QP[st], QP[st + 1]);
          for (let q = stp; q < n; q += stp) g.lineTo(QP[st + q * 2], QP[st + q * 2 + 1]);
          g.closePath();
          g.fill();
        }
        g.globalCompositeOperation = 'source-over';
      }
    }
    RD.stats.satKeep = dqN;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shadeC, 0, 0, w * 2, h * 2);
    if (des) {
      ctx.globalCompositeOperation = 'saturation';
      if (dqN) ctx.drawImage(satC, 0, 0, satC.width * 4, satC.height * 4);
      else { ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy); ctx.drawImage(des, grid.dx, grid.dy, grid.dw, grid.dh); }
    }
    ctx.restore();
  }

  // Emissivos: brilhos aditivos (postes, luminárias, janelas, sirene, máquina)
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
  const emis = [];
  function drawEmissive(s, env) {
    emis.length = 0;
    const m = s.map, vis = R.light.vis();
    const night = env.night;
    const day = Math.floor(s.time / 1440);
    for (let k = 0; k < nList; k++) {
      const e = pool[k];
      if (e.kind !== K_OBJ || e.a !== -1e9) continue;
      const o = e.ref;
      const X = (o.x - o.y) * 32, Y = (o.x + o.y) * 16;
      if (o.light && s.power && night > 0.12) {
        // dentro de prédio com telhado: só se o telhado sumiu
        if (o.building && roofA[o.building] > 0.5) continue;
        const spr = R.objects.sprite(o, true);
        const L = spr.light || [o.w / 2, o.h / 2, 1.2];
        const snap = R.objects.snap(o);
        const lx = X + (L[0] - L[1] + snap[0] - snap[1]) * 32, ly = Y + (L[0] + L[1] + snap[0] + snap[1]) * 16 - L[2] * ZPX;
        const big = o.type === 'lamp_post' ? 1 : o.type === 'lamp' ? 0.7 : 0.5;
        if (occludedByRoof(lx, ly, o.x + o.w, o.y + o.h)) continue;
        emis.push(lx, ly, big * 1.0 * night, o.type === 'vending_machine' ? 1 : 0);
      }
      if (o.type === 'police_car' && day < 3 && (o.variant % 3 === 0 || o.wrecked)) {
        const ph = Math.floor(s.realTime * 3) % 2;
        const spr = R.objects.sprite(o, false); void spr;
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const lx = (cx - cy) * 32, ly = (cx + cy) * 16 - 1.5 * ZPX;
        emis.push(lx, ly, 0.35 + night * 0.65, ph ? 2 : 3);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
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
        const X = (x + 0.5 - y - 0.5) * 32, Y = (x + y + 1) * 16 - 1.45 * ZPX;
        ctx.drawImage(img, X - 26, Y - 22, 52, 44);
      }
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
    void vis;
  }
  // ponto (px isométricos) escondido atrás de um telhado opaco?
  function occludedByRoof(X, Y, ox1, oy1) {
    for (const rf of R.walls.roofs) {
      const b = rf.b;
      if (roofA[b.id] < 0.5) continue;
      if (ox1 - 0.5 >= b.x + b.w || oy1 - 0.5 >= b.y + b.h) continue; // está na frente
      const h = rf.hull;
      if (X < rf._x0 || X > rf._x1 || Y < rf._y0 || Y > rf._y1) { if (rf._x0 != null) continue; }
      if (rf._x0 == null) { let a = 1e9, bb = -1e9, c = 1e9, d = -1e9; for (let k = 0; k < h.length; k += 2) { a = Math.min(a, h[k]); bb = Math.max(bb, h[k]); c = Math.min(c, h[k + 1]); d = Math.max(d, h[k + 1]); } rf._x0 = a; rf._x1 = bb; rf._y0 = c; rf._y1 = d; if (X < a || X > bb || Y < c || Y > d) continue; }
      if (pointInPoly(X, Y, h)) return true;
    }
    return false;
  }
  // halos maiores dentro da neblina (depois dela)
  function drawHalos(s, env, fogPass) {
    if (!fogPass || env.fog < 0.1 || !emis.length) return;
    ctx.globalCompositeOperation = 'lighter';
    const img = halo('#ffd08a');
    for (let k = 0; k < emis.length; k += 4) {
      const a = emis[k + 2] * env.fog * 0.6;
      if (a < 0.02 || emis[k + 3] !== 0) continue;
      ctx.globalAlpha = Math.min(1, a);
      const r = 90;
      ctx.drawImage(img, emis[k] - r, emis[k + 1] - r * 0.8, r * 2, r * 1.6);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function rainExclude(s) {
    const p = s.player;
    if (!p) return null;
    const b = s.map.building[Math.floor(p.y) * s.map.w + Math.floor(p.x)];
    if (!b) return null;
    const rf = R.walls.roofs[b - 1];
    if (!rf || roofA[b] > 0.5) return null;
    const cam = G.camera, z = cam.zoom;
    const out = [];
    for (let k = 0; k < rf.hull.length; k += 2) out.push(rf.hull[k] * z - cam.ox, rf.hull[k + 1] * z - cam.oy);
    return out;
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

  function drawDebug(s, t0) {
    const cam = G.camera, z = cam.zoom;
    ctx.setTransform(z, 0, 0, z, -cam.ox, -cam.oy);
    const ns = s.noises || [];
    for (const n of ns) {
      const X = (n.x - n.y) * 32, Y = (n.x + n.y) * 16;
      ctx.strokeStyle = 'rgba(255,200,80,' + Math.max(0, n.life || 0) * 0.5 + ')'; ctx.lineWidth = 1 / z;
      ctx.beginPath(); ctx.ellipse(X, Y, n.radius * 45.25, n.radius * 22.63, 0, 0, 6.283); ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = s.player || {};
    const e = R.light.env;
    const lines = [
      'FPS ' + RD.fps + '  draw ' + RD.drawMs.toFixed(2) + ' ms  zoom ' + z.toFixed(2) + '  S' + R.S,
      'tile ' + Math.floor(p.x) + ',' + Math.floor(p.y) + '  hora ' + e.hour.toFixed(2) + '  luz ' + (s.light != null ? s.light.toFixed(2) : '?') + '  amb ' + e.lum.toFixed(2),
      'zumbis ' + (s.zombies || []).length + '  partículas ' + (s.particles || []).length + '  decals ' + (s.decals || []).length + '  lista ' + nList + '  quads ' + qN,
      'blocos ' + R.ground.stats.chunks + ' (' + R.ground.stats.built + ' feitos)  sprites parede ' + R.walls.spriteCount() + '  obj ' + R.objects.cacheSize(),
      'chuva ' + e.rain.toFixed(2) + '  névoa ' + e.fog.toFixed(2) + '  molhado ' + e.wet.toFixed(2) + '  vento ' + e.wind.toFixed(2) + '  energia ' + (s.power ? 'sim' : 'não'),
    ];
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(8, Ht - 18 * lines.length - 14, 560, 18 * lines.length + 8);
    ctx.fillStyle = '#d8e0c8';
    lines.forEach((l, k) => ctx.fillText(l, 14, Ht - 18 * (lines.length - k) - 2));
    void t0;
  }
})();
