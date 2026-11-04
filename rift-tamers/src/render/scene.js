// Palco 3D: renderer, pós-processamento (bloom), câmera cinematográfica, arena de batalha, Santuário e efeitos.
import * as THREE from 'three';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/jsm/postprocessing/OutputPass.js';
import { buildCreature, animateCreature, disposeCreature } from './creature.js';
import { buildIsland, makeSky, PALETTES } from './world.js';
import { TYPE_INFO } from '../data.js';
import { makeRng } from '../rng.js';

export class Stage3D {
    constructor(canvas, opts = {}) {
        this.canvas = canvas; this.opts = opts;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, opts.pixelRatio || 1.75));
        this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 900);
        this.camera.position.set(0, 7, 15);
        this.hemi = new THREE.HemisphereLight(0xbfdfff, 0x202018, 1.0); this.scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xffffff, 2.2); this.sun.position.set(8, 16, 6); this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024); Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
        this.scene.add(this.sun);
        this.rim = new THREE.PointLight(0xff66ff, 30, 40); this.rim.position.set(-6, 5, -8); this.scene.add(this.rim);
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.86);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
        this.meshes = new Map(); this.fx = []; this.mode = 'battle'; this.t = 0; this.shake = 0;
        this.camOrbit = 0; this.camTarget = new THREE.Vector3(0, 1, 0); this.focus = null; this.wander = [];
        this.quality = opts.quality || 'high';
        this.resize(); addEventListener('resize', () => this.resize());
        this._sphere = new THREE.SphereGeometry(1, 16, 12);
        this._last = performance.now(); this._frames = 0; this._fpsT = 0; this.fps = 60;
        this.setQuality(this.quality);
    }
    setQuality(q) {
        this.quality = q;
        const pr = q === 'low' ? 0.8 : q === 'medium' ? 1.1 : Math.min(devicePixelRatio || 1, 1.75);
        this.renderer.setPixelRatio(pr); this.renderer.shadowMap.enabled = q !== 'low'; this.bloom.enabled = q !== 'low';
        this.resize();
    }
    resize() {
        const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
        const flipped = this.w && ((this.h > this.w) !== (h > w));
        this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
        this.camera.aspect = w / h; this.camera.fov = w < h ? 58 : 46; this.camera.updateProjectionMatrix();
        this.w = w; this.h = h;
        if (flipped && this.mode === 'battle' && this.opts.onLayout) this.opts.onLayout();     // girou o aparelho: refaz a formação
    }
    setIsland(type, seed = 'main') {
        const key = type + ':' + seed;
        if (this.islandKey === key) return;
        this.islandKey = key;
        if (this.island) { this.scene.remove(this.island.group); this.island.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
        if (this.sky) this.scene.remove(this.sky);
        this.island = buildIsland(type, seed, { particles: this.quality === 'low' ? 80 : 260 });
        this.scene.add(this.island.group);
        const pal = PALETTES[type] || PALETTES.bloom;
        this.sky = makeSky(pal); this.scene.add(this.sky);
        this.scene.fog = new THREE.FogExp2(pal.fog, 0.012);
        this.hemi.color.set(pal.sky[2]); this.hemi.groundColor.set(pal.fog);
        this.rim.color.set(pal.accent);
        this.zoneType = type;
    }
    clearCreatures() {
        for (const m of this.meshes.values()) { this.scene.remove(m); disposeCreature(m); }
        this.meshes.clear(); this.wander = [];
    }
    // Posiciona as duas equipes frente a frente.
    showBattle(teamA, teamB) {
        this.clearCreatures(); this.mode = 'battle'; this.focus = null;
        // paisagem: equipes à esquerda/direita; retrato (celular em pé): sua equipe perto da câmera, a inimiga ao fundo
        const portrait = this.h > this.w; this.portraitLayout = portrait;
        const place = (team, side) => team.forEach((g, i) => {
            const m = buildCreature(g, 1.05);
            const n = team.length, spread = (i - (n - 1) / 2) * (portrait ? 1.7 : 2.1);
            let x, z;
            if (portrait) { x = spread; z = side < 0 ? 2.0 + (i % 2) * 0.9 : -(3.0 + (i % 2) * 0.9); }
            else { x = side * (3.0 + (i % 2) * 1.7 + Math.abs(spread) * 0.15); z = spread; }
            m.position.set(x, 0, z);
            m.lookAt(portrait ? x * 0.3 : -side * 10, 0, portrait ? side * 10 : z * 0.3);
            m.userData.home = m.position.clone(); m.userData.side = side; m.userData.portrait = portrait;
            this.scene.add(m); this.meshes.set(g.id, m);
            m.userData.anim.state = 'walk'; m.userData.enter = 0;   // entram correndo
        });
        place(teamA, -1); place(teamB, 1);
    }
    // Santuário: até 28 criaturas vagando livremente na ilha.
    showSanctuary(genomes) {
        this.clearCreatures(); this.mode = 'sanctuary';
        const rng = makeRng('sanct' + genomes.length);
        genomes.slice(0, this.quality === 'low' ? 12 : 28).forEach((g) => {
            const m = buildCreature(g, 0.9); const a = rng() * Math.PI * 2, r = 1.5 + rng() * 8;
            m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); m.rotation.y = rng() * 6;
            this.scene.add(m); this.meshes.set(g.id, m);
            this.wander.push({ m, target: m.position.clone(), wait: rng() * 3, rng });
        });
    }
    focusOn(id) { this.focus = id; }

    // ---------- efeitos ----------
    _burst(pos, color, count = 26, power = 3, size = 0.12) {
        const p = new Float32Array(count * 3), v = [];
        for (let i = 0; i < count; i++) { p.set([pos.x, pos.y, pos.z], i * 3); v.push(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9, (Math.random() - 0.5)).normalize().multiplyScalar(power * (0.4 + Math.random()))); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
        const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.scene.add(pts);
        this.fx.push({ o: pts, life: 0.9, max: 0.9, update: (f, dt) => { const a = g.attributes.position.array; for (let i = 0; i < count; i++) { v[i].y -= dt * 4; a[i * 3] += v[i].x * dt; a[i * 3 + 1] += v[i].y * dt; a[i * 3 + 2] += v[i].z * dt; } g.attributes.position.needsUpdate = true; pts.material.opacity = f.life / f.max; } });
    }
    _shockwave(pos, color, scale = 2.5) {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 48), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.1, pos.z); this.scene.add(m);
        this.fx.push({ o: m, life: 0.6, max: 0.6, update: (f) => { const k = 1 - f.life / f.max; m.scale.setScalar(1 + k * scale * 3); m.material.opacity = 1 - k; } });
    }
    _projectile(from, to, color, tier, onHit) {
        const big = tier === 'ult', mid = tier === 'art';
        const core = new THREE.Mesh(this._sphere, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const halo = new THREE.Mesh(this._sphere, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
        const s = big ? 0.26 : mid ? 0.16 : 0.1; core.scale.setScalar(s); core.add(halo); halo.scale.setScalar(1.9); halo.material.opacity = 0.45;
        this.scene.add(core);
        const light = new THREE.PointLight(color, big ? 12 : 4, 5); core.add(light);
        const start = from.clone().add(new THREE.Vector3(0, 1.1, 0)), end = to.clone().add(new THREE.Vector3(0, 1.0, 0));
        const dur = big ? 0.55 : 0.35, arc = big ? 2.2 : mid ? 1.0 : 0.4;
        const trail = [];
        this.fx.push({ o: core, life: dur, max: dur, update: (f) => {
            const k = 1 - f.life / f.max;
            core.position.lerpVectors(start, end, k); core.position.y += Math.sin(k * Math.PI) * arc;
            if (Math.random() < 0.6 && trail.length < 24) { const tm = new THREE.Mesh(this._sphere, halo.material.clone()); tm.scale.setScalar(s * 1.1); tm.position.copy(core.position); this.scene.add(tm); trail.push(tm); this.fx.push({ o: tm, life: 0.35, max: 0.35, update: (q) => { tm.material.opacity = 0.5 * q.life / q.max; tm.scale.multiplyScalar(0.96); } }); }
        }, done: () => onHit && onHit() });
    }
    // Reproduz eventos do simulador como efeitos 3D. units: battle.units (para HP).
    playEvents(events) {
        for (const e of events) {
            const src = e.src && this.meshes.get(e.src), dst = e.dst && this.meshes.get(e.dst);
            const color = e.mtype ? new THREE.Color(TYPE_INFO[e.mtype].color) : new THREE.Color(0xffffff);
            if (e.t === 'hit' || e.t === 'miss') {
                if (src) { src.userData.anim.state = 'attack'; src.userData.anim.k = 0; }
                if (src && dst) this._projectile(src.position, dst.position, color, e.tier, () => {
                    if (e.t === 'miss') { this.opts.onPopup?.('ERROU', dst, 'miss'); return; }
                    dst.userData.anim.state = 'hit'; dst.userData.anim.k = 0; dst.userData.flash = 0.25;
                    const at = dst.position.clone().add(new THREE.Vector3(0, 1, 0));
                    this._burst(at, color, e.tier === 'ult' ? 60 : 24, e.tier === 'ult' ? 5 : 3);
                    if (e.tier === 'ult' || e.crit) { this._shockwave(dst.position, color, e.tier === 'ult' ? 3 : 1.6); this.shake = Math.max(this.shake, e.tier === 'ult' ? 0.5 : 0.25); }
                    this.opts.onPopup?.(e.dmg, dst, e.crit ? 'crit' : e.eff > 1 ? 'super' : e.eff < 1 ? 'weak' : 'hit', e);
                });
            } else if (e.t === 'dot' && dst) { this._burst(dst.position.clone().add(new THREE.Vector3(0, 1, 0)), e.status === 'burn' ? 0xff7a2a : 0xd64cff, 10, 1.5); this.opts.onPopup?.(e.dmg, dst, 'dot'); }
            else if (e.t === 'heal' && dst) { this._burst(dst.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0x7dff9a, 18, 2); this.opts.onPopup?.('+' + e.amount, dst, 'heal'); }
            else if (e.t === 'status' && dst) { this._shockwave(dst.position, 0xffffff, 0.8); this.opts.onPopup?.(e.status, dst, 'status'); }
            else if (e.t === 'faint' && dst) { setTimeout(() => { dst.userData.anim.state = 'faint'; dst.userData.anim.k = 0; this._burst(dst.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xffffff, 40, 2.5, 0.09); }, 380); }
            else if (e.t === 'sync') { for (const m of this.meshes.values()) if (m.userData.side === -1) { this._shockwave(m.position, 0x7af7ff, 2.2); this._burst(m.position.clone().add(new THREE.Vector3(0, 1, 0)), 0x7af7ff, 40, 3.5); } this.shake = 0.6; }
        }
    }
    // Âncoras na tela (px CSS) para barras de vida e números de dano.
    anchor(obj, yOff = 2.3) {
        const v = obj.position.clone(); v.y += yOff * (obj.userData.size || 1);
        v.project(this.camera);
        return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, visible: v.z < 1 && obj.visible };
    }
    anchors() { const out = {}; for (const [id, m] of this.meshes) out[id] = this.anchor(m); return out; }

    // ---------- loop ----------
    render() {
        const now = performance.now(), dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;
        this.t += dt; this._frames++; this._fpsT += dt;
        if (this._fpsT > 1) { this.fps = this._frames / this._fpsT; this._frames = 0; this._fpsT = 0; }
        this.island?.update(dt);
        if (this.sky) this.sky.userData.mat.uniforms.time.value = this.t;
        for (const m of this.meshes.values()) {
            if (m.userData.enter !== undefined) {   // corrida de entrada até a posição
                m.userData.enter += dt * 1.6; const k = Math.min(1, m.userData.enter);
                const off = 8 * (1 - k) * (1 - k);
                if (m.userData.portrait) m.position.z = m.userData.home.z - m.userData.side * off; else m.position.x = m.userData.home.x + m.userData.side * off;
                if (k >= 1) { delete m.userData.enter; m.userData.anim.state = 'idle'; }
            }
            animateCreature(m, dt);
        }
        for (const w of this.wander) {
            const p = w.m.position;
            if (w.wait > 0) { w.wait -= dt; w.m.userData.anim.state = 'idle'; }
            else {
                const d = w.target.clone().sub(p); d.y = 0;
                if (d.length() < 0.2) { const a = w.rng() * Math.PI * 2, r = 1.5 + w.rng() * 8.5; w.target.set(Math.cos(a) * r, 0, Math.sin(a) * r); w.wait = 1 + w.rng() * 4; }
                else { d.normalize(); p.addScaledVector(d, dt * 1.1); const ang = Math.atan2(d.x, d.z); w.m.rotation.y += ((ang - w.m.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 5); w.m.userData.anim.state = 'walk'; }
            }
        }
        for (let i = this.fx.length - 1; i >= 0; i--) {
            const f = this.fx[i]; f.life -= dt; f.update?.(f, dt);
            if (f.life <= 0) { f.done?.(); this.scene.remove(f.o); f.o.geometry !== this._sphere && f.o.geometry?.dispose(); f.o.material?.dispose?.(); this.fx.splice(i, 1); }
        }
        // câmera: órbita lenta, foco opcional, tremor nos impactos
        this.camOrbit += dt * (this.mode === 'sanctuary' ? 0.06 : 0.035);
        const portrait = this.h > this.w;
        let dist = this.mode === 'sanctuary' ? (portrait ? 28 : 19) : portrait ? 19 : 14, height = this.mode === 'sanctuary' ? (portrait ? 13 : 9) : portrait ? 10 : 7;
        const target = new THREE.Vector3(0, portrait && this.mode === 'battle' ? 0.2 : 1, 0);
        if (this.focus && this.meshes.get(this.focus)) { const f = this.meshes.get(this.focus); target.copy(f.position).add(new THREE.Vector3(0, 1, 0)); dist = 6; height = 2.6; }
        this.camTarget.lerp(target, Math.min(1, dt * 2.5));
        const ang = Math.sin(this.camOrbit) * (this.mode === 'sanctuary' ? Math.PI : portrait ? 0.22 : 0.42);
        const want = new THREE.Vector3(this.camTarget.x + Math.sin(ang) * dist, height + Math.sin(this.t * 0.3) * 0.3, this.camTarget.z + Math.cos(ang) * dist);
        this.camera.position.lerp(want, Math.min(1, dt * 2));
        if (this.shake > 0) { this.shake -= dt; this.camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), 0).multiplyScalar(this.shake * 0.5)); }
        this.camera.lookAt(this.camTarget);
        if (this.quality === 'low') this.renderer.render(this.scene, this.camera); else this.composer.render(dt);
        return dt;
    }
}

// Retratos 3D (miniaturas) gerados num renderer separado e guardados em cache como dataURL.
let portraitRenderer = null, portraitScene = null, portraitCam = null;
const portraitCache = new Map();
export function portrait(g, size = 128) {
    const key = g.id + ':' + g.prismatic + ':' + size;
    if (portraitCache.has(key)) return portraitCache.get(key);
    if (!portraitRenderer) {
        const c = document.createElement('canvas'); c.width = c.height = size;
        portraitRenderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
        portraitRenderer.setPixelRatio(1); portraitRenderer.setSize(size, size, false);
        portraitRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        portraitScene = new THREE.Scene();
        portraitScene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
        const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(2, 3, 4); portraitScene.add(d);
        portraitCam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    }
    const m = buildCreature(g, 1); m.scale.setScalar(1); m.rotation.y = -0.55;
    portraitScene.add(m);
    const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z);
    portraitCam.position.set(c.x + r * 0.35, c.y + r * 0.25, c.z + r * 2.3); portraitCam.lookAt(c);
    portraitRenderer.render(portraitScene, portraitCam);
    const url = portraitRenderer.domElement.toDataURL('image/png');
    portraitScene.remove(m); disposeCreature(m);
    if (portraitCache.size > 400) portraitCache.delete(portraitCache.keys().next().value);
    portraitCache.set(key, url);
    return url;
}
