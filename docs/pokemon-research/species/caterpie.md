# Caterpie (#010) · Inseto

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Lagarta verde, o Pokémon mais comum da Floresta de Viridian. Corpo em segmentos, cabeça grande com "olhos" pretos enormes, antena vermelha bifurcada em cima da cabeça. Primeiro estágio: Caterpie → Metapod (Nv 7) → Butterfree (Nv 10).

## 2. Fontes consultadas

- Busca: Pokémon Database e Dittobase (resumos) → **0,3 m e 2,9 kg** (verificado nesta sessão).
- Busca: tabelas de encontro da floresta (ver `regions/viridian-forest.md`).
- Pokédex oficial, Bulbapedia: **bloqueados**. Texto de Pokédex e aparência: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,3 m / 2,9 kg | verificado (busca) |
| Tipo | Inseto | oficial e no jogo |
| Evolução | Metapod no Nv 7, Butterfree no Nv 10 | oficial; igual no `pokemon-data.js` |
| Habilidade | Shield Dust | conhecimento prévio |
| Golpes de nível baixo | Tackle (Investida), String Shot (Fio), Bug Bite | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): pés curtos com ventosas que sobem em qualquer superfície; quando atacado, a antena vermelha solta um cheiro forte que afasta inimigos; come muito, folhas maiores que ele.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: corpo em "S" baixo — a cabeça levantada à frente, a cauda levantada atrás, meio do corpo no chão; **antena vermelha em "Y"** no topo da cabeça.
- Cabeça é o maior segmento, com dois olhos pretos grandes (círculo preto com anel branco/amarelado).
- Laterais: um círculo amarelo-creme em cada segmento (manchas tipo espiráculos).
- Barriga creme; pezinhos curtos rosados/creme.
- Ponta da cauda com um pequeno "gancho" curvo.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,3 = **0,73 u** (altura com a cabeça erguida). Comprimento total ≈ 1,3 H.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça (diâmetro) | 0,46 |
| Segmentos do corpo (4) | diâmetros 0,38 → 0,34 → 0,30 → 0,24 |
| Antena (altura) | 0,22 |
| Comprimento total (Z) | 1,30 |

### Cores
| Parte | Hex |
|---|---|
| Corpo/cabeça | `#7CC24E` |
| Barriga e pés | `#F0E3A8` |
| Manchas laterais | `#F5D96A` |
| Antena | `#E0453A` |
| Olhos | `#1E1E1E` com anel `#F4F0D0` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Cabeça | esfera | (0,23, 0,23, 0,22) | (0, 0,52, 0,40) | verde |
| 2 | Segmento 1 | esfera | 0,19 | (0, 0,30, 0,18) | verde |
| 3 | Segmento 2 | esfera | 0,17 | (0, 0,18, −0,05) | verde |
| 4 | Segmento 3 | esfera | 0,15 | (0, 0,20, −0,28) | verde |
| 5 | Segmento 4 (cauda) | esfera | 0,12 | (0, 0,32, −0,46) | verde |
| 6 | Gancho da cauda | cone(0,05, 0,14) | — | (0, 0,44, −0,52), inclinado 30° para trás | verde |
| 7–8 | Olhos | esfera (0,08, 0,09, 0,03) + anel = esfera 0,095 creme atrás | — | (±0,13, 0,58, 0,58) | preto/creme |
| 9 | Haste da antena | cil(0,02, 0,12) | — | (0, 0,78, 0,40) | vermelho |
| 10–11 | Pontas do "Y" | cone(0,025, 0,10) | — | (±0,04, 0,88, 0,40), ±30° em Z | vermelho |
| 12–15 | Manchas laterais | esfera achatada (0,01, 0,05, 0,05) | — | uma por segmento, nos dois lados (x = ±raio do segmento) | amarelo |
| 16 | Barriga | esfera achatada (0,14, 0,05, 0,40) | — | (0, 0,06, 0) | creme |
| 17–22 | Pés | esfera 0,035 | — | 3 pares sob os segmentos 1–3 (y 0,03) | creme |

~22 malhas, 4 materiais. Para hordas com 30+ Caterpie, usar `InstancedMesh` por parte (todas as cabeças num só draw call, etc.).

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | cabeça oscila ±6° em X a 0,8 Hz; antena vibra ±5° a 3 Hz; segmentos "respiram" com fase defasada (escala 1 ± 0,03, fase +0,6 rad por segmento) |
| Rastejar | **onda peristáltica**: para cada segmento i, `y_i += 0,06 H × max(0, sin(ωt − 1,2 i))`, ω = 2π × 1,6 Hz; o corpo avança só quando a onda passa (velocidade média 0,8 u/s). Cabeça balança ±4° em Y |
| Ataque físico (Investida) | 0,0–0,15 s: encolhe (Z 0,85); 0,15–0,27 s: avança 0,8 u esticando (Z 1,15); volta em 0,25 s |
| Fio (String Shot) | cabeça ergue 15°, sai uma linha branca `#F4F4F4` (cil r 0,02 u) da boca até o alvo em 0,3 s; o fio fica 1,5 s e enrola o alvo com 2–3 toros brancos |
| Defesa (cheiro da antena) | antena levanta e incha (escala 1,4) por 0,4 s, soltando 6 partículas lilás-claras `#E6D8F0` |
| Dano | o corpo inteiro "chicoteia": rot Y ±12° amortecida em 0,3 s, piscar branco |
| Desmaio | vira de barriga para cima (rot Z 180° em 0,4 s), segmentos ficam parados, encolhe em 0,5 s |

### Combate e IA (modo hordas)
- **Arquétipo: enxame lento que prende** (bucha de canhão com controle).
- Velocidade 0,8 u/s; HP baixo; vem em grupos de 4–8.
- A cada 4 s, se estiver a ≤ 4 u do jogador, lança **Fio**: linha reta de 4 u × 0,4 u; ao acertar, reduz a velocidade do jogador em 30% por 2 s (acumula até −60% com vários fios: é o perigo real do enxame).
- Ao levar dano abaixo de 50% de HP: 1 vez solta "cheiro" (círculo r = 1,0 u que empurra o jogador 0,5 u).
- Justificativa: String Shot é o golpe-assinatura dos casulos de inseto nos jogos; Pokédex do cheiro da antena.

## 6. Grau de confiança

**Alto** para altura/peso, tipo, evolução e silhueta. **Médio** para cores e proporções (memória da arte oficial).

## 7. Diferenças entre versões

- G1: corpo mais curto e cabeça desproporcional; arte moderna mais limpa, mesma paleta.
- Anime: Caterpie do Ash fala de "virar uma linda Butterfree" e usa Fio o tempo todo — reforça o arquétipo.
- Projeto: segue a evolução oficial (7 e 10).
