// ============================================================
// ActionHud · HUD do modo de ação 3D (HTML por cima do canvas)
// Só interface: não conhece regra de jogo. Recebe o snapshot() do mundo, devolve intenções por handlers.
// CSS em css/action.css (prefixo ac-). Coordenadas de damage() em px relativos ao canto superior esquerdo do elemento raiz.
// update() é barato: guarda o último valor de cada campo e só toca no DOM quando algo muda.
// ============================================================
class ActionHud {
    constructor(rootEl, handlers) {
        this.root = rootEl;
        this.h = handlers || {};
        this._c = Object.create(null);          // cache do último valor de cada campo
        this._keys = Object.create(null);       // teclas de movimento pressionadas
        this._stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, r: 48 };
        this._snap = null;
        this._auto = false;
        this._pool = [];
        this._poolI = 0;
        this._flip = { dmg: 0, hit: 0, bump: 0, ban: 0 };
        this._bq = [];
        this._bt = 0;
        this._bBusy = false;
        this._partyN = -1;
        this._partyBtns = [];
        this._disposed = false;
        this._build();
        this._bind();
    }

    // ---------- montagem ----------
    _el(tag, cls, parent, attrs) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        return e;
    }

    _btn(cls, label, parent, extra) {
        const b = this._el('button', 'ac-b ' + cls, parent, Object.assign({ type: 'button', 'aria-label': label, title: label }, extra || {}));
        return b;
    }

    _build() {
        const root = this.root;
        root.classList.add('ac-root');
        if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) root.classList.add('ac-touch');
        const hud = this.hud = this._el('div', 'ac-hud', root);
        const svg = {
            dash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l7 6-7 6zM11 6l7 6-7 6z" fill="currentColor"/></svg>',
            potion: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v2h-1v4.2l4.4 8A3.2 3.2 0 0 1 15.6 21H8.4a3.2 3.2 0 0 1-2.8-4.8L10 8.2V4H9z" fill="currentColor" opacity=".9"/><path d="M8 15h8l1.6 3A1.4 1.4 0 0 1 16.4 20H7.6A1.4 1.4 0 0 1 6.4 18z" fill="#ff5c7a"/></svg>',
            auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 0 1 4.6 7l1.7 1A7 7 0 0 0 12 5zm-5.3 3.9A7 7 0 0 0 12 19v3l5-4-5-4v3a5 5 0 0 1-4.6-7z" fill="currentColor"/></svg>',
            exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
        };

        // vinheta de dano / vida baixa
        this.vig = this._el('div', 'ac-vig', hud);

        // (1) canto superior esquerdo
        const tl = this.tl = this._el('div', 'ac-card ac-tl', hud);
        this.pImg = this._el('img', 'ac-portrait', tl, { alt: '', draggable: 'false' });
        const pb = this._el('div', 'ac-pbody', tl);
        const pn = this._el('div', 'ac-pname', pb);
        this.pName = this._el('b', '', pn);
        this.pLv = this._el('span', 'ac-lv', pn);
        const hb = this.hpBar = this._el('div', 'ac-bar ac-hp', pb, { role: 'progressbar', 'aria-label': 'Vida do Pokémon ativo', 'aria-valuemin': '0' });
        this.hpGhost = this._el('i', 'ac-ghost', hb);
        this.hpFill = this._el('i', 'ac-fill', hb);
        this.hpTxt = this._el('span', 'ac-bar-n', hb);
        const xb = this.xpBar = this._el('div', 'ac-bar ac-xp', pb, { role: 'progressbar', 'aria-label': 'Experiência', 'aria-valuemin': '0', 'aria-valuemax': '100' });
        this.xpFill = this._el('i', 'ac-fill', xb);

        // (2) topo central: onda ou chefe
        const wv = this.wave = this._el('div', 'ac-card ac-wave', hud, { 'aria-live': 'off' });
        this.wTitle = this._el('b', 'ac-wave-t', wv);
        this.wSub = this._el('span', 'ac-wave-s', wv);
        const wb = this._el('div', 'ac-wave-bar', wv);
        this.wFill = this._el('i', '', wb);
        const bs = this.boss = this._el('div', 'ac-card ac-boss', hud);
        this.bImg = this._el('img', 'ac-portrait', bs, { alt: '', draggable: 'false' });
        const bb = this._el('div', 'ac-pbody', bs);
        const bn = this._el('div', 'ac-pname', bb);
        this.bName = this._el('b', '', bn);
        this.bTag = this._el('span', 'ac-lv ac-boss-tag', bn);
        this.bTag.textContent = 'Chefe';
        const bh = this.bossBar = this._el('div', 'ac-bar ac-hp ac-bosshp', bb, { role: 'progressbar', 'aria-label': 'Vida do chefe', 'aria-valuemin': '0' });
        this.bGhost = this._el('i', 'ac-ghost', bh);
        this.bFill = this._el('i', 'ac-fill', bh);
        this.bTxt = this._el('span', 'ac-bar-n', bh);

        // (3) canto superior direito
        const tr = this._el('div', 'ac-tr', hud);
        const kp = this.kills = this._el('div', 'ac-card ac-kills', tr, { 'aria-label': 'Abates' });
        this._el('span', 'ac-kills-i', kp).textContent = '☠';
        this.kN = this._el('b', '', kp);
        this.autoBtn = this._btn('ac-auto', 'Modo automático: desligado', tr, { 'aria-pressed': 'false' });
        this.autoBtn.innerHTML = svg.auto + '<span class="ac-auto-t">AUTO</span>';
        this.exitBtn = this._btn('ac-exit', 'Sair do modo de ação (Esc)', tr);
        this.exitBtn.innerHTML = svg.exit;
        this.combo = this._el('div', 'ac-combo', hud, { 'aria-hidden': 'true' });

        // (5) equipe
        this.party = this._el('div', 'ac-party', hud, { role: 'group', 'aria-label': 'Equipe' });

        // (4) controles
        this.stickBase = this._el('div', 'ac-stick', hud, { 'aria-hidden': 'true' });
        this.stickKnob = this._el('i', 'ac-knob', this.stickBase);
        const fan = this.fan = this._el('div', 'ac-fan', hud, { role: 'group', 'aria-label': 'Ações' });
        this.skBtns = [];
        const keys = ['J', 'K', 'L'];
        const pos = ['--r:8px;--b:8px', '--r:92px;--b:16px', '--r:14px;--b:96px'];
        for (let k = 0; k < 3; k++) {
            const b = this._btn('ac-skill', 'Golpe ' + (k + 1) + ' (' + keys[k] + ')', fan, { 'data-empty': '1' });
            b.style.cssText = pos[k];
            const sw = this._el('i', 'ac-sweep', b);
            const nm = this._el('span', 'ac-sk-name', b);
            const cd = this._el('span', 'ac-sk-cd', b);
            this._el('kbd', 'ac-key', b).textContent = keys[k];
            this._wirePress(b, () => this._skill(k + 1));
            this.skBtns.push({ b, sw, nm, cd });
        }
        const mk = (cls, label, key, css, html) => {
            const b = this._btn(cls, label, fan);
            b.style.cssText = css;
            b.innerHTML = html;
            const sw = this._el('i', 'ac-sweep', b);
            b.insertBefore(sw, b.firstChild);
            this._el('kbd', 'ac-key', b).textContent = key;
            return { b, sw };
        };
        const d = this.dashB = mk('ac-dash', 'Esquiva (Espaço)', 'Espaço', '--r:100px;--b:158px', svg.dash + '<span class="ac-sk-cd"></span>');
        this.dashCd = d.b.querySelector('.ac-sk-cd');
        const c = this.capB = mk('ac-cap', 'Capturar (C)', 'C', '--r:176px;--b:94px', '<span class="ac-ball"></span><b class="ac-cnt"></b>');
        this.capBall = c.b.querySelector('.ac-ball');
        this.capCnt = c.b.querySelector('.ac-cnt');
        const p = this.potB = mk('ac-pot', 'Usar poção (Q)', 'Q', '--r:14px;--b:176px', svg.potion + '<b class="ac-cnt"></b>');
        this.potCnt = p.b.querySelector('.ac-cnt');
        this._wirePress(d.b, () => this._call('onDash'));
        this._wirePress(c.b, () => { if (!this._snap || !this._snap.ball || this._snap.ball.count > 0) this._call('onCapture'); });
        this._wirePress(p.b, () => { if (!this._snap || this._snap.potions > 0) this._call('onPotion'); });
        this._wirePress(this.autoBtn, () => this._call('onAuto', !this._auto));
        this._wirePress(this.exitBtn, () => this._call('onExit'));

        // números de dano e faixa
        this.fx = this._el('div', 'ac-fx', hud, { 'aria-hidden': 'true' });
        this.banEl = this._el('div', 'ac-banner', hud, { role: 'status', 'aria-live': 'polite' });
        this.banEl.hidden = true;
    }

    _call(name, a) {
        const f = this.h[name];
        if (typeof f === 'function') f(a);
    }

    _skill(i) {
        const s = this._snap;
        if (s && s.skills && !s.skills[i]) return;
        this._call('onSkill', i);
    }

    // dispara no pointerdown (resposta imediata no toque); Enter/Espaço em botão focado dispara no click (detail 0)
    _wirePress(b, fn) {
        b.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            b.classList.add('ac-down');
            this.root.classList.toggle('ac-touch', e.pointerType === 'touch' || (e.pointerType === 'pen' && this.root.classList.contains('ac-touch')));
            fn();
        });
        const up = () => b.classList.remove('ac-down');
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('click', e => { if (e.detail === 0) fn(); });
    }

    // ---------- entrada ----------
    _bind() {
        this._onKeyDown = e => this._keyDown(e);
        this._onKeyUp = e => this._keyUp(e);
        this._onBlur = () => { for (const k in this._keys) this._keys[k] = false; this._stickEnd(); };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
        this._onPD = e => this._stickStart(e);
        this._onPM = e => this._stickMove(e);
        this._onPU = e => { if (e.pointerId === this._stick.id) this._stickEnd(); };
        this.root.addEventListener('pointerdown', this._onPD);
        this.root.addEventListener('pointermove', this._onPM);
        this.root.addEventListener('pointerup', this._onPU);
        this.root.addEventListener('pointercancel', this._onPU);
        this.root.addEventListener('lostpointercapture', this._onPU);
        this._onCtx = e => e.preventDefault();
        this.root.addEventListener('contextmenu', this._onCtx);
    }

    _typing(e) {
        const t = e.target;
        if (!t || !t.tagName) return false;
        const n = t.tagName;
        return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable === true;
    }

    _keyDown(e) {
        if (this._disposed || e.ctrlKey || e.metaKey || e.altKey || this._typing(e)) return;
        const code = e.code;
        const mv = code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
            code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight';
        if (mv) { this._keys[code] = true; e.preventDefault(); this.root.classList.remove('ac-touch'); return; }
        const k = e.key;
        const lk = k.length === 1 ? k.toLowerCase() : k;
        let used = true;
        const rep = e.repeat;
        if (lk === 'j' || lk === '1') { if (!rep) this._skill(1); }
        else if (lk === 'k' || lk === '2') { if (!rep) this._skill(2); }
        else if (lk === 'l' || lk === '3') { if (!rep) this._skill(3); }
        else if (k === ' ' || code === 'Space') { if (!rep) this._call('onDash'); }
        else if (lk === 'c') { if (!rep) this._call('onCapture'); }
        else if (lk === 'q') { if (!rep) this._call('onPotion'); }
        else if (lk === 't') { if (!rep) this._call('onAuto', !this._auto); }
        else if (k === 'Tab') { if (!rep) this._swapNext(e.shiftKey ? -1 : 1); }
        else if (k === 'Escape') { if (!rep) this._call('onExit'); }
        else used = false;
        if (used) e.preventDefault();
    }

    _keyUp(e) {
        if (this._disposed) return;
        if (this._keys[e.code]) this._keys[e.code] = false;
        if (e.key === ' ' || e.code === 'Space') e.preventDefault();
    }

    _swapNext(dir) {
        const s = this._snap;
        if (!s || !s.party || s.party.length < 2) return;
        const p = s.party;
        let cur = 0;
        for (let i = 0; i < p.length; i++) if (p[i].active) cur = i;
        for (let n = 1; n < p.length; n++) {
            const m = p[(cur + dir * n + p.length * 8) % p.length];
            if (m.alive && !m.active) { this._call('onSwap', m.partyIndex); return; }
        }
    }

    _stickStart(e) {
        const st = this._stick;
        if (st.id !== -1 || (e.pointerType !== 'touch' && e.pointerType !== 'pen')) return;
        if (e.target && e.target.closest && e.target.closest('button')) return;
        const r = this.root.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        if (x > r.width * 0.5 || y < r.height * 0.35) return;
        st.id = e.pointerId; st.ox = x; st.oy = y; st.x = 0; st.y = 0;
        try { this.root.setPointerCapture(e.pointerId); } catch (_) { /* ponteiro sintético */ }
        this.root.classList.add('ac-touch');
        const b = this.stickBase.style;
        b.transform = 'translate3d(' + (x - 60) + 'px,' + (y - 60) + 'px,0)';
        this.stickKnob.style.transform = 'translate3d(0,0,0)';
        this.stickBase.classList.add('on');
        e.preventDefault();
    }

    _stickMove(e) {
        const st = this._stick;
        if (e.pointerId !== st.id) return;
        const r = this.root.getBoundingClientRect();
        let dx = e.clientX - r.left - st.ox, dy = e.clientY - r.top - st.oy;
        const len = Math.hypot(dx, dy);
        if (len > st.r) { dx = dx / len * st.r; dy = dy / len * st.r; }
        st.x = dx / st.r; st.y = dy / st.r;
        this.stickKnob.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
    }

    _stickEnd() {
        const st = this._stick;
        if (st.id === -1) return;
        const id = st.id;
        st.id = -1; st.x = 0; st.y = 0;
        try { this.root.releasePointerCapture(id); } catch (_) { /* já solto */ }
        this.stickBase.classList.remove('on');
    }

    // mx/mz em -1..1; mz negativo = norte (cima da tela)
    readMove(out) {
        const o = out || {};
        const k = this._keys;
        let kx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
        let kz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
        if (kx && kz) { kx *= 0.7071; kz *= 0.7071; }
        const st = this._stick;
        let sx = st.x, sz = st.y;
        const sl = Math.hypot(sx, sz);
        if (sl < 0.12) { sx = 0; sz = 0; }
        let mx = kx + sx, mz = kz + sz;
        const l = Math.hypot(mx, mz);
        if (l > 1) { mx /= l; mz /= l; }
        o.mx = mx; o.mz = mz;
        return o;
    }

    // ---------- atualização por quadro ----------
    _t(el, key, v) {
        if (this._c[key] !== v) { this._c[key] = v; el.textContent = v; }
    }

    _a(el, key, name, v) {
        if (this._c[key] !== v) { this._c[key] = v; el.setAttribute(name, v); }
    }

    _w(el, key, pct) {
        if (this._c[key] !== pct) { this._c[key] = pct; el.style.width = pct + '%'; }
    }

    _band(el, key, f) {
        const b = f > 0.5 ? 'hi' : f > 0.25 ? 'mid' : 'lo';
        if (this._c[key] !== b) { this._c[key] = b; el.setAttribute('data-band', b); }
    }

    _img(img, key, id, shiny) {
        const k = id + (shiny ? 's' : '');
        if (this._c[key] === k) return;
        this._c[key] = k;
        if (!id) { img.removeAttribute('src'); return; }
        img.src = shiny ? getShinyPokemonSpriteUrl(id) : getPokemonSpriteUrl(id);
    }

    // reinicia uma animação CSS sem forçar reflow: alterna entre duas classes equivalentes
    _restart(el, key, base) {
        const n = this._flip[key] ^= 1;
        el.classList.remove(base + 'a', base + 'b');
        el.classList.add(base + (n ? 'a' : 'b'));
    }

    update(s) {
        if (!s || this._disposed) return;
        this._snap = s;
        const p = s.player;
        if (p) this._updPlayer(p);
        this._updWave(s);
        this._updBoss(s.boss);
        this._updSkills(s);
        this._updMisc(s);
        this._updParty(s.party);
    }

    _updPlayer(p) {
        const c = this._c;
        const key = p.speciesId + (p.shiny ? 's' : '') + '|' + p.name;
        const swapped = c.pKey !== key;
        if (swapped) {
            c.pKey = key;
            this._img(this.pImg, 'pImg', p.speciesId, p.shiny);
            this._t(this.pName, 'pName', (p.shiny ? '★ ' : '') + (p.name || ''));
            this.hpGhost.style.transition = 'none';
            c.lastHp = null;
        }
        this._t(this.pLv, 'pLv', 'Nv ' + (p.level || 1));
        const max = Math.max(1, p.maxHp || 1);
        const hp = Math.max(0, Math.min(max, p.hp || 0));
        const f = hp / max;
        const pct = Math.round(f * 200) / 2;
        this._band(this.hpBar, 'pBand', f);
        this._w(this.hpFill, 'pFill', pct);
        this._w(this.hpGhost, 'pGhost', pct);
        if (swapped) requestAnimationFrame(() => { this.hpGhost.style.transition = ''; });
        this._t(this.hpTxt, 'pHp', Math.ceil(hp) + ' / ' + Math.ceil(max));
        this._a(this.hpBar, 'pAria', 'aria-valuenow', String(Math.ceil(hp)));
        this._a(this.hpBar, 'pAriaM', 'aria-valuemax', String(Math.ceil(max)));
        const xp = Math.round(Math.max(0, Math.min(1, p.expFrac || 0)) * 200) / 2;
        this._w(this.xpFill, 'pXp', xp);
        this._a(this.xpBar, 'pXpA', 'aria-valuenow', String(Math.round(xp)));
        // dano sofrido: treme o cartão e pisca a vinheta
        if (c.lastHp != null && hp < c.lastHp - 0.5) {
            this._restart(this.tl, 'hit', 'ac-hit-');
            this._restart(this.vig, 'bump', 'ac-flash-');
        }
        c.lastHp = hp;
        const low = f > 0 && f <= 0.25 ? 1 : 0;
        if (c.low !== low) { c.low = low; this.root.classList.toggle('ac-low', !!low); }
    }

    _updWave(s) {
        const w = s.wave;
        if (!w) return;
        this._t(this.wTitle, 'wT', 'Onda ' + w.n);
        const left = Math.max(0, w.left | 0);
        let sub = left + (left === 1 ? ' inimigo' : ' inimigos');
        if (left === 0 && w.nextIn > 0) sub = 'Próxima em ' + Math.ceil(w.nextIn) + ' s';
        else if (w.nextIn > 0) sub += ' · próxima em ' + Math.ceil(w.nextIn) + ' s';
        this._t(this.wSub, 'wS', sub);
        const total = Math.max(1, w.total || 1);
        this._w(this.wFill, 'wF', Math.round((1 - Math.min(1, left / total)) * 100));
        this._a(this.wave, 'wK', 'data-kind', w.kind || 'normal');
    }

    _updBoss(b) {
        const c = this._c;
        const on = b ? 1 : 0;
        if (c.bossOn !== on) { c.bossOn = on; this.root.classList.toggle('ac-has-boss', !!on); }
        if (!b) return;
        this._img(this.bImg, 'bImg', b.speciesId, false);
        this._t(this.bName, 'bN', b.name || '');
        const max = Math.max(1, b.maxHp || 1);
        const hp = Math.max(0, Math.min(max, b.hp || 0));
        const f = hp / max;
        const pct = Math.round(f * 200) / 2;
        this._w(this.bFill, 'bF', pct);
        this._w(this.bGhost, 'bG', pct);
        this._t(this.bTxt, 'bT', Math.round(f * 100) + '%');
        this._a(this.bossBar, 'bA', 'aria-valuenow', String(Math.ceil(hp)));
        this._a(this.bossBar, 'bAM', 'aria-valuemax', String(Math.ceil(max)));
    }

    _sweep(sw, cdEl, key, cd, cdMax) {
        const c = this._c;
        const f = cdMax > 0 && cd > 0 ? Math.min(1, cd / cdMax) : 0;
        const q = Math.round(f * 72) / 72 * 100;
        if (c[key + 'p'] !== q) { c[key + 'p'] = q; sw.style.setProperty('--p', q.toFixed(1)); }
        const sec = cd > 1 ? String(Math.ceil(cd)) : '';
        if (c[key + 's'] !== sec) {
            c[key + 's'] = sec;
            cdEl.textContent = sec;
            cdEl.parentNode.setAttribute('data-cd', sec ? '1' : '0');
        }
        const wt = f > 0 ? '1' : '0';
        if (c[key + 'w'] !== wt) { c[key + 'w'] = wt; cdEl.parentNode.setAttribute('data-wait', wt); }
    }

    _updSkills(s) {
        const c = this._c;
        const sk = s.skills || [];
        for (let k = 0; k < 3; k++) {
            const m = sk[k + 1];
            const r = this.skBtns[k];
            if (!m) {
                if (c['sk' + k] !== 'x') { c['sk' + k] = 'x'; r.b.setAttribute('data-empty', '1'); r.b.disabled = true; }
                continue;
            }
            const sig = m.name + '|' + m.type;
            if (c['sk' + k] !== sig) {
                c['sk' + k] = sig;
                r.b.removeAttribute('data-empty');
                r.b.disabled = false;
                const col = (typeof MOVE_FX_COLORS !== 'undefined' && MOVE_FX_COLORS[m.type]) || ['#d8d2bc', '#fff', '#fff'];
                r.b.style.setProperty('--tc', col[0]);
                r.b.style.setProperty('--tc2', col[1]);
                r.nm.textContent = m.name;
                const tn = (typeof TYPE_NAMES !== 'undefined' && TYPE_NAMES[m.type]) || m.type;
                const lab = 'Golpe ' + (k + 1) + ': ' + m.name + ', tipo ' + tn + (m.label ? ', ' + m.label : '') + ' (' + ['J', 'K', 'L'][k] + ')';
                r.b.setAttribute('aria-label', lab);
                r.b.title = lab;
            }
            this._sweep(r.sw, r.cd, 'sk' + k, m.cd, m.cdMax);
        }
        const d = s.dash;
        if (d) this._sweep(this.dashB.sw, this.dashCd, 'dash', d.cd, d.cdMax);
    }

    _updMisc(s) {
        const c = this._c;
        this._t(this.kN, 'kills', String(s.kills | 0));
        const cb = s.combo | 0;
        if (cb !== c.combo) {
            if (cb > (c.combo | 0) && cb >= 2) this._restart(this.combo, 'bump', 'ac-bump-');
            c.combo = cb;
            this.combo.textContent = cb >= 2 ? 'Combo x' + cb : '';
            this.combo.classList.toggle('on', cb >= 2);
        }
        const au = !!s.auto;
        if (c.auto !== au) {
            c.auto = au; this._auto = au;
            this.autoBtn.classList.toggle('on', au);
            this.autoBtn.setAttribute('aria-pressed', au ? 'true' : 'false');
            this.autoBtn.setAttribute('aria-label', 'Modo automático: ' + (au ? 'ligado' : 'desligado') + ' (T)');
            this.autoBtn.title = this.autoBtn.getAttribute('aria-label');
        }
        const ball = s.ball || { id: 'pokeball', count: 0 };
        if (c.ballId !== ball.id) {
            c.ballId = ball.id;
            this.capBall.className = 'ac-ball b-' + String(ball.id || 'pokeball').replace(/[^a-z]/g, '');
        }
        this._t(this.capCnt, 'ballN', String(ball.count | 0));
        const cr = s.captureReady && ball.count > 0 ? 1 : 0;
        if (c.capReady !== cr) { c.capReady = cr; this.capB.b.classList.toggle('ready', !!cr); }
        const cn = ball.count > 0 ? 1 : 0;
        if (c.capHas !== cn) { c.capHas = cn; this.capB.b.setAttribute('aria-disabled', cn ? 'false' : 'true'); this.capB.b.classList.toggle('empty', !cn); }
        this._t(this.potCnt, 'potN', String(s.potions | 0));
        const ph = s.potions > 0 ? 1 : 0;
        if (c.potHas !== ph) { c.potHas = ph; this.potB.b.setAttribute('aria-disabled', ph ? 'false' : 'true'); this.potB.b.classList.toggle('empty', !ph); }
        const ov = s.over ? 1 : 0;
        if (c.over !== ov) { c.over = ov; this.root.classList.toggle('ac-over', !!ov); }
    }

    _updParty(party) {
        if (!party) return;
        const c = this._c;
        const sig = party.length + ':' + party.map(m => m.partyIndex + '.' + m.speciesId + (m.shiny ? 's' : '')).join(',');
        if (c.partySig !== sig) {
            c.partySig = sig;
            this.party.textContent = '';
            this._partyBtns.length = 0;
            for (let i = 0; i < party.length; i++) {
                const m = party[i];
                const b = this._btn('ac-pm', 'Trocar Pokémon', this.party);
                const img = this._el('img', '', b, { alt: '', draggable: 'false' });
                img.src = m.shiny ? getShinyPokemonSpriteUrl(m.speciesId) : getPokemonSpriteUrl(m.speciesId);
                const hb = this._el('span', 'ac-pm-hp', b);
                const fill = this._el('i', '', hb);
                const pi = m.partyIndex;
                this._wirePress(b, () => {
                    const cur = this._snap && this._snap.party;
                    const mm = cur && cur.find(x => x.partyIndex === pi);
                    if (mm && mm.alive && !mm.active) this._call('onSwap', pi);
                });
                this._partyBtns.push({ b, fill, st: '', w: -1 });
            }
        }
        for (let i = 0; i < party.length; i++) {
            const m = party[i], r = this._partyBtns[i];
            if (!r) continue;
            const st = (m.active ? 'a' : '') + (m.alive ? '' : 'd');
            const w = Math.round(Math.max(0, Math.min(1, m.hp01 || 0)) * 50) * 2;
            if (r.st !== st) {
                r.st = st;
                r.b.classList.toggle('active', !!m.active);
                r.b.classList.toggle('down', !m.alive);
                const nm = (typeof POKEMON_DATA !== 'undefined' && POKEMON_DATA[m.speciesId] && POKEMON_DATA[m.speciesId].name) || 'Pokémon';
                const lab = m.active ? nm + ', em campo' : m.alive ? 'Trocar para ' + nm + ' (Tab)' : nm + ', desmaiado';
                r.b.setAttribute('aria-label', lab);
                r.b.title = lab;
                r.b.setAttribute('aria-pressed', m.active ? 'true' : 'false');
            }
            if (r.w !== w) {
                r.w = w; r.fill.style.width = w + '%';
                r.fill.parentNode.setAttribute('data-band', w > 50 ? 'hi' : w > 25 ? 'mid' : 'lo');
            }
        }
    }

    // ---------- números de dano ----------
    damage(xPx, yPx, o) {
        if (this._disposed) return;
        const opt = o || {};
        const pool = this._pool;
        let e;
        if (pool.length < 24) {
            e = this._el('span', 'ac-dmg', this.fx);
            pool.push(e);
        } else {
            e = pool[this._poolI];
            this._poolI = (this._poolI + 1) % 24;
        }
        const n = this._flip.dmg ^= 1;
        e.className = 'ac-dmg ' + (opt.cls || '') + (n ? ' ac-fa' : ' ac-fb');
        e.textContent = opt.text == null ? '' : String(opt.text);
        e.style.left = xPx.toFixed(0) + 'px';
        e.style.top = yPx.toFixed(0) + 'px';
        e.style.setProperty('--dx', ((Math.random() - 0.5) * 36).toFixed(0) + 'px');
    }

    // ---------- faixas ----------
    banner(text, tipo) {
        if (this._disposed || !text) return;
        if (this._bq.length >= 4) this._bq.shift();
        this._bq.push({ text: String(text), tipo: tipo || 'info' });
        if (!this._bBusy) this._nextBanner();
    }

    _nextBanner() {
        const it = this._bq.shift();
        if (!it) { this._bBusy = false; this.banEl.hidden = true; return; }
        this._bBusy = true;
        const e = this.banEl;
        e.hidden = false;
        e.textContent = it.text;
        e.setAttribute('data-type', it.tipo);
        this._restart(e, 'ban', 'ac-ban-');
        this._bt = setTimeout(() => { this._bt = 0; this._nextBanner(); }, 1600);
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);
        const r = this.root;
        r.removeEventListener('pointerdown', this._onPD);
        r.removeEventListener('pointermove', this._onPM);
        r.removeEventListener('pointerup', this._onPU);
        r.removeEventListener('pointercancel', this._onPU);
        r.removeEventListener('lostpointercapture', this._onPU);
        r.removeEventListener('contextmenu', this._onCtx);
        if (this._bt) clearTimeout(this._bt);
        this._bt = 0; this._bq.length = 0;
        this._stickEnd();
        if (this.hud && this.hud.parentNode) this.hud.parentNode.removeChild(this.hud);
        r.classList.remove('ac-root', 'ac-touch', 'ac-low', 'ac-has-boss', 'ac-over');
        this._pool.length = 0; this._partyBtns.length = 0; this._snap = null;
    }
}
