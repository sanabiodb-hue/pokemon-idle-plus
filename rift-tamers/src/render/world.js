// Ilhas flutuantes procedurais por bioma, céu em gradiente com estrelas, partículas e ilhotas ao redor.
import * as THREE from 'three';
import { makeRng, fbm } from '../rng.js';

export const PALETTES = {
    bloom: { sky: ['#0b2a2a', '#1f6b55', '#a8f0c6'], ground: '#3fa865', ground2: '#2b7d4b', rock: '#5b4a3b', prop: 'tree', fx: '#b8ff8a', fog: '#16443a', accent: '#7dffb0' },
    tide: { sky: ['#06182e', '#155a8a', '#9fe3ff'], ground: '#e6d6a8', ground2: '#3fb2b8', rock: '#6f7b86', prop: 'palm', fx: '#9fe3ff', fog: '#0f3a5c', accent: '#5fd8ff', water: true },
    ember: { sky: ['#1a0505', '#7a1d0d', '#ffb56b'], ground: '#3b2422', ground2: '#ff5a1f', rock: '#2a1a18', prop: 'vent', fx: '#ff8a3d', fog: '#3b0e08', accent: '#ff6a2d', lava: true },
    volt: { sky: ['#0d0d22', '#3b2d7a', '#ffe98a'], ground: '#5b4e8a', ground2: '#ffe14a', rock: '#3a3355', prop: 'pylon', fx: '#fff27a', fog: '#1d1840', accent: '#ffe14a' },
    stone: { sky: ['#1b140d', '#6b4a2b', '#f2c98a'], ground: '#a67c52', ground2: '#7a5636', rock: '#5e4630', prop: 'mesa', fx: '#f2c98a', fog: '#3a2a1a', accent: '#ffcf8a' },
    frost: { sky: ['#081624', '#2d5d7c', '#e8fbff'], ground: '#eaf6ff', ground2: '#a6d8f0', rock: '#8fb4c9', prop: 'icicle', fx: '#ffffff', fog: '#2a4a60', accent: '#bff4ff' },
    gale: { sky: ['#0a1f26', '#2f8a86', '#d8fff0'], ground: '#9ad8a8', ground2: '#d8f5e0', rock: '#7a9a8a', prop: 'windmill', fx: '#d8fff0', fog: '#1d4a48', accent: '#9cf2c8' },
    venom: { sky: ['#14051a', '#5a1a6b', '#ff7ad8'], ground: '#3a2a45', ground2: '#c23cff', rock: '#2a1f33', prop: 'shroom', fx: '#e070ff', fog: '#2a0d33', accent: '#d64cff' },
    lumen: { sky: ['#1a1530', '#c27a9a', '#fff3c4'], ground: '#f4e9d0', ground2: '#ffd36b', rock: '#cbb994', prop: 'pillar', fx: '#fff3c4', fog: '#5a3a5a', accent: '#ffe9a8' },
    umbra: { sky: ['#03020a', '#22104a', '#7a4cff'], ground: '#221a3a', ground2: '#6a3cff', rock: '#140f24', prop: 'obelisk', fx: '#a07aff', fog: '#0c0620', accent: '#8a5cff' },
    rift: { sky: ['#05010f', '#2a0d4a', '#ff4fd8'], ground: '#1e1238', ground2: '#ff4fd8', rock: '#120a22', prop: 'obelisk', fx: '#ff8ae8', fog: '#12051f', accent: '#ff4fd8' },
};

export function makeSky(pal) {
    const g = new THREE.SphereGeometry(400, 32, 16);
    const m = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { top: { value: new THREE.Color(pal.sky[0]) }, mid: { value: new THREE.Color(pal.sky[1]) }, bot: { value: new THREE.Color(pal.sky[2]) }, time: { value: 0 } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform float time; varying vec3 vP;
            float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
            void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.7, y)) : mix(mid, bot, smoothstep(0.0, -0.5, y));
              vec3 q = floor(vP * 180.0); float s = step(0.996, h(q)) * smoothstep(0.05, 0.5, y); c += s * (0.6 + 0.4 * sin(time * 2.0 + h(q) * 40.0));
              float band = exp(-pow((y - 0.18 - 0.05 * sin(vP.x * 4.0 + time * 0.1)) * 9.0, 2.0)) * 0.25; c += band * bot;
              gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(g, m); sky.userData.mat = m; return sky;
}

function islandGeometry(seed, radius, height, segs = 128) {
    // malha polar (anéis × segmentos): borda circular lisa, topo com relevo suave e base pendurada como rocha flutuante
    const rings = 44, pos = [], idx = [];
    const outer = radius * 1.28;
    for (let i = 0; i <= rings; i++) {
        const rr = Math.pow(i / rings, 1.15) * outer;
        for (let j = 0; j < segs; j++) {
            const ang = j / segs * Math.PI * 2, x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
            const n = fbm(seed, x * 0.08 + 50, z * 0.08 + 50, 4);
            const edge = radius * (0.9 + 0.18 * (fbm(seed + 7, Math.cos(ang) * 2 + 10, Math.sin(ang) * 2 + 10, 3) - 0.5));
            let y;
            if (rr < edge) {
                const k = rr / edge;
                y = (n - 0.45) * 2.2 * Math.pow(k, 1.8) + (1 - k * k) * 0.2;
                if (rr < radius * 0.42) y *= 0.12;          // arena plana no centro
            } else {
                const k = Math.min(1, (rr - edge) / (outer - edge));
                y = -Math.pow(k, 1.6) * height * (0.7 + n * 0.9) - k * 0.4;
            }
            pos.push(x, y, z);
        }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
        const a = i * segs + j, b = i * segs + (j + 1) % segs, c = (i + 1) * segs + j, d = (i + 1) * segs + (j + 1) % segs;
        idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
}

function colorize(geom, pal, seed) {
    const pos = geom.attributes.position, n = pos.count, col = new Float32Array(n * 3);
    const g1 = new THREE.Color(pal.ground), g2 = new THREE.Color(pal.ground2), rock = new THREE.Color(pal.rock), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const t = fbm(seed + 3, x * 0.15, z * 0.15, 3);
        c.copy(g1).lerp(g2, Math.max(0, Math.min(1, (t - 0.4) * 2.5)));
        if (y < -0.3) c.copy(rock).lerp(new THREE.Color(pal.fog), Math.min(1, -y / 12));
        col.set([c.r, c.g, c.b], i * 3);
    }
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function prop(kind, pal, rng) {
    const grp = new THREE.Group();
    const acc = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 0.9, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: pal.rock, roughness: 0.85, flatShading: true });
    const leaf = new THREE.MeshStandardMaterial({ color: pal.ground2, roughness: 0.6, flatShading: true });
    const h = 1 + rng() * 1.6;
    const add = (geo, m, y, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.scale.set(sx, sy, sz); o.castShadow = true; o.receiveShadow = true; grp.add(o); return o; };
    switch (kind) {
        case 'tree': add(new THREE.CylinderGeometry(0.12, 0.18, h, 6), dark, h / 2); add(new THREE.IcosahedronGeometry(0.9, 0), leaf, h + 0.5, 1, 1.2, 1); add(new THREE.SphereGeometry(0.09, 8, 6), acc, h + 0.2 + rng() * 0.6, 1).position.x = 0.5; break;
        case 'palm': add(new THREE.CylinderGeometry(0.1, 0.16, h * 1.5, 6), dark, h * 0.75); for (let i = 0; i < 5; i++) { const f = add(new THREE.ConeGeometry(0.25, 1.4, 4), leaf, h * 1.5); f.rotation.z = 1.2; f.rotation.y = i * 1.25; } break;
        case 'vent': add(new THREE.ConeGeometry(0.7, h, 7), dark, h / 2); add(new THREE.SphereGeometry(0.28, 10, 8), acc, h); break;
        case 'pylon': add(new THREE.CylinderGeometry(0.08, 0.15, h * 2, 5), dark, h); add(new THREE.OctahedronGeometry(0.3, 0), acc, h * 2 + 0.2); break;
        case 'mesa': add(new THREE.CylinderGeometry(0.6 + rng(), 0.9 + rng(), h, 7), dark, h / 2); break;
        case 'icicle': add(new THREE.ConeGeometry(0.35, h * 2, 6), new THREE.MeshPhysicalMaterial({ color: '#dff7ff', roughness: 0.05, transmission: 0.6, thickness: 1, flatShading: true }), h); break;
        case 'windmill': add(new THREE.CylinderGeometry(0.1, 0.2, h * 1.8, 6), dark, h * 0.9); { const b = add(new THREE.BoxGeometry(1.8, 0.12, 0.05), acc, h * 1.8); b.userData.spin = 1.5 + rng(); const b2 = b.clone(); b2.rotation.z = Math.PI / 2; b.add(b2); b2.position.set(0, 0, 0); b2.scale.set(1, 1, 1); } break;
        case 'shroom': add(new THREE.CylinderGeometry(0.1, 0.15, h, 6), new THREE.MeshStandardMaterial({ color: '#e8d6ff' }), h / 2); add(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), acc, h); break;
        case 'pillar': add(new THREE.CylinderGeometry(0.25, 0.3, h * 2, 10), new THREE.MeshStandardMaterial({ color: '#fff7e6', roughness: 0.4 }), h); add(new THREE.TorusGeometry(0.4, 0.05, 6, 24), acc, h * 2 + 0.3).rotation.x = Math.PI / 2; break;
        case 'obelisk': add(new THREE.ConeGeometry(0.4, h * 2.4, 4), dark, h * 1.2); add(new THREE.OctahedronGeometry(0.22, 0), acc, h * 2.6).userData.float = true; break;
    }
    return grp;
}

// Ilha completa de um bioma. Devolve { group, update(dt) }.
export function buildIsland(type, seedStr = 'island', opts = {}) {
    const pal = PALETTES[type] || PALETTES.bloom, rng = makeRng(seedStr + type), seed = Math.floor(rng() * 1e6);
    const group = new THREE.Group();
    const R = opts.radius || 18;
    const geom = islandGeometry(seed, R, 9); colorize(geom, pal, seed);
    const land = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }));
    land.receiveShadow = true; group.add(land);
    // anel de arena com runas brilhantes
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 5.85, 96), new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; group.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.3, 6), ring.material.clone()); ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.06; group.add(ring2);
    // adereços fora da arena
    const props = [];
    const count = opts.props ?? 26;
    for (let i = 0; i < count; i++) {
        // nada de adereços no setor da câmera (frente, +Z): o cenário emoldura a arena sem tapar a luta
        let a = rng() * Math.PI * 2, r = 7 + rng() * (R * 0.8 - 7);
        const toCam = Math.abs(((a - Math.PI / 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        if (toCam < 1.15) a += (a > Math.PI / 2 ? 1 : -1) * (1.15 - toCam + 0.2);
        const p = prop(pal.prop, pal, rng); p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); p.rotation.y = rng() * 6; p.scale.setScalar(0.7 + rng() * 0.6);
        group.add(p); props.push(p);
    }
    // cristais flutuando sob a ilha
    for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.4 + rng() * 0.6, 0), new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 1.2, flatShading: true }));
        const a = rng() * Math.PI * 2; c.position.set(Math.cos(a) * (R * 0.5), -5 - rng() * 6, Math.sin(a) * (R * 0.5)); c.userData.float = true; group.add(c); props.push(c);
    }
    // água / lava em volta (planos com brilho)
    if (pal.water || pal.lava) {
        const wm = new THREE.MeshPhysicalMaterial({ color: pal.lava ? '#ff4a10' : '#1aa6d8', emissive: pal.lava ? '#ff3a00' : '#0a3a5a', emissiveIntensity: pal.lava ? 1.4 : 0.4, roughness: 0.1, transmission: pal.lava ? 0 : 0.3, transparent: true, opacity: 0.85 });
        const water = new THREE.Mesh(new THREE.RingGeometry(R * 0.92, R * 1.6, 64), wm); water.rotation.x = -Math.PI / 2; water.position.y = -0.35; group.add(water);
        water.userData.wave = true; props.push(water);
    }
    // partículas de ambiente
    const n = opts.particles ?? 260, pp = new Float32Array(n * 3), spd = new Float32Array(n);
    for (let i = 0; i < n; i++) { pp[i * 3] = (rng() - 0.5) * R * 2.4; pp[i * 3 + 1] = rng() * 10; pp[i * 3 + 2] = (rng() - 0.5) * R * 2.4; spd[i] = 0.2 + rng() * 0.6; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: pal.fx, size: 0.09, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(pts);
    // ilhotas distantes
    for (let i = 0; i < 7; i++) {
        const sg = islandGeometry(seed + i * 13, 2 + rng() * 3, 4, 36); colorize(sg, pal, seed + i);
        const s = new THREE.Mesh(sg, land.material); const a = i / 7 * Math.PI * 2 + rng();
        s.position.set(Math.cos(a) * (32 + rng() * 25), -4 + rng() * 14, Math.sin(a) * (32 + rng() * 25)); s.userData.float = true; s.userData.phase = rng() * 6;
        group.add(s); props.push(s);
    }
    let t = 0;
    const update = (dt) => {
        t += dt;
        ring.material.opacity = 0.4 + Math.sin(t * 1.5) * 0.15; ring2.rotation.z += dt * 0.4;
        const a = pg.attributes.position.array;
        for (let i = 0; i < n; i++) {
            a[i * 3 + 1] += spd[i] * dt * (type === 'frost' ? -0.8 : 0.6);
            a[i * 3] += Math.sin(t + i) * dt * 0.2;
            if (a[i * 3 + 1] > 10) a[i * 3 + 1] = 0; if (a[i * 3 + 1] < 0) a[i * 3 + 1] = 10;
        }
        pg.attributes.position.needsUpdate = true;
        for (const p of props) {
            if (p.userData.float) p.position.y += Math.sin(t * 0.8 + (p.userData.phase || p.position.x)) * dt * 0.15;
            if (p.userData.wave) p.material.emissiveIntensity = (pal.lava ? 1.2 : 0.35) + Math.sin(t * 2) * 0.2;
            p.traverse?.(c => { if (c.userData.spin) c.rotation.z += dt * c.userData.spin; if (c.userData.float) c.rotation.y += dt; });
        }
    };
    return { group, update, pal };
}
