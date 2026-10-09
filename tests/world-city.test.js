'use strict';
// F7.2: a cidade inicial. (1) Centro Pokémon: cura gratuita que reaproveita o HP da batalha e o caminho de reanimação da poção;
// (2) a view: movimento manual por teclado/toque com loop só enquanto há direção, serviços por proximidade, Depot que abre a aba
// PC existente, seletor de destino puramente visual e regra "só cidade anda manualmente".
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, plain } = require('./helpers/game');
const { shown, fakeEnv, fakeGame, fakeUi, loadWorld, tick } = require('./helpers/world-env');

const W = loadWorld();
const TOWN = W.WORLD_MAPS.starter_town;
const CENTER = TOWN.interactions.find(i => i.type === 'heal');
const DEPOT = TOWN.interactions.find(i => i.type === 'depot');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const watch = (game) => { const ev = []; game.bus.on('*', (e) => ev.push(e)); return ev; };
const count = (ev, type) => ev.filter(e => e.type === type && !e.offline).length;

// ------------------------------------------------------------------ Centro Pokémon (núcleo)
test('F7.2 cura: Centro Pokémon restaura o HP da batalha em curso sem gastar poção e sem reabrir a luta', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.ensureInventory().potions = 3;
    game.startBattle();
    const battle = game.currentBattle, timer = game.battleTimer;
    battle.playerCurrentHp = Math.max(1, Math.floor(battle.playerMaxHp / 3));
    const before = battle.playerCurrentHp;
    const heals = [];
    game.onBattleEvent = (e, d) => { if (e === 'healing') heals.push(d); };
    const r = game.healAtCenter();
    assert.equal(r.ok, true);
    assert.equal(r.revived, false);
    assert.equal(r.amount, battle.playerMaxHp - before);
    assert.equal(game.currentBattle.playerCurrentHp, battle.playerMaxHp);
    assert.equal(game.currentBattle, battle, 'a mesma batalha continua');
    assert.equal(game.battleTimer, timer);
    assert.equal(count(ev, 'battle_started'), 1, 'não abriu outra batalha');
    assert.equal(game.getPotions(), 3, 'nenhuma poção gasta');
    const e = ev.find(x => x.type === 'heal');
    assert.ok(e && e.potion === false && e.reason === 'center' && e.revived === false && e.amount === r.amount, 'evento heal marcado como NÃO poção');
    assert.equal(heals.length, 1, 'a interface de batalha é avisada como na poção');
    game.stopBattle();
});

test('F7.2 cura: HP cheio é recusado e uma segunda cura seguida não repete o efeito', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.startBattle();
    assert.equal(plain(game.healAtCenter()).code, 'full_hp');
    game.currentBattle.playerCurrentHp = 1;
    assert.equal(game.healAtCenter().ok, true);
    assert.equal(plain(game.healAtCenter()).code, 'full_hp', 'segunda seguida: nada a curar');
    assert.equal(count(ev, 'heal'), 1, 'um único evento');
    game.stopBattle();
});

test('F7.2 cura: combatente caído é reanimado pelo mesmo caminho da poção, reabrindo a batalha uma vez (a guarda da F7.0 não é acionada)', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.startBattle();
    game.stopBattle();
    game.currentBattle.playerCurrentHp = 0;
    game.startHealingAfterDefeat();
    assert.ok(game.healTimer, 'recuperação lenta em andamento');
    const r = game.healAtCenter();
    assert.equal(r.ok, true);
    assert.equal(r.revived, true);
    assert.equal(game.healTimer, null, 'a recuperação lenta foi encerrada');
    assert.ok(game.battleTimer, 'a luta reabriu');
    assert.equal(game.currentBattle.playerCurrentHp, game.currentBattle.playerMaxHp);
    assert.equal(count(ev, 'battle_started'), 2, 'início + reabertura, e só uma');
    assert.equal(game._battleGuard.refused, 0, 'nenhuma chamada recusada pela guarda');
    assert.equal(game.healAtCenter().ok, false, 'depois de curado não há o que curar');
    game.stopBattle();
});

test('F7.2 cura: sem batalha, na Torre e durante o offline o Centro recusa com um código claro', () => {
    const { game } = newGame();
    assert.equal(plain(game.healAtCenter()).code, 'no_battle');
    game.startBattle();
    game.currentBattle.playerCurrentHp = 1;
    game._towerMode = true;
    assert.equal(plain(game.healAtCenter()).code, 'tower_mode');
    game._towerMode = false;
    game._isOfflineSimulating = true;
    assert.equal(plain(game.healAtCenter()).code, 'offline');
    game._isOfflineSimulating = false;
    assert.equal(game.currentBattle.playerCurrentHp, 1, 'nada foi alterado nos casos recusados');
    game.stopBattle();
});

test('F7.2 cura: com a Caça EM ANDAMENTO o Centro recusa (hunt_running), sem curar, sem evento, sem gastar poção e sem mexer na batalha', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.ensureInventory().potions = 2;
    game.startBattle();
    assert.equal(game.dispatchAutomationAction({ type: 'START_HUNT' }).ok, true);
    assert.equal(game.isHuntRunning(), true);
    const battle = game.currentBattle, timer = game.battleTimer, stats = plain(game.getHuntSession().stats);
    battle.playerCurrentHp = 1;
    const r = plain(game.healAtCenter());
    assert.deepEqual(r, { ok: false, code: 'hunt_running' });
    assert.equal(battle.playerCurrentHp, 1, 'HP intacto: nada de cura grátis com a automação progredindo');
    assert.equal(game.currentBattle, battle);
    assert.equal(game.battleTimer, timer);
    assert.equal(count(ev, 'heal'), 0, 'nenhum evento heal');
    assert.equal(game.getPotions(), 2);
    assert.deepEqual(plain(game.getHuntSession().stats), stats, 'estatísticas da sessão intactas');
    // também caído: continua recusado (não reanima nem reabre a luta)
    game.stopBattle();
    battle.playerCurrentHp = 0;
    game.startHealingAfterDefeat();
    assert.equal(plain(game.healAtCenter()).code, 'hunt_running');
    assert.ok(game.healTimer, 'a recuperação lenta segue');
    assert.equal(count(ev, 'battle_started'), 1, 'não reabriu a luta');
    game.stopBattle();
});

test('F7.2 cura: depois de PAUSAR ou PARAR a caçada (decisão explícita) o Centro volta a atender; o estado vem só da sessão', () => {
    for (const how of ['PAUSE_HUNT', 'STOP_HUNT']) {
        const { game } = newGame();
        const ev = watch(game);
        game.startBattle();
        assert.equal(game.dispatchAutomationAction({ type: 'START_HUNT' }).ok, true);
        game.currentBattle.playerCurrentHp = 1;
        assert.equal(plain(game.healAtCenter()).code, 'hunt_running', `${how}: ainda rodando`);
        assert.equal(game.dispatchAutomationAction({ type: how }).ok, true, how);
        assert.equal(game.isHuntRunning(), false);
        const r = game.healAtCenter();
        assert.equal(r.ok, true, `${how}: atende`);
        assert.equal(game.currentBattle.playerCurrentHp, game.currentBattle.playerMaxHp);
        assert.equal(ev.filter(e => e.type === 'heal' && e.reason === 'center' && e.potion === false).length, 1);
        game.stopBattle();
    }
    // retomar (RESUME_HUNT) bloqueia de novo: não há variável paralela, vale sempre o estado da sessão
    const { game } = newGame();
    game.startBattle();
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    game.dispatchAutomationAction({ type: 'RESUME_HUNT' });
    game.currentBattle.playerCurrentHp = 1;
    assert.equal(plain(game.healAtCenter()).code, 'hunt_running');
    game.stopBattle();
});

test('F7.2 cura: só restaura o HP do combatente da batalha atual (não há HP por Pokémon da equipe) e respeita as proteções da F7.0', () => {
    const { game } = newGame();
    game.startBattle();
    const b = game.currentBattle;
    assert.ok('playerCurrentHp' in b && !('teamHp' in b), 'o modelo guarda um único HP: o do combatente em batalha');
    assert.ok(!game.gameState.team.some((m) => m && typeof m === 'object' && 'hp' in m), 'a equipe não carrega HP próprio');
    b.playerCurrentHp = 1;
    // prioridade das recusas: offline > Torre > Caça > sem batalha
    game._isOfflineSimulating = true; game._towerMode = true;
    assert.equal(plain(game.healAtCenter()).code, 'offline');
    game._isOfflineSimulating = false;
    assert.equal(plain(game.healAtCenter()).code, 'tower_mode');
    game._towerMode = false;
    assert.equal(game.healAtCenter().ok, true);
    assert.equal(game._battleGuard.refused, 0, 'nenhuma chamada recusada pela guarda da F7.0');
    game.stopBattle();
});

// ------------------------------------------------------------------ cidade na view
const nearOf = (it) => ({ ...W.worldCreateState(TOWN), x: (it.cell.x + 0.5) * 16, y: (it.cell.y + 0.5) * 16 });
function placeNear(view, env, it) { view._players.starter_town = nearOf(it); view.requestRedraw(true); env.flush(); }

test('F7.2 cidade: Centro Pokémon por proximidade — Interagir só habilita perto, cura pelo núcleo e avisa; tecla E faz o mesmo', async () => {
    const { env, game, ui, view } = await shown();
    assert.equal(env.interactBtn.disabled, true, 'longe: desabilitado');
    env.interactBtn.fire('click'); env.key('keydown', 'KeyE');
    assert.equal(game.healCalls, 0, 'longe não cura');
    placeNear(view, env, CENTER);
    assert.equal(env.interactBtn.disabled, false, 'perto: habilitado');
    assert.match(env.hint.textContent, /Centro Pokémon/);
    env.interactBtn.fire('click');
    assert.equal(game.healCalls, 1);
    assert.match(ui.toasts.at(-1), /O Pokémon em batalha foi curado \(\+7 de HP\)/);
    env.key('keydown', 'KeyE');
    assert.equal(game.healCalls, 2, 'tecla E também interage');
    game.healResult = { ok: true, amount: 12, revived: true };
    env.interactBtn.fire('click');
    assert.match(ui.toasts.at(-1), /voltou à luta/);
    for (const [code, re] of [['full_hp', /Pokémon em batalha já está com o HP cheio/], ['hunt_running', /Pause ou pare a caçada/], ['tower_mode', /Torre/], ['offline', /offline/], ['no_battle', /Não há batalha/]]) {
        game.healResult = { ok: false, code };
        env.interactBtn.fire('click');
        assert.match(ui.toasts.at(-1), re, code);
    }
    assert.equal(ui.tabs.length, 0, 'curar não abre aba nenhuma');
});

test('F7.2 cidade: o aviso de um serviço some ao ir para outro e a dica de proximidade volta na hora', async () => {
    const { env, view } = await shown();
    placeNear(view, env, CENTER);
    env.interactBtn.fire('click');
    assert.match(env.hint.textContent, /O Pokémon em batalha foi curado/);
    placeNear(view, env, CENTER);
    assert.match(env.hint.textContent, /O Pokémon em batalha foi curado/, 'perto do mesmo serviço o aviso fica');
    placeNear(view, env, DEPOT);
    assert.match(env.hint.textContent, /Perto: Depot/, 'em outro serviço, a dica normal volta imediatamente');
    view._players.starter_town = W.worldCreateState(TOWN); view.requestRedraw(true); env.flush();
    assert.equal(env.hint.textContent, '', 'longe de tudo: sem dica');
});

test('F7.2 cidade: Depot abre a aba PC existente (sem armazenamento próprio) e não cura', async () => {
    const { env, game, ui, view } = await shown();
    placeNear(view, env, DEPOT);
    assert.match(env.hint.textContent, /Depot/);
    env.interactBtn.fire('click');
    assert.deepEqual(ui.tabs, ['tab-pc']);
    assert.equal(game.healCalls, 0);
    env.key('keydown', 'KeyE');
    assert.deepEqual(ui.tabs, ['tab-pc', 'tab-pc'], 'tecla E também abre o PC');
});

test('F7.2 cidade: teclado move o personagem com o tempo real (loop só enquanto há direção) e para ao soltar', async () => {
    const { env, view } = await shown();
    const start = { ...view._player(TOWN) };
    assert.equal(env.pending(), 0, 'parado: sem quadros agendados');
    env.key('keydown', 'ArrowRight');
    assert.equal(env.pending(), 1, 'pressionar agenda o loop');
    env.flush(16);                                                         // primeiro quadro: sem tempo anterior, não anda
    assert.equal(view._player(TOWN).x, start.x);
    assert.equal(env.pending(), 1, 'direção ainda pressionada: o loop continua');
    for (let i = 0; i < 30; i++) env.flush(20);                            // 600 ms
    const p = view._player(TOWN);
    assert.ok(Math.abs(p.x - (start.x + 64 * 0.6)) < 1e-6, `andou 38,4 px: ${p.x - start.x}`);
    assert.equal(p.dir, 'right');
    assert.equal(p.moving, true);
    assert.ok(Math.abs(p.distance - 38.4) < 1e-6);
    env.key('keyup', 'ArrowRight');
    env.flush(20);                                                         // quadro final: pinta parado e encerra o loop
    assert.equal(view._player(TOWN).moving, false);
    assert.equal(env.pending(), 0, 'soltou: o loop acaba');
    const x = view._player(TOWN).x;
    env.flush(500);
    assert.equal(view._player(TOWN).x, x, 'parado não anda mais');
});

test('F7.2 cidade: a distância não depende da taxa de quadros nem de um quadro gigante (aba voltando de escondida)', async () => {
    const runWith = async (ms) => {
        const { env, view } = await shown();
        const start = view._player(TOWN).x;
        env.key('keydown', 'KeyD'); env.flush(ms);                         // quadro inicial (dt 0)
        for (let t = 0; t < 1000; t += ms) env.flush(ms);
        env.key('keyup', 'KeyD'); env.flush(ms);
        return view._player(TOWN).x - start;
    };
    const slow = await runWith(50), mid = await runWith(1000 / 60 * 3), fast = await runWith(8);
    for (const [label, d] of [['20 Hz', slow], ['20 Hz (3x16,7 ms)', mid], ['125 Hz', fast]]) assert.ok(Math.abs(d - 64) < 1e-3, `${label}: 1 s a 64 px/s = 64 px, deu ${d}`);
    const { env, view } = await shown();
    const x0 = view._player(TOWN).x;
    env.key('keydown', 'KeyD'); env.flush(16); env.flush(60000);         // quadro de 60 s
    assert.ok(view._player(TOWN).x - x0 <= 64 * 0.05 + 1e-9, 'um quadro gigante vale no máximo maxStepMs');
});

test('F7.2 cidade: perder foco, esconder a página ou sair da aba soltam a direção e param o loop', async () => {
    const { env, view } = await shown();
    env.key('keydown', 'KeyW'); env.flush(16); env.flush(16);
    env.winListeners.blur.forEach(f => f());
    assert.equal(view.controls.direction(), null, 'blur');
    env.flush(16);
    assert.equal(env.pending(), 0);
    env.key('keydown', 'KeyS'); env.flush(16);
    env.document.hidden = true;
    env.listeners.visibilitychange.forEach(f => f());
    assert.equal(view.controls.direction(), null, 'página escondida');
    assert.equal(view._lastTs, null, 'o relógio do movimento é zerado');
    env.flush(16);
    assert.equal(env.pending(), 0);
    env.document.hidden = false;
    env.key('keydown', 'KeyS'); env.flush(16); env.flush(16);
    view.onHide();
    assert.equal(view.controls.stack.size, 0, 'sair da aba');
    assert.equal(env.pending(), 0);
    assert.equal(view._player(TOWN).moving, false);
});

test('F7.2 cidade: direcional na tela (toque) move e solta; a posição fica guardada ao sair e voltar da aba', async () => {
    const { env, view } = await shown();
    const btn = { dataset: { dir: 'left' }, closest() { return this; }, setPointerCapture() {} };
    const x0 = view._player(TOWN).x;
    env.root.fire('pointerdown', { target: btn, pointerId: 3, preventDefault() {} });
    env.flush(16); for (let i = 0; i < 20; i++) env.flush(20);
    assert.ok(view._player(TOWN).x < x0 - 20, 'andou para a esquerda');
    env.root.fire('pointerup', { target: btn, pointerId: 3 });
    env.flush(20);
    assert.equal(env.pending(), 0);
    const kept = view._player(TOWN).x;
    view.onHide(); view.onShow(); await tick(); env.flush();
    assert.equal(view._player(TOWN).x, kept, 'a posição sobrevive a sair e voltar da aba (em memória)');
});

test('F7.2 cidade: obstáculos do mapa seguram o personagem (parede do Centro Pokémon)', async () => {
    const { env, view } = await shown();
    view._players.starter_town = nearOf(CENTER);                          // em frente à porta do Centro
    const y0 = view._player(TOWN).y;
    env.key('keydown', 'ArrowUp'); env.flush(16);
    for (let i = 0; i < 40; i++) env.flush(25);
    const p = view._player(TOWN);
    assert.ok(p.y >= CENTER.cell.y * 16 + W.WORLD_MOVEMENT.hitbox.halfH - 1e-3 && p.y < y0, 'encostou na porta, sem atravessar');
    assert.equal(p.dir, 'up');
});

// ------------------------------------------------------------------ viagem entre áreas e regra por tipo de mapa
test('F7.2 destino: o seletor troca a área exibida (cidade ↔ Rota 1) sem mexer na rota do jogo; rota não aceita caminhada manual', async () => {
    const { env, game, view } = await shown();
    const options = env.destination.children.map(o => o.value);
    assert.deepEqual(options, Object.keys(W.WORLD_MAPS));
    assert.ok(env.destination.children.some(o => /Cidade Inicial/.test(o.textContent)) && env.destination.children.some(o => /Rota 1/.test(o.textContent)));
    const before = game.gameState.currentRoute;
    env.destination.value = 'kanto_route1';
    env.destination.fire('change');
    assert.equal(env.destination.blurred, true, 'o seletor solta o foco para o teclado voltar a andar');
    env.flush();
    assert.equal(view.areaId, 'kanto_route1');
    assert.equal(view.currentScene().map.type, 'route');
    assert.equal(env.controlsEl.hidden, true, 'sem controles de caminhada na rota');
    assert.equal(view.controls.enabled, false);
    assert.match(env.caption.textContent, /Rota 1/);
    assert.match(env.caption.textContent, /anda sozinho durante as caçadas/);
    assert.match(env.caption.textContent, /sua rota de caça atual/);
    const x = view._player(W.WORLD_MAPS.kanto_route1).x;
    env.key('keydown', 'ArrowRight'); env.key('keydown', 'KeyD');
    assert.equal(env.pending(), 0, 'rota: teclas não agendam movimento');
    env.flush(16);
    assert.equal(view._player(W.WORLD_MAPS.kanto_route1).x, x, 'o personagem da rota não se mexe');
    // mesmo forçando a entrada, o movimento manual é recusado em rotas
    view.controls.enabled = true; view.controls.stack.press('x', 'right');
    view.requestRedraw(true); env.flush(16); env.flush(16);
    assert.equal(view._player(W.WORLD_MAPS.kanto_route1).x, x, 'proteção também no consumo da entrada');
    view.controls.clear(); view.controls.enabled = false;
    assert.equal(game.gameState.currentRoute, before, 'a rota do jogo não mudou');
    env.destination.value = 'starter_town'; env.destination.fire('change'); env.flush();
    assert.equal(env.controlsEl.hidden, false, 'volta à cidade: controles de volta');
    assert.equal(view.controls.enabled, true);
});

test('F7.2 destino: a posição de cada área é preservada ao alternar; áreas de caça (type hunt) também não andam manualmente', async () => {
    const { env, view, world } = await shown({ setup: (w) => { w.WORLD_MAPS.hunt_demo = { id: 'hunt_demo', type: 'hunt', name: 'Área de caça de teste', width: 20, height: 15, spawn: { x: 3, y: 3, dir: 'down' }, label: 'campo aberto', rows: Array.from({ length: 15 }, () => '.'.repeat(20)) }; } });
    env.key('keydown', 'KeyD'); env.flush(16); for (let i = 0; i < 10; i++) env.flush(20); env.key('keyup', 'KeyD'); env.flush(20);
    const moved = view._player(TOWN).x;
    assert.ok(moved > nearOf({ cell: TOWN.spawn }).x);
    assert.equal(view.setArea('hunt_demo'), true);
    env.flush();
    assert.equal(view.currentScene().map.type, 'hunt');
    assert.match(env.caption.textContent, /Área de caça de teste/);
    env.key('keydown', 'KeyD');
    assert.equal(env.pending(), 0, 'área de caça: caminhada manual recusada');
    assert.equal(view.setArea('nao_existe'), false, 'área desconhecida é recusada');
    assert.equal(view.setArea('hunt_demo'), false, 'mesma área: nada a fazer');
    view.setArea('starter_town'); env.flush();
    assert.equal(view._player(TOWN).x, moved, 'a cidade lembra onde o personagem estava');
});

test('F7.2 cidade: a view nunca altera a rota do jogo, não inicia batalha e não salva (o jogo falso lança se isso ocorrer)', async () => {
    const { env, game, view } = await shown();
    placeNear(view, env, CENTER); env.interactBtn.fire('click');
    placeNear(view, env, DEPOT); env.interactBtn.fire('click');
    env.key('keydown', 'KeyW'); env.flush(16); env.flush(16); env.key('keyup', 'KeyW'); env.flush(16);
    env.destination.value = 'kanto_route1'; env.destination.fire('change'); env.flush();
    assert.equal(game.gameState.currentRoute, 'kanto_route1');
    assert.ok(true, 'chegou aqui sem que changeRoute/selectHuntRoute/startBattle/save fossem chamados');
});

test('F7.5 seletor: o controle se chama "Ir para" e deixa claro que não muda a rota do jogo', async () => {
    const { env } = await shown();
    assert.match(env.root.innerHTML, /Ir para/);
    assert.doesNotMatch(env.root.innerHTML, /Destino/);
    assert.match(env.root.innerHTML, /não muda a rota do jogo/);
    env.destination.value = 'kanto_route1'; env.destination.fire('change'); env.flush();
    assert.match(env.caption.textContent, /a rota do jogo não muda/);
    assert.doesNotMatch(env.caption.textContent, /Destino/);
});

test('F7.2 CSS: o direcional fica escondido por padrão e aparece em qualquer aparelho com toque (any-pointer: coarse) ou sem hover', () => {
    const css = require('fs').readFileSync(require('path').join(require('./helpers/world-env').ROOT, 'css/style.css'), 'utf8');
    assert.match(css, /\.world-dpad \{ display: none; \}/, 'escondido por padrão');
    assert.match(css, /@media \(any-pointer: coarse\), \(hover: none\) \{ \.world-dpad \{ display: grid; \}/, 'toque (inclusive híbridos) mostra');
    assert.doesNotMatch(css, /@media \(hover: hover\) and \(pointer: fine\)[^}]*\.world-dpad/, 'o ponteiro principal fino não esconde mais o direcional de quem tem toque');
});
