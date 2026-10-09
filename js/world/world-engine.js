// ============================================================
// Mundo visual · motor puro (Fase 7.1): coordenadas, escolha de tile e câmera. Sem DOM, sem GameCore, sem relógio:
// só funções determinísticas (testáveis no Node) que o renderer usa e que a F7.2+ (movimento/colisão) reaproveita.
// Unidades: "mundo" = pixels da arte (tile = 16); "tela" = pixels do dispositivo (buffer do canvas).
// ============================================================

// Letra do terreno em (x, y), ou null fora do mapa
function worldCharAt(map, x, y) {
    if (y < 0 || y >= map.height || x < 0 || x >= map.width) return null;
    return map.rows[y][x];
}

// Tipo do terreno ('ground' | 'path' | 'water' | 'lava' | 'object'), ou null fora do mapa / letra desconhecida
function worldKindAt(map, x, y) {
    const ch = worldCharAt(map, x, y);
    const def = ch === null ? null : WORLD_LEGEND[ch];
    return def ? def.kind : null;
}

// Hash inteiro estável por posição: variação de grama/árvores sem guardar nada
function worldHash(x, y) {
    let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1274126177, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
}

// Índice do tile no tileset para a célula (x, y). Caminho e água usam autotile: vizinho do mesmo tipo (ou fora do
// mapa, para o caminho continuar além da borda) conecta; N=1, E=2, S=4, W=8.
function worldResolveTile(map, x, y, tileset = WORLD_TILESET) {
    const ch = worldCharAt(map, x, y);
    const def = ch === null ? null : WORLD_LEGEND[ch];
    if (!def) return tileset.tiles.grass[0];
    const autoBase = def.kind === 'path' ? tileset.tiles.pathBase : def.kind === 'water' ? tileset.tiles.waterBase : def.kind === 'lava' ? tileset.tiles.lavaBase : null;
    if (autoBase !== null) {
        const same = (nx, ny) => { const k = worldKindAt(map, nx, ny); return k === null || k === def.kind; };
        const mask = (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
        return autoBase + mask;
    }
    const t = tileset.tiles[def.tile];
    return Array.isArray(t) ? t[worldHash(x, y) % t.length] : t;
}

// Métricas da vista. O zoom é SEMPRE um inteiro de pixels do dispositivo por pixel da arte (pixel art nítida em
// qualquer devicePixelRatio); o tamanho do buffer segue o tamanho CSS x dpr (sem borrar e sem buffer gigante).
function worldViewMetrics({ cssWidth, cssHeight, dpr = 1, tileSize = WORLD_TILE_SIZE, targetTileCss = 32, maxDpr = 3, mapWidth = 0, mapHeight = 0, maxZoom = 16 }) {
    const ratio = Math.min(maxDpr, Math.max(1, Number.isFinite(dpr) && dpr > 0 ? dpr : 1));
    const bufferWidth = Math.max(1, Math.round(cssWidth * ratio));
    const bufferHeight = Math.max(1, Math.round(cssHeight * ratio));
    let zoom = Math.max(1, Math.round((targetTileCss * ratio) / tileSize));
    // mapa (em px da arte) que já cabe INTEIRO na vista com o zoom base nos dois eixos: usa o MAIOR zoom inteiro em que ele ainda
    // cabe inteiro (a câmera o centraliza, com barras iguais). Se algum eixo é maior que a vista, mantém o zoom base e a
    // câmera acompanha o personagem (eixo que cabe fica centralizado; o outro, limitado às bordas)
    if (mapWidth > 0 && mapHeight > 0 && mapWidth * zoom <= bufferWidth && mapHeight * zoom <= bufferHeight) {
        while (zoom < maxZoom && mapWidth * (zoom + 1) <= bufferWidth && mapHeight * (zoom + 1) <= bufferHeight) zoom++;
    }
    return { cssWidth, cssHeight, dpr: ratio, bufferWidth, bufferHeight, tileSize, zoom, viewWidth: bufferWidth / zoom, viewHeight: bufferHeight / zoom };
}

// Câmera (canto superior esquerdo, em px do mundo) centrada em `focus` (px do mundo), limitada às bordas do mapa;
// em cada eixo em que o mapa for menor que a vista, fica centrado (mapa inteiro visível). Arredondada ao pixel do dispositivo (sem frestas entre tiles).
function worldCamera(map, metrics, focus) {
    const mapW = map.width * metrics.tileSize, mapH = map.height * metrics.tileSize;
    const axis = (focusPx, view, size) => (size <= view ? (size - view) / 2 : Math.min(Math.max(focusPx - view / 2, 0), size - view));
    const x = axis(focus.x, metrics.viewWidth, mapW), y = axis(focus.y, metrics.viewHeight, mapH);
    return { x: Math.round(x * metrics.zoom) / metrics.zoom, y: Math.round(y * metrics.zoom) / metrics.zoom };
}

// Ponto que a câmera segue: os pés do personagem um pouco acima (centro do corpo). Única definição; só LÊ o estado.
function worldCameraFocus(state) { return { x: state.x, y: state.y - 6 }; }

// Centro de uma célula em px do mundo
function worldCellCenter(map, cellX, cellY, tileSize = WORLD_TILE_SIZE) {
    return { x: (cellX + 0.5) * tileSize, y: (cellY + 0.5) * tileSize };
}

// mundo -> tela (px do dispositivo, inteiros) e o inverso (px do mundo, fracionários)
function worldToScreen(camera, metrics, wx, wy) {
    return { x: Math.round((wx - camera.x) * metrics.zoom), y: Math.round((wy - camera.y) * metrics.zoom) };
}
function worldFromScreen(camera, metrics, sx, sy) {
    return { x: sx / metrics.zoom + camera.x, y: sy / metrics.zoom + camera.y };
}

// Faixa de células visíveis (inclusive), já limitada ao mapa
function worldVisibleCells(map, camera, metrics) {
    const ts = metrics.tileSize;
    return {
        x0: Math.max(0, Math.floor(camera.x / ts)),
        y0: Math.max(0, Math.floor(camera.y / ts)),
        x1: Math.min(map.width - 1, Math.floor((camera.x + metrics.viewWidth - 1 / metrics.zoom) / ts)),
        y1: Math.min(map.height - 1, Math.floor((camera.y + metrics.viewHeight - 1 / metrics.zoom) / ts)),
    };
}

// ============================================================
// Movimento (Fase 7.2): núcleo compartilhado, puro e independente do renderer e da taxa de quadros.
//   - Estado: { mapId, x, y, dir, moving, distance }: x,y = ponto dos pés em px do mundo; distance = px já percorridos.
//   - O controle MANUAL (cidades) fornece uma direção; o controle AUTOMÁTICO (caçadas, futuro) fornece um destino. Os dois
//     passam por worldMoveBy: mesmas colisões, mesmos limites, mesma conta de distância.
//   - Deslocamento = velocidade x tempo, linear: dividir o mesmo tempo em passos diferentes dá o mesmo resultado.
//   - worldPathLength / worldTravelTimeMs dão a mesma conta em fórmula fechada (ETA de um encontro, simulação offline).
// ============================================================
const WORLD_DIRS = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };
const WORLD_EPS = 1e-4;

// Só mapas de cidade aceitam caminhada manual; rotas e áreas de caça andam sozinhas
function worldCanWalkManually(map) { return !!map && map.type === 'city'; }

// Tile que bloqueia: tudo que a legenda não declara `walkable: true` (objeto, água, letra desconhecida) e tudo fora do mapa
function worldCellBlocked(map, cellX, cellY) {
    const ch = worldCharAt(map, cellX, cellY);
    const def = ch === null ? null : WORLD_LEGEND[ch];
    return !def || def.walkable !== true;
}

// Estado inicial: pés no centro da célula de spawn, um pouco abaixo (igual ao desenho da F7.1)
function worldCreateState(map) {
    const ts = WORLD_TILE_SIZE, sp = map.spawn;
    return { mapId: map.id, x: sp.x * ts + ts / 2, y: sp.y * ts + ts - 3, dir: sp.dir || 'down', moving: false, distance: 0 };
}

// Move o eixo `axis` ('x'|'y') em `sign` (+1/-1) até `dist` px; para exatamente na borda do primeiro tile bloqueado
function worldMoveAxis(map, pos, axis, sign, dist) {
    const ts = WORLD_TILE_SIZE, hb = WORLD_MOVEMENT.hitbox;
    const half = axis === 'x' ? hb.halfW : hb.halfH, cross = axis === 'x' ? pos.y : pos.x, crossHalf = axis === 'x' ? hb.halfH : hb.halfW;
    const c0 = Math.floor((cross - crossHalf) / ts), c1 = Math.floor((cross + crossHalf - WORLD_EPS) / ts);
    const from = pos[axis], target = from + sign * dist;
    const edgeNow = Math.floor((from + sign * half) / ts), edgeNew = Math.floor((target + sign * half) / ts);
    if (edgeNew !== edgeNow) {
        for (let c = c0; c <= c1; c++) {
            const blocked = axis === 'x' ? worldCellBlocked(map, edgeNew, c) : worldCellBlocked(map, c, edgeNew);
            if (blocked) {
                const boundary = sign > 0 ? edgeNew * ts : (edgeNew + 1) * ts;
                const stop = boundary - sign * half - sign * WORLD_EPS;
                return sign > 0 ? Math.max(from, Math.min(target, stop)) : Math.min(from, Math.max(target, stop));
            }
        }
    }
    return target;
}

// Primitiva comum: anda `distance` px na direção `dir` (cima/baixo/esquerda/direita); devolve um NOVO estado
function worldMoveBy(map, state, dir, distance) {
    const vec = WORLD_DIRS[dir];
    if (!vec || !(distance > 0)) return { ...state, moving: false };
    let { x, y } = state, left = distance, moved = 0;
    const chunk = WORLD_TILE_SIZE / 2;                       // nunca pula mais que meio tile por vez
    while (left > 1e-9) {
        const d = Math.min(left, chunk);
        const before = vec.dx ? x : y;
        if (vec.dx) x = worldMoveAxis(map, { x, y }, 'x', vec.dx, d); else y = worldMoveAxis(map, { x, y }, 'y', vec.dy, d);
        const got = Math.abs((vec.dx ? x : y) - before);
        moved += got; left -= d;
        if (got < d - 1e-9) break;                           // bateu num obstáculo ou na borda
    }
    return { ...state, x, y, dir, moving: moved > 1e-9, distance: state.distance + moved };
}

// Controle manual: uma direção (ou null) durante `dtMs` a `speed` px/s. dtMs é limitado a maxStepMs.
function worldStep(map, state, dir, dtMs, speed = WORLD_MOVEMENT.walkSpeed) {
    const dt = Math.min(Math.max(Number.isFinite(dtMs) ? dtMs : 0, 0), WORLD_MOVEMENT.maxStepMs);
    if (!dir) return { ...state, moving: false };
    return worldMoveBy(map, state, dir, (speed * dt) / 1000);
}

// Controle automático (caçadas): vai ao `target` (px do mundo) em L, primeiro no eixo x e depois no y, sem simular teclas.
// Chega exatamente (sem passar do alvo); o tempo que sobra de uma perna vale para a seguinte, então o resultado não depende
// de como o tempo foi dividido em passos. Não faz busca de caminho: se bater num obstáculo, devolve blocked.
function worldAdvanceToward(map, state, target, dtMs, speed = WORLD_MOVEMENT.walkSpeed) {
    const dt = Math.min(Math.max(Number.isFinite(dtMs) ? dtMs : 0, 0), WORLD_MOVEMENT.maxStepMs);
    let s = { ...state, moving: false }, left = (speed * dt) / 1000, blocked = false;
    for (let leg = 0; leg < 2 && left > 1e-9; leg++) {
        const dx = target.x - s.x, dy = target.y - s.y;
        const horizontal = Math.abs(dx) > WORLD_EPS;
        const remaining = horizontal ? Math.abs(dx) : Math.abs(dy);
        if (!horizontal && Math.abs(dy) <= WORLD_EPS) break;
        const dir = horizontal ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        const step = Math.min(left, remaining);
        const next = worldMoveBy(map, s, dir, step);
        const got = next.distance - s.distance;
        s = { ...next, moving: s.moving || next.moving };
        left -= got;
        if (got < step - 1e-9) { blocked = true; break; }
    }
    const arrived = Math.abs(target.x - s.x) <= 1e-3 && Math.abs(target.y - s.y) <= 1e-3;
    return { state: s, arrived, blocked };
}

// Fórmulas fechadas (mesma matemática do passo a passo, sem simular quadros): comprimento do percurso em L por pontos de
// passagem, e tempo de viagem em ms. Servem para estimar o tempo até um encontro, ao vivo e offline.
function worldPathLength(from, waypoints) {
    let len = 0, cur = from;
    for (const p of waypoints) { len += Math.abs(p.x - cur.x) + Math.abs(p.y - cur.y); cur = p; }
    return len;
}
function worldTravelTimeMs(distancePx, speed = WORLD_MOVEMENT.walkSpeed) {
    return speed > 0 ? (Math.max(0, distancePx) / speed) * 1000 : Infinity;
}

// Interação disponível perto de um ponto (só em cidades): a mais próxima dentro do alcance, ou null
function worldInteractionNear(map, state, reach = WORLD_MOVEMENT.interactReach) {
    if (!worldCanWalkManually(map) || !map.interactions) return null;
    const ts = WORLD_TILE_SIZE;
    let best = null, bestD = Infinity;
    for (const it of map.interactions) {
        const d = Math.hypot(state.x - (it.cell.x + 0.5) * ts, state.y - (it.cell.y + 0.5) * ts);
        if (d <= reach && d < bestD) { best = it; bestD = d; }
    }
    return best;
}


// ============================================================
// Caminhada automática das caçadas (Fase 7.7): busca de caminho + percurso lógico sobre a grade de colisão.
//   - Busca: BFS (largura) em grade 4-direcional de custo uniforme, fila FIFO, o primeiro pai descoberto é mantido.
//     ORDEM DE VIZINHOS (e, por isso, o desempate entre caminhos de mesmo custo): ESQUERDA, DIREITA, CIMA, BAIXO.
//     Determinístico: mesma grade + mesma origem/destino = mesmo caminho. Termina sempre (cada célula entra na fila uma vez).
//   - O caminho passa pelo PÉ de cada célula (centro do tile em x, 3 px acima da base em y, como o ponto inicial do mapa): a hitbox
//     (10x4 px) cabe inteira em células andáveis, então o percurso é seguro; worldVerifyPath confere isso com worldMoveBy.
//   - O estado lógico do percurso é só o PROGRESSO em px ao longo da poligonal; posição e direção são funções puras dele
//     (worldPathPosition), iguais online e offline. Distância = nº de passos x 16 px; tempo = distância / velocidade.
// ============================================================
const WORLD_PATH_NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Caminho mais curto entre duas células (inclui origem e destino) ou null (inválido/inalcançável)
function worldFindPath(map, from, to) {
    if (!map || !from || !to || !Number.isInteger(map.width) || !Number.isInteger(map.height)) return null;
    const w = map.width, h = map.height;
    const usable = (c) => Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < w && c.y < h && !worldCellBlocked(map, c.x, c.y);
    if (!usable(from) || !usable(to)) return null;
    const start = from.y * w + from.x, goal = to.y * w + to.x;
    if (start === goal) return [{ x: from.x, y: from.y }];
    const parent = new Int32Array(w * h).fill(-1);
    parent[start] = start;
    const queue = [start];
    for (let head = 0; head < queue.length && parent[goal] === -1; head++) {
        const cur = queue[head], cx = cur % w, cy = (cur - cx) / w;
        for (const [dx, dy] of WORLD_PATH_NEIGHBORS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (parent[ni] !== -1 || worldCellBlocked(map, nx, ny)) continue;
            parent[ni] = cur;
            queue.push(ni);
        }
    }
    if (parent[goal] === -1) return null;
    const cells = [];
    for (let at = goal; ; at = parent[at]) {
        cells.push({ x: at % w, y: Math.floor(at / w) });
        if (at === start) break;
    }
    return cells.reverse();
}

// Pé do personagem parado numa célula (mesma regra do ponto inicial dos mapas)
function worldCellFoot(cell) {
    const ts = WORLD_TILE_SIZE;
    return { x: cell.x * ts + ts / 2, y: cell.y * ts + ts - 3 };
}

function worldPathWaypoints(cells) { return cells.map(worldCellFoot); }

// Comprimento (px) de uma poligonal de waypoints
function worldPolylineLength(waypoints) {
    let len = 0;
    for (let i = 1; i < waypoints.length; i++) len += Math.abs(waypoints[i].x - waypoints[i - 1].x) + Math.abs(waypoints[i].y - waypoints[i - 1].y);
    return len;
}

// Posição lógica depois de `progressPx` ao longo da poligonal (limitado a [0, comprimento]); dir = sentido do trecho atual
function worldPathPosition(waypoints, progressPx, fallbackDir = 'down') {
    const first = waypoints[0];
    let left = Math.max(0, Number.isFinite(progressPx) ? progressPx : 0), dir = fallbackDir;
    for (let i = 1; i < waypoints.length; i++) {
        const a = waypoints[i - 1], b = waypoints[i];
        const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        dir = b.x > a.x ? 'right' : b.x < a.x ? 'left' : b.y > a.y ? 'down' : 'up';
        if (left <= seg) {
            const t = seg > 0 ? left / seg : 0;
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dir, done: i === waypoints.length - 1 && left >= seg };
        }
        left -= seg;
    }
    const last = waypoints[waypoints.length - 1] || first;
    return { x: last.x, y: last.y, dir, done: true };
}

// Confere o percurso com o mesmo motor de colisão do movimento manual: andando trecho a trecho com worldMoveBy chega ao fim sem bloqueio
function worldVerifyPath(map, waypoints) {
    if (!Array.isArray(waypoints) || waypoints.length === 0) return false;
    let state = { mapId: map.id, x: waypoints[0].x, y: waypoints[0].y, dir: 'down', moving: false, distance: 0 };
    for (let i = 1; i < waypoints.length; i++) {
        const b = waypoints[i], dx = b.x - state.x, dy = b.y - state.y;
        const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
        const dist = Math.abs(dx) + Math.abs(dy);
        const next = worldMoveBy(map, state, dir, dist);
        if (Math.abs(next.x - b.x) > 1e-3 || Math.abs(next.y - b.y) > 1e-3) return false;
        state = { ...next, x: b.x, y: b.y };
    }
    return true;
}
