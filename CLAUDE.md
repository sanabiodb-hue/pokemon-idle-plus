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
O Chefe é a sessão principal: agente `chief-director` em `claude-fable-5-2`, fixado em `.claude/settings.json` (`"agent"` e `"model"`). Só o Chefe usa Fable 5.2. Ele planeja, delega, revisa, integra e commita.

| Agente | Modelo padrão | Troca permitida pelo Chefe | Papel neste projeto |
|---|---|---|---|
| `pesquisador` | `claude-haiku-5-5` | nenhuma | mapear arquivos, buscas, resumir logs (somente leitura) |
| `arquiteto` | `claude-sonnet-5-5` | Opus, só com aprovação explícita do usuário | contrato técnico em `docs/` |
| `frontend` | `claude-sonnet-5-5` | nenhuma | HTML/CSS, HUD, telas, cenas e efeitos 3D |
| `backend` | `claude-sonnet-5-5` | nenhuma | regras do jogo, simulação, economia, automação, save |
| `qa` | `claude-haiku-5-5` | Sonnet para criar/corrigir testes complexos | rodar testes e triar falhas |
| `seguranca` | `claude-haiku-5-5` | Sonnet para auditar o `git diff` | segredos, dependências, saneamento, saves |
| `devops` | `claude-haiku-5-5` | Sonnet para criar/editar CI/CD | ambiente, servidor local, carregamento, Git |

Especialistas de apoio, mantidos para trabalho que peça o conhecimento deles (todos em `claude-sonnet-5-5`, `technical-researcher` em `claude-haiku-5-5`): `game-3d-engineer`, `art-animation-3d`, `gameplay-developer`, `ui-ux-specialist`, `economy-balancing`, `performance-engineer`, `pokemon-world-researcher`, `qa-test-automation`, `technical-researcher`.

O projeto não tem servidor, banco de dados, Dockerfile nem pipeline: "backend" é a camada de regras e o save no navegador; "devops" confere ambiente e publicação estática. A troca de modelo é feita pelo Chefe no parâmetro `model` da delegação; para mudar o padrão, edite a linha `model:` do arquivo do agente.

### Regras de trabalho e de economia de tokens
- No máximo 3 subagentes simultâneos por lote. Tarefas independentes em paralelo; dois agentes nunca alteram o mesmo arquivo no mesmo lote.
- Opus nunca em rotina. Só no `arquiteto`, para decisão arquitetural crítica, depois de o usuário aprovar.
- Delegação com escopo fechado: objetivo exato, arquivos que pode ler, arquivos que pode alterar e o trecho do contrato. O Chefe nunca repassa o histórico da conversa.
- Cada agente entrega um relatório curto e encerra. Nada de agente ocioso.
- Etapas: 1) pesquisa e arquitetura → 2) implementação paralela → 3) QA, Segurança e DevOps → 4) checkpoint de entrega (o Chefe integra e commita).
- O `qa` roda os testes antes de qualquer aprovação. Commit só depois de `npm test`, `npm run validate`, `git diff --check` e `npm run smoke` passarem.
- Arquivos compartilhados têm um dono por lote: `index.html`, `css/style.css`, `js/ui.js`, `tools/load-context.js`, `tests/smoke/smoke.js`.
- Especialista não commita, não faz push e não usa comando destrutivo do Git.
- O Chefe decide o que é técnico e rotineiro. Consulta o dono do projeto só por preferência dele, acesso externo, custo adicional (incluindo usar Opus) ou risco de perda de dados.
- Subagente não chama subagente: quem delega é sempre a sessão principal.
- Não há ferramenta nativa para consultar o limite de uso; o controle é pelo tamanho dos lotes e por commits a cada etapa.
