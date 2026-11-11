'use strict';
// F12 · Mundo de Ação: simulação pura (ActionWorld). Movimento, colisão, esquiva, golpes em área, dano, crédito de recompensa, captura, poção, troca.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, mulberry32, sequenceRng, ivs } = require('./helpers/game');

const W = 30, H = 30;
const rows = Array.from({ length: H }, (_, z) => z === 0 || z === H - 1 ? 'T'.repeat(W) : 'T' + '.'.repeat(W - 2) + 'T');
const MAP = { id: 'test_action', type: 'route', name: 'Teste', width: W, height: H, rows, spawn: { x: 15, y: 15, dir: 'down' } };
const NOTHINK = () => {};
const STEP = 1 / 30;

function make(opts = {}, gopts = {}) {
    const { game, ctx } = newGame({ seed: 7, ...gopts });
    const Cls = ctx.get('ActionWorld');
    const world = new Cls(game, MAP, { think: NOTHINK, start: { x: 15.5, z: 15.5 }, ...opts });
    return { game, ctx, world };
}
function run(world, n, evs) { for (let i = 0; i < n; i++) { world.step(STEP); const d = world.drainEvents(); if (evs) for (const e of d) evs.push({ ...e }); } }
function wild(game, id = 19, level = 5) { return game.createWildPokemon(id, level, 0); }
function enemy(world, x, z, id = 19, level = 5, tier = 'minion') {
    const e = world.spawnEnemy({ wild: wild(world.game, id, level), tier }, x, z);
    assert.ok(e, 'inimigo nasceu');
    e.hp = e.maxHp = 1e7;
    return e;
}
function setMoves(world, list) { world._setMoves(world.player, list); for (const m of world.player.moves) m.cd = 0; }
function polar(world, cx, cz, dist, deg) { const a = deg * Math.PI / 180; return [cx + Math.cos(a) * dist, cz + Math.sin(a) * dist]; }
function setBalls(game, balls) { const inv = game.ensureInventory(); inv.ballsGranted = true; inv.balls = { ...balls }; }
function hits(evs) { return evs.filter(e => e.t === 'hit'); }

test('F12 movimento: acelera, para na parede (círculo) e freia sem inimigos', () => {
    const { world } = make({}, {});
    world.player.x = 26.5; world.setInput({ mx: 1, mz: 0 });
    run(world, 3);
    assert.ok(world.player.vx > 0 && world.player.vx < 5.5, 'acelera, não salta para a velocidade final');
    run(world, 100);
    assert.ok(world.player.x <= 29 - 0.4 + 1e-6 && world.player.x > 28.4, 'encosta na parede: ' + world.player.x);
    world.setInput({ mx: 0, mz: 0 });
    run(world, 30);
    assert.ok(Math.abs(world.player.vx) < 1e-6, 'desacelera até parar');
    assert.ok(world.player.speed === undefined);
});

test('F12 movimento: desliza na parede (eixo livre continua)', () => {
    const { world } = make();
    world.player.x = 26.5; world.player.z = 10.5; world.setInput({ mx: 1, mz: 1 });
    run(world, 120);
    assert.ok(world.player.x <= 28.6 + 1e-6, 'x travado na parede');
    assert.ok(world.player.z > 13, 'z continuou: ' + world.player.z);
});

test('F12 esquiva: desloca rápido, dá invulnerabilidade, tem recarga e não atravessa parede', () => {
    const { world } = make();
    const x0 = world.player.x, evs = [];
    world.setInput({ mx: 1, mz: 0, dash: true });
    run(world, 1, evs);
    assert.ok(world.player.iframes > 0, 'iframes');
    run(world, 6, evs);
    assert.ok(world.player.x - x0 > 2.5, 'andou ~3 quadrados: ' + (world.player.x - x0));
    assert.equal(evs.filter(e => e.t === 'dash').length, 1);
    world.setInput({ dash: true }); run(world, 1, evs);
    assert.equal(evs.filter(e => e.t === 'dash').length, 1, 'em recarga');
    run(world, 80, evs);
    world.setInput({ dash: true }); run(world, 1, evs);
    assert.equal(evs.filter(e => e.t === 'dash').length, 2, 'recarga acabou');
    // parede
    world.player.x = 27.9; world.player.z = 15.5; world.player.dashCd = 0; world.setInput({ mx: 1, dash: true }); run(world, 10);
    assert.ok(world.player.x <= 28.6 + 1e-6, 'não atravessa: ' + world.player.x);
});

test('F12 esquiva: durante os iframes o ataque do inimigo não causa dano', () => {
    const { world } = make({ think: undefined });
    enemy(world, 17, 15.5);
    world.player.moves[0].cd = 99;
    world.setInput({ mx: 0, mz: 0, dash: true });
    const evs = []; run(world, 3, evs);
    world.enemies[0].moves[0].cd = 0; world.enemies[0].x = 16.3; world.enemies[0].z = 15.5; world.player.x = 15.5; world.player.z = 15.5; world.player.dashT = 0; world.player.iframes = 1;
    run(world, 15, evs);
    assert.equal(hits(evs).filter(h => h.id === 0).length, 0, 'sem dano com iframes');
});

test('F12 golpe em círculo: 10 inimigos no raio levam dano e os de fora não', () => {
    const { world } = make();
    setMoves(world, [{ name: 'Investida', type: 'normal', power: 40 }, { name: 'Leaf Storm', type: 'grass', power: 130 }]);
    world.player.moves[0].cd = 99;
    const px = 15.5, pz = 15.5, cx = px + 5, cz = pz;
    const inside = [enemy(world, cx, cz)];
    for (let i = 0; i < 9; i++) { const [x, z] = polar(world, cx, cz, 1.4, i * 40); inside.push(enemy(world, x, z)); }
    const outside = [enemy(world, cx, cz + 5), enemy(world, cx + 6, cz), enemy(world, cx, cz - 7)];
    const prof = world.player.moves[1].profile;
    assert.equal(prof.area.r, 3);
    // alvo = o mais próximo: o do anel mais perto do jogador; recalcula o centro a partir dele
    const pos = new Map(inside.concat(outside).map(e => [e.id, [e.x, e.z]]));
    world.setInput({ skill: 1 });
    const evs = []; run(world, 20, evs);
    const ids = new Set(hits(evs).map(h => h.id));
    const tgt = evs.find(e => e.t === 'cast');
    const covered = (e) => Math.hypot(pos.get(e.id)[0] - tgt.tx, pos.get(e.id)[1] - tgt.tz) <= 3;
    let n = 0;
    for (const e of inside.concat(outside)) { const got = ids.has(e.id); assert.equal(got, covered(e), 'id ' + e.id); if (inside.includes(e) && got) n++; }
    assert.equal(n, 10, 'os 10 do raio levam dano');
    for (const e of outside.slice(0, 2)) assert.ok(!ids.has(e.id));
});

test('F12 golpe em linha: respeita comprimento e largura', () => {
    const { world } = make();
    setMoves(world, [{ name: 'Investida', type: 'normal', power: 40 }, { name: 'Ice Beam', type: 'ice', power: 90 }]);
    world.player.moves[0].cd = 99;
    assert.equal(world.player.moves[1].profile.area.kind, 'line');
    const A = enemy(world, 20.5, 15.5), B = enemy(world, 23.5, 15.8), C = enemy(world, 22.5, 16.9), D = enemy(world, 27.0, 15.5), E = enemy(world, 5.0, 15.5);
    world.setInput({ skill: 1 });
    const evs = []; run(world, 12, evs);
    const ids = new Set(hits(evs).map(h => h.id));
    assert.ok(ids.has(A.id) && ids.has(B.id), 'dentro da faixa');
    assert.ok(!ids.has(C.id), 'fora da largura');
    assert.ok(!ids.has(D.id), 'além do comprimento (10)');
    assert.ok(!ids.has(E.id), 'atrás');
});

test('F12 golpe em cone: respeita ângulo e alcance', () => {
    const { world } = make();
    setMoves(world, [{ name: 'Investida', type: 'normal', power: 40 }, { name: 'Dragon Breath', type: 'dragon', power: 60 }]);
    world.player.moves[0].cd = 99;
    const a = world.player.moves[1].profile.area;
    assert.equal(a.kind, 'cone'); assert.equal(a.len, 6.5); assert.equal(a.angle, 50);
    const px = 15.5, pz = 15.5;
    const A = enemy(world, px + 4, pz);
    const [bx, bz] = polar(world, px, pz, 5, 20), [cx, cz] = polar(world, px, pz, 5, 35);
    const B = enemy(world, bx, bz), C = enemy(world, cx, cz), D = enemy(world, px + 7.2, pz), E = enemy(world, px - 5, pz);
    world.setInput({ skill: 1 });
    const evs = []; run(world, 14, evs);
    const ids = new Set(hits(evs).map(h => h.id));
    assert.ok(ids.has(A.id) && ids.has(B.id));
    assert.ok(!ids.has(C.id), '35 graus > meio ângulo (25)');
    assert.ok(!ids.has(D.id), 'além do alcance');
    assert.ok(!ids.has(E.id), 'atrás');
});

test('F12 dano: usa a efetividade de tipos do jogo', () => {
    const eff = (id) => {
        const { world, ctx } = make();
        setMoves(world, [{ name: 'Flame Wheel', type: 'fire', power: 60 }]);
        enemy(world, 16.9, 15.5, id, 5);
        const evs = []; run(world, 15, evs);
        const h = hits(evs)[0];
        assert.ok(h, 'acertou');
        assert.equal(h.eff, ctx.getBestTypeEffectiveness(['fire'], ctx.POKEMON_DATA[id].types).multiplier);
        return h.eff;
    };
    assert.equal(eff(1), 2);     // fogo contra planta/veneno
    assert.equal(eff(7), 0.5);   // fogo contra água
});

test('F12 inimigo ataca o jogador pelo mesmo caminho (padrão embutido)', () => {
    const { world } = make({ think: undefined });
    const e = enemy(world, 20.5, 15.5);
    world.player.moves[0].cd = 99;
    const evs = []; run(world, 90, evs);
    const h = hits(evs).filter(x => x.id === 0);
    assert.ok(h.length >= 1, 'jogador levou golpe');
    assert.equal(h[0].by, e.id);
    assert.ok(world.player.hp < world.player.maxHp);
});

test('F12 banco de crédito: 5 abates de minion (0,2) = exatamente 1 vitória oficial', () => {
    const { world, game, ctx } = make();
    const bal = ctx.get('ACTION_BALANCE'), saved = bal.rewardCredit.minion;
    bal.rewardCredit.minion = 0.2;      // o contrato: 5 abates de 0,2 = 1 vitória (o número do balanceamento pode mudar; a regra do banco não)
    const uid = game.gameState.party[0], inst = game.gameState.ownedPokemon[uid];
    const b0 = game.gameState.stats.totalBattles, exp0 = game.gameState.stats.totalExp, evs = [];
    const ring = [];
    for (let i = 0; i < 5; i++) { const [x, z] = polar(world, 15.5, 15.5, 1.3, i * 72); const e = world.spawnEnemy({ wild: wild(game, 19, 5), tier: 'minion' }, x, z); e.hp = 1; ring.push(e); }
    let guard = 0;
    while (world.kills < 4 && guard++ < 600) run(world, 1, evs);
    assert.equal(world.kills, 4);
    assert.equal(game.gameState.stats.totalBattles, b0, '4 abates ainda não pagam');
    while (world.kills < 5 && guard++ < 900) run(world, 1, evs);
    assert.equal(world.kills, 5);
    assert.equal(game.gameState.stats.totalBattles, b0 + 1, 'exatamente 1 vitória');
    const rw = evs.filter(e => e.t === 'reward');
    assert.equal(rw.length, 1);
    assert.ok(rw[0].exp > 0 && game.gameState.stats.totalExp - exp0 === rw[0].exp, 'EXP total = EXP da vitória oficial');
    assert.ok(Math.abs(world.credit) < 1e-9);
    assert.ok(inst.exp > 0 || inst.level > 1);
    bal.rewardCredit.minion = saved;
});

test('F12 nível: vitória emite level, aumenta vida máxima e a vida atual acompanha', () => {
    const { world, game } = make();
    const maxBefore = world.player.maxHp, lvBefore = world.player.level;
    const e = world.spawnEnemy({ wild: wild(game, 19, 80), tier: 'elite' }, 16.7, 15.5);
    e.hp = 1;
    const evs = []; run(world, 40, evs);
    assert.equal(world.kills, 1);
    assert.ok(evs.some(x => x.t === 'level'), 'evento level');
    assert.ok(world.player.level > lvBefore);
    assert.ok(world.player.maxHp > maxBefore, 'vida máxima cresceu');
    assert.equal(world.player.hp, world.player.maxHp, 'a vida que cresceu entra na atual');
    assert.equal(game.exploreSnapshot(0).level, world.player.level);
});

test('F12 captura: sucesso gasta a bola, sai do mundo sem crédito e o mundo não trava', () => {
    const { world, game } = make({}, { balls: true });
    setBalls(game, { pokeball: 5 });
    world.player.moves[0].cd = 99;
    const e = enemy(world, 18.5, 15.5); e.hp = Math.floor(e.maxHp * 0.1) || 1; e.maxHp = 1000; e.hp = 100;
    const owned0 = Object.keys(game.gameState.ownedPokemon).length, hpBefore = e.hp;
    game.rng = sequenceRng([0]);
    world.setInput({ capture: true, mx: 1, mz: 0 });
    const evs = []; run(world, 1, evs);
    assert.equal(game.getBallCount('pokeball'), 4);
    assert.equal(e.state, 'balled');
    const x0 = world.player.x;
    run(world, 15, evs);
    assert.ok(world.player.x > x0 + 0.5, 'jogador continua andando');
    assert.equal(e.hp, hpBefore, 'balled não leva dano');
    run(world, 80, evs);
    const st = evs.filter(x => x.t === 'capture').map(x => x.stage);
    assert.equal(st[0], 'throw'); assert.ok(st.includes('shake')); assert.equal(st[st.length - 1], 'caught');
    assert.equal(world.enemies.length, 0);
    assert.equal(world.kills, 0); assert.equal(world.credit, 0);
    assert.equal(Object.keys(game.gameState.ownedPokemon).length, owned0 + 1);
});

test('F12 captura: falha gasta a bola e o inimigo volta a lutar', () => {
    const { world, game } = make({ think: undefined }, { balls: true });
    setBalls(game, { pokeball: 5 });
    world.player.moves[0].cd = 99;
    const e = enemy(world, 19.5, 15.5); e.maxHp = 1000; e.hp = 100;
    game.rng = sequenceRng([0.999]);
    world.setInput({ capture: true });
    const evs = []; run(world, 1, evs);
    assert.equal(e.state, 'balled');
    const px = e.x; run(world, 20, evs);
    assert.equal(e.x, px, 'balled não se move');
    run(world, 30, evs);
    assert.equal(evs.filter(x => x.t === 'capture' && x.stage === 'free').length, 1);
    assert.equal(game.getBallCount('pokeball'), 4);
    assert.notEqual(e.state, 'balled');
    assert.equal(world.enemies.length, 1);
    const x1 = e.x; run(world, 30); assert.notEqual(e.x, x1, 'voltou a se mover');
});

test('F12 poção: cura a porcentagem oficial, gasta 1 e respeita a recarga', () => {
    const { world, game, ctx } = make();
    const inv = game.ensureInventory(); inv.potions = 3;
    const p = world.player; p.hp = Math.floor(p.maxHp / 4);
    const before = p.hp, heal = ctx.potionHealAmount(p.maxHp, game.getPotionHealPercent());
    world.setInput({ potion: true }); run(world, 1);
    assert.equal(p.hp, Math.min(p.maxHp, before + heal)); assert.equal(inv.potions, 2);
    p.hp = 1; world.setInput({ potion: true }); run(world, 1);
    assert.equal(inv.potions, 2, 'recarga');
    run(world, 130); world.setInput({ potion: true }); run(world, 1);
    assert.equal(inv.potions, 1);
});

function addMate(game, ctx) {
    const r = game.roster.create({ speciesId: 25, level: 8, ivs: ivs(0), nature: 'bold', rng: () => 0.5, place: 'party' });
    assert.ok(r, 'segundo Pokémon');
}

test('F12 troca e derrota: down troca para o próximo vivo; sem ninguém, wipe', () => {
    const { world, game, ctx } = make({}, {});
    addMate(game, ctx);
    const w2 = new (ctx.get('ActionWorld'))(game, MAP, { think: NOTHINK, start: { x: 15.5, z: 15.5 } });
    assert.equal(w2.party.length, 2);
    const first = w2.active.idx;
    assert.equal(w2.swapPlayer(first), false, 'já é o ativo');
    assert.equal(w2.swapPlayer(1 - first), true);
    assert.equal(w2.player.partyIndex, 1 - first);
    assert.equal(w2.swapPlayer(first), false, 'em recarga');
    const evs = []; run(w2, 1, evs);
    assert.ok(evs.some(e => e.t === 'swap'));
    const k = w2.keep(); assert.equal(Object.keys(k).length, 2);
    w2.player.hp = 0; run(w2, 1, evs);
    assert.ok(evs.some(e => e.t === 'down'));
    assert.equal(w2.player.partyIndex, first, 'trocou para o outro');
    assert.equal(w2.keep()[game.gameState.party[1 - first]].hp, 0, 'vida caída guardada no keep');
    w2.player.hp = 0; run(w2, 1, evs);
    assert.ok(evs.some(e => e.t === 'wipe')); assert.equal(w2.over, true);
    const t = w2.t; run(w2, 5); assert.equal(w2.t, t, 'mundo parado');
    // keep inicial
    const w3 = new (ctx.get('ActionWorld'))(game, MAP, { think: NOTHINK, keep: { [game.gameState.party[0]]: { hp: 0.5 } } });
    assert.ok(Math.abs(w3.party[0].hp / w3.party[0].maxHp - 0.5) < 0.01);
});

test('F12 limite: por qualidade; célula bloqueada devolve null', () => {
    const { world, game } = make({ quality: 'low' });
    assert.equal(world.limit, 28);
    let n = 0;
    for (let i = 0; i < 40; i++) if (world.spawnEnemy({ wild: wild(game), tier: 'minion' }, 3 + (i % 20), 3 + Math.floor(i / 20) * 3)) n++;
    assert.equal(n, 28);
    assert.equal(world.spawnEnemy({ wild: wild(game), tier: 'minion' }, 1.5, 1.5), null, 'no limite');
    const m2 = make({ quality: 'high' }).world;
    assert.equal(m2.limit, 60);
    assert.equal(m2.spawnEnemy({ wild: wild(m2.game), tier: 'minion' }, 0.5, 0.5), null, 'parede');
    assert.equal(m2.enemies.length, 0);
});

test('F12 snapshot: chaves do contrato e eventos reaproveitados', () => {
    const { world } = make();
    const s = world.snapshot();
    assert.deepEqual(Object.keys(s).sort(), ['auto', 'ball', 'boss', 'captureReady', 'combo', 'dash', 'kills', 'over', 'party', 'player', 'potions', 'skills', 'wave'].sort());
    assert.deepEqual(Object.keys(s.player).sort(), ['expFrac', 'hp', 'level', 'maxHp', 'name', 'shiny', 'speciesId', 'types']);
    assert.deepEqual(Object.keys(s.skills[0]).sort(), ['cd', 'cdMax', 'label', 'name', 'shape', 'type']);
    assert.equal(world.snapshot(), s, 'objeto reaproveitado');
    enemy(world, 17, 15.5); run(world, 5);
    const a = world.drainEvents(), b = world.drainEvents();
    assert.equal(a, b, 'vetor reaproveitado'); assert.equal(b.length, 0, 'fila esvaziada');
});

function digest(seed) {
    const { world, game } = make({ think: undefined }, { seed });
    world.player.hp = world.player.maxHp = 1e7;
    for (let i = 0; i < 12; i++) { const [x, z] = polar(world, 15.5, 15.5, 6 + (i % 3), i * 30); world.spawnEnemy({ wild: wild(game, 19 + (i % 3), 8), tier: 'minion' }, x, z); }
    const log = [];
    for (let i = 0; i < 300; i++) {
        world.setInput({ mx: Math.sin(i / 20), mz: Math.cos(i / 17), skill: i % 50 === 0 ? 1 : -1, dash: i % 90 === 0 });
        world.step(STEP);
        for (const e of world.drainEvents()) log.push(e.t + e.id + ':' + e.dmg);
    }
    return JSON.stringify({ log, p: [world.player.x, world.player.z, world.player.hp], en: world.enemies.map(e => [e.id, e.x, e.z, e.hp]) });
}
test('F12 determinismo: mesma semente e mesma entrada = mesmo estado', () => {
    assert.equal(digest(11), digest(11));
    assert.notEqual(digest(11), digest(12));
});

test('F12 desempenho: 60 inimigos por 600 passos sem erro e com tempo médio por passo', () => {
    const { world, game } = make({ think: undefined, quality: 'high' });
    world.player.hp = world.player.maxHp = 1e9;
    for (let i = 0; i < 60; i++) {
        const [x, z] = polar(world, 15.5, 15.5, 7 + (i % 5), i * 6);
        const e = world.spawnEnemy({ wild: wild(game, 19 + (i % 5), 10), tier: 'minion' }, x, z);
        assert.ok(e);
        e.hp = e.maxHp = 1e9;
    }
    assert.equal(world.enemies.length, 60);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 600; i++) { world.setInput({ mx: Math.sin(i / 30), mz: Math.cos(i / 30), skill: i % 40 === 0 ? 1 : -1 }); world.step(STEP); world.drainEvents(); }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 600;
    console.log(`F12 60 inimigos: ${ms.toFixed(3)} ms por passo`);
    assert.ok(ms < 5, 'passo barato: ' + ms);
    assert.equal(world.enemies.length, 60);
});

test('F12 integração: guard reduz o dano, windupMul alonga o preparo, mass manda na separação', () => {
    const dmgOf = (guard) => {
        const { world } = make();
        setMoves(world, [{ name: 'Flame Wheel', type: 'fire', power: 60 }]);
        const e = enemy(world, 16.9, 15.5, 19, 5); e.guard = guard;
        const evs = []; run(world, 15, evs);
        return hits(evs)[0].dmg;
    };
    const full = dmgOf(0), half = dmgOf(0.5);
    assert.ok(half < full && Math.abs(half - full / 2) <= full * 0.1 + 1, `${half} vs ${full}`);
    const castHit = (mul) => {
        const { world } = make({ think: undefined });
        const e = enemy(world, 17.0, 15.5); e.windupMul = mul; world.player.moves[0].cd = 99;
        for (let i = 0; i < 90; i++) { world.step(STEP); if (world.drainEvents().some(x => x.t === 'cast')) { return { e, w: world }; } }
        throw new Error('sem cast');
    };
    const a = castHit(1), b = castHit(3);
    assert.ok(Math.abs(b.e.castDur - 3 * a.e.castDur) < 1e-9);
    // massa: tanque (mass 10) quase não se mexe; o leve cede
    const { world } = make();
    const heavy = enemy(world, 10, 10), light = enemy(world, 10.3, 10);
    heavy.mass = 10;
    world._rebuildGrid(); world._separate();
    assert.ok(Math.abs(heavy.x - 10) < Math.abs(light.x - 10.3) / 5, 'o pesado cede bem menos');
});

test('F12 integração: o piloto roda com auto, mira em aimX/aimZ finitos e o diretor roda no passo', () => {
    let pilots = 0, upd = 0;
    const { world } = make({ director: { update() { upd++; }, state: { n: 3, kind: 'x', left: 1, total: 2, nextIn: 0 } } });
    world.pilot = (w) => { pilots++; w.player.want.mx = 0; w.player.want.mz = 0; w.player.want.cast = 1; w.player.want.aimX = 22; w.player.want.aimZ = 15.5; };
    setMoves(world, [{ name: 'Investida', type: 'normal', power: 40 }, { name: 'Ice Beam', type: 'ice', power: 90 }]);
    world.player.moves[0].cd = 99;
    run(world, 2);
    assert.equal(pilots, 0, 'sem auto o piloto não roda');
    world.auto = true;
    const evs = []; run(world, 3, evs);
    assert.ok(pilots >= 3 && upd >= 5);
    const c = evs.find(e => e.t === 'cast');
    assert.ok(c && c.move === 1 && c.tx === 22 && c.tz === 15.5, 'mirou o ponto do piloto sem inimigos');
    assert.equal(world.snapshot().wave.n, 3);
});
