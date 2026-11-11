# Butterfree (#012) · Inseto / Voador

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Borboleta de corpo azul-arroxeado, **olhos compostos vermelhos enormes** e quatro asas brancas com nervuras e bordas pretas. Voa o tempo todo. Evolui de Metapod (Nv 10). Na floresta: só em HGSS (árvores de Cabeçada) e em Let's Go Pikachu.

## 2. Fontes consultadas

- Busca: Bulbapedia (resumo) → **1,1 m e 32,0 kg** (verificado nesta sessão).
- Busca: Let's Go (Butterfree exclusiva de LGP na floresta) e HGSS (Cabeçada) — ver `regions/viridian-forest.md`.
- Pokédex e aparência: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 1,1 m / 32,0 kg | verificado (busca) |
| Tipo | Inseto / Voador | oficial e no jogo |
| Habilidade | Compound Eyes | conhecimento prévio |
| Golpes típicos | Gust, Confusion, Poison Powder, Stun Spore, Sleep Powder, Psybeam | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): as asas são cobertas de um pó que repele a água e, em algumas entradas, é tóxico; bate as asas para espalhar o pó; acha néctar em flores a quilômetros de distância.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: um "X" branco grande (as asas) com um corpo pequeno escuro no meio e **dois olhos vermelhos** que se destacam. De longe parece uma folha branca batendo.
- Corpo: cabeça redonda azul-arroxeada, duas antenas finas curvas; tórax com dois pares de patas pequenas (braços e pernas) azul-escuras.
- Asas superiores maiores, arredondadas; inferiores menores. Brancas com nervuras pretas finas e borda preta.
- Boca pequena com duas presas brancas.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 1,1 = **1,33 u** (do pé à ponta da asa de cima, asas abertas). **Envergadura ≈ 1,2 H**. Voa com o centro do corpo a ~1,0 u do chão.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça (diâmetro) | 0,30 |
| Olhos (cada) | 0,16 |
| Tórax/abdômen | 0,30 |
| Asa superior (cada) | 0,55 × 0,45 |
| Asa inferior (cada) | 0,40 × 0,30 |
| Antenas | 0,22 |

### Cores
| Parte | Hex |
|---|---|
| Corpo, cabeça, patas | `#4C4F9E` |
| Olhos | `#D8343F` com reflexo `#FF8A90` |
| Asas | `#F6F6FA` |
| Nervuras e borda | `#1F1F2A` |
| Presas | `#FFFFFF` |
| Pó (golpes) | sono `#9FD8FF`, paralisia `#F2D23C`, veneno `#B76AD8` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Cabeça | esfera 0,15 | — | (0, 0,62, 0,06) | corpo |
| 2–3 | Olhos | esfera (0,08, 0,09, 0,07) | — | (±0,09, 0,64, 0,14) | vermelho |
| 4 | Tórax | esfera (0,10, 0,13, 0,10) | — | (0, 0,42, 0) | corpo |
| 5–6 | Antenas | `TubeGeometry` de uma curva (ou 3 cil. curtos) r 0,008, terminando em espiral | 0,22 | saindo de (±0,05, 0,75, 0,08), curvando para trás | corpo |
| 7–8 | Asas superiores | `ShapeGeometry` (oval com 4 pontos de controle) ou `CircleGeometry` escalado (0,55, 0,45) | — | pivô em (±0,06, 0,50, −0,04), abertas 20° para trás | branco + borda |
| 9–10 | Asas inferiores | idem (0,40, 0,30) | — | pivô em (±0,06, 0,40, −0,05) | branco + borda |
| 11–14 | Patas | cil(0,02, 0,12) | — | 2 pares sob o tórax | corpo |
| 15–16 | Presas | cone(0,012, 0,04) | — | (±0,02, 0,52, 0,19) | branco |

Asas: desenhar a borda e as nervuras numa `CanvasTexture` pequena (64×64) gerada em código, `side: DoubleSide`, `alphaTest` para o recorte. Uma textura serve as 4 asas.

### Animação por código
| Estado | Receita |
|---|---|
| Repouso (pairando) | batida de asa: rot das asas em torno do eixo do corpo, ângulo `40° × sin(2π·3t)` (superiores) e o mesmo com atraso de 0,05 s (inferiores); corpo sobe/desce 0,06 H no dobro da frequência; a cada 1 s cai 1 partícula de pó |
| Deslocamento | 1,6 u/s; trajetória em "S" suave (desvio lateral ±0,5 u a 0,5 Hz); corpo inclina 15° para a frente |
| Pó (golpe de status) | para no ar, bate as asas forte 0,6 s (amplitude 60°, 5 Hz); nuvem de 30–50 partículas cai num círculo r 2,0 u no chão em frente, dura 3 s |
| Golpe especial (Confusão/Psicorraio) | olhos acendem (emissivo `#FF5C9A`) 0,25 s antes; ver golpe |
| Rajada (Gust) | 2 batidas grandes (0,2 s cada) apontando para o alvo |
| Dano | perde altura 0,3 u e recupera em 0,4 s; asas param 0,1 s |
| Desmaio | asas fecham (rot até 0°), cai em espiral (1 volta) em 0,6 s, deita no chão de lado |

### Combate e IA (modo hordas)
- **Arquétipo: suporte que espalha pó (controlador de área)** — também **Elite 1** da floresta.
- Mantém 4–5 u do jogador, voando em círculo. A cada 5 s solta **uma nuvem de pó** sobre a posição atual do jogador (círculo r 2,0 u, aparece em 0,6 s — tempo para fugir — e dura 3 s): sono (2 s parado), paralisia (−50% velocidade) ou veneno, sorteados.
- A cada 2,5 s: golpe especial (Confusão) em alvo único.
- Imune a golpes de chão (Voador). Prioridade alta de mira para o jogador, porque potencializa o enxame.
- Justificativa: aprende os três pós; Pokédex fala do pó das asas.

## 6. Grau de confiança

**Alto** para dados físicos e silhueta. **Médio** para cores e proporções.

## 7. Diferenças entre versões

- Desde G8 existe Butterfree Gigantamax (asas multicoloridas brilhantes) — não usar como forma normal.
- Anime: Butterfree do Ash e a cena da despedida no ep. 21 — Butterfree migram em bandos; reforça aparecerem em grupos de 2–3.
- Projeto: Butterfree como Elite (1,5×), não como selvagem comum.
