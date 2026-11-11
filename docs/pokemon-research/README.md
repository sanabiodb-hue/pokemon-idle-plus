# Pesquisa do Universo Pokémon — índice

## 1. Descrição

Índice dos documentos de referência de fidelidade do Pokémon Idle Plus 3D, escritos pelo Diretor de Pesquisa do Universo Pokémon para a fase F12 (modo de ação 3D com hordas na Floresta de Viridian). Cada documento segue 7 seções: Descrição · Fontes · Características oficiais · Referências visuais · Recomendações 3D · Grau de confiança · Diferenças entre versões. Rótulos usados: **Oficial confirmado**, **Interpretação comum**, **Decisão criativa do projeto**, e "conhecimento prévio, não verificado nesta sessão".

## 2. Fontes consultadas

Situação da rede nas sessões desta pesquisa:
- `WebFetch` **bloqueado** (DNS negado) para todos os domínios tentados: bulbapedia.bulbagarden.net, pokemondb.net, pokemon.com, pokeapi.co, serebii.net, veekun.com, strategywiki.org. Nenhuma página foi aberta por inteiro.
- `WebSearch` **funcionou**: os resumos do buscador confirmaram parte dos dados (lista abaixo). Para verificação completa, os domínios acima precisam ser liberados nas configurações de rede da sessão.

O que foi confirmado por busca (resumo de páginas, não a página inteira):
- Floresta de Viridian: espécies de Red/Blue/Yellow, ausência de Paras na floresta oficial, presença de Pidgeotto raro em Yellow (ver `regions/viridian-forest.md`).
- Habitat e peso de Paras; parte dos dados físicos de Pikachu, Caterpie, Weedle, Butterfree, Beedrill, Rattata, Raichu, Pidgey (detalhes em cada arquivo).
- Golpes que atingem todos os adjacentes, inclusive aliado: Surf, Discharge, Earthquake, Sludge Wave, Bulldoze; Heat Wave como golpe de espalhamento; dano de 75% por alvo em espalhamento (ver `attacks/spatial-reference.md`).

Todo o resto é conhecimento prévio, marcado assim em cada documento.

## 3. Características oficiais confirmadas — índice

| Documento | Conteúdo | Confiança | Para quem |
|---|---|---|---|
| [`regions/viridian-forest.md`](regions/viridian-forest.md) | espécies por jogo, atmosfera, luz, vegetação; comparação com a rota `kanto_viridian_forest`; hordas, 2 elites (Butterfree, Pidgeotto) e chefe (Beedrill Alfa) | médio-alto | game-3d-engineer, gameplay, economy |
| [`species/pikachu.md`](species/pikachu.md) | atirador ágil que foge | alto (dados) / médio (cores) | art-animation-3d, gameplay |
| [`species/caterpie.md`](species/caterpie.md) | enxame lento que prende | alto / médio | idem |
| [`species/weedle.md`](species/weedle.md) | enxame picador (veneno) | alto / médio | idem |
| [`species/metapod.md`](species/metapod.md) | casulo parado que endurece | médio | idem |
| [`species/kakuna.md`](species/kakuna.md) | casulo + espinho de contato (ninho) | médio | idem |
| [`species/butterfree.md`](species/butterfree.md) | suporte que espalha pó (Elite 1) | alto / médio | idem |
| [`species/beedrill.md`](species/beedrill.md) | enxame agressivo, assassino rápido (base do chefe Alfa) | médio-alto | idem |
| [`species/paras.md`](species/paras.md) | tanque lento com esporos | médio-alto | idem |
| [`species/pidgey.md`](species/pidgey.md) | ave de assédio (mergulha e foge) | médio-alto | idem |
| [`species/rattata.md`](species/rattata.md) | enxame rápido de mordida | alto / médio | idem |
| [`species/bulbasaur.md`](species/bulbasaur.md) | inicial Planta (jogável) | médio | idem |
| [`species/charmander.md`](species/charmander.md) | inicial Fogo (jogável) | médio | idem |
| [`species/squirtle.md`](species/squirtle.md) | inicial Água (jogável) | médio | idem |
| [`species/raichu.md`](species/raichu.md) | tanque elétrico de área (chefe-evento, não oficial na floresta) | alto / médio | idem |
| [`attacks/spatial-reference.md`](attacks/spatial-reference.md) | 64 golpes de 8 tipos + Investida: categoria, forma espacial, alcance, alvos oficiais, comparação com `js/fx/move-fx.js` e 15 correções | médio-alto | gameplay-developer, art-animation-3d |

### Pendentes (ainda não escritos)
- `attacks/` detalhados: thunderbolt, thunder, flamethrower, hydro-pump, surf, earthquake, razor-leaf, vine-whip, gust, solar-beam, ice-beam, psychic, shadow-ball, dragon-claw, aura-sphere.
- `visual-style/3d-direction.md`, `animations/battle-animations.md`, `battle-reference/action-hordes.md` (citado por `regions/viridian-forest.md`), `types/type-chart.md`.
- Pastas `habitats/` ainda vazias.

## 4. Referências visuais (descritas em texto)

Nenhuma imagem, modelo, textura ou som foi copiado para o repositório. Todas as referências visuais estão descritas em texto dentro de cada documento.

## 5. Recomendações para implementação 3D — resumo

1. **Formatos de golpe**: corrigir em `js/fx/move-fx.js` primeiro Blast Burn (`nova` → `nova@t`), Wave Crash e Bolt Strike (→ `strike`, são investidas), Shock Wave (não é anel), Overheat e Scald (alvo único → `beam`). Lista completa em `attacks/spatial-reference.md` §5.2.
2. **Regra de área em hordas**: golpe que atinge vários alvos nos jogos oficiais (OA/TA) = área grande; golpe de alvo único = área pequena (r ≤ 1,2 u ou faixa ≤ 1,0 u de largura).
3. **Arquétipos de IA da floresta**: Caterpie/Weedle enxame lento (base da onda), Metapod/Kakuna casulos parados que endurecem (obstáculos), Pidgey assédio aéreo, Pikachu atirador que foge, Butterfree suporte com pó (elite), Beedrill enxame agressivo e rápido (chefe Alfa invoca enxame), Paras/Raichu tanques de área.
4. **Composição da rota**: Paras não é oficial na Floresta de Viridian; Pidgey e as evoluções Butterfree/Beedrill faltam (proposta de pesos em `regions/viridian-forest.md` §5.1).
5. **Escala**: 1 u = 1 quadrado; use as alturas da Pokédex em proporção (ex.: Caterpie 0,3 m e Beedrill 1,0 m) com piso mínimo de leitura descrito em cada espécie.

## 6. Grau de confiança

Geral: **médio-alto** para dados de espécies e alvos de golpes; **médio** para cores, proporções exatas e descrições de animação (memória da arte oficial); arquétipos de IA, elites e chefe são **decisão criativa** apoiada na Pokédex e nos jogos.

## 7. Diferenças entre versões

Cada documento tem sua própria seção 7. Pontos gerais: a Floresta de Viridian muda de população entre Red/Blue, Yellow, HGSS, FRLG e Let's Go; categorias físico/especial seguem a regra da geração IV em diante; poderes seguem a geração IX quando há conflito.
