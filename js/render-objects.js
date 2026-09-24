/* =====================================================================
 * VALE QUIETO — render-objects.js  (Etapa 2: Render)
 * Sprites procedurais de TODOS os objetos do mapa, gerados com o kit 3D
 * (R.Model) em coordenadas locais (a = largura, d = profundidade/frente,
 * z = altura em metros) e guardados em cache por (tipo, rot, variante,
 * estado, escala). Cada sprite guarda seu contorno convexo (para o mapa
 * de luz), o ponto da lâmpada (brilho) e a base do tronco (balanço).
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, U = G.util;
  const RO = (R.objects = {});
  const ZPX = R.ZPX;
  let S = 1, map = null;
  const cache = new Map();

  // ------------------------------------------------------------------
  // Fila de desenho com ordenação por profundidade dentro do objeto
  // ------------------------------------------------------------------
  const MP = R.Model.prototype;
  MP.begin = function () { this.q = []; return this; };
  MP._wb = function (a0, a1, d0, d1) {
    const xs = [this.X(a0, d0), this.X(a1, d0), this.X(a0, d1), this.X(a1, d1)];
    const ys = [this.Y(a0, d0), this.Y(a1, d0), this.Y(a0, d1), this.Y(a1, d1)];
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };
  MP.qpush = function (a0, a1, d0, d1, z0, z1, fn) {
    const b = this._wb(a0, a1, d0, d1);
    this.q.push({ x0: b[0], x1: b[1], y0: b[2], y1: b[3], z0, z1, fn, i: this.q.length });
  };
  MP.B = function (a0, a1, d0, d1, z0, z1, color, deco, opt) { this.qpush(a0, a1, d0, d1, z0, z1, () => this.box(a0, a1, d0, d1, z0, z1, color, deco, opt)); return this; };
  MP.C = function (a, d, r, z0, z1, color, opt) { this.qpush(a - r, a + r, d - r, d + r, z0, z1, () => this.cyl(a, d, r, z0, z1, color, opt)); return this; };
  MP.Bl = function (a, d, z, r, color, opt) { this.qpush(a - r * 0.7, a + r * 0.7, d - r * 0.7, d + r * 0.7, z - r * 0.5, z + r * 0.5, () => this.blob(a, d, z, r, color, opt)); return this; };
  MP.L = function (a0, d0, z0, a1, d1, z1, color, w, cap) { this.qpush(Math.min(a0, a1), Math.max(a0, a1) + 1e-3, Math.min(d0, d1), Math.max(d0, d1) + 1e-3, Math.min(z0, z1), Math.max(z0, z1), () => this.line(a0, d0, z0, a1, d1, z1, color, w, cap)); return this; };
  MP.P = function (profile, a0, a1, color, opt) {
    let d0 = 1e9, d1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of profile) { d0 = Math.min(d0, p[0]); d1 = Math.max(d1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    this.qpush(a0, a1, d0, d1, z0, z1, () => this.prism(profile, a0, a1, color, opt)); return this;
  };
  MP.F = function (a0, a1, d0, d1, z0, z1, fn) { this.qpush(a0, a1, d0, d1, z0, z1, () => fn(this)); return this; };
  function before(A, B) {
    const e = 1e-4;
    const ox = A.x0 < B.x1 - e && B.x0 < A.x1 - e, oy = A.y0 < B.y1 - e && B.y0 < A.y1 - e;
    if (ox && oy) {
      if (A.z1 <= B.z0 + e) return 1;
      if (B.z1 <= A.z0 + e) return -1;
    }
    if (A.x1 <= B.x0 + e && oy) return 1;
    if (B.x1 <= A.x0 + e && oy) return -1;
    if (A.y1 <= B.y0 + e && ox) return 1;
    if (B.y1 <= A.y0 + e && ox) return -1;
    const ka = A.x0 + A.x1 + A.y0 + A.y1 + (A.z0 + A.z1) * 0.3, kb = B.x0 + B.x1 + B.y0 + B.y1 + (B.z0 + B.z1) * 0.3;
    return ka < kb ? 1 : ka > kb ? -1 : A.i < B.i ? 1 : -1;
  }
  MP.end = function () {
    const q = this.q, n = q.length;
    const indeg = new Int16Array(n), adj = [];
    for (let i = 0; i < n; i++) adj.push([]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const r = before(q[i], q[j]);
      if (r > 0) { adj[i].push(j); indeg[j]++; } else { adj[j].push(i); indeg[i]++; }
    }
    const done = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      let pick = -1;
      for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0) { pick = i; break; }
      if (pick < 0) { let best = 1e9; for (let i = 0; i < n; i++) if (!done[i] && indeg[i] < best) { best = indeg[i]; pick = i; } }
      done[pick] = 1;
      for (const j of adj[pick]) indeg[j]--;
      q[pick].fn();
    }
    this.q = [];
  };

  // ------------------------------------------------------------------
  // Utilidades de modelo
  // ------------------------------------------------------------------
  const pick = (arr, v) => arr[((v % arr.length) + arr.length) % arr.length];
  const WHITE = '#e4e2dc', STEEL = '#b4b9bc', DARK = '#2d2c2b';
  function roomType(o) { return o.room && map && map.rooms[o.room - 1] ? map.rooms[o.room - 1].type : null; }
  function drawers(n, col, knob) {
    return (g, f) => {
      const h = (f.z1 - f.z0 - 0.08) / n;
      g.strokeStyle = R.css(col, 0.62); g.lineWidth = 0.018;
      for (let k = 0; k < n; k++) {
        const z = f.z0 + 0.05 + k * h;
        g.strokeRect(f.u0 + 0.06, z + 0.02, f.u1 - f.u0 - 0.12, h - 0.04);
        g.fillStyle = knob || '#c8b070';
        g.beginPath(); g.arc((f.u0 + f.u1) / 2, z + h / 2, 0.025, 0, 6.283); g.fill();
      }
    };
  }
  function doors2(col, handle) {
    return (g, f) => {
      const m = (f.u0 + f.u1) / 2;
      g.strokeStyle = R.css(col, 0.6); g.lineWidth = 0.02;
      g.strokeRect(f.u0 + 0.04, f.z0 + 0.04, m - f.u0 - 0.06, f.z1 - f.z0 - 0.08);
      g.strokeRect(m + 0.02, f.z0 + 0.04, f.u1 - m - 0.06, f.z1 - f.z0 - 0.08);
      g.fillStyle = handle || '#b8b0a0';
      g.fillRect(m - 0.07, f.z1 - 0.2, 0.025, 0.1); g.fillRect(m + 0.045, f.z1 - 0.2, 0.025, 0.1);
    };
  }

  // Árvores: copa = silhueta escura irregular + dezenas de tufos de folhas iluminados
  // (luz de cima/esquerda), ordenados por profundidade, com pontinhos de folhas.
  function canopy(M, a, d, zc, rad, cols, rng, n, flat) {
    const ctx = M.ctx;
    const c0 = M.p(a, d, zc);
    const Rx = rad * 40, Ry = rad * 34 * (flat ? 0.85 + flat * 0.2 : 1);
    const base = cols.map((c) => R.hex(c));
    const dark = R.darken(base[0], 0.45);
    // silhueta de fundo (sombra interna)
    ctx.fillStyle = R.css(dark);
    for (let k = 0; k < 14; k++) {
      const t = rng() * 6.283, rr = 0.55 + rng() * 0.3;
      const x = c0[0] + Math.cos(t) * Rx * rr * 0.6, y = c0[1] + Math.sin(t) * Ry * rr * 0.55 + Ry * 0.08;
      ctx.beginPath(); ctx.arc(x, y, Rx * (0.32 + rng() * 0.18), 0, 6.283); ctx.fill();
    }
    // tufos na superfície de um elipsoide
    const clumps = [];
    const N = n * 6 + 16;
    for (let k = 0; k < N; k++) {
      const th = rng() * 6.283;
      const ph = Math.acos(1 - 2 * rng()); // esfera uniforme
      let nx = Math.sin(ph) * Math.cos(th), ny = Math.sin(ph) * Math.sin(th), nz = Math.cos(ph);
      if (nz < -0.55) nz = -0.55 + rng() * 0.2; // base achatada
      // posição em tela (x: esquerda/direita, y: vertical com profundidade)
      const sx = c0[0] + nx * Rx * 0.88, sy = c0[1] - nz * Ry * 0.78 + ny * Ry * 0.32;
      const depth = ny * 0.7 - nz * 0.1; // >0: mais perto da câmera
      const lit = -nx * 0.55 + nz * 0.75 + ny * 0.25; // luz de cima-esquerda-frente
      clumps.push({ sx, sy, depth, lit, r: Rx * (0.13 + rng() * 0.11), c: base[(rng() * base.length) | 0] });
    }
    clumps.sort((p, q) => p.depth - q.depth);
    for (const cl of clumps) {
      const L = 0.66 + Math.max(-0.25, cl.lit) * 0.5;
      const g = ctx.createRadialGradient(cl.sx - cl.r * 0.4, cl.sy - cl.r * 0.45, cl.r * 0.1, cl.sx, cl.sy, cl.r * 1.05);
      g.addColorStop(0, R.css(cl.c, L * 1.12));
      g.addColorStop(0.7, R.css(cl.c, L));
      g.addColorStop(1, R.css(cl.c, L * 0.84));
      ctx.fillStyle = g;
      ctx.beginPath();
      // borda levemente irregular (folhagem)
      const pts = 9;
      for (let j = 0; j <= pts; j++) {
        const t = j / pts * 6.283, rr = cl.r * (0.86 + rng() * 0.22);
        const x = cl.sx + Math.cos(t) * rr, y = cl.sy + Math.sin(t) * rr * 0.9;
        if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      // folhas miúdas no lado iluminado
      const nd = Math.round(cl.r * 0.9);
      for (let j = 0; j < nd; j++) {
        const t = -2.4 + rng() * 2.2, rr = cl.r * (0.3 + rng() * 0.65);
        ctx.fillStyle = R.css(cl.c, L * (1.35 + rng() * 0.25), 0.85);
        ctx.fillRect(cl.sx + Math.cos(t) * rr, cl.sy + Math.sin(t) * rr * 0.9, 1.4, 1.1);
      }
      M.pts.push(cl.sx - cl.r, cl.sy, cl.sx + cl.r, cl.sy, cl.sx, cl.sy - cl.r, cl.sx, cl.sy + cl.r);
    }
    // folhas soltas na borda (silhueta menos redonda)
    for (let k = 0; k < 40; k++) {
      const t = rng() * 6.283, rr = 0.9 + rng() * 0.16;
      const x = c0[0] + Math.cos(t) * Rx * rr, y = c0[1] + Math.sin(t) * Ry * rr * 0.85 - Ry * 0.05;
      const up = Math.sin(t) < 0;
      ctx.fillStyle = R.css(base[(rng() * base.length) | 0], up ? 1.15 : 0.7);
      ctx.beginPath(); ctx.ellipse(x, y, 1.6 + rng() * 1.6, 1.2 + rng(), rng() * 3, 0, 6.283); ctx.fill();
    }
  }

  // ------------------------------------------------------------------
  // Modelos: fn(M, o, v, A, D, info)
  // ------------------------------------------------------------------
  const MODELS = {};
  const DEF = {}; // { h: altura máx (m), mx: margem lateral px, norot: ignora rot }
  function def(type, h, mx, fn, extra) { MODELS[type] = fn; DEF[type] = Object.assign({ h, mx }, extra || {}); }

  def('bed', 1.1, 8, (M, o, v, A, D) => {
    const wood = pick(R.PAL.wood, v), bl = pick(R.PAL.blanket, v * 3 + 1);
    const w0 = 0.04, w1 = A - 0.04;
    M.B(w0, w1, 0.04, D - 0.04, 0.08, 0.32, wood);
    M.B(w0 + 0.04, w1 - 0.04, 0.14, D - 0.1, 0.32, 0.5, '#e9e5dc');
    M.B(w0 + 0.01, w1 - 0.01, D * 0.36, D - 0.06, 0.3, 0.54, bl, { top: (g) => { g.fillStyle = R.css(bl, 1.18); g.fillRect(w0, D * 0.36, w1 - w0, 0.12); g.strokeStyle = R.css(bl, 0.8); g.lineWidth = 0.02; g.beginPath(); g.moveTo(w0 + 0.1, D * 0.7); g.lineTo(w1 - 0.1, D * 0.75); g.stroke(); } });
    const np = A > 1.5 ? 2 : 1;
    for (let k = 0; k < np; k++) { const a0 = w0 + 0.08 + k * (A - 0.08) / np; M.B(a0 + 0.04, a0 + (A - 0.24) / np, 0.2, 0.55, 0.5, 0.62, '#f3f0ea'); }
    M.B(0, A, 0, 0.1, 0, 1.0, wood, { front: (g, f) => { g.strokeStyle = R.css(wood, 0.7); g.lineWidth = 0.025; g.strokeRect(f.u0 + 0.08, 0.5, f.u1 - f.u0 - 0.16, 0.4); } });
    M.B(0, A, D - 0.08, D, 0, 0.58, wood);
  });
  MODELS.double_bed = MODELS.bed; DEF.double_bed = DEF.bed;
  def('sofa', 1.0, 8, (M, o, v, A, D) => {
    const c = pick(R.PAL.fabric, v);
    M.B(0.06, A - 0.06, 0.12, D - 0.05, 0, 0.08, DARK);
    M.B(0.02, A - 0.02, 0.08, D - 0.04, 0.08, 0.4, c);
    M.B(0.04, A - 0.04, 0.04, 0.32, 0.4, 0.88, c, { top: (g) => { g.fillStyle = R.css(c, 1.12); g.fillRect(0.04, 0.04, A - 0.08, 0.28); } });
    M.B(0, 0.2, 0.06, D - 0.04, 0.4, 0.64, c); M.B(A - 0.2, A, 0.06, D - 0.04, 0.4, 0.64, c);
    const n = A > 1.5 ? 2 : 1;
    for (let k = 0; k < n; k++) { const a0 = 0.2 + k * (A - 0.4) / n; M.B(a0 + 0.01, a0 + (A - 0.4) / n - 0.01, 0.32, D - 0.06, 0.4, 0.52, R.css(c, 1.05)); }
  });
  MODELS.armchair = MODELS.sofa; DEF.armchair = DEF.sofa;
  def('table', 1.0, 8, (M, o, v, A, D) => {
    const wood = pick(R.PAL.wood, v + 2);
    const L = [[0.1, 0.12], [A - 0.16, 0.12], [0.1, D - 0.18], [A - 0.16, D - 0.18]];
    for (const [a, d] of L) M.B(a, a + 0.06, d, d + 0.06, 0, 0.72, R.css(wood, 0.8));
    const cloth = v % 3 === 0;
    M.B(0.04, A - 0.04, 0.06, D - 0.06, 0.72, 0.77, cloth ? '#d8d0bc' : wood, {
      top: (g) => {
        if (cloth) { g.strokeStyle = 'rgba(160,60,50,0.5)'; g.lineWidth = 0.03; for (let a = 0.14; a < A - 0.06; a += 0.2) { g.beginPath(); g.moveTo(a, 0.08); g.lineTo(a, D - 0.08); g.stroke(); } }
        g.fillStyle = '#eeeae2'; g.beginPath(); g.ellipse(A * 0.3, D * 0.5, 0.11, 0.11, 0, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.ellipse(A * 0.3, D * 0.5, 0.06, 0.06, 0, 0, 6.283); g.fill();
      },
    });
    if (v & 1) M.C(A * 0.7, D * 0.45, 0.04, 0.77, 0.87, pick(['#b8453a', '#e0dcd0', '#3d5a7a'], v));
  });
  def('chair', 1.1, 6, (M, o, v, A, D) => {
    const wood = pick(R.PAL.wood, v);
    const a0 = 0.27, a1 = 0.73, d0 = 0.26, d1 = 0.72;
    for (const [a, d] of [[a0, d0], [a1 - 0.05, d0], [a0, d1 - 0.05], [a1 - 0.05, d1 - 0.05]]) M.B(a, a + 0.05, d, d + 0.05, 0, 0.44, R.css(wood, 0.8));
    M.B(a0 - 0.01, a1 + 0.01, d0, d1 + 0.02, 0.44, 0.49, wood);
    M.B(a0, a1, d0 - 0.02, d0 + 0.04, 0.49, 0.98, wood, { front: (g, f) => { g.fillStyle = R.css(wood, 0.8); g.fillRect(f.u0 + 0.08, 0.62, f.u1 - f.u0 - 0.16, 0.2); } });
  });
  def('counter', 1.2, 8, (M, o, v, A, D) => {
    const c = pick(['#8a6a4a', '#6e5a48', '#9a8a70', '#5a5048'], v);
    M.B(0.02, A - 0.02, 0.06, D - 0.06, 0, 0.92, c, { front: (g, f) => { g.strokeStyle = R.css(c, 0.7); g.lineWidth = 0.02; for (let u = f.u0 + 0.25; u < f.u1; u += 0.25) { g.beginPath(); g.moveTo(u, 0.08); g.lineTo(u, 0.85); g.stroke(); } } });
    M.B(-0.01, A + 0.01, 0.03, D - 0.03, 0.92, 0.98, '#3e3a36');
  });
  def('kitchen_counter', 1.3, 8, (M, o, v, A, D, info) => {
    const c = pick(['#e2ddd0', '#8a6a4a', '#b8b4a6', '#9c7c5a', '#dcd6c4', '#6e5a44'], info.bv);
    const top = pick(['#d8d2c2', '#5a5652', '#c9c0a8', '#e8e4dc'], info.bv + 1);
    M.B(0.03, A - 0.03, 0.06, D - 0.1, 0, 0.08, '#2a2826');
    M.B(0.02, A - 0.02, 0.04, D - 0.06, 0.08, 0.88, c, { front: doors2(c) });
    M.B(0, A, 0.02, D - 0.02, 0.88, 0.93, top);
    if (v === 2) M.B(0.25, 0.55, 0.3, 0.55, 0.93, 1.13, '#c8c4bc', { top: (g) => { g.fillStyle = '#333'; g.fillRect(0.3, 0.36, 0.2, 0.05); g.fillRect(0.3, 0.46, 0.2, 0.05); } });
    if (v === 5) M.C(0.6, 0.35, 0.09, 0.93, 1.15, '#8aa0a8');
    if (v === 6) M.C(0.35, 0.4, 0.12, 0.93, 1.0, '#d8c8a8', { top: '#b8452a' });
  });
  def('fridge', 2.0, 8, (M, o, v, A, D) => {
    const c = pick([WHITE, '#e2dac2', STEEL, '#d8d4c8'], v);
    M.B(0.08, A - 0.08, 0.1, D - 0.06, 0, 1.8, c, {
      front: (g, f) => {
        g.fillStyle = R.css(c, 0.7); g.fillRect(f.u0 + 0.02, 1.2, f.u1 - f.u0 - 0.04, 0.02);
        g.fillStyle = '#9a9a96'; g.fillRect(f.u0 + 0.08, 1.3, 0.03, 0.35); g.fillRect(f.u0 + 0.08, 0.7, 0.03, 0.4);
        if (v & 1) { for (let k = 0; k < 4; k++) { g.fillStyle = pick(R.PAL.product, v + k); g.fillRect(f.u0 + 0.3 + k * 0.1, 1.45 + (k & 1) * 0.12, 0.06, 0.06); } g.fillStyle = '#f4f0e0'; g.fillRect(f.u0 + 0.35, 1.0, 0.18, 0.14); }
      },
    });
  });
  def('stove', 1.3, 8, (M, o, v, A, D) => {
    const c = pick([WHITE, '#2a2a2a', '#e0d6bc', STEEL], v);
    M.B(0.05, A - 0.05, 0.08, D - 0.06, 0, 0.9, c, {
      top: (g) => {
        g.fillStyle = '#1c1c1c';
        for (const [a, d] of [[0.3, 0.35], [0.7, 0.35], [0.3, 0.68], [0.7, 0.68]]) { g.beginPath(); g.ellipse(a, d, 0.13, 0.13, 0, 0, 6.283); g.fill(); }
        g.strokeStyle = '#555'; g.lineWidth = 0.02;
        for (const [a, d] of [[0.3, 0.35], [0.7, 0.35], [0.3, 0.68], [0.7, 0.68]]) { g.beginPath(); g.ellipse(a, d, 0.08, 0.08, 0, 0, 6.283); g.stroke(); }
      },
      front: (g, f) => {
        g.fillStyle = '#1a1c1e'; g.fillRect(f.u0 + 0.15, 0.2, f.u1 - f.u0 - 0.3, 0.42);
        g.fillStyle = 'rgba(160,180,190,0.25)'; g.fillRect(f.u0 + 0.18, 0.5, f.u1 - f.u0 - 0.5, 0.08);
        g.fillStyle = '#aaa'; g.fillRect(f.u0 + 0.15, 0.7, f.u1 - f.u0 - 0.3, 0.03);
      },
    });
    M.B(0.05, A - 0.05, 0.02, 0.14, 0.9, 1.12, c, { front: (g, f) => { g.fillStyle = '#333'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(f.u0 + 0.18 + k * 0.2, 1.01, 0.03, 0, 6.283); g.fill(); } } });
  });
  def('sink', 1.3, 8, (M, o, v, A, D, info) => {
    const bath = info.room === 'bathroom';
    if (bath) {
      const c = WHITE;
      M.B(0.18, A - 0.18, 0.12, D - 0.22, 0, 0.82, pick(['#8a6a4a', '#e2ddd0', '#b8b0a0'], v), { front: doors2(pick(['#8a6a4a', '#e2ddd0', '#b8b0a0'], v)) });
      M.B(0.14, A - 0.14, 0.08, D - 0.16, 0.82, 0.88, c, { top: (g) => { g.fillStyle = '#c8ccd0'; g.beginPath(); g.ellipse(A / 2, D * 0.5, 0.22, 0.16, 0, 0, 6.283); g.fill(); g.fillStyle = '#9aa0a4'; g.beginPath(); g.ellipse(A / 2, D * 0.5, 0.04, 0.03, 0, 0, 6.283); g.fill(); } });
      M.C(A / 2, 0.16, 0.025, 0.88, 1.02, '#c8ccd0');
      M.B(0.3, A - 0.3, 0, 0.04, 1.2, 1.75, '#b8ccd4', { front: (g, f) => { g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(f.u0 + 0.05, 1.5, 0.1, 0.2); } });
      return;
    }
    const c = pick(['#e2ddd0', '#8a6a4a', '#b8b4a6', '#9c7c5a', '#dcd6c4', '#6e5a44'], info.bv);
    M.B(0.03, A - 0.03, 0.06, D - 0.1, 0, 0.08, '#2a2826');
    M.B(0.02, A - 0.02, 0.04, D - 0.06, 0.08, 0.88, c, { front: doors2(c) });
    M.B(0, A, 0.02, D - 0.02, 0.88, 0.93, pick(['#d8d2c2', '#5a5652', '#c9c0a8', '#e8e4dc'], info.bv + 1), {
      top: (g) => { g.fillStyle = '#9ea4a8'; g.fillRect(0.14, 0.26, A - 0.28, 0.5); g.fillStyle = '#7a8084'; g.fillRect(0.18, 0.3, A - 0.36, 0.42); g.fillStyle = '#c8ccd0'; g.fillRect(0.47, 0.3, 0.06, 0.42); },
    });
    M.L(0.5, 0.15, 0.93, 0.5, 0.15, 1.18, '#c8ccd0', 1.6, 'round');
    M.L(0.5, 0.15, 1.18, 0.5, 0.35, 1.12, '#c8ccd0', 1.4, 'round');
  });
  def('toilet', 1.0, 6, (M, o, v, A, D) => {
    M.B(0.36, 0.64, 0.34, 0.7, 0, 0.36, WHITE);
    M.C(0.5, 0.6, 0.2, 0.26, 0.42, WHITE, { top: '#f2f2ee' });
    M.F(0.3, 0.7, 0.4, 0.8, 0.42, 0.43, (m) => m.flatEllipse(0.5, 0.6, 0.13, 0.15, 0.425, '#9aa6ac'));
    M.B(0.26, 0.74, 0.08, 0.3, 0.32, 0.78, WHITE, { top: (g) => { g.fillStyle = '#c8c8c2'; g.fillRect(0.6, 0.15, 0.06, 0.04); } });
  });
  def('bathtub', 1.0, 8, (M, o, v, A, D) => {
    M.B(0.02, A - 0.02, 0.04, D - 0.04, 0, 0.56, WHITE, {
      top: (g) => {
        g.fillStyle = '#c8d6da'; g.beginPath();
        if (g.roundRect) g.roundRect(0.14, 0.14, A - 0.28, D - 0.28, 0.18); else g.rect(0.14, 0.14, A - 0.28, D - 0.28);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0.3, 0.2, A * 0.3, 0.06);
      },
    });
    M.C(0.14, D / 2, 0.03, 0.56, 0.72, '#c8ccd0');
    if (v & 1) M.B(0.6, A - 0.1, D - 0.1, D + 0.04, 0.3, 0.95, pick(R.PAL.blanket, v), { top: false });
  });
  def('shower', 2.2, 6, (M, o, v, A, D) => {
    M.B(0.04, A - 0.04, 0.04, D - 0.04, 0, 0.09, WHITE);
    M.L(A / 2, 0.08, 0.09, A / 2, 0.08, 1.95, '#b0b6ba', 1.4);
    M.B(A / 2 - 0.08, A / 2 + 0.08, 0.08, 0.3, 1.9, 1.96, '#c0c6ca');
    const glassFace = (g, f) => { g.fillStyle = 'rgba(190,220,232,0.28)'; g.fillRect(f.u0, 0.09, f.u1 - f.u0, 1.9); g.strokeStyle = '#9aa2a6'; g.lineWidth = 0.03; g.strokeRect(f.u0, 0.09, f.u1 - f.u0, 1.9); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(f.u0 + 0.1, 0.5, 0.05, 1.2); };
    if (v & 1) M.B(0.04, A - 0.04, D - 0.07, D - 0.04, 0.09, 1.99, 'rgba(0,0,0,0)', { front: (g, f) => { const c = pick(R.PAL.blanket, v); for (let u = f.u0; u < f.u1; u += 0.08) { g.fillStyle = R.css(c, 0.85 + 0.2 * Math.sin(u * 40)); g.fillRect(u, 0.3, 0.085, 1.66); } } }, { alpha: 0 });
    else {
      M.F(0.04, A - 0.04, D - 0.06, D - 0.04, 0.09, 1.99, (m) => m.faceDeco('front', 0.04, A - 0.04, D - 0.06, D - 0.04, 0.09, 1.99, glassFace));
      M.F(A - 0.06, A - 0.04, 0.04, D - 0.04, 0.09, 1.99, (m) => m.faceDeco('right', A - 0.06, A - 0.04, 0.04, D - 0.04, 0.09, 1.99, glassFace));
    }
  });
  def('wardrobe', 2.2, 8, (M, o, v, A, D) => {
    const c = pick(R.PAL.wood, v + 1);
    M.B(0.04, A - 0.04, 0.12, D - 0.06, 0, 2.0, c, { front: doors2(c, '#c8b070') });
    M.B(0.02, A - 0.02, 0.1, D - 0.04, 2.0, 2.05, R.css(c, 0.85));
  });
  def('dresser', 1.4, 8, (M, o, v, A, D) => {
    const c = pick(R.PAL.wood, v + 3);
    M.B(0.05, A - 0.05, 0.16, D - 0.08, 0, 0.88, c, { front: drawers(3, c) });
    M.B(0.03, A - 0.03, 0.14, D - 0.06, 0.88, 0.92, R.css(c, 1.1));
    if (v & 1) M.B(0.3, 0.7, 0.18, 0.24, 0.92, 1.35, c, { front: (g, f) => { g.fillStyle = '#9ab4bc'; g.fillRect(f.u0 + 0.04, 0.96, f.u1 - f.u0 - 0.08, 0.35); } });
    else M.C(0.25, 0.45, 0.06, 0.92, 1.12, pick(['#d8c090', '#c8a0a0', '#a0b8c8'], v));
  });
  def('bookshelf', 2.1, 8, (M, o, v, A, D) => {
    const c = pick(R.PAL.wood, v);
    const rng = U.rng(o.id * 31 + 7);
    M.B(0.04, A - 0.04, 0.12, 0.18, 0, 1.9, R.css(c, 0.8));
    M.B(0.04, 0.1, 0.12, D - 0.14, 0, 1.9, c); M.B(A - 0.1, A - 0.04, 0.12, D - 0.14, 0, 1.9, c);
    const levels = [0, 0.46, 0.92, 1.38];
    for (const z of levels) {
      M.B(0.1, A - 0.1, 0.18, D - 0.14, z, z + 0.04, c);
      let a = 0.11;
      while (a < A - 0.14) {
        const w = 0.035 + rng() * 0.04, h = 0.25 + rng() * 0.14;
        if (rng() < 0.1) { a += w * 2; continue; }
        const col = pick(R.PAL.book, (rng() * 12) | 0);
        M.B(a, Math.min(A - 0.11, a + w), 0.22, D - 0.2 - rng() * 0.08, z + 0.04, z + 0.04 + h, col, { front: (g, f) => { g.fillStyle = 'rgba(230,210,150,0.5)'; g.fillRect(f.u0, z + 0.04 + h * 0.7, f.u1 - f.u0, 0.02); } });
        a += w + 0.004;
      }
    }
    M.B(0.04, A - 0.04, 0.12, D - 0.14, 1.9, 1.94, c);
  });
  def('tv', 1.3, 8, (M, o, v, A, D) => {
    const st = pick(['#4a3a2c', '#2e2a26', '#6a5238'], v);
    M.B(0.08, A - 0.08, 0.2, D - 0.12, 0, 0.5, st, { front: (g, f) => { g.strokeStyle = R.css(st, 0.6); g.lineWidth = 0.02; g.strokeRect(f.u0 + 0.05, 0.05, f.u1 - f.u0 - 0.1, 0.38); } });
    M.B(0.2, A - 0.2, 0.28, D - 0.2, 0.5, 0.98, '#3a3836', {
      front: (g, f) => {
        g.fillStyle = '#141a1c'; g.fillRect(f.u0 + 0.06, 0.58, f.u1 - f.u0 - 0.16, 0.34);
        g.fillStyle = 'rgba(140,170,180,0.18)'; g.fillRect(f.u0 + 0.1, 0.8, 0.15, 0.08);
        g.fillStyle = '#777'; g.fillRect(f.u1 - 0.08, 0.7, 0.03, 0.03); g.fillRect(f.u1 - 0.08, 0.64, 0.03, 0.03);
      },
    });
    M.L(0.5, 0.5, 0.98, 0.35, 0.45, 1.3, '#555', 0.7);
    M.L(0.5, 0.5, 0.98, 0.68, 0.5, 1.28, '#555', 0.7);
  });
  def('desk', 1.5, 8, (M, o, v, A, D) => {
    const c = pick(R.PAL.wood, v + 2);
    M.B(0.06, 0.55, 0.12, D - 0.1, 0, 0.72, c, { front: drawers(3, c) });
    M.B(A - 0.12, A - 0.06, 0.12, D - 0.12, 0, 0.72, R.css(c, 0.8));
    M.B(0.02, A - 0.02, 0.08, D - 0.06, 0.72, 0.77, c);
    if (v % 3 === 0) {
      M.B(A * 0.45, A * 0.45 + 0.42, 0.18, 0.55, 0.77, 1.15, '#d4ceb8', { front: (g, f) => { g.fillStyle = '#20282a'; g.fillRect(f.u0 + 0.06, 0.84, f.u1 - f.u0 - 0.12, 0.26); g.fillStyle = 'rgba(120,170,140,0.25)'; g.fillRect(f.u0 + 0.08, 0.95, 0.1, 0.1); } });
      M.B(A * 0.45, A * 0.45 + 0.45, 0.62, 0.8, 0.77, 0.8, '#cfc8b4');
    } else {
      M.F(0.1, A - 0.1, 0.2, D - 0.2, 0.77, 0.78, (m) => m.topDeco(0.775, (g) => { g.fillStyle = '#ece8dc'; g.save(); g.translate(A * 0.4, D * 0.5); g.rotate(0.2); g.fillRect(-0.15, -0.2, 0.3, 0.4); g.rotate(-0.4); g.fillRect(0.05, -0.15, 0.3, 0.38); g.restore(); }));
      M.C(A - 0.3, 0.3, 0.06, 0.77, 1.1, '#555');
      M.C(A - 0.3, 0.3, 0.13, 1.1, 1.22, '#2f5a3a');
    }
  });
  def('shelf', 1.9, 8, (M, o, v, A, D) => {
    const rng = U.rng(o.id * 17 + 3);
    const frame = '#8a8e90';
    M.B(0.02, A - 0.02, 0.06, D - 0.06, 0, 0.12, '#55585a');
    M.B(0.02, A - 0.02, 0.46, 0.54, 0.12, 1.72, '#9ea2a4');
    M.B(0.02, 0.06, 0.06, D - 0.06, 0.12, 1.72, frame); M.B(A - 0.06, A - 0.02, 0.06, D - 0.06, 0.12, 1.72, frame);
    const levels = [0.12, 0.56, 1.0, 1.44];
    for (const z of levels) {
      M.B(0.06, A - 0.06, 0.08, D - 0.08, z, z + 0.03, '#b8bcbe');
      for (const side of [0, 1]) {
        let a = 0.08;
        const d0 = side ? 0.56 : 0.1, d1 = side ? D - 0.1 : 0.44;
        while (a < A - 0.1) {
          const w = 0.1 + rng() * 0.08, h = 0.12 + rng() * 0.22;
          if (rng() < 0.18) { a += w; continue; } // prateleira saqueada
          const col = pick(R.PAL.product, (rng() * 12) | 0);
          if (rng() < 0.35) M.C(a + w / 2, (d0 + d1) / 2, Math.min(0.08, w / 2), z + 0.03, z + 0.03 + h * 0.7, col, { top: R.css(col, 1.3) });
          else M.B(a, Math.min(A - 0.08, a + w - 0.01), d0 + rng() * 0.05, d1 - rng() * 0.05, z + 0.03, z + 0.03 + h, col, { front: (g, f) => { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(f.u0, z + 0.03 + h * 0.4, f.u1 - f.u0, h * 0.25); }, back: (g, f) => { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(f.u0, z + 0.03 + h * 0.4, f.u1 - f.u0, h * 0.25); } });
          a += w;
        }
      }
    }
  });
  def('cash_register', 1.4, 8, (M, o, v, A, D) => {
    M.B(0.04, A - 0.04, 0.06, D - 0.06, 0, 0.92, '#6a5a4a', { front: (g, f) => { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(f.u0 + 0.05, 0.1, f.u1 - f.u0 - 0.1, 0.7); } });
    M.B(0.02, A - 0.02, 0.04, D - 0.04, 0.92, 0.96, '#3a3632');
    M.B(0.25, 0.75, 0.3, 0.72, 0.96, 1.08, '#7a7e80');
    M.P([[0.32, 1.08], [0.52, 1.08], [0.48, 1.24], [0.36, 1.22]], 0.3, 0.7, '#8a8e90');
    M.F(0.3, 0.7, 0.4, 0.44, 1.2, 1.24, (m) => m.topDeco(1.21, (g) => { g.fillStyle = '#3a8a5a'; g.fillRect(0.38, 0.36, 0.24, 0.06); }));
  });
  def('crate', 0.8, 6, (M, o, v, A, D) => {
    const c = pick(['#a07c52', '#8e6c46', '#b08a5c'], v);
    const deco = (g, f) => {
      g.strokeStyle = R.css(c, 0.62); g.lineWidth = 0.02;
      for (let z = f.z0 + 0.15; z < f.z1; z += 0.15) { g.beginPath(); g.moveTo(f.u0, z); g.lineTo(f.u1, z); g.stroke(); }
      g.lineWidth = 0.05; g.strokeStyle = R.css(c, 0.8); g.beginPath(); g.moveTo(f.u0 + 0.05, f.z0 + 0.05); g.lineTo(f.u1 - 0.05, f.z1 - 0.05); g.stroke();
      g.strokeRect(f.u0 + 0.03, f.z0 + 0.03, f.u1 - f.u0 - 0.06, f.z1 - f.z0 - 0.06);
    };
    M.B(0.1, A - 0.1, 0.1, D - 0.1, 0, 0.62, c, { front: deco, back: deco, left: deco, right: deco, top: (g) => { g.strokeStyle = R.css(c, 0.65); g.lineWidth = 0.02; for (let a = 0.25; a < A - 0.1; a += 0.15) { g.beginPath(); g.moveTo(a, 0.1); g.lineTo(a, D - 0.1); g.stroke(); } } });
  });
  def('trash_can', 1.1, 6, (M, o, v, A, D) => {
    if (v < 4) {
      const c = pick(['#8a8e8c', '#6a7068', '#7a7a72', '#5a6a5a'], v);
      const b = M.cyl(0.5, 0.5, 0.25, 0, 0.82, c);
      const ctx = M.ctx;
      ctx.strokeStyle = R.css(c, 0.7); ctx.lineWidth = 0.8;
      for (let k = 1; k < 5; k++) { const y = b.cyb - (b.cyb - b.cyt) * k / 5; ctx.beginPath(); ctx.ellipse(b.cx, y, b.rx, b.ry, 0, 0, Math.PI); ctx.stroke(); }
      M.cyl(0.5, 0.5, 0.27, 0.82, 0.88, R.css(c, 1.1));
      M.cyl(0.5, 0.5, 0.05, 0.88, 0.94, '#555');
    } else {
      const c = pick(['#2f4a34', '#34404c', '#3a3a3a', '#5a4a30'], v);
      M.B(0.22, 0.78, 0.24, 0.8, 0.05, 0.95, c, { front: (g, f) => { g.fillStyle = R.css(c, 1.25); g.fillRect(f.u0 + 0.1, 0.75, f.u1 - f.u0 - 0.2, 0.05); } });
      M.B(0.19, 0.81, 0.2, 0.84, 0.95, 1.01, R.css(c, 1.1));
      M.C(0.25, 0.28, 0.07, 0, 0.1, '#1a1a1a'); M.C(0.75, 0.28, 0.07, 0, 0.1, '#1a1a1a');
    }
  }, { norot: false });
  def('dumpster', 1.5, 8, (M, o, v, A, D) => {
    const c = pick(['#2f5a3c', '#2e4a6a', '#5a4a2a', '#4a5a4a'], v);
    const deco = (g, f) => {
      g.strokeStyle = R.css(c, 0.65); g.lineWidth = 0.03;
      for (let u = f.u0 + 0.3; u < f.u1; u += 0.3) { g.beginPath(); g.moveTo(u, 0.18); g.lineTo(u, 1.1); g.stroke(); }
      g.fillStyle = 'rgba(120,70,40,0.4)'; g.fillRect(f.u0 + 0.2, 0.2, 0.3, 0.2); g.fillRect(f.u1 - 0.5, 0.5, 0.25, 0.15);
    };
    M.B(0.06, A - 0.06, 0.1, D - 0.08, 0.12, 1.15, c, { front: deco, back: deco });
    M.P([[0.06, 1.15], [D - 0.04, 1.15], [D - 0.04, 1.22], [0.06, 1.34]], 0.02, A - 0.02, R.css(c, 0.8));
    for (const [a, d] of [[0.2, 0.2], [A - 0.2, 0.2], [0.2, D - 0.2], [A - 0.2, D - 0.2]]) M.C(a, d, 0.06, 0, 0.12, '#1a1a1a');
  });
  def('rock', 0.9, 8, (M, o, v, A, D) => {
    const rng = U.rng(o.id * 7 + 11);
    const c = pick(['#8a877e', '#7a766c', '#948f84', '#6e6b64', '#858276'], v);
    const n = 1 + (v & 1) + (v === 5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const a = 0.32 + rng() * 0.36, d = 0.32 + rng() * 0.36, r = (0.2 + rng() * 0.16) * (k ? 0.7 : 1), h = r * (0.7 + rng() * 0.6);
      // pedra facetada: casco convexo irregular (topo + base)
      const m = 7, top = [], bot = [];
      for (let j = 0; j < m; j++) {
        const t = j / m * 6.283 + rng() * 0.5, rr = r * (0.7 + rng() * 0.45);
        bot.push([a + Math.cos(t) * rr, d + Math.sin(t) * rr, 0]);
        top.push([a + Math.cos(t) * rr * 0.62, d + Math.sin(t) * rr * 0.62, h * (0.75 + rng() * 0.25)]);
      }
      const faces = [top.slice(), bot.slice().reverse()];
      for (let j = 0; j < m; j++) faces.push([bot[j], bot[(j + 1) % m], top[(j + 1) % m], top[j]]);
      M.F(a - r, a + r, d - r, d + r, 0, h, (mm) => {
        mm.convex(faces, c);
        const p = mm.p(a - r * 0.2, d - r * 0.1, h * 0.9);
        mm.ctx.fillStyle = 'rgba(96,118,64,0.55)'; mm.ctx.beginPath(); mm.ctx.ellipse(p[0], p[1], r * 16, r * 7, 0, 0, 6.283); mm.ctx.fill();
      });
    }
  }, { norot: true });
  def('tree', 7.2, 96, (M, o, v) => {
    const rng = U.rng(o.id * 13 + v * 7 + 1);
    const species = v % 8;
    const birch = species === 6, sparse = species === 7;
    const trunk = birch ? '#d8d4cc' : pick(['#5a4636', '#4e3e30', '#63503e'], v);
    const h = 1.9 + rng() * 0.6;
    const zc = h + 1.9 + rng() * 0.6;
    const rad = birch ? 1.05 : 1.35 + rng() * 0.35;
    const cols = birch ? ['#7d9a4a', '#8fa656', '#6d8a42', '#a0aa5c'] : species >= 4 ? ['#5d7a36', '#6f8a40', '#557234', '#7a8c44', '#6a7e3c'] : ['#46622e', '#50702f', '#3e5a2a', '#5a7438', '#4a6630'];
    // tronco + galhos
    M.cyl(0.5, 0.5, 0.13, 0, h + 0.8, trunk);
    if (birch) { const b = M.p(0.5, 0.5, 0); M.ctx.fillStyle = '#2a2622'; for (let k = 0; k < 6; k++) M.ctx.fillRect(b[0] - 4 + rng() * 5, b[1] - (0.3 + rng() * (h)) * ZPX, 3, 1); }
    M.line(0.5, 0.5, h, 0.2, 0.3, h + 1.0, trunk, 3, 'round');
    M.line(0.5, 0.5, h + 0.2, 0.85, 0.6, h + 1.2, trunk, 2.6, 'round');
    if (sparse) {
      for (let k = 0; k < 7; k++) { const a = 0.5 + (rng() - 0.5) * 2.2, d = 0.5 + (rng() - 0.5) * 2.2; M.line(0.5, 0.5, h + 0.5, a, d, zc + (rng() - 0.3) * 1.6, trunk, 1.4, 'round'); }
      canopy(M, 0.5, 0.5, zc, rad * 0.9, ['#6a7a3a', '#7a7a40', '#5e6a34'], rng, 5, 0.6);
    } else canopy(M, 0.5, 0.5, zc, rad, cols, rng, 9 + ((rng() * 4) | 0), 0.72);
  }, { norot: true });
  def('pine', 8.2, 70, (M, o, v) => {
    const rng = U.rng(o.id * 17 + v * 3 + 5);
    const H = 6.0 + rng() * 1.8, R0 = 1.0 + rng() * 0.3;
    M.cyl(0.5, 0.5, 0.11, 0, 1.6, '#4a3a2c');
    const ctx = M.ctx;
    const base = M.p(0.5, 0.5, 0);
    const col = R.hex(pick(['#2f4a34', '#2a4430', '#36503a', '#324a2e', '#3a4e36'], v));
    const tiers = 8;
    const cx = base[0];
    for (let k = 0; k < tiers; k++) {
      const t = k / tiers;
      const zb = 1.1 + t * (H - 1.8);
      const zt = Math.min(H, zb + (H - 1.1) / tiers * 2.1);
      const r = R0 * Math.pow(1 - t * 0.9, 1.1) * 44 * (0.9 + rng() * 0.2);
      const yb = base[1] - zb * ZPX, yt = base[1] - zt * ZPX;
      // sombra sob a camada
      ctx.fillStyle = R.css(col, 0.42, 0.8);
      ctx.beginPath(); ctx.ellipse(cx, yb + 1, r * 0.92, r * 0.3, 0, 0, 6.283); ctx.fill();
      // camada com bordas serrilhadas
      const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
      g.addColorStop(0, R.css(col, 1.3)); g.addColorStop(0.42, R.css(col, 1.02)); g.addColorStop(1, R.css(col, 0.6));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx + (rng() - 0.5) * 2, yt);
      const n = 11;
      for (let j = 0; j <= n; j++) {
        const s2 = j / n, ang = Math.PI * (1 - s2);
        const rr = r * (j % 2 ? 0.8 : 1.0);
        const x = cx + Math.cos(ang) * rr, y = yb + Math.sin(ang) * rr * 0.34 + (j % 2 ? -2 : 1.5);
        ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      // agulhas / galhinhos
      for (let j = 0; j < 30; j++) {
        const s2 = rng(), x = cx - r * 0.95 + 1.9 * r * s2, yy = yb - rng() * (yb - yt) * (1 - Math.abs(s2 - 0.5) * 1.6) + 1;
        ctx.strokeStyle = R.css(col, s2 < 0.45 ? 1.5 : 0.72, 0.8); ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + (s2 - 0.5) * 4, yy + 2); ctx.stroke();
      }
      M.pts.push(cx - r, yb + r * 0.35, cx + r, yb + r * 0.35, cx, yt);
    }
  }, { norot: true });
  def('bush', 1.2, 30, (M, o, v) => {
    const rng = U.rng(o.id * 5 + 3);
    if (v === 7) { // juncos
      const ctx = M.ctx, b = M.p(0.5, 0.5, 0);
      for (let k = 0; k < 26; k++) {
        const x = b[0] + (rng() - 0.5) * 30, y = b[1] + (rng() - 0.5) * 12, h = 16 + rng() * 22, lean = (rng() - 0.5) * 8;
        ctx.strokeStyle = R.css(rng() < 0.5 ? '#6a7a40' : '#8a8a4a'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * 0.3, y - h * 0.6, x + lean, y - h); ctx.stroke();
        if (rng() < 0.3) { ctx.fillStyle = '#5a3e26'; ctx.fillRect(x + lean - 1.2, y - h + 1, 2.4, 6); }
        M.pts.push(x + lean, y - h, x, y);
      }
      return;
    }
    const cols = v % 3 === 0 ? ['#4a6632', '#56703a', '#3f5a2c'] : v % 3 === 1 ? ['#5d7a36', '#6f8a40', '#4f6a2e'] : ['#3a5530', '#4a5f36', '#2f4a28'];
    const n = 4 + ((rng() * 3) | 0);
    const pts = [];
    for (let k = 0; k < n; k++) pts.push({ a: 0.5 + (rng() - 0.5) * 0.5, d: 0.5 + (rng() - 0.5) * 0.5, z: 0.3 + rng() * 0.3, r: 0.26 + rng() * 0.14 });
    pts.sort((p, q) => (p.a + p.d + p.z * 0.4) - (q.a + q.d + q.z * 0.4));
    for (const p of pts) {
      const bl = M.blob(p.a, p.d, p.z, p.r, cols[(rng() * 3) | 0]);
      for (let k = 0; k < 16; k++) { const t = rng() * 6.283, rr = Math.sqrt(rng()) * 0.9; M.ctx.fillStyle = R.css(cols[(rng() * 3) | 0], Math.sin(t) < 0 ? 1.4 : 0.75, 0.8); M.ctx.fillRect(bl.cx + Math.cos(t) * bl.rr * rr - 0.7, bl.cy + Math.sin(t) * bl.ry * rr - 0.7, 1.5, 1.3); }
    }
    if (v === 4 || v === 5) { for (let k = 0; k < 5; k++) { const p = M.p(0.3 + rng() * 0.4, 0.3 + rng() * 0.4, 0.4 + rng() * 0.35); M.ctx.fillStyle = v === 4 ? '#e8e0d8' : '#c85a6a'; M.ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2); } }
  }, { norot: true });
  def('lamp_post', 4.3, 30, (M, o, v, A, D) => {
    const c = pick(['#3a4040', '#2e3a34', '#4a4a48'], v);
    M.C(0.5, 0.5, 0.14, 0, 0.35, c);
    M.C(0.5, 0.5, 0.055, 0.35, 3.95, c);
    M.L(0.5, 0.5, 3.85, 0.5, 1.2, 3.95, c, 2.2, 'round');
    M.B(0.42, 0.58, 1.05, 1.4, 3.82, 3.98, c);
    M.F(0.42, 0.58, 1.05, 1.4, 3.8, 3.82, (m) => { const p = m.p(0.5, 1.22, 3.8); m.ctx.fillStyle = '#e8dcb8'; m.ctx.beginPath(); m.ctx.ellipse(p[0], p[1] + 1, 4.5, 2, 0, 0, 6.283); m.ctx.fill(); });
  }, { light: [0.5, 1.22, 3.78] });
  def('mailbox', 1.4, 6, (M, o, v, A, D) => {
    const c = pick(['#3a4a6a', '#2e2e2e', '#6a2a2a', '#e0dcd0', '#3a5a3a'], v);
    M.B(0.46, 0.54, 0.46, 0.54, 0, 1.0, '#6a5038');
    M.B(0.36, 0.64, 0.25, 0.85, 1.0, 1.18, c);
    M.P([[0.25, 1.18], [0.85, 1.18], [0.85, 1.24], [0.73, 1.3], [0.55, 1.33], [0.37, 1.3], [0.25, 1.24]], 0.36, 0.64, c);
    M.B(0.64, 0.66, 0.4, 0.46, 1.1, 1.4, '#b83a2a');
  });
  def('bench', 1.1, 8, (M, o, v, A, D) => {
    const wood = pick(['#8a6a44', '#7a5a3a', '#6e5236'], v), metal = '#2e2e2c';
    for (const a of [0.15, A - 0.2]) { M.B(a, a + 0.05, 0.2, 0.8, 0, 0.44, metal); M.B(a, a + 0.05, 0.14, 0.2, 0.44, 0.9, metal); }
    for (let k = 0; k < 3; k++) M.B(0.05, A - 0.05, 0.25 + k * 0.18, 0.4 + k * 0.18, 0.42, 0.46, wood);
    for (let k = 0; k < 2; k++) M.B(0.05, A - 0.05, 0.14, 0.18, 0.55 + k * 0.18, 0.68 + k * 0.18, wood);
  });
  def('fuel_pump', 2.2, 8, (M, o, v, A, D) => {
    M.B(0.06, A - 0.06, 0.06, D - 0.06, 0, 0.16, '#b8b4a8');
    const red = pick(['#b83a2a', '#2a5a9a', '#3a7a3a'], v);
    const deco = (g, f) => {
      g.fillStyle = '#1e2224'; g.fillRect(f.u0 + 0.12, 1.2, f.u1 - f.u0 - 0.24, 0.3);
      g.fillStyle = '#c8b050'; g.fillRect(f.u0 + 0.16, 1.36, 0.2, 0.08);
      g.fillStyle = red; g.fillRect(f.u0, 1.55, f.u1 - f.u0, 0.15);
      g.fillStyle = '#2a2a2a'; g.fillRect(f.u0 + 0.1, 0.5, 0.12, 0.35);
    };
    M.B(0.22, 0.78, 0.3, 0.7, 0.16, 1.75, '#e8e6e0', { front: deco, back: deco, left: deco, right: deco });
    M.B(0.2, 0.8, 0.28, 0.72, 1.75, 1.85, red);
    M.L(0.3, 0.72, 0.9, 0.3, 0.95, 0.4, '#1a1a1a', 1.5, 'round');
  }, { light: [0.5, 0.5, 1.9] });
  def('washing_machine', 1.2, 6, (M, o, v, A, D) => {
    M.B(0.08, A - 0.08, 0.1, D - 0.08, 0, 0.9, WHITE, { front: (g, f) => { const cx = (f.u0 + f.u1) / 2; g.fillStyle = '#8a9296'; g.beginPath(); g.arc(cx, 0.45, 0.22, 0, 6.283); g.fill(); g.fillStyle = '#2a3236'; g.beginPath(); g.arc(cx, 0.45, 0.16, 0, 6.283); g.fill(); g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.arc(cx - 0.05, 0.5, 0.05, 0, 6.283); g.fill(); } });
    M.B(0.08, A - 0.08, 0.1, 0.24, 0.9, 1.02, '#d8d6d0', { front: (g, f) => { g.fillStyle = '#555'; g.fillRect(f.u0 + 0.15, 0.94, 0.08, 0.04); g.beginPath(); g.arc(f.u1 - 0.2, 0.96, 0.03, 0, 6.283); g.fill(); } });
  });
  def('workbench', 1.5, 8, (M, o, v, A, D) => {
    const c = '#8a6a44';
    for (const [a, d] of [[0.06, 0.12], [A - 0.12, 0.12], [0.06, D - 0.18], [A - 0.12, D - 0.18]]) M.B(a, a + 0.06, d, d + 0.06, 0, 0.86, R.css(c, 0.8));
    M.B(0.06, A - 0.06, 0.12, D - 0.12, 0.2, 0.24, R.css(c, 0.85));
    M.B(0.04, A - 0.04, 0.08, D - 0.08, 0.86, 0.94, c, { top: (g) => { g.strokeStyle = R.css(c, 0.7); g.lineWidth = 0.015; for (let d = 0.2; d < D - 0.1; d += 0.14) { g.beginPath(); g.moveTo(0.05, d); g.lineTo(A - 0.05, d); g.stroke(); } } });
    M.B(0.15, 0.35, 0.2, 0.4, 0.94, 1.1, '#4a5a6a');
    M.L(A * 0.55, 0.4, 0.95, A * 0.55 + 0.3, 0.55, 0.95, '#6a4a2a', 2.2);
    M.B(A * 0.55 + 0.25, A * 0.55 + 0.35, 0.5, 0.6, 0.94, 0.99, '#555');
    M.B(0.3, 0.9, 0.2, 0.5, 0.3, 0.55, pick(['#a07c52', '#6a7a8a', '#8a4a3a'], v));
  });
  def('barrel', 1.1, 6, (M, o, v) => {
    const c = pick(['#2e4a7a', '#8a3a2a', '#4a5a3a', '#6a4a30', '#7a6a3a'], v);
    const b = M.cyl(0.5, 0.5, 0.29, 0, 0.9, c);
    const ctx = M.ctx;
    ctx.strokeStyle = R.css(c, 0.6); ctx.lineWidth = 1.2;
    for (const k of [0.3, 0.65]) { const y = b.cyb - (b.cyb - b.cyt) * k; ctx.beginPath(); ctx.ellipse(b.cx, y, b.rx, b.ry, 0, 0, Math.PI); ctx.stroke(); }
    ctx.fillStyle = 'rgba(120,70,40,0.35)'; ctx.fillRect(b.cx - b.rx * 0.6, b.cyb - 12, 5, 7);
    ctx.fillStyle = R.css(c, 0.7); ctx.beginPath(); ctx.ellipse(b.cx + 4, b.cyt, 2, 1, 0, 0, 6.283); ctx.fill();
  }, { norot: true });
  def('log_pile', 1.0, 8, (M, o, v, A, D) => {
    const bark = '#5a4430', end = '#b89a6a';
    const rows = [[0.2, 0.5, 0.8], [0.35, 0.65], [0.5]];
    rows.forEach((row, ri) => {
      for (const dc of row) {
        const zc = 0.13 + ri * 0.22, r = 0.12;
        const prof = [];
        for (let k = 0; k < 8; k++) { const t = k / 8 * 6.283; prof.push([dc * D + Math.cos(t) * r, zc + Math.sin(t) * r]); }
        M.P(prof, 0.05 + (ri * 0.07), A - 0.05 - (ri * 0.05), bark, { faceColors: [end, end] });
      }
    });
  });
  def('lamp', 1.8, 8, (M, o, v) => {
    const shade = pick(['#e8dcc0', '#d8c8a0', '#c8b8a8', '#e0d0b8'], v);
    M.C(0.5, 0.5, 0.14, 0, 0.04, '#3a3632');
    M.L(0.5, 0.5, 0.04, 0.5, 0.5, 1.35, '#3a3632', 1.4);
    M.F(0.2, 0.8, 0.2, 0.8, 1.3, 1.62, (m) => {
      const b = m.p(0.5, 0.5, 1.3), t = m.p(0.5, 0.5, 1.6);
      const ctx = m.ctx;
      const g = ctx.createLinearGradient(b[0] - 9, 0, b[0] + 9, 0);
      g.addColorStop(0, R.css(shade, 0.7)); g.addColorStop(0.4, R.css(shade, 1.05)); g.addColorStop(1, R.css(shade, 0.72));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(t[0] - 5.5, t[1]); ctx.lineTo(t[0] + 5.5, t[1]); ctx.lineTo(b[0] + 9, b[1]); ctx.ellipse(b[0], b[1], 9, 4.5, 0, 0, Math.PI); ctx.lineTo(b[0] - 9, b[1]); ctx.closePath(); ctx.fill();
      ctx.fillStyle = R.css(shade, 1.12); ctx.beginPath(); ctx.ellipse(t[0], t[1], 5.5, 2.7, 0, 0, 6.283); ctx.fill();
      m.pts.push(b[0] - 9, b[1] + 4, b[0] + 9, b[1] + 4, t[0] - 6, t[1] - 3, t[0] + 6, t[1] - 3);
    });
  }, { light: [0.5, 0.5, 1.35], norot: true });
  def('plant', 1.4, 10, (M, o, v) => {
    const rng = U.rng(o.id * 3 + 1);
    M.cyl(0.5, 0.5, 0.17, 0, 0.36, pick(['#a0583a', '#8a4a32', '#6a6a66', '#d8d0c0'], v), { top: '#3a2a1e' });
    if (v & 1) {
      const ctx = M.ctx, b = M.p(0.5, 0.5, 0.36);
      for (let k = 0; k < 11; k++) {
        const a = -Math.PI / 2 + (rng() - 0.5) * 2.6, l = 14 + rng() * 14;
        ctx.strokeStyle = R.css(pick(['#4a7a3a', '#5a8a44', '#3a6a30'], k), 1); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.quadraticCurveTo(b[0] + Math.cos(a) * l * 0.5, b[1] + Math.sin(a) * l * 0.9, b[0] + Math.cos(a) * l, b[1] + Math.sin(a) * l * 0.6 + 4); ctx.stroke();
        M.pts.push(b[0] + Math.cos(a) * l, b[1] + Math.sin(a) * l);
      }
    } else {
      M.blob(0.5, 0.5, 0.62, 0.3, '#4a7a3a');
      M.blob(0.42, 0.55, 0.82, 0.2, '#5a8a44');
    }
  }, { norot: true });
  def('fence_gate', 1.4, 8, (M, o, v, A, D) => {
    for (const a of [0.05, A - 0.1]) M.B(a, a + 0.05, 0.45, 0.55, 0, 1.3, '#6a5038');
    for (let a = 0.12; a < A - 0.12; a += 0.14) M.B(a, a + 0.11, 0.47, 0.53, 0.05, 1.15, '#8a6e50');
  });
  def('picnic_table', 1.0, 8, (M, o, v, A, D) => {
    const c = pick(['#8a6a44', '#7a6048', '#9a7a52'], v);
    for (const a of [0.2, A - 0.26]) { M.B(a, a + 0.06, 0.1, D - 0.1, 0.02, 0.06, R.css(c, 0.7)); M.L(a + 0.03, 0.15, 0.05, a + 0.03, D * 0.5, 0.74, c, 2.2); M.L(a + 0.03, D - 0.15, 0.05, a + 0.03, D * 0.5, 0.74, c, 2.2); }
    M.B(0.02, A - 0.02, 0.02, 0.2, 0.42, 0.46, c);
    M.B(0.02, A - 0.02, D - 0.2, D - 0.02, 0.42, 0.46, c);
    M.B(0.04, A - 0.04, 0.3, D - 0.3, 0.72, 0.76, c, { top: (g) => { g.strokeStyle = R.css(c, 0.7); g.lineWidth = 0.02; g.beginPath(); g.moveTo(0.04, D / 2); g.lineTo(A - 0.04, D / 2); g.stroke(); } });
  });
  def('swing', 2.6, 12, (M, o, v, A, D) => {
    const c = pick(['#8a3a2a', '#3a5a7a', '#5a6a3a'], v);
    for (const a of [0.12, A - 0.12]) { M.L(a, 0.1, 0, a, 0.5, 2.3, c, 2.2, 'round'); M.L(a, 0.9, 0, a, 0.5, 2.3, c, 2.2, 'round'); }
    M.L(0.1, 0.5, 2.3, A - 0.1, 0.5, 2.3, c, 2.6, 'round');
    for (const a of [0.65, A - 0.65]) {
      M.L(a - 0.18, 0.5, 2.3, a - 0.18, 0.55, 0.48, '#8a8a88', 0.7);
      M.L(a + 0.18, 0.5, 2.3, a + 0.18, 0.55, 0.48, '#8a8a88', 0.7);
      M.B(a - 0.22, a + 0.22, 0.48, 0.64, 0.44, 0.48, '#2a2a2a');
    }
  });
  def('grave', 1.3, 6, (M, o, v, A, D) => {
    const stone = pick(['#9a9892', '#8a8880', '#a8a49a', '#7a7a74'], v);
    M.F(0.1, 0.9, 0.3, 0.95, 0, 0.06, (m) => m.topDeco(0.02, (g) => { g.fillStyle = 'rgba(80,68,48,0.55)'; g.fillRect(0.2, 0.3, 0.6, 0.62); g.fillStyle = 'rgba(60,80,40,0.3)'; g.fillRect(0.22, 0.34, 0.56, 0.1); }));
    const kind = v % 4;
    if (kind === 0 || kind === 3) {
      M.B(0.22, 0.78, 0.12, 0.26, 0, 0.72, stone, { front: (g, f) => { g.fillStyle = 'rgba(40,40,38,0.35)'; g.fillRect(f.u0 + 0.12, 0.35, f.u1 - f.u0 - 0.24, 0.03); g.fillRect(f.u0 + 0.16, 0.25, f.u1 - f.u0 - 0.32, 0.02); } });
      M.P([[0.12, 0.72], [0.26, 0.72], [0.26, 0.78], [0.19, 0.84], [0.12, 0.78]], 0.22, 0.78, stone);
      M.B(0.18, 0.82, 0.1, 0.3, 0, 0.08, R.css(stone, 0.85));
    } else if (kind === 1) {
      M.B(0.45, 0.55, 0.15, 0.25, 0, 1.05, stone);
      M.B(0.28, 0.72, 0.15, 0.25, 0.68, 0.78, stone);
      M.B(0.3, 0.7, 0.1, 0.3, 0, 0.1, R.css(stone, 0.85));
    } else {
      M.B(0.3, 0.7, 0.2, 0.3, 0, 0.45, stone);
    }
    if (v >= 5) M.F(0.3, 0.7, 0.5, 0.7, 0, 0.1, (m) => { for (let k = 0; k < 5; k++) { const p = m.p(0.4 + k * 0.05, 0.55 + (k & 1) * 0.05, 0.08); m.ctx.fillStyle = pick(['#c84a4a', '#e0d060', '#e8e4e0'], k); m.ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2); } });
  });
  def('locker', 2.1, 6, (M, o, v, A, D) => {
    const c = pick(['#5a6a7a', '#6a7a6a', '#7a6a5a', '#5a6068'], v);
    M.B(0.1, A - 0.1, 0.16, D - 0.1, 0, 1.9, c, {
      front: (g, f) => {
        const m = (f.u0 + f.u1) / 2;
        g.strokeStyle = R.css(c, 0.6); g.lineWidth = 0.02; g.beginPath(); g.moveTo(m, 0.05); g.lineTo(m, 1.85); g.stroke();
        for (const u of [f.u0 + 0.08, m + 0.08]) for (let k = 0; k < 4; k++) { g.fillStyle = R.css(c, 0.55); g.fillRect(u, 1.6 + k * 0.05, 0.22, 0.02); }
        g.fillStyle = '#c8c8c0'; g.fillRect(m - 0.08, 1.0, 0.03, 0.1); g.fillRect(m + 0.05, 1.0, 0.03, 0.1);
      },
    });
  });
  def('gun_locker', 2.0, 6, (M, o, v, A, D) => {
    M.B(0.08, A - 0.08, 0.14, D - 0.08, 0, 1.85, '#3e4a3e', { front: (g, f) => { g.strokeStyle = '#2a322a'; g.lineWidth = 0.03; g.strokeRect(f.u0 + 0.05, 0.05, f.u1 - f.u0 - 0.1, 1.75); g.fillStyle = '#9a9a90'; g.beginPath(); g.arc((f.u0 + f.u1) / 2, 1.05, 0.07, 0, 6.283); g.fill(); g.fillStyle = '#2a2a2a'; g.fillRect((f.u0 + f.u1) / 2 + 0.12, 0.9, 0.04, 0.25); } });
  });
  def('medicine_cabinet', 2.0, 6, (M, o, v, A, D) => {
    M.B(0.22, 0.78, -0.3, -0.16, 1.2, 1.75, '#e8e6e0', { front: (g, f) => { g.fillStyle = '#a9c0c8'; g.fillRect(f.u0 + 0.04, 1.24, f.u1 - f.u0 - 0.08, 0.47); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(f.u0 + 0.1, 1.45, 0.08, 0.22); } });
  });
  def('vending_machine', 2.1, 8, (M, o, v, A, D, info) => {
    const c = pick(['#a82a2a', '#2a4a8a', '#2a6a3a'], v);
    M.B(0.08, A - 0.08, 0.2, D - 0.08, 0, 1.9, c, {
      front: (g, f) => {
        g.fillStyle = info.lit ? '#e8f0e8' : '#20282c'; g.fillRect(f.u0 + 0.06, 0.75, (f.u1 - f.u0) * 0.62, 1.05);
        for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) { g.fillStyle = pick(R.PAL.product, r * 4 + k); g.fillRect(f.u0 + 0.1 + k * 0.13, 0.82 + r * 0.19, 0.08, 0.12); }
        g.fillStyle = '#1a1a1a'; g.fillRect(f.u0 + 0.1, 0.25, (f.u1 - f.u0) * 0.5, 0.2);
        g.fillStyle = '#c8c8c0'; g.fillRect(f.u1 - 0.2, 1.1, 0.1, 0.2);
      },
    });
  }, { light: [0.5, 1.0, 1.3] });
  def('freezer', 2.1, 6, (M, o, v, A, D) => {
    M.B(0.06, A - 0.06, 0.16, D - 0.08, 0, 1.95, '#dcdcd8', {
      front: (g, f) => {
        g.fillStyle = '#9ab8c4'; g.fillRect(f.u0 + 0.07, 0.15, f.u1 - f.u0 - 0.14, 1.6);
        for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++) { if (R.hash(o.id, r * 5 + k, 3) < 0.3) continue; g.fillStyle = pick(R.PAL.product, r * 5 + k + v); g.fillRect(f.u0 + 0.1 + k * 0.15, 0.25 + r * 0.38, 0.11, 0.2); }
        g.fillStyle = 'rgba(230,245,250,0.45)'; g.fillRect(f.u0 + 0.07, 0.15, f.u1 - f.u0 - 0.14, 1.6);
        g.fillStyle = '#888'; g.fillRect(f.u1 - 0.13, 0.7, 0.03, 0.5);
      },
    });
  });
  def('pallet', 1.0, 6, (M, o, v, A, D) => {
    const c = '#b09668';
    for (const d of [0.12, 0.47, 0.82]) M.B(0.06, A - 0.06, d, d + 0.08, 0, 0.1, R.css(c, 0.8));
    M.B(0.06, A - 0.06, 0.1, D - 0.1, 0.1, 0.14, c, { top: (g) => { g.fillStyle = 'rgba(40,30,20,0.6)'; for (let a = 0.2; a < A - 0.1; a += 0.14) g.fillRect(a, 0.1, 0.03, D - 0.2); } });
    if (v % 3 === 0) { M.B(0.12, 0.52, 0.14, 0.5, 0.14, 0.5, '#b89a70'); M.B(0.52, 0.88, 0.2, 0.62, 0.14, 0.44, '#a88a60'); M.B(0.2, 0.6, 0.18, 0.5, 0.5, 0.78, '#c0a278'); }
    else if (v % 3 === 1) { for (let k = 0; k < 3; k++) M.Bl(0.3 + k * 0.2, 0.5, 0.28, 0.2, '#c8bc9a', { sy: 0.6 }); }
  });
  def('tire', 0.8, 6, (M, o, v) => {
    const n = 1 + (v % 3);
    for (let k = 0; k < n; k++) {
      const b = M.cyl(0.5, 0.5, 0.32, k * 0.2, k * 0.2 + 0.2, '#262626', { top: '#303030' });
      const ctx = M.ctx;
      ctx.fillStyle = '#121212'; ctx.beginPath(); ctx.ellipse(b.cx, b.cyt, b.rx * 0.5, b.ry * 0.5, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 0.6; for (let t = 0; t < 6.28; t += 0.5) { ctx.beginPath(); ctx.moveTo(b.cx + Math.cos(t) * b.rx * 0.95, b.cyb + 2); ctx.lineTo(b.cx + Math.cos(t) * b.rx * 0.95, b.cyt + 2); ctx.stroke(); }
    }
  }, { norot: true });
  def('grill', 1.3, 6, (M, o, v, A, D) => {
    if (v & 1) {
      for (const [a, d] of [[0.3, 0.3], [0.7, 0.3], [0.5, 0.75]]) M.L(a, d, 0, 0.5, 0.5, 0.55, '#2a2a2a', 1.3);
      M.Bl(0.5, 0.5, 0.72, 0.3, '#262626', { sy: 0.8 });
      M.F(0.4, 0.6, 0.4, 0.6, 0.95, 1.0, (m) => { const p = m.p(0.5, 0.5, 0.98); m.ctx.fillStyle = '#555'; m.ctx.fillRect(p[0] - 2, p[1] - 1, 4, 2); });
    } else {
      M.B(0.1, 0.9, 0.2, 0.8, 0.1, 0.8, '#3a3a3c', { front: doors2('#3a3a3c', '#999') });
      M.P([[0.2, 0.8], [0.8, 0.8], [0.8, 0.95], [0.55, 1.08], [0.35, 1.06], [0.2, 0.95]], 0.12, 0.88, '#2a2a2c');
      for (const [a, d] of [[0.15, 0.25], [0.85, 0.25], [0.15, 0.75], [0.85, 0.75]]) M.C(a, d, 0.05, 0, 0.1, '#1a1a1a');
    }
  });
  def('clothesline', 2.2, 12, (M, o, v, A, D) => {
    const post = '#7a7a76';
    for (const a of [0.12, A - 0.12]) { M.L(a, 0.5, 0, a, 0.5, 1.85, post, 2); M.L(a, 0.2, 1.8, a, 0.8, 1.8, post, 1.6); }
    for (const d of [0.3, 0.7]) M.L(0.12, d, 1.8, A - 0.12, d, 1.74, '#d8d8d0', 0.5);
    const rng = U.rng(o.id * 3 + 17);
    for (const d of [0.3, 0.7]) {
      let a = 0.35 + rng() * 0.3;
      while (a < A - 0.5) {
        const w = 0.35 + rng() * 0.35, h = 0.4 + rng() * 0.45;
        if (rng() < 0.3) { a += w; continue; }
        const col = pick(R.PAL.blanket.concat(['#e8e4dc', '#d8d8e0']), (rng() * 10) | 0);
        M.F(a, a + w, d - 0.02, d + 0.02, 1.76 - h, 1.78, (m) => m.faceDeco('front', a, a + w, d - 0.02, d, 1.76 - h, 1.78, (g) => { g.fillStyle = R.css(col); g.fillRect(a, 1.76 - h, w, h); g.fillStyle = R.css(col, 0.8); g.fillRect(a, 1.76 - h, w, 0.04); g.fillStyle = '#ccc'; g.fillRect(a + 0.05, 1.72, 0.02, 0.06); g.fillRect(a + w - 0.07, 1.72, 0.02, 0.06); }));
        a += w + 0.1;
      }
    }
  });
  def('watchtower', 9.0, 20, (M, o, v, A, D) => {
    const c = '#6a5038';
    for (const [a, d] of [[0.15, 0.15], [A - 0.15, 0.15], [0.15, D - 0.15], [A - 0.15, D - 0.15]]) M.L(a, d, 0, 0.35 + (a > 1 ? 1.3 : 0), 0.35 + (d > 1 ? 1.3 : 0), 5.5, c, 3.4);
    for (const z of [1.5, 3.2]) {
      M.L(0.2, 0.2, z, A - 0.2, 0.2, z + 1.2, c, 1.4); M.L(0.2, D - 0.2, z, A - 0.2, D - 0.2, z + 1.2, c, 1.4);
      M.L(0.2, 0.2, z, 0.2, D - 0.2, z + 1.2, c, 1.4); M.L(A - 0.2, 0.2, z, A - 0.2, D - 0.2, z + 1.2, c, 1.4);
    }
    M.B(0.1, A - 0.1, 0.1, D - 0.1, 5.5, 5.65, '#7a5a3a');
    const rail = (g, f) => { g.fillStyle = '#7a5a3a'; g.fillRect(f.u0, 5.65, f.u1 - f.u0, 1.0); g.fillStyle = 'rgba(0,0,0,0.3)'; for (let u = f.u0 + 0.15; u < f.u1; u += 0.2) g.fillRect(u, 5.65, 0.02, 1.0); };
    M.B(0.1, A - 0.1, 0.1, D - 0.1, 5.65, 6.65, '#7a5a3a', { front: rail, right: rail, left: rail, back: rail, top: false }, { alpha: 0 });
    for (const [a, d] of [[0.12, 0.12], [A - 0.2, 0.12], [0.12, D - 0.2], [A - 0.2, D - 0.2]]) M.B(a, a + 0.08, d, d + 0.08, 5.65, 7.3, c);
    const apex = [A / 2, D / 2, 8.3];
    M.F(-0.1, A + 0.1, -0.1, D + 0.1, 7.3, 8.3, (m) => m.convex([
      [[-0.15, -0.15, 7.3], [A + 0.15, -0.15, 7.3], apex],
      [[A + 0.15, -0.15, 7.3], [A + 0.15, D + 0.15, 7.3], apex],
      [[A + 0.15, D + 0.15, 7.3], [-0.15, D + 0.15, 7.3], apex],
      [[-0.15, D + 0.15, 7.3], [-0.15, -0.15, 7.3], apex],
    ], '#4a3e34'));
    for (let z = 0.3; z < 5.5; z += 0.35) M.L(A * 0.4, D + 0.05, z, A * 0.6, D + 0.05, z, '#5a4430', 1.2);
    M.L(A * 0.4, D + 0.05, 0, A * 0.4, D - 0.1, 5.6, '#5a4430', 1.4); M.L(A * 0.6, D + 0.05, 0, A * 0.6, D - 0.1, 5.6, '#5a4430', 1.4);
  });
  def('fountain', 1.8, 12, (M, o, v, A, D) => {
    const stone = '#a8a298';
    const prof = [];
    const n = 8;
    // bacia octogonal: borda externa como prisma octogonal e água dentro
    const oct = (r, z0, z1, col) => {
      const faces = [];
      const top = [], bot = [];
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n * 6.283; top.push([A / 2 + Math.cos(t) * r, D / 2 + Math.sin(t) * r, z1]); bot.push([A / 2 + Math.cos(t) * r, D / 2 + Math.sin(t) * r, z0]); }
      faces.push(top, bot.slice().reverse());
      for (let k = 0; k < n; k++) faces.push([bot[k], bot[(k + 1) % n], top[(k + 1) % n], top[k]]);
      M.convex(faces, col);
    };
    void prof;
    oct(0.95, 0, 0.45, stone);
    M.flatEllipse(A / 2, D / 2, 0.45, 0.8, 0.8, '#3e6a78');
    M.topDeco(0.451, (g) => { g.fillStyle = '#4a7a88'; g.beginPath(); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n * 6.283; g.lineTo(A / 2 + Math.cos(t) * 0.8, D / 2 + Math.sin(t) * 0.8); } g.closePath(); g.fill(); g.strokeStyle = 'rgba(200,230,235,0.35)'; g.lineWidth = 0.03; g.beginPath(); g.ellipse(A / 2, D / 2, 0.4, 0.4, 0, 0, 6.283); g.stroke(); g.beginPath(); g.ellipse(A / 2, D / 2, 0.62, 0.62, 0, 0, 6.283); g.stroke(); });
    M.cyl(A / 2, D / 2, 0.12, 0.45, 1.1, stone);
    M.cyl(A / 2, D / 2, 0.42, 1.1, 1.2, stone, { top: '#4a7a88' });
    M.cyl(A / 2, D / 2, 0.07, 1.2, 1.55, stone);
    const p = M.p(A / 2, D / 2, 1.55);
    const ctx = M.ctx;
    ctx.strokeStyle = 'rgba(210,235,240,0.55)'; ctx.lineWidth = 1;
    for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(p[0] + k * 4, p[1] - 8, p[0] + k * 6, p[1] + 16); ctx.stroke(); }
  });

  // Veículos: carroceria em prismas convexos (parte baixa + cabine), rodas octogonais
  function wheel(M, a0, a1, d, r, flat) {
    const prof = [];
    for (let k = 0; k < 10; k++) { const t = k / 10 * 6.283; prof.push([d + Math.cos(t) * r, r * (flat ? 0.8 : 1) + Math.sin(t) * r]); }
    M.P(prof, a0, a1, '#1c1c1c', { faceColors: ['#6a6c6e', '#6a6c6e'] });
  }
  function vehicle(M, o, v, A, D, kind) {
    const wrecked = !!o.wrecked;
    let body = R.hex(pick(R.PAL.carBody, v * 5 + 3));
    if (kind === 'police') body = R.hex('#1e2226');
    if (kind === 'ambulance') body = R.hex('#e6e4de');
    if (kind === 'pickup') body = R.hex(pick(['#6e2b2b', '#2f3f5c', '#8a7a5a', '#3f5a45', '#a4553a', '#9aa0a3', '#5a4a3a'], v));
    if (wrecked) body = R.darken(R.desat(body, 0.4), 0.15);
    const glass = wrecked ? '#56646a' : '#34444c';
    const wr = 0.34;
    const dF = D - 0.9, dR = kind === 'ambulance' ? 1.1 : 0.9;
    const aw0 = 0.1, aw1 = A - 0.1;
    // rodas (ordenadas junto com a carroceria)
    for (const d of [dR, dF]) { wheel(M, 0.06, 0.32, d, wr, wrecked && d === dF); wheel(M, A - 0.32, A - 0.06, d, wr, false); }
    const side = (g, f) => {
      g.strokeStyle = R.css(body, 0.55); g.lineWidth = 0.02;
      g.beginPath(); g.moveTo(f.u0 + 0.1, 0.62); g.lineTo(f.u1 - 0.1, 0.62); g.stroke();
      if (kind === 'police') { g.fillStyle = '#e8e6e0'; g.fillRect(f.u0 + D * 0.3, 0.3, D * 0.4, 0.5); g.fillStyle = '#c8b050'; g.fillRect(f.u0 + D * 0.46, 0.5, 0.12, 0.14); }
      if (kind === 'ambulance') { g.fillStyle = '#b83030'; g.fillRect(f.u0, 0.62, f.u1 - f.u0, 0.12); }
    };
    const frontDeco = (g, f) => {
      g.fillStyle = '#1e1e1e'; g.fillRect(f.u0 + 0.5, 0.36, f.u1 - f.u0 - 1.0, 0.2);
      g.fillStyle = wrecked ? '#6a6a60' : '#f0ead0'; g.fillRect(f.u0 + 0.14, 0.5, 0.3, 0.12); g.fillRect(f.u1 - 0.44, 0.5, 0.3, 0.12);
      g.fillStyle = '#9a9a98'; g.fillRect(f.u0 + 0.08, 0.28, f.u1 - f.u0 - 0.16, 0.08);
    };
    const backDeco = (g, f) => {
      g.fillStyle = '#8a1e1a'; g.fillRect(f.u0 + 0.12, 0.55, 0.26, 0.14); g.fillRect(f.u1 - 0.38, 0.55, 0.26, 0.14);
      g.fillStyle = '#9a9a98'; g.fillRect(f.u0 + 0.08, 0.28, f.u1 - f.u0 - 0.16, 0.08);
      g.fillStyle = '#d8d4b8'; g.fillRect((f.u0 + f.u1) / 2 - 0.15, 0.4, 0.3, 0.1);
    };
    if (kind === 'ambulance') {
      M.B(aw0, aw1, 0.1, 3.5, 0.3, 2.55, body, {
        left: (g, f) => { side(g, f); g.fillStyle = '#b83030'; g.fillRect(1.4, 1.35, 0.5, 0.14); g.fillRect(1.58, 1.17, 0.14, 0.5); },
        right: (g, f) => { side(g, f); g.fillStyle = '#b83030'; g.fillRect(1.4, 1.35, 0.5, 0.14); g.fillRect(1.58, 1.17, 0.14, 0.5); },
        back: (g, f) => { backDeco(g, f); g.strokeStyle = R.css(body, 0.6); g.lineWidth = 0.02; g.beginPath(); g.moveTo((f.u0 + f.u1) / 2, 0.4); g.lineTo((f.u0 + f.u1) / 2, 2.4); g.stroke(); g.fillStyle = '#34444c'; g.fillRect(f.u0 + 0.25, 1.6, 0.5, 0.45); g.fillRect(f.u1 - 0.75, 1.6, 0.5, 0.45); },
        top: (g) => { g.fillStyle = '#d0cec8'; g.fillRect(0.4, 0.5, A - 0.8, 2.6); },
      });
      M.P([[3.5, 0.3], [D - 0.08, 0.3], [D - 0.04, 0.95], [D - 0.35, 1.1], [3.5, 1.2]], aw0, aw1, body, { deco: null });
      M.P([[3.52, 1.2], [D - 0.35, 1.1], [D - 0.95, 1.95], [3.52, 2.0]], aw0 + 0.06, aw1 - 0.06, glass, { faceColors: [body, body, glass, glass, body, body] });
      M.B(aw0 + 0.1, aw1 - 0.1, 3.55, 3.95, 2.0, 2.12, '#2a2a2a');
      M.B(aw0 + 0.2, (aw0 + aw1) / 2, 3.6, 3.9, 2.12, 2.24, '#c02020');
      M.B((aw0 + aw1) / 2, aw1 - 0.2, 3.6, 3.9, 2.12, 2.24, '#2040c0');
      M.F(aw0, aw1, D - 0.1, D, 0.3, 0.95, (m) => m.faceDeco('front', aw0, aw1, D - 0.1, D - 0.04, 0.3, 0.95, frontDeco));
      return;
    }
    // parte baixa
    const lowProf = kind === 'pickup'
      ? [[0.08, 0.3], [D - 0.06, 0.3], [D - 0.02, 0.66], [D - 0.25, 0.94], [0.1, 0.96], [0.04, 0.62]]
      : [[0.1, 0.28], [D - 0.08, 0.28], [D - 0.03, 0.6], [D - 0.22, 0.84], [0.16, 0.88], [0.06, 0.6]];
    M.P(lowProf, aw0, aw1, body);
    // faces de frente/trás e laterais (decoração) via caixas finas invisíveis
    M.F(aw0, aw1, D - 0.1, D, 0.28, 0.84, (m) => m.faceDeco('front', aw0, aw1, D - 0.1, D - 0.05, 0.28, 0.84, frontDeco));
    M.F(aw0, aw1, 0, 0.1, 0.28, 0.88, (m) => m.faceDeco('back', aw0, aw1, 0.08, 0.1, 0.28, 0.88, backDeco));
    M.F(aw1, aw1 + 0.01, 0.1, D - 0.1, 0.28, 0.84, (m) => m.faceDeco('right', aw0, aw1, 0.1, D - 0.1, 0.28, 0.84, side));
    M.F(aw0 - 0.01, aw0, 0.1, D - 0.1, 0.28, 0.84, (m) => m.faceDeco('left', aw0, aw1, 0.1, D - 0.1, 0.28, 0.84, side));
    // cabine (estufa)
    const cab = kind === 'pickup' ? [[D - 1.35, 0.93], [D - 1.75, 1.5], [D - 2.55, 1.52], [D - 2.6, 0.95]] : [[D - 1.3, 0.86], [D - 1.9, 1.34], [1.35, 1.36], [0.72, 0.9]];
    M.P(cab, aw0 + 0.1, aw1 - 0.1, glass, {
      faceColors: [glass, glass, glass, body, glass, body],
    });
    // colunas e teto
    const roofD0 = kind === 'pickup' ? D - 2.55 : 1.35, roofD1 = kind === 'pickup' ? D - 1.75 : D - 1.9;
    M.B(aw0 + 0.12, aw1 - 0.12, roofD0, roofD1, kind === 'pickup' ? 1.5 : 1.34, kind === 'pickup' ? 1.55 : 1.39, body);
    if (kind === 'pickup') {
      // caçamba
      M.B(aw0, aw1, 0.08, D - 2.62, 0.96, 1.22, body, { top: (g) => { g.fillStyle = '#2a2826'; g.fillRect(aw0 + 0.08, 0.16, aw1 - aw0 - 0.16, D - 2.86); g.fillStyle = 'rgba(255,255,255,0.08)'; for (let a = aw0 + 0.2; a < aw1 - 0.1; a += 0.2) g.fillRect(a, 0.16, 0.04, D - 2.86); } });
      if (v % 3 === 0) M.B(aw0 + 0.2, aw0 + 0.8, 0.3, 0.9, 0.96, 1.4, '#a07c52');
    }
    if (kind === 'police') {
      M.B(aw0 + 0.3, aw1 - 0.3, (roofD0 + roofD1) / 2 - 0.12, (roofD0 + roofD1) / 2 + 0.12, 1.39, 1.46, '#2a2a2a');
      M.B(aw0 + 0.35, (aw0 + aw1) / 2, (roofD0 + roofD1) / 2 - 0.1, (roofD0 + roofD1) / 2 + 0.1, 1.46, 1.56, '#c02020');
      M.B((aw0 + aw1) / 2, aw1 - 0.35, (roofD0 + roofD1) / 2 - 0.1, (roofD0 + roofD1) / 2 + 0.1, 1.46, 1.56, '#2040c0');
    }
    // retrovisores
    M.B(aw0 - 0.08, aw0 + 0.04, D - 1.4, D - 1.3, 0.9, 0.98, body); M.B(aw1 - 0.04, aw1 + 0.08, D - 1.4, D - 1.3, 0.9, 0.98, body);
    if (wrecked) {
      M.F(aw0, aw1, D - 1.95, D - 1.25, 0.86, 1.36, (m) => {
        const ctx = m.ctx; const p = m.p((aw0 + aw1) / 2, D - 1.6, 1.1);
        ctx.strokeStyle = 'rgba(230,236,240,0.7)'; ctx.lineWidth = 0.6;
        for (let k = 0; k < 7; k++) { const t = k / 7 * 6.283; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + Math.cos(t) * 12, p[1] + Math.sin(t) * 7); ctx.stroke(); }
      });
      M.F(aw0, aw1, D - 0.8, D, 0.8, 0.95, (m) => { const a = m.p(aw0 + 0.2, D - 0.3, 0.86), b = m.p(aw1 - 0.3, D - 0.6, 0.86), c = m.p((aw0 + aw1) / 2, D - 0.45, 1.05); m.ctx.fillStyle = R.css(body, 0.7); m.ctx.beginPath(); m.ctx.moveTo(a[0], a[1]); m.ctx.lineTo(c[0], c[1]); m.ctx.lineTo(b[0], b[1]); m.ctx.closePath(); m.ctx.fill(); });
    }
  }
  def('car', 1.8, 10, (M, o, v, A, D) => vehicle(M, o, v, A, D, 'car'));
  def('pickup', 1.9, 10, (M, o, v, A, D) => vehicle(M, o, v, A, D, 'pickup'));
  def('police_car', 1.8, 10, (M, o, v, A, D) => vehicle(M, o, v, A, D, 'police'), { light: null });
  def('ambulance', 2.6, 10, (M, o, v, A, D) => vehicle(M, o, v, A, D, 'ambulance'));

  // Genérico para tipos desconhecidos
  function generic(M, o, v, A, D) {
    const h = Math.max(0.3, (o.height || 0.5) * R.WALL_M);
    M.B(0.1, A - 0.1, 0.1, D - 0.1, 0, h, '#8a8070');
  }

  // ------------------------------------------------------------------
  // Deslocamento para encostar na parede (paredes finas ficam no centro do tile)
  // ------------------------------------------------------------------
  const WALLSNAP = new Set(['bed', 'double_bed', 'sofa', 'armchair', 'fridge', 'stove', 'sink', 'toilet', 'bathtub', 'shower', 'wardrobe', 'dresser',
    'bookshelf', 'tv', 'desk', 'kitchen_counter', 'counter', 'washing_machine', 'workbench', 'locker', 'gun_locker', 'medicine_cabinet', 'vending_machine',
    'freezer', 'lamp', 'plant', 'crate', 'barrel', 'pallet', 'cash_register', 'trash_can']);
  RO.snap = function (o) {
    if (o._rs) return o._rs;
    const rs = [0, 0];
    o._rs = rs;
    if (!map || !o.building || !WALLSNAP.has(o.type)) return rs;
    const m = map;
    const isW = (x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.wall[y * m.w + x] && R.walls.isStruct(m.wall[y * m.w + x]) || (x >= 0 && y >= 0 && x < m.w && y < m.h && R.walls.isOpening(m.wall[y * m.w + x]));
    const edge = (dx, dy) => {
      if (dx) { const x = dx < 0 ? o.x - 1 : o.x + o.w; for (let y = o.y; y < o.y + o.h; y++) if (!isW(x, y)) return false; return true; }
      const y = dy < 0 ? o.y - 1 : o.y + o.h; for (let x = o.x; x < o.x + o.w; x++) if (!isW(x, y)) return false; return true;
    };
    const k = 0.5 - R.walls.T2 - 0.02;
    const L = edge(-1, 0), Rr = edge(1, 0), N = edge(0, -1), Sd = edge(0, 1);
    // prioriza o lado de trás (oposto à frente)
    const bx = -R.DX[o.rot], by = -R.DY[o.rot];
    if (bx < 0 && L) rs[0] = -k; else if (bx > 0 && Rr) rs[0] = k;
    if (by < 0 && N) rs[1] = -k; else if (by > 0 && Sd) rs[1] = k;
    // laterais (cantos), só se o objeto estiver encostado de um lado só
    if (!bx && L !== Rr) rs[0] = L ? -k : k;
    if (!by && N !== Sd) rs[1] = N ? -k : k;
    return rs;
  };

  // ------------------------------------------------------------------
  // Sprites
  // ------------------------------------------------------------------
  const VARIETY = { tree: 5, pine: 5, bush: 4, rock: 4, shelf: 6, bookshelf: 6, clothesline: 3, plant: 3 };
  const siblings = new Map();
  RO.budget = 1e9;
  RO.reset = function (m) { map = m; cache.clear(); siblings.clear(); if (m) for (const o of m.objects) delete o._rs; };
  RO.setScale = function (s) { if (s !== S) { S = s; cache.clear(); siblings.clear(); } };
  RO.def = (type) => DEF[type] || { h: 1.5, mx: 8 };
  RO.lit = function (o, s) { return !!(o.light && s && s.power); };

  RO.sprite = function (o, lit) {
    const d = DEF[o.type] || { h: 1.5, mx: 8 };
    const rot = d.norot ? 0 : o.rot & 3;
    const v = o.variant | 0;
    let bv = 0;
    if ((o.type === 'kitchen_counter' || o.type === 'sink') && map) bv = o.building || 0;
    const rt = o.type === 'sink' ? roomType(o) : null;
    const vr = VARIETY[o.type] || 0;
    const sub = vr ? o.id % vr : 0;
    const base = o.type + '|' + rot + '|' + o.w + 'x' + o.h + '|' + (o.wrecked ? 1 : 0) + (lit ? 'L' : '') + (bv ? '|b' + bv : '') + (rt === 'bathroom' ? '|bath' : '');
    const key = base + '|' + v + '|' + sub;
    let spr = cache.get(key);
    if (spr) return spr;
    // orçamento por quadro: se estourou, usa um irmão já pronto (troca quando for gerado)
    if (RO.budget <= 0) { const alt = siblings.get(base); if (alt) return alt; }
    const tGen = performance.now();
    const A = rot & 1 ? o.w : o.h, D = rot & 1 ? o.h : o.w;
    const mx = d.mx + 4;
    const L = o.h * 32 + mx, Rr = o.w * 32 + mx, TOP = Math.ceil(d.h * ZPX) + 10, B = 10;
    const W = L + Rr, H = TOP + (o.w + o.h) * 16 + B;
    const c = R.canvas(W * S, H * S), g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(S, 0, 0, S, 0, 0);
    g.lineJoin = 'round';
    const M = R.model(g, L, TOP, rot, A, D);
    M.begin();
    const fn = MODELS[o.type] || generic;
    // id estável por chave (para variações aleatórias determinísticas)
    const oid = { id: vr ? sub * 7 + v * 3 + 1 : v, wrecked: o.wrecked, room: o.room, height: o.height };
    try { fn(M, oid, v, A, D, { bv: bv ? (R.hash(bv, 1, 5) * 6) | 0 : v, room: rt, lit }); } catch (e) { console.error('[render] objeto', o.type, e); }
    M.end();
    spr = { c, L, TOP, w: W, h: H, hull: silhouette(g, W * S, H * S, S, L, TOP) };
    trim(spr, g, W * S, H * S);
    if (d.light) { const lx = M.X(d.light[0], d.light[1]), ly = M.Y(d.light[0], d.light[1]); spr.light = [lx, ly, d.light[2]]; }
    cache.set(key, spr);
    siblings.set(base, spr);
    RO.budget -= performance.now() - tGen;
    if (cache.size > (S > 1 ? 500 : 1200)) { let n = 150; for (const k of cache.keys()) { cache.delete(k); if (--n <= 0) break; } siblings.clear(); }
    return spr;
  };
  RO.cacheSize = () => cache.size;
  // Recorta o sprite ao retângulo opaco (menos pixels para rasterizar a cada quadro)
  function trim(spr, g, cw, ch) {
    let data;
    try { data = g.getImageData(0, 0, cw, ch).data; } catch (e) { return; }
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let y = 0; y < ch; y++) {
      const row = y * cw * 4;
      for (let x = 0; x < cw; x++) if (data[row + x * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) return;
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(cw - 1, x1 + 1); y1 = Math.min(ch - 1, y1 + 1);
    if (x1 - x0 + 1 >= cw - 2 && y1 - y0 + 1 >= ch - 2) return;
    const S = R.S || 1;
    const c = R.canvas(x1 - x0 + 1, y1 - y0 + 1);
    c.getContext('2d').drawImage(spr.c, -x0, -y0);
    spr.c = c; spr.L -= x0 / S; spr.TOP -= y0 / S; spr.w = c.width / S; spr.h = c.height / S;
  }
  // Contorno x-monótono do sprite (topo e base de cada coluna opaca), em px isométricos
  // relativos à âncora. Usado para aplicar a luz do objeto exatamente sobre ele.
  function silhouette(g, cw, ch, S, L, TOP) {
    let data;
    try { data = g.getImageData(0, 0, cw, ch).data; } catch (e) { return new Float32Array(0); }
    const step = Math.max(2, Math.round((cw / S > 120 ? 6 : 4) * S));
    const cols = [];
    for (let x = 0; x < cw; x += step) {
      let y0 = ch, y1 = -1;
      const xe = Math.min(cw, x + step);
      for (let xx = x; xx < xe; xx++) {
        for (let y = 0; y < y0; y++) if (data[(y * cw + xx) * 4 + 3] > 50) { y0 = y; break; }
        for (let y = ch - 1; y > y1; y--) if (data[(y * cw + xx) * 4 + 3] > 50) { y1 = y; break; }
      }
      if (y1 < 0) { cols.push(null); continue; }
      cols.push([x, xe, y0, y1]);
    }
    // escada: topo esquerda→direita, base direita→esquerda (só colunas contíguas não vazias; pega o maior trecho)
    let best = null, cur = [];
    for (const c of cols) { if (c) cur.push(c); else { if (!best || cur.length > best.length) best = cur; cur = []; } }
    if (!best || cur.length > best.length) best = cur;
    if (!best.length) return new Float32Array(0);
    const top = [], bot = [];
    for (let k = 0; k < best.length; k++) {
      const [x0, x1, y0, y1] = best[k];
      if (k && best[k - 1][2] === y0) top[top.length - 2] = x1; else top.push(x0, y0, x1, y0);
      if (k && best[k - 1][3] === y1) bot[bot.length - 2] = x1; else bot.push(x0, y1 + 1, x1, y1 + 1);
    }
    const out = new Float32Array(top.length + bot.length);
    let k = 0;
    for (let i = 0; i < top.length; i += 2) { out[k++] = top[i] / S - L; out[k++] = top[i + 1] / S - TOP; }
    for (let i = bot.length - 2; i >= 0; i -= 2) { out[k++] = bot[i] / S - L; out[k++] = bot[i + 1] / S - TOP; }
    return out;
  }
  RO.TYPES = Object.keys(MODELS);
})();
