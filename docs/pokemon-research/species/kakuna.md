# Kakuna (#014) · Inseto / Veneno

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Casulo amarelo-ocre de Weedle, alongado e afinando para baixo, com dois "bracinhos" curtos colados ao corpo e olhos triangulares. Quase imóvel; evolui para Beedrill no Nv 10. Costuma ficar pendurado em galhos por fios de seda.

## 2. Fontes consultadas

- Busca de peso (10,0 kg): **o resultado não trouxe Kakuna** → dados físicos de **conhecimento prévio, não verificado nesta sessão**.
- Pokédex, aparência: conhecimento prévio.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,6 m / 10,0 kg | conhecimento prévio (não verificado) |
| Tipo | Inseto / Veneno | oficial e no jogo |
| Evolução | de Weedle (Nv 7); para Beedrill (Nv 10) | oficial; igual no jogo |
| Habilidade | Shed Skin | conhecimento prévio |
| Golpe característico | Harden (Endurecer) | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): quase incapaz de se mover; fica preso às árvores; para se proteger endurece a casca; algumas entradas dizem que pode estender um ferrão venenoso se ameaçado.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: "gota" amarela de ponta para baixo, mais estreita e mais alta que Metapod, com o topo arredondado como um capacete e **duas saliências laterais** (os bracinhos) na altura do peito.
- Olhos pretos triangulares, com expressão "brava", num recorte escuro sob a borda do "capacete".
- Faixas horizontais de segmento no corpo.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,6 = **0,95 u**.

### Proporções
| Parte | Fração de H |
|---|---|
| Topo/"capacete" | 0,35 |
| Corpo | 0,40 |
| Ponta | 0,25 |
| Largura máxima | 0,45 |
| Bracinhos | 0,15 |

### Cores
| Parte | Hex |
|---|---|
| Casca | `#E5BB3A` |
| Faixas e sombra | `#B98F22` |
| Recorte dos olhos | `#5A4A20` |
| Olhos | `#1E1E1E` com ponto `#F4F4F4` |
| Fio de seda | `#F2F2F2` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Capacete | esfera | (0,22, 0,20, 0,22) | (0, 0,78, 0) | casca |
| 2 | Corpo | esfera | (0,20, 0,28, 0,18) | (0, 0,48, 0) | casca |
| 3 | Ponta | cone(0,13, 0,30) invertido | — | (0, 0,15, 0), rot X 180° | casca |
| 4 | Recorte dos olhos | caixa (0,26, 0,07, 0,04) | — | (0, 0,70, 0,19) | recorte |
| 5–6 | Olhos | cone(0,04, 0,05) de 3 lados (triângulo), deitado | — | (±0,07, 0,70, 0,21) | preto |
| 7–8 | Bracinhos | esfera (0,05, 0,09, 0,06) | — | (±0,19, 0,52, 0,05), rot Z ±20° | casca |
| 9–11 | Faixas | toro (r ≈ largura local, tubo 0,008) | — | y = 0,35, 0,48, 0,60 | sombra |
| 12 | Fio (se pendurado) | cil(0,008 u, até a copa) | — | do topo até o galho | branco |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso (no chão) | inclinação ±2° a 0,25 Hz |
| Repouso (pendurado) | pêndulo rot Z ±6° a 0,4 Hz em torno do ponto do fio |
| Deslocamento | **não anda** |
| Endurecer | igual ao Metapod, brilho amarelo-claro `#FFF4C0` |
| Ferrão (decisão criativa da Pokédex) | 0,0–0,1 s: um cone fino cinza `#D8D8DE` (0,04 × 0,25 H) sai do peito; volta em 0,3 s |
| Dano | joão-bobo (rot Z ±15° amortecido 0,5 s); se pendurado, gira no fio 1 volta |
| Desmaio | cai do fio (se pendurado) com queda de 0,3 s e quique 0,05 u; tomba de lado |

### Combate e IA (modo hordas)
- **Arquétipo: casulo parado que endurece + espinho de contato (ninho)**.
- Velocidade 0. Endurecer a cada 3 s como Metapod (−15% de dano por nível, até 4).
- Contato (jogador encosta ou ataca corpo a corpo): 20% de chance de envenenar (decisão criativa apoiada na Pokédex do ferrão).
- **Gatilho de enxame**: ao derrotar um Kakuna, 25% de chance de surgir 1 Beedrill a 6–8 u, vindo das árvores (eco do anime ep. 3 e da Pokédex de Beedrill: defende o ninho). Esse é o gancho natural para o chefe "Beedrill Alfa".
- Posicionamento: grupos de 3–5 pendurados em árvores à beira das clareiras.

## 6. Grau de confiança

**Médio** (dados físicos não verificados nesta sessão; aparência e papel bem conhecidos).

## 7. Diferenças entre versões

- G1: mais arredondado; moderno com olhos mais marcados.
- Anime: os Kakuna nas árvores são o "ninho" que dispara o enxame de Beedrill.
- Projeto: Kakuna Nv 11–15 selvagem é aceitável (selvagens não evoluem).
