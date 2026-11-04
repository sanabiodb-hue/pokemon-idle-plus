// ============================================================
// F10 · Modo Explorar · interface (tela cheia sobre o jogo). Fluxo como nos jogos principais:
//   Cidade Inicial (Centro Pokémon cura, Depot) → saída sul → rota atual (mapa da rota ou o mapa de caça procedural da espécie
//   mais comum dela) → mato alto: "Um ___ selvagem apareceu!" → LUTAR / BOLSA / POKÉMON / FUGIR → captura com a bola escolhida.
// Movimento e colisão: worldStep / worldAdvanceToward / worldFindPath (o mesmo motor das cidades). Regras: explore-core.js.
// A cena 3D (explore-3d.js) usa o Three.js copiado em js/vendor, carregado só ao abrir o modo.
// ============================================================
const EXPLORE_THREE_URL = 'js/vendor/three.module.min.js';
const EXPLORE_BLOCK_MESSAGES = {
    hunt_active: 'Pare ou pause a caçada automática na aba Caça para explorar.',
    tower: 'Saia da Torre de Desafio para explorar.',
    offline: 'Aguarde o cálculo offline terminar.',
    no_team: 'Você precisa de pelo menos um Pokémon na equipe.',
    disabled: 'O modo Explorar está desligado.',
    webgl: 'Este navegador não conseguiu iniciar o 3D (WebGL).',
    load: 'Não foi possível carregar o motor 3D. Verifique a conexão e tente de novo.',
    world_hunt: 'Há uma caçada ativa no Mapa. Encerre-a para explorar.',
};
const EXPLORE_TOWN = 'starter_town';

class ExploreView {
    constructor(ui) {
        this.ui = ui; this.game = ui.game;
        this.open = false; this.keep = {}; this.keys = []; this.joy = { x: 0, y: 0 }; this.path = null; this.running = false;
        this.mode = 'world'; this.busy = false; this.grace = 0; this.audio = null;
        this._inject();
        this._onKeyDown = (e) => this._key(e, true); this._onKeyUp = (e) => this._key(e, false);
        this._onResize = () => this.e3d && this.e3d.resize();
    }
    _inject() {
        const root = document.getElementById('world-panel');
        if (!root || root.querySelector('.explore-cta')) return;
        const card = document.createElement('div');
        card.className = 'explore-cta';
        card.innerHTML = `<div class="explore-cta-text"><b>🎮 Explorar em 3D</b><small>Ande pela rota com seu treinador, encontre Pokémon no mato alto e batalhe por turnos: Lutar, Bolsa, Pokémon e Fugir.</small></div><button type="button" id="explore-open">Explorar</button>`;
        const h2 = root.querySelector('h2');
        if (h2 && h2.nextSibling) root.insertBefore(card, h2.nextSibling); else root.prepend(card);
        card.querySelector('#explore-open').addEventListener('click', () => this.start());
    }
    _toast(msg) { if (this.ui && typeof this.ui.showToast === 'function') this.ui.showToast(msg); }

    // ---------------- abrir / fechar ----------------
    async start() {
        if (this.open) return;
        if (this.ui.worldEncounters && this.ui.worldEncounters.isActive && this.ui.worldEncounters.isActive()) return this._toast(EXPLORE_BLOCK_MESSAGES.world_hunt);
        const reason = this.game.exploreBlockReason();
        if (reason) return this._toast(EXPLORE_BLOCK_MESSAGES[reason] || reason);
        this._audioInit();
        this._build();
        this.root.hidden = false; document.body.classList.add('exploring');
        this._say(['Carregando o mundo 3D…']);
        try { if (!window.THREE) window.THREE = await import(new URL(EXPLORE_THREE_URL, document.baseURI).href); }
        catch (e) { this.root.hidden = true; document.body.classList.remove('exploring'); return this._toast(EXPLORE_BLOCK_MESSAGES.load); }
        const gl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
        if (!gl) { this.root.hidden = true; document.body.classList.remove('exploring'); return this._toast(EXPLORE_BLOCK_MESSAGES.webgl); }
        try { if (!this.e3d) this.e3d = new Explore3D(this.canvas); }
        catch (e) { this.root.hidden = true; document.body.classList.remove('exploring'); return this._toast(EXPLORE_BLOCK_MESSAGES.webgl); }
        const r = this.game.exploreEnter();
        if (!r.ok) { this.root.hidden = true; document.body.classList.remove('exploring'); return this._toast(EXPLORE_BLOCK_MESSAGES[r.code] || r.code); }
        this.open = true;
        if (this.ui.worldView && this.ui.worldView.controls) this.ui.worldView.controls.clear();
        addEventListener('keydown', this._onKeyDown, true); addEventListener('keyup', this._onKeyUp, true); addEventListener('resize', this._onResize);
        this.e3d.resize();
        this._goTo(EXPLORE_TOWN, null);
        this._dialog(['Bem-vindo ao modo Explorar!', 'Ande com as setas/WASD (ou o joystick). Shift corre. Enter/Espaço interage.', 'Siga pelo caminho ao sul até a rota. No mato alto aparecem Pokémon selvagens!']);
        this._last = performance.now();
        this._raf = requestAnimationFrame((t) => this._frame(t));
    }
    close() {
        if (!this.open || this.mode === 'battle') return;
        this.open = false;
        cancelAnimationFrame(this._raf);
        removeEventListener('keydown', this._onKeyDown, true); removeEventListener('keyup', this._onKeyUp, true); removeEventListener('resize', this._onResize);
        this.keys = []; this.joy = { x: 0, y: 0 }; this.path = null;
        this.root.hidden = true; document.body.classList.remove('exploring');
        this.game.exploreLeave();
        if (this.ui.renderTeam) this.ui.renderTeam();
    }

    // ---------------- DOM ----------------
    _build() {
        if (this.root) return;
        const el = document.createElement('div');
        el.id = 'explore'; el.hidden = true;
        el.innerHTML = `
            <canvas class="ex-canvas"></canvas>
            <div class="ex-flash"></div>
            <div class="ex-hud">
                <div class="ex-loc"><small>Explorar</small><b class="ex-loc-name">—</b><span class="ex-loc-sub"></span></div>
                <div class="ex-party"></div>
                <button type="button" class="ex-close" aria-label="Sair do modo Explorar">✕ Sair</button>
            </div>
            <div class="ex-joy" aria-hidden="true"><i></i></div>
            <div class="ex-ab"><button type="button" class="ex-b" aria-label="Correr">B</button><button type="button" class="ex-a" aria-label="Interagir">A</button></div>
            <div class="ex-battle" hidden>
                <div class="ex-box ex-foe"></div>
                <div class="ex-box ex-me"></div>
            </div>
            <div class="ex-panel"><div class="ex-text" aria-live="polite"></div><div class="ex-menu"></div></div>`;
        document.body.appendChild(el);
        this.root = el; this.canvas = el.querySelector('.ex-canvas');
        const $ = (s) => el.querySelector(s);
        this.$ = $;
        $('.ex-close').addEventListener('click', () => this.close());
        $('.ex-a').addEventListener('click', () => this._interact());
        const bBtn = $('.ex-b');
        bBtn.addEventListener('pointerdown', () => { this.running = true; }); bBtn.addEventListener('pointerup', () => { this.running = false; }); bBtn.addEventListener('pointerleave', () => { this.running = false; });
        // joystick (toque)
        const joy = $('.ex-joy'), knob = joy.querySelector('i'); let jid = null;
        const move = (e) => { const r = joy.getBoundingClientRect(); let dx = (e.clientX - r.left - r.width / 2) / (r.width / 2), dy = (e.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } knob.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`; this.joy = { x: dx, y: dy }; this.path = null; };
        joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); move(e); });
        joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) move(e); });
        const end = () => { jid = null; knob.style.transform = ''; this.joy = { x: 0, y: 0 }; };
        joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
        // toque/clique no chão: anda até lá (busca de caminho do motor)
        this.canvas.addEventListener('pointerdown', (e) => { if (this.mode === 'world' && !this.dialogLines) this._tapTo(e.clientX, e.clientY); else if (this.dialogLines) this._advanceDialog(); });
        $('.ex-panel').addEventListener('click', () => { if (this.dialogLines) this._advanceDialog(); });
    }
    _key(e, down) {
        if (!this.open) return;
        const k = e.key.toLowerCase(), dirKey = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' }[k];
        if (e.target && e.target.closest && e.target.closest('input,textarea,select')) return;
        if (dirKey) { e.preventDefault(); e.stopPropagation(); this.keys = this.keys.filter(x => x !== dirKey); if (down) { this.keys.push(dirKey); this.path = null; } return; }
        if (k === 'shift') { this.running = down; e.stopPropagation(); return; }
        if (down && (k === 'enter' || k === ' ' || k === 'e' || k === 'z')) { e.preventDefault(); e.stopPropagation(); if (this.dialogLines) this._advanceDialog(); else if (this.mode === 'world') this._interact(); return; }
        if (down && k === 'escape' && this.mode === 'world' && !this.dialogLines) { e.stopPropagation(); this.close(); }
    }

    // ---------------- mapas e transições ----------------
    _route() { return this.game.getRoute(this.game.gameState.currentRoute); }
    _routeMap() {
        const route = this._route();
        if (!route) return null;
        const fixed = worldMapIdForRoute(route.id);
        if (fixed) return getWorldMap(fixed);
        // bioma da rota = o mais comum entre as espécies dela (pesado pela chance); o mapa é o de caça da espécie mais comum desse bioma
        const list = (route.pokemon || []).filter(p => POKEMON_DATA[p.id] && !(typeof isRestrictedSpecies === 'function' && isRestrictedSpecies(p.id)));
        const byBiome = {};
        for (const p of list) { const bi = worldBiomeForTypes(POKEMON_DATA[p.id].types); byBiome[bi] = (byBiome[bi] || 0) + (p.weight || 1); }
        const biome = Object.keys(byBiome).sort((a, b) => byBiome[b] - byBiome[a])[0];
        const main = list.filter(p => worldBiomeForTypes(POKEMON_DATA[p.id].types) === biome).sort((a, b) => (b.weight || 0) - (a.weight || 0))[0] || route.pokemon[0];
        try { return main ? worldHuntMap(main.id) : null; } catch (e) { return null; }
    }
    _goTo(mapId, at) {
        const map = mapId === 'route' ? this._routeMap() : getWorldMap(mapId);
        if (!map) { this._dialog(['Esta rota ainda não tem mapa para explorar.']); return; }
        this.map = map; this.path = null;
        this.state = at ? { mapId: map.id, x: at.x * WORLD_TILE_SIZE + 8, y: at.y * WORLD_TILE_SIZE + 13, dir: at.dir || 'down', moving: false, distance: 0 } : worldCreateState(map);
        this.e3d.setMap(map); this.e3d.ensureTrainer();
        const pad = map.type === 'hunt' ? map.spawn : null;
        this.e3d.setExitPad(pad); this.onPad = !!pad;
        this.e3d.setTrainer(this.state, 0, false); this._refreshFollower(); this.e3d.resetTrail(this.state.dir);
        const route = this._route();
        this.$('.ex-loc-name').textContent = map.type === 'city' ? map.name : (route ? route.name : map.name);
        this.$('.ex-loc-sub').textContent = map.type === 'city' ? 'Centro Pokémon · Depot' : (route && route.levelRange ? `Nv ${route.levelRange[0]}–${route.levelRange[1]} · ${exploreMapHasGrass(map) ? 'mato alto' : 'todo o chão'} tem encontros` : '');
        this.grace = 3; this.steps0 = this.state.distance;
        this._renderParty();
    }
    _checkTransitions() {
        const m = this.map, cx = Math.floor(this.state.x / WORLD_TILE_SIZE), cy = Math.floor(this.state.y / WORLD_TILE_SIZE);
        if (m.id === EXPLORE_TOWN && cy >= m.height - 1) return this._goTo('route', null), true;
        if (m.id === 'kanto_route1' && cy >= m.height - 1) return this._goTo(EXPLORE_TOWN, { x: 13, y: 17, dir: 'up' }), true;
        if (m.id === 'kanto_route1' && cy <= 0) { this.state.y += WORLD_TILE_SIZE; this.keys = []; this._dialog(['Uma placa: "Cidade de Viridian — em obras." Volte mais tarde!']); return true; }
        if (m.type === 'hunt') {
            const onPad = cx === m.spawn.x && cy === m.spawn.y;
            if (onPad && !this.onPad) { this._goTo(EXPLORE_TOWN, { x: 13, y: 17, dir: 'up' }); return true; }
            this.onPad = onPad;
        }
        return false;
    }
    _interact() {
        if (this.mode !== 'world' || !this.map) return;
        const it = worldInteractionNear(this.map, this.state);
        if (!it) return;
        if (it.type === 'heal') this._center();
        else if (it.type === 'depot') this._dialog(['Depot: aqui ficam guardados os Pokémon que não estão na equipe.', 'Para organizá-los, saia do modo Explorar e abra a aba PC.']);
    }
    _center(afterLines = []) {
        this._dialog(['Olá! Bem-vindo ao Centro Pokémon.', 'Vamos cuidar dos seus Pokémon…', ...afterLines], () => {
            this.keep = {}; this._sfx('heal'); this._renderParty();
            this._dialog(['Seus Pokémon estão em plena forma! Volte sempre!']);
        });
    }

    // ---------------- quadro ----------------
    _frame(now) {
        if (!this.open) return;
        const dtMs = Math.min(100, now - this._last); this._last = now;
        const dt = dtMs / 1000;
        if (this.mode === 'world' && !this.dialogLines && this.map) this._move(dtMs);
        if (this.mode === 'world' && this.state) this.e3d.setTrainer(this.state, dt, this.running);
        this.e3d.render(dt);
        this._raf = requestAnimationFrame((t) => this._frame(t));
    }
    _dir() {
        if (this.keys.length) return this.keys[this.keys.length - 1];
        const { x, y } = this.joy;
        if (Math.hypot(x, y) < 0.3) return null;
        return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    }
    _move(dtMs) {
        const speed = WORLD_MOVEMENT.walkSpeed * (this.running ? 2.1 : 1.35), prev = this.state;
        const dir = this._dir();
        let next = prev;
        if (dir) next = worldStep(this.map, prev, dir, dtMs, speed);
        else if (this.path && this.path.length) {
            const r = worldAdvanceToward(this.map, prev, this.path[0], dtMs, speed);
            next = { ...r.state, moving: !r.arrived || this.path.length > 1 };
            if (r.arrived) this.path.shift();
            if (r.blocked) this.path = null;
        } else next = { ...prev, moving: false };
        this.state = next;
        if (next.distance === prev.distance) return;
        if (this._checkTransitions()) return;
        if (this.grace > 0) { this.grace -= (next.distance - prev.distance) / WORLD_TILE_SIZE; return; }
        const enc = exploreStepEncounter(this.map, prev, next, () => this.game.rng());
        if (enc) this._encounter();
    }
    _tapTo(clientX, clientY) {
        const cell = this.e3d.cellAt(clientX, clientY); if (!cell) return;
        const from = { x: Math.floor(this.state.x / WORLD_TILE_SIZE), y: Math.floor(this.state.y / WORLD_TILE_SIZE) };
        const cells = worldFindPath(this.map, from, cell);
        if (!cells) return;
        this.path = worldPathWaypoints(cells).slice(1);
        this.keys = [];
    }
    _refreshFollower() {
        const st = this.game.gameState, inst = this.game._partyInstance(st.activePokemonIndex) || this.game._partyInstance(0);
        this.e3d.setFollower(inst ? inst.speciesId : null, inst ? !!inst.shiny : false);
    }
    _renderParty() {
        const st = this.game.gameState, out = [];
        st.party.forEach((uid, i) => {
            const inst = this.game._partyInstance(i); if (!inst) return;
            const f = this.keep[uid] ? this.keep[uid].hp : 1;
            out.push(`<span class="ex-pm${f <= 0 ? ' ko' : ''}" title="${escapeHtml(getInstanceDisplayName(inst))}"><img src="${inst.shiny ? getShinyPokemonSpriteUrl(inst.speciesId) : getPokemonSpriteUrl(inst.speciesId)}" alt=""><i style="width:${Math.max(0, f) * 100}%;background:${this._hpColor(f)}"></i></span>`);
        });
        const inv = this.game.ensureInventory(), balls = BALL_TYPES.map(b => [b, this.game.getBallCount(b.id)]).filter(([, n]) => n > 0);
        out.push(`<span class="ex-items">${balls.map(([b, n]) => `${b.icon} ${n}`).join(' · ') || '⚪ 0'} · 🧪 ${inv.potions}</span>`);
        this.$('.ex-party').innerHTML = out.join('');
    }
    _hpColor(f) { return f > 0.5 ? '#3ddc84' : f > 0.2 ? '#ffc93c' : '#ff5a5a'; }

    // ---------------- diálogo ----------------
    _dialog(lines, done) { this.dialogLines = lines.slice(); this.dialogDone = done || null; this.$('.ex-menu').innerHTML = ''; this.root.classList.add('ex-talking'); this._advanceDialog(); }
    _advanceDialog() {
        if (!this.dialogLines) return;
        if (!this.dialogLines.length) { this.dialogLines = null; this.root.classList.remove('ex-talking'); this.$('.ex-text').textContent = ''; const d = this.dialogDone; this.dialogDone = null; if (d) d(); return; }
        this.$('.ex-text').textContent = this.dialogLines.shift() + '  ▼';
    }
    _say(lines, done, ms = 900) {
        const box = this.$('.ex-text'); this.$('.ex-menu').innerHTML = '';
        const next = () => { if (!lines.length) return done && done(); box.textContent = lines.shift(); setTimeout(next, ms); };
        next();
    }

    // ---------------- batalha ----------------
    _encounter() {
        const route = this._route(), wild = this.game.exploreWild(route);
        if (!wild) return;
        const battle = new ExploreBattle(this.game, wild, { keep: this.keep });
        if (!battle.canFight()) { this.grace = 4; this._dialog(['Um Pokémon selvagem apareceu, mas seus Pokémon estão sem forças!', 'Volte ao Centro Pokémon na Cidade Inicial para curá-los.']); return; }
        this.mode = 'battle'; this.battle = battle; this.keys = []; this.path = null; this.busy = true;
        this._sfx('encounter');
        const fl = this.$('.ex-flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
        setTimeout(() => {
            const g = this._groundColor();
            this.e3d.startBattle({ ground: g.ground, sky: g.sky, foe: { id: wild.id, shiny: !!wild.isShiny }, me: { id: battle.me().speciesId, shiny: battle.me().shiny } });
            this.$('.ex-battle').hidden = false; this.root.classList.add('ex-in-battle');
            this._boxes();
            const f = battle.foe, lines = [`${f.shiny ? '✨ Um ' + f.name + ' BRILHANTE' : 'Um ' + f.name} selvagem apareceu!`, `Vai! ${battle.me().name}!`];
            if (f.shiny) this._sfx('shiny');
            this._say(lines, () => { this.busy = false; this._menu(); });
        }, 650);
    }
    _groundColor() {
        const b = this.map.biome;
        return { cave: { ground: '#7a6b5c', sky: '#3b3328' }, volcano: { ground: '#4e4440', sky: '#5a2a22' }, snow: { ground: '#e9f1f8', sky: '#cfe3f5' }, haunted: { ground: '#4f425f', sky: '#2a2238' }, lake: { ground: '#6fc46a', sky: '#9fd8ff' } }[b] || { ground: '#62c45c', sky: '#a8dcff' };
    }
    _box(u, mine) {
        const f = u.hp / u.maxHp, st = u.status ? `<span class="ex-st">${EXPLORE_STATUS[u.status].tag}</span>` : '';
        let exp = '';
        if (mine && u.inst) {
            try { const d = POKEMON_DATA[u.inst.speciesId], g = d.expGroup || 'medium', a = getExpForLevel(g, u.inst.level), b = getExpForLevel(g, u.inst.level + 1); const p = b > a ? Math.max(0, Math.min(1, (u.inst.exp - a) / (b - a))) : 0; exp = `<div class="ex-exp"><i style="width:${p * 100}%"></i></div>`; } catch (e) { exp = ''; }
        }
        return `<div class="ex-name"><span>${u.shiny ? '✨' : ''}${escapeHtml(u.name)} ${st}</span><em>Nv${u.inst ? u.inst.level : u.level}</em></div>
            <div class="ex-types">${u.types.map(t => `<span style="background:${EXPLORE_TYPE_COLORS[t] || '#999'}">${TYPE_NAMES[t] || t}</span>`).join('')}</div>
            <div class="ex-hp"><b>PS</b><div><i style="width:${f * 100}%;background:${this._hpColor(f)}"></i></div></div>${mine ? `<div class="ex-hpn">${u.hp} / ${u.maxHp}</div>${exp}` : ''}`;
    }
    _boxes() { if (!this.battle) return; this.$('.ex-foe').innerHTML = this._box(this.battle.foe, false); this.$('.ex-me').innerHTML = this._box(this.battle.me(), true); }
    _menu() {
        const b = this.battle; if (!b || b.over) return;
        this.$('.ex-text').textContent = `O que ${b.me().name} vai fazer?`;
        const m = this.$('.ex-menu');
        m.innerHTML = `<button type="button" data-m="fight" class="ex-btn fight">LUTAR</button><button type="button" data-m="bag" class="ex-btn bag">BOLSA</button><button type="button" data-m="party" class="ex-btn party">POKÉMON</button><button type="button" data-m="run" class="ex-btn run">FUGIR</button>`;
        m.querySelectorAll('[data-m]').forEach(x => x.addEventListener('click', () => { this._sfx('ui'); const k = x.dataset.m; if (k === 'fight') this._moves(); else if (k === 'bag') this._bag(); else if (k === 'party') this._party(); else this._act({ type: 'run' }); }));
        const first = m.querySelector('button'); if (first) first.focus({ preventScroll: true });
    }
    _back(m) { const bk = document.createElement('button'); bk.type = 'button'; bk.className = 'ex-btn'; bk.textContent = 'VOLTAR'; bk.addEventListener('click', () => this._menu()); m.appendChild(bk); }
    _moves() {
        const b = this.battle, m = this.$('.ex-menu'), foeTypes = b.foe.types;
        m.innerHTML = b.me().moves.map((mv, i) => {
            const eff = getBestTypeEffectiveness([mv.type], foeTypes).multiplier, tag = eff > 1 ? '<em class="sup">super</em>' : eff < 1 ? '<em class="weak">fraco</em>' : '';
            return `<button type="button" class="ex-btn mv" data-i="${i}" style="--tc:${EXPLORE_TYPE_COLORS[mv.type] || '#999'}" ${mv.pp <= 0 ? 'disabled' : ''}><b>${escapeHtml(mv.name)} ${tag}</b><small>${TYPE_NAMES[mv.type] || mv.type} · Poder ${mv.power} · PP ${mv.pp}/${mv.maxPp}</small></button>`;
        }).join('');
        m.querySelectorAll('[data-i]').forEach(x => x.addEventListener('click', () => this._act({ type: 'move', i: Number(x.dataset.i) })));
        this._back(m);
    }
    _bag() {
        const b = this.battle, m = this.$('.ex-menu'), inv = this.game.ensureInventory(), hpF = b.foe.hp / b.foe.maxHp, rate = speciesCatchRate(POKEMON_DATA[b.foe.speciesId]);
        const balls = BALL_TYPES.filter(x => this.game.getBallCount(x.id) > 0);
        m.innerHTML = balls.map(x => `<button type="button" class="ex-btn" data-ball="${x.id}"><b>${x.icon} ${x.name} ×${this.game.getBallCount(x.id)}</b><small>chance ~${Math.round(exploreCaptureChance(rate, x, hpF, !!b.foe.status) * 100)}%</small></button>`).join('')
            + `<button type="button" class="ex-btn" data-potion ${inv.potions <= 0 ? 'disabled' : ''}><b>🧪 Poção ×${inv.potions}</b><small>cura ${Math.round(this.game.getPotionHealPercent() * 100)}% dos PS</small></button>`;
        if (!balls.length) m.insertAdjacentHTML('afterbegin', '<p class="ex-note">Sem bolas. Compre na Loja da aba Caça.</p>');
        m.querySelectorAll('[data-ball]').forEach(x => x.addEventListener('click', () => this._act({ type: 'ball', id: x.dataset.ball })));
        const p = m.querySelector('[data-potion]'); if (p) p.addEventListener('click', () => this._act({ type: 'potion' }));
        this._back(m);
    }
    _party() {
        const b = this.battle, m = this.$('.ex-menu');
        m.innerHTML = b.party.map((u, i) => `<button type="button" class="ex-btn pk" data-p="${i}" ${u.hp <= 0 || i === b.active ? 'disabled' : ''}><img src="${u.shiny ? getShinyPokemonSpriteUrl(u.speciesId) : getPokemonSpriteUrl(u.speciesId)}" alt=""><b>${escapeHtml(u.name)} Nv${u.level}</b><small>PS ${u.hp}/${u.maxHp}${i === b.active ? ' · em campo' : ''}</small></button>`).join('');
        m.querySelectorAll('[data-p]').forEach(x => x.addEventListener('click', () => this._act({ type: 'switch', i: Number(x.dataset.p) })));
        this._back(m);
    }
    _act(action) {
        if (this.busy || !this.battle) return;
        this.busy = true; this.$('.ex-menu').innerHTML = '';
        const steps = this.battle.act(action);
        if (!steps.length) { this.busy = false; this._menu(); return; }
        this._play(steps, () => { this.busy = false; this._renderParty(); if (this.battle.over) this._finish(); else { this._boxes(); this._menu(); } });
    }
    _play(steps, done) {
        if (!steps.length) return done();
        const s = steps.shift(), next = (ms = 900) => setTimeout(() => this._play(steps, done), ms), e = this.e3d;
        if (s.msg) this.$('.ex-text').textContent = s.msg;
        switch (s.t) {
            case 'hit': e.attack(s.side, s.mtype, s.power, () => this._boxes()); this._sfx(s.crit || s.eff > 1 ? 'crit' : 'hit'); return next(800);
            case 'miss': e.attack(s.side, 'normal', 30); return next();
            case 'dot': case 'status': this._boxes(); this._sfx('hit'); return next();
            case 'heal': e.heal(s.side); this._boxes(); this._sfx('heal'); return next();
            case 'faint': e.faint(s.side); this._sfx('faint'); this._boxes(); return next(1100);
            case 'recall': return next(600);
            case 'switch': e.setMine(this.battle.me().speciesId, this.battle.me().shiny); this._boxes(); return next(900);
            case 'throw': this._sfx('throw'); e.throwBall(s.ball, () => this._play(steps, done)); return;
            case 'shake': this._sfx('shake'); e.shakeBall(() => this._play(steps, done)); return;
            case 'caught': this._sfx('caught'); e.caught(() => this._play(steps, done)); return;
            case 'breakfree': e.breakFree(() => next(700)); return;
            default: return next();
        }
    }
    _finish() {
        const b = this.battle, g = this.game, lines = [], me = b.me(), over = b.over;
        if (over === 'win' || over === 'caught') {
            const inst = me.inst, lv0 = inst.level, sp0 = inst.speciesId, name0 = me.name;
            if (over === 'caught') {
                const o = b.caught && b.caught.outcome;
                if (o && o.firstCatch) lines.push(`Os dados de ${b.foe.name} foram registrados na Pokédex!`);
                if (o && o.uid) lines.push(g.gameState.party.includes(o.uid) ? `${b.foe.name} entrou para a sua equipe!` : `${b.foe.name} foi enviado ao PC.`);
            }
            const r = g.exploreVictory(b.wild, me.idx, me.maxHp, me.hp);
            lines.push(`${name0} ganhou ${typeof ptNumber === 'function' ? ptNumber(r.expGained) : r.expGained} de EXP!`);
            if (r.goldGained > 0) lines.push(`Você recebeu ${r.goldGained} de ouro.`);
            const now = g._partyInstance(me.idx) || inst;
            if (now.level > lv0) lines.push(`${name0} subiu para o nível ${now.level}!`);
            if (now.speciesId !== sp0) { lines.push(`O quê? ${name0} está evoluindo!`); lines.push(`Parabéns! ${name0} evoluiu para ${POKEMON_DATA[now.speciesId].name}!`); this._sfx('heal'); }
            this.keep = b.keep();
        } else if (over === 'run') this.keep = b.keep();
        const lose = over === 'lose';
        if (lose) { this.keep = {}; lines.push('Tudo escureceu…'); }
        if (!lines.length) return this._endBattle(lose);
        this._dialog(lines, () => this._endBattle(lose));
    }
    _endBattle(lose) {
        this.battle = null; this.mode = 'world';
        this.e3d.endBattle(); this.$('.ex-battle').hidden = true; this.root.classList.remove('ex-in-battle');
        this._refreshFollower(); this.e3d.resetTrail(this.state.dir); this._renderParty();
        this.grace = 3;
        if (lose) { this._goTo(EXPLORE_TOWN, { x: 6, y: 6, dir: 'up' }); this._center(['Seus Pokémon desmaiaram… você correu para cá.']); }
    }

    // ---------------- som (sintetizado; sem arquivos) ----------------
    _audioInit() { try { if (!this.audio) { const A = window.AudioContext || window.webkitAudioContext; if (A) this.audio = new A(); } if (this.audio && this.audio.state === 'suspended') this.audio.resume(); } catch (e) { this.audio = null; } }
    _sfx(kind) {
        const ac = this.audio; if (!ac || ac.state !== 'running') return;
        const tone = (f, d, type = 'square', v = 0.05, delay = 0, slide = 1) => { const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide !== 1) o.frequency.exponentialRampToValueAtTime(f * slide, t + d); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + 0.02); };
        const seq = (notes, step = 0.09, type = 'square') => notes.forEach((n, i) => tone(n, step * 1.4, type, 0.05, i * step));
        switch (kind) {
            case 'encounter': seq([392, 523, 659, 784, 659, 784, 988], 0.07); break;
            case 'shiny': seq([1319, 1568, 2093, 1568, 2093], 0.06, 'triangle'); break;
            case 'hit': tone(180, 0.12, 'sawtooth', 0.06, 0, 0.5); break;
            case 'crit': tone(320, 0.18, 'sawtooth', 0.07, 0, 0.4); tone(160, 0.2, 'square', 0.05, 0.05, 0.5); break;
            case 'faint': tone(440, 0.6, 'triangle', 0.06, 0, 0.3); break;
            case 'throw': tone(600, 0.25, 'triangle', 0.05, 0, 2); break;
            case 'shake': tone(240, 0.08, 'square', 0.05); break;
            case 'caught': seq([523, 659, 784, 1047, 784, 1047], 0.1, 'triangle'); break;
            case 'heal': seq([523, 659, 784, 659, 784, 1047], 0.12, 'triangle'); break;
            case 'ui': tone(880, 0.04, 'square', 0.03); break;
        }
    }
}
