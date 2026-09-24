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
