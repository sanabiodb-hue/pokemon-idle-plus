// ============================================================
// F10 · Modo Explorar · interface (tela cheia sobre o jogo). Fluxo como nos jogos principais:
//   Cidade Inicial (Centro Pokémon cura, Depot) → saída sul → rota atual (mapa da rota ou o mapa de caça procedural da espécie
//   mais comum dela) → mato alto: "Um ___ selvagem apareceu!" → LUTAR / BOLSA / POKÉMON / FUGIR → captura com a bola escolhida.
// Movimento e colisão: worldStep / worldAdvanceToward / worldFindPath (o mesmo motor das cidades). Regras: explore-core.js.
// A cena 3D (explore-3d.js) usa o Three.js copiado em js/vendor, carregado só ao abrir o modo.
// ============================================================
const EXPLORE_THREE_URL = 'js/vendor/three.module.min.js';
const EXPLORE_BLOCK_MESSAGES = {
    hunt_active: 'Pare ou pause a caçada automática na aba Caça para explorar.',
    tower: 'Saia da Torre de Desafio para explorar.',
    offline: 'Aguarde o cálculo offline terminar.',
    no_team: 'Você precisa de pelo menos um Pokémon na equipe.',
    disabled: 'O modo Explorar está desligado.',
    webgl: 'Este navegador não conseguiu iniciar o 3D (WebGL).',
    load: 'Não foi possível carregar o motor 3D. Verifique a conexão e tente de novo.',
    world_hunt: 'Há uma caçada ativa no Mapa. Encerre-a para explorar.',
};
const EXPLORE_TOWN = 'starter_town';
const EXPLORE_QUALITY_KEY = 'pokemon_idle_explore_quality';
const EXPLORE_MUSIC_KEY = 'pokemon_idle_explore_music';          // F10.3: música ligada/desligada neste aparelho      // F10.1: preferência deste aparelho (não vai para o save do jogo)
const exploreDevice = () => ({ coarse: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches), dpr: window.devicePixelRatio || 1, cores: navigator.hardwareConcurrency || 0, memoryGb: navigator.deviceMemory || 0 });

class ExploreView {
    constructor(ui) {
        this.ui = ui; this.game = ui.game;
        this.open = false; this.keep = {}; this.keys = []; this.joy = { x: 0, y: 0 }; this.path = null; this.running = false;
        this.mode = 'world'; this.busy = false; this.grace = 0; this.audio = null;
        this.defeated = new Set(); this.taken = new Set();        // F10.4: carregados do save ao abrir (gameState.explore)
        let mu = null; try { mu = localStorage.getItem(EXPLORE_MUSIC_KEY); } catch (e) { mu = null; }
        this.musicOn = mu !== 'off'; this.music = null; this.hourOverride = null; this._phaseCheck = 0;        // F10.2: só desta sessão (como a posição); voltam ao recarregar
        // F10.1: qualidade gráfica (preferência salva neste aparelho; senão a escolha automática pelo aparelho)
        let saved = null; try { saved = JSON.parse(localStorage.getItem(EXPLORE_QUALITY_KEY) || 'null'); } catch (e) { saved = null; }
        this.qualityManual = !!(saved && saved.manual && EXPLORE_QUALITY[saved.id]);
        this.quality = this.qualityManual ? saved.id : exploreDefaultQuality(exploreDevice());
        this.gov = new ExploreFrameGovernor(this.quality, window.devicePixelRatio || 1);
        this._inject();
        this._onKeyDown = (e) => this._key(e, true); this._onKeyUp = (e) => this._key(e, false);
        this._onResize = () => this.e3d && this.e3d.resize();
    }
    _inject() {
        const root = document.getElementById('world-panel');
        if (!root || root.querySelector('.explore-cta')) return;
        const card = document.createElement('div');
        card.className = 'explore-cta';
        card.innerHTML = `<div class="explore-cta-text"><b>🎮 Explorar em 3D</b><small>Ande pela rota com seu treinador, encontre Pokémon no mato alto e batalhe por turnos: Lutar, Bolsa, Pokémon e Fugir.</small></div><button type="button" id="explore-open">Explorar</button>`;
        const h2 = root.querySelector('h2');
        if (h2 && h2.nextSibling) root.insertBefore(card, h2.nextSibling); else root.prepend(card);
        card.querySelector('#explore-open').addEventListener('click', () => this.start());
    }
    _toast(msg) { if (this.ui && typeof this.ui.showToast === 'function') this.ui.showToast(msg); }
    // aviso curto dentro da tela cheia do Explorar (o toast do jogo fica atrás dela)
    _notice(msg) { const n = this.$('.ex-notice'); if (!n) return; n.textContent = msg; n.hidden = false; clearTimeout(this._noticeT); this._noticeT = setTimeout(() => { n.hidden = true; }, 4000); }

    // ---------------- abrir / fechar ----------------
    async start() {
        if (this.open) return;
        if (this.ui.worldEncounters && this.ui.worldEncounters.isActive && this.ui.worldEncounters.isActive()) return this._toast(EXPLORE_BLOCK_MESSAGES.world_hunt);
        const reason = this.game.exploreBlockReason();
        if (reason) return this._toast(EXPLORE_BLOCK_MESSAGES[reason] || reason);
        this._audioInit();
        this._build();
        this.root.hidden = false; document.body.classList.add('exploring');
        this._say(['Carregando o mundo 3D…']);
        try { if (!window.THREE) window.THREE = await import(new URL(EXPLORE_THREE_URL, document.baseURI).href); }
        catch (e) { this.root.hidden = true; document.body.classList.remove('exploring'); return this._toast(EXPLORE_BLOCK_MESSAGES.load); }
        const gl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
        if (!gl) { this.root.hidden = true; document.body.classList.remove('exploring'); return this._toast(EXPLORE_BLOCK_MESSAGES.webgl); }
        try { if (!this.e3d) this.e3d = new Explore3D(this.canvas, this.quality, window.devicePixelRatio || 1); }
        catch (e) { this.root.hidden = true; document.body.classList.remove('exploring'); return this._toast(EXPLORE_BLOCK_MESSAGES.webgl); }
        const r = this.game.exploreEnter();
        if (!r.ok) { this.root.hidden = true; document.body.classList.remove('exploring'); return this._toast(EXPLORE_BLOCK_MESSAGES[r.code] || r.code); }
        this.open = true;
        if (this.ui.worldView && this.ui.worldView.controls) this.ui.worldView.controls.clear();
        addEventListener('keydown', this._onKeyDown, true); addEventListener('keyup', this._onKeyUp, true); addEventListener('resize', this._onResize);
        this.e3d.resize();
        // F10.4: progresso salvo — treinadores vencidos, itens pegos e a última posição (se ainda for a cidade ou a rota atual)
        const pr = this.game.exploreProgress();
        this.defeated = new Set(pr.defeated); this.taken = new Set(pr.taken);
        const resume = this._resumeAt();
        if (resume) {
            this._goTo(resume.map.id, null);
            this.state = { ...this.state, x: resume.at.x, y: resume.at.y, dir: resume.at.dir };
            this.e3d.setTrainer(this.state, 0, false); this.e3d.resetTrail(this.state.dir);
            this._dialog(['Bem-vindo de volta! Você continua de onde parou.']);
        } else {
            this._goTo(EXPLORE_TOWN, null);
            this._dialog(['Bem-vindo ao modo Explorar!', 'Ande com as setas/WASD (ou o joystick). Shift corre. Enter/Espaço interage.', 'Siga pelo caminho ao sul até a rota. No mato alto aparecem Pokémon selvagens!']);
        }
        this._onHide = () => { if (document.hidden) this._savePosition(); };
        document.addEventListener('visibilitychange', this._onHide);
        this._last = performance.now(); this._lastRender = this._last; this._acc = 0; this._activeUntil = 0;
        this._auto = { start: this._last, frames: 0, ms: 0 };
        this._renderQualityButton();
        if (this.audio && !this.music) this.music = new ExploreMusic(this.audio);
        this.setMusic(this.musicOn); this._areaMusic();
        this._raf = requestAnimationFrame((t) => this._frame(t));
    }
    // ---------------- F10.1 · qualidade ----------------
    setMusic(on) {
        this.musicOn = !!on;
        try { localStorage.setItem(EXPLORE_MUSIC_KEY, on ? 'on' : 'off'); } catch (e) { /* sem armazenamento: vale nesta sessão */ }
        if (this.music) this.music.setEnabled(on);
        const b = this.$('.ex-music'); if (b) { b.textContent = on ? '🔊' : '🔇'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    }
    _areaMusic() { if (this.music && this.map) this.music.play(this.map.music || (this.map.indoor ? 'gym' : this.map.type === 'city' ? 'town' : 'route')); }
    // fase do dia pelo relógio do aparelho (hourOverride só para testes); reaplicada a cada 30 s
    _applyPhase() {
        const d = new Date(), h = this.hourOverride !== null ? this.hourOverride : d.getHours() + d.getMinutes() / 60, ph = exploreDayPhase(h);
        this.phase = ph; this.e3d.applyDayPhase(ph);
        const el = this.$('.ex-loc small'); if (el) el.textContent = this.map && this.map.indoor ? 'Explorar · 🏛️ Interior' : `Explorar · ${ph.id === 'night' ? '🌙' : ph.id === 'day' ? '☀️' : '🌅'} ${ph.label}`;
    }
    _renderQualityButton() { const b = this.$('.ex-quality'); if (b) b.textContent = `⚙ ${EXPLORE_QUALITY[this.quality].label}`; }
    // Troca o preset. Trocar o antialias exige um canvas novo (o contexto WebGL não muda depois de criado); o mapa é refeito no lugar.
    setQuality(id, manual) {
        if (!EXPLORE_QUALITY[id] || this.mode !== 'world') return false;
        const old = this.e3d && this.e3d.q;
        this.quality = id; this.qualityManual = !!manual;
        try { localStorage.setItem(EXPLORE_QUALITY_KEY, JSON.stringify({ id, manual: !!manual })); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
        this.gov.setQuality(id, window.devicePixelRatio || 1);
        if (this.e3d) {
            if (old && old.antialias !== EXPLORE_QUALITY[id].antialias) {
                const fresh = document.createElement('canvas'); fresh.className = 'ex-canvas';
                this.canvas.replaceWith(fresh); this.canvas = fresh;
                this.canvas.addEventListener('pointerdown', this._onCanvasDown);
                this.e3d.dispose(); this.e3d = new Explore3D(this.canvas, id, window.devicePixelRatio || 1);
            } else {
                this.e3d.q = EXPLORE_QUALITY[id]; this.e3d.qualityId = id; this.e3d._applyShadowMode(); this.e3d.setPixelRatio(this.gov.ratio);
                if (this.e3d.trainer) { this.e3d.world.remove(this.e3d.trainer); this.e3d.trainer = null; }       // refeito com a regra de sombra do preset
            }
            if (this.map) { const st = this.state; this._goTo(this.map.id, null); this.state = st; this.grace = 0; this.e3d.setTrainer(st, 0, false); this.e3d.resetTrail(st.dir); }
        }
        this._renderQualityButton();
        this._auto = { start: performance.now(), frames: 0, ms: 0 };
        return true;
    }
    close() {
        if (!this.open || this.mode === 'battle' || this.mode === 'cutscene') return;
        this.open = false; this.mode = 'world'; this.root.classList.remove('ex-shopping'); this._bang(null);
        if (this.music) this.music.stop();
        this._savePosition(); if (this._onHide) document.removeEventListener('visibilitychange', this._onHide);
        cancelAnimationFrame(this._raf);
        removeEventListener('keydown', this._onKeyDown, true); removeEventListener('keyup', this._onKeyUp, true); removeEventListener('resize', this._onResize);
        this.keys = []; this.joy = { x: 0, y: 0 }; this.path = null;
        this.root.hidden = true; document.body.classList.remove('exploring');
        this.game.exploreLeave();
        if (this.ui.renderTeam) this.ui.renderTeam();
    }

    // ---------------- DOM ----------------
    _build() {
        if (this.root) return;
        const el = document.createElement('div');
        el.id = 'explore'; el.hidden = true;
        el.innerHTML = `
            <canvas class="ex-canvas"></canvas>
            <div class="ex-flash"></div>
            <div class="ex-hud">
                <div class="ex-loc"><small>Explorar</small><b class="ex-loc-name">—</b><span class="ex-loc-sub"></span></div>
                <div class="ex-party"></div>
                <button type="button" class="ex-music" title="Música: ligar ou desligar">🔊</button>
                <button type="button" class="ex-quality" title="Qualidade gráfica: Leve, Médio ou Alto">⚙</button>
                <button type="button" class="ex-close" aria-label="Sair do modo Explorar">✕ Sair</button>
            </div>
            <div class="ex-notice" role="status" hidden></div>
            <div class="ex-joy" aria-hidden="true"><i></i></div>
            <div class="ex-ab"><button type="button" class="ex-b" aria-label="Correr">B</button><button type="button" class="ex-a" aria-label="Interagir">A</button></div>
            <div class="ex-battle" hidden>
                <div class="ex-box ex-foe"></div>
                <div class="ex-box ex-me"></div>
            </div>
            <div class="ex-panel"><div class="ex-text" aria-live="polite"></div><div class="ex-menu"></div></div>`;
        document.body.appendChild(el);
        this.root = el; this.canvas = el.querySelector('.ex-canvas');
        const $ = (s) => el.querySelector(s);
        this.$ = $;
        $('.ex-close').addEventListener('click', () => this.close());
        $('.ex-a').addEventListener('click', () => this._interact());
        const bBtn = $('.ex-b');
        bBtn.addEventListener('pointerdown', () => { this.running = true; }); bBtn.addEventListener('pointerup', () => { this.running = false; }); bBtn.addEventListener('pointerleave', () => { this.running = false; });
        // joystick (toque)
        const joy = $('.ex-joy'), knob = joy.querySelector('i'); let jid = null;
        const move = (e) => { const r = joy.getBoundingClientRect(); let dx = (e.clientX - r.left - r.width / 2) / (r.width / 2), dy = (e.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } knob.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`; this.joy = { x: dx, y: dy }; this.path = null; };
        joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); move(e); });
        joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) move(e); });
        const end = () => { jid = null; knob.style.transform = ''; this.joy = { x: 0, y: 0 }; };
        joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
        // toque/clique no chão: anda até lá (busca de caminho do motor)
        this._onCanvasDown = (e) => { if (this.mode === 'world' && !this.dialogLines) this._tapTo(e.clientX, e.clientY); else if (this.dialogLines) this._advanceDialog(); };
        this.canvas.addEventListener('pointerdown', this._onCanvasDown);
        $('.ex-music').addEventListener('click', () => this.setMusic(!this.musicOn));
        $('.ex-quality').addEventListener('click', () => { if (this.mode === 'world') this.setQuality(exploreQualityNext(this.quality), true); });
        $('.ex-panel').addEventListener('click', () => { if (this.dialogLines) this._advanceDialog(); });
    }
    _key(e, down) {
        if (!this.open) return;
        const k = e.key.toLowerCase(), dirKey = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' }[k];
        if (e.target && e.target.closest && e.target.closest('input,textarea,select')) return;
        if (dirKey) { e.preventDefault(); e.stopPropagation(); this.keys = this.keys.filter(x => x !== dirKey); if (down) { this.keys.push(dirKey); this.path = null; } return; }
        if (k === 'shift') { this.running = down; e.stopPropagation(); return; }
        if (down && (k === 'enter' || k === ' ' || k === 'e' || k === 'z')) { e.preventDefault(); e.stopPropagation(); if (this.dialogLines) this._advanceDialog(); else if (this.mode === 'world') this._interact(); return; }
        if (down && k === 'escape' && this.mode === 'world' && !this.dialogLines) { e.stopPropagation(); this.close(); }
    }

    // ---------------- mapas e transições ----------------
    // rota dos encontros: a do mapa (F10.8: a Floresta tem a rota própria) ou a rota escolhida no jogo
    _route() { return this.map && this.map.route ? this.game.getRoute(this.map.route) : this._gameRoute(); }
    _gameRoute() { return this.game.getRoute(this.game.gameState.currentRoute); }
    _routeMap() {
        const route = this._gameRoute();
        if (!route) return null;
        const fixed = worldMapIdForRoute(route.id);
        if (fixed) return getWorldMap(fixed);
        // bioma da rota = o mais comum entre as espécies dela (pesado pela chance); o mapa é o de caça da espécie mais comum desse bioma
        const list = (route.pokemon || []).filter(p => POKEMON_DATA[p.id] && !(typeof isRestrictedSpecies === 'function' && isRestrictedSpecies(p.id)));
        const byBiome = {};
        for (const p of list) { const bi = worldBiomeForTypes(POKEMON_DATA[p.id].types); byBiome[bi] = (byBiome[bi] || 0) + (p.weight || 1); }
        const biome = Object.keys(byBiome).sort((a, b) => byBiome[b] - byBiome[a])[0];
        const main = list.filter(p => worldBiomeForTypes(POKEMON_DATA[p.id].types) === biome).sort((a, b) => (b.weight || 0) - (a.weight || 0))[0] || route.pokemon[0];
        try { return main ? worldHuntMap(main.id) : null; } catch (e) { return null; }
    }
    _goTo(mapId, at) {
        const map = mapId === 'route' ? this._routeMap() : exploreMapById(mapId);
        if (!map) { this._dialog(['Esta rota ainda não tem mapa para explorar.']); return; }
        this.map = map; this.path = null;
        this.state = at ? { mapId: map.id, x: at.x * WORLD_TILE_SIZE + 8, y: at.y * WORLD_TILE_SIZE + 13, dir: at.dir || 'down', moving: false, distance: 0 } : worldCreateState(map);
        this.e3d.setMap(map); this.e3d.ensureTrainer();
        const pad = map.type === 'hunt' ? map.spawn : null;
        this.e3d.setExitPad(pad); this.onPad = !!pad;
        this.e3d.setTrainer(this.state, 0, false); this._refreshFollower(); this.e3d.resetTrail(this.state.dir);
        const route = this._route();
        const gi = map.gymInfo, own = Object.prototype.hasOwnProperty.call(EXPLORE_MAPS, map.id);
        this.$('.ex-loc-name').textContent = map.type === 'city' || own ? map.name : (route ? route.name : map.name);
        this.$('.ex-loc-sub').textContent = gi ? `Líder ${gi.leader} · tipo ${gi.type}${this.game.exploreHasBadge(gi.badge) ? ' · 🏅 vencido' : ''}` : map.type === 'city' ? ['Centro Pokémon', (map.interactions || []).some(i => i.type === 'depot') && 'Loja Pokémon', map.gym && 'Ginásio'].filter(Boolean).join(' · ') : (route && route.levelRange ? `Nv ${route.levelRange[0]}–${route.levelRange[1]} · ${exploreMapHasGrass(map) ? 'mato alto' : 'todo o chão'} tem encontros` : '');
        this.grace = 3; this.steps0 = this.state.distance;
        // F10.2: treinadores (obstáculos na colisão) e itens no chão
        this.npcs = exploreTrainerSpots(map, exploreTrainerCount(map)).map(t => ({ ...t, colors: t.klass.colors }));
        this.items = exploreItemSpots(map, exploreItemCount(map)).filter(i => !this.taken.has(i.id));
        this._rebuildCollision(); this.e3d.setNpcs(this.npcs); this.e3d.setItems(this.items); this.cut = null; this._bang(null);
        this._spawnRoamers();
        this._applyPhase(); if (this.open) { this._areaMusic(); this._savePosition(); }
        this._renderParty();
    }
    _resumeAt() {
        const at = this.game.exploreProgress().at; if (!at) return null;
        const rm = this._routeMap();
        if (!(at.map === EXPLORE_TOWN || EXPLORE_MAPS[at.map] || (rm && rm.id === at.map))) return null;          // a rota do jogo mudou: começa na cidade
        const map = exploreMapById(at.map); if (!map) return null;
        if (worldCellBlocked(map, Math.floor(at.x / WORLD_TILE_SIZE), Math.floor(at.y / WORLD_TILE_SIZE))) return null;
        const npcs = exploreTrainerSpots(map, exploreTrainerCount(map));
        if (npcs.some(n => n.x === Math.floor(at.x / WORLD_TILE_SIZE) && n.y === Math.floor(at.y / WORLD_TILE_SIZE))) return null;
        return { map, at };
    }
    _savePosition() { if (this.map && this.state && this.mode !== 'battle') this.game.exploreSetPosition({ map: this.map.id, x: this.state.x, y: this.state.y, dir: this.state.dir }); }
    // ---------------- F10.6 · selvagens visíveis ----------------
    _spawnRoamers() {
        this.roamers = []; this._rid = (this._rid || 0); this._roamT = 0; this._respawnAt = [];
        this.encCells = exploreEncounterCells(this.map);
        const n = exploreRoamerCount(this.map);
        for (let i = 0; i < n; i++) this._spawnRoamer();
    }
    _spawnRoamer() {
        if (!this.map || this.map.type === 'city') return;
        const c = this._cell(), cell = exploreRoamerSpawnCell(this.map, this.encCells, c, this.roamers.map(r => [r.x, r.y]), () => this.game.rng());
        if (!cell) return;
        const wild = this.game.exploreWild(this._route()); if (!wild) return;
        const r = { id: 'r' + (++this._rid), wild, x: cell[0], y: cell[1] };
        this.roamers.push(r); this.e3d.addRoamer(r.id, wild.id, !!wild.isShiny, r.x, r.y);
    }
    // a cada ~0,9 s cada selvagem talvez dê um passo; os que sumiram renascem depois de EXPLORE.roamerRespawnMs
    _tickRoamers(dt) {
        if (!this.roamers || this.mode !== 'world') return;
        this._roamT += dt;
        if (this._roamT >= 0.9) {
            this._roamT = 0;
            const rng = () => this.game.rng();
            for (const r of this.roamers) { const [nx, ny] = exploreRoamerStep(this.map, r.x, r.y, rng); if (nx !== r.x || ny !== r.y) { r.x = nx; r.y = ny; this.e3d.moveRoamer(r.id, nx, ny); } }
            this._touchRoamer();
        }
        const now = performance.now();
        while (this._respawnAt.length && this._respawnAt[0] <= now) { this._respawnAt.shift(); this._spawnRoamer(); }
    }
    _touchRoamer() {
        if (!this.roamers || this.mode !== 'world' || this.dialogLines) return false;
        const c = this._cell(), r = this.roamers.find(x => x.x === c.x && x.y === c.y);
        if (!r) return false;
        this.roamers = this.roamers.filter(x => x !== r); this.e3d.removeRoamer(r.id, true);
        this._respawnAt.push(performance.now() + EXPLORE.roamerRespawnMs);
        this._encounter(r.wild);
        return true;
    }
    _rebuildCollision() { this.cmap = exploreCollisionMap(this.map, (this.npcs || []).map(n => ({ x: n.x, y: n.y }))); }
    _cell() { return { x: Math.floor(this.state.x / WORLD_TILE_SIZE), y: Math.floor(this.state.y / WORLD_TILE_SIZE) }; }
    // item pisado: entrega pelo núcleo (limites do inventário, ouro pelo portão) e avisa
    _pickItem() {
        const c = this._cell(), it = (this.items || []).find(i => i.x === c.x && i.y === c.y);
        if (!it) return false;
        const route = this._route(), r = this.game.exploreGiveItem(it.item, route && route.levelRange ? route.levelRange[1] : 5);
        this.taken.add(it.id); this.game.exploreMark('taken', it.id); this.items = this.items.filter(i => i !== it); this.e3d.removeItem(it.id); this._renderParty();
        const name = it.item.kind === 'ball' ? `${getBallType(it.item.id).name}${r.added > 1 ? ` ×${r.added}` : ''}` : it.item.kind === 'potion' ? `Poção${r.added > 1 ? ` ×${r.added}` : ''}` : `${r.added} de ouro`;
        this._sfx('item'); this.keys = []; this.path = null;
        this._dialog(r.added > 0 ? [`Você encontrou ${name}!`] : ['Você encontrou um item, mas a bolsa já está cheia dele.']);
        return true;
    }
    // algum treinador ainda não vencido vê o jogador?
    _spotted() {
        const c = this._cell();
        for (const n of this.npcs || []) {
            if (this.defeated.has(n.id)) continue;
            const d = exploreTrainerSees(this.cmap, n, c.x, c.y);
            if (d) { this._engage(n, d); return true; }
        }
        return false;
    }
    // "!" sobre o treinador, ele anda até ficar ao lado do jogador, fala e a batalha começa
    _engage(n, dist) {
        this.mode = 'cutscene'; this.keys = []; this.path = null; this.state = { ...this.state, moving: false };
        this._sfx('spotted'); this._bang(n);
        const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[n.dir];
        const steps = Math.max(0, dist - 1);
        this.cut = { n, from: { x: n.x, y: n.y }, to: { x: n.x + dx * steps, y: n.y + dy * steps }, t: -0.8, dur: Math.max(0.01, steps / 4) };
    }
    _cutscene(dt) {
        const c = this.cut; if (!c) return;
        c.t += dt;
        const k = Math.max(0, Math.min(1, c.t / c.dur)), x = c.from.x + (c.to.x - c.from.x) * k, y = c.from.y + (c.to.y - c.from.y) * k;
        this.e3d.moveNpc(c.n.id, x + 0.5, y + 0.85, c.n.dir, c.t > 0 && k < 1, dt);
        if (c.t > 0) this._bang(null);
        if (k >= 1 && c.t >= c.dur) {
            this.cut = null; c.n.x = c.to.x; c.n.y = c.to.y; this._rebuildCollision();
            const k2 = c.n.klass;
            this._dialog([`${k2.cls} ${c.n.name}: "${k2.intro}"`], () => this._trainerBattle(c.n));
        }
    }
    _showBadge(id) {
        let el = this.$('.ex-badge-show');
        if (!id) { if (el) el.hidden = true; return; }
        const bd = EXPLORE_BADGES[id]; if (!bd) return;
        if (!el) { el = document.createElement('div'); el.className = 'ex-badge-show'; this.root.appendChild(el); }
        el.innerHTML = `<div class="ex-badge-gem" style="--bc:${bd.color}"></div><b>${escapeHtml(bd.name)}</b><small>${escapeHtml(bd.effect)}</small>`;
        el.hidden = false;
    }
    _bang(n) {
        let el = this.$('.ex-bang');
        if (!n) { if (el) el.hidden = true; this._bangFor = null; return; }
        if (!el) { el = document.createElement('div'); el.className = 'ex-bang'; el.textContent = '!'; this.root.appendChild(el); }
        el.hidden = false; this._bangFor = n;
    }
    _placeBang() {
        const el = this.$('.ex-bang'); if (!el || el.hidden || !this._bangFor) return;
        const m = this.e3d.npc(this._bangFor.id); if (!m) return;
        const p = this.e3d.screenOf(m, 1.75); el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    }
    _checkTransitions() {
        const m = this.map, cx = Math.floor(this.state.x / WORLD_TILE_SIZE), cy = Math.floor(this.state.y / WORLD_TILE_SIZE);
        if (m.id === EXPLORE_TOWN && cy >= m.height - 1) return this._goTo('route', null), true;
        if (m.id === 'kanto_route1' && cy >= m.height - 1) return this._goTo(EXPLORE_TOWN, { x: 13, y: 17, dir: 'up' }), true;
        if (m.id === 'kanto_route1' && cy <= 0) return this._goTo('explore_viridian', { x: 13, y: 19, dir: 'up' }), true;       // F10.5: ao norte da Rota 1, Viridian
        for (const e of m.exits || []) if (cy === e.y && cx >= e.x0 && cx <= e.x1) return this._goTo(e.to, e.at), true;
        if (m.type === 'hunt') {
            const onPad = cx === m.spawn.x && cy === m.spawn.y;
            if (onPad && !this.onPad) { this._goTo(EXPLORE_TOWN, { x: 13, y: 17, dir: 'up' }); return true; }
            this.onPad = onPad;
        }
        return false;
    }
    _interact() {
        if (this.mode !== 'world' || !this.map) return;
        const c = this._cell(), [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.state.dir] || [0, 1];
        const talk = (this.npcs || []).find(n => n.x === c.x + dx && n.y === c.y + dy);
        if (talk) { const k = talk.klass, bd = talk.badge && EXPLORE_BADGES[talk.badge]; this._dialog([this.defeated.has(talk.id) ? `${k.cls} ${talk.name}: "${talk.leader && bd ? `A ${bd.name} é sua. Continue treinando!` : k.lose}"` : `${k.cls} ${talk.name}: "${k.intro}"`], this.defeated.has(talk.id) ? null : () => this._trainerBattle(talk)); return; }
        const it = worldInteractionNear(this.map, this.state);
        if (!it) return;
        if (it.type === 'heal') this._center();
        else if (it.type === 'gym') {                      // F10.8: cada porta leva ao seu ginásio (gymInfo diz líder, tipo e insígnia)
            const to = it.to || 'explore_gym_rock', gm = EXPLORE_MAPS[to], gi = gm.gymInfo, bd = EXPLORE_BADGES[gi.badge];
            this._sfx('item'); this._goTo(to, null);
            this._dialog(this.game.exploreHasBadge(gi.badge) ? [`${gm.name}. A Líder ${gi.leader} acena: "${gi.back}"`] : [`${gm.name} — Líder ${gi.leader}. Tipo: ${gi.type}.`, `Vença os aprendizes e desafie a Líder para ganhar a ${bd.name}!`]);
        }
        else if (it.type === 'depot') this._dialog(['Bem-vindo à Loja Pokémon! (o Depot guarda seus Pokémon; para organizá-los, use a aba PC)'], () => this._mart());
    }
    // Loja Pokémon: as mesmas compras da aba Caça (buyShopItem: preço do jogo, compra atômica, limite de estoque)
    _mart(msg) {
        this.mode = 'shop'; this.root.classList.add('ex-shopping'); this.keys = []; this.path = null;
        const items = this.game.getShopItems().filter(i => i.id === 'potion' || (getBallType(i.id) && getBallType(i.id).buyable));
        this.$('.ex-text').textContent = msg || `O que vai querer? Você tem ${this.game.getMoney()} de ouro.`;
        const m = this.$('.ex-menu');
        m.innerHTML = items.map(i => `<button type="button" class="ex-btn" data-buy="${i.id}" data-qty="1" ${i.canBuyOne ? '' : 'disabled'}><b>${i.icon} ${escapeHtml(i.name)}</b><small>${i.price} de ouro · você tem ${i.stock}</small></button><button type="button" class="ex-btn ex-buy5" data-buy="${i.id}" data-qty="5" ${this.game.canAfford(i.price * 5) && i.room >= 1 ? '' : 'disabled'}><b>×5</b><small>${i.price * 5}</small></button>`).join('') + '<button type="button" class="ex-btn ex-leave">SAIR DA LOJA</button>';
        m.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
            const r = this.game.buyShopItem(b.dataset.buy, Number(b.dataset.qty));
            this._sfx(r.ok ? 'item' : 'ui'); this._renderParty();
            this._mart(r.ok ? `Aqui está! (${r.qty}× por ${r.total} de ouro). Você tem ${this.game.getMoney()} de ouro.` : r.code === 'insufficient_funds' ? 'Você não tem ouro suficiente.' : r.code === 'capacity_full' ? 'Sua bolsa já está cheia disso.' : 'Não foi possível comprar.');
        }));
        m.querySelector('.ex-leave').addEventListener('click', () => { this.mode = 'world'; this.root.classList.remove('ex-shopping'); m.innerHTML = ''; this._dialog(['Obrigado! Volte sempre!']); });
    }
    _center(afterLines = []) {
        this._dialog(['Olá! Bem-vindo ao Centro Pokémon.', 'Vamos cuidar dos seus Pokémon…', ...afterLines], () => {
            this.keep = {}; this._sfx('heal'); this._renderParty();
            this._dialog(['Seus Pokémon estão em plena forma! Volte sempre!']);
        });
    }

    // ---------------- quadro ----------------
    _frame(now) {
        if (!this.open) return;
        const dtMs = Math.min(100, now - this._last); this._last = now;
        const dt = dtMs / 1000;
        if (this.mode === 'world' && !this.dialogLines && this.map) this._move(dtMs);
        if (this.mode === 'cutscene') this._cutscene(dt);
        this._tickRoamers(dt);
        this._phaseCheck += dt; if (this._phaseCheck > 30) { this._phaseCheck = 0; if (this.mode !== 'battle') this._applyPhase(); }
        if ((this.mode === 'world' || this.mode === 'cutscene' || this.mode === 'shop') && this.state) this.e3d.setTrainer(this.state, dt, this.running);
        // F10.1: algo se mexe (treinador, efeitos, animação de batalha) → teto de FPS do preset; parado → FPS de repouso.
        // A câmera ainda desliza ~0,6 s depois de parar, então conta como movimento.
        const moving = !!(this.state && this.state.moving) || this.e3d.isAnimating() || this.busy || this.mode === 'cutscene';
        if (moving) this._activeUntil = now + 600;
        const active = now < this._activeUntil;
        this._acc += dt;
        if (this.gov.shouldRender(now, active)) {
            const gap = now - this._lastRender, steady = active && this._wasActive; this._lastRender = now; this._wasActive = active;
            this.e3d.render(this._acc); this._acc = 0; this._placeBang();
            if (steady) {                 // só quadros seguidos em movimento medem o desempenho (o 1º depois de parado traz o intervalo de repouso)
                const r = this.gov.sample(gap); if (r !== null) this.e3d.setPixelRatio(r);
                this._auto.frames++; this._auto.ms += gap;
                const el = now - this._auto.start;
                if (el > EXPLORE_AUTO_WINDOW_MS && this._auto.frames > 10) {
                    const lower = exploreAutoDowngrade(this.quality, 1000 * this._auto.frames / this._auto.ms, EXPLORE_AUTO_WINDOW_MS, this.qualityManual);
                    if (lower && this.mode === 'world' && !this.dialogLines) { this.setQuality(lower, false); this._notice(`Gráficos ajustados para ${EXPLORE_QUALITY[lower].label} para manter a fluidez. Toque em ⚙ para mudar.`); }
                    this._auto.start = Infinity;      // uma janela por abertura (ou por troca de preset)
                }
            }
        }
        this._raf = requestAnimationFrame((t) => this._frame(t));
    }
    _dir() {
        if (this.keys.length) return this.keys[this.keys.length - 1];
        const { x, y } = this.joy;
        if (Math.hypot(x, y) < 0.3) return null;
        return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    }
    _move(dtMs) {
        const speed = WORLD_MOVEMENT.walkSpeed * (this.running ? 2.1 : 1.35), prev = this.state;
        const dir = this._dir();
        let next = prev;
        if (dir) next = worldStep(this.cmap || this.map, prev, dir, dtMs, speed);
        else if (this.path && this.path.length) {
            const r = worldAdvanceToward(this.cmap || this.map, prev, this.path[0], dtMs, speed);
            next = { ...r.state, moving: !r.arrived || this.path.length > 1 };
            if (r.arrived) this.path.shift();
            if (r.blocked) this.path = null;
        } else next = { ...prev, moving: false };
        this.state = next;
        if (next.distance === prev.distance) return;
        if (this._checkTransitions()) return;
        const stepped = Math.floor(next.distance / WORLD_TILE_SIZE) !== Math.floor(prev.distance / WORLD_TILE_SIZE);
        if (stepped) { const c = this._cell(); if (this.map.rows[c.y] && this.map.rows[c.y][c.x] === 'w') { this.e3d.rustle(next.x / WORLD_TILE_SIZE, next.y / WORLD_TILE_SIZE); this._sfx('rustle'); } }
        if (stepped || !next.moving) { if (this._pickItem()) return; if (this._spotted()) return; if (this._touchRoamer()) return; }
        if (this.grace > 0) { this.grace -= (next.distance - prev.distance) / WORLD_TILE_SIZE; return; }
        const enc = exploreStepEncounter(this.map, prev, next, () => this.game.rng(), this.roamers && this.roamers.length ? EXPLORE.roamerRandomMult : 1);
        if (enc) this._encounter();
    }
    _tapTo(clientX, clientY) {
        const cell = this.e3d.cellAt(clientX, clientY); if (!cell) return;
        const from = { x: Math.floor(this.state.x / WORLD_TILE_SIZE), y: Math.floor(this.state.y / WORLD_TILE_SIZE) };
        const cells = worldFindPath(this.cmap || this.map, from, cell);
        if (!cells) return;
        this.path = worldPathWaypoints(cells).slice(1);
        this.keys = [];
    }
    _refreshFollower() {
        const st = this.game.gameState, inst = this.game._partyInstance(st.activePokemonIndex) || this.game._partyInstance(0);
        this.e3d.setFollower(inst ? inst.speciesId : null, inst ? !!inst.shiny : false);
    }
    _renderParty() {
        const st = this.game.gameState, out = [];
        st.party.forEach((uid, i) => {
            const inst = this.game._partyInstance(i); if (!inst) return;
            const f = this.keep[uid] ? this.keep[uid].hp : 1;
            out.push(`<span class="ex-pm${f <= 0 ? ' ko' : ''}" title="${escapeHtml(getInstanceDisplayName(inst))}"><img src="${inst.shiny ? getShinyPokemonSpriteUrl(inst.speciesId) : getPokemonSpriteUrl(inst.speciesId)}" alt=""><i style="width:${Math.max(0, f) * 100}%;background:${this._hpColor(f)}"></i></span>`);
        });
        const inv = this.game.ensureInventory(), balls = BALL_TYPES.map(b => [b, this.game.getBallCount(b.id)]).filter(([, n]) => n > 0);
        out.push(`<span class="ex-items">${balls.map(([b, n]) => `${b.icon} ${n}`).join(' · ') || '⚪ 0'} · 🧪 ${inv.potions}</span>`);
        this.$('.ex-party').innerHTML = out.join('');
    }
    _hpColor(f) { return f > 0.5 ? '#3ddc84' : f > 0.2 ? '#ffc93c' : '#ff5a5a'; }

    // ---------------- diálogo ----------------
    _dialog(lines, done) { this.dialogLines = lines.slice(); this.dialogDone = done || null; this.$('.ex-menu').innerHTML = ''; this.root.classList.add('ex-talking'); this._advanceDialog(); }
    _advanceDialog() {
        if (!this.dialogLines) return;
        if (this._lineHide) { const h = this._lineHide; this._lineHide = null; h(); }          // F10.7: o painel de uma fala some quando ela passa
        if (!this.dialogLines.length) { this.dialogLines = null; this.root.classList.remove('ex-talking'); this.$('.ex-text').textContent = ''; const d = this.dialogDone; this.dialogDone = null; if (d) d(); return; }
        const line = this.dialogLines.shift();
        if (this._badgeLine && line === this._badgeLine) { this._badgeLine = null; this._sfx('caught'); this._showBadge(this._badgeId); }       // a insígnia aparece junto da fala dela
        if (line && typeof line === 'object' && line.show) this._lineHide = line.show() || null;            // fala com painel/efeito (tela de nível, evolução)
        this.$('.ex-text').textContent = (line && typeof line === 'object' ? line.text : line) + '  ▼';
    }
    _say(lines, done, ms = 900) {
        const box = this.$('.ex-text'); this.$('.ex-menu').innerHTML = '';
        const next = () => { if (!lines.length) return done && done(); box.textContent = lines.shift(); setTimeout(next, ms); };
        next();
    }

    // ---------------- batalha ----------------
    _encounter(seen) {
        const route = this._route(), wild = seen || this.game.exploreWild(route);
        if (!wild) return;
        const battle = new ExploreBattle(this.game, wild, { keep: this.keep });
        if (!battle.canFight()) { this.grace = 4; this._dialog(['Um Pokémon selvagem apareceu, mas seus Pokémon estão sem forças!', 'Volte ao Centro Pokémon na Cidade Inicial para curá-los.']); return; }
        this.mode = 'battle'; this.battle = battle; this.keys = []; this.path = null; this.busy = true;
        this._sfx('encounter'); if (this.music) this.music.play('wild');
        const fl = this.$('.ex-flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
        setTimeout(() => {
            const g = this._groundColor();
            this.e3d.startBattle({ ground: g.ground, sky: g.sky, foe: { id: wild.id, shiny: !!wild.isShiny }, me: { id: battle.me().speciesId, shiny: battle.me().shiny } });
            this.$('.ex-battle').hidden = false; this.root.classList.add('ex-in-battle');
            this._boxes();
            const f = battle.foe, lines = [`${f.shiny ? '✨ Um ' + f.name + ' BRILHANTE' : 'Um ' + f.name} selvagem apareceu!`, `Vai! ${battle.me().name}!`];
            if (f.shiny) this._sfx('shiny');
            this._say(lines, () => { this.busy = false; this._menu(); });
        }, 650);
    }
    _trainerBattle(n) {
        const route = this._route(), team = Array.isArray(n.team) ? exploreFixedTeam(this.game, n) : exploreTrainerTeam(this.game, route, n);
        if (!team.length) return;
        const battle = new ExploreBattle(this.game, team[0], { keep: this.keep, trainer: { id: n.id, cls: n.klass.cls, name: n.name, team, klass: n.klass, leader: !!n.leader, badge: n.badge || null } });
        if (!battle.canFight()) { this._dialog([`${n.klass.cls} ${n.name}: "Seus Pokémon estão sem forças. Volte depois do Centro Pokémon!"`]); this.mode = 'world'; return; }
        this.mode = 'battle'; this.battle = battle; this.busy = true; this._trainerNpc = n;
        this._sfx('encounter'); if (this.music) this.music.play(n.leader ? 'leader' : 'trainer');
        const fl = this.$('.ex-flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
        setTimeout(() => {
            const g = this._groundColor();
            this.e3d.startBattle({ ground: g.ground, sky: g.sky, foe: { id: team[0].id, shiny: false }, me: { id: battle.me().speciesId, shiny: battle.me().shiny } });
            this.$('.ex-battle').hidden = false; this.root.classList.add('ex-in-battle');
            this._boxes();
            this._say([`${n.klass.cls} ${n.name} quer batalhar!`, `${n.klass.cls} ${n.name} enviou ${battle.foe.name}!`, `Vai! ${battle.me().name}!`], () => { this.busy = false; this._menu(); });
        }, 650);
    }
    _groundColor() {
        const b = this.map.biome;
        if (this.map.indoor) return { ground: '#cfc6b4', sky: '#3a3028' };
        return { cave: { ground: '#7a6b5c', sky: '#3b3328' }, volcano: { ground: '#4e4440', sky: '#5a2a22' }, snow: { ground: '#e9f1f8', sky: '#cfe3f5' }, haunted: { ground: '#4f425f', sky: '#2a2238' }, lake: { ground: '#6fc46a', sky: '#9fd8ff' } }[b] || { ground: '#62c45c', sky: '#a8dcff' };
    }
    _box(u, mine) {
        const f = u.hp / u.maxHp, st = u.status ? `<span class="ex-st">${EXPLORE_STATUS[u.status].tag}</span>` : '';
        let exp = '';
        if (mine && u.inst) {
            try { const d = POKEMON_DATA[u.inst.speciesId], g = d.expGroup || 'medium', a = getExpForLevel(g, u.inst.level), b = getExpForLevel(g, u.inst.level + 1); const p = b > a ? Math.max(0, Math.min(1, (u.inst.exp - a) / (b - a))) : 0; exp = `<div class="ex-exp"><i style="width:${p * 100}%"></i></div>`; } catch (e) { exp = ''; }
        }
        const team = !mine && this.battle && this.battle.trainer ? `<div class="ex-team" aria-label="Pokémon restantes do treinador">${this.battle.trainer.team.map((w, i) => `<i class="${i < this.battle.foeIndex || (i === this.battle.foeIndex && u.hp <= 0) ? 'out' : ''}"></i>`).join('')}</div>` : '';
        return `${team}<div class="ex-name"><span>${u.shiny ? '✨' : ''}${escapeHtml(u.name)} ${st}</span><em>Nv${u.inst ? u.inst.level : u.level}</em></div>
            <div class="ex-types">${u.types.map(t => `<span style="background:${EXPLORE_TYPE_COLORS[t] || '#999'}">${TYPE_NAMES[t] || t}</span>`).join('')}</div>
            <div class="ex-hp"><b>PS</b><div><i style="width:${f * 100}%;background:${this._hpColor(f)}"></i></div></div>${mine ? `<div class="ex-hpn">${u.hp} / ${u.maxHp}</div>${exp}` : ''}`;
    }
    _boxes() { if (!this.battle) return; this.$('.ex-foe').innerHTML = this._box(this.battle.foe, false); this.$('.ex-me').innerHTML = this._box(this.battle.me(), true); }
    _menu() {
        const b = this.battle; if (!b || b.over) return;
        this.$('.ex-text').textContent = `O que ${b.me().name} vai fazer?`;
        const m = this.$('.ex-menu');
        m.innerHTML = `<button type="button" data-m="fight" class="ex-btn fight">LUTAR</button><button type="button" data-m="bag" class="ex-btn bag">BOLSA</button><button type="button" data-m="party" class="ex-btn party">POKÉMON</button><button type="button" data-m="run" class="ex-btn run">FUGIR</button>`;
        m.querySelectorAll('[data-m]').forEach(x => x.addEventListener('click', () => { this._sfx('ui'); const k = x.dataset.m; if (k === 'fight') this._moves(); else if (k === 'bag') this._bag(); else if (k === 'party') this._party(); else this._act({ type: 'run' }); }));
        const first = m.querySelector('button'); if (first) first.focus({ preventScroll: true });
    }
    _back(m) { const bk = document.createElement('button'); bk.type = 'button'; bk.className = 'ex-btn'; bk.textContent = 'VOLTAR'; bk.addEventListener('click', () => this._menu()); m.appendChild(bk); }
    _moves() {
        const b = this.battle, m = this.$('.ex-menu'), foeTypes = b.foe.types;
        m.innerHTML = b.me().moves.map((mv, i) => {
            const eff = getBestTypeEffectiveness([mv.type], foeTypes).multiplier, tag = eff > 1 ? '<em class="sup">super</em>' : eff < 1 ? '<em class="weak">fraco</em>' : '';
            return `<button type="button" class="ex-btn mv" data-i="${i}" style="--tc:${EXPLORE_TYPE_COLORS[mv.type] || '#999'}" ${mv.pp <= 0 ? 'disabled' : ''}><b>${escapeHtml(mv.name)} ${tag}</b><small>${TYPE_NAMES[mv.type] || mv.type} · Poder ${mv.power} · PP ${mv.pp}/${mv.maxPp}</small></button>`;
        }).join('');
        m.querySelectorAll('[data-i]').forEach(x => x.addEventListener('click', () => this._act({ type: 'move', i: Number(x.dataset.i) })));
        this._back(m);
    }
    _bag() {
        const b = this.battle, m = this.$('.ex-menu'), inv = this.game.ensureInventory(), hpF = b.foe.hp / b.foe.maxHp, rate = speciesCatchRate(POKEMON_DATA[b.foe.speciesId]);
        const balls = BALL_TYPES.filter(x => this.game.getBallCount(x.id) > 0);
        m.innerHTML = balls.map(x => `<button type="button" class="ex-btn" data-ball="${x.id}"><b>${x.icon} ${x.name} ×${this.game.getBallCount(x.id)}</b><small>chance ~${Math.round(exploreCaptureChance(rate, x, hpF, !!b.foe.status) * 100)}%</small></button>`).join('')
            + `<button type="button" class="ex-btn" data-potion ${inv.potions <= 0 ? 'disabled' : ''}><b>🧪 Poção ×${inv.potions}</b><small>cura ${Math.round(this.game.getPotionHealPercent() * 100)}% dos PS</small></button>`;
        if (!balls.length) m.insertAdjacentHTML('afterbegin', '<p class="ex-note">Sem bolas. Compre na Loja da aba Caça.</p>');
        m.querySelectorAll('[data-ball]').forEach(x => x.addEventListener('click', () => this._act({ type: 'ball', id: x.dataset.ball })));
        const p = m.querySelector('[data-potion]'); if (p) p.addEventListener('click', () => this._act({ type: 'potion' }));
        this._back(m);
    }
    _party() {
        const b = this.battle, m = this.$('.ex-menu');
        m.innerHTML = b.party.map((u, i) => `<button type="button" class="ex-btn pk" data-p="${i}" ${u.hp <= 0 || i === b.active ? 'disabled' : ''}><img src="${u.shiny ? getShinyPokemonSpriteUrl(u.speciesId) : getPokemonSpriteUrl(u.speciesId)}" alt=""><b>${escapeHtml(u.name)} Nv${u.level}</b><small>PS ${u.hp}/${u.maxHp}${i === b.active ? ' · em campo' : ''}</small></button>`).join('');
        m.querySelectorAll('[data-p]').forEach(x => x.addEventListener('click', () => this._act({ type: 'switch', i: Number(x.dataset.p) })));
        this._back(m);
    }
    _act(action) {
        if (this.busy || !this.battle) return;
        this.busy = true; this.$('.ex-menu').innerHTML = '';
        const steps = this.battle.act(action);
        if (!steps.length) { this.busy = false; this._menu(); return; }
        this._play(steps, () => { this.busy = false; this._renderParty(); if (this.battle.over) this._finish(); else { this._boxes(); this._menu(); } });
    }
    _play(steps, done) {
        if (!steps.length) return done();
        const s = steps.shift(), next = (ms = 900) => setTimeout(() => this._play(steps, done), ms), e = this.e3d;
        if (s.msg) this.$('.ex-text').textContent = s.msg;
        switch (s.t) {
            case 'hit': e.attack(s.side, s.mtype, s.power, () => this._boxes()); this._sfx(s.crit || s.eff > 1 ? 'crit' : 'hit'); return next(800);
            case 'miss': e.attack(s.side, 'normal', 30); return next();
            case 'dot': case 'status': this._boxes(); this._sfx('hit'); return next();
            case 'heal': e.heal(s.side); this._boxes(); this._sfx('heal'); return next();
            case 'faint': e.faint(s.side); this._sfx('faint'); this._boxes(); return next(1100);
            case 'recall': return next(600);
            case 'switch': e.setMine(this.battle.me().speciesId, this.battle.me().shiny); this._boxes(); return next(900);
            case 'xp': {                                   // F10.7: o treinador ainda tem Pokémon — a barra enche aqui e quem subiu de nível já luta mais forte
                const me = this.battle.me(), r = this.game.exploreVictory(s.wild, me.idx, me.maxHp, me.hp);
                this.$('.ex-text').textContent = this._expText(me.name, r.expGained);
                this._expRun(r.growth, () => {
                    const learned = this.battle.refresh(); if (!this._activeEvolved(r.growth)) this._boxes();      // evoluiu: a caixa muda junto da fala da evolução
                    const lines = this._growthLines(r.growth, learned);
                    if (!lines.length) return next(350);
                    this._dialog(lines, () => next(200));
                });
                return;
            }
            case 'foeSwitch': e.setFoe(this.battle.foe.speciesId, false); this._boxes(); this._sfx('throw'); return next(1000);
            case 'throw': this._sfx('throw'); e.throwBall(s.ball, () => this._play(steps, done)); return;
            case 'shake': this._sfx('shake'); e.shakeBall(() => this._play(steps, done)); return;
            case 'caught': this._sfx('caught'); e.caught(() => this._play(steps, done)); return;
            case 'breakfree': e.breakFree(() => next(700)); return;
            default: return next();
        }
    }
    _finish() {
        const b = this.battle, g = this.game, me = b.me(), over = b.over;
        if ((over === 'win' || over === 'caught') && this.music) this.music.play('victory');
        if (over === 'win' || over === 'caught') {
            const pre = [], post = [], name0 = me.name;
            if (over === 'caught') {
                const o = b.caught && b.caught.outcome;
                if (o && o.firstCatch) pre.push(`Os dados de ${b.foe.name} foram registrados na Pokédex!`);
                if (o && o.uid) pre.push(g.gameState.party.includes(o.uid) ? `${b.foe.name} entrou para a sua equipe!` : `${b.foe.name} foi enviado ao PC.`);
            }
            const r = g.exploreVictory(b.wild, me.idx, me.maxHp, me.hp);
            post.push(...this._growthLines(r.growth, b.refresh()));
            if (r.goldGained > 0) post.push(`Você recebeu ${r.goldGained} de ouro.`);
            if (b.trainer) {
                const t = b.trainer, prize = this.game.exploreTrainerReward(exploreTrainerPrize(t.team) * (t.leader ? 3 : 1), t.id);
                this.defeated.add(t.id); this.game.exploreMark('defeated', t.id);
                post.push(`Você derrotou ${t.cls} ${t.name}!`, `${t.name}: "${t.klass.lose}"`);
                if (prize.amount > 0) post.push(`Você recebeu ${prize.amount} de ouro pela vitória.`);
                if (t.leader && t.badge && this.game.exploreAwardBadge(t.badge)) {
                    const bd = EXPLORE_BADGES[t.badge];
                    post.push(`Você recebeu a ${bd.name}!`, `Efeito: ${bd.effect}.`);
                    this._badgeLine = `Você recebeu a ${bd.name}!`; this._badgeId = t.badge;
                }
            }
            this.keep = b.keep();
            const end = () => { this._showBadge(null); this._endBattle(false); };
            const runExp = () => {                         // "ganhou EXP" com a barra enchendo; depois as falas (nível, evolução, prêmio)
                this.busy = true; this.$('.ex-menu').innerHTML = '';
                this.$('.ex-text').textContent = this._expText(name0, r.expGained);
                this._expRun(r.growth, () => { this.busy = false; if (!this._activeEvolved(r.growth)) this._boxes(); if (post.length) this._dialog(post, end); else setTimeout(end, 500); });
            };
            if (pre.length) this._dialog(pre, runExp); else runExp();
            return;
        }
        const lines = [];
        if (over === 'run') this.keep = b.keep();
        const lose = over === 'lose';
        if (lose) { this.keep = {}; lines.push('Tudo escureceu…'); }
        if (!lines.length) return this._endBattle(lose);
        this._dialog(lines, () => { this._showBadge(null); this._endBattle(lose); });
    }
    // ---------------- F10.7 · EXP animada e tela de nível ----------------
    _activeEvolved(growth) { const a = growth && growth.before[growth.active], z = growth && growth.after[growth.active]; return !!(a && z && a.uid === z.uid && a.speciesId !== z.speciesId); }
    _expText(name, n) { return `${name} ganhou ${typeof ptNumber === 'function' ? ptNumber(n) : n} de EXP!`; }
    // Anima a barra de EXP do Pokémon em campo pelos trechos de exploreExpSegments; a cada nível, som e brilho na caixa.
    _expRun(growth, done) {
        const a = growth && growth.before[growth.active], z = growth && growth.after[growth.active];
        const segs = a && z && a.uid === z.uid ? exploreExpSegments(a, z) : [];
        const bar = this.$('.ex-me .ex-exp i'), lv = this.$('.ex-me .ex-name em'), box = this.$('.ex-me');
        this._expAnim = { segs: segs.length, levels: 0 };
        if (!segs.length || !bar) return done();
        const run = (k) => {
            if (k >= segs.length || !this.open) return done();
            const s = segs[k], ms = Math.round(220 + 900 * Math.max(0, s.to - s.from));
            if (lv) lv.textContent = `Nv${s.level}`;
            bar.style.transition = 'none'; bar.style.width = `${s.from * 100}%`; void bar.offsetWidth;
            bar.style.transition = `width ${ms}ms linear`; bar.style.width = `${s.to * 100}%`;
            if (s.to > s.from) this._sfx('exp', ms / 1000);
            setTimeout(() => {
                if (s.to >= 1) {                                 // encheu: sobe de nível
                    this._expAnim.levels++; this._sfx('lvup');
                    if (box) { box.classList.remove('lvup'); void box.offsetWidth; box.classList.add('lvup'); }
                    return setTimeout(() => run(k + 1), 380);
                }
                run(k + 1);
            }, ms + 40);
        };
        run(0);
    }
    // Falas depois da EXP: tela de nível do Pokémon em campo, níveis dos outros da equipe (EXP dividida) e golpes novos
    _growthLines(growth, learned = []) {
        const out = []; if (!growth) return out;
        const list = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0];
        growth.after.forEach((z, i) => {
            const a = growth.before[i]; if (!a || !z || a.uid !== z.uid) return;
            const mine = i === growth.active, evolved = z.speciesId !== a.speciesId;
            if (z.level > a.level) out.push(mine ? { text: `${a.name} subiu para o nível ${z.level}!`, show: () => this._lvupPanel(a, z) } : `${a.name} também subiu para o nível ${z.level}! (EXP dividida)`);
            else if (evolved) out.push(mine ? `${a.name} subiu de nível!` : `${a.name} também subiu de nível! (EXP dividida)`);
            if (!evolved) return;                          // evolução (o jogo evolui na hora): o sprite em campo troca com brilho
            const to = z.speciesId, shiny = !!(this.battle && this.battle.party.find(u => u.idx === i) || {}).shiny;
            out.push(`O quê? ${a.name} está evoluindo!`);
            out.push({ text: `Parabéns! ${a.name} evoluiu para ${POKEMON_DATA[to].name}!${z.level < a.level ? ` Espécie nova na Pokédex: recomeça no Nv${z.level}.` : ''}`,
                show: () => { this._sfx('heal'); if (mine && this.e3d) { this.e3d.setMine(to, shiny); this.e3d.heal('me'); this._boxes(); } } });
        });
        for (const l of learned) {
            if (l.forgot && l.forgot.length) out.push(`1, 2 e… Puf! ${l.name} esqueceu ${list(l.forgot)}.`);
            out.push({ text: `${l.name} aprendeu ${list(l.learned)}!`, show: () => { this._sfx('item'); } });
        }
        return out;
    }
    _lvupPanel(a, z) {
        let el = this.$('.ex-lvup');
        if (!el) { el = document.createElement('div'); el.className = 'ex-lvup'; el.setAttribute('role', 'status'); this.root.appendChild(el); }
        const rows = exploreStatGains(a.stats, z.stats);
        el.innerHTML = `<b>${escapeHtml(a.name)} <em>Nv ${a.level} → ${z.level}</em></b><table>${rows.map(r => `<tr><th>${r.label}</th><td>${r.from}</td><td>→ ${r.to}</td><td class="${r.delta > 0 ? 'up' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</td></tr>`).join('')}</table>`;
        el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
        this._sfx('lvup');
        return () => { el.hidden = true; };
    }
    _endBattle(lose) {
        this.battle = null; this.mode = 'world';
        const lu = this.$('.ex-lvup'); if (lu) lu.hidden = true; this._lineHide = null;
        this.e3d.endBattle(); this.$('.ex-battle').hidden = true; this.root.classList.remove('ex-in-battle');
        this._refreshFollower(); this.e3d.resetTrail(this.state.dir); this._renderParty();
        this.grace = 3; this._applyPhase(); this._areaMusic();
        if (lose) { this._goTo(EXPLORE_TOWN, { x: 6, y: 6, dir: 'up' }); this._center(['Seus Pokémon desmaiaram… você correu para cá.']); }
    }

    // ---------------- som (sintetizado; sem arquivos) ----------------
    _audioInit() { try { if (!this.audio) { const A = window.AudioContext || window.webkitAudioContext; if (A) this.audio = new A(); } if (this.audio && this.audio.state === 'suspended') this.audio.resume(); } catch (e) { this.audio = null; } }
    _sfx(kind, arg) {
        const ac = this.audio; if (!ac || ac.state !== 'running') return;
        const tone = (f, d, type = 'square', v = 0.05, delay = 0, slide = 1) => { const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide !== 1) o.frequency.exponentialRampToValueAtTime(f * slide, t + d); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + 0.02); };
        const seq = (notes, step = 0.09, type = 'square') => notes.forEach((n, i) => tone(n, step * 1.4, type, 0.05, i * step));
        switch (kind) {
            case 'encounter': seq([392, 523, 659, 784, 659, 784, 988], 0.07); break;
            case 'shiny': seq([1319, 1568, 2093, 1568, 2093], 0.06, 'triangle'); break;
            case 'hit': tone(180, 0.12, 'sawtooth', 0.06, 0, 0.5); break;
            case 'crit': tone(320, 0.18, 'sawtooth', 0.07, 0, 0.4); tone(160, 0.2, 'square', 0.05, 0.05, 0.5); break;
            case 'faint': tone(440, 0.6, 'triangle', 0.06, 0, 0.3); break;
            case 'throw': tone(600, 0.25, 'triangle', 0.05, 0, 2); break;
            case 'shake': tone(240, 0.08, 'square', 0.05); break;
            case 'caught': seq([523, 659, 784, 1047, 784, 1047], 0.1, 'triangle'); break;
            case 'heal': seq([523, 659, 784, 659, 784, 1047], 0.12, 'triangle'); break;
            case 'ui': tone(880, 0.04, 'square', 0.03); break;
            case 'spotted': seq([988, 1319, 988, 1319], 0.06, 'square'); break;
            case 'item': seq([784, 988, 1175, 1568], 0.08, 'triangle'); break;
            case 'exp': tone(330, Math.max(0.12, arg || 0.5), 'square', 0.025, 0, 2.6); break;        // F10.7: a barra enchendo (sobe o tom)
            case 'lvup': seq([784, 988, 1175, 1568, 1175, 1568], 0.075, 'square'); break;
            case 'rustle': tone(3200, 0.05, 'sawtooth', 0.008, 0, 0.4); break;
        }
    }
}
