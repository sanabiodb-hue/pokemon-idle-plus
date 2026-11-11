// ============================================================
// F11.1 · Arena 3D da aba de batalha: a caça automática acontece numa cena 3D viva (Three.js, o mesmo módulo do modo Explorar,
// carregado sob demanda). A arena só DESENHA: toda a regra continua no GameCore (os eventos de batalha chegam por ui.js).
//   - cenário pelo bioma da rota (campo, floresta, caverna, vulcão, neve, assombrado, lago), fase do dia pelo relógio do aparelho,
//     partículas no ar, sprites dos Pokémon com sombra;
//   - golpes com o formato e a área reais (js/fx/move-fx.js): raio que cai, cone de fogo, feixe, onda, terremoto…
//   - números de dano flutuando, desmaio, EXP voando para o seu Pokémon, bola na captura.
// Sem WebGL (ou desligada no botão "3D"), a cena 2D antiga continua valendo.
// ============================================================
let BATTLE_STAGE_ENABLED = true;
const BATTLE_STAGE_KEY = 'pokemon_idle_stage3d';          // preferência deste aparelho: 'off' desliga a arena 3D
const BATTLE_STAGE_THREE_URL = 'js/vendor/three.module.min.js';
// bioma → cores e enfeites. prop: árvore | pinheiro | pedra | cristal | morta | junco
const BATTLE_STAGE_BIOMES = {
    meadow: { name: 'Campo', ground: '#62c45c', far: '#4aa84f', sky: '#a8dcff', prop: 'tree', mote: '#fffbe0', moteRise: 0.25 },
    forest: { name: 'Floresta', ground: '#4fae52', far: '#2f7a3c', sky: '#8fd0c0', prop: 'tree', mote: '#d8ffb0', moteRise: 0.2, dense: true },
    cave: { name: 'Caverna', ground: '#7a6b5c', far: '#4a4038', sky: '#3b3328', prop: 'rock', mote: '#d8c8a8', moteRise: 0.08 },
    volcano: { name: 'Vulcão', ground: '#5a4a44', far: '#3a2a26', sky: '#5a2a22', prop: 'rock', mote: '#ff9a3a', moteRise: 0.9 },
    snow: { name: 'Neve', ground: '#e9f1f8', far: '#c4d6e6', sky: '#cfe3f5', prop: 'pine', mote: '#ffffff', moteRise: -0.7 },
    haunted: { name: 'Assombrado', ground: '#4f425f', far: '#30263c', sky: '#2a2238', prop: 'dead', mote: '#b39cff', moteRise: 0.3 },
    lake: { name: 'Lago', ground: '#6fc46a', far: '#3f8fd0', sky: '#9fd8ff', prop: 'reed', mote: '#c8f0ff', moteRise: 0.35, water: true },
};
// Bioma da rota: o mais comum entre as espécies dela, pesado pela chance (mesma régua do mapa de caça). Puro.
function battleStageBiome(route) {
    const list = ((route && route.pokemon) || []).filter(p => POKEMON_DATA[p.id]);
    if (!list.length || typeof worldBiomeForTypes !== 'function') return 'meadow';
    const by = {};
    for (const p of list) { const b = worldBiomeForTypes(POKEMON_DATA[p.id].types); by[b] = (by[b] || 0) + (p.weight || 1); }
    const best = Object.keys(by).sort((a, b) => by[b] - by[a] || (a < b ? -1 : 1))[0];
    return Object.prototype.hasOwnProperty.call(BATTLE_STAGE_BIOMES, best) ? best : 'meadow';
}
// Texto do número de dano: { text, cls }
function battleStageDamageLabel(damage, critical, effectiveness) {
    const d = Math.max(0, Math.round(Number(damage) || 0)), e = Number(effectiveness);
    return { text: `-${typeof ptNumber === 'function' ? ptNumber(d) : d}${critical ? '!' : ''}`, cls: (critical ? 'crit ' : '') + (e > 1 ? 'super' : e > 0 && e < 1 ? 'weak' : e === 0 ? 'immune' : '') };
}

class BattleStage3D {
    constructor(ui) {
        this.ui = ui; this.game = ui.game; this.ready = false; this.failed = false; this.loading = false;
        let pref = null; try { pref = localStorage.getItem(BATTLE_STAGE_KEY); } catch (e) { /* sem armazenamento */ }
        this.enabled = BATTLE_STAGE_ENABLED && pref !== 'off';
        this.pending = null; this.fxq = 0; this.t = 0; this.shake = 0; this.flash = 0; this.biome = null; this.frames = 0; this.slow = 0; this.lite = false;
        this.stats = { attacks: 0, hits: 0, faints: 0, captures: 0 };
    }
    // cria o canvas e o botão dentro de #battle-scene (uma vez)
    mount() {
        const scene = document.getElementById('battle-scene');
        if (!scene || this.canvas) return;
        this.root = scene;
        const c = document.createElement('canvas'); c.className = 'stage3d-canvas'; c.setAttribute('aria-hidden', 'true'); scene.insertBefore(c, scene.firstChild); this.canvas = c;
        const layer = document.createElement('div'); layer.className = 'stage3d-layer'; layer.setAttribute('aria-hidden', 'true'); scene.appendChild(layer); this.layer = layer;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'stage3d-toggle'; b.title = 'Arena 3D: ligar ou desligar'; scene.appendChild(b); this.btn = b;
        b.addEventListener('click', () => this.setEnabled(!this.enabled));
        const chip = document.createElement('div'); chip.className = 'stage3d-move'; chip.hidden = true; scene.appendChild(chip); this.chip = chip;
        this._renderButton();
        if (this.enabled) this._load();
    }
    _renderButton() { if (this.btn) { this.btn.textContent = this.enabled && !this.failed ? '🎬 3D' : '🎬 2D'; this.btn.setAttribute('aria-pressed', String(this.enabled && !this.failed)); } }
    setEnabled(on) {
        this.enabled = !!on && BATTLE_STAGE_ENABLED;
        try { localStorage.setItem(BATTLE_STAGE_KEY, this.enabled ? 'on' : 'off'); } catch (e) { /* vale nesta sessão */ }
        if (this.enabled && !this.ready && !this.failed) this._load();
        this._applyClass(); this._renderButton();
        if (this.enabled && this.ready && this.game.currentBattle) this.onStart(this.game.currentBattle);
    }
    _applyClass() { if (this.root) this.root.classList.toggle('stage-3d', this.enabled && this.ready && !this.failed); }
    isOn() { return this.enabled && this.ready && !this.failed; }

    async _load() {
        if (this.loading || this.ready || this.failed) return;
        this.loading = true;
        try {
            if (!window.THREE) window.THREE = await import(new URL(BATTLE_STAGE_THREE_URL, document.baseURI).href);
            this._init(window.THREE);
            this.ready = true;
        } catch (e) { this.failed = true; }
        this.loading = false; this._applyClass(); this._renderButton();
        if (this.ready) {
            if (this.game.currentBattle) this.onStart(this.game.currentBattle);
            this._last = performance.now(); this._raf = requestAnimationFrame((t) => this._frame(t));
        }
    }
    _init(T) {
        this.T = T;
        const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
        this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: !coarse, alpha: false, powerPreference: 'low-power' });
        if (!this.renderer.getContext()) throw new Error('webgl');
        this.renderer.outputColorSpace = T.SRGBColorSpace;
        this.maxRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.5); this.renderer.setPixelRatio(this.maxRatio);
        this.scene = new T.Scene(); this.camera = new T.PerspectiveCamera(36, 2, 0.1, 120);
        this.hemi = new T.HemisphereLight(0xdfefff, 0x3a3a2a, 1.3); this.scene.add(this.hemi);
        this.sun = new T.DirectionalLight(0xfff4e0, 2.2); this.sun.position.set(6, 12, 8); this.scene.add(this.sun);
        this.env = new T.Group(); this.scene.add(this.env);
        this.actors = new T.Group(); this.scene.add(this.actors);
        this.tex = new Map(); this.loader = new T.TextureLoader();
        this.fx = new MoveFxRenderer(T, this.scene, { speed: 1.45, max: 3, onShake: (f) => { this.shake = Math.max(this.shake, f); }, onFlash: (c, f) => { this.flash = Math.max(this.flash, f); this.flashColor = c; } });
        this.tweens = [];
        this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.failed = true; this._applyClass(); this._renderButton(); });
        this._resize();
        if (typeof ResizeObserver === 'function') { this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this.root); } else window.addEventListener('resize', () => this._resize());
    }
    _resize() {
        if (!this.renderer) return;
        const w = Math.max(1, this.root.clientWidth), h = Math.max(1, this.root.clientHeight);
        if (w === this.w && h === this.h) return;
        this.w = w; this.h = h; this.renderer.setSize(w, h, false);
        const asp = w / h; this.camera.aspect = asp; this.camera.fov = asp < 1.5 ? 44 : 36; this.camera.updateProjectionMatrix();
        this.camBase = new this.T.Vector3(0, 3.1, 9.2); this.camera.position.copy(this.camBase); this.camera.lookAt(0, 0.8, 0); this.camera.updateMatrixWorld();
        // os pés de cada Pokémon ficam onde a cena 2D os mostrava: o selvagem em cima à direita, o seu embaixo à esquerda
        const narrow = asp < 1.5;
        this.spot = { foe: this._ground(narrow ? 0.5 : 0.44, narrow ? -0.08 : -0.14), me: this._ground(narrow ? -0.5 : -0.4, narrow ? -0.6 : -0.62) };
        if (this.foe) this._place(this.foe, 'foe'); if (this.me) this._place(this.me, 'me');
        if (this.pads) { this.pads.foe.position.set(this.spot.foe.x, 0.05, this.spot.foe.z); this.pads.me.position.set(this.spot.me.x, 0.05, this.spot.me.z); }
    }
    // ponto do chão (y = 0) sob uma posição da tela em coordenadas normalizadas (-1..1)
    _ground(nx, ny) {
        const T = this.T, ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(nx, ny), this.camera);
        const hit = new T.Vector3(); return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), hit) ? hit : new T.Vector3(nx * 3, 0, 0);
    }
    _place(a, side) { const p = this.spot[side]; a.userData.base = p.clone(); a.position.copy(p); }

    // ---------------- cenário ----------------
    _lambert(color, o = {}) { return new this.T.MeshLambertMaterial({ color, ...o }); }
    _clearGroup(g) { for (let i = g.children.length - 1; i >= 0; i--) { const o = g.children[i]; g.remove(o); o.traverse(c => { c.geometry && c.geometry.dispose(); if (c.material && !c.isSprite) c.material.dispose(); }); } }
    _buildEnv(biomeId) {
        const T = this.T, b = BATTLE_STAGE_BIOMES[biomeId] || BATTLE_STAGE_BIOMES.meadow; this.biome = biomeId; this.bio = b;
        this._clearGroup(this.env);
        const add = (m) => { this.env.add(m); return m; };
        const ground = add(new T.Mesh(new T.CircleGeometry(60, 48), this._lambert(b.ground))); ground.rotation.x = -Math.PI / 2;
        // faixa distante (colinas / água / paredão) para dar profundidade
        const far = add(new T.Mesh(new T.CylinderGeometry(34, 34, b.water ? 0.06 : 5, 40, 1, true, Math.PI * 0.75, Math.PI * 1.5), this._lambert(b.far, { side: T.BackSide }))); far.position.y = b.water ? 0.03 : 2.2;
        if (b.water) { const lake = add(new T.Mesh(new T.CircleGeometry(30, 40, Math.PI * 0.1, Math.PI * 0.8), new T.MeshBasicMaterial({ color: b.far, transparent: true, opacity: 0.85 }))); lake.rotation.x = -Math.PI / 2; lake.position.set(0, 0.02, -8); this.lake = lake; } else this.lake = null;
        for (let i = 0; i < 7; i++) {            // colinas baixas no horizonte
            const hill = add(new T.Mesh(new T.SphereGeometry(1, 12, 8), this._lambert(new T.Color(b.far).offsetHSL(0, 0, (i % 3) * 0.03 - 0.03)))), a = -Math.PI * 0.95 + i * (Math.PI * 0.9 / 6);
            hill.position.set(Math.cos(a) * 26, -0.6, Math.sin(a) * 22 - 4); hill.scale.set(7 + (i % 3) * 3, 3 + (i % 4), 6);
        }
        // plataformas dos dois lados
        const pad = (r) => { const g = new T.Group(), col = new T.Color(b.ground), hs = {}; col.getHSL(hs); col.offsetHSL(0, -0.08, hs.l < 0.45 ? 0.1 : -0.1); const m = new T.Mesh(new T.CylinderGeometry(r, r * 1.06, 0.1, 40), this._lambert(col)); m.scale.z = 0.6; g.add(m); const ring = new T.Mesh(new T.RingGeometry(r * 0.94, r, 40), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.scale.y = 0.6; ring.position.y = 0.06; g.add(ring); this.env.add(g); return g; };
        this.pads = { foe: pad(1.35), me: pad(1.6) };
        if (this.spot) { this.pads.foe.position.set(this.spot.foe.x, 0.05, this.spot.foe.z); this.pads.me.position.set(this.spot.me.x, 0.05, this.spot.me.z); }
        // enfeites em arco atrás da luta (instanciados)
        const n = b.dense ? 46 : 26, M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3();
        const spots = Array.from({ length: n }, (_, i) => { const a = -Math.PI * 0.98 + (i / (n - 1)) * Math.PI * 0.96 + ((i * 7) % 5) * 0.012, r = 13 + ((i * 13) % 9) * 1.6; return { x: Math.cos(a) * r * 1.3, z: Math.sin(a) * r - 3, s: 0.7 + ((i * 5) % 7) * 0.1 }; });
        const inst = (geo, mat, f) => { const m = new T.InstancedMesh(geo, mat, n); spots.forEach((s, i) => { f(s, P, S); Q.setFromAxisAngle(new T.Vector3(0, 1, 0), i * 1.7); M.compose(P, Q, S); m.setMatrixAt(i, M); }); this.env.add(m); return m; };
        if (b.prop === 'tree' || b.prop === 'pine') {
            const leaf = new T.ConeGeometry(1, 2.4, 7); leaf.translate(0, 2.3, 0); const trunk = new T.CylinderGeometry(0.18, 0.24, 1.2, 6); trunk.translate(0, 0.6, 0);
            inst(leaf, this._lambert(b.prop === 'pine' ? '#3f7a5a' : new T.Color(b.far).offsetHSL(0, 0.05, 0.02), { flatShading: true }), (s, p, sc) => { p.set(s.x, 0, s.z); sc.set(s.s * (b.prop === 'pine' ? 0.8 : 1.15), s.s * 1.3, s.s * (b.prop === 'pine' ? 0.8 : 1.15)); });
            inst(trunk, this._lambert('#5a3a22'), (s, p, sc) => { p.set(s.x, 0, s.z); sc.set(s.s, s.s * 1.3, s.s); });
            if (b.prop === 'pine') { const cap = new T.ConeGeometry(0.7, 0.9, 7); cap.translate(0, 3.3, 0); inst(cap, this._lambert('#ffffff', { flatShading: true }), (s, p, sc) => { p.set(s.x, 0, s.z); sc.set(s.s * 0.8, s.s * 1.3, s.s * 0.8); }); }
        } else if (b.prop === 'rock') {
            inst(new T.IcosahedronGeometry(1, 0), this._lambert(new T.Color(b.far).offsetHSL(0, 0, 0.06), { flatShading: true }), (s, p, sc) => { p.set(s.x, s.s * 0.5, s.z); sc.set(s.s * 1.4, s.s * (1 + (s.x * 7 % 1 + 1) % 1), s.s * 1.2); });
            if (biomeId === 'cave') { const cr = new T.OctahedronGeometry(0.5, 0); const m = inst(cr, new T.MeshBasicMaterial({ color: '#7af7ff' }), (s, p, sc) => { p.set(s.x * 0.8 + 1, 0.5, s.z * 0.8); sc.set(0.5, 1.3 * s.s, 0.5); }); m.count = Math.min(n, 9); }
            if (biomeId === 'volcano') { const lava = add(new T.Mesh(new T.CircleGeometry(5, 24), new T.MeshBasicMaterial({ color: '#ff5a1a' }))); lava.rotation.x = -Math.PI / 2; lava.position.set(-9, 0.02, -9); lava.scale.set(1.6, 1, 1); this.lava = lava; }
        } else if (b.prop === 'dead') {
            const tr = new T.CylinderGeometry(0.08, 0.22, 3, 5); tr.translate(0, 1.5, 0);
            inst(tr, this._lambert('#2a2230', { flatShading: true }), (s, p, sc) => { p.set(s.x, 0, s.z); sc.set(s.s, s.s * 1.2, s.s); });
            const st = new T.BoxGeometry(0.6, 0.9, 0.18); st.translate(0, 0.45, 0); const m = inst(st, this._lambert('#6a6478'), (s, p, sc) => { p.set(s.x * 0.7 - 1, 0, s.z * 0.7 - 1); sc.set(1, 1, 1); }); m.count = Math.min(n, 10);
        } else if (b.prop === 'reed') {
            const reed = new T.ConeGeometry(0.07, 1.6, 4); reed.translate(0, 0.8, 0);
            inst(reed, this._lambert('#3f9a4a'), (s, p, sc) => { p.set(s.x * 0.75, 0, s.z * 0.6 - 2); sc.set(1, s.s, 1); });
        }
        if (biomeId !== 'volcano') this.lava = null;
        // tufos de grama perto (não em caverna/vulcão/neve)
        if (biomeId === 'meadow' || biomeId === 'forest' || biomeId === 'lake') {
            const g = new T.ConeGeometry(0.07, 0.5, 3); g.translate(0, 0.25, 0); const tufts = new T.InstancedMesh(g, this._lambert(new T.Color(b.ground).offsetHSL(0, 0, -0.1)), 150);
            for (let i = 0; i < 150; i++) { const a = (i * 2.399) % (Math.PI * 2), r = 3.5 + (i % 19) * 0.75; M.makeTranslation(Math.cos(a) * r * 1.3, 0, Math.sin(a) * r * 0.7 - 2.5); tufts.setMatrixAt(i, M); }
            this.env.add(tufts);
        }
        // partículas no ar
        const cnt = 46, arr = new Float32Array(cnt * 3); this.moteSeed = [];
        for (let i = 0; i < cnt; i++) { const s = { x: (Math.random() - 0.5) * 22, y: Math.random() * 5, z: -8 + Math.random() * 12, p: Math.random() * 6 }; this.moteSeed.push(s); arr.set([s.x, s.y, s.z], i * 3); }
        const mg = new T.BufferGeometry(); mg.setAttribute('position', new T.BufferAttribute(arr, 3));
        this.motes = new T.Points(mg, new T.PointsMaterial({ color: b.mote, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false })); this.env.add(this.motes);
        this._applyPhase(true);
    }
    // fase do dia (relógio do aparelho): céu, névoa e força das luzes
    _applyPhase(force) {
        const now = Date.now(); if (!force && now - (this._phaseAt || 0) < 60000) return; this._phaseAt = now;
        const T = this.T, d = new Date(), h = this.hourOverride != null ? this.hourOverride : d.getHours() + d.getMinutes() / 60, ph = typeof exploreDayPhase === 'function' ? exploreDayPhase(h) : { hemi: 1.25, sun: 2.4, sunColor: '#fff4e0', sky: null, id: 'day' };
        const sky = new T.Color((this.bio || BATTLE_STAGE_BIOMES.meadow).sky); if (ph.sky) sky.lerp(new T.Color(ph.sky), 0.6);
        this.sky = sky; this.scene.background = sky.clone(); this.scene.fog = new T.Fog(sky.clone(), 22, 52);
        this.hemiBase = Math.max(0.95, 1.3 * (ph.hemi / 1.25)); this.hemi.intensity = this.hemiBase; this.sun.intensity = Math.max(1.1, ph.sun * 0.92);       // à noite continua dando para ver a luta this.sun.color.set(ph.sunColor); this.phase = ph.id;
    }

    // ---------------- atores ----------------
    _texture(url) {
        let t = this.tex.get(url);
        if (!t) { const T = this.T; t = this.loader.load(url); t.magFilter = T.NearestFilter; t.minFilter = T.NearestFilter; t.generateMipmaps = false; t.colorSpace = T.SRGBColorSpace; this.tex.set(url, t); }
        return t;
    }
    _actor(id, shiny, size) {
        const T = this.T, g = new T.Group();
        const spr = new T.Sprite(new T.SpriteMaterial({ map: this._texture(shiny ? getShinyPokemonSpriteUrl(id) : getPokemonSpriteUrl(id)), transparent: true, alphaTest: 0.15 })); spr.scale.set(size, size, 1); spr.center.set(0.5, 0.16);
        const sh = new T.Mesh(new T.CircleGeometry(size * 0.26, 16), new T.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.12; sh.scale.y = 0.6;
        g.add(sh, spr); g.userData = { spr, sh, id, shiny, size, base: new T.Vector3(), busy: 0 };
        this.actors.add(g); return g;
    }
    _drop(a) { if (!a) return; this.actors.remove(a); a.userData.spr.material.dispose(); a.userData.sh.geometry.dispose(); a.userData.sh.material.dispose(); }
    _tw(dur, step, end, delay = 0) { this.tweens.push({ t: 0, dur, delay, step, end }); }
    _head(a, h = 1.0) { return a.userData.base.clone().add(new this.T.Vector3(0, h * a.userData.size * 0.42, 0)); }

    // ---------------- eventos da batalha (chamados por ui.js) ----------------
    onStart(battle) {
        if (!this.isOn()) { this.pending = battle; return; }
        if (this.game._isOfflineSimulating || !battle || !battle.wild) return;
        const wild = battle.wild, inst = this.game.getPartyInstance(this.game.gameState.activePokemonIndex); if (!inst) return;
        const route = this.game._towerMode ? null : this.game.getRoute(this.game.gameState.currentRoute), biome = this.game._towerMode ? 'cave' : battleStageBiome(route);
        if (biome !== this.biome) this._buildEnv(biome);
        this._applyPhase(false);
        // o seu Pokémon: só troca quando muda a espécie/shiny
        if (!this.me || this.me.userData.id !== inst.speciesId || this.me.userData.shiny !== !!inst.shiny) {
            this._drop(this.me); this.me = this._actor(inst.speciesId, !!inst.shiny, 2.7); this._place(this.me, 'me');
            this.fx._burst(this._head(this.me), '#ffffff', 18, 2.6);
        } else { this.me.visible = true; this.me.userData.spr.material.opacity = 1; this.me.position.copy(this.me.userData.base); this.me.userData.fainted = false; }
        // o selvagem novo entra pela direita
        if (this.foe) { const old = this.foe; if (old.userData.dying) setTimeout(() => this._drop(old), 500); else this._drop(old); }
        this.foe = this._actor(wild.id, !!wild.isShiny, 2.9); this._place(this.foe, 'foe');
        const f = this.foe, bx = f.userData.base.x; f.position.x = bx + 5; f.userData.busy++;
        this._tw(0.42, (k) => { const e = 1 - (1 - k) * (1 - k); f.position.x = bx + 5 * (1 - e); f.position.y = Math.sin(k * Math.PI) * 0.5; }, () => { f.position.copy(f.userData.base); f.userData.busy--; });
        this.wildTypes = (POKEMON_DATA[wild.id] && POKEMON_DATA[wild.id].types) || ['normal']; this.wildLevel = wild.level;
        this.myTypes = (POKEMON_DATA[inst.speciesId] && POKEMON_DATA[inst.speciesId].types) || ['normal'];
        if (wild.isShiny) for (let i = 0; i < 3; i++) setTimeout(() => this.foe === f && this.fx._burst(this._head(f), '#fff7a0', 14, 2), 200 + i * 220);
        this.pending = null;
    }
    _attack(from, to, move, onHit) {
        if (!from || !to || from.userData.fainted) return onHit && onHit();
        const T = this.T, prof = moveFxProfile(move.name, move.type, move.power), base = from.userData.base, dir = to.userData.base.clone().sub(base).normalize();
        this.stats.attacks++; this.lastMove = { name: prof.name, shape: prof.shape, type: prof.type, side: from === this.me ? 'me' : 'foe' };
        const reach = prof.melee ? base.distanceTo(to.userData.base) - 1.2 : 0.7, dur = (prof.melee ? 0.34 : 0.26);
        from.userData.busy++;
        this._tw(dur, (k) => { const s = Math.sin(k * Math.PI); from.position.copy(base).addScaledVector(dir, s * reach); from.position.y = s * (prof.melee ? 0.5 : 0.25); }, () => { from.position.copy(base); from.userData.busy--; });
        this.fx.play(prof, base, to.userData.base, { onHit, height: from.userData.size * 0.42, targetHeight: to.userData.size * 0.38 });
        if (from === this.me) this._chip(prof);
    }
    _chip(prof) {
        if (!this.chip) return;
        this.chip.textContent = prof.name; this.chip.style.setProperty('--tc', prof.colors[0]); this.chip.hidden = false;
        this.chip.classList.remove('go'); void this.chip.offsetWidth; this.chip.classList.add('go');
    }
    _hurt(a, data) {
        if (!a) return;
        this.stats.hits++;
        const base = a.userData.base, spr = a.userData.spr; a.userData.busy++;
        this._tw(0.34, (k) => { a.position.x = base.x + Math.sin(k * 34) * 0.14 * (1 - k); spr.material.color.setRGB(1, 0.45 + 0.55 * k, 0.45 + 0.55 * k); spr.material.opacity = a.userData.fainted ? spr.material.opacity : ((Math.floor(k * 6) % 2) ? 0.45 : 1); },
            () => { a.position.x = base.x; spr.material.color.setRGB(1, 1, 1); if (!a.userData.fainted && !a.userData.dying) spr.material.opacity = 1; a.userData.busy--; });
        if (data) this._number(a, battleStageDamageLabel(data.damage, data.critical, data.typeEffectiveness));
    }
    // número de dano flutuando sobre o Pokémon (HTML por cima do canvas)
    _number(a, label) {
        if (!this.layer) return;
        while (this.layer.children.length >= 7) this.layer.firstChild.remove();
        const p = this._head(a, 1.5).project(this.camera), el = document.createElement('span');
        el.className = `stage3d-dmg ${label.cls}`; el.textContent = label.text;
        el.style.left = `${(p.x * 0.5 + 0.5) * 100 + (Math.random() - 0.5) * 6}%`; el.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
        this.layer.appendChild(el); setTimeout(() => el.remove(), 950);
    }
    onPlayerAttack(data) {
        if (!this.isOn() || !this.me || !this.foe) return;
        const type = data.skillType || this.myTypes[0], name = data.skillName || 'Investida';
        const foe = this.foe; this._attack(this.me, foe, { name, type, power: data.skillName ? moveFxPowerOf(name, type) : 50 }, () => { if (this.foe === foe) this._hurt(foe, data); });
    }
    onEnemyAttack(data) {
        if (!this.isOn() || !this.me || !this.foe || this.foe.userData.dying) return;
        const me = this.me; this._attack(this.foe, me, moveFxWildMove(this.wildTypes, this.wildLevel), () => { if (this.me === me) this._hurt(me, data); });
    }
    onDodge() {
        if (!this.isOn() || !this.me) return;
        const a = this.me, base = a.userData.base; a.userData.busy++;
        this._tw(0.3, (k) => { a.position.x = base.x - Math.sin(k * Math.PI) * 0.9; }, () => { a.position.copy(base); a.userData.busy--; });
        this._number(a, { text: 'Esquivou!', cls: 'dodge' });
    }
    onDefeated(data) {
        if (!this.isOn() || !this.foe) return;
        const f = this.foe, spr = f.userData.spr, me = this.me; f.userData.dying = true; this.stats.faints++;
        this._tw(0.45, (k) => { f.position.y = -k * 0.9; spr.material.opacity = 1 - k; f.userData.sh.material.opacity = 0.3 * (1 - k); }, () => { f.visible = false; }, 0.12);
        // a EXP voa do selvagem para o seu Pokémon
        if (me && data && data.exp > 0) {
            const T = this.T, a = this._head(f), b = this._head(me);
            this.fx._parts(12, (i) => { const v = b.clone().sub(a).divideScalar(0.5); v.y += 2.2 + Math.random() * 1.5; v.x += (Math.random() - 0.5) * 2; return { p: a.clone(), v, t0: i * 0.03 }; }, { color: '#6ab8ff', life: 0.5, size: 0.17, g: 9, delay: 0.15 });
            setTimeout(() => this.me === me && this.fx._flash(this._head(me), '#6ab8ff', 0.2, 1.1, 0.3, 0, 0.6), 520);
        }
    }
    onCapture(ok, shiny) {
        if (!this.isOn() || !this.foe) return;
        const T = this.T, at = this.foe.userData.base.clone(); this.stats.captures += ok ? 1 : 0;
        const ball = new T.Group(), r = 0.3;
        ball.add(new T.Mesh(new T.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this._lambert(ok ? '#e2473f' : '#9aa0b4')));
        ball.add(new T.Mesh(new T.SphereGeometry(r, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this._lambert('#f4f6ff')));
        const band = new T.Mesh(new T.TorusGeometry(r, 0.03, 6, 20), this._lambert('#15151f')); band.rotation.x = Math.PI / 2; ball.add(band);
        this.actors.add(ball);
        const drop = () => { this.actors.remove(ball); ball.traverse(c => { c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); }); };
        this._tw(0.55, (k) => { ball.position.set(at.x, 0.3 + Math.abs(Math.sin(k * Math.PI * 2)) * 1.1 * (1 - k), at.z); ball.rotation.z = Math.sin(k * 12) * 0.4 * (1 - k); }, () => {
            if (ok) { for (let i = 0; i < 3; i++) setTimeout(() => this.fx._burst(at.clone().setY(0.6), shiny ? '#fff7a0' : '#ffe27a', 12, 2.4), i * 120); setTimeout(drop, 450); }
            else { this.fx._burst(at.clone().setY(0.5), '#ffffff', 22, 3.4); drop(); }
        }, 0.5);
    }
    onFainted() {
        if (!this.isOn() || !this.me) return;
        const a = this.me, spr = a.userData.spr; a.userData.fainted = true;
        this._tw(0.5, (k) => { a.position.y = -k * 0.9; spr.material.opacity = 1 - k * 0.85; });
    }
    onHealing(data) {
        if (!this.isOn() || !this.me) return;
        const a = this.me;
        if (a.userData.fainted) { a.userData.fainted = false; a.position.copy(a.userData.base); a.userData.spr.material.opacity = 1; }
        const now = performance.now(); if (now - (this._healAt || 0) < 700) return; this._healAt = now;
        this.fx._parts(10, () => ({ p: a.userData.base.clone().add(new this.T.Vector3((Math.random() - 0.5) * 1.4, 0.2, (Math.random() - 0.5) * 0.6)), v: new this.T.Vector3(0, 1.6 + Math.random(), 0), t0: Math.random() * 0.3 }), { color: '#7dff9a', life: 0.6, size: 0.15 });
    }
    onEvolved() { if (this.isOn() && this.me) { this.fx._flash(this._head(this.me), '#ffffff', 0.3, 2.4, 0.6, 0, 0.9); this.flash = 0.6; this.flashColor = '#ffffff'; } }

    // ---------------- quadro ----------------
    _visible() {
        if (!this.isOn() || document.hidden || document.body.classList.contains('exploring')) return false;
        const tab = document.getElementById('tab-battle'); return !!tab && tab.classList.contains('active');
    }
    _frame(now) {
        this._raf = requestAnimationFrame((t) => this._frame(t));
        const gap = now - this._last, cap = this.lite ? 62 : 31;                  // ~30 quadros/s (15 no modo leve)
        if (gap < cap) return;
        this._last = now;
        if (!this._visible()) return;
        if (this.pending) this.onStart(this.pending);
        const dt = Math.min(0.1, gap / 1000); this.t += dt;
        const t0 = performance.now();
        for (let i = this.tweens.length - 1; i >= 0; i--) {
            const f = this.tweens[i]; if (f.delay > 0) { f.delay -= dt; continue; }
            f.t += dt; const k = Math.min(1, f.t / f.dur); f.step && f.step(k);
            if (f.t >= f.dur) { this.tweens.splice(i, 1); f.end && f.end(); }
        }
        this.fx.update(dt);
        for (const a of [this.me, this.foe]) if (a && a.visible && !a.userData.busy && !a.userData.fainted && !a.userData.dying) { a.userData.spr.position.y = Math.abs(Math.sin(this.t * 2.6 + (a === this.me ? 1.3 : 0))) * 0.06; }
        if (this.motes) {
            const arr = this.motes.geometry.attributes.position.array, rise = this.bio.moteRise;
            for (let i = 0; i < this.moteSeed.length; i++) { const s = this.moteSeed[i]; s.y += rise * dt; if (s.y > 5.5) s.y = 0; if (s.y < 0) s.y = 5.5; arr[i * 3] = s.x + Math.sin(this.t * 0.6 + s.p) * 0.5; arr[i * 3 + 1] = s.y; arr[i * 3 + 2] = s.z; }
            this.motes.geometry.attributes.position.needsUpdate = true;
        }
        if (this.lava) this.lava.material.color.setHSL(0.05, 1, 0.5 + Math.sin(this.t * 2) * 0.06);
        if (this.lake) this.lake.material.opacity = 0.8 + Math.sin(this.t * 1.5) * 0.06;
        // câmera: balanço leve, tremor nos golpes fortes
        const c = this.camera, b = this.camBase; c.position.set(b.x + Math.sin(this.t * 0.35) * 0.35, b.y + Math.sin(this.t * 0.5) * 0.08, b.z);
        if (this.shake > 0) { c.position.x += (Math.random() - 0.5) * this.shake; c.position.y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 0.9); }
        c.lookAt(0, 0.8, 0);
        if (this.flash > 0) { this.hemi.intensity = this.hemiBase + this.flash * 3; this.scene.background.copy(this.sky).lerp(new this.T.Color(this.flashColor || '#ffffff'), Math.min(0.6, this.flash * 0.7)); this.flash = Math.max(0, this.flash - dt * 3.2); if (this.flash === 0) { this.hemi.intensity = this.hemiBase; this.scene.background.copy(this.sky); } }
        this.renderer.render(this.scene, c); this.frames++;
        // aparelho lento: baixa a resolução e depois o ritmo (uma vez)
        const cost = performance.now() - t0;
        if (cost > 24) { if (++this.slow === 20 && !this.lite) { this.lite = true; this.renderer.setPixelRatio(Math.max(0.6, this.maxRatio * 0.6)); this.w = 0; this._resize(); } } else if (this.slow > 0) this.slow--;
    }
}
