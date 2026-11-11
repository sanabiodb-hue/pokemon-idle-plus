# F12 · Mundo de Ação 3D — contrato técnico

Documento do Diretor. Define os módulos novos, o dono de cada arquivo e as interfaces entre eles. Quem implementa segue este contrato; se precisar mudar uma interface, avisa no relatório em vez de mudar por conta própria.

## O que é
Um modo de tela cheia em que o jogador controla o Pokémon ativo num mapa 3D, em tempo real, contra hordas de selvagens. Os golpes causam dano em todos os inimigos dentro da área real do golpe. Pode ser jogado na mão ou no automático. O `GameCore` continua sendo a autoridade de dano, EXP, ouro, captura e evolução.

## Princípios
1. **Simulação separada do desenho.** `action-core.js` e `action-horde.js` não tocam em DOM nem em Three.js e rodam no Node. `action-3d.js` só desenha o que a simulação diz.
2. **Uma regra de dano, uma de recompensa, uma de captura:** as do `GameCore` (`_computeDamage`, `_processVictoryRewards`, `exploreCapture`). Nada de fórmula paralela.
3. **Área desenhada = área que acerta.** A mesma `moveFxProfile(nome, tipo, poder)` de `js/fx/move-fx.js` serve para desenhar e para decidir quem leva dano, com `moveFxCovers(perfil, de, para, ponto)`.
4. **Sem alocação por quadro** nos caminhos quentes (laço de inimigos, colisão, IA): objetos reaproveitados, vetores reutilizados, pools.
5. JavaScript puro em scripts clássicos (globais com prefixo `ACTION_` / `action` / `Action`). Sem dependência nova.

## Unidades e eixos
- 1 unidade = 1 quadrado do mapa. `x` cresce para leste, `z` cresce para o sul (linha do mapa). Altura é `y` (só no desenho).
- Posição de entidade é contínua: `e.x`, `e.z`. Célula = `Math.floor`. Parede: `worldCellBlocked(map, cx, cz)` (de `js/world/world-engine.js`).
- Direção: `e.face` em radianos, `face = Math.atan2(dx, dz)` (0 = olhando para +z). Os modelos olham para +Z local; o desenho usa `rotation.y = face`.
- Tempo em segundos. A simulação anda em passo fixo `ACTION_STEP = 1/30`.

## Arquivos e donos (rodada 1 — ninguém edita arquivo de outro dono nem arquivos já existentes)
| Arquivo | Dono | Conteúdo |
|---|---|---|
| `js/action/action-balance.js` | economy-balancing | `ACTION_BALANCE` (números) e funções puras de escala |
| `js/action/action-core.js` | gameplay-developer (A) | `ActionWorld`: entidades, movimento, colisão, golpes em área, dano, recompensa, captura, troca, poção; `installAction(GameCore)` |
| `js/action/action-horde.js` | gameplay-developer (B) | arquétipos de IA, decisão dos inimigos, diretor de hordas (ondas, elites, chefe), piloto automático do jogador |
| `js/models/pokemon-models.js` | art-animation-3d | receitas de modelos 3D procedurais, construtor articulado, geometria fundida para instâncias, animação |
| `js/action/action-maps.js` | game-3d-engineer | `ACTION_MAPS` (Floresta de Viridian jogável: mapa ASCII, zonas de horda) |
| `js/action/action-3d.js` | game-3d-engineer | `Action3D`: camada de entidades sobre o mundo do `Explore3D`, pools por espécie, câmera, efeitos, bola |
| `js/action/action-hud.js`, `css/action.css` | ui-ux-specialist | `ActionHud`: HUD, joystick, botões de golpe com recarga, barra de chefe, números de dano |
| `tests/action-*.test.js` | cada dono testa a sua parte pura | um arquivo por dono: `action-core`, `action-horde`, `action-balance`, `pokemon-models`, `action-maps` |
| `js/action/action-view.js`, `index.html`, `js/main.js`, `tools/load-context.js`, `css/style.css`, `js/game-core.js`, `js/explore/*` | Diretor (rodada 2) | integração |

Testes: `tools/load-context.js` já carrega, se existirem, `js/action/action-balance.js`, `js/models/pokemon-models.js`, `js/action/action-maps.js`, `js/action/action-core.js`, `js/action/action-horde.js` (nesta ordem, depois de todo o resto). Para pegar um símbolo que não está na lista de exportação use `ctx.get('NomeDoSimbolo')`. Use `newGame({ seed })` de `tests/helpers/game.js`.

## Entidade (objeto simples, reaproveitado em pool)
```js
{ id, kind: 'player' | 'enemy', alive,
  speciesId, shiny, level, types: [..], stats: { hp, attack, defense, speed }, maxHp, hp,
  x, z, vx, vz, face, radius,            // radius em unidades (0.35 pequeno … 0.9 chefe)
  state: 'idle' | 'move' | 'windup' | 'attack' | 'hurt' | 'dying' | 'dead' | 'balled', stateT,
  tier: 'minion' | 'elite' | 'boss', arch,   // arch = id do arquétipo (inimigos)
  wild,                                      // objeto do GameCore (generateWildPokemon / createWildPokemon); inimigos
  partyIndex, inst,                          // jogador
  moves: [{ name, type, power, cd, cdMax, profile }],   // profile = moveFxProfile(...)
  want: { mx, mz, cast, aimX, aimZ },        // intenção (IA ou entrada): mx/mz em -1..1; cast = índice do golpe ou -1
  knockX, knockZ, stun, iframes, status, seed }
```

## `ActionWorld` (`js/action/action-core.js`)
```js
const world = new ActionWorld(game, mapDef, { rng, think, director });
world.setInput({ mx, mz, dash, skill, capture, potion });   // dash/capture/potion: pulso; skill: índice ou -1
world.auto = true | false;            // automático: a intenção do jogador vem de world.pilot(world, dt) se existir
world.step(dt);                       // um passo fixo
world.drainEvents();                  // devolve e esvazia a fila de eventos (vetor reaproveitado: não guarde a referência)
world.spawnEnemy({ wild, tier, arch }, x, z);   // usado pelo diretor de hordas; devolve a entidade ou null (limite)
world.despawn(e);
world.swapPlayer(partyIndex);         // troca o Pokémon ativo (com recarga)
world.snapshot();                     // dados do HUD (objeto reaproveitado)
world.player; world.enemies;          // vetor denso de inimigos vivos (ordem pode mudar)
world.near(x, z, r, out);             // inimigos vivos num raio (grade espacial); preenche e devolve `out`
world.t; world.map; world.game; world.rng; world.limit;      // limit = máximo de inimigos vivos
```
Passo: entrada/IA → intenção → movimento com aceleração, colisão com o mapa (desliza na parede) e separação entre corpos → golpes (preparo `windup`, impacto em `hitAt`, recarga) → mortes → recompensas → eventos.

- **Golpe básico automático:** o jogador ataca sozinho o inimigo mais próximo dentro do alcance do golpe 0 a cada `ACTION_BALANCE.basicInterval`.
- **Golpes especiais (índices 1..3):** saem de `exploreMoveset(speciesId, nívelDaTécnica)`; recarga `actionSkillCooldown(power)`. Mira: inimigo mais próximo na direção do movimento (ou o mais próximo).
- **Impacto:** em `hitAt`, todo alvo vivo com `moveFxCovers(profile, de, para, { x, z })` leva `game._computeDamage(nível, ataque, defesa, [tipo do golpe], tipos do alvo, poder, crítico…)` × multiplicador do balanceamento. Empurrão e atordoamento curtos conforme o formato.
- **Recompensa:** cada inimigo morto soma `ACTION_BALANCE.rewardCredit[tier]` num banco de crédito. A cada 1,0 de crédito o mundo chama a vitória oficial uma vez (`game.actionVictory(wild, partyIndex)`, que usa `_processVictoryRewards` com `wild._captureResolved = true`). Assim uma horda de fracos vale o mesmo que as vitórias equivalentes do idle, sem fórmula nova. Depois de cada vitória oficial compare `game.exploreSnapshot(i)` antes/depois para emitir `level` e `evolve` e recalcule os atributos do jogador (`calculateBattleStats`).
- **Captura:** `capture` mira o inimigo mais próximo com vida ≤ `ACTION_BALANCE.captureHpFrac` dentro de `captureRange`; usa `game.exploreCapture(wild, bola, hpFrac, temStatus)` (gasta a bola e aplica as regras oficiais). O alvo fica `balled` durante o voo e as balançadas; o resto do combate não para.
- **Derrota:** vida 0 → troca automática para o próximo da equipe com vida; sem ninguém, evento `wipe` e o mundo para (`world.over = true`).
- **Estado entre Pokémon:** vida por indivíduo no formato do Explorar (`keep`: fração de vida por `uid`), para o Centro Pokémon e as poções continuarem valendo.

### Eventos (fila; a tela consome a cada quadro)
`{ t: 'spawn', id }` · `{ t: 'cast', id, move, x, z, tx, tz }` (move = índice; origem e alvo no chão) · `{ t: 'hit', id, by, dmg, crit, eff, kx, kz }` · `{ t: 'die', id, x, z, tier }` · `{ t: 'reward', exp, gold }` · `{ t: 'level', growth }` · `{ t: 'evolve', from, to }` · `{ t: 'capture', id, stage: 'throw' | 'shake' | 'caught' | 'free', ball }` · `{ t: 'wave', n, kind, count }` · `{ t: 'swap', partyIndex }` · `{ t: 'heal', amount }` · `{ t: 'down' }` · `{ t: 'wipe' }` · `{ t: 'dash' }`.

### `snapshot()`
```js
{ player: { name, speciesId, shiny, level, hp, maxHp, expFrac, types },
  skills: [{ name, type, cd, cdMax, shape, label }],      // 0 = básico
  dash: { cd, cdMax }, wave: { n, kind, left, total, nextIn },
  boss: null | { name, speciesId, hp, maxHp },
  auto, kills, combo, potions, ball: { id, count }, captureReady,
  party: [{ partyIndex, speciesId, shiny, hp01, alive, active }], over }
```

## Hordas e IA (`js/action/action-horde.js`)
```js
ACTION_ARCHETYPES = { swarm, bruiser, tank, ranged, cocoon, support, flyer, boss };   // números de cada arquétipo
actionArchetypeFor(speciesId);                 // tabela por espécie + regra geral por tipo e atributos base
actionEnemyThink(world, e, dt);                // escreve e.want (mx, mz, cast, aimX, aimZ); barata: sem alocar
new ActionDirector(world, mapDef, route);      // .update(dt): ondas, grupos, elites, chefe; .state para o HUD
actionAutoPilot(world, dt);                    // escreve world.player.want quando world.auto
```
- Os inimigos nascem em grupos, em zonas do mapa (`mapDef.zones`), fora da visão do jogador (distância mínima `ACTION_BALANCE.spawnMinDist`) e em célula livre.
- Composição pela rota oficial: `game.generateWildPokemon(route)`; elite e chefe por `mapDef.elites` / `mapDef.boss` com `game.createWildPokemon(id, nível, 0)`.
- IA com orçamento: no máximo `ACTION_BALANCE.thinkPerStep` decisões completas por passo, em rodízio; os demais mantêm a última intenção.
- O piloto automático respeita a política de automação existente (`js/automation/policy.js`) para poção e captura.

## Balanceamento (`js/action/action-balance.js`) — chaves fixas, valores do economista
```js
const ACTION_STEP = 1 / 30;
const ACTION_BALANCE = {
  hpMul: { minion: 0.35, elite: 2.5, boss: 12 },      // vida do inimigo sobre a vida oficial do selvagem
  enemyDamageMul: 0.5, playerDamageMul: 1,
  rewardCredit: { minion: 0.2, elite: 1.5, boss: 6 },  // vitórias oficiais por abate
  limit: { low: 28, medium: 40, high: 60 },            // inimigos vivos por preset de qualidade
  wave: { base: 8, growth: 3, max: 44, eliteEvery: 3, bossAt: 10, rest: 3.5 },
  spawnMinDist: 9, thinkPerStep: 16,
  basicInterval: 0.6, dash: { dist: 3.2, time: 0.18, cd: 2.2, iframes: 0.3 },
  captureHpFrac: 0.35, captureRange: 6, pickupRadius: 2.5, potionCd: 4,
  playerSpeed: 5.2, enemySpeed: 3.0, accel: 28,
};
function actionSkillCooldown(power) { … }             // segundos
function actionEnemyHp(officialHp, tier) { … }
```
Os números acima são o ponto de partida para todos programarem; o economista ajusta os valores (não as chaves) com medição.

## Modelos (`js/models/pokemon-models.js`)
```js
POKEMON_MODEL_RECIPES[speciesId] = { rig, height, radius, parts: [{ id, group, shape, size, pos, rot, color }] };
pokemonModelHas(speciesId);                            // puro
pokemonModelInfo(speciesId);                           // puro: { rig, height, radius, parts, triangles }
buildPokemonModel(T, speciesId, { shiny });            // Group articulado (herói, elite, chefe); userData = { rig, height, radius, groups }
buildPokemonGeometry(T, speciesId, { shiny });         // BufferGeometry única com cor por vértice, pés na origem, olhando +Z (hordas em InstancedMesh)
animatePokemonModel(model, state, t, dt, speed01);     // articulado: idle | move | windup | attack | hurt | dying
pokemonInstancePose(rig, state, t, phase, out);        // puro: { y, sx, sy, sz, tilt, roll } para animar a instância inteira
```
Material único compatível: `MeshLambertMaterial({ vertexColors: true })`. Espécie sem receita: `pokemonModelHas` devolve falso e o desenho usa o sprite como reserva.

## Mapa (`js/action/action-maps.js`)
```js
ACTION_MAPS.viridian_forest = { id: 'action_viridian_forest', name: 'Floresta de Viridian', type: 'route', route: 'kanto_viridian_forest',
  biome: 'forest', canopy: 0.7, music: 'forest', width, height, rows: [...],     // letras de WORLD_LEGEND (o Explore3D desenha)
  spawn: { x, y, dir }, zones: [{ id, x0, y0, x1, y1 }],                          // áreas abertas onde grupos nascem
  elites: [{ id, level }], boss: { id, level, zone } };
```
Clareiras largas ligadas por passagens de pelo menos 5 quadrados; todo ponto de zona alcançável a partir do início.

## Desenho (`js/action/action-3d.js`)
```js
const a3d = new Action3D(e3d);      // e3d = Explore3D já com o mapa (setMap); usa e3d.T, e3d.world, e3d.camera, e3d.renderer, e3d.q
a3d.attach(world);                  // cria a camada de entidades
a3d.frame(world, events, dt);       // posiciona tudo, consome eventos (golpes com MoveFxRenderer, dano, mortes, bola, EXP), move a câmera e desenha
a3d.screenOf(e, out);               // posição na tela (para números de dano e marcadores)
a3d.isAnimating(); a3d.dispose();
```
Hordas: um `InstancedMesh` por espécie com `buildPokemonGeometry`; herói, elites e chefe com `buildPokemonModel`. Câmera em três quartos seguindo o jogador, com recuo conforme a quantidade de inimigos por perto.

## HUD (`js/action/action-hud.js` + `css/action.css`)
```js
const hud = new ActionHud(rootEl, { onSkill(i), onDash(), onCapture(), onPotion(), onAuto(on), onSwap(partyIndex), onExit() });
hud.update(snapshot);               // barato: só mexe no DOM quando o valor muda
hud.readMove(out);                  // { mx, mz } do teclado (WASD/setas) e do analógico virtual
hud.damage(xPx, yPx, { text, cls }); hud.banner(texto, tipo); hud.dispose();
```
Mundo ocupando a tela; HUD mínimo. Celular em pé: analógico à esquerda, golpes à direita com recarga visível. Teclado: WASD, `J`/`1`–`3` golpes, espaço para esquiva, `C` captura, `Q` poção, `T` automático, `Tab` troca.
