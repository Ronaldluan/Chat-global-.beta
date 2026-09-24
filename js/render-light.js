/* =====================================================================
 * VALE QUIETO — render-light.js  (Etapa 2: Render)
 * Campo de visão (G.fov) por shadowcasting recursivo com cone frontal de
 * 200° + círculo de percepção, memória (seen) e fade (vis suavizado).
 * Luz: cor ambiente por hora, interiores mais escuros (luz das janelas),
 * postes/luminárias/janelas acesas pré-calculados com oclusão, sombras de
 * nuvens, chão molhado, lanterna em cone (meio tile de resolução),
 * relâmpago e clarão de tiro — tudo num "mapa de sombreamento" por tile
 * projetado em isométrico com suavização bilinear e aplicado com multiply.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, U = G.util, W = G.WALL, WS = G.WS, F = G.FLOOR;
  const RL = (R.light = {});
  let map = null;

  // ------------------------------------------------------------------
  // Hora → cor ambiente, sol, névoa
  // ------------------------------------------------------------------
  const AMB_KEYS = [
    [0, 0.08, 0.105, 0.21], [3.8, 0.08, 0.105, 0.21], [4.8, 0.16, 0.16, 0.27], [5.6, 0.46, 0.38, 0.46], [6.4, 0.86, 0.66, 0.58],
    [7.4, 1.0, 0.9, 0.8], [9, 1.0, 0.98, 0.93], [12.5, 1.02, 1.0, 0.96], [16, 1.02, 0.97, 0.88], [17.6, 1.04, 0.9, 0.72],
    [18.8, 1.08, 0.77, 0.5], [19.7, 0.86, 0.52, 0.42], [20.4, 0.46, 0.35, 0.48], [21.2, 0.2, 0.19, 0.33], [22, 0.08, 0.105, 0.21], [24, 0.08, 0.105, 0.21],
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
    out[0] = 0.085; out[1] = 0.11; out[2] = 0.2; return out;
  }
  RL.ambAt = ambAt;
  const env = RL.env = {
    hour: 12, amb: [1, 1, 1], ambIn: [0.7, 0.7, 0.7], lum: 1, night: 0, dark: 0,
    sunX: 0, sunY: -1, sunLen: 1, sunA: 0.3, elev: 1, flash: 0, dip: 0, wet: 0, cloud: 0, rain: 0, fog: 0, wind: 0.2,
    fogCol: [190, 196, 196], t: 0,
  };
  RL.updateEnv = function (s, dt) {
    const w = s.weather || {};
    const h = ((s.time % 1440) + 1440) % 1440 / 60;
    env.hour = h; env.t = s.realTime || 0;
    env.rain = w.rain || 0; env.fog = w.fog || 0; env.cloud = w.cloud || 0; env.wind = w.wind != null ? w.wind : 0.2;
    ambAt(h, env.amb);
    // nuvens/chuva: mais escuro e dessaturado
    const over = 1 - env.cloud * 0.3 - env.rain * 0.22;
    const l0 = (env.amb[0] + env.amb[1] + env.amb[2]) / 3;
    const ds = env.cloud * 0.35 + env.rain * 0.3;
    for (let k = 0; k < 3; k++) env.amb[k] = (env.amb[k] + (l0 - env.amb[k]) * ds) * over;
    // relâmpago: clarão curto piscando + escurecimento logo depois
    const L = w.lightning || 0;
    // clarão: forte → apaga → forte → some; depois uma escuridão breve
    const f = L > 0.93 ? 1 : L > 0.9 ? 0.18 : L > 0.84 ? 0.9 : L > 0.78 ? (L - 0.78) / 0.06 * 0.5 : 0;
    env.flash = f;
    env.dip = L > 0.02 && L <= 0.78 ? (L / 0.78) * 0.3 : 0;
    for (let k = 0; k < 3; k++) env.amb[k] *= 1 - env.dip;
    env.lum = (env.amb[0] * 0.3 + env.amb[1] * 0.59 + env.amb[2] * 0.11);
    env.night = U.clamp(1 - (env.lum - 0.1) / 0.5, 0, 1);
    env.dark = U.clamp(1 - env.lum, 0, 1);
    // interiores: mais escuros de dia
    const k = 0.62;
    env.ambIn[0] = env.amb[0] * k; env.ambIn[1] = env.amb[1] * k; env.ambIn[2] = env.amb[2] * k;
    // sol (julho): nasce ~5h30 a leste (+x), meio-dia ao sul (+y), põe ~20h30 a oeste
    const st = (h - 5.5) / 15;
    const el = st > 0 && st < 1 ? Math.sin(Math.PI * st) * 62 : -5;
    env.elev = el;
    const th = Math.PI * U.clamp(st, 0, 1);
    env.sunX = -Math.cos(th); env.sunY = -Math.sin(th) * 0.8 - 0.2; // direção da sombra
    const l = Math.hypot(env.sunX, env.sunY) || 1; env.sunX /= l; env.sunY /= l;
    env.sunLen = el > 0.5 ? Math.min(4.5, 1 / Math.tan(el * Math.PI / 180)) : 4.5;
    env.sunA = U.smoothstep(0, 9, el) * (1 - env.cloud * 0.75) * (1 - env.rain * 0.6) * (1 - env.fog * 0.5) * 0.3;
    // chão molhado acumula e seca devagar
    if (env.rain > 0.05) env.wet = Math.min(1, env.wet + dt * env.rain * 0.09);
    else env.wet = Math.max(0, env.wet - dt * 0.0035 * (1 + env.sunA * 3));
    // cor da névoa
    const fc = [0.74 + 0.1 * env.lum, 0.76 + 0.1 * env.lum, 0.78 + 0.08 * env.lum];
    for (let k2 = 0; k2 < 3; k2++) env.fogCol[k2] = Math.round(255 * U.clamp(fc[k2] * (0.18 + 0.82 * Math.min(1, env.amb[k2] * 1.05)), 0, 1));
  };

  // ------------------------------------------------------------------
  // Luzes estáticas (com oclusão) — recalculadas quando algo muda
  // ------------------------------------------------------------------
  let lampR = null, lampG = null, lampB = null; // luz artificial por tile (0..~1.5)
  let winDay = null;                              // luz do dia pelas janelas (tiles internos)
  let litRooms = new Set();
  let lightsDirty = true, winDirty = true;
  let lastLitKey = '';
  RL.reset = function (m) {
    map = m;
    const n = m.w * m.h;
    lampR = new Float32Array(n); lampG = new Float32Array(n); lampB = new Float32Array(n);
    winDay = new Float32Array(n);
    lightsDirty = true; winDirty = true; lastLitKey = '';
    vis = null;
  };
  RL.dirtyLights = function () { lightsDirty = true; winDirty = true; };
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
  function addLight(lx, ly, radius, col, inten, needIndoor) {
    const c = R.hex(col || '#ffd9a0');
    const w = map.w, h = map.h;
    const x0 = Math.max(0, Math.floor(lx - radius)), x1 = Math.min(w - 1, Math.floor(lx + radius));
    const y0 = Math.max(0, Math.floor(ly - radius)), y1 = Math.min(h - 1, Math.floor(ly + radius));
    const tx0 = Math.floor(lx), ty0 = Math.floor(ly);
    const bIn = needIndoor != null ? needIndoor : -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - lx, y + 0.5 - ly);
      if (d > radius) continue;
      const i = y * w + x;
      if (bIn >= 0 && map.building[i] !== bIn && !map.wall[i]) continue;
      if (!lightLOS(tx0, ty0, x, y)) continue;
      const k = inten * Math.pow(1 - d / radius, 1.6);
      lampR[i] += c[0] / 255 * k; lampG[i] += c[1] / 255 * k; lampB[i] += c[2] / 255 * k;
    }
  }
  function computeWinDay() {
    winDay.fill(0);
    const m = map, w = m.w;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, wv = m.wall[i];
      if (!(wv === W.WINDOW || wv === W.GLASS || ((wv === W.DOOR || wv === W.GARAGE_DOOR) && (m.wallState[i] & (WS.OPEN | WS.BROKEN))))) continue;
      if (wv !== W.DOOR && wv !== W.GARAGE_DOOR && !transparentForLight(i)) continue;
      const b = m.building[i];
      const rad = wv === W.GLASS ? 5 : 4.2;
      for (let yy = Math.max(0, y - 5); yy <= Math.min(m.h - 1, y + 5); yy++) for (let xx = Math.max(0, x - 5); xx <= Math.min(w - 1, x + 5); xx++) {
        const j = yy * w + xx;
        if (m.building[j] !== b || m.wall[j]) continue;
        const d = Math.hypot(xx - x, yy - y);
        if (d > rad) continue;
        if (!lightLOS(x, y, xx, yy)) continue;
        winDay[j] = Math.min(1, winDay[j] + (1 - d / rad) * 0.75);
      }
    }
  }
  function computeLights(s) {
    lampR.fill(0); lampG.fill(0); lampB.fill(0);
    const m = map;
    if (s.power) {
      for (const o of m.objects) {
        if (!o.light) continue;
        const lx = o.x + o.w / 2, ly = o.y + o.h / 2;
        if (o.type === 'lamp_post') {
          const F0 = R.DX[o.rot & 3], F1 = R.DY[o.rot & 3];
          addLight(lx + F0 * 0.7, ly + F1 * 0.7, o.light.radius + 1, '#ffcf8e', 1.05);
        } else addLight(lx, ly, o.light.radius, o.light.color, o.type === 'lamp' ? 0.85 : 0.7);
      }
      // cômodos acesos: luz quente preenchendo o cômodo + vazamento pelas janelas
      for (const rid of litRooms) {
        const r = m.rooms[rid - 1];
        if (!r) continue;
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const rad = Math.max(r.w, r.h) * 0.75 + 1.5;
        addLight(cx, cy, rad, '#ffd49a', 0.95, r.building);
      }
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x, wv = m.wall[i];
        if (wv !== W.WINDOW && wv !== W.GLASS) continue;
        const lit = windowLit(i);
        if (!lit) continue;
        // luz derramando para fora
        const q = R.ground.qsrc;
        let ox = 0, oy = 0;
        for (let k = 0; k < 4; k++) { const src = q(i, k); if (!m.building[src]) { ox += (src % m.w) - x; oy += ((src / m.w) | 0) - y; } }
        const l = Math.hypot(ox, oy) || 1;
        addLight(x + 0.5 + ox / l * 0.6, y + 0.5 + oy / l * 0.6, 3.2, '#ffcf8a', (m.wallState[i] & WS.CURTAIN) ? 0.3 : 0.55);
      }
    }
  }
  // janela acesa: algum lado dá num cômodo aceso
  function windowLit(i) {
    if (!litRooms.size) return false;
    const q = R.ground.qsrc;
    for (let k = 0; k < 4; k++) { const r = map.room[q(i, k)]; if (r && litRooms.has(r)) return true; }
    return false;
  }
  RL.windowLit = (i) => (map && map.wall[i] && (map.wall[i] === W.WINDOW || map.wall[i] === W.GLASS) && G.state && G.state.power ? windowLit(i) : false);
  // quais cômodos ficam acesos (casas com energia, à noite; muda com a hora)
  function updateLitRooms(s) {
    const h = env.hour;
    const day = Math.floor(s.time / 1440);
    const night = h >= 19.3 || h < 5.2;
    const key = s.power + ':' + night + ':' + day + ':' + (night ? Math.floor((h + 6) % 24 / 2) : 0);
    if (key === lastLitKey) return false;
    lastLitKey = key;
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

  // ------------------------------------------------------------------
  // FOV (G.fov)
  // ------------------------------------------------------------------
  let vis = null, seen = null, tgt = null, lastList = null, lastN = 0;
  let fovX = -999, fovY = -999, fovDir = 99, fovFrame = 0, fovForce = true;
  let lastFovT = 0;
  const FOV_R = 30;
  const WIN = 36; // raio da janela de suavização
  function opaque(x, y) { return G.world.blocksSight(x, y); }
  let _ox = 0, _oy = 0, _R = 0;
  function mark(x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return;
    const i = y * map.w + x;
    if (tgt[i] === 0) { lastList[lastN++] = i; tgt[i] = 1e-4; }
    tgt[i] = Math.max(tgt[i], 1);
  }
  function castLight(row, start, end, xx, xy, yx, yy) {
    if (start < end) return;
    let newStart = 0;
    const r2 = _R * _R;
    for (let i = row; i <= _R; i++) {
      let dx = -i - 1;
      const dy = -i;
      let blocked = false;
      while (dx <= 0) {
        dx++;
        const X = _ox + dx * xx + dy * xy, Y = _oy + dx * yx + dy * yy;
        const lS = (dx - 0.5) / (dy + 0.5), rS = (dx + 0.5) / (dy - 0.5);
        if (start < rS) continue;
        if (end > lS) break;
        if (dx * dx + dy * dy <= r2) mark(X, Y);
        const op = opaque(X, Y);
        if (blocked) {
          if (op) { newStart = rS; continue; }
          blocked = false; start = newStart;
        } else if (op && i < _R) {
          blocked = true;
          castLight(i + 1, start, lS, xx, xy, yx, yy);
          newStart = rS;
        }
      }
      if (blocked) break;
    }
  }
  const OCT = [[1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1], [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1]];
  function ensureFov(s) {
    const n = map.w * map.h;
    if (!vis || vis.length !== n) {
      vis = new Float32Array(n); seen = new Uint8Array(n); tgt = new Float32Array(n); lastList = new Int32Array(n); lastN = 0; fovForce = true;
      // o sobrevivente conhece a vizinhança de casa: memória inicial ao redor do ponto de partida
      const sp = map.spawnPoint || (s.player ? { x: s.player.x, y: s.player.y } : null);
      if (sp) {
        const R0 = 24;
        for (let y = Math.max(0, Math.floor(sp.y - R0)); y <= Math.min(map.h - 1, Math.floor(sp.y + R0)); y++)
          for (let x = Math.max(0, Math.floor(sp.x - R0)); x <= Math.min(map.w - 1, Math.floor(sp.x + R0)); x++) {
            const d = Math.hypot(x + 0.5 - sp.x, y + 0.5 - sp.y);
            if (d < R0 - R.hash(x, y, 5) * 3) seen[y * map.w + x] = 1;
          }
      }
    }
    s.fov = s.fov && s.fov.vis === vis ? s.fov : { vis, seen, target: tgt };
  }
  // luz aproximada num tile (para decidir se é visível à noite)
  function lightAt(i, x, y, p) {
    let l = map.building[i] ? env.lum * 0.55 : env.lum;
    l += (lampR[i] + lampG[i] + lampB[i]) * 0.33;
    if (p && p.flashlightOn) {
      const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y, d = Math.hypot(dx, dy);
      if (d < FLASH_R) {
        const a = Math.abs(U.angleDiff(p.dir || 0, Math.atan2(dy, dx)));
        if (a < FLASH_HALF + 0.1) l += 0.8;
      }
    }
    return l + env.flash;
  }
  const FLASH_R = 12.5, FLASH_HALF = 0.46;
  function computeTargets(s) {
    const p = s.player, m = map;
    for (let k = 0; k < lastN; k++) tgt[lastList[k]] = 0;
    lastN = 0;
    if (!p) return;
    const ptx = Math.floor(p.x), pty = Math.floor(p.y);
    _ox = ptx; _oy = pty;
    const fogK = 1 - env.fog * 0.62;
    _R = Math.max(6, Math.round(FOV_R * fogK));
    mark(ptx, pty);
    for (const o of OCT) castLight(1, 1, 0, o[0], o[1], o[2], o[3]);
    // aplica cone, percepção, escuridão e névoa
    const dir = p.dir || 0;
    const dark = env.night;
    const darkR = U.lerp(30, 7.5, dark) * fogK;
    const alive = p.alive !== false;
    for (let k = 0; k < lastN; k++) {
      const i = lastList[k];
      const x = i % m.w, y = (i / m.w) | 0;
      const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      let v = 1;
      if (d > 1.9 && alive) {
        const a = Math.abs(U.angleDiff(dir, Math.atan2(dy, dx)));
        const half = 1.745; // 100°
        if (a > half) v = d < 2.6 ? 1 - (d - 1.9) / 0.7 : 0;
        else if (a > half - 0.22) v = (half - a) / 0.22;
      }
      if (v > 0 && d > darkR) {
        const L = lightAt(i, x, y, p);
        if (L < 0.2) v *= U.clamp(1 - (d - darkR) / 2.5, 0, 1);
      }
      if (d > _R - 3) v *= U.clamp((_R - d) / 3, 0, 1);
      tgt[i] = v;
      if (v > 0.2) seen[i] = 1;
    }
  }
  G.fov = {
    compute(s) {
      if (!s || !s.map) return;
      if (map !== s.map) return; // o render ainda não se preparou para este mapa
      ensureFov(s);
      const p = s.player;
      const now = performance.now();
      const dt = lastFovT ? Math.min(0.1, (now - lastFovT) / 1000) : 0.016;
      lastFovT = now;
      fovFrame++;
      if (!p) return;
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      const dd = Math.abs(U.angleDiff(fovDir, p.dir || 0));
      if (fovForce || tx !== fovX || ty !== fovY || dd > 0.08 || fovFrame % 3 === 0) {
        computeTargets(s);
        fovX = tx; fovY = ty; fovDir = p.dir || 0; fovForce = false;
      }
      // suavização (fade in/out) numa janela ao redor do jogador
      const k = 1 - Math.exp(-dt * 10);
      const m = map;
      const x0 = Math.max(0, tx - WIN), x1 = Math.min(m.w - 1, tx + WIN), y0 = Math.max(0, ty - WIN), y1 = Math.min(m.h - 1, ty + WIN);
      for (let y = y0; y <= y1; y++) {
        let i = y * m.w + x0;
        for (let x = x0; x <= x1; x++, i++) {
          const t = tgt[i], v = vis[i];
          if (t !== v) { const nv = v + (t - v) * k; vis[i] = Math.abs(nv - t) < 0.004 ? t : nv; }
        }
      }
    },
    canSee(x, y) {
      if (!tgt || !map) return true;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
      return tgt[ty * map.w + tx] > 0.25;
    },
    invalidate() { fovForce = true; },
    visAt(x, y) {
      if (!vis || !map) return 1;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 0;
      return vis[ty * map.w + tx];
    },
  };
  RL.vis = () => vis;
  RL.seen = () => seen;

  // ------------------------------------------------------------------
  // Grade de sombreamento (2 células por tile) → canvas → multiply
  // ------------------------------------------------------------------
  let gridC = null, gridX = null, gridImg = null, gridU32 = null, gw = 0, gh = 0, gx0 = 0, gy0 = 0;
  let desC = null, desX = null, desImg = null, desU32 = null;
  let tileR = null, tileG = null, tileB = null, tw = 0, th = 0;
  const _c = [0, 0, 0];
  RL.opts = { fov: true };
  // cor de sombreamento de um tile (0..~1.4 por canal), sem lanterna
  function tileShade(i, x, y, out) {
    const m = map;
    let r, g, b;
    const bld = m.building[i];
    if (bld && !m.wall[i]) {
      const wd = winDay[i];
      const k = 0.62 + 0.58 * wd;
      r = env.ambIn[0] * k; g = env.ambIn[1] * k; b = env.ambIn[2] * k;
      // mesmo à noite, um mínimo para leitura
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
  RL.tileShade = tileShade;

  // prepara iluminação do quadro
  RL.prepare = function (s, dt) {
    RL.updateEnv(s, dt);
    if (updateLitRooms(s)) lightsDirty = true;
    if (s.power !== RL._power) { RL._power = s.power; lightsDirty = true; }
    if (winDirty) { computeWinDay(); winDirty = false; }
    if (lightsDirty) { computeLights(s); lightsDirty = false; fovForce = true; }
  };

  // Valor final (com FOV) de um tile para quads verticais; soma a lanterna no ponto (x,y)
  const _q = [0, 0, 0];
  RL.shadeAt = function (i, fx, fy, out) {
    const m = map;
    const x = i % m.w, y = (i / m.w) | 0;
    tileShade(i, x, y, out);
    const p = G.state && G.state.player;
    if (p) addFlash(out, fx, fy, p, 1);
    const vv = RL.opts.fov && vis ? vis[i] : 1;
    fovMix(out, vv, seen ? seen[i] : 1);
    return out;
  };
  // melhor visibilidade num raio (copas grandes são vistas de longe)
  RL.shadeAtBest = function (tx, ty, r, fx, fy, out) {
    const m = map;
    let bi = -1, bv = -1, bs = 0;
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const i = y * m.w + x;
      const v = vis ? vis[i] : 1;
      if (v > bv) { bv = v; bi = i; }
      if (seen && seen[i]) bs = 1;
    }
    if (bi < 0) { out[0] = out[1] = out[2] = 0; return out; }
    tileShade(bi, bi % m.w, (bi / m.w) | 0, out);
    const p = G.state && G.state.player;
    if (p) addFlash(out, fx, fy, p, 1);
    if (RL.opts.fov && vis) fovMix(out, bv, bs);
    return out;
  };
  function fovMix(out, v, sn) {
    if (v >= 0.999) return;
    const mk = sn ? 0.5 : 0.1;
    const k = mk + (1 - mk) * v;
    out[0] *= k * (v < 1 ? 1 - 0.06 * (1 - v) : 1); out[1] *= k; out[2] *= k * (1 + 0.12 * (1 - v) * (sn ? 1 : 0));
  }
  let flashDirX = 1, flashDirY = 0, flashOn = false, flashX = 0, flashY = 0, glowK = 0.3;
  function addFlash(out, fx, fy, p, visK) {
    const dx = fx - flashX, dy = fy - flashY;
    const d2 = dx * dx + dy * dy;
    // brilho ao redor do jogador
    if (d2 < 7.5) {
      const d = Math.sqrt(d2);
      const g = glowK * Math.pow(1 - d / 2.74, 2) * visK;
      out[0] += g * 0.9; out[1] += g * 0.86; out[2] += g * 0.8;
    }
    if (!flashOn || d2 > FLASH_R * FLASH_R || d2 < 1e-4) return;
    const d = Math.sqrt(d2);
    const cosA = (dx * flashDirX + dy * flashDirY) / d;
    const cosH = Math.cos(FLASH_HALF);
    if (cosA < cosH - 0.12) return;
    let ang = cosA >= cosH ? 1 : (cosA - (cosH - 0.12)) / 0.12;
    ang *= 0.5 + 0.5 * U.smoothstep(cosH, 0.985, cosA); // centro mais forte
    const near = d < 1.2 ? d / 1.2 : 1;
    const fall = Math.pow(1 - d / FLASH_R, 1.25);
    const I = 1.65 * ang * fall * near * visK * (1 - env.flash * 0.5);
    out[0] += I * 1.0; out[1] += I * 0.95; out[2] += I * 0.82;
  }

  // Monta a grade da área visível. uv = [u0,u1,v0,v1] em unidades de tile (u = x-y, v = x+y).
  // A grade é guardada no espaço (u,v) com passo de meio tile: assim o mapeamento isométrico
  // vira uma simples escala alinhada aos eixos (drawImage barato, sem rotação).
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
    }
    gridU32.fill(0xff000000);
    desU32.fill(0xe6808080);
    if (!tileR || tw < w + 2 || th < h + 2) { tw = w + 2; th = h + 2; tileR = new Float32Array(tw * th); tileG = new Float32Array(tw * th); tileB = new Float32Array(tw * th); }
    const TW = w + 2;
    tw = TW; th = h + 2;
    gx0 = tx0; gy0 = ty0;
    flashOn = !!(p && p.flashlightOn && p.alive !== false);
    if (p) { flashX = p.x; flashY = p.y; flashDirX = Math.cos(p.dir || 0); flashDirY = Math.sin(p.dir || 0); }
    glowK = 0.32 * env.night;
    const useFov = RL.opts.fov && vis;
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
        if (useFov) fovMix(_c, vis[idx], seen[idx]);
        tileR[k] = _c[0]; tileG[k] = _c[1]; tileB[k] = _c[2];
      }
    }
    // 2) células de meio tile (quartos de parede herdam o tile-fonte), escritas em (u,v)
    const q = R.ground.qsrc;
    const FR2 = (FLASH_R + 1.5) * (FLASH_R + 1.5);
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
          let k;
          let vk = 1;
          if (wallT) {
            const src = q(idx, qq);
            const sx = src % m.w - tx0, sy = ((src / m.w) | 0) - ty0;
            k = (sy + 1) * TW + (sx + 1);
            if (sx < -1 || sy < -1 || sx > w || sy > h) k = (j + 1) * TW + (i2 + 1);
            if (useFov) vk = vis[src];
          } else { k = (j + 1) * TW + (i2 + 1); if (useFov) vk = vis[idx]; }
          let r = tileR[k], g = tileG[k], b = tileB[k];
          const a = qq & 1, bb = qq >> 1;
          if (fl) {
            _q[0] = 0; _q[1] = 0; _q[2] = 0;
            addFlash(_q, x + (a ? 0.75 : 0.25), y + (bb ? 0.75 : 0.25), p, vk);
            r += _q[0]; g += _q[1]; b += _q[2];
          }
          const iu = bu + a - bb, iv = bv + a + bb;
          if (iu < 0 || iv < 0 || iu >= NU || iv >= NV) continue;
          if (useFov) { const da = ((1 - vk) * 200) | 0; desU32[iv * NU + iu] = (da << 24) | 0x808080; }
          else desU32[iv * NU + iu] = 0x00808080;
          const R8 = r >= 1 ? 255 : r <= 0 ? 0 : (r * 255) | 0;
          const G8 = g >= 1 ? 255 : g <= 0 ? 0 : (g * 255) | 0;
          const B8 = b >= 1 ? 255 : b <= 0 ? 0 : (b * 255) | 0;
          gridU32[iv * NU + iu] = 0xff000000 | (B8 << 16) | (G8 << 8) | R8;
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
        const da = ((desU32[o - 1] >>> 24) + (desU32[o + 1] >>> 24) + (desU32[o - NU] >>> 24) + (desU32[o + NU] >>> 24)) >> 2;
        desU32[o] = (da << 24) | 0x808080;
      }
    }
    gridX.putImageData(gridImg, 0, 0);
    if (useFov) desX.putImageData(desImg, 0, 0);
    // centro do texel (iu,iv) ↔ iso px (u0*32 - 16 + iu*16, v0*16 + iv*8)
    return { c: gridC, des: useFov ? desC : null, dx: (u0 - 0.75) * 32, dy: (v0 - 0.25) * 16, dw: NU * 16, dh: NV * 8 };
  };
  // valor da grade num tile (para decidir se um quad vertical precisa ser desenhado)
  RL.gridAt = function (x, y, out) {
    const i2 = Math.floor(x) - gx0 + 1, j = Math.floor(y) - gy0 + 1;
    if (!tileR || i2 < 0 || j < 0 || i2 >= tw || j >= th) { out[0] = out[1] = out[2] = -1; return out; }
    const k = j * tw + i2;
    out[0] = tileR[k]; out[1] = tileG[k]; out[2] = tileB[k];
    return out;
  };
  RL.flashAt = function (x, y, out) {
    out[0] = out[1] = out[2] = 0;
    const p = G.state && G.state.player;
    if (p) addFlash(out, x, y, p, 1);
    return out;
  };
})();
