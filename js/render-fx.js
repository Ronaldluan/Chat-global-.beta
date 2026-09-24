/* =====================================================================
 * VALE QUIETO — render-fx.js  (Etapa 2: Render)
 * Efeitos: sombras do sol (camada única em meia resolução), partículas
 * (state.particles: física simples), decals no chão (sangue, poças, vidro,
 * pegadas, tiros), poças e brilho do chão molhado, chuva com vento e
 * respingos, neblina em camadas, folhas ao vento, relâmpago, correção de
 * cor por hora, vinheta e grão de filme.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, U = G.util, F = G.FLOOR;
  const FX = (R.fx = {});
  const ZPX = R.ZPX;
  const rnd = Math.random;

  // ------------------------------------------------------------------
  // Sombras do sol: tudo num único caminho, preenchido de uma vez
  // ------------------------------------------------------------------
  let shC = null, shX = null, shW = 0, shH = 0;
  FX.shadowBegin = function (W, H, cam) {
    const w = Math.ceil(W / 2), h = Math.ceil(H / 2);
    if (!shC || shW !== w || shH !== h) { shW = w; shH = h; shC = R.canvas(w, h); shX = shC.getContext('2d'); }
    shX.setTransform(1, 0, 0, 1, 0, 0);
    shX.globalCompositeOperation = 'source-over';
    shX.clearRect(0, 0, w, h);
    shX.setTransform(cam.zoom * 0.5, 0, 0, cam.zoom * 0.5, -cam.ox * 0.5, -cam.oy * 0.5);
    shX.beginPath();
    return shX;
  };
  FX.shadowCtx = () => shX;
  // Todos os sub-caminhos com a MESMA orientação (preenchimento nonzero soma, não cancela)
  let ovx = 0, ovy = 0; // deslocamento da sombra por metro de altura, em px isométricos
  FX.shadowPrep = function () {
    const e = R.light.env;
    ovx = (e.sunX - e.sunY) * 32 * e.sunLen; ovy = (e.sunX + e.sunY) * 16 * e.sunLen;
  };
  function quadS(ax, ay, bx, by, vx, vy) {
    const cr = (bx - ax) * vy - (by - ay) * vx;
    if (cr >= 0) { shX.moveTo(ax, ay); shX.lineTo(bx, by); shX.lineTo(bx + vx, by + vy); shX.lineTo(ax + vx, ay + vy); }
    else { shX.moveTo(ax, ay); shX.lineTo(ax + vx, ay + vy); shX.lineTo(bx + vx, by + vy); shX.lineTo(bx, by); }
    shX.closePath();
  }
  // segmento vertical (x0,y0)-(x1,y1) (mundo) de altura h (m)
  FX.shadowSeg = function (x0, y0, x1, y1, h) {
    quadS((x0 - y0) * 32, (x0 + y0) * 16, (x1 - y1) * 32, (x1 + y1) * 16, ovx * h, ovy * h);
  };
  // caixa: laterais varridas + topo projetado
  FX.shadowBox = function (x0, y0, x1, y1, h) {
    const vx = ovx * h, vy = ovy * h;
    const ax = (x0 - y0) * 32, ay = (x0 + y0) * 16, bx = (x1 - y0) * 32, by = (x1 + y0) * 16;
    const cx = (x1 - y1) * 32, cy = (x1 + y1) * 16, dx = (x0 - y1) * 32, dy = (x0 + y1) * 16;
    quadS(ax, ay, bx, by, vx, vy); quadS(bx, by, cx, cy, vx, vy); quadS(cx, cy, dx, dy, vx, vy); quadS(dx, dy, ax, ay, vx, vy);
    shX.moveTo(ax + vx, ay + vy); shX.lineTo(bx + vx, by + vy); shX.lineTo(cx + vx, cy + vy); shX.lineTo(dx + vx, dy + vy); shX.closePath();
  };
  FX.shadowTree = function (x, y, zc, r, trunkH) {
    const e = R.light.env;
    const cx = (x - y) * 32 + ovx * zc, cy = (x + y) * 16 + ovy * zc;
    const stretch = Math.min(2.2, 1 + e.sunLen * 0.25);
    const ang = Math.atan2(ovy, ovx || 1e-6);
    const rx = r * 45 * stretch, ry = r * 24;
    shX.moveTo(cx + Math.cos(ang) * rx, cy + Math.sin(ang) * rx);
    shX.ellipse(cx, cy, rx, ry, ang, 0, Math.PI * 2);
    if (trunkH > 0.2) FX.shadowSeg(x - 0.08, y + 0.08, x + 0.08, y - 0.08, trunkH);
  };
  FX.shadowActor = function (x, y, h) {
    const vx = ovx * h, vy = ovy * h;
    const n = Math.hypot(vx, vy) || 1;
    const px = -vy / n * 5, py = vx / n * 5;
    const X = (x - y) * 32, Y = (x + y) * 16;
    quadS(X + px, Y + py * 0.5, X - px, Y - py * 0.5, vx, vy);
    shX.moveTo(X + vx + 5, Y + vy); shX.ellipse(X + vx, Y + vy, 5, 3, 0, 0, Math.PI * 2);
  };
  // ---- sombras estáticas em cache por bloco (reconstruídas quando o sol anda) ----
  const shChunks = new Map();
  let shMap = null, shFrame = 0;
  FX.shadowReset = function (m) { shMap = m; shChunks.clear(); };
  function sunKey() {
    const e = R.light.env;
    return Math.round(Math.atan2(e.sunY, e.sunX) * 60) + ':' + Math.round(Math.min(e.sunLen, 3.4) * 16);
  }
  const W = G.WALL;
  function casterH(wv) { return wv === W.HEDGE ? 1.35 : wv === W.FENCE_WOOD || wv === W.FENCE_GATE ? 1.25 : wv === W.FENCE_METAL ? 0.2 : R.WALL_M; }
  function buildShadowChunk(cx, cy) {
    const m = shMap, CW = R.ground.CW, CH = R.ground.CH;
    const c = R.canvas(CW / 2, CH / 2);
    const g = c.getContext('2d');
    const X0 = cx * CW, Y0 = cy * CH;
    const saved = shX; shX = g;
    g.setTransform(0.5, 0, 0, 0.5, -X0 * 0.5, -Y0 * 0.5);
    g.beginPath();
    const e = R.light.env;
    const L = Math.min(e.sunLen, 3.4);
    // tiles do bloco + margem a montante da sombra
    const u0 = Math.floor(X0 / 32) - 2, u1 = Math.ceil((X0 + CW) / 32) + 2, v0 = Math.floor(Y0 / 16) - 2, v1 = Math.ceil((Y0 + CH) / 16) + 4;
    let xa = Math.floor((u0 + v0) / 2), xb = Math.ceil((u1 + v1) / 2), ya = Math.floor((v0 - u1) / 2), yb = Math.ceil((v1 - u0) / 2);
    const reach = Math.ceil(L * 4.6) + 2;
    if (e.sunX > 0) xa -= reach; else xb += reach;
    if (e.sunY > 0) ya -= reach; else yb += reach;
    xa = Math.max(0, xa); ya = Math.max(0, ya); xb = Math.min(m.w - 1, xb); yb = Math.min(m.h - 1, yb);
    // paredes: corridas ao longo de x e de y fundidas num só quad
    for (let y = ya; y <= yb; y++) {
      let ra = -1, rb = -1, rh = 0;
      for (let x = xa; x <= xb + 1; x++) {
        let a = -1, b = -1, h = 0;
        if (x <= xb) {
          const i = y * m.w + x, mk = m.wallMask[i];
          if (m.wall[i] && (mk & 10)) { a = mk & 8 ? x : x + 0.5; b = mk & 2 ? x + 1 : x + 0.5; h = casterH(m.wall[i]); }
        }
        if (a >= 0 && ra >= 0 && Math.abs(rb - a) < 1e-6 && rh === h) rb = b;
        else { if (ra >= 0) FX.shadowSeg(ra, y + 0.5, rb, y + 0.5, rh); ra = a; rb = b; rh = h; }
      }
    }
    for (let x = xa; x <= xb; x++) {
      let ra = -1, rb = -1, rh = 0;
      for (let y = ya; y <= yb + 1; y++) {
        let a = -1, b = -1, h = 0;
        if (y <= yb) {
          const i = y * m.w + x, mk = m.wallMask[i];
          if (m.wall[i] && (mk & 5)) { a = mk & 1 ? y : y + 0.5; b = mk & 4 ? y + 1 : y + 0.5; h = casterH(m.wall[i]); }
          else if (m.wall[i] && !mk) FX.shadowBox(x + 0.4, y + 0.4, x + 0.6, y + 0.6, casterH(m.wall[i]));
        }
        if (a >= 0 && ra >= 0 && Math.abs(rb - a) < 1e-6 && rh === h) rb = b;
        else { if (ra >= 0) FX.shadowSeg(x + 0.5, ra, x + 0.5, rb, rh); ra = a; rb = b; rh = h; }
      }
    }
    // objetos
    const seenO = new Set();
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const oi = m.objAt[y * m.w + x];
      if (oi < 0 || seenO.has(oi)) continue;
      seenO.add(oi);
      const o = m.objects[oi];
      if (o.building) continue;
      const t = o.type;
      if (t === 'tree') FX.shadowTree(o.x + 0.5, o.y + 0.5, 4.3, 1.35, 3);
      else if (t === 'pine') { FX.shadowTree(o.x + 0.5, o.y + 0.5, 3.0, 0.95, 1.4); FX.shadowTree(o.x + 0.5, o.y + 0.5, 5.4, 0.5, 0.1); }
      else if (t === 'bush') FX.shadowTree(o.x + 0.5, o.y + 0.5, 0.4, 0.42, 0.1);
      else if (t === 'lamp_post') FX.shadowSeg(o.x + 0.45, o.y + 0.55, o.x + 0.55, o.y + 0.45, 3.9);
      else if (t === 'clothesline' || t === 'swing' || t === 'rug' || t === 'tire') continue;
      else {
        const h = (o.height || 0.4) * R.WALL_M;
        if (h < 0.15) continue;
        const ins = t === 'car' || t === 'pickup' || t === 'police_car' || t === 'ambulance' ? 0.12 : 0.1;
        FX.shadowBox(o.x + ins, o.y + ins, o.x + o.w - ins, o.y + o.h - ins, h);
      }
    }
    g.fillStyle = '#000';
    g.fill('nonzero');
    // interiores (sob telhado) não recebem sol
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    for (const b of m.buildings) {
      if (b.x > xb + 2 || b.x + b.w < xa - 2 || b.y > yb + 2 || b.y + b.h < ya - 2) continue;
      for (const pt of (b.parts && b.parts.length ? b.parts : [b])) {
        const x0 = pt.x + 0.5 + 0.09, y0 = pt.y + 0.5 + 0.09, x1 = pt.x + pt.w - 0.5 - 0.09, y1 = pt.y + pt.h - 0.5 - 0.09;
        g.moveTo((x0 - y0) * 32, (x0 + y0) * 16); g.lineTo((x1 - y0) * 32, (x1 + y0) * 16); g.lineTo((x1 - y1) * 32, (x1 + y1) * 16); g.lineTo((x0 - y1) * 32, (x0 + y1) * 16); g.closePath();
      }
    }
    g.fill();
    shX = saved;
    return c;
  }
  // Desenha as sombras estáticas visíveis no canvas de sombras (já iniciado com shadowBegin)
  FX.drawStaticShadows = function (view, target) {
    if (!shMap) return;
    shFrame++;
    const CW = R.ground.CW, CH = R.ground.CH, m = shMap;
    const key = sunKey();
    const mapX0 = -m.h * 32, mapX1 = m.w * 32, mapY1 = (m.w + m.h) * 16;
    const cx0 = Math.floor(Math.max(view.X0, mapX0) / CW), cx1 = Math.floor(Math.min(view.X1, mapX1) / CW);
    const cy0 = Math.floor(Math.max(view.Y0, 0) / CH), cy1 = Math.floor(Math.min(view.Y1, mapY1) / CH);
    let rebuilt = 0;
    const saved = target || shX;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cy * 8192 + cx + 4096;
      let ch = shChunks.get(k);
      if (!ch || (ch.key !== key && rebuilt < 2)) {
        ch = { c: buildShadowChunk(cx, cy), key, cx, cy, used: shFrame };
        shChunks.set(k, ch);
        rebuilt++;
      }
      ch.used = shFrame;
      saved.drawImage(ch.c, cx * CW, cy * CH, CW, CH);
    }
    if (shChunks.size > 60) {
      const arr = [...shChunks.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let k = 0; k < arr.length - 50; k++) shChunks.delete(arr[k][0]);
    }
  };
  FX.shadowEnd = function (ctx, alpha, cutouts) {
    shX.fillStyle = '#000';
    shX.fill('nonzero');
    shX.globalCompositeOperation = 'source-over';
    if (cutouts && cutouts.length) {
      shX.globalCompositeOperation = 'destination-out';
      shX.beginPath();
      for (const q of cutouts) { shX.moveTo(q[0], q[1]); for (let k = 2; k < q.length; k += 2) shX.lineTo(q[k], q[k + 1]); shX.closePath(); }
      shX.fill();
      shX.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shC, 0, 0, shW * 2, shH * 2);
    ctx.restore();
  };

  // ------------------------------------------------------------------
  // Decals (vistos de cima, projetados no chão)
  // ------------------------------------------------------------------
  const decalSpr = new Map();
  function decalSprite(type, v) {
    const key = type + v;
    let c = decalSpr.get(key);
    if (c) return c;
    const S = 64;
    c = R.canvas(S, S);
    const g = c.getContext('2d');
    const rng = U.rng(v * 977 + type.length * 13);
    g.translate(S / 2, S / 2);
    if (type === 'blood') {
      g.fillStyle = 'rgba(96,14,10,0.92)';
      g.beginPath();
      const n = 11;
      for (let k = 0; k <= n; k++) { const t = k / n * 6.283, r = S * (0.16 + rng() * 0.14); g.lineTo(Math.cos(t) * r, Math.sin(t) * r); }
      g.closePath(); g.fill();
      for (let k = 0; k < 9; k++) { const t = rng() * 6.283, r = S * (0.25 + rng() * 0.2); g.beginPath(); g.arc(Math.cos(t) * r, Math.sin(t) * r, 1 + rng() * 3, 0, 6.283); g.fill(); }
      g.fillStyle = 'rgba(140,30,24,0.4)'; g.beginPath(); g.arc(-3, -3, S * 0.08, 0, 6.283); g.fill();
    } else if (type === 'bloodpool') {
      const gr = g.createRadialGradient(0, 0, 2, 0, 0, S * 0.46);
      gr.addColorStop(0, 'rgba(62,8,6,0.95)'); gr.addColorStop(0.75, 'rgba(78,12,8,0.9)'); gr.addColorStop(1, 'rgba(78,12,8,0)');
      g.fillStyle = gr;
      g.beginPath();
      for (let k = 0; k <= 14; k++) { const t = k / 14 * 6.283, r = S * (0.34 + rng() * 0.12); g.lineTo(Math.cos(t) * r, Math.sin(t) * r); }
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(190,90,80,0.22)'; g.beginPath(); g.ellipse(-6, -8, 10, 4, -0.5, 0, 6.283); g.fill();
    } else if (type === 'glass') {
      for (let k = 0; k < 9; k++) {
        const x = (rng() - 0.5) * S * 0.8, y = (rng() - 0.5) * S * 0.8, r = 2 + rng() * 5;
        g.fillStyle = 'rgba(200,225,232,' + (0.45 + rng() * 0.4) + ')';
        g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.8, y + r * 0.3); g.lineTo(x - r * 0.5, y + r * 0.6); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - 0.5, y - r * 0.6, 1, 1);
      }
    } else if (type === 'footprint') {
      g.fillStyle = 'rgba(90,16,12,0.7)';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 7, s * 6, 4, 8, 0, 0, 6.283); g.fill(); g.beginPath(); g.ellipse(s * 7, s * 6 + 11, 3.2, 3.5, 0, 0, 6.283); g.fill(); }
    } else if (type === 'bullet') {
      g.fillStyle = 'rgba(30,28,26,0.5)'; g.beginPath(); g.arc(0, 0, 7, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(10,10,10,0.9)'; g.beginPath(); g.arc(0, 0, 2.5, 0, 6.283); g.fill();
    } else if (type === 'puddle') {
      const pts = [];
      for (let k = 0; k <= 14; k++) { const t = k / 14 * 6.283, r = S * (0.3 + rng() * 0.14); pts.push([Math.cos(t) * r, Math.sin(t) * r * 0.82]); }
      const path = () => { g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      // água escura com reflexo do céu (claro na borda de cima), borda molhada
      const gr = g.createLinearGradient(0, -S * 0.3, 0, S * 0.3);
      gr.addColorStop(0, 'rgba(150,165,180,0.75)'); gr.addColorStop(0.35, 'rgba(70,82,96,0.8)'); gr.addColorStop(1, 'rgba(40,48,58,0.85)');
      path(); g.fillStyle = gr; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(20,24,28,0.35)'; g.stroke();
      g.fillStyle = 'rgba(230,238,245,0.35)'; g.beginPath(); g.ellipse(-S * 0.08, -S * 0.12, S * 0.14, S * 0.025, -0.3, 0, 6.283); g.fill();
    } else {
      g.fillStyle = 'rgba(60,40,30,0.6)'; g.beginPath(); g.arc(0, 0, S * 0.3, 0, 6.283); g.fill();
    }
    decalSpr.set(key, c);
    return c;
  }
  FX.drawDecals = function (ctx, s, view, zoomT) {
    const ds = s.decals;
    if (!ds || !ds.length) return;
    if (ds.length > 1200) ds.splice(0, ds.length - 1000);
    const seen = R.light.seen(), m = s.map;
    const now = s.time;
    for (let k = 0; k < ds.length; k++) {
      const d = ds[k];
      const X = (d.x - d.y) * 32, Y = (d.x + d.y) * 16;
      if (X < view.X0 - 64 || X > view.X1 + 64 || Y < view.Y0 - 40 || Y > view.Y1 + 40) continue;
      const tx = Math.floor(d.x), ty = Math.floor(d.y);
      if (seen && tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && !seen[ty * m.w + tx] && R.light.opts.fov) continue;
      const age = Math.max(0, now - (d.t || 0));
      const a = (d.alpha != null ? d.alpha : 0.9) * Math.max(0.35, 1 - age / 4320);
      const v = (((d.x * 7919 + d.y * 104729) | 0) & 7);
      const spr = decalSprite(d.type || 'blood', v);
      const sz = (d.size || 0.5);
      const c = Math.cos(d.rot || 0) * sz / 64, sn = Math.sin(d.rot || 0) * sz / 64;
      // mundo: (u,v) do sprite → rotação/escala → iso
      const ax = c, ay = sn, bx = -sn, by = c;
      ctx.setTransform(zoomT.a * (ax - ay) * 32, zoomT.a * (ax + ay) * 16, zoomT.a * (bx - by) * 32, zoomT.a * (bx + by) * 16, zoomT.a * X + zoomT.e, zoomT.a * Y + zoomT.f);
      ctx.globalAlpha = a;
      ctx.drawImage(spr, -32, -32);
    }
    ctx.globalAlpha = 1;
  };

  // Poças quando molhado (posições fixas por hash) — reflexo do céu + anéis de chuva
  FX.drawPuddles = function (ctx, s, tiles, n, zoomT) {
    const e = R.light.env;
    if (e.wet < 0.25) return;
    const m = s.map;
    const a0 = U.smoothstep(0.25, 0.8, e.wet);
    const spr = decalSprite('puddle', 3), spr2 = decalSprite('puddle', 5);
    const sky = 'rgba(' + Math.round(150 + 80 * e.lum) + ',' + Math.round(165 + 70 * e.lum) + ',' + Math.round(185 + 60 * e.lum) + ',';
    for (let k = 0; k < n; k++) {
      const i = tiles[k];
      const x = i % m.w, y = (i / m.w) | 0;
      const f = m.floor[i];
      if (!(f === F.ASPHALT || f === F.DIRT || f === F.GRAVEL || f === F.CONCRETE && !m.building[i])) continue;
      const h = R.hash(x, y, 777);
      if (h > 0.085) continue;
      const cx = x + 0.3 + R.hash(x, y, 778) * 0.4, cy = y + 0.3 + R.hash(x, y, 779) * 0.4;
      const sz = 0.7 + h * 8;
      const X = (cx - cy) * 32, Y = (cx + cy) * 16;
      const c = sz / 64;
      ctx.setTransform(zoomT.a * c * 32, zoomT.a * c * 16, -zoomT.a * c * 32, zoomT.a * c * 16, zoomT.a * X + zoomT.e, zoomT.a * Y + zoomT.f);
      ctx.globalAlpha = 0.62 * a0;
      ctx.drawImage(h < 0.04 ? spr : spr2, -32, -32);
    }
    ctx.globalAlpha = 1;
    void sky;
  };

  // ------------------------------------------------------------------
  // Partículas
  // ------------------------------------------------------------------
  FX.updateParticles = function (s, dt) {
    const ps = s.particles;
    if (!ps || !ps.length) return;
    let n = ps.length;
    for (let k = 0; k < n; k++) {
      const p = ps[k];
      p.life -= dt;
      if (!(p.life > 0)) { ps[k] = ps[n - 1]; n--; k--; continue; }
      const t = p.type;
      if (t === 'smoke' || t === 'dust') {
        p.vx *= 1 - dt * 1.5; p.vy *= 1 - dt * 1.5;
        p.vz = (p.vz || 0) * (1 - dt * 2) + (t === 'smoke' ? 0.5 : 0.1) * dt;
      } else if (t !== 'muzzle') p.vz = (p.vz || 0) - 9.8 * dt;
      p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.z = (p.z || 0) + (p.vz || 0) * dt;
      if (p.z < 0) {
        p.z = 0;
        if (t === 'blood') {
          if (!p._landed && s.decals && rnd() < 0.35) s.decals.push({ x: p.x, y: p.y, type: 'blood', size: 0.12 + rnd() * 0.12, rot: rnd() * 6.28, alpha: 0.85, t: s.time });
          p._landed = true; p.life = Math.min(p.life, 0.05);
        } else if (t === 'shell' || t === 'glass' || t === 'wood' || t === 'spark') {
          p.vz = -p.vz * 0.35; p.vx *= 0.5; p.vy *= 0.5;
          if (t === 'spark') p.life = Math.min(p.life, 0.08);
        } else p.vz = 0;
      }
    }
    ps.length = n;
    if (ps.length > 900) ps.splice(0, ps.length - 900);
  };
  FX.drawParticles = function (ctx, s, emissive) {
    const ps = s.particles;
    if (!ps || !ps.length) return;
    const fov = G.fov;
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      const t = p.type;
      const em = t === 'spark' || t === 'muzzle';
      if (em !== !!emissive) continue;
      if (R.light.opts.fov && fov.visAt(p.x, p.y) < 0.05) continue;
      const X = (p.x - p.y) * 32, Y = (p.x + p.y) * 16 - (p.z || 0) * ZPX;
      const lf = p.maxLife ? U.clamp(p.life / p.maxLife, 0, 1) : 1;
      const sz = p.size || 2;
      switch (t) {
        case 'blood': ctx.fillStyle = 'rgba(110,16,12,' + (0.4 + lf * 0.6) + ')'; ctx.beginPath(); ctx.arc(X, Y, sz * 0.55, 0, 6.283); ctx.fill(); break;
        case 'glass': ctx.fillStyle = (k + ((s.realTime * 20) | 0)) % 5 === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(190,220,230,' + (0.5 + lf * 0.4) + ')'; ctx.fillRect(X - sz * 0.4, Y - sz * 0.4, sz * 0.8, sz * 0.6); break;
        case 'wood': ctx.fillStyle = p.color || '#7a5a3a'; ctx.save(); ctx.translate(X, Y); ctx.rotate((p.life * 9) % 6.28); ctx.fillRect(-sz, -sz * 0.3, sz * 2, sz * 0.6); ctx.restore(); break;
        case 'dust': ctx.fillStyle = 'rgba(150,140,120,' + (lf * 0.35) + ')'; ctx.beginPath(); ctx.arc(X, Y, sz * (2.2 - lf), 0, 6.283); ctx.fill(); break;
        case 'smoke': ctx.fillStyle = 'rgba(120,120,118,' + (lf * 0.3) + ')'; ctx.beginPath(); ctx.arc(X, Y, sz * (3 - lf * 1.5), 0, 6.283); ctx.fill(); break;
        case 'shell': ctx.fillStyle = '#c8a040'; ctx.fillRect(X - 1, Y - 0.6, 2, 1.2); break;
        case 'spark': {
          ctx.strokeStyle = 'rgba(255,' + (170 + lf * 80 | 0) + ',80,' + lf + ')'; ctx.lineWidth = 1.2;
          const vx = ((p.vx || 0) - (p.vy || 0)) * 32 * 0.03, vy = ((p.vx || 0) + (p.vy || 0)) * 16 * 0.03 - (p.vz || 0) * ZPX * 0.03;
          ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - vx, Y - vy); ctx.stroke(); break;
        }
        case 'muzzle': {
          const r = sz * 3 * (0.6 + lf);
          const g = ctx.createRadialGradient(X, Y, 0, X, Y, r);
          g.addColorStop(0, 'rgba(255,250,220,' + lf + ')'); g.addColorStop(0.3, 'rgba(255,200,90,' + lf * 0.8 + ')'); g.addColorStop(1, 'rgba(255,140,40,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, r, 0, 6.283); ctx.fill();
          break;
        }
        default: ctx.fillStyle = p.color || 'rgba(200,200,200,0.6)'; ctx.fillRect(X - 1, Y - 1, 2, 2);
      }
    }
  };

  // ------------------------------------------------------------------
  // Chuva, respingos, folhas (partículas privadas em tela)
  // ------------------------------------------------------------------
  const DROPS = 650;
  const drops = new Float32Array(DROPS * 4); // x, y, len, speed
  let dropsInit = false;
  const splashes = []; // {x,y,t}
  const leaves = [];
  FX.drawRain = function (ctx, W, H, dt, s, exclude, cam) {
    const e = R.light.env;
    const n = Math.round(DROPS * e.rain);
    if (!dropsInit) { for (let k = 0; k < DROPS; k++) { drops[k * 4] = rnd() * W; drops[k * 4 + 1] = rnd() * H; drops[k * 4 + 2] = 10 + rnd() * 16; drops[k * 4 + 3] = 700 + rnd() * 500; } dropsInit = true; }
    const wind = 0.25 + e.wind * 0.9;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (exclude && exclude.length > 4) {
      ctx.beginPath(); ctx.rect(0, 0, W, H);
      ctx.moveTo(exclude[0], exclude[1]); for (let k = 2; k < exclude.length; k += 2) ctx.lineTo(exclude[k], exclude[k + 1]); ctx.closePath();
      ctx.clip('evenodd');
    }
    if (n > 0) {
      const L = Math.min(1, 0.3 + e.lum * 0.8);
      ctx.strokeStyle = 'rgba(' + Math.round(170 * L + 40) + ',' + Math.round(180 * L + 45) + ',' + Math.round(200 * L + 50) + ',' + (0.22 + e.rain * 0.18).toFixed(2) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const o = k * 4;
        let x = drops[o], y = drops[o + 1];
        const len = drops[o + 2], sp = drops[o + 3];
        y += sp * dt; x += sp * dt * wind * 0.35;
        if (y > H + 20) { y = -20 - rnd() * 60; x = rnd() * (W + 200) - 200 * wind; }
        if (x > W + 40) x -= W + 80;
        drops[o] = x; drops[o + 1] = y;
        ctx.moveTo(x, y); ctx.lineTo(x - len * wind * 0.35, y - len);
      }
      ctx.stroke();
      // respingos: nascem no chão (tela) em tiles externos
      const want = e.rain * 90 * dt * (W * H / 921600);
      let spawn = Math.floor(want) + (rnd() < want % 1 ? 1 : 0);
      while (spawn-- > 0 && splashes.length < 160) {
        const sx = rnd() * W, sy = rnd() * H;
        const w = G.iso.toWorld(sx, sy, cam);
        const m = s.map;
        const tx = Math.floor(w.x), ty = Math.floor(w.y);
        if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) continue;
        const i = ty * m.w + tx;
        if (m.building[i] || m.wall[i]) continue;
        splashes.push({ x: sx, y: sy, t: 0, water: m.floor[i] === F.WATER || m.floor[i] === F.POOL });
      }
    }
    if (splashes.length) {
      ctx.strokeStyle = 'rgba(200,215,230,' + (0.25 + e.lum * 0.25).toFixed(2) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = splashes.length - 1; k >= 0; k--) {
        const sp = splashes[k];
        sp.t += dt;
        if (sp.t > 0.3) { splashes.splice(k, 1); continue; }
        const r = (sp.water ? 3 : 1.5) + sp.t * (sp.water ? 22 : 12);
        ctx.moveTo(sp.x + r, sp.y); ctx.ellipse(sp.x, sp.y, r, r * 0.45, 0, 0, 6.283);
      }
      ctx.stroke();
    }
    ctx.restore();
  };
  FX.drawLeaves = function (ctx, W, H, dt) {
    const e = R.light.env;
    const want = e.wind > 0.35 && e.lum > 0.3 ? (e.wind - 0.3) * 18 : 0;
    if (leaves.length < want && rnd() < dt * 3) leaves.push({ x: -20, y: rnd() * H * 0.9, vx: 60 + rnd() * 80, vy: 10 + rnd() * 20, r: rnd() * 6, c: ['#6a7a3a', '#8a7a3a', '#9a6a32', '#5a6a30'][(rnd() * 4) | 0], ph: rnd() * 6 });
    if (!leaves.length) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = leaves.length - 1; k >= 0; k--) {
      const l = leaves[k];
      l.ph += dt * 4;
      l.x += (l.vx * (0.6 + e.wind)) * dt; l.y += (l.vy + Math.sin(l.ph) * 30) * dt; l.r += dt * 5;
      if (l.x > W + 20 || l.y > H + 20) { leaves.splice(k, 1); continue; }
      ctx.fillStyle = l.c;
      ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.r); ctx.scale(1, Math.abs(Math.sin(l.ph)) * 0.8 + 0.2);
      ctx.beginPath(); ctx.ellipse(0, 0, 3, 1.6, 0, 0, 6.283); ctx.fill(); ctx.restore();
    }
    ctx.restore();
  };

  // ------------------------------------------------------------------
  // Neblina: camadas de ruído em movimento + névoa por distância
  // ------------------------------------------------------------------
  let fogTex = null, fogPat = null;
  function makeFog() {
    const S = 256;
    fogTex = R.canvas(S, S);
    const g = fogTex.getContext('2d');
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // ruído com período S (tileável) somando oitavas
      let v = 0, a = 0.6, f = 3;
      for (let o = 0; o < 3; o++) {
        const nx = x / S * f, ny = y / S * f;
        const x0 = Math.floor(nx), y0 = Math.floor(ny), fx = nx - x0, fy = ny - y0;
        const h = (i, j) => R.hash(((i % f) + f) % f, ((j % f) + f) % f, 300 + o);
        const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
        v += a * U.lerp(U.lerp(h(x0, y0), h(x0 + 1, y0), u), U.lerp(h(x0, y0 + 1), h(x0 + 1, y0 + 1), u), w);
        a *= 0.5; f *= 2;
      }
      const p = (y * S + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = 255;
      d[p + 3] = Math.max(0, Math.min(255, (v - 0.25) * 1.25 * 255));
    }
    g.putImageData(img, 0, 0);
  }
  FX.drawFog = function (ctx, W, H, cam, px, py) {
    const e = R.light.env;
    const f = e.fog;
    if (f + e.rain * 0.25 < 0.12) return;
    const fc = e.fogCol;
    const col = 'rgb(' + fc[0] + ',' + fc[1] + ',' + fc[2] + ')';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // névoa por distância ao jogador
    const amt = Math.min(1, f * 1.05 + e.rain * 0.25);
    const r0 = (1 - amt) * 480 * cam.zoom + 110 * cam.zoom, r1 = r0 + 520 * cam.zoom * (1.2 - amt * 0.5);
    const g = ctx.createRadialGradient(px, py, r0 * 0.2, px, py, r1);
    g.addColorStop(0, 'rgba(' + fc[0] + ',' + fc[1] + ',' + fc[2] + ',0)');
    g.addColorStop(0.35, 'rgba(' + fc[0] + ',' + fc[1] + ',' + fc[2] + ',' + (amt * 0.18).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + fc[0] + ',' + fc[1] + ',' + fc[2] + ',' + (amt * 0.92).toFixed(3) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // camadas em movimento
    if (!fogTex) makeFog();
    if (!fogPat) fogPat = ctx.createPattern(fogTex, 'repeat');
    ctx.globalCompositeOperation = 'source-over';
    for (let L = 0; L < (f > 0.25 ? 2 : 0); L++) {
      const sc = (L ? 5.5 : 3.8) * cam.zoom;
      const sp = (L ? 9 : 5) * (0.4 + e.wind);
      const ox = -((cam.ox * (L ? 0.9 : 0.7) + e.t * sp * 3) % (256 * sc)), oy = -((cam.oy * (L ? 0.9 : 0.7) + e.t * sp) % (256 * sc));
      ctx.globalAlpha = f * (L ? 0.26 : 0.34);
      ctx.setTransform(sc, 0, 0, sc, ox, oy);
      ctx.fillStyle = fogPat;
      ctx.fillRect(-256, -256, W / sc + 512, H / sc + 512);
    }
    // tinge as camadas com a cor da névoa (multiplica o branco pelo tom)
    ctx.restore();
    if (f > 0.25) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = f * 0.35;
      ctx.fillStyle = col; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  };

  // ------------------------------------------------------------------
  // Pós-processamento
  // ------------------------------------------------------------------
  let vig = null, vigW = 0, vigH = 0, grain = null, grainPat = null;
  FX.post = function (ctx, W, H, s) {
    const e = R.light.env;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // relâmpago: clarão branco-azulado
    if (e.flash > 0.02) { ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(180,195,255,' + Math.min(0.5, e.flash * 0.32).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
    // (a correção de cor por hora já está embutida na paleta de luz ambiente — render-light.js)
    // vinheta
    if (!vig || vigW !== W || vigH !== H) {
      vigW = W; vigH = H; vig = R.canvas(W, H);
      const g = vig.getContext('2d');
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.56);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.62)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.75 + e.night * 0.25;
    ctx.drawImage(vig, 0, 0);
    // grão
    if (!grain) {
      // grão: pontinhos claros e escuros quase transparentes (source-over é barato)
      grain = R.canvas(128, 128);
      const g = grain.getContext('2d'), img = g.createImageData(128, 128), d = img.data;
      for (let p = 0; p < d.length; p += 4) { const v = rnd(); const b = v < 0.5 ? 0 : 255; d[p] = d[p + 1] = d[p + 2] = b; d[p + 3] = (Math.abs(v - 0.5) * 2) ** 3 * 44; }
      g.putImageData(img, 0, 0);
      grainPat = ctx.createPattern(grain, 'repeat');
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.4 + e.night * 0.35;
    ctx.translate((rnd() * 128) | 0, (rnd() * 128) | 0);
    ctx.fillStyle = grainPat;
    ctx.fillRect(-128, -128, W + 256, H + 256);
    ctx.restore();
  };
})();
