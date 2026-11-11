# Tabela espacial dos golpes (Elétrico, Planta, Inseto, Normal, Veneno, Voador, Fogo, Água + Investida)

## 1. Descrição

Referência rápida da **forma no espaço** de cada golpe que o jogo usa (`SKILL_DATA` em `js/game-config.js`, linhas 311–492) para os tipos pedidos na fase F12, mais Investida/Tackle (golpe de reserva de `moveFxWildMove`). Para cada golpe: categoria oficial, o que o golpe faz (com minhas palavras), forma espacial, alcance, se atinge vários alvos nos jogos oficiais (dado de batalhas duplas/triplas) e se o formato atual de `js/fx/move-fx.js` (`MOVE_FX_BY_NAME`, linhas 30–42; áreas em `MOVE_FX_AREAS`, linhas 57–69) combina.

Público: `gameplay-developer` (área de dano real no modo de hordas) e `art-animation-3d` (desenho do efeito).

## 2. Fontes consultadas

Situação da rede nesta sessão: `WebFetch` **bloqueado** (DNS negado) para `bulbapedia.bulbagarden.net` e `pokemondb.net`. `WebSearch` funcionou e devolveu resumos (não abri as páginas inteiras).

| Fonte | Tipo | O que se obteve |
|---|---|---|
| Busca: "moves that hit all adjacent opponents" (resumos de PokémonDB "Moves that hit multiple Pokémon", poketools "Doubles Targeting Guide", Bulbapedia "Range") | enciclopédias/guias de fãs | confirmado: Heat Wave é golpe de espalhamento (todos os oponentes adjacentes); golpes de espalhamento têm dano reduzido a 75% quando atingem mais de um alvo |
| Busca: "moves that hit all adjacent Pokémon including ally" (resumos de Bulbapedia "Category:Moves that target all adjacent Pokémon", PokéBase, gamerjournalist) | enciclopédias/guias de fãs | confirmado: **Surf, Discharge, Earthquake, Sludge Wave, Bulldoze** atingem todos os adjacentes, **inclusive o aliado** |
| Busca: Swift / Hyper Voice / Bug Buzz | — | **não confirmado** pela busca (resultados fora do tema) |
| Fontes oficiais (pokemon.com, jogos) | oficial | **não abertas** (bloqueio) |

Todo o resto da tabela (categoria, poder oficial, alvo de cada golpe, descrição das animações) é **conhecimento prévio, não verificado nesta sessão**. Meu conhecimento prévio sobre categoria e alvo de golpes é sólido (dados estáveis desde a geração IV), mas a equipe deve tratá-lo como tal.

## 3. Características oficiais confirmadas

### 3.1 Regras gerais (oficiais)
- **Alvo** nos jogos principais é um dado de cada golpe. Os grupos que importam aqui:
  - **Único (1)**: um alvo escolhido.
  - **Todos os oponentes adjacentes (OA)**: "golpe de espalhamento" contra o lado inimigo (Heat Wave, Hyper Voice, Swift...).
  - **Todos os adjacentes (TA)**: inimigos **e aliado** (Surf, Discharge, Earthquake, Sludge Wave, Bulldoze). *Confirmado em busca nesta sessão.*
  - **Si mesmo / campo**: não se aplica aos golpes desta tabela.
- Golpe de espalhamento que atinge mais de um alvo causa **75%** do dano em cada um (geração IV em diante). *Confirmado em busca nesta sessão (guia de fãs).*
- Categoria física x especial é por golpe desde a geração IV.

### 3.2 Legenda da tabela
- **Forma**: `corpo` (corpo a corpo, contato), `corte` (arco curto à frente), `projétil` (viaja até um alvo e explode), `feixe` (linha contínua), `cone` (leque que abre a partir de quem ataca), `céu` (cai de cima sobre o alvo), `anel` (círculo ao redor de quem ataca), `no alvo` (área que nasce sob/sobre o alvo), `onda` (parede larga que varre), `investida` (corpo inteiro avança em linha e bate), `múltiplos` (vários impactos pequenos).
- **Alcance**: curto (≤ 2 u), médio (3–6 u), longo (≥ 7 u). 1 u = 1 quadrado do mapa.
- **Alvos oficiais**: 1, OA ou TA (ver 3.1).
- **Atual**: chave em `MOVE_FX_BY_NAME`. **Combina?** sim / parcial / **não**.
- **Poder**: oficial (geração IX) / valor no `SKILL_DATA`. Diferença marcada com `≠`.

### 3.3 Normal

| Golpe | Cat. | O que faz (resumo próprio) | Forma oficial | Alcance | Alvos | Poder of./jogo | Atual | Combina? |
|---|---|---|---|---|---|---|---|---|
| Investida / Tackle | Físico | arremessa o corpo contra o alvo | investida curta | curto | 1 | 40 / 40 (reserva) | strike | sim |
| Swift | Especial | dispara estrelas que nunca erram | múltiplos (leque de estrelas que perseguem) | médio-longo | **OA** | 60 / 60 | storm (círculo no alvo) | **parcial** |
| Cut | Físico | corta com garra/lâmina | corte | curto | 1 | 50 / 70 ≠ | slash | sim |
| Strength | Físico | soco/empurrão com força máxima | corpo | curto | 1 | 80 / 80 | strike | sim |
| Rock Climb | Físico | avança escalando contra o alvo; pode confundir | investida | curto-médio | 1 | 90 / 90 | strike | sim |
| Hyper Drill | Físico | gira uma parte pontuda como broca; ignora proteção | corpo | curto | 1 | 100 / 100 | strike | sim |
| Double-Edge | Físico | investida de corpo inteiro com recuo para quem ataca | investida | curto-médio | 1 | 120 / 120 | strike | sim |
| Hyper Voice | Especial | grito com ondas sonoras | cone | médio | **OA** | 90 / 140 ≠ | cone | sim |
| Hyper Beam | Especial | feixe enorme; quem ataca precisa recarregar | feixe | longo | 1 | 150 / 150 | beam | sim |

### 3.4 Fogo

| Golpe | Cat. | O que faz | Forma oficial | Alcance | Alvos | Poder | Atual | Combina? |
|---|---|---|---|---|---|---|---|---|
| Flame Wheel | Físico | envolve-se em fogo e rola contra o alvo | investida (roda de fogo) | curto-médio | 1 | 60 / 60 | strike | sim (falta o deslocamento) |
| Fire Punch | Físico | soco em chamas | corpo | curto | 1 | 75 / 75 | strike | sim |
| Blaze Kick | Físico | chute em chamas, crítico alto | corpo | curto | 1 | 85 / 85 | strike | sim |
| Heat Wave | Especial | sopro de ar escaldante sobre os inimigos | onda larga / cone largo | médio | **OA** | 95 / 95 | wave | sim |
| Fire Blast | Especial | rajada que se abre em estrela de fogo de cinco pontas no alvo | projétil → no alvo | longo | 1 | 110 / 110 | orb | sim |
| Flare Blitz | Físico | envolto em fogo, investe; recuo | investida | curto-médio | 1 | 120 / 120 | strike | sim |
| Overheat | Especial | descarga de fogo máxima num alvo; baixa muito o próprio Ataque Especial | feixe grosso / jato | médio-longo | **1** | 130 / 130 | cone (9 u, 60°) | **não** |
| Blast Burn | Especial | explosão de fogo que irrompe no alvo; recarga | no alvo (erupção) | longo | **1** | 150 / 150 | nova (anel de 5,5 u ao redor de quem ataca) | **não** |

### 3.5 Água

| Golpe | Cat. | O que faz | Forma oficial | Alcance | Alvos | Poder | Atual | Combina? |
|---|---|---|---|---|---|---|---|---|
| Water Pulse | Especial | pulso de água em forma de anel; pode confundir | projétil (anel) | médio-longo | 1 | 60 / 60 | orb | sim |
| Aqua Cutter | Físico | lâmina de água pressurizada; crítico alto | projétil-lâmina (sem contato) | médio | 1 | 70 / 70 | slash (cone de 2,5 u) | **parcial** |
| Scald | Especial | jato de água fervente; pode queimar | jato fino (feixe) | médio | **1** | 80 / 80 | cone (7,5 u, 55°) | **não** |
| Surf | Especial | grande onda que cobre o campo | onda larga | médio-longo | **TA** (confirmado) | 90 / 90 | wave | sim |
| Crabhammer | Físico | pinça desce como martelo; crítico alto | corpo | curto | 1 | 100 / 100 | strike | sim |
| Hydro Cannon | Especial | disparo de água colossal; recarga | feixe / bala enorme | longo | 1 | 150 / 110 ≠ | beam | sim |
| Wave Crash | Físico | envolto em água, choca o corpo contra o alvo; recuo | **investida** (contato) | curto-médio | **1** | 120 / 120 | wave (faixa 9 × 4 u) | **não** |
| Hydro Pump | Especial | jato de água em alta pressão | feixe | longo | 1 | 110 / 150 ≠ | beam | sim |

### 3.6 Elétrico

| Golpe | Cat. | O que faz | Forma oficial | Alcance | Alvos | Poder | Atual | Combina? |
|---|---|---|---|---|---|---|---|---|
| Shock Wave | Especial | choque rápido que nunca erra | raio horizontal de quem ataca ao alvo | médio | **1** | 60 / 60 | nova (anel de 3 u ao redor) | **não** |
| Thunder Punch | Físico | soco elétrico | corpo | curto | 1 | 75 / 75 | strike | sim |
| Discharge | Especial | descarga elétrica em todas as direções | anel ao redor | médio | **TA** (confirmado) | 80 / 80 | nova | sim |
| Thunderbolt | Especial | descarga forte contra o alvo; pode paralisar | raio (do corpo ao alvo; em vários jogos cai de cima) | médio-longo | 1 | 90 / 90 | bolt (céu sobre o alvo) | sim (ver 7) |
| Thunder | Especial | relâmpago que cai do céu; 70% de precisão | céu | longo | 1 | 110 / 110 | bolt | sim |
| Zap Cannon | Especial | bola elétrica lenta; sempre paralisa; 50% de precisão | projétil | médio-longo | 1 | 120 / 120 | orb | sim |
| Bolt Strike | Físico | envolto em eletricidade, investe com o corpo | **investida** (contato) | curto-médio | 1 | 130 / 130 | bolt (céu) | **não** |
| Electro Shot | Especial | acumula eletricidade (1 turno) e dispara feixe | feixe com carga | longo | 1 | 130 / 150 ≠ | beam | sim (falta a carga) |

### 3.7 Planta

| Golpe | Cat. | O que faz | Forma oficial | Alcance | Alvos | Poder | Atual | Combina? |
|---|---|---|---|---|---|---|---|---|
| Magical Leaf | Especial | folhas que perseguem o alvo e nunca erram | múltiplos (folhas teleguiadas) | médio | 1 | 60 / 60 | storm (círculo de 1,8 u no alvo) | **parcial** |
| Giga Drain | Especial | suga energia do alvo e recupera metade | **inverso**: partículas saem do alvo e vão a quem ataca | médio | 1 | 75 / 75 | orb | parcial (direção) |
| Seed Bomb | Físico | lança sementes duras que explodem (sem contato) | projétil | médio | 1 | 80 / 80 | orb | sim |
| Energy Ball | Especial | esfera de energia da natureza | projétil | longo | 1 | 90 / 90 | orb | sim |
| Leaf Blade | Físico | corta com folha afiada; crítico alto | corte | curto | 1 | 90 / 90 | slash | sim |
| Power Whip | Físico | chicoteia com vinhas/tentáculos | corte longo (chicote) | curto-médio | 1 | 120 / 120 | slash | sim |
| Leaf Storm | Especial | tempestade de folhas pontiagudas; baixa muito o próprio Ataque Especial | redemoinho que parte de quem ataca e envolve o alvo | médio | **1** | 130 / 130 | storm (círculo de 3 u no alvo) | parcial (área grande) |
| Frenzy Plant | Especial | raízes gigantes irrompem do chão sob o alvo; recarga | no alvo (do chão) | longo | 1 | 150 / 150 | nova@t | sim |

### 3.8 Inseto

| Golpe | Cat. | O que faz | Forma oficial | Alcance | Alvos | Poder | Atual | Combina? |
|---|---|---|---|---|---|---|---|---|
| Bug Bite | Físico | morde; come a fruta do alvo | corpo | curto | 1 | 60 / 60 | strike | sim |
| U-turn | Físico | bate e volta para trás (troca) | investida ida e volta | curto-médio | 1 | 70 / 70 | strike | sim (falta o recuo) |
| X-Scissor | Físico | cruza foices/garras em X | corte em X | curto | 1 | 80 / 80 | slash | sim |
| First Impression | Físico | ataque súbito, prioridade +2, só no 1º turno em campo | investida rápida | curto-médio | 1 | 90 / 90 | strike | sim |
| Bug Buzz | Especial | zumbido em vibração sonora; pode baixar Defesa Especial | onda sonora dirigida | médio | **1** | 90 / 100 ≠ | cone (7,5 u, 55°) | **parcial** |
| Attack Order | Físico | convoca subordinados que atacam; crítico alto | múltiplos (enxame desce no alvo) | médio | 1 | 90 / 110 ≠ | storm | sim |
| Pollen Puff | Especial | bola de pólen que explode no inimigo (cura se for aliado) | projétil | médio | 1 | 90 / 120 ≠ | orb | sim |
| Megahorn | Físico | investida com chifre | investida | curto-médio | 1 | 120 / 150 ≠ | strike | sim |

### 3.9 Veneno

| Golpe | Cat. | O que faz | Forma oficial | Alcance | Alvos | Poder | Atual | Combina? |
|---|---|---|---|---|---|---|---|---|
| Venoshock | Especial | líquido venenoso; dobra o dano em alvo envenenado | projétil (jato/gota) | médio | 1 | 65 / 65 | orb | sim |
| Cross Poison | Físico | corte em cruz envenenado; crítico alto | corte em X | curto | 1 | 70 / 70 | slash | sim |
| Poison Jab | Físico | estocada com tentáculo/braço venenoso | corpo | curto | 1 | 80 / 80 | strike | sim |
| Sludge Bomb | Especial | arremessa lama tóxica | projétil (arco) → respingo | médio-longo | 1 | 90 / 90 | orb | sim |
| Sludge Wave | Especial | onda de lama que inunda ao redor | **anel ao redor** (inunda) | médio | **TA** (confirmado) | 95 / 95 | wave (faixa à frente) | **parcial** |
| Noxious Torque | Físico | investida de motor (Starmobile); pode envenenar | investida | curto-médio | 1 | 100 / 100 | strike | sim |
| Belch | Especial | arroto de gás; só depois de comer fruta | rajada de gás curta | curto-médio | **1** | 120 / 120 | cone (9 u, 60°) | **parcial** |
| Gunk Shot | Físico | arremessa lixo imundo (sem contato); 80% de precisão | projétil pesado (arco) | médio | 1 | 120 / 150 ≠ | orb | sim |

### 3.10 Voador

| Golpe | Cat. | O que faz | Forma oficial | Alcance | Alvos | Poder | Atual | Combina? |
|---|---|---|---|---|---|---|---|---|
| Wing Attack | Físico | golpeia com as asas abertas | corpo (asa) | curto | 1 | 60 / 60 | strike | sim |
| Air Slash | Especial | lâmina de ar cortante; pode amedrontar | projétil-lâmina | médio | **1** | 75 / 75 | slash (cone de 2,5 u) | **não** (alcance) |
| Fly | Físico | sobe no 1º turno, mergulha no 2º | **queda do céu** (mergulho) | médio-longo | 1 | 90 / 90 | strike | parcial |
| Aeroblast | Especial | vórtice de ar em feixe; crítico alto | feixe | longo | 1 | 100 / 100 | beam | sim |
| Hurricane | Especial | ventania que envolve o alvo; 70% de precisão; confunde | redemoinho no alvo | longo | 1 | 110 / 110 | storm | sim |
| Brave Bird | Físico | mergulho de asas fechadas; recuo | investida (mergulho em linha) | médio | 1 | 120 / 120 | strike | sim |
| Dragon Ascent | Físico | sobe ao céu e cai em investida | queda + investida | médio-longo | 1 | 120 / 130 ≠ | strike | parcial |
| Sky Attack | Físico | acumula luz por um turno e investe; crítico alto | investida com carga | médio-longo | 1 | 140 / 150 ≠ | strike | sim (falta a carga) |

## 4. Referências visuais (descritas em texto)

*Conhecimento prévio, não verificado nesta sessão.* Como os golpes aparecem nos jogos 3D (X/Y até Scarlet/Violet), em resumo:
- **Espalhamento (OA/TA)**: o efeito cobre visivelmente os dois oponentes. Surf é uma onda alta que nasce atrás de quem ataca e passa por cima do lado inimigo; Discharge são arcos elétricos que saem do corpo em todas as direções; Heat Wave é uma cortina de ar quente alaranjado varrendo a frente; Hyper Voice são anéis sonoros concêntricos que se abrem para a frente; Swift são várias estrelas amarelas que fazem curva até cada alvo; Sludge Wave é lama roxa subindo em anel ao redor de quem ataca.
- **Único à distância**: um elemento claro viaja até um alvo (bola, jato, lâmina). Overheat é um jato de fogo branco-alaranjado muito intenso em linha; Scald é um jato fino de água com vapor; Air Slash e Aqua Cutter são lâminas em meia-lua que voam até o alvo.
- **Do céu / do chão no alvo**: Thunder (raio vertical), Frenzy Plant e Blast Burn (irrompem do chão no alvo).
- **Investidas**: o corpo de quem ataca avança, envolto no elemento (Flame Wheel, Flare Blitz, Wave Crash, Bolt Strike), bate e volta.

## 5. Recomendações para implementação 3D

### 5.1 Regra geral para hordas (decisão criativa do projeto, apoiada no dado oficial de alvo)
1. **Golpes OA/TA são os golpes de área de verdade.** Use áreas grandes (anel, cone, onda). Opcional: multiplicar o dano por 0,75 quando atinge mais de 1 inimigo (regra oficial) — decisão do `gameplay-developer`/`economy-balancing`.
2. **Golpes de alvo único** podem ter área pequena em hordas (para não ficarem inúteis), mas **pequena**: círculo r ≤ 1,2 u no alvo, ou faixa estreita (largura ≤ 1,0 u) que perfura em linha. Nunca maior que um golpe de espalhamento de poder parecido.
3. **TA atinge aliados** nos jogos. No modo de hordas sem aliados do jogador, ignore; se houver aliados controlados pela IA, decida se recebem dano (recomendo não, por diversão).
4. **Investidas** (contato que avança) deveriam mover quem ataca: deslocamento de 1,5–3 u na direção do alvo em 0,15–0,25 s, e a área é um círculo r 1,0 no ponto de chegada (ou uma faixa curta 3 × 1,2 u ao longo do caminho, que é ótimo em hordas).

### 5.2 Discrepâncias e correções em `js/fx/move-fx.js` (da mais grave para a menos grave)

| # | Golpe (linha) | Atual | Problema | Correção sugerida |
|---|---|---|---|---|
| 1 | **Blast Burn** (l. 32) | `nova` = anel r 5,5 **ao redor de quem ataca** | oficial é alvo único; a explosão nasce **no alvo** | `'Blast Burn': 'nova@t'` (r 2,6 no alvo) |
| 2 | **Wave Crash** (l. 33) | `wave` = faixa 9 × 4–5 u | oficial é investida de contato, alvo único; o nome "wave" engana a palavra-chave | `'Wave Crash': 'strike'` (ideal: investida com deslocamento, ver 5.1.4) |
| 3 | **Bolt Strike** (l. 34) | `bolt` = raio do céu | oficial é investida física de contato envolta em eletricidade | `'Bolt Strike': 'strike'` (com faíscas no rastro) |
| 4 | **Shock Wave** (l. 34) | `nova` = anel r 3 ao redor | oficial é alvo único que nunca erra; não é onda ao redor | `'Shock Wave': 'bolt'` desenhado como raio horizontal de quem ataca ao alvo, ou `'orb'` rápido (r 1,2) |
| 5 | **Overheat** (l. 32) | `cone` 9 u × 60° | oficial é alvo único; é o golpe de fogo especial mais concentrado | `'Overheat': 'beam'` (faixa 12 × 1,3, cor quase branca no miolo) |
| 6 | **Scald** (l. 33) | `cone` 7,5 u × 55° | oficial é jato único e fino | `'Scald': 'beam'` (faixa 9–10 × 0,6–0,9, com vapor) |
| 7 | **Air Slash** (l. 40) | `slash` = cone de 2,5–3 u | é lâmina de ar que **voa** até o alvo (especial, à distância); como corte, o Pokémon precisa encostar | novo formato `blade` (projétil fino em meia-lua: faixa 7 × 0,8 u) ou `'beam'` estreito |
| 8 | **Aqua Cutter** (l. 33) | `slash` = cone de 2,5 u | idem: lâmina de água lançada (sem contato) | igual ao Air Slash |
| 9 | **Sludge Wave** (l. 38) | `wave` = faixa à frente | oficial atinge todos ao redor (TA), lama sobe em anel | `'Sludge Wave': 'nova'` (r 4 ao redor) |
| 10 | **Swift** (l. 31) | `storm` = círculo no alvo | oficial atinge todos os oponentes (OA) com estrelas teleguiadas | `'Swift': 'cone'` (6,5 u × 60°) desenhado como 5–7 estrelas que fazem curva; ou novo formato `volley` |
| 11 | **Bug Buzz** (l. 42) | `cone` 7,5 u × 55° | oficial é alvo único | manter `cone`, mas é **decisão criativa**; se quiser fiel: cone estreito 30° × 6 u |
| 12 | **Belch** (l. 38) | `cone` 9 u × 60° | oficial é alvo único, rajada curta | cone curto 4 u × 40° (decisão criativa) ou `orb` |
| 13 | **Fly / Dragon Ascent** (l. 40) | `strike` | ambos têm subida e **queda do céu** | manter área `strike`, mas a animação deve subir 3–4 u e cair no alvo (0,6 s) |
| 14 | **Giga Drain** (l. 35) | `orb` | a energia vai **do alvo para quem ataca** | manter área; inverter a direção das partículas verdes e terminar com brilho de cura em quem ataca |
| 15 | **Magical Leaf** (l. 35) / **Leaf Storm** (l. 35) | `storm` | Magical Leaf é alvo único com folhas teleguiadas; Leaf Storm é único mas é o grande golpe de folhas | Magical Leaf → `orb` (r 1,2) com 6–8 folhas em curva; Leaf Storm pode ficar `storm` (decisão criativa: tempestade de folhas) |

Golpes **sem entrada** em `MOVE_FX_BY_NAME`: nenhum dos 64 desta tabela; todos têm regra própria. Investida/Tackle (l. 30) está correto.

### 5.3 Poderes diferentes do oficial (informação para `economy-balancing`, não é erro de visual)
`Cut` 50→70, `Hyper Voice` 90→140, `Hydro Cannon` 150→110, `Hydro Pump` 110→150, `Electro Shot` 130→150, `Bug Buzz` 90→100, `Attack Order` 90→110, `Pollen Puff` 90→120, `Megahorn` 120→150, `Gunk Shot` 120→150, `Dragon Ascent` 120→130, `Sky Attack` 140→150. O comentário de `SKILL_DATA` (l. 309) diz "poder referente ao oficial"; a escada de 8 níveis em ordem crescente obrigou ajustes. Isso **muda o nível de área** (`moveFxTier`): Hyper Voice e Hydro Pump ganham a área de nível 2 (≥ 110) que oficialmente não teriam. Se a fidelidade da área importar mais, a área pode usar o poder oficial; registro como decisão do projeto.

### 5.4 Cores (atuais servem; ajustes pequenos)
As cores de `MOVE_FX_COLORS` (l. 15–22) estão coerentes. Sugestões: Swift com amarelo-estrela `#ffe95a` (não o bege do tipo Normal); Overheat com miolo `#ffffff` e borda `#ff5a00`; Scald com vapor branco `#f0f6ff` a 40% de opacidade; Sludge Wave com roxo mais escuro `#7a3a9a`.

## 6. Grau de confiança

**Médio-alto.** Categoria e alvo dos golpes clássicos (gerações I–V) são dados que conheço bem e que pouco mudaram; o grupo TA (Surf, Discharge, Sludge Wave, Earthquake, Bulldoze) foi **confirmado em busca** nesta sessão, e Heat Wave como espalhamento também. **Médio** para os golpes da geração IX (Aqua Cutter, Hyper Drill, Electro Shot, Noxious Torque, Wave Crash) e para Swift/Hyper Voice (não confirmados na busca). Descrições das animações: **médio** (conhecimento prévio). As correções são **decisão criativa** apoiada no dado de alvo.

## 7. Diferenças entre versões

- **Swift**: nas gerações I–II atinge um alvo; da III em diante, todos os oponentes adjacentes.
- **Categoria**: até a geração III a categoria vinha do tipo (todo Fogo/Água/Elétrico/Planta era especial; Normal/Voador/Veneno/Inseto, físico). Fire Punch e Thunder Punch eram especiais e Hyper Beam/Swift/Hyper Voice físicos nessa época. Usar a regra da geração IV+.
- **Poderes** que mudaram: Tackle 35 (I–IV) → 50 (V–VI) → 40 (VII+); Thunderbolt 95→90, Thunder 120→110, Fire Blast 120→110, Hydro Pump 120→110, Surf 95→90, Heat Wave 100→95, Hurricane 120→110, Overheat 140→130, Leaf Storm 140→130, Energy Ball 80→90, Giga Drain 60→75, Bug Buzz 90, Pollen Puff 90 (desde a VII).
- **Thunderbolt** visual: em vários jogos 3D o raio sai do corpo e vai horizontal até o alvo; em outros cai de cima. No anime, sai sempre do corpo de Pikachu. **Recomendação**: manter `bolt` (céu) para Thunder e desenhar Thunderbolt como zigue-zague horizontal do corpo ao alvo com respingo no alvo — distingue os dois golpes e o anime é a imagem mais conhecida. Área atual (círculo no alvo) pode ficar.
- **Fire Blast**: a forma de "estrela de cinco pontas" (no Japão, o ideograma 大) vem dos jogos e do anime desde a geração I; é a assinatura do golpe.
- **Surf** no anime é uma onda em que quem ataca "surfa" por cima; nos jogos 3D a onda nasce atrás de quem ataca. As duas cabem no formato `wave`.
