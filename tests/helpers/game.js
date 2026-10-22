'use strict';
const { afterEach } = require('node:test');
const { loadGameContext, createMemoryStorage } = require('../../tools/load-context');

// 每个用例结束后统一停掉所有游戏实例的定时器，避免失败的用例遗留常驻定时器卡住进程
const liveGames = [];
afterEach(() => { while (liveGames.length) dispose(liveGames.pop()); });

// 确定性随机数（mulberry32）
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 按固定序列返回随机数（耗尽后重复最后一个值）
function sequenceRng(values) {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
}

function perfectIvs() {
    return { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 };
}
function ivs(v) {
    return { hp: v, atk: v, def: v, spAtk: v, spDef: v, speed: v };
}

// 新建一局游戏（内存存储 + 确定性随机）
function newGame(opts = {}) {
    const storage = opts.storage || createMemoryStorage();
    const ctx = loadGameContext({ storage });
    const game = new ctx.GameCore();
    liveGames.push(game);
    // F9.5: os testes anteriores à captura com bola assumem captura garantida e inventário sem pacote inicial; por padrão o helper liga a flag
    // BALL_CAPTURE_ENABLED=false (comportamento idêntico ao baseline). Os testes da F9.5 pedem `balls: true`.
    if (opts.balls !== true) require('node:vm').runInContext('BALL_CAPTURE_ENABLED = false', ctx.sandbox || ctx);
    // F9.9: os testes anteriores à fase caçam alvos fora da tabela da rota (ex.: Pikachu na rota 1); por padrão o helper desliga as regras de alvo
    // (HUNT_TARGET_RULES_ENABLED = false, comportamento do baseline). Os testes da F9.9 pedem `targetRules: true`.
    if (opts.targetRules !== true) require('node:vm').runInContext('HUNT_TARGET_RULES_ENABLED = false', ctx.sandbox || ctx);
    game.rng = mulberry32(opts.seed ?? 1);
    game.guideAutoUpdate = opts.guide === true;   // 引导奖励会给出战宝可梦加经验，默认关闭以免干扰其他测试的精确断言
    if (opts.load) {
        if (!game.load()) game.initNewGame();
    } else {
        game.initNewGame();
    }
    return { ctx, game, storage };
}

function dispose(game) {
    game.stopBattle();
    if (game.autoSaveTimer) clearInterval(game.autoSaveTimer);
    if (game.saver) game.saver.cancelPending();
}

// 把 [from, to] 范围内所有宝可梦标记为已捕获（Lv1，指定个体值）
function catchRange(game, from, to, ivSet = ivs(0)) {
    for (let id = from; id <= to; id++) {
        if (!game.gameState.caughtPokemon[id]) game.catchPokemonWithIvs(id, 1, ivSet);
    }
}

function setLevel(game, id, level) {
    const st = game.gameState.caughtPokemon[id];
    st.level = level;
    st.exp = game.ctxExp ? game.ctxExp(id, level) : st.exp;
    game._touchSpecies(id);
}

// 等待离线结算结束，返回 offlineEnd 事件数据
function runOffline(game, ms) {
    return new Promise((resolve) => {
        const prev = game.onBattleEvent;
        game.onBattleEvent = (event, data) => {
            if (event === 'offlineEnd') {
                game.onBattleEvent = prev;
                game.stopBattle(); // _finishOfflineSimulation 会重启战斗，测试里立刻停掉
                // 结束事件触发时（startBattle 之前）的存档状态快照
                resolve(Object.assign({}, data, { battleHpAtEnd: plain(game.gameState.battleHp) }));
            }
        };
        game._processOfflineBattles(ms);
    });
}

// 跨 vm 上下文的对象原型不同，deepEqual 前先转成本上下文的普通对象
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// Conta quantos passos do Fast Driver (_fastBattleStep) rodaram no contexto `ctx`. Troca de relógio real por contagem de operações: "termina rápido"
// vira "o trabalho é limitado pelo tempo simulado" (sem girar em falso). Chamar restore() no fim.
function countFastSteps(ctx) {
    const proto = ctx.GameCore.prototype, orig = proto._fastBattleStep;
    let n = 0;
    proto._fastBattleStep = function (s) { n++; return orig.call(this, s); };
    return { count: () => n, restore: () => { proto._fastBattleStep = orig; } };
}

module.exports = { countFastSteps, plain, mulberry32, sequenceRng, perfectIvs, ivs, newGame, dispose, catchRange, setLevel, runOffline, createMemoryStorage };
