# Weedle (#013) · Inseto / Veneno

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Larva peluda de cor laranja-marrom com **ferrão venenoso na cabeça** e outro na ponta da cauda. Comum na Floresta de Viridian (principalmente em Red e FRLG). Weedle → Kakuna (Nv 7) → Beedrill (Nv 10).

## 2. Fontes consultadas

- Busca: Bulbapedia e Dittobase (resumos) → **0,3 m e 3,2 kg** (verificado nesta sessão).
- Pokédex oficial e páginas completas: **bloqueadas**. Pokédex e aparência: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,3 m / 3,2 kg | verificado (busca) |
| Tipo | Inseto / Veneno | oficial e no jogo |
| Evolução | Kakuna Nv 7, Beedrill Nv 10 | oficial; igual no jogo |
| Habilidade | Shield Dust | conhecimento prévio |
| Golpes de nível baixo | Poison Sting (Ferrão Venenoso), String Shot, Bug Bite | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): o ferrão da cabeça tem cerca de 5 cm e é muito venenoso; vive em florestas e no capim; tem olfato apurado para achar as folhas de que gosta; a cor vistosa avisa os predadores de que é venenoso.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: lagarta baixa e reta (não faz "S" alto como Caterpie) com um **chifre-ferrão cinza-claro bem visível em cima da cabeça**. De longe: "lagarta laranja com espinho".
- Nariz/focinho grande e **rosa-avermelhado**; olhos pretos pequenos e redondos.
- Segmentos alaranjados, barriga e patinhas rosadas; ferrão menor na cauda.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,3 = **0,73 u** (incluindo o ferrão da cabeça). Comprimento ≈ 1,4 H.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça | 0,40 |
| Ferrão da cabeça | 0,30 |
| Segmentos (6) | 0,34 → 0,22 |
| Ferrão da cauda | 0,16 |

### Cores
| Parte | Hex |
|---|---|
| Corpo | `#D49A3E` |
| Faixas entre segmentos (opcional) | `#B07A2A` |
| Nariz, patas, barriga | `#E8818A` |
| Ferrões | `#E2E2E6` com base `#A8A8B0` |
| Olhos | `#1E1E1E` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Cabeça | esfera | (0,20, 0,19, 0,20) | (0, 0,30, 0,48) | corpo |
| 2 | Nariz | esfera | (0,10, 0,08, 0,08) | (0, 0,26, 0,68) | rosa |
| 3–4 | Olhos | esfera 0,035 | — | (±0,10, 0,36, 0,63) | preto |
| 5 | Ferrão da cabeça | cone(0,05, 0,30) | — | (0, 0,58, 0,46), inclinado 10° para trás | cinza |
| 6–11 | Segmentos | esferas r 0,17, 0,16, 0,15, 0,14, 0,12, 0,11 | — | z = 0,28, 0,10, −0,08, −0,25, −0,40, −0,53; y = r | corpo |
| 12 | Ferrão da cauda | cone(0,04, 0,16) | — | (0, 0,16, −0,66), deitado apontando para trás (rot X −80°) | cinza |
| 13–18 | Patas | esfera 0,03 | — | 3 pares sob os 3 primeiros segmentos | rosa |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | cabeça farejando: rot Y ±10° a 0,5 Hz, rot X ±5° a 1,5 Hz; ferrão balança junto |
| Rastejar | mesma onda peristáltica de Caterpie, mais rápida (1,9 Hz) e mais baixa (0,04 H); 1,0 u/s |
| Ferrão Venenoso | 0,0–0,12 s: recua a cabeça e ergue o ferrão 20°; 0,12–0,22 s: estoca 0,7 u para frente; acerto = partícula roxa `#A552C9` |
| Dano / Desmaio | como Caterpie (chicote lateral; de barriga para cima) |

### Combate e IA (modo hordas)
- **Arquétipo: enxame picador (dano por veneno)**. Um pouco mais rápido que Caterpie (1,0 u/s) e mais frágil.
- Persegue o jogador direto; ao chegar a ≤ 0,9 u, pica a cada 1,5 s. 30% de chance de envenenar (dano contínuo 1/16 do HP por 2 s, renovável).
- Grupo típico 4–8, misturado a Caterpie: Caterpie prende, Weedle pica — combo coerente com a floresta.
- Justificativa: Pokédex (ferrão venenoso de 5 cm) e Poison Sting como golpe inicial.

## 6. Grau de confiança

**Alto** para dados físicos e silhueta. **Médio** para cores/proporções.

## 7. Diferenças entre versões

- G1: corpo mais "gordinho"; moderno mais alongado. Mesma paleta.
- Anime: aparece pouco; o foco é no enxame de Beedrill.
- Projeto: evolução oficial preservada.
