// ============================================================
// F10.1 · Modo Explorar · qualidade gráfica e desempenho (funções puras, sem DOM nem Three.js; testáveis no Node).
//   - presets Leve / Médio / Alto: resolução máxima, sombras, material, mato por tile, teto de FPS, antialias, FPS em repouso,
//     alcance da névoa (o que está além dela nem é desenhado);
//   - escolha inicial pelo aparelho (toque, densidade da tela, núcleos e memória) e rebaixamento automático nos primeiros segundos;
//   - ExploreFrameGovernor: decide se o quadro é desenhado (teto de FPS; em repouso, FPS menor) e ajusta a resolução pelo tempo
//     real dos quadros (resolução adaptativa com histerese);
//   - exploreChunks: agrupa as células do mapa em blocos para a câmera descartar o que está fora da tela.
// ============================================================
let EXPLORE_QUALITY_ENABLED = true;           // desligado: sempre o preset "high" sem limites (comportamento da F10)
const EXPLORE_QUALITY_ORDER = ['low', 'medium', 'high'];
const EXPLORE_QUALITY = {
    low: { label: 'Leve', pixelRatioMax: 0.85, pixelRatioMin: 0.55, shadows: 'blob', material: 'lambert', grassPerCell: 5, fpsCap: 30, idleFps: 15, antialias: false, fogFar: 30, treeShadowBlobs: true, treeSegs: 5, treeTiers: 1, bushDetail: 0, flowersPerCell: 1 },
    medium: { label: 'Médio', pixelRatioMax: 1.25, pixelRatioMin: 0.7, shadows: 'static', material: 'lambert', grassPerCell: 9, fpsCap: 45, idleFps: 20, antialias: false, fogFar: 38, treeShadowBlobs: false, treeSegs: 6, treeTiers: 2, bushDetail: 1, flowersPerCell: 2 },
    high: { label: 'Alto', pixelRatioMax: 1.75, pixelRatioMin: 1.0, shadows: 'dynamic', material: 'standard', grassPerCell: 14, fpsCap: 60, idleFps: 30, antialias: true, fogFar: 46, treeShadowBlobs: false, treeSegs: 7, treeTiers: 2, bushDetail: 1, flowersPerCell: 3 },
};
const EXPLORE_CHUNK_SIZE = 16;                 // tiles por lado de cada bloco (descarte pela câmera)
const EXPLORE_AUTO_WINDOW_MS = 4000;           // janela inicial para medir e rebaixar o preset sozinho
const EXPLORE_AUTO_MIN_FPS = 24;               // abaixo disso na janela inicial, desce um nível

function exploreQualityPreset(id) { return EXPLORE_QUALITY[id] || EXPLORE_QUALITY.high; }
function exploreQualityLower(id) { const i = EXPLORE_QUALITY_ORDER.indexOf(id); return i > 0 ? EXPLORE_QUALITY_ORDER[i - 1] : null; }
function exploreQualityNext(id) { const i = EXPLORE_QUALITY_ORDER.indexOf(id); return EXPLORE_QUALITY_ORDER[(i + 1) % EXPLORE_QUALITY_ORDER.length]; }

// Preset inicial pelo aparelho. device: { coarse (tela de toque principal), dpr, cores, memoryGb }
function exploreDefaultQuality(device = {}) {
    if (!EXPLORE_QUALITY_ENABLED) return 'high';
    const cores = Number(device.cores) || 0, mem = Number(device.memoryGb) || 0;
    const weak = (cores > 0 && cores <= 4) || (mem > 0 && mem <= 3);
    if (device.coarse) return weak ? 'low' : 'medium';
    return weak ? 'medium' : 'high';
}
// Resolução inicial do renderer: a densidade da tela limitada pelo preset
function explorePixelRatio(id, dpr) { const q = exploreQualityPreset(id); return Math.max(q.pixelRatioMin, Math.min(q.pixelRatioMax, Number(dpr) > 0 ? dpr : 1)); }

// Agrupa as células [x, y] em blocos de `size` tiles: Map "bx,by" → lista (cada célula em exatamente um bloco, ordem preservada)
function exploreChunks(cells, size = EXPLORE_CHUNK_SIZE) {
    const out = new Map();
    for (const c of cells) { const k = Math.floor(c[0] / size) + ',' + Math.floor(c[1] / size); let l = out.get(k); if (!l) out.set(k, l = []); l.push(c); }
    return out;
}

// Rebaixamento automático: na janela inicial, FPS médio abaixo do mínimo → próximo preset abaixo (ou null se já está no mínimo/fora da janela)
function exploreAutoDowngrade(id, avgFps, elapsedMs, manual) {
    if (!EXPLORE_QUALITY_ENABLED || manual || elapsedMs > EXPLORE_AUTO_WINDOW_MS || !(avgFps > 0)) return null;
    return avgFps < EXPLORE_AUTO_MIN_FPS ? exploreQualityLower(id) : null;
}

// Decide os quadros e a resolução. now em ms (relógio injetável). Sem DOM: quem desenha é o chamador.
class ExploreFrameGovernor {
    constructor(qualityId, dpr) { this.setQuality(qualityId, dpr); this.lastRender = -Infinity; this.samples = []; this.rendered = 0; this.skipped = 0; }
    setQuality(qualityId, dpr) {
        this.id = qualityId; this.q = exploreQualityPreset(qualityId);
        this.dpr = Number(dpr) > 0 ? dpr : 1;
        this.ratio = explorePixelRatio(qualityId, this.dpr);
        this.maxRatio = Math.min(this.q.pixelRatioMax, Math.max(this.q.pixelRatioMin, this.dpr));
        this.samples = []; this.calm = 0;
    }
    // Desenha agora? active = algo se mexe (treinador andando, efeitos, entrada de batalha). Em repouso vale o FPS menor.
    shouldRender(now, active) {
        if (!EXPLORE_QUALITY_ENABLED) { this.lastRender = now; this.rendered++; return true; }
        const fps = active ? this.q.fpsCap : this.q.idleFps, minGap = 1000 / fps - 1;          // 1 ms de folga contra o jitter do vsync
        if (now - this.lastRender < minGap) { this.skipped++; return false; }
        this.lastRender = now; this.rendered++;
        return true;
    }
    // Registra a duração real de um quadro desenhado (ms entre dois quadros desenhados em movimento). Devolve a nova resolução se mudou, senão null.
    // Média das últimas 20 amostras: acima de 115% do orçamento → desce 0,1; batendo o teto (≤ 103% do orçamento) por 90 amostras seguidas → sobe 0,05
    // (histerese: desce rápido, sobe devagar; com o teto de FPS o intervalo nunca fica abaixo do orçamento, então "bater o teto" é o sinal de folga).
    sample(frameMs) {
        if (!EXPLORE_QUALITY_ENABLED || !(frameMs > 0) || frameMs > 1000) return null;
        this.samples.push(frameMs); if (this.samples.length > 20) this.samples.shift();
        if (this.samples.length < 20) return null;
        const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length, budget = 1000 / this.q.fpsCap;
        let next = this.ratio;
        if (avg > budget * 1.15) { next = Math.max(this.q.pixelRatioMin, Math.round((this.ratio - 0.1) * 100) / 100); this.calm = 0; }
        else if (avg <= budget * 1.03) { if (++this.calm >= 90) { next = Math.min(this.maxRatio, Math.round((this.ratio + 0.05) * 100) / 100); this.calm = 0; } }
        else this.calm = 0;
        if (next === this.ratio) return null;
        this.ratio = next; this.samples = [];
        return next;
    }
}
