'use strict';
// Fase 5A · B2: AutomationPolicy (padrões, validação estrita, saneamento, persistência)
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, plain } = require('./helpers/game');

test('política padrão: válida, completa e a automação começa desligada (sem campo no save)', () => {
    const { game, ctx } = newGame();
    const def = plain(ctx.defaultAutomationPolicy());
    assert.deepEqual(def, plain(game.getAutomationPolicy()));
    const v = ctx.validateAutomationPolicy(def);
    assert.equal(v.ok, true);
    assert.deepEqual(plain(v.policy), def);
    assert.equal(game.isAutomationConfigured(), false);
    assert.equal(game.gameState.automation, undefined, 'padrão não vai para o save');
    assert.equal(def.target.type, 'any');
    assert.equal(def.heal.onNoPotions, 'stop');
});

test('validação estrita: aceita uma política parcial e preenche o resto com padrões', () => {
    const { ctx } = newGame();
    const v = ctx.validateAutomationPolicy({ target: { type: 'species', speciesIds: [25, '133', 25] }, capture: { minQualityPercent: 60 }, route: { mode: 'switchWhenComplete' } });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.deepEqual(plain(v.policy.target), { type: 'species', speciesIds: [25, 133] }, 'sem duplicatas, ids normalizados');
    assert.equal(v.policy.capture.minQualityPercent, 60);
    assert.equal(v.policy.capture.alwaysShiny, true);
    assert.equal(v.policy.route.mode, 'switchWhenComplete');
    assert.equal(v.policy.heal.belowPercent, 40);
});

test('validação estrita: rejeita valores inválidos com caminho, código e mensagem em pt-BR', () => {
    const { ctx } = newGame();
    const cases = [
        [null, '', 'not_object'],
        [[], '', 'not_object'],
        [{ foo: 1 }, 'foo', 'unknown_field'],
        [{ version: 2 }, 'version', 'bad_version'],
        [{ target: { type: 'legendary' } }, 'target.type', 'bad_enum'],
        [{ target: { type: 'species', speciesIds: [] } }, 'target.speciesIds', 'empty_target'],
        [{ target: { type: 'species', speciesIds: [99999] } }, 'target.speciesIds', 'unknown_species'],
        [{ target: { speciesIds: 'x' } }, 'target.speciesIds', 'not_array'],
        [{ capture: { enabled: 'yes' } }, 'capture.enabled', 'not_boolean'],
        [{ capture: { minQualityPercent: 101 } }, 'capture.minQualityPercent', 'out_of_range'],
        [{ capture: { minQualityPercent: -1 } }, 'capture.minQualityPercent', 'out_of_range'],
        [{ capture: { minQualityPercent: 'abc' } }, 'capture.minQualityPercent', 'out_of_range'],
        [{ heal: { belowPercent: 0 } }, 'heal.belowPercent', 'out_of_range'],
        [{ heal: { belowPercent: 100 } }, 'heal.belowPercent', 'out_of_range'],
        [{ heal: { onNoPotions: 'rest' } }, 'heal.onNoPotions', 'reserved'],
        [{ heal: { onNoPotions: 'explode' } }, 'heal.onNoPotions', 'bad_enum'],
        [{ route: { mode: 'teleport' } }, 'route.mode', 'bad_enum'],
        [{ route: 'stay' }, 'route', 'not_object'],
        [{ switchPolicy: { mode: 'random' } }, 'switchPolicy.mode', 'bad_enum'],
        [{ ballPolicy: { type: 'ultra' } }, 'ballPolicy.type', 'reserved'],
        [{ stopConditions: { maxBattles: -3 } }, 'stopConditions.maxBattles', 'out_of_range'],
        [{ stopConditions: { maxMinutes: 1.5 } }, 'stopConditions.maxMinutes', 'out_of_range'],
    ];
    for (const [raw, path, code] of cases) {
        const v = ctx.validateAutomationPolicy(raw);
        assert.equal(v.ok, false, JSON.stringify(raw));
        const e = v.errors.find(x => x.path === path && x.code === code);
        assert.ok(e, `${JSON.stringify(raw)} → ${JSON.stringify(v.errors)}`);
        assert.ok(/[a-zãçéíóú]/i.test(e.message) && !/[一-鿿]/.test(e.message));
        // mesmo inválida, a política devolvida é sempre utilizável
        assert.equal(ctx.validateAutomationPolicy(v.policy).ok, true);
    }
});

test('muitos alvos: limite de 50 espécies', () => {
    const { ctx } = newGame();
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    const v = ctx.validateAutomationPolicy({ target: { type: 'species', speciesIds: ids } });
    assert.equal(v.ok, false);
    assert.equal(v.policy.target.speciesIds.length, 50);
});

test('saneamento (carregar/importar): nunca lança, nunca devolve lixo, descarta o desconhecido', () => {
    const { ctx } = newGame();
    for (const bad of [undefined, null, 5, 'x', [], { __proto__: null, a: 1 }, { heal: { belowPercent: 'abc', onNoPotions: 'rest' }, evil: { x: 1 }, target: { type: 'species', speciesIds: [] } }]) {
        const p = ctx.sanitizeAutomationPolicy(bad);
        assert.equal(ctx.validateAutomationPolicy(p).ok, true, JSON.stringify(bad));
        assert.equal(p.heal.onNoPotions, 'stop');
        assert.equal(p.evil, undefined);
    }
    const p = ctx.sanitizeAutomationPolicy({ capture: { minQualityPercent: 999 }, heal: { belowPercent: 55 } });
    assert.equal(p.heal.belowPercent, 55, 'o campo válido é aproveitado');
    assert.equal(p.capture.minQualityPercent, 0, 'o inválido volta ao padrão');
});

test('policyTargetsSpecies: só vale para alvo por espécie', () => {
    const { ctx } = newGame();
    const any = ctx.defaultAutomationPolicy();
    const sp = ctx.validateAutomationPolicy({ target: { type: 'species', speciesIds: [25] } }).policy;
    assert.equal(ctx.policyTargetsSpecies(any, 25), false);
    assert.equal(ctx.policyTargetsSpecies(sp, 25), true);
    assert.equal(ctx.policyTargetsSpecies(sp, 26), false);
    assert.equal(ctx.policyTargetsSpecies(null, 25), false);
});

test('setAutomationPolicy: política inválida não altera o estado; válida é salva e emite policy_changed', () => {
    const { game } = newGame();
    const seen = [];
    game.bus.on('policy_changed', (e) => seen.push(e));
    const bad = game.setAutomationPolicy({ heal: { belowPercent: 500 } });
    assert.equal(bad.ok, false);
    assert.equal(game.gameState.automation, undefined);
    assert.equal(seen.length, 0);
    const ok = game.setAutomationPolicy({ heal: { belowPercent: 55 } });
    assert.equal(ok.ok, true);
    assert.equal(game.getAutomationPolicy().heal.belowPercent, 55);
    assert.equal(game.isAutomationConfigured(), true);
    assert.equal(seen.length, 1);
});

test('persistência: a política sobrevive a salvar/carregar sem mudar SAVE_SCHEMA_VERSION', () => {
    const a = newGame({ seed: 3 });
    a.game.setAutomationPolicy({ target: { type: 'species', speciesIds: [133] }, capture: { minQualityPercent: 75, alwaysShiny: false }, route: { mode: 'stop' } });
    a.game.saveNow();
    assert.equal(a.ctx.SAVE_SCHEMA_VERSION, 3);
    const b = newGame({ storage: a.storage, load: true });
    assert.deepEqual(plain(b.game.getAutomationPolicy()), plain(a.game.getAutomationPolicy()));
    assert.equal(b.game.getAutomationPolicy().capture.alwaysShiny, false);
});

test('save adulterado: política corrompida é saneada, save sem automação continua sem o campo', () => {
    const a = newGame({ seed: 3 });
    a.game.saveNow();
    const raw = JSON.parse(JSON.stringify(a.game.gameState));
    assert.equal(raw.automation, undefined);
    raw.automation = { policy: { heal: { belowPercent: 'DROP TABLE' }, target: { type: 'species', speciesIds: [25, 'x', 77777] }, junk: {} }, session: 'oops' };
    const res = a.ctx.sanitizeSave(raw);
    const s = (res.state || res.save || res);
    const auto = s.automation;
    assert.ok(auto, 'campo preservado após saneamento');
    assert.equal(a.ctx.validateAutomationPolicy(auto.policy).ok, true);
    assert.deepEqual(plain(auto.policy.target.speciesIds), [25]);
    assert.equal(auto.session, undefined);
    const raw2 = JSON.parse(JSON.stringify(a.game.gameState));
    raw2.automation = 'lixo';
    const s2 = a.ctx.sanitizeSave(raw2);
    assert.equal((s2.state || s2.save || s2).automation, undefined);
});
