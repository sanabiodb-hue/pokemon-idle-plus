// ============================================================
// PC 与个体详情界面（PCView）
//
// 只负责“把名册画出来、把按钮转成 GameCore 的队伍/PC 服务调用”：
//   - 队伍栏：每个成员都带上 序号/性别/性格/个体值%，同物种的两只一眼就能分辨
//   - 箱子栏：翻页、改名、新建；搜索时跨箱子列出所有匹配的个体
//   - 详情栏：选中个体的全部信息 + 操作（加入队伍 / 换下队员 / 改名 / 放生 / 移到别的箱子）
// 不直接修改 gameState；所有改动都走 game.partyAdd / partyRemove / partySwapWithPc / ...
// ============================================================

const ROSTER_MESSAGES = {
    party_full: '⚠️ 队伍已满（最多6只）',
    last_member: '⚠️ 队伍至少需要保留一只宝可梦',
    active_member: '⚠️ 出战中的宝可梦不能离开队伍，请先换其他宝可梦出战',
    tower_locked: '⚠️ 挑战塔进行中不能调整队伍',
    busy: '⚠️ 离线结算中，请稍后再试',
    pc_full: '⚠️ PC 已满',
    box_full: '⚠️ 这个箱子已满',
    in_party: '⚠️ 队伍中的宝可梦不能放生，请先放回 PC',
    last_of_species: '⚠️ 每个物种至少要保留一只',
    unknown_pokemon: '⚠️ 找不到这只宝可梦',
    already_in_party: '⚠️ 已经在队伍中',
    not_in_pc: '⚠️ 这只宝可梦不在 PC 中',
    not_in_party: '⚠️ 这只宝可梦不在队伍中',
    bad_index: '⚠️ 位置无效',
};

function rosterMessage(code) {
    return ROSTER_MESSAGES[code] || ('⚠️ 操作失败（' + code + '）');
}

const IV_LABELS = { hp: '生命', atk: '攻击', def: '防御', spAtk: '特攻', spDef: '特防', speed: '速度' };
const ABILITY_LABELS = { a1: '特性 1', a2: '特性 2', ha: '隐藏特性' };
const ORIGIN_LABELS = {
    starter: '初始伙伴', wild: '野外捕获', evolution: '进化', legacy_migration: '旧存档',
    egg: '孵化', gift: '赠送', debug: '调试', unknown: '未知',
};

function genderSymbol(gender) {
    return gender === 'male' ? '♂' : gender === 'female' ? '♀' : '';
}

function formatCaptureDate(ts) {
    if (!Number.isFinite(ts)) return '—';
    return new Date(ts).toISOString().slice(0, 10);
}

class PCView {
    constructor(ui) {
        this.ui = ui;
        this.game = ui.game;
        this.boxIndex = 0;
        this.selectedUid = null;
        this.search = '';
        this.root = document.getElementById('pc-container');
        if (!this.root) return;
        this.root.innerHTML = `
            <h2>🖥️ PC 与队伍 <span id="pc-summary" class="pc-summary"></span></h2>
            <div class="pc-section">
                <h3>⚔️ 队伍 <span id="pc-party-count"></span></h3>
                <div id="pc-party" class="pc-party"></div>
            </div>
            <div class="pc-section">
                <div class="pc-box-bar">
                    <button class="setting-btn" data-pc-action="box-prev" title="上一个箱子">◀</button>
                    <span id="pc-box-title" class="pc-box-title"></span>
                    <button class="setting-btn" data-pc-action="box-next" title="下一个箱子">▶</button>
                    <button class="setting-btn" data-pc-action="box-rename" title="给当前箱子改名">✏️ 改名</button>
                    <button class="setting-btn" data-pc-action="box-add" title="新建箱子">➕ 新箱子</button>
                    <button class="setting-btn" data-pc-action="tidy" title="每个物种只保留最强的一只（闪光、有昵称、队伍里的不受影响）">🧹 整理重复</button>
                </div>
                <input type="text" id="pc-search-input" class="pc-search" placeholder="🔍 搜索 PC 里的宝可梦（名称/昵称/编号）" autocomplete="off">
                <div id="pc-grid" class="pc-grid"></div>
            </div>
            <div class="pc-section">
                <h3>📋 个体详情</h3>
                <div id="pc-detail" class="pc-detail"></div>
            </div>`;
        this.root.addEventListener('click', (e) => {
            const el = e.target.closest('[data-pc-action]');
            if (el) this.handle(el.dataset.pcAction, el.dataset);
        });
        this.root.querySelector('#pc-search-input').addEventListener('input', (e) => {
            this.search = e.target.value.trim();
            this.renderGrid();
        });
    }

    // ---------- 渲染 ----------
    render() {
        if (!this.root || !this.game.gameState) return;
        const boxes = this.game.gameState.pc.boxes;
        if (this.boxIndex >= boxes.length) this.boxIndex = Math.max(0, boxes.length - 1);
        if (this.selectedUid && !this.game.roster.has(this.selectedUid)) this.selectedUid = null;
        const r = this.game.roster;
        this.root.querySelector('#pc-summary').textContent =
            `共 ${r.count()} 只 · PC ${r.pc.count()}/${r.pc.totalCapacity()}${r.hasRoom() ? '' : ' · ⚠️ PC 已满，新宝可梦（闪光除外也一样）无法收下'}`;
        this.renderParty();
        this.renderGrid();
        this.renderDetail();
    }

    _spriteFor(d) {
        const url = d.shiny ? getShinyPokemonSpriteUrl(d.speciesId) : getPokemonSpriteUrl(d.speciesId);
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(d.name)}" onerror="this.parentElement.textContent='🔵'">`;
    }

    // 卡片上的一行摘要：让同物种的两只能一眼分开（序号 + 性别 + 性格 + 个体值%）
    _summaryLine(d) {
        return `#${escapeHtml(d.uid)} ${genderSymbol(d.gender)} ${escapeHtml(d.natureName)} · IV ${d.ivPercent}%`;
    }

    _card(d, extraClass = '') {
        const same = this.game.roster.countOfSpecies(d.speciesId);
        const selected = d.uid === this.selectedUid ? ' selected' : '';
        return `<div class="pc-card${selected}${d.shiny ? ' shiny' : ''}${extraClass}" data-pc-action="select" data-uid="${escapeHtml(d.uid)}" title="${escapeHtml(d.name)}">
            <div class="pc-card-sprite">${this._spriteFor(d)}</div>
            <div class="pc-card-info">
                <div class="pc-card-name">${d.shiny ? '✨ ' : ''}${escapeHtml(d.displayName)}${same > 1 ? ` <span class="pc-same-badge">×${same}</span>` : ''}</div>
                <div class="pc-card-sub">Lv.${d.level} ${d.nickname ? '(' + escapeHtml(d.name) + ')' : ''}</div>
                <div class="pc-card-sub">${this._summaryLine(d)}</div>
            </div>
        </div>`;
    }

    renderParty() {
        const gs = this.game.gameState;
        this.root.querySelector('#pc-party-count').textContent = `(${gs.party.length}/${PARTY_MAX})`;
        const free = PARTY_MAX - gs.party.length;
        const freeHint = free > 0
            ? `<div class="pc-empty">还有 ${free} 个空位：${this.game.roster.pc.count() > 0 ? '在下面的箱子里点一只宝可梦，再点「加入队伍」。队伍里的伙伴会一起获得经验。' : '继续战斗，新捕获的伙伴会出现在下面的箱子里。'}</div>`
            : '';
        const html = gs.party.map((uid, i) => {
            const d = this.game.describeInstance(uid);
            if (!d) return '';
            const isActive = i === gs.activePokemonIndex;
            return `<div class="pc-party-slot${isActive ? ' active' : ''}">
                ${this._card(d)}
                <div class="pc-party-actions">
                    <button data-pc-action="party-up" data-index="${i}" ${i === 0 ? 'disabled' : ''} title="上移">▲</button>
                    <button data-pc-action="party-down" data-index="${i}" ${i === gs.party.length - 1 ? 'disabled' : ''} title="下移">▼</button>
                    <button data-pc-action="party-active" data-index="${i}" ${isActive ? 'disabled' : ''}>${isActive ? '⚔️ 出战中' : '出战'}</button>
                    <button data-pc-action="to-pc" data-index="${i}" ${isActive || gs.party.length <= 1 ? 'disabled' : ''}>放回PC</button>
                </div>
            </div>`;
        }).join('');
        this.root.querySelector('#pc-party').innerHTML = html + freeHint;
    }

    _matches(d, term) {
        const t = term.toLowerCase();
        return d.name.toLowerCase().includes(t) || d.nickname.toLowerCase().includes(t)
            || String(d.speciesId) === t.replace(/^#/, '') || d.uid.toLowerCase() === t;
    }

    renderGrid() {
        const boxes = this.game.gameState.pc.boxes;
        const box = boxes[this.boxIndex];
        const title = this.root.querySelector('#pc-box-title');
        const grid = this.root.querySelector('#pc-grid');
        if (this.search) {
            title.textContent = `🔍 搜索结果`;
            const found = this.game.roster.pc.uids()
                .map(uid => this.game.describeInstance(uid))
                .filter(d => d && this._matches(d, this.search))
                .sort((a, b) => a.speciesId - b.speciesId || b.level - a.level);
            grid.innerHTML = found.length
                ? found.map(d => this._card(d)).join('')
                : '<div class="pc-empty">没有匹配的宝可梦</div>';
            return;
        }
        if (!box) { grid.innerHTML = ''; return; }
        const used = box.slots.filter(u => u !== null).length;
        title.textContent = `📦 ${box.name}（${this.boxIndex + 1}/${boxes.length}）${used}/${box.capacity}`;
        if (used === 0) {
            const total = this.game.roster.pc.count();
            grid.innerHTML = `<div class="pc-empty">${total === 0
                ? 'PC 还是空的。击败野生宝可梦后，新捕获的宝可梦会被送到这里。'
                : '这个箱子是空的，点 ▶ 看看别的箱子。'}</div>`;
            return;
        }
        grid.innerHTML = box.slots.map(uid => {
            const d = uid ? this.game.describeInstance(uid) : null;
            return d ? this._card(d) : '<div class="pc-card empty"></div>';
        }).join('');
    }

    renderDetail() {
        const el = this.root.querySelector('#pc-detail');
        const d = this.selectedUid ? this.game.describeInstance(this.selectedUid) : null;
        if (!d) { el.innerHTML = '<div class="pc-empty">点击上方的宝可梦查看详情</div>'; return; }
        const gs = this.game.gameState;
        const route = d.originRoute ? this.game.getRoute(d.originRoute) : null;
        const ivRows = IV_KEYS.map(k => `<span class="pc-iv"><b>${IV_LABELS[k]}</b> ${d.ivs[k]}</span>`).join('');
        const where = d.where === 'party' ? `队伍第 ${d.partyIndex + 1} 位`
            : d.where === 'pc' ? `PC · ${escapeHtml(gs.pc.boxes[d.box].name)} 第 ${d.slot + 1} 格` : '—';
        let actions = '';
        if (d.where === 'pc') {
            const members = gs.party.map((uid, i) => {
                const m = this.game.describeInstance(uid);
                return m ? `<option value="${i}">${i + 1}. ${escapeHtml(m.displayName)} Lv.${m.level} #${escapeHtml(m.uid)}</option>` : '';
            }).join('');
            const boxOptions = gs.pc.boxes.map((b, i) =>
                `<option value="${i}" ${i === d.box ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('');
            actions += `<button class="setting-btn" data-pc-action="to-party" data-uid="${escapeHtml(d.uid)}">➕ 加入队伍</button>
                <span class="pc-inline"><select id="pc-swap-target">${members}</select>
                <button class="setting-btn" data-pc-action="swap" data-uid="${escapeHtml(d.uid)}">🔄 换下该队员</button></span>
                <span class="pc-inline"><select id="pc-move-target">${boxOptions}</select>
                <button class="setting-btn" data-pc-action="move-box" data-uid="${escapeHtml(d.uid)}">📦 移到箱子</button></span>`;
        } else if (d.where === 'party') {
            actions += `<button class="setting-btn" data-pc-action="to-pc" data-index="${d.partyIndex}">⬇️ 放回 PC</button>`;
        }
        actions += `<button class="setting-btn" data-pc-action="rename" data-uid="${escapeHtml(d.uid)}">✏️ 改名</button>`;
        if (d.where === 'pc') actions += `<button class="setting-btn danger" data-pc-action="release" data-uid="${escapeHtml(d.uid)}">放生</button>`;
        el.innerHTML = `<div class="pc-detail-head">
                <div class="pc-card-sprite big">${this._spriteFor(d)}</div>
                <div>
                    <div class="pc-detail-name">${d.shiny ? '✨ ' : ''}${escapeHtml(d.displayName)} ${genderSymbol(d.gender)}
                        <small>Lv.${d.level}</small></div>
                    <div class="pc-detail-sub">${escapeHtml(d.name)} · ${d.types.map(t => TYPE_NAMES[t]).join('/')}${d.isPrimary ? ' · 图鉴代表' : ''}</div>
                    <div class="pc-detail-sub">编号 #${escapeHtml(d.uid)} · ${where}</div>
                </div>
            </div>
            <div class="pc-ivs">${ivRows}<span class="pc-iv total"><b>合计</b> ${d.ivTotal}/186（${d.ivPercent}%）</span></div>
            <div class="pc-facts">
                <span>性格：${escapeHtml(d.natureName)}</span>
                <span>特性：${d.ability ? (ABILITY_LABELS[d.ability] || escapeHtml(d.ability)) : '—'}</span>
                <span>性别：${d.gender === 'male' ? '♂ 雄性' : d.gender === 'female' ? '♀ 雌性' : '无/未知'}</span>
                <span>来历：${ORIGIN_LABELS[d.origin] || '未知'}${route ? ' · ' + escapeHtml(route.name) : ''}</span>
                <span>获得日期：${formatCaptureDate(d.caughtAt)}</span>
                <span>战斗：${d.battles} 场</span>
            </div>
            <div class="pc-actions">${actions}</div>`;
    }

    // ---------- 操作 ----------
    _report(result, okMessage) {
        if (result && result.ok) {
            if (okMessage) this.ui.showToast(okMessage);
        } else {
            this.ui.showToast(rosterMessage(result ? result.code : 'unknown'));
        }
        return !!(result && result.ok);
    }

    // 队伍或名册改变后，所有显示它的地方一起刷新
    _refreshAll() {
        this.render();
        this.ui.renderTeam();
        if (this.ui.currentTab === 'tab-pokedex') this.ui.renderPokedex();
    }

    handle(action, data) {
        const g = this.game;
        switch (action) {
            case 'select':
                this.selectedUid = data.uid;
                this.renderParty(); this.renderGrid(); this.renderDetail();
                return;
            case 'box-prev':
                this.search = ''; this.root.querySelector('#pc-search-input').value = '';
                this.boxIndex = Math.max(0, this.boxIndex - 1); this.renderGrid(); return;
            case 'box-next':
                this.search = ''; this.root.querySelector('#pc-search-input').value = '';
                this.boxIndex = Math.min(g.gameState.pc.boxes.length - 1, this.boxIndex + 1); this.renderGrid(); return;
            case 'tidy': {
                const uids = g.previewReleaseDuplicates();
                if (uids.length === 0) { this.ui.showToast('✨ 没有需要整理的重复宝可梦'); return; }
                const ok = window.confirm(`将放生 ${uids.length} 只重复的宝可梦。\n每个物种会保留最强的一只；闪光、有昵称、队伍里的不受影响。\n放生后无法找回，确定吗？`);
                if (!ok) return;
                const r = g.releaseDuplicates();
                this.ui.showToast(`🧹 已放生 ${r.released} 只`);
                this._refreshAll();
                return;
            }
            case 'box-add': {
                const r = g.roster.pc.addBox('');
                if (this._report(r, '已新建箱子')) { this.boxIndex = r.box; g.save(); this.render(); }
                return;
            }
            case 'box-rename': {
                const box = g.gameState.pc.boxes[this.boxIndex];
                const name = box ? window.prompt('箱子名称', box.name) : null;
                if (name !== null && g.roster.pc.renameBox(this.boxIndex, name).ok) { g.save(); this.renderGrid(); }
                return;
            }
            case 'to-party':
                if (this._report(g.partyAdd(data.uid), '已加入队伍')) this._refreshAll();
                return;
            case 'to-pc':
                if (this._report(g.partyRemove(Number(data.index)), '已放回 PC')) this._refreshAll();
                return;
            case 'swap': {
                const sel = this.root.querySelector('#pc-swap-target');
                if (this._report(g.partySwapWithPc(Number(sel ? sel.value : 0), data.uid), '已换下队员')) this._refreshAll();
                return;
            }
            case 'move-box': {
                const sel = this.root.querySelector('#pc-move-target');
                if (this._report(g.pcMoveToBox(data.uid, Number(sel ? sel.value : 0)), '已移动')) this.render();
                return;
            }
            case 'party-up':
            case 'party-down': {
                const i = Number(data.index);
                if (this._report(g.partyReorder(i, action === 'party-up' ? i - 1 : i + 1))) this._refreshAll();
                return;
            }
            case 'party-active':
                g.setActivePokemon(Number(data.index));
                this._refreshAll();
                return;
            case 'rename': {
                const d = g.describeInstance(data.uid);
                if (!d) return;
                const name = window.prompt('昵称（留空恢复物种名，最多 ' + NICKNAME_MAX_LENGTH + ' 字）', d.nickname);
                if (name === null) return;
                if (this._report(g.renamePokemon(data.uid, name), '昵称已更新')) this._refreshAll();
                return;
            }
            case 'release': {
                const d = g.describeInstance(data.uid);
                if (!d) return;
                const ok = window.confirm(`确定放生 ${d.displayName}（Lv.${d.level}，IV ${d.ivPercent}%${d.shiny ? '，闪光' : ''}）吗？\n放生后无法找回。`);
                if (!ok) return;
                if (this._report(g.releasePokemon(data.uid), '已放生')) { this.selectedUid = null; this._refreshAll(); }
                return;
            }
        }
    }
}
