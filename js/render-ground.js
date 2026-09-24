/* =====================================================================
 * VALE QUIETO — render-ground.js  (Etapa 2: Render)
 * Chão: texturas procedurais por tipo/variante (geradas "de cima" e
 * projetadas no losango), cache em blocos retangulares de tela (512×256 px
 * isométricos), transições irregulares entre pisos naturais, meio-fio,
 * margens de água, borda de piscina, varanda/píer elevados, marcas de rua,
 * tapetes, oclusão ambiente junto às paredes e sombras de contato.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, F = G.FLOOR, W = G.WALL, U = G.util;
  const GR = (R.ground = {});
  const CW = 512, CH = 256;          // bloco de chão em px isométricos (zoom 1)
  GR.CW = CW; GR.CH = CH;
  let S = 1, T = 64;                 // escala do cache e texels por tile
  let map = null;
  const texCache = new Map();
  const chunks = new Map();
  let frameNo = 0;
  GR.stats = { built: 0, chunks: 0 };

  // ------------------------------------------------------------------
  // Dados derivados do mapa
  // ------------------------------------------------------------------
  let qsrc = null;       // Int32Array(w*h*4): tile-fonte de cada quarto (NW,NE,SW,SE) — paredes
  let waterDepth = null; // Uint8Array: distância à margem (tiles de água)
  let stamp = null, stampN = 0;

  GR.reset = function (m) {
    map = m;
    texCache.clear();
    chunks.clear();
    const n = m.w * m.h;
    qsrc = new Int32Array(n * 4);
    for (let i = 0; i < n; i++) GR.updateQuarters(i);
    // profundidade da água (BFS a partir da margem)
    waterDepth = new Uint8Array(n);
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      if (m.floor[i] !== F.WATER) continue;
      let shore = false;
      for (let d = 0; d < 4; d++) {
        const nx = x + R.DX[d], ny = y + R.DY[d];
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        if (m.floor[ny * m.w + nx] !== F.WATER) shore = true;
      }
      if (shore) { waterDepth[i] = 1; q[qt++] = i; }
    }
    while (qh < qt) {
      const i = q[qh++], x = i % m.w, y = (i / m.w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + R.DX[d], ny = y + R.DY[d];
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const j = ny * m.w + nx;
        if (m.floor[j] === F.WATER && !waterDepth[j]) { waterDepth[j] = Math.min(250, waterDepth[i] + 1); q[qt++] = j; }
      }
    }
    stamp = new Uint32Array(m.objects.length + 16); stampN = 0;
  };
  GR.waterDepth = (i) => (waterDepth ? waterDepth[i] : 0);

  // Quartos de um tile de parede herdam o piso do vizinho não-parede daquele lado
  GR.updateQuarters = function (i) {
    const m = map, w = m.w;
    const x = i % w, y = (i / w) | 0;
    for (let q = 0; q < 4; q++) {
      let src = i;
      if (m.wall[i]) {
        const sx = q & 1 ? 1 : -1, sy = q & 2 ? 1 : -1;
        const c = [[x + sx, y], [x, y + sy], [x + sx, y + sy]];
        for (let k = 0; k < 3; k++) {
          const cx = c[k][0], cy = c[k][1];
          if (cx < 0 || cy < 0 || cx >= w || cy >= m.h) continue;
          const j = cy * w + cx;
          if (!m.wall[j]) { src = j; break; }
        }
      }
      qsrc[i * 4 + q] = src;
    }
  };
  GR.qsrc = (i, q) => (qsrc ? qsrc[i * 4 + q] : i);

  // ------------------------------------------------------------------
  // Parâmetros de piso por tile (tom da madeira, cor do carpete...)
  // ------------------------------------------------------------------
  function roomOf(i) { const r = map.room[i]; return r ? map.rooms[r - 1] : null; }
  function bldOf(i) { const b = map.building[i]; return b ? map.buildings[b - 1] : null; }
  function porchOrient(x, y) {
    const m = map;
    for (let d = 1; d <= 4; d++) {
      for (let k = 0; k < 4; k++) {
        const nx = x + R.DX[k] * d, ny = y + R.DY[k] * d;
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        if (m.building[ny * m.w + nx]) return k & 1 ? 1 : 0; // casa ao norte/sul → tábuas em y
      }
    }
    return (x + y) & 1;
  }
  function dockOrient(x, y) {
    const m = map;
    const isD = (a, b) => a >= 0 && b >= 0 && a < m.w && b < m.h && m.floor[b * m.w + a] === F.DOCK;
    const nx = (isD(x - 1, y) ? 1 : 0) + (isD(x + 1, y) ? 1 : 0), ny = (isD(x, y - 1) ? 1 : 0) + (isD(x, y + 1) ? 1 : 0);
    return nx >= ny ? 1 : 0; // píer ao longo de x → tábuas atravessadas (ao longo de y)
  }
  // retorna string de parâmetro para a textura
  function floorParam(type, i) {
    const m = map, x = i % m.w, y = (i / m.w) | 0;
    switch (type) {
      case F.WOOD: {
        const b = bldOf(i), r = roomOf(i);
        const tone = b ? (b.id * 7 + (b.type === 'house' ? 0 : 3)) % R.PAL.woodFloor.length : 0;
        const orient = r ? (r.w >= r.h ? 0 : 1) : 0;
        return tone + ':' + orient;
      }
      case F.TILE: {
        const r = roomOf(i), b = bldOf(i);
        const id = r ? r.id : b ? b.id : 0;
        const checker = r && r.type === 'kitchen' && R.hash(id, 3, 17) < 0.45 ? 1 : 0;
        if (b && b.floorColor) return 'c' + b.floorColor + ':' + checker;
        return ((R.hash(id, 1, 5) * R.PAL.tileFloor.length) | 0) + ':' + checker;
      }
      case F.CARPET: {
        const r = roomOf(i), id = r ? r.id : 0;
        return '' + ((R.hash(id, 2, 9) * R.PAL.carpet.length) | 0);
      }
      case F.LINOLEUM: {
        const r = roomOf(i), b = bldOf(i), id = r ? r.id : b ? b.id : 0;
        if (b && b.floorColor) return 'c' + b.floorColor + ':' + ((R.hash(id, 4, 3) * 2) | 0);
        return ((R.hash(id, 3, 7) * R.PAL.lino.length) | 0) + ':' + ((R.hash(id, 4, 3) * 2) | 0);
      }
      case F.CONCRETE: {
        const b = bldOf(i);
        return b && b.floorColor ? 'c' + b.floorColor : '0';
      }
      case F.PORCH: return ((R.hash(map.building[i] || x >> 4, y >> 4, 23) * 4) | 0) + ':' + porchOrient(x, y);
      case F.DOCK: return '' + dockOrient(x, y);
      default: return '0';
    }
  }

  // ------------------------------------------------------------------
  // Texturas (vistas de cima, T×T texels = 1 tile)
  // ------------------------------------------------------------------
  function pixNoise(g, base, amp, rng, chroma) {
    const img = g.getImageData(0, 0, T, T), d = img.data;
    for (let p = 0; p < d.length; p += 4) {
      const n = (rng() - 0.5) * 2 * amp;
      const cr = chroma ? (rng() - 0.5) * chroma : 0;
      d[p] = base[0] + n + cr; d[p + 1] = base[1] + n; d[p + 2] = base[2] + n - cr; d[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  function dots(g, rng, n, cols, r0, r1, alpha) {
    for (let k = 0; k < n; k++) {
      g.fillStyle = cols[(rng() * cols.length) | 0];
      g.globalAlpha = alpha == null ? 1 : alpha * (0.6 + rng() * 0.4);
      const r = (r0 + rng() * (r1 - r0)) * (T / 64);
      g.fillRect(rng() * T, rng() * T, r, r);
    }
    g.globalAlpha = 1;
  }
  function crack(g, rng, col, w) {
    g.strokeStyle = col; g.lineWidth = w * (T / 64); g.lineCap = 'round';
    let x = rng() * T, y = rng() * T, a = rng() * 6.28;
    g.beginPath(); g.moveTo(x, y);
    const n = 5 + ((rng() * 6) | 0);
    for (let k = 0; k < n; k++) {
      a += (rng() - 0.5) * 1.3; x += Math.cos(a) * T * 0.09; y += Math.sin(a) * T * 0.09;
      g.lineTo(x, y);
      if (rng() < 0.25) { // ramo
        const bx = x + Math.cos(a + 1.2) * T * 0.08, by = y + Math.sin(a + 1.2) * T * 0.08;
        g.moveTo(bx, by); g.lineTo(x, y);
      }
    }
    g.stroke();
  }
  function planks(g, rng, n, base, jit, gapCol, orient, opt) {
    g.save();
    if (orient) g.setTransform(0, 1, 1, 0, 0, 0); // troca eixos: tábuas ao longo de y
    const pw = T / n;
    for (let j = 0; j < n; j++) {
      const y0 = j * pw;
      let x = -rng() * T * 0.6;
      while (x < T) {
        const len = T * (0.55 + rng() * 0.8);
        const c = R.jitter(base, jit, rng());
        g.fillStyle = R.css(c);
        g.fillRect(x, y0, len, pw);
        // veios
        g.globalAlpha = 0.12;
        g.strokeStyle = R.css(c, 0.7); g.lineWidth = 0.6 * (T / 64);
        for (let k = 0; k < 2; k++) {
          const yy = y0 + pw * (0.25 + rng() * 0.5);
          g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + len * 0.3, yy + (rng() - 0.5) * pw * 0.5, x + len * 0.7, yy + (rng() - 0.5) * pw * 0.5, x + len, yy); g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = gapCol; g.fillRect(x + len - 0.6 * (T / 64), y0, 1 * (T / 64), pw);
        if (opt && opt.nails) { g.fillStyle = 'rgba(40,35,30,0.5)'; g.fillRect(x + 2, y0 + pw * 0.3, 1, 1); g.fillRect(x + 2, y0 + pw * 0.65, 1, 1); }
        x += len;
      }
      g.fillStyle = gapCol; g.fillRect(0, y0 + pw - (opt && opt.gap || 1) * (T / 64), T, (opt && opt.gap || 1) * (T / 64));
    }
    g.restore();
  }
  function hstr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }

  function makeTex(type, param, v) {
    const c = R.canvas(T, T), g = c.getContext('2d');
    const rng = U.rng((type * 7919 + v * 104729 + hstr(param) * 13 + 77) >>> 0);
    const k = T / 64;
    const pp = param.split(':');
    const colParam = (list) => (pp[0][0] === 'c' ? R.hex(pp[0].slice(1)) : R.hex(list[(+pp[0] || 0) % list.length]));
    switch (type) {
      case F.GRASS: {
        pixNoise(g, [101, 118, 57], 9, rng, 6);
        dots(g, rng, 240, ['#7a8c46', '#5a6b30', '#8a894a', '#6e843f', '#54662e', '#76803f'], 1, 2.4, 0.7);
        g.lineCap = 'round';
        for (let n = 0; n < 70; n++) {
          g.strokeStyle = rng() < 0.5 ? 'rgba(135,150,75,0.45)' : 'rgba(62,80,36,0.45)';
          g.lineWidth = 0.8 * k;
          const x = rng() * T, y = rng() * T, a = rng() * 6.28;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 3 * k, y + Math.sin(a) * 3 * k); g.stroke();
        }
        if (v === 7) dots(g, rng, 40, ['#4f6a2c', '#5d7a34'], 2, 3.5, 0.6);
        break;
      }
      case F.DARK_GRASS: {
        pixNoise(g, [70, 85, 47], 10, rng, 8);
        dots(g, rng, 200, ['#5a6a36', '#3b4827', '#65583a', '#4b5a30', '#72643e', '#566a34'], 1, 2.6, 0.75);
        for (let n = 0; n < 16; n++) {
          g.fillStyle = ['#7a5a32', '#8a6a3a', '#6a4a2a', '#8e7040', '#5e4a2c'][(rng() * 5) | 0];
          g.globalAlpha = 0.7;
          g.beginPath(); g.ellipse(rng() * T, rng() * T, (1.5 + rng() * 1.8) * k, (0.8 + rng()) * k, rng() * 3.14, 0, 6.28); g.fill();
        }
        g.globalAlpha = 0.6; g.strokeStyle = '#4a3a28'; g.lineWidth = 0.7 * k;
        for (let n = 0; n < 3; n++) { const x = rng() * T, y = rng() * T, a = rng() * 6.28; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 7 * k, y + Math.sin(a) * 7 * k); g.stroke(); }
        g.globalAlpha = 1;
        break;
      }
      case F.DIRT: {
        pixNoise(g, [122, 99, 70], 11, rng, 6);
        dots(g, rng, 180, ['#8e7656', '#6a553b', '#9a845f', '#735c40', '#826a4a'], 1, 2.5, 0.7);
        for (let n = 0; n < 9; n++) {
          const x = rng() * T, y = rng() * T, r = (1 + rng() * 1.6) * k;
          g.fillStyle = 'rgba(60,48,34,0.5)'; g.beginPath(); g.ellipse(x + 0.6 * k, y + 0.6 * k, r, r * 0.8, 0, 0, 6.28); g.fill();
          g.fillStyle = ['#a39580', '#8e8270', '#b0a28a'][(rng() * 3) | 0]; g.beginPath(); g.ellipse(x, y, r, r * 0.8, 0, 0, 6.28); g.fill();
        }
        if (v >= 6) crack(g, rng, 'rgba(70,55,38,0.5)', 0.8);
        break;
      }
      case F.GRAVEL: {
        pixNoise(g, [132, 127, 116], 10, rng, 4);
        for (let n = 0; n < 150; n++) {
          const x = rng() * T, y = rng() * T, r = (1.2 + rng() * 2.2) * k;
          const col = R.hex(['#9a968c', '#77736a', '#a8a296', '#6a665e', '#8e877a', '#b0a998', '#857e70'][(rng() * 7) | 0]);
          g.fillStyle = R.css(col, 0.6); g.beginPath(); g.ellipse(x + 0.7 * k, y + 0.7 * k, r, r * 0.75, 0.3, 0, 6.28); g.fill();
          g.fillStyle = R.css(col); g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0.3, 0, 6.28); g.fill();
          g.fillStyle = R.css(col, 1.25, 0.8); g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.4, r * 0.3, 0.3, 0, 6.28); g.fill();
        }
        break;
      }
      case F.SAND: {
        pixNoise(g, [203, 183, 137], 7, rng, 5);
        dots(g, rng, 140, ['#bba67a', '#d8c69c', '#c2ab80', '#a8946a'], 1, 1.8, 0.6);
        g.strokeStyle = 'rgba(235,222,190,0.35)'; g.lineWidth = 1 * k;
        for (let n = 0; n < 3; n++) {
          const y = rng() * T; g.beginPath(); g.moveTo(0, y);
          for (let x = 0; x <= T; x += 4 * k) g.lineTo(x, y + Math.sin(x * 0.2 / k + n) * 2 * k);
          g.stroke();
        }
        break;
      }
      case F.ASPHALT: case F.ROAD_LINE: {
        pixNoise(g, [69, 71, 74], 10, rng, 3);
        dots(g, rng, 170, ['#5c5e62', '#64666a', '#3c3e41', '#707276', '#4e5054'], 0.8, 1.6, 0.8);
        if (v === 4 || v === 7) { crack(g, rng, 'rgba(28,29,31,0.8)', 1.1); crack(g, rng, 'rgba(28,29,31,0.6)', 0.8); }
        if (v === 5 || v === 7) {
          const x = T * (0.3 + rng() * 0.4), y = T * (0.3 + rng() * 0.4);
          const gr = g.createRadialGradient(x, y, 1, x, y, T * 0.3);
          gr.addColorStop(0, 'rgba(22,22,26,0.55)'); gr.addColorStop(0.6, 'rgba(30,30,36,0.3)'); gr.addColorStop(1, 'rgba(30,30,36,0)');
          g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, T * 0.3, T * 0.22, rng() * 3, 0, 6.28); g.fill();
        }
        if (v === 6) {
          const x = T * rng() * 0.4, y = T * rng() * 0.4, w = T * (0.4 + rng() * 0.4), h = T * (0.3 + rng() * 0.4);
          g.fillStyle = 'rgba(40,41,44,0.55)'; g.fillRect(x, y, w, h);
          g.strokeStyle = 'rgba(25,25,28,0.6)'; g.lineWidth = 1 * k; g.strokeRect(x, y, w, h);
        }
        break;
      }
      case F.SIDEWALK: {
        pixNoise(g, [166, 162, 150], 7, rng, 3);
        dots(g, rng, 60, ['#9a968b', '#b2aea2', '#8f8b80'], 0.8, 1.4, 0.5);
        if (v === 4) crack(g, rng, 'rgba(90,88,80,0.7)', 0.8);
        if (v === 5) { g.fillStyle = 'rgba(80,76,66,0.14)'; g.beginPath(); g.ellipse(T * 0.5, T * 0.55, T * 0.26, T * 0.18, 0.4, 0, 6.28); g.fill(); }
        if (v === 6) dots(g, rng, 5, ['#5e5a55', '#6e6660'], 1.4, 2, 0.8);
        g.fillStyle = '#86837a'; g.fillRect(0, 0, T, 1.4 * k); g.fillRect(0, 0, 1.4 * k, T);
        g.fillStyle = 'rgba(200,197,188,0.6)'; g.fillRect(0, 1.4 * k, T, 0.8 * k); g.fillRect(1.4 * k, 0, 0.8 * k, T);
        break;
      }
      case F.CONCRETE: {
        const base = pp[0][0] === 'c' ? R.hex(pp[0].slice(1)) : [152, 150, 142];
        pixNoise(g, base, 6, rng, 2);
        g.globalAlpha = 0.08; g.strokeStyle = '#ffffff'; g.lineWidth = 3 * k;
        for (let n = 0; n < 3; n++) { const y = rng() * T; g.beginPath(); g.arc(rng() * T, y, T * (0.3 + rng() * 0.4), 0, 1.5); g.stroke(); }
        g.globalAlpha = 1;
        if (v === 5) { const gr = g.createRadialGradient(T / 2, T / 2, 1, T / 2, T / 2, T * 0.35); gr.addColorStop(0, 'rgba(30,30,32,0.35)'); gr.addColorStop(1, 'rgba(30,30,32,0)'); g.fillStyle = gr; g.fillRect(0, 0, T, T); }
        if (v === 6) crack(g, rng, 'rgba(80,78,72,0.6)', 0.8);
        break;
      }
      case F.WOOD: {
        const tone = R.hex(R.PAL.woodFloor[(+pp[0] || 0) % R.PAL.woodFloor.length]);
        g.fillStyle = R.css(tone, 0.6); g.fillRect(0, 0, T, T);
        planks(g, rng, 4, tone, 0.14, 'rgba(45,30,18,0.55)', +pp[1] || 0);
        break;
      }
      case F.PORCH: {
        const cols = ['#8e8a80', '#b3ad9e', '#7a5c42', '#98876c'];
        const base = R.hex(cols[(+pp[0] || 0) % 4]);
        g.fillStyle = R.css(base, 0.5); g.fillRect(0, 0, T, T);
        planks(g, rng, 5, base, 0.08, 'rgba(40,32,24,0.6)', +pp[1] || 0, { nails: true, gap: 1.3 });
        break;
      }
      case F.DOCK: {
        pixNoise(g, [38, 58, 64], 6, rng, 0);
        planks(g, rng, 5, R.hex('#8a7a62'), 0.16, 'rgba(20,30,34,0.95)', +pp[0] || 0, { nails: true, gap: 2.4 });
        break;
      }
      case F.TILE: {
        const base = colParam(R.PAL.tileFloor);
        const checker = +pp[1] || 0;
        const alt = checker ? [58, 60, 64] : R.darken(base, 0.06);
        const n = checker ? 2 : 3, cs = T / n;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const col = checker && ((i + j) & 1) ? alt : R.jitter(base, 0.05, rng());
          g.fillStyle = R.css(col); g.fillRect(i * cs, j * cs, cs, cs);
          const gr = g.createLinearGradient(i * cs, j * cs, (i + 1) * cs, (j + 1) * cs);
          gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.05)');
          g.fillStyle = gr; g.fillRect(i * cs, j * cs, cs, cs);
        }
        g.fillStyle = checker ? 'rgba(120,118,110,0.9)' : R.css(base, 0.78);
        for (let i = 0; i < n; i++) { g.fillRect(i * cs, 0, 1 * k, T); g.fillRect(0, i * cs, T, 1 * k); }
        break;
      }
      case F.CARPET: {
        const base = R.hex(R.PAL.carpet[(+pp[0] || 0) % R.PAL.carpet.length]);
        pixNoise(g, base, 13, rng, 5);
        for (let n = 0; n < 6; n++) {
          g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
          g.beginPath(); g.ellipse(rng() * T, rng() * T, T * 0.3, T * 0.2, rng() * 3, 0, 6.28); g.fill();
        }
        break;
      }
      case F.LINOLEUM: {
        const base = colParam(R.PAL.lino);
        g.fillStyle = R.css(base); g.fillRect(0, 0, T, T);
        if (+pp[1] === 1) { // xadrez miúdo
          const cs = T / 4;
          for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if ((i + j) & 1) { g.fillStyle = R.css(base, 0.9); g.fillRect(i * cs, j * cs, cs, cs); }
          g.fillStyle = R.css(base, 0.8);
          for (let i = 0; i < 4; i++) { g.fillRect(i * cs, 0, 0.6 * k, T); g.fillRect(0, i * cs, T, 0.6 * k); }
        } else dots(g, rng, 160, [R.css(base, 0.85), R.css(base, 1.1), R.css(base, 0.75)], 0.8, 2, 0.6);
        const gr = g.createLinearGradient(0, 0, T, T);
        gr.addColorStop(0, 'rgba(255,255,255,0.08)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.05)');
        g.fillStyle = gr; g.fillRect(0, 0, T, T);
        break;
      }
      case F.WATER: {
        pixNoise(g, [46, 76, 84], 4, rng, 2);
        for (let n = 0; n < 8; n++) {
          g.fillStyle = rng() < 0.5 ? 'rgba(90,130,135,0.08)' : 'rgba(20,40,50,0.1)';
          g.beginPath(); g.ellipse(rng() * T, rng() * T, T * 0.3, T * 0.08, rng() * 0.4, 0, 6.28); g.fill();
        }
        break;
      }
      case F.POOL: {
        pixNoise(g, [70, 160, 176], 5, rng, 3);
        g.strokeStyle = 'rgba(170,235,240,0.35)'; g.lineWidth = 1.1 * k; g.lineJoin = 'round';
        for (let n = 0; n < 9; n++) {
          let x = rng() * T, y = rng() * T; g.beginPath(); g.moveTo(x, y);
          for (let s = 0; s < 4; s++) { x += (rng() - 0.5) * T * 0.35; y += (rng() - 0.5) * T * 0.35; g.lineTo(x, y); }
          g.stroke();
        }
        break;
      }
      default: {
        g.fillStyle = '#0b0d0c'; g.fillRect(0, 0, T, T);
      }
    }
    return c;
  }
  function tex(type, param, v) {
    const key = type + '|' + param + '|' + v;
    let c = texCache.get(key);
    if (!c) { c = makeTex(type, param, v); texCache.set(key, c); }
    return c;
  }
  GR.tex = tex;

  // ------------------------------------------------------------------
  // Construção de um bloco
  // ------------------------------------------------------------------
  const PRIO = new Int8Array(32).fill(-1);
  PRIO[F.WATER] = 0; PRIO[F.SAND] = 1; PRIO[F.ASPHALT] = 2; PRIO[F.ROAD_LINE] = 2; PRIO[F.DIRT] = 3;
  PRIO[F.GRAVEL] = 4; PRIO[F.GRASS] = 5; PRIO[F.DARK_GRASS] = 6;
  const NATURAL = (f) => f === F.GRASS || f === F.DARK_GRASS || f === F.DIRT || f === F.SAND || f === F.GRAVEL;

  let cctx = null, cX0 = 0, cY0 = 0;   // contexto do bloco em construção e sua origem
  function setIso() { cctx.setTransform(S, 0, 0, S, -cX0 * S, -cY0 * S); }
  function setWorld() { cctx.setTransform(32 * S, 16 * S, -32 * S, 16 * S, -cX0 * S, -cY0 * S); }
  function isoX(x, y) { return (x - y) * 32; }
  function isoY(x, y) { return (x + y) * 16; }

  function floorAt(x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return F.NONE;
    return map.floor[y * map.w + x];
  }
  // piso "efetivo" (quartos de parede → piso da fonte)
  function effFloor(x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return F.NONE;
    const i = y * map.w + x;
    if (map.wall[i]) return -1;
    return map.floor[i];
  }
  // variantes 0–3 comuns; 4–7 "especiais" (rachaduras, manchas, remendos) só em ~9% dos tiles
  function variant(x, y) {
    const h = R.hash(x, y, 101);
    if (h < 0.91) return (h / 0.91 * 4) | 0;
    return 4 + (((h - 0.91) / 0.09 * 4) | 0);
  }

  // desenha a textura cobrindo o quadrado de mundo [wx, wx+sz]×[wy, wy+sz] (com leve sobreposição)
  function drawTexSquare(texc, wx, wy, sz, sx0, sy0, sw) {
    const k = sz / T, ov = 1.025;
    const cx = wx + sz / 2, cy = wy + sz / 2;
    const ox = cx - (sz / 2) * ov, oy = cy - (sz / 2) * ov;
    const a = k * ov;
    cctx.setTransform(32 * a * S, 16 * a * S, -32 * a * S, 16 * a * S, (isoX(ox, oy) - cX0) * S, (isoY(ox, oy) - cY0) * S);
    if (sw) cctx.drawImage(texc, sx0, sy0, sw, sw, 0, 0, sw, sw);
    else cctx.drawImage(texc, 0, 0);
  }
  function drawFloorTile(x, y) {
    const i = y * map.w + x;
    if (map.wall[i]) {
      // quartos: cada um herda o piso do vizinho daquele lado
      for (let q = 0; q < 4; q++) {
        const src = qsrc[i * 4 + q];
        const f = map.floor[src];
        const sx = src % map.w, sy = (src / map.w) | 0;
        const t = tex(f, floorParam(f, src), variant(sx, sy));
        const h = T / 2;
        const u0 = q & 1 ? h : 0, v0 = q & 2 ? h : 0;
        const k = 1 / T;
        const wx = x + u0 / T - 0.01, wy = y + v0 / T - 0.01;
        cctx.setTransform(32 * k * S * 1.04, 16 * k * S * 1.04, -32 * k * S * 1.04, 16 * k * S * 1.04, (isoX(wx, wy) - cX0) * S, (isoY(wx, wy) - cY0) * S);
        cctx.drawImage(t, u0, v0, h, h, 0, 0, h, h);
      }
      return;
    }
    const f = map.floor[i];
    drawTexSquare(tex(f, floorParam(f, i), variant(x, y)), x, y, 1);
  }

  // Polígono irregular (mundo) ao longo da aresta dir do tile (x,y); retorna pontos internos [x,y,...]
  const EDGE_K = 8;
  const _pts = new Float64Array((EDGE_K + 3) * 2);
  function edgeBand(x, y, dir, depth, taperA, taperB, salt) {
    // dir: 0 = N (-y), 1 = E (+x), 2 = S (+y), 3 = W (-x) — lado de onde vem o piso vizinho
    let ax, ay, bx, by, nx, ny, line, pos0;
    if (dir === 0) { ax = x; ay = y; bx = x + 1; by = y; nx = 0; ny = 1; line = y; pos0 = x; }
    else if (dir === 2) { ax = x; ay = y + 1; bx = x + 1; by = y + 1; nx = 0; ny = -1; line = y + 1; pos0 = x; }
    else if (dir === 3) { ax = x; ay = y; bx = x; by = y + 1; nx = 1; ny = 0; line = x + 500; pos0 = y; }
    else { ax = x + 1; ay = y; bx = x + 1; by = y + 1; nx = -1; ny = 0; line = x + 501; pos0 = y; }
    let n = 0;
    _pts[n++] = ax; _pts[n++] = ay;
    for (let k = 0; k <= EDGE_K; k++) {
      const s = k / EDGE_K;
      let d = depth * (0.28 + 0.72 * U.noise2((pos0 + s) * 3.1, line * 7.3 + salt, 91));
      d += depth * 0.18 * (U.noise2((pos0 + s) * 9.7, line * 3.1 + salt, 92) - 0.5);
      if (taperA) d *= U.smoothstep(0, 0.4, s);
      if (taperB) d *= U.smoothstep(1, 0.6, s);
      _pts[n++] = ax + (bx - ax) * s + nx * d;
      _pts[n++] = ay + (by - ay) * s + ny * d;
    }
    _pts[n++] = bx; _pts[n++] = by;
    return n;
  }
  function pathWorld(n) {
    cctx.beginPath();
    for (let k = 0; k < n; k += 2) {
      const X = (isoX(_pts[k], _pts[k + 1]) - cX0) * S, Y = (isoY(_pts[k], _pts[k + 1]) - cY0) * S;
      if (k) cctx.lineTo(X, Y); else cctx.moveTo(X, Y);
    }
    cctx.closePath();
  }
  // tufos de grama (tela) ao longo dos pontos internos
  function fringe(n, cols, dens) {
    cctx.setTransform(S, 0, 0, S, -cX0 * S, -cY0 * S);
    cctx.lineWidth = 1; cctx.lineCap = 'round';
    for (let k = 2; k < n - 2; k += 2) {
      if (dens < 1 && ((k * 7919) % 10) / 10 > dens) continue;
      const X = isoX(_pts[k], _pts[k + 1]), Y = isoY(_pts[k], _pts[k + 1]);
      for (let b = 0; b < 2; b++) {
        const h = R.hash(X * 3 + b, Y * 5, 7);
        cctx.strokeStyle = cols[(h * cols.length) | 0];
        cctx.beginPath(); cctx.moveTo(X + (h - 0.5) * 5, Y + 1); cctx.lineTo(X + (h - 0.5) * 7 + (b ? 1 : -1), Y - 2.5 - h * 2.5); cctx.stroke();
      }
    }
  }
  const GRASS_BLADES = ['rgba(120,138,64,0.9)', 'rgba(84,104,44,0.9)', 'rgba(142,150,78,0.85)', 'rgba(98,120,52,0.9)'];
  const DARK_BLADES = ['rgba(70,90,44,0.9)', 'rgba(56,72,36,0.9)', 'rgba(92,104,54,0.85)'];

  function spillSource(f) { return PRIO[f] >= 0; }
  function transitions(x, y) {
    const t = effFloor(x, y);
    if (t < 0 || !spillSource(t)) return;
    // vizinhos de prioridade maior "invadem" este tile com borda irregular
    const nb = [effFloor(x, y - 1), effFloor(x + 1, y), effFloor(x, y + 1), effFloor(x - 1, y)];
    const diag = [effFloor(x + 1, y - 1), effFloor(x + 1, y + 1), effFloor(x - 1, y + 1), effFloor(x - 1, y - 1)]; // NE, SE, SW, NW
    // ordem por prioridade crescente
    for (let p = PRIO[t] + 1; p <= 6; p++) {
      for (let dir = 0; dir < 4; dir++) {
        const n = nb[dir];
        if (n < 0 || PRIO[n] !== p) continue;
        if (t === F.WATER) continue; // margens de água: passe próprio (marching squares)
        const src = n;
        const depth = t === F.WATER ? 0.32 : t === F.ASPHALT ? 0.2 : src === F.DARK_GRASS && t === F.GRASS ? 0.34 : 0.3;
        // afunila nas pontas se o vizinho lateral não é do mesmo piso nem recebe do mesmo
        const la = (dir + 3) & 3, lb = (dir + 1) & 3; // lados "antes" e "depois" ao longo da aresta
        // pontas: para N/S a aresta vai de W→E; para W/E vai de N→S
        const sideA = dir === 0 || dir === 2 ? 3 : 0, sideB = dir === 0 || dir === 2 ? 1 : 2;
        const dA = dir === 0 ? 3 : dir === 1 ? 0 : dir === 2 ? 2 : 3; // diagonal perto da ponta A
        const dB = dir === 0 ? 0 : dir === 1 ? 1 : dir === 2 ? 1 : 2;
        void la; void lb;
        const tA = !(nb[sideA] === src || diag[dA] === src);
        const tB = !(nb[sideB] === src || diag[dB] === src);
        const np = edgeBand(x, y, dir, depth, tA, tB, src * 3);
        const srcX = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0), srcY = y + (dir === 0 ? -1 : dir === 2 ? 1 : 0);
        // margem de água: barranco visível quando a terra está ao norte/oeste
        if (t === F.WATER && (dir === 0 || dir === 3)) {
          cctx.save();
          cctx.setTransform(S, 0, 0, S, -cX0 * S, (-cY0 + 3.5) * S);
          cctx.beginPath();
          for (let k = 0; k < np; k += 2) { const X = isoX(_pts[k], _pts[k + 1]), Y = isoY(_pts[k], _pts[k + 1]); if (k) cctx.lineTo(X, Y); else cctx.moveTo(X, Y); }
          cctx.closePath();
          cctx.fillStyle = src === F.SAND ? '#8f7c58' : '#4a3d2c';
          cctx.fill();
          cctx.restore();
        }
        cctx.save();
        pathWorld(np);
        cctx.clip();
        drawTexSquare(tex(src, floorParam(src, srcY * map.w + srcX), variant(x + 3, y + 5)), x, y, 1);
        cctx.restore();
        if (t === F.WATER) { // espuma/linha molhada
          cctx.setTransform(S, 0, 0, S, -cX0 * S, -cY0 * S);
          cctx.strokeStyle = dir === 0 || dir === 3 ? 'rgba(190,210,205,0.22)' : 'rgba(20,30,28,0.35)';
          cctx.lineWidth = 1.2;
          cctx.beginPath();
          for (let k = 2; k < np - 2; k += 2) { const X = isoX(_pts[k], _pts[k + 1]), Y = isoY(_pts[k], _pts[k + 1]) + (dir === 0 || dir === 3 ? 4.5 : 0.5); if (k > 2) cctx.lineTo(X, Y); else cctx.moveTo(X, Y); }
          cctx.stroke();
        }
        if (src === F.GRASS || src === F.DARK_GRASS) fringe(np, src === F.GRASS ? GRASS_BLADES : DARK_BLADES, t === F.WATER ? 0.5 : 1);
      }
      // escadinhas: dois vizinhos ortogonais do mesmo piso → preenche a metade do canto (diagonal irregular)
      for (let c = 0; c < 4; c++) {
        const dA = c, dB = (c + 1) & 3; // (N,E) (E,S) (S,W) (W,N)
        const n = nb[dA];
        if (n < 0 || PRIO[n] !== p || nb[dB] !== n) continue;
        if (t === F.WATER) continue;
        // canto compartilhado e os dois cantos opostos que definem a diagonal
        const cxs = [x + 1, x + 1, x, x], cys = [y, y + 1, y + 1, y];
        const cx = cxs[c], cy = cys[c];
        const ax = cxs[(c + 3) & 3], ay = cys[(c + 3) & 3], bx = cxs[(c + 1) & 3], by = cys[(c + 1) & 3];
        let np = 0;
        _pts[np++] = ax; _pts[np++] = ay;
        const K = 6;
        for (let k = 1; k < K; k++) {
          const s2 = k / K;
          const mx = ax + (bx - ax) * s2, my = ay + (by - ay) * s2;
          // empurra a diagonal um pouco para dentro do tile receptor, com ruído
          const inx = (x + 0.5) - cx, iny = (y + 0.5) - cy;
          const d = (0.1 + 0.16 * U.noise2(mx * 4.1 + c, my * 3.7, 93)) * Math.sin(s2 * Math.PI);
          _pts[np++] = mx + inx * d; _pts[np++] = my + iny * d;
        }
        _pts[np++] = bx; _pts[np++] = by;
        _pts[np++] = cx; _pts[np++] = cy;
        if (t === F.WATER && (c === 3)) { // diagonal virada para a câmera: barranco
          cctx.save(); cctx.setTransform(S, 0, 0, S, -cX0 * S, (-cY0 + 3.5) * S);
          cctx.beginPath(); for (let k = 0; k < np; k += 2) { const X = isoX(_pts[k], _pts[k + 1]), Y = isoY(_pts[k], _pts[k + 1]); if (k) cctx.lineTo(X, Y); else cctx.moveTo(X, Y); }
          cctx.closePath(); cctx.fillStyle = n === F.SAND ? '#8f7c58' : '#4a3d2c'; cctx.fill(); cctx.restore();
        }
        cctx.save(); pathWorld(np); cctx.clip();
        const srcX = x + (dA === 1 || dB === 1 ? 1 : dA === 3 || dB === 3 ? -1 : 0), srcY = y + (dA === 0 || dB === 0 ? -1 : 1);
        drawTexSquare(tex(n, floorParam(n, Math.max(0, Math.min(map.h - 1, srcY)) * map.w + Math.max(0, Math.min(map.w - 1, srcX))), variant(x + 5, y + 3)), x, y, 1);
        cctx.restore();
        if (t === F.WATER) {
          cctx.setTransform(S, 0, 0, S, -cX0 * S, -cY0 * S);
          cctx.strokeStyle = c === 3 ? 'rgba(190,210,205,0.22)' : 'rgba(20,30,28,0.35)'; cctx.lineWidth = 1.2;
          cctx.beginPath();
          for (let k = 0; k < np - 4; k += 2) { const X = isoX(_pts[k], _pts[k + 1]), Y = isoY(_pts[k], _pts[k + 1]) + (c === 3 ? 4.5 : 0.5); if (k) cctx.lineTo(X, Y); else cctx.moveTo(X, Y); }
          cctx.stroke();
        }
        if (n === F.GRASS || n === F.DARK_GRASS) fringe(np - 2, n === F.GRASS ? GRASS_BLADES : DARK_BLADES, t === F.WATER ? 0.5 : 0.8);
      }
      // cantos diagonais isolados
      for (let dg = 0; dg < 4; dg++) {
        const n = diag[dg];
        if (n < 0 || PRIO[n] !== p || t === F.WATER) continue;
        const o1 = dg === 0 ? 0 : dg === 1 ? 1 : dg === 2 ? 2 : 3, o2 = (o1 + 1) & 3; // N,E / E,S / S,W / W,N
        if (nb[o1] === n || nb[o2] === n) continue;
        if (t === F.WATER && (n === F.ASPHALT || n === F.ROAD_LINE)) continue;
        const cx = x + (dg === 0 || dg === 1 ? 1 : 0), cy = y + (dg === 1 || dg === 2 ? 1 : 0);
        const sx = cx === x ? 1 : -1, sy = cy === y ? 1 : -1; // para dentro do tile
        const r = 0.22 + 0.12 * U.noise2(cx * 3.3, cy * 2.9, 44);
        let np = 0;
        _pts[np++] = cx; _pts[np++] = cy;
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * Math.PI / 2;
          const rr = r * (0.8 + 0.4 * U.noise2(cx * 5 + k, cy * 5, 45));
          _pts[np++] = cx + sx * Math.cos(a) * rr; _pts[np++] = cy + sy * Math.sin(a) * rr;
        }
        cctx.save(); pathWorld(np); cctx.clip();
        drawTexSquare(tex(n, '0', variant(x + 1, y + 7)), x, y, 1);
        cctx.restore();
      }
    }
  }

  // Suavização por marching squares na grade dual: cada canto (x,y) é o centro de uma célula
  // formada por quartos de 4 tiles. Se a célula tem exatamente 2 pisos "naturais" (ou água × terra),
  // o contorno passa pelos pontos médios (com ruído) e cada quarto é repintado do lado certo.
  const SMOOTH = new Uint8Array(32);
  SMOOTH[F.GRASS] = 1; SMOOTH[F.DARK_GRASS] = 1; SMOOTH[F.DIRT] = 1; SMOOTH[F.SAND] = 1; SMOOTH[F.GRAVEL] = 1; SMOOTH[F.ASPHALT] = 2; SMOOTH[F.WATER] = 3;
  const _mid = [];
  for (let k = 0; k < 4; k++) _mid.push([0, 0]);
  function cellType(x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return -1;
    const i = y * map.w + x;
    if (map.wall[i]) return -1;
    const f = map.floor[i];
    if (f === F.ASPHALT && bridgeNear(x, y)) return -1;
    return SMOOTH[f] ? f : -1;
  }
  function bridgeNear(x, y) {
    for (let d = 0; d < 4; d++) { const nx = x + R.DX[d], ny = y + R.DY[d]; if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && map.floor[ny * map.w + nx] === F.WATER) return true; }
    return false;
  }
  function smoothCell(x, y) {
    const tx = [x - 1, x, x, x - 1], ty = [y - 1, y - 1, y, y];
    const t = [0, 0, 0, 0];
    let A = -1, B = -1;
    for (let k = 0; k < 4; k++) {
      const c = cellType(tx[k], ty[k]);
      if (c < 0) return;
      t[k] = c;
      if (A < 0 || c === A) A = c; else if (B < 0 || c === B) B = c; else return; // 3+ tipos
    }
    if (B < 0) return;
    // A = "alto" (prioridade maior); água sempre baixa
    const water = A === F.WATER || B === F.WATER;
    if (!water && SMOOTH[A] === 2 && SMOOTH[B] === 2) return;
    if (PRIO[B] > PRIO[A]) { const q = A; A = B; B = q; }
    const v = [t[0] === A ? 1 : 0, t[1] === A ? 1 : 0, t[2] === A ? 1 : 0, t[3] === A ? 1 : 0];
    if ((v[0] + v[1] + v[2] + v[3]) % 4 === 0) return;
    const cx = [x - 0.5, x + 0.5, x + 0.5, x - 0.5], cy = [y - 0.5, y - 0.5, y + 0.5, y + 0.5];
    const mid = (a, b) => {
      const mx = (cx[a] + cx[b]) / 2, my = (cy[a] + cy[b]) / 2;
      const j = (U.noise2(mx * 5.3 + 11, my * 5.3 + 7, 95) - 0.5) * 0.36;
      return [mx + (cx[b] - cx[a]) * j, my + (cy[b] - cy[a]) * j];
    };
    // pontos do contorno (subdivididos com ruído perpendicular) entre dois pontos médios
    const contour = (P, Q) => {
      const out = [];
      const dx = Q[0] - P[0], dy = Q[1] - P[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      for (let k = 1; k < 4; k++) {
        const s2 = k / 4, px = P[0] + dx * s2, py = P[1] + dy * s2;
        const d = (U.noise2(px * 6.1 + 3, py * 6.1 + 5, 96) - 0.5) * 0.22 * Math.sin(s2 * Math.PI);
        out.push([px + nx * d, py + ny * d]);
      }
      return out;
    };
    // polígonos dos dois lados (caminhando pelos 4 centros)
    const highPoly = [], lowPoly = [], segs = [];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) & 3;
      (v[k] ? highPoly : lowPoly).push([cx[k], cy[k]]);
      if (v[k] !== v[k2]) { const m = mid(k, k2); highPoly.push(m); lowPoly.push(m); segs.push(m); }
    }
    // insere os pontos intermediários do contorno nos dois polígonos
    const withContour = (poly, reverse) => {
      if (segs.length !== 2) return poly;
      const i0 = poly.indexOf(segs[0]), i1 = poly.indexOf(segs[1]);
      if (i0 < 0 || i1 < 0) return poly;
      // o contorno liga segs[?] ao outro através do interior; descobre a ordem dentro do polígono
      const cfw = contour(segs[0], segs[1]);
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        out.push(poly[k]);
        const nxt = poly[(k + 1) % poly.length];
        if (poly[k] === segs[0] && nxt === segs[1]) for (const q of cfw) out.push(q);
        else if (poly[k] === segs[1] && nxt === segs[0]) for (let j = cfw.length - 1; j >= 0; j--) out.push(cfw[j]);
      }
      void reverse;
      return out;
    };
    const hp = withContour(highPoly), lp = withContour(lowPoly);
    const pathPoly = (poly) => {
      cctx.beginPath();
      for (let k = 0; k < poly.length; k++) { const X = (isoX(poly[k][0], poly[k][1]) - cX0) * S, Y = (isoY(poly[k][0], poly[k][1]) - cY0) * S; if (k) cctx.lineTo(X, Y); else cctx.moveTo(X, Y); }
      cctx.closePath();
    };
    const e = 0.035;
    const quarterPath = (k) => {
      const qx0 = Math.min(cx[k], x) - e, qx1 = Math.max(cx[k], x) + e, qy0 = Math.min(cy[k], y) - e, qy1 = Math.max(cy[k], y) + e;
      cctx.beginPath();
      const P = [[qx0, qy0], [qx1, qy0], [qx1, qy1], [qx0, qy1]];
      for (let j = 0; j < 4; j++) { const X = (isoX(P[j][0], P[j][1]) - cX0) * S, Y = (isoY(P[j][0], P[j][1]) - cY0) * S; if (j) cctx.lineTo(X, Y); else cctx.moveTo(X, Y); }
      cctx.closePath();
    };
    let iA = -1, iB = -1;
    for (let k = 0; k < 4; k++) { const i = ty[k] * map.w + tx[k]; if (v[k] && iA < 0) iA = i; if (!v[k] && iB < 0) iB = i; }
    for (let k = 0; k < 4; k++) {
      cctx.save();
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      quarterPath(k); cctx.clip();
      if (v[k]) { pathPoly(lp); cctx.clip(); drawTexSquare(tex(B, floorParam(B, iB), variant(tx[k] + 7, ty[k] + 1)), tx[k], ty[k], 1); }
      else { pathPoly(hp); cctx.clip(); drawTexSquare(tex(A, floorParam(A, iA), variant(tx[k] + 2, ty[k] + 9)), tx[k], ty[k], 1); }
      cctx.restore();
    }
    if (segs.length !== 2) return;
    const line = [segs[0]].concat(contour(segs[0], segs[1]), [segs[1]]);
    cctx.setTransform(S, 0, 0, S, -cX0 * S, -cY0 * S);
    if (water) {
      // barranco quando a água fica "abaixo" na tela (face voltada para a câmera)
      let wx = 0, wy = 0, n = 0;
      for (let k = 0; k < 4; k++) if (t[k] === F.WATER) { wx += cx[k]; wy += cy[k]; n++; }
      wx /= n; wy /= n;
      const mx = (segs[0][0] + segs[1][0]) / 2, my = (segs[0][1] + segs[1][1]) / 2;
      const facing = (wx - mx) + (wy - my) > 0;
      const land = A === F.WATER ? B : A;
      const P = line.map((q) => [isoX(q[0], q[1]), isoY(q[0], q[1])]);
      if (facing) {
        cctx.fillStyle = land === F.SAND ? 'rgba(128,108,74,0.95)' : 'rgba(70,58,42,0.95)';
        cctx.beginPath(); P.forEach((q, k) => (k ? cctx.lineTo(q[0], q[1]) : cctx.moveTo(q[0], q[1])));
        for (let k = P.length - 1; k >= 0; k--) cctx.lineTo(P[k][0], P[k][1] + 3.5);
        cctx.closePath(); cctx.fill();
        cctx.strokeStyle = 'rgba(200,215,210,0.22)'; cctx.lineWidth = 1.1;
        cctx.beginPath(); P.forEach((q, k) => (k ? cctx.lineTo(q[0], q[1] + 5) : cctx.moveTo(q[0], q[1] + 5))); cctx.stroke();
      } else {
        cctx.strokeStyle = 'rgba(16,26,26,0.3)'; cctx.lineWidth = 1.3;
        cctx.beginPath(); P.forEach((q, k) => (k ? cctx.lineTo(q[0], q[1] + 0.8) : cctx.moveTo(q[0], q[1] + 0.8))); cctx.stroke();
      }
    }
    const grassy = A === F.GRASS || A === F.DARK_GRASS ? A : B === F.GRASS || B === F.DARK_GRASS ? B : -1;
    if (grassy >= 0 && !(water && grassy !== A && grassy !== B)) {
      let np = 0;
      _pts[np++] = line[0][0]; _pts[np++] = line[0][1];
      for (const q of line) { _pts[np++] = q[0]; _pts[np++] = q[1]; }
      _pts[np++] = line[line.length - 1][0]; _pts[np++] = line[line.length - 1][1];
      fringe(np, grassy === F.GRASS ? GRASS_BLADES : DARK_BLADES, water ? 0.6 : 0.9);
    }
  }

  // Faces verticais de pisos elevados (meio-fio, varanda, píer) e borda de piscina
  function edgeFaces(x, y) {
    const i = y * map.w + x;
    if (map.wall[i]) return;
    const f = map.floor[i];
    cctx.setTransform(S, 0, 0, S, -cX0 * S, -cY0 * S);
    const faceSE = (dir, h, fill, lines) => { // dir 1 = E, 2 = S
      let ax, ay, bx, by;
      if (dir === 1) { ax = x + 1; ay = y; bx = x + 1; by = y + 1; } else { ax = x; ay = y + 1; bx = x + 1; by = y + 1; }
      const X0 = isoX(ax, ay), Y0 = isoY(ax, ay), X1 = isoX(bx, by), Y1 = isoY(bx, by);
      cctx.fillStyle = fill;
      cctx.beginPath(); cctx.moveTo(X0, Y0); cctx.lineTo(X1, Y1); cctx.lineTo(X1, Y1 + h); cctx.lineTo(X0, Y0 + h); cctx.closePath(); cctx.fill();
      if (lines) {
        cctx.strokeStyle = lines; cctx.lineWidth = 0.7;
        for (let s = 0.2; s < 1; s += 0.2) { const X = X0 + (X1 - X0) * s, Y = Y0 + (Y1 - Y0) * s; cctx.beginPath(); cctx.moveTo(X, Y); cctx.lineTo(X, Y + h); cctx.stroke(); }
      }
      cctx.fillStyle = 'rgba(255,255,255,0.18)';
      cctx.beginPath(); cctx.moveTo(X0, Y0); cctx.lineTo(X1, Y1); cctx.lineTo(X1, Y1 + 0.8); cctx.lineTo(X0, Y0 + 0.8); cctx.closePath(); cctx.fill();
    };
    const E = effFloor(x + 1, y), Sf = effFloor(x, y + 1), N = effFloor(x, y - 1), Wf = effFloor(x - 1, y);
    if (f === F.SIDEWALK) {
      if (E === F.ASPHALT) faceSE(1, 3, '#b3afa3');
      if (Sf === F.ASPHALT) faceSE(2, 3, '#a39f94');
      // sombra do meio-fio no asfalto ao norte/oeste
      setWorld();
      cctx.fillStyle = 'rgba(20,20,22,0.25)';
      if (N === F.ASPHALT) cctx.fillRect(x, y - 0.06, 1, 0.06);
      if (Wf === F.ASPHALT) cctx.fillRect(x - 0.06, y, 0.06, 1);
      cctx.fillStyle = 'rgba(215,212,204,0.5)';
      if (N === F.ASPHALT) cctx.fillRect(x, y, 1, 0.06);
      if (Wf === F.ASPHALT) cctx.fillRect(x, y, 0.06, 1);
      if (E === F.ASPHALT) cctx.fillRect(x + 0.94, y, 0.06, 1);
      if (Sf === F.ASPHALT) cctx.fillRect(x, y + 0.94, 1, 0.06);
    } else if (f === F.PORCH) {
      const low = (n) => n >= 0 && n !== F.PORCH;
      if (low(E)) faceSE(1, 7, '#6a5a48', 'rgba(30,24,18,0.5)');
      if (low(Sf)) faceSE(2, 7, '#5e5040', 'rgba(30,24,18,0.5)');
    } else if (f === F.DOCK) {
      const low = (n) => n === F.WATER;
      if (low(E)) faceSE(1, 9, '#4e4234', 'rgba(20,16,12,0.6)');
      if (low(Sf)) faceSE(2, 9, '#463b2f', 'rgba(20,16,12,0.6)');
      if (low(E) || low(Sf)) { // estaca
        const X = isoX(x + 1, y + 1), Y = isoY(x + 1, y + 1);
        cctx.fillStyle = '#3a3026'; cctx.fillRect(X - 1.5, Y - 1, 3, 13);
      }
    } else if (f === F.POOL) {
      // parede interna visível (norte/oeste) e borda de pedra
      setWorld();
      const notPool = (n) => n !== F.POOL;
      cctx.fillStyle = '#b9d6da';
      if (notPool(N)) cctx.fillRect(x, y, 1, 0.3);
      if (notPool(Wf)) cctx.fillRect(x, y, 0.3, 1);
      cctx.fillStyle = 'rgba(40,90,100,0.35)';
      if (notPool(N)) cctx.fillRect(x, y + 0.3, 1, 0.05);
      if (notPool(Wf)) cctx.fillRect(x + 0.3, y, 0.05, 1);
      cctx.fillStyle = '#d5cfbf';
      const c = 0.13;
      if (notPool(N)) cctx.fillRect(x - 0.02, y - 0.02, 1.04, c);
      if (notPool(Wf)) cctx.fillRect(x - 0.02, y - 0.02, c, 1.04);
      if (notPool(E)) cctx.fillRect(x + 1 - c, y - 0.02, c + 0.02, 1.04);
      if (notPool(Sf)) cctx.fillRect(x - 0.02, y + 1 - c, 1.04, c + 0.02);
      cctx.fillStyle = 'rgba(120,112,98,0.6)';
      for (let s = 0; s < 1; s += 0.34) {
        if (notPool(N)) cctx.fillRect(x + s, y - 0.02, 0.012, c);
        if (notPool(Sf)) cctx.fillRect(x + s, y + 1 - c, 0.012, c);
      }
    } else if ((f === F.ASPHALT) && (E === F.WATER || Sf === F.WATER)) { // borda de ponte
      if (E === F.WATER) faceSE(1, 12, '#8a8780', 'rgba(60,58,54,0.4)');
      if (Sf === F.WATER) faceSE(2, 12, '#7c7972', 'rgba(60,58,54,0.4)');
    }
    if (f === F.CONCRETE && !map.building[i]) {
      // juntas de laje a cada 3 tiles
      setWorld();
      cctx.fillStyle = 'rgba(90,88,82,0.55)';
      if (x % 3 === 0) cctx.fillRect(x, y, 0.025, 1);
      if (y % 3 === 0) cctx.fillRect(x, y, 1, 0.025);
    }
  }

  // Detalhes em espaço de tela (lâminas de grama, flores, folhas) — agrupados por cor
  const bladeBuckets = [];
  function bucket(i) { return bladeBuckets[i] || (bladeBuckets[i] = []); }
  const BLADE_COLS = ['rgba(122,140,66,0.95)', 'rgba(86,106,46,0.95)', 'rgba(146,152,80,0.9)', 'rgba(100,122,54,0.95)', 'rgba(160,156,90,0.85)',
    'rgba(68,88,42,0.95)', 'rgba(56,72,36,0.95)', 'rgba(92,104,54,0.9)', 'rgba(110,100,60,0.85)'];
  function details(x, y) {
    const i = y * map.w + x;
    if (map.wall[i]) return;
    const f = map.floor[i];
    const cx = isoX(x + 0.5, y + 0.5), cy = isoY(x + 0.5, y + 0.5);
    const h0 = R.hash(x, y, 303);
    if (f === F.GRASS || f === F.DARK_GRASS) {
      const dark = f === F.DARK_GRASS;
      const obj = map.objAt[i] >= 0;
      const n = obj ? 4 : dark ? 7 + ((h0 * 6) | 0) : 12 + ((h0 * 10) | 0);
      for (let k = 0; k < n; k++) {
        const u = R.hash(x * 31 + k, y * 17, 11), v = R.hash(x * 13, y * 29 + k, 12);
        const X = cx + (u - v) * 30, Y = cy + (u + v - 1) * 15;
        const c = dark ? 5 + ((R.hash(k, x + y, 13) * 4) | 0) : (R.hash(k, x - y, 14) * 5) | 0;
        const hgt = (dark ? 2 : 2.5) + R.hash(x + k, y, 15) * 3.5;
        const lean = (R.hash(x, y + k, 16) - 0.5) * 2.5;
        bucket(c).push(X, Y, X + lean, Y - hgt);
      }
      if (!dark && h0 > 0.965) { // flores
        const col = ['#e8e4d8', '#e6cf5a', '#b8a0c8', '#d8e0e8'][((h0 - 0.965) * 114) | 0 & 3] || '#e8e4d8';
        cctx.fillStyle = col;
        for (let k = 0; k < 6; k++) {
          const u = R.hash(x + k, y, 21), v = R.hash(x, y + k, 22);
          cctx.fillRect(cx + (u - v) * 26 - 0.8, cy + (u + v - 1) * 13 - 3, 1.6, 1.6);
        }
      }
      if (dark && h0 < 0.06) { // samambaia
        cctx.strokeStyle = 'rgba(70,98,50,0.9)'; cctx.lineWidth = 1;
        const X = cx + (h0 * 200 - 6), Y = cy;
        for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.42; cctx.beginPath(); cctx.moveTo(X, Y); cctx.quadraticCurveTo(X + Math.cos(a) * 5, Y + Math.sin(a) * 7, X + Math.cos(a) * 9, Y + Math.sin(a) * 6 + 3); cctx.stroke(); }
      }
    } else if (f === F.DIRT || f === F.SAND) {
      if (h0 < 0.3) {
        const n = 2 + ((h0 * 10) | 0);
        for (let k = 0; k < n; k++) {
          const u = R.hash(x * 7 + k, y, 31), v = R.hash(x, y * 7 + k, 32);
          const X = cx + (u - v) * 28, Y = cy + (u + v - 1) * 14;
          bucket(f === F.SAND ? 4 : 8).push(X, Y, X + 0.5, Y - 2);
        }
      }
    }
    // tufos na borda de calçadas/asfalto/concreto vizinhos de grama
    if (f === F.SIDEWALK || f === F.ASPHALT || f === F.CONCRETE || f === F.GRAVEL) {
      for (let d = 0; d < 4; d++) {
        const nf = effFloor(x + R.DX[d], y + R.DY[d]);
        if (nf !== F.GRASS && nf !== F.DARK_GRASS) continue;
        const n = 3 + ((R.hash(x, y, 40 + d) * 4) | 0);
        for (let k = 0; k < n; k++) {
          const s = R.hash(x * 5 + k, y * 3 + d, 41);
          const e = 0.03 + R.hash(x + k, y + d, 42) * 0.08;
          let wx, wy;
          if (d === 0) { wx = x + s; wy = y + e; } else if (d === 2) { wx = x + s; wy = y + 1 - e; }
          else if (d === 3) { wx = x + e; wy = y + s; } else { wx = x + 1 - e; wy = y + s; }
          const X = isoX(wx, wy), Y = isoY(wx, wy);
          bucket((R.hash(k, d, 43) * 4) | 0).push(X, Y, X + (s - 0.5) * 2, Y - 2 - s * 2.5);
        }
      }
    }
  }
  function flushBlades() {
    cctx.setTransform(S, 0, 0, S, -cX0 * S, -cY0 * S);
    cctx.lineWidth = 1; cctx.lineCap = 'round';
    for (let c = 0; c < bladeBuckets.length; c++) {
      const b = bladeBuckets[c];
      if (!b || !b.length) continue;
      cctx.strokeStyle = BLADE_COLS[c];
      cctx.beginPath();
      for (let k = 0; k < b.length; k += 4) { cctx.moveTo(b[k], b[k + 1]); cctx.lineTo(b[k + 2], b[k + 3]); }
      cctx.stroke();
      b.length = 0;
    }
  }

  // Grande variação de cor (manchas secas/verdes) — grade por tile suavizada
  function tintOverlay(xa, ya, xb, yb) {
    const w = xb - xa + 1, h = yb - ya + 1;
    const c = R.canvas(w, h), g = c.getContext('2d');
    const img = g.createImageData(w, h), d = img.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = xa + i, y = ya + j, p = (j * w + i) * 4;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const k = y * map.w + x;
      const f = map.wall[k] ? map.floor[qsrc[k * 4 + 3]] : map.floor[k];
      const n1 = U.noise2(x * 0.085, y * 0.085, 17), n2 = U.noise2(x * 0.3, y * 0.3, 18);
      if (f === F.GRASS) {
        const n = n1 * 0.75 + n2 * 0.25;
        if (n < 0.5) { d[p] = 168; d[p + 1] = 158; d[p + 2] = 84; d[p + 3] = (0.5 - n) * 2 * 120; }
        else { d[p] = 62; d[p + 1] = 92; d[p + 2] = 38; d[p + 3] = (n - 0.5) * 2 * 110; }
      } else if (f === F.DARK_GRASS) {
        const n = n1 * 0.6 + n2 * 0.4;
        if (n < 0.5) { d[p] = 96; d[p + 1] = 82; d[p + 2] = 52; d[p + 3] = (0.5 - n) * 2 * 110; }
        else { d[p] = 34; d[p + 1] = 52; d[p + 2] = 30; d[p + 3] = (n - 0.5) * 2 * 120; }
      } else if (f === F.DIRT) {
        d[p] = n1 < 0.5 ? 150 : 90; d[p + 1] = n1 < 0.5 ? 128 : 72; d[p + 2] = n1 < 0.5 ? 92 : 50; d[p + 3] = Math.abs(n1 - 0.5) * 2 * 70;
      } else if (f === F.ASPHALT) {
        d[p] = n2 < 0.5 ? 30 : 110; d[p + 1] = n2 < 0.5 ? 31 : 110; d[p + 2] = n2 < 0.5 ? 34 : 108; d[p + 3] = Math.abs(n2 - 0.5) * 2 * 40;
      } else if (f === F.WATER) {
        const dep = waterDepth[k];
        d[p] = 12; d[p + 1] = 28; d[p + 2] = 38; d[p + 3] = Math.min(140, Math.max(0, dep - 1) * 28);
      }
    }
    g.putImageData(img, 0, 0);
    cctx.imageSmoothingEnabled = true;
    cctx.setTransform(32 * S, 16 * S, -32 * S, 16 * S, (isoX(xa, ya) - cX0) * S, (isoY(xa, ya) - cY0) * S);
    cctx.drawImage(c, 0, 0);
  }

  // Marcas de rua
  function drawMarks(xa, ya, xb, yb) {
    const ms = map.roadMarks;
    if (!ms || !ms.length) return;
    setWorld();
    cctx.lineCap = 'butt';
    for (let k = 0; k < ms.length; k++) {
      const mk = ms[k];
      const mx0 = Math.min(mk.x0, mk.x1) - 1, mx1 = Math.max(mk.x0, mk.x1) + 1, my0 = Math.min(mk.y0, mk.y1) - 1, my1 = Math.max(mk.y0, mk.y1) + 1;
      if (mx1 < xa || mx0 > xb + 1 || my1 < ya || my0 > yb + 1) continue;
      const dx = mk.x1 - mk.x0, dy = mk.y1 - mk.y0, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, px = -uy, py = ux;
      const seg = (s0, s1, off, w, col) => {
        const ax = mk.x0 + ux * s0 + px * off, ay = mk.y0 + uy * s0 + py * off;
        const bx = mk.x0 + ux * s1 + px * off, by = mk.y0 + uy * s1 + py * off;
        cctx.strokeStyle = col; cctx.lineWidth = w;
        cctx.beginPath(); cctx.moveTo(ax, ay); cctx.lineTo(bx, by); cctx.stroke();
      };
      const wear = (s) => 0.55 + 0.4 * U.noise2(mk.x0 * 3 + s * 1.7, mk.y0 * 3, 61);
      switch (mk.type) {
        case 'center_dashed':
          for (let s = 0.2; s < len - 0.2; s += 2) seg(s, Math.min(len, s + 1), 0, 0.09, 'rgba(214,176,58,' + wear(s).toFixed(2) + ')');
          break;
        case 'center_solid':
          for (let s = 0; s < len; s += 1) { const a = wear(s).toFixed(2); seg(s, Math.min(len, s + 1.02), -0.08, 0.07, 'rgba(214,176,58,' + a + ')'); seg(s, Math.min(len, s + 1.02), 0.08, 0.07, 'rgba(214,176,58,' + a + ')'); }
          break;
        case 'crosswalk':
          for (let s = 0.25; s < len - 0.1; s += 0.5) {
            const a = (wear(s) * 0.95).toFixed(2);
            const ax = mk.x0 + ux * s, ay = mk.y0 + uy * s;
            cctx.strokeStyle = 'rgba(226,224,214,' + a + ')'; cctx.lineWidth = 0.24;
            cctx.beginPath(); cctx.moveTo(ax - px * 0.42, ay - py * 0.42); cctx.lineTo(ax + px * 0.42, ay + py * 0.42); cctx.stroke();
          }
          break;
        case 'stop':
          for (let s = 0; s < len; s += 1) seg(s, Math.min(len, s + 1.02), 0, 0.2, 'rgba(226,224,214,' + wear(s).toFixed(2) + ')');
          break;
        case 'parking':
          seg(0, len, 0, 0.07, 'rgba(222,220,210,' + (wear(0) * 0.9).toFixed(2) + ')');
          break;
        case 'court':
          seg(0, len, 0, 0.06, 'rgba(236,234,226,0.8)');
          break;
        case 'rail': {
          for (let s = 0.25; s < len; s += 0.5) {
            const ax = mk.x0 + ux * s, ay = mk.y0 + uy * s;
            cctx.strokeStyle = '#4a3a2c'; cctx.lineWidth = 0.18;
            cctx.beginPath(); cctx.moveTo(ax - px * 0.55, ay - py * 0.55); cctx.lineTo(ax + px * 0.55, ay + py * 0.55); cctx.stroke();
          }
          seg(0, len, -0.34, 0.07, '#6a6560'); seg(0, len, 0.34, 0.07, '#6a6560');
          seg(0, len, -0.36, 0.025, 'rgba(210,205,196,0.7)'); seg(0, len, 0.32, 0.025, 'rgba(210,205,196,0.7)');
          break;
        }
        default:
          seg(0, len, 0, 0.06, 'rgba(226,224,214,0.7)');
      }
    }
  }

  // Tapetes (objetos planos) — desenhados no chão
  function drawRug(o) {
    const pal = ['#7a3a32', '#35506a', '#6a5a3a', '#4a5a3e', '#6a3a5a', '#8a7a5a', '#3e4a5a', '#7a5a40'];
    const col = R.hex(pal[(o.variant || 0) % pal.length]);
    setWorld();
    const x = o.x + 0.12, y = o.y + 0.12, w = o.w - 0.24, h = o.h - 0.24;
    cctx.fillStyle = 'rgba(0,0,0,0.18)'; cctx.fillRect(x + 0.03, y + 0.03, w, h);
    cctx.fillStyle = R.css(col); cctx.fillRect(x, y, w, h);
    cctx.strokeStyle = R.css(col, 1.35); cctx.lineWidth = 0.06; cctx.strokeRect(x + 0.1, y + 0.1, w - 0.2, h - 0.2);
    cctx.strokeStyle = R.css(col, 0.7); cctx.lineWidth = 0.03; cctx.strokeRect(x + 0.2, y + 0.2, w - 0.4, h - 0.4);
    cctx.fillStyle = R.css(col, 1.3, 0.7);
    const cx = x + w / 2, cy = y + h / 2;
    cctx.beginPath(); cctx.moveTo(cx, cy - h * 0.25); cctx.lineTo(cx + w * 0.22, cy); cctx.lineTo(cx, cy + h * 0.25); cctx.lineTo(cx - w * 0.22, cy); cctx.closePath(); cctx.fill();
    cctx.fillStyle = 'rgba(230,220,200,0.6)';
    for (let s = 0; s < w; s += 0.08) { cctx.fillRect(x + s, y - 0.05, 0.02, 0.05); cctx.fillRect(x + s, y + h, 0.02, 0.05); }
  }

  // Oclusão ambiente junto às paredes + sombras de contato dos objetos
  function wallAO(x, y) {
    const i = y * map.w + x, wv = map.wall[i];
    if (!wv || wv === W.HEDGE || wv === W.FENCE_METAL) return;
    const mk = map.wallMask[i];
    const fence = wv === W.FENCE_WOOD || wv === W.FENCE_GATE;
    const a = fence ? 0.14 : 0.3, wd = fence ? 0.18 : 0.34;
    setWorld();
    const band = (x0, y0, x1, y1, horiz) => {
      // faixa dos dois lados da linha
      for (const s of [-1, 1]) {
        const g = horiz ? cctx.createLinearGradient(0, y0, 0, y0 + s * wd) : cctx.createLinearGradient(x0, 0, x0 + s * wd, 0);
        g.addColorStop(0, 'rgba(10,10,12,' + a + ')'); g.addColorStop(1, 'rgba(10,10,12,0)');
        cctx.fillStyle = g;
        if (horiz) cctx.fillRect(x0, Math.min(y0, y0 + s * wd), x1 - x0, wd);
        else cctx.fillRect(Math.min(x0, x0 + s * wd), y0, wd, y1 - y0);
      }
    };
    const cx = x + 0.5, cy = y + 0.5;
    if (mk & 2) band(cx, cy, x + 1, cy, true);
    if (mk & 8) band(x, cy, cx, cy, true);
    if (mk & 4) band(cx, cy, cx, y + 1, false);
    if (mk & 1) band(cx, y, cx, cy, false);
    if (!mk) band(cx - 0.1, cy, cx + 0.1, cy, true);
  }
  function contactShadow(o) {
    const t = o.type;
    if (t === 'rug') return;
    setWorld();
    if (t === 'tree' || t === 'pine') {
      const cx = o.x + 0.5, cy = o.y + 0.5, r = t === 'tree' ? 1.25 : 0.95;
      const g = cctx.createRadialGradient(cx, cy, 0.05, cx, cy, r);
      g.addColorStop(0, 'rgba(12,16,8,0.42)'); g.addColorStop(0.5, 'rgba(12,16,8,0.2)'); g.addColorStop(1, 'rgba(12,16,8,0)');
      cctx.fillStyle = g; cctx.beginPath(); cctx.arc(cx, cy, r, 0, 6.2832); cctx.fill();
      return;
    }
    if (t === 'bush' || t === 'rock' || t === 'plant') {
      const cx = o.x + 0.5, cy = o.y + 0.5;
      const g = cctx.createRadialGradient(cx, cy, 0.05, cx, cy, 0.6);
      g.addColorStop(0, 'rgba(12,14,8,0.35)'); g.addColorStop(1, 'rgba(12,14,8,0)');
      cctx.fillStyle = g; cctx.beginPath(); cctx.arc(cx, cy, 0.6, 0, 6.2832); cctx.fill();
      return;
    }
    const car = t === 'car' || t === 'pickup' || t === 'police_car' || t === 'ambulance';
    const inset = car ? 0.12 : 0.06;
    const x0 = o.x + inset, y0 = o.y + inset, x1 = o.x + o.w - inset, y1 = o.y + o.h - inset;
    const al = car ? 0.34 : 0.2;
    for (let k = 0; k < 3; k++) {
      const e = 0.06 * (2 - k);
      cctx.fillStyle = 'rgba(10,10,12,' + (al / 3).toFixed(3) + ')';
      cctx.fillRect(x0 - e, y0 - e, x1 - x0 + 2 * e, y1 - y0 + 2 * e);
    }
  }

  function buildChunk(cx, cy) {
    const c = R.canvas(CW * S, CH * S);
    cctx = c.getContext('2d');
    cctx.imageSmoothingEnabled = true;
    cX0 = cx * CW; cY0 = cy * CH;
    const X0 = cX0, Y0 = cY0, X1 = X0 + CW, Y1 = Y0 + CH;
    // intervalo (u = x-y, v = x+y) de tiles que tocam o bloco (com margem p/ faces e tufos)
    const u0 = Math.floor((X0 - 40) / 32), u1 = Math.ceil((X1 + 40) / 32);
    const v0 = Math.floor((Y0 - 48) / 16), v1 = Math.ceil((Y1 + 24) / 16);
    const tiles = [];
    let xa = 1e9, ya = 1e9, xb = -1e9, yb = -1e9;
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
      if ((u + v) & 1) continue;
      const x = (u + v) >> 1, y = (v - u) >> 1;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      tiles.push(x, y);
      if (x < xa) xa = x; if (y < ya) ya = y; if (x > xb) xb = x; if (y > yb) yb = y;
    }
    // 1. base
    for (let k = 0; k < tiles.length; k += 2) drawFloorTile(tiles[k], tiles[k + 1]);
    // 2. transições
    for (let k = 0; k < tiles.length; k += 2) transitions(tiles[k], tiles[k + 1]);
    // 2b. suavização de bordas naturais e margens de água (grade dual)
    for (let k = 0; k < tiles.length; k += 2) { const x = tiles[k], y = tiles[k + 1]; if (x > 0 && y > 0) smoothCell(x, y); }
    // 3. variação ampla
    if (xa <= xb) tintOverlay(xa, ya, xb, yb);
    // 4. bordas elevadas / piscina / ponte
    for (let k = 0; k < tiles.length; k += 2) edgeFaces(tiles[k], tiles[k + 1]);
    // 5. marcas de rua
    if (xa <= xb) drawMarks(xa, ya, xb, yb);
    // 6. oclusão ambiente e sombras de contato; tapetes
    if (++stampN > 4e9) { stampN = 1; stamp.fill(0); }
    for (let k = 0; k < tiles.length; k += 2) {
      const x = tiles[k], y = tiles[k + 1], i = y * map.w + x;
      wallAO(x, y);
      const oi = map.objAt[i];
      if (oi >= 0 && stamp[oi] !== stampN) {
        stamp[oi] = stampN;
        const o = map.objects[oi];
        if (o.type === 'rug') drawRug(o); else contactShadow(o);
      }
    }
    // 7. tufos/flores
    cctx.setTransform(S, 0, 0, S, -cX0 * S, -cY0 * S);
    for (let k = 0; k < tiles.length; k += 2) details(tiles[k], tiles[k + 1]);
    flushBlades();
    cctx = null;
    GR.stats.built++;
    return c;
  }

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------
  GR.setScale = function (s) {
    if (s === S) return;
    S = s; T = 64 * s;
    texCache.clear(); chunks.clear();
  };
  GR.invalidate = function (x, y) {
    const X = isoX(x + 0.5, y + 0.5), Y = isoY(x + 0.5, y + 0.5);
    for (const [k, ch] of chunks) {
      if (X + 48 >= ch.cx * CW && X - 48 <= (ch.cx + 1) * CW && Y + 48 >= ch.cy * CH && Y - 64 <= (ch.cy + 1) * CH) chunks.delete(k);
    }
  };
  GR.invalidateAll = function () { chunks.clear(); };
  // Desenha os blocos visíveis. ctx já com a transformação da câmera (px isométricos).
  // view = { X0, Y0, X1, Y1 } em px isométricos.
  GR.draw = function (ctx, view, allowPrebuild) {
    frameNo++;
    const m = map;
    const mapX0 = -m.h * 32, mapX1 = m.w * 32, mapY1 = (m.w + m.h) * 16;
    const cx0 = Math.floor(Math.max(view.X0, mapX0) / CW), cx1 = Math.floor(Math.min(view.X1, mapX1) / CW);
    const cy0 = Math.floor(Math.max(view.Y0, 0) / CH), cy1 = Math.floor(Math.min(view.Y1, mapY1) / CH);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = cy * 8192 + cx + 4096;
      let ch = chunks.get(key);
      if (!ch) { ch = { c: buildChunk(cx, cy), cx, cy, used: frameNo }; chunks.set(key, ch); }
      ch.used = frameNo;
      ctx.drawImage(ch.c, cx * CW, cy * CH, CW, CH);
    }
    // pré-constrói um vizinho por quadro
    if (allowPrebuild) {
      const ring = [[cx0 - 1, cy0], [cx1 + 1, cy0], [cx0, cy0 - 1], [cx0, cy1 + 1], [cx1 + 1, cy1], [cx0 - 1, cy1], [cx1, cy0 - 1], [cx1, cy1 + 1]];
      for (const [cx, cy] of ring) {
        if (cx * CW > mapX1 || (cx + 1) * CW < mapX0 || cy < 0 || cy * CH > mapY1) continue;
        const key = cy * 8192 + cx + 4096;
        if (!chunks.has(key)) { chunks.set(key, { c: buildChunk(cx, cy), cx, cy, used: frameNo }); break; }
      }
    }
    // limite de memória
    const maxN = S > 1 ? 22 : 48;
    if (chunks.size > maxN) {
      const arr = [...chunks.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let k = 0; k < arr.length - maxN; k++) chunks.delete(arr[k][0]);
    }
    GR.stats.chunks = chunks.size;
  };
})();
