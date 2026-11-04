// Constrói o modelo 3D de uma criatura a partir do genoma (100% procedural: nenhum modelo externo).
// Frente da criatura = +Z. A animação é controlada por userData.anim (idle, walk, attack, hit, faint).
import * as THREE from 'three';
import { makeRng, valueNoise } from '../rng.js';
import { RARITY_INDEX, evoStage } from '../genome.js';

const geoCache = new Map();
function geo(key, make) { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; }
const hsl = (h, s, l) => new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l);

// Pinta a geometria (cópia) com vértice colorido segundo o padrão do genoma.
function paint(geometry, g, seedSalt = 0) {
    const geom = geometry.clone();
    const pos = geom.attributes.position, n = pos.count, colors = new Float32Array(n * 3);
    const L = g.look, c1 = hsl(L.hue, L.sat, L.light), c2 = hsl(L.hue2, L.sat * 0.9, Math.min(0.8, L.light + 0.15)), belly = hsl(L.hue, L.sat * 0.35, 0.82);
    const seed = (g.seed.length * 31 + seedSalt) | 0, tmp = new THREE.Color();
    geom.computeBoundingBox();
    const bb = geom.boundingBox, hy = bb.max.y - bb.min.y || 1;
    for (let i = 0; i < n; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const ny = (y - bb.min.y) / hy;
        let t = 0;
        switch (L.pattern) {
            case 'spots': t = valueNoise(seed, x * 5 + 10, z * 5 + y * 5) > 0.68 ? 1 : 0; break;
            case 'stripes': t = Math.sin((y + x * 0.3) * 18) > 0.35 ? 1 : 0; break;
            case 'gradient': t = ny; break;
            case 'rings': t = Math.sin(Math.hypot(x, z) * 22) > 0.5 ? 1 : 0; break;
            default: t = 0;
        }
        tmp.copy(c1).lerp(c2, t);
        if (z > 0.15 && ny < 0.55 && L.pattern !== 'gradient') tmp.lerp(belly, 0.45);       // barriga clara
        colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
}

function bodyMaterial(g) {
    const L = g.look, ri = RARITY_INDEX[g.rarity];
    const m = new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: g.body === 'crystal' ? 0.15 : 0.55, metalness: g.body === 'crystal' ? 0.1 : 0.0,
        clearcoat: ri >= 2 ? 0.8 : 0.3, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: hsl(L.hue2, 0.8, 0.7),
        emissive: hsl(L.hue, 0.9, 0.5), emissiveIntensity: L.glow * 0.18,
        flatShading: g.body === 'crystal', transmission: g.body === 'crystal' ? 0.25 : 0, thickness: 0.6,
    });
    if (g.prismatic) {
        m.iridescence = 1; m.iridescenceIOR = 1.8; m.iridescenceThicknessRange = [200, 900];
    }
    return m;
}

function addEyes(group, g, head, radius, rng, root) {
    const n = g.look.eyes, white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, emissive: 0x222222 });
    const pupilColor = g.prismatic ? hsl(rng() * 360, 1, 0.5) : g.types.includes('umbra') ? new THREE.Color(0xff2244) : new THREE.Color(0x0a0a14);
    const pupil = new THREE.MeshStandardMaterial({ color: pupilColor, roughness: 0.1, emissive: pupilColor, emissiveIntensity: g.types.includes('umbra') ? 1.5 : 0.1 });
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eg = geo('eye', () => new THREE.SphereGeometry(1, 16, 12)), sg = geo('shine', () => new THREE.SphereGeometry(1, 8, 6));
    const er = radius * (n === 1 ? 0.36 : 0.24);
    for (let i = 0; i < n; i++) {
        const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * radius * (n === 3 ? 1.2 : 0.95);
        const yOff = n === 3 && i === 1 ? radius * 0.28 : radius * 0.12;
        const e = new THREE.Mesh(eg, white); e.scale.setScalar(er);
        e.position.set(head.x + spread, head.y + yOff, head.z + radius * 0.82);
        const p = new THREE.Mesh(eg, pupil); p.scale.setScalar(0.55); p.position.set(0, 0, 0.62); e.add(p);
        const s = new THREE.Mesh(sg, shine); s.scale.setScalar(0.18); s.position.set(0.3, 0.35, 0.92); e.add(s);
        group.add(e);
        root.userData.eyes.push(e);
    }
}

// Monta e devolve um THREE.Group. scale: tamanho base em unidades do mundo.
export function buildCreature(g, scale = 1) {
    const rng = makeRng('mesh:' + g.seed);
    const evo = evoStage(g);
    const L0 = g.look, L = evo ? { ...L0, horns: Math.min(3, L0.horns + evo), spikes: L0.spikes + evo * 2, crest: L0.crest || evo >= 1, wings: L0.wings || (evo >= 2 && g.body !== 'quad' ? 2 : 0), glow: Math.min(1, L0.glow + evo * 0.15), tail: Math.min(5, L0.tail + evo) } : L0;
    g = L === L0 ? g : { ...g, look: L };
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    root.userData = { g, eyes: [], wings: [], legs: [], tail: [], anim: { state: 'idle', t: rng() * 10, k: 0, base: new THREE.Vector3() }, body };
    const mat = bodyMaterial(g);
    const accent = new THREE.MeshStandardMaterial({ color: hsl(L.hue2, 0.75, 0.62), roughness: 0.35, emissive: hsl(L.hue2, 1, 0.5), emissiveIntensity: L.glow * 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: hsl(L.hue, 0.4, 0.22), roughness: 0.6 });
    const sphere = geo('sph', () => new THREE.SphereGeometry(1, 40, 28));
    const cone = geo('cone', () => new THREE.ConeGeometry(1, 1, 14));
    let head = new THREE.Vector3(0, 0.95, 0), headR = 0.42, backY = 0.9, tailBase = new THREE.Vector3(0, 0.6, -0.6), legY = 0.35;

    const mk = (geometry, m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(geometry, m); o.position.set(x, y, z); o.scale.set(sx, sy ?? sx, sz ?? sx); o.castShadow = true; body.add(o); return o; };
    const st = L.stretch;
    switch (g.body) {
        case 'orb': {
            mk(paint(sphere, g), mat, 0, 0.62, 0, 0.62, 0.6 * st, 0.62);
            head.set(0, 0.72, 0.1); headR = 0.5; backY = 1.15; tailBase.set(0, 0.5, -0.55); legY = 0.18;
            // "orelhas" ou antenas
            for (const s of [-1, 1]) { const a = mk(sphere, accent, s * 0.34, 1.22, 0, 0.12, 0.28, 0.12); a.rotation.z = -s * 0.5; }
            break;
        }
        case 'quad': {
            mk(paint(sphere, g), mat, 0, 0.75, -0.1, 0.5, 0.42, 0.75 * st);
            mk(paint(sphere, g, 1), mat, 0, 1.08, 0.62, 0.36, 0.34, 0.36);
            head.set(0, 1.12, 0.65); headR = 0.36; backY = 1.12; tailBase.set(0, 0.85, -0.82); legY = 0.42;
            mk(sphere, accent, 0, 1.0, 0.95, 0.16, 0.12, 0.12);      // focinho
            for (const s of [-1, 1]) { const ear = mk(cone, accent, s * 0.2, 1.48, 0.55, 0.11, 0.3, 0.06); ear.rotation.z = -s * 0.35; }
            break;
        }
        case 'serpent': {
            const pts = [];
            for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector3(Math.sin(t * Math.PI * 2) * 0.35, 0.25 + t * 0.9 * st, -0.9 + t * 1.2)); }
            const curve = new THREE.CatmullRomCurve3(pts);
            const tube = new THREE.TubeGeometry(curve, 48, 0.22, 16, false);
            const o = new THREE.Mesh(paint(tube, g), mat); o.castShadow = true; body.add(o);
            const end = pts[pts.length - 1];
            mk(paint(sphere, g, 2), mat, end.x, end.y + 0.08, end.z + 0.12, 0.36, 0.3, 0.42);
            head.set(end.x, end.y + 0.1, end.z + 0.15); headR = 0.34; backY = end.y + 0.32; tailBase.set(pts[0].x, pts[0].y, pts[0].z); legY = 0;
            mk(sphere, accent, end.x, end.y + 0.42, end.z - 0.05, 0.08, 0.22, 0.08);
            break;
        }
        case 'biped': {
            mk(paint(sphere, g), mat, 0, 0.95, 0, 0.44, 0.58 * st, 0.4);
            mk(paint(sphere, g, 1), mat, 0, 1.68 * Math.min(1.15, st), 0.05, 0.38);
            head.set(0, 1.7 * Math.min(1.15, st), 0.08); headR = 0.38; backY = 1.5; tailBase.set(0, 0.7, -0.38); legY = 0.45;
            for (const s of [-1, 1]) { const arm = mk(sphere, mat, s * 0.5, 1.05, 0.1, 0.12, 0.3, 0.12); arm.rotation.z = s * 0.6; root.userData.legs.push({ o: arm, s, arm: true }); }
            break;
        }
        case 'avian': {
            mk(paint(sphere, g), mat, 0, 0.9, 0, 0.42, 0.5, 0.48 * st);
            mk(paint(sphere, g, 1), mat, 0, 1.45, 0.25, 0.3);
            head.set(0, 1.48, 0.28); headR = 0.3; backY = 1.25; tailBase.set(0, 0.85, -0.45); legY = 0.48;
            const beak = mk(cone, accent, 0, 1.42, 0.62, 0.09, 0.25, 0.09); beak.rotation.x = Math.PI / 2;
            break;
        }
        case 'crystal': {
            const ico = geo('ico', () => new THREE.IcosahedronGeometry(1, 0));
            mk(paint(ico, g), mat, 0, 0.9, 0, 0.55, 0.75 * st, 0.55);
            mk(paint(geo('oct', () => new THREE.OctahedronGeometry(1, 0)), g, 1), mat, 0, 1.75, 0.05, 0.3, 0.38, 0.3);
            head.set(0, 1.72, 0.05); headR = 0.3; backY = 1.6; tailBase.set(0, 0.6, -0.4); legY = 0.3;
            const shardG = geo('shard', () => new THREE.OctahedronGeometry(1, 0));
            const ring = new THREE.Group(); ring.position.y = 1.0; body.add(ring); root.userData.ring = ring;
            for (let i = 0; i < 5; i++) { const sh = new THREE.Mesh(shardG, accent); const a = i / 5 * Math.PI * 2; sh.position.set(Math.cos(a) * 0.95, Math.sin(i) * 0.2, Math.sin(a) * 0.95); sh.scale.set(0.08, 0.2, 0.08); ring.add(sh); }
            break;
        }
    }
    addEyes(body, g, head, headR, rng, root);
    // chifres
    for (let i = 0; i < L.horns; i++) {
        const s = L.horns === 1 ? 0 : (i === 0 ? -1 : 1);
        const h = mk(cone, accent, head.x + s * headR * 0.45, head.y + headR * 0.85, head.z - 0.02, 0.07, 0.35 + rng() * 0.2, 0.07);
        h.rotation.z = -s * 0.35; h.rotation.x = -0.25;
    }
    // crista e espinhos nas costas
    if (L.crest) { const c = mk(cone, accent, head.x, head.y + headR * 0.95, head.z - headR * 0.3, 0.05, 0.5, 0.22); c.rotation.x = -0.6; }
    for (let i = 0; i < L.spikes; i++) {
        const z = 0.25 - i * 0.22; const sp = mk(cone, accent, 0, backY - i * 0.03, z, 0.07, 0.24, 0.07); sp.rotation.x = -0.45;
    }
    // pernas
    const legG = geo('leg', () => new THREE.CapsuleGeometry(0.1, 0.32, 4, 10));
    const legsN = g.body === 'serpent' ? 0 : L.legs;
    for (let i = 0; i < legsN; i++) {
        const front = legsN === 4 ? (i < 2 ? 1 : -1) : 0, side = i % 2 === 0 ? -1 : 1;
        const leg = new THREE.Mesh(legG, dark); leg.castShadow = true;
        leg.position.set(side * 0.28, legY, front * 0.42); body.add(leg);
        root.userData.legs.push({ o: leg, s: side * (front || 1), y: legY });
    }
    // asas
    if (L.wings) {
        const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(0.3, 0.6, 1.0, 0.7, 1.25, 0.25); shape.bezierCurveTo(0.9, 0.15, 0.6, -0.2, 0, -0.05);
        const wg = geo('wing', () => new THREE.ShapeGeometry(shape, 12));
        const wm = new THREE.MeshStandardMaterial({ color: hsl(L.hue2, 0.7, 0.65), side: THREE.DoubleSide, transparent: true, opacity: 0.82, emissive: hsl(L.hue2, 1, 0.5), emissiveIntensity: L.glow * 0.6, roughness: 0.4 });
        for (const s of [-1, 1]) {
            const piv = new THREE.Group(); piv.position.set(s * 0.25, backY - 0.1, -0.05);
            const w = new THREE.Mesh(wg, wm); w.scale.set(s * 0.9, 0.9, 0.9); w.rotation.y = s * 0.2; piv.add(w);
            body.add(piv); root.userData.wings.push({ o: piv, s });
        }
    }
    // cauda segmentada
    let prev = body;
    for (let i = 0; i < L.tail; i++) {
        const seg = new THREE.Group(); seg.position.copy(i === 0 ? tailBase : new THREE.Vector3(0, 0.05, -0.22));
        const ball = new THREE.Mesh(sphere, i === L.tail - 1 ? accent : mat.clone()); ball.scale.setScalar(0.16 - i * 0.025);
        if (i < L.tail - 1) { ball.material = new THREE.MeshStandardMaterial({ color: hsl(L.hue, L.sat, L.light), roughness: 0.5 }); }
        seg.add(ball); prev.add(seg); prev = seg; root.userData.tail.push(seg);
    }
    // aura de raridade
    const ri = RARITY_INDEX[g.rarity];
    if (ri >= 2 || g.prismatic || g.boss) {
        const auraColor = g.prismatic ? 0xffffff : [0, 0, 0xb36bff, 0xffb347, 0xff4fa3][ri] || 0xff4444;
        const ringG = geo('aura', () => new THREE.RingGeometry(0.7, 0.95, 48));
        const aura = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: auraColor, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        aura.rotation.x = -Math.PI / 2; aura.position.y = 0.03; root.add(aura); root.userData.aura = aura;
    }
    if (g.prismatic) {
        const n = 40, p = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const a = rng() * Math.PI * 2, r = 0.6 + rng() * 0.6; p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = rng() * 2; p[i * 3 + 2] = Math.sin(a) * r; }
        const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(p, 3));
        const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.08, color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        root.add(pts); root.userData.sparkles = pts;
        root.userData.prismMat = mat;
    }
    // sombra de contato barata
    const shadowG = geo('blob', () => new THREE.CircleGeometry(0.75, 24));
    const blob = new THREE.Mesh(shadowG, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; root.add(blob);

    // halo de evolução final: anel de luz flutuando atrás da cabeça
    if (evo >= 2) {
        const halo = new THREE.Mesh(geo('halo', () => new THREE.TorusGeometry(0.42, 0.035, 8, 48)), new THREE.MeshBasicMaterial({ color: hsl(L.hue2, 1, 0.7), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        halo.position.set(head.x, head.y + headR * 0.6, head.z - headR * 1.1); body.add(halo); root.userData.halo = halo;
    }
    const sz = L.size * scale * (g.boss ? 1.6 : 1) * (1 + ri * 0.05) * [1, 1.18, 1.36][evo];
    root.scale.setScalar(sz);
    root.userData.size = sz;
    root.userData.mat = mat;
    return root;
}

// Anima um frame. dt em segundos.
export function animateCreature(o, dt) {
    const u = o.userData, a = u.anim;
    a.t += dt;
    const t = a.t, body = u.body;
    let bob = Math.sin(t * 2.4) * 0.04, lean = 0, push = 0;
    if (a.state === 'walk') bob = Math.abs(Math.sin(t * 9)) * 0.08;
    if (a.state === 'attack') {
        a.k += dt * 3.2; const k = Math.min(1, a.k);
        push = Math.sin(k * Math.PI) * 0.9; lean = Math.sin(k * Math.PI) * 0.3;
        if (a.k >= 1) { a.state = 'idle'; a.k = 0; }
    }
    if (a.state === 'hit') {
        a.k += dt * 4; push = -Math.sin(Math.min(1, a.k) * Math.PI) * 0.35;
        body.position.x = Math.sin(a.t * 70) * 0.05 * (1 - Math.min(1, a.k));
        if (a.k >= 1) { a.state = 'idle'; a.k = 0; body.position.x = 0; }
    }
    if (a.state === 'faint') {
        a.k = Math.min(1, a.k + dt * 1.2);
        body.rotation.z = a.k * 1.3; body.position.y = -a.k * 0.4;
        o.traverse(c => { if (c.material && !c.material._faded) { c.material = c.material.clone(); c.material.transparent = true; c.material._faded = true; } if (c.material) c.material.opacity = Math.max(0, 1 - a.k); });
        if (a.k >= 1) o.visible = false;
        return;
    }
    body.position.y = bob; body.position.z = push; body.rotation.x = lean;
    for (const w of u.wings) w.o.rotation.z = w.s * (0.25 + Math.sin(t * (a.state === 'walk' ? 14 : 6)) * 0.45);
    for (const l of u.legs) {
        if (l.arm) { l.o.rotation.x = Math.sin(t * 3 + l.s) * 0.3 - (a.state === 'attack' ? 1.2 : 0); continue; }
        l.o.rotation.x = a.state === 'walk' ? Math.sin(t * 9 + (l.s > 0 ? 0 : Math.PI)) * 0.6 : 0;
    }
    u.tail.forEach((s, i) => { s.rotation.y = Math.sin(t * 2.2 - i * 0.6) * 0.35; s.rotation.x = 0.15; });
    for (const e of u.eyes) { const blink = (t % 4.3) < 0.12 ? 0.15 : 1; e.scale.y = e.scale.x * blink; }
    if (u.ring) u.ring.rotation.y += dt * 0.8;
    if (u.halo) { u.halo.rotation.z += dt * 0.9; u.halo.material.opacity = 0.6 + Math.sin(t * 2.5) * 0.3; }
    if (u.aura) { u.aura.rotation.z += dt * 0.6; u.aura.material.opacity = 0.35 + Math.sin(t * 3) * 0.2; }
    if (u.sparkles) { u.sparkles.rotation.y += dt * 0.7; u.sparkles.material.color.setHSL((t * 0.2) % 1, 1, 0.75); }
    if (u.prismMat) u.prismMat.sheenColor.setHSL((t * 0.15) % 1, 1, 0.6);
    if (u.flash > 0) { u.flash -= dt; u.mat.emissiveIntensity = 0.2 + Math.max(0, u.flash) * 2.5; } else if (u.mat) u.mat.emissiveIntensity = u.g.look.glow * 0.18;
}

export function disposeCreature(o) {
    o.traverse(c => { if (c.material && !c.material._shared) { if (Array.isArray(c.material)) c.material.forEach(m => m.dispose()); else c.material.dispose(); } if (c.geometry && c.geometry.attributes.color) c.geometry.dispose(); });
}
