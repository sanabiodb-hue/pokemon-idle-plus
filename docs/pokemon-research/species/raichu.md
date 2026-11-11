# Raichu (#026) · Elétrico

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Evolução de Pikachu (oficial: Pedra do Trovão; **no projeto: Nv 22**). Roedor laranja, maior e mais pesado, com **cauda preta longa e fina terminando em raio amarelo** e bochechas amarelas. **Não é selvagem na Floresta de Viridian** em nenhum jogo consultado; só faz sentido aqui como chefe-evento por **decisão criativa**.

## 2. Fontes consultadas

- Busca: Pokémon Database (lista de altura e peso, resumo) → **0,8 m e 30,0 kg** (verificado nesta sessão).
- Pokédex e aparência: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,8 m / 30,0 kg | verificado (busca) |
| Tipo | Elétrico (Raichu de Alola: Elétrico/Psíquico) | oficial |
| Evolução | Pikachu + Pedra do Trovão | conhecimento prévio; **projeto: Nv 22** |
| Habilidade | Static (Lightning Rod oculta) | conhecimento prévio |
| Golpes típicos | Thunder Shock, Thunderbolt, Thunder Punch, Quick Attack, Thunder | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): a cauda funciona como fio-terra, protegendo-o da própria eletricidade alta; quando a carga acumula, fica agressivo; pode soltar descargas muito fortes (algumas entradas falam em 100 mil volts); com a cauda fincada no chão, solta o excesso.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: corpo de pera (largo embaixo), **orelhas largas que fazem uma curva no fim** (pontas enroladas) e **cauda muito longa, fina e preta** que termina num raio amarelo.
- Pelo laranja; barriga creme; bochechas **amarelas**; parte de dentro das orelhas amarela e de fora marrom; patas marrons; 2 listras marrons nas costas.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,8 = **1,10 u** (até as orelhas). Chefe-evento: 1,8× → ~2,0 u.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça | 0,32 |
| Tronco | 0,48 (largura 0,46 embaixo) |
| Orelhas | 0,25 |
| Braços | 0,15 |
| Pés | 0,10 (comprimento 0,15) |
| Cauda | comprimento 1,0 H; raio final 0,22 × 0,18 |

### Cores
| Parte | Hex |
|---|---|
| Corpo | `#E8913A` |
| Barriga | `#F6E0B2` |
| Bochechas, dentro das orelhas, raio da cauda | `#F6CF2E` |
| Fora das orelhas, patas, listras | `#7A4A22` |
| Cauda | `#2A2420` |
| Olhos | `#1C1C1C` + brilho `#FFFFFF` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Tronco | esfera (0,23, 0,25, 0,20) | — | (0, 0,28, 0) | corpo |
| 2 | Barriga | esfera (0,16, 0,18, 0,08) | — | (0, 0,26, 0,14) | creme |
| 3 | Cabeça | esfera (0,19, 0,16, 0,17) | — | (0, 0,62, 0,03) | corpo |
| 4–5 | Orelhas | cone achatado (0,08 → ponta, 0,25), última parte dobrada para fora 40° (2 cones encadeados) | — | (±0,13, 0,80, −0,02), rot Z ±30° | marrom fora / amarelo dentro |
| 6–7 | Bochechas | esfera (0,05, 0,045, 0,02) | — | (±0,13, 0,58, 0,15) | amarelo |
| 8–9 | Olhos | esfera (0,03, 0,04, 0,02) | — | (±0,07, 0,65, 0,17) | olho |
| 10–11 | Braços | cil(0,035, 0,15) + mão esfera 0,035 marrom | — | (±0,19, 0,40, 0,08) | corpo |
| 12–13 | Pés | esfera (0,06, 0,04, 0,08) | — | (±0,11, 0,03, 0,06) | marrom |
| 14 | Cauda | `TubeGeometry` sobre curva em "S" longa: sai de (0, 0,10, −0,18), desce ao chão em z −0,5, sobe até (0, 0,45, −0,95); raio 0,015 H | — | | preto |
| 15 | Raio da cauda | `ExtrudeGeometry` de um raio 2D (0,22 × 0,18 H, espessura 0,03) | — | na ponta | amarelo |
| 16–17 | Listras | caixa curva (0,20, 0,03, 0,02) | — | costas, y 0,36 e 0,28 | marrom |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | cauda ondula (onda ao longo da curva, amplitude 0,03 H, 0,8 Hz); bochechas soltam faíscas a cada 2 s |
| Andar | bípede pesado, 2,2 passos/s, quique 0,03 H; 1,5 u/s |
| Correr | de quatro como Pikachu, inclinação 30°, 3,0 u/s |
| Ataque especial | 0,0–0,35 s: **finca a cauda no chão** (ponta desce até y 0) e o corpo brilha `#FFE14A`; arcos elétricos curtos percorrem a cauda; 0,35 s: solta o golpe |
| Dano | recua 0,15 u, faíscas involuntárias |
| Desmaio | tomba de lado; cauda cai em linha reta |

### Combate e IA (modo hordas)
- **Arquétipo: tanque elétrico de área (chefe-evento)** — decisão criativa, não oficial na floresta.
- 1,5 u/s; HP alto. Ciclo de 8 s: (1) 2× Choque do Trovão em alvo único; (2) "aterramento": finca a cauda e, após 0,8 s de aviso (anel amarelo no chão), solta **descarga em círculo r 4 u** ao redor; (3) Trovão: 3 raios do céu sobre o jogador com 1,0 s de aviso cada (círculo r 1,3 u).
- Contato: Static (30% paralisia).
- Justificativa: Pokédex (cauda como terra, descarga de carga acumulada).

## 6. Grau de confiança

**Alto** para dados físicos e silhueta; **médio** para cores; IA é decisão criativa.

## 7. Diferenças entre versões

- **Raichu de Alola (G7)**: surfa na própria cauda, olhos azuis, Elétrico/Psíquico. Não usar em Kanto.
- Anime: Raichu do Lt. Surge (Ginásio de Vermilion) é o Raichu "vilão" mais conhecido — não é da floresta.
- Projeto: evolução por nível 22 (oficial: pedra).
