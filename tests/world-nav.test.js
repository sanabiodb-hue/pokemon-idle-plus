'use strict';
// F7.5: navegação real entre áreas (cidade, rotas com mapa e mapas de caça por espécie). A localização visual é `WorldView.areaId`,
// independente da progressão (gameState.currentRoute): viajar é instantâneo, síncrono e atômico; falhas mantêm a área anterior.
const test = require('node:test');
const assert = require('node:assert/strict');
const { shown } = require('./helpers/world-env');

const TILE = 16;
const stat = (w) => JSON.stringify(w.worldHuntStats());
const clickResult = (env, id) => env.huntResults.fire('click', { target: { closest: () => ({ dataset: { speciesId: String(id) } }) } });
const type = (env, text) => { env.huntInput.value = text; env.huntInput.fire('input'); return env.huntResults.children; };
const hold = (env, code) => { env.key('keydown', code); env.flush(16); for (let i = 0; i < 10; i++) env.flush(25); };
const johtoSetup = (w) => {
    const rid = w.REGIONS.johto.routes[0].id;
    w.WORLD_ROUTE_MAPS[rid] = 'johto_mapa';
    w.WORLD_MAPS.johto_mapa = { id: 'johto_mapa', type: 'route', name: 'Rota de Johto (teste)', width: 20, height: 14, spawn: { x: 3, y: 3, dir: 'down' }, rows: Array.from({ length: 14 }, () => '.'.repeat(20)) };
    return rid;
};

test('F7.5 cidade: continua a área inicial, navegável, e sair/voltar preserva a posição sem duplicar entradas', async () => {
    const { env, view, game } = await shown();
    assert.equal(view.areaId, 'starter_town');
    hold(env, 'ArrowRight'); env.key('keyup', 'ArrowRight'); env.flush(20);
    const map = view.currentScene().map, x1 = view._player(map).x;
    assert.ok(x1 > 3 * TILE, 'a caminhada manual segue funcionando na cidade');
    assert.equal(view.openRoute('kanto_route1').ok, true);
    env.flush();
    assert.equal(view.areaId, 'kanto_route1');
    assert.equal(view.setArea('starter_town'), true);
    env.flush();
    assert.equal(view._player(map).x, x1, 'voltou exatamente de onde saiu (sem reset)');
    assert.equal(env.listenerCount('keydown'), 1);
    assert.equal(env.listenerCount('visibilitychange'), 2, 'um da view e um dos controles (como antes de navegar)');
    assert.equal(game.subCount(), 1, 'uma única assinatura do jogo');
    assert.equal(game.healCalls, 0);
});

test('F7.5 rotas: abrir uma rota com mapa altera a área ativa real, sem tocar na progressão', async () => {
    const { env, view, game } = await shown({ route: 'kanto_route1' });
    const before = JSON.stringify(game.gameState);
    const r = view.openRoute('kanto_route1');
    assert.deepEqual([r.ok, r.changed, r.code], [true, true, 'ok']);
    assert.equal(view.currentScene().map.id, 'kanto_route1');
    env.flush();
    assert.equal(env.destination.value, 'kanto_route1');
    assert.equal(JSON.stringify(game.gameState), before, 'gameState idêntico (nenhum campo da progressão mudou)');
    const noMap = view.openRoute('kanto_route2');
    assert.deepEqual([noMap.ok, noMap.code], [false, 'no_map']);
    assert.equal(view.areaId, 'kanto_route1', 'rota sem mapa visual: a área não muda');
    assert.match(env.hint.textContent, /ainda não tem mapa visual/);
});

test('F7.5 rotas bloqueadas: a região bloqueada na progressão não abre, nem pelo método nem pelo seletor; ao liberar, abre', async () => {
    let rid, unlocked = false;
    const { env, view, ui } = await shown({ setup: (w) => { rid = johtoSetup(w); }, game: { isRegionUnlocked: (k) => (k === 'johto' ? unlocked : true) } });
    assert.ok(env.destination.children.some(o => o.value === 'johto_mapa' && o.disabled === true && /🔒/.test(o.textContent)), 'opção bloqueada e marcada');
    const r = view.openRoute(rid);
    assert.deepEqual([r.ok, r.code], [false, 'locked']);
    assert.equal(view.setArea('johto_mapa'), false);
    assert.equal(view.areaId, 'starter_town');
    assert.ok(ui.toasts.some(t => /bloqueada/.test(t)), 'feedback na interface');
    env.destination.value = 'johto_mapa'; env.destination.fire('change');
    assert.equal(env.destination.value, 'starter_town', 'o seletor volta para a área ativa');
    unlocked = true;
    view.onShow(); env.flush();                                                     // reabrir a aba recalcula as opções
    assert.ok(env.destination.children.some(o => o.value === 'johto_mapa' && !o.disabled));
    assert.equal(view.openRoute(rid).ok, true);
    assert.equal(view.areaId, 'johto_mapa');
});

test('F7.5 espécies: selecionar uma espécie abre o mapa correto, pela geração sob demanda e pelo cache existente', async () => {
    const { env, view, world, game } = await shown();
    assert.equal(stat(world), '{"generated":0,"cached":0}', 'abrir o mundo não gera mapas');
    const before = JSON.stringify(game.gameState);
    const r = view.openHuntMap(25);
    assert.deepEqual([r.ok, r.changed], [true, true]);
    const map = view.currentScene().map;
    assert.equal(map.id, 'hunt_25');
    assert.equal(map.speciesId, 25);
    assert.equal(map, world.getWorldMap('hunt_25'), 'o mesmo objeto do cache (a interface não guarda cópia)');
    assert.equal(stat(world), '{"generated":1,"cached":1}');
    env.flush();
    assert.match(env.caption.textContent, /Pikachu/);
    assert.match(env.caption.textContent, /a caçada ainda não começa/);
    assert.equal(JSON.stringify(game.gameState), before);
    view.setArea('starter_town'); view.openHuntMap(25); env.flush();
    assert.equal(stat(world), '{"generated":1,"cached":1}', 'selecionar de novo reaproveita o mapa em cache');
    assert.equal(view.openHuntMap(25).changed, false, 'mesma espécie na mesma área: nada muda');
    assert.equal(view._player(map).x, map.spawn.x * TILE + 8, 'o personagem começa no ponto inicial do mapa');
});

test('F7.5 espécies inválidas: feedback verificável, sem exceção e com a área atual preservada', async () => {
    const { env, view, ui } = await shown();
    view.openHuntMap(7); env.flush();
    const area = view.areaId, toasts = ui.toasts.length;
    let n = 0;
    for (const bad of [0, -1, 1.5, NaN, Infinity, '25', null, undefined, {}, [], 1074, 99999, 1e9, true]) {
        let result;
        assert.doesNotThrow(() => { result = view.openHuntMap(bad); }, String(bad));
        assert.deepEqual([result.ok, result.code], [false, 'invalid_species'], String(bad));
        n++;
        assert.equal(view.areaId, area, `área preservada após ${String(bad)}`);
    }
    assert.equal(ui.toasts.length, toasts + n, 'cada seleção inválida avisou o jogador');
    assert.match(ui.toasts[ui.toasts.length - 1], /Espécie inválida/);
    for (const bad of ['hunt_0', 'hunt_01', 'nada', '', null, undefined, 5, {}]) assert.equal(view.setArea(bad), false, String(bad));
    assert.equal(view.areaId, area);
    env.flush();
    assert.equal(env.destination.value, area);
});

test('F7.5 falha de geração: o erro é tratado, avisa o jogador e preserva tudo; navegar depois continua funcionando', async () => {
    let broken;
    const { env, view, ui, world } = await shown({ setup: (w) => { broken = w.POKEMON_DATA; Object.defineProperty(broken, '99999', { enumerable: true, configurable: true, get() { throw new Error('dados corrompidos'); } }); } });
    view.openHuntMap(4); env.flush();
    const before = { area: view.areaId, player: JSON.stringify(view._player(view.currentScene().map)), toasts: ui.toasts.length };
    let r;
    assert.doesNotThrow(() => { r = view.openHuntMap(99999); });
    assert.deepEqual([r.ok, r.code], [false, 'invalid']);
    assert.equal(view.areaId, before.area);
    assert.equal(JSON.stringify(view._player(view.currentScene().map)), before.player, 'personagem intacto');
    assert.equal(ui.toasts.length, before.toasts + 1);
    assert.match(ui.toasts[ui.toasts.length - 1], /Não foi possível abrir esse mapa/);
    assert.equal(view.openHuntMap(5).ok, true);
    assert.equal(view.areaId, 'hunt_5');
    assert.equal(world.worldHuntStats().cached >= 2, true);
});

test('F7.5 cliques rápidos: o último pedido válido vence, falhas no meio não desfazem nada e não sobra estado parcial', async () => {
    let rid;
    const { env, view, game } = await shown({ setup: (w) => { rid = johtoSetup(w); }, game: { isRegionUnlocked: (k) => k !== 'johto' } });
    const before = JSON.stringify(game.gameState);
    view.openHuntMap(1); view.openHuntMap(0); view.openRoute(rid); view.openHuntMap(150); view.openHuntMap(-4); view.openRoute('kanto_route1'); view.openHuntMap(1073); view.openHuntMap(99999);
    assert.equal(view.areaId, 'hunt_1073', 'o último pedido válido venceu');
    assert.equal(env.pending(), 1, 'um único quadro agendado para tudo');
    env.flush();
    assert.equal(env.destination.value, 'hunt_1073');
    assert.equal(view.currentScene().map.id, 'hunt_1073');
    assert.equal(view.lastCamera !== null, true);
    assert.equal(view.controls.direction(), null);
    assert.equal(Object.keys(view._players).filter(k => k.startsWith('hunt_')).length <= 1, true, 'só o mapa de caça atual mantém estado');
    assert.equal(JSON.stringify(game.gameState), before);
    // mesma coisa pelo seletor e pelos resultados da busca, intercalados
    env.destination.value = 'kanto_route1'; env.destination.fire('change');
    type(env, '25'); env.huntInput.fire('keydown', { key: 'Enter', preventDefault() {} });
    env.destination.value = 'starter_town'; env.destination.fire('change');
    clickResult(env, 6); clickResult(env, 'abc'); clickResult(env, 7);
    assert.equal(view.areaId, 'hunt_7');
    env.flush();
    assert.equal(env.destination.value, 'hunt_7');
});

test('F7.5 movimento: a caminhada manual segue restrita às cidades em rotas e mapas de caça; voltar à cidade reativa', async () => {
    const { env, view } = await shown();
    for (const open of [() => view.openRoute('kanto_route1'), () => view.openHuntMap(25)]) {
        open(); env.flush();
        const map = view.currentScene().map, before = JSON.stringify(view._player(map));
        env.key('keydown', 'ArrowRight'); env.key('keydown', 'KeyD');
        assert.equal(env.pending(), 0, `${map.id}: teclas não agendam movimento`);
        env.flush(16);
        assert.equal(JSON.stringify(view._player(map)), before);
        assert.equal(env.controlsEl.hidden, true, `${map.id}: sem direcional`);
        env.key('keyup', 'ArrowRight'); env.key('keyup', 'KeyD');
    }
    view.setArea('starter_town'); env.flush();
    assert.equal(env.controlsEl.hidden, false);
    const city = view.currentScene().map, x = view._player(city).x;
    hold(env, 'ArrowRight'); env.key('keyup', 'ArrowRight'); env.flush(20);
    assert.ok(view._player(city).x > x, 'voltou a andar');
});

test('F7.5 transição: libera entradas, não deixa personagem "andando" para trás e reposiciona a câmera no novo mapa', async () => {
    const { env, view, world } = await shown();
    env.key('keydown', 'ArrowRight'); env.flush(16); env.flush(25);
    const city = view.currentScene().map;
    assert.equal(view.controls.direction(), 'right');
    view.openHuntMap(92);                                                           // sai no meio da caminhada, tecla ainda "pressionada"
    assert.equal(view.controls.direction(), null, 'entrada liberada');
    assert.equal(view._player(city).moving, false, 'o personagem da cidade parou');
    env.flush(25); env.flush(25);
    const hunt = view.currentScene().map, m = view.lastMetrics;
    const spawnState = world.worldCreateState(hunt);
    const expected = world.worldCamera(hunt, m, world.worldCameraFocus(spawnState));
    assert.deepEqual([view.lastCamera.x, view.lastCamera.y], [expected.x, expected.y], 'câmera no ponto inicial do novo mapa');
    assert.equal(env.pending(), 0, 'nenhum loop de quadros sobrou (a tecla antiga não anda no mapa novo)');
    const x0 = view._player(hunt).x;
    env.flush(16);
    assert.equal(view._player(hunt).x, x0);
    view.setArea('starter_town'); env.flush(20);
    assert.equal(view._players.hunt_92, undefined, 'ao sair do mapa de caça o estado dele é descartado (limitado)');
    const px = view._player(city).x;
    env.flush(40);
    assert.equal(view._player(city).x, px, 'a tecla "pressionada" antes da viagem não volta a andar sozinha');
    assert.equal(env.listenerCount('keydown'), 1);
    assert.equal(env.observers.filter(o => !o.disconnected).length, 1, 'um único observador de tamanho');
});

test('F7.5 abas: a área ativa é preservada ao sair e voltar para a aba, sem duplicar ouvintes nem refazer mapas', async () => {
    const { env, view, world, game } = await shown();
    view.openHuntMap(7); env.flush();
    const generated = world.worldHuntStats().generated;
    for (let i = 0; i < 3; i++) { view.onHide(); view.onShow(); env.flush(); }
    assert.equal(view.areaId, 'hunt_7');
    assert.equal(env.destination.value, 'hunt_7');
    assert.equal(world.worldHuntStats().generated, generated, 'mesma área, mesmo mapa em cache');
    assert.equal(env.listenerCount('keydown'), 1);
    assert.equal(game.subCount(), 1);
    assert.equal(env.observers.filter(o => !o.disconnected).length, 1);
    assert.equal(game.healCalls, 0);
});

test('F7.5 progressão: viajar nunca chama mudança de rota, batalha, cura nem salvamento e não altera o estado do jogo', async () => {
    const { env, view, game } = await shown({ route: 'kanto_route1' });
    const snapshot = JSON.stringify(game.gameState);
    // a fakeGame LANÇA se a view chamar changeRoute/selectHuntRoute/startBattle/dispatchAutomationAction/save
    for (const id of [1, 4, 7, 25, 150, 1073]) { assert.equal(view.openHuntMap(id).ok, true); env.flush(); }
    view.openRoute('kanto_route1'); view.openRoute('kanto_route3'); view.setArea('starter_town'); env.flush();
    view.destination.value = 'kanto_route1'; env.destination.fire('change'); env.flush();
    game.emit('route_changed');                                                     // progressão elsewhere: a área visual não segue
    env.flush();
    assert.equal(view.areaId, 'kanto_route1', 'eventos de progressão não movem a área visual');
    assert.equal(JSON.stringify(game.gameState), snapshot);
    assert.equal(game.healCalls, 0);
});

test('F7.5 catálogo: a busca limita os resultados visíveis, não lista tudo e não gera nenhum mapa', async () => {
    const { env, view, world } = await shown({ game: { gameState: { currentRoute: 'kanto_route1', pokedex: { 25: 'caught', 4: 'seen' } } } });
    let created = 0; const orig = env.document.createElement; env.document.createElement = (t) => { created++; return orig(t); };
    assert.equal(env.huntResults.children.length, 0, 'sem consulta, nada listado');
    assert.equal(type(env, '').length, 0);
    const many = type(env, '1');                                                    // quase todas as 1.073 espécies contêm "1"
    assert.ok(many.length <= 11, `no máximo 10 resultados + aviso (${many.length})`);
    assert.equal(many.filter(c => c.dataset && c.dataset.speciesId).length, 10);
    assert.match(many[many.length - 1].textContent, /Mostrando 10 de \d{3,}/, 'avisa que há mais');
    assert.ok(created <= 11, `elementos criados: ${created}`);
    const total = Number(/de (\d+)/.exec(many[many.length - 1].textContent)[1]);
    assert.ok(total > 300, `muitos resultados reais (${total}), mas só 10 renderizados`);
    for (const q of ['25', '1073', '#025']) type(env, q);
    assert.equal(type(env, '1073').filter(c => c.dataset.speciesId).length, 1);
    assert.equal(type(env, '1073')[0].textContent, '#1073 ???', 'espécie não vista aparece como ???');
    assert.equal(type(env, 'pika')[0].textContent, '#025 Pikachu', 'espécie vista é achada pelo nome');
    assert.deepEqual(type(env, 'char').map(c => c.textContent), ['#004 Charmander'], 'só as espécies vistas são achadas pelo nome (Charizard, não vista, não aparece)');
    assert.equal(type(env, 'bulba').length, 0);
    assert.equal(type(env, 'zzz').length, 0);
    assert.equal(type(env, '  PIKA ')[0].dataset.speciesId, '25', 'ignora maiúsculas e espaços');
    assert.equal(world.worldHuntStats().generated, 0, 'pesquisar não gerou nenhum mapa');
    assert.equal(stat(world), '{"generated":0,"cached":0}');
    // escolher um resultado gera exatamente UM mapa e fecha a lista
    type(env, 'pika');
    clickResult(env, 25);
    assert.equal(view.areaId, 'hunt_25');
    assert.equal(world.worldHuntStats().generated, 1);
    assert.equal(env.huntInput.value, '');
    assert.equal(env.huntResults.children.length, 0);
});

test('F7.5 seletor: lista só áreas conhecidas (nunca as 1.073 espécies) e mostra uma opção temporária para o mapa de caça aberto', async () => {
    const { env, view, world } = await shown();
    const fixed = Object.keys(world.WORLD_MAPS).length;
    assert.equal(env.destination.children.length, fixed);
    view.openHuntMap(25); env.flush();
    assert.equal(env.destination.children.length, fixed + 1);
    assert.ok(env.destination.children.some(o => o.value === 'hunt_25' && /Pikachu/.test(o.textContent)));
    view.openHuntMap(26); env.flush();
    assert.equal(env.destination.children.length, fixed + 1, 'continua uma só opção temporária');
    view.setArea('starter_town'); env.flush();
    assert.equal(env.destination.children.length, fixed);
    assert.equal(view.currentScene().map.id, 'starter_town');
});

test('F7.5 estado limitado: visitar muitos mapas de caça não acumula estado nem mapas na interface', async () => {
    const { env, view, world } = await shown();
    for (let id = 1; id <= 60; id++) { view.openHuntMap(id); env.flush(); }
    assert.ok(Object.keys(view._players).length <= 2, `estados de personagem: ${Object.keys(view._players)}`);
    assert.equal(world.worldHuntStats().cached, 8, 'o cache LRU da F7.4 segue limitado a 8 mapas');
    assert.equal(world.worldHuntStats().generated, 60);
    assert.equal(Object.keys(view).filter(k => /map|cache/i.test(k) && view[k] && typeof view[k] === 'object' && view[k].rows).length, 0, 'a view não guarda objetos de mapa');
});
