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
        description: (g) => `Recupera ${Math.round(g.getPotionHealPercent() * 100)}% do HP do Pokémon em campo.`,
        price: (g) => g.getPotionPrice(),
        stock: (g) => g.getPotions(),
        capacity: (g) => g.getPotionCapacity(),
        give: (g, qty) => { g.ensureInventory().potions += qty; },
    },
};

const ShopMethods = {
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
                packs: cfg.potion.packs.slice(),
                canBuyOne: this.canAfford(price) && stock < capacity,
            };
        });
    },

    // 购买。qty 超出库存空位时按空位买（买满为止）；买不起整笔则什么都不买。
    // 返回 { ok, qty, unitPrice, total, stock } 或 { ok:false, code }
    buyShopItem(itemId, qty) {
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
        this._track('potion_bought', { qty: n, price: unit });
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
