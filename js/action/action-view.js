// ============================================================
// F12 · Mundo de Ação 3D · tela (integração). Contrato: docs/action/CONTRATO.md.
// Liga as peças: ActionWorld (simulação pura) + ActionDirector/IA (hordas) + Explore3D (mundo 3D do mapa) + Action3D (entidades,
// efeitos, câmera) + ActionHud (HUD e entrada). Aqui não há regra de jogo: só o laço de quadros, o passo fixo e o repasse de eventos.
// Enquanto o mundo de ação está aberto a batalha automática do idle fica segura (game.actionEnter) e volta ao sair.
// ============================================================
const ACTION_AUTO_KEY = 'pokemon_idle_action_auto';          // preferência deste aparelho: automático ligado/desligado
const ACTION_THREE_URL = 'js/vendor/three.module.min.js';
const ACTION_BLOCK_MESSAGES = {
    hunt_active: 'Pare ou pause a caçada automática na aba Caça para entrar no mundo.', tower: 'Saia da Torre de Desafio para entrar no mundo.',
    no_team: 'Você ainda não tem Pokémon na equipe.', offline: 'Aguarde o resumo offline terminar.', disabled: 'O mundo de ação está desligado.',
    webgl: 'Seu navegador não conseguiu abrir a cena 3D.', load: 'Não foi possível carregar a cena 3D.', fainted: 'Seus Pokémon estão sem forças. Cure-os no Centro Pokémon (modo Explorar) ou use poções.',
};

class ActionView {
    constructor(ui) {
        this.ui = ui; this.game = ui.game; this.open = false; this.mapId = 'viridian_forest';
        let auto = null; try { auto = localStorage.getItem(ACTION_AUTO_KEY); } catch (e) { /* sem armazenamento */ }
        this.auto = auto === 'on';
        this.pulse = { dash: false, skill: -1, capture: false, potion: false };
        this.move = { mx: 0, mz: 0 }; this.input = { mx: 0, mz: 0, dash: false, skill: -1, capture: false, potion: false };
        this.keep = {}; this.acc = 0; this.frames = 0; this.steps = 0; this._scr = { x: 0, y: 0 };
    }
    available() { return typeof ACTION_ENABLED === 'undefined' || ACTION_ENABLED; }
    _toast(msg) { if (this.ui && this.ui.showToast) this.ui.showToast(msg); }

    async start(mapId) {
        if (this.open || this._starting || !this.available()) return false;
        const g = this.game, reason = g.exploreBlockReason ? g.exploreBlockReason() : null;
        if (reason) { this._toast(ACTION_BLOCK_MESSAGES[reason] || reason); return false; }
        const map = actionMapById(mapId || this.mapId); if (!map) return false;
        this._starting = true;
        try { if (!window.THREE) window.THREE = await import(new URL(ACTION_THREE_URL, document.baseURI).href); }
        catch (e) { this._starting = false; this._toast(ACTION_BLOCK_MESSAGES.load); return false; }
        this._build();
        this.root.hidden = false; document.body.classList.add('in-action', 'exploring');        // 'exploring' pausa a arena 3D da aba de batalha
        let saved = null; try { saved = localStorage.getItem(typeof EXPLORE_QUALITY_KEY === 'string' ? EXPLORE_QUALITY_KEY : 'pokemon_idle_explore_quality'); } catch (e) { /* padrão */ }
        const device = { coarse: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches), dpr: window.devicePixelRatio || 1, cores: navigator.hardwareConcurrency || 0, memoryGb: navigator.deviceMemory || 0 };
        this.quality = EXPLORE_QUALITY[saved] ? saved : exploreDefaultQuality(device);
        try { this.e3d = new Explore3D(this.canvas, this.quality, window.devicePixelRatio || 1); if (!this.e3d.renderer.getContext()) throw new Error('webgl'); }
        catch (e) { this._teardown(); this._starting = false; this._toast(ACTION_BLOCK_MESSAGES.webgl); return false; }
        const r = g.actionEnter();
        if (!r.ok) { this._teardown(); this._starting = false; this._toast(ACTION_BLOCK_MESSAGES[r.code] || r.code); return false; }
        this.map = map; this.e3d.setMap(map);
        if (typeof exploreDayPhase === 'function') { const d = new Date(); this.e3d.applyDayPhase(exploreDayPhase(d.getHours() + d.getMinutes() / 60)); }
        this.gov = new ExploreFrameGovernor(this.quality, window.devicePixelRatio || 1);
        this._newWorld();
        if (!this.world.player) { g.actionLeave(); this._teardown(); this._starting = false; this._toast(ACTION_BLOCK_MESSAGES.fainted); return false; }
        this.hud = new ActionHud(this.root, {
            onSkill: (i) => { this.pulse.skill = i; }, onDash: () => { this.pulse.dash = true; }, onCapture: () => { this.pulse.capture = true; }, onPotion: () => { this.pulse.potion = true; },
            onAuto: (on) => this.setAuto(on === undefined ? !this.auto : !!on), onSwap: (i) => { if (this.world && !this.world.over) this.world.swapPlayer(i); }, onExit: () => this.close(),
        });
        this._audioInit(); if (this.music) this.music.play(map.music || 'route');
        this.open = true; this._starting = false; this._last = performance.now(); this.acc = 0;
        this._onResize = () => { if (this.e3d) this.e3d.resize(); }; window.addEventListener('resize', this._onResize);
        this._onVis = () => this._visibility(); document.addEventListener('visibilitychange', this._onVis);
        this._raf = requestAnimationFrame((t) => this._frame(t));
        this.hud.banner(map.name, 'place');
        return true;
    }
    _build() {
        if (this.root) return;
        const el = document.createElement('div'); el.id = 'action'; el.hidden = true;
        const c = document.createElement('canvas'); c.className = 'ac-canvas'; el.appendChild(c);
        document.body.appendChild(el); this.root = el; this.canvas = c;
    }
    _newWorld() {
        const g = this.game, route = g.getRoute(this.map.route);
        if (this.a3d) { this.a3d.dispose(); this.a3d = null; }
        this.world = new ActionWorld(g, this.map, { rng: () => g.rng(), think: typeof actionEnemyThink === 'function' ? actionEnemyThink : null, quality: this.quality, keep: this.keep });
        if (typeof ActionDirector === 'function') { this.director = new ActionDirector(this.world, this.map, route); this.world.director = this.director; }
        if (typeof actionAutoPilot === 'function') this.world.pilot = actionAutoPilot;
        this.world.auto = this.auto;
        this.a3d = new Action3D(this.e3d); this.a3d.attach(this.world);
        this.a3d.onDamage = (e, d) => { if (!this.hud) return; const p = this.a3d.screenOf(e, this._scr); this.hud.damage(p.x, p.y, typeof battleStageDamageLabel === 'function' ? this._label(e, d) : { text: `-${d.dmg}`, cls: '' }); };
    }
    _label(e, d) { const l = battleStageDamageLabel(d.dmg, d.crit, d.eff); if (e.kind === 'player') l.cls = (l.cls + ' player').trim(); return l; }
    setAuto(on) {
        this.auto = !!on; if (this.world) this.world.auto = this.auto;
        try { localStorage.setItem(ACTION_AUTO_KEY, this.auto ? 'on' : 'off'); } catch (e) { /* vale nesta sessão */ }
        this._visibility();
    }
    // Página em segundo plano com o automático ligado: a caçada continua (simulação sem desenho, em passos agrupados).
    _visibility() {
        if (!this.open) return;
        const hidden = document.hidden;
        if (hidden && this.auto && !this._bg) { this._bgLast = Date.now(); this._bg = setInterval(() => this._background(), 500); }
        if ((!hidden || !this.auto) && this._bg) { clearInterval(this._bg); this._bg = null; }
        if (!hidden && !this._raf) { this._last = performance.now(); this._raf = requestAnimationFrame((t) => this._frame(t)); }
    }
    _background() {
        if (!this.open || !this.world || this.world.over) return;
        const now = Date.now(), n = Math.min(30, Math.floor((now - this._bgLast) / 1000 / ACTION_STEP)); this._bgLast = now;
        this._setInput();
        for (let i = 0; i < n; i++) { this.world.step(ACTION_STEP); this.steps++; }
        this._events(this.world.drainEvents(), false);
    }
    _setInput() {
        const i = this.input, p = this.pulse;
        if (this.hud) this.hud.readMove(this.move);
        i.mx = this.move.mx; i.mz = this.move.mz; i.dash = p.dash; i.skill = p.skill; i.capture = p.capture; i.potion = p.potion;
        this.world.setInput(i);
    }
    _clearPulse() { const p = this.pulse; p.dash = false; p.skill = -1; p.capture = false; p.potion = false; const i = this.input; i.dash = false; i.skill = -1; i.capture = false; i.potion = false; this.world.setInput(i); }
    _frame(now) {
        this._raf = 0;
        if (!this.open || document.hidden) return;                    // em segundo plano o laço de quadros para (ver _visibility)
        this._raf = requestAnimationFrame((t) => this._frame(t));
        if (!this.gov.shouldRender(now, true)) return;
        const dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
        const w = this.world;
        if (!w.over && !this.paused) {
            this.acc += dt; this._setInput();
            let n = 0;
            while (this.acc >= ACTION_STEP && n < 4) { w.step(ACTION_STEP); this.acc -= ACTION_STEP; n++; this.steps++; if (n === 1) this._clearPulse(); }
            if (n === 4) this.acc = 0;                                 // aparelho lento: não acumula dívida de simulação
        }
        const ev = w.drainEvents();
        this.a3d.frame(w, ev, dt, Math.min(1, this.acc / ACTION_STEP));
        this._events(ev, true);
        this.hud.update(w.snapshot());
        this.frames++;
    }
    // eventos que interessam à tela (faixas, sons, fim de jogo); o desenho 3D já consumiu os mesmos eventos
    _events(ev, visible) {
        for (let k = 0; k < ev.length; k++) {
            const e = ev[k];
            if (e.t === 'wave') { if (visible && this.hud) this.hud.banner(e.kind === 'boss' ? 'Chefe da floresta!' : e.kind === 'elite' ? `Onda ${e.n} · Elite!` : `Onda ${e.n}`, e.kind || 'wave'); if (e.kind === 'boss' && this.music) this.music.play('leader'); this._sfx(e.kind === 'boss' ? 'boss' : 'wave'); }
            else if (e.t === 'level') { const z = e.growth && e.growth.after && e.growth.after[e.growth.active]; if (visible && this.hud && z) this.hud.banner(`${z.name} subiu para o nível ${z.level}!`, 'level'); this._sfx('level'); }
            else if (e.t === 'evolve') { if (visible && this.hud) this.hud.banner(`Evoluiu para ${POKEMON_DATA[e.to] ? POKEMON_DATA[e.to].name : '???'}!`, 'evolve'); this._sfx('evolve'); }
            else if (e.t === 'capture') { if (e.stage === 'caught') { if (visible && this.hud) this.hud.banner('Capturado!', 'capture'); this._sfx('caught'); } else if (e.stage === 'throw') this._sfx('throw'); }
            else if (e.t === 'die') { if (e.tier === 'boss') { if (visible && this.hud) this.hud.banner('Chefe derrotado!', 'level'); if (this.music) this.music.play(this.map.music || 'route'); } this._sfx('die'); }
            else if (e.t === 'hit') this._sfx(e.crit ? 'crit' : 'hit');
            else if (e.t === 'wipe') this._wipe();
            else if (e.t === 'down') { if (visible && this.hud) this.hud.banner('Seu Pokémon desmaiou!', 'down'); this._sfx('down'); }
        }
    }
    _wipe() {
        if (this.hud) this.hud.banner('Sua equipe desmaiou… recomeçando', 'down');
        if (this._restart) return;
        this._restart = setTimeout(() => { this._restart = null; if (!this.open) return; this.keep = {}; this._newWorld(); this.acc = 0; }, 2600);      // volta curada, da primeira onda
    }
    close() {
        if (!this.open) return;
        this.open = false;
        if (this.world && this.world.keep) this.keep = this.world.keep();
        this.game.actionLeave();
        this._teardown();
        if (this.ui && this.ui.scheduleRenderTeam) this.ui.scheduleRenderTeam();
    }
    _teardown() {
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        if (this._bg) { clearInterval(this._bg); this._bg = null; }
        if (this._restart) { clearTimeout(this._restart); this._restart = null; }
        if (this._onResize) { window.removeEventListener('resize', this._onResize); this._onResize = null; }
        if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); this._onVis = null; }
        if (this.music) this.music.stop();
        if (this.hud) { this.hud.dispose(); this.hud = null; }
        if (this.a3d) { this.a3d.dispose(); this.a3d = null; }
        if (this.e3d) { this.e3d.dispose(); this.e3d = null; }
        this.world = null; this.director = null;
        if (this.root) this.root.hidden = true;
        document.body.classList.remove('in-action', 'exploring');
    }

    // ---------------- som (sintetizado; sem arquivos) ----------------
    _audioInit() {
        try { if (!this.audio) { const A = window.AudioContext || window.webkitAudioContext; if (A) this.audio = new A(); } if (this.audio && this.audio.state === 'suspended') this.audio.resume(); } catch (e) { this.audio = null; }
        let on = true; try { on = localStorage.getItem('pokemon_idle_explore_music') !== 'off'; } catch (e) { /* ligado */ }
        if (this.audio && !this.music && typeof ExploreMusic === 'function') this.music = new ExploreMusic(this.audio);
        if (this.music) this.music.setEnabled(on);
    }
    _sfx(kind) {
        const ac = this.audio; if (!ac || ac.state !== 'running') return;
        const now = ac.currentTime; if (kind === 'hit' || kind === 'die') { if (now - (this._sfxAt || 0) < 0.07) return; this._sfxAt = now; }       // hordas: não empilha dezenas de sons no mesmo instante
        const tone = (f, d, type = 'square', v = 0.04, delay = 0, slide = 1) => { const t = now + delay, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide !== 1) o.frequency.exponentialRampToValueAtTime(f * slide, t + d); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + 0.02); };
        const seq = (notes, step, type) => notes.forEach((n, i) => tone(n, step * 1.4, type, 0.045, i * step));
        switch (kind) {
            case 'hit': tone(190, 0.09, 'sawtooth', 0.035, 0, 0.5); break;
            case 'crit': tone(330, 0.14, 'sawtooth', 0.05, 0, 0.4); break;
            case 'die': tone(520, 0.16, 'triangle', 0.035, 0, 0.35); break;
            case 'wave': seq([392, 523, 659], 0.08, 'square'); break;
            case 'boss': seq([196, 185, 196, 233, 196], 0.12, 'sawtooth'); break;
            case 'level': seq([784, 988, 1175, 1568], 0.075, 'square'); break;
            case 'evolve': seq([523, 659, 784, 1047, 1319], 0.1, 'triangle'); break;
            case 'caught': seq([523, 659, 784, 1047], 0.1, 'triangle'); break;
            case 'throw': tone(600, 0.22, 'triangle', 0.04, 0, 2); break;
            case 'down': tone(440, 0.5, 'triangle', 0.05, 0, 0.3); break;
        }
    }
}
