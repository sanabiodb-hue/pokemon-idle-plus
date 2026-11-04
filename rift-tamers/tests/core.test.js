import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenome, statsOf, fuse, ALL_SPECIES, speciesName, addXp, xpToNext } from '../src/genome.js';
import { simulate, createBattle, step, triggerSync, SYNC_MAX } from '../src/battle.js';
import { Game, newState, upgradeCost, UPGRADES, COLLAPSE_MIN_STAGE, EXPEDITION_FLOORS, fmt } from '../src/game.js';
import { effectiveness, TYPES } from '../src/data.js';

const team = (p, lv) => [0, 1, 2].map(i => { const g = createGenome(p + i); g.level = lv; return g; });

test('genoma é determinístico pela semente e varia entre sementes', () => {
    const a = createGenome('x1', { id: 'a' }), b = createGenome('x1', { id: 'a' }), c = createGenome('x2', { id: 'a' });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.look, c.look);
});
test('60 espécies com nomes únicos', () => {
    assert.equal(ALL_SPECIES.length, 60);
    const names = new Set(ALL_SPECIES.map(k => { const [b, t] = k.split(':'); return speciesName(b, t); }));
    assert.equal(names.size, 60);
});
test('tabela de tipos é simétrica: forte numa direção, resistida na outra', () => {
    for (const a of TYPES) for (const b of TYPES) if (effectiveness(a, b) === 2 && !(new Set([a, b]).has('umbra') && new Set([a, b]).has('lumen'))) assert.equal(effectiveness(b, a), 0.5, a + '>' + b);
});
test('atributos crescem com o nível e o prismático é mais forte', () => {
    const g = createGenome('s', { prismaticRate: 0 }); const s1 = statsOf(g); g.level = 50; const s50 = statsOf(g);
    assert.ok(s50.hp > s1.hp * 5 && s50.atk > s1.atk * 5);
    const p = { ...g, prismatic: true }; assert.ok(statsOf(p).atk > s50.atk);
});
test('XP sobe vários níveis de uma vez e respeita a curva', () => {
    const g = createGenome('xp'); const need = xpToNext(1) + xpToNext(2);
    assert.equal(addXp(g, need), 2); assert.equal(g.level, 3);
});
test('batalha é determinística e termina', () => {
    const r1 = simulate(team('a', 10), team('b', 10), { seed: 7 }), r2 = simulate(team('a', 10), team('b', 10), { seed: 7 });
    assert.equal(r1.result, r2.result); assert.equal(r1.time, r2.time); assert.ok(r1.time < 75);
});
test('o mais forte vence quase sempre', () => {
    let w = 0; for (let i = 0; i < 100; i++) if (simulate(team('a' + i, 25), team('b' + i, 10), { seed: i }).result === 'A') w++;
    assert.ok(w >= 97, String(w));
});
test('passo de render (0,016 s) e passo rápido (1 s) dão o mesmo resultado', () => {
    const a = createBattle(team('a', 12), team('b', 12), { seed: 3 }), b = createBattle(team('a', 12), team('b', 12), { seed: 3 });
    while (!a.result) step(a, 1); while (!b.result) step(b, 0.016);
    assert.equal(a.result, b.result); assert.equal(a.t, b.t); assert.equal(a.actions, b.actions);
});
test('Sincronia só dispara com o medidor cheio e zera o medidor', () => {
    const st = createBattle(team('a', 10), team('b', 10), { seed: 1 });
    assert.equal(triggerSync(st), false); st.sync = SYNC_MAX; assert.equal(triggerSync(st), true); assert.equal(st.sync, 0);
    const ev = step(st, 0.05); assert.ok(ev.some(e => e.t === 'sync'));
});
test('fusão herda tipos e potenciais altos, sobe geração', () => {
    const a = createGenome('fa', { rarity: 'rare' }), b = createGenome('fb', { rarity: 'rare' }); a.pot.atk = 31; b.pot.def = 30;
    const c = fuse(a, b, 'seed');
    assert.equal(c.gen, 1); assert.ok(c.pot.atk >= 29 && c.pot.def >= 28);
    assert.ok([...a.types, ...b.types].includes(c.types[0]));
    assert.ok(['rare', 'epic'].includes(c.rarity));
});
test('jogo: inicial, luta, recompensa e avanço de estágio', () => {
    const g = new Game(newState('t1')); g.chooseStarter(0);
    assert.equal(g.s.team.length, 3);
    const { stage, enemies, battle } = g.makeStageBattle();
    while (!battle.result) step(battle, 1);
    const ess = g.s.essence; const r = g.resolveStage(stage, enemies, battle.result, { silent: true });
    if (r.result === 'A') { assert.ok(g.s.essence > ess); assert.equal(g.s.stage, 2); } else assert.equal(g.s.stage, 1);
});
test('offline roda lutas reais, respeita o limite e não regride o estágio máximo', () => {
    const g = new Game(newState('t2')); g.chooseStarter(1);
    const sum = g.runOffline(3600);
    assert.ok(sum.battles > 100 && sum.wins > 0 && sum.essence > 0);
    assert.ok(g.s.maxStage >= sum.stageTo);
    const g2 = new Game(newState('t2')); g2.chooseStarter(1);
    const capped = g2.runOffline(1e9, 50); assert.equal(capped.seconds, g2.offlineCapSeconds());
});
test('offline é determinístico com a mesma semente', () => {
    const run = () => { const g = new Game(newState('det')); g.s.lastTick = 1e12; g.chooseStarter(2); g.runOffline(1800); return [g.s.stage, Math.round(g.s.essence), g.s.creatures.length]; };
    assert.deepEqual(run(), run());
});
test('melhoria custa o preço e não passa do máximo', () => {
    const g = new Game(newState('t3')); g.s.essence = 1e9;
    const slot = UPGRADES.find(u => u.id === 'slot');
    assert.ok(g.buyUpgrade('slot')); assert.ok(g.buyUpgrade('slot')); assert.equal(g.buyUpgrade('slot'), false);
    assert.equal(g.teamSize(), 5); assert.equal(g.s.essence, 1e9 - upgradeCost(slot, 0) - upgradeCost(slot, 1));
});
test('Colapso: só a partir do estágio mínimo, dá Estilhaços e zera níveis, mantém criaturas', () => {
    const g = new Game(newState('t4')); g.chooseStarter(0);
    assert.equal(g.collapse(), 0);
    g.s.maxStage = COLLAPSE_MIN_STAGE + 20; g.teamGenomes()[0].level = 80;
    const n = g.s.creatures.length, gain = g.collapse();
    assert.ok(gain > 0); assert.equal(g.s.shards, gain); assert.equal(g.s.creatures.length, n); assert.equal(g.teamGenomes()[0].level, 1); assert.equal(g.s.stage, 1);
});
test('expedição: andares, escolha de relíquia empilhável e fim com ovo', () => {
    const g = new Game(newState('t5')); g.chooseStarter(0); g.s.maxStageEver = 20; g.s.keys = 1;
    for (const c of g.teamGenomes()) { c.level = 60; c.rarity = "mythic"; c.prismatic = true; }
    assert.ok(g.startExpedition()); assert.equal(g.s.keys, 0);
    let floors = 0, end = null; g.on((t, d) => { if (t === 'expeditionEnd') end = d; });
    while (g.s.expedition && floors < 20) {
        const { battle } = g.makeExpeditionBattle(); while (!battle.result) step(battle, 1);
        g.resolveExpedition(battle); floors++;
        if (g.s.expedition && g.s.expedition.choices) { const id = g.s.expedition.choices[0]; g.pickRelic(id); }
    }
    assert.ok(end && end.victory && end.reached === EXPEDITION_FLOORS && end.egg);
});
test('save: ida e volta, e rejeita lixo', () => {
    const g = new Game(newState('t6')); g.chooseStarter(0); g.s.essence = 123;
    const g2 = Game.importSave(g.exportSave()); assert.equal(g2.s.essence, 123); assert.equal(g2.s.team.length, 3);
    assert.throws(() => Game.deserialize('{"v":99}'));
});
test('formatação de números grandes', () => { assert.equal(fmt(999), '999'); assert.equal(fmt(1500), '1.50K'); assert.equal(fmt(2.5e9), '2.50B'); });
