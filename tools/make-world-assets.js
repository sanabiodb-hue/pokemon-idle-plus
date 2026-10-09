#!/usr/bin/env node
'use strict';
// ============================================================
// Gera os assets locais e originais do mundo visual (Fase 7.1), sem dependências:
//   sprites/world/tileset.png   16x6 tiles de 16 px (layout em WORLD_TILESET, js/world/world-data.js)
//   sprites/world/hero.png      4 quadros 16x24 (baixo, cima, esquerda, direita): placeholder do treinador
// Determinístico: rodar de novo produz exatamente os mesmos bytes. Para trocar a arte, basta substituir os PNGs
// mantendo o layout (ou ajustar WORLD_TILESET / WORLD_CHARACTER).
// Uso: node tools/make-world-assets.js
// ============================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'sprites', 'world');
const T = 16;
const COLS = 16;

// ---------- PNG RGBA mínimo ----------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- superfície de pixels ----------
class Surface {
    constructor(w, h) { this.w = w; this.h = h; this.d = Buffer.alloc(w * h * 4); }
    set(x, y, c) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = (y * this.w + x) * 4, a = c.length > 3 ? c[3] : 255;
        if (a >= 255 || this.d[i + 3] === 0) { this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a; return; }
        const f = a / 255;
        this.d[i] = Math.round(c[0] * f + this.d[i] * (1 - f)); this.d[i + 1] = Math.round(c[1] * f + this.d[i + 1] * (1 - f)); this.d[i + 2] = Math.round(c[2] * f + this.d[i + 2] * (1 - f));
        this.d[i + 3] = Math.min(255, this.d[i + 3] + a);
    }
    solid(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[(y * this.w + x) * 4 + 3] > 0; }
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
    disc(cx, cy, r, c) { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, c); }
    ellipse(cx, cy, rx, ry, c) { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) this.set(x, y, c); }
    // contorno escuro em volta dos pixels opacos (dá leitura aos objetos sobre qualquer fundo)
    outline(c) {
        const add = [];
        for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
            if (this.solid(x, y)) continue;
            if (this.solid(x - 1, y) || this.solid(x + 1, y) || this.solid(x, y - 1) || this.solid(x, y + 1)) add.push([x, y]);
        }
        for (const [x, y] of add) this.set(x, y, c);
    }
    blit(src, dx, dy) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const i = (y * src.w + x) * 4; if (src.d[i + 3]) this.set(dx + x, dy + y, [src.d[i], src.d[i + 1], src.d[i + 2], src.d[i + 3]]); } }
}
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- paleta própria ----------
const P = {
    g1: hex('#79c14e'), g2: hex('#68b044'), g3: hex('#8fd262'), g4: hex('#4d9a3c'),
    dirt: hex('#d4b277'), dirtD: hex('#bd965c'), dirtL: hex('#e4c98f'), dirtE: hex('#9a7647'),
    wat: hex('#3f9bd8'), watL: hex('#74c1ee'), watD: hex('#2c78b3'), foam: hex('#b8e4f6'), sand: hex('#e0cf94'), bankD: hex('#2d5f3a'),
    leaf: hex('#2f8040'), leafD: hex('#1f5c2d'), leafL: hex('#58ad53'), trunk: hex('#6c4727'), trunkD: hex('#4b2f18'),
    rock: hex('#9ca2a8'), rockD: hex('#6d7379'), rockL: hex('#c8cdd2'),
    red: hex('#e5484d'), yel: hex('#f6d445'), wht: hex('#ffffff'),
    wood: hex('#b07a43'), woodD: hex('#7b522a'), woodL: hex('#cf9a5f'),
    ink: hex('#1b2230'),
};

// ---------- tiles ----------
const tileset = new Surface(COLS * T, 6 * T);
const tileAt = (index) => ({ sx: (index % COLS) * T, sy: Math.floor(index / COLS) * T });

function newTile() { return new Surface(T, T); }
function grassBase(s, seed, tuft = false) {
    const r = rng(seed);
    s.rect(0, 0, T - 1, T - 1, P.g1);
    for (let i = 0; i < 26; i++) s.set(Math.floor(r() * T), Math.floor(r() * T), r() < 0.6 ? P.g2 : P.g3);
    if (tuft) for (let i = 0; i < 3; i++) { const x = 2 + Math.floor(r() * 11), y = 3 + Math.floor(r() * 10); s.set(x, y, P.g4); s.set(x - 1, y - 1, P.g4); s.set(x + 1, y - 1, P.g4); s.set(x, y - 1, P.g3); }
}
function putTile(index, s) { const { sx, sy } = tileAt(index); tileset.blit(s, sx, sy); }
// objeto com contorno sobre grama
function objectOnGrass(index, seed, draw) {
    const base = newTile(); grassBase(base, seed);
    const layer = newTile(); draw(layer, rng(seed + 99)); layer.outline(P.ink);
    base.blit(layer, 0, 0); putTile(index, base);
}

// 0-3 grama, 4 tufo
for (let v = 0; v < 4; v++) { const s = newTile(); grassBase(s, 100 + v * 31); putTile(v, s); }
{ const s = newTile(); grassBase(s, 555, true); putTile(4, s); }
// 5-6 flores
for (const [idx, col, seed] of [[5, P.red, 610], [6, P.yel, 620]]) {
    const s = newTile(); grassBase(s, seed); const r = rng(seed + 5);
    for (let i = 0; i < 5; i++) { const x = 2 + Math.floor(r() * 12), y = 2 + Math.floor(r() * 12); s.set(x, y, col); s.set(x - 1, y, col); s.set(x + 1, y, col); s.set(x, y - 1, col); s.set(x, y + 1, col); s.set(x, y, P.wht); s.set(x, y + 2, P.g4); }
    putTile(idx, s);
}
// 7 grama alta
{
    const s = newTile(); s.rect(0, 0, T - 1, T - 1, P.g4); const r = rng(700);
    for (let i = 0; i < 12; i++) { const x = Math.floor(r() * T), y = 4 + Math.floor(r() * 11); for (let k = 0; k < 5; k++) s.set(x + (k % 2 ? 1 : 0), y - k, k < 3 ? P.g1 : P.g3); }
    for (let x = 0; x < T; x += 4) { s.set(x, T - 1, P.leafD); s.set(x + 1, T - 2, P.leafD); }
    putTile(7, s);
}
// 8 arbusto
objectOnGrass(8, 810, (l) => { l.ellipse(8, 10.5, 6.5, 4.5, P.leaf); l.ellipse(6.5, 9, 3.5, 2.6, P.leafL); l.ellipse(11, 11.5, 3.2, 2, P.leafD); l.set(5, 8, P.g3); l.set(9, 9, P.g3); });
// 9 pedra
objectOnGrass(9, 910, (l) => { l.ellipse(8, 10.5, 6, 4.6, P.rock); l.ellipse(6.5, 8.6, 3.6, 2.4, P.rockL); l.ellipse(10.5, 12, 3.4, 2, P.rockD); l.set(9, 8, P.rockL); });
// 10-11 árvores (copas diferentes)
for (const [idx, seed, a, b, c] of [[10, 1010, P.leaf, P.leafL, P.leafD], [11, 1110, hex('#3a8a3c'), hex('#6dbb5a'), hex('#26602f')]]) {
    objectOnGrass(idx, seed, (l, r) => {
        l.rect(7, 11, 9, 15, P.trunk); l.rect(9, 11, 9, 15, P.trunkD);
        l.disc(8, 7, 6.6, a); l.disc(6.2, 5.6, 4.4, b); l.disc(10.6, 9, 3.6, c);
        for (let i = 0; i < 7; i++) l.set(3 + Math.floor(r() * 9), 3 + Math.floor(r() * 8), r() < 0.5 ? b : c);
        l.set(5, 4, P.g3); l.set(6, 3, P.g3);
    });
}
// 12 toco
objectOnGrass(12, 1210, (l) => { l.ellipse(8, 11.5, 5, 3.6, P.trunkD); l.ellipse(8, 10, 5, 3.2, P.woodL); l.ellipse(8, 10, 3, 1.8, P.wood); l.ellipse(8, 10, 1.2, 0.7, P.woodD); });
// 13 placa
objectOnGrass(13, 1310, (l) => { l.rect(7, 8, 8, 15, P.woodD); l.rect(2, 2, 13, 8, P.woodL); l.rect(2, 7, 13, 8, P.wood); l.rect(4, 4, 11, 4, P.woodD); l.rect(4, 6, 9, 6, P.woodD); });
// 14 cerca
objectOnGrass(14, 1410, (l) => { l.rect(0, 5, 15, 6, P.woodL); l.rect(0, 10, 15, 11, P.woodL); l.rect(0, 6, 15, 6, P.wood); l.rect(0, 11, 15, 11, P.wood); for (const x of [1, 7, 13]) { l.rect(x, 3, x + 1, 14, P.wood); l.rect(x + 1, 3, x + 1, 14, P.woodD); } });
// 15 grama sombreada (reserva: sub-bosque)
{ const s = newTile(); grassBase(s, 1500); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if ((x + y) % 2 === 0) s.set(x, y, [0, 30, 20, 40]); putTile(15, s); }

// ---------- cidade: prédios, praça e mobiliário (linha 4: índices 48-63) ----------
const B = {
    roofR: hex('#d64545'), roofRD: hex('#a42f33'), roofRL: hex('#f07070'),
    roofB: hex('#4a78c2'), roofBD: hex('#33558f'), roofBL: hex('#7da2dc'),
    wall: hex('#ebe2c8'), wallD: hex('#cbbf9c'), wallS: hex('#a89c7c'), glass: hex('#7fc3ea'), glassD: hex('#4c8fc0'),
    metal: hex('#8d96a3'), metalD: hex('#69727f'), metalL: hex('#b9c1cc'), warn: hex('#f2c230'),
    stone: hex('#cdc6b2'), stoneD: hex('#aaa28d'), stoneL: hex('#e2dccb'),
};
function roof(index, base, dark, light, part, emblem) {
    const s = newTile();
    s.rect(0, 0, T - 1, T - 1, base);
    for (let y = 3; y < T; y += 4) s.rect(0, y, T - 1, y, dark);                      // fileiras de telhas
    for (let y = 0; y < T; y += 4) for (let x = (y / 4) % 2 ? 4 : 0; x < T; x += 8) s.set(x, y + 1, dark);
    s.rect(0, 0, T - 1, 1, light);                                                   // cumeeira clara
    s.rect(0, T - 2, T - 1, T - 1, dark);                                            // beiral
    if (part === 'L') { s.rect(0, 0, 1, T - 1, dark); s.rect(1, 2, 1, T - 3, light); }
    if (part === 'R') { s.rect(T - 2, 0, T - 1, T - 1, dark); s.rect(T - 2, 2, T - 2, T - 3, light); }
    if (emblem === 'cross') { s.disc(8, 7, 5.2, [255, 255, 255]); s.rect(7, 3, 8, 11, base); s.rect(4, 6, 12, 7, base); }
    if (emblem === 'box') { s.rect(3, 3, 12, 11, [245, 240, 225]); s.rect(3, 3, 12, 3, [200, 190, 165]); s.rect(7, 3, 8, 11, [200, 190, 165]); s.rect(3, 11, 12, 11, [150, 140, 118]); }
    putTile(index, s);
}
function wall(index, part, kind) {
    const s = newTile();
    s.rect(0, 0, T - 1, T - 1, B.wall);
    s.rect(0, T - 2, T - 1, T - 1, B.wallS);                                          // rodapé
    for (let y = 2; y < T - 2; y += 5) s.rect(0, y, T - 1, y, B.wallD);              // juntas
    if (part === 'L') s.rect(0, 0, 0, T - 1, B.wallS);
    if (part === 'R') s.rect(T - 1, 0, T - 1, T - 1, B.wallS);
    if (kind === 'window') { s.rect(3, 3, 12, 10, B.wallS); s.rect(4, 4, 11, 9, B.glass); s.rect(4, 4, 11, 5, B.glassD); s.rect(7, 4, 8, 9, B.wallS); s.rect(4, 7, 11, 7, B.wallS); }
    if (kind === 'center-door') { s.rect(2, 1, 13, T - 1, B.wallS); s.rect(3, 2, 12, T - 1, B.glass); s.rect(3, 2, 12, 5, B.glassD); s.rect(7, 2, 8, T - 1, B.wallS); s.rect(3, 12, 12, T - 1, [180, 60, 60]); s.rect(1, T - 2, 14, T - 1, B.stoneD); }
    if (kind === 'gate') { s.rect(1, 1, 14, T - 1, B.metalD); for (let y = 3; y < T - 1; y += 3) s.rect(2, y, 13, y, B.metal); s.rect(2, 2, 13, 2, B.metalL); for (let x = 1; x < 15; x += 4) s.rect(x, 1, x + 1, 1, B.warn); s.rect(1, T - 2, 14, T - 1, B.stoneD); }
    putTile(index, s);
}
roof(48, B.roofR, B.roofRD, B.roofRL, 'L'); roof(49, B.roofR, B.roofRD, B.roofRL, 'M', 'cross'); roof(50, B.roofR, B.roofRD, B.roofRL, 'R');
wall(51, 'L', 'window'); wall(52, 'M', 'center-door'); wall(53, 'R', 'window');
roof(54, B.roofB, B.roofBD, B.roofBL, 'L'); roof(55, B.roofB, B.roofBD, B.roofBL, 'M', 'box'); roof(56, B.roofB, B.roofBD, B.roofBL, 'R');
wall(57, 'L', 'window'); wall(58, 'M', 'gate'); wall(59, 'R', 'window');
// 60 praça de pedra
{ const s = newTile(); s.rect(0, 0, T - 1, T - 1, B.stone); const r = rng(6000);
  for (let y = 0; y < T; y += 8) for (let x = ((y / 8) % 2) * 4; x < T + 8; x += 8) { s.rect(x, y, Math.min(x + 7, T - 1), y, B.stoneD); s.rect(x, y, x, Math.min(y + 7, T - 1), B.stoneD); }
  for (let i = 0; i < 10; i++) s.set(Math.floor(r() * T), Math.floor(r() * T), r() < 0.5 ? B.stoneL : B.stoneD);
  putTile(60, s); }
// 61 banco, 62 poste de luz (objetos sobre a praça)
function objectOnPlaza(index, draw) { const base = newTile(); base.blit(sliceTile(60), 0, 0); const layer = newTile(); draw(layer); layer.outline(P.ink); base.blit(layer, 0, 0); putTile(index, base); }
function sliceTile(index) { const { sx, sy } = tileAt(index); const t = newTile(); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const i = ((sy + y) * tileset.w + sx + x) * 4; if (tileset.d[i + 3]) t.set(x, y, [tileset.d[i], tileset.d[i + 1], tileset.d[i + 2], tileset.d[i + 3]]); } return t; }
objectOnPlaza(61, (l) => { l.rect(2, 6, 13, 8, P.woodL); l.rect(2, 8, 13, 8, P.wood); l.rect(2, 10, 13, 11, P.woodL); l.rect(3, 8, 4, 13, P.woodD); l.rect(11, 8, 12, 13, P.woodD); });
objectOnPlaza(62, (l) => { l.rect(7, 5, 8, 14, P.ink); l.rect(7, 5, 7, 14, [70, 78, 92]); l.rect(5, 1, 10, 4, [250, 226, 140]); l.rect(6, 0, 9, 0, [90, 98, 112]); l.rect(5, 4, 10, 4, [220, 190, 90]); l.rect(6, 13, 9, 14, [90, 98, 112]); });
// 63 placa de rua (seta para a rota) sobre grama
objectOnGrass(63, 6300, (l) => { l.rect(7, 7, 8, 15, P.woodD); l.rect(2, 2, 13, 7, P.woodL); l.rect(2, 6, 13, 7, P.wood); l.rect(3, 4, 10, 4, P.woodD); l.rect(10, 3, 12, 5, P.woodD); l.set(12, 4, P.woodL); });

// ---------- autotiles (máscara: N=1, E=2, S=4, W=8 = vizinho do mesmo tipo) ----------
function edgeDistance(mask, x, y) {
    // distância (em px) até o lado aberto mais próximo, com cantos arredondados
    let d = 99;
    if (!(mask & 1)) d = Math.min(d, y);
    if (!(mask & 4)) d = Math.min(d, T - 1 - y);
    if (!(mask & 8)) d = Math.min(d, x);
    if (!(mask & 2)) d = Math.min(d, T - 1 - x);
    for (const [a, b, cx, cy] of [[1, 8, 0, 0], [1, 2, T - 1, 0], [4, 8, 0, T - 1], [4, 2, T - 1, T - 1]]) {
        if (!(mask & a) && !(mask & b)) d = Math.min(d, Math.round(Math.hypot(x - cx, y - cy) * 0.75));
    }
    return d;
}
for (let mask = 0; mask < 16; mask++) {
    // caminho de terra
    const s = newTile(); const r = rng(2000 + mask);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const d = edgeDistance(mask, x, y);
        if (d <= 1) { s.set(x, y, ((x * 7 + y * 3) % 5 === 0) ? P.g2 : P.g1); continue; }
        if (d === 2) { s.set(x, y, P.dirtE); continue; }
        if (d === 3) { s.set(x, y, P.dirtD); continue; }
        s.set(x, y, P.dirt);
    }
    for (let i = 0; i < 18; i++) { const x = Math.floor(r() * T), y = Math.floor(r() * T); if (edgeDistance(mask, x, y) > 3) s.set(x, y, r() < 0.5 ? P.dirtD : P.dirtL); }
    for (let i = 0; i < 2; i++) { const x = 4 + Math.floor(r() * 8), y = 4 + Math.floor(r() * 8); if (edgeDistance(mask, x, y) > 4) { s.set(x, y, P.rock); s.set(x + 1, y, P.rockD); s.set(x, y - 1, P.rockL); } }
    putTile(16 + mask, s);

    // água com margem
    const w = newTile(); const q = rng(3000 + mask);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const d = edgeDistance(mask, x, y);
        if (d <= 0) { w.set(x, y, P.g1); continue; }
        if (d === 1) { w.set(x, y, P.bankD); continue; }
        if (d === 2) { w.set(x, y, P.sand); continue; }
        if (d === 3) { w.set(x, y, P.foam); continue; }
        w.set(x, y, (y + (x >> 2)) % 6 < 3 ? P.wat : P.watD);
    }
    for (let i = 0; i < 4; i++) { const x = 3 + Math.floor(q() * 8), y = 4 + Math.floor(q() * 9); if (edgeDistance(mask, x, y) > 4) { w.set(x, y, P.watL); w.set(x + 1, y, P.watL); w.set(x + 2, y, P.watL); } }
    putTile(32 + mask, w);
}


// ---------- biomas dos mapas de caça (F7.4): linhas 5 e 6 (índices 64-95) ----------
const BI = {
    cave: hex('#6b6470'), caveD: hex('#4f4a57'), caveL: hex('#8a8392'), crystal: hex('#5fc8e8'), crystalL: hex('#c4f1ff'), crystalD: hex('#2f7fb0'),
    ash: hex('#4a4044'), ashD: hex('#352d31'), ashL: hex('#645459'), basalt: hex('#2a2428'), basaltL: hex('#51454a'), ember: hex('#f08a24'),
    lava: hex('#e8531c'), lavaL: hex('#ffb347'), lavaD: hex('#a8280f'), crust: hex('#3a2a2c'),
    snow: hex('#eef6fb'), snowD: hex('#cfe2ee'), snowS: hex('#b4cfe0'), pine: hex('#2c6b53'), pineL: hex('#4f9a77'), ice: hex('#9fd8f2'), iceL: hex('#e6fbff'), iceD: hex('#5aa6cf'),
    gloom: hex('#4b3f63'), gloomD: hex('#382e4d'), gloomL: hex('#65577f'), dead: hex('#3b3040'), deadL: hex('#5b4b63'), stoneG: hex('#aaa6b8'), stoneGD: hex('#7f7a92'),
    sandL: hex('#ecdca6'), sandD: hex('#cdb97f'),
};
function groundTile(index, seed, base, a, b, specks = 22) {
    const s = newTile(), r = rng(seed);
    s.rect(0, 0, T - 1, T - 1, base);
    for (let i = 0; i < specks; i++) s.set(Math.floor(r() * T), Math.floor(r() * T), r() < 0.55 ? a : b);
    putTile(index, s);
    return s;
}
function objectOnTile(index, seed, groundIndex, draw) {
    const base = sliceTile(groundIndex), layer = newTile();
    draw(layer, rng(seed)); layer.outline(P.ink);
    base.blit(layer, 0, 0); putTile(index, base);
}
// 64-65 chão de caverna, 66 pedregulho, 67 cristal
groundTile(64, 6400, BI.cave, BI.caveD, BI.caveL); groundTile(65, 6410, BI.cave, BI.caveL, BI.caveD, 28);
objectOnTile(66, 6600, 64, (l) => { l.ellipse(8, 9.5, 7, 5.6, BI.caveD); l.ellipse(6.5, 7.6, 4.4, 3, BI.caveL); l.ellipse(11, 11.5, 3.6, 2.4, BI.cave); l.set(9, 7, BI.caveL); });
objectOnTile(67, 6700, 65, (l) => { for (const [x, h, c] of [[5, 9, BI.crystalD], [8, 12, BI.crystal], [11, 8, BI.crystalD]]) { for (let k = 0; k < h; k++) l.rect(x - (k < 2 ? 0 : 0), 14 - k, x + 1, 14 - k, k > h - 3 ? BI.crystalL : c); } l.set(8, 3, BI.crystalL); l.set(8, 4, BI.crystalL); l.rect(3, 14, 13, 15, BI.caveD); });
// 68-69 cinza vulcânica, 70 basalto, 71-72 neve, 73 pinheiro nevado, 74 pedra de gelo
groundTile(68, 6800, BI.ash, BI.ashD, BI.ashL); groundTile(69, 6810, BI.ash, BI.ashL, BI.ember, 26);
objectOnTile(70, 7000, 68, (l) => { l.ellipse(8, 10, 6.4, 5, BI.basalt); l.ellipse(6.5, 8.2, 3.8, 2.4, BI.basaltL); l.set(10, 12, BI.ember); l.set(5, 11, BI.lavaD); });
groundTile(71, 7100, BI.snow, BI.snowD, BI.snowS, 18); groundTile(72, 7110, BI.snow, BI.snowS, BI.snowD, 24);
objectOnTile(73, 7300, 71, (l) => { l.rect(7, 12, 8, 15, P.trunkD); for (const [y, hw] of [[11, 5], [7, 4], [3, 3]]) for (let k = 0; k < 4; k++) l.rect(8 - hw + k * 0 - (3 - k) * 0, y + k, 8 + hw - 1, y + k, k < 2 ? BI.pine : BI.pineL); l.rect(5, 6, 10, 6, BI.snow); l.rect(6, 10, 11, 10, BI.snow); l.rect(4, 14, 11, 14, BI.snowD); });
objectOnTile(74, 7400, 72, (l) => { l.ellipse(8, 10, 6, 5, BI.iceD); l.ellipse(7, 8, 4, 3, BI.ice); l.ellipse(6, 7, 1.6, 1.2, BI.iceL); l.set(11, 12, BI.iceL); });
// 75-76 solo sombrio, 77 árvore morta, 78 lápide, 79 areia
groundTile(75, 7500, BI.gloom, BI.gloomD, BI.gloomL); groundTile(76, 7510, BI.gloom, BI.gloomL, BI.gloomD, 26);
objectOnTile(77, 7700, 75, (l) => { l.rect(7, 6, 8, 15, BI.dead); l.rect(8, 6, 8, 15, P.trunkD); for (const [x0, y0, x1, y1] of [[3, 4, 7, 8], [9, 3, 13, 7], [4, 10, 7, 11], [9, 9, 12, 10]]) { for (let k = 0; k <= Math.max(x1 - x0, 1); k++) l.set(Math.min(x0 + k, x1), y0 + Math.round(((y1 - y0) * k) / Math.max(x1 - x0, 1)), BI.deadL); } l.set(7, 5, BI.deadL); });
objectOnTile(78, 7800, 76, (l) => { l.rect(4, 5, 11, 14, BI.stoneG); l.rect(5, 3, 10, 5, BI.stoneG); l.rect(4, 12, 11, 14, BI.stoneGD); l.rect(10, 5, 11, 14, BI.stoneGD); l.rect(7, 6, 8, 10, BI.stoneGD); l.rect(6, 8, 9, 9, BI.stoneGD); });
groundTile(79, 7900, BI.sandL, BI.sandD, P.dirtL, 20);
// 80-95 lava (autotile, mesma máscara da água; borda de cinza escura em vez de grama)
for (let mask = 0; mask < 16; mask++) {
    const l = newTile(), q = rng(8000 + mask);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const d = edgeDistance(mask, x, y);
        if (d <= 0) { l.set(x, y, BI.ash); continue; }
        if (d === 1) { l.set(x, y, BI.basalt); continue; }
        if (d === 2) { l.set(x, y, BI.crust); continue; }
        if (d === 3) { l.set(x, y, BI.lavaD); continue; }
        l.set(x, y, (y + (x >> 2)) % 6 < 3 ? BI.lava : BI.lavaD);
    }
    for (let i = 0; i < 5; i++) { const x = 3 + Math.floor(q() * 9), y = 4 + Math.floor(q() * 9); if (edgeDistance(mask, x, y) > 4) { l.set(x, y, BI.lavaL); l.set(x + 1, y, BI.lavaL); } }
    putTile(80 + mask, l);
}

// ---------- personagem (placeholder original) ----------
const HW = 16, HH = 24;
const hero = new Surface(HW * 4, HH);
const H = { cap: hex('#1fa3a3'), capD: hex('#157a7a'), band: hex('#f4f1de'), skin: hex('#f3c9a0'), skinD: hex('#d9a67c'), hair: hex('#5a3a22'),
    coat: hex('#f08a24'), coatD: hex('#c46a12'), pants: hex('#2b3a67'), pantsD: hex('#1d2850'), shoe: hex('#2a2a35'), eye: hex('#1b2230') };
function heroFrame(col, dir) {
    const f = new Surface(HW, HH);
    f.ellipse(8, 21.2, 5, 1.8, [0, 0, 0, 70]);                                 // sombra no chão
    // pernas e sapatos
    f.rect(5, 16, 7, 20, H.pants); f.rect(8, 16, 10, 20, H.pantsD); f.rect(5, 20, 7, 21, H.shoe); f.rect(8, 20, 10, 21, H.shoe);
    if (dir === 'left' || dir === 'right') { f.rect(5, 16, 10, 20, H.pants); f.rect(7, 16, 8, 20, H.pantsD); f.rect(5, 20, 10, 21, H.shoe); }
    // tronco e braços
    f.rect(4, 10, 11, 16, H.coat); f.rect(9, 10, 11, 16, H.coatD); f.rect(7, 10, 8, 16, H.coat);
    if (dir === 'down' || dir === 'up') { f.rect(3, 11, 3, 15, H.coat); f.rect(12, 11, 12, 15, H.coatD); f.set(3, 16, H.skin); f.set(12, 16, H.skin); }
    else { const ax = dir === 'left' ? 6 : 8; f.rect(ax, 11, ax + 2, 15, H.coatD); f.set(ax + 1, 16, H.skin); }
    // cabeça
    f.rect(4, 4, 11, 10, H.skin); f.set(4, 4, [0, 0, 0, 0]); f.set(11, 4, [0, 0, 0, 0]); f.rect(4, 9, 11, 10, H.skin); f.rect(10, 6, 11, 10, H.skinD);
    // boné
    f.rect(4, 1, 11, 4, H.cap); f.rect(10, 1, 11, 4, H.capD); f.rect(5, 0, 10, 0, H.cap); f.rect(4, 5, 11, 5, H.band);
    if (dir === 'down') { f.set(6, 7, H.eye); f.set(9, 7, H.eye); f.set(7, 9, H.skinD); f.set(8, 9, H.skinD); f.rect(3, 5, 12, 5, H.band); }
    else if (dir === 'up') { f.rect(4, 4, 11, 10, H.hair); f.rect(4, 1, 11, 3, H.cap); f.rect(10, 1, 11, 3, H.capD); f.rect(5, 0, 10, 0, H.cap); f.rect(10, 5, 11, 10, [0x45, 0x2c, 0x19]); }
    else { const fx = dir === 'left' ? 5 : 10; f.set(fx, 7, H.eye); f.rect(dir === 'left' ? 2 : 11, 5, dir === 'left' ? 4 : 13, 5, H.band); f.rect(dir === 'left' ? 9 : 4, 6, dir === 'left' ? 11 : 6, 10, H.hair); }
    f.outline(P.ink);
    hero.blit(f, col * HW, 0);
}
['down', 'up', 'left', 'right'].forEach((d, i) => heroFrame(i, d));

// ---------- saída ----------
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'tileset.png'), encodePng(tileset.w, tileset.h, tileset.d));
fs.writeFileSync(path.join(OUT, 'hero.png'), encodePng(hero.w, hero.h, hero.d));
console.log(`sprites/world/tileset.png ${tileset.w}x${tileset.h}  hero.png ${hero.w}x${hero.h}`);
