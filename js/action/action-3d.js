// ============================================================
// F12 · Mundo de Ação 3D · camada de desenho (Three.js). Contrato: docs/action/CONTRATO.md.
// Desenha sobre o mundo do Explore3D (mapa, luzes, céu) o que a simulação (ActionWorld) diz: herói, hordas, elites, chefe,
// golpes (MoveFxRenderer com a área real), dano, mortes, orbes de EXP, bola de captura, câmera. NÃO decide nada de jogo.
//   - hordas: um InstancedMesh por espécie (buildPokemonGeometry), capacidade fixa = limite do mundo, count = vivos;
//   - herói, elites e chefe: modelo articulado (buildPokemonModel + animatePokemonModel); espécie sem modelo: sprite em pool;
//   - uma única InstancedMesh de sombras (discos) para todas as entidades; partículas em dois Points de tamanho fixo (sem alocar);
//   - nada de `new` por quadro nos laços de entidades; dispose() descarta tudo o que esta classe criou (nada do Explore3D).
// Uso: a3d = new Action3D(e3d); a3d.attach(world); a cada quadro a3d.frame(world, eventos, dt, alpha).
//   Opcional para interpolação exata: a3d.prestep(world) antes de cada world.step (sem isso, a posição anterior é a do quadro anterior).
//   Callbacks (propriedades): onDamage(entidade, { dmg, crit, eff }), onWave(evento), onEvent(evento).
// ============================================================
const ACTION_3D_SCALE = { hero: 1, minion: 1, elite: 1.5, boss: 2.4 };
const ACTION_3D_RING = { elite: '#ffb02e', boss: '#ff3b3b' };
const ACTION_3D_SHINY = [1.25, 1.12, 0.62];          // tinta por instância dos brilhantes (multiplica a cor do vértice)
const ACTION_3D_GHOST = 0.32;                         // segundos que o corpo fica encolhendo depois do evento 'die'

class Action3D {
    constructor(e3d) {
        const T = e3d.T;
        this.e3d = e3d; this.T = T; this.q = e3d.q || {};
        this.root = new T.Group(); this.root.name = 'action3d'; e3d.world.add(this.root);
        this.onDamage = null; this.onWave = null; this.onEvent = null;
        this.world = null; this.t = 0; this.shakeT = 0; this.shakeF = 0; this.crowd = 0; this.hx = 0; this.hz = 0;
        this._recs = []; this._byId = new Map(); this._freeRecs = []; this._pools = new Map(); this._poolList = []; this._sprFree = new Map();
        this._lastT = NaN; this._pre = false; this._camInit = false; this._cap = 0; this._stamp = 0;
        // temporários reaproveitados
        this._m = new T.Matrix4(); this._qt = new T.Quaternion(); this._eu = new T.Euler(0, 0, 0, 'YXZ'); this._p = new T.Vector3(); this._s = new T.Vector3();
        this._c = new T.Color(); this._v = new T.Vector3(); this._from = new T.Vector3(); this._to = new T.Vector3(); this._q1 = new T.Quaternion();
        this._camPos = new T.Vector3(); this._camLook = new T.Vector3();
        this._pose = { y: 0, sx: 1, sy: 1, sz: 1, tilt: 0, roll: 0 };
        this._dmg = { dmg: 0, crit: false, eff: 1 }; this._proxy = { id: -1, kind: 'enemy', x: 0, z: 0 }; this._scr = { x: 0, y: 0, visible: false };
        this._near = [];
        this._rgb = new Map();
        // golpes: o do jogador/chefe (com tremor) e o dos inimigos comuns; fit: false = área desenhada é a área real
        this.fx = new MoveFxRenderer(T, this.root, { speed: 1, max: 10, fit: false, onShake: (f) => this.shake(f) });
        this.fxFoe = new MoveFxRenderer(T, this.root, { speed: 1, max: 8, fit: false });
        // geometrias e materiais compartilhados
        this._gRing = new T.RingGeometry(0.82, 1, 32); this._gRing.rotateX(-Math.PI / 2);
        this._gDisc = new T.CircleGeometry(1, 12); this._gDisc.rotateX(-Math.PI / 2);
        this._gBar = new T.PlaneGeometry(1, 0.11); this._gBarFill = new T.PlaneGeometry(1, 0.08); this._gBarFill.translate(0.5, 0, 0);
        this._ringMat = {};
        for (const k in ACTION_3D_RING) this._ringMat[k] = new T.MeshBasicMaterial({ color: ACTION_3D_RING[k], transparent: true, opacity: 0.75, depthWrite: false, side: T.DoubleSide });
        this._barBgMat = new T.MeshBasicMaterial({ color: '#1a1a22', transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
        // marcadores de mira
        this.aimRing = new T.Mesh(this._gRing, new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false, side: T.DoubleSide }));
        this.capRing = new T.Mesh(this._gRing, new T.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide }));
        this.heroRing = new T.Mesh(this._gRing, new T.MeshBasicMaterial({ color: '#5fd0ff', transparent: true, opacity: 0.55, depthWrite: false, side: T.DoubleSide }));
        this.aimRing.visible = this.capRing.visible = this.heroRing.visible = false; this.aimRing.renderOrder = this.capRing.renderOrder = this.heroRing.renderOrder = 2;
        this.root.add(this.aimRing, this.capRing, this.heroRing);
        // coluna de luz (nível), clarão (evolução)
        const gCol = new T.CylinderGeometry(0.75, 0.75, 7, 20, 1, true); gCol.translate(0, 3.5, 0);
        this.column = new T.Mesh(gCol, new T.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
        this.flash = new T.Mesh(new T.SphereGeometry(1, 16, 12), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
        this.column.visible = this.flash.visible = false; this.colT = 0; this.flashT = 0; this.dashT = 0;
        this.root.add(this.column, this.flash);
        // bola de captura
        this.ball = this._ballMesh(); this.ball.visible = false; this.root.add(this.ball);
        this.cap = { phase: '', t: 0, id: -1, tx: 0, tz: 0, sx: 0, sy: 0, sz: 0, wob: 0, hide: 0, landed: false };
        // partículas (fixas): faíscas pequenas e nuvens/orbes grandes
        this.pSmall = this._particles(520, 0.16); this.pBig = this._particles(240, 0.34);
        this.shadows = null;
    }

    // ---------------- montagem ----------------
    attach(world) {
        const T = this.T;
        if (this.world && this.world !== world) this._releaseAll();
        this.world = world; this._lastT = NaN; this._camInit = false;
        const cap = Math.max(8, (world && world.limit) || 40) + 4;
        if (cap !== this._cap) {
            this._cap = cap;
            for (const p of this._poolList) this._disposePool(p);
            this._pools.clear(); this._poolList.length = 0;
            if (this.shadows) { this.root.remove(this.shadows); this.shadows.dispose(); this.shadows.material.dispose(); }
            const sh = new T.InstancedMesh(this._gDisc, new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }), cap + 8);
            sh.instanceMatrix.setUsage(T.DynamicDrawUsage); sh.count = 0; sh.frustumCulled = false; sh.renderOrder = 1; this.root.add(sh); this.shadows = sh;
        }
    }
    // Chamar antes de cada world.step (opcional): guarda a posição anterior exata de cada entidade para a interpolação.
    prestep(world) {
        const w = world || this.world; if (!w) return;
        this._pre = true;
        if (w.player) this._mark(w.player);
        const en = w.enemies; for (let i = 0; i < en.length; i++) this._mark(en[i]);
    }
    _mark(e) { const r = this._byId.get(e.id); if (r && r.e === e) { r.px = e.x; r.pz = e.z; } }

    _rec(e) {
        let r = this._byId.get(e.id);
        if (r && r.e === e) return r;
        if (r) this._dropRec(r);
        r = this._freeRecs.pop() || { id: 0, e: null, kind: '', species: 0, shiny: false, tier: '', pool: null, model: null, sprite: null, sprKey: '', ring: null, bar: null, barFill: null,
            px: 0, pz: 0, cx: 0, cz: 0, rx: 0, rz: 0, face: 0, flash: 0, kick: 0, kx: 0, kz: 0, phase: 0, seen: 0, dieT: -1, scale: 1, height: 1, radius: 0.4, state: 'idle', hp01: 1, idx: 0 };
        r.id = e.id; r.e = e; r.kind = ''; r.species = -1; r.px = r.cx = r.rx = e.x; r.pz = r.cz = r.rz = e.z; r.face = e.face || 0; r.flash = 0; r.kick = 0; r.dieT = -1;
        r.phase = ((e.id * 0.6180339) % 1) * Math.PI * 2; r.state = e.state;
        r.idx = this._recs.length; this._recs.push(r); this._byId.set(e.id, r);
        return r;
    }
    _dropRec(r) {
        this._releaseVisual(r);
        const i = r.idx, last = this._recs.pop();
        if (last !== r) { this._recs[i] = last; last.idx = i; }
        if (this._byId.get(r.id) === r) this._byId.delete(r.id);
        r.e = null; this._freeRecs.push(r);
    }
    _releaseAll() { while (this._recs.length) this._dropRec(this._recs[this._recs.length - 1]); }

    // espécie → visual (herói/elite/chefe: modelo; horda: instância; sem modelo: sprite)
    _buildVisual(r, e) {
        const T = this.T, tier = e.kind === 'player' ? 'hero' : (e.tier || 'minion'), scale = ACTION_3D_SCALE[tier] || 1;
        const has = typeof pokemonModelHas === 'function' && pokemonModelHas(e.speciesId);
        this._releaseVisual(r);
        r.species = e.speciesId; r.shiny = !!e.shiny; r.tier = tier; r.scale = scale; r.radius = e.radius || 0.4;
        if (has && tier !== 'minion' && typeof buildPokemonModel === 'function') {
            const m = buildPokemonModel(T, e.speciesId, { shiny: r.shiny });
            if (m) { m.scale.setScalar(scale); this.root.add(m); r.model = m; r.kind = 'model'; r.height = ((m.userData && m.userData.height) || 1) * scale; }
        }
        if (r.kind) { /* modelo pronto */ } else if (has && typeof buildPokemonGeometry === 'function' && this._pool(e.speciesId)) {
            r.pool = this._pool(e.speciesId); r.kind = 'inst'; r.height = r.pool.height * scale;
        } else {
            const key = e.speciesId + (r.shiny ? 's' : ''), list = this._sprFree.get(key);
            const s = (list && list.pop()) || this.e3d.pokemonSprite(e.speciesId, r.shiny, 1);
            const size = 1.7 * scale * Math.max(0.85, Math.min(1.5, r.radius / 0.42));          // o PNG tem margem transparente: o bicho ocupa ~60%
            s.scale.set(size, size, 1); s.visible = true; s.material.color.setRGB(1, 1, 1); if (s.parent !== this.root) this.root.add(s);
            r.sprite = s; r.sprKey = key; r.kind = 'sprite'; r.height = size * 0.7;
        }
        if (tier === 'elite' || tier === 'boss') {
            r.ring = new T.Mesh(this._gRing, this._ringMat[tier]); r.ring.renderOrder = 2; this.root.add(r.ring);
            if (tier === 'elite') {
                const bar = new T.Group(), bg = new T.Mesh(this._gBar, this._barBgMat), fill = new T.Mesh(this._gBarFill, new T.MeshBasicMaterial({ color: '#5fe36a', depthTest: false, depthWrite: false }));
                bg.scale.x = 1.12; fill.position.set(-0.5, 0, 0.001); bg.renderOrder = 8; fill.renderOrder = 9; bar.add(bg, fill); this.root.add(bar);
                r.bar = bar; r.barFill = fill;
            }
        }
    }
    _releaseVisual(r) {
        if (r.model) { this.root.remove(r.model); this._disposeTree(r.model); r.model = null; }
        if (r.sprite) { r.sprite.visible = false; let l = this._sprFree.get(r.sprKey); if (!l) this._sprFree.set(r.sprKey, l = []); l.push(r.sprite); r.sprite = null; }
        if (r.ring) { this.root.remove(r.ring); r.ring = null; }
        if (r.bar) { this.root.remove(r.bar); r.barFill.material.dispose(); r.bar = null; r.barFill = null; }
        r.pool = null; r.kind = '';
    }
    _pool(id) {
        let p = this._pools.get(id); if (p) return p;
        const T = this.T, geo = buildPokemonGeometry(T, id, {}); if (!geo) return null;
        // geometria fundida e material do módulo de modelos são compartilhados (cache dele): esta classe só descarta a InstancedMesh
        const mat = typeof pokemonModelMaterial === 'function' ? pokemonModelMaterial(T) : new T.MeshLambertMaterial({ vertexColors: true }), cap = this._cap;
        const mesh = new T.InstancedMesh(geo, mat, cap);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); mesh.instanceColor.setUsage(T.DynamicDrawUsage);
        mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; this.root.add(mesh);
        const info = typeof pokemonModelInfo === 'function' ? pokemonModelInfo(id) : null;
        p = { id, mesh, n: 0, rig: (info && info.rig) || (geo.userData && geo.userData.rig) || 'biped', height: (info && info.height) || (geo.userData && geo.userData.height) || 1 };
        this._pools.set(id, p); this._poolList.push(p);
        return p;
    }
    _disposePool(p) { this.root.remove(p.mesh); if (!this._extShared(p.mesh.geometry)) p.mesh.geometry.dispose(); if (!this._extShared(p.mesh.material)) p.mesh.material.dispose(); p.mesh.dispose(); }
    _extShared(o) { return !!(o && o.userData && o.userData.pokemonModelShared); }
    _disposeTree(o) {
        o.traverse((c) => {
            if (c.geometry && !this._isShared(c.geometry) && !this._extShared(c.geometry)) c.geometry.dispose();
            if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { if (!this._isSharedMat(m) && !this._extShared(m)) m.dispose(); });
            if (c.isInstancedMesh) c.dispose();
        });
    }
    _isShared(g) { return g === this._gRing || g === this._gDisc || g === this._gBar || g === this._gBarFill; }
    _isSharedMat(m) { return m === this._barBgMat || m === this._ringMat.elite || m === this._ringMat.boss; }

    // ---------------- partículas (tamanho fixo; sem alocar) ----------------
    _dot() {
        if (this.dot) return this.dot;
        const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
        this.dot = new this.T.CanvasTexture(c); return this.dot;
    }
    _particles(n, size) {
        const T = this.T, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999;
        const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage)); geo.setAttribute('color', new T.BufferAttribute(col, 3).setUsage(T.DynamicDrawUsage));
        const pts = new T.Points(geo, new T.PointsMaterial({ size, map: this._dot(), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true }));
        pts.frustumCulled = false; pts.renderOrder = 7; this.root.add(pts);
        return { n, pts, pos, col, vel: new Float32Array(n * 3), base: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), grav: new Float32Array(n), home: new Float32Array(n), next: 0, alive: 0, dirty: false };
    }
    _emit(P, x, y, z, vx, vy, vz, life, rgb, grav, home) {
        const i = P.next; P.next = (P.next + 1) % P.n;
        if (P.life[i] <= 0) P.alive++;
        P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z; P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
        P.base[i * 3] = rgb[0]; P.base[i * 3 + 1] = rgb[1]; P.base[i * 3 + 2] = rgb[2]; P.life[i] = P.max[i] = life; P.grav[i] = grav; P.home[i] = home || 0;
    }
    _updParticles(P, dt) {
        if (!P.alive && !P.dirty) return;
        const pos = P.pos, vel = P.vel, col = P.col, hx = this.hx, hz = this.hz;
        let alive = 0;
        for (let i = 0; i < P.n; i++) {
            if (P.life[i] <= 0) continue;
            P.life[i] -= dt;
            if (P.life[i] <= 0) { pos[i * 3 + 1] = -999; continue; }
            alive++;
            const j = i * 3;
            if (P.home[i] > 0 && P.max[i] - P.life[i] > P.home[i]) {          // orbe de EXP: voa até o herói
                const dx = hx - pos[j], dy = 0.9 - pos[j + 1], dz = hz - pos[j + 2], d = Math.hypot(dx, dy, dz) || 1;
                if (d < 0.45) { P.life[i] = 0; pos[j + 1] = -999; alive--; continue; }
                const sp = 9 + (P.max[i] - P.life[i]) * 10;
                vel[j] += (dx / d * sp - vel[j]) * Math.min(1, dt * 8); vel[j + 1] += (dy / d * sp - vel[j + 1]) * Math.min(1, dt * 8); vel[j + 2] += (dz / d * sp - vel[j + 2]) * Math.min(1, dt * 8);
                if (P.life[i] < 0.2) P.life[i] = 0.2;                           // não some no caminho
            } else vel[j + 1] -= P.grav[i] * dt;
            pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
            if (pos[j + 1] < 0.04) { pos[j + 1] = 0.04; vel[j + 1] *= -0.3; vel[j] *= 0.7; vel[j + 2] *= 0.7; }
            const k = P.home[i] > 0 ? 1 : Math.min(1, P.life[i] / P.max[i] * 1.6);
            col[j] = P.base[j] * k; col[j + 1] = P.base[j + 1] * k; col[j + 2] = P.base[j + 2] * k;
        }
        P.alive = alive; P.dirty = alive > 0;
        P.pts.geometry.attributes.position.needsUpdate = true; P.pts.geometry.attributes.color.needsUpdate = true;
    }
    _col(hex) { let c = this._rgb.get(hex); if (!c) { this._c.set(hex); c = [this._c.r, this._c.g, this._c.b]; this._rgb.set(hex, c); } return c; }
    _burst(P, x, y, z, hex, n, power, life, grav) {
        const rgb = this._col(hex);
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, up = 0.2 + Math.random() * 0.9, sp = power * (0.35 + Math.random() * 0.7);
            this._emit(P, x, y, z, Math.cos(a) * sp, up * sp, Math.sin(a) * sp, life * (0.7 + Math.random() * 0.5), rgb, grav, 0);
        }
    }

    // ---------------- bola ----------------
    _ballMesh() {
        const T = this.T, g = new T.Group(), r = 0.2;
        const top = new T.Mesh(new T.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshLambertMaterial({ color: '#ff3b3b' }));
        const bot = new T.Mesh(new T.SphereGeometry(r, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new T.MeshLambertMaterial({ color: '#f4f6ff' }));
        const band = new T.Mesh(new T.TorusGeometry(r, 0.02, 6, 24), new T.MeshLambertMaterial({ color: '#15151f' })); band.rotation.x = Math.PI / 2;
        const btn = new T.Mesh(new T.SphereGeometry(0.05, 10, 6), new T.MeshLambertMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3 })); btn.position.z = r;
        g.add(top, bot, band, btn); g.userData = { top, bot, btn };
        return g;
    }
    _ballColors(id) {
        const tab = typeof EXPLORE_BALL_COLORS !== 'undefined' ? EXPLORE_BALL_COLORS : null, c = (tab && (tab[id] || tab.pokeball)) || ['#ff3b3b', '#f4f6ff'], u = this.ball.userData;
        u.top.material.color.set(c[0]); u.bot.material.color.set(c[1]); u.btn.material.emissive.set('#ffffff'); u.btn.material.emissiveIntensity = 0.3;
    }

    // ---------------- eventos ----------------
    _ent(id) { const r = this._byId.get(id); return r && r.e && r.e.id === id ? r : null; }
    _events(events) {
        if (!events) return;
        for (let k = 0; k < events.length; k++) {
            const ev = events[k];
            switch (ev.t) {
                case 'spawn': { const r = this._findEntity(ev.id); if (r) this._burst(this.pSmall, r.x, 0.15, r.z, '#d8f0c0', 8, 1.6, 0.45, 4); break; }
                case 'cast': this._cast(ev); break;
                case 'hit': this._hit(ev); break;
                case 'die': this._die(ev); break;
                case 'level': this.colT = 1.3; break;
                case 'evolve': this.flashT = 0.9; this._forceHero(); this._burst(this.pBig, this.hx, 1, this.hz, '#ffffff', 30, 4, 0.9, 2); break;
                case 'swap': this._forceHero(); this._burst(this.pSmall, this.hx, 0.8, this.hz, '#ffffff', 26, 3, 0.6, 5); break;
                case 'heal': for (let i = 0; i < 26; i++) this._emit(this.pSmall, this.hx + (Math.random() - 0.5) * 1.2, 0.1 + Math.random() * 0.5, this.hz + (Math.random() - 0.5) * 1.2, 0, 1.2 + Math.random() * 1.8, 0, 0.9, this._col('#7dff9a'), -0.5, 0); break;
                case 'dash': this.dashT = 0.25; break;
                case 'down': this._burst(this.pBig, this.hx, 0.6, this.hz, '#8a8a99', 18, 2.2, 0.8, 1); break;
                case 'capture': this._capture(ev); break;
                case 'wave': if (this.onWave) this.onWave(ev); break;
            }
            if (this.onEvent) this.onEvent(ev);
        }
    }
    // entidade viva por id (no mundo) — devolve um objeto com x, z (proxy reaproveitado)
    _findEntity(id) {
        const w = this.world; if (!w) return null;
        if (w.player && w.player.id === id) { this._proxy.x = w.player.x; this._proxy.z = w.player.z; return this._proxy; }
        const en = w.enemies; for (let i = 0; i < en.length; i++) if (en[i].id === id) { this._proxy.x = en[i].x; this._proxy.z = en[i].z; return this._proxy; }
        return null;
    }
    _entityById(id) {
        const w = this.world; if (!w) return null;
        if (w.player && w.player.id === id) return w.player;
        const r = this._ent(id); if (r) return r.e;
        const en = w.enemies; for (let i = 0; i < en.length; i++) if (en[i].id === id) return en[i];
        return null;
    }
    _cast(ev) {
        const e = this._entityById(ev.id); if (!e || !e.moves) return;
        const mv = e.moves[ev.move]; if (!mv) return;
        const prof = mv.profile || (typeof moveFxProfile === 'function' ? moveFxProfile(mv.name, mv.type, mv.power) : null); if (!prof) return;
        const r = this._ent(ev.id), big = e.kind === 'player' || e.tier === 'boss', h = r ? r.height : 1;
        this._from.set(ev.x, 0, ev.z); this._to.set(ev.tx, 0, ev.tz);
        (big ? this.fx : this.fxFoe).play(prof, this._from, this._to, { height: Math.max(0.5, h * 0.6), targetHeight: 0.6 });
    }
    _hit(ev) {
        const r = this._ent(ev.id);
        if (r) {
            r.flash = 1; r.kick = 1;
            let kx = ev.kx || 0, kz = ev.kz || 0, d = Math.hypot(kx, kz);
            if (d < 1e-6) { const a = this._ent(ev.by); if (a) { kx = r.rx - a.rx; kz = r.rz - a.rz; d = Math.hypot(kx, kz); } }
            if (d > 1e-6) { r.kx = kx / d; r.kz = kz / d; } else { r.kx = 0; r.kz = 0; }
            this._burst(this.pSmall, r.rx, Math.min(1.2, r.height * 0.55), r.rz, ev.crit ? '#ffe14a' : '#ffffff', ev.crit ? 10 : 5, 2.6, 0.35, 6);
        }
        if (this.onDamage) {
            const d = this._dmg; d.dmg = ev.dmg; d.crit = !!ev.crit; d.eff = ev.eff;
            const e = r ? r.e : this._entityById(ev.id);
            if (e) this.onDamage(e, d);
        }
    }
    _die(ev) {
        const r = this._ent(ev.id), x = r ? r.rx : ev.x, z = r ? r.rz : ev.z, h = r ? r.height : 0.8;
        if (r) r.dieT = 0;
        const tier = ev.tier || 'minion', big = tier === 'boss' ? 3 : tier === 'elite' ? 1.8 : 1;
        this._burst(this.pBig, x, h * 0.5, z, '#d9d4c8', Math.round(10 * big), 1.8 * big, 0.6, -0.6);
        this._burst(this.pSmall, x, h * 0.5, z, '#fff3c4', Math.round(8 * big), 3 * big, 0.5, 5);
        const orbs = tier === 'boss' ? 24 : tier === 'elite' ? 10 : 3, rgb = this._col('#8ff0ff');
        for (let i = 0; i < orbs; i++) { const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 2; this._emit(this.pBig, x, 0.6, z, Math.cos(a) * s, 3 + Math.random() * 2, Math.sin(a) * s, 3, rgb, 9, 0.35 + Math.random() * 0.2); }
    }
    _capture(ev) {
        const c = this.cap, r = this._ent(ev.id);
        if (ev.stage === 'throw') {
            this._ballColors(ev.ball); this.ball.visible = true; this.ball.scale.setScalar(1);
            c.phase = 'fly'; c.t = 0; c.id = ev.id; c.sx = this.hx; c.sy = 1.1; c.sz = this.hz; c.tx = r ? r.rx : this.hx; c.tz = r ? r.rz : this.hz; c.landed = false; c.wob = 0; c.hide = 0;
        } else if (ev.stage === 'shake') { c.wob = 0.6; }
        else if (ev.stage === 'caught') {
            const u = this.ball.userData; u.btn.material.emissive.set('#ffd23b'); u.btn.material.emissiveIntensity = 1.4;
            this._burst(this.pSmall, c.tx, 0.4, c.tz, '#ffe27a', 30, 2.8, 0.9, 2); c.phase = 'done'; c.hide = 1.1;
        } else if (ev.stage === 'free') {
            this._burst(this.pSmall, c.tx, 0.3, c.tz, '#ffffff', 36, 4, 0.5, 5); c.phase = ''; this.ball.visible = false;
        }
    }
    _updCapture(dt) {
        const c = this.cap, b = this.ball; if (!b.visible) return;
        if (c.phase === 'fly') {
            const r = this._ent(c.id); if (r) { c.tx = r.rx; c.tz = r.rz; }
            c.t += dt; const k = Math.min(1, c.t / 0.5);
            b.position.set(c.sx + (c.tx - c.sx) * k, c.sy + (0.22 - c.sy) * k + Math.sin(k * Math.PI) * 1.6, c.sz + (c.tz - c.sz) * k); b.rotation.x += dt * 18;
            if (k >= 1) { c.phase = 'rest'; b.rotation.set(0, Math.atan2(this.hx - c.tx, this.hz - c.tz), 0); this._burst(this.pSmall, c.tx, 0.5, c.tz, '#ffffff', 22, 3, 0.4, 3); }
        } else {
            b.position.y = 0.22;
            if (c.wob > 0) { c.wob -= dt; b.rotation.z = Math.sin((0.6 - c.wob) / 0.6 * Math.PI * 2) * 0.45 * Math.sin(Math.max(0, c.wob) / 0.6 * Math.PI); } else b.rotation.z = 0;
            if (c.hide > 0) { c.hide -= dt; if (c.hide <= 0) { b.visible = false; c.phase = ''; } }
        }
    }
    _forceHero() { const w = this.world; if (w && w.player) { const r = this._ent(w.player.id); if (r) r.species = -1; } }
    shake(f) { this.shakeF = Math.max(this.shakeT > 0 ? this.shakeF : 0, Math.min(0.5, 0.12 + f * 0.6)); this.shakeT = Math.max(this.shakeT, 0.12 + f); }

    // ---------------- quadro ----------------
    frame(world, events, dt, alpha = 1) {
        if (!world) return;
        if (world !== this.world) this.attach(world);
        dt = Math.max(0, Math.min(0.1, Number(dt) || 0)); alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
        this.t += dt; const e3d = this.e3d; e3d.t += dt; e3d.frames++;
        const stamp = ++this._stamp, newStep = world.t !== this._lastT; this._lastT = world.t;
        // 1) entidades vivas → registros
        const p = world.player;
        if (p) this._sync(p, stamp, newStep);
        const en = world.enemies;
        for (let i = 0; i < en.length; i++) if (en[i].alive !== false) this._sync(en[i], stamp, newStep);
        this._pre = false;
        // 2) eventos (depois do sync: as entidades novas já têm registro)
        this._events(events);
        // 3) desenho
        for (let i = 0; i < this._poolList.length; i++) this._poolList[i].n = 0;
        let ns = 0; const sh = this.shadows, M = this._m;
        for (let i = this._recs.length - 1; i >= 0; i--) {
            const r = this._recs[i];
            if (r.seen !== stamp) {                                           // sumiu do mundo: corpo encolhe um instante (se morreu) e o registro volta ao pool
                if (r.dieT < 0) { this._dropRec(r); continue; }
                r.dieT += dt; if (r.dieT > ACTION_3D_GHOST) { this._dropRec(r); continue; }
            }
            const e = r.e, ghost = r.seen !== stamp;
            // posição interpolada
            if (!ghost) { r.rx = r.px + (r.cx - r.px) * alpha; r.rz = r.pz + (r.cz - r.pz) * alpha; }
            let d = (ghost ? r.face : (e.face || 0)) - r.face; d = Math.atan2(Math.sin(d), Math.cos(d)); r.face += d * Math.min(1, dt * 14);
            r.flash = Math.max(0, r.flash - dt * 5); r.kick = Math.max(0, r.kick - dt * 6);
            const state = ghost ? 'dying' : e.state, hidden = state === 'balled';
            const kick = r.kick * r.kick * 0.22 * (r.tier === 'boss' ? 0.4 : 1), x = r.rx + r.kx * kick, z = r.rz + r.kz * kick;
            const shrink = ghost ? Math.max(0.01, 1 - r.dieT / ACTION_3D_GHOST) : 1;
            if (r.kind === 'model') {
                const m = r.model; m.visible = !hidden;
                m.position.set(x, ghost ? -0.4 * (1 - shrink) : 0, z); m.rotation.y = r.face; m.scale.setScalar(r.scale * shrink * (1 + r.flash * 0.08));
                if (!hidden && typeof animatePokemonModel === 'function') animatePokemonModel(m, state, this.t, dt, Math.min(1, Math.hypot(e.vx || 0, e.vz || 0) / 4));
            } else if (r.kind === 'inst') {
                if (!hidden) {
                    const pool = r.pool, P = this._pose; P.y = 0; P.sx = P.sy = P.sz = 1; P.tilt = 0; P.roll = 0;
                    P.fwd = 0;
                    // y e fwd vêm em alturas do modelo; t = tempo no estado (golpe, dano, morte) ou o relógio (parado, andando)
                    if (typeof pokemonInstancePose === 'function') pokemonInstancePose(pool.rig, state, (state === 'idle' || state === 'move') ? this.t : (ghost ? r.dieT : (e.stateT || 0)), r.phase, P);
                    else { P.y = state === 'move' ? Math.abs(Math.sin(this.t * 10 + r.phase)) * 0.12 : 0; }
                    const s = r.scale * shrink, hh = r.height, fw = (P.fwd || 0) * hh;
                    this._eu.set(P.tilt || 0, r.face, P.roll || 0, 'YXZ'); this._qt.setFromEuler(this._eu);
                    this._p.set(x + Math.sin(r.face) * fw, (P.y || 0) * hh, z + Math.cos(r.face) * fw); this._s.set((P.sx || 1) * s, (P.sy || 1) * s, (P.sz || 1) * s);
                    M.compose(this._p, this._qt, this._s); const idx = pool.n++;
                    pool.mesh.setMatrixAt(idx, M);
                    const f = 1 + r.flash * 2.2;
                    if (r.shiny) this._c.setRGB(ACTION_3D_SHINY[0] * f, ACTION_3D_SHINY[1] * f, ACTION_3D_SHINY[2] * f); else this._c.setRGB(f, f, f);
                    pool.mesh.setColorAt(idx, this._c);
                }
            } else if (r.kind === 'sprite') {
                const s = r.sprite; s.visible = !hidden;
                s.position.set(x, (state === 'move' ? Math.abs(Math.sin(this.t * 10 + r.phase)) * 0.1 : 0) - (ghost ? 0.3 * (1 - shrink) : 0), z);
                const f = 1 + r.flash * 1.5; s.material.color.setRGB(f, f, f); s.material.opacity = shrink;
            }
            if (r.ring) { r.ring.visible = !ghost; r.ring.position.set(x, 0.035, z); const rr = r.radius * 1.5 * (r.tier === 'boss' ? 1.15 : 1); r.ring.scale.set(rr, 1, rr); r.ring.rotation.y = this.t * 0.8; }
            if (r.bar) {
                r.bar.visible = !ghost && !hidden; r.bar.position.set(x, r.height + 0.35, z); r.bar.quaternion.copy(e3d.camera.quaternion);
                const hp = e && e.maxHp ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 1; r.barFill.scale.x = Math.max(0.001, hp);
                if (Math.abs(hp - r.hp01) > 0.01) { r.hp01 = hp; r.barFill.material.color.setHSL(hp * 0.33, 0.85, 0.52); }
            }
            if (!hidden && sh && ns < sh.instanceMatrix.count) {
                const rr = r.radius * (r.kind === 'sprite' ? 0.95 : 1.3) * shrink * (r.kind === 'model' ? Math.max(1, r.scale * 0.6) : 1);
                this._p.set(x, 0.02, z); this._s.set(rr, 1, rr); this._q1.identity(); M.compose(this._p, this._q1, this._s); sh.setMatrixAt(ns++, M);
            }
        }
        for (let i = 0; i < this._poolList.length; i++) {
            const pl = this._poolList[i]; pl.mesh.count = pl.n; pl.mesh.visible = pl.n > 0;
            if (pl.n) { pl.mesh.instanceMatrix.needsUpdate = true; pl.mesh.instanceColor.needsUpdate = true; }
        }
        if (sh) { sh.count = ns; sh.instanceMatrix.needsUpdate = true; }
        // herói (posição para câmera, orbes, bola)
        const hr = p ? this._ent(p.id) : null;
        if (hr) { this.hx = hr.rx; this.hz = hr.rz; const s = hr.radius * 1.6; this.heroRing.position.set(hr.rx, 0.03, hr.rz); this.heroRing.scale.set(s, 1, s); }
        this.heroRing.visible = !!hr && p.alive !== false;
        this._markers(world);
        this._fxUpdate(dt);
        this._camera(dt, world);
        this._worldAnim();
        e3d.renderer.render(e3d.world, e3d.camera);
    }
    _sync(e, stamp, newStep) {
        const r = this._rec(e);
        if (r.seen === 0 || r.species !== e.speciesId || r.shiny !== !!e.shiny || r.kind === '' || r.tier !== (e.kind === 'player' ? 'hero' : (e.tier || 'minion'))) this._buildVisual(r, e);
        if (this._pre) { r.cx = e.x; r.cz = e.z; }
        else if (newStep) { r.px = r.cx; r.pz = r.cz; r.cx = e.x; r.cz = e.z; }
        if (Math.abs(r.cx - r.px) + Math.abs(r.cz - r.pz) > 3) { r.px = r.cx; r.pz = r.cz; }      // teletransporte/troca: sem arrastar
        r.seen = stamp; r.dieT = -1; r.radius = e.radius || r.radius;
    }
    _markers(world) {
        const p = world.player, en = world.enemies;
        let aim = null, aimD = 49, cap = null, capD = Infinity;
        const capFrac = typeof ACTION_BALANCE !== 'undefined' ? ACTION_BALANCE.captureHpFrac : 0.35, capR = typeof ACTION_BALANCE !== 'undefined' ? ACTION_BALANCE.captureRange : 6;
        if (p && p.alive !== false) {
            for (let i = 0; i < en.length; i++) {
                const e = en[i]; if (e.alive === false || e.state === 'balled') continue;
                const d = (e.x - p.x) * (e.x - p.x) + (e.z - p.z) * (e.z - p.z);
                if (d < aimD) { aimD = d; aim = e; }
                if (e.maxHp && e.hp / e.maxHp <= capFrac && d <= capR * capR && d < capD) { capD = d; cap = e; }
            }
        }
        const ra = aim && aim !== cap ? this._ent(aim.id) : null, rc = cap ? this._ent(cap.id) : null;
        this.aimRing.visible = !!ra; this.capRing.visible = !!rc;
        if (ra) { const s = ra.radius * 1.25 * (ra.tier === 'minion' ? 1 : 1.3); this.aimRing.position.set(ra.rx, 0.04, ra.rz); this.aimRing.scale.set(s, 1, s); }
        if (rc) { const s = rc.radius * 1.5 + Math.sin(this.t * 8) * 0.08; this.capRing.position.set(rc.rx, 0.045, rc.rz); this.capRing.scale.set(s, 1, s); this.capRing.material.opacity = 0.55 + Math.sin(this.t * 10) * 0.4; }
    }
    _fxUpdate(dt) {
        this.fx.update(dt); this.fxFoe.update(dt);
        if (this.dashT > 0) { this.dashT -= dt; const rgb = this._col('#9fe0ff'); for (let i = 0; i < 3; i++) this._emit(this.pBig, this.hx + (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.6, this.hz + (Math.random() - 0.5) * 0.4, 0, 0.2, 0, 0.35, rgb, 0, 0); }
        if (this.colT > 0) { this.colT -= dt; const k = Math.max(0, this.colT) / 1.3; this.column.visible = this.colT > 0; this.column.position.set(this.hx, 0, this.hz); this.column.scale.set(0.6 + (1 - k) * 0.6, 1, 0.6 + (1 - k) * 0.6); this.column.material.opacity = Math.sin(k * Math.PI) * 0.55; }
        if (this.flashT > 0) { this.flashT -= dt; const k = 1 - Math.max(0, this.flashT) / 0.9; this.flash.visible = this.flashT > 0; this.flash.position.set(this.hx, 0.8, this.hz); this.flash.scale.setScalar(0.4 + k * 2.6); this.flash.material.opacity = (1 - k) * 0.9; }
        this._updCapture(dt);
        this._updParticles(this.pSmall, dt); this._updParticles(this.pBig, dt);
    }
    // Câmera em três quartos seguindo o herói; recua e sobe com a multidão; em pé (retrato) afasta mais
    _camera(dt, world) {
        const e3d = this.e3d, cam = e3d.camera, en = world.enemies, hx = this.hx, hz = this.hz;
        let n = 0; for (let i = 0; i < en.length; i++) { const dx = en[i].x - hx, dz = en[i].z - hz; if (dx * dx + dz * dz < 81) n++; }
        this.crowd += (Math.min(1, n / 18) - this.crowd) * (1 - Math.exp(-dt * 1.5));
        const portrait = e3d.h > e3d.w, back = (portrait ? 10 : 8) + this.crowd * 3, h = (portrait ? 14 : 10) + this.crowd * 3.5;
        const k = this._camInit ? 1 - Math.exp(-dt * 6) : 1; this._camInit = true;
        this._camPos.x += (hx - this._camPos.x) * k; this._camPos.y += (h - this._camPos.y) * k; this._camPos.z += (hz + back - this._camPos.z) * k;
        this._camLook.x += (hx - this._camLook.x) * k; this._camLook.y += (0.6 - this._camLook.y) * k; this._camLook.z += (hz - (portrait ? 0.8 : 0.4) - this._camLook.z) * k;
        cam.position.copy(this._camPos);
        if (this.shakeT > 0) { this.shakeT -= dt; const f = this.shakeF * Math.min(1, this.shakeT * 6); cam.position.x += (Math.random() - 0.5) * f; cam.position.y += (Math.random() - 0.5) * f; }
        if (cam.position.y < 2) cam.position.y = 2;                      // nunca atravessa o chão
        cam.lookAt(this._camLook);
        // névoa do Explore3D medida a partir do herói (a câmera de ação fica mais longe que a do Explorar): guarda o original para o dispose
        const fog = e3d.world.fog;
        if (fog) {
            if (!this._fog0) this._fog0 = { near: fog.near, far: fog.far, camFar: cam.far };
            const dist = Math.hypot(back, h), span = this.q.fogFar || 40;
            fog.near = dist + span * 0.3; fog.far = dist + span;
            if (Math.abs(cam.far - (fog.far + 8)) > 0.5) { cam.far = fog.far + 8; cam.updateProjectionMatrix(); }
        }
    }
    // o que o Explore3D.render faria pelo mundo: vento do mato, brilho da água, sol (sombra) seguindo o herói
    _worldAnim() {
        const e3d = this.e3d, t = e3d.t;
        if (e3d.windU) e3d.windU.value = t;
        const an = e3d.anim; if (an) for (let i = 0; i < an.length; i++) { const a = an[i]; if (a.liquid) a.liquid.emissiveIntensity = (a.lava ? 1.2 : 0.3) + Math.sin(t * 2) * 0.15; if (a.glow) a.glow.emissiveIntensity = 1 + Math.sin(t * 3) * 0.4; }
        const sun = e3d.world.userData && e3d.world.userData.sun, mode = this.q.shadows;
        if (!sun) return;
        if (mode === 'dynamic') { sun.position.set(this.hx + 8, 18, this.hz + 6); sun.target.position.set(this.hx, 0, this.hz); }
        else if (mode === 'static' && (!e3d._shadowAt || Math.hypot(this.hx - e3d._shadowAt.x, this.hz - e3d._shadowAt.z) > 8)) {
            sun.position.set(this.hx + 8, 18, this.hz + 6); sun.target.position.set(this.hx, 0, this.hz); sun.target.updateMatrixWorld();
            e3d._shadowAt = { x: this.hx, z: this.hz }; e3d.renderer.shadowMap.needsUpdate = true;
        }
    }

    // posição na tela (px CSS) de uma entidade (para números de dano e marcadores)
    screenOf(e, out) {
        out = out || this._scr;
        const r = e ? this._ent(e.id) : null, x = r ? r.rx : (e ? e.x : 0), z = r ? r.rz : (e ? e.z : 0), y = r ? r.height + 0.2 : 1.2;
        const v = this._v.set(x, y, z).project(this.e3d.camera);
        out.x = (v.x * 0.5 + 0.5) * this.e3d.w; out.y = (-v.y * 0.5 + 0.5) * this.e3d.h; out.visible = v.z < 1;
        return out;
    }
    isAnimating() {
        return (!!this.world && !this.world.over) || this.fx.active || this.fxFoe.active || this.pSmall.alive > 0 || this.pBig.alive > 0 || this.shakeT > 0 || this.ball.visible || this.colT > 0 || this.flashT > 0;
    }
    // Descarta tudo o que esta classe criou (o mapa, as luzes e o renderer são do Explore3D)
    dispose() {
        this.fx.dispose(); this.fxFoe.dispose();
        this._releaseAll();
        for (const p of this._poolList) this._disposePool(p);
        this._pools.clear(); this._poolList.length = 0; this._sprFree.clear();
        this.e3d.world.remove(this.root);
        if (this._fog0) { const f = this.e3d.world.fog, cam = this.e3d.camera; if (f) { f.near = this._fog0.near; f.far = this._fog0.far; } cam.far = this._fog0.camFar; cam.updateProjectionMatrix(); this._fog0 = null; }
        this._disposeTree(this.root);
        for (const g of [this._gRing, this._gDisc, this._gBar, this._gBarFill]) g.dispose();
        this._barBgMat.dispose(); for (const k in this._ringMat) this._ringMat[k].dispose();
        if (this.dot) this.dot.dispose();
        if (typeof disposePokemonModels === 'function') disposePokemonModels(this.T);      // cache do módulo de modelos (recriado sob demanda)
        this.world = null; this.shadows = null; this._recs.length = 0; this._byId.clear(); this._freeRecs.length = 0;
    }
}
