# Rift Tamers

Idle 3D de criaturas geradas por genoma, no navegador (Three.js/WebGL, sem servidor).

## Jogar
- Arquivo único: `dist/index.html` (abra direto no navegador).
- Desenvolvimento: `npm run serve` e abra `http://localhost:8080`.
- Testes: `npm test` · Build: `node tools/build.mjs` · Ritmo idle: `node tools/pacing.js 12`.

## O que tem
- **Criaturas procedurais em 3D**: 6 corpos × 10 tipos = 60 espécies, cada indivíduo único (cores, padrões, chifres, asas, cauda, potenciais). Prismáticas (1/512) com brilho iridescente.
- **Evolução** em 3 formas (níveis 30 e 90), com nome, tamanho e partes novas.
- **Mapa de Caça**: mundo 3D explorável com treinador, mato alto, criaturas selvagens visíveis, encontros aleatórios, alfas, itens no chão e cristal de cura. Batalha clássica por turnos (Lutar / Orbe / Trocar / Fugir, PP, status) e captura com orbe que balança 3 vezes.
- **Arena idle**: batalhas automáticas 3v3 em tempo contínuo, Sincronia manual, 10 zonas × 25 estágios, chefes a cada 10.
- **Offline real**: ao voltar, o jogo simula cada luta que teria acontecido (limite de 8 h + perks).
- **Santuário** 3D com produção passiva, **Fusão genética**, **Expedição roguelike** (10 andares, relíquias empilháveis, Ovo da Fenda), **Colapso** (prestígio com 8 perks), **Genodex** (+2% por espécie), 19 conquistas, Maré da Fenda (tipo bônus a cada 10 min), som sintetizado, qualidade gráfica automática, layout de celular.

## Código
`src/` lógica pura (genome, battle, wild, game) testável no Node; `src/render/` Three.js (creature, world, scene, overworld); `src/main.js` e `src/hunt.js` interface.
