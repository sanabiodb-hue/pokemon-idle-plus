// ============================================================
// F12 · Modelos 3D procedurais dos Pokémon (Mundo de Ação). Contrato: docs/action/CONTRATO.md, seção "Modelos".
// Nada de arquivo de modelo: cada espécie é uma RECEITA de primitivas (dados puros), montada em código com Three.js.
//   Parte pura (Node, sem Three.js):
//     POKEMON_MODEL_RECIPES[id] = { rig, height, radius, parts: [{ id, group, shape, size, pos, rot, color }], pivots, shiny, ... }
//     POKEMON_MODEL_IDS, pokemonModelHas(id), pokemonModelInfo(id) → { rig, height, radius, parts, pivots, triangles }
//     pokemonInstancePose(rig, state, t, phase, out) → out = { y, sx, sy, sz, tilt, roll, fwd }
//   Parte 3D (recebe o módulo THREE como `T`):
//     buildPokemonModel(T, id, { shiny })     → Group articulado (herói, elites, chefe)
//     buildPokemonGeometry(T, id, { shiny })  → BufferGeometry única fundida com cor por vértice (hordas em InstancedMesh)
//     animatePokemonModel(model, state, t, dt, speed01)
//     pokemonModelMaterial(T)                 → MeshLambertMaterial({ vertexColors: true }) compartilhado (para a geometria fundida)
//     disposePokemonModels(T)                 → descarta todas as geometrias e materiais em cache (ao sair da cena)
// Convenções: 1 unidade = 1 quadrado do chão. Pés na origem (y = 0), olhando para +Z, +X = lado esquerdo do Pokémon.
// Receitas escritas em "alturas" (H ≈ 1 no topo); pokemonModelInfo normaliza: base em y = 0 e topo exatamente em `height`.
// Rotações das partes em GRAUS, ordem XYZ (a mesma do Three.js). Tamanhos:
//   sphere/ellipsoid: raios [rx, ry, rz] · box/wedge: medidas [w, h, d] · cyl/cone/ear: [rx, altura, rz] · capsule: [rx, altura total, rz]
// Altura no mundo: pokemonModelHeight(metros) = 0,55 + 0,85 × metros (teto 2,2): Pikachu (0,4 m) ≈ 0,89; Scyther (1,5 m) ≈ 1,83.
// Arte original feita em código (proporções e cores descritas em docs/pokemon-research/species/).
// ============================================================
const POKEMON_MODEL_SHAPES = ['sphere', 'ellipsoid', 'box', 'cone', 'cyl', 'capsule', 'wedge', 'ear'];
const POKEMON_MODEL_RIGS = ['biped', 'quad', 'larva', 'cocoon', 'bird', 'insect'];
const POKEMON_MODEL_STATES = ['idle', 'move', 'windup', 'attack', 'hurt', 'dying'];
const POKEMON_MODEL_REF_SPEED = 5.2;          // velocidade (u/s) que corresponde a speed01 = 1 (ACTION_BALANCE.playerSpeed)
// níveis de detalhe das esferas [segmentos em volta, segmentos de cima a baixo]: triângulos = w × (2h − 2)
const POKEMON_MODEL_LOD = { hi: [10, 6], md: [8, 5], lo: [6, 4], sm: [6, 3], xs: [4, 2], disc: [8, 2] };

function pokemonModelHeight(meters) { return Math.round(Math.min(2.2, 0.55 + 0.85 * (Number(meters) || 0.3)) * 100) / 100; }

// ---------------- receitas ----------------
const POKEMON_MODEL_RECIPES = (() => {
    const R = {};
    // p(id, grupo, forma, tamanho, posição, rotação°, cor, extra) — extra: { q: nível de detalhe, taper, apex }
    const p = (id, group, shape, size, pos, rot, color, extra) => Object.assign({ id, group, shape, size: Array.isArray(size) ? size : [size, size, size], pos, rot: rot || [0, 0, 0], color }, extra || {});
    // par simétrico: escreva o lado esquerdo (+x); `*` no id/grupo vira L/R; o lado direito é o espelho em x
    const sym = (part) => {
        const L = Object.assign({}, part, { id: part.id.replace('*', 'L'), group: part.group.replace('*', 'L'), pos: [Math.abs(part.pos[0]), part.pos[1], part.pos[2]] });
        const Rr = Object.assign({}, part, { id: part.id.replace('*', 'R'), group: part.group.replace('*', 'R'), pos: [-Math.abs(part.pos[0]), part.pos[1], part.pos[2]],
            rot: [part.rot[0], -part.rot[1], -part.rot[2]] });
        if (part.apex) Rr.apex = -part.apex;
        if (part.pos[0] < 0) { L.rot = [part.rot[0], -part.rot[1], -part.rot[2]]; Rr.rot = part.rot.slice(); }
        return [L, Rr];
    };
    const symPivots = (o) => { const out = {}; for (const k of Object.keys(o)) { const v = o[k]; if (k.includes('*')) { out[k.replace('*', 'L')] = [Math.abs(v[0]), v[1], v[2]]; out[k.replace('*', 'R')] = [-Math.abs(v[0]), v[1], v[2]]; } else out[k] = v; } return out; };
    // caixa ligando dois pontos do plano lateral (y, z) — cauda em raio, caudas finas
    const link = (id, group, shape, a, b, tx, wz, color, x, extra) => {
        const dy = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dy, dz), rx = Math.atan2(dz, dy) * 180 / Math.PI;
        const size = shape === 'box' ? [tx, len, wz] : [tx, len, wz];
        return p(id, group, shape, size, [x || 0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [rx, 0, 0], color, extra);
    };
    // ponta de um cone (mesmo eixo), cobrindo a fração final `frac` do comprimento: pontas pretas das orelhas, ferrões
    const tip = (cone, id, frac, color, grow) => {
        const g = grow || 1.18, h = cone.size[1], r = cone.rot.map(d => d * Math.PI / 180);
        const ax = _pmRotate(r, 0, 1, 0), d = h / 2 - frac * h / 2;
        return Object.assign({}, cone, { id, color, size: [cone.size[0] * frac * g, h * frac, cone.size[2] * frac * g],
            pos: [cone.pos[0] + ax[0] * d, cone.pos[1] + ax[1] * d, cone.pos[2] + ax[2] * d] });
    };
    const def = (id, o) => { o.parts = o.parts.flat(); if (o.pivots) o.pivots = symPivots(o.pivots); R[id] = o; };

    // ===== #025 Pikachu (herói) =====
    {
        const Y = '#F6D12E', K = '#2B2B2B', RED = '#E8423A', BR = '#8A5A2B', E = '#1C1C1C', W = '#FFFFFF';
        const ear = p('ear*', 'ear*', 'cone', [0.068, 0.38, 0.04], [0.15, 0.87, -0.01], [-8, 0, -26], Y, { q: 'lo' });
        def(25, {
            name: 'Pikachu', rig: 'biped', meters: 0.4, height: 0.9, radius: 0.38, runLean: 0.5, stride: 0.55,
            parts: [
                p('body', 'body', 'ellipsoid', [0.19, 0.22, 0.17], [0, 0.3, -0.01], null, Y, { q: 'md' }),
                p('stripe1', 'body', 'ellipsoid', [0.165, 0.03, 0.075], [0, 0.37, -0.105], [-12, 0, 0], BR, { q: 'sm' }),
                p('stripe2', 'body', 'ellipsoid', [0.175, 0.03, 0.075], [0, 0.27, -0.115], [8, 0, 0], BR, { q: 'sm' }),
                p('head', 'head', 'ellipsoid', [0.25, 0.21, 0.22], [0, 0.62, 0.02], null, Y, { q: 'hi' }),
                sym(ear), sym(tip(ear, 'earTip*', 0.36, K)),
                sym(p('eye*', 'head', 'ellipsoid', [0.042, 0.056, 0.03], [0.1, 0.65, 0.2], [0, 22, 0], E, { q: 'sm' })),
                sym(p('shine*', 'head', 'sphere', 0.018, [0.09, 0.675, 0.226], null, W, { q: 'xs' })),
                sym(p('cheek*', 'head', 'ellipsoid', [0.062, 0.056, 0.026], [0.17, 0.55, 0.15], [0, 42, 0], RED, { q: 'sm' })),
                p('nose', 'head', 'ellipsoid', [0.016, 0.011, 0.012], [0, 0.61, 0.237], null, E, { q: 'xs' }),
                sym(p('arm*', 'arm*', 'ellipsoid', [0.042, 0.095, 0.042], [0.15, 0.36, 0.11], [-55, 0, -12], Y, { q: 'lo' })),
                sym(p('thigh*', 'leg*', 'ellipsoid', [0.075, 0.095, 0.09], [0.11, 0.13, 0], null, Y, { q: 'lo' })),
                sym(p('foot*', 'leg*', 'ellipsoid', [0.062, 0.036, 0.095], [0.105, 0.036, 0.06], null, Y, { q: 'sm' })),
                link('tail1', 'tail', 'box', [0.08, -0.13], [0.3, -0.3], 0.045, 0.06, BR),
                link('tail2', 'tail', 'box', [0.27, -0.33], [0.42, -0.19], 0.045, 0.08, Y),
                link('tail3', 'tail', 'box', [0.38, -0.23], [0.8, -0.5], 0.045, 0.2, Y),
            ],
            pivots: { body: [0, 0.2, 0], head: [0, 0.46, 0.02], 'ear*': [0.1, 0.76, 0], 'arm*': [0.14, 0.42, 0.05], 'leg*': [0.1, 0.19, 0], tail: [0, 0.13, -0.13] },
            shiny: { '#F6D12E': '#F2B33A' },
        });
    }

    // ===== #010 Caterpie (lagarta em "S", antena vermelha em Y) =====
    {
        const G = '#7CC24E', C = '#F0E3A8', Yl = '#F5D96A', Rd = '#E0453A', E = '#1E1E1E', Ri = '#F4F0D0';
        def(10, {
            name: 'Caterpie', rig: 'larva', meters: 0.3, height: pokemonModelHeight(0.3), radius: 0.36, stride: 0.5,
            parts: [
                p('head', 'head', 'ellipsoid', [0.23, 0.23, 0.22], [0, 0.52, 0.4], null, G, { q: 'md' }),
                p('mouth', 'head', 'ellipsoid', [0.12, 0.07, 0.06], [0, 0.42, 0.58], [-15, 0, 0], C, { q: 'sm' }),
                sym(p('ring*', 'head', 'ellipsoid', [0.1, 0.11, 0.035], [0.13, 0.58, 0.55], [0, 30, 0], Ri, { q: 'sm' })),
                sym(p('eye*', 'head', 'ellipsoid', [0.075, 0.085, 0.035], [0.136, 0.58, 0.565], [0, 30, 0], E, { q: 'sm' })),
                p('antStem', 'head', 'cyl', [0.028, 0.14, 0.028], [0, 0.79, 0.38], null, Rd, { q: 'sm' }),
                sym(p('antY*', 'head', 'cone', [0.032, 0.13, 0.032], [0.05, 0.9, 0.38], [0, 0, -32], Rd, { q: 'sm' })),
                p('seg1', 'seg1', 'sphere', 0.19, [0, 0.3, 0.18], null, G, { q: 'lo' }),
                p('seg2', 'seg2', 'sphere', 0.17, [0, 0.18, -0.05], null, G, { q: 'lo' }),
                p('seg3', 'seg3', 'sphere', 0.15, [0, 0.2, -0.28], null, G, { q: 'lo' }),
                p('seg4', 'seg4', 'sphere', 0.12, [0, 0.32, -0.46], null, G, { q: 'lo' }),
                p('hook', 'seg4', 'cone', [0.055, 0.15, 0.055], [0, 0.46, -0.53], [-35, 0, 0], G, { q: 'sm' }),
                sym(p('spot1*', 'seg1', 'ellipsoid', [0.03, 0.06, 0.06], [0.17, 0.32, 0.18], null, Yl, { q: 'xs' })),
                sym(p('spot2*', 'seg2', 'ellipsoid', [0.03, 0.055, 0.055], [0.15, 0.2, -0.05], null, Yl, { q: 'xs' })),
                sym(p('spot3*', 'seg3', 'ellipsoid', [0.03, 0.05, 0.05], [0.13, 0.22, -0.28], null, Yl, { q: 'xs' })),
            ],
            pivots: { head: [0, 0.36, 0.3], seg1: [0, 0.3, 0.18], seg2: [0, 0.18, -0.05], seg3: [0, 0.2, -0.28], seg4: [0, 0.32, -0.46] },
            shiny: { '#7CC24E': '#E2CF3E', '#E0453A': '#E07A3A' },
        });
    }
    // ===== #013 Weedle (lagarta baixa e reta, ferrão na cabeça e na cauda, nariz rosa) =====
    {
        const B = '#D49A3E', Pk = '#E8818A', S = '#E2E2E6', E = '#1E1E1E', Bd = '#B07A2A';
        def(13, {
            name: 'Weedle', rig: 'larva', meters: 0.3, height: pokemonModelHeight(0.3), radius: 0.36, stride: 0.5,
            parts: [
                p('head', 'head', 'ellipsoid', [0.2, 0.2, 0.2], [0, 0.4, 0.42], null, B, { q: 'md' }),
                p('horn', 'head', 'cone', [0.065, 0.32, 0.065], [0, 0.72, 0.36], [-12, 0, 0], S, { q: 'lo' }),
                p('nose', 'head', 'sphere', 0.1, [0, 0.35, 0.6], null, Pk, { q: 'lo' }),
                sym(p('eye*', 'head', 'ellipsoid', [0.04, 0.055, 0.03], [0.12, 0.47, 0.57], [0, 30, 0], E, { q: 'sm' })),
                p('seg1', 'seg1', 'sphere', 0.17, [0, 0.19, 0.18], null, B, { q: 'lo' }),
                p('seg2', 'seg2', 'sphere', 0.16, [0, 0.165, -0.04], null, B, { q: 'lo' }),
                p('seg3', 'seg3', 'sphere', 0.15, [0, 0.155, -0.25], null, B, { q: 'lo' }),
                p('seg4', 'seg4', 'sphere', 0.13, [0, 0.15, -0.44], null, B, { q: 'lo' }),
                p('seg5', 'seg4', 'sphere', 0.1, [0, 0.17, -0.6], null, Bd, { q: 'sm' }),
                p('sting', 'seg4', 'cone', [0.05, 0.22, 0.05], [0, 0.24, -0.74], [-60, 0, 0], S, { q: 'sm' }),
                sym(p('foot1*', 'seg1', 'sphere', 0.04, [0.09, 0.035, 0.22], null, Pk, { q: 'xs' })),
                sym(p('foot2*', 'seg2', 'sphere', 0.04, [0.09, 0.035, -0.02], null, Pk, { q: 'xs' })),
                sym(p('foot3*', 'seg3', 'sphere', 0.04, [0.09, 0.035, -0.24], null, Pk, { q: 'xs' })),
            ],
            pivots: { head: [0, 0.25, 0.3], seg1: [0, 0.19, 0.18], seg2: [0, 0.165, -0.04], seg3: [0, 0.155, -0.25], seg4: [0, 0.15, -0.44] },
            shiny: { '#D49A3E': '#D8C84A', '#B07A2A': '#A89A30' },
        });
    }
    // ===== #011 Metapod (casulo verde em crescente, ponta curva embaixo, olhos em fenda) =====
    {
        const G = '#6FB34E', D = '#4E8F38', E = '#1E1E1E', W = '#F4F4F4';
        def(11, {
            name: 'Metapod', rig: 'cocoon', meters: 0.7, height: pokemonModelHeight(0.7), radius: 0.42,
            parts: [
                p('top', 'body', 'ellipsoid', [0.3, 0.3, 0.3], [0, 0.66, 0.03], null, G, { q: 'md' }),
                p('crown', 'body', 'cone', [0.17, 0.22, 0.17], [0, 0.92, -0.06], [-30, 0, 0], G, { q: 'lo' }),
                p('mid', 'body', 'ellipsoid', [0.26, 0.3, 0.25], [0, 0.4, -0.02], [12, 0, 0], G, { q: 'md' }),
                p('low', 'body', 'cone', [0.17, 0.3, 0.16], [0, 0.15, 0.07], [200, 0, 0], G, { q: 'lo' }),
                p('band1', 'body', 'ellipsoid', [0.268, 0.028, 0.258], [0, 0.42, -0.02], [12, 0, 0], D, { q: 'lo' }),
                p('band2', 'body', 'ellipsoid', [0.22, 0.025, 0.21], [0, 0.26, 0.0], [16, 0, 0], D, { q: 'lo' }),
                p('lid', 'body', 'ellipsoid', [0.28, 0.06, 0.12], [0, 0.73, 0.2], [-18, 0, 0], D, { q: 'lo' }),
                sym(p('sclera*', 'body', 'ellipsoid', [0.085, 0.04, 0.03], [0.11, 0.65, 0.29], [0, 22, -8], W, { q: 'sm' })),
                sym(p('eye*', 'body', 'ellipsoid', [0.05, 0.03, 0.03], [0.105, 0.643, 0.303], [0, 22, -8], E, { q: 'sm' })),
            ],
            pivots: { body: [0, 0, 0] },
            shiny: { '#6FB34E': '#E89A3A', '#4E8F38': '#B86E26' },
        });
    }
    // ===== #014 Kakuna (gota amarela de ponta para baixo, capacete, bracinhos) =====
    {
        const Y = '#E5BB3A', D = '#B98F22', Cv = '#7A6428', E = '#1E1E1E', W = '#F4F4F4';
        def(14, {
            name: 'Kakuna', rig: 'cocoon', meters: 0.6, height: pokemonModelHeight(0.6), radius: 0.4,
            parts: [
                p('hood', 'body', 'ellipsoid', [0.25, 0.22, 0.26], [0, 0.76, 0.0], [-10, 0, 0], Y, { q: 'md' }),
                p('face', 'body', 'ellipsoid', [0.19, 0.11, 0.1], [0, 0.66, 0.17], [-5, 0, 0], Cv, { q: 'lo' }),
                sym(p('eye*', 'body', 'wedge', [0.12, 0.06, 0.03], [0.085, 0.67, 0.262], [0, 18, 180], E, { apex: -0.6 })),
                sym(p('shine*', 'body', 'sphere', 0.02, [0.085, 0.672, 0.285], null, W, { q: 'xs' })),
                p('mid', 'body', 'ellipsoid', [0.2, 0.28, 0.2], [0, 0.45, -0.02], null, Y, { q: 'md' }),
                p('band1', 'body', 'ellipsoid', [0.205, 0.025, 0.205], [0, 0.5, -0.02], null, D, { q: 'lo' }),
                p('band2', 'body', 'ellipsoid', [0.185, 0.025, 0.185], [0, 0.36, -0.02], null, D, { q: 'lo' }),
                p('low', 'body', 'cone', [0.15, 0.34, 0.15], [0, 0.17, 0.0], [180, 0, 0], Y, { q: 'lo' }),
                sym(p('nub*', 'body', 'cone', [0.055, 0.15, 0.05], [0.21, 0.5, 0.03], [0, 0, -75], Y, { q: 'sm' })),
            ],
            pivots: { body: [0, 0, 0] },
            shiny: { '#E5BB3A': '#9CC23E', '#B98F22': '#6E9228' },
        });
    }
    // ===== #016 Pidgey (passarinho gordo, topete curto, máscara preta, cauda em leque) =====
    {
        const B = '#A7744A', C = '#F1DCB0', M = '#2A2420', Bk = '#D99A86', Dk = '#7A5232', E = '#1E1E1E';
        def(16, {
            name: 'Pidgey', rig: 'bird', meters: 0.3, height: pokemonModelHeight(0.3), radius: 0.36, stride: 0.5,
            parts: [
                p('body', 'body', 'ellipsoid', [0.25, 0.25, 0.3], [0, 0.32, -0.04], [-20, 0, 0], B, { q: 'lo' }),
                p('chest', 'body', 'ellipsoid', [0.19, 0.2, 0.16], [0, 0.3, 0.1], [-10, 0, 0], C, { q: 'lo' }),
                p('head', 'head', 'ellipsoid', [0.21, 0.2, 0.2], [0, 0.62, 0.1], null, B, { q: 'md' }),
                p('face', 'head', 'ellipsoid', [0.16, 0.12, 0.12], [0, 0.56, 0.2], null, C, { q: 'sm' }),
                sym(p('mask*', 'head', 'ellipsoid', [0.08, 0.035, 0.08], [0.12, 0.645, 0.2], [0, 35, -10], M, { q: 'xs' })),
                sym(p('eye*', 'head', 'ellipsoid', [0.035, 0.045, 0.03], [0.1, 0.65, 0.255], [0, 30, 0], E, { q: 'xs' })),
                p('beak', 'head', 'cone', [0.05, 0.12, 0.04], [0, 0.58, 0.33], [100, 0, 0], Bk, { q: 'sm' }),
                p('crest1', 'head', 'cone', [0.055, 0.2, 0.035], [0, 0.82, 0.16], [-30, 0, 0], Dk, { q: 'sm' }),
                p('crest2', 'head', 'cone', [0.045, 0.16, 0.03], [0, 0.8, 0.07], [-60, 0, 0], B, { q: 'sm' }),
                sym(p('wing*', 'wing*', 'ellipsoid', [0.05, 0.17, 0.25], [0.24, 0.36, -0.07], [-25, 0, -8], B, { q: 'lo' })),
                sym(p('wtip*', 'wing*', 'ellipsoid', [0.045, 0.1, 0.13], [0.255, 0.27, -0.22], [-35, 0, -8], Dk, { q: 'xs' })),
                p('tail', 'tail', 'ellipsoid', [0.15, 0.03, 0.17], [0, 0.24, -0.4], [25, 0, 0], Dk, { q: 'sm' }),
                p('tailTip', 'tail', 'ellipsoid', [0.12, 0.028, 0.08], [0, 0.205, -0.52], [25, 0, 0], C, { q: 'sm' }),
                sym(p('leg*', 'leg*', 'cyl', [0.02, 0.12, 0.02], [0.08, 0.07, 0.02], null, Bk, { q: 'xs' })),
                sym(p('foot*', 'leg*', 'box', [0.06, 0.02, 0.09], [0.08, 0.01, 0.05], null, Bk)),
            ],
            pivots: { body: [0, 0.14, 0], head: [0, 0.48, 0.06], 'wing*': [0.18, 0.44, 0.02], tail: [0, 0.27, -0.28], 'leg*': [0.08, 0.14, 0.02] },
            shiny: { '#A7744A': '#D2B256', '#7A5232': '#A88A3A' },
        });
    }
    // ===== #019 Rattata (rato roxo, orelhas grandes, dentões, cauda em espiral) =====
    {
        const Pu = '#9A68AE', C = '#F1E0B4', Ey = '#C8202E', W = '#FFFFFF', Ns = '#E8A0B0';
        def(19, {
            name: 'Rattata', rig: 'quad', meters: 0.3, height: pokemonModelHeight(0.3), radius: 0.38, stride: 0.6,
            parts: [
                p('body', 'body', 'ellipsoid', [0.23, 0.21, 0.34], [0, 0.3, -0.06], [-8, 0, 0], Pu, { q: 'lo' }),
                p('belly', 'body', 'ellipsoid', [0.17, 0.13, 0.26], [0, 0.22, 0.0], null, C, { q: 'sm' }),
                p('head', 'head', 'ellipsoid', [0.23, 0.21, 0.23], [0, 0.46, 0.3], null, Pu, { q: 'md' }),
                p('muzzle', 'head', 'ellipsoid', [0.12, 0.09, 0.11], [0, 0.4, 0.49], [-10, 0, 0], C, { q: 'sm' }),
                p('nose', 'head', 'sphere', 0.03, [0, 0.44, 0.6], null, Ns, { q: 'xs' }),
                p('teeth', 'head', 'box', [0.08, 0.075, 0.02], [0, 0.32, 0.56], [-8, 0, 0], W),
                sym(p('eye*', 'head', 'ellipsoid', [0.06, 0.07, 0.04], [0.12, 0.52, 0.45], [0, 30, 0], Ey, { q: 'sm' })),
                sym(p('shine*', 'head', 'sphere', 0.018, [0.115, 0.55, 0.49], null, W, { q: 'xs' })),
                sym(p('ear*', 'ear*', 'ellipsoid', [0.14, 0.15, 0.035], [0.18, 0.72, 0.24], [0, 20, -25], Pu, { q: 'sm' })),
                sym(p('earIn*', 'ear*', 'ellipsoid', [0.1, 0.11, 0.02], [0.185, 0.715, 0.265], [0, 20, -25], C, { q: 'sm' })),
                sym(p('legF*', 'legF*', 'ellipsoid', [0.055, 0.11, 0.07], [0.14, 0.1, 0.18], null, Pu, { q: 'xs' })),
                sym(p('legB*', 'legB*', 'ellipsoid', [0.08, 0.13, 0.12], [0.15, 0.13, -0.24], [-10, 0, 0], Pu, { q: 'sm' })),
                link('tail1', 'tail', 'cyl', [0.24, -0.38], [0.42, -0.62], 0.03, 0.03, Pu, 0, { q: 'xs' }),
                link('tail2', 'tail', 'cyl', [0.41, -0.62], [0.66, -0.66], 0.028, 0.028, Pu, 0, { q: 'xs' }),
                link('tail3', 'tail', 'cyl', [0.65, -0.66], [0.74, -0.52], 0.026, 0.026, Pu, 0, { q: 'xs' }),
            ],
            pivots: { body: [0, 0.2, 0], head: [0, 0.4, 0.2], 'ear*': [0.13, 0.62, 0.26], 'legF*': [0.14, 0.2, 0.18], 'legB*': [0.15, 0.24, -0.24], tail: [0, 0.24, -0.36] },
            shiny: { '#9A68AE': '#B8C46A' },
        });
    }
    // ===== #046 Paras (inseto laranja baixo com dois cogumelos vermelhos nas costas) =====
    {
        const O = '#E8813A', Rc = '#D8402E', Sp = '#F6D45A', St = '#F2E2C0', Cl = '#F2D9A6', Ey = '#F4F4EE';
        const cap = (x) => [
            p('stem' + x, 'body', 'cyl', [0.06, 0.14, 0.06], [0.13 * x, 0.42, -0.06], null, St, { q: 'sm' }),
            p('cap' + x, 'body', 'ellipsoid', [0.2, 0.13, 0.19], [0.15 * x, 0.55, -0.05], [0, 0, -18 * x], Rc, { q: 'md' }),
            p('spA' + x, 'body', 'sphere', 0.035, [0.13 * x, 0.67, 0.02], null, Sp, { q: 'xs' }),
            p('spB' + x, 'body', 'sphere', 0.03, [0.24 * x, 0.6, -0.1], null, Sp, { q: 'xs' }),
        ];
        def(46, {
            name: 'Paras', rig: 'quad', meters: 0.3, height: pokemonModelHeight(0.3), radius: 0.4, stride: 0.45,
            parts: [
                p('body', 'body', 'ellipsoid', [0.28, 0.19, 0.3], [0, 0.24, -0.02], null, O, { q: 'md' }),
                p('head', 'head', 'ellipsoid', [0.2, 0.15, 0.14], [0, 0.25, 0.27], null, O, { q: 'lo' }),
                sym(p('eye*', 'head', 'ellipsoid', [0.055, 0.045, 0.03], [0.092, 0.302, 0.385], [0, 25, 0], Ey, { q: 'sm' })),
                cap(1), cap(-1),
                sym(p('claw*', 'arm*', 'cone', [0.055, 0.2, 0.045], [0.17, 0.14, 0.43], [80, 0, -15], Cl, { q: 'sm' })),
                sym(p('clawB*', 'arm*', 'cone', [0.035, 0.13, 0.03], [0.22, 0.12, 0.41], [80, 0, 15], Cl, { q: 'sm' })),
                sym(p('legF*', 'legF*', 'ellipsoid', [0.045, 0.1, 0.045], [0.25, 0.08, 0.1], [0, 0, -20], O, { q: 'xs' })),
                sym(p('legB*', 'legB*', 'ellipsoid', [0.045, 0.1, 0.045], [0.25, 0.08, -0.15], [0, 0, -20], O, { q: 'xs' })),
            ],
            pivots: { body: [0, 0.12, 0], head: [0, 0.22, 0.2], 'arm*': [0.13, 0.18, 0.32], 'legF*': [0.2, 0.16, 0.1], 'legB*': [0.2, 0.16, -0.15] },
            shiny: { '#E8813A': '#F0B83A', '#D8402E': '#5CA84A' },
        });
    }
    // ===== #012 Butterfree (corpo pequeno escuro, olhos vermelhos enormes, asas brancas em X com borda preta) =====
    {
        const Bd = '#4C4F9E', Ey = '#D8343F', Eh = '#FF8A90', Wg = '#F6F6FA', Vn = '#1F1F2A', W = '#FFFFFF', Lb = '#8FB8E8';
        def(12, {
            name: 'Butterfree', rig: 'insect', meters: 1.1, height: pokemonModelHeight(1.1), radius: 0.55, hover: 0.25, wingHz: 2.6,
            parts: [
                p('head', 'head', 'ellipsoid', [0.15, 0.14, 0.14], [0, 0.66, 0.06], null, Bd, { q: 'lo' }),
                sym(p('eye*', 'head', 'ellipsoid', [0.095, 0.11, 0.085], [0.1, 0.67, 0.12], [0, 20, 0], Ey, { q: 'lo' })),
                sym(p('eyeHi*', 'head', 'sphere', 0.028, [0.12, 0.72, 0.19], null, Eh, { q: 'xs' })),
                sym(p('fang*', 'head', 'cone', [0.018, 0.06, 0.018], [0.03, 0.55, 0.17], [180, 0, 0], W, { q: 'xs' })),
                p('body', 'body', 'ellipsoid', [0.1, 0.17, 0.1], [0, 0.42, -0.01], [-10, 0, 0], Bd, { q: 'lo' }),
                sym(p('arm*', 'arm*', 'ellipsoid', [0.035, 0.07, 0.035], [0.1, 0.46, 0.09], [-40, 0, -20], Lb, { q: 'sm' })),
                sym(p('leg*', 'leg*', 'ellipsoid', [0.035, 0.08, 0.035], [0.06, 0.24, 0.02], [0, 0, -10], Lb, { q: 'sm' })),
                sym(p('ant*', 'antenna*', 'cyl', [0.012, 0.22, 0.012], [0.05, 0.86, 0.06], [-10, 0, -22], Vn, { q: 'xs' })),
                sym(p('antTip*', 'antenna*', 'sphere', 0.025, [0.095, 0.965, 0.04], null, Vn, { q: 'xs' })),
                sym(p('wingU*', 'wing*', 'ellipsoid', [0.36, 0.27, 0.012], [0.34, 0.74, -0.1], [-25, -15, -22], Vn, { q: 'sm' })),
                sym(p('wingUw*', 'wing*', 'ellipsoid', [0.33, 0.245, 0.022], [0.34, 0.74, -0.1], [-25, -15, -22], Wg, { q: 'lo' })),
                sym(p('wingL*', 'wing*', 'ellipsoid', [0.23, 0.18, 0.012], [0.24, 0.36, -0.12], [-25, -15, 35], Vn, { q: 'sm' })),
                sym(p('wingLw*', 'wing*', 'ellipsoid', [0.21, 0.16, 0.022], [0.24, 0.36, -0.12], [-25, -15, 35], Wg, { q: 'lo' })),
            ],
            pivots: { body: [0, 0.3, 0], head: [0, 0.55, 0.03], 'wing*': [0.06, 0.52, -0.08], 'arm*': [0.08, 0.5, 0.05], 'leg*': [0.05, 0.3, 0.01], 'antenna*': [0.03, 0.76, 0.06] },
            shiny: { '#F6F6FA': '#F6C8DA', '#4C4F9E': '#6A5AB8' },
        });
    }
    // ===== #015 Beedrill (vespa amarela de pé no ar, lanças nos braços, abdômen listrado com ferrão) =====
    {
        const Y = '#F2C232', K = '#26262A', S = '#E6E8EE', Sb = '#9AA0AA', Ey = '#D9303A', Wg = '#DCEEFF';
        const ab = p('abdomen', 'body', 'ellipsoid', [0.14, 0.22, 0.15], [0, 0.38, -0.1], [25, 0, 0], Y, { q: 'md' });
        const lance = p('lance*', 'arm*', 'cone', [0.065, 0.32, 0.065], [0.22, 0.47, 0.22], [118, 0, -8], S, { q: 'lo' });
        def(15, {
            name: 'Beedrill', rig: 'insect', meters: 1.0, height: pokemonModelHeight(1.0), radius: 0.55, hover: 0.25, wingHz: 9,
            parts: [
                p('head', 'head', 'ellipsoid', [0.13, 0.13, 0.15], [0, 0.82, 0.08], null, Y, { q: 'lo' }),
                sym(p('eye*', 'head', 'ellipsoid', [0.06, 0.09, 0.06], [0.08, 0.84, 0.16], [0, 25, -15], Ey, { q: 'sm' })),
                sym(p('mand*', 'head', 'cone', [0.02, 0.06, 0.02], [0.035, 0.72, 0.2], [160, 0, 15], K, { q: 'xs' })),
                sym(p('ant*', 'antenna*', 'cyl', [0.012, 0.24, 0.012], [0.05, 1.0, 0.06], [-25, 0, -18], K, { q: 'xs' })),
                p('thorax', 'body', 'ellipsoid', [0.11, 0.12, 0.11], [0, 0.65, 0.02], null, K, { q: 'lo' }),
                ab,
                p('stripe1', 'body', 'ellipsoid', [0.142, 0.03, 0.152], [0, 0.472, -0.056], [25, 0, 0], K, { q: 'lo' }),
                p('stripe2', 'body', 'ellipsoid', [0.13, 0.03, 0.14], [0, 0.33, -0.124], [25, 0, 0], K, { q: 'lo' }),
                p('stinger', 'body', 'cone', [0.045, 0.2, 0.045], [0, 0.13, -0.2], [205, 0, 0], S, { q: 'sm' }),
                sym(p('upper*', 'arm*', 'ellipsoid', [0.035, 0.09, 0.035], [0.13, 0.6, 0.06], [-20, 0, -35], Y, { q: 'sm' })),
                sym(lance), sym(p('lanceB*', 'arm*', 'cyl', [0.07, 0.06, 0.07], [0.205, 0.56, 0.07], [118, 0, -8], Sb, { q: 'sm' })),
                sym(p('leg*', 'leg*', 'cyl', [0.014, 0.2, 0.014], [0.06, 0.5, 0.05], [10, 0, 10], K, { q: 'xs' })),
                sym(p('wingU*', 'wing*', 'ellipsoid', [0.24, 0.075, 0.012], [0.24, 0.8, -0.14], [-15, -25, 18], Wg, { q: 'disc' })),
                sym(p('wingD*', 'wing*', 'ellipsoid', [0.18, 0.06, 0.012], [0.2, 0.68, -0.15], [-15, -25, -12], Wg, { q: 'disc' })),
            ],
            pivots: { body: [0, 0.5, 0], head: [0, 0.72, 0.05], 'arm*': [0.1, 0.65, 0.04], 'wing*': [0.06, 0.72, -0.08], 'antenna*': [0.03, 0.9, 0.08], 'leg*': [0.05, 0.6, 0.04] },
            shiny: { '#F2C232': '#9ED04A' },
        });
    }
    // ===== #123 Scyther (chefe: louva-a-deus verde, foices brancas, asas, crista) =====
    {
        const G = '#6DBE53', Gd = '#4E9A3C', C = '#EFE2B0', S = '#E6ECEF', Wg = '#E4F2F6', E = '#1E1E1E';
        def(123, {
            name: 'Scyther', rig: 'biped', meters: 1.5, height: pokemonModelHeight(1.5), radius: 0.85, slash: true, runLean: 0.25, stride: 1.3,
            parts: [
                sym(p('thigh*', 'leg*', 'ellipsoid', [0.065, 0.13, 0.08], [0.1, 0.22, -0.04], [-20, 0, 0], G, { q: 'lo' })),
                sym(p('shin*', 'leg*', 'cyl', [0.03, 0.14, 0.03], [0.1, 0.09, 0.0], [15, 0, 0], G, { q: 'xs' })),
                sym(p('foot*', 'leg*', 'cone', [0.05, 0.14, 0.03], [0.1, 0.02, 0.07], [90, 0, 0], G, { q: 'sm' })),
                p('abdomen', 'body', 'ellipsoid', [0.1, 0.18, 0.12], [0, 0.34, -0.12], [40, 0, 0], C, { q: 'lo' }),
                p('band1', 'body', 'ellipsoid', [0.104, 0.02, 0.124], [0, 0.32, -0.135], [40, 0, 0], Gd, { q: 'sm' }),
                p('band2', 'body', 'ellipsoid', [0.09, 0.02, 0.105], [0, 0.24, -0.205], [40, 0, 0], Gd, { q: 'sm' }),
                p('thorax', 'body', 'ellipsoid', [0.12, 0.16, 0.12], [0, 0.55, 0.0], [-8, 0, 0], G, { q: 'md' }),
                p('chest', 'body', 'ellipsoid', [0.09, 0.11, 0.06], [0, 0.55, 0.08], null, C, { q: 'sm' }),
                p('neck', 'body', 'cyl', [0.04, 0.12, 0.04], [0, 0.72, 0.05], [20, 0, 0], G, { q: 'xs' }),
                p('head', 'head', 'ellipsoid', [0.11, 0.1, 0.14], [0, 0.82, 0.1], [10, 0, 0], G, { q: 'lo' }),
                p('crest', 'head', 'cone', [0.045, 0.2, 0.03], [0, 0.9, -0.02], [-65, 0, 0], G, { q: 'sm' }),
                p('jaw', 'head', 'ellipsoid', [0.06, 0.04, 0.06], [0, 0.76, 0.2], null, C, { q: 'sm' }),
                sym(p('eye*', 'head', 'ellipsoid', [0.035, 0.03, 0.045], [0.075, 0.84, 0.17], [0, 25, -15], E, { q: 'sm' })),
                sym(p('upper*', 'arm*', 'ellipsoid', [0.04, 0.11, 0.04], [0.15, 0.58, 0.08], [-40, 0, -15], G, { q: 'sm' })),
                sym(p('blade*', 'arm*', 'cone', [0.075, 0.5, 0.016], [0.19, 0.5, 0.33], [115, 90, 0], S, { q: 'sm' })),
                sym(p('wingA*', 'wing*', 'ellipsoid', [0.06, 0.32, 0.012], [0.12, 0.62, -0.2], [-55, 0, -25], Wg, { q: 'disc' })),
                sym(p('wingB*', 'wing*', 'ellipsoid', [0.05, 0.26, 0.012], [0.1, 0.5, -0.24], [-75, 0, -35], Wg, { q: 'disc' })),
            ],
            pivots: { body: [0, 0.32, 0], head: [0, 0.74, 0.06], 'arm*': [0.12, 0.64, 0.04], 'leg*': [0.1, 0.33, -0.04], 'wing*': [0.06, 0.64, -0.1] },
            shiny: { '#6DBE53': '#C4C83E', '#4E9A3C': '#9A9A2C' },
        });
    }
    // ===== #026 Raichu (evolução do herói: pera laranja, orelhas largas com curva, cauda preta longa com raio) =====
    {
        const O = '#E8913A', Bl = '#F6E0B2', Y = '#F6CF2E', Br = '#7A4A22', K = '#2A2420', E = '#1C1C1C', W = '#FFFFFF';
        def(26, {
            name: 'Raichu', rig: 'biped', meters: 0.8, height: pokemonModelHeight(0.8), radius: 0.48, runLean: 0.4, stride: 0.7,
            parts: [
                p('body', 'body', 'ellipsoid', [0.23, 0.25, 0.2], [0, 0.29, -0.01], null, O, { q: 'md' }),
                p('belly', 'body', 'ellipsoid', [0.17, 0.18, 0.1], [0, 0.26, 0.1], null, Bl, { q: 'lo' }),
                p('head', 'head', 'ellipsoid', [0.24, 0.2, 0.21], [0, 0.63, 0.02], null, O, { q: 'md' }),
                sym(p('ear*', 'ear*', 'ellipsoid', [0.11, 0.2, 0.035], [0.24, 0.86, -0.03], [0, 0, -42], Br, { q: 'lo' })),
                sym(p('earIn*', 'ear*', 'ellipsoid', [0.07, 0.14, 0.02], [0.235, 0.85, -0.003], [0, 0, -42], Y, { q: 'sm' })),
                sym(p('curl*', 'ear*', 'cone', [0.045, 0.12, 0.03], [0.4, 0.98, -0.03], [0, 0, -110], Br, { q: 'sm' })),
                sym(p('eye*', 'head', 'ellipsoid', [0.04, 0.054, 0.03], [0.1, 0.66, 0.2], [0, 22, 0], E, { q: 'sm' })),
                sym(p('shine*', 'head', 'sphere', 0.017, [0.09, 0.684, 0.224], null, W, { q: 'xs' })),
                sym(p('cheek*', 'head', 'ellipsoid', [0.06, 0.05, 0.025], [0.17, 0.56, 0.14], [0, 42, 0], Y, { q: 'sm' })),
                sym(p('arm*', 'arm*', 'ellipsoid', [0.045, 0.1, 0.045], [0.18, 0.35, 0.1], [-45, 0, -15], O, { q: 'lo' })),
                sym(p('thigh*', 'leg*', 'ellipsoid', [0.085, 0.1, 0.1], [0.13, 0.12, 0], null, O, { q: 'lo' })),
                sym(p('foot*', 'leg*', 'ellipsoid', [0.07, 0.035, 0.1], [0.125, 0.035, 0.06], null, Br, { q: 'sm' })),
                link('tail1', 'tail', 'cyl', [0.12, -0.17], [0.05, -0.5], 0.022, 0.022, K, 0, { q: 'xs' }),
                link('tail2', 'tail', 'cyl', [0.05, -0.5], [0.4, -0.76], 0.02, 0.02, K, 0, { q: 'xs' }),
                link('bolt1', 'tail', 'box', [0.38, -0.76], [0.52, -0.66], 0.035, 0.08, Y),
                link('bolt2', 'tail', 'box', [0.5, -0.7], [0.74, -0.86], 0.035, 0.16, Y),
            ],
            pivots: { body: [0, 0.2, 0], head: [0, 0.47, 0.02], 'ear*': [0.13, 0.76, 0], 'arm*': [0.16, 0.42, 0.05], 'leg*': [0.12, 0.2, 0], tail: [0, 0.13, -0.15] },
            shiny: { '#E8913A': '#E8B060', '#7A4A22': '#5A4A3A' },
        });
    }
    // ===== #001 Bulbasaur (quadrúpede teal com bulbo verde nas costas) =====
    {
        const Sk = '#7CC8B0', Sp = '#3E8E78', Bu = '#5DAE4A', Bd = '#3D7F36', Ir = '#C8303A', W = '#FFFFFF', E = '#1E1E1E';
        def(1, {
            name: 'Bulbasaur', rig: 'quad', meters: 0.7, height: pokemonModelHeight(0.7), radius: 0.48, stride: 0.6,
            parts: [
                p('body', 'body', 'ellipsoid', [0.27, 0.2, 0.3], [0, 0.27, -0.05], null, Sk, { q: 'md' }),
                p('bulb', 'body', 'ellipsoid', [0.23, 0.22, 0.23], [0, 0.55, -0.1], null, Bu, { q: 'md' }),
                p('bulbTip', 'body', 'cone', [0.1, 0.15, 0.1], [0, 0.8, -0.12], [-8, 0, 0], Bu, { q: 'lo' }),
                p('fold1', 'body', 'ellipsoid', [0.04, 0.2, 0.235], [0, 0.56, -0.1], null, Bd, { q: 'sm' }),
                p('fold2', 'body', 'ellipsoid', [0.04, 0.2, 0.235], [0, 0.56, -0.1], [0, 60, 0], Bd, { q: 'sm' }),
                p('fold3', 'body', 'ellipsoid', [0.04, 0.2, 0.235], [0, 0.56, -0.1], [0, -60, 0], Bd, { q: 'sm' }),
                p('head', 'head', 'ellipsoid', [0.26, 0.2, 0.23], [0, 0.4, 0.3], null, Sk, { q: 'md' }),
                sym(p('ear*', 'ear*', 'cone', [0.055, 0.1, 0.04], [0.17, 0.6, 0.26], [0, 0, -28], Sk, { q: 'sm' })),
                sym(p('sclera*', 'head', 'ellipsoid', [0.065, 0.06, 0.03], [0.13, 0.45, 0.48], [0, 32, 0], W, { q: 'sm' })),
                sym(p('iris*', 'head', 'ellipsoid', [0.045, 0.05, 0.025], [0.14, 0.45, 0.495], [0, 32, 0], Ir, { q: 'sm' })),
                sym(p('pupil*', 'head', 'sphere', 0.018, [0.148, 0.452, 0.513], null, E, { q: 'xs' })),
                sym(p('spotH*', 'head', 'ellipsoid', [0.04, 0.03, 0.04], [0.07, 0.58, 0.32], null, Sp, { q: 'xs' })),
                sym(p('spotB*', 'body', 'ellipsoid', [0.03, 0.05, 0.06], [0.26, 0.3, -0.02], null, Sp, { q: 'xs' })),
                sym(p('legF*', 'legF*', 'ellipsoid', [0.075, 0.12, 0.085], [0.18, 0.1, 0.12], null, Sk, { q: 'sm' })),
                sym(p('legB*', 'legB*', 'ellipsoid', [0.08, 0.12, 0.09], [0.18, 0.1, -0.22], null, Sk, { q: 'sm' })),
            ],
            pivots: { body: [0, 0.15, 0], head: [0, 0.35, 0.15], 'ear*': [0.14, 0.55, 0.26], 'legF*': [0.18, 0.2, 0.12], 'legB*': [0.18, 0.2, -0.22] },
            shiny: { '#7CC8B0': '#A8D27A', '#3E8E78': '#6E9A3E', '#5DAE4A': '#C8A84A', '#3D7F36': '#9A7A2E' },
        });
    }
    // ===== #004 Charmander (bípede laranja, cabeça grande, cauda com chama) =====
    {
        const O = '#F28A3C', Bl = '#F8DE9A', Ir = '#2E6BC8', E = '#1E1E1E', W = '#FFFFFF', F1 = '#FF5A1A', F2 = '#FFE36A';
        def(4, {
            name: 'Charmander', rig: 'biped', meters: 0.6, height: pokemonModelHeight(0.6), radius: 0.42, runLean: 0.22, stride: 0.6,
            parts: [
                p('body', 'body', 'ellipsoid', [0.18, 0.22, 0.16], [0, 0.31, 0], null, O, { q: 'md' }),
                p('belly', 'body', 'ellipsoid', [0.13, 0.17, 0.08], [0, 0.29, 0.1], null, Bl, { q: 'lo' }),
                p('head', 'head', 'ellipsoid', [0.21, 0.2, 0.2], [0, 0.7, 0.03], null, O, { q: 'md' }),
                p('snout', 'head', 'ellipsoid', [0.14, 0.09, 0.11], [0, 0.63, 0.16], null, O, { q: 'lo' }),
                sym(p('eye*', 'head', 'ellipsoid', [0.042, 0.062, 0.03], [0.1, 0.73, 0.19], [0, 25, 0], Ir, { q: 'sm' })),
                sym(p('pupil*', 'head', 'ellipsoid', [0.026, 0.045, 0.02], [0.103, 0.735, 0.208], [0, 25, 0], E, { q: 'xs' })),
                sym(p('shine*', 'head', 'sphere', 0.014, [0.095, 0.76, 0.215], null, W, { q: 'xs' })),
                sym(p('arm*', 'arm*', 'ellipsoid', [0.04, 0.1, 0.04], [0.17, 0.38, 0.08], [-45, 0, -20], O, { q: 'sm' })),
                sym(p('thigh*', 'leg*', 'ellipsoid', [0.07, 0.1, 0.08], [0.1, 0.12, 0], null, O, { q: 'lo' })),
                sym(p('foot*', 'leg*', 'ellipsoid', [0.06, 0.035, 0.09], [0.1, 0.035, 0.05], null, O, { q: 'sm' })),
                link('tail1', 'tail', 'cyl', [0.16, -0.12], [0.2, -0.36], 0.065, 0.065, O, 0, { taper: 0.7, q: 'sm' }),
                link('tail2', 'tail', 'cyl', [0.18, -0.34], [0.34, -0.48], 0.045, 0.045, O, 0, { taper: 0.8, q: 'sm' }),
                p('flame', 'tail', 'cone', [0.08, 0.24, 0.08], [0, 0.46, -0.5], [-15, 0, 0], F1, { q: 'lo' }),
                p('flameIn', 'tail', 'cone', [0.05, 0.16, 0.05], [0, 0.43, -0.48], [-15, 0, 0], F2, { q: 'sm' }),
            ],
            pivots: { body: [0, 0.2, 0], head: [0, 0.5, 0.02], 'arm*': [0.15, 0.44, 0.04], 'leg*': [0.1, 0.2, 0], tail: [0, 0.16, -0.1] },
            shiny: { '#F28A3C': '#F2C64A' },
        });
    }
    // ===== #007 Squirtle (bípede azul com casco marrom de borda clara, cauda enrolada) =====
    {
        const Sk = '#7CC6E6', Sh = '#B47A3A', Rm = '#F2EEDC', Pl = '#F2D98C', Ir = '#8A3A2A', E = '#1E1E1E', W = '#FFFFFF';
        def(7, {
            name: 'Squirtle', rig: 'biped', meters: 0.5, height: pokemonModelHeight(0.5), radius: 0.42, runLean: 0.2, stride: 0.55,
            parts: [
                p('body', 'body', 'ellipsoid', [0.19, 0.22, 0.17], [0, 0.31, 0], null, Sk, { q: 'lo' }),
                p('shell', 'body', 'ellipsoid', [0.23, 0.26, 0.17], [0, 0.32, -0.07], null, Sh, { q: 'md' }),
                p('rim', 'body', 'ellipsoid', [0.24, 0.265, 0.07], [0, 0.32, 0.02], null, Rm, { q: 'lo' }),
                p('plate', 'body', 'ellipsoid', [0.17, 0.21, 0.08], [0, 0.3, 0.07], null, Pl, { q: 'lo' }),
                p('head', 'head', 'ellipsoid', [0.22, 0.2, 0.21], [0, 0.7, 0.05], null, Sk, { q: 'md' }),
                sym(p('eye*', 'head', 'ellipsoid', [0.045, 0.065, 0.03], [0.1, 0.73, 0.23], [0, 25, 0], Ir, { q: 'sm' })),
                sym(p('pupil*', 'head', 'ellipsoid', [0.028, 0.045, 0.02], [0.103, 0.73, 0.25], [0, 25, 0], E, { q: 'xs' })),
                sym(p('shine*', 'head', 'sphere', 0.015, [0.095, 0.76, 0.253], null, W, { q: 'xs' })),
                sym(p('arm*', 'arm*', 'ellipsoid', [0.045, 0.1, 0.045], [0.21, 0.38, 0.06], [-30, 0, -30], Sk, { q: 'sm' })),
                sym(p('thigh*', 'leg*', 'ellipsoid', [0.07, 0.1, 0.08], [0.11, 0.12, 0.0], null, Sk, { q: 'lo' })),
                sym(p('foot*', 'leg*', 'ellipsoid', [0.06, 0.035, 0.09], [0.11, 0.035, 0.05], null, Sk, { q: 'sm' })),
                p('tail', 'tail', 'ellipsoid', [0.07, 0.13, 0.12], [0, 0.2, -0.3], [-30, 0, 0], Sk, { q: 'lo' }),
                p('curl', 'tail', 'ellipsoid', [0.06, 0.08, 0.08], [0, 0.32, -0.38], null, Sk, { q: 'sm' }),
            ],
            pivots: { body: [0, 0.2, 0], head: [0, 0.52, 0.04], 'arm*': [0.17, 0.44, 0.03], 'leg*': [0.11, 0.2, 0], tail: [0, 0.18, -0.2] },
            shiny: { '#7CC6E6': '#5AA8D8', '#B47A3A': '#C8963A' },
        });
    }

    return R;
})();
// ordem de prioridade (herói, enxame da floresta, elites, chefe, evolução, iniciais)
const POKEMON_MODEL_IDS = [25, 10, 13, 11, 14, 16, 19, 46, 12, 15, 123, 26, 1, 4, 7].filter(id => POKEMON_MODEL_RECIPES[id]);

// ---------------- matemática pura ----------------
// matriz de rotação XYZ (igual a Matrix4.makeRotationFromEuler do Three.js), em radianos: devolve m[0..8] linha a linha
function _pmRotMatrix(r) {
    const a = Math.cos(r[0]), b = Math.sin(r[0]), c = Math.cos(r[1]), d = Math.sin(r[1]), e = Math.cos(r[2]), f = Math.sin(r[2]);
    const ae = a * e, af = a * f, be = b * e, bf = b * f;
    return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}
function _pmRotate(r, x, y, z) { const m = _pmRotMatrix(r); return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]; }

// nível de detalhe de uma parte: explícito (q) ou pelo tamanho
function _pmLevel(part) {
    if (part.q && POKEMON_MODEL_LOD[part.q]) return part.q;
    const r = Math.max(part.size[0], part.size[1], part.size[2]);
    return r >= 0.15 ? 'md' : r >= 0.06 ? 'lo' : r >= 0.025 ? 'sm' : 'xs';
}
function _pmRadial(part) { const q = part.q; return q === 'xs' ? 4 : q === 'sm' ? 5 : q === 'hi' ? 8 : 6; }
function _pmCapsuleK(part) { const k = part.size[1] / (2 * part.size[0]) - 1; return Math.max(0, Math.round(k * 4) / 4); }
// chave da geometria unitária (compartilhada por todas as partes com a mesma forma e o mesmo detalhe)
function _pmGeoKey(part) {
    const s = part.shape;
    if (s === 'sphere' || s === 'ellipsoid') return 'S' + POKEMON_MODEL_LOD[_pmLevel(part)].join('x');
    if (s === 'capsule') { const L = POKEMON_MODEL_LOD[part.q === 'sm' ? 'sm' : 'lo']; return 'P' + L.join('x') + 'k' + _pmCapsuleK(part); }
    if (s === 'box') return 'B';
    if (s === 'wedge') return 'W' + (part.apex || 0);
    if (s === 'cone' || s === 'ear') return 'C' + _pmRadial(part);
    if (s === 'cyl') return 'Y' + _pmRadial(part) + 't' + (part.taper == null ? 1 : part.taper);
    return null;
}
function _pmTriangles(part) {
    const s = part.shape;
    if (s === 'sphere' || s === 'ellipsoid') { const [w, h] = POKEMON_MODEL_LOD[_pmLevel(part)]; return w * (2 * h - 2); }
    if (s === 'capsule') { const [w, h] = POKEMON_MODEL_LOD[part.q === 'sm' ? 'sm' : 'lo']; return w * 2 * (h + (h % 2)); }
    if (s === 'box') return 12;
    if (s === 'wedge') return 8;
    if (s === 'cone' || s === 'ear') return 2 * _pmRadial(part);
    if (s === 'cyl') { const n = _pmRadial(part); return (part.taper === 0 ? 2 : 4) * n; }
    return 0;
}
// escala aplicada à geometria unitária
function _pmScale(part) {
    const s = part.size;
    if (part.shape === 'capsule') { const k = _pmCapsuleK(part); return [s[0], s[1] / (2 * (1 + k)), s[2]]; }
    return [s[0], s[1], s[2]];
}

// ---------------- geometria unitária (arrays puros: posições, normais, índices) ----------------
const _pmUnitCache = new Map();
function _pmUnit(part) {
    const key = _pmGeoKey(part);
    let g = _pmUnitCache.get(key);
    if (g) return g;
    const P = [], N = [], I = [];
    const s = part.shape;
    if (s === 'sphere' || s === 'ellipsoid' || s === 'capsule') {
        const cap = s === 'capsule';
        const lv = cap ? POKEMON_MODEL_LOD[part.q === 'sm' ? 'sm' : 'lo'] : POKEMON_MODEL_LOD[_pmLevel(part)];
        const w = lv[0], h = cap ? lv[1] + (lv[1] % 2) : lv[1], k = cap ? _pmCapsuleK(part) : 0;
        const rows = [];                                   // [ângulo polar, deslocamento em y]
        if (cap) { for (let iy = 0; iy <= h / 2; iy++) rows.push([iy / h * Math.PI, k]); for (let iy = h / 2; iy <= h; iy++) rows.push([iy / h * Math.PI, -k]); }
        else for (let iy = 0; iy <= h; iy++) rows.push([iy / h * Math.PI, 0]);
        for (const [th, off] of rows) for (let ix = 0; ix <= w; ix++) {
            const ph = ix / w * Math.PI * 2, x = -Math.cos(ph) * Math.sin(th), y = Math.cos(th), z = Math.sin(ph) * Math.sin(th);
            P.push(x, y + off, z); N.push(x, y, z);
        }
        const nr = rows.length;
        for (let iy = 0; iy < nr - 1; iy++) for (let ix = 0; ix < w; ix++) {
            const a = iy * (w + 1) + ix + 1, b = iy * (w + 1) + ix, c = (iy + 1) * (w + 1) + ix, d = (iy + 1) * (w + 1) + ix + 1;
            if (iy !== 0) I.push(a, b, d);
            if (iy !== nr - 2) I.push(b, c, d);
        }
    } else if (s === 'box') {
        const F = [[1, 0, 0, 0, 0, -1, 0, 1, 0], [-1, 0, 0, 0, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0, -1], [0, -1, 0, 1, 0, 0, 0, 0, 1], [0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 0, -1, -1, 0, 0, 0, 1, 0]];
        for (const f of F) {
            const b = P.length / 3;
            for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                P.push(f[0] * 0.5 + f[3] * su * 0.5 + f[6] * sv * 0.5, f[1] * 0.5 + f[4] * su * 0.5 + f[7] * sv * 0.5, f[2] * 0.5 + f[5] * su * 0.5 + f[8] * sv * 0.5);
                N.push(f[0], f[1], f[2]);
            }
            I.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
    } else if (s === 'wedge') {
        const ap = (part.apex || 0) * 0.5, T2 = [[-0.5, -0.5], [0.5, -0.5], [ap, 0.5]];
        let b = 0;
        P.push(T2[0][0], T2[0][1], 0.5, T2[1][0], T2[1][1], 0.5, T2[2][0], T2[2][1], 0.5); N.push(0, 0, 1, 0, 0, 1, 0, 0, 1); I.push(0, 1, 2);
        P.push(T2[0][0], T2[0][1], -0.5, T2[2][0], T2[2][1], -0.5, T2[1][0], T2[1][1], -0.5); N.push(0, 0, -1, 0, 0, -1, 0, 0, -1); I.push(3, 4, 5);
        b = 6;
        for (let e = 0; e < 3; e++) {
            const A = T2[e], B = T2[(e + 1) % 3], dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy), nx = dy / l, ny = -dx / l;
            P.push(A[0], A[1], -0.5, B[0], B[1], -0.5, B[0], B[1], 0.5, A[0], A[1], 0.5);
            for (let q = 0; q < 4; q++) N.push(nx, ny, 0);
            I.push(b, b + 1, b + 2, b, b + 2, b + 3); b += 4;
        }
    } else {                                                // cyl / cone / ear: raio 1 embaixo, `taper` em cima, altura 1, centrado
        const n = _pmRadial(part), tp = (s === 'cyl') ? (part.taper == null ? 1 : part.taper) : 0, slope = 1 - tp, nl = Math.hypot(1, slope);
        for (const [y, r] of [[0.5, tp], [-0.5, 1]]) for (let x = 0; x <= n; x++) {
            const th = x / n * Math.PI * 2, sx = Math.sin(th), cz = Math.cos(th);
            P.push(r * sx, y, r * cz); N.push(sx / nl, slope / nl, cz / nl);
        }
        for (let x = 0; x < n; x++) {
            const a = x, b2 = n + 1 + x, c = n + 1 + x + 1, d = x + 1;
            if (tp > 0) I.push(a, b2, d);
            I.push(b2, c, d);
        }
        for (const [y, r, top] of (tp > 0 ? [[0.5, tp, true], [-0.5, 1, false]] : [[-0.5, 1, false]])) {
            const c0 = P.length / 3; P.push(0, y, 0); N.push(0, top ? 1 : -1, 0);
            const r0 = P.length / 3;
            for (let x = 0; x <= n; x++) { const th = x / n * Math.PI * 2; P.push(r * Math.sin(th), y, r * Math.cos(th)); N.push(0, top ? 1 : -1, 0); }
            for (let x = 0; x < n; x++) { if (top) I.push(r0 + x, r0 + x + 1, c0); else I.push(r0 + x + 1, r0 + x, c0); }
        }
    }
    g = { p: new Float32Array(P), n: new Float32Array(N), i: I.length > 65535 ? new Uint32Array(I) : new Uint16Array(I) };
    _pmUnitCache.set(key, g);
    return g;
}

// percorre os vértices transformados de uma parte: fn(px, py, pz, nx, ny, nz)
function _pmEachVertex(part, fn) {
    const u = _pmUnit(part), s = _pmScale(part), m = _pmRotMatrix(part.rot.map(d => d * Math.PI / 180)), t = part.pos;
    for (let v = 0; v < u.p.length; v += 3) {
        const x = u.p[v] * s[0], y = u.p[v + 1] * s[1], z = u.p[v + 2] * s[2];
        let nx = u.n[v] / s[0], ny = u.n[v + 1] / s[1], nz = u.n[v + 2] / s[2];
        const mx = m[0] * nx + m[1] * ny + m[2] * nz, my = m[3] * nx + m[4] * ny + m[5] * nz, mz = m[6] * nx + m[7] * ny + m[8] * nz, l = Math.hypot(mx, my, mz) || 1;
        fn(m[0] * x + m[1] * y + m[2] * z + t[0], m[3] * x + m[4] * y + m[5] * z + t[1], m[6] * x + m[7] * y + m[8] * z + t[2], mx / l, my / l, mz / l);
    }
}

// ---------------- informação pura ----------------
function pokemonModelHas(id) { return Object.prototype.hasOwnProperty.call(POKEMON_MODEL_RECIPES, Number(id)) && !!POKEMON_MODEL_RECIPES[Number(id)]; }
const _pmInfoCache = new Map();
// receita normalizada para o mundo: base em y = 0, topo em `height` (escala uniforme)
function pokemonModelInfo(id) {
    id = Number(id);
    if (!pokemonModelHas(id)) return null;
    let info = _pmInfoCache.get(id);
    if (info) return info;
    const rc = POKEMON_MODEL_RECIPES[id];
    let minY = Infinity, maxY = -Infinity;
    for (const part of rc.parts) _pmEachVertex(part, (x, y) => { if (y < minY) minY = y; if (y > maxY) maxY = y; });
    const k = rc.height / (maxY - minY), sc = (v) => [v[0] * k, (v[1] - minY) * k, v[2] * k];
    const parts = rc.parts.map(pt => Object.assign({}, pt, { size: pt.size.map(v => v * k), pos: sc(pt.pos), rot: pt.rot.slice() }));
    const pivots = {};
    for (const g of new Set(parts.map(pt => pt.group))) {
        if (rc.pivots && rc.pivots[g]) pivots[g] = sc(rc.pivots[g]);
        else { const ps = parts.filter(pt => pt.group === g); pivots[g] = [0, 1, 2].map(a => ps.reduce((acc, pt) => acc + pt.pos[a], 0) / ps.length); }
    }
    if (!pivots.body) pivots.body = [0, 0, 0];
    let triangles = 0; for (const pt of parts) triangles += _pmTriangles(pt);
    info = { id, name: rc.name || '', rig: rc.rig, height: rc.height, radius: rc.radius, parts, pivots, triangles, scale: k,
        hover: (rc.hover || 0), stride: (rc.stride || rc.height * 0.9), runLean: rc.runLean || 0, slash: !!rc.slash, wingHz: rc.wingHz || 0 };
    _pmInfoCache.set(id, info);
    return info;
}
// pai padrão de cada grupo animável (orelhas e antenas presas à cabeça; pernas e segmentos à raiz, para os pés não subirem com o corpo)
function _pmParentOf(g, groups) {
    let par = 'root';
    if (g === 'body' || /^leg|^seg/.test(g)) par = 'root';
    else if (/^ear|^antenna|^horn|^crest|^eye/.test(g)) par = 'head';
    else if (g === 'head' || /^arm|^wing|^tail|^shell/.test(g)) par = 'body';
    if (par !== 'root' && !groups.has(par)) par = par === 'head' && groups.has('body') ? 'body' : 'root';
    return par === g ? 'root' : par;
}
// cor shiny: paleta da receita ou regra geral (gira o matiz das cores saturadas)
function pokemonModelColor(id, hex, shiny) {
    if (!shiny) return hex;
    const rc = POKEMON_MODEL_RECIPES[Number(id)], map = rc && rc.shiny;
    if (map) { const hit = map[hex] || map[String(hex).toUpperCase()]; return hit || hex; }
    const n = parseInt(String(hex).slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 0.18 || l < 0.15 || l > 0.92) return hex;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360 + 140) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return '#' + to(rr) + to(gg) + to(bb);
}

// ---------------- parte 3D: caches por instância do Three.js ----------------
const _pmCaches = new WeakMap();
function _pmCache(T) { let c = _pmCaches.get(T); if (!c) { c = { geo: new Map(), mat: new Map(), fused: new Map(), vc: null }; _pmCaches.set(T, c); } return c; }
function _pmUnitGeometry(T, part) {
    const c = _pmCache(T), key = _pmGeoKey(part);
    let g = c.geo.get(key);
    if (!g) {
        const u = _pmUnit(part); g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(u.p, 3)); g.setAttribute('normal', new T.BufferAttribute(u.n, 3)); g.setIndex(new T.BufferAttribute(u.i, 1));
        g.computeBoundingSphere(); g.userData.pokemonModelShared = true; c.geo.set(key, g);
    }
    return g;
}
function _pmColorMat(T, hex) {
    const c = _pmCache(T); let m = c.mat.get(hex);
    if (!m) { m = new T.MeshLambertMaterial({ color: hex }); m.userData.pokemonModelShared = true; c.mat.set(hex, m); }
    return m;
}
function pokemonModelMaterial(T) {
    const c = _pmCache(T);
    if (!c.vc) { c.vc = new T.MeshLambertMaterial({ vertexColors: true }); c.vc.userData.pokemonModelShared = true; }
    return c.vc;
}
function disposePokemonModels(T) {
    const c = _pmCaches.get(T); if (!c) return;
    for (const g of c.geo.values()) g.dispose(); for (const m of c.mat.values()) m.dispose(); for (const g of c.fused.values()) g.dispose();
    if (c.vc) c.vc.dispose();
    _pmCaches.delete(T);
}

// Group articulado: outer (do chamador: posição, rotation.y = face) → root (da animação: salto, achatar, tombar) → grupos
function buildPokemonModel(T, id, opts) {
    const info = pokemonModelInfo(id); if (!info) return null;
    const shiny = !!(opts && opts.shiny), outer = new T.Group(), root = new T.Group();
    root.name = 'root'; outer.add(root); outer.name = 'pokemon-' + info.id;
    const names = new Set(info.parts.map(pt => pt.group)); names.add('body');
    const groups = { root }, order = [];
    const make = (g) => {
        if (groups[g]) return groups[g];
        const parName = _pmParentOf(g, names), par = parName === 'root' ? root : make(parName);
        const o = new T.Group(); o.name = g; groups[g] = o; par.add(o);
        const pv = info.pivots[g] || [0, 0, 0], pp = parName === 'root' ? [0, 0, 0] : (info.pivots[parName] || [0, 0, 0]);
        o.position.set(pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]);
        o.userData.p0 = [o.position.x, o.position.y, o.position.z];
        o.userData.side = /L$/.test(g) ? 1 : /R$/.test(g) ? -1 : 0;
        order.push(o);
        return o;
    };
    for (const g of names) make(g);
    const D = Math.PI / 180;
    for (const pt of info.parts) {
        const mesh = new T.Mesh(_pmUnitGeometry(T, pt), _pmColorMat(T, pokemonModelColor(info.id, pt.color, shiny)));
        const pv = info.pivots[pt.group] || [0, 0, 0], s = _pmScale(pt);
        mesh.position.set(pt.pos[0] - pv[0], pt.pos[1] - pv[1], pt.pos[2] - pv[2]);
        mesh.rotation.set(pt.rot[0] * D, pt.rot[1] * D, pt.rot[2] * D); mesh.scale.set(s[0], s[1], s[2]);
        mesh.name = pt.id; groups[pt.group].add(mesh);
    }
    outer.userData = { rig: info.rig, height: info.height, radius: info.radius, groups, speciesId: info.id, shiny,
        hover: info.hover * info.height, stride: info.stride, runLean: info.runLean, slash: info.slash, wingHz: info.wingHz,
        _order: order, _state: '', _st: 0, _cyc: 0, _seed: (info.id * 0.618) % 1 * 6.283 };
    return outer;
}

// Geometria única fundida (posição, normal, cor por vértice), em cache por espécie e paleta. Não descarte: é compartilhada
// (use disposePokemonModels ao sair da cena).
function buildPokemonGeometry(T, id, opts) {
    const info = pokemonModelInfo(id); if (!info) return null;
    const shiny = !!(opts && opts.shiny), c = _pmCache(T), key = info.id + (shiny ? 's' : '');
    let geo = c.fused.get(key);
    if (geo) return geo;
    let nv = 0, ni = 0;
    for (const pt of info.parts) { const u = _pmUnit(pt); nv += u.p.length / 3; ni += u.i.length; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const color = new T.Color();
    let v = 0, k = 0;
    for (const pt of info.parts) {
        const u = _pmUnit(pt), base = v;
        color.set(pokemonModelColor(info.id, pt.color, shiny));
        _pmEachVertex(pt, (x, y, z, nx, ny, nz) => { const o = v * 3; pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz; col[o] = color.r; col[o + 1] = color.g; col[o + 2] = color.b; v++; });
        for (let i = 0; i < u.i.length; i++) idx[k++] = u.i[i] + base;
    }
    geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nrm, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setIndex(new T.BufferAttribute(idx, 1)); geo.computeBoundingBox(); geo.computeBoundingSphere();
    geo.userData = { pokemonModelShared: true, speciesId: info.id, shiny, triangles: ni / 3, rig: info.rig, height: info.height, radius: info.radius };
    c.fused.set(key, geo);
    return geo;
}

// ---------------- animação ----------------
const _pmTAU = Math.PI * 2;
const _PM_TWITCH = ['earL', 'earR', 'antennaL', 'antennaR'], _PM_EARS = ['earL', 'earR'], _PM_SEGS = ['seg1', 'seg2', 'seg3', 'seg4', 'seg5'];
function _pmClamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function _pmEase(x) { x = _pmClamp01(x); return x * x * (3 - 2 * x); }
// envelope de golpe: sobe até `up` segundos e volta a 0 em `down` segundos
function _pmPulse(t, up, down) { return t < up ? _pmEase(t / up) : 1 - _pmEase((t - up) / down); }

// Anima o modelo articulado. t = relógio (s), dt = passo (s), speed01 = velocidade/POKEMON_MODEL_REF_SPEED (0..1).
// Guarda o tempo no estado em userData (troca de estado zera). Não aloca.
function animatePokemonModel(model, state, t, dt, speed01) {
    const U = model && model.userData; if (!U || !U.groups) return;
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0; t = Number.isFinite(t) ? t : 0;
    if (U._state !== state) { U._state = state; U._st = 0; } else U._st += dt;
    const st = U._st, G = U.groups, H = U.height, rig = U.rig, root = G.root, tt = t + U._seed;
    for (let i = 0; i < U._order.length; i++) { const o = U._order[i], p0 = o.userData.p0; o.position.set(p0[0], p0[1], p0[2]); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); }
    root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1); root.visible = true;
    const sp = state === 'move' ? Math.max(0.15, _pmClamp01(Number.isFinite(speed01) ? speed01 : 1)) : 0;
    const air = rig === 'insect' || (rig === 'bird' && state === 'move');
    // ciclo de passos: a frequência acompanha a velocidade (passada = stride), com teto para não virar borrão
    if (state === 'move') U._cyc = (U._cyc + dt * _pmTAU * Math.min(4.2, Math.max(1.4, sp * POKEMON_MODEL_REF_SPEED / U.stride))) % (_pmTAU * 1000);
    const cyc = U._cyc, body = G.body, head = G.head;
    // ----- repouso e locomoção por rig -----
    const breath = Math.sin(tt * _pmTAU * 0.6);
    if (body) body.scale.set(1 - 0.012 * breath, 1 + 0.03 * breath, 1 - 0.012 * breath);
    if (head) head.rotation.x = 0.04 * Math.sin(tt * _pmTAU * 0.35);
    const twitch = (tt % 3.3) < 0.16 ? Math.sin((tt % 3.3) / 0.16 * Math.PI) : 0;
    for (let i = 0; i < 4; i++) {
        const n = _PM_TWITCH[i], o = G[n]; if (!o) continue; const s = o.userData.side;
        o.rotation.z = s * (0.05 * Math.sin(tt * _pmTAU * (n[0] === 'a' ? 2.6 : 0.5)) + (n === 'earL' ? 0.3 * twitch : 0));
    }
    if (G.tail) { G.tail.rotation.z = 0.14 * Math.sin(tt * _pmTAU * 1.1); }
    if (rig === 'biped' || rig === 'quad') {
        if (state === 'move') {
            const s1 = Math.sin(cyc), bob = Math.abs(Math.sin(cyc)), A = 0.45 + 0.4 * sp;
            const lean = (U.runLean || 0.12) * sp;
            root.position.y = bob * 0.07 * H * (0.5 + sp);
            if (body) body.rotation.x = lean;
            if (head) head.rotation.x = -lean * 0.75 + 0.05 * Math.sin(cyc * 2);
            if (rig === 'biped') {
                if (G.legL) G.legL.rotation.x = s1 * A; if (G.legR) G.legR.rotation.x = -s1 * A;
                if (G.armL) G.armL.rotation.x = -s1 * A * 0.9 - lean * 0.6; if (G.armR) G.armR.rotation.x = s1 * A * 0.9 - lean * 0.6;
            } else {
                if (G.legFL) G.legFL.rotation.x = s1 * A; if (G.legBR) G.legBR.rotation.x = s1 * A;
                if (G.legFR) G.legFR.rotation.x = -s1 * A; if (G.legBL) G.legBL.rotation.x = -s1 * A;
                if (G.armL) G.armL.rotation.x = 0.2 * s1; if (G.armR) G.armR.rotation.x = -0.2 * s1;
            }
            if (G.tail) { G.tail.rotation.x = -0.35 * sp; G.tail.rotation.y = 0.25 * Math.sin(cyc); }
            for (let i = 0; i < 2; i++) if (G[_PM_EARS[i]]) G[_PM_EARS[i]].rotation.x = -0.25 * sp;
            if (body) body.rotation.z = 0.04 * s1;
        }
    } else if (rig === 'larva') {
        const moving = state === 'move', w = moving ? cyc : tt * _pmTAU * 0.5, amp = moving ? 0.07 * H : 0.012 * H;
        for (let i = 1; i <= 5; i++) {
            const o = G[_PM_SEGS[i - 1]]; if (!o) continue;
            o.position.y += amp * Math.max(0, Math.sin(w - 1.2 * i));
            if (moving) o.position.z += 0.025 * H * Math.sin(w - 1.2 * i);
            o.scale.y = 1 + 0.03 * Math.sin(w - 0.6 * i);
        }
        if (head) { head.rotation.y = moving ? 0.07 * Math.sin(cyc * 0.5) : 0.05 * Math.sin(tt * 1.3); head.position.y += amp * 0.6 * Math.max(0, Math.sin(w)); }
    } else if (rig === 'cocoon') {
        const b = (tt % 2.4) < 0.35 ? 1 : 0;
        root.rotation.z = b * 0.035 * Math.sin(tt * 55);
        if (state === 'move') { const hop = Math.abs(Math.sin(cyc * 0.5)); root.position.y = hop * 0.1 * H; root.scale.y = 1 - 0.07 * (1 - hop); root.rotation.x = 0.06 * Math.sin(cyc * 0.5); }
    } else if (rig === 'bird') {
        if (air) {
            const f = Math.sin(tt * _pmTAU * 5);
            root.position.y = 0.32 * H + 0.05 * H * Math.sin(tt * _pmTAU * 2.5);
            if (body) body.rotation.x = 0.2 * sp + 0.05;
            if (G.wingL) G.wingL.rotation.z = 0.25 + 0.95 * f; if (G.wingR) G.wingR.rotation.z = -0.25 - 0.95 * f;
            if (G.legL) G.legL.rotation.x = -0.9; if (G.legR) G.legR.rotation.x = -0.9;
            if (G.tail) G.tail.rotation.x = 0.15 * Math.sin(tt * _pmTAU * 2.5);
        } else {
            const peck = (tt % 2.8) < 0.3 ? Math.sin((tt % 2.8) / 0.3 * Math.PI) : 0;
            if (head) head.rotation.x = 0.45 * peck;
            if (G.wingL) G.wingL.rotation.z = 0.04 * Math.sin(tt * 4); if (G.wingR) G.wingR.rotation.z = -0.04 * Math.sin(tt * 4);
            if (G.tail) G.tail.rotation.x = 0.1 * Math.sin(tt * _pmTAU * 0.8);
        }
    }
    if (rig === 'insect' || G.wingL) {
        // insetos alados pairam o tempo todo; Scyther (bípede) só zumbe as asas
        const fast = U.wingHz || (rig === 'insect' ? (U.height > 1.45 ? 3.2 : 9) : 7), f = Math.sin(tt * _pmTAU * fast * (state === 'move' ? 1.25 : 1));
        if (rig === 'insect') {
            root.position.y = U.hover + 0.05 * H * Math.sin(tt * _pmTAU * 0.9);
            if (state === 'move') { root.rotation.x = 0.22 * sp; }
            const amp = fast < 5 ? 0.6 : 0.4;
            if (G.wingL) G.wingL.rotation.y = -amp * (0.5 + 0.5 * f); if (G.wingR) G.wingR.rotation.y = amp * (0.5 + 0.5 * f);
            if (G.wingL) G.wingL.rotation.z = 0.25 * f; if (G.wingR) G.wingR.rotation.z = -0.25 * f;
            if (G.legL) G.legL.rotation.x = 0.15 * Math.sin(tt * 2); if (G.legR) G.legR.rotation.x = 0.15 * Math.sin(tt * 2 + 1);
        } else if (rig !== 'bird') {
            if (G.wingL) G.wingL.rotation.y = -0.12 * (state === 'move' ? f : 0.2 * f); if (G.wingR) G.wingR.rotation.y = 0.12 * (state === 'move' ? f : 0.2 * f);
        }
    }
    // ----- golpes, dano e desmaio (por cima da locomoção) -----
    if (state === 'windup') {
        const k = _pmEase(st / 0.16);
        root.scale.set(1 + 0.08 * k, 1 - 0.15 * k, 1 + 0.08 * k);
        if (body) body.rotation.x -= 0.18 * k;
        if (head) head.rotation.x -= 0.1 * k;
        if (G.armL) G.armL.rotation.x = -1.3 * k; if (G.armR) G.armR.rotation.x = -1.3 * k;
        if (G.tail) G.tail.rotation.x = 0.35 * k;
        for (let i = 0; i < 2; i++) if (G[_PM_EARS[i]]) G[_PM_EARS[i]].rotation.x = -0.3 * k;
        if (rig === 'cocoon') root.rotation.z = 0.05 * Math.sin(tt * 70) * k;
        if (rig === 'larva') root.scale.z = 1 - 0.14 * k;
    } else if (state === 'attack') {
        const e = _pmPulse(st, 0.07, 0.3);
        root.position.z += 0.32 * H * e;
        root.scale.set(1 - 0.05 * e, 1 + 0.12 * e, 1 + 0.1 * e);
        if (rig === 'larva') root.scale.set(1, 1 - 0.04 * e, 1 + 0.18 * e);
        if (body) body.rotation.x += 0.28 * e;
        if (head) head.rotation.x += 0.12 * e;
        if (G.armL) G.armL.rotation.x = -1.3 * (1 - e) + 0.9 * e; if (G.armR) G.armR.rotation.x = -1.3 * (1 - e) + 0.9 * e;
        if (G.armL && U.slash) G.armL.rotation.y = -0.6 * e; if (G.armR && U.slash) G.armR.rotation.y = 0.6 * e;
        if (G.tail) G.tail.rotation.x = 0.5 * e;
        if (rig === 'bird' && head) head.rotation.x += 0.4 * e;
    } else if (state === 'hurt') {
        const e = _pmPulse(st, 0.06, 0.24);
        root.position.z -= 0.16 * H * e;
        root.scale.set(1 + 0.08 * e, 1 - 0.12 * e, 1 + 0.08 * e);
        if (head) head.rotation.x -= 0.35 * e;
        if (body) body.rotation.x -= 0.15 * e;
        root.visible = !(st < 0.3 && Math.floor(st / 0.05) % 2 === 1);       // pisca
    } else if (state === 'dying') {
        const k = _pmClamp01(st / 0.35), sink = _pmEase((st - 0.55) / 0.6);
        const bounce = k < 1 ? 0 : Math.max(0, Math.sin(Math.min(1, (st - 0.35) / 0.18) * Math.PI)) * 0.06 * H;
        root.position.y = root.position.y * (1 - k) + bounce - sink * 0.35 * H;
        root.rotation.x = 0; root.rotation.z = (Math.PI / 2) * _pmEase(k);
        const sc = 1 - 0.65 * sink; root.scale.set(sc, sc, sc);
        if (head) head.rotation.x = 0.3 * k;
        if (G.wingL) { G.wingL.rotation.y = 0; G.wingL.rotation.z = 0.2; } if (G.wingR) { G.wingR.rotation.y = 0; G.wingR.rotation.z = -0.2; }
    }
}

// Pose da instância inteira (hordas, sem partes móveis). Pura.
//   rig, state, t = segundos no estado (ou relógio), phase = defasagem da instância (radianos), out = objeto reaproveitado.
//   Escreve out = { y, sx, sy, sz, tilt, roll, fwd }: y e fwd em ALTURAS do modelo (multiplique por height);
//   tilt = rotação em X (positivo = inclina para a frente), roll = rotação em Z (radianos).
function pokemonInstancePose(rig, state, t, phase, out) {
    const o = out || {};
    t = Number.isFinite(t) ? t : 0; phase = Number.isFinite(phase) ? phase : 0;
    o.y = 0; o.sx = 1; o.sy = 1; o.sz = 1; o.tilt = 0; o.roll = 0; o.fwd = 0;
    const flyer = rig === 'insect';
    const breath = Math.sin(t * _pmTAU * 0.7 + phase);
    if (flyer) o.y = 0.22 + 0.04 * Math.sin(t * _pmTAU * 0.9 + phase);
    if (state === 'idle' || !state) { o.sy = 1 + 0.03 * breath; o.sx = o.sz = 1 - 0.015 * breath; if (rig === 'cocoon' && ((t + phase) % 2.4) < 0.35) o.roll = 0.035 * Math.sin(t * 55); }
    else if (state === 'move') {
        const c = t * _pmTAU * 3.2 + phase, s = Math.sin(c);
        if (rig === 'larva') { const w = t * _pmTAU * 1.8 + phase; o.sz = 1 + 0.09 * Math.sin(w); o.sy = 1 - 0.07 * Math.sin(w); o.y = 0.02 * Math.max(0, Math.sin(w)); }
        else if (rig === 'cocoon') { const h = Math.abs(Math.sin(t * _pmTAU * 1.3 + phase)); o.y = 0.1 * h; o.sy = 1 - 0.08 * (1 - h); o.sx = o.sz = 1 + 0.04 * (1 - h); }
        else if (rig === 'bird') { o.y = 0.32 + 0.05 * Math.sin(t * _pmTAU * 2.5 + phase); o.tilt = 0.2; o.sy = 1 + 0.04 * Math.sin(t * _pmTAU * 5 + phase); }
        else if (flyer) { o.tilt = 0.22; o.roll = 0.05 * s; }
        else { o.y = 0.08 * Math.abs(s); o.tilt = 0.12; o.roll = 0.05 * s; o.sy = 1 + 0.05 * Math.abs(s) - 0.025; }
    } else if (state === 'windup') {
        const k = _pmEase(t / 0.16); o.sy = 1 - 0.15 * k; o.sx = o.sz = 1 + 0.08 * k; o.tilt = -0.14 * k;
    } else if (state === 'attack') {
        const e = _pmPulse(t, 0.07, 0.3); o.sy = 1 + 0.12 * e; o.sx = 1 - 0.05 * e; o.sz = 1 + 0.12 * e; o.tilt = 0.28 * e; o.fwd = 0.32 * e;
    } else if (state === 'hurt') {
        const e = _pmPulse(t, 0.06, 0.24); o.sy = 1 - 0.14 * e; o.sx = o.sz = 1 + 0.09 * e; o.tilt = -0.25 * e; o.fwd = -0.16 * e;
    } else if (state === 'dying' || state === 'dead') {
        const k = state === 'dead' ? 1 : _pmClamp01(t / 0.35), sink = state === 'dead' ? 1 : _pmEase((t - 0.55) / 0.6);
        o.y = o.y * (1 - k) - 0.35 * sink; o.roll = (Math.PI / 2) * _pmEase(k); o.tilt = 0;
        const sc = 1 - 0.65 * sink; o.sx = o.sy = o.sz = sc;
    }
    return o;
}
