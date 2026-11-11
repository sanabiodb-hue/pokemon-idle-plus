# Paras (#046) · Inseto / Planta

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Pequeno inseto laranja parecido com uma ninfa de cigarra/caranguejo, com **dois cogumelos vermelhos com pintas amarelas** nas costas (fungos parasitas chamados tochukaso). Evolui para Parasect (Nv 24). **Atenção**: oficialmente vive em Mt. Moon e na Safari Zone, **não** na Floresta de Viridian (ver `regions/viridian-forest.md`).

## 2. Fontes consultadas

- Busca: Wikidex (lista por peso, resumo) → **5,4 kg** (verificado). Altura 0,3 m: conhecimento prévio.
- Busca: Pockettactics, Dittobase → **habitat oficial: Mt. Moon e Safari Zone** (Red/Blue/Yellow/FRLG) (verificado).
- Pokédex e aparência: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,3 m / 5,4 kg | peso verificado; altura conhecimento prévio |
| Tipo | Inseto / Planta | oficial e no jogo |
| Evolução | Parasect no Nv 24 | oficial; igual no jogo |
| Habilidades | Effect Spore, Dry Skin | conhecimento prévio |
| Golpes típicos | Scratch, Stun Spore, Poison Powder, Absorb, Leech Life, Spore | conhecimento prévio |
| Habitat | Mt. Moon, Safari Zone | verificado (busca) |

Pokédex (minhas palavras, conhecimento prévio): os cogumelos nas costas crescem tirando nutrientes do inseto hospedeiro; são valorizados como remédio; prefere lugares úmidos e escuros.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: corpo baixo e largo com **duas "cúpulas" vermelhas** em cima. De longe parece "dois cogumelos andando".
- Corpo laranja; olhos grandes e claros sem pupila marcada; duas pinças creme na frente; seis patinhas.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,3 = **0,73 u** (até o topo dos cogumelos).

### Proporções
| Parte | Fração de H |
|---|---|
| Corpo (altura) | 0,45; largura 0,75 |
| Cogumelos (chapéu) | diâmetro 0,45 (maior) e 0,38 |
| Pinças | 0,22 |
| Patas | 0,15 |

### Cores
| Parte | Hex |
|---|---|
| Corpo | `#E8813A` |
| Chapéu dos cogumelos | `#D8402E` |
| Pintas | `#F6D45A` |
| Pé dos cogumelos | `#F2E2C0` |
| Pinças | `#F2D9A6` |
| Olhos | `#F4F4EE` com borda `#8A5A2A` |
| Esporos | `#E8E07A` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Corpo | esfera (0,36, 0,22, 0,30) | — | (0, 0,24, 0) | laranja |
| 2–3 | Olhos | esfera (0,07, 0,08, 0,04) | — | (±0,12, 0,30, 0,27) | olho |
| 4–5 | Pinças | cone(0,05, 0,22) | — | (±0,12, 0,14, 0,34), apontando para a frente e para dentro 20° | creme |
| 6–7 | Pés dos cogumelos | cil(0,06, 0,12) | — | (±0,13, 0,46, −0,04) | pé |
| 8–9 | Chapéus | esfera cortada (hemisfério) r 0,22 e 0,19 | — | sobre os pés, y 0,52 e 0,50; inclinados ±12° para fora | vermelho |
| 10–19 | Pintas | esfera achatada 0,03 | — | 5 por chapéu, espalhadas na superfície | amarelo |
| 20–25 | Patas | cil(0,02, 0,15) | — | 3 pares, abertos 45° para os lados | laranja |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | cogumelos balançam ±3° com fase oposta a 0,6 Hz; pinças abrem/fecham 10° a cada 2 s |
| Andar | lento (0,6 u/s), lateral como caranguejo é aceitável; patas alternam em tripé (3 sobem, 3 descem) a 4 Hz, amplitude 0,03 H |
| Arranhão (Scratch) | pinça avança 0,15 H em 0,1 s, volta em 0,2 s |
| Esporos | cogumelos incham (escala 1,2) por 0,3 s e soltam 20 partículas amarelas que sobem 0,6 u e caem num círculo r 1,5 u |
| Dano | encolhe (Y 0,85) e recua 0,1 u; solta 3 esporos (Effect Spore) |
| Desmaio | vira de lado; cogumelos murcham (escala Y 0,7) |

### Combate e IA (modo hordas)
- **Arquétipo: tanque lento com esporos (zona de controle)**.
- 0,6 u/s; ataque alto para o porte (70), defesa média. Avança devagar e arranha corpo a corpo.
- **Effect Spore**: atacá-lo corpo a corpo tem 30% de chance de paralisar, envenenar ou adormecer (oficial em espírito, conhecimento prévio).
- A cada 6 s: nuvem de esporos (círculo r 1,5 u ao redor dele, dura 2 s).
- Recomendação de fidelidade: se mantido na floresta (decisão do projeto), use como incomum (≤ 5%) e só em zonas úmidas/escuras (perto de troncos caídos).

## 6. Grau de confiança

**Médio-alto** (habitat e peso verificados; aparência conhecida).

## 7. Diferenças entre versões

- G1: mais arredondado; olhos claros desde sempre.
- Anime: Paras aparece em cavernas e florestas úmidas.
- **Divergência com o projeto**: o jogo coloca Paras com peso 25 na floresta. Oficialmente errado; recomendação em `regions/viridian-forest.md`.
