# 🎮 宝可梦挂机放置游戏

<p align="center">
  <strong>Pokémon Idle Game</strong>
</p>

<p align="center">
  一款基于网页的宝可梦主题挂机放置游戏，无需安装，打开浏览器即可游玩。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v2.73-blue" alt="version">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="license">
  <img src="https://img.shields.io/badge/platform-Web-orange" alt="platform">
  <img src="https://img.shields.io/badge/made_with-HTML%2FCSS%2FJS-yellow" alt="tech">
</p>

---

## ✨ 游戏特色

- 🏆 **纯放置挂机** — 自动战斗、自动升级，离线也能持续成长
- 🗺️ **10 大地区探索** — 关都、城都、丰缘、神奥、合众、卡洛斯、阿罗拉、伽勒尔、帕底亚、Mega 进化，共计 190+ 条道路
- 📖 **完整图鉴收集** — 收集来自九个世代的宝可梦，追求 ✨闪光 和满 6V 个体
- ⚔️ **属性克制战斗** — 还原宝可梦的 18 种属性克制关系，自动选择最优出战
- 🏅 **徽章系统** — 完成各地区图鉴解锁徽章，获得强力加成效果
- 💎 **宝石系统** — 购买、合成、镶嵌宝石到徽章中，从普通到永恒六个品质等级
- 🌱 **树果花园** — 种植树果、等待成熟、采摘使用，为宝可梦提供增益
- ⚡ **技能系统** — 各属性专属技能，丰富战斗策略
- 🌟 **天赋系统** — 消耗天赋点强化宝可梦能力
- 🏝️ **挑战岛** — 逐层攀登，挑战高难度战斗获取特殊奖励
- 🎨 **6 种主题** — 午夜蓝、森林绿、樱花粉、深海蓝、落日橙、暗夜紫
- 💾 **存档管理** — 自动保存、手动保存、导入导出存档

## 🖼️ 游戏界面

游戏采用底部 Tab 导航，包含以下模块：

| Tab | 功能 |
|-----|------|
| ⚔️ 战斗 | 实时战斗场景，展示双方宝可梦对战 |
| 🗺️ 地图 | 选择地区和道路，探索不同区域 |
| 🏅 徽章 | 查看徽章、宝石商店、合成与镶嵌 |
| 🌱 树果 | 树果花园种植与采摘 |
| ⚡ 技能 | 查看各属性技能列表 |
| 🌟 天赋 | 天赋点分配与重置 |
| 🏝️ 挑战 | 挑战岛逐层挑战 |
| 📖 图鉴 | 宝可梦图鉴，支持地区/属性/闪光筛选与排序 |
| ⚙️ 设置 | 游戏选项、主题切换、存档管理、游戏统计 |

## 🚀 快速开始

### 在线游玩

https://jinwind1.github.io/pokemon-idle/

## 📁 项目结构

```
pokemon-idle-plus/
├── index.html              # 游戏主页面
├── css/style.css           # 全局样式与主题
├── js/
│   ├── lzstring.min.js     # 存档压缩库
│   ├── util.js             # escapeHtml / safeCssColor 等通用工具
│   ├── pokemon-data.js     # 宝可梦数据（1073 只）、经验曲线、属性克制表
│   ├── route-data.js       # 地区与道路数据（10 地区 / 192 条道路）
│   ├── game-config.js      # 配置与常量：徽章/宝石/树果/技能/天赋/挑战塔/存档/战斗公共常量
│   ├── pokemon-instance.js # 个体（instance）：规范形状、性格表、昵称净化（纯函数）
│   ├── species-traits.js   # 物种特质：捕获时随机性格/性别/特性槽位（纯函数）
│   ├── party.js            # 队伍（PartyManager）：≤6 只个体，team 视图原地同步
│   ├── pc.js               # PC / 箱子（PCStorage）：多箱子、按格子存放个体
│   ├── pokemon-validation.js  # 个体名册的清洗（读档/导入）与不变量检查
│   ├── pokemon-migration.js   # 旧存档（每物种一条）→ 个体 的迁移
│   ├── pokemon-roster.js   # 名册（PokemonRoster）：个体/队伍/PC/放生 + 旧结构兼容视图
│   ├── save-manager.js     # 存档：编解码、schemaVersion、迁移、校验清洗、备份轮转、防抖写入
│   ├── game-core.js        # 游戏核心逻辑（战斗、升级、捕获、离线结算等）
│   ├── pc-view.js          # PC / 个体详情界面（PCView）：只调用 GameCore 的队伍/PC 服务
│   ├── guide-view.js       # 下一步条、事件卡片、目标面板（GuideView）
│   ├── guidance.js         # 新手引导 / 下一步建议 / 目标 / 道路进度（以 mixin 装进 GameCore，无 DOM）
│   ├── analytics.js        # 测试期匿名统计（本地缓冲 + gtag/endpoint，可关闭）
│   ├── ui.js               # UI 渲染与交互
│   └── main.js             # 入口：加载存档、离线结算、启动
├── tools/
│   ├── load-context.js     # 把浏览器全局脚本加载进 Node vm（测试/校验共用）
│   ├── data-validator.js   # 宝可梦/路线/配置数据校验器
│   ├── validate-data.js    # 命令行入口：npm run validate
│   └── make-legacy-fixture.js  # 用旧版代码生成兼容性夹具（仅需重生成时运行）
├── tests/                  # 自动化测试（node:test，零依赖）+ 浏览器冒烟测试
├── sprites/pokemon/        # 宝可梦精灵图（含 shiny/）
├── package.json            # 只有脚本，没有运行时依赖
├── LICENSE                 # AGPL-3.0 开源协议
└── README.md
```

## 🎯 玩法简介

1. **战斗与升级** — 游戏自动进行战斗，击败野生宝可梦获得经验值并升级
2. **捕获收集** — 战斗中有概率捕获遇到的宝可梦，追求 ✨闪光 和满 6V 个体值
3. **探索地图** — 从关都地区出发，逐步解锁 9 大地区，等级范围从 Lv.1 到 Lv.17000
4. **徽章解锁** — 完成各地区图鉴后获得徽章，解锁金币掉落、经验加成等强力效果
5. **宝石强化** — 花费金币购买宝石，通过合成提升品质（普通→魔法→稀有→史诗→神话→传说→永恒），镶嵌到徽章增强属性
6. **树果种植** — 购买种子种植树果，5 小时后成熟可采摘，为宝可梦提供各种增益
7. **天赋培养** — 分配天赋点，全方位强化队伍实力
8. **挑战岛** — 逐层挑战高难度战斗，获取通关加成

## ⚙️ 技术栈

- **前端三件套**：HTML5 + CSS3 + 原生 JavaScript（ES6+）
- **无框架依赖**：游戏本身零依赖，无需 npm / webpack / 构建工具（`npm` 仅用于运行测试脚本）
- **数据持久化**：LocalStorage 本地存储
- **响应式设计**：适配移动端与桌面端

## 📋 功能列表

- [x] 自动战斗与挂机系统
- [x] 9 大地区、180+ 条道路
- [x] 完整宝可梦图鉴（含闪光版本）
- [x] 18 种属性克制关系
- [x] 徽章收集与加成系统
- [x] 宝石购买、合成（6 个品质等级）、镶嵌系统
- [x] 树果花园（种植、成熟、采摘）
- [x] 技能系统
- [x] 天赋系统
- [x] 挑战岛
- [x] 6 种主题配色切换
- [x] 存档管理（自动保存 / 手动保存 / 导入导出）
- [x] 离线收益计算（含离线结算报告）
- [x] 存档版本迁移、自动备份与损坏恢复
- [x] 新手引导教程
- [x] 自动切换最优出战宝可梦
- [x] 自动切换地图

## 🛠️ 开发者说明：第 1 阶段「地基稳定」（v2.71）

> 本节面向开发者，使用葡萄牙语撰写（与项目协作者的工作语言一致）；游戏内文案保持中文。

### Como rodar as verificações

Requer apenas Node.js ≥ 20 (nenhuma dependência para instalar).

```bash
npm run validate   # valida Pokémon, rotas, regiões e configs (exit 1 se houver erro)
npm test           # 315 testes automatizados (node:test)
npm run smoke      # teste de "build": abre o jogo num Chromium headless (precisa do pacote playwright;
                   #   se não estiver instalado, o teste é ignorado)
npm run check      # os três acima em sequência
```

### O que mudou nesta fase

**Offline / progresso**
- O evento `offlineEnd` agora carrega um `summary` (batalhas, EXP, ouro, novas capturas, evoluções, shinies,
  insígnias, regiões desbloqueadas, maiores subidas de nível). Antes os eventos eram coletados e descartados.
  A UI mostra um **relatório de offline** (para ausências ≥ 5 min ou quando há eventos importantes) e replica os
  eventos no log de batalha e no desbloqueio de abas.
- **Modo Torre × offline**: com a Torre ativa, a simulação offline da rota principal não roda mais (ela corrompia o
  progresso da Torre); a batalha da Torre continua no timer do Worker.
- **Lógica única online/offline**: dano (`_computeDamage`), críticos (`_getCritParams`), chance de shiny
  (`getShinyRate`), geração de inimigos (`generateWildPokemon`), escolha do melhor membro
  (`getBestTeamMemberForEnemy`), recompensas (`_processVictoryRewards`) e atraso entre batalhas
  (`_getNextBattleDelay`) são as mesmas funções nos dois caminhos. As cópias duplicadas foram removidas.
- Corrigidos: callbacks de UI perdidos para sempre em saídas antecipadas da simulação offline; HP pós-offline
  ignorado ao retomar a batalha; loop infinito quando a rota não tem Pokémon; cura pós-derrota agora usa o timer
  do Worker (não é limitada em aba em segundo plano); `upgradeAllSkills` nunca atualizava os stats da equipe
  (comparava `"25"` com `25`); `main.js` não usa mais `requestAnimationFrame` (não dispara em aba oculta).

**Save**
- `schemaVersion` (atual: **3**, ver a Fase 2; v2 = Fase 1; saves antigos sem o campo são tratados como v1) + cadeia de migrações em
  `SAVE_MIGRATIONS` (`js/save-manager.js`). Ao ler um save v1 é guardada uma cópia `pokemon_idle_save_premigration_v1`.
- Todo save (local, backup ou importado) passa pelo mesmo pipeline: decodificação → checagem estrutural → migração →
  **sanitização por lista branca** (reconstrói o objeto inteiro: só campos conhecidos, tipos e limites forçados).
- **Backup rotativo**: `pokemon_idle_save_bak1..3` (no máx. 1 a cada 10 min, e sempre antes de importar). Se o save
  principal estiver corrompido o jogo recupera do backup mais recente e guarda o texto corrompido em
  `pokemon_idle_save_corrupt`. Saves de uma versão mais nova do que o jogo são recusados (nunca rebaixados).
- **Debounce**: `save()` agora só *pede* a gravação (2 s após a última requisição, no máximo 10 s); `saveNow()`
  grava imediatamente (botão salvar, exportar, importar, `pagehide`/aba oculta, `beforeunload`). Antes havia uma
  gravação completa (JSON + compressão) a cada vitória.
- **Erros visíveis**: falha de gravação (cota cheia, armazenamento bloqueado) mostra um banner vermelho com
  “Exportar arquivo” / “Tentar de novo”; em cota cheia o jogo libera backups antes de desistir. Banner amarelo ao
  recuperar de backup. Se outra aba gravar o save, esta aba pausa a gravação (evita sobrescrita) e oferece “Assumir”.
- Formato compatível: continua `LZ:` + LZString no `localStorage`; o texto de exportação continua Base64 e saves
  exportados por versões antigas importam normalmente (há testes com saves reais gerados pelo código antigo).

**Import/Export e segurança**
- `importSave` retorna `{ success, message, warnings }`, valida tudo **antes** de tocar no estado atual, faz backup
  do save atual e reinicia batalha/caches. Aceita Base64, `LZ:` bruto e JSON puro; limite de tamanho.
- Nenhum texto do save chega ao HTML: nome/cor/ícone/unidade das gemas, nomes de inimigos etc. são reconstruídos a
  partir das tabelas do jogo; `uid`s são restritos a `[A-Za-z0-9_-]`; chaves `__proto__`/`constructor` são ignoradas.
  Além disso a UI escapa os campos das gemas (`escapeHtml`/`safeCssColor`) e o log de batalha usa `textContent`.
- `lastSave` no futuro é corrigido (impede ganhar offline mexendo no relógio do sistema).

**Performance**
- `calculateBattleStats` não reconstrói mais todo o Pokédex a cada chamada: stats por espécie e o bônus de 1% do
  Pokédex são cacheados e invalidados por `_touchSpecies(id)` (chamado em todo ponto que altera nível/IV/shiny/frutas).
  Um teste de fuzz compara o resultado com o algoritmo antigo.
- `battleTick` usa dados da batalha pré-calculados (`battle.derived`: nível, tipos, golpe, crítico, esquiva) e
  `getGemBonuses` é cacheado; não há mais `createPokemon` por ataque.
- UI: log de batalha incremental (antes reescrevia 100 linhas por mensagem), cache de elementos DOM e escrita só
  quando o valor muda no `tick`, painel de equipe atualizado no máximo a cada 500 ms e só com a aba de batalha visível.

**Dados**
- `REGION_POKEDEX_RANGES` (em `game-config.js`) é a única fonte dos intervalos por região (antes havia cópias
  espalhadas). `npm run validate` checa: IDs sem buracos, tipos/stats/grupos de EXP, evoluções (alvo existe, sem
  ciclos), sprites normal+shiny, rotas/regiões/pesos/níveis, condições de desbloqueio, **alcançabilidade** (simula a
  progressão real até a última região) e tabelas de golpes/gemas/frutas/talentos.

### Como adicionar uma migração de save
1. Aumente `SAVE_SCHEMA_VERSION` em `js/game-config.js`.
2. Em `js/save-manager.js` adicione `SAVE_MIGRATIONS[versaoAntiga] = (data) => { …; return data; }`.
3. Declare os campos novos em `sanitizeSave` (a sanitização descarta o que não conhece).
4. Adicione um teste em `tests/save.test.js`.

## 🧬 Fase 2: indivíduos reais de cada espécie (v2.72, schema v3)

> Antes: `caughtPokemon[espécie]` — uma única entrada por espécie. Agora: o jogador possui **vários indivíduos** da
> mesma espécie (Pikachu #A, #B, #C), cada um com o próprio estado. O sistema antigo continua funcionando como
> **camada de compatibilidade**; nada foi removido.

### Estruturas novas (persistidas no save)

| Campo | Conteúdo |
|---|---|
| `ownedPokemon` | `{ uid: indivíduo }` — todos os indivíduos |
| `party` | `[uid, …]` (≤ 6) — equipe ativa; `activePokemonIndex` continua sendo o índice na equipe |
| `pc` | `{ boxes: [{ id, name, capacity, slots: [uid\|null, …] }] }` — caixas (30 por caixa, até 200 caixas) |
| `released` | histórico de liberados/transferidos (últimos 500) |
| `speciesPrimary` | `{ espécie: uid }` — o indivíduo que representa a espécie nos sistemas antigos |
| `nextPokemonSeq` | contador dos `uid` (`p1`, `p2`, …: determinístico, único por save) |

Um indivíduo tem: `uid`, `speciesId`, `level`, `exp`, `ivs` (6 IVs próprios), `nature` (25 naturezas, **sem efeito ainda**),
`ability` (reservado), `gender` (reservado; não há tabela de proporção de sexo nos dados), `shiny`, `nickname` (opcional,
sanitizado, ≤ 12 caracteres), `origin` (`starter`/`wild`/`evolution`/`legacy_migration`/`egg`/`gift`/`debug`),
`originRoute`, `caughtAt` (data do dia, UTC), `battles`, `stats` (`victories`, `faints`, `expGained`, `damageDealt`,
`damageTaken`, `criticalHits`) e `skillLevel`.

### Módulos (nada disso está em `GameUI`)

- `pokemon-instance.js` — forma canônica (`buildInstance`/`createPokemonInstance`), naturezas, `sanitizeNickname`.
- `party.js` (`PartyManager`) — adicionar/remover/trocar/substituir; mantém `team` (espécies) sincronizado **in place**.
- `pc.js` (`PCStorage`) — depositar/retirar/mover (com troca), várias caixas, renomear com nome sanitizado.
- `pokemon-roster.js` (`PokemonRoster`) — fachada: `create`, `release`, `moveToParty`, `moveToPc`, `swapPartyWithPc`,
  `setPrimary`, `setNickname`, `reconcile`. Não depende do `GameCore` (recebe `getState`), por isso é testável sozinha.
- `pokemon-migration.js` e `pokemon-validation.js` — migração v2→v3 e sanitização/invariantes (`validateRosterIntegrity`).
- `GameCore.roster` expõe tudo isso; a UI só chama `getPartyInstance(i)`/`getPartyMemberView(i)`.

### Camada de compatibilidade (como o jogo antigo continua funcionando)

1. **`caughtPokemon[espécie]` é o *mesmo objeto* do indivíduo primário da espécie.** Código antigo que altera
   `level/exp/ivs/skillLevel` está alterando o indivíduo — sem cópia e sem sincronização manual.
2. **`team` é a visão em espécies de `party`** (mesmo índice). Se código/teste antigo escreve `gameState.team = […]`
   diretamente, `roster.reconcile()` (chamado antes de qualquer cálculo) reconstrói `party` a partir dele; quem sai da
   equipe vai para o PC — **nunca se perde um indivíduo**.
3. **Combate usa indivíduos**: stats de batalha, bônus de 20% dos colegas, XP (100% do ativo / 50% de cada colega),
   golpes e estatísticas individuais são calculados por indivíduo. Duas Pikachus na equipe têm níveis/IVs/shiny/XP independentes.
4. **Regras de espécie preservadas** (para não alterar o balanceamento): o bônus de 1% da Pokédex e o XP de reserva
   valem para o *primário* de cada espécie que não está na equipe; indivíduos extras não os multiplicam. A "maestria de
   IV" (derrotar de novo uma espécie já possuída sobe os IVs do primário) continua só no primário — veja a Fase 3 para
   a captura de duplicatas, que cria indivíduos novos independentes.
5. `shinyDex` continua sendo o registro por espécie: o primário é shiny ⇔ `shinyDex[espécie]`. Na Fase 3, um shiny
   capturado quando o primário não é shiny passa a ser o novo primário (o shiny extra de uma espécie que já tem primário
   shiny não altera o registro).
6. **Invariantes** (checados por `validateRosterIntegrity`): cada indivíduo está em exatamente um lugar (equipe ou uma
   caixa); toda espécie com indivíduos tem um primário; `caughtPokemon[e] === ownedPokemon[primário]`; `team` bate com `party`.
7. Limitação intencional: o último indivíduo de uma espécie não pode ser liberado (o jogo antigo trata "tem indivíduo"
   como "espécie coletada"); indivíduos na equipe também não.

### Migração (schema v2 → v3)

`SAVE_MIGRATIONS[2]` → `migrateLegacyToInstances`: para cada espécie em `caughtPokemon` cria **um indivíduo**
(`p1…pN`, em ordem de espécie) preservando IVs, nível, XP, `skillLevel` e shiny (`shinyDex`); natureza neutra (`hardy`,
o cálculo atual não tem natureza), `origin: legacy_migration`, `caughtAt: null`. A equipe vira `party` na mesma
ordem (e o mesmo `activePokemonIndex`); os demais vão para as caixas do PC em ordem de Pokédex. Os campos antigos
são mantidos. Saves v1 passam por v1→v2→v3. O save original fica guardado em `pokemon_idle_save_premigration_v<N>`.
A migração é determinística e idempotente, e o pipeline de sanitização (`sanitizeRosterSection`) valida tudo: uids,
campos, posições de PC, equipe, primários, registros de liberados (strings sem HTML/aspas, chaves como `__proto__` rejeitadas).
Enquanto o save mantiver os dois formatos, **o campo antigo vence em caso de conflito** (regra de transição, só
relevante para saves editados por ferramentas antigas).

Prova de compatibilidade: os testes carregam saves reais gerados pelo código v1 e v2 e comparam, com os números que
o **código antigo** calcula (`tests/fixtures/legacy-battle-stats.json`), stats de batalha, poder, potencial, barra de
XP, soma de níveis e Pokédex — idênticos.

### Como adicionar uma nova informação ao indivíduo
1. Acrescente o campo em `buildInstance` (valor padrão seguro) e em `sanitizeInstance` (validação).
2. Se precisar migrar dados antigos, faça-o em `migrateLegacyToInstances` ou crie `SAVE_MIGRATIONS[3]` (e suba `SAVE_SCHEMA_VERSION`).
3. Teste em `tests/pokemon-instance.test.js` e `tests/roster-save.test.js`.

## 🎒 Fase 3: loop principal jogável (v2.72, schema v3)

Fecha o fluxo **explorar → capturar → montar equipe → batalhar → ganhar XP → evoluir → mover PC/equipe → salvar → recarregar**
sem refatoração estrutural: tudo usa a arquitetura da Fase 2 (sem mudança de schema; `archivedSpecies` é um campo novo
opcional — saves da Fase 2 carregam normalmente).

### Captura real (fluxo normal de gameplay)
- `processDefeat` decide o que fazer ao derrotar um selvagem:
  - **espécie nova** → cria o primeiro indivíduo (como antes), agora com natureza/sexo/habilidade sorteados e shiny herdado do selvagem;
  - **espécie já possuída** → primeiro aplica a regra antiga (IVs do primário sobem para o máximo) e depois, conforme a
    política `captureDuplicates`, pode criar **um novo indivíduo** (uid próprio, Lv1, IVs/natureza/habilidade/sexo/shiny
    próprios, vai para o PC, `origin: wild`). Duplicatas não dependem de nenhuma API interna.
- Política (Configurações → "Ao encontrar um Pokémon que já possui"): `all` (padrão: 5% de chance, `DUPLICATE_CAPTURE_RATE`),
  `better` (só se a soma de IVs superar todos os indivíduos da espécie) ou `off` (comportamento anterior). **Shiny sempre
  é capturado** (exceto em `off` ou PC lotado — nesse caso o evento `captureBlocked` avisa). Não-shiny deixam de ser
  capturados automaticamente com 20 indivíduos da espécie (`DUPLICATE_SPECIES_CAP`), para a pesca offline de 24 h não
  lotar o PC (sem o teto, 24 h offline numa rota de 3 espécies geravam ~1600 indivíduos).
- Sem dados de proporção de sexo/habilidades na tabela de espécies: `species-traits.js` usa 50/50 (com uma lista de
  exceções aproximada: sem sexo/só macho/só fêmea) e guarda o **slot** de habilidade (`a1`/`a2`/`ha`, oculta ≈ 1/64).
  Natureza, sexo e habilidade ainda **não afetam** o combate (balanceamento intocado).
- Capturas offline entram no relatório (`duplicateCatches`).

### Evolução individual
`PokemonRoster.evolveInstance(uid, alvo, {resetProgress})`: o próprio indivíduo muda de espécie (Pikachu A → Raichu A),
mantendo uid, IVs, natureza, habilidade, sexo, shiny, apelido, estatísticas e posição (equipe/PC).
- **Alvo ainda não registrado na Pokédex** → regra antiga: Lv1/XP 0/skill 0 (nova entrada na Pokédex). Se era o último da
  espécie, a espécie original fica como **registro de Pokédex** (`archivedSpecies`, formato antigo
  `{speciesId, level, exp, ivs, skillLevel}`): continua contando para o bônus de 1%, recebe XP de reserva e pode ser
  recapturada (a captura substitui o registro).
- **Alvo já registrado** (você já tem outro Raichu) → evolui igual e **mantém o nível**. Evoluções que ficam disponíveis em
  cadeia (nível já acima do próximo requisito) acontecem em sequência.
- Ramificações: prefere o alvo ainda não registrado; senão, o primeiro elegível da tabela.
- Mudança deliberada em relação à Fase 2: antes a evolução criava um indivíduo *novo* e deixava o antigo; os testes
  `roster-compat` 13–15 foram reescritos para a nova regra.

### Equipe e PC pela interface
- Novos serviços em `GameCore` (retornam `{ok, code}`; bloqueados na Torre e durante o offline): `partyAdd`, `partyRemove`,
  `partySwapWithPc`, `partyReorder`, `pcMoveToBox`, `renamePokemon`, `releasePokemon`, `describeInstance`. Máx. 6, o ativo
  nunca sai, a equipe não fica vazia, o `team` continua apenas como visão de compatibilidade.
- Aba **PC** (`pc-view.js`): equipe com ▲▼/ativo/"Voltar ao PC", caixas paginadas (renomear/nova caixa/busca), detalhe do
  indivíduo (uid `#pN`, IVs, natureza, habilidade, sexo, origem, data) e ações (equipe, trocar por um membro, mover de
  caixa, apelido, soltar). Dois indivíduos da mesma espécie aparecem como `×N` e com `#uid · sexo · natureza · IV%`.
- O painel de batalha mostra a equipe **na ordem da equipe** (antes era por nível) com ▲▼ e a mesma linha de identificação.

### Combate: auditoria
Tudo já usava o indivíduo da posição ativa (`battle.derived.activeInst`); dois pontos eram por espécie e foram corrigidos:
a recompensa de vitória procurava o ativo *pela espécie* (quebraria após evoluir no meio da simulação offline) e o cache
offline da equipe só invalidava por nível. `tests/combat-individuals.test.js` cobre dano, habilidade/skill, XP, auto-troca,
offline e Torre com duas Pikachu de atributos diferentes.

### Testes novos (fase 3)
`species-traits`, `capture-individuals`, `evolution-individual`, `party-pc-services`, `combat-individuals`,
`archived-species` e `main-loop` (capturar → duplicata → equipe/PC → batalha → XP → evoluir → salvar → recarregar),
mais 8 verificações de navegador (aba PC, política de captura, ▲▼, persistência).

### Limitações conhecidas (fase 3)
- IV/maestria continuam por espécie no primário; um shiny que vira primário não herda os IVs do antigo (podem cair até
  subirem de novo por maestria).
- Pokédex, habilidades (skill), frutas e "layout de equipe por espécie" ainda operam sobre o primário da espécie.
- Natureza, sexo e habilidade ainda não têm efeito; o sexo usa uma tabela aproximada.
- Capturar duplicatas enche o PC (até 200 caixas × 30); não há "soltar em lote" nem ordenação automática.

## 🧪 Fase 4: beta / experiência do jogador (v2.73, sem mudança de schema)

Objetivo: uma pessoa que nunca viu o jogo consegue abrir, entender o objetivo, jogar e perceber que está progredindo.
Sem refatoração estrutural: tudo é incremental sobre as fases anteriores. **Todo o texto do jogo agora é pt-BR** (veja
a seção de localização abaixo).

### Auditoria da experiência (o que foi encontrado → o que foi feito)
| Problema encontrado | Correção |
|---|---|
| `viewport` com `initial-scale=1.5`: no celular 1/3 da tela ficava cortada (visual 260px sobre layout de 392px) | `initial-scale=1`; ícone 🔒 das abas não estoura mais; alvos de toque ≥ 36px; contraste dos botões desabilitados |
| Jogador fica **preso na Rota 1** (só 2 espécies; a troca automática exige 6V+shiny) e nada avisa | Barra "próximo passo" detecta "rota completa" e oferece **Ir** (1 toque); cards do mapa mostram "ainda faltam N" / "✓ completa" e a rota **recomendada** |
| Nenhuma tela dizia "o que faço agora / o que ganho" | Barra de próximo passo + 15 metas com progresso (painel 🏆) + próxima região como meta |
| Feedback só no log (2 linhas) | Cartões de evento (o que aconteceu + por que importa + o que fazer) para espécie nova, shiny, evolução, região desbloqueada, meta; "+EXP" e "⬆️ Lv" flutuantes; bolinha de novidades na aba PC |
| Tutorial em texto, desatualizado, sem PC | Boas-vindas de 3 linhas + **5 passos guiados** (mostrar → fazer → recompensar), pulável |
| 1ª evolução reinicia para Lv1 sem aviso | Aviso **antes** (barra "faltam N níveis… a nova forma recomeça no Lv.1") e explicação **depois** (nova entrada na Pokédex; a espécie antiga continua contando) — a regra em si não foi alterada |
| PC enche de duplicatas | 🧹 "Organizar duplicatas" (mantém o mais forte; shiny, com apelido e da equipe ficam) |
| Pokédex abria em "Todos" (1073 linhas "???") | Abre em "Capturados"; estados vazios com explicação |

### Onboarding e metas (`guidance.js`)
- 5 passos derivados do **estado do jogo** (não de cliques): primeira batalha → primeira captura → abrir o PC → montar equipe →
  explorar outra rota. Cada passo dá uma pequena recompensa de XP (nunca mais que subir 1 nível do ativo; sem economia nova).
  Pulável (boas-vindas ou barra), reiniciável em Configurações; saves antigos com progresso **pulam** o onboarding e as
  metas já cumpridas não são pagas retroativamente.
- `getNextAction()` escolhe uma única sugestão: passo do onboarding > rota completa (com botão de ir) > evolução próxima >
  meta mais próxima. Estado em `gameState.guide` (whitelist em `sanitizeSave`; campo opcional, sem bump de schema).
- Metas usam sistemas existentes: espécies, vitórias, níveis, 1ª evolução, 2º indivíduo da mesma espécie, equipe cheia,
  1º shiny, 6V e desbloqueio da próxima região.

### Analytics para o beta (`analytics.js`)
- Eventos: `game_open`, `session_start`, `session_end`, `first_action`, `first_capture`, `battle_start`, `battle_complete`,
  `level_up`, `evolution`, `pc_open`, `route_unlock`, `shiny_found` (+ `capture`, `route_change`, `onboarding_step`,
  `onboarding_skip`, `goal_complete`, `offline_return`). Parâmetros pequenos e sanitizados; sem dados pessoais.
- Para não inundar: `battle_start` 1×/sessão, `battle_complete` na 1ª vitória e a cada 25, `level_up` só ≤Lv10 ou múltiplos de 5,
  `pc_open` 1×/sessão. Os **contadores são exatos** (`counters.battles`, `captures`, `evolutions`…). Offline vira um único `offline_return`.
- Retenção: `installId` aleatório, `days_since_first`, `returning`, `hours_since_last`, `returnedNextDay`, sessões por dia jogado,
  duração **ativa** (aba oculta não conta), `last_step` no `session_end` = ponto de abandono; sessões mortas pelo navegador são
  recuperadas (`reason: recovered`).
- Destinos: buffer local (`localStorage pokemon_idle_analytics`, ≤300 eventos, fora do save), `gtag` (reaproveitado) e
  `ANALYTICS_ENDPOINT` opcional (`sendBeacon`). **Atenção:** o ID do GA em `index.html` (`G-JR8QR87EH2`) é do autor original —
  troque pelo seu (ou `ANALYTICS_GTAG_SINK = false`) antes de publicar.
- Privacidade: opt-out em Configurações (apaga a fila), respeita Do Not Track por padrão.
- Sem backend: Configurações → **Copiar relatório de teste** gera um JSON (`getSummary()`) com funil (segundos até a 1ª ação/
  batalha/captura/PC/evolução), sessões, D1, duração média, contadores e pontos de abandono.
- Perguntas → onde ler: quantos começam (`game_open` com `new_player`), 1ª captura/batalha/evolução (`secondsToFirst`),
  voltam no dia seguinte (`returnedNextDay`), duração (`avgSessionSeconds`), média de capturas/batalhas (`counters` por instalação),
  abandono (`sessionEndsByLastStep`).

### Testes (fase 4)
`analytics`, `guidance`, `first-session` (jornada completa com funil de eventos, rota completa, limpeza de duplicatas) e
20 verificações novas no navegador em viewport de celular (`isMobile`): sem corte/rolagem horizontal, boas-vindas, barra de passo,
cartões, bolinha do PC, mapa recomendado, estados vazios, metas, opt-out de analytics, retorno marcado como `returning`,
pular onboarding e save antigo sem onboarding.

### Limitações (fase 4)
- Recompensas são só XP; metas de longo prazo (6V/shiny de região) ainda dependem do que já existe.
- O funil é local por dispositivo: sem backend, o relatório precisa ser copiado pelo jogador.
- Cartões de evento são informativos (não há histórico); a primeira evolução continua reiniciando o nível (decisão de design anterior).

## 🇧🇷 Localização para português do Brasil (v2.73)

Etapa isolada: **só strings visíveis ao jogador** mudaram. Lógica, balanceamento, save (schema, chaves, ids), analytics,
eventos e nomes de função ficaram intactos — verificado comparando o código antes/depois com todos os textos
neutralizados (as únicas diferenças são chamadas `ptPlural`, `ptNumber` e `toLocaleString('pt-BR')` dentro de textos).

- **Helpers** (`js/util.js`): `ptPlural(n, 'espécie', 'espécies')` e `ptNumber(n)` (1.234.567).
- **O que foi traduzido:** `index.html` (inclui o histórico de versões e o aviso legal), `ui.js`, `pc-view.js`, `guide-view.js`,
  `guidance.js`, mensagens de `game-core.js`/`save-manager.js`, 1073 nomes de espécie (nomes oficiais internacionais, os mesmos do pt-BR),
  18 tipos, 25 naturezas, 10 regiões e 192 rotas, insígnias, gemas, frutas, técnicas e talentos (`game-config.js`).
- **Glossário** (use sempre os mesmos termos): Equipe, PC, Rota, Região, Meta, EXP, Lv., Pokédex, Shiny, Natureza, Habilidade,
  Gênero, IVs, Insígnia, Gema, **Fruta** (Berry), **Técnica** (skill; "Habilidade" é a Ability), Talento, Moedas, Torre de Desafio, Liberar.
  Rótulos curtos de aba: Batalha · Mapa · Insígnias · Frutas · Técnicas · Talentos · Torre · Pokédex · PC · Config.
- **Continua em chinês de propósito** (nunca aparece na interface): comentários, `_log`/`console`, `throw new Error`, avisos
  de saneamento/`checkIntegrity`, mensagens do validador de dados e o nome padrão de caixa gravado em saves antigos
  (`箱子 N`, exibido como "Caixa N" por `boxDisplayName`).
- **Testes:** os que comparavam texto visível foram atualizados só no texto esperado (efeito de tipo, mensagens de import/quota,
  nome de natureza, textos da barra de passos e metas, e as verificações por texto do smoke). Novos: `tests/localization.test.js`
  (dados sem chinês, 1073 nomes únicos, ids intactos, varredura estática do código-fonte e do HTML) e 8 verificações de navegador
  que abrem as 10 abas, o mapa das 10 regiões, a Pokédex (todos os filtros), diálogos e cartões em **desktop 1280×800 e celular
  360×640**, falhando se houver chinês ou rolagem horizontal.
- **Ajustes de layout causados pelo texto maior:** abas com ícone sobre o rótulo em telas ≤480px, linha "#id · natureza · IV%" dos
  cartões do PC quebra em vez de cortar, e a barra de passos ocupa a largura toda no layout de duas colunas (desktop).
- **Revisar:** nomes de local de rotas de Hoenn/Galar/Mega e alguns apelidos de rota são traduções livres; nomes de golpes em
  `SKILL_DATA` usam os nomes oficiais em inglês (alguns mapeamentos zh→en foram feitos de memória). A lista id→nome chinês→nome
  pt-BR das espécies pode ser regenerada a partir do commit anterior para conferência.

### Problemas conhecidos / ainda não tratados (fases 1 e 2)
- A UI continua sendo `innerHTML` em muitos lugares (os dados vindos do save já são sanitizados, mas a camada de
  renderização ainda não foi componentizada); `ui.js` e `game-core.js` seguem grandes (~3,5 mil e ~4,3 mil linhas).
- Dados com 9 avisos históricos (não bloqueiam): 7 Pokémon com faixa de nível fora da faixa da rota, um salto de
  nível em `paldea_route12` (13001–14000) e `#706` repetido em `kalos_victory_road`. Há baseline nos testes para que
  esses avisos só possam diminuir.
- Os testes do jogo são de lógica (Node) + um smoke test de navegador; ainda não há testes visuais da UI.
- A proteção multi-aba é por evento `storage` (aviso + pausa), não um lock exclusivo.
- Mudar o relógio do sistema para trás/frente ainda afeta frutas e offline dentro do limite de 24/48 h.
- **Fase 2:** não há tela de PC/caixas nem de apelidos (a lógica e os dados existem em `roster`; a UI atual só mostra o
  apelido na equipe). Naturezas/habilidades/sexo são apenas dados (sem efeito). O save mantém **os dois formatos**
  (indivíduos + espelho `caughtPokemon`/`team`), cerca de 1,9× maior (≈ 53 mil caracteres LZ com 1073 espécies) e cada
  gravação completa leva ≈ 0,4 s nesse extremo (o debounce mantém isso a cada ≥ 10 s); o espelho sairá quando o código
  antigo for aposentado. Bônus de Pokédex, XP de reserva, frutas, talentos e a UI da Pokédex continuam por espécie
  (primário). `release` ainda não é exposto na UI.

## 📄 许可证

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 开源。

## ⚠️ 免责声明

- 本游戏由 AI 辅助生成，仅用于学习交流与技术演示，不用于任何商业用途。
- "宝可梦 / Pokémon" 及相关角色、名称、图像与设定的著作权、商标权等知识产权归原权利人所有（如 Nintendo、Game Freak、Creatures 及 The Pokémon Company）。
- 如有侵权或不当使用，请联系删除或更正。

---

<p align="center">
  Made with ❤️ by <strong>jinwind</strong>
</p>

## 🎯 Fase 5A: motor de automação e aba "Caça" (sem mudança de schema)

O jogador configura uma operação de caça e a equipe trabalha sozinha (online e offline). **Desligada por padrão**: sem política/sessão o jogo se comporta exatamente como antes.

### Fluxo

```
GAME STATE → POLÍTICA → ENGINE → DECISÃO → AÇÃO → REGRAS DO NÚCLEO → MUDANÇA DE ESTADO → EVENTO → UI/relatórios
```

| Peça | Arquivo | Papel |
|---|---|---|
| Relógio injetável | `js/automation/clock.js` | `SystemClock`, `ManualClock`, `SimulationClock` (a simulação não depende de tempo real) |
| Barramento de eventos | `js/automation/events.js` | multi-assinante, nomes validados, buffer circular |
| Qualidade | `js/automation/quality.js` | `calculatePokemonQuality` → nota S–D, pontos e % |
| Política | `js/automation/policy.js` | captura, cura (`heal.whenHpBelowPercent`, `onNoPotions`), rota (`stay`/`switchWhenComplete`/`stopWhenComplete`), `stopConditions` (`timeLimitMinutes`, `battleLimit`, `shinyFound`, `routeComplete`); validação estrita + saneamento |
| Sessão | `js/automation/hunt-session.js` | estados `idle/running/paused/stopped/finished`, estatísticas acumuladas, mensagens de parada em pt-BR |
| Decisão | `js/automation/capture.js`, `decision.js` | **funções puras** (`shouldCapture`, `decideAutomationActions`): mesmo snapshot → mesma decisão |
| Ações | `js/automation/actions.js` | `ActionDispatcher`: valida **antes** de mutar; ação inválida não altera estado |
| Engine | `js/automation/engine.js` | driver ao vivo: assina o barramento só com caçada rodando; avalia no fim da batalha, no início do encontro e quando o HP cai do limite |
| Simulação | `js/automation/simulation.js` | `simulateHunt` (síncrono, determinístico por semente), relatório offline, recomendações |
| Interface | `js/hunt-view.js` | só desenha e pede ações; assina eventos apenas com a aba aberta |

### Dois drivers, as mesmas regras

* **Live**: o loop de 50 ms do jogo; o engine reage aos eventos (`battle_completed`, `hp_low`, `battle_started`…).
* **Fast**: `_fastBattleStep` (antigo `_runOfflineBatch` refatorado) usa as **mesmas** fórmulas, geração de inimigos, `_processVictoryRewards`, captura, evolução e **o mesmo** `decideAutomationActions`. É usado no offline real e no simulador. Sem caçada, o offline é idêntico ao anterior.
* Fechar e reabrir com a caçada rodando: a sessão volta **pausada** (`pausedByReload`); o offline roda a caçada pelo driver rápido, mostra o relatório "Durante sua ausência" e a deixa pausada.

### Poções (primeiro consumível)

`gameState.inventory.potions` (10 iniciais; saves antigos recebem 10 uma vez). `usePotion` no núcleo recupera 50% do HP máximo e reanima o Pokémon caído. Sem poções e `onNoPotions: 'stop'` → "Caça interrompida: sem poções." (`rest` e compra de poções ficam para a fase de economia). A regeneração antiga continua valendo fora da caçada.

### Benchmark

```
node tools/bench-automation.js          # 1 / 100 / 1000 sessões, 10 min / 1 h / 4 h / 24 h, política A × B
node tools/bench-automation.js --quick
```

Referência (Node 22, uma máquina de CI): 24 h simuladas em ~1 s (≈31 mil batalhas); ~33 mil batalhas/s; 1000 sessões de 1 h em ~39 s.

### Caminho de evolução (apenas documentação; nada disso existe ainda)

`Simulation Engine` (hoje: `_fastBattleStep` + decisão pura) → `Authoritative Backend` (mesmas funções puras e regras rodando no servidor; o cliente só envia política/ações) → `WebSocket` (eventos do barramento como mensagens) → `Clients`.
Candidatos a serviços separados: servidor autoritativo de simulação (worker), banco para política/sessões/relatórios, serviço de analytics (o barramento já emite eventos limpos e pequenos).

### Testes

`tests/automation-*.test.js`, `tests/hunt-view.test.js` (DOM falso em `tests/helpers/fake-dom.js`) e o smoke com Chromium (aba Caça em 360×640 e 1280×800, sem rolagem horizontal, iniciar/pausar/parar, motivo, offline).

## 💰 Fase 6: economia, Hunt Analyzer e upgrades (sem mudança de schema)

Transforma a automação em um sistema de decisões: caçar → ganhar moedas → comprar poções/upgrades → ficar mais eficiente → escolher rota/política melhor.
Relatório completo de balanceamento (tabelas de 10 min a 7 dias, 3 perfis × 4 estilos): [`docs/economia-balanceamento.md`](docs/economia-balanceamento.md).

| Peça | Arquivo | Papel |
|---|---|---|
| Configuração | `js/economy/config.js` | **todos** os números econômicos (preços, upgrades, analisador, comparação) |
| Economia | `js/economy/economy.js` | `earnMoney`/`spendMoney`: única via para mexer em `gold` (valor inteiro > 0, `reason` registrada, saldo nunca negativo, eventos `money_earned`/`money_spent`, só acumulados por razão) |
| Loja | `js/economy/shop.js` | catálogo genérico (hoje só poções), preço progressivo, estoque com teto, compra atômica |
| Upgrades + modificadores | `js/economy/upgrades.js` | 5 upgrades com requisitos; `getModifier(stat)` é o único ponto de bônus — Live e Fast usam as mesmas funções do núcleo |
| Analyzer | `js/economy/analyzer.js` | métricas por hora, agregação por rota (flush por trecho), histórico das últimas 20 caçadas, objetivo |
| Rotas | `js/economy/route-compare.js` | real × estimado (simulação em cópia "headless"), melhores por objetivo, avisos de risco, recomendação (nunca troca a rota sozinha) |
| Interface | `js/economy-view.js` | Recursos / Loja / Upgrades / Análise dentro da aba Caça |
| Simulador | `tools/simulate-economy.js` | jogador-robô, perfis e estilos, horizontes até 7 dias, saída em tabela/JSON/Markdown |

Regras que mudaram: derrubar Pokémon rende moedas **desde o início** (`earnFromStart`); gemas, frutas e talentos continuam atrás das insígnias; o ritmo de toda a caçada (lutas e intervalo) é escalado pelo upgrade Velocidade (a Torre não é afetada).
Invariantes cobertos por teste: saldo ≥ 0, compra não duplica, save/load e offline não duplicam dinheiro, upgrade só sobe pagando, poções não duplicam, todo movimento tem `reason`, só `economy.js` altera `gold`.

```
node tools/simulate-economy.js --markdown          # tabelas completas (≈ 5 min)
node tools/simulate-economy.js --profile=new --days=1
node tools/bench-automation.js
```
