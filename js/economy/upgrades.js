// ============================================================
// 升级引擎 + 修改器注册表（挂在 GameCore 上的 mixin）
//
// 修改器：核心里所有"被加成"的数值都通过 getModifier(stat) 取得，来源目前只有升级（以后可以接道具/天赋）。
//   getModifier('exp' | 'gold' | 'battle_delay' | 'potion_heal' | 'potion_capacity') → { mult, add }
//   Live 与 Fast 两个驱动走同一批核心函数，所以自动共用同一套修改器。
// 升级购买是原子的：校验 → spendMoney('upgrade_purchase') → 升级 → 清缓存 → 发 upgrade_purchased。
// ============================================================
const UpgradeMethods = {
    // ---------- 状态 ----------
    getUpgradeLevel(id) {
        const u = this.gameState && this.gameState.upgrades;
        return u && _has(u, id) ? u[id] : 0;
    },

    _upgradeDef(id) {
        const defs = this.getEconomyConfig().upgrades;
        return typeof id === 'string' && _has(defs, id) ? defs[id] : null;
    },

    // ---------- 修改器 ----------
    _invalidateModifiers() { this._mods = null; },

    // 一个升级在某个等级对某个效果的数值（用于修改器与界面预览）
    _effectValue(effect, level) {
        if (effect.kind === 'mult') return 1 + effect.perLevel * level;
        if (effect.kind === 'delay') return Math.max(effect.floor === undefined ? 0 : effect.floor, 1 - effect.perLevel * level);
        return effect.perLevel * level;                                  // add
    },

    _computeModifiers() {
        const mods = {};
        const get = (stat) => mods[stat] || (mods[stat] = { mult: 1, add: 0 });
        const defs = this.getEconomyConfig().upgrades;
        for (const id of Object.keys(defs)) {
            const level = this.getUpgradeLevel(id);
            if (level <= 0) continue;
            for (const effect of defs[id].effects) {
                const m = get(effect.stat);
                const v = this._effectValue(effect, level);
                if (effect.kind === 'add') m.add += v; else m.mult *= v;
            }
        }
        return mods;
    },

    getModifier(stat) {
        if (!this._mods) this._mods = this._computeModifiers();
        return this._mods[stat] || { mult: 1, add: 0 };
    },

    // ---------- 价格与解锁 ----------
    // 进度缩放：升级价格跟着"进度等级"走（和药水价格同一套逻辑），这样升级永远是"几小时收入"的量级
    _upgradeCostScale() {
        const ref = this.getEconomyConfig().upgradeCostScale.referenceLevel;
        return Math.max(1, baseGoldPerWin(this.getProgressLevel()) / baseGoldPerWin(ref));
    },

    getUpgradeCost(id) {
        const def = this._upgradeDef(id);
        if (!def) return null;
        const level = this.getUpgradeLevel(id);
        if (level >= def.maxLevel) return null;
        return Math.ceil(def.cost.base * Math.pow(def.cost.growth, level) * this._upgradeCostScale());
    },

    // 还没满足的前置条件（空数组 = 已解锁）
    getUpgradeMissing(id) {
        const def = this._upgradeDef(id);
        if (!def) return [];
        return def.requires.filter(r => this.getUpgradeLevel(r.id) < r.level);
    },

    // 界面只读这个：每个升级的名字、等级、下一级效果、价格、是否解锁/买得起
    getUpgradeCatalog() {
        const defs = this.getEconomyConfig().upgrades;
        return Object.values(defs).map(def => {
            const level = this.getUpgradeLevel(def.id);
            const maxed = level >= def.maxLevel;
            const missing = this.getUpgradeMissing(def.id);
            const cost = this.getUpgradeCost(def.id);
            const effect = def.effects[0];
            const fmt = (lv) => {
                const v = this._effectValue(effect, lv);
                if (effect.kind === 'add') return `+${Math.round(v)}${effect.unit}`;
                const pct = Math.round((effect.kind === 'delay' ? v - 1 : v - 1) * 100);
                return `${pct >= 0 ? '+' : ''}${pct}${effect.unit}`;
            };
            return {
                id: def.id, name: def.name, icon: def.icon, build: def.build, description: def.description,
                level, maxLevel: def.maxLevel, maxed,
                cost, affordable: cost !== null && this.canAfford(cost),
                locked: missing.length > 0,
                missing: missing.map(r => ({ id: r.id, name: defs[r.id].name, level: r.level, have: this.getUpgradeLevel(r.id) })),
                effectNow: fmt(level),
                effectNext: maxed ? null : fmt(level + 1),
            };
        });
    },

    // ---------- 购买 ----------
    buyUpgrade(id) {
        const def = this._upgradeDef(id);
        if (!def) return { ok: false, code: 'unknown_upgrade' };
        if (!this.gameState) return { ok: false, code: 'no_state' };
        if (this._isOfflineSimulating) return { ok: false, code: 'busy' };
        const level = this.getUpgradeLevel(id);
        if (level >= def.maxLevel) return { ok: false, code: 'max_level' };
        if (this.getUpgradeMissing(id).length) return { ok: false, code: 'locked' };
        const cost = this.getUpgradeCost(id);
        const spent = this.spendMoney(cost, 'upgrade_purchase', { upgrade: id, level: level + 1 });
        if (!spent.ok) return { ok: false, code: spent.code, need: cost, have: this.getMoney() };
        if (!_isObj(this.gameState.upgrades)) this.gameState.upgrades = {};
        this.gameState.upgrades[id] = level + 1;
        this._invalidateModifiers();
        this._emit('upgrade_purchased', { id, level: level + 1, cost });
        this._track('upgrade_purchased', { id, level: level + 1 });
        this.save();
        return { ok: true, id, level: level + 1, cost };
    },
};

function installUpgrades(GameCoreClass) {
    for (const key of Object.keys(UpgradeMethods)) GameCoreClass.prototype[key] = UpgradeMethods[key];
}

installUpgrades(GameCore);
