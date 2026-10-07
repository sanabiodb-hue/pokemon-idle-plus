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
    party_full: '⚠️ Equipe cheia (máximo de 6).',
    last_member: '⚠️ A equipe precisa ter pelo menos 1 Pokémon.',
    active_member: '⚠️ O Pokémon ativo não pode sair da equipe. Ative outro antes.',
    tower_locked: '⚠️ Não dá para mudar a equipe durante a Torre de Desafio.',
    busy: '⚠️ Calculando o progresso offline. Tente de novo em instantes.',
    pc_full: '⚠️ PC cheio.',
    box_full: '⚠️ Esta caixa está cheia.',
    in_party: '⚠️ Quem está na equipe não pode ser liberado. Mova para o PC antes.',
    last_of_species: '⚠️ Mantenha pelo menos 1 de cada espécie.',
    unknown_pokemon: '⚠️ Pokémon não encontrado.',
    already_in_party: '⚠️ Já está na equipe.',
    not_in_pc: '⚠️ Este Pokémon não está no PC.',
    not_in_party: '⚠️ Este Pokémon não está na equipe.',
    bad_index: '⚠️ Posição inválida.',
};

function rosterMessage(code) {
    return ROSTER_MESSAGES[code] || ('⚠️ Não foi possível (' + code + ').');
}

const IV_LABELS = { hp: 'HP', atk: 'Ataque', def: 'Defesa', spAtk: 'Atq. Esp.', spDef: 'Def. Esp.', speed: 'Veloc.' };
const ABILITY_LABELS = { a1: 'Habilidade 1', a2: 'Habilidade 2', ha: 'Habilidade oculta' };
const ORIGIN_LABELS = {
    starter: 'Inicial', wild: 'Capturado em rota', evolution: 'Evolução', legacy_migration: 'Save antigo',
    egg: 'Chocado', gift: 'Presente', debug: 'Debug', unknown: 'Desconhecido',
};

// 新存档/旧存档里默认箱子名是“箱子 N”（存档数据不改），界面上显示成“Caixa N”
function boxDisplayName(name) {
    const m = /^箱子 (\d+)$/.exec(String(name));
    return m ? 'Caixa ' + m[1] : String(name);
}

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
            <h2>🖥️ PC e Equipe <span id="pc-summary" class="pc-summary"></span></h2>
            <div class="pc-section">
                <h3>⚔️ Equipe <span id="pc-party-count"></span></h3>
                <div id="pc-party" class="pc-party"></div>
            </div>
            <div class="pc-section">
                <div class="pc-box-bar">
                    <button class="setting-btn" data-pc-action="box-prev" title="Caixa anterior">◀</button>
                    <span id="pc-box-title" class="pc-box-title"></span>
                    <button class="setting-btn" data-pc-action="box-next" title="Próxima caixa">▶</button>
                    <button class="setting-btn" data-pc-action="box-rename" title="Renomear esta caixa">✏️ Renomear</button>
                    <button class="setting-btn" data-pc-action="box-add" title="Criar caixa">➕ Nova caixa</button>
                    <button class="setting-btn" data-pc-action="tidy" title="Mantém só o mais forte de cada espécie (shiny, com apelido e da equipe ficam)">🧹 Limpar duplicatas</button>
                </div>
                <input type="text" id="pc-search-input" class="pc-search" placeholder="🔍 Buscar no PC (nome, apelido ou número)" autocomplete="off">
                <div id="pc-grid" class="pc-grid"></div>
            </div>
            <div class="pc-section">
                <h3>📋 Detalhes</h3>
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
            `${ptNumber(r.count())} Pokémon · PC ${r.pc.count()}/${r.pc.totalCapacity()}${r.hasRoom() ? '' : ' · ⚠️ PC cheio: novos Pokémon não podem ser capturados'}`;
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
            ? `<div class="pc-empty">${ptPlural(free, 'Falta', 'Faltam')} ${free} ${ptPlural(free, 'vaga', 'vagas')}: ${this.game.roster.pc.count() > 0 ? 'toque em um Pokémon nas caixas abaixo e depois em “Adicionar à equipe”. Quem está na equipe ganha EXP junto.' : 'continue batalhando: os Pokémon capturados aparecem nas caixas abaixo.'}</div>`
            : '';
        const html = gs.party.map((uid, i) => {
            const d = this.game.describeInstance(uid);
            if (!d) return '';
            const isActive = i === gs.activePokemonIndex;
            return `<div class="pc-party-slot${isActive ? ' active' : ''}">
                ${this._card(d)}
                <div class="pc-party-actions">
                    <button data-pc-action="party-up" data-index="${i}" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>
                    <button data-pc-action="party-down" data-index="${i}" ${i === gs.party.length - 1 ? 'disabled' : ''} title="Descer">▼</button>
                    <button data-pc-action="party-active" data-index="${i}" ${isActive ? 'disabled' : ''}>${isActive ? '⚔️ Em batalha' : 'Ativar'}</button>
                    <button data-pc-action="to-pc" data-index="${i}" ${isActive || gs.party.length <= 1 ? 'disabled' : ''}>Mover p/ PC</button>
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
            title.textContent = `🔍 Resultados da busca`;
            const found = this.game.roster.pc.uids()
                .map(uid => this.game.describeInstance(uid))
                .filter(d => d && this._matches(d, this.search))
                .sort((a, b) => a.speciesId - b.speciesId || b.level - a.level);
            grid.innerHTML = found.length
                ? found.map(d => this._card(d)).join('')
                : '<div class="pc-empty">Nenhum Pokémon encontrado.</div>';
            return;
        }
        if (!box) { grid.innerHTML = ''; return; }
        const used = box.slots.filter(u => u !== null).length;
        title.textContent = `📦 ${boxDisplayName(box.name)} (${this.boxIndex + 1}/${boxes.length}) ${used}/${box.capacity}`;
        if (used === 0) {
            const total = this.game.roster.pc.count();
            grid.innerHTML = `<div class="pc-empty">${total === 0
                ? 'O PC está vazio. Quando você capturar Pokémon, eles vêm para cá.'
                : 'Esta caixa está vazia. Toque em ▶ para ver as outras.'}</div>`;
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
        if (!d) { el.innerHTML = '<div class="pc-empty">Toque em um Pokémon acima para ver os detalhes.</div>'; return; }
        const gs = this.game.gameState;
        const route = d.originRoute ? this.game.getRoute(d.originRoute) : null;
        const ivRows = IV_KEYS.map(k => `<span class="pc-iv"><b>${IV_LABELS[k]}</b> ${d.ivs[k]}</span>`).join('');
        const where = d.where === 'party' ? `Equipe, posição ${d.partyIndex + 1}`
            : d.where === 'pc' ? `PC · ${escapeHtml(boxDisplayName(gs.pc.boxes[d.box].name))}, espaço ${d.slot + 1}` : '—';
        let actions = '';
        if (d.where === 'pc') {
            const members = gs.party.map((uid, i) => {
                const m = this.game.describeInstance(uid);
                return m ? `<option value="${i}">${i + 1}. ${escapeHtml(m.displayName)} Lv.${m.level} #${escapeHtml(m.uid)}</option>` : '';
            }).join('');
            const boxOptions = gs.pc.boxes.map((b, i) =>
                `<option value="${i}" ${i === d.box ? 'selected' : ''}>${escapeHtml(boxDisplayName(b.name))}</option>`).join('');
            actions += `<button class="setting-btn" data-pc-action="to-party" data-uid="${escapeHtml(d.uid)}">➕ Adicionar à equipe</button>
                <span class="pc-inline"><select id="pc-swap-target">${members}</select>
                <button class="setting-btn" data-pc-action="swap" data-uid="${escapeHtml(d.uid)}">🔄 Trocar por este membro</button></span>
                <span class="pc-inline"><select id="pc-move-target">${boxOptions}</select>
                <button class="setting-btn" data-pc-action="move-box" data-uid="${escapeHtml(d.uid)}">📦 Mover para a caixa</button></span>`;
        } else if (d.where === 'party') {
            actions += `<button class="setting-btn" data-pc-action="to-pc" data-index="${d.partyIndex}">⬇️ Mover para o PC</button>`;
        }
        actions += `<button class="setting-btn" data-pc-action="rename" data-uid="${escapeHtml(d.uid)}">✏️ Apelido</button>`;
        if (d.where === 'pc') actions += `<button class="setting-btn danger" data-pc-action="release" data-uid="${escapeHtml(d.uid)}">Liberar</button>`;
        el.innerHTML = `<div class="pc-detail-head">
                <div class="pc-card-sprite big">${this._spriteFor(d)}</div>
                <div>
                    <div class="pc-detail-name">${d.shiny ? '✨ ' : ''}${escapeHtml(d.displayName)} ${genderSymbol(d.gender)}
                        <small>Lv.${d.level}</small></div>
                    <div class="pc-detail-sub">${escapeHtml(d.name)} · ${d.types.map(t => TYPE_NAMES[t]).join('/')}${d.isPrimary ? ' · Principal da Pokédex' : ''}</div>
                    <div class="pc-detail-sub">ID #${escapeHtml(d.uid)} · ${where}</div>
                </div>
            </div>
            <div class="pc-ivs">${ivRows}<span class="pc-iv total"><b>Total</b> ${d.ivTotal}/186 (${d.ivPercent}%)</span></div>
            <div class="pc-facts">
                <span>Natureza: ${escapeHtml(d.natureName)}</span>
                <span>Habilidade: ${d.ability ? (ABILITY_LABELS[d.ability] || escapeHtml(d.ability)) : '—'}</span>
                <span>Gênero: ${d.gender === 'male' ? '♂ Macho' : d.gender === 'female' ? '♀ Fêmea' : 'Sem gênero'}</span>
                <span>Origem: ${ORIGIN_LABELS[d.origin] || 'Desconhecida'}${route ? ' · ' + escapeHtml(route.name) : ''}</span>
                <span>Obtido em: ${formatCaptureDate(d.caughtAt)}</span>
                <span>Batalhas: ${ptNumber(d.battles)}</span>
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
                if (uids.length === 0) { this.ui.showToast('✨ Não há duplicatas para limpar.'); return; }
                const ok = window.confirm(`Liberar ${uids.length} ${ptPlural(uids.length, 'Pokémon duplicado', 'Pokémon duplicados')}?\nSó o mais forte de cada espécie fica. Shiny, com apelido e da equipe ficam.\nNão dá para desfazer.`);
                if (!ok) return;
                const r = g.releaseDuplicates();
                this.ui.showToast(`🧹 ${r.released} ${ptPlural(r.released, 'liberado', 'liberados')}`);
                this._refreshAll();
                return;
            }
            case 'box-add': {
                const r = g.roster.pc.addBox('');
                if (this._report(r, 'Caixa criada')) { this.boxIndex = r.box; g.save(); this.render(); }
                return;
            }
            case 'box-rename': {
                const box = g.gameState.pc.boxes[this.boxIndex];
                const name = box ? window.prompt('Nome da caixa', boxDisplayName(box.name)) : null;
                if (name !== null && g.roster.pc.renameBox(this.boxIndex, name).ok) { g.save(); this.renderGrid(); }
                return;
            }
            case 'to-party':
                if (this._report(g.partyAdd(data.uid), 'Adicionado à equipe')) this._refreshAll();
                return;
            case 'to-pc':
                if (this._report(g.partyRemove(Number(data.index)), 'Movido para o PC')) this._refreshAll();
                return;
            case 'swap': {
                const sel = this.root.querySelector('#pc-swap-target');
                if (this._report(g.partySwapWithPc(Number(sel ? sel.value : 0), data.uid), 'Troca feita')) this._refreshAll();
                return;
            }
            case 'move-box': {
                const sel = this.root.querySelector('#pc-move-target');
                if (this._report(g.pcMoveToBox(data.uid, Number(sel ? sel.value : 0)), 'Movido')) this.render();
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
                const name = window.prompt('Apelido (deixe vazio para usar o nome da espécie; máx. ' + NICKNAME_MAX_LENGTH + ' letras)', d.nickname);
                if (name === null) return;
                if (this._report(g.renamePokemon(data.uid, name), 'Apelido atualizado')) this._refreshAll();
                return;
            }
            case 'release': {
                const d = g.describeInstance(data.uid);
                if (!d) return;
                const ok = window.confirm(`Liberar ${d.displayName} (Lv.${d.level}, IV ${d.ivPercent}%${d.shiny ? ', shiny' : ''})?\nNão dá para desfazer.`);
                if (!ok) return;
                if (this._report(g.releasePokemon(data.uid), 'Pokémon liberado')) { this.selectedUid = null; this._refreshAll(); }
                return;
            }
        }
    }
}
