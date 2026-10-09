'use strict';
// Fase 7.1: mundo visual. Dados do primeiro mapa, motor puro (autotile, métricas, câmera, coordenadas), assets locais
// e ciclo de vida da view (ativar, pausar, esconder aba/página, resize) com um DOM falso: sem navegador e sem loop.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadData } = require('../tools/load-context');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WORLD_FILES = ['js/world/world-data.js', 'js/world/world-engine.js', 'js/world/world-view.js'];
const EXPORTS = 'WORLD_TILE_SIZE, WORLD_TILESET, WORLD_CHARACTER, WORLD_LEGEND, WORLD_MAPS, WORLD_PREVIEW_MAP_ID, WORLD_ROUTE_MAPS, getWorldMap, worldMapIdForRoute, worldCharAt, worldKindAt, worldHash, worldResolveTile, worldViewMetrics, worldCamera, worldCellCenter, worldToScreen, worldFromScreen, worldVisibleCells, WorldView';

// Carrega os scripts clássicos do mundo num contexto vm (como o navegador faz com <script>)
function loadWorld(globals = {}) {
    const ctx = vm.createContext({ REGIONS: loadData().REGIONS, ...globals });
    return vm.runInContext(WORLD_FILES.map(read).join('\n;\n') + `\n;({ ${EXPORTS} })`, ctx);
}
const W = loadWorld();
const MAP = W.WORLD_MAPS.kanto_route1;
const pngSize = (file) => { const b = fs.readFileSync(path.join(ROOT, file)); assert.equal(b.toString('latin1', 1, 4), 'PNG'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

// ------------------------------------------------------------------ dados
test('F7.1 dados: cada mapa tem id próprio e tamanho declarado; a rota é só metadado e a tabela rota→mapa usa ids reais', () => {
    const { REGIONS } = loadData();
    const real = Object.values(REGIONS).flatMap(r => r.routes).map(r => r.id);
    for (const [id, map] of Object.entries(W.WORLD_MAPS)) {
        assert.equal(map.id, id, 'a chave é o id do MAPA');
        if (map.routeId !== undefined) assert.ok(real.includes(map.routeId), `${map.routeId} (metadado) é uma rota existente`);
        assert.equal(map.rows.length, map.height);
        assert.ok(map.rows.every(r => r.length === map.width), 'todas as linhas têm a mesma largura');
    }
    for (const [routeId, mapId] of Object.entries(W.WORLD_ROUTE_MAPS)) {
        assert.ok(real.includes(routeId), `${routeId} é uma rota existente (route-data.js)`);
        assert.ok(W.getWorldMap(mapId), `${routeId} aponta para um mapa que existe`);
    }
    assert.equal(MAP.id, 'kanto_route1');
    assert.equal(MAP.routeId, 'kanto_route1', 'metadado preservado');
    assert.equal(W.worldMapIdForRoute('kanto_route1'), 'kanto_route1');
    assert.equal(W.WORLD_PREVIEW_MAP_ID, 'kanto_route1');
    assert.ok(W.getWorldMap(W.WORLD_PREVIEW_MAP_ID), 'a prévia aponta para um mapa que existe');
    assert.deepEqual([MAP.width, MAP.height], [32, 24]);
    assert.equal(W.worldMapIdForRoute('johto_route29'), null, 'rotas sem mapa visual devolvem null');
    assert.equal(W.getWorldMap(null), null);
    assert.equal(W.getWorldMap('johto_route29'), null, 'não existe mapa com esse id');
    for (const bad of ['__proto__', 'constructor', 'toString']) { assert.equal(W.getWorldMap(bad), null); assert.equal(W.worldMapIdForRoute(bad), null); }
});

test('F7.1 dados: só letras conhecidas, ponto inicial válido e personagem com quadro para a direção', () => {
    for (const row of MAP.rows) for (const ch of row) assert.ok(W.WORLD_LEGEND[ch], `letra desconhecida: ${ch}`);
    const { spawn } = MAP;
    assert.ok(spawn.x >= 0 && spawn.x < MAP.width && spawn.y >= 0 && spawn.y < MAP.height, 'spawn dentro do mapa');
    assert.ok(['ground', 'path'].includes(W.worldKindAt(MAP, spawn.x, spawn.y)), 'o personagem não nasce em árvore, pedra ou água');
    assert.ok(W.WORLD_CHARACTER.frames[spawn.dir], 'existe quadro para a direção inicial');
    assert.equal(typeof MAP.label, 'string');
});

test('F7.1 dados: a cena tem variedade real (caminho, água, árvores, grama alta, objetos) e não é uma grade uniforme', () => {
    const kinds = new Set(), tiles = new Set();
    for (let y = 0; y < MAP.height; y++) for (let x = 0; x < MAP.width; x++) { kinds.add(W.worldKindAt(MAP, x, y)); tiles.add(W.worldResolveTile(MAP, x, y)); }
    assert.deepEqual([...kinds].sort(), ['ground', 'object', 'path', 'water']);
    assert.ok(tiles.size >= 18, `variedade de tiles: ${tiles.size}`);
    const count = (ch) => MAP.rows.join('').split(ch).length - 1;
    for (const ch of ['p', '~', 'T', 'w', 'b', 'r', 'f', 'y', 's', '=']) assert.ok(count(ch) > 0, `há "${ch}" no mapa`);
    assert.ok(count('.') / (MAP.width * MAP.height) < 0.6, 'grama lisa não domina o cenário');
});

test('F7.1 assets: PNGs locais batem com o layout declarado e todos os índices existem no tileset', () => {
    const ts = W.WORLD_TILESET, ch = W.WORLD_CHARACTER;
    assert.deepEqual(pngSize(ts.src), { w: ts.cols * ts.tileSize, h: ts.rows * ts.tileSize });
    const hero = pngSize(ch.src);
    assert.equal(hero.h, ch.frameH);
    for (const f of Object.values(ch.frames)) assert.ok((f.col + 1) * ch.frameW <= hero.w && (f.row + 1) * ch.frameH <= hero.h, 'quadro dentro da folha');
    const capacity = ts.cols * ts.rows;
    for (let y = 0; y < MAP.height; y++) for (let x = 0; x < MAP.width; x++) {
        const i = W.worldResolveTile(MAP, x, y);
        assert.ok(Number.isInteger(i) && i >= 0 && i < capacity, `tile ${i} em (${x},${y})`);
    }
    assert.ok(!/https?:\/\//.test(ts.src + ch.src), 'assets locais, sem URL externa');
});

// ------------------------------------------------------------------ motor puro
test('F7.1 motor: autotile liga caminho e água, trata fora do mapa como continuação e varia grama/árvore de forma estável', () => {
    const T = W.WORLD_TILESET.tiles;
    const m = { width: 3, height: 3, rows: ['.p.', 'ppp', '.p.'] };
    assert.equal(W.worldResolveTile(m, 1, 1), T.pathBase + 15, 'cruzamento: todos os lados conectados');
    assert.equal(W.worldResolveTile(m, 1, 0), T.pathBase + (1 | 4), 'borda superior: o lado de fora do mapa conecta (N) e o caminho segue para baixo (S); grama a leste e oeste');
    assert.equal(W.worldResolveTile(m, 0, 1), T.pathBase + (8 | 2), 'ponta esquerda: o lado de fora conecta (W) e o caminho segue para leste (E)');
    const lone = { width: 3, height: 3, rows: ['...', '.p.', '...'] };
    assert.equal(W.worldResolveTile(lone, 1, 1), T.pathBase, 'caminho isolado: nenhum vizinho');
    const pond = { width: 3, height: 3, rows: ['~~~', '~~~', '~~~'] };
    assert.equal(W.worldResolveTile(pond, 1, 1), T.waterBase + 15);
    assert.equal(W.worldResolveTile(W.WORLD_MAPS.kanto_route1, 24, 12) >= T.waterBase, true);
    const a = W.worldResolveTile(MAP, 2, 6), b = W.worldResolveTile(MAP, 2, 6);
    assert.equal(a, b, 'determinístico');
    assert.ok(T.tree.includes(W.worldResolveTile(MAP, 0, 0)));
    assert.equal(W.worldResolveTile({ width: 1, height: 1, rows: ['?'] }, 0, 0), T.grass[0], 'letra desconhecida cai na grama');
    const seen = new Set(); for (let x = 0; x < 40; x++) seen.add(W.worldResolveTile({ width: 40, height: 1, rows: ['.'.repeat(40)] }, x, 0));
    assert.ok(seen.size > 1, 'a grama varia entre células');
});

test('F7.1 motor: métricas usam zoom inteiro, buffer = css x dpr, dpr limitado e mapa pequeno cobre o painel', () => {
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
    assert.equal(desktop.zoom, 3, 'sobe de 2 para 3: o mapa de 512 px cobre 1216 px');
    assert.ok(512 * desktop.zoom >= desktop.bufferWidth && 384 * desktop.zoom >= desktop.bufferHeight);
    assert.equal(W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 3, mapWidth: 512, mapHeight: 384 }).zoom, 6, 'celular: sem ajuste');
});

test('F7.1 motor: câmera centra no foco, respeita as bordas, centra mapa pequeno e cai em pixel inteiro do dispositivo', () => {
    const m = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 3 });
    const focus = W.worldCellCenter(MAP, MAP.spawn.x, MAP.spawn.y);
    const cam = W.worldCamera(MAP, m, focus);
    assert.ok(Math.abs(cam.x + m.viewWidth / 2 - focus.x) <= 1 / m.zoom, 'centrada em x');
    assert.ok(Number.isInteger(cam.x * m.zoom) && Number.isInteger(cam.y * m.zoom), 'sem frações de pixel do dispositivo');
    const mapW = MAP.width * 16, mapH = MAP.height * 16;
    const tl = W.worldCamera(MAP, m, { x: 0, y: 0 });                    // (objetos de outro contexto vm: compara campo a campo)
    assert.ok(tl.x === 0 && tl.y === 0, 'canto superior esquerdo');
    const br = W.worldCamera(MAP, m, { x: mapW, y: mapH });
    assert.ok(Math.abs(br.x - (mapW - m.viewWidth)) <= 1 / m.zoom && Math.abs(br.y - (mapH - m.viewHeight)) <= 1 / m.zoom, 'canto inferior direito');
    const tiny = { width: 2, height: 2 };
    const big = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 1 });
    const c2 = W.worldCamera(tiny, big, { x: 16, y: 16 });
    assert.ok(Math.abs(c2.x - (32 - big.viewWidth) / 2) <= 1 / big.zoom, 'mapa menor que a vista fica centrado (câmera negativa)');
});

test('F7.1 motor: conversão mundo↔tela é inversa e as células visíveis cobrem a vista sem sair do mapa', () => {
    const m = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 3 });
    const cam = W.worldCamera(MAP, m, W.worldCellCenter(MAP, 13, 18));
    for (const [wx, wy] of [[0, 0], [100, 200], [255, 383], [13.5 * 16, 18.5 * 16]]) {
        const s = W.worldToScreen(cam, m, wx, wy), back = W.worldFromScreen(cam, m, s.x, s.y);
        assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y));
        assert.ok(Math.abs(back.x - wx) <= 1 / m.zoom && Math.abs(back.y - wy) <= 1 / m.zoom);
    }
    const v = W.worldVisibleCells(MAP, cam, m);
    assert.ok(v.x0 >= 0 && v.y0 >= 0 && v.x1 <= MAP.width - 1 && v.y1 <= MAP.height - 1);
    assert.ok(v.x1 - v.x0 + 1 >= Math.floor(m.viewWidth / 16) && v.y1 - v.y0 + 1 >= Math.floor(m.viewHeight / 16), 'cobre a vista');
    const top = W.worldVisibleCells(MAP, { x: 0, y: 0 }, m);
    assert.deepEqual([top.x0, top.y0], [0, 0]);
});

// ------------------------------------------------------------------ ciclo de vida da view (DOM falso)
function fakeEnv({ width = 374, height = 374, dpr = 3, observer = true } = {}) {
    const env = { w: width, h: height, frames: [], listeners: {}, winListeners: {}, observers: [], draws: [], fills: 0, ctx: null, canvas: null, message: { hidden: true, textContent: '' }, caption: { textContent: '' } };
    env.ctx = { imageSmoothingEnabled: true, fillStyle: '', fillRect() { env.fills++; }, drawImage(...a) { env.draws.push(a); } };
    env.canvas = { width: 300, height: 150, attrs: {}, getContext: () => env.ctx, setAttribute(k, v) { this.attrs[k] = v; }, getBoundingClientRect: () => ({ width: env.w, height: env.h }) };
    const viewport = { getBoundingClientRect: () => ({ width: env.w + 4, height: env.h + 4 }) };   // com borda: maior que o canvas
    const root = { innerHTML: '', querySelector: (sel) => ({ '#world-viewport': viewport, '#world-canvas': env.canvas, '#world-message': env.message, '#world-caption': env.caption })[sel] };
    const reg = (store) => ({ addEventListener(t, f) { (store[t] ||= new Set()).add(f); }, removeEventListener(t, f) { if (store[t]) store[t].delete(f); } });
    env.document = { hidden: false, getElementById: (id) => (id === 'world-panel' ? root : null), ...reg(env.listeners) };
    env.window = { devicePixelRatio: dpr, ...reg(env.winListeners) };
    class FakeImage { set src(v) { this._src = v; Promise.resolve().then(() => this.onload && this.onload()); } }
    class FakeObserver { constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; env.observers.push(this); } observe(t) { this.targets.push(t); } disconnect() { this.disconnected = true; } }
    env.globals = { document: env.document, window: env.window, Image: FakeImage, requestAnimationFrame: (fn) => { env.frames.push(fn); return env.frames.length; }, cancelAnimationFrame: (id) => { env.frames[id - 1] = null; }, setTimeout, clearTimeout };
    if (observer) env.globals.ResizeObserver = FakeObserver;
    env.flush = () => { const run = env.frames.filter(Boolean); env.frames.length = 0; run.forEach(fn => fn()); };
    env.listenerCount = (t) => (env.listeners[t] ? env.listeners[t].size : 0);
    return env;
}
function fakeGame(routeId = 'kanto_route1') {
    const { REGIONS } = loadData();
    const subs = new Set();
    const game = {
        gameState: { currentRoute: routeId },
        bus: { on(type, fn) { const e = { type, fn }; subs.add(e); return () => subs.delete(e); } },
        getRoute: (id) => Object.values(REGIONS).flatMap(r => r.routes).find(r => r.id === id) || null,
        emit(type) { for (const e of [...subs]) if (e.type === type) e.fn({ type }); },
        subCount: () => subs.size,
    };
    for (const name of ['changeRoute', 'selectHuntRoute', 'startBattle', 'dispatchAutomationAction', 'save']) game[name] = () => { throw new Error(`a view não pode chamar ${name}`); };
    return game;
}
const tick = () => new Promise(r => setTimeout(r, 0));
async function shown(opts) {
    const env = fakeEnv(opts), game = fakeGame(opts && opts.route);
    const { WorldView: View } = loadWorld(env.globals);
    const view = new View({ game });
    view.onShow();
    await tick();                        // as imagens (falsas) carregam
    env.flush();
    return { env, game, view };
}

test('F7.1 view: ao abrir desenha uma vez (tiles visíveis + personagem), com zoom inteiro, buffer no tamanho certo e sem loop', async () => {
    const { env, view } = await shown();
    assert.equal(view.active, true);
    assert.equal(view.drawCount, 1);
    assert.deepEqual([env.canvas.width, env.canvas.height], [1122, 1122], 'buffer = css x dpr');
    assert.equal(env.ctx.imageSmoothingEnabled, false, 'pixel art sem suavização');
    const cells = W.worldVisibleCells(MAP, W.worldCamera(MAP, view.lastMetrics, W.worldCellCenter(MAP, MAP.spawn.x, MAP.spawn.y)), view.lastMetrics);
    assert.equal(env.draws.length, (cells.x1 - cells.x0 + 1) * (cells.y1 - cells.y0 + 1) + 1, 'um desenho por tile visível + o personagem');
    assert.ok(env.draws.every(d => d[7] % 6 === 0 && d[8] % 6 === 0), 'tamanhos de destino em múltiplos do zoom inteiro');
    assert.equal(env.message.hidden, true);
    assert.match(env.caption.textContent, /Rota 1/);
    assert.match(env.canvas.attrs['aria-label'], /Rota 1/);
    assert.equal(env.frames.length, 0, 'nenhum quadro reagendado: não existe loop contínuo');
    assert.equal(env.observers.length, 1);
    assert.equal(env.listenerCount('visibilitychange'), 1);
});

test('F7.1 view: nada mudou = nada redesenhado; resize, rota e volta da página redesenham', async () => {
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
    assert.equal(env.frames.length, 0);
});

test('F7.1 view: vários pedidos no mesmo quadro viram um desenho só', async () => {
    const { env, view } = await shown();
    env.w = 420; env.h = 420;
    for (let i = 0; i < 5; i++) view.requestRedraw();
    assert.equal(env.frames.filter(Boolean).length, 1);
    env.flush();
    assert.equal(view.drawCount, 2);
});

test('F7.1 view: rota sem mapa mostra a prévia da Rota 1 e NÃO altera a rota nem chama o núcleo', async () => {
    const { env, view, game } = await shown({ route: 'johto_route29' });
    assert.equal(game.gameState.currentRoute, 'johto_route29', 'a rota do jogo continua a mesma');
    assert.match(env.caption.textContent, /Prévia visual: Rota 1/);
    assert.match(env.caption.textContent, /Rota atual|rota atual/);
    assert.equal(view.drawCount, 1, 'desenhou a prévia');
    game.gameState.currentRoute = 'kanto_route1'; game.emit('route_changed'); env.flush();
    assert.match(env.caption.textContent, /Você está em: Rota 1/);
});

test('F7.1 view: um mapa sem rota relacionada, de outro tamanho e ligado a uma rota pela tabela é desenhado (mapa ≠ rota)', async () => {
    const env = fakeEnv({ route: 'johto_route29' }), game = fakeGame('johto_route29');
    const world = loadWorld(env.globals);
    world.WORLD_MAPS.hunt_demo = { id: 'hunt_demo', name: 'Mapa de caça de teste', width: 20, height: 15, spawn: { x: 3, y: 3, dir: 'down' },
        rows: Array.from({ length: 15 }, (_, y) => (y === 0 || y === 14 ? 'T'.repeat(20) : 'T' + '.'.repeat(18) + 'T')) };
    world.WORLD_ROUTE_MAPS.johto_route29 = 'hunt_demo';
    const view = new world.WorldView({ game });
    view.onShow(); await tick(); env.flush();
    assert.equal(view.currentScene().map.id, 'hunt_demo');
    assert.equal(view.currentScene().preview, false, 'tem mapa próprio, não é prévia');
    assert.match(env.caption.textContent, /Você está em: Mapa de caça de teste/);
    assert.match(env.canvas.attrs['aria-label'], /Mapa de caça de teste/);
    assert.equal(view.drawCount, 1);
    assert.ok(env.draws.length > 1);
    assert.equal(game.gameState.currentRoute, 'johto_route29', 'a rota do jogo não mudou');
    // trocar a rota para outra sem mapa volta à prévia; a identidade do desenho é o id do MAPA
    game.gameState.currentRoute = 'johto_route30'; game.emit('route_changed'); env.flush();
    assert.equal(view.currentScene().map.id, 'kanto_route1');
    assert.equal(view.currentScene().preview, true);
    assert.equal(view.drawCount, 2, 'mapa diferente redesenha');
});

test('F7.1 view: ao sair da aba tudo é solto (observador, escuta de visibilidade, assinatura do bus, quadro pendente)', async () => {
    const { env, view, game } = await shown();
    env.w = 400; view.requestRedraw();                                    // deixa um quadro pendente
    assert.equal(env.frames.filter(Boolean).length, 1);
    view.onHide();
    assert.equal(view.active, false);
    assert.equal(env.frames.filter(Boolean).length, 0, 'quadro pendente cancelado');
    assert.equal(env.observers[0].disconnected, true);
    assert.equal(env.listenerCount('visibilitychange'), 0);
    assert.equal(game.subCount(), 0);
    const draws = view.drawCount;
    game.emit('route_changed'); view.requestRedraw(true); env.flush();
    assert.equal(view.drawCount, draws, 'inativa: nenhum desenho');
    assert.equal(env.frames.length, 0);
});

test('F7.1 view: reabrir a aba é idempotente (um observador ativo por vez) e redesenha', async () => {
    const { env, view, game } = await shown();
    view.onShow(); view.onShow();
    await tick(); env.flush();
    assert.equal(env.observers.filter(o => !o.disconnected).length, 1);
    assert.equal(env.listenerCount('visibilitychange'), 1);
    assert.equal(game.subCount(), 1);
    assert.ok(view.drawCount >= 2, 'a reabertura redesenha');
});

test('F7.1 view: sem ResizeObserver usa o resize da janela; aba escondida (tamanho 0) não desenha', async () => {
    const env = fakeEnv({ observer: false });
    const game = fakeGame();
    const { WorldView: View } = loadWorld(env.globals);
    const view = new View({ game });
    view.onShow(); await tick(); env.flush();
    assert.equal(view.drawCount, 1);
    assert.equal((env.winListeners.resize || new Set()).size, 1, 'escuta o resize da janela');
    view.onHide();
    assert.equal(env.winListeners.resize.size, 0);
    view.onShow(); await tick(); env.w = 0; env.h = 0; env.flush();
    const before = view.drawCount;
    view.requestRedraw(true); env.flush();
    assert.equal(view.drawCount, before, 'tamanho 0 (aba escondida) não desenha');
});

test('F7.1 view: a falha ao carregar a imagem mostra uma mensagem e não quebra', async () => {
    const env = fakeEnv();
    env.globals.Image = class { set src(v) { Promise.resolve().then(() => this.onerror && this.onerror()); } };
    const game = fakeGame();
    const { WorldView: View } = loadWorld(env.globals);
    const view = new View({ game });
    view.onShow(); await tick(); await tick(); env.flush();
    assert.equal(view.drawCount, 0);
    assert.equal(env.message.hidden, false);
    assert.match(env.message.textContent, /Não foi possível carregar/);
});
