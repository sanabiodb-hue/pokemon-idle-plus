'use strict';
// F10.1: qualidade gráfica do modo Explorar — presets, escolha pelo aparelho, rebaixamento automático, teto de FPS / repouso,
// resolução adaptativa com histerese e blocos de descarte do mapa.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { newGame } = require('./helpers/game');

const ctxOf = () => newGame().ctx;

test('F10.1 presets: Leve ≤ Médio ≤ Alto em resolução, mato, FPS e alcance; sombras e material mais baratos embaixo', () => {
    const { EXPLORE_QUALITY: Q, EXPLORE_QUALITY_ORDER: O } = ctxOf();
    assert.deepEqual([...O], ['low', 'medium', 'high']);
    for (let i = 1; i < O.length; i++) {
        const a = Q[O[i - 1]], b = Q[O[i]];
        for (const k of ['pixelRatioMax', 'pixelRatioMin', 'grassPerCell', 'fpsCap', 'idleFps', 'fogFar']) assert.ok(a[k] <= b[k], `${O[i - 1]}.${k} <= ${O[i]}.${k}`);
    }
    assert.equal(Q.low.shadows, 'blob'); assert.equal(Q.medium.shadows, 'static'); assert.equal(Q.high.shadows, 'dynamic');
    assert.equal(Q.low.material, 'lambert'); assert.equal(Q.high.material, 'standard');
    assert.equal(Q.low.antialias, false); assert.equal(Q.medium.antialias, false); assert.equal(Q.high.antialias, true);
    for (const id of O) assert.ok(Q[id].idleFps < Q[id].fpsCap, 'em repouso desenha menos');
});

test('F10.1 escolha pelo aparelho: celular = Médio (fraco = Leve); PC = Alto (fraco = Médio)', () => {
    const c = ctxOf();
    assert.equal(c.exploreDefaultQuality({ coarse: true, cores: 8, memoryGb: 8 }), 'medium');
    assert.equal(c.exploreDefaultQuality({ coarse: true, cores: 4 }), 'low');
    assert.equal(c.exploreDefaultQuality({ coarse: true, memoryGb: 2 }), 'low');
    assert.equal(c.exploreDefaultQuality({ coarse: false, cores: 12 }), 'high');
    assert.equal(c.exploreDefaultQuality({ coarse: false, cores: 2 }), 'medium');
    assert.equal(c.exploreDefaultQuality({}), 'high', 'sem informação: PC padrão');
});

test('F10.1 resolução inicial: densidade da tela limitada pelo preset', () => {
    const c = ctxOf();
    assert.equal(c.explorePixelRatio('low', 3), 0.85); assert.equal(c.explorePixelRatio('medium', 3), 1.25); assert.equal(c.explorePixelRatio('high', 3), 1.75);
    assert.equal(c.explorePixelRatio('high', 1), 1); assert.equal(c.explorePixelRatio('low', 0.4), 0.55, 'nunca abaixo do mínimo');
});

test('F10.1 rebaixamento automático: só na janela inicial, só sem escolha manual, um nível por vez', () => {
    const c = ctxOf();
    assert.equal(c.exploreAutoDowngrade('high', 18, 3000, false), 'medium');
    assert.equal(c.exploreAutoDowngrade('medium', 18, 3000, false), 'low');
    assert.equal(c.exploreAutoDowngrade('low', 10, 3000, false), null, 'já está no mínimo');
    assert.equal(c.exploreAutoDowngrade('high', 18, c.EXPLORE_AUTO_WINDOW_MS + 1, false), null, 'fora da janela');
    assert.equal(c.exploreAutoDowngrade('high', 18, 3000, true), null, 'escolha manual manda');
    assert.equal(c.exploreAutoDowngrade('high', 40, 3000, false), null, 'FPS bom não muda');
    assert.equal(c.exploreQualityNext('high'), 'low'); assert.equal(c.exploreQualityNext('low'), 'medium');
});

test('F10.1 teto de FPS: em movimento respeita fpsCap; em repouso, idleFps', () => {
    const c = ctxOf();
    const g = new c.ExploreFrameGovernor('low', 3);
    let n = 0; for (let t = 0; t < 1000; t += 1000 / 60) if (g.shouldRender(t, true)) n++;
    assert.ok(n >= 29 && n <= 31, `ativo: ${n} quadros/s (teto 30)`);
    const h = new c.ExploreFrameGovernor('low', 3); n = 0;
    for (let t = 0; t < 1000; t += 1000 / 60) if (h.shouldRender(t, false)) n++;
    assert.ok(n >= 14 && n <= 16, `repouso: ${n} quadros/s (15)`);
    const hi = new c.ExploreFrameGovernor('high', 1); n = 0;
    for (let t = 0; t < 1000; t += 1000 / 60) if (hi.shouldRender(t, true)) n++;
    assert.ok(n >= 59, `Alto ativo a 60 Hz desenha todos: ${n}`);
});

test('F10.1 resolução adaptativa: quadros lentos baixam 0,1 até o mínimo; estável no teto sobe 0,05 devagar até o máximo', () => {
    const c = ctxOf();
    const g = new c.ExploreFrameGovernor('medium', 3);           // começa em 1,25, teto 45 FPS (orçamento 22,2 ms)
    assert.equal(g.ratio, 1.25);
    let changes = [];
    for (let i = 0; i < 200; i++) { const r = g.sample(60); if (r !== null) changes.push(r); }
    assert.deepEqual(changes.slice(0, 3), [1.15, 1.05, 0.95]);
    assert.equal(g.ratio, 0.7, 'para no mínimo do preset');
    changes = [];
    for (let i = 0; i < 89; i++) assert.equal(g.sample(22.2), null, 'sem pressa para subir');
    const up = g.sample(22.2); assert.ok(up === null || up === 0.75);
    for (let i = 0; i < 3000; i++) g.sample(22.2);
    assert.equal(g.ratio, 1.25, 'volta até o máximo do preset (limitado pela densidade da tela)');
    const one = new c.ExploreFrameGovernor('high', 1);
    for (let i = 0; i < 3000; i++) one.sample(16.6);
    assert.equal(one.ratio, 1, 'tela de densidade 1 nunca passa de 1');
    assert.equal(g.sample(5000), null, 'amostra absurda (aba escondida) é ignorada');
});

test('F10.1 blocos: cada célula em exatamente um bloco de 16×16', () => {
    const c = ctxOf();
    const cells = []; for (let y = 0; y < 50; y++) for (let x = 0; x < 70; x++) if ((x * 7 + y * 3) % 5 === 0) cells.push([x, y]);
    const ch = c.exploreChunks(cells);
    let total = 0;
    for (const [k, list] of ch) { const [bx, by] = k.split(',').map(Number); for (const [x, y] of list) { assert.equal(Math.floor(x / 16), bx); assert.equal(Math.floor(y / 16), by); } total += list.length; }
    assert.equal(total, cells.length);
    assert.equal(ch.size, 5 * 4);
});

test('F10.1 flag desligada: sempre Alto, sem teto nem resolução adaptativa', () => {
    const c = ctxOf();
    vm.runInContext('EXPLORE_QUALITY_ENABLED = false', c.sandbox);
    assert.equal(c.exploreDefaultQuality({ coarse: true, cores: 2 }), 'high');
    const g = new c.ExploreFrameGovernor('high', 3); let n = 0;
    for (let t = 0; t < 1000; t += 5) if (g.shouldRender(t, false)) n++;
    assert.equal(n, 200, 'desenha todo quadro');
    for (let i = 0; i < 100; i++) assert.equal(g.sample(80), null);
    assert.equal(c.exploreAutoDowngrade('high', 5, 100, false), null);
});
