'use strict';
// F12 · Mundo de Ação: números do balanceamento (js/action/action-balance.js). Medição e justificativa: docs/action/balanceamento.md
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');

const { ctx } = newGame({ seed: 1 });
const B = ctx.get('ACTION_BALANCE');
const fn = (n) => ctx.get(n);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

test('ACTION_BALANCE: todas as chaves do contrato existem com o tipo certo', () => {
    assert.equal(ctx.get('ACTION_STEP'), 1 / 30);
    assert.equal(typeof ctx.get('ACTION_ENABLED'), 'boolean');
    for (const t of ['minion', 'elite', 'boss']) { assert.ok(num(B.hpMul[t]) && B.hpMul[t] > 0, 'hpMul.' + t); assert.ok(num(B.rewardCredit[t]) && B.rewardCredit[t] > 0, 'rewardCredit.' + t); }
    for (const k of ['enemyDamageMul', 'playerDamageMul', 'spawnMinDist', 'thinkPerStep', 'basicInterval', 'captureHpFrac', 'captureRange', 'pickupRadius', 'potionCd', 'playerSpeed', 'enemySpeed', 'accel']) assert.ok(num(B[k]) && B[k] > 0, k);
    for (const q of ['low', 'medium', 'high']) assert.ok(Number.isInteger(B.limit[q]) && B.limit[q] > 0, 'limit.' + q);
    for (const k of ['base', 'growth', 'max', 'eliteEvery', 'bossAt', 'rest']) assert.ok(num(B.wave[k]) && B.wave[k] > 0, 'wave.' + k);
    for (const k of ['dist', 'time', 'cd', 'iframes']) assert.ok(num(B.dash[k]) && B.dash[k] > 0, 'dash.' + k);
    // chave nova da F12 (teto de renda)
    for (const k of ['manual', 'auto', 'windowSec', 'bankMax', 'fallbackPerMin']) assert.ok(num(B.rewardCap[k]) && B.rewardCap[k] > 0, 'rewardCap.' + k);
    for (const f of ['actionSkillCooldown', 'actionEnemyHp', 'actionRewardCapPerMin', 'actionRewardBucket', 'actionVictoryTokenCost', 'actionRouteExpUnits', 'actionEstimateVictoriesPerHour', 'actionIdleVictoriesPerHour']) assert.equal(typeof fn(f), 'function', f);
});

test('valores em faixas sãs (horda, elite, chefe, dano, ondas)', () => {
    assert.ok(B.hpMul.minion < 1 && 1 < B.hpMul.elite && B.hpMul.elite < B.hpMul.boss);
    assert.ok(B.rewardCredit.minion < 1, 'um minion vale menos que uma vitória do idle');
    assert.ok(B.rewardCredit.minion < B.rewardCredit.elite && B.rewardCredit.elite < B.rewardCredit.boss);
    // crédito por "vida oficial derrubada" limitado (o teto é a trava principal; isto evita um crédito absurdo se o teto falhar)
    for (const t of ['minion', 'elite', 'boss']) assert.ok(B.rewardCredit[t] / B.hpMul[t] <= 2, 'crédito/vida de ' + t);
    assert.ok(B.enemyDamageMul > 0 && B.enemyDamageMul <= 0.5);
    assert.equal(B.playerDamageMul, 1, 'o dano do jogador é o oficial');
    assert.ok(B.limit.low < B.limit.medium && B.limit.medium < B.limit.high);
    assert.ok(B.wave.eliteEvery < B.wave.bossAt && B.wave.base <= B.wave.max);
    assert.ok(B.dash.iframes < B.dash.cd && B.basicInterval >= 0.3 && B.basicInterval <= 1.5);
    assert.ok(B.captureHpFrac > 0 && B.captureHpFrac < 1);
    assert.ok(B.rewardCap.manual > B.rewardCap.auto);
    assert.ok(B.rewardCap.manual >= 1.2 && B.rewardCap.manual <= 1.6, 'manual atento: 1,2× a 1,6× o idle');
    assert.ok(B.rewardCap.auto >= 0.9 && B.rewardCap.auto <= 1.1, 'automático: 0,9× a 1,1× o idle');
    assert.ok(B.rewardCap.bankMax >= B.rewardCredit.boss, 'o chefe cabe inteiro no banco');
});

test('actionSkillCooldown: cresce com o poder e fica entre 1 e 12 s', () => {
    const cd = fn('actionSkillCooldown');
    let prev = 0;
    for (let p = 0; p <= 400; p += 5) {
        const c = cd(p);
        assert.ok(c >= 1 && c <= 12, `poder ${p}: ${c}`);
        assert.ok(c >= prev, `não decresce em ${p}`);
        prev = c;
    }
    assert.ok(cd(40) < cd(60) && cd(60) < cd(90) && cd(90) < cd(120) && cd(120) < cd(250));
    assert.equal(cd(60), 3.5); assert.equal(cd(90), 4.5); assert.equal(cd(120), 5.5);
    for (const bad of [undefined, null, NaN, -50, 'x']) { const c = cd(bad); assert.ok(c >= 1 && c <= 12); }
});

test('actionEnemyHp: inteiro >= 1, monotônico na vida oficial e ordenado por categoria', () => {
    const hp = fn('actionEnemyHp');
    let prev = 0;
    for (let v = 1; v <= 600; v += 7) {
        const h = hp(v, 'minion');
        assert.ok(Number.isInteger(h) && h >= 1);
        assert.ok(h >= prev); prev = h;
        assert.ok(hp(v, 'minion') <= hp(v, 'elite') && hp(v, 'elite') <= hp(v, 'boss'));
    }
    assert.equal(hp(100, 'elite'), Math.round(100 * B.hpMul.elite));
    assert.equal(hp(100, 'desconhecido'), hp(100, 'minion'));
    for (const bad of [0, -5, NaN, undefined, 'x']) { const h = hp(bad, 'minion'); assert.ok(Number.isInteger(h) && h >= 1); }
});

test('teto de renda: ritmo, balde de fichas (começa vazio, enche no ritmo, limita a janela) e entrada inválida', () => {
    const cap = fn('actionRewardCapPerMin'), bucket = fn('actionRewardBucket');
    assert.equal(cap(600, false), 10 * B.rewardCap.manual);
    assert.equal(cap(600, true), 10 * B.rewardCap.auto);
    assert.equal(cap(0, false), B.rewardCap.fallbackPerMin * B.rewardCap.manual);
    assert.equal(cap(NaN, true), B.rewardCap.fallbackPerMin * B.rewardCap.auto);
    const b = bucket(null, 0, 6);
    assert.equal(b.tokens, 0, 'começa vazio');
    bucket(b, 30, 6);
    assert.ok(Math.abs(b.tokens - 3) < 1e-9, '6/min durante 30 s = 3 fichas');
    bucket(b, 10000, 6);
    assert.ok(Math.abs(b.tokens - 6 * B.rewardCap.windowSec / 60) < 1e-9, 'guarda no máximo a janela');
    const c = { tokens: NaN };
    bucket(c, -5, -3);
    assert.equal(c.tokens, 0);
});

test('custo em fichas: elite e chefe pagam mais EXP por vitória, então gastam mais fichas (1..12)', () => {
    const { game } = newGame({ seed: 2 });
    const cost = fn('actionVictoryTokenCost'), ref = fn('actionRouteExpUnits');
    const route = game.getRoute('kanto_viridian_forest');
    const R = ref(game, route);
    assert.ok(R > 0);
    const u = (id, lv) => game.getBaseExpYield(id, lv) * lv;
    const elite = cost(u(12, 16), R), boss = cost(u(15, 20), R);           // Butterfree Nv16 e Beedrill Nv20 (js/action/action-maps.js)
    assert.ok(elite > 1.5 && elite < 3, 'elite ' + elite);
    assert.ok(boss > elite && boss < 4, 'chefe ' + boss);
    assert.equal(cost(u(10, 11), R), 1, 'minion fraco nunca custa menos de 1');
    assert.equal(cost(1e12, 1), 12);
    assert.equal(cost(0, R), 1); assert.equal(cost(5, 0), 1);
    assert.equal(ref(game, null), 0);
});

test('actionIdleVictoriesPerHour: mede o idle numa cópia sem mexer no jogo; rota bloqueada = 0', () => {
    const { game } = newGame({ seed: 3 });
    const idle = fn('actionIdleVictoriesPerHour');
    const before = JSON.stringify({ g: game.gameState.gold, exp: game._partyInstance(0).exp, lv: game._partyInstance(0).level, r: game.gameState.currentRoute });
    const v = idle(game, 'kanto_route1');
    assert.ok(v > 200 && v < 3000, 'vitórias/h ' + v);
    assert.equal(JSON.stringify({ g: game.gameState.gold, exp: game._partyInstance(0).exp, lv: game._partyInstance(0).level, r: game.gameState.currentRoute }), before);
    assert.equal(idle(game, 'kanto_route10'), 0, 'rota ainda bloqueada');
    assert.equal(idle(null, 'kanto_route1'), 0);
});

// Propriedade (d), travada pelo modelo do documento (docs/action/balanceamento.md, semente 4242): na Floresta de Viridian com o Pikachu Nv16,
// o idle faz 405 vitórias/h; o modelo estima 60 abates/min (manual atento) e 55 (automático), com ~48 elites e ~22 chefes por hora.
// Mesmo com esse ritmo idealizado (sem mortes), a renda fica em 1,2×–1,6× (manual) e 0,9×–1,1× (automático). Quem subir crédito, vida
// ou teto sem refazer a medição quebra este teste.
test('propriedade (d): renda do modo de ação contra o idle fica nas faixas (manual 1,2–1,6×, automático 0,9–1,1×)', () => {
    const est = fn('actionEstimateVictoriesPerHour');
    const IDLE = 405, costs = { eliteCost: 2.16, bossCost: 2.94 };
    const manual = est({ minionPerMin: 59, elitesPerHour: 48, bossesPerHour: 22, ...costs }, IDLE, false) / IDLE;
    const auto = est({ minionPerMin: 54.5, elitesPerHour: 44, bossesPerHour: 22, ...costs }, IDLE, true) / IDLE;
    assert.ok(manual >= 1.2 && manual <= 1.6, 'manual ' + manual);
    assert.ok(auto >= 0.9 && auto <= 1.1, 'automático ' + auto);
    // núcleo real de hoje (em andamento, com mortes): ~15 abates/min e ~24 elites/h no automático → não passa do idle
    const realAuto = est({ minionPerMin: 14.7, elitesPerHour: 24, ...costs }, IDLE, true) / IDLE;
    assert.ok(realAuto <= 1.1, 'automático real ' + realAuto);
    // quem joga mal no manual não ganha o prêmio de graça
    const weak = est({ minionPerMin: 6, elitesPerHour: 5, bossesPerHour: 0, ...costs }, IDLE, false) / IDLE;
    assert.ok(weak < 1.2, 'manual fraco ' + weak);
    // um ritmo absurdo (10× o modelo) continua preso ao teto
    const absurd = est({ minionPerMin: 600, elitesPerHour: 480, bossesPerHour: 220, ...costs }, IDLE, false) / IDLE;
    assert.ok(absurd <= 1.6);
});

test('propriedade (d) com o balde de verdade: 1 h de abates no ritmo do modelo paga 1,2–1,6× (manual) e 0,9–1,1× (auto) em fichas', () => {
    const cap = fn('actionRewardCapPerMin'), bucket = fn('actionRewardBucket');
    const IDLE = 405, dt = 0.1;
    const run = (auto, minionPerMin) => {
        const b = { tokens: 0 }; let credit = 0, paid = 0;
        for (let t = 0; t < 3600; t += dt) {
            bucket(b, dt, cap(IDLE, auto));
            credit += minionPerMin / 60 * dt * B.rewardCredit.minion;
            while (credit >= 1 && b.tokens >= 1) { credit--; b.tokens--; paid++; }
            credit = Math.min(credit, B.rewardCap.bankMax);
        }
        return paid / IDLE;
    };
    const m = run(false, 60), a = run(true, 55);
    assert.ok(m >= 1.2 && m <= 1.6, 'manual ' + m);
    assert.ok(a >= 0.9 && a <= 1.1, 'automático ' + a);
});
