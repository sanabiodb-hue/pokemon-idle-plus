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
            else if (a.cta.tab) cta = `<button class="guide-btn primary" data-guide-action="open-tab" data-tab="${escapeHtml(a.cta.tab)}">${escapeHtml(a.cta.label)}</button>`;
        }
        const skip = a.skippable ? '<button class="guide-btn ghost" data-guide-action="skip" title="跳过新手引导">跳过</button>' : '';
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
            <button class="event-card-close" data-guide-action="close-card" aria-label="关闭">✕</button>`;
        this._positionCards();
        this.cards.appendChild(card);
        while (this.cards.children.length > EVENT_CARD_MAX) this.cards.firstElementChild.remove();
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
        const expText = e.exp > 0 ? `奖励：出战宝可梦获得 ${e.exp} 经验。` : '';
        if (e.kind === 'step') {
            this.showCard({
                icon: '✅', tone: 'success', title: `${e.title} · 完成！`,
                text: `${e.text} ${expText}${e.last ? ' 新手引导完成，接下来跟着上方的目标继续吧！' : ''}`.trim(),
            });
        } else {
            this.showCard({
                icon: '🏆', tone: 'success', title: `目标达成：${e.title}`, text: expText || e.text,
                actions: [{ label: '查看全部目标', action: 'goals' }],
            });
        }
        this.renderBar();
        this.ui.renderTeam();
    }

    onNewSpecies(info) {
        const stats = this.game.getPokedexStats();
        const rec = this.game.getNextAction();
        const tip = rec && rec.type === 'route' ? '' : '新伙伴已放入 PC，可以把它加入队伍。';
        this.showCard({
            icon: info.shiny ? '✨' : '🆕', tone: info.shiny ? 'shiny' : '',
            title: `捕获了新宝可梦：${info.name}${info.shiny ? '（闪光！）' : ''}`,
            text: `图鉴 ${stats.caught}/${stats.total}。${tip}`,
            actions: info.uid ? [{ label: '去 PC 看看', action: 'open-pc', uid: info.uid }] : [],
        });
        this.bumpPcBadge(1);
    }

    onShiny(name) {
        this.showCard({
            icon: '✨', tone: 'shiny', title: `发现闪光 ${name}！`,
            text: '闪光宝可梦出现概率只有约 1/4096，已记入图鉴；它拥有更高的属性。可以在图鉴里切换显示。',
            ttl: 12000,
        });
    }

    onEvolved(data) {
        const text = data.keptLevel
            ? `${data.oldName} 变成了 ${data.newName}，等级保持 Lv.${data.pokemon.level}。个体值、性格都和原来一样。`
            : `${data.oldName} 变成了 ${data.newName}！这是你图鉴里新登记的形态，从 Lv.1 重新成长${data.archivedOld ? `；${data.oldName} 仍保留在图鉴里，继续提供图鉴加成` : ''}。`;
        this.showCard({
            icon: '🌟', tone: 'evolution', title: `${data.oldName} 进化了！`, text,
            actions: [{ label: '看看队伍', action: 'open-tab', tab: 'tab-battle' }], ttl: 12000,
        });
    }

    onRegionUnlocked(data) {
        this.showCard({
            icon: '🎉', tone: 'success', title: `${data.regionName}已解锁！`,
            text: '那里有全新的宝可梦等你收集，去地图选一条道路吧。',
            actions: [{ label: '打开地图', action: 'open-tab', tab: 'tab-map' }], ttl: 12000,
        });
    }

    // ---------- 目标面板 ----------
    showGoals() {
        const goals = this.game.getGoals();
        const rows = goals.map(g => {
            const pct = Math.min(100, Math.round(g.ratio * 100));
            return `<div class="goal-row${g.done ? ' done' : ''}">
                <div class="goal-head"><span>${g.done ? '✅' : g.region ? '🗺️' : '🎯'} ${escapeHtml(g.title)}</span><span class="goal-count">${g.done ? '已完成' : g.current + '/' + g.target}</span></div>
                <div class="goal-desc">${escapeHtml(g.desc)}</div>
                ${g.done ? '' : `<div class="guide-progress"><div class="guide-progress-fill" style="width:${pct}%"></div></div>`}
            </div>`;
        }).join('');
        const doneCount = goals.filter(g => g.done).length;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay goals-overlay';
        overlay.innerHTML = `
            <div class="modal goals-modal" role="dialog" aria-label="目标">
                <h3>🏆 目标（${doneCount}/${goals.length}）</h3>
                <p class="goal-intro">达成目标会自动获得经验奖励。</p>
                <div class="goal-list">${rows}</div>
                <div class="modal-buttons"><button class="confirm-btn goals-close">关闭</button></div>
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
                this.ui.switchTab(data.tab);
                break;
            case 'open-pc':
                this.ui.switchTab('tab-pc');
                if (data.uid && this.ui.pcView) { this.ui.pcView.selectedUid = data.uid; this.ui.pcView.render(); }
                break;
            case 'go-route': {
                const ok = g.changeRoute(data.route);
                if (ok) {
                    const route = g.getRoute(data.route);
                    this.ui.showToast(`📍 前往 ${route ? route.name : '新道路'}`);
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
                if (window.confirm('跳过新手引导？之后仍可以在设置里重新查看。')) {
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
