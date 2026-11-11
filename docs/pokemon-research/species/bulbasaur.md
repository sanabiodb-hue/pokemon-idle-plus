# Bulbasaur (#001) · Planta / Veneno

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Quadrúpede verde-azulado com manchas escuras e um **bulbo verde nas costas** (a semente plantada desde o nascimento). Inicial de Kanto. Na Floresta de Viridian aparece só como **aparição rara em Let's Go** (busca; uma fonte discorda). Bulbasaur → Ivysaur (Nv 16) → Venusaur (Nv 32).

## 2. Fontes consultadas

- Busca de peso: **sem resultado para Bulbasaur** → 0,7 m e 6,9 kg são **conhecimento prévio, não verificado nesta sessão**.
- Busca: Let's Go, Bulbasaur como aparição rara na floresta (GamerGuides e outros).
- Pokédex e aparência: conhecimento prévio.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,7 m / 6,9 kg | conhecimento prévio |
| Tipo | Planta / Veneno | oficial e no jogo |
| Evolução | Ivysaur Nv 16, Venusaur Nv 32 | oficial; igual no jogo |
| Habilidade | Overgrow (Chlorophyll oculta) | conhecimento prévio |
| Golpes típicos | Tackle, Growl, Vine Whip, Leech Seed, Poison Powder, Sleep Powder, Razor Leaf, Seed Bomb | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): carrega uma semente nas costas desde que nasce; a semente cresce com ele absorvendo luz; costuma tirar sonecas ao sol; o bulbo guarda energia, então aguenta dias sem comer.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: quadrúpede baixo e largo com uma **"cebola" grande nas costas**. Cabeça larga e achatada, orelhas pequenas pontudas.
- Pele verde-azulada (turquesa) com manchas verde-escuras irregulares; olhos vermelhos com esclera branca; boca larga.
- Bulbo verde com nervuras/folhas fechadas em espiral, mais escuro nas dobras.
- Patas curtas e grossas com 3 garras brancas.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,7 = **1,03 u** (até o topo do bulbo). Comprimento ≈ 1,1 H.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça | 0,45 de largura, 0,35 de altura |
| Corpo | altura 0,40, comprimento 0,60 |
| Bulbo | diâmetro 0,50 |
| Patas | 0,20 |
| Orelhas | 0,10 |

### Cores
| Parte | Hex |
|---|---|
| Pele | `#7CC8B0` |
| Manchas | `#3E8E78` |
| Bulbo | `#5DAE4A` |
| Dobras do bulbo | `#3D7F36` |
| Olhos | íris `#C8303A`, pupila `#1E1E1E`, esclera `#FFFFFF` |
| Garras | `#F4F4F0` |
| Boca interna | `#E58A8A` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Corpo | esfera (0,26, 0,20, 0,30) | — | (0, 0,26, −0,06) | pele |
| 2 | Cabeça | esfera (0,24, 0,18, 0,21) | — | (0, 0,38, 0,30) | pele |
| 3–4 | Orelhas | cone(0,05, 0,10) | — | (±0,15, 0,54, 0,26), rot Z ±30° | pele |
| 5–6 | Olhos | esfera (0,06, 0,06, 0,03) branca + íris 0,04 + pupila 0,02 | — | (±0,12, 0,42, 0,46), girados ±25° em Y | |
| 7 | Boca | caixa fina (0,18, 0,01, 0,01) curvada / toro parcial | — | (0, 0,32, 0,50) | pele escura |
| 8–11 | Patas | cil(0,07, 0,20) | — | (±0,17, 0,10, 0,18) e (±0,17, 0,10, −0,24) | pele |
| 12–23 | Garras | cone(0,015, 0,04) ×3 por pata | — | na frente de cada pata, y 0,02 | branco |
| 24–30 | Manchas | esfera achatada (0,06, 0,01, 0,05) | — | 5–7 sobre a cabeça e o corpo, posição pseudoaleatória com semente fixa | escuro |
| 31 | Bulbo | esfera (0,25, 0,24, 0,25) | — | (0, 0,66, −0,10) | bulbo |
| 32–36 | Folhas do bulbo | 5 esferas achatadas (0,10, 0,22, 0,04), giradas 72° entre si em torno de Y, inclinadas 15° para dentro | — | em volta do bulbo | dobras |
| 37 | Ponta do bulbo | cone(0,06, 0,10) | — | (0, 0,92, −0,10) | bulbo |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | respiração lenta (Y 1 ± 0,025 a 0,4 Hz); bulbo "pulsa" defasado 0,3 s; piscar a cada 3–5 s |
| Andar | quadrúpede em diagonal (pata dianteira esquerda + traseira direita), 2,2 passos/s, quique 0,03 H; 1,2 u/s; cabeça balança ±3° |
| Chicote de Vinha (Vine Whip) | 2 vinhas saem de baixo do bulbo (ver `attacks/vine-whip.md`); corpo firma (Y 0,95) |
| Folha Navalha / Razor Leaf | bulbo se abre levemente (folhas rot 25° para fora) e lança folhas (ver golpe) |
| Pó do Sono / Semente Sanguessuga | bulbo sacode (rot Z ±10° a 6 Hz por 0,4 s) e solta pó/semente pela ponta |
| Dano | recua 0,15 u, bulbo balança com atraso (mola) |
| Desmaio | patas dobram (corpo desce até y 0,12 H), cabeça encosta no chão, olhos fecham |

### Combate e IA (modo hordas)
- Como selvagem: **raro de caça** (não de combate). Pouco agressivo: dorme ao sol (Pokédex) e só reage se atacado.
- Como Pokémon do jogador: **atirador médio com controle**. Vine Whip (alcance 2,5 u, cone estreito), Razor Leaf (leque de folhas, vários alvos — ver `attacks/razor-leaf.md`), Leech Seed (dano contínuo que cura), Sleep Powder.
- Se usado como inimigo: mantém 2,5–3 u, chicoteia, solta Pó do Sono (círculo r 1,5 u à frente a cada 8 s).

## 6. Grau de confiança

**Médio**: dados físicos não verificados nesta sessão (conhecimento prévio sólido); silhueta inconfundível.

## 7. Diferenças entre versões

- G1: mais "sapo", manchas maiores. Moderno: cabeça mais larga e olhos maiores.
- Anime: o Bulbasaur do Ash usa as vinhas como braços (pega coisas, se apoia, arremessa). Nos jogos, as vinhas só aparecem no golpe. **Recomendação**: no modo ação, as vinhas podem aparecer também para "pegar" itens — decisão criativa compatível com o anime.
