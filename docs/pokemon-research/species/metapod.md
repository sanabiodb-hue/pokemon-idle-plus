# Metapod (#011) · Inseto

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Casulo verde e duro, forma de crescente (meia-lua) com a "ponta" para baixo. Quase não se mexe: o corpo mole se reorganiza dentro da casca à espera da evolução para Butterfree (Nv 10).

## 2. Fontes consultadas

- Busca de peso (9,9 kg): **o resultado não trouxe Metapod** → altura/peso de **conhecimento prévio, não verificado nesta sessão**.
- Pokédex e aparência: conhecimento prévio.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,7 m / 9,9 kg | conhecimento prévio (não verificado) |
| Tipo | Inseto | oficial e no jogo |
| Evolução | de Caterpie (Nv 7); para Butterfree (Nv 10) | oficial; igual no jogo |
| Habilidade | Shed Skin | conhecimento prévio |
| Golpe característico | **Harden (Endurecer)**: aprende ao evoluir e é praticamente o único golpe | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): a casca é dura como ferro; quase não se move, porque o interior está mole e em transformação; se atacado, só consegue endurecer a casca.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: crescente verde, maior em cima, afinando em ponta curva embaixo; inclinado para a frente.
- Olhos semicerrados (fenda preta em forma de meia-lua sob uma "pálpebra" da própria casca).
- Superfície com placas/linhas de segmento horizontais e uma "dobra" triangular no peito.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,7 = **1,03 u**.

### Proporções
| Parte | Fração de H |
|---|---|
| Parte de cima (cabeça) | 0,45 |
| Corpo médio | 0,35 |
| Ponta inferior curva | 0,20 |
| Largura máxima | 0,55 |

### Cores
| Parte | Hex |
|---|---|
| Casca | `#6FB34E` |
| Sombra das placas / linhas | `#4E8F38` |
| Fenda dos olhos | `#1E1E1E` com íris `#F4F4F4` pequena |
| Brilho de "Endurecer" | `#E8F8FF` (emissivo) |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Cabeça | esfera | (0,27, 0,25, 0,24) | (0, 0,72, 0,05) | casca |
| 2 | Corpo | esfera | (0,24, 0,24, 0,21) | (0, 0,46, 0,00) | casca |
| 3 | Ponta | cone(0,16, 0,32) invertido | — | (0, 0,16, −0,06), rot X 160° (ponta para baixo e um pouco para trás) | casca |
| 4 | Pálpebra | esfera cortada (`thetaLength` metade) | (0,20, 0,08, 0,05) | (0, 0,74, 0,24) | casca escura |
| 5–6 | Olhos | esfera achatada (0,06, 0,025, 0,02) | — | (±0,09, 0,70, 0,26) | preto |
| 7–9 | Linhas de segmento | toro fino (r 0,23, tubo 0,008), achatado | — | y = 0,40, 0,52, 0,62 | sombra |
| 10 | Dobra do peito | cone(0,06, 0,12) de 3 lados | — | (0, 0,52, 0,21) | sombra |

Apoio: Metapod fica "em pé" sobre a ponta — use um disco de sombra no chão (r 0,25 u). Alternativa ao pé: pendurar em galho (fio branco até a copa), como nos ninhos.

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | **quase nada**: balanço pendular rot Z ±2° a 0,3 Hz; a cada 5–8 s, um "tremor" interno (escala 1,02 por 0,08 s) |
| Deslocamento | **não anda**. Se precisar reposicionar (empurrado), desliza com rot Z ±8° (pulinho de 0,05 H) |
| Endurecer | 0,0–0,3 s: brilho emissivo branco-azulado sobe de baixo para cima (opacidade 0 → 0,8 → 0,3); 1 anel `#E8F8FF` (toro) cresce de r 0,3 a 0,7 H e some; escala 1,05 e volta; som curto metálico ("tink") |
| Dano | balanço forte rot Z ±15° amortecido em 0,5 s (efeito "joão-bobo"); faíscas brancas se a defesa estiver alta |
| Desmaio | tomba para trás (rot X −80°) em 0,4 s, rola 0,2 u, olhos se fecham (fenda some) |

### Combate e IA (modo hordas)
- **Arquétipo: casulo parado que endurece (obstáculo/esponja de dano)**.
- Velocidade 0. HP médio, defesa alta. Não causa dano (ou dano mínimo por contato: 0).
- A cada 3 s usa **Endurecer**: +1 nível de defesa (−15% de dano recebido por nível, até 4 níveis = −60%). Mata-se rápido ou ele vira "muro".
- Aparece em grupos de 3–6 perto de árvores, bloqueando passagens.
- Recompensa: ao derrotar após ≥ 3 níveis de Endurecer, bônus de EXP (decisão de jogo, para `economy-balancing`).
- Opcional (decisão criativa): após 20 s vivo, chance de "eclodir" em Butterfree.
- Justificativa: Harden é seu golpe-assinatura; Pokédex (só consegue endurecer).

## 6. Grau de confiança

**Médio**: dados físicos não verificados nesta sessão (conhecimento prévio sólido); silhueta e comportamento muito conhecidos.

## 7. Diferenças entre versões

- G1: crescente mais grosso. Moderno: mais liso, olhos mais expressivos.
- Anime: o duelo Metapod × Metapod (os dois só usando Endurecer) virou piada clássica — referência ideal para o "muro".
- Projeto: Metapod selvagem no Nv 11–15 (acima do Nv 10 de evolução) é possível nos jogos: selvagens não evoluem sozinhos.
