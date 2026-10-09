'use strict';
// F7.9: paridade de combate online × offline. A referência é o combate online (battleTick, ticks de BATTLE_TICK_MS, sobra do relógio
// descartada ao atacar, jogador antes do inimigo e sem contra-ataque do inimigo derrotado). O Fast Driver (_fastBattleStep) deve tomar as
// MESMAS decisões: mesma sequência de ataques, mesmo tempo lógico, mesmo HP/dano, mesmo resultado e a MESMA sequência de chamadas ao RNG.
// Os dois caminhos partem do mesmo estado, da mesma semente e do mesmo RNG instrumentado; nada usa relógio real nem setInterval.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs } = require('./helpers/game');

const TICK = 50;

// Constrói um jogo idêntico para cada caminho. cfg: { interval:{player,enemy}|null, enemyId, enemyLevel, playerLevel, playerHp, dodge, hugeHp }
function build(cfg) {
    const { game, ctx } = newGame({ seed: cfg.seed ?? 5 });
    game.clock = new ctx.ManualClock(1_000_000);
    game.catchPokemonWithIvs(25, cfg.playerLevel ?? 30, ivs(15));
    game.gameState.team = [25];
    game.gameState.activePokemonIndex = 0;
    game._invalidateAllCaches();
    if (cfg.dodge) game.getGemBonuses = () => ({ ...Object.getPrototypeOf(game).getGemBonuses.call(game), dodge_rate: cfg.dodge });
    const wild = Object.assign(game.createWildPokemon(cfg.enemyId ?? 19, cfg.enemyLevel ?? 3, 0), { isShiny: false });
    game.generateWildPokemon = () => JSON.parse(JSON.stringify(wild));
    return { game, ctx };
}

// Instrumentação comum: registra, em ordem, cada ataque (via _computeDamage) e cada chamada ao RNG feita durante o combate.
function instrument(game) {
    const log = { attacks: [], rng: [], on: false, end: null };
    const baseRng = game.rng;
    game.rng = () => { const v = baseRng.call(game); if (log.on) log.rng.push(v); return v; };
    const dmg = game._computeDamage.bind(game);
    game._computeDamage = (...a) => { const r = dmg(...a); if (log.on) log.attacks.push({ lvl: a[0], atk: a[1], def: a[2], power: a[5], damage: r.damage, crit: !!r.criticalHit }); return r; };
    return log;
}

function runOnline(cfg, maxTicks = 100000) {
    const { game } = build(cfg);
    const probe = game.calculateBattleStats(0);
    if (cfg.interval) game.getAttackInterval = (speed) => (speed === probe.speed ? cfg.interval.player : cfg.interval.enemy);
    game.startBattle(); game._stopBattleTimer();
    const b = game.currentBattle, inst = game._partyInstance(0);
    if (cfg.playerHp !== undefined) b.playerCurrentHp = cfg.playerHp;
    if (cfg.hugeHp) { b.wildCurrentHp = b.wildMaxHp = cfg.hugeHp; b.playerCurrentHp = b.playerMaxHp = cfg.hugeHp; }
    const log = instrument(game);
    const end = { kind: null, playerHp: null, ticks: 0 };
    const won = game.onEnemyDefeated.bind(game);
    game.onEnemyDefeated = () => { log.on = false; end.kind = 'victory'; end.playerHp = b.playerCurrentHp; end.wildHp = b.wildCurrentHp; return won(); };
    const fainted = game.onBattleEvent;
    game.onBattleEvent = (e, d) => { if (e === 'playerFainted') { log.on = false; end.kind = 'defeat'; end.playerHp = b.playerCurrentHp; end.wildHp = b.wildCurrentHp; } return fainted && fainted.call(game, e, d); };
    b.lastTick = game.now();
    const t0 = game.now();
    log.on = true;
    for (let i = 0; i < maxTicks && !end.kind; i++) {
        game.clock.advance(TICK); game.battleTick(); end.ticks++;
        if (cfg.limitTicks && end.ticks >= cfg.limitTicks) break;
    }
    log.on = false;
    if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; }
    if (game.healTimer) { clearTimeout(game.healTimer); clearInterval(game.healTimer); game.healTimer = null; }
    return { game, inst, log, kind: end.kind || 'limit', ms: game.now() - t0, playerHp: end.kind ? end.playerHp : b.playerCurrentHp, wildHp: end.kind ? end.wildHp : b.wildCurrentHp };
}

function runFast(cfg) {
    const { game } = build(cfg);
    const probe = game.calculateBattleStats(0);
    if (cfg.interval) game.getAttackInterval = (speed) => (speed === probe.speed ? cfg.interval.player : cfg.interval.enemy);
    const total = cfg.limitTicks ? cfg.limitTicks * TICK : 24 * 3600 * 1000;
    const s = game._buildFastSimState(total, total);
    const inst = s.activeInst;
    if (cfg.playerHp !== undefined) s.playerHp = cfg.playerHp;
    if (cfg.hugeHp) {
        s.playerHp = s.playerStats.hp = cfg.hugeHp;
        const calc = game.calculateStats.bind(game);
        game.calculateStats = (w) => { const st = calc(w); return w && w.level === (cfg.enemyLevel ?? 3) && st && !st.__done ? { ...st, hp: cfg.hugeHp } : st; };
    }
    const log = instrument(game);
    const end = { kind: null, playerHp: null, ms: null };
    const spend = game._fastSpend.bind(game);
    game._fastSpend = (st, ms) => { if (end.ms === null) { end.ms = ms; end.playerHp = st.playerHp; log.on = false; } return spend(st, ms); };
    const rewards = game._processVictoryRewards.bind(game);
    game._processVictoryRewards = (...a) => { end.kind = 'victory'; return rewards(...a); };
    game._getNextBattleDelay = () => 0;
    const faintsBefore = inst.stats.faints;
    log.on = true;
    game._fastBattleStep(s);
    log.on = false;
    if (!end.kind) end.kind = inst.stats.faints > faintsBefore ? 'defeat' : 'limit';
    // o passo que estouraria o limite é truncado pelo tempo restante (o relógio só vai até o limite)
    const ms = cfg.limitTicks ? Math.min(end.ms, cfg.limitTicks * TICK) : end.ms;
    return { game, inst, log, kind: end.kind, ms, playerHp: end.playerHp };
}

// o online limita o HP a 0 ao cair; o offline só zera depois (a cura de derrota o reabastece), então compara-se o HP limitado a 0
const view = (r) => ({ kind: r.kind, ms: r.ms, playerHp: Math.max(0, r.playerHp), attacks: r.log.attacks, rng: r.log.rng,
    dealt: r.inst.stats.damageDealt, taken: r.inst.stats.damageTaken, crits: r.inst.stats.criticalHits, faints: r.inst.stats.faints });

function assertParity(cfg, label) {
    const on = view(runOnline(cfg)), fast = view(runFast(cfg));
    assert.equal(fast.kind, on.kind, `${label}: resultado`);
    assert.equal(fast.ms, on.ms, `${label}: tempo lógico do combate`);
    assert.equal(fast.attacks.length, on.attacks.length, `${label}: nº de ataques`);
    assert.deepEqual(fast.attacks, on.attacks, `${label}: sequência de ataques (quem, dano e crítico)`);
    assert.deepEqual(fast.rng, on.rng, `${label}: ordem e quantidade das chamadas ao RNG (valores incluídos)`);
    assert.equal(fast.playerHp, on.playerHp, `${label}: HP do jogador ao fim do combate`);
    assert.equal(fast.dealt, on.dealt, `${label}: damageDealt`);
    assert.equal(fast.taken, on.taken, `${label}: damageTaken`);
    assert.equal(fast.crits, on.crits, `${label}: críticos`);
    assert.equal(fast.faints, on.faints, `${label}: derrotas`);
    return { on, fast };
}

// =============================================================== A. contra-ataque após a derrota
test('F7.9 A: timers vencendo no mesmo tick — o jogador derrota o inimigo e o inimigo derrotado NÃO contra-ataca (online e offline)', () => {
    const cfg = { interval: { player: 1000, enemy: 1000 }, enemyLevel: 1, playerLevel: 30 };
    const { on, fast } = assertParity(cfg, 'mesmo tick, jogador mata');
    for (const [name, r] of [['online', on], ['offline', fast]]) {
        assert.equal(r.kind, 'victory', name);
        assert.equal(r.ms, 1000, `${name}: o combate acaba no tick em que ambos venciam`);
        assert.equal(r.attacks.length, 1, `${name}: um único ataque (o do jogador)`);
        assert.equal(r.taken, 0, `${name}: damageTaken é zero depois da derrota do inimigo`);
    }
});

test('F7.9 A: no mesmo tick, se o jogador NÃO mata o inimigo, o inimigo ataca depois dele (ordem jogador → inimigo) e pode derrotar o jogador', () => {
    const cfg = { interval: { player: 1000, enemy: 1000 }, enemyId: 19, enemyLevel: 60, playerLevel: 5, playerHp: 1 };
    const { on, fast } = assertParity(cfg, 'mesmo tick, inimigo mata');
    for (const r of [on, fast]) {
        assert.equal(r.kind, 'defeat');
        assert.equal(r.attacks.length, 2, 'jogador ataca e, no mesmo tick, o inimigo ataca');
        assert.ok(r.taken > 0);
    }
});

// =============================================================== B. cadência de ataques
const INTERVALS = [50, 100, 377, 911, 1000, 1999];
for (const interval of INTERVALS) {
    test(`F7.9 B: cadência de 60 s com intervalo de ${interval} ms — mesmos ataques online e offline (e iguais ao esperado pelos ticks)`, () => {
        const cfg = { interval: { player: interval, enemy: interval }, hugeHp: 1e12, limitTicks: 1200 };
        const { on, fast } = assertParity(cfg, `${interval} ms`);
        const ticksPerAttack = Math.ceil(interval / TICK);
        const expectedPerSide = Math.floor(1200 / ticksPerAttack);
        assert.equal(on.attacks.length, expectedPerSide * 2, `online: ${expectedPerSide} ataques por lado`);
        assert.equal(fast.attacks.length, expectedPerSide * 2, `offline: ${expectedPerSide} ataques por lado`);
    });
}

test('F7.9 B: o ritmo online é preservado — 911 ms vira 19 ticks (950 ms), 377 ms vira 8 ticks (400 ms); a sobra é descartada', () => {
    const { ctx } = newGame({ seed: 1 });
    assert.equal(ctx.BATTLE_TICK_MS, 50);
    const k = ctx.battleTicksPerAttack;
    assert.deepEqual([50, 100, 377, 911, 1000, 1999, 1000.0001, 49.9, 1].map(k), [1, 2, 8, 19, 20, 40, 21, 1, 1]);
    assert.equal(k(0), 1); assert.equal(k(NaN), 1); assert.equal(k(-5), 1);
});

// =============================================================== C. comparação completa (referência online × Fast Driver)
const SCENARIOS = {
    'só o jogador pode atacar (inimigo muito lento)': { interval: { player: 400, enemy: 1e9 }, enemyId: 19, enemyLevel: 30, hugeHp: 1e7, limitTicks: 600 },
    'só o inimigo pode atacar (jogador muito lento)': { interval: { player: 1e9, enemy: 400 }, enemyId: 19, enemyLevel: 30, hugeHp: 1e7, limitTicks: 600 },
    'velocidades reais, jogador vence': { enemyId: 19, enemyLevel: 5, playerLevel: 30 },
    'velocidades reais, jogador perde': { enemyId: 19, enemyLevel: 80, playerLevel: 5 },
    'intervalos diferentes e fora do múltiplo de 50 ms (911 × 377)': { interval: { player: 911, enemy: 377 }, enemyId: 19, enemyLevel: 40, playerLevel: 30, playerHp: 5000 },
    'esquiva ativa (RNG da esquiva antes do dano)': { interval: { player: 700, enemy: 450 }, enemyId: 19, enemyLevel: 40, playerLevel: 30, dodge: 50 },
};
for (const [name, cfg] of Object.entries(SCENARIOS)) {
    test(`F7.9 C: ${name} — sequência de ataques, tempo, HP, dano, resultado e consumo do RNG iguais`, () => {
        const { on } = assertParity(cfg, name);
        assert.ok(on.attacks.length > 0, 'houve combate');
        assert.ok(on.rng.length > 0, 'o RNG foi consumido (a comparação não é vazia)');
    });
}

test('F7.9 C: vitória — recompensas e contadores aplicados iguais depois do combate (mesma função de recompensa nos dois caminhos)', () => {
    const cfg = { enemyId: 19, enemyLevel: 5, playerLevel: 30 };
    const on = runOnline(cfg), fast = runFast(cfg);
    const snap = (r) => JSON.stringify({ exp: r.inst.exp, lvl: r.inst.level, totalExp: r.game.gameState.stats.totalExp, money: r.game.gameState.money, pokedex: r.game.gameState.pokedex[19] || null, dealt: r.inst.stats.damageDealt });
    assert.equal(on.kind, 'victory'); assert.equal(fast.kind, 'victory');
    assert.equal(snap(fast), snap(on));
});
