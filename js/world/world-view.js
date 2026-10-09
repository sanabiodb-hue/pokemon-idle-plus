// ============================================================
// Mundo visual · view + renderer (Fases 7.1 e 7.2). Vive dentro da aba Mapa.
//   - Canvas 2D, pixel art com zoom inteiro (ver worldViewMetrics); buffer = tamanho CSS x devicePixelRatio;
//   - o estado do personagem (posição, direção, distância) é do MOTOR (world-engine.js), não do desenho: aqui só se lê;
//   - redesenho SOB DEMANDA: abrir a aba, resize, página visível de novo. Só existe loop de quadros ENQUANTO uma direção está
//     pressionada (cidades); parado, nada roda por frame (bateria). O deslocamento usa o tempo real entre quadros, limitado a
//     maxStepMs: a distância lógica não depende da taxa de quadros nem "teletransporta" depois de a aba ficar escondida;
//   - cidades aceitam caminhada manual (teclado/toque); rotas só mostram a cena (as caçadas andarão sozinhas no futuro);
//   - "Visualizar mapa" = seletor de área só visual (NÃO é viagem: não altera a rota do jogo, não inicia batalha, não concede nada);
//   - serviços da cidade reaproveitam o que já existe: Centro Pokémon → GameCore.healAtCenter (cura o HP do combatente atual,
//     mesma regra da poção, sem gastar poção; recusada com a Caça em andamento); Depot → abre a aba PC existente;
//   - ciclo de vida igual ao HuntView: onShow()/onHide() chamados por GameUI.switchTab.
// ============================================================
class WorldView {
    constructor(ui) {
        this.ui = ui;
        this.game = ui.game;
        this.root = document.getElementById('world-panel');
        this.active = false;
        this.areaId = WORLD_START_MAP_ID;  // área exibida (só visual)
        this.drawCount = 0;                // diagnóstico/testes: quantos desenhos reais ocorreram
        this.lastMetrics = null;
        this._players = {};                // mapId → estado do personagem (posição preservada ao trocar de área/aba)
        this._unsubs = [];
        this._observer = null;
        this._raf = null;
        this._lastTs = null;
        this._lastKey = null;
        this._near = null;
        this._onVisibility = () => {
            if (document.hidden) { this._lastTs = null; if (this.controls) this.controls.clear(); }
            else this.requestRedraw(true);
        };
        this._onWindowResize = () => this.requestRedraw();
        if (!this.root) return;
        this.root.innerHTML = `
            <h2>🧭 Mundo</h2>
            <div class="world-toolbar">
                <label for="world-destination">Visualizar mapa</label>
                <select id="world-destination" class="world-destination" title="Só troca a imagem exibida: não muda a rota do jogo nem viaja"></select>
            </div>
            <div id="world-viewport" class="world-viewport">
                <canvas id="world-canvas" role="img"></canvas>
                <div id="world-message" class="world-message" hidden></div>
            </div>
            <div id="world-caption" class="world-caption"></div>
            <div id="world-hint" class="world-hint" aria-live="polite"></div>
            <div id="world-controls" class="world-controls">
                <div class="world-dpad" role="group" aria-label="Direcional">
                    <button type="button" class="world-dir up" data-dir="up" aria-label="Para cima">▲</button>
                    <button type="button" class="world-dir left" data-dir="left" aria-label="Para a esquerda">◀</button>
                    <button type="button" class="world-dir down" data-dir="down" aria-label="Para baixo">▼</button>
                    <button type="button" class="world-dir right" data-dir="right" aria-label="Para a direita">▶</button>
                </div>
                <button type="button" id="world-interact" class="world-interact" disabled>Interagir (E)</button>
            </div>`;
        this.viewport = this.root.querySelector('#world-viewport');
        this.canvas = this.root.querySelector('#world-canvas');
        this.message = this.root.querySelector('#world-message');
        this.caption = this.root.querySelector('#world-caption');
        this.hint = this.root.querySelector('#world-hint');
        this.controlsEl = this.root.querySelector('#world-controls');
        this.interactBtn = this.root.querySelector('#world-interact');
        this.destination = this.root.querySelector('#world-destination');
        this.controls = new WorldControls({ root: this.root, onChange: () => this._onInput(), onInteract: () => this._interact() });
        this._fillDestinations();
        this.destination.addEventListener('change', () => { this.setArea(this.destination.value); this.destination.blur(); });
        this.interactBtn.addEventListener('click', () => this._interact());
    }

    // ---------- ciclo de vida ----------
    onShow() {
        if (!this.root || !this.game.gameState) return;
        this.onHide();                                         // idempotente: nunca duplica observadores
        this.active = true;
        this.controls.attach();
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
        if (this.controls) this.controls.detach();             // solta teclas e toques
        for (const off of this._unsubs) off();
        this._unsubs = [];
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        if (typeof window !== 'undefined') window.removeEventListener('resize', this._onWindowResize);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
        if (this._raf !== null) { WorldView._cancelFrame(this._raf); this._raf = null; }
        this._lastTs = null;
        this._clearNotice();
        for (const id in this._players) if (this._players[id].moving) this._players[id] = { ...this._players[id], moving: false };
    }

    // Agenda UM quadro (agrupa vários pedidos). force=true ignora o "nada mudou".
    requestRedraw(force = false) {
        if (!this.active) return;
        if (force) this._lastKey = null;
        this._scheduleFrame();
    }

    _scheduleFrame() {
        if (this._raf !== null || !this.active) return;
        this._raf = WorldView._nextFrame((ts) => this._frame(ts));
    }

    static _nextFrame(fn) { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(WorldView._now()), 16); }
    static _cancelFrame(id) { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id); }
    static _now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

    // ---------- movimento ----------
    _manualDirection(map) { return worldCanWalkManually(map) ? this.controls.direction() : null; }

    _onInput() { if (this.active) this._scheduleFrame(); }

    // Um quadro: aplica o movimento manual (se houver direção) com o tempo real desde o quadro anterior e desenha.
    // O loop só continua enquanto uma direção estiver pressionada.
    _frame(ts) {
        this._raf = null;
        if (!this.active) return;
        const now = Number.isFinite(ts) ? ts : WorldView._now();
        const { map } = this.currentScene();
        const dir = this._manualDirection(map);
        const player = this._player(map);
        if (dir) {
            const dt = this._lastTs === null ? 0 : now - this._lastTs;      // worldStep limita a maxStepMs
            this._lastTs = now;
            this._players[map.id] = worldStep(map, player, dir, dt);
        } else {
            this._lastTs = null;
            if (player.moving) this._players[map.id] = { ...player, moving: false };
        }
        this.draw();
        if (dir) this._scheduleFrame();
    }

    _player(map) {
        if (!this._players[map.id]) this._players[map.id] = worldCreateState(map);
        return this._players[map.id];
    }

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

    // ---------- áreas e destino (só visual) ----------
    currentScene() {
        const map = getWorldMap(this.areaId) || getWorldMap(WORLD_START_MAP_ID);
        return { map };
    }

    _fillDestinations() {
        this.destination.innerHTML = '';
        for (const id of Object.keys(WORLD_MAPS)) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = this._mapTitle(WORLD_MAPS[id]);
            this.destination.appendChild(opt);
        }
        this.destination.value = this.areaId;
    }

    // Troca a área exibida (cidade ↔ rota). Não mexe na rota do jogo.
    setArea(mapId) {
        if (!getWorldMap(mapId) || mapId === this.areaId) return false;
        this.areaId = mapId;
        this._lastTs = null;
        this.controls.clear();
        this.requestRedraw(true);
        return true;
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
        const { map } = this.currentScene();
        const city = worldCanWalkManually(map);
        this.controls.setEnabled(city);
        this.controlsEl.hidden = !city;
        this.destination.value = map.id;
        this._updateCaption(map);
        if (!images) { this._showMessage(WorldView.failed ? 'Não foi possível carregar o cenário.' : 'Carregando o cenário…'); return; }

        const player = this._player(map);
        const metrics = worldViewMetrics({ cssWidth: rect.width, cssHeight: rect.height, dpr: window.devicePixelRatio, mapWidth: map.width * WORLD_TILE_SIZE, mapHeight: map.height * WORLD_TILE_SIZE });
        const camera = worldCamera(map, metrics, { x: player.x, y: player.y - 6 });
        this._syncInteraction(map, player);
        const key = [map.id, metrics.bufferWidth, metrics.bufferHeight, metrics.zoom, camera.x, camera.y, player.x, player.y, player.dir, player.moving ? Math.floor(player.distance / 6) % 2 : 'idle'].join('|');
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
        this._drawCharacter(ctx, images.hero, player, camera, metrics);
        this.lastMetrics = metrics;
        this.drawCount++;
        this._hideMessage();
        this.canvas.setAttribute('aria-label', `Cenário: ${this._mapTitle(map)}${map.label ? ' (' + map.label + ')' : ''}. Um treinador está no cenário.`);
    }

    // Os pés do personagem ficam em (player.x, player.y); ao andar, um passo curto de 1 px marca a caminhada (placeholder
    // derivado da DISTÂNCIA percorrida, não do relógio: continua igual em qualquer taxa de quadros)
    _drawCharacter(ctx, sheet, player, camera, metrics) {
        const ch = WORLD_CHARACTER;
        const frame = ch.frames[player.dir] || ch.frames.down;
        const bob = player.moving && Math.floor(player.distance / 6) % 2 === 1 ? 1 : 0;
        const at = worldToScreen(camera, metrics, player.x - ch.anchor.x, player.y - ch.anchor.y - bob);
        ctx.drawImage(sheet, frame.col * ch.frameW, frame.row * ch.frameH, ch.frameW, ch.frameH, at.x, at.y, ch.frameW * metrics.zoom, ch.frameH * metrics.zoom);
    }

    _updateCaption(map) {
        const title = this._mapTitle(map);
        if (worldCanWalkManually(map)) {
            this.caption.textContent = `Você está em: ${title}. Ande com as setas ou WASD (ou o direcional na tela) e chegue perto de um prédio para interagir.`;
        } else {
            const current = this.game.gameState && worldMapIdForRoute(this.game.gameState.currentRoute) === map.id;
            this.caption.textContent = `${title}: nas rotas o personagem anda sozinho durante as caçadas; aqui é só a visualização.${current ? ' Esta é a sua rota de caça atual.' : ''} Isto é só uma prévia visual: a rota do jogo não muda. Para trocar de rota, use a lista abaixo.`;
        }
    }

    _showMessage(text) { this.message.textContent = text; this.message.hidden = false; }
    _hideMessage() { this.message.hidden = true; }

    // ---------- serviços da cidade ----------
    _syncInteraction(map, player) {
        const near = worldInteractionNear(map, player);
        this._near = near;
        this.interactBtn.disabled = !near;
        // o aviso de um serviço vale enquanto o jogador continua perto dele; ao ir para outro (ou sair), a dica normal volta
        if (this._notice && (!near || near.id !== this._noticeFor)) this._clearNotice();
        if (!this._notice) this.hint.textContent = near ? `Perto: ${near.label}. Pressione E ou toque em Interagir.` : '';
    }

    _clearNotice() {
        this._notice = null;
        this._noticeFor = null;
        if (this._noticeTimer) { clearTimeout(this._noticeTimer); this._noticeTimer = null; }
    }

    _notify(text) {
        this._clearNotice();
        this._notice = text;
        this._noticeFor = this._near ? this._near.id : null;
        this.hint.textContent = text;
        if (this.ui && this.ui.showToast) this.ui.showToast(text);
        this._noticeTimer = setTimeout(() => {
            this._noticeTimer = null;
            this._notice = null;
            this._noticeFor = null;
            if (this.active) this.requestRedraw(true);       // volta a mostrar a dica de proximidade
        }, 2500);
    }

    _interact() {
        if (!this.active) return;
        const { map } = this.currentScene();
        const near = worldInteractionNear(map, this._player(map));
        if (!near) return;
        if (near.type === 'heal') this._notify(WorldView.healMessage(this.game.healAtCenter()));
        else if (near.type === 'depot') this.ui.switchTab('tab-pc');
    }

    static healMessage(r) {
        if (r && r.ok) return `🏥 O Pokémon em batalha foi curado (+${r.amount} de HP)${r.revived ? ' e voltou à luta' : ''}.`;
        switch (r && r.code) {
            case 'full_hp': return 'O Pokémon em batalha já está com o HP cheio.';
            case 'hunt_running': return 'Pause ou pare a caçada para usar o Centro Pokémon.';
            case 'tower_mode': return 'O Centro Pokémon não atende durante o desafio da Torre.';
            case 'offline': return 'Aguarde o cálculo offline terminar para usar o Centro Pokémon.';
            default: return 'Não há batalha em andamento para curar agora.';
        }
    }
}
WorldView._assets = null;
WorldView.images = null;
WorldView.failed = false;
