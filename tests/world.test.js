'use strict';
// Mundo visual (F7.1 + F7.2): dados dos mapas, assets, motor puro (autotile, métricas, câmera, coordenadas) e ciclo de vida
// da view (ativar, pausar, esconder aba/página, resize) com DOM falso: sem navegador e sem loop contínuo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadData } = require('../tools/load-context');
const { ROOT, loadWorld, fakeEnv, fakeGame, fakeUi, tick, shown, REAL_ROUTES } = require('./helpers/world-env');

const W = loadWorld();
const ROUTE = W.WORLD_MAPS.kanto_route1;
const TOWN = W.WORLD_MAPS.starter_town;
const pngSize = (file) => { const b = fs.readFileSync(path.join(ROOT, file)); assert.equal(b.toString('latin1', 1, 4), 'PNG'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const cells = (map) => { const out = []; for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) out.push([x, y]); return out; };

// ------------------------------------------------------------------ dados
test('F7.2 dados: cada mapa tem id próprio, tipo válido e tamanho declarado; rota é só metadado e a tabela rota→mapa usa ids reais', () => {
    const real = REAL_ROUTES().map(r => r.id);
    for (const [id, map] of Object.entries(W.WORLD_MAPS)) {
        assert.equal(map.id, id, 'a chave é o id do MAPA');
        assert.ok(['city', 'route', 'hunt'].includes(map.type), `${id}: tipo ${map.type}`);
        if (map.routeId !== undefined) assert.ok(real.includes(map.routeId), `${map.routeId} (metadado) é uma rota existente`);
        assert.equal(map.rows.length, map.height);
        assert.ok(map.rows.every(r => r.length === map.width), 'todas as linhas têm a mesma largura');
    }
    for (const [routeId, mapId] of Object.entries(W.WORLD_ROUTE_MAPS)) {
        assert.ok(real.includes(routeId), `${routeId} é uma rota existente (route-data.js)`);
        assert.ok(W.getWorldMap(mapId), `${routeId} aponta para um mapa que existe`);
    }
    assert.equal(ROUTE.id, 'kanto_route1');
    assert.equal(ROUTE.routeId, 'kanto_route1', 'metadado preservado');
    assert.equal(ROUTE.type, 'route');
    assert.equal(TOWN.type, 'city');
    assert.equal(W.WORLD_START_MAP_ID, 'starter_town');
    assert.ok(W.getWorldMap(W.WORLD_START_MAP_ID), 'a área inicial existe');
    assert.equal(W.worldMapIdForRoute('kanto_route1'), 'kanto_route1');
    assert.deepEqual([ROUTE.width, ROUTE.height], [32, 24]);
    assert.deepEqual([TOWN.width, TOWN.height], [28, 20]);
    assert.equal(W.worldMapIdForRoute('johto_route29'), null, 'rotas sem mapa visual devolvem null');
    assert.equal(W.getWorldMap(null), null);
    assert.equal(W.getWorldMap('johto_route29'), null, 'não existe mapa com esse id');
    for (const bad of ['__proto__', 'constructor', 'toString']) { assert.equal(W.getWorldMap(bad), null); assert.equal(W.worldMapIdForRoute(bad), null); }
});

test('F7.2 dados: só letras conhecidas, ponto inicial andável e personagem com quadro para a direção', () => {
    for (const map of Object.values(W.WORLD_MAPS)) {
        for (const row of map.rows) for (const ch of row) assert.ok(W.WORLD_LEGEND[ch], `${map.id}: letra desconhecida ${ch}`);
        const { spawn } = map;
        assert.ok(spawn.x >= 0 && spawn.x < map.width && spawn.y >= 0 && spawn.y < map.height, `${map.id}: spawn dentro do mapa`);
        assert.ok(['ground', 'path'].includes(W.worldKindAt(map, spawn.x, spawn.y)), `${map.id}: o personagem não nasce em obstáculo`);
        assert.ok(W.WORLD_CHARACTER.frames[spawn.dir], `${map.id}: existe quadro para a direção inicial`);
        assert.equal(typeof map.label, 'string');
    }
});

test('F7.2 dados: as cenas têm variedade real (não são grade uniforme)', () => {
    const count = (map, ch) => map.rows.join('').split(ch).length - 1;
    const stats = (map) => { const kinds = new Set(), tiles = new Set(); for (const [x, y] of cells(map)) { kinds.add(W.worldKindAt(map, x, y)); tiles.add(W.worldResolveTile(map, x, y)); } return { kinds: [...kinds].sort(), tiles: tiles.size }; };
    const r = stats(ROUTE);
    assert.deepEqual(r.kinds, ['ground', 'object', 'path', 'water']);
    assert.ok(r.tiles >= 18, `rota: variedade de tiles ${r.tiles}`);
    for (const ch of ['p', '~', 'T', 'w', 'b', 'r', 'f', 'y', 's', '=']) assert.ok(count(ROUTE, ch) > 0, `rota: há "${ch}"`);
    assert.ok(count(ROUTE, '.') / (ROUTE.width * ROUTE.height) < 0.6, 'grama lisa não domina a rota');
    const t = stats(TOWN);
    assert.deepEqual(t.kinds, ['ground', 'object', 'path']);
    assert.ok(t.tiles >= 18, `cidade: variedade de tiles ${t.tiles}`);
    for (const ch of ['A', 'B', 'C', 'D', 'G', 'F', 'H', 'I', 'J', 'K', 'N', 'M', 'q', 'h', 'l', 'p', 'T']) assert.ok(count(TOWN, ch) > 0, `cidade: há "${ch}"`);
});

test('F7.2 assets: PNGs locais batem com o layout declarado e todos os índices existem no tileset', () => {
    const ts = W.WORLD_TILESET, ch = W.WORLD_CHARACTER;
    assert.deepEqual(pngSize(ts.src), { w: ts.cols * ts.tileSize, h: ts.rows * ts.tileSize });
    const hero = pngSize(ch.src);
    assert.equal(hero.h, ch.frameH);
    for (const f of Object.values(ch.frames)) assert.ok((f.col + 1) * ch.frameW <= hero.w && (f.row + 1) * ch.frameH <= hero.h, 'quadro dentro da folha');
    const capacity = ts.cols * ts.rows;
    for (const map of Object.values(W.WORLD_MAPS)) for (const [x, y] of cells(map)) {
        const i = W.worldResolveTile(map, x, y);
        assert.ok(Number.isInteger(i) && i >= 0 && i < capacity, `${map.id}: tile ${i} em (${x},${y})`);
    }
    for (const v of Object.values(ts.tiles).flat()) assert.ok(Number.isInteger(v) && v >= 0 && v < capacity, 'índice do tileset dentro da capacidade');
    assert.ok(!/https?:\/\//.test(ts.src + ch.src), 'assets locais, sem URL externa');
});

// ------------------------------------------------------------------ motor puro
test('F7.2 motor: autotile liga caminho e água, trata fora do mapa como continuação e varia grama/árvore de forma estável', () => {
    const T = W.WORLD_TILESET.tiles;
    const m = { width: 3, height: 3, rows: ['.p.', 'ppp', '.p.'] };
    assert.equal(W.worldResolveTile(m, 1, 1), T.pathBase + 15, 'cruzamento: todos os lados conectados');
    assert.equal(W.worldResolveTile(m, 1, 0), T.pathBase + (1 | 4), 'borda superior: fora do mapa conecta (N) e segue para baixo (S)');
    assert.equal(W.worldResolveTile(m, 0, 1), T.pathBase + (8 | 2), 'ponta esquerda: fora conecta (W) e segue para leste (E)');
    const lone = { width: 3, height: 3, rows: ['...', '.p.', '...'] };
    assert.equal(W.worldResolveTile(lone, 1, 1), T.pathBase, 'caminho isolado: nenhum vizinho');
    const pond = { width: 3, height: 3, rows: ['~~~', '~~~', '~~~'] };
    assert.equal(W.worldResolveTile(pond, 1, 1), T.waterBase + 15);
    assert.equal(W.worldResolveTile(ROUTE, 24, 12) >= T.waterBase, true);
    assert.equal(W.worldResolveTile(ROUTE, 2, 6), W.worldResolveTile(ROUTE, 2, 6), 'determinístico');
    assert.ok(T.tree.includes(W.worldResolveTile(ROUTE, 0, 0)));
    assert.equal(W.worldResolveTile(TOWN, 5, 3), T.roofRedL, 'prédios usam os tiles de cidade');
    assert.equal(W.worldResolveTile(TOWN, 6, 4), T.centerDoor);
    assert.equal(W.worldResolveTile({ width: 1, height: 1, rows: ['?'] }, 0, 0), T.grass[0], 'letra desconhecida cai na grama');
    const seen = new Set(); for (let x = 0; x < 40; x++) seen.add(W.worldResolveTile({ width: 40, height: 1, rows: ['.'.repeat(40)] }, x, 0));
    assert.ok(seen.size > 1, 'a grama varia entre células');
});

test('F7.2 motor: métricas usam zoom inteiro, buffer = css x dpr, dpr limitado e mapa pequeno aparece inteiro (F7.3)', () => {
    for (const [dpr, zoom] of [[1, 2], [1.5, 3], [2, 4], [3, 6]]) {
        const m = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr });
        assert.equal(m.zoom, zoom, `dpr ${dpr}`);
        assert.ok(Number.isInteger(m.zoom));
        assert.equal(m.bufferWidth, Math.round(374 * dpr));
        assert.equal(m.viewWidth, m.bufferWidth / m.zoom);
    }
    assert.equal(W.worldViewMetrics({ cssWidth: 100, cssHeight: 100, dpr: 5 }).dpr, 3, 'dpr limitado');
    assert.equal(W.worldViewMetrics({ cssWidth: 100, cssHeight: 100, dpr: NaN }).dpr, 1);
    assert.equal(W.worldViewMetrics({ cssWidth: 0, cssHeight: 0, dpr: 1 }).bufferWidth, 1, 'nunca buffer vazio');
    const desktop = W.worldViewMetrics({ cssWidth: 1216, cssHeight: 496, dpr: 1, mapWidth: 512, mapHeight: 384 });
    assert.equal(desktop.zoom, 2, 'F7.3: o mapa é maior que a vista em y com zoom 2 → mantém o zoom base e a câmera acompanha');
    const tiny = W.worldViewMetrics({ cssWidth: 1216, cssHeight: 496, dpr: 1, mapWidth: 160, mapHeight: 128 });
    assert.equal(tiny.zoom, 3, 'mapa que cabe inteiro usa o maior zoom inteiro em que ainda cabe');
    assert.ok(160 * tiny.zoom <= tiny.bufferWidth && 128 * tiny.zoom <= tiny.bufferHeight);
    assert.equal(W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 3, mapWidth: 512, mapHeight: 384 }).zoom, 6, 'celular: sem ajuste');
});

test('F7.2 motor: câmera segue o foco, respeita as bordas, centra mapa pequeno e cai em pixel inteiro do dispositivo', () => {
    const m = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 3 });
    const focus = W.worldCellCenter(ROUTE, ROUTE.spawn.x, ROUTE.spawn.y);
    const cam = W.worldCamera(ROUTE, m, focus);
    assert.ok(Math.abs(cam.x + m.viewWidth / 2 - focus.x) <= 1 / m.zoom, 'centrada em x');
    assert.ok(Number.isInteger(cam.x * m.zoom) && Number.isInteger(cam.y * m.zoom), 'sem frações de pixel do dispositivo');
    const mapW = ROUTE.width * 16, mapH = ROUTE.height * 16;
    const tl = W.worldCamera(ROUTE, m, { x: 0, y: 0 });                    // (objetos de outro contexto vm: compara campo a campo)
    assert.ok(tl.x === 0 && tl.y === 0, 'canto superior esquerdo');
    const br = W.worldCamera(ROUTE, m, { x: mapW, y: mapH });
    assert.ok(Math.abs(br.x - (mapW - m.viewWidth)) <= 1 / m.zoom && Math.abs(br.y - (mapH - m.viewHeight)) <= 1 / m.zoom, 'canto inferior direito');
    const tiny = { width: 2, height: 2 };
    const big = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 1 });
    const c2 = W.worldCamera(tiny, big, { x: 16, y: 16 });
    assert.ok(Math.abs(c2.x - (32 - big.viewWidth) / 2) <= 1 / big.zoom, 'mapa menor que a vista fica centrado (câmera negativa)');
    // seguindo o personagem: o foco anda e a câmera anda junto (cidade)
    const mt = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 3 });
    const a = W.worldCamera(TOWN, mt, { x: 216, y: 150 }), b = W.worldCamera(TOWN, mt, { x: 236, y: 150 });
    assert.ok(Math.abs(b.x - a.x - 20) <= 1 / mt.zoom, 'andou 20 px, a câmera andou 20 px');
});

test('F7.2 motor: conversão mundo↔tela é inversa e as células visíveis cobrem a vista sem sair do mapa', () => {
    const m = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 3 });
    const cam = W.worldCamera(ROUTE, m, W.worldCellCenter(ROUTE, 13, 18));
    for (const [wx, wy] of [[0, 0], [100, 200], [255, 383], [13.5 * 16, 18.5 * 16]]) {
        const s = W.worldToScreen(cam, m, wx, wy), back = W.worldFromScreen(cam, m, s.x, s.y);
        assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y));
        assert.ok(Math.abs(back.x - wx) <= 1 / m.zoom && Math.abs(back.y - wy) <= 1 / m.zoom);
    }
    const v = W.worldVisibleCells(ROUTE, cam, m);
    assert.ok(v.x0 >= 0 && v.y0 >= 0 && v.x1 <= ROUTE.width - 1 && v.y1 <= ROUTE.height - 1);
    assert.ok(v.x1 - v.x0 + 1 >= Math.floor(m.viewWidth / 16) && v.y1 - v.y0 + 1 >= Math.floor(m.viewHeight / 16), 'cobre a vista');
    const top = W.worldVisibleCells(ROUTE, { x: 0, y: 0 }, m);
    assert.deepEqual([top.x0, top.y0], [0, 0]);
});

// ------------------------------------------------------------------ ciclo de vida da view (DOM falso)
test('F7.2 view: ao abrir mostra a cidade e desenha uma vez (tiles visíveis + personagem), zoom inteiro, buffer certo e sem loop', async () => {
    const { env, view } = await shown();
    assert.equal(view.active, true);
    assert.equal(view.areaId, 'starter_town');
    assert.equal(view.drawCount, 1);
    assert.deepEqual([env.canvas.width, env.canvas.height], [1122, 1122], 'buffer = css x dpr');
    assert.equal(env.ctx.imageSmoothingEnabled, false, 'pixel art sem suavização');
    const player = view._player(TOWN);
    const cells2 = W.worldVisibleCells(TOWN, W.worldCamera(TOWN, view.lastMetrics, { x: player.x, y: player.y - 6 }), view.lastMetrics);
    assert.equal(env.draws.length, (cells2.x1 - cells2.x0 + 1) * (cells2.y1 - cells2.y0 + 1) + 1, 'um desenho por tile visível + o personagem');
    assert.ok(env.draws.every(d => d[7] % 6 === 0 && d[8] % 6 === 0), 'tamanhos de destino em múltiplos do zoom inteiro');
    assert.equal(env.message.hidden, true);
    assert.match(env.caption.textContent, /Cidade Inicial/);
    assert.match(env.canvas.attrs['aria-label'], /Cidade Inicial/);
    assert.equal(env.pending(), 0, 'nenhum quadro reagendado: não existe loop contínuo');
    assert.equal(env.observers.length, 1);
    assert.equal(env.listenerCount('visibilitychange'), 2, 'view + controles');
    assert.equal(env.controlsEl.hidden, false, 'controles visíveis na cidade');
    assert.equal(env.destination.children.length, Object.keys(W.WORLD_MAPS).length, 'seletor lista as áreas');
});

test('F7.2 view: nada mudou = nada redesenhado; resize, rota e volta da página redesenham', async () => {
    const { env, view, game } = await shown();
    view.requestRedraw(); env.flush();
    assert.equal(view.drawCount, 1, 'pedido sem mudança não redesenha');
    env.w = 500; env.h = 500; view.requestRedraw(); env.flush();
    assert.equal(view.drawCount, 2, 'resize redesenha');
    assert.deepEqual([env.canvas.width, env.canvas.height], [1500, 1500]);
    env.document.hidden = false;
    for (const f of env.listeners.visibilitychange) f();                  // a página voltou a ficar visível
    env.flush();
    assert.equal(view.drawCount, 3, 'ao voltar a ser visível, redesenha mesmo sem mudança (o canvas pode ter sido limpo)');
    game.emit('route_changed'); env.flush();
    assert.equal(view.drawCount, 3, 'mesma cena e mesma vista: sem desenho extra');
    assert.equal(env.pending(), 0);
});

test('F7.2 view: vários pedidos no mesmo quadro viram um desenho só', async () => {
    const { env, view } = await shown();
    env.w = 420; env.h = 420;
    for (let i = 0; i < 5; i++) view.requestRedraw();
    assert.equal(env.pending(), 1);
    env.flush();
    assert.equal(view.drawCount, 2);
});

test('F7.2 view: ao sair da aba tudo é solto (observador, ouvintes, assinatura do bus, quadro pendente, teclas)', async () => {
    const { env, view, game } = await shown();
    env.key('keydown', 'ArrowRight');                                     // uma tecla presa e um quadro pendente
    assert.equal(env.pending(), 1);
    assert.equal(view.controls.stack.size, 1);
    view.onHide();
    assert.equal(view.active, false);
    assert.equal(env.pending(), 0, 'quadro pendente cancelado');
    assert.equal(env.observers[0].disconnected, true);
    assert.equal(env.listenerCount('visibilitychange'), 0);
    assert.equal(env.listenerCount('keydown'), 0);
    assert.equal(env.listenerCount('keyup'), 0);
    assert.equal((env.winListeners.blur || new Set()).size, 0);
    assert.equal(env.root.listenerCount('pointerdown'), 0);
    assert.equal(game.subCount(), 0);
    assert.equal(view.controls.stack.size, 0, 'nenhuma tecla ficou presa');
    const draws = view.drawCount;
    game.emit('route_changed'); view.requestRedraw(true); env.flush();
    assert.equal(view.drawCount, draws, 'inativa: nenhum desenho');
    assert.equal(env.pending(), 0);
});

test('F7.2 view: reabrir a aba é idempotente (um observador ativo por vez) e redesenha', async () => {
    const { env, view, game } = await shown();
    view.onShow(); view.onShow();
    await tick(); env.flush();
    assert.equal(env.observers.filter(o => !o.disconnected).length, 1);
    assert.equal(env.listenerCount('visibilitychange'), 2);
    assert.equal(env.listenerCount('keydown'), 1);
    assert.equal(game.subCount(), 1);
    assert.ok(view.drawCount >= 2, 'a reabertura redesenha');
});

test('F7.2 view: sem ResizeObserver usa o resize da janela; aba escondida (tamanho 0) não desenha', async () => {
    const { env, view } = await shown({ observer: false });
    assert.equal(view.drawCount, 1);
    assert.equal((env.winListeners.resize || new Set()).size, 1, 'escuta o resize da janela');
    view.onHide();
    assert.equal(env.winListeners.resize.size, 0);
    view.onShow(); await tick(); env.w = 0; env.h = 0; env.flush();
    const before = view.drawCount;
    view.requestRedraw(true); env.flush();
    assert.equal(view.drawCount, before, 'tamanho 0 (aba escondida) não desenha');
});

test('F7.2 view: a falha ao carregar a imagem mostra uma mensagem e não quebra', async () => {
    const env = fakeEnv();
    env.globals.Image = class { set src(v) { Promise.resolve().then(() => this.onerror && this.onerror()); } };
    const game = fakeGame();
    const world = loadWorld(env.globals);
    const view = new world.WorldView(fakeUi(game));
    view.onShow(); await tick(); await tick(); env.flush();
    assert.equal(view.drawCount, 0);
    assert.equal(env.message.hidden, false);
    assert.match(env.message.textContent, /Não foi possível carregar/);
});
