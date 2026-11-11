# Floresta de Viridian (Viridian Forest), Kanto

> Para: `game-3d-engineer` (mapa), `art-animation-3d` (ambiente), `gameplay-developer` (hordas), `economy-balancing` (pesos e raridade).
> Rota do jogo: `kanto_viridian_forest` (`js/route-data.js`, linhas 57–69) · mapa Explorar: `explore_forest` (`js/explore/explore-core.js`, linha 476).

## 1. Descrição

Floresta densa entre a Cidade de Viridian (sul) e a Cidade de Pewter (norte), atravessada pela Rota 2. Nos jogos é o primeiro "labirinto" do jogador: corredores estreitos de árvores, muito capim alto, Caçadores de Insetos (Bug Catchers) parados no caminho e placas com dicas para treinadores. É o habitat-símbolo dos Pokémon Inseto de Kanto e um dos poucos lugares de Kanto onde Pikachu é encontrado na natureza.

## 2. Fontes consultadas

Situação da rede nesta sessão: **`WebFetch` bloqueado pelo proxy para todos os domínios testados** (bulbapedia.bulbagarden.net, pokemon.com, pokeapi.co, serebii.net, veekun.com, strategywiki.org). **`WebSearch` funcionou** e devolveu resumos das páginas abaixo (não abri as páginas inteiras; li o resumo do buscador).

| Fonte | Tipo | O que foi lido nesta sessão |
|---|---|---|
| StrategyWiki, Pokémon Red and Blue/Viridian Forest | enciclopédia de fãs | resumo: taxas e níveis de Red/Blue |
| GameFAQs, guia de Pokémon Red (Viridian Forest) | guia de fãs | resumo: Weedle 45% Nv 3–5, Kakuna 40% Nv 4–6 (Red) |
| Wikibooks, Pokémon Red and Blue/Encounter Rates | enciclopédia aberta | resumo: Blue com Caterpie 50% e Metapod 35% |
| altissimo1.github.io (Kanto Locations / Viridian Forest) | tabela de fãs | resumo: Yellow com Caterpie 50%, Metapod 25%, Pidgey 24%, Pidgeotto 1% Nv 9 |
| rankedboost.com (Yellow, FRLG, Let's Go) | guia de fãs | resumo: Yellow sem Weedle/Kakuna/Pikachu |
| GamerGuides, Let's Go walkthrough e "rare spawns" | guia comercial | resumo: Pikachu, Pidgey, Caterpie, Weedle; Butterfree só em Let's Go Pikachu, Beedrill só em Let's Go Eevee; Bulbasaur como aparição rara |
| Giant Bomb, Viridian Forest | wiki de fãs | resumo: em FRLG Caterpie e Weedle igualmente comuns; evoluções com raridade por versão |
| Bulbapedia (página de Viridian Forest) | enciclopédia de fãs | **não abriu** (bloqueio); só o título apareceu na busca |
| pockettactics / dittobase (Paras) | guias de fãs | resumo: Paras fica em Mt. Moon e Safari Zone (Red/Blue/Yellow/FRLG), não na floresta |
| altissimo1 / pokestop.io (HeartGold/SoulSilver) | tabelas de fãs | resumo parcial: árvores de Cabeçada (Headbutt) com Butterfree, Beedrill e Pidgey |

Fontes oficiais (pokemon.com, Pokédex dos jogos): **não puderam ser abertas**. Descrições do ambiente e do anime vêm de **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

### 3.1 Espécies por jogo (rotulado por versão)

| Jogo (geração) | Comuns | Incomuns | Raros | Níveis | Verificação |
|---|---|---|---|---|---|
| **Red** (G1) | Weedle (~45%), Kakuna (~40%) | Caterpie (~5%), Metapod (~5%) | Pikachu (5%) | 3–6 | busca (StrategyWiki, GameFAQs) |
| **Blue** (G1, ocidental) | Caterpie (~45–50%), Metapod (~35–40%) | Weedle (~5%), Kakuna (~5%) | Pikachu (5%) | 3–6 | busca (Wikibooks, StrategyWiki) |
| **Yellow** (G1) | Caterpie (~50%), Metapod (~25%), Pidgey (~24%) | — | Pidgeotto (~1%, Nv 9) | 3–9 | busca (altissimo1; fonte única, números aproximados) |
| **FireRed / LeafGreen** (G3) | Caterpie e Weedle (iguais) | Metapod / Kakuna (raridade invertida por versão) | Pikachu (raro) | 3–6 | busca (Giant Bomb, rankedboost); taxas exatas não confirmadas |
| **HeartGold / SoulSilver** (G4) | Caterpie, Weedle, Metapod, Kakuna (capim) | Pidgey/Pidgeotto | Butterfree, Beedrill (árvores de Cabeçada) | variados | **parcial**: a busca confirmou só as árvores de Cabeçada; a lista do capim é conhecimento prévio |
| **Let's Go Pikachu / Eevee** (G7) | Caterpie, Weedle, Pikachu, Pidgey | Metapod, Kakuna | Butterfree (só LGP), Beedrill (só LGE), Bulbasaur (aparição rara) | 3–6 | busca (GamerGuides; fonte única para a lista; Pikachu selvagem lá é conhecimento prévio) |

Pontos firmes (várias fontes concordam):
- **Insetos de casulo dominam**: as linhas Caterpie→Metapod→Butterfree e Weedle→Kakuna→Beedrill são o núcleo da floresta em todas as versões.
- **Pikachu é o raro "estrela"** (5% em Red/Blue); some no Yellow porque o jogador já começa com ele.
- **Aves (Pidgey/Pidgeotto)** entram a partir de Yellow.
- **Paras não vive na Floresta de Viridian** em nenhum jogo principal consultado: fica em Mt. Moon e na Safari Zone.
- **Rattata, Bulbasaur, Charmander, Squirtle e Raichu** não são selvagens comuns aqui. Bulbasaur aparece só como aparição rara em Let's Go (confirmado por busca, uma fonte destoa).

### 3.2 Pokédex dos habitantes (conhecimento prévio, não verificado nesta sessão)
- Beedrill: muito territorial; ataca **em enxame** quem se aproxima do ninho.
- Kakuna e Metapod: quase imóveis; a única defesa é **endurecer** a casca.
- Caterpie: come folhas maiores que ele; as antenas soltam um **cheiro** que afasta predadores.
- Weedle: ferrão venenoso de cerca de 5 cm na cabeça; vive em florestas e capim alto.
- Pikachu: vive em florestas; vários juntos acumulam eletricidade e podem causar tempestades de raios.

## 4. Referências visuais (descritas em texto)

**Jogos 2D (G1, G3):** visto de cima, a floresta é uma grade de árvores redondas, quase sem céu, com corredores de 1 a 3 quadrados entre "paredes" de árvores e manchas grandes de capim alto. O caminho serpenteia do sul ao norte. No G3 o chão é verde-escuro com trilhas de terra clara.

**Let's Go (G7, 3D):** câmera alta e inclinada. Os Pokémon selvagens **andam visíveis** pelo capim (não há encontro aleatório escondido). Luz quente filtrada pela copa, árvores grandes de tronco grosso, raízes à mostra, cogumelos, tocos, pequenos fachos de luz no chão. Cores saturadas, nada sombrio.

**Anime (episódio 3 da 1ª temporada, conhecimento prévio):** Ash captura um Caterpie, que evolui para Metapod. Um **enxame de Beedrill** sai das árvores para defender os Kakuna e persegue o grupo: é a primeira "horda" da série e a referência mais forte para o modo de hordas. No episódio seguinte, Metapod duela com outro Metapod usando só Endurecer (Harden).

**Mangá Pokémon Adventures (conhecimento prévio):** a floresta é quase mística; quem nasce nela pode ouvir os Pokémon. Interessante como clima, não como regra.

**Atmosfera para o projeto:**
- Luz: sol filtrado, verde-amarelada no chão; fachos de luz em clareiras.
- Vegetação: árvores de copa redonda e densa (folhagem `#2f7a32` a `#3f9a3c`, tronco `#6b4a2b`), capim alto `#4fa83a` com pontas `#8fd04f`, arbustos, flores pequenas brancas e amarelas, cogumelos vermelhos com pintas (eco de Paras), tocos, troncos caídos.
- Relevo: quase plano, com pequenos desníveis e raízes; nada de penhascos. Trilha de terra `#b08a55`.
- Som: insetos, pássaros, folhas; o zumbido de Beedrill como aviso de perigo.

## 5. Recomendações para implementação 3D

### 5.1 Coerência da rota atual (`js/route-data.js`, linhas 61–68)

| id | Espécie | Peso no jogo | Coerente? | Comentário |
|---|---|---|---|---|
| 10 | Caterpie | 25 | Sim | comum em todas as versões |
| 13 | Weedle | 25 | Sim | comum em Red, FRLG, Let's Go |
| 46 | **Paras** | 25 | **Não** | não aparece na floresta em nenhum jogo consultado (Mt. Moon / Safari Zone) |
| 11 | Metapod | 10 | Sim | |
| 14 | Kakuna | 10 | Sim | |
| 25 | Pikachu | 5 | Sim | igual ao 5% oficial de Red/Blue |

Faltam **Pidgey** (Yellow, Let's Go) e as formas finais **Butterfree / Beedrill** (HGSS, Let's Go). Os níveis do jogo (11–15) são maiores que os oficiais (3–6): é decisão de progressão do projeto e está ok.

**Recomendação para `economy-balancing`** (decisão do projeto, não obrigatória): trocar Paras (25) por Pidgey (15) e redistribuir: Caterpie 25, Weedle 25, Pidgey 15, Metapod 12, Kakuna 12, Pikachu 5, Butterfree 3, Beedrill 3. Se quiserem manter Paras por variedade de tipo (Inseto/Planta), baixem para peso 5 e registrem como decisão criativa (o cogumelo de Paras combina visualmente com a floresta, mas não é oficial aqui).

### 5.2 Composição de hordas (modo F12)

Uma "onda" = 12 a 40 selvagens. Proporção por onda:

| Faixa | Espécies | % da onda | Papel |
|---|---|---|---|
| Comum | Caterpie, Weedle | 60% (30% cada) | enxame de base, lento e numeroso |
| Incomum | Metapod, Kakuna, Pidgey | 30% (10% cada) | casulos que bloqueiam / aves que mergulham |
| Raro | Pikachu, Butterfree, Beedrill | 8% | perigo pontual (Beedrill rápido, Butterfree com pó, Pikachu com descarga) |
| Muito raro | Bulbasaur (eco de Let's Go) | ≤ 2% | presente para caça, não para combate |

Regras de cena coerentes com a Pokédex:
- **Casulos (Metapod/Kakuna) não andam**: nascem já posicionados, em grupos de 3–6 pendurados ou no chão perto das árvores (`T`), e servem de obstáculo.
- **Enxame cresce perto dos Kakuna**: se o jogador derrota Kakuna, há chance de surgir Beedrill (eco do anime e da Pokédex: Beedrill defende o ninho).
- **Pidgey entra pelas clareiras** (áreas sem `T`), em bandos de 2–4.
- **Pikachu foge** se a onda estiver no fim (Pokédex: arisco); aparece sozinho ou em dupla.

### 5.3 Elites e chefe

| Papel | Espécie | Por quê (fidelidade) | Comportamento sugerido |
|---|---|---|---|
| **Elite 1** | **Butterfree** (1,5× tamanho) | aparece na floresta em HGSS (Cabeçada) e Let's Go Pikachu; Pokédex: pó tóxico nas asas | voa a 1,2 u do chão, mantém 4–5 u de distância, solta nuvem de pó (círculo r = 2,0 no chão, 3 s) que deixa lento ou adormece |
| **Elite 2** | **Pidgeotto** (1,3×) | raro (1%) na floresta em Yellow; dica de "Pidgeotto de nível baixo" na floresta | circula a 2 u de altura e mergulha em linha (3–6 u) a cada 4 s; usa Rajada (Gust) que empurra 1 u |
| **Chefe** | **Beedrill Alfa** (2,0×, olhos vermelhos brilhando, aura vermelha) | o enxame de Beedrill é a cena mais famosa da floresta (anime ep. 3) e a Pokédex fala de ataque em enxame | invoca 4–6 Beedrill a cada 15 s, faz investidas em linha com os dois ferrões (Fúria Dupla/Twineedle) e Míssil de Ferrão (Pin Missile) em leque de 5 projéteis |

Alternativa (menos fiel, **decisão criativa**): **Raichu "guardião"** como chefe evento. Raichu não é selvagem na floresta em nenhum jogo consultado; só use se o projeto quiser um chefe elétrico ligado ao Pikachu raro, e registre como invenção.

O "alfa" (maior, olhos vermelhos, mais agressivo) vem de Pokémon Legends: Arceus; ver `battle-reference/action-hordes.md`.

### 5.4 Ambiente para o mapa `explore_forest`
- Copa: `canopy: 0.62` está coerente (floresta fechada). Para hordas, deixar **clareiras de 6×6 a 10×10** para o combate; o corredor de 3 de largura (`ppp`) serve de "gargalo" tático.
- Árvores: tronco cilindro r 0,18–0,25 u, altura 1,2–1,8 u; copa 2–3 esferas sobrepostas r 0,7–1,1 u (tons `#2f7a32`, `#3a8a36`, `#4a9a40`), variação de ±10% em tamanho e cor por árvore.
- Luz: direcional quente `#fff1c8` intensidade 0,9 vinda de ~60° de altura; hemisférica céu `#cfe8ff` / chão `#3a5a2a`; névoa linear verde-acinzentada `#a8c79a` começando em 12 u.
- Fachos de luz (opcional, barato): planos aditivos amarelados `#fff6b0` com opacidade 0,08–0,15, inclinados.
- Partículas ambientes: 20–40 pontos amarelo-claros (pólen/vaga-lumes) flutuando devagar; à noite viram vaga-lumes verde-limão `#d8ff6a`.

## 6. Grau de confiança

**Médio-alto.** Espécies de Red/Blue/Yellow e a ausência de Paras foram confirmadas por várias fontes de fãs na busca. HGSS e Let's Go: **médio** (fontes únicas, resumo parcial). Atmosfera dos jogos 3D e anime: **médio** (conhecimento prévio). Elites e chefe são **decisão criativa** apoiada em fatos.

## 7. Diferenças entre versões

- Red × Blue: raridade de Caterpie e Weedle invertida (Red: Weedle comum; Blue: Caterpie comum).
- Yellow: tira Weedle, Kakuna e Pikachu; põe Pidgey e Pidgeotto.
- FRLG: Caterpie e Weedle iguais; evoluções seguem a versão.
- HGSS: entram árvores de Cabeçada com Butterfree/Beedrill.
- Let's Go: Pokémon visíveis no mapa; Pikachu selvagem nas duas versões; Butterfree (LGP) × Beedrill (LGE); Bulbasaur raro.
- Anime: enxame de Beedrill e Caterpie/Metapod de Ash. Mangá: floresta "mística".
- **Projeto** (recomendação): base em Red/Blue + Let's Go (insetos, Pikachu raro, Pidgey), enxame de Beedrill do anime como chefe. Motivo: é a imagem mais reconhecida da floresta e combina com hordas.
