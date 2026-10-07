'use strict';
const { loadGameContext } = require('../../tools/load-context');
const { mulberry32 } = require('./game');

// 不依赖 GameCore 的名册环境：只有一个普通 state 对象 + PokemonRoster
function makeRoster(opts = {}) {
    const ctx = loadGameContext();
    const state = ctx.PokemonRoster.initState({});
    let clock = opts.now ?? Date.UTC(2026, 5, 1, 12, 0, 0);
    const roster = new ctx.PokemonRoster(() => state, { now: () => clock });
    const rng = mulberry32(opts.seed ?? 7);
    const add = (speciesId, o = {}) => {
        const r = roster.create({ speciesId, rng, ...o });
        if (!r.ok) throw new Error('create 失败: ' + r.code);
        return r.instance;
    };
    return { ctx, state, roster, rng, add, setClock: (t) => { clock = t; } };
}

const ivsOf = (v) => ({ hp: v, atk: v, def: v, spAtk: v, spDef: v, speed: v });

module.exports = { makeRoster, ivsOf };
