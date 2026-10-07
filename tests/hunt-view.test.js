'use strict';
// Fase 5A · B10: aba Caça (lógica da view com DOM falso; layout/mobile ficam no smoke com Chromium)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newGame, ivs, plain } = require('./helpers/game');
const { makeFakeDom, fakeEl, makeUi } = require('./helpers/fake-dom');

function setup(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 3, storage: opts.storage, load: opts.load });
    const dom = makeFakeDom(g.ctx);
    const ui = makeUi(g.game);
    const view = new g.ctx.HuntView(ui);
    view.render();
    return { ...g, dom, ui, view };
}
const settingChange = (path, kind, extra) => fakeEl({ huntPolicy: path, kind }, extra);

test('aba Caça: abrir mostra status, rota, equipe e todas as configurações em português', () => {
    const { dom, game } = setup();
    const status = dom.text('hunt-status');
    assert.match(status, /Parada/);
    assert.match(status, /INICIAR CAÇA/);
    for (const label of ['Tempo', 'Batalhas', 'Vitórias', 'Capturas', 'Shinies', 'EXP ganha', 'Poções usadas', 'Dinheiro ganho', 'Eficiência']) assert.match(status, new RegExp(label), label);
    assert.match(status, /Poções disponíveis: 10/);
    const route = dom.text('hunt-route');
    assert.match(route, /Rota atual/);
    assert.match(route, /Nível dos inimigos: 1–5/);
    assert.match(route, /Progresso: \d+\/\d+ capturadas/);
    assert.match(route, /Recomendação/);
    assert.match(route, /Espécies encontradas/);
    const team = dom.text('hunt-team');
    assert.match(team, /Equipe na caça \(1\/6\)/);
    assert.match(team, /#1 Pikachu/);
    assert.match(team, /Em campo/);
    assert.match(team, /Nv\. 5/);
    assert.match(team, /Nota [SABCD]/);
    const cfg = dom.text('hunt-settings');
    for (const label of ['Captura', 'Capturar', 'Qualidade mínima', 'Capturar Shiny sempre', 'Capturar espécie nova', 'Espécies prioritárias', 'Cura', 'Poções: 10', 'Cura automática', 'Curar quando HP <', 'Sem poções', 'Parar', 'Quando completar a rota', 'Continuar', 'Trocar de rota', 'Condições de parada', 'Parar ao encontrar Shiny', 'Parar após', 'batalhas', 'minutos', 'Parar quando a rota estiver completa']) assert.match(cfg, new RegExp(label.replace(/[<.]/g, '\\$&')), label);
    assert.match(dom.html('hunt-settings'), /<option value="rest" disabled>Descansar \(em breve\)/);
    assert.equal(game.getHuntSession(), null, 'abrir a aba não inicia nada');
});

test('espécies da rota: nomes só para as conhecidas; prioridade aparece como estrela', () => {
    const { dom, game, view } = setup();
    game.gameState.pokedex[19] = 'seen';
    view.render();
    const html = dom.html('hunt-route');
    assert.match(html, /Rattata/);
    assert.match(html, /\?\?\?/);
    view.handleAction('toggle-target', { id: '19' });
    assert.equal(game.getAutomationPolicy().target.type, 'species');
    assert.deepEqual(plain(game.getAutomationPolicy().target.speciesIds), [19]);
    assert.match(dom.html('hunt-route'), /hunt-chip prio/);
    assert.match(dom.text('hunt-settings'), /Rattata ✕/);
    view.handleAction('remove-target', { id: '19' });
    assert.equal(game.getAutomationPolicy().target.type, 'any');
    assert.match(dom.text('hunt-settings'), /Nenhuma/);
});

test('iniciar → pausar → retomar → parar: estados, botões e mensagens', () => {
    const { dom, game, view, ui } = setup();
    view.handleAction('start', {});
    assert.equal(game.isHuntRunning(), true);
    assert.match(dom.text('hunt-status'), /Caçando/);
    assert.match(dom.html('hunt-status'), /🟢/);
    assert.match(dom.text('hunt-status'), /PAUSAR/);
    assert.match(dom.text('hunt-status'), /PARAR/);
    assert.doesNotMatch(dom.text('hunt-status'), /INICIAR/);
    assert.ok(ui.toasts.some(t => /Caçada iniciada/.test(t)));
    view.handleAction('pause', {});
    assert.match(dom.html('hunt-status'), /🟡/);
    assert.match(dom.text('hunt-status'), /Pausada/);
    assert.match(dom.text('hunt-status'), /RETOMAR/);
    assert.match(dom.text('hunt-status'), /continua batalhando/);
    view.handleAction('resume', {});
    assert.match(dom.text('hunt-status'), /Caçando/);
    game.stopBattle();
    view.handleAction('stop', {});
    assert.match(dom.html('hunt-status'), /⚪/);
    assert.match(dom.text('hunt-status'), /Caça encerrada Motivo: encerrada por você/);
    assert.match(dom.text('hunt-status'), /INICIAR CAÇA/);
    view.handleAction('start', {});
    assert.equal(game.isHuntRunning(), true, 'dá para iniciar de novo');
    game.stopBattle();
});

test('parada por condição: 🔴, "Caça encerrada" e o motivo legível (sem poções, shiny, limite)', () => {
    const cases = [
        [{ reason: 'no_potions', policy: {} }, /Motivo: sem poções/, /Caça interrompida: sem poções\./],
        [{ reason: 'shiny_found', policy: {} }, /Motivo: Shiny encontrado/, /Shiny encontrado/],
        [{ reason: 'battle_limit', policy: { stopConditions: { battleLimit: 100 } } }, /Motivo: limite de 100 batalhas atingido/, /limite de 100 batalhas/],
        [{ reason: 'route_complete', policy: {} }, /Motivo: rota concluída/, /rota concluída/],
    ];
    for (const [c, noticeRe, toastRe] of cases) {
        const { dom, game, view, ui } = setup();
        game.setAutomationPolicy(c.policy);
        game.dispatchAutomationAction({ type: 'START_HUNT' });
        game.stopBattle();
        game.dispatchAutomationAction({ type: 'STOP_HUNT', reason: c.reason });
        view.render();
        assert.match(dom.html('hunt-status'), /🔴/);
        assert.match(dom.text('hunt-status'), /Parada por condição/);
        assert.match(dom.text('hunt-status'), /Caça encerrada/);
        assert.match(dom.text('hunt-status'), noticeRe);
        game.onHuntEvent = (k, d) => view.onHuntEvent(k, d);
    }
    // o aviso (toast + log) vem do núcleo via onHuntEvent
    const { game, view, ui } = setup();
    game.onHuntEvent = (k, d) => view.onHuntEvent(k, d);
    game.gameState.inventory.potions = 0;
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    game.stopBattle(); game.startBattle(); game.stopBattle();
    game.currentBattle.playerCurrentHp = 1;
    game._checkLowHp(game.currentBattle, true);
    assert.ok(ui.toasts.some(t => /Caça interrompida: sem poções\./.test(t)), JSON.stringify(ui.toasts));
    assert.ok(ui.logs.some(([m]) => /sem poções/.test(m)));
});

test('estatísticas na tela refletem a sessão (batalhas, capturas, EXP, poções usadas, eficiência)', () => {
    const { dom, game, view } = setup();
    view.handleAction('start', {});
    game.stopBattle();
    const s = game.getHuntSession();
    for (let i = 0; i < 4; i++) game._processVictoryRewards(game.createWildPokemon(19, 3, 0), 25, 100, 100);
    s.stats.healingSpent = 2;
    view.renderLive();
    const t = dom.text('hunt-status');
    assert.match(t, new RegExp(`${s.stats.battles} Batalhas`));
    assert.match(t, new RegExp(`${s.stats.victories} Vitórias`));
    assert.match(t, /Capturas/);
    assert.match(t, new RegExp(`${s.stats.xp.toLocaleString('pt-BR')} EXP ganha`));
    assert.match(t, /2 Poções usadas/);
    assert.match(t, /EXP\/h Eficiência/);
});

test('configurar política pela interface: captura, qualidade, shiny, espécie nova, cura, condições', () => {
    const { game, view } = setup();
    const p = () => game.getAutomationPolicy();
    view.handleChange(settingChange('capture.enabled', 'bool', { checked: false }));
    assert.equal(p().capture.enabled, false);
    view.handleChange(settingChange('capture.enabled', 'bool', { checked: true }));
    view.handleChange(settingChange('capture.minQualityPercent', 'int', { value: '65' }));
    assert.equal(p().capture.minQualityPercent, 65);
    view.handleChange(settingChange('capture.alwaysShiny', 'bool', { checked: false }));
    view.handleChange(settingChange('capture.alwaysNewSpecies', 'bool', { checked: false }));
    assert.equal(p().capture.alwaysShiny, false);
    assert.equal(p().capture.alwaysNewSpecies, false);
    view.handleChange(settingChange('heal.enabled', 'bool', { checked: false }));
    view.handleChange(settingChange('heal.whenHpBelowPercent', 'int', { value: '45' }));
    assert.equal(p().heal.enabled, false);
    assert.equal(p().heal.whenHpBelowPercent, 45);
    view.handleChange(settingChange('stopConditions.shinyFound', 'bool', { checked: true }));
    assert.equal(p().stopConditions.shinyFound, true);
    view.handleChange(fakeEl({ huntLimit: 'battleLimit' }, { checked: true }));
    assert.equal(p().stopConditions.battleLimit, 100, 'valor padrão ao marcar');
    view.handleChange(settingChange('stopConditions.battleLimit', 'int', { value: '250' }));
    assert.equal(p().stopConditions.battleLimit, 250);
    view.handleChange(fakeEl({ huntLimit: 'battleLimit' }, { checked: false }));
    assert.equal(p().stopConditions.battleLimit, 0);
    view.handleChange(fakeEl({ huntLimit: 'battleLimit' }, { checked: true }));
    assert.equal(p().stopConditions.battleLimit, 250, 'lembra o último valor');
    view.handleChange(fakeEl({ huntLimit: 'timeLimitMinutes' }, { checked: true }));
    assert.equal(p().stopConditions.timeLimitMinutes, 60);
});

test('quando completar a rota: Continuar / Trocar de rota / Parar, ligados à condição "rota completa"', () => {
    const { game, view, dom } = setup();
    const mode = (value) => view.handleChange(fakeEl({ huntRouteMode: '' }, { value }));
    mode('switchWhenComplete');
    assert.equal(game.getAutomationPolicy().route.mode, 'switchWhenComplete');
    assert.match(dom.html('hunt-settings'), /value="switchWhenComplete" checked/);
    mode('stopWhenComplete');
    assert.equal(game.getAutomationPolicy().route.mode, 'stopWhenComplete');
    assert.equal(game.getAutomationPolicy().stopConditions.routeComplete, true);
    assert.match(dom.html('hunt-settings'), /data-hunt-complete-stop checked/);
    view.handleChange(fakeEl({ huntCompleteStop: '' }, { checked: false }));
    assert.equal(game.getAutomationPolicy().route.mode, 'stay');
    assert.equal(game.getAutomationPolicy().stopConditions.routeComplete, false);
    view.handleChange(fakeEl({ huntCompleteStop: '' }, { checked: true }));
    assert.equal(game.getAutomationPolicy().route.mode, 'stopWhenComplete');
});

test('valor inválido não altera a política: avisa e redesenha com o valor antigo', () => {
    const { game, view, ui, dom } = setup();
    view.handleChange(settingChange('heal.whenHpBelowPercent', 'int', { value: '500' }));
    assert.equal(game.getAutomationPolicy().heal.whenHpBelowPercent, 30);
    assert.ok(ui.toasts.some(t => /entre 1% e 99%/.test(t)));
    assert.match(dom.html('hunt-settings'), /value="30"/);
    assert.equal(game.isAutomationConfigured(), false, 'nada foi salvo');
});

test('mudar a política com a caçada rodando vale na hora (ao vivo)', () => {
    const { game, view } = setup();
    view.handleAction('start', {});
    game.stopBattle();
    view.handleChange(settingChange('capture.minQualityPercent', 'int', { value: '95' }));
    const weak = () => Object.assign(game.createWildPokemon(16, 3, 0), { ivs: ivs(2), isShiny: false });
    assert.equal(game.decideCapture(weak()).reason, 'new_species', 'espécie nova entra mesmo com qualidade baixa');
    game.gameState.caughtPokemon[16] = { ivs: ivs(2) };
    assert.equal(game.decideCapture(Object.assign(game.createWildPokemon(16, 3, 0), { ivs: ivs(2), isShiny: false })).capture, false);
});

test('selecionar rota: sem caçada, com caçada rodando, pausada, inválida e bloqueada', () => {
    const { game, view, ui, ctx } = setup();
    const pick = (value) => view.handleChange(fakeEl({ huntRoute: '' }, { value }));
    pick('kanto_route2');
    assert.equal(game.gameState.currentRoute, 'kanto_route2');
    view.handleAction('start', {});
    game.stopBattle();
    pick('kanto_route1');
    assert.equal(game.gameState.currentRoute, 'kanto_route1');
    assert.equal(game.getHuntSession().routeId, 'kanto_route1');
    view.handleAction('pause', {});
    pick('kanto_route2');
    assert.equal(game.getHuntSession().routeId, 'kanto_route2');
    const before = ui.toasts.length;
    pick('nao_existe');
    pick(ctx.REGIONS.johto.routes[0].id);
    assert.equal(game.gameState.currentRoute, 'kanto_route2');
    assert.equal(ui.toasts.length, before + 2);
    assert.ok(ui.toasts.slice(-2).every(t => t.startsWith('⚠️')));
});

test('recomendação de rota aparece e "Usar" aplica pelo núcleo', () => {
    const { game, view, dom } = setup();
    game.gameState.currentRoute = 'kanto_route2';
    view.render();
    const html = dom.html('hunt-route');
    const m = /data-hunt-action="use-recommended" data-id="([^"]+)"/.exec(html);
    if (m) {
        view.handleAction('use-recommended', { id: m[1] });
        assert.equal(game.gameState.currentRoute, m[1]);
        assert.match(dom.text('hunt-route'), /esta é a rota recomendada/);
    } else {
        assert.match(dom.text('hunt-route'), /esta é a rota recomendada/);
    }
});

test('equipe: usa a party do roster (sem segunda implementação), mostra posição, nível, nota, shiny e HP do ativo', () => {
    const { game, view, dom } = setup();
    game.catchPokemonWithIvs(16, 1, ivs(31));
    game.roster.primaryOf(16).shiny = true;
    game.addToTeamFromPokedex(16);
    game.startBattle(); game.stopBattle();
    view.renderTeam();
    const t = dom.text('hunt-team');
    assert.match(t, /Equipe na caça \(2\/6\)/);
    assert.match(t, /#1 Pikachu/);
    assert.match(t, /#2 Pidgey ✨/);
    assert.match(t, /Nota S \(100%\)/);
    assert.match(t, /Reserva/);
    assert.match(t, /\d+\/\d+/, 'HP do ativo');
    view.handleAction('manage-team', {});
    assert.deepEqual(view.ui.switched, ['tab-pc']);
});

test('configuração persiste: salvar/carregar e reabrir a aba mostra os mesmos valores; sessão volta pausada', () => {
    const a = setup({ seed: 5 });
    a.view.handleChange(settingChange('capture.minQualityPercent', 'int', { value: '70' }));
    a.view.handleChange(settingChange('capture.alwaysShiny', 'bool', { checked: false }));
    a.view.handleChange(settingChange('heal.whenHpBelowPercent', 'int', { value: '55' }));
    a.view.handleChange(fakeEl({ huntRouteMode: '' }, { value: 'switchWhenComplete' }));
    a.view.handleChange(fakeEl({ huntLimit: 'timeLimitMinutes' }, { checked: true }));
    a.view.handleAction('start', {});
    a.game.stopBattle();
    a.game.saveNow();
    const b = setup({ storage: a.storage, load: true });
    const html = b.dom.html('hunt-settings');
    assert.match(html, /value="70" data-hunt-policy="capture.minQualityPercent"/);
    assert.match(html, /value="55"/);
    assert.match(html, /value="switchWhenComplete" checked/);
    assert.doesNotMatch(html, /data-hunt-policy="capture.alwaysShiny" data-kind="bool" checked/);
    assert.match(b.dom.text('hunt-status'), /Pausada/);
    assert.match(b.dom.text('hunt-status'), /RETOMAR/);
    b.view.handleAction('resume', {});
    assert.equal(b.game.isHuntRunning(), true);
    b.game.stopBattle();
});

test('ciclo de vida: só assina eventos com a aba aberta e solta tudo ao sair (sem custo fora da aba)', () => {
    const { game, view } = setup();
    assert.equal(game.bus.hasListeners(), false);
    view.onShow();
    assert.equal(game.bus.hasListeners(), true);
    assert.ok(view._tick);
    view.onHide();
    assert.equal(game.bus.hasListeners(), false);
    assert.equal(view._tick, null);
    view.onShow(); view.onShow();                      // abrir de novo não duplica assinaturas
    assert.equal(view._unsubs.length, 12);
    view.onHide();
    assert.equal(game.bus.hasListeners(), false);
});

test('atualizações são agrupadas (debounce): vários eventos geram uma renderização', async () => {
    const { game, view } = setup();
    let renders = 0;
    const orig = view.renderLive.bind(view);
    view.renderLive = () => { renders++; orig(); };
    view.onShow();
    renders = 0;
    for (let i = 0; i < 20; i++) game._emit('battle_completed', { result: 'victory', xp: 1, gold: 1 });
    await new Promise(r => setTimeout(r, 700));
    view.onHide();
    assert.equal(renders, 1);
});

test('formatação de tempo e wiring estático (aba, botão, script, CSS mobile)', () => {
    const { ctx } = setup();
    assert.equal(ctx.huntFormatDuration(5000), '00:05');
    assert.equal(ctx.huntFormatDuration(3723000), '1:02:03');
    assert.equal(ctx.huntFormatDuration(-5), '00:00');
    const root = path.resolve(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /<div id="tab-hunt" class="tab-content">/);
    assert.match(html, /data-tab="tab-hunt"><span class="tab-icon">🎯<\/span><span class="tab-label">Caça<\/span>/);
    assert.match(html, /<script src="js\/hunt-view\.js"><\/script>/);
    const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
    assert.match(css, /#hunt-container \{[^}]*max-width: 640px/);
    assert.match(css, /\.hunt-stats \{ display: grid; grid-template-columns: repeat\(3/);
    assert.match(css, /#tab-hunt \{ overflow-x: hidden/);
    assert.match(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), /this\.huntView\.onShow\(\)/);
});

test('atividade recente: eventos importantes em português, sem logs técnicos, mais novo primeiro, no máximo 6', () => {
    const { dom, game, view } = setup();
    assert.match(dom.text('hunt-activity'), /Nada por aqui ainda/);
    view.handleAction('start', {});
    game.stopBattle();
    game.processDefeat(Object.assign(game.createWildPokemon(19, 3, 0), { ivs: ivs(31), isShiny: true }));
    game.startBattle(); game.stopBattle();
    game.currentBattle.playerCurrentHp = 1;
    game.usePotion();
    game.changeRoute('kanto_route2');
    view.renderLive();
    const t = dom.text('hunt-activity');
    assert.match(t, /Capturou Rattata Shiny \(nota S\)/);
    assert.match(t, /Poção usada: \+\d+ de HP \(restam 9\)/);
    assert.match(t, /Nova rota: Rota 2/);
    assert.match(t, /Caçada iniciada/);
    assert.doesNotMatch(t, /capture_attempted|battle_completed|automation_decision|xp_gained/);
    assert.ok(t.indexOf('Nova rota') < t.indexOf('Caçada iniciada'), 'mais novo primeiro');
    for (let i = 0; i < 20; i++) game._emit('route_changed', { route: 'kanto_route1', from: 'x', reason: 'manual' });
    view.renderLive();
    assert.equal((dom.html('hunt-activity').match(/<li>/g) || []).length, 6);
    game.dispatchAutomationAction({ type: 'STOP_HUNT' });
    view.renderLive();
    assert.match(dom.text('hunt-activity'), /Caça encerrada/);
});
