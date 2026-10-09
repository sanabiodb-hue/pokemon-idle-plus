// ============================================================
// Mundo visual · dados (Fase 7.1). Só dados e um acessor: nada aqui desenha, move ou toca no GameCore.
//   - cada mapa tem id PRÓPRIO (mapa ≠ rota); a rota de progressão (REGIONS em route-data.js) só aponta para um mapa pela tabela
//     WORLD_ROUTE_MAPS. routeId no mapa é metadado opcional (usado só na legenda). Não existe outro sistema de rotas;
//   - o terreno é ASCII (uma letra por tile): fácil de revisar, editar e substituir por mapas futuros;
//   - o layout dos PNGs (tileset e personagem) fica em WORLD_TILESET / WORLD_CHARACTER: trocar a arte = trocar o PNG
//     (gerados por tools/make-world-assets.js) mantendo o layout.
// ============================================================
const WORLD_TILE_SIZE = 16;

// Movimento: unidades consistentes e independentes da taxa de quadros. Posição e distância em px do mundo (1 tile = 16 px),
// velocidade em px/s, tempo em ms. O mesmo modelo serve ao controle manual (cidades), à caminhada automática das caçadas e à
// simulação offline (mesma matemática, sem desenhar passos). hitbox: meia-largura/meia-altura da caixa dos pés.
const WORLD_MOVEMENT = {
    walkSpeed: 64,            // 4 tiles por segundo
    maxStepMs: 50,            // um quadro nunca vale mais que isto (aba escondida/engasgo não vira "teletransporte")
    hitbox: { halfW: 5, halfH: 2 },
    interactReach: 20,        // distância (px) dos pés ao ponto de interação para poder interagir
};

// Layout de sprites/world/tileset.png (16 colunas x 4 linhas de tiles 16x16)
const WORLD_TILESET = {
    src: 'sprites/world/tileset.png',
    tileSize: WORLD_TILE_SIZE,
    cols: 16,
    rows: 6,
    tiles: {
        grass: [0, 1, 2, 3],      // variação escolhida por hash da posição
        tuft: 4, flowerRed: 5, flowerYellow: 6, tallGrass: 7, bush: 8, rock: 9,
        tree: [10, 11], stump: 12, sign: 13, fence: 14,
        pathBase: 16,             // 16 autotiles: máscara N=1, E=2, S=4, W=8 (vizinho do mesmo tipo)
        waterBase: 32,
        // cidade (linha 4)
        roofRedL: 48, roofRedCross: 49, roofRedR: 50, wallWindowL: 51, centerDoor: 52, wallWindowR: 53,
        roofBlueL: 54, roofBlueBox: 55, roofBlueR: 56, depotWallL: 57, depotGate: 58, depotWallR: 59,
        plaza: 60, bench: 61, lamp: 62, townSign: 63,
        // biomas dos mapas de caça (F7.4, linhas 5 e 6)
        caveFloor: [64, 65], caveBoulder: 66, crystal: 67, ashFloor: [68, 69], basalt: 70, snowFloor: [71, 72], pine: 73, iceRock: 74,
        gloomFloor: [75, 76], deadTree: 77, tombstone: 78, sand: 79,
        lavaBase: 80,             // 16 autotiles de lava (mesma máscara da água)
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

// Legenda do terreno: kind 'path', 'water' e 'lava' se conectam entre si (autotile); 'object' e 'ground' são tiles fixos.
// `walkable` é a ÚNICA fonte de verdade da colisão (F7.3): o motor lê só ele; o `kind` é só aparência. Letra fora da legenda = bloqueada.
const WORLD_LEGEND = {
    '.': { kind: 'ground', walkable: true, tile: 'grass' },
    ',': { kind: 'ground', walkable: true, tile: 'tuft' },
    'f': { kind: 'ground', walkable: true, tile: 'flowerRed' },
    'y': { kind: 'ground', walkable: true, tile: 'flowerYellow' },
    'w': { kind: 'ground', walkable: true, tile: 'tallGrass' },
    'p': { kind: 'path', walkable: true },
    '~': { kind: 'water', walkable: false },
    'T': { kind: 'object', walkable: false, tile: 'tree' },
    'b': { kind: 'object', walkable: false, tile: 'bush' },
    'r': { kind: 'object', walkable: false, tile: 'rock' },
    'o': { kind: 'object', walkable: false, tile: 'stump' },
    's': { kind: 'object', walkable: false, tile: 'sign' },
    '=': { kind: 'object', walkable: false, tile: 'fence' },
    // cidade
    'q': { kind: 'ground', walkable: true, tile: 'plaza' },
    'A': { kind: 'object', walkable: false, tile: 'roofRedL' }, 'B': { kind: 'object', walkable: false, tile: 'roofRedCross' }, 'C': { kind: 'object', walkable: false, tile: 'roofRedR' },
    'D': { kind: 'object', walkable: false, tile: 'wallWindowL' }, 'G': { kind: 'object', walkable: false, tile: 'centerDoor' }, 'F': { kind: 'object', walkable: false, tile: 'wallWindowR' },
    'H': { kind: 'object', walkable: false, tile: 'roofBlueL' }, 'I': { kind: 'object', walkable: false, tile: 'roofBlueBox' }, 'J': { kind: 'object', walkable: false, tile: 'roofBlueR' },
    'K': { kind: 'object', walkable: false, tile: 'depotWallL' }, 'N': { kind: 'object', walkable: false, tile: 'depotGate' }, 'M': { kind: 'object', walkable: false, tile: 'depotWallR' },
    // biomas de caça (F7.4)
    'c': { kind: 'ground', walkable: true, tile: 'caveFloor' }, 'R': { kind: 'object', walkable: false, tile: 'caveBoulder' }, 'X': { kind: 'object', walkable: false, tile: 'crystal' },
    'a': { kind: 'ground', walkable: true, tile: 'ashFloor' }, 'O': { kind: 'object', walkable: false, tile: 'basalt' }, 'L': { kind: 'lava', walkable: false },
    'n': { kind: 'ground', walkable: true, tile: 'snowFloor' }, 'P': { kind: 'object', walkable: false, tile: 'pine' }, 'i': { kind: 'object', walkable: false, tile: 'iceRock' },
    'g': { kind: 'ground', walkable: true, tile: 'gloomFloor' }, 'd': { kind: 'object', walkable: false, tile: 'deadTree' }, 't': { kind: 'object', walkable: false, tile: 'tombstone' },
    'e': { kind: 'ground', walkable: true, tile: 'sand' },
    'h': { kind: 'object', walkable: false, tile: 'bench' }, 'l': { kind: 'object', walkable: false, tile: 'lamp' }, 'z': { kind: 'object', walkable: false, tile: 'townSign' },
};

WORLD_MAPS = {
    // Cidade inicial: Centro Pokémon (cura) e Depot (armazenamento). Caminhada manual permitida (type 'city').
    starter_town: {
        id: 'starter_town',
        type: 'city',
        name: 'Cidade Inicial',
        width: 28,
        height: 20,
        label: 'praça de pedra com o Centro Pokémon, o Depot, bancos, postes e um caminho ao sul',
        spawn: { x: 13, y: 9, dir: 'down' },
        // pontos de interação: 'cell' é a célula caminhável em frente à porta; o serviço fica disponível perto dela
        interactions: [
            { id: 'pokemon_center', type: 'heal', label: 'Centro Pokémon', cell: { x: 6, y: 5 } },
            { id: 'depot', type: 'depot', label: 'Depot', cell: { x: 21, y: 5 } },
        ],
        rows: [
            'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
            'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
            'TT.T.....,T...,.,T..f...T.TT',
            'TT,f.ABCy,rf........HIJ...TT',
            'TT...DGFb.y......fb.KNM...TT',
            'TTy.qqqqqlqqqqqqqqlqqqqq.TTT',
            'TTT.qqqqqqqqqqqqqqqqqqqqy.TT',
            'TT..qqqqqqqqqlqqqqqqqqqq,rTT',
            'TT,yqqqqqqqqqqqqqqqqqqqq.,TT',
            'TT..qqqqqhqqqqqqqqhqqqqq,.TT',
            'TT,.qqqqqqqqqqqqqqqqqqqq,.TT',
            'TTb.qqqqqqqqqqqqqqqqqqqq..TT',
            'TT..b...,.b.ppp...y,.r...TTT',
            'TTT.=======rppp,.=======f.TT',
            'TTr.....,.ybppp.....bf..y,TT',
            'TT..,......,pppff...f.....TT',
            'TTy.........ppp.z........yTT',
            'TT.........yppp.f..b.....fTT',
            'TTTTTTTTTTTTpppTTTTTTTTTTTTT',
            'TTTTTTTTTTTTpppTTTTTTTTTTTTT',
        ],
    },

    // Rota 1 de Kanto (id real em route-data.js): caminho de terra de sul (Pallet) a norte (Viridian)
    kanto_route1: {
        id: 'kanto_route1',
        type: 'route',             // city | route | hunt: só 'city' aceita caminhada manual (rotas e caçadas andam sozinhas)
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

// Área exibida ao abrir a aba Mapa (as demais são escolhidas no seletor de destino; só visual, não altera a rota do jogo)
const WORLD_START_MAP_ID = 'starter_town';

const _worldHas = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

// Mapa pelo id do MAPA (ou null)
function getWorldMap(mapId) {
    if (_worldHas(WORLD_MAPS, mapId)) return WORLD_MAPS[mapId];
    return typeof worldHuntMapById === 'function' ? worldHuntMapById(mapId) : null;   // mapas de caça `hunt_<espécie>`: gerados sob demanda (world-gen.js)
}

// Id do mapa visual de uma rota de progressão (ou null se a rota ainda não tem mapa)
function worldMapIdForRoute(routeId) {
    return _worldHas(WORLD_ROUTE_MAPS, routeId) ? WORLD_ROUTE_MAPS[routeId] : null;
}
