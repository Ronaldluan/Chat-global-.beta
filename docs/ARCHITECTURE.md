# VALE QUIETO — Arquitetura e Contrato entre Módulos

Jogo de sobrevivência zumbi isométrico no espírito de *Project Zomboid*:
**calmo, bonito, melancólico — e cruel.** Uma cidadezinha americana em julho,
dias quentes e silenciosos, noites escuras de verdade, chuva, neblina.
Toda mordida é fatal. O jogador vai morrer; a pergunta é *como* e *quando*.

## Regras de ouro

1. **Abrir `index.html` no navegador deve bastar.** Sem build, sem servidor, sem
   dependências, sem assets externos. Tudo (gráficos e sons) é **procedural**
   (Canvas 2D + WebAudio). Não use `import`/ES modules (não funcionam em `file://`).
2. Cada arquivo é um IIFE que pendura sua API em `window.G`.
   Ordem de carga: `core → items → world → survival → player → zombies → render → audio → ui → main`.
   Não chame APIs de outros módulos **no momento da carga**, só em funções chamadas depois (boot/loop).
3. **Só edite os arquivos da sua etapa.** Se precisar de algo de outro módulo que não existe,
   use checagem defensiva (`G.x && G.x.fn && G.x.fn()`) e registre em `docs/NOTES.md` o que pediu.
   Mudanças no contrato (este arquivo) só com justificativa clara e retrocompatível.
4. Texto visível ao jogador em **português do Brasil**.
5. Desempenho: 60 fps em notebook comum, mapa 140×140. Faça culling, cache em canvas offscreen, evite
   alocações por frame em laços quentes.
6. Teste sempre com `node tools/smoke.mjs` (ver abaixo) e **olhe os screenshots**. Zero erros no console.

## Ferramenta de teste

```
node tools/smoke.mjs --params "autostart=1&seed=42&hour=22&debug=1" --out /caminho/shots \
     --steps '[{"wait":800},{"key":"KeyW","hold":1500},{"shot":"andando"}]'
```
Passos: `wait`, `key`+`hold`, `press`, `mouse`, `click`(+`button`), `eval` (JS na página), `shot`, `log`.
Parâmetros de URL: `autostart=1` (pula o título), `seed`, `hour`, `debug=1`, `profession`.
`window.G.debug`: `teleport(x,y)`, `setHour(h)`, `rain(v)`, `fog(v)`, `storm(bool)`, `give(type,n)`,
`spawnZombie(x,y)`, `zoomTo(z)`, `god`.

## Coordenadas

- Mundo em **tiles** (floats). Tile `(tx,ty)` ocupa `[tx,tx+1)×[ty,ty+1)`; centro em `tx+0.5`.
- `+x` vai para baixo-direita na tela, `+y` para baixo-esquerda.
- `G.iso.toScreen(x,y)` → px de tela (já com câmera/zoom). `G.iso.toWorld(sx,sy)` → mundo.
  O ponto de tela de `(x,y)` é o **topo** do losango do tile; o centro do tile `(tx+.5,ty+.5)` fica
  no centro do losango. Entidades são desenhadas com os pés em `toScreen(e.x,e.y)`.
- `G.iso.screenDirToWorld(dx,dy)` converte direção de tela (WASD) em direção de mundo.
- Direções (`dir`) são ângulos em radianos no **espaço do mundo** (`atan2(dy,dx)`).
- `G.CONST`: `TILE_W=64, TILE_H=32, WALL_H=80, MAP_W=MAP_H=140, MINUTES_PER_SECOND=1, START_HOUR=9`.
- Profundidade (ordem de desenho): ordenar por `x + y` (maior = mais à frente).

## Estado global — `G.state` (criado por `G.main.newGame`)

```js
{
  mode: 'playing'|'paused'|'dead',   // 'title' antes do primeiro jogo (G.main.mode)
  seed, rng,                          // rng determinístico do mundo
  time,        // minutos de jogo desde 00:00 do Dia 1 (começa 9:00)
  timeScale,   // 1 normal; >1 dormindo
  realTime,    // segundos reais jogados
  light,       // luz ambiente 0..1 (main calcula a partir da hora + nuvens + relâmpago)
  weather: { rain 0..1, fog 0..1, wind 0..1, cloud 0..1, lightning 0..1, storm bool, temperature °C },
  power, water,               // eletricidade/água encanada (caem em dias aleatórios 4–10)
  map,                        // ver "Mapa"
  player,                     // ver "Jogador"
  zombies: [],                // ver "Zumbis"
  corpses: [],                // { x, y, dir, variant, time, container:{name,items,capacity} }
  groundItems: [],            // { x, y, item }
  decals: [],                 // { x, y, type:'blood'|'bloodpool'|'glass'|'footprint'|'bullet', size, rot, alpha, t }
  particles: [],              // efeitos visuais (dono: render). Outros módulos podem dar push:
                              // { x, y, z, vx, vy, vz, life, maxLife, type:'blood'|'spark'|'glass'|'dust'|'wood'|'smoke'|'muzzle'|'shell', color, size }
  noises: [],                 // ruídos recentes { x,y,radius,kind,life }
  fov,                        // ver G.fov
  stats: { kills, itemsLooted, distance, startTime, shotsFired, cause },
}
```

## Mapa — `state.map` (dono: `world.js`)

Arrays planos indexados por `i = ty * w + tx`.

| campo | tipo | significado |
|---|---|---|
| `w, h` | int | dimensões |
| `floor` | Uint8Array | `G.FLOOR.*` |
| `wall` | Uint8Array | `G.WALL.*` — estrutura ocupando o tile inteiro (parede, porta, janela, cerca, sebe) |
| `wallState` | Uint8Array | bits `G.WS`: `OPEN`, `BROKEN`, `LOCKED`, barricada (0–4) em `BARRICADE_MASK>>SHIFT`, `CURTAIN` |
| `wallHp` | Float32Array | vida de portas/janelas/barricadas/cercas |
| `building` | Uint16Array | 0 = exterior; senão id do prédio (tile coberto por teto) |
| `room` | Uint16Array | 0 = nenhum; senão id do cômodo |
| `objAt` | Int32Array | −1 ou índice em `objects` (todas as células da pegada do objeto) |
| `buildings` | array | `{ id, x, y, w, h, type, name, roofColor, wallColor, wall, doors:[{x,y}] }` |
| `rooms` | array | `{ id, building, type, x, y, w, h }` tipos: `kitchen, bedroom, bathroom, living, garage, hall, store, storage, office, pharmacy, police, gas_station, diner, church, warehouse` |
| `objects` | array | `{ id, type, x, y, w, h, rot, blocksMove, blocksSight, height, container, light, variant }` |
| `spawnPoint` | `{x,y}` | dentro de uma casa segura |
| `zombieSpawns` | array | `{x,y,weight}` pontos/áreas de densidade |

`container` de objeto: `{ name, items: [], capacity (kg), searched: false, lootKey }` ou `null`.
`light` de objeto (postes, luminárias): `{ radius, color, needsPower: true }` ou `null`.
Tipos de objeto (render desenha todos): `bed, double_bed, sofa, armchair, table, chair, counter, kitchen_counter,
fridge, stove, sink, toilet, bathtub, shower, wardrobe, dresser, bookshelf, tv, desk, shelf, cash_register,
crate, trash_can, dumpster, car, tree, pine, bush, rock, lamp_post, mailbox, bench, fuel_pump,
washing_machine, workbench, barrel, log_pile, lamp, plant, rug, fence_gate, picnic_table, swing, grave,
police_car, ambulance, locker, gun_locker, medicine_cabinet, vending_machine, freezer, pallet, tire`.

### API `G.world`
- `generate(seed)` → map
- `idx(tx,ty)`, `inBounds(tx,ty)`
- `isBlocked(tx,ty, who)` — `who`: `'player'|'zombie'`. Paredes, portas fechadas, janelas (sempre bloqueiam andar;
  atravessa-se com ação "pular"), objetos `blocksMove`, água.
- `blocksSight(tx,ty)` — paredes, portas fechadas, janelas com cortina/barricada alta, objetos `blocksSight`.
- `lineOfSight(x0,y0,x1,y1)` → bool (percurso em grade; ignora o tile de origem).
- `moveEntity(e, dx, dy, radius, who)` → `{hitX, hitY, tx, ty}` — move com colisão círculo×tiles e desliza nas paredes.
- `isIndoors(x,y)` → id do prédio ou 0. `roomAt(x,y)` → room|null.
- `getObject(tx,ty)` → objeto|null. `objectsNear(x,y,r)`.
- `containersNear(x,y,r)` → `[{ source:'object'|'corpse'|'ground', obj, container, x, y }]` inclui cadáveres e o chão.
- `getStructure(tx,ty)` → `{ type, open, broken, locked, barricade, hp, curtain }` ou null.
- `setOpen(tx,ty,open)` → bool (emite `door:open/close`, `window:open`). Trancada → `door:locked`, false.
- `damageStructure(tx,ty,amount,who)` → `'none'|'damaged'|'broken'` (barricada absorve primeiro; emite eventos).
- `addBarricade(tx,ty)`, `removeBarricade(tx,ty)`, `breakWindow(tx,ty)`, `toggleCurtain(tx,ty)`.
- `findPath(x0,y0,x1,y1, who, maxNodes)` → `[{x,y}]` centros de tiles, ou null (A* 8-direções, sem cortar quinas).
- `update(dt, dtMin)`.

## Itens — `G.items` (dono: `items.js`)

Instância: `{ uid, type, cond (0..1 durabilidade), qty (munição/uso), uses (porções restantes 0..1), ammo (no pente), fresh (minutos até estragar) }`.
- `DEFS[type] = { name, cat, weight, desc, icon, weapon?, food?, medical?, light?, bag?, ammo?, tool? }`
  - `cat`: `weapon|firearm|ammo|food|drink|medical|tool|material|light|bag|clothing|misc|literature`
  - `weapon: { dmg, range, speed, arc, noise, durability, knock, twoHanded, blunt|blade, crit }`
  - `firearm: { dmg, range, noise, magSize, ammoType, spread, reloadTime }`
  - `food: { hunger (negativo = sacia), thirst, stress, boredom, spoils (min), needsOpener, cooked }`
  - `medical: { heals: 'bleeding'|'infection'|'pain'|'deep', ... }`
  - `light: { radius, battery }`; `bag: { capacity }`
- `create(type, opts)`, `def(item)`, `name(item)`, `weight(items)` (kg), `drawIcon(ctx, type, x, y, size)`.
- `fillContainer(container, roomType, objectType, rng)` — world chama na geração.
- `RECIPES = [{ id, name, needs:[{type,qty}], tools:[type], time (s), result:[{type,qty}], desc }]`,
  `canCraft(recipe, inventoryItems)`, `craft(recipe, inventory)`.

## Sobrevivência — `G.survival` (dono: `survival.js`)

- `initStats(player)`, `update(player, dtMin, dt)` (fome, sede, cansaço, fôlego, pânico, estresse, tédio, dor,
  molhado, temperatura, infecção, sangramento → vida).
- `player.stats = { hunger, thirst, fatigue (0 bem..1 exausto), endurance (1 cheio..0), panic, stress, boredom,
  pain, wet, infection (0..1; 1 = morte/transformação), sickness, temperature }`
- `player.injuries = [{ part, type:'scratch'|'laceration'|'bite'|'bruise'|'burn'|'fracture', bleeding, bandaged, dirty, infected, age }]`
  partes: `head, torso, left_arm, right_arm, left_hand, right_hand, left_leg, right_leg`.
- `moodles(player)` → `[{ id, level 1..4, name, desc, bad:bool }]`.
- `consume(player, item)`, `applyInjury(player, type, part)`, `treat(player, injury, item)`, `sleep(player)`.
- Mordida = infecção certa (morte em 1–3 dias). Arranhão 7%, laceração 25%.

## Jogador — `G.player` (dono: `player.js`)

```js
{ x, y, dir, alive, hp (0..100), name, profession, traits:[],
  moving, running, sneaking, aiming, speed,
  stats, injuries,                                  // survival
  inventory: { name, items, capacity },             // "container"
  equipped: { main: item|null, off: item|null, back: item|null },
  action: { name, t, duration, progress, onDone, cancelOnMove } | null,   // ações temporizadas estilo PZ
  anim: { state:'idle'|'walk'|'run'|'sneak'|'attack'|'shove'|'aim'|'shoot'|'hurt'|'climb'|'dead'|'eat'|'loot'|'sleep', t, swing },
  flashlightOn, sleeping, attackCd, visibleZombies, noiseLevel }
```
- `create(spawn, opts)`, `update(dt, dtMin)`.
- `getInteractions(tx,ty)` → `[{ label, fn, disabled?, hint? }]` (menu de contexto da UI).
- `startAction(name, seconds, onDone, opts)`, `cancelAction()`.
- `damage(amount, zombie)`; `equip(item, slot)`, `unequip(slot)`, `drop(item)`, `pickUp(groundItem)`,
  `transfer(item, fromContainer, toContainer)`, `useItem(item)`, `reload()`, `craft(recipe)`.
- Controles: WASD mover (relativo à tela) · Shift correr · C/Ctrl agachar (furtivo) · Mouse mirar ·
  Botão esq. atacar · Botão dir. segurar = mirar (arma de fogo) / clique = menu de contexto ·
  Espaço empurrar · E interagir com o mais próximo · F lanterna · R recarregar · Q gritar ·
  Tab/I inventário · 1–5 atalhos · Esc pausa · Z dormir (em cama).

## Zumbis — `G.zombies` (dono: `zombies.js`)

```js
{ id, x, y, dir, hp, maxHp, speed, state:'idle'|'wander'|'investigate'|'chase'|'attack'|'lunge'|'stagger'|'down'|'crawl'|'eat'|'bang'|'dead',
  target:{x,y}|null, path, alert, attackCd, stagger, downT, crawler, animT, variant:{ skin, shirt, pants, hair, hairStyle, female, blood } }
```
- `init(state)`, `update(dt, dtMin)`, `spawn(x,y,opts)`, `near(x,y,r)`, `inArc(x,y,dir,range,arc)`,
  `hit(z, damage, opts{ fromX, fromY, knock, weapon, crit })` → `true` se morreu, `shove(z, fromX, fromY)`.
- Escutam o evento `noise`. Visão via `G.world.lineOfSight` e escuridão (`state.light`, lanterna).
- Morte → vira `state.corpses` (com `container` de loot) + decal de sangue.

## Render — `G.render` e `G.fov` (dono: `render.js`)

- `G.render.init(canvas)`, `resize(w,h)`, `draw(state, dt)`, `fps`.
- `G.fov.compute(state)` → `state.fov = { vis: Float32Array(w*h) 0..1 (visível agora), seen: Uint8Array (já explorado) }`.
- `G.fov.canSee(x,y)` → bool (tile visível agora para o jogador). Zumbis fora da visão **não** são desenhados.
- Desenha: pisos, paredes (recorte/cutaway perto do jogador), telhados (somem quando o jogador entra),
  objetos, itens no chão, cadáveres, decals, entidades animadas, luz (dia/noite, lanterna em cone, postes/luminárias
  com energia), clima (chuva, neblina, relâmpago, vento), partículas, sombras, vinheta, indicadores de mira.

## Áudio — `G.audio` (dono: `audio.js`)

- `init()` (chamado no primeiro gesto do usuário), `update(dt, state)`, `play(name, {x,y,vol})`.
- Reage a eventos. Ambiência (vento, pássaros, grilos, chuva, trovão), trilha calma e melancólica procedural,
  sons espacializados (pan/volume pela distância ao jogador), batimento cardíaco no pânico.

## UI — `G.ui` (dono: `ui.js`, `css/style.css`)

- `init()`, `update(dt, state)`, `onModeChange(mode, prev)`, `handleEscape()` → true se fechou algo,
  `showTitle()`, `isCapturingMouse()` → true se o mouse está sobre painel (jogador não ataca).
- DOM dentro de `#ui` (pointer-events apenas nos painéis). Tela título, criação de personagem (nome, profissão,
  traços), HUD (moodles, relógio, clima, arma equipada, barra de ação), inventário/loot (estilo PZ), menu de
  contexto, crafting, painel de saúde, mensagens, pausa, tela de morte ("Assim foi como você morreu...").

## Eventos (`G.events.emit(nome, dados)`)

| evento | dados |
|---|---|
| `message` | `{text, kind:'info'|'warning'|'danger'|'good'}` |
| `noise` | `{x,y,radius,kind}` kinds: `step, run, door, window, glass, melee, gunshot, shout, barricade, alarm, thump, helicopter` |
| `player:step` | `{x,y,surface,running,sneaking}` |
| `player:attack` | `{weapon, x,y,dir, hit:bool, firearm:bool}` |
| `player:shove` | `{x,y}` |
| `player:hit` | `{zombie, part, injury}` |
| `player:hurt` | `{amount}` |
| `player:death` | `{cause}` |
| `player:action` | `{name, phase:'start'|'done'|'cancel'}` |
| `player:eat` / `player:drink` | `{item}` |
| `player:equip` | `{item, slot}` |
| `player:reload` | `{item}` · `player:dryfire` `{}` |
| `player:climb` | `{x,y}` |
| `player:sleep` | `{phase:'start'|'end'}` |
| `zombie:alert` | `{zombie}` (viu/ouviu o jogador) |
| `zombie:groan` | `{zombie}` |
| `zombie:attack` | `{zombie, hit:bool}` |
| `zombie:hit` | `{zombie, damage, killed, weapon}` |
| `zombie:death` | `{zombie}` |
| `zombie:thump` | `{x,y}` (batendo em porta/janela/barricada) |
| `door:open` `door:close` `door:locked` `door:break` | `{x,y}` |
| `window:open` `window:break` `window:climb` | `{x,y}` |
| `barricade:add` `barricade:break` | `{x,y}` |
| `item:pickup` `item:drop` `item:transfer` | `{item}` |
| `container:open` | `{container, obj}` |
| `craft` | `{recipe}` |
| `time:hour` `{hour,day}` · `time:day` `{day}` · `time:dawn` · `time:dusk` |
| `weather:rainStart` · `weather:rainStop` · `weather:thunder` `{intensity}` |
| `power:off` · `water:off` · `helicopter` `{phase}` |
| `game:start` `game:pause` `game:resume` `game:over` `{cause, stats}` |
