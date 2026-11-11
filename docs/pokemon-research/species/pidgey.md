# Pidgey (#016) · Normal / Voador

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Passarinho marrom e creme, pequeno e rechonchudo, comuníssimo em Kanto. Na floresta aparece em Yellow e em Let's Go. Pidgey → Pidgeotto (Nv 18) → Pidgeot (Nv 36).

## 2. Fontes consultadas

- Busca: Wikidex (resumo) → **1,8 kg** (verificado). Altura 0,3 m: conhecimento prévio.
- Busca: Yellow (Pidgey ~24% na floresta) e Let's Go (Pidgey na floresta).
- Pokédex e aparência: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,3 m / 1,8 kg | peso verificado; altura conhecimento prévio |
| Tipo | Normal / Voador | oficial e no jogo |
| Evolução | Pidgeotto Nv 18, Pidgeot Nv 36 | oficial; igual no jogo |
| Habilidades | Keen Eye, Tangled Feet | conhecimento prévio |
| Golpes típicos | Tackle, Sand Attack, Gust, Quick Attack | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): dócil, prefere fugir a lutar; quando atacado, bate as asas para jogar areia no inimigo; comum em florestas e campos.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: pássaro gordinho, cabeça grande, **topete curto** de penas na testa e **cauda em leque**.
- Corpo marrom, peito e rosto creme, **máscara preta em volta dos olhos** que se estende para trás; bico cinza-rosado curto; pés rosados.
- Asas marrons com pontas mais escuras.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,3 = **0,73 u**.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça | 0,40 |
| Corpo | 0,50 (largura 0,50) |
| Asas (fechadas) | 0,40 × 0,20; envergadura aberta 1,4 H |
| Cauda | 0,25 |
| Pés | 0,10 |

### Cores
| Parte | Hex |
|---|---|
| Corpo, cabeça, asas | `#A7744A` |
| Peito, rosto, ponta da cauda | `#F1DCB0` |
| Máscara dos olhos | `#2A2420` |
| Bico, pés | `#D99A86` |
| Pontas das asas e topete | `#7A5232` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Corpo | esfera (0,25, 0,24, 0,26) | — | (0, 0,30, −0,02) | marrom |
| 2 | Peito | esfera (0,19, 0,19, 0,10) | — | (0, 0,30, 0,16) | creme |
| 3 | Cabeça | esfera 0,20 | — | (0, 0,66, 0,08) | marrom |
| 4 | Rosto | esfera (0,15, 0,12, 0,08) | — | (0, 0,62, 0,22) | creme |
| 5–6 | Máscara | caixa (0,12, 0,05, 0,02) | — | (±0,10, 0,68, 0,22), girada 15° para trás | preto |
| 7–8 | Olhos | esfera 0,025 branca + 0,018 preta | — | (±0,08, 0,69, 0,25) | |
| 9 | Bico | cone(0,04, 0,10) | — | (0, 0,62, 0,32), apontando para frente | bico |
| 10–12 | Topete | 3 cones(0,03, 0,12) | — | (0, 0,86, 0,10), abertos ±15° | marrom escuro |
| 13–14 | Asas | esfera achatada (0,05, 0,20, 0,16) com pivô no ombro | — | (±0,24, 0,34, −0,04) | marrom |
| 15 | Cauda | 3 caixas finas (0,08, 0,02, 0,25) em leque ±20° | — | (0, 0,22, −0,30), inclinada 20° para cima | marrom + ponta creme |
| 16–17 | Pés | cil(0,02, 0,06) + 3 dedos cone | — | (±0,08, 0,03, 0,02) | bico |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso (no chão) | cabeça vira em "trancos" (rot Y 0 → ±30° em 0,06 s, segura 0,8–1,5 s) como pássaro real; cauda abre/fecha a cada 3 s |
| Andar | pulinhos: 0,10 H de altura, 3 pulos/s, 0,9 u/s |
| Voar | asas abertas (rot Z ±70°) batendo `±60° × sin(2π·5t)`; corpo inclinado 20°; voo a 1,0–1,5 u; 2,2 u/s |
| Rajada (Gust) | para no ar, 2 batidas largas (0,15 s cada), corpo recua 0,1 u a cada batida |
| Ataque de Areia | no chão, as asas varrem para a frente; leque de 15 partículas `#C9A86A` num cone de 40°, 2 u |
| Ataque Rápido | linha de 3 u em 0,12 s com rastro branco; volta voando |
| Dano | penas soltas: 4 partículas planas marrons caem girando 0,8 s; recua 0,2 u |
| Desmaio | cai de costas, asas abertas no chão, pés para cima |

### Combate e IA (modo hordas)
- **Arquétipo: ave de assédio (mergulha e foge)**.
- Bando de 2–4 que entra pelas clareiras. Voa em círculo r 4 u em volta do jogador, a 1,2 u de altura.
- A cada 3 s um do bando mergulha (Ataque Rápido em linha de 3 u) e volta à altura.
- **Ataque de Areia** (a cada 6 s, cone de 40° × 2 u): reduz a precisão/alcance do jogador por 2 s (no modo ação: −25% no alcance dos golpes, ou visão turva na tela).
- Foge quando fica com < 30% de HP (Pokédex: prefere fugir).
- Imune a Terrestre. **Pidgeotto (Elite 2)** usa o mesmo esqueleto em 1,3× com crista longa vermelho-amarela e cauda vermelha (ver `regions/viridian-forest.md`).

## 6. Grau de confiança

**Médio-alto**.

## 7. Diferenças entre versões

- G1: arte mais "galinha"; moderno mais compacto. Mesma paleta.
- Anime: Ash captura um Pidgeotto na Rota 1/floresta (ep. 3) — e o Pidgeotto lutando contra Beedrill é a cena do enxame.
- Projeto: não está na rota hoje; recomendado incluir.
