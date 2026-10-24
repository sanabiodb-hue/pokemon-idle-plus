'use strict';
// F9.10 · Medição da calibração numérica (shiny, lendários, bolas e poção). Determinística: sementes fixas, Fast Driver, relógio simulado, sem dependências.
//   node tools/calibrate-f910.js economy            -> M4/M5: custo de poções e bolas em % do ouro (níveis 30, 100, 400, 1000, rota compatível)
//   node tools/calibrate-f910.js shiny [N]          -> M1: mediana de encontros e de horas até o 1º shiny (cenários com e sem fontes)
//   node tools/calibrate-f910.js legendary [N]      -> M2: horas até o 1º lendário/mítico por rota (rotas da lista AUDITED_ROUTES)
//   node tools/calibrate-f910.js legtable [--write] -> M2: gera a tabela por rota (js/game-config.js, LEGENDARY_ROUTE_MULT); legall [N]: mede todas as rotas da tabela
//   node tools/calibrate-f910.js premium [N]        -> M3: chance de captura de um alvo BST 680 por bola
//   node tools/calibrate-f910.js all
const path = require('path');
const vm = require('vm');
const { createSimGame, getContext } = require('./automation-sim');
const { loadData } = require(path.join(__dirname, 'load-context'));

const MIN = 60000, HOUR = 3600000;
const LEVELS = [30, 100, 400, 1000];
const FARM_PARTY = [6, 9, 149, 130, 143, 3];                      // equipe de teste (nenhuma é lendária/mítica)
const PERFECT = { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 };

const ctx = getContext();
const DATA = loadData();
const ROUTES = Object.values(DATA.REGIONS).flatMap(r => r.routes);
const RESTRICTED = new Set([...ctx.LEGENDARY_SPECIES_IDS, ...ctx.MYTHICAL_SPECIES_IDS]);
const isRestricted = (id) => RESTRICTED.has(id);
const routeById = (id) => ROUTES.find(r => r.id === id);

const round = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Rota "compatível" com um nível: a de nível médio mais próximo, com pelo menos 3 espécies comuns (sem lendários/míticos)
function compatibleRoute(level) {
    let best = null;
    for (const r of ROUTES) {
        if (r.pokemon.filter(p => !isRestricted(p.id)).length < 3) continue;
        const d = Math.abs((r.levelRange[0] + r.levelRange[1]) / 2 - level);
        if (!best || d < best.d) best = { r, d };
    }
    return best.r;
}

function setFlags(flags) {
    for (const [k, v] of Object.entries(flags)) vm.runInContext(`${k} = ${JSON.stringify(v)}`, ctx.sandbox || ctx);
}

// Jogador de teste: equipe de 6 no nível dado, ouro e estoque ilimitados (a medição é de FLUXO, não de falta de caixa), benefício de reposição ligado
function farmer(level, routeId, seed, extra = {}) {
    setFlags({ BENEFITS_DEV_OVERRIDE: true });
    const { game } = createSimGame({
        ctx, seed, starterLevel: level, routeId, potions: 99999, shinyRate: extra.shinyRate, start: false,
        party: extra.party || FARM_PARTY.slice(1).map(speciesId => ({ speciesId, level, ivs: PERFECT })),
        policy: extra.policy || { heal: { enabled: true, whenHpBelowPercent: 30 } },
    });
    game._simMode = true;
    // Um jogador de nível alto numa rota de região avançada já completou a Pokédex das regiões anteriores (é o que libera a região); sem isso o teto de preço
    // (_pricingCap, regiões liberadas) ficaria em Kanto e as bolas/poções sairiam baratas demais na medição
    const keys = Object.keys(DATA.REGIONS), region = keys.find(k => DATA.REGIONS[k].routes.some(r => r.id === routeId));
    for (const k of keys) {
        if (k === region) break;
        const range = ctx.REGION_POKEDEX_RANGES[k];
        for (let id = range[0]; id <= range[1]; id++) game.gameState.pokedex[id] = 'caught';
    }
    game._invalidateAllCaches();
    game.gameState.gold = 1e9;
    game.gameState.economy = { earned: 0, spent: 0, byReason: {} };
    return game;
}

// ---------- M4 / M5 ----------
function measureEconomy(opts = {}) {
    const hours = opts.hours || 1, seed = opts.seed || 7, rows = [];
    for (const level of LEVELS) {
        const route = compatibleRoute(level);
        const game = farmer(level, route.id, seed);
        const start = game.dispatchAutomationAction({ type: 'START_HUNT' });
        if (!start.ok) throw new Error('START_HUNT: ' + JSON.stringify(start));
        const r = ctx.simulateHunt(game, hours * HOUR);
        const st = game.getHuntSession().stats;
        const spent = (reason) => (game.gameState.economy.byReason[reason] || { spent: 0 }).spent;
        const gold = st.money, potion = st.healCost, balls = spent('ball_purchase');
        rows.push({
            level, route: route.id, levels: route.levelRange.join('-'), hours, seed,
            battlesPerHour: round(r.battles / hours, 0), winsPerHour: round(r.victories / hours, 0), winRate: round(100 * r.victories / Math.max(1, r.battles), 1),
            goldPerHour: round(gold / hours, 0), potionPct: round(100 * potion / gold, 1), ballPct: round(100 * balls / gold, 1),
            netPct: round(100 * (gold - potion - balls) / gold, 1), potionPrice: game.getPotionPrice(),
        });
    }
    return rows;
}

// Rotas "compatíveis" com um nível, no sentido da medição: nível médio em [0,7·L; 1,3·L], pelo menos 3 espécies comuns e vitória em ≥ 90% das lutas com a equipe
// de teste (o que o jogador de fato consegue caçar). Devolve uma linha por rota com os custos em % do ouro (1 h do Fast Driver, semente fixa).
function compatibleSet(level, { team = 'team6', seed = 7, hours = 1 } = {}) {
    const set = ROUTES.filter(r => { const m = (r.levelRange[0] + r.levelRange[1]) / 2; return m >= 0.7 * level && m <= 1.3 * level && r.pokemon.filter(p => !isRestricted(p.id)).length >= 3; });
    const rows = [];
    for (const r of set) {
        const g = farmer(level, r.id, seed, team === 'solo' ? { party: [] } : {});
        g.dispatchAutomationAction({ type: 'START_HUNT' });
        const res = ctx.simulateHunt(g, hours * HOUR), st = g.getHuntSession().stats;
        if (res.victories / Math.max(1, res.battles) < 0.9 || st.money <= 0) continue;
        const balls = (g.gameState.economy.byReason.ball_purchase || { spent: 0 }).spent;
        rows.push({ route: r.id, ballPct: 100 * balls / st.money, potionPct: 100 * st.healCost / st.money, potionsPerWin: st.healingSpent / Math.max(1, res.victories) });
    }
    return rows;
}
const quant = (a, q) => { const s2 = a.slice().sort((x, y) => x - y); return s2.length ? s2[Math.min(s2.length - 1, Math.floor(q * s2.length))] : null; };
function measureBallSets() {
    return LEVELS.map(level => { const rows = compatibleSet(level), b = rows.map(x => x.ballPct); return { level, rotas: rows.length, ballMin: round(Math.min(...b), 1), ballMediana: round(quant(b, 0.5), 1), ballMax: round(Math.max(...b), 1), dentro6a10: b.filter(x => x >= 6 && x <= 10).length }; });
}
function measurePotionSets() {
    const out = [];
    for (const team of ['team6', 'solo']) for (const level of LEVELS) {
        const rows = compatibleSet(level, { team }), p = rows.map(x => x.potionPct);
        out.push({ equipe: team, level, rotas: rows.length, potionMediana: round(quant(p, 0.5), 1), potionP90: round(quant(p, 0.9), 1), potionMax: round(Math.max(...p), 1), dentro50: p.filter(x => x <= 50).length });
    }
    return out;
}

// ---------- M1: shiny ----------
// Encontros até o 1º shiny, pelo caminho REAL (GameCore.createWildPokemon): uma sessão de caça rodando com a cadeia já no teto (ou zerada) e as fontes fixas
// injetadas. Uma espécie só, para a cadeia valer sempre. Cada encontro é um sorteio (o mesmo RNG semeado do jogo).
const SHINY_SPECIES = 25, SHINY_LEVEL = 50;
function shinyGame(seed, { chain, badge = null, talent = 0, tower = 0 }) {
    setFlags({ BENEFITS_DEV_OVERRIDE: false });
    const { game } = createSimGame({ ctx, seed, starterLevel: 30 });
    game.getBadgeEffectValue = (k) => (k === 'shiny_bonus' ? badge : null);
    game.getTalentValue = (k) => (k === 'shiny_bonus' ? talent : 0);
    game.getTowerBonus = () => tower;
    game.getHuntSession().shinyChain = { speciesId: SHINY_SPECIES, count: chain ? ctx.SHINY_CHAIN_FULL_WINS * 5 : 0 };     // cadeia no teto ou sem cadeia
    return game;
}
function encountersToShiny(game) {
    for (let n = 1; ; n++) if (game.createWildPokemon(SHINY_SPECIES, SHINY_LEVEL).isShiny) return n;
}
const SHINY_SCENARIOS = [
    { name: 'referência: cadeia ×2, nenhuma fonte', chain: true, sources: 1 },
    { name: 'sem cadeia, nenhuma fonte', chain: false, sources: 1 },
    { name: 'cadeia ×2 + insígnia de Sinnoh (+100%)', chain: true, sources: 2, badge: 1.0 },
    { name: 'cadeia ×2 + Sinnoh + talento (+100%)', chain: true, sources: 3, badge: 1.0, talent: 100 },
    { name: 'PIOR CASO: cadeia ×2 + todas as fontes no teto (×4)', chain: true, sources: 4, badge: 1.0, talent: 100, tower: 300 },
];
function measureShiny(opts = {}) {
    const N = opts.n || 600, ref = ctx.SHINY_REFERENCE_WINS_PER_HOUR;
    return SHINY_SCENARIOS.map(sc => {
        const counts = [];
        for (let i = 0; i < N; i++) counts.push(encountersToShiny(shinyGame(1000 + i, sc)));
        const med = median(counts), mult = Math.min(ctx.SHINY_SOURCES_MAX_MULT, sc.sources) * (sc.chain ? ctx.SHINY_CHAIN_MAX_MULT_CALIBRATED : 1);
        const expected = Math.log(2) / -Math.log(1 - ctx.BASE_SHINY_RATE_CALIBRATED * mult);
        return { cenario: sc.name, N, mult, medianaEncontros: med, medianaHoras180: round(med / ref, 1), esperadoHoras180: round(expected / ref, 1) };
    });
}

// ---------- M2: lendários ----------
// As 10 rotas da lista da F9.8 (informadas pelo responsável do projeto). E (encontros/h) é MEDIDO em TODAS as rotas com lendário (janela de 10 h); a lista só marca as 10 de referência.
const AUDITED_ROUTES = ['kanto_route10', 'kanto_cerulean_cave', 'johto_tin_tower', 'hoenn_sealed_chamber', 'sinnoh_hall_of_origin', 'unova_n_castle',
    'kalos_unknown_dungeon', 'alola_route13', 'galar_route15', 'paldea_route14'];
const LEGENDARY_TARGET_HOURS = 10;                                  // H: mediana desejada até o 1º lendário/mítico (faixa aceita: 7–14 h)
const TABLE_SEED = 500;

// Encontros por hora de uma rota (Fast Driver, equipe de teste no nível médio da rota, média de uma janela de H = 10 h simuladas — a 1ª hora é mais lenta, o
// ritmo estabiliza depois —) COM a calibração ligada: a composição real dos inimigos (poucos lendários, que demoram mais a vencer) muda o ritmo em rotas
// onde o lendário natural é grande. Por isso a tabela é um ponto fixo: E é medido com a tabela vigente e a tabela é regerada até E parar de mudar (> 3%).
function measureEncounterRate(routeId, seed = TABLE_SEED) {
    const route = routeById(routeId), level = Math.round((route.levelRange[0] + route.levelRange[1]) / 2);
    const game = farmer(level, routeId, seed);
    let n = 0;
    const make = game.createWildPokemon.bind(game);
    game.createWildPokemon = (...a) => { n++; return make(...a); };
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    ctx.simulateHunt(game, LEGENDARY_TARGET_HOURS * HOUR);
    return { level, encounters: n / LEGENDARY_TARGET_HOURS };
}
const routeLegendaryShare = (route) => {
    const tw = route.pokemon.reduce((a, p) => a + p.weight, 0), leg = route.pokemon.filter(p => isRestricted(p.id)).reduce((a, p) => a + p.weight, 0);
    return { tw, leg, p: leg / tw };
};
// Tabela por rota: m = p_alvo (1 − p) / (p (1 − p_alvo)), com p_alvo = ln2 / (E × H). Rotas só com restritos (p = 1) não entram: normalizar não muda nada.
// E é arredondado a 0,1 ANTES do cálculo, para que a tabela de E (documentação) e a de m (usada no jogo) sejam reproduzíveis uma da outra.
const routesWithMixedLegendaries = () => ROUTES.filter(r => { const s = routeLegendaryShare(r); return s.leg > 0 && s.leg < s.tw; });
function legendaryRows(encounters) {                                // encounters: { rotaId: encontros/h }
    return routesWithMixedLegendaries().filter(r => encounters[r.id] !== undefined).map(r => {
        const E = round(encounters[r.id], 1), p = routeLegendaryShare(r).p;
        const pt = Math.LN2 / (E * LEGENDARY_TARGET_HOURS), m = pt * (1 - p) / (p * (1 - pt));
        return { id: r.id, level: Math.round((r.levelRange[0] + r.levelRange[1]) / 2), E, da_lista: AUDITED_ROUTES.includes(r.id), p, pAlvo: pt, m: Number(m.toPrecision(4)) };
    });
}
function buildLegendaryTable(opts = {}) {
    const ids = opts.ids || routesWithMixedLegendaries().map(r => r.id), E = {};
    for (const id of ids) E[id] = measureEncounterRate(id).encounters;
    return { rows: legendaryRows(E) };
}
const TABLE_BEGIN = '// BEGIN GENERATED LEGENDARY_ROUTE_MULT (tools/calibrate-f910.js legtable --write)', TABLE_END = '// END GENERATED LEGENDARY_ROUTE_MULT';
function tableSource(rows) {
    const lines = (key) => rows.map(r => `    ${r.id}: ${r[key]},`).join('\n');
    return [TABLE_BEGIN, '// E: encontros por hora medidos (janela de 10 h); m: multiplicador do peso dos restritos', 'const LEGENDARY_ROUTE_E = {', lines('E'), '};',
        'const LEGENDARY_ROUTE_MULT = {', lines('m'), '};', TABLE_END].join('\n');
}
function writeLegendaryTable() {
    const fs = require('fs'), file = path.join(__dirname, '..', 'js', 'game-config.js');
    let src = fs.readFileSync(file, 'utf8');
    const crlf = src.includes('\r\n');
    src = src.replace(/\r\n/g, '\n');
    const i = src.indexOf(TABLE_BEGIN), j = src.indexOf(TABLE_END);
    if (i < 0 || j < 0) throw new Error('marcadores da tabela não encontrados em js/game-config.js');
    const { rows } = buildLegendaryTable();
    src = src.slice(0, i) + tableSource(rows) + src.slice(j + TABLE_END.length);
    fs.writeFileSync(file, crlf ? src.replace(/\n/g, '\r\n') : src);
    return rows;
}

// Horas simuladas (Fast Driver, relógio simulado) até o 1º lendário/mítico ENCONTRADO na rota, com a equipe de teste no nível da rota
function hoursToLegendary(routeId, seed, capH = 120) {
    const route = routeById(routeId), level = Math.round((route.levelRange[0] + route.levelRange[1]) / 2);
    const game = farmer(level, routeId, seed);
    let found = null, encounters = 0;
    const make = game.createWildPokemon.bind(game);
    const t0 = game.now();
    game.createWildPokemon = (...a) => { const w = make(...a); encounters++; if (found === null && ctx.isLegendaryOrMythic(w.id)) found = game.now() - t0; return w; };
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    for (let h = 0; h < capH && found === null; h++) ctx.simulateHunt(game, HOUR);
    return { hours: found === null ? null : found / HOUR, encounters };
}
function measureLegendary(opts = {}) {
    const N = opts.n || 30, rows = [];
    for (const id of (opts.routes || AUDITED_ROUTES)) {
        const m = ctx.LEGENDARY_WEIGHT_ENABLED ? ctx.legendaryRouteMult(id) : 1;
        const r = routeById(id), tw = r.pokemon.reduce((a, p) => a + p.weight, 0);
        const leg = r.pokemon.filter(p => isRestricted(p.id)).reduce((a, p) => a + p.weight, 0);
        const hs = [];
        for (let i = 0; i < N; i++) { const x = hoursToLegendary(id, (opts.seed0 || 500) + i); hs.push(x.hours === null ? Infinity : x.hours); }
        const finite = hs.filter(Number.isFinite);
        rows.push({
            rota: id, pesoLendario: leg + '/' + tw, naturalPct: round(100 * leg / tw, 2), efetivoPct: round(100 * leg * m / (tw - leg + leg * m), 4),
            N, medianaHoras: round(median(hs), 1), minHoras: round(Math.min(...hs), 1), maxHoras: finite.length ? round(Math.max(...finite), 1) : null, semAchar: hs.length - finite.length,
        });
    }
    return rows;
}

// ---------- M3: bolas premium ----------
// Taxa de captura real (GameCore._ballCaptureAttempt) de uma espécie de BST 680 (Mewtwo) com só Poké Bolas, só Great ou só Ultra, N tentativas cada
function measurePremium(opts = {}) {
    const N = opts.n || 5000, species = 150, out = [];
    for (const ballId of ['pokeball', 'greatball', 'ultraball']) {
        setFlags({ BENEFITS_DEV_OVERRIDE: false });
        const { game } = createSimGame({ ctx, seed: 77, starterLevel: 30, start: false });
        let ok = 0;
        for (let i = 0; i < N; i++) {
            game.ensureInventory().balls = { [ballId]: 5 };
            const wild = game.createWildPokemon(species, 50, 1);        // shinyRate 1: sempre shiny (alvo premium)
            if (game._ballCaptureAttempt(wild).ok) ok++;
        }
        const ball = ctx.BALL_TYPES.find(b => b.id === ballId);
        out.push({ bola: ballId, alvo: 'Mewtwo (BST 680)', chanceTeorica: round(ctx.captureChance(ctx.speciesCatchRate(ctx.POKEMON_DATA[species]), ball), 4), N, capturaMedida: round(ok / N, 4) });
    }
    return out;
}

if (require.main === module) {
    const mode = process.argv[2] || 'economy', arg = process.argv[3] ? Number(process.argv[3]) : undefined;
    const all = mode === 'all';
    if (mode === 'economy' || all) { console.log('# M4/M5 economia'); console.table(measureEconomy()); }
    if (mode === 'balls' || all) { console.log('# M5 bolas (% do ouro, conjunto de rotas compatíveis)'); console.table(measureBallSets()); }
    if (mode === 'potion' || all) { console.log('# M4 poção (% do ouro, conjunto de rotas compatíveis)'); console.table(measurePotionSets()); }
    if (mode === 'shiny' || all) { console.log('# M1 shiny'); console.table(measureShiny({ n: arg })); }
    if (mode === 'legendary' || all) { console.log('# M2 lendários'); console.table(measureLegendary({ n: arg })); }
    if (mode === 'legtable') { if (process.argv.includes('--write')) writeLegendaryTable(); console.table(buildLegendaryTable().rows); }
    if (mode === 'legall') { console.log('# M2 todas as rotas com lendário'); console.table(measureLegendary({ n: arg, routes: buildLegendaryTable().rows.map(r => r.id) })); }
    if (mode === 'premium' || all) { console.log('# M3 bola premium'); console.table(measurePremium({ n: arg })); }
}

module.exports = { ctx, DATA, ROUTES, LEVELS, FARM_PARTY, PERFECT, MIN, HOUR, AUDITED_ROUTES, compatibleRoute, farmer, setFlags, measureEconomy, measureBallSets, measurePotionSets, compatibleSet, measureShiny, measureLegendary, measurePremium, hoursToLegendary, measureEncounterRate, buildLegendaryTable, legendaryRows, writeLegendaryTable, tableSource, LEGENDARY_TARGET_HOURS, routeLegendaryShare, SHINY_SCENARIOS, median, round, isRestricted };
