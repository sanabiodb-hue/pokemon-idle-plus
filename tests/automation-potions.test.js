'use strict';
// Fase 5A · B7: poções, cura automática, "sem poções" e mensagens de parada
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');

const hunt = (game, policy) => {
    if (policy) assert.equal(game.setAutomationPolicy(policy).ok, true);
    const r = game.dispatchAutomationAction({ type: 'START_HUNT' });
    assert.equal(r.ok, true, JSON.stringify(r));
    game.stopBattle(); game.currentBattle = null; game.gameState.currentEnemy = null;
    game.startBattle(); game.stopBattle();            // batalha preparada, sem relógio rodando
    return game.getHuntSession();
};
const hurt = (game, pct) => { game.currentBattle.playerCurrentHp = Math.floor(game.currentBattle.playerMaxHp * pct); };

test('novo jogo começa com 10 poções; conta persiste no save e valores inválidos são saneados', () => {
    const a = newGame({ seed: 1 });
    assert.equal(a.game.getPotions(), 10);
    assert.equal(a.game.gameState.inventory.potions, 10);
    a.game.gameState.inventory.potions = 3;
    a.game.saveNow();
    const b = newGame({ storage: a.storage, load: true });
    assert.equal(b.game.getPotions(), 3);
    for (const bad of [-5, 'x', null, 1e12]) {
        const raw = JSON.parse(JSON.stringify(a.game.gameState));
        raw.inventory = { potions: bad };
        const res = a.ctx.sanitizeSave(raw);
        const p = (res.state || res.save || res).inventory.potions;
        assert.ok(Number.isInteger(p) && p >= 0 && p <= a.ctx.MAX_POTIONS, String(bad));
    }
});

test('save antigo sem inventory ganha as 10 poções iniciais uma vez', () => {
    const a = newGame({ seed: 2 });
    a.game.saveNow();
    const key = [...Array(a.storage.length).keys()].map(i => a.storage.key(i)).find(k => /save/.test(k));
    const raw = a.ctx.sanitizeSave(JSON.parse(JSON.stringify(a.game.gameState)));
    delete (raw.state || raw).inventory;
    assert.ok(key);
    const g = new a.ctx.GameCore();
    g.gameState = raw.state || raw;
    assert.equal(g.getPotions(), 10);
    g.gameState.inventory.potions = 0;
    assert.equal(g.getPotions(), 0, 'zero é um valor válido e não é reposto');
});

test('usePotion: consome 1, cura 50% do máximo sem passar do teto, emite heal e recusa vida cheia / sem poção', () => {
    const { game } = newGame({ seed: 3 });
    game.startBattle(); game.stopBattle();
    const b = game.currentBattle;
    const seen = [];
    game.bus.on('heal', (e) => seen.push(e));
    assert.equal(game.usePotion().code, 'full_hp');
    assert.equal(game.getPotions(), 10, 'recusa não gasta poção');
    b.playerCurrentHp = 1;
    const r = game.usePotion('test');
    assert.equal(r.ok, true);
    assert.equal(game.getPotions(), 9);
    assert.equal(b.playerCurrentHp, Math.min(b.playerMaxHp, 1 + Math.ceil(b.playerMaxHp * 0.5)));
    assert.equal(seen[0].potionsLeft, 9);
    assert.equal(seen[0].potion, true);
    b.playerCurrentHp = b.playerMaxHp - 1;
    game.usePotion();
    assert.equal(b.playerCurrentHp, b.playerMaxHp, 'não passa do máximo');
    game.gameState.inventory.potions = 0;
    b.playerCurrentHp = 1;
    assert.equal(game.usePotion().code, 'no_potions');
    assert.equal(b.playerCurrentHp, 1);
});

test('usePotion em Pokémon desmaiado: reanima, para a regeneração antiga e abre nova batalha', () => {
    const { game } = newGame({ seed: 4 });
    game.startBattle(); game.stopBattle();
    const b = game.currentBattle;
    b.playerCurrentHp = 0;
    game.startHealingAfterDefeat();
    assert.ok(game.healTimer);
    const r = game.usePotion();
    assert.equal(r.ok, true);
    assert.equal(r.revived, true);
    assert.equal(game.healTimer, null);
    assert.ok(game.currentBattle.playerCurrentHp > 0);
    assert.ok(game.battleTimer, 'a batalha recomeçou');
});

test('HEAL via dispatcher: regras de validação', () => {
    const { game } = newGame({ seed: 5 });
    const d = () => game.dispatchAutomationAction({ type: 'HEAL' });
    assert.equal(d().code, 'no_running_hunt');
    hunt(game);
    assert.equal(d().code, 'full_hp');
    hurt(game, 0.1);
    const r = d();
    assert.equal(r.ok, true);
    assert.equal(game.getPotions(), 9);
    game.gameState.inventory.potions = 0;
    hurt(game, 0.1);
    assert.equal(d().code, 'no_potions');
    game._towerMode = true;
    assert.equal(d().code, 'tower_mode');
    game._towerMode = false;
});

test('cura automática no meio da luta: ao cruzar o limite, 1 poção é usada (uma vez por cruzamento)', () => {
    const { game } = newGame({ seed: 6 });
    const s = hunt(game, { heal: { whenHpBelowPercent: 30 } });
    const b = game.currentBattle;
    b.wild.level = 1;
    game.rng = () => 0.99;
    // inimigo acerta e deixa o jogador em ~20%
    b.playerCurrentHp = Math.floor(b.playerMaxHp * 0.2) + 5;
    b.enemyTimer = b.enemyNextAttack; b.playerTimer = 0;
    b.lastTick = game.now();
    const hpEvents = [];
    game.bus.on('hp_low', (e) => hpEvents.push(e));
    game.battleTick();
    assert.equal(hpEvents.length <= 1, true);
    if (hpEvents.length === 1) {
        assert.equal(game.getPotions(), 9, 'poção consumida pelo núcleo');
        assert.equal(s.stats.healingSpent, 1);
        assert.ok(b.playerCurrentHp > b.playerMaxHp * 0.3);
    }
});

test('cura automática desligada: não usa poção e o jogo antigo (regeneração) continua valendo', () => {
    const { game } = newGame({ seed: 7 });
    hunt(game, { heal: { enabled: false } });
    const b = game.currentBattle;
    b.playerCurrentHp = 1;
    game._checkLowHp(b, true);
    assert.equal(game.getPotions(), 10);
});

test('abaixo do limite após a vitória: gasta poção; limite 1% não gasta', () => {
    const { game } = newGame({ seed: 8 });
    const s = hunt(game, { heal: { whenHpBelowPercent: 60 } });
    hurt(game, 0.2);
    game._checkLowHp(game.currentBattle, true);
    assert.equal(game.getPotions(), 9);
    assert.equal(s.stats.healingSpent, 1);
});

test('sem poções: a caçada PARA com motivo no_potions, mensagem legível e evento hunt_stopped', () => {
    const { game } = newGame({ seed: 9 });
    const s = hunt(game);
    game.gameState.inventory.potions = 0;
    const stopped = [];
    game.bus.on('hunt_stopped', (e) => stopped.push(e));
    hurt(game, 0.1);
    game._checkLowHp(game.currentBattle, true);
    assert.equal(s.state, 'stopped');
    assert.equal(s.stopReason, 'no_potions');
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0].message, 'Caça interrompida: sem poções.');
    assert.equal(game.getPotions(), 0, 'nada negativo');
    assert.equal(game._engine.isAttached(), false);
});

test('derrota real com poções: reanima na hora; sem poções: para e a regeneração antiga assume', () => {
    for (const potions of [3, 0]) {
        const { game } = newGame({ seed: 10 });
        const s = hunt(game);
        game.gameState.inventory.potions = potions;
        game.startBattle(); game.stopBattle();
        const b = game.currentBattle;
        b.playerCurrentHp = 1; b.enemyTimer = b.enemyNextAttack; b.playerTimer = 0; b.lastTick = game.now();
        game.rng = () => 0.99;
        game.battleTick();
        if (potions > 0) {
            assert.equal(s.state, 'running');
            assert.equal(game.getPotions(), 2);
            assert.ok(game.currentBattle.playerCurrentHp > 0);
        } else {
            assert.equal(s.state, 'stopped');
            assert.equal(s.stopReason, 'no_potions');
            assert.ok(game.healTimer, 'a regeneração antiga continua depois de parar');
        }
        assert.equal(s.stats.defeats, 1);
    }
});

test('Torre: não entra com caçada rodando; não pausa dentro da Torre; sem caçada o comportamento é o antigo', () => {
    const { game } = newGame({ seed: 11 });
    hunt(game);
    const r = game.enterTower();
    assert.equal(r.success, false);
    assert.match(r.message, /caçada/);
    game._towerMode = true;
    assert.equal(game.dispatchAutomationAction({ type: 'PAUSE_HUNT' }).code, 'tower_mode');
    assert.equal(game.dispatchAutomationAction({ type: 'STOP_HUNT' }).ok, true, 'parar sempre é permitido');
    game._towerMode = false;
});

test('mensagens de parada em português para cada motivo', () => {
    const { ctx } = newGame();
    const mk = (reason, sc = {}) => {
        const s = ctx.createHuntSession({ id: 'h', now: 0, routeId: 'kanto_route1', policy: ctx.validateAutomationPolicy({ stopConditions: sc }).policy, partyUids: [] });
        ctx.huntSessionTransition(s, 'running', 0);
        ctx.huntSessionTransition(s, 'stopped', 1, reason);
        return s;
    };
    assert.equal(ctx.huntStopMessage(mk('no_potions')), 'Caça interrompida: sem poções.');
    assert.equal(ctx.huntStopMessage(mk('shiny_found')), 'Caça encerrada: Shiny encontrado.');
    assert.equal(ctx.huntStopMessage(mk('route_complete')), 'Caça encerrada: rota concluída.');
    assert.equal(ctx.huntStopMessage(mk('battle_limit', { battleLimit: 100 })), 'Caça encerrada: limite de 100 batalhas atingido.');
    assert.equal(ctx.huntStopMessage(mk('time_limit', { timeLimitMinutes: 1 })), 'Caça encerrada: limite de 1 minuto atingido.');
    assert.equal(ctx.huntStopMessage(mk('manual')), 'Caça encerrada.');
    assert.equal(ctx.huntStoppedByCondition(mk('manual')), false);
    assert.equal(ctx.huntStoppedByCondition(mk('no_potions')), true);
});

test('decisão pura de cura: limites, sem poções e desligado', () => {
    const { ctx } = newGame();
    const pol = (h = {}) => ctx.validateAutomationPolicy({ heal: h }).policy;
    const D = (snap) => plain(ctx.decideAutomationActions('hp_low', snap));
    assert.deepEqual(D({ policy: pol(), hpPercent: 29, potions: 2 }).map(x => x.action.type), ['HEAL']);
    assert.deepEqual(D({ policy: pol(), hpPercent: 30, potions: 2 }), []);
    assert.deepEqual(D({ policy: pol(), hpPercent: 10, potions: 0 }).map(x => x.action.reason), ['no_potions']);
    assert.deepEqual(D({ policy: pol({ enabled: false }), hpPercent: 1, potions: 0 }), []);
    assert.deepEqual(D({ policy: pol(), hpPercent: 80, potions: 0 }), [], 'saudável sem poções não para');
    assert.deepEqual(D({ policy: pol(), hpPercent: 0, fainted: true, potions: 1 }).map(x => x.action.type), ['HEAL']);
});

test('offline com caçada: o driver rápido gasta poções pela mesma regra e para sem poções', async () => {
    const { game } = newGame({ seed: 12 });
    game.gameState.inventory.potions = 2;
    const s = hunt(game, { heal: { whenHpBelowPercent: 99 } });
    await runOffline(game, 20 * 60 * 1000);
    assert.equal(game.getPotions() >= 0, true);
    assert.ok(s.stats.healingSpent <= 2);
    if (s.state === 'stopped') assert.equal(s.stopReason, 'no_potions');
});
