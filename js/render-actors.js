/* =====================================================================
 * VALE QUIETO — render-actors.js  (Etapa 2: Render)
 * Humanos e zumbis procedurais: um pequeno esqueleto 3D (metros) em
 * coordenadas locais (f = frente, r = direita, z = altura), projetado em
 * isométrico com rotação contínua (qualquer direção), ordenação das partes
 * por profundidade, ciclos de caminhada/corrida/furtivo, poses de ataque
 * (golpe com arma, facada, empurrão), mira/tiro, pulo de janela, dor,
 * morte, zumbi trôpego, cambaleio, caído, rastejante, comendo, batendo.
 * Cadáveres com poça de sangue.
 * ===================================================================== */
(function () {
  'use strict';
  const G = window.G, R = G.R, U = G.util;
  const RA = (R.actors = {});
  const ZPX = R.ZPX;
  const animData = new WeakMap();

  // ------------------------------------------------------------------
  // Aparência
  // ------------------------------------------------------------------
  const Z_SKIN = ['#9aa08a', '#8f9a7e', '#a4a28c', '#86907a', '#9c9480', '#7e8672', '#a89a88', '#8a8a7a'];
  const CLOTH = ['#5a6a7a', '#7a4a3a', '#4a5a3a', '#8a7a5a', '#3a3a44', '#6a5a6a', '#9a8a6a', '#4a6a6a', '#7a6a4a', '#5a4a3a', '#a0a098', '#2a3a5a', '#8a3a3a', '#c8c0a8'];
  const PANTS = ['#3a4250', '#4a4034', '#2e3238', '#5a5048', '#6a6456', '#3a3a3a', '#44506a', '#6a5a44'];
  const HAIR = ['#2a2018', '#4a3624', '#6a5030', '#8a7a60', '#3a3a38', '#9a9488', '#5a3a2a', '#1a1a1a', '#b8a078'];
  const H_SKIN = ['#e0bc9c', '#c89878', '#a8785a', '#7a5238', '#d8b090', '#5e3e2c'];
  const col = (v, pal, def) => (v == null ? def : typeof v === 'string' ? v : pal[((v | 0) % pal.length + pal.length) % pal.length]);

  function zombieLook(z) {
    let lk = animData.get(z);
    lk = lk && lk.look;
    if (lk) return lk;
    const v = z.variant || {};
    const id = z.id != null ? z.id : 1;
    const h = (k) => R.hash(id, k, 911);
    const female = v.female != null ? !!v.female : h(1) < 0.45;
    lk = {
      skin: R.hex(col(v.skin, Z_SKIN, Z_SKIN[(h(2) * Z_SKIN.length) | 0])),
      shirt: R.hex(col(v.shirt, CLOTH, CLOTH[(h(3) * CLOTH.length) | 0])),
      pants: R.hex(col(v.pants, PANTS, PANTS[(h(4) * PANTS.length) | 0])),
      hair: R.hex(col(v.hair, HAIR, HAIR[(h(5) * HAIR.length) | 0])),
      hairStyle: v.hairStyle != null ? v.hairStyle | 0 : female ? 2 + ((h(6) * 3) | 0) : (h(6) * 3) | 0,
      female,
      blood: v.blood != null ? +v.blood : 0.2 + h(7) * 0.7,
      shoes: '#2a2622',
      zombie: true,
      torn: h(8),
      longSleeve: h(9) < 0.4,
      oneShoe: h(10) < 0.2,
      seed: id,
    };
    lk.shirt = R.darken(R.desat(lk.shirt, 0.25), 0.1);
    lk.pants = R.darken(R.desat(lk.pants, 0.2), 0.1);
    return lk;
  }
  function playerLook(p) {
    const v = p.look || p.variant || {};
    return {
      skin: R.hex(col(v.skin, H_SKIN, '#d8b494')),
      shirt: R.hex(col(v.shirt, CLOTH, '#4f6a76')),
      pants: R.hex(col(v.pants, PANTS, '#39414d')),
      hair: R.hex(col(v.hair, HAIR, '#3a2a1e')),
      hairStyle: v.hairStyle != null ? v.hairStyle | 0 : v.female ? 3 : 1,
      female: !!v.female,
      blood: v.blood || 0,
      shoes: v.shoes || '#3a2e26',
      zombie: false,
      longSleeve: true,
      jacket: v.jacket != null ? v.jacket : true,
      seed: 7,
    };
  }
  RA.zombieLook = zombieLook;
  RA.playerLook = playerLook;
  // usados pela galeria (tools/gallery.html)
  RA.makePose = (o) => makePose(o);
  RA.lyingPose = (faceUp, t, kind, crawl, seed) => lyingPose(faceUp, t, kind, crawl, seed);

  // ------------------------------------------------------------------
  // Animação: fase da passada pelo deslocamento real (funciona com stubs)
  // ------------------------------------------------------------------
  RA.track = function (e, dt, realT) {
    let a = animData.get(e);
    if (!a) { a = { px: e.x, py: e.y, phase: R.hash(e.id || 3, 1, 5) * 6.28, spd: 0, t: 0, look: null, swayP: R.hash(e.id || 3, 2, 6) * 6.28, lastDir: e.dir || 0, turn: 0 }; animData.set(e, a); }
    const dx = e.x - a.px, dy = e.y - a.py;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d > 2) d = 0; // teleporte
    a.px = e.x; a.py = e.y;
    const sp = dt > 0 ? d / dt : 0;
    a.spd += (sp - a.spd) * Math.min(1, dt * 10);
    a.t += dt;
    a.phase += d * (e.running ? 3.3 : 4.3);
    return a;
  };
  RA.data = (e) => animData.get(e);

  // ------------------------------------------------------------------
  // Armas
  // ------------------------------------------------------------------
  function weaponKind(item) {
    if (!item) return null;
    const t = String(item.type || '').toLowerCase();
    const d = G.items && G.items.def ? G.items.def(item) : null;
    const firearm = d && (d.cat === 'firearm' || d.firearm);
    if (/shotgun|escopeta/.test(t)) return 'shotgun';
    if (/rifle|carbine|hunting/.test(t)) return 'rifle';
    if (/pistol|revolver|handgun|glock|m9|magnum/.test(t)) return 'pistol';
    if (firearm) return 'pistol';
    if (/flashlight|lanterna|torch/.test(t)) return 'flashlight';
    if (/axe|machado|hatchet/.test(t)) return /hatchet/.test(t) ? 'hatchet' : 'axe';
    if (/knife|faca/.test(t)) return 'knife';
    if (/machete/.test(t)) return 'machete';
    if (/crowbar|pe_de_cabra/.test(t)) return 'crowbar';
    if (/hammer|martelo/.test(t)) return /sledge/.test(t) ? 'sledge' : 'hammer';
    if (/shovel|pa$|spade/.test(t)) return 'shovel';
    if (/pan|frigideira/.test(t)) return 'pan';
    if (/golf/.test(t)) return 'golf';
    if (/plank|tabua|board/.test(t)) return 'plank';
    if (/pipe|cano/.test(t)) return 'pipe';
    if (/bat|taco/.test(t)) return 'bat';
    if (/wrench|chave/.test(t)) return 'wrench';
    if (d && (d.cat === 'weapon' || d.weapon)) return d.weapon && d.weapon.blade ? 'machete' : 'pipe';
    return 'item';
  }
  RA.weaponKind = weaponKind;
  const TWO_HANDED = { bat: 1, axe: 1, shovel: 1, golf: 1, plank: 1, sledge: 1, rifle: 1, shotgun: 1 };
  const WLEN = { bat: 0.86, axe: 0.8, hatchet: 0.38, knife: 0.26, machete: 0.58, crowbar: 0.66, hammer: 0.34, sledge: 0.9, shovel: 1.0, pan: 0.42, golf: 0.95, plank: 0.95, pipe: 0.78, wrench: 0.32, pistol: 0.2, rifle: 1.0, shotgun: 0.98, flashlight: 0.22, item: 0.18 };

  // ------------------------------------------------------------------
  // Pose (local): f frente, r direita, z altura
  // ------------------------------------------------------------------
  function V(f, r, z) { return [f, r, z]; }
  function ik(h, foot, L1, L2, bendF) {
    // joelho/cotovelo no plano (f,z) com dobra para frente (bendF>0) ou trás
    const df = foot[0] - h[0], dz = foot[2] - h[2], dr = foot[1] - h[1];
    const d = Math.sqrt(df * df + dz * dz + dr * dr) || 1e-6;
    const L = Math.min(d, L1 + L2 - 1e-4);
    const a = (L1 * L1 - L2 * L2 + L * L) / (2 * L);
    const hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const mf = h[0] + df * a / d, mz = h[2] + dz * a / d, mr = h[1] + dr * a / d;
    // perpendicular no plano (f,z): (dz, -df) normalizado
    let pf = dz / d, pz = -df / d;
    if (pf * bendF < 0) { pf = -pf; pz = -pz; }
    return [mf + pf * hh, mr, mz + pz * hh];
  }
  const PI = Math.PI;

  function makePose(o) {
    // o: { kind, state, phase, spd, t, run, sneak, weapon, swing, aimT, anim }
    const P = {};
    const t = o.t, ph = o.phase;
    let pelZ = 0.95, lean = 0, headTilt = 0, headF = 0, sway = 0;
    let stride = 0, lift = 0;
    const moving = o.spd > 0.25;
    const zom = o.kind === 'zombie';
    if (moving) {
      const sp = Math.min(1.6, o.spd / (zom ? 1.2 : 2.6));
      stride = o.run ? 0.42 : o.sneak ? 0.2 : zom ? 0.2 + 0.08 * sp : 0.26 + 0.1 * sp;
      lift = o.run ? 0.2 : o.sneak ? 0.07 : zom ? 0.05 : 0.1;
    }
    if (o.run) lean = 0.2;
    if (o.sneak) { pelZ = 0.72; lean = 0.42; }
    if (zom) { lean = 0.16 + (o.state === 'chase' ? 0.12 : 0); headTilt = 0.08 + 0.05 * Math.sin(o.seed); sway = 0.05 * Math.sin(ph * 0.5); }
    // passada
    const sL = Math.sin(ph), sR = Math.sin(ph + PI);
    const bob = moving ? Math.abs(Math.cos(ph)) * (o.run ? 0.05 : 0.025) : 0;
    const breathe = Math.sin(t * 2.1) * 0.006;
    pelZ += bob - (moving ? 0.02 : 0);
    const pel = V(0, sway, pelZ);
    // zumbi arrasta uma perna
    const limp = zom ? 0.55 : 1;
    P.hipL = V(0, -0.1 + sway, pelZ - 0.03); P.hipR = V(0, 0.1 + sway, pelZ - 0.03);
    const stance = o.sneak ? 0.16 : 0.1;
    P.footL = V(stride * sL, -stance + sway * 0.3, 0.07 + Math.max(0, Math.cos(ph)) * lift);
    P.footR = V(stride * sR * limp, stance + sway * 0.3, 0.07 + Math.max(0, Math.cos(ph + PI)) * lift * limp);
    // tronco
    const chestZ = pelZ + 0.5 * Math.cos(lean) + breathe;
    const chestF = 0.5 * Math.sin(lean);
    P.pel = pel;
    P.chest = V(chestF, sway * 1.4, chestZ);
    const shW = o.female ? 0.17 : 0.19;
    P.shL = V(chestF, -shW + sway * 1.4, chestZ - 0.04); P.shR = V(chestF, shW + sway * 1.4, chestZ - 0.04);
    P.head = V(chestF + 0.04 + headF + Math.sin(lean) * 0.12, sway * 1.5 + headTilt, chestZ + 0.2 - (zom ? 0.03 : 0));
    // braços (padrão: balanço oposto às pernas)
    const armA = moving ? stride * (o.run ? 1.3 : 0.8) : 0;
    const handZ = pelZ - 0.1 + (o.run ? 0.2 : 0);
    P.haL = V(chestF - armA * sL * 0.9 + (o.run ? 0.1 : 0), -shW - 0.04, handZ + Math.max(0, -sL) * armA * 0.3 + Math.sin(t * 1.3) * 0.004);
    P.haR = V(chestF - armA * sR * 0.9 + (o.run ? 0.1 : 0), shW + 0.04, handZ + Math.max(0, -sR) * armA * 0.3);
    let elbowBendL = -1, elbowBendR = -1; // cotovelo para trás
    // ---- poses específicas ----
    const st = o.state;
    if (zom) {
      if (st === 'chase' || st === 'lunge' || st === 'attack') {
        const reach = st === 'chase' ? 0.5 : 0.62;
        const g = st === 'attack' ? Math.sin(t * 9) * 0.08 : Math.sin(ph) * 0.05;
        P.haL = V(chestF + reach + g, -0.14, chestZ - 0.06 + g * 0.5); P.haR = V(chestF + reach - g, 0.14, chestZ - 0.1 - g * 0.5);
        elbowBendL = elbowBendR = 1;
        if (st !== 'chase') { P.head[0] += 0.08; P.chest[0] += 0.05; }
      } else if (st === 'bang') {
        const k = Math.max(0, Math.sin(t * 5));
        P.haL = V(chestF + 0.35 + k * 0.2, -0.16, chestZ + 0.1 + k * 0.1); P.haR = V(chestF + 0.35 + (1 - k) * 0.2, 0.16, chestZ + 0.12);
        elbowBendL = elbowBendR = 1;
      } else if (st === 'stagger') {
        const k = Math.sin(t * 7) * 0.1;
        P.chest[0] -= 0.18; P.shL[0] -= 0.18; P.shR[0] -= 0.18; P.head[0] -= 0.24; P.head[2] -= 0.03;
        P.haL = V(-0.1, -0.4, chestZ + 0.1 + k); P.haR = V(0.05, 0.42, chestZ - 0.05 - k);
        P.footL[0] = -0.2; P.footR[0] = 0.15;
      } else if (st === 'eat') {
        const k = Math.sin(t * 6) * 0.03;
        pel[2] = 0.45; P.hipL[2] = P.hipR[2] = 0.45;
        P.footL = V(-0.35, -0.16, 0.06); P.footR = V(-0.3, 0.18, 0.06);
        P.chest = V(0.35, 0, 0.7 + k); P.shL = V(0.35, -0.18, 0.68 + k); P.shR = V(0.35, 0.18, 0.68 + k);
        P.head = V(0.55, 0.02, 0.62 + k * 2);
        P.haL = V(0.7, -0.15, 0.1); P.haR = V(0.62, 0.2, 0.14 + k);
        elbowBendL = elbowBendR = 1;
        P.kneeDown = true;
      } else {
        // trôpego: braços meio erguidos, um mais baixo
        const k = Math.sin(t * 1.5 + o.seed) * 0.05;
        P.haL = V(chestF + 0.28 + (moving ? Math.sin(ph) * 0.06 : k), -0.16, chestZ - 0.34 + k);
        P.haR = V(chestF + 0.12 + (moving ? -Math.sin(ph) * 0.05 : -k), 0.2, pelZ - 0.05);
        elbowBendL = 1;
      }
    } else {
      const w = o.weapon;
      const two = w && TWO_HANDED[w];
      const as = o.anim;
      if (as === 'attack' || as === 'shove') {
        const p = U.clamp(o.swing, 0, 1);
        if (as === 'shove' || !w || w === 'item' || w === 'flashlight') {
          const k = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65;
          P.haL = V(chestF + 0.15 + k * 0.45, -0.14, chestZ - 0.12); P.haR = V(chestF + 0.15 + k * 0.45, 0.14, chestZ - 0.12);
          elbowBendL = elbowBendR = 1;
          P.chest[0] += k * 0.08; P.head[0] += k * 0.08;
        } else if (w === 'knife' || w === 'pistol') {
          const k = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
          P.haR = V(chestF + 0.12 + k * 0.5, 0.1, chestZ - 0.12 + k * 0.05);
          elbowBendR = 1;
          P.weaponDir = [1, 0.05, -0.1];
        } else {
          // golpe horizontal: da direita-trás (preparação) para a esquerda-frente
          const ease = p < 0.25 ? -0.2 * (p / 0.25) : (p < 0.55 ? -0.2 + 1.2 * ((p - 0.25) / 0.3) : 1 - 0.3 * ((p - 0.55) / 0.45));
          const ang = 1.9 - ease * 2.9; // radianos: 1.9 (lado direito, atrás) → -1.0 (esquerda, frente)
          const hr = 0.34, hz = chestZ - 0.14 + (w === 'axe' || w === 'sledge' ? 0.08 : 0);
          const hf = chestF + Math.cos(ang) * hr, hrr = Math.sin(ang) * hr;
          P.haR = V(hf, hrr, hz);
          if (two) P.haL = V(hf - Math.cos(ang) * 0.1, hrr - Math.sin(ang) * 0.1, hz - 0.02);
          elbowBendR = elbowBendL = 1;
          P.weaponDir = [Math.cos(ang), Math.sin(ang), 0.15];
          P.chest[1] += Math.sin(ang) * 0.04; P.head[1] += Math.sin(ang) * 0.03;
        }
      } else if (o.aiming || as === 'aim' || as === 'shoot') {
        const recoil = as === 'shoot' ? Math.max(0, 1 - o.animT * 6) : 0;
        if (w === 'rifle' || w === 'shotgun') {
          P.haR = V(chestF + 0.12 - recoil * 0.06, 0.1, chestZ - 0.06 + recoil * 0.03);
          P.haL = V(chestF + 0.5 - recoil * 0.06, 0.02, chestZ - 0.04 + recoil * 0.05);
          P.weaponDir = [1, -0.04, recoil * 0.25];
          P.weaponAt = 'R';
        } else if (w) {
          P.haR = V(chestF + 0.48 - recoil * 0.1, 0.05, chestZ - 0.05 + recoil * 0.08);
          P.haL = V(chestF + 0.44 - recoil * 0.1, -0.02, chestZ - 0.08 + recoil * 0.06);
          P.weaponDir = [1, 0, recoil * 0.6];
        }
        elbowBendL = elbowBendR = 1;
        P.muzzle = true;
      } else if (as === 'climb') {
        const k = U.clamp(o.animT, 0, 1);
        const up = Math.sin(k * PI);
        pel[2] += up * 0.55; P.hipL[2] += up * 0.55; P.hipR[2] += up * 0.55;
        P.chest[2] += up * 0.4; P.shL[2] += up * 0.4; P.shR[2] += up * 0.4; P.head[2] += up * 0.4;
        P.chest[0] += 0.25; P.shL[0] += 0.25; P.shR[0] += 0.25; P.head[0] += 0.3;
        P.footL = V(0.1, -0.12, 0.3 + up * 0.5); P.footR = V(-0.2, 0.12, 0.07 + up * 0.3);
        P.haL = V(0.45, -0.2, 0.95 + up * 0.2); P.haR = V(0.45, 0.2, 0.95 + up * 0.2);
        elbowBendL = elbowBendR = 1;
      } else if (as === 'hurt') {
        const k = Math.max(0, 1 - o.animT * 3);
        P.chest[0] -= 0.12 * k; P.head[0] -= 0.18 * k; P.shL[0] -= 0.12 * k; P.shR[0] -= 0.12 * k;
        P.haL = V(0.1, -0.3, chestZ + 0.05 * k); P.haR = V(0.1, 0.3, chestZ);
      } else if (as === 'eat' || as === 'loot') {
        if (as === 'loot') {
          pel[2] = 0.55; P.hipL[2] = P.hipR[2] = 0.53;
          P.footL = V(-0.25, -0.16, 0.06); P.footR = V(0.2, 0.16, 0.06);
          P.chest = V(0.22, 0, 1.0); P.shL = V(0.22, -0.18, 0.97); P.shR = V(0.22, 0.18, 0.97); P.head = V(0.32, 0, 1.15);
          const k = Math.sin(o.t * 4) * 0.06;
          P.haL = V(0.6 + k, -0.12, 0.45); P.haR = V(0.6 - k, 0.12, 0.5);
          elbowBendL = elbowBendR = 1;
        } else {
          P.haR = V(chestF + 0.12, 0.05, chestZ + 0.12 + Math.sin(o.t * 5) * 0.03);
          P.haL = V(chestF + 0.2, -0.1, chestZ - 0.2);
          elbowBendL = elbowBendR = 1;
        }
      } else if (w && w !== 'item') {
        // carregando a arma na mão
        if (w === 'rifle' || w === 'shotgun') { P.haR = V(chestF + 0.05, 0.2, pelZ + 0.05); P.haL = V(chestF + 0.32, 0.02, pelZ + 0.18); P.weaponDir = [0.8, -0.2, 0.5]; P.weaponAt = 'R'; elbowBendL = 1; }
        else if (two) { P.haR = V(chestF + 0.12, 0.16, pelZ - 0.02); P.haL = V(chestF + 0.12, 0.06, pelZ + 0.05); P.weaponDir = [0.55, 0.2, -0.8]; elbowBendL = elbowBendR = 1; }
        else P.weaponDir = [0.45, 0.1, -0.85];
      }
    }
    // joelhos e cotovelos (IK)
    const LT = 0.445, LS = 0.44;
    if (P.kneeDown) { P.kneeL = V(0.1, -0.14, 0.08); P.kneeR = V(0.12, 0.16, 0.08); }
    else { P.kneeL = ik(P.hipL, P.footL, LT, LS, 1); P.kneeR = ik(P.hipR, P.footR, LT, LS, 1); }
    P.elL = ik(P.shL, P.haL, 0.3, 0.28, elbowBendL);
    P.elR = ik(P.shR, P.haR, 0.3, 0.28, elbowBendR);
    return P;
  }

  // Pose deitada (morto / caído / dormindo / rastejante)
  function lyingPose(faceUp, t, kind, crawl, seed) {
    const P = {};
    const s = faceUp ? -1 : 1; // cabeça para trás (de costas) ou para frente (de bruços)
    const tw = kind === 'down' ? Math.sin(t * 13 + seed) * 0.02 : 0;
    P.pel = V(0, 0, 0.13);
    P.chest = V(s * 0.5, 0, 0.14 + tw);
    P.shL = V(s * 0.48, -0.2, 0.13); P.shR = V(s * 0.48, 0.2, 0.13);
    P.head = V(s * 0.74, 0.02 + tw, 0.13);
    P.hipL = V(0, -0.1, 0.12); P.hipR = V(0, 0.1, 0.12);
    const sp = 0.1 + R.hash(seed, 3, 3) * 0.12;
    P.footL = V(-s * 0.9, -0.16 - sp, 0.07); P.footR = V(-s * 0.86, 0.16 + sp * 0.5, 0.07);
    P.kneeL = V(-s * 0.45, -0.14 - sp * 0.5, 0.12 + (R.hash(seed, 4, 4) < 0.3 ? 0.15 : 0)); P.kneeR = V(-s * 0.44, 0.13 + sp * 0.3, 0.11);
    if (crawl) {
      const k = Math.sin(t * 3.2);
      P.haL = V(s * (1.0 + k * 0.18), -0.26, 0.06); P.haR = V(s * (1.0 - k * 0.18), 0.26, 0.06);
      P.elL = V(s * 0.72, -0.34, 0.14 + Math.max(0, k) * 0.1); P.elR = V(s * 0.72, 0.34, 0.14 + Math.max(0, -k) * 0.1);
      P.head[2] = 0.2; P.chest[2] = 0.18;
    } else {
      const a = R.hash(seed, 5, 5);
      P.elL = V(s * 0.3, -0.42, 0.08); P.haL = V(s * (a < 0.5 ? 0.05 : 0.6), -0.55, 0.06);
      P.elR = V(s * 0.36, 0.38, 0.08); P.haR = V(s * 0.1, 0.46 + a * 0.1, 0.06);
    }
    P.lying = true;
    P.faceUp = faceUp;
    return P;
  }

  // ------------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------------
  const parts = [];
  for (let i = 0; i < 24; i++) parts.push({ d: 0, fn: 0, a: null, b: null, c: null, w: 0, col: null });
  let np = 0;
  let cF0 = 1, cF1 = 0, cR0 = 0, cR1 = 1, ox = 0, oy = 0;
  function proj(p, out) {
    const wx = cF0 * p[0] + cR0 * p[1], wy = cF1 * p[0] + cR1 * p[1];
    out[0] = ox + (wx - wy) * 32; out[1] = oy + (wx + wy) * 16 - p[2] * ZPX; out[2] = wx + wy + p[2] * 0.02;
    return out;
  }
  const pa = [0, 0, 0], pb = [0, 0, 0], pc = [0, 0, 0];
  function depthOf(p) { return cF0 * p[0] + cR0 * p[1] + cF1 * p[0] + cR1 * p[1]; }
  function addPart(fn, d, a, b, c, w, cl) {
    const q = parts[np++];
    q.fn = fn; q.d = d; q.a = a; q.b = b; q.c = c; q.w = w; q.col = cl;
  }
  function limb(ctx, a, b, w, cl) {
    proj(a, pa); proj(b, pb);
    ctx.strokeStyle = cl; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
  }

  // Desenha um humanoide. ctx em px isométricos (câmera). opts: { alpha, look, kind, pose, dir, weapon, shadowOnly }
  RA.drawFigure = function (ctx, x, y, dir, P, lk, opts) {
    if (opts.solid) return drawSolid(ctx, x, y, dir, P, lk, opts);
    if (!opts.noOutline) drawSolid(ctx, x, y, dir, P, lk, { solid: 'rgba(22,18,16,0.5)', grow: 1.6 });
    const c = Math.cos(dir), s = Math.sin(dir);
    cF0 = c; cF1 = s; cR0 = -s; cR1 = c;
    ox = (x - y) * 32; oy = (x + y) * 16;
    np = 0;
    const skin = R.css(lk.skin), skinD = R.css(lk.skin, 0.82);
    const shirt = lk.shirt, pants = lk.pants;
    const farSide = (p) => depthOf(p) < depthOf(P.pel || P.chest) - 0.01;
    // pernas
    const legCol = (L) => R.css(pants, L ? 0.84 : 1);
    const dl = (a, b) => (depthOf(a) + depthOf(b)) / 2;
    addPart(1, dl(P.hipL, P.kneeL), P.hipL, P.kneeL, null, 6.0, legCol(farSide(P.hipL)));
    addPart(1, dl(P.kneeL, P.footL), P.kneeL, P.footL, null, 5.0, legCol(farSide(P.hipL)));
    addPart(1, dl(P.hipR, P.kneeR), P.hipR, P.kneeR, null, 6.0, legCol(farSide(P.hipR)));
    addPart(1, dl(P.kneeR, P.footR), P.kneeR, P.footR, null, 5.0, legCol(farSide(P.hipR)));
    // pés (sapato apontando para a frente)
    const toe = (f) => (P.lying ? [f[0] + (P.faceUp ? 0 : 0), f[1], f[2] + 0.12] : [f[0] + 0.14, f[1], f[2] - 0.02]);
    const shoeL = lk.oneShoe ? skinD : R.css(lk.shoes);
    addPart(1, depthOf(P.footL) + 0.02, P.footL, toe(P.footL), null, 4.6, shoeL);
    addPart(1, depthOf(P.footR) + 0.02, P.footR, toe(P.footR), null, 4.6, R.css(lk.shoes));
    // tronco
    addPart(2, depthOf(P.chest) * 0.5 + depthOf(P.pel) * 0.5, null, null, null, 0, null);
    // cabeça
    addPart(3, depthOf(P.head) + (P.lying ? 0 : 0.03), null, null, null, 0, null);
    // braços
    const sleeve = (far) => R.css(shirt, far ? 0.8 : 0.95);
    const armParts = (sh, el, ha, far) => {
      const d = (depthOf(sh) + depthOf(el) + depthOf(ha)) / 3;
      addPart(1, d, sh, el, null, 4.5, sleeve(far));
      addPart(1, d + 0.001, el, ha, null, 3.9, lk.longSleeve || lk.jacket ? sleeve(far) : far ? skinD : skin);
      addPart(4, d + 0.002, ha, null, null, 1.9, far ? skinD : skin);
    };
    armParts(P.shL, P.elL, P.haL, farSide(P.shL));
    armParts(P.shR, P.elR, P.haR, farSide(P.shR));
    // arma
    if (opts.weapon && opts.weapon !== 'item' && !P.lying) {
      const hand = P.weaponAt === 'R' ? P.haR : P.haR;
      const wd = P.weaponDir || [0.45, 0.1, -0.85];
      const l = Math.hypot(wd[0], wd[1], wd[2]) || 1;
      const L = WLEN[opts.weapon] || 0.5;
      const back = opts.weapon === 'rifle' || opts.weapon === 'shotgun' ? 0.3 : 0.08;
      const a = [hand[0] - wd[0] / l * back, hand[1] - wd[1] / l * back, hand[2] - wd[2] / l * back];
      const b = [hand[0] + wd[0] / l * (L - back), hand[1] + wd[1] / l * (L - back), hand[2] + wd[2] / l * (L - back)];
      addPart(5, (depthOf(a) + depthOf(b)) / 2 + 0.003, a, b, null, 0, opts.weapon);
      if (P.muzzle) opts.muzzleOut && (opts.muzzleOut[0] = b[0], opts.muzzleOut[1] = b[1], opts.muzzleOut[2] = b[2]);
    }
    // ordena por profundidade (inserção)
    for (let i = 1; i < np; i++) {
      const q = parts[i];
      let j = i - 1;
      while (j >= 0 && parts[j].d > q.d) { parts[j + 1] = parts[j]; j--; }
      parts[j + 1] = q;
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < np; i++) {
      const q = parts[i];
      if (q.fn === 1) limb(ctx, q.a, q.b, q.w, q.col);
      else if (q.fn === 2) torso(ctx, P, lk);
      else if (q.fn === 3) head(ctx, P, lk, dir);
      else if (q.fn === 4) { proj(q.a, pa); ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(pa[0], pa[1], q.w, 0, 6.283); ctx.fill(); }
      else if (q.fn === 5) weapon(ctx, q.a, q.b, q.col);
    }
  };
  // silhueta de cor única (para o mapa de luz): mesmas partes, sem detalhes
  function drawSolid(ctx, x, y, dir, P, lk, opts) {
    const c = Math.cos(dir), s = Math.sin(dir);
    cF0 = c; cF1 = s; cR0 = -s; cR1 = c;
    ox = (x - y) * 32; oy = (x + y) * 16;
    const col = opts.solid, gw = opts.grow || 1;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const L = (a, b, w) => { proj(a, pa); proj(b, pb); ctx.lineWidth = w + gw; ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); };
    ctx.beginPath();
    L(P.hipL, P.kneeL, 6); L(P.kneeL, P.footL, 5); L(P.hipR, P.kneeR, 6); L(P.kneeR, P.footR, 5);
    const toe = (f) => (P.lying ? [f[0], f[1], f[2] + 0.12] : [f[0] + 0.14, f[1], f[2] - 0.02]);
    L(P.footL, toe(P.footL), 4.6); L(P.footR, toe(P.footR), 4.6);
    L(P.shL, P.elL, 4.5); L(P.elL, P.haL, 3.9); L(P.shR, P.elR, 4.5); L(P.elR, P.haR, 3.9);
    proj(P.shL, pa); proj(P.shR, pb);
    const a0 = pa[0], a1 = pa[1], b0 = pb[0], b1 = pb[1];
    proj([P.hipR[0], P.hipR[1] * 1.25, P.hipR[2] + 0.06], pc); const c0 = pc[0], c1 = pc[1];
    proj([P.hipL[0], P.hipL[1] * 1.25, P.hipL[2] + 0.06], pc);
    ctx.lineWidth = 5 + gw;
    ctx.beginPath(); ctx.moveTo(a0, a1); ctx.lineTo(b0, b1); ctx.lineTo(c0, c1); ctx.lineTo(pc[0], pc[1]); ctx.closePath(); ctx.fill(); ctx.stroke();
    proj(P.head, pa);
    ctx.beginPath(); ctx.arc(pa[0], pa[1] - (P.lying ? 0 : 0.6), 4.3 + gw * 0.6 + (lk.hairStyle >= 3 ? 0.6 : 0), 0, 6.283); ctx.fill();
    if ((lk.hairStyle === 3 || lk.hairStyle === 4) && !P.lying) { ctx.beginPath(); ctx.ellipse(pa[0], pa[1] + 3, 4.3 + gw * 0.5, 6.5 + gw * 0.5, 0, 0, 6.283); ctx.fill(); }
    if (!P.lying) { proj(P.chest, pb); ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(pb[0], pb[1]); ctx.lineTo(pa[0], pa[1]); ctx.stroke(); }
  }
  function torso(ctx, P, lk) {
    const hL = [P.hipL[0], P.hipL[1] * 1.25, P.hipL[2] + 0.06], hR = [P.hipR[0], P.hipR[1] * 1.25, P.hipR[2] + 0.06];
    proj(P.shL, pa); proj(P.shR, pb);
    const a0 = pa[0], a1 = pa[1], b0 = pb[0], b1 = pb[1];
    proj(hR, pc); const c0 = pc[0], c1 = pc[1];
    proj(hL, pc); const d0 = pc[0], d1 = pc[1];
    const sh = lk.shirt;
    // frente visível? (normal do peito · câmera)
    const facing = cF0 + cF1; // >0: frente para a câmera
    const base = R.css(sh, 0.92 + facing * 0.06);
    ctx.fillStyle = base; ctx.strokeStyle = base; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(a0, a1); ctx.lineTo(b0, b1); ctx.lineTo(c0, c1); ctx.lineTo(d0, d1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // cintura/cinto
    ctx.strokeStyle = R.css(lk.pants, 0.8); ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.moveTo(d0, d1 + 1); ctx.lineTo(c0, c1 + 1); ctx.stroke();
    // detalhes: jaqueta aberta / gola / sangue / rasgos
    const mx = (a0 + b0) / 2, my = (a1 + b1) / 2;
    if (facing > 0.2 && !P.lying) {
      ctx.strokeStyle = R.css(lk.skin, 0.95); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(mx - 1.4, my); ctx.lineTo(mx, my + 2.5); ctx.lineTo(mx + 1.4, my); ctx.stroke();
      if (lk.jacket) { ctx.strokeStyle = R.css(sh, 0.62); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(mx, my + 2.5); ctx.lineTo((c0 + d0) / 2, (c1 + d1) / 2 - 1); ctx.stroke(); }
    }
    if (facing < -0.3 && lk.backpack && !P.lying) {
      ctx.fillStyle = lk.backpack; ctx.fillRect(mx - 4, my + 1, 8, 9); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(mx - 4, my + 7, 8, 2);
    }
    if (lk.zombie) {
      const rng = U.rng(lk.seed * 7 + 1);
      // rasgos (pele aparecendo) e sangue
      if (lk.torn > 0.4) { ctx.fillStyle = R.css(lk.skin, 0.9); ctx.beginPath(); const tx = d0 + (c0 - d0) * 0.3, ty = d1 + (c1 - d1) * 0.3 - 4; ctx.moveTo(tx, ty); ctx.lineTo(tx + 3, ty - 3); ctx.lineTo(tx + 4, ty + 1); ctx.lineTo(tx + 1, ty + 2); ctx.closePath(); ctx.fill(); }
      const nb = Math.round(lk.blood * 6);
      for (let k = 0; k < nb; k++) {
        const u = rng(), v = rng();
        const x = a0 + (b0 - a0) * u + (d0 - a0) * v * 0.9, y = a1 + (b1 - a1) * u + (d1 - a1) * v * 0.9;
        ctx.fillStyle = k & 1 ? 'rgba(92,18,14,0.85)' : 'rgba(120,24,18,0.75)';
        ctx.beginPath(); ctx.ellipse(x, y, 1.4 + rng() * 2.2, 1.2 + rng() * 1.8, rng() * 3, 0, 6.283); ctx.fill();
      }
      if (lk.blood > 0.5) { ctx.fillStyle = 'rgba(100,20,16,0.7)'; ctx.fillRect(mx - 1.5, my + 1, 3, 7); }
    } else if (lk.blood > 0) {
      ctx.fillStyle = 'rgba(110,22,18,' + Math.min(0.8, lk.blood) + ')'; ctx.beginPath(); ctx.ellipse(mx + 2, my + 5, 2.5, 3, 0, 0, 6.283); ctx.fill();
    }
  }
  function head(ctx, P, lk, dir) {
    proj(P.head, pa);
    const hx = pa[0], hy = pa[1];
    const r = lk.female ? 4.1 : 4.3;
    // pescoço
    if (!P.lying) { proj(P.chest, pb); ctx.strokeStyle = R.css(lk.skin, 0.85); ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(pb[0], pb[1]); ctx.lineTo(hx, hy + 2); ctx.stroke(); }
    // direção do rosto em tela
    const fx = (cF0 - cF1) * 32, fy = (cF0 + cF1) * 16;
    const fl = Math.hypot(fx, fy) || 1;
    const ux = fx / fl, uy = fy / fl;
    const facing = cF0 + cF1; // >0 olhando para a câmera
    const hairC = lk.hair;
    const style = lk.hairStyle;
    const bald = style === 0 && !lk.female;
    // cabelo longo atrás
    if ((style === 3 || style === 4) && !P.lying) {
      ctx.fillStyle = R.css(hairC, 0.8);
      ctx.beginPath(); ctx.ellipse(hx - ux * 1.5, hy + 3, r * 0.95, r * 1.6, 0, 0, 6.283); ctx.fill();
    }
    // cabeça
    const g = ctx.createRadialGradient(hx + ux * 1.2 - 1, hy - 1.5, 0.5, hx, hy, r * 1.1);
    g.addColorStop(0, R.css(lk.skin, 1.12)); g.addColorStop(1, R.css(lk.skin, 0.8));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(hx, hy, r, 0, 6.283); ctx.fill();
    // cabelo: calota deslocada para trás e para cima
    if (!bald) {
      ctx.fillStyle = R.css(hairC);
      const bx = hx - ux * (facing > 0 ? 1.4 : 0.6), by = hy - uy * 0.8 - (P.lying ? 0 : 1.3);
      ctx.beginPath();
      if (facing > 0.15) {
        // de frente: franja em cima
        ctx.ellipse(bx, by - 0.6, r * 1.02, r * 0.78, 0, Math.PI * 0.92, Math.PI * 2.08);
        ctx.closePath(); ctx.fill();
        if (style === 2 || style === 3) { ctx.fillRect(hx - r * 1.02, hy - 1.5, 1.6, r + 1); ctx.fillRect(hx + r * 1.02 - 1.6, hy - 1.5, 1.6, r + 1); }
      } else {
        ctx.arc(bx, by + 0.6, r * 1.02, 0, 6.283); ctx.fill();
      }
      if (style === 4 && !P.lying) { ctx.beginPath(); ctx.arc(hx - ux * 4.2, hy - 1.2, 1.8, 0, 6.283); ctx.fill(); }
    }
    // olhos (quando de frente)
    if (facing > 0.1 && !P.lying) {
      const ex = hx + ux * 1.6, ey = hy + uy * 0.8 + 0.4;
      const px = -uy, py = ux;
      ctx.fillStyle = lk.zombie ? 'rgba(220,210,170,0.9)' : 'rgba(30,24,20,0.85)';
      ctx.fillRect(ex + px * 1.4 - 0.5, ey + py * 0.7 - 0.5, 1.1, 1.1);
      ctx.fillRect(ex - px * 1.4 - 0.5, ey - py * 0.7 - 0.5, 1.1, 1.1);
      if (lk.zombie && lk.blood > 0.3) { ctx.fillStyle = 'rgba(100,20,16,0.8)'; ctx.fillRect(ex - 1, ey + 2, 2.2, 1.6); }
    }
    if (lk.zombie && lk.torn > 0.7) { ctx.fillStyle = 'rgba(110,30,24,0.7)'; ctx.fillRect(hx - ux * 2 - 1, hy - 2, 2, 2); }
  }
  function weapon(ctx, a, b, kind) {
    proj(a, pa); proj(b, pb);
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
    const L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const lerp = (t) => [pa[0] + dx * t, pa[1] + dy * t];
    const seg = (t0, t1, w, cl) => { const p = lerp(t0), q = lerp(t1); ctx.strokeStyle = cl; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
    ctx.lineCap = 'round';
    switch (kind) {
      case 'bat': seg(0, 0.35, 1.8, '#7a5a3a'); seg(0.3, 1, 3.2, '#b48c5a'); seg(0.5, 1, 1, 'rgba(255,240,210,0.35)'); break;
      case 'plank': seg(0, 1, 3.4, '#8a6a44'); break;
      case 'pipe': seg(0, 1, 2.2, '#8a8e90'); seg(0.1, 1, 0.8, 'rgba(255,255,255,0.35)'); break;
      case 'crowbar': seg(0, 0.92, 2, '#3a3d40'); { const q = lerp(1); ctx.strokeStyle = '#3a3d40'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lerp(0.92)[0], lerp(0.92)[1]); ctx.lineTo(q[0] + nx * 3, q[1] + ny * 3); ctx.stroke(); } break;
      case 'golf': seg(0, 1, 1.2, '#a8acae'); { const q = lerp(1); ctx.fillStyle = '#6a6e70'; ctx.fillRect(q[0] - 2, q[1] - 1, 4, 2.4); } break;
      case 'knife': seg(0, 0.35, 2, '#2a2420'); seg(0.35, 1, 1.6, '#d8dcde'); break;
      case 'machete': seg(0, 0.25, 2.2, '#2a2420'); seg(0.25, 1, 2.6, '#c0c4c6'); break;
      case 'hammer': case 'wrench': seg(0, 0.85, 1.8, kind === 'wrench' ? '#9a9ea0' : '#8a6a44'); { const q = lerp(0.95); ctx.fillStyle = '#4a4e50'; ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(Math.atan2(dy, dx)); ctx.fillRect(-1.5, -3, 3.4, 6); ctx.restore(); } break;
      case 'sledge': seg(0, 0.85, 2, '#8a6a44'); { const q = lerp(0.95); ctx.fillStyle = '#3a3e40'; ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(Math.atan2(dy, dx)); ctx.fillRect(-2.5, -4.5, 5, 9); ctx.restore(); } break;
      case 'axe': case 'hatchet': seg(0, 1, 2, '#8a6a44'); { const q = lerp(0.88); ctx.fillStyle = '#9a9ea2'; ctx.beginPath(); ctx.moveTo(q[0] - nx * 1, q[1] - ny * 1); ctx.lineTo(q[0] + nx * 6 - dx / L * 2, q[1] + ny * 6 - dy / L * 2); ctx.lineTo(q[0] + nx * 6 + dx / L * 4, q[1] + ny * 6 + dy / L * 4); ctx.lineTo(q[0] + dx / L * 3, q[1] + dy / L * 3); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#b83a2a'; ctx.fillRect(q[0] - 1.2, q[1] - 1.2, 2.4, 2.4); } break;
      case 'shovel': seg(0, 0.8, 2, '#8a6a44'); { const q = lerp(0.9); ctx.fillStyle = '#6a6e70'; ctx.beginPath(); ctx.ellipse(q[0], q[1], 3.5, 2.4, Math.atan2(dy, dx), 0, 6.283); ctx.fill(); } break;
      case 'pan': seg(0, 0.55, 1.8, '#2a2a2a'); { const q = lerp(0.8); ctx.fillStyle = '#2e2e30'; ctx.beginPath(); ctx.ellipse(q[0], q[1], 4, 2.8, 0, 0, 6.283); ctx.fill(); } break;
      case 'pistol': seg(0.1, 1, 2.2, '#1e1e20'); seg(0, 0.35, 2.4, '#2a2622'); break;
      case 'rifle': case 'shotgun': seg(0, 0.4, 3, '#6a4a2c'); seg(0.35, 1, 1.8, '#1e1e20'); if (kind === 'shotgun') seg(0.45, 0.75, 2.6, '#6a4a2c'); break;
      case 'flashlight': seg(0, 1, 2.4, '#2a2a2c'); { const q = lerp(1); ctx.fillStyle = '#e8e4c8'; ctx.beginPath(); ctx.arc(q[0], q[1], 1.3, 0, 6.283); ctx.fill(); } break;
      default: break;
    }
  }

  // ------------------------------------------------------------------
  // Entidades do jogo
  // ------------------------------------------------------------------
  const muzzle = [0, 0, 0];
  RA.muzzle = muzzle;
  // Jogador
  RA.drawPlayer = function (ctx, p, dt, s) {
    const a = RA.track(p, dt);
    const lk = a.look || (a.look = playerLook(p));
    if (p.equipped && p.equipped.back && !lk.backpack) lk.backpack = '#4a4a3a';
    const an = p.anim || {};
    const w = p.equipped && p.equipped.main ? weaponKind(p.equipped.main) : null;
    if (p.alive === false || an.state === 'dead' || an.state === 'sleep' || p.sleeping) {
      const P = lyingPose(an.state === 'sleep' || p.sleeping ? true : R.hash(3, 3, 3) < 0.5, a.t, 'dead', false, 3);
      RA.drawFigure(ctx, p.x, p.y, p.dir || 0, P, lk, { weapon: null });
      RA.last = { P, lk, dir: p.dir || 0 };
      return;
    }
    // swing: anim.swing (0..1) ou anim.t quando <= 1
    let swing = an.swing != null ? an.swing : an.t != null && an.t <= 1 ? an.t : 0;
    const P = makePose({
      kind: 'human', state: an.state, anim: an.state, phase: a.phase, spd: a.spd, t: a.t, run: p.running && a.spd > 0.3, sneak: p.sneaking,
      weapon: w, swing, aiming: p.aiming, animT: an.t || 0, female: lk.female, seed: 1,
    });
    muzzle[2] = -1;
    RA.drawFigure(ctx, p.x, p.y, p.dir || 0, P, lk, { weapon: w, muzzleOut: muzzle });
    RA.last = { P, lk, dir: p.dir || 0 };
    if (muzzle[2] > 0) { // converte ponta da arma para mundo (x,y,z)
      const c = Math.cos(p.dir || 0), sn = Math.sin(p.dir || 0);
      const wx = c * muzzle[0] - sn * muzzle[1], wy = sn * muzzle[0] + c * muzzle[1];
      RA.muzzleWorld = [p.x + wx, p.y + wy, muzzle[2]];
    } else RA.muzzleWorld = null;
  };
  // Zumbi
  RA.drawZombie = function (ctx, z, dt) {
    const a = RA.track(z, dt);
    const lk = a.look || (a.look = zombieLook(z));
    const st = z.state || 'idle';
    let P;
    if (st === 'dead') P = lyingPose(true, a.t, 'dead', false, z.id || 1);
    else if (st === 'down') P = lyingPose(R.hash(z.id || 1, 9, 9) < 0.6, a.t, 'down', false, z.id || 1);
    else if (st === 'crawl' || z.crawler) P = lyingPose(false, a.t + (z.animT || 0), 'crawl', true, z.id || 1);
    else P = makePose({ kind: 'zombie', state: st, phase: a.phase, spd: a.spd, t: a.t, female: lk.female, seed: (z.id || 1) * 1.7 });
    RA.drawFigure(ctx, z.x, z.y, z.dir || 0, P, lk, {});
    RA.last = { P, lk, dir: z.dir || 0 };
  };
  // Cadáver: poça de sangue crescente + corpo deitado
  RA.drawCorpse = function (ctx, c, s) {
    const lk = c._look || (c._look = c.variant ? zombieLook({ id: c.id || ((c.x * 97 + c.y * 13) | 0), variant: c.variant }) : zombieLook({ id: ((c.x * 97 + c.y * 13) | 0) }));
    const age = s ? Math.max(0, s.time - (c.time || 0)) : 60;
    const grow = Math.min(1, 0.35 + age / 6);
    const seed = (c.x * 131 + c.y * 71) | 0;
    RA.bloodPool(ctx, c.x - Math.cos(c.dir || 0) * 0.3, c.y - Math.sin(c.dir || 0) * 0.3, 0.55 * grow, seed);
    const P = lyingPose(R.hash(seed, 2, 2) < 0.65, 0, 'dead', false, seed);
    RA.drawFigure(ctx, c.x, c.y, c.dir || 0, P, lk, {});
  };
  RA.bloodPool = function (ctx, x, y, r, seed) {
    const cx = (x - y) * 32, cy = (x + y) * 16;
    const rng = U.rng(seed >>> 0);
    ctx.fillStyle = 'rgba(70,10,8,0.82)';
    ctx.beginPath();
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const t = k / n * 6.283, rr = r * (0.75 + rng() * 0.45) * 45;
      const px = cx + Math.cos(t) * rr, py = cy + Math.sin(t) * rr * 0.5;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(160,60,50,0.25)';
    ctx.beginPath(); ctx.ellipse(cx - r * 10, cy - r * 4, r * 14, r * 5, 0, 0, 6.283); ctx.fill();
  };
})();
