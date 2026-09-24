/* STUB — substituído na etapa "Mundo" */
(function () {
  const G = window.G, C = G.CONST, F = G.FLOOR, W = G.WALL;
  const WD = (G.world = {});
  WD.generate = function (seed) {
    const w = C.MAP_W, h = C.MAP_H, n = w * h;
    const m = { w, h, floor: new Uint8Array(n).fill(F.GRASS), wall: new Uint8Array(n), wallState: new Uint8Array(n),
      wallHp: new Float32Array(n), building: new Uint16Array(n), room: new Uint16Array(n), objAt: new Int32Array(n).fill(-1),
      buildings: [], rooms: [], objects: [], spawnPoint: { x: 70.5, y: 70.5 }, zombieSpawns: [] };
    for (let y = 0; y < h; y++) for (let x = 60; x < 64; x++) m.floor[y * w + x] = F.ASPHALT;
    return m;
  };
  WD.idx = (x, y) => y * G.state.map.w + x;
  WD.inBounds = (x, y) => x >= 0 && y >= 0 && x < G.state.map.w && y < G.state.map.h;
  WD.isBlocked = function (tx, ty) { const m = G.state.map; if (!WD.inBounds(tx, ty)) return true; return m.wall[ty * m.w + tx] !== 0; };
  WD.blocksSight = function (tx, ty) { return WD.isBlocked(tx, ty); };
  WD.lineOfSight = function () { return true; };
  WD.moveEntity = function (e, dx, dy, r) { e.x += dx; e.y += dy; return { hitX: false, hitY: false }; };
  WD.isIndoors = function () { return 0; };
  WD.getObject = function () { return null; };
  WD.containersNear = function () { return []; };
  WD.update = function () {};
})();
