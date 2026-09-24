# Notas entre etapas

Cada subagente registra aqui: o que entregou, pendências e pedidos para outros módulos.

## Etapa 1 — Mundo (`js/world.js`, `tools/mapview.html`, `tools/validate-world.mjs`)

Revisão 2 (após a revisão independente): cidade maior e variável, casas variadas, dados para o render isométrico,
determinismo Node × navegador, correções de API. Mapa agora 180×180 (`G.CONST.MAP_W/H`).

### O que a geração faz
- **Plano paramétrico** (determinístico por seed; 8 orientações por espelho/transposição): rodovia (6 de largura, faixa
  contínua na cidade, calçadas; rural fora dela com acostamento), rua principal (6, faixa tracejada, faixas de pedestre),
  grade de **quarteirões compridos** (1 ou 2 colunas × 2 ou 3 linhas, frente de 38–80 e fundo de 17–23 por lado),
  ruas residenciais de 4 sem faixa central, **becos** de 3 atrás das lojas (e dos quintais) nas linhas do centro,
  ruas sem saída com balão (sul/leste/oeste da rodovia), às vezes um trecho da grade some, estrada de madeireiros.
  Usos de quarteirão inteiro: **praça** (chafariz, bancos, árvores) e **escola** (salas, cantina, cozinha, diretoria,
  quadra, balanços, cerca de tela).
- **Centro**: comércio só de frente para a rua principal/rodovia perto do cruzamento; conjunto sorteado por seed (pode
  repetir): Mercado/Mercearia/Supermercado, Posto (bombas + conveniência), Delegacia (cela com grades, arsenal trancado,
  vestiário, viaturas nos fundos), Farmácia/Drogaria, Lanchonete/Diner/Café, Bar/Taverna/Saloon, Ferragens, Loja de roupas,
  Conveniência, Correios, Biblioteca, Clínica/Posto de Saúde, Corpo de Bombeiros, Armazém/Galpão (na borda). Lojas com
  vitrine, porta dos fundos e **estacionamento atrás** (vagas marcadas, acesso pelo beco ou corredor lateral).
- **Casas** (≈ 17 por seed, 10–30): lote de 16–26 × 17–23; 1–3 quartos (66% com 2+), corredor (≈40%), escritório,
  lavanderia, planta em L de verdade (ala lateral e/ou dos fundos, ≈60%), garagem com interior ≥ 4×6 e portão de 3
  tiles (≈47%, carro/picape dentro ou na entrada), varanda (`PORCH`), caminho, caixa de correio, arbustos; quintal com
  ≥ 4 de fundo: cerca de madeira/tela/sebe com portão (`FENCE_GATE`), galpão (prediozinho com porta), piscina (`POOL`),
  varal, churrasqueira, mesa de piquenique, balanço, lenha, horta, árvores. Cercas de divisa sem duplicar.
  ~25% das portas externas trancadas; nenhuma casa fica "selada" (sempre há porta destrancada ou janela livre por dentro).
- **Periferia**: fazenda (casa, celeiro, plantações cercadas), lago (praia, juncos, píer `DOCK`, mesas), rio opcional
  com pontes (`map.bridges`, pontilhão `DOCK` em estrada de terra), ferrovia opcional (marca `rail`), motel de beira de
  estrada, parque de trailers (trailers com corredor, quarto, banheiro, cozinha, sala), igreja + cemitério fora da grade.
- **Mata**: floresta densa nas bordas, clareiras (sem árvores dentro), 1–2 acampamentos, cabana de caça, torre de vigia,
  carro batido na estrada de terra, trilhas ligando tudo à estrada mais próxima.
- **Rua**: postes, carros estacionados (4×2) e abandonados (atravessados só em vias de 6, sem nunca fechar a pista),
  batida num cruzamento do centro, engavetamento com viatura/ambulância e barreira de barris na saída da cidade.
- **Início**: casa afastada do centro e com poucos vizinhos; portas destrancadas/fechadas, janelas inteiras,
  `building.start = true`; contêineres **re-preenchidos** com `lootKey` `start_*` (RNG de loot próprio).
- **Zumbis**: hotspots em grupos (`group`) — comércio/escola/igreja, cruzamentos do centro, trechos da rua principal,
  esquinas residenciais, salas de casas, engavetamento, acampamentos, singles na mata — com gradiente centro → periferia
  (densidade ~10× maior no centro) e nenhum ponto a menos de 22 tiles do início.

### Dados para o render
`roadMarks`, `wallMask` (+ `wallAxis`), `building.parts/roofType/ridgeAxis/face`, `FLOOR.DOCK/PORCH/POOL`,
`bridges` — ver `docs/ARCHITECTURE.md` (seção Mapa). Sugestões: paredes finas ao longo dos bits de `wallMask`; portas e
janelas giradas por `wallAxis`; telhado por `parts` (duas águas/quatro águas/plano); água por baixo de `DOCK` e das
pontes; marcas de rua como linhas finas (tracejado a cada ~1 tile); faixa de pedestre = zebra de ~1 tile de largura
centrada no segmento; `sightCost` para escurecer atrás de sebes; plantações = faixas `DIRT`/`DARK_GRASS` com `bush`.

### Convenções e decisões
- `rot` = frente (`0:+x 1:+y 2:-x 3:-y`); veículos 4×2 (ambulância 5×2) ao longo do `rot`; `height` relativo à parede.
- Colisão igual para jogador e zumbi. Janelas nunca passam andando (pular: `canClimb`/`climbTarget`); portões e cercas
  também se pulam; sebes não.
- Sebe = visão parcial (2+ tiles bloqueiam no `lineOfSight`; `sightCost` 0.5). Cortina continua mesmo com vidro quebrado.
- `findPath`: `'player'` abre portas/portões destrancados (+2), `'zombie'` atravessa portas (+6), janelas (+10), cercas (+8),
  sebes (+30), +6 por tábua — o módulo de zumbis bate/pula ao chegar; `'open'` = todas as portas abertas; `opts.partial`.
- Barricada: `barricadeHp` separado (30 por tábua, máx. 4), tábua nova soma ao que resta, a sobra de dano não passa para a
  porta, um `barricade:break` por tábua. Portão de garagem age em grupo (`structureGroup`). Quebrada ⇒ hp 0 e sem tranca;
  aberta e trancada são exclusivos (`setLocked` só em fechadas).
- Quebras emitem ruído via `G.noise.emit` (porta 16 `thump`, janela 18 `glass`, tábua 10 `barricade`, cerca 10 `thump`),
  partículas e decals de vidro. `setOpen` não faz ruído (quem chama decide).
- Itens: use `takeFrom`/`putInto`/`transferItem` (funcionam com objeto, cadáver, "Chão" e inventário `{items,capacity}`).
- **Determinismo**: nenhum comparador de `sort` usa RNG (chaves pré-calculadas; `sort` estável), nada de
  `sin/cos/pow/hypot` na geração. `validate-world --browser` compara Node × Chromium (9 seeds idênticas) e há hashes de ouro.

### Tipos usados
- Pisos: todos exceto `ROAD_LINE` (substituído por `roadMarks`); novos `DOCK`, `PORCH`, `POOL`.
- Paredes: `WOOD, BRICK, PLASTER, CONCRETE, GLASS, WINDOW, DOOR, GARAGE_DOOR, FENCE_WOOD, FENCE_METAL, HEDGE, FENCE_GATE`.
- Objetos: todos os do contrato + `pickup, grill, clothesline, watchtower, fountain` (`fence_gate` objeto não é mais usado).
- Tipos de prédio (`building.type`): `house, shed, trailer, cabin, store, gas_station, police, pharmacy, diner, office,
  library, clinic, fire_station, school, warehouse, barn, church, motel`.
- Cômodos: os 15 do contrato.
- lootKey = `"<etiqueta>:<objeto>"`; etiquetas: tipos de cômodo de casa (`kitchen, bedroom, bathroom, living, garage,
  office, storage`) e `grocery, grocery_storage, grocery_office, pharmacy, pharmacy_back, hardware, hardware_storage,
  clothing, clothing_storage, convenience, convenience_storage, post_office, post_storage, library, library_office,
  gas_station, gas_storage, diner, diner_kitchen, bar_storage, police_lobby, police_office, police_lockers,
  police_armory, clinic, clinic_exam, clinic_pharmacy, fire_garage, fire_office, fire_kitchen, fire_dorm,
  fire_storage, school_class, school_cafeteria, school_kitchen, school_office, warehouse, warehouse_tools,
  warehouse_office, church_office, church_storage, motel_office, motel_room, motel_bath, farm, shed, hunting, camp,
  outdoor` (carros, lixeiras, caçambas, caixas de correio, máquinas de venda, churrasqueiras). Casa inicial: `start_*`.
  `fillContainer(container, roomType, objType, rng)` recebe o tipo de cômodo do contrato (ou `'outdoor'`).

### Ferramentas
- `tools/mapview.html?seed=N[&scale=5&roofs=1&rooms=1&labels=0&zs=0]` — vista de cima (pisos, paredes, portas —
  vermelho trancada/laranja aberta —, janelas, móveis com letras em escala ≥ 12, contêineres, luzes, marcas de rua,
  pontes, início em ciano, pontos de zumbi).
- `node tools/validate-world.mjs [--n 100] [--seeds a,b] [--browser] [--update-golden] [--verbose]` — valida >100 seeds
  (estrutura, alcance, estados, distribuição de casas, variedade de layout, hashes de ouro) + testes de API e desempenho;
  `--browser` compara com o Chromium.

### Pedidos às próximas etapas
- **Render**: paredes finas via `wallMask`; telhados por `parts/roofType/ridgeAxis`; marcas de rua; `DOCK`/pontes com água
  por baixo; veículos 4×2/5×2 com cor por `variant` e `wrecked` (carro batido); novos objetos
  (`pickup, grill, clothesline, watchtower, fountain`); `FENCE_GATE` aberto/fechado.
- **Itens**: loot por `lootKey` (lista acima), inclusive `start_*` (casa inicial mais generosa, mas realista).
- **Zumbis**: spawn por grupos (`pickZombieSpawn` + os vizinhos do mesmo `group`), `findPath(...,'zombie')` e
  `damageStructure`/`canClimb` ao chegar em portas, janelas, portões e barricadas.
- **Jogador/UI**: pular (`canClimb`/`climbTarget`), trancar (`setLocked`), barricar, cortina, quebrar vidro, e mover itens
  só com `takeFrom`/`putInto`/`transferItem`.

## Etapa 2 — Render (`js/render*.js`, `tools/gallery.html`)

### Arquivos
Tudo procedural, sem assets. Namespace interno `G.R` (não é contrato; outros módulos usam só `G.render`/`G.fov`).
Ordem das tags no `index.html` (antes de `js/render.js`):
- `render-core.js` — `G.R`: escala vertical `R.ZPX = 33` px/m (jogador ≈ 1,75 m ≈ 58 px; parede `R.WALL_M` ≈ 2,42 m),
  **`R.TUNE`** (todos os números de ajuste: memória, luar, interiores, lanterna, FOV, orçamentos, zoom, raio-X, pós),
  cores (`R.hex/css/mix/darken/desat/rgb01/hash`), `R.Cache` (LRU real), casco convexo e o kit de "sprite 3D".
  `R.S` = escala dos caches: 0,5 / 1 / 2 conforme o zoom, com histerese (sobe para 2 em 1,25 e desce em 1,05;
  0,5 abaixo de 0,78 e volta em 0,85). Cada escala tem seus caches; trocar de zoom não descarta nada e, enquanto a
  escala nova não fica pronta, o sprite da escala antiga é desenhado esticado.
- `render-ground.js` — chão em blocos de tela (512×256; 1024×512 em zoom baixo) construídos **em fatias** (passes
  base → transições → suavização → manchas → trilhas → faces → marcas → AO → detalhes) dentro de um orçamento por
  quadro; bloco que falta mostra um substituto (miniatura (u,v) do mapa ou o bloco de outra escala). Grama com
  manchas secas/viçosas por ruído, 4–8 tufos em "V" por tile (somem em zoom < 1), trilhas gastas porta → rua, folhas
  sob as árvores, tabuleiro/sombra de ponte (`map.bridges`), capacho nas portas externas e detalhes "narrativos" por
  hash (jornais, sacos de lixo encostados em prédios, latas, brinquedos e bicicletas em quintais, papéis e manchas de
  sangue secas) — só visuais, sem objeto de jogo (se a jogabilidade precisar deles, o mundo deve criá-los).
- `render-walls.js` — paredes finas, portas/janelas em todos os estados, cercas/sebes; desgaste por variante nas faces
  externas; arandela ao lado de portas externas (acesa à noite com energia, por sorteio estável prédio/dia);
  ar-condicionado em algumas janelas. Telhados por `parts/roofType/ridgeAxis` num **sprite por prédio** (telhas com
  trocas/musgo/escorridos, calhas nos beirais da frente, laje com manchas/remendos, claraboias, AC e dutos, chaminés).
- `render-objects.js` — modelos de todos os tipos; árvores com 3–5 massas irregulares, galhos e espécies (carvalho,
  bordo, olmo, bétula, seca); rodas de carro como prismas atrás da carroceria. Encosto na parede via `RO.snap` (WeakMap).
- `render-actors.js` — humanos/zumbis (volume em 2 tons, contorno escuro, zumbi torto arrastando um pé, roupa rasgada,
  balanço/respiração parado); zumbis em **sprites cacheados** por aparência/estado/quadro/direção (8 dir., 12 quadros
  de passada); cadáveres em sprite + poça viva. Estado por ator em WeakMap (nada é escrito nos objetos do jogo).
- `render-light.js` — curva de luz por hora, luar, relâmpago (2 pulsos), sol/sombras, luzes estáticas (postes/lâmpadas,
  cômodos acesos, janelas, arandelas) recalculadas **só na região** (raio ~9) de uma porta/janela/cortina que mudou,
  FOV, grade de sombreamento (u,v) e `lightLum` (base de `G.render.lightAt`).
- `render-fx.js` — sombras (estáticas em blocos cacheados por posição do sol + dinâmicas), decals, poças, partículas,
  chuva (fora dos volumes dos prédios abertos), folhas, neblina, vinheta e grão.
- `render.js` — orquestra: câmera/zoom, cutaway, telhados/raio-X, ordenação, mapa de luz, emissivos, overlays, debug.
- `tools/gallery.html` — mapa sintético 200×200 renderizado pelo próprio `G.render` (com `opts.sync`): pisos, paredes,
  portas/janelas (eixos x e y), cercas, todos os objetos × 4 rotações, telhados, decals/cadáveres, cena noturna e
  folhas de humanos (16 poses) e zumbis (10 estados) × 8 direções.

### Pipeline de um quadro
chão (blocos) → letreiros/parapeitos → água/decals/poças → luz quente do entardecer (aditiva) → sombras do sol
(tom azulado) → sombras de contato → cadáveres/itens (só `canSee`) → passe vertical ordenado (paredes com recorte,
objetos fatiados, zumbis, jogador) → telhados → partículas → "névoa" da memória (¼ de resolução, antes do multiply)
→ **um** multiply de meia resolução (grade + janelas no chão + ops de paredes/objetos/atores/telhados + clarão de tiro +
vinheta + grão) → emissivos aditivos (sol nas faces, halos, janelas, arandelas, contorno frio dos atores, feixe da
lanterna) → neblina/chuva/folhas → relâmpago aditivo → overlays → debug.

### Modelo de visão (estilo PZ) — mudança de contrato/expectativa
- **Não há névoa de exploração**: o que nunca foi visto é desenhado como memória. Memória = brilho
  `lerp(R.TUNE.mem.day 0,78, mem.night 0,45, env.night)` + leve tom azul à noite + até 28% de dessaturação (cinza).
- Só **entidades dinâmicas** somem fora da visão: zumbis, cadáveres e itens no chão aparecem na hora em que
  `G.fov.canSee` fica verdadeiro e esmaecem só ao sair. Paredes/objetos/decals ficam sempre visíveis. Exceção: com o
  telhado escondido (jogador dentro), objetos de tiles nunca vistos daquele prédio não são desenhados.
- **FOV = mesma DDA do `G.world.lineOfSight`** (mesmas quinas, 2 sebes bloqueiam), partindo da posição exata do
  jogador, com `G.world.sightCost` (sebe 0,5, cerca de madeira 0,15 atenuam). Cone de ±100° (`TUNE.fov.cone`),
  ~1,9 tile de percepção atrás, raio 30 de dia e 7,5 no escuro fora de luz (tile com luz ≥ `TUNE.fov.lightMin` conta
  como iluminado; lanterna estende no cone), neblina reduz. Salto > 6 tiles (teleporte) zera a visão antiga.
- **Percepção**: o JOGADOR vê o que `G.fov.canSee(x, y)` diz (é o que a tela mostra). ZUMBIS devem usar
  `G.world.lineOfSight` + `G.render.lightAt(x, y)` (luz no jogador: escuro ⇒ detectam mais perto).

### API (além do contrato)
- `G.render.lightAt(x, y)` → 0..1: luz efetiva no ponto (ambiente/luar, interiores, lâmpadas/janelas/arandelas,
  relâmpago, feixe da lanterna do jogador se o ponto estiver nele e à vista; o brilho cosmético em volta do jogador
  à noite não conta). Medido: meio-dia fora 1,0; interior de dia 0,7–0,85; noite ao luar 0,14; interior escuro à
  noite 0,09; sob poste aceso ≈ 1; no feixe da lanterna ≈ 1.
- `G.fov.compute(state)` inicializa sozinho (mapa novo → estado novo); `canSee(x,y)` (alvo > 0,25; `false` antes de
  haver mapa), `visAt(x,y)` (suavizado), `invalidate()`. `state.fov = { vis, seen, target }`.
- `G.render.opts = { fov, roofs, weather, post, overlays, shadows, sync }` — `sync: true` desliga os orçamentos
  (tudo pronto no mesmo quadro: galeria/capturas). `G.render.resetMap()`, `fps`, `drawMs`, `lastMs`,
  `stats { ops, keep, list }`, `sec` (tempos por seção). `?debug=1` mostra também "luz no jogador" e blocos faltando.
- Zoom: `G.input.mouse.wheel` com magnitude (≈1 por clique, trackpad fracionário): passo `1,12^wheel`, 0,6–2,0,
  suave; `G.camera.zoom` alterado por fora é respeitado.
- Raio-X: o telhado só some **inteiro** com o jogador dentro do prédio; quando o telhado/parede alta/copa tapa o
  jogador por fora, abre-se um buraco circular suave (~3 tiles de tela) em volta dele. Copa de árvore sobre o cursor
  também abre um buraco em volta do cursor. Cutaway: dentro de um prédio todas as paredes da frente dele descem;
  fora, só as próximas.

### Orçamentos (ms por quadro, `R.TUNE.budget`) e limites
Chão 4 (14 quando faltam blocos), paredes 2, objetos 3, atores 2, telhados 2, sombras estáticas 2,5. Estourou: usa o
sprite de outra escala (ou um irmão da mesma variedade); sem substituto, ainda gera até um teto rígido
(paredes +6 ms, objetos +8 ms) e o resto aparece nos quadros seguintes. Caches LRU com tamanho dinâmico (blocos
visíveis × 1,6 + folga). Decals: `state.decals` com mais de 1500 → o render remove os 300 mais antigos (início do
array); desbotam até 35% em ~3 dias de jogo. Partículas: teto 900 (mais antigas saem).

### O que o render espera dos outros módulos (tudo opcional — há padrões seguros)
**Jogador** (`state.player`): `x, y, dir`, `alive`, `running`, `sneaking`, `aiming`, `flashlightOn`, `sleeping`;
`anim.state` (`idle|walk|run|sneak|attack|shove|aim|shoot|hurt|climb|dead|eat|loot|sleep`), `anim.swing` 0..1 nos
golpes, `anim.t` em `shoot/hurt/climb`; `equipped.main.type` (arma por palavra-chave, ver código) e `equipped.back`;
aparência opcional `player.look`. A aparência é recalculada quando `equipped`/`back`/`look` mudam (hash).
**Zumbis** (`state.zombies[]`): `id` estável, `x, y, dir`, `state` do contrato, `animT`, `variant`
(`{ skin, shirt, pants, hair, hairStyle, female, blood }`, cada campo opcional). **Cadáveres** `{ x, y, dir, variant,
time }`. **Itens no chão** `{ x, y, item }` → `G.items.drawIcon(ctx, type, 0, 0, 32)` (uma vez por tipo).
**Decals** `{ x, y, type:'blood'|'bloodpool'|'glass'|'footprint'|'bullet'|'puddle', size, rot, alpha, t }`.
**Partículas** no formato do contrato (também `'spark'|'shell'|'muzzle'`).
**Eventos tratados**: `player:attack {firearm, dir}` (clarão/fumaça/cápsula/luz), `zombie:hit`, `player:hit`,
`door:open|close|break`, `window:open|close|break|curtain`, `barricade:add|break|remove`, `fence:break` (FOV, luzes
da região e sprites do tile), `game:start`. Mudança estrutural fora desses eventos: `G.fov.invalidate()` e
`G.R.light.dirtyAt(x, y)`.
**Mundo**: `G.world.lineOfSight/sightCost`, `wallMask`, `building`, `rooms`, `buildings[].parts/roofType/ridgeAxis/
name/face/doors`, `lots[].kind`, `bridges`, `objects[].light { radius, color, needsPower }` (acesa só se
`state.power` ou `!needsPower`), `roadMarks`. Letreiros usam `building.name` de lojas/serviços.
**Clima/luz**: `state.weather` (rain, fog, wind, cloud, lightning, storm), `state.time/power`.

### Desempenho (Chromium headless + SwiftShader; cenas e scripts do revisor)
Mediana do `draw()` em ms (antes → depois), 1280×720; entre parênteses FPS medido. "sync" = `draw()` + raster
forçado (`getImageData`), que é o custo real no SwiftShader; o `draw()` sem sync esconde parte do raster fora dele.

| cena | draw (antes → depois) | sync (antes → depois) | FPS |
|---|---|---|---|
| casa inicial | 8,2 → 10,9 | 67,6 → 44,3 | 15 → 21 |
| centro | 5,9 → 10,0 | 60,7 → 41,3 | 15 → 24 |
| floresta | 11,5 → 23,9 | 142,2 → 85,6 | 7 → 12 |
| noite + chuva + lanterna | 5,8 → 9,6 | 57,6 → 41,8 | 16 → 24 |
| zoom 0,6 | 74,6 → 15,1 | 78,7 → 61,7 | 13 → 16 |
| zoom 2 | 4,1 → 19,2 | 54,4 → 38,3 | 18 → 26 |
| horda de 40 | 10,4 → 12,2 | 70,9 → 44,9 | 13 → 20 |
| zoom 0,6 @1920×1080 | 208 → 41 | 336 → 150 | 3 → 7 |

Trabalho JS puro (perfil de CPU, sem o raster): ≈ 4–5 ms na cidade, ≈ 7,5 ms na floresta, ≈ 5 ms com 40 zumbis.
Cruzar zoom com a roda: pior quadro 674 → 56 ms. Caminhada: pior quadro 46 → 28 ms (19 FPS contra 15). Teleporte para área nova:
pior quadro 24 ms. Em GPU real as composições de tela cheia são baratas.

### Sugestões / pedidos
- **Zumbis (IA)**: detecção por `G.world.lineOfSight` e distância escalada por `G.render.lightAt` no jogador.
- **Jogador**: `anim.state` + `anim.swing` nos ataques; `player:attack {firearm:true, dir}` a cada tiro.
- **Itens**: `drawIcon(ctx, type, x, y, size)` desenhando dentro do quadrado pedido.
- **Mundo**: emitir evento (ou chamar `G.R.light.dirtyAt`) se luzes/`power` mudarem por outros meios.
