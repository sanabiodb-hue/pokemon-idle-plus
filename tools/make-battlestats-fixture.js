#!/usr/bin/env node
'use strict';
// ============================================================
// Gera tests/fixtures/legacy-battle-stats.json:
// carrega os saves de fixture (v1 e v2) no CÓDIGO ANTIGO (git) e grava os números que ele calcula
// (stats de batalha, poder, potencial, soma dos níveis...). Os testes da fase 2 comparam o código novo
// com esses números, provando que migrar para "indivíduos" não altera nenhum valor do jogo.
// Uso: node tools/make-battlestats-fixture.js
// ============================================================
const { execSync } = require('child_process');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { ROOT, createMemoryStorage, makeSandbox } = require('./load-context');

const CASES = {
    v1: { ref: '458781e', fixture: 'legacy-localstorage.txt',
          files: ['js/lzstring.min.js', 'js/pokemon-data.js', 'js/route-data.js', 'js/game-config.js', 'js/game-core.js'] },
    v2: { ref: '331011b', fixture: 'legacy-v2-localstorage.txt',
          files: ['js/lzstring.min.js', 'js/util.js', 'js/pokemon-data.js', 'js/route-data.js', 'js/game-config.js', 'js/save-manager.js', 'js/game-core.js'] },
};

const result = {};
for (const [name, c] of Object.entries(CASES)) {
    const code = c.files.map(f => execSync(`git show ${c.ref}:${f}`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')).join('\n;\n')
        + '\n;({ GameCore })';
    const raw = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', c.fixture), 'utf8');
    const storage = createMemoryStorage({ pokemon_idle_save: raw });
    const ctx = vm.runInContext(code, vm.createContext(makeSandbox(storage)), { filename: 'legacy-' + name });
    const game = new ctx.GameCore();
    if (!game.load()) throw new Error('旧代码读取夹具失败: ' + name);
    const gs = game.gameState;
    const team = gs.team.slice();
    result[name] = {
        ref: c.ref,
        team,
        battleStats: team.map((_, i) => {
            const s = game.calculateBattleStats(i);
            return { hp: s.hp, attack: s.attack, defense: s.defense, speed: s.speed };
        }),
        power: team.map(id => game.calculatePower(id, true)),
        potential: team.map(id => game.calculatePotential(id)),
        expProgress: team.map(id => game.getExpProgress(id)),
        totalPokemonLevel: game.getTotalPokemonLevel(),
        skillLevelSum: game.getSkillLevelSum(),
        talentPoints: game.getTotalTalentPoints(),
        pokedex: game.getPokedexStats(),
        shinyCount: game.getShinyStats(),
        goldDropForLevel100: (() => { try { return game.calculateGoldDrop({ level: 100 }); } catch (e) { return null; } })(),
    };
}
fs.writeFileSync(path.join(ROOT, 'tests', 'fixtures', 'legacy-battle-stats.json'), JSON.stringify(result, null, 2) + '\n');
console.log('已生成 tests/fixtures/legacy-battle-stats.json', JSON.stringify(result.v1.battleStats[0]), JSON.stringify(result.v2.battleStats[0]));
