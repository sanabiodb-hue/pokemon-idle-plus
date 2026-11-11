// ============================================================
// F11.1 · Golpes com poder real: cada golpe tem um FORMATO de efeito e uma ÁREA de verdade.
//   Parte pura (sem DOM nem Three.js; testável no Node):
//     moveFxProfile(nome, tipo, poder) → { shape, area, colors, tier, melee, hitAt, dur }
//     moveFxCovers(perfil, de, para, ponto) → o ponto (x, z) está dentro da área do golpe lançado de `de` em direção a `para`?
//   Parte 3D (MoveFxRenderer): desenha o golpe numa cena Three.js (a arena da aba de batalha e as batalhas do modo Explorar).
// Formatos: strike (pancada), slash (corte em arco), orb (projétil que explode), beam (feixe em linha), cone (sopro em cone),
//   bolt (raio que cai do céu), nova (onda em círculo ao redor), storm (redemoinho sobre o alvo), fall (chuva de pedras/gelo/meteoros),
//   wave (parede larga que varre em linha).
// Unidades da área: tiles do mapa (1 = um quadrado do chão).
// ============================================================
let MOVE_FX_ENABLED = true;

// [cor principal, cor de apoio, miolo quente]
const MOVE_FX_COLORS = {
    normal: ['#d8d2bc', '#ffffff', '#ffffff'], fire: ['#ff7a1a', '#ffd23b', '#fff3c4'], water: ['#3f9bff', '#9fe0ff', '#ffffff'],
    electric: ['#ffe14a', '#fff7a0', '#ffffff'], grass: ['#4fbf4a', '#b6f06a', '#f4ffd8'], ice: ['#8fe6f5', '#d8fbff', '#ffffff'],
    fighting: ['#d4482f', '#ffb199', '#ffffff'], poison: ['#a552c9', '#d99bf0', '#f5dcff'], ground: ['#c9a04f', '#8a6a3a', '#f0dca0'],
    flying: ['#a9c8ff', '#ffffff', '#ffffff'], psychic: ['#ff5c9a', '#ffb3d1', '#ffffff'], bug: ['#a8c020', '#e2f06a', '#ffffff'],
    rock: ['#b59a5a', '#7a6a4a', '#e8d8a8'], ghost: ['#6a4fb0', '#b39cff', '#e8dcff'], dragon: ['#6a5cff', '#ff8a5c', '#ffffff'],
    dark: ['#4a3a5a', '#b04ad0', '#e8c8ff'], steel: ['#b8c4d8', '#ffffff', '#ffffff'], fairy: ['#ff9ad8', '#ffe0f4', '#ffffff'],
};
// formato padrão do tipo (golpe sem regra própria)
const MOVE_FX_TYPE_SHAPE = {
    normal: 'strike', fire: 'cone', water: 'beam', electric: 'bolt', grass: 'storm', ice: 'beam', fighting: 'strike', poison: 'orb', ground: 'nova',
    flying: 'storm', psychic: 'orb', bug: 'storm', rock: 'fall', ghost: 'orb', dragon: 'cone', dark: 'slash', steel: 'beam', fairy: 'storm',
};
// golpes do jogo com formato próprio (como o golpe é nos jogos principais). `@t` = a onda nasce no alvo, não em quem ataca.
const MOVE_FX_BY_NAME = {
    'Investida': 'strike', 'Tackle': 'strike',
    'Swift': 'storm', 'Cut': 'slash', 'Strength': 'strike', 'Rock Climb': 'strike', 'Hyper Drill': 'strike', 'Double-Edge': 'strike', 'Hyper Voice': 'cone', 'Hyper Beam': 'beam',
    'Flame Wheel': 'strike', 'Fire Punch': 'strike', 'Blaze Kick': 'strike', 'Heat Wave': 'wave', 'Fire Blast': 'orb', 'Flare Blitz': 'strike', 'Overheat': 'cone', 'Blast Burn': 'nova',
    'Water Pulse': 'orb', 'Aqua Cutter': 'slash', 'Scald': 'cone', 'Surf': 'wave', 'Crabhammer': 'strike', 'Hydro Cannon': 'beam', 'Wave Crash': 'wave', 'Hydro Pump': 'beam',
    'Shock Wave': 'nova', 'Thunder Punch': 'strike', 'Discharge': 'nova', 'Thunderbolt': 'bolt', 'Thunder': 'bolt', 'Zap Cannon': 'orb', 'Bolt Strike': 'bolt', 'Electro Shot': 'beam',
    'Magical Leaf': 'storm', 'Giga Drain': 'orb', 'Seed Bomb': 'orb', 'Energy Ball': 'orb', 'Leaf Blade': 'slash', 'Power Whip': 'slash', 'Leaf Storm': 'storm', 'Frenzy Plant': 'nova@t',
    'Aurora Beam': 'beam', 'Ice Punch': 'strike', 'Icicle Crash': 'fall', 'Ice Beam': 'beam', 'Ice Hammer': 'strike', 'Glacial Lance': 'fall', 'Ice Burn': 'cone', 'Freeze Shock': 'bolt',
    'Rolling Kick': 'strike', 'Circle Throw': 'strike', 'Aura Sphere': 'orb', 'Sacred Sword': 'slash', 'Flying Press': 'strike', 'Superpower': 'strike', 'High Jump Kick': 'strike', 'Meteor Assault': 'beam',
    'Venoshock': 'orb', 'Cross Poison': 'slash', 'Poison Jab': 'strike', 'Sludge Bomb': 'orb', 'Sludge Wave': 'wave', 'Noxious Torque': 'strike', 'Belch': 'cone', 'Gunk Shot': 'orb',
    'Bulldoze': 'nova', 'Mud Bomb': 'orb', 'Stomping Tantrum': 'nova', 'Dig': 'strike', 'Earth Power': 'nova@t', 'Earthquake': 'nova', 'Headlong Rush': 'strike', 'Precipice Blades': 'nova@t',
    'Wing Attack': 'strike', 'Air Slash': 'slash', 'Fly': 'strike', 'Aeroblast': 'beam', 'Hurricane': 'storm', 'Brave Bird': 'strike', 'Dragon Ascent': 'strike', 'Sky Attack': 'strike',
    'Psybeam': 'beam', 'Psycho Cut': 'slash', 'Zen Headbutt': 'strike', 'Psychic': 'nova@t', 'Psystrike': 'orb', 'Future Sight': 'fall', 'Synchronoise': 'nova', 'Prismatic Laser': 'beam',
    'Bug Bite': 'strike', 'U-turn': 'strike', 'X-Scissor': 'slash', 'First Impression': 'strike', 'Bug Buzz': 'cone', 'Attack Order': 'storm', 'Pollen Puff': 'orb', 'Megahorn': 'strike',
    'Ancient Power': 'fall', 'Rock Slide': 'fall', 'Power Gem': 'beam', 'Mighty Cleave': 'slash', 'Diamond Storm': 'storm', 'Meteor Beam': 'beam', 'Head Smash': 'strike', 'Rock Wrecker': 'orb',
    'Shadow Punch': 'strike', 'Shadow Claw': 'slash', 'Shadow Ball': 'orb', 'Shadow Bone': 'strike', 'Phantom Force': 'strike', 'Moongeist Beam': 'beam', 'Shadow Force': 'strike', 'Astral Barrage': 'storm',
    'Dragon Breath': 'cone', 'Dragon Claw': 'slash', 'Dragon Hammer': 'strike', 'Dragon Rush': 'strike', 'Outrage': 'nova', 'Draco Meteor': 'fall', 'Roar of Time': 'nova', 'Eternabeam': 'beam',
    'Bite': 'strike', 'Night Slash': 'slash', 'Crunch': 'strike', 'Dark Pulse': 'nova', 'Night Daze': 'nova', 'Fiery Wrath': 'cone', 'Darkest Lariat': 'strike', 'Hyperspace Fury': 'storm',
};
// golpe sem regra própria: palavras do nome (na ordem); por fim o formato padrão do tipo
const MOVE_FX_KEYWORDS = [
    [/beam|laser|cannon|pump|shot\b|gun|ray/i, 'beam'], [/thunder|bolt|shock|lightning/i, 'bolt'], [/quake|bulldoze|discharge|outrage|tantrum|roar|daze|pulse|explosion|boom/i, 'nova'],
    [/wave|surf|tsunami/i, 'wave'], [/storm|hurricane|blizzard|tornado|twister|leaf|order|barrage|wind|gust|dazzling|glare/i, 'storm'],
    [/meteor|slide|crash|lance|icicle|ancient|avalanche|rain/i, 'fall'], [/ball|bomb|sphere|orb|puff|blast/i, 'orb'],
    [/breath|flame|voice|overheat|wrath|belch|scald|spray|powder|spore/i, 'cone'], [/slash|claw|blade|cut|scissor|sword|cleave|whip|edge/i, 'slash'],
    [/punch|kick|hammer|smash|tackle|rush|press|headbutt|bite|crunch|horn|blitz|bird|bash|slam|drill|fist|strike|fang|tail|rough/i, 'strike'],
];
// Área de cada formato por nível de força (0: poder < 75 · 1: < 110 · 2: ≥ 110). at: 'self' = parte de quem ataca · 'target' = sobre o alvo.
const MOVE_FX_AREAS = {
    strike: { kind: 'circle', at: 'target', r: [0.8, 1.0, 1.2] },
    slash: { kind: 'cone', at: 'self', len: [2.5, 3.0, 3.5], angle: [110, 110, 120] },
    orb: { kind: 'circle', at: 'target', r: [1.2, 1.6, 2.2] },
    beam: { kind: 'line', at: 'self', len: [9, 10, 12], width: [0.6, 0.9, 1.3] },
    cone: { kind: 'cone', at: 'self', len: [6.5, 7.5, 9], angle: [50, 55, 60] },
    bolt: { kind: 'circle', at: 'target', r: [0.9, 1.3, 1.9] },
    nova: { kind: 'circle', at: 'self', r: [3, 4, 5.5] },
    'nova@t': { kind: 'circle', at: 'target', r: [1.6, 2.0, 2.6] },
    storm: { kind: 'circle', at: 'target', r: [1.8, 2.3, 3.0] },
    fall: { kind: 'circle', at: 'target', r: [1.5, 2.0, 2.6] },
    wave: { kind: 'line', at: 'self', len: [8, 9, 11], width: [3, 4, 5] },
};
const MOVE_FX_SHAPE_LABELS = { strike: 'Pancada', slash: 'Corte em arco', orb: 'Projétil que explode', beam: 'Feixe em linha', cone: 'Sopro em cone', bolt: 'Raio do céu', nova: 'Onda ao redor', storm: 'Redemoinho', fall: 'Chuva do céu', wave: 'Onda larga' };
// quando o dano acontece e quanto dura o efeito (segundos, na velocidade 1)
const MOVE_FX_TIMING = { strike: [0.2, 0.55], slash: [0.2, 0.6], orb: [0.36, 0.95], beam: [0.16, 0.7], cone: [0.3, 0.85], bolt: [0.2, 0.75], nova: [0.28, 0.9], storm: [0.3, 1.0], fall: [0.34, 1.05], wave: [0.36, 0.95] };

function moveFxTier(power) { const p = Number(power) || 0; return p >= 110 ? 2 : p >= 75 ? 1 : 0; }
function moveFxShapeKey(name, type) {
    const n = String(name || '');
    if (Object.prototype.hasOwnProperty.call(MOVE_FX_BY_NAME, n)) return MOVE_FX_BY_NAME[n];
    for (const [re, shape] of MOVE_FX_KEYWORDS) if (re.test(n)) return shape;
    return MOVE_FX_TYPE_SHAPE[type] || 'strike';
}
// Perfil completo do golpe. Puro e determinístico.
function moveFxProfile(name, type, power) {
    const ty = Object.prototype.hasOwnProperty.call(MOVE_FX_COLORS, type) ? type : 'normal';
    const key = moveFxShapeKey(name, ty), shape = key.split('@')[0], tier = moveFxTier(power), a = MOVE_FX_AREAS[key] || MOVE_FX_AREAS[shape];
    const area = { kind: a.kind, at: a.at };
    if (a.r) area.r = a.r[tier];
    if (a.len) area.len = a.len[tier];
    if (a.width) area.width = a.width[tier];
    if (a.angle) area.angle = a.angle[tier];
    const [hitAt, dur] = MOVE_FX_TIMING[shape];
    return { name: String(name || ''), type: ty, power: Number(power) || 0, shape, tier, area, colors: MOVE_FX_COLORS[ty], melee: shape === 'strike' || shape === 'slash', hitAt, dur, label: MOVE_FX_SHAPE_LABELS[shape] };
}
// O ponto p = { x, z } está na área do golpe lançado de `from` na direção de `to`? (mesma geometria que a cena desenha no chão)
function moveFxCovers(profile, from, to, p) {
    if (!profile || !profile.area || !from || !to || !p) return false;
    const a = profile.area, dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    if (a.kind === 'circle') { const c = a.at === 'self' ? from : to; return Math.hypot(p.x - c.x, p.z - c.z) <= a.r + 1e-9; }
    const px = p.x - from.x, pz = p.z - from.z, along = px * ux + pz * uz, side = Math.abs(px * -uz + pz * ux);
    if (a.kind === 'line') return along >= -1e-9 && along <= a.len + 1e-9 && side <= a.width / 2 + 1e-9;
    if (a.kind === 'cone') { const dist = Math.hypot(px, pz); if (dist < 1e-9) return true; if (dist > a.len + 1e-9) return false; return Math.acos(Math.max(-1, Math.min(1, along / dist))) <= (a.angle * Math.PI / 180) / 2 + 1e-9; }
    return false;
}
// Texto curto da área para os painéis ("Raio do céu · círculo de 1,3 no alvo")
function moveFxAreaText(profile) {
    const a = profile.area, n = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
    const where = a.kind === 'circle' ? `círculo de raio ${n(a.r)} ${a.at === 'self' ? 'ao redor de quem ataca' : 'no alvo'}` : a.kind === 'line' ? `linha de ${n(a.len)} × ${n(a.width)}` : `cone de ${a.angle}° com alcance ${n(a.len)}`;
    return `${profile.label} · ${where}`;
}
// Golpe que um selvagem usa na batalha automática (o evento do jogo não diz o golpe): a técnica do primeiro tipo dele no nível
// da técnica pelo nível do Pokémon (mesma régua do modo Explorar). Devolve { name, type, power }.
function moveFxWildMove(types, level) {
    const type = (types && types[0]) || 'normal', list = (typeof SKILL_DATA !== 'undefined' && SKILL_DATA[type]) || null;
    const L = Math.max(1, Math.min(list ? list.length : 1, 1 + Math.floor((Number(level) || 1) / 25)));
    const m = list && list[L - 1];
    return m ? { name: m.name, type, power: m.power } : { name: 'Investida', type: 'normal', power: 40 };
}
function moveFxPowerOf(name, type) {
    const list = (typeof SKILL_DATA !== 'undefined' && SKILL_DATA[type]) || [], m = list.find(x => x.name === name);
    return m ? m.power : 60;
}

// ============================================================
// Parte 3D. T = módulo Three.js; scene = cena onde os efeitos entram. Quem usa chama update(dt) a cada quadro.
// opts: { speed (1 = normal; 1.6 = mais rápido), max (efeitos simultâneos), onShake(força), onFlash(cor, força), fit (a área alcança o alvo na arena) }
// ============================================================
class MoveFxRenderer {
    constructor(T, scene, opts = {}) {
        this.T = T; this.scene = scene; this.fx = []; this.live = 0;
        this.speed = opts.speed || 1; this.max = opts.max || 4; this.onShake = opts.onShake || null; this.onFlash = opts.onFlash || null; this.fit = opts.fit !== false;
        this.gSphere = new T.SphereGeometry(1, 14, 10); this.gCyl = new T.CylinderGeometry(1, 1, 1, 14, 1, true); this.gCyl.rotateX(Math.PI / 2);     // cilindro ao longo de Z
        this.gRing = new T.RingGeometry(0.86, 1, 40); this.gRing.rotateX(-Math.PI / 2); this.gDisc = new T.CircleGeometry(1, 40); this.gDisc.rotateX(-Math.PI / 2);
        this.gPlane = new T.PlaneGeometry(1, 1); this.gRock = new T.IcosahedronGeometry(1, 0); this.gSpike = new T.ConeGeometry(0.5, 1.6, 5); this.gSpike.rotateX(Math.PI);
        this.shared = new Set([this.gSphere, this.gCyl, this.gRing, this.gDisc, this.gPlane, this.gRock, this.gSpike]);
    }
    get active() { return this.fx.length > 0; }
    setScene(scene) { this.clear(); this.scene = scene; }
    clear() { for (const f of this.fx.splice(0)) f.end && f.end(true); this.live = 0; }
    update(dt) {
        for (let i = this.fx.length - 1; i >= 0; i--) {
            const f = this.fx[i];
            if (f.delay > 0) { f.delay -= dt; continue; }
            f.t += dt; const k = Math.min(1, f.t / f.dur);
            f.step && f.step(k, f.t);
            if (f.t >= f.dur) { this.fx.splice(i, 1); f.end && f.end(false); }
        }
    }
    dispose() { this.clear(); for (const g of this.shared) g.dispose(); }

    // ---------------- peças ----------------
    _tw(dur, step, end, delay = 0) { const f = { t: 0, dur: Math.max(0.001, dur / this.speed), delay: delay / this.speed, step, end }; this.fx.push(f); return f; }
    _mat(color, opacity = 1, add = true) { const T = this.T; return new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, blending: add ? T.AdditiveBlending : T.NormalBlending }); }
    // textura redonda e macia das partículas (uma só, compartilhada)
    _dot() {
        if (this.dot) return this.dot;
        const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
        this.dot = new this.T.CanvasTexture(c); return this.dot;
    }
    _pmat(color, size, add = true) { const T = this.T; return new T.PointsMaterial({ color, size, map: this._dot(), transparent: true, depthWrite: false, alphaTest: 0.01, blending: add ? T.AdditiveBlending : T.NormalBlending, sizeAttenuation: true }); }
    _mesh(geo, mat) { const m = new this.T.Mesh(geo, mat); m.renderOrder = 5; this.scene.add(m); return m; }
    _rm(o) { if (!o) return; o.parent && o.parent.remove(o); if (o.geometry && !this.shared.has(o.geometry)) o.geometry.dispose(); if (o.material) o.material.dispose(); }
    _v(x, y, z) { return new this.T.Vector3(x, y, z); }
    // esfera/clarão que cresce e some
    _flash(pos, color, r0, r1, dur, delay = 0, opacity = 0.9) {
        const m = this._mesh(this.gSphere, this._mat(color, 0, false)); m.position.copy(pos); m.visible = false; r1 *= 0.62; opacity *= 0.6;
        this._tw(dur, (k) => { m.visible = true; m.scale.setScalar(r0 + (r1 - r0) * (1 - (1 - k) * (1 - k))); m.material.opacity = opacity * (1 - k) * (1 - k); }, () => this._rm(m), delay);
    }
    // anel no chão que se abre
    _ring(pos, r0, r1, dur, color, delay = 0, opacity = 0.9, y = 0.06) {
        const m = this._mesh(this.gRing, this._mat(color, 0, false)); m.position.set(pos.x, y, pos.z); m.visible = false;
        this._tw(dur, (k) => { m.visible = true; const r = r0 + (r1 - r0) * (1 - (1 - k) * (1 - k)); m.scale.set(r, 1, r); m.material.opacity = opacity * (1 - k * k); }, () => this._rm(m), delay);
    }
    // partículas: init(i) → { p: Vector3, v: Vector3, t0 }. Cada uma anda p + v·t (com gravidade g) durante `life`.
    _parts(n, init, { color = '#ffffff', size = 0.16, life = 0.6, g = 0, delay = 0, drag = 0, add = true } = {}) {
        const T = this.T, arr = new Float32Array(n * 3), ps = [];
        for (let i = 0; i < n; i++) { const o = init(i); ps.push(o); arr.set([0, -999, 0], i * 3); }
        const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(arr, 3));
        const pts = new T.Points(geo, this._pmat(color, size * 1.7, add));
        pts.frustumCulled = false; pts.renderOrder = 6; this.scene.add(pts);
        const total = life + Math.max(0, ...ps.map(o => o.t0 || 0));
        this._tw(total, (k, t) => {
            const tt = t * this.speed;
            for (let i = 0; i < n; i++) {
                const o = ps[i], lt = tt - (o.t0 || 0);
                if (lt < 0 || lt > life) { arr[i * 3 + 1] = -999; continue; }
                const f = drag ? (1 - Math.exp(-drag * lt)) / drag : lt;
                arr[i * 3] = o.p.x + o.v.x * f; arr[i * 3 + 1] = Math.max(0.03, o.p.y + o.v.y * f - 0.5 * g * lt * lt); arr[i * 3 + 2] = o.p.z + o.v.z * f;
            }
            geo.attributes.position.needsUpdate = true; pts.material.opacity = k > 0.75 ? (1 - k) * 4 : 1;
        }, () => this._rm(pts), delay);
        return pts;
    }
    _burst(pos, color, n = 22, power = 3, opts = {}) {
        const T = this.T;
        return this._parts(n, () => ({ p: pos.clone(), v: new T.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(power * (0.35 + Math.random() * 0.75)) }), { color, life: 0.55, g: 7, ...opts });
    }
    // marca a ÁREA real do golpe no chão (círculo, cone ou faixa) por um instante
    _decal(c, radiusFit) {
        const T = this.T, a = c.p.area, col = c.c1, dur = Math.min(0.6, c.p.dur * 0.7);
        let m;
        if (a.kind === 'circle') {
            const r = a.at === 'self' ? Math.max(a.r, radiusFit || 0) : a.r, at = a.at === 'self' ? c.from : c.to;
            m = this._mesh(this.gDisc, this._mat(col, 0.0, false)); m.position.set(at.x, 0.04, at.z); m.scale.set(r, 1, r);
            this._ring(at, r * 0.98, r, dur, col, 0, 0.85, 0.05);
        } else if (a.kind === 'cone') {
            const ang = a.angle * Math.PI / 180, len = Math.max(a.len, c.melee ? 0 : (radiusFit || 0));
            const g = new T.CircleGeometry(len, 28, -ang / 2, ang); g.rotateX(-Math.PI / 2);
            m = this._mesh(g, this._mat(col, 0.0, false)); m.position.set(c.org.x, 0.04, c.org.z); m.rotation.y = Math.atan2(-c.dir.z, c.dir.x);
        } else {
            const len = Math.max(a.len, radiusFit || 0);
            m = this._mesh(this.gPlane, this._mat(col, 0.0, false)); m.scale.set(len, a.width, 1);
            m.position.set(c.org.x + c.dir.x * len / 2, 0.04, c.org.z + c.dir.z * len / 2);
            m.quaternion.setFromEuler(new T.Euler(-Math.PI / 2, Math.atan2(-c.dir.z, c.dir.x), 0, 'YXZ'));       // deitada no chão, comprida na direção do golpe
        }
        this._tw(dur, (k) => { m.material.opacity = 0.26 * Math.sin(Math.min(1, k * 1.15) * Math.PI); }, () => this._rm(m));
    }
    // fita em zigue-zague entre dois pontos (raio): duas fitas cruzadas para aparecer de qualquer ângulo
    _boltGeo(a, b, width, jag, segs = 9) {
        const T = this.T, pts = [];
        for (let i = 0; i <= segs; i++) { const k = i / segs, p = a.clone().lerp(b, k), j = i === 0 || i === segs ? 0 : jag; p.x += (Math.random() - 0.5) * j; p.z += (Math.random() - 0.5) * j * 0.6; pts.push(p); }
        const pos = [], idx = [];
        for (const [ox, oz] of [[1, 0], [0, 1]]) {
            const base = pos.length / 3;
            for (const p of pts) { pos.push(p.x - ox * width / 2, p.y, p.z - oz * width / 2, p.x + ox * width / 2, p.y, p.z + oz * width / 2); }
            for (let i = 0; i < segs; i++) { const q = base + i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
        }
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
        return g;
    }
    _boltStrike(top, bottom, c, width, delay) {
        const glow = this._mesh(this._boltGeo(top, bottom, width * 3.2, 1.5), this._mat(c.c1, 0.75, false)), core = this._mesh(this._boltGeo(top, bottom, width, 1.5), this._mat(c.c3, 1));
        glow.visible = core.visible = false; let last = -1;
        this._tw(0.26, (k) => {
            glow.visible = core.visible = true; const f = Math.floor(k * 4);
            if (f !== last) { last = f; const g1 = this._boltGeo(top, bottom, width * 3.2, 1.4), g2 = this._boltGeo(top, bottom, width, 1.4); glow.geometry.dispose(); core.geometry.dispose(); glow.geometry = g1; core.geometry = g2; }
            core.material.opacity = k < 0.7 ? 1 : (1 - k) / 0.3; glow.material.opacity = 0.75 * (1 - k * k);
        }, () => { this._rm(glow); this._rm(core); }, delay);
        this._flash(bottom.clone().setY(0.5), c.c3, 0.3, 1.5 + c.tier * 0.5, 0.3, delay, 0.95);
        this._ring(bottom, 0.2, 1.4 + c.tier * 0.6, 0.4, c.c1, delay);
        this._burst(bottom.clone().setY(0.25), c.c2, 16 + c.tier * 8, 4.5, { delay, size: 0.13 });
    }

    // ---------------- lançar um golpe ----------------
    // from/to: posições no chão (Vector3) de quem ataca e do alvo. onHit é chamado uma vez, no momento do impacto.
    play(profile, from, to, opts = {}) {
        const onHit = opts.onHit || null;
        if (!MOVE_FX_ENABLED || !profile || this.live >= this.max) { onHit && onHit(); return false; }
        const T = this.T, dir = to.clone().sub(from).setY(0), dist = dir.length() || 1; dir.normalize();
        let done = false;
        const c = { p: profile, from: from.clone(), to: to.clone(), dir, dist, c1: profile.colors[0], c2: profile.colors[1], c3: profile.colors[2], tier: profile.tier, melee: profile.melee,
            org: from.clone(), mouth: from.clone().add(new T.Vector3(0, opts.height || 1.0, 0)).addScaledVector(dir, 0.5), chest: to.clone().add(new T.Vector3(0, opts.targetHeight || 0.9, 0)),
            hit: () => { if (done) return; done = true; onHit && onHit(); } };
        this.live++;
        this._tw(profile.dur + 0.05, null, () => { this.live = Math.max(0, this.live - 1); c.hit(); });
        this._tw(profile.hitAt, null, () => c.hit());
        if (opts.decal !== false) this._decal(c, this.fit ? dist + 0.6 : 0);
        this['_' + profile.shape](c);
        return true;
    }
    _shake(f) { this.onShake && this.onShake(f); }

    _strike(c) {
        const at = c.chest, d = c.p.hitAt - 0.04;
        this._flash(at, c.c3, 0.15, 0.9 + c.tier * 0.35, 0.22, d, 1);
        this._flash(at, c.c1, 0.3, 1.5 + c.tier * 0.5, 0.36, d, 0.6);
        for (let i = 0; i < 2; i++) {            // estrela de impacto: duas lâminas cruzadas
            const m = this._mesh(this.gPlane, this._mat(c.c3, 0)); m.position.copy(at); m.rotation.z = Math.PI / 4 + i * Math.PI / 2; m.visible = false;
            this._tw(0.22, (k) => { m.visible = true; m.scale.set(0.2 + k * (2.6 + c.tier), 0.16 * (1 - k), 1); m.material.opacity = 1 - k; }, () => this._rm(m), d);
        }
        this._ring(c.to, 0.2, c.p.area.r * 1.25, 0.4, c.c1, d);
        this._burst(at, c.c2, 14 + c.tier * 8, 4, { delay: d });
        if (c.tier) this._tw(d, null, () => this._shake(0.12 + c.tier * 0.1));
    }
    _slash(c) {
        const T = this.T, at = c.chest, d = c.p.hitAt - 0.06, n = 2 + (c.tier > 1 ? 1 : 0);
        for (let i = 0; i < n; i++) {
            const g = new T.TorusGeometry(0.9 + c.tier * 0.2, 0.11, 4, 18, Math.PI * 0.9), m = this._mesh(g, this._mat(i % 2 ? c.c2 : c.c3, 0, i % 2 === 0));
            m.position.copy(at); m.rotation.set(0.2, (Math.random() - 0.5) * 0.5, -0.9 + i * (1.8 / Math.max(1, n - 1)) + Math.PI * 0.05); m.visible = false;
            this._tw(0.24, (k) => { m.visible = true; const s = 0.5 + k * 1.1; m.scale.set(s, s, s); m.rotation.z += 0.12; m.material.opacity = k < 0.3 ? k / 0.3 : (1 - k) / 0.7; }, () => this._rm(m), d + i * 0.07);
        }
        this._burst(at, c.c2, 12 + c.tier * 6, 3.2, { delay: d + 0.05, size: 0.12 });
        this._flash(at, c.c1, 0.2, 1.1, 0.25, d + 0.04, 0.5);
    }
    _orb(c) {
        const T = this.T, r = 0.2 + c.tier * 0.09, orb = this._mesh(this.gSphere, this._mat(c.c3, 1)), halo = this._mesh(this.gSphere, this._mat(c.c1, 0.6, false));
        const a = c.mouth.clone(), b = c.chest.clone(), fly = c.p.hitAt, R = c.p.area.r;
        this._flash(a, c.c1, 0.1, 0.7, fly * 0.5, 0, 0.7);
        this._tw(fly, (k) => { orb.position.lerpVectors(a, b, k); orb.position.y += Math.sin(k * Math.PI) * (0.5 + c.tier * 0.4); halo.position.copy(orb.position); const s = r * (0.6 + 0.5 * Math.min(1, k * 3)); orb.scale.setScalar(s); halo.scale.setScalar(s * (2 + Math.sin(k * 40) * 0.25)); },
            () => { this._rm(orb); this._rm(halo); });
        this._parts(14, (i) => { const k = i / 14, p = a.clone().lerp(b, k); p.y += Math.sin(k * Math.PI) * (0.5 + c.tier * 0.4); return { p, v: new T.Vector3((Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6), t0: k * fly }; }, { color: c.c2, life: 0.3, size: 0.14 });
        this._flash(b, c.c3, 0.2, R * 0.9, 0.3, fly, 1); this._flash(b, c.c1, 0.3, R * 1.5, 0.5, fly, 0.65);
        this._ring(c.to, 0.2, R * 1.15, 0.5, c.c1, fly); this._burst(b, c.c2, 22 + c.tier * 10, 4.5, { delay: fly });
        if (c.tier) this._tw(fly, null, () => this._shake(0.1 + c.tier * 0.12));
    }
    _beam(c) {
        const T = this.T, a = c.mouth.clone(), len = Math.max(c.dist + 0.6, this.fit ? 0 : c.p.area.len), b = a.clone().addScaledVector(c.dir, len).setY(c.chest.y), mid = a.clone().lerp(b, 0.5), w = c.p.area.width / 2;
        const mk = (col, op) => { const m = this._mesh(this.gCyl, this._mat(col, op, col === c.c3)); m.position.copy(mid); m.lookAt(b); return m; };
        const outer = mk(c.c1, 0.8), core = mk(c.c3, 1), L = a.distanceTo(b), hold = c.p.dur * 0.72;
        this._flash(a, c.c3, 0.1, 0.5 + w, 0.2, 0, 0.95);
        this._tw(hold, (k) => { const grow = Math.min(1, k * 6), fade = k > 0.75 ? (1 - k) / 0.25 : 1, pulse = 1 + Math.sin(k * 60) * 0.08; outer.scale.set(w * 1.5 * grow * fade * pulse, w * 1.5 * grow * fade * pulse, L); core.scale.set(w * 0.55 * grow * fade, w * 0.55 * grow * fade, L); outer.material.opacity = 0.8 * fade; },
            () => { this._rm(outer); this._rm(core); });
        this._parts(26, (i) => { const k = Math.random(); return { p: a.clone().lerp(b, k), v: new T.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.3) * 1.6, (Math.random() - 0.5) * 1.6), t0: Math.random() * hold * 0.8 }; }, { color: c.c2, life: 0.3, size: 0.12 });
        this._flash(c.chest, c.c1, 0.2, 1.2 + c.tier * 0.5, 0.4, c.p.hitAt, 0.8); this._burst(c.chest, c.c2, 18 + c.tier * 10, 4.5, { delay: c.p.hitAt });
        if (c.tier) this._tw(c.p.hitAt, null, () => this._shake(0.1 + c.tier * 0.1));
    }
    _cone(c) {
        const T = this.T, a = c.mouth.clone(), half = (c.p.area.angle * Math.PI / 180) / 2, reach = Math.max(c.dist + 0.8, this.fit ? 0 : c.p.area.len), flow = c.p.dur * 0.6, sp = reach / 0.34;
        const side = new T.Vector3(-c.dir.z, 0, c.dir.x), mk = (n, col, size, spread) => this._parts(n, () => {
            const ang = (Math.random() - 0.5) * 2 * half * spread, up = (Math.random() - 0.35) * 0.5, v = c.dir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang)); v.y = up;
            return { p: a.clone(), v: v.multiplyScalar(sp * (0.7 + Math.random() * 0.5)), t0: Math.random() * flow };
        }, { color: col, size, life: 0.36, drag: 1.2, add: col === c.c3 });
        mk(34 + c.tier * 14, c.c1, 0.3 + c.tier * 0.06, 1); mk(26 + c.tier * 10, c.c2, 0.2, 0.75); mk(14, c.c3, 0.14, 0.4);
        this._flash(a, c.c2, 0.1, 0.6, 0.25, 0, 0.8);
        this._flash(c.chest, c.c1, 0.3, 1.4 + c.tier * 0.5, 0.5, c.p.hitAt, 0.6);
    }
    _bolt(c) {
        const n = c.tier === 2 ? 3 : c.tier === 1 ? 2 : 1, R = c.p.area.r, d = c.p.hitAt - 0.04;
        this._parts(10, () => ({ p: c.mouth.clone(), v: this._v((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3) }), { color: c.c2, life: 0.2, size: 0.12 });      // faíscas de carga em quem ataca
        for (let i = 0; i < n; i++) {
            const off = i === 0 ? this._v(0, 0, 0) : this._v((Math.random() - 0.5) * R * 1.3, 0, (Math.random() - 0.5) * R * 0.9), bottom = c.to.clone().add(off).setY(0.05), top = bottom.clone().add(this._v((Math.random() - 0.5) * 2.5, 11, (Math.random() - 0.5) * 1.5));
            this._boltStrike(top, bottom, c, 0.1 + c.tier * 0.04, d + i * 0.11);
        }
        this._tw(d, null, () => { this.onFlash && this.onFlash(c.c2, 0.55 + c.tier * 0.2); this._shake(0.12 + c.tier * 0.1); });
    }
    _nova(c) {
        const T = this.T, self = c.p.area.at === 'self', at = self ? c.from : c.to, R = self ? Math.max(c.p.area.r, this.fit ? c.dist + 0.8 : 0) : c.p.area.r, d = self ? 0.04 : c.p.hitAt - 0.1;
        for (let i = 0; i < 3; i++) this._ring(at, 0.3, R, 0.5, i === 1 ? c.c2 : c.c1, d + i * 0.09, 0.9 - i * 0.2);
        this._flash(at.clone().setY(0.4), c.c1, 0.3, R * 0.55, 0.45, d, 0.5);
        const earthy = c.p.type === 'ground' || c.p.type === 'rock' || c.p.type === 'grass' || c.p.type === 'dragon', n = 10 + c.tier * 5;
        for (let i = 0; i < n; i++) {            // estilhaços que saltam do chão ao longo da onda
            const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4, rr = R * (0.35 + Math.random() * 0.6), m = this._mesh(earthy ? this.gRock : this.gSphere, this._mat(i % 2 ? c.c1 : c.c2, 0, !earthy));
            const px = at.x + Math.cos(ang) * rr, pz = at.z + Math.sin(ang) * rr, s = 0.14 + Math.random() * 0.2, h = 0.9 + Math.random() * 1.4; m.visible = false;
            this._tw(0.5, (k) => { m.visible = true; m.position.set(px, Math.sin(k * Math.PI) * h, pz); m.scale.setScalar(s); m.rotation.x += 0.2; m.material.opacity = 1 - k * k; }, () => this._rm(m), d + (rr / R) * 0.28);
        }
        this._parts(26 + c.tier * 10, () => { const ang = Math.random() * Math.PI * 2, rr = R * Math.random(); return { p: this._v(at.x + Math.cos(ang) * rr, 0.1, at.z + Math.sin(ang) * rr), v: this._v((Math.random() - 0.5), 1.2 + Math.random() * 1.6, (Math.random() - 0.5)), t0: d + (rr / R) * 0.28 }; }, { color: c.c2, life: 0.5, size: 0.2, add: false });
        this._tw(d + 0.05, null, () => this._shake(0.18 + c.tier * 0.14));
    }
    _storm(c) {
        const T = this.T, at = c.to, R = c.p.area.r, life = c.p.dur * 0.85, n = 46 + c.tier * 18;
        const mk = (cnt, col, size) => {
            const seeds = Array.from({ length: cnt }, () => ({ a: Math.random() * Math.PI * 2, r: R * (0.25 + Math.random() * 0.75), y: Math.random() * 0.4, w: 7 + Math.random() * 5, up: 1.4 + Math.random() * 2.2, t0: Math.random() * 0.25 }));
            const arr = new Float32Array(cnt * 3), geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(arr, 3));
            const pts = new T.Points(geo, this._pmat(col, size * 1.7, false)); pts.frustumCulled = false; pts.renderOrder = 6; this.scene.add(pts);
            this._tw(life, (k, t) => {
                const tt = t * this.speed;
                for (let i = 0; i < cnt; i++) { const s = seeds[i], lt = Math.max(0, tt - s.t0), ang = s.a + s.w * lt, rr = s.r * (1 - 0.35 * k); arr[i * 3] = at.x + Math.cos(ang) * rr; arr[i * 3 + 1] = 0.15 + s.y + s.up * lt; arr[i * 3 + 2] = at.z + Math.sin(ang) * rr; }
                geo.attributes.position.needsUpdate = true; pts.material.opacity = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
            }, () => this._rm(pts));
        };
        mk(n, c.c1, 0.2); mk(Math.round(n * 0.6), c.c2, 0.13);
        this._ring(at, R * 0.3, R, 0.5, c.c1, 0.05, 0.6);
        this._flash(c.chest, c.c3, 0.2, 1.0 + c.tier * 0.3, 0.3, c.p.hitAt, 0.7); this._flash(c.chest, c.c1, 0.2, 1.2, 0.3, c.p.hitAt + 0.2, 0.5);
    }
    _fall(c) {
        const T = this.T, at = c.to, R = c.p.area.r, n = 4 + c.tier * 3, ty = c.p.type, spike = ty === 'ice', glow = ty === 'psychic' || ty === 'dragon' || ty === 'fairy' || ty === 'ghost' || ty === 'fire';
        for (let i = 0; i < n; i++) {
            const off = i === 0 ? this._v(0, 0, 0) : this._v((Math.random() - 0.5) * 2 * R * 0.85, 0, (Math.random() - 0.5) * 2 * R * 0.7), land = at.clone().add(off).setY(0.1), start = land.clone().add(this._v(-1.5 - Math.random(), 9 + Math.random() * 2, 0.5));
            const m = this._mesh(spike ? this.gSpike : glow ? this.gSphere : this.gRock, this._mat(glow ? c.c3 : c.c1, 1, glow || spike)), s = (spike ? 0.34 : 0.26) + Math.random() * 0.16 + c.tier * 0.05, d = (c.p.hitAt - 0.28) + i * 0.085;
            m.visible = false; m.scale.setScalar(s);
            let trail = null; if (glow) { trail = this._mesh(this.gSphere, this._mat(c.c1, 0.5)); trail.visible = false; }
            this._tw(0.28, (k) => { m.visible = true; m.position.lerpVectors(start, land, k * k); m.rotation.x += 0.3; m.rotation.z += 0.2; if (trail) { trail.visible = true; trail.position.lerpVectors(start, land, Math.max(0, k * k - 0.06)); trail.scale.setScalar(s * 1.9); } },
                () => { this._rm(m); this._rm(trail); }, d);
            this._burst(land.clone().setY(0.2), i % 2 ? c.c1 : c.c2, 9 + c.tier * 3, 3.4, { delay: d + 0.28, size: 0.13, add: glow || spike });
            this._ring(land, 0.15, 0.9 + c.tier * 0.2, 0.35, c.c1, d + 0.28, 0.7);
        }
        this._tw(c.p.hitAt, null, () => this._shake(0.14 + c.tier * 0.12));
    }
    _wave(c) {
        const T = this.T, w = c.p.area.width, len = Math.max(c.dist + 1.6, this.fit ? 0 : c.p.area.len), run = c.p.dur * 0.78, h = 1.2 + c.tier * 0.45;
        const geo = new T.CylinderGeometry(1, 1, 1, 18, 1, true, 0, Math.PI); geo.rotateZ(Math.PI / 2);       // meio tubo deitado: a crista da onda
        const wall = this._mesh(geo, this._mat(c.c1, 0.0, false)), foam = this._mesh(geo.clone(), this._mat(c.c2, 0));
        const yaw = Math.atan2(c.dir.x, c.dir.z); wall.rotation.y = yaw; foam.rotation.y = yaw;
        this._tw(run, (k) => {
            const d = -0.3 + k * len, grow = Math.sin(Math.min(1, k * 1.25) * Math.PI * 0.5) * (k > 0.8 ? (1 - k) / 0.2 : 1);
            wall.position.set(c.from.x + c.dir.x * d, 0, c.from.z + c.dir.z * d); wall.scale.set(w, h * grow, 0.8 + grow * 0.5); wall.material.opacity = 0.62 * (k > 0.8 ? (1 - k) / 0.2 : 1);
            foam.position.copy(wall.position).addScaledVector(c.dir, 0.25); foam.scale.set(w * 1.02, h * grow * 1.06, 0.5); foam.material.opacity = 0.45 * (k > 0.8 ? (1 - k) / 0.2 : 1);
        }, () => { this._rm(wall); this._rm(foam); });
        const side = new T.Vector3(-c.dir.z, 0, c.dir.x);
        this._parts(40 + c.tier * 16, () => { const k = Math.random(), d = k * len, o = (Math.random() - 0.5) * w; return { p: c.from.clone().addScaledVector(c.dir, d).addScaledVector(side, o).setY(h * 0.7), v: new T.Vector3((Math.random() - 0.5) * 1.2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.2), t0: k * run }; }, { color: c.c2, life: 0.4, size: 0.15, g: 6 });
        this._flash(c.chest, c.c2, 0.3, 1.4 + c.tier * 0.4, 0.4, c.p.hitAt, 0.6);
        this._tw(c.p.hitAt, null, () => this._shake(0.1 + c.tier * 0.1));
    }
}
