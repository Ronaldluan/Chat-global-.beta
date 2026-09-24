/* =====================================================================
 * VALE QUIETO — render-core.js  (Etapa 2: Render)
 * Base interna do renderizador (G.R): cores, canvases, projeção e um
 * pequeno kit 3D "flat shaded" para gerar sprites procedurais (caixas,
 * prismas convexos, cilindros, bolhas) em coordenadas locais do objeto.
 *
 * Escala: 1 tile ≈ 1 m. Horizontal: tile (x,y) → ((x-y)*32, (x+y)*16) px.
 * Vertical: R.ZPX px por metro (jogador ~1,75 m ≈ 58 px com zoom 1).
 * Carregado antes de render.js; não chama outros módulos na carga.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G;
  const R = (G.R = G.R || {});

  const ZPX = (R.ZPX = 33);
  R.WALL_M = G.CONST.WALL_H / ZPX; // ~2,42 m
  R.DX = [1, 0, -1, 0];
  R.DY = [0, 1, 0, -1];
  R.S = 1; // escala dos caches (0.5, 1 ou 2, conforme o zoom — com histerese)

  // ------------------------------------------------------------------
  // Números de ajuste centralizados (luz, memória, orçamentos, zoom...)
  // ------------------------------------------------------------------
  R.TUNE = {
    // memória (fora da visão atual; nunca-visto conta como memória): brilho e "névoa" cinza
    mem: { day: 0.78, night: 0.45, desat: 0.28, blueNight: 0.1 },
    // luar externo (céu limpo), reduzido por nuvens/chuva
    moon: [0.13, 0.15, 0.26], moonCloud: 0.55,
    // interiores de dia: fator base, ganho pela luz das janelas, mínimo
    interior: { day: 0.75, win: 0.45, minDay: 0.5 },
    // atores visíveis no escuro: brilho mínimo e contorno frio (luar)
    actorMin: [0.26, 0.29, 0.4], rim: [46, 62, 104],
    // lanterna
    flash: { r: 12.5, half: 0.46, I: 1.65, glow: 0.32 },
    // FOV: raio de dia, raio "no escuro", cone (meio-ângulo), percepção atrás, limiar de luz
    fov: { r: 30, darkR: 7.5, cone: 1.745, percept: 1.9, lightMin: 0.2, fogK: 0.62, jump: 6 },
    // orçamentos por quadro (ms)
    budget: { ground: 4, groundCold: 14, walls: 2, objects: 3, actors: 2, roofs: 2, shadows: 2.5 },
    // zoom e escalas de cache (histerese)
    zoom: { min: 0.6, max: 2.0, step: 1.12, s2up: 1.25, s2down: 1.05, sHalfDown: 0.78, sHalfUp: 0.85 },
    // raio-X (buraco suave) quando o jogador está oculto por telhado/paredes/copas
    xray: { r: 82, soft: 40, alpha: 0.22, rings: 5 },
    // pós
    vignette: 0.42, grain: 0.07, lightning: 0.72,
    // hora dourada: luz quente aditiva no chão ao sol e sombras azuladas
    warm: [62, 34, 8], shadowTint: [18, 26, 54],
  };

  // ------------------------------------------------------------------
  // Cores
  // ------------------------------------------------------------------
  const hexCache = new Map();
  R.hex = function (h) {
    if (Array.isArray(h)) return h;
    let c = hexCache.get(h);
    if (c) return c;
    let s = String(h == null ? '#808080' : h).trim();
    if (s[0] === '#') {
      s = s.slice(1);
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      const n = parseInt(s.slice(0, 6), 16) || 0;
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else if (s.startsWith('rgb') || s.startsWith('hsl')) {
      const m = s.match(/[\d.]+/g) || [128, 128, 128];
      c = [+m[0], +m[1], +m[2]];
    } else c = [128, 128, 128];
    hexCache.set(h, c);
    return c;
  };
  const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  R.css = function (c, k, a) {
    c = R.hex(c);
    if (k == null) k = 1;
    const r = c255(c[0] * k), g = c255(c[1] * k), b = c255(c[2] * k);
    return a == null ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  };
  R.mix = function (a, b, t) {
    a = R.hex(a); b = R.hex(b);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  R.darken = (c, t) => R.mix(c, [0, 0, 0], t);
  R.desat = function (c, t) {
    c = R.hex(c);
    const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    return [c[0] + (l - c[0]) * t, c[1] + (l - c[1]) * t, c[2] + (l - c[2]) * t];
  };
  R.jitter = function (c, amt, h) { // variação determinística de cor
    c = R.hex(c);
    const k = 1 + (h - 0.5) * amt;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  R.hash = function (x, y, s) { return G.util.hash2(x | 0, y | 0, s | 0); };

  // ------------------------------------------------------------------
  // Canvases
  // ------------------------------------------------------------------
  R.canvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };

  // Cache LRU de verdade: get() marca como recente (reinsere no fim); set() despeja o menos usado
  R.Cache = function (max) {
    this.max = max; this.map = new Map();
  };
  R.Cache.prototype.get = function (k) {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  };
  R.Cache.prototype.peek = function (k) { return this.map.get(k); };
  R.Cache.prototype.has = function (k) { return this.map.has(k); };
  R.Cache.prototype.delete = function (k) { return this.map.delete(k); };
  R.Cache.prototype.set = function (k, v) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return v;
  };
  R.Cache.prototype.clear = function () { this.map.clear(); };
  Object.defineProperty(R.Cache.prototype, 'size', { get() { return this.map.size; } });

  // Strings 'rgb(...)' para cores do mapa de luz (0..1 por canal), sem alocar a cada quadro
  const rgbCache = new Map();
  R.rgb01 = function (r, g, b) {
    const R8 = r >= 1 ? 255 : r <= 0 ? 0 : (r * 255) | 0, G8 = g >= 1 ? 255 : g <= 0 ? 0 : (g * 255) | 0, B8 = b >= 1 ? 255 : b <= 0 ? 0 : (b * 255) | 0;
    const k = (R8 << 16) | (G8 << 8) | B8;
    let s = rgbCache.get(k);
    if (s === undefined) {
      if (rgbCache.size > 6000) rgbCache.clear();
      s = 'rgb(' + R8 + ',' + G8 + ',' + B8 + ')';
      rgbCache.set(k, s);
    }
    return s;
  };

  // ------------------------------------------------------------------
  // Iluminação "de arte" dos sprites (fixa; o dinâmico vem do mapa de luz)
  // ------------------------------------------------------------------
  const LX = 0.55, LY = 0.25, LZ = 1.0, LL = Math.hypot(LX, LY, LZ);
  const VX = 1, VY = 1, VZ = 0.97; // direção para a câmera
  R.faceBright = function (nx, ny, nz) {
    const l = Math.hypot(nx, ny, nz) || 1;
    const d = (nx * LX + ny * LY + nz * LZ) / (l * LL);
    return 0.6 + 0.44 * (d > 0 ? d : 0);
  };
  R.faceVisible = (nx, ny, nz) => nx * VX + ny * VY + nz * VZ > 1e-6;

  // Convex hull (monotone chain) de pontos [x,y,...] planos → array plano
  R.hull = function (pts) {
    const n = pts.length >> 1;
    if (n < 3) return pts.slice();
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
    const cross = (o, a, b) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
    const lo = [], up = [];
    for (const i of idx) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], i) <= 0) up.pop(); up.push(i); }
    lo.pop(); up.pop();
    const out = [];
    for (const i of lo.concat(up)) out.push(pts[i * 2], pts[i * 2 + 1]);
    return out;
  };

  // ------------------------------------------------------------------
  // Kit 3D para sprites. Coordenadas LOCAIS do objeto:
  //   a = largura (eixo "direita"), d = profundidade (frente em d = D), z = altura (m).
  // rot (0:+x 1:+y 2:-x 3:-y) = para onde a frente aponta. A pegada no mundo é w×h.
  // (ax, ay) = ponto do canvas onde fica o canto (0,0,0) da pegada no mundo.
  // ------------------------------------------------------------------
  function Model(ctx, ax, ay, rot, A, D) {
    rot &= 3;
    const F0 = R.DX[rot], F1 = R.DY[rot];
    const R0 = -F1, R1 = F0;
    this.ctx = ctx; this.ax = ax; this.ay = ay; this.rot = rot; this.A = A; this.D = D;
    this.w = rot & 1 ? A : D; this.h = rot & 1 ? D : A;
    this.F0 = F0; this.F1 = F1; this.R0 = R0; this.R1 = R1;
    this.pts = [];
    this.light = 1;       // multiplicador geral
    this.outline = null;  // cor de contorno opcional
  }
  const MP = Model.prototype;
  MP.X = function (a, d) { return this.w / 2 + this.F0 * (d - this.D / 2) + this.R0 * (a - this.A / 2); };
  MP.Y = function (a, d) { return this.h / 2 + this.F1 * (d - this.D / 2) + this.R1 * (a - this.A / 2); };
  MP.sx = function (x, y) { return this.ax + (x - y) * 32; };
  MP.sy = function (x, y, z) { return this.ay + (x + y) * 16 - z * ZPX; };
  // ponto local → tela
  MP.p = function (a, d, z) {
    const x = this.X(a, d), y = this.Y(a, d);
    return [this.ax + (x - y) * 32, this.ay + (x + y) * 16 - z * ZPX];
  };
  MP.addPt = function (x, y) { this.pts.push(x, y); };
  // normal local → mundo (vetor horizontal)
  MP.nx = function (na, nd) { return this.F0 * nd + this.R0 * na; };
  MP.ny = function (na, nd) { return this.F1 * nd + this.R1 * na; };

  // Polígono 3D local: pts = [[a,d,z],...]; preenche com sombreamento pela normal (se visível)
  MP.poly = function (pts, color, opt) {
    const ctx = this.ctx;
    // normal pelo método de Newell (no mundo)
    let nx = 0, ny = 0, nz = 0;
    const W = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      W.push([this.X(p[0], p[1]), this.Y(p[0], p[1]), p[2]]);
    }
    for (let i = 0; i < W.length; i++) {
      const a = W[i], b = W[(i + 1) % W.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    if (opt && opt.flip) { nx = -nx; ny = -ny; nz = -nz; }
    if (!R.faceVisible(nx, ny, nz)) {
      if (!(opt && opt.twoSided)) return false;
      nx = -nx; ny = -ny; nz = -nz;
    }
    const br = (opt && opt.bright != null ? opt.bright : R.faceBright(nx, ny, nz)) * this.light;
    ctx.beginPath();
    for (let i = 0; i < W.length; i++) {
      const sx = this.ax + (W[i][0] - W[i][1]) * 32, sy = this.ay + (W[i][0] + W[i][1]) * 16 - W[i][2] * ZPX;
      if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      this.pts.push(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = typeof color === 'function' ? color(br) : R.css(color, br, opt && opt.alpha);
    ctx.fill();
    if (opt && opt.stroke) { ctx.strokeStyle = opt.stroke; ctx.lineWidth = opt.lw || 0.6; ctx.stroke(); }
    else if (this.outline) { ctx.strokeStyle = this.outline; ctx.lineWidth = 0.5; ctx.stroke(); }
    return true;
  };

  // Caixa local [a0,a1]×[d0,d1]×[z0,z1]. deco: { top, front, back, left, right } (fn(ctx, face))
  MP.box = function (a0, a1, d0, d1, z0, z1, color, deco, opt) {
    const ctx = this.ctx;
    const xs = [this.X(a0, d0), this.X(a1, d1)], ys = [this.Y(a0, d0), this.Y(a1, d1)];
    const x0 = Math.min(xs[0], xs[1]), x1 = Math.max(xs[0], xs[1]);
    const y0 = Math.min(ys[0], ys[1]), y1 = Math.max(ys[0], ys[1]);
    const col = R.hex(color);
    const L = this.light * (opt && opt.light != null ? opt.light : 1);
    const sx = (x, y) => this.ax + (x - y) * 32, sy = (x, y, z) => this.ay + (x + y) * 16 - z * ZPX;
    const face = (pts, br) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 3) {
        const X = sx(pts[i], pts[i + 1]), Y = sy(pts[i], pts[i + 1], pts[i + 2]);
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        this.pts.push(X, Y);
      }
      ctx.closePath();
      ctx.fillStyle = R.css(col, br * L, opt && opt.alpha);
      ctx.fill();
      if (this.outline && !(opt && opt.noOutline)) { ctx.strokeStyle = this.outline; ctx.lineWidth = 0.5; ctx.stroke(); }
    };
    const localName = (nx, ny) => { // normal do mundo → nome local
      if (nx === this.F0 && ny === this.F1) return 'front';
      if (nx === -this.F0 && ny === -this.F1) return 'back';
      if (nx === this.R0 && ny === this.R1) return 'right';
      return 'left';
    };
    // faces visíveis: sul (+y), leste (+x) e topo
    if (x1 > x0 && z1 > z0) {
      face([x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], R.faceBright(0, 1, 0));
      if (deco) { const n = localName(0, 1); if (deco[n]) this.faceDeco(n, a0, a1, d0, d1, z0, z1, deco[n]); }
    }
    if (y1 > y0 && z1 > z0) {
      face([x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1], R.faceBright(1, 0, 0));
      if (deco) { const n = localName(1, 0); if (deco[n]) this.faceDeco(n, a0, a1, d0, d1, z0, z1, deco[n]); }
    }
    if (x1 > x0 && y1 > y0) {
      face([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], R.faceBright(0, 0, 1));
      if (deco && deco.top) this.topDeco(z1, deco.top);
    }
    return this;
  };

  // Transforma o contexto para desenhar numa face vertical local.
  // front/back: coords (a, z); left/right: coords (d, z). z para cima (em metros).
  MP.faceDeco = function (name, a0, a1, d0, d1, z0, z1, fn) {
    const ctx = this.ctx;
    let o, u;
    if (name === 'front') { o = [this.X(0, d1), this.Y(0, d1)]; u = [this.R0, this.R1]; }
    else if (name === 'back') { o = [this.X(0, d0), this.Y(0, d0)]; u = [this.R0, this.R1]; }
    else if (name === 'right') { o = [this.X(a1, 0), this.Y(a1, 0)]; u = [this.F0, this.F1]; }
    else { o = [this.X(a0, 0), this.Y(a0, 0)]; u = [this.F0, this.F1]; }
    ctx.save();
    ctx.transform((u[0] - u[1]) * 32, (u[0] + u[1]) * 16, 0, -ZPX, this.ax + (o[0] - o[1]) * 32, this.ay + (o[0] + o[1]) * 16);
    fn(ctx, { name, a0, a1, d0, d1, z0, z1, u0: name === 'front' || name === 'back' ? a0 : d0, u1: name === 'front' || name === 'back' ? a1 : d1 });
    ctx.restore();
  };
  // Transforma o contexto para desenhar no plano horizontal z (coords locais a, d)
  MP.topDeco = function (z, fn) {
    const ctx = this.ctx;
    const ox = this.X(0, 0), oy = this.Y(0, 0);
    const ua = [this.R0, this.R1], ud = [this.F0, this.F1];
    ctx.save();
    ctx.transform((ua[0] - ua[1]) * 32, (ua[0] + ua[1]) * 16, (ud[0] - ud[1]) * 32, (ud[0] + ud[1]) * 16,
      this.ax + (ox - oy) * 32, this.ay + (ox + oy) * 16 - z * ZPX);
    fn(ctx);
    ctx.restore();
  };
  // Prisma: perfil [[d,z],...] (convexo) extrudado ao longo de a ∈ [a0,a1]
  MP.prism = function (profile, a0, a1, color, opt) {
    const n = profile.length;
    const faces = [];
    const capA = [], capB = [];
    for (let i = 0; i < n; i++) { capA.push([a0, profile[i][0], profile[i][1]]); capB.push([a1, profile[i][0], profile[i][1]]); }
    faces.push(capA.slice().reverse(), capB);
    for (let i = 0; i < n; i++) {
      const p = profile[i], q = profile[(i + 1) % n];
      faces.push([[a0, p[0], p[1]], [a0, q[0], q[1]], [a1, q[0], q[1]], [a1, p[0], p[1]]]);
    }
    this.convex(faces, color, opt);
  };
  // Sólido convexo: lista de faces; orienta normais para fora pelo centróide
  MP.convex = function (faces, color, opt) {
    let cx = 0, cy = 0, cz = 0, cn = 0;
    for (const f of faces) for (const p of f) { cx += this.X(p[0], p[1]); cy += this.Y(p[0], p[1]); cz += p[2]; cn++; }
    cx /= cn; cy /= cn; cz /= cn;
    const colors = opt && opt.faceColors;
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      let nx = 0, ny = 0, nz = 0, fx = 0, fy = 0, fz = 0;
      const W = f.map((p) => [this.X(p[0], p[1]), this.Y(p[0], p[1]), p[2]]);
      for (let i = 0; i < W.length; i++) {
        const a = W[i], b = W[(i + 1) % W.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
        fx += a[0]; fy += a[1]; fz += a[2];
      }
      fx /= W.length; fy /= W.length; fz /= W.length;
      if (nx * (fx - cx) + ny * (fy - cy) + nz * (fz - cz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (!R.faceVisible(nx, ny, nz)) continue;
      const br = R.faceBright(nx, ny, nz) * this.light;
      const ctx = this.ctx;
      ctx.beginPath();
      for (let i = 0; i < W.length; i++) {
        const X = this.ax + (W[i][0] - W[i][1]) * 32, Y = this.ay + (W[i][0] + W[i][1]) * 16 - W[i][2] * ZPX;
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        this.pts.push(X, Y);
      }
      ctx.closePath();
      const col = colors && colors[fi] ? colors[fi] : color;
      ctx.fillStyle = typeof col === 'function' ? col(br, nx, ny, nz) : R.css(col, br, opt && opt.alpha);
      ctx.fill();
      if (this.outline) { ctx.strokeStyle = this.outline; ctx.lineWidth = 0.5; ctx.stroke(); }
      if (opt && opt.deco && opt.deco[fi]) opt.deco[fi](ctx, W, this);
    }
  };
  // Cilindro vertical centrado em (a,d) local
  MP.cyl = function (a, d, r, z0, z1, color, opt) {
    const ctx = this.ctx;
    const x = this.X(a, d), y = this.Y(a, d);
    const cx = this.ax + (x - y) * 32, cyb = this.ay + (x + y) * 16 - z0 * ZPX, cyt = this.ay + (x + y) * 16 - z1 * ZPX;
    const rx = r * 45.25, ry = r * 22.63;
    const col = R.hex(color), L = this.light;
    const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    g.addColorStop(0, R.css(col, 0.62 * L));
    g.addColorStop(0.35, R.css(col, 1.02 * L));
    g.addColorStop(0.7, R.css(col, 0.86 * L));
    g.addColorStop(1, R.css(col, 0.6 * L));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cyt);
    ctx.lineTo(cx - rx, cyb);
    ctx.ellipse(cx, cyb, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rx, cyt);
    ctx.closePath();
    ctx.fill();
    if (!(opt && opt.noTop)) {
      ctx.fillStyle = R.css(opt && opt.top ? opt.top : col, (opt && opt.topBright || 1.08) * L);
      ctx.beginPath(); ctx.ellipse(cx, cyt, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    this.pts.push(cx - rx, cyt - ry, cx + rx, cyt - ry, cx - rx, cyb + ry, cx + rx, cyb + ry, cx, cyt - ry, cx, cyb + ry);
    return { cx, cyb, cyt, rx, ry };
  };
  // Bolha (folhagem): círculo sombreado
  MP.blob = function (a, d, z, r, color, opt) {
    const ctx = this.ctx;
    const x = this.X(a, d), y = this.Y(a, d);
    const cx = this.ax + (x - y) * 32, cy = this.ay + (x + y) * 16 - z * ZPX;
    const rr = r * 38 * (opt && opt.sx || 1), ry = r * 38 * (opt && opt.sy || 0.86);
    const col = R.hex(color), L = this.light;
    const g = ctx.createRadialGradient(cx - rr * 0.35, cy - ry * 0.45, rr * 0.1, cx, cy, rr * 1.05);
    g.addColorStop(0, R.css(col, 1.22 * L));
    g.addColorStop(0.55, R.css(col, 0.98 * L));
    g.addColorStop(1, R.css(col, 0.66 * L));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, rr, ry, 0, 0, Math.PI * 2); ctx.fill();
    this.pts.push(cx - rr, cy, cx + rr, cy, cx, cy - ry, cx, cy + ry, cx - rr * 0.7, cy - ry * 0.7, cx + rr * 0.7, cy - ry * 0.7, cx - rr * 0.7, cy + ry * 0.7, cx + rr * 0.7, cy + ry * 0.7);
    return { cx, cy, rr, ry };
  };
  // Linha 3D local (poste, cabo, perna)
  MP.line = function (a0, d0, z0, a1, d1, z1, color, width, cap) {
    const ctx = this.ctx;
    const p = this.p(a0, d0, z0), q = this.p(a1, d1, z1);
    ctx.strokeStyle = typeof color === 'string' && color[0] !== '#' ? color : R.css(color, this.light);
    ctx.lineWidth = width;
    ctx.lineCap = cap || 'butt';
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    this.pts.push(p[0] - width, p[1], q[0] + width, q[1], p[0] + width, p[1], q[0] - width, q[1]);
  };
  // Elipse deitada no plano z (sombra de contato, tampo, poça)
  MP.flatEllipse = function (a, d, z, ra, rd, fill) {
    const ctx = this.ctx;
    this.topDeco(z, (c) => { c.fillStyle = fill; c.beginPath(); c.ellipse(a, d, ra, rd, 0, 0, Math.PI * 2); c.fill(); });
  };
  R.Model = Model;
  R.model = (ctx, ax, ay, rot, A, D) => new Model(ctx, ax, ay, rot, A, D);

  // Paletas compartilhadas (tons dessaturados, verão do interior americano)
  R.PAL = {
    carBody: ['#6e2b2b', '#2f3f5c', '#c9c2ae', '#e6e4dc', '#9aa0a3', '#3f5a45', '#a4553a', '#1f2124', '#4f7473', '#7a6a4c', '#8b8f5a', '#5a4a6a'],
    fabric: ['#6b4e3a', '#4f6152', '#56617a', '#8a7a62', '#7a4a48', '#5d6b6e', '#8e8a74', '#6a5a70'],
    blanket: ['#7b8fa6', '#a45c55', '#6f8a6a', '#c9b48a', '#8a6f9a', '#5f7c8c', '#b98a5e', '#9aa39a'],
    paint: ['#d9d2c0', '#c8cdb8', '#bfc9cc', '#d8c9b5', '#cbb8ad', '#b9bfae', '#d6cfb7', '#c7c2cf', '#b7c3b0', '#d3c3a6'],
    carpet: ['#8a7f6a', '#6f7a80', '#8a6a66', '#6d7a62', '#9a8f7a', '#7a6f86', '#5f6a6e', '#a08a70'],
    woodFloor: ['#9a7248', '#7e5a3a', '#b08a5c', '#8a6a48', '#a68058', '#6e4e34'],
    tileFloor: ['#d9d6cc', '#cfd8d6', '#e2dac8', '#c6d0c4', '#d8d2d8', '#c9c9c3'],
    lino: ['#b9b09a', '#a9b0a0', '#c2b59a', '#9fa7a8', '#b8a88c', '#a8a08a'],
    book: ['#7a2a24', '#2a4a6a', '#3e5a34', '#8a6a2a', '#5a3a5a', '#2a2a2a', '#a8894a', '#4a6a7a', '#8a3a2a', '#c8b89a', '#6a2a3a', '#335544'],
    product: ['#c43c30', '#e0b030', '#3a78b0', '#3a8a4a', '#e6e0d0', '#d86a2a', '#7a3a8a', '#2a5a9a', '#b03a5a', '#f0d070', '#5ab0a0', '#8a5a3a'],
    wood: ['#7a5436', '#8b6441', '#6b4a30', '#9a7450', '#5e4430'],
  };
})();
