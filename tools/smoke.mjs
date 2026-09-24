#!/usr/bin/env node
/* =====================================================================
 * Ferramenta de teste/screenshot do Vale Quieto (Playwright + Chromium).
 *
 * Uso:
 *   node tools/smoke.mjs [--params "autostart=1&seed=42&hour=22"]
 *                        [--script tools/scripts/foo.json] [--out /tmp/shots]
 *                        [--wait 1500] [--w 1280] [--h 720]
 *
 * Sem --script: espera --wait ms e tira um screenshot "final.png".
 * --script: JSON com uma lista de passos:
 *   {"wait": 500}                         espera ms
 *   {"key": "KeyW", "hold": 800}          segura tecla por ms
 *   {"press": "KeyE"}                     toca tecla
 *   {"mouse": [640, 300]}                 move o mouse (px de tela)
 *   {"click": [640, 300], "button": "left"|"right"}
 *   {"eval": "G.debug.setHour(22)"}       executa JS na página (mostra retorno)
 *   {"shot": "nome"}                      screenshot nome.png
 *   {"log": "texto"}                      imprime texto
 *
 * Imprime todos os erros de console/página; sai com código 1 se houver erros.
 * ===================================================================== */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const params = arg('params', 'autostart=1&seed=42');
const out = path.resolve(arg('out', path.join(root, '.shots')));
const W = +arg('w', 1280), H = +arg('h', 720);
fs.mkdirSync(out, { recursive: true });

let steps = [{ wait: +arg('wait', 1500) }, { shot: 'final' }];
const scriptPath = arg('script');
if (scriptPath) steps = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
const inline = arg('steps');
if (inline) steps = JSON.parse(inline);

const launchOpts = { args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
if (fs.existsSync('/opt/pw-browsers/chromium')) {
  // deixa o Playwright achar o navegador via PLAYWRIGHT_BROWSERS_PATH
}
const browser = await playwright.chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error') { errors.push(m.text()); console.log('[console.error]', m.text()); }
  else if (t === 'warning') console.log('[console.warn]', m.text());
  else if (process.env.VERBOSE) console.log('[console]', m.text());
});
page.on('pageerror', (e) => { errors.push(String(e)); console.log('[pageerror]', e.stack || String(e)); });

const url = 'file://' + path.join(root, 'index.html') + (params ? '?' + params : '');
console.log('Abrindo', url);
await page.goto(url);
await page.waitForTimeout(300);

const t0 = Date.now();
for (const s of steps) {
  if (s.wait != null) await page.waitForTimeout(s.wait);
  if (s.mouse) await page.mouse.move(s.mouse[0], s.mouse[1]);
  if (s.key) { await page.keyboard.down(s.key); await page.waitForTimeout(s.hold || 100); await page.keyboard.up(s.key); }
  if (s.press) await page.keyboard.press(s.press);
  if (s.click) { await page.mouse.move(s.click[0], s.click[1]); await page.mouse.down({ button: s.button || 'left' }); await page.waitForTimeout(60); await page.mouse.up({ button: s.button || 'left' }); }
  if (s.eval) {
    try {
      const r = await page.evaluate(s.eval);
      if (r !== undefined) console.log('[eval]', s.eval.slice(0, 60), '=>', typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e) { errors.push('eval: ' + e.message); console.log('[eval error]', e.message); }
  }
  if (s.log) console.log('[log]', s.log);
  if (s.shot) { const f = path.join(out, s.shot + '.png'); await page.screenshot({ path: f }); console.log('[shot]', f); }
}
const fps = await page.evaluate(() => (window.G && G.render && G.render.fps) || null).catch(() => null);
if (fps) console.log('[fps]', fps);
console.log(`Concluído em ${Date.now() - t0} ms. Erros: ${errors.length}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
