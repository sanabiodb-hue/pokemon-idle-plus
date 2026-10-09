'use strict';
// Ambiente falso para testar o mundo visual sem navegador: DOM mínimo, quadros de animação controlados à mão,
// jogo falso (que LANÇA se a view chamar algo que ela não pode chamar) e ui falsa.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadData } = require('../../tools/load-context');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const WORLD_FILES = ['js/world/world-data.js', 'js/world/world-biomes.js', 'js/world/world-gen.js', 'js/world/world-engine.js', 'js/world/world-encounters.js', 'js/world/world-controls.js', 'js/world/world-view.js'];
const EXPORTS = `WORLD_TILE_SIZE, WORLD_TILESET, WORLD_CHARACTER, WORLD_LEGEND, WORLD_MAPS, WORLD_ROUTE_MAPS, WORLD_START_MAP_ID, WORLD_MOVEMENT,
    getWorldMap, worldMapIdForRoute, worldCharAt, worldKindAt, worldHash, worldResolveTile, worldViewMetrics, worldCamera, worldCameraFocus, worldCellCenter,
    worldToScreen, worldFromScreen, worldVisibleCells, worldCanWalkManually, worldCellBlocked, worldCreateState, worldMoveBy, worldStep,
    worldAdvanceToward, POKEMON_DATA, REGIONS, worldPathLength, WORLD_GEN_VERSION, WORLD_GEN_LIMITS, WORLD_BIOME_FALLBACK, WORLD_TYPE_BIOME, WORLD_TYPE_PRIORITY, WORLD_BIOMES,
    worldFindPath, worldCellFoot, worldPathWaypoints, worldPolylineLength, worldPathPosition, worldVerifyPath, WORLD_PATH_NEIGHBORS,
    worldHuntSeed, worldRng, worldStringSeed, WorldEncounters, WORLD_ENCOUNTER_STATES, worldEncounterCandidates, worldPickEncounterPoint, worldEncounterOrigin, worldBiomeForTypes, worldGenerateHuntMap, worldHuntMap, worldHuntMapById, worldHuntStats, worldHuntCacheClear, worldPathLength, worldTravelTimeMs, worldInteractionNear, DirectionStack, WorldControls, WorldView`;

// Carrega os scripts clássicos do mundo num contexto vm (como o navegador faz com <script>)
function loadWorld(globals = {}) {
    const data = loadData();
    const ctx = vm.createContext({ REGIONS: data.REGIONS, POKEMON_DATA: data.POKEMON_DATA, ...globals });
    return vm.runInContext(WORLD_FILES.map(read).join('\n;\n') + `\n;({ ${EXPORTS} })`, ctx);
}

function fakeElement(extra = {}) {
    const el = {
        hidden: false, disabled: false, textContent: '', value: '', dataset: {}, children: [], listeners: {}, blurred: false, _html: '',
        addEventListener(t, f) { (this.listeners[t] ||= new Set()).add(f); },
        removeEventListener(t, f) { if (this.listeners[t]) this.listeners[t].delete(f); },
        appendChild(c) { this.children.push(c); },
        blur() { this.blurred = true; },
        listenerCount(t) { return this.listeners[t] ? this.listeners[t].size : 0; },
        fire(t, ev = {}) { const e = ev.target ? ev : { target: this, ...ev }; for (const f of [...(this.listeners[t] || [])]) f(e); return e; },
        ...extra,
    };
    Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; if (v === '') this.children = []; } });
    return el;
}

function fakeEnv({ width = 374, height = 374, dpr = 3, observer = true } = {}) {
    const env = { w: width, h: height, now: 1000, frames: [], listeners: {}, winListeners: {}, observers: [], draws: [], fills: 0 };
    env.ctx = { imageSmoothingEnabled: true, fillStyle: '', fillRect() { env.fills++; }, drawImage(...a) { env.draws.push(a); } };
    env.canvas = fakeElement({ width: 300, height: 150, attrs: {}, getContext: () => env.ctx, setAttribute(k, v) { this.attrs[k] = v; }, getBoundingClientRect: () => ({ width: env.w, height: env.h }) });
    env.viewport = fakeElement({ getBoundingClientRect: () => ({ width: env.w + 4, height: env.h + 4 }) });   // com borda: maior que o canvas
    env.message = fakeElement({ hidden: true });
    env.caption = fakeElement();
    env.hint = fakeElement();
    env.controlsEl = fakeElement();
    env.interactBtn = fakeElement({ disabled: true });
    env.destination = fakeElement();
    env.encounterBox = fakeElement({ hidden: true });
    env.encounterBtn = fakeElement();
    env.encounterStatus = fakeElement();
    env.encounterBar = fakeElement({ hidden: true, firstElementChild: { style: {} }, setAttribute(k, v) { (this.attrs ||= {})[k] = v; } });
    env.huntInput = fakeElement();
    env.huntResults = fakeElement();
    const parts = { '#world-viewport': env.viewport, '#world-canvas': env.canvas, '#world-message': env.message, '#world-caption': env.caption, '#world-hint': env.hint, '#world-controls': env.controlsEl, '#world-interact': env.interactBtn, '#world-destination': env.destination, '#world-encounter': env.encounterBox, '#world-encounter-btn': env.encounterBtn, '#world-encounter-status': env.encounterStatus, '#world-encounter-bar': env.encounterBar, '#world-hunt-input': env.huntInput, '#world-hunt-results': env.huntResults };
    env.root = fakeElement({ querySelector: (sel) => parts[sel] || null });
    const reg = (store) => ({ addEventListener(t, f) { (store[t] ||= new Set()).add(f); }, removeEventListener(t, f) { if (store[t]) store[t].delete(f); } });
    env.document = { hidden: false, getElementById: (id) => (id === 'world-panel' ? env.root : null), createElement: (tag) => fakeElement({ tagName: tag.toUpperCase() }), ...reg(env.listeners) };
    env.window = { devicePixelRatio: dpr, ...reg(env.winListeners) };
    class FakeImage { set src(v) { this._src = v; Promise.resolve().then(() => this.onload && this.onload()); } }
    class FakeObserver { constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; env.observers.push(this); } observe(t) { this.targets.push(t); } disconnect() { this.disconnected = true; } }
    env.globals = { document: env.document, window: env.window, Image: FakeImage, requestAnimationFrame: (fn) => { env.frames.push(fn); return env.frames.length; }, cancelAnimationFrame: (id) => { env.frames[id - 1] = null; }, setTimeout, clearTimeout };
    if (observer) env.globals.ResizeObserver = FakeObserver;
    // Executa os quadros pendentes; cada um recebe um timestamp que avança `ms` (como o rAF do navegador)
    env.flush = (ms = 16) => { const run = env.frames.filter(Boolean); env.frames.length = 0; env.now += ms; run.forEach(fn => fn(env.now)); };
    env.pending = () => env.frames.filter(Boolean).length;
    env.listenerCount = (t) => (env.listeners[t] ? env.listeners[t].size : 0);
    env.key = (type, code, extra = {}) => { const ev = { code, key: extra.key || code, target: extra.target || { tagName: 'BODY' }, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const f of [...(env.listeners[type] || [])]) f(ev); return ev; };
    return env;
}

const REAL_ROUTES = () => Object.values(loadData().REGIONS).flatMap(r => r.routes);

function fakeGame(routeId = 'kanto_route1', extra = {}) {
    const routes = REAL_ROUTES();
    const subs = new Set();
    const game = {
        gameState: { currentRoute: routeId },
        bus: { on(type, fn) { const e = { type, fn }; subs.add(e); return () => subs.delete(e); } },
        getRoute: (id) => routes.find(r => r.id === id) || null,
        emit(type) { for (const e of [...subs]) if (e.type === type) e.fn({ type }); },
        subCount: () => subs.size,
        isRegionUnlocked: () => true,
        healCalls: 0,
        healResult: { ok: true, amount: 7, revived: false },
        healAtCenter() { this.healCalls++; return this.healResult; },
        ...extra,
    };
    for (const name of ['changeRoute', 'selectHuntRoute', 'startBattle', 'dispatchAutomationAction', 'save']) game[name] = () => { throw new Error(`a view não pode chamar ${name}`); };
    return game;
}

function fakeUi(game) {
    return { game, toasts: [], tabs: [], showToast(t) { this.toasts.push(t); }, switchTab(t) { this.tabs.push(t); } };
}

const tick = () => new Promise(r => setTimeout(r, 0));

// View aberta (onShow) com as imagens falsas já carregadas e o primeiro quadro desenhado
async function shown(opts = {}) {
    // opts.gameObject = jogo real (GameCore) no lugar do falso; opts.encounters = liga a lógica de encontros (ui.worldEncounters)
    const env = fakeEnv(opts), game = opts.gameObject || fakeGame(opts.route, opts.game), ui = fakeUi(game);
    const world = loadWorld({ ...env.globals, ...(opts.globals || {}) });
    if (opts.setup) opts.setup(world);
    if (opts.encounters) ui.worldEncounters = new world.WorldEncounters(game);
    const view = new world.WorldView(ui);
    view.onShow();
    await tick();
    env.flush();
    return { env, game, ui, view, world, encounters: ui.worldEncounters || null };
}

module.exports = { ROOT, loadWorld, fakeEnv, fakeGame, fakeUi, fakeElement, tick, shown, REAL_ROUTES };
