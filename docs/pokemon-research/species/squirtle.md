# Squirtle (#007) · Água

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Tartaruguinha bípede azul-clara com **casco marrom** e **cauda enrolada**. Inicial de Kanto. Não é selvagem na floresta. Squirtle → Wartortle (Nv 16) → Blastoise (Nv 36). Água é neutra/fraca contra a floresta (Inseto neutro, Planta resiste): escolha "difícil" para a horda.

## 2. Fontes consultadas

- Busca de peso: **sem resultado para Squirtle** → 0,5 m e 9,0 kg são **conhecimento prévio, não verificado nesta sessão**.
- Pokédex e aparência: conhecimento prévio.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,5 m / 9,0 kg | conhecimento prévio |
| Tipo | Água | oficial e no jogo |
| Evolução | Wartortle Nv 16, Blastoise Nv 36 | oficial; igual no jogo |
| Habilidade | Torrent (Rain Dish oculta) | conhecimento prévio |
| Golpes típicos | Tackle, Tail Whip, Water Gun, Withdraw, Bubble, Bite, Rapid Spin, Water Pulse, Hydro Pump | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): o casco endurece depois que nasce; recolhe-se no casco para se proteger e contra-atacar; o formato arredondado do casco reduz o atrito na água; jorra espuma/água pela boca com precisão.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: bípede baixinho com **casco oval nas costas** (aba clara em volta) e **cauda enrolada para cima**; cabeça grande e redonda.
- Pele azul-clara; olhos grandes castanho-avermelhados; casco marrom-alaranjado por cima com borda branca-creme; plastrão (barriga) amarelo-creme com sulcos.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,5 = **0,88 u**.

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça | 0,45 |
| Casco/tronco | 0,40 altura, 0,45 largura, 0,40 profundidade |
| Pernas | 0,18 |
| Braços | 0,20 |
| Cauda | 0,35 (enrolada) |

### Cores
| Parte | Hex |
|---|---|
| Pele | `#7CC6E6` |
| Casco (costas) | `#B47A3A` |
| Borda do casco | `#F2EEDC` |
| Plastrão | `#F2D98C`, sulcos `#C8A85A` |
| Olhos | íris `#8A3A2A`, pupila `#1E1E1E`, brilho `#FFFFFF` |
| Água (golpes) | `#3F9BFF` → `#CFF0FF` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Plastrão | esfera (0,20, 0,22, 0,10) | — | (0, 0,34, 0,08) | creme |
| 2 | Casco | esfera (0,23, 0,23, 0,18) | — | (0, 0,36, −0,08) | marrom |
| 3 | Borda | toro (r 0,22, tubo 0,035), girado para ficar na vertical, envolvendo o encontro casco/plastrão | — | (0, 0,36, 0,0) | borda |
| 4 | Cabeça | esfera (0,22, 0,21, 0,20) | — | (0, 0,74, 0,06) | pele |
| 5–6 | Olhos | esfera (0,05, 0,065, 0,02) | — | (±0,09, 0,78, 0,23) | olho |
| 7–8 | Braços | cil(0,045, 0,20) com mão esfera 0,05 | — | (±0,22, 0,44, 0,04), para os lados-baixo 40° | pele |
| 9–10 | Pernas | esfera (0,08, 0,10, 0,09) | — | (±0,11, 0,09, 0,02) | pele |
| 11 | Cauda | `TubeGeometry` em espiral (1 volta, r 0,10 H), tubo 0,05 → 0,02 H | — | sai de (0, 0,14, −0,20), enrola para cima e para trás | pele |
| 12–14 | Sulcos do plastrão | caixas finas (0,24, 0,01, 0,01) | — | y 0,28, 0,36, 0,44 | sulco |
| 15 | Hexágonos do casco (opcional) | `CanvasTexture` com linhas | — | — | `#8A5A28` |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | balanço lateral ±3° a 0,7 Hz ("gingado"); cauda acompanha com atraso |
| Andar | bípede curto, 3,5 passos/s, quique 0,05 H, rot Z ±5° alternada (passinho de tartaruga); 1,3 u/s |
| Recolher (Withdraw) | 0,0–0,2 s: cabeça, braços, pernas e cauda escalam para 0 e entram no casco (posição → centro); casco brilha; volta em 0,25 s |
| Giro Rápido (Rapid Spin) / deslocar no casco | recolhido, gira em Y a 4 voltas/s e desliza 4 u/s |
| Pistola d'Água | cabeça recua 8°, bochechas incham (escala X 1,1), jato em linha (ver `attacks/hydro-pump.md`, versão pequena) |
| Dano | recua 0,15 u, olhos fecham 0,1 s |
| Desmaio | cai de costas **sobre o casco** e balança 2× como bacia (rot X ±20° amortecido), membros relaxam |

### Combate e IA (modo hordas)
- Como Pokémon do jogador: **tanque de linha** — Water Gun/Hydro Pump em linha, Withdraw (−50% de dano por 1,5 s, recarga 6 s), Rapid Spin (corre em círculo/linha empurrando inimigos).
- Como inimigo: tanque lento que se recolhe quando o jogador ataca (a cada 3 golpes recebidos, Withdraw por 1,5 s) e responde com jato em linha de 6 u.
- **Torrent**: golpes de Água 1,5× com HP ≤ 1/3 (sinal visual: gotas orbitando).

## 6. Grau de confiança

**Médio**: dados físicos não verificados nesta sessão; aparência inconfundível.

## 7. Diferenças entre versões

- G1: cabeça menor, cauda mais grossa. Moderno: mais "fofo".
- Anime: Esquadrão Squirtle com óculos escuros — acessório do anime, não usar como padrão.
- Projeto: nada divergente.
