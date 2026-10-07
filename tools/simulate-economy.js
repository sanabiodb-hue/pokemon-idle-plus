'use strict';
// Simulador econômico (fase 6): "onde está um jogador depois de X horas?" e "qual build rende mais?".
//   node tools/simulate-economy.js                     # tabelas completas (3 perfis × 4 builds, até 7 dias)
//   node tools/simulate-economy.js --quick             # versão curta (usada nos testes)
//   node tools/simulate-economy.js --json              # saída em JSON
//   node tools/simulate-economy.js --profile=new --build=xp --days=1
// O jogador-robô só usa a API pública do núcleo (comprar poções/upgrades, escolher rota por objetivo, iniciar caça):
// nenhuma regra econômica é reimplementada aqui. Tempo = SimulationClock; sem timers reais, sem save.
const { createSimGame, getContext } = require('./automation-sim');

const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const HORIZONS = [['10 min', 10 * MIN], ['1 h', HOUR], ['4 h', 4 * HOUR], ['8 h', 8 * HOUR], ['24 h', DAY], ['7 dias', 7 * DAY]];
const BUILDS = {
    none: { label: 'Sem upgrades', target: null, goal: 'xp' },
    xp: { label: 'Build XP', target: 'hunt_xp', goal: 'xp' },
    money: { label: 'Build $', target: 'hunt_profit', goal: 'money' },
    speed: { label: 'Build Speed', target: 'hunt_speed', goal: 'xp' },
};

// Perfis iniciais (regions = dex completa dessas regiões, o que libera a região seguinte): equipe, regiões liberadas, upgrades já comprados e dinheiro
const PROFILES = {
    new: { label: 'Novo jogador', starterLevel: 5, party: [], regions: [], upgrades: {}, money: 0, badge: false },
    intermediate: {
        label: 'Intermediário', starterLevel: 60, regions: ['kanto'], money: 20000, badge: true,
        party: [{ speciesId: 6, level: 60 }, { speciesId: 9, level: 55 }, { speciesId: 65, level: 58 }, { speciesId: 130, level: 52 }],
        upgrades: { heal_efficiency: 3, potion_capacity: 3, hunt_xp: 2 },
    },
    advanced: {
        label: 'Avançado', starterLevel: 900, regions: ['kanto', 'johto', 'hoenn'], money: 500000, badge: true,
        party: [{ speciesId: 6, level: 950 }, { speciesId: 9, level: 900 }, { speciesId: 149, level: 920 }, { speciesId: 130, level: 880 }, { speciesId: 143, level: 870 }],
        upgrades: { heal_efficiency: 6, potion_capacity: 6, hunt_xp: 6, hunt_speed: 4, hunt_profit: 4 },
    },
};

function unlockRegions(game, ctx, regions) {
    for (const key of regions) {
        const range = ctx.REGION_POKEDEX_RANGES[key];
        for (let id = range[0]; id <= range[1]; id++) if (!game.gameState.pokedex[id]) game.gameState.pokedex[id] = 'caught';
    }
}

// Cria o jogador (jogo sem cabeça) já no estado do perfil
function createPlayer(profileKey, buildKey, opts = {}) {
    const profile = PROFILES[profileKey];
    const build = BUILDS[buildKey];
    const ctx = opts.ctx || getContext();
    const { game } = createSimGame({
        ctx, seed: opts.seed ?? 1, starterLevel: profile.starterLevel, party: profile.party, start: false,
        policy: { heal: { enabled: true, whenHpBelowPercent: 30 } }, shinyRate: opts.shinyRate,
    });
    if (opts.econCfg) game.econCfg = opts.econCfg;
    game._simMode = true;
    if (profile.badge) game.gameState.badges.kanto = { unlocked: true, gem: null };
    unlockRegions(game, ctx, profile.regions);
    game.gameState.upgrades = { ...profile.upgrades };
    game._invalidateModifiers();
    game.gameState.gold = 0;
    game.gameState.economy = { earned: 0, spent: 0, byReason: {} };
    if (profile.money > 0) game.earnMoney(profile.money, 'reward');
    game.gameState.inventory.potions = Math.min(10, game.getPotionCapacity());
    return { game, ctx, profile, build, profileKey, buildKey };
}

// ---------- jogador-robô ----------
function chooseUpgrade(game, build) {
    if (!build.target) return null;
    // caminho até o alvo: primeiro os requisitos que faltam, depois o próprio alvo; com o alvo no máximo, os de apoio
    const path = [];
    const visit = (id) => {
        const missing = game.getUpgradeMissing(id);
        for (const r of missing) visit(r.id);
        path.push(id);
    };
    visit(build.target);
    for (const id of path) {
        const cost = game.getUpgradeCost(id);
        if (cost === null) continue;
        if (game.getUpgradeMissing(id).length) continue;
        return id;
    }
    for (const u of game.getUpgradeCatalog()) if (!u.maxed && !u.locked && u.build === 'support') return u.id;
    return null;
}

function runPlayer(profileKey, buildKey, opts = {}) {
    const p = createPlayer(profileKey, buildKey, opts);
    const { game, ctx, build } = p;
    const horizons = opts.horizons || HORIZONS;
    const total = Math.max(...horizons.map(h => h[1]));
    const tickMs = opts.tickMs || (total > 2 * DAY ? 15 * MIN : 5 * MIN);
    const routeEveryMs = opts.routeEveryMs || (total > 2 * DAY ? 6 * HOUR : HOUR);
    const t0 = game.now();
    const log = { firstPurchaseMs: null, secondUpgradeMs: null, unlockMs: {}, potionsBought: 0, potionSpend: 0, upgradeSpend: 0, upgradesBought: 0, stoppedMs: 0 };
    game.bus.on('upgrade_purchased', () => {
        log.upgradesBought++;
        const t = game.now() - t0;
        if (log.firstPurchaseMs === null) log.firstPurchaseMs = t;
        if (log.upgradesBought === 2) log.secondUpgradeMs = t;
    });
    game.bus.on('potion_bought', (e) => { log.potionsBought += e.qty; log.potionSpend += e.total; });
    game.bus.on('money_spent', (e) => { if (e.reason === 'upgrade_purchase') log.upgradeSpend += e.amount; });

    let potionsPerTick = 3;
    let lastRouteEval = -Infinity;
    const snapshots = [];
    const series = [];                                    // (hora, xp acumulado) para achar cruzamentos
    let nextHorizon = 0;
    let elapsed = 0;
    let xpStart = game.gameState.stats.totalExp;
    const potionUsedTotal = () => game.getHuntSession() ? 0 : 0;
    let potionsUsed = 0, battles = 0, captures = 0, shinies = 0, healFallbackTicks = 0;

    const checkUnlocks = () => {
        for (const u of game.getUpgradeCatalog()) if (!u.locked && log.unlockMs[u.id] === undefined) log.unlockMs[u.id] = game.now() - t0;
    };
    checkUnlocks();

    const manage = () => {
        // 1) estoque de poções: o suficiente para o próximo intervalo
        const wanted = Math.min(game.getPotionCapacity(), Math.ceil(potionsPerTick * 1.5) + 2);
        const missing = wanted - game.getPotions();
        if (missing > 0) {
            const price = game.getPotionPrice();
            const afford = Math.min(missing, Math.floor(game.getMoney() / price));
            if (afford > 0) game.buyPotions(afford);
        }
        // 2) upgrades (só o alvo da build e seus requisitos)
        for (let guard = 0; guard < 20; guard++) {
            const id = chooseUpgrade(game, build);
            if (!id) break;
            const cost = game.getUpgradeCost(id);
            // não deixa o jogador sem dinheiro para repor poções
            const reserve = game.getPotionPrice() * Math.ceil(potionsPerTick);
            if (game.getMoney() - cost < reserve) break;
            if (!game.buyUpgrade(id).ok) break;
            checkUnlocks();
        }
        // 3) rota por objetivo (a cada routeEveryMs)
        if (elapsed - lastRouteEval >= routeEveryMs) {
            lastRouteEval = elapsed;
            const cmp = game.compareRoutes();
            const rec = game.recommendRouteForGoal(build.goal, cmp);
            if (rec && !rec.none) game.selectHuntRoute(rec.routeId, 'recommended');
        }
        // 4) sem poções e sem dinheiro: segue sem cura automática (como um jogador faria)
        const pol = game.getAutomationPolicy();
        const canHeal = game.getPotions() > 0;
        if (pol.heal.enabled !== canHeal) {
            const next = JSON.parse(JSON.stringify(pol));
            next.heal.enabled = canHeal;
            game.setAutomationPolicy(next);
            if (!canHeal) healFallbackTicks++;
        }
        const s = game.getHuntSession();
        if (!s || s.state !== 'running') game.dispatchAutomationAction({ type: 'START_HUNT' });
    };

    const snapshot = (label, ms) => {
        const eco = game.gameState.economy;
        snapshots.push({
            label, ms,
            moneyEarned: eco.earned, moneyNow: game.getMoney(), moneySpent: eco.spent,
            xp: game.gameState.stats.totalExp - xpStart,
            captures, shinies, battles,
            potionsUsed, potionsBought: log.potionsBought,
            potionSpend: log.potionSpend, upgradeSpend: log.upgradeSpend,
            upgrades: log.upgradesBought, levels: { ...(game.gameState.upgrades || {}) },
            route: game.gameState.currentRoute,
            potionPrice: game.getPotionPrice(),
            effectivePotionCost: potionsUsed > 0 ? Math.round(log.potionSpend / potionsUsed) : null,
            stoppedMs: log.stoppedMs, healOffTicks: healFallbackTicks,
            hourlyXp: 0, hourlyProfit: 0,
        });
    };

    let lastSnapXp = 0, lastSnapMoney = 0;
    while (elapsed < total) {
        manage();
        const step = Math.min(tickMs, total - elapsed);
        const before = game.getHuntSession() ? { ...game.getHuntSession().stats } : null;
        const r = ctx.simulateHunt(game, step);
        if (!r.ok) break;
        const s = game.getHuntSession();
        const used = r.potionsUsed;
        potionsUsed += used; battles += r.battles; captures += r.captures; shinies += r.shinies;
        potionsPerTick = Math.max(1, 0.5 * potionsPerTick + 0.5 * used);
        if (r.simulatedMs < step) {
            log.stoppedMs += step - r.simulatedMs;
            game.clock.advance(step - r.simulatedMs);                  // parada no meio do intervalo: o tempo restante passa parado
        }
        elapsed += step;
        void before; void s; void potionUsedTotal;
        series.push([elapsed / HOUR, game.gameState.stats.totalExp - xpStart]);
        while (nextHorizon < horizons.length && elapsed >= horizons[nextHorizon][1] - 1) {
            snapshot(horizons[nextHorizon][0], horizons[nextHorizon][1]);
            const sn = snapshots[snapshots.length - 1];
            sn.hourlyXp = (sn.xp - lastSnapXp);
            lastSnapXp = sn.xp;
            sn.hourlyProfit = sn.moneyEarned - lastSnapMoney;
            lastSnapMoney = sn.moneyEarned;
            nextHorizon++;
        }
    }
    return { profile: p.profileKey, build: p.buildKey, snapshots, log, series };
}

// ---------- comparação de builds ----------
function compareBuilds(profileKey, opts = {}) {
    const keys = opts.builds || Object.keys(BUILDS);
    const runs = {};
    for (const b of keys) runs[b] = runPlayer(profileKey, b, opts);
    const horizons = opts.horizons || HORIZONS;
    const winners = horizons.map(([label], i) => {
        const row = { label };
        for (const metric of ['xp', 'moneyEarned']) {
            let best = null;
            for (const b of keys) {
                const sn = runs[b].snapshots[i];
                if (sn && (!best || sn[metric] > best.value)) best = { build: b, value: sn[metric] };
            }
            row[metric] = best;
        }
        return row;
    });
    // quando cada build passa a "Sem upgrades" em XP acumulado
    const crossings = {};
    for (const b of keys) {
        if (b === 'none' || !runs.none) continue;
        const base = runs.none.series;
        let when = null;
        for (let i = 0; i < runs[b].series.length && i < base.length; i++) {
            if (runs[b].series[i][1] > base[i][1] * 1.02) { when = runs[b].series[i][0]; break; }
        }
        crossings[b] = when;
    }
    return { profile: profileKey, runs, winners, crossings };
}

// ---------- apresentação ----------
const fmt = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('pt-BR'));
const short = (n) => {
    if (n === null || n === undefined) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(1) + 'T';
    if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
};
const dur = (ms) => (ms === null || ms === undefined ? '—' : ms < HOUR ? Math.round(ms / MIN) + ' min' : (ms / HOUR).toFixed(1) + ' h');

function printComparison(cmp) {
    const keys = Object.keys(cmp.runs);
    console.log(`\n=== ${PROFILES[cmp.profile].label} ===`);
    console.log('Horizonte | Build        | Moedas ganhas | Saldo   | XP        | Poções (usadas/compradas) | Upgrades | Rota');
    const n = cmp.runs[keys[0]].snapshots.length;
    for (let i = 0; i < n; i++) {
        for (const b of keys) {
            const sn = cmp.runs[b].snapshots[i];
            if (!sn) continue;
            console.log(`${sn.label.padEnd(9)} | ${BUILDS[b].label.padEnd(12)} | ${short(sn.moneyEarned).padStart(13)} | ${short(sn.moneyNow).padStart(7)} | ${short(sn.xp).padStart(9)} | ${(short(sn.potionsUsed) + '/' + short(sn.potionsBought)).padStart(25)} | ${String(sn.upgrades).padStart(8)} | ${sn.route}`);
        }
    }
    console.log('\nMelhor por horizonte (XP | moedas):');
    for (const w of cmp.winners) console.log(`  ${w.label.padEnd(8)} XP: ${w.xp ? BUILDS[w.xp.build].label : '—'} | Moedas: ${w.moneyEarned ? BUILDS[w.moneyEarned.build].label : '—'}`);
    console.log('\nTempos: ');
    for (const b of keys) {
        const l = cmp.runs[b].log;
        console.log(`  ${BUILDS[b].label.padEnd(12)} 1ª compra: ${dur(l.firstPurchaseMs)} | 2º upgrade: ${dur(l.secondUpgradeMs)} | passa "sem upgrades" em XP: ${cmp.crossings[b] === undefined ? '—' : cmp.crossings[b] === null ? 'nunca' : cmp.crossings[b].toFixed(1) + ' h'} | parado sem poções: ${dur(l.stoppedMs)}`);
    }
    const last = cmp.runs[keys[0]].snapshots.at(-1);
    if (last) console.log(`  Custo efetivo da poção (gasto ÷ usadas): ${keys.map(b => BUILDS[b].label + ' ' + fmt(cmp.runs[b].snapshots.at(-1).effectivePotionCost)).join(' | ')}`);
    console.log('  Desbloqueios (quando o requisito foi cumprido):', keys.filter(b => b !== 'none').map(b => BUILDS[b].label + ': ' + Object.entries(cmp.runs[b].log.unlockMs).map(([id, t]) => id.replace('hunt_', '').replace('_efficiency', '').replace('potion_', 'pot_') + '=' + dur(t)).join(', ')).join(' || '));
}

function runAll(opts = {}) {
    const profiles = opts.profiles || Object.keys(PROFILES);
    const out = {};
    for (const p of profiles) out[p] = compareBuilds(p, opts);
    return out;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const arg = (name) => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; };
    const opts = {};
    if (args.includes('--quick')) opts.horizons = HORIZONS.slice(0, 4);
    if (arg('days')) opts.horizons = HORIZONS.filter(h => h[1] <= Number(arg('days')) * DAY);
    if (arg('profile')) opts.profiles = arg('profile').split(',');
    if (arg('build')) opts.builds = ['none'].concat(arg('build').split(','));
    const res = runAll(opts);
    if (args.includes('--json')) console.log(JSON.stringify(res, (k, v) => (k === 'series' ? undefined : v), 2));
    else for (const p of Object.keys(res)) printComparison(res[p]);
}

module.exports = { PROFILES, BUILDS, HORIZONS, createPlayer, runPlayer, compareBuilds, runAll, printComparison };
