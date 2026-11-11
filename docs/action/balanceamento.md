# F12 · Mundo de Ação 3D — balanceamento

Dono: economia e balanceamento. Valores em `js/action/action-balance.js`, travados por `tests/action-balance.test.js`.

**Leia primeiro o que é medida e o que é estimativa.** O idle foi medido com o simulador oficial. O núcleo de ação (`action-core.js`, `action-horde.js`, `action-maps.js`) ainda estava sendo escrito durante esta rodada. Usei a versão em disco para os testes de sobrevivência e para o automático, mas o piloto dela ainda trava e morre muito. Por isso o número de abates por minuto do jogador "bom" vem de um **modelo**, não de uma partida real. A renda não depende desse número: ela é limitada por um teto atrelado ao idle (`rewardCap`, explicado abaixo).

## Como reproduzir

Os scripts ficaram fora do repositório, na pasta de rascunho da sessão (`.../scratchpad/economia/`). Para refazer a medição, copie-os de volta.

| Script | O que faz |
|---|---|
| `idle.js` | Roda `simulateHunt` por 1 h, com semente 4242, para cada rota e nível, com o nível congelado (`addExpToInstance` desligado: mede a taxa naquele nível). Também faz um duelo isolado (3.000 selvagens, semente 4243) com `calculateBattleStats`, `calculateStats`, `_computeDamage`, `getAttackInterval` e `battleTicksPerAttack`, o mesmo laço do Fast Driver. Equipe: só o Pikachu inicial, com técnica `exploreSkillLevelFor(nível)`. |
| `action-model.js` | Modelo do modo de ação, descrito abaixo. |
| `surround.js` | Núcleo real: jogador parado (ou esquivando) cercado por 6 minions da rota, com reposição imediata. 10 sementes. |
| `real-core.js` | Núcleo real: `ActionWorld` + `ActionDirector` + `actionAutoPilot` no mapa `viridian_forest`, 3 sementes × 30 min. |
| `final.js` | Junta tudo com os valores gravados no arquivo. |

## 1. Idle medido (semente 4242, 1 h simulada, nível congelado)

| Rota | Nv | Vitórias/h | EXP/h | Ouro/h | s para derrotar | golpes | dano recebido/duelo | s por ciclo | derrotas/h |
|---|---|---|---|---|---|---|---|---|---|
| Rota 1 (1–5) | 3 | 607 | 19.241 | 1.726 | 5,07 | 2,54 | 6 (42% da vida) | 5,82 | 12 |
| Rota 1 | 5 | 753 | 23.993 | 2.140 | 3,62 | 1,81 | 3 (16%) | 4,78 | 0 |
| Rota 1 | 7 | 985 | 31.813 | 2.824 | 2,83 | 1,41 | 1 (6%) | 3,65 | 0 |
| Floresta de Viridian (11–15) | 12 | 314 | 45.240 | 2.049 | 11,03 | 5,51 | 39 (129%) | 10,75 | 21 |
| Floresta | 16 | 405 | 62.185 | 2.667 | 7,38 | 3,69 | 18 (49%) | 8,89 | 0 |
| Floresta | 20 | 552 | 83.907 | 3.665 | 5,71 | 2,86 | 11 (25%) | 6,52 | 0 |
| Rota 10 (71–75) | 72 | 292 | 540.379 | 4.842 | 11,14 | 5,57 | 102 (77%) | 12,33 | 0 |
| Rota 10 | 76 | 339 | 638.175 | 5.626 | 9,06 | 4,53 | 73 (52%) | 10,62 | 0 |
| Rota 10 | 80 | 379 | 706.267 | 6.293 | 8,36 | 4,18 | 63 (43%) | 9,50 | 0 |

- No idle, o jogador ataca a cada ~2 s (velocidade baixa). Uma vitória custa de 4 a 12 s, e o idle entrega de 5 a 16 vitórias por minuto.
- Ouro por vitória: 2,8 (Rota 1), 6,6 (Floresta), 16,6 (Rota 10). EXP por vitória: 32, ~152 e ~1.870.
- No idle, o Pikachu evolui para Raichu **no nível 1** ao passar do nível 22 (regra atual: cada forma tem o próprio nível). Numa simulação sem o nível congelado, o Pikachu Nv20 vira Raichu Nv1 e perde 238 de 261 batalhas em 10 min. O mesmo vale para o modo de ação, que usa a vitória oficial. Por isso a referência do teto é recalculada a cada evolução (ver seção 4).

## 2. Modelo do modo de ação (`action-model.js`)

O dano, os atributos, os golpes e as áreas são os oficiais: `calculateBattleStats`, `_computeDamage` com `[tipo do golpe]`, `exploreMoveset`, `moveFxProfile` e as recargas de `actionSkillCooldown`. A vida extra por arquétipo vem de `action-horde.js` (enxame 0,7, tanque 2,2, casulo 1,6...). Elite e chefe da floresta são os de `action-maps.js`: Butterfree Nv16, Pidgeotto Nv17 e Beedrill Nv20.

O espaço é abstrato:
- Os inimigos nascem a 9–15 quadrados e chegam depois de andar.
- Um golpe em área acerta k ~ Poisson(densidade × área) alvos entre os que já chegaram, com pelo menos 1.
- As ondas e o descanso seguem `wave`, e o limite de inimigos vivos segue `limit.medium`.
- O jogador não morre: é o limite superior.

| Perfil | Densidade | Tempo atacando | Golpe em área | Aproximação |
|---|---|---|---|---|
| Manual atento | 1,2/u² (agrupa) | 85% (esquiva) | guarda até ter ≥3 juntos | vai ao encontro |
| Automático | 0,7/u² | 92% | solta assim que carrega | meia iniciativa |

## 3. Valores escolhidos

| Chave | Antes | Agora | Por quê (medido) |
|---|---|---|---|
| `hpMul.minion` | 0,35 | **0,25** | Com 0,35, na floresta Nv15 só 62% dos minions caíam em 1–2 básicos (média de 2,08). Com 0,25: média de 1,65 básicos e 80% em 1–2. Rota 1: 1,0. Rota 10: 1,72. O golpe em área termina 78–100% dos minions já feridos. |
| `hpMul.elite` | 2,5 | **4** | Com 2,5, o foco único levava 4,4–9 s. Com 4: 8,0/8,6 s na floresta, 6,5/6,7 s na Rota 1 e 7,5/15,5 s na Rota 10. No núcleo real, cercado de minions, o elite vive ~30 s desde o nascimento. |
| `hpMul.boss` | 12 | **11** | Foco único de 43 s (Rota 1), 56 s (floresta) e 52 s (Rota 10). As invocações do chefe alongam a luta para dentro de 45–90 s. |
| `enemyDamageMul` | 0,5 | **0,15** | Núcleo real, 6 minions colados e repostos, floresta. Com 0,5, o jogador parado caía em 6,8 s (mediana). Com 0,15, no Nv15: parado 22,8 s, esquivando (círculo + esquiva) 34,6 s. No Nv20: 27,4 s e 47,8 s. Um golpe de minion tira ~2,5% da vida. Os atiradores (Swift a 6 quadrados) punem quem fica parado. |
| `playerDamageMul` | 1 | 1 | Dano oficial. |
| `rewardCredit` | 0,2 / 1,5 / 6 | **0,4 / 6 / 20** | Generoso de propósito: quem limita a renda é o teto. Crédito sobre a vida oficial derrubada ≤ 2 (0,4/0,25 = 1,6; 6/4 = 1,5; 20/11 = 1,8). Assim, se o teto falhar, o estrago fica limitado. Elite = 15× um minion, chefe = 50×: prêmio visível. |
| **`rewardCap`** (chave nova) | — | **manual 1,5 · auto 1,05 · janela 300 s · banco 30 · reserva 6/min** | Teto em fichas, explicado na seção 4. |
| `wave.bossAt` | 10 | **8** | No núcleo real, o automático não chegou à onda 10 em 30 min. Com 8 ondas o ciclo cabe numa sessão de 10–15 min. Os outros números de onda continuam. |
| `actionSkillCooldown` | `1,5 + p/30` | igual, **limitado a 1–12 s** | 60 → 3,5 s, 90 → 4,5 s, 120 → 5,5 s. Golpes de poder 250 ou mais não passam de 12 s. |
| `captureHpFrac` | 0,35 | 0,35 | Um minion com um básico já fica abaixo de 35%. Jogar bola custa uma bola (ouro oficial) e ~2,6 s de voo e balançadas. |
| `limit`, `dash`, `basicInterval`, velocidades, `spawnMinDist` | — | sem mudança | Nada na medição pediu mudança. |

## 4. Renda: crédito + teto

**Regra para o núcleo (`action-core.js`, `_settleCredit`).**

1. Ao entrar no modo, calcular `idleVph = actionIdleVictoriesPerHour(game, rota)`. Ele roda `createSimulationClone` + `simulateHunt` por 5 min numa cópia, custa ~20 ms e não toca no jogo. Recalcular a cada evento `level` ou `evolve`.
2. A cada passo: `actionRewardBucket(bucket, dt, actionRewardCapPerMin(idleVph, world.auto))`. O balde **começa vazio**: sair e entrar não o recarrega. O balde deve viver no `ActionWorld` (ou na view) durante a sessão.
3. Ao acertar o crédito, calcular `custo = actionVictoryTokenCost(game.getBaseExpYield(wild.id, wild.level) * wild.level, actionRouteExpUnits(game, rota))`. Depois: `while (credit >= 1 && bucket.tokens >= custo) { credit--; bucket.tokens -= custo; vitória oficial }` e, por fim, `credit = min(credit, rewardCap.bankMax)`.

O custo em fichas existe porque elite e chefe pagam mais EXP por vitória. Na floresta, o Butterfree custa 2,16 fichas, o Pidgeotto 2,02 e o Beedrill 2,94. Sem esse custo, o teto contado em vitórias deixava a EXP chegar a ~2,1× a do idle.

**Resultado com os valores gravados (`final.js`).** Os valores são razões contra o idle no mesmo nível, em 1 h com o balde começando vazio.

| Rota (Nv) | Perfil | Abates/min (modelo) | Sem teto: vitórias / EXP / ouro | **Com teto: vitórias / EXP / ouro** |
|---|---|---|---|---|
| Rota 1 (5) | manual | 66,5 | 3,18× / 7,20× / 4,33× | 1,15× / **1,51×** / **1,33×** |
| Rota 1 (5) | auto | 61,0 | 2,93× / 6,52× / 3,91× | 0,97× / **0,87×** / **0,91×** |
| Floresta (16) | manual | 60,4 | 5,30× / 8,15× / 5,68× | 1,23× / **1,43×** / **1,26×** |
| Floresta (16) | auto | 55,7 | 4,97× / 7,77× / 5,37× | 0,91× / **0,98×** / **0,93×** |
| Rota 10 (76) | manual | 60,4 | 6,34× / 7,41× / 6,39× | 1,32× / **1,49×** / **1,33×** |
| Rota 10 (76) | auto | 55,3 | 5,80× / 6,79× / 5,84× | 1,03× / **1,04×** / **1,03×** |

Núcleo real de hoje (automático, floresta, sem teto, 3 sementes × 30 min):

| Nível | Abates/min | Vitórias/h contra o idle | EXP | Quedas |
|---|---|---|---|---|
| Nv15 | 10,2 | 0,65× (idle Nv16) | 0,70× | 9,3 a cada 30 min |
| Nv16 | 14,9 | 0,97× | 1,08× | 13 a cada 30 min |
| Nv20 | 13,4 | 0,65× | 0,73× | 7 a cada 30 min |

O núcleo real nunca chegou ao chefe. O piloto travou diante de um casulo isolado a 13,7 quadrados: o script some com esse inimigo depois de 25 s sem abate, contados na coluna "destravados".

- **Leitura.** Sem teto, o modelo dá de 3× a 6× o idle. O núcleo real, imaturo, dá de 0,65× a 1×. A diferença entre os dois é grande demais para o crédito sozinho segurar a faixa. Com o teto, a renda fica entre 1,26× e 1,51× (EXP e ouro) para quem joga bem no manual e entre 0,87× e 1,04× no automático, qualquer que seja o ritmo real de abates. A Rota 1 no automático fica um pouco abaixo de 0,9× na EXP porque a primeira hora começa com o balde vazio.
- **O que o teste trava** (`tests/action-balance.test.js`):
  - as faixas de `rewardCap` (manual 1,2–1,6, auto 0,9–1,1);
  - a estimativa `actionEstimateVictoriesPerHour` com os ritmos do modelo (floresta Nv16, idle 405/h);
  - 1 h do balde de verdade;
  - um ritmo absurdo (10× o modelo) que continua preso ao teto;
  - um manual fraco que não ganha o prêmio;
  - o crédito sobre a vida ≤ 2.

## 5. Riscos de abuso e contramedidas

1. **Automático parado num canto, soltando golpe em área.**
   - Contramedida: o teto do automático é 1,05× o idle, então não compensa mais que deixar o idle rodar.
   - Além disso, com `enemyDamageMul` 0,15, ficar parado cercado derruba o jogador em ~23 s (medido) e os atiradores acertam de longe.
   - Sem fichas, o crédito fica no banco (máx. 30) e o excesso se perde.
2. **Pokémon forte farmando minions de rota fraca.**
   - Contramedida: o teto é relativo ao idle **desta equipe nesta rota**. O Pokémon forte também mata rápido no idle, e cada vitória continua sendo de selvagem fraco (pouca EXP).
   - Por isso **não** propus `actionRewardFactor(nível do jogador, nível da rota)`: o teto já cobre o caso, sem uma segunda regra.
   - O balde guarda no máximo 5 min de fichas, então uma explosão de abates não vira uma hora de renda.
3. **Captura em massa** (minions ficam abaixo de 35% com um básico).
   - Cada arremesso gasta uma bola comprada com ouro oficial e ~2,6 s (voo + 3 balançadas + pausa, `ACTION_CORE.capture`). A recarga é de 0,6 s.
   - Quem captura não abate, então não ganha crédito.
   - **Recomendo ao núcleo:** chefe não capturável. O Beedrill Nv20 não existe na tabela da rota, e capturá-lo seria um atalho de espécie e nível.
4. **Entrar e sair para recarregar.** O balde começa vazio e o crédito do banco não vale fora do modo.
5. **Aba escondida no automático.** O idle fica pausado durante o modo (`exploreEnter`), então a renda do modo substitui a do idle, não se soma a ela. Em segundo plano, a view avança no máximo 1 s por tique, e o navegador ainda espaça os tiques. A renda fica abaixo da normal.

## 6. O que o núcleo precisa aplicar (para o Diretor)

- Em `ActionWorld._settleCredit`: o teto em fichas (seção 4). Hoje o núcleo paga todo crédito ≥ 1 sem teto. **Sem essa mudança, o modelo indica até 5–6× o idle para quem joga bem.**
- Calcular `actionIdleVictoriesPerHour` ao entrar e em `level`/`evolve`. Guardar o balde durante a sessão.
- Opcional, para o HUD: mostrar quando o crédito está esperando fichas ("recompensa no limite").
- Captura: bloquear o chefe.

## 7. Bugs do trabalho em andamento encontrados na medição (de outros donos)

- **`actionAutoPilot`** (`action-horde.js`) **trava** quando sobra um inimigo isolado longe (exemplo: casulo a 13,7 quadrados). A onda não termina e não há mais abates.
- O automático **cai muito**: 7 a 13 vezes em 30 min, mesmo com dano 0,15. O piloto não se esquiva nem usa poção (os testes rodaram sem poções).
- Golpe básico = Investida (Normal). Contra o tipo Fantasma, o multiplicador é 0 e o dano mínimo é 1. Numa rota de fantasmas (Torre Pokémon), o básico fica inútil. Vale o núcleo usar o melhor golpe do tipo como básico, ou o Diretor decidir.

## 8. O que não foi medido

- **Abates por minuto de um jogador humano.** Os perfis manual e automático são modelos com hipóteses declaradas (densidade, tempo atacando). O núcleo real só foi medido no automático, ainda imaturo. Não há piloto "manual atento" no núcleo real.
- A esquiva medida é um roteiro simples (andar em círculo + esquiva quando ferido). Um jogador de verdade deve durar mais.
- Equipes de mais de um Pokémon, troca, poções e cura de vitória: o núcleo ignora `newPlayerHp` da vitória oficial, e a sobrevivência foi medida sem cura.
- Rotas fora da floresta no núcleo real: só existe o mapa `viridian_forest`. Os números da Rota 1 e da Rota 10 são do modelo.
- Elite e chefe fora da floresta: espécies e níveis supostos (topo da rota +2 e +5).
- O efeito das melhorias de economia (`hunt_xp`, `hunt_profit`, `hunt_speed`) no modo de ação. O teto as herda pelo idle de referência, mas isso não foi simulado.
