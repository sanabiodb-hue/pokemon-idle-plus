# Charmander (#004) · Fogo

> Convenções (H, eixos, escala, primitivas): ver o topo de `species/pikachu.md`.

## 1. Descrição

Lagartinho bípede laranja com **chama acesa na ponta da cauda**. Inicial de Kanto. Não é selvagem na Floresta de Viridian. Charmander → Charmeleon (Nv 16) → Charizard (Nv 36). Fogo é super efetivo contra todos os Inseto/Planta da floresta: é a escolha "fácil" para a horda.

## 2. Fontes consultadas

- Busca de peso: **sem resultado para Charmander** → 0,6 m e 8,5 kg são **conhecimento prévio, não verificado nesta sessão**.
- Pokédex e aparência: conhecimento prévio.

## 3. Características oficiais confirmadas

| Dado | Valor | Status |
|---|---|---|
| Altura / peso | 0,6 m / 8,5 kg | conhecimento prévio |
| Tipo | Fogo | oficial e no jogo |
| Evolução | Charmeleon Nv 16, Charizard Nv 36 | oficial; igual no jogo |
| Habilidade | Blaze (Solar Power oculta) | conhecimento prévio |
| Golpes típicos | Scratch, Growl, Ember, Smokescreen, Dragon Breath, Fire Fang, Slash, Flamethrower | conhecimento prévio |

Pokédex (minhas palavras, conhecimento prévio): a chama da cauda mostra a força vital; se apagar, ele morre; a chama fica mais forte quando está bravo ou animado; prefere lugares quentes; na chuva, sai vapor da ponta da cauda.

## 4. Referências visuais (descritas em texto)

- **Silhueta**: bípede de cabeça grande e redonda, **cauda grossa curvando para cima com uma chama** na ponta. De longe, o ponto de luz laranja da cauda é a assinatura.
- Pele laranja; barriga e sola dos pés creme-amarelado; olhos grandes azuis (íris) com pupila escura; braços curtos com 3 garras.

## 5. Recomendações para implementação 3D

**H** = 0,5 + 0,75 × 0,6 = **0,95 u** (até o topo da cabeça; a chama pode passar).

### Proporções
| Parte | Fração de H |
|---|---|
| Cabeça | 0,42 |
| Tronco | 0,38 |
| Pernas | 0,20 |
| Braços | 0,20 |
| Cauda | 0,50 (comprimento), chama 0,25 |

### Cores
| Parte | Hex |
|---|---|
| Pele | `#F28A3C` |
| Barriga, solas | `#F8DE9A` |
| Olhos | íris `#2E6BC8`, pupila `#1E1E1E`, brilho `#FFFFFF` |
| Garras | `#FFFFFF` |
| Chama (fora → dentro) | `#FF5A1A` → `#FF9A2A` → `#FFE36A` (miolo) |
| Boca interna | `#C8443A` |

### Receita em primitivas
| # | Parte | Forma | Tamanho (×H) | Posição (x, y, z ×H) | Cor |
|---|---|---|---|---|---|
| 1 | Tronco | esfera (0,17, 0,20, 0,16) | — | (0, 0,34, 0) | pele |
| 2 | Barriga | esfera (0,12, 0,15, 0,06) | — | (0, 0,32, 0,12) | creme |
| 3 | Cabeça | esfera (0,21, 0,20, 0,21) | — | (0, 0,76, 0,04) | pele |
| 4 | Focinho | esfera (0,14, 0,09, 0,10) | — | (0, 0,70, 0,18) | pele |
| 5–6 | Olhos | esfera (0,045, 0,06, 0,02) | — | (±0,09, 0,80, 0,20) | íris + pupila |
| 7–8 | Braços | cil(0,035, 0,20), ponta com 3 cones brancos | — | (±0,16, 0,46, 0,06), para frente-baixo 30° | pele |
| 9–10 | Pernas | esfera (0,07, 0,10, 0,08) | — | (±0,10, 0,10, 0,0) | pele |
| 11–12 | Pés | esfera (0,06, 0,03, 0,09) | — | (±0,10, 0,02, 0,06) | creme |
| 13 | Cauda base | cil(0,07 → 0,04, 0,30) | — | de (0, 0,18, −0,14) para (0, 0,30, −0,40) | pele |
| 14 | Cauda ponta | cil(0,04 → 0,03, 0,18) | — | curvando para cima até (0, 0,46, −0,46) | pele |
| 15 | Chama (fora) | cone(0,09, 0,26) | — | (0, 0,60, −0,46) | `#FF5A1A`, aditivo |
| 16 | Chama (dentro) | cone(0,05, 0,16) | — | (0, 0,56, −0,46) | `#FFE36A`, aditivo |
| 17 | Luz | `PointLight` `#FF8A2A`, intensidade 0,6, alcance 2,5 u (só no Pokémon do jogador e em chefes; nos selvagens, um disco aditivo no chão) | — | na chama | |

### Animação por código
| Estado | Receita |
|---|---|
| Repouso | chama tremula: escala Y 1 ± 0,15 com ruído (2 senos de 7 e 11 Hz), rot Y aleatória; corpo balança ±2° |
| Andar | bípede, 3 passos/s, quique 0,04 H, cauda balança ±12° em Y em contrafase; 1,6 u/s |
| Correr | inclinação 15°, braços para trás, 4,5 passos/s; 2,4 u/s |
| Brasa (Ember) | cabeça recua 10° (0,12 s), boca abre (focinho separado em 2 metades ou escala), 3 bolinhas de fogo saem em sequência (0,06 s entre elas) |
| Lança-chamas | ver `attacks/flamethrower.md` |
| Arranhão | braço sobe 60° e desce em 0,1 s; 3 riscos brancos no alvo |
| Dano | recua 0,15 u; chama encolhe para 0,6 por 0,2 s |
| Desmaio | cai sentado e depois de costas; **chama diminui para 0,3** (não apaga — a Pokédex diz que apagar = morrer; não mostrar isso) |

### Combate e IA (modo hordas)
- Como Pokémon do jogador: **atirador de curto alcance em cone** (Ember em leque estreito, Flamethrower em linha). Super efetivo contra toda a floresta.
- Como inimigo (se usado em outra região): mantém 2–3 u e sopra fogo; deixa chão em brasa por 2 s (decisão criativa).
- **Blaze** (oficial): golpes de Fogo 1,5× com HP ≤ 1/3 → chama da cauda cresce 1,5× e fica mais branca quando ativo (sinal visual).

## 6. Grau de confiança

**Médio**: dados físicos não verificados nesta sessão; aparência inconfundível.

## 7. Diferenças entre versões

- G1: mais "réptil", cabeça menor. Moderno: cabeça maior, olhos azuis grandes.
- Anime: Charmander abandonado na chuva (ep. 11) — a chama fraca na chuva; reforça "chama = vida".
- Projeto: na chuva/noite, a chama pode soltar vapor (partículas cinza `#D8D8D8`) — fiel à Pokédex.
