// ============================================================
// Mundo visual · biomas dos mapas de caça (Fase 7.4). SÓ DADOS: o algoritmo vive em world-gen.js.
//   - A tabela de espécies tem apenas `types` (1 ou 2 dos 18 tipos); não existe metadado de habitat, então a espécie vai para um
//     bioma por REGRA EXPLÍCITA sobre os tipos: cada tipo aponta para um bioma e, em espécies de tipo duplo, vale o tipo de
//     MAIOR prioridade em WORLD_TYPE_PRIORITY (os mais "marcantes" primeiro). Sem tipos válidos → WORLD_BIOME_FALLBACK.
//   - Os biomas só usam letras da legenda (world-data.js) e tiles do tileset; cada perfil diz como espalhar o terreno.
//   - Mudar qualquer regra ou número daqui muda os mapas: some 1 em WORLD_GEN_VERSION (a semente também muda).
// Campos do perfil:
//   width/height [min, max]  faixa de dimensões em tiles (o valor exato sai da semente da espécie)
//   ground [[letra, peso]]   chão andável (variação por sorteio); patch = manchas de outro chão (ex.: grama alta)
//   obstacles                fração de células em aglomerados (ruído) + `scatter` de obstáculos isolados + símbolos [[letra, peso]]
//   liquid                   corpo d'água/lava (nunca andável) em manchas, ou null; shore = chão de margem ao redor da água
//                            (a água do tileset tem margem de grama: só aparece nos biomas de chão verde; cave/neve/sombras não têm água)
//   border                   obstáculo da moldura externa do mapa
//   meander                  chance de cada passo do corredor desviar para o lado (0 = reto)
// ============================================================
const WORLD_GEN_VERSION = 1;

// Limites aceitos pelo gerador (a engine não impõe limite; renderiza só o visível e a colisão é O(1) por célula)
const WORLD_GEN_LIMITS = { minWidth: 32, maxWidth: 128, minHeight: 24, maxHeight: 96 };

const WORLD_BIOME_FALLBACK = 'meadow';

const WORLD_TYPE_BIOME = {
    fire: 'volcano', dragon: 'volcano',
    ice: 'snow',
    water: 'lake',
    ghost: 'haunted', dark: 'haunted', psychic: 'haunted', poison: 'haunted',
    rock: 'cave', ground: 'cave', steel: 'cave', fighting: 'cave',
    grass: 'forest', bug: 'forest',
    normal: 'meadow', fairy: 'meadow', flying: 'meadow', electric: 'meadow',
};

// Em tipo duplo vence o tipo que aparece primeiro aqui (ex.: grass/poison → forest; ghost/poison → haunted; fire/flying → volcano)
const WORLD_TYPE_PRIORITY = ['fire', 'ice', 'water', 'ghost', 'dark', 'rock', 'ground', 'steel', 'dragon', 'grass', 'bug', 'poison', 'psychic', 'fighting', 'electric', 'fairy', 'flying', 'normal'];

const WORLD_BIOMES = {
    forest: {
        id: 'forest', name: 'Floresta', width: [72, 112], height: [48, 72], meander: 0.30,
        ground: [['.', 6], [',', 3], ['f', 0.6]], patch: { ch: 'w', fraction: 0.10, scale: 6 },
        obstacles: { fraction: 0.30, scale: 7, scatter: 0.02, symbols: [['T', 6], ['b', 2], ['o', 1]] },
        liquid: { ch: '~', fraction: 0.04, scale: 9 }, shore: null, border: 'T',
    },
    meadow: {
        id: 'meadow', name: 'Campo', width: [64, 112], height: [44, 72], meander: 0.22,
        ground: [['.', 5], [',', 3], ['f', 1.5], ['y', 1.5]], patch: { ch: 'w', fraction: 0.08, scale: 6 },
        obstacles: { fraction: 0.08, scale: 8, scatter: 0.012, symbols: [['T', 2], ['b', 3], ['r', 2], ['o', 1]] },
        liquid: { ch: '~', fraction: 0.05, scale: 10 }, shore: null, border: 'T',
    },
    lake: {
        id: 'lake', name: 'Lago', width: [64, 104], height: [44, 68], meander: 0.26,
        ground: [['.', 6], [',', 2], ['f', 0.5]], patch: null,
        obstacles: { fraction: 0.06, scale: 8, scatter: 0.012, symbols: [['T', 3], ['b', 3], ['r', 1]] },
        liquid: { ch: '~', fraction: 0.22, scale: 11 }, shore: 'e', border: 'T',
    },
    cave: {
        id: 'cave', name: 'Caverna', width: [48, 88], height: [36, 60], meander: 0.34,
        ground: [['c', 1]], patch: null,
        obstacles: { fraction: 0.32, scale: 6, scatter: 0.02, symbols: [['R', 8], ['X', 1.5]] },
        liquid: null, shore: null, border: 'R',
    },
    volcano: {
        id: 'volcano', name: 'Vulcão', width: [56, 96], height: [40, 64], meander: 0.30,
        ground: [['a', 1]], patch: null,
        obstacles: { fraction: 0.14, scale: 7, scatter: 0.015, symbols: [['O', 1]] },
        liquid: { ch: 'L', fraction: 0.13, scale: 8 }, shore: null, border: 'O',
    },
    snow: {
        id: 'snow', name: 'Neve', width: [64, 104], height: [44, 68], meander: 0.24,
        ground: [['n', 1]], patch: null,
        obstacles: { fraction: 0.18, scale: 7, scatter: 0.015, symbols: [['P', 6], ['i', 3]] },
        liquid: null, shore: null, border: 'P',
    },
    haunted: {
        id: 'haunted', name: 'Terras sombrias', width: [56, 96], height: [40, 64], meander: 0.32,
        ground: [['g', 1]], patch: null,
        obstacles: { fraction: 0.22, scale: 6, scatter: 0.02, symbols: [['d', 5], ['t', 3]] },
        liquid: null, shore: null, border: 'd',
    },
};
