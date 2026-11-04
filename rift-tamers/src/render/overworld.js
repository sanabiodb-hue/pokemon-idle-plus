// Mapa de Caça: mundo explorável em 3D. Treinador controlável, mato alto com encontros aleatórios,
// criaturas selvagens visíveis vagando, itens no chão e cristal de cura.
import * as THREE from 'three';
import { buildIsland, makeSky, PALETTES } from './world.js';
import { buildCreature, animateCreature, disposeCreature } from './creature.js';
import { makeRng, fbm } from '../rng.js';

const HALF = 46, CELL = 1;          // grade de alturas: -HALF..HALF

function buildTrainer(colors) {
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
    const jacket = mat(colors.jacket), pants = mat('#2a2f4a'), skin = mat('#f1c7a5'), cap = mat(colors.cap), white = mat('#ffffff');
    const add = (geo, m, x, y, z, parent = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    const legs = [-1, 1].map(s => { const piv = new THREE.Group(); piv.position.set(s * 0.13, 0.62, 0); body.add(piv); add(new THREE.CapsuleGeometry(0.1, 0.38, 4, 8), pants, 0, -0.3, 0, piv); add(new THREE.BoxGeometry(0.16, 0.08, 0.26), white, 0, -0.58, 0.04, piv); return piv; });
    add(new THREE.CapsuleGeometry(0.24, 0.42, 6, 12), jacket, 0, 1.02, 0);
    const arms = [-1, 1].map(s => { const piv = new THREE.Group(); piv.position.set(s * 0.33, 1.22, 0); body.add(piv); add(new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), jacket, 0, -0.22, 0, piv); add(new THREE.SphereGeometry(0.08, 8, 6), skin, 0, -0.45, 0, piv); return piv; });
    add(new THREE.SphereGeometry(0.24, 18, 14), skin, 0, 1.55, 0);
    add(new THREE.CylinderGeometry(0.255, 0.255, 0.16, 18), cap, 0, 1.7, 0);
    add(new THREE.SphereGeometry(0.255, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), cap, 0, 1.76, 0);
    const brim = add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 18, 1, false, -Math.PI / 2, Math.PI), cap, 0, 1.66, 0.16); brim.scale.z = 1.4;
    add(new THREE.BoxGeometry(0.36, 0.42, 0.18), mat(colors.bag), 0, 1.06, -0.26);
    const emblem = add(new THREE.SphereGeometry(0.05, 10, 8), mat('#ffffff', { emissive: colors.cap, emissiveIntensity: 1.5 }), 0, 1.72, 0.25);
    void emblem;
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.035, 8, 6), mat('#1a1a2a'), s * 0.08, 1.57, 0.21);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; g.add(shadow);
    g.userData = { legs, arms, body, t: 0 };
    return g;
}

export class Overworld {
    constructor(stage3d, opts) {
        this.opts = opts; this.stage3d = stage3d;
        const type = opts.zoneType, pal = PALETTES[type] || PALETTES.bloom, q = stage3d.quality;
        this.rng = makeRng(opts.seed + ':hunt');
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
        this.scene.add(new THREE.HemisphereLight(pal.sky[2], pal.fog, 1.1));
        const sun = new THREE.DirectionalLight(0xffffff, 2.3); sun.position.set(12, 22, 8); sun.castShadow = q !== 'low';
        sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
        this.scene.add(sun); this.scene.add(sun.target); this.sun = sun;
        this.scene.fog = new THREE.FogExp2(pal.fog, 0.011);
        this.sky = makeSky(pal); this.scene.add(this.sky);
        this.island = buildIsland(type, opts.seed + ':huntmap', { radius: 38, props: q === 'low' ? 40 : 85, propMin: 9, anyAngle: true, particles: q === 'low' ? 100 : 320 });
        this.scene.add(this.island.group);
        this.R = 38 * 0.86;
        this._heights();
        this._grass(pal, q);
        // cristal de cura no centro (a clareira da arena)
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: '#ff9ad8', emissive: '#ff4fd8', emissiveIntensity: 1.6, flatShading: true, roughness: 0.2 }));
        crystal.position.set(0, this.heightAt(0, 0) + 1.6, 0); this.scene.add(crystal); this.crystal = crystal;
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 0.5, 8), new THREE.MeshStandardMaterial({ color: pal.rock, flatShading: true })); ped.position.set(0, this.heightAt(0, 0) + 0.25, 0); this.scene.add(ped);
        this.crystalLight = new THREE.PointLight('#ff4fd8', 30, 12); this.crystalLight.position.copy(crystal.position); this.scene.add(this.crystalLight);
        this.island.obstacles.push({ x: 0, z: 0, r: 1.1 });
        // treinador
        this.player = buildTrainer(opts.colors || { jacket: '#3b6bff', cap: '#ff3b5c', bag: '#ffcf5a' });
        this.player.position.set(0, this.heightAt(0, 3), 3); this.player.rotation.y = 0; this.scene.add(this.player);
        this.vel = new THREE.Vector3(); this.input = { x: 0, y: 0 }; this.keys = new Set(); this.target = null;
        this.camYaw = 0; this.camDist = 11;
        this.roamers = []; this.items = []; this.walked = 0; this.cool = 2; this.inCrystal = false; this.paused = false;
        for (let i = 0; i < (q === 'low' ? 5 : 8); i++) this._spawnRoamer();
        for (let i = 0; i < 6; i++) this._spawnItem();
        this.marker = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 24), new THREE.MeshBasicMaterial({ color: '#7af7ff', transparent: true, opacity: 0.8, depthWrite: false }));
        this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; this.scene.add(this.marker);
        this._ray = new THREE.Raycaster();
    }
    _heights() {
        const n = HALF * 2 / CELL + 1, h = new Float32Array(n * n), ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
        this.island.land.updateMatrixWorld();
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            o.set(-HALF + i * CELL, 30, -HALF + j * CELL); ray.set(o, down);
            const hit = ray.intersectObject(this.island.land, false)[0];
            h[i * n + j] = hit ? hit.point.y : -20;
        }
        this.hgrid = h; this.hn = n;
    }
    heightAt(x, z) {
        const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL, i = Math.floor(fx), j = Math.floor(fz), n = this.hn;
        if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return -20;
        const u = fx - i, v = fz - j, H = this.hgrid;
        return H[i * n + j] * (1 - u) * (1 - v) + H[(i + 1) * n + j] * u * (1 - v) + H[i * n + j + 1] * (1 - u) * v + H[(i + 1) * n + j + 1] * u * v;
    }
    grassAt(x, z) { const r = Math.hypot(x, z); return r > 5 && r < this.R - 1 && fbm(this.gseed, x * 0.09 + 20, z * 0.09 + 20, 3) > 0.53; }
    _grass(pal, q) {
        this.gseed = Math.floor(this.rng() * 1e6);
        const count = q === 'low' ? 2500 : q === 'medium' ? 6000 : 11000;
        const geo = new THREE.ConeGeometry(0.07, 0.7, 3); geo.translate(0, 0.35, 0);
        const mat = new THREE.MeshStandardMaterial({ color: pal.ground2, roughness: 0.8, emissive: pal.ground2, emissiveIntensity: 0.12 });
        mat.onBeforeCompile = (sh) => {      // balanço do vento no vertex shader
            sh.uniforms.time = this.windU = { value: 0 };
            sh.vertexShader = 'uniform float time;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat sw = sin(time * 2.0 + instanceMatrix[3].x * 0.4 + instanceMatrix[3].z * 0.3) * 0.12 * position.y;\ntransformed.x += sw; transformed.z += sw * 0.6;');
        };
        const mesh = new THREE.InstancedMesh(geo, mat, count), m = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color(), base = new THREE.Color(pal.ground2), tip = new THREE.Color(pal.accent);
        let k = 0, tries = 0;
        while (k < count && tries++ < count * 30) {
            const x = (this.rng() - 0.5) * this.R * 2, z = (this.rng() - 0.5) * this.R * 2;
            if (!this.grassAt(x, z)) continue;
            e.set((this.rng() - 0.5) * 0.4, this.rng() * 6, (this.rng() - 0.5) * 0.4); q4.setFromEuler(e);
            const s = 0.7 + this.rng() * 0.8;
            m.compose(new THREE.Vector3(x, this.heightAt(x, z) - 0.05, z), q4, new THREE.Vector3(s, s * (0.8 + this.rng() * 0.6), s));
            mesh.setMatrixAt(k, m); mesh.setColorAt(k, c.copy(base).lerp(tip, this.rng() * 0.35)); k++;
        }
        mesh.count = k; mesh.receiveShadow = true; this.scene.add(mesh); this.grass = mesh;
    }
    _randomGrassPoint(minDist = 6) {
        for (let i = 0; i < 200; i++) {
            const x = (this.rng() - 0.5) * this.R * 2, z = (this.rng() - 0.5) * this.R * 2;
            if (this.grassAt(x, z) && Math.hypot(x - this.player.position.x, z - this.player.position.z) > minDist) return new THREE.Vector3(x, this.heightAt(x, z), z);
        }
        return new THREE.Vector3(8, this.heightAt(8, 8), 8);
    }
    _spawnRoamer() {
        const g = this.opts.makeWild({ alpha: this.rng() < 0.05 });
        const m = buildCreature(g, g.alpha ? 1.25 : 0.8); m.position.copy(this._randomGrassPoint(8));
        this.scene.add(m);
        this.roamers.push({ g, m, target: m.position.clone(), wait: this.rng() * 3 });
    }
    _spawnItem() {
        const kinds = ['orbs', 'orbs', 'essence', 'dna', 'essence'], kind = kinds[Math.floor(this.rng() * kinds.length)];
        const col = { orbs: '#ff6a9a', essence: '#7af7ff', dna: '#6dffa8' }[kind];
        const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2 }));
        const p = this._randomGrassPoint(4); o.position.set(p.x, p.y + 0.5, p.z); this.scene.add(o);
        this.items.push({ o, kind });
    }
    removeRoamer(g) {
        const i = this.roamers.findIndex(r => r.g === g); if (i < 0) return;
        this.scene.remove(this.roamers[i].m); disposeCreature(this.roamers[i].m); this.roamers.splice(i, 1);
        setTimeout(() => { if (!this.disposed) this._spawnRoamer(); }, 4000);
    }
    tap(clientX, clientY) {
        const ndc = new THREE.Vector2(clientX / this.stage3d.w * 2 - 1, -(clientY / this.stage3d.h) * 2 + 1);
        this._ray.setFromCamera(ndc, this.camera);
        const hit = this._ray.intersectObject(this.island.land, false)[0];
        if (hit && Math.hypot(hit.point.x, hit.point.z) < this.R) { this.target = hit.point.clone(); this.marker.position.set(hit.point.x, hit.point.y + 0.05, hit.point.z); this.marker.visible = true; }
    }
    _collide(p) {
        const r = Math.hypot(p.x, p.z); if (r > this.R) p.multiplyScalar(this.R / r);
        for (const o of this.island.obstacles) { const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + 0.35; if (d < min && d > 1e-4) { p.x = o.x + dx / d * min; p.z = o.z + dz / d * min; } }
    }
    update(dt) {
        this.island.update(dt); this.sky.userData.mat.uniforms.time.value += dt;
        if (this.windU) this.windU.value += dt;
        const P = this.player.position, U = this.player.userData;
        // direção: teclado/joystick relativos à câmera; senão, toque/clique no chão
        let ix = this.input.x, iy = this.input.y;
        if (this.keys.has('a') || this.keys.has('arrowleft')) ix -= 1; if (this.keys.has('d') || this.keys.has('arrowright')) ix += 1;
        if (this.keys.has('w') || this.keys.has('arrowup')) iy += 1; if (this.keys.has('s') || this.keys.has('arrowdown')) iy -= 1;
        const dir = new THREE.Vector3();
        if (ix || iy) { this.target = null; this.marker.visible = false; const f = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)), rgt = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw)); dir.addScaledVector(f, iy).addScaledVector(rgt, ix); if (dir.length() > 1) dir.normalize(); }
        else if (this.target) { dir.subVectors(this.target, P); dir.y = 0; if (dir.length() < 0.25) { this.target = null; this.marker.visible = false; dir.set(0, 0, 0); } else dir.normalize(); }
        const running = this.keys.has('shift');
        const speed = (running ? 7.5 : 5) * (this.paused ? 0 : 1);
        const moving = dir.lengthSq() > 0.001 && !this.paused;
        if (moving) {
            const step = dir.clone().multiplyScalar(speed * dt); P.add(step); this._collide(P);
            const ang = Math.atan2(dir.x, dir.z); let d = ang - this.player.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); this.player.rotation.y += d * Math.min(1, dt * 12);
            if (this.grassAt(P.x, P.z)) { this.walked += step.length(); if (this.walked > 1) { this.walked = 0; if (this.cool <= 0 && this.rng() < 0.085) { this.cool = 3; this.opts.onEncounter(this.opts.makeWild({ alpha: this.rng() < 0.03, hidden: true }), null); } } }
        }
        P.y += (this.heightAt(P.x, P.z) - P.y) * Math.min(1, dt * 15);
        U.t += dt * (moving ? (running ? 14 : 10) : 2);
        U.legs.forEach((l, i) => { l.rotation.x = moving ? Math.sin(U.t + i * Math.PI) * 0.7 : 0; });
        U.arms.forEach((a, i) => { a.rotation.x = moving ? Math.sin(U.t + i * Math.PI + Math.PI) * 0.6 : Math.sin(U.t * 0.5) * 0.05; });
        U.body.position.y = moving ? Math.abs(Math.sin(U.t)) * 0.06 : Math.sin(U.t) * 0.01;
        this.cool -= dt;
        // criaturas selvagens
        for (const r of this.roamers) {
            const p = r.m.position;
            if (r.wait > 0) { r.wait -= dt; r.m.userData.anim.state = 'idle'; }
            else {
                const d = r.target.clone().sub(p); d.y = 0;
                if (d.length() < 0.3) { const a = this.rng() * Math.PI * 2; const c = new THREE.Vector3(p.x + Math.cos(a) * 4, 0, p.z + Math.sin(a) * 4); if (this.grassAt(c.x, c.z)) r.target.copy(c); r.wait = 1 + this.rng() * 3; }
                else { d.normalize(); p.addScaledVector(d, dt * 1.3); const ang = Math.atan2(d.x, d.z); let dd = ang - r.m.rotation.y; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); r.m.rotation.y += dd * Math.min(1, dt * 5); r.m.userData.anim.state = 'walk'; }
            }
            p.y = this.heightAt(p.x, p.z);
            animateCreature(r.m, dt);
            if (!this.paused && this.cool <= 0 && Math.hypot(p.x - P.x, p.z - P.z) < 1.1 + r.m.userData.size * 0.5) { this.cool = 3; this.opts.onEncounter(r.g, r); }
        }
        // itens
        for (let i = this.items.length - 1; i >= 0; i--) {
            const it = this.items[i]; it.o.rotation.y += dt * 2; it.o.position.y += Math.sin(this.island.group.id + performance.now() / 400 + i) * dt * 0.3;
            if (Math.hypot(it.o.position.x - P.x, it.o.position.z - P.z) < 0.9) { this.scene.remove(it.o); this.items.splice(i, 1); this.opts.onItem(it.kind); setTimeout(() => !this.disposed && this._spawnItem(), 20000); }
        }
        // cristal de cura
        this.crystal.rotation.y += dt; this.crystal.position.y = this.heightAt(0, 0) + 1.6 + Math.sin(performance.now() / 600) * 0.15;
        const near = Math.hypot(P.x, P.z) < 2.4;
        if (near && !this.inCrystal) this.opts.onHeal(); this.inCrystal = near;
        if (this.marker.visible) this.marker.rotation.z += dt * 2;
        // câmera em terceira pessoa (atrás e acima), com suavização
        const want = new THREE.Vector3(P.x + Math.sin(this.camYaw) * this.camDist, P.y + this.camDist * 0.78, P.z + Math.cos(this.camYaw) * this.camDist);
        this.camera.position.lerp(want, Math.min(1, dt * 4)); this.camera.lookAt(P.x, P.y + 1, P.z);
        this.sun.position.set(P.x + 12, 22, P.z + 8); this.sun.target.position.copy(P);
    }
    // posição de tela para o ícone "!" de encontro
    screenOf(obj) { const v = obj.position.clone(); v.y += 2.2; v.project(this.camera); return { x: (v.x * 0.5 + 0.5) * this.stage3d.w, y: (-v.y * 0.5 + 0.5) * this.stage3d.h }; }
    dispose() {
        this.disposed = true;
        this.scene.traverse(o => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    }
}
