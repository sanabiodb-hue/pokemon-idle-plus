// Efeitos sonoros sintetizados em tempo real (WebAudio): nenhum arquivo de áudio.
let ac = null, master = null, enabled = true, last = {};
export function setSound(on) { enabled = on; if (master) master.gain.value = on ? 0.32 : 0; }
export function unlockAudio() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ac = new AC(); master = ac.createGain(); master.gain.value = enabled ? 0.32 : 0;
    const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
}
function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0) {
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, freq = 1200, delay = 0) {
    const t = ac.currentTime + delay, len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8; g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master); src.start(t);
}
// throttle por tipo para não virar ruído quando há muitas ações por segundo
export function sfx(kind, opt = {}) {
    if (!ac || !enabled || ac.state !== 'running') return;
    const now = performance.now(), gap = { hit: 70, crit: 120, ult: 250, faint: 150 }[kind] || 40;
    if (last[kind] && now - last[kind] < gap) return; last[kind] = now;
    const p = opt.pitch || 1;
    switch (kind) {
        case 'hit': noise(0.09, 0.18, 900 * p); tone(220 * p, 0.08, 'triangle', 0.12, 0.5); break;
        case 'crit': noise(0.15, 0.3, 1600); tone(660, 0.12, 'square', 0.08, 0.4); break;
        case 'super': tone(520 * p, 0.12, 'sawtooth', 0.08, 1.6); noise(0.1, 0.2, 1400); break;
        case 'ult': tone(110, 0.6, 'sawtooth', 0.14, 4); noise(0.5, 0.25, 500); tone(880, 0.4, 'sine', 0.1, 0.5, 0.1); break;
        case 'faint': tone(300, 0.45, 'triangle', 0.15, 0.25); break;
        case 'sync': [0, 4, 7, 12].forEach((s, i) => tone(330 * Math.pow(2, s / 12), 0.35, 'sawtooth', 0.07, 1, i * 0.05)); noise(0.4, 0.2, 2500); break;
        case 'win': [0, 4, 7, 12, 16].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.22, 'triangle', 0.12, 1, i * 0.07)); break;
        case 'lose': [0, -3, -7].forEach((s, i) => tone(330 * Math.pow(2, s / 12), 0.3, 'triangle', 0.12, 1, i * 0.12)); break;
        case 'capture': [0, 7, 12, 19, 24].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.18, 'sine', 0.14, 1, i * 0.06)); break;
        case 'prism': for (let i = 0; i < 10; i++) tone(700 + i * 180, 0.25, 'sine', 0.08, 1.2, i * 0.04); break;
        case 'evolve': tone(220, 1.1, 'sawtooth', 0.08, 4); [0, 5, 9, 12, 17, 21, 24].forEach((s, i) => tone(330 * Math.pow(2, s / 12), 0.3, 'triangle', 0.1, 1, 0.3 + i * 0.08)); break;
        case 'buy': tone(880, 0.07, 'square', 0.05); tone(1320, 0.08, 'square', 0.04, 1, 0.05); break;
        case 'ui': tone(1200, 0.04, 'sine', 0.05); break;
        case 'achieve': [0, 4, 7, 11, 14].forEach((s, i) => tone(440 * Math.pow(2, s / 12), 0.4, 'sine', 0.1, 1, i * 0.09)); break;
    }
}
