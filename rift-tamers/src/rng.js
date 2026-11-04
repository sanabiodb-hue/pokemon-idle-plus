// RNG determinístico (mulberry32) e ruído de valor 2D/FBM. Sem dependências; roda no Node e no navegador.
export function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
export function makeRng(seed) {
    let a = (typeof seed === 'string' ? hashStr(seed) : seed) >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.state = () => a;
    return next;
}
function lattice(seed, x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
export function valueNoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = lattice(seed, xi, yi), b = lattice(seed, xi + 1, yi), c = lattice(seed, xi, yi + 1), d = lattice(seed, xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(seed, x, y, oct = 4) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += valueNoise(seed + i * 101, x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return sum / norm;
}
