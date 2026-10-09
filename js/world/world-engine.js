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

// Tipo do terreno ('ground' | 'path' | 'water' | 'object'), ou null fora do mapa / letra desconhecida
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
    if (def.kind === 'path' || def.kind === 'water') {
        const same = (nx, ny) => { const k = worldKindAt(map, nx, ny); return k === null || k === def.kind; };
        const mask = (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
        return (def.kind === 'path' ? tileset.tiles.pathBase : tileset.tiles.waterBase) + mask;
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
    // mapa (em px da arte) menor que a vista: sobe o zoom inteiro até cobrir o painel, sem barras vazias nas laterais
    if (mapWidth > 0 && mapHeight > 0) while (zoom < maxZoom && (mapWidth * zoom < bufferWidth || mapHeight * zoom < bufferHeight)) zoom++;
    return { cssWidth, cssHeight, dpr: ratio, bufferWidth, bufferHeight, tileSize, zoom, viewWidth: bufferWidth / zoom, viewHeight: bufferHeight / zoom };
}

// Câmera (canto superior esquerdo, em px do mundo) centrada em `focus` (px do mundo), limitada às bordas do mapa;
// se o mapa for menor que a vista, fica centrado. Arredondada ao pixel do dispositivo (sem frestas entre tiles).
function worldCamera(map, metrics, focus) {
    const mapW = map.width * metrics.tileSize, mapH = map.height * metrics.tileSize;
    const axis = (focusPx, view, size) => (size <= view ? (size - view) / 2 : Math.min(Math.max(focusPx - view / 2, 0), size - view));
    const x = axis(focus.x, metrics.viewWidth, mapW), y = axis(focus.y, metrics.viewHeight, mapH);
    return { x: Math.round(x * metrics.zoom) / metrics.zoom, y: Math.round(y * metrics.zoom) / metrics.zoom };
}

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
