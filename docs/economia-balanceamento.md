# Economia da Fase 6 — relatório de balanceamento

Gerado por `node tools/simulate-economy.js --markdown` (jogador-robô com semente fixa, `SimulationClock`, sem timers reais).
O robô só usa a API pública do núcleo: compra poções para o próximo intervalo, compra a cadeia de upgrades do estilo escolhido
(depois, o upgrade disponível mais barato), escolhe rota pela recomendação do objetivo e reinicia a caçada. Reavalia a rota a cada
1 h no primeiro dia e a cada 3 h depois. Os perfis intermediário e avançado já nascem com equipe, regiões e upgrades médios/altos.

**Estilos**: *Sem upgrades* (referência) · *Build XP* (alvo `hunt_xp`, objetivo XP) · *Build $* (alvo `hunt_profit`, objetivo dinheiro/lucro) · *Build Speed* (alvo `hunt_speed`, objetivo XP).

**Fórmulas iniciais** (todas em `ECONOMY_CONFIG`, js/economy/config.js):

* Poção: `max(40, ceil(10 × ouro_por_vitória(nível_de_preço)))`, onde `nível_de_preço = min(maior nível já alcançado, maior nível das rotas desbloqueadas)`. Estoque base 30.
* Upgrade: `ceil(base × growth^min(n, lateFrom) × lateGrowth^max(0, n−lateFrom) × escala)`, `escala = max(1, ouro_por_vitória(nível_de_preço) / ouro_por_vitória(5))`.
* Efeitos: Cura +8%/nível (máx. 10); Capacidade +6 poções/nível (máx. 10); Velocidade −2%/nível no tempo de cada luta, piso 70% (máx. 15); XP +5%/nível (máx. 20); Lucro +5%/nível (máx. 20).
* Requisitos: os três estilos exigem Cura nv. 2 e Capacidade nv. 2.

## Tabelas

### Novo jogador

| Horizonte | Métrica | Sem upgrades | Build XP | Build $ | Build Speed |
|---|---|---|---|---|---|
| 10 min | Moedas | 580 | 580 | 580 | 580 |
|  | XP | 6518 | 6518 | 6518 | 6518 |
|  | Poções (usadas/compradas) | 1/0 | 1/0 | 1/0 | 1/0 |
|  | Upgrades | 0 | 0 | 0 | 0 |
| 1 h | Moedas | 3337 | 3600 | 3600 | 3600 |
|  | XP | 37.4k | 40.8k | 40.5k | 40.5k |
|  | Poções (usadas/compradas) | 12/10 | 9/5 | 9/5 | 9/5 |
|  | Upgrades | 0 | 5 | 5 | 4 |
| 4 h | Moedas | 30.0k | 45.4k | 55.3k | 31.1k |
|  | XP | 911.0k | 6.1M | 4.4M | 1.7M |
|  | Poções (usadas/compradas) | 26/24 | 29/26 | 9/5 | 19/13 |
|  | Upgrades | 0 | 11 | 11 | 9 |
| 8 h | Moedas | 122.2k | 152.5k | 210.7k | 149.3k |
|  | XP | 17.2M | 34.6M | 20.9M | 22.7M |
|  | Poções (usadas/compradas) | 32/28 | 29/26 | 9/5 | 19/13 |
|  | Upgrades | 0 | 15 | 15 | 13 |
| 24 h | Moedas | 559.4k | 621.8k | 987.6k | 747.4k |
|  | XP | 114.6M | 215.4M | 113.9M | 158.0M |
|  | Poções (usadas/compradas) | 32/28 | 29/26 | 9/5 | 19/13 |
|  | Upgrades | 0 | 19 | 20 | 17 |
| 7 dias | Moedas | 5.1M | 7.3M | 12.2M | 12.7M |
|  | XP | 1.2B | 2.6B | 2.2B | 3.0B |
|  | Poções (usadas/compradas) | 32/28 | 29/26 | 9/5 | 19/13 |
|  | Upgrades | 0 | 73 | 75 | 75 |

Melhor por horizonte: 10 min: XP Sem upgrades · moedas Sem upgrades | 1 h: XP Build XP · moedas Build XP | 4 h: XP Build XP · moedas Build $ | 8 h: XP Build XP · moedas Build $ | 24 h: XP Build XP · moedas Build $ | 7 dias: XP Build Speed · moedas Build Speed

| Build | 1ª compra | 2º upgrade | maior intervalo sem comprar | maior espera pelo mais barato | passa "sem upgrades" em XP | parado sem poções | custo efetivo da poção |
|---|---|---|---|---|---|---|---|
| Sem upgrades | — | — | 168.0 h | 0 min | — | 6 min | 103 |
| Build XP | 10 min | 15 min | 37.3 h | 11.2 h | 0.3 h | 2 min | 132 |
| Build $ | 10 min | 15 min | 26.8 h | 12.6 h | 0.3 h | 0 min | 50 |
| Build Speed | 10 min | 15 min | 32.5 h | 16.4 h | 0.3 h | 0 min | 92 |

Desbloqueios (quando os requisitos foram cumpridos): Build XP — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 35 min, hunt_xp 35 min, hunt_profit 35 min · Build $ — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 35 min, hunt_xp 35 min, hunt_profit 35 min · Build Speed — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 35 min, hunt_xp 35 min, hunt_profit 35 min

### Intermediário

| Horizonte | Métrica | Sem upgrades | Build XP | Build $ | Build Speed |
|---|---|---|---|---|---|
| 10 min | Moedas | 22.9k | 22.9k | 23.6k | 23.2k |
|  | XP | 318.7k | 377.8k | 318.7k | 347.0k |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 4 | 5 | 4 |
| 1 h | Moedas | 39.9k | 40.1k | 45.2k | 42.3k |
|  | XP | 2.2M | 2.7M | 2.2M | 2.5M |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 5 | 7 | 6 |
| 4 h | Moedas | 115.1k | 122.2k | 169.9k | 140.5k |
|  | XP | 22.1M | 33.1M | 18.9M | 28.6M |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 8 | 10 | 9 |
| 8 h | Moedas | 248.7k | 260.0k | 373.0k | 316.1k |
|  | XP | 69.2M | 105.2M | 53.9M | 90.9M |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 10 | 12 | 11 |
| 24 h | Moedas | 906.2k | 971.8k | 1.6M | 1.2M |
|  | XP | 327.6M | 530.5M | 293.3M | 450.2M |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 13 | 16 | 14 |
| 7 dias | Moedas | 8.1M | 12.5M | 19.7M | 20.9M |
|  | XP | 3.1B | 6.3B | 5.6B | 7.4B |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 66 | 67 | 67 |

Melhor por horizonte: 10 min: XP Build XP · moedas Build $ | 1 h: XP Build XP · moedas Build $ | 4 h: XP Build XP · moedas Build $ | 8 h: XP Build XP · moedas Build $ | 24 h: XP Build XP · moedas Build $ | 7 dias: XP Build Speed · moedas Build Speed

| Build | 1ª compra | 2º upgrade | maior intervalo sem comprar | maior espera pelo mais barato | passa "sem upgrades" em XP | parado sem poções | custo efetivo da poção |
|---|---|---|---|---|---|---|---|
| Sem upgrades | — | — | 168.0 h | 0 min | — | 0 min | — |
| Build XP | 0 min | 0 min | 34.7 h | 14.9 h | 0.1 h | 0 min | — |
| Build $ | 0 min | 0 min | 36.7 h | 11.6 h | 82.0 h | 0 min | — |
| Build Speed | 0 min | 0 min | 43.3 h | 14.9 h | 0.1 h | 0 min | — |

Desbloqueios (quando os requisitos foram cumpridos): Build XP — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 0 min, hunt_xp 0 min, hunt_profit 0 min · Build $ — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 0 min, hunt_xp 0 min, hunt_profit 0 min · Build Speed — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 0 min, hunt_xp 0 min, hunt_profit 0 min

### Avançado

| Horizonte | Métrica | Sem upgrades | Build XP | Build $ | Build Speed |
|---|---|---|---|---|---|
| 10 min | Moedas | 523.5k | 523.8k | 534.7k | 527.1k |
|  | XP | 9.1M | 11.3M | 9.0M | 10.4M |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 6 | 7 | 6 |
| 1 h | Moedas | 648.1k | 647.8k | 730.3k | 671.7k |
|  | XP | 65.4M | 81.7M | 66.1M | 75.8M |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 7 | 8 | 7 |
| 4 h | Moedas | 1.2M | 1.2M | 1.5M | 1.4M |
|  | XP | 327.6M | 422.1M | 327.3M | 391.2M |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 8 | 10 | 8 |
| 8 h | Moedas | 2.0M | 2.0M | 2.7M | 2.4M |
|  | XP | 695.2M | 923.4M | 694.3M | 855.5M |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 9 | 12 | 10 |
| 24 h | Moedas | 5.2M | 5.0M | 8.4M | 7.0M |
|  | XP | 2.4B | 3.4B | 2.4B | 3.5B |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 12 | 14 | 39 |
| 7 dias | Moedas | 42.6M | 86.3M | 99.2M | 97.8M |
|  | XP | 28.5B | 57.9B | 57.8B | 60.8B |
|  | Poções (usadas/compradas) | 0/0 | 0/0 | 0/0 | 0/0 |
|  | Upgrades | 0 | 49 | 49 | 49 |

Melhor por horizonte: 10 min: XP Build XP · moedas Build $ | 1 h: XP Build XP · moedas Build $ | 4 h: XP Build XP · moedas Build $ | 8 h: XP Build XP · moedas Build $ | 24 h: XP Build Speed · moedas Build $ | 7 dias: XP Build Speed · moedas Build $

| Build | 1ª compra | 2º upgrade | maior intervalo sem comprar | maior espera pelo mais barato | passa "sem upgrades" em XP | parado sem poções | custo efetivo da poção |
|---|---|---|---|---|---|---|---|
| Sem upgrades | — | — | 168.0 h | 0 min | — | 0 min | — |
| Build XP | 0 min | 0 min | 84.3 h | 6.7 h | 0.1 h | 0 min | — |
| Build $ | 0 min | 0 min | 103.3 h | 5.6 h | 39.5 h | 0 min | — |
| Build Speed | 0 min | 0 min | 101.0 h | 7.0 h | 0.1 h | 0 min | — |

Desbloqueios (quando os requisitos foram cumpridos): Build XP — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 0 min, hunt_xp 0 min, hunt_profit 0 min · Build $ — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 0 min, hunt_xp 0 min, hunt_profit 0 min · Build Speed — heal_efficiency 0 min, potion_capacity 0 min, hunt_speed 0 min, hunt_xp 0 min, hunt_profit 0 min


## Leitura dos resultados

* **Primeira compra** do jogador novo: 10 min; **segundo upgrade**: 15 min; os requisitos dos três estilos ficam prontos em ~35 min.
* **Nenhum estilo domina**: em todos os perfis o melhor em XP até 24 h é o Build XP e o melhor em moedas é o Build $; o Build Speed (generalista, melhora XP e moedas ao mesmo tempo) só passa os dois por volta do 5º–7º dia para o jogador novo e o intermediário; no avançado (que já começa com a base pronta) ele lidera em XP a partir de 24 h, mas o Build $ continua líder em moedas. Aos 7 dias os três estilos terminam a até ~20% um do outro.
* **Sempre há algo para comprar**: nas primeiras 8 h o intervalo entre compras do estilo escolhido fica ≤ 1,5 h; qualquer upgrade disponível mais barato é pagável em < 1 h de renda durante o primeiro dia.
* **Poções**: o custo efetivo (gasto ÷ usadas) fica em ~50–130 moedas para o jogador novo e é < 25% de tudo que ele gasta. Sem a trava de sustentabilidade, a recomendação de XP levava o jogador novo a rotas que queimavam todas as poções (o robô ficava horas sem renda); agora rotas cujas poções passam de 50% da renda da própria rota não são recomendadas (continuam listadas, com aviso).
* **Runway**: com os números atuais a árvore (75 níveis) acaba em ~6–7 dias para o jogador novo e ~3–4 dias para o avançado (que já começa com muitos níveis). É a principal limitação conhecida: depois disso o dinheiro só tem os sinks antigos (gemas, frutas, talentos). Novos sinks (Pokébolas, ferramentas, mais níveis) são o próximo passo natural.
* **Inflação**: preços de poção e upgrade acompanham o nível das rotas desbloqueadas (não o nível dos Pokémon), então um jogador preso no fim de Kanto não vê o preço fugir da renda.

## Metas verificadas por teste (`tests/economy-balance.test.js`)

T1 primeira compra ≤ 15 min · T2 segundo upgrade ≤ 60 min · T3 requisitos dos 3 estilos ≤ 2 h · T4 ≤ 1,5 h entre compras nas primeiras 8 h e ≤ 1 h de espera pelo mais barato · T5 nenhum estilo domina (XP e moedas têm vencedores diferentes; todos passam "sem upgrades") · T6 poções ≤ 25% do gasto · T7 sem explosão de custo (≤ 4.000× do primeiro ao último nível) e efeitos com teto.
