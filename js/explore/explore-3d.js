// ============================================================
// F10 · Modo Explorar · cena 3D (Three.js, carregado sob demanda por explore-view.js em window.THREE).
// Converte o MESMO mapa ASCII do mundo (WORLD_LEGEND / getWorldMap) em 3D: 1 tile = 1 unidade; px do mundo / 16 = unidades.
// Os Pokémon usam os sprites do jogo (billboards). Só desenha: posição, colisão e regras vêm do motor e de explore-core.js.
// ============================================================
const EXPLORE_TYPE_COLORS = {
    normal: '#c8c4a8', fire: '#ff7a33', water: '#4fa3ff', electric: '#ffd83d', grass: '#62d36a', ice: '#8fe6ff', fighting: '#d9573f', poison: '#b45fd6',
    ground: '#d9b063', flying: '#9db4ff', psychic: '#ff6fa8', bug: '#a8c43a', rock: '#c2a45f', ghost: '#7e6bc4', dragon: '#7f5cff', dark: '#6b5a4c', steel: '#b8c4d6', fairy: '#ffa8e0',
};
const EXPLORE_GROUND_COLORS = {
    '.': '#5fbf57', ',': '#58b452', 'f': '#5fbf57', 'y': '#5fbf57', 'w': '#3f9a45', 'p': '#d2ae74', 'q': '#d8d0c0', 'c': '#7a6b5c', 'a': '#4e4440', 'n': '#eef4fb',
    'g': '#4f425f', 'e': '#e6d49c', 'u': '#9a8a74', 'v': '#6e5e52', 'k': '#d9e4ee', 'm': '#675a78',
};
const EXPLORE_BALL_COLORS = { pokeball: ['#ff3b3b', '#f4f6ff'], greatball: ['#3b7bff', '#f4f6ff'], ultraball: ['#262630', '#ffd23b'], masterball: ['#8a3bff', '#f4f6ff'] };

class Explore3D {
    // quality: id de EXPLORE_QUALITY (F10.1). O antialias só pode ser escolhido na criação: trocar de preset que muda isso recria a cena (explore-view.js).
    constructor(canvas, quality = 'high', dpr = window.devicePixelRatio || 1) {
        const T = window.THREE;
        this.T = T; this.canvas = canvas; this.qualityId = quality; this.q = exploreQualityPreset(quality); this.frames = 0;
        this.renderer = new T.WebGLRenderer({ canvas, antialias: this.q.antialias, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(explorePixelRatio(quality, dpr));
        this._applyShadowMode();
        this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.outputColorSpace = T.SRGBColorSpace;
        this.camera = new T.PerspectiveCamera(50, 1, 0.1, 400);
        this.world = new T.Scene(); this.battle = new T.Scene();
        this.mode = 'world'; this.fx = []; this.t = 0; this.shakeT = 0;
        this.texLoader = new T.TextureLoader(); this.texCache = new Map();
        this._sphere = new T.SphereGeometry(1, 16, 12);
        this._lights(this.world, true); this._lights(this.battle, false);
        this.resize();
    }
    // Sombras por preset: 'dynamic' = suave, recalculada todo quadro; 'static' = recalculada só quando o treinador se afasta (cobre uma área maior);
    // 'blob' = nenhuma sombra calculada (só as manchas escuras sob o treinador e as árvores).
    _applyShadowMode() {
        const T = this.T, r = this.renderer, mode = this.q.shadows;
        r.shadowMap.enabled = mode !== 'blob';
        r.shadowMap.type = mode === 'dynamic' ? T.PCFSoftShadowMap : T.PCFShadowMap;
        r.shadowMap.autoUpdate = mode === 'dynamic';
        r.shadowMap.needsUpdate = true; this._shadowAt = null;
    }
    // Material do preset: Lambert (barato por pixel) ou Standard (PBR). Lambert ignora roughness/metalness.
    _mat(opts) {
        const T = this.T;
        if (this.q.material === 'lambert') { const { roughness, metalness, ...rest } = opts; void roughness; void metalness; return new T.MeshLambertMaterial(rest); }
        return new T.MeshStandardMaterial(opts);
    }
    setPixelRatio(r) { this.renderer.setPixelRatio(r); this.resize(); }
    isAnimating() { return this.fx.length > 0 || this.shakeT > 0; }
    _lights(scene, shadows) {
        const T = this.T, cast = shadows && this.q.shadows !== 'blob', wide = this.q.shadows === 'static' ? 26 : 16;
        scene.add(new T.HemisphereLight(0xdfefff, 0x3a3a2a, this.q.shadows === 'blob' ? 1.45 : 1.25));
        const sun = new T.DirectionalLight(0xfff4e0, 2.4); sun.position.set(10, 20, 8); sun.castShadow = cast;
        if (cast) { sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -wide, right: wide, top: wide, bottom: -wide, near: 1, far: 70 }); }
        if (shadows) { scene.userData.sun = sun; scene.add(sun.target); }
        scene.add(sun);
    }
    resize() {
        const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
        this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.fov = w < h ? 62 : 48; this.camera.updateProjectionMatrix();
        this.w = w; this.h = h;
    }
    texture(url) {
        if (this.texCache.has(url)) return this.texCache.get(url);
        const tex = this.texLoader.load(url); tex.magFilter = this.T.NearestFilter; tex.minFilter = this.T.NearestFilter; tex.colorSpace = this.T.SRGBColorSpace;
        this.texCache.set(url, tex); return tex;
    }
    pokemonSprite(speciesId, shiny, size) {
        const T = this.T, mat = new T.SpriteMaterial({ map: this.texture(shiny ? getShinyPokemonSpriteUrl(speciesId) : getPokemonSpriteUrl(speciesId)), transparent: true, alphaTest: 0.2 });
        const s = new T.Sprite(mat); s.scale.set(size, size, 1); s.center.set(0.5, 0.16);      // os PNGs têm ~15% de margem transparente embaixo: o pé fica no chão
        return s;
    }

    // ---------------- mapa ----------------
    setMap(map) {
        const T = this.T;
        this._clear(this.world);
        this._lights(this.world, true);
        this.map = map; this._shadowAt = null; this.renderer.shadowMap.needsUpdate = true;
        const W = map.width, H = map.height;
        const groundChar = (ch) => EXPLORE_GROUND_COLORS[ch] ? ch : (WORLD_LEGEND[ch] && WORLD_LEGEND[ch].kind === 'object' ? this._groundUnder(map) : '.');
        // chão: uma malha com cor por vértice (cada célula = 2 triângulos próprios, cores nítidas por tile)
        // F10.1: um pedaço de chão por bloco de 16×16 tiles (a câmera descarta os blocos fora da tela)
        const c = new T.Color(), tmp = new T.Color(), groundMat = this._mat({ vertexColors: true, roughness: 0.95 }), groundCells = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const def = WORLD_LEGEND[map.rows[y][x]]; if (!(def && (def.kind === 'water' || def.kind === 'lava'))) groundCells.push([x, y]); }
        this.ground = [];
        for (const list of exploreChunks(groundCells).values()) {
            const pos = [], col = [];
            for (const [x, y] of list) {
                c.set(EXPLORE_GROUND_COLORS[groundChar(map.rows[y][x])] || '#5fbf57');
                const v = (worldHash(x, y) % 1000) / 1000; tmp.copy(c).offsetHSL(0, 0, (v - 0.5) * 0.05);
                pos.push(x, 0, y, x, 0, y + 1, x + 1, 0, y, x + 1, 0, y, x, 0, y + 1, x + 1, 0, y + 1);
                for (let k = 0; k < 6; k++) col.push(tmp.r, tmp.g, tmp.b);
            }
            const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); gg.setAttribute('color', new T.Float32BufferAttribute(col, 3)); gg.computeVertexNormals(); gg.computeBoundingSphere();
            const mesh = new T.Mesh(gg, groundMat); mesh.receiveShadow = true; this.world.add(mesh); this.ground.push(mesh);
        }
        // fundo abaixo do mapa (borda) e névoa
        const under = new T.Mesh(new T.BoxGeometry(W + 0.2, 2, H + 0.2), this._mat({ color: '#3b2f24', roughness: 1 })); under.position.set(W / 2, -1.01, H / 2); this.world.add(under);
        const outer = new T.Mesh(new T.PlaneGeometry(W + 120, H + 120), this._mat({ color: new T.Color(EXPLORE_GROUND_COLORS[this._groundUnder(map)] || '#5fbf57').offsetHSL(0, -0.1, -0.12), roughness: 1 }));
        outer.rotation.x = -Math.PI / 2; outer.position.set(W / 2, -0.03, H / 2); this.world.add(outer);
        const sky = new T.Color(map.type === 'city' ? '#9fd8ff' : this._biomeSky(map));
        this.world.background = sky; this.world.fog = new T.Fog(sky, this.q.fogFar * 0.4, this.q.fogFar);
        this.camera.far = this.q.fogFar + 8; this.camera.updateProjectionMatrix();         // além da névoa nada é desenhado
        // objetos por letra (instanciados)
        const cells = {};
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const ch = map.rows[y][x]; (cells[ch] ||= []).push([x, y]); }
        this.anim = [];
        for (const ch in cells) this._buildCells(ch, cells[ch], map);
        this._buildings(map);
    }
    _groundUnder(map) { const b = map.biome; return b === 'cave' ? 'c' : b === 'volcano' ? 'a' : b === 'snow' ? 'n' : b === 'haunted' ? 'g' : map.type === 'city' ? '.' : '.'; }
    _biomeSky(map) { return { cave: '#2b2620', volcano: '#4a2a22', snow: '#cfe3f5', haunted: '#2a2238', lake: '#9fd8ff', forest: '#8fd0c0', meadow: '#a8dcff' }[map.biome] || '#9fd8ff'; }
    // Instâncias de um mesmo objeto, um InstancedMesh por bloco de 16×16 (descarte pela câmera). place(x, y, i) e color(x, y, i) recebem o índice global.
    _inst(geo, mat, list, place, castShadow = true, color = null) {
        const T = this.T, M = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3(), out = [];
        const items = list.map((c, i) => [c[0], c[1], i]);
        for (const chunk of exploreChunks(items).values()) {
            const m = new T.InstancedMesh(geo, mat, chunk.length);
            chunk.forEach(([x, y, gi], i) => {
                const o = place(x, y, gi); p.set(o.x, o.y, o.z); e.set(0, o.ry || 0, 0); q.setFromEuler(e); s.set(o.sx, o.sy ?? o.sx, o.sz ?? o.sx); M.compose(p, q, s); m.setMatrixAt(i, M);
                if (color) m.setColorAt(i, color(x, y, gi));
            });
            m.computeBoundingSphere();
            m.castShadow = castShadow && this.q.shadows !== 'blob'; m.receiveShadow = this.q.shadows !== 'blob'; this.world.add(m); out.push(m);
        }
        return out;
    }
    _buildCells(ch, list, map) {
        const T = this.T, std = (color, o = {}) => this._mat({ color, roughness: 0.75, flatShading: true, ...o });
        const j = (x, y, k) => ((worldHash(x * 7 + k, y * 13 - k) % 1000) / 1000);
        switch (ch) {
            case 'T': case 'P': {
                const snow = ch === 'P';
                // F10.1: detalhe das árvores pelo preset (segmentos dos cones e uma ou duas copas); no Leve, uma copa só um pouco maior
                const seg = this.q.treeSegs || 7, tiers = this.q.treeTiers || 2;
                this._inst(new T.CylinderGeometry(0.12, 0.18, 1, Math.max(4, seg - 2), 1, true), std('#6b4a2e'), list, (x, y) => ({ x: x + 0.5, y: 0.5, z: y + 0.5, sx: 1, sy: 1 }));
                if (tiers === 1) this._inst(new T.ConeGeometry(0.66, 1.9, seg), std(snow ? '#2f6f5a' : '#34964a'), list, (x, y) => ({ x: x + 0.5, y: 1.6, z: y + 0.5, sx: 0.9 + j(x, y, 1) * 0.3, ry: j(x, y, 2) * 6 }));
                else {
                    this._inst(new T.ConeGeometry(0.62, 1.3, seg), std(snow ? '#2f6f5a' : '#2f8f45'), list, (x, y) => ({ x: x + 0.5, y: 1.35, z: y + 0.5, sx: 0.9 + j(x, y, 1) * 0.3, ry: j(x, y, 2) * 6 }));
                    this._inst(new T.ConeGeometry(0.46, 1.0, seg), std(snow ? '#f2f7fb' : '#3fae55'), list, (x, y) => ({ x: x + 0.5, y: 2.05, z: y + 0.5, sx: 0.9 + j(x, y, 3) * 0.3, ry: j(x, y, 4) * 6 }));
                }
                if (this.q.treeShadowBlobs) { const blob = new T.CircleGeometry(0.55, 6); blob.rotateX(-Math.PI / 2); this._inst(blob, new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }), list, (x, y) => ({ x: x + 0.6, y: 0.015, z: y + 0.6, sx: 1 }), false); }
                break;
            }
            case 'b': this._inst(new T.IcosahedronGeometry(0.48, this.q.bushDetail ?? 1), std('#3c9a48'), list, (x, y) => ({ x: x + 0.5, y: 0.38, z: y + 0.5, sx: 0.9 + j(x, y, 1) * 0.25, sy: 0.75 })); break;
            case 'r': case 'R': case 'i': this._inst(new T.DodecahedronGeometry(ch === 'R' ? 0.55 : 0.42, 0), std(ch === 'i' ? '#bfe9ff' : ch === 'R' ? '#7a6652' : '#8f949a'), list, (x, y) => ({ x: x + 0.5, y: ch === 'R' ? 0.45 : 0.3, z: y + 0.5, sx: 0.9 + j(x, y, 1) * 0.3, ry: j(x, y, 2) * 6 })); break;
            case 'o': this._inst(new T.CylinderGeometry(0.3, 0.35, 0.35, 8), std('#7a5434'), list, (x, y) => ({ x: x + 0.5, y: 0.17, z: y + 0.5, sx: 1 })); break;
            case 'X': { const [m] = this._inst(new T.OctahedronGeometry(0.4, 0), std('#7af7ff', { emissive: '#3fd8ff', emissiveIntensity: 1.2 }), list, (x, y) => ({ x: x + 0.5, y: 0.6, z: y + 0.5, sx: 0.8, sy: 1.5, ry: j(x, y, 1) * 6 })); this.anim.push({ glow: m.material }); break; }
            case 'O': this._inst(new T.CylinderGeometry(0.45, 0.5, 1.1, 6), std('#2e2a2a'), list, (x, y) => ({ x: x + 0.5, y: 0.55, z: y + 0.5, sx: 1, sy: 0.8 + j(x, y, 1) * 0.6 })); break;
            case 'd': this._inst(new T.CylinderGeometry(0.08, 0.16, 1.6, 5), std('#3d3330'), list, (x, y) => ({ x: x + 0.5, y: 0.8, z: y + 0.5, sx: 1, ry: j(x, y, 1) * 6 })); break;
            case 't': this._inst(new T.BoxGeometry(0.5, 0.7, 0.18), std('#9a97a8'), list, (x, y) => ({ x: x + 0.5, y: 0.35, z: y + 0.5, sx: 1 })); break;
            case '=': this._inst(new T.BoxGeometry(1, 0.5, 0.1), std('#c9a46a'), list, (x, y) => ({ x: x + 0.5, y: 0.25, z: y + 0.5, sx: 1 })); break;
            case 's': case 'z': this._inst(new T.BoxGeometry(0.7, 0.45, 0.08), std('#a77a4a'), list, (x, y) => ({ x: x + 0.5, y: 0.75, z: y + 0.5, sx: 1 })); this._inst(new T.CylinderGeometry(0.05, 0.05, 0.6, 5), std('#6b4a2e'), list, (x, y) => ({ x: x + 0.5, y: 0.3, z: y + 0.5, sx: 1 })); break;
            case 'h': this._inst(new T.BoxGeometry(0.9, 0.12, 0.35), std('#a77a4a'), list, (x, y) => ({ x: x + 0.5, y: 0.35, z: y + 0.5, sx: 1 })); break;
            case 'l': { this._inst(new T.CylinderGeometry(0.05, 0.06, 1.6, 6), std('#3a3a46'), list, (x, y) => ({ x: x + 0.5, y: 0.8, z: y + 0.5, sx: 1 })); this._inst(new T.SphereGeometry(0.14, 10, 8), std('#fff3c4', { emissive: '#ffd27a', emissiveIntensity: 1.6 }), list, (x, y) => ({ x: x + 0.5, y: 1.65, z: y + 0.5, sx: 1 }), false); break; }
            case 'f': case 'y': this._inst(this.q.flowersPerCell === 1 ? new T.OctahedronGeometry(0.08, 0) : new T.SphereGeometry(0.07, 6, 4), std(ch === 'f' ? '#ff4d6d' : '#ffd23b', { emissive: ch === 'f' ? '#661020' : '#665010' }), list.flatMap(c => Array(this.q.flowersPerCell || 3).fill(c)), (x, y, i) => ({ x: x + 0.2 + j(x, y, i) * 0.6, y: 0.12, z: y + 0.2 + j(y, x, i) * 0.6, sx: 1 }), false); break;
            case 'w': this._grass(list); break;
            case '~': case 'L': this._liquid(list, ch === 'L'); break;
        }
    }
    _grass(list) {
        const T = this.T, per = this.q.grassPerCell, geo = new T.ConeGeometry(0.06, 0.62, 3); geo.translate(0, 0.31, 0);
        const mat = this._mat({ color: '#2f8a3a', roughness: 0.8 });
        mat.onBeforeCompile = (sh) => { sh.uniforms.time = this.windU = { value: 0 }; sh.vertexShader = 'uniform float time;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat sw = sin(time * 2.2 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5) * 0.1 * position.y;\ntransformed.x += sw; transformed.z += sw * 0.5;'); };
        const all = []; for (const c of list) for (let k = 0; k < per; k++) all.push(c);
        const c = new T.Color();
        this._inst(geo, mat, all, (x, y, i) => { const h = worldHash(x * 31 + i, y * 17 - i); return { x: x + (h % 997) / 997, y: 0, z: y + ((h >>> 10) % 991) / 991, sx: 0.8 + ((h >>> 20) % 50) / 100, sy: 0.8 + ((h >>> 5) % 60) / 100, ry: (h % 628) / 100 }; }, false,
            (x, y, i) => c.set('#2f8a3a').offsetHSL(((worldHash(i, x) % 100) / 100 - 0.5) * 0.04, 0, ((worldHash(y, i) % 100) / 100) * 0.12));
    }
    _liquid(list, lava) {
        const T = this.T, mat = this._mat({ color: lava ? '#ff5a1f' : '#3a9be0', emissive: lava ? '#ff3a00' : '#0b3a66', emissiveIntensity: lava ? 1.3 : 0.35, roughness: 0.15, metalness: 0.1, transparent: !lava, opacity: 0.88 });
        const geo = new T.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
        this._inst(geo, mat, list, (x, y) => ({ x: x + 0.5, y: -0.12, z: y + 0.5, sx: 1 }), false);
        this._inst(new T.BoxGeometry(1, 0.3, 1), this._mat({ color: lava ? '#2a1a14' : '#3d6b8a' }), list, (x, y) => ({ x: x + 0.5, y: -0.45, z: y + 0.5, sx: 1 }), false);
        this.anim.push({ liquid: mat, lava });
    }
    // Prédios da cidade: letras de telhado e parede viram blocos com telhado, janelas, porta e o emblema do Centro Pokémon
    _buildings(map) {
        const T = this.T, roofs = { A: '#e2473f', B: '#e2473f', C: '#e2473f', H: '#3f78e2', I: '#3f78e2', J: '#3f78e2' }, walls = { D: 1, G: 1, F: 1, K: 1, N: 1, M: 1 };
        for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
            const ch = map.rows[y][x];
            if (roofs[ch]) {
                const box = new T.Mesh(new T.BoxGeometry(1.02, 0.5, 1.02), this._mat({ color: roofs[ch], roughness: 0.5 })); box.position.set(x + 0.5, 2.05, y + 0.5); box.castShadow = this.q.shadows !== 'blob'; this.world.add(box);
                const body = new T.Mesh(new T.BoxGeometry(1, 1.8, 1), this._mat({ color: '#f3efe6', roughness: 0.8 })); body.position.set(x + 0.5, 0.9, y + 0.5); body.castShadow = this.q.shadows !== 'blob'; this.world.add(body);
                if (ch === 'B') {            // emblema do Centro Pokémon na fachada do telhado
                    const e = new T.Mesh(new T.CircleGeometry(0.32, 24), this._mat({ color: '#ffffff', emissive: '#ff6a6a', emissiveIntensity: 0.4 })); e.position.set(x + 0.5, 2.05, y + 1.03); this.world.add(e);
                    const bar = new T.Mesh(new T.PlaneGeometry(0.64, 0.08), new T.MeshBasicMaterial({ color: '#e2473f' })); bar.position.set(x + 0.5, 2.05, y + 1.035); this.world.add(bar);
                }
                if (ch === 'I') { const d = new T.Mesh(new T.BoxGeometry(0.5, 0.3, 0.05), this._mat({ color: '#ffffff' })); d.position.set(x + 0.5, 2.05, y + 1.03); this.world.add(d); }
            } else if (walls[ch]) {
                const body = new T.Mesh(new T.BoxGeometry(1, 1.4, 1), this._mat({ color: ch === 'K' || ch === 'N' || ch === 'M' ? '#e9eef7' : '#f7f1e6', roughness: 0.8 })); body.position.set(x + 0.5, 0.7, y + 0.5); body.castShadow = this.q.shadows !== 'blob'; this.world.add(body);
                const door = ch === 'G' || ch === 'N';
                const fac = new T.Mesh(new T.PlaneGeometry(door ? 0.5 : 0.42, door ? 0.95 : 0.4), this._mat({ color: door ? (ch === 'G' ? '#ff6a6a' : '#5f8ad9') : '#9fd8ff', emissive: door ? '#200' : '#4fa3d8', emissiveIntensity: door ? 0.2 : 0.5 }));
                fac.position.set(x + 0.5, door ? 0.48 : 0.85, y + 1.01); this.world.add(fac);
            }
        }
    }

    // ---------------- treinador e seguidor ----------------
    ensureTrainer() {
        if (this.trainer) { if (this.trainer.parent !== this.world) this.world.add(this.trainer); return this.trainer; }
        const T = this.T, g = new T.Group(), body = new T.Group(); g.add(body);
        const mat = (c, o = {}) => this._mat({ color: c, roughness: 0.6, ...o });
        const jacket = mat('#ff3b3b'), pants = mat('#2a3a6a'), skin = mat('#f1c7a5'), cap = mat('#ff3b3b'), white = mat('#ffffff');
        const add = (geo, m, x, y, z, parent = body) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = this.q.shadows === 'dynamic'; parent.add(o); return o; };
        const legs = [-1, 1].map(s => { const p = new T.Group(); p.position.set(s * 0.09, 0.42, 0); body.add(p); add(new T.CapsuleGeometry(0.07, 0.26, 4, 8), pants, 0, -0.2, 0, p); add(new T.BoxGeometry(0.11, 0.06, 0.18), white, 0, -0.39, 0.03, p); return p; });
        add(new T.CapsuleGeometry(0.17, 0.28, 6, 12), jacket, 0, 0.7, 0);
        const arms = [-1, 1].map(s => { const p = new T.Group(); p.position.set(s * 0.23, 0.84, 0); body.add(p); add(new T.CapsuleGeometry(0.05, 0.25, 4, 8), jacket, 0, -0.15, 0, p); add(new T.SphereGeometry(0.055, 8, 6), skin, 0, -0.31, 0, p); return p; });
        add(new T.SphereGeometry(0.17, 18, 14), skin, 0, 1.07, 0);
        add(new T.SphereGeometry(0.18, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), cap, 0, 1.12, 0);
        const brim = add(new T.CylinderGeometry(0.14, 0.14, 0.02, 18, 1, false, -Math.PI / 2, Math.PI), white, 0, 1.12, 0.11); brim.scale.z = 1.5;
        add(new T.BoxGeometry(0.26, 0.3, 0.13), mat('#2f6fd6'), 0, 0.73, -0.19);
        for (const s of [-1, 1]) add(new T.SphereGeometry(0.025, 8, 6), mat('#1a1a2a'), s * 0.06, 1.08, 0.15);
        const sh = new T.Mesh(new T.CircleGeometry(0.3, 20), new T.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; g.add(sh);
        g.userData = { legs, arms, body, t: 0 };
        this.trainer = g; this.world.add(g);
        return g;
    }
    // state: { x, y (px do mundo), dir, moving }
    setTrainer(state, dt, running) {
        const g = this.ensureTrainer(), U = g.userData;
        g.position.set(state.x / WORLD_TILE_SIZE, 0, state.y / WORLD_TILE_SIZE);
        const want = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[state.dir] ?? 0;
        let d = want - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * Math.min(1, dt * 14);
        U.t += dt * (state.moving ? (running ? 16 : 11) : 2);
        U.legs.forEach((l, i) => { l.rotation.x = state.moving ? Math.sin(U.t + i * Math.PI) * 0.7 : 0; });
        U.arms.forEach((a, i) => { a.rotation.x = state.moving ? Math.sin(U.t + i * Math.PI + Math.PI) * 0.6 : 0; });
        U.body.position.y = state.moving ? Math.abs(Math.sin(U.t)) * 0.04 : 0;
        // o líder segue alguns passos atrás (rastro do treinador)
        const p = g.position;
        this.trail = this.trail || [];
        const last = this.trail[this.trail.length - 1];
        if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.12) { this.trail.push({ x: p.x, z: p.z }); if (this.trail.length > 40) this.trail.shift(); }
        if (this.follower) {
            const idx = Math.max(0, this.trail.length - 10), tp = this.trail[idx], fp = this.follower.position;
            const gap = Math.hypot(tp.x - p.x, tp.z - p.z);
            if (gap > 0.7) { fp.x += (tp.x - fp.x) * Math.min(1, dt * 8); fp.z += (tp.z - fp.z) * Math.min(1, dt * 8); }     // nunca encosta no treinador (o sprite o cobriria)
            this.follower.position.y = state.moving ? Math.abs(Math.sin(U.t * 0.9)) * 0.08 : Math.sin(this.t * 2) * 0.02;
        }
    }
    setFollower(speciesId, shiny) {
        if (this.follower) { this.world.remove(this.follower); this.follower = null; }
        if (!speciesId) return;
        this.follower = this.pokemonSprite(speciesId, shiny, 1.25);
        const p = this.trainer ? this.trainer.position : { x: 0, z: 0 };
        this.follower.position.set(p.x, 0, p.z + 0.6); this.world.add(this.follower);
        this.trail = [];
    }
    resetTrail(dir) {
        this.trail = [];
        if (!this.follower || !this.trainer) return;
        const back = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[dir || 'down'], p = this.trainer.position;
        this.follower.position.set(p.x + back[0] * 0.95, 0, p.z + back[1] * 0.95);      // um passo atrás do treinador
        this.trail.push({ x: this.follower.position.x, z: this.follower.position.z });
    }
    // portal de saída (volta à cidade) numa célula
    setExitPad(cell) {
        if (this.pad) { this.world.remove(this.pad); this.pad = null; }
        if (!cell) return;
        const T = this.T, pad = new T.Mesh(new T.RingGeometry(0.25, 0.45, 32), new T.MeshBasicMaterial({ color: '#7af7ff', transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
        pad.rotation.x = -Math.PI / 2; pad.position.set(cell.x + 0.5, 0.03, cell.y + 0.5); this.world.add(pad); this.pad = pad;
    }

    // ---------------- batalha ----------------
    startBattle(opts) {
        const T = this.T;
        this._clear(this.battle); this._lights(this.battle, false);
        const biomeCol = new T.Color(opts.ground || '#5fbf57');
        this.battle.background = new T.Color(opts.sky || '#9fd8ff');
        const floor = new T.Mesh(new T.CircleGeometry(30, 48), this._mat({ color: biomeCol, roughness: 1 })); floor.rotation.x = -Math.PI / 2; this.battle.add(floor);
        const hsl = {}; biomeCol.getHSL(hsl); const platCol = biomeCol.clone().offsetHSL(0, -0.1, hsl.l < 0.4 ? 0.12 : -0.12);
        const plat = (x, z, r) => { const m = new T.Mesh(new T.CylinderGeometry(r, r * 1.05, 0.18, 48), this._mat({ color: platCol, roughness: 0.9 })); m.position.set(x, 0.09, z); m.scale.z = 0.55; this.battle.add(m); const ring = new T.Mesh(new T.RingGeometry(r * 0.96, r, 48), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.scale.y = 0.55; ring.position.set(x, 0.19, z); this.battle.add(ring); };
        // grama ao fundo para dar profundidade
        const tuftGeo = new T.ConeGeometry(0.08, 0.6, 3); tuftGeo.translate(0, 0.3, 0);
        const tufts = new T.InstancedMesh(tuftGeo, this._mat({ color: biomeCol.clone().offsetHSL(0, 0, -0.08) }), 260), M = new T.Matrix4();
        for (let i = 0; i < 260; i++) { const a = (i * 2.399) % (Math.PI * 2), r = 6 + (i % 23) * 0.6; M.makeTranslation(Math.cos(a) * r, 0, Math.sin(a) * r - 4); tufts.setMatrixAt(i, M); }
        this.battle.add(tufts);
        // retrato (celular em pé): as duas plataformas se aproximam do centro para caberem na largura
        const pt = this.h > this.w; this.layout = pt ? { foe: [1.5, -2.8], me: [-1.15, 1.6] } : { foe: [2.8, -2.2], me: [-2.2, 1.7] };
        plat(this.layout.foe[0], this.layout.foe[1], pt ? 1.3 : 1.6); plat(this.layout.me[0], this.layout.me[1], pt ? 1.4 : 1.7);
        this.foeSpr = this.pokemonSprite(opts.foe.id, opts.foe.shiny, opts.foe.alpha ? 3.2 : 2.5); this.foeSpr.position.set(this.layout.foe[0], 0.1, this.layout.foe[1]); this.battle.add(this.foeSpr);
        this.meSpr = null; this.setMine(opts.me.id, opts.me.shiny);
        this.foeSpr.userData.base = this.foeSpr.position.clone();
        if (opts.foe.shiny) this._sparkle(this.foeSpr.position, '#fff7a0', 60);
        this.camera.position.set(-1.4, 3.2, 7.4); this.camTarget = new T.Vector3(0.6, 1.1, -0.8);
        this.camera.far = 200; this.camera.updateProjectionMatrix();
        this.mode = 'battle';
        // entrada: o selvagem desliza da direita
        this.foeSpr.position.x += 6; const target = this.layout.foe[0];
        this._tween(0.6, (k) => { this.foeSpr.position.x = target + 6 * (1 - k) * (1 - k); });
    }
    setMine(id, shiny) {
        if (this.meSpr) this.battle.remove(this.meSpr);
        const L = this.layout || { me: [-2.2, 1.7] }; this.meSpr = this.pokemonSprite(id, shiny, this.h > this.w ? 2.2 : 2.5); this.meSpr.position.set(L.me[0], 0.1, L.me[1]); this.meSpr.userData.base = this.meSpr.position.clone();
        this.battle.add(this.meSpr);
        this._burst(this.meSpr.position.clone().add(new this.T.Vector3(0, 1, 0)), '#ffffff', 30, 2.5);
    }
    endBattle() { this.mode = 'world'; this._clear(this.battle); this.meSpr = this.foeSpr = this.ball = null; this.camera.far = this.q.fogFar + 8; this.camera.updateProjectionMatrix(); }
    _spr(side) { return side === 'me' ? this.meSpr : this.foeSpr; }
    attack(side, type, power, done) {
        const a = this._spr(side), d = this._spr(side === 'me' ? 'foe' : 'me'); if (!a || !d) return done && done();
        const T = this.T, col = EXPLORE_TYPE_COLORS[type] || '#ffffff', base = a.userData.base, dir = d.position.clone().sub(base).normalize();
        this._tween(0.25, (k) => { a.position.copy(base).addScaledVector(dir, Math.sin(k * Math.PI) * 0.8); }, () => a.position.copy(base));
        const orb = new T.Mesh(this._sphere, new T.MeshBasicMaterial({ color: col })), big = power >= 80;
        orb.scale.setScalar(big ? 0.32 : 0.2); this.battle.add(orb);
        const from = base.clone().add(new T.Vector3(0, 1.2, 0)), to = d.position.clone().add(new T.Vector3(0, 1.1, 0));
        this._tween(0.38, (k) => { orb.position.lerpVectors(from, to, k); orb.position.y += Math.sin(k * Math.PI) * (big ? 1.4 : 0.6); }, () => {
            this.battle.remove(orb); this._burst(to, col, big ? 50 : 26, big ? 4 : 2.6); this.hit(side === 'me' ? 'foe' : 'me'); if (big) this.shakeT = 0.35; done && done();
        });
    }
    hit(side) {
        const s = this._spr(side); if (!s) return; const base = s.userData.base;
        this._tween(0.45, (k) => { s.position.x = base.x + Math.sin(k * 40) * 0.12 * (1 - k); s.material.opacity = (Math.floor(k * 8) % 2) ? 0.25 : 1; }, () => { s.position.copy(base); s.material.opacity = 1; });
    }
    faint(side, done) {
        const s = this._spr(side); if (!s) return done && done(); const base = s.userData.base;
        this._tween(0.6, (k) => { s.position.y = base.y - k * 1.2; s.material.opacity = 1 - k; }, () => { s.visible = false; done && done(); });
    }
    heal(side) { const s = this._spr(side); if (s) this._sparkle(s.position, '#7dff9a', 40); }
    _ballMesh(id) {
        const T = this.T, [top, bot] = EXPLORE_BALL_COLORS[id] || EXPLORE_BALL_COLORS.pokeball, g = new T.Group(), r = 0.22;
        g.add(new T.Mesh(new T.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this._mat({ color: top, roughness: 0.25, metalness: 0.2 })));
        g.add(new T.Mesh(new T.SphereGeometry(r, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this._mat({ color: bot, roughness: 0.3 })));
        const band = new T.Mesh(new T.TorusGeometry(r, 0.022, 8, 32), this._mat({ color: '#15151f' })); band.rotation.x = Math.PI / 2; g.add(band);
        const btn = new T.Mesh(new T.SphereGeometry(0.055, 12, 8), this._mat({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3 })); btn.position.z = r; g.add(btn); g.userData.btn = btn;
        return g;
    }
    throwBall(id, done) {
        const T = this.T, foe = this.foeSpr; if (!foe) return done && done();
        const ball = this._ballMesh(id); this.battle.add(ball); this.ball = ball;
        const a = new T.Vector3(-2.2, 1.6, 3.2), b = foe.position.clone().add(new T.Vector3(0, 1.3, 0));
        this._tween(0.7, (k) => { ball.position.lerpVectors(a, b, k); ball.position.y += Math.sin(k * Math.PI) * 2; ball.rotation.x += 0.35; }, () => {
            this._burst(b, '#ffffff', 40, 3);
            const s0 = foe.scale.clone();
            this._tween(0.35, (k) => { foe.scale.set(s0.x * (1 - k), s0.y * (1 - k), 1); foe.material.color.setRGB(1, 1 - k * 0.6, 1 - k * 0.6); }, () => {
                foe.visible = false; foe.scale.copy(s0); foe.material.color.setRGB(1, 1, 1);
                const y0 = ball.position.y;
                this._tween(0.45, (k) => { ball.position.y = y0 - (y0 - 0.4) * k + Math.sin(k * Math.PI) * 0.3; }, () => { ball.rotation.set(0, -Math.PI / 2, 0); done && done(); });
            });
        });
    }
    shakeBall(done) { const b = this.ball; if (!b) return done && done(); this._tween(0.7, (k) => { b.rotation.z = Math.sin(k * Math.PI * 2) * 0.45 * Math.sin(k * Math.PI); }, () => { b.rotation.z = 0; setTimeout(() => done && done(), 220); }); }
    caught(done) {
        const b = this.ball; if (!b) return done && done();
        b.userData.btn.material.emissive.set('#ffd23b'); b.userData.btn.material.emissiveIntensity = 1.4;
        for (let i = 0; i < 3; i++) setTimeout(() => this._burst(b.position.clone().add(new this.T.Vector3(0, 0.3, 0)), '#ffe27a', 16, 2.2), i * 160);
        setTimeout(() => done && done(), 1000);
    }
    breakFree(done) {
        const b = this.ball, foe = this.foeSpr; if (!b) return done && done();
        this._burst(b.position.clone(), '#ffffff', 50, 4); this.battle.remove(b); this.ball = null;
        if (foe) { foe.visible = true; this.hit('foe'); }
        setTimeout(() => done && done(), 450);
    }

    // ---------------- efeitos ----------------
    _tween(dur, step, end) { this.fx.push({ life: dur, max: dur, step, end }); }
    _burst(pos, color, n = 24, power = 3) {
        const T = this.T, p = new Float32Array(n * 3), v = [];
        for (let i = 0; i < n; i++) { p.set([pos.x, pos.y, pos.z], i * 3); v.push(new T.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(power * (0.4 + Math.random()))); }
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
        const pts = new T.Points(g, new T.PointsMaterial({ color, size: 0.14, transparent: true, depthWrite: false }));
        (this.mode === 'battle' ? this.battle : this.world).add(pts);
        this._tween(0.8, (k) => { const a = g.attributes.position.array; for (let i = 0; i < n; i++) { v[i].y -= 0.06; a[i * 3] += v[i].x * 0.016; a[i * 3 + 1] += v[i].y * 0.016; a[i * 3 + 2] += v[i].z * 0.016; } g.attributes.position.needsUpdate = true; pts.material.opacity = 1 - k; }, () => { pts.parent && pts.parent.remove(pts); g.dispose(); pts.material.dispose(); });
    }
    _sparkle(pos, color, n) { for (let i = 0; i < 3; i++) setTimeout(() => this._burst(pos.clone().add(new this.T.Vector3(0, 1.2, 0)), color, Math.round(n / 3), 1.8), i * 200); }
    _clear(scene) { for (let i = scene.children.length - 1; i >= 0; i--) { const o = scene.children[i]; if (o === this.trainer || o === this.follower) { scene.remove(o); continue; } scene.remove(o); o.traverse && o.traverse(c => { c.geometry && c.geometry !== this._sphere && c.geometry.dispose(); if (c.material && !c.isSprite) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose()); }); } }

    // ---------------- quadro ----------------
    render(dt) {
        this.t += dt; this.frames++;
        for (let i = this.fx.length - 1; i >= 0; i--) {
            const f = this.fx[i]; f.life -= dt; const k = Math.min(1, 1 - f.life / f.max);
            f.step && f.step(k);
            if (f.life <= 0) { this.fx.splice(i, 1); f.end && f.end(); }
        }
        if (this.windU) this.windU.value = this.t;
        for (const a of this.anim || []) { if (a.liquid) a.liquid.emissiveIntensity = (a.lava ? 1.2 : 0.3) + Math.sin(this.t * 2) * 0.15; if (a.glow) a.glow.emissiveIntensity = 1 + Math.sin(this.t * 3) * 0.4; }
        if (this.pad) { this.pad.rotation.z += dt * 1.5; this.pad.material.opacity = 0.6 + Math.sin(this.t * 4) * 0.25; }
        const portrait = this.h > this.w;
        if (this.mode === 'world' && this.trainer) {
            const p = this.trainer.position, dist = portrait ? 7 : 8, h = portrait ? 12.5 : 9;
            const want = new this.T.Vector3(p.x, h, p.z + dist);
            this.camera.position.lerp(want, Math.min(1, dt * 5)); this.camera.lookAt(p.x, 0.6, p.z);
            const sun = this.world.userData.sun;
            if (sun && this.q.shadows === 'dynamic') { sun.position.set(p.x + 8, 18, p.z + 6); sun.target.position.copy(p); }
            else if (sun && this.q.shadows === 'static' && (!this._shadowAt || Math.hypot(p.x - this._shadowAt.x, p.z - this._shadowAt.z) > 8)) {
                sun.position.set(p.x + 8, 18, p.z + 6); sun.target.position.copy(p); sun.target.updateMatrixWorld();
                this._shadowAt = { x: p.x, z: p.z }; this.renderer.shadowMap.needsUpdate = true;
            }
            this.renderer.render(this.world, this.camera);
        } else if (this.mode === 'battle') {
            const base = portrait ? new this.T.Vector3(-0.2, 4.4, 11.5) : new this.T.Vector3(-0.8, 3.4, 8.4);
            this.camera.position.lerp(base, Math.min(1, dt * 3));
            if (this.shakeT > 0) { this.shakeT -= dt; this.camera.position.x += (Math.random() - 0.5) * 0.2; this.camera.position.y += (Math.random() - 0.5) * 0.2; }
            this.camera.lookAt(this.camTarget);
            for (const s of [this.meSpr, this.foeSpr]) if (s && s.visible && s.userData.base && !this.fx.length) s.position.y = s.userData.base.y + Math.sin(this.t * 2.5 + (s === this.meSpr ? 1 : 0)) * 0.03;
            this.renderer.render(this.battle, this.camera);
        }
    }
    // célula do mapa sob um ponto da tela (toque/clique para andar), ou null
    cellAt(clientX, clientY) {
        if (!this.ground || !this.ground.length) return null;
        const T = this.T, r = this.canvas.getBoundingClientRect(), ndc = new T.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        const ray = new T.Raycaster(); ray.setFromCamera(ndc, this.camera);
        const plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3();
        if (!ray.ray.intersectPlane(plane, hit)) return null;
        const x = Math.floor(hit.x), y = Math.floor(hit.z);
        return x >= 0 && y >= 0 && this.map && x < this.map.width && y < this.map.height ? { x, y } : null;
    }
    dispose() { this._clear(this.world); this._clear(this.battle); this.renderer.dispose(); for (const t of this.texCache.values()) t.dispose(); }
}
