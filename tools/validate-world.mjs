#!/usr/bin/env node
/* =====================================================================
 * Validação automática do mundo (js/world.js) — roda em Node, sem navegador.
 *   node tools/validate-world.mjs [--seeds 1,42,1337] [--n 20] [--verbose]
 * Para cada seed verifica: tempo de geração, ponto inicial livre, objetos fora
 * de paredes/sobrepostos, lotes/prédios sem sobreposição, portas e janelas com
 * os dois lados livres, todo cômodo alcançável a partir do início (portas
 * abertas; e de forma realista: trancadas bloqueiam, janelas se pulam), contêineres
 * acessíveis, ruas conectadas, pontos de zumbi coerentes. Também testa a API
 * (colisão, visão, A*, portas/janelas/barricadas) e mede desempenho.
 * Sai com código 1 se algo falhar.
 * ===================================================================== */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const verbose = args.includes('--verbose');

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
const nRand = +arg('n', 20);
if (!seeds.length) { seeds = [1, 7, 42, 1337, 2024, 99999]; for (let i = 0; i < nRand; i++) seeds.push((i * 2654435761) >>> 0); }

let failures = 0;
const fail = (seed, msg) => { failures++; console.log(`  ✗ [seed ${seed}] ${msg}`); };

const isDoor = (w) => w === W.DOOR || w === W.GARAGE_DOOR;
const isWin = (w) => w === W.WINDOW || w === W.GLASS;

// Flood fill a partir do início. mode 'open': portas passam; 'real': trancadas não, janelas sim
function flood(m, sx, sy, mode) {
  const n = m.w * m.h, seen = new Uint8Array(n), q = new Int32Array(n);
  let h = 0, t = 0;
  const s = sy * m.w + sx; seen[s] = 1; q[t++] = s;
  const interior = (i) => { const b = m.building[i]; const x = i % m.w; return m.building[i - 1] === b && m.building[i + 1] === b && m.building[i - m.w] === b && m.building[i + m.w] === b; };
  const pass = (i) => {
    if (m.floor[i] === F.WATER) return false;
    const o = m.objAt[i];
    if (o >= 0 && m.objects[o].blocksMove) return false;
    const w = m.wall[i];
    if (!w) return true;
    const st = m.wallState[i];
    // realista: portas externas trancadas bloqueiam; internas trancadas se arrombam; janelas e cercas se pulam
    if (isDoor(w)) return mode === 'open' ? true : !(st & WS.LOCKED) || (st & (WS.OPEN | WS.BROKEN)) || interior(i);
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

const times = [];
for (const seed of seeds) {
  const t0 = performance.now();
  const m = WD.generate(seed);
  const dt = performance.now() - t0;
  times.push(dt);
  WD.setMap(m);
  if (dt > 300) fail(seed, `geração lenta: ${dt.toFixed(0)} ms`);
  const idx = (x, y) => y * m.w + x;

  // ponto inicial
  const sx = Math.floor(m.spawnPoint.x), sy = Math.floor(m.spawnPoint.y);
  if (WD.isBlocked(sx, sy, 'player')) fail(seed, 'ponto inicial bloqueado');
  const sb = m.building[idx(sx, sy)];
  if (!sb) fail(seed, 'ponto inicial fora de um prédio');
  const sroom = WD.roomAt(m.spawnPoint.x, m.spawnPoint.y);
  if (!sroom) fail(seed, 'ponto inicial fora de um cômodo');

  // objetos
  for (const o of m.objects) {
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) { fail(seed, `objeto ${o.type} fora do mapa`); continue; }
      const i = idx(x, y);
      if (m.wall[i]) fail(seed, `objeto ${o.type} sobre parede em ${x},${y}`);
      if (m.objAt[i] !== o.id) fail(seed, `objAt inconsistente para ${o.type} em ${x},${y}`);
      if (m.floor[i] === F.WATER) fail(seed, `objeto ${o.type} na água`);
    }
    const car = o.type === 'car' || o.type === 'police_car' || o.type === 'ambulance';
    if (car && !((o.rot & 1) ? (o.w === 1 && o.h === 2) : (o.w === 2 && o.h === 1))) fail(seed, `carro com pegada/rot incoerente ${o.w}x${o.h} rot ${o.rot}`);
    if (o.container && !o.container.lootKey) fail(seed, `contêiner sem lootKey (${o.type})`);
  }
  if (m.objects.some((o, i) => o.id !== i)) fail(seed, 'ids de objeto fora de ordem');

  // lotes/prédios sem sobreposição
  const lotMask = new Int32Array(m.w * m.h).fill(-1);
  m.lots.forEach((l, li) => {
    for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) {
      const i = idx(x, y);
      if (lotMask[i] >= 0) { fail(seed, `lotes ${lotMask[i]} e ${li} sobrepostos em ${x},${y}`); return; }
      lotMask[i] = li;
    }
  });
  for (const b of m.buildings) {
    let cells = 0, lot = -2, walls = 0;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const i = idx(x, y);
      if (m.building[i] !== b.id) continue;
      cells++; if (m.wall[i]) walls++;
      if (lot === -2) lot = lotMask[i]; else if (lotMask[i] !== lot) fail(seed, `prédio ${b.name} extrapola o lote`);
    }
    if (!cells) fail(seed, `prédio ${b.name} sem células`);
    if (!walls) fail(seed, `prédio ${b.name} sem paredes`);
    if (!b.doors.length) fail(seed, `prédio ${b.name} sem porta externa`);
    if (!b.name || !b.roofColor || !b.wallColor || !b.type) fail(seed, `prédio ${b.id} sem metadados`);
  }
  // paredes de prédio têm building; cômodos coerentes
  for (const r of m.rooms) {
    let c = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = idx(x, y);
      if (m.room[i] === r.id) { c++; if (m.building[i] !== r.building) fail(seed, `cômodo ${r.id} com building errado`); }
    }
    if (!c) fail(seed, `cômodo ${r.id} (${r.type}) vazio`);
  }

  // portas e janelas: dois lados livres num eixo
  let doors = 0, wins = 0, locked = 0;
  for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
    const i = idx(x, y), w = m.wall[i];
    if (!isDoor(w) && !isWin(w)) continue;
    if (isDoor(w)) { doors++; if (m.wallState[i] & WS.LOCKED) locked++; } else wins++;
    const freeT = (xx, yy) => { const j = idx(xx, yy); return !m.wall[j] && !(m.objAt[j] >= 0 && m.objects[m.objAt[j]].blocksMove) && m.floor[j] !== F.WATER; };
    const noWall = (xx, yy) => !m.wall[idx(xx, yy)] && m.floor[idx(xx, yy)] !== F.WATER;
    const ok = isDoor(w) ? (freeT(x - 1, y) && freeT(x + 1, y)) || (freeT(x, y - 1) && freeT(x, y + 1))
      : (noWall(x - 1, y) && noWall(x + 1, y)) || (noWall(x, y - 1) && noWall(x, y + 1)); // janela: móvel baixo na frente é permitido
    if (!ok) fail(seed, `${isDoor(w) ? 'porta' : 'janela'} em ${x},${y} sem os dois lados livres`);
    if (!m.building[i]) fail(seed, `porta/janela ${x},${y} sem building`);
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
  // todo tile livre de cômodo alcançável (sem bolsões isolados pela mobília)
  let pockets = 0;
  for (let i = 0; i < m.w * m.h; i++) {
    if (!m.room[i] || m.wall[i] || reachOpen[i]) continue;
    const o = m.objAt[i];
    if (o >= 0 && m.objects[o].blocksMove) continue;
    pockets++;
    if (verbose) console.log('   bolsão em', i % m.w, (i / m.w) | 0);
  }
  if (pockets) fail(seed, `${pockets} tiles internos isolados`);
  // contêineres acessíveis
  for (const o of m.objects) {
    if (!o.container) continue;
    let acc = false;
    for (let y = o.y - 1; y <= o.y + o.h && !acc; y++) for (let x = o.x - 1; x <= o.x + o.w; x++) {
      const inside = x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h;
      const corner = (x < o.x || x >= o.x + o.w) && (y < o.y || y >= o.y + o.h);
      if (inside || corner || x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      if (reachOpen[idx(x, y)]) { acc = true; break; }
    }
    if (!acc && o.building) fail(seed, `contêiner inacessível: ${o.type} em ${o.x},${o.y}`);
  }
  // ruas conectadas
  let roadBad = 0;
  for (let i = 0; i < m.w * m.h; i++) {
    const f = m.floor[i];
    if ((f === F.ASPHALT || f === F.ROAD_LINE) && !m.building[i] && !reachOpen[i]) {
      const o = m.objAt[i];
      if (o >= 0 && m.objects[o].blocksMove) continue;
      roadBad++;
    }
  }
  if (roadBad) fail(seed, `${roadBad} tiles de rua desconectados`);
  // zumbis
  if (m.zombieSpawns.length < 50) fail(seed, `poucos pontos de zumbi (${m.zombieSpawns.length})`);
  for (const z of m.zombieSpawns) {
    if (!(z.weight > 0)) fail(seed, 'peso de zumbi inválido');
    if (m.building[idx(Math.floor(z.x), Math.floor(z.y))] === sb) fail(seed, 'ponto de zumbi dentro da casa inicial');
    if (WD.isBlocked(Math.floor(z.x), Math.floor(z.y), 'zombie')) fail(seed, `ponto de zumbi bloqueado ${z.x},${z.y}`);
  }
  // A* confirma alguns cômodos (portas abertas)
  let pfFail = 0;
  for (const r of m.rooms.filter((_, i) => i % 7 === 0)) {
    let tx = -1, ty = -1;
    for (let y = r.y; y < r.y + r.h && tx < 0; y++) for (let x = r.x; x < r.x + r.w; x++) if (m.room[idx(x, y)] === r.id && !WD.isBlocked(x, y) && !m.wall[idx(x, y)]) { tx = x; ty = y; break; }
    if (tx < 0) continue;
    const p = WD.findPath(m.spawnPoint.x, m.spawnPoint.y, tx + 0.5, ty + 0.5, 'open', 60000);
    if (!p) pfFail++;
  }
  if (pfFail) fail(seed, `findPath falhou para ${pfFail} cômodos`);

  const houses = m.buildings.filter((b) => b.type === 'house').length;
  const cont = m.objects.filter((o) => o.container).length;
  if (verbose || seed === seeds[0]) console.log(`seed ${seed}: ${dt.toFixed(0)} ms · ${m.buildings.length} prédios (${houses} casas) · ${m.rooms.length} cômodos · ${m.objects.length} objetos · ${cont} contêineres · ${doors} portas (${locked} trancadas) · ${wins} janelas · ${m.zombieSpawns.length} pts zumbi`);
  if (houses < 10) fail(seed, `poucas casas (${houses})`);
}

// ------------------------------------------------------------------
// Testes de API em um mapa
// ------------------------------------------------------------------
const m = WD.generate(1337); WD.setMap(m);
const events = [];
for (const e of ['door:open', 'door:close', 'door:locked', 'door:break', 'window:break', 'barricade:add', 'barricade:break']) G.events.on(e, (d) => events.push(e));
G.state = { map: m, decals: [], particles: [], zombies: [], corpses: [], groundItems: [], time: 0, player: null };
const check = (c, msg) => { if (!c) { failures++; console.log('  ✗ API: ' + msg); } };
// acha uma porta de casa
let door = null, win = null;
for (let i = 0; i < m.w * m.h && (!door || !win); i++) {
  if (!door && m.wall[i] === W.DOOR && !(m.wallState[i] & (WS.LOCKED | WS.OPEN | WS.BROKEN))) door = { x: i % m.w, y: (i / m.w) | 0 };
  if (!win && m.wall[i] === W.WINDOW && !(m.wallState[i] & (WS.BROKEN | WS.CURTAIN))) win = { x: i % m.w, y: (i / m.w) | 0 };
}
check(door && win, 'porta/janela de teste');
check(WD.isBlocked(door.x, door.y) && WD.blocksSight(door.x, door.y), 'porta fechada bloqueia');
check(WD.setOpen(door.x, door.y, true) && !WD.isBlocked(door.x, door.y) && !WD.blocksSight(door.x, door.y), 'abrir porta');
check(WD.setOpen(door.x, door.y, false) && WD.isBlocked(door.x, door.y), 'fechar porta');
m.wallState[door.y * m.w + door.x] |= WS.LOCKED;
check(!WD.setOpen(door.x, door.y, true) && events.includes('door:locked'), 'porta trancada não abre');
check(WD.addBarricade(door.x, door.y) && WD.getStructure(door.x, door.y).barricade === 1, 'barricada');
check(WD.damageStructure(door.x, door.y, 40) === 'damaged' && WD.getStructure(door.x, door.y).barricade === 0, 'barricada absorve dano');
let res = '';
for (let k = 0; k < 20 && res !== 'broken'; k++) res = WD.damageStructure(door.x, door.y, 10);
check(res === 'broken' && !WD.isBlocked(door.x, door.y) && events.includes('door:break'), 'porta arromba e vira passável');
check(WD.isBlocked(win.x, win.y) && !WD.blocksSight(win.x, win.y), 'janela bloqueia andar mas não visão');
WD.toggleCurtain(win.x, win.y); check(WD.blocksSight(win.x, win.y), 'cortina bloqueia visão'); WD.toggleCurtain(win.x, win.y);
check(WD.breakWindow(win.x, win.y) && WD.isBlocked(win.x, win.y) && G.state.decals.length > 0 && events.includes('window:break'), 'quebrar janela');
check(WD.canClimb(win.x, win.y), 'janela quebrada escalável');
// colisão: atravessar parede com passo gigante não pode
let wallT = null;
for (let i = m.w * 10; i < m.w * m.h && !wallT; i++) if (m.wall[i] === W.BRICK || m.wall[i] === W.WOOD) {
  const x = i % m.w, y = (i / m.w) | 0;
  if (!m.wall[i - 1] && !m.wall[i + 1] && !WD.isBlocked(x - 1, y) && !WD.isBlocked(x + 1, y)) wallT = { x, y };
}
if (wallT) {
  const e = { x: wallT.x - 0.5, y: wallT.y + 0.5 };
  WD.moveEntity(e, 3, 0, 0.3, 'player');
  check(e.x < wallT.x, 'não atravessa parede com dt grande (x=' + e.x.toFixed(2) + ')');
  const e2 = { x: wallT.x - 0.5, y: wallT.y + 0.5 };
  const r = WD.moveEntity(e2, 0.5, 0.2, 0.3, 'player');
  check(r.hitX && e2.y > wallT.y + 0.55, 'desliza na parede');
}
// linha de visão: simétrica na maioria dos casos
let asym = 0, tot = 0;
const R = G.util.rng(5);
for (let k = 0; k < 4000; k++) {
  const x0 = 20 + R() * 100, y0 = 20 + R() * 100, x1 = x0 + (R() - 0.5) * 30, y1 = y0 + (R() - 0.5) * 30;
  if (WD.blocksSight(Math.floor(x0), Math.floor(y0)) || WD.blocksSight(Math.floor(x1), Math.floor(y1))) continue;
  tot++; if (WD.lineOfSight(x0, y0, x1, y1) !== WD.lineOfSight(x1, y1, x0, y0)) asym++;
}
check(asym / tot < 0.01, `LOS assimétrica em ${asym}/${tot}`);
// desempenho
let t = performance.now(), cnt = 0;
for (let k = 0; k < 200000; k++) if (WD.lineOfSight(20 + R() * 100, 20 + R() * 100, 20 + R() * 100, 20 + R() * 100)) cnt++;
const tLos = performance.now() - t;
t = performance.now();
for (let k = 0; k < 1000000; k++) if (WD.isBlocked((R() * 140) | 0, (R() * 140) | 0, 'zombie')) cnt++;
const tBlk = performance.now() - t;
t = performance.now();
let found = 0;
for (let k = 0; k < 300; k++) if (WD.findPath(20 + R() * 100, 20 + R() * 100, 20 + R() * 100, 20 + R() * 100, 'zombie', 4000)) found++;
const tPf = performance.now() - t;
console.log(`desempenho: 200k LOS (longas) ${tLos.toFixed(0)} ms · 1M isBlocked ${tBlk.toFixed(0)} ms · 300 findPath ${tPf.toFixed(0)} ms (${found} achados) · geração média ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)} ms, máx ${Math.max(...times).toFixed(0)} ms`);

console.log(failures ? `FALHOU: ${failures} problema(s) em ${seeds.length} seeds` : `OK: ${seeds.length} seeds validadas, 0 problemas`);
process.exit(failures ? 1 : 0);
