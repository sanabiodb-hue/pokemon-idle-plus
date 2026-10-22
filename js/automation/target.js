// F9.9 · Validação do ALVO de caça (função pura, ponto único). Um alvo só vale se for uma espécie inteira existente, que apareça na tabela natural da rota
// selecionada e que NÃO seja lendária nem mítica (lendários e míticos só aparecem pelo sorteio natural). A mesma função é usada pelo Centro de Caça, pelo
// sanitizador da política/sessão/fila salvas (parte que não depende da rota), pela fila e pelo motor do mundo (online e Fast Driver) como guarda final.
// O dado das espécies não tem flag de lendário/mítico: as listas abaixo são a referência canônica por id (limitação documentada).

const LEGENDARY_SPECIES_IDS = [
    144, 145, 146, 150, 243, 244, 245, 249, 250,                                   // Kanto e Johto
    377, 378, 379, 380, 381, 382, 383, 384,                                       // Hoenn
    480, 481, 482, 483, 484, 485, 486, 487, 488,                                  // Sinnoh
    638, 639, 640, 641, 642, 643, 644, 645, 646,                                  // Unova
    716, 717, 718,                                                                // Kalos
    785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798, 799, 800, 803, 804, 805, 806,   // Alola (inclui Ultra Beasts)
    888, 889, 890, 891, 892, 894, 895, 896, 897, 898,                             // Galar
    1001, 1002, 1003, 1004, 1007, 1008, 1024,                                     // Paldea
    1039, 1040, 1064, 1065, 1066,                                                 // formas Mega de Mewtwo, Latias, Latios e Rayquaza
];
const MYTHICAL_SPECIES_IDS = [
    151, 251, 385, 386, 489, 490, 491, 492, 493, 494, 647, 648, 649, 719, 720, 721, 801, 802, 807, 808, 809, 893,
    1014, 1015, 1016, 1017, 1025, 1073,                                           // Loyal Three, Ogerpon, Pecharunt e Mega Diancie
];
const _RESTRICTED_SPECIES = new Set([...LEGENDARY_SPECIES_IDS, ...MYTHICAL_SPECIES_IDS]);

// Kill-switch das regras da F9.9 (alvo na tabela da rota, sem lendário/mítico). Padrão ligado; só os testes anteriores à fase o desligam (helpers),
// como foi feito com as bolas na F9.5. Desligado, o alvo volta a valer com a única checagem anterior (a espécie existir).
let HUNT_TARGET_RULES_ENABLED = true;

const HUNT_TARGET_MESSAGES = {
    invalid_species: 'Espécie inválida.',
    restricted_species: 'Lendários e míticos só aparecem pelo sorteio natural das rotas.',
    no_route: 'Escolha uma rota antes de definir o alvo.',
    not_in_route: 'Essa espécie não aparece nesta rota.',
};

function isRestrictedSpecies(speciesId) { return HUNT_TARGET_RULES_ENABLED && _RESTRICTED_SPECIES.has(speciesId); }

// Espécies da tabela natural de uma rota (Set) ou null se a rota não existe. Cache por rota (as tabelas não mudam em tempo de execução).
const _routeSpeciesCache = new Map();
function routeSpeciesIds(routeId) {
    if (typeof routeId !== 'string') return null;
    if (_routeSpeciesCache.has(routeId)) return _routeSpeciesCache.get(routeId);
    let out = null;
    for (const k in REGIONS) {
        const r = REGIONS[k].routes.find(x => x.id === routeId);
        if (r) { out = new Set(r.pokemon.map(p => p.id)); break; }
    }
    _routeSpeciesCache.set(routeId, out);
    return out;
}

// Parte que NÃO depende da rota (usada pelos sanitizadores de saves): inteiro existente e não lendário/mítico.
function huntTargetBasicOk(speciesId) {
    return Number.isInteger(speciesId) && speciesId >= 1 && typeof POKEMON_DATA !== 'undefined' && Object.prototype.hasOwnProperty.call(POKEMON_DATA, speciesId) && !isRestrictedSpecies(speciesId);
}

// Validação completa. Devolve { ok: true } ou { ok: false, code, message }. `routeId` = rota selecionada (sem rota válida → recusa).
function huntTargetCheck(speciesId, routeId) {
    const fail = (code) => ({ ok: false, code, message: HUNT_TARGET_MESSAGES[code] });
    if (!Number.isInteger(speciesId) || speciesId < 1 || typeof POKEMON_DATA === 'undefined' || !Object.prototype.hasOwnProperty.call(POKEMON_DATA, speciesId)) return fail('invalid_species');
    if (!HUNT_TARGET_RULES_ENABLED) return { ok: true };
    if (_RESTRICTED_SPECIES.has(speciesId)) return fail('restricted_species');
    const natural = routeSpeciesIds(routeId);
    if (!natural) return fail('no_route');
    if (!natural.has(speciesId)) return fail('not_in_route');
    return { ok: true };
}
