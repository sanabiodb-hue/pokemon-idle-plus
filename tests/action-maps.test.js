'use strict';
// F12 · Mundo de Ação 3D · mapa jogável da Floresta de Viridian (js/action/action-maps.js): válido, aberto, alcançável e fixo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');
const { loadGameContext } = require('../tools/load-context');

test('F12 mapa: a Floresta de Viridian não tem problemas e segue o contrato', () => {
    const { ctx } = newGame();
    const m = ctx.get('ACTION_MAPS').viridian_forest;
    assert.deepEqual(Array.from(ctx.get('actionMapProblems')(m)), []);
    assert.equal(m.id, 'action_viridian_forest'); assert.equal(m.route, 'kanto_viridian_forest'); assert.equal(m.biome, 'forest');
    assert.ok(m.width >= 50 && m.height >= 40, `${m.width} × ${m.height}`);
    assert.equal(m.rows.length, m.height);
    for (const r of m.rows) { assert.equal(r.length, m.width); for (const ch of r) assert.ok(ctx.WORLD_LEGEND[ch], `letra ${ch}`); }
    assert.ok(m.zones.length >= 5 && m.zones.length <= 7, `zonas: ${m.zones.length}`);
    assert.ok(m.zones.some(z => z.id === m.boss.zone), 'zona do chefe');
    assert.equal(ctx.get('actionMapById')('viridian_forest'), m);
    assert.equal(ctx.get('actionMapById')('action_viridian_forest'), m);
    assert.equal(ctx.get('actionMapById')('nada'), null);
    for (const ch of ['~', 'p', 'w', 'r', 'o', 'b', 'T']) assert.ok(m.rows.some(r => r.includes(ch)), `tem "${ch}"`);
});

test('F12 mapa: toda célula livre de toda zona é alcançável a partir do início', () => {
    const { ctx } = newGame();
    const m = ctx.get('ACTION_MAPS').viridian_forest;
    for (const z of m.zones) {
        let free = 0;
        for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) {
            if (ctx.worldCellBlocked(m, x, y)) continue;
            free++;
            if ((x + y) % 3 === 0) assert.ok(ctx.worldFindPath(m, m.spawn, { x, y }), `${z.id}: (${x}, ${y})`);
        }
        assert.ok(free >= 12, `${z.id}: ${free} livres`);
    }
});

test('F12 mapa: área livre acima de 45% e validação acusa defeitos', () => {
    const { ctx } = newGame();
    const m = ctx.get('ACTION_MAPS').viridian_forest, problems = ctx.get('actionMapProblems');
    assert.ok(ctx.get('actionMapFreeFraction')(m) > 0.45);
    const bad = JSON.parse(JSON.stringify(m));
    bad.rows[m.spawn.y] = bad.rows[m.spawn.y].slice(0, m.spawn.x) + 'T' + bad.rows[m.spawn.y].slice(m.spawn.x + 1);
    assert.ok(problems(bad).some(p => p.includes('início bloqueado')));
    const shortRow = JSON.parse(JSON.stringify(m)); shortRow.rows[3] = shortRow.rows[3].slice(1);
    assert.ok(problems(shortRow).some(p => p.includes('largura')));
    const letter = JSON.parse(JSON.stringify(m)); letter.rows[5] = '#' + letter.rows[5].slice(1);
    assert.ok(problems(letter).some(p => p.includes('fora da legenda')));
    // zona isolada por um muro de árvores: inalcançável
    const walled = JSON.parse(JSON.stringify(m)), z = m.zones.find(q => q.id === 'noroeste');
    for (let y = z.y0 - 6; y <= z.y1 + 6; y++) if (y >= 0 && y < m.height) walled.rows[y] = walled.rows[y].split('').map((c, x) => (x >= z.x0 - 6 && x <= z.x1 + 6 && (x < z.x0 - 1 || x > z.x1 + 1 || y < z.y0 - 1 || y > z.y1 + 1) ? 'T' : c)).join('');
    assert.ok(problems(walled).some(p => p.includes('noroeste')));
    // passagem de 3 quadrados: estreita demais
    const narrow = { id: 'n', width: 30, height: 11, spawn: { x: 4, y: 5 }, zones: [{ id: 'a', x0: 2, y0: 2, x1: 8, y1: 8 }, { id: 'b', x0: 21, y0: 2, x1: 27, y1: 8 }], rows: [] };
    for (let y = 0; y < 11; y++) { let r = ''; for (let x = 0; x < 30; x++) r += (y === 0 || y === 10 || x === 0 || x === 29) ? 'T' : (x >= 10 && x <= 19 && (y < 4 || y > 6)) ? 'T' : '.'; narrow.rows.push(r); }
    assert.ok(problems(narrow).some(p => p.includes('estreita')), JSON.stringify(problems(narrow)));
});

test('F12 mapa: elites e chefe existem e têm níveis acima da rota da floresta', () => {
    const { ctx } = newGame();
    const m = ctx.get('ACTION_MAPS').viridian_forest;
    for (const e of m.elites) { assert.ok(ctx.POKEMON_DATA[e.id], `elite ${e.id}`); assert.ok(e.level >= 15 && e.level <= 18); }
    assert.ok(ctx.POKEMON_DATA[m.boss.id], 'chefe'); assert.ok(m.boss.level >= 18 && m.boss.level <= 22);
    assert.ok(m.elites.length >= 2);
});

test('F12 mapa: determinismo (mesmo mapa em dois carregamentos)', () => {
    const a = loadGameContext().get('ACTION_MAPS').viridian_forest, b = loadGameContext().get('ACTION_MAPS').viridian_forest;
    assert.deepEqual(Array.from(a.rows), Array.from(b.rows));
    assert.equal(JSON.stringify(a.zones), JSON.stringify(b.zones));
});
