'use strict';
// F12 · hordas do Mundo de Ação: arquétipos, IA dos inimigos, diretor de ondas e piloto automático (mundo falso mínimo + integração real).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newGame } = require('./helpers/game');

const STEP = 1 / 30;
const ROUTE_ID = 'kanto_viridian_forest';

// ---------- mundo falso que segue o contrato ----------
function makeMap(extraWalls = []) {
    const W = 48, H = 48, rows = [];
    for (let y = 0; y < H; y++) {
        let r = '';
        for (let x = 0; x < W; x++) r += (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? 'T' : '.';
        rows.push(r);
    }
    for (const [x, y] of extraWalls) rows[y] = rows[y].slice(0, x) + 'T' + rows[y].slice(x + 1);
    return { id: 'fake', width: W, height: H, rows, spawn: { x: 24, y: 24 },
        zones: [{ id: 'a', x0: 3, y0: 3, x1: 14, y1: 14 }, { id: 'b', x0: 30, y0: 3, x1: 44, y1: 14 }, { id: 'c', x0: 3, y0: 32, x1: 16, y1: 44 }, { id: 'grande', x0: 28, y0: 30, x1: 44, y1: 44 }],
        elites: [{ id: 12, level: 16 }, { id: 17, level: 17 }], boss: { id: 15, level: 20, zone: 'grande' } };
}
function makeWorld(ctx, game, opts = {}) {
    const map = opts.map || makeMap(), prof = (n, t, p) => ctx.moveFxProfile(n, t, p);
    const mv = (n, t, p) => ({ name: n, type: t, power: p, cd: 0, cdMax: 1, profile: prof(n, t, p) });
    const w = {
        map, game, t: 0, limit: opts.limit || 60, enemies: [], nextId: 1, rng: opts.rng || (() => game.rng()), auto: false, over: false,
        player: { id: 0, kind: 'player', alive: true, x: 24.5, z: 24.5, hp: 100, maxHp: 100, radius: 0.4, state: 'idle', moves: opts.playerMoves || [mv('Investida', 'normal', 40)],
            want: { mx: 0, mz: 0, cast: -1, aimX: 0, aimZ: 0 }, dashCd: 0 },
        near(x, z, r, out) { out.length = 0; for (const e of this.enemies) if (e.alive && Math.hypot(e.x - x, e.z - z) <= r) out.push(e); return out; },
        spawnEnemy(spec, x, z) {
            if (this.enemies.length >= this.limit) return null;
            const e = { id: this.nextId++, kind: 'enemy', alive: true, speciesId: spec.wild.id, shiny: false, level: spec.wild.level, x, z, vx: 0, vz: 0, radius: 0.4, hp: 20, maxHp: 20,
                state: 'idle', tier: spec.tier, arch: spec.arch, wild: spec.wild, seed: (this.nextId * 2654435761) >>> 0, speedMul: 1, stun: 0,
                moves: opts.enemyMoves ? opts.enemyMoves.map(m => ({ ...m })) : [mv('Investida', 'normal', 40)], want: { mx: 0, mz: 0, cast: -1, aimX: NaN, aimZ: NaN } };
            this.enemies.push(e); return e;
        },
        despawn(e) { e.alive = false; this.enemies = this.enemies.filter(o => o.alive); },
    };
    return w;
}
function addEnemy(w, speciesId, x, z, extra = {}) {
    const wild = { id: speciesId, level: 12, ivs: {}, isShiny: false };
    const e = w.spawnEnemy({ wild, tier: 'minion', arch: null }, x, z);
    Object.assign(e, extra);
    return e;
}
// roda a decisão do inimigo garantindo que o rodízio o escolha neste passo
function thinkNow(ctx, w, e) {
    e.id = 3; w.t = Math.ceil((w.t + 1e-9) / (3 * STEP)) * 3 * STEP + STEP * 0; w._hzStep = -1;
    const k = Math.round(w.t / STEP); if ((k + e.id) % 3 !== 0) w.t += STEP * (3 - (k + e.id) % 3);
    ctx.get('actionEnemyThink')(w, e, STEP);
}
const cx = (ctx) => ctx;

test('arquétipo de cada espécie da tabela e regra geral válida e determinística para as 1.073 espécies', () => {
    const { ctx } = newGame();
    const want = { 10: 'swarm', 11: 'cocoon', 12: 'support', 13: 'swarm', 14: 'cocoon', 15: 'swarm', 16: 'flyer', 19: 'swarm', 25: 'ranged', 46: 'tank', 47: 'tank', 123: 'flyer', 127: 'bruiser' };
    for (const [id, a] of Object.entries(want)) assert.equal(ctx.get('actionArchetypeFor')(Number(id)), a, `espécie ${id}`);
    const valid = new Set(Object.keys(ctx.get('ACTION_ARCHETYPES')));
    const ids = Object.keys(ctx.POKEMON_DATA).map(Number);
    assert.equal(ids.length, 1073);
    const count = {};
    for (const id of ids) {
        const a = ctx.get('actionArchetypeFor')(id);
        assert.ok(valid.has(a) && a !== 'boss', `espécie ${id}: ${a}`);
        assert.equal(ctx.get('actionArchetypeFor')(id), a);
        count[a] = (count[a] || 0) + 1;
    }
    // a regra geral usa os arquétipos comuns (variedade real, nada degenerado)
    for (const a of ['swarm', 'bruiser', 'tank', 'ranged', 'cocoon', 'support', 'flyer']) assert.ok(count[a] > 0, `nenhuma espécie ${a}`);
    // exemplos: voador → flyer, defesa alta → tanque
    assert.equal(ctx.get('actionArchetypeFor')(18), 'flyer');       // Pidgeot
    assert.equal(ctx.get('actionArchetypeFor')(95), 'tank');        // Onix
});

test('atirador mantém distância: recua se o jogador chega perto e aproxima se está longe', () => {
    const { ctx, game } = newGame({ seed: 3 });
    const bolt = ctx.moveFxProfile('Thunderbolt', 'electric', 90);
    const mk = (d) => {
        const w = makeWorld(ctx, game, { enemyMoves: [{ name: 'Thunderbolt', type: 'electric', power: 90, cd: 0, cdMax: 1, profile: bolt }] });
        const e = addEnemy(w, 25, 24.5 + d, 24.5);
        ctx.get('actionInitEnemy')(e); e.aiNextPause = 1e9;
        return { w, e };
    };
    let { w, e } = mk(2.5);
    thinkNow(ctx, w, e);
    assert.ok(e.want.mx > 0.5, 'perto demais: foge para longe do jogador (leste)');
    ({ w, e } = mk(14));
    thinkNow(ctx, w, e);
    assert.ok(e.want.mx < -0.5, 'longe: aproxima');
    // na distância boa não foge nem corre de frente: anda pouco e pode lançar o golpe
    ({ w, e } = mk(5));
    e.x = w.player.x + 5 * e.aiVar;
    thinkNow(ctx, w, e);
    assert.ok(Math.hypot(e.want.mx, e.want.mz) <= 0.4);
});

test('enxame se aproxima por ângulos diferentes conforme a semente (e igual com a mesma semente)', () => {
    const { ctx, game } = newGame({ seed: 4 });
    const heading = (seed) => {
        const w = makeWorld(ctx, game), e = addEnemy(w, 10, 24.5 + 16, 24.5, { seed });
        ctx.get('actionInitEnemy')(e); e.aiNextPause = 1e9;
        thinkNow(ctx, w, e);
        return Math.atan2(e.want.mz, e.want.mx);
    };
    const hs = [];
    for (let s = 1; s <= 12; s++) hs.push(heading(s * 7919));
    assert.ok(Math.max(...hs) - Math.min(...hs) > 0.5, 'ângulos de aproximação variados');
    assert.equal(heading(12345), heading(12345));
    assert.ok(new Set(hs.map(h => h.toFixed(2))).size >= 6);
});

test('casulo fica quase parado, endurece quando o jogador chega perto e volta ao normal', () => {
    const { ctx, game } = newGame({ seed: 5 });
    const w = makeWorld(ctx, game);
    const e = addEnemy(w, 11, 24.5 + 10, 24.5);
    ctx.get('actionInitEnemy')(e);
    let maxMag = 0, guardSeen = 0, guardZero = 0;
    for (let i = 0; i < 300; i++) {
        w.t += STEP; e.id = i;
        w.player.x = 24.5 + (i > 100 && i < 200 ? 4 : 0);
        ctx.get('actionEnemyThink')(w, e, STEP);
        maxMag = Math.max(maxMag, Math.hypot(e.want.mx, e.want.mz));
        if (e.guard > 0) guardSeen++; else guardZero++;
    }
    assert.ok(e.speedMul < 0.3, 'velocidade mínima');
    assert.ok(maxMag <= 0.5, 'quase parado');
    assert.ok(guardSeen > 10 && guardZero > 10, `guard ${guardSeen}/${guardZero}`);
    assert.ok(e.guard >= 0 && e.guard <= 1);
});

test('desvio de parede: não anda de cabeça contra a parede', () => {
    const { ctx, game } = newGame({ seed: 6 });
    const walls = []; for (let y = 8; y <= 40; y++) walls.push([13, y]);
    const w = makeWorld(ctx, game, { map: makeMap(walls) });
    w.player.x = 30.5; w.player.z = 24.5;
    const e = addEnemy(w, 10, 12.4, 24.5);
    ctx.get('actionInitEnemy')(e); e.aiNextPause = 1e9;
    thinkNow(ctx, w, e);
    assert.ok(Math.abs(e.want.mz) > 0.3, 'contorna pelo lado livre');
});

function runDirector(ctx, game, { limit = 60, killAll = true, seconds = 400, withEmit = false } = {}) {
    const map = makeMap(), w = makeWorld(ctx, game, { map, limit });
    const route = ctx.REGIONS.kanto.routes.find(r => r.id === ROUTE_ID);
    const got = [];
    if (withEmit) w.emit = (ev) => got.push(ev);
    const d = new (ctx.get('ActionDirector'))(w, map, route);
    return { w, d, map, route, got };
}

test('diretor: grupos nascem nas zonas, longe do jogador, em célula livre e juntos', () => {
    const { ctx, game } = newGame({ seed: 7 });
    const { w, d, map } = runDirector(ctx, game);
    for (let i = 0; i < 300 && w.enemies.length < 8; i++) { w.t += STEP; d.update(STEP); }
    assert.equal(d.state.n, 1);
    assert.equal(d.state.kind, 'normal');
    for (let i = 0; i < 100; i++) { w.t += STEP; d.update(STEP); }
    assert.equal(w.enemies.length, 8);
    const MIN = ctx.get('ACTION_BALANCE').spawnMinDist;
    for (const e of w.enemies) {
        assert.ok(Math.hypot(e.x - w.player.x, e.z - w.player.z) >= MIN, 'longe do jogador');
        assert.ok(!ctx.worldCellBlocked(map, Math.floor(e.x), Math.floor(e.z)), 'célula livre');
        assert.ok(map.zones.some(z => e.x >= z.x0 && e.x <= z.x1 + 1 && e.z >= z.y0 && e.z <= z.y1 + 1), 'dentro de uma zona');
        assert.ok(e.arch && e.aiInit === 1, 'arquétipo e IA preparados');
    }
    // grupos: componentes conexos (vizinhos a até 3,5) entre 2 e 4, e ninguém sozinho
    const seen = new Set(); let comps = 0;
    for (const e of w.enemies) {
        if (seen.has(e)) continue;
        comps++; const st = [e]; seen.add(e); let size = 0;
        while (st.length) { const c = st.pop(); size++; for (const o of w.enemies) if (!seen.has(o) && Math.hypot(o.x - c.x, o.z - c.z) <= 3.5) { seen.add(o); st.push(o); } }
        assert.ok(size >= 2, 'grupo com mais de um membro');
    }
    assert.ok(comps >= 2 && comps <= 4, `${comps} grupos`);
});

test('diretor: respeita world.limit e os reforços entram quando abre espaço', () => {
    const { ctx, game } = newGame({ seed: 8 });
    const { w, d } = runDirector(ctx, game, { limit: 5 });
    let max = 0;
    for (let i = 0; i < 400; i++) { w.t += STEP; d.update(STEP); max = Math.max(max, w.enemies.length); }
    assert.equal(max, 5);
    assert.equal(w.enemies.length, 5);
    assert.equal(d.state.total, 8);
    assert.ok(d.state.left > 5, 'ainda há reforços pendentes');
    w.despawn(w.enemies[0]); w.despawn(w.enemies[0]);
    for (let i = 0; i < 60; i++) { w.t += STEP; d.update(STEP); max = Math.max(max, w.enemies.length); }
    assert.equal(w.enemies.length, 5, 'repôs o espaço aberto');
    assert.ok(max <= 5);
});

test('diretor: elite na onda certa, chefe na onda bossAt, evento wave e ciclo mais forte', () => {
    const { ctx, game } = newGame({ seed: 9 });
    const BAL = ctx.get('ACTION_BALANCE');
    for (const withEmit of [false, true]) {
        const { w, d, got, map } = runDirector(ctx, game, { withEmit });
        const kinds = {}, tiers = {};
        let lastN = 0;
        for (let i = 0; i < 40 * 30 * 15 && d.state.n <= BAL.wave.bossAt + 1; i++) {
            w.t += STEP; d.update(STEP);
            if (d.state.n !== lastN) { lastN = d.state.n; kinds[lastN] = d.state.kind; }
            for (let k = 0; k < w.enemies.length; k++) { const e = w.enemies[k]; (tiers[d.state.n] = tiers[d.state.n] || new Set()).add(e.tier); }
            if (d.head >= d.jobs.length) for (const e of w.enemies.slice()) w.despawn(e);       // o jogador mata tudo
        }
        const evs = withEmit ? got : d.events;
        assert.ok(evs.length >= BAL.wave.bossAt && evs.every(x => x.t === 'wave'));
        assert.deepEqual(Array.from(evs.slice(0, 3), x => x.n), [1, 2, 3]);
        for (let n = 1; n <= BAL.wave.bossAt + 1; n++) {
            const wi = ((n - 1) % BAL.wave.bossAt) + 1;
            const expect = wi === BAL.wave.bossAt ? 'boss' : wi % BAL.wave.eliteEvery === 0 ? 'elite' : 'normal';
            assert.equal(kinds[n], expect, `onda ${n}`);
            assert.equal(evs[n - 1].kind, expect);
        }
        assert.ok(tiers[3].has('elite') && !tiers[2].has('elite') && !tiers[1].has('boss'));
        assert.ok(tiers[BAL.wave.bossAt].has('boss'), 'chefe na onda bossAt');
        if (!withEmit) assert.ok(d.events.length <= 64);
        void map;
    }
});

test('diretor: o chefe nasce na zona dele com escolta, arquétipo boss, longe do jogador', () => {
    const { ctx, game } = newGame({ seed: 10 });
    const BAL = ctx.get('ACTION_BALANCE');
    const { w, d, map } = runDirector(ctx, game);
    let boss = null;
    for (let i = 0; i < 40 * 30 * 15 && !boss; i++) {
        w.t += STEP; d.update(STEP);
        if (d.head >= d.jobs.length) for (const e of w.enemies.slice()) { if (e.tier !== 'boss') w.despawn(e); }
        boss = w.enemies.find(e => e.tier === 'boss');
    }
    assert.ok(boss);
    assert.equal(d.state.n, BAL.wave.bossAt);
    assert.equal(boss.arch, 'boss');
    assert.equal(boss.speciesId, 15);
    const z = map.zones.find(q => q.id === 'grande');
    assert.ok(boss.x >= z.x0 && boss.x <= z.x1 + 1 && boss.z >= z.y0 && boss.z <= z.y1 + 1);
    assert.ok(Math.hypot(boss.x - w.player.x, boss.z - w.player.z) >= BAL.spawnMinDist);
    for (let i = 0; i < 60; i++) { w.t += STEP; d.update(STEP); }
    assert.ok(w.enemies.length > 5, 'com escolta');
});

function pilotWorld(ctx, game, enemies) {
    const mv = (n, t, p, cd = 0) => ({ name: n, type: t, power: p, cd, cdMax: 3, profile: ctx.moveFxProfile(n, t, p) });
    const w = makeWorld(ctx, game, { playerMoves: [mv('Investida', 'normal', 40), mv('Ice Beam', 'ice', 90), mv('Earthquake', 'ground', 100)] });
    w.auto = true; w.t = 1;
    for (const [x, z] of enemies) addEnemy(w, 10, x, z);
    return w;
}

test('piloto automático escolhe o golpe que cobre mais inimigos', () => {
    const { ctx, game } = newGame({ seed: 11 });
    // aglomerado ao redor: a onda ao redor (Earthquake, índice 2) pega todos; o feixe pega poucos
    let w = pilotWorld(ctx, game, [[27.5, 24.5], [27.5, 26], [27.5, 23], [26, 27], [26, 22], [28.5, 25.5]]);
    ctx.get('actionAutoPilot')(w, 0.2);
    assert.equal(w.player.want.cast, 2);
    // fila em linha: o feixe (Ice Beam, índice 1) pega todos; a onda só os mais próximos
    w = pilotWorld(ctx, game, [[27.5, 24.5], [29.5, 24.5], [31.5, 24.5], [33.5, 24.5], [34.5, 24.5]]);
    ctx.get('actionAutoPilot')(w, 0.2);
    assert.equal(w.player.want.cast, 1);
    // golpe em recarga não é escolhido
    w = pilotWorld(ctx, game, [[27.5, 24.5], [29.5, 24.5], [31.5, 24.5], [33.5, 24.5], [34.5, 24.5]]);
    w.player.moves[1].cd = 2;
    ctx.get('actionAutoPilot')(w, 0.2);
    assert.notEqual(w.player.want.cast, 1);
});

test('piloto: poção com vida baixa (política de cura), esquiva cercado e passeia sem inimigos', () => {
    const { ctx, game } = newGame({ seed: 12 });
    const w = pilotWorld(ctx, game, [[25.5, 24.5], [23.5, 24.5], [24.5, 25.5], [24.5, 23.5]]);
    w.player.hp = 10;
    assert.ok(game.getPotions() > 0);
    ctx.get('actionAutoPilot')(w, 0.2);
    assert.equal(w.input.potion, true);
    assert.equal(w.input.dash, true, 'cercado: esquiva');
    // sem inimigos: anda em direção a uma zona
    const w2 = pilotWorld(ctx, game, []);
    ctx.get('actionAutoPilot')(w2, 0.2);
    assert.ok(Math.hypot(w2.player.want.mx, w2.player.want.mz) > 0.3);
});

test('determinismo: mesma semente, mesma simulação de decisões', () => {
    const run = () => {
        const { ctx, game } = newGame({ seed: 21 });
        const { w, d } = runDirector(ctx, game);
        let h = 0;
        for (let i = 0; i < 600; i++) {
            w.t += STEP; d.update(STEP);
            for (const e of w.enemies) {
                ctx.get('actionEnemyThink')(w, e, STEP);
                e.x += e.want.mx * 3 * e.speedMul * STEP; e.z += e.want.mz * 3 * e.speedMul * STEP;
                h = (h * 31 + Math.round(e.x * 100) + Math.round(e.z * 100) * 7 + e.want.cast) | 0;
            }
        }
        return [h, w.enemies.length, d.state.n];
    };
    assert.deepEqual(run(), run());
});

// ---------- integração real com o ActionWorld (quando o núcleo existe) ----------
const hasCore = fs.existsSync(path.join(__dirname, '..', 'js', 'action', 'action-core.js')) && fs.existsSync(path.join(__dirname, '..', 'js', 'action', 'action-maps.js'));
test('integração real: 900 passos no automático, ninguém atravessa parede, ondas avançam e há abates', { skip: !hasCore && 'sem action-core/action-maps' }, () => {
    const { ctx, game } = newGame({ seed: 31 });
    game._partyInstance(0).level = 30;       // o inicial Nv 5 não sobrevive a inimigos Nv 11-15: o teste mede a IA, não o balanceamento
    const mapDef = ctx.get('ACTION_MAPS').viridian_forest;
    const route = ctx.REGIONS.kanto.routes.find(r => r.id === mapDef.route);
    const World = ctx.get('ActionWorld');
    const world = new World(game, mapDef, { think: ctx.get('actionEnemyThink'), pilot: ctx.get('actionAutoPilot'), auto: true, quality: 'medium' });
    world.director = new (ctx.get('ActionDirector'))(world, mapDef, route);
    world.auto = true;
    let wall = 0, firstDist = null, lastDist = null, maxN = 0;
    const STEPS = 900;
    for (let i = 0; i < STEPS; i++) {
        world.step(STEP);
        if (world.over) break;
        for (const e of world.enemies) if (e.alive && ctx.worldCellBlocked(mapDef, Math.floor(e.x), Math.floor(e.z))) wall++;
        if (ctx.worldCellBlocked(mapDef, Math.floor(world.player.x), Math.floor(world.player.z))) wall++;
        maxN = Math.max(maxN, world.enemies.length);
        if (i === 120 && world.enemies.length) { let s = 0; for (const e of world.enemies) s += Math.hypot(e.x - world.player.x, e.z - world.player.z); firstDist = s / world.enemies.length; }
        if (i === 600 && world.enemies.length) { let s = 0; for (const e of world.enemies) s += Math.hypot(e.x - world.player.x, e.z - world.player.z); lastDist = s / world.enemies.length; }
        world.drainEvents();
    }
    assert.equal(wall, 0, 'ninguém dentro de parede');
    assert.ok(maxN > 0 && maxN <= world.limit);
    assert.ok(world.director.state.n >= 1);
    assert.ok(!world.over && world.kills >= 5, `abates: ${world.kills}`);
    if (firstDist != null && lastDist != null) assert.ok(lastDist < 30, 'inimigos se aproximam do jogador');
});
