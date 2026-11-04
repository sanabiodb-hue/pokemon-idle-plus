'use strict';
// F10.2: treinadores nas rotas (posição, visão, equipe, prêmio, batalha sem fuga e sem captura) e itens no chão.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');

const route1 = (ctx) => ctx.REGIONS.kanto.routes.find(r => r.id === 'kanto_route1');
const maps = (ctx) => [ctx.getWorldMap('kanto_route1'), ctx.worldHuntMap(16), ctx.worldHuntMap(74), ctx.worldHuntMap(129)];

test('F10.2 treinadores: determinísticos, em chão andável fora do mato, com visão livre de ≥3 tiles, separados e longe do início', () => {
    const { ctx } = newGame();
    for (const m of maps(ctx)) {
        const n = ctx.exploreTrainerCount(m), a = ctx.exploreTrainerSpots(m, n), b = ctx.exploreTrainerSpots(m, n);
        assert.deepEqual(a.map(t => [t.x, t.y, t.dir, t.name]), b.map(t => [t.x, t.y, t.dir, t.name]), m.id);
        assert.ok(a.length >= 1 && a.length <= 4, `${m.id}: ${a.length}`);
        for (const t of a) {
            assert.equal(ctx.worldCellBlocked(m, t.x, t.y), false); assert.notEqual(m.rows[t.y][t.x], 'w');
            const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[t.dir];
            for (let k = 1; k <= 3; k++) assert.equal(ctx.worldCellBlocked(m, t.x + d[0] * k, t.y + d[1] * k), false, `${m.id} visão ${t.id}`);
            assert.ok(Math.abs(t.x - m.spawn.x) + Math.abs(t.y - m.spawn.y) > 7);
            for (const o of a) if (o !== t) assert.ok(Math.abs(o.x - t.x) + Math.abs(o.y - t.y) >= 9);
        }
    }
    assert.equal(ctx.exploreTrainerSpots(ctx.getWorldMap('starter_town'), 3).length, 0, 'cidade não tem treinadores');
});

test('F10.2 visão: só em linha reta na direção dele, até 4 tiles, bloqueada por obstáculo', () => {
    const { ctx } = newGame();
    const m = { id: 't', type: 'route', width: 8, height: 3, rows: ['TTTTTTTT', 'T......T', 'TTTTTTTT'], spawn: { x: 1, y: 1 } };
    const t = { x: 1, y: 1, dir: 'right' };
    assert.equal(ctx.exploreTrainerSees(m, t, 3, 1), 2);
    assert.equal(ctx.exploreTrainerSees(m, t, 5, 1), 4);
    assert.equal(ctx.exploreTrainerSees(m, t, 6, 1), null, 'além do alcance');
    assert.equal(ctx.exploreTrainerSees(m, { ...t, dir: 'left' }, 3, 1), null, 'de costas não vê');
    const blocked = ctx.exploreCollisionMap(m, [{ x: 3, y: 1 }]);
    assert.equal(ctx.exploreTrainerSees(blocked, t, 5, 1), null, 'obstáculo no meio');
    assert.equal(m.rows[1][3], '.', 'o mapa de desenho não muda');
    assert.equal(ctx.worldCellBlocked(blocked, 3, 1), true, 'o treinador vira obstáculo na colisão');
});

test('F10.2 equipe: 1 a 3 Pokémon da rota, nível no topo da faixa, marcados como de treinador; mesma semente = mesma equipe', () => {
    const { game, ctx } = newGame();
    const r = route1(ctx), m = ctx.getWorldMap('kanto_route1'), ids = new Set(r.pokemon.map(p => p.id));
    for (const t of ctx.exploreTrainerSpots(m, 2)) {
        const a = ctx.exploreTrainerTeam(game, r, t), b = ctx.exploreTrainerTeam(game, r, t);
        assert.ok(a.length >= 1 && a.length <= 3);
        assert.deepEqual(a.map(w => [w.id, w.level]), b.map(w => [w.id, w.level]));
        for (const w of a) { assert.ok(ids.has(w.id)); assert.ok(w._trainer); assert.equal(w.isShiny, false); assert.ok(w.level >= r.levelRange[1] - 2 && w.level <= r.levelRange[1] + 2, String(w.level)); }
    }
    assert.equal(ctx.exploreTrainerPrize([]), 0);
    assert.equal(ctx.exploreTrainerPrize([{ level: 10 }]), 120);
    assert.equal(ctx.exploreTrainerPrize([{ level: 4 }, { level: 10 }]), 150);
});

test('F10.2 batalha contra treinador: sem fuga e sem bola (não gastam turno nem bola), equipe em sequência, vitória só no último', () => {
    const { game, ctx } = newGame({ balls: true, seed: 4 });
    const inv = game.ensureInventory(); inv.ballsGranted = true; inv.balls = { pokeball: 10 };
    for (const uid of game.gameState.party) game.gameState.ownedPokemon[uid].level = 80;
    const team = [game.createWildPokemon(16, 4, 0), game.createWildPokemon(19, 5, 0)]; team.forEach(w => { w._trainer = true; });
    const b = new ctx.ExploreBattle(game, team[0], { trainer: { cls: 'Jovem Treinador', name: 'Léo', team } });
    assert.match(b.act({ type: 'run' })[0].msg, /Não dá para fugir/); assert.equal(b.turn, 0);
    assert.match(b.act({ type: 'ball', id: 'pokeball' })[0].msg, /bloqueou a bola/); assert.equal(game.getBallCount('pokeball'), 10); assert.equal(b.turn, 0);
    assert.equal(game.exploreCapture(team[0], 'pokeball', 0.1, false).ok, false, 'captura direta também recusada');
    const all = []; let n = 0;
    while (!b.over && n++ < 40) all.push(...b.act({ type: 'move', i: b.me().moves.length - 1 }));
    assert.equal(b.over, 'win');
    assert.equal(all.filter(s => s.t === 'faint' && s.side === 'foe').length, 2);
    assert.equal(all.filter(s => s.t === 'xp').length, 1, 'XP do primeiro antes do segundo entrar');
    assert.ok(all.some(s => s.t === 'foeSwitch' && /enviou/.test(s.msg)));
    assert.equal(b.foe.wild, team[1]);
});

test('F10.2 itens no chão: determinísticos, fora do caminho e do mato; bolas e poções respeitam os limites; ouro pelo portão (reward)', () => {
    const { game, ctx } = newGame({ balls: true });
    for (const m of maps(ctx)) {
        const a = ctx.exploreItemSpots(m, ctx.exploreItemCount(m));
        assert.equal(JSON.stringify(a), JSON.stringify(ctx.exploreItemSpots(m, ctx.exploreItemCount(m))));
        for (const it of a) { const ch = m.rows[it.y][it.x]; assert.equal(ctx.worldCellBlocked(m, it.x, it.y), false); assert.notEqual(ch, 'w'); assert.notEqual(ctx.WORLD_LEGEND[ch].kind, 'path'); }
    }
    const inv = game.ensureInventory(); inv.ballsGranted = true; inv.balls = { pokeball: ctx.BALL_STACK_MAX - 1 };
    assert.equal(game.exploreGiveItem({ kind: 'ball', id: 'pokeball', qty: 3 }).added, 1, 'para no teto da pilha');
    inv.potions = game.getPotionCapacity() - 1;
    assert.equal(game.exploreGiveItem({ kind: 'potion', qty: 2 }).added, 1, 'para na capacidade');
    const g0 = game.getMoney(), r0 = (game.ensureEconomy().byReason.reward || { earned: 0 }).earned;
    const r = game.exploreGiveItem({ kind: 'gold', qty: 1 }, 10);
    assert.equal(r.added, 150); assert.equal(game.getMoney(), g0 + 150); assert.equal(game.ensureEconomy().byReason.reward.earned, r0 + 150);
    assert.equal(game.exploreTrainerReward(120, 't1').amount, 120); assert.equal(game.getMoney(), g0 + 270);
});
