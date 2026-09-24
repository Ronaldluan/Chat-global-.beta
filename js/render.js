/* STUB — substituído na etapa "Render" */
(function () {
  const G = window.G, C = G.CONST;
  let ctx;
  G.fov = { compute(s) {}, canSee() { return true; } };
  G.render = {
    init(canvas) { ctx = canvas.getContext('2d'); },
    resize() {},
    draw(s) {
      const cv = ctx.canvas;
      ctx.fillStyle = '#0b0d0c'; ctx.fillRect(0, 0, cv.width, cv.height);
      if (!s || !s.map) return;
      const m = s.map, cols = ['#000', '#3d5a2a', '#6b5536', '#333', '#777', '#7a5a3a', '#999', '#633', '#888', '#246', '#cc4'];
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const p = G.iso.toScreen(x, y);
        if (p.x < -64 || p.y < -64 || p.x > cv.width + 64 || p.y > cv.height + 64) continue;
        ctx.fillStyle = m.wall[y * m.w + x] ? '#aaa' : cols[m.floor[y * m.w + x]] || '#f0f';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 32, p.y + 16); ctx.lineTo(p.x, p.y + 32); ctx.lineTo(p.x - 32, p.y + 16); ctx.fill();
      }
      const pp = G.iso.toScreen(s.player.x, s.player.y);
      ctx.fillStyle = '#fff'; ctx.fillRect(pp.x - 6, pp.y - 30, 12, 30);
    },
  };
})();
