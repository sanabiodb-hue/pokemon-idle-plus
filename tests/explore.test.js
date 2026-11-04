'use strict';
// F10: modo Explorar — golpes, encontros por passo, captura manual (vida/status/bola), fuga, batalha por turnos e a guarda do idle.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { newGame, mulberry32 } = require('./helpers/game');

const route1 = (ctx) => ctx.REGIONS.kanto.routes.find(r => r.id === 'kanto_route1');
function setBalls(game, balls) { const inv = game.ensureInventory(); inv.ballsGranted = true; inv.balls = { ...balls }; }
function boostParty(game, level) { for (const uid of game.gameState.party) game.gameState.ownedPokemon[uid].level = level; game._invalidateAllCaches?.(); }

test('F10 golpes: até 4, sempre Investida, técnica de cada tipo pelo nível, PP pelo poder', () => {
    const { ctx } = newGame();
    const m = ctx.exploreMoveset(6, 1);                    // Charizard (fogo/voador)
    assert.ok(m.length >= 3 && m.length <= 4);
    assert.equal(m[0].name, 'Investida'); assert.equal(m[0].pp, 35);
    assert.ok(m.some(x => x.type === 'fire' && x.name === ctx.SKILL_DATA.fire[0].name));
    assert.ok(m.some(x => x.type === 'flying'));
    const hi = ctx.exploreMoveset(6, 5);
    assert.ok(hi.some(x => x.name === ctx.SKILL_DATA.fire[4].name) && hi.some(x => x.name === ctx.SKILL_DATA.fire[3].name), 'técnica atual e a anterior do 1º tipo');
    for (const x of hi) assert.equal(x.maxPp, ctx.explorePp(x.power));
    assert.equal(ctx.explorePp(40), 35); assert.equal(ctx.explorePp(60), 25); assert.equal(ctx.explorePp(80), 15); assert.equal(ctx.explorePp(100), 10); assert.equal(ctx.explorePp(130), 5);
    assert.equal(ctx.exploreSkillLevelFor(5), 1); assert.equal(ctx.exploreSkillLevelFor(50), 3); assert.equal(ctx.exploreSkillLevelFor(9999), ctx.MAX_SKILL_LEVEL);
});

test('F10 encontros: só no mato alto da rota; cidade e caminho nunca; biomas sem grama usam o chão', () => {
    const { ctx } = newGame();
    const r1 = ctx.getWorldMap('kanto_route1'), town = ctx.getWorldMap('starter_town');
    const find = (map, ch) => { for (let y = 0; y < map.height; y++) { const x = map.rows[y].indexOf(ch); if (x >= 0) return { x, y }; } return null; };
    const w = find(r1, 'w'), p = find(r1, 'p'), g = find(r1, '.');
    assert.equal(ctx.exploreEncounterCell(r1, w.x, w.y), 'grass');
    assert.equal(ctx.exploreEncounterCell(r1, p.x, p.y), null);
    assert.equal(ctx.exploreEncounterCell(r1, g.x, g.y), null, 'chão comum de mapa com grama: sem encontro');
    const q = find(town, 'q'); assert.equal(ctx.exploreEncounterCell(town, q.x, q.y), null);
    const cave = { id: 't_cave', type: 'hunt', width: 3, height: 1, rows: ['cuc'] };
    assert.equal(ctx.exploreEncounterCell(cave, 0, 0), 'ground'); assert.equal(ctx.exploreEncounterCell(cave, 1, 0), null);
});

test('F10 sorteio por passo: um sorteio por tile completado em terreno de encontro', () => {
    const { ctx } = newGame();
    const r1 = ctx.getWorldMap('kanto_route1'), T = ctx.WORLD_TILE_SIZE;
    let y; const x = r1.rows.findIndex(r => r.includes('w')); y = x; const cx = r1.rows[y].indexOf('w');
    const at = (d) => ({ x: cx * T + 8, y: y * T + 8, distance: d });
    let n = 0; const rng = (v) => () => { n++; return v; };
    assert.equal(ctx.exploreStepEncounter(r1, at(0), at(10), rng(0)), null); assert.equal(n, 0, 'sem completar o passo, nenhum sorteio');
    assert.equal(ctx.exploreStepEncounter(r1, at(10), at(17), rng(0)), 'grass'); assert.equal(n, 1);
    n = 0; assert.equal(ctx.exploreStepEncounter(r1, at(0), at(48), rng(0.99)), null); assert.equal(n, 3, 'três passos, três sorteios');
});

test('F10 captura manual: vida cheia = chance do idle; menos vida e status aumentam; Master = 1; limites', () => {
    const { ctx } = newGame({ balls: true });
    const poke = ctx.getBallType('pokeball'), ultra = ctx.getBallType('ultraball'), master = ctx.getBallType('masterball');
    for (const rate of [0.2, 0.5, 1]) {
        assert.equal(ctx.exploreCaptureChance(rate, poke, 1, false), Math.max(ctx.EXPLORE.catchMin, ctx.captureChance(rate, poke)));
        assert.ok(ctx.exploreCaptureChance(rate, poke, 0.1, false) > ctx.exploreCaptureChance(rate, poke, 1, false) || ctx.exploreCaptureChance(rate, poke, 1, false) >= ctx.EXPLORE.catchMax);
        assert.ok(ctx.exploreCaptureChance(rate, ultra, 0.5, false) >= ctx.exploreCaptureChance(rate, poke, 0.5, false));
        assert.ok(ctx.exploreCaptureChance(rate, poke, 0.5, true) >= ctx.exploreCaptureChance(rate, poke, 0.5, false));
        assert.ok(ctx.exploreCaptureChance(rate, ultra, 0, true) <= ctx.EXPLORE.catchMax);
    }
    assert.equal(ctx.exploreCaptureChance(0.2, master, 1, false), 1);
});

test('F10 balançadas: P(3 balançadas) ≈ chance; chance 1 sempre captura', () => {
    const { ctx } = newGame();
    const rng = mulberry32(7);
    for (const c of [0.1, 0.4, 0.8]) { let k = 0; for (let i = 0; i < 20000; i++) if (ctx.exploreShakes(c, rng) === 3) k++; assert.ok(Math.abs(k / 20000 - c) < 0.015, `${c}: ${k / 20000}`); }
    assert.equal(ctx.exploreShakes(1, () => 0.999), 3);
});

test('F10 fuga: fórmula da 3ª geração, sobe com as tentativas e satura em 1', () => {
    const { ctx } = newGame();
    assert.equal(ctx.exploreRunChance(50, 100, 0), 0.25);
    assert.equal(ctx.exploreRunChance(50, 100, 2), (64 + 60) / 256);
    assert.equal(ctx.exploreRunChance(300, 100, 0), 1);
});

test('F10 guarda do idle: explorando, startBattle recusa com "explore"; ao sair a batalha automática volta', () => {
    const { game } = newGame();
    assert.ok(game.startBattle()); assert.ok(game.battleTimer);
    const r = game.exploreEnter(); assert.ok(r.ok); assert.ok(game.isExploring());
    assert.equal(game.battleTimer, null, 'a batalha automática parou');
    assert.equal(game.startBattle(), false); assert.equal(game._battleGuard.last, 'explore');
    assert.ok(game.exploreLeave()); assert.ok(game.battleTimer, 'voltou a lutar sozinha');
    game.stopBattle();
});

test('F10 guarda: caçada automática em andamento bloqueia a exploração', () => {
    const { game } = newGame();
    assert.ok(game.dispatchAutomationAction({ type: 'START_HUNT' }).ok);
    assert.equal(game.exploreEnter().code, 'hunt_active');
    assert.equal(game.isExploring(), false);
    game.stopBattle();
});

test('F10 batalha: vencer dá XP pelo acerto oficial, não gasta bola nem captura sozinho', () => {
    const { game, ctx } = newGame({ balls: true, seed: 3 });
    setBalls(game, { pokeball: 10 });
    boostParty(game, 60);
    game.exploreEnter();
    const wild = game.exploreWild(route1(ctx));
    const uid = game.gameState.party[0], exp0 = game.gameState.ownedPokemon[uid].exp, caught0 = Object.keys(game.gameState.caughtPokemon).length;
    const b = new ctx.ExploreBattle(game, wild);
    let n = 0; while (!b.over && n++ < 50) b.act({ type: 'move', i: b.me().moves.length - 1 });
    assert.equal(b.over, 'win');
    const me = b.me(); game.exploreVictory(wild, me.idx, me.maxHp, me.hp);
    assert.ok(game.gameState.ownedPokemon[uid].exp > exp0 || game.gameState.ownedPokemon[uid].level > 60, 'ganhou XP');
    assert.equal(game.getBallCount('pokeball'), 10, 'nenhuma bola gasta');
    assert.equal(Object.keys(game.gameState.caughtPokemon).length, caught0, 'desmaiado não é capturado');
    assert.equal(game.gameState.pokedex[wild.id] !== undefined, true);
    game.exploreLeave(); game.stopBattle();
});

test('F10 captura: gasta 1 bola por lançamento; capturado vira indivíduo e emite pokemon_captured (reason explore)', () => {
    const { game, ctx } = newGame({ balls: true, seed: 5 });
    setBalls(game, { ultraball: 30 });
    game.exploreEnter();
    const events = []; game.bus.on('pokemon_captured', e => events.push(e));
    const wild = game.exploreWild(route1(ctx));
    const owned0 = Object.keys(game.gameState.ownedPokemon).length;
    const b = new ctx.ExploreBattle(game, wild);
    b.foe.hp = 1;
    let throws = 0; while (!b.over && throws < 30) { b.act({ type: 'ball', id: 'ultraball' }); throws++; if (b.foe.hp <= 0) break; }
    assert.equal(b.over, 'caught');
    assert.equal(game.getBallCount('ultraball'), 30 - throws);
    assert.equal(Object.keys(game.gameState.ownedPokemon).length, owned0 + 1);
    assert.equal(events.length, 1); assert.equal(events[0].reason, 'explore'); assert.equal(events[0].ball, 'ultraball');
    assert.equal(game.exploreCapture(wild, 'ultraball', 0.1, false).caught, false, 'o mesmo selvagem não é capturado duas vezes');
    game.exploreLeave(); game.stopBattle();
});

test('F10 sem bola não lança; Poção cura e gasta 1; derrota total termina em "lose"', () => {
    const { game, ctx } = newGame({ balls: true, seed: 9 });
    setBalls(game, {});
    game.exploreEnter();
    const strong = game.createWildPokemon(150, 100);         // Mewtwo nível 100 contra o inicial
    const b = new ctx.ExploreBattle(game, strong);
    assert.match(b.act({ type: 'ball', id: 'pokeball' })[0].msg, /não tem/);
    assert.equal(b.turn, 0, 'sem bola o turno não passa');
    const inv = game.ensureInventory(), p0 = inv.potions;
    b.me().hp = 1; b.act({ type: 'potion' });
    assert.equal(inv.potions, p0 - 1);
    let n = 0; while (!b.over && n++ < 60) b.act({ type: 'move', i: 0 });
    assert.equal(b.over, 'lose'); assert.ok(b.party.every(u => u.hp === 0));
    game.exploreLeave(); game.stopBattle();
});

test('F10 estado entre batalhas: vida, PP e status voltam pelo keep()', () => {
    const { game, ctx } = newGame({ seed: 11 });
    const w1 = game.exploreWild(route1(ctx));
    const b1 = new ctx.ExploreBattle(game, w1);
    b1.me().hp = Math.floor(b1.me().maxHp / 2); b1.me().moves[0].pp = 3; b1.me().status = 'poison';
    const keep = b1.keep();
    const b2 = new ctx.ExploreBattle(game, game.exploreWild(route1(ctx)), { keep });
    assert.equal(b2.me().maxHp, b1.me().maxHp); assert.equal(b2.me().hp, b1.me().hp, 'mesma vida');
    assert.equal(b2.me().moves[0].pp, 3); assert.equal(b2.me().status, 'poison');
});

test('F10 flag desligada: exploração indisponível e o idle não muda', () => {
    const { game, ctx } = newGame();
    vm.runInContext('EXPLORE_ENABLED = false', ctx.sandbox);
    assert.equal(game.exploreEnter().code, 'disabled');
    assert.ok(game.startBattle()); game.stopBattle();
});
