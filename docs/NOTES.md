# Notas entre etapas

Cada subagente registra aqui: o que entregou, pendências e pedidos para outros módulos.

## Etapa 1 — Mundo (`js/world.js`, `tools/mapview.html`, `tools/validate-world.mjs`)

### O que foi feito
- **Geração procedural determinística** (mesma seed → mesmo mapa; ~70–100 ms) de Vale Quieto em 140×140.
  O plano é montado em coordenadas canônicas e depois espelhado/transposto pela seed (8 orientações).
  - Rodovia (asfalto 5 de largura, faixa amarela tracejada `ROAD_LINE`) cortando o mapa; no trecho urbano tem
    calçadas, fora dele acostamento de cascalho. Rua principal saindo da rodovia até a borda (vira estrada rural).
  - Grade de ruas com calçadas (quarteirões compridos), ruas sem saída com balão de retorno (bairro novo),
    às vezes um trecho da grade some; estradas de terra (fazenda, madeireiros) e trilhas pela mata.
  - **Casas** (12–19 por seed): lote com jardim, varanda de madeira, caminho até a calçada, caixa de correio,
    lixeira, entrada de carro/garagem com portão de enrolar, planta em L (ala lateral ou nos fundos),
    corredor quando cabe, quintal com cerca de madeira/tela/sebe e portão, árvores, horta, balanço, lenha...
    Cômodos: sala, cozinha, quartos, banheiro, corredor, garagem, escritório/lavanderia. Portas internas
    (algumas abertas) ou vãos sem porta; porta da frente sempre para a rua; porta dos fundos/lateral às vezes;
    ~25% das portas externas trancadas; janelas nas paredes externas (cortinas, algumas quebradas).
  - **Comércio/serviços** perto do cruzamento central: Mercado Bom Preço (gôndolas, 3 caixas, freezers, depósito,
    escritório, estacionamento), Posto Estrela (loja + pátio com bombas), Farmácia Vida (fundos trancados com
    remédios), Lanchonete da Rosa (balcão com banquetas, mesas na vitrine, cozinha), Delegacia de Vale Quieto
    (recepção, cela com grades `FENCE_METAL`, arsenal trancado com armários de armas, vestiário, viaturas),
    Ferragens Silva, Loja de Roupas Estilo, Agência dos Correios, Armazém Vale Quieto (paletes/caixotes, portão).
    Igreja Batista (bancos em duas colunas, altar, sacristia) com Cemitério ao lado; Fazenda (casa, Celeiro,
    plantações cercadas) na estrada de terra; lago com praia, juncos, píer, mesas de piquenique.
  - **Rua**: postes (com `light`), carros estacionados, carros abandonados/atravessados (sem nunca fechar a pista),
    batida num cruzamento (vidro + sangue), engavetamento com viatura e ambulância + barreira de barris na saída
    da cidade, pneus/barris à beira da estrada.
  - **Natureza**: floresta densa nas bordas (árvores e pinheiros por manchas, arbustos, pedras, grama escura,
    manchas de terra), clareiras, acampamento de caça no fim de uma trilha.
  - **Início**: casa afastada do centro; portas destrancadas/fechadas, janelas inteiras, `building.start = true`.
    Nenhum ponto de zumbi dentro dela nem a menos de 18 tiles.
  - **Zumbis**: `zombieSpawns` com peso ~2.2 nas ruas do centro, 1.1 no bairro, 2–3 dentro do comércio/igreja e
    no engavetamento, 0.6 em salas de casas, 0.12–0.45 na mata/estradas rurais.
  - Pós-processos: `cleanup` (tira cerca/objeto colado em porta/janela), `fixPockets` (remove objetos externos
    que isolem áreas). Toda a mobília é colocada com teste de circulação por cômodo (nada bloqueia portas,
    todo tile livre do cômodo continua conectado e todo contêiner tem um lado acessível); cada cômodo mantém
    uma janela com o lado de dentro livre (dá para pular por ela).
- **API** completa do contrato + extras (abaixo). Sem alocação em `isBlocked`, `blocksSight`, `lineOfSight`,
  `moveEntity`; A* com buffers tipados reaproveitados e heap binária.
- `tools/mapview.html?seed=N[&scale=6&roofs=1&rooms=1&labels=0&zs=0]`: vista de cima com cores por piso/parede/
  porta (vermelho = trancada, laranja = aberta)/janela (azul-escuro = cortina, vermelho = quebrada)/objeto
  (letras por tipo em escala ≥ 12), contêineres (contorno amarelo), luzes, início (ciano) e pontos de zumbi.
- `node tools/validate-world.mjs [--seeds a,b] [--n 20] [--verbose]`: valida dezenas de seeds em Node (sem
  navegador): tempo, início livre, objetos x paredes/água/objAt, lotes/prédios sem sobreposição, portas com os
  dois lados livres, janelas sem parede atrás, todos os cômodos alcançáveis (portas abertas; e de modo realista:
  porta externa trancada bloqueia, porta interna trancada se arromba, janelas e cercas se pulam), nenhum tile
  interno isolado, contêineres acessíveis, ruas conectadas, pontos de zumbi válidos, amostra de `findPath`;
  testes de API (porta/tranca/barricada/arrombar, janela/cortina/quebrar, colisão sem atravessar parede em dt
  grande e deslizando, simetria da linha de visão) e desempenho.

### Convenções e decisões (leia antes de usar o mapa)
- **`rot` de objeto** = direção para onde a frente aponta: `0:+x 1:+y 2:-x 3:-y` (ângulo = rot·π/2).
  Móveis encostados na parede olham para dentro do cômodo. **Carros**: rot = sentido do capô; pegada `2×1` se
  rot par, `1×2` se ímpar. `height` = altura visual relativa à parede (0..1; árvores 2.6–3.0; tapete 0).
  `variant` 0..7 (cor/modelo). Objetos também têm `building` e `room` (ids).
- **Colisão** (`isBlocked`, igual para player e zombie): paredes, portas fechadas ou barricadas, janelas/vidraças
  (sempre; pula-se com ação), cercas e sebes (se não quebradas), objetos `blocksMove`, água. Arbusto, tapete,
  portão de cerca (`fence_gate`, objeto aberto num vão da cerca), pneu e armário de remédios não bloqueiam.
- **Visão** (`blocksSight`): paredes, portas fechadas (ou barricada ≥ 3), janelas com cortina ou barricada ≥ 3,
  objetos `blocksSight` (prateleira de loja e máquina de venda). Cercas não bloqueiam. **Sebe é parcial**:
  `blocksSight` = false, mas `lineOfSight` bloqueia ao atravessar 2+ tiles de sebe; `WD.sightCost(tx,ty)` dá
  0..1 (sebe 0.5, cerca de madeira 0.15) para o render escurecer.
- `lineOfSight`: DDA; ignora o tile de origem, testa o destino; passando exatamente numa quina só bloqueia se os
  dois vizinhos bloqueiam (simétrico em > 99% dos casos).
- `moveEntity` subdivide em passos ≤ min(0.15, r/2) e empurra o círculo para fora dos tiles bloqueados
  (desliza em paredes e contorna quinas). **Retorna um objeto reutilizado** `{hitX, hitY, tx, ty}` (tx,ty = último
  tile que bloqueou, −1 se nenhum) — copie se precisar guardar.
- `findPath(x0,y0,x1,y1, who, maxNodes=4000)` → centros de tiles (sem o de origem) ou `null`. `who`:
  `'player'` porta fechada destrancada custa +2 (ele abre), trancada/barricada/janela bloqueia;
  `'zombie'` portas (+6), janelas (+10), cercas (+8), sebes (+30), +6 por nível de barricada — o módulo de zumbis
  deve bater (`damageStructure`) ou pular ao chegar num desses tiles; `'open'` todas as portas abertas
  (depuração); qualquer outro valor = só o que está passável agora. Diagonais só entre tiles livres, sem cortar
  quinas e nunca entrando/saindo de porta/janela. Se o destino é bloqueado, chega num vizinho ortogonal.
- **Estruturas**: `wallHp` guarda a vida da porta/janela/cerca (porta 100, portão de garagem 160, janela 12,
  vidraça 18, cerca madeira 70, tela 140, sebe 90; paredes são indestrutíveis). **Barricada** usa o campo extra
  `map.barricadeHp` (30 por tábua, nível = ⌈hp/30⌉, máx. 4) e absorve o dano primeiro. `damageStructure` retorna
  `'broken'` só quando a porta/janela/cerca em si quebra (barricada destruída → `'damaged'`). Porta arrombada
  fica passável; janela quebrada continua bloqueando andar (não a visão) e vira escalável.
  Ao quebrar emite eventos e também ruído via `G.noise.emit` (porta 16 `thump`, janela 18 `glass`, tábua 10
  `barricade`, cerca 10 `thump`), partículas (`wood`/`glass`/`dust`) e decals de vidro dos dois lados.
  `setOpen` não emite ruído (quem chama decide). Porta não fecha com alguém dentro do tile.
- Eventos novos (retrocompatíveis): `window:close`, `barricade:remove`, `fence:break` `{x,y}`.
- `containersNear(x,y,r=1.5)` só inclui o que está ao alcance físico (`WD.canReach`: paredes, portas e janelas
  fechadas bloqueiam; móveis não). O contêiner **"Chão"** é virtual: `items` é uma cópia; os registros reais de
  `state.groundItems` estão em `container.ground` — para tirar um item do chão use `WD.removeGroundItem(item)`;
  para largar, `WD.dropItem(x,y,item)`.
- `generate` também copia decals iniciais (sangue/vidro das batidas) para `G.state.decals` quando chamado em
  `newGame` (e deixa em `map.initialDecals`).
- Campos extras no mapa: `barricadeHp`, `seed`, `genTime`, `roads` (`{h, c, a0, a1, kind:'street'|'rural'|'dirt'}`),
  `lots` (`{x,y,w,h,face,kind,name,buildings}`), `lake`, `initialDecals`. Prédio: `doors`, `lot`, `start`.
  Cômodo: `loot` (etiqueta de loot). Paredes do prédio têm `building` (telhado cobre tudo) e `room = 0`.
- Extras da API: `WD.current()`, `setMap(m)`, `buildingAt`, `sightCost`, `canReach`, `isDoor`, `isWindow`,
  `setLocked`, `canClimb(tx,ty)` (janela aberta/quebrada sem barricada, cercas), `climbTarget(tx,ty,fromX,fromY)`
  (tile do outro lado), `pickZombieSpawn(rng)` (sorteio por peso), `nearestFree(x,y,r)`, `dropItem`,
  `removeGroundItem`, `OBJECT_DEFS`, `isDoorType`, `isWindowType`, `wallBlocksMove`, `wallBlocksSight`.

### Tipos usados
- **Pisos**: todos (`GRAVEL` em acostamentos/estradas de terra/entradas; `SAND` na praia; `LINOLEUM` em
  cozinhas/lojas; `DARK_GRASS` na mata, cemitério e entre fileiras de plantação).
- **Paredes**: `WOOD`, `BRICK`, `PLASTER`, `CONCRETE` (armazém), `GLASS` (vitrines), `WINDOW`, `DOOR`,
  `GARAGE_DOOR` (garagem 3 tiles, armazém, celeiro), `FENCE_WOOD`, `FENCE_METAL` (tela, cemitério, grades da
  cela), `HEDGE`.
- **Objetos**: todos os da lista do contrato aparecem (verificado em 40 seeds).
- **Cômodos**: `kitchen, bedroom, bathroom, living, garage, hall, store, storage, office, pharmacy, police,
  gas_station, diner, church, warehouse`.
- **lootKey** = `"<etiqueta>:<tipo do objeto>"`. Etiquetas: tipos de cômodo de casa (`kitchen`, `bedroom`,
  `bathroom`, `living`, `garage`, `office`, `storage`) e específicas: `grocery`, `grocery_storage`, `pharmacy`,
  `pharmacy_back`, `hardware`, `hardware_storage`, `clothing`, `clothing_storage`, `post_office`, `post_storage`,
  `gas_station`, `gas_storage`, `diner`, `diner_kitchen`, `police_lobby`, `police_office`, `police_lockers`,
  `police_armory`, `warehouse`, `warehouse_tools`, `warehouse_office`, `church_office`,
  `church_storage`, `farm`, `camp`, `outdoor` (carros, lixeiras, caçambas, caixas de correio, máquina de venda).
  Ex.: `kitchen:fridge`, `grocery:freezer`, `police_armory:gun_locker`, `pharmacy_back:medicine_cabinet`,
  `garage:workbench`, `outdoor:car`. `fillContainer(container, roomType, objType, rng)` recebe o tipo de cômodo
  do contrato (ou `'outdoor'`); a etiqueta fina está em `container.lootKey`. O mundo usa um RNG de loot separado
  (mudar o loot não muda o mapa).

### Pedidos / sugestões para as próximas etapas
- **Render**: telhado por `building` (inclui as paredes); porta/janela: o eixo sai dos vizinhos (parede dos dois
  lados = orientação); `GARAGE_DOOR` vem em trios; usar `rot`, `variant`, `height` dos objetos; carros com a cor
  por `variant` e capô em `rot`; `light.needsPower` + `state.power`; escurecer atrás de sebes com `sightCost`;
  plantações = faixas alternadas `DIRT`/`DARK_GRASS` com `bush` nas fileiras; `fence_gate` é objeto num vão.
  Grades da cela são `FENCE_METAL` dentro da delegacia.
- **Itens**: implementar o loot por `lootKey` (lista acima); capacidades em kg já vêm no contêiner.
- **Zumbis**: sortear posições com `WD.pickZombieSpawn(rng)` (+ jitter / `nearestFree`); pathing com
  `findPath(...,'zombie')` e, ao encostar em porta/janela/barricada (use `moveEntity(...).tx/ty` ou o próximo nó
  do caminho), chamar `damageStructure` periodicamente e emitir `zombie:thump`; janela quebrada → pular
  (`canClimb`/`climbTarget`).
- **Jogador**: "pular janela/cerca" com `canClimb` + `climbTarget`; abrir/fechar/trancar com `setOpen`/`setLocked`;
  barricar com `addBarricade`; cortina com `toggleCurtain`; quebrar vidro com `breakWindow`.
