'use strict';
// F10.7: EXP animada e tela de nível — fração da barra, trechos da animação, tabela de atributos, retrato antes/depois da vitória
// e a equipe em campo ficando mais forte no meio da batalha contra treinador.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');

test('F10.7 fração da barra: 0 no começo do nível, perto de 1 no fim, presa entre 0 e 1', () => {
    const { ctx } = newGame();
    const g = ctx.POKEMON_DATA[1].expGroup || 'medium', a = ctx.getExpForLevel(g, 10), b = ctx.getExpForLevel(g, 11);
    assert.equal(ctx.exploreExpFrac(1, 10, a), 0);
    assert.ok(Math.abs(ctx.exploreExpFrac(1, 10, (a + b) / 2) - 0.5) < 1e-9);
    assert.ok(ctx.exploreExpFrac(1, 10, b - 1) > 0.95 && ctx.exploreExpFrac(1, 10, b - 1) < 1);
    assert.equal(ctx.exploreExpFrac(1, 10, b + 999), 1);
    assert.equal(ctx.exploreExpFrac(1, 10, -5), 0);
    assert.equal(ctx.exploreExpFrac(1, ctx.MAX_POKEMON_LEVEL, 1e12), 0, 'nível máximo: barra vazia');
});

test('F10.7 trechos: sem subir é um trecho; subindo enche no nível antigo, mostra no máximo 1 barra cheia do meio e termina no novo', () => {
    const { ctx } = newGame();
    const seg = (a, b, m) => JSON.stringify(ctx.exploreExpSegments(a, b, m));
    assert.equal(seg({ level: 5, frac: 0.2 }, { level: 5, frac: 0.6 }), JSON.stringify([{ level: 5, from: 0.2, to: 0.6 }]));
    assert.equal(seg({ level: 5, frac: 0.2 }, { level: 5, frac: 0.2 }), '[]', 'nada mudou');
    assert.equal(seg({ level: 5, frac: 0.7 }, { level: 6, frac: 0.1 }), JSON.stringify([{ level: 5, from: 0.7, to: 1 }, { level: 6, from: 0, to: 0.1 }]));
    assert.equal(seg({ level: 5, frac: 0.7 }, { level: 9, frac: 0.3 }), JSON.stringify([{ level: 5, from: 0.7, to: 1 }, { level: 8, from: 0, to: 1 }, { level: 9, from: 0, to: 0.3 }]));
    assert.equal(seg({ level: 5, frac: 0.7 }, { level: 9, frac: 0.3 }, 0).split('level').length - 1, 2, 'maxFull 0: só o antigo e o novo');
    assert.equal(seg(null, { level: 9, frac: 0 }), '[]');
});

test('F10.7 tabela de atributos: PS, Ataque, Defesa e Velocidade com antes, depois e ganho', () => {
    const { ctx } = newGame();
    const rows = ctx.exploreStatGains({ hp: 30, attack: 20.4, defense: 18, speed: 25 }, { hp: 33, attack: 22, defense: 18, speed: 27.6 });
    assert.equal(rows.map(r => r.label).join(), 'PS,Ataque,Defesa,Velocidade');
    assert.equal(rows.map(r => `${r.from}>${r.to}:${r.delta}`).join(), '30>33:3,20>22:2,18>18:0,25>28:3');
    assert.equal(ctx.exploreStatGains(null, {}).length, 0);
});

test('F10.7 vitória devolve o retrato antes/depois da equipe; subir de nível aumenta os atributos do próprio Pokémon', () => {
    const { game, ctx } = newGame({ seed: 7 });
    const uid = game.gameState.party[0], inst = game.gameState.ownedPokemon[uid], grp = ctx.POKEMON_DATA[inst.speciesId].expGroup || 'medium';
    inst.level = 8; inst.exp = ctx.getExpForLevel(grp, 9) - 1; game._instanceStats.clear();
    const wild = game.createWildPokemon(16, 12, 0);
    const r = game.exploreVictory(wild, 0, 40, 40);
    assert.ok(r.growth && r.growth.active === 0);
    const a = r.growth.before[0], z = r.growth.after[0];
    assert.equal(a.uid, uid); assert.equal(z.uid, uid);
    assert.equal(a.level, 8); assert.ok(z.level >= 9, String(z.level));
    assert.ok(a.frac > 0.99 && z.frac >= 0 && z.frac < 1);
    assert.ok(z.stats.hp > a.stats.hp, `PS ${a.stats.hp} → ${z.stats.hp}`);
    const segs = ctx.exploreExpSegments(a, z);
    assert.equal(segs[0].level, 8); assert.equal(segs[0].to, 1); assert.equal(segs[segs.length - 1].level, z.level);
    assert.equal(game.exploreSnapshot(99), null);
});

test('F10.7 no meio da batalha contra treinador: refresh() aplica o nível novo e soma os PS máximos que cresceram', () => {
    const { game, ctx } = newGame({ seed: 4 });
    const uid = game.gameState.party[0], inst = game.gameState.ownedPokemon[uid];
    const team = [game.createWildPokemon(16, 4, 0), game.createWildPokemon(19, 5, 0)]; team.forEach(w => { w._trainer = true; });
    const b = new ctx.ExploreBattle(game, team[0], { trainer: { cls: 'Jovem Treinador', name: 'Léo', team } });
    const me = b.me(), hp0 = me.hp - 3; me.hp = hp0; const max0 = me.maxHp, lv0 = me.level;
    inst.level += 3; game._instanceStats.clear();
    const learned = b.refresh();
    assert.equal(me.level, lv0 + 3);
    assert.ok(me.maxHp > max0, `${max0} → ${me.maxHp}`);
    assert.equal(me.hp, Math.min(me.maxHp, hp0 + (me.maxHp - max0)), 'o crescimento entra na vida atual');
    assert.ok(Array.isArray(learned));
    me.hp = 0; inst.level += 1; game._instanceStats.clear(); b.refresh();
    assert.equal(me.hp, 0, 'desmaiado continua desmaiado');
});

test('F10.7 golpe novo: ao cruzar o nível da técnica, refresh() conta o golpe aprendido e mantém o PP dos antigos', () => {
    const { game, ctx } = newGame({ seed: 5 });
    const uid = game.gameState.party[0], inst = game.gameState.ownedPokemon[uid];
    inst.skillLevel = 0; inst.level = 24; game._instanceStats.clear();
    const w = game.createWildPokemon(16, 4, 0);
    const b = new ctx.ExploreBattle(game, w, {});
    const me = b.me(), names0 = me.moves.map(m => m.name).join('|');
    me.moves[0].pp = 3;
    inst.level = 25; game._instanceStats.clear();
    const learned = b.refresh();
    const names1 = me.moves.map(m => m.name).join('|');
    assert.notEqual(names1, names0, 'nível 25 libera a técnica seguinte');
    assert.equal(learned.length, 1); assert.ok(learned[0].learned.length >= 1);
    for (const n of learned[0].learned) assert.ok(!names0.split('|').includes(n));
    for (const n of learned[0].forgot) assert.ok(names0.split('|').includes(n) && !names1.split('|').includes(n));
    assert.ok(me.moves.length <= 4);
    assert.equal(b.refresh().length, 0, 'sem mudança de nível, nada novo');
    const kept = me.moves.find(m => m.name === ctx.EXPLORE.tackle.name); if (kept) assert.equal(kept.pp, 3, 'PP do golpe antigo preservado');
});

test('F10.7 evolução: recomeçando o nível (espécie nova) a barra só enche; mantendo o nível os trechos seguem normais', () => {
    const { ctx } = newGame();
    assert.equal(JSON.stringify(ctx.exploreExpSegments({ level: 60, frac: 0.9, speciesId: 25 }, { level: 2, frac: 0, speciesId: 26 })), JSON.stringify([{ level: 60, from: 0.9, to: 1 }]));
    assert.equal(JSON.stringify(ctx.exploreExpSegments({ level: 21, frac: 0.9, speciesId: 25 }, { level: 22, frac: 0.05, speciesId: 26 })), JSON.stringify([{ level: 21, from: 0.9, to: 1 }, { level: 22, from: 0, to: 0.05 }]));
});

test('F10.7 evolução no meio da batalha: refresh() faz o Pokémon em campo lutar como a espécie nova (tipos e nome)', () => {
    const { game, ctx } = newGame({ seed: 4 });
    const uid = game.gameState.party[0], inst = game.gameState.ownedPokemon[uid], grp = ctx.POKEMON_DATA[inst.speciesId].expGroup || 'medium';
    assert.equal(inst.speciesId, 25);
    game.gameState.pokedex[26] = 'caught';                 // já registrado: a evolução mantém o nível
    inst.level = 30; inst.exp = ctx.getExpForLevel(grp, 31) - 1; game._instanceStats.clear();
    const team = [game.createWildPokemon(16, 4, 0), game.createWildPokemon(19, 5, 0)]; team.forEach(w => { w._trainer = true; });
    const b = new ctx.ExploreBattle(game, team[0], { trainer: { cls: 'Jovem Treinador', name: 'Léo', team } });
    const r = game.exploreVictory(team[0], 0, b.me().maxHp, b.me().hp);
    const a = r.growth.before[0], z = r.growth.after[0];
    assert.equal(a.speciesId, 25); assert.equal(z.speciesId, 26); assert.ok(z.level > a.level, 'nível mantido e subiu');
    b.refresh();
    assert.equal(b.me().speciesId, 26); assert.equal(b.me().name, ctx.getInstanceDisplayName(inst));
    assert.equal(JSON.stringify(b.me().types), JSON.stringify(ctx.POKEMON_DATA[26].types));
});
