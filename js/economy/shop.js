// ============================================================
// 商店（挂在 GameCore 上的 mixin）：目前只有药水，结构是通用的，以后加精灵球/道具只需登记新物品。
// 购买是原子操作：校验 → 扣钱（spendMoney）→ 发放 → 发 potion_bought 事件；任何一步失败都不改状态。
// ============================================================

// 一场同等级胜利的基础金币（不含徽章/天赋/升级加成，价格只跟"进度"挂钩）
function baseGoldPerWin(level) {
    return Math.max(1, Math.floor(Math.sqrt(Math.max(1, level)) * 2));
}

// 商店物品登记表：price/stock/capacity 都由核心方法计算，界面只显示
const SHOP_ITEMS = {
    potion: {
        id: 'potion',
        name: 'Poção',
        icon: '🧪',
        reason: 'potion_purchase',
        event: 'potion_bought',
        track: 'potion_bought',
        description: (g) => `Recupera ${Math.round(g.getPotionHealPercent() * 100)}% do HP do Pokémon em campo.`,
        price: (g) => g.getPotionPrice(),
        stock: (g) => g.getPotions(),
        capacity: (g) => g.getPotionCapacity(),
        give: (g, qty) => { g.ensureInventory().potions += qty; },
    },
};

// ---------- F9.4 · Poké Bolas: funções puras (sem estado do jogo) ----------
function getBallType(id) {
    return typeof id === 'string' ? (BALL_TYPES.find(b => b.id === id) || null) : null;
}

// Preço de uma bola no nível de preço dado (a Master Bola não tem preço de loja: null)
function ballPrice(ball, pricingLevel) {
    if (!ball || !ball.buyable) return null;
    return Math.max(ball.basePrice, Math.ceil(ball.winsPerBall * baseGoldPerWin(pricingLevel)));
}

// Adiciona respeitando o limite por item. Devolve { ok, added, count, balls } (balls = objeto NOVO; o recebido não é alterado) ou { ok:false, code }
function ballInventoryAdd(balls, id, qty) {
    if (!getBallType(id)) return { ok: false, code: 'unknown_ball' };
    if (!Number.isInteger(qty) || qty < 1) return { ok: false, code: 'invalid_quantity' };
    const cur = _ballCount(balls, id), added = Math.min(qty, Math.max(0, BALL_STACK_MAX - cur));
    const out = { ...(_isObj(balls) ? balls : {}) };
    out[id] = cur + added;
    return { ok: true, added, count: cur + added, balls: out };
}

// Consome qty (tudo ou nada: nunca deixa a quantidade abaixo de 0). Devolve { ok, consumed, count, balls } ou { ok:false, code }
function ballInventoryConsume(balls, id, qty = 1) {
    if (!getBallType(id)) return { ok: false, code: 'unknown_ball' };
    if (!Number.isInteger(qty) || qty < 1) return { ok: false, code: 'invalid_quantity' };
    const cur = _ballCount(balls, id);
    if (cur < qty) return { ok: false, code: 'insufficient_balls', have: cur };
    const out = { ...(_isObj(balls) ? balls : {}) };
    out[id] = cur - qty;
    return { ok: true, consumed: qty, count: cur - qty, balls: out };
}

function _ballCount(balls, id) {
    const v = _isObj(balls) && Object.prototype.hasOwnProperty.call(balls, id) ? balls[id] : 0;
    return Number.isInteger(v) && v > 0 ? Math.min(v, BALL_STACK_MAX) : 0;
}

// Limpeza do save: só ids do catálogo; quantidade inteira em 1..limite (maior que o limite vira o limite; inválida, negativa ou fracionária vira 0 = omitida)
function sanitizeBallInventory(raw) {
    const out = {};
    if (!_isObj(raw)) return out;
    for (const b of BALL_TYPES) {
        if (!Object.prototype.hasOwnProperty.call(raw, b.id)) continue;
        const v = raw[b.id];
        if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[b.id] = Math.min(v, BALL_STACK_MAX);
    }
    return out;
}

// ---------- F9.5 · captura com chance (funções puras) ----------
// Taxa da espécie (0..1) derivada do BST do dado (o dado não tem capture_rate): 1 até CAPTURE_RATE_BST_FULL, cai linearmente até 0 em BST_SPAN
function speciesCatchRate(speciesData) {
    const b = speciesData && speciesData.baseStats;
    if (!b) return 0;
    const bst = (b.hp || 0) + (b.atk || 0) + (b.def || 0) + (b.spAtk || 0) + (b.spDef || 0) + (b.speed || 0);
    return Math.min(1, Math.max(0, 1 - (bst - CAPTURE_RATE_BST_FULL) / CAPTURE_RATE_BST_SPAN));
}

// Chance de captura com a bola: Master = 1; as demais = clamp(taxa × catchMultiplier, MIN, MAX)
function captureChance(rate, ball) {
    if (!ball) return 0;
    if (ball.id === 'masterball') return 1;
    return Math.min(CAPTURE_CHANCE_MAX, Math.max(CAPTURE_CHANCE_MIN, rate * ball.catchMultiplier));
}

// Escolha automática de bola: a mais barata disponível; shiny usa a melhor disponível; a Master nunca (autoUse=false). Devolve o tipo ou null
function chooseBall(balls, shiny) {
    const usable = BALL_TYPES.filter(b => b.autoUse && _ballCount(balls, b.id) > 0);
    if (usable.length === 0) return null;
    return shiny ? usable[usable.length - 1] : usable[0];
}

// ---------- F9.6 · reposição automática (função pura) ----------
// Plano de reposição: { qty, total } quando deve comprar; { qty: 0, reason } quando não deve ('not_needed' | 'no_gold').
// stock = bolas do item; price = preço unitário; gold = ouro atual; cfg = { minStock, targetStock, goldReserve }
function planRestock(stock, price, gold, cfg) {
    if (!(stock < cfg.minStock)) return { qty: 0, reason: 'not_needed' };
    const room = BALL_STACK_MAX - stock;                                // > 0: o mínimo é no máximo o limite, então estoque abaixo do mínimo sempre tem espaço
    const spendable = gold - cfg.goldReserve;
    const affordable = spendable >= price ? Math.floor(spendable / price) : 0;
    if (affordable <= 0) return { qty: 0, reason: 'no_gold' };
    const qty = Math.min(Math.max(0, cfg.targetStock - stock), room, affordable);
    if (qty <= 0) return { qty: 0, reason: 'not_needed' };
    return { qty, total: qty * price };
}

// As bolas compráveis entram no registro da loja (a Master Bola não)
for (const ball of BALL_TYPES) {
    if (!ball.buyable) continue;
    SHOP_ITEMS[ball.id] = {
        id: ball.id,
        name: ball.name,
        icon: ball.icon,
        reason: 'ball_purchase',
        event: 'ball_bought',
        packs: [1, 10],
        description: () => `${ball.name}: fica no inventário. Cada tentativa de captura gasta uma bola.`,
        price: (g) => ballPrice(ball, g.getBallPricingLevel()),
        stock: (g) => g.getBallCount(ball.id),
        capacity: () => BALL_STACK_MAX,
        give: (g, qty) => { g.addBalls(ball.id, qty); },
    };
}

const ShopMethods = {
    // ---------- F9.4 · inventário de bolas (gameState.inventory.balls, criado só na primeira bola) ----------
    getTotalBalls() {
        const inv = this.gameState ? this.ensureInventory() : null;
        return BALL_TYPES.filter(b => b.autoUse).reduce((n, b) => n + _ballCount(inv && inv.balls, b.id), 0);
    },

    // F9.6 · reposição automática de Poké Bolas, chamada no início de cada tentativa de captura (online e Fast Driver, a mesma função).
    // Sem RNG e sem timers; compra atômica (spendMoney valida antes de mexer em qualquer coisa); um evento por reposição e um aviso de falha por episódio.
    _restockBalls() {
        if (!BALL_RESTOCK_ENABLED || !this.gameState) return null;
        if (!hasBenefit(this.gameState, 'autoRestock')) { this._restockFailed = null; return null; }      // F9.7: benefício VIP; sem ele, igual a um jogo com a reposição desligada
        const cfg = this.getAutomationPolicy().ballPolicy.restock;
        if (!cfg || !cfg.enabled) { this._restockFailed = null; return null; }
        const stock = this.getBallCount(BALL_RESTOCK_ITEM);
        const ball = getBallType(BALL_RESTOCK_ITEM);
        if (!ball || !ball.buyable) return null;
        const unit = ballPrice(ball, this.getBallPricingLevel());
        const plan = planRestock(stock, unit, this.getMoney(), cfg);
        if (plan.reason === 'not_needed') { this._restockFailed = null; return null; }
        if (plan.qty <= 0) {
            if (!this._restockFailed) {                                 // no máximo um aviso por episódio (limpo quando a reposição volta a funcionar)
                this._restockFailed = plan.reason;
                this._emit('balls_restock_failed', { item: ball.id, reason: plan.reason, stock, gold: this.getMoney(), reserve: cfg.goldReserve });
            }
            return null;
        }
        const spent = this.spendMoney(plan.total, 'ball_purchase', { item: ball.id, qty: plan.qty, unitPrice: unit, auto: true });
        if (!spent.ok) return null;                                     // não deve acontecer (o plano já respeita o saldo)
        this.addBalls(ball.id, plan.qty);
        if (this.getBallCount(ball.id) >= cfg.minStock) this._restockFailed = null;       // o episódio de falha só termina quando o estoque volta ao mínimo (compra parcial não limpa: evita alternar aviso/limpeza)
        this._emit('balls_restocked', { item: ball.id, qty: plan.qty, unitPrice: unit, total: plan.total, stock: this.getBallCount(ball.id) });
        return { qty: plan.qty, total: plan.total };
    },

    // Estado da reposição para a interface: motivo da falha atual ('no_gold') ou null
    getRestockStatus() { return { failed: this._restockFailed || null }; },

    getBallCount(id) {
        const inv = this.gameState ? this.ensureInventory() : null;
        return _ballCount(inv && inv.balls, id);
    },

    getBalls() {
        const out = {};
        for (const b of BALL_TYPES) { const n = this.getBallCount(b.id); if (n > 0) out[b.id] = n; }
        return out;
    },

    addBalls(id, qty) {
        const inv = this.ensureInventory();
        if (!inv) return { ok: false, code: 'no_state' };
        const r = ballInventoryAdd(inv.balls, id, qty);
        if (r.ok) inv.balls = r.balls;
        return r;
    },

    consumeBall(id, qty = 1) {
        const inv = this.ensureInventory();
        if (!inv) return { ok: false, code: 'no_state' };
        const r = ballInventoryConsume(inv.balls, id, qty);
        if (!r.ok) return r;
        if (r.count === 0) delete r.balls[id];
        inv.balls = r.balls;
        if (Object.keys(inv.balls).length === 0) delete inv.balls;
        return r;
    },


    // 进度等级：拥有过的最高等级，只增不减（存进 economy.progressLevel）
    getProgressLevel() {
        const eco = this.ensureEconomy();
        let peak = eco.progressLevel || 1;
        const owned = this.gameState.ownedPokemon;
        if (owned) for (const uid in owned) if (owned[uid].level > peak) peak = owned[uid].level;
        eco.progressLevel = peak;
        return peak;
    },

    // 定价等级：进度等级，但不超过"已解锁路线里最高的等级"——收入是由能去的路线决定的，
    // 不能让价格跟着宝可梦等级一路涨到收入够不着（例如被困在关都最后一张图的玩家）
    _pricingCap() {
        if (this._pricingCapCache) return this._pricingCapCache;
        let cap = 1;
        for (const key in REGIONS) {
            if (!this.isRegionUnlocked(key)) continue;
            for (const r of REGIONS[key].routes) if (r.levelRange && r.levelRange[1] > cap) cap = r.levelRange[1];
        }
        this._pricingCapCache = cap;
        return cap;
    },

    // F9.9 · nível usado no PREÇO DAS BOLAS (compra manual e reposição: a mesma função): o nível médio da rota selecionada, nunca acima do nível de
    // progresso (então nunca fica mais caro que antes). Vale igual nos modos rota e mundo (o inimigo do mundo também sai do levelRange da rota atual) e
    // na Torre (a rota selecionada continua a mesma). Sem rota válida: o nível de progresso (comportamento anterior, o mais caro = conservador).
    // Arbitragem: comprar barato numa rota fraca e caçar numa forte é contido pelo limite de 99 por tipo (BALL_STACK_MAX), pela compra manual e pelo
    // fato de a reposição comprar sempre ao preço da rota atual. O preço da poção e das melhorias NÃO usa esta função.
    getBallPricingLevel() {
        const base = this.getPricingLevel();
        const route = this.gameState ? this.getRoute(this.gameState.currentRoute) : null;
        const lr = route && Array.isArray(route.levelRange) ? route.levelRange : null;
        if (!lr || !Number.isFinite(lr[0]) || !Number.isFinite(lr[1])) return base;
        return Math.min(Math.max(1, Math.round((lr[0] + lr[1]) / 2)), base);
    },

    getPricingLevel() {
        return Math.min(this.getProgressLevel(), this._pricingCap());
    },

    getPotionHealPercent() {
        return Math.min(1, POTION_HEAL_PERCENT * this.getModifier('potion_heal').mult);
    },

    getPotionCapacity() {
        return Math.floor(this.getEconomyConfig().potion.capacityBase + this.getModifier('potion_cap').add);
    },

    getPotionPrice() {
        const cfg = this.getEconomyConfig().potion;
        return Math.max(cfg.basePrice, Math.ceil(cfg.winsPerPotion * baseGoldPerWin(this.getPricingLevel())));
    },

    // 商店目录（界面只读这个）
    getShopItems() {
        const cfg = this.getEconomyConfig();
        return Object.values(SHOP_ITEMS).map(it => {
            const price = it.price(this), stock = it.stock(this), capacity = it.capacity(this);
            return {
                id: it.id, name: it.name, icon: it.icon, description: it.description(this),
                price, stock, capacity, room: Math.max(0, capacity - stock),
                packs: (it.packs || cfg.potion.packs).slice(),
                canBuyOne: this.canAfford(price) && stock < capacity,
            };
        });
    },

    // 购买。qty 超出库存空位时按空位买（买满为止）；买不起整笔则什么都不买。
    // 返回 { ok, qty, unitPrice, total, stock } 或 { ok:false, code }
    buyShopItem(itemId, qty) {
        const ballType = getBallType(itemId);
        if (ballType && !ballType.buyable) return { ok: false, code: 'not_buyable' };             // F9.4: Master Bola
        const item = Object.prototype.hasOwnProperty.call(SHOP_ITEMS, itemId) ? SHOP_ITEMS[itemId] : null;
        if (!item) return { ok: false, code: 'unknown_item' };
        if (!this.gameState) return { ok: false, code: 'no_state' };
        if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return { ok: false, code: 'invalid_quantity' };
        if (this._isOfflineSimulating) return { ok: false, code: 'busy' };
        const room = Math.max(0, item.capacity(this) - item.stock(this));
        if (room <= 0) return { ok: false, code: 'capacity_full' };
        const n = Math.min(qty, room);
        const unit = item.price(this);
        const total = unit * n;
        const spent = this.spendMoney(total, item.reason, { item: item.id, qty: n, unitPrice: unit });
        if (!spent.ok) return { ok: false, code: spent.code, need: total, have: this.getMoney() };
        item.give(this, n);
        this._emit(item.event, { item: item.id, qty: n, unitPrice: unit, total, stock: item.stock(this) });
        if (item.track) this._track(item.track, { qty: n, price: unit });
        this.save();
        return { ok: true, qty: n, unitPrice: unit, total, stock: item.stock(this), clamped: n < qty };
    },

    buyPotions(qty) {
        return this.buyShopItem('potion', qty);
    },
};

function installShop(GameCoreClass) {
    for (const key of Object.keys(ShopMethods)) GameCoreClass.prototype[key] = ShopMethods[key];
}

installShop(GameCore);
