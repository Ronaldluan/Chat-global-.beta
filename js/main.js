/* =====================================================================
 * VALE QUIETO — main.js
 * Boot, máquina de estados, loop principal, relógio, clima e luz.
 * Carregado POR ÚLTIMO.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G;
  const U = G.util;
  const C = G.CONST;

  // Ruído do mundo: qualquer módulo chama G.noise.emit(...). Zumbis escutam 'noise'.
  G.noise = {
    emit(x, y, radius, kind, extra) {
      const n = Object.assign({ x, y, radius, kind: kind || 'generic', t: G.state ? G.state.time : 0 }, extra || {});
      if (G.state) {
        G.state.noises.push(Object.assign({ life: 1 }, n));
        if (G.state.noises.length > 40) G.state.noises.shift();
      }
      G.events.emit('noise', n);
    },
  };

  const M = (G.main = {});

  function freshState(opts) {
    const seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    return {
      mode: 'playing',          // 'title' | 'playing' | 'paused' | 'dead'
      seed,
      rng: U.rng(seed ^ 0x9e3779b9),
      time: (opts.hour != null ? +opts.hour : C.START_HOUR) * 60, // minutos desde 00:00 do dia 1
      timeScale: 1,             // >1 durante o sono
      realTime: 0,              // segundos reais desde o início
      light: 1,                 // luz ambiente 0 (breu) .. 1 (meio-dia)
      weather: { rain: 0, rainTarget: 0, fog: 0.15, fogTarget: 0.15, wind: 0.2, cloud: 0.2, cloudTarget: 0.2, lightning: 0, storm: false, temperature: 24, nextChange: 60 },
      power: true,              // eletricidade (cai em algum dia entre 4 e 8)
      water: true,              // água encanada
      powerOffDay: 4 + ((seed >>> 3) % 5),
      waterOffDay: 5 + ((seed >>> 5) % 6),
      map: null,
      player: null,
      zombies: [],
      corpses: [],              // {x,y,dir,variant,time,container:{name,items}}
      groundItems: [],          // {x,y,item}
      decals: [],               // {x,y,type,size,rot,alpha,t}
      particles: [],            // visuais (render)
      noises: [],               // ruídos recentes (debug/visual)
      fov: null,                // preenchido por G.fov.compute
      stats: { kills: 0, itemsLooted: 0, distance: 0, startTime: 0, shotsFired: 0, cause: '' },
      opts,
    };
  }
  M.freshState = freshState;

  // ---------------------------------------------------------------
  // Novo jogo
  // ---------------------------------------------------------------
  M.newGame = function (opts) {
    opts = opts || {};
    const s = (G.state = freshState(opts));
    s.stats.startTime = s.time;
    s.map = G.world.generate(s.seed);
    s.player = G.player.create(s.map.spawnPoint, opts);
    if (G.survival && G.survival.initStats) G.survival.initStats(s.player);
    G.zombies.init(s);
    G.camera.x = s.player.x;
    G.camera.y = s.player.y;
    updateLight(s, 0);
    if (G.fov) G.fov.compute(s);
    G.events.emit('game:start', { state: s });
    M.setMode('playing');
    return s;
  };

  M.setMode = function (mode) {
    const s = G.state;
    const prev = s ? s.mode : 'title';
    if (s) s.mode = mode;
    M.mode = mode;
    if (mode === 'paused') G.events.emit('game:pause', {});
    if (prev === 'paused' && mode === 'playing') G.events.emit('game:resume', {});
    if (G.ui && G.ui.onModeChange) G.ui.onModeChange(mode, prev);
  };

  M.setTimeScale = function (k) { if (G.state) G.state.timeScale = k; };

  M.gameOver = function (cause) {
    const s = G.state;
    if (!s || s.mode === 'dead') return;
    s.stats.cause = cause || s.stats.cause || 'Desconhecida';
    s.timeScale = 1;
    G.events.emit('game:over', { cause: s.stats.cause, stats: s.stats, time: s.time });
    M.setMode('dead');
  };

  // ---------------------------------------------------------------
  // Relógio, luz e clima
  // ---------------------------------------------------------------
  function daylightAt(minOfDay) {
    const h = minOfDay / 60;
    // noite 21h–5h, amanhecer 5–7h, anoitecer 19–21h
    if (h < 5 || h >= 21.5) return 0;
    if (h < 7) return U.smoothstep(5, 7, h);
    if (h < 19) return 1;
    return 1 - U.smoothstep(19, 21.5, h);
  }
  M.daylightAt = daylightAt;

  function updateLight(s) {
    const minOfDay = s.time % 1440;
    const d = daylightAt(minOfDay);
    const w = s.weather;
    const overcast = 1 - w.cloud * 0.35 - w.rain * 0.2;
    const moon = 0.07; // luar mínimo
    s.light = U.clamp(moon + (1 - moon) * d * overcast + w.lightning * 0.8, 0, 1);
  }

  function updateWeather(s, dtMin) {
    const w = s.weather;
    const r = s.rng;
    w.nextChange -= dtMin;
    if (w.nextChange <= 0) {
      // escolhe novo "clima" a cada 1–6 horas de jogo
      w.nextChange = 60 + r() * 300;
      const roll = r();
      w.fogTarget = 0.05 + r() * 0.2;
      if (roll < 0.45) { w.rainTarget = 0; w.storm = false; w.cloudTarget = r() * 0.4; }
      else if (roll < 0.75) { w.rainTarget = 0.25 + r() * 0.35; w.storm = false; w.cloudTarget = 0.6 + r() * 0.3; }
      else if (roll < 0.88) { w.rainTarget = 0.8 + r() * 0.2; w.storm = true; w.cloudTarget = 1; }
      else { w.rainTarget = 0; w.storm = false; w.cloudTarget = 0.5; w.fogTarget = 0.5 + r() * 0.4; }
    }
    const k = Math.min(1, dtMin * 0.02);
    const wasRaining = w.rain > 0.1;
    w.rain = U.lerp(w.rain, w.rainTarget, k);
    w.cloud = U.lerp(w.cloud, w.cloudTarget, k);
    w.fog = U.lerp(w.fog, w.fogTarget, k * 0.6);
    // neblina matinal
    const h = (s.time % 1440) / 60;
    if (h > 4.5 && h < 8 && w.fogTarget < 0.35 && r() < 0.002) w.fogTarget = 0.45;
    if (h > 10 && w.fogTarget > 0.3 && !w.storm && r() < 0.01) w.fogTarget = 0.1;
    w.wind = U.clamp(0.2 + w.rain * 0.5 + (w.storm ? 0.3 : 0) + Math.sin(s.realTime * 0.05) * 0.1, 0, 1);
    const isRaining = w.rain > 0.1;
    if (isRaining && !wasRaining) G.events.emit('weather:rainStart', {});
    if (!isRaining && wasRaining) G.events.emit('weather:rainStop', {});
    // relâmpagos
    w.lightning = Math.max(0, w.lightning - dtMin * 0.25);
    if (w.storm && w.rain > 0.6 && r() < dtMin * 0.012) {
      w.lightning = 1;
      const dist = r();
      setTimeout(() => G.events.emit('weather:thunder', { intensity: 1 - dist * 0.7 }), 300 + dist * 2500);
    }
    // temperatura: julho, dia quente, noite amena, chuva esfria
    const base = 17 + 10 * Math.sin(((h - 9) / 24) * Math.PI * 2) * 0.5 + 5;
    w.temperature = base - w.rain * 5;
  }

  let lastHour = -1, lastDay = -1;
  function updateClock(s, dt) {
    const dtMin = dt * C.MINUTES_PER_SECOND * s.timeScale;
    s.time += dtMin;
    const t = U.formatTime(s.time);
    const hour = Math.floor((s.time % 1440) / 60);
    if (hour !== lastHour) {
      if (lastHour !== -1) {
        G.events.emit('time:hour', { hour, day: t.day });
        if (hour === 6) G.events.emit('time:dawn', { day: t.day });
        if (hour === 20) G.events.emit('time:dusk', { day: t.day });
      }
      lastHour = hour;
    }
    if (t.day !== lastDay) {
      if (lastDay !== -1) G.events.emit('time:day', { day: t.day });
      lastDay = t.day;
    }
    if (s.power && t.day >= s.powerOffDay && hour >= 14) {
      s.power = false;
      G.events.emit('power:off', {});
      G.say('As luzes piscam... e se apagam. A energia caiu.', 'warning');
    }
    if (s.water && t.day >= s.waterOffDay && hour >= 10) {
      s.water = false;
      G.events.emit('water:off', {});
    }
    return dtMin;
  }

  // ---------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------
  let lastT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    try {
      step(dt);
    } catch (e) {
      console.error('[loop]', e);
    }
  }

  function step(dt) {
    const s = G.state;
    const I = G.input;
    G.camera.viewW = M.canvas.width;
    G.camera.viewH = M.canvas.height;

    if (I.hit('Escape') && s && (s.mode === 'playing' || s.mode === 'paused')) {
      if (!(G.ui && G.ui.handleEscape && G.ui.handleEscape())) M.setMode(s.mode === 'playing' ? 'paused' : 'playing');
    }

    if (s && s.mode === 'playing') {
      s.realTime += dt;
      const dtMin = updateClock(s, dt);
      updateWeather(s, dtMin);
      updateLight(s);
      I.updateWorldMouse();
      G.player.update(dt, dtMin);
      if (G.survival && G.survival.update) G.survival.update(s.player, dtMin, dt);
      G.zombies.update(dt, dtMin);
      if (G.world.update) G.world.update(dt, dtMin);
      for (let i = s.noises.length - 1; i >= 0; i--) {
        s.noises[i].life -= dt;
        if (s.noises[i].life <= 0) s.noises.splice(i, 1);
      }
      if (G.fov) G.fov.compute(s);
      // câmera segue o jogador suavemente (com leve antecipação na direção do mouse)
      const p = s.player;
      const lead = p.aiming ? 0.35 : 0.08;
      const tx = U.lerp(p.x, I.mouse.wx, lead), ty = U.lerp(p.y, I.mouse.wy, lead);
      const k = 1 - Math.pow(0.0005, dt);
      G.camera.x = U.lerp(G.camera.x, tx, k);
      G.camera.y = U.lerp(G.camera.y, ty, k);
      if (p && !p.alive && s.mode === 'playing') M.gameOver(s.stats.cause);
    } else if (s && s.mode === 'dead') {
      s.realTime += dt;
      updateLight(s);
      G.zombies.update(dt, 0); // o mundo continua...
    }

    G.camera.update(dt);
    if (s) I.updateWorldMouse();
    if (G.audio && G.audio.update) G.audio.update(dt, s);
    if (G.ui && G.ui.update) G.ui.update(dt, s);
    G.render.draw(s, dt);
    I.endFrame();
  }

  // ---------------------------------------------------------------
  // Debug (?debug=1): acessível também via window.G.debug no console
  // ---------------------------------------------------------------
  G.debug = {
    enabled: G.params.debug === '1',
    god: false,
    teleport(x, y) { const p = G.state.player; p.x = x; p.y = y; G.camera.x = x; G.camera.y = y; },
    setHour(h) { const s = G.state; s.time = Math.floor(s.time / 1440) * 1440 + h * 60; },
    rain(v) { const w = G.state.weather; w.rain = w.rainTarget = v; w.cloud = w.cloudTarget = Math.max(w.cloud, v); w.nextChange = 9999; },
    fog(v) { const w = G.state.weather; w.fog = w.fogTarget = v; w.nextChange = 9999; },
    storm(on) { const w = G.state.weather; w.storm = !!on; if (on) this.rain(1); },
    give(type, n) { for (let i = 0; i < (n || 1); i++) G.state.player.inventory.items.push(G.items.create(type)); },
    spawnZombie(x, y) { return G.zombies.spawn(x, y); },
    zoomTo(z) { G.camera.zoom = z; },
  };

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  M.boot = function () {
    const canvas = document.getElementById('game');
    M.canvas = canvas;
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (G.render.resize) G.render.resize(canvas.width, canvas.height);
    }
    window.addEventListener('resize', resize);
    resize();
    G.input.attach(canvas);
    G.render.init(canvas);
    if (G.ui && G.ui.init) G.ui.init();
    if (G.audio && G.audio.init) {
      const unlock = () => { G.audio.init(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    }
    M.mode = 'title';
    if (G.params.autostart === '1') {
      M.newGame({
        seed: G.params.seed != null ? +G.params.seed : 1337,
        hour: G.params.hour != null ? +G.params.hour : undefined,
        name: 'Teste',
        profession: G.params.profession || 'unemployed',
      });
    } else if (G.ui && G.ui.showTitle) {
      G.ui.showTitle();
    }
    lastT = performance.now();
    requestAnimationFrame(frame);
  };

  window.addEventListener('load', () => M.boot());
})();
