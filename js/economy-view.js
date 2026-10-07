// ============================================================
// 经济界面（Loja / Upgrades / Análise），住在"Caça"页签里的三个分区（由 HuntView 负责分区导航和生命周期）
//
// 只负责"把核心的数据画出来、把按钮转成核心请求"：
//   - 买药水          → game.buyPotions(n)
//   - 买升级          → game.buyUpgrade(id)
//   - 改目标 / 选路线 → game.setAnalyzerGoal(g) / game.selectHuntRoute(id, 'comparison')
// 价格、效果、推荐、估算都来自核心；这里不做任何经济计算。
// 路线估算按条分片执行（每条之间让出主线程），不在渲染里同步算几百毫秒。
// ============================================================

const ECO_GOAL_LABELS = { xp: 'XP', money: 'Dinheiro', captures: 'Capturas', shiny: 'Shiny' };
const ECO_BUILD_LABELS = { support: 'Apoio', xp: 'Build XP', money: 'Build Dinheiro', speed: 'Build Velocidade' };
const ECO_ERRORS = {
    insufficient_funds: 'Moedas insuficientes.',
    capacity_full: 'Seu estoque de poções já está cheio.',
    locked: 'Esse upgrade ainda está bloqueado.',
    max_level: 'Esse upgrade já está no nível máximo.',
    busy: 'Aguarde o cálculo offline terminar.',
    invalid_quantity: 'Quantidade inválida.',
    unknown_item: 'Item desconhecido.',
    unknown_upgrade: 'Upgrade desconhecido.',
};

function ecoMoney(n) { return '$' + ptNumber(Math.round(n)); }
function ecoRate(n) { return n >= 1e4 ? ptNumber(Math.round(n)) : (Math.round(n * 10) / 10).toLocaleString('pt-BR'); }

class EconomyView {
    constructor(ui, hunt) {
        this.ui = ui;
        this.hunt = hunt;
        this.game = ui.game;
        this._estimateToken = 0;
        this._estimating = null;      // { done, total }
    }

    get root() { return this.hunt.root; }

    // ---------- Recursos (sempre visível no topo da aba) ----------
    renderResources() {
        const el = this.root.querySelector('#hunt-resources');
        if (!el) return;
        const g = this.game;
        el.innerHTML = `<span class="hunt-res">💰 <strong data-eco-money>${ecoMoney(g.getMoney())}</strong></span>
            <span class="hunt-res">🧪 <strong data-eco-potions>${ptNumber(g.getPotions())}</strong>/${ptNumber(g.getPotionCapacity())}</span>`;
    }

    // atualização barata (chamada a cada segundo)
    tickResources() {
        const g = this.game;
        const m = this.root.querySelector('[data-eco-money]');
        if (m) m.textContent = ecoMoney(g.getMoney());
        const p = this.root.querySelector('[data-eco-potions]');
        if (p) p.textContent = ptNumber(g.getPotions());
    }

    // ---------- Loja ----------
    renderShop() {
        const el = this.root.querySelector('#hunt-shop');
        if (!el) return;
        const g = this.game;
        const items = g.getShopItems().map(it => {
            const packs = it.packs.map(n => {
                const qty = Math.min(n, it.room);
                const total = qty * it.price;
                const can = qty > 0 && g.canAfford(total);
                return `<button class="hunt-btn small" data-eco-action="buy-item" data-item="${escapeHtml(it.id)}" data-qty="${n}"${can ? '' : ' disabled'}>Comprar ${n}<small>${qty > 0 ? ecoMoney(total) : 'cheio'}</small></button>`;
            }).join('');
            return `<div class="hunt-shop-item">
                <div class="hunt-shop-head"><span class="hunt-shop-icon">${it.icon}</span><div><strong>${escapeHtml(it.name)}</strong><div class="hunt-hint">${escapeHtml(it.description)}</div></div></div>
                <div class="hunt-shop-meta"><span>Preço: <strong>${ecoMoney(it.price)}</strong> cada</span><span>Estoque: <strong>${ptNumber(it.stock)}/${ptNumber(it.capacity)}</strong></span></div>
                <div class="hunt-buttons">${packs}</div>
            </div>`;
        }).join('');
        el.innerHTML = `
            <h3>🛒 Loja</h3>
            ${items}
            <div class="hunt-hint">O preço sobe junto com o seu progresso (maior nível já alcançado: ${ptNumber(g.getProgressLevel())}). O estoque cresce com o upgrade Capacidade de Poções.</div>`;
    }

    // ---------- Upgrades ----------
    renderUpgrades() {
        const el = this.root.querySelector('#hunt-upgrades');
        if (!el) return;
        const cards = this.game.getUpgradeCatalog().map(u => {
            let action;
            if (u.maxed) action = '<div class="hunt-upg-max">Nível máximo ✓</div>';
            else if (u.locked) action = `<div class="hunt-hint">🔒 Requer: ${u.missing.map(m => `${escapeHtml(m.name)} nv. ${m.level} (você tem ${m.have})`).join(' e ')}</div>`;
            else action = `<div class="hunt-upg-deal">Gastar <strong>${ecoMoney(u.cost)}</strong> para ir de <strong>${escapeHtml(u.effectNow)}</strong> para <strong>${escapeHtml(u.effectNext)}</strong></div>
                <button class="hunt-btn small primary" data-eco-action="buy-upgrade" data-id="${escapeHtml(u.id)}"${u.affordable ? '' : ' disabled'}>Comprar · ${ecoMoney(u.cost)}</button>`;
            return `<div class="hunt-upg${u.locked ? ' locked' : ''}">
                <div class="hunt-upg-head"><span class="hunt-shop-icon">${u.icon}</span>
                    <div><strong>${escapeHtml(u.name)}</strong> <span class="hunt-tag-build b-${escapeHtml(u.build)}">${ECO_BUILD_LABELS[u.build] || ''}</span>
                    <div class="hunt-hint">${escapeHtml(u.description)}</div></div></div>
                <div class="hunt-upg-level">Nv. <strong>${u.level}</strong>/${u.maxLevel}${u.level > 0 ? ` · ${escapeHtml(u.effectNow)}` : ''}</div>
                ${action}
            </div>`;
        }).join('');
        el.innerHTML = `<h3>⬆️ Upgrades</h3>${cards}
            <div class="hunt-hint">Os preços acompanham o seu progresso. Os upgrades de apoio (Cura e Capacidade) liberam os três estilos: XP, Dinheiro e Velocidade.</div>`;
    }

    // ---------- Análise ----------
    _metricCell(label, value) { return `<div class="hunt-metric"><span class="hunt-metric-value">${value}</span><span class="hunt-metric-label">${label}</span></div>`; }

    renderAnalysis() {
        const el = this.root.querySelector('#hunt-analysis');
        if (!el) return;
        const g = this.game;
        const goal = g.getAnalyzerGoal();
        const goals = Object.keys(ECO_GOAL_LABELS).map(k => `<button class="hunt-seg${k === goal ? ' active' : ''}" data-eco-action="set-goal" data-goal="${k}">${ECO_GOAL_LABELS[k]}</button>`).join('');

        // métricas da caçada atual / mais recente
        const a = g.getHuntAnalysis();
        let metrics = '<div class="hunt-hint">Inicie uma caçada para ver XP/h, dinheiro/h e o resto das métricas aqui.</div>';
        if (a && a.rates.sampleMs > 0) {
            const r = a.rates;
            const eff = Math.round(r.winRate);
            metrics = `<div class="hunt-metrics">
                ${this._metricCell('XP/h', ecoRate(r.xpPerHour))}
                ${this._metricCell('Dinheiro/h', ecoRate(r.moneyPerHour))}
                ${this._metricCell('Capturas/h', ecoRate(r.capturesPerHour))}
                ${this._metricCell('Shinies/h', ecoRate(r.shiniesPerHour))}
                ${this._metricCell('Poções/h', ecoRate(r.potionsPerHour))}
                ${this._metricCell('Custo de cura/h', ecoMoney(r.healCostPerHour))}
                ${this._metricCell('Lucro/h', (r.profitPerHour < 0 ? '−' : '') + ecoMoney(Math.abs(r.profitPerHour)))}
                ${this._metricCell('Vitórias', eff + '%')}
                ${this._metricCell('Eficiência', ecoRate(r.xpPerHour) + ' EXP/h')}
            </div>`;
        }

        // comparação de rotas (real + estimado em cache)
        const cmp = g.compareRoutes({ estimate: 'cached' });
        const rec = g.recommendRouteForGoal(goal, cmp);
        if (rec && !rec.none) g.noteRouteRecommended(rec);
        const best = (k, label) => {
            const b = cmp.best[k];
            const row = b ? cmp.rows.find(r => r.routeId === b.routeId) : null;
            return `<div class="hunt-best"><span>${label}</span><strong>${row ? escapeHtml(row.name) : '—'}</strong></div>`;
        };
        const rows = cmp.rows.map(r => this._routeCard(r, goal)).join('');
        const progress = this._estimating ? `<div class="hunt-hint">Estimando rotas… ${this._estimating.done}/${this._estimating.total}</div>` : '';
        const recHtml = rec && rec.none
            ? `<div class="hunt-rec">${escapeHtml(rec.text)}</div>`
            : `<div class="hunt-rec">⭐ <strong>Recomendação (objetivo: ${ECO_GOAL_LABELS[goal]}):</strong> ${escapeHtml(rec.name)}<br>${escapeHtml(rec.text)}
                <button class="hunt-link" data-eco-action="use-route" data-id="${escapeHtml(rec.routeId)}">Usar essa rota</button></div>`;

        const history = g.getHuntHistory().map(h => {
            const label = g._routeLabel(h.routeId);
            const reason = h.stopReason && h.stopReason !== 'manual' ? ` · ${escapeHtml(this._reasonShort(h))}` : '';
            return `<li><strong>${escapeHtml(label ? label.name : h.routeId)}</strong> · ${escapeHtml(huntFormatDuration(h.ms))}${reason}<br>
                +${ptNumber(h.xp)} XP · ${ecoMoney(h.money)} · ${ptNumber(h.captures)} ${ptPlural(h.captures, 'captura', 'capturas')}${h.shinies ? ` · ✨${h.shinies}` : ''}</li>`;
        }).join('');

        el.innerHTML = `
            <h3>📊 Análise</h3>
            <div class="hunt-sub">Objetivo</div>
            <div class="hunt-segs">${goals}</div>
            ${metrics}
            <h3>🧭 Comparar rotas</h3>
            ${recHtml}
            <div class="hunt-bests">${best('xp', 'Melhor XP')}${best('money', 'Melhor dinheiro')}${best('captures', 'Melhor captura')}</div>
            <button class="hunt-btn small" data-eco-action="estimate"${this._estimating ? ' disabled' : ''}>${this._estimating ? 'Estimando…' : '🔄 Estimar rotas'}</button>
            ${progress}
            <div class="hunt-route-cards">${rows}</div>
            <div class="hunt-hint">"Real" vem das suas caçadas (pelo menos ${Math.round(g.getEconomyConfig().analyzer.minSampleMs / 60000)} min na rota). "Estimado" é uma simulação rápida de ${Math.round(g.getEconomyConfig().compare.estimateMs / 60000)} min com a sua equipe e upgrades atuais. A recomendação nunca troca a rota sozinha.</div>
            <h3>🕘 Últimas caçadas</h3>
            ${history ? `<ul class="hunt-activity">${history}</ul>` : '<div class="hunt-hint">Suas caçadas encerradas aparecem aqui para você comparar.</div>'}`;
    }

    _reasonShort(h) {
        const fake = { stopReason: h.stopReason, stats: { battles: h.battles }, policy: this.game.getAutomationPolicy() };
        return huntStopReasonShort(fake);
    }

    _routeCard(r, goal) {
        const badge = r.source === 'real' ? '<span class="hunt-badge-src real">Real</span>' : r.source === 'estimated' ? '<span class="hunt-badge-src est">Estimado</span>' : '<span class="hunt-badge-src none">Sem dados</span>';
        const lv = r.levelRange ? ` · Nv. ${r.levelRange[0]}–${r.levelRange[1]}` : '';
        let body;
        if (!r.rates) body = '<div class="hunt-hint">Toque em “Estimar rotas” para ver os números.</div>';
        else {
            const x = r.rates;
            body = `<div class="hunt-route-metrics">
                <span>XP/h <strong>${ecoRate(x.xpPerHour)}</strong></span><span>Dinheiro/h <strong>${ecoRate(x.moneyPerHour)}</strong></span>
                <span>Capturas/h <strong>${ecoRate(x.capturesPerHour)}</strong></span><span>Lucro/h <strong>${x.profitPerHour < 0 ? '−' : ''}${ecoRate(Math.abs(x.profitPerHour))}</strong></span>
                <span>Poções/h <strong>${ecoRate(x.potionsPerHour)}</strong></span><span>Vitórias <strong>${Math.round(x.winRate)}%</strong></span></div>`;
        }
        const warns = r.warnings.map(w => `<div class="hunt-warn">⚠️ ${escapeHtml(w.text)}</div>`).join('');
        const use = r.current ? '<span class="hunt-badge-src cur">Rota atual</span>' : `<button class="hunt-link" data-eco-action="use-route" data-id="${escapeHtml(r.routeId)}" data-risky="${r.warnings.length ? 1 : 0}">Usar</button>`;
        return `<div class="hunt-route-card${r.current ? ' current' : ''}">
            <div class="hunt-route-card-head"><strong>${escapeHtml(r.regionName)} · ${escapeHtml(r.name)}</strong>${lv} ${badge} ${use}</div>${body}${warns}</div>`;
    }

    // ---------- Estimativas em fatias ----------
    startEstimate() {
        const g = this.game;
        const token = ++this._estimateToken;
        const ids = g.getCandidateRoutes().filter(id => !g.getRouteMetrics(id, 'cached'));
        if (!ids.length) { this._estimating = null; this.renderAnalysis(); return; }
        this._estimating = { done: 0, total: ids.length };
        this.renderAnalysis();
        const step = () => {
            if (token !== this._estimateToken) return;                  // cancelado (aba trocada / nova estimativa)
            const id = ids[this._estimating.done];
            if (id === undefined) { this._estimating = null; this.renderAnalysis(); return; }
            g.estimateRoute(id);
            this._estimating.done++;
            this.renderAnalysis();
            setTimeout(step, 15);
        };
        setTimeout(step, 15);
    }

    cancelEstimate() {
        this._estimateToken++;
        this._estimating = null;
    }

    // ---------- Ações ----------
    _result(r, okText) {
        if (r && r.ok === false) this.ui.showToast(`⚠️ ${ECO_ERRORS[r.code] || r.message || 'Não foi possível.'}`);
        else if (okText) this.ui.showToast(okText);
        this.hunt.renderSection();
        this.renderResources();
    }

    handleAction(action, data) {
        const g = this.game;
        switch (action) {
            case 'buy-item': {
                const r = g.buyShopItem(data.item, Number(data.qty));
                this._result(r, r.ok ? `🧪 +${r.qty} ${ptPlural(r.qty, 'poção', 'poções')} por ${ecoMoney(r.total)}` : null);
                break;
            }
            case 'buy-upgrade': {
                const r = g.buyUpgrade(data.id);
                this._result(r, r.ok ? `⬆️ Upgrade comprado: nível ${r.level}` : null);
                break;
            }
            case 'set-goal': {
                this._result(g.setAnalyzerGoal(data.goal));
                break;
            }
            case 'estimate': this.startEstimate(); break;
            case 'use-route': {
                const risky = data.risky === '1';
                if (risky && typeof confirm === 'function' && !confirm('Essa rota tem avisos de risco (poções/derrotas). Usar mesmo assim?')) break;
                this._result(g.selectHuntRoute(data.id, 'comparison'), '🗺️ Rota alterada.');
                break;
            }
        }
    }
}
