#!/usr/bin/env node
/* =====================================================================
 * Validação automática do mundo (js/world.js) — roda em Node, sem navegador.
 *   node tools/validate-world.mjs [--seeds 1,42] [--n 100] [--verbose]
 *                                 [--browser]        compara hashes Node × Chromium (Playwright)
 *                                 [--update-golden]  regrava a tabela de hashes de ouro
 * Verifica por seed: tempo, determinismo (hash de ouro + 2 gerações iguais), início livre,
 * objetos x paredes/água/objAt, carros com pegada certa, lotes/prédios sem sobreposição,
 * metadados de prédio (parts/roofType/face), portas com os dois lados livres, janelas sem parede
 * atrás, todos os cômodos alcançáveis (portas abertas; e realista: porta externa trancada bloqueia,
 * interna se arromba, janelas/cercas/portões se pulam), nenhum tile interno isolado, contêineres
 * acessíveis, ruas conectadas, sem ROAD_LINE como piso, estados coerentes (quebrada => hp 0,
 * aberta xor trancada), casa inicial com loot "start_", pontos de zumbi longe do início.
 * Distribuição (todas as seeds): >=30% casas com 2+ quartos, corredores, quintal >= 4, variedade
 * de layout entre seeds. Testes de API (grupos de portão, barricada, janela trancada, itens, LOS,
 * A* parcial, colisão) e desempenho. Sai com código 1 se algo falhar.
 * ===================================================================== */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const verbose = args.includes('--verbose');

// Hash estável do mapa (pisos, paredes, estados, prédios, cômodos, objetos)
const HASH_SRC = `function mapHash(m) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0; h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0; };
  for (const a of [m.floor, m.wall, m.wallState, m.building, m.room, m.wallMask]) for (let i = 0; i < a.length; i++) mix(a[i]);
  for (const o of m.objects) { mix(o.x); mix(o.y); mix(o.w); mix(o.h); mix(o.rot); mix(o.type.length); mix(o.variant); if (o.container) mix(o.container.items.length); }
  for (const z of m.zombieSpawns) { mix(Math.round(z.x * 10)); mix(Math.round(z.y * 10)); }
  mix(m.buildings.length); mix(m.rooms.length); mix(m.roadMarks.length);
  return h.toString(16);
}`;
const mapHash = new Function(HASH_SRC + '; return mapHash;')();

// Hashes de ouro (regravados com --update-golden quando a geração muda de propósito)
const GOLDEN = {
  /*GOLDEN*/
  1: 'f79677fe',
  7: 'a38c03c4',
  42: '3a4e845c',
  99: '979e8c07',
  1337: '12b2305f',
  2024: 'c833b012',
  99999: '2ad16b82',
};

function load() {
  const g = { console, Math, Date, performance, URLSearchParams, location: { search: '' } };
  g.window = g; g.globalThis = g;
  const ctx = vm.createContext(g);
  for (const f of ['js/core.js', 'js/items.js', 'js/world.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  return g.G;
}
const G = load();
const { FLOOR: F, WALL: W, WS } = G;
const WD = G.world;

let seeds = arg('seeds') ? arg('seeds').split(',').map(Number) : [];
const nRand = +arg('n', 100);
if (!seeds.length) { seeds = [1, 7, 42, 99, 1337, 2024, 99999]; for (let i = 0; i < nRand; i++) seeds.push((i * 2654435761 + 12345) >>> 0); }
const goldenSeeds = [1, 7, 42, 99, 1337, 2024, 99999];

let failures = 0;
const fail = (seed, msg) => { failures++; if (failures < 400) console.log(`  ✗ [seed ${seed}] ${msg}`); };

const isDoor = (w) => w === W.DOOR || w === W.GARAGE_DOOR;
const isWin = (w) => w === W.WINDOW || w === W.GLASS;
const isFence = (w) => w === W.FENCE_WOOD || w === W.FENCE_METAL || w === W.HEDGE || w === W.FENCE_GATE;
const CAR = { car: [4, 2], pickup: [4, 2], police_car: [4, 2], ambulance: [5, 2] };

function flood(m, sx, sy, mode) {
  const n = m.w * m.h, seen = new Uint8Array(n), q = new Int32Array(n);
  let h = 0, t = 0;
  const s = sy * m.w + sx; seen[s] = 1; q[t++] = s;
  const interior = (i) => { const b = m.building[i]; return b && m.building[i - 1] === b && m.building[i + 1] === b && m.building[i - m.w] === b && m.building[i + m.w] === b; };
  const pass = (i) => {
    const f = m.floor[i];
    if (f === F.WATER || f === F.POOL) return false;
    const o = m.objAt[i];
    if (o >= 0 && m.objects[o].blocksMove) return false;
    const w = m.wall[i];
    if (!w) return true;
    const st = m.wallState[i];
    if (isDoor(w)) return mode === 'open' ? true : !(st & WS.LOCKED) || (st & (WS.OPEN | WS.BROKEN)) || interior(i);
    if (w === W.FENCE_GATE) return true; // abre ou se pula
    if (isWin(w)) return mode === 'real';
    if (w === W.FENCE_WOOD || w === W.FENCE_METAL) return mode === 'real';
    return false;
  };
  while (h < t) {
    const i = q[h++], x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j] || !pass(j)) continue;
      seen[j] = 1; q[t++] = j;
    }
  }
  return seen;
}

const times = [], hashes = {};
const dstat = { houses: 0, bed2: 0, hall: 0, yard4: 0, yardN: 0, lshape: 0, garage: 0, office: 0, laundry: 0, shed: 0, pool: 0, layouts: new Set(), specials: new Set(), bedHist: {} };
for (const seed of seeds) {
  const t0 = performance.now();
  const m = WD.generate(seed);
  const dt = performance.now() - t0;
  times.push(dt);
  WD.setMap(m);
  const idx = (x, y) => y * m.w + x;
  if (dt > 300) fail(seed, `geração lenta: ${dt.toFixed(0)} ms`);
  const hsh = mapHash(m);
  hashes[seed] = hsh;
  if (goldenSeeds.includes(seed)) {
    if (mapHash(WD.generate(seed)) !== hsh) fail(seed, 'não determinístico (2 gerações diferentes)');
    WD.setMap(m);
    if (GOLDEN[seed] && GOLDEN[seed] !== hsh && !args.includes('--update-golden')) fail(seed, `hash de ouro mudou: ${GOLDEN[seed]} -> ${hsh} (rode --update-golden se foi intencional)`);
  }
  dstat.layouts.add(JSON.stringify(m.layout.orient) + m.layout.cols + 'x' + m.layout.rows);

  // início
  const sx = Math.floor(m.spawnPoint.x), sy = Math.floor(m.spawnPoint.y);
  if (WD.isBlocked(sx, sy, 'player')) fail(seed, 'ponto inicial bloqueado');
  const sb = m.building[idx(sx, sy)];
  if (!sb) fail(seed, 'ponto inicial fora de um prédio');
  else {
    const B = m.buildings[sb - 1];
    if (!B.start) fail(seed, 'prédio inicial sem start:true');
    const cont = m.objects.filter((o) => o.building === sb && o.container);
    if (!cont.length || cont.some((o) => o.container.lootKey.indexOf('start_') !== 0)) fail(seed, 'contêineres da casa inicial sem lootKey start_');
  }
  // objetos
  for (const o of m.objects) {
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) { fail(seed, `objeto ${o.type} fora do mapa`); continue; }
      const i = idx(x, y);
      if (m.wall[i]) fail(seed, `objeto ${o.type} sobre parede em ${x},${y}`);
      if (m.objAt[i] !== o.id) fail(seed, `objAt inconsistente para ${o.type} em ${x},${y}`);
      if (m.floor[i] === F.WATER || m.floor[i] === F.POOL) fail(seed, `objeto ${o.type} na água`);
    }
    const cs = CAR[o.type];
    if (cs && !((o.rot & 1) ? (o.w === cs[1] && o.h === cs[0]) : (o.w === cs[0] && o.h === cs[1]))) fail(seed, `${o.type} com pegada/rot incoerente ${o.w}x${o.h} rot ${o.rot}`);
    if (o.container && !o.container.lootKey) fail(seed, `contêiner sem lootKey (${o.type})`);
    if (o.type === 'fence_gate') fail(seed, 'objeto fence_gate (portão deve ser G.WALL.FENCE_GATE)');
  }
  if (m.objects.some((o, i) => o.id !== i)) fail(seed, 'ids de objeto fora de ordem');
  // pisos e estados
  let roadLine = 0, badState = 0;
  for (let i = 0; i < m.w * m.h; i++) {
    if (m.floor[i] === F.ROAD_LINE) roadLine++;
    const w = m.wall[i], st = m.wallState[i];
    if ((st & WS.BROKEN) && m.wallHp[i] > 0) badState++;
    if ((st & WS.OPEN) && (st & WS.LOCKED)) badState++;
    if (!w && st) badState++;
    if ((w === W.WOOD || w === W.BRICK || w === W.PLASTER || w === W.CONCRETE) && st) badState++;
    if (w && !m.wallMask[i] && !isFence(w)) {
      const x = i % m.w, y = (i / m.w) | 0; // parede sem conexão nenhuma é suspeita
      fail(seed, `parede isolada (wallMask 0) em ${x},${y}`);
    }
  }
  if (roadLine) fail(seed, `${roadLine} tiles com piso ROAD_LINE (use roadMarks)`);
  if (badState) fail(seed, `${badState} estados inconsistentes (quebrada com hp, aberta+trancada, bits em parede)`);
  if (!m.roadMarks.some((k) => k.type === 'center_dashed' || k.type === 'center_solid')) fail(seed, 'sem faixas centrais em roadMarks');
  if (!m.roadMarks.some((k) => k.type === 'crosswalk')) fail(seed, 'sem faixas de pedestre');
  // lotes/prédios
  const lotMask = new Int32Array(m.w * m.h).fill(-1);
  m.lots.forEach((l, li) => {
    for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) {
      const i = idx(x, y);
      if (lotMask[i] >= 0) { fail(seed, `lotes ${lotMask[i]} e ${li} sobrepostos em ${x},${y}`); return; }
      lotMask[i] = li;
    }
  });
  for (const b of m.buildings) {
    let cells = 0, lot = -2, walls = 0, partCells = 0;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const i = idx(x, y);
      if (m.building[i] !== b.id) continue;
      cells++; if (m.wall[i]) walls++;
      if (b.parts.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h)) partCells++;
      if (lot === -2) lot = lotMask[i]; else if (lotMask[i] !== lot) fail(seed, `prédio ${b.name} extrapola o lote`);
    }
    if (!cells) fail(seed, `prédio ${b.name} sem células`);
    if (!walls) fail(seed, `prédio ${b.name} sem paredes`);
    if (partCells !== cells) fail(seed, `prédio ${b.name}: parts não cobrem a pegada (${partCells}/${cells})`);
    if (!b.doors.length) fail(seed, `prédio ${b.name} sem porta externa`);
    for (const k of ['name', 'roofColor', 'wallColor', 'type', 'roofType', 'ridgeAxis', 'face']) if (!b[k]) fail(seed, `prédio ${b.id} sem ${k}`);
    if (!['gable', 'hip', 'flat'].includes(b.roofType)) fail(seed, `roofType inválido ${b.roofType}`);
  }
  for (const r of m.rooms) {
    let c = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = idx(x, y);
      if (m.room[i] === r.id) { c++; if (m.building[i] !== r.building) fail(seed, `cômodo ${r.id} com building errado`); }
    }
    if (!c) fail(seed, `cômodo ${r.id} (${r.type}) vazio`);
    if (r.type === 'garage' && m.buildings[r.building - 1].type === 'house' && (Math.min(r.w, r.h) < 4 || Math.max(r.w, r.h) < 6)) fail(seed, `garagem pequena ${r.w}x${r.h}`);
  }
  // portas/janelas
  for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
    const i = idx(x, y), w = m.wall[i];
    if (!isDoor(w) && !isWin(w)) continue;
    const freeT = (xx, yy) => { const j = idx(xx, yy); return !m.wall[j] && !(m.objAt[j] >= 0 && m.objects[m.objAt[j]].blocksMove) && m.floor[j] !== F.WATER; };
    const noWall = (xx, yy) => !m.wall[idx(xx, yy)] && m.floor[idx(xx, yy)] !== F.WATER;
    const ok = isDoor(w) ? (freeT(x - 1, y) && freeT(x + 1, y)) || (freeT(x, y - 1) && freeT(x, y + 1))
      : (noWall(x - 1, y) && noWall(x + 1, y)) || (noWall(x, y - 1) && noWall(x, y + 1));
    if (!ok && !(w === W.GARAGE_DOOR)) fail(seed, `${isDoor(w) ? 'porta' : 'janela'} em ${x},${y} sem os dois lados livres`);
    if (!WD.wallAxis(x, y)) fail(seed, `porta/janela sem eixo em ${x},${y}`);
    if (isWin(w)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = m.objAt[idx(x + dx, y + dy)];
      if (o >= 0 && m.objects[o].height >= 0.85 && m.objects[o].building) fail(seed, `móvel alto (${m.objects[o].type}) tapando janela em ${x},${y}`);
    }
  }
  // garagens: grupo de 3
  for (let i = 0; i < m.w * m.h; i++) if (m.wall[i] === W.GARAGE_DOOR) {
    const g = WD.structureGroup(i % m.w, (i / m.w) | 0);
    if (g.length < 2) fail(seed, `portão de garagem sem grupo em ${i % m.w},${(i / m.w) | 0}`);
  }
  // alcance
  const reachOpen = flood(m, sx, sy, 'open');
  const reachReal = flood(m, sx, sy, 'real');
  for (const r of m.rooms) {
    let a = false, b = false;
    for (let y = r.y; y < r.y + r.h && !(a && b); y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = idx(x, y);
      if (m.room[i] !== r.id) continue;
      if (reachOpen[i]) a = true;
      if (reachReal[i]) b = true;
    }
    const bn = m.buildings[r.building - 1].name;
    if (!a) fail(seed, `cômodo inalcançável (portas abertas): ${r.type} em ${bn} @${r.x},${r.y}`);
    else if (!b) fail(seed, `cômodo inalcançável (trancas/janelas): ${r.type} em ${bn} @${r.x},${r.y}`);
  }
  let pockets = 0;
  for (let i = 0; i < m.w * m.h; i++) {
    if (!m.room[i] || m.wall[i] || reachOpen[i]) continue;
    const o = m.objAt[i];
    if (o >= 0 && m.objects[o].blocksMove) continue;
    pockets++;
  }
  if (pockets) fail(seed, `${pockets} tiles internos isolados`);
  for (const o of m.objects) {
    if (!o.container || !o.building) continue;
    let acc = false;
    for (let y = o.y - 1; y <= o.y + o.h && !acc; y++) for (let x = o.x - 1; x <= o.x + o.w; x++) {
      const inside = x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h;
      const corner = (x < o.x || x >= o.x + o.w) && (y < o.y || y >= o.y + o.h);
      if (inside || corner || x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      if (reachOpen[idx(x, y)]) { acc = true; break; }
    }
    if (!acc) fail(seed, `contêiner inacessível: ${o.type} em ${o.x},${o.y}`);
  }
  let roadBad = 0;
  for (let i = 0; i < m.w * m.h; i++) {
    if (m.floor[i] === F.ASPHALT && !m.building[i] && !reachOpen[i]) {
      const o = m.objAt[i];
      if (o >= 0 && m.objects[o].blocksMove) continue;
      roadBad++;
    }
  }
  if (roadBad) fail(seed, `${roadBad} tiles de asfalto desconectados`);
  // zumbis
  if (m.zombieSpawns.length < 60) fail(seed, `poucos pontos de zumbi (${m.zombieSpawns.length})`);
  const groups = new Set(m.zombieSpawns.map((z) => z.group));
  if (groups.size > m.zombieSpawns.length * 0.8) fail(seed, 'pontos de zumbi não agrupados');
  for (const z of m.zombieSpawns) {
    if (!(z.weight > 0)) fail(seed, 'peso de zumbi inválido');
    if (Math.hypot(z.x - m.spawnPoint.x, z.y - m.spawnPoint.y) < 20) fail(seed, `ponto de zumbi a ${Math.hypot(z.x - m.spawnPoint.x, z.y - m.spawnPoint.y).toFixed(1)} do início`);
    if (WD.isBlocked(Math.floor(z.x), Math.floor(z.y), 'zombie')) fail(seed, `ponto de zumbi bloqueado ${z.x},${z.y}`);
  }
  // A* confirma alguns cômodos
  let pfFail = 0;
  for (const r of m.rooms.filter((_, i) => i % 9 === 0)) {
    let tx = -1, ty = -1;
    for (let y = r.y; y < r.y + r.h && tx < 0; y++) for (let x = r.x; x < r.x + r.w; x++) if (m.room[idx(x, y)] === r.id && !WD.isBlocked(x, y) && !m.wall[idx(x, y)]) { tx = x; ty = y; break; }
    if (tx < 0) continue;
    if (!WD.findPath(m.spawnPoint.x, m.spawnPoint.y, tx + 0.5, ty + 0.5, 'open', 90000)) pfFail++;
  }
  if (pfFail) fail(seed, `findPath falhou para ${pfFail} cômodos`);
  // distribuição das casas
  for (const l of m.lots) {
    if (l.kind !== 'house') continue;
    const b = m.buildings[l.buildings[0] - 1];
    const rs = m.rooms.filter((r) => r.building === b.id);
    const beds = rs.filter((r) => r.type === 'bedroom').length;
    dstat.houses++; dstat.bedHist[beds] = (dstat.bedHist[beds] || 0) + 1;
    if (beds >= 2) dstat.bed2++;
    if (rs.some((r) => r.type === 'hall')) dstat.hall++;
    if (rs.some((r) => r.type === 'garage')) dstat.garage++;
    if (rs.some((r) => r.type === 'office')) dstat.office++;
    if (rs.some((r) => r.type === 'storage')) dstat.laundry++;
    if (b.parts.length > 1) dstat.lshape++;
    const back = l.face === 'S' ? b.y - l.y : l.face === 'N' ? (l.y + l.h) - (b.y + b.h) : l.face === 'E' ? b.x - l.x : (l.x + l.w) - (b.x + b.w);
    dstat.yardN++; if (back >= 4) dstat.yard4++;
    if (l.buildings.length > 1) dstat.shed++;
    let pool = false;
    for (let y = l.y; y < l.y + l.h && !pool; y++) for (let x = l.x; x < l.x + l.w; x++) if (m.floor[idx(x, y)] === F.POOL) { pool = true; break; }
    if (pool) dstat.pool++;
  }
  for (const b of m.buildings) if (b.type !== 'house' && b.type !== 'shed' && b.type !== 'trailer') dstat.specials.add(b.name.split(' ')[0]);
  const houses = m.buildings.filter((b) => b.type === 'house').length;
  if (verbose || seed === seeds[0]) console.log(`seed ${seed}: ${dt.toFixed(0)} ms · ${m.buildings.length} prédios (${houses} casas) · ${m.rooms.length} cômodos · ${m.objects.length} objetos · ${m.zombieSpawns.length} pts zumbi · hash ${hsh}`);
  if (houses < 10) fail(seed, `poucas casas (${houses})`);
}
const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(0) + '%';
console.log(`casas: ${dstat.houses} · quartos ${JSON.stringify(dstat.bedHist)} · 2+ quartos ${pc(dstat.bed2, dstat.houses)} · corredor ${pc(dstat.hall, dstat.houses)} · garagem ${pc(dstat.garage, dstat.houses)} · escritório ${pc(dstat.office, dstat.houses)} · lavanderia ${pc(dstat.laundry, dstat.houses)} · planta em L ${pc(dstat.lshape, dstat.houses)} · galpão ${pc(dstat.shed, dstat.houses)} · piscina ${pc(dstat.pool, dstat.houses)} · quintal>=4 ${pc(dstat.yard4, dstat.yardN)}`);
console.log(`variedade: ${dstat.layouts.size} layouts distintos em ${seeds.length} seeds · prédios especiais vistos: ${[...dstat.specials].join(', ')}`);
if (dstat.bed2 < dstat.houses * 0.3) { failures++; console.log('  ✗ menos de 30% das casas com 2+ quartos'); }
if (dstat.hall < dstat.houses * 0.1) { failures++; console.log('  ✗ corredores raros (<10%)'); }
if (dstat.yard4 < dstat.yardN * 0.95) { failures++; console.log('  ✗ quintais rasos (<95% com >=4)'); }
if (dstat.lshape < dstat.houses * 0.2) { failures++; console.log('  ✗ plantas em L raras'); }
if (seeds.length >= 20 && dstat.layouts.size < 8) { failures++; console.log('  ✗ pouca variedade de layout'); }

// ------------------------------------------------------------------
// Testes de API
// ------------------------------------------------------------------
{
  const m = WD.generate(1337); WD.setMap(m);
  const events = [];
  for (const e of ['door:open', 'door:close', 'door:locked', 'door:break', 'window:locked', 'window:break', 'barricade:add', 'barricade:break', 'barricade:remove'])
    G.events.on(e, () => events.push(e));
  G.state = { map: m, decals: [], particles: [], zombies: [], corpses: [], groundItems: [], time: 0, player: null };
  const check = (c, msg) => { if (!c) { failures++; console.log('  ✗ API: ' + msg); } };
  let door = null, win = null, gar = null;
  for (let i = 0; i < m.w * m.h; i++) {
    const st = m.wallState[i];
    if (!door && m.wall[i] === W.DOOR && !(st & (WS.LOCKED | WS.OPEN | WS.BROKEN))) door = { x: i % m.w, y: (i / m.w) | 0 };
    if (!win && m.wall[i] === W.WINDOW && !(st & (WS.BROKEN | WS.CURTAIN))) win = { x: i % m.w, y: (i / m.w) | 0 };
    if (!gar && m.wall[i] === W.GARAGE_DOOR && !(st & (WS.LOCKED | WS.OPEN))) gar = { x: i % m.w, y: (i / m.w) | 0 };
  }
  check(door && win && gar, 'porta/janela/garagem de teste');
  check(WD.isBlocked(door.x + 0.5, door.y + 0.5) && WD.blocksSight(door.x + 0.7, door.y + 0.2), 'porta fechada bloqueia (coords float)');
  check(WD.setOpen(door.x, door.y, true) && !WD.isBlocked(door.x, door.y), 'abrir porta');
  check(!WD.setLocked(door.x, door.y, true), 'não tranca porta aberta');
  check(WD.setOpen(door.x, door.y, false) && WD.setLocked(door.x, door.y, true), 'fechar e trancar');
  events.length = 0;
  check(!WD.setOpen(door.x, door.y, true) && events.includes('door:locked'), 'porta trancada não abre');
  // barricada: soma/subtrai do hp atual, um evento por tábua
  check(WD.addBarricade(door.x, door.y) && WD.addBarricade(door.x, door.y), 'duas tábuas');
  WD.damageStructure(door.x, door.y, 25);
  check(Math.abs(WD.getStructure(door.x, door.y).barricadeHp - 35) < 1e-6 && WD.getStructure(door.x, door.y).barricade === 2, 'dano parcial na barricada');
  WD.addBarricade(door.x, door.y);
  check(Math.abs(WD.getStructure(door.x, door.y).barricadeHp - 65) < 1e-6, 'tábua nova soma ao hp atual (não cura)');
  events.length = 0;
  check(WD.damageStructure(door.x, door.y, 1000) === 'damaged' && events.filter((e) => e === 'barricade:break').length === 3, 'um evento por tábua quebrada');
  check(WD.getStructure(door.x, door.y).hp === 100, 'sobra de dano não passa para a porta');
  let res = '';
  for (let k = 0; k < 20 && res !== 'broken'; k++) res = WD.damageStructure(door.x, door.y, 10);
  const sd = WD.getStructure(door.x, door.y);
  check(res === 'broken' && !WD.isBlocked(door.x, door.y) && sd.hp === 0 && !sd.locked && !sd.open, 'porta arromba: passável, hp 0, estado coerente');
  // janela
  check(WD.isBlocked(win.x, win.y) && !WD.blocksSight(win.x, win.y), 'janela bloqueia andar mas não visão');
  WD.setLocked(win.x, win.y, true); events.length = 0;
  check(!WD.setOpen(win.x, win.y, true) && events.includes('window:locked'), 'janela trancada emite window:locked');
  WD.setLocked(win.x, win.y, false);
  check(WD.toggleCurtain(win.x, win.y) === true && WD.blocksSight(win.x, win.y), 'cortina'); WD.toggleCurtain(win.x, win.y);
  check(WD.breakWindow(win.x, win.y) && WD.getStructure(win.x, win.y).hp === 0 && WD.canClimb(win.x, win.y), 'quebrar janela');
  // portão de garagem em grupo
  const grp = WD.structureGroup(gar.x, gar.y);
  check(grp.length === 3, 'grupo do portão de garagem = 3 (' + grp.length + ')');
  events.length = 0;
  check(WD.setOpen(gar.x, gar.y, true) && grp.every((c) => !WD.isBlocked(c.x, c.y)) && events.length === 1, 'abrir portão abre os 3 tiles com 1 evento');
  WD.setOpen(gar.x, gar.y, false);
  WD.addBarricade(grp[1].x, grp[1].y);
  check(grp.every((c) => WD.getStructure(c.x, c.y).barricade === 1), 'barricada no grupo inteiro');
  WD.removeBarricade(gar.x, gar.y);
  for (let k = 0; k < 30; k++) WD.damageStructure(grp[2].x, grp[2].y, 10);
  check(grp.every((c) => WD.getStructure(c.x, c.y).broken), 'portão quebra inteiro');
  // itens: chão / objeto / inventário
  const fr = m.objects.find((o) => o.container && o.building && o.type === 'fridge');
  const d = [[1, 0], [0, 1], [-1, 0], [0, -1]][fr.rot];
  const px = fr.x + 0.5 + d[0], py = fr.y + 0.5 + d[1];
  const it1 = { uid: 9001, type: 'x' }, it2 = { uid: 9002, type: 'y' };
  WD.dropItem(px, py, it1);
  let list = WD.containersNear(px, py);
  const ground = list.find((c) => c.source === 'ground'), frE = list.find((c) => c.obj === fr);
  check(ground && frE, 'containersNear acha chão e geladeira');
  const inv = { name: 'Inventário', items: [], capacity: 20 };
  check(WD.transferItem(ground, inv, it1) && inv.items.includes(it1) && G.state.groundItems.length === 0, 'chão -> inventário sem duplicar');
  check(WD.transferItem(inv, frE, it1) && fr.container.items.includes(it1) && !inv.items.includes(it1), 'inventário -> objeto');
  check(WD.putInto(ground, it2) && G.state.groundItems.some((g) => g.item === it2), 'putInto no chão');
  // visão / caminho / colisão
  check(WD.lineOfSight(NaN, 5, 10, 10) === false, 'LOS com NaN = false');
  let wall = null;
  for (let i = m.w * 20; i < m.w * m.h && !wall; i++) if ((m.wall[i] === W.BRICK || m.wall[i] === W.WOOD) && !m.wall[i - 1] && !m.wall[i + 1] && !WD.isBlocked((i % m.w) - 1, (i / m.w) | 0) && !WD.isBlocked((i % m.w) + 1, (i / m.w) | 0)) wall = { x: i % m.w, y: (i / m.w) | 0 };
  check(!WD.lineOfSight(wall.x - 0.5, wall.y + 0.5, wall.x + 0.5, wall.y + 0.5) && WD.lineOfSight(wall.x - 0.5, wall.y + 0.5, wall.x + 0.5, wall.y + 0.5, true), 'ignoreDest');
  const e = { x: wall.x - 0.5, y: wall.y + 0.5 };
  WD.moveEntity(e, 3, 0, 0.3, 'player');
  check(e.x < wall.x, 'não atravessa parede com dt grande');
  const e2 = { x: wall.x - 0.5, y: wall.y + 0.5 };
  const r2 = WD.moveEntity(e2, 0.5, 0.2, 0.3, 'player');
  check(r2.hitX && e2.y > wall.y + 0.55, 'desliza na parede');
  const e3 = { x: wall.x + 0.5, y: wall.y + 0.5 };
  WD.moveEntity(e3, 0, 0, 0.3, 'player');
  check(!WD.isBlocked(e3.x, e3.y), 'entidade presa na parede é tirada (nearestFree)');
  const lake = m.lake && m.lake.c;
  if (lake) {
    const p = WD.findPath(m.spawnPoint.x, m.spawnPoint.y, lake.x + 0.5, lake.y + 0.5, 'player', 3000);
    const pp = WD.findPath(m.spawnPoint.x, m.spawnPoint.y, lake.x + 0.5, lake.y + 0.5, 'player', 3000, { partial: true });
    check(p === null && pp && pp.length > 0, 'findPath partial devolve caminho parcial');
  }
  let asym = 0, tot = 0;
  const R = G.util.rng(5);
  for (let k = 0; k < 4000; k++) {
    const x0 = 20 + R() * 140, y0 = 20 + R() * 140, x1 = x0 + (R() - 0.5) * 30, y1 = y0 + (R() - 0.5) * 30;
    if (WD.blocksSight(x0, y0) || WD.blocksSight(x1, y1)) continue;
    tot++; if (WD.lineOfSight(x0, y0, x1, y1) !== WD.lineOfSight(x1, y1, x0, y0)) asym++;
  }
  check(asym / tot < 0.01, `LOS assimétrica em ${asym}/${tot}`);
  // desempenho
  let t = performance.now(), cnt = 0;
  for (let k = 0; k < 200000; k++) if (WD.lineOfSight(20 + R() * 140, 20 + R() * 140, 20 + R() * 140, 20 + R() * 140)) cnt++;
  const tLos = performance.now() - t;
  t = performance.now();
  for (let k = 0; k < 1000000; k++) if (WD.isBlocked((k * 7919) % 180, (k * 104729) % 180, 'zombie')) cnt++;
  const tBlk = performance.now() - t;
  t = performance.now();
  let found = 0;
  for (let k = 0; k < 300; k++) if (WD.findPath(20 + R() * 140, 20 + R() * 140, 20 + R() * 140, 20 + R() * 140, 'zombie', 4000)) found++;
  const tPf = performance.now() - t;
  console.log(`desempenho: 200k LOS ${tLos.toFixed(0)} ms · 1M isBlocked ${tBlk.toFixed(0)} ms · 300 findPath ${tPf.toFixed(0)} ms (${found} achados) · geração média ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)} ms, máx ${Math.max(...times).toFixed(0)} ms`);
}

// ------------------------------------------------------------------
// Hash de ouro e Node × Chromium
// ------------------------------------------------------------------
if (args.includes('--update-golden')) {
  const tab = goldenSeeds.map((s) => `  ${s}: '${hashes[s] || mapHash(WD.generate(s))}',`).join('\n');
  const src = fs.readFileSync(self, 'utf8').replace(/const GOLDEN = \{[\s\S]*?\n\};/, `const GOLDEN = {\n  /*GOLDEN*/\n${tab}\n};`);
  fs.writeFileSync(self, src);
  console.log('hashes de ouro atualizados');
}
if (args.includes('--browser')) {
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
  const b = await pw.chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + path.join(root, 'tools/mapview.html') + '?seed=1&scale=1');
  await p.addScriptTag({ content: HASH_SRC + '; window.mapHash = mapHash;' });
  const bs = goldenSeeds.concat([123456, 777]);
  const r = await p.evaluate((ss) => ss.map((s) => window.mapHash(G.world.generate(s))), bs);
  let diff = 0;
  bs.forEach((s, i) => { const nh = hashes[s] || mapHash(WD.generate(s)); if (nh !== r[i]) { diff++; console.log(`  ✗ Node × Chromium diferem na seed ${s}: ${nh} vs ${r[i]}`); } });
  console.log(`Node × Chromium (${b.version()}): ${bs.length - diff}/${bs.length} seeds idênticas`);
  failures += diff;
  await b.close();
}

console.log(failures ? `FALHOU: ${failures} problema(s) em ${seeds.length} seeds` : `OK: ${seeds.length} seeds validadas, 0 problemas`);
process.exit(failures ? 1 : 0);
