// ============================================================
// Mundo visual · view + renderer (Fase 7.1). Vive dentro da aba Mapa e é PASSIVO: só lê o estado do jogo
// (rota atual) e desenha. Não muda currentRoute, não inicia batalha, não concede nada e não toca nos loops do núcleo.
//   - Canvas 2D, pixel art com zoom inteiro (ver worldViewMetrics); buffer = tamanho CSS x devicePixelRatio;
//   - redesenho SOB DEMANDA (abrir a aba, resize, rota mudou, página voltou a ficar visível): não há loop contínuo,
//     então nada roda por frame enquanto a cena está parada (bateria);
//   - ciclo de vida igual ao HuntView: onShow()/onHide() chamados por GameUI.switchTab; fora da aba não há observador,
//     assinatura nem redesenho.
// ============================================================
class WorldView {
    constructor(ui) {
        this.ui = ui;
        this.game = ui.game;
        this.root = document.getElementById('world-panel');
        this.active = false;
        this.drawCount = 0;                // diagnóstico/testes: quantos desenhos reais ocorreram
        this.lastMetrics = null;
        this._unsubs = [];
        this._observer = null;
        this._raf = null;
        this._lastKey = null;
        this._onVisibility = () => { if (!document.hidden) this.requestRedraw(true); };
        this._onWindowResize = () => this.requestRedraw();
        if (!this.root) return;
        this.root.innerHTML = `
            <h2>🧭 Mundo</h2>
            <div id="world-viewport" class="world-viewport">
                <canvas id="world-canvas" role="img"></canvas>
                <div id="world-message" class="world-message" hidden></div>
            </div>
            <div id="world-caption" class="world-caption"></div>`;
        this.viewport = this.root.querySelector('#world-viewport');
        this.canvas = this.root.querySelector('#world-canvas');
        this.message = this.root.querySelector('#world-message');
        this.caption = this.root.querySelector('#world-caption');
    }

    // ---------- ciclo de vida ----------
    onShow() {
        if (!this.root || !this.game.gameState) return;
        this.onHide();                                         // idempotente: nunca duplica observadores
        this.active = true;
        this._unsubs.push(this.game.bus.on('route_changed', () => this.requestRedraw()));
        if (typeof ResizeObserver !== 'undefined') {
            this._observer = new ResizeObserver(() => this.requestRedraw());
            this._observer.observe(this.viewport);
        } else {
            window.addEventListener('resize', this._onWindowResize);
        }
        document.addEventListener('visibilitychange', this._onVisibility);
        WorldView.loadAssets().then(() => this.requestRedraw(true), () => this.requestRedraw(true));
        this.requestRedraw(true);
    }

    onHide() {
        this.active = false;
        for (const off of this._unsubs) off();
        this._unsubs = [];
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        if (typeof window !== 'undefined') window.removeEventListener('resize', this._onWindowResize);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
        if (this._raf !== null) { WorldView._cancelFrame(this._raf); this._raf = null; }
    }

    // Agenda UM desenho (agrupa vários pedidos no mesmo quadro). force=true ignora o "nada mudou".
    requestRedraw(force = false) {
        if (!this.active) return;
        if (force) this._lastKey = null;
        if (this._raf !== null) return;
        this._raf = WorldView._nextFrame(() => { this._raf = null; if (this.active) this.draw(); });
    }

    static _nextFrame(fn) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16); }
    static _cancelFrame(id) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id); }

    // ---------- assets (locais; carregados uma vez) ----------
    static loadAssets() {
        if (!WorldView._assets) {
            WorldView.failed = false;
            const load = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('falha ao carregar ' + src)); img.src = src; });
            WorldView._assets = Promise.all([load(WORLD_TILESET.src), load(WORLD_CHARACTER.src)]).then(([tileset, hero]) => { WorldView.images = { tileset, hero }; return WorldView.images; });
            WorldView._assets.catch(() => { WorldView._assets = null; WorldView.failed = true; });   // permite tentar de novo ao reabrir a aba
        }
        return WorldView._assets;
    }

    // ---------- qual cena mostrar ----------
    // Mapa da rota atual; sem mapa visual ainda → prévia da primeira área (sem alterar a rota do jogo)
    currentScene() {
        const routeId = this.game.gameState && this.game.gameState.currentRoute;
        const own = getWorldMap(worldMapIdForRoute(routeId));
        const map = own || getWorldMap(WORLD_PREVIEW_MAP_ID);
        return { map, preview: !own, routeId };
    }

    // Título do mapa: da rota relacionada (se houver) ou do próprio mapa
    _mapTitle(map) {
        return (map.routeId && this._routeLabel(map.routeId)) || map.name || map.id;
    }

    _routeLabel(routeId) {
        const route = this.game.getRoute(routeId);
        if (!route) return '';
        let region = '';
        for (const key in REGIONS) if (REGIONS[key].routes.some(r => r.id === routeId)) { region = REGIONS[key].name; break; }
        return region ? `${route.name} · ${region}` : route.name;
    }

    // ---------- desenho ----------
    draw() {
        if (!this.active || !this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();   // o canvas (não o contêiner com borda): buffer = tamanho exibido x dpr, sem escala fracionária
        if (!(rect.width > 0 && rect.height > 0)) return;     // aba escondida: nada a desenhar
        const images = WorldView.images;
        const { map, preview, routeId } = this.currentScene();
        this._updateCaption(map, preview, routeId);
        if (!images) { this._showMessage(WorldView.failed ? 'Não foi possível carregar o cenário.' : 'Carregando o cenário…'); return; }

        const metrics = worldViewMetrics({ cssWidth: rect.width, cssHeight: rect.height, dpr: window.devicePixelRatio, mapWidth: map.width * WORLD_TILE_SIZE, mapHeight: map.height * WORLD_TILE_SIZE });
        const camera = worldCamera(map, metrics, worldCellCenter(map, map.spawn.x, map.spawn.y));
        const key = [map.id, metrics.bufferWidth, metrics.bufferHeight, metrics.zoom, camera.x, camera.y, map.spawn.dir].join('|');
        if (key === this._lastKey) return;                    // nada mudou: não redesenha
        this._lastKey = key;

        const canvas = this.canvas;
        if (canvas.width !== metrics.bufferWidth || canvas.height !== metrics.bufferHeight) { canvas.width = metrics.bufferWidth; canvas.height = metrics.bufferHeight; }
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#14202b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const ts = metrics.tileSize, z = metrics.zoom, cols = WORLD_TILESET.cols;
        const cells = worldVisibleCells(map, camera, metrics);
        for (let y = cells.y0; y <= cells.y1; y++) {
            for (let x = cells.x0; x <= cells.x1; x++) {
                const index = worldResolveTile(map, x, y);
                const at = worldToScreen(camera, metrics, x * ts, y * ts);
                ctx.drawImage(images.tileset, (index % cols) * ts, Math.floor(index / cols) * ts, ts, ts, at.x, at.y, ts * z, ts * z);
            }
        }
        this._drawCharacter(ctx, images.hero, map, camera, metrics);
        this.lastMetrics = metrics;
        this.drawCount++;
        this._hideMessage();
        this.canvas.setAttribute('aria-label', `Cenário de ${this._mapTitle(map)}${map.label ? ': ' + map.label : ''}. Um treinador está parado no caminho.`);
    }

    // O pé do personagem fica no centro da célula, um pouco abaixo (cabeça invade a célula de cima)
    _drawCharacter(ctx, sheet, map, camera, metrics) {
        const ch = WORLD_CHARACTER, ts = metrics.tileSize;
        const frame = ch.frames[map.spawn.dir] || ch.frames.down;
        const feetX = map.spawn.x * ts + ts / 2, feetY = map.spawn.y * ts + ts - 3;
        const at = worldToScreen(camera, metrics, feetX - ch.anchor.x, feetY - ch.anchor.y);
        ctx.drawImage(sheet, frame.col * ch.frameW, frame.row * ch.frameH, ch.frameW, ch.frameH, at.x, at.y, ch.frameW * metrics.zoom, ch.frameH * metrics.zoom);
    }

    _updateCaption(map, preview, routeId) {
        const here = this._mapTitle(map);
        this.caption.textContent = preview
            ? `Prévia visual: ${here}. Sua rota atual (${this._routeLabel(routeId) || '—'}) ainda não tem mapa visual; escolha rotas e regiões na lista abaixo.`
            : `Você está em: ${here}. Escolha rotas e regiões na lista abaixo.`;
    }

    _showMessage(text) { this.message.textContent = text; this.message.hidden = false; }
    _hideMessage() { this.message.hidden = true; }
}
WorldView._assets = null;
WorldView.images = null;
WorldView.failed = false;
