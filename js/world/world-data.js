// ============================================================
// Mundo visual · dados (Fase 7.1). Só dados e um acessor: nada aqui desenha, move ou toca no GameCore.
//   - cada mapa tem id PRÓPRIO (mapa ≠ rota); a rota de progressão (REGIONS em route-data.js) só aponta para um mapa pela tabela
//     WORLD_ROUTE_MAPS. routeId no mapa é metadado opcional (usado só na legenda). Não existe outro sistema de rotas;
//   - o terreno é ASCII (uma letra por tile): fácil de revisar, editar e substituir por mapas futuros;
//   - o layout dos PNGs (tileset e personagem) fica em WORLD_TILESET / WORLD_CHARACTER: trocar a arte = trocar o PNG
//     (gerados por tools/make-world-assets.js) mantendo o layout.
// ============================================================
const WORLD_TILE_SIZE = 16;

// Layout de sprites/world/tileset.png (16 colunas x 3 linhas de tiles 16x16)
const WORLD_TILESET = {
    src: 'sprites/world/tileset.png',
    tileSize: WORLD_TILE_SIZE,
    cols: 16,
    rows: 3,
    tiles: {
        grass: [0, 1, 2, 3],      // variação escolhida por hash da posição
        tuft: 4, flowerRed: 5, flowerYellow: 6, tallGrass: 7, bush: 8, rock: 9,
        tree: [10, 11], stump: 12, sign: 13, fence: 14,
        pathBase: 16,             // 16 autotiles: máscara N=1, E=2, S=4, W=8 (vizinho do mesmo tipo)
        waterBase: 32,
    },
};

// Personagem: placeholder original. frames[dir] = { col, row } na folha; a F7.2 pode trocar por listas de quadros.
const WORLD_CHARACTER = {
    src: 'sprites/world/hero.png',
    frameW: 16,
    frameH: 24,
    anchor: { x: 8, y: 21 },      // pé do personagem dentro do quadro
    frames: { down: { col: 0, row: 0 }, up: { col: 1, row: 0 }, left: { col: 2, row: 0 }, right: { col: 3, row: 0 } },
};

// Legenda do terreno: kind 'path' e 'water' se conectam entre si (autotile); 'object' e 'ground' são tiles fixos
const WORLD_LEGEND = {
    '.': { kind: 'ground', tile: 'grass' },
    ',': { kind: 'ground', tile: 'tuft' },
    'f': { kind: 'ground', tile: 'flowerRed' },
    'y': { kind: 'ground', tile: 'flowerYellow' },
    'w': { kind: 'ground', tile: 'tallGrass' },
    'p': { kind: 'path' },
    '~': { kind: 'water' },
    'T': { kind: 'object', tile: 'tree' },
    'b': { kind: 'object', tile: 'bush' },
    'r': { kind: 'object', tile: 'rock' },
    'o': { kind: 'object', tile: 'stump' },
    's': { kind: 'object', tile: 'sign' },
    '=': { kind: 'object', tile: 'fence' },
};

const WORLD_MAPS = {
    // Rota 1 de Kanto (id real em route-data.js): caminho de terra de sul (Pallet) a norte (Viridian)
    kanto_route1: {
        id: 'kanto_route1',
        routeId: 'kanto_route1',   // metadado opcional: rota de progressão relacionada (legenda); o mapa não depende dela
        width: 32,
        height: 24,
        label: 'caminho de terra entre árvores, grama alta e uma lagoa',
        spawn: { x: 13, y: 18, dir: 'up' },
        rows: [
            'TTTTTTTTTTTTTTTpppTTTTTTTTTTTTTT',
            'TT.TTTTTTTTTT.TpppT...T.T.TTTTTT',
            'TTT....y..y....ppp..,....,...fTT',
            'TT........yff...ppp..wwwwwww..TT',
            'TT.,...,o......,ppp,.www.www.TTT',
            'TT..............pppy.wwwwwww..TT',
            'TTT........r...ppp..yw.wwwww,TTT',
            'TTT............ppp...wwwwwww..TT',
            'TT..wwwwww.y...pp,.....f..,...TT',
            'bb.ywww,wwf.....ppp.b......f.TTT',
            'bb..www,ww.......ppp,b..,.y...TT',
            'TT..wwwwww..r....ppp...,....yfTT',
            'TTT.wwwwww.......pppf...~~~~.TTT',
            'TT.....,.=====..ppp....~~~~~~.TT',
            'TT.f.,f....b...ppp...,.~~~~~~TTT',
            'TT..,.,...b...ppp......~~~~~~.bb',
            'TT.y....oy...ppp........~~~~..bb',
            'bbT.y,wwww..ppp...r...........TT',
            'TTTT.wwwww..ppp....======...TTTT',
            'TT...ww,,w..ppp.....wwwww.,,yTTT',
            'TT...wwww.r..ppps..w.ww..,....TT',
            'TT.,.........,ppp..w.w,.,.....TT',
            'TTTTTTT.TT.TT.ppp.T.T.,T.TT.TTTT',
            'TTTTTTTTTTTTTTpppTTTTTTTTTTTTTTT',
        ],
    },
};

// Qual mapa visual cada rota de progressão mostra (id da rota → id do mapa). Hoje é identidade para a Rota 1;
// rotas fora da tabela não têm mapa visual e caem na prévia.
const WORLD_ROUTE_MAPS = {
    kanto_route1: 'kanto_route1',
};

// Área mostrada quando a rota atual ainda não tem mapa visual (só uma prévia: não altera a rota do jogo)
const WORLD_PREVIEW_MAP_ID = 'kanto_route1';

const _worldHas = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

// Mapa pelo id do MAPA (ou null)
function getWorldMap(mapId) {
    return _worldHas(WORLD_MAPS, mapId) ? WORLD_MAPS[mapId] : null;
}

// Id do mapa visual de uma rota de progressão (ou null se a rota ainda não tem mapa)
function worldMapIdForRoute(routeId) {
    return _worldHas(WORLD_ROUTE_MAPS, routeId) ? WORLD_ROUTE_MAPS[routeId] : null;
}
