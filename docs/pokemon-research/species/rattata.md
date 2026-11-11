# Rattata (#019) · Normal

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Rato roxo de dentes grandes, quadrúpede, rápido e comum em rotas de Kanto (Rotas 1, 2, 22 e outras). **Não é habitante oficial da Floresta de Viridian** nos jogos consultados; serve para rotas vizinhas e hordas genéricas.

## 2. Fontes consultadas

- Busca: Pokémon Database (resumo da lista de altura e peso) → **0,3 m e 3,5 kg** (verificado nesta sessão).
- Pokédex e aparência: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,3 m / 3,5 kg | verificado (busca) |
| Tipo | Normal (forma de Alola: Sombrio/Normal) | oficial |
| Evolução | Raticate Nv 20 | oficial; igual no jogo |
| Habilidades | Run Away, Guts | conhecimento prévio |
| Golpes típicos | Tackle, Tail Whip, Quick Attack, Bite, Hyper Fang | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): morde qualquer coisa; os incisivos crescem sem parar e precisam ser gastos roendo; cauteloso, sente o perigo pelas orelhas e bigodes; vive onde houver comida e se reproduz rápido.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: quadrúpede baixo com **orelhas grandes e redondas**, **dois dentões brancos** à mostra e **cauda longa enrolada em espiral** no fim.
- Corpo roxo, barriga creme; olhos vermelhos grandes; bigodes finos.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,3 = **0,73 u** (até o topo das orelhas). Comprimento sem cauda ≈ 1,0 H; cauda ≈ 0,9 H.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça | 0,45 |
| Corpo | altura 0,40, comprimento 0,60 |
| Orelhas | 0,22 (diâmetro) |
| Patas | 0,15 |
| Cauda | 0,90 (comprimento) |

### Cores
| Parte | Hex |
|---|---|
| Corpo | `#9A68AE` |
| Barriga, focinho, dentro das orelhas | `#F1E0B4` |
| Olhos | `#C8202E` com brilho branco |
| Dentes | `#FFFFFF` |
| Bigodes | `#5A3A6A` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Corpo | esfera (0,22, 0,20, 0,32) | — | (0, 0,26, −0,08) | roxo |
| 2 | Barriga | esfera (0,16, 0,10, 0,26) | — | (0, 0,14, −0,06) | creme |
| 3 | Cabeça | esfera (0,22, 0,21, 0,22) | — | (0, 0,46, 0,26) | roxo |
| 4 | Focinho | esfera (0,10, 0,08, 0,10) | — | (0, 0,40, 0,44) | creme |
| 5 | Nariz | esfera 0,02 | — | (0, 0,43, 0,54) | roxo escuro |
| 6–7 | Dentes | caixa (0,03, 0,08, 0,015) | — | (±0,018, 0,32, 0,50) | branco |
| 8–9 | Orelhas | cil(0,11, 0,02) achatado (disco) + disco creme menor na frente | — | (±0,15, 0,72, 0,20), rot Z ±25° | roxo/creme |
| 10–11 | Olhos | esfera 0,05 | — | (±0,10, 0,52, 0,42) | vermelho |
| 12–17 | Bigodes | cil(0,004, 0,14) | — | 3 por lado, saindo do focinho a ±20° | bigode |
| 18–21 | Patas | esfera (0,05, 0,07, 0,06) | — | (±0,12, 0,06, 0,12) e (±0,12, 0,06, −0,26) | roxo |
| 22 | Cauda | `TubeGeometry` sobre curva: reta 0,6 H para trás e para cima, depois espiral de 1 volta r 0,08 H; r do tubo 0,02 H | — | sai de (0, 0,24, −0,38) | roxo |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | fareja: focinho vibra (Z ±0,01 H a 8 Hz) em rajadas de 0,5 s; orelhas giram ±10° alternadas; cauda balança |
| Correr | galope: patas da frente e de trás em pares, fase 180°; corpo arqueia (escala Z 0,9 ↔ 1,1) a 5 Hz; quique 0,06 H; 3,0 u/s |
| Ataque Rápido | linha de 4 u em 0,15 s, rastro branco |
| Hiper Presa (mordida) | pulo curto (0,25 H de altura, 0,25 s) até o alvo; cabeça desce 20° na chegada; 2 "cortes" brancos verticais no alvo |
| Dano | encolhe e salta para trás 0,3 u |
| Desmaio | cai de lado, patas esticadas, cauda desenrola (escala da espiral até 0) |

### Combate e IA (modo hordas)
- **Arquétipo: enxame rápido de mordida (corredor)**.
- 3,0 u/s, frágil, dano alto por mordida (Hyper Fang: poder 80). Grupos de 5–10 que chegam juntos de uma direção.
- Corre direto, morde 1 vez, recua 2 u em zigue-zague, repete a cada 1,8 s.
- **Guts** (oficial): se estiver envenenado/queimado/paralisado, ataque +50%.
- Foge se ficar sozinho (Run Away, Pokédex: cauteloso).

## 6. Grau de confiança

**Alto** para dados físicos e silhueta; **médio** para cores.

## 7. Diferenças entre versões

- G1: roxo mais claro e dentes mais longos. Moderno: roxo médio.
- **Rattata de Alola (G7)**: preto com bochechas creme, bigodes grossos; Sombrio/Normal. Não usar em Kanto.
- Anime: Rattata do Joey ("o melhor Rattata"). Sem divergência relevante.
