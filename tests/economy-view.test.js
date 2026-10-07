'use strict';
// Fase 6 · F6.7: Recursos / Loja / Upgrades / Análise dentro da aba Caça (DOM falso; layout fica no smoke)
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain } = require('./helpers/game');
const { makeFakeDom, makeUi } = require('./helpers/fake-dom');

function setup(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 3, storage: opts.storage, load: opts.load });
    const dom = makeFakeDom(g.ctx);
    const ui = makeUi(g.game);
    const view = new g.ctx.HuntView(ui);
    view.render();
    return { ...g, dom, ui, view };
}
const mkAgg = (o) => ({ ms: 60 * 60000, battles: 100, victories: 100, defeats: 0, xp: 1000, money: 100, captures: 5, shinies: 0, potions: 0, healCost: 0, qualitySum: 0, last: 1, ...o });

test('recursos: dinheiro e poções (com teto) aparecem no topo e acompanham o jogo', () => {
    const { dom, game, view } = setup();
    assert.match(dom.text('hunt-resources'), /💰 \$0/);
    assert.match(dom.text('hunt-resources'), /🧪 10 ?\/30/);
    game.earnMoney(1234, 'reward');
    view.renderLive();
    assert.match(dom.text('hunt-resources'), /\$1\.234/);
});

test('abrir cada seção renderiza só ela; as outras só quando abertas', () => {
    const { dom, view } = setup();
    assert.equal(dom.html('hunt-shop'), '');
    assert.equal(dom.html('hunt-upgrades'), '');
    view.showSection('shop');
    assert.match(dom.text('hunt-shop'), /Loja/);
    assert.equal(dom.html('hunt-upgrades'), '');
    view.showSection('upgrades');
    assert.match(dom.text('hunt-upgrades'), /Upgrades/);
    view.showSection('analysis');
    assert.match(dom.text('hunt-analysis'), /Análise/);
    view.showSection('inexistente');
    assert.equal(view.section, 'analysis');
});

test('loja: preço, efeito, estoque; comprar 1/5/10 pelo núcleo; sem dinheiro desabilitado; erros em português', () => {
    const { dom, game, view, ui } = setup();
    view.showSection('shop');
    let t = dom.text('hunt-shop');
    assert.match(t, /Poção/);
    assert.match(t, /Recupera 50% do HP/);
    assert.match(t, /Preço: \$40 cada/);
    assert.match(t, /Estoque: 10 ?\/30/);
    assert.match(dom.html('hunt-shop'), /data-qty="5" disabled/, 'sem dinheiro: desabilitado');
    game.earnMoney(1000, 'reward');
    view.renderSection();
    assert.doesNotMatch(dom.html('hunt-shop'), /data-qty="10" disabled/);
    view.eco.handleAction('buy-item', { item: 'potion', qty: '5' });
    assert.equal(game.getPotions(), 15);
    assert.equal(game.getMoney(), 800);
    assert.match(dom.text('hunt-resources'), /🧪 15 ?\/30/);
    assert.ok(ui.toasts.some(t => /\+5 poções por \$200/.test(t)), JSON.stringify(ui.toasts));
    view.eco.handleAction('buy-item', { item: 'potion', qty: '10' });
    view.eco.handleAction('buy-item', { item: 'potion', qty: '10' });
    assert.equal(game.getPotions(), 30);
    assert.match(dom.html('hunt-shop'), /cheio/);
    const n = ui.toasts.length;
    view.eco.handleAction('buy-item', { item: 'potion', qty: '1' });
    assert.equal(ui.toasts.length, n + 1);
    assert.match(ui.toasts.at(-1), /estoque de poções já está cheio/);
    view.eco.handleAction('buy-item', { item: 'bola', qty: '1' });
    assert.match(ui.toasts.at(-1), /Item desconhecido/);
});

test('upgrades: nível, efeito atual → próximo, custo claro ("gastar $X para ir de A para B"), requisitos', () => {
    const { dom, game, view, ui } = setup();
    view.showSection('upgrades');
    const t = dom.text('hunt-upgrades');
    for (const name of ['Eficiência de Cura', 'Capacidade de Poções', 'Velocidade de Caça', 'XP de Caça', 'Lucro de Caça']) assert.match(t, new RegExp(name));
    assert.match(t, /Gastar \$150 para ir de \+0% de cura para \+8% de cura/);
    assert.match(t, /Requer: Eficiência de Cura nv\. 2 \(você tem 0\)/);
    assert.match(t, /Build XP/);
    assert.match(t, /Apoio/);
    assert.match(dom.html('hunt-upgrades'), /data-id="heal_efficiency" disabled/);
    game.earnMoney(5000, 'reward');
    view.renderSection();
    view.eco.handleAction('buy-upgrade', { id: 'heal_efficiency' });
    assert.equal(game.getUpgradeLevel('heal_efficiency'), 1);
    assert.match(dom.text('hunt-upgrades'), /Nv\. 1 ?\/10 · \+8% de cura/);
    assert.match(dom.text('hunt-upgrades'), /Gastar \$218 para ir de \+8% de cura para \+16% de cura/);
    view.eco.handleAction('buy-upgrade', { id: 'hunt_speed' });
    assert.match(ui.toasts.at(-1), /ainda está bloqueado/);
    assert.equal(game.getUpgradeLevel('hunt_speed'), 0);
    view.eco.handleAction('buy-upgrade', { id: 'heal_efficiency' });
    assert.match(dom.text('hunt-upgrades'), /Requer/);
    game.gameState.upgrades.heal_efficiency = 10; game._invalidateModifiers();
    view.renderSection();
    assert.match(dom.text('hunt-upgrades'), /Nível máximo ✓/);
});

test('análise: objetivo (padrão XP), troca persiste e mexe na recomendação', () => {
    const { dom, game, view } = setup();
    view.showSection('analysis');
    assert.match(dom.html('hunt-analysis'), /data-goal="xp"/);
    assert.match(dom.html('hunt-analysis'), /hunt-seg active" data-eco-action="set-goal" data-goal="xp"/);
    view.eco.handleAction('set-goal', { goal: 'money' });
    assert.equal(game.getAnalyzerGoal(), 'money');
    assert.match(dom.html('hunt-analysis'), /hunt-seg active" data-eco-action="set-goal" data-goal="money"/);
    view.eco.handleAction('set-goal', { goal: 'hack' });
    assert.equal(game.getAnalyzerGoal(), 'money');
});

test('análise: métricas da caçada (XP/h, dinheiro/h, capturas/h, poções, custo de cura, lucro, vitórias)', () => {
    const { dom, game, view, ctx } = setup();
    const clock = new ctx.ManualClock(1_000_000);
    game.clock = clock;
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    game.stopBattle();
    view.showSection('analysis');
    assert.match(dom.text('hunt-analysis'), /Inicie uma caçada/);
    let xp = 0, gold = 0;
    for (let i = 0; i < 6; i++) { const r = game._processVictoryRewards(Object.assign(game.createWildPokemon(19, 4, 0), { isShiny: false }), 25, 100, 100); xp += r.expGained; gold += r.goldGained; }
    game.startBattle(); game.stopBattle();
    game.currentBattle.playerCurrentHp = 1;
    game.usePotion('automation');
    clock.advance(6 * 60000);
    view.renderSection();
    const t = dom.text('hunt-analysis');
    for (const label of ['XP/h', 'Dinheiro/h', 'Capturas/h', 'Shinies/h', 'Poções/h', 'Custo de cura/h', 'Lucro/h', 'Vitórias', 'Eficiência']) assert.match(t, new RegExp(label.replace('/', '\\/')), label);
    assert.match(t, new RegExp(`${(xp * 10).toLocaleString('pt-BR')} XP\\/h`), 'XP por hora = XP em 6 min × 10');
    assert.match(t, /10 Poções\/h/);
    assert.match(t, /100% Vitórias/);
});

test('análise com dados reais e estimados: etiquetas Real/Estimado, melhores, recomendação com ganho e aviso de risco', () => {
    const { dom, game, view } = setup();
    game.gameState.currentRoute = 'kanto_route1';
    const a = game.ensureAnalyzer();
    a.routes.kanto_route1 = mkAgg({ xp: 1100, money: 850, captures: 9 });
    a.routes.kanto_route2 = mkAgg({ xp: 1300, money: 620, captures: 5 });
    a.routes.kanto_route3 = mkAgg({ xp: 900, money: 3000, captures: 6, potions: 500, healCost: 20000, victories: 90, defeats: 10 });
    game.getCandidateRoutes = () => ['kanto_route1', 'kanto_route2', 'kanto_route3'];
    view.showSection('analysis');
    const html = dom.html('hunt-analysis');
    assert.match(html, /hunt-badge-src real">Real/);
    const t = dom.text('hunt-analysis');
    assert.match(t, /Melhor XP Rota 2/);
    assert.match(t, /Melhor dinheiro Rota 1/, 'rota 3 rende mais bruto, mas o lucro é negativo');
    assert.match(t, /Melhor captura Rota 1/);
    assert.match(t, /\+18% de XP\/h real em relação à rota atual/);
    assert.match(t, /O custo de cura passa do dinheiro/);
    assert.match(t, /Rota atual/);
    assert.equal(game.gameState.currentRoute, 'kanto_route1', 'mostrar a recomendação não troca a rota');
    view.eco.handleAction('use-route', { id: 'kanto_route2', risky: '0' });
    assert.equal(game.gameState.currentRoute, 'kanto_route2');
});

test('estimar rotas: fatiado, mostra progresso, marca "Estimado" e pode ser cancelado', async () => {
    const { dom, game, view } = setup();
    game.roster.primaryOf(25).level = 30;
    game.getCandidateRoutes = () => ['kanto_route1', 'kanto_route2'];
    view.showSection('analysis');
    assert.match(dom.text('hunt-analysis'), /Sem dados/);
    view.eco.handleAction('estimate', {});
    assert.match(dom.text('hunt-analysis'), /Estimando/);
    await new Promise(r => setTimeout(r, 400));
    assert.equal(view.eco._estimating, null);
    const html = dom.html('hunt-analysis');
    assert.equal((html.match(/hunt-badge-src est">Estimado/g) || []).length, 2);
    // cancelar no meio
    game.roster.primaryOf(25).level = 400;                     // invalida o cache
    view.eco.handleAction('estimate', {});
    view.onHide();
    assert.equal(view.eco._estimating, null);
    const doneBefore = Object.keys(game._routeEstimates.map || {}).length;
    await new Promise(r => setTimeout(r, 200));
    assert.ok(game._routeEstimates.map.size <= 2 && doneBefore !== undefined);
});

test('histórico: últimas caçadas com rota, duração, XP, dinheiro e capturas (limitado a 20)', () => {
    const { dom, game, view } = setup();
    game.gameState.badges.kanto = { unlocked: true };
    for (let i = 0; i < 3; i++) {
        game.dispatchAutomationAction({ type: 'START_HUNT' });
        game.stopBattle();
        game._processVictoryRewards(Object.assign(game.createWildPokemon(19, 4, 0), { isShiny: false }), 25, 100, 100);
        game.dispatchAutomationAction({ type: 'STOP_HUNT' });
    }
    view.showSection('analysis');
    const t = dom.text('hunt-analysis');
    assert.match(t, /Últimas caçadas/);
    assert.equal((dom.html('hunt-analysis').match(/<li>/g) || []).length, 3);
    assert.match(t, /Rota 1 · 00:00/);
    assert.match(t, /\+\d+ XP · \$\d+ · \d+ capturas?/);
});

test('Operação: com comparação em cache a recomendação segue o objetivo; sem ela, cai na recomendação por nível', () => {
    const { dom, game, view } = setup();
    assert.match(dom.text('hunt-route'), /Recomendação/);
    assert.match(dom.text('hunt-route'), /Estimar rotas|rota recomendada/);
    const a = game.ensureAnalyzer();
    a.routes.kanto_route1 = mkAgg({ xp: 1000 });
    a.routes.kanto_route2 = mkAgg({ xp: 1500 });
    game.getCandidateRoutes = () => ['kanto_route1', 'kanto_route2'];
    view.renderRoute();
    assert.match(dom.text('hunt-route'), /objetivo: XP/);
    assert.match(dom.text('hunt-route'), /\+50% de XP\/h real/);
});

test('análise abrir emite analyzer_opened (limitado); economia não assina eventos fora da aba', () => {
    const { game, view } = setup();
    const seen = [];
    game.bus.on('analyzer_opened', (e) => seen.push(e));
    view.showSection('analysis'); view.showSection('shop'); view.showSection('analysis');
    assert.equal(seen.length, 1);
    assert.equal(game.bus.hasListeners(), true);
    view.onHide();
});

test('abrir seções não altera dinheiro, upgrades nem estoque', () => {
    const { game, view } = setup();
    const before = JSON.stringify([game.gameState.gold, game.gameState.upgrades, game.gameState.inventory]);
    for (const sct of ['shop', 'upgrades', 'analysis', 'ops']) view.showSection(sct);
    assert.equal(JSON.stringify([game.gameState.gold, game.gameState.upgrades, game.gameState.inventory]), before);
});
