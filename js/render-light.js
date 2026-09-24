/* =====================================================================
 * VALE QUIETO — render-light.js  (Etapa 2: Render)
 * Luz e visão.
 *  - Ambiente por hora (paleta), luar com piso mínimo, nuvens/chuva,
 *    hora dourada (env.warm → luz quente aditiva no chão ao sol), relâmpago.
 *  - Luzes estáticas com oclusão (postes/luminárias — respeitando
 *    light.needsPower —, cômodos acesos, vazamento pelas janelas, luz do dia
 *    entrando pelas janelas), recalculadas SÓ na região afetada quando uma
 *    porta/janela/cortina/barricada muda.
 *  - FOV (G.fov) no modelo Project Zomboid: não há névoa de exploração; o que
 *    está fora da visão (inclusive o nunca visto) é "memória" — um pouco mais
 *    escuro e acinzentado; só entidades dinâmicas somem. A visão usa o mesmo
 *    DDA de G.world.lineOfSight (a partir da posição exata do jogador), com
 *    custo de visão das sebes/cercas (G.world.sightCost), cone de ~200°,
 *    percepção atrás, alcance menor no escuro fora de luz e na neblina.
 *  - Grade de sombreamento por meio tile no espaço (u,v) → canvas → multiply.
 *  - G.render.lightAt(x,y) (exportado por render.js) usa RL.lightLum.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, U = G.util, W = G.WALL, WS = G.WS;
  const RL = (R.light = {});
  const TUNE = R.TUNE;
  let map = null;

  // ------------------------------------------------------------------
  // Hora → cor ambiente, sol, névoa
  // ------------------------------------------------------------------
  const MOON = TUNE.moon;
  const AMB_KEYS = [
    [0, MOON[0], MOON[1], MOON[2]], [3.8, MOON[0], MOON[1], MOON[2]], [4.8, 0.2, 0.2, 0.3], [5.6, 0.5, 0.44, 0.5], [6.4, 0.9, 0.76, 0.66],
    [7.4, 1.0, 0.92, 0.84], [9, 1.0, 0.98, 0.94], [12.5, 1.02, 1.0, 0.97], [16, 1.02, 0.98, 0.9], [17.6, 1.02, 0.93, 0.8],
    [18.8, 0.98, 0.84, 0.7], [19.7, 0.8, 0.62, 0.58], [20.4, 0.46, 0.4, 0.52], [21.2, 0.22, 0.22, 0.34], [22, MOON[0], MOON[1], MOON[2]], [24, MOON[0], MOON[1], MOON[2]],
  ];
  function ambAt(h, out) {
    for (let k = 1; k < AMB_KEYS.length; k++) {
      if (h <= AMB_KEYS[k][0]) {
        const a = AMB_KEYS[k - 1], b = AMB_KEYS[k], t = (h - a[0]) / (b[0] - a[0] || 1);
        const e = t * t * (3 - 2 * t);
        out[0] = a[1] + (b[1] - a[1]) * e; out[1] = a[2] + (b[2] - a[2]) * e; out[2] = a[3] + (b[3] - a[3]) * e;
        return out;
      }
    }
    out[0] = MOON[0]; out[1] = MOON[1]; out[2] = MOON[2]; return out;
  }
  const env = RL.env = {
    hour: 12, amb: [1, 1, 1], ambIn: [0.75, 0.75, 0.75], lum: 1, night: 0,
    sunX: 0, sunY: -1, sunLen: 1, sunA: 0.3, elev: 1, flash: 0, dip: 0, wet: 0, cloud: 0, rain: 0, fog: 0, wind: 0.2,
    warm: 0, fogCol: [190, 196, 196], t: 0,
  };
  RL.updateEnv = function (s, dt) {
    const w = s.weather || {};
    const h = ((s.time % 1440) + 1440) % 1440 / 60;
    env.hour = h; env.t = s.realTime || 0;
    env.rain = w.rain || 0; env.fog = w.fog || 0; env.cloud = w.cloud || 0; env.wind = w.wind != null ? w.wind : 0.2;
    ambAt(h, env.amb);
    // noite: o luar some com nuvens/chuva (mais que a luz do dia)
    const l0 = (env.amb[0] + env.amb[1] + env.amb[2]) / 3;
    const nightW = U.clamp(1 - (l0 - 0.2) / 0.5, 0, 1);
    const over = 1 - env.cloud * (0.3 + TUNE.moonCloud * 0.5 * nightW) - env.rain * 0.22;
    const ds = env.cloud * 0.35 + env.rain * 0.3;
    for (let k = 0; k < 3; k++) env.amb[k] = (env.amb[k] + (l0 - env.amb[k]) * ds) * over;
    // relâmpago: clarão forte → apaga → forte → some; depois uma escuridão breve
    const L = w.lightning || 0;
    env.flash = L > 0.93 ? 1 : L > 0.9 ? 0.15 : L > 0.84 ? 0.85 : L > 0.78 ? (L - 0.78) / 0.06 * 0.45 : 0;
    env.dip = L > 0.02 && L <= 0.78 ? (L / 0.78) * 0.3 : 0;
    for (let k = 0; k < 3; k++) env.amb[k] *= 1 - env.dip;
    env.lum = env.amb[0] * 0.3 + env.amb[1] * 0.59 + env.amb[2] * 0.11;
    env.night = U.clamp(1 - (env.lum - 0.1) / 0.5, 0, 1);
    // interiores (sem janela): um pouco mais escuros; à noite bem mais
    const kIn = U.lerp(TUNE.interior.day, 0.55, env.night);
    env.ambIn[0] = env.amb[0] * kIn; env.ambIn[1] = env.amb[1] * kIn; env.ambIn[2] = env.amb[2] * kIn;
    // sol (julho): nasce ~5h30 a leste (+x), meio-dia ao sul (+y), põe ~20h30 a oeste
    const st = (h - 5.5) / 15;
    const el = st > 0 && st < 1 ? Math.sin(Math.PI * st) * 62 : -5;
    env.elev = el;
    const th = Math.PI * U.clamp(st, 0, 1);
    env.sunX = -Math.cos(th); env.sunY = -Math.sin(th) * 0.8 - 0.2; // direção da sombra
    const l = Math.hypot(env.sunX, env.sunY) || 1; env.sunX /= l; env.sunY /= l;
    env.sunLen = el > 0.5 ? Math.min(5, 1 / Math.tan(el * Math.PI / 180)) : 5;
    const clear = (1 - env.cloud * 0.75) * (1 - env.rain * 0.6) * (1 - env.fog * 0.5);
    env.sunA = U.smoothstep(0, 9, el) * clear * 0.32;
    // hora dourada: sol baixo e céu aberto → luz quente
    env.warm = U.smoothstep(0.3, 4, el) * (1 - U.smoothstep(9, 20, el)) * clear;
    // chão molhado acumula e seca devagar
    if (env.rain > 0.05) env.wet = Math.min(1, env.wet + dt * env.rain * 0.09);
    else env.wet = Math.max(0, env.wet - dt * 0.0035 * (1 + env.sunA * 3));
    // cor da névoa
    const fc0 = 0.74 + 0.1 * env.lum, fc1 = 0.76 + 0.1 * env.lum, fc2 = 0.78 + 0.08 * env.lum;
    env.fogCol[0] = Math.round(255 * U.clamp(fc0 * (0.18 + 0.82 * Math.min(1, env.amb[0] * 1.05)), 0, 1));
    env.fogCol[1] = Math.round(255 * U.clamp(fc1 * (0.18 + 0.82 * Math.min(1, env.amb[1] * 1.05)), 0, 1));
    env.fogCol[2] = Math.round(255 * U.clamp(fc2 * (0.18 + 0.82 * Math.min(1, env.amb[2] * 1.05)), 0, 1));
  };

  // ------------------------------------------------------------------
  // Luzes estáticas (com oclusão)
  // ------------------------------------------------------------------
  let lampR = null, lampG = null, lampB = null; // luz artificial por tile (0..~1.5)
  let winDay = null;                              // luz do dia pelas janelas (tiles internos)
  const litRooms = new Set();
  let lightsDirty = true, winDirty = true;
  let lastLitKey = '';
  const dirtyRegions = [];                        // [x0,y0,x1,y1] a recalcular
  RL.reset = function (m) {
    map = m;
    const n = m.w * m.h;
    lampR = new Float32Array(n); lampG = new Float32Array(n); lampB = new Float32Array(n);
    winDay = new Float32Array(n);
    lightsDirty = true; winDirty = true; lastLitKey = '';
    dirtyRegions.length = 0;
    litRooms.clear();
    RL._power = undefined;
  };
  RL.dirtyLights = function () { lightsDirty = true; winDirty = true; };
  // mudança local (porta, janela, cortina, barricada): só a vizinhança
  RL.dirtyAt = function (x, y) { dirtyRegions.push(x - 9, y - 9, x + 9, y + 9); };
  RL.litRooms = litRooms;
  function transparentForLight(i) {
    const wv = map.wall[i];
    if (!wv) { const o = map.objAt[i]; return !(o >= 0 && map.objects[o].blocksSight); }
    const st = map.wallState[i];
    if (wv === W.WINDOW || wv === W.GLASS) return !(st & WS.CURTAIN) && ((st & WS.BARRICADE_MASK) >> WS.BARRICADE_SHIFT) < 3;
    if (wv === W.DOOR || wv === W.GARAGE_DOOR) return !!(st & (WS.OPEN | WS.BROKEN));
    return wv === W.FENCE_WOOD || wv === W.FENCE_METAL || wv === W.FENCE_GATE || wv === W.HEDGE;
  }
  // linha de luz (Bresenham) entre centros de tiles; o destino pode ser parede (iluminada)
  function lightLOS(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    let x = x0, y = y0;
    const w = map.w;
    for (let n = 0; n < 64; n++) {
      if (x === x1 && y === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return true;
      if (!transparentForLight(y * w + x)) return false;
    }
    return true;
  }
  // Soma uma luz; só escreve dentro do retângulo [rx0,ry0]-[rx1,ry1] (região recalculada)
  let rx0 = 0, ry0 = 0, rx1 = 1e9, ry1 = 1e9;
  function addLight(lx, ly, radius, col, inten, needIndoor) {
    const c = R.hex(col || '#ffd9a0');
    const w = map.w, h = map.h;
    const x0 = Math.max(0, rx0, Math.floor(lx - radius)), x1 = Math.min(w - 1, rx1, Math.floor(lx + radius));
    const y0 = Math.max(0, ry0, Math.floor(ly - radius)), y1 = Math.min(h - 1, ry1, Math.floor(ly + radius));
    if (x0 > x1 || y0 > y1) return;
    const tx0 = Math.floor(lx), ty0 = Math.floor(ly);
    const bIn = needIndoor != null ? needIndoor : -1;
    const cr = c[0] / 255 * inten, cg = c[1] / 255 * inten, cb = c[2] / 255 * inten;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - lx, y + 0.5 - ly);
      if (d > radius) continue;
      const i = y * w + x;
      if (bIn >= 0 && map.building[i] !== bIn && !map.wall[i]) continue;
      if (!lightLOS(tx0, ty0, x, y)) continue;
      const k = Math.pow(1 - d / radius, 1.6);
      lampR[i] += cr * k; lampG[i] += cg * k; lampB[i] += cb * k;
    }
  }
  function isOpenPortal(i) {
    const wv = map.wall[i];
    return wv === W.WINDOW || wv === W.GLASS || ((wv === W.DOOR || wv === W.GARAGE_DOOR) && (map.wallState[i] & (WS.OPEN | WS.BROKEN)));
  }
  // luz do dia pelas janelas/portas abertas (tiles internos), restrita à região
  function computeWinDay(bx0, by0, bx1, by1) {
    const m = map, w = m.w;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) winDay[y * w + x] = 0;
    for (let y = Math.max(0, by0 - 5); y <= Math.min(m.h - 1, by1 + 5); y++) for (let x = Math.max(0, bx0 - 5); x <= Math.min(w - 1, bx1 + 5); x++) {
      const i = y * w + x;
      if (!isOpenPortal(i)) continue;
      const wv = m.wall[i];
      if (wv !== W.DOOR && wv !== W.GARAGE_DOOR && !transparentForLight(i)) continue;
      const b = m.building[i];
      const rad = wv === W.GLASS ? 5 : wv === W.DOOR || wv === W.GARAGE_DOOR ? 4.6 : 4.2;
      for (let yy = Math.max(by0, y - 5); yy <= Math.min(by1, y + 5); yy++) for (let xx = Math.max(bx0, x - 5); xx <= Math.min(bx1, x + 5); xx++) {
        const j = yy * w + xx;
        if (m.building[j] !== b || m.wall[j]) continue;
        const d = Math.hypot(xx - x, yy - y);
        if (d > rad) continue;
        if (!lightLOS(x, y, xx, yy)) continue;
        winDay[j] = Math.min(1, winDay[j] + (1 - d / rad) * 0.8);
      }
    }
  }
  // lista de fontes (recalculada sempre que necessário; barata)
  const sources = []; // [lx, ly, radius, col, inten, needIndoor(-1)]
  function lightOn(o, s) { return !!(o.light && (s.power || !o.light.needsPower)); }
  RL.lightOn = lightOn;
  function collectSources(s) {
    sources.length = 0;
    const m = map;
    for (const o of m.objects) {
      if (!lightOn(o, s)) continue;
      const lx = o.x + o.w / 2, ly = o.y + o.h / 2;
      if (o.type === 'lamp_post') {
        const F0 = R.DX[o.rot & 3], F1 = R.DY[o.rot & 3];
        sources.push(lx + F0 * 0.7, ly + F1 * 0.7, o.light.radius + 1, '#ffcf8e', 1.05, -1);
      } else sources.push(lx, ly, o.light.radius, o.light.color, o.type === 'lamp' ? 0.85 : 0.7, -1);
    }
    if (s.power && litNight) {
      // luminárias de varanda acesas (algumas casas deixam ligadas)
      for (const e of R.ground.entries().values()) {
        if (!porchLit(e)) continue;
        sources.push((e.oy ? e.x : e.x + 0.5) + e.ox * 0.8, (e.ox ? e.y : e.y + 0.5) + e.oy * 0.8, 3.8, '#ffd9a0', 0.8, -1);
      }
    }
    if (s.power) {
      // cômodos acesos: luz quente preenchendo o cômodo + vazamento pelas janelas
      for (const rid of litRooms) {
        const r = m.rooms[rid - 1];
        if (!r) continue;
        sources.push(r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75 + 1.5, '#ffd49a', 0.95, r.building);
      }
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x, wv = m.wall[i];
        if (wv !== W.WINDOW && wv !== W.GLASS) continue;
        if (!windowLit(i)) continue;
        const q = R.ground.qsrc;
        let ox = 0, oy = 0;
        for (let k = 0; k < 4; k++) { const src = q(i, k); if (!m.building[src]) { ox += (src % m.w) - x; oy += ((src / m.w) | 0) - y; } }
        const l = Math.hypot(ox, oy) || 1;
        sources.push(x + 0.5 + ox / l * 0.6, y + 0.5 + oy / l * 0.6, 3.2, '#ffcf8a', (m.wallState[i] & WS.CURTAIN) ? 0.3 : 0.55, -1);
      }
    }
  }
  function applySources(bx0, by0, bx1, by1) {
    const w = map.w;
    for (let y = by0; y <= by1; y++) { const o = y * w; lampR.fill(0, o + bx0, o + bx1 + 1); lampG.fill(0, o + bx0, o + bx1 + 1); lampB.fill(0, o + bx0, o + bx1 + 1); }
    rx0 = bx0; ry0 = by0; rx1 = bx1; ry1 = by1;
    for (let k = 0; k < sources.length; k += 6) {
      const lx = sources[k], ly = sources[k + 1], rad = sources[k + 2];
      if (lx + rad < bx0 || lx - rad > bx1 + 1 || ly + rad < by0 || ly - rad > by1 + 1) continue;
      addLight(lx, ly, rad, sources[k + 3], sources[k + 4], sources[k + 5] >= 0 ? sources[k + 5] : null);
    }
    rx0 = 0; ry0 = 0; rx1 = 1e9; ry1 = 1e9;
  }
  // janela acesa: algum lado dá num cômodo aceso
  function windowLit(i) {
    if (!litRooms.size) return false;
    const q = R.ground.qsrc;
    for (let k = 0; k < 4; k++) { const r = map.room[q(i, k)]; if (r && litRooms.has(r)) return true; }
    return false;
  }
  RL.windowLit = (i) => (map && map.wall[i] && (map.wall[i] === W.WINDOW || map.wall[i] === W.GLASS) && G.state && G.state.power ? windowLit(i) : false);
  // luminária de varanda acesa: energia, noite e sorteio estável por prédio/dia
  let litNight = false, litDay = 0;
  function porchLit(e) { return !!(e.lamp && litNight && G.state && G.state.power && R.hash(e.b.id, litDay, 96) < 0.5); }
  RL.porchLit = porchLit;
  // quais cômodos ficam acesos (casas com energia, à noite; muda com a hora)
  function updateLitRooms(s) {
    const h = env.hour;
    const day = Math.floor(s.time / 1440);
    const night = h >= 19.3 || h < 5.2;
    const key = s.power + ':' + night + ':' + day + ':' + (night ? Math.floor((h + 6) % 24 / 2) : 0);
    if (key === lastLitKey) return false;
    lastLitKey = key;
    litNight = night; litDay = day;
    litRooms.clear();
    if (s.power && night) {
      const slot = Math.floor((h + 6) % 24 / 2);
      for (const r of map.rooms) {
        const b = map.buildings[r.building - 1];
        if (!b) continue;
        let p = 0;
        if (b.type === 'house' || b.type === 'trailer') p = r.type === 'living' ? 0.3 : r.type === 'kitchen' ? 0.25 : r.type === 'bedroom' ? 0.12 : r.type === 'bathroom' ? 0.08 : 0.05;
        else if (b.type === 'store' || b.type === 'gas_station' || b.type === 'diner' || b.type === 'police' || b.type === 'pharmacy' || b.type === 'clinic') p = r.type === 'store' || r.type === 'police' || r.type === 'diner' || r.type === 'gas_station' || r.type === 'pharmacy' ? 0.45 : 0.12;
        else if (b.type === 'motel') p = 0.15;
        if (b.start) p *= 0.3;
        if (R.hash(r.id * 7 + slot, day, 41) < p) litRooms.add(r.id);
      }
    }
    return true;
  }

  // prepara iluminação do quadro
  RL.prepare = function (s, dt) {
    RL.updateEnv(s, dt);
    if (updateLitRooms(s)) lightsDirty = true;
    if (s.power !== RL._power) { RL._power = s.power; lightsDirty = true; }
    const m = map;
    if (winDirty) { computeWinDay(0, 0, m.w - 1, m.h - 1); winDirty = false; }
    if (lightsDirty) {
      collectSources(s); applySources(0, 0, m.w - 1, m.h - 1);
      lightsDirty = false; dirtyRegions.length = 0; fovForce = true;
    } else if (dirtyRegions.length) {
      collectSources(s);
      for (let k = 0; k < dirtyRegions.length; k += 4) {
        const x0 = Math.max(0, dirtyRegions[k]), y0 = Math.max(0, dirtyRegions[k + 1]), x1 = Math.min(m.w - 1, dirtyRegions[k + 2]), y1 = Math.min(m.h - 1, dirtyRegions[k + 3]);
        applySources(x0, y0, x1, y1);
        computeWinDay(x0, y0, x1, y1);
      }
      dirtyRegions.length = 0; fovForce = true;
    }
  };

  // ------------------------------------------------------------------
  // FOV (G.fov) — mesmo DDA de G.world.lineOfSight, origem na posição exata
  // ------------------------------------------------------------------
  let fm = null;                 // mapa do FOV (independe do render ter desenhado)
  let opq = null;                // 0 livre · 1 opaco · 2 sebe (0,5) · 3 cerca de madeira (0,85)
  let vis = null, seen = null, tgt = null, list = null, listN = 0;
  let fovPX = -1e9, fovPY = -1e9, fovDir = 99, fovFrame = 0, fovForce = true, lastFovT = 0, cX = -1e9, cY = -1e9;
  function opqOf(x, y) {
    const Wd = G.world;
    if (Wd.blocksSight(x, y)) return 1;
    const c = Wd.sightCost ? Wd.sightCost(x, y) : 0;
    return c >= 0.45 ? 2 : c > 0.05 ? 3 : 0;
  }
  function fovInit(s) {
    const m = s.map;
    fm = m;
    if (G.world.setMap) G.world.setMap(m);
    const n = m.w * m.h;
    vis = new Float32Array(n); seen = new Uint8Array(n); tgt = new Float32Array(n); list = new Int32Array(n); listN = 0;
    opq = new Uint8Array(n);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) opq[y * m.w + x] = opqOf(x, y);
    // o sobrevivente conhece a vizinhança de casa (só para a API "seen")
    const sp = m.spawnPoint || (s.player ? { x: s.player.x, y: s.player.y } : null);
    if (sp) {
      const R0 = 24;
      for (let y = Math.max(0, Math.floor(sp.y - R0)); y <= Math.min(m.h - 1, Math.floor(sp.y + R0)); y++)
        for (let x = Math.max(0, Math.floor(sp.x - R0)); x <= Math.min(m.w - 1, Math.floor(sp.x + R0)); x++)
          if (Math.hypot(x + 0.5 - sp.x, y + 0.5 - sp.y) < R0 - R.hash(x, y, 5) * 3) seen[y * m.w + x] = 1;
    }
    fovPX = fovPY = cX = cY = -1e9; fovForce = true;
    s.fov = { vis, seen, target: tgt };
  }
  RL.fovTileChanged = function (x, y) {
    if (!fm || x < 0 || y < 0 || x >= fm.w || y >= fm.h) return;
    opq[y * fm.w + x] = opqOf(x, y);
    fovForce = true;
  };
  // Visibilidade (0..1) de (x0,y0) exato até o centro do tile (ex,ey); o destino não conta.
  // Quinas exatas só bloqueiam se os DOIS vizinhos são opacos. 2 sebes bloqueiam (igual ao mundo).
  function losTo(x0, y0, ex, ey) {
    const w = fm.w;
    let tx = Math.floor(x0), ty = Math.floor(y0);
    if (tx === ex && ty === ey) return 1;
    const dx = ex + 0.5 - x0, dy = ey + 0.5 - y0;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const idx = dx !== 0 ? Math.abs(1 / dx) : Infinity, idy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx !== 0 ? (sx > 0 ? tx + 1 - x0 : x0 - tx) * idx : Infinity;
    let tMaxY = dy !== 0 ? (sy > 0 ? ty + 1 - y0 : y0 - ty) * idy : Infinity;
    let k = 1, hedges = 0, n = Math.abs(ex - tx) + Math.abs(ey - ty) + 2;
    while (n-- > 0) {
      const diff = tMaxX - tMaxY;
      if (diff > -1e-9 && diff < 1e-9) {
        if (opq[ty * w + tx + sx] === 1 && opq[(ty + sy) * w + tx] === 1) return 0;
        tx += sx; ty += sy; tMaxX += idx; tMaxY += idy; n--;
      } else if (diff < 0) { tx += sx; tMaxX += idx; } else { ty += sy; tMaxY += idy; }
      if (tx === ex && ty === ey) return k;
      const o = opq[ty * w + tx];
      if (o === 1) return 0;
      if (o === 2) { if (++hedges >= 2) return 0; k *= 0.5; } else if (o === 3) k *= 0.85;
    }
    return k;
  }
  // luz num tile para a decisão de visibilidade (sem FOV; com lanterna no cone)
  function lumForSight(i, x, y, p) {
    let l = map && map === fm && lampR ? tileLum(i, x, y) : env.lum;
    if (p && p.flashlightOn && p.alive !== false) {
      const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y, d = Math.hypot(dx, dy);
      if (d < TUNE.flash.r && d > 0.01) {
        const c = (dx * Math.cos(p.dir || 0) + dy * Math.sin(p.dir || 0)) / d;
        if (c > Math.cos(TUNE.flash.half + 0.1)) l += 0.8;
      }
    }
    return l;
  }
  function computeTargets(s) {
    const p = s.player, m = fm;
    for (let k = 0; k < listN; k++) tgt[list[k]] = 0;
    listN = 0;
    if (!p || !(p.x === p.x) || !(p.y === p.y)) return;
    const F = TUNE.fov;
    const fogK = 1 - env.fog * F.fogK;
    const Rr = Math.max(6, F.r * fogK);
    const darkR = U.lerp(F.r, F.darkR, env.night) * fogK;
    const alive = p.alive !== false;
    const dir = p.dir || 0, cd = Math.cos(dir), sd = Math.sin(dir);
    const cosH = Math.cos(F.cone), cosH2 = Math.cos(F.cone - 0.22);
    const px = p.x, py = p.y;
    const x0 = Math.max(0, Math.floor(px - Rr)), x1 = Math.min(m.w - 1, Math.floor(px + Rr));
    const y0 = Math.max(0, Math.floor(py - Rr)), y1 = Math.min(m.h - 1, Math.floor(py + Rr));
    const R2 = Rr * Rr;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - py;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - px;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        const d = Math.sqrt(d2);
        let v = 1;
        if (d > F.percept && alive) {
          const c = (dx * cd + dy * sd) / d;
          if (c < cosH) v = d < F.percept + 0.7 ? 1 - (d - F.percept) / 0.7 : 0;
          else if (c < cosH2) { const a = Math.acos(U.clamp(c, -1, 1)); v = (F.cone - a) / 0.22; }
          if (v <= 0) continue;
        }
        const i = y * m.w + x;
        if (d > darkR && lumForSight(i, x, y, p) < F.lightMin) { v *= U.clamp(1 - (d - darkR) / 2.5, 0, 1); if (v <= 0) continue; }
        if (d > Rr - 3) { v *= U.clamp((Rr - d) / 3, 0, 1); if (v <= 0) continue; }
        const l = losTo(px, py, x, y);
        if (l <= 0) continue;
        v *= l;
        tgt[i] = v; list[listN++] = i;
        if (v > 0.2) seen[i] = 1;
      }
    }
  }
  G.fov = {
    compute(s) {
      if (!s || !s.map) return;
      if (s.map !== fm || !vis) fovInit(s);
      else if (!s.fov || s.fov.vis !== vis) s.fov = { vis, seen, target: tgt };
      const p = s.player;
      const now = performance.now();
      const dt = lastFovT ? Math.min(0.1, (now - lastFovT) / 1000) : 0.016;
      lastFovT = now;
      fovFrame++;
      if (!p || !(p.x === p.x)) return;
      // salto (teleporte): esquece a visão antiga inteira
      if (Math.abs(p.x - cX) > TUNE.fov.jump || Math.abs(p.y - cY) > TUNE.fov.jump) {
        vis.fill(0); for (let k = 0; k < listN; k++) tgt[list[k]] = 0; listN = 0; fovForce = true;
      }
      cX = p.x; cY = p.y;
      const dd = Math.abs(U.angleDiff(fovDir, p.dir || 0));
      if (fovForce || Math.abs(p.x - fovPX) > 0.04 || Math.abs(p.y - fovPY) > 0.04 || dd > 0.04 || fovFrame % 4 === 0) {
        computeTargets(s);
        fovPX = p.x; fovPY = p.y; fovDir = p.dir || 0; fovForce = false;
      }
      // suavização: entra rápido, sai devagar
      const kIn = 1 - Math.exp(-dt * 14), kOut = 1 - Math.exp(-dt * 7);
      const m = fm, WIN = 36;
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      const x0 = Math.max(0, tx - WIN), x1 = Math.min(m.w - 1, tx + WIN), y0 = Math.max(0, ty - WIN), y1 = Math.min(m.h - 1, ty + WIN);
      for (let y = y0; y <= y1; y++) {
        let i = y * m.w + x0;
        for (let x = x0; x <= x1; x++, i++) {
          const t = tgt[i], v = vis[i];
          if (t !== v) { const nv = v + (t - v) * (t > v ? kIn : kOut); vis[i] = Math.abs(nv - t) < 0.004 ? t : nv; }
        }
      }
    },
    canSee(x, y) {
      if (!tgt && G.state && G.state.map) G.fov.compute(G.state);
      if (!tgt || !fm) return false;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (!(tx >= 0 && ty >= 0 && tx < fm.w && ty < fm.h)) return false;
      return tgt[ty * fm.w + tx] > 0.25;
    },
    invalidate() { fovForce = true; },
    visAt(x, y) {
      if (!vis || !fm) return 0;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (!(tx >= 0 && ty >= 0 && tx < fm.w && ty < fm.h)) return 0;
      return vis[ty * fm.w + tx];
    },
  };
  RL.vis = () => (fm === map ? vis : null);
  RL.seen = () => (fm === map ? seen : null);
  RL.target = () => (fm === map ? tgt : null);

  // ------------------------------------------------------------------
  // Sombreamento por tile
  // ------------------------------------------------------------------
  let gridC = null, gridX = null, gridImg = null, gridU32 = null, gw = 0, gh = 0, gx0 = 0, gy0 = 0;
  let desC = null, desX = null, desImg = null, desU32 = null;
  let warmC = null, warmX = null, warmImg = null, warmU32 = null;
  let tileR = null, tileG = null, tileB = null, tw = 0, th = 0;
  const _c = [0, 0, 0];
  RL.opts = { fov: true };
  // cor de sombreamento de um tile (0..~1.4 por canal), sem lanterna e sem FOV
  function tileShade(i, x, y, out) {
    const m = map;
    let r, g, b;
    const bld = m.building[i];
    if (bld && !m.wall[i]) {
      const k = 1 + TUNE.interior.win * winDay[i];
      r = env.ambIn[0] * k; g = env.ambIn[1] * k; b = env.ambIn[2] * k;
      // de dia, nunca abaixo de ~0,5 (móveis legíveis)
      const mn = TUNE.interior.minDay * (1 - env.night);
      const lum = r * 0.3 + g * 0.59 + b * 0.11;
      if (lum < mn && lum > 1e-4) { const f = mn / lum; r *= f; g *= f; b *= f; }
    } else {
      r = env.amb[0]; g = env.amb[1]; b = env.amb[2];
      // sombras de nuvens (só de dia)
      if (env.cloud > 0.05 && env.lum > 0.3) {
        const n = U.noise2(x * 0.045 + env.t * 0.018 * (0.5 + env.wind), y * 0.045 + env.t * 0.01, 7);
        const c = 1 - Math.max(0, n - 0.42) * 0.42 * env.cloud;
        r *= c; g *= c; b *= c;
      }
      if (env.wet > 0.01 && !bld) { const wk = 1 - 0.2 * env.wet; r *= wk; g *= wk; b *= wk * 1.04; }
    }
    r += lampR[i]; g += lampG[i]; b += lampB[i];
    if (env.flash > 0) { const f = env.flash * (bld && !m.wall[i] ? 0.4 : 1); r += 0.8 * f; g += 0.86 * f; b += 1.0 * f; }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }
  const _l = [0, 0, 0];
  function tileLum(i, x, y) { tileShade(i, x, y, _l); return _l[0] * 0.3 + _l[1] * 0.59 + _l[2] * 0.11; }

  // Memória (fora da visão): mais escura (e azulada à noite). A "névoa" cinza vai na grade des.
  function memK() { return U.lerp(TUNE.mem.day, TUNE.mem.night, env.night); }
  function fovMix(out, v) {
    if (v >= 0.999) return;
    const mk = memK();
    const k = mk + (1 - mk) * v;
    const bl = TUNE.mem.blueNight * env.night * (1 - v);
    out[0] *= k * (1 - bl * 0.5); out[1] *= k; out[2] *= k * (1 + bl);
  }

  // Valor final (com FOV) de um tile para superfícies verticais; soma a lanterna no ponto (x,y),
  // limitada pela visibilidade do tile (a lanterna não atravessa paredes).
  RL.shadeAt = function (i, fx, fy, out) {
    const m = map;
    const x = i % m.w, y = (i / m.w) | 0;
    tileShade(i, x, y, out);
    const vv = RL.opts.fov && vis && fm === map ? vis[i] : 1;
    const p = G.state && G.state.player;
    if (p) addFlash(out, fx, fy, p, vv);
    fovMix(out, vv);
    return out;
  };
  // melhor visibilidade num raio (copas grandes são vistas de longe)
  RL.shadeAtBest = function (tx, ty, r, fx, fy, out) {
    const m = map;
    let bi = -1, bv = -1;
    const V = fm === map ? vis : null;
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const i = y * m.w + x;
      const v = V ? V[i] : 1;
      if (v > bv) { bv = v; bi = i; }
    }
    if (bi < 0) { out[0] = out[1] = out[2] = 0; return out; }
    tileShade(bi, bi % m.w, (bi / m.w) | 0, out);
    const p = G.state && G.state.player;
    if (p) addFlash(out, fx, fy, p, bv);
    if (RL.opts.fov && V) fovMix(out, bv);
    return out;
  };
  // Luz efetiva (0..1) num ponto do mundo: ambiente/luar, interiores, lâmpadas, relâmpago e lanterna
  // (a lanterna só conta onde o jogador enxerga — não atravessa paredes). Para zumbis/UI.
  const _la = [0, 0, 0];
  RL.lightLum = function (x, y) {
    const m = map;
    if (!m || !lampR) return env.lum;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return env.lum;
    const i = ty * m.w + tx;
    tileShade(i, tx, ty, _la);
    const p = G.state && G.state.player;
    if (p) {
      const vv = vis && fm === map ? vis[i] : 1;
      flashOn = !!(p.flashlightOn && p.alive !== false); flashX = p.x; flashY = p.y; flashDirX = Math.cos(p.dir || 0); flashDirY = Math.sin(p.dir || 0);
      addFlash(_la, x, y, p, vv, true);
    }
    return U.clamp(_la[0] * 0.3 + _la[1] * 0.59 + _la[2] * 0.11, 0, 1);
  };
  let flashDirX = 1, flashDirY = 0, flashOn = false, flashX = 0, flashY = 0, glowK = 0.3;
  function addFlash(out, fx, fy, p, visK, noGlow) {
    if (visK <= 0) return;
    const dx = fx - flashX, dy = fy - flashY;
    const d2 = dx * dx + dy * dy;
    // brilho ao redor do jogador (à noite) — só visual: não entra em G.render.lightAt
    if (d2 < 7.5 && glowK > 0 && !noGlow) {
      const d = Math.sqrt(d2);
      const g = glowK * Math.pow(1 - d / 2.74, 2) * visK;
      out[0] += g * 0.9; out[1] += g * 0.86; out[2] += g * 0.8;
    }
    const FR = TUNE.flash.r;
    if (!flashOn || d2 > FR * FR || d2 < 1e-4) return;
    const d = Math.sqrt(d2);
    const cosA = (dx * flashDirX + dy * flashDirY) / d;
    const cosH = Math.cos(TUNE.flash.half);
    if (cosA < cosH - 0.12) return;
    let ang = cosA >= cosH ? 1 : (cosA - (cosH - 0.12)) / 0.12;
    ang *= 0.5 + 0.5 * U.smoothstep(cosH, 0.985, cosA); // centro mais forte
    const near = d < 1.2 ? d / 1.2 : 1;
    const fall = Math.pow(1 - d / FR, 1.25);
    const I = TUNE.flash.I * ang * fall * near * visK * (1 - env.flash * 0.5);
    out[0] += I * 1.0; out[1] += I * 0.95; out[2] += I * 0.82;
  }
  // estado da lanterna do quadro (chamado antes dos quads verticais)
  RL.frameFlash = function (p) {
    flashOn = !!(p && p.flashlightOn && p.alive !== false);
    if (p) { flashX = p.x; flashY = p.y; flashDirX = Math.cos(p.dir || 0); flashDirY = Math.sin(p.dir || 0); }
    glowK = TUNE.flash.glow * env.night;
  };

  // Monta a grade da área visível. uv = [u0,u1,v0,v1] em unidades de tile (u = x-y, v = x+y).
  // A grade é guardada no espaço (u,v) com passo de meio tile: o mapeamento isométrico vira uma
  // escala alinhada aos eixos (drawImage barato). Saídas: luz (c), "névoa" da memória (des, cinza
  // com alfa) e luz quente da hora dourada (warm, aditiva; só chão externo).
  let desMax = 0;
  RL.buildGrid = function (s, uv) {
    const m = map, p = s.player;
    const u0 = uv[0], u1 = uv[1], v0 = uv[2], v1 = uv[3];
    let tx0 = Math.floor((u0 + v0) / 2) - 1, tx1 = Math.ceil((u1 + v1) / 2) + 1;
    let ty0 = Math.floor((v0 - u1) / 2) - 1, ty1 = Math.ceil((v1 - u0) / 2) + 1;
    tx0 = Math.max(0, tx0); ty0 = Math.max(0, ty0); tx1 = Math.min(m.w - 1, tx1); ty1 = Math.min(m.h - 1, ty1);
    const w = tx1 - tx0 + 1, h = ty1 - ty0 + 1;
    if (w <= 0 || h <= 0) return null;
    const NU = (u1 - u0 + 1) * 2 + 2, NV = (v1 - v0 + 1) * 2 + 3;
    if (!gridC || gw !== NU || gh !== NV) {
      gw = NU; gh = NV;
      gridC = R.canvas(NU, NV); gridX = gridC.getContext('2d');
      gridImg = gridX.createImageData(NU, NV); gridU32 = new Uint32Array(gridImg.data.buffer);
      desC = R.canvas(NU, NV); desX = desC.getContext('2d');
      desImg = desX.createImageData(NU, NV); desU32 = new Uint32Array(desImg.data.buffer);
      warmC = R.canvas(NU, NV); warmX = warmC.getContext('2d');
      warmImg = warmX.createImageData(NU, NV); warmU32 = new Uint32Array(warmImg.data.buffer);
    }
    const V = RL.opts.fov && vis && fm === map ? vis : null;
    const memA = TUNE.mem.desat * 255;
    gridU32.fill(0xff000000);
    desU32.fill(V ? ((memA | 0) << 24) | 0x808080 : 0);
    const warmOn = env.warm > 0.02;
    if (warmOn) warmU32.fill(0);
    if (!tileR || tw < w + 2 || th < h + 2) { tw = w + 2; th = h + 2; tileR = new Float32Array(tw * th); tileG = new Float32Array(tw * th); tileB = new Float32Array(tw * th); }
    const TW = w + 2;
    tw = TW; th = h + 2;
    gx0 = tx0; gy0 = ty0;
    RL.frameFlash(p);
    // 1) valores por tile (com FOV), com 1 tile de margem, só dentro do losango visível
    for (let j = -1; j <= h; j++) {
      const y = ty0 + j;
      const xa = Math.max(-1, Math.max(u0 - 1 + y, v0 - 1 - y) - tx0), xb = Math.min(w, Math.min(u1 + 1 + y, v1 + 1 - y) - tx0);
      for (let i2 = xa; i2 <= xb; i2++) {
        const x = tx0 + i2;
        const k = (j + 1) * TW + (i2 + 1);
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) { tileR[k] = tileG[k] = tileB[k] = 0; continue; }
        const idx = y * m.w + x;
        tileShade(idx, x, y, _c);
        if (V) fovMix(_c, V[idx]);
        tileR[k] = _c[0]; tileG[k] = _c[1]; tileB[k] = _c[2];
      }
    }
    // 2) células de meio tile (quartos de parede herdam o tile-fonte), escritas em (u,v)
    const q = R.ground.qsrc;
    const FR2 = (TUNE.flash.r + 1.5) * (TUNE.flash.r + 1.5);
    const wr = TUNE.warm, wk = env.warm;
    desMax = 0;
    for (let j = 0; j < h; j++) {
      const y = ty0 + j;
      const xa = Math.max(0, Math.max(u0 + y, v0 - y) - tx0), xb = Math.min(w - 1, Math.min(u1 + y, v1 - y) - tx0);
      for (let i2 = xa; i2 <= xb; i2++) {
        const x = tx0 + i2;
        const idx = y * m.w + x;
        const wallT = m.wall[idx] !== 0;
        const ddx = x + 0.5 - flashX, ddy = y + 0.5 - flashY;
        const fl = p && (ddx * ddx + ddy * ddy < (flashOn ? FR2 : 9));
        const bu = 2 * (x - y - u0) + 1, bv = 2 * (x + y - v0) + 1;
        for (let qq = 0; qq < 4; qq++) {
          let k, src = idx;
          let vk = 1;
          if (wallT) {
            src = q(idx, qq);
            const sx = src % m.w - tx0, sy = ((src / m.w) | 0) - ty0;
            k = (sy + 1) * TW + (sx + 1);
            if (sx < -1 || sy < -1 || sx > w || sy > h) k = (j + 1) * TW + (i2 + 1);
          } else k = (j + 1) * TW + (i2 + 1);
          if (V) vk = V[src];
          let r = tileR[k], g = tileG[k], b = tileB[k];
          const a = qq & 1, bb = qq >> 1;
          if (fl) {
            _q[0] = 0; _q[1] = 0; _q[2] = 0;
            addFlash(_q, x + (a ? 0.75 : 0.25), y + (bb ? 0.75 : 0.25), p, vk);
            r += _q[0]; g += _q[1]; b += _q[2];
          }
          const iu = bu + a - bb, iv = bv + a + bb;
          if (iu < 0 || iv < 0 || iu >= NU || iv >= NV) continue;
          const o = iv * NU + iu;
          if (V) { const da = ((1 - vk) * memA) | 0; desU32[o] = (da << 24) | 0x808080; if (da > desMax) desMax = da; }
          const R8 = r >= 1 ? 255 : r <= 0 ? 0 : (r * 255) | 0;
          const G8 = g >= 1 ? 255 : g <= 0 ? 0 : (g * 255) | 0;
          const B8 = b >= 1 ? 255 : b <= 0 ? 0 : (b * 255) | 0;
          gridU32[o] = 0xff000000 | (B8 << 16) | (G8 << 8) | R8;
          if (warmOn && !m.building[src]) {
            const f = wk * (m.wall[src] ? 0.5 : 1);
            warmU32[o] = 0xff000000 | (((wr[2] * f) | 0) << 16) | (((wr[1] * f) | 0) << 8) | ((wr[0] * f) | 0);
          }
        }
      }
    }
    // 3) células "de canto" (paridade par) = média dos 4 vizinhos
    for (let iv = 1; iv < NV - 1; iv++) {
      let iu = (iv & 1) ? 2 : 1;
      let o = iv * NU + iu;
      for (; iu < NU - 1; iu += 2, o += 2) {
        const A = gridU32[o - 1], B = gridU32[o + 1], Cc = gridU32[o - NU], D = gridU32[o + NU];
        const r = ((A & 255) + (B & 255) + (Cc & 255) + (D & 255)) >> 2;
        const g = (((A >> 8) & 255) + ((B >> 8) & 255) + ((Cc >> 8) & 255) + ((D >> 8) & 255)) >> 2;
        const b = (((A >> 16) & 255) + ((B >> 16) & 255) + ((Cc >> 16) & 255) + ((D >> 16) & 255)) >> 2;
        gridU32[o] = 0xff000000 | (b << 16) | (g << 8) | r;
        if (V) { const da = ((desU32[o - 1] >>> 24) + (desU32[o + 1] >>> 24) + (desU32[o - NU] >>> 24) + (desU32[o + NU] >>> 24)) >> 2; desU32[o] = (da << 24) | 0x808080; }
        if (warmOn) {
          const A2 = warmU32[o - 1], B2 = warmU32[o + 1], C2 = warmU32[o - NU], D2 = warmU32[o + NU];
          const r2 = ((A2 & 255) + (B2 & 255) + (C2 & 255) + (D2 & 255)) >> 2, g2 = (((A2 >> 8) & 255) + ((B2 >> 8) & 255) + ((C2 >> 8) & 255) + ((D2 >> 8) & 255)) >> 2, b2 = (((A2 >> 16) & 255) + ((B2 >> 16) & 255) + ((C2 >> 16) & 255) + ((D2 >> 16) & 255)) >> 2;
          warmU32[o] = 0xff000000 | (b2 << 16) | (g2 << 8) | r2;
        }
      }
    }
    gridX.putImageData(gridImg, 0, 0);
    const useDes = V && desMax > 6;
    if (useDes) desX.putImageData(desImg, 0, 0);
    if (warmOn) warmX.putImageData(warmImg, 0, 0);
    // centro do texel (iu,iv) ↔ iso px (u0*32 - 16 + iu*16, v0*16 + iv*8)
    return { c: gridC, des: useDes ? desC : null, warm: warmOn ? warmC : null, dx: (u0 - 0.75) * 32, dy: (v0 - 0.25) * 16, dw: NU * 16, dh: NV * 8 };
  };
  const _q = [0, 0, 0];
  // valor da grade num tile (para decidir se um quad vertical precisa ser desenhado)
  RL.gridAt = function (x, y, out) {
    const i2 = Math.floor(x) - gx0 + 1, j = Math.floor(y) - gy0 + 1;
    if (!tileR || i2 < 0 || j < 0 || i2 >= tw || j >= th) { out[0] = out[1] = out[2] = -1; return out; }
    const k = j * tw + i2;
    out[0] = tileR[k]; out[1] = tileG[k]; out[2] = tileB[k];
    return out;
  };
})();
