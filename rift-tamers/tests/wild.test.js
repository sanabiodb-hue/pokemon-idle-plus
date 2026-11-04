import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenome } from '../src/genome.js';
import { startWild, act, captureChance, activeUnit } from '../src/wild.js';
const mk = (s, lv, o) => { const g = createGenome(s, o); g.level = lv; return g; };

test('golpe causa dano, gasta PP e a luta termina', () => {
    const st = startWild([mk('a', 30)], mk('w', 5), { seed: 1 });
    let n = 0; while (!st.over && n++ < 50) act(st, { type: 'move', i: 1 });
    assert.equal(st.over, 'win'); assert.ok(activeUnit(st).moves[1].pp < 12);
});
test('captura: menos vida = mais chance; orbe gasto; 3 balançadas = capturado', () => {
    const st = startWild([mk('a', 10)], mk('w', 10, { rarity: 'common' }), { seed: 2, orbs: 50 });
    const full = captureChance(st); st.foe.hp = 1; assert.ok(captureChance(st) > full * 2);
    let res = null; for (let i = 0; i < 40 && !st.over; i++) res = act(st, { type: 'orb' });
    assert.equal(st.over, 'caught'); assert.equal(res.filter(e => e.t === 'shake').length, 3); assert.ok(st.orbs < 50);
});
test('sem orbes não gasta o turno', () => {
    const st = startWild([mk('a', 10)], mk('w', 10), { seed: 3, orbs: 0 }); const out = act(st, { type: 'orb' });
    assert.equal(st.turn, 0); assert.match(out[0].msg, /não tem orbes/);
});
test('troca automática quando a ativa desmaia e derrota quando todas caem', () => {
    const st = startWild([mk('a', 1), mk('b', 1)], mk('w', 60), { seed: 4 });
    let n = 0; while (!st.over && n++ < 30) act(st, { type: 'move', i: 0 });
    assert.equal(st.over, 'lose'); assert.ok(st.mine.every(u => u.hp === 0));
});
test('vida persistente entra na luta', () => {
    const t = mk('a', 10); const st = startWild([t], mk('w', 10), { hp: { [t.id]: 0.5 } });
    assert.equal(st.mine[0].hp, Math.round(st.mine[0].maxHp * 0.5));
});
test('determinístico pela semente', () => {
    const run = () => { const st = startWild([mk('a', 12)], mk('w', 12), { seed: 9 }); const all = []; while (!st.over && all.length < 200) all.push(...act(st, { type: 'move', i: 0 })); return JSON.stringify(all); };
    assert.equal(run(), run());
});
