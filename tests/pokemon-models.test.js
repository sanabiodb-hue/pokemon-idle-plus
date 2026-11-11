'use strict';
// F12 · Modelos 3D procedurais (js/models/pokemon-models.js): receitas válidas, espécies obrigatórias, contagem de triângulos igual à geometria,
// geometria fundida com cor por vértice dentro do orçamento, modelo articulado com os grupos do rig, animação sem NaN, pose de instância pura, shiny.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { newGame } = require('./helpers/game');

const REQUIRED = [25, 10, 13, 11, 14, 16, 19, 46, 12, 15, 123, 26, 1, 4, 7];
const COMMON = [10, 13, 11, 14, 16, 19, 46];            // espécies de enxame (InstancedMesh em massa)
const SHAPES = ['sphere', 'ellipsoid', 'box', 'cone', 'cyl', 'capsule', 'wedge', 'ear'];
const RIG_GROUPS = { biped: ['body', 'head', 'legL', 'legR', 'armL', 'armR'], quad: ['body', 'head', 'legFL', 'legFR', 'legBL', 'legBR'],
    larva: ['head', 'seg1', 'seg2', 'seg3'], cocoon: ['body'], bird: ['body', 'head', 'wingL', 'wingR', 'legL', 'legR'], insect: ['body', 'head', 'wingL', 'wingR'] };
const STATES = ['idle', 'move', 'windup', 'attack', 'hurt', 'dying'];

let T = null;
async function three() { if (!T) T = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'vendor', 'three.module.min.js')).href); return T; }
function ctxGet() { const { ctx } = newGame(); const g = (n) => ctx.get(n); return { ctx, g }; }

test('F12 modelos: toda receita é válida (formas, cores, tamanhos, altura, raio, espécie existente)', () => {
    const { ctx, g } = ctxGet();
    const R = g('POKEMON_MODEL_RECIPES'), RIGS = g('POKEMON_MODEL_RIGS');
    const ids = Object.keys(R).map(Number);
    assert.ok(ids.length >= 15);
    for (const id of ids) {
        const rc = R[id], tag = `#${id}`;
        assert.ok(ctx.POKEMON_DATA[id], `${tag} existe em POKEMON_DATA`);
        assert.ok(RIGS.includes(rc.rig), `${tag} rig ${rc.rig}`);
        assert.ok(rc.height >= 0.5 && rc.height <= 2.2, `${tag} altura ${rc.height}`);
        assert.ok(rc.radius >= 0.3 && rc.radius <= 0.9 && rc.radius <= rc.height, `${tag} raio ${rc.radius}`);
        assert.ok(rc.parts.length >= 5);
        const seen = new Set();
        for (const p of rc.parts) {
            assert.ok(!seen.has(p.id), `${tag} id de parte repetido ${p.id}`); seen.add(p.id);
            assert.ok(SHAPES.includes(p.shape), `${tag} ${p.id} forma ${p.shape}`);
            assert.match(p.color, /^#[0-9A-Fa-f]{6}$/, `${tag} ${p.id} cor`);
            assert.equal(typeof p.group, 'string'); assert.ok(p.group.length > 0 && !p.group.includes('*'));
            assert.equal(p.size.length, 3); assert.ok(p.size.every(v => Number.isFinite(v) && v > 0), `${tag} ${p.id} tamanho`);
            assert.equal(p.pos.length, 3); assert.ok(p.pos.every(Number.isFinite)); assert.equal(p.rot.length, 3); assert.ok(p.rot.every(Number.isFinite));
        }
        if (rc.shiny) for (const [a, b] of Object.entries(rc.shiny)) { assert.match(a, /^#[0-9A-Fa-f]{6}$/); assert.match(b, /^#[0-9A-Fa-f]{6}$/); assert.ok(rc.parts.some(p => p.color === a), `${tag} cor shiny ${a} usada`); }
    }
    assert.equal(g('pokemonModelHeight')(0.4), 0.89);
    assert.ok(g('pokemonModelHeight')(14.5) <= 2.2);
});

test('F12 modelos: as espécies obrigatórias têm receita, na lista e na ordem de prioridade', () => {
    const { g } = ctxGet();
    const has = g('pokemonModelHas'), ids = Array.from(g('POKEMON_MODEL_IDS'));
    for (const id of REQUIRED) assert.ok(has(id), `#${id}`);
    assert.deepEqual(ids.slice(0, REQUIRED.length), REQUIRED);
    const info = g('pokemonModelInfo')(25);
    assert.equal(info.rig, 'biped'); assert.ok(Math.abs(info.height - 0.9) < 0.02, 'Pikachu ≈ 0,9 u');
    assert.ok(info.parts.some(p => /earTip/.test(p.id)) && info.parts.some(p => /cheek/.test(p.id)) && info.parts.some(p => /tail/.test(p.id)), 'identidade do Pikachu');
    assert.ok(g('pokemonModelInfo')(123).height > g('pokemonModelInfo')(15).height, 'chefe maior que elite');
});

test('F12 modelos: espécie sem receita devolve falso/null sem lançar', async () => {
    const T = await three(); const { g } = ctxGet();
    for (const id of [0, 9999, 150, 'x', null, undefined, -1]) {
        assert.equal(g('pokemonModelHas')(id), false);
        assert.equal(g('pokemonModelInfo')(id), null);
        assert.equal(g('buildPokemonModel')(T, id, {}), null);
        assert.equal(g('buildPokemonGeometry')(T, id), null);
    }
});

test('F12 modelos: triângulos da informação pura batem com a geometria fundida e a articulada; orçamento', async () => {
    const T = await three(); const { g } = ctxGet();
    for (const id of g('POKEMON_MODEL_IDS')) {
        const info = g('pokemonModelInfo')(id), geo = g('buildPokemonGeometry')(T, id);
        assert.equal(geo.index.count / 3, info.triangles, `#${id} fundida`);
        const model = g('buildPokemonModel')(T, id);
        let tris = 0, meshes = 0; model.traverse(o => { if (o.isMesh) { tris += o.geometry.index.count / 3; meshes++; } });
        assert.equal(tris, info.triangles, `#${id} articulada`); assert.equal(meshes, info.parts.length);
        assert.ok(info.triangles <= (COMMON.includes(id) ? 450 : 700), `#${id} orçamento: ${info.triangles}`);
    }
});

test('F12 modelos: geometria fundida tem cor por vértice, normais válidas, base em y = 0, altura = height, olha +Z; cache por espécie', async () => {
    const T = await three(); const { g } = ctxGet();
    for (const id of g('POKEMON_MODEL_IDS')) {
        const info = g('pokemonModelInfo')(id), geo = g('buildPokemonGeometry')(T, id);
        assert.ok(geo.getAttribute('color') && geo.getAttribute('color').itemSize === 3, `#${id} cor`);
        assert.equal(geo.getAttribute('color').count, geo.getAttribute('position').count);
        const bb = geo.boundingBox;
        assert.ok(Math.abs(bb.min.y) < 1e-4, `#${id} base ${bb.min.y}`);
        assert.ok(Math.abs(bb.max.y - info.height) < 1e-3, `#${id} altura ${bb.max.y} vs ${info.height}`);
        assert.ok(Math.abs(bb.min.x + bb.max.x) < 0.02 * info.height, `#${id} simétrico em x`);
        const n = geo.getAttribute('normal'), pos = geo.getAttribute('position'), idx = geo.index;
        for (let i = 0; i < n.count; i++) { const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i)); assert.ok(Math.abs(l - 1) < 1e-3, `#${id} normal`); }
        for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]));
        // enrolamento: a normal geométrica de cada triângulo aponta para o mesmo lado das normais dos vértices (faces para fora)
        let bad = 0;
        for (let t = 0; t < idx.count; t += 3) {
            const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
            const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
            const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a);
            const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
            const d = fx * (n.getX(a) + n.getX(b) + n.getX(c)) + fy * (n.getY(a) + n.getY(b) + n.getY(c)) + fz * (n.getZ(a) + n.getZ(b) + n.getZ(c));
            if (d < 0) bad++;
        }
        assert.equal(bad, 0, `#${id} triângulos virados`);
        assert.equal(g('buildPokemonGeometry')(T, id), geo, `#${id} cache`);
    }
    // o rosto do Pikachu fica para +Z (olhos na frente)
    const eye = g('pokemonModelInfo')(25).parts.find(p => p.id === 'eyeL');
    assert.ok(eye.pos[2] > 0.1);
    const m = g('pokemonModelMaterial')(T); assert.equal(m.type, 'MeshLambertMaterial'); assert.equal(m.vertexColors, true);
});

test('F12 modelos: articulado expõe os grupos do rig, pés no chão, geometrias e materiais compartilhados', async () => {
    const T = await three(); const { g } = ctxGet();
    for (const id of g('POKEMON_MODEL_IDS')) {
        const info = g('pokemonModelInfo')(id), m = g('buildPokemonModel')(T, id, {});
        const U = m.userData;
        assert.equal(U.rig, info.rig); assert.equal(U.height, info.height); assert.equal(U.radius, info.radius);
        for (const name of RIG_GROUPS[info.rig]) assert.ok(U.groups[name] && U.groups[name].isObject3D, `#${id} grupo ${name}`);
        m.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(m, true);
        assert.ok(Math.abs(box.min.y) < 0.01 && Math.abs(box.max.y - info.height) < 0.01, `#${id} caixa ${box.min.y} ${box.max.y}`);
        const m2 = g('buildPokemonModel')(T, id, {}), a = [], b = [];
        m.traverse(o => { if (o.isMesh) a.push(o); }); m2.traverse(o => { if (o.isMesh) b.push(o); });
        a.forEach((o, i) => { assert.equal(o.geometry, b[i].geometry); assert.equal(o.material, b[i].material); assert.equal(o.material.type, 'MeshLambertMaterial'); });
    }
    // uma geometria unitária por forma e detalhe (não uma por parte)
    const geos = new Set(); for (const id of g('POKEMON_MODEL_IDS')) g('buildPokemonModel')(T, id).traverse(o => { if (o.isMesh) geos.add(o.geometry); });
    assert.ok(geos.size < 40, `geometrias unitárias: ${geos.size}`);
});

test('F12 modelos: animatePokemonModel roda todos os estados sem NaN, mexe as partes e não deixa o modelo deslizar parado', async () => {
    const T = await three(); const { g } = ctxGet();
    const anim = g('animatePokemonModel');
    const snap = (m) => { const v = []; m.traverse(o => { v.push(o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z); }); return v; };
    for (const id of g('POKEMON_MODEL_IDS')) {
        const m = g('buildPokemonModel')(T, id), rest = snap(m);
        for (const st of STATES) {
            let moved = false;
            for (let k = 0; k < 40; k++) {
                anim(m, st, 1 + k / 30, 1 / 30, 1);
                const s = snap(m);
                assert.ok(s.every(Number.isFinite), `#${id} ${st} NaN`);
                if (s.some((v, i) => Math.abs(v - rest[i]) > 1e-3)) moved = true;
            }
            assert.ok(moved, `#${id} ${st} mexe`);
            assert.equal(m.position.x, 0); assert.equal(m.position.z, 0);           // o grupo externo é do chamador
        }
        // corrida: pernas alternam (bípede e quadrúpede) e o corpo sobe e desce
        if (m.userData.rig === 'biped' || m.userData.rig === 'quad') {
            const G = m.userData.groups, L = m.userData.rig === 'biped' ? G.legL : G.legFL, R = m.userData.rig === 'biped' ? G.legR : G.legFR;
            let opp = 0, ys = new Set();
            for (let k = 0; k < 30; k++) { anim(m, 'move', 5 + k / 30, 1 / 30, 1); if (L.rotation.x * R.rotation.x < -0.01) opp++; ys.add(Math.round(G.root.position.y * 1000)); }
            assert.ok(opp > 10, `#${id} pernas alternadas`); assert.ok(ys.size > 5, `#${id} quique`);
        }
        // desmaio: tomba e afunda
        for (let k = 0; k < 60; k++) anim(m, 'dying', 9 + k / 30, 1 / 30, 0);
        assert.ok(Math.abs(m.userData.groups.root.rotation.z) > 1.2 && m.userData.groups.root.position.y < 0, `#${id} desmaio`);
        // entradas ruins não quebram
        anim(m, 'idle', NaN, NaN, NaN); anim(m, 'qualquer', 1, -1, 5); assert.ok(snap(m).every(Number.isFinite));
    }
    anim(null, 'idle', 0, 0, 0); anim({}, 'idle', 0, 0, 0);
});

test('F12 modelos: pokemonInstancePose é pura, finita e muda entre repouso, corrida, golpe, dano e desmaio', () => {
    const { g } = ctxGet();
    const pose = g('pokemonInstancePose'), RIGS = g('POKEMON_MODEL_RIGS');
    const keys = ['y', 'sx', 'sy', 'sz', 'tilt', 'roll'];
    for (const rig of RIGS) {
        const out = {};
        const r1 = pose(rig, 'move', 0.37, 1.1, out); assert.equal(r1, out, 'escreve e devolve out');
        const a = Object.assign({}, out), b = Object.assign({}, pose(rig, 'move', 0.37, 1.1, {}));
        assert.deepEqual(a, b, `${rig} determinística`);
        const diffAt = (s1, s2) => { for (let t = 0; t < 1; t += 0.05) { const p1 = pose(rig, s1, t, 0.4, {}), p2 = pose(rig, s2, t, 0.4, {}); if (keys.some(k => Math.abs(p1[k] - p2[k]) > 1e-3)) return true; } return false; };
        assert.ok(diffAt('idle', 'move'), `${rig} repouso ≠ corrida`);
        assert.ok(diffAt('idle', 'attack') && diffAt('idle', 'hurt') && diffAt('idle', 'windup'), `${rig} golpe/dano`);
        for (const st of STATES.concat(['dead', 'balled', undefined])) for (let t = 0; t < 2; t += 0.1) {
            const p = pose(rig, st, t, 2.3, out); for (const k of keys.concat('fwd')) assert.ok(Number.isFinite(p[k]), `${rig} ${st} ${k}`);
            assert.ok(p.sx > 0 && p.sy > 0 && p.sz > 0);
        }
        const d = pose(rig, 'dying', 2, 0, {}); assert.ok(Math.abs(d.roll) > 1.2 && d.y < 0, `${rig} tomba e afunda`);
        const at = pose(rig, 'attack', 0.07, 0, {}); assert.ok(at.fwd > 0.2 && at.tilt > 0, `${rig} avança no ataque`);
    }
    assert.doesNotThrow(() => pose('desconhecido', 'idle', NaN, NaN, {}));
    assert.ok(pose('biped', 'idle', 0, 0).sy > 0, 'sem out cria um objeto');
});

test('F12 modelos: shiny troca cores (paleta da receita ou regra geral) e tem cache separado', async () => {
    const T = await three(); const { g } = ctxGet();
    const col = g('pokemonModelColor');
    assert.equal(col(25, '#F6D12E', false), '#F6D12E');
    assert.equal(col(25, '#F6D12E', true), '#F2B33A');
    assert.equal(col(25, '#2B2B2B', true), '#2B2B2B', 'preto não muda');
    const R = g('POKEMON_MODEL_RECIPES');
    const saved = R[25].shiny; R[25].shiny = null;
    try { assert.notEqual(col(25, '#F6D12E', true).toLowerCase(), '#f6d12e', 'regra geral gira o matiz'); assert.equal(col(25, '#1C1C1C', true), '#1C1C1C'); } finally { R[25].shiny = saved; }
    for (const id of g('POKEMON_MODEL_IDS')) {
        const a = g('buildPokemonGeometry')(T, id), b = g('buildPokemonGeometry')(T, id, { shiny: true });
        assert.notEqual(a, b);
        const ca = a.getAttribute('color').array, cb = b.getAttribute('color').array;
        assert.ok(ca.some((v, i) => Math.abs(v - cb[i]) > 0.02), `#${id} shiny muda cor`);
        const ma = new Set(), mb = new Set();
        g('buildPokemonModel')(T, id).traverse(o => { if (o.isMesh) ma.add(o.material.color.getHexString()); });
        g('buildPokemonModel')(T, id, { shiny: true }).traverse(o => { if (o.isMesh) mb.add(o.material.color.getHexString()); });
        assert.notDeepEqual([...ma].sort(), [...mb].sort(), `#${id} articulado shiny`);
    }
});

test('F12 modelos: disposePokemonModels descarta o cache e o próximo modelo recria tudo', async () => {
    const T = await three(); const { g } = ctxGet();
    const geo = g('buildPokemonGeometry')(T, 25); let disposed = 0; geo.addEventListener('dispose', () => disposed++);
    g('disposePokemonModels')(T);
    assert.equal(disposed, 1);
    assert.notEqual(g('buildPokemonGeometry')(T, 25), geo);
    g('disposePokemonModels')({});                  // Three desconhecido: não lança
});
