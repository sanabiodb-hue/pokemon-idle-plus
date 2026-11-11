# Beedrill (#015) · Inseto / Veneno

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Vespa grande, amarela e preta, com **duas lanças-ferrão nos braços** e um terceiro ferrão no abdômen. Voa rápido, é territorial e ataca em enxame. Evolui de Kakuna (Nv 10). É o candidato natural a **chefe** da Floresta de Viridian (versão Alfa).

## 2. Fontes consultadas

- Busca de peso (29,5 kg): sem resultado direto; um guia de Pokémon Stadium dá 65 lb (≈ 29,5 kg) → **consistente, não confirmado em fonte primária**.
- Busca: Beedrill exclusivo de Let's Go Eevee na floresta; HGSS em árvores de Cabeçada.
- Pokédex e aparência: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 1,0 m / 29,5 kg | altura: conhecimento prévio; peso: consistente com uma fonte (busca) |
| Tipo | Inseto / Veneno | oficial e no jogo |
| Habilidade | Swarm (Enxame) | conhecimento prévio — o próprio nome reforça o arquétipo |
| Golpes típicos | Fury Attack, Twineedle, Pin Missile, Poison Jab, Agility | conhecimento prévio |
| Mega Evolução | Mega Beedrill (G6) | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): muito territorial, ninguém deve se aproximar do ninho; quando irritado, ataca **em enxame**; voa em alta velocidade e golpeia com os ferrões venenosos dos braços e da cauda.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: inseto em pé no ar, com **dois cones prateados apontando para a frente/baixo** nas pontas dos braços e um abdômen listrado em amarelo e preto terminando em ferrão. Asas translúcidas em cima.
- Olhos vermelhos grandes e triangulares (bravos); antenas pretas finas.
- Pernas finas (o par de trás longo e pendurado).

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 1,0 = **1,25 u**. Voa com o tórax a ~1,1 u do chão. **Alfa (chefe): 2,0× → H 2,5 u**.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça | 0,22 |
| Tórax | 0,20 |
| Abdômen | 0,35 (comprimento) |
| Lanças dos braços | 0,32 cada |
| Asas (cada, 4) | 0,40 × 0,16 |
| Pernas traseiras | 0,30 |

### Cores
| Parte | Hex |
|---|---|
| Corpo/cabeça/tórax | `#F2C232` |
| Listras do abdômen | `#26262A` |
| Lanças e ferrão | `#E6E8EE` (ponta) → `#9AA0AA` (base) |
| Olhos | `#D9303A` (Alfa: emissivo `#FF2020`) |
| Asas | `#DCEEFF`, opacidade 0,45 |
| Antenas/pernas | `#26262A` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Cabeça | esfera (0,11, 0,11, 0,12) | — | (0, 0,82, 0,08) | amarelo |
| 2–3 | Olhos | cone(0,05, 0,04) de 3 lados, deitado | — | (±0,06, 0,84, 0,18) | vermelho |
| 4 | Mandíbula | esfera (0,05, 0,03, 0,04) | — | (0, 0,74, 0,17) | amarelo |
| 5–6 | Antenas | cil(0,008, 0,18) | — | (±0,04, 0,94, 0,08), ±25° Z, −20° X | preto |
| 7 | Tórax | esfera (0,10, 0,10, 0,09) | — | (0, 0,62, 0) | amarelo |
| 8–9 | Braços | cil(0,025, 0,16) | — | do tórax (±0,10, 0,62, 0) para (±0,18, 0,52, 0,10) | amarelo |
| 10–11 | Lanças | cone(0,05, 0,32) | — | na ponta dos braços, apontando para frente-baixo (rot X 110°) | prata |
| 12 | Abdômen | esfera (0,10, 0,17, 0,10) | — | (0, 0,34, −0,10), inclinado 25° para trás | amarelo |
| 13–14 | Listras | toro (r 0,09, tubo 0,03) ou 2 cil. finos | — | ao longo do abdômen, y 0,40 e 0,28 | preto |
| 15 | Ferrão | cone(0,04, 0,16) | — | (0, 0,12, −0,18), apontando para baixo-trás | prata |
| 16–19 | Asas | `CircleGeometry` escalado (0,40, 0,16) | — | pivô (±0,05, 0,72, −0,05), abertas 25° para cima | asa |
| 20–23 | Pernas | cil(0,012, 0,30) | — | do tórax para baixo-trás | preto |

### Animação por código
| Estado | Receita |
|---|---|
| Pairar | asas: rot ±30° a **12 Hz** (zumbido; com 60 qps, mostrar 2 quadros alternados é suficiente); corpo sobe/desce 0,03 H a 2 Hz; lanças balançam ±5° |
| Deslocamento | **rápido**: 3,0 u/s em linha; inclina 30° para frente; pequenos "trancos" laterais (±0,3 u a cada 0,6 s, como inseto real) |
| Fúria Dupla / Twineedle (corpo a corpo) | 0,0–0,15 s: recua 0,3 u, braços para trás; 0,15–0,25 s: avança 1,5 u em linha; 2 estocadas (uma por lança) em 0,08 s cada; volta em 0,3 s |
| Míssil de Ferrão (à distância) | 0,25 s mirando (abdômen aponta para o alvo, brilho na ponta); dispara 5 agulhas finas (cone 0,02 × 0,25 u) em leque de 30°, 10 u/s |
| Dano | recua 0,4 u, rot X −20° e recupera em 0,3 s |
| Desmaio | asas param, cai reto em 0,35 s, quica 1 vez, deita de lado |

### Combate e IA (modo hordas)
- **Beedrill comum: enxame agressivo (assassino rápido)**. 3,0 u/s, ataque alto, defesa baixa. Ataca em ondas de 3–6. Padrão: circula a 3 u, investe em linha, recua, repete (a cada 2 s).
- 30% de envenenar por acerto.
- **Habilidade Swarm (Enxame)**: quando o HP cai abaixo de 1/3, +50% de dano (oficial: golpes de Inseto 1,5× com HP ≤ 1/3 — conhecimento prévio).
- **Beedrill Alfa (chefe)**: 2,0×, olhos vermelhos emissivos, aura vermelha (anel no chão r 1,5 u, pulsando).
  - Fase 1 (100–60% HP): investidas em linha de 6 u (aviso: linha vermelha no chão 0,6 s antes); Míssil de Ferrão em leque de 5 a cada 4 s.
  - Fase 2 (60–25%): a cada 15 s chama 4 Beedrill e "acorda" Kakuna próximos (que viram Beedrill em 3 s).
  - Fase 3 (< 25%, Swarm ativo): velocidade +30%, investidas em sequência de 3.
- Justificativa: Pokédex (territorial, enxame), habilidade Swarm, enxame do anime.

## 6. Grau de confiança

**Médio-alto**: silhueta e comportamento muito conhecidos; dados físicos parcialmente verificados.

## 7. Diferenças entre versões

- Mega Beedrill (G6): lanças maiores, abdômen vira um ferrão longo, braços extras. Pode inspirar a fase 3 do Alfa (decisão criativa), mas não é o Beedrill normal.
- Anime (ep. 3): o enxame persegue Ash e Misty pela floresta; é a cena-referência.
- "Alfa" vem de Legends: Arceus (Pokémon maior com olhos vermelhos). Beedrill alfa não existe oficialmente na floresta: **decisão criativa do projeto**.
