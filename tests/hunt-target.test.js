'use strict';
// F9.9: validação do ALVO de caça. Um ponto puro e compartilhado (huntTargetCheck): espécie inteira existente, na tabela natural da rota selecionada e nem lendária nem mítica.
// Valem o Centro de Caça, os sanitizadores dos saves, a fila e o motor do mundo (online e Fast Driver) como guarda final — o teste burla a interface e prova que o motor ignora.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline, mulberry32 } = require('./helpers/game');
const { makeFakeDom, makeUi } = require('./helpers/fake-dom');
const { loadWorld } = require('./helpers/world-env');

const plain = (o) => JSON.parse(JSON.stringify(o));
const FOREST = 'kanto_viridian_forest';          // Caterpie 10, Weedle 13, Paras 46, Metapod 11, Kakuna 14, Pikachu 25
const ROUTE1 = 'kanto_route1';                    // Rattata 19, Pidgey 16
const MSG = {
    restricted: 'Lendários e míticos só aparecem pelo sorteio natural das rotas.',
    notInRoute: 'Essa espécie não aparece nesta rota.', invalid: 'Espécie inválida.', noRoute: 'Escolha uma rota antes de definir o alvo.',
};
const rulesOn = (opts = {}) => newGame({ targetRules: true, ...opts });

function boot(opts = {}) {
    const g = rulesOn({ seed: opts.seed ?? 9, storage: opts.storage, load: opts.load });
    g.game.clock = new g.ctx.ManualClock(10_000_000);
    if (opts.route) g.game.gameState.currentRoute = opts.route;
    const world = loadWorld({ targetRules: true });
    const dom = makeFakeDom(g.ctx), ui = makeUi(g.game);
    ui.worldEncounters = new world.WorldEncounters(g.game);
    ui.worldView = { openHuntMap: () => ({ ok: true }) };
    const view = new g.ctx.HuntView(ui);
    view.render();
    return { ...g, world, dom, ui, view, enc: ui.worldEncounters };
}

// =============================================================== A. função pura
test('F9.9 A: huntTargetCheck — tabela de casos (id desconhecido, não inteiro, fora do intervalo, lendário, mítico, fora da rota, sem rota, válido)', () => {
    const { ctx } = rulesOn();
    const chk = (id, route) => plain(ctx.huntTargetCheck(id, route));
    const cases = [
        [0, FOREST, 'invalid_species', MSG.invalid], [-5, FOREST, 'invalid_species', MSG.invalid], [1.5, FOREST, 'invalid_species', MSG.invalid], ['25', FOREST, 'invalid_species', MSG.invalid],
        [null, FOREST, 'invalid_species', MSG.invalid], [undefined, FOREST, 'invalid_species', MSG.invalid], [NaN, FOREST, 'invalid_species', MSG.invalid], [99999, FOREST, 'invalid_species', MSG.invalid],
        [1e9, FOREST, 'invalid_species', MSG.invalid], [{}, FOREST, 'invalid_species', MSG.invalid],
        [150, FOREST, 'restricted_species', MSG.restricted], [151, FOREST, 'restricted_species', MSG.restricted], [150, 'kanto_cerulean_cave', 'restricted_species', MSG.restricted],   // lendário mesmo na rota onde ele nasce
        [151, 'kanto_cerulean_cave', 'restricted_species', MSG.restricted], [1008, FOREST, 'restricted_species', MSG.restricted],
        [25, ROUTE1, 'not_in_route', MSG.notInRoute], [16, FOREST, 'not_in_route', MSG.notInRoute], [149, FOREST, 'not_in_route', MSG.notInRoute],
        [25, null, 'no_route', MSG.noRoute], [25, 'rota_que_nao_existe', 'no_route', MSG.noRoute], [25, 123, 'no_route', MSG.noRoute], [25, undefined, 'no_route', MSG.noRoute],
    ];
    for (const [id, route, code, message] of cases) assert.deepEqual(chk(id, route), { ok: false, code, message }, `${String(id)} @ ${String(route)}`);
    for (const [id, route] of [[25, FOREST], [10, FOREST], [46, FOREST], [19, ROUTE1], [16, ROUTE1]]) assert.deepEqual(chk(id, route), { ok: true }, `${id} @ ${route}`);
});

test('F9.9 A: as listas de lendários e míticos — ids existentes, sem repetição, sem sobreposição, e todas podem aparecer pelo sorteio natural de alguma rota', () => {
    const { ctx } = rulesOn();
    const leg = ctx.LEGENDARY_SPECIES_IDS, myth = ctx.MYTHICAL_SPECIES_IDS;
    for (const list of [leg, myth]) { assert.equal(new Set(list).size, list.length, 'sem repetição'); for (const id of list) assert.ok(ctx.POKEMON_DATA[id], `#${id} existe`); }
    assert.equal(leg.filter(i => myth.includes(i)).length, 0, 'sem sobreposição');
    for (const id of [150, 249, 384, 483, 646, 718, 800, 890, 1007]) assert.ok(leg.includes(id), `lendário #${id}`);
    for (const id of [151, 251, 386, 493, 649, 721, 802, 809, 893]) assert.ok(myth.includes(id), `mítico #${id}`);
    assert.ok(leg.length >= 70 && myth.length >= 22);
    const naturais = new Set(); for (const k in ctx.REGIONS) for (const r of ctx.REGIONS[k].routes) for (const p of r.pokemon) naturais.add(p.id);
    // a regra não pode tornar nenhum lendário impossível: o sorteio natural continua sendo o caminho (as espécies que a tabela de rotas traz)
    const naoNatural = [...leg, ...myth].filter(i => !naturais.has(i));
    assert.ok(naoNatural.length <= 12, `lendários/míticos fora das tabelas de rota (formas Mega etc.): ${naoNatural.join(',')}`);
    assert.ok([...leg, ...myth].filter(i => naturais.has(i)).length >= 90, 'as 92 espécies canônicas continuam aparecendo naturalmente');
    for (const id of leg.concat(myth)) assert.equal(ctx.isRestrictedSpecies(id), true);
    assert.equal(ctx.isRestrictedSpecies(25), false);
});

// =============================================================== B. sanitizadores
test('F9.9 B: política salva — alvo lendário/mítico/desconhecido vindo de save antigo ou editado é removido; a validação estrita acusa', () => {
    const { ctx } = rulesOn();
    const pol = (ids) => ({ target: { type: 'species', speciesIds: ids } });
    const s = plain(ctx.sanitizeAutomationPolicy(pol([25, 150, 151, 99999, 10, 'x', 1008])));
    assert.deepEqual(s.target.speciesIds, [25, 10]); assert.equal(s.target.type, 'species');
    assert.equal(plain(ctx.sanitizeAutomationPolicy(pol([150, 151]))).target.type, 'any', 'sem nenhum alvo válido volta a "qualquer"');
    const v = plain(ctx.validateAutomationPolicy(pol([25, 150])));
    assert.equal(v.ok, false); assert.ok(v.errors.some(e => e.code === 'restricted_species'));
    assert.equal(plain(ctx.validateAutomationPolicy(pol([25, 10]))).ok, true);
});

test('F9.9 B: sessão e fila salvas — o alvo lendário/mítico é descartado ao carregar (a parte do alvo que não depende da rota)', () => {
    const { ctx } = rulesOn();
    const base = { id: 's1', state: 'paused', startedAt: 1, elapsedMs: 0, routeId: FOREST, stats: {}, world: { speciesId: 150, seq: 3, last: 1 } };
    const san = (w) => ctx.sanitizeHuntSession(Object.assign({}, base, { world: w }));
    assert.equal(san({ speciesId: 150, seq: 3, last: 1 }) && san({ speciesId: 150, seq: 3, last: 1 }).world, undefined, 'lendário: descartado');
    assert.equal(san({ speciesId: 151, seq: 0, last: null }).world, undefined, 'mítico: descartado');
    assert.equal(plain(san({ speciesId: 25, seq: 3, last: 1 }).world).speciesId, 25, 'espécie comum: preservada');
    const q = (items) => ctx.sanitizeHuntQueue({ items, index: 0, state: 'idle', sessionId: null, haltReason: null }, undefined);
    const out = q([{ speciesId: 25, condition: { type: 'time', value: 5 } }, { speciesId: 150, condition: { type: 'time', value: 5 } }, { speciesId: 10, condition: { type: 'battles', value: 7 } }, { speciesId: 151, condition: { type: 'time', value: 1 } }]);
    assert.deepEqual(plain(out.items.map(i => i.speciesId)), [25, 10]);
});

// =============================================================== C. guarda do motor (burlando a interface)
test('F9.9 C: enc.begin recusa alvo inválido, sem ciclo, sem sessão e sem efeitos; aceita o válido', () => {
    const t = boot({ route: ROUTE1 });
    for (const [id, code, message] of [[150, 'restricted_species', MSG.restricted], [151, 'restricted_species', MSG.restricted], [25, 'not_in_route', MSG.notInRoute], [99999, 'invalid_species', MSG.invalid], [1.5, 'invalid_species', MSG.invalid]]) {
        const r = t.enc.begin(id);
        assert.equal(r.ok, false, `#${id}`); assert.equal(r.code, code); assert.equal(r.message, message);
        assert.equal(t.enc.cycle, null, 'nenhum ciclo'); assert.equal(t.game.getHuntSession(), null, 'nenhuma sessão iniciada'); assert.equal(t.game.isHuntRunning(), false);
    }
    assert.equal(t.enc.begin(19).ok, true, 'Rattata na rota 1 é válido'); assert.equal(t.enc.cycle.speciesId, 19);
    const t2 = boot({ route: FOREST });
    assert.equal(t2.enc.begin(25).ok, true, 'Pikachu na Floresta de Viridian é válido');
});

test('F9.9 C: burlando a interface — um ciclo forçado com alvo inválido NÃO gera o alvo: o motor cai no sorteio natural da rota (online, sem cache, e Fast Driver, com cache)', () => {
    for (const forced of [150, 151, 25]) {                                      // lendário, mítico, espécie fora da rota
        for (const mode of ['online', 'fast']) {
            const t = boot({ route: ROUTE1, seed: 5 });
            t.enc.cycle = { speciesId: forced, mapId: `hunt_${forced}`, sessionId: null, seq: 0, last: null, leg: null, pendingLeg: false, walkedBefore: 0, delayMs: 0 };   // contorna begin()
            const seen = new Set();
            const cache = mode === 'fast' ? t.game._buildFastSimState(3600000, 3600000).spawnCache : null;
            for (let i = 0; i < 120; i++) { const e = mode === 'fast' ? t.enc.fastEnemy(cache) : t.enc._makeEnemy(null); assert.ok(e, 'sai um inimigo da rota'); seen.add(e.id); }
            assert.ok([...seen].every(id => id === 19 || id === 16), `${mode}/#${forced}: só espécies da rota 1 (${[...seen]})`);
            assert.ok(!seen.has(forced), `${mode}: o alvo inválido #${forced} nunca é gerado`);
        }
    }
    // controle: o alvo VÁLIDO continua sendo gerado, sempre
    const t = boot({ route: FOREST, seed: 5 }); t.enc.cycle = { speciesId: 25, mapId: 'hunt_25', sessionId: null, seq: 0, last: null, leg: null, pendingLeg: false, walkedBefore: 0, delayMs: 0 };
    for (let i = 0; i < 60; i++) assert.equal(t.enc._makeEnemy(null).id, 25);
});

test('F9.9 C: a rota muda depois de começar a caçada — o alvo deixa de valer e o motor segue com o sorteio natural da nova rota', () => {
    const t = boot({ route: FOREST, seed: 5 });
    assert.equal(t.enc.begin(25).ok, true);
    assert.equal(t.enc._makeEnemy(null).id, 25);
    t.game.gameState.currentRoute = ROUTE1;
    const ids = new Set(); for (let i = 0; i < 80; i++) ids.add(t.enc._makeEnemy(null).id);
    assert.ok([...ids].every(i => i === 19 || i === 16), `rota 1: ${[...ids]}`);
});

test('F9.9 C: save com sessão do mundo de alvo inválido (editado ou rota diferente) — o ciclo não é restaurado e nada começa', () => {
    for (const [speciesId, route] of [[150, FOREST], [151, FOREST], [25, ROUTE1]]) {
        const t = boot({ route });
        t.game.dispatchAutomationAction({ type: 'START_HUNT' });
        const s = t.game.getHuntSession(); s.world = { speciesId, seq: 2, last: 1 };     // como um save editado
        t.game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
        const e2 = new t.world.WorldEncounters(t.game);                                  // um controlador novo (recarga) tenta restaurar
        assert.equal(e2.cycle, null, `#${speciesId} @ ${route}: sem ciclo`);
    }
    const t = boot({ route: FOREST });
    t.game.dispatchAutomationAction({ type: 'START_HUNT' });
    t.game.getHuntSession().world = { speciesId: 25, seq: 2, last: 1 }; t.game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    assert.equal(new t.world.WorldEncounters(t.game).cycle.speciesId, 25, 'alvo válido: restaurado');
});

test('F9.9 C: fila — adicionar valida na rota atual; item inválido forçado para dentro da fila é recusado pelo motor ao iniciar (a fila para, nada começa)', () => {
    const t = boot({ route: FOREST });
    t.ui.huntQueue = null;
    const q = new t.ctx.HuntQueue(t.game, t.enc);
    for (const [id, code] of [[150, 'restricted_species'], [16, 'not_in_route'], [99999, 'invalid_species']]) { const r = q.add(id, 5); assert.equal(r.ok, false); assert.equal(r.code, code, `#${id}`); }
    assert.equal(q.view().total, 0);
    assert.equal(q.add(25, 5).ok, true); assert.equal(q.view().total, 1);
    // burlando: um item inválido entra direto na estrutura salva
    const t2 = boot({ route: FOREST });
    const q2 = new t2.ctx.HuntQueue(t2.game, t2.enc);
    q2._w().items.push({ speciesId: 150, condition: { type: 'time', value: 5 } });
    const r = q2._startTarget(0);
    assert.equal(r.ok, false); assert.equal(r.code, 'restricted_species');
    assert.equal(t2.enc.cycle, null, 'o alvo inválido nunca virou ciclo'); assert.equal(t2.game.getHuntSession(), null, 'nenhuma sessão começou');
    assert.equal(q2.view().state, 'halted', 'a fila para na posição');
});

// =============================================================== D. interface (Centro de Caça)
test('F9.9 D: Centro de Caça — escolher lendário/mítico/fora da rota mostra o motivo curto e neutro, desabilita iniciar, fila e mapa, e iniciar à força é recusado pelo motor', () => {
    const t = boot({ route: ROUTE1 });
    t.view.onShow();
    const cases = [[150, MSG.restricted], [151, MSG.restricted], [25, MSG.notInRoute]];
    for (const [id, message] of cases) {
        t.ui.toasts.length = 0;
        t.view.handleAction('target-pick', { id: String(id) });
        assert.ok(t.ui.toasts.some(x => x.includes(message)), `toast #${id}: ${t.ui.toasts}`);
        const html = t.dom.html('hunt-target-live');
        assert.match(html, /data-hunt-action="target-start" disabled/); assert.match(html, /data-hunt-action="target-open-map" disabled/);
        assert.ok(t.dom.text('hunt-target-live').includes(message), 'o motivo aparece na tela');
        assert.match(t.dom.html('hunt-queue'), /data-hunt-action="queue-add" disabled/);
        // burlar a interface: chamar a ação direto
        t.view.handleAction('target-start', {});
        assert.equal(t.enc.cycle, null, 'o motor recusou'); assert.equal(t.game.getHuntSession(), null);
        assert.ok(t.ui.toasts.some(x => x.includes(message)), 'o motor também devolve o motivo');
        const m = t.ctx.huntControlMatrix(t.ctx.huntCenterSnapshot(t.game, t.enc), id);
        assert.equal(m.startTarget.enabled, false); assert.equal(m.startTarget.reason, message); assert.equal(m.queueAdd.reason, message); assert.equal(m.openMap.reason, message);
    }
    t.view.handleAction('target-pick', { id: '19' });
    assert.doesNotMatch(t.dom.html('hunt-target-live'), /data-hunt-action="target-start" disabled/, 'Rattata é válido na rota 1');
    t.view.handleAction('target-start', {});
    assert.equal(t.enc.cycle.speciesId, 19);
});

test('F9.9 D: trocar a rota muda a validade na hora — Pikachu recusado na rota 1 e aceito na Floresta de Viridian', () => {
    const t = boot({ route: ROUTE1 });
    t.view.onShow(); t.view.handleAction('target-pick', { id: '25' });
    assert.match(t.dom.html('hunt-target-live'), /data-hunt-action="target-start" disabled/);
    t.game.gameState.currentRoute = FOREST; t.view.render();
    assert.doesNotMatch(t.dom.html('hunt-target-live'), /data-hunt-action="target-start" disabled/);
});

// =============================================================== E. paridade online × Fast Driver com alvo válido
test('F9.9 E: alvo válido — o inimigo gerado online (sem cache) e no Fast Driver (com cache) é o mesmo e consome o mesmo RNG (3 sementes × 80 batalhas)', () => {
    for (const seed of [1, 2, 3]) {
        const gen = (mode) => {
            const t = boot({ route: FOREST, seed }); t.game.rng = mulberry32(seed * 101);
            t.enc.cycle = { speciesId: 25, mapId: 'hunt_25', sessionId: null, seq: 0, last: null, leg: null, pendingLeg: false, walkedBefore: 0, delayMs: 0 };
            const cache = mode === 'fast' ? t.game._buildFastSimState(3600000, 3600000).spawnCache : null;
            const out = []; let calls = 0; const r0 = t.game.rng; t.game.rng = () => { calls++; return r0(); };
            for (let i = 0; i < 80; i++) { const e = mode === 'fast' ? t.enc.fastEnemy(cache) : t.enc._makeEnemy(null); out.push([e.id, e.level, e.isShiny, e.ivs]); }
            return JSON.stringify({ out, calls });
        };
        const a = gen('online'), b = gen('fast');
        assert.equal(a, b, `semente ${seed}`);
        assert.ok(JSON.parse(a).out.every(e => e[0] === 25));
    }
});

test('F9.9 E: caçada com alvo válido no Fast Driver — 80+ batalhas, só a espécie-alvo, e o motor do mundo segue o mesmo ciclo', async () => {
    const t = boot({ route: FOREST, seed: 4 });
    const lead = t.game._partyInstance(0); lead.level = 300; t.game._touchInstance(lead); t.game.gameState.inventory.potions = 99999;     // líder forte: o ciclo roda sem derrotas nem parar sem poções
    assert.equal(t.enc.begin(25).ok, true);
    t.game.clock.advance(1000);
    const ev = []; t.game.bus.on('battle_completed', (e) => { if (e.offline) ev.push(e); });
    await runOffline(t.game, 2 * 3600 * 1000);
    assert.ok(ev.length >= 80, `batalhas offline: ${ev.length}`);
    assert.ok(ev.every(e => e.enemyId === 25), 'só a espécie-alvo');
});
