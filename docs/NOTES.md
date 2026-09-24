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
- `render-core.js` — `G.R`: escala vertical `R.ZPX = 33` px/m (jogador ≈ 1,75 m ≈ 58 px; parede `R.WALL_M` ≈ 2,42 m =
  80 px), cores (`R.hex/css/mix/lighten/darken/desat/hash`), cache LRU, casco convexo e o kit de "sprite 3D" `Model`
  (caixas/prismas/cilindros com faces sombreadas pela luz fixa, ordenadas por profundidade). `R.S` = escala dos
  caches (1, ou 2 quando zoom > 1,15).
- `render-ground.js` — pisos em blocos de tela 512×256 (LRU), texturas por tipo com variação por hash, transições
  suaves (faixas + marching squares para grama/terra/areia/cascalho/asfalto/água, margens com espuma), marcas de rua
  (`map.roadMarks`), meio-fio/varanda/píer/piscina/ponte, tapetes, AO de parede, tufos/flores. Chão sob paredes finas
  vem do "quarto-fonte" (`R.ground.qsrc`: exterior de um lado, cômodo do outro).
- `render-walls.js` — paredes finas por `wallMask`/eixo com junções L/T/+, acabamentos por material/cômodo
  (siding, tijolo, reboco, bloco, metal, celeiro, tábuas, tronco, papel de parede, azulejo, pintura), portas/janelas em
  todos os estados (aberta/quebrada/trancada/cortina/barricada 1–4), vitrines, portões de garagem em grupo, cercas de
  madeira/metal, sebes, `FENCE_GATE`. Sprites por tile (estado estático + recorte + aceso). Telhados reais por
  `parts/roofType/ridgeAxis` (gable, hip, pyramid, flat com platibanda/AC, chaminés).
- `render-objects.js` — modelos de todos os tipos de objeto (respeita `w/h/rot`, variantes por hash, carros por
  `variant`/`wrecked`, sirene), sprites cacheados por tipo/rot/variante com orçamento por quadro (7 ms), silhueta
  para o mapa de luz. Móveis encostam na parede fina (`RO.snap`).
- `render-actors.js` — humanos/zumbis com esqueleto 3D simples (direção contínua), ciclos e poses; cadáveres.
- `render-light.js` — paleta de luz por hora (já com a correção de cor), relâmpago, sol/sombras, luzes estáticas
  (postes/luminárias com energia, cômodos acesos à noite, janelas), FOV (shadowcasting) e grade de sombreamento.
- `render-fx.js` — sombras (estáticas em blocos + dinâmicas), decals, poças, partículas, chuva, folhas, neblina,
  vinheta e grão.
- `render.js` — orquestra: câmera/zoom, cutaway, telhados, ordenação, mapa de luz, emissivos, overlays, debug.
- `tools/gallery.html` — mapa sintético 200×200 renderizado pelo próprio `G.render`: todos os pisos, paredes e
  junções, portas/janelas em todos os estados (eixos x e y), vitrine/garagem, cercas/portões, todos os objetos × 4
  rotações, telhados (gable x/y, hip, pyramid, flat, L), decals/cadáveres/itens/partículas, cena noturna, e folhas de
  humanos (16 poses) e zumbis (10 estados) × 8 direções. Abre com duplo clique.

### Pipeline de um quadro
chão (blocos cacheados) → água/respingos → decals/poças → cadáveres e itens (só onde `vis > 0`) → sombras do sol
(estáticas cacheadas por posição do sol + dinâmicas) → passe vertical ordenado (paredes com recorte, objetos
fatiados em colunas de meio tile — objetos grandes ordenam certo —, zumbis, jogador; árvores balançam; objeto alto
na frente do jogador fica translúcido) → telhados (+ copas altas na frente redesenhadas recortadas) → partículas →
mapa de luz em meia resolução (`multiply`: grade (u,v) por meio tile + quads verticais de paredes/objetos/atores/
telhados com gradiente) + dessaturação da memória (`saturation`, exceto o que está à vista na frente) → emissivos
(halos de postes, janelas acesas, sirene, máquinas) → neblina → chuva (não cai dentro do prédio do jogador) → folhas
→ relâmpago, vinheta, grão → overlays (tile do mouse, mira) → debug.

### API (além do contrato)
- `G.render.opts = { fov, roofs, weather, post, overlays, shadows, fixedTime, satKeep }` (todos `true`/`null` por
  padrão; a galeria desliga `fov/post/overlays`). `G.render.resetMap()` força reconstruir caches do mapa.
- `G.render.fps`, `drawMs` (média suavizada), `lastMs`, `stats` (quads, contadores), `sec` (tempos por seção,
  para profiling). `?debug=1` → overlay com FPS, ms, tile/hora/luz, contadores e anéis de ruído (`state.noises`).
- `G.fov.compute(state)`, `canSee(x,y)` (alvo > 0,25), `visAt(x,y)` (valor suavizado 0..1), `invalidate()`.
  `state.fov = { vis, seen, target }`. Visão: ~30 tiles de dia, menos à noite fora de luz (lanterna/postes estendem),
  cone de ~200° + ~1,9 tile de percepção atrás, neblina reduz; suavizado no tempo; recalcula ao mudar de tile/direção
  ou a cada 3 quadros (janela de 36 tiles). Paredes visíveis ficam acesas; memória escurecida e dessaturada;
  nunca visto quase preto. Área de ~24 tiles em volta do início já vem "vista".
- Zoom: roda do mouse (`input.mouse.wheel`), 0,6–2,0 suave; `G.camera.zoom` alterado por fora é respeitado.
  `G.camera.shake` (core) é preservado.

### O que o render espera dos outros módulos (tudo opcional — há padrões seguros)
**Jogador** (`state.player`):
- `x, y, dir` (rad, mundo), `alive`, `running`, `sneaking`, `aiming`, `flashlightOn`, `sleeping`.
- `anim.state`: `'idle'|'walk'|'run'|'sneak'|'attack'|'shove'|'aim'|'shoot'|'hurt'|'climb'|'dead'|'eat'|'loot'|'sleep'`.
  A passada (walk/run/sneak) sai do **deslocamento real** (funciona sem `anim`); `anim.state` serve para as ações.
- `anim.swing` 0..1 = progresso do golpe/empurrão (0–0,25 preparação, 0,25–0,55 golpe, depois recuperação).
  Se não houver `swing`, usa `anim.t` quando `anim.t <= 1`.
- `anim.t`: segundos desde o início do estado para `shoot` (recuo some em ~0,17 s) e `hurt` (~0,33 s); para `climb`
  é o progresso 0..1 do pulo.
- `equipped.main.type` → tipo de arma por palavra-chave: `bat|taco`, `axe|machado`, `hatchet`, `knife|faca`,
  `machete`, `crowbar`, `hammer|martelo`, `sledge`, `shovel|spade`, `pan|frigideira`, `golf`, `plank|tabua|board`,
  `pipe|cano`, `wrench|chave`, `pistol|revolver|handgun|glock|magnum`, `shotgun|escopeta`, `rifle|carbine|hunting`,
  `flashlight|lanterna|torch`. Sem casar: `G.items.def(item).cat === 'firearm'` → pistola; `cat === 'weapon'` →
  cano (ou facão se `weapon.blade`); senão "item na mão". Duas mãos: taco, machado, pá, golfe, tábua, marreta,
  rifle, escopeta. `equipped.back` → desenha mochila.
- Aparência opcional `player.look = { skin, shirt, pants, hair, hairStyle 0–5, female, shoes, jacket }` (cor CSS ou
  índice de paleta).
**Zumbis** (`state.zombies[]`): `id` (estável — define aparência/variação), `x, y, dir`, `state` do contrato
(`idle, wander, investigate` = trôpego; `chase` inclinado com braços à frente; `attack`/`lunge` agarrando;
`bang` socando; `stagger`; `down`; `crawl` ou `crawler: true`; `eat` ajoelhado; `dead`), `animT` (desfasa rastejo),
`variant = { skin, shirt, pants, hair, hairStyle, female, blood 0..1 }` (cada campo cor CSS ou índice; ausente =
sorteado pelo `id`). Só são desenhados onde `vis > 0` (esmaecem na borda).
**Cadáveres** `{ x, y, dir, variant, time }` (a poça cresce nos primeiros minutos de jogo após `time`). **Itens no chão**
`{ x, y, item }` → `G.items.drawIcon(ctx, type, 0, 0, 32)` cacheado por tipo (sem `drawIcon`: marcador genérico).
**Decals** `{ x, y, type:'blood'|'bloodpool'|'glass'|'footprint'|'bullet'|'puddle', size (tiles), rot, alpha, t }`:
persistem, desbotam em ~3 dias de jogo até 35%, teto 1000. **Partículas** no formato do contrato (tipos também
`'spark'`, `'shell'`, `'muzzle'`), física com gravidade e quique; sangue que cai vira mini-decal; teto 900.
**Eventos que o render já trata** (não precisa duplicar o visual): `player:attack {firearm, dir}` → clarão, fumaça,
cápsula, faíscas e luz do tiro; `zombie:hit {zombie, killed}` → jorro + decal; `player:hit` → sangue;
eventos de porta/janela/barricada/cerca → invalida FOV/luzes/sprites do tile; `game:start` → reinicia caches.
Tremor de câmera fica com quem causa (`G.camera.shake`).
**Mundo**: `G.world.blocksSight` (FOV), `wallMask`, `building`, `rooms`, `buildings[].parts/roofType/ridgeAxis`,
`objects[].light/power`, `roadMarks`. Mudanças estruturais fora dos eventos acima: chamar `G.fov.invalidate()`.
**Clima/luz**: `state.weather` (rain, fog, wind, cloud, lightning, storm) e `state.time/day/power`. O render tem
sua própria curva de luz por hora (usa `state.light` só como referência); `weather.lightning` 1→0 gera o clarão
duplo + escurecimento breve.

### Desempenho (Chromium headless/SwiftShader, 1280×720, mediana do `draw()`)
Casa inicial ≈ 7,8 ms · rua residencial de dia ≈ 6,2 ms · centro ≈ 6,0 ms · noite + tempestade + lanterna ≈ 5,9 ms ·
floresta densa ≈ 10–11 ms (dominado pela GPU emulada). Em SwiftShader o FPS medido fica em ~14–16 porque as
composições de tela cheia (multiply/saturation) são rasterizadas na CPU; em GPU real são baratas.
Caches: blocos de chão (LRU 48/22), sprites de parede (LRU 380/900), sprites de objeto com orçamento por quadro,
sombras estáticas por posição do sol, luzes estáticas recalculadas só quando algo muda.

### Sugestões / pedidos
- **Jogador**: preencher `anim.state` + `anim.swing` (0..1) nos ataques/empurrões e `anim.t` em `shoot/hurt/climb`;
  emitir `player:attack {firearm:true, dir}` a cada tiro (o render cuida do clarão/fumaça/cápsula).
- **Zumbis**: usar os nomes de estado do contrato; `id` estável; `variant` opcional.
- **Itens**: `drawIcon(ctx, type, x, y, size)` deve desenhar dentro do quadrado (x, y, size×size) — o render chama
  com (0, 0, 32) num canvas 32×32 e guarda o resultado por tipo (chamado uma vez por tipo).
- Futuro: menos sobreposição de copas na floresta; textura animada para a névoa do "nunca visto"; reflexos nas poças.
