#!/usr/bin/env node
'use strict';
// ============================================================
// 用“重构前”的游戏代码（git 提交 458781e）生成真实的旧版存档，作为兼容性测试夹具：
//   tests/fixtures/legacy-localstorage.txt   旧版写入 localStorage 的原始内容（LZ: 前缀）
//   tests/fixtures/legacy-export.txt         旧版“导出存档”文本（Base64）
//   tests/fixtures/legacy-summary.json       用于断言的关键数据摘要
// 仅在需要重新生成夹具时运行；夹具本身已提交，测试不依赖 git 历史。
// 用法：node tools/make-legacy-fixture.js [v1|v2]
//   v1（默认）：重构前（458781e，无 schemaVersion）→ legacy-*.txt / legacy-summary.json
//   v2：第 1 阶段（331011b，schemaVersion=2，每物种一条 caughtPokemon）→ legacy-v2-*.txt / legacy-v2-summary.json
// ============================================================
const { execSync } = require('child_process');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { ROOT, createMemoryStorage, makeSandbox } = require('./load-context');

const VARIANTS = {
    v1: {
        ref: '458781e',
        prefix: 'legacy',
        files: ['js/lzstring.min.js', 'js/pokemon-data.js', 'js/route-data.js', 'js/game-config.js', 'js/game-core.js'],
    },
    v2: {
        ref: '331011b',
        prefix: 'legacy-v2',
        files: ['js/lzstring.min.js', 'js/util.js', 'js/pokemon-data.js', 'js/route-data.js', 'js/game-config.js', 'js/save-manager.js', 'js/game-core.js'],
    },
};
const variant = VARIANTS[process.argv[2] || 'v1'];
if (!variant) { console.error('用法: node tools/make-legacy-fixture.js [v1|v2]'); process.exit(1); }
const LEGACY_REF = variant.ref;
const files = variant.files;
const code = files
    .map(f => execSync(`git show ${LEGACY_REF}:${f}`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8'))
    .join('\n;\n') + '\n;({ GameCore })';

// 确定性随机：给沙箱一份独立的 Math，不污染宿主
let seed = 20240607;
const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const sandboxMath = Object.create(Math);
sandboxMath.random = rng;

const storage = createMemoryStorage();
const sandbox = makeSandbox(storage);
sandbox.Math = sandboxMath;
const ctx = vm.runInContext(code, vm.createContext(sandbox), { filename: 'legacy-game' });
const game = new ctx.GameCore();
game.initNewGame();
const gs = game.gameState;

// 1) 图鉴：关都全部 + 城都一部分，随机个体值
for (let id = 1; id <= 151; id++) game.catchPokemonWithIvs(id, 1, game.generateIVs());
for (let id = 152; id <= 190; id++) game.catchPokemonWithIvs(id, 1, game.generateIVs());

// 2) 战斗：在 3 号道路打 600 场，产生经验/进化/个体值更新
gs.currentRoute = 'kanto_route3';
const route = game.getRoute('kanto_route3');
for (let i = 0; i < 600; i++) {
    const wild = game.generateWildPokemon(route);
    game._processVictoryRewards(wild, gs.team[gs.activePokemonIndex], 100, 50);
}
// 3) 队伍
[1, 4, 7, 16].forEach(id => game.addToTeamFromPokedex(id));
// 4) 徽章、金币、宝石
game.tryUnlockBadge('kanto');
gs.gold = 500000;
game.buyAllGems();
if (gs.gems.length) game.equipGem('kanto', gs.gems[0].uid);
// 5) 闪光、树果、天赋、挑战塔、设置
gs.shinyDex[25] = true;
gs.pokedexDisplay[25] = 'shiny';
gs.berryPlots = [{ berryId: 'hp_berry', plantedAt: Date.now() - 3600000 }];
gs.berryBag = { atk_berry: 3 };
gs.berryFed = { 25: { atk_berry: 2 } };
gs.talents = { exp_bonus: 5, gemAttrChoice: 'crit_rate' };
gs.tower = { currentFloor: 3, highestFloor: 2, enemies: [150, 151, 249, 250, 384, 385], currentEnemyIndex: 1, inBattle: false };
gs.settings = { autoSwitchBest: true, oneShotStrategy: 'lowest_level', autoRouteSwitch: true, routeSwitchCondition: '6v_only', theme: 'sakura' };
gs.currentEnemy = game.generateWildPokemon(route);

(game.saveNow || game.save).call(game);   // v2 起 save() 是防抖请求，需要 saveNow() 立即写入
const raw = storage.getItem('pokemon_idle_save');
const exported = game.exportSave();
const state = JSON.parse(JSON.stringify(game.gameState));

const summary = {
    legacyRef: LEGACY_REF,
    team: state.team,
    activePokemonIndex: state.activePokemonIndex,
    caughtCount: Object.keys(state.caughtPokemon).length,
    pokedexCaught: Object.values(state.pokedex).filter(v => v === 'caught').length,
    gold: state.gold,
    stats: state.stats,
    shinyDex: Object.keys(state.shinyDex).map(Number),
    gemCount: state.gems.length,
    badges: Object.keys(state.badges),
    equippedGemQuality: state.badges.kanto && state.badges.kanto.gem ? state.badges.kanto.gem.quality : null,
    berryPlots: state.berryPlots.length,
    berryBag: state.berryBag,
    berryFed: state.berryFed,
    talents: state.talents,
    tower: state.tower,
    settings: state.settings,
    currentRoute: state.currentRoute,
    currentEnemyId: state.currentEnemy ? state.currentEnemy.id : null,
    totalLevels: Object.values(state.caughtPokemon).reduce((a, c) => a + c.level, 0),
};

const dir = path.join(ROOT, 'tests', 'fixtures');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${variant.prefix}-localstorage.txt`), raw);
fs.writeFileSync(path.join(dir, `${variant.prefix}-export.txt`), exported);
fs.writeFileSync(path.join(dir, `${variant.prefix}-summary.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(`[${process.argv[2] || 'v1'}] 已生成夹具：${Object.keys(state.caughtPokemon).length} 只宝可梦，localStorage ${raw.length} 字符，导出 ${exported.length} 字符`);
