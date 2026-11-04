// ============================================================
// F10.3 · Modo Explorar · atmosfera: fases do dia pelo relógio do aparelho (função pura) e trilha sonora chiptune ORIGINAL
// sintetizada em tempo real (WebAudio, sem arquivos). As melodias foram compostas para este jogo.
// ============================================================
let EXPLORE_AMBIENCE_ENABLED = true;

// Fase do dia pela hora local (0–23,99). Cada fase dá as cores do céu/névoa e a força das luzes; `lamps` = postes acesos.
const EXPLORE_DAY_PHASES = [
    { id: 'night', from: 0, to: 5, label: 'Noite', sky: '#1b2340', hemi: 0.55, sun: 0.55, sunColor: '#9fb4ff', lamps: true },
    { id: 'dawn', from: 5, to: 7, label: 'Amanhecer', sky: '#f2b48a', hemi: 0.95, sun: 1.6, sunColor: '#ffc89a', lamps: false },
    { id: 'day', from: 7, to: 17, label: 'Dia', sky: null, hemi: 1.25, sun: 2.4, sunColor: '#fff4e0', lamps: false },
    { id: 'dusk', from: 17, to: 19, label: 'Entardecer', sky: '#e8875f', hemi: 0.9, sun: 1.5, sunColor: '#ff9a6a', lamps: true },
    { id: 'night', from: 19, to: 24, label: 'Noite', sky: '#1b2340', hemi: 0.55, sun: 0.55, sunColor: '#9fb4ff', lamps: true },
];
function exploreDayPhase(hour) {
    const h = ((Number(hour) % 24) + 24) % 24;
    if (!EXPLORE_AMBIENCE_ENABLED) return EXPLORE_DAY_PHASES[2];
    return EXPLORE_DAY_PHASES.find(p => h >= p.from && h < p.to) || EXPLORE_DAY_PHASES[2];
}

// ---------------- trilha ----------------
// Notação: cada faixa é uma lista de [nota, duração em semínimas]; nota em semitons a partir de Lá 440 (0 = A4), null = pausa.
const _N = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
function exploreNote(name) {                // "C5", "F#4", "Bb3" → semitons relativos a A4; "-" = pausa
    if (name === '-' || name === null) return null;
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) throw new Error('nota inválida: ' + name);
    return _N[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
}
const _seq = (s) => s.trim().split(/\s+/).map(tok => { const [n, d] = tok.split(':'); return [exploreNote(n), Number(d || 1)]; });
const EXPLORE_TRACKS = {
    town: { bpm: 104, loop: true, wave: ['square', 'triangle', 'triangle'],
        lead: _seq('E5:1 G5:1 A5:2 G5:1 E5:1 D5:2 C5:1 D5:1 E5:1 G5:1 E5:2 -:2 E5:1 G5:1 A5:2 B5:1 A5:1 G5:2 E5:1 D5:1 C5:1 D5:1 C5:2 -:2'),
        bass: _seq('C3:2 G3:2 A2:2 E3:2 F2:2 C3:2 G2:2 G3:2 C3:2 G3:2 A2:2 E3:2 F2:2 G2:2 C3:4'),
        pad: _seq('E4:4 C4:4 A3:4 B3:4 E4:4 C4:4 A3:4 G3:4') },
    route: { bpm: 132, loop: true, wave: ['square', 'triangle', 'square'],
        lead: _seq('G4:1 B4:1 D5:1 G5:1 F#5:1 D5:1 B4:2 C5:1 E5:1 G5:1 E5:1 D5:2 -:2 G4:1 B4:1 D5:1 G5:1 A5:1 G5:1 F#5:1 E5:1 D5:1 E5:1 F#5:1 A5:1 G5:2 -:2'),
        bass: _seq('G2:1 G3:1 G2:1 G3:1 C3:1 C4:1 C3:1 C4:1 D3:1 D4:1 D3:1 D4:1 G2:1 G3:1 D3:1 B2:1 G2:1 G3:1 G2:1 G3:1 C3:1 C4:1 C3:1 C4:1 D3:1 D4:1 D3:1 D4:1 G2:2 G2:2'),
        pad: _seq('B3:8 C4:8 B3:8 D4:8') },
    wild: { bpm: 168, loop: true, wave: ['sawtooth', 'triangle', 'square'],
        lead: _seq('E5:1 E5:1 G5:1 E5:1 A5:1 G5:1 E5:1 D5:1 E5:1 E5:1 G5:1 B5:1 A5:2 G5:2 E5:1 E5:1 G5:1 E5:1 C6:1 B5:1 A5:1 G5:1 F#5:1 G5:1 A5:1 F#5:1 E5:4'),
        bass: _seq('E2:1 E3:1 E2:1 E3:1 E2:1 E3:1 E2:1 E3:1 C2:1 C3:1 C2:1 C3:1 D2:1 D3:1 D2:1 D3:1 E2:1 E3:1 E2:1 E3:1 A2:1 A3:1 A2:1 A3:1 B2:1 B3:1 B2:1 B3:1 E2:4'),
        pad: _seq('B3:8 C4:4 D4:4 B3:8 A3:4 B3:4') },
    trainer: { bpm: 176, loop: true, wave: ['square', 'triangle', 'sawtooth'],
        lead: _seq('A4:1 C5:1 E5:1 A5:1 G5:1 E5:1 C5:1 E5:1 F5:1 A5:1 C6:1 A5:1 G5:2 E5:2 A4:1 C5:1 E5:1 A5:1 B5:1 A5:1 G5:1 E5:1 F5:1 E5:1 D5:1 B4:1 A4:4'),
        bass: _seq('A2:1 A3:1 A2:1 A3:1 A2:1 A3:1 A2:1 A3:1 F2:1 F3:1 F2:1 F3:1 G2:1 G3:1 G2:1 G3:1 A2:1 A3:1 A2:1 A3:1 E2:1 E3:1 E2:1 E3:1 F2:1 F3:1 G2:1 G3:1 A2:4'),
        pad: _seq('E4:8 F4:4 G4:4 E4:8 D4:4 E4:4') },
    gym: { bpm: 120, loop: true, wave: ['square', 'triangle', 'triangle'],
        lead: _seq('D5:1 F5:1 A5:2 G5:1 F5:1 E5:2 D5:1 E5:1 F5:1 A5:1 G5:2 -:2 D5:1 F5:1 A5:2 Bb5:1 A5:1 G5:2 F5:1 E5:1 D5:1 C#5:1 D5:2 -:2'),
        bass: _seq('D3:2 A2:2 Bb2:2 F2:2 G2:2 A2:2 D3:2 A2:2 D3:2 A2:2 Bb2:2 G2:2 A2:2 A2:2 D3:4'),
        pad: _seq('F4:4 D4:4 Bb3:4 C#4:4 F4:4 D4:4 E4:4 F4:4') },
    leader: { bpm: 184, loop: true, wave: ['sawtooth', 'triangle', 'square'],
        lead: _seq('D5:1 D5:1 A5:1 D5:1 C6:1 A5:1 F5:1 A5:1 G5:1 G5:1 D6:1 C6:1 A5:2 F5:2 D5:1 D5:1 A5:1 D5:1 C6:1 D6:1 E6:1 C6:1 Bb5:1 A5:1 G5:1 E5:1 D5:4'),
        bass: _seq('D2:1 D3:1 D2:1 D3:1 F2:1 F3:1 F2:1 F3:1 G2:1 G3:1 G2:1 G3:1 A2:1 A3:1 A2:1 A3:1 D2:1 D3:1 D2:1 D3:1 Bb2:1 Bb3:1 Bb2:1 Bb3:1 G2:1 G3:1 A2:1 A3:1 D2:4'),
        pad: _seq('A4:8 G4:4 A4:4 F4:8 G4:4 F4:4') },
    forest: { bpm: 112, loop: true, wave: ['triangle', 'triangle', 'sine'],          // F10.8: Floresta de Viridian (lá menor, misteriosa)
        lead: _seq('A4:1 C5:1 E5:2 D5:1 C5:1 B4:2 A4:1 B4:1 C5:1 E5:1 D5:2 -:2 F5:1 E5:1 D5:2 C5:1 B4:1 A4:2 G4:1 A4:1 B4:1 C5:1 A4:2 -:2'),
        bass: _seq('A2:2 E3:2 A2:2 E3:2 F2:2 C3:2 G2:2 D3:2 D2:2 A2:2 A2:2 E3:2 F2:2 G2:2 A2:4'),
        pad: _seq('C4:4 E4:4 A3:4 B3:4 F4:4 E4:4 D4:4 C4:4') },
    victory: { bpm: 140, loop: false, wave: ['square', 'triangle', 'triangle'],
        lead: _seq('G4:1 C5:1 E5:1 G5:3 E5:1 G5:5'),
        bass: _seq('C3:2 G3:2 C3:4 C3:4'),
        pad: _seq('E4:4 G4:4 C5:4') },
};
const exploreTrackLength = (track) => track.lead.reduce((a, n) => a + n[1], 0);      // em semínimas

// Motor da trilha: agenda notas com antecedência (lookahead), troca de faixa com fade curto. Liga/desliga sem perder o lugar.
class ExploreMusic {
    constructor(audioCtx) { this.ac = audioCtx; this.track = null; this.on = true; this.timer = null; this.gain = null; this.volume = 0.045; }
    setEnabled(on) { this.on = !!on; if (this.gain) this.gain.gain.setTargetAtTime(this.on ? this.volume : 0, this.ac.currentTime, 0.05); }
    play(name) {
        if (!EXPLORE_AMBIENCE_ENABLED || !this.ac || !EXPLORE_TRACKS[name]) return;
        if (this.track === name) return;
        this.stop(); this.track = name;
        const ac = this.ac, g = ac.createGain(); g.gain.value = 0; g.connect(ac.destination); this.gain = g;
        g.gain.setTargetAtTime(this.on ? this.volume : 0, ac.currentTime, 0.15);
        const t = EXPLORE_TRACKS[name], beat = 60 / t.bpm;
        const voices = [[t.lead, t.wave[0], 1], [t.bass, t.wave[1], 0.9], [t.pad, t.wave[2], 0.35]].map(([notes, wave, vol]) => ({ notes, wave, vol, i: 0, at: ac.currentTime + 0.05 }));
        const tick = () => {
            const horizon = ac.currentTime + 0.25;
            for (const v of voices) {
                while (v.at < horizon) {
                    if (v.i >= v.notes.length) { if (!t.loop) { v.done = true; break; } v.i = 0; }
                    const [n, d] = v.notes[v.i++], dur = d * beat;
                    if (n !== null) {
                        const o = ac.createOscillator(), e = ac.createGain();
                        o.type = v.wave; o.frequency.value = 440 * Math.pow(2, n / 12);
                        e.gain.setValueAtTime(0, v.at); e.gain.linearRampToValueAtTime(v.vol, v.at + 0.01); e.gain.setTargetAtTime(v.vol * 0.55, v.at + 0.03, 0.08); e.gain.setTargetAtTime(0, v.at + dur * 0.85, 0.03);
                        o.connect(e); e.connect(g); o.start(v.at); o.stop(v.at + dur + 0.1);
                    }
                    v.at += dur;
                }
            }
            if (voices.every(v => v.done)) { this.timer = null; this.track = null; return; }
            this.timer = setTimeout(tick, 100);
        };
        tick();
    }
    stop() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.gain) { const g = this.gain; g.gain.setTargetAtTime(0, this.ac.currentTime, 0.08); setTimeout(() => g.disconnect(), 600); this.gain = null; }
        this.track = null;
    }
}
