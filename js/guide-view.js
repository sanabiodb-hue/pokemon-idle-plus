// ============================================================
// 引导与反馈界面（GuideView）
//
//   - 下一步条（#guide-bar）：战斗页顶部一行，永远回答“我现在该做什么”。引导期显示步骤 + 进度 + 一键入口，
//     之后显示“当前道路抓齐了去哪”“快进化了”“最接近的目标”。
//   - 事件卡片：重要的事（新物种/闪光/进化/地区解锁/目标达成）用底部卡片告诉玩家
//     “发生了什么 + 为什么重要 + 现在可以做什么”，而不是只往战斗日志里塞一行。
//   - 目标面板：全部里程碑的进度。
//   - PC 页签上的“新”提示、被推荐的页签脉冲高亮。
// 只读 GameCore 的 getNextAction / getGoals 等；所有改动走 game.*。
// ============================================================
const EVENT_CARD_MAX = 2;
const EVENT_CARD_TTL_MS = 7000;

class GuideView {
    constructor(ui) {
        this.ui = ui;
        this.game = ui.game;
        this.bar = document.getElementById('guide-bar');
        this._barHtml = '';
        this._pcNew = 0;
        this.cards = document.createElement('div');
        this.cards.id = 'event-cards';
        this.cards.setAttribute('aria-live', 'polite');
        document.body.appendChild(this.cards);
        const onClick = (e) => {
            const el = e.target.closest('[data-guide-action]');
            if (el) this.handle(el.dataset.guideAction, el.dataset, el);
        };
        if (this.bar) this.bar.addEventListener('click', onClick);
        this.cards.addEventListener('click', onClick);
    }

    // ---------- 下一步条 ----------
    renderBar() {
        if (!this.bar || !this.game.gameState) return;
        const a = this.game.getNextAction();
        if (!a) { this.bar.classList.add('hidden'); return; }
        const pct = a.progress && a.progress.total ? Math.min(100, Math.round(a.progress.current / a.progress.total * 100)) : null;
        const head = a.type === 'onboarding' ? `<span class="guide-step">${a.stepNo}/${a.stepTotal}</span> ` : '';
        let cta = '';
        if (a.cta) {
            if (a.cta.route) cta = `<button class="guide-btn primary" data-guide-action="go-route" data-route="${escapeHtml(a.cta.route)}">${escapeHtml(a.cta.label)}</button>`;
            else if (a.cta.goals) cta = `<button class="guide-btn" data-guide-action="goals">${escapeHtml(a.cta.label)}</button>`;
            else if (a.cta.tab) cta = `<button class="guide-btn primary" data-guide-action="open-tab" data-target="${escapeHtml(a.cta.tab)}">${escapeHtml(a.cta.label)}</button>`;
        }
        const skip = a.skippable ? '<button class="guide-btn ghost" data-guide-action="skip" title="Pular o tutorial">Pular</button>' : '';
        const html = `
            <span class="guide-icon">${a.icon}</span>
            <div class="guide-main">
                <div class="guide-title">${head}${escapeHtml(a.title)}</div>
                <div class="guide-text">${escapeHtml(a.text)}</div>
                ${pct !== null ? `<div class="guide-progress" title="${a.progress.current}/${a.progress.total}"><div class="guide-progress-fill" style="width:${pct}%"></div><span>${a.progress.label ? escapeHtml(a.progress.label) + ' ' : ''}${a.progress.current}/${a.progress.total}</span></div>` : ''}
            </div>
            <div class="guide-actions">${cta}${skip}</div>`;
        if (html !== this._barHtml) {
            this._barHtml = html;
            this.bar.innerHTML = html;
        }
        this.bar.className = `guide-bar guide-${a.type}`;
        this.updateTabPulse(a);
    }

    // 被推荐的页签轻轻脉冲，指向“下一步去哪”
    updateTabPulse(a) {
        const want = a && a.type === 'onboarding' && a.cta && a.cta.tab ? a.cta.tab : (a && a.type === 'route' ? 'tab-map' : null);
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('guide-pulse', b.dataset.tab === want && this.ui.currentTab !== want));
    }

    // PC 页签上的“新伙伴”数量
    bumpPcBadge(n = 1) {
        this._pcNew += n;
        this._renderPcBadge();
    }

    clearPcBadge() {
        this._pcNew = 0;
        this._renderPcBadge();
    }

    _renderPcBadge() {
        const btn = document.querySelector('.tab-btn[data-tab="tab-pc"]');
        if (!btn) return;
        let dot = btn.querySelector('.tab-dot');
        if (this._pcNew > 0) {
            if (!dot) { dot = document.createElement('span'); dot.className = 'tab-dot'; btn.appendChild(dot); }
            dot.textContent = this._pcNew > 9 ? '9+' : String(this._pcNew);
        } else if (dot) {
            dot.remove();
        }
    }

    // ---------- 事件卡片 ----------
    // opts：{ icon, title, text, tone, actions: [{ label, action, ...data }], ttl }
    showCard(opts) {
        const card = document.createElement('div');
        card.className = `event-card ${opts.tone || ''}`;
        const actions = (opts.actions || []).map(a => {
            const data = Object.entries(a).filter(([k]) => !['label', 'action'].includes(k))
                .map(([k, v]) => ` data-${k}="${escapeHtml(v)}"`).join('');
            return `<button class="guide-btn primary" data-guide-action="${escapeHtml(a.action)}"${data}>${escapeHtml(a.label)}</button>`;
        }).join('');
        card.innerHTML = `
            <div class="event-card-icon">${opts.icon || '✨'}</div>
            <div class="event-card-body">
                <div class="event-card-title">${escapeHtml(opts.title)}</div>
                <div class="event-card-text">${escapeHtml(opts.text || '')}</div>
                ${actions ? `<div class="event-card-actions">${actions}</div>` : ''}
            </div>
            <button class="event-card-close" data-guide-action="close-card" aria-label="Fechar">✕</button>`;
        this._positionCards();
        this.cards.appendChild(card);
        if (opts.keep) card.dataset.keep = '1';
        // 超出数量时先去掉“步骤完成”这类次要卡片，保留发现/进化/闪光等重要卡片
        while (this.cards.children.length > EVENT_CARD_MAX) {
            const minor = [...this.cards.children].find(c => !c.dataset.keep);
            (minor || this.cards.firstElementChild).remove();
        }
        const ttl = opts.ttl || EVENT_CARD_TTL_MS;
        setTimeout(() => card.remove(), ttl);
        return card;
    }

    _positionCards() {
        const nav = document.getElementById('tab-nav');
        this.cards.style.bottom = ((nav ? nav.offsetHeight : 60) + 8) + 'px';
    }

    // ---------- 游戏事件 → 卡片 ----------
    onGuideEvent(e) {
        const expText = e.exp > 0 ? `Recompensa: o Pokémon ativo ganhou ${ptNumber(e.exp)} EXP.` : '';
        if (e.kind === 'step') {
            this.showCard({
                icon: '✅', tone: 'success', title: `${e.title} · Feito!`,
                text: `${e.text} ${expText}${e.last ? ' Tutorial concluído! Agora siga as metas no topo.' : ''}`.trim(),
            });
        } else {
            this.showCard({
                icon: '🏆', tone: 'success', title: `Meta concluída: ${e.title}`, text: expText || e.text,
                actions: [{ label: 'Ver todas as metas', action: 'goals' }],
            });
        }
        this.renderBar();
        this.ui.renderTeam();
    }

    onNewSpecies(info) {
        const stats = this.game.getPokedexStats();
        const rec = this.game.getNextAction();
        const tip = rec && rec.type === 'route' ? '' : 'O novo Pokémon foi para o PC. Você pode adicioná-lo à equipe.';
        this.showCard({
            icon: info.shiny ? '✨' : '🆕', tone: info.shiny ? 'shiny' : '', keep: true,
            title: `Novo Pokémon: ${info.name}${info.shiny ? ' (Shiny!)' : ''}`,
            text: `Pokédex ${stats.caught}/${stats.total}. ${tip}`,
            actions: info.uid ? [{ label: 'Ver no PC', action: 'open-pc', uid: info.uid }] : [],
        });
        this.bumpPcBadge(1);
    }

    onShiny(name) {
        this.showCard({
            icon: '✨', tone: 'shiny', keep: true, title: `Você achou um ${name} Shiny!`,
            text: 'Shiny aparecem em cerca de 1 a cada 4096 encontros. Ele já está na Pokédex e tem atributos maiores. Dá para alternar a aparência na Pokédex.',
            ttl: 12000,
        });
    }

    onEvolved(data) {
        const text = data.keptLevel
            ? `${data.oldName} virou ${data.newName} e mantém o Lv.${data.pokemon.level}. IVs e natureza continuam os mesmos.`
            : `${data.oldName} virou ${data.newName}! Forma nova na sua Pokédex: ela volta para o Lv.1${data.archivedOld ? `, e ${data.oldName} continua na Pokédex dando bônus` : ''}.`;
        this.showCard({
            icon: '🌟', tone: 'evolution', keep: true, title: `${data.oldName} evoluiu!`, text,
            actions: [{ label: 'Ver equipe', action: 'open-tab', target: 'tab-battle' }], ttl: 12000,
        });
    }

    onRegionUnlocked(data) {
        this.showCard({
            icon: '🎉', tone: 'success', keep: true, title: `${data.regionName} desbloqueada!`,
            text: 'Há Pokémon novos para capturar lá. Abra o Mapa e escolha uma rota.',
            actions: [{ label: 'Abrir Mapa', action: 'open-tab', target: 'tab-map' }], ttl: 12000,
        });
    }

    // ---------- 目标面板 ----------
    showGoals() {
        const goals = this.game.getGoals();
        const rows = goals.map(g => {
            const pct = Math.min(100, Math.round(g.ratio * 100));
            return `<div class="goal-row${g.done ? ' done' : ''}">
                <div class="goal-head"><span>${g.done ? '✅' : g.region ? '🗺️' : '🎯'} ${escapeHtml(g.title)}</span><span class="goal-count">${g.done ? 'Concluída' : ptNumber(g.current) + '/' + ptNumber(g.target)}</span></div>
                <div class="goal-desc">${escapeHtml(g.desc)}</div>
                ${g.done ? '' : `<div class="guide-progress"><div class="guide-progress-fill" style="width:${pct}%"></div></div>`}
            </div>`;
        }).join('');
        const doneCount = goals.filter(g => g.done).length;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay goals-overlay';
        overlay.innerHTML = `
            <div class="modal goals-modal" role="dialog" aria-label="Metas">
                <h3>🏆 Metas (${doneCount}/${goals.length})</h3>
                <p class="goal-intro">Ao concluir uma meta, você ganha EXP automaticamente.</p>
                <div class="goal-list">${rows}</div>
                <div class="modal-buttons"><button class="confirm-btn goals-close">Fechar</button></div>
            </div>`;
        const close = () => overlay.remove();
        overlay.querySelector('.goals-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.body.appendChild(overlay);
    }

    // ---------- 点击 ----------
    handle(action, data, el) {
        const g = this.game;
        switch (action) {
            case 'open-tab':
                this.ui.switchTab(data.target);
                break;
            case 'open-pc':
                this.ui.switchTab('tab-pc');
                if (data.uid && this.ui.pcView) { this.ui.pcView.selectedUid = data.uid; this.ui.pcView.render(); }
                break;
            case 'go-route': {
                const ok = g.changeRoute(data.route);
                if (ok) {
                    const route = g.getRoute(data.route);
                    this.ui.showToast(`📍 Indo para ${route ? route.name : 'a nova rota'}`);
                    if (route) {
                        for (const rid in REGIONS) if (REGIONS[rid].routes.some(r => r.id === data.route)) g.changeRegion(rid);
                    }
                    if (this.ui.currentTab === 'tab-map') this.ui.renderMap();
                }
                this.renderBar();
                break;
            }
            case 'goals':
                this.showGoals();
                break;
            case 'skip':
                if (window.confirm('Pular o tutorial? Você pode revê-lo depois em Configurações.')) {
                    g.guideSkipOnboarding();
                    this.renderBar();
                }
                break;
            case 'close-card':
                if (el && el.closest('.event-card')) el.closest('.event-card').remove();
                break;
        }
    }
}
