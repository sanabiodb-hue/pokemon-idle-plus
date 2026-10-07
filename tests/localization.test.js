'use strict';
// Localização pt-BR: nenhum texto em chinês pode chegar ao jogador.
// (Comentários, logs/console, erros internos e avisos de diagnóstico continuam em chinês de propósito.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newGame } = require('./helpers/game');

const ROOT = path.join(__dirname, '..');
const CJK = /[㐀-鿿＀-￯　-〿]/;
const hasCjk = (v) => CJK.test(String(v));

function walk(value, trail, found, depth = 0) {
    if (depth > 6 || value === null) return;
    if (typeof value === 'string') { if (hasCjk(value)) found.push(`${trail} = ${value.slice(0, 40)}`); return; }
    if (typeof value !== 'object') return;
    for (const k of Object.keys(value)) walk(value[k], `${trail}.${k}`, found, depth + 1);
}

test('dados de texto: espécies, tipos, naturezas, regiões, rotas, insígnias, gemas, frutas, técnicas e talentos sem chinês', () => {
    const { ctx } = newGame();
    const found = [];
    for (const name of ['POKEMON_DATA', 'TYPE_NAMES', 'REGIONS', 'BADGE_DATA', 'GEM_QUALITIES', 'GEM_ATTRIBUTES', 'BERRY_DATA', 'SKILL_DATA', 'TALENT_DATA', 'POKEMON_NATURES']) {
        walk(ctx[name], name, found);
    }
    assert.deepEqual(found.slice(0, 10), [], `ainda há chinês em ${found.length} campos`);
});

test('espécies: 1073 nomes únicos, sem chinês, e nomes oficiais conhecidos nos ids certos', () => {
    const { ctx } = newGame();
    const P = ctx.POKEMON_DATA;
    const names = Object.values(P).map(p => p.name);
    assert.equal(names.length, 1073);
    assert.equal(new Set(names).size, 1073, 'nomes únicos');
    const known = { 1: 'Bulbasaur', 25: 'Pikachu', 26: 'Raichu', 133: 'Eevee', 150: 'Mewtwo', 252: 'Treecko', 387: 'Turtwig', 495: 'Snivy', 650: 'Chespin', 722: 'Rowlet', 810: 'Grookey', 906: 'Sprigatito', 1025: 'Pecharunt', 1026: 'Mega Venusaur', 1027: 'Mega Charizard X', 1073: 'Mega Diancie' };
    for (const [id, n] of Object.entries(known)) assert.equal(P[id].name, n, `#${id}`);
    assert.equal(P[29].name, 'Nidoran♀');
    assert.equal(P[83].name, "Farfetch'd");
});

test('termos consistentes: tipos, naturezas e regiões no glossário', () => {
    const { ctx } = newGame();
    assert.deepEqual(Object.values(ctx.TYPE_NAMES), ['Normal', 'Fogo', 'Água', 'Elétrico', 'Planta', 'Gelo', 'Lutador', 'Veneno', 'Terra', 'Voador', 'Psíquico', 'Inseto', 'Pedra', 'Fantasma', 'Dragão', 'Sombrio', 'Aço', 'Fada'].map(String));
    assert.equal(ctx.POKEMON_NATURES.length, 25);
    assert.equal(new Set(ctx.POKEMON_NATURES.map(n => n.name)).size, 25, 'nomes de natureza únicos');
    assert.deepEqual(Object.values(ctx.REGIONS).map(r => r.name), ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea', 'Mega Evolução']);
    assert.equal(ctx.REGIONS.kanto.routes[0].name, 'Rota 1');
    assert.match(Object.values(ctx.BERRY_DATA)[0].name, /^Fruta/, 'Berry = Fruta');
});

test('ids e estruturas internas não foram traduzidos (chaves, ids de rota, eventos)', () => {
    const { ctx } = newGame();
    assert.ok(ctx.REGIONS.kanto.routes.every(r => /^[a-z0-9_]+$/.test(r.id)));
    assert.deepEqual(Object.keys(ctx.TYPE_NAMES).slice(0, 3), ['normal', 'fire', 'water']);
    assert.ok(ctx.POKEMON_NATURES.every(n => /^[a-z]+$/.test(n.id)));
    assert.equal(ctx.POKEMON_NATURES[0].id, 'hardy');
});

test('ptPlural e ptNumber', () => {
    const { ctx } = newGame();
    assert.equal(ctx.ptPlural(1, 'espécie', 'espécies'), 'espécie');
    assert.equal(ctx.ptPlural(0, 'espécie', 'espécies'), 'espécies');
    assert.equal(ctx.ptPlural(2, 'espécie', 'espécies'), 'espécies');
    assert.equal(ctx.ptNumber(1234567), '1.234.567');
});

// ---- varredura estática do código-fonte: literais de texto em chinês só onde é diagnóstico interno ----
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let quote = null;      // ' " `
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (quote) {
            out += c;
            if (c === '\\') { out += d || ''; i += 2; continue; }
            if (c === quote) quote = null;
            i++;
            continue;
        }
        if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
        if (c === "'" || c === '"' || c === '`') quote = c;
        out += c;
        i++;
    }
    return out;
}

// Linhas em que o chinês é diagnóstico/interno e fica de propósito
const ALLOWED = [
    /_log\(/, /console\.(log|warn|error)/, /new Error\(/, /warnings\.push\(/, /\bwarnings: /,
    /\^箱子 /,                      // regex que reconhece o nome padrão de caixa gravado em saves
    /`箱子 \$\{/,                   // nome padrão da caixa (dado do save; a tela mostra “Caixa N”)
    /\/\*|\/\//,                    // comentário final de linha
];

test('código-fonte: nenhum literal em chinês visível ao jogador (exceto diagnósticos internos permitidos)', () => {
    const files = ['ui.js', 'pc-view.js', 'guide-view.js', 'guidance.js', 'main.js', 'game-core.js', 'game-config.js', 'route-data.js', 'pokemon-data.js',
        'save-manager.js', 'pokemon-instance.js', 'species-traits.js', 'pc.js', 'party.js', 'pokemon-roster.js', 'analytics.js'];
    const offenders = [];
    for (const f of files) {
        const raw = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
        const noComments = stripComments(raw).split('\n');
        const rawLines = raw.split('\n');
        noComments.forEach((line, i) => {
            if (!CJK.test(line)) return;
            if (ALLOWED.some(re => re.test(line) || re.test(rawLines[i] || ''))) return;
            offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
        });
    }
    assert.deepEqual(offenders, []);
});

test('index.html: nenhum texto, atributo ou título em chinês (comentários HTML à parte)', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const bad = html.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => CJK.test(l));
    assert.deepEqual(bad.slice(0, 5), []);
    assert.match(html, /<html lang="pt-BR">/);
});
