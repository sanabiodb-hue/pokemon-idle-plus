// ============================================================
// Mundo visual · view + renderer (Fases 7.1 e 7.2). Vive dentro da aba Mapa.
//   - Canvas 2D, pixel art com zoom inteiro (ver worldViewMetrics); buffer = tamanho CSS x devicePixelRatio;
//   - o estado do personagem (posição, direção, distância) é do MOTOR (world-engine.js), não do desenho: aqui só se lê;
//   - redesenho SOB DEMANDA: abrir a aba, resize, página visível de novo. Só existe loop de quadros ENQUANTO uma direção está
//     pressionada (cidades); parado, nada roda por frame (bateria). O deslocamento usa o tempo real entre quadros, limitado a
//     maxStepMs: a distância lógica não depende da taxa de quadros nem "teletransporta" depois de a aba ficar escondida;
//   - cidades aceitam caminhada manual (teclado/toque); rotas e mapas de caça só mostram a cena (as caçadas andarão sozinhas no futuro);
//   - NAVEGAÇÃO (F7.5): `areaId` é a ÚNICA fonte da localização visual (só da sessão, não vai para o save) e é independente da
//     progressão (gameState.currentRoute, que só a lista de rotas muda via changeRoute). A viagem entre áreas é instantânea,
//     síncrona e atômica: valida e resolve o mapa primeiro e só então troca a área (o último pedido vence; falha = área anterior
//     intacta + aviso na interface). O seletor "Ir para" e a busca de espécie são só visuais: nunca chamam changeRoute nem batalha.
//     Mapas de caça vêm só de getWorldMap('hunt_<espécie>') (cache LRU da F7.4); aqui guarda-se apenas o id e a posição do personagem;
//   - ENCONTROS (F7.6): a lógica é do WorldEncounters (ui.worldEncounters, sem DOM/Canvas). Aqui só se LÊ o estado dele: o Pokémon é
//     desenhado no ponto do mundo (pela câmera), o botão "Procurar Pokémon aqui" é uma ação explícita e abrir/trocar de mapa nunca
//     inicia caçada nem batalha. Sair do mapa avisa o controlador (cancela um encontro que ainda não começou);
//   - serviços da cidade reaproveitam o que já existe: Centro Pokémon → GameCore.healAtCenter (cura o HP do combatente atual,
//     mesma regra da poção, sem gastar poção; recusada com a Caça em andamento); Depot → abre a aba PC existente;
//   - ciclo de vida igual ao HuntView: onShow()/onHide() chamados por GameUI.switchTab.
// ============================================================
class WorldView {
    constructor(ui) {
        this.ui = ui;
        this.game = ui.game;
        this.encounters = ui.worldEncounters || null;   // F7.6: lógica dos encontros (opcional; sem ela o mundo funciona como antes)
        this._enc = null;                  // imagem do sprite do encontro atual: { id, img, ready, failed }
        this.root = document.getElementById('world-panel');
        this.active = false;
        this.areaId = WORLD_START_MAP_ID;  // área exibida (só visual)
        this.drawCount = 0;                // diagnóstico/testes: quantos desenhos reais ocorreram
        this.lastMetrics = null;
        this.lastCamera = null;
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
                <label for="world-destination">Ir para</label>
                <select id="world-destination" class="world-destination" title="Troca a área exibida: não muda a rota do jogo"></select>
            </div>
            <div class="world-hunt-search">
                <label for="world-hunt-input">Mapa de caça</label>
                <input id="world-hunt-input" class="world-hunt-input" type="search" placeholder="Nome ou número da espécie…" autocomplete="off" title="Abre o mapa de caça da espécie (só visualização: não inicia a caçada)">
                <div id="world-hunt-results" class="world-hunt-results" role="listbox" aria-label="Espécies encontradas"></div>
            </div>
            <div id="world-viewport" class="world-viewport">
                <canvas id="world-canvas" role="img"></canvas>
                <div id="world-message" class="world-message" hidden></div>
            </div>
            <div id="world-caption" class="world-caption"></div>
            <div id="world-encounter" class="world-encounter" hidden>
                <button type="button" id="world-encounter-btn" class="world-encounter-btn">Procurar Pokémon aqui</button>
                <span id="world-encounter-status" class="world-encounter-status" aria-live="polite"></span>
            </div>
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
        this.encounterBox = this.root.querySelector('#world-encounter');
        this.encounterBtn = this.root.querySelector('#world-encounter-btn');
        this.encounterStatus = this.root.querySelector('#world-encounter-status');
        this.huntInput = this.root.querySelector('#world-hunt-input');
        this.huntResults = this.root.querySelector('#world-hunt-results');
        this.controls = new WorldControls({ root: this.root, onChange: () => this._onInput(), onInteract: () => this._interact() });
        this._fillDestinations();
        this.destination.addEventListener('change', () => { this.setArea(this.destination.value); this.destination.value = this.areaId; this.destination.blur(); });
        this.encounterBtn.addEventListener('click', () => this._requestEncounter());
        this.huntInput.addEventListener('input', () => this._renderHuntResults());
        this.huntInput.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            const first = this.huntResults.children[0];
            if (first && first.dataset && first.dataset.speciesId) { ev.preventDefault(); this._pickSpecies(first.dataset.speciesId); }
        });
        this.huntResults.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-species-id]') : null;
            if (btn) this._pickSpecies(btn.dataset.speciesId);
        });
        this.interactBtn.addEventListener('click', () => this._interact());
    }

    // ---------- ciclo de vida ----------
    onShow() {
        if (!this.root || !this.game.gameState) return;
        this.onHide();                                         // idempotente: nunca duplica observadores
        this.active = true;
        this._fillDestinations();                              // desbloqueios podem ter mudado desde a última vez
        this.controls.attach();
        this._unsubs.push(this.game.bus.on('route_changed', () => this.requestRedraw()));
        if (this.encounters) this._unsubs.push(this.encounters.onChange(() => this.requestRedraw(true)));
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
            WorldView._assets.catch(() => { WorldView.HUNT_RESULT_LIMIT = 10;      // resultados visíveis da busca de espécies
WorldView._assets = null; WorldView.failed = true; });   // permite tentar de novo ao reabrir a aba
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
            const locked = this._mapLocked(id);
            opt.value = id;
            opt.textContent = (locked ? '🔒 ' : '') + this._mapTitle(WORLD_MAPS[id]);
            if (locked) opt.disabled = true;                   // rota de região bloqueada: mesma regra da progressão
            this.destination.appendChild(opt);
        }
        const cur = getWorldMap(this.areaId);
        if (cur && !_worldHas(WORLD_MAPS, cur.id)) {           // mapa de caça aberto: uma opção temporária só para ele (nunca a lista das 1.073)
            const opt = document.createElement('option');
            opt.value = cur.id;
            opt.textContent = this._mapTitle(cur);
            this.destination.appendChild(opt);
        }
        this.destination.value = this.areaId;
    }

    // Rota de progressão (id) cujo mapa visual é `mapId`, via WORLD_ROUTE_MAPS (ou null: cidade, mapa de caça, mapa sem rota)
    _routeOfMap(mapId) {
        for (const routeId in WORLD_ROUTE_MAPS) if (WORLD_ROUTE_MAPS[routeId] === mapId) return routeId;
        return null;
    }

    // Mapa de uma rota cuja região ainda está bloqueada na progressão? (só consulta; nunca altera nada)
    _mapLocked(mapId) {
        const routeId = this._routeOfMap(mapId);
        if (!routeId || typeof this.game.isRegionUnlocked !== 'function') return false;
        for (const key in REGIONS) if (REGIONS[key].routes.some(r => r.id === routeId)) return !this.game.isRegionUnlocked(key);
        return false;
    }

    _travelFail(code, text) {
        this._notify(text);
        return { ok: false, changed: false, code };
    }

    // Viagem instantânea e atômica. Valida e resolve o mapa PRIMEIRO; só depois troca a área (o último pedido vence, e uma falha
    // deixa área, controles e personagem exatamente como estavam). Não toca na progressão nem na batalha.
    _travel(mapId) {
        let map = null;
        try { map = getWorldMap(mapId); } catch (e) { map = null; }
        if (!map) return this._travelFail('invalid', 'Não foi possível abrir esse mapa. Você continua na área atual.');
        if (this._mapLocked(map.id)) return this._travelFail('locked', 'Essa rota ainda está bloqueada pela progressão do jogo.');
        if (map.id === this.areaId) return { ok: true, changed: false, code: 'same' };
        const prev = this.areaId, prevMap = getWorldMap(prev);
        // ---- commit (sem nada que possa falhar daqui em diante) ----
        if (this._players[prev]) {
            if (prevMap && prevMap.type === 'hunt') delete this._players[prev];           // mapa de caça: ao sair, esquece (volta ao início); mantém o estado limitado
            else this._players[prev] = { ...this._players[prev], moving: false };
        }
        this.areaId = map.id;
        if (this.encounters) this.encounters.onAreaChanged(map.id);   // sair do mapa cancela um encontro que ainda não começou
        this._lastTs = null;
        this._near = null;
        this._clearNotice();
        this.controls.clear();
        this._fillDestinations();
        this.requestRedraw(true);                              // a câmera é recalculada a partir do personagem do novo mapa
        return { ok: true, changed: true, code: 'ok' };
    }

    // Troca a área exibida. Devolve true se a área mudou. Não mexe na rota do jogo.
    setArea(mapId) { return this._travel(mapId).changed; }

    // Abre a área visual de uma rota (chamado pela lista de rotas DEPOIS que changeRoute aceitou). Rota sem mapa: só um aviso.
    openRoute(routeId) {
        const mapId = worldMapIdForRoute(routeId);
        if (!mapId) { this._setHint('Esta rota ainda não tem mapa visual.'); return { ok: false, changed: false, code: 'no_map' }; }
        return this._travel(mapId);
    }

    // Abre o mapa de caça de uma espécie (chave canônica = id numérico da espécie em POKEMON_DATA). Não inicia a caçada.
    openHuntMap(speciesId) {
        if (!Number.isInteger(speciesId) || speciesId < 1 || !_worldHas(POKEMON_DATA, String(speciesId))) return this._travelFail('invalid_species', 'Espécie inválida: nenhum mapa de caça foi aberto.');
        return this._travel(`hunt_${speciesId}`);
    }

    // Ação explícita do jogador: chamar um encontro neste mapa de caça (exige caçada em andamento; nunca é automático)
    _requestEncounter() {
        const { map } = this.currentScene();
        if (!this.encounters || map.type !== 'hunt') return null;
        const r = this.encounters.request(map.speciesId);
        if (!r.ok) this._notify(r.message || 'Não foi possível procurar Pokémon agora.');
        return r;
    }

    _encounterName(c) { const d = POKEMON_DATA[c.speciesId]; return d && d.name ? d.name : `#${c.speciesId}`; }

    _syncEncounterUi(map) {
        const enc = this.encounters, hunt = map.type === 'hunt' && !!enc;
        this.encounterBox.hidden = !hunt;
        if (!hunt) return;
        const c = enc.current && enc.current.mapId === map.id ? enc.current : null;
        const running = typeof this.game.isHuntRunning === 'function' && this.game.isHuntRunning();
        this.encounterBtn.disabled = enc.isActive() || !running;
        let text = running ? 'Chame um Pokémon: ele aparece em um ponto do mapa.' : 'Inicie a caçada na aba Caça para procurar Pokémon neste mapa.';
        if (c) {
            const name = this._encounterName(c);
            if (c.state === 'approaching') text = `${name} apareceu a ~${Math.max(1, Math.round(c.etaMs / 1000))} s de distância.`;
            else if (c.state === 'arrived') text = `${name} chegou ao ponto: aguardando a vez da batalha.`;
            else if (c.state === 'battling') text = `Batalha contra ${name} em andamento.`;
            else if (c.state === 'resolved') text = `Encontro com ${name} concluído (${c.outcome === 'defeat' ? 'derrota' : 'vitória'}).`;
            else if (c.state === 'cancelled') text = `Encontro com ${name} cancelado.`;
        }
        this.encounterStatus.textContent = text;
    }

    // Sprite do Pokémon do encontro (um só em memória); redesenha quando carrega
    _encounterSprite(speciesId) {
        if (!this._enc || this._enc.id !== speciesId) {
            const entry = { id: speciesId, img: null, ready: false, failed: false };
            this._enc = entry;
            if (typeof Image !== 'undefined' && typeof getPokemonSpriteUrl === 'function') {
                const img = new Image();
                img.onload = () => { entry.ready = true; if (this._enc === entry) this.requestRedraw(true); };
                img.onerror = () => { entry.failed = true; if (this._enc === entry) this.requestRedraw(true); };
                img.src = getPokemonSpriteUrl(speciesId);
                entry.img = img;
            } else entry.failed = true;
        }
        return this._enc;
    }

    // O Pokémon vive em coordenadas do MUNDO (centro do tile do ponto); a câmera só aplica a transformação
    _drawEncounter(ctx, c, camera, metrics) {
        if (!c || !['approaching', 'arrived', 'battling'].includes(c.state)) return;
        const ts = metrics.tileSize, size = 24, z = metrics.zoom;
        const wx = (c.point.x + 0.5) * ts, wy = (c.point.y + 0.5) * ts + 6;               // pés do sprite um pouco abaixo do centro do tile
        const at = worldToScreen(camera, metrics, wx - size / 2, wy - size);
        const spr = this._encounterSprite(c.speciesId);
        if (spr.ready && spr.img) ctx.drawImage(spr.img, at.x, at.y, size * z, size * z);
        else { ctx.fillStyle = '#e5484d'; ctx.fillRect(at.x + 8 * z, at.y + 8 * z, 8 * z, 8 * z); }   // enquanto carrega (ou se falhar): marcador simples
    }

    _setHint(text) { this._notify(text, { toast: false }); }

    // ---------- busca de espécies (no máximo WORLD_HUNT_RESULT_LIMIT resultados; nenhum mapa é gerado para listar) ----------
    _huntMatches(query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return { list: [], total: 0 };
        const dex = (this.game.gameState && this.game.gameState.pokedex) || {};
        const out = [];
        let total = 0;
        for (const key of Object.keys(POKEMON_DATA)) {
            const id = Number(key), data = POKEMON_DATA[key], known = dex[id] === 'seen' || dex[id] === 'caught';
            // mesma regra do catálogo: espécie ainda não vista aparece como ??? e só se acha pelo número
            const hit = String(id).includes(q) || (known && data && typeof data.name === 'string' && data.name.toLowerCase().includes(q));
            if (!hit) continue;
            total++;
            if (out.length < WorldView.HUNT_RESULT_LIMIT) out.push({ id, name: known && data.name ? data.name : '???' });
        }
        return { list: out, total };
    }

    _renderHuntResults() {
        const { list, total } = this._huntMatches(this.huntInput.value);
        this.huntResults.innerHTML = '';
        for (const item of list) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'world-hunt-result';
            btn.dataset.speciesId = String(item.id);
            btn.textContent = `#${String(item.id).padStart(3, '0')} ${item.name}`;
            this.huntResults.appendChild(btn);
        }
        if (total > list.length) {
            const more = document.createElement('div');
            more.className = 'world-hunt-more';
            more.textContent = `Mostrando ${list.length} de ${total}. Refine a busca.`;
            this.huntResults.appendChild(more);
        }
    }

    _pickSpecies(rawId) {
        const result = this.openHuntMap(Number(rawId));
        if (result.ok) { this.huntInput.value = ''; this._renderHuntResults(); }
        return result;
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
        this._syncEncounterUi(map);
        if (!images) { this._showMessage(WorldView.failed ? 'Não foi possível carregar o cenário.' : 'Carregando o cenário…'); return; }

        const player = this._player(map);
        const metrics = worldViewMetrics({ cssWidth: rect.width, cssHeight: rect.height, dpr: window.devicePixelRatio, mapWidth: map.width * WORLD_TILE_SIZE, mapHeight: map.height * WORLD_TILE_SIZE });
        const camera = worldCamera(map, metrics, worldCameraFocus(player));
        this._syncInteraction(map, player);
        const enc = this.encounters && this.encounters.current && this.encounters.current.mapId === map.id ? this.encounters.current : null;
        const encKey = enc ? `${enc.id}:${enc.state}:${this._enc && this._enc.id === enc.speciesId ? (this._enc.ready ? 1 : 0) : 0}` : '-';
        const key = [encKey, map.id, metrics.bufferWidth, metrics.bufferHeight, metrics.zoom, camera.x, camera.y, player.x, player.y, player.dir, player.moving ? Math.floor(player.distance / 6) % 2 : 'idle'].join('|');
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
        this._drawEncounter(ctx, enc, camera, metrics);
        this._drawCharacter(ctx, images.hero, player, camera, metrics);
        this.lastMetrics = metrics;
        this.lastCamera = camera;
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
        if (map.type === 'hunt') {
            this.caption.textContent = `${title}${map.label ? ' · ' + map.label : ''}: mapa de caça gerado para a espécie. Aqui é só a visualização: a caçada ainda não começa e a rota do jogo não muda.`;
        } else if (worldCanWalkManually(map)) {
            this.caption.textContent = `Você está em: ${title}. Ande com as setas ou WASD (ou o direcional na tela) e chegue perto de um prédio para interagir.`;
        } else {
            const current = this.game.gameState && worldMapIdForRoute(this.game.gameState.currentRoute) === map.id;
            this.caption.textContent = `${title}: nas rotas o personagem anda sozinho durante as caçadas; aqui é só a visualização.${current ? ' Esta é a sua rota de caça atual.' : ''} Abrir este mapa só troca a área exibida: a rota do jogo não muda. Para trocar a rota do jogo, use a lista abaixo.`;
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
        if (this._notice && this._noticeFor && (!near || near.id !== this._noticeFor)) this._clearNotice();   // aviso de serviço: some ao se afastar; aviso de viagem (sem serviço): dura até o tempo acabar
        if (!this._notice) this.hint.textContent = near ? `Perto: ${near.label}. Pressione E ou toque em Interagir.` : '';
    }

    _clearNotice() {
        this._notice = null;
        this._noticeFor = null;
        if (this._noticeTimer) { clearTimeout(this._noticeTimer); this._noticeTimer = null; }
    }

    _notify(text, { toast = true } = {}) {
        this._clearNotice();
        this._notice = text;
        this._noticeFor = this._near ? this._near.id : null;
        this.hint.textContent = text;
        if (toast && this.ui && this.ui.showToast) this.ui.showToast(text);
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
WorldView.HUNT_RESULT_LIMIT = 10;      // resultados visíveis da busca de espécies
WorldView._assets = null;
WorldView.images = null;
WorldView.failed = false;
