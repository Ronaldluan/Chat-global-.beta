/* =====================================================================
 * VALE QUIETO — render-walls.js  (Etapa 2: Render)
 * Estruturas: paredes FINAS estilo Project Zomboid ao longo do wallMask
 * (junções L/T/+), materiais (tábuas, tijolo, reboco, bloco, vidro,
 * acabamentos internos por cômodo), portas, janelas, portões de garagem,
 * cercas de madeira/tela, sebes, portões de cerca — em todos os estados —
 * e telhados reais por building.parts (duas águas, quatro águas, plano).
 * Cada tile de parede vira um sprite em cache (chave = aparência).
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, W = G.WALL, WS = G.WS, U = G.util;
  const RW = (R.walls = {});
  const ZPX = R.ZPX;
  const HM = R.WALL_M;          // altura da parede (m)
  const CUT_M = 0.36;           // altura da parede recortada (m)
  const T2 = 0.075;             // meia espessura da parede (tiles)
  RW.T2 = T2; RW.CUT_M = CUT_M;
  let S = 1, map = null;
  // sprites por escala (LRU real); trocar de zoom não descarta nada
  const caches = { 0.5: new R.Cache(900), 1: new R.Cache(900), 2: new R.Cache(420) };
  const roofCaches = { 0.5: new R.Cache(90), 1: new R.Cache(90), 2: new R.Cache(40) };
  RW.budget = 1e9;      // ms por quadro para gerar sprites de parede
  RW.hardCap = 6;       // além do orçamento, só gera sem substituto até este excesso (ms)
  RW.stats = { gen: 0, ms: 0, roofGen: 0, roofMs: 0 };
  RW.roofBudget = 1e9;  // ms por quadro para gerar sprites de telhado
  let staticKey = null;   // chave estática por tile (acabamentos)
  let finOf = null;       // Int16Array(n*5): acabamento por meia-parede (N,E,S,W,poste)

  const isStruct = (w) => w === W.WOOD || w === W.BRICK || w === W.PLASTER || w === W.CONCRETE;
  const isOpening = (w) => w === W.DOOR || w === W.WINDOW || w === W.GLASS || w === W.GARAGE_DOOR;
  const isFence = (w) => w === W.FENCE_WOOD || w === W.FENCE_METAL || w === W.HEDGE || w === W.FENCE_GATE;
  RW.isFence = isFence;

  // ------------------------------------------------------------------
  // Acabamentos (materiais das faces visíveis)
  // ------------------------------------------------------------------
  const FIN = [];
  const finMap = new Map();
  function fin(kind, color, extra) {
    const c = R.hex(color);
    const key = kind + ':' + c.join(',') + ':' + (extra || '');
    let id = finMap.get(key);
    if (id == null) { id = FIN.length; FIN.push({ kind, col: c, extra: extra || '' }); finMap.set(key, id); }
    return id;
  }
  function extFinish(b, wv) {
    if (!b) return fin('siding', '#b8b4a8');
    const t = b.type;
    const col = b.wallColor || '#b8b4a8';
    const wt = b.wall || wv;
    if (t === 'cabin') return fin('log', '#7a5a3a');
    if (t === 'barn') return fin('barn', col || '#8e3b2f');
    if (wt === W.BRICK) return fin('brick', col);
    if (wt === W.PLASTER) return fin('stucco', col);
    if (wt === W.CONCRETE) return fin(t === 'warehouse' || t === 'fire_station' ? 'metal' : 'block', col || '#a8a69e');
    return fin('siding', col);
  }
  function intFinish(roomId, b) {
    const room = roomId ? map.rooms[roomId - 1] : null;
    const h = R.hash(roomId || (b ? b.id * 13 : 1), 5, 71);
    const paint = R.PAL.paint[(h * R.PAL.paint.length) | 0];
    if (!room) return fin('paint', paint);
    const t = room.type;
    if (t === 'bathroom') return fin('tilewain', paint, ['#cfdfe0', '#e2ddd0', '#c9d6c4', '#d9d0d8'][(h * 4) | 0]);
    if (t === 'garage' || t === 'warehouse' || t === 'storage' && b && b.type !== 'house') return fin('block', '#a9a69c');
    if (b && (b.type === 'barn' || b.type === 'shed')) return fin('boards', '#8a6a48');
    if (b && b.type === 'cabin') return fin('log', '#8a6a48');
    if ((t === 'bedroom' && h < 0.55) || (t === 'living' && h < 0.3)) return fin('wallpaper', paint, R.PAL.paint[((h * 7) % 1 * R.PAL.paint.length) | 0]);
    if (t === 'police' || t === 'clinic' || t === 'pharmacy' || t === 'school' || t === 'office') return fin('paint', ['#c9d3cc', '#cfd6dc', '#d6d2c2', '#c4ccd0'][(h * 4) | 0]);
    return fin('paint', paint);
  }
  function finishForQuarter(i, q) {
    const m = map;
    const src = R.ground.qsrc(i, q);
    const b = m.building[i] ? m.buildings[m.building[i] - 1] : null;
    if (src === i) return extFinish(b, m.wall[i]);
    if (!m.building[src]) return extFinish(b, m.wall[i]);
    const sb = m.buildings[m.building[src] - 1];
    return intFinish(m.room[src], sb);
  }

  RW.reset = function (m) {
    map = m;
    for (const k in caches) caches[k].clear();
    for (const k in roofCaches) roofCaches[k].clear();
    const n = m.w * m.h;
    finOf = new Int16Array(n * 5);
    staticKey = new Array(n);
    for (let i = 0; i < n; i++) if (m.wall[i]) RW.updateTile(i);
    buildRoofs();
  };
  RW.setScale = function (s) { S = s; };

  // tile vizinho ao longo do eixo tem a mesma estrutura (portões de garagem, vitrines)
  function sameAlong(i, axis, dir, type) {
    const m = map, x = i % m.w, y = (i / m.w) | 0;
    const nx = axis === 'x' ? x + dir : x, ny = axis === 'y' ? y + dir : y;
    if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) return false;
    const j = ny * m.w + nx;
    return m.wall[j] === type && m.building[j] === m.building[i];
  }
  function axisOf(i) {
    const mk = map.wallMask[i];
    if (mk & 10) return 'x';
    if (mk & 5) return 'y';
    // sem conexões: olha os vizinhos
    const m = map, x = i % m.w, y = (i / m.w) | 0;
    const wAt = (a, b) => a >= 0 && b >= 0 && a < m.w && b < m.h && m.wall[b * m.w + a];
    return wAt(x - 1, y) || wAt(x + 1, y) ? 'x' : 'y';
  }
  // extensão de cercas até o plano da parede vizinha que não liga de volta
  function fenceExt(i) {
    const m = map, x = i % m.w, y = (i / m.w) | 0, mk = m.wallMask[i];
    let ext = 0;
    const back = [4, 8, 1, 2]; // bit oposto para N,E,S,W
    const dirs = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
    for (let d = 0; d < 4; d++) {
      const [dx, dy, bit] = dirs[d];
      if (!(mk & bit)) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (m.wall[j] && !(m.wallMask[j] & back[d]) && !isFence(m.wall[j])) ext |= bit;
    }
    return ext;
  }

  const AC_TYPES = { house: 1, motel: 1, trailer: 1, office: 1, diner: 1 };
  RW.updateTile = function (i) {
    const m = map, wv = m.wall[i];
    if (!wv) { staticKey[i] = null; return; }
    const mk = m.wallMask[i];
    const x = i % m.w, y = (i / m.w) | 0;
    if (isStruct(wv) || isOpening(wv)) {
      // acabamento por lado visível: E-meia → SE, W-meia → SW, S-meia → SE, N-meia → NE, poste → SE
      finOf[i * 5 + 0] = finishForQuarter(i, 1);
      finOf[i * 5 + 1] = finishForQuarter(i, 3);
      finOf[i * 5 + 2] = finishForQuarter(i, 3);
      finOf[i * 5 + 3] = finishForQuarter(i, 2);
      finOf[i * 5 + 4] = finishForQuarter(i, 3);
      const f = finOf.subarray(i * 5, i * 5 + 5).join(',');
      if (wv === W.DOOR || wv === W.WINDOW) {
        const b = m.building[i] ? m.buildings[m.building[i] - 1] : null;
        const q = R.ground.qsrc;
        const ext = !m.building[q(i, 3)] || !m.building[q(i, 0)];
        const hc = R.hash(b ? b.id : x, ext ? 1 : y, wv === W.DOOR ? 88 : 89);
        // extras na face visível (sul/leste) quando ela dá para fora: luminária sobre a porta, ar-condicionado na janela
        const visOut = !m.building[q(i, 3)];
        let extra = '';
        if (visOut && wv === W.DOOR) { const en = R.ground.entry(i); if (en && en.lamp && (en.ox > 0 || en.oy > 0)) extra = '|L'; }
        if (visOut && wv === W.WINDOW && b && AC_TYPES[b.type] && R.hash(x, y, 95) < 0.12) extra = '|A';
        staticKey[i] = (wv === W.DOOR ? 'D' : 'N') + axisOf(i) + mk + '|' + f + '|' + (ext ? 'e' : 'i') + ((hc * 6) | 0) + '|' + ((R.hash(m.room[q(i, 3)] || m.room[q(i, 0)] || x, 7, 3) * 8) | 0) + extra;
      } else if (wv === W.GARAGE_DOOR || wv === W.GLASS) {
        const ax = axisOf(i);
        const a = sameAlong(i, ax, -1, wv) ? 1 : 0, bb = sameAlong(i, ax, 1, wv) ? 1 : 0;
        const b = m.building[i] ? m.buildings[m.building[i] - 1] : null;
        staticKey[i] = (wv === W.GARAGE_DOOR ? 'G' : 'V') + ax + mk + '|' + f + '|' + a + bb + '|' + ((R.hash(b ? b.id : 0, 2, 9) * 4) | 0);
      } else {
        // variação de desgaste (escorridos, manchas) só em faces externas
        let ext = false;
        for (let k = 0; k < 5; k++) if (finExt(finOf[i * 5 + k])) ext = true;
        staticKey[i] = 'W' + mk + '|' + f + '|w' + (ext ? 1 + ((R.hash(x, y, 64) * 3) | 0) : 0);
      }
    } else if (isFence(wv)) {
      const v = (R.hash(x, y, 51) * 4) | 0;
      let gateStyle = 0;
      if (wv === W.FENCE_GATE) {
        const ax = axisOf(i);
        for (const d of [-1, 1]) {
          const nx = ax === 'x' ? x + d : x, ny = ax === 'y' ? y + d : y;
          if (nx >= 0 && ny >= 0 && nx < m.w && ny < m.h && m.wall[ny * m.w + nx] === W.FENCE_METAL) gateStyle = 1;
        }
        staticKey[i] = 'F' + wv + ':' + ax + mk + '|' + gateStyle;
      } else staticKey[i] = 'F' + wv + ':' + mk + '|' + v + '|' + fenceExt(i);
    } else staticKey[i] = 'W' + mk + '|0,0,0,0,0';
  };

  // ------------------------------------------------------------------
  // Pintura das faces (coordenadas da face: u ao longo, z para cima, metros)
  // ------------------------------------------------------------------
  let wearV = 0; // variante de desgaste do sprite em construção
  function paintFinish(g, f, u0, u1, z0, z1, exterior) {
    const c = f.col;
    g.fillStyle = R.css(c); g.fillRect(u0, z0, u1 - u0, z1 - z0);
    const rng = U.rng(((u0 * 1000) | 0) + FIN.indexOf(f) * 7 + 3);
    switch (f.kind) {
      case 'siding': {
        for (let z = 0; z < z1; z += 0.2) {
          if (z + 0.2 < z0) continue;
          g.fillStyle = R.css(c, 1.07); g.fillRect(u0, z + 0.13, u1 - u0, 0.07);
          g.fillStyle = R.css(c, 0.72); g.fillRect(u0, z, u1 - u0, 0.03);
        }
        break;
      }
      case 'brick': {
        for (let k = 0, z = 0; z < z1; k++, z += 0.1) {
          const off = k & 1 ? 0.125 : 0;
          for (let u = -0.25 + off; u < 1; u += 0.25) {
            if (u + 0.25 < u0 || u > u1) continue;
            const h = R.hash(((u + 1) * 8) | 0, k, 61);
            g.fillStyle = R.css(c, 0.86 + h * 0.26);
            g.fillRect(u + 0.012, z + 0.012, 0.226, 0.076);
          }
        }
        break;
      }
      case 'stucco': {
        for (let k = 0; k < 60 * (u1 - u0); k++) {
          g.fillStyle = rng() < 0.5 ? R.css(c, 1.06, 0.6) : R.css(c, 0.9, 0.5);
          g.fillRect(u0 + rng() * (u1 - u0), z0 + rng() * (z1 - z0), 0.03, 0.03);
        }
        break;
      }
      case 'block': {
        for (let k = 0, z = 0; z < z1; k++, z += 0.25) {
          const off = k & 1 ? 0.25 : 0;
          g.fillStyle = R.css(c, 0.8);
          g.fillRect(u0, z, u1 - u0, 0.02);
          for (let u = off; u <= 1; u += 0.5) if (u >= u0 && u <= u1) g.fillRect(u, z, 0.02, 0.25);
        }
        break;
      }
      case 'metal': {
        for (let u = 0; u < 1; u += 0.1) {
          if (u + 0.1 < u0 || u > u1) continue;
          g.fillStyle = R.css(c, 1.12); g.fillRect(u, z0, 0.035, z1 - z0);
          g.fillStyle = R.css(c, 0.8); g.fillRect(u + 0.06, z0, 0.03, z1 - z0);
        }
        break;
      }
      case 'barn': case 'boards': {
        for (let u = 0; u < 1; u += 0.2) {
          if (u + 0.2 < u0 || u > u1) continue;
          const h = R.hash((u * 10) | 0, 3, 62);
          g.fillStyle = R.css(c, 0.9 + h * 0.2); g.fillRect(u + 0.01, z0, 0.18, z1 - z0);
          g.fillStyle = R.css(c, 0.55); g.fillRect(u, z0, 0.015, z1 - z0);
        }
        if (f.kind === 'barn' && exterior) { g.fillStyle = 'rgba(235,228,214,0.9)'; g.fillRect(u0, 2.2, u1 - u0, 0.08); }
        break;
      }
      case 'log': {
        for (let z = 0; z < z1; z += 0.22) {
          const gr = g.createLinearGradient(0, z, 0, z + 0.22);
          gr.addColorStop(0, R.css(c, 0.65)); gr.addColorStop(0.45, R.css(c, 1.1)); gr.addColorStop(1, R.css(c, 0.7));
          g.fillStyle = gr; g.fillRect(u0, z, u1 - u0, 0.22);
        }
        break;
      }
      case 'wallpaper': {
        const c2 = R.hex(f.extra || '#ccc');
        for (let u = 0; u < 1; u += 0.125) {
          if (u + 0.125 < u0 || u > u1) continue;
          g.fillStyle = R.css(R.mix(c, c2, 0.5), 1, 0.55); g.fillRect(u, z0, 0.04, z1 - z0);
        }
        break;
      }
      case 'tilewain': {
        const c2 = R.hex(f.extra || '#dde');
        g.fillStyle = R.css(c2); g.fillRect(u0, 0, u1 - u0, Math.min(z1, 1.25));
        g.fillStyle = R.css(c2, 0.8);
        for (let z = 0; z < Math.min(z1, 1.25); z += 0.125) g.fillRect(u0, z, u1 - u0, 0.012);
        for (let u = 0; u <= 1; u += 0.125) if (u >= u0 && u <= u1) g.fillRect(u, 0, 0.012, Math.min(z1, 1.25));
        g.fillStyle = R.css(c2, 0.7); g.fillRect(u0, 1.22, u1 - u0, 0.05);
        break;
      }
      default: break; // paint
    }
    // desgaste por variante (escorridos do beiral, manchas, tinta descascada / eflorescência)
    if (exterior && wearV) {
      const wr = U.rng(wearV * 7919 + FIN.indexOf(f) * 31);
      const ns = 1 + ((wr() * 3) | 0);
      for (let k = 0; k < ns; k++) {
        const u = wr(), w = 0.03 + wr() * 0.08, len = 0.5 + wr() * 1.3;
        if (u + w < u0 || u > u1) continue;
        const gr = g.createLinearGradient(0, HM, 0, HM - len);
        gr.addColorStop(0, 'rgba(48,42,34,0.26)'); gr.addColorStop(1, 'rgba(48,42,34,0)');
        g.fillStyle = gr; g.fillRect(u, HM - len, w, len);
      }
      const nb = (wr() * 3) | 0;
      for (let k = 0; k < nb; k++) {
        const u = wr() * 0.9, z = 0.3 + wr() * 1.6, bw = 0.06 + wr() * 0.16, bh = 0.04 + wr() * 0.12;
        if (u + bw < u0 || u > u1) continue;
        g.fillStyle = f.kind === 'brick' ? 'rgba(220,214,200,0.22)' : f.kind === 'siding' || f.kind === 'stucco' ? R.css(c, 1.18, 0.55) : 'rgba(40,36,30,0.14)';
        g.fillRect(u, z, bw, bh);
      }
    }
    // base/rodapé e sujeira
    if (exterior) {
      if (z0 < 0.16) { g.fillStyle = 'rgba(95,92,86,1)'; g.fillRect(u0, 0, u1 - u0, 0.16); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(u0, 0.16, u1 - u0, 0.02); }
      const gr = g.createLinearGradient(0, 0.16, 0, 0.9);
      gr.addColorStop(0, 'rgba(60,50,35,0.28)'); gr.addColorStop(1, 'rgba(60,50,35,0)');
      g.fillStyle = gr; g.fillRect(u0, 0.16, u1 - u0, 0.74);
      if (z1 > HM - 0.1) { g.fillStyle = R.css(c, 1.18); g.fillRect(u0, HM - 0.08, u1 - u0, 0.08); }
    } else if (f.kind !== 'block' && f.kind !== 'log' && f.kind !== 'boards') {
      g.fillStyle = f.kind === 'tilewain' ? R.css(f.extra || '#ccc', 0.75) : '#e6e1d6'; g.fillRect(u0, 0, u1 - u0, 0.09);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(u0, 0.09, u1 - u0, 0.012);
      const gr = g.createLinearGradient(0, z1, 0, z1 - 0.5);
      gr.addColorStop(0, 'rgba(0,0,0,0.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(u0, z1 - 0.5, u1 - u0, 0.5);
    }
  }

  // Caixa alinhada ao mundo com faces sul/leste/topo.
  // st: { s: fn|finId|color (face sul), e: (face leste), top: color, sb: brilho sul, eb: brilho leste }
  const BR_S = 0.8, BR_E = 0.96;
  function wbox(g, x0, x1, y0, y1, z0, z1, st) {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    const P = (x, y, z) => [(x - y) * 32, (x + y) * 16 - z * ZPX];
    const faceFill = (spec, u0, u1, br, ext) => {
      if (spec == null || spec === false) return;
      g.save();
      g.beginPath(); g.rect(u0, z0, u1 - u0, z1 - z0); g.clip();
      if (typeof spec === 'function') spec(g, u0, u1, z0, z1);
      else if (typeof spec === 'number') paintFinish(g, FIN[spec], u0, u1, z0, z1, ext);
      else { g.fillStyle = spec; g.fillRect(u0, z0, u1 - u0, z1 - z0); }
      if (br < 1) { g.fillStyle = 'rgba(0,0,0,' + (1 - br).toFixed(3) + ')'; g.fillRect(u0, z0, u1 - u0, z1 - z0); }
      g.restore();
    };
    // sul (y = y1): (u = x, z)
    if (st.s != null && st.s !== false) {
      g.save(); g.transform(32, 16, 0, -ZPX, -y1 * 32, y1 * 16);
      faceFill(st.s, x0, x1, st.sb != null ? st.sb : BR_S, st.ext);
      g.restore();
    }
    // leste (x = x1): (u = y, z)
    if (st.e != null && st.e !== false) {
      g.save(); g.transform(-32, 16, 0, -ZPX, x1 * 32, x1 * 16);
      faceFill(st.e, y0, y1, st.eb != null ? st.eb : BR_E, st.ext);
      g.restore();
    }
    if (st.top) {
      g.fillStyle = st.top;
      g.beginPath();
      let p = P(x0, y0, z1); g.moveTo(p[0], p[1]);
      p = P(x1, y0, z1); g.lineTo(p[0], p[1]);
      p = P(x1, y1, z1); g.lineTo(p[0], p[1]);
      p = P(x0, y1, z1); g.lineTo(p[0], p[1]);
      g.closePath(); g.fill();
    }
  }
  // Transforma o contexto para o plano vertical no eixo da parede: (s ao longo, z para cima)
  function planeT(g, axis, c) {
    if (axis === 'x') g.transform(32, 16, 0, -ZPX, -c * 32, c * 16);
    else g.transform(-32, 16, 0, -ZPX, c * 32, c * 16);
  }
  // caixa em coordenadas (s ao longo do eixo, c através, z)
  function abox(g, axis, s0, s1, c0, c1, z0, z1, face, end, top, ext) {
    if (axis === 'x') wbox(g, s0, s1, c0, c1, z0, z1, { s: face, e: end, top, ext });
    else wbox(g, c0, c1, s0, s1, z0, z1, { e: face, s: end, top, ext, eb: BR_E, sb: BR_S });
  }

  // ------------------------------------------------------------------
  // Sprites de tiles de parede
  // ------------------------------------------------------------------
  const TOPCAP = '#39342f', TOPCAP_CUT = '#2c2824';
  function newSprite(L, Rr, TOP, B) {
    const w = L + Rr, h = TOP + 32 + B;
    const c = R.canvas(w * S, h * S), g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(S, 0, 0, S, L * S, TOP * S);
    g.lineJoin = 'round';
    return { c, g, L, TOP, w, h };
  }
  function finExt(id) { const f = FIN[id]; return f && (f.kind === 'siding' || f.kind === 'brick' || f.kind === 'stucco' || f.kind === 'barn' || f.kind === 'log' || f.kind === 'metal') ; }

  function drawPlainWall(g, i, mk, cutH) {
    const H = cutH, f = finOf, b = i * 5;
    const top = cutH < HM ? TOPCAP_CUT : TOPCAP;
    const lo = 0.5 - T2, hi = 0.5 + T2;
    const ex = (k) => finExt(f[b + k]);
    const e = 0.014; // sobreposição: evita frestas de antialiasing entre segmentos
    if (mk & 1) wbox(g, lo, hi, -e, lo + e, 0, H, { e: f[b + 0], top, ext: ex(0) });
    if (mk & 8) wbox(g, -e, lo + e, lo, hi, 0, H, { s: f[b + 3], top, ext: ex(3) });
    wbox(g, lo, hi, lo, hi, 0, H, { s: mk & 4 ? null : f[b + 4], e: mk & 2 ? null : f[b + 4], top, ext: ex(4) });
    if (mk & 2) wbox(g, hi - e, 1 + e, lo, hi, 0, H, { s: f[b + 1], top, ext: ex(1) });
    if (mk & 4) wbox(g, lo, hi, hi - e, 1 + e, 0, H, { e: f[b + 2], top, ext: ex(2) });
  }

  // Tábuas de barricada no plano da parede (lado visível)
  function planks(g, axis, s0, s1, zA, zB, level, cOff) {
    if (level <= 0) return;
    g.save(); planeT(g, axis, cOff);
    const L = [];
    const mid = (zA + zB) / 2, hh = (zB - zA);
    if (level >= 1) L.push([s0 - 0.08, zA + hh * 0.15, s1 + 0.08, zB - hh * 0.2]);
    if (level >= 2) L.push([s0 - 0.08, zB - hh * 0.15, s1 + 0.08, zA + hh * 0.2]);
    if (level >= 3) L.push([s0 - 0.1, mid + hh * 0.05, s1 + 0.1, mid - hh * 0.02]);
    if (level >= 4) L.push([s0 - 0.1, zA + hh * 0.08, s1 + 0.1, zA + hh * 0.1]);
    for (let k = 0; k < L.length; k++) {
      const [ax, az, bx, bz] = L[k];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz), nx = -dz / l * 0.075, nz = dx / l * 0.075;
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath(); g.moveTo(ax + nx + 0.02, az + nz - 0.03); g.lineTo(bx + nx + 0.02, bz + nz - 0.03); g.lineTo(bx - nx + 0.02, bz - nz - 0.03); g.lineTo(ax - nx + 0.02, az - nz - 0.03); g.closePath(); g.fill();
      g.fillStyle = ['#8a6844', '#7a5a3a', '#94724c', '#6e5236'][k & 3];
      g.beginPath(); g.moveTo(ax + nx, az + nz); g.lineTo(bx + nx, bz + nz); g.lineTo(bx - nx, bz - nz); g.lineTo(ax - nx, az - nz); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,28,16,0.6)'; g.lineWidth = 0.012; g.stroke();
      g.fillStyle = '#2a2622';
      for (const t of [0.08, 0.92]) { const px = ax + dx * t, pz = az + dz * t; g.fillRect(px - 0.012, pz - 0.012, 0.024, 0.024); }
    }
    g.restore();
  }

  // Vidro (fechado) no plano: reflexo do céu + faixa de brilho
  function glass(g, s0, s1, z0, z1, lit, alpha, curtainCol) {
    if (curtainCol) {
      const cc = R.hex(curtainCol);
      for (let s = s0; s < s1; s += 0.06) {
        const k = 0.8 + 0.3 * Math.sin((s - s0) * 60);
        g.fillStyle = lit ? R.css(R.mix(cc, [255, 214, 150], 0.55), k * 1.05) : R.css(cc, k);
        g.fillRect(s, z0, 0.065, z1 - z0);
      }
    }
    if (lit && !curtainCol) {
      const gr = g.createLinearGradient(0, z1, 0, z0);
      gr.addColorStop(0, 'rgb(255,226,160)'); gr.addColorStop(1, 'rgb(250,196,120)');
      g.fillStyle = gr; g.fillRect(s0, z0, s1 - s0, z1 - z0);
      return;
    }
    const gr = g.createLinearGradient(0, z1, 0, z0);
    gr.addColorStop(0, 'rgba(170,196,206,' + (alpha * (curtainCol ? 0.35 : 0.85)) + ')');
    gr.addColorStop(0.55, 'rgba(92,120,134,' + (alpha * (curtainCol ? 0.3 : 0.8)) + ')');
    gr.addColorStop(1, 'rgba(58,78,92,' + (alpha * (curtainCol ? 0.3 : 0.85)) + ')');
    g.fillStyle = gr; g.fillRect(s0, z0, s1 - s0, z1 - z0);
    // faixa de reflexo
    g.save(); g.beginPath(); g.rect(s0, z0, s1 - s0, z1 - z0); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.22)';
    const w = s1 - s0;
    g.beginPath(); g.moveTo(s0 + w * 0.15, z1); g.lineTo(s0 + w * 0.42, z1); g.lineTo(s0 + w * 0.05, z0); g.lineTo(s0 - w * 0.22, z0); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.moveTo(s0 + w * 0.55, z1); g.lineTo(s0 + w * 0.62, z1); g.lineTo(s0 + w * 0.25, z0); g.lineTo(s0 + w * 0.18, z0); g.closePath(); g.fill();
    g.restore();
  }
  function shards(g, s0, s1, z0, z1, seed) {
    const rng = U.rng(seed);
    g.fillStyle = 'rgba(160,190,200,0.75)';
    const w = s1 - s0, h = z1 - z0;
    const edge = (n, fn) => { for (let k = 0; k < n; k++) fn(rng()); };
    edge(3, (t) => { const s = s0 + t * w; g.beginPath(); g.moveTo(s - 0.06, z1); g.lineTo(s + 0.07, z1); g.lineTo(s + (rng() - 0.5) * 0.05, z1 - h * (0.15 + rng() * 0.3)); g.closePath(); g.fill(); });
    edge(2, (t) => { const s = s0 + t * w; g.beginPath(); g.moveTo(s - 0.07, z0); g.lineTo(s + 0.07, z0); g.lineTo(s, z0 + h * (0.1 + rng() * 0.25)); g.closePath(); g.fill(); });
    edge(2, (t) => { const z = z0 + t * h; g.beginPath(); g.moveTo(s0, z - 0.07); g.lineTo(s0, z + 0.07); g.lineTo(s0 + w * (0.15 + rng() * 0.25), z); g.closePath(); g.fill(); });
    edge(1, (t) => { const z = z0 + t * h; g.beginPath(); g.moveTo(s1, z - 0.08); g.lineTo(s1, z + 0.08); g.lineTo(s1 - w * (0.15 + rng() * 0.2), z); g.closePath(); g.fill(); });
    g.strokeStyle = 'rgba(230,245,250,0.6)'; g.lineWidth = 0.01;
    g.strokeRect(s0, z0, w, h);
  }
  const DOOR_EXT = ['#6b2f2a', '#2f4a3a', '#2a3a5a', '#7a6a5a', '#d8d2c4', '#5a3a24'];
  const DOOR_INT = ['#8a6a48', '#d6d0c2', '#9a7a58', '#cfc8b8', '#7a5a3c', '#ddd6c8'];
  const TRIM = '#e4e0d6';

  function doorLeafDeco(g, s0, s1, z0, z1, col, knobLeft, ext) {
    const w = s1 - s0, h = z1 - z0;
    g.fillStyle = R.css(col); g.fillRect(s0, z0, w, h);
    g.strokeStyle = R.css(col, 0.72); g.lineWidth = 0.02;
    g.strokeRect(s0 + w * 0.16, z0 + h * 0.56, w * 0.68, h * 0.34);
    g.strokeRect(s0 + w * 0.16, z0 + h * 0.1, w * 0.68, h * 0.36);
    g.strokeStyle = R.css(col, 1.2); g.lineWidth = 0.01;
    g.strokeRect(s0 + w * 0.16 + 0.015, z0 + h * 0.56 - 0.015, w * 0.68, h * 0.34);
    g.fillStyle = '#c9b060';
    const kx = knobLeft ? s0 + w * 0.12 : s1 - w * 0.12;
    g.beginPath(); g.arc(kx, z0 + 1.0, 0.035, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(s0, z0, w, 0.03);
  }

  function drawOpeningTile(g, i, wv, st, axis, cutH, lit) {
    const m = map, b5 = i * 5, f = finOf;
    const cut = cutH < HM;
    const top = cut ? TOPCAP_CUT : TOPCAP;
    const lo = 0.5 - T2, hi = 0.5 + T2;
    const mk = m.wallMask[i];
    // acabamento da face visível (lado sul p/ eixo x, leste p/ eixo y) e das pontas
    const fa = axis === 'x' ? f[b5 + 3] : f[b5 + 0];   // primeira metade
    const fb = axis === 'x' ? f[b5 + 1] : f[b5 + 2];   // segunda metade
    const exA = finExt(fa), exB = finExt(fb);
    const open = !!(st & WS.OPEN), broken = !!(st & WS.BROKEN), curtain = !!(st & WS.CURTAIN);
    const bar = (st & WS.BARRICADE_MASK) >> WS.BARRICADE_SHIFT;
    const key = staticKey[i] || '';
    // paredes perpendiculares (raras) atrás
    if (axis === 'x' && (mk & 1)) wbox(g, lo, hi, 0, lo, 0, cutH, { e: f[b5 + 0], top });
    if (axis === 'y' && (mk & 8)) wbox(g, 0, lo, lo, hi, 0, cutH, { s: f[b5 + 3], top });
    const zc = (z) => Math.min(z, cutH);
    if (wv === W.DOOR) {
      const o0 = 0.13, o1 = 0.87, zTop = 2.05;
      const ext = key.indexOf('|e') >= 0;
      const colIdx = +(key.split('|')[2] || 'i0').slice(1) || 0;
      const col = R.hex(ext ? DOOR_EXT[colIdx % 6] : DOOR_INT[colIdx % 6]);
      abox(g, axis, -0.014, o0, lo, hi, 0, cutH, fa, TRIM, top, exA);
      // folha fechada/quebrada fica no plano; aberta gira 90° para o lado da câmera
      if (!open && !broken) {
        const z1 = zc(zTop);
        if (axis === 'x') wbox(g, o0, o1, 0.5 - 0.03, 0.5 + 0.03, 0, z1, { s: (gg, u0, u1, zz0, zz1) => doorLeafDeco(gg, u0, u1, zz0, zTop, col, false, ext), top: R.css(col, 0.7) });
        else wbox(g, 0.5 - 0.03, 0.5 + 0.03, o0, o1, 0, z1, { e: (gg, u0, u1, zz0, zz1) => doorLeafDeco(gg, u0, u1, zz0, zTop, col, true, ext), top: R.css(col, 0.7) });
      }
      if (broken) {
        // restos lascados junto à dobradiça + pedaço caído
        g.save(); planeT(g, axis, 0.5);
        g.fillStyle = R.css(col, 0.8);
        g.beginPath(); g.moveTo(o0, 0); g.lineTo(o0 + 0.14, 0); g.lineTo(o0 + 0.1, 0.4); g.lineTo(o0 + 0.18, 0.7); g.lineTo(o0 + 0.08, 1.1);
        g.lineTo(o0 + 0.16, 1.5); g.lineTo(o0 + 0.06, zc(zTop)); g.lineTo(o0, zc(zTop)); g.closePath(); g.fill();
        g.fillStyle = R.css(col, 0.6);
        g.beginPath(); g.moveTo(o1, 0); g.lineTo(o1 - 0.2, 0); g.lineTo(o1 - 0.12, 0.25); g.lineTo(o1 - 0.2, 0.5); g.lineTo(o1, 0.62); g.closePath(); g.fill();
        g.restore();
      }
      if (!cut) abox(g, axis, o0, o1, lo, hi, zTop, HM, fa, null, top, exA);
      // batente (moldura) na face visível
      if (!cut) {
        g.save(); planeT(g, axis, hi + 0.004);
        g.fillStyle = ext ? TRIM : '#d8d2c6';
        g.fillRect(o0 - 0.06, 0, 0.06, zTop + 0.06); g.fillRect(o1, 0, 0.06, zTop + 0.06); g.fillRect(o0 - 0.06, zTop, o1 - o0 + 0.12, 0.06);
        g.restore();
      }
      if (!cut && key.endsWith('|L')) { // arandela ao lado da porta, na divisa do tile (acesa à noite: halo em render.js)
        g.save(); planeT(g, axis, hi + 0.006);
        g.fillStyle = '#23211f'; g.fillRect(-0.05, 1.56, 0.1, 0.3);
        g.fillStyle = '#eadfb8'; g.fillRect(-0.035, 1.6, 0.07, 0.18);
        g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(-0.025, 1.68, 0.02, 0.07);
        g.fillStyle = '#1a1816'; g.fillRect(-0.06, 1.84, 0.12, 0.035); g.fillRect(-0.045, 1.53, 0.09, 0.035);
        g.restore();
      }
      abox(g, axis, o1, 1.014, lo, hi, 0, cutH, fb, (mk & (axis === 'x' ? 2 : 4)) ? null : fb, top, exB);
      if (open && !broken) {
        const z1 = zc(zTop), L = o1 - o0;
        if (axis === 'x') wbox(g, o0 - 0.05, o0, 0.5, 0.5 + L, 0, z1, { e: (gg, u0, u1, zz0) => doorLeafDeco(gg, u0, u1, zz0, zTop, col, true, ext), s: R.css(col, 0.6), top: R.css(col, 0.7) });
        else wbox(g, 0.5, 0.5 + L, o0 - 0.05, o0, 0, z1, { s: (gg, u0, u1, zz0) => doorLeafDeco(gg, u0, u1, zz0, zTop, col, false, ext), e: R.css(col, 0.6), top: R.css(col, 0.7) });
      }
      if (!cut && bar) planks(g, axis, o0, o1, 0.3, 1.9, bar, hi + 0.03);
    } else if (wv === W.WINDOW) {
      const o0 = 0.2, o1 = 0.8, zS = 0.85, zT = 2.0;
      abox(g, axis, -0.014, o0, lo, hi, 0, cutH, fa, TRIM, top, exA);
      abox(g, axis, o0, o1, lo, hi, 0, zc(zS), fa, null, cut ? top : '#d9d4c8', exA);
      if (!cut) {
        const cIdx = +(key.split('|')[3] || 0);
        const curtainCol = curtain ? R.PAL.fabric[cIdx % R.PAL.fabric.length] : null;
        g.save(); planeT(g, axis, 0.5);
        if (broken) {
          if (curtainCol) glass(g, o0, o1, zS, zT, lit, 0, curtainCol);
          shards(g, o0, o1, zS, zT, i);
        } else if (open) {
          glass(g, o0, o1, (zS + zT) / 2, zT, lit, 1, curtainCol);
          if (curtainCol) glass(g, o0, o1, zS, (zS + zT) / 2, lit, 0, curtainCol);
          g.fillStyle = TRIM; g.fillRect(o0, (zS + zT) / 2 - 0.03, o1 - o0, 0.05);
        } else {
          glass(g, o0, o1, zS, zT, lit, 1, curtainCol);
          g.fillStyle = TRIM; g.fillRect(o0, (zS + zT) / 2 - 0.025, o1 - o0, 0.05);
          g.fillRect((o0 + o1) / 2 - 0.015, zS, 0.03, zT - zS);
        }
        g.restore();
        abox(g, axis, o0, o1, lo, hi, zT, HM, fa, null, top, exA);
        // moldura e peitoril
        g.save(); planeT(g, axis, hi + 0.004);
        g.fillStyle = TRIM;
        g.fillRect(o0 - 0.05, zS, 0.05, zT - zS + 0.05); g.fillRect(o1, zS, 0.05, zT - zS + 0.05); g.fillRect(o0 - 0.05, zT, o1 - o0 + 0.1, 0.06);
        g.restore();
        abox(g, axis, o0 - 0.07, o1 + 0.07, hi, hi + 0.06, zS - 0.06, zS, '#d8d3c8', '#ece8de', '#f2eee6', false);
      }
      abox(g, axis, o1, 1.014, lo, hi, 0, cutH, fb, (mk & (axis === 'x' ? 2 : 4)) ? null : fb, top, exB);
      if (!cut && !broken && !open && !bar && key.endsWith('|A')) { // ar-condicionado de janela
        const acF = (gg, u0, u1, zz0, zz1) => {
          gg.fillStyle = '#b8bab6'; gg.fillRect(u0, zz0, u1 - u0, zz1 - zz0);
          gg.fillStyle = 'rgba(40,44,46,0.55)';
          for (let z = zz0 + 0.06; z < zz1 - 0.04; z += 0.05) gg.fillRect(u0 + 0.04, z, (u1 - u0) * 0.55, 0.02);
          gg.fillStyle = 'rgba(90,70,50,0.35)'; gg.fillRect(u0, zz0, u1 - u0, 0.03);
        };
        abox(g, axis, 0.28, 0.72, hi, hi + 0.3, zS + 0.02, zS + 0.34, acF, '#a6a8a4', '#c8cac6', false);
      }
      if (!cut && bar) planks(g, axis, o0, o1, zS - 0.05, zT + 0.05, bar, hi + 0.08);
    } else if (wv === W.GLASS) {
      const parts = key.split('|');
      const a = parts[2] ? +parts[2][0] : 0, bb = parts[2] ? +parts[2][1] : 0;
      const o0 = a ? 0 : 0.06, o1 = bb ? 1 : 0.94, zS = 0.3, zT = 2.15;
      const frame = '#3b3e42';
      if (!a) abox(g, axis, -0.014, o0, lo, hi, 0, cutH, fa, frame, top, exA);
      abox(g, axis, o0 - (a ? 0.014 : 0), o1 + (bb ? 0.014 : 0), lo, hi, 0, zc(zS), fa, null, cut ? top : '#4a4d50', exA);
      if (!cut) {
        g.save(); planeT(g, axis, 0.5);
        if (broken) shards(g, o0, o1, zS, zT, i * 3);
        else glass(g, o0, o1, zS, zT, lit, 0.95, curtain ? '#8a8a82' : null);
        g.fillStyle = frame;
        g.fillRect(o0, zS, o1 - o0, 0.05); g.fillRect(o0, zT - 0.05, o1 - o0, 0.05);
        if (!a) g.fillRect(o0, zS, 0.04, zT - zS);
        if (!bb) g.fillRect(o1 - 0.04, zS, 0.04, zT - zS);
        if (a) g.fillRect(0, zS, 0.025, zT - zS);
        g.restore();
        abox(g, axis, o0, o1, lo, hi, zT, HM, fa, null, top, exA);
      }
      if (!bb) abox(g, axis, o1, 1.014, lo, hi, 0, cutH, fb, (mk & (axis === 'x' ? 2 : 4)) ? null : fb, top, exB);
      if (!cut && bar) planks(g, axis, o0, o1, 0.4, 2.0, bar, hi + 0.06);
    } else if (wv === W.GARAGE_DOOR) {
      const parts = key.split('|');
      const a = parts[2] ? +parts[2][0] : 0, bb = parts[2] ? +parts[2][1] : 0;
      const o0 = a ? 0 : 0.12, o1 = bb ? 1 : 0.88, zT = 2.1;
      const pc = R.hex(['#e2ddd2', '#cfc9bb', '#b8b2a4', '#d8d6d0'][(+parts[3] || 0) % 4]);
      if (!a) abox(g, axis, -0.014, o0, lo, hi, 0, cutH, fa, TRIM, top, exA);
      const panel = (gg, u0, u1, z0) => {
        gg.fillStyle = R.css(pc); gg.fillRect(u0, z0, u1 - u0, zT - z0);
        for (let z = 0.52; z < zT; z += 0.52) { gg.fillStyle = R.css(pc, 0.72); gg.fillRect(u0, z - 0.02, u1 - u0, 0.03); gg.fillStyle = R.css(pc, 1.1); gg.fillRect(u0, z + 0.01, u1 - u0, 0.02); }
        for (let u = 0.25; u < 1; u += 0.5) { gg.fillStyle = R.css(pc, 0.9); gg.fillRect(u, z0, 0.01, zT - z0); }
        gg.fillStyle = 'rgba(0,0,0,0.2)'; gg.fillRect(u0, 0, u1 - u0, 0.04);
      };
      if (!open && !broken) {
        if (axis === 'x') wbox(g, o0, o1, 0.5 - 0.03, 0.5 + 0.03, 0, zc(zT), { s: panel, top: R.css(pc, 0.7) });
        else wbox(g, 0.5 - 0.03, 0.5 + 0.03, o0, o1, 0, zc(zT), { e: panel, top: R.css(pc, 0.7) });
      } else if (broken) {
        g.save(); planeT(g, axis, 0.5);
        panel(g, o0, o1, 1.05);
        g.fillStyle = R.css(pc, 0.8);
        g.beginPath(); g.moveTo(o0, 1.05); g.lineTo(o0 + 0.3, 0.7); g.lineTo(o0 + 0.5, 0.95); g.lineTo(o1, 0.6); g.lineTo(o1, 1.05); g.closePath(); g.fill();
        g.restore();
      } else if (!cut) {
        g.save(); planeT(g, axis, 0.5); g.fillStyle = R.css(pc, 0.75); g.fillRect(o0, zT - 0.14, o1 - o0, 0.14); g.restore();
      }
      if (!cut) abox(g, axis, o0, o1, lo, hi, zT, HM, fa, null, top, exA);
      if (!bb) abox(g, axis, o1, 1.014, lo, hi, 0, cutH, fb, (mk & (axis === 'x' ? 2 : 4)) ? null : fb, top, exB);
      if (!cut && bar) planks(g, axis, o0, o1, 0.3, 1.8, bar, hi + 0.03);
    }
    if (axis === 'x' && (mk & 4)) wbox(g, lo, hi, hi, 1, 0, cutH, { e: f[b5 + 2], top });
    if (axis === 'y' && (mk & 2)) wbox(g, hi, 1, lo, hi, 0, cutH, { s: f[b5 + 1], top });
  }

  // ---- Cercas / sebes / portões ----
  const FENCE_WOODS = ['#8a6e50', '#7e6448', '#937658', '#86694c'];
  function woodFence(g, mk, v, ext, broken, i) {
    const col = R.hex(FENCE_WOODS[v & 3]);
    const H = 1.3, rng = U.rng(i * 7 + 1);
    const lo = 0.5 - 0.035, hi = 0.5 + 0.035;
    const run = (axis, s0, s1) => {
      // travessas atrás, tábuas na frente
      for (const z of [0.3, 1.0]) abox(g, axis, s0, s1, lo - 0.03, lo, z, z + 0.08, R.css(col, 0.7), null, R.css(col, 0.8));
      for (let s = s0; s < s1 - 0.02; s += 0.125) {
        if (broken && rng() < 0.4) continue;
        const h = H - (broken && rng() < 0.3 ? 0.5 * rng() : 0) - R.hash((s * 8) | 0, i, 9) * 0.05;
        const c = R.jitter(col, 0.18, R.hash((s * 8) | 0, i, 3));
        abox(g, axis, s, Math.min(s1, s + 0.11), lo, hi, 0.02, h, R.css(c), R.css(c, 0.85), R.css(c, 1.15));
      }
    };
    const e = (bit) => (ext & bit ? 0.5 : 0);
    if (mk & 1) run('y', -e(1), 0.5);
    if (mk & 8) run('x', -e(8), 0.5);
    abox(g, 'x', 0.45, 0.55, 0.45, 0.55, 0, H + 0.08, R.css(col, 0.85), R.css(col, 0.95), R.css(col, 1.1));
    if (mk & 2) run('x', 0.55, 1 + e(2));
    if (mk & 4) run('y', 0.55, 1 + e(4));
    if (!mk) abox(g, 'x', 0.3, 0.7, 0.45, 0.55, 0.02, 1.2, R.css(col), R.css(col, 0.85), R.css(col, 1.1));
  }
  function mesh(g, s0, s1, z0, z1, alpha) {
    g.save(); g.beginPath(); g.rect(s0, z0, s1 - s0, z1 - z0); g.clip();
    g.strokeStyle = 'rgba(170,176,178,' + alpha + ')'; g.lineWidth = 0.012;
    g.beginPath();
    for (let k = -2; k < 3; k += 0.09) { g.moveTo(s0 + k, z0); g.lineTo(s0 + k + (z1 - z0), z1); g.moveTo(s0 + k, z1); g.lineTo(s0 + k + (z1 - z0), z0); }
    g.stroke();
    g.restore();
  }
  function metalFence(g, mk, ext, broken, i) {
    const H = 1.55;
    const lo = 0.5 - 0.02, hi = 0.5 + 0.02;
    const run = (axis, s0, s1) => {
      g.save(); planeT(g, axis, 0.5);
      if (broken) {
        mesh(g, s0, s1, 0.02, H * 0.5, 0.5);
        mesh(g, s0, s0 + (s1 - s0) * 0.4, H * 0.5, H, 0.5);
      } else mesh(g, s0, s1, 0.02, H, 0.5);
      g.restore();
      abox(g, axis, s0, s1, lo - 0.01, hi + 0.01, H - 0.05, H, '#9aa2a6', '#aab2b6', '#c2c8cc');
    };
    const e = (bit) => (ext & bit ? 0.5 : 0);
    if (mk & 1) run('y', -e(1), 0.5);
    if (mk & 8) run('x', -e(8), 0.5);
    const p = [0.5, 0.5];
    const px = (p[0] - p[1]) * 32, py = (p[0] + p[1]) * 16;
    const gr = g.createLinearGradient(px - 2, 0, px + 2, 0);
    gr.addColorStop(0, '#6e767a'); gr.addColorStop(0.4, '#c8ced2'); gr.addColorStop(1, '#6a7276');
    g.fillStyle = gr; g.fillRect(px - 1.8, py - (H + 0.1) * ZPX, 3.6, (H + 0.1) * ZPX);
    g.fillStyle = '#8a9296'; g.beginPath(); g.ellipse(px, py - (H + 0.1) * ZPX, 1.8, 0.9, 0, 0, 6.283); g.fill();
    if (mk & 2) run('x', 0.5, 1 + e(2));
    if (mk & 4) run('y', 0.5, 1 + e(4));
  }
  const HEDGE_G = ['#3f5a2c', '#4a6632', '#35502a', '#56703a', '#2f4724', '#62783f', '#44602e'];
  function hedge(g, mk, v, ext, broken, i) {
    const H = broken ? 0.7 : 1.35;
    const w = 0.34;
    const lo = 0.5 - w, hi = 0.5 + w;
    const base = R.hex('#2c4424');
    const rng = U.rng(i * 13 + 5);
    const boxes = [];
    const e = (bit) => (ext & bit ? 0.5 - w : 0);
    if (mk & 1) boxes.push([lo, hi, -e(1) - 0.02, lo]);
    if (mk & 8) boxes.push([-e(8) - 0.02, lo, lo, hi]);
    boxes.push([lo, hi, lo, hi]);
    if (mk & 2) boxes.push([hi, 1 + e(2) + 0.02, lo, hi]);
    if (mk & 4) boxes.push([lo, hi, hi, 1 + e(4) + 0.02]);
    const P = (x, y, z) => [(x - y) * 32, (x + y) * 16 - z * ZPX];
    for (const [x0, x1, y0, y1] of boxes) {
      const hh = H - 0.08;
      wbox(g, x0, x1, y0, y1, 0, hh, { s: R.css(base, 0.78), e: R.css(base, 0.9), top: R.css(base, 1.05), sb: 1, eb: 1 });
      // folhas: camadas de tufos pequenos (topo mais claro, face sul mais escura), silhueta irregular
      const area = (x1 - x0) + (y1 - y0);
      const n = Math.round(area * 95);
      for (let k = 0; k < n; k++) {
        const r = rng();
        let x, y, z, lit;
        if (r < 0.42) { x = x0 + rng() * (x1 - x0); y = y0 + rng() * (y1 - y0); z = hh + rng() * 0.12; lit = 1.18; }
        else if (r < 0.72) { x = x0 + rng() * (x1 - x0); y = y1 + 0.01; z = rng() * hh; lit = 0.72 + z / hh * 0.25; }
        else { x = x1 + 0.01; y = y0 + rng() * (y1 - y0); z = rng() * hh; lit = 0.86 + z / hh * 0.2; }
        const p = P(x, y, z);
        const c = R.hex(HEDGE_G[(rng() * HEDGE_G.length) | 0]);
        g.fillStyle = R.css(c, lit * (0.88 + rng() * 0.24));
        const rr = 1.1 + rng() * 1.5;
        g.beginPath(); g.ellipse(p[0], p[1], rr, rr * 0.75, rng() * 3, 0, 6.283); g.fill();
      }
      // realces no topo
      for (let k = 0; k < area * 18; k++) {
        const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0), p = P(x, y, hh + 0.08 + rng() * 0.06);
        g.fillStyle = R.css(HEDGE_G[5], 1.35, 0.8); g.fillRect(p[0] - 0.7, p[1] - 0.5, 1.4, 1);
      }
    }
    if (broken) {
      g.strokeStyle = '#4a3a28'; g.lineWidth = 0.8;
      for (let k = 0; k < 7; k++) { const x = 0.2 + rng() * 0.6, y = 0.2 + rng() * 0.6; const p = P(x, y, H); g.beginPath(); g.moveTo(p[0], p[1] + 2); g.lineTo(p[0] + (rng() - 0.5) * 6, p[1] - 5); g.stroke(); }
    }
  }
  function fenceGate(g, i, st, axis, style) {
    const open = !!(st & WS.OPEN), broken = !!(st & WS.BROKEN);
    const metal = style === 1;
    const H = metal ? 1.5 : 1.25;
    const col = R.hex(metal ? '#8a9296' : '#8a6e50');
    const post = (s) => abox(g, axis, s - 0.05, s + 0.05, 0.45, 0.55, 0, H + 0.1, R.css(col, 0.85), R.css(col, 0.95), R.css(col, 1.1));
    post(0.05);
    const leaf = (gg, u0, u1, z0) => {
      if (metal) {
        gg.strokeStyle = R.css(col); gg.lineWidth = 0.05; gg.strokeRect(u0 + 0.03, 0.08, u1 - u0 - 0.06, H - 0.14);
        mesh(gg, u0 + 0.05, u1 - 0.05, 0.1, H - 0.08, 0.55);
      } else {
        for (let u = u0; u < u1 - 0.02; u += 0.13) { gg.fillStyle = R.css(R.jitter(col, 0.2, R.hash((u * 9) | 0, i, 5))); gg.fillRect(u + 0.01, 0.05, 0.11, H - 0.1 - ((u * 7) % 1) * 0.04); }
        gg.fillStyle = R.css(col, 0.7); gg.fillRect(u0, 0.3, u1 - u0, 0.07); gg.fillRect(u0, H - 0.4, u1 - u0, 0.07);
        gg.save(); gg.strokeStyle = R.css(col, 0.7); gg.lineWidth = 0.06; gg.beginPath(); gg.moveTo(u0 + 0.05, 0.35); gg.lineTo(u1 - 0.05, H - 0.38); gg.stroke(); gg.restore();
      }
    };
    const L = 0.8;
    if (!open && !broken) {
      g.save(); planeT(g, axis, 0.5); leaf(g, 0.1, 0.9, 0); g.restore();
    } else if (broken) {
      g.save(); planeT(g, axis, 0.5); g.globalAlpha = 0.9; leaf(g, 0.1, 0.35, 0); g.restore();
    }
    post(0.95);
    if (open && !broken) {
      g.save();
      if (axis === 'x') { g.transform(-32, 16, 0, -ZPX, 0.1 * 32, 0.1 * 16); g.translate(-0.5, 0); leaf(g, 0.5, 0.5 + L, 0); }
      else { g.transform(32, 16, 0, -ZPX, -0.1 * 32, 0.1 * 16); g.translate(0, 0); leaf(g, 0.5, 0.5 + L, 0); }
      g.restore();
    }
  }

  // Monta (ou busca) o sprite de um tile de parede.
  // cut: 0 inteiro, 1 recortado. lit: janela acesa.
  RW.sprite = function (i, cut, lit) {
    const m = map, wv = m.wall[i];
    let sk = staticKey[i];
    if (sk === undefined || sk === null) { RW.updateTile(i); sk = staticKey[i]; if (!sk) return null; }
    const st = m.wallState[i];
    const fence = isFence(wv);
    const key = sk + '|' + st + '|' + (fence ? 0 : cut ? 1 : 0) + (lit ? 'L' : '');
    const cache = caches[S];
    let spr = cache.get(key);
    if (spr) return spr;
    // orçamento esgotado: usa o mesmo sprite em outra escala (esticado) se houver
    if (RW.budget <= 0) {
      for (const k in caches) { if (+k === S) continue; const alt = caches[k].peek(key); if (alt) return alt; }
      if (RW.budget < -RW.hardCap) return null; // teto rígido: o resto aparece nos próximos quadros
    }
    const t0 = performance.now();
    const mk = m.wallMask[i];
    const openDoor = (wv === W.DOOR || wv === W.FENCE_GATE) && (st & WS.OPEN);
    const hPx = fence ? 64 : (cut ? CUT_M : HM) * ZPX + 6;
    spr = newSprite(openDoor ? 60 : 48, openDoor ? 60 : 48, Math.ceil(hPx) + 4, openDoor ? 34 : 18);
    const g = spr.g;
    const cutH = cut ? CUT_M : HM;
    const wi = sk.indexOf('|w');
    wearV = wi >= 0 ? +sk.slice(wi + 2) || 0 : 0;
    if (isStruct(wv)) drawPlainWall(g, i, mk, cutH);
    else if (isOpening(wv)) drawOpeningTile(g, i, wv, st, axisOf(i), cutH, lit);
    else if (wv === W.FENCE_WOOD) woodFence(g, mk, +sk.split('|')[1] || 0, +sk.split('|')[2] || 0, !!(st & WS.BROKEN), i);
    else if (wv === W.FENCE_METAL) metalFence(g, mk, +sk.split('|')[2] || 0, !!(st & WS.BROKEN), i);
    else if (wv === W.HEDGE) hedge(g, mk, +sk.split('|')[1] || 0, +sk.split('|')[2] || 0, !!(st & WS.BROKEN), i);
    else if (wv === W.FENCE_GATE) fenceGate(g, i, st, axisOf(i), +sk.split('|')[1] || 0);
    wearV = 0;
    delete spr.g;
    cache.set(key, spr);
    const dtg = performance.now() - t0;
    RW.budget -= dtg; RW.stats.gen++; RW.stats.ms += dtg;
    return spr;
  };
  RW.spriteCount = () => caches[S].size;
  RW.axisOf = axisOf;
  RW.isStruct = isStruct;
  RW.isOpening = isOpening;

  // ------------------------------------------------------------------
  // Telhados
  // ------------------------------------------------------------------
  RW.roofs = [];      // por prédio: { b, parts:[{faces, hull, x0,y0,x1,y1}], hull, zTop, chimney }
  const OV = 0.32, PITCH = 0.55;
  function buildRoofs() {
    RW.roofs = [];
    const m = map;
    for (const b of m.buildings) {
      const parts = (b.parts && b.parts.length ? b.parts : [{ x: b.x, y: b.y, w: b.w, h: b.h, ridgeAxis: b.ridgeAxis || (b.w >= b.h ? 'x' : 'y') }]);
      const rf = { b, parts: [], type: b.roofType || 'flat', col: R.hex(b.roofColor || '#555555'), metal: b.type === 'barn' || b.type === 'warehouse' || b.type === 'fire_station', hull: null, minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
      // partes em ordem de profundidade (fundo → frente)
      const ps = parts.map((p) => Object.assign({}, p)).sort((a, c) => (a.x + a.w + a.y + a.h) - (c.x + c.w + c.y + c.h));
      let big = 0;
      for (const p of ps) big = Math.max(big, Math.min(p.w, p.h));
      for (const p of ps) {
        const part = makePart(p, rf, big);
        rf.parts.push(part);
        rf.minX = Math.min(rf.minX, part.x0); rf.minY = Math.min(rf.minY, part.y0); rf.maxX = Math.max(rf.maxX, part.x1); rf.maxY = Math.max(rf.maxY, part.y1);
      }
      const pts = [];
      for (const part of rf.parts) for (let k = 0; k < part.hull.length; k++) pts.push(part.hull[k]);
      rf.hull = R.hull(pts);
      rf.key = rf.maxX + rf.maxY;
      RW.roofs.push(rf);
    }
  }
  function P3(x, y, z) { return [(x - y) * 32, (x + y) * 16 - z * ZPX]; }
  function finishFaces(faces, x0, y0, x1, y1) {
    for (const f of faces) {
      const q = f.pts;
      let nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < q.length; k++) {
        const a = q[k], c = q[(k + 1) % q.length];
        nx += (a[1] - c[1]) * (a[2] + c[2]); ny += (a[2] - c[2]) * (a[0] + c[0]); nz += (a[0] - c[0]) * (a[1] + c[1]);
      }
      // orienta para fora/para cima
      let cx = 0, cy = 0; for (const a of q) { cx += a[0]; cy += a[1]; } cx /= q.length; cy /= q.length;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      if (f.kind === 'slope' || f.kind === 'flat' || f.kind === 'rim') { if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; } }
      else if (f.kind === 'innerN') { nx = 0; ny = 1; nz = 0; }
      else if (f.kind === 'innerW') { nx = 1; ny = 0; nz = 0; }
      else if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      f.vis = R.faceVisible(nx, ny, nz);
      f.bright = R.faceBright(nx, ny, nz);
      f.n = [nx, ny, nz];
      f.scr = [];
      for (const a of q) { const s = P3(a[0], a[1], a[2]); f.scr.push(s[0], s[1]); }
    }
  }
  function makePart(p, rf, big) {
    const type = rf.type;
    const wx0 = p.x + 0.5, wx1 = p.x + p.w - 0.5, wy0 = p.y + 0.5, wy1 = p.y + p.h - 0.5; // linha das paredes
    const faces = [];
    const zE = HM;
    let x0, x1, y0, y1;
    if (type === 'flat') {
      x0 = wx0 - T2; x1 = wx1 + T2; y0 = wy0 - T2; y1 = wy1 + T2;
      const zT = zE + 0.32;
      faces.push({ kind: 'parapetS', pts: [[x0, y1, zE - 0.02], [x1, y1, zE - 0.02], [x1, y1, zT], [x0, y1, zT]] });
      faces.push({ kind: 'parapetE', pts: [[x1, y0, zE - 0.02], [x1, y1, zE - 0.02], [x1, y1, zT], [x1, y0, zT]] });
      faces.push({ kind: 'rim', pts: [[x0, y0, zT], [x1, y0, zT], [x1, y1, zT], [x0, y1, zT]] });
      const ins = 0.16, zS = zE + 0.12;
      faces.push({ kind: 'flat', pts: [[x0 + ins, y0 + ins, zS], [x1 - ins, y0 + ins, zS], [x1 - ins, y1 - ins, zS], [x0 + ins, y1 - ins, zS]] });
      faces.push({ kind: 'innerN', pts: [[x0 + ins, y0 + ins, zS], [x1 - ins, y0 + ins, zS], [x1 - ins, y0 + ins, zT], [x0 + ins, y0 + ins, zT]] });
      faces.push({ kind: 'innerW', pts: [[x0 + ins, y0 + ins, zS], [x0 + ins, y1 - ins, zS], [x0 + ins, y1 - ins, zT], [x0 + ins, y0 + ins, zT]] });
      // equipamentos (ar-condicionado, dutos) em prédios comerciais
      const units = [];
      const b = rf.b;
      if (b.type !== 'house' && b.type !== 'shed' && p.w >= 6 && p.h >= 6) {
        const n = 1 + ((R.hash(b.id, p.x, 31) * 3) | 0);
        for (let k = 0; k < n; k++) {
          const ux = x0 + 1 + R.hash(b.id, k, 32) * (x1 - x0 - 2.5), uy = y0 + 1 + R.hash(b.id, k, 33) * (y1 - y0 - 2.5);
          units.push({ x: ux, y: uy, w: 1.1, h: 0.8, z: zS, hgt: 0.6, kind: 'ac' });
        }
        units.push({ x: x0 + 0.8 + R.hash(b.id, 9, 34) * (x1 - x0 - 1.6), y: y0 + 0.8 + R.hash(b.id, 9, 35) * (y1 - y0 - 1.6), w: 0.3, h: 0.3, z: zS, hgt: 0.5, kind: 'vent' });
        // duto saindo do primeiro equipamento até a borda
        const u0 = units[0];
        if (R.hash(b.id, 4, 36) < 0.7) {
          if (R.hash(b.id, 5, 37) < 0.5) units.push({ x: x0 + ins + 0.05, y: u0.y + 0.25, w: Math.max(0.3, u0.x - x0 - ins - 0.05), h: 0.3, z: zS, hgt: 0.3, kind: 'duct' });
          else units.push({ x: u0.x + 0.4, y: y0 + ins + 0.05, w: 0.3, h: Math.max(0.3, u0.y - y0 - ins - 0.05), z: zS, hgt: 0.3, kind: 'duct' });
        }
      }
      // claraboias
      if (p.w >= 5 && p.h >= 5 && R.hash(b.id, p.y, 38) < 0.65) {
        const n = 1 + ((R.hash(b.id, 6, 39) * (p.w * p.h > 60 ? 3 : 1.6)) | 0);
        for (let k = 0; k < n; k++) {
          const sx = x0 + 1 + R.hash(b.id, k, 40) * (x1 - x0 - 2.6), sy = y0 + 1 + R.hash(b.id, k, 41) * (y1 - y0 - 2.4);
          if (units.some((u) => sx < u.x + u.w + 0.2 && sx + 1.2 > u.x - 0.2 && sy < u.y + u.h + 0.2 && sy + 0.9 > u.y - 0.2)) continue;
          units.push({ x: sx, y: sy, w: 1.2, h: 0.9, z: zS, hgt: 0.16, kind: 'sky' });
        }
      }
      units.sort((a, c) => (a.x + a.w + a.y + a.h) - (c.x + c.w + c.y + c.h));
      finishFaces(faces, x0, y0, x1, y1);
      const hullPts = [];
      for (const f of faces) for (const q of f.pts) { const s = P3(q[0], q[1], q[2]); hullPts.push(s[0], s[1]); }
      for (const u of units) { const s = P3(u.x, u.y, u.z + u.hgt); hullPts.push(s[0], s[1]); }
      return { faces, units, hull: R.hull(hullPts), x0, y0, x1, y1, zTop: zT, type };
    }
    x0 = wx0 - OV; x1 = wx1 + OV; y0 = wy0 - OV; y1 = wy1 + OV;
    const ax = p.ridgeAxis || (p.w >= p.h ? 'x' : 'y');
    const small = Math.min(p.w, p.h) < big - 0.5;
    const pitch = small ? PITCH * 0.9 : PITCH;
    const zlow = zE - OV * pitch;
    if (ax === 'x') {
      const ym = (wy0 + wy1) / 2, half = (wy1 - wy0) / 2, zr = zE + Math.min(3.4, half * pitch);
      if (type === 'hip' && x1 - x0 > y1 - y0 + 0.2) {
        const hr = (y1 - y0) / 2;
        const rx0 = x0 + hr, rx1 = x1 - hr;
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y1, zlow], [x1, y1, zlow], [rx1, ym, zr], [rx0, ym, zr]] });
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y0, zlow], [x1, y0, zlow], [rx1, ym, zr], [rx0, ym, zr]] });
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x1, y0, zlow], [x1, y1, zlow], [rx1, ym, zr]] });
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x0, y0, zlow], [x0, y1, zlow], [rx0, ym, zr]] });
        faces.ridge = [[rx0, ym, zr], [rx1, ym, zr]];
        faces.hips = [[[x0, y0, zlow], [rx0, ym, zr]], [[x0, y1, zlow], [rx0, ym, zr]], [[x1, y0, zlow], [rx1, ym, zr]], [[x1, y1, zlow], [rx1, ym, zr]]];
      } else if (type === 'hip') {
        const c = [(x0 + x1) / 2, ym, zr];
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y1, zlow], [x1, y1, zlow], c] });
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y0, zlow], [x1, y0, zlow], c] });
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x1, y0, zlow], [x1, y1, zlow], c] });
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x0, y0, zlow], [x0, y1, zlow], c] });
        faces.hips = [[[x0, y0, zlow], c], [[x0, y1, zlow], c], [[x1, y0, zlow], c], [[x1, y1, zlow], c]];
      } else {
        faces.push({ kind: 'gable', pts: [[wx1 + T2, wy0, zE], [wx1 + T2, wy1, zE], [wx1 + T2, ym, zr - 0.05]] });
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y0, zlow], [x1, y0, zlow], [x1, ym, zr], [x0, ym, zr]] });
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y1, zlow], [x1, y1, zlow], [x1, ym, zr], [x0, ym, zr]] });
        faces.push({ kind: 'rake', pts: [[x1, y0, zlow], [x1, ym, zr], [x1, ym, zr + 0.12], [x1, y0, zlow + 0.12]] });
        faces.push({ kind: 'rake', pts: [[x1, y1, zlow], [x1, ym, zr], [x1, ym, zr + 0.12], [x1, y1, zlow + 0.12]] });
        faces.ridge = [[x0, ym, zr], [x1, ym, zr]];
      }
      faces.push({ kind: 'fascia', pts: [[x0, y1, zlow - 0.1], [x1, y1, zlow - 0.1], [x1, y1, zlow], [x0, y1, zlow]] });
      faces.zr = zr;
    } else {
      const xm = (wx0 + wx1) / 2, half = (wx1 - wx0) / 2, zr = zE + Math.min(3.4, half * pitch);
      if (type === 'hip' && y1 - y0 > x1 - x0 + 0.2) {
        const hr = (x1 - x0) / 2;
        const ry0 = y0 + hr, ry1 = y1 - hr;
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x1, y0, zlow], [x1, y1, zlow], [xm, ry1, zr], [xm, ry0, zr]] });
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x0, y0, zlow], [x0, y1, zlow], [xm, ry1, zr], [xm, ry0, zr]] });
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y1, zlow], [x1, y1, zlow], [xm, ry1, zr]] });
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y0, zlow], [x1, y0, zlow], [xm, ry0, zr]] });
        faces.ridge = [[xm, ry0, zr], [xm, ry1, zr]];
        faces.hips = [[[x0, y0, zlow], [xm, ry0, zr]], [[x1, y0, zlow], [xm, ry0, zr]], [[x0, y1, zlow], [xm, ry1, zr]], [[x1, y1, zlow], [xm, ry1, zr]]];
      } else if (type === 'hip') {
        const c = [xm, (y0 + y1) / 2, zr];
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x1, y0, zlow], [x1, y1, zlow], c] });
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x0, y0, zlow], [x0, y1, zlow], c] });
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y1, zlow], [x1, y1, zlow], c] });
        faces.push({ kind: 'slope', eave: [1, 0, 0], pts: [[x0, y0, zlow], [x1, y0, zlow], c] });
        faces.hips = [[[x0, y0, zlow], c], [[x0, y1, zlow], c], [[x1, y0, zlow], c], [[x1, y1, zlow], c]];
      } else {
        faces.push({ kind: 'gable', pts: [[wx0, wy1 + T2, zE], [wx1, wy1 + T2, zE], [xm, wy1 + T2, zr - 0.05]] });
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x0, y0, zlow], [x0, y1, zlow], [xm, y1, zr], [xm, y0, zr]] });
        faces.push({ kind: 'slope', eave: [0, 1, 0], pts: [[x1, y0, zlow], [x1, y1, zlow], [xm, y1, zr], [xm, y0, zr]] });
        faces.push({ kind: 'rake', pts: [[x0, y1, zlow], [xm, y1, zr], [xm, y1, zr + 0.12], [x0, y1, zlow + 0.12]] });
        faces.push({ kind: 'rake', pts: [[x1, y1, zlow], [xm, y1, zr], [xm, y1, zr + 0.12], [x1, y1, zlow + 0.12]] });
        faces.ridge = [[xm, y0, zr], [xm, y1, zr]];
      }
      faces.push({ kind: 'fascia', pts: [[x1, y0, zlow - 0.1], [x1, y1, zlow - 0.1], [x1, y1, zlow], [x1, y0, zlow]] });
      faces.zr = zr;
    }
    finishFaces(faces, x0, y0, x1, y1);
    // chaminé em algumas casas
    let chimney = null;
    const b = rf.b;
    const p0 = b.parts && b.parts[0];
    if ((b.type === 'house' || b.type === 'cabin') && type !== 'flat' && p0 && p.x === p0.x && p.y === p0.y && p.w === p0.w && R.hash(b.id, 1, 77) < 0.55) {
      const zr = faces.zr;
      if (ax === 'x') { const cxp = x0 + 1.2 + R.hash(b.id, 2, 78) * (x1 - x0 - 2.4); chimney = { x: cxp - 0.3, y: (wy0 + wy1) / 2 - 0.55, w: 0.6, h: 0.6, z0: zr - 0.8, z1: zr + 0.7 }; }
      else { const cyp = y0 + 1.2 + R.hash(b.id, 2, 78) * (y1 - y0 - 2.4); chimney = { x: (wx0 + wx1) / 2 - 0.55, y: cyp - 0.3, w: 0.6, h: 0.6, z0: zr - 0.8, z1: zr + 0.7 }; }
    }
    const hullPts = [];
    for (const f of faces) for (let k = 0; k < f.scr.length; k++) hullPts.push(f.scr[k]);
    if (chimney) { const s = P3(chimney.x, chimney.y, chimney.z1); hullPts.push(s[0], s[1]); }
    return { faces, units: null, hull: R.hull(hullPts), x0, y0, x1, y1, zTop: faces.zr, type, chimney, ax };
  }

  // Padrões de telha (por cor e brilho)
  const patterns = new Map();
  function roofPattern(ctx, col, bright, kind) {
    const key = col.join(',') + '|' + bright.toFixed(2) + '|' + kind;
    let p = patterns.get(key);
    if (p) return p;
    const c = R.canvas(32, 16), g = c.getContext('2d');
    const rng = U.rng(col[0] * 7 + col[1] * 13 + col[2] + (kind === 'metal' ? 99 : 0));
    if (kind === 'metal') {
      g.fillStyle = R.css(col, bright); g.fillRect(0, 0, 32, 16);
      for (let x = 0; x < 32; x += 4) { g.fillStyle = R.css(col, bright * 1.15); g.fillRect(x, 0, 1.4, 16); g.fillStyle = R.css(col, bright * 0.8); g.fillRect(x + 2.2, 0, 1, 16); }
    } else if (kind === 'flat') {
      g.fillStyle = R.css(col, bright); g.fillRect(0, 0, 32, 16);
      for (let k = 0; k < 90; k++) { g.fillStyle = R.css(col, bright * (0.8 + rng() * 0.4)); g.fillRect(rng() * 32, rng() * 16, 1, 1); }
    } else {
      for (let row = 0; row < 2; row++) {
        const off = row ? 5.33 : 0;
        for (let k = -1; k < 4; k++) {
          const x = k * 10.67 + off;
          g.fillStyle = R.css(R.jitter(col, 0.16, rng()), bright);
          g.fillRect(x, row * 8, 10.67, 8);
          g.fillStyle = R.css(col, bright * 0.62); g.fillRect(x, row * 8, 0.8, 8);
        }
        const gr = g.createLinearGradient(0, row * 8, 0, row * 8 + 8);
        gr.addColorStop(0, 'rgba(0,0,0,0.28)'); gr.addColorStop(0.3, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.06)');
        g.fillStyle = gr; g.fillRect(0, row * 8, 32, 8);
      }
    }
    p = ctx.createPattern(c, 'repeat');
    patterns.set(key, p);
    return p;
  }
  const _mtx = typeof DOMMatrix !== 'undefined' ? new DOMMatrix() : null;
  function setPatternFrame(pat, O, E, Sd) {
    // padrão: 32 px = 1 m ao longo do beiral (E) e da água (Sd)
    if (!_mtx || !pat.setTransform) return;
    const e = P3(E[0], E[1], E[2]), s = P3(Sd[0], Sd[1], Sd[2]), o = P3(O[0], O[1], O[2]);
    _mtx.a = e[0] / 32; _mtx.b = e[1] / 32; _mtx.c = s[0] / 32; _mtx.d = s[1] / 32; _mtx.e = o[0]; _mtx.f = o[1];
    pat.setTransform(_mtx);
  }

  function fillPoly(ctx, scr) {
    ctx.beginPath();
    ctx.moveTo(scr[0], scr[1]);
    for (let k = 2; k < scr.length; k += 2) ctx.lineTo(scr[k], scr[k + 1]);
    ctx.closePath();
  }
  // Sprite do telhado inteiro de um prédio (cache por escala). null = orçamento esgotado.
  RW.roofSprite = function (rf) {
    const cache = roofCaches[S];
    let spr = cache.get(rf.b.id);
    if (spr) return spr;
    if (RW.roofBudget <= 0) {
      for (const k in roofCaches) { if (+k === S) continue; const alt = roofCaches[k].peek(rf.b.id); if (alt) return alt; }
      return null;
    }
    const t0 = performance.now();
    if (rf.x0 == null) boundsOf(rf);
    const pad = 4;
    const x0 = Math.floor(rf.x0) - pad, y0 = Math.floor(rf.y0) - pad, w = Math.ceil(rf.x1) + pad - x0, h = Math.ceil(rf.y1) + pad - y0;
    const c = R.canvas(w * S, h * S), g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(S, 0, 0, S, -x0 * S, -y0 * S);
    g.lineJoin = 'round';
    RW.drawRoof(g, rf, 1);
    spr = { c, x: x0, y: y0, w, h };
    cache.set(rf.b.id, spr);
    const dtg = performance.now() - t0;
    RW.roofBudget -= dtg; RW.stats.roofGen++; RW.stats.roofMs += dtg;
    return spr;
  };
  // retângulo (px isométricos) do contorno do telhado
  function boundsOf(rf) {
    const h = rf.hull;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < h.length; k += 2) { if (h[k] < x0) x0 = h[k]; if (h[k] > x1) x1 = h[k]; if (h[k + 1] < y0) y0 = h[k + 1]; if (h[k + 1] > y1) y1 = h[k + 1]; }
    rf.x0 = x0; rf.x1 = x1; rf.y0 = y0; rf.y1 = y1;
  }
  RW.roofBounds = function (rf) { if (rf.x0 == null) boundsOf(rf); return rf; };

  // Desenha o telhado de um prédio (ctx já com a câmera: px isométricos)
  RW.drawRoof = function (ctx, rf, alpha) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = alpha;
    const b = rf.b;
    const wallCol = R.hex(b.wallColor || '#b8b4a8');
    for (const part of rf.parts) {
      const faces = part.faces;
      for (const f of faces) {
        if (!f.vis) continue;
        fillPoly(ctx, f.scr);
        if (f.kind === 'slope') {
          const q = f.pts;
          // quadro do padrão: origem no primeiro ponto do beiral, E = direção do beiral, Sd = subida
          const E = f.eave;
          const a = q[0];
          const top = q[q.length - 1];
          // vetor de subida perpendicular ao beiral no plano da face
          let sx = top[0] - a[0], sy = top[1] - a[1], sz = top[2] - a[2];
          const dotE = sx * E[0] + sy * E[1];
          sx -= E[0] * dotE; sy -= E[1] * dotE;
          const l = Math.hypot(sx, sy, sz) || 1;
          const pat = roofPattern(ctx, rf.col, f.bright, rf.metal ? 'metal' : 'shingle');
          setPatternFrame(pat, a, E, [sx / l, sy / l, sz / l]);
          ctx.fillStyle = pat;
          ctx.fill();
          ctx.strokeStyle = R.css(rf.col, f.bright * 0.55, 0.8); ctx.lineWidth = 0.8; ctx.stroke();
          roofWear(ctx, rf, f, a, E, [sx / l, sy / l, sz / l], rf.metal ? 'metal' : 'shingle');
        } else if (f.kind === 'flat') {
          const pat = roofPattern(ctx, [88, 88, 86], f.bright, 'flat');
          setPatternFrame(pat, f.pts[0], [1, 0, 0], [0, 1, 0]);
          ctx.fillStyle = pat; ctx.fill();
          roofWear(ctx, rf, f, f.pts[0], [1, 0, 0], [0, 1, 0], 'flat');
        } else if (f.kind === 'rim') {
          ctx.fillStyle = R.css(R.mix(wallCol, [120, 120, 118], 0.5), f.bright); ctx.fill();
        } else if (f.kind === 'innerN' || f.kind === 'innerW') {
          ctx.fillStyle = R.css(R.mix(wallCol, [100, 100, 98], 0.6), f.bright * 0.75); ctx.fill();
        } else if (f.kind === 'gable' || f.kind === 'parapetS' || f.kind === 'parapetE') {
          ctx.fillStyle = R.css(wallCol, f.kind === 'parapetS' || (f.n && f.n[1] > 0.5) ? 0.8 : 0.96); ctx.fill();
          if (f.kind === 'gable') { // tábuas horizontais no oitão
            ctx.save(); ctx.clip();
            ctx.strokeStyle = R.css(wallCol, 0.7, 0.8); ctx.lineWidth = 1;
            const ys = f.scr;
            let ymin = 1e9, ymax = -1e9, xmin = 1e9, xmax = -1e9;
            for (let k = 0; k < ys.length; k += 2) { xmin = Math.min(xmin, ys[k]); xmax = Math.max(xmax, ys[k]); ymin = Math.min(ymin, ys[k + 1]); ymax = Math.max(ymax, ys[k + 1]); }
            ctx.beginPath();
            const dy = f.n[0] > 0.5 ? 0.5 : -0.5; // inclinação das linhas na face
            for (let y = ymin - 40; y < ymax + 40; y += 6) { ctx.moveTo(xmin, y); ctx.lineTo(xmax, y + (xmax - xmin) * dy); }
            ctx.stroke();
            ctx.restore();
          }
        } else if (f.kind === 'fascia' || f.kind === 'rake') {
          ctx.fillStyle = R.css(R.mix(rf.col, [230, 226, 216], 0.55), f.bright * 0.9); ctx.fill();
        }
      }
      // calhas nos beirais voltados para a câmera
      if (!rf.metal && part.type !== 'flat') {
        for (const f of faces) {
          if (f.kind !== 'slope' || !f.vis || !(f.n[0] > 0.3 || f.n[1] > 0.3)) continue;
          const q0 = f.pts[0], q1 = f.pts[1];
          const ox = f.n[0] > 0.3 ? 0.04 : 0, oy = f.n[1] > 0.3 ? 0.04 : 0;
          const A = P3(q0[0] + ox, q0[1] + oy, q0[2] - 0.12), B = P3(q1[0] + ox, q1[1] + oy, q1[2] - 0.12);
          ctx.lineCap = 'butt';
          ctx.strokeStyle = 'rgba(40,40,40,0.35)'; ctx.lineWidth = 3.2;
          ctx.beginPath(); ctx.moveTo(A[0], A[1] + 1); ctx.lineTo(B[0], B[1] + 1); ctx.stroke();
          ctx.strokeStyle = R.css([196, 194, 186], f.bright * 0.95); ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.moveTo(A[0], A[1] - 0.8); ctx.lineTo(B[0], B[1] - 0.8); ctx.stroke();
        }
      }
      // cumeeira e espigões
      if (faces.ridge) {
        const a = P3(...faces.ridge[0]), c = P3(...faces.ridge[1]);
        ctx.strokeStyle = R.css(rf.col, 0.55); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
        ctx.strokeStyle = R.css(rf.col, 1.25, 0.6); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(a[0], a[1] - 1); ctx.lineTo(c[0], c[1] - 1); ctx.stroke();
      }
      if (faces.hips) {
        ctx.strokeStyle = R.css(rf.col, 0.6, 0.9); ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (const [p0, p1] of faces.hips) { const a = P3(...p0), c = P3(...p1); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); }
        ctx.stroke();
      }
      if (part.chimney) drawBox(ctx, part.chimney, '#8a4e3c', true);
      if (part.units) for (const u of part.units) drawBox(ctx, { x: u.x, y: u.y, w: u.w, h: u.h, z0: u.z, z1: u.z + u.hgt }, u.kind === 'ac' ? '#9ea3a4' : u.kind === 'sky' ? '#b8b6ae' : u.kind === 'duct' ? '#8f9496' : '#6d7072', false, u.kind);
    }
    ctx.globalAlpha = 1;
  };
  // Desgaste do telhado no quadro da face (u ao longo do beiral, v subindo; metros):
  // telhas trocadas, manchas/musgo junto ao beiral, escorridos e sujeira na borda
  function roofWear(ctx, rf, f, a, E, Sd, kind) {
    const e = P3(E[0], E[1], E[2]), sv = P3(Sd[0], Sd[1], Sd[2]), o = P3(a[0], a[1], a[2]);
    let umin = 1e9, umax = -1e9, vmax = 0;
    for (const q of f.pts) {
      const dx = q[0] - a[0], dy = q[1] - a[1], dz = q[2] - a[2];
      const u = dx * E[0] + dy * E[1] + dz * E[2], v = dx * Sd[0] + dy * Sd[1] + dz * Sd[2];
      if (u < umin) umin = u; if (u > umax) umax = u; if (v > vmax) vmax = v;
    }
    const W = umax - umin;
    if (W < 0.2 || vmax < 0.2) return;
    ctx.save();
    fillPoly(ctx, f.scr); ctx.clip();
    ctx.transform(e[0], e[1], sv[0], sv[1], o[0], o[1]);
    const rng = U.rng(rf.b.id * 131 + ((a[0] * 7 + a[1] * 13) | 0));
    const br = f.bright;
    if (kind === 'shingle') {
      const n = (W * vmax * 0.35) | 0;
      for (let k = 0; k < n; k++) {
        const row = Math.floor(rng() * vmax / 0.25), off = row & 1 ? 0.1667 : 0;
        const u = Math.floor((umin + rng() * W - off) / 0.3333) * 0.3333 + off;
        ctx.fillStyle = R.css(R.jitter(rf.col, 0.55, rng()), br * (0.78 + rng() * 0.4));
        ctx.fillRect(u + 0.02, row * 0.25 + 0.03, 0.3, 0.22);
      }
      // musgo/liquens em manchas (mais perto do beiral)
      const nm = 2 + ((rng() * 4) | 0);
      for (let k = 0; k < nm; k++) {
        const u = umin + rng() * W, v = rng() * rng() * vmax * 0.8, r = 0.2 + rng() * 0.5;
        ctx.fillStyle = 'rgba(' + (70 + (rng() * 30 | 0)) + ',' + (88 + (rng() * 20 | 0)) + ',52,' + (0.12 + rng() * 0.12).toFixed(2) + ')';
        ctx.beginPath(); ctx.ellipse(u, v, r, r * 0.5, 0, 0, 6.283); ctx.fill();
      }
    } else if (kind === 'metal') {
      // ferrugem em faixas verticais
      const n = 3 + ((rng() * 5) | 0);
      for (let k = 0; k < n; k++) {
        const u = umin + rng() * W, len = 0.4 + rng() * vmax * 0.7;
        const gr = ctx.createLinearGradient(0, 0, 0, len);
        gr.addColorStop(0, 'rgba(120,64,30,0.32)'); gr.addColorStop(1, 'rgba(120,64,30,0)');
        ctx.fillStyle = gr; ctx.fillRect(u, 0, 0.1 + rng() * 0.3, len);
      }
    } else {
      // laje: manchas de água parada e remendos de manta
      const n = 2 + ((rng() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const u = umin + rng() * W, v = rng() * vmax, r = 0.4 + rng() * 1.2;
        ctx.fillStyle = 'rgba(40,40,38,' + (0.06 + rng() * 0.08).toFixed(2) + ')';
        ctx.beginPath(); ctx.ellipse(u, v, r, r * (0.5 + rng() * 0.4), rng() * 3, 0, 6.283); ctx.fill();
      }
      const np = (rng() * 3) | 0;
      for (let k = 0; k < np; k++) { ctx.fillStyle = R.css([78, 78, 76], br * (0.95 + rng() * 0.15), 0.35); ctx.fillRect(umin + rng() * (W - 1), rng() * (vmax - 1), 0.6 + rng() * 1.2, 0.5 + rng() * 0.8); }
    }
    if (kind !== 'flat') {
      // escorridos a partir do topo e sujeira no beiral
      const ns = 2 + ((rng() * 4) | 0);
      for (let k = 0; k < ns; k++) {
        const u = umin + rng() * W, len = vmax * (0.3 + rng() * 0.6);
        const gr = ctx.createLinearGradient(0, vmax, 0, vmax - len);
        gr.addColorStop(0, 'rgba(20,18,14,0.16)'); gr.addColorStop(1, 'rgba(20,18,14,0)');
        ctx.fillStyle = gr; ctx.fillRect(u, vmax - len, 0.08 + rng() * 0.2, len);
      }
      const gr = ctx.createLinearGradient(0, 0, 0, 0.7);
      gr.addColorStop(0, 'rgba(20,18,14,0.24)'); gr.addColorStop(1, 'rgba(20,18,14,0)');
      ctx.fillStyle = gr; ctx.fillRect(umin, 0, W, 0.7);
    }
    ctx.restore();
  }
  function drawBox(ctx, bx, col, brick, kind) {
    const c = R.hex(col);
    const x0 = bx.x, x1 = bx.x + bx.w, y0 = bx.y, y1 = bx.y + bx.h, z0 = bx.z0, z1 = bx.z1;
    const quad = (pts, br) => {
      ctx.beginPath();
      pts.forEach((q, k) => { const s = P3(q[0], q[1], q[2]); if (k) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
      ctx.closePath(); ctx.fillStyle = R.css(c, br); ctx.fill();
    };
    quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 0.78);
    quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], 0.94);
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], kind === 'ac' || kind === 'duct' ? 1.05 : kind === 'sky' ? 0.95 : 0.5);
    if (brick) {
      ctx.strokeStyle = 'rgba(40,20,14,0.35)'; ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let z = z0 + 0.12; z < z1; z += 0.12) { const a = P3(x0, y1, z), b2 = P3(x1, y1, z), c2 = P3(x1, y0, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c2[0], c2[1]); }
      ctx.stroke();
      const t = P3(x0 + 0.1, y0 + 0.1, z1), t2 = P3(x1 - 0.1, y1 - 0.1, z1);
      ctx.fillStyle = '#231c18'; ctx.beginPath(); ctx.ellipse((t[0] + t2[0]) / 2, (t[1] + t2[1]) / 2, 5, 2.5, 0, 0, 6.283); ctx.fill();
    }
    if (kind === 'sky') { // vidro da claraboia com reflexo
      const a = P3(x0 + 0.1, y0 + 0.1, z1 + 0.01), b2 = P3(x1 - 0.1, y0 + 0.1, z1 + 0.01), c2 = P3(x1 - 0.1, y1 - 0.1, z1 + 0.01), d2 = P3(x0 + 0.1, y1 - 0.1, z1 + 0.01);
      const gr = ctx.createLinearGradient(a[0], a[1], c2[0], c2[1]);
      gr.addColorStop(0, '#9fb8c4'); gr.addColorStop(0.5, '#56707e'); gr.addColorStop(1, '#3a4c58');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(230,240,245,0.35)'; ctx.lineWidth = 1;
      const m1 = P3(x0 + bx.w * 0.3, y0 + 0.15, z1 + 0.01), m2 = P3(x0 + bx.w * 0.15, y0 + bx.h * 0.6, z1 + 0.01);
      ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.lineTo(m2[0], m2[1]); ctx.stroke();
    }
    if (kind === 'duct') { // emendas do duto
      ctx.strokeStyle = 'rgba(40,44,46,0.4)'; ctx.lineWidth = 0.7; ctx.beginPath();
      if (bx.w > bx.h) for (let x = x0 + 0.5; x < x1; x += 0.5) { const p0 = P3(x, y1, z0), p1 = P3(x, y1, z1), p2 = P3(x, y0, z1); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
      else for (let y = y0 + 0.5; y < y1; y += 0.5) { const p0 = P3(x1, y, z0), p1 = P3(x1, y, z1), p2 = P3(x0, y, z1); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); }
      ctx.stroke();
    }
    if (kind === 'ac') {
      const t = P3(x0 + bx.w / 2, y0 + bx.h / 2, z1);
      ctx.fillStyle = '#4a4e50'; ctx.beginPath(); ctx.ellipse(t[0], t[1], 9, 4.5, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#8a8e90'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(t[0] - 8, t[1]); ctx.lineTo(t[0] + 8, t[1]); ctx.moveTo(t[0], t[1] - 4); ctx.lineTo(t[0], t[1] + 4); ctx.stroke();
    }
  }
})();
