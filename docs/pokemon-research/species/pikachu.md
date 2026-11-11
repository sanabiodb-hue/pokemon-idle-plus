# Pikachu (#025) · Elétrico

> Para: `art-animation-3d`, `game-3d-engineer`, `gameplay-developer`.
> Convenções de todas as fichas de espécie (valem para os 14 arquivos):
> - **H** = altura total do modelo, das patas à ponta mais alta (orelhas inclusive). Todas as medidas são frações de H.
> - Origem no chão, no centro entre os pés. **+Y para cima, +Z para a frente** (para onde o Pokémon olha), +X para a direita dele.
> - "esfera(rx, ry, rz)" = `SphereGeometry(1)` com escala (rx, ry, rz); "cone(r, h)" = `ConeGeometry(r, h)`; "cil(r, h)" = cilindro; "caixa(x, y, z)".
> - **Escala no mundo (decisão do projeto, ver `visual-style/3d-direction.md`)**: `H_unidades = 0,5 + 0,75 × altura_Pokédex_m`. Comprime a diferença de tamanho para que tudo seja legível na horda.
> - Cores: aproximações em hexadecimal da arte oficial, de **conhecimento prévio, não verificado nesta sessão**.

## 1. Descrição

Roedor elétrico amarelo, mascote da série. Bípede quando parado ou andando devagar; corre de quatro nas versões 3D. Guarda eletricidade nas bochechas vermelhas e a solta quando se sente ameaçado. Na Floresta de Viridian é o encontro raro (5% em Red/Blue).

## 2. Fontes consultadas

- Busca: Pokémon Database (resumo) → **0,4 m e 6,0 kg** (verificado nesta sessão via resumo de busca).
- Busca: tabelas de encontro da floresta (ver `regions/viridian-forest.md`).
- pokemon.com, Bulbapedia, Serebii: **bloqueados** (WebFetch recusado pelo proxy).
- Pokédex, aparência, movimentos e animações: **conhecimento prévio, não verificado nesta sessão**.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,4 m / 6,0 kg | verificado (busca) |
| Tipo | Elétrico | dado do jogo (`pokemon-data.js`) e oficial |
| Evolução | Pichu → Pikachu → Raichu (Pedra do Trovão) | conhecimento prévio; **no projeto evolui no Nv 22** (decisão do projeto) |
| Habilidade | Static (contato pode paralisar) | conhecimento prévio |

Pokédex (resumo com minhas palavras, conhecimento prévio): guarda eletricidade nas bolsas das bochechas; quando várias se juntam, a eletricidade acumulada pode gerar tempestades de raios; ergue a cauda para sentir o ambiente; vive em florestas; solta descargas quando ameaçado.

## 4. Referências visuais (descritas em texto)

- **Silhueta reconhecível de longe**: duas orelhas longas e pontudas com **pontas pretas** + **cauda em raio (zigue-zague)** apontando para cima atrás do corpo. Mesmo em 40 px, esses dois elementos identificam o Pikachu.
- Arte moderna (desde G6): corpo mais esguio que o da G1, cabeça grande, olhos pretos com brilho branco, bochechas vermelhas redondas, boca pequena em "w".
- Costas: duas listras marrons horizontais. Base da cauda marrom.

## 5. Recomendações para implementação 3D

**H no mundo** = 0,5 + 0,75 × 0,4 = **0,80 u**.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça (altura) | 0,36 |
| Tronco (altura) | 0,38 |
| Orelhas (comprimento) | 0,34 |
| Braços | 0,14 |
| Pés | 0,08 (comprimento 0,12) |
| Cauda (altura total do raio) | 0,55 |

### Cores
| Parte | Hex |
|---|---|
| Corpo | `#F6D12E` |
| Sombra do corpo (vértices de baixo, opcional) | `#D9AE1E` |
| Pontas das orelhas | `#2B2B2B` |
| Bochechas | `#E8423A` |
| Listras das costas, base da cauda | `#8A5A2B` |
| Olhos | `#1C1C1C` + brilho `#FFFFFF` |
| Boca/nariz | `#3A2A20` |

### Receita em primitivas (y = centro)
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Tronco | esfera | (0,19, 0,20, 0,16) | (0, 0,25, 0) | corpo |
| 2 | Cabeça | esfera | (0,23, 0,19, 0,20) | (0, 0,58, 0,02) | corpo |
| 3–4 | Orelhas | cone(0,055, 0,34) | — | (±0,12, 0,86, 0), girar ±22° em Z (para fora) e −8° em X | corpo |
| 5–6 | Pontas das orelhas | cone(0,035, 0,12) | — | no topo de cada orelha (sobreposto aos 35% finais) | preto |
| 7–8 | Olhos | esfera | (0,035, 0,045, 0,02) | (±0,09, 0,61, 0,19) | olho; brilho = esfera 0,012 em (+0,01, +0,015) |
| 9–10 | Bochechas | esfera | (0,05, 0,045, 0,02) | (±0,16, 0,52, 0,15) | vermelho |
| 11 | Nariz | esfera | 0,012 | (0, 0,57, 0,21) | boca |
| 12–13 | Braços | cápsula/cil(0,035, 0,14) | — | (±0,15, 0,33, 0,10), apontando para frente-baixo 40° | corpo |
| 14–15 | Pés | esfera | (0,05, 0,035, 0,08) | (±0,09, 0,03, 0,05) | corpo |
| 16–17 | Listras | caixa (0,22, 0,03, 0,02) | — | (0, 0,30 e 0,22, −0,15), curvar seguindo o dorso | marrom |
| 18 | Cauda seg. 1 (base) | caixa (0,06, 0,16, 0,04) | — | (0, 0,16, −0,20), inclinada −35° em X | marrom |
| 19 | Cauda seg. 2 | caixa (0,07, 0,16, 0,04) | — | (0, 0,30, −0,28), +35° (forma o zigue-zague) | corpo |
| 20 | Cauda seg. 3 (largo) | caixa (0,16, 0,24, 0,04) | — | (0, 0,52, −0,32), −20° | corpo |

Total: ~20 malhas; dá para fundir em 3 materiais (corpo, preto, vermelho/marrom). A cauda pode ser um `ExtrudeGeometry` de um raio 2D (mais fiel e ainda procedural).

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | respiração: escala Y do tronco 1 ± 0,03 a 0,6 Hz; cauda balança ±8° em Z a 1,1 Hz; a cada 2–4 s uma orelha gira 15° e volta em 0,15 s; bochechas soltam 1–2 faíscas `#FFF27A` a cada 3 s |
| Andar (< 2 u/s) | bípede: corpo sobe 0,04 H a cada passo (2,5 passos/s), pés alternam ±0,05 H em Z, inclinação 0° |
| Correr (≥ 2 u/s) | **de quatro**: tronco inclina 35° para frente, cabeça levanta 20° para manter o olhar; quique 0,08 H a 4 Hz; braços viram patas dianteiras; cauda fica reta para trás (−60° em X) |
| Ataque especial (elétrico) | 0,00–0,20 s: agacha (escala Y 0,85, X 1,08), bochechas acendem (emissivo `#FFE14A`); 0,20 s: estica (Y 1,12) e solta o golpe; faíscas saem das bochechas e da cauda |
| Ataque físico (Investida, Ataque Rápido) | avança 1,2 u em 0,12 s com rastro branco, volta em 0,25 s |
| Dano | recua 0,15 u em 0,08 s, piscar branco 2× (0,05 s cada), achatar Y 0,9 por 0,1 s |
| Desmaio | 0,0–0,35 s: tomba de lado (rot Z 90°) com pequeno quique; olhos viram "espiral" (trocar por toro fino preto) ou fecham (escala Y 0,1); 0,8 s: encolhe e some (ou entra na bola) |

### Combate e IA (modo hordas)
- **Arquétipo: atirador ágil que foge (kiter)**. Velocidade base 90, a maior da floresta.
- Distância preferida 3–5 u; se o jogador chega a < 2 u, recua 2 u em 0,4 s antes de atacar de novo.
- Golpe à distância a cada 2,0 s (no projeto: `Shock Wave` no Nv 11–15 via `moveFxWildMove`). Contato com ele: 30% de chance de paralisia (Static).
- Grupos de 3+ Pikachu: a cada 10 s, uma descarga em círculo r = 3 u ao redor do grupo (eco da Pokédex: "vários juntos causam tempestades").
- Justificativa: Pokédex (arisco, solta eletricidade quando ameaçado) + Static.

## 6. Grau de confiança

**Alto** para altura, peso, tipo e silhueta. **Médio** para cores exatas e proporções (estimadas da arte oficial por memória). Arquétipo de IA: decisão criativa apoiada na Pokédex.

## 7. Diferenças entre versões

- G1 (arte de Sugimori 1996): Pikachu mais gordo e redondo. Desde G6 e no anime atual: mais esguio, pescoço visível. **Recomendação: usar o modelo esguio moderno** (é o que o público reconhece hoje).
- Fêmea (desde G4): ponta da cauda com recorte em forma de coração. Opcional.
- Anime: Pikachu do Ash não entra na Poké Bola e anda no ombro; nos jogos 3D, só em Let's Go/Yellow ele segue o jogador.
- Projeto: evolui no Nv 22 (oficial: Pedra do Trovão).
