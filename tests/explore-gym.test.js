'use strict';
// F10.5: Cidade de Viridian e o Ginásio — mapas válidos e conectados, treinadores fixos, equipe que acompanha o progresso, insígnia salva e bônus só no Explorar.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, createMemoryStorage } = require('./helpers/game');

test('F10.5 mapas novos: só letras da legenda, largura constante, início e serviços andáveis, saídas alcançáveis', () => {
    const { ctx } = newGame();
    for (const id of ['explore_viridian', 'explore_gym_rock']) {
        const m = ctx.EXPLORE_MAPS[id];
        assert.equal(m.rows.length, m.height, id);
        for (const r of m.rows) { assert.equal(r.length, m.width, id); for (const ch of r) assert.ok(ctx.WORLD_LEGEND[ch], `${id}: letra "${ch}"`); }
        assert.equal(ctx.worldCellBlocked(m, m.spawn.x, m.spawn.y), false, `${id}: início`);
        for (const it of m.interactions || []) assert.equal(ctx.worldCellBlocked(m, it.cell.x, it.cell.y), false, `${id}: ${it.id}`);
        for (const e of m.exits) {
            const path = ctx.worldFindPath(m, m.spawn, { x: e.x0, y: e.y });
            assert.ok(path && path.length > 0, `${id}: saída para ${e.to} alcançável`);
            const dest = ctx.exploreMapById(e.to); assert.ok(dest, `${id}: destino ${e.to}`);
            assert.equal(ctx.worldCellBlocked(dest, e.at.x, e.at.y), false, `${id}: chegada em ${e.to}`);
        }
        assert.equal(ctx.exploreMapById(id), m);
    }
    const v = ctx.EXPLORE_MAPS.explore_viridian, gm = v.gym;
    for (let y = gm.y; y < gm.y + gm.h; y++) for (let x = gm.x; x < gm.x + gm.w; x++) assert.equal(ctx.worldCellBlocked(v, x, y), true, 'o prédio do ginásio bloqueia');
    const door = v.interactions.find(i => i.type === 'gym');
    assert.equal(door.cell.y, gm.y + gm.h, 'a porta fica logo à frente do prédio');
    assert.equal(ctx.worldCellBlocked(ctx.getWorldMap('kanto_route1'), 16, 1), false, 'chegada na Rota 1 vindo de Viridian');
});

test('F10.5 treinadores fixos do ginásio: posições declaradas, visão livre, líder com insígnia', () => {
    const { ctx } = newGame();
    const m = ctx.EXPLORE_MAPS.explore_gym_rock, t = ctx.exploreTrainerSpots(m, 0);
    assert.equal(t.length, 3);
    assert.equal(t.map(x => x.id).join(), 'explore_gym_rock#t0,explore_gym_rock#t1,explore_gym_rock#t2');
    const leader = t.find(x => x.leader);
    assert.equal(leader.badge, 'rocha'); assert.equal(leader.klass.cls, 'Líder de Ginásio'); assert.match(leader.klass.intro, /Petra/);
    for (const x of t) { assert.equal(ctx.worldCellBlocked(m, x.x, x.y), false); assert.ok(x.klass && x.klass.colors); }
    assert.equal(ctx.exploreTrainerSees(m, leader, 6, 6), 4, 'a líder vê o corredor central');
});

test('F10.5 equipe do ginásio acompanha o nível da sua equipe e é do tipo Pedra/Terra', () => {
    const { game, ctx } = newGame();
    const leader = ctx.exploreTrainerSpots(ctx.EXPLORE_MAPS.explore_gym_rock, 0).find(x => x.leader);
    for (const lv of [10, 80]) {
        for (const uid of game.gameState.party) game.gameState.ownedPokemon[uid].level = lv;
        const team = ctx.exploreFixedTeam(game, leader);
        assert.equal(team.length, 3);
        const top = Math.max(...team.map(w => w.level));
        assert.equal(top, Math.round(lv * 1.08), `líder no nível ${lv}`);
        for (const w of team) { assert.ok(w._trainer); assert.equal(w.isShiny, false); assert.ok(ctx.POKEMON_DATA[w.id].types.some(ty => ty === 'rock' || ty === 'ground')); }
    }
});

test('F10.5 insígnia: dada uma vez, salva no save, saneada; dá +10% de captura só no Explorar', () => {
    const storage = createMemoryStorage();
    const a = newGame({ storage });
    const poke = a.ctx.getBallType('pokeball');
    const before = a.ctx.exploreCaptureChance(0.3, poke, 1, false, a.game.exploreCatchBonus());
    assert.equal(a.game.exploreAwardBadge('rocha'), true); assert.equal(a.game.exploreAwardBadge('rocha'), false, 'uma vez só');
    assert.equal(a.game.exploreAwardBadge('inventada'), false);
    assert.ok(a.game.exploreHasBadge('rocha'));
    const after = a.ctx.exploreCaptureChance(0.3, poke, 1, false, a.game.exploreCatchBonus());
    assert.ok(Math.abs(after - before * 1.1) < 1e-9, `${before} → ${after}`);
    assert.equal(a.ctx.captureChance(0.3, poke), a.ctx.captureChance(0.3, poke), 'a captura do idle não muda');
    a.game.saveNow();
    const b = newGame({ storage, load: true });
    assert.ok(b.game.exploreHasBadge('rocha'), 'sobrevive ao recarregar');
    assert.equal(JSON.stringify(a.ctx.sanitizeExploreState({ badges: ['rocha', 'rocha', 'falsa', 3] })), JSON.stringify({ badges: ['rocha'] }));
});
