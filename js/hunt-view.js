// ============================================================
// 狩猎（Caça）界面：配置自动狩猎、开始/暂停/停止、查看进度
//
// 只负责"把游戏状态画出来、把按钮转成请求"：
//   - 开始/暂停/继续/停止  → game.dispatchAutomationAction({ type })
//   - 改规则                → game.setAutomationPolicy(新策略)（校验在核心里）
//   - 选路线                → game.selectHuntRoute(id)
// 不计算伤害、经验、捕获、奖励，也不做任何自动化决策。
// 只在打开这个页签时订阅事件（防抖刷新）并每秒更新一次时间/血条；离开页签就全部取消。
// ============================================================

const HUNT_STATE_VIEW = {
    running: { icon: '🟢', label: 'Caçando' },
    paused: { icon: '🟡', label: 'Pausada' },
    stopped: { icon: '⚪', label: 'Parada' },
    stoppedByCondition: { icon: '🔴', label: 'Parada por condição' },
    none: { icon: '⚪', label: 'Parada' },
};

const HUNT_LIVE_EVENTS = [
    'battle_completed', 'pokemon_captured', 'heal', 'hunt_started', 'hunt_paused', 'hunt_resumed', 'hunt_stopped',
    'route_changed', 'policy_changed', 'pokemon_switched', 'level_up', 'evolution',
    'money_earned', 'money_spent', 'potion_bought', 'upgrade_purchased', 'hunt_completed',
];

function huntFormatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function huntClone(obj) { return JSON.parse(JSON.stringify(obj)); }

class HuntView {
    constructor(ui) {
        this.ui = ui;
        this.game = ui.game;
        this.root = document.getElementById('hunt-container');
        this._unsubs = [];
        this._tick = null;
        this._renderTimer = null;
        this._lastLimits = { battleLimit: 100, timeLimitMinutes: 60 };   // 取消勾选后再勾选时恢复的数值
        if (!this.root) return;
        this.section = 'ops';
        this.eco = new EconomyView(ui, this);
        this.root.innerHTML = `
            <h2>🎯 Caça</h2>
            <div id="hunt-resources" class="hunt-resources"></div>
            <div class="hunt-segs hunt-sections" role="tablist">
                <button class="hunt-seg active" data-hunt-section="ops">Operação</button>
                <button class="hunt-seg" data-hunt-section="shop">Loja</button>
                <button class="hunt-seg" data-hunt-section="upgrades">Upgrades</button>
                <button class="hunt-seg" data-hunt-section="analysis">Análise</button>
            </div>
            <div data-section="ops" class="hunt-section">
                <div id="hunt-status" class="hunt-card"></div>
                <div id="hunt-activity" class="hunt-card"></div>
                <div id="hunt-route" class="hunt-card"></div>
                <div id="hunt-team" class="hunt-card"></div>
                <div id="hunt-settings" class="hunt-card"></div>
            </div>
            <div data-section="shop" class="hunt-section hidden"><div id="hunt-shop" class="hunt-card"></div></div>
            <div data-section="upgrades" class="hunt-section hidden"><div id="hunt-upgrades" class="hunt-card"></div></div>
            <div data-section="analysis" class="hunt-section hidden"><div id="hunt-analysis" class="hunt-card"></div></div>`;
        this.root.addEventListener('click', (e) => {
            const sec = e.target.closest('[data-hunt-section]');
            if (sec) { this.showSection(sec.dataset.huntSection); return; }
            const eco = e.target.closest('[data-eco-action]');
            if (eco && !eco.disabled) { this.eco.handleAction(eco.dataset.ecoAction, eco.dataset); return; }
            const el = e.target.closest('[data-hunt-action]');
            if (el && !el.disabled) this.handleAction(el.dataset.huntAction, el.dataset);
        });
        this.root.addEventListener('change', (e) => this.handleChange(e.target));
        this.root.addEventListener('input', (e) => {
            if (e.target.matches && e.target.matches('input[type=range]')) this._syncRangeLabel(e.target);
        });
    }

    // ---------- 生命周期：只在页签可见时工作 ----------
    onShow() {
        if (!this.root || !this.game.gameState) return;
        this.onHide();
        for (const type of HUNT_LIVE_EVENTS) this._unsubs.push(this.game.bus.on(type, () => this._scheduleRender()));
        this._tick = setInterval(() => this._tickUpdate(), 1000);
        this.render();
    }

    onHide() {
        if (this.eco) this.eco.cancelEstimate();
        for (const off of this._unsubs) off();
        this._unsubs = [];
        if (this._tick) { clearInterval(this._tick); this._tick = null; }
        if (this._renderTimer) { clearTimeout(this._renderTimer); this._renderTimer = null; }
    }

    _scheduleRender() {
        if (this._renderTimer) return;
        this._renderTimer = setTimeout(() => {
            this._renderTimer = null;
            this.renderLive();
            if (this._settingsDirty) this.renderSettings();
        }, 400);
    }

    render() {
        this.renderLive();
        this.renderSettings();
        this.renderSection();
    }

    // ---------- 分区（Operação / Loja / Upgrades / Análise）----------
    showSection(name) {
        if (!['ops', 'shop', 'upgrades', 'analysis'].includes(name)) return;
        if (this.section === 'analysis' && name !== 'analysis') this.eco.cancelEstimate();
        this.section = name;
        this.root.querySelectorAll('[data-hunt-section]').forEach(b => b.classList.toggle('active', b.dataset.huntSection === name));
        this.root.querySelectorAll('[data-section]').forEach(d => d.classList.toggle('hidden', d.dataset.section !== name));
        if (name === 'analysis') this.game.noteAnalyzerOpened();
        this.renderSection();
    }

    // 只渲染当前可见的分区（其余分区切换时才渲染，保持手机上很轻）
    renderSection() {
        if (!this.root || !this.game.gameState) return;
        this.eco.renderResources();
        if (this.section === 'shop') this.eco.renderShop();
        else if (this.section === 'upgrades') this.eco.renderUpgrades();
        else if (this.section === 'analysis') this.eco.renderAnalysis();
    }

    // 会随战斗变化的部分
    renderLive() {
        if (!this.root || !this.game.gameState) return;
        this.eco.renderResources();
        if (this.section === 'ops') {
            this.renderStatus();
            this.renderActivity();
            this.renderRoute();
            this.renderTeam();
        } else if (this.section !== 'analysis' || !this.eco._estimating) {
            this.renderSection();
        }
    }

    // 每秒：只更新时间和血条文字，不重绘
    _tickUpdate() {
        const g = this.game;
        const s = g.getHuntSession();
        const t = this.root.querySelector('[data-hunt-duration]');
        if (t && s) t.textContent = huntFormatDuration(huntSessionDurationMs(s, g.now()));
        const hp = this.root.querySelector('[data-hunt-active-hp]');
        const b = g.currentBattle;
        if (hp && b && b.playerMaxHp > 0) {
            const pct = Math.max(0, Math.min(100, Math.round(b.playerCurrentHp / b.playerMaxHp * 100)));
            hp.style.width = pct + '%';
            hp.className = 'hunt-hp-fill ' + (pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low');
            const txt = this.root.querySelector('[data-hunt-active-hp-text]');
            if (txt) txt.textContent = `${Math.max(0, Math.ceil(b.playerCurrentHp))}/${Math.ceil(b.playerMaxHp)}`;
        }
        this.root.querySelectorAll('[data-hunt-potions]').forEach(pot => { pot.textContent = ptNumber(g.getPotions()); });
        this.eco.tickResources();
    }

    // ---------- 状态与统计 ----------
    _stateView(s) {
        if (!s || s.state === 'idle') return HUNT_STATE_VIEW.none;
        if (s.state === 'stopped' || s.state === 'finished') return huntStoppedByCondition(s) ? HUNT_STATE_VIEW.stoppedByCondition : HUNT_STATE_VIEW.stopped;
        return HUNT_STATE_VIEW[s.state] || HUNT_STATE_VIEW.none;
    }

    renderStatus() {
        const g = this.game;
        const s = g.getHuntSession();
        const view = this._stateView(s);
        const active = !!s && (s.state === 'running' || s.state === 'paused');
        const stats = s ? s.stats : { battles: 0, victories: 0, defeats: 0, captures: 0, shinies: 0, xp: 0, money: 0, healingSpent: 0 };
        const dur = s ? huntSessionDurationMs(s, g.now()) : 0;
        const eff = huntEfficiency(stats, dur);
        let buttons;
        if (!s || !active) buttons = '<button class="hunt-btn primary" data-hunt-action="start">▶ INICIAR CAÇA</button>';
        else if (s.state === 'running') buttons = '<button class="hunt-btn" data-hunt-action="pause">⏸ PAUSAR</button><button class="hunt-btn danger" data-hunt-action="stop">⏹ PARAR</button>';
        else buttons = '<button class="hunt-btn primary" data-hunt-action="resume">▶ RETOMAR</button><button class="hunt-btn danger" data-hunt-action="stop">⏹ PARAR</button>';

        let notice = '';
        if (s && s.state === 'stopped') {
            const reason = s.stopReason && s.stopReason !== 'manual' ? huntStopReasonShort(s) : 'encerrada por você';
            notice = `<div class="hunt-notice ${huntStoppedByCondition(s) ? 'condition' : ''}"><strong>Caça encerrada</strong><br>Motivo: ${escapeHtml(reason)}</div>`;
        } else if (s && s.state === 'paused') {
            notice = '<div class="hunt-notice soft">A automação está pausada: a equipe continua batalhando, mas sem seguir a política (cura, paradas e trocas).</div>';
        }
        const stat = (label, value, attr = '') => `<div class="hunt-stat"><span class="hunt-stat-value"${attr}>${value}</span><span class="hunt-stat-label">${label}</span></div>`;
        this.root.querySelector('#hunt-status').innerHTML = `
            <div class="hunt-state"><span class="hunt-state-icon">${view.icon}</span><span class="hunt-state-label">${view.label}</span></div>
            <div class="hunt-buttons">${buttons}</div>
            ${notice}
            <div class="hunt-stats">
                ${stat('Tempo', huntFormatDuration(dur), ' data-hunt-duration')}
                ${stat('Batalhas', ptNumber(stats.battles))}
                ${stat('Vitórias', ptNumber(stats.victories))}
                ${stat('Capturas', ptNumber(stats.captures))}
                ${stat('Shinies', ptNumber(stats.shinies))}
                ${stat('EXP ganha', ptNumber(stats.xp))}
                ${stat('Poções usadas', ptNumber(stats.healingSpent))}
                ${stat('Dinheiro ganho', ptNumber(stats.money))}
                ${stat('Eficiência', active || s ? `${ptNumber(eff.xpPerHour)} EXP/h` : '—')}
            </div>
            <div class="hunt-potions">🧪 Poções disponíveis: <strong data-hunt-potions>${ptNumber(g.getPotions())}</strong></div>`;
    }

    // ---------- 最近发生的重要事情（只放玩家关心的，不是技术日志）----------
    _activityLine(e) {
        const g = this.game;
        const name = (id) => (POKEMON_DATA[id] ? POKEMON_DATA[id].name : '#' + id);
        switch (e.type) {
            case 'pokemon_captured':
                if (!(e.firstCatch || e.newIndividual)) return null;
                return `${e.shiny ? '✨' : '🎒'} Capturou ${name(e.id)}${e.shiny ? ' Shiny' : ''}${e.grade ? ` (nota ${e.grade})` : ''}`;
            case 'level_up': {
                const inst = g.roster.get(e.uid);
                return inst && g.roster.party.contains(e.uid) ? `⬆️ ${name(inst.speciesId)} chegou ao nível ${e.level}` : null;
            }
            case 'evolution': return `🌟 ${name(e.from)} evoluiu para ${name(e.to)}`;
            case 'heal': return e.potion ? `🧪 Poção usada: +${ptNumber(e.amount)} de HP (restam ${ptNumber(e.potionsLeft)})` : null;
            case 'route_changed': { const r = g.getRoute(e.route); return r ? `🗺️ Nova rota: ${r.name}` : null; }
            case 'hunt_started': return '🟢 Caçada iniciada';
            case 'hunt_paused': return '🟡 Caçada pausada';
            case 'hunt_resumed': return '🟢 Caçada retomada';
            case 'hunt_stopped': return e.message ? `🔴 ${e.message}` : '⚪ Caça encerrada.';
            default: return null;
        }
    }

    renderActivity() {
        const lines = [];
        for (const e of this.game.bus.recent(200).slice().reverse()) {
            const text = this._activityLine(e);
            if (text) lines.push(`<li><span class="hunt-time">${escapeHtml(new Date(e.t).toLocaleTimeString('pt-BR'))}</span> ${escapeHtml(text)}</li>`);
            if (lines.length >= 6) break;
        }
        this.root.querySelector('#hunt-activity').innerHTML = `
            <h3>📰 Atividade recente</h3>
            ${lines.length ? `<ul class="hunt-activity">${lines.join('')}</ul>` : '<div class="hunt-hint">Nada por aqui ainda. Capturas, evoluções e poções usadas aparecem nesta lista.</div>'}`;
    }

    // ---------- 路线 ----------
    _routeProgress(route) {
        const g = this.game;
        const ids = [...new Set(route.pokemon.map(p => p.id))];
        const caught = ids.filter(id => g.gameState.pokedex[id] === 'caught').length;
        const condition = g.gameState.settings?.routeSwitchCondition || '6v_shiny';
        const perfect = ids.filter(id => {
            const d = g.getStoredData(id);
            if (!d || !d.ivs || !IV_KEYS.every(k => d.ivs[k] === 31)) return false;
            return condition === '6v_only' ? true : !!g.gameState.shinyDex[id];
        }).length;
        return { ids, caught, perfect, total: ids.length, complete: g._isRouteCompleteByCondition(route.id), condition };
    }

    _availableRoutes() {
        const out = [];
        for (const regionKey in REGIONS) {
            if (!this.game.isRegionUnlocked(regionKey)) continue;
            for (const route of REGIONS[regionKey].routes) out.push({ region: REGIONS[regionKey], route });
        }
        return out;
    }

    renderRoute() {
        const g = this.game;
        const route = g.getRoute(g.gameState.currentRoute);
        const el = this.root.querySelector('#hunt-route');
        if (!route) { el.innerHTML = ''; return; }
        const prog = this._routeProgress(route);
        const rec = recommendHuntRoute(g);
        const policy = g.getAutomationPolicy();
        const options = this._availableRoutes().map(({ region, route: r }) => {
            const done = g._isRouteCompleteByCondition(r.id) ? ' ✓' : '';
            const star = rec && rec.routeId === r.id ? ' ⭐' : '';
            const lv = r.levelRange ? ` (Nv. ${r.levelRange[0]}–${r.levelRange[1]})` : '';
            return `<option value="${escapeHtml(r.id)}"${r.id === route.id ? ' selected' : ''}>${escapeHtml(region.name)} · ${escapeHtml(r.name)}${lv}${done}${star}</option>`;
        }).join('');
        const lvRange = route.levelRange ? `${route.levelRange[0]}–${route.levelRange[1]}` : '—';
        const species = prog.ids.map(id => {
            const status = g.gameState.pokedex[id];
            const known = status === 'caught' || status === 'seen';
            const name = known ? POKEMON_DATA[id].name : '???';
            const mark = status === 'caught' ? '✓' : status === 'seen' ? '👁' : '?';
            const shiny = g.gameState.shinyDex[id] ? ' ✨' : '';
            const prio = policyTargetsSpecies(policy, id);
            return `<button class="hunt-chip${prio ? ' prio' : ''}" data-hunt-action="toggle-target" data-id="${id}" title="${prio ? 'Remover da prioridade' : 'Dar prioridade de captura'}">${known ? `<img src="${escapeHtml(getPokemonSpriteUrl(id))}" alt="" loading="lazy">` : '<span class="hunt-chip-unknown">?</span>'}<span>${escapeHtml(name)} ${mark}${shiny}</span><span class="hunt-chip-star">${prio ? '⭐' : '☆'}</span></button>`;
        }).join('');
        let recHtml = '';
        // 有已计算的比较数据时，推荐按"分析"页的目标给出（新）；否则退回按队伍等级的简单推荐
        const goal = g.getAnalyzerGoal();
        const cmp = g.compareRoutes({ estimate: 'cached' });
        if (cmp.rows.filter(r => r.rates).length >= 2) {
            const grec = g.recommendRouteForGoal(goal, cmp);
            recHtml = grec.none
                ? `<div class="hunt-rec">⭐ <strong>Recomendação (objetivo: ${escapeHtml(ECO_GOAL_LABELS[goal])}):</strong> ${escapeHtml(grec.text)}</div>`
                : `<div class="hunt-rec">⭐ <strong>Recomendação (objetivo: ${escapeHtml(ECO_GOAL_LABELS[goal])}):</strong> ${escapeHtml(grec.name)}. ${escapeHtml(grec.text)} <button class="hunt-link" data-hunt-action="use-recommended" data-id="${escapeHtml(grec.routeId)}">Usar</button></div>`;
        } else if (rec) {
            recHtml = rec.routeId === route.id
                ? `<div class="hunt-rec">⭐ <strong>Recomendação:</strong> esta é a rota recomendada. ${escapeHtml(rec.reason)}</div>`
                : `<div class="hunt-rec">⭐ <strong>Recomendação:</strong> ${escapeHtml(rec.name)}. ${escapeHtml(rec.reason)} <button class="hunt-link" data-hunt-action="use-recommended" data-id="${escapeHtml(rec.routeId)}">Usar</button><br><small>Abra Análise → Estimar rotas para recomendar pelo seu objetivo.</small></div>`;
        }
        el.innerHTML = `
            <h3>🗺️ Rota</h3>
            <label class="hunt-field"><span>Rota atual</span><select data-hunt-route>${options}</select></label>
            <div class="hunt-route-info">
                <span>Nível dos inimigos: <strong>${lvRange}</strong></span>
                <span>Progresso: <strong>${prog.caught}/${prog.total}</strong> capturadas · <strong>${prog.perfect}/${prog.total}</strong> ${prog.condition === '6v_only' ? '6V' : '6V + Shiny'}${prog.complete ? ' · ✅ concluída' : ''}</span>
            </div>
            ${recHtml}
            <div class="hunt-sub">Espécies encontradas <small>(toque para priorizar a captura)</small></div>
            <div class="hunt-chips">${species}</div>`;
    }

    // ---------- 队伍 ----------
    renderTeam() {
        const g = this.game;
        const gs = g.gameState;
        const b = g.currentBattle;
        const cards = gs.party.map((uid, i) => {
            const d = g.describeInstance(uid);
            const inst = g.roster.get(uid);
            if (!d || !inst) return '';
            const q = calculatePokemonQuality(inst);
            const isActive = i === gs.activePokemonIndex;
            let hp = '<span class="hunt-hp-none">Reserva</span>';
            if (isActive && b && b.playerMaxHp > 0) {
                const pct = Math.max(0, Math.min(100, Math.round(b.playerCurrentHp / b.playerMaxHp * 100)));
                hp = `<div class="hunt-hp"><div class="hunt-hp-fill ${pct > 50 ? 'ok' : pct > 25 ? 'mid' : 'low'}" data-hunt-active-hp style="width:${pct}%"></div></div><small data-hunt-active-hp-text>${Math.max(0, Math.ceil(b.playerCurrentHp))}/${Math.ceil(b.playerMaxHp)}</small>`;
            }
            const url = d.shiny ? getShinyPokemonSpriteUrl(d.speciesId) : getPokemonSpriteUrl(d.speciesId);
            return `<div class="hunt-member${isActive ? ' active' : ''}">
                <img src="${escapeHtml(url)}" alt="" loading="lazy">
                <div class="hunt-member-info">
                    <div class="hunt-member-name">#${i + 1} ${escapeHtml(d.displayName)}${d.shiny ? ' ✨' : ''}${isActive ? ' <span class="hunt-badge">Em campo</span>' : ''}</div>
                    <div class="hunt-member-meta">Nv. ${d.level} · <span class="hunt-grade g-${q.grade}">Nota ${q.grade}</span> <small>(${q.percentage}%)</small></div>
                    <div class="hunt-member-hp">${hp}</div>
                </div>
            </div>`;
        }).join('');
        this.root.querySelector('#hunt-team').innerHTML = `
            <h3>⚔️ Equipe na caça <small>(${gs.party.length}/${PARTY_MAX})</small></h3>
            <div class="hunt-members">${cards}</div>
            <button class="hunt-link" data-hunt-action="manage-team">Gerenciar equipe no PC →</button>`;
    }

    // ---------- 设置 ----------
    renderSettings() {
        if (!this.root || !this.game.gameState) return;
        this._settingsDirty = false;
        const p = this.game.getAutomationPolicy();
        const chk = (path, v) => `data-hunt-policy="${path}" data-kind="bool"${v ? ' checked' : ''}`;
        const num = (path, v, min, max) => `data-hunt-policy="${path}" data-kind="int" type="number" min="${min}" max="${max}" value="${v}" inputmode="numeric"`;
        const targets = p.target.speciesIds.map(id => `<span class="hunt-tag">${escapeHtml(POKEMON_DATA[id] ? POKEMON_DATA[id].name : '#' + id)} <button data-hunt-action="remove-target" data-id="${id}" aria-label="Remover">✕</button></span>`).join('') || '<small>Nenhuma: todas as espécies são tratadas igual.</small>';
        const gradeAt = (pct) => (pct >= 90 ? 'S' : pct >= 75 ? 'A' : pct >= 60 ? 'B' : pct >= 40 ? 'C' : 'D');
        const mode = p.route.mode;
        const radio = (value, label) => `<label class="hunt-radio"><input type="radio" name="hunt-route-mode" data-hunt-route-mode value="${value}"${mode === value ? ' checked' : ''}> ${label}</label>`;
        const limit = (key, label, unit) => {
            const v = p.stopConditions[key];
            return `<div class="hunt-limit"><label class="hunt-check"><input type="checkbox" data-hunt-limit="${key}"${v > 0 ? ' checked' : ''}> ${label}</label>
                <input ${num(`stopConditions.${key}`, v > 0 ? v : this._lastLimits[key], 1, key === 'battleLimit' ? 1000000 : 100000)}${v > 0 ? '' : ' disabled'}> <span>${unit}</span></div>`;
        };
        this.root.querySelector('#hunt-settings').innerHTML = `
            <h3>🎯 Captura</h3>
            <label class="hunt-check"><input type="checkbox" ${chk('capture.enabled', p.capture.enabled)}> Capturar</label>
            <label class="hunt-field"><span>Qualidade mínima: <strong data-hunt-range-label>${p.capture.minQualityPercent}% (≈ nota ${gradeAt(p.capture.minQualityPercent)})</strong></span>
                <input type="range" min="0" max="100" step="5" value="${p.capture.minQualityPercent}" data-hunt-policy="capture.minQualityPercent" data-kind="int"></label>
            <label class="hunt-check"><input type="checkbox" ${chk('capture.alwaysShiny', p.capture.alwaysShiny)}> Capturar Shiny sempre</label>
            <label class="hunt-check"><input type="checkbox" ${chk('capture.alwaysNewSpecies', p.capture.alwaysNewSpecies)}> Capturar espécie nova</label>
            <div class="hunt-sub">Espécies prioritárias</div>
            <div class="hunt-tags">${targets}</div>

            <h3>🧪 Cura</h3>
            <div class="hunt-potions">Poções: <strong data-hunt-potions>${ptNumber(this.game.getPotions())}</strong></div>
            <label class="hunt-check"><input type="checkbox" ${chk('heal.enabled', p.heal.enabled)}> Cura automática</label>
            <div class="hunt-limit"><span>Curar quando HP &lt;</span> <input ${num('heal.whenHpBelowPercent', p.heal.whenHpBelowPercent, 1, 99)}> <span>%</span></div>
            <label class="hunt-field"><span>Sem poções</span>
                <select data-hunt-policy="heal.onNoPotions" data-kind="str"><option value="stop" selected>Parar</option><option value="rest" disabled>Descansar (em breve)</option></select></label>

            <h3>🏁 Quando completar a rota</h3>
            <div class="hunt-radios">${radio('stay', 'Continuar')}${radio('switchWhenComplete', 'Trocar de rota')}${radio('stopWhenComplete', 'Parar')}</div>

            <h3>⏹ Condições de parada</h3>
            <label class="hunt-check"><input type="checkbox" ${chk('stopConditions.shinyFound', p.stopConditions.shinyFound)}> Parar ao encontrar Shiny</label>
            ${limit('battleLimit', 'Parar após', 'batalhas')}
            ${limit('timeLimitMinutes', 'Parar após', 'minutos')}
            <label class="hunt-check"><input type="checkbox" data-hunt-complete-stop${mode === 'stopWhenComplete' || p.stopConditions.routeComplete ? ' checked' : ''}> Parar quando a rota estiver completa</label>
            <div class="hunt-hint">Alterações valem na hora, mesmo com a caçada rodando.</div>`;
    }

    _syncRangeLabel(input) {
        const label = this.root.querySelector('[data-hunt-range-label]');
        if (!label) return;
        const v = Number(input.value);
        label.textContent = `${v}% (≈ nota ${v >= 90 ? 'S' : v >= 75 ? 'A' : v >= 60 ? 'B' : v >= 40 ? 'C' : 'D'})`;
    }

    // ---------- 动作 ----------
    _report(result, okText) {
        if (result && result.ok === false) this.ui.showToast(`⚠️ ${result.message || 'Não foi possível.'}`);
        else if (okText) this.ui.showToast(okText);
        this.render();
    }

    handleAction(action, data) {
        const g = this.game;
        switch (action) {
            case 'start': this._report(g.dispatchAutomationAction({ type: 'START_HUNT' }), '🎯 Caçada iniciada!'); break;
            case 'pause': this._report(g.dispatchAutomationAction({ type: 'PAUSE_HUNT' })); break;
            case 'resume': this._report(g.dispatchAutomationAction({ type: 'RESUME_HUNT' })); break;
            case 'stop': this._report(g.dispatchAutomationAction({ type: 'STOP_HUNT' })); break;
            case 'use-recommended': this._report(g.selectHuntRoute(data.id, 'recommended')); break;
            case 'manage-team': this.ui.switchTab('tab-pc'); break;
            case 'toggle-target': this._toggleTarget(Number(data.id)); break;
            case 'remove-target': this._toggleTarget(Number(data.id), false); break;
        }
    }

    _toggleTarget(id, force) {
        const p = huntClone(this.game.getAutomationPolicy());
        const list = p.target.speciesIds;
        const has = list.includes(id);
        const want = force === undefined ? !has : force;
        if (want && !has) list.push(id);
        if (!want && has) list.splice(list.indexOf(id), 1);
        p.target.type = list.length ? 'species' : 'any';
        this._applyPolicy(p);
    }

    _applyPolicy(next) {
        const r = this.game.setAutomationPolicy(next);
        if (!r.ok) this.ui.showToast(`⚠️ ${r.errors[0] ? r.errors[0].message : 'Política inválida.'}`);
        this.render();
    }

    handleChange(el) {
        const g = this.game;
        if (el.matches('[data-hunt-route]')) { this._report(g.selectHuntRoute(el.value)); return; }
        const p = huntClone(g.getAutomationPolicy());
        if (el.matches('[data-hunt-route-mode]')) {
            p.route.mode = el.value;
            p.stopConditions.routeComplete = el.value === 'stopWhenComplete';
            this._applyPolicy(p);
            return;
        }
        if (el.matches('[data-hunt-complete-stop]')) {
            p.stopConditions.routeComplete = el.checked;
            if (el.checked) p.route.mode = 'stopWhenComplete';
            else if (p.route.mode === 'stopWhenComplete') p.route.mode = 'stay';
            this._applyPolicy(p);
            return;
        }
        if (el.matches('[data-hunt-limit]')) {
            const key = el.dataset.huntLimit;
            if (el.checked) p.stopConditions[key] = this._lastLimits[key];
            else { if (p.stopConditions[key] > 0) this._lastLimits[key] = p.stopConditions[key]; p.stopConditions[key] = 0; }
            this._applyPolicy(p);
            return;
        }
        if (el.matches('[data-hunt-policy]')) {
            const path = el.dataset.huntPolicy.split('.');
            let value;
            if (el.dataset.kind === 'bool') value = el.checked;
            else if (el.dataset.kind === 'int') value = Math.floor(Number(el.value));
            else value = el.value;
            let obj = p;
            for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
            obj[path[path.length - 1]] = value;
            if (path[0] === 'stopConditions' && (path[1] === 'battleLimit' || path[1] === 'timeLimitMinutes') && value > 0) this._lastLimits[path[1]] = value;
            this._applyPolicy(p);
        }
    }

    // ---------- 通知 ----------
    onHuntEvent(kind, data) {
        if (kind === 'stopped') {
            this.ui.showToast(data.byCondition ? `🔴 ${data.message}` : '⚪ Caça encerrada.');
            this.ui.addBattleLog(`🎯 ${data.message}`, data.byCondition ? 'defeat' : 'normal');
            if (this.ui.currentTab === 'tab-hunt') this.render();
        }
    }
}
