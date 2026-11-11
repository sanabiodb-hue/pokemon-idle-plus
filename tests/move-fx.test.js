'use strict';
// F11.1: golpes com poder real — todo golpe do jogo tem formato e área válidos; golpes conhecidos têm o formato certo; a geometria da
// área (círculo, linha, cone) confere; os 10 formatos rodam numa cena Three.js de verdade sem erro e sem deixar nada para trás.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { newGame } = require('./helpers/game');

const SHAPES = ['strike', 'slash', 'orb', 'beam', 'cone', 'bolt', 'nova', 'storm', 'fall', 'wave'];

test('F11.1 todo golpe do jogo (e os 18 tipos) tem perfil válido: formato, área, cores e tempos', () => {
    const { ctx } = newGame();
    let n = 0;
    for (const type of Object.keys(ctx.SKILL_DATA)) {
        assert.ok(ctx.MOVE_FX_COLORS[type], `cores de ${type}`); assert.ok(SHAPES.includes(ctx.MOVE_FX_TYPE_SHAPE[type]), `formato padrão de ${type}`);
        for (const m of ctx.SKILL_DATA[type]) {
            const p = ctx.moveFxProfile(m.name, type, m.power); n++;
            assert.ok(SHAPES.includes(p.shape), `${m.name}: ${p.shape}`);
            assert.equal(p.colors.length, 3); assert.ok(p.hitAt > 0 && p.hitAt < p.dur, m.name);
            const a = p.area; assert.ok(['circle', 'line', 'cone'].includes(a.kind) && ['self', 'target'].includes(a.at), m.name);
            if (a.kind === 'circle') assert.ok(a.r > 0); if (a.kind === 'line') assert.ok(a.len > 0 && a.width > 0); if (a.kind === 'cone') assert.ok(a.len > 0 && a.angle > 0 && a.angle <= 180);
            assert.equal(p.melee, p.shape === 'strike' || p.shape === 'slash');
            assert.ok(ctx.moveFxAreaText(p).length > 10);
        }
    }
    assert.ok(n >= 128, `golpes conferidos: ${n}`);
    assert.equal(Object.keys(ctx.MOVE_FX_COLORS).length, 18);
});

test('F11.1 golpes conhecidos têm o formato dos jogos principais (o Pikachu ataca com raios)', () => {
    const { ctx } = newGame();
    const shape = (n, t, p) => ctx.moveFxProfile(n, t, p);
    const want = { Thunderbolt: ['electric', 'bolt'], Thunder: ['electric', 'bolt'], Discharge: ['electric', 'nova'], Earthquake: ['ground', 'nova'], Surf: ['water', 'wave'], 'Hydro Pump': ['water', 'beam'],
        Overheat: ['fire', 'cone'], 'Rock Slide': ['rock', 'fall'], 'Leaf Storm': ['grass', 'storm'], 'Shadow Ball': ['ghost', 'orb'], 'Night Slash': ['dark', 'slash'], Strength: ['normal', 'strike'],
        'Hyper Beam': ['normal', 'beam'], 'Draco Meteor': ['dragon', 'fall'], 'Dragon Breath': ['dragon', 'cone'], Hurricane: ['flying', 'storm'], 'Ice Beam': ['ice', 'beam'], Investida: ['normal', 'strike'] };
    for (const [name, [type, sh]] of Object.entries(want)) assert.equal(shape(name, type, 90).shape, sh, name);
    const tb = shape('Thunderbolt', 'electric', 90), th = shape('Thunder', 'electric', 110);
    assert.equal(tb.area.at, 'target'); assert.ok(th.area.r > tb.area.r, 'Thunder cobre mais que Thunderbolt');
    assert.equal(shape('Earthquake', 'ground', 110).area.at, 'self', 'o terremoto parte de quem ataca');
    assert.equal(shape('Earth Power', 'ground', 100).area.at, 'target', 'Earth Power irrompe sob o alvo');
    assert.ok(shape('Surf', 'water', 90).area.width >= 3, 'a onda é larga');
    // todos os golpes elétricos de raio caem do céu sobre o alvo
    for (const m of ctx.SKILL_DATA.electric) if (/Thunder$|Thunderbolt|Bolt Strike/.test(m.name)) assert.equal(shape(m.name, 'electric', m.power).shape, 'bolt');
});

test('F11.1 golpe sem regra própria: palavras do nome, depois o tipo; tipo desconhecido não quebra', () => {
    const { ctx } = newGame();
    assert.equal(ctx.moveFxShapeKey('Solar Beam', 'grass'), 'beam');
    assert.equal(ctx.moveFxShapeKey('Mega Punch', 'normal'), 'strike');
    assert.equal(ctx.moveFxShapeKey('Golpe Sem Nome', 'electric'), 'bolt', 'padrão do tipo');
    assert.equal(ctx.moveFxShapeKey('Golpe Sem Nome', 'ground'), 'nova');
    const p = ctx.moveFxProfile(undefined, 'inventado', undefined);
    assert.equal(p.type, 'normal'); assert.equal(p.shape, 'strike'); assert.equal(p.tier, 0);
    assert.equal([40, 74, 75, 109, 110, 150].map(ctx.moveFxTier).join(), '0,0,1,1,2,2');
    assert.ok(ctx.moveFxProfile('Hydro Pump', 'water', 150).area.len > ctx.moveFxProfile('Hydro Pump', 'water', 60).area.len, 'mais poder, mais alcance');
});

test('F11.1 área real: círculo no alvo, círculo ao redor, linha e cone cobrem exatamente o que desenham', () => {
    const { ctx } = newGame();
    const from = { x: 0, z: 0 }, to = { x: 6, z: 0 }, cov = (p, x, z) => ctx.moveFxCovers(p, from, to, { x, z });
    const bolt = ctx.moveFxProfile('Thunderbolt', 'electric', 90);              // círculo de 1,3 no alvo
    assert.equal(cov(bolt, 6, 0), true); assert.equal(cov(bolt, 6 + bolt.area.r, 0), true); assert.equal(cov(bolt, 6 + bolt.area.r + 0.01, 0), false); assert.equal(cov(bolt, 0, 0), false, 'quem ataca não é atingido');
    const quake = ctx.moveFxProfile('Earthquake', 'ground', 110);              // círculo de 5,5 ao redor de quem ataca
    assert.equal(cov(quake, 0, 5.5), true); assert.equal(cov(quake, -3, -3), true, 'pega atrás também'); assert.equal(cov(quake, 0, 5.6), false);
    const beam = ctx.moveFxProfile('Hydro Pump', 'water', 150);                // linha 12 × 1,3
    assert.equal(cov(beam, 11.9, 0.6), true); assert.equal(cov(beam, 5, 0.7), false, 'fora da largura'); assert.equal(cov(beam, 12.1, 0), false, 'além do alcance'); assert.equal(cov(beam, -0.5, 0), false, 'não acerta atrás');
    const cone = ctx.moveFxProfile('Overheat', 'fire', 130);                   // cone de 60° com alcance 9
    assert.equal(cov(cone, 5, 0), true); assert.equal(cov(cone, 5, 5 * Math.tan(29 * Math.PI / 180)), true); assert.equal(cov(cone, 5, 5 * Math.tan(31 * Math.PI / 180)), false); assert.equal(cov(cone, 9.1, 0), false); assert.equal(cov(cone, -1, 0), false);
    const wave = ctx.moveFxProfile('Surf', 'water', 90);
    assert.equal(cov(wave, 4, 1.9), true, 'a onda larga pega quem está ao lado'); assert.equal(cov(beam, 4, 1.9), false);
    // a direção acompanha o alvo (golpe lançado para cima do mapa)
    assert.equal(ctx.moveFxCovers(beam, { x: 2, z: 2 }, { x: 2, z: -4 }, { x: 2.3, z: -7 }), true);
    assert.equal(ctx.moveFxCovers(beam, { x: 2, z: 2 }, { x: 2, z: -4 }, { x: 5, z: 2 }), false);
    assert.equal(ctx.moveFxCovers(null, from, to, from), false);
});

test('F11.1 golpe do selvagem na caça automática e bioma da arena', () => {
    const { game, ctx } = newGame();
    assert.equal(ctx.moveFxWildMove(['electric'], 5).name, ctx.SKILL_DATA.electric[0].name);
    assert.equal(ctx.moveFxWildMove(['electric'], 80).name, ctx.SKILL_DATA.electric[3].name, 'nível 75–99: quarta técnica (Thunderbolt)');
    assert.equal(ctx.moveFxWildMove(['fire', 'flying'], 9999).name, ctx.SKILL_DATA.fire[7].name, 'não passa da última');
    assert.equal(ctx.moveFxWildMove([], 10).type, 'normal'); assert.equal(ctx.moveFxWildMove(['tipo-falso'], 10).name, 'Investida');
    assert.equal(ctx.moveFxPowerOf('Thunder', 'electric'), 110); assert.equal(ctx.moveFxPowerOf('Nada', 'electric'), 60);
    assert.equal(ctx.battleStageBiome(game.getRoute('kanto_route1')), 'meadow');
    assert.equal(ctx.battleStageBiome(game.getRoute('kanto_viridian_forest')), 'forest');
    assert.equal(ctx.battleStageBiome(null), 'meadow');
    for (const r of ctx.REGIONS.kanto.routes) assert.ok(ctx.BATTLE_STAGE_BIOMES[ctx.battleStageBiome(r)], r.id);
    assert.equal(JSON.stringify(ctx.battleStageDamageLabel(123.4, true, 2)), JSON.stringify({ text: '-123!', cls: 'crit super' }));
    assert.equal(ctx.battleStageDamageLabel(7, false, 0.5).cls, 'weak'); assert.equal(ctx.battleStageDamageLabel(7, false, 1).cls, '');
});

test('F11.1 batalha do Explorar: o passo do golpe leva o nome dele (a cena desenha o formato certo)', () => {
    const { game, ctx } = newGame({ seed: 11 });
    for (const uid of game.gameState.party) game.gameState.ownedPokemon[uid].level = 30;
    game._instanceStats.clear();
    const b = new ctx.ExploreBattle(game, game.createWildPokemon(16, 12, 0), {});
    const i = b.me().moves.findIndex(m => m.type === 'electric'); assert.ok(i >= 0);
    const hit = b.act({ type: 'move', i }).find(s => s.t === 'hit' && s.side === 'me');
    assert.ok(hit, 'o golpe acertou'); assert.equal(hit.move, b.me().moves[i].name);
    assert.ok(['bolt', 'nova', 'strike', 'orb', 'beam'].includes(ctx.moveFxProfile(hit.move, hit.mtype, hit.power).shape));
});

test('F11.1 os 10 formatos rodam numa cena Three.js real: dano uma vez só, nada sobra na cena, limite de efeitos simultâneos', async () => {
    const T = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'vendor', 'three.module.min.js')).href);
    const { ctx } = newGame();
    ctx.sandbox.document.createElement = () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(v) {} }) });
    const samples = { strike: ['Strength', 'normal', 80], slash: ['Night Slash', 'dark', 120], orb: ['Shadow Ball', 'ghost', 80], beam: ['Hydro Pump', 'water', 150], cone: ['Overheat', 'fire', 130],
        bolt: ['Thunder', 'electric', 110], nova: ['Earthquake', 'ground', 110], storm: ['Leaf Storm', 'grass', 130], fall: ['Draco Meteor', 'dragon', 110], wave: ['Surf', 'water', 90] };
    for (const speed of [1, 1.45]) for (const [shape, [name, type, power]] of Object.entries(samples)) {
        const scene = new T.Scene(), shakes = [], fx = new ctx.MoveFxRenderer(T, scene, { speed, max: 3, onShake: (f) => shakes.push(f) });
        const prof = ctx.moveFxProfile(name, type, power); assert.equal(prof.shape, shape);
        let hits = 0, hitAt = -1, t = 0;
        assert.equal(fx.play(prof, new T.Vector3(-2, 0, 1.5), new T.Vector3(2.5, 0, -1.5), { onHit: () => { hits++; hitAt = t; } }), true);
        assert.ok(scene.children.length > 0, `${shape}: desenha algo`);
        for (let i = 0; i < 400 && fx.active; i++) { fx.update(1 / 60); t += 1 / 60; }
        assert.equal(fx.active, false, `${shape}: termina`); assert.equal(hits, 1, `${shape}: dano uma vez`);
        assert.ok(Math.abs(hitAt - prof.hitAt / speed) < 0.06, `${shape}: dano no tempo do perfil (${hitAt.toFixed(2)} vs ${(prof.hitAt / speed).toFixed(2)})`);
        assert.equal(scene.children.length, 0, `${shape}: a cena volta vazia (sobrou ${scene.children.length})`);
        assert.equal(fx.live, 0);
        for (const f of shakes) assert.ok(f > 0 && f < 1);
        fx.dispose();
    }
    // limite: o quarto golpe ao mesmo tempo não desenha, mas o dano dele acontece na hora
    const scene = new T.Scene(), fx = new ctx.MoveFxRenderer(T, scene, { max: 3 }), p = ctx.moveFxProfile('Thunderbolt', 'electric', 90), a = new T.Vector3(0, 0, 0), b = new T.Vector3(5, 0, 0);
    let late = 0;
    for (let i = 0; i < 3; i++) assert.equal(fx.play(p, a, b), true);
    assert.equal(fx.play(p, a, b, { onHit: () => late++ }), false); assert.equal(late, 1);
    fx.clear(); assert.equal(scene.children.length, 0, 'clear() limpa a cena'); assert.equal(fx.live, 0);
    // desligado pela flag: nada é desenhado e o dano acontece na hora
    vm.runInContext('MOVE_FX_ENABLED = false', ctx.sandbox); late = 0;
    assert.equal(fx.play(p, a, b, { onHit: () => late++ }), false); assert.equal(late, 1); assert.equal(scene.children.length, 0);
    vm.runInContext('MOVE_FX_ENABLED = true', ctx.sandbox);
});
