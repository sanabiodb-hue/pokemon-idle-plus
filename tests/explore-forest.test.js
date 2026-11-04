'use strict';
// F10.8: Floresta de Viridian, Cidade de Pewter e o segundo Ginásio (Inseto) — mapas válidos e ligados em cadeia, encontros da
// rota da floresta, Caçadores de Insetos fixos com visão pelo caminho, líder com Insígnia Casulo (+10% de dano só no Explorar).
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, createMemoryStorage } = require('./helpers/game');

const NEW = ['explore_forest', 'explore_pewter', 'explore_gym_bug'];

test('F10.8 mapas novos: letras da legenda, largura constante, início e serviços andáveis, saídas alcançáveis e chegadas livres', () => {
    const { ctx } = newGame();
    for (const id of [...NEW, 'explore_viridian']) {
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
            assert.ok(!(dest.exits || []).some(x => x.y === e.at.y && e.at.x >= x.x0 && e.at.x <= x.x1), `${id} → ${e.to}: a chegada não fica em cima de outra saída`);
        }
    }
});

test('F10.8 caminho: Viridian → Floresta → Pewter → Ginásio e de volta, cada saída tem a volta correspondente', () => {
    const { ctx } = newGame();
    const link = (a, b) => ctx.EXPLORE_MAPS[a].exits.some(e => e.to === b);
    for (const [a, b] of [['explore_viridian', 'explore_forest'], ['explore_forest', 'explore_pewter'], ['explore_gym_bug', 'explore_pewter']]) { assert.ok(link(a, b), `${a} → ${b}`); }
    assert.ok(link('explore_forest', 'explore_viridian') && link('explore_pewter', 'explore_forest'), 'volta');
    const door = ctx.EXPLORE_MAPS.explore_pewter.interactions.find(i => i.type === 'gym');
    assert.equal(door.to, 'explore_gym_bug'); const gm = ctx.EXPLORE_MAPS.explore_pewter.gym;
    assert.equal(door.cell.y, gm.y + gm.h, 'a porta fica logo à frente do prédio');
    for (let y = gm.y; y < gm.y + gm.h; y++) for (let x = gm.x; x < gm.x + gm.w; x++) assert.equal(ctx.worldCellBlocked(ctx.EXPLORE_MAPS.explore_pewter, x, y), true);
    assert.equal(ctx.EXPLORE_MAPS.explore_viridian.interactions.find(i => i.type === 'gym').to, 'explore_gym_rock');
    for (const id of ['explore_gym_rock', 'explore_gym_bug']) { const gi = ctx.EXPLORE_MAPS[id].gymInfo; assert.ok(gi && gi.leader && gi.type && ctx.EXPLORE_BADGES[gi.badge], id); }
});

test('F10.8 floresta: encontros só no mato alto, da rota da floresta (insetos, Nv 11–15); a cidade e o ginásio não têm', () => {
    const { game, ctx } = newGame({ seed: 3 });
    const f = ctx.EXPLORE_MAPS.explore_forest, route = game.getRoute(f.route), ids = new Set(route.pokemon.map(p => p.id));
    assert.equal(route.id, 'kanto_viridian_forest');
    const cells = ctx.exploreEncounterCells(f);
    assert.ok(cells.length >= 80, String(cells.length));
    for (const [x, y] of cells) assert.equal(f.rows[y][x], 'w');
    for (let i = 0; i < 60; i++) { const w = game.exploreWild(route); assert.ok(ids.has(w.id)); assert.ok(w.level >= 11 && w.level <= 15, String(w.level)); }
    assert.equal(ctx.exploreEncounterCells(ctx.EXPLORE_MAPS.explore_pewter).length, 0);
    assert.equal(ctx.exploreEncounterCells(ctx.EXPLORE_MAPS.explore_gym_bug).length, 0);
    const n = ctx.exploreRoamerCount(f); assert.ok(n >= 2 && n <= 7);
});

test('F10.8 Caçadores de Insetos: 4 fixos, fora do mato, com visão livre de 4 tiles sobre o caminho; equipe de insetos da rota', () => {
    const { game, ctx } = newGame();
    const f = ctx.EXPLORE_MAPS.explore_forest, t = ctx.exploreTrainerSpots(f, 0), route = game.getRoute(f.route);
    assert.equal(t.length, 4);
    for (const x of t) {
        assert.equal(x.klass.cls, 'Caçador de Insetos'); assert.notEqual(f.rows[x.y][x.x], 'w'); assert.equal(ctx.worldCellBlocked(f, x.x, x.y), false);
        const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[x.dir];
        let seesPath = false;
        for (let k = 1; k <= 4; k++) { assert.equal(ctx.worldCellBlocked(f, x.x + dx * k, x.y + dy * k), false, `${x.id} visão ${k}`); if (f.rows[x.y + dy * k][x.x + dx * k] === 'p') seesPath = true; }
        assert.ok(seesPath, `${x.id} vigia o caminho`);
        const team = ctx.exploreTrainerTeam(game, route, x);
        assert.ok(team.length >= 1 && team.every(w => w._trainer && ctx.POKEMON_DATA[w.id].types.some(ty => ty === 'bug' || ty === 'grass')), `${x.id}: ${team.map(w => w.id)}`);
    }
});

test('F10.8 Ginásio de Pewter: líder Silvana (Inseto) acompanha o seu nível e dá a Insígnia Casulo', () => {
    const { game, ctx } = newGame();
    const m = ctx.EXPLORE_MAPS.explore_gym_bug, t = ctx.exploreTrainerSpots(m, 0), leader = t.find(x => x.leader);
    assert.equal(t.length, 3); assert.equal(leader.badge, 'casulo'); assert.match(leader.klass.intro, /Silvana/);
    assert.equal(leader.klass.colors.jacket, '#5fae3a', 'cores próprias da líder');
    assert.equal(ctx.exploreTrainerSees(m, leader, 6, 6), 4);
    for (const uid of game.gameState.party) game.gameState.ownedPokemon[uid].level = 30;
    const team = ctx.exploreFixedTeam(game, leader);
    assert.equal(team.length, 4); assert.equal(Math.max(...team.map(w => w.level)), 33);
    for (const w of team) assert.ok(ctx.POKEMON_DATA[w.id].types.includes('bug'));
});

test('F10.8 Insígnia Casulo: +10% de dano só nos seus golpes no Explorar; salva e sobrevive ao recarregar', () => {
    assert.equal(newGame().ctx.exploreBoostedDamage(20, 0.1), 22);
    const { ctx } = newGame();
    assert.equal(ctx.exploreBoostedDamage(1, 0.1), 1, 'arredonda sem perder dano');
    assert.equal(ctx.exploreBoostedDamage(0, 0.1), 0); assert.equal(ctx.exploreBoostedDamage(17, 0), 17);
    const hit = (badge) => {
        const { game, ctx: c } = newGame({ seed: 11 });
        if (badge) game.exploreAwardBadge('casulo');
        for (const uid of game.gameState.party) game.gameState.ownedPokemon[uid].level = 20;
        game._instanceStats.clear();
        const w = game.createWildPokemon(16, 22, 0), b = new c.ExploreBattle(game, w, {});
        const steps = b.act({ type: 'move', i: 0 });
        return { mine: steps.find(s => s.t === 'hit' && s.side === 'me'), foe: steps.find(s => s.t === 'hit' && s.side === 'foe'), bonus: game.exploreDamageBonus() };
    };
    const a = hit(false), z = hit(true);
    assert.equal(a.bonus, 0); assert.ok(Math.abs(z.bonus - 0.1) < 1e-9);
    assert.ok(a.mine && z.mine);
    assert.equal(z.mine.dmg, ctx.exploreBoostedDamage(a.mine.dmg, 0.1), `${a.mine.dmg} → ${z.mine.dmg}`);
    if (a.foe && z.foe) assert.equal(z.foe.dmg, a.foe.dmg, 'o dano do adversário não muda');
    const storage = createMemoryStorage(), s1 = newGame({ storage });
    s1.game.exploreAwardBadge('casulo'); s1.game.saveNow();
    const s2 = newGame({ storage, load: true });
    assert.ok(s2.game.exploreHasBadge('casulo'));
    assert.equal(JSON.stringify(ctx.sanitizeExploreState({ badges: ['casulo', 'rocha', 'x'] })), JSON.stringify({ badges: ['casulo', 'rocha'] }));
});

test('F10.8 trilha da floresta: original, em loop, as três vozes com o mesmo comprimento', () => {
    const { ctx } = newGame();
    const t = ctx.EXPLORE_TRACKS.forest, len = (v) => v.reduce((a, n) => a + n[1], 0);
    assert.ok(t.loop); assert.equal(len(t.lead), 32); assert.equal(len(t.bass), 32); assert.equal(len(t.pad), 32);
    assert.equal(ctx.EXPLORE_MAPS.explore_forest.music, 'forest');
});
