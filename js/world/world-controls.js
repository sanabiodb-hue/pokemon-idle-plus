// ============================================================
// Mundo visual · entrada (Fase 7.2): teclado (setas e WASD) e direcional na tela (toque/mouse) para a caminhada MANUAL das
// cidades. Só produz uma direção (ou null) e pedidos de "interagir" pelo teclado (o botão Interagir é um <button> comum,
// tratado pela view); não conhece mapa, posição nem renderer.
//   - DirectionStack (puro): fontes de entrada (uma tecla, um dedo) empilhadas em ordem de pressão; vale a última ainda
//     pressionada, e soltar uma volta para a anterior. Soltar sempre funciona, mesmo com a entrada desligada.
//   - WorldControls (DOM): liga/desliga os ouvintes junto com a aba e SOLTA tudo ao perder foco, esconder a página, sair da
//     aba ou perder o ponteiro (nada de tecla ou toque preso).
// ============================================================
class DirectionStack {
    constructor() { this.entries = []; }
    // Registra (ou reposiciona como a mais recente) a fonte `id` indo na direção `dir`. Devolve true se a direção atual mudou.
    press(id, dir) {
        const before = this.current();
        this.entries = this.entries.filter(e => e.id !== id);
        this.entries.push({ id, dir });
        return this.current() !== before;
    }
    release(id) {
        const before = this.current();
        this.entries = this.entries.filter(e => e.id !== id);
        return this.current() !== before;
    }
    clear() { const had = this.entries.length > 0; this.entries = []; return had; }
    current() { return this.entries.length ? this.entries[this.entries.length - 1].dir : null; }
    get size() { return this.entries.length; }
}

const WORLD_KEY_DIRS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};
const WORLD_KEY_FALLBACK = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', e: 'KeyE' };

class WorldControls {
    // root: elemento do painel (contém os botões [data-dir] do direcional)
    // onChange(direction): a direção efetiva mudou; onInteract(): o jogador pediu para interagir
    constructor({ root, onChange, onInteract }) {
        this.root = root;
        this.onChange = onChange || (() => {});
        this.onInteract = onInteract || (() => {});
        this.stack = new DirectionStack();
        this.enabled = false;
        this.attached = false;
        this._h = {
            keydown: (e) => this._keyDown(e),
            keyup: (e) => this._keyUp(e),
            blur: () => this.clear(),
            visibility: () => { if (document.hidden) this.clear(); },
            pointerdown: (e) => this._pointerDown(e),
            pointerup: (e) => this._pointerUp(e),
            contextmenu: (e) => { if (this._dirButton(e)) e.preventDefault(); },
        };
    }

    attach() {
        if (this.attached) return;
        this.attached = true;
        document.addEventListener('keydown', this._h.keydown);
        document.addEventListener('keyup', this._h.keyup);
        document.addEventListener('visibilitychange', this._h.visibility);
        window.addEventListener('blur', this._h.blur);
        if (this.root) {
            this.root.addEventListener('pointerdown', this._h.pointerdown);
            for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.root.addEventListener(t, this._h.pointerup);
            this.root.addEventListener('contextmenu', this._h.contextmenu);
        }
    }

    // Desliga tudo e solta qualquer direção pressionada
    detach() {
        if (!this.attached) return;
        this.attached = false;
        document.removeEventListener('keydown', this._h.keydown);
        document.removeEventListener('keyup', this._h.keyup);
        document.removeEventListener('visibilitychange', this._h.visibility);
        window.removeEventListener('blur', this._h.blur);
        if (this.root) {
            this.root.removeEventListener('pointerdown', this._h.pointerdown);
            for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.root.removeEventListener(t, this._h.pointerup);
            this.root.removeEventListener('contextmenu', this._h.contextmenu);
        }
        this.clear();
    }

    // Só mapas de cidade ligam a entrada; desligar solta tudo
    setEnabled(flag) {
        const on = !!flag;
        if (on === this.enabled) return;
        this.enabled = on;
        if (!on) this.clear();
    }

    direction() { return this.enabled ? this.stack.current() : null; }

    clear() { if (this.stack.clear()) this.onChange(this.direction()); }

    // ---- teclado ----
    static _isFormTarget(t) {
        if (!t) return false;
        const tag = String(t.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
    }
    static _code(e) { return e.code || WORLD_KEY_FALLBACK[String(e.key || '').toLowerCase()] || e.key || ''; }

    _keyDown(e) {
        if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey || WorldControls._isFormTarget(e.target)) return;
        const code = WorldControls._code(e), dir = WORLD_KEY_DIRS[code];
        if (dir) {
            e.preventDefault();                                  // evita rolar a página com as setas
            if (e.repeat) return;
            if (this.stack.press(code, dir)) this.onChange(this.direction());
            return;
        }
        const tag = String(e.target && e.target.tagName || '').toUpperCase();
        if ((code === 'KeyE' || (code === 'Enter' && tag !== 'BUTTON')) && !e.repeat) { e.preventDefault(); this.onInteract(); }
    }
    _keyUp(e) {
        const code = WorldControls._code(e);
        if (WORLD_KEY_DIRS[code] && this.stack.release(code)) this.onChange(this.direction());   // soltar sempre vale
    }

    // ---- direcional na tela (um id por ponteiro: vários dedos funcionam) ----
    _dirButton(e) { return e.target && e.target.closest ? e.target.closest('[data-dir]') : null; }
    _pointerDown(e) {
        const btn = this._dirButton(e);
        if (!btn || !this.enabled) return;
        const dir = btn.dataset.dir;
        if (!WORLD_DIRS[dir]) return;
        e.preventDefault();
        if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro sintético */ } }
        if (this.stack.press('p' + e.pointerId, dir)) this.onChange(this.direction());
    }
    _pointerUp(e) {
        if (this.stack.release('p' + e.pointerId)) this.onChange(this.direction());
    }
}
