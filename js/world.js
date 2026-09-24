/* =====================================================================
 * VALE QUIETO — world.js  (Etapa 1: Mundo)
 * Geração procedural determinística da cidadezinha "Vale Quieto" e
 * API de consulta/colisão/visão/caminho do mapa (G.world).
 *
 * Organização:
 *   1. Definições de objetos e utilidades
 *   2. "Plan": grade local de um lote (casa/loja + quintal) em orientação
 *      canônica (frente para +y), carimbada no mapa com rotação pelo lado da rua.
 *   3. Geradores de prédios (casas, comércio, serviços, periferia)
 *   4. Layout global (ruas, quarteirões, centro, lotes, periferia, mata)
 *   5. Dados para o render (roadMarks, wallMask, telhados)
 *   6. API em tempo de jogo (colisão, visão, estruturas, itens, A*)
 *
 * DETERMINISMO: nenhum comparador de sort consome rng nem tem efeito colateral;
 * nada de Math.random/sin/cos/pow/hypot na geração (só aritmética, sqrt e floor),
 * para que Node e navegadores produzam exatamente o mesmo mapa.
 *
 * Convenções (ver docs/ARCHITECTURE.md):
 *   rot de objeto = direção para onde a FRENTE aponta: 0:+x 1:+y 2:-x 3:-y.
 *   Carros: rot = sentido do capô; pegada comprimento×largura (carro 4×2,
 *   ambulância 5×2) ao longo do rot. height = altura visual relativa à parede.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, C = G.CONST, F = G.FLOOR, W = G.WALL, WS = G.WS, U = G.util;
  const WD = (G.world = {});

  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  // ------------------------------------------------------------------
  // 1. Definições de objetos
  // a = extensão ao longo da parede (largura), d = profundidade (na direção da frente)
  // cont = [nome do contêiner, capacidade kg]; light = luz emitida; tall = alto (não tapa janela)
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
    car:              { a: 2, d: 4, block: 1, ht: 0.6, cont: ['Porta-malas', 40] },
    pickup:           { a: 2, d: 4, block: 1, ht: 0.7, cont: ['Caçamba da picape', 60] },
    police_car:       { a: 2, d: 4, block: 1, ht: 0.65, cont: ['Porta-malas', 40] },
    ambulance:        { a: 2, d: 5, block: 1, ht: 0.8, cont: ['Ambulância', 50] },
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
    fence_gate:       { a: 1, d: 1, block: 0, ht: 0.5 }, // legado: portões agora são G.WALL.FENCE_GATE
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
    // novos (Etapa 1, revisão)
    grill:            { a: 1, d: 1, block: 1, ht: 0.55, cont: ['Churrasqueira', 3] },
    clothesline:      { a: 3, d: 1, block: 0, ht: 1.1 },
    watchtower:       { a: 2, d: 2, block: 1, ht: 3.4, cont: ['Torre de vigia', 10] },
    fountain:         { a: 2, d: 2, block: 1, ht: 0.6 },
  };
  WD.OBJECT_DEFS = ODEF;

  // Largura/altura da pegada no mundo dado a (largura), d (profundidade) e rot
  function footW(a, d, rot) { return rot & 1 ? a : d; }
  function footH(a, d, rot) { return rot & 1 ? d : a; }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  // Ordena por uma chave pré-calculada (estável e sem efeitos colaterais no comparador)
  function sortBy(arr, key) {
    for (let i = 0; i < arr.length; i++) arr[i]._k = key(arr[i], i);
    arr.sort((a, b) => a._k - b._k);
    return arr;
  }
  const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
  const isDoorW = (w) => w === W.DOOR || w === W.GARAGE_DOOR;
  const isGateW = (w) => w === W.FENCE_GATE;
  const isWinW = (w) => w === W.WINDOW || w === W.GLASS;
  const isFenceW = (w) => w === W.FENCE_WOOD || w === W.FENCE_METAL;
  const isFenceLike = (w) => w === W.FENCE_WOOD || w === W.FENCE_METAL || w === W.HEDGE || w === W.FENCE_GATE;
  const isOpenable = (w) => isDoorW(w) || isGateW(w) || isWinW(w);
  WD.isDoorType = isDoorW; WD.isWindowType = isWinW; WD.isGateType = isGateW;

  // Vida padrão de estruturas
  const HP = { door: 100, garage: 160, gate: 60, window: 12, glass: 18, fence_wood: 70, fence_metal: 140, hedge: 90 };
  const PLANK_HP = 30, MAX_PLANKS = 4; // barricada: 30 de vida por tábua, até 4
  function baseHp(w) {
    switch (w) {
      case W.DOOR: return HP.door; case W.GARAGE_DOOR: return HP.garage; case W.FENCE_GATE: return HP.gate;
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
    this.bld = new Uint8Array(n);            // 1..k = prédio local
    this.obj = new Int16Array(n).fill(-1);   // índice em objs
    this.resv = new Uint8Array(n);           // 1 = manter livre (frente de porta, caminho)
    this.objs = []; this.rooms = []; this.blds = [];
    this.zspawn = [];                        // hotspots locais de zumbi {x,y,weight,n}
    this.marks = [];                         // marcas de chão locais (vagas etc.)
    this.fence = null;                       // cerca de divisa pedida ao layout global
  }
  const PP = Plan.prototype;
  PP.ok = function (x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; };
  PP.fill = function (x, y, w, h, fl) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.ok(i, j)) this.floor[j * this.w + i] = fl;
  };
  // info: {type,name,wall,wallColor,roofColor,roofType}
  PP.addBuilding = function (info) { info.doors = []; info.parts = []; this.blds.push(info); return this.blds.length; };
  PP.foot = function (b, x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (this.ok(i, j)) this.bld[j * this.w + i] = b;
    this.blds[b - 1].parts.push({ x, y, w, h });
  };
  // Cômodo: retângulo INTERIOR (sem paredes)
  PP.addRoom = function (b, type, x, y, w, h, floor, loot) {
    const r = { i: this.rooms.length, b, type, x, y, w, h, floor, doors: [], loot: loot || null };
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
      const k = y * w + x, wv = this.wall[k];
      if (!wv || isDoorW(wv) || isWinW(wv) || isFenceLike(wv)) continue;
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
  // Estado inicial coerente: aberta e trancada são exclusivos
  function doorState(locked, open) { return locked ? WS.LOCKED : open ? WS.OPEN : 0; }
  // Porta entre cômodos. opts.score: menor = melhor (pré-calculado, determinístico)
  PP.door = function (ra, rb, opts) {
    opts = opts || {};
    const rng = this.rng;
    const cands = this.wallCells(ra, rb).filter((c) => !this.nearOpening(c.x, c.y) && !(opts.noFront && c.ny === -1));
    if (!cands.length) return null;
    const score = opts.score || (() => rng() * 2);
    sortBy(cands, score);
    const c = cands[0], k = c.y * this.w + c.x;
    this.wall[k] = W.DOOR;
    this.ws[k] = doorState(opts.locked, opts.open);
    this.floor[k] = ra.floor;
    this.reserveAround(c.x, c.y);
    const d = { x: c.x, y: c.y, nx: c.nx, ny: c.ny, ext: !rb, a: ra.i, b: rb ? rb.i : -1 };
    ra.doors.push(d); if (rb) rb.doors.push(d);
    if (!rb) this.blds[ra.b - 1].doors.push(d);
    return d;
  };
  // Abertura sem porta (vão) entre cômodos, largura n
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
  // n portas contíguas numa parede externa do cômodo (frente por padrão). garage => portão de garagem
  PP.extDoors = function (r, n, opts) {
    opts = opts || {};
    const side = opts.side != null ? opts.side : -1; // ny da normal: -1 = parede de baixo (frente)
    const cands = this.wallCells(r, null).filter((c) => (side === 'any' || c.ny === side || (side === 'side' && c.nx !== 0)));
    if (!cands.length) return null;
    const cx = opts.x != null ? opts.x : r.x + r.w / 2 - n / 2;
    sortBy(cands, (c) => Math.abs(c.x - cx) + Math.abs(c.y - (opts.y != null ? opts.y : c.y)) + c.y * 1e-4);
    let run = null;
    for (const c of cands) {
      const cells = [];
      for (let i = 0; i < n; i++) {
        const q = cands.find((d) => (c.nx === 0 ? d.x === c.x + i && d.y === c.y : d.y === c.y + i && d.x === c.x));
        if (!q) break;
        cells.push(q);
      }
      if (cells.length === n && !cells.some((q) => this.nearOpening(q.x, q.y) && !opts.allowNear)) { run = cells; break; }
    }
    if (!run) return null;
    for (const c of run) {
      const k = c.y * this.w + c.x;
      this.wall[k] = opts.garage ? W.GARAGE_DOOR : W.DOOR;
      this.ws[k] = doorState(opts.locked, opts.open);
      this.floor[k] = r.floor; this.reserveAround(c.x, c.y);
    }
    const c0 = run[0];
    const d = { x: c0.x, y: c0.y, nx: c0.nx, ny: c0.ny, ext: true, a: r.i, b: -1, garage: !!opts.garage, n };
    r.doors.push(d); this.blds[r.b - 1].doors.push(d);
    return run;
  };
  // Janelas nas paredes externas do cômodo
  PP.windows = function (r, opts) {
    opts = opts || {};
    const rng = this.rng, cands = this.wallCells(r, null);
    let placed = 0;
    shuffle(cands, rng);
    const kind = opts.glass ? W.GLASS : W.WINDOW;
    const maxN = opts.max != null ? opts.max : 99;
    for (const c of cands) {
      if (placed >= maxN) break;
      if (opts.side && !opts.side(c)) continue;
      if (!opts.glass && this.nearOpening(c.x, c.y)) continue;
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
  // Cada cômodo mantém uma janela com o lado de dentro livre (fuga/entrada)
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
  // Algum tile da pegada encosta (4-viz.) numa janela/vidraça?
  PP.touchesWindow = function (x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) for (let d = 0; d < 4; d++) {
      const nx = i + DX[d], ny = j + DY[d];
      if (this.ok(nx, ny) && isWinW(this.wall[ny * this.w + nx])) return true;
    }
    return false;
  };
  PP.put = function (type, x, y, w, h, rot, extra) {
    const o = { type, x, y, w, h, rot: rot | 0, variant: Math.floor(this.rng() * 8), extra: extra || null, room: -1 };
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
  // Circulação: células livres do cômodo conectadas e todo objeto bloqueante acessível por um lado
  const _q = new Int32Array(8192);
  PP.roomOk = function (r) {
    const w = this.w;
    let start = -1, total = 0;
    const seen = this._seen || (this._seen = new Uint8Array(this.w * this.h));
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (!this.ok(x, y)) continue;
      const k = y * w + x;
      seen[k] = 0;
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
    for (let oi = 0; oi < this.objs.length; oi++) {
      const o = this.objs[oi];
      if (o.room !== r.i || !ODEF[o.type].block) continue;
      let acc = false;
      for (let j = o.y - 1; j <= o.y + o.h && !acc; j++) for (let i = o.x - 1; i <= o.x + o.w; i++) {
        const inside = i >= o.x && i < o.x + o.w && j >= o.y && j < o.y + o.h;
        const corner = (i < o.x || i >= o.x + o.w) && (j < o.y || j >= o.y + o.h);
        if (inside || corner || !this.ok(i, j)) continue;
        if (this.room[j * w + i] === r.i && seen[j * w + i]) { acc = true; break; }
      }
      if (!acc) return false;
    }
    return true;
  };
  // Tenta colocar e valida; desfaz se quebrar a circulação. Móveis altos nunca encostam em janelas.
  PP.tryPut = function (r, type, x, y, w, h, rot, extra) {
    if (!this.fits(x, y, w, h, r)) return -1;
    if (ODEF[type].tall && this.touchesWindow(x, y, w, h)) return -1;
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
      const along = rot & 1 ? x - r.x : y - r.y, len = rot & 1 ? r.w : r.h;
      const corner = Math.min(along, len - (along + a));
      const center = Math.abs(along + a / 2 - len / 2);
      out.push({ x, y, w, h, rot, side, win, corner, center });
    };
    for (let x = r.x; x <= r.x + r.w - a; x++) { push(x, r.y, 1, 'top'); push(x, r.y + r.h - d, 3, 'bottom'); }
    for (let y = r.y; y <= r.y + r.h - a; y++) { push(r.x, y, 0, 'left'); push(r.x + r.w - d, y, 2, 'right'); }
    return out;
  };
  // Coloca objeto encostado na parede. opts: a, d, corner, center, side, notSide, near, far, winPref
  PP.placeWall = function (r, type, opts) {
    opts = opts || {};
    const def = ODEF[type], rng = this.rng;
    const a = opts.a || def.a, d = opts.d || def.d;
    const spots = this.wallSpots(r, a, d);
    for (const s of spots) {
      let sc = rng() * 1.5;
      if (opts.corner) sc += s.corner * 3;
      if (opts.center) sc += s.center * 2;
      if (opts.side && s.side !== opts.side) sc += 6;
      if (opts.notSide && s.side === opts.notSide) sc += 6;
      if (opts.near) sc += (Math.abs(s.x + s.w / 2 - opts.near.x) + Math.abs(s.y + s.h / 2 - opts.near.y)) * 2;
      if (opts.far) sc -= (Math.abs(s.x + s.w / 2 - opts.far.x) + Math.abs(s.y + s.h / 2 - opts.far.y)) * 1.5;
      if (opts.winPref && s.win) sc -= 3;
      s._k = sc;
    }
    spots.sort((p, q) => p._k - q._k);
    for (let i = 0; i < spots.length && i < 40; i++) {
      const s = spots[i];
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
      cands.push({ x, y, _k: Math.abs(cx) + Math.abs(cy) + this.rng() * (opts.jitter || 1.5) });
    }
    cands.sort((p, q) => p._k - q._k);
    for (let i = 0; i < cands.length && i < 30; i++) {
      const id = this.tryPut(r, type, cands[i].x, cands[i].y, w, h, rot, opts.extra);
      if (id >= 0) return id;
    }
    return -1;
  };
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
  PP.rug = function (r) {
    const w = Math.min(3, r.w - 2), h = Math.min(2, r.h - 2);
    if (w < 2 || h < 2) return -1;
    return this.placeFree(r, 'rug', w, h, 0, { margin: 1 });
  };
  // Área externa livre (sem prédio/parede/objeto/reserva)
  PP.freeOut = function (x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (!this.ok(i, j)) return false;
      const k = j * this.w + i;
      if (this.bld[k] || this.wall[k] || this.obj[k] >= 0 || this.resv[k] || this.floor[k] === F.POOL || this.floor[k] === F.WATER) return false;
    }
    return true;
  };
  PP.putOut = function (type, x, y, w, h, rot, extra) {
    if (!this.freeOut(x, y, w, h)) return -1;
    return this.put(type, x, y, w, h, rot, extra);
  };
  // Veículo pelo tipo e rot (pegada derivada)
  PP.putCar = function (type, x, y, rot, extra) {
    const d = ODEF[type];
    return this.putOut(type, x, y, footW(d.a, d.d, rot), footH(d.a, d.d, rot), rot, extra);
  };
  PP.line = function (x0, y0, x1, y1, fn) { // linha reta horizontal/vertical
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    for (;;) { fn(x, y); if (x === x1 && y === y1) break; x += dx; y += dy; }
  };
  PP.fenceLine = function (x0, y0, x1, y1, type) {
    this.line(x0, y0, x1, y1, (x, y) => {
      if (!this.ok(x, y)) return;
      const k = y * this.w + x;
      if (this.bld[k] || this.wall[k] || this.obj[k] >= 0 || this.resv[k]) return;
      this.wall[k] = type;
    });
  };
  PP.mark = function (x0, y0, x1, y1, type) { this.marks.push({ x0, y0, x1, y1, type }); };

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
  // Carro dentro da garagem, alinhado ao portão (frente = parede de baixo)
  function garageCar(P, r, type) {
    const d = ODEF[type];
    const gd = r.doors.find((q) => q.garage);
    const x0 = gd ? Math.min(Math.max(gd.x, r.x), r.x + r.w - d.a) : r.x + Math.floor((r.w - d.a) / 2);
    for (let y = r.y + r.h - 1 - d.d; y >= r.y; y--) if (P.tryPut(r, type, x0, y, d.a, d.d, 1) >= 0) return true;
    return false;
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
          if (area >= 24 && rng() < 0.5) P.placeWall(r, 'armchair', { near: centerOf(so) });
        }
        if (rng() < 0.7) P.placeWall(r, 'bookshelf', { corner: true });
        if (rng() < 0.6) P.placeWall(r, 'plant', { corner: true });
        if (rng() < 0.6) P.placeWall(r, 'lamp', { corner: true });
        if (area >= 20 && rng() < 0.6) P.rug(r);
        break;
      }
      case 'kitchen': {
        const fid = P.placeWall(r, 'fridge', { corner: true });
        let anchor = fid >= 0 ? centerOf(P.objs[fid]) : { x: r.x, y: r.y };
        const seq = ['kitchen_counter', 'stove', 'kitchen_counter', 'sink', 'kitchen_counter'];
        if (area >= 16) seq.push('kitchen_counter', 'kitchen_counter');
        if (area >= 24) seq.push('kitchen_counter');
        for (const t of seq) {
          const id = P.placeWall(r, t, { near: anchor });
          if (id >= 0) anchor = centerOf(P.objs[id]);
        }
        if (area >= 15) {
          const big = area >= 24 && rng() < 0.6;
          const tid = P.placeFree(r, 'table', 2, big ? 2 : 1, 0, { margin: 1 });
          if (tid >= 0) P.chairsAround(r, tid, big ? 4 : 2 + (rng() < 0.5 ? 1 : 0));
        }
        if (rng() < 0.8) P.placeWall(r, 'trash_can', { corner: true });
        break;
      }
      case 'bedroom': {
        const big = r.w >= 4 && r.h >= 4;
        const bt = r.extra === 'kids' ? 'bed' : big && rng() < 0.75 ? 'double_bed' : 'bed';
        const bid = P.placeWall(r, bt, { center: true });
        if (bid < 0 && bt === 'double_bed') P.placeWall(r, 'bed', { center: true });
        if (r.extra === 'kids' && r.w * r.h >= 12 && rng() < 0.6) P.placeWall(r, 'bed', { corner: true });
        P.placeWall(r, 'wardrobe', { corner: true });
        P.placeWall(r, 'dresser', { a: r.w >= 5 && rng() < 0.4 ? 2 : 1 });
        if (rng() < 0.5) P.placeWall(r, 'lamp', { corner: true });
        if (area >= 14 && rng() < 0.4) { const d = P.placeWall(r, 'desk', {}); if (d >= 0) chairFront(P, r, d); }
        if (area >= 16 && rng() < 0.4) P.rug(r);
        if (rng() < 0.3) P.placeWall(r, 'plant', { corner: true });
        break;
      }
      case 'bathroom': {
        P.placeWall(r, 'toilet', { corner: true });
        const sk = P.placeWall(r, 'sink', {});
        if (r.w >= 3 || r.h >= 3) { if (P.placeWall(r, 'bathtub', { corner: true }) < 0) P.placeWall(r, 'shower', { corner: true }); }
        else P.placeWall(r, 'shower', { corner: true });
        P.placeWall(r, 'medicine_cabinet', { near: sk >= 0 ? centerOf(P.objs[sk]) : null });
        break;
      }
      case 'garage': {
        if (rng() < 0.65) garageCar(P, r, rng() < 0.3 ? 'pickup' : 'car');
        P.placeWall(r, 'workbench', { side: 'top' });
        P.placeWall(r, 'shelf', { corner: true });
        if (rng() < 0.6) P.placeWall(r, 'tire', { corner: true });
        if (rng() < 0.5) P.placeWall(r, 'barrel', { corner: true });
        if (rng() < 0.35) P.placeWall(r, 'washing_machine', {});
        if (rng() < 0.5) P.placeWall(r, 'crate', { corner: true });
        break;
      }
      case 'office': {
        const d = P.placeWall(r, 'desk', { center: true });
        if (d >= 0) chairFront(P, r, d);
        P.placeWall(r, 'bookshelf', { corner: true });
        if (rng() < 0.6) P.placeWall(r, 'bookshelf', { corner: true });
        if (rng() < 0.5) P.placeWall(r, 'plant', { corner: true });
        if (rng() < 0.5) P.placeWall(r, 'lamp', { corner: true });
        break;
      }
      case 'storage': { // lavanderia/despensa
        P.placeWall(r, 'washing_machine', {});
        if (area >= 4) P.placeWall(r, 'shelf', { corner: true });
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
    'Chandler', 'Dawson', 'Ellis', 'Fowler', 'Graves', 'Hollis', 'Jenkins', 'Kemp', 'Lowell', 'Mercer', 'Norris',
    'Pruitt', 'Ramsey', 'Sutton', 'Thornton', 'Underwood', 'Vance', 'Whitaker', 'York', 'Ashford', 'Boone', 'Crane',
    'Doyle', 'Easton', 'Finch', 'Garrett', 'Hale', 'Irwin', 'Jacobs', 'Kirby', 'Lyle', 'Monroe', 'Nash', 'Oakley'];
  const HOUSE_WALLS = [
    { wall: W.WOOD, colors: ['#c9d3d6', '#e4dcc5', '#e9e6dc', '#d9cfa3', '#a9b79a', '#b7b3a8', '#c6b7a0', '#9fb3c2', '#d8c0a8', '#c4a99a'] },
    { wall: W.BRICK, colors: ['#9a5a45', '#8a5040', '#a86a50', '#7d4c3c'] },
    { wall: W.PLASTER, colors: ['#e6e0cf', '#d8d2c0', '#cfc6b0', '#e2d6bd'] },
  ];
  const ROOFS = ['#4a4a4f', '#5b4636', '#6b3a32', '#3f4a58', '#3e4f3e', '#57534e', '#704c3a', '#384048'];
  function pickHouseLook(rng) {
    const r = rng();
    const g = r < 0.62 ? HOUSE_WALLS[0] : r < 0.85 ? HOUSE_WALLS[1] : HOUSE_WALLS[2];
    return { wall: g.wall, wallColor: rng.pick(g.colors), roofColor: rng.pick(ROOFS), roofType: rng() < 0.62 ? 'gable' : 'hip' };
  }
  // Não encosta no prédio (anel de 1 tile livre ao redor)
  function nearBld(P, x, y, w, h) {
    for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) if (P.ok(i, j) && (P.bld[j * P.w + i] || isDoorW(P.wall[j * P.w + i]))) return true;
    return false;
  }
  function putYard(P, type, x, y, w, h, rot) {
    if (nearBld(P, x, y, w, h)) return -1;
    return P.putOut(type, x, y, w, h, rot);
  }

  // ------------------------------------------------------------------
  // 3c. Casa (lote inteiro: casa + quintal). Frente para +y.
  // o: { name, type, noGarage, size, unlocked }
  // ------------------------------------------------------------------
  function genHouse(P, rng, o) {
    const LW = P.w, LD = P.h;
    const sr = rng();
    let size = o.size || (LW >= 19 && sr < 0.3 ? 'large' : sr < 0.78 ? 'medium' : 'small');
    const front = rng.int(3, 4);
    let hw = size === 'large' ? rng.int(14, 16) : size === 'medium' ? rng.int(12, 14) : rng.int(10, 12);
    let hh = size === 'large' ? rng.int(11, 13) : size === 'medium' ? rng.int(10, 12) : rng.int(9, 10);
    hh = Math.min(hh, LD - front - 4); // quintal dos fundos >= 4
    if (hh < 9) return false;
    let garage = !o.noGarage && rng() < (size === 'small' ? 0.3 : 0.6);
    const gw = 6, gh = Math.min(8, hh); // interior 4×6
    let ww = rng() < (size === 'large' ? 0.7 : 0.45) ? rng.int(5, 6) : 0; // ala lateral (L)
    const need = () => hw + (garage ? gw - 1 : 0) + (ww ? ww - 1 : 0);
    while (need() > LW - 4) {
      if (ww) ww = 0; else if (hw > 10) hw--; else if (garage) garage = false; else return false;
    }
    if (hw <= 11 && size === 'large') size = 'medium';
    const gSide = rng() < 0.5 ? -1 : 1;
    const swSide = garage ? -gSide : (rng() < 0.5 ? -1 : 1);
    const totalW = need();
    const x0 = rng.int(2, Math.max(2, LW - 2 - totalW));
    const bx = x0 + (garage && gSide < 0 ? gw - 1 : 0) + (ww && swSide < 0 ? ww - 1 : 0);
    const by = LD - front - hh;
    const look = pickHouseLook(rng);
    const b = P.addBuilding({ type: o.type || 'house', name: o.name, wall: look.wall, wallColor: look.wallColor,
      roofColor: look.roofColor, roofType: look.roofType });
    P.foot(b, bx, by, hw, hh);
    let gx = 0, gy = 0;
    if (garage) { gx = gSide < 0 ? bx - gw + 1 : bx + hw - 1; gy = by + hh - gh; P.foot(b, gx, gy, gw, gh); }
    let side = null;
    if (ww) {
      const wh = rng.int(5, Math.min(7, hh - 2));
      side = { x: swSide < 0 ? bx - ww + 1 : bx + hw - 1, y: by, w: ww, h: wh };
      P.foot(b, side.x, side.y, side.w, side.h);
    }
    // ala nos fundos (L de verdade) se o quintal continuar com >= 4
    let wing = null;
    if (rng() < 0.4) {
      const wh = rng.int(4, 6), wwb = rng.int(5, Math.min(8, hw - 3));
      if (by - wh + 1 >= 5) {
        const wx = rng() < 0.5 ? bx : bx + hw - wwb;
        wing = { x: wx, y: by - wh + 1, w: wwb, h: wh };
        P.foot(b, wing.x, wing.y, wing.w, wing.h);
      }
    }
    const ix = bx + 1, iy = by + 1, iw = hw - 2, ih = hh - 2;
    const kitchenLeft = garage ? gSide < 0 : rng() < 0.5;
    const FL = { living: rng.pick([F.CARPET, F.WOOD, F.WOOD]), bed: rng.pick([F.CARPET, F.WOOD]), kit: rng.pick([F.LINOLEUM, F.TILE, F.LINOLEUM]) };
    const useHall = ih >= 9 && iw >= 9 && rng() < 0.85;
    let bd, fd, hallY = -1;
    if (useHall) { bd = ih >= 10 ? rng.int(3, 4) : 3; hallY = iy + bd + 1; fd = ih - bd - 3; }
    else { bd = ih >= 8 ? rng.int(3, 4) : 3; fd = ih - 1 - bd; }
    const fy = iy + ih - fd;
    // frente: sala + cozinha (+ escritório)
    const frontOffice = iw >= 12 && rng() < 0.35;
    const kw = U.clamp(rng.int(3, 5), 3, iw - 5 - (frontOffice ? 4 : 0));
    const ow = frontOffice ? 3 : 0;
    const lw = iw - 1 - kw - (frontOffice ? ow + 1 : 0);
    const kx = kitchenLeft ? ix : ix + iw - kw;
    const lx = kitchenLeft ? ix + kw + 1 : ix + (frontOffice ? ow + 1 : 0);
    const living = P.addRoom(b, 'living', lx, fy, lw, fd, FL.living);
    const kitchen = P.addRoom(b, 'kitchen', kx, fy, kw, fd, FL.kit);
    const office = frontOffice ? P.addRoom(b, 'office', kitchenLeft ? ix + iw - ow : ix, fy, ow, fd, F.CARPET) : null;
    const hall = useHall ? P.addRoom(b, 'hall', ix, hallY, iw, 1, F.WOOD) : null;
    // fundos: quartos, banheiro, lavanderia
    const want = size === 'large' ? 3 : size === 'medium' ? 2 : rng() < 0.3 ? 2 : 1;
    let bathW = rng.int(2, 3);
    let laundry = size !== 'small' && rng() < 0.55 ? 2 : 0;
    let k = want;
    const widthFor = (k2, l2) => k2 * 3 + (k2 - 1) + 1 + bathW + (l2 ? l2 + 1 : 0);
    while (k > 1 && widthFor(k, laundry) > iw) { if (bathW > 2) bathW = 2; else if (laundry) laundry = 0; else k--; }
    if (widthFor(k, laundry) > iw) laundry = 0;
    let laundryWanted = size !== 'small' && !laundry && rng() < 0.6;
    const rem = iw - bathW - 1 - (laundry ? laundry + 1 : 0) - (k - 1);
    const strips = [];
    for (let i = 0; i < k; i++) strips.push(['bedroom', Math.floor(rem / k) + (i < rem % k ? 1 : 0)]);
    const bathPos = rng.int(0, strips.length);
    strips.splice(bathPos, 0, ['bathroom', bathW]);
    if (laundry) strips.splice(bathPos + (rng() < 0.5 ? 0 : 1), 0, ['storage', laundry]);
    let cx = ix;
    const backRooms = [];
    let bedN = 0;
    for (const [t, w] of strips) {
      const r = P.addRoom(b, t, cx, iy, w, bd, t === 'bathroom' ? F.TILE : t === 'storage' ? F.LINOLEUM : FL.bed);
      if (t === 'bedroom' && bedN++ > 0 && rng() < 0.5) r.extra = 'kids';
      backRooms.push(r);
      cx += w + 1;
    }
    let garageRoom = null, wingRoom = null, sideRoom = null;
    const wingType = (big) => {
      if (bedN < want && big) return 'bedroom';
      if (laundryWanted) { laundryWanted = false; return 'storage'; }
      return rng.pick(big ? ['office', 'office', 'bedroom', 'storage'] : ['storage', 'office']);
    };
    if (garage) garageRoom = P.addRoom(b, 'garage', gx + 1, gy + 1, gw - 2, gh - 2, F.CONCRETE);
    if (side) {
      const st = wingType(side.w >= 5 && side.h >= 6);
      sideRoom = P.addRoom(b, st, side.x + 1, side.y + 1, side.w - 2, side.h - 2, st === 'storage' ? F.LINOLEUM : st === 'office' ? F.CARPET : FL.bed);
      if (st === 'bedroom') bedN++;
    }
    if (wing) {
      const wt = wingType(wing.w >= 5 && wing.h >= 5);
      wingRoom = P.addRoom(b, wt, wing.x + 1, wing.y + 1, wing.w - 2, wing.h - 2, wt === 'storage' ? F.LINOLEUM : wt === 'office' ? F.CARPET : FL.bed);
    }
    P.buildWalls(b, look.wall, W.PLASTER, F.WOOD);

    // portas internas
    const mid = (r) => (c) => Math.abs(c.x - (r.x + r.w / 2)) + Math.abs(c.y - (r.y + r.h / 2)) * 0.5 + rng();
    if (!(rng() < 0.55 && P.opening(living, kitchen, 2))) P.door(kitchen, living, { score: mid(kitchen), open: rng() < 0.6 });
    if (office) P.door(office, living, { score: mid(office), open: rng() < 0.5 }) || P.door(office, kitchen, {});
    const backTarget = (r) => {
      if (hall && P.door(r, hall, { score: mid(r), open: rng() < 0.6 })) return true;
      const pref = r.type === 'storage' ? [kitchen, living] : [living, kitchen];
      for (const t of pref) if (P.door(r, t, { score: mid(r), open: rng() < 0.6 })) return true;
      if (office && P.door(r, office, { score: mid(r) })) return true;
      return false;
    };
    if (hall) {
      if (!(rng() < 0.5 && P.opening(hall, living, 1))) P.door(hall, living, { score: mid(living), open: true });
      if (rng() < 0.45) P.door(hall, kitchen, { score: mid(kitchen), open: rng() < 0.5 });
    }
    const pending = [];
    for (const r of backRooms) if (!backTarget(r)) pending.push(r);
    for (const r of pending) { // sem acesso direto: liga a um vizinho dos fundos que tenha
      for (const q of backRooms) if (q !== r && q.doors.length && P.door(r, q, { score: mid(r) })) break;
    }
    const connectExtra = (r) => {
      if (!r) return;
      const pref = r.type === 'storage' ? [kitchen, hall, living].concat(backRooms) : backRooms.concat([hall, living, kitchen]);
      for (const t of pref) if (t && t.type !== 'bathroom' && P.door(r, t, { score: mid(r), open: rng() < 0.5 })) return;
      for (const t of backRooms) if (P.door(r, t, { score: mid(r) })) return;
    };
    connectExtra(sideRoom); connectExtra(wingRoom);
    if (garageRoom) {
      for (const t of [kitchen, hall, backRooms.find((q) => q.type === 'storage'), living].concat(backRooms)) if (t && P.door(garageRoom, t, { score: mid(garageRoom) })) break;
      const locked = !o.unlocked && rng() < 0.4;
      P.extDoors(garageRoom, 3, { garage: true, x: garageRoom.x + (rng() < 0.5 ? 0 : 1), locked, open: !locked && rng() < 0.2, allowNear: true });
    }
    // porta da frente (na parede de baixo da sala) e porta dos fundos/lateral
    const fdoor = P.door(living, null, {
      score: (c) => (c.ny === -1 ? 0 : 60) + Math.abs(c.x - (living.x + living.w / 2)) * 0.6 + rng(),
      locked: !o.unlocked && rng() < 0.25, open: !o.unlocked && rng() < 0.06,
    });
    if (rng() < 0.6) {
      for (const r of [kitchen, hall, backRooms.find((q) => q.type === 'storage'), wingRoom, sideRoom]) {
        if (!r || r.type === 'bathroom') continue;
        if (P.door(r, null, { score: (c) => (c.ny === 1 ? 0 : 5) + rng() * 3, locked: !o.unlocked && rng() < 0.25, noFront: true })) break;
      }
    }
    // janelas
    for (const r of P.rooms) {
      if (r.b !== b || r.type === 'hall') continue;
      const curtain = r.type === 'bedroom' ? 0.6 : r.type === 'bathroom' ? 0.8 : 0.25;
      const max = r.type === 'bathroom' || r.type === 'garage' || r.type === 'storage' ? 1 : 99;
      const p = r.type === 'garage' ? 0.3 : 0.5;
      const n = P.windows(r, { p, curtain, max, broken: o.unlocked ? 0 : 0.03, side: r.type === 'garage' ? (c) => c.ny !== -1 : null });
      if (!n && r.type !== 'garage') P.windows(r, { p: 1, curtain, max: 1 });
    }
    for (const r of P.rooms) if (r.b === b) P.keepWindowClear(r);
    for (const r of P.rooms) if (r.b === b) furnish(P, r);
    // entrada de carro da garagem
    if (garageRoom) {
      const gd = garageRoom.doors.find((q) => q.garage);
      if (gd) {
        const y0 = gy + gh;
        P.fill(gd.x, y0, 3, LD - y0, F.CONCRETE);
        if (front >= 4 && rng() < 0.3) P.putCar(rng() < 0.4 ? 'pickup' : 'car', gd.x + (rng() < 0.5 ? 0 : 1), y0, rng() < 0.7 ? 1 : 3);
        for (let y = y0; y < LD; y++) for (let x = gd.x; x < gd.x + 3; x++) P.resv[y * LW + x] = 1;
      }
    }
    // varanda + caminho até a calçada
    let porchX0 = 0, porchX1 = -1;
    if (fdoor) {
      const pd = Math.min(front - 1, rng.int(1, 2));
      const full = rng() < 0.3;
      const pw = full ? hw - 2 : rng.int(3, 5);
      porchX0 = full ? bx + 1 : fdoor.x - Math.floor(pw / 2); porchX1 = porchX0 + pw - 1;
      for (let y = by + hh; y < by + hh + pd; y++) for (let x = porchX0; x <= porchX1; x++) {
        const k = y * LW + x;
        if (!P.ok(x, y) || P.bld[k] || P.floor[k] === F.CONCRETE) continue;
        P.floor[k] = F.PORCH;
      }
      for (let y = by + hh; y < LD; y++) {
        const k = y * LW + fdoor.x;
        if (P.floor[k] !== F.PORCH) P.floor[k] = F.SIDEWALK;
        P.resv[k] = 1;
      }
      if (pd >= 1 && rng() < 0.65) { // cadeira/banco na varanda
        const sx = fdoor.x + (rng() < 0.5 ? -2 : 2);
        const t = rng() < 0.5 && P.floor[(by + hh) * LW + sx + 1] === F.PORCH ? 'bench' : 'armchair';
        if (P.floor[(by + hh) * LW + sx] === F.PORCH) P.putOut(t, sx, by + hh, t === 'bench' ? 2 : 1, 1, 1);
      }
      P.putOut('mailbox', fdoor.x + (rng() < 0.5 ? -1 : 1), LD - 1, 1, 1, 1);
    }
    // entrada de carro sem garagem (lateral, cascalho)
    if (!garage && rng() < 0.5) {
      const cands = [];
      if (bx - 4 >= 1) cands.push(bx - 4);
      if (LW - (bx + hw + (side && swSide > 0 ? ww - 1 : 0)) >= 5) cands.push(bx + hw + (side && swSide > 0 ? ww - 1 : 0) + 1);
      if (cands.length) {
        const dx = cands[Math.floor(rng() * cands.length)], y0 = Math.max(1, LD - 9);
        let clear = true;
        for (let y = y0; y < LD; y++) for (let x = dx; x < dx + 3; x++) if (!P.ok(x, y) || P.bld[y * LW + x] || (P.resv[y * LW + x] && P.floor[y * LW + x] !== F.SIDEWALK)) clear = false;
        if (clear) {
          P.fill(dx, y0, 3, LD - y0, F.GRAVEL);
          if (rng() < 0.7) P.putCar(rng() < 0.35 ? 'pickup' : 'car', dx + (rng() < 0.5 ? 0 : 1), y0 + rng.int(0, 2), rng() < 0.7 ? 1 : 3);
          for (let y = y0; y < LD; y++) for (let x = dx; x < dx + 3; x++) P.resv[y * LW + x] = 1;
        }
      }
    }
    yard(P, rng, { b, bx, by, hw, hh, LW, LD, porchX0, porchX1, name: o.name, garage: garageRoom });
    return true;
  }

  // Quintal: cerca de divisa (pedida ao layout), ligação com portão, galpão, piscina, varal, churrasqueira...
  function yard(P, rng, g) {
    const { bx, by, hw, hh, LW, LD } = g;
    const fenceRow = by + Math.floor(hh / 2);
    const roll = rng();
    const ftype = roll < 0.5 ? W.FENCE_WOOD : roll < 0.68 ? W.HEDGE : roll < 0.82 ? W.FENCE_METAL : 0;
    if (ftype) {
      P.fence = { type: ftype, row: fenceRow }; // bordas (fundos e laterais até fenceRow) no passe global
      // ligações casa -> divisa na altura fenceRow, com portão
      let x0 = 1, x1 = LW - 2, left = -1, right = -1;
      for (let x = 0; x < LW; x++) if (P.bld[fenceRow * LW + x]) { if (left < 0) left = x; right = x; }
      const segs = [];
      if (left > 1) segs.push([x0, left - 1]);
      if (right >= 0 && right < LW - 2) segs.push([right + 1, x1]);
      if (!segs.length) P.fence = null; // casa ocupa a largura toda: sem cerca de divisa (quintal só pela casa)
      const gateSeg = segs.length ? rng.int(0, segs.length - 1) : -1;
      const nearOpen = (x) => { // encostado numa porta/janela/parede da casa: deixa vão
        for (let d = 0; d < 4; d++) { const nx = x + DX[d], ny = fenceRow + DY[d]; if (P.ok(nx, ny) && (isOpenable(P.wall[ny * LW + nx]) || P.bld[ny * LW + nx])) return true; }
        return false;
      };
      segs.forEach((s, si) => {
        const opts = [];
        for (let x = s[0]; x <= s[1]; x++) if (!nearOpen(x)) opts.push(x);
        const gateX = si === gateSeg && opts.length ? opts[Math.floor(rng() * opts.length)] : -1;
        if (si === gateSeg && !opts.length) return; // sem lugar para portão: deixa o vão aberto
        for (let x = s[0]; x <= s[1]; x++) {
          const k = fenceRow * LW + x;
          if (P.bld[k] || P.wall[k] || P.obj[k] >= 0) continue;
          if (x !== gateX && nearOpen(x) && isOpenable(P.wall[k - 1] || 0) + isOpenable(P.wall[k + 1] || 0) + isOpenable(P.wall[k - LW] || 0) + isOpenable(P.wall[k + LW] || 0)) continue;
          if (x === gateX || P.resv[k]) {
            if (x === gateX || P.floor[k] === F.GRAVEL) { // portão (também atravessando a entrada de carro)
              P.wall[k] = W.FENCE_GATE; P.ws[k] = rng() < 0.3 ? WS.OPEN : 0;
              P.resv[k - LW] = 1; P.resv[k + LW] = 1;
            }
            continue;
          }
          P.wall[k] = ftype === W.HEDGE ? W.FENCE_WOOD : ftype;
        }
      });
    }
    // frente: arbustos sob as janelas, árvore
    for (let x = bx; x < bx + hw; x++) if ((x < g.porchX0 || x > g.porchX1) && rng() < 0.35) P.putOut('bush', x, by + hh, 1, 1, 0);
    if (rng() < 0.55) putYard(P, rng() < 0.85 ? 'tree' : 'pine', rng.int(1, LW - 2), rng.int(by + hh + 1, LD - 2), 1, 1, 0);
    // lixeiras ao lado da casa
    const tx = rng() < 0.5 ? bx - 2 : bx + hw + 1;
    P.putOut('trash_can', tx, by + hh - 1, 1, 1, 1);
    if (rng() < 0.3) P.putOut('trash_can', tx, by + hh - 2, 1, 1, 1);
    // fundos: área útil = linhas 1..by-2 (e laterais acima de fenceRow)
    const yardH = by - 1;
    // galpão num canto dos fundos
    if (yardH >= 6 && rng() < 0.38) {
      const sw = rng.int(4, 5), sh = 4, sx = rng() < 0.5 ? 1 : LW - 1 - sw;
      if (P.freeOut(sx, 1, sw, sh) && !nearBld(P, sx, 1, sw, sh)) genShed(P, rng, sx, 1, sw, sh, g.name);
    }
    // piscina (fundos ou lateral)
    if (rng() < 0.22) {
      const pw = rng() < 0.5 ? 5 : 3, ph = pw === 5 ? 3 : 4, ow = pw + 2, oh = ph + 2;
      for (let tries = 0; tries < 24; tries++) {
        const x = rng.int(1, Math.max(1, LW - 1 - ow)), y = rng.int(1, Math.max(1, fenceRow - 1 - oh));
        if (!P.freeOut(x, y, ow, oh) || nearBld(P, x, y, ow, oh)) continue;
        P.fill(x, y, ow, oh, F.CONCRETE); P.fill(x + 1, y + 1, pw, ph, F.POOL);
        for (let j = y; j < y + oh; j++) for (let i = x; i < x + ow; i++) P.resv[j * LW + i] = 1;
        if (P.freeOut(x + ow, y, 1, 2)) P.put('chair', x + ow, y, 1, 1, 2);
        break;
      }
    }
    const items = [];
    if (rng() < 0.42) items.push(['clothesline', 3, 1]);
    if (rng() < 0.38) items.push(['grill', 1, 1]);
    if (rng() < 0.35) items.push(['picnic_table', 2, 1]);
    if (rng() < 0.22) items.push(['swing', 2, 1]);
    if (rng() < 0.22) items.push(['log_pile', 2, 1]);
    if (rng() < 0.15) items.push(['barrel', 1, 1]);
    if (rng() < 0.1) items.push(['tire', 1, 1]);
    for (const [t, w, h] of items) {
      for (let tries = 0; tries < 16; tries++) {
        const x = rng.int(1, LW - 1 - w), y = rng.int(1, Math.max(1, fenceRow - 1 - h));
        if (y + h > by - 1 && (x + w > bx - 2 && x < bx + hw + 2)) continue;
        if (putYard(P, t, x, y, w, h, rng() < 0.5 ? 1 : 3) >= 0) break;
      }
    }
    // horta
    if (yardH >= 5 && rng() < 0.32) {
      const w = rng.int(3, 5), h = rng.int(2, 3);
      for (let tries = 0; tries < 8; tries++) {
        const x = rng.int(1, Math.max(1, LW - 1 - w)), y = rng.int(1, Math.max(1, by - 2 - h));
        if (!P.freeOut(x, y, w, h) || nearBld(P, x, y, w, h)) continue;
        P.fill(x, y, w, h, F.DIRT);
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if ((j - y) % 2 === 0 && rng() < 0.7) P.put('bush', i, j, 1, 1, 0);
        break;
      }
    }
    // árvores nos fundos
    const nT = rng.int(1, 3);
    for (let i = 0; i < nT; i++) {
      for (let tries = 0; tries < 6; tries++) {
        const x = rng.int(1, LW - 2), y = rng.int(1, Math.max(1, by - 3));
        if (putYard(P, rng() < 0.8 ? 'tree' : 'pine', x, y, 1, 1, 0) >= 0) break;
      }
    }
  }

  // Galpão de quintal: prediozinho com porta virada para a casa
  function genShed(P, rng, x, y, w, h, owner) {
    const b = P.addBuilding({ type: 'shed', name: 'Galpão' + (owner ? ' — ' + owner.replace('Casa dos ', '') : ''), wall: W.WOOD,
      wallColor: rng.pick(['#8e6a4a', '#9a8a6a', '#7a6a5a', '#b0a080']), roofColor: rng.pick(ROOFS), roofType: rng() < 0.6 ? 'gable' : 'flat' });
    P.foot(b, x, y, w, h);
    const r = P.addRoom(b, 'storage', x + 1, y + 1, w - 2, h - 2, F.WOOD, 'shed');
    P.buildWalls(b, W.WOOD, W.WOOD, F.WOOD);
    const win = rng() < 0.5 && P.windows(r, { p: 1, max: 1, side: (c) => c.ny !== -1 }) > 0;
    P.extDoors(r, 1, { side: -1, locked: win && rng() < 0.4, allowNear: true });
    P.keepWindowClear(r);
    P.placeWall(r, 'workbench', { side: 'top' }) >= 0 || P.placeWall(r, 'shelf', { corner: true });
    P.placeWall(r, rng() < 0.5 ? 'crate' : 'barrel', { corner: true });
    return b;
  }

  // Cabana de caça: um cômodo com cama, fogão a lenha, mesa, prateleira
  function genCabin(P, rng, o) {
    const LW = P.w, LD = P.h, bw = 8, bh = 7, bx = Math.floor((LW - bw) / 2), by = Math.floor((LD - bh) / 2) - 1;
    const b = P.addBuilding({ type: 'cabin', name: o.name, wall: W.WOOD, wallColor: '#6e5238', roofColor: '#3c3a36', roofType: 'gable' });
    P.foot(b, bx, by, bw, bh);
    const r = P.addRoom(b, 'living', bx + 1, by + 1, bw - 2, bh - 2, F.WOOD, 'hunting');
    P.buildWalls(b, W.WOOD, W.WOOD, F.WOOD);
    P.extDoors(r, 1, { side: -1, locked: rng() < 0.3 });
    if (!P.windows(r, { p: 0.6, max: 3, curtain: 0.3 })) P.windows(r, { p: 1, max: 1 });
    P.keepWindowClear(r);
    P.placeWall(r, 'bed', { corner: true });
    P.placeWall(r, 'stove', { corner: true });
    P.placeWall(r, 'shelf', { corner: true });
    P.placeWall(r, 'crate', { corner: true });
    const t = P.placeFree(r, 'table', 2, 1, 0, { margin: 1 }); if (t >= 0) P.chairsAround(r, t, 2);
    P.putOut('log_pile', bx - 1, by + bh + 1, 2, 1, 1);
    P.putOut('barrel', bx + bw, by + 1, 1, 1, 0);
    P.putOut('pickup', bx + bw + 1, by + 2, 2, 4, 1);
    P.zspawn.push({ x: bx + bw / 2, y: by + bh + 2, weight: 0.5, n: 1 });
    return true;
  }

  // Trailer (dentro do plano do parque): corredor nos fundos; quarto | banheiro | cozinha+sala; porta na frente
  function genTrailer(P, rng, x, y, name) {
    const bw = 14, bh = 7;
    const b = P.addBuilding({ type: 'trailer', name, wall: W.WOOD, wallColor: rng.pick(['#d8d4c4', '#c9d0c8', '#e0d2b0', '#b8c4cc', '#d6c2b4']),
      roofColor: rng.pick(['#9a9a96', '#8a8e90', '#a09888']), roofType: 'flat' });
    P.foot(b, x, y, bw, bh);
    const hall = P.addRoom(b, 'hall', x + 1, y + 1, 12, 1, F.LINOLEUM);
    const bed = P.addRoom(b, 'bedroom', x + 1, y + 3, 3, 3, F.CARPET);
    const bath = P.addRoom(b, 'bathroom', x + 5, y + 3, 2, 3, F.LINOLEUM);
    const kit = P.addRoom(b, 'kitchen', x + 8, y + 3, 2, 3, F.LINOLEUM);
    const liv = P.addRoom(b, 'living', x + 11, y + 3, 2, 3, F.CARPET);
    P.buildWalls(b, W.WOOD, W.PLASTER, F.LINOLEUM);
    P.opening(kit, liv, 2);
    for (const r of [bed, bath, kit]) P.door(r, hall, { open: rng() < 0.5 });
    P.extDoors(liv, 1, { side: -1, locked: rng() < 0.25 });
    for (const r of [bed, kit, liv]) P.windows(r, { p: 0.7, max: 2, curtain: 0.5, broken: 0.05, side: (c) => c.ny !== 1 });
    P.windows(bath, { p: 1, max: 1, curtain: 0.8, side: (c) => c.ny !== 1 });
    for (const r of [bed, bath, kit, liv]) { P.keepWindowClear(r); furnish(P, r); }
    return b;
  }

  // ------------------------------------------------------------------
  // 3d. Comércio e serviços (lote inteiro, frente para +y)
  // ------------------------------------------------------------------
  function pathTo(P, x, y0, y1, fl) { // corredor livre até a calçada
    for (let y = y0; y <= y1; y++) { const k = y * P.w + x; if (P.ok(x, y) && !P.bld[k] && !P.wall[k]) { if (fl) P.floor[k] = fl; P.resv[k] = 1; } }
  }
  function gondolas(P, r, x0, y0, x1, y1, step) {
    for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y++) P.tryPut(r, 'shelf', x, y, 1, 1, 1);
  }
  function checkout(P, r, x, y, rot) { // balcão + caixa registradora (vertical)
    if (P.tryPut(r, 'counter', x, y, 1, 1, rot) < 0) return false;
    if (P.tryPut(r, 'cash_register', x, y + 1, 1, 1, rot) < 0) { P.unputLast(); return false; }
    return true;
  }
  // Salão de loja: caixas junto à porta, prateleiras no fundo e numa lateral, freezers na outra, gôndolas no meio
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
  // Estacionamento com vagas (carros 2×4 de ré para a parede de cima) — marcas 'parking'
  function parkingStalls(P, rng, x0, x1, y0, pCar, types) {
    for (let x = x0; x + 2 <= x1 + 1; x += 3) {
      P.mark(x, y0, x, y0 + 4, 'parking');
      if (rng() < pCar) P.putCar(types ? rng.pick(types) : rng() < 0.25 ? 'pickup' : 'car', x + 1 - (rng() < 0.5 ? 1 : 0) + (x + 2 > x1 ? -1 : 0), y0, rng() < 0.5 ? 1 : 3);
    }
  }
  // Área dos fundos: estacionamento (se houver acesso por beco/corredor) ou pátio de serviço
  function backArea(P, rng, y1, access, o) {
    const LW = P.w;
    if (y1 < 1) return;
    if (access && y1 >= 7 && o.parking !== false) {
      P.fill(0, 0, LW, y1 + 1, F.ASPHALT);
      parkingStalls(P, rng, 1, LW - 2, 0, o.pCar != null ? o.pCar : 0.45, o.carTypes);
      P.putOut('dumpster', LW - 3, y1, 2, 1, 3) < 0 && P.putOut('dumpster', 1, y1, 2, 1, 3);
    } else {
      P.fill(0, Math.max(0, y1 - 1), LW, Math.min(2, y1 + 1), F.CONCRETE);
      P.putOut('dumpster', 1, y1, 2, 1, 3) < 0 && P.putOut('dumpster', LW - 3, y1, 2, 1, 3);
      for (let i = 0; i < 3; i++) P.putOut(rng.pick(['pallet', 'barrel', 'crate', 'tire']), rng.int(1, LW - 2), rng.int(0, Math.max(0, y1 - 2)), 1, 1, 1);
    }
  }
  // Casca de loja: prédio na frente (calçadão na última linha), salão + faixa de fundos, portas, vitrine,
  // porta dos fundos, corredor lateral opcional até o estacionamento dos fundos.
  function storeShell(P, rng, o) {
    const LW = P.w, LD = P.h;
    const drive = o.drive && LW - 6 >= (o.minBw || 10) ? 3 : 0;
    const dLeft = rng() < 0.5;
    const bw = LW - 2 - (drive ? drive + 1 : 0);
    const bh = Math.max(8, Math.min(o.bh || 12, LD - 2 - (o.minBack || 0)));
    const bx = drive && dLeft ? drive + 2 : 1;
    const by = LD - 1 - bh;
    const b = P.addBuilding({ type: o.btype, name: o.name, wall: o.wall || W.BRICK, wallColor: o.wallColor || '#9b7c62',
      roofColor: o.roofColor || '#555b60', roofType: o.roofType || 'flat' });
    P.foot(b, bx, by, bw, bh);
    const ix = bx + 1, iy = by + 1, iw = bw - 2, ih = bh - 2;
    const backD = o.backD != null ? o.backD : 3;
    const main = P.addRoom(b, o.mainType, ix, iy + (backD ? backD + 1 : 0), iw, ih - (backD ? backD + 1 : 0), o.floor || F.LINOLEUM, o.loot);
    const spec = backD ? (o.back || [{ type: 'storage' }, { type: 'bathroom', w: 2 }]) : [];
    const fixed = spec.reduce((a, s) => a + (s.w || 0), 0) + Math.max(0, spec.length - 1);
    const restN = spec.filter((s) => !s.w).length || 1;
    const rest = iw - fixed;
    const backs = [];
    // larguras: fixas + resto dividido; o que não couber é somado ao cômodo anterior (sem paredes duplas)
    const widths = [];
    let used = 0, ri = 0;
    for (const s of spec) {
      let w = s.w || Math.floor(rest / restN) + (ri++ < rest % restN ? 1 : 0);
      const room = iw - used - (widths.length ? 1 : 0);
      if (w > room) w = room;
      if (w < 2) { if (widths.length) widths[widths.length - 1][1] += Math.max(0, room) + (room >= 0 ? 1 : 0); break; }
      widths.push([s, w]);
      used += w + (widths.length > 1 ? 1 : 0);
    }
    if (widths.length) { // último cômodo encosta na parede lateral
      const total = widths.reduce((a, q) => a + q[1], 0) + widths.length - 1;
      widths[widths.length - 1][1] += iw - total;
    }
    let cx = ix;
    for (const [s, w] of widths) {
      const fl = s.floor || (s.type === 'bathroom' ? F.TILE : s.type === 'office' ? F.CARPET : s.type === 'kitchen' ? F.TILE : F.CONCRETE);
      const r = P.addRoom(b, s.type, cx, iy, w, backD, fl, s.loot);
      r.spec = s; backs.push(r);
      cx += w + 1;
    }
    P.buildWalls(b, o.wall || W.BRICK, W.PLASTER, F.CONCRETE);
    backs.forEach((r, i) => {
      if (!P.door(r, main, { locked: !!r.spec.locked, open: !r.spec.locked && rng() < 0.4, score: (c) => Math.abs(c.x - (r.x + 1)) + rng() }) && i > 0) P.door(r, backs[i - 1], {});
      if (r.spec.bars) for (let x = r.x; x < r.x + r.w; x++) { const k = (r.y + r.h) * P.w + x; if (!isDoorW(P.wall[k])) P.wall[k] = W.FENCE_METAL; }
    });
    const nd = o.doors || 1;
    const run = P.extDoors(main, nd, { x: o.doorX != null ? ix + o.doorX : main.x + Math.floor((main.w - nd) / 2) + (nd === 1 ? rng.int(-1, 1) : 0),
      locked: rng() < (o.pLocked != null ? o.pLocked : 0.2) });
    const dx = run ? run[0].x : main.x + 1;
    if (o.glass !== false) P.windows(main, { glass: true, side: (c) => c.ny === -1, broken: o.broken != null ? o.broken : 0.06 });
    else P.windows(main, { p: 0.6, side: (c) => c.ny === -1 });
    if (o.sideWin) P.windows(main, { p: 0.5, side: (c) => c.nx !== 0, max: o.sideWin });
    let bdoor = null;
    for (const r of backs.concat([main])) {
      if (r.type === 'bathroom' || r.spec && r.spec.locked) continue;
      bdoor = P.door(r, null, { score: (c) => (c.ny === 1 ? 0 : 50) + rng(), locked: rng() < 0.5, noFront: true });
      if (bdoor) break;
    }
    P.fill(0, LD - 1, LW, 1, F.SIDEWALK);
    for (let i = 0; i < nd; i++) pathTo(P, dx + i, by + bh, LD - 1, F.SIDEWALK);
    let driveX = -1;
    if (drive) {
      driveX = dLeft ? 1 : LW - 1 - drive;
      P.fill(driveX, 0, drive, LD, F.ASPHALT);
      for (let y = 0; y < LD; y++) for (let x = driveX; x < driveX + drive; x++) P.resv[y * LW + x] = 1;
    }
    backArea(P, rng, by - 1, o.alley || drive, o);
    return { b, main, backs, dx, bx, by, bw, bh, ix, iy, iw, ih, drive, driveX, bdoor };
  }
  function zs(P, x, y, weight, n) { P.zspawn.push({ x, y, weight, n: n || 1 }); }

  function genMarket(P, rng, o) {
    const S = storeShell(P, rng, Object.assign({ btype: 'store', mainType: 'store', loot: 'grocery', bh: Math.min(15, P.h - 5), doors: 2, drive: !o.alley,
      back: [{ type: 'storage', loot: 'grocery_storage' }, { type: 'office', w: 3, loot: 'grocery_office' }, { type: 'bathroom', w: 2 }],
      wallColor: '#9b7c62', roofColor: '#555b60' }, o));
    shopFloor(P, S.main, S.dx, { checkouts: 3, freezers: true });
    for (const r of S.backs) {
      if (r.type === 'storage') { for (let x = r.x; x < r.x + r.w; x++) if (rng() < 0.7) P.tryPut(r, rng() < 0.6 ? 'crate' : 'pallet', x, r.y, 1, 1, 1); P.placeWall(r, 'shelf', { side: 'bottom' }); }
      else furnish(P, r);
    }
    P.putOut('trash_can', S.dx - 1, P.h - 1, 1, 1, 1);
    zs(P, S.main.x + S.main.w / 2, S.main.y + S.main.h / 2, 3, 4);
  }
  // Loja pequena genérica: farmácia, ferragens, roupas, conveniência, correios, biblioteca...
  function genShop(P, rng, o) {
    const S = storeShell(P, rng, Object.assign({ bh: Math.min(12, P.h - 4), drive: false }, o));
    if (o.style === 'office') {
      shopFloor(P, S.main, S.dx, { backObj: 'bookshelf', sideObj: o.sideObj || 'shelf', noGondola: true });
      const d = P.placeFree(S.main, 'desk', 2, 1, 3, { margin: 1 }); if (d >= 0) chairFront(P, S.main, d);
      P.placeWall(S.main, 'bench', { a: 2 }); P.placeWall(S.main, 'plant', { corner: true });
    } else if (o.style === 'library') {
      for (let x = S.main.x; x < S.main.x + S.main.w; x++) P.tryPut(S.main, 'bookshelf', x, S.main.y, 1, 1, 1);
      for (let x = S.main.x + 2; x < S.main.x + S.main.w - 2; x += 3) for (let y = S.main.y + 2; y < S.main.y + S.main.h - 3; y++) P.tryPut(S.main, 'bookshelf', x, y, 1, 1, 1);
      checkout(P, S.main, S.dx > S.main.x + S.main.w / 2 ? S.main.x + 1 : S.main.x + S.main.w - 2, S.main.y + S.main.h - 3, 0);
      const t = P.placeFree(S.main, 'table', 2, 1, 0, { margin: 1 }); if (t >= 0) P.chairsAround(S.main, t, 4);
    } else shopFloor(P, S.main, S.dx, { checkouts: 1, freezers: !!o.freezers });
    for (const r of S.backs) {
      if (r.type === 'bathroom' || r.type === 'office') { furnish(P, r); continue; }
      for (let x = r.x; x < r.x + r.w; x++) if (rng() < 0.65) P.tryPut(r, o.backObj || 'shelf', x, r.y, 1, 1, 1);
      if (o.backExtra) for (const t of o.backExtra) P.placeWall(r, t, { corner: true });
      if (rng() < 0.6) P.placeWall(r, 'crate', { corner: true });
    }
    if (rng() < 0.5) P.putOut('bench', S.dx + 2, P.h - 1, 2, 1, 1);
    P.putOut('trash_can', S.dx - 2, P.h - 1, 1, 1, 1);
    zs(P, S.main.x + S.main.w / 2, S.main.y + S.main.h / 2, o.zw || 2, 2);
  }
  // Lanchonete / bar: balcão com banquetas, mesas na vitrine, cozinha ou depósito
  function genDiner(P, rng, o) {
    const bar = o.style === 'bar';
    const S = storeShell(P, rng, Object.assign({ btype: 'diner', mainType: 'diner', bh: Math.min(12, P.h - 4), floor: bar ? F.WOOD : F.TILE,
      back: bar ? [{ type: 'storage', loot: 'bar_storage' }, { type: 'bathroom', w: 2 }] : [{ type: 'kitchen', loot: 'diner_kitchen' }, { type: 'bathroom', w: 2 }],
      wall: bar ? W.WOOD : W.PLASTER, wallColor: bar ? '#5e4634' : '#d9c9a0', roofColor: bar ? '#2f2a26' : '#3f6f70', glass: !bar }, o));
    const m = S.main;
    for (let x = m.x + 2; x < m.x + m.w - 1; x++) if (P.tryPut(m, 'counter', x, m.y, 1, 1, 1) >= 0 && x % 2 === 0) P.tryPut(m, 'chair', x, m.y + 1, 1, 1, 3);
    P.tryPut(m, 'cash_register', m.x + m.w - 1, m.y, 1, 1, 2) >= 0 || P.tryPut(m, 'cash_register', m.x, m.y, 1, 1, 0);
    for (let x = m.x; x < m.x + m.w - 3; x += 3) {
      const t = P.tryPut(m, 'table', x + 1, m.y + m.h - 2, 1, 1, 1);
      if (t >= 0) { P.tryPut(m, 'chair', x, m.y + m.h - 2, 1, 1, 0); P.tryPut(m, 'chair', x + 2, m.y + m.h - 2, 1, 1, 2); }
    }
    if (m.h >= 6) { const t = P.placeFree(m, 'table', 2, 1, 0, { margin: 2 }); if (t >= 0) P.chairsAround(m, t, 4); }
    P.placeWall(m, bar ? 'tv' : 'plant', { corner: true });
    for (const r of S.backs) {
      if (r.type === 'kitchen') {
        let anchor = { x: r.x, y: r.y };
        for (const t of ['stove', 'stove', 'kitchen_counter', 'sink', 'kitchen_counter', 'fridge', 'freezer']) {
          const id = P.placeWall(r, t, { near: anchor }); if (id >= 0) anchor = centerOf(P.objs[id]);
        }
      } else if (r.type === 'storage') { for (let x = r.x; x < r.x + r.w; x++) if (rng() < 0.7) P.tryPut(r, rng() < 0.5 ? 'crate' : 'barrel', x, r.y, 1, 1, 1); P.placeWall(r, 'fridge', {}); }
      else furnish(P, r);
    }
    zs(P, m.x + m.w / 2, m.y + m.h / 2, bar ? 3 : 2.5, 3);
  }
  // Delegacia: recepção, cela com grades, arsenal trancado, vestiário, escritório; viaturas nos fundos
  function genPolice(P, rng, o) {
    const S = storeShell(P, rng, Object.assign({ btype: 'police', mainType: 'police', loot: 'police_lobby', bh: Math.min(13, P.h - 5), drive: true,
      back: [{ type: 'police', w: 3, loot: 'police_cell', bars: true, locked: true }, { type: 'police', w: 2, loot: 'police_armory', locked: true },
        { type: 'police', w: 3, loot: 'police_lockers' }, { type: 'office', loot: 'police_office' }],
      wall: W.BRICK, wallColor: '#7f6a5c', roofColor: '#34404d', glass: false, carTypes: ['police_car', 'police_car', 'car'], pCar: 0.6, pLocked: 0.1 }, o));
    const [cell, arm, lock, off] = S.backs;
    if (cell) { P.tryPut(cell, 'bed', cell.x, cell.y, 1, 2, 0); P.tryPut(cell, 'toilet', cell.x + cell.w - 1, cell.y, 1, 1, 1); }
    if (arm) { for (let x = arm.x; x < arm.x + arm.w; x++) P.tryPut(arm, 'gun_locker', x, arm.y, 1, 1, 1); P.placeWall(arm, 'crate', { corner: true }); }
    if (lock) { for (let x = lock.x; x < lock.x + lock.w; x++) P.tryPut(lock, 'locker', x, lock.y, 1, 1, 1); P.placeWall(lock, 'bench', { a: 2, side: 'bottom' }); }
    if (off) { furnish(P, off); P.placeWall(off, 'locker', {}); }
    const m = S.main;
    for (let i = 0; i < 3; i++) { const d = P.placeWall(m, 'desk', { far: { x: S.dx, y: m.y + m.h } }); if (d >= 0) chairFront(P, m, d); }
    P.placeWall(m, 'bench', { a: 2, near: { x: S.dx, y: m.y + m.h } });
    P.placeWall(m, 'plant', { corner: true }); P.placeWall(m, 'bookshelf', { corner: true }); P.placeWall(m, 'bookshelf', { corner: true });
    zs(P, m.x + m.w / 2, m.y + 1, 2.5, 3);
  }
  // Clínica: recepção, consultórios, farmácia trancada, banheiro
  function genClinic(P, rng, o) {
    const S = storeShell(P, rng, Object.assign({ btype: 'clinic', mainType: 'office', loot: 'clinic', bh: Math.min(13, P.h - 4), backD: 4,
      back: [{ type: 'office', w: 4, loot: 'clinic_exam' }, { type: 'office', w: 4, loot: 'clinic_exam' }, { type: 'pharmacy', loot: 'clinic_pharmacy', locked: true }, { type: 'bathroom', w: 2 }],
      wall: W.PLASTER, wallColor: '#e8ecea', roofColor: '#4d6a78', drive: true, pCar: 0.3, carTypes: ['car', 'ambulance'] }, o));
    const m = S.main;
    for (let y = m.y; y < m.y + m.h - 2; y++) P.tryPut(m, 'chair', m.x, y, 1, 1, 0);
    for (let y = m.y; y < m.y + m.h - 2; y++) P.tryPut(m, 'chair', m.x + m.w - 1, y, 1, 1, 2);
    checkout(P, m, m.x + Math.floor(m.w / 2), m.y + 1, 1);
    P.placeWall(m, 'plant', { corner: true });
    for (const r of S.backs) {
      if (r.type === 'office') { P.placeWall(r, 'bed', { corner: true }); P.placeWall(r, 'medicine_cabinet', {}); P.placeWall(r, 'desk', {}); P.placeWall(r, 'sink', {}); }
      else if (r.type === 'pharmacy') { for (let x = r.x; x < r.x + r.w; x++) P.tryPut(r, 'shelf', x, r.y, 1, 1, 1); P.placeWall(r, 'medicine_cabinet', {}); P.placeWall(r, 'fridge', {}); }
      else furnish(P, r);
    }
    zs(P, m.x + m.w / 2, m.y + m.h / 2, 2.5, 3);
  }

  // Posto: loja de conveniência no fundo e pátio de concreto com ilhas de bombas
  function genGas(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = Math.min(13, LW - 4), bh = 8, left = rng() < 0.5;
    const bx = left ? 1 : LW - bw - 1, by = 1;
    const b = P.addBuilding({ type: 'gas_station', name: o.name, wall: W.PLASTER, wallColor: '#e4e1d6', roofColor: '#a23a2e', roofType: 'flat' });
    P.foot(b, bx, by, bw, bh);
    const main = P.addRoom(b, 'gas_station', bx + 1, by + 3, bw - 2, bh - 4, F.LINOLEUM);
    const st = P.addRoom(b, 'storage', bx + 1, by + 1, bw - 5, 1, F.CONCRETE, 'gas_storage');
    const bath = P.addRoom(b, 'bathroom', bx + bw - 3, by + 1, 2, 1, F.TILE);
    P.buildWalls(b, W.PLASTER, W.PLASTER, F.CONCRETE);
    P.fill(0, 0, LW, LD, F.CONCRETE);
    for (const r of P.rooms) P.fill(r.x, r.y, r.w, r.h, r.floor);
    P.door(st, main, {}); P.door(bath, main, {});
    const run = P.extDoors(main, 1, { x: main.x + (left ? main.w - 2 : 1) });
    const dx = run ? run[0].x : main.x + 1;
    P.windows(main, { glass: true, side: (c) => c.ny === -1, broken: 0.1 });
    pathTo(P, dx, by + bh, LD - 1);
    shopFloor(P, main, dx, { checkouts: 1, freezers: true });
    for (let x = st.x; x < st.x + st.w; x += 2) P.tryPut(st, 'crate', x, st.y, 1, 1, 1);
    furnish(P, bath);
    // ilhas de bombas: carros de 4 tiles abastecendo
    const py = by + bh + 5;
    for (let x = 3; x <= LW - 4; x += 6) {
      P.putOut('fuel_pump', x, py, 1, 1, 1); P.putOut('fuel_pump', x + 1, py, 1, 1, 1);
      if (rng() < 0.3) P.putCar(rng() < 0.3 ? 'pickup' : 'car', x + 2, py - 2, 1);
    }
    P.mark(2, py - 3, LW - 2, py - 3, 'stop');
    P.putOut('vending_machine', dx + (left ? 1 : -1), by + bh, 1, 1, 1);
    P.putOut('lamp_post', 0, LD - 1, 1, 1, 1); P.putOut('lamp_post', LW - 1, LD - 1, 1, 1, 1);
    P.putOut('trash_can', dx + (left ? -1 : 1), by + bh, 1, 1, 1);
    for (let i = 0; i < 3; i++) P.putOut(rng() < 0.5 ? 'tire' : 'barrel', left ? LW - 2 - i : 1 + i, 1, 1, 1, 1);
    zs(P, bx + bw / 2, by + bh + 3, 2, 3);
  }

  // Armazém/galpão: portão de enrolar, pátio de carga, paletes, caixotes, escritório
  function genWarehouse(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = Math.min(14, LD - 5), bx = 1, by = 1;
    const b = P.addBuilding({ type: 'warehouse', name: o.name, wall: W.CONCRETE, wallColor: '#8e9290', roofColor: '#6a6f6c', roofType: rng() < 0.5 ? 'flat' : 'gable' });
    P.foot(b, bx, by, bw, bh);
    const ix = bx + 1, iy = by + 1, iw = bw - 2, ih = bh - 2;
    const main = P.addRoom(b, 'warehouse', ix, iy, iw - 5, ih, F.CONCRETE, o.loot || 'warehouse');
    const off = P.addRoom(b, 'office', ix + iw - 4, iy + ih - 4, 4, 4, F.LINOLEUM, 'warehouse_office');
    const st = P.addRoom(b, 'storage', ix + iw - 4, iy, 4, ih - 5, F.CONCRETE, 'warehouse_tools');
    P.buildWalls(b, W.CONCRETE, W.CONCRETE, F.CONCRETE);
    P.door(off, main, {}); P.door(st, main, { locked: rng() < 0.4 });
    P.extDoors(main, 3, { x: main.x + 2, garage: true, locked: rng() < 0.6 });
    P.extDoors(off, 1, { x: off.x + 1 });
    P.windows(off, { p: 1, max: 1 }); P.windows(main, { p: 0.25, max: 3, side: (c) => c.ny !== -1 });
    for (let y = main.y; y < main.y + main.h - 3; y++) P.tryPut(main, 'shelf', main.x, y, 1, 1, 0);
    for (let x = main.x + 1; x < main.x + main.w; x++) P.tryPut(main, 'shelf', x, main.y, 1, 1, 1);
    for (let x = main.x + 3; x < main.x + main.w - 1; x += 3) for (let y = main.y + 2; y < main.y + main.h - 3; y++) if (rng() < 0.8) P.tryPut(main, rng() < 0.55 ? 'crate' : 'pallet', x, y, 1, 1, 1);
    P.placeWall(main, 'workbench', { far: { x: main.x, y: main.y + main.h } });
    for (let i = 0; i < 3; i++) P.placeWall(main, 'barrel', { corner: true });
    P.placeWall(st, 'workbench', {}); P.placeWall(st, 'shelf', {}); P.placeWall(st, 'shelf', {}); P.placeWall(st, 'crate', {});
    furnish(P, off);
    P.fill(0, by + bh, LW, LD - by - bh, F.CONCRETE);
    for (const d of main.doors) if (d.garage) for (let x = d.x; x < d.x + 3; x++) pathTo(P, x, by + bh, LD - 1);
    for (const d of off.doors) pathTo(P, d.x, by + bh, LD - 1);
    for (let i = 0; i < 5; i++) P.putOut(rng() < 0.5 ? 'pallet' : 'barrel', rng.int(1, LW - 2), rng.int(by + bh + 1, LD - 2), 1, 1, 1);
    P.putOut('dumpster', LW - 1, by + 1, 1, 2, 2);
    if (rng() < 0.7) P.putCar('pickup', rng.int(1, LW - 6), LD - 3, 0);
    zs(P, main.x + main.w / 2, main.y + main.h / 2, 1.5, 2);
  }

  // Corpo de bombeiros: garagem com 2 portões, cozinha, alojamento, escritório, banheiro
  function genFire(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = Math.min(15, LD - 4), bx = 1, by = LD - 2 - bh;
    const b = P.addBuilding({ type: 'fire_station', name: o.name, wall: W.BRICK, wallColor: '#9a4032', roofColor: '#3a3a3e', roofType: 'flat' });
    P.foot(b, bx, by, bw, bh);
    const ix = bx + 1, iy = by + 1, iw = bw - 2, ih = bh - 2;
    const gW = Math.min(12, iw - 6);
    const gar = P.addRoom(b, 'garage', ix, iy + 4, gW, ih - 4, F.CONCRETE, 'fire_garage');
    const off = P.addRoom(b, 'office', ix + gW + 1, iy + 4, iw - gW - 1, ih - 4, F.LINOLEUM, 'fire_office');
    const w3 = Math.floor((iw - 5) / 3);
    const kit = P.addRoom(b, 'kitchen', ix, iy, w3, 3, F.TILE, 'fire_kitchen');
    const dorm = P.addRoom(b, 'bedroom', ix + w3 + 1, iy, iw - 2 * w3 - 5, 3, F.LINOLEUM, 'fire_dorm');
    const bath = P.addRoom(b, 'bathroom', ix + iw - w3 - 3, iy, 2, 3, F.TILE);
    const st = P.addRoom(b, 'storage', ix + iw - w3, iy, w3, 3, F.CONCRETE, 'fire_storage');
    P.buildWalls(b, W.BRICK, W.PLASTER, F.CONCRETE);
    for (const r of [kit, dorm, bath, st]) if (!P.door(r, gar, {})) P.door(r, off, {});
    P.door(off, gar, { open: true });
    P.extDoors(gar, 3, { garage: true, x: gar.x + 1, locked: false, open: rng() < 0.5 });
    P.extDoors(gar, 3, { garage: true, x: gar.x + gar.w - 4, locked: rng() < 0.3, allowNear: true });
    P.extDoors(off, 1, { x: off.x + 1 });
    P.windows(off, { p: 0.7, side: (c) => c.ny === -1 }); P.windows(kit, { p: 1, max: 1 }); P.windows(dorm, { p: 0.6, max: 2 });
    for (const r of [kit, dorm, off]) P.keepWindowClear(r);
    P.tryPut(gar, 'ambulance', gar.x + 1, gar.y + 1, 2, 5, 1); P.tryPut(gar, 'pickup', gar.x + gar.w - 3, gar.y + 1, 2, 4, 1);
    for (let y = gar.y; y < gar.y + gar.h - 2; y++) P.tryPut(gar, 'locker', gar.x + Math.floor(gar.w / 2), y, 1, 1, 0);
    furnish(P, kit); furnish(P, off); furnish(P, bath);
    for (let i = 0; i < 3; i++) { P.placeWall(dorm, 'bed', {}); } P.placeWall(dorm, 'locker', {});
    P.placeWall(st, 'shelf', {}); P.placeWall(st, 'shelf', {}); P.placeWall(st, 'crate', {});
    P.fill(0, by + bh, LW, LD - by - bh, F.CONCRETE);
    for (const d of gar.doors) if (d.garage) for (let x = d.x; x < d.x + 3; x++) pathTo(P, x, by + bh, LD - 1);
    zs(P, gar.x + gar.w / 2, gar.y + 1, 1.5, 2);
  }

  // Escola: corredor central, salas de aula, cantina, banheiros, diretoria; pátio com balanços e quadra
  function genSchool(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = Math.min(30, LW - 4), bh = 17, bx = Math.floor((LW - bw) / 2), by = LD - 3 - bh;
    const b = P.addBuilding({ type: 'school', name: o.name, wall: W.BRICK, wallColor: '#a4553d', roofColor: '#4a4f55', roofType: 'flat' });
    P.foot(b, bx, by, bw, bh);
    const ix = bx + 1, iy = by + 1, iw = bw - 2;
    const hallY = iy + 7;
    const hall = P.addRoom(b, 'hall', ix, hallY, iw, 2, F.LINOLEUM, 'school_hall');
    const classes = [];
    const cw = Math.floor((iw - 3) / 4);
    for (let i = 0; i < 4; i++) {
      const x = ix + i * (cw + 1), w = i === 3 ? ix + iw - x : cw;
      classes.push(P.addRoom(b, i === 3 ? 'diner' : 'office', x, iy, w, 6, i === 3 ? F.TILE : F.LINOLEUM, i === 3 ? 'school_cafeteria' : 'school_class'));
    }
    const fy = hallY + 3, fh = by + bh - 1 - fy;
    const lobbyW = 4, lx = ix + Math.floor(iw / 2) - 2;
    const lobby = P.addRoom(b, 'hall', lx, fy, lobbyW, fh, F.LINOLEUM, 'school_hall');
    const leftW = lx - 1 - ix, rightX = lx + lobbyW + 1, rightW = ix + iw - rightX;
    const c5 = P.addRoom(b, 'office', ix, fy, leftW - 4, fh, F.LINOLEUM, 'school_class');
    const bathL = P.addRoom(b, 'bathroom', ix + leftW - 3, fy, 3, fh, F.TILE);
    const offc = P.addRoom(b, 'office', rightX, fy, 5, fh, F.CARPET, 'school_office');
    const kit = P.addRoom(b, 'kitchen', rightX + 6, fy, rightW - 6, fh, F.TILE, 'school_kitchen');
    P.buildWalls(b, W.BRICK, W.PLASTER, F.LINOLEUM);
    P.opening(lobby, hall, 4);
    for (const r of classes.concat([c5, bathL, offc])) P.door(r, hall, { open: rng() < 0.6, score: (c) => Math.abs(c.x - (r.x + 1)) + rng() }) || P.door(r, lobby, {});
    P.door(kit, classes[3], {}) || P.door(kit, hall, {});
    P.extDoors(lobby, 2, { x: lobby.x + 1 });
    P.door(hall, null, { score: (c) => (c.nx !== 0 ? 0 : 50) + rng(), locked: rng() < 0.5 });
    for (const r of classes.concat([c5, offc, kit])) { P.windows(r, { p: 0.6, curtain: 0.2, broken: 0.04 }); P.keepWindowClear(r); }
    for (const r of classes.concat([c5])) {
      if (r.type === 'diner') { for (let x = r.x + 1; x < r.x + r.w - 1; x += 3) { const t = P.tryPut(r, 'table', x, r.y + 2, 2, 1, 1); if (t >= 0) P.chairsAround(r, t, 3); } P.placeWall(r, 'vending_machine', {}); continue; }
      P.placeWall(r, 'desk', { side: 'top', center: true });
      P.placeWall(r, 'bookshelf', { corner: true });
      for (let y = r.y + 2; y < r.y + r.h - 1; y += 2) for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) P.tryPut(r, 'chair', x, y, 1, 1, 3);
    }
    furnish(P, bathL); furnish(P, offc);
    let anchor = { x: kit.x, y: kit.y };
    for (const t of ['stove', 'kitchen_counter', 'sink', 'fridge', 'freezer', 'kitchen_counter']) { const id = P.placeWall(kit, t, { near: anchor }); if (id >= 0) anchor = centerOf(P.objs[id]); }
    // pátio: quadra, balanços, mesas; cerca de tela em volta (portão na frente)
    P.fill(0, by + bh, LW, LD - by - bh, F.SIDEWALK);
    pathTo(P, lobby.x + 1, by + bh, LD - 1); pathTo(P, lobby.x + 2, by + bh, LD - 1);
    const cy = 2, ch = Math.max(6, by - 4);
    if (ch >= 6) {
      const cw2 = Math.min(14, Math.floor(LW / 2) - 2);
      P.fill(2, cy, cw2, ch, F.CONCRETE);
      P.mark(2 + cw2 / 2, cy, 2 + cw2 / 2, cy + ch, 'court');
      for (let i = 0; i < 3; i++) P.putOut('swing', LW - 6, 2 + i * 3, 2, 1, 1);
      P.putOut('picnic_table', LW - 10, 3, 2, 1, 1); P.putOut('picnic_table', LW - 10, 6, 2, 1, 1);
    }
    P.fenceLine(0, 0, LW - 1, 0, W.FENCE_METAL); P.fenceLine(0, 0, 0, by + bh - 1, W.FENCE_METAL); P.fenceLine(LW - 1, 0, LW - 1, by + bh - 1, W.FENCE_METAL);
    zs(P, hall.x + hall.w / 2, hall.y + 1, 3, 5);
    zs(P, LW / 2, 4, 1, 2);
  }

  // Igreja: nave com bancos, altar, sacristia
  function genChurch(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - 3, bx = 1, by = 1;
    const b = P.addBuilding({ type: 'church', name: o.name, wall: W.WOOD, wallColor: '#ecebe4', roofColor: '#3b3b40', roofType: 'gable' });
    P.foot(b, bx, by, bw, bh);
    const ix = bx + 1, iy = by + 1, iw = bw - 2, ih = bh - 2;
    const nave = P.addRoom(b, 'church', ix, iy + 4, iw, ih - 4, F.WOOD);
    const sac = P.addRoom(b, 'office', ix, iy, Math.floor(iw / 2), 3, F.CARPET, 'church_office');
    const st = P.addRoom(b, 'storage', ix + sac.w + 1, iy, iw - sac.w - 1, 3, F.WOOD, 'church_storage');
    P.buildWalls(b, W.WOOD, W.PLASTER, F.WOOD);
    P.door(sac, nave, {}); P.door(st, nave, { locked: rng() < 0.5 });
    const dx = nave.x + Math.floor(nave.w / 2) - 1;
    P.extDoors(nave, 2, { x: dx });
    P.windows(nave, { p: 0.6, side: (c) => c.ny === 0 });
    P.windows(sac, { p: 1, max: 1 });
    P.tryPut(nave, 'table', dx, nave.y + 1, 2, 1, 3);
    P.tryPut(nave, 'plant', nave.x, nave.y, 1, 1, 0); P.tryPut(nave, 'plant', nave.x + nave.w - 1, nave.y, 1, 1, 0);
    for (let y = nave.y + 3; y <= nave.y + nave.h - 2; y += 2) {
      const lw = dx - nave.x - 1, rw = nave.x + nave.w - (dx + 2) - 1;
      if (lw >= 2) P.tryPut(nave, 'bench', nave.x + 1, y, Math.min(3, lw), 1, 3);
      if (rw >= 2) P.tryPut(nave, 'bench', dx + 3, y, Math.min(3, rw), 1, 3);
    }
    furnish(P, sac); P.placeWall(st, 'shelf', {}); P.placeWall(st, 'crate', {});
    P.fill(dx, by + bh, 2, LD - by - bh, F.SIDEWALK);
    pathTo(P, dx, by + bh, LD - 1); pathTo(P, dx + 1, by + bh, LD - 1);
    P.putOut('bench', 0, by + bh, 2, 1, 1); P.putOut('lamp_post', LW - 1, LD - 1, 1, 1, 1);
    zs(P, nave.x + nave.w / 2, nave.y + nave.h / 2, 3, 5);
  }

  // Cemitério: cerca de ferro com portão, túmulos em fileiras, caminho, pinheiros
  function genCemetery(P, rng) {
    const LW = P.w, LD = P.h;
    P.fill(0, 0, LW, LD, F.DARK_GRASS);
    const gx = Math.floor(LW / 2);
    P.fill(gx, 1, 1, LD - 1, F.DIRT);
    for (let y = 1; y < LD; y++) P.resv[y * LW + gx] = 1;
    P.fenceLine(0, 0, LW - 1, 0, W.FENCE_METAL); P.fenceLine(0, 0, 0, LD - 1, W.FENCE_METAL);
    P.fenceLine(LW - 1, 0, LW - 1, LD - 1, W.FENCE_METAL); P.fenceLine(0, LD - 1, LW - 1, LD - 1, W.FENCE_METAL);
    P.wall[(LD - 1) * LW + gx] = W.FENCE_GATE; P.ws[(LD - 1) * LW + gx] = WS.OPEN;
    for (let y = 2; y < LD - 2; y += 2) for (let x = 2; x < LW - 2; x++) {
      if (x >= gx - 1 && x <= gx + 1) continue;
      if (rng() < 0.72) P.putOut('grave', x, y, 1, 1, 1);
    }
    for (let i = 0; i < 6; i++) P.putOut(rng() < 0.6 ? 'pine' : 'tree', rng.int(1, LW - 2), rng.int(1, LD - 2), 1, 1, 0);
    P.putOut('bench', gx + 2, LD - 3, 2, 1, 3);
    zs(P, LW / 2, LD / 2, 0.8, 2);
  }

  // Celeiro (fazenda)
  function genBarn(P, rng, o) {
    const LW = P.w, LD = P.h;
    const bw = LW - 2, bh = LD - 4, bx = 1, by = 1;
    const b = P.addBuilding({ type: 'barn', name: o.name, wall: W.WOOD, wallColor: '#8e3b2f', roofColor: '#4a4a48', roofType: 'gable' });
    P.foot(b, bx, by, bw, bh);
    const main = P.addRoom(b, 'warehouse', bx + 1, by + 1, bw - 2, bh - 2, F.DIRT, 'farm');
    P.buildWalls(b, W.WOOD, W.WOOD, F.DIRT);
    P.extDoors(main, 3, { x: main.x + Math.floor(main.w / 2) - 1, garage: true, open: rng() < 0.5 });
    P.windows(main, { p: 0.3, max: 2, side: (c) => c.ny !== -1 });
    P.placeWall(main, 'workbench', {}); P.placeWall(main, 'shelf', { corner: true }); P.placeWall(main, 'shelf', { corner: true });
    for (let i = 0; i < 4; i++) P.placeWall(main, rng() < 0.5 ? 'crate' : 'log_pile', {});
    for (let i = 0; i < 3; i++) P.placeWall(main, 'barrel', { corner: true });
    if (main.w >= 6 && main.h >= 7) P.placeFree(main, 'pickup', 2, 4, 1, { margin: 1 });
    P.fill(0, by + bh, LW, LD - by - bh, F.DIRT);
    zs(P, main.x + main.w / 2, main.y + main.h / 2, 0.8, 1);
  }
  // Plantação cercada (fileiras de terra e grama escura com plantas)
  function genField(P, rng) {
    const LW = P.w, LD = P.h;
    const vertical = rng() < 0.5;
    for (let y = 1; y < LD - 1; y++) for (let x = 1; x < LW - 1; x++) P.floor[y * LW + x] = (vertical ? x : y) % 2 ? F.DIRT : F.DARK_GRASS;
    const gx = rng.int(2, LW - 3);
    P.fill(gx, 1, 1, LD - 1, F.DIRT);
    for (let y = 1; y < LD; y++) P.resv[y * LW + gx] = 1;
    P.fenceLine(0, 0, LW - 1, 0, W.FENCE_WOOD); P.fenceLine(0, 0, 0, LD - 1, W.FENCE_WOOD);
    P.fenceLine(LW - 1, 0, LW - 1, LD - 1, W.FENCE_WOOD); P.fenceLine(0, LD - 1, LW - 1, LD - 1, W.FENCE_WOOD);
    P.wall[(LD - 1) * LW + gx] = W.FENCE_GATE; P.ws[(LD - 1) * LW + gx] = rng() < 0.5 ? WS.OPEN : 0;
    for (let y = 2; y < LD - 2; y++) for (let x = 2; x < LW - 2; x++) {
      if ((vertical ? x : y) % 2 === 0 && x !== gx && rng() < 0.55) P.putOut('bush', x, y, 1, 1, 0);
    }
    P.putOut('barrel', 1, 1, 1, 1, 1);
    return true;
  }

  // Motel à beira da estrada: fileira de quartos com porta para fora, recepção, estacionamento na frente
  function genMotel(P, rng, o) {
    const LW = P.w, LD = P.h;
    const units = Math.max(3, Math.min(7, Math.floor((LW - 9) / 5)));
    const bw = units * 5 + 7, bh = 9, bx = Math.floor((LW - bw) / 2), by = 1;
    const b = P.addBuilding({ type: 'motel', name: o.name, wall: W.PLASTER, wallColor: rng.pick(['#e2c9a0', '#d8b8a8', '#cfd6c8']), roofColor: '#6b3a32', roofType: 'flat' });
    P.foot(b, bx, by, bw, bh);
    const iy = by + 1;
    const off = P.addRoom(b, 'office', bx + 1, iy, 5, 7, F.LINOLEUM, 'motel_office');
    const rooms = [];
    for (let u = 0; u < units; u++) {
      const x = bx + 7 + u * 5;
      const bath = P.addRoom(b, 'bathroom', x, iy, 4, 2, F.TILE, 'motel_bath');
      const bed = P.addRoom(b, 'bedroom', x, iy + 3, 4, 4, F.CARPET, 'motel_room');
      rooms.push([bed, bath]);
    }
    P.buildWalls(b, W.PLASTER, W.PLASTER, F.CONCRETE);
    P.extDoors(off, 1, { x: off.x + 1 });
    P.windows(off, { glass: true, side: (c) => c.ny === -1 });
    checkout(P, off, off.x + 3, off.y + 1, 2); P.placeWall(off, 'bookshelf', { corner: true }); P.placeWall(off, 'plant', { corner: true });
    P.placeWall(off, 'chair', {}); P.placeWall(off, 'vending_machine', {});
    for (const [bed, bath] of rooms) {
      P.door(bath, bed, {});
      const lk = rng() < 0.35;
      P.extDoors(bed, 1, { x: bed.x + (rng() < 0.5 ? 0 : 3), locked: lk, open: !lk && rng() < 0.15 });
      P.windows(bed, { p: 1, max: 1, side: (c) => c.ny === -1, curtain: 0.85, broken: 0.08 });
      P.keepWindowClear(bed);
      P.placeWall(bed, 'double_bed', { side: 'top' }); P.placeWall(bed, 'tv', {}); P.placeWall(bed, 'dresser', {}); P.placeWall(bed, 'lamp', { corner: true });
      furnish(P, bath);
    }
    P.fill(0, by + bh, LW, LD - by - bh, F.ASPHALT);
    P.fill(0, by + bh, LW, 1, F.SIDEWALK);
    for (let x = 0; x < LW; x++) P.resv[(by + bh) * LW + x] = 1;
    parkingStalls(P, rng, bx, bx + bw - 1, by + bh + 1, 0.35);
    P.putOut('lamp_post', 0, LD - 1, 1, 1, 1); P.putOut('lamp_post', LW - 1, LD - 1, 1, 1, 1);
    P.putOut('dumpster', LW - 3, 0, 2, 1, 1);
    zs(P, bx + bw / 2, by + bh + 2, 2, 3);
  }

  // Parque de trailers: pista de cascalho em U, trailers dos dois lados, carros, churrasqueiras
  function genTrailerPark(P, rng, o) {
    const LW = P.w, LD = P.h;
    P.fill(0, 0, LW, LD, F.DIRT);
    for (let y = 0; y < LD; y++) for (let x = 0; x < LW; x++) if (U.hash2(x, y, 99) < 0.55) P.floor[y * LW + x] = F.GRASS;
    const lane = Math.floor(LW / 2) - 1;
    P.fill(lane, 0, 3, LD, F.GRAVEL);
    for (let y = 0; y < LD; y++) for (let x = lane; x < lane + 3; x++) P.resv[y * LW + x] = 1;
    let n = 0;
    for (let y = 1; y + 7 < LD - 1; y += 10) {
      for (const leftSide of [true, false]) {
        const x = leftSide ? lane - 15 : lane + 4;
        if (x < 1 || x + 14 > LW - 1) continue;
        const name = 'Trailer dos ' + o.names[(o.nameI + n) % o.names.length];
        genTrailer(P, rng, x, y, name); n++;
        const cx = leftSide ? x + 10 : x + 1;
        if (rng() < 0.6) P.putCar(rng() < 0.5 ? 'pickup' : 'car', cx, y + 8, 0);
        if (rng() < 0.5) putYard(P, 'grill', leftSide ? x + 2 : x + 11, y + 8, 1, 1, 0);
        if (rng() < 0.4) putYard(P, 'clothesline', leftSide ? x + 4 : x + 7, y - 1 >= 0 ? y + 9 : y + 8, 3, 1, 0);
      }
    }
    o.used = n;
    P.putOut('dumpster', lane + 3, LD - 3, 2, 1, 3);
    P.putOut('lamp_post', lane - 1, 2, 1, 1, 0); P.putOut('lamp_post', lane + 3, Math.floor(LD / 2), 1, 1, 0);
    zs(P, lane + 1, LD / 2, 1.5, 3);
    return n > 0;
  }

  // Praça: caminhos em cruz, chafariz, bancos, árvores, postes
  function genSquare(P, rng, o) {
    const LW = P.w, LD = P.h, cx = Math.floor(LW / 2) - 1, cy = Math.floor(LD / 2) - 1;
    P.fill(0, 0, LW, LD, F.GRASS);
    P.fill(cx, 0, 2, LD, F.SIDEWALK); P.fill(0, cy, LW, 2, F.SIDEWALK);
    P.fill(cx - 3, cy - 3, 8, 8, F.SIDEWALK);
    for (let y = 0; y < LD; y++) for (let x = cx; x < cx + 2; x++) P.resv[y * LW + x] = 1;
    for (let x = 0; x < LW; x++) for (let y = cy; y < cy + 2; y++) P.resv[y * LW + x] = 1;
    P.put('fountain', cx, cy, 2, 2, 1);
    const ring = [[cx - 3, cy - 3], [cx + 3, cy - 3], [cx - 3, cy + 4], [cx + 3, cy + 4]];
    for (const [x, y] of ring) P.putOut('bench', x, y, 2, 1, 1);
    for (const [x, y] of [[cx - 2, cy - 2], [cx + 3, cy - 2], [cx - 2, cy + 3], [cx + 3, cy + 3]]) P.putOut('lamp_post', x, y, 1, 1, 0);
    for (let i = 0; i < 26; i++) { const x = rng.int(1, LW - 2), y = rng.int(1, LD - 2); if (Math.abs(x - cx) > 4 || Math.abs(y - cy) > 4) P.putOut(rng() < 0.7 ? 'tree' : 'bush', x, y, 1, 1, 0); }
    for (let i = 0; i < 4; i++) P.putOut('bench', rng.int(2, LW - 4), rng.int(2, LD - 3), 2, 1, rng() < 0.5 ? 1 : 3);
    P.putOut('trash_can', cx + 2, cy - 4, 1, 1, 0); P.putOut('trash_can', cx - 1, cy + 5, 1, 1, 0);
    zs(P, cx + 1, cy + 1, 1.5, 3);
    return true;
  }

  // Tabela de prédios (comércio/serviços): sorteio de conjunto e nomes
  const SPECIAL_POOL = [
    { key: 'market', need: 1, gen: genMarket, lw: [22, 26], names: ['Mercado Bom Preço', 'Mercearia do Vale', 'Supermercado Pioneiro'] },
    { key: 'gas', need: 1, gen: genGas, lw: [18, 20], ld: 18, hwy: true, names: ['Posto Estrela', 'Posto Rota 31', 'Posto Pinheiral'] },
    { key: 'police', need: 1, gen: genPolice, lw: [19, 21], names: ['Delegacia de Vale Quieto'] },
    { key: 'pharmacy', p: 0.85, gen: genShop, lw: [12, 14], names: ['Farmácia Vida', 'Drogaria Central'], o: { btype: 'pharmacy', mainType: 'pharmacy', loot: 'pharmacy', freezers: true,
      back: [{ type: 'pharmacy', loot: 'pharmacy_back', locked: true }, { type: 'bathroom', w: 2 }], backExtra: ['medicine_cabinet'], wallColor: '#e8e4dc', roofColor: '#3c6a58' } },
    { key: 'diner', p: 0.9, gen: genDiner, lw: [14, 17], names: ['Lanchonete da Rosa', 'Diner 31', 'Café da Estrada'] },
    { key: 'bar', p: 0.6, gen: genDiner, lw: [13, 15], names: ['Bar do Hank', 'Taverna Pinheiro', 'Saloon Vale Quieto'], o: { style: 'bar', zw: 3 } },
    { key: 'hardware', p: 0.7, gen: genShop, lw: [14, 16], names: ['Ferragens Silva', 'Casa das Ferramentas'], o: { btype: 'store', mainType: 'store', loot: 'hardware',
      back: [{ type: 'storage', loot: 'hardware_storage' }, { type: 'bathroom', w: 2 }], backObj: 'crate', backExtra: ['workbench'], wallColor: '#8d7b62', roofColor: '#4d3f33' } },
    { key: 'clothes', p: 0.55, gen: genShop, lw: [12, 14], names: ['Loja de Roupas Estilo', 'Brechó da Dona Ruth'], o: { btype: 'store', mainType: 'store', loot: 'clothing',
      back: [{ type: 'storage', loot: 'clothing_storage' }, { type: 'bathroom', w: 2 }], wallColor: '#c9b4a8', roofColor: '#5b3b44', floor: F.WOOD } },
    { key: 'convenience', p: 0.35, gen: genShop, lw: [12, 14], names: ['Conveniência 24h', 'Empório do Zé'], o: { btype: 'store', mainType: 'store', loot: 'convenience', freezers: true,
      back: [{ type: 'storage', loot: 'convenience_storage' }, { type: 'bathroom', w: 2 }], wallColor: '#b8c0b0', roofColor: '#40503a' } },
    { key: 'post', p: 0.55, gen: genShop, lw: [12, 14], names: ['Agência dos Correios'], o: { btype: 'office', mainType: 'office', loot: 'post_office', style: 'office',
      back: [{ type: 'storage', loot: 'post_storage' }, { type: 'bathroom', w: 2 }], backObj: 'crate', wallColor: '#b9a58a', roofColor: '#2f4a6b', floor: F.CARPET } },
    { key: 'library', p: 0.35, gen: genShop, lw: [14, 16], names: ['Biblioteca Pública'], o: { btype: 'library', mainType: 'office', loot: 'library', style: 'library', glass: false, sideWin: 3,
      back: [{ type: 'office', loot: 'library_office' }, { type: 'bathroom', w: 2 }], wall: W.BRICK, wallColor: '#8f6a58', roofColor: '#3a3a3a', floor: F.CARPET } },
    { key: 'clinic', p: 0.6, gen: genClinic, lw: [17, 19], names: ['Clínica Vale Quieto', 'Posto de Saúde'] },
    { key: 'fire', p: 0.5, gen: genFire, lw: [22, 24], names: ['Corpo de Bombeiros'] },
    { key: 'warehouse', p: 0.75, gen: genWarehouse, lw: [19, 22], ld: 18, edge: true, names: ['Armazém Vale Quieto', 'Galpão da Cooperativa'] },
  ];

  // ------------------------------------------------------------------
  // 4. Layout global
  // ------------------------------------------------------------------
  function allocMap(w, h) {
    const n = w * h;
    return {
      w, h,
      floor: new Uint8Array(n).fill(F.GRASS), wall: new Uint8Array(n), wallState: new Uint8Array(n),
      wallHp: new Float32Array(n), barricadeHp: new Float32Array(n), wallMask: new Uint8Array(n),
      building: new Uint16Array(n), room: new Uint16Array(n), objAt: new Int32Array(n).fill(-1),
      buildings: [], rooms: [], objects: [], spawnPoint: { x: w / 2, y: h / 2 }, zombieSpawns: [],
      roadMarks: [], bridges: [],
    };
  }

  // Cria objeto no mapa (checa pegada). Retorna o objeto ou null.
  function addObject(ctx, type, x, y, w, h, rot, opts) {
    const m = ctx.m, def = ODEF[type];
    opts = opts || {};
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (i < 0 || j < 0 || i >= m.w || j >= m.h) return null;
      const k = j * m.w + i, f = m.floor[k];
      if (m.wall[k] || m.objAt[k] >= 0 || f === F.WATER || f === F.POOL) return null;
      if (opts.outdoor && m.building[k]) return null;
      if (opts.avoidKeep && ctx.keep[k]) return null;
      if (opts.noLots && ctx.res[k] === 2) return null;
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
      o._rt = rt;
      try { if (G.items && G.items.fillContainer) G.items.fillContainer(o.container, rt, type, ctx.lootRng); } catch (e) { console.error('[world] fillContainer', e); }
    }
    if (opts.extra) Object.assign(o, opts.extra);
    m.objects.push(o);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m.objAt[j * m.w + i] = o.id;
    return o;
  }
  function addCar(ctx, type, x, y, rot, opts) {
    const d = ODEF[type];
    return addObject(ctx, type, x, y, footW(d.a, d.d, rot), footH(d.a, d.d, rot), rot, opts);
  }
  function purgeObjects(m, kill) {
    m.objects = m.objects.filter((o) => !kill.has(o.id));
    m.objAt.fill(-1);
    m.objects.forEach((o, i) => { o.id = i; for (let j = o.y; j < o.y + o.h; j++) for (let x = o.x; x < o.x + o.w; x++) m.objAt[j * m.w + x] = i; });
  }

  // ---- Transformação do lote (canônico, frente +y) para o mundo ----
  // face = lado da rua no mundo ('S' frente para +y, 'N' -y, 'E' +x, 'W' -x)
  function lotTf(lot, LW, LD) {
    const x0 = lot.x, y0 = lot.y, f = lot.face;
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
    const m = ctx.m, tf = lotTf(lot, P.w, P.h), q = { x: 0, y: 0 }, q2 = { x: 0, y: 0 };
    const rectW = (x, y, w, h) => {
      tf.t(x, y, q); tf.t(x + w - 1, y + h - 1, q2);
      return { x: Math.min(q.x, q2.x), y: Math.min(q.y, q2.y), w: Math.abs(q.x - q2.x) + 1, h: Math.abs(q.y - q2.y) + 1 };
    };
    const bIds = P.blds.map((info) => {
      const id = m.buildings.length + 1;
      const parts = info.parts.map((p) => { const r = rectW(p.x, p.y, p.w, p.h); r.ridgeAxis = r.w >= r.h ? 'x' : 'y'; return r; });
      const main = parts[0];
      m.buildings.push({ id, x: 1e9, y: 1e9, w: 0, h: 0, x2: -1, y2: -1, type: info.type, name: info.name, roofColor: info.roofColor,
        wallColor: info.wallColor, wall: info.wall, doors: [], lot: ctx.lots.length, parts,
        roofType: info.roofType || 'flat', ridgeAxis: main ? main.ridgeAxis : 'x', face: lot.face, floorColor: info.floorColor || null });
      return id;
    });
    const rIds = P.rooms.map((r) => {
      const R = rectW(r.x, r.y, r.w, r.h);
      const id = m.rooms.length + 1;
      m.rooms.push({ id, building: bIds[r.b - 1], type: r.type, x: R.x, y: R.y, w: R.w, h: R.h, loot: r.loot || r.type });
      return id;
    });
    for (let ly = 0; ly < P.h; ly++) for (let lx = 0; lx < P.w; lx++) {
      const k = ly * P.w + lx;
      tf.t(lx, ly, q);
      if (q.x < 0 || q.y < 0 || q.x >= m.w || q.y >= m.h) continue;
      const i = q.y * m.w + q.x;
      if (P.floor[k]) m.floor[i] = P.floor[k];
      if (P.wall[k]) {
        m.wall[i] = P.wall[k]; m.wallState[i] = P.ws[k];
        m.wallHp[i] = P.ws[k] & WS.BROKEN ? 0 : baseHp(P.wall[k]);
      }
      if (P.bld[k]) {
        const id = bIds[P.bld[k] - 1], B = m.buildings[id - 1];
        m.building[i] = id;
        if (q.x < B.x) B.x = q.x; if (q.y < B.y) B.y = q.y; if (q.x > B.x2) B.x2 = q.x; if (q.y > B.y2) B.y2 = q.y;
      }
      if (P.room[k] >= 0) m.room[i] = rIds[P.room[k]];
      if (P.resv[k]) ctx.keep[i] = 1;
    }
    for (const id of bIds) { const B = m.buildings[id - 1]; B.w = B.x2 - B.x + 1; B.h = B.y2 - B.y + 1; delete B.x2; delete B.y2; }
    P.blds.forEach((info, bi) => {
      const B = m.buildings[bIds[bi] - 1];
      for (const d of info.doors) { tf.t(d.x, d.y, q); B.doors.push({ x: q.x, y: q.y }); }
    });
    for (const o of P.objs) {
      const R = rectW(o.x, o.y, o.w, o.h);
      const r = o.room != null && o.room >= 0 ? P.rooms[o.room] : null;
      addObject(ctx, o.type, R.x, R.y, R.w, R.h, tf.rot(o.rot),
        { roomType: r ? r.type : 'outdoor', loot: r ? r.loot || r.type : lot.loot || 'outdoor', variant: o.variant });
    }
    for (const mk of P.marks) {
      const a = tf.p(mk.x0, mk.y0), b = tf.p(mk.x1, mk.y1);
      m.roadMarks.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, type: mk.type });
    }
    for (const z of P.zspawn) { const p = tf.p(z.x, z.y); ctx.hot.push({ x: p.x, y: p.y, weight: z.weight, n: z.n || 1, b: bIds[0] || 0, kind: lot.kind }); }
    const rec = Object.assign({}, lot, { bIds, rIds });
    // cerca de divisa (fundos + laterais até fence.row) — desenhada no passe global sem duplicar
    if (P.fence) {
      const segs = [[0, 0, P.w - 1, 0], [0, 0, 0, P.fence.row], [P.w - 1, 0, P.w - 1, P.fence.row]];
      rec.fence = { type: P.fence.type, segs: segs.map(([ax, ay, bx, by]) => {
        tf.t(ax, ay, q); const A = { x: q.x, y: q.y }; tf.t(bx, by, q); const B = { x: q.x, y: q.y };
        return { a: A, b: B };
      }) };
    }
    ctx.lots.push(rec);
    return rec;
  }

  // ---- Estradas ----
  // r = { h, c, a0, a1, kind, w, lo, hi, edge }  kind: 'hwy'|'main'|'res'|'rural'|'dirt'|'alley'
  // Faixa ocupa [lo, hi] na transversal; linha central (se houver) na coordenada c (borda entre tiles).
  const ROAD_W = { hwy: 6, main: 6, res: 4, rural: 6, dirt: 3, alley: 3 };
  function seg(ctx, x0, y0, x1, y1, kind, extra) {
    const T = ctx.T;
    const p0 = T(x0, y0), p1 = T(x1, y1);
    const horiz = p0.y === p1.y;
    const w = ROAD_W[kind];
    // a transversal canônica "c" vira a borda do tile c no mundo; ao espelhar, a borda c' = W - c
    const cc = horiz ? p0.y : p0.x;
    const flipped = horiz ? ctx.flipY : ctx.flipX;
    const c = flipped && w % 2 === 0 ? cc + 1 : cc;
    const lo = c - (w >> 1), r = { h: horiz, c, a0: horiz ? Math.min(p0.x, p1.x) : Math.min(p0.y, p1.y), a1: horiz ? Math.max(p0.x, p1.x) : Math.max(p0.y, p1.y),
      kind, w, lo, hi: lo + w - 1, edge: kind === 'dirt' || kind === 'alley' ? 0 : 1, dep: [18, 18] };
    if (extra) Object.assign(r, extra);
    if (flipped) r.dep = [r.dep[1], r.dep[0]]; // lado "norte/oeste" canônico virou "sul/leste" no mundo
    ctx.roads.push(r);
    return r;
  }
  function roadCell(r, t, o) { return r.h ? { x: t, y: r.lo + o } : { x: r.lo + o, y: t }; }
  const sidewalked = (r) => r.kind === 'hwy' || r.kind === 'main' || r.kind === 'res';

  function paintRoads(ctx) {
    const m = ctx.m, w = m.w, h = m.h, cnt = new Uint8Array(w * h);
    const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    const paved = ctx.roads.filter((r) => r.kind !== 'dirt');
    for (const r of paved) for (let t = r.a0; t <= r.a1; t++) for (let o = 0; o < r.w; o++) {
      const p = roadCell(r, t, o); if (!inb(p.x, p.y)) continue;
      const i = p.y * w + p.x;
      if (r.kind === 'alley' && cnt[i]) continue;
      m.floor[i] = r.kind === 'alley' && r.gravel ? F.GRAVEL : F.ASPHALT; cnt[i]++; ctx.res[i] = 1;
    }
    for (const b of ctx.bulbs) for (let y = b.y - 6; y <= b.y + 6; y++) for (let x = b.x - 6; x <= b.x + 6; x++) {
      if (!inb(x, y)) continue;
      const d = dist(x + 0.5, y + 0.5, b.x, b.y), i = y * w + x;
      if (d <= 4.4) { m.floor[i] = F.ASPHALT; cnt[i] += 2; ctx.res[i] = 1; }
    }
    ctx.roadCnt = cnt;
    // calçadas / acostamentos
    for (const r of paved) {
      if (!r.edge) continue;
      const ext = sidewalked(r) ? 1 : 0;
      for (let t = r.a0 - ext; t <= r.a1 + ext; t++) for (const o of [-1, r.w]) {
        const p = roadCell(r, t, o); if (!inb(p.x, p.y)) continue;
        const i = p.y * w + p.x; if (cnt[i] || m.floor[i] === F.WATER) continue;
        m.floor[i] = sidewalked(r) ? F.SIDEWALK : F.GRAVEL; ctx.res[i] = 1;
      }
    }
    for (const b of ctx.bulbs) for (let y = b.y - 6; y <= b.y + 6; y++) for (let x = b.x - 6; x <= b.x + 6; x++) {
      if (!inb(x, y)) continue;
      const d = dist(x + 0.5, y + 0.5, b.x, b.y), i = y * w + x;
      if (d > 4.4 && d <= 5.6 && !cnt[i]) { m.floor[i] = F.SIDEWALK; ctx.res[i] = 1; }
    }
    // estradas de terra
    for (const r of ctx.roads) if (r.kind === 'dirt') for (let t = r.a0; t <= r.a1; t++) for (let o = 0; o < r.w; o++) {
      const p = roadCell(r, t, o); if (!inb(p.x, p.y)) continue;
      const i = p.y * w + p.x; if (ctx.res[i] === 1) continue;
      if (m.floor[i] === F.WATER) { m.floor[i] = F.DOCK; ctx.res[i] = 5; continue; } // pontilhão de madeira
      m.floor[i] = o === 1 && U.hash2(p.x, p.y, 7) < 0.5 ? F.GRAVEL : F.DIRT; ctx.res[i] = 5;
    }
  }

  // Marcas de rua (linhas finas em coordenadas de mundo)
  function roadMarks(ctx) {
    const m = ctx.m, w = m.w, cnt = ctx.roadCnt, marks = m.roadMarks;
    const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < m.h;
    const clearAt = (r, t) => { for (let o = 0; o < r.w; o++) { const p = roadCell(r, t, o); if (!inb(p.x, p.y) || cnt[p.y * w + p.x] !== 1) return false; } return true; };
    const push = (r, t0, t1, type) => {
      if (r.h) marks.push({ x0: t0, y0: r.c, x1: t1, y1: r.c, type }); else marks.push({ x0: r.c, y0: t0, x1: r.c, y1: t1, type });
    };
    for (const r of ctx.roads) {
      if (r.kind !== 'hwy' && r.kind !== 'main' && r.kind !== 'rural') continue;
      const type = r.kind === 'hwy' ? 'center_solid' : 'center_dashed';
      let s = -1;
      for (let t = r.a0; t <= r.a1 + 1; t++) {
        const ok = t <= r.a1 && clearAt(r, t);
        if (ok && s < 0) s = t;
        if (!ok && s >= 0) { if (t - s >= 2) push(r, s, t, type); s = -1; }
      }
    }
    // cruzamentos: faixas de pedestre na via principal/rodovia, "pare" nas residenciais
    for (const a of ctx.roads) {
      if (a.kind !== 'main' && a.kind !== 'hwy' && a.kind !== 'res') continue;
      for (const b of ctx.roads) {
        if (b === a || b.h === a.h || (b.kind !== 'main' && b.kind !== 'hwy' && b.kind !== 'res')) continue;
        // interseção: a é cruzada por b em t = b.lo..b.hi (coord ao longo de a)
        if (b.lo > a.a1 || b.hi < a.a0 || a.lo > b.a1 || a.hi < b.a0) continue;
        for (const side of [-1, 1]) {
          const t = side < 0 ? b.lo - 1 : b.hi + 1; // tile logo antes/depois do cruzamento
          if (t < a.a0 || t > a.a1) continue;
          const edgeT = side < 0 ? b.lo - 1 : b.hi + 2; // coordenada da borda
          if (a.kind === 'main' || a.kind === 'hwy' || ctx.downtown && ctx.downtown(t, a)) {
            const mid = side < 0 ? t + 0.5 : t + 0.5;
            if (a.h) marks.push({ x0: mid, y0: a.lo, x1: mid, y1: a.hi + 1, type: 'crosswalk' });
            else marks.push({ x0: a.lo, y0: mid, x1: a.hi + 1, y1: mid, type: 'crosswalk' });
          } else if (b.kind === 'main' || b.kind === 'hwy') {
            if (a.h) marks.push({ x0: edgeT, y0: a.lo, x1: edgeT, y1: a.hi + 1, type: 'stop' });
            else marks.push({ x0: a.lo, y0: edgeT, x1: a.hi + 1, y1: edgeT, type: 'stop' });
          }
        }
      }
    }
  }

  // ---- Lotes ao longo das ruas ----
  function lotRect(r, side, p, LW, LD) {
    const f0 = r.lo - 1 - r.edge, f1 = r.hi + 1 + r.edge; // linha da frente do lote (colada na calçada/acostamento)
    if (r.h) return side < 0 ? { x: p, y: f0 - LD + 1, w: LW, h: LD, face: 'S' } : { x: p, y: f1, w: LW, h: LD, face: 'N' };
    return side < 0 ? { x: f0 - LD + 1, y: p, w: LD, h: LW, face: 'E' } : { x: f1, y: p, w: LD, h: LW, face: 'W' };
  }
  function rectFree(ctx, R, margin) {
    const m = ctx.m, mg = margin != null ? margin : 4;
    if (R.x < mg || R.y < mg || R.x + R.w > m.w - mg || R.y + R.h > m.h - mg) return false;
    for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) if (ctx.res[y * m.w + x]) return false;
    return true;
  }
  function claim(ctx, R, v) { for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) ctx.res[y * ctx.m.w + x] = v; }
  function buildLot(ctx, R, LW, LD, gen, o, kind) {
    const P = new Plan(LW, LD, ctx.rng);
    if (gen(P, ctx.rng, o) === false) return null;
    claim(ctx, R, 2);
    return stampLot(ctx, P, { x: R.x, y: R.y, w: R.w, h: R.h, face: R.face, kind, name: o.name, loot: o.lotLoot });
  }
  // Melhor frente de rua (menor score) para um lote LW×LD (LD pode vir da profundidade do lado da rua)
  function bestFrontage(ctx, LW, LD, score, roads, minDep) {
    let best = null, bs = 1e9;
    for (const r of roads || ctx.roads) {
      if (r.kind === 'alley' || (r.kind === 'dirt' && !ctx.allowDirt)) continue;
      for (const si of [0, 1]) {
        const side = si ? 1 : -1;
        const ld = LD || r.dep[si];
        if (ld < (minDep || 12)) continue;
        for (let p = r.a0 - LW; p <= r.a1; p++) {
          const R = lotRect(r, side, p, LW, ld);
          const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
          const along = r.h ? cx : cy;
          if (along < r.a0 + 1 || along > r.a1 - 1) continue;
          const s = score(cx, cy, r, R);
          if (s >= bs) continue;
          if (!rectFree(ctx, R)) continue;
          bs = s; best = R; best.ld = ld; best.road = r;
        }
      }
    }
    return best;
  }
  // Área livre mais próxima de (cx,cy), frente virada para a estrada r
  function nearFree(ctx, LW, LD, cx, cy, maxR, r, filter) {
    let best = null, bd = 1e9;
    for (let y = Math.floor(cy - maxR); y <= cy + maxR; y++) for (let x = Math.floor(cx - maxR); x <= cx + maxR; x++) {
      const d = dist(x, y, cx, cy);
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
  function houseName(ctx) { return 'Casa dos ' + ctx.names[ctx.nameI++ % ctx.names.length]; }

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
    ctx.TP = (x, y) => { // ponto contínuo
      let X = x, Y = y;
      if (tr) { const t = X; X = Y; Y = t; }
      if (fx) X = w - X; if (fy) Y = h - Y;
      return { x: X, y: Y };
    };
    ctx.flipX = fx; ctx.flipY = fy; // espelhamento por eixo do mundo (aplicado após a transposição)
    ctx.orient = { fx, fy, tr };
    const P = ctx.plan = {};
    // colunas (quarteirões a leste da rodovia)
    // quarteirões compridos (frente longa) como nas cidadezinhas americanas
    const nc = rng() < 0.4 ? 1 : 2;
    const HX = rng.int(46, 51);
    const BW = [];
    for (let i = 0; i < nc; i++) BW.push(nc === 1 ? rng.int(66, 80) : rng.int(38, 44));
    const X = [HX];
    let hiPrev = HX + 2; // borda da rodovia (larg. 6)
    for (let i = 0; i < nc; i++) { const lo = hiPrev + 3 + BW[i]; X.push(lo + 2); hiPrev = lo + 3; }
    // linhas
    const nr = rng() < 0.4 ? 3 : 2;
    const LDr = nr === 3 ? rng.int(17, 18) : rng.int(19, 23);
    const mi = nr === 3 ? rng.int(1, 2) : 1;
    const Y = [rng.int(30, 35)];
    const rowAlley = [];
    const widthOf = (k) => (k === mi ? 6 : 4);
    for (let k = 0; k < nr; k++) {
      const alley = k === mi - 1 || k === mi;
      rowAlley.push(alley);
      const hiA = Y[k] - (widthOf(k) >> 1) + widthOf(k) - 1;
      const lo = hiA + 3 + 2 * LDr + (alley ? 3 : 0);
      Y.push(lo + (widthOf(k + 1) >> 1));
    }
    P.nc = nc; P.nr = nr; P.X = X; P.Y = Y; P.mi = mi; P.LDr = LDr; P.BW = BW; P.HX = HX;
    const top = Y[0] - 16, bottom = Y[nr] + 22;
    // rodovia
    ctx.hwyTown = seg(ctx, HX, top, HX, bottom, 'hwy', { dep: [22, 18] });
    ctx.hwyN = seg(ctx, HX, 0, HX, top, 'rural', { dep: [20, 20] });
    ctx.hwyS = seg(ctx, HX, bottom, HX, h - 1, 'rural', { dep: [20, 20] });
    const Xe = X[nc];
    // ruas horizontais
    const dropNE = nc >= 2 && rng() < 0.3;
    for (let k = 0; k <= nr; k++) {
      const kind = k === mi ? 'main' : 'res';
      const depN = k === 0 ? 20 : (rowAlley[k - 1] ? LDr : LDr);
      const depS = k === nr ? 20 : LDr;
      let x1 = Xe;
      if (k === 0 && dropNE) x1 = X[nc - 1];
      const r = seg(ctx, HX, Y[k], x1, Y[k], kind, { dep: [depN, depS], row: k });
      if (k === mi) ctx.mainSt = r;
    }
    // rua principal continua a leste como estrada rural
    seg(ctx, Xe, Y[mi], w - 1, Y[mi], 'rural', { dep: [20, 20] });
    // ruas verticais
    for (let i = 1; i <= nc; i++) {
      let y0 = Y[0];
      if (i === nc && dropNE) { y0 = Y[0] + 5; ctx.bulbs.push(ctx.TP(X[i], y0)); }
      seg(ctx, X[i], y0, X[i], Y[nr], 'res', { dep: [18, i === nc ? 20 : 18], col: i });
    }
    // becos no meio dos quarteirões das linhas do centro
    const downCols = 1;
    for (let k = 0; k < nr; k++) {
      if (!rowAlley[k]) continue;
      const hiA = Y[k] - (widthOf(k) >> 1) + widthOf(k) - 1;
      const ay = hiA + 2 + LDr + 1;
      seg(ctx, HX + 3, ay, Xe - 2, ay, 'alley', { gravel: false, row: k });
    }
    const riverOn = rng() < 0.45 && Y[nr] + 30 <= h - 22; // só abaixo da grade
    const riverY = riverOn ? rng.int(Math.max(h - 32, Y[nr] + 30), h - 22) : -1;
    P.riverY = riverY;
    // ruas sem saída (bairro novo) ao sul e a leste
    const culs = [];
    for (let i = 0; i < nc && culs.length < 2; i++) {
      if (rng() < (nc === 1 ? 0.9 : 0.6)) {
        const xm = (X[i] + X[i + 1]) >> 1, L = rng.int(26, 34);
        if (Y[nr] + L < h - 18 && (riverY < 0 || Y[nr] + L < riverY - 12)) { const r = seg(ctx, xm, Y[nr], xm, Y[nr] + L, 'res', { culdesac: true, dep: [20, 20] }); ctx.bulbs.push(ctx.TP(xm, Y[nr] + L)); culs.push(r); }
      }
    }
    if (Xe + 34 < w - 10 && rng() < 0.5) {
      const k = rng.int(0, nr - 1), ym = (Y[k] + Y[k + 1]) >> 1;
      if (!rowAlley[k]) { seg(ctx, Xe, ym, Xe + 28, ym, 'res', { culdesac: true, dep: [20, 20] }); ctx.bulbs.push(ctx.TP(Xe + 28, ym)); }
    }
    // estrada de madeireiros ao norte
    if (rng() < 0.6) { const Xl = X[rng.int(1, nc)]; seg(ctx, Xl, 2, Xl, Y[0] - 3, 'dirt'); }
    // periferia oeste: fazenda, lago; opcionais
    const farmMaxY = riverOn ? riverY - 12 : h - 16;
    const FY = U.clamp(Y[nr] + rng.int(4, 14), Y[mi] + 10, farmMaxY - 18);
    ctx.farmRoad = seg(ctx, 5, FY, HX - 4, FY, 'dirt');
    // bairro a oeste da rodovia: rua sem saída entre o lago e a fazenda
    const lakeY = U.clamp(Y[0] + rng.int(4, 14), 22, FY - 24);
    const wy = ((lakeY + 16) + (FY - 26)) >> 1;
    if (rng() < 0.8 && FY - 26 - (lakeY + 16) >= 8) {
      const L = rng.int(24, Math.min(34, HX - 14));
      seg(ctx, HX, wy, HX - L, wy, 'res', { culdesac: true, dep: [20, 20] });
      ctx.bulbs.push(ctx.TP(HX - L, wy));
    }
    ctx.farmC = ctx.T(16, FY);
    ctx.lakeOn = !riverOn || rng() < 0.4;
    ctx.lakeC = ctx.T(Math.floor(HX / 2) - 2 + rng.int(-2, 2), lakeY);
    // ferrovia no extremo sul (opcional), cruzando a rodovia em nível
    P.railY = rng() < 0.45 ? h - rng.int(10, 12) : -1;
    ctx.center = ctx.T(HX + (downCols === 2 ? BW[0] + 4 : (BW[0] >> 1) + 4), Y[mi]);
    { const a = ctx.T(HX, Y[0]), b = ctx.T(Xe, Y[nr]); ctx.gridBox = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }; }
    ctx.townC = ctx.T((HX + Xe) >> 1, (Y[0] + Y[nr]) >> 1);
    ctx.churchTarget = ctx.T(HX + 14, Y[nr] + 24);
    // quarteirões (retângulos internos canônicos) e usos especiais
    const blocks = [];
    let xl = HX + 2;
    for (let i = 0; i < nc; i++) {
      const x0 = xl + 2; // interior do quarteirão: [hi+2, lo-2]
      for (let k = 0; k < nr; k++) {
        const hiA = Y[k] - (widthOf(k) >> 1) + widthOf(k) - 1, loB = Y[k + 1] - (widthOf(k + 1) >> 1);
        blocks.push({ i, k, x0, x1: X[i + 1] - 2 - 2, y0: hiA + 2, y1: loB - 2, down: i < downCols && rowAlley[k] });
      }
      xl = X[i + 1] + 1;
    }
    P.blocks = blocks;
    const free = blocks.filter((b) => !b.down && !rowAlley[b.k]);
    const near = blocks.filter((b) => !b.down);
    ctx.blockUses = [];
    if (near.length && rng() < 0.55) { // praça junto ao centro
      sortBy(near, (b) => Math.abs(b.i - downCols) * 2 + Math.abs(b.k - mi) + rng() * 0.5);
      const b = near[0]; b.use = 'square'; ctx.blockUses.push(b);
    }
    const free2 = free.filter((b) => !b.use);
    if (free2.length && rng() < 0.6) { const b = free2[Math.floor(rng() * free2.length)]; b.use = 'school'; ctx.blockUses.push(b); }
    ctx.downtown = (t, r) => { // tile ao longo da rua r está no centro?
      const p = roadCell(r, t, 0);
      return dist(p.x, p.y, ctx.center.x, ctx.center.y) < (downCols === 2 ? 34 : 26);
    };
    ctx.downR = downCols === 2 ? 36 : 28;
  }

  // Rio serpenteando de oeste a leste (canônico) com margens de areia; pontes onde as estradas cruzam
  function river(ctx) {
    const y0 = ctx.plan.riverY;
    if (y0 < 0) return;
    const m = ctx.m, w = m.w, rng = ctx.rng;
    const width = rng.int(4, 5);
    let yc = y0;
    for (let x = 0; x < w; x++) {
      yc += (U.noise2(x * 0.08, 3.3, ctx.seed + 17) - 0.5) * 1.2;
      yc = U.clamp(yc, y0 - 5, y0 + 5);
      const yi = Math.round(yc);
      for (let dy = -2; dy < width + 2; dy++) {
        const p = ctx.T(x, yi + dy);
        if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= m.h) continue;
        const i = p.y * w + p.x;
        const water = dy >= 0 && dy < width;
        if (ctx.res[i] === 1) { if (water) ctx.bridgeCells.push(i); continue; } // estrada: vira ponte
        if (ctx.res[i] === 5) { if (water) m.floor[i] = F.DOCK; continue; }      // estrada de terra: pontilhão
        m.floor[i] = water ? F.WATER : F.SAND;
        ctx.res[i] = water ? 3 : 6;
      }
    }
    // pontes: agrupa células por retângulo
    const seen = new Set();
    for (const i of ctx.bridgeCells) {
      if (seen.has(i)) continue;
      let x0 = i % w, y0b = (i / w) | 0, x1 = x0, y1 = y0b;
      for (const j of ctx.bridgeCells) { const x = j % w, y = (j / w) | 0; if (Math.abs(x - x0) <= 8 && Math.abs(y - y0b) <= 8) { seen.add(j); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0b = Math.min(y0b, y); y1 = Math.max(y1, y); } }
      m.bridges.push({ x: x0, y: y0b, w: x1 - x0 + 1, h: y1 - y0b + 1 });
    }
  }

  // Ferrovia: leito de cascalho de 3 tiles, trilhos como marca 'rail'; cruza estradas em nível
  function railway(ctx) {
    const ry = ctx.plan.railY;
    if (ry < 0) return;
    const m = ctx.m, w = m.w;
    const a = ctx.TP(0, ry + 1.5), b = ctx.TP(w, ry + 1.5);
    m.roadMarks.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, type: 'rail' });
    for (let x = 0; x < w; x++) for (let dy = 0; dy < 3; dy++) {
      const p = ctx.T(x, ry + dy);
      const i = p.y * w + p.x;
      if (ctx.res[i] === 1 || ctx.res[i] === 5) continue;
      m.floor[i] = F.GRAVEL; ctx.res[i] = 8;
    }
    ctx.rail = { y: ry };
  }

  // Direção canônica -> face no mundo
  function worldFace(ctx, cf) {
    const v = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }[cf];
    const a = ctx.TP(50, 50), b = ctx.TP(50 + v[0], 50 + v[1]);
    const dx = Math.round(b.x - a.x), dy = Math.round(b.y - a.y);
    return dx > 0 ? 'E' : dx < 0 ? 'W' : dy > 0 ? 'S' : 'N';
  }
  // Retângulo canônico -> lote no mundo (com dimensões do plano conforme a face)
  function canonLot(ctx, x0, y0, x1, y1, cface) {
    const a = ctx.T(x0, y0), b = ctx.T(x1, y1);
    const R = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1, face: worldFace(ctx, cface) };
    const vert = R.face === 'S' || R.face === 'N';
    R.LW = vert ? R.w : R.h; R.LD = vert ? R.h : R.w;
    return R;
  }
  function blockLots(ctx) {
    for (const b of ctx.blockUses) {
      const R = canonLot(ctx, b.x0, b.y0, b.x1, b.y1, 'S');
      if (!rectFree(ctx, R, 2)) continue;
      if (b.use === 'square') buildLot(ctx, R, R.LW, R.LD, genSquare, { name: 'Praça da Matriz' }, 'square');
      else if (b.use === 'school' && R.LW >= 30 && R.LD >= 28) buildLot(ctx, R, R.LW, R.LD, genSchool, { name: 'Escola Municipal Vale Quieto' }, 'school');
    }
  }

  function alleyBehind(ctx, R) {
    const m = ctx.m, cx = Math.floor(R.x + R.w / 2), cy = Math.floor(R.y + R.h / 2);
    const p = R.face === 'S' ? [cx, R.y - 1] : R.face === 'N' ? [cx, R.y + R.h] : R.face === 'E' ? [R.x - 1, cy] : [R.x + R.w, cy];
    if (p[0] < 0 || p[1] < 0 || p[0] >= m.w || p[1] >= m.h) return false;
    return ctx.alleyMask[p[1] * m.w + p[0]] === 1;
  }
  function placeSpecials(ctx) {
    const rng = ctx.rng, C0 = ctx.center;
    let chosen = SPECIAL_POOL.filter((S) => S.need || rng() < S.p);
    // cidade maior comporta mais comércio
    const maxOpt = 4 + (ctx.plan.nr - 2) * 2 + (rng() < 0.5 ? 1 : 0);
    let nOpt = 0;
    chosen = chosen.filter((S) => S.need || S.key === 'pharmacy' || S.key === 'diner' || nOpt++ < maxOpt);
    if (!chosen.some((S) => S.key === 'pharmacy' || S.key === 'clinic')) chosen.push(SPECIAL_POOL.find((S) => S.key === 'pharmacy'));
    if (!chosen.some((S) => S.key === 'diner' || S.key === 'bar')) chosen.push(SPECIAL_POOL.find((S) => S.key === 'diner'));
    if (rng() < 0.3) { const k2 = rng() < 0.5 ? 'convenience' : 'diner'; chosen.push(SPECIAL_POOL.find((S) => S.key === k2)); } // repetidos acontecem
    const used = new Set();
    const front = ctx.roads.filter((r) => r.kind === 'main' || r.kind === 'hwy');
    const town = ctx.roads.filter((r) => r.kind === 'main' || r.kind === 'hwy' || r.kind === 'res');
    const rural = ctx.roads.filter((r) => r.kind === 'rural');
    for (const S of chosen) {
      const LW = rng.int(S.lw[0], S.lw[1]);
      let name = S.names[Math.floor(rng() * S.names.length)];
      for (let t = 0; used.has(name) && t < S.names.length; t++) name = S.names[(S.names.indexOf(name) + 1) % S.names.length];
      if (used.has(name)) name += ' II';
      used.add(name);
      const score = (cx, cy, r) => {
        let d = dist(cx, cy, C0.x, C0.y);
        if (S.hwy && r !== ctx.hwyTown) d += 30;
        if (S.edge) return Math.abs(d - 44) + (r.kind === 'hwy' || r.kind === 'rural' ? 0 : 20) + rng() * 2;
        if (r.kind === 'res') d += d > ctx.downR - 4 ? 200 : 8;
        if (d > ctx.downR + (r.kind === 'hwy' ? 18 : 0)) d += 200; // fora do centro: só se não houver outro lugar
        return d + rng() * 2;
      };
      // comércio só de frente para a rua principal/rodovia; obrigatórios podem cair numa transversal
      let R = bestFrontage(ctx, LW, S.ld || 0, score, S.edge ? front.concat(rural) : front, 15);
      if ((!R || dist(R.x + R.w / 2, R.y + R.h / 2, C0.x, C0.y) > ctx.downR + 22) && S.need) R = bestFrontage(ctx, LW, S.ld || 0, score, town, 15) || R;
      if (!R) continue;
      const Rd = dist(R.x + R.w / 2, R.y + R.h / 2, C0.x, C0.y);
      if (!S.need && !S.edge && Rd > ctx.downR + 22) continue; // centro lotado: não invade o bairro
      const o = Object.assign({ name, alley: alleyBehind(ctx, R) }, S.o || {});
      buildLot(ctx, R, LW, R.ld, S.gen, o, 'commercial');
    }
    // igreja + cemitério (fora da grade de quarteirões)
    const T = ctx.churchTarget, gb = ctx.gridBox;
    const inGrid = (cx, cy) => cx > gb.x0 && cx < gb.x1 && cy > gb.y0 && cy < gb.y1 ? 80 : 0;
    const R = bestFrontage(ctx, 15, 22, (cx, cy) => dist(cx, cy, T.x, T.y) + inGrid(cx, cy) + rng() * 2, null, 20);
    if (R) {
      buildLot(ctx, R, 15, 22, genChurch, { name: rng.pick(['Igreja Batista de Vale Quieto', 'Igreja Metodista do Vale', 'Capela de São José']) }, 'church');
      const Rc = bestFrontage(ctx, 20, 20, (cx, cy) => dist(cx, cy, R.x + R.w / 2, R.y + R.h / 2) + inGrid(cx, cy) + rng(), null, 20);
      if (Rc) buildLot(ctx, Rc, 20, 20, genCemetery, { name: 'Cemitério' }, 'cemetery');
    }
  }
  // Periferia: motel e parque de trailers à beira da rodovia
  function periphery(ctx) {
    const rng = ctx.rng;
    const hw = [ctx.hwyN, ctx.hwyS, ctx.hwyTown];
    const C0 = ctx.center;
    if (rng() < 0.5) {
      const LW = rng.int(34, 38);
      const R = bestFrontage(ctx, LW, 20, (cx, cy) => Math.abs(dist(cx, cy, C0.x, C0.y) - 70) + rng() * 3, [ctx.hwyN, ctx.hwyS], 18);
      if (R) buildLot(ctx, R, LW, 20, genMotel, { name: rng.pick(['Motel Pôr do Sol', 'Motel Estrada Velha', 'Pousada do Viajante']) }, 'motel');
    }
    if (rng() < 0.55) {
      const LW = rng.int(36, 40), LD = rng.int(30, 38);
      const o = { name: 'Parque de Trailers Pinheiros', names: ctx.names, nameI: ctx.nameI };
      const R = bestFrontage(ctx, LW, LD, (cx, cy) => Math.abs(dist(cx, cy, C0.x, C0.y) - 55) + rng() * 3, hw, 20);
      if (R && buildLot(ctx, R, LW, LD, genTrailerPark, o, 'trailer_park')) ctx.nameI += o.used || 0;
    }
  }

  // Casas: para cada lado de rua, acha trechos contínuos de frente livre e divide em lotes de 16–24
  function placeHouses(ctx) {
    const rng = ctx.rng, m = ctx.m;
    // ordem: ruas que dão frente aos quarteirões, ruas sem saída, depois o resto (pontas de quarteirão, rodovia, rurais)
    const pri = (r) => (r.row != null ? 0 : r.culdesac ? 1 : r.kind === 'hwy' ? 2 : r.kind === 'res' ? 3 : 4);
    const order = sortBy(ctx.roads.slice(), (r, i) => pri(r) * 1000 + i);
    for (const r of order) {
      if (r.kind === 'dirt' || r.kind === 'alley') continue;
      const rural = r.kind === 'rural';
      for (const si of [0, 1]) {
        const side = si ? 1 : -1;
        const LD = rural ? 22 : r.dep[si];
        if (LD < 17) continue;
        // coluna t livre? (faixa de 1 de largura, LD de fundo)
        const colFree = (t) => {
          if (r.kind === 'main' && ctx.downtown(t, r)) return false;
          const R = lotRect(r, side, t, 1, LD);
          return rectFree(ctx, R);
        };
        let t = r.a0;
        while (t <= r.a1) {
          if (!colFree(t)) { t++; continue; }
          let t1 = t;
          while (t1 + 1 <= r.a1 && colFree(t1 + 1)) t1++;
          const L = t1 - t + 1;
          const runStart = t;
          t = t1 + 1;
          if (L < 16) continue;
          if (rural && rng() < 0.7) continue; // estrada rural: casas esparsas
          let n = Math.max(1, Math.floor(L / (rng() < 0.5 ? 18 : 20)));
          while (n > 1 && Math.floor(L / n) < 16) n--;
          const base = Math.min(26, Math.floor(L / n));
          const extra = L - base * n; // sobra vira folga entre os lotes
          let p = runStart + (rng() < 0.5 ? 0 : Math.min(extra, 2));
          for (let i = 0; i < n; i++) {
            if (rng() < 0.06 && n > 1) { p += base; continue; } // terreno baldio
            const R = lotRect(r, side, p, base, LD);
            if (rectFree(ctx, R)) buildLot(ctx, R, base, LD, genHouse, { name: houseName(ctx) }, 'house');
            p += base + (extra > n ? 1 : 0);
          }
        }
      }
    }
  }

  // ---- Lago com praia, juncos, píer e trilha ----
  const DIR8 = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]];
  function lake(ctx) {
    if (!ctx.lakeOn) return;
    const m = ctx.m, w = m.w, rng = ctx.rng;
    const c = ctx.lakeC, rx = rng.int(8, 11), ry = rng.int(7, 10);
    const dv = DIR8[rng.int(0, 7)], lobe = { x: c.x + dv[0] * rx * 0.75, y: c.y + dv[1] * ry * 0.75 };
    const cells = [];
    for (let y = Math.floor(c.y - ry * 1.9 - 4); y <= c.y + ry * 1.9 + 4; y++) for (let x = Math.floor(c.x - rx * 1.9 - 4); x <= c.x + rx * 1.9 + 4; x++) {
      if (x < 3 || y < 3 || x >= w - 3 || y >= m.h - 3) continue;
      const i = y * w + x;
      if (ctx.res[i]) continue;
      const ax = (x - c.x) / rx, ay = (y - c.y) / ry, bx = (x - lobe.x) / (rx * 0.62), by = (y - lobe.y) / (ry * 0.55);
      const d = Math.min(ax * ax + ay * ay, bx * bx + by * by) + (U.noise2(x * 0.2, y * 0.2, ctx.seed) - 0.5) * 0.9 + (U.noise2(x * 0.5, y * 0.5, ctx.seed + 3) - 0.5) * 0.25;
      if (d < 1) { m.floor[i] = F.WATER; ctx.res[i] = 3; cells.push(i); }
      else if (d < 1.3) { m.floor[i] = F.SAND; ctx.res[i] = 3; }
      else if (d < 1.9) ctx.res[i] = 6;
    }
    const hw = ctx.hwyTown;
    let best = null, bd = 1e9;
    for (const i of cells) {
      const x = i % w, y = (i / w) | 0;
      const d = hw.h ? Math.abs(y - hw.c) : Math.abs(x - hw.c);
      const edge = m.floor[i - 1] !== F.WATER || m.floor[i + 1] !== F.WATER || m.floor[i - w] !== F.WATER || m.floor[i + w] !== F.WATER;
      if (edge && d < bd) { bd = d; best = { x, y }; }
    }
    ctx.lakeInfo = { c, rx, ry, shore: best };
    if (!best) return;
    const ax = Math.abs(c.x - best.x) > Math.abs(c.y - best.y) ? Math.sign(c.x - best.x) : 0, ay = ax ? 0 : Math.sign(c.y - best.y);
    for (let s = 0; s < 5; s++) for (let o = 0; o < 2; o++) { // píer de 2 de largura sobre a água
      const x = best.x + ax * s + (ay ? o : 0), y = best.y + ay * s + (ax ? o : 0), i = y * w + x;
      if (m.floor[i] === F.WATER || m.floor[i] === F.SAND) { m.floor[i] = F.DOCK; ctx.res[i] = 3; }
    }
    const sx = best.x - ax * 2, sy = best.y - ay * 2;
    trail(ctx, sx, sy, hw.h ? sx : hw.lo - 2 + (sx < hw.c ? 0 : hw.w + 3), hw.h ? hw.lo - 2 + (sy < hw.c ? 0 : hw.w + 3) : sy, 2);
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < w - 1; x++) { // juncos e pedras
      const i = y * w + x;
      if (m.floor[i] !== F.SAND || m.objAt[i] >= 0 || ctx.res[i] !== 3) continue;
      const wet = m.floor[i - 1] === F.WATER || m.floor[i + 1] === F.WATER || m.floor[i - w] === F.WATER || m.floor[i + w] === F.WATER;
      const r = rng();
      if (wet && r < 0.14) addObject(ctx, 'bush', x, y, 1, 1, 0, { outdoor: true, variant: 7 });
      else if (!wet && r < 0.04) addObject(ctx, 'rock', x, y, 1, 1, 0, { outdoor: true });
    }
    const around = [];
    for (let y = sy - 6; y <= sy + 6; y++) for (let x = sx - 6; x <= sx + 6; x++) {
      if (x < 2 || y < 2 || x >= w - 2 || y >= m.h - 2) continue;
      const f = m.floor[y * w + x], rr = ctx.res[y * w + x];
      if ((f === F.GRASS && !rr) || (f === F.SAND && rr === 3)) around.push({ x, y });
    }
    shuffle(around, rng);
    for (const [t, ow, oh] of [['picnic_table', 2, 1], ['picnic_table', 2, 1], ['bench', 2, 1], ['log_pile', 2, 1], ['grill', 1, 1], ['trash_can', 1, 1]]) {
      for (const p of around) {
        if (Math.abs(p.x - sx) + Math.abs(p.y - sy) < 2) continue;
        let bad = false;
        for (let j = p.y; j < p.y + oh; j++) for (let i = p.x; i < p.x + ow; i++) { const f = m.floor[j * w + i]; if (f === F.WATER || f === F.DOCK || f === F.DIRT) bad = true; }
        if (bad) continue;
        const o = addObject(ctx, t, p.x, p.y, ow, oh, rng() < 0.5 ? 1 : 3, { outdoor: true });
        if (o) { for (let j = o.y - 1; j <= o.y + o.h; j++) for (let i = o.x - 1; i <= o.x + o.w; i++) if (!ctx.res[j * w + i]) ctx.res[j * w + i] = 6; break; }
      }
    }
  }

  // Trilha de terra entre dois pontos (caminho em L ondulado)
  function trail(ctx, x0, y0, x1, y1, width) {
    const m = ctx.m, w = m.w, rng = ctx.rng;
    let x = x0, y = y0, guard = 0;
    const horizMain = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
    const paint = (px, py) => {
      for (let o = 0; o < (width || 1); o++) {
        const qx = px + (o && !horizMain ? 1 : 0), qy = py + (o && horizMain ? 1 : 0);
        if (qx < 1 || qy < 1 || qx >= w - 1 || qy >= m.h - 1) continue;
        const i = qy * w + qx, f = m.floor[i], r = ctx.res[i];
        if (f === F.WATER || f === F.ASPHALT || f === F.SIDEWALK || f === F.DOCK || m.wall[i] || m.building[i] || r === 1 || r === 2 || r === 8) continue;
        if (m.objAt[i] >= 0) continue;
        m.floor[i] = rng() < 0.85 ? F.DIRT : F.GRAVEL;
        if (!r || r === 6) ctx.res[i] = 4;
      }
    };
    while ((x !== x1 || y !== y1) && guard++ < 800) {
      paint(x, y);
      const dx = Math.sign(x1 - x), dy = Math.sign(y1 - y);
      if (dx && dy) { if (rng() * (Math.abs(x1 - x) + Math.abs(y1 - y)) < Math.abs(x1 - x)) x += dx; else y += dy; }
      else if (dx) { x += dx; if (rng() < 0.12 && y > 3 && y < m.h - 4) y += rng() < 0.5 ? 1 : -1; }
      else { y += dy; if (rng() < 0.12 && x > 3 && x < w - 4) x += rng() < 0.5 ? 1 : -1; }
    }
    paint(x1, y1);
  }
  // Ponto de estrada (asfalto/terra) mais próximo
  function nearestRoadPoint(ctx, x, y, kinds) {
    let best = null, bd = 1e9;
    for (const r of ctx.roads) {
      if (kinds && !kinds.includes(r.kind)) continue;
      const t = U.clamp(r.h ? x : y, r.a0, r.a1);
      const edgeC = r.h ? (y < r.c ? r.lo - 1 - r.edge : r.hi + 1 + r.edge) : (x < r.c ? r.lo - 1 - r.edge : r.hi + 1 + r.edge);
      const p = r.h ? { x: t, y: edgeC } : { x: edgeC, y: t };
      const d = dist(p.x, p.y, x, y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---- Fazenda ----
  function farm(ctx) {
    const r = ctx.farmRoad;
    if (!r) return;
    const rng = ctx.rng;
    ctx.allowDirt = true;
    const Fc = ctx.farmC;
    const near = (cx, cy) => dist(cx, cy, Fc.x, Fc.y) + rng();
    let R = bestFrontage(ctx, 20, 20, near, [r]);
    if (R) buildLot(ctx, R, 20, 20, genHouse, { name: 'Fazenda ' + ctx.names[ctx.nameI++ % ctx.names.length], type: 'house', noGarage: true, size: 'medium' }, 'farm');
    R = bestFrontage(ctx, 16, 15, near, [r]);
    if (R) buildLot(ctx, R, 16, 15, genBarn, { name: 'Celeiro' }, 'farm');
    const hw = ctx.hwyTown, side = Math.sign((hw.h ? Fc.y : Fc.x) - hw.c);
    const sameSide = (Q) => Math.sign((hw.h ? Q.y + Q.h / 2 : Q.x + Q.w / 2) - hw.c) === side;
    for (let i = 0; i < 3; i++) {
      const fw = rng.int(12, 18), fd = rng.int(9, 14);
      R = bestFrontage(ctx, fw, fd, near, [r]) || nearFree(ctx, fw, fd, Fc.x, Fc.y, 40, r, sameSide);
      if (R) buildLot(ctx, R, fw, fd, genField, { name: 'Plantação' }, 'field');
    }
    ctx.allowDirt = false;
  }

  // ---- Cercas de divisa (sem duplicar entre vizinhos) ----
  function fencePass(ctx) {
    const m = ctx.m, w = m.w;
    for (const lot of ctx.lots) {
      if (!lot.fence) continue;
      const inLot = (x, y) => x >= lot.x && y >= lot.y && x < lot.x + lot.w && y < lot.y + lot.h;
      for (const s of lot.fence.segs) {
        const dx = Math.sign(s.b.x - s.a.x), dy = Math.sign(s.b.y - s.a.y);
        const px = dy !== 0 ? 1 : 0, py = dx !== 0 ? 1 : 0;
        let x = s.a.x, y = s.a.y;
        for (let guard = 0; guard < 200; guard++) {
          const i = y * w + x;
          let skip = m.wall[i] || m.building[i] || m.objAt[i] >= 0 || ctx.keep[i] || m.floor[i] === F.POOL || m.floor[i] === F.WATER;
          for (const sg of [-1, 1]) {
            const nx = x + px * sg, ny = y + py * sg;
            if (nx < 0 || ny < 0 || nx >= w || ny >= m.h || inLot(nx, ny)) continue;
            if (isFenceLike(m.wall[ny * w + nx])) skip = true; // o vizinho já tem cerca nessa divisa
          }
          if (!skip) { m.wall[i] = lot.fence.type; m.wallHp[i] = baseHp(lot.fence.type); m.wallState[i] = 0; }
          if (x === s.b.x && y === s.b.y) break;
          x += dx; y += dy;
        }
      }
    }
  }

  // ---- Limpeza: nada de cerca/objeto colado na frente de portas e janelas ----
  function cleanup(ctx) {
    const m = ctx.m, w = m.w, kill = new Set();
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, wv = m.wall[i];
      if (!isDoorW(wv) && !isWinW(wv)) continue;
      for (let d = 0; d < 2; d++) {
        const ia = (y + DY[d]) * w + x + DX[d], ib = (y - DY[d]) * w + x - DX[d];
        const sameB = (j) => m.wall[j] && m.building[j] === m.building[i];
        if (sameB(ia) || sameB(ib)) continue;
        for (const j of [ia, ib]) {
          if (isFenceLike(m.wall[j]) && !m.building[j]) { m.wall[j] = 0; m.wallState[j] = 0; m.wallHp[j] = 0; }
          const o = m.objAt[j];
          if (o >= 0 && isDoorW(wv) && m.objects[o].blocksMove) kill.add(o);
        }
      }
    }
    if (kill.size) purgeObjects(m, kill);
  }

  // ---- Bolsões: remove objetos externos que isolam áreas ----
  function passFlood(m, i) {
    const f = m.floor[i];
    if (f === F.WATER || f === F.POOL) return false;
    const o = m.objAt[i];
    if (o >= 0 && m.objects[o].blocksMove) return false;
    const wv = m.wall[i];
    return !wv || isDoorW(wv) || isGateW(wv);
  }
  function floodFrom(m, start, seen, q) {
    let h = 0, t = 0;
    seen.fill(0);
    seen[start] = 1; q[t++] = start;
    while (h < t) {
      const i = q[h++], x = i % m.w, y = (i / m.w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
        const j = ny * m.w + nx;
        if (!seen[j] && passFlood(m, j)) { seen[j] = 1; q[t++] = j; }
      }
    }
  }
  function fixPockets(ctx) {
    const m = ctx.m, w = m.w, n = w * m.h;
    const seen = new Uint8Array(n), q = new Int32Array(n);
    const hw = ctx.hwyTown, s0 = roadCell(hw, (hw.a0 + hw.a1) >> 1, 1);
    for (let iter = 0; iter < 10; iter++) {
      floodFrom(m, s0.y * w + s0.x, seen, q);
      const kill = new Set();
      for (let i = 0; i < n; i++) {
        if (seen[i] || !passFlood(m, i)) continue;
        const x = i % w, y = (i / w) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= m.h) continue;
          const oi = m.objAt[ny * w + nx];
          if (oi < 0) continue;
          const o = m.objects[oi];
          if (!o.blocksMove || o.building || m.building[ny * w + nx]) continue;
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

  // ---- Detalhes de rua: postes, carros estacionados/abandonados, engavetamento, batida ----
  function streetDetails(ctx) {
    const m = ctx.m, w = m.w, rng = ctx.rng, cnt = ctx.roadCnt;
    const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < m.h;
    for (const r of ctx.roads) {
      if (!sidewalked(r)) continue;
      for (const o of [-1, r.w]) {
        for (let t = r.a0 + (o < 0 ? 4 : 10); t <= r.a1; t += 12) {
          let placed = false;
          for (let dt = 0; dt < 3 && !placed; dt++) {
            const p = roadCell(r, t + dt, o);
            if (!inb(p.x, p.y)) continue;
            const i = p.y * w + p.x;
            if (m.floor[i] !== F.SIDEWALK || m.objAt[i] >= 0) continue;
            const q = roadCell(r, t + dt, o < 0 ? -2 : r.w + 1);
            if (inb(q.x, q.y) && (ctx.keep[q.y * w + q.x] || m.wall[q.y * w + q.x] || m.floor[q.y * w + q.x] === F.ASPHALT)) continue;
            placed = !!addObject(ctx, 'lamp_post', p.x, p.y, 1, 1, r.h ? (o < 0 ? 1 : 3) : (o < 0 ? 0 : 2));
          }
        }
      }
    }
    // máscara de faixas livres numa seção transversal
    const V = { x: 0, y: 0, w: 0, h: 0 };
    function freeMask(r, t) {
      let mask = 0;
      for (let o = 0; o < r.w; o++) {
        const p = roadCell(r, t, o);
        if (!inb(p.x, p.y)) continue;
        const i = p.y * w + p.x;
        const inV = p.x >= V.x && p.x < V.x + V.w && p.y >= V.y && p.y < V.y + V.h;
        const oi = m.objAt[i];
        if (!inV && (oi < 0 || !m.objects[oi].blocksMove)) mask |= 1 << o;
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
      for (let t = t0 - 3; t <= t1 + 3; t++) for (let o = 0; o < r.w; o++) {
        const p = roadCell(r, t, o);
        if (!inb(p.x, p.y) || cnt[p.y * w + p.x] !== 1) return false;
      }
      return true;
    }
    // carro na via: faixa o (0..w-2, 2 de largura), crossed = atravessado (só em vias de 6)
    function roadCar(r, t, o, crossed, type) {
      const d = ODEF[type || 'car'];
      let x, y, cw, ch, rot;
      if (!crossed) {
        const p = roadCell(r, t, o); x = p.x; y = p.y;
        cw = r.h ? d.d : d.a; ch = r.h ? d.a : d.d;
        const fwd = o >= r.w / 2; // mão direita
        rot = r.h ? (fwd ? 0 : 2) : (fwd ? 3 : 1);
        if (rng() < 0.12) rot = (rot + 2) & 3;
      } else {
        if (r.w < 6) return null;
        const p = roadCell(r, t, U.clamp(o, 0, r.w - d.d)); x = p.x; y = p.y;
        cw = r.h ? d.a : d.d; ch = r.h ? d.d : d.a;
        rot = r.h ? (rng() < 0.5 ? 1 : 3) : (rng() < 0.5 ? 0 : 2);
      }
      V.x = x; V.y = y; V.w = cw; V.h = ch;
      const ok = passable(r, t, t + (r.h ? cw : ch) - 1);
      V.w = 0; V.h = 0;
      if (!ok) return null;
      return addObject(ctx, type || 'car', x, y, cw, ch, rot, { outdoor: true });
    }
    const C0 = ctx.center;
    for (const r of ctx.roads) {
      if (r.kind === 'dirt' || r.kind === 'alley') continue;
      for (let t = r.a0 + 2; t < r.a1 - 5; t += 5) {
        if (!simple(r, t, t + 4)) continue;
        const p = roadCell(r, t, 0);
        const near = dist(p.x, p.y, C0.x, C0.y) < ctx.downR + 6;
        const pPark = r.kind === 'rural' ? 0 : near ? 0.3 : 0.12;
        for (const o of [0, r.w - 2]) if (rng() < pPark) roadCar(r, t, o, false, rng() < 0.2 ? 'pickup' : 'car');
        const pAb = r.kind === 'rural' ? 0.02 : 0.03;
        if (rng() < pAb) {
          const car = roadCar(r, t, rng.int(0, r.w - 2), rng() < 0.35, rng() < 0.25 ? 'pickup' : 'car');
          if (car && rng() < 0.5) ctx.decals.push({ x: car.x + car.w / 2, y: car.y + car.h / 2, type: 'glass', size: 0.6, rot: rng() * 6.28, alpha: 0.8, t: 0 });
          if (car && rng() < 0.3) ctx.decals.push({ x: car.x + rng() * car.w, y: car.y + rng() * car.h, type: 'bloodpool', size: 0.8 + rng() * 0.6, rot: rng() * 6.28, alpha: 0.9, t: 0 });
        }
      }
    }
    // engavetamento + barreira na saída pela rodovia
    const rural = [ctx.hwyN, ctx.hwyS].filter((r) => r.a1 - r.a0 > 34);
    if (rural.length) {
      sortBy(rural, (r) => -(r.a1 - r.a0) + rng() * 20);
      const r = rural[0];
      const toTown = r === ctx.hwyN ? r.a1 : r.a0, dir = r === ctx.hwyN ? -1 : 1;
      const base = toTown + dir * 6;
      let placed = 0;
      for (let k = 0; k < 60 && placed < 12; k++) {
        const t = base + dir * rng.int(0, 26);
        const type = placed === 2 ? 'police_car' : placed === 5 ? 'ambulance' : placed === 8 ? 'police_car' : rng() < 0.3 ? 'pickup' : 'car';
        if (roadCar(r, t, rng.int(0, r.w - 2), rng() < 0.4, type)) placed++;
      }
      const tb = base + dir * 30;
      for (let o = 0; o < r.w; o++) if (o !== 2 && o !== 3 && rng() < 0.85) { const p = roadCell(r, tb, o); if (inb(p.x, p.y)) addObject(ctx, 'barrel', p.x, p.y, 1, 1, 0, { outdoor: true }); }
      const pc = roadCell(r, base + dir * 13, 2);
      ctx.jam = { x: pc.x + 0.5, y: pc.y + 0.5 };
      for (let i = 0; i < 7; i++) ctx.decals.push({ x: pc.x + (rng() - 0.5) * 12, y: pc.y + (rng() - 0.5) * 12, type: rng() < 0.6 ? 'blood' : 'bloodpool', size: 0.5 + rng(), rot: rng() * 6.28, alpha: 0.85, t: 0 });
    }
    // batida num cruzamento do centro
    const cross = [];
    for (let i = 0; i < w * m.h; i++) if (cnt[i] >= 2 && m.floor[i] === F.ASPHALT && ctx.res[i] === 1) cross.push({ i });
    sortBy(cross, (c) => dist(c.i % w, (c.i / w) | 0, C0.x, C0.y) + rng() * 30);
    if (cross.length) {
      const i = cross[0].i, x = i % w, y = (i / w) | 0;
      const a = addCar(ctx, 'car', x - 1, y, rng() < 0.5 ? 0 : 2, { outdoor: true });
      const b = addCar(ctx, rng() < 0.5 ? 'pickup' : 'car', x + 2, y + 1, rng() < 0.5 ? 1 : 3, { outdoor: true });
      if (a || b) {
        for (let k = 0; k < 4; k++) ctx.decals.push({ x: x + 1 + (rng() - 0.5) * 4, y: y + 1 + (rng() - 0.5) * 4, type: 'glass', size: 0.5 + rng() * 0.5, rot: rng() * 6.28, alpha: 0.9, t: 0 });
        ctx.decals.push({ x: x + 0.5, y: y + 2.5, type: 'bloodpool', size: 1.1, rot: rng() * 6.28, alpha: 0.9, t: 0 });
      }
    }
    // pneus e barris largados nas estradas rurais
    for (const r of ctx.roads) {
      if (r.kind !== 'rural' && r.kind !== 'dirt') continue;
      for (let t = r.a0; t <= r.a1; t += 7) if (rng() < 0.1) {
        const p = roadCell(r, t, rng() < 0.5 ? -2 : r.w + 1);
        if (inb(p.x, p.y) && !ctx.res[p.y * w + p.x]) addObject(ctx, rng() < 0.5 ? 'tire' : 'barrel', p.x, p.y, 1, 1, 0, { outdoor: true });
      }
    }
  }

  // ---- Pontos de interesse na mata ----
  function freeArea(ctx, x0, y0, w, h, pad) {
    const m = ctx.m;
    if (x0 - pad < 3 || y0 - pad < 3 || x0 + w + pad > m.w - 3 || y0 + h + pad > m.h - 3) return false;
    for (let y = y0 - pad; y < y0 + h + pad; y++) for (let x = x0 - pad; x < x0 + w + pad; x++) {
      const r = ctx.res[y * m.w + x];
      if (r && r !== 6) return false;
    }
    return true;
  }
  // procura um lugar na mata, longe (>= minD) da área urbana, perto de (tx,ty)
  function forestSpot(ctx, w, h, tx, ty, minD, pad) {
    const rng = ctx.rng, m = ctx.m;
    let best = null, bs = 1e9;
    for (let k = 0; k < 400; k++) {
      const x = rng.int(4, m.w - 5 - w), y = rng.int(4, m.h - 5 - h);
      const d = ctx.dist[(y + (h >> 1)) * m.w + x + (w >> 1)];
      if (d < minD) continue;
      const s = dist(x, y, tx, ty) + rng() * 20;
      if (s >= bs || !freeArea(ctx, x, y, w, h, pad)) continue;
      bs = s; best = { x, y };
    }
    return best;
  }
  function clearing(ctx, cx, cy, rad) {
    const m = ctx.m, w = m.w;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      if (x < 1 || y < 1 || x >= w - 1 || y >= m.h - 1) continue;
      const i = y * w + x;
      if (dist(x + 0.5, y + 0.5, cx, cy) > rad || (ctx.res[i] && ctx.res[i] !== 6 && ctx.res[i] !== 4)) continue;
      ctx.res[i] = 7; // clareira: sem árvores
      if (m.floor[i] === F.GRASS || m.floor[i] === F.DARK_GRASS) m.floor[i] = U.hash2(x, y, 5) < 0.35 ? F.DIRT : F.GRASS;
    }
  }
  function linkTrail(ctx, x, y) {
    const p = nearestRoadPoint(ctx, x, y, ['rural', 'dirt', 'hwy', 'res']);
    if (p && dist(p.x, p.y, x, y) < 70) trail(ctx, x, y, p.x, p.y, 1);
  }
  function forestPOIs(ctx) {
    const m = ctx.m, rng = ctx.rng, w = m.w;
    const T = ctx.townC;
    // acampamentos (1–2)
    const nCamp = rng() < 0.5 ? 2 : 1;
    for (let c = 0; c < nCamp; c++) {
      const s = forestSpot(ctx, 7, 7, rng.int(10, w - 10), rng.int(10, m.h - 10), 10, 1);
      if (!s) continue;
      const cx = s.x + 3.5, cy = s.y + 3.5;
      clearing(ctx, cx, cy, 3.6);
      addObject(ctx, 'log_pile', s.x + 1, s.y + 1, 2, 1, 1, { outdoor: true });
      addObject(ctx, 'picnic_table', s.x + 3, s.y + 5, 2, 1, 1, { outdoor: true });
      addObject(ctx, 'barrel', s.x + 5, s.y + 2, 1, 1, 0, { outdoor: true });
      addObject(ctx, 'crate', s.x + 1, s.y + 4, 1, 1, 0, { outdoor: true, loot: 'camp' });
      if (rng() < 0.5) addObject(ctx, 'grill', s.x + 4, s.y + 3, 1, 1, 0, { outdoor: true, loot: 'camp' });
      ctx.hot.push({ x: cx, y: cy, weight: 0.6, n: 2, kind: 'camp' });
      linkTrail(ctx, s.x + 3, s.y + 6);
      ctx.pois.push({ type: 'camp', x: cx, y: cy });
    }
    // cabana de caça
    if (rng() < 0.7) {
      const s = forestSpot(ctx, 14, 12, T.x + (rng() < 0.5 ? -60 : 60), T.y + (rng() < 0.5 ? -60 : 60), 12, 1);
      if (s) {
        const R = { x: s.x, y: s.y, w: 14, h: 12, face: 'S' };
        if (buildLot(ctx, R, 14, 12, genCabin, { name: 'Cabana de Caça' }, 'cabin')) {
          clearing(ctx, s.x + 7, s.y + 6, 7.5);
          linkTrail(ctx, s.x + 7, s.y + 11);
          ctx.pois.push({ type: 'cabin', x: s.x + 7, y: s.y + 6 });
        }
      }
    }
    // torre de vigia na beira de uma clareira
    if (rng() < 0.65) {
      const s = forestSpot(ctx, 4, 4, rng.int(20, w - 20), rng.int(20, m.h - 20), 9, 1);
      if (s) {
        clearing(ctx, s.x + 2, s.y + 2, 3.2);
        addObject(ctx, 'watchtower', s.x + 1, s.y + 1, 2, 2, rng.int(0, 3), { outdoor: true, loot: 'hunting' });
        ctx.hot.push({ x: s.x + 2, y: s.y + 4, weight: 0.4, n: 1, kind: 'tower' });
        linkTrail(ctx, s.x + 2, s.y + 3);
        ctx.pois.push({ type: 'watchtower', x: s.x + 2, y: s.y + 2 });
      }
    }
    // carro batido numa estrada de terra
    const dirt = ctx.roads.filter((r) => r.kind === 'dirt');
    if (dirt.length && rng() < 0.75) {
      const r = dirt[Math.floor(rng() * dirt.length)];
      for (let k = 0; k < 20; k++) {
        const t = rng.int(r.a0 + 3, r.a1 - 6);
        const p = roadCell(r, t, rng() < 0.5 ? -2 : r.w);
        const car = addCar(ctx, rng() < 0.5 ? 'pickup' : 'car', p.x - 1, p.y - 1, rng.int(0, 3), { outdoor: true, noLots: true, avoidKeep: true, extra: { wrecked: true } });
        if (car) {
          ctx.decals.push({ x: car.x + 1, y: car.y + 1, type: 'glass', size: 0.8, rot: rng() * 6.28, alpha: 0.9, t: 0 });
          if (rng() < 0.6) ctx.decals.push({ x: car.x + 0.5, y: car.y + car.h + 0.5, type: 'bloodpool', size: 1, rot: rng() * 6.28, alpha: 0.9, t: 0 });
          ctx.pois.push({ type: 'wreck', x: car.x + 1, y: car.y + 1 });
          break;
        }
      }
    }
    // trilha pela mata ligando a estrada de madeireiros (ou a rural) a um ponto fundo da mata
    for (const r of dirt) {
      if (r === ctx.farmRoad) continue;
      const p = roadCell(r, r.a0 + 2, 1);
      trail(ctx, p.x, p.y, U.clamp(p.x + rng.int(-30, 30), 6, w - 7), U.clamp(p.y + rng.int(4, 16), 6, m.h - 7), 1);
    }
  }

  // ---- Natureza ----
  function distanceField(ctx) {
    const m = ctx.m, w = m.w, h = m.h, n = w * h;
    const d = new Uint8Array(n).fill(255), q = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) { const r = ctx.res[i]; if (r === 1 || r === 2 || r === 5 || r === 8) { d[i] = 0; q[qt++] = i; } }
    while (qh < qt) {
      const i = q[qh++], x = i % w, y = (i / w) | 0, nd = d[i] + 1;
      if (nd > 80) continue;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (d[j] > nd) { d[j] = nd; q[qt++] = j; }
      }
    }
    ctx.dist = d;
  }
  function nature(ctx) {
    const m = ctx.m, w = m.w, h = m.h, rng = ctx.rng, dist2 = ctx.dist, s = ctx.seed;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, f = m.floor[i], rr = ctx.res[i];
      if (m.wall[i] || m.objAt[i] >= 0) continue;
      if (f !== F.GRASS && f !== F.SAND && f !== F.DIRT) continue;
      if (rr && rr !== 6) continue;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const n1 = U.noise2(x * 0.06, y * 0.06, s + 11), n2 = U.noise2(x * 0.22, y * 0.22, s + 23);
      let fr = U.clamp((dist2[i] - 2) / 7, 0, 1) * (0.45 + 0.7 * n1);
      if (edge < 12) fr += (12 - edge) / 12 * 0.7;
      if (n1 < 0.27 && dist2[i] > 10 && edge > 10) fr *= 0.2; // clareira natural
      fr = U.clamp(fr, 0, 1);
      if (f === F.GRASS && fr > 0.3 + (n2 - 0.5) * 0.3) m.floor[i] = F.DARK_GRASS;
      if (f === F.GRASS && fr > 0.55 && n2 > 0.84) m.floor[i] = F.DIRT;
      if (f === F.SAND) continue;
      const pine = U.noise2(x * 0.05 + 50, y * 0.05, s + 5) > 0.52;
      const r = rng();
      if (r < fr * 0.3) addObject(ctx, pine ? 'pine' : 'tree', x, y, 1, 1, 0);
      else if (r < fr * 0.4 + (dist2[i] >= 1 && dist2[i] <= 3 ? 0.03 : 0)) addObject(ctx, 'bush', x, y, 1, 1, 0);
      else if (r < fr * 0.42 + 0.004) addObject(ctx, 'rock', x, y, 1, 1, 0);
      else if (dist2[i] <= 3 && fr < 0.2 && r > 0.992) addObject(ctx, 'tree', x, y, 1, 1, 0);
    }
  }

  // ---- Ponto inicial: casa tranquila na periferia do bairro, com loot próprio ----
  function chooseSpawn(ctx) {
    const m = ctx.m, rng = ctx.rng, C0 = ctx.center;
    let houses = ctx.lots.filter((l) => l.kind === 'house');
    if (!houses.length) houses = ctx.lots.filter((l) => l.kind === 'farm');
    // mais longe do centro comercial e com menos vizinhos perto
    sortBy(houses, (l) => {
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      let nb = 0;
      for (const o of ctx.lots) if (o !== l && dist(o.x + o.w / 2, o.y + o.h / 2, cx, cy) < 26) nb++;
      return -dist(cx, cy, C0.x, C0.y) + nb * 4 + rng() * 6;
    });
    const lot = houses[Math.floor(rng() * Math.min(3, houses.length))];
    if (!lot) { m.spawnPoint = { x: C0.x + 0.5, y: C0.y + 0.5 }; return; }
    const bid = lot.bIds[0], B = m.buildings[bid - 1];
    B.start = true;
    const living = m.rooms.find((r) => r.building === bid && r.type === 'living') || m.rooms.find((r) => r.building === bid);
    let best = null, bd = 1e9;
    for (let y = living.y; y < living.y + living.h; y++) for (let x = living.x; x < living.x + living.w; x++) {
      const i = y * m.w + x;
      if (m.wall[i] || m.objAt[i] >= 0 || m.room[i] !== living.id) continue;
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
      if (isDoorW(m.wall[i])) m.wallState[i] &= ~(WS.LOCKED | WS.OPEN);
      if (isWinW(m.wall[i])) { m.wallState[i] &= ~(WS.BROKEN | WS.LOCKED); m.wallHp[i] = baseHp(m.wall[i]); }
    }
    // loot próprio da casa inicial (chave "start_" + chave original)
    for (const o of m.objects) {
      if (o.building !== bid || !o.container) continue;
      const c = o.container;
      c.items.length = 0;
      if (c.lootKey.indexOf('start_') !== 0) c.lootKey = 'start_' + c.lootKey;
      try { if (G.items && G.items.fillContainer) G.items.fillContainer(c, o._rt || 'outdoor', o.type, ctx.lootRng); } catch (e) { console.error('[world] fillContainer', e); }
    }
  }

  // ---- Zumbis: hotspots em grupos, gradiente centro -> periferia, longe do início ----
  function zombieSpawns(ctx) {
    const m = ctx.m, w = m.w, sp = m.spawnPoint, rng = ctx.rng, C0 = ctx.center, list = [];
    const SAFE = 22;
    const blocked = (x, y) => {
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx < 1 || ty < 1 || tx >= w - 1 || ty >= m.h - 1) return true;
      const i = ty * w + tx, f = m.floor[i];
      return m.wall[i] || f === F.WATER || f === F.POOL || (m.objAt[i] >= 0 && m.objects[m.objAt[i]].blocksMove);
    };
    let gid = 0;
    const group = (x, y, weight, n, spread) => {
      if (dist(x, y, sp.x, sp.y) < SAFE) return;
      const g = 1.4 - 0.75 * U.clamp(dist(x, y, C0.x, C0.y) / 95, 0, 1);
      const id = gid++;
      let placed = 0;
      for (let k = 0; k < n * 4 && placed < n; k++) {
        const px = x + (rng() - 0.5) * 2 * spread, py = y + (rng() - 0.5) * 2 * spread;
        if (blocked(px, py) || dist(px, py, sp.x, sp.y) < SAFE) continue;
        if (ctx.spawnB && m.building[Math.floor(py) * w + Math.floor(px)] === ctx.spawnB) continue;
        list.push({ x: Math.floor(px * 10) / 10, y: Math.floor(py * 10) / 10, weight: Math.round(weight * g * 100) / 100, group: id });
        placed++;
      }
    };
    for (const h of ctx.hot) group(h.x, h.y, h.weight, h.n || 1, h.kind === 'commercial' || h.kind === 'school' ? 2.5 : 1.5);
    // cruzamentos do centro e trechos da rua principal
    const seenX = new Set();
    for (const a of ctx.roads) for (const b of ctx.roads) {
      if (a === b || a.h === b.h || a.kind === 'dirt' || b.kind === 'dirt' || a.kind === 'alley' || b.kind === 'alley') continue;
      if (b.lo > a.a1 || b.hi < a.a0 || a.lo > b.a1 || a.hi < b.a0) continue;
      const x = a.h ? b.c : a.c, y = a.h ? a.c : b.c, key = x * 1000 + y;
      if (seenX.has(key)) continue;
      seenX.add(key);
      const dC = dist(x, y, C0.x, C0.y);
      if (dC < ctx.downR + 10) group(x, y, 1.5, 3, 3);
      else if (rng() < 0.45) group(x, y, 0.7, 2, 3);
    }
    for (const r of ctx.roads) {
      if (r.kind === 'dirt' || r.kind === 'alley') continue;
      const step = r.kind === 'rural' ? 40 : r.kind === 'main' ? 14 : 26;
      for (let t = r.a0 + (step >> 1); t <= r.a1; t += step) {
        const p = roadCell(r, t, r.w >> 1);
        const down = ctx.downtown(t, r);
        if (r.kind === 'rural') { if (rng() < 0.6) group(p.x, p.y, 0.35, 1, 2); }
        else group(p.x, p.y, down ? 1.2 : 0.55, down ? 2 : rng() < 0.5 ? 2 : 1, 2.5);
      }
    }
    for (const r of m.rooms) {
      const B = m.buildings[r.building - 1];
      if (r.building === ctx.spawnB || (B.type !== 'house' && B.type !== 'trailer')) continue;
      if (r.type === 'living' && rng() < 0.4) group(r.x + r.w / 2, r.y + r.h / 2, 0.6, rng() < 0.3 ? 2 : 1, 1);
      else if (r.type === 'bedroom' && rng() < 0.12) group(r.x + r.w / 2, r.y + r.h / 2, 0.4, 1, 0.8);
    }
    if (ctx.jam) group(ctx.jam.x, ctx.jam.y, 2.2, 6, 5);
    for (let k = 0; k < 40; k++) {
      const x = rng.int(4, w - 5), y = rng.int(4, m.h - 5), i = y * w + x;
      if (ctx.dist[i] > 6 && (m.floor[i] === F.DARK_GRASS || m.floor[i] === F.GRASS)) group(x + 0.5, y + 0.5, 0.12, 1, 0.5);
    }
    m.zombieSpawns = list;
  }

  // ---- Dados para o render: conexões de parede (paredes finas estilo PZ) ----
  const isStructW = (wv) => wv === W.WOOD || wv === W.BRICK || wv === W.PLASTER || wv === W.CONCRETE || wv === W.GLASS || wv === W.WINDOW || wv === W.DOOR || wv === W.GARAGE_DOOR;
  const DIR_BIT = [2, 4, 8, 1]; // bits por direção na ordem DX/DY: E(+x)=2, S(+y)=4, W(-x)=8, N(-y)=1
  function maskAt(m, x, y) {
    const i = y * m.w + x, wv = m.wall[i];
    if (!wv) return 0;
    let mask = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx, nv = m.wall[j];
      if (!nv) continue;
      // paredes do prédio ligam com paredes do mesmo prédio (inclui grades internas); cercas ligam com cercas e paredes
      const ok = isStructW(wv) || m.building[i] ? m.building[j] === m.building[i] && m.building[i] !== 0 : isFenceLike(nv) || isStructW(nv);
      if (ok) mask |= DIR_BIT[d];
    }
    return mask;
  }
  function wallMasks(m) {
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) m.wallMask[y * m.w + x] = maskAt(m, x, y);
  }

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let lastMap = null;

  WD.generate = function (seed) {
    const t0 = now();
    seed = (seed | 0) >>> 0;
    const m = allocMap(C.MAP_W, C.MAP_H), n = m.w * m.h;
    const rng = U.rng(seed ^ 0x51f15e);
    const ctx = {
      m, seed, rng, lootRng: U.rng(seed ^ 0x2c1b3c6d), res: new Uint8Array(n), keep: new Uint8Array(n), alleyMask: new Uint8Array(n),
      roads: [], lots: [], hot: [], decals: [], pois: [], bridgeCells: [], bulbs: [], names: shuffle(SURNAMES.slice(), rng), nameI: 0,
    };
    planLayout(ctx);
    paintRoads(ctx);
    for (const r of ctx.roads) if (r.kind === 'alley') for (let t = r.a0; t <= r.a1; t++) for (let o = 0; o < r.w; o++) {
      const p = roadCell(r, t, o); if (p.x >= 0 && p.y >= 0 && p.x < m.w && p.y < m.h) ctx.alleyMask[p.y * m.w + p.x] = 1;
    }
    river(ctx);
    railway(ctx);
    lake(ctx);
    farm(ctx);
    blockLots(ctx);
    placeSpecials(ctx);
    periphery(ctx);
    placeHouses(ctx);
    fencePass(ctx);
    cleanup(ctx);
    roadMarks(ctx);
    streetDetails(ctx);
    distanceField(ctx);
    forestPOIs(ctx);
    nature(ctx);
    fixPockets(ctx);
    chooseSpawn(ctx);
    zombieSpawns(ctx);
    wallMasks(m);
    for (const o of m.objects) delete o._rt;
    m.seed = seed;
    m.roads = ctx.roads.map((r) => ({ h: r.h, c: r.c, a0: r.a0, a1: r.a1, kind: r.kind, w: r.w, lo: r.lo, hi: r.hi }));
    m.lots = ctx.lots.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, face: l.face, kind: l.kind, name: l.name, buildings: l.bIds }));
    m.pois = ctx.pois;
    m.lake = ctx.lakeInfo || null;
    m.layout = { orient: ctx.orient, center: ctx.center, cols: ctx.plan.nc, rows: ctx.plan.nr };
    m.initialDecals = ctx.decals;
    m.genTime = now() - t0;
    const s = G.state;
    if (s && Array.isArray(s.decals) && !s.map) for (const d of ctx.decals) s.decals.push(Object.assign({}, d));
    lastMap = m;
    return m;
  };

  // ------------------------------------------------------------------
  // 6. API em tempo de jogo  (toda função que recebe tile aplica Math.floor)
  // ------------------------------------------------------------------
  function map() { const s = G.state; return (s && s.map) || lastMap; }
  const fl = Math.floor;
  WD.current = map;
  WD.setMap = function (m) { lastMap = m; };
  WD.idx = function (tx, ty) { return fl(ty) * map().w + fl(tx); };
  WD.inBounds = function (tx, ty) { const m = map(); tx = fl(tx); ty = fl(ty); return tx >= 0 && ty >= 0 && tx < m.w && ty < m.h; };

  const BM = WS.BARRICADE_MASK, BS = WS.BARRICADE_SHIFT;
  const barLevel = (st) => (st & BM) >> BS;

  function wallBlocksMove(wv, st) {
    if (wv === W.DOOR || wv === W.GARAGE_DOOR) return (st & BM) !== 0 || !(st & (WS.OPEN | WS.BROKEN));
    if (wv === W.FENCE_GATE) return !(st & (WS.OPEN | WS.BROKEN));
    if (wv === W.FENCE_WOOD || wv === W.FENCE_METAL || wv === W.HEDGE) return !(st & WS.BROKEN);
    return true; // paredes, janelas e vidraças (janela se atravessa pulando)
  }
  function wallBlocksSight(wv, st) {
    switch (wv) {
      case W.DOOR: case W.GARAGE_DOOR: return !(st & (WS.OPEN | WS.BROKEN)) || barLevel(st) >= 3;
      case W.WINDOW: case W.GLASS: return (st & WS.CURTAIN) !== 0 || barLevel(st) >= 3;
      case W.FENCE_WOOD: case W.FENCE_METAL: case W.HEDGE: case W.FENCE_GATE: return false; // sebe: parcial (ver lineOfSight)
      default: return true;
    }
  }
  WD.wallBlocksMove = wallBlocksMove;
  WD.wallBlocksSight = wallBlocksSight;

  // who: 'player' | 'zombie' — as regras de colisão são iguais para ambos
  WD.isBlocked = function (tx, ty /* , who */) {
    const m = map();
    tx = fl(tx); ty = fl(ty);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return true;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (wv && wallBlocksMove(wv, m.wallState[i])) return true;
    const f = m.floor[i];
    if (f === F.WATER || f === F.POOL) return true;
    const o = m.objAt[i];
    return o >= 0 && m.objects[o].blocksMove;
  };

  function opaque(m, tx, ty) {
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return true;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (wv && wallBlocksSight(wv, m.wallState[i])) return true;
    const o = m.objAt[i];
    return o >= 0 && m.objects[o].blocksSight;
  }
  WD.blocksSight = function (tx, ty) { return opaque(map(), fl(tx), fl(ty)); };
  // Custo de visão 0..1 (render pode escurecer): sebe 0.5, cerca de madeira 0.15
  WD.sightCost = function (tx, ty) {
    const m = map();
    tx = fl(tx); ty = fl(ty);
    if (opaque(m, tx, ty)) return 1;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (wv === W.HEDGE && !(m.wallState[i] & WS.BROKEN)) return 0.5;
    if (wv === W.FENCE_WOOD) return 0.15;
    return 0;
  };

  // DDA (Amanatides–Woo). Ignora o tile de origem; testa o de destino (a menos de ignoreDest).
  // Quinas exatas: só bloqueia se os DOIS vizinhos bloqueiam. 2+ tiles de sebe bloqueiam.
  // mode: 0 = visão, 1 = alcance físico
  function dda(x0, y0, x1, y1, mode, ignoreDest) {
    if (!(x0 === x0 && y0 === y0 && x1 === x1 && y1 === y1)) return false; // NaN
    const m = map(), w = m.w;
    let tx = fl(x0), ty = fl(y0);
    const ex = fl(x1), ey = fl(y1);
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
      if (!(last && ignoreDest)) {
        if (mode) { if (blockReach(m, tx, ty)) return false; }
        else {
          if (opaque(m, tx, ty)) return false;
          const i = ty * w + tx;
          if (m.wall[i] === W.HEDGE && !(m.wallState[i] & WS.BROKEN) && ++hedges >= 2) return false;
        }
      }
      if (last) return true;
    }
    return true;
  }
  // "alcance de mão": paredes, portas fechadas e janelas fechadas bloqueiam; móveis e cercas não
  function blockReach(m, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (!wv) return false;
    const st = m.wallState[i];
    if (isWinW(wv)) return !(st & (WS.OPEN | WS.BROKEN)) || barLevel(st) > 0;
    if (isFenceLike(wv)) return false;
    return wallBlocksMove(wv, st);
  }
  WD.lineOfSight = function (x0, y0, x1, y1, ignoreDest) { return dda(x0, y0, x1, y1, 0, !!ignoreDest); };
  // Alcance físico (lootear/interagir): ignora móveis; o destino não conta
  WD.canReach = function (x0, y0, x1, y1) { return dda(x0, y0, x1, y1, 1, true); };

  // ---- Colisão círculo × tiles com deslizamento ----
  const _mv = { hitX: false, hitY: false, tx: -1, ty: -1 };
  function pushOut(e, r, who) {
    for (let it = 0; it < 4; it++) {
      let moved = false;
      const x0 = fl(e.x - r), x1 = fl(e.x + r), y0 = fl(e.y - r), y1 = fl(e.y + r);
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
    if (!(dx === dx) || !(dy === dy)) { dx = 0; dy = 0; }
    // preso dentro de um tile bloqueado (ex.: porta fechou em cima): vai para o livre mais próximo
    if (WD.isBlocked(e.x, e.y, who)) {
      const f = WD.nearestFree(e.x, e.y, 6);
      if (f) { e.x = f.x; e.y = f.y; }
    }
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
    const m = map(), tx = fl(x), ty = fl(y);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return 0;
    return m.building[ty * m.w + tx];
  };
  WD.roomAt = function (x, y) {
    const m = map(), tx = fl(x), ty = fl(y);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return null;
    const id = m.room[ty * m.w + tx];
    return id ? m.rooms[id - 1] : null;
  };
  WD.buildingAt = function (x, y) { const id = WD.isIndoors(x, y); return id ? map().buildings[id - 1] : null; };
  WD.getObject = function (tx, ty) {
    const m = map();
    tx = fl(tx); ty = fl(ty);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return null;
    const o = m.objAt[ty * m.w + tx];
    return o >= 0 ? m.objects[o] : null;
  };
  let stamps = new Uint32Array(1024), stampN = 0;
  function objDist(o, x, y) {
    const cx = x < o.x ? o.x : x > o.x + o.w ? o.x + o.w : x, cy = y < o.y ? o.y : y > o.y + o.h ? o.y + o.h : y;
    return Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
  }
  // Objetos cuja pegada está a <= r de (x,y), do mais perto ao mais longe
  WD.objectsNear = function (x, y, r) {
    const m = map(), out = [];
    if (stamps.length < m.objects.length) stamps = new Uint32Array(m.objects.length * 2);
    if (++stampN > 4e9) { stampN = 1; stamps.fill(0); }
    const x0 = Math.max(0, fl(x - r)), x1 = Math.min(m.w - 1, fl(x + r));
    const y0 = Math.max(0, fl(y - r)), y1 = Math.min(m.h - 1, fl(y + r));
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
  function nearestCell(o, x, y) {
    return { x: Math.min(o.x + o.w - 1, Math.max(o.x, fl(x))) + 0.5, y: Math.min(o.y + o.h - 1, Math.max(o.y, fl(y))) + 0.5 };
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
        if (!c.container || Math.sqrt((c.x - x) * (c.x - x) + (c.y - y) * (c.y - y)) > r || !WD.canReach(x, y, c.x, c.y)) continue;
        out.push({ source: 'corpse', obj: c, container: c.container, x: c.x, y: c.y });
      }
      const gi = s.groundItems || [], near = [];
      for (let i = 0; i < gi.length; i++) {
        const g = gi[i];
        if (Math.sqrt((g.x - x) * (g.x - x) + (g.y - y) * (g.y - y)) <= r && WD.canReach(x, y, g.x, g.y)) near.push(g);
      }
      if (near.length) {
        out.push({ source: 'ground', obj: null, x, y,
          container: { name: 'Chão', items: near.map((g) => g.item), capacity: Infinity, searched: true, lootKey: 'ground', ground: near } });
      }
    }
    return out;
  };
  // ---- Mover itens (jeito certo): funciona com entradas de containersNear (object/corpse/ground)
  // ou com contêineres simples { items, capacity } (ex.: inventário do jogador).
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
  const isGroundEntry = (e) => e && (e.source === 'ground' || (e.container && e.container.ground));
  WD.takeFrom = function (entry, item) {
    if (!entry || !item) return false;
    const c = entry.container || entry;
    if (isGroundEntry(entry)) {
      const ok = WD.removeGroundItem(item);
      const k = c.items.indexOf(item); if (k >= 0) c.items.splice(k, 1);
      if (c.ground) { const j = c.ground.findIndex((g) => g.item === item); if (j >= 0) c.ground.splice(j, 1); }
      return ok;
    }
    const k = c.items ? c.items.indexOf(item) : -1;
    if (k < 0) return false;
    c.items.splice(k, 1);
    return true;
  };
  WD.putInto = function (entry, item) {
    if (!entry || !item) return false;
    const c = entry.container || entry;
    if (isGroundEntry(entry)) {
      const g = WD.dropItem(entry.x, entry.y, item);
      if (!g) return false;
      c.items.push(item); if (c.ground) c.ground.push(g);
      return true;
    }
    if (!c.items) return false;
    if (c.capacity != null && isFinite(c.capacity) && G.items && G.items.weight) {
      if (G.items.weight(c.items) + G.items.weight([item]) > c.capacity + 1e-6) return false;
    }
    c.items.push(item);
    return true;
  };
  // Move um item entre duas entradas; não perde nem duplica (volta atrás se não couber)
  WD.transferItem = function (from, to, item) {
    if (!WD.putInto(to, item)) return false;
    if (!WD.takeFrom(from, item)) { WD.takeFrom(to, item); return false; }
    G.events.emit('item:transfer', { item });
    return true;
  };

  // ---- Estruturas (portas, portões, janelas, cercas, barricadas) ----
  function structType(wv) {
    switch (wv) {
      case W.DOOR: return 'door'; case W.GARAGE_DOOR: return 'garage_door'; case W.FENCE_GATE: return 'gate';
      case W.WINDOW: return 'window'; case W.GLASS: return 'glass';
      case W.FENCE_WOOD: case W.FENCE_METAL: return 'fence'; case W.HEDGE: return 'hedge';
      default: return 'wall';
    }
  }
  // Eixo da parede em que uma porta/janela está: 'x' (parede corre em x) | 'y' | null
  WD.wallAxis = function (tx, ty) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return null;
    const mk = m.wallMask ? m.wallMask[ty * m.w + tx] : maskAt(m, tx, ty);
    if (mk & 10) return 'x';
    if (mk & 5) return 'y';
    return null;
  };
  // Recalcula a máscara de conexão de parede em volta de um tile (se estruturas mudarem)
  WD.updateWallMask = function (tx, ty) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.wallMask[y * m.w + x] = maskAt(m, x, y);
  };
  // Grupo de tiles que agem juntos (portão de garagem de 3 tiles). Outros: só o próprio tile.
  const _grp = [];
  function groupIdx(m, tx, ty) {
    _grp.length = 0;
    const i = ty * m.w + tx, wv = m.wall[i];
    _grp.push(i);
    if (wv !== W.GARAGE_DOOR) return _grp;
    const b = m.building[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let x = tx + dx, y = ty + dy;
      while (x >= 0 && y >= 0 && x < m.w && y < m.h && m.wall[y * m.w + x] === W.GARAGE_DOOR && m.building[y * m.w + x] === b && _grp.length < 8) {
        _grp.push(y * m.w + x); x += dx; y += dy;
      }
    }
    return _grp;
  }
  WD.structureGroup = function (tx, ty) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h) || !m.wall[ty * m.w + tx]) return [];
    return groupIdx(m, tx, ty).map((i) => ({ x: i % m.w, y: (i / m.w) | 0 }));
  };
  WD.getStructure = function (tx, ty) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return null;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (!wv) return null;
    const st = m.wallState[i];
    return { type: structType(wv), wall: wv, x: tx, y: ty, open: !!(st & WS.OPEN), broken: !!(st & WS.BROKEN),
      locked: !!(st & WS.LOCKED), barricade: barLevel(st), hp: m.wallHp[i], barricadeHp: m.barricadeHp[i],
      curtain: !!(st & WS.CURTAIN), building: m.building[i], axis: WD.wallAxis(tx, ty), group: groupIdx(m, tx, ty).length };
  };
  WD.isDoor = function (tx, ty) { const m = map(); tx = fl(tx); ty = fl(ty); return WD.inBounds(tx, ty) && isDoorW(m.wall[ty * m.w + tx]); };
  WD.isWindow = function (tx, ty) { const m = map(); tx = fl(tx); ty = fl(ty); return WD.inBounds(tx, ty) && isWinW(m.wall[ty * m.w + tx]); };

  function occupied(tx, ty) {
    const s = G.state; if (!s) return false;
    const inT = (e, r) => e && e.x + r > tx && e.x - r < tx + 1 && e.y + r > ty && e.y - r < ty + 1;
    if (s.player && s.player.alive !== false && inT(s.player, C.PLAYER_RADIUS)) return true;
    const zs2 = s.zombies || [];
    for (let i = 0; i < zs2.length; i++) if (zs2[i].state !== 'dead' && inT(zs2[i], C.ZOMBIE_RADIUS)) return true;
    return false;
  }
  function emit(name, x, y, extra) { G.events.emit(name, extra ? Object.assign({ x, y }, extra) : { x, y }); }
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

  // Abre/fecha porta, portão de garagem (grupo inteiro), portão de cerca ou janela
  WD.setOpen = function (tx, ty, open) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return false;
    const i = ty * m.w + tx, wv = m.wall[i], st = m.wallState[i];
    const isD = isDoorW(wv) || isGateW(wv), isWn = isWinW(wv);
    if (!isD && !isWn) return false;
    if (st & WS.BROKEN) return false;
    const cur = !!(st & WS.OPEN);
    if (open == null) open = !cur;
    open = !!open;
    if (cur === open) return true;
    if (barLevel(st) > 0) { G.say(isD ? 'Está barricada.' : 'A janela está barricada.', 'warning'); return false; }
    if (open && (st & WS.LOCKED)) {
      if (isWn) { emit('window:locked', tx, ty); G.say('A janela está travada.', 'warning'); }
      else { emit('door:locked', tx, ty); G.say('Está trancada.', 'warning'); }
      return false;
    }
    const grp = groupIdx(m, tx, ty);
    if (!open && isD) for (const j of grp) if (occupied(j % m.w, (j / m.w) | 0)) return false;
    for (const j of grp) m.wallState[j] = open ? m.wallState[j] | WS.OPEN : m.wallState[j] & ~WS.OPEN;
    const ex = wv === W.GARAGE_DOOR ? { garage: true, group: grp.length } : isGateW(wv) ? { gate: true } : null;
    if (isD) emit(open ? 'door:open' : 'door:close', tx, ty, ex);
    else emit(open ? 'window:open' : 'window:close', tx, ty);
    return true;
  };
  // Tranca/destranca (só fechadas: aberta e trancada são exclusivos)
  WD.setLocked = function (tx, ty, locked) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)) return false;
    const i = ty * m.w + tx, wv = m.wall[i];
    if (!isOpenable(wv)) return false;
    if (locked && (m.wallState[i] & (WS.OPEN | WS.BROKEN))) return false;
    for (const j of groupIdx(m, tx, ty)) m.wallState[j] = locked ? m.wallState[j] | WS.LOCKED : m.wallState[j] & ~WS.LOCKED;
    return true;
  };
  function setBar(m, i, level) { m.wallState[i] = (m.wallState[i] & ~BM) | ((level << BS) & BM); }

  // Dano em estrutura: a barricada absorve primeiro (sobra não passa para a porta).
  // Retorna 'none'|'damaged'|'broken' ('broken' = a porta/janela/cerca em si quebrou).
  WD.damageStructure = function (tx, ty, amount /* , who */) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!(tx >= 0 && ty >= 0 && tx < m.w && ty < m.h) || !(amount > 0)) return 'none';
    const i = ty * m.w + tx, wv = m.wall[i], st = m.wallState[i];
    if (!wv) return 'none';
    const grp = groupIdx(m, tx, ty);
    const bl = barLevel(st);
    if (bl > 0) {
      const hp = Math.max(0, m.barricadeHp[i] - amount);
      const nl = Math.ceil(hp / PLANK_HP - 1e-6);
      for (const j of grp) { m.barricadeHp[j] = hp; setBar(m, j, nl); }
      particles(tx, ty, 'wood', 2, '#8a6a44');
      for (let k = nl; k < bl; k++) { // um evento por tábua quebrada
        emit('barricade:break', tx, ty);
        particles(tx, ty, 'wood', 6, '#8a6a44');
        noise(tx, ty, 10, 'barricade');
      }
      return 'damaged';
    }
    if (st & WS.BROKEN) return 'none';
    const isD = isDoorW(wv) || isGateW(wv), isWn = isWinW(wv), isFe = isFenceW(wv) || wv === W.HEDGE;
    if (!isD && !isWn && !isFe) return 'none';        // paredes são indestrutíveis
    if (isD && (st & WS.OPEN)) return 'none';          // aberta: nada para bater
    const hp = (m.wallHp[i] > 0 ? m.wallHp[i] : baseHp(wv)) - amount;
    if (hp > 0) {
      for (const j of grp) m.wallHp[j] = hp;
      particles(tx, ty, isWn ? 'glass' : wv === W.HEDGE ? 'dust' : 'wood', 1, isWn ? '#cfe6ee' : '#7a5a3a');
      return 'damaged';
    }
    for (const j of grp) { m.wallHp[j] = 0; m.wallState[j] = (m.wallState[j] | WS.BROKEN) & ~(WS.OPEN | WS.LOCKED); }
    if (isD) {
      emit('door:break', tx, ty, wv === W.GARAGE_DOOR ? { garage: true, group: grp.length } : isGateW(wv) ? { gate: true } : null);
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
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!WD.inBounds(tx, ty)) return false;
    const i = ty * m.w + tx;
    if (!isWinW(m.wall[i]) || (m.wallState[i] & WS.BROKEN) || barLevel(m.wallState[i]) > 0) return false;
    m.wallHp[i] = 1e-3;
    return WD.damageStructure(tx, ty, 1, 'player') === 'broken';
  };
  // Barricada: cada tábua soma PLANK_HP ao que resta (máx. 4 tábuas); remover tira uma tábua
  WD.addBarricade = function (tx, ty) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!WD.inBounds(tx, ty)) return false;
    const i = ty * m.w + tx, wv = m.wall[i], st = m.wallState[i];
    if (!isDoorW(wv) && !isWinW(wv)) return false;
    const grp = groupIdx(m, tx, ty);
    if (isDoorW(wv) && (st & WS.OPEN)) { G.say('Feche a porta primeiro.', 'warning'); return false; }
    if (isDoorW(wv)) for (const j of grp) if (occupied(j % m.w, (j / m.w) | 0)) return false;
    const bl = barLevel(st);
    if (bl >= MAX_PLANKS) { G.say('Não cabem mais tábuas.', 'info'); return false; }
    const hp = Math.min(MAX_PLANKS * PLANK_HP, m.barricadeHp[i] + PLANK_HP);
    const nl = Math.ceil(hp / PLANK_HP - 1e-6);
    for (const j of grp) { if (isWinW(wv)) m.wallState[j] &= ~WS.OPEN; m.barricadeHp[j] = hp; setBar(m, j, nl); }
    emit('barricade:add', tx, ty);
    return true;
  };
  WD.removeBarricade = function (tx, ty) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!WD.inBounds(tx, ty)) return false;
    const i = ty * m.w + tx;
    if (barLevel(m.wallState[i]) <= 0) return false;
    const hp = Math.max(0, m.barricadeHp[i] - PLANK_HP), nl = Math.ceil(hp / PLANK_HP - 1e-6);
    for (const j of groupIdx(m, tx, ty)) { m.barricadeHp[j] = hp; setBar(m, j, nl); }
    emit('barricade:remove', tx, ty);
    return true;
  };
  WD.toggleCurtain = function (tx, ty) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!WD.inBounds(tx, ty)) return null;
    const i = ty * m.w + tx;
    if (!isWinW(m.wall[i]) || (m.wallState[i] & WS.BROKEN)) return null;
    m.wallState[i] ^= WS.CURTAIN;
    return !!(m.wallState[i] & WS.CURTAIN);
  };
  // Dá para pular por aqui? (janela aberta/quebrada sem barricada, cercas e portões inteiros)
  WD.canClimb = function (tx, ty) {
    const m = map(); tx = fl(tx); ty = fl(ty);
    if (!WD.inBounds(tx, ty)) return false;
    const i = ty * m.w + tx, wv = m.wall[i], st = m.wallState[i];
    if (isWinW(wv)) return !!(st & (WS.OPEN | WS.BROKEN)) && barLevel(st) === 0;
    return (isFenceW(wv) || isGateW(wv)) && !(st & WS.BROKEN);
  };
  // Tile do outro lado de uma janela/cerca, vindo de (fx,fy). null se não houver.
  WD.climbTarget = function (tx, ty, fx, fy) {
    tx = fl(tx); ty = fl(ty);
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
  // who: 'player' — porta/portão fechado destrancado custa +2 (ele abre); trancado/barricado/janela bloqueia.
  //      'zombie' — portas (+6), portões (+6), janelas (+10), cercas (+8), sebes (+30), +6 por tábua: o módulo
  //                 de zumbis deve bater (damageStructure) ou pular ao chegar; paredes/objetos/água bloqueiam.
  //      'open'   — todas as portas/portões contam como abertos (validação/depuração).
  //      outro    — só o que está passável agora (isBlocked).
  // opts: { partial: true } devolve o caminho até o nó de menor heurística se não achar o destino.
  let PF = null;
  function pfAlloc(n) {
    PF = { n, g: new Float32Array(n), came: new Int32Array(n), open: new Uint32Array(n), closed: new Uint32Array(n),
      hn: new Int32Array(n * 4), hf: new Float32Array(n * 4), gen: 0, size: 0 };
  }
  function enterCost(m, i, who) {
    const f = m.floor[i];
    if (f === F.WATER || f === F.POOL) return Infinity;
    const oi = m.objAt[i];
    if (oi >= 0 && m.objects[oi].blocksMove) return Infinity;
    const wv = m.wall[i];
    if (!wv) return 0;
    const st = m.wallState[i];
    if (!wallBlocksMove(wv, st)) return 0;
    const bl = barLevel(st);
    if (who === 'zombie') {
      if (isDoorW(wv) || isGateW(wv)) return 6 + bl * 6;
      if (isWinW(wv)) return 10 + bl * 6;
      if (isFenceW(wv)) return 8;
      if (wv === W.HEDGE) return 30;
      return Infinity;
    }
    if (who === 'player') return (isDoorW(wv) || isGateW(wv)) && !(st & WS.LOCKED) && !bl ? 2 : Infinity;
    if (who === 'open') return isDoorW(wv) || isGateW(wv) ? 0.5 : Infinity;
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
  WD.findPath = function (x0, y0, x1, y1, who, maxNodes, opts) {
    const m = map(), w = m.w, h = m.h, n = w * h;
    if (maxNodes && typeof maxNodes === 'object') { opts = maxNodes; maxNodes = opts.maxNodes; }
    opts = opts || {};
    if (!PF || PF.n !== n) pfAlloc(n);
    const sx = fl(x0), sy = fl(y0), gx = fl(x1), gy = fl(y1);
    if (!(sx >= 0 && sy >= 0 && sx < w && sy < h && gx >= 0 && gy >= 0 && gx < w && gy < h)) return null;
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
    let expanded = 0, found = -1, bestN = start, bestH = hfun(sx, sy);
    const cap = PF.hn.length - 8;
    while (PF.size > 0) {
      const cur = heapPop();
      if (cl[cur] === gen) continue;
      cl[cur] = gen;
      const cx = cur % w, cy = (cur / w) | 0;
      if (cur === goal || (goalBlocked && Math.abs(cx - gx) + Math.abs(cy - gy) === 1)) { found = cur; break; }
      const hc = hfun(cx, cy);
      if (hc < bestH) { bestH = hc; bestN = cur; }
      if (++expanded > limit) break;
      const curStruct = m.wall[cur] !== 0;
      for (let d = 0; d < 8; d++) {
        const ddx = d < 4 ? DX[d] : (d & 1 ? -1 : 1), ddy = d < 4 ? DY[d] : (d < 6 ? 1 : -1);
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (cl[ni] === gen) continue;
        const c = enterCost(m, ni, who);
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
    if (found < 0) {
      if (!opts.partial || bestN === start) return null;
      found = bestN;
    }
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
  // Tile livre mais próximo (busca em anel), centro do tile ou null
  WD.nearestFree = function (x, y, maxR) {
    const tx = fl(x), ty = fl(y);
    for (let r = 0; r <= (maxR || 8); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (!WD.isBlocked(tx + dx, ty + dy)) return { x: tx + dx + 0.5, y: ty + dy + 0.5 };
    }
    return null;
  };

  // Nada pesado por frame: o mundo é estático fora das ações dos outros módulos.
  WD.update = function (/* dt, dtMin */) {};
})();
