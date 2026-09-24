/* =====================================================================
 * VALE QUIETO — render-ground.js  (Etapa 2: Render)
 * Chão: texturas procedurais por tipo/variante (geradas "de cima" e
 * pré-projetadas no losango), cache em blocos de tela por escala (0.5/1/2,
 * nunca descartados ao trocar de zoom), construção FATIADA por orçamento de
 * tempo (um bloco pode levar vários quadros) com substituto enquanto não fica
 * pronto (bloco de outra escala esticado ou o "mapa-miniatura" de cores
 * médias), transições irregulares entre pisos naturais, meio-fio, margens de
 * água, borda de piscina, varanda/píer, tabuleiro de ponte, marcas de rua,
 * trilhas gastas na grama, folhas sob as árvores, tapetes, oclusão ambiente
 * junto às paredes e sombras de contato.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, F = G.FLOOR, W = G.WALL, U = G.util;
  const GR = (R.ground = {});
  // tamanho do bloco (px isométricos) por escala: em zoom baixo, blocos maiores
  const TIER = { 0.5: { cw: 1024, ch: 512 }, 1: { cw: 512, ch: 256 }, 2: { cw: 512, ch: 256 } };
  let S = 1;                         // escala atual (a desenhar)
  let bS = 1, bT = 64;               // escala/texels do bloco em construção
  let map = null;
  const texCache = new Map();        // textura "de cima" por tipo|param|v|T
  const isoCache = new Map();        // textura projetada no losango
  const caches = { 0.5: new R.Cache(40), 1: new R.Cache(48), 2: new R.Cache(24) };
  let frameNo = 0;
  GR.stats = { built: 0, chunks: 0, missing: 0 };

  // ------------------------------------------------------------------
  // Dados derivados do mapa
  // ------------------------------------------------------------------
  let qsrc = null;       // Int32Array(w*h*4): tile-fonte de cada quarto (NW,NE,SW,SE) — paredes
  let waterDepth = null; // Uint8Array: distância à margem (tiles de água)
  let bridgeAt = null;   // Uint8Array: 1 = tabuleiro de ponte
  let trails = [];       // polilinhas [x0,y0,x1,y1,...] (mundo) de trilhas gastas
  let stamp = null, stampN = 0;
  let mini = null, miniU0 = 0;       // mapa-miniatura (u,v) para substituto

  GR.reset = function (m) {
    map = m;
    texCache.clear(); isoCache.clear();
    for (const k in caches) caches[k].clear();
    job = null;
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
    bridgeAt = new Uint8Array(n);
    for (const b of m.bridges || []) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h && m.floor[y * m.w + x] !== F.WATER) bridgeAt[y * m.w + x] = 1;
    stamp = new Uint32Array(m.objects.length + 16); stampN = 0;
    lotKind = new Uint8Array(n);
    for (const l of m.lots || []) {
      const k = l.kind === 'house' ? 1 : l.kind === 'farm' ? 2 : 3;
      for (let y = Math.max(0, l.y); y < Math.min(m.h, l.y + l.h); y++) for (let x = Math.max(0, l.x); x < Math.min(m.w, l.x + l.w); x++) lotKind[y * m.w + x] = k;
    }
    buildTrails();
    buildEntries();
    buildMini();
  };
  // Entradas (portas externas): lado de fora, luminária de varanda e capacho (por hash, estáveis)
  let entries = new Map();
  let lotKind = null;    // Uint8Array: 1 lote residencial, 2 fazenda, 3 outro
  function buildEntries() {
    entries = new Map();
    const m = map, w = m.w;
    for (const b of m.buildings) {
      if (!b.doors) continue;
      for (const d of b.doors) {
        if (d.x < 0 || d.y < 0 || d.x >= w || d.y >= m.h) continue;
        const i = d.y * w + d.x;
        if (m.wall[i] !== W.DOOR) continue;
        let ox = 0, oy = 0;
        for (let k = 0; k < 4; k++) {
          const nx = d.x + R.DX[k], ny = d.y + R.DY[k];
          if (nx < 0 || ny < 0 || nx >= w || ny >= m.h) continue;
          const j = ny * w + nx;
          if (!m.wall[j] && !m.building[j]) { ox = R.DX[k]; oy = R.DY[k]; break; }
        }
        if (!ox && !oy) continue;
        const res = b.type === 'house' || b.type === 'trailer' || b.type === 'cabin' || b.type === 'motel';
        const h = R.hash(d.x, d.y, 97);
        entries.set(i, { i, x: d.x, y: d.y, ox, oy, b, lamp: res ? h < 0.8 : h < 0.45, mat: res && R.hash(d.x, d.y, 98) < 0.7 });
      }
    }
  }
  GR.entry = (i) => entries.get(i);
  GR.entries = () => entries;
  GR.isBridge = (i) => (bridgeAt ? bridgeAt[i] === 1 : false);

  // Quartos de um tile de parede herdam o piso do vizinho não-parede daquele lado
  GR.updateQuarters = function (i) {
    const m = map, w = m.w;
    const x = i % w, y = (i / w) | 0;
    for (let q = 0; q < 4; q++) {
      let src = i;
      if (m.wall[i]) {
        const sx = q & 1 ? 1 : -1, sy = q & 2 ? 1 : -1;
        const c0x = x + sx, c0y = y, c1x = x, c1y = y + sy, c2x = x + sx, c2y = y + sy;
        if (c0x >= 0 && c0y >= 0 && c0x < w && c0y < m.h && !m.wall[c0y * w + c0x]) src = c0y * w + c0x;
        else if (c1x >= 0 && c1y >= 0 && c1x < w && c1y < m.h && !m.wall[c1y * w + c1x]) src = c1y * w + c1x;
        else if (c2x >= 0 && c2y >= 0 && c2x < w && c2y < m.h && !m.wall[c2y * w + c2x]) src = c2y * w + c2x;
      }
      qsrc[i * 4 + q] = src;
    }
  };
  GR.qsrc = (i, q) => (qsrc ? qsrc[i * 4 + q] : i);

  // Trilhas gastas: da porta (lado de fora) até a calçada/rua mais próxima (BFS pela grama)
  function buildTrails() {
    trails = [];
    const m = map, w = m.w;
    const walk = (f) => f === F.GRASS || f === F.DARK_GRASS || f === F.DIRT;
    const goal = (f) => f === F.SIDEWALK || f === F.ASPHALT || f === F.GRAVEL || f === F.CONCRETE;
    const prev = new Int32Array(w * m.h).fill(-2);
    const touched = [];
    for (const b of m.buildings) {
      if (!b.doors || !(b.type === 'house' || b.type === 'trailer' || b.type === 'cabin' || b.type === 'shed' || b.type === 'barn')) continue;
      for (const d of b.doors) {
        const di = d.y * w + d.x;
        if (d.x < 0 || d.y < 0 || d.x >= w || d.y >= m.h) continue;
        // lado de fora da porta
        let start = -1;
        for (let k = 0; k < 4; k++) { const s = qsrc[di * 4 + k]; if (s !== di && !m.building[s]) { start = s; break; } }
        if (start < 0) continue;
        // BFS até um piso "de rua", passando por grama/terra/varanda
        const Q = [start]; prev[start] = -1; touched.push(start);
        let end = -1;
        for (let h = 0; h < Q.length && Q.length < 900; h++) {
          const i = Q[h], x = i % w, y = (i / w) | 0;
          const f = m.floor[i];
          if (goal(f)) { end = i; break; }
          if (Math.abs(x - d.x) + Math.abs(y - d.y) > 16) continue;
          for (let k = 0; k < 4; k++) {
            const nx = x + R.DX[k], ny = y + R.DY[k];
            if (nx < 0 || ny < 0 || nx >= w || ny >= m.h) continue;
            const j = ny * w + nx;
            if (prev[j] !== -2 || m.wall[j] || m.building[j] || m.objAt[j] >= 0) continue;
            const nf = m.floor[j];
            if (!(walk(nf) || goal(nf) || nf === F.PORCH)) continue;
            prev[j] = i; touched.push(j); Q.push(j);
          }
        }
        if (end >= 0) {
          const pts = [];
          for (let i = end; i >= 0; i = prev[i]) {
            const f = m.floor[i];
            if (walk(f)) pts.push((i % w) + 0.5, ((i / w) | 0) + 0.5);
          }
          if (pts.length >= 4) trails.push(pts);
        }
        for (const t of touched) prev[t] = -2;
        touched.length = 0;
      }
    }
  }

  // Mapa-miniatura no espaço (u,v): 1 texel por unidade → substituto barato de blocos
  const MINI_COL = [];
  MINI_COL[F.GRASS] = [98, 116, 58]; MINI_COL[F.DARK_GRASS] = [70, 84, 48]; MINI_COL[F.DIRT] = [118, 96, 68]; MINI_COL[F.SAND] = [196, 176, 132];
  MINI_COL[F.GRAVEL] = [128, 124, 114]; MINI_COL[F.ASPHALT] = [68, 70, 73]; MINI_COL[F.ROAD_LINE] = [68, 70, 73]; MINI_COL[F.SIDEWALK] = [160, 156, 146]; MINI_COL[F.CONCRETE] = [150, 148, 140];
  MINI_COL[F.WOOD] = [140, 104, 70]; MINI_COL[F.TILE] = [204, 204, 196]; MINI_COL[F.CARPET] = [128, 118, 104]; MINI_COL[F.LINOLEUM] = [176, 168, 150];
  MINI_COL[F.WATER] = [44, 72, 80]; MINI_COL[F.POOL] = [70, 155, 170]; MINI_COL[F.PORCH] = [140, 128, 112]; MINI_COL[F.DOCK] = [125, 110, 90];
  function buildMini() {
    const m = map;
    const NU = m.w + m.h, NV = m.w + m.h;
    miniU0 = -(m.h - 1) - 1;
    mini = R.canvas(NU + 2, NV + 2);
    const g = mini.getContext('2d');
    const img = g.createImageData(NU + 2, NV + 2), d = img.data;
    for (let iv = 0; iv < NV + 2; iv++) for (let iu = 0; iu < NU + 2; iu++) {
      const u = iu + miniU0, v = iv;
      const x = Math.floor((u + v) / 2 + 0.25), y = Math.floor((v - u) / 2 + 0.25);
      const p = (iv * (NU + 2) + iu) * 4;
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) { d[p] = 7; d[p + 1] = 9; d[p + 2] = 10; d[p + 3] = 255; continue; }
      const i = y * m.w + x;
      const c = m.wall[i] ? [74, 70, 64] : MINI_COL[m.floor[i]] || [20, 22, 22];
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

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
  let T = 64; // texels da textura em geração (= bT)
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
  // manchas suaves (mottling) que se repetem sem costura
  function blobs(g, rng, n, cols, rmin, rmax, alpha) {
    for (let k = 0; k < n; k++) {
      const x = rng() * T, y = rng() * T, r = (rmin + rng() * (rmax - rmin)) * T;
      g.fillStyle = cols[(rng() * cols.length) | 0];
      g.globalAlpha = alpha * (0.5 + rng() * 0.5);
      for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) {
        if (x + ox + r < 0 || x + ox - r > T || y + oy + r < 0 || y + oy - r > T) continue;
        g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.6 + rng() * 0.3), rng() * 3, 0, 6.283); g.fill();
      }
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
    const c = R.canvas(T, T), g = c.getContext('2d', { willReadFrequently: true });
    const rng = U.rng((type * 7919 + v * 104729 + hstr(param) * 13 + 77) >>> 0);
    const k = T / 64;
    const pp = param.split(':');
    const colParam = (list) => (pp[0][0] === 'c' ? R.hex(pp[0].slice(1)) : R.hex(list[(+pp[0] || 0) % list.length]));
    switch (type) {
      case F.GRASS: {
        // relva: base com ruído fino + manchas grandes suaves (sem riscos)
        pixNoise(g, [98, 116, 56], 7, rng, 5);
        blobs(g, rng, 7, ['#6e8440', '#58702f', '#7d8a46', '#5f7a36'], 0.12, 0.3, 0.35);
        dots(g, rng, 120, ['#7a8c46', '#5a6b30', '#6e843f', '#627a38', '#86924c'], 1, 2.2, 0.55);
        if (v === 7) blobs(g, rng, 4, ['#8f8a4e', '#9a9052'], 0.1, 0.2, 0.4);   // grama seca
        if (v === 6) dots(g, rng, 14, ['#e8e2d0', '#e0c858'], 1, 1.6, 0.9);     // florzinhas
        break;
      }
      case F.DARK_GRASS: {
        pixNoise(g, [70, 85, 47], 8, rng, 7);
        blobs(g, rng, 6, ['#4b5a30', '#5a6a36', '#3e4a28'], 0.12, 0.3, 0.4);
        dots(g, rng, 150, ['#5a6a36', '#3b4827', '#65583a', '#4b5a30', '#72643e', '#566a34'], 1, 2.6, 0.7);
        for (let n = 0; n < 14; n++) {
          g.fillStyle = ['#7a5a32', '#8a6a3a', '#6a4a2a', '#8e7040', '#5e4a2c'][(rng() * 5) | 0];
          g.globalAlpha = 0.65;
          g.beginPath(); g.ellipse(rng() * T, rng() * T, (1.5 + rng() * 1.8) * k, (0.8 + rng()) * k, rng() * 3.14, 0, 6.28); g.fill();
        }
        g.globalAlpha = 0.55; g.strokeStyle = '#4a3a28'; g.lineWidth = 0.7 * k;
        for (let n = 0; n < 2; n++) { const x = rng() * T, y = rng() * T, a = rng() * 6.28; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 7 * k, y + Math.sin(a) * 7 * k); g.stroke(); }
        g.globalAlpha = 1;
        break;
      }
      case F.DIRT: {
        pixNoise(g, [122, 99, 70], 11, rng, 6);
        blobs(g, rng, 5, ['#8a7052', '#6e583e'], 0.1, 0.25, 0.35);
        dots(g, rng, 150, ['#8e7656', '#6a553b', '#9a845f', '#735c40', '#826a4a'], 1, 2.5, 0.7);
        for (let n = 0; n < 8; n++) {
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
    const key = type + '|' + param + '|' + v + '|' + T;
    let c = texCache.get(key);
    if (!c) { c = makeTex(type, param, v); texCache.set(key, c); }
    return c;
  }
  // textura pré-projetada no losango (drawImage alinhado aos eixos: bem mais barato)
  const ISO_PAD = 2;
  function isoTex(type, param, v) {
    const key = type + '|' + param + '|' + v + '|' + T;
    let c = isoCache.get(key);
    if (c) return c;
    const t = tex(type, param, v);
    const sc = T / 64; // px por px isométrico
    c = R.canvas((64 + ISO_PAD * 2) * sc, (32 + ISO_PAD * 2) * sc);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    // texel (tu,tv) → px do losango (com leve sobreposição ov, que evita frestas):
    // X = (tu−tv)·32·ov/T + 32 + PAD ; Y = (tu+tv)·16·ov/T + 16 − 16·ov + PAD
    const ov = 1.03;
    g.setTransform(32 * sc / T * ov, 16 * sc / T * ov, -32 * sc / T * ov, 16 * sc / T * ov, (32 + ISO_PAD) * sc, (16 - 16 * ov + ISO_PAD) * sc);
    g.drawImage(t, 0, 0);
    isoCache.set(key, c);
    return c;
  }

  // ------------------------------------------------------------------
  // Construção de um bloco
  // ------------------------------------------------------------------
  const PRIO = new Int8Array(32).fill(-1);
  PRIO[F.WATER] = 0; PRIO[F.SAND] = 1; PRIO[F.ASPHALT] = 2; PRIO[F.ROAD_LINE] = 2; PRIO[F.DIRT] = 3;
  PRIO[F.GRAVEL] = 4; PRIO[F.GRASS] = 5; PRIO[F.DARK_GRASS] = 6;

  let cctx = null, cX0 = 0, cY0 = 0;   // contexto do bloco em construção e sua origem
  function setWorld() { cctx.setTransform(32 * bS, 16 * bS, -32 * bS, 16 * bS, -cX0 * bS, -cY0 * bS); }
  function setIso() { cctx.setTransform(bS, 0, 0, bS, -cX0 * bS, -cY0 * bS); }
  function isoX(x, y) { return (x - y) * 32; }
  function isoY(x, y) { return (x + y) * 16; }

  // piso "efetivo" (paredes → -1)
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
  // desenha o losango texturizado do tile (x,y) — alinhado aos eixos
  function drawIso(texc, x, y) {
    setIso();
    cctx.drawImage(texc, isoX(x, y) - 32 - ISO_PAD, isoY(x, y) - ISO_PAD, 64 + ISO_PAD * 2, 32 + ISO_PAD * 2);
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
        cctx.setTransform(32 * k * bS * 1.04, 16 * k * bS * 1.04, -32 * k * bS * 1.04, 16 * k * bS * 1.04, (isoX(wx, wy) - cX0) * bS, (isoY(wx, wy) - cY0) * bS);
        cctx.drawImage(t, u0, v0, h, h, 0, 0, h, h);
      }
      return;
    }
    const f = map.floor[i];
    drawIso(isoTex(f, floorParam(f, i), variant(x, y)), x, y);
  }

  // Polígono irregular (mundo) ao longo da aresta dir do tile (x,y); retorna pontos internos [x,y,...]
  const EDGE_K = 8;
  const _pts = new Float64Array((EDGE_K + 3) * 2 + 64);
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
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.beginPath();
    for (let k = 0; k < n; k += 2) {
      const X = (isoX(_pts[k], _pts[k + 1]) - cX0) * bS, Y = (isoY(_pts[k], _pts[k + 1]) - cY0) * bS;
      if (k) cctx.lineTo(X, Y); else cctx.moveTo(X, Y);
    }
    cctx.closePath();
  }
  // tufos na borda de uma transição (pontos internos da faixa)
  function fringe(n, grassType, dens) {
    if (bS < 1) return;
    for (let k = 2; k < n - 2; k += 2) {
      if (dens < 1 && ((k * 7919) % 10) / 10 > dens) continue;
      tuft(isoX(_pts[k], _pts[k + 1]), isoY(_pts[k], _pts[k + 1]), grassType === F.DARK_GRASS ? 1 : 0, R.hash(k, (_pts[k] * 97) | 0, 7), 0.8);
    }
  }

  function transitions(x, y) {
    const t = effFloor(x, y);
    if (t < 0 || PRIO[t] < 0 || t === F.WATER) return; // margens de água: marching squares
    // vizinhos de prioridade maior "invadem" este tile com borda irregular
    const nb0 = effFloor(x, y - 1), nb1 = effFloor(x + 1, y), nb2 = effFloor(x, y + 1), nb3 = effFloor(x - 1, y);
    const nb = _nb; nb[0] = nb0; nb[1] = nb1; nb[2] = nb2; nb[3] = nb3;
    const diag = _dg; diag[0] = effFloor(x + 1, y - 1); diag[1] = effFloor(x + 1, y + 1); diag[2] = effFloor(x - 1, y + 1); diag[3] = effFloor(x - 1, y - 1); // NE, SE, SW, NW
    for (let p = PRIO[t] + 1; p <= 6; p++) {
      for (let dir = 0; dir < 4; dir++) {
        const src = nb[dir];
        if (src < 0 || PRIO[src] !== p) continue;
        const depth = t === F.ASPHALT ? 0.2 : src === F.DARK_GRASS && t === F.GRASS ? 0.34 : 0.3;
        // pontas: para N/S a aresta vai de W→E; para W/E vai de N→S
        const sideA = dir === 0 || dir === 2 ? 3 : 0, sideB = dir === 0 || dir === 2 ? 1 : 2;
        const dA = dir === 0 ? 3 : dir === 1 ? 0 : dir === 2 ? 2 : 3; // diagonal perto da ponta A
        const dB = dir === 0 ? 0 : dir === 1 ? 1 : dir === 2 ? 1 : 2;
        const tA = !(nb[sideA] === src || diag[dA] === src);
        const tB = !(nb[sideB] === src || diag[dB] === src);
        const np = edgeBand(x, y, dir, depth, tA, tB, src * 3);
        const srcX = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0), srcY = y + (dir === 0 ? -1 : dir === 2 ? 1 : 0);
        cctx.save();
        pathWorld(np);
        cctx.clip();
        drawIso(isoTex(src, floorParam(src, srcY * map.w + srcX), variant(x + 3, y + 5)), x, y);
        cctx.restore();
        if (src === F.GRASS || src === F.DARK_GRASS) fringe(np, src, 1);
      }
      // escadinhas: dois vizinhos ortogonais do mesmo piso → preenche a metade do canto (diagonal irregular)
      for (let c = 0; c < 4; c++) {
        const dA = c, dB = (c + 1) & 3; // (N,E) (E,S) (S,W) (W,N)
        const n = nb[dA];
        if (n < 0 || PRIO[n] !== p || nb[dB] !== n) continue;
        const cx = c === 0 || c === 1 ? x + 1 : x, cy = c === 1 || c === 2 ? y + 1 : y;
        const ci = (c + 3) & 3, cj = (c + 1) & 3;
        const ax = ci === 0 || ci === 1 ? x + 1 : x, ay = ci === 1 || ci === 2 ? y + 1 : y;
        const bx = cj === 0 || cj === 1 ? x + 1 : x, by = cj === 1 || cj === 2 ? y + 1 : y;
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
        cctx.save(); pathWorld(np); cctx.clip();
        const srcX = x + (dA === 1 || dB === 1 ? 1 : dA === 3 || dB === 3 ? -1 : 0), srcY = y + (dA === 0 || dB === 0 ? -1 : 1);
        drawIso(isoTex(n, floorParam(n, Math.max(0, Math.min(map.h - 1, srcY)) * map.w + Math.max(0, Math.min(map.w - 1, srcX))), variant(x + 5, y + 3)), x, y);
        cctx.restore();
        if (n === F.GRASS || n === F.DARK_GRASS) fringe(np - 2, n, 0.8);
      }
      // cantos diagonais isolados
      for (let dg = 0; dg < 4; dg++) {
        const n = diag[dg];
        if (n < 0 || PRIO[n] !== p) continue;
        const o1 = dg, o2 = (dg + 1) & 3; // N,E / E,S / S,W / W,N
        if (nb[o1] === n || nb[o2] === n) continue;
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
        drawIso(isoTex(n, '0', variant(x + 1, y + 7)), x, y);
        cctx.restore();
      }
    }
  }
  const _nb = [0, 0, 0, 0], _dg = [0, 0, 0, 0];

  // Suavização por marching squares na grade dual: cada canto (x,y) é o centro de uma célula
  // formada por quartos de 4 tiles. Se a célula tem exatamente 2 pisos "naturais" (ou água × terra),
  // o contorno passa pelos pontos médios (com ruído) e cada quarto é repintado do lado certo.
  const SMOOTH = new Uint8Array(32);
  SMOOTH[F.GRASS] = 1; SMOOTH[F.DARK_GRASS] = 1; SMOOTH[F.DIRT] = 1; SMOOTH[F.SAND] = 1; SMOOTH[F.GRAVEL] = 1; SMOOTH[F.ASPHALT] = 2; SMOOTH[F.WATER] = 3;
  function cellType(x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return -1;
    const i = y * map.w + x;
    if (map.wall[i] || bridgeAt[i]) return -1;
    const f = map.floor[i];
    return SMOOTH[f] ? f : -1;
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
    const cfw = segs.length === 2 ? contour(segs[0], segs[1]) : null;
    const withContour = (poly) => {
      if (!cfw) return poly;
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        out.push(poly[k]);
        const nxt = poly[(k + 1) % poly.length];
        if (poly[k] === segs[0] && nxt === segs[1]) for (const q of cfw) out.push(q);
        else if (poly[k] === segs[1] && nxt === segs[0]) for (let j = cfw.length - 1; j >= 0; j--) out.push(cfw[j]);
      }
      return out;
    };
    const hp = withContour(highPoly), lp = withContour(lowPoly);
    const pathPoly = (poly) => {
      cctx.beginPath();
      for (let k = 0; k < poly.length; k++) { const X = (isoX(poly[k][0], poly[k][1]) - cX0) * bS, Y = (isoY(poly[k][0], poly[k][1]) - cY0) * bS; if (k) cctx.lineTo(X, Y); else cctx.moveTo(X, Y); }
      cctx.closePath();
    };
    const e = 0.035;
    const quarterPath = (k) => {
      const qx0 = Math.min(cx[k], x) - e, qx1 = Math.max(cx[k], x) + e, qy0 = Math.min(cy[k], y) - e, qy1 = Math.max(cy[k], y) + e;
      cctx.beginPath();
      const P = [[qx0, qy0], [qx1, qy0], [qx1, qy1], [qx0, qy1]];
      for (let j = 0; j < 4; j++) { const X = (isoX(P[j][0], P[j][1]) - cX0) * bS, Y = (isoY(P[j][0], P[j][1]) - cY0) * bS; if (j) cctx.lineTo(X, Y); else cctx.moveTo(X, Y); }
      cctx.closePath();
    };
    let iA = -1, iB = -1;
    for (let k = 0; k < 4; k++) { const i = ty[k] * map.w + tx[k]; if (v[k] && iA < 0) iA = i; if (!v[k] && iB < 0) iB = i; }
    for (let k = 0; k < 4; k++) {
      cctx.save();
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      quarterPath(k); cctx.clip();
      if (v[k]) { pathPoly(lp); cctx.clip(); drawIso(isoTex(B, floorParam(B, iB), variant(tx[k] + 7, ty[k] + 1)), tx[k], ty[k]); }
      else { pathPoly(hp); cctx.clip(); drawIso(isoTex(A, floorParam(A, iA), variant(tx[k] + 2, ty[k] + 9)), tx[k], ty[k]); }
      cctx.restore();
    }
    if (!cfw) return;
    const line = [segs[0]].concat(cfw, [segs[1]]);
    setIso();
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
    if (grassy >= 0) {
      let np = 0;
      _pts[np++] = line[0][0]; _pts[np++] = line[0][1];
      for (const q of line) { _pts[np++] = q[0]; _pts[np++] = q[1]; }
      _pts[np++] = line[line.length - 1][0]; _pts[np++] = line[line.length - 1][1];
      fringe(np, grassy, water ? 0.6 : 0.9);
    }
  }

  // Faces verticais de pisos elevados (meio-fio, varanda, píer, ponte) e borda de piscina
  function faceSE(x, y, dir, h, fill, lines) { // dir 1 = E, 2 = S
    let ax, ay, bx, by;
    if (dir === 1) { ax = x + 1; ay = y; bx = x + 1; by = y + 1; } else { ax = x; ay = y + 1; bx = x + 1; by = y + 1; }
    const X0 = isoX(ax, ay), Y0 = isoY(ax, ay), X1 = isoX(bx, by), Y1 = isoY(bx, by);
    setIso();
    cctx.fillStyle = fill;
    cctx.beginPath(); cctx.moveTo(X0, Y0); cctx.lineTo(X1, Y1); cctx.lineTo(X1, Y1 + h); cctx.lineTo(X0, Y0 + h); cctx.closePath(); cctx.fill();
    if (lines) {
      cctx.strokeStyle = lines; cctx.lineWidth = 0.7;
      for (let s = 0.2; s < 1; s += 0.2) { const X = X0 + (X1 - X0) * s, Y = Y0 + (Y1 - Y0) * s; cctx.beginPath(); cctx.moveTo(X, Y); cctx.lineTo(X, Y + h); cctx.stroke(); }
    }
    cctx.fillStyle = 'rgba(255,255,255,0.18)';
    cctx.beginPath(); cctx.moveTo(X0, Y0); cctx.lineTo(X1, Y1); cctx.lineTo(X1, Y1 + 0.8); cctx.lineTo(X0, Y0 + 0.8); cctx.closePath(); cctx.fill();
  }
  function edgeFaces(x, y) {
    const i = y * map.w + x;
    if (map.wall[i]) return;
    const f = map.floor[i];
    const E = effFloor(x + 1, y), Sf = effFloor(x, y + 1), N = effFloor(x, y - 1), Wf = effFloor(x - 1, y);
    if (bridgeAt[i]) {
      // tabuleiro de ponte: borda de concreto, face lateral até a água e sombra embaixo
      const wat = (n) => n === F.WATER;
      setWorld();
      cctx.fillStyle = '#9a978f';
      if (wat(N)) cctx.fillRect(x, y, 1, 0.1);
      if (wat(Wf)) cctx.fillRect(x, y, 0.1, 1);
      if (wat(E)) cctx.fillRect(x + 0.9, y, 0.1, 1);
      if (wat(Sf)) cctx.fillRect(x, y + 0.9, 1, 0.1);
      cctx.fillStyle = 'rgba(8,16,20,0.45)';
      if (wat(Sf)) cctx.fillRect(x - 0.05, y + 1, 1.1, 0.55);
      if (wat(E)) cctx.fillRect(x + 1, y - 0.05, 0.55, 1.1);
      if (wat(E)) faceSE(x, y, 1, 14, '#85827a', 'rgba(60,58,54,0.35)');
      if (wat(Sf)) faceSE(x, y, 2, 14, '#77746d', 'rgba(60,58,54,0.35)');
      return;
    }
    if (f === F.SIDEWALK) {
      if (E === F.ASPHALT) faceSE(x, y, 1, 3, '#b3afa3');
      if (Sf === F.ASPHALT) faceSE(x, y, 2, 3, '#a39f94');
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
      if (low(E)) faceSE(x, y, 1, 7, '#6a5a48', 'rgba(30,24,18,0.5)');
      if (low(Sf)) faceSE(x, y, 2, 7, '#5e5040', 'rgba(30,24,18,0.5)');
    } else if (f === F.DOCK) {
      const low = (n) => n === F.WATER;
      if (low(E)) faceSE(x, y, 1, 9, '#4e4234', 'rgba(20,16,12,0.6)');
      if (low(Sf)) faceSE(x, y, 2, 9, '#463b2f', 'rgba(20,16,12,0.6)');
      if (low(E) || low(Sf)) { // estaca
        const X = isoX(x + 1, y + 1), Y = isoY(x + 1, y + 1);
        setIso(); cctx.fillStyle = '#3a3026'; cctx.fillRect(X - 1.5, Y - 1, 3, 13);
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
    }
    if (f === F.CONCRETE && !map.building[i]) {
      // juntas de laje a cada 3 tiles
      setWorld();
      cctx.fillStyle = 'rgba(90,88,82,0.55)';
      if (x % 3 === 0) cctx.fillRect(x, y, 0.025, 1);
      if (y % 3 === 0) cctx.fillRect(x, y, 1, 0.025);
    }
  }

  // ------------------------------------------------------------------
  // Grama: tufos em "V" com cor próxima da base, em aglomerados (ruído)
  // ------------------------------------------------------------------
  const TUFT_COLS = [['rgba(100,124,54,0.9)', 'rgba(80,102,42,0.9)', 'rgba(134,148,72,0.85)', 'rgba(90,112,48,0.9)'],
    ['rgba(78,96,50,0.9)', 'rgba(62,78,40,0.9)', 'rgba(90,100,56,0.85)']];
  const tuftBuf = [[], [], [], [], [], [], [], []]; // lâminas por cor (lote)
  function tuft(X, Y, dark, h, scale) {
    const cols = TUFT_COLS[dark ? 1 : 0];
    const c = (dark ? 4 : 0) + ((h * cols.length) | 0);
    const b = tuftBuf[c];
    const s = (0.8 + h * 0.5) * scale;
    // três lâminas abrindo em V a partir da base
    b.push(X, Y, X - 1.6 * s, Y - 3.2 * s);
    b.push(X, Y, X + 0.3 * s, Y - 4.2 * s);
    b.push(X, Y, X + 1.8 * s, Y - 2.8 * s);
  }
  function flushTufts() {
    setIso();
    cctx.lineWidth = 0.9; cctx.lineCap = 'round';
    for (let c = 0; c < tuftBuf.length; c++) {
      const b = tuftBuf[c];
      if (!b.length) continue;
      const cols = TUFT_COLS[c >= 4 ? 1 : 0];
      cctx.strokeStyle = cols[(c & 3) % cols.length];
      cctx.beginPath();
      for (let k = 0; k < b.length; k += 4) { cctx.moveTo(b[k], b[k + 1]); cctx.lineTo(b[k + 2], b[k + 3]); }
      cctx.stroke();
      b.length = 0;
    }
  }
  function details(x, y) {
    const i = y * map.w + x;
    if (map.wall[i]) { if (map.wall[i] === W.DOOR) { const e = entries.get(i); if (e && e.mat) doormat(e); } return; }
    litter(x, y, i);
    const f = map.floor[i];
    const cx = isoX(x + 0.5, y + 0.5), cy = isoY(x + 0.5, y + 0.5);
    const h0 = R.hash(x, y, 303);
    if (f === F.GRASS || f === F.DARK_GRASS) {
      if (bS < 1) return; // em zoom baixo os tufos somem
      const dark = f === F.DARK_GRASS;
      const obj = map.objAt[i] >= 0;
      const dens = U.noise2(x * 0.35, y * 0.35, 311); // aglomerados
      let n = obj ? 2 : 4 + Math.round(dens * dens * 6);
      if (n > 8) n = 8;
      for (let k = 0; k < n; k++) {
        const u = R.hash(x * 31 + k, y * 17, 11), v = R.hash(x * 13, y * 29 + k, 12);
        tuft(cx + (u - v) * 28, cy + (u + v - 1) * 14, dark, R.hash(k, x - y, 14), 1);
      }
      if (dark && h0 < 0.06) { // samambaia
        setIso();
        cctx.strokeStyle = 'rgba(70,98,50,0.9)'; cctx.lineWidth = 1;
        const X = cx + (h0 * 200 - 6), Y = cy;
        for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.42; cctx.beginPath(); cctx.moveTo(X, Y); cctx.quadraticCurveTo(X + Math.cos(a) * 5, Y + Math.sin(a) * 7, X + Math.cos(a) * 9, Y + Math.sin(a) * 6 + 3); cctx.stroke(); }
      }
    } else if ((f === F.DIRT || f === F.SAND) && h0 < 0.25 && bS >= 1) {
      const n = 1 + ((h0 * 8) | 0);
      for (let k = 0; k < n; k++) {
        const u = R.hash(x * 7 + k, y, 31), v = R.hash(x, y * 7 + k, 32);
        tuft(cx + (u - v) * 26, cy + (u + v - 1) * 13, f === F.SAND ? 0 : 1, 0.2, 0.6);
      }
    }
    // tufos na borda de calçadas/asfalto/concreto vizinhos de grama
    if (bS >= 1 && (f === F.SIDEWALK || f === F.ASPHALT || f === F.CONCRETE || f === F.GRAVEL)) {
      for (let d = 0; d < 4; d++) {
        const nf = effFloor(x + R.DX[d], y + R.DY[d]);
        if (nf !== F.GRASS && nf !== F.DARK_GRASS) continue;
        const n = 1 + ((R.hash(x, y, 40 + d) * 3) | 0);
        for (let k = 0; k < n; k++) {
          const s = R.hash(x * 5 + k, y * 3 + d, 41);
          const e = 0.03 + R.hash(x + k, y + d, 42) * 0.08;
          let wx, wy;
          if (d === 0) { wx = x + s; wy = y + e; } else if (d === 2) { wx = x + s; wy = y + 1 - e; }
          else if (d === 3) { wx = x + e; wy = y + s; } else { wx = x + 1 - e; wy = y + s; }
          tuft(isoX(wx, wy), isoY(wx, wy), nf === F.DARK_GRASS, R.hash(k, d, 43), 0.8);
        }
      }
    }
  }

  // Capacho do lado de fora da porta
  const MAT_COLS = ['#6a4e34', '#3e4a3a', '#6a2e2a', '#4a4038', '#5a5048'];
  function doormat(e) {
    setWorld();
    const cx = e.x + 0.5 + e.ox * 0.52, cy = e.y + 0.5 + e.oy * 0.52;
    const alongX = e.oy !== 0;
    const hw = 0.34, hd = 0.19;
    const x0 = cx - (alongX ? hw : hd), y0 = cy - (alongX ? hd : hw), w = alongX ? 2 * hw : 2 * hd, h = alongX ? 2 * hd : 2 * hw;
    const col = R.hex(MAT_COLS[(R.hash(e.x, e.y, 99) * MAT_COLS.length) | 0]);
    cctx.fillStyle = 'rgba(0,0,0,0.22)'; cctx.fillRect(x0 + 0.03, y0 + 0.03, w, h);
    cctx.fillStyle = R.css(col); cctx.fillRect(x0, y0, w, h);
    cctx.strokeStyle = R.css(col, 0.62); cctx.lineWidth = 0.05; cctx.strokeRect(x0 + 0.025, y0 + 0.025, w - 0.05, h - 0.05);
    // faixa central clara (letreiro gasto) e sujeira pisada no meio
    cctx.fillStyle = R.css(col, 1.35, 0.6);
    if (alongX) cctx.fillRect(x0 + 0.14, cy - 0.035, w - 0.28, 0.07); else cctx.fillRect(cx - 0.035, y0 + 0.14, 0.07, h - 0.28);
    cctx.fillStyle = 'rgba(40,32,24,0.18)'; cctx.beginPath(); cctx.ellipse(cx, cy, alongX ? 0.2 : 0.1, alongX ? 0.1 : 0.2, 0, 0, 6.283); cctx.fill();
  }

  // Detalhes narrativos (por hash, sem estado): jornais, sacos de lixo, latas, brinquedos,
  // bicicletas caídas, papéis e manchas de sangue secas. Desenhados "achatados" no bloco do chão.
  const BAG_COLS = ['#23272a', '#2c3a2c', '#3a3a40', '#1e2224'];
  const TOY_COLS = ['#c8402e', '#e0b430', '#3a6ab0', '#3e9a4a', '#e07aa0'];
  function litter(x, y, i) {
    const m = map, f = m.floor[i];
    if (m.objAt[i] >= 0) return;
    const h = R.hash(x, y, 404);
    if (h > 0.05) return;
    const h2 = R.hash(x, y, 405), h3 = R.hash(x, y, 406);
    const cx = x + 0.25 + h2 * 0.5, cy = y + 0.25 + h3 * 0.5, a = R.hash(x, y, 407) * 6.283;
    const hard = f === F.SIDEWALK || f === F.ASPHALT || f === F.CONCRETE || f === F.GRAVEL || f === F.PORCH;
    const inside = !!m.building[i];
    const floorIn = inside && (f === F.WOOD || f === F.TILE || f === F.CARPET || f === F.LINOLEUM || f === F.CONCRETE);
    setWorld();
    cctx.save(); cctx.translate(cx, cy); cctx.rotate(a);
    if (floorIn) {
      if (h < 0.028) { // papéis espalhados
        const n = 1 + ((h2 * 3) | 0);
        for (let k = 0; k < n; k++) {
          const px = (R.hash(x + k, y, 408) - 0.5) * 0.5, py = (R.hash(x, y + k, 409) - 0.5) * 0.5;
          cctx.fillStyle = 'rgba(0,0,0,0.12)'; cctx.fillRect(px + 0.015, py + 0.015, 0.2, 0.26);
          cctx.fillStyle = k & 1 ? '#e4e0d4' : '#d8d4c6'; cctx.fillRect(px, py, 0.2, 0.26);
          cctx.fillStyle = 'rgba(60,60,70,0.35)'; for (let l = 0; l < 4; l++) cctx.fillRect(px + 0.03, py + 0.04 + l * 0.05, 0.14, 0.012);
        }
      } else if (h < 0.034) bloodTrail(h2);
    } else if (hard) {
      if (h < 0.012) { // jornal
        cctx.fillStyle = 'rgba(0,0,0,0.15)'; cctx.fillRect(-0.16, -0.11, 0.34, 0.24);
        cctx.fillStyle = '#cfcabb'; cctx.fillRect(-0.18, -0.13, 0.34, 0.24);
        cctx.fillStyle = '#b9b3a2'; cctx.fillRect(-0.01, -0.13, 0.17, 0.24);
        cctx.fillStyle = 'rgba(50,50,56,0.5)'; cctx.fillRect(-0.15, -0.1, 0.12, 0.04);
        for (let l = 0; l < 5; l++) cctx.fillRect(-0.15, -0.03 + l * 0.03, 0.12, 0.01), cctx.fillRect(0.02, -0.1 + l * 0.04, 0.12, 0.01);
      } else if (h < 0.022 && nearWall(x, y)) { // saco de lixo encostado
        const col = R.hex(BAG_COLS[(h2 * BAG_COLS.length) | 0]);
        cctx.fillStyle = 'rgba(0,0,0,0.3)'; cctx.beginPath(); cctx.ellipse(0.05, 0.05, 0.27, 0.2, 0, 0, 6.283); cctx.fill();
        cctx.fillStyle = R.css(col); cctx.beginPath(); cctx.ellipse(0, 0, 0.25, 0.19, 0, 0, 6.283); cctx.fill();
        cctx.fillStyle = R.css(col, 1.6, 0.8); cctx.beginPath(); cctx.ellipse(-0.08, -0.06, 0.1, 0.05, -0.5, 0, 6.283); cctx.fill();
        cctx.fillStyle = R.css(col, 0.7); cctx.beginPath(); cctx.arc(0.2, -0.12, 0.05, 0, 6.283); cctx.fill();
      } else if (h < 0.03) { // latas/garrafas
        for (let k = 0; k < 2; k++) {
          const px = (R.hash(x + k, y, 410) - 0.5) * 0.4, py = (R.hash(x, y + k, 411) - 0.5) * 0.4;
          cctx.fillStyle = k ? 'rgba(70,110,70,0.9)' : 'rgba(170,40,36,0.95)'; cctx.fillRect(px, py, k ? 0.24 : 0.12, 0.07);
          cctx.fillStyle = 'rgba(230,230,220,0.6)'; cctx.fillRect(px, py, k ? 0.24 : 0.12, 0.018);
        }
      } else if (h < 0.036) bloodTrail(h2);
    } else if ((f === F.GRASS || f === F.DARK_GRASS || f === F.DIRT) && lotKind && lotKind[i] === 1) {
      if (h < 0.008) { // brinquedo (bola / carrinho)
        const col = TOY_COLS[(h2 * TOY_COLS.length) | 0];
        if (h3 < 0.5) {
          cctx.fillStyle = 'rgba(0,0,0,0.25)'; cctx.beginPath(); cctx.ellipse(0.04, 0.04, 0.12, 0.12, 0, 0, 6.283); cctx.fill();
          cctx.fillStyle = col; cctx.beginPath(); cctx.arc(0, 0, 0.11, 0, 6.283); cctx.fill();
          cctx.fillStyle = 'rgba(255,255,255,0.45)'; cctx.beginPath(); cctx.arc(-0.035, -0.035, 0.04, 0, 6.283); cctx.fill();
        } else {
          cctx.fillStyle = 'rgba(0,0,0,0.25)'; cctx.fillRect(-0.12, -0.06, 0.28, 0.16);
          cctx.fillStyle = col; cctx.fillRect(-0.14, -0.08, 0.28, 0.14);
          cctx.fillStyle = '#222'; for (const [u, v] of [[-0.1, -0.1], [0.08, -0.1], [-0.1, 0.06], [0.08, 0.06]]) cctx.fillRect(u, v, 0.05, 0.04);
        }
      } else if (h < 0.012) { // bicicleta caída
        cctx.strokeStyle = '#1e1e20'; cctx.lineWidth = 0.035;
        cctx.beginPath(); cctx.arc(-0.3, 0, 0.2, 0, 6.283); cctx.moveTo(0.5, 0); cctx.arc(0.3, 0, 0.2, 0, 6.283); cctx.stroke();
        cctx.strokeStyle = TOY_COLS[(h2 * TOY_COLS.length) | 0]; cctx.lineWidth = 0.04;
        cctx.beginPath(); cctx.moveTo(-0.3, 0); cctx.lineTo(-0.05, -0.05); cctx.lineTo(0.3, 0); cctx.moveTo(-0.05, -0.05); cctx.lineTo(0.12, -0.2); cctx.lineTo(0.3, 0); cctx.stroke();
        cctx.strokeStyle = '#2a2a2a'; cctx.beginPath(); cctx.moveTo(0.12, -0.2); cctx.lineTo(0.02, -0.26); cctx.moveTo(-0.08, -0.08); cctx.lineTo(-0.14, -0.14); cctx.stroke();
      }
    }
    cctx.restore();
  }
  function nearWall(x, y) {
    const m = map;
    for (let d = 0; d < 4; d++) {
      const nx = x + R.DX[d], ny = y + R.DY[d];
      if (nx >= 0 && ny >= 0 && nx < m.w && ny < m.h && m.wall[ny * m.w + nx] && m.building[ny * m.w + nx]) return true;
    }
    return false;
  }
  // rastro de sangue seco (arrastado), dentro de ~1 tile a partir do centro
  function bloodTrail(h) {
    const n = 4 + ((h * 5) | 0);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      cctx.fillStyle = 'rgba(' + (74 - t * 10 | 0) + ',24,18,' + (0.55 - t * 0.3).toFixed(2) + ')';
      cctx.beginPath(); cctx.ellipse(-0.45 + t * 0.9, Math.sin(k * 1.7) * 0.05, 0.12 - t * 0.05, 0.06, 0, 0, 6.283); cctx.fill();
    }
    cctx.fillStyle = 'rgba(66,20,16,0.5)';
    for (let k = 0; k < 5; k++) { cctx.beginPath(); cctx.arc(-0.5 + R.hash(k, n, 412) * 1.0, (R.hash(n, k, 413) - 0.5) * 0.35, 0.02 + R.hash(k, k, 414) * 0.025, 0, 6.283); cctx.fill(); }
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
      const n1 = U.noise2(x * 0.07, y * 0.07, 17), n2 = U.noise2(x * 0.3, y * 0.3, 18);
      if (f === F.GRASS) {
        const n = n1 * 0.75 + n2 * 0.25;
        if (n < 0.5) { d[p] = 170; d[p + 1] = 160; d[p + 2] = 86; d[p + 3] = Math.min(150, (0.5 - n) * 2 * 175); }   // manchas secas
        else { d[p] = 56; d[p + 1] = 90; d[p + 2] = 34; d[p + 3] = Math.min(140, (n - 0.5) * 2 * 150); }             // manchas viçosas
      } else if (f === F.DARK_GRASS) {
        const n = n1 * 0.6 + n2 * 0.4;
        if (n < 0.5) { d[p] = 96; d[p + 1] = 82; d[p + 2] = 52; d[p + 3] = (0.5 - n) * 2 * 120; }
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
    cctx.setTransform(32 * bS, 16 * bS, -32 * bS, 16 * bS, (isoX(xa, ya) - cX0) * bS, (isoY(xa, ya) - cY0) * bS);
    cctx.drawImage(c, 0, 0);
  }

  // Trilhas gastas na grama (porta → rua)
  function drawTrails(xa, ya, xb, yb) {
    if (!trails.length) return;
    setWorld();
    cctx.lineCap = 'round'; cctx.lineJoin = 'round';
    for (const t of trails) {
      let inside = false;
      for (let k = 0; k < t.length && !inside; k += 2) if (t[k] >= xa - 1 && t[k] <= xb + 1 && t[k + 1] >= ya - 1 && t[k + 1] <= yb + 1) inside = true;
      if (!inside) continue;
      const seed = (t[0] * 31 + t[1] * 17) | 0;
      for (let pass = 0; pass < 3; pass++) {
        cctx.strokeStyle = pass === 0 ? 'rgba(112,96,64,0.22)' : pass === 1 ? 'rgba(122,100,70,0.28)' : 'rgba(96,80,56,0.2)';
        cctx.lineWidth = pass === 0 ? 0.62 : pass === 1 ? 0.4 : 0.18;
        cctx.beginPath();
        for (let k = 0; k < t.length; k += 2) {
          const j = (R.hash(seed + k, pass, 7) - 0.5) * 0.18;
          const X = t[k] + j, Y = t[k + 1] - j;
          if (k) cctx.lineTo(X, Y); else cctx.moveTo(X, Y);
        }
        cctx.stroke();
      }
    }
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
      for (let s = -1; s <= 1; s += 2) {
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
  const LEAF_COLS = ['rgba(138,122,58,0.7)', 'rgba(106,122,58,0.6)', 'rgba(154,106,50,0.6)', 'rgba(120,96,52,0.65)', 'rgba(92,110,52,0.55)'];
  function contactShadow(o) {
    const t = o.type;
    if (t === 'rug') return;
    setWorld();
    if (t === 'tree' || t === 'pine') {
      const cx = o.x + 0.5, cy = o.y + 0.5, r = t === 'tree' ? 1.25 : 0.95;
      const g = cctx.createRadialGradient(cx, cy, 0.05, cx, cy, r);
      g.addColorStop(0, 'rgba(12,16,8,0.42)'); g.addColorStop(0.5, 'rgba(12,16,8,0.2)'); g.addColorStop(1, 'rgba(12,16,8,0)');
      cctx.fillStyle = g; cctx.beginPath(); cctx.arc(cx, cy, r, 0, 6.2832); cctx.fill();
      // folhas caídas / agulhas sob a copa
      if (bS >= 1) {
        const n = t === 'tree' ? 26 : 16;
        for (let k = 0; k < n; k++) {
          const a = R.hash(o.id, k, 71) * 6.283, rr = Math.sqrt(R.hash(o.id, k, 72)) * (t === 'tree' ? 1.5 : 1.1);
          const lx = cx + Math.cos(a) * rr, ly = cy + Math.sin(a) * rr;
          cctx.fillStyle = t === 'pine' ? 'rgba(110,84,52,0.55)' : LEAF_COLS[(R.hash(o.id, k, 73) * LEAF_COLS.length) | 0];
          cctx.beginPath(); cctx.ellipse(lx, ly, t === 'pine' ? 0.05 : 0.07, 0.035, R.hash(o.id, k, 74) * 3, 0, 6.283); cctx.fill();
        }
      }
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
    const al = (car ? 0.34 : 0.2) / 3;
    cctx.fillStyle = 'rgba(10,10,12,' + al.toFixed(3) + ')';
    for (let k = 0; k < 3; k++) {
      const e = 0.06 * (2 - k);
      cctx.fillRect(x0 - e, y0 - e, x1 - x0 + 2 * e, y1 - y0 + 2 * e);
    }
  }

  // ------------------------------------------------------------------
  // Tarefas de construção (fatiadas por orçamento de tempo)
  // ------------------------------------------------------------------
  const PASSES = ['base', 'trans', 'smooth', 'tint', 'trails', 'faces', 'marks', 'ao', 'details', 'done'];
  let job = null;
  function startJob(tier, cx, cy) {
    const ts = TIER[tier];
    const c = R.canvas(ts.cw * tier, ts.ch * tier);
    const X0 = cx * ts.cw, Y0 = cy * ts.ch, X1 = X0 + ts.cw, Y1 = Y0 + ts.ch;
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
    for (const b of tuftBuf) b.length = 0;
    job = { tier, cx, cy, key: cy * 8192 + cx + 4096, c, g: c.getContext('2d', { willReadFrequently: true }), X0, Y0, tiles, xa, ya, xb, yb, pass: 0, k: 0 };
    job.g.imageSmoothingEnabled = true;
  }
  // avança a tarefa até o prazo; true quando terminou
  function stepJob(deadline) {
    const j = job;
    bS = j.tier; bT = 64 * bS; T = bT;
    cctx = j.g; cX0 = j.X0; cY0 = j.Y0;
    const tl = j.tiles;
    while (j.pass < PASSES.length - 1) {
      const pass = PASSES[j.pass];
      if (pass === 'tint') { if (j.xa <= j.xb) tintOverlay(j.xa, j.ya, j.xb, j.yb); j.pass++; j.k = 0; }
      else if (pass === 'trails') { if (j.xa <= j.xb) drawTrails(j.xa, j.ya, j.xb, j.yb); j.pass++; j.k = 0; }
      else if (pass === 'marks') { if (j.xa <= j.xb) drawMarks(j.xa, j.ya, j.xb, j.yb); j.pass++; j.k = 0; if (++stampN > 4e9) { stampN = 1; stamp.fill(0); } }
      else {
        for (; j.k < tl.length; j.k += 2) {
          const x = tl[j.k], y = tl[j.k + 1];
          if (pass === 'base') drawFloorTile(x, y);
          else if (pass === 'trans') transitions(x, y);
          else if (pass === 'smooth') { if (x > 0 && y > 0) smoothCell(x, y); }
          else if (pass === 'faces') edgeFaces(x, y);
          else if (pass === 'ao') {
            wallAO(x, y);
            const oi = map.objAt[y * map.w + x];
            if (oi >= 0 && stamp[oi] !== stampN) { stamp[oi] = stampN; const o = map.objects[oi]; if (o.type === 'rug') drawRug(o); else contactShadow(o); }
          } else if (pass === 'details') details(x, y);
          if ((j.k & 15) === 14 && performance.now() > deadline) { j.k += 2; cctx = null; return false; }
        }
        if (pass === 'details') flushTufts();
        j.pass++; j.k = 0;
      }
      if (performance.now() > deadline && j.pass < PASSES.length - 1) { cctx = null; return false; }
    }
    cctx = null;
    GR.stats.built++;
    return true;
  }

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------
  GR.setScale = function (s) { S = s; };
  GR.invalidate = function (x, y) {
    const X = isoX(x + 0.5, y + 0.5), Y = isoY(x + 0.5, y + 0.5);
    for (const t in caches) {
      const ts = TIER[t], c = caches[t];
      for (const [k, ch] of c.map) {
        if (X + 48 >= ch.cx * ts.cw && X - 48 <= (ch.cx + 1) * ts.cw && Y + 48 >= ch.cy * ts.ch && Y - 64 <= (ch.cy + 1) * ts.ch) c.delete(k);
      }
    }
    if (job) { const ts = TIER[job.tier]; if (X + 48 >= job.cx * ts.cw && X - 48 <= (job.cx + 1) * ts.cw && Y + 48 >= job.cy * ts.ch && Y - 64 <= (job.cy + 1) * ts.ch) job = null; }
  };
  GR.invalidateAll = function () { for (const t in caches) caches[t].clear(); job = null; };
  // substituto: mapa-miniatura + blocos de outras escalas que cobrem o retângulo
  function placeholder(ctx, X0, Y0, w, h) {
    ctx.drawImage(mini, X0 / 32 - miniU0 + 0.5, Y0 / 16 + 0.5, w / 32, h / 16, X0, Y0, w, h);
    for (const t in caches) {
      if (+t === S) continue;
      const ts = TIER[t];
      const cx0 = Math.floor(X0 / ts.cw), cx1 = Math.floor((X0 + w - 1) / ts.cw), cy0 = Math.floor(Y0 / ts.ch), cy1 = Math.floor((Y0 + h - 1) / ts.ch);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const ch = caches[t].peek(cy * 8192 + cx + 4096);
        if (!ch) continue;
        // parte do bloco de outra escala dentro do retângulo
        const ix0 = Math.max(X0, cx * ts.cw), iy0 = Math.max(Y0, cy * ts.ch), ix1 = Math.min(X0 + w, (cx + 1) * ts.cw), iy1 = Math.min(Y0 + h, (cy + 1) * ts.ch);
        if (ix1 <= ix0 || iy1 <= iy0) continue;
        const k = +t;
        ctx.drawImage(ch.c, (ix0 - cx * ts.cw) * k, (iy0 - cy * ts.ch) * k, (ix1 - ix0) * k, (iy1 - iy0) * k, ix0, iy0, ix1 - ix0, iy1 - iy0);
      }
    }
  }
  // Desenha os blocos visíveis. ctx já com a transformação da câmera (px isométricos).
  // view = { X0, Y0, X1, Y1 } em px isométricos. budget: ms para construir blocos (Infinity = síncrono).
  const _miss = [];
  GR.draw = function (ctx, view, budget) {
    frameNo++;
    const m = map, ts = TIER[S], cache = caches[S];
    const CW = ts.cw, CH = ts.ch;
    const mapX0 = -m.h * 32, mapX1 = m.w * 32, mapY1 = (m.w + m.h) * 16;
    const cx0 = Math.floor(Math.max(view.X0, mapX0) / CW), cx1 = Math.floor(Math.min(view.X1, mapX1) / CW);
    const cy0 = Math.floor(Math.max(view.Y0, 0) / CH), cy1 = Math.floor(Math.min(view.Y1, mapY1) / CH);
    const nVis = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    cache.max = Math.max(S > 1 ? 24 : 40, Math.ceil(nVis * 1.6) + 12);
    _miss.length = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = cy * 8192 + cx + 4096;
      const ch = cache.get(key);
      if (ch) ctx.drawImage(ch.c, cx * CW, cy * CH, CW, CH);
      else { placeholder(ctx, cx * CW, cy * CH, CW, CH); _miss.push(cx, cy); }
    }
    GR.stats.missing = _miss.length >> 1;
    // construção por orçamento: primeiro os que faltam (mais perto do centro), depois o anel em volta
    const t0 = performance.now();
    const deadline = t0 + budget;
    const vx = (view.X0 + view.X1) / 2, vy = (view.Y0 + view.Y1) / 2;
    let guard = 0;
    while (performance.now() < deadline && guard++ < 64) {
      if (job && (job.tier !== S || cache.has(job.key))) job = null;
      if (!job) {
        let best = -1, bd = 1e18;
        for (let k = 0; k < _miss.length; k += 2) {
          const kk = _miss[k + 1] * 8192 + _miss[k] + 4096;
          if (cache.has(kk)) continue;
          const d = ((_miss[k] + 0.5) * CW - vx) ** 2 + ((_miss[k + 1] + 0.5) * CH - vy) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
        if (best >= 0) startJob(S, _miss[best], _miss[best + 1]);
        else {
          // pré-constrói um vizinho (só se sobrar tempo neste quadro)
          if (budget === Infinity || performance.now() - t0 > budget * 0.5) break;
          const ring = [[cx0 - 1, cy0], [cx1 + 1, cy0], [cx0, cy0 - 1], [cx0, cy1 + 1], [cx1 + 1, cy1], [cx0 - 1, cy1], [cx1, cy0 - 1], [cx1, cy1 + 1]];
          let found = false;
          for (const [cx, cy] of ring) {
            if (cx * CW > mapX1 || (cx + 1) * CW < mapX0 || cy < 0 || cy * CH > mapY1) continue;
            if (!cache.has(cy * 8192 + cx + 4096)) { startJob(S, cx, cy); found = true; break; }
          }
          if (!found) break;
        }
      }
      if (stepJob(deadline)) {
        const j = job; job = null;
        cache.set(j.key, { c: j.c, cx: j.cx, cy: j.cy });
        if (j.cx >= cx0 && j.cx <= cx1 && j.cy >= cy0 && j.cy <= cy1) ctx.drawImage(j.c, j.cx * CW, j.cy * CH, CW, CH);
      }
    }
    GR.stats.chunks = cache.size;
  };
})();
