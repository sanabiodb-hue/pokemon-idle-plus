# Pokémon Idle Plus 3D

Jogo idle de Pokémon no navegador, com mundo 3D para explorar e batalhas em 3D. Relatórios, commits e textos da interface em português do Brasil.

## Tecnologia (o que existe de verdade)
- JavaScript puro em scripts clássicos carregados por `index.html`, na ordem. Sem framework, sem bundler, sem etapa de build, sem dependência em tempo de execução.
- 3D com Three.js r170, copiado em `js/vendor/three.module.min.js` e carregado sob demanda com `import()` em `window.THREE`.
- Não há motor de física nem arquivos de modelo 3D: o cenário é gerado em código a partir de mapas ASCII, os treinadores são modelos procedurais e os Pokémon são sprites PNG em billboard (`sprites/`).
- A interface (abas, painéis, HUD) é HTML e CSS (`css/style.css`). O mapa 2D em Canvas (`js/world/`) continua existindo e fornece o motor de movimento e colisão que o 3D usa.

## Mapa do código
- `js/game-core.js`: regras do idle (batalha automática, EXP, evolução, captura, ouro). `js/save-manager.js`: save, migração, importação e exportação.
- `js/pokemon-data.js`, `js/route-data.js`, `js/game-config.js`: 1.073 Pokémon, 10 regiões, 192 rotas, golpes (`SKILL_DATA`).
- `js/explore/`: modo Explorar 3D. `explore-core.js` (regras puras: batalha por turnos, treinadores, ginásios, insígnias, mapas próprios), `explore-3d.js` (cena), `explore-view.js` (fluxo e HUD), `explore-quality.js` (presets e teto de quadros), `explore-ambience.js` (dia e noite, música sintetizada).
- `js/battle3d/battle-stage.js`: arena 3D da aba de batalha (só desenha os eventos do `GameCore`).
- `js/fx/move-fx.js`: formato e área de cada golpe (parte pura) e o desenho dos efeitos.
- `js/world/`: mapas ASCII, biomas, geração, movimento, colisão, busca de caminho.
- `js/economy/`, `js/automation/`, `js/hunt-center.js`, `js/hunt-view.js`, `js/ui.js`: economia, automação, caça e interface.
- `tests/*.test.js`: testes no Node (`node:test`), que carregam o jogo num contexto `vm` por `tools/load-context.js`. `tests/smoke/smoke.js`: teste no navegador com Playwright.

## Comandos
- `npm test`: testes unitários (segundos).
- `npm run validate`: valida os dados do jogo.
- `npm run smoke`: navegador headless, cerca de 12 minutos. Não edite arquivos carregados pelo navegador enquanto ele roda.
- `git diff --check`: sem espaços sobrando.
- Rodar o jogo: `python3 -m http.server 8090` na raiz e abrir `http://localhost:8090`.

## O que não pode quebrar
- Saves antigos continuam carregando. Campo novo é opcional e saneado; nada é gravado quando está vazio.
- Os 1.073 Pokémon, as regiões e rotas, captura, combate, evolução, automação, economia e o mapa 2D.
- A cena só desenha: regra de jogo fica no núcleo, como função pura com teste.
- Cena parada ou invisível não pede quadros (`requestAnimationFrame`) nem mantém timer. O smoke conta isso.
- Tudo o que entra numa cena 3D é descartado (`dispose`) ao sair.
- Efeitos que valem só no modo Explorar não mudam os números do idle.
- Arte, música e mapas são originais, feitos em código. Nada copiado de jogos existentes.

## Equipe de agentes (`.claude/agents/`)
A sessão principal age como Diretor de Desenvolvimento (`chief-director`, Fable 5.2): planeja, delega, revisa, integra e commita. Para abrir uma sessão já nesse papel: `claude --agent chief-director`.

| Agente | Modelo | Área |
|---|---|---|
| `chief-director` | `claude-fable-5-2` | direção, delegação, revisão e integração |
| `game-3d-engineer` | `claude-opus-5-5` | cenas, câmera, luz, colisão, sistemas 3D |
| `gameplay-developer` | `claude-sonnet-5-5` | combate, captura, evolução, progressão |
| `art-animation-3d` | `claude-opus-5-5` | visual 3D, materiais, animações, efeitos |
| `qa-test-automation` | `claude-sonnet-5-5` | testes, regressões, smoke |
| `ui-ux-specialist` | `claude-sonnet-5-5` | HUD, menus, painéis, mobile, acessibilidade |
| `economy-balancing` | `claude-opus-5-5` | economia, recompensas, raridades |
| `performance-engineer` | `claude-sonnet-5-5` | FPS, memória, carregamento |
| `technical-researcher` | `claude-haiku-5-5` | pesquisa e levantamento (somente leitura) |
| `pokemon-world-researcher` | `claude-opus-5-5` | fidelidade ao universo Pokémon: espécies, golpes, habitats; escreve em `docs/pokemon-research/` |

Para trocar o modelo de um agente, edite a linha `model:` do arquivo dele.

### Regras de trabalho
- O Diretor decide o que é técnico e rotineiro sem consultar o dono do projeto. Consulta só por preferência dele, acesso externo, custo adicional ou risco de perda de dados.
- Tarefas independentes rodam em paralelo. Dois agentes nunca escrevem no mesmo arquivo na mesma rodada.
- Arquivos compartilhados têm um dono por rodada: `index.html`, `css/style.css`, `js/ui.js`, `tools/load-context.js`, `tests/smoke/smoke.js`.
- Especialista não commita nem faz push, e não usa comando destrutivo do Git. Entrega um relatório com o que fez, o que rodou e o que não verificou.
- O Diretor confere o diff e roda os testes antes de integrar. Commit só depois de `npm test`, `npm run validate`, `git diff --check` e `npm run smoke` passarem.
- Subagente não chama subagente: quem delega é sempre a sessão principal.
