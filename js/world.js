/* =====================================================================
 * VALE QUIETO — world.js  (Etapa 1: Mundo)
 * Geração procedural determinística da cidadezinha "Vale Quieto" e
 * API de consulta/colisão/visão/caminho do mapa (G.world).
 *
 * Organização:
 *   1. Definições de objetos e utilidades
 *   2. "Plan": grade local para montar um lote (casa/loja + quintal) em
 *      orientação canônica (frente para +y) — depois é carimbada no mapa
 *      com rotação conforme o lado da rua.
 *   3. Geradores de prédios (casa, mercado, farmácia, posto, ...)
 *   4. Layout global (ruas, lotes, lago, fazenda, cemitério, floresta)
 *   5. API em tempo de jogo (colisão, visão, estruturas, A*)
 *
 * Convenções próprias (documentadas em docs/NOTES.md):
 *   rot de objeto = direção para onde a FRENTE aponta: 0:+x 1:+y 2:-x 3:-y
 *   (carros: rot = sentido do capô; pegada 2×1 se rot par, 1×2 se ímpar).
 *   height = altura visual relativa à parede (0..1; árvores > 1).
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, C = G.CONST, F = G.FLOOR, W = G.WALL, WS = G.WS, U = G.util;
  const WD = (G.world = {});

  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  // ------------------------------------------------------------------
  // 1. Definições de objetos
  // a = extensão ao longo da parede, d = profundidade (na direção da frente)
  // cont = [nome do contêiner, capacidade kg]; light = luz emitida
  // ------------------------------------------------------------------
  const ODEF = {
    bed:              { a: 1, d: 2, block: 1, ht: 0.3 },
    double_bed:       { a: 2, d: 2, block: 1, ht: 0.3 },
    sofa:             { a: 2, d: 1, block: 1, ht: 0.4 },
    armchair:         { a: 1, d: 1, block: 1, ht: 0.4 },
    table:            { a: 2, d: 1, block: 1, ht: 0.4 },
    chair:            { a: 1, d: 1, block: 1, ht: 0.45 },
    counter:          { a: 1, d: 1, block: 1, ht: 0.45, cont: ['Balcão', 20] },
    kitchen_counter:  { a: 1, d: 1, block: 1, ht: 0.45, cont: ['Armário de cozinha', 15] },
    fridge:           { a: 1, d: 1, block: 1, ht: 0.9, tall: 1, cont: ['Geladeira', 20] },
    stove:            { a: 1, d: 1, block: 1, ht: 0.45, cont: ['Forno', 8] },
    sink:             { a: 1, d: 1, block: 1, ht: 0.45, cont: ['Gabinete da pia', 6] },
    toilet:           { a: 1, d: 1, block: 1, ht: 0.35 },
    bathtub:          { a: 2, d: 1, block: 1, ht: 0.35 },
    shower:           { a: 1, d: 1, block: 1, ht: 0.95, tall: 1 },
    wardrobe:         { a: 1, d: 1, block: 1, ht: 0.95, tall: 1, cont: ['Guarda-roupa', 30] },
    dresser:          { a: 1, d: 1, block: 1, ht: 0.5, cont: ['Cômoda', 20] },
    bookshelf:        { a: 1, d: 1, block: 1, ht: 0.95, tall: 1, cont: ['Estante', 15] },
    tv:               { a: 1, d: 1, block: 1, ht: 0.5 },
    desk:             { a: 2, d: 1, block: 1, ht: 0.45, cont: ['Escrivaninha', 10] },
    shelf:            { a: 1, d: 1, block: 1, ht: 0.85, tall: 1, sight: 1, cont: ['Prateleira', 25] },
    cash_register:    { a: 1, d: 1, block: 1, ht: 0.55, cont: ['Caixa registradora', 3] },
    crate:            { a: 1, d: 1, block: 1, ht: 0.5, cont: ['Caixote', 30] },
    trash_can:        { a: 1, d: 1, block: 1, ht: 0.4, cont: ['Lixeira', 10] },
    dumpster:         { a: 2, d: 1, block: 1, ht: 0.55, cont: ['Caçamba', 60] },
    car:              { a: 1, d: 2, block: 1, ht: 0.6, cont: ['Porta-malas', 40] },
    police_car:       { a: 1, d: 2, block: 1, ht: 0.65, cont: ['Porta-malas', 40] },
    ambulance:        { a: 1, d: 2, block: 1, ht: 0.8, cont: ['Ambulância', 50] },
    tree:             { a: 1, d: 1, block: 1, ht: 2.6 },
    pine:             { a: 1, d: 1, block: 1, ht: 3.0 },
    bush:             { a: 1, d: 1, block: 0, ht: 0.6 },
    rock:             { a: 1, d: 1, block: 1, ht: 0.35 },
    lamp_post:        { a: 1, d: 1, block: 1, ht: 1.6, light: { radius: 7, color: '#ffd9a0', needsPower: true } },
    mailbox:          { a: 1, d: 1, block: 1, ht: 0.5, cont: ['Caixa de correio', 1] },
    bench:            { a: 2, d: 1, block: 1, ht: 0.35 },
    fuel_pump:        { a: 1, d: 1, block: 1, ht: 0.8, light: { radius: 3, color: '#fff2c8', needsPower: true } },
    washing_machine:  { a: 1, d: 1, block: 1, ht: 0.5, cont: ['Máquina de lavar', 8] },
    workbench:        { a: 2, d: 1, block: 1, ht: 0.5, cont: ['Bancada', 25] },
    barrel:           { a: 1, d: 1, block: 1, ht: 0.5 },
    log_pile:         { a: 2, d: 1, block: 1, ht: 0.4 },
    lamp:             { a: 1, d: 1, block: 1, ht: 0.8, light: { radius: 4, color: '#ffcf8a', needsPower: true } },
    plant:            { a: 1, d: 1, block: 1, ht: 0.6 },
    rug:              { a: 2, d: 2, block: 0, ht: 0 },
    fence_gate:       { a: 1, d: 1, block: 0, ht: 0.5 },
    picnic_table:     { a: 2, d: 1, block: 1, ht: 0.4 },
    swing:            { a: 2, d: 1, block: 1, ht: 1.0 },
    grave:            { a: 1, d: 1, block: 1, ht: 0.35 },
    locker:           { a: 1, d: 1, block: 1, ht: 0.95, tall: 1, cont: ['Armário', 15] },
    gun_locker:       { a: 1, d: 1, block: 1, ht: 0.95, tall: 1, cont: ['Armário de armas', 20] },
    medicine_cabinet: { a: 1, d: 1, block: 0, ht: 0.9, cont: ['Armário de remédios', 3] },
    vending_machine:  { a: 1, d: 1, block: 1, ht: 0.95, tall: 1, sight: 1, cont: ['Máquina de venda', 10], light: { radius: 2, color: '#a8dcff', needsPower: true } },
    freezer:          { a: 1, d: 1, block: 1, ht: 0.95, tall: 1, cont: ['Freezer', 25] },
    pallet:           { a: 1, d: 1, block: 1, ht: 0.15 },
    tire:             { a: 1, d: 1, block: 0, ht: 0.2 },
  };
  WD.OBJECT_DEFS = ODEF;

  // Largura/altura da pegada no mundo dado a (ao longo da parede), d (profund.) e rot
  function footW(a, d, rot) { return rot & 1 ? a : d; }
  function footH(a, d, rot) { return rot & 1 ? d : a; }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  const isDoorW = (w) => w === W.DOOR || w === W.GARAGE_DOOR;
  const isWinW = (w) => w === W.WINDOW || w === W.GLASS;
  const isFenceW = (w) => w === W.FENCE_WOOD || w === W.FENCE_METAL;
  WD.isDoorType = isDoorW; WD.isWindowType = isWinW;

  // Vida padrão de estruturas
  const HP = { door: 100, garage: 160, window: 12, glass: 18, fence_wood: 70, fence_metal: 140, hedge: 90 };
  const PLANK_HP = 30; // vida de cada tábua de barricada
  function baseHp(w) {
    switch (w) {
      case W.DOOR: return HP.door; case W.GARAGE_DOOR: return HP.garage;
      case W.WINDOW: return HP.window; case W.GLASS: return HP.glass;
      case W.FENCE_WOOD: return HP.fence_wood; case W.FENCE_METAL: return HP.fence_metal;
      case W.HEDGE: return HP.hedge; default: return 0;
    }
  }

  // ------------------------------------------------------------------
  // 2. Plan — grade local de um lote. Frente (rua) em y = h-1 (+y).
  // ------------------------------------------------------------------
  function Plan(w, h, rng) {
    this.w = w; this.h = h; this.rng = rng;
    const n = w * h;
    this.floor = new Uint8Array(n);          // 0 = não altera o piso do mapa
    this.wall = new Uint8Array(n);
    this.ws = new Uint8Array(n);
    this.room = new Int16Array(n).fill(-1);  // índice local de cômodo
    this.bld = new Uint8Array(n);            // 1..k = prédio local (telhado)
    this.obj = new Int16Array(n).fill(-1);   // índice em objs
    this.resv = new Uint8Array(n);           // 1 = manter livre (frente de porta, caminho)
    this.objs = []; this.rooms = []; this.blds = [];
    this.zspawn = [];                         // pontos locais de zumbi {x,y,weight}
  }
  const PP = Plan.prototype;
  PP.ok = function (x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; };
  PP.fill = function (x, y, w, h, fl) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.ok(i, j)) this.floor[j * this.w + i] = fl;
  };
  PP.addBuilding = function (info) { this.blds.push(info); info.doors = []; return this.blds.length; };
  PP.foot = function (b, x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.ok(i, j)) this.bld[j * this.w + i] = b;
  };
  // Cômodo: retângulo INTERIOR (sem paredes)
  PP.addRoom = function (b, type, x, y, w, h, floor) {
    const r = { i: this.rooms.length, b, type, x, y, w, h, floor, doors: [] };
    this.rooms.push(r);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const k = j * this.w + i; this.room[k] = r.i; this.floor[k] = floor; this.bld[k] = b;
    }
    return r;
  };
  // Toda célula do prédio b que não é cômodo vira parede (externa ou interna)
  PP.buildWalls = function (b, outer, inner, baseFloor) {
    const w = this.w, h = this.h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (this.bld[k] !== b || this.room[k] >= 0 || this.wall[k]) continue;
      let ext = false;
      for (let dy = -1; dy <= 1 && !ext; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!this.ok(nx, ny) || this.bld[ny * w + nx] !== b) { ext = true; break; }
      }
      this.wall[k] = ext ? outer : inner;
      this.floor[k] = baseFloor;
    }
  };
  PP.at = function (x, y) { return this.ok(x, y) ? this.room[y * this.w + x] : -2; };
  PP.isOut = function (x, y) { return this.ok(x, y) && this.bld[y * this.w + x] === 0 && this.wall[y * this.w + x] === 0; };
  // Parede reta (vizinhos ao longo da parede também são paredes)
  PP.straight = function (x, y, nx, ny) {
    const ax = x + ny, ay = y + nx, bx = x - ny, by = y - nx;
    return this.ok(ax, ay) && this.ok(bx, by) && this.wall[ay * this.w + ax] !== 0 && this.wall[by * this.w + bx] !== 0 &&
      this.room[ay * this.w + ax] < 0 && this.room[by * this.w + bx] < 0;
  };
  PP.nearOpening = function (x, y) { // porta/janela a 1 tile (4-viz.)
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!this.ok(nx, ny)) continue;
      const wv = this.wall[ny * this.w + nx];
      if (isDoorW(wv) || isWinW(wv)) return true;
    }
    return false;
  };
  // Candidatos de parede entre dois cômodos (ou cômodo e exterior quando rb = null)
  PP.wallCells = function (ra, rb) {
    const out = [], w = this.w;
    for (let y = 1; y < this.h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      if (!this.wall[k] || this.wall[k] === W.GARAGE_DOOR || isDoorW(this.wall[k]) || isWinW(this.wall[k])) continue;
      for (let d = 0; d < 2; d++) {
        const ax = x + DX[d], ay = y + DY[d], bx = x - DX[d], by = y - DY[d];
        const A = this.room[ay * w + ax], B = this.room[by * w + bx];
        let ok = false, nx = 0, ny = 0;
        if (rb) {
          if (A === ra.i && B === rb.i) { ok = true; nx = DX[d]; ny = DY[d]; }
          else if (B === ra.i && A === rb.i) { ok = true; nx = -DX[d]; ny = -DY[d]; }
        } else {
          if (A === ra.i && this.isOut(bx, by)) { ok = true; nx = DX[d]; ny = DY[d]; }
          else if (B === ra.i && this.isOut(ax, ay)) { ok = true; nx = -DX[d]; ny = -DY[d]; }
        }
        // (nx,ny) aponta da parede para dentro de ra
        if (ok && this.straight(x, y, nx, ny)) out.push({ x, y, nx, ny });
      }
    }
    return out;
  };
  PP.reserveAround = function (x, y) {
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (this.ok(nx, ny) && !this.wall[ny * this.w + nx]) this.resv[ny * this.w + nx] = 1;
    }
  };
  // Porta entre cômodos. pref: função de pontuação (menor = melhor)
  PP.door = function (ra, rb, opts) {
    opts = opts || {};
    let cands = this.wallCells(ra, rb).filter((c) => !this.nearOpening(c.x, c.y) && !(opts.noFront && c.ny === -1));
    if (!cands.length) return null;
    const rng = this.rng;
    const score = opts.score || ((c) => {
      // prefere o meio da parede compartilhada, com leve aleatoriedade
      return rng() * 2;
    });
    cands.sort((p, q) => score(p) - score(q));
    const c = cands[0], k = c.y * this.w + c.x;
    this.wall[k] = opts.garage ? W.GARAGE_DOOR : W.DOOR;
    this.ws[k] = (opts.locked ? WS.LOCKED : 0) | (opts.open ? WS.OPEN : 0);
    this.floor[k] = ra.floor;
    this.reserveAround(c.x, c.y);
    const d = { x: c.x, y: c.y, nx: c.nx, ny: c.ny, ext: !rb, a: ra.i, b: rb ? rb.i : -1 };
    ra.doors.push(d); if (rb) rb.doors.push(d);
    if (!rb) this.blds[ra.b - 1].doors.push(d);
    return d;
  };
  // Abertura sem porta (arco) entre cômodos, largura n
  PP.opening = function (ra, rb, n) {
    const cands = this.wallCells(ra, rb);
    if (!cands.length) return false;
    const c = cands[Math.floor(cands.length / 2)];
    const run = [c];
    for (let s = 1; run.length < n; s++) {
      const nx = c.x + c.ny * s, ny = c.y + c.nx * s;
      if (!cands.some((q) => q.x === nx && q.y === ny)) break;
      run.push({ x: nx, y: ny });
    }
    for (const q of run) {
      const k = q.y * this.w + q.x;
      this.wall[k] = 0; this.room[k] = ra.i; this.floor[k] = ra.floor;
      this.reserveAround(q.x, q.y); this.resv[k] = 1;
    }
    const d = { x: c.x, y: c.y, arch: true, a: ra.i, b: rb.i };
    ra.doors.push(d); rb.doors.push(d);
    return true;
  };
  // Janelas nas paredes externas do cômodo. every: espaçamento aproximado
  PP.windows = function (r, opts) {
    opts = opts || {};
    const rng = this.rng, cands = this.wallCells(r, null);
    let placed = 0;
    shuffle(cands, rng);
    const kind = opts.glass ? W.GLASS : W.WINDOW;
    const maxN = opts.max != null ? opts.max : 99;
    for (const c of cands) {
      if (placed >= maxN) break;
      if (opts.side != null && !opts.side(c)) continue;
      if (this.nearOpening(c.x, c.y) && !opts.glass) continue;
      if (!opts.glass && rng() > (opts.p != null ? opts.p : 0.55)) continue;
      const k = c.y * this.w + c.x;
      this.wall[k] = kind;
      let st = 0;
      if (opts.curtain && rng() < opts.curtain) st |= WS.CURTAIN;
      if (opts.broken && rng() < opts.broken) st |= WS.BROKEN;
      this.ws[k] = st; this.floor[k] = r.floor;
      placed++;
    }
    return placed;
  };

  PP.keepWindowClear = function (r) {
    const list = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (x !== r.x && y !== r.y && x !== r.x + r.w - 1 && y !== r.y + r.h - 1) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (this.ok(nx, ny) && isWinW(this.wall[ny * this.w + nx])) list.push(y * this.w + x);
      }
    }
    if (list.length) this.resv[list[Math.floor(this.rng() * list.length)]] = 1;
  };

  // ---------------- mobília ----------------
  PP.free = function (x, y, r) {
    if (!this.ok(x, y)) return false;
    const k = y * this.w + x;
    return this.room[k] === r.i && this.obj[k] < 0 && !this.resv[k] && !this.wall[k];
  };
  PP.fits = function (x, y, w, h, r) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (!this.free(i, j, r)) return false;
    return true;
  };
  PP.put = function (type, x, y, w, h, rot, extra) {
    const o = { type, x, y, w, h, rot: rot | 0, variant: Math.floor(this.rng() * 8), extra: extra || null };
    const id = this.objs.length;
    this.objs.push(o);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.ok(i, j)) this.obj[j * this.w + i] = id;
    return id;
  };
  PP.unputLast = function () {
    const o = this.objs.pop(), id = this.objs.length;
    for (let j = o.y; j < o.y + o.h; j++) for (let i = o.x; i < o.x + o.w; i++) if (this.ok(i, j) && this.obj[j * this.w + i] === id) this.obj[j * this.w + i] = -1;
  };
  PP.blockingAt = function (k) {
    const o = this.obj[k];
    return o >= 0 && ODEF[this.objs[o].type].block;
  };
  // Verifica se as células livres do cômodo continuam conectadas e todo contêiner é alcançável
  const _q = new Int32Array(4096);
  PP.roomOk = function (r) {
    const w = this.w;
    let start = -1, total = 0;
    const seen = this._seen || (this._seen = new Uint8Array(this.w * this.h));
    seen.fill(0);
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (!this.ok(x, y)) continue;
      const k = y * w + x;
      if (this.room[k] !== r.i || this.wall[k] || this.blockingAt(k)) continue;
      total++; if (start < 0) start = k;
    }
    if (start < 0) return false;
    let qh = 0, qt = 0, cnt = 0;
    _q[qt++] = start; seen[start] = 1;
    while (qh < qt) {
      const k = _q[qh++]; cnt++;
      const x = k % w, y = (k / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!this.ok(nx, ny)) continue;
        const nk = ny * w + nx;
        if (seen[nk] || this.room[nk] !== r.i || this.wall[nk] || this.blockingAt(nk)) continue;
        seen[nk] = 1; _q[qt++] = nk;
      }
    }
    if (cnt !== total) return false;
    // contêineres/camas/etc. precisam de ao menos uma célula livre alcançável ao lado
    for (let oi = 0; oi < this.objs.length; oi++) {
      const o = this.objs[oi];
      if (o.room !== r.i || !ODEF[o.type].block) continue;
      let acc = false;
      for (let j = o.y - 1; j <= o.y + o.h && !acc; j++) for (let i = o.x - 1; i <= o.x + o.w; i++) {
        const inside = i >= o.x && i < o.x + o.w && j >= o.y && j < o.y + o.h;
        const corner = (i < o.x || i >= o.x + o.w) && (j < o.y || j >= o.y + o.h);
        if (inside || corner || !this.ok(i, j)) continue;
        if (seen[j * w + i]) { acc = true; break; }
      }
      if (!acc) return false;
    }
    return true;
  };
  // Tenta colocar e valida; desfaz se quebrar a circulação do cômodo
  PP.tryPut = function (r, type, x, y, w, h, rot, extra) {
    if (!this.fits(x, y, w, h, r)) return -1;
    const id = this.put(type, x, y, w, h, rot, extra);
    this.objs[id].room = r.i;
    if (!this.roomOk(r)) { this.unputLast(); return -1; }
    return id;
  };
  // Posições encostadas nas paredes do cômodo, frente para dentro
  PP.wallSpots = function (r, a, d) {
    const out = [];
    const push = (x, y, rot, side) => {
      const w = footW(a, d, rot), h = footH(a, d, rot);
      if (x < r.x || y < r.y || x + w > r.x + r.w || y + h > r.y + r.h) return;
      // o que há atrás do objeto (parede): janela? porta?
      let win = 0, solid = true;
      const bx0 = rot === 0 ? x - 1 : rot === 2 ? x + w : x;
      const by0 = rot === 1 ? y - 1 : rot === 3 ? y + h : y;
      const n = rot & 1 ? w : h;
      for (let s = 0; s < n; s++) {
        const bx = rot & 1 ? bx0 + s : bx0, by = rot & 1 ? by0 : by0 + s;
        if (!this.ok(bx, by)) { solid = false; continue; }
        const wv = this.wall[by * this.w + bx];
        if (!wv) solid = false; else if (isWinW(wv)) win++; else if (isDoorW(wv)) solid = false;
      }
      if (!solid) return;
      // distância ao canto mais próximo ao longo da parede
      const along = rot & 1 ? x - r.x : y - r.y, len = rot & 1 ? r.w : r.h;
      const corner = Math.min(along, len - (along + a));
      const center = Math.abs(along + a / 2 - len / 2);
      out.push({ x, y, w, h, rot, side, win, corner, center });
    };
    for (let x = r.x; x <= r.x + r.w - a; x++) { push(x, r.y, 1, 'top'); push(x, r.y + r.h - d, 3, 'bottom'); }
    for (let y = r.y; y <= r.y + r.h - a; y++) { push(r.x, y, 0, 'left'); push(r.x + r.w - d, y, 2, 'right'); }
    return out;
  };
  // Coloca objeto encostado na parede. opts: a, d, corner, center, side, near:{x,y}, noWindow, far:{x,y}
  PP.placeWall = function (r, type, opts) {
    opts = opts || {};
    const def = ODEF[type], rng = this.rng;
    const a = opts.a || def.a, d = opts.d || def.d;
    const spots = this.wallSpots(r, a, d);
    const tall = opts.noWindow != null ? opts.noWindow : def.tall;
    for (const s of spots) {
      let sc = rng() * 1.5;
      if (tall && s.win) sc += 100;
      if (opts.corner) sc += s.corner * 3;
      if (opts.center) sc += s.center * 2;
      if (opts.side && s.side !== opts.side) sc += 6;
      if (opts.notSide && s.side === opts.notSide) sc += 6;
      if (opts.near) sc += (Math.abs(s.x + s.w / 2 - opts.near.x) + Math.abs(s.y + s.h / 2 - opts.near.y)) * 2;
      if (opts.far) sc -= (Math.abs(s.x + s.w / 2 - opts.far.x) + Math.abs(s.y + s.h / 2 - opts.far.y)) * 1.5;
      if (opts.winPref && s.win) sc -= 3;
      s.sc = sc;
    }
    spots.sort((p, q) => p.sc - q.sc);
    for (let i = 0; i < spots.length && i < 40; i++) {
      const s = spots[i];
      if (s.sc >= 100 && tall) break;
      const id = this.tryPut(r, type, s.x, s.y, s.w, s.h, s.rot, opts.extra);
      if (id >= 0) return id;
    }
    return -1;
  };
  // Objeto solto (longe das paredes quando possível)
  PP.placeFree = function (r, type, w, h, rot, opts) {
    opts = opts || {};
    const cands = [];
    const m = opts.margin != null ? opts.margin : 1;
    for (let y = r.y + m; y <= r.y + r.h - h - m; y++) for (let x = r.x + m; x <= r.x + r.w - w - m; x++) {
      const cx = x + w / 2 - (r.x + r.w / 2), cy = y + h / 2 - (r.y + r.h / 2);
      cands.push({ x, y, s: Math.abs(cx) + Math.abs(cy) + this.rng() * (opts.jitter || 1.5) });
    }
    cands.sort((p, q) => p.s - q.s);
    for (let i = 0; i < cands.length && i < 30; i++) {
      const id = this.tryPut(r, type, cands[i].x, cands[i].y, w, h, rot, opts.extra);
      if (id >= 0) return id;
    }
    return -1;
  };
  // Cadeiras ao redor de uma mesa
  PP.chairsAround = function (r, tid, max) {
    const t = this.objs[tid];
    let n = 0;
    const spots = [];
    for (let i = t.x; i < t.x + t.w; i++) { spots.push([i, t.y - 1, 1]); spots.push([i, t.y + t.h, 3]); }
    for (let j = t.y; j < t.y + t.h; j++) { spots.push([t.x - 1, j, 0]); spots.push([t.x + t.w, j, 2]); }
    shuffle(spots, this.rng);
    for (const s of spots) {
      if (n >= max) break;
      if (this.tryPut(r, 'chair', s[0], s[1], 1, 1, s[2]) >= 0) n++;
    }
    return n;
  };
  // Tapete: não bloqueia, só onde não há nada
  PP.rug = function (r) {
    const w = Math.min(3, r.w - 2), h = Math.min(2, r.h - 2);
    if (w < 2 || h < 2) return -1;
    return this.placeFree(r, 'rug', w, h, 0, { margin: 1 });
  };
  // Área externa: coloca objeto se as células estão livres (sem prédio/parede/objeto/reserva)
  PP.freeOut = function (x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!this.ok(i, j)) return false;
      const k = j * this.w + i;
      if (this.bld[k] || this.wall[k] || this.obj[k] >= 0 || this.resv[k]) return false;
    }
    return true;
  };
  PP.putOut = function (type, x, y, w, h, rot, extra) {
    if (!this.freeOut(x, y, w, h)) return -1;
    return this.put(type, x, y, w, h, rot, extra);
  };
  PP.line = function (x0, y0, x1, y1, fn) { // linha reta horizontal/vertical
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    for (;;) { fn(x, y); if (x === x1 && y === y1) break; x += dx; y += dy; }
  };
  PP.fence = function (x0, y0, x1, y1, type) {
    this.line(x0, y0, x1, y1, (x, y) => {
      if (!this.ok(x, y)) return;
      const k = y * this.w + x;
      if (this.bld[k] || this.wall[k] || this.obj[k] >= 0 || this.resv[k]) return;
      this.wall[k] = type;
    });
  };

  // ------------------------------------------------------------------
  // 3a. Mobília por cômodo
  // ------------------------------------------------------------------
  const ROT_SIDE = ['left', 'top', 'right', 'bottom'];
  const OPP = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  function centerOf(o) { return { x: o.x + o.w / 2, y: o.y + o.h / 2 }; }
  // cadeira na frente de um objeto (mesa/escrivaninha)
  function chairFront(P, r, id) {
    const o = P.objs[id];
    const cx = o.x + (o.rot & 1 ? Math.floor(o.w / 2) : 0) + (o.rot === 0 ? o.w : o.rot === 2 ? -1 : 0);
    const cy = o.y + (o.rot & 1 ? 0 : Math.floor(o.h / 2)) + (o.rot === 1 ? o.h : o.rot === 3 ? -1 : 0);
    return P.tryPut(r, 'chair', cx, cy, 1, 1, (o.rot + 2) & 3);
  }

  function furnish(P, r) {
    const rng = P.rng, area = r.w * r.h;
    switch (r.type) {
      case 'living': {
        const sid = P.placeWall(r, 'sofa', { a: Math.max(r.w, r.h) >= 6 ? 3 : 2, center: true });
        if (sid >= 0) {
          const so = P.objs[sid], side = ROT_SIDE[so.rot];
          P.placeWall(r, 'tv', { side: OPP[side], near: centerOf(so), center: true });
          if (rng() < 0.8) P.placeWall(r, 'armchair', { near: centerOf(so) });
        }
        if (rng() < 0.7) P.placeWall(r, 'bookshelf', { corner: true });
        if (rng() < 0.6) P.placeWall(r, 'plant', { corner: true });
        if (rng() < 0.6) P.placeWall(r, 'lamp', { corner: true, noWindow: false });
        if (area >= 20 && rng() < 0.6) P.rug(r);
        break;
      }
      case 'kitchen': {
        const fid = P.placeWall(r, 'fridge', { corner: true });
        let anchor = fid >= 0 ? centerOf(P.objs[fid]) : { x: r.x, y: r.y };
        const seq = ['kitchen_counter', 'stove', 'kitchen_counter', 'sink', 'kitchen_counter'];
        const extra = area >= 16 ? 2 : 0;
        for (let i = 0; i < extra; i++) seq.push('kitchen_counter');
        for (const t of seq) {
          const id = P.placeWall(r, t, { near: anchor, noWindow: false });
          if (id >= 0) anchor = centerOf(P.objs[id]);
        }
        if (area >= 15) {
          const big = area >= 24 && rng() < 0.5;
          const tid = P.placeFree(r, 'table', 2, big ? 2 : 1, 0, { margin: 1 });
          if (tid >= 0) P.chairsAround(r, tid, big ? 4 : 2 + (rng() < 0.5 ? 1 : 0));
        }
        if (rng() < 0.8) P.placeWall(r, 'trash_can', { corner: true });
        break;
      }
      case 'bedroom': {
        const big = r.w >= 4 && r.h >= 4;
        const bt = big && rng() < 0.7 ? 'double_bed' : 'bed';
        const bid = P.placeWall(r, bt, { center: true });
        if (bid < 0 && bt === 'double_bed') P.placeWall(r, 'bed', { center: true });
        P.placeWall(r, 'wardrobe', { corner: true });
        P.placeWall(r, 'dresser', { a: r.w >= 5 && rng() < 0.4 ? 2 : 1 });
        if (rng() < 0.5) P.placeWall(r, 'lamp', { corner: true, noWindow: false });
        if (area >= 16 && rng() < 0.35) { const d = P.placeWall(r, 'desk', {}); if (d >= 0) chairFront(P, r, d); }
        if (area >= 16 && rng() < 0.4) P.rug(r);
        if (rng() < 0.3) P.placeWall(r, 'plant', { corner: true });
        break;
      }
      case 'bathroom': {
        P.placeWall(r, 'toilet', { corner: true });
        const sk = P.placeWall(r, 'sink', {});
        if (r.w >= 3 || r.h >= 3) { if (P.placeWall(r, 'bathtub', { corner: true }) < 0) P.placeWall(r, 'shower', { corner: true }); }
        else P.placeWall(r, 'shower', { corner: true });
        P.placeWall(r, 'medicine_cabinet', { near: sk >= 0 ? centerOf(P.objs[sk]) : null, noWindow: true });
        break;
      }
      case 'garage': {
        // carro no meio, de frente para o portão (frente = +y)
        if (rng() < 0.6) {
          const cx = r.x + Math.floor((r.w - 1) / 2);
          for (let y = r.y + r.h - 3; y >= r.y + 1; y--) if (P.tryPut(r, 'car', cx, y, 1, 2, 1) >= 0) break;
        }
        P.placeWall(r, 'workbench', { side: 'top' });
        P.placeWall(r, 'shelf', { corner: true });
        if (rng() < 0.6) P.placeWall(r, 'tire', { corner: true });
        if (rng() < 0.4) P.placeWall(r, 'barrel', { corner: true });
        if (rng() < 0.35) P.placeWall(r, 'washing_machine', {});
        break;
      }
      case 'office': {
        const d = P.placeWall(r, 'desk', { center: true });
        if (d >= 0) chairFront(P, r, d);
        P.placeWall(r, 'bookshelf', { corner: true });
        if (rng() < 0.6) P.placeWall(r, 'bookshelf', { corner: true });
        if (rng() < 0.5) P.placeWall(r, 'plant', { corner: true });
        if (rng() < 0.5) P.placeWall(r, 'lamp', { corner: true, noWindow: false });
        break;
      }
      case 'storage': {
        P.placeWall(r, 'washing_machine', {});
        P.placeWall(r, 'shelf', { corner: true });
        if (area >= 9) P.placeWall(r, 'shelf', { corner: true });
        if (rng() < 0.5) P.placeWall(r, 'crate', { corner: true });
        break;
      }
      case 'hall': {
        if (r.w >= 2 && r.h >= 2 && rng() < 0.5) P.placeWall(r, 'plant', { corner: true });
        break;
      }
    }
  }

  // ------------------------------------------------------------------
  // 3b. Nomes e paletas
  // ------------------------------------------------------------------
  const SURNAMES = ['Miller', 'Johnson', 'Carter', 'Hayes', 'Walker', 'Brooks', 'Turner', 'Parker', 'Collins', 'Reed',
    'Morgan', 'Bennett', 'Foster', 'Hughes', 'Price', 'Ward', 'Russell', 'Griffin', 'Sullivan', 'Coleman', 'Porter',
    'Hudson', 'Fletcher', 'Lawson', 'Barnes', 'Dixon', 'Gibson', 'Harper', 'Keller', 'Lambert', 'McCoy', 'Nolan',
    'Owens', 'Palmer', 'Quinn', 'Riley', 'Shelby', 'Tucker', 'Vaughn', 'Wheeler', 'Young', 'Abbott', 'Baxter',
    'Chandler', 'Dawson', 'Ellis', 'Fowler', 'Graves', 'Hollis', 'Jenkins', 'Kemp', 'Lowell', 'Mercer', 'Norris'];
  const HOUSE_WALLS = [
    { wall: W.WOOD, colors: ['#c9d3d6', '#e4dcc5', '#e9e6dc', '#d9cfa3', '#a9b79a', '#b7b3a8', '#c6b7a0', '#9fb3c2', '#d8c0a8'] },
    { wall: W.BRICK, colors: ['#9a5a45', '#8a5040', '#a86a50', '#7d4c3c'] },
    { wall: W.PLASTER, colors: ['#e6e0cf', '#d8d2c0', '#cfc6b0', '#e2d6bd'] },
  ];
  const ROOFS = ['#4a4a4f', '#5b4636', '#6b3a32', '#3f4a58', '#3e4f3e', '#57534e', '#704c3a', '#384048'];
  function pickHouseLook(rng) {
    const r = rng();
    const g = r < 0.62 ? HOUSE_WALLS[0] : r < 0.85 ? HOUSE_WALLS[1] : HOUSE_WALLS[2];
    return { wall: g.wall, wallColor: rng.pick(g.colors), roofColor: rng.pick(ROOFS) };
  }

  // ------------------------------------------------------------------
  // 3c. Casa (lote inteiro: casa + quintal). Frente para +y.
  // ------------------------------------------------------------------
  function genHouse(P, rng, o) {
    const LW = P.w, LD = P.h;
    const front = LD >= 14 ? rng.int(2, 3) : 2;
    let hh = Math.min(rng.int(9, 12), LD - front - 2);
    if (hh < 9) return false;
    const garage = !o.noGarage && LW >= 16 && rng() < 0.6;
    const gw = 5;
    let hw = Math.min(rng.int(10, 13), LW - 2 - (garage ? gw - 1 : 0));
    if (hw < 10) return false;
    const gSide = rng() < 0.5 ? -1 : 1;
    const baseW = hw + (garage ? gw - 1 : 0);
    // ala lateral (planta em L), alinhada aos fundos, do lado sem garagem
    const swSide = garage ? -gSide : (rng() < 0.5 ? -1 : 1);
    let ww = 0;
    if (rng() < 0.55 && LW - baseW - 3 >= 4) ww = Math.min(rng.int(4, 5), LW - baseW - 3);
    const totalW = baseW + (ww ? ww - 1 : 0);
    const x0 = LW - totalW >= 4 ? rng.int(2, LW - 2 - totalW) : Math.max(1, Math.floor((LW - totalW) / 2));
    const bx = x0 + (garage && gSide < 0 ? gw - 1 : 0) + (ww && swSide < 0 ? ww - 1 : 0);
    const by = LD - front - hh;
    const look = pickHouseLook(rng);
    const b = P.addBuilding({ type: o.type || 'house', name: o.name, wall: look.wall, wallColor: look.wallColor, roofColor: look.roofColor });
    P.foot(b, bx, by, hw, hh);
    let gx = 0, gy = 0, gh = 0;
    if (garage) {
      gh = Math.min(rng.int(7, 8), hh);
      gx = gSide < 0 ? bx - gw + 1 : bx + hw - 1;
      gy = by + hh - gh;
      P.foot(b, gx, gy, gw, gh);
    }
    let side = null;
    if (ww) {
      const wh = rng.int(5, Math.min(7, hh - 2));
      side = { x: swSide < 0 ? bx - ww + 1 : bx + hw - 1, y: by, w: ww, h: wh };
      P.foot(b, side.x, side.y, side.w, side.h);
    }
    // ala em L nos fundos
    let wing = null;
    if (rng() < 0.4 && by >= 6) {
      const ww = rng.int(5, 7), wh = rng.int(4, 5);
      const wx = rng() < 0.5 ? bx : bx + hw - ww;
      const wy = by - wh + 1;
      if (wy >= 2) { wing = { x: wx, y: wy, w: ww, h: wh }; P.foot(b, wx, wy, ww, wh); }
    }
    const ix = bx + 1, iy = by + 1, iw = hw - 2, ih = hh - 2;
    const kitchenLeft = garage ? gSide < 0 : rng() < 0.5;
    const FL = { living: rng.pick([F.CARPET, F.WOOD, F.WOOD]), bed: rng.pick([F.CARPET, F.WOOD]), kit: rng.pick([F.LINOLEUM, F.TILE, F.LINOLEUM]) };
    const useHall = ih >= 9 && iw >= 9 && rng() < 0.75;
    let bd, fd, hallY = -1;
    if (useHall) { bd = ih >= 10 && rng() < 0.6 ? 4 : 3; fd = ih - bd - 3; hallY = iy + bd + 1; }
    else { bd = ih >= 8 ? rng.int(3, 4) : 3; fd = ih - 1 - bd; }
    const fy = iy + ih - fd;
    // frente: sala + cozinha
    const kw = U.clamp(rng.int(3, 5), 3, iw - 5);
    const lw = iw - 1 - kw;
    const kx = kitchenLeft ? ix : ix + lw + 1, lx = kitchenLeft ? ix + kw + 1 : ix;
    const living = P.addRoom(b, 'living', lx, fy, lw, fd, FL.living);
    const kitchen = P.addRoom(b, 'kitchen', kx, fy, kw, fd, FL.kit);
    const hall = useHall ? P.addRoom(b, 'hall', ix, hallY, iw, 1, F.WOOD) : null;
    // fundos: quartos + banheiro
    const bathW = rng.int(2, 3), rem = iw - bathW - 1;
    const backs = [];
    if (rem >= 9) { const b1 = Math.floor((rem - 1) / 2) + (rng() < 0.5 ? 0 : (rem - 1) % 2); backs.push(['bedroom', b1], ['bedroom', rem - 1 - b1]); }
    else backs.push(['bedroom', rem]);
    const bathPos = rng.int(0, backs.length);
    backs.splice(bathPos, 0, ['bathroom', bathW]);
    let cx = ix;
    const backRooms = [];
    for (const [t, w] of backs) {
      backRooms.push(P.addRoom(b, t, cx, iy, w, bd, t === 'bathroom' ? F.TILE : FL.bed));
      cx += w + 1;
    }
    let garageRoom = null, wingRoom = null, sideRoom = null;
    if (side) {
      const st = side.w >= 5 ? rng.pick(['bedroom', 'bedroom', 'office']) : 'storage';
      sideRoom = P.addRoom(b, st, side.x + 1, side.y + 1, side.w - 2, side.h - 2, st === 'storage' ? F.LINOLEUM : st === 'office' ? F.CARPET : FL.bed);
    }
    if (garage) garageRoom = P.addRoom(b, 'garage', gx + 1, gy + 1, gw - 2, gh - 2, F.CONCRETE);
    if (wing) {
      const wt = rng.pick(['bedroom', 'office', 'storage', 'bedroom']);
      wingRoom = P.addRoom(b, wt, wing.x + 1, wing.y + 1, wing.w - 2, wing.h - 2, wt === 'storage' ? F.LINOLEUM : wt === 'office' ? F.CARPET : FL.bed);
    }
    P.buildWalls(b, look.wall, W.PLASTER, F.WOOD);

    // portas internas
    const mid = (r) => (c) => Math.abs(c.x - (r.x + r.w / 2)) + Math.abs(c.y - (r.y + r.h / 2)) * 0.5 + rng();
    if (!(rng() < 0.55 && P.opening(living, kitchen, 2))) P.door(kitchen, living, { score: mid(kitchen), open: rng() < 0.6 });
    if (hall) {
      if (!(rng() < 0.5 && P.opening(hall, living, 1))) P.door(hall, living, { score: mid(living), open: true });
      for (const r of backRooms) P.door(r, hall, { score: mid(r), open: rng() < 0.6 });
      if (rng() < 0.4) P.door(hall, kitchen, { score: mid(kitchen), open: rng() < 0.5 });
    } else {
      for (const r of backRooms) {
        const pref = r.type === 'bathroom' ? [living, kitchen] : [living, kitchen];
        let ok = false;
        for (const t of pref) if (P.door(r, t, { score: mid(r), open: rng() < 0.6 })) { ok = true; break; }
        if (!ok) { const other = backRooms.find((q) => q !== r && q.type === 'bedroom'); if (other) P.door(r, other, { score: mid(r) }); }
      }
    }
    if (wingRoom) {
      let ok = false;
      for (const t of backRooms) if (P.door(wingRoom, t, { score: mid(wingRoom), open: rng() < 0.5 })) { ok = true; break; }
      if (!ok) for (const t of [living, kitchen, hall]) if (t && P.door(wingRoom, t, {})) break;
    }
    if (sideRoom) {
      const pref = sideRoom.type === 'storage' ? [kitchen, hall, living].concat(backRooms) : backRooms.concat([hall, living, kitchen]);
      for (const t of pref) if (t && P.door(sideRoom, t, { score: mid(sideRoom), open: rng() < 0.5 })) break;
    }
    if (garageRoom) {
      let ok = false;
      for (const t of [kitchen, hall, living].concat(backRooms)) if (t && P.door(garageRoom, t, { score: mid(garageRoom) })) { ok = true; break; }
      // portão da garagem
      const gdLocked = rng() < 0.5, gdOpen = !gdLocked && rng() < 0.25;
      for (let i = 1; i <= 3; i++) {
        const x = gx + i, y = gy + gh - 1, k = y * LW + x;
        P.wall[k] = W.GARAGE_DOOR; P.ws[k] = (gdLocked ? WS.LOCKED : 0) | (gdOpen ? WS.OPEN : 0);
        P.floor[k] = F.CONCRETE; P.reserveAround(x, y);
      }
      P.blds[b - 1].doors.push({ x: gx + 2, y: gy + gh - 1, garage: true });
      P.fill(gx + 1, gy + gh, 3, LD - (gy + gh), F.CONCRETE);
      for (let y = gy + gh; y < LD; y++) for (let x = gx + 1; x <= gx + 3; x++) P.resv[y * LW + x] = 1;
    }
    // porta da frente (na parede de baixo da sala)
    const fdoor = P.door(living, null, {
      score: (c) => (c.ny === -1 ? 0 : 60) + Math.abs(c.x - (living.x + living.w / 2)) * 0.6 + rng(),
      locked: !o.unlocked && rng() < 0.45, open: !o.unlocked && rng() < 0.07,
    });
    // porta dos fundos/lateral
    if (rng() < 0.6) {
      const cands = [kitchen, hall].concat(backRooms.filter((r) => r.type === 'bedroom'));
      for (const r of cands) {
        if (!r) continue;
        if (P.door(r, null, { score: (c) => (c.ny === -1 ? 1e6 : c.ny === 1 ? 0 : 5) + rng() * 3, locked: rng() < 0.5, noFront: true })) break;
      }
    }
    // janelas
    for (const r of P.rooms) {
      if (r.b !== b) continue;
      if (r.type === 'hall') continue;
      const curtain = r.type === 'bedroom' ? 0.6 : r.type === 'bathroom' ? 0.8 : 0.25;
      const max = r.type === 'bathroom' ? 1 : r.type === 'garage' ? 1 : 99;
      const p = r.type === 'garage' ? 0.3 : 0.5;
      let n = P.windows(r, { p, curtain, max, broken: o.unlocked ? 0 : 0.03 });
      if (!n && r.type !== 'garage') P.windows(r, { p: 1, curtain, max: 1 });
    }
    // cada cômodo mantém uma janela livre por dentro (dá para pular/fugir por ela)
    for (const r of P.rooms) if (r.b === b) P.keepWindowClear(r);
    // mobília
    for (const r of P.rooms) if (r.b === b) furnish(P, r);
    // varanda + caminho até a calçada
    if (fdoor) {
      const pd = Math.min(front - 1, rng.int(1, 2));
      const pw = rng.int(3, 5);
      let px0 = fdoor.x - Math.floor(pw / 2);
      for (let y = by + hh; y < by + hh + pd; y++) for (let x = px0; x < px0 + pw; x++) {
        if (!P.ok(x, y) || P.bld[y * LW + x] || P.resv[y * LW + x] && P.floor[y * LW + x] === F.CONCRETE) continue;
        P.floor[y * LW + x] = F.WOOD;
      }
      for (let y = by + hh; y < LD; y++) {
        const k = y * LW + fdoor.x;
        if (P.floor[k] !== F.WOOD) P.floor[k] = F.SIDEWALK;
        P.resv[k] = 1;
      }
      // cadeira/banco na varanda
      if (pd >= 1 && rng() < 0.6) {
        const sx = fdoor.x + (rng() < 0.5 ? -2 : 1);
        const t = rng() < 0.5 ? 'bench' : 'armchair';
        if (P.floor[(by + hh) * LW + sx] === F.WOOD) {
          if (t === 'bench' && P.floor[(by + hh) * LW + sx + 1] === F.WOOD && sx !== fdoor.x - 1) P.putOut('bench', sx, by + hh, 2, 1, 1);
          else if (sx !== fdoor.x - 1 && sx !== fdoor.x + 1) P.putOut('armchair', sx, by + hh, 1, 1, 1);
        }
      }
      // caixa de correio junto à calçada
      const mx = fdoor.x + (rng() < 0.5 ? -1 : 1);
      P.putOut('mailbox', mx, LD - 1, 1, 1, 1);
    }
    // entrada de carro sem garagem
    if (!garage && rng() < 0.45) {
      const left = bx >= 4, right = LW - (bx + hw) >= 3;
      let dx = -1;
      if (left && (!right || rng() < 0.5)) dx = bx - 3; else if (right) dx = bx + hw;
      if (dx >= 0) {
        const y0 = by + 2;
        let clear = true;
        for (let y = y0; y < LD; y++) for (let x = dx; x < dx + 2; x++) if (P.resv[y * LW + x] || P.bld[y * LW + x]) clear = false;
        if (clear) {
          P.fill(dx, y0, 2, LD - y0, F.GRAVEL);
          if (rng() < 0.65) P.putOut('car', dx + (rng() < 0.5 ? 0 : 1), y0 + rng.int(0, 2), 1, 2, rng() < 0.7 ? 1 : 3);
          for (let y = y0; y < LD; y++) for (let x = dx; x < dx + 2; x++) P.resv[y * LW + x] = 1;
        }
      }
    }
    yard(P, rng, { bx, by, hw, hh, LW, LD, front });
    return true;
  }

  // Quintal: cercas, árvores, arbustos, lixeira, balanço...
  function yard(P, rng, g) {
    const { bx, by, hw, hh, LW, LD } = g;
    const fenceRow = by + Math.floor(hh / 2);
    const roll = rng();
    const ftype = roll < 0.5 ? W.FENCE_WOOD : roll < 0.7 ? W.HEDGE : roll < 0.82 ? W.FENCE_METAL : 0;
    if (ftype) {
      P.fence(0, 0, LW - 1, 0, ftype);
      P.fence(0, 0, 0, fenceRow, ftype);
      P.fence(LW - 1, 0, LW - 1, fenceRow, ftype);
      // ligações casa -> divisa, com portão
      const segs = [];
      if (bx > 1) segs.push([1, bx - 1]);
      if (bx + hw < LW - 1) segs.push([bx + hw, LW - 2]);
      const gateSeg = segs.length ? rng.int(0, segs.length - 1) : -1;
      segs.forEach((s, si) => {
        // não fecha passagem de garagem/entrada
        let x0 = s[0], x1 = s[1];
        const gateX = si === gateSeg ? rng.int(x0, x1) : -1;
        for (let x = x0; x <= x1; x++) {
          const k = fenceRow * LW + x;
          if (P.bld[k]) continue;
          if (x === gateX || P.resv[k]) { if (x === gateX && P.obj[k] < 0 && !P.wall[k] && !P.bld[k]) { P.put('fence_gate', x, fenceRow, 1, 1, 1); P.resv[k] = 1; P.resv[k - LW] = 1; if (fenceRow + 1 < LD) P.resv[k + LW] = 1; } continue; }
          if (!P.wall[k] && P.obj[k] < 0) P.wall[k] = ftype;
        }
      });
      // garante que portas laterais/fundos não ficaram encostadas na cerca
    }
    // sebes/arbustos na frente da casa
    for (let x = bx; x < bx + hw; x++) {
      const y = by + hh;
      if (rng() < 0.35) P.putOut('bush', x, y, 1, 1, 0);
    }
    // árvores no quintal dos fundos e na frente
    const nT = rng.int(0, 3);
    for (let i = 0; i < nT; i++) {
      const x = rng.int(1, LW - 2), y = rng.int(1, Math.max(1, by - 2));
      P.putOut(rng() < 0.8 ? 'tree' : 'pine', x, y, 1, 1, 0);
    }
    if (rng() < 0.5) P.putOut('tree', rng.int(1, LW - 2), LD - 2, 1, 1, 0);
    // lixeira ao lado da casa
    const tx = rng() < 0.5 ? bx - 1 : bx + hw;
    P.putOut('trash_can', tx, by + hh - 1, 1, 1, 1);
    if (rng() < 0.3) P.putOut('trash_can', tx, by + hh - 2, 1, 1, 1);
    // coisas no quintal (fundos ou laterais — nunca no jardim da frente)
    const back = [];
    if (rng() < 0.35) back.push(['picnic_table', 2, 1]);
    if (rng() < 0.25) back.push(['swing', 2, 1]);
    if (rng() < 0.3) back.push(['log_pile', 2, 1]);
    if (rng() < 0.25) back.push(['barrel', 1, 1]);
    if (rng() < 0.2) back.push(['tire', 1, 1]);
    const yMax = by + hh - 2;
    for (const [t, w, h] of back) {
      for (let tries = 0; tries < 14; tries++) {
        const x = rng.int(1, LW - 1 - w), y = rng.int(1, Math.max(1, yMax - h));
        if (x + w > bx - 1 && x < bx + hw + 1 && y + h > by - 1) continue; // não encosta na casa
        if (P.putOut(t, x, y, w, h, rng() < 0.5 ? 1 : 3) >= 0) break;
      }
    }
    // horta
    if (by >= 5 && rng() < 0.3) {
      const w = rng.int(3, 5), h = rng.int(2, 3), x = rng.int(2, Math.max(2, LW - 3 - w)), y = rng.int(2, Math.max(2, by - 2 - h));
      if (P.freeOut(x, y, w, h)) { P.fill(x, y, w, h, F.DIRT); for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (rng() < 0.4) P.putOut('bush', i, j, 1, 1, 0); }
    }
  }

  // ------------------------------------------------------------------
  // 3d. Prédios comerciais / públicos (lote inteiro, frente para +y)
  // ------------------------------------------------------------------
  // n portas contíguas no centro da parede da frente do cômodo
  function frontDoors(P, r, n, opts) {
    opts = opts || {};
    const side = opts.side != null ? opts.side : -1; // ny = -1 => parede de baixo (frente)
    const cands = P.wallCells(r, null).filter((c) => c.ny === side || (side === 'any'));
    if (!cands.length) return null;
    const cx = opts.x != null ? opts.x : r.x + r.w / 2 - n / 2;
    cands.sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx));
    let run = null;
    for (const c of cands) {
      const cells = [];
      for (let i = 0; i < n; i++) { const q = cands.find((d) => d.x === c.x + i && d.y === c.y); if (!q) break; cells.push(q); }
      if (cells.length === n) { run = cells; break; }
    }
    if (!run) return null;
    for (const c of run) {
      const k = c.y * P.w + c.x;
      P.wall[k] = opts.garage ? W.GARAGE_DOOR : W.DOOR;
      P.ws[k] = (opts.locked ? WS.LOCKED : 0) | (opts.open ? WS.OPEN : 0);
      P.floor[k] = r.floor; P.reserveAround(c.x, c.y);
      const d = { x: c.x, y: c.y, nx: c.nx, ny: c.ny, ext: true, a: r.i, b: -1, garage: !!opts.garage };
      r.doors.push(d); P.blds[r.b - 1].doors.push(d);
    }
    return run;
  }
  // Estacionamento de asfalto com carros de frente/costas (1×2)
  function parking(P, x0, y0, x1, y1, rng, pCar, types) {
    P.fill(x0, y0, x1 - x0 + 1, y1 - y0 + 1, F.ASPHALT);
    if (y1 - y0 < 1) return;
    for (let x = x0 + 1; x <= x1 - 1; x += 2) {
      if (rng() > pCar) continue;
      const t = types ? rng.pick(types) : 'car';
      const y = rng() < 0.5 ? y0 : y1 - 1;
      P.putOut(t, x, y, 1, 2, rng() < 0.5 ? 1 : 3);
    }
  }
  function pathTo(P, x, y0, y1, fl) { // corredor livre até a calçada
    for (let y = y0; y <= y1; y++) { const k = y * P.w + x; if (!P.bld[k]) { if (fl) P.floor[k] = fl; P.resv[k] = 1; } }
  }
  function gondolas(P, r, x0, y0, x1, y1, step) {
    for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y++) P.tryPut(r, 'shelf', x, y, 1, 1, 1);
  }
  function checkout(P, r, x, y, rot) { // balcão + caixa registradora lado a lado (vertical)
    const a = P.tryPut(r, 'counter', x, y, 1, 1, rot);
    if (a < 0) return false;
    if (P.tryPut(r, 'cash_register', x, y + 1, 1, 1, rot) < 0) { P.unputLast(); return false; }
    return true;
  }
  // Salão de loja adaptável: caixas ao lado da porta, prateleiras nas paredes do fundo e do lado,
  // freezers na outra parede, gôndolas no meio (verticais se couber, senão uma fileira horizontal).
  function shopFloor(P, r, dx, opts) {
    opts = opts || {};
    const x0 = r.x, y0 = r.y, x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
    const doorLeft = dx < x0 + r.w / 2, dir = doorLeft ? 1 : -1;
    let nC = 0;
    for (let x = dx + dir * 2; nC < (opts.checkouts || 1) && x >= x0 && x <= x1; x += dir * 2) if (checkout(P, r, x, y1 - 2, doorLeft ? 2 : 0)) nC++;
    if (!nC) for (let x = dx - dir * 2; x >= x0 && x <= x1; x -= dir) if (checkout(P, r, x, y1 - 2, doorLeft ? 0 : 2)) break;
    const farX = doorLeft ? x1 : x0, nearX = doorLeft ? x0 : x1;
    for (let y = y0 + 1; y <= y1 - 3; y++) P.tryPut(r, opts.sideObj || 'shelf', farX, y, 1, 1, doorLeft ? 2 : 0);
    if (opts.freezers) for (let y = y0 + 1; y <= y1 - 3; y++) P.tryPut(r, 'freezer', nearX, y, 1, 1, doorLeft ? 0 : 2);
    for (let x = x0; x <= x1; x++) P.tryPut(r, opts.backObj || 'shelf', x, y0, 1, 1, 1);
    if (opts.noGondola) return;
    if (r.h >= 8) gondolas(P, r, x0 + 2, y0 + 2, x1 - 2, y1 - 4, 3);
    else if (r.h >= 5) for (let x = x0 + 2; x <= x1 - 2; x++) if (x !== dx) P.tryPut(r, 'shelf', x, y0 + 2, 1, 1, 1);
  }
  function interior(P, bx, by, bw, bh) { return { ix: bx + 1, iy: by + 1, iw: bw - 2, ih: bh - 2 }; }

  // Mercado: salão com gôndolas, caixas, freezers; depósito, escritório, banheiro
  function genMarket(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - 5, bx = 1, by = 1;
    const b = P.addBuilding({ type: 'store', name: o.name, wall: W.BRICK, wallColor: '#9b7c62', roofColor: '#555b60' });
    P.foot(b, bx, by, bw, bh);
    const { ix, iy, iw, ih } = interior(P, bx, by, bw, bh);
    const main = P.addRoom(b, 'store', ix, iy + 4, iw, ih - 4, F.LINOLEUM); main.loot = 'grocery';
    const offW = 3, bathW = 2, stW = iw - offW - bathW - 2;
    const st = P.addRoom(b, 'storage', ix, iy, stW, 3, F.CONCRETE); st.loot = 'grocery_storage';
    const off = P.addRoom(b, 'office', ix + stW + 1, iy, offW, 3, F.CARPET);
    const bath = P.addRoom(b, 'bathroom', ix + stW + offW + 2, iy, bathW, 3, F.TILE);
    P.buildWalls(b, W.BRICK, W.PLASTER, F.CONCRETE);
    P.door(st, main, { score: (c) => Math.abs(c.x - (st.x + 2)) + rng() });
    P.door(off, main, { open: true });
    P.door(bath, off, {}) || P.door(bath, main, {});
    P.door(st, null, { score: (c) => (c.ny === 1 ? 0 : 50) + rng(), locked: true });
    const dx = main.x + Math.floor(main.w / 2) - 1;
    frontDoors(P, main, 2, { x: dx, locked: rng() < 0.25 });
    P.windows(main, { glass: true, side: (c) => c.ny === -1, broken: 0.08 });
    shopFloor(P, main, dx, { checkouts: 3, freezers: true });
    furnish(P, off); furnish(P, bath);
    for (let x = st.x; x < st.x + st.w; x++) if (rng() < 0.7) P.tryPut(st, rng() < 0.6 ? 'crate' : 'pallet', x, st.y, 1, 1, 1);
    P.placeWall(st, 'shelf', { side: 'bottom' });
    pathTo(P, dx, by + bh, LD - 1); pathTo(P, dx + 1, by + bh, LD - 1);
    parking(P, 0, by + bh, LW - 1, LD - 1, rng, 0.35);
    pathTo(P, dx, by + bh, LD - 1, F.SIDEWALK); pathTo(P, dx + 1, by + bh, LD - 1, F.SIDEWALK);
    P.putOut('dumpster', LW - 1, by + 1, 1, 2, 2) < 0 && P.putOut('dumpster', 0, by + 1, 1, 2, 0);
    P.putOut('trash_can', dx - 1, by + bh, 1, 1, 1);
    P.zspawn.push({ x: main.x + main.w / 2, y: main.y + main.h / 2, weight: 3 });
  }

  // Loja genérica pequena (farmácia, ferragens, correios): salão + fundos
  function genShop(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - (o.parking ? 4 : 3), bx = 1, by = 1;
    const b = P.addBuilding({ type: o.btype, name: o.name, wall: o.wall || W.BRICK, wallColor: o.wallColor, roofColor: o.roofColor });
    P.foot(b, bx, by, bw, bh);
    const { ix, iy, iw, ih } = interior(P, bx, by, bw, bh);
    const backD = 3;
    const main = P.addRoom(b, o.mainType, ix, iy + backD + 1, iw, ih - backD - 1, o.floor || F.LINOLEUM); main.loot = o.loot;
    const bathW = 2;
    const back = P.addRoom(b, o.backType, ix, iy, iw - bathW - 1, backD, o.backType === 'office' ? F.CARPET : F.CONCRETE); back.loot = o.backLoot;
    const bath = P.addRoom(b, 'bathroom', ix + iw - bathW, iy, bathW, backD, F.TILE);
    P.buildWalls(b, o.wall || W.BRICK, W.PLASTER, F.CONCRETE);
    P.door(back, main, { locked: !!o.backLocked, score: (c) => Math.abs(c.x - (back.x + 1)) + rng() });
    P.door(bath, main, {}) || P.door(bath, back, {});
    P.door(back, null, { score: (c) => (c.ny === 1 ? 0 : 50) + rng(), locked: true });
    const dx = main.x + Math.floor(main.w / 2) + (rng() < 0.5 ? -1 : 0);
    frontDoors(P, main, 1, { x: dx, locked: rng() < 0.3 });
    P.windows(main, { glass: true, side: (c) => c.ny === -1, broken: 0.06 });
    P.windows(main, { p: 0.4, side: (c) => c.ny !== -1, max: 2 });
    if (o.office) {
      shopFloor(P, main, dx, { backObj: 'bookshelf', sideObj: 'shelf', noGondola: true });
      const d = P.placeFree(main, 'desk', 2, 1, 3, { margin: 1 }); if (d >= 0) chairFront(P, main, d);
      P.placeWall(main, 'bench', { a: 2 }); P.placeWall(main, 'plant', { corner: true });
    } else shopFloor(P, main, dx, { checkouts: 1, freezers: !!o.freezers });
    // fundos
    if (o.backType === 'office') { furnish(P, back); P.placeWall(back, 'shelf', {}); }
    else {
      for (let i = 0; i < back.w; i++) if (rng() < 0.6) P.tryPut(back, o.backObj || 'shelf', back.x + i, back.y, 1, 1, 1);
      if (o.backExtra) for (const t of o.backExtra) P.placeWall(back, t, { corner: true });
      if (rng() < 0.6) P.placeWall(back, 'crate', { corner: true });
    }
    furnish(P, bath);
    pathTo(P, dx, by + bh, LD - 1);
    if (o.parking) parking(P, 0, by + bh, LW - 1, LD - 1, rng, 0.3);
    else P.fill(0, by + bh, LW, LD - by - bh, F.SIDEWALK);
    pathTo(P, dx, by + bh, LD - 1, F.SIDEWALK);
    if (rng() < 0.5) P.putOut('bench', dx + 2, by + bh, 2, 1, 1);
    P.putOut('trash_can', dx - 2, by + bh, 1, 1, 1);
    P.putOut('dumpster', LW - 1, by + 1, 1, 2, 2);
    P.zspawn.push({ x: main.x + main.w / 2, y: main.y + main.h / 2, weight: 2 });
  }

  // Posto de gasolina: loja de conveniência + pátio de concreto com bombas
  function genGas(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = 11, bh = 8, left = rng() < 0.5;
    const bx = left ? 1 : LW - bw - 1, by = 1;
    const b = P.addBuilding({ type: 'gas_station', name: o.name, wall: W.PLASTER, wallColor: '#e4e1d6', roofColor: '#a23a2e' });
    P.foot(b, bx, by, bw, bh);
    const { ix, iy, iw, ih } = interior(P, bx, by, bw, bh);
    const main = P.addRoom(b, 'gas_station', ix, iy + 2, iw, ih - 2, F.LINOLEUM);
    const st = P.addRoom(b, 'storage', ix, iy, iw - 3, 1, F.CONCRETE); st.loot = 'gas_storage';
    const bath = P.addRoom(b, 'bathroom', ix + iw - 2, iy, 2, 1, F.TILE);
    P.buildWalls(b, W.PLASTER, W.PLASTER, F.CONCRETE);
    P.fill(0, 0, LW, LD, F.CONCRETE);
    P.fill(bx, by, bw, bh, F.CONCRETE);
    for (const r of P.rooms) P.fill(r.x, r.y, r.w, r.h, r.floor);
    P.door(st, main, {}); P.door(bath, main, {});
    const dx = main.x + (left ? main.w - 2 : 1);
    frontDoors(P, main, 1, { x: dx });
    P.windows(main, { glass: true, side: (c) => c.ny === -1, broken: 0.1 });
    shopFloor(P, main, dx, { checkouts: 1, freezers: true });
    for (let x = st.x; x < st.x + st.w; x += 2) P.tryPut(st, 'crate', x, st.y, 1, 1, 1);
    furnish(P, bath);
    // bombas (caminho da porta reservado antes)
    const py = by + bh + Math.max(2, Math.floor((LD - by - bh) / 2) - 1);
    pathTo(P, dx, by + bh, LD - 1);
    for (let x = 3; x <= LW - 4; x += 3) {
      P.putOut('fuel_pump', x, py, 1, 1, 1);
      if (rng() < 0.25) P.putOut('car', x + 1, py - 1, 1, 2, rng() < 0.5 ? 1 : 3);
    }
    P.putOut('vending_machine', dx + (left ? 1 : -1), by + bh, 1, 1, 1);
    P.putOut('lamp_post', 0, LD - 1, 1, 1, 1); P.putOut('lamp_post', LW - 1, LD - 1, 1, 1, 1);
    P.putOut('trash_can', dx + (left ? -1 : 1), by + bh, 1, 1, 1);
    for (let i = 0; i < 3; i++) P.putOut(rng() < 0.5 ? 'tire' : 'barrel', left ? LW - 2 - i : 1 + i, 1, 1, 1, 1);
    P.zspawn.push({ x: bx + bw / 2, y: by + bh + 3, weight: 2 });
  }

  // Lanchonete: salão com mesas e balcão, cozinha nos fundos
  function genDiner(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - 4, bx = 1, by = 1;
    const b = P.addBuilding({ type: 'diner', name: o.name, wall: W.PLASTER, wallColor: '#d9c9a0', roofColor: '#3f6f70' });
    P.foot(b, bx, by, bw, bh);
    const { ix, iy, iw, ih } = interior(P, bx, by, bw, bh);
    const kD = 3;
    const main = P.addRoom(b, 'diner', ix, iy + kD + 1, iw, ih - kD - 1, F.TILE);
    const kit = P.addRoom(b, 'kitchen', ix, iy, iw - 3, kD, F.TILE); kit.loot = 'diner_kitchen';
    const bath = P.addRoom(b, 'bathroom', ix + iw - 2, iy, 2, kD, F.TILE);
    P.buildWalls(b, W.PLASTER, W.PLASTER, F.TILE);
    P.door(kit, main, { score: (c) => Math.abs(c.x - (kit.x + 1)) + rng(), open: true });
    P.door(bath, main, {});
    P.door(kit, null, { score: (c) => (c.ny === 1 ? 0 : 50) + rng(), locked: true });
    const dx = main.x + main.w - 3;
    frontDoors(P, main, 1, { x: dx });
    P.windows(main, { glass: true, side: (c) => c.ny === -1, broken: 0.08 });
    P.windows(main, { p: 0.6, side: (c) => c.ny !== -1 });
    // balcão com banquetas ao longo da parede do fundo do salão
    const cy = main.y + 1;
    for (let x = main.x + 2; x < main.x + main.w - 1; x++) {
      if (P.tryPut(main, 'counter', x, main.y, 1, 1, 1) >= 0 && x % 2 === 0) P.tryPut(main, 'chair', x, cy, 1, 1, 3);
    }
    P.tryPut(main, 'cash_register', main.x + main.w - 1, main.y, 1, 1, 2);
    // mesas perto da vitrine
    for (let x = main.x; x < main.x + main.w - 3; x += 3) {
      const t = P.tryPut(main, 'table', x + 1, main.y + main.h - 2, 1, 1, 1);
      if (t >= 0) { P.tryPut(main, 'chair', x, main.y + main.h - 2, 1, 1, 0); P.tryPut(main, 'chair', x + 2, main.y + main.h - 2, 1, 1, 2); }
    }
    P.placeWall(main, 'plant', { corner: true });
    // cozinha
    let anchor = { x: kit.x, y: kit.y };
    for (const t of ['stove', 'stove', 'kitchen_counter', 'sink', 'kitchen_counter', 'fridge', 'freezer']) {
      const id = P.placeWall(kit, t, { near: anchor, noWindow: false });
      if (id >= 0) anchor = centerOf(P.objs[id]);
    }
    furnish(P, bath);
    pathTo(P, dx, by + bh, LD - 1);
    parking(P, 0, by + bh, LW - 1, LD - 1, rng, 0.35);
    pathTo(P, dx, by + bh, LD - 1, F.SIDEWALK);
    P.putOut('dumpster', 0, by + 1, 1, 2, 0) < 0 && P.putOut('dumpster', LW - 1, by + 1, 1, 2, 2);
    P.zspawn.push({ x: main.x + main.w / 2, y: main.y + main.h / 2, weight: 2.5 });
  }

  // Delegacia: recepção, escritório, vestiário, arsenal (trancado), cela
  function genPolice(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - 4, bx = 1, by = 1;
    const b = P.addBuilding({ type: 'police', name: o.name, wall: W.BRICK, wallColor: '#7f6a5c', roofColor: '#34404d' });
    P.foot(b, bx, by, bw, bh);
    const { ix, iy, iw, ih } = interior(P, bx, by, bw, bh);
    const bD = 3;
    const lobby = P.addRoom(b, 'police', ix, iy + bD + 1, iw, ih - bD - 1, F.LINOLEUM); lobby.loot = 'police_lobby';
    const w1 = 3, w2 = 2, w3 = 3, w4 = iw - w1 - w2 - w3 - 3;
    const cell = P.addRoom(b, 'police', ix, iy, w1, bD, F.CONCRETE); cell.loot = 'police_cell';
    const arm = P.addRoom(b, 'police', ix + w1 + 1, iy, w2, bD, F.CONCRETE); arm.loot = 'police_armory';
    const lock = P.addRoom(b, 'police', ix + w1 + w2 + 2, iy, w3, bD, F.LINOLEUM); lock.loot = 'police_lockers';
    const off = P.addRoom(b, 'office', ix + w1 + w2 + w3 + 3, iy, w4, bD, F.CARPET); off.loot = 'police_office';
    P.buildWalls(b, W.BRICK, W.PLASTER, F.CONCRETE);
    // grades da cela (parede de baixo da cela)
    for (let x = cell.x; x < cell.x + cell.w; x++) P.wall[(cell.y + cell.h) * P.w + x] = W.FENCE_METAL;
    P.door(cell, lobby, { locked: true });
    P.door(arm, lobby, { locked: true });
    P.door(lock, lobby, { open: rng() < 0.5 });
    P.door(off, lobby, { open: true });
    P.door(off, null, { score: (c) => (c.ny === 1 ? 0 : 20) + rng(), locked: true });
    const dx = lobby.x + Math.floor(lobby.w / 2);
    frontDoors(P, lobby, 1, { x: dx });
    P.windows(lobby, { p: 0.7, side: (c) => c.ny === -1 });
    P.windows(off, { p: 0.6, max: 2 });
    P.tryPut(cell, 'bed', cell.x, cell.y, 1, 2, 0); P.tryPut(cell, 'toilet', cell.x + cell.w - 1, cell.y, 1, 1, 1);
    for (let x = arm.x; x < arm.x + arm.w; x++) P.tryPut(arm, 'gun_locker', x, arm.y, 1, 1, 1);
    P.placeWall(arm, 'crate', { corner: true });
    for (let x = lock.x; x < lock.x + lock.w; x++) P.tryPut(lock, 'locker', x, lock.y, 1, 1, 1);
    P.placeWall(lock, 'bench', { a: 2, side: 'bottom' });
    furnish(P, off); P.placeWall(off, 'locker', {});
    // recepção: balcão + mesas
    for (let i = 0; i < 2; i++) { const d = P.placeWall(lobby, 'desk', { far: { x: dx, y: lobby.y + lobby.h } }); if (d >= 0) chairFront(P, lobby, d); }
    P.placeWall(lobby, 'bench', { a: 2, near: { x: dx, y: lobby.y + lobby.h } });
    P.placeWall(lobby, 'plant', { corner: true }); P.placeWall(lobby, 'bookshelf', { corner: true });
    pathTo(P, dx, by + bh, LD - 1);
    parking(P, 0, by + bh, LW - 1, LD - 1, rng, 0.5, ['police_car', 'police_car', 'car']);
    pathTo(P, dx, by + bh, LD - 1, F.SIDEWALK);
    P.putOut('lamp_post', 0, LD - 1, 1, 1, 1);
    P.zspawn.push({ x: lobby.x + lobby.w / 2, y: lobby.y + 1, weight: 2 });
  }

  // Armazém/galpão: portão de enrolar, paletes, caixotes, escritório
  function genWarehouse(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - 4, bx = 1, by = 1;
    const b = P.addBuilding({ type: 'warehouse', name: o.name, wall: W.CONCRETE, wallColor: '#8e9290', roofColor: '#6a6f6c' });
    P.foot(b, bx, by, bw, bh);
    const { ix, iy, iw, ih } = interior(P, bx, by, bw, bh);
    const main = P.addRoom(b, 'warehouse', ix, iy, iw - 5, ih, F.CONCRETE);
    const off = P.addRoom(b, 'office', ix + iw - 4, iy + ih - 4, 4, 4, F.LINOLEUM); off.loot = 'warehouse_office';
    const st = P.addRoom(b, 'storage', ix + iw - 4, iy, 4, ih - 5, F.CONCRETE); st.loot = 'warehouse_tools';
    P.buildWalls(b, W.CONCRETE, W.CONCRETE, F.CONCRETE);
    P.door(off, main, {}); P.door(st, main, { locked: rng() < 0.4 });
    frontDoors(P, main, 3, { x: main.x + 2, garage: true, locked: true });
    frontDoors(P, off, 1, { x: off.x + 1 });
    P.windows(off, { p: 1, max: 1 }); P.windows(main, { p: 0.25, max: 3, side: (c) => c.ny !== -1 });
    // prateleiras nas paredes, paletes/caixotes em fileiras
    for (let y = main.y; y < main.y + main.h - 3; y++) P.tryPut(main, 'shelf', main.x, y, 1, 1, 0);
    for (let x = main.x + 1; x < main.x + main.w; x++) P.tryPut(main, 'shelf', x, main.y, 1, 1, 1);
    for (let x = main.x + 3; x < main.x + main.w - 1; x += 3) for (let y = main.y + 2; y < main.y + main.h - 3; y++) {
      if (rng() < 0.8) P.tryPut(main, rng() < 0.55 ? 'crate' : 'pallet', x, y, 1, 1, 1);
    }
    P.placeWall(main, 'workbench', { far: { x: main.x, y: main.y + main.h } });
    for (let i = 0; i < 3; i++) P.placeWall(main, 'barrel', { corner: true });
    P.placeWall(st, 'workbench', {}); P.placeWall(st, 'shelf', {}); P.placeWall(st, 'shelf', {}); P.placeWall(st, 'crate', {});
    furnish(P, off);
    P.fill(0, by + bh, LW, LD - by - bh, F.CONCRETE);
    pathTo(P, off.x + 1, by + bh, LD - 1);
    for (let x = main.x + 2; x <= main.x + 4; x++) pathTo(P, x, by + bh, LD - 1);
    for (let i = 0; i < 4; i++) P.putOut(rng() < 0.5 ? 'pallet' : 'barrel', rng.int(1, LW - 2), rng.int(by + bh + 1, LD - 2), 1, 1, 1);
    P.putOut('dumpster', LW - 1, by + 1, 1, 2, 2);
    if (rng() < 0.6) P.putOut('car', rng.int(1, LW - 3), by + bh + 1, 2, 1, 0);
    P.zspawn.push({ x: main.x + main.w / 2, y: main.y + main.h / 2, weight: 1.5 });
  }

  // Igreja: nave com bancos, altar, sacristia
  function genChurch(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - 3, bx = 1, by = 1;
    const b = P.addBuilding({ type: 'church', name: o.name, wall: W.WOOD, wallColor: '#ecebe4', roofColor: '#3b3b40' });
    P.foot(b, bx, by, bw, bh);
    const { ix, iy, iw, ih } = interior(P, bx, by, bw, bh);
    const nave = P.addRoom(b, 'church', ix, iy + 4, iw, ih - 4, F.WOOD);
    const sac = P.addRoom(b, 'office', ix, iy, Math.floor(iw / 2), 3, F.CARPET); sac.loot = 'church_office';
    const st = P.addRoom(b, 'storage', ix + sac.w + 1, iy, iw - sac.w - 1, 3, F.WOOD); st.loot = 'church_storage';
    P.buildWalls(b, W.WOOD, W.PLASTER, F.WOOD);
    P.door(sac, nave, {}); P.door(st, nave, { locked: rng() < 0.5 });
    const dx = nave.x + Math.floor(nave.w / 2) - 1;
    frontDoors(P, nave, 2, { x: dx });
    P.windows(nave, { p: 0.6, side: (c) => c.ny === 0 });
    P.windows(sac, { p: 1, max: 1 });
    // altar
    P.tryPut(nave, 'table', dx, nave.y + 1, 2, 1, 3);
    P.tryPut(nave, 'plant', nave.x, nave.y, 1, 1, 0); P.tryPut(nave, 'plant', nave.x + nave.w - 1, nave.y, 1, 1, 0);
    // bancos: duas colunas com corredor central
    for (let y = nave.y + 3; y <= nave.y + nave.h - 2; y += 2) {
      const lw = dx - nave.x - 1, rw = nave.x + nave.w - (dx + 2) - 1;
      if (lw >= 2) P.tryPut(nave, 'bench', nave.x + 1, y, Math.min(3, lw), 1, 3);
      if (rw >= 2) P.tryPut(nave, 'bench', dx + 3, y, Math.min(3, rw), 1, 3);
    }
    furnish(P, sac); P.placeWall(st, 'shelf', {}); P.placeWall(st, 'crate', {});
    P.fill(dx, by + bh, 2, LD - by - bh, F.SIDEWALK);
    pathTo(P, dx, by + bh, LD - 1); pathTo(P, dx + 1, by + bh, LD - 1);
    P.putOut('bench', 0, by + bh, 2, 1, 1); P.putOut('lamp_post', LW - 1, LD - 1, 1, 1, 1);
    P.zspawn.push({ x: nave.x + nave.w / 2, y: nave.y + nave.h / 2, weight: 3 });
  }

  // Cemitério: cerca de ferro, túmulos em fileiras, caminho de terra, pinheiros
  function genCemetery(P, rng, o) {
    const LW = P.w, LD = P.h;
    P.fill(0, 0, LW, LD, F.DARK_GRASS);
    const gx = Math.floor(LW / 2);
    P.fill(gx, 1, 1, LD - 1, F.DIRT);
    for (let y = 1; y < LD; y++) P.resv[y * LW + gx] = 1;
    P.fence(0, 0, LW - 1, 0, W.FENCE_METAL); P.fence(0, 0, 0, LD - 1, W.FENCE_METAL);
    P.fence(LW - 1, 0, LW - 1, LD - 1, W.FENCE_METAL); P.fence(0, LD - 1, LW - 1, LD - 1, W.FENCE_METAL);
    P.put('fence_gate', gx, LD - 1, 1, 1, 1);
    for (let y = 2; y < LD - 2; y += 2) for (let x = 2; x < LW - 2; x++) {
      if (x === gx || x === gx - 1 || x === gx + 1) continue;
      if (rng() < 0.72) P.putOut('grave', x, y, 1, 1, 1);
    }
    for (let i = 0; i < 5; i++) P.putOut(rng() < 0.6 ? 'pine' : 'tree', rng.int(1, LW - 2), rng.int(1, LD - 2), 1, 1, 0);
    P.putOut('bench', gx + 2, LD - 3, 2, 1, 3);
    P.zspawn.push({ x: LW / 2, y: LD / 2, weight: 0.6 });
  }

  // Celeiro (fazenda)
  function genBarn(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - 3, bx = 1, by = 1;
    const b = P.addBuilding({ type: 'warehouse', name: o.name, wall: W.WOOD, wallColor: '#8e3b2f', roofColor: '#4a4a48' });
    P.foot(b, bx, by, bw, bh);
    const { ix, iy, iw, ih } = interior(P, bx, by, bw, bh);
    const main = P.addRoom(b, 'warehouse', ix, iy, iw, ih, F.DIRT); main.loot = 'farm';
    P.buildWalls(b, W.WOOD, W.WOOD, F.DIRT);
    frontDoors(P, main, 3, { x: main.x + Math.floor(main.w / 2) - 1, garage: true, open: rng() < 0.5 });
    P.windows(main, { p: 0.3, max: 2, side: (c) => c.ny !== -1 });
    P.placeWall(main, 'workbench', {}); P.placeWall(main, 'shelf', { corner: true }); P.placeWall(main, 'shelf', { corner: true });
    for (let i = 0; i < 4; i++) P.placeWall(main, rng() < 0.5 ? 'crate' : 'log_pile', {});
    for (let i = 0; i < 3; i++) P.placeWall(main, 'barrel', { corner: true });
    P.fill(0, by + bh, LW, LD - by - bh, F.DIRT);
    P.zspawn.push({ x: main.x + main.w / 2, y: main.y + main.h / 2, weight: 0.8 });
  }

  // Tabela de prédios especiais: [gerador, largura do lote, profundidade, opções]
  const SPECIALS = [
    { key: 'market', gen: genMarket, lw: 22, ld: 20, o: { name: 'Mercado Bom Preço' } },
    { key: 'gas', gen: genGas, lw: 16, ld: 14, o: { name: 'Posto Estrela' } },
    { key: 'pharmacy', gen: genShop, lw: 12, ld: 15, o: { name: 'Farmácia Vida', btype: 'pharmacy', mainType: 'pharmacy', loot: 'pharmacy', freezers: true, backType: 'pharmacy', backLoot: 'pharmacy_back', backLocked: true, backObj: 'shelf', backExtra: ['medicine_cabinet'], wallColor: '#e8e4dc', roofColor: '#3c6a58', parking: true } },
    { key: 'diner', gen: genDiner, lw: 14, ld: 13, o: { name: 'Lanchonete da Rosa' } },
    { key: 'police', gen: genPolice, lw: 18, ld: 14, o: { name: 'Delegacia de Vale Quieto' } },
    { key: 'hardware', gen: genShop, lw: 14, ld: 15, o: { name: 'Ferragens Silva', btype: 'store', mainType: 'store', loot: 'hardware', backType: 'storage', backLoot: 'hardware_storage', backObj: 'crate', backExtra: ['workbench'], wallColor: '#8d7b62', roofColor: '#4d3f33', parking: true } },
    { key: 'post', gen: genShop, lw: 12, ld: 13, o: { name: 'Agência dos Correios', btype: 'office', mainType: 'office', loot: 'post_office', backType: 'storage', backLoot: 'post_storage', backObj: 'crate', office: true, wallColor: '#b9a58a', roofColor: '#2f4a6b', floor: F.CARPET } },
    { key: 'clothes', gen: genShop, lw: 12, ld: 14, o: { name: 'Loja de Roupas Estilo', btype: 'store', mainType: 'store', loot: 'clothing', backType: 'storage', backLoot: 'clothing_storage', backObj: 'shelf', wallColor: '#c9b4a8', roofColor: '#5b3b44', floor: F.WOOD } },
    { key: 'warehouse', gen: genWarehouse, lw: 18, ld: 16, o: { name: 'Armazém Vale Quieto' } },
  ];

  // ------------------------------------------------------------------
  // 4. Layout global
  // ------------------------------------------------------------------
  function allocMap(w, h) {
    const n = w * h;
    return {
      w, h,
      floor: new Uint8Array(n).fill(F.GRASS), wall: new Uint8Array(n), wallState: new Uint8Array(n),
      wallHp: new Float32Array(n), barricadeHp: new Float32Array(n),
      building: new Uint16Array(n), room: new Uint16Array(n), objAt: new Int32Array(n).fill(-1),
      buildings: [], rooms: [], objects: [], spawnPoint: { x: w / 2, y: h / 2 }, zombieSpawns: [],
    };
  }

  // Cria objeto no mapa (checa pegada). Retorna o objeto ou null.
  function addObject(ctx, type, x, y, w, h, rot, opts) {
    const m = ctx.m, def = ODEF[type];
    opts = opts || {};
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (i < 0 || j < 0 || i >= m.w || j >= m.h) return null;
      const k = j * m.w + i;
      if (m.wall[k] || m.objAt[k] >= 0 || m.floor[k] === F.WATER) return null;
      if (opts.outdoor && m.building[k]) return null;
    }
    const k0 = y * m.w + x;
    const o = {
      id: m.objects.length, type, x, y, w, h, rot: rot & 3,
      blocksMove: !!def.block, blocksSight: !!def.sight, height: def.ht,
      container: null,
      light: def.light ? { radius: def.light.radius, color: def.light.color, needsPower: def.light.needsPower } : null,
      variant: opts.variant != null ? opts.variant : Math.floor(ctx.rng() * 8),
      building: m.building[k0], room: m.room[k0],
    };
    if (def.cont) {
      const rt = opts.roomType || 'outdoor';
      o.container = { name: def.cont[0], items: [], capacity: def.cont[1], searched: false, lootKey: (opts.loot || rt) + ':' + type };
      try { if (G.items && G.items.fillContainer) G.items.fillContainer(o.container, rt, type, ctx.lootRng); } catch (e) { console.error('[world] fillContainer', e); }
    }
    if (opts.extra) Object.assign(o, opts.extra);
    m.objects.push(o);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m.objAt[j * m.w + i] = o.id;
    return o;
  }


  // ---- Transformação do lote (canônico, frente +y) para o mundo ----
  function lotTf(lot, P) {
    const LW = P.w, LD = P.h, x0 = lot.x, y0 = lot.y, f = lot.face;
    return {
      t(lx, ly, out) { // tile
        if (f === 'S') { out.x = x0 + lx; out.y = y0 + ly; }
        else if (f === 'N') { out.x = x0 + LW - 1 - lx; out.y = y0 + LD - 1 - ly; }
        else if (f === 'E') { out.x = x0 + ly; out.y = y0 + LW - 1 - lx; }
        else { out.x = x0 + LD - 1 - ly; out.y = y0 + lx; }
        return out;
      },
      p(px, py) { // ponto contínuo
        if (f === 'S') return { x: x0 + px, y: y0 + py };
        if (f === 'N') return { x: x0 + LW - px, y: y0 + LD - py };
        if (f === 'E') return { x: x0 + py, y: y0 + LW - px };
        return { x: x0 + LD - py, y: y0 + px };
      },
      rot(r) { return (r + (f === 'S' ? 0 : f === 'N' ? 2 : f === 'E' ? 3 : 1)) & 3; },
    };
  }

  function stampLot(ctx, P, lot) {
    const m = ctx.m, tf = lotTf(lot, P), q = { x: 0, y: 0 }, q2 = { x: 0, y: 0 };
    const bIds = P.blds.map((info) => {
      const id = m.buildings.length + 1;
      m.buildings.push({ id, x: 1e9, y: 1e9, w: 0, h: 0, x2: -1, y2: -1, type: info.type, name: info.name, roofColor: info.roofColor,
        wallColor: info.wallColor, wall: info.wall, doors: [], lot: ctx.lots.length });
      return id;
    });
    const rIds = P.rooms.map((r) => {
      tf.t(r.x, r.y, q); tf.t(r.x + r.w - 1, r.y + r.h - 1, q2);
      const id = m.rooms.length + 1;
      m.rooms.push({ id, building: bIds[r.b - 1], type: r.type, x: Math.min(q.x, q2.x), y: Math.min(q.y, q2.y),
        w: Math.abs(q.x - q2.x) + 1, h: Math.abs(q.y - q2.y) + 1, loot: r.loot || r.type });
      return id;
    });
    for (let ly = 0; ly < P.h; ly++) for (let lx = 0; lx < P.w; lx++) {
      const k = ly * P.w + lx;
      tf.t(lx, ly, q);
      if (q.x < 0 || q.y < 0 || q.x >= m.w || q.y >= m.h) continue;
      const i = q.y * m.w + q.x;
      if (P.floor[k]) m.floor[i] = P.floor[k];
      if (P.wall[k]) { m.wall[i] = P.wall[k]; m.wallState[i] = P.ws[k]; m.wallHp[i] = baseHp(P.wall[k]); }
      if (P.bld[k]) {
        const id = bIds[P.bld[k] - 1], B = m.buildings[id - 1];
        m.building[i] = id;
        if (q.x < B.x) B.x = q.x; if (q.y < B.y) B.y = q.y; if (q.x > B.x2) B.x2 = q.x; if (q.y > B.y2) B.y2 = q.y;
      }
      if (P.room[k] >= 0) m.room[i] = rIds[P.room[k]];
      if (P.resv[k]) ctx.keep[i] = 1;
    }
    for (const B of m.buildings) if (B.x2 >= 0 && B.w === 0) { B.w = B.x2 - B.x + 1; B.h = B.y2 - B.y + 1; }
    P.blds.forEach((info, bi) => {
      const B = m.buildings[bIds[bi] - 1];
      for (const d of info.doors) { tf.t(d.x, d.y, q); B.doors.push({ x: q.x, y: q.y }); }
    });
    for (const o of P.objs) {
      tf.t(o.x, o.y, q); tf.t(o.x + o.w - 1, o.y + o.h - 1, q2);
      const x = Math.min(q.x, q2.x), y = Math.min(q.y, q2.y);
      const r = o.room != null && o.room >= 0 ? P.rooms[o.room] : null;
      addObject(ctx, o.type, x, y, Math.abs(q.x - q2.x) + 1, Math.abs(q.y - q2.y) + 1, tf.rot(o.rot),
        { roomType: r ? r.type : 'outdoor', loot: r ? r.loot || r.type : 'outdoor', variant: o.variant });
    }
    for (const z of P.zspawn) { const p = tf.p(z.x, z.y); ctx.zs.push({ x: p.x, y: p.y, weight: z.weight, b: bIds[0] || 0 }); }
    const rec = Object.assign({}, lot, { bIds, rIds, kind: lot.kind });
    ctx.lots.push(rec);
    return rec;
  }

  // ---- Estradas ----
  // Segmento: { h: horizontal?, c: linha central, a0, a1: intervalo, kind: 'street'|'rural'|'dirt' }
  function seg(ctx, x0, y0, x1, y1, kind) {
    const T = ctx.T;
    const p0 = T(x0, y0), p1 = T(x1, y1);
    const horiz = p0.y === p1.y;
    const r = horiz ? { h: true, c: p0.y, a0: Math.min(p0.x, p1.x), a1: Math.max(p0.x, p1.x), kind }
      : { h: false, c: p0.x, a0: Math.min(p0.y, p1.y), a1: Math.max(p0.y, p1.y), kind };
    ctx.roads.push(r);
    return r;
  }
  function roadCell(r, t, o) { return r.h ? { x: t, y: r.c + o } : { x: r.c + o, y: t }; }

  function paintRoads(ctx) {
    const m = ctx.m, w = m.w, h = m.h, cnt = new Uint8Array(w * h);
    const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    const paved = ctx.roads.filter((r) => r.kind !== 'dirt');
    // asfalto
    for (const r of paved) for (let t = r.a0; t <= r.a1; t++) for (let o = -2; o <= 2; o++) {
      const p = roadCell(r, t, o); if (!inb(p.x, p.y)) continue;
      const i = p.y * w + p.x; m.floor[i] = F.ASPHALT; cnt[i]++; ctx.res[i] = 1;
    }
    // bolsões de retorno (cul-de-sac)
    for (const b of ctx.bulbs) for (let y = b.y - 6; y <= b.y + 6; y++) for (let x = b.x - 6; x <= b.x + 6; x++) {
      if (!inb(x, y)) continue;
      const d = Math.hypot(x - b.x, y - b.y), i = y * w + x;
      if (d <= 4.3) { m.floor[i] = F.ASPHALT; cnt[i] += 2; ctx.res[i] = 1; }
    }
    ctx.roadCnt = cnt;
    // faixa amarela tracejada no centro (fora de cruzamentos)
    for (const r of paved) for (let t = r.a0; t <= r.a1; t++) {
      const p = roadCell(r, t, 0); if (!inb(p.x, p.y)) continue;
      const i = p.y * w + p.x;
      let clear = true;
      for (let o = -2; o <= 2 && clear; o++) { const q = roadCell(r, t, o); if (inb(q.x, q.y) && cnt[q.y * w + q.x] !== 1) clear = false; }
      if (clear && (t & 3) < 2) m.floor[i] = F.ROAD_LINE;
    }
    // calçadas / acostamentos
    for (const r of paved) for (let t = r.a0 - (r.kind === 'street' ? 1 : 0); t <= r.a1 + (r.kind === 'street' ? 1 : 0); t++) for (const o of [-3, 3]) {
      const p = roadCell(r, t, o); if (!inb(p.x, p.y)) continue;
      const i = p.y * w + p.x; if (cnt[i]) continue;
      m.floor[i] = r.kind === 'street' ? F.SIDEWALK : F.GRAVEL; ctx.res[i] = 1;
    }
    for (const b of ctx.bulbs) for (let y = b.y - 6; y <= b.y + 6; y++) for (let x = b.x - 6; x <= b.x + 6; x++) {
      if (!inb(x, y)) continue;
      const d = Math.hypot(x - b.x, y - b.y), i = y * w + x;
      if (d > 4.3 && d <= 5.5 && !cnt[i]) { m.floor[i] = F.SIDEWALK; ctx.res[i] = 1; }
    }
    // estradas de terra (3 de largura, cascalho no meio)
    for (const r of ctx.roads) if (r.kind === 'dirt') for (let t = r.a0; t <= r.a1; t++) for (let o = -1; o <= 1; o++) {
      const p = roadCell(r, t, o); if (!inb(p.x, p.y)) continue;
      const i = p.y * w + p.x; if (ctx.res[i]) continue;
      m.floor[i] = o === 0 && U.hash2(p.x, p.y, 7) < 0.5 ? F.GRAVEL : F.DIRT; ctx.res[i] = 5;
    }
  }

  // ---- Lotes ao longo das ruas ----
  function lotRect(r, side, p, LW, LD) {
    const off = 4;
    if (r.h) return side < 0 ? { x: p, y: r.c - off - LD + 1, w: LW, h: LD, face: 'S' } : { x: p, y: r.c + off, w: LW, h: LD, face: 'N' };
    return side < 0 ? { x: r.c - off - LD + 1, y: p, w: LD, h: LW, face: 'E' } : { x: r.c + off, y: p, w: LD, h: LW, face: 'W' };
  }
  function rectFree(ctx, R, margin) {
    const m = ctx.m, mg = margin != null ? margin : 3;
    if (R.x < mg || R.y < mg || R.x + R.w > m.w - mg || R.y + R.h > m.h - mg) return false;
    for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) if (ctx.res[y * m.w + x]) return false;
    return true;
  }
  function claim(ctx, R, v) { for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) ctx.res[y * ctx.m.w + x] = v; }
  function buildLot(ctx, R, LW, LD, gen, o, kind) {
    const P = new Plan(LW, LD, ctx.rng);
    const ok = gen(P, ctx.rng, o);
    if (ok === false) return null;
    claim(ctx, R, 2);
    return stampLot(ctx, P, { x: R.x, y: R.y, w: R.w, h: R.h, face: R.face, kind, name: o.name });
  }
  // Varre a frente de rua procurando o melhor lugar (menor score)
  function bestFrontage(ctx, LW, LD, score, roads) {
    let best = null, bs = 1e9;
    for (const r of roads || ctx.roads) {
      if (r.kind === 'dirt' && !ctx.allowDirt) continue;
      for (const side of [-1, 1]) for (let p = r.a0 - LW; p <= r.a1; p++) {
        const R = lotRect(r, side, p, LW, LD);
        const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
        // o lote precisa estar de frente para a rua (centro projetado dentro do trecho)
        const along = r.h ? cx : cy;
        if (along < r.a0 + 1 || along > r.a1 - 1) continue;
        const s = score(cx, cy, r, R);
        if (s >= bs) continue;
        if (!rectFree(ctx, R)) continue;
        bs = s; best = R;
      }
    }
    return best;
  }

  function placeSpecials(ctx) {
    const C0 = ctx.center;
    const town = ctx.roads.filter((r) => r.kind === 'street');
    for (const S of SPECIALS) {
      const score = (cx, cy, r) => {
        let d = Math.hypot(cx - C0.x, cy - C0.y);
        if (S.key === 'gas' && r !== ctx.hwyTown) d += 25;
        if (S.key === 'warehouse') d = Math.abs(d - 34) + (r === ctx.hwyTown || r.kind === 'rural' ? 0 : 40);
        return d + ctx.rng() * 3;
      };
      const R = bestFrontage(ctx, S.lw, S.ld, score, S.key === 'warehouse' || S.key === 'gas' ? town.concat(ctx.roads.filter((r) => r.kind === 'rural')) : town);
      if (R) buildLot(ctx, R, S.lw, S.ld, S.gen, Object.assign({}, S.o), 'commercial');
    }
    // igreja + cemitério ao sul
    const T = ctx.churchTarget;
    const R = bestFrontage(ctx, 14, 20, (cx, cy) => Math.hypot(cx - T.x, cy - T.y) + ctx.rng() * 2);
    if (R) {
      buildLot(ctx, R, 14, 20, genChurch, { name: 'Igreja Batista de Vale Quieto' }, 'church');
      const Rc = bestFrontage(ctx, 18, 18, (cx, cy) => Math.hypot(cx - (R.x + R.w / 2), cy - (R.y + R.h / 2)) + ctx.rng());
      if (Rc) buildLot(ctx, Rc, 18, 18, genCemetery, { name: 'Cemitério' }, 'cemetery');
    }
  }

  function houseName(ctx) {
    const n = ctx.names[ctx.nameI++ % ctx.names.length];
    return 'Casa dos ' + n;
  }

  function placeHouses(ctx) {
    const rng = ctx.rng;
    // ruas sem saída primeiro (senão os lotes de esquina roubam a frente delas)
    const order = ctx.roads.filter((r) => r.culdesac).concat(ctx.roads.filter((r) => !r.culdesac));
    for (const r of order) {
      if (r.kind === 'dirt') continue;
      const rural = r.kind === 'rural';
      for (const side of [-1, 1]) {
        let p = r.a0;
        while (p <= r.a1) {
          let LW = rng.int(13, 17);
          let placed = false;
          if (!rural || rng() < 0.2) {
            // tenta a largura sorteada e, se não couber, a mínima (aproveita o fim do quarteirão)
            for (const lw of LW > 13 ? [LW, 13] : [13]) {
              for (let LD = rural ? rng.int(13, 16) : rng.int(13, 14); LD >= 13 && !placed; LD--) {
                const R = lotRect(r, side, p, lw, LD);
                const along = r.h ? R.x + R.w / 2 : R.y + R.h / 2;
                if (along < r.a0 || along > r.a1) break;
                if (!rectFree(ctx, R)) continue;
                if (buildLot(ctx, R, lw, LD, genHouse, { name: houseName(ctx) }, 'house')) { placed = true; LW = lw; }
              }
              if (placed) break;
            }
          }
          if (placed) p += LW + (rng() < 0.3 ? 1 : 0) + (rng() < 0.07 ? rng.int(5, 9) : 0);
          else p += rural ? rng.int(3, 8) : 1;
        }
      }
    }
  }

  // ---- Lago com praia, píer e trilha ----
  function lake(ctx) {
    const m = ctx.m, w = m.w, rng = ctx.rng;
    const c = ctx.lakeC, rx = rng.int(7, 9), ry = rng.int(7, 10);
    const ang = rng() * Math.PI * 2, lobe = { x: c.x + Math.cos(ang) * rx * 0.75, y: c.y + Math.sin(ang) * ry * 0.75 };
    const cells = [];
    for (let y = Math.floor(c.y - ry * 1.9 - 4); y <= c.y + ry * 1.9 + 4; y++) for (let x = Math.floor(c.x - rx * 1.9 - 4); x <= c.x + rx * 1.9 + 4; x++) {
      if (x < 2 || y < 2 || x >= w - 2 || y >= m.h - 2) continue;
      const i = y * w + x;
      if (ctx.res[i]) continue;
      const d1 = ((x - c.x) / rx) ** 2 + ((y - c.y) / ry) ** 2;
      const d2 = ((x - lobe.x) / (rx * 0.62)) ** 2 + ((y - lobe.y) / (ry * 0.55)) ** 2;
      const d = Math.min(d1, d2) + (U.noise2(x * 0.2, y * 0.2, ctx.seed) - 0.5) * 0.9 + (U.noise2(x * 0.5, y * 0.5, ctx.seed + 3) - 0.5) * 0.25;
      if (d < 1) { m.floor[i] = F.WATER; ctx.res[i] = 3; cells.push(i); }
      else if (d < 1.3) { m.floor[i] = F.SAND; ctx.res[i] = 3; }
      else if (d < 1.9) ctx.res[i] = 6; // margem: sem lotes, mas pode ter árvores
    }
    // píer: do ponto da margem mais próximo da rodovia
    const hw = ctx.hwyTown;
    let best = null, bd = 1e9;
    for (const i of cells) {
      const x = i % w, y = (i / w) | 0;
      const d = hw.h ? Math.abs(y - hw.c) : Math.abs(x - hw.c);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    ctx.lakeInfo = { c, rx, ry, shore: best };
    if (!best) return;
    // direção do píer: para o centro do lago
    const dx = Math.sign(Math.round(c.x - best.x)), dy = Math.sign(Math.round(c.y - best.y));
    const ax = Math.abs(c.x - best.x) > Math.abs(c.y - best.y) ? dx : 0, ay = ax ? 0 : dy;
    for (let s = -1; s < 4; s++) {
      const x = best.x + ax * s, y = best.y + ay * s;
      m.floor[y * w + x] = F.WOOD;
      if (ax) { m.floor[(y + 1) * w + x] = F.WOOD; } else { m.floor[y * w + x + 1] = F.WOOD; }
    }
    // trilha de terra da rodovia até a margem
    const sx = best.x - ax * 2, sy = best.y - ay * 2;
    trail(ctx, sx, sy, hw.h ? sx : hw.c + (sx < hw.c ? -3 : 3), hw.h ? hw.c + (sy < hw.c ? -3 : 3) : sy, 2);
    ctx.lakeInfo.trailStart = { x: sx, y: sy };
    // juncos e pedras na margem
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (m.floor[i] !== F.SAND || m.objAt[i] >= 0) continue;
      const wet = m.floor[i - 1] === F.WATER || m.floor[i + 1] === F.WATER || m.floor[i - w] === F.WATER || m.floor[i + w] === F.WATER;
      const r = rng();
      if (wet && r < 0.14) addObject(ctx, 'bush', x, y, 1, 1, 0, { outdoor: true, variant: 7 });
      else if (!wet && r < 0.04) addObject(ctx, 'rock', x, y, 1, 1, 0, { outdoor: true });
    }
    // mesas de piquenique, banco, lenha, pedras na praia
    const around = [];
    for (let y = sy - 5; y <= sy + 5; y++) for (let x = sx - 5; x <= sx + 5; x++) {
      if (x < 1 || y < 1 || x >= w - 1 || y >= m.h - 1) continue;
      const f = m.floor[y * w + x];
      if ((f === F.GRASS || f === F.SAND) && !ctx.res[y * w + x] || f === F.SAND) around.push({ x, y });
    }
    shuffle(around, rng);
    const items = [['picnic_table', 2, 1], ['picnic_table', 2, 1], ['bench', 2, 1], ['log_pile', 2, 1], ['rock', 1, 1], ['trash_can', 1, 1], ['barrel', 1, 1]];
    for (const [t, ow, oh] of items) {
      for (const p of around) {
        if (Math.abs(p.x - sx) + Math.abs(p.y - sy) < 2) continue;
        let bad = false;
        for (let j = p.y; j < p.y + oh; j++) for (let i = p.x; i < p.x + ow; i++) { const f = m.floor[j * w + i]; if (f === F.WATER || f === F.WOOD || f === F.DIRT) bad = true; }
        if (bad) continue;
        if (addObject(ctx, t, p.x, p.y, ow, oh, rng.int(0, 3) & 1 ? 1 : 3, { outdoor: true })) break;
      }
    }
  }

  // Trilha de terra entre dois pontos (caminho em L com leve ondulação)
  function trail(ctx, x0, y0, x1, y1, width) {
    const m = ctx.m, w = m.w, rng = ctx.rng;
    let x = x0, y = y0, guard = 0;
    const paint = (px, py) => {
      for (let o = 0; o < (width || 1); o++) {
        const qx = px + (o && Math.abs(x1 - x0) < Math.abs(y1 - y0) ? 1 : 0), qy = py + (o && Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? 1 : 0);
        if (qx < 1 || qy < 1 || qx >= w - 1 || qy >= m.h - 1) continue;
        const i = qy * w + qx, f = m.floor[i];
        if (f === F.WATER || f === F.ASPHALT || f === F.ROAD_LINE || f === F.SIDEWALK || m.wall[i] || m.building[i]) continue;
        if (ctx.res[i] === 2 || ctx.res[i] === 1) continue;
        m.floor[i] = rng() < 0.85 ? F.DIRT : F.GRAVEL;
        if (!ctx.res[i]) ctx.res[i] = 4;
      }
    };
    while ((x !== x1 || y !== y1) && guard++ < 600) {
      paint(x, y);
      const dx = Math.sign(x1 - x), dy = Math.sign(y1 - y);
      if (dx && dy) { if (rng() < Math.abs(x1 - x) / (Math.abs(x1 - x) + Math.abs(y1 - y))) x += dx; else y += dy; }
      else if (dx) { x += dx; if (rng() < 0.15 && y > 2 && y < m.h - 3) y += rng() < 0.5 ? 1 : -1; }
      else { y += dy; if (rng() < 0.15 && x > 2 && x < w - 3) x += rng() < 0.5 ? 1 : -1; }
    }
    paint(x1, y1);
  }

  // ---- Fazenda: casa, celeiro e plantação cercada ao longo da estrada de terra ----
  function genField(P, rng) {
    const LW = P.w, LD = P.h;
    const vertical = rng() < 0.5;
    for (let y = 1; y < LD - 1; y++) for (let x = 1; x < LW - 1; x++) {
      const row = vertical ? x : y;
      P.floor[y * LW + x] = row % 2 ? F.DIRT : F.DARK_GRASS;
    }
    P.fence(0, 0, LW - 1, 0, W.FENCE_WOOD); P.fence(0, 0, 0, LD - 1, W.FENCE_WOOD);
    P.fence(LW - 1, 0, LW - 1, LD - 1, W.FENCE_WOOD);
    const gx = rng.int(2, LW - 3);
    P.resv[(LD - 1) * LW + gx] = 1; P.resv[(LD - 2) * LW + gx] = 1;
    P.fence(0, LD - 1, LW - 1, LD - 1, W.FENCE_WOOD);
    P.put('fence_gate', gx, LD - 1, 1, 1, 1);
    P.fill(gx, 1, 1, LD - 1, F.DIRT);
    for (let y = 1; y < LD - 1; y++) P.resv[y * LW + gx] = 1;
    for (let y = 2; y < LD - 2; y++) for (let x = 2; x < LW - 2; x++) {
      const row = vertical ? x : y;
      if (row % 2 === 0 && x !== gx && rng() < 0.55) P.putOut('bush', x, y, 1, 1, 0);
    }
    P.putOut('barrel', 1, 1, 1, 1, 1);
    return true;
  }
  // Área livre mais próxima de (cx,cy); frente virada para a estrada r
  function nearFree(ctx, LW, LD, cx, cy, maxR, r, filter) {
    let best = null, bd = 1e9;
    for (let y = Math.floor(cy - maxR); y <= cy + maxR; y++) for (let x = Math.floor(cx - maxR); x <= cx + maxR; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= bd) continue;
      const toward = r.h ? (y + LD / 2 < r.c ? 'S' : 'N') : (x + LD / 2 < r.c ? 'E' : 'W');
      const vert = toward === 'S' || toward === 'N';
      const R = { x, y, w: vert ? LW : LD, h: vert ? LD : LW, face: toward };
      if (filter && !filter(R)) continue;
      if (!rectFree(ctx, R)) continue;
      bd = d; best = R;
    }
    return best;
  }
  function farm(ctx) {
    const r = ctx.farmRoad;
    if (!r) return;
    const rng = ctx.rng;
    ctx.allowDirt = true;
    const Fc = ctx.farmC;
    const near = (cx, cy) => Math.hypot(cx - Fc.x, cy - Fc.y) + rng();
    let R = bestFrontage(ctx, 16, 15, near, [r]);
    if (R) buildLot(ctx, R, 16, 15, genHouse, { name: 'Fazenda ' + ctx.names[ctx.nameI++ % ctx.names.length], type: 'house', noGarage: true }, 'farm');
    R = bestFrontage(ctx, 14, 13, near, [r]);
    if (R) buildLot(ctx, R, 14, 13, genBarn, { name: 'Celeiro' }, 'farm');
    for (let i = 0; i < 3; i++) {
      const fw = rng.int(10, 17), fd = rng.int(8, 13);
      const hw = ctx.hwyTown, side = Math.sign((hw.h ? Fc.y : Fc.x) - hw.c);
      const sameSide = (Q) => Math.sign((hw.h ? Q.y + Q.h / 2 : Q.x + Q.w / 2) - hw.c) === side;
      R = bestFrontage(ctx, fw, fd, near, [r]) || nearFree(ctx, fw, fd, Fc.x, Fc.y, 36, r, sameSide);
      if (R) buildLot(ctx, R, fw, fd, genField, { name: 'Plantação' }, 'field');
    }
    ctx.allowDirt = false;
  }

  // ---- Limpeza: nada de cerca/objeto colado na frente de portas e janelas ----
  function cleanup(ctx) {
    const m = ctx.m, w = m.w, kill = new Set();
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, wv = m.wall[i];
      if (!isDoorW(wv) && !isWinW(wv)) continue;
      // eixo da abertura: aquele cujos dois vizinhos não são paredes do prédio
      for (let d = 0; d < 2; d++) {
        const ax = x + DX[d], ay = y + DY[d], bx = x - DX[d], by = y - DY[d];
        const ia = ay * w + ax, ib = by * w + bx;
        const wallA = m.wall[ia] && m.building[ia] === m.building[i] && !isFenceW(m.wall[ia]) && m.wall[ia] !== W.HEDGE;
        const wallB = m.wall[ib] && m.building[ib] === m.building[i] && !isFenceW(m.wall[ib]) && m.wall[ib] !== W.HEDGE;
        if (wallA || wallB) continue;
        for (const j of [ia, ib]) {
          if (isFenceW(m.wall[j]) || m.wall[j] === W.HEDGE) { m.wall[j] = 0; m.wallState[j] = 0; m.wallHp[j] = 0; }
          const o = m.objAt[j];
          if (o >= 0 && isDoorW(wv) && m.objects[o].blocksMove) kill.add(o);
        }
      }
    }
    if (kill.size) purgeObjects(m, kill);
  }
  function purgeObjects(m, kill) {
    m.objects = m.objects.filter((o) => !kill.has(o.id));
    m.objAt.fill(-1);
    m.objects.forEach((o, i) => { o.id = i; for (let j = o.y; j < o.y + o.h; j++) for (let x = o.x; x < o.x + o.w; x++) m.objAt[j * m.w + x] = i; });
  }

  // ---- Bolsões: remove objetos externos que isolam áreas (carro+banco+poste, árvores fechando um tile...) ----
  function fixPockets(ctx) {
    const m = ctx.m, w = m.w, n = w * m.h;
    const seen = new Uint8Array(n), q = new Int32Array(n);
    const pass = (i) => {
      if (m.floor[i] === F.WATER) return false;
      const o = m.objAt[i];
      if (o >= 0 && m.objects[o].blocksMove) return false;
      const wv = m.wall[i];
      return !wv || isDoorW(wv);
    };
    const hw = ctx.hwyTown, s0 = roadCell(hw, (hw.a0 + hw.a1) >> 1, 1);
    for (let iter = 0; iter < 8; iter++) {
      seen.fill(0);
      let h = 0, t = 0;
      const st = s0.y * w + s0.x; seen[st] = 1; q[t++] = st;
      while (h < t) {
        const i = q[h++], x = i % w, y = (i / w) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= m.h) continue;
          const j = ny * w + nx;
          if (!seen[j] && pass(j)) { seen[j] = 1; q[t++] = j; }
        }
      }
      const kill = new Set();
      for (let i = 0; i < n; i++) {
        if (seen[i] || !pass(i)) continue;
        const x = i % w, y = (i / w) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= m.h) continue;
          const oi = m.objAt[ny * w + nx];
          if (oi < 0) continue;
          const o = m.objects[oi];
          if (!o.blocksMove || o.building || m.building[ny * w + nx]) continue;
          // só remove se o objeto encosta numa área alcançada (liga o bolsão ao resto)
          let touches = false;
          for (let yy = o.y - 1; yy <= o.y + o.h && !touches; yy++) for (let xx = o.x - 1; xx <= o.x + o.w; xx++) {
            if (xx < 0 || yy < 0 || xx >= w || yy >= m.h) continue;
            if (seen[yy * w + xx]) { touches = true; break; }
          }
          if (touches) kill.add(oi);
        }
      }
      if (!kill.size) break;
      purgeObjects(m, kill);
    }
  }

  // ---- Detalhes de rua: postes, carros estacionados/abandonados, engavetamento ----
  function streetDetails(ctx) {
    const m = ctx.m, w = m.w, rng = ctx.rng, cnt = ctx.roadCnt;
    const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < m.h;
    const C0 = ctx.center;
    // postes de luz alternados nas calçadas
    for (const r of ctx.roads) {
      if (r.kind !== 'street') continue;
      for (const side of [-3, 3]) {
        for (let t = r.a0 + (side > 0 ? 3 : 8); t <= r.a1; t += 10) {
          let placed = false;
          for (let dt = 0; dt < 3 && !placed; dt++) {
            const p = roadCell(r, t + dt, side);
            if (!inb(p.x, p.y)) continue;
            const i = p.y * w + p.x;
            if (m.floor[i] !== F.SIDEWALK || m.objAt[i] >= 0) continue;
            const q = roadCell(r, t + dt, side + Math.sign(side));
            if (inb(q.x, q.y) && (ctx.keep[q.y * w + q.x] || m.wall[q.y * w + q.x])) continue;
            placed = !!addObject(ctx, 'lamp_post', p.x, p.y, 1, 1, r.h ? (side < 0 ? 1 : 3) : (side < 0 ? 0 : 2));
          }
        }
      }
    }
    // máscara de faixas livres numa seção transversal (virtual = retângulo hipotético bloqueado)
    const V = { x: 0, y: 0, w: 0, h: 0 };
    function freeMask(r, t) {
      let mask = 0;
      for (let o = -2; o <= 2; o++) {
        const p = roadCell(r, t, o);
        if (!inb(p.x, p.y)) continue;
        const i = p.y * w + p.x;
        const inV = p.x >= V.x && p.x < V.x + V.w && p.y >= V.y && p.y < V.y + V.h;
        const oi = m.objAt[i];
        if (!inV && (oi < 0 || !m.objects[oi].blocksMove)) mask |= 1 << (o + 2);
      }
      return mask;
    }
    const bits = (v) => { let c = 0; while (v) { c += v & 1; v >>= 1; } return c; };
    function passable(r, t0, t1) {
      for (let t = t0 - 1; t <= t1 + 1; t++) {
        const a = freeMask(r, t), b = freeMask(r, t + 1);
        if (bits(a) < 2 || !(a & b)) return false;
      }
      return true;
    }
    function simple(r, t0, t1) { // longe de cruzamentos
      for (let t = t0 - 3; t <= t1 + 3; t++) for (let o = -2; o <= 2; o++) {
        const p = roadCell(r, t, o);
        if (!inb(p.x, p.y) || cnt[p.y * w + p.x] !== 1) return false;
      }
      return true;
    }
    // carro na via: lane o (-2..2), crossed = atravessado
    function roadCar(r, t, o, crossed, type) {
      let x, y, cw, ch, rot;
      if (!crossed) {
        const p = roadCell(r, t, o); x = p.x; y = p.y;
        cw = r.h ? 2 : 1; ch = r.h ? 1 : 2;
        rot = r.h ? (o > 0 ? 0 : 2) : (o > 0 ? 3 : 1);
        if (rng() < 0.15) rot = (rot + 2) & 3;
      } else {
        const oo = Math.min(1, Math.max(-2, o));
        const p = roadCell(r, t, oo); x = p.x; y = p.y;
        cw = r.h ? 1 : 2; ch = r.h ? 2 : 1;
        rot = r.h ? (rng() < 0.5 ? 1 : 3) : (rng() < 0.5 ? 0 : 2);
      }
      V.x = x; V.y = y; V.w = cw; V.h = ch;
      const tt0 = t, tt1 = t + (crossed ? 0 : 1);
      const ok = passable(r, tt0, tt1);
      V.w = 0; V.h = 0;
      if (!ok) return null;
      return addObject(ctx, type || 'car', x, y, cw, ch, rot, { outdoor: true });
    }
    for (const r of ctx.roads) {
      if (r.kind === 'dirt') continue;
      for (let t = r.a0 + 2; t < r.a1 - 2; t += 2) {
        if (!simple(r, t, t + 1)) continue;
        const p = roadCell(r, t, 0);
        const near = Math.hypot(p.x - C0.x, p.y - C0.y) < 30;
        const pPark = r.kind === 'street' ? (near ? 0.14 : 0.07) : 0;
        for (const o of [-2, 2]) if (rng() < pPark) roadCar(r, t, o, false);
        const pAb = r.kind === 'street' ? 0.025 : 0.018;
        if (rng() < pAb) {
          const car = roadCar(r, t, rng.int(-2, 2), rng() < 0.35);
          if (car && rng() < 0.5) ctx.decals.push({ x: car.x + 1, y: car.y + 0.5, type: 'glass', size: 0.6, rot: rng() * 6.28, alpha: 0.8, t: 0 });
          if (car && rng() < 0.3) ctx.decals.push({ x: car.x + rng() * 2, y: car.y + rng() * 2, type: 'bloodpool', size: 0.8 + rng() * 0.6, rot: rng() * 6.28, alpha: 0.9, t: 0 });
        }
      }
    }
    // engavetamento/barreira na saída da cidade pela rodovia
    const rural = ctx.roads.filter((r) => r.kind === 'rural' && r.h === ctx.hwyTown.h && r.c === ctx.hwyTown.c);
    rural.sort((a, b) => (b.a1 - b.a0) - (a.a1 - a.a0));
    if (rural.length && rural[0].a1 - rural[0].a0 > 30) {
      const r = rural[0];
      const nearTown = r.a1 === ctx.hwyTown.a0 ? r.a1 - 4 : r.a0 + 4;
      const dir = r.a1 === ctx.hwyTown.a0 ? -1 : 1;
      let placed = 0;
      for (let k = 0; k < 40 && placed < 11; k++) {
        const t = nearTown + dir * rng.int(2, 24);
        const type = placed === 2 ? 'police_car' : placed === 5 ? 'ambulance' : 'car';
        if (roadCar(r, t, rng.int(-2, 2), rng() < 0.4, type)) placed++;
      }
      // barreira de barris
      const tb = nearTown + dir * 26;
      for (let o = -2; o <= 2; o++) if (o !== 0 && rng() < 0.8) {
        const p = roadCell(r, tb, o);
        V.w = 0; if (inb(p.x, p.y)) addObject(ctx, 'barrel', p.x, p.y, 1, 1, 0, { outdoor: true });
      }
      const pc = roadCell(r, nearTown + dir * 12, 0);
      ctx.jam = { x: pc.x + 0.5, y: pc.y + 0.5 };
      for (let i = 0; i < 6; i++) ctx.decals.push({ x: pc.x + (rng() - 0.5) * 10, y: pc.y + (rng() - 0.5) * 10, type: rng() < 0.6 ? 'blood' : 'bloodpool', size: 0.5 + rng(), rot: rng() * 6.28, alpha: 0.85, t: 0 });
    }
    // batida num cruzamento
    const cross = [];
    for (let i = 0; i < w * m.h; i++) if (cnt[i] >= 2 && m.floor[i] === F.ASPHALT && ctx.res[i] === 1) cross.push(i);
    for (let n = 0; n < 2 && cross.length; n++) {
      const i = cross[Math.floor(rng() * cross.length)], x = i % w, y = (i / w) | 0;
      const a = addObject(ctx, 'car', x, y, 2, 1, rng() < 0.5 ? 0 : 2, { outdoor: true });
      const b = addObject(ctx, 'car', x + 1, y + 1, 1, 2, rng() < 0.5 ? 1 : 3, { outdoor: true });
      if (a || b) {
        for (let k = 0; k < 3; k++) ctx.decals.push({ x: x + 1 + (rng() - 0.5) * 3, y: y + 1 + (rng() - 0.5) * 3, type: 'glass', size: 0.5 + rng() * 0.5, rot: rng() * 6.28, alpha: 0.9, t: 0 });
        ctx.decals.push({ x: x + 0.5, y: y + 1.5, type: 'bloodpool', size: 1.1, rot: rng() * 6.28, alpha: 0.9, t: 0 });
        addObject(ctx, 'tire', x - 1, y + 2, 1, 1, 0, { outdoor: true });
      }
    }
    // pneus e barris largados à beira das estradas rurais
    for (const r of ctx.roads) {
      if (r.kind === 'street') continue;
      for (let t = r.a0; t <= r.a1; t += 7) if (rng() < 0.12) {
        const o = rng() < 0.5 ? -4 : 4, p = roadCell(r, t, o);
        if (inb(p.x, p.y) && !ctx.res[p.y * w + p.x]) addObject(ctx, rng() < 0.5 ? 'tire' : 'barrel', p.x, p.y, 1, 1, 0, { outdoor: true });
      }
    }
  }

  // ---- Natureza: floresta densa nas bordas, clareiras, grama escura, pedras ----
  function nature(ctx) {
    const m = ctx.m, w = m.w, h = m.h, rng = ctx.rng, n = w * h;
    // distância (em tiles) até a área urbanizada (ruas/lotes/fazenda)
    const dist = new Uint8Array(n).fill(255);
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) { const r = ctx.res[i]; if (r === 1 || r === 2 || r === 5) { dist[i] = 0; q[qt++] = i; } }
    while (qh < qt) {
      const i = q[qh++], x = i % w, y = (i / w) | 0, d = dist[i] + 1;
      if (d > 60) continue;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] > d) { dist[j] = d; q[qt++] = j; }
      }
    }
    ctx.dist = dist;
    const s = ctx.seed;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const f = m.floor[i];
      if (m.wall[i] || m.objAt[i] >= 0) continue;
      if (f !== F.GRASS && f !== F.SAND && f !== F.DIRT) continue;
      const free = !ctx.res[i] || ctx.res[i] === 6 || ctx.res[i] === 4;
      if (!free) continue;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const n1 = U.noise2(x * 0.07, y * 0.07, s + 11), n2 = U.noise2(x * 0.22, y * 0.22, s + 23);
      let fr = U.clamp((dist[i] - 2) / 7, 0, 1) * (0.45 + 0.7 * n1);
      if (edge < 9) fr += (9 - edge) / 9 * 0.7;
      if (n1 < 0.28 && dist[i] > 9 && edge > 8) fr *= 0.25; // clareira
      fr = U.clamp(fr, 0, 1);
      if (f === F.GRASS && fr > 0.3 + (n2 - 0.5) * 0.3) m.floor[i] = F.DARK_GRASS;
      if (f === F.GRASS && fr > 0.55 && n2 > 0.83) m.floor[i] = F.DIRT;
      if (f === F.DIRT && ctx.res[i] === 4) continue; // trilha
      if (f === F.SAND && ctx.res[i] === 3) continue;
      const pine = U.noise2(x * 0.05 + 50, y * 0.05, s + 5) > 0.52;
      const r = rng();
      if (r < fr * 0.3) addObject(ctx, pine ? 'pine' : 'tree', x, y, 1, 1, 0);
      else if (r < fr * 0.3 + fr * 0.1 + (dist[i] >= 1 && dist[i] <= 3 ? 0.03 : 0)) addObject(ctx, 'bush', x, y, 1, 1, 0);
      else if (r < fr * 0.42 + 0.006 * fr) addObject(ctx, 'rock', x, y, 1, 1, 0);
      else if (dist[i] <= 3 && fr < 0.2 && r > 0.992) addObject(ctx, 'tree', x, y, 1, 1, 0);
    }
  }

  // Trilhas pela mata e um acampamento de caça numa clareira
  function forestTrails(ctx) {
    const m = ctx.m, rng = ctx.rng, w = m.w;
    const east = ctx.roads.filter((r) => r.kind === 'rural' && r.h !== ctx.hwyTown.h);
    const src = east.length ? rng.pick(east) : null;
    if (src) {
      let p = null, ex = 0, ey = 0;
      for (let tries = 0; tries < 30 && !p; tries++) { // clareira longe de lotes e ruas
        const t = rng.int(src.a0 + 3, src.a1 - 3), side = rng() < 0.5 ? -1 : 1, len = rng.int(12, 22);
        const e = roadCell(src, t + rng.int(-6, 6), side * (3 + len));
        const cx = U.clamp(e.x, 6, w - 7), cy = U.clamp(e.y, 6, m.h - 7);
        let ok = true;
        for (let y = cy - 4; y <= cy + 4 && ok; y++) for (let x = cx - 4; x <= cx + 4; x++) if (ctx.res[y * w + x] && ctx.res[y * w + x] !== 6) { ok = false; break; }
        if (ok) { p = roadCell(src, t, side * 3); ex = cx; ey = cy; }
      }
      if (!p) return;
      trail(ctx, p.x, p.y, ex, ey, 1);
      // clareira do acampamento
      for (let y = ey - 3; y <= ey + 3; y++) for (let x = ex - 3; x <= ex + 3; x++) {
        const i = y * w + x;
        if (Math.hypot(x - ex, y - ey) <= 3.2 && !ctx.res[i]) { ctx.res[i] = 4; m.floor[i] = (x + y) & 1 ? F.DIRT : F.GRASS; }
      }
      addObject(ctx, 'log_pile', ex - 2, ey - 2, 2, 1, 1, { outdoor: true });
      addObject(ctx, 'picnic_table', ex, ey + 1, 2, 1, 1, { outdoor: true });
      addObject(ctx, 'barrel', ex + 2, ey - 1, 1, 1, 0, { outdoor: true });
      addObject(ctx, 'crate', ex - 2, ey + 1, 1, 1, 0, { outdoor: true, roomType: 'outdoor', loot: 'camp' });
      ctx.camp = { x: ex + 0.5, y: ey + 0.5 };
    }
    // estrada de madeireiros termina numa trilha
    const dirt = ctx.roads.filter((r) => r.kind === 'dirt' && r !== ctx.farmRoad);
    for (const r of dirt) {
      const p = roadCell(r, r.a0 < 6 ? r.a0 + 2 : r.a1, 0);
      const q = { x: U.clamp(p.x + rng.int(-25, 25), 6, w - 7), y: U.clamp(p.y + rng.int(-10, 10), 6, m.h - 7) };
      trail(ctx, p.x, p.y, q.x, q.y, 1);
    }
  }

  // ---- Ponto inicial: casa tranquila na periferia do bairro ----
  function chooseSpawn(ctx) {
    const m = ctx.m, tc = ctx.townC, rng = ctx.rng;
    let houses = ctx.lots.filter((l) => l.kind === 'house');
    if (!houses.length) houses = ctx.lots.filter((l) => l.kind === 'farm');
    houses.sort((a, b) => Math.hypot(b.x + b.w / 2 - tc.x, b.y + b.h / 2 - tc.y) - Math.hypot(a.x + a.w / 2 - tc.x, a.y + a.h / 2 - tc.y));
    // entre as mais afastadas, a que tem menos vizinhos (mais sossegada)
    const cands = houses.slice(0, 6);
    const lot = cands.length ? cands[Math.floor(rng() * Math.min(3, cands.length))] : null;
    if (!lot) { m.spawnPoint = { x: tc.x + 0.5, y: tc.y + 0.5 }; return; }
    const bid = lot.bIds[0], B = m.buildings[bid - 1];
    B.start = true;
    const living = m.rooms.find((r) => r.building === bid && r.type === 'living') || m.rooms.find((r) => r.building === bid);
    let best = null, bd = 1e9;
    for (let y = living.y; y < living.y + living.h; y++) for (let x = living.x; x < living.x + living.w; x++) {
      const i = y * m.w + x;
      if (m.wall[i] || m.objAt[i] >= 0) continue;
      const d = Math.abs(x + 0.5 - (living.x + living.w / 2)) + Math.abs(y + 0.5 - (living.y + living.h / 2));
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) best = { x: living.x, y: living.y };
    m.spawnPoint = { x: best.x + 0.5, y: best.y + 0.5 };
    ctx.spawnB = bid;
    // casa segura: portas destrancadas e fechadas, janelas inteiras
    for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x; x < B.x + B.w; x++) {
      const i = y * m.w + x;
      if (m.building[i] !== bid) continue;
      if (isDoorW(m.wall[i])) m.wallState[i] &= ~(WS.LOCKED | (m.wall[i] === W.GARAGE_DOOR ? WS.OPEN : 0));
      if (isWinW(m.wall[i])) m.wallState[i] &= ~WS.BROKEN;
    }
    for (const d of B.doors) { const i = d.y * m.w + d.x; if (m.wall[i] === W.DOOR) m.wallState[i] &= ~WS.OPEN; }
  }

  // ---- Pontos de zumbis (pesos) ----
  function zombieSpawns(ctx) {
    const m = ctx.m, w = m.w, sp = m.spawnPoint, rng = ctx.rng, C0 = ctx.center, list = [];
    const blocked = (x, y) => {
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= w || ty >= m.h) return true;
      const i = ty * w + tx;
      return m.wall[i] || m.floor[i] === F.WATER || (m.objAt[i] >= 0 && m.objects[m.objAt[i]].blocksMove);
    };
    const push = (x, y, wt) => {
      if (Math.hypot(x - sp.x, y - sp.y) < 18) return;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (ctx.spawnB && m.building[ty * w + tx] === ctx.spawnB) return;
      if (blocked(x, y)) return;
      list.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, weight: Math.round(wt * 100) / 100 });
    };
    for (const r of ctx.roads) {
      for (let t = r.a0 + 2; t <= r.a1; t += 6) {
        const o = rng.int(-2, 2), p = roadCell(r, t, r.kind === 'dirt' ? 0 : o);
        const dc = Math.hypot(p.x - C0.x, p.y - C0.y);
        const wt = r.kind === 'street' ? (dc < 30 ? 2.2 : 1.1) : r.kind === 'rural' ? 0.45 : 0.25;
        push(p.x + 0.5, p.y + 0.5, wt);
      }
    }
    for (const z of ctx.zs) push(z.x, z.y, z.weight);
    for (const r of m.rooms) {
      if (r.building === ctx.spawnB) continue;
      if (r.type === 'living' && rng() < 0.75) push(r.x + r.w / 2, r.y + r.h / 2, 0.6);
      if (r.type === 'bedroom' && rng() < 0.2) push(r.x + r.w / 2, r.y + r.h / 2, 0.35);
    }
    if (ctx.jam) { // engavetamento: acha um tile livre perto do centro
      for (let r = 0, done = false; r < 5 && !done; r++) for (let dy = -r; dy <= r && !done; dy++) for (let dx = -r; dx <= r; dx++) {
        if (!blocked(ctx.jam.x + dx, ctx.jam.y + dy)) { push(ctx.jam.x + dx, ctx.jam.y + dy, 3); done = true; break; }
      }
    }
    if (ctx.camp) push(ctx.camp.x + 1, ctx.camp.y, 0.5);
    for (let k = 0; k < 70; k++) {
      const x = rng.int(3, w - 4), y = rng.int(3, m.h - 4), i = y * w + x;
      if (ctx.dist && ctx.dist[i] > 5 && (m.floor[i] === F.DARK_GRASS || m.floor[i] === F.GRASS)) push(x + 0.5, y + 0.5, 0.12);
    }
    m.zombieSpawns = list;
  }

  // ---- Plano geral (coordenadas canônicas, depois espelhado/transposto pela seed) ----
  function planLayout(ctx) {
    const rng = ctx.rng, w = ctx.m.w, h = ctx.m.h;
    const fx = rng() < 0.5, fy = rng() < 0.5, tr = rng() < 0.5;
    ctx.T = (x, y) => {
      let X = x, Y = y;
      if (tr) { const t = X; X = Y; Y = t; }
      if (fx) X = w - 1 - X; if (fy) Y = h - 1 - Y;
      return { x: X, y: Y };
    };
    ctx.orient = { fx, fy, tr };
    // rodovia a oeste da cidade; quarteirões compridos a leste (casas de frente p/ ruas horizontais)
    const HX = 30 + rng.int(-1, 2), MY = 51 + rng.int(-2, 2), SX = 41 + rng.int(0, 1), SY = 35;
    const X1 = HX + SX, X2 = HX + 2 * SX, YN = MY - SY, YS = MY + SY;
    ctx.bulbs = [];
    seg(ctx, HX, 0, HX, YN - 10, 'rural');
    ctx.hwyTown = seg(ctx, HX, YN - 10, HX, YS + 20, 'street');
    seg(ctx, HX, YS + 20, HX, h - 1, 'rural');
    seg(ctx, HX, MY, X2, MY, 'street');
    seg(ctx, X2, MY, w - 1, MY, 'rural');
    const dropNE = rng() < 0.3;
    seg(ctx, HX, YN, dropNE ? X1 : X2, YN, 'street');
    seg(ctx, HX, YS, X2, YS, 'street');
    seg(ctx, X1, YN, X1, YS, 'street');
    if (dropNE) { seg(ctx, X2, YN + 4, X2, YS, 'street').culdesac = true; ctx.bulbs.push(ctx.T(X2, YN + 4)); }
    else seg(ctx, X2, YN, X2, YS, 'street');
    // ruas sem saída ao sul (bairro novo)
    for (const [Xc, p] of [[X1, 0.85], [X2, 0.6]]) {
      if (rng() >= p) continue;
      const L = rng.int(24, 30);
      const cs = seg(ctx, Xc, YS, Xc, YS + L, 'street'); cs.culdesac = true; ctx.bulbs.push(ctx.T(Xc, YS + L));
    }
    if (rng() < 0.6) { // estrada de madeireiros para o norte
      const Xl = dropNE ? X1 : rng.pick([X1, X2]);
      seg(ctx, Xl, 2, Xl, YN - 4, 'dirt');
    }
    const FY = YS + 22 + rng.int(0, 8);
    ctx.farmRoad = seg(ctx, 4, FY, HX - 3, FY, 'dirt');
    ctx.farmC = ctx.T(12, FY);
    ctx.lakeC = ctx.T(Math.floor(HX / 2) - 1 + rng.int(-1, 1), YN + 9 + rng.int(-3, 3));
    ctx.center = ctx.T(HX + 8, MY);
    ctx.townC = ctx.T(HX + SX, MY);
    ctx.churchTarget = ctx.T(HX + 12, YS + 26);
  }

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let lastMap = null;

  WD.generate = function (seed) {
    const t0 = now();
    seed = (seed | 0) >>> 0;
    const m = allocMap(C.MAP_W, C.MAP_H), n = m.w * m.h;
    const rng = U.rng(seed ^ 0x51f15e);
    const ctx = {
      m, seed, rng, lootRng: U.rng(seed ^ 0x2c1b3c6d), res: new Uint8Array(n), keep: new Uint8Array(n),
      roads: [], lots: [], zs: [], decals: [], names: shuffle(SURNAMES.slice(), rng), nameI: 0,
    };
    planLayout(ctx);
    paintRoads(ctx);
    lake(ctx);
    farm(ctx);
    placeSpecials(ctx);
    placeHouses(ctx);
    cleanup(ctx);
    streetDetails(ctx);
    forestTrails(ctx);
    nature(ctx);
    fixPockets(ctx);
    chooseSpawn(ctx);
    zombieSpawns(ctx);
    m.seed = seed;
    m.roads = ctx.roads;
    m.lots = ctx.lots.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, face: l.face, kind: l.kind, name: l.name, buildings: l.bIds }));
    m.initialDecals = ctx.decals;
    m.lake = ctx.lakeInfo || null;
    m.genTime = now() - t0;
    const s = G.state;
    if (s && Array.isArray(s.decals) && !s.map) for (const d of ctx.decals) s.decals.push(Object.assign({}, d));
    lastMap = m;
    return m;
  };

  // ------------------------------------------------------------------
  // 5. API em tempo de jogo
  // ------------------------------------------------------------------
  function map() { const s = G.state; return (s && s.map) || lastMap; }
  WD.current = map;
  WD.setMap = function (m) { lastMap = m; };
  WD.idx = function (tx, ty) { return ty * map().w + tx; };
  WD.inBounds = function (tx, ty) { const m = map(); return tx >= 0 && ty >= 0 && tx < m.w && ty < m.h; };

  const BM = WS.BARRICADE_MASK, BS = WS.BARRICADE_SHIFT;
  const barLevel = (st) => (st & BM) >> BS;

  function wallBlocksMove(wv, st) {
    if (wv === W.DOOR || wv === W.GARAGE_DOOR) return (st & BM) !== 0 || !(st & (WS.OPEN | WS.BROKEN));
    if (wv === W.FENCE_WOOD || wv === W.FENCE_METAL || wv === W.HEDGE) return !(st & WS.BROKEN);
    return true; // paredes, janelas e vidraças (janela se atravessa pulando)
  }
  function wallBlocksSight(wv, st) {
    switch (wv) {
      case W.DOOR: case W.GARAGE_DOOR: return !(st & (WS.OPEN | WS.BROKEN)) || barLevel(st) >= 3;
      case W.WINDOW: case W.GLASS: return (st & WS.CURTAIN) !== 0 || barLevel(st) >= 3;
      case W.FENCE_WOOD: case W.FENCE_METAL: case W.HEDGE: return false; // sebe: parcial (ver lineOfSight)
      default: return true;
    }
  }
  WD.wallBlocksMove = wallBlocksMove;
  WD.wallBlocksSight = wallBlocksSight;

  // who: 'player' | 'zombie' — hoje as regras de colisão são iguais para ambos
  WD.isBlocked = function (tx, ty, who) {
    const m = map();
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
    const i = (ty | 0) * m.w + (tx | 0), wv = m.wall[i];
    if (wv && wallBlocksMove(wv, m.wallState[i])) return true;
    if (m.floor[i] === F.WATER) return true;
    const o = m.objAt[i];
    return o >= 0 && m.objects[o].blocksMove;
  };

  function opaque(m, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (wv && wallBlocksSight(wv, m.wallState[i])) return true;
    const o = m.objAt[i];
    return o >= 0 && m.objects[o].blocksSight;
  }
  WD.blocksSight = function (tx, ty) { return opaque(map(), Math.floor(tx), Math.floor(ty)); };
  // Custo de visão 0..1 (render pode usar para escurecer): sebe 0.5, cerca de madeira 0.15
  WD.sightCost = function (tx, ty) {
    const m = map();
    if (opaque(m, tx, ty)) return 1;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (wv === W.HEDGE && !(m.wallState[i] & WS.BROKEN)) return 0.5;
    if (wv === W.FENCE_WOOD) return 0.15;
    return 0;
  };

  // DDA (Amanatides–Woo). Ignora o tile de origem, considera o destino.
  // Quinas exatas: só bloqueia se os DOIS vizinhos bloqueiam. 2+ tiles de sebe bloqueiam.
  function dda(x0, y0, x1, y1, mode) {
    const m = map(), w = m.w;
    let tx = Math.floor(x0), ty = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1);
    if (tx === ex && ty === ey) return true;
    const dx = x1 - x0, dy = y1 - y0;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const idx = dx !== 0 ? Math.abs(1 / dx) : Infinity, idy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx !== 0 ? (sx > 0 ? tx + 1 - x0 : x0 - tx) * idx : Infinity;
    let tMaxY = dy !== 0 ? (sy > 0 ? ty + 1 - y0 : y0 - ty) * idy : Infinity;
    let hedges = 0, n = Math.abs(ex - tx) + Math.abs(ey - ty) + 2;
    while (n-- > 0) {
      const diff = tMaxX - tMaxY;
      if (diff > -1e-9 && diff < 1e-9) {
        const a = mode ? blockReach(m, tx + sx, ty) : opaque(m, tx + sx, ty);
        const b = mode ? blockReach(m, tx, ty + sy) : opaque(m, tx, ty + sy);
        if (a && b) return false;
        tx += sx; ty += sy; tMaxX += idx; tMaxY += idy; n--;
      } else if (diff < 0) { tx += sx; tMaxX += idx; } else { ty += sy; tMaxY += idy; }
      if (tx < 0 || ty < 0 || tx >= w || ty >= m.h) return false;
      const last = tx === ex && ty === ey;
      if (mode) { if (!(last && mode === 2) && blockReach(m, tx, ty)) return false; }
      else {
        if (opaque(m, tx, ty)) return false;
        const i = ty * w + tx;
        if (m.wall[i] === W.HEDGE && !(m.wallState[i] & WS.BROKEN) && ++hedges >= 2) return false;
      }
      if (last) return true;
    }
    return true;
  }
  // "alcance de mão": paredes, portas fechadas e janelas fechadas bloqueiam; móveis não
  function blockReach(m, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (!wv) return false;
    const st = m.wallState[i];
    if (isWinW(wv)) return !(st & (WS.OPEN | WS.BROKEN)) || barLevel(st) > 0;
    if (isFenceW(wv)) return false;
    return wallBlocksMove(wv, st);
  }
  WD.lineOfSight = function (x0, y0, x1, y1) { return dda(x0, y0, x1, y1, 0); };
  // Alcance físico (lootear/interagir): ignora móveis; o destino não conta
  WD.canReach = function (x0, y0, x1, y1) { return dda(x0, y0, x1, y1, 2); };

  // ---- Colisão círculo × tiles com deslizamento ----
  const _mv = { hitX: false, hitY: false, tx: -1, ty: -1 };
  function pushOut(e, r, who) {
    for (let it = 0; it < 4; it++) {
      let moved = false;
      const x0 = Math.floor(e.x - r), x1 = Math.floor(e.x + r), y0 = Math.floor(e.y - r), y1 = Math.floor(e.y + r);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (!WD.isBlocked(tx, ty, who)) continue;
        const cx = e.x < tx ? tx : e.x > tx + 1 ? tx + 1 : e.x;
        const cy = e.y < ty ? ty : e.y > ty + 1 ? ty + 1 : e.y;
        const ox = e.x - cx, oy = e.y - cy, d2 = ox * ox + oy * oy;
        if (d2 >= r * r - 1e-9) continue;
        let px = 0, py = 0;
        if (d2 > 1e-12) { const d = Math.sqrt(d2), k = (r - d) / d; px = ox * k; py = oy * k; }
        else { // centro dentro do tile: sai pelo lado mais próximo
          const l = e.x - tx, rr = tx + 1 - e.x, t = e.y - ty, b = ty + 1 - e.y, mn = Math.min(l, rr, t, b);
          if (mn === l) px = -(l + r); else if (mn === rr) px = rr + r; else if (mn === t) py = -(t + r); else py = b + r;
        }
        e.x += px; e.y += py; moved = true;
        if (px > 1e-7 || px < -1e-7) _mv.hitX = true;
        if (py > 1e-7 || py < -1e-7) _mv.hitY = true;
        _mv.tx = tx; _mv.ty = ty;
      }
      if (!moved) break;
    }
  }
  // Retorna objeto REUTILIZADO {hitX, hitY, tx, ty} (tx,ty = último tile que bloqueou, ou -1)
  WD.moveEntity = function (e, dx, dy, radius, who) {
    const r = radius || C.PLAYER_RADIUS;
    _mv.hitX = false; _mv.hitY = false; _mv.tx = -1; _mv.ty = -1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) { pushOut(e, r, who); return _mv; }
    const maxStep = Math.min(0.15, r * 0.5);
    const steps = Math.min(200, Math.ceil(len / maxStep));
    const sx = dx / steps, sy = dy / steps;
    for (let s = 0; s < steps; s++) { e.x += sx; e.y += sy; pushOut(e, r, who); }
    return _mv;
  };

  // ---- Consultas ----
  WD.isIndoors = function (x, y) {
    const m = map(), tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return 0;
    return m.building[ty * m.w + tx];
  };
  WD.roomAt = function (x, y) {
    const m = map(), tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return null;
    const id = m.room[ty * m.w + tx];
    return id ? m.rooms[id - 1] : null;
  };
  WD.buildingAt = function (x, y) { const id = WD.isIndoors(x, y); return id ? map().buildings[id - 1] : null; };
  WD.getObject = function (tx, ty) {
    const m = map();
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return null;
    const o = m.objAt[ty * m.w + tx];
    return o >= 0 ? m.objects[o] : null;
  };
  let stamps = new Uint32Array(1024), stampN = 0;
  function objDist(o, x, y) {
    const cx = x < o.x ? o.x : x > o.x + o.w ? o.x + o.w : x, cy = y < o.y ? o.y : y > o.y + o.h ? o.y + o.h : y;
    return Math.hypot(x - cx, y - cy);
  }
  // Objetos cuja pegada está a <= r de (x,y), do mais perto ao mais longe
  WD.objectsNear = function (x, y, r) {
    const m = map(), out = [];
    if (stamps.length < m.objects.length) stamps = new Uint32Array(m.objects.length * 2);
    if (++stampN > 4e9) { stampN = 1; stamps.fill(0); }
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(m.w - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(m.h - 1, Math.floor(y + r));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const oi = m.objAt[ty * m.w + tx];
      if (oi < 0 || stamps[oi] === stampN) continue;
      stamps[oi] = stampN;
      const o = m.objects[oi], d = objDist(o, x, y);
      if (d <= r) { o._d = d; out.push(o); }
    }
    out.sort((a, b) => a._d - b._d);
    return out;
  };
  // Ponto mais próximo da pegada (para testar alcance)
  function nearestCell(o, x, y) {
    return { x: Math.min(o.x + o.w - 1, Math.max(o.x, Math.floor(x))) + 0.5, y: Math.min(o.y + o.h - 1, Math.max(o.y, Math.floor(y))) + 0.5 };
  }
  // Contêineres ao alcance: objetos, cadáveres e itens no chão ("Chão")
  WD.containersNear = function (x, y, r) {
    const out = [], s = G.state;
    r = r || 1.5;
    for (const o of WD.objectsNear(x, y, r)) {
      if (!o.container) continue;
      const c = nearestCell(o, x, y);
      if (!WD.canReach(x, y, c.x, c.y)) continue;
      out.push({ source: 'object', obj: o, container: o.container, x: o.x + o.w / 2, y: o.y + o.h / 2 });
    }
    if (s) {
      const corpses = s.corpses || [];
      for (let i = 0; i < corpses.length; i++) {
        const c = corpses[i];
        if (!c.container || Math.hypot(c.x - x, c.y - y) > r || !WD.canReach(x, y, c.x, c.y)) continue;
        out.push({ source: 'corpse', obj: c, container: c.container, x: c.x, y: c.y });
      }
      const gi = s.groundItems || [], near = [];
      for (let i = 0; i < gi.length; i++) {
        const g = gi[i];
        if (Math.hypot(g.x - x, g.y - y) <= r && WD.canReach(x, y, g.x, g.y)) near.push(g);
      }
      if (near.length) {
        out.push({ source: 'ground', obj: null, x, y,
          container: { name: 'Chão', items: near.map((g) => g.item), capacity: Infinity, searched: true, lootKey: 'ground', ground: near } });
      }
    }
    return out;
  };
  // Itens no chão (auxiliares para player/ui)
  WD.dropItem = function (x, y, item) {
    const s = G.state; if (!s) return null;
    const g = { x: x + (U.rand() - 0.5) * 0.4, y: y + (U.rand() - 0.5) * 0.4, item };
    s.groundItems.push(g); return g;
  };
  WD.removeGroundItem = function (item) {
    const s = G.state; if (!s) return false;
    const i = s.groundItems.findIndex((g) => g.item === item || g === item);
    if (i < 0) return false;
    s.groundItems.splice(i, 1); return true;
  };

  // ---- Estruturas (portas, janelas, cercas, barricadas) ----
  function structType(wv) {
    switch (wv) {
      case W.DOOR: return 'door'; case W.GARAGE_DOOR: return 'garage_door';
      case W.WINDOW: return 'window'; case W.GLASS: return 'glass';
      case W.FENCE_WOOD: case W.FENCE_METAL: return 'fence'; case W.HEDGE: return 'hedge';
      default: return 'wall';
    }
  }
  WD.getStructure = function (tx, ty) {
    const m = map();
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return null;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (!wv) return null;
    const st = m.wallState[i];
    return { type: structType(wv), wall: wv, x: tx, y: ty, open: !!(st & WS.OPEN), broken: !!(st & WS.BROKEN),
      locked: !!(st & WS.LOCKED), barricade: barLevel(st), hp: m.wallHp[i], barricadeHp: m.barricadeHp[i],
      curtain: !!(st & WS.CURTAIN), building: m.building[i] };
  };
  WD.isDoor = function (tx, ty) { const m = map(); return WD.inBounds(tx, ty) && isDoorW(m.wall[ty * m.w + tx]); };
  WD.isWindow = function (tx, ty) { const m = map(); return WD.inBounds(tx, ty) && isWinW(m.wall[ty * m.w + tx]); };

  function occupied(tx, ty) {
    const s = G.state; if (!s) return false;
    const inT = (e, r) => e && e.x + r > tx && e.x - r < tx + 1 && e.y + r > ty && e.y - r < ty + 1;
    if (s.player && s.player.alive !== false && inT(s.player, C.PLAYER_RADIUS)) return true;
    const zs = s.zombies || [];
    for (let i = 0; i < zs.length; i++) if (zs[i].state !== 'dead' && inT(zs[i], C.ZOMBIE_RADIUS)) return true;
    return false;
  }
  function emit(name, x, y) { G.events.emit(name, { x, y }); }
  function noise(x, y, radius, kind) { if (G.noise && G.noise.emit) G.noise.emit(x + 0.5, y + 0.5, radius, kind); }
  function particles(x, y, type, n, color) {
    const s = G.state; if (!s || !s.particles || s.particles.length > 700) return;
    const r = U.rand;
    for (let k = 0; k < n; k++) {
      const life = 0.5 + r() * 0.8;
      s.particles.push({ x: x + 0.2 + r() * 0.6, y: y + 0.2 + r() * 0.6, z: 0.4 + r() * 0.8, vx: (r() - 0.5) * 3, vy: (r() - 0.5) * 3,
        vz: r() * 2, life, maxLife: life, type, color, size: type === 'glass' ? 1.5 + r() * 1.5 : 2 + r() * 2 });
    }
  }
  function glassDecals(m, tx, ty) {
    const s = G.state; if (!s || !s.decals) return;
    const r = U.rand;
    for (let d = 0; d < 4; d++) {
      const nx = tx + DX[d], ny = ty + DY[d];
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || m.wall[ny * m.w + nx]) continue;
      for (let k = 0; k < 2; k++) s.decals.push({ x: nx + 0.5 - DX[d] * 0.35 + (r() - 0.5) * 0.7, y: ny + 0.5 - DY[d] * 0.35 + (r() - 0.5) * 0.7,
        type: 'glass', size: 0.35 + r() * 0.4, rot: r() * 6.283, alpha: 0.9, t: s.time });
    }
  }

  WD.setOpen = function (tx, ty, open) {
    const m = map();
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return false;
    const i = ty * m.w + tx, wv = m.wall[i], st = m.wallState[i];
    const isD = isDoorW(wv), isWn = isWinW(wv);
    if (!isD && !isWn) return false;
    if (st & WS.BROKEN) return false;
    const cur = !!(st & WS.OPEN);
    if (open == null) open = !cur;
    open = !!open;
    if (cur === open) return true;
    if (barLevel(st) > 0) { G.say(isD ? 'A porta está barricada.' : 'A janela está barricada.', 'warning'); return false; }
    if (open && (st & WS.LOCKED)) {
      emit('door:locked', tx, ty);
      G.say(isD ? 'Está trancada.' : 'A janela está emperrada.', 'warning');
      return false;
    }
    if (!open && isD && occupied(tx, ty)) return false;
    m.wallState[i] = open ? st | WS.OPEN : st & ~WS.OPEN;
    if (isD) emit(open ? 'door:open' : 'door:close', tx, ty);
    else emit(open ? 'window:open' : 'window:close', tx, ty);
    return true;
  };
  WD.setLocked = function (tx, ty, locked) {
    const m = map(), i = ty * m.w + tx;
    if (!isDoorW(m.wall[i]) && !isWinW(m.wall[i])) return false;
    m.wallState[i] = locked ? m.wallState[i] | WS.LOCKED : m.wallState[i] & ~WS.LOCKED;
    return true;
  };
  function setBar(m, i, level) { m.wallState[i] = (m.wallState[i] & ~BM) | ((level << BS) & BM); }

  // Dano em estrutura: barricada absorve primeiro. Retorna 'none'|'damaged'|'broken'
  // ('broken' = a porta/janela/cerca em si quebrou; barricada destruída conta como 'damaged')
  WD.damageStructure = function (tx, ty, amount /* , who */) {
    const m = map();
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return 'none';
    const i = ty * m.w + tx, wv = m.wall[i], st = m.wallState[i];
    if (!wv) return 'none';
    const bl = barLevel(st);
    if (bl > 0) {
      m.barricadeHp[i] = Math.max(0, m.barricadeHp[i] - amount);
      particles(tx, ty, 'wood', 2, '#8a6a44');
      const nl = Math.ceil(m.barricadeHp[i] / PLANK_HP - 1e-6);
      if (nl < bl) {
        setBar(m, i, nl);
        emit('barricade:break', tx, ty);
        particles(tx, ty, 'wood', 8, '#8a6a44');
        noise(tx, ty, 10, 'barricade');
      }
      return 'damaged';
    }
    if (st & WS.BROKEN) return 'none';
    const isD = isDoorW(wv), isWn = isWinW(wv), isFe = isFenceW(wv) || wv === W.HEDGE;
    if (!isD && !isWn && !isFe) return 'none';        // paredes são indestrutíveis
    if (isD && (st & WS.OPEN)) return 'none';          // porta aberta: nada para bater
    if (!(m.wallHp[i] > 0)) m.wallHp[i] = baseHp(wv);
    m.wallHp[i] -= amount;
    if (m.wallHp[i] > 0) {
      particles(tx, ty, isWn ? 'glass' : wv === W.HEDGE ? 'dust' : 'wood', 1, isWn ? '#cfe6ee' : '#7a5a3a');
      return 'damaged';
    }
    m.wallHp[i] = 0;
    m.wallState[i] = (st | WS.BROKEN) & ~WS.OPEN;
    if (isD) {
      emit('door:break', tx, ty);
      particles(tx, ty, 'wood', 14, '#7a5a3a');
      noise(tx, ty, 16, 'thump');
    } else if (isWn) {
      emit('window:break', tx, ty);
      particles(tx, ty, 'glass', 16, '#cfe6ee');
      glassDecals(m, tx, ty);
      noise(tx, ty, 18, 'glass');
    } else {
      emit('fence:break', tx, ty);
      particles(tx, ty, wv === W.HEDGE ? 'dust' : 'wood', 10, wv === W.HEDGE ? '#3f5a2a' : '#7a5a3a');
      noise(tx, ty, 10, 'thump');
    }
    return 'broken';
  };
  WD.breakWindow = function (tx, ty) {
    const m = map();
    if (!WD.inBounds(tx, ty)) return false;
    const i = ty * m.w + tx;
    if (!isWinW(m.wall[i]) || (m.wallState[i] & WS.BROKEN)) return false;
    const bl = barLevel(m.wallState[i]);
    if (bl > 0) return false;
    m.wallHp[i] = 1e-3;
    return WD.damageStructure(tx, ty, 1, 'player') === 'broken';
  };
  WD.addBarricade = function (tx, ty) {
    const m = map();
    if (!WD.inBounds(tx, ty)) return false;
    const i = ty * m.w + tx, wv = m.wall[i], st = m.wallState[i];
    if (!isDoorW(wv) && !isWinW(wv)) return false;
    if (isDoorW(wv) && (st & WS.OPEN)) { G.say('Feche a porta primeiro.', 'warning'); return false; }
    if (isDoorW(wv) && occupied(tx, ty)) return false;
    const bl = barLevel(st);
    if (bl >= 4) { G.say('Não cabem mais tábuas.', 'info'); return false; }
    if (isWinW(wv)) m.wallState[i] &= ~WS.OPEN;
    m.barricadeHp[i] = (bl + 1) * PLANK_HP;
    setBar(m, i, bl + 1);
    emit('barricade:add', tx, ty);
    return true;
  };
  WD.removeBarricade = function (tx, ty) {
    const m = map();
    if (!WD.inBounds(tx, ty)) return false;
    const i = ty * m.w + tx, bl = barLevel(m.wallState[i]);
    if (bl <= 0) return false;
    m.barricadeHp[i] = (bl - 1) * PLANK_HP;
    setBar(m, i, bl - 1);
    emit('barricade:remove', tx, ty);
    return true;
  };
  WD.toggleCurtain = function (tx, ty) {
    const m = map();
    if (!WD.inBounds(tx, ty)) return null;
    const i = ty * m.w + tx;
    if (!isWinW(m.wall[i])) return null;
    m.wallState[i] ^= WS.CURTAIN;
    return !!(m.wallState[i] & WS.CURTAIN);
  };
  // Dá para pular por aqui? (janela aberta/quebrada sem barricada, cercas)
  WD.canClimb = function (tx, ty) {
    const m = map();
    if (!WD.inBounds(tx, ty)) return false;
    const i = ty * m.w + tx, wv = m.wall[i], st = m.wallState[i];
    if (isWinW(wv)) return !!(st & (WS.OPEN | WS.BROKEN)) && barLevel(st) === 0;
    return isFenceW(wv) && !(st & WS.BROKEN);
  };
  // Tile do outro lado de uma janela/cerca, vindo de (fx,fy). null se não houver.
  WD.climbTarget = function (tx, ty, fx, fy) {
    const dx = fx - (tx + 0.5), dy = fy - (ty + 0.5);
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const cands = horiz ? [[dx < 0 ? 1 : -1, 0], [0, dy < 0 ? 1 : -1]] : [[0, dy < 0 ? 1 : -1], [dx < 0 ? 1 : -1, 0]];
    for (const [cx, cy] of cands) {
      const nx = tx + cx, ny = ty + cy, bx = tx - cx, by = ty - cy;
      if (!WD.isBlocked(nx, ny, 'player') && !WD.isBlocked(bx, by, 'player')) return { x: nx + 0.5, y: ny + 0.5 };
    }
    return null;
  };

  // ---- A* 8 direções (heap binária, buffers reaproveitados) ----
  // who: 'player' — portas fechadas destrancadas custam +2 (ele abre); trancadas/barricadas/janelas bloqueiam.
  //      'zombie' — portas, janelas, cercas e barricadas são atravessáveis com custo alto
  //                 (o módulo de zumbis bate/quebra/pula ao chegar); paredes e objetos bloqueiam.
  //      'open'   — todas as portas contam como abertas (validação/depuração).
  //      outro    — só o que está passável agora (isBlocked).
  // Diagonais só entre tiles livres, sem cortar quinas e nunca entrando/saindo de porta/janela.
  let PF = null;
  function pfAlloc(n) {
    PF = { n, g: new Float32Array(n), came: new Int32Array(n), open: new Uint32Array(n), closed: new Uint32Array(n),
      hn: new Int32Array(n * 4), hf: new Float32Array(n * 4), gen: 0 };
  }
  // custo extra para entrar no tile (Infinity = intransponível)
  function enterCost(m, i, who) {
    if (m.floor[i] === F.WATER) return Infinity;
    const oi = m.objAt[i];
    if (oi >= 0 && m.objects[oi].blocksMove) return Infinity;
    const wv = m.wall[i];
    if (!wv) return 0;
    const st = m.wallState[i];
    if (!wallBlocksMove(wv, st)) return 0;
    const bl = barLevel(st);
    if (who === 'zombie') {
      if (isDoorW(wv)) return 6 + bl * 6;
      if (isWinW(wv)) return 10 + bl * 6;
      if (isFenceW(wv)) return 8;
      if (wv === W.HEDGE) return 30;
      return Infinity;
    }
    if (who === 'player') return isDoorW(wv) && !(st & WS.LOCKED) && !bl ? 2 : Infinity;
    if (who === 'open') return isDoorW(wv) ? 0.5 : Infinity;
    return Infinity;
  }
  function heapPush(node, f) {
    const hn = PF.hn, hf = PF.hf;
    let i = PF.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hn[i] = hn[p]; hf[i] = hf[p]; i = p;
    }
    hn[i] = node; hf[i] = f;
  }
  function heapPop() {
    const hn = PF.hn, hf = PF.hf, top = hn[0], n = --PF.size;
    if (n > 0) {
      const node = hn[n], f = hf[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        hn[i] = hn[c]; hf[i] = hf[c]; i = c;
      }
      hn[i] = node; hf[i] = f;
    }
    return top;
  }
  const SQ2 = Math.SQRT2;
  WD.findPath = function (x0, y0, x1, y1, who, maxNodes) {
    const m = map(), w = m.w, h = m.h, n = w * h;
    if (!PF || PF.n !== n) pfAlloc(n);
    const sx = Math.floor(x0), sy = Math.floor(y0), gx = Math.floor(x1), gy = Math.floor(y1);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h || gx < 0 || gy < 0 || gx >= w || gy >= h) return null;
    if (sx === gx && sy === gy) return [];
    const limit = maxNodes || 4000;
    const start = sy * w + sx, goal = gy * w + gx;
    const goalBlocked = enterCost(m, goal, who) === Infinity;
    if (++PF.gen > 4e9) { PF.gen = 1; PF.open.fill(0); PF.closed.fill(0); }
    const gen = PF.gen, g = PF.g, came = PF.came, op = PF.open, cl = PF.closed;
    PF.size = 0;
    g[start] = 0; came[start] = -1; op[start] = gen;
    const hfun = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return (dx + dy) + (SQ2 - 2) * Math.min(dx, dy); };
    heapPush(start, hfun(sx, sy));
    let expanded = 0, found = -1;
    const cap = PF.hn.length - 8;
    while (PF.size > 0) {
      const cur = heapPop();
      if (cl[cur] === gen) continue;
      cl[cur] = gen;
      const cx = cur % w, cy = (cur / w) | 0;
      if (cur === goal || (goalBlocked && Math.abs(cx - gx) <= 1 && Math.abs(cy - gy) <= 1 && (cx === gx || cy === gy))) { found = cur; break; }
      if (++expanded > limit) break;
      const curStruct = m.wall[cur] !== 0;
      for (let d = 0; d < 8; d++) {
        const ddx = d < 4 ? DX[d] : (d & 1 ? -1 : 1), ddy = d < 4 ? DY[d] : (d < 6 ? 1 : -1);
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (cl[ni] === gen) continue;
        let c = enterCost(m, ni, who);
        if (c === Infinity) continue;
        let step = 1;
        if (ddx && ddy) {
          if (curStruct || m.wall[ni]) continue;
          if (enterCost(m, cy * w + nx, who) !== 0 || m.wall[cy * w + nx]) continue;
          if (enterCost(m, ny * w + cx, who) !== 0 || m.wall[ny * w + cx]) continue;
          step = SQ2;
        }
        const ng = g[cur] + step + c;
        if (op[ni] === gen && ng >= g[ni]) continue;
        op[ni] = gen; g[ni] = ng; came[ni] = cur;
        if (PF.size < cap) heapPush(ni, ng + hfun(nx, ny) * 1.001);
      }
    }
    if (found < 0) return null;
    const path = [];
    for (let k = found; k !== start && k >= 0; k = came[k]) path.push({ x: (k % w) + 0.5, y: ((k / w) | 0) + 0.5 });
    path.reverse();
    return path;
  };

  // Sorteia um ponto de zumbi pelos pesos
  WD.pickZombieSpawn = function (rng) {
    const list = map().zombieSpawns;
    if (!list.length) return null;
    let tot = 0;
    for (let i = 0; i < list.length; i++) tot += list[i].weight;
    let r = (rng || U.rand)() * tot;
    for (let i = 0; i < list.length; i++) { r -= list[i].weight; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  };
  // Tile livre mais próximo (busca em anel)
  WD.nearestFree = function (x, y, maxR) {
    const tx = Math.floor(x), ty = Math.floor(y);
    for (let r = 0; r <= (maxR || 8); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (!WD.isBlocked(tx + dx, ty + dy)) return { x: tx + dx + 0.5, y: ty + dy + 0.5 };
    }
    return null;
  };

  // Nada pesado por frame: o mundo é estático fora das ações dos outros módulos.
  WD.update = function (/* dt, dtMin */) {};
})();
