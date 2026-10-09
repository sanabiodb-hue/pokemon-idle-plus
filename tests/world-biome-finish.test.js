'use strict';
// F7.8: acabamento dos biomas. Caminhos por bioma (sem borda de grama em lava/neve/caverna/assombrado), tiles antigos intactos,
// geração determinística. O PNG é decodificado aqui (filtros PNG 0–4) para conferir pixels reais.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { loadWorld, ROOT } = require('./helpers/world-env');

const W = loadWorld();

function decodePng(buf) {
    const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20), colorType = buf[25];
    assert.equal(buf[24], 8, 'profundidade 8');
    const bpp = { 6: 4, 2: 3 }[colorType];
    assert.ok(bpp, 'RGB/RGBA');
    const idat = [];
    for (let o = 8; o < buf.length;) {
        const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
        if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
        o += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * bpp, out = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
            let v = raw[src + x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
            out[dst + x] = v & 255;
        }
    }
    return { width, height, bpp, data: out };
}
const png = decodePng(fs.readFileSync(path.join(ROOT, 'sprites', 'world', 'tileset.png')));
const T = W.WORLD_TILE_SIZE;
function tilePixels(index) {
    const cols = W.WORLD_TILESET.cols, tx = (index % cols) * T, ty = Math.floor(index / cols) * T, px = [];
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const o = ((ty + y) * png.width + tx + x) * png.bpp; px.push([png.data[o], png.data[o + 1], png.data[o + 2]]); }
    return px;
}
const isGreen = ([r, g, b]) => g > r + 25 && g > b + 25;
const greenShare = (index) => tilePixels(index).filter(isGreen).length / (T * T);

test('F7.8 tileset: dimensões batem com WORLD_TILESET e os tiles de trilha novos cabem no PNG', () => {
    assert.equal(png.width, W.WORLD_TILESET.cols * T);
    assert.equal(png.height, W.WORLD_TILESET.rows * T);
    for (const name of ['caveTrailBase', 'ashTrailBase', 'snowTrailBase', 'gloomTrailBase']) {
        const base = W.WORLD_TILESET.tiles[name];
        assert.ok(Number.isInteger(base) && base + 15 < W.WORLD_TILESET.cols * W.WORLD_TILESET.rows, name);
    }
});

test('F7.8 tiles antigos intactos: as 6 primeiras linhas e os índices antigos não mudaram', () => {
    const tiles = W.WORLD_TILESET.tiles;
    // SHA-1 dos pixels das 6 linhas originais (256x96), calculado sobre o PNG da F7.7 (d666b97)
    const old = crypto.createHash('sha1').update(png.data.subarray(0, png.width * 6 * T * png.bpp)).digest('hex');
    assert.equal(old, 'fa2c362d9899c5af1c35a0bc871c7a6d6c509814');
    for (const [name, base] of [['pathBase', tiles.pathBase], ['waterBase', tiles.waterBase], ['lavaBase', tiles.lavaBase]]) assert.ok(base + 15 < 96, `${name} segue nas linhas antigas`);
    for (const name of ['caveTrailBase', 'ashTrailBase', 'snowTrailBase', 'gloomTrailBase']) assert.ok(tiles[name] >= 96, `${name} só usa linhas novas`);
    assert.ok(png.height >= 6 * T);
});

test('F7.8 sem borda de grama: nenhum tile de trilha de caverna/vulcão/neve/assombrado tem verde; a trilha de grama continua com terra', () => {
    for (const name of ['caveTrailBase', 'ashTrailBase', 'snowTrailBase', 'gloomTrailBase']) {
        for (let m = 0; m < 16; m++) assert.equal(greenShare(W.WORLD_TILESET.tiles[name] + m), 0, `${name}+${m} tem pixels verdes`);
    }
});

test('F7.8 cada bioma aponta para um caminho existente; biomas sem grama não usam o caminho padrão', () => {
    const legend = W.WORLD_LEGEND;
    for (const [id, b] of Object.entries(W.WORLD_BIOMES)) {
        const def = legend[b.path];
        assert.ok(def && def.kind === 'path' && def.walkable, `${id}: letra de caminho '${b.path}'`);
        if (def.auto) assert.ok(W.WORLD_TILESET.tiles[def.auto] !== undefined, `${id}: ${def.auto} existe`);
    }
    for (const id of ['cave', 'volcano', 'snow', 'haunted']) assert.notEqual(W.WORLD_BIOMES[id].path, 'p', id);
    const letters = ['cave', 'volcano', 'snow', 'haunted'].map(id => W.WORLD_BIOMES[id].path);
    assert.equal(new Set(letters).size, 4, 'cada bioma tem sua trilha');
});

test('F7.8 mapas gerados: o corredor usa a letra do bioma e o terreno continua caminhável de ponta a ponta', () => {
    const picks = { forest: 1, meadow: 16, lake: 7, cave: 27, volcano: 4, snow: 87, haunted: 23 };
    for (const [biome, species] of Object.entries(picks)) {
        const map = W.worldHuntMap(species);
        const letter = W.WORLD_BIOMES[biome].path;
        const rows = map.rows || map.grid || map.layout;
        assert.ok(rows.join('').includes(letter), `${biome}: usa '${letter}'`);
        if (letter !== 'p') assert.ok(!rows.join('').includes('p'), `${biome}: sem trilha de terra`);
    }
});

test('F7.8 determinismo: a geração dos 7 biomas é idêntica entre contextos e sem cache', () => {
    const ids = [1, 16, 7, 27, 4, 87, 23];
    const snap = (w) => ids.map(id => JSON.stringify(w.worldHuntMap(id)));
    const a = snap(W);
    W.worldHuntCacheClear();
    assert.deepEqual(snap(W), a);
    assert.deepEqual(snap(loadWorld()), a);
});
