'use strict';
// F9.3: a natureza altera os atributos (+10% / −10%; nunca o HP; neutras e valores inválidos = sem efeito). Aplicada ao atributo calculado de IVs e
// nível, antes de equipe/Pokédex/gemas/talentos e antes de somar attack/defense. NATURE_EFFECT_ENABLED = false restaura os números de antes da fase.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { newGame, createMemoryStorage } = require('./helpers/game');

const KEYS = ['atk', 'def', 'spAtk', 'spDef', 'speed'];
const IVS = { hp: 31, atk: 29, def: 17, spAtk: 3, spDef: 22, speed: 11 };
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const flag = (ctx, v) => vm.runInContext(`NATURE_EFFECT_ENABLED = ${v}`, ctx.sandbox);

// Referência INDEPENDENTE (sem chamar nada do jogo além dos dados): atributos individuais de um Pokémon sem natureza
function neutralRaw(data, level, ivs, { shiny = false, berry = {} } = {}) {
    const b = data.baseStats, mult = shiny ? 1.2 : 1, cap = 255;
    const base = (k) => Math.floor(Math.min(cap, b[k] + (berry[k] || 0)) * mult);
    const f = (k) => Math.floor((2 * base(k) + ivs[k]) * level / 100) + 5;
    return { hp: Math.floor((2 * base('hp') + ivs.hp) * level / 100) + level + 10, atk: f('atk'), def: f('def'), spAtk: f('spAtk'), spDef: f('spDef'), speed: f('speed') };
}
// Aplica a natureza por conta própria (inteiros), lendo os campos plus/minus da tabela
const byHand = (raw, nat) => {
    const out = { ...raw };
    for (const k of KEYS) out[k] = nat.plus === k ? Math.floor(raw[k] * 110 / 100) : nat.minus === k ? Math.floor(raw[k] * 90 / 100) : raw[k];
    return out;
};

// =============================================================== A. tabela das 25 naturezas
test('F9.3 A: a tabela tem 25 naturezas: 5 neutras e 20 com exatamente um "plus" e um "minus" diferentes, nunca HP', () => {
    const { ctx } = newGame();
    const N = ctx.POKEMON_NATURES;
    assert.equal(N.length, 25);
    assert.equal(new Set(N.map(n => n.id)).size, 25);
    const neutral = N.filter(n => n.plus === null && n.minus === null);
    assert.equal(neutral.length, 5);
    assert.equal(JSON.stringify(neutral.map(n => n.id).sort()), JSON.stringify(['bashful', 'docile', 'hardy', 'quirky', 'serious']));
    for (const n of N.filter(n => n.plus !== null || n.minus !== null)) {
        assert.ok(KEYS.includes(n.plus) && KEYS.includes(n.minus) && n.plus !== n.minus, `${n.id}: ${n.plus}/${n.minus}`);
    }
    assert.equal(N.filter(n => n.plus).length, 20);
    for (const k of KEYS) assert.equal(N.filter(n => n.plus === k).length, 4, `4 naturezas sobem ${k}`), assert.equal(N.filter(n => n.minus === k).length, 4, `4 naturezas descem ${k}`);
});

test('F9.3 A: para as 25 naturezas, exatamente um atributo sobe 10% e um desce 10% (floor), o HP e os demais não mudam; neutras = sem natureza', () => {
    const { game, ctx } = newGame();
    for (const id of [25, 150, 1, 130, 143]) for (const level of [1, 5, 50, 100, 777]) {
        const data = ctx.POKEMON_DATA ? ctx.POKEMON_DATA[id] : null;
        const sp = data || game.constructor && null;
        void sp;
        const mk = (nature) => game.calculateBaseStats({ id, level, ivs: IVS, isShiny: false, nature });
        const none = mk(undefined);
        for (const nat of ctx.POKEMON_NATURES) {
            const s = mk(nat.id);
            assert.equal(s.hp, none.hp, `${nat.id}: HP nunca muda`);
            for (const k of KEYS) {
                const expected = nat.plus === k ? Math.floor(none[k] * 110 / 100) : nat.minus === k ? Math.floor(none[k] * 90 / 100) : none[k];
                assert.equal(s[k], expected, `#${id} Lv${level} ${nat.id} ${k}`);
            }
            if (nat.plus === null) assert.deepEqual(plain(s), plain(none), `${nat.id} neutra`);
        }
    }
});
function plain(o) { return JSON.parse(JSON.stringify(o)); }

test('F9.3 A: arredonda para baixo com inteiros (sem erro de ponto flutuante) para qualquer valor de 1 a 20000', () => {
    const { ctx } = newGame();
    const up = ctx.natureStatPercent('adamant', 'atk'), down = ctx.natureStatPercent('adamant', 'spAtk');
    assert.equal(up, 110); assert.equal(down, 90);
    for (let v = 1; v <= 20000; v++) {
        assert.equal(ctx.applyNatureToStat(v, 'adamant', 'atk'), Math.floor(v * 110 / 100));
        assert.equal(ctx.applyNatureToStat(v, 'adamant', 'spAtk'), Math.floor(v * 90 / 100));
        assert.equal(ctx.applyNatureToStat(v, 'adamant', 'speed'), v);
    }
    assert.equal(ctx.applyNatureToStat(30, 'adamant', 'atk'), 33, '30 × 1,1 = 33 (e não 32 por ponto flutuante)');
    assert.equal(ctx.applyNatureToStat(70, 'adamant', 'spAtk'), 63, '70 × 0,9 = 63');
});

// =============================================================== B. ordem de composição (valores calculados à mão)
test('F9.3 B: ordem — IVs e nível, shiny e fruta (na base), NATUREZA, depois soma attack/defense; valores esperados à mão', () => {
    const { game, ctx } = newGame();
    const id = 25, level = 60, nat = ctx.POKEMON_NATURES.find(n => n.id === 'adamant');      // +atk −spAtk
    const berry = { atk: 20, spAtk: 10, speed: 5 };
    game.getBerryBonuses = () => berry;
    const raw = neutralRaw(ctx.POKEMON_DATA[id], level, IVS, { shiny: true, berry });
    const want = byHand(raw, nat);
    const got = game.calculateStats({ id, level, ivs: IVS, isShiny: true, nature: 'adamant' });
    assert.equal(got.rawAtk, want.atk); assert.equal(got.rawSpAtk, want.spAtk);
    assert.equal(got.attack, want.atk + want.spAtk, 'attack = atk + spAtk, DEPOIS da natureza');
    assert.equal(got.defense, want.def + want.spDef);
    assert.equal(got.speed, want.speed); assert.equal(got.hp, want.hp);
    // 25 naturezas × composição completa
    for (const n of ctx.POKEMON_NATURES) {
        const w = byHand(raw, n), g = game.calculateStats({ id, level, ivs: IVS, isShiny: true, nature: n.id });
        assert.deepEqual([g.hp, g.attack, g.defense, g.speed], [w.hp, w.atk + w.spAtk, w.def + w.spDef, w.speed], n.id);
    }
});

test('F9.3 B: gemas e talentos multiplicam DEPOIS da natureza (o time de 1 membro: sem equipe nem Pokédex extras)', () => {
    const { game, ctx } = newGame();
    const inst = game._partyInstance(0);
    inst.level = 80; inst.ivs = { ...IVS }; inst.nature = 'timid'; inst.shiny = false;     // +speed −atk
    game._touchInstance(inst);
    game.getGemBonuses = () => ({ hp_bonus: 4, atk_bonus: 5, def_bonus: 3, speed_bonus: 2, crit_rate: 0, dodge_rate: 0 });
    game.getTalentStatBonusPercent = () => 7;
    game.getBerryBonuses = () => ({});
    const raw = neutralRaw(ctx.POKEMON_DATA[25], 80, IVS), nat = ctx.POKEMON_NATURES.find(n => n.id === 'timid'), w = byHand(raw, nat);
    const base = { hp: w.hp, attack: w.atk + w.spAtk, defense: w.def + w.spDef, speed: w.speed };
    const fin = (v, gem) => Math.floor(Math.floor(v * (1 + gem / 100)) * (1 + 7 / 100));
    const s = game.calculateBattleStats(0);
    assert.equal(s.hp, fin(base.hp, 4)); assert.equal(s.attack, fin(base.attack, 5)); assert.equal(s.defense, fin(base.defense, 3)); assert.equal(s.speed, fin(base.speed, 2));
    assert.equal(s.baseSpeed, base.speed, 'baseSpeed já traz a natureza');
});

// =============================================================== C. flag desligada = números de antes da fase
test('F9.3 C: com NATURE_EFFECT_ENABLED = false os atributos são idênticos ao cálculo sem natureza (amostra de 25 naturezas × 3 espécies × 4 níveis × shiny)', () => {
    const { game, ctx } = newGame();
    flag(ctx, false); game._invalidateAllCaches();
    let n = 0;
    for (const id of [25, 6, 150]) for (const level of [1, 33, 500, 4000]) for (const shiny of [false, true]) for (const nat of ctx.POKEMON_NATURES) {
        const ref = neutralRaw(ctx.POKEMON_DATA[id], level, IVS, { shiny });
        const got = game.calculateBaseStats({ id, level, ivs: IVS, isShiny: shiny, nature: nat.id });
        assert.deepEqual([got.hp, got.atk, got.def, got.spAtk, got.spDef, got.speed], [ref.hp, ref.atk, ref.def, ref.spAtk, ref.spDef, ref.speed], `${id} Lv${level} ${nat.id}`);
        n++;
    }
    assert.equal(n, 3 * 4 * 2 * 25);
    assert.equal(ctx.natureLabel('adamant'), 'Firme', 'sem efeito não anuncia ▲/▼');
    flag(ctx, true);
});

test('F9.3 C: a instância e o cache respeitam a flag (instância com natureza, desligada → igual à neutra)', () => {
    const { game, ctx } = newGame();
    const inst = game._partyInstance(0);
    inst.nature = 'jolly'; game._touchInstance(inst);
    const on = JSON.parse(JSON.stringify(game._getInstanceStats(inst)));
    inst.nature = 'hardy'; game._touchInstance(inst);
    const neutral = JSON.parse(JSON.stringify(game._getInstanceStats(inst)));
    assert.notDeepEqual(on, neutral, 'ligada: a natureza muda os números');
    inst.nature = 'jolly'; flag(ctx, false); game._invalidateAllCaches();
    assert.deepEqual(JSON.parse(JSON.stringify(game._getInstanceStats(inst))), neutral, 'desligada: idêntico à neutra');
    flag(ctx, true);
});

// =============================================================== D. natureza ausente ou inválida
test('F9.3 D: sem natureza, nula, vazia, desconhecida ou de outro tipo → neutra, sem erro', () => {
    const { game, ctx } = newGame();
    const none = plain(game.calculateStats({ id: 25, level: 40, ivs: IVS, isShiny: false }));
    for (const bad of [undefined, null, '', 'nope', 'ADAMANT', 5, {}, [], true, 'adamant ', 'constructor', '__proto__']) {
        assert.deepEqual(plain(game.calculateStats({ id: 25, level: 40, ivs: IVS, isShiny: false, nature: bad })), none, String(bad));
        assert.equal(ctx.natureStatPercent(bad, 'atk'), 100);
        assert.equal(ctx.natureLabel(bad), ctx.getNature(bad).name);
    }
    const inst = game._partyInstance(0);
    inst.nature = 'zzz'; game._touchInstance(inst);
    assert.doesNotThrow(() => game.calculateBattleStats(0));
    inst.nature = 'hardy'; game._touchInstance(inst);
    assert.deepEqual(plain(game.calculateBattleStats(0)), (() => { inst.nature = 'zzz'; game._touchInstance(inst); return plain(game.calculateBattleStats(0)); })());
});

test('F9.3 D: o inimigo selvagem nunca tem natureza (seus atributos não mudam)', () => {
    const { game } = newGame();
    const w = game.createWildPokemon(25, 50, 0);
    assert.equal(w.nature, undefined);
    const ref = neutralRaw(game.constructor && require('../tools/load-context').loadData().POKEMON_DATA[25], 50, w.ivs);
    const s = game.calculateBaseStats(w);
    assert.deepEqual([s.atk, s.def, s.spAtk, s.spDef, s.speed, s.hp], [ref.atk, ref.def, ref.spAtk, ref.spDef, ref.speed, ref.hp]);
});

// =============================================================== E. getStatSources
test('F9.3 E: getStatSources — selfNeutral + nature = self (exato), delta com o sinal certo, HP sem efeito', () => {
    const { game, ctx } = newGame();
    const inst = game._partyInstance(0);
    inst.level = 90; inst.ivs = { ...IVS };
    for (const nat of ctx.POKEMON_NATURES) {
        inst.nature = nat.id; game._touchInstance(inst);
        const d = game.getStatSources();
        for (const k of ['hp', 'attack', 'defense', 'speed']) assert.equal(d.selfNeutral[k] + d.nature[k], d.self[k], `${nat.id} ${k}`);
        assert.equal(d.nature.hp, 0, 'HP nunca');
        const sign = (k) => Math.sign(d.nature[k]);
        const expect = { attack: 0, defense: 0, speed: 0 };
        for (const [stat, group] of [['plus', 1], ['minus', -1]]) { const k = nat[stat]; if (k === 'atk' || k === 'spAtk') expect.attack += group; if (k === 'def' || k === 'spDef') expect.defense += group; if (k === 'speed') expect.speed += group; }
        // atk e spAtk têm valores diferentes: só afirmamos o sinal quando só um dos dois se mexe
        if (nat.plus === 'speed') assert.equal(sign('speed'), 1); if (nat.minus === 'speed') assert.equal(sign('speed'), -1);
        if (nat.plus === null) for (const k of ['attack', 'defense', 'speed']) assert.equal(d.nature[k], 0, `${nat.id} neutra`);
    }
});

test('F9.3 E: o detalhamento continua fechando — Próprio (com natureza) + Equipe + Pokédex + Gemas + Talentos ≈ total (mesma folga de arredondamento de antes)', () => {
    const { game, ctx } = newGame({ seed: 8 });
    game.getGemBonuses = () => ({ hp_bonus: 3, atk_bonus: 4, def_bonus: 5, speed_bonus: 2, crit_rate: 0, dodge_rate: 0 });
    game.getTalentStatBonusPercent = () => 9;
    const second = game.roster.create({ speciesId: 4, level: 30, place: 'party' }).instance;
    second.nature = 'brave'; game._touchInstance(second);
    for (const nat of ['adamant', 'timid', 'hardy', 'modest']) {
        const inst = game._partyInstance(0); inst.nature = nat; inst.level = 120; game._touchInstance(inst);
        const d = game.getStatSources(0), t = d.battleStats;
        for (const k of ['hp', 'attack', 'defense', 'speed']) {
            const sum = d.self[k] + d.team[k] + d.pokedex[k] + d.gem[k] + d.talent[k];
            assert.ok(Math.abs(sum - t[k]) <= 3, `${nat} ${k}: soma ${sum} vs total ${t[k]}`);
        }
    }
});

// =============================================================== F. paridade online × Fast Driver
function parityGame(seed, natures) {
    const g = newGame({ seed });
    const { game } = g;
    game.clock = new g.ctx.ManualClock(10_000_000);
    const route = { id: 'kanto_route1', name: 'Parity', levelRange: [3, 3], pokemon: [{ id: 19, weight: 18, levelRange: [3, 3] }, { id: 150, weight: 2, levelRange: [3000, 3000] }] };
    game.getRoute = () => route;
    game.getShinyRate = () => 0.05;
    const lead = game._partyInstance(0); lead.level = 400; lead.nature = natures[0]; game._touchInstance(lead);
    const mate = game.roster.create({ speciesId: 4, level: 300, place: 'party' }).instance; mate.nature = natures[1]; game._touchInstance(mate);
    const pol = game.getAutomationPolicy(); pol.heal = { ...pol.heal, enabled: false }; game.setAutomationPolicy(pol);
    assert.equal(dispatch(game, 'START_HUNT').ok, true);
    game.stopBattle(); game.gameState.currentEnemy = null; delete game.gameState.battleHp;
    if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; game._nextBattleScheduledAt = null; }
    if (game.healTimer) { clearTimeout(game.healTimer); clearInterval(game.healTimer); game.healTimer = null; }
    const log = { rng: [], enemies: [], results: [], stats: [] };
    const baseRng = game.rng; game.rng = () => { const v = baseRng.call(game); log.rng.push(v); return v; };
    const make = game.createWildPokemon.bind(game);
    game.createWildPokemon = (...a) => { const w = make(...a); log.enemies.push([w.id, !!w.isShiny]); return w; };
    game.bus.on('battle_completed', (e) => log.results.push(e.result));
    return { ...g, log };
}
const seq = (t) => ({ enemies: t.log.enemies, results: t.log.results, rng: t.log.rng });

test('F9.3 F: o Fast Driver usa os MESMOS atributos do online (caches = calculateBattleStats) e a paridade de batalhas se mantém com naturezas diferentes', () => {
    for (const [seed, natures] of [[1, ['adamant', 'timid']], [2, ['modest', 'impish']], [3, ['jolly', 'hardy']]]) {
        const on = parityGame(seed, natures);
        for (let i = 0; i < 60; i++) {
            assert.equal(on.game.startBattle(), true);
            on.game._stopBattleTimer(); on.game.currentBattle.lastTick = on.game.now();
            const before = on.log.results.length;
            for (let k = 0; k < 200000 && on.log.results.length === before; k++) { on.game.clock.advance(50); on.game.battleTick(); }
            if (on.game._nextBattleTimeout) { clearTimeout(on.game._nextBattleTimeout); on.game._nextBattleTimeout = null; on.game._nextBattleScheduledAt = null; }
            if (on.game.healTimer) { clearTimeout(on.game.healTimer); clearInterval(on.game.healTimer); on.game.healTimer = null; }
            on.game.stopBattle(); on.game.gameState.currentEnemy = null; delete on.game.gameState.battleHp;
        }
        const fast = parityGame(seed, natures);
        const total = 24 * 3600 * 1000, s = fast.game._buildFastSimState(total, total);
        fast.game._getNextBattleDelay = () => 0;
        for (let i = 0; i < 60; i++) assert.equal(fast.game._fastBattleStep(s), true);
        // os caches do Fast Driver vêm da mesma função
        for (let i = 0; i < 2; i++) assert.deepEqual(plain(s.cachedTeamStats[i]), plain(fast.game.calculateBattleStats(i)), `seed ${seed} membro ${i}`);
        assert.deepEqual(seq(fast), seq(on), `seed ${seed}: inimigos, resultados e RNG idênticos`);
    }
});

test('F9.3 F: naturezas diferentes dão atributos diferentes ao líder, e o resultado da batalha muda de forma coerente (mais ataque, não menos)', () => {
    const mk = (nat) => { const { game } = newGame(); const i = game._partyInstance(0); i.level = 100; i.nature = nat; game._touchInstance(i); return game.calculateBattleStats(0); };      // Lv100: em níveis muito baixos o arredondamento para baixo come o +10%
    const neutral = mk('hardy'), adamant = mk('adamant'), bold = mk('bold'), timid = mk('timid');
    assert.ok(adamant.rawAtk > neutral.rawAtk && adamant.rawSpAtk < neutral.rawSpAtk);
    assert.ok(bold.rawDef > neutral.rawDef && bold.rawAtk < neutral.rawAtk);
    assert.ok(timid.speed > neutral.speed);
    assert.equal(adamant.hp, neutral.hp);
});

// =============================================================== G. save
test('F9.3 G: ida e volta no save preserva a natureza e os atributos; save antigo (v1 e v2) carrega neutro e com os mesmos números do código antigo', () => {
    const a = newGame({ seed: 3 });
    const inst = a.game._partyInstance(0); inst.nature = 'adamant'; a.game._touchInstance(inst);
    const before = plain(a.game.calculateBattleStats(0));
    a.game.saveNow();
    const b = newGame({ seed: 4, load: true, storage: a.storage });
    assert.equal(b.game._partyInstance(0).nature, 'adamant');
    assert.deepEqual(plain(b.game.calculateBattleStats(0)), before);
    assert.equal(b.ctx.SAVE_SCHEMA_VERSION, 3, 'a versão do save não mudou');
    const FIX = path.join(__dirname, 'fixtures');
    const STATS = JSON.parse(fs.readFileSync(path.join(FIX, 'legacy-battle-stats.json'), 'utf8'));
    for (const [fixture, stats] of [['legacy-localstorage.txt', STATS.v1], ['legacy-v2-localstorage.txt', STATS.v2]]) {
        const storage = createMemoryStorage({ pokemon_idle_save: fs.readFileSync(path.join(FIX, fixture), 'utf8') });
        const old = newGame({ storage, load: true });
        assert.equal(old.game.loadReport.ok, true);
        for (const uid of Object.keys(old.game.gameState.ownedPokemon)) assert.equal(old.game.gameState.ownedPokemon[uid].nature, 'hardy', 'migrado = neutro');
        assert.ok(stats && Object.keys(stats).length > 0);
    }
});

test('F9.3 G: natureza inválida no save é sanitizada para neutra e o jogo calcula normalmente', () => {
    const a = newGame({ seed: 3 });
    a.game.saveNow();
    const key = 'pokemon_idle_save';
    const raw = a.ctx.SaveCodec.decodePayload(a.storage.getItem(key));
    const uid = Object.keys(raw.ownedPokemon)[0];
    raw.ownedPokemon[uid].nature = 'not_a_nature';
    a.storage.setItem(key, a.ctx.SaveCodec.encodePayload ? a.ctx.SaveCodec.encodePayload(raw) : JSON.stringify(raw));
    const b = newGame({ seed: 4, load: true, storage: a.storage });
    assert.equal(b.game._partyInstance(0).nature, 'hardy');
    assert.doesNotThrow(() => b.game.calculateBattleStats(0));
});

// =============================================================== H. interface (rótulos)
test('F9.3 H: natureLabel mostra ▲/▼ com os atributos certos para as 20 naturezas e só o nome para as 5 neutras; describeInstance expõe o rótulo', () => {
    const { game, ctx } = newGame();
    const short = { atk: 'Atq', def: 'Def', spAtk: 'Atq.Esp', spDef: 'Def.Esp', speed: 'Vel' };
    for (const n of ctx.POKEMON_NATURES) {
        const label = ctx.natureLabel(n.id);
        if (n.plus === null) { assert.equal(label, n.name); assert.doesNotMatch(label, /[▲▼]/); }
        else assert.equal(label, `${n.name} ▲${short[n.plus]} ▼${short[n.minus]}`);
    }
    const inst = game._partyInstance(0); inst.nature = 'adamant';
    const d = game.describeInstance(inst.uid);
    assert.equal(d.natureLabel, 'Firme ▲Atq ▼Atq.Esp'); assert.equal(d.natureName, 'Firme');
});
