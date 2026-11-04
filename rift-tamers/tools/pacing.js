// Simula um jogador idle "razoável": escolhe o inicial, joga em blocos de 10 min (offline por simulação real),
// compra melhorias baratas, põe as 3 criaturas mais fortes na equipe e faz o Colapso quando ele rende 2× os Estilhaços atuais.
import { Game, newState, UPGRADES, PERK_DEFS, upgradeCost, power, fmt } from '../src/game.js';
const hours = Number(process.argv[2] || 12), seed = process.argv[3] || 'pace';
const game = new Game(newState(seed));
game.chooseStarter(0);
const t0 = Date.now(); game.s.lastTick = t0;
function shop() {
    let bought = true, n = 0;
    while (bought && n++ < 500) {
        bought = false;
        const opts = UPGRADES.filter(u => game.up(u.id) < u.max && (u.id !== 'lure' || game.up('train') > 10)).map(u => ({ u, c: upgradeCost(u, game.up(u.id)) })).sort((a, b) => a.c - b.c);
        if (opts.length && game.s.essence >= opts[0].c) { game.buyUpgrade(opts[0].u.id); bought = true; }
        const p = PERK_DEFS.filter(u => game.perk(u.id) < u.max).map(u => ({ u, c: upgradeCost(u, game.perk(u.id)) })).sort((a, b) => a.c - b.c);
        if (p.length && game.s.shards >= p[0].c) { game.buyPerk(p[0].u.id); bought = true; }
    }
    if (game.s.orbs < 10) game.buyOrbs(Math.min(20, Math.floor(game.s.essence * 0.2 / game.orbPrice())));
    const best = [...game.s.creatures].sort((a, b) => power(b) - power(a)).slice(0, game.teamSize()).map(c => c.id);
    game.setTeam(best);
}
let lastCollapse = 0;
for (let m = 10; m <= hours * 60; m += 10) {
    game.runOffline(600);
    game.s.lastTick += 600000;
    shop();
    const reward = game.collapseReward();
    if (reward >= Math.max(3, game.s.shards * 1.0) && m - lastCollapse >= 60) { game.collapse(); lastCollapse = m; }
    if (m % 60 === 0) console.log(`h${String(m / 60).padStart(3)} stage ${String(game.s.stage).padStart(4)} max ${String(game.s.maxStage).padStart(4)} ever ${String(game.s.maxStageEver).padStart(4)} ess ${fmt(game.s.essence).padStart(6)} lv ${game.teamGenomes().map(g => g.level).join('/')} crit ${game.s.creatures.length} dex ${game.dexCount()} shards ${game.s.shards} coll ${game.s.stats.collapses} prism ${game.s.stats.prismatics} up ${game.up('train')}/${game.up('vital')}`);
}
