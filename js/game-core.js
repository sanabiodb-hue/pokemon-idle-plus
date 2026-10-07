// ============================================================
// 游戏核心逻辑 - 属性计算、战斗系统、存档管理
// （配置数据见 game-config.js）
// ============================================================

class GameCore {
    constructor() {
        this.gameState = null;
        this.battleTimer = null;
        this.autoSaveTimer = null;
        this.battleSpeed = 1;
        this.onBattleEvent = null; // UI回调
        this.onCatch = null;
        this.onLevelUp = null;
        this._nextBattleTimeout = null; // 下一场战斗延迟计时器
        this._nextBattleScheduledAt = null; // 下一场战斗计划开始的时间戳
        // 实际经验/金币速率跟踪器
        this.rateTracker = { startTime: null, totalExp: 0, totalGold: 0 };
        // 随机数来源（测试时可替换为确定性序列）
        this.rng = Math.random;
        this.debug = false;
        // 性能缓存（见 _touchSpecies / _invalidateAllCaches）
        this._instanceStats = new Map();  // 个体 uid → calculateStats 结果（旧的“物种级缓存”现在按个体缓存）
        this._dexBonus = null;            // 图鉴1%加成缓存 { key, value }
        this._gemBonusCache = null;
        // 存档相关回调（UI 注册）
        this.onSaveError = null;
        this.onSaveRecover = null;
        this.onSaveConflict = null;
        this.loadReport = null;           // 最近一次 load() 的诊断信息
        this.lastOfflineSummary = null;
        this._isOfflineSimulating = false;
        this._offlineSimState = null;
        this._offlineSummary = null;
        this._towerMode = false;
        // 个体名册：个体 / 队伍 / PC / 放生记录，并维护 caughtPokemon、team 这两个旧兼容视图
        this.roster = new PokemonRoster(() => this.gameState);
        // 名册里的变化（创建/放生/换主个体）要让属性缓存失效
        this.roster.onChange = (speciesId) => {
            if (speciesId === null) this._invalidateAllCaches();
            else this._touchSpecies(speciesId);
        };
        this.saver = new SaveManager({
            getState: () => this._prepareStateForSave(),
            onError: (e) => { if (this.onSaveError) this.onSaveError(e); },
            onRecover: () => { if (this.onSaveRecover) this.onSaveRecover(); },
            onConflict: () => { if (this.onSaveConflict) this.onSaveConflict(); },
            win: typeof window !== 'undefined' ? window : null,
        });
        this._initWorkerTimer();
        this._initVisibilityHandler();
        this._buildEvolutionCache();
    }

    _log(...args) {
        if (this.debug) console.log(...args);
    }

    // ===================== 缓存失效 =====================
    // 任何会改变某只个体等级/个体值/闪光/树果的写操作都必须调用它们。
    // 旧代码按“物种”思考，所以 _touchSpecies 会让该物种的全部个体缓存失效，
    // 并把 shinyDex（旧的物种级闪光标记）同步到主个体上。
    _touchSpecies(id) {
        const gs = this.gameState;
        if (gs && gs.ownedPokemon) {
            const primary = this.roster.primaryOf(id);
            if (primary && gs.shinyDex[id] && !primary.shiny) primary.shiny = true;
            for (const inst of this.roster.ofSpecies(id)) this._instanceStats.delete(inst.uid);
            this._instanceStats.delete('~' + id);     // 图鉴存档的属性缓存
        }
        this._dexBonus = null;
    }

    // 只有这一只个体变化（例如它自己升级）
    _touchInstance(inst) {
        this._instanceStats.delete(inst.uid);
        this._dexBonus = null;
    }

    _invalidateAllCaches() {
        this._instanceStats.clear();
        this._dexBonus = null;
        this._gemBonusCache = null;
    }

    // ===================== 队伍个体访问（旧的 team 数组 ↔ 新的 party 个体）=====================
    // 旧代码和旧测试会直接改 gameState.team；每次需要队伍个体前先对齐。一致时几乎零开销。
    _partyInstance(index) {
        this.roster.reconcile();
        const gs = this.gameState;
        const uid = gs.party[index];
        return uid === undefined ? null : gs.ownedPokemon[uid] || null;
    }

    // 公开：队伍里第 index 位的个体对象（界面/外部模块使用）
    getPartyInstance(index) {
        return this._partyInstance(index);
    }

    // 给界面用的队伍成员快照（界面不需要知道个体/PC 的内部结构）
    getPartyMemberView(index) {
        const inst = this._partyInstance(index);
        if (!inst) return null;
        const data = POKEMON_DATA[inst.speciesId];
        return {
            uid: inst.uid,
            speciesId: inst.speciesId,
            name: data.name,
            displayName: getInstanceDisplayName(inst),
            nickname: inst.nickname,
            level: inst.level,
            ivs: inst.ivs,
            shiny: inst.shiny,
            nature: inst.nature,
            gender: inst.gender,
            skillLevel: inst.skillLevel,
            types: data.types,
            battles: inst.battles,
            isPrimary: this.roster.isPrimary(inst),
        };
    }

    // ===================== 在线/离线共用的进度公式 =====================
    // 闪光概率（徽章/天赋/挑战塔加成）
    getShinyRate() {
        let rate = BASE_SHINY_RATE;
        const badge = this.getBadgeEffectValue('shiny_bonus');
        if (badge !== null) rate *= (1 + badge);
        const talent = this.getTalentValue('shiny_bonus');
        if (talent > 0) rate *= (1 + talent / 100);
        const tower = this.getTowerBonus();
        if (tower > 0) rate *= (1 + tower / 100);
        return rate;
    }

    // 会心率/倍率。玩家享受宝石与天赋加成，野怪只有基础值
    _getCritParams(isPlayer) {
        let rate = BASE_CRIT_RATE;
        let multiplier = BASE_CRIT_MULTIPLIER;
        if (isPlayer) {
            rate += this.getGemBonuses().crit_rate / 100;
            const talent = this.getTalentValue('crit_damage_bonus');
            if (talent > 0) multiplier += talent / 100;
        }
        return { rate, multiplier };
    }

    // 胜利结算所需的全部加成（在线每场计算一次，离线整批缓存复用）
    getProgressBonuses() {
        const badgePokedex = this.getBadgeEffectValue('pokedex_exp_bonus') || 0;
        const talentPokedex = this.getTalentValue('pokedex_exp_bonus');
        return {
            badgeExp: this.getBadgeEffectValue('exp_bonus'),
            talentExp: this.getTalentValue('exp_bonus'),
            towerBonus: this.getTowerBonus(),
            teamExpRate: TEAM_EXP_RATE,
            reserveExpRate: RESERVE_EXP_RATE * (1 + talentPokedex / 100 + badgePokedex),
            healPercent: VICTORY_HEAL_PERCENT,
        };
    }

    _applyExpBonuses(exp, b) {
        let e = exp;
        if (b.badgeExp !== null) e = Math.floor(e * (1 + b.badgeExp));
        if (b.talentExp > 0) e = Math.floor(e * (1 + b.talentExp / 100));
        if (b.towerBonus > 0) e = Math.floor(e * (1 + b.towerBonus / 100));
        return e;
    }

    // 两场战斗之间的间隔：攻击间隔 < 800ms 时等于攻击间隔
    _getNextBattleDelay(attackInterval) {
        return attackInterval < NEXT_BATTLE_MAX_DELAY_MS ? attackInterval : NEXT_BATTLE_MAX_DELAY_MS;
    }

    // 重置速率跟踪器（切换地图时调用）
    resetRateTracker() {
        this.rateTracker = { startTime: null, totalExp: 0, totalGold: 0 };
    }

    // 更新速率跟踪器（每次获得经验/金币时调用）
    _updateRateTracker(exp, gold) {
        if (!this.rateTracker.startTime) {
            this.rateTracker.startTime = Date.now();
        }
        this.rateTracker.totalExp += exp;
        this.rateTracker.totalGold += gold;
    }

    // 获取每分钟实际经验/金币速率
    getRatesPerMinute() {
        if (!this.rateTracker.startTime || this.rateTracker.totalExp === 0) {
            return null; // 无数据
        }
        const elapsedMs = Date.now() - this.rateTracker.startTime;
        if (elapsedMs < 1000) return null; // 不足1秒不计算
        const elapsedMin = elapsedMs / 60000;
        return {
            expPerMin: Math.round(this.rateTracker.totalExp / elapsedMin),
            goldPerMin: Math.round(this.rateTracker.totalGold / elapsedMin),
        };
    }

    // ===================== Worker定时器（后台不被节流） =====================
    _initWorkerTimer() {
        // 创建一个内联 Web Worker 作为精确定时器
        // Web Worker 不受浏览器后台标签页节流限制
        try {
            const workerCode = `
                let timers = {};
                self.onmessage = function(e) {
                    const { type, interval, id } = e.data;
                    if (type === 'start') {
                        if (timers[id]) clearInterval(timers[id]);
                        timers[id] = setInterval(() => {
                            self.postMessage({ id: id });
                        }, interval);
                    } else if (type === 'stop') {
                        if (timers[id]) {
                            clearInterval(timers[id]);
                            delete timers[id];
                        }
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this._timerWorker = new Worker(URL.createObjectURL(blob));
            this._workerCallbacks = {};
            this._workerNextId = 1;
            this._timerWorker.onmessage = (e) => {
                const cb = this._workerCallbacks[e.data.id];
                if (cb) cb();
            };
            this._useWorkerTimer = true;
            this._log('✅ Worker定时器已启用，后台战斗不受影响');
        } catch (e) {
            this._useWorkerTimer = false;
            console.warn('⚠️ Worker定时器创建失败，回退到普通定时器:', e);
        }
    }

    // 使用Worker的setInterval（后台不被节流）
    _workerSetInterval(callback, interval) {
        if (this._useWorkerTimer) {
            const id = this._workerNextId++;
            this._workerCallbacks[id] = callback;
            this._timerWorker.postMessage({ type: 'start', id, interval });
            return id;
        } else {
            return setInterval(callback, interval);
        }
    }

    // 清除Worker的setInterval
    _workerClearInterval(timerId) {
        if (this._useWorkerTimer) {
            if (this._timerWorker) {
                this._timerWorker.postMessage({ type: 'stop', id: timerId });
            }
            delete this._workerCallbacks[timerId];
        } else {
            clearInterval(timerId);
        }
    }

    // ===================== 页面可见性处理 =====================
    _initVisibilityHandler() {
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    this._onPageVisible();
                } else {
                    this._onPageHidden();
                }
            });
        }
        if (typeof window !== 'undefined') {
            // 关闭/切走页面前把防抖中的存档立即写入
            window.addEventListener('pagehide', () => this.saveNow());
        }
    }

    _onPageHidden() {
        // 记录进入后台的时间，并立即落盘（防抖中的请求不能丢）
        this._hiddenAt = Date.now();
        this.saveNow();
    }

    // 离线时间上限：拥有离线时间徽章时 48 小时，否则 24 小时
    getMaxOfflineTime() {
        const bonus = this.getBadgeEffectValue('offline_time_bonus');
        return bonus !== null ? bonus : MAX_OFFLINE_TIME;
    }

    _onPageVisible() {
        if (!this._hiddenAt) return;
        const now = Date.now();
        const elapsed = now - this._hiddenAt;
        this._hiddenAt = null;

        // 挑战塔战斗由 Worker 定时器持续推进，不需要（也不能）做主线离线结算，
        // 否则会用主线敌人污染挑战塔进度。
        if (this._towerMode) return;
        // 已经在做离线结算时不重入
        if (this._isOfflineSimulating) return;

        // 如果后台时间超过2秒，进行离线战斗结算
        if (elapsed > 2000) {
            this._processOfflineBattles(Math.min(elapsed, this.getMaxOfflineTime()));
            return; // 异步模拟，不在这里重启战斗
        }

        // 如果有计划中的下一场战斗延迟，检查是否已过时
        if (this._nextBattleScheduledAt && now >= this._nextBattleScheduledAt) {
            this._nextBattleScheduledAt = null;
            if (this._nextBattleTimeout) {
                clearTimeout(this._nextBattleTimeout);
                this._nextBattleTimeout = null;
            }
            this.startBattle();
        }
    }

    // ----- 离线静默模式：模拟期间不触发 UI 回调，只收集结算摘要 -----
    _beginOfflineSilence(totalMs) {
        const stats = this.gameState.stats;
        this._isOfflineSimulating = true;
        this._offlineSummary = {
            totalMs,
            battles: 0,
            startExp: stats.totalExp,
            startGold: stats.totalGold,
            events: [],
            eventsOverflow: 0,
            newCatches: [],
            duplicateCatches: [],
            ivUpgrades: 0,
            levelUps: {},
        };
        this._savedOnBattleEvent = this.onBattleEvent;
        this._savedOnCatch = this.onCatch;
        this._savedOnLevelUp = this.onLevelUp;
        const summary = this._offlineSummary;
        const KEEP = ['evolved', 'shinyEvolved', 'shinySpread', 'shinyDefeated',
                      'badgeUnlocked', 'regionUnlocked', 'autoRouteSwitch'];
        this.onBattleEvent = (event, data) => {
            if (!KEEP.includes(event)) return;
            if (summary.events.length < 200) summary.events.push({ event, data });
            else summary.eventsOverflow++;
        };
        this.onCatch = (info) => {
            if (info.isFirstCatch) summary.newCatches.push({ id: info.id, name: info.name, shiny: !!info.shiny });
            else if (info.isDuplicate) summary.duplicateCatches.push({ id: info.id, name: info.name, shiny: !!info.shiny });
            else if (info.updatedStats && info.updatedStats.length) summary.ivUpgrades++;
        };
        this.onLevelUp = (info) => {
            const prev = summary.levelUps[info.id];
            summary.levelUps[info.id] = {
                id: info.id,
                name: info.name,
                from: prev ? prev.from : info.startLevel,
                to: info.level,
            };
        };
    }

    // 恢复 UI 回调并生成最终摘要
    _endOfflineSilence(battles) {
        const s = this._offlineSummary;
        if (this._savedOnBattleEvent !== undefined) this.onBattleEvent = this._savedOnBattleEvent;
        if (this._savedOnCatch !== undefined) this.onCatch = this._savedOnCatch;
        if (this._savedOnLevelUp !== undefined) this.onLevelUp = this._savedOnLevelUp;
        this._savedOnBattleEvent = this._savedOnCatch = this._savedOnLevelUp = undefined;
        this._isOfflineSimulating = false;
        this._offlineSummary = null;
        if (!s) return null;
        const stats = this.gameState.stats;
        const levelUps = Object.values(s.levelUps)
            .sort((a, b) => (b.to - b.from) - (a.to - a.from))
            .slice(0, 10);
        const summary = {
            totalMs: s.totalMs,
            battles,
            expGained: stats.totalExp - s.startExp,
            goldGained: stats.totalGold - s.startGold,
            newCatches: s.newCatches,
            duplicateCatches: s.duplicateCatches,
            ivUpgrades: s.ivUpgrades,
            levelUps,
            levelUpCount: Object.keys(s.levelUps).length,
            events: s.events,
            eventsOverflow: s.eventsOverflow,
        };
        this.lastOfflineSummary = summary;
        return summary;
    }

    // 离线战斗结算：模拟后台期间的战斗（异步）
    _processOfflineBattles(elapsedMs) {
        if (!this.gameState || this._isOfflineSimulating || this._towerMode) return;
        if (!(elapsedMs > 0)) return;

        // 必须在 stopBattle 之前判断（stopBattle 会清掉治疗计时器）
        const battle = this.currentBattle;
        const wasHealing = !!this.healTimer || !!(battle && battle.playerCurrentHp <= 0);

        // 停止当前战斗循环，防止模拟期间干扰
        this.stopBattle();
        this._beginOfflineSilence(elapsedMs);

        let simulateMs = elapsedMs;

        // 如果正在治疗中（玩家被击败），先模拟治疗
        if (wasHealing && battle) {
            const maxHp = battle.playerMaxHp;
            const healPerSecond = Math.max(1, Math.floor(maxHp * DEFEAT_HEAL_PERCENT_PER_SEC));
            const missing = Math.max(0, maxHp - battle.playerCurrentHp);
            const healMs = Math.ceil(missing / healPerSecond) * 1000;
            if (elapsedMs < healMs) {
                // 离线期间都在治疗，没有战斗可结算
                battle.playerCurrentHp = Math.min(maxHp, battle.playerCurrentHp + healPerSecond * Math.floor(elapsedMs / 1000));
                this._finishOfflineSimulation(0, elapsedMs, false);
                this.startHealingAfterDefeat();
                return;
            }
            battle.playerCurrentHp = maxHp;
            this.gameState.currentEnemy = null;
            simulateMs = Math.max(0, elapsedMs - healMs);
        }

        if (simulateMs <= 1000) {
            this._finishOfflineSimulation(0, elapsedMs);
            return;
        }

        // 通知UI开始离线模拟（显示进度条）— 使用保存的原始回调
        if (this._savedOnBattleEvent) {
            this._savedOnBattleEvent('offlineStart', { totalMs: simulateMs });
        }

        // 启动异步分批模拟
        this._simulateOfflineBattlesAsync(simulateMs, elapsedMs);
    }

    // 异步分批模拟离线战斗
    _simulateOfflineBattlesAsync(totalMs, reportedMs = totalMs) {
        const state = this.gameState;
        const route = state && state.currentRoute ? this.getRoute(state.currentRoute) : null;
        if (!route || !state.team || state.team.length === 0) {
            this._finishOfflineSimulation(0, reportedMs);
            return;
        }

        this.roster.reconcile();
        const activeInst = this._partyInstance(state.activePokemonIndex);
        const activePokemonId = activeInst ? activeInst.speciesId : null;
        const playerStats = activeInst ? this.calculateBattleStats(state.activePokemonIndex) : null;
        if (!playerStats) {
            this._finishOfflineSimulation(0, reportedMs);
            return;
        }

        // ===== 预计算离线期间不变的缓存值（与在线共用同一套公式）=====
        const gemBonuses = this.getGemBonuses();
        const critParams = this._getCritParams(true);
        const bonuses = this.getProgressBonuses();

        // 队伍战斗属性/等级缓存（仅升级或队伍变化时刷新）
        const cachedTeamStats = [];
        const cachedTeamLevels = [];
        const cachedTeamSpecies = [];
        for (let i = 0; i < state.team.length; i++) {
            cachedTeamStats[i] = this.calculateBattleStats(i);
            const member = this._partyInstance(i);
            cachedTeamLevels[i] = member ? member.level : 0;
            cachedTeamSpecies[i] = member ? member.speciesId : 0;
        }

        // 玩家起始血量：优先沿用进行中的战斗，其次存档中的血量百分比，最后满血
        let startHp = playerStats.hp;
        if (this.currentBattle && this.currentBattle.playerMaxHp > 0) {
            startHp = Math.max(1, Math.floor(playerStats.hp * Math.min(1, this.currentBattle.playerCurrentHp / this.currentBattle.playerMaxHp)));
            if (this.currentBattle.playerCurrentHp <= 0) startHp = playerStats.hp;
        } else if (state.battleHp && state.battleHp.playerMaxHp > 0 && state.battleHp.playerHp > 0) {
            startHp = Math.max(1, Math.floor(playerStats.hp * Math.min(1, state.battleHp.playerHp / state.battleHp.playerMaxHp)));
        }

        const simState = {
            totalMs,
            remainingMs: totalMs,
            reportedMs,
            battlesSimulated: 0,
            route,
            activePokemonId,
            activeInst,
            playerStats,
            playerHp: startHp,
            playerAttackInterval: this.getAttackInterval(playerStats.speed),
            // 缓存
            dodgeRate: Math.min(75, gemBonuses.dodge_rate) / 100,
            critParams,
            enemyCritParams: this._getCritParams(false),
            bonuses,
            spawnCache: {
                shinyRate: this.getShinyRate(),
                weightReduce: this.getBadgeEffectValue('completed_weight_reduce'),
            },
            cachedTeamStats,
            cachedTeamLevels,
            cachedTeamSpecies,
            teamKey: state.party.join(','),
            cachedPlayerLevel: activeInst.level,
            cachedPlayerTypes: POKEMON_DATA[activePokemonId]?.types || [],
            // 图鉴经验累积器（批量化）
            pokedexExpAccumulator: {},
        };

        this._offlineSimState = simState;
        this._runOfflineBatch();
    }

    // 刷新离线模拟中“当前出战”相关缓存
    _offlineSyncActive(s, newStats) {
        const oldMaxHp = s.playerStats.hp;
        const hpPercent = oldMaxHp > 0 ? s.playerHp / oldMaxHp : 1;
        s.activeInst = this._partyInstance(this.gameState.activePokemonIndex) || s.activeInst;
        s.activePokemonId = s.activeInst.speciesId;
        s.playerStats = newStats;
        s.playerAttackInterval = this.getAttackInterval(newStats.speed);
        s.playerHp = Math.max(1, Math.floor(newStats.hp * Math.min(1, hpPercent)));
        s.cachedPlayerLevel = s.activeInst.level;
        s.cachedPlayerTypes = POKEMON_DATA[s.activePokemonId]?.types || [];
    }

    // 每批模拟 OFFLINE_BATCH_SIZE 场战斗，然后让出主线程更新进度
    _runOfflineBatch() {
        const s = this._offlineSimState;
        if (!s) return;
        const state = this.gameState;

        let batchCount = 0;

        while (s.remainingMs > 0 && batchCount < OFFLINE_BATCH_SIZE) {
            // 与在线共用的野怪生成（使用缓存的闪光率/权重参数）
            const wildPokemon = this.generateWildPokemon(s.route, s.spawnCache);
            if (!wildPokemon) { s.remainingMs = 0; break; } // 路线无效：终止，避免空转

            // 每场新敌人生成后执行自动切换最优宝可梦（使用缓存的队伍属性）
            if (state.settings?.autoSwitchBest && state.team.length > 1) {
                const bestIndex = this.getBestTeamMemberForEnemy(wildPokemon, {
                    teamStats: s.cachedTeamStats,
                    teamLevels: s.cachedTeamLevels,
                });
                if (bestIndex !== -1 && bestIndex !== state.activePokemonIndex) {
                    state.activePokemonIndex = bestIndex;
                    const newStats = s.cachedTeamStats[bestIndex];
                    if (newStats) this._offlineSyncActive(s, newStats);
                }
            }

            const enemyStats = this.calculateStats(wildPokemon);
            let enemyHp = enemyStats.hp;
            const enemyAttackInterval = this.getAttackInterval(enemyStats.speed);
            const wildTypes = POKEMON_DATA[wildPokemon.id]?.types || [];

            // 获取最优技能（复用公共方法）
            const bestSkill = this._getBestSkillForInstance(s.activeInst, wildTypes);
            const playerPower = bestSkill.power > 0 ? bestSkill.power : 50;

            // 模拟单场战斗
            let battleTime = 0;
            let playerTimer = 0;
            let enemyTimer = 0;

            while (enemyHp > 0 && s.playerHp > 0) {
                const nextEvent = Math.min(s.playerAttackInterval - playerTimer, enemyAttackInterval - enemyTimer);

                battleTime += nextEvent;
                playerTimer += nextEvent;
                enemyTimer += nextEvent;

                if (battleTime > s.remainingMs) break;

                // 玩家攻击
                if (playerTimer >= s.playerAttackInterval) {
                    playerTimer = 0;
                    const hit = this._computeDamage(
                        s.cachedPlayerLevel, s.playerStats.attack, enemyStats.defense,
                        s.cachedPlayerTypes, wildTypes, playerPower,
                        s.critParams.rate, s.critParams.multiplier
                    );
                    enemyHp -= hit.damage;
                    s.activeInst.stats.damageDealt += hit.damage;
                    if (hit.criticalHit) s.activeInst.stats.criticalHits++;
                }

                // 敌方攻击
                if (enemyTimer >= enemyAttackInterval) {
                    enemyTimer = 0;
                    if (!(s.dodgeRate > 0 && this.rng() < s.dodgeRate)) {
                        const taken = this._computeDamage(
                            wildPokemon.level, enemyStats.attack, s.playerStats.defense,
                            wildTypes, s.cachedPlayerTypes, 50,
                            s.enemyCritParams.rate, s.enemyCritParams.multiplier
                        ).damage;
                        s.playerHp -= taken;
                        s.activeInst.stats.damageTaken += taken;
                    }
                }
            }

            s.remainingMs -= battleTime;

            // 玩家被击败：等待回满血后继续（与在线 20%/秒 一致）
            if (s.playerHp <= 0) {
                s.activeInst.stats.faints++;
                s.remainingMs -= DEFEAT_HEAL_MS;
                s.playerHp = s.playerStats.hp;
                state.currentEnemy = null;
                batchCount++;
                continue;
            }

            // 敌方被击败 - 与在线共用的胜利结算
            if (enemyHp <= 0) {
                s.battlesSimulated++;
                batchCount++;

                const rewards = this._processVictoryRewards(
                    wildPokemon, s.activePokemonId, s.playerStats.hp, s.playerHp, s
                );
                s.playerHp = rewards.newPlayerHp;

                // 自动切换地图后刷新路线
                if (rewards.autoSwitchResult) {
                    const newRoute = this.getRoute(state.currentRoute);
                    if (newRoute) s.route = newRoute;
                }

                // 仅在升级/队伍变化时才刷新缓存（避免每场都重算）
                const teamKey = state.party.join(',');
                if (rewards.anyLevelUp || teamKey !== s.teamKey) {
                    const teamChanged = teamKey !== s.teamKey;
                    s.teamKey = teamKey;
                    for (let i = 0; i < state.team.length; i++) {
                        const member = this._partyInstance(i);
                        const newLv = member?.level || 0;
                        const newSp = member?.speciesId || 0;
                        if (teamChanged || newLv !== s.cachedTeamLevels[i] || newSp !== s.cachedTeamSpecies[i]) {
                            s.cachedTeamStats[i] = this.calculateBattleStats(i);
                            s.cachedTeamLevels[i] = newLv;
                            s.cachedTeamSpecies[i] = newSp;
                        }
                    }
                    const refreshed = s.cachedTeamStats[state.activePokemonIndex];
                    if (refreshed) this._offlineSyncActive(s, refreshed);
                }

                s.remainingMs -= this._getNextBattleDelay(s.playerAttackInterval);
            }
        }

        // 计算进度并通知UI — 使用保存的原始回调
        const progress = Math.min(1, (s.totalMs - s.remainingMs) / s.totalMs);
        if (this._savedOnBattleEvent) {
            this._savedOnBattleEvent('offlineProgress', {
                progress: progress,
                battles: s.battlesSimulated,
                percent: Math.floor(progress * 100)
            });
        }

        // 每批结束时刷写图鉴累积经验
        this._flushPokedexExpAccumulator(s.pokedexExpAccumulator);

        // 还有剩余时间，继续下一批
        if (s.remainingMs > 0) {
            setTimeout(() => this._runOfflineBatch(), 0);
        } else {
            this._finishOfflineSimulation(s.battlesSimulated, s.reportedMs);
        }
    }

    // 离线模拟完成：保存、恢复回调、汇报摘要并重启战斗
    _finishOfflineSimulation(battlesSimulated, totalMs, restartBattle = true) {
        const s = this._offlineSimState;
        if (s) {
            this.gameState.currentEnemy = null;
            // 把模拟后的血量带回当前战斗，避免 startBattle 继承过期的血量
            if (this.currentBattle) {
                this.currentBattle.playerMaxHp = s.playerStats.hp;
                this.currentBattle.playerCurrentHp = Math.max(1, s.playerHp);
            }
            this.gameState.battleHp = {
                playerHp: Math.max(0, s.playerHp),
                playerMaxHp: s.playerStats.hp,
                playerTimer: 0,
                enemyTimer: 0,
                enemyHp: 0
            };
        }
        this._offlineSimState = null;

        this.saveNow();
        this._log(`⚡ 离线结算: 模拟了 ${battlesSimulated} 场战斗`);

        const summary = this._endOfflineSilence(battlesSimulated);

        // 通知UI模拟结束（带摘要，事件不再丢失）
        if (this.onBattleEvent) {
            this.onBattleEvent('offlineEnd', {
                battles: battlesSimulated,
                totalMs,
                summary,
                offlineEvents: summary ? summary.events : [],
            });
        }

        // 重启战斗循环
        if (restartBattle) this.startBattle();
    }

    // 预构建进化链映射缓存：进化形态ID → 基础形态ID（O(1)查找）
    _buildEvolutionCache() {
        this._baseIdCache = {};
        for (const id in POKEMON_DATA) {
            const data = POKEMON_DATA[id];
            if (!data.evolvesTo) continue;
            const evos = Array.isArray(data.evolvesTo) ? data.evolvesTo : [data.evolvesTo];
            for (const evo of evos) {
                this._baseIdCache[evo.id] = parseInt(id);
            }
        }
    }

    // ===================== 公共方法 =====================
    // 获取宝可梦的存储数据
    getStoredData(pokemonId) {
        return this.gameState.caughtPokemon[pokemonId] || null;
    }

    // ===================== 初始化 =====================
    initNewGame() {
        // 生成初始皮卡丘的个体值（存储在 caughtPokemon 中）
        const initialIvs = this.generateIVs();

        this._invalidateAllCaches();
        this.gameState = {
            schemaVersion: SAVE_SCHEMA_VERSION,
            team: [],               // 队伍（最多6只）- 只存储 pokemonId
            activePokemonIndex: 0,  // 出战宝可梦在队伍中的索引
            currentRegion: 'kanto',
            currentRoute: 'kanto_route1',
            pokedex: {},            // { pokemonId: 'seen' | 'caught' }
            caughtPokemon: {},      // { pokemonId: { ivs, level, exp } } - 按宝可梦自身ID存储
            shinyDex: {},           // { pokemonId: true } - 已获得闪光形态的宝可梦
            pokedexDisplay: {},     // { pokemonId: 'shiny' | undefined } - 图鉴展示偏好（闪光/原始）
            gold: 0,                // 金币
            badges: {},             // { regionId: { unlocked: true, gem: null|gemObj } }
            gems: [],               // 背包宝石数组，最多50个
            stats: {
                totalBattles: 0,
                totalCatches: 0,
                totalExp: 0,
                totalGold: 0,
                playTime: 0,
            },
            settings: {},
            // 树果系统
            berryPlots: [],         // 种植槽 [{ berryId, plantedAt }]  成熟判定: Date.now() - plantedAt >= BERRY_GROW_TIME
            berryBag: {},           // 树果背包 { berryId: count }
            berryFed: {},           // 宝可梦已喂食记录 { pokemonId: { berryId: count } }
            // 天赋系统
            talents: {},            // { talentId: level, gemAttrChoice: attrId }
            // 挑战塔系统
            tower: {
                currentFloor: 1,        // 当前挑战层数（1~100）
                highestFloor: 0,        // 历史最高通关层数
                enemies: null,          // 当前层敌方宝可梦数组
                currentEnemyIndex: 0,   // 当前打到第几只（0~5）
                inBattle: false,        // 是否正在挑战中
            },
            lastSave: Date.now(),
        };
        // 个体名册：ownedPokemon / party / pc / released / speciesPrimary
        PokemonRoster.initState(this.gameState);

        // 捕获初始皮卡丘（进化链基础ID是25），直接放进队伍
        this.catchPokemonWithIvs(25, 5, initialIvs, { origin: 'starter', originRoute: null, place: 'party' });

        this.saveNow();
        return this.gameState;
    }

    // 生成随机个体值
    generateIVs() {
        return {
            hp: Math.floor(this.rng() * 32),
            atk: Math.floor(this.rng() * 32),
            def: Math.floor(this.rng() * 32),
            spAtk: Math.floor(this.rng() * 32),
            spDef: Math.floor(this.rng() * 32),
            speed: Math.floor(this.rng() * 32),
        };
    }

    // 获取宝可梦的进化链基础ID（用于共享个体值）
    getBasePokemonId(pokemonId) {
        // 通过缓存递归查找最基础的形态
        const parentId = this._baseIdCache[pokemonId];
        if (parentId !== undefined) {
            return this.getBasePokemonId(parentId);
        }
        return pokemonId;
    }

    // 获取某只宝可梦的所有进化型（包括直接和间接进化）
    getAllEvolutions(pokemonId) {
        const evolutions = [];
        const data = POKEMON_DATA[pokemonId];
        if (!data || !data.evolvesTo) return evolutions;

        const directEvolutions = Array.isArray(data.evolvesTo) ? data.evolvesTo : [data.evolvesTo];
        
        for (const evo of directEvolutions) {
            evolutions.push(evo.id);
            // 递归获取间接进化
            const indirectEvolutions = this.getAllEvolutions(evo.id);
            evolutions.push(...indirectEvolutions);
        }
        
        return evolutions;
    }

    // 同步同进化链个体值（按每项最大值合并，避免低个体覆盖高个体）
    syncBestIvsInFamily(baseId, seedIvs = null) {
        const familyIds = [baseId, ...this.getAllEvolutions(baseId)];
        const bestIvs = { hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 };

        const mergeIvs = (ivs) => {
            if (!ivs) return;
            for (const stat in bestIvs) {
                bestIvs[stat] = Math.max(bestIvs[stat], ivs[stat] || 0);
            }
        };

        // 先合并本次候选个体值
        mergeIvs(seedIvs);

        // 再合并该进化链所有已拥有形态的个体值
        for (const id of familyIds) {
            const stored = this.gameState.caughtPokemon[id];
            if (stored?.ivs) {
                mergeIvs(stored.ivs);
            }
        }

        // 将"家族最优个体值"写回到所有已拥有形态
        for (const id of familyIds) {
            const stored = this.gameState.caughtPokemon[id];
            if (stored) {
                stored.ivs = { ...bestIvs };
                this._touchSpecies(id);
            }
        }

        return bestIvs;
    }


    // 捕获宝可梦（带指定个体值）
    // opts（可选）：{ origin, originRoute, place, shiny, traits }，默认来历为野外捕获，放进 PC。
    // 这个入口只负责“物种的第一只”；之后再遇到同种由 processDefeat 决定是否收为新的独立个体
    // （见 _captureDuplicate），否则只会提升主个体的个体值。
    catchPokemonWithIvs(pokemonId, level, ivs, opts = {}) {
        // 标记为已捕获
        this.gameState.pokedex[pokemonId] = 'caught';
        this.gameState.stats.totalCatches++;

        // 该物种还没有任何个体：创建第一只个体（它同时是旧结构 caughtPokemon[物种] 的数据本体）
        if (!this.roster.primaryOf(pokemonId)) {
            this.roster.create({
                speciesId: pokemonId,
                level,
                // 经验从该等级的起点开始（初始皮卡丘 Lv5 之前是 0，会让经验条显示为负数）
                exp: getExpForLevel(POKEMON_DATA[pokemonId].expGroup, level),
                ivs: { ...ivs },
                // 野生闪光，或家族传播来的“待定闪光”
                shiny: opts.shiny === true || !!this.gameState.shinyDex[pokemonId],
                // 没有传入特质时用中性性格（与旧版数值完全一致，且不消耗随机数）
                nature: opts.traits ? opts.traits.nature : DEFAULT_NATURE,
                ability: opts.traits ? opts.traits.ability : null,
                gender: opts.traits ? opts.traits.gender : null,
                origin: opts.origin || 'wild',
                originRoute: opts.originRoute !== undefined ? opts.originRoute : this.gameState.currentRoute,
                place: opts.place || 'pc',
            });
            this._touchSpecies(pokemonId);
        }

        // 捕获时检查进化
        this.checkEvolutionOnCatch(pokemonId);

        // 同进化链个体值对齐为各项最大值（防止前置形态首次捕获覆盖进化型高个体）
        const baseId = this.getBasePokemonId(pokemonId);
        this.syncBestIvsInFamily(baseId, ivs);

        if (this.onCatch) {
            const inst = this.roster.primaryOf(pokemonId);
            this.onCatch({ 
                id: pokemonId, 
                uid: inst ? inst.uid : null,
                name: POKEMON_DATA[pokemonId].name, 
                level: 1,
                isFirstCatch: true,
                shiny: !!(inst && inst.shiny),
            });
        }
    }

    // ===================== 重复捕获 =====================
    getCaptureDuplicatePolicy() {
        const p = this.gameState.settings?.captureDuplicates;
        return CAPTURE_DUPLICATE_POLICIES.includes(p) ? p : DEFAULT_CAPTURE_DUPLICATE_POLICY;
    }

    // 已拥有该物种时，这只野生宝可梦要不要收为新的个体？
    // 随机数只在“概率捕获”时消耗（策略 all 且非闪光），其余情况是确定性的。
    _shouldCaptureDuplicate(wild) {
        const policy = this.getCaptureDuplicatePolicy();
        if (policy === 'off') return false;
        if (wild.isShiny) return true;
        if (this.roster.countOfSpecies(wild.id) >= DUPLICATE_SPECIES_CAP) return false;
        if (policy === 'better') {
            const total = ivTotal(wild.ivs);
            return this.roster.ofSpecies(wild.id).every(i => total > ivTotal(i.ivs));
        }
        return this.rng() < DUPLICATE_CAPTURE_RATE;
    }

    // 把野生宝可梦收为一只全新的个体（新 uid；IV/性格/特性/性别/闪光各自独立；Lv1）。
    // 返回新个体，PC 已满时返回 null。
    _captureDuplicate(wild) {
        if (!this.roster.hasRoom()) {
            if (wild.isShiny && this.onBattleEvent) {
                this.onBattleEvent('captureBlocked', { id: wild.id, name: POKEMON_DATA[wild.id].name, reason: 'pc_full' });
            }
            return null;
        }
        const r = this.roster.create({
            speciesId: wild.id,
            level: 1,
            exp: getExpForLevel(POKEMON_DATA[wild.id].expGroup, 1),
            ivs: { ...wild.ivs },
            shiny: !!wild.isShiny,
            ...rollTraits(wild.id, this.rng),
            origin: 'wild',
            originRoute: this.gameState.currentRoute,
            place: 'pc',
        });
        if (!r.ok) return null;
        const inst = r.instance;
        this.gameState.stats.totalCatches++;
        // 闪光与图鉴的“物种级闪光”标记绑定在主个体上：还没有闪光主个体时，新的闪光个体成为主个体
        const primary = this.roster.primaryOf(wild.id);
        if (inst.shiny && primary && !primary.shiny) this.roster.setPrimary(inst.uid);
        this._touchSpecies(wild.id);
        return inst;
    }

    // 捕获时检查进化（处理捕捉时等级已超过进化等级的情况）
    checkEvolutionOnCatch(baseId) {
        this.checkEvolution(baseId, false);
    }

    // ===================== 宝可梦创建 =====================
    // 从 caughtPokemon 中获取数据创建宝可梦实例
    // instance（可选）：指定某一只个体；不传则使用该物种的主个体（旧行为）
    createPokemon(pokemonId, useStoredLevel = false, instance = null) {
        const baseData = POKEMON_DATA[pokemonId];
        if (!baseData) return null;

        const storedData = instance || this.getStoredData(pokemonId);
        if (!storedData) return null;

        const level = useStoredLevel ? storedData.level : 5;

        const pokemon = {
            uid: this.generateUID(),
            id: pokemonId,
            name: baseData.name,
            level: level,
            exp: getExpForLevel(baseData.expGroup, level),
            ivs: { ...storedData.ivs },
            // 指定个体：用它自己的闪光；否则沿用物种级的闪光图鉴记录（旧行为）
            isShiny: instance ? instance.shiny : !!this.gameState.shinyDex[pokemonId],
        };

        // 计算当前属性
        const stats = this.calculateStats(pokemon);
        pokemon.currentHp = stats.hp;

        return pokemon;
    }

    // 创建野生宝可梦（用于战斗）
    createWildPokemon(pokemonId, level, shinyRate = this.getShinyRate()) {
        const baseData = POKEMON_DATA[pokemonId];
        if (!baseData) return null;

        const ivs = this.generateIVs();

        // 闪光判定：基础 1/4096，叠加徽章/天赋/挑战塔加成（公式见 getShinyRate）
        const isShiny = this.rng() < shinyRate;

        const pokemon = {
            uid: this.generateUID(),
            id: pokemonId,
            name: baseData.name,
            level: level,
            exp: getExpForLevel(baseData.expGroup, level),
            ivs: ivs,
            isShiny: isShiny,
            isWild: true,
        };

        const stats = this.calculateStats(pokemon);
        pokemon.currentHp = stats.hp;

        return pokemon;
    }

    _uidCounter = 0;

    generateUID() {
        // 时间戳 + 自增计数器，兼顾速度与唯一性
        // 时间戳前缀保证不同会话不碰撞，自增后缀保证同批次不重复
        return Date.now().toString(36) + '_' + (++this._uidCounter).toString(36);
    }

    // ===================== 属性计算（简化公式） =====================
    // HP = floor((2 * Base + IV) * Level / 100) + Level + 10
    // Other = floor((2 * Base + IV) * Level / 100) + 5
    // 闪光加成 = 种族值 * 1.2（闪光宝可梦种族值提升20%）

    calculateBaseStats(pokemon) {
        const baseRaw = POKEMON_DATA[pokemon.id].baseStats;
        const level = pokemon.level;
        const ivs = pokemon.ivs;

        // 闪光宝可梦种族值增加20%（在种族值上限255之后再乘）
        const shinyBonus = pokemon.isShiny ? 1.2 : 1;

        // 树果加成（每个树果+5对应种族值，不含闪光上限255，闪光在封顶后再乘）
        // 只有己方宝可梦才享受树果加成，野生/敌方怪物不计算
        const berryBonuses = pokemon.isWild ? {} : this.getBerryBonuses(pokemon.id);

        const base = {
            hp: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.hp + (berryBonuses.hp || 0)) * shinyBonus),
            atk: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.atk + (berryBonuses.atk || 0)) * shinyBonus),
            def: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.def + (berryBonuses.def || 0)) * shinyBonus),
            spAtk: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.spAtk + (berryBonuses.spAtk || 0)) * shinyBonus),
            spDef: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.spDef + (berryBonuses.spDef || 0)) * shinyBonus),
            speed: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.speed + (berryBonuses.speed || 0)) * shinyBonus),
        };

        const hp = Math.floor((2 * base.hp + ivs.hp) * level / 100) + level + 10;
        const atk = Math.floor((2 * base.atk + ivs.atk) * level / 100) + 5;
        const def = Math.floor((2 * base.def + ivs.def) * level / 100) + 5;
        const spAtk = Math.floor((2 * base.spAtk + ivs.spAtk) * level / 100) + 5;
        const spDef = Math.floor((2 * base.spDef + ivs.spDef) * level / 100) + 5;
        const speed = Math.floor((2 * base.speed + ivs.speed) * level / 100) + 5;

        return { hp, atk, def, spAtk, spDef, speed };
    }

    // 获取含加成的种族值（闪光+树果），用于图鉴展示
    getEffectiveBaseStats(pokemonId) {
        const baseRaw = POKEMON_DATA[pokemonId]?.baseStats;
        if (!baseRaw) return null;
        const isShiny = !!this.gameState.shinyDex[pokemonId];
        const shinyBonus = isShiny ? 1.2 : 1;
        const berryBonuses = this.getBerryBonuses(pokemonId);
        return {
            hp: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.hp + (berryBonuses.hp || 0)) * shinyBonus),
            atk: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.atk + (berryBonuses.atk || 0)) * shinyBonus),
            def: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.def + (berryBonuses.def || 0)) * shinyBonus),
            spAtk: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.spAtk + (berryBonuses.spAtk || 0)) * shinyBonus),
            spDef: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.spDef + (berryBonuses.spDef || 0)) * shinyBonus),
            speed: Math.floor(Math.min(BERRY_STAT_CAP, baseRaw.speed + (berryBonuses.speed || 0)) * shinyBonus),
        };
    }

    // 游戏中的简化属性: 生命值、攻击力(物攻+特攻)、防御(物防+特防)、速度
    calculateStats(pokemon) {
        const rawStats = this.calculateBaseStats(pokemon);
        return {
            hp: rawStats.hp,
            attack: rawStats.atk + rawStats.spAtk,
            defense: rawStats.def + rawStats.spDef,
            speed: rawStats.speed,
            // 保留原始值用于显示
            rawAtk: rawStats.atk,
            rawSpAtk: rawStats.spAtk,
            rawDef: rawStats.def,
            rawSpDef: rawStats.spDef,
        };
    }

    // 计算战力 = (HP + 攻击×技能威力系数 + 防御 + 速度) / 10
    // 技能等级通过技能威力影响攻击力评估：技能威力/50 作为攻击力系数
    calculatePower(pokemonId, useStoredLevel = true, instance = null) {
        const pokemon = this.createPokemon(pokemonId, useStoredLevel, instance);
        if (!pokemon) return 0;

        const stats = this.calculateStats(pokemon);

        // 技能等级对攻击力的加成：取所有技能中最高威力
        let skillMultiplier = 1;
        const skillInfo = this.getSkillForPokemon(pokemonId, instance);
        if (skillInfo && skillInfo.skills.length > 0) {
            const maxSkillPower = Math.max(...skillInfo.skills.map(s => s.power));
            skillMultiplier = maxSkillPower / 50; // 基础威力为50
        }

        const effectiveAttack = Math.floor(stats.attack * skillMultiplier);
        const totalStats = stats.hp + effectiveAttack + stats.defense + stats.speed;
        return Math.floor(totalStats / 10);
    }

    // 计算潜力值 (0-100%) - 用于评估养成价值
    // 基于: 经验组评分 + 100级属性评分
    calculatePotential(pokemonId, instance = null) {
        const baseData = POKEMON_DATA[pokemonId];
        if (!baseData) return 0;

        // 获取存储的数据（指定个体 或 物种主个体）
        const storedData = instance || this.getStoredData(pokemonId);
        if (!storedData) return 0;

        // 1. 经验组评分 (0-9分) - 固定阶梯评分
        const EXP_GROUP_SCORES = {
            fast: 9,        // 80万经验
            medium: 6,      // 100万经验
            mediumSlow: 3,  // ~106万经验
            slow: 0         // 125万经验
        };
        const expScore = EXP_GROUP_SCORES[baseData.expGroup] || 0;

        // 2. 100级属性评分 (0-91分) - 基于成长值（6项权重一致）
        const baseStatsRaw = baseData.baseStats;
        const ivs = storedData.ivs;

        // 闪光宝可梦种族值增加20%
        const isShiny = instance ? instance.shiny : !!this.gameState.shinyDex[pokemonId];
        const shinyBonus = isShiny ? 1.2 : 1;

        // 树果加成（与 calculateBaseStats 保持一致）
        const berryBonuses = this.getBerryBonuses(pokemonId);

        // 计算各项成长值 = (种族值+树果加成, 上限255)×闪光×2 + 个体值
        const growthHp = Math.floor(Math.min(BERRY_STAT_CAP, baseStatsRaw.hp + (berryBonuses.hp || 0)) * shinyBonus) * 2 + ivs.hp;
        const growthAtk = Math.floor(Math.min(BERRY_STAT_CAP, baseStatsRaw.atk + (berryBonuses.atk || 0)) * shinyBonus) * 2 + ivs.atk;
        const growthDef = Math.floor(Math.min(BERRY_STAT_CAP, baseStatsRaw.def + (berryBonuses.def || 0)) * shinyBonus) * 2 + ivs.def;
        const growthSpAtk = Math.floor(Math.min(BERRY_STAT_CAP, baseStatsRaw.spAtk + (berryBonuses.spAtk || 0)) * shinyBonus) * 2 + ivs.spAtk;
        const growthSpDef = Math.floor(Math.min(BERRY_STAT_CAP, baseStatsRaw.spDef + (berryBonuses.spDef || 0)) * shinyBonus) * 2 + ivs.spDef;
        const growthSpeed = Math.floor(Math.min(BERRY_STAT_CAP, baseStatsRaw.speed + (berryBonuses.speed || 0)) * shinyBonus) * 2 + ivs.speed;

        // 6项成长值总和
        const totalGrowth = growthHp + growthAtk + growthDef + growthSpAtk + growthSpDef + growthSpeed;

        // 归一化到0-91分
        // 最低：鲤鱼王0个体值 = (20+10+55+15+20+80)×2 = 400
        // 最高：超梦31个体值 = (106+110+90+154+90+130)×2 + 31×6 = 1554
        const MIN_GROWTH = 400;
        const MAX_GROWTH = 1554;

        const statScore = Math.floor(
            (totalGrowth - MIN_GROWTH) / (MAX_GROWTH - MIN_GROWTH) * 91
        );

        // 总分 (0-100) = 经验分(0-9) + 属性分(0-91) 可以超过100
        const potential = expScore + statScore;
        return Math.max(0, potential);
    }

    // 单只个体的基础属性（按 uid 缓存）。输入：该个体的等级/个体值/闪光，以及物种级的树果。
    // 任何改动这些数据的代码都必须调用 _touchSpecies / _touchInstance。
    _getInstanceStats(inst) {
        const cached = this._instanceStats.get(inst.uid);
        if (cached) return cached;
        // 旧代码只会写 shinyDex（物种级标记）：主个体在这里与它对齐
        if (!inst.shiny && this.gameState.shinyDex[inst.speciesId] && this.roster.isPrimary(inst)) inst.shiny = true;
        const stats = this.calculateStats({
            id: inst.speciesId,
            level: inst.level,
            ivs: inst.ivs,
            isShiny: inst.shiny,
        });
        this._instanceStats.set(inst.uid, stats);
        return stats;
    }

    // 旧接口：某个物种的属性 = 它的主个体
    // 没有活着的个体时退回图鉴存档（最后一只个体进化走了，图鉴里仍保留着它）
    _getSpeciesStats(id) {
        const primary = this.roster.primaryOf(id);
        if (primary) return this._getInstanceStats(primary);
        const archived = this.gameState.archivedSpecies;
        if (!archived || !_has(archived, id)) return null;
        const key = '~' + id;
        const cached = this._instanceStats.get(key);
        if (cached) return cached;
        const rec = archived[id];
        const stats = this.calculateStats({ id, level: rec.level, ivs: rec.ivs, isShiny: !!this.gameState.shinyDex[id] });
        this._instanceStats.set(key, stats);
        return stats;
    }

    // 图鉴中已捕获但不在队伍中的宝可梦 1% 加成（缓存；队伍或任一物种变化时失效）
    _getPokedexBonus(team) {
        const key = team.join(',');
        if (this._dexBonus && this._dexBonus.key === key) return this._dexBonus.value;
        const value = { hp: 0, attack: 0, defense: 0, speed: 0 };
        const teamSet = new Set(team.map(id => String(id)));
        for (const dexId in this.gameState.pokedex) {
            if (this.gameState.pokedex[dexId] === 'caught' && !teamSet.has(dexId)) {
                const s = this._getSpeciesStats(parseInt(dexId));
                if (s) {
                    value.hp += s.hp * 0.01;
                    value.attack += s.attack * 0.01;
                    value.defense += s.defense * 0.01;
                    value.speed += s.speed * 0.01;
                }
            }
        }
        this._dexBonus = { key, value };
        return value;
    }

    // 出战宝可梦的实际属性 = 自己 + 队伍其他5只的20% + 图鉴其余所有宝可梦的1%
    calculateBattleStats(pokemonIndex) {
        if (!this.gameState || !this.gameState.team) return null;

        this.roster.reconcile();
        const team = this.gameState.team;
        const party = this.gameState.party;
        const owned = this.gameState.ownedPokemon;
        if (pokemonIndex < 0 || pokemonIndex >= party.length) return null;

        // 出战者与队友都按“个体”计算：同一物种的两只个体可以有不同的等级/个体值/闪光
        const self = owned[party[pokemonIndex]];
        if (!self) return null;
        const baseStats = this._getInstanceStats(self);

        // 队伍内其他宝可梦的加成 (20%)
        const teamBonus = { hp: 0, attack: 0, defense: 0, speed: 0 };
        for (let i = 0; i < party.length; i++) {
            if (i !== pokemonIndex) {
                const mate = owned[party[i]];
                const s = mate ? this._getInstanceStats(mate) : null;
                if (s) {
                    teamBonus.hp += s.hp * 0.2;
                    teamBonus.attack += s.attack * 0.2;
                    teamBonus.defense += s.defense * 0.2;
                    teamBonus.speed += s.speed * 0.2;
                }
            }
        }

        // 图鉴中已捕获但不在队伍中的宝可梦加成 (1%)
        const pokedexBonus = this._getPokedexBonus(team);

        let finalHp = Math.floor(baseStats.hp + teamBonus.hp + pokedexBonus.hp);
        let finalAttack = Math.floor(baseStats.attack + teamBonus.attack + pokedexBonus.attack);
        let finalDefense = Math.floor(baseStats.defense + teamBonus.defense + pokedexBonus.defense);
        let finalSpeed = Math.floor(baseStats.speed + teamBonus.speed + pokedexBonus.speed);

        // 宝石属性百分比加成
        const gemBonuses = this.getGemBonuses();
        if (gemBonuses.hp_bonus > 0) finalHp = Math.floor(finalHp * (1 + gemBonuses.hp_bonus / 100));
        if (gemBonuses.atk_bonus > 0) finalAttack = Math.floor(finalAttack * (1 + gemBonuses.atk_bonus / 100));
        if (gemBonuses.def_bonus > 0) finalDefense = Math.floor(finalDefense * (1 + gemBonuses.def_bonus / 100));
        if (gemBonuses.speed_bonus > 0) finalSpeed = Math.floor(finalSpeed * (1 + gemBonuses.speed_bonus / 100));

        // 天赋：宝可梦全属性增加（技能等级之和 × 天赋等级 × 0.02%）
        const talentStatBonus = this.getTalentStatBonusPercent();
        if (talentStatBonus > 0) {
            finalHp = Math.floor(finalHp * (1 + talentStatBonus / 100));
            finalAttack = Math.floor(finalAttack * (1 + talentStatBonus / 100));
            finalDefense = Math.floor(finalDefense * (1 + talentStatBonus / 100));
            finalSpeed = Math.floor(finalSpeed * (1 + talentStatBonus / 100));
        }

        return {
            hp: finalHp,
            attack: finalAttack,
            defense: finalDefense,
            speed: finalSpeed,
            baseHp: baseStats.hp,
            baseAttack: baseStats.attack,
            baseDefense: baseStats.defense,
            baseSpeed: baseStats.speed,
            rawAtk: baseStats.rawAtk,
            rawSpAtk: baseStats.rawSpAtk,
            rawDef: baseStats.rawDef,
            rawSpDef: baseStats.rawSpDef,
        };
    }

    // 获取出战宝可梦属性来源分解（仅在设置页统计时调用，非高频）
    getStatSources(teamIndex) {
        if (!this.gameState.team || this.gameState.team.length === 0) return null;
        const idx = teamIndex ?? this.gameState.activePokemonIndex;
        const selfInst = this._partyInstance(idx);
        const pokemonId = selfInst ? selfInst.speciesId : null;
        if (!pokemonId) return null;

        const pokemon = this.createPokemon(pokemonId, true, selfInst);
        if (!pokemon) return null;

        const baseStats = this.calculateStats(pokemon);
        // 队友加成
        const teamBonus = { hp: 0, attack: 0, defense: 0, speed: 0 };
        for (let i = 0; i < this.gameState.team.length; i++) {
            if (i === idx) continue;
            const mateInst = this._partyInstance(i);
            const mate = mateInst ? this.createPokemon(mateInst.speciesId, true, mateInst) : null;
            if (mate) {
                const ms = this.calculateStats(mate);
                teamBonus.hp += ms.hp * 0.2;
                teamBonus.attack += ms.attack * 0.2;
                teamBonus.defense += ms.defense * 0.2;
                teamBonus.speed += ms.speed * 0.2;
            }
        }
        // 图鉴加成
        const pokedexBonus = { hp: 0, attack: 0, defense: 0, speed: 0 };
        const teamSet = new Set(this.gameState.team.map(id => String(id)));
        for (const dexId in this.gameState.pokedex) {
            if (this.gameState.pokedex[dexId] === 'caught' && !teamSet.has(dexId)) {
                const dexPokemon = this.createPokemon(parseInt(dexId), true);
                if (dexPokemon) {
                    const s = this.calculateStats(dexPokemon);
                    pokedexBonus.hp += s.hp * 0.01;
                    pokedexBonus.attack += s.attack * 0.01;
                    pokedexBonus.defense += s.defense * 0.01;
                    pokedexBonus.speed += s.speed * 0.01;
                }
            }
        }

        const selfStat = { hp: baseStats.hp, attack: baseStats.attack, defense: baseStats.defense, speed: baseStats.speed };
        const teamStat = { hp: Math.floor(teamBonus.hp), attack: Math.floor(teamBonus.attack), defense: Math.floor(teamBonus.defense), speed: Math.floor(teamBonus.speed) };
        const pokedexStat = { hp: Math.floor(pokedexBonus.hp), attack: Math.floor(pokedexBonus.attack), defense: Math.floor(pokedexBonus.defense), speed: Math.floor(pokedexBonus.speed) };

        // 宝石加成
        const gemBonuses = this.getGemBonuses();
        const gemStat = {
            hp: gemBonuses.hp_bonus > 0 ? Math.floor((baseStats.hp + teamStat.hp + pokedexStat.hp) * gemBonuses.hp_bonus / 100) : 0,
            attack: gemBonuses.atk_bonus > 0 ? Math.floor((baseStats.attack + teamStat.attack + pokedexStat.attack) * gemBonuses.atk_bonus / 100) : 0,
            defense: gemBonuses.def_bonus > 0 ? Math.floor((baseStats.defense + teamStat.defense + pokedexStat.defense) * gemBonuses.def_bonus / 100) : 0,
            speed: gemBonuses.speed_bonus > 0 ? Math.floor((baseStats.speed + teamStat.speed + pokedexStat.speed) * gemBonuses.speed_bonus / 100) : 0,
        };

        // 天赋加成
        const talentStatBonus = this.getTalentStatBonusPercent();
        const battleStats = this.calculateBattleStats(idx);
        const talentStat = {
            hp: talentStatBonus > 0 ? battleStats.hp - Math.floor(battleStats.hp / (1 + talentStatBonus / 100)) : 0,
            attack: talentStatBonus > 0 ? battleStats.attack - Math.floor(battleStats.attack / (1 + talentStatBonus / 100)) : 0,
            defense: talentStatBonus > 0 ? battleStats.defense - Math.floor(battleStats.defense / (1 + talentStatBonus / 100)) : 0,
            speed: talentStatBonus > 0 ? battleStats.speed - Math.floor(battleStats.speed / (1 + talentStatBonus / 100)) : 0,
        };

        return {
            pokemonName: POKEMON_DATA[pokemonId]?.name || `#${pokemonId}`,
            level: pokemon.level,
            battleStats,
            self: selfStat,
            team: teamStat,
            pokedex: pokedexStat,
            gem: gemStat,
            talent: talentStat,
        };
    }

    // ===================== 战斗公共方法（在线/离线复用） =====================

    // 获取对敌方最优技能：返回 { power, name, type } 或 { power: 0, name: '', type: '' }
    _getBestSkillForEnemy(pokemonId, wildTypes) {
        return this._getBestSkillForInstance(this.roster.primaryOf(pokemonId), wildTypes);
    }

    // 指定个体对敌人最优的技能（个体自己的技能等级）
    _getBestSkillForInstance(inst, wildTypes) {
        const result = { power: 0, name: '', type: '' };
        const skillInfo = inst ? this.getSkillForInstance(inst) : null;
        if (!skillInfo || skillInfo.skills.length === 0) return result;

        let bestSkill = skillInfo.skills[0];
        if (skillInfo.skills.length > 1) {
            let bestMult = 0;
            for (const sk of skillInfo.skills) {
                const eff = getBestTypeEffectiveness([sk.type], wildTypes);
                if (eff.multiplier > bestMult || bestMult === 0) {
                    bestMult = eff.multiplier;
                    bestSkill = sk;
                }
            }
        }
        result.power = bestSkill.power;
        result.name = bestSkill.name;
        result.type = bestSkill.type;
        return result;
    }

    // 闪光双向传播：将闪光状态同步到整条进化链（基础型 ↔ 进化型）
    // 当任意形态获得闪光时调用，自动传播给链上所有已拥有的形态
    _syncShinyInFamily(pokemonId) {
        const baseId = this.getBasePokemonId(pokemonId);
        const familyIds = [baseId, ...this.getAllEvolutions(baseId)];

        for (const id of familyIds) {
            if (id === pokemonId) continue; // 跳过自身（已设置）

            if (!this.gameState.shinyDex[id]) {
                this.gameState.shinyDex[id] = true;
                this._touchSpecies(id);

                if (this.onBattleEvent) {
                    const name = POKEMON_DATA[id]?.name || `#${id}`;
                    const srcName = POKEMON_DATA[pokemonId]?.name || `#${pokemonId}`;
                    this.onBattleEvent('shinySpread', {
                        sourceId: pokemonId,
                        sourceName: srcName,
                        targetId: id,
                        targetName: name,
                    });
                }
            }
        }
    }

    // 胜利结算（在线/离线共用）：经验/金币/回血/捕获/闪光/自动切地图
    // sim 为离线模拟状态：提供缓存加成，并把图鉴经验累积起来批量写入。
    // 返回 { expGained, goldGained, healAmount, newPlayerHp, autoSwitchResult, anyLevelUp }
    _processVictoryRewards(wildPokemon, activePokemonId, playerMaxHp, playerCurrentHp, sim = null) {
        const state = this.gameState;
        const b = sim ? sim.bonuses : this.getProgressBonuses();
        state.stats.totalBattles++;

        // 图鉴标记
        if (!state.pokedex[wildPokemon.id]) {
            state.pokedex[wildPokemon.id] = 'seen';
        }

        // 计算经验值
        const baseExp = this.getBaseExpYield(wildPokemon.id, wildPokemon.level);
        const expGained = this._applyExpBonuses(Math.floor(baseExp * wildPokemon.level / 7), b);

        // 出战精灵获得100%经验（经验记在“出战的那一只个体”身上）
        this.roster.reconcile();
        let activeInst = this._partyInstance(state.activePokemonIndex);
        // 出战个体以队伍位置为准（它可能在上一场刚进化，物种 id 与调用方缓存的不同）
        if (!activeInst) activeInst = this.roster.primaryOf(activePokemonId);
        let anyLevelUp = false;
        if (activeInst) {
            anyLevelUp = !!this.addExpToInstance(activeInst, expGained);
            activeInst.battles++;
            activeInst.stats.victories++;
        }

        // 队伍内其他精灵获得50%经验（各自独立）
        const teamExp = Math.floor(expGained * b.teamExpRate);
        for (let i = 0; i < state.party.length; i++) {
            if (i !== state.activePokemonIndex) {
                const mate = this._partyInstance(i);
                if (mate && this.addExpToInstance(mate, teamExp)) anyLevelUp = true;
            }
        }

        // 图鉴宝可梦获得1%经验（离线：先累积，批量写入）
        const reserveExp = Math.ceil(expGained * b.reserveExpRate);
        for (const pokemonId in state.caughtPokemon) {
            const id = parseInt(pokemonId);
            if (!state.team.includes(id)) {
                if (sim) sim.pokedexExpAccumulator[id] = (sim.pokedexExpAccumulator[id] || 0) + reserveExp;
                else this.addExpToPokemon(id, reserveExp);
            }
        }
        state.stats.totalExp += expGained;

        // 金币掉落
        let goldGained = 0;
        if (this.isGoldUnlocked()) {
            goldGained = this.calculateGoldDrop(wildPokemon);
            this.addGold(goldGained);
        }

        // 更新实际速率跟踪器
        this._updateRateTracker(expGained, goldGained);

        // 胜利回血
        const healAmount = Math.floor(playerMaxHp * b.healPercent);
        const newPlayerHp = Math.min(playerMaxHp, playerCurrentHp + healAmount);

        // 击败处理（捕获/IV更新/地区解锁/徽章）
        // 捕获闪光个体时 roster 会先把 shinyDex 写好，所以“是不是第一次闪光”要在击败处理之前记下
        const wasShinyKnown = !!state.shinyDex[wildPokemon.id];
        this.processDefeat(wildPokemon);

        // 闪光记录：击败闪光宝可梦后，双向传播闪光给整条进化链
        if (wildPokemon.isShiny && !wasShinyKnown) {
            state.shinyDex[wildPokemon.id] = true;
            this._touchSpecies(wildPokemon.id);
            this._syncShinyInFamily(wildPokemon.id);
        }

        // 自动切换地图
        const autoSwitchResult = this.tryAutoRouteSwitch();

        return { expGained, goldGained, healAmount, newPlayerHp, autoSwitchResult, anyLevelUp };
    }

    // #3 刷写图鉴经验累积器
    _flushPokedexExpAccumulator(accumulator) {
        for (const id in accumulator) {
            if (accumulator[id] > 0) {
                this.addExpToPokemon(parseInt(id), accumulator[id]);
            }
        }
        // 清空累积器
        for (const id in accumulator) {
            delete accumulator[id];
        }
    }

    // ===================== 伤害计算（官方公式简化版） =====================
    // Damage = ((2*Level/5+2) * Power * A/D / 50 + 2) * Type * CriticalHit * Random
    // 在线(battleTick)与离线模拟共用 _computeDamage，保证两边公式与随机数消耗顺序一致。
    _computeDamage(attackerLevel, attackStat, defenseStat, attackerTypes, defenderTypes, power, critRate, critMultiplier) {
        // 基础伤害
        let damage = Math.floor(((2 * attackerLevel / 5 + 2) * power * attackStat / defenseStat) / 50) + 2;

        // 属性相克倍率（双属性攻击方取最优属性，倍率×0.75）
        let typeEffectiveness = 1;
        let effectivenessText = '';
        if (attackerTypes && defenderTypes && attackerTypes.length > 0) {
            typeEffectiveness = getBestTypeEffectiveness(attackerTypes, defenderTypes).multiplier;
            damage = Math.floor(damage * typeEffectiveness);

            if (typeEffectiveness <= 0.25) effectivenessText = '微弱伤害...';
            else if (typeEffectiveness > 1) effectivenessText = '效果拔群！';
            else if (typeEffectiveness < 1) effectivenessText = '效果不佳...';
        }

        // 会心一击判定
        let criticalHit = false;
        if (this.rng() < critRate) {
            damage = Math.floor(damage * critMultiplier);
            criticalHit = true;
        }

        // 随机数 (85%~100%)
        damage = Math.floor(damage * ((Math.floor(this.rng() * 16) + 85) / 100));

        // 最低1点伤害
        damage = Math.max(1, damage);

        return { damage, criticalHit, typeEffectiveness, effectivenessText };
    }

    // 公开接口：skillPower<=0 时使用固定威力 50
    calculateDamage(attackerLevel, attackStat, defenseStat, attackerTypes, defenderTypes, isPlayer = false, skillPower = 0) {
        const crit = this._getCritParams(isPlayer);
        return this._computeDamage(
            attackerLevel, attackStat, defenseStat, attackerTypes, defenderTypes,
            skillPower > 0 ? skillPower : 50, crit.rate, crit.multiplier
        );
    }

    // ===================== 攻击间隔计算 =====================
    // 反比例曲线，前期平缓，后期持续有提升，无限趋近100ms
    getAttackInterval(speed) {
        // interval = 100 + 1900 / (1 + speed / 14000)
        // speed=10 → 1999ms, speed=10000 → 911ms, speed=100000 → 377ms
        // speed → ∞ 时趋近100ms，但永远达不到
        const interval = 100 + 1900 / (1 + speed / 14000);
        return interval;
    }

    // ===================== 战斗系统 =====================
    startBattle() {
        if (!this.gameState || !this.gameState.currentRoute) return;
        if (!this.gameState.team || this.gameState.team.length === 0) return;
        this.roster.reconcile();
        if (this.gameState.activePokemonIndex >= this.gameState.team.length) {
            this.gameState.activePokemonIndex = 0;
        }

        const route = this.getRoute(this.gameState.currentRoute);
        if (!route) return;

        // 优先使用保存的敌方宝可梦（更换宝可梦或刷新页面时不重新生成）
        let wildPokemon = this.gameState.currentEnemy;
        let isExistingEnemy = !!wildPokemon; // 标记是否为已存在的敌人（非新生成）
        if (!wildPokemon) {
            wildPokemon = this.generateWildPokemon(route);
            if (!wildPokemon) return;
            this.gameState.currentEnemy = wildPokemon;
            this.save();

            // 自动更换最优宝可梦出战
            if (this.gameState.settings?.autoSwitchBest && this.gameState.team.length > 1) {
                const bestIndex = this.getBestTeamMemberForEnemy(wildPokemon);
                if (bestIndex !== -1 && bestIndex !== this.gameState.activePokemonIndex) {
                    this.gameState.activePokemonIndex = bestIndex;
                    this.save();
                    // 通知UI刷新队伍面板
                    if (this.onBattleEvent) {
                        this.onBattleEvent('autoSwitched', { newIndex: bestIndex });
                    }
                }
            }
        }

        // 标记为已发现
        if (!this.gameState.pokedex[wildPokemon.id]) {
            this.gameState.pokedex[wildPokemon.id] = 'seen';
        }

        // 获取出战宝可梦的战斗属性
        const playerStats = this.calculateBattleStats(this.gameState.activePokemonIndex);
        if (!playerStats) return;
        const enemyStats = this.calculateStats(wildPokemon);

        // 恢复血量：优先从内存中继承（连续战斗），其次从存档恢复（刷新页面）
        // 关键：使用血量百分比继承，避免升级/切换宝可梦后绝对值不匹配
        const previousHp = this.currentBattle?.playerCurrentHp;
        const previousMaxHp = this.currentBattle?.playerMaxHp;
        const savedBattleHp = this.gameState.battleHp;
        let restoredPlayerHp = playerStats.hp; // 默认满血
        let restoredEnemyHp = enemyStats.hp;   // 默认满血

        if (previousHp > 0 && previousMaxHp > 0) {
            // 连续战斗，按百分比继承血量（兼容升级/自动切换导致的maxHp变化）
            const hpPercent = previousHp / previousMaxHp;
            restoredPlayerHp = Math.max(1, Math.floor(playerStats.hp * hpPercent));
        } else if (savedBattleHp) {
            // 刷新页面后从存档恢复（按百分比）
            if (savedBattleHp.playerHp > 0) {
                if (savedBattleHp.playerMaxHp > 0) {
                    // 有存档maxHp，按百分比恢复
                    const savedPercent = savedBattleHp.playerHp / savedBattleHp.playerMaxHp;
                    restoredPlayerHp = Math.max(1, Math.floor(playerStats.hp * savedPercent));
                } else {
                    // 旧存档没有maxHp字段，兼容回退
                    restoredPlayerHp = Math.min(savedBattleHp.playerHp, playerStats.hp);
                }
            }
            // 只有敌人是刷新前就存在的（非新生成的）才恢复敌方血量
            if (isExistingEnemy && savedBattleHp.enemyHp > 0) {
                restoredEnemyHp = Math.min(savedBattleHp.enemyHp, enemyStats.hp);
            }
        }

        // 恢复攻击进度（仅刷新页面时，且敌人是同一个）
        let restoredPlayerTimer = 0;
        let restoredEnemyTimer = 0;
        if (!previousHp && savedBattleHp && isExistingEnemy) {
            restoredPlayerTimer = savedBattleHp.playerTimer || 0;
            restoredEnemyTimer = savedBattleHp.enemyTimer || 0;
        }

        this.currentBattle = {
            wild: wildPokemon,
            wildMaxHp: enemyStats.hp,
            wildCurrentHp: restoredEnemyHp,
            wildStats: enemyStats,
            playerMaxHp: playerStats.hp,
            playerCurrentHp: restoredPlayerHp,
            playerStats: playerStats,
            playerNextAttack: this.getAttackInterval(playerStats.speed),
            enemyNextAttack: this.getAttackInterval(enemyStats.speed),
            playerTimer: restoredPlayerTimer,
            enemyTimer: restoredEnemyTimer,
            lastTick: Date.now(),
        };
        this._cacheBattleDerived();

        // 清除已使用的存档状态（避免下一场战斗重复恢复）
        if (savedBattleHp) {
            delete this.gameState.battleHp;
        }

        if (this.onBattleEvent) {
            this.onBattleEvent('start', this.currentBattle);
        }

        this.startBattleLoop();
    }

    startBattleLoop() {
        this._stopBattleTimer();

        if (this._useWorkerTimer) {
            const cb = () => { this.battleTick(); };
            this.battleTimer = this._workerSetInterval(cb, 50);
        } else {
            this.battleTimer = setInterval(() => {
                this.battleTick();
            }, 50);
        }
    }

    _stopBattleTimer() {
        if (this.battleTimer) {
            if (this._useWorkerTimer) {
                this._workerClearInterval(this.battleTimer);
            } else {
                clearInterval(this.battleTimer);
            }
            this.battleTimer = null;
        }
    }

    stopBattle() {
        this._stopBattleTimer();
        if (this._nextBattleTimeout) {
            clearTimeout(this._nextBattleTimeout);
            this._nextBattleTimeout = null;
            this._nextBattleScheduledAt = null;
        }
        this._clearHealTimer();
    }

    _clearHealTimer() {
        if (this.healTimer) {
            this._workerClearInterval(this.healTimer);
            this.healTimer = null;
        }
    }

    // 战斗内每次攻击都要用到、但在一场战斗中不会变化的数据，开战/换人/换宝石时计算一次
    _cacheBattleDerived() {
        const battle = this.currentBattle;
        if (!battle) return;
        const state = this.gameState;
        const inst = this._partyInstance(state.activePokemonIndex);
        const wildTypes = POKEMON_DATA[battle.wild.id]?.types || [];
        const skill = this._getBestSkillForInstance(inst, wildTypes);
        battle.derived = {
            activeInst: inst,                    // 出战个体（战斗统计直接累加到它身上）
            playerLevel: inst ? inst.level : 5,
            playerTypes: inst ? (POKEMON_DATA[inst.speciesId]?.types || []) : [],
            wildTypes,
            playerPower: skill.power > 0 ? skill.power : 50,
            skillName: skill.name,
            skillType: skill.type,
            playerCrit: this._getCritParams(true),
            enemyCrit: this._getCritParams(false),
            dodgeRate: Math.min(75, this.getGemBonuses().dodge_rate) / 100,
        };
    }

    // 失败后逐步回复生命值：每秒回复20%，直到100%（使用 Worker 定时器，后台不被节流）
    startHealingAfterDefeat() {
        if (!this.currentBattle) return;
        this._clearHealTimer();

        const maxHp = this.currentBattle.playerMaxHp;
        const healPerSecond = Math.max(1, Math.floor(maxHp * DEFEAT_HEAL_PERCENT_PER_SEC));

        this.healTimer = this._workerSetInterval(() => {
            if (!this.currentBattle) {
                this._clearHealTimer();
                return;
            }

            // 回复生命值
            this.currentBattle.playerCurrentHp = Math.min(maxHp, this.currentBattle.playerCurrentHp + healPerSecond);

            // 通知UI更新
            if (this.onBattleEvent) {
                this.onBattleEvent('healing', {
                    hp: this.currentBattle.playerCurrentHp,
                    maxHp: maxHp,
                });
            }

            // 回复满后重新开始战斗
            if (this.currentBattle.playerCurrentHp >= maxHp) {
                this.currentBattle.playerCurrentHp = maxHp;
                this._clearHealTimer();
                // 战斗失败后更换敌人
                this.gameState.currentEnemy = null;
                this.save();
                this.startBattle();
            }
        }, 1000); // 每秒回复一次
    }

    battleTick() {
        const battle = this.currentBattle;
        if (!battle) return;
        if (!battle.derived) this._cacheBattleDerived();
        const d = battle.derived;

        const now = Date.now();
        const delta = now - battle.lastTick;
        battle.lastTick = now;

        battle.playerTimer += delta;
        battle.enemyTimer += delta;

        // 玩家攻击
        if (battle.playerTimer >= battle.playerNextAttack) {
            battle.playerTimer = 0;
            const result = this._computeDamage(
                d.playerLevel, battle.playerStats.attack, battle.wildStats.defense,
                d.playerTypes, d.wildTypes, d.playerPower,
                d.playerCrit.rate, d.playerCrit.multiplier
            );
            battle.wildCurrentHp -= result.damage;
            if (d.activeInst) {
                d.activeInst.stats.damageDealt += result.damage;
                if (result.criticalHit) d.activeInst.stats.criticalHits++;
            }

            if (this.onBattleEvent) {
                this.onBattleEvent('playerAttack', {
                    damage: result.damage,
                    critical: result.criticalHit,
                    typeEffectiveness: result.typeEffectiveness,
                    effectivenessText: result.effectivenessText,
                    hp: battle.wildCurrentHp,
                    maxHp: battle.wildMaxHp,
                    skillName: d.skillName,
                    skillType: d.skillType,
                });
            }

            // 野生宝可梦被击败
            if (battle.wildCurrentHp <= 0) {
                battle.wildCurrentHp = 0;
                if (this._towerMode) {
                    this.onTowerEnemyDefeated();
                } else {
                    this.onEnemyDefeated();
                }
                return;
            }
        }

        // 敌方攻击
        if (battle.enemyTimer >= battle.enemyNextAttack) {
            battle.enemyTimer = 0;

            // 闪避判定（宝石加成，上限75%）
            if (d.dodgeRate > 0 && this.rng() < d.dodgeRate) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('playerDodge', {});
                }
                // 闪避成功，不受伤害
            } else {
                const result = this._computeDamage(
                    battle.wild.level, battle.wildStats.attack, battle.playerStats.defense,
                    d.wildTypes, d.playerTypes, 50,
                    d.enemyCrit.rate, d.enemyCrit.multiplier
                );
                battle.playerCurrentHp -= result.damage;
                if (d.activeInst) d.activeInst.stats.damageTaken += result.damage;

                if (this.onBattleEvent) {
                    this.onBattleEvent('enemyAttack', {
                        damage: result.damage,
                        critical: result.criticalHit,
                        typeEffectiveness: result.typeEffectiveness,
                        effectivenessText: result.effectivenessText,
                        hp: battle.playerCurrentHp,
                        maxHp: battle.playerMaxHp,
                    });
                }

                // 玩家宝可梦被击败
                if (battle.playerCurrentHp <= 0) {
                    battle.playerCurrentHp = 0;
                    if (d.activeInst) d.activeInst.stats.faints++;
                    if (this.onBattleEvent) {
                        this.onBattleEvent('playerFainted', {});
                    }
                    if (this._towerMode) {
                        this.onTowerPlayerFainted();
                    } else {
                        this.stopBattle();
                        // 开始逐步回复生命值
                        this.startHealingAfterDefeat();
                    }
                    return;
                }
            }
        }

        // 更新HP条（UI）
        if (this.onBattleEvent) {
            this.onBattleEvent('tick', {
                playerHp: battle.playerCurrentHp,
                playerMaxHp: battle.playerMaxHp,
                enemyHp: battle.wildCurrentHp,
                enemyMaxHp: battle.wildMaxHp,
                playerAttackProgress: battle.playerTimer / battle.playerNextAttack,
                enemyAttackProgress: battle.enemyTimer / battle.enemyNextAttack,
            });
        }
    }

    onEnemyDefeated() {
        this.stopBattle();
        const battle = this.currentBattle;
        const wildPokemon = battle.wild;
        const activePokemonId = this.gameState.team[this.gameState.activePokemonIndex];

        // 记录调用前的闪光状态（公共方法内会设置shinyDex）
        const wasShinyRecorded = !!this.gameState.shinyDex[wildPokemon.id];

        // 调用公共胜利结算方法
        const rewards = this._processVictoryRewards(
            wildPokemon, activePokemonId,
            battle.playerMaxHp, battle.playerCurrentHp
        );
        this.currentBattle.playerCurrentHp = rewards.newPlayerHp;

        if (this.onBattleEvent) {
            this.onBattleEvent('enemyDefeated', {
                exp: rewards.expGained,
                pokemon: wildPokemon,
                healed: rewards.healAmount,
                gold: rewards.goldGained,
                playerHp: this.currentBattle.playerCurrentHp,
                playerMaxHp: battle.playerMaxHp,
                enemyMaxHp: battle.wildMaxHp,
            });
        }

        // 闪光宝可梦首次击败后通知UI
        if (wildPokemon.isShiny && !wasShinyRecorded && this.onBattleEvent) {
            this.onBattleEvent('shinyDefeated', {
                id: wildPokemon.id,
                name: wildPokemon.name,
            });
        }

        // 自动切换地图通知UI
        if (rewards.autoSwitchResult && this.onBattleEvent) {
            this.onBattleEvent('autoRouteSwitch', rewards.autoSwitchResult);
        }

        // 清除当前敌方，下一场战斗将生成新的
        this.gameState.currentEnemy = null;
        this.save();

        // 计算下一场战斗的延迟：当攻击速度<800ms时，延迟=攻击速度
        const delay = this._getNextBattleDelay(this.getAttackInterval(battle.playerStats.speed));

        // 短暂延迟后开始下一场战斗（记录计划时间，页面切回时可补偿）
        this._nextBattleScheduledAt = Date.now() + delay;
        this._nextBattleTimeout = setTimeout(() => {
            this._nextBattleTimeout = null;
            this._nextBattleScheduledAt = null;
            this.startBattle();
        }, delay);
    }

    // 基础经验值（随等级增长，100级后增速放缓）
    getBaseExpYield(pokemonId, level = 5) {
        const baseData = POKEMON_DATA[pokemonId];
        if (!baseData) return 50;
        // 基于种族值总和和等级
        const totalBase = Object.values(baseData.baseStats).reduce((a, b) => a + b, 0);
        const baseExp = Math.floor(totalBase / 3);
        // 等级加成：100级以内每10级+10%；100级以后用对数增长（大幅放缓）
        let levelBonus;
        if (level <= 100) {
            levelBonus = 1 + Math.floor(level / 10) * 0.1;
        } else {
            // 100级以后固定为2.0，不再随等级增长
            levelBonus = 2.0;
        }
        return Math.floor(baseExp * levelBonus);
    }

    // 给指定宝可梦增加经验（每个形态独立存储）
    // 旧接口：给“物种”加经验 = 给该物种的主个体加经验；
    // 物种只剩图鉴存档（最后一只个体已经进化走了）时，存档记录继续吃储备经验（但不会进化）。
    addExpToPokemon(pokemonId, amount) {
        const inst = this.roster.primaryOf(pokemonId);
        if (inst) return this.addExpToInstance(inst, amount);
        const archived = this.gameState.archivedSpecies;
        return archived && _has(archived, pokemonId) ? this._addExpToArchived(archived[pokemonId], amount) : false;
    }

    _addExpToArchived(rec, amount) {
        const data = POKEMON_DATA[rec.speciesId];
        if (!data || rec.level >= MAX_POKEMON_LEVEL) return false;
        rec.exp += amount;
        let leveledUp = false;
        while (rec.level < MAX_POKEMON_LEVEL && rec.exp >= getExpForLevel(data.expGroup, rec.level + 1)) {
            rec.level++;
            leveledUp = true;
        }
        if (leveledUp) this._touchSpecies(rec.speciesId);
        return leveledUp;
    }

    // 给指定个体加经验（队伍成员、图鉴储备经验都走这里）
    // 个体可能在升级途中进化（物种变了），所以每一轮都重新读取它当前的物种。
    addExpToInstance(inst, amount) {
        if (!POKEMON_DATA[inst.speciesId]) return false;

        // 等级上限检查
        if (inst.level >= MAX_POKEMON_LEVEL) {
            return false;
        }

        inst.exp += amount;
        inst.stats.expGained += amount;

        // 检查升级
        let leveledUp = false;
        const startLevel = inst.level;
        const startSpecies = inst.speciesId;
        while (inst.level < MAX_POKEMON_LEVEL) {
            const nextLevelExp = getExpForLevel(POKEMON_DATA[inst.speciesId].expGroup, inst.level + 1);
            if (inst.exp >= nextLevelExp) {
                inst.level++;
                leveledUp = true;

                // 检查进化（个体自己变成新物种；等级可能被重置，循环条件会自然收敛）
                this.checkEvolutionOfInstance(inst);
            } else {
                break;
            }
        }

        if (leveledUp) this._touchInstance(inst);

        // 闪光双向传播：升级后，如果该宝可梦是闪光的，同步给整条进化链
        if (leveledUp && this.gameState.shinyDex[inst.speciesId]) {
            this._syncShinyInFamily(inst.speciesId);
        }

        // 升级通知合并为一条（显示起始等级 → 最终等级）
        if (leveledUp && this.onLevelUp) {
            this.onLevelUp({
                id: inst.speciesId, uid: inst.uid, name: POKEMON_DATA[inst.speciesId].name, nickname: inst.nickname,
                level: inst.level, startLevel, evolvedFrom: inst.speciesId !== startSpecies ? startSpecies : null,
            });
        }

        return leveledUp;
    }

    // 检查进化目标所在地区是否已解锁（跨代进化限制）
    _isEvolutionRegionUnlocked(evoId) {
        // 目标物种所在世代的地区必须已解锁；一代（关都）默认解锁
        for (const regionId in REGION_POKEDEX_RANGES) {
            const [start, end] = REGION_POKEDEX_RANGES[regionId];
            if (evoId >= start && evoId <= end) {
                return regionId === 'kanto' ? true : this.isRegionUnlocked(regionId);
            }
        }
        return true;
    }

    // 旧接口：检查“物种”的进化 = 检查它的主个体
    checkEvolution(baseId, replaceTeam = true) {
        const inst = this.roster.primaryOf(baseId);
        if (inst) this.checkEvolutionOfInstance(inst, replaceTeam);
    }

    // 检查某只个体是否该进化。进化 = 这只个体自己变成新物种（uid、个体值、性格、特性、性别、闪光、昵称、
    // 战斗统计、队伍/PC 位置全部保持不变，Pikachu A → Raichu A）。
    //   · 目标物种还没登记图鉴：沿用旧规则——等级/经验/技能等级归零（新登记的形态从 Lv1 开始）；
    //     如果它是该物种的最后一只，原物种以“图鉴存档”的形式保留（图鉴与 1% 加成不会丢）。
    //   · 目标物种图鉴里已有（玩家已经拥有进化形态的个体）：照常进化，并保留等级。
    // 多个可进化分支时，优先选还没登记的目标，否则取数据里第一个满足条件的。
    // replaceTeam 仅为旧签名保留：个体原地进化，队伍位置不变，不再需要换位。
    checkEvolutionOfInstance(inst, replaceTeam = true) {
        let evolvedAny = false;
        // 保留等级的进化可以连续发生（等级已经超过后续进化等级），上限只是防御死循环
        for (let guard = 0; guard < 8; guard++) {
            if (!this._evolveOnce(inst)) break;
            evolvedAny = true;
        }
        return evolvedAny;
    }

    _evolveOnce(inst) {
        const baseId = inst.speciesId;
        const baseData = POKEMON_DATA[baseId];
        if (!baseData || !baseData.evolvesTo) return false;
        this.roster.reconcile();
        const gs = this.gameState;

        const evolutions = Array.isArray(baseData.evolvesTo) ? baseData.evolvesTo : [baseData.evolvesTo];
        // 跨代进化检查：进化目标所在地区必须已解锁
        const eligible = evolutions.filter(evo =>
            inst.level >= evo.level && POKEMON_DATA[evo.id] && this._isEvolutionRegionUnlocked(evo.id));
        if (eligible.length === 0) return false;
        const evo = eligible.find(e => gs.pokedex[e.id] !== 'caught') || eligible[0];
        const evolvedData = POKEMON_DATA[evo.id];

        const firstRegistration = gs.pokedex[evo.id] !== 'caught';
        const wasPrimary = this.roster.isPrimary(inst);
        const r = this.roster.evolveInstance(inst.uid, evo.id, { resetProgress: firstRegistration });
        if (!r.ok) return false;

        // 闪光是个体的属性，进化后仍然闪光；同时让物种级闪光记录（shinyDex）跟上，并传播给整条进化链
        let shinyRecorded = false;
        if (inst.shiny) {
            const target = this.roster.primaryOf(evo.id);
            if (target && !target.shiny) this.roster.setPrimary(inst.uid);
            if (!gs.shinyDex[evo.id]) {
                gs.shinyDex[evo.id] = true;
                shinyRecorded = true;
            }
        }
        this._touchSpecies(baseId);
        this._touchSpecies(evo.id);
        this._touchInstance(inst);
        if (shinyRecorded) this._syncShinyInFamily(evo.id);

        if (this.onBattleEvent) {
            if (shinyRecorded && !firstRegistration) {
                this.onBattleEvent('shinyEvolved', {
                    oldName: baseData.name,
                    newName: evolvedData.name,
                    oldId: baseId,
                    newId: evo.id,
                    pokemon: { id: evo.id, name: evolvedData.name, level: inst.level },
                });
            }
            this.onBattleEvent('evolved', {
                oldName: baseData.name,
                newName: evolvedData.name,
                oldId: baseId,
                newId: evo.id,
                uid: inst.uid,
                keptLevel: !firstRegistration,
                archivedOld: !!r.archived,
                pokemon: { id: evo.id, name: evolvedData.name, level: inst.level },
            });
        }

        // 进化注册新宝可梦后也检查徽章解锁（进化可能集齐某地区图鉴）
        for (const regionId in BADGE_DATA) {
            if (!this.hasBadge(regionId) && this.isRegionCompleted(regionId)) {
                this.tryUnlockBadge(regionId);
                if (this.onBattleEvent) {
                    this.onBattleEvent('badgeUnlocked', { regionId, badgeName: BADGE_DATA[regionId].name });
                }
            }
        }
        return true;
    }

    // 击败后处理：首次捕获或更新个体值
    processDefeat(wildPokemon) {
        // 只检查当前形态ID是否是首次捕获（不追溯到基础形态）
        const stored = this.gameState.caughtPokemon[wildPokemon.id];
        const isFirstCatch = !stored;

        if (isFirstCatch) {
            // 记录捕获前的地区解锁状态
            const wasJohtoUnlocked = this.isRegionUnlocked('johto');
            const wasHoennUnlocked = this.isRegionUnlocked('hoenn');
            const wasSinnohUnlocked = this.isRegionUnlocked('sinnoh');
            const wasUnovaUnlocked = this.isRegionUnlocked('unova');
            const wasKalosUnlocked = this.isRegionUnlocked('kalos');
            const wasAlolaUnlocked = this.isRegionUnlocked('alola');
            const wasGalarUnlocked = this.isRegionUnlocked('galar');
            const wasPaldeaUnlocked = this.isRegionUnlocked('paldea');
            const wasMegaUnlocked = this.isRegionUnlocked('mega');
            
            // 首次捕获：个体的性格/特性/性别在捕获时随机，闪光沿用野生个体的闪光
            this.catchPokemonWithIvs(wildPokemon.id, 1, wildPokemon.ivs, {
                shiny: !!wildPokemon.isShiny,
                traits: rollTraits(wildPokemon.id, this.rng),
            });
            
            // 检查是否因此次捕获解锁了城都地区
            if (!wasJohtoUnlocked && this.isRegionUnlocked('johto')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'johto', regionName: '城都地区' });
                }
            }

            // 检查是否因此次捕获解锁了丰缘地区
            if (!wasHoennUnlocked && this.isRegionUnlocked('hoenn')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'hoenn', regionName: '丰缘地区' });
                }
            }

            // 检查是否因此次捕获解锁了神奥地区
            if (!wasSinnohUnlocked && this.isRegionUnlocked('sinnoh')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'sinnoh', regionName: '神奥地区' });
                }
            }

            // 检查是否因此次捕获解锁了合众地区
            if (!wasUnovaUnlocked && this.isRegionUnlocked('unova')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'unova', regionName: '合众地区' });
                }
            }

            // 检查是否因此次捕获解锁了卡洛斯地区
            if (!wasKalosUnlocked && this.isRegionUnlocked('kalos')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'kalos', regionName: '卡洛斯地区' });
                }
            }

            // 检查是否因此次捕获解锁了阿罗拉地区
            if (!wasAlolaUnlocked && this.isRegionUnlocked('alola')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'alola', regionName: '阿罗拉地区' });
                }
            }

            // 检查是否因此次捕获解锁了伽勒尔地区
            if (!wasGalarUnlocked && this.isRegionUnlocked('galar')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'galar', regionName: '伽勒尔地区' });
                }
            }

            // 检查是否因此次捕获解锁了帕底亚地区
            if (!wasPaldeaUnlocked && this.isRegionUnlocked('paldea')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'paldea', regionName: '帕底亚地区' });
                }
            }

            // 检查是否因此次捕获解锁了Mega进化地区
            if (!wasMegaUnlocked && this.isRegionUnlocked('mega')) {
                if (this.onBattleEvent) {
                    this.onBattleEvent('regionUnlocked', { regionId: 'mega', regionName: 'Mega进化地区' });
                }
            }

            // 检查徽章解锁
            for (const regionId in BADGE_DATA) {
                if (!this.hasBadge(regionId) && this.isRegionCompleted(regionId)) {
                    this.tryUnlockBadge(regionId);
                    if (this.onBattleEvent) {
                        this.onBattleEvent('badgeUnlocked', { regionId, badgeName: BADGE_DATA[regionId].name });
                    }
                }
            }
        } else {
            // 先决定要不要把这只收为一只新的独立个体（必须在“个体值取高”之前判断：
            // 策略 better 要拿它跟已有个体原来的个体值比）。
            // 物种只剩图鉴存档（没有活着的个体）时，除非策略为 off，都会收下它作为新的个体。
            const hasLive = !!this.roster.primaryOf(wildPokemon.id);
            const wantsNew = hasLive
                ? this._shouldCaptureDuplicate(wildPokemon)
                : this.getCaptureDuplicatePolicy() !== 'off';

            // 旧规则照旧：比较并更新主个体（或图鉴存档）的个体值（取高的），不更新等级
            let updated = false;
            const updatedStats = [];

            for (const stat in wildPokemon.ivs) {
                if (wildPokemon.ivs[stat] > stored.ivs[stat]) {
                    const oldVal = stored.ivs[stat];
                    stored.ivs[stat] = wildPokemon.ivs[stat];
                    updated = true;
                    updatedStats.push({ stat, old: oldVal, new: wildPokemon.ivs[stat] });
                }
            }

            // 如果个体值有更新，同进化链按每项最大值同步（不会降档）
            if (updated) {
                this._touchSpecies(wildPokemon.id);
                const baseId = this.getBasePokemonId(wildPokemon.id);
                this.syncBestIvsInFamily(baseId, stored.ivs);
            }

            const captured = wantsNew ? this._captureDuplicate(wildPokemon) : null;

            if ((updated || captured) && this.onCatch) {
                this.onCatch({
                    id: wildPokemon.id,
                    uid: captured ? captured.uid : null,
                    name: POKEMON_DATA[wildPokemon.id].name,
                    level: captured ? captured.level : stored.level,
                    updatedStats,
                    isFirstCatch: false,
                    isDuplicate: !!captured,
                    shiny: !!(captured && captured.shiny),
                });
            }
        }
    }

    // ===================== 野生宝可梦生成 =====================
    // 按照地图设定的等级范围生成野生宝可梦
    // cache（可选，离线模拟用）：{ shinyRate, weightReduce }，避免每场重复计算
    generateWildPokemon(route, cache = null) {
        if (!route || !route.pokemon || route.pokemon.length === 0) return null;

        // 已完成宝可梦出现权重降低（completed_weight_reduce 效果）
        const weightReduceValue = cache ? cache.weightReduce : this.getBadgeEffectValue('completed_weight_reduce');
        const weights = route.pokemon.map(p => {
            let w = p.weight;
            if (weightReduceValue !== null) {
                const caught = this.gameState.pokedex[p.id] === 'caught';
                if (caught) {
                    const storedData = this.getStoredData(p.id);
                    const hasShiny = !!this.gameState.shinyDex[p.id];
                    if (storedData && this._isPerfectIvs(storedData.ivs) && hasShiny) {
                        w *= (1 - weightReduceValue); // 权重减少
                    }
                }
            }
            return w;
        });

        // 按权重随机选择
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        let rand = this.rng() * totalWeight;

        let selected = route.pokemon[0];
        for (let i = 0; i < route.pokemon.length; i++) {
            rand -= weights[i];
            if (rand <= 0) {
                selected = route.pokemon[i];
                break;
            }
        }

        // 按照地图/宝可梦配置的等级范围生成等级
        const minLevel = selected.levelRange[0];
        const maxLevel = selected.levelRange[1];
        let level = Math.floor(this.rng() * (maxLevel - minLevel + 1)) + minLevel;

        // 天赋：野生怪物等级提升（挑战塔除外）
        if (!this._towerMode) {
            level = this.getMonsterLevelBoost(level);
        }

        return this.createWildPokemon(selected.id, level, cache ? cache.shinyRate : undefined);
    }

    _isPerfectIvs(ivs) {
        return !!ivs && ivs.hp === 31 && ivs.atk === 31 && ivs.def === 31 &&
            ivs.spAtk === 31 && ivs.spDef === 31 && ivs.speed === 31;
    }

    // ===================== 队伍管理 =====================
    setActivePokemon(index) {
        this.roster.reconcile();
        if (index >= 0 && index < this.gameState.team.length) {
            this.gameState.activePokemonIndex = index;

            if (this.currentBattle) {
                // 热切换：保留敌方状态，继承血量百分比和攻击进度
                const oldMaxHp = this.currentBattle.playerMaxHp;
                const oldCurrentHp = this.currentBattle.playerCurrentHp;
                const oldHpPercent = oldMaxHp > 0 ? oldCurrentHp / oldMaxHp : 1;

                // 保存旧的攻击进度百分比
                const oldAttackProgress = this.currentBattle.playerNextAttack > 0
                    ? this.currentBattle.playerTimer / this.currentBattle.playerNextAttack
                    : 0;

                const newPlayerStats = this.calculateBattleStats(index);
                if (newPlayerStats) {
                    this.currentBattle.playerStats = newPlayerStats;
                    this.currentBattle.playerMaxHp = newPlayerStats.hp;
                    // 继承血量百分比：新宝可梦的当前HP = 新最大HP × 旧血量百分比
                    this.currentBattle.playerCurrentHp = Math.max(1, Math.floor(newPlayerStats.hp * oldHpPercent));
                    this.currentBattle.playerNextAttack = this.getAttackInterval(newPlayerStats.speed);
                    // 继承攻击进度：按百分比映射到新的攻击间隔上
                    this.currentBattle.playerTimer = Math.floor(this.currentBattle.playerNextAttack * oldAttackProgress);
                    // 保留 enemyTimer 不变
                    this._cacheBattleDerived();

                    // 挑战塔模式下同步更新 HP 百分比
                    if (this._towerMode) {
                        this._towerPlayerHpPercent = this.currentBattle.playerCurrentHp / this.currentBattle.playerMaxHp;
                    }

                    if (this.onBattleEvent) {
                        this.onBattleEvent('start', this.currentBattle);
                    }
                }
            } else {
                this.startBattle();
            }
        }
    }

    // 旧接口：按物种加入队伍 = 把该物种的主个体从 PC 取出放进队伍
    addToTeamFromPokedex(pokemonId) {
        this.roster.reconcile();
        if (this.gameState.party.length >= PARTY_MAX) {
            this._log('addToTeamFromPokedex: 队伍已满');
            return false;
        }
        if (this.gameState.pokedex[pokemonId] !== 'caught') {
            this._log('addToTeamFromPokedex: 该宝可梦未捕获', pokemonId);
            return false;
        }
        // 检查是否已在队伍中
        if (this.gameState.team.includes(pokemonId)) {
            this._log('addToTeamFromPokedex: 该宝可梦已在队伍中', pokemonId);
            return false;
        }
        const inst = this.roster.primaryOf(pokemonId);
        if (!inst) {
            this._log('addToTeamFromPokedex: 没有该宝可梦的个体', pokemonId);
            return false;
        }

        const r = this.roster.moveToParty(inst.uid);
        this._log('addToTeamFromPokedex:', r.ok ? '成功添加' : '失败 ' + r.code, pokemonId);
        return r.ok;
    }

    // 指定个体（而不是物种）加入/离开队伍：同一物种有多只时使用
    addPartyMember(uid) {
        this.roster.reconcile();
        const r = this.roster.moveToParty(uid);
        return r.ok;
    }

    removeFromTeamByPokemonId(pokemonId) {
        this.roster.reconcile();
        // 找到该宝可梦在队伍中的索引（非出战）
        const teamIndex = this.gameState.team.findIndex((id, idx) => 
            id === pokemonId && idx !== this.gameState.activePokemonIndex
        );
        if (teamIndex === -1) {
            this._log('removeFromTeamByPokemonId: 未找到可移除的宝可梦', pokemonId, 'activeIndex:', this.gameState.activePokemonIndex);
            return false;
        }
        if (this.gameState.team.length <= 1) {
            this._log('removeFromTeamByPokemonId: 队伍至少需要保留一只');
            return false;
        }

        this._log('removeFromTeamByPokemonId: 移除索引', teamIndex, 'pokemonId:', pokemonId);
        // 移出队伍 = 回到 PC（出战下标由 PartyManager 一并调整）
        return this.roster.moveToPc(this.gameState.party[teamIndex]).ok;
    }

    removeFromTeam(teamIndex) {
        this.roster.reconcile();
        if (this.gameState.team.length <= 1) return false; // 至少保留一只
        if (teamIndex === this.gameState.activePokemonIndex) return false; // 不能移除出战宝可梦

        const uid = this.gameState.party[teamIndex];
        if (uid === undefined) return false;
        return this.roster.moveToPc(uid).ok;
    }

    // ===================== 队伍 / PC 服务（界面调用，统一返回 { ok, code, ... }）=====================
    // 挑战塔进行中不允许改动队伍（塔里的血量比例按当前出战者计算）。
    _rosterEditBlocked() {
        if (!this.gameState) return 'no_game';
        if (this._towerMode) return 'tower_locked';
        if (this._isOfflineSimulating) return 'busy';
        return null;
    }

    // 队伍改动之后：对齐旧视图、让进行中的战斗按新的出战个体/队友加成重新计算，并请求存档
    _afterRosterEdit() {
        this.roster.reconcile();
        if (this.currentBattle && !this._towerMode) this.setActivePokemon(this.gameState.activePokemonIndex);
        this.save();
    }

    // 把 PC 里的某只个体加入队伍（队尾）。同物种可以有多只同时在队伍里
    partyAdd(uid) {
        const blocked = this._rosterEditBlocked();
        if (blocked) return { ok: false, code: blocked };
        this.roster.reconcile();
        const r = this.roster.moveToParty(uid);
        if (r.ok) this._afterRosterEdit();
        return r;
    }

    // 把队伍里第 index 位放回 PC（出战者和最后一只不能移出）
    partyRemove(index) {
        const blocked = this._rosterEditBlocked();
        if (blocked) return { ok: false, code: blocked };
        this.roster.reconcile();
        const uid = this.gameState.party[index];
        if (uid === undefined) return { ok: false, code: 'bad_index' };
        const r = this.roster.moveToPc(uid);
        if (r.ok) this._afterRosterEdit();
        return r;
    }

    // 用 PC 里的个体换下队伍里第 index 位（换下的那只放进同一个 PC 格子）
    partySwapWithPc(index, pcUid) {
        const blocked = this._rosterEditBlocked();
        if (blocked) return { ok: false, code: blocked };
        this.roster.reconcile();
        const r = this.roster.swapPartyWithPc(index, pcUid);
        if (r.ok) this._afterRosterEdit();
        return r;
    }

    // 调整队伍顺序：把第 from 位挪到第 to 位（出战的仍是同一只）
    partyReorder(from, to) {
        const blocked = this._rosterEditBlocked();
        if (blocked) return { ok: false, code: blocked };
        this.roster.reconcile();
        const r = this.roster.party.move(from, to);
        if (r.ok && from !== to) this._afterRosterEdit();
        return r;
    }

    // PC 内部整理：把 PC 里的一只移到另一个箱子的第一个空格
    pcMoveToBox(uid, boxIndex) {
        const pc = this.roster.pc;
        const box = this.gameState.pc.boxes[boxIndex];
        if (!box) return { ok: false, code: 'bad_box' };
        const slot = box.slots.indexOf(null);
        if (slot === -1) return { ok: false, code: 'box_full' };
        const r = pc.move(uid, boxIndex, slot);
        if (r.ok) this.save();
        return r;
    }

    renamePokemon(uid, nickname) {
        const r = this.roster.setNickname(uid, nickname);
        if (r.ok) this.save();
        return r;
    }

    // 放生（只能放生 PC 里的；每个物种至少保留一只）。放生的记录写进 released
    releasePokemon(uid) {
        const r = this.roster.release(uid, { reason: 'release' });
        if (r.ok) { this._dexBonus = null; this.save(); }
        return r;
    }

    // 界面用的个体快照（界面不需要知道 ownedPokemon/party/pc 的内部结构）
    describeInstance(uid) {
        const inst = this.roster.get(uid);
        if (!inst) return null;
        const data = POKEMON_DATA[inst.speciesId];
        const where = this.roster.locate(uid);
        const total = ivTotal(inst.ivs);
        return {
            uid: inst.uid,
            speciesId: inst.speciesId,
            name: data.name,
            nickname: inst.nickname,
            displayName: getInstanceDisplayName(inst),
            types: data.types,
            level: inst.level,
            ivs: { ...inst.ivs },
            ivTotal: total,
            ivPercent: Math.round(total / (IV_KEYS.length * 31) * 100),
            nature: inst.nature,
            natureName: getNature(inst.nature).name,
            gender: inst.gender,
            ability: inst.ability,
            shiny: inst.shiny,
            origin: inst.origin,
            originRoute: inst.originRoute,
            caughtAt: inst.caughtAt,
            battles: inst.battles,
            isPrimary: this.roster.isPrimary(inst),
            where: where ? where.where : null,
            partyIndex: where && where.where === 'party' ? where.index : null,
            box: where && where.where === 'pc' ? where.box : null,
            slot: where && where.where === 'pc' ? where.slot : null,
        };
    }

    // ===================== 地图 =====================
    getRoute(routeId) {
        for (const regionKey in REGIONS) {
            const region = REGIONS[regionKey];
            for (const route of region.routes) {
                if (route.id === routeId) return route;
            }
        }
        return null;
    }

    changeRoute(routeId) {
        // 检查路线所在地区是否已解锁
        for (const regionKey in REGIONS) {
            const region = REGIONS[regionKey];
            for (const route of region.routes) {
                if (route.id === routeId) {
                    if (!this.isRegionUnlocked(regionKey)) {
                        return false; // 地区未解锁，不能切换
                    }
                }
            }
        }
        this.gameState.currentRoute = routeId;
        // 不立即刷新敌方，当前战斗继续，下一场战斗将生成新路线的宝可梦
        this.resetRateTracker(); // 切换地图时重置速率统计
        this.save();
        return true;
    }

    // 检查某个道路的所有宝可梦是否全部6V且闪光
    isRouteComplete6VShiny(routeId) {
        const route = this.getRoute(routeId);
        if (!route || !route.pokemon || route.pokemon.length === 0) return false;

        for (const p of route.pokemon) {
            if (this.gameState.pokedex[p.id] !== 'caught') return false;
            const storedData = this.getStoredData(p.id);
            if (!storedData || !storedData.ivs) return false;
            const is6V = storedData.ivs.hp === 31 && storedData.ivs.atk === 31 &&
                storedData.ivs.def === 31 && storedData.ivs.spAtk === 31 &&
                storedData.ivs.spDef === 31 && storedData.ivs.speed === 31;
            if (!is6V) return false;
            if (!this.gameState.shinyDex[p.id]) return false;
        }
        return true;
    }

    // 检查某个道路的所有宝可梦是否全部6V（不要求闪光）
    isRouteComplete6V(routeId) {
        const route = this.getRoute(routeId);
        if (!route || !route.pokemon || route.pokemon.length === 0) return false;

        for (const p of route.pokemon) {
            if (this.gameState.pokedex[p.id] !== 'caught') return false;
            const storedData = this.getStoredData(p.id);
            if (!storedData || !storedData.ivs) return false;
            const is6V = storedData.ivs.hp === 31 && storedData.ivs.atk === 31 &&
                storedData.ivs.def === 31 && storedData.ivs.spAtk === 31 &&
                storedData.ivs.spDef === 31 && storedData.ivs.speed === 31;
            if (!is6V) return false;
        }
        return true;
    }

    // 根据设置检查道路是否完成（自动切换地图用）
    _isRouteCompleteByCondition(routeId) {
        const condition = this.gameState.settings?.routeSwitchCondition || '6v_shiny';
        if (condition === '6v_only') return this.isRouteComplete6V(routeId);
        return this.isRouteComplete6VShiny(routeId);
    }

    // 查找第一个未完成的已解锁道路（从所有地区从前往后遍历）
    findNextIncompleteRoute() {
        for (const regionKey in REGIONS) {
            if (!this.isRegionUnlocked(regionKey)) continue;
            const region = REGIONS[regionKey];
            for (const route of region.routes) {
                if (!this._isRouteCompleteByCondition(route.id)) {
                    return { routeId: route.id, regionKey, routeName: route.name, regionName: region.name };
                }
            }
        }
        return null; // 所有地图均已完成
    }

    // 自动切换到下一个未完成的地图（无需徽章，直接开放）
    tryAutoRouteSwitch() {
        if (!this.gameState.settings?.autoRouteSwitch) return null;
        if (!this.gameState.currentRoute) return null;

        // 检查当前地图是否已完成（根据条件设置）
        if (!this._isRouteCompleteByCondition(this.gameState.currentRoute)) return null;

        // 查找下一个未完成的地图
        const next = this.findNextIncompleteRoute();
        if (!next) return null; // 全部完成，不切换

        // 切换到新地图
        this.gameState.currentRoute = next.routeId;
        this.gameState.currentRegion = next.regionKey;
        this.gameState.currentEnemy = null; // 清除当前敌方
        this.resetRateTracker(); // 自动切换地图时重置速率统计
        this.save();

        return next;
    }

    changeRegion(regionId) {
        this.gameState.currentRegion = regionId;
    }

    // 检查地区是否已解锁
    isRegionUnlocked(regionId) {
        const region = REGIONS[regionId];
        if (!region) return false;
        if (!region.unlockCondition) return true; // 无解锁条件则默认解锁

        const condition = region.unlockCondition;
        if (condition.type === 'pokedex_complete') {
            // 检查是否集齐指定范围的所有宝可梦
            const [start, end] = condition.range;
            for (let id = start; id <= end; id++) {
                if (this.gameState.pokedex[id] !== 'caught') {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    // 获取地区解锁进度
    getRegionUnlockProgress(regionId) {
        const region = REGIONS[regionId];
        if (!region || !region.unlockCondition) return { current: 0, total: 0, percent: 100 };

        const condition = region.unlockCondition;
        if (condition.type === 'pokedex_complete') {
            const [start, end] = condition.range;
            let caught = 0;
            const total = end - start + 1;
            for (let id = start; id <= end; id++) {
                if (this.gameState.pokedex[id] === 'caught') {
                    caught++;
                }
            }
            return { current: caught, total, percent: Math.floor(caught / total * 100) };
        }
        return { current: 0, total: 0, percent: 100 };
    }

    // ===================== 图鉴 =====================
    getPokedexStats() {
        let seen = 0, caught = 0;
        for (const id in this.gameState.pokedex) {
            if (this.gameState.pokedex[id] === 'caught') {
                caught++;
                seen++;
            } else if (this.gameState.pokedex[id] === 'seen') {
                seen++;
            }
        }
        return { seen, caught, total: Object.keys(POKEMON_DATA).length };
    }

    // 按地区获取图鉴统计
    getPokedexStatsByRegion(regionId) {
        const range = REGION_POKEDEX_RANGES[regionId];
        if (!range) return this.getPokedexStats();

        let seen = 0, caught = 0;
        const [start, end] = range;
        for (let id = start; id <= end; id++) {
            if (this.gameState.pokedex[id] === 'caught') {
                caught++;
                seen++;
            } else if (this.gameState.pokedex[id] === 'seen') {
                seen++;
            }
        }
        return { seen, caught, total: end - start + 1 };
    }

    // 切换图鉴中宝可梦的展示形态（闪光/原始）
    togglePokedexDisplay(pokemonId) {
        if (!this.gameState.shinyDex[pokemonId]) return false;
        
        if (this.gameState.pokedexDisplay[pokemonId] === 'shiny') {
            delete this.gameState.pokedexDisplay[pokemonId]; // 切回原始
        } else {
            this.gameState.pokedexDisplay[pokemonId] = 'shiny'; // 切为闪光
        }
        this.save();
        return true;
    }

    // 获取宝可梦在图鉴中应显示的精灵图URL
    getPokedexSpriteUrl(pokemonId) {
        if (this.gameState.pokedexDisplay[pokemonId] === 'shiny') {
            return getShinyPokemonSpriteUrl(pokemonId);
        }
        return getPokemonSpriteUrl(pokemonId);
    }

    // 获取闪光图鉴统计
    getShinyStats() {
        return Object.keys(this.gameState.shinyDex).length;
    }

    // ===================== 存档 =====================
    // 写入状态前的整理：时间戳、战斗血量（刷新页面后恢复）
    _prepareStateForSave() {
        const gs = this.gameState;
        if (!gs) return null;
        this.roster.reconcile();   // 旧代码直接改了 team 时，保证 party/PC 在写盘前一致
        this._syncShinyFlags();    // 旧代码直接写 shinyDex 时，让主个体的闪光与之一致
        gs.schemaVersion = SAVE_SCHEMA_VERSION;
        gs.lastSave = Date.now();

        if (this.currentBattle) {
            if (this.currentBattle.playerCurrentHp > 0) {
                gs.battleHp = {
                    playerHp: this.currentBattle.playerCurrentHp,
                    playerMaxHp: this.currentBattle.playerMaxHp,
                    enemyHp: this.currentBattle.wildCurrentHp,
                    playerTimer: this.currentBattle.playerTimer,
                    enemyTimer: this.currentBattle.enemyTimer,
                };
            } else {
                delete gs.battleHp;
            }
        }
        return gs;
    }

    // 闪光双向对齐：shinyDex（旧的物种级记录）⇄ 主个体的 shiny。幂等、开销与闪光数量成正比
    _syncShinyFlags() {
        const gs = this.gameState;
        for (const id of Object.keys(gs.shinyDex)) {
            const primary = this.roster.primaryOf(Number(id));
            if (primary && !primary.shiny) { primary.shiny = true; this._touchInstance(primary); }
        }
        for (const inst of Object.values(gs.ownedPokemon)) {
            if (inst.shiny && this.roster.isPrimary(inst) && !gs.shinyDex[inst.speciesId]) gs.shinyDex[inst.speciesId] = true;
        }
    }

    // 请求保存（防抖）：战斗、升级等高频路径使用，约 2 秒后合并写入，最迟 10 秒
    save() {
        if (!this.gameState) return;
        this.saver.request();
    }

    // 立即保存：手动保存、导出、离开页面、导入/删除后使用
    saveNow() {
        if (!this.gameState) return { ok: false, code: 'no_state' };
        return this.saver.flush(true);
    }

    // 用户确认接管（另一个标签页写过存档后，本页恢复保存）
    takeOverSave() {
        return this.saver.takeOver();
    }

    // 读取存档：主存档 → 备份轮转；返回是否成功。诊断信息见 this.loadReport
    load() {
        const r = this.saver.load();
        this.loadReport = {
            ok: r.ok,
            empty: !!r.empty,
            source: r.source || null,
            recovered: !!r.recovered,
            fromVersion: r.fromVersion || null,
            warnings: r.warnings || [],
            failures: r.failures || [],
            error: r.error || null,
        };
        if (!r.ok) return false;
        this.gameState = r.state;
        this.currentBattle = null;
        this._invalidateAllCaches();
        return true;
    }

    // 导出存档文本（Base64，兼容旧格式）
    exportSave() {
        if (!this.gameState) return '';
        this.saveNow();
        return this.saver.exportText(this.gameState);
    }

    // 导入存档：先完整校验/清洗，成功后才替换当前状态；并先备份当前存档
    // 返回 { success, message?, warnings? }
    importSave(dataStr) {
        const r = this.saver.parseImport(dataStr);
        if (!r.ok) return { success: false, message: r.error, code: r.code };

        this.saver.backupNow(true);
        this.stopBattle();
        this._towerMode = false;
        this._towerBattle = null;
        this.currentBattle = null;
        this._offlineSimState = null;
        this.gameState = r.state;
        this._invalidateAllCaches();
        // 记录导入存档的 lastSave，用于离线结算
        this._importedLastSave = this.gameState.lastSave || null;
        this.saveNow();
        return { success: true, warnings: r.warnings, fromVersion: r.fromVersion };
    }

    deleteSave() {
        this.saver.deleteAll();
        this.gameState = null;
        this.currentBattle = null;
        this._invalidateAllCaches();
    }

    startAutoSave() {
        if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
        // 兜底：每 30 秒把仍未写入的变更落盘（没有变更则跳过）
        this.autoSaveTimer = setInterval(() => {
            this.saver.flush(false);
        }, 30000);
    }

    // ===================== 经验条信息 =====================
    getExpProgress(pokemonId, instance = null) {
        const storedData = instance || this.getStoredData(pokemonId);
        if (!storedData) return { current: 0, needed: 1, percent: 0 };

        const baseData = POKEMON_DATA[pokemonId];
        if (!baseData) return { current: 0, needed: 1, percent: 0 };

        const currentLevelExp = getExpForLevel(baseData.expGroup, storedData.level);
        const nextLevelExp = getExpForLevel(baseData.expGroup, storedData.level + 1);
        // 旧存档里的初始皮卡丘经验可能低于 Lv5 起点，显示时按 0 处理
        const expInLevel = Math.max(0, storedData.exp - currentLevelExp);
        const expNeeded = nextLevelExp - currentLevelExp;
        const percent = Math.max(0, Math.min(100, Math.floor(expInLevel / expNeeded * 100)));

        return { current: expInLevel, needed: expNeeded, percent };
    }

    // ===================== 徽章系统 =====================
    // 检查某地区是否通关（所有宝可梦已捕获）
    isRegionCompleted(regionId) {
        const range = REGION_POKEDEX_RANGES[regionId];
        if (!range) return false;
        const [start, end] = range;
        for (let id = start; id <= end; id++) {
            if (this.gameState.pokedex[id] !== 'caught') return false;
        }
        return true;
    }

    // 获取徽章状态
    hasBadge(regionId) {
        return !!this.gameState.badges[regionId]?.unlocked;
    }

    // 通过 effectType 检查是否拥有对应效果的徽章
    hasBadgeEffect(effectType) {
        for (const regionId in BADGE_DATA) {
            if (BADGE_DATA[regionId].effectType === effectType && this.hasBadge(regionId)) {
                return true;
            }
        }
        return false;
    }

    // 通过 effectType 获取对应效果的 value（未拥有返回 null）
    getBadgeEffectValue(effectType) {
        for (const regionId in BADGE_DATA) {
            if (BADGE_DATA[regionId].effectType === effectType && this.hasBadge(regionId)) {
                return BADGE_DATA[regionId].value;
            }
        }
        return null;
    }

    // 尝试解锁徽章
    tryUnlockBadge(regionId) {
        if (this.hasBadge(regionId)) return false;
        if (!this.isRegionCompleted(regionId)) return false;
        this.gameState.badges[regionId] = { unlocked: true, gem: null };
        this.save();
        return true;
    }

    // 检查金币系统是否解锁（拥有解锁金币效果的徽章）
    isGoldUnlocked() {
        return this.hasBadgeEffect('unlock_gold');
    }

    // 计算金币掉落
    calculateGoldDrop(wildPokemon) {
        if (!this.isGoldUnlocked()) return 0;
        // 基础金币 = 等级开根号 * 2
        let gold = Math.floor(Math.sqrt(wildPokemon.level) * 2);
        // 金币加成徽章
        const goldBonusValue = this.getBadgeEffectValue('gold_bonus');
        if (goldBonusValue !== null) {
            gold = Math.floor(gold * (1 + goldBonusValue));
        }
        // 天赋：金币额外增加
        const talentGoldBonus = this.getTalentValue('gold_bonus');
        if (talentGoldBonus > 0) {
            gold = Math.floor(gold * (1 + talentGoldBonus / 100));
        }
        // 挑战塔加成：通关层数%
        const towerGoldBonus = this.getTowerBonus();
        if (towerGoldBonus > 0) {
            gold = Math.floor(gold * (1 + towerGoldBonus / 100));
        }
        return Math.max(1, gold);
    }

    // 添加金币
    addGold(amount) {
        this.gameState.gold += amount;
        this.gameState.stats.totalGold += amount;
    }

    // ===================== 宝石系统 =====================
    getGemQualityById(qualityId) {
        return GEM_QUALITIES.find(q => q.id === qualityId) || null;
    }

    getNextGemQualityId(qualityId) {
        const idx = GEM_QUALITIES.findIndex(q => q.id === qualityId);
        if (idx === -1 || idx >= GEM_QUALITIES.length - 1) return null;
        return GEM_QUALITIES[idx + 1].id;
    }

    // 按指定品质生成宝石
    generateGemByQuality(qualityId) {
        const quality = this.getGemQualityById(qualityId);
        if (!quality) return null;

        // 宝石属性值偏向更高值（gem_value_bonus 效果）
        const gemValueBonusValue = this.getBadgeEffectValue('gem_value_bonus');
        const kalosBias = gemValueBonusValue !== null ? gemValueBonusValue : 0;

        // 天赋：宝石属性出现概率偏好
        const talentGemAttrLevel = this.getTalentLevel('gem_attr_boost');
        const talentGemAttrChoice = this.getTalentGemAttrChoice();

        const attrs = [];
        for (let i = 0; i < quality.attrCount; i++) {
            let attrTemplate;
            // 天赋属性偏好：增加选中属性的出现概率
            if (talentGemAttrLevel > 0 && talentGemAttrChoice) {
                const baseWeight = 100; // 每个属性基础权重100
                const bonusWeight = talentGemAttrLevel; // 每级+1%的额外权重
                const totalWeight = GEM_ATTRIBUTES.length * baseWeight + bonusWeight;
                let roll = this.rng() * totalWeight;
                attrTemplate = null;
                for (const attr of GEM_ATTRIBUTES) {
                    const w = baseWeight + (attr.id === talentGemAttrChoice ? bonusWeight : 0);
                    roll -= w;
                    if (roll <= 0) { attrTemplate = attr; break; }
                }
                if (!attrTemplate) attrTemplate = GEM_ATTRIBUTES[GEM_ATTRIBUTES.length - 1];
            } else {
                attrTemplate = GEM_ATTRIBUTES[Math.floor(this.rng() * GEM_ATTRIBUTES.length)];
            }
            let value;
            if (kalosBias > 0) {
                // 生成两次随机值取较大值（biased random），概率偏向高值
                const roll1 = this.rng();
                const roll2 = this.rng();
                const biasedRoll = Math.max(roll1, roll2);
                value = Math.floor(biasedRoll * (attrTemplate.max - attrTemplate.min + 1)) + attrTemplate.min;
            } else {
                value = Math.floor(this.rng() * (attrTemplate.max - attrTemplate.min + 1)) + attrTemplate.min;
            }
            attrs.push({ id: attrTemplate.id, name: attrTemplate.name, value, unit: attrTemplate.unit, icon: attrTemplate.icon });
        }

        return {
            uid: this.generateUID(),
            quality: quality.id,
            qualityName: quality.name,
            qualityColor: quality.color,
            attrs,
            locked: false,
        };
    }

    // 生成随机宝石
    generateGem() {
        // 按权重随机品质（天赋：降低普通宝石概率）
        let qualities = GEM_QUALITIES.map(q => ({ ...q }));
        const talentGemReduce = this.getTalentValue('gem_common_reduce');
        if (talentGemReduce > 0) {
            const commonQ = qualities.find(q => q.id === 'common');
            if (commonQ) {
                commonQ.weight = Math.max(0, commonQ.weight * (1 - talentGemReduce / 100));
            }
        }
        const totalWeight = qualities.reduce((s, q) => s + q.weight, 0);
        let rand = this.rng() * totalWeight;
        let quality = qualities[0];
        for (const q of qualities) {
            rand -= q.weight;
            if (rand <= 0) { quality = q; break; }
        }
        return this.generateGemByQuality(quality.id);
    }


    // 购买宝石
    buyGem() {
        if (!this.isGoldUnlocked()) return { success: false, message: '尚未解锁金币系统' };
        if (this.gameState.gems.length >= GEM_BAG_MAX) return { success: false, message: `背包已满（最多${GEM_BAG_MAX}个）` };

        // 随机品质价格（购买固定价格1000金币，获得随机品质宝石）
        const price = 1000;
        if (this.gameState.gold < price) return { success: false, message: `金币不足（需要 ${price}）` };

        this.gameState.gold -= price;
        const gem = this.generateGem();
        // 新购宝石标记：用于背包内"NEW"提醒，查看后由UI清除
        gem.isNew = true;
        this.gameState.gems.push(gem);
        this.save();
        return { success: true, gem, price };
    }

    // 批量购买宝石：直到金币不足或背包满
    buyAllGems() {
        if (!this.isGoldUnlocked()) return { success: false, message: '尚未解锁金币系统' };
        if (this.gameState.gems.length >= GEM_BAG_MAX) return { success: false, message: `背包已满（最多${GEM_BAG_MAX}个）` };

        const price = 1000;
        const bagRemain = GEM_BAG_MAX - this.gameState.gems.length;
        const affordable = Math.floor(this.gameState.gold / price);
        const count = Math.min(bagRemain, affordable);

        if (count <= 0) {
            return { success: false, message: `金币不足（需要 ${price}）` };
        }

        for (let i = 0; i < count; i++) {
            this.gameState.gold -= price;
            const gem = this.generateGem();
            gem.isNew = true;
            this.gameState.gems.push(gem);
        }

        this.save();
        return {
            success: true,
            count,
            spent: count * price,
            reason: this.gameState.gems.length >= GEM_BAG_MAX ? 'bag_full' : 'gold_empty',
        };
    }


    // 镶嵌宝石到徽章
    equipGem(regionId, gemUid) {
        const badge = this.gameState.badges[regionId];
        if (!badge || !badge.unlocked) return { success: false, message: '徽章未解锁' };

        const gemIndex = this.gameState.gems.findIndex(g => g.uid === gemUid);
        if (gemIndex === -1) return { success: false, message: '宝石不存在' };

        // 如果徽章已有宝石，放回背包
        if (badge.gem) {
            if (this.gameState.gems.length >= GEM_BAG_MAX) {
                return { success: false, message: '背包已满，无法卸下当前宝石' };
            }
            this.gameState.gems.push(badge.gem);
        }

        // 从背包移除并装到徽章
        const gem = this.gameState.gems.splice(gemIndex, 1)[0];
        badge.gem = gem;
        this._gemBonusCache = null;
        this._cacheBattleDerived();
        this.save();
        return { success: true };
    }

    // 卸下徽章上的宝石
    unequipGem(regionId) {
        const badge = this.gameState.badges[regionId];
        if (!badge || !badge.unlocked || !badge.gem) return { success: false, message: '没有可卸下的宝石' };
        if (this.gameState.gems.length >= GEM_BAG_MAX) return { success: false, message: '背包已满' };

        this.gameState.gems.push(badge.gem);
        badge.gem = null;
        this._gemBonusCache = null;
        this._cacheBattleDerived();
        this.save();
        return { success: true };
    }

    // 切换宝石锁定状态
    toggleGemLock(gemUid) {
        const gem = this.gameState.gems.find(g => g.uid === gemUid);
        if (!gem) return { success: false, message: '宝石不存在' };
        gem.locked = !gem.locked;
        this.save();
        return { success: true, locked: gem.locked, gem };
    }

    // 丢弃背包中的宝石
    discardGem(gemUid) {
        const idx = this.gameState.gems.findIndex(g => g.uid === gemUid);
        if (idx === -1) return { success: false, message: '宝石不存在' };
        if (this.gameState.gems[idx].locked) return { success: false, message: '宝石已锁定，无法丢弃' };
        this.gameState.gems.splice(idx, 1);
        this.save();
        return { success: true };
    }

    // 宝石合成：10个同品质宝石 => 1个高品质宝石（永恒为最高品质，无法继续合成）
    synthesizeGems(sourceQuality, gemUids) {
        const sourceInfo = this.getGemQualityById(sourceQuality);
        if (!sourceInfo) return { success: false, message: '宝石品质不存在' };

        const targetQuality = this.getNextGemQualityId(sourceQuality);
        if (!targetQuality) return { success: false, message: '永恒宝石无法继续合成' };

        if (!Array.isArray(gemUids)) return { success: false, message: '请选择要合成的宝石' };

        const sourceCount = this.gameState.gems.filter(g => g.quality === sourceQuality && !g.locked).length;
        if (sourceCount < 10) {
            return { success: false, message: `缺少可合成的${sourceInfo.name}宝石：需要10个，当前${sourceCount}个（未锁定）` };
        }

        const uniqueUids = [...new Set(gemUids)];
        if (uniqueUids.length !== 10) {
            return { success: false, message: `需要选择10个${sourceInfo.name}宝石，当前选择${uniqueUids.length}个` };
        }

        for (const uid of uniqueUids) {
            const gem = this.gameState.gems.find(g => g.uid === uid);
            if (!gem) return { success: false, message: '所选宝石不存在或已变化，请重试' };
            if (gem.quality !== sourceQuality) {
                return { success: false, message: `所选宝石中包含非${sourceInfo.name}品质` };
            }
            if (gem.locked) {
                return { success: false, message: '所选宝石包含已锁定宝石，无法合成' };
            }
        }

        const removeSet = new Set(uniqueUids);
        this.gameState.gems = this.gameState.gems.filter(g => !removeSet.has(g.uid));

        const newGem = this.generateGemByQuality(targetQuality);
        if (!newGem) return { success: false, message: '生成目标品质宝石失败' };

        // 合成产出的新宝石也标记为NEW
        newGem.isNew = true;
        this.gameState.gems.push(newGem);
        this.save();
        return { success: true, newGem, sourceQuality, targetQuality };
    }

    // 重铸永恒宝石：2颗永恒宝石 => 1颗新的永恒宝石（重新随机属性）
    reforgeEternalGem(gemUids) {
        if (!Array.isArray(gemUids)) return { success: false, message: '请选择要重铸的宝石' };

        const uniqueUids = [...new Set(gemUids)];
        if (uniqueUids.length !== 2) {
            return { success: false, message: `需要选择2个永恒宝石，当前选择${uniqueUids.length}个` };
        }

        // 验证每颗宝石
        for (const uid of uniqueUids) {
            const gem = this.gameState.gems.find(g => g.uid === uid);
            if (!gem) return { success: false, message: '所选宝石不存在或已变化，请重试' };
            if (gem.quality !== 'eternal') {
                return { success: false, message: '所选宝石包含非永恒品质' };
            }
            if (gem.locked) {
                return { success: false, message: '所选宝石包含已锁定宝石，无法重铸' };
            }
        }

        // 移除2颗旧宝石
        const removeSet = new Set(uniqueUids);
        this.gameState.gems = this.gameState.gems.filter(g => !removeSet.has(g.uid));

        // 生成1颗新的永恒宝石
        const newGem = this.generateGemByQuality('eternal');
        if (!newGem) return { success: false, message: '生成永恒宝石失败' };

        newGem.isNew = true;
        this.gameState.gems.push(newGem);
        this.save();
        return { success: true, newGem };
    }

    // 一键合成：从低到高依次合成所有能合成的宝石
    // skipSave=true 时跳过每次合成的单独存档（用于自动合成永恒场景，由调用方统一存档）
    synthesizeAllGems(skipSave = false) {
        const qualityOrder = ['common', 'magic', 'rare', 'epic', 'mythic', 'legendary'];
        let totalSynthesized = 0;
        const results = [];
        let lastError = null;

        if (skipSave) {
            // === 快速模式：内联合成逻辑，跳过冗余验证和逐次save ===
            // 按品质预分组，避免反复 filter
            const groups = {};
            for (const q of qualityOrder) groups[q] = [];
            for (const g of this.gameState.gems) {
                if (!g.locked && groups[g.quality]) groups[g.quality].push(g);
            }

            for (const sourceQuality of qualityOrder) {
                const targetQuality = this.getNextGemQualityId(sourceQuality);
                if (!targetQuality) continue;

                let candidates = groups[sourceQuality];
                while (candidates.length >= 10) {
                    // 取前10个的uid集合
                    const toRemove = new Set(candidates.slice(0, 10).map(g => g.uid));
                    // 从gems数组中移除
                    this.gameState.gems = this.gameState.gems.filter(g => !toRemove.has(g.uid));
                    // 生成新宝石
                    const newGem = this.generateGemByQuality(targetQuality);
                    if (!newGem) { lastError = '生成目标品质宝石失败'; break; }
                    newGem.isNew = true;
                    this.gameState.gems.push(newGem);
                    totalSynthesized++;
                    results.push({ sourceQuality, targetQuality, newGem });
                    // 更新分组：移除已消耗的10个，新宝石加入目标组
                    candidates = candidates.slice(10);
                    groups[sourceQuality] = candidates;
                    if (!newGem.locked && groups[targetQuality]) groups[targetQuality].push(newGem);
                }
            }
        } else {
            // === 普通模式：保持原有逻辑（UI手动合成用） ===
            for (const sourceQuality of qualityOrder) {
                const targetQuality = this.getNextGemQualityId(sourceQuality);
                if (!targetQuality) continue;

                while (true) {
                    const candidates = this.gameState.gems.filter(g => g.quality === sourceQuality && !g.locked);
                    if (candidates.length < 10) break;

                    const toMerge = candidates.slice(0, 10);
                    const uids = toMerge.map(g => g.uid);

                    try {
                        const result = this.synthesizeGems(sourceQuality, uids);
                        if (!result.success) { lastError = result.message; break; }
                        totalSynthesized++;
                        results.push({
                            sourceQuality: sourceQuality,
                            targetQuality: targetQuality,
                            newGem: result.newGem,
                        });
                    } catch (e) {
                        lastError = '异常: ' + e.message;
                        console.error('synthesizeAllGems error:', e);
                        break;
                    }
                }
            }
        }

        if (totalSynthesized === 0) {
            const qualityNames = { common: '普通', magic: '魔法', rare: '稀有', epic: '史诗', mythic: '神话', legendary: '传说' };
            const diag = qualityOrder.map(q => {
                const total = this.gameState.gems.filter(g => g.quality === q).length;
                const unlocked = this.gameState.gems.filter(g => g.quality === q && !g.locked).length;
                return `${qualityNames[q]}:${unlocked}/${total}`;
            }).join(' | ');
            return { success: false, message: `没有足够的宝石可以合成（需要同品质10个未锁定）。当前：${diag}${lastError ? ' | 错误:' + lastError : ''}` };
        }

        return { success: true, count: totalSynthesized, results };
    }

    // ==================== 一键购买并合成永恒宝石（分步异步）====================

    // 一键合成永恒的运行状态（用于UI进度回调）
    _autoEternalState = null;

    // 初始化一键合成永恒的状态
    startAutoEternal() {
        if (!this.isGoldUnlocked()) return { success: false, message: '尚未解锁金币系统' };
        const price = 1000;
        if (this.gameState.gold < price) return { success: false, message: '金币不足' };

        const startEternalCount = this.gameState.gems.filter(g => g.quality === 'eternal').length;
        this._autoEternalState = {
            running: true,
            startEternalCount,
            totalBought: 0,
            totalSpent: 0,
            totalSynthesized: 0,
            rounds: 0,
            price,
        };
        return { success: true };
    }

    // 执行一轮：购买填满背包 + 合成一次。返回本轮结果和累计状态
    autoBuySynthStep() {
        if (!this._autoEternalState || !this._autoEternalState.running) {
            return { done: true, reason: 'stopped', ...this._getAutoEternalResult('stopped') };
        }

        const s = this._autoEternalState;
        const price = s.price;
        s.rounds++;

        // 步骤1：购买填满背包
        const bagRemain = GEM_BAG_MAX - this.gameState.gems.length;
        const affordable = Math.floor(this.gameState.gold / price);
        const buyCount = Math.min(bagRemain, affordable);

        if (buyCount > 0) {
            for (let i = 0; i < buyCount; i++) {
                this.gameState.gold -= price;
                const gem = this.generateGem();
                gem.isNew = true;
                this.gameState.gems.push(gem);
            }
            s.totalBought += buyCount;
            s.totalSpent += buyCount * price;
        }

        // 步骤2：一键合成（快速模式：跳过冗余验证和逐次save）
        const synthResult = this.synthesizeAllGems(true);
        if (synthResult.success) {
            s.totalSynthesized += synthResult.count;
        }

        // 用 Map 一次遍历统计品质计数（替代多次 filter）
        const qualityCounts = {};
        let currentEternalCount = 0;
        for (const g of this.gameState.gems) {
            if (g.quality === 'eternal') {
                currentEternalCount++;
            } else if (!g.locked) {
                qualityCounts[g.quality] = (qualityCounts[g.quality] || 0) + 1;
            }
        }

        // 检查是否产生了新的永恒宝石
        if (currentEternalCount > s.startEternalCount) {
            const newEternalCount = currentEternalCount - s.startEternalCount;
            this.save();
            this._autoEternalState.running = false;
            return { done: true, reason: 'eternal_found', newEternals: newEternalCount, ...this._getAutoEternalResult('eternal_found', newEternalCount) };
        }

        // 检查是否还能继续（用 Map 计数判断，O(n)→O(1)）
        const canBuyMore = this.gameState.gold >= price && this.gameState.gems.length < GEM_BAG_MAX;
        const canSynthMore = Object.values(qualityCounts).some(count => count >= 10);

        if (!canBuyMore && !canSynthMore) {
            this.save();
            this._autoEternalState.running = false;
            const endReason = this.gameState.gold < price ? 'gold_empty' : 'bag_full';
            return { done: true, reason: endReason, ...this._getAutoEternalResult(endReason) };
        }

        // 还在继续中
        return { done: false, rounds: s.rounds, totalBought: s.totalBought, totalSpent: s.totalSpent, totalSynthesized: s.totalSynthesized };
    }

    // 停止一键合成永恒
    stopAutoEternal() {
        if (this._autoEternalState) {
            this._autoEternalState.running = false;
        }
    }

    // 获取最终结果
    _getAutoEternalResult(reason, newEternals = 0) {
        const s = this._autoEternalState || {};
        return {
            success: reason !== 'stopped',
            bought: s.totalBought || 0,
            spent: s.totalSpent || 0,
            synthesized: s.totalSynthesized || 0,
            newEternals,
            rounds: s.rounds || 0,
            reason,
        };
    }
    // 宝石加成（缓存）。镶嵌/卸下/读档时失效；返回对象视为只读。
    getGemBonuses() {
        if (this._gemBonusCache) return this._gemBonusCache;
        const bonuses = {};
        for (const attr of GEM_ATTRIBUTES) {
            bonuses[attr.id] = 0;
        }
        for (const regionId in this.gameState.badges) {
            const badge = this.gameState.badges[regionId];
            if (badge?.unlocked && badge.gem) {
                for (const attr of badge.gem.attrs) {
                    bonuses[attr.id] = (bonuses[attr.id] || 0) + attr.value;
                }
            }
        }
        this._gemBonusCache = bonuses;
        return bonuses;
    }

    // ===================== 技能系统 =====================
    // 检查技能系统是否解锁（合众地区通关）
    isSkillUnlocked() {
        return this.isRegionCompleted('unova');
    }

    // 自动更换最优宝可梦：计算队伍中对指定敌人预估伤害最高的成员索引
    // 支持一击必杀策略：fastest(速度最快) / lowest_level(等级最低) / no_change(不改变)
    // cache（可选，离线模拟用）：{ teamStats[], teamLevels[] }，避免每场重算队伍属性
    getBestTeamMemberForEnemy(wildPokemon, cache = null) {
        this.roster.reconcile();
        const team = this.gameState.team;
        if (!team || team.length <= 1) return -1;

        const wildTypes = POKEMON_DATA[wildPokemon.id]?.types || [];
        const enemyStats = this.calculateStats(wildPokemon);
        const enemyHp = enemyStats.hp;
        const oneShotStrategy = this.gameState.settings?.oneShotStrategy || 'fastest';

        // 收集每只队友的预估数据
        const candidates = [];

        for (let i = 0; i < team.length; i++) {
            const member = this._partyInstance(i);
            if (!member) continue;
            const pokemonId = member.speciesId;
            const stats = cache ? cache.teamStats[i] : this.calculateBattleStats(i);
            if (!stats) continue;
            const level = cache ? cache.teamLevels[i] : member.level;
            if (!level) continue;

            const playerTypes = POKEMON_DATA[pokemonId]?.types || [];

            // 最优技能威力（选对敌人克制最强的技能，用该个体自己的技能等级），无技能时固定 50
            const skill = this._getBestSkillForInstance(member, wildTypes);
            const power = skill.power > 0 ? skill.power : 50;

            // 使用与 _computeDamage 一致的公式预估单次伤害
            const baseDmg = Math.floor(((2 * level / 5 + 2) * power * stats.attack / enemyStats.defense) / 50) + 2;
            const typeMult = getBestTypeEffectiveness(playerTypes, wildTypes).multiplier;
            const estimatedDmg = Math.floor(baseDmg * typeMult);
            // 考虑伤害波动最低值(85%)来判定一击必杀，避免因波动导致需要两次攻击
            const minDmg = Math.floor(estimatedDmg * 0.85);

            const atkInterval = this.getAttackInterval(stats.speed);
            const canOneShot = minDmg >= enemyHp;
            // DPS 分数 = 单次伤害 / 攻击间隔
            const dps = estimatedDmg / atkInterval;

            candidates.push({ index: i, estimatedDmg, atkInterval, canOneShot, dps, level });
        }

        if (candidates.length === 0) return -1;

        // 一击必杀策略为"不改变"时：如果当前出战宝可梦能一击，则不切换
        if (oneShotStrategy === 'no_change') {
            const currentCandidate = candidates.find(c => c.index === this.gameState.activePokemonIndex);
            if (currentCandidate && currentCandidate.canOneShot) {
                return this.gameState.activePokemonIndex;
            }
        }

        // 排序策略
        candidates.sort((a, b) => {
            // 能一击的排在前面
            if (a.canOneShot && !b.canOneShot) return -1;
            if (!a.canOneShot && b.canOneShot) return 1;
            // 都能一击击杀 → 根据策略选择
            if (a.canOneShot && b.canOneShot) {
                if (oneShotStrategy === 'lowest_level') {
                    // 等级低的优先（练级）
                    return a.level - b.level;
                }
                // 默认 fastest：攻击间隔短（攻速快）的优先
                return a.atkInterval - b.atkInterval;
            }
            // 都不能一击击杀 → DPS 高的优先
            return b.dps - a.dps;
        });

        return candidates[0].index;
    }

    // 获取宝可梦当前技能信息（根据属性和技能等级）
    // 返回: { skills: [{ type, name, power }], skillLevel } 或 null
    // 旧接口：某物种的技能（instance 可指定个体，不传则用主个体）
    getSkillForPokemon(pokemonId, instance = null) {
        const inst = instance || this.roster.primaryOf(pokemonId);
        return inst ? this.getSkillForInstance(inst) : null;
    }

    // 个体的技能：由它自己的技能等级与物种属性决定
    getSkillForInstance(inst) {
        if (!inst || !inst.skillLevel || inst.skillLevel <= 0) return null;

        const baseData = POKEMON_DATA[inst.speciesId];
        if (!baseData) return null;

        const skillLevel = inst.skillLevel;
        const types = baseData.types || [];
        const skills = [];

        for (const type of types) {
            const typeSkills = SKILL_DATA[type];
            if (typeSkills) {
                const skill = typeSkills.find(s => s.level === skillLevel);
                if (skill) {
                    skills.push({ type, name: skill.name, power: skill.power });
                }
            }
        }

        return { skills, skillLevel };
    }

    // 升级宝可梦技能：等级重置为1，技能等级+1，超过1000的等级换算为经验返还
    upgradeSkill(pokemonId) {
        if (!this.isSkillUnlocked()) return { success: false, message: '技能系统尚未解锁' };

        const storedData = this.gameState.caughtPokemon[pokemonId];
        if (!storedData) return { success: false, message: '未捕获该宝可梦' };

        const currentSkillLevel = storedData.skillLevel || 0;
        if (currentSkillLevel >= MAX_SKILL_LEVEL) return { success: false, message: '技能等级已达上限' };
        if (storedData.level < SKILL_LEVEL_REQUIREMENT) return { success: false, message: `等级需达到 ${SKILL_LEVEL_REQUIREMENT} 级` };

        const baseData = POKEMON_DATA[pokemonId];
        if (!baseData) return { success: false, message: '无效的宝可梦' };

        const oldLevel = storedData.level;

        // 计算超过1000级的经验返还
        let returnExp = 0;
        if (oldLevel > SKILL_LEVEL_REQUIREMENT) {
            // 超出部分等级对应的经验值（当前总经验 - 1000级所需经验）
            const expAt1000 = getExpForLevel(baseData.expGroup, SKILL_LEVEL_REQUIREMENT);
            returnExp = Math.max(0, storedData.exp - expAt1000);
        }

        // 重置等级为1，经验为返还经验
        storedData.level = 1;
        storedData.exp = returnExp;
        storedData.skillLevel = currentSkillLevel + 1;
        this._touchSpecies(pokemonId);

        // 根据返还经验重新计算等级
        while (storedData.level < MAX_POKEMON_LEVEL) {
            const nextLevelExp = getExpForLevel(baseData.expGroup, storedData.level + 1);
            if (storedData.exp >= nextLevelExp) {
                storedData.level++;
            } else {
                break;
            }
        }

        this._touchSpecies(pokemonId);
        // 检查进化（因为等级变化可能触发）
        this.checkEvolution(pokemonId);

        // 如果在队伍中，需要刷新战斗状态
        const teamIndex = this.gameState.team.indexOf(pokemonId);
        if (teamIndex !== -1 && this.currentBattle) {
            // 重新计算战斗属性
            const newPlayerStats = this.calculateBattleStats(this.gameState.activePokemonIndex);
            if (newPlayerStats && teamIndex === this.gameState.activePokemonIndex) {
                this.currentBattle.playerStats = newPlayerStats;
                this.currentBattle.playerMaxHp = newPlayerStats.hp;
                this.currentBattle.playerCurrentHp = newPlayerStats.hp;
                this.currentBattle.playerNextAttack = this.getAttackInterval(newPlayerStats.speed);
            }
            this._cacheBattleDerived();
        }

        this.save();
        return {
            success: true,
            newSkillLevel: storedData.skillLevel,
            newLevel: storedData.level,
            oldLevel: oldLevel,
            returnExp: returnExp,
        };
    }

    // 一键升级所有可升级技能的宝可梦
    upgradeAllSkills() {
        if (!this.isSkillUnlocked()) return { success: false, message: '技能系统尚未解锁' };

        const results = [];
        for (const pokemonId in this.gameState.caughtPokemon) {
            const storedData = this.gameState.caughtPokemon[pokemonId];
            if (!storedData) continue;

            const currentSkillLevel = storedData.skillLevel || 0;
            if (currentSkillLevel >= MAX_SKILL_LEVEL) continue;
            if (storedData.level < SKILL_LEVEL_REQUIREMENT) continue;

            const baseData = POKEMON_DATA[pokemonId];
            if (!baseData) continue;

            const oldLevel = storedData.level;

            // 计算超过1000级的经验返还
            let returnExp = 0;
            if (oldLevel > SKILL_LEVEL_REQUIREMENT) {
                const expAt1000 = getExpForLevel(baseData.expGroup, SKILL_LEVEL_REQUIREMENT);
                returnExp = Math.max(0, storedData.exp - expAt1000);
            }

            // 重置等级为1，经验为返还经验
            storedData.level = 1;
            storedData.exp = returnExp;
            storedData.skillLevel = currentSkillLevel + 1;
            this._touchSpecies(Number(pokemonId));

            // 根据返还经验重新计算等级
            while (storedData.level < MAX_POKEMON_LEVEL) {
                const nextLevelExp = getExpForLevel(baseData.expGroup, storedData.level + 1);
                if (storedData.exp >= nextLevelExp) {
                    storedData.level++;
                } else {
                    break;
                }
            }

            this._touchSpecies(Number(pokemonId));
            // 检查进化
            this.checkEvolution(pokemonId);

            // 如果在队伍中，刷新战斗状态
            const teamIndex = this.gameState.team.indexOf(Number(pokemonId));
            if (teamIndex !== -1 && this.currentBattle) {
                const newPlayerStats = this.calculateBattleStats(this.gameState.activePokemonIndex);
                if (newPlayerStats && teamIndex === this.gameState.activePokemonIndex) {
                    this.currentBattle.playerStats = newPlayerStats;
                    this.currentBattle.playerMaxHp = newPlayerStats.hp;
                    this.currentBattle.playerCurrentHp = newPlayerStats.hp;
                    this.currentBattle.playerNextAttack = this.getAttackInterval(newPlayerStats.speed);
                }
                this._cacheBattleDerived();
            }

            results.push({
                id: pokemonId,
                name: baseData.name,
                newSkillLevel: storedData.skillLevel,
                newLevel: storedData.level,
                oldLevel: oldLevel,
            });
        }

        if (results.length === 0) {
            return { success: false, message: '没有可升级技能的宝可梦（需要等级≥1000且技能未满级）' };
        }

        this.save();
        return { success: true, count: results.length, results };
    }

    // ===================== 天赋系统 =====================
    // 检查天赋系统是否解锁（阿罗拉地区通关）
    isTalentUnlocked() {
        return this.isRegionCompleted('alola');
    }

    // 获取全部宝可梦等级之和
    getTotalPokemonLevel() {
        let totalLevel = 0;
        for (const id in this.gameState.caughtPokemon) {
            totalLevel += this.gameState.caughtPokemon[id].level || 0;
        }
        return totalLevel;
    }

    // 计算天赋点总数 = 全部宝可梦等级之和 / 10000
    getTotalTalentPoints() {
        return Math.floor(this.getTotalPokemonLevel() / 10000);
    }

    // 获取已使用的天赋点数
    getUsedTalentPoints() {
        const talents = this.gameState.talents || {};
        let used = 0;
        for (const id in talents) {
            if (id !== 'gemAttrChoice') {
                used += (talents[id] || 0);
            }
        }
        return used;
    }

    // 获取剩余天赋点数
    getRemainingTalentPoints() {
        return this.getTotalTalentPoints() - this.getUsedTalentPoints();
    }

    // 获取某个天赋的当前等级
    getTalentLevel(talentId) {
        return (this.gameState.talents || {})[talentId] || 0;
    }

    // 获取某个天赋的效果值
    getTalentValue(talentId) {
        const talent = TALENT_DATA[talentId];
        if (!talent) return 0;
        const level = this.getTalentLevel(talentId);
        return level * talent.perLevel;
    }

    // 根据天赋计算怪物等级提升后的新等级
    // 公式: L' = L + (30000 - L) × (X / 100)
    // L=原始等级, X=天赋等级, 满级时全图怪物均为30000级
    // 注意: 原始等级 >= 30000 的怪物不受天赋影响（Mega地区等高等级区域）
    getMonsterLevelBoost(originalLevel) {
        const talentLevel = this.getTalentLevel('team_exp_bonus');
        if (talentLevel <= 0) return originalLevel;
        if (originalLevel >= 30000) return originalLevel; // 超过3W级不受天赋影响
        const boosted = originalLevel + (30000 - originalLevel) * (talentLevel / 100);
        return Math.round(boosted);
    }

    // 升级天赋（支持多级升级）
    upgradeTalent(talentId, levels = 1) {
        if (!this.isTalentUnlocked()) return { success: false, message: '天赋系统尚未解锁' };
        const talent = TALENT_DATA[talentId];
        if (!talent) return { success: false, message: '无效的天赋' };

        if (!this.gameState.talents) this.gameState.talents = {};
        const currentLevel = this.gameState.talents[talentId] || 0;

        if (currentLevel >= talent.maxLevel) return { success: false, message: '已达最大等级' };

        const remaining = this.getRemainingTalentPoints();
        const maxUpgradeable = Math.min(levels, talent.maxLevel - currentLevel, remaining);

        if (maxUpgradeable <= 0) return { success: false, message: '天赋点不足' };

        this.gameState.talents[talentId] = currentLevel + maxUpgradeable;
        this.save();

        return {
            success: true,
            newLevel: this.gameState.talents[talentId],
            pointsUsed: maxUpgradeable,
        };
    }

    // 重置天赋（消耗100万金币）
    resetTalents() {
        if (!this.isTalentUnlocked()) return { success: false, message: '天赋系统尚未解锁' };
        if (this.gameState.gold < TALENT_RESET_COST) {
            return { success: false, message: `金币不足，重置需要 ${TALENT_RESET_COST.toLocaleString()} 金币` };
        }

        this.gameState.gold -= TALENT_RESET_COST;
        // 保留 gemAttrChoice，重置天赋等级
        const gemChoice = this.gameState.talents?.gemAttrChoice;
        this.gameState.talents = {};
        if (gemChoice) this.gameState.talents.gemAttrChoice = gemChoice;
        this.save();

        return { success: true, cost: TALENT_RESET_COST };
    }

    // 设置宝石属性偏好（第10个天赋：选择一条宝石属性）
    setTalentGemAttrChoice(attrId) {
        const valid = GEM_ATTRIBUTES.find(a => a.id === attrId);
        if (!valid) return { success: false, message: '无效的宝石属性' };
        if (!this.gameState.talents) this.gameState.talents = {};
        this.gameState.talents.gemAttrChoice = attrId;
        this.save();
        return { success: true, attrId };
    }

    // 获取当前宝石属性偏好选择
    getTalentGemAttrChoice() {
        return this.gameState.talents?.gemAttrChoice || null;
    }

    // 获取技能等级总和（用于第9个天赋计算）
    getSkillLevelSum() {
        let sum = 0;
        for (const id in this.gameState.caughtPokemon) {
            sum += (this.gameState.caughtPokemon[id].skillLevel || 0);
        }
        return sum;
    }

    // 获取天赋系统对属性的额外加成百分比（用于 calculateBattleStats）
    getTalentStatBonusPercent() {
        const talentLevel = this.getTalentLevel('skill_stat_bonus');
        if (talentLevel <= 0) return 0;
        const skillSum = this.getSkillLevelSum();
        return skillSum * talentLevel * 0.0002;
    }

    // ===================== 树果系统 =====================
    // 检查树果系统是否解锁（丰缘图鉴全完成）
    isBerryUnlocked() {
        return this.isRegionCompleted('hoenn');
    }

    // 种植树果（购买种子，花费金币）
    plantBerry(berryId) {
        if (!this.isBerryUnlocked()) return { success: false, message: '树果系统尚未解锁' };
        if (!BERRY_DATA[berryId]) return { success: false, message: '无效的树果类型' };
        if (this.gameState.berryPlots.length >= BERRY_PLOT_MAX) return { success: false, message: '没有空地了' };
        // 花费金币购买种子
        if (this.gameState.gold < BERRY_SEED_PRICE) {
            return { success: false, message: `金币不足，购买种子需要 ${BERRY_SEED_PRICE.toLocaleString()} 金币` };
        }
        this.gameState.gold -= BERRY_SEED_PRICE;
        this.gameState.berryPlots.push({ berryId, plantedAt: Date.now() });
        this.save();
        return { success: true };
    }

    // 种植树果（不消耗背包，首次解锁时的免费种子直接种到地里）
    plantBerryFree(berryId) {
        if (!this.isBerryUnlocked()) return { success: false, message: '树果系统尚未解锁' };
        if (!BERRY_DATA[berryId]) return { success: false, message: '无效的树果类型' };
        if (this.gameState.berryPlots.length >= BERRY_PLOT_MAX) return { success: false, message: '没有空地了' };
        this.gameState.berryPlots.push({ berryId, plantedAt: Date.now() });
        this.save();
        return { success: true };
    }

    // 获取实际树果成熟时间（考虑树果时间徽章减半效果 + 天赋减少）
    getEffectiveBerryGrowTime() {
        let growTime = BERRY_GROW_TIME;
        const berryTimeValue = this.getBadgeEffectValue('berry_time_bonus');
        if (berryTimeValue !== null) {
            growTime = Math.floor(growTime * berryTimeValue); // ×0.5 = 减半
        }
        // 天赋：树果成熟时间-x分钟
        const talentBerryReduce = this.getTalentValue('berry_time_reduce');
        if (talentBerryReduce > 0) {
            growTime -= talentBerryReduce * 60 * 1000; // 每级减1分钟
            growTime = Math.max(60 * 1000, growTime); // 最低1分钟
        }
        return growTime;
    }

    // 检查某个种植槽是否成熟
    isBerryRipe(plotIndex) {
        const plot = this.gameState.berryPlots[plotIndex];
        if (!plot) return false;
        return (Date.now() - plot.plantedAt) >= this.getEffectiveBerryGrowTime();
    }

    // 获取种植槽剩余时间（毫秒）
    getBerryTimeLeft(plotIndex) {
        const plot = this.gameState.berryPlots[plotIndex];
        if (!plot) return 0;
        const elapsed = Date.now() - plot.plantedAt;
        return Math.max(0, this.getEffectiveBerryGrowTime() - elapsed);
    }

    // 采摘树果（收获到背包）
    harvestBerry(plotIndex) {
        if (!this.isBerryUnlocked()) return { success: false, message: '树果系统尚未解锁' };
        const plot = this.gameState.berryPlots[plotIndex];
        if (!plot) return { success: false, message: '该地块没有种植树果' };
        if (!this.isBerryRipe(plotIndex)) return { success: false, message: '树果还没有成熟' };
        const berryId = plot.berryId;
        const berryInfo = BERRY_DATA[berryId];
        // 收获：每次采摘获得1~2个
        let yield_count = 1 + Math.floor(this.rng() * 2); // 1, 2
        // 树果收获翻倍（berry_yield_bonus 效果）
        const berryYieldValue = this.getBadgeEffectValue('berry_yield_bonus');
        if (berryYieldValue !== null) {
            yield_count *= berryYieldValue; // ×2
        }
        this.gameState.berryBag[berryId] = (this.gameState.berryBag[berryId] || 0) + yield_count;
        // 移除该种植槽
        this.gameState.berryPlots.splice(plotIndex, 1);
        this.save();
        return { success: true, berryId, berryName: berryInfo.name, count: yield_count };
    }

    // 采摘所有已成熟的树果
    harvestAllBerries() {
        if (!this.isBerryUnlocked()) return { success: false, message: '树果系统尚未解锁' };
        const results = [];
        // 从后往前遍历避免索引偏移
        for (let i = this.gameState.berryPlots.length - 1; i >= 0; i--) {
            if (this.isBerryRipe(i)) {
                const result = this.harvestBerry(i);
                if (result.success) results.push(result);
            }
        }
        if (results.length === 0) return { success: false, message: '没有可采摘的树果' };
        return { success: true, results };
    }

    // 喂食树果给宝可梦
    feedBerry(pokemonId, berryId) {
        if (!this.isBerryUnlocked()) return { success: false, message: '树果系统尚未解锁' };
        if (!BERRY_DATA[berryId]) return { success: false, message: '无效的树果' };
        if (this.gameState.pokedex[pokemonId] !== 'caught') return { success: false, message: '未捕获该宝可梦' };
        // 检查背包
        if (!this.gameState.berryBag[berryId] || this.gameState.berryBag[berryId] <= 0) {
            return { success: false, message: `没有${BERRY_DATA[berryId].name}了` };
        }
        // 检查该宝可梦的该类树果是否已达上限
        if (!this.gameState.berryFed[pokemonId]) this.gameState.berryFed[pokemonId] = {};
        const currentFed = this.gameState.berryFed[pokemonId][berryId] || 0;
        const maxForType = this.getBerryMaxForType(pokemonId, berryId);
        if (currentFed >= maxForType) {
            return { success: false, message: `该宝可梦${BERRY_DATA[berryId].name}已达上限（${currentFed}/${maxForType}）` };
        }
        // 扣除背包
        this.gameState.berryBag[berryId]--;
        if (this.gameState.berryBag[berryId] <= 0) delete this.gameState.berryBag[berryId];
        // 记录喂食
        this.gameState.berryFed[pokemonId][berryId] = currentFed + 1;
        this._touchSpecies(pokemonId);
        this.save();
        return { success: true, fed: currentFed + 1, max: maxForType };
    }

    // 获取某宝可梦某种树果的最大喂食数量：向上取整，允许最后一个果子部分生效（实际加成仍封顶255）
    getBerryMaxForType(pokemonId, berryId) {
        const berry = BERRY_DATA[berryId];
        if (!berry) return 0;
        const baseStats = POKEMON_DATA[pokemonId]?.baseStats;
        if (!baseStats) return 0;
        const rawStat = baseStats[berry.stat] || 0;
        return Math.max(0, Math.ceil((BERRY_STAT_CAP - rawStat) / BERRY_STAT_BONUS));
    }

    // 获取宝可梦的树果加成 { stat: bonusValue }（每个树果+5种族值）
    getBerryBonuses(pokemonId) {
        const bonuses = {};
        const fed = this.gameState.berryFed[pokemonId];
        if (!fed) return bonuses;
        for (const berryId in fed) {
            const berry = BERRY_DATA[berryId];
            if (berry && fed[berryId] > 0) {
                bonuses[berry.stat] = (bonuses[berry.stat] || 0) + fed[berryId] * BERRY_STAT_BONUS;
            }
        }
        return bonuses;
    }

    // 获取宝可梦已喂食树果总数
    getBerryFedTotal(pokemonId) {
        const fed = this.gameState.berryFed[pokemonId];
        if (!fed) return 0;
        let total = 0;
        for (const berryId in fed) total += fed[berryId];
        return total;
    }

    // 获取背包树果总数
    getBerryBagTotal() {
        let total = 0;
        for (const berryId in this.gameState.berryBag) total += this.gameState.berryBag[berryId];
        return total;
    }

    // ===================== 挑战塔系统 =====================
    // 检查挑战塔是否解锁（帕底亚地区通关）
    isTowerUnlocked() {
        return this.isRegionCompleted('paldea');
    }

    // 获取挑战塔某层的怪物等级
    getTowerFloorLevel(floor) {
        return TOWER_BASE_LEVEL + (floor - 1) * TOWER_LEVEL_INCREMENT;
    }

    // 获取种族值>500的宝可梦ID候选池（缓存）
    _getTowerCandidatePool(floor = 0) {
        // 201层及以上使用超高种族值池（>650），151-200层使用高种族值池（>580），普通层用>500
        let usePool, cacheKey, minTotal;
        if (floor >= 201) {
            usePool = 'ultra';
            cacheKey = '_towerCandidatePoolUltra';
            minTotal = 650;
        } else if (floor >= 151) {
            usePool = 'elite';
            cacheKey = '_towerCandidatePoolElite';
            minTotal = 580;
        } else {
            usePool = 'normal';
            cacheKey = '_towerCandidatePool';
            minTotal = TOWER_MIN_BASE_STAT_TOTAL;
        }
        if (this[cacheKey]) return this[cacheKey];
        const pool = [];
        for (const id in POKEMON_DATA) {
            const data = POKEMON_DATA[id];
            if (!data.baseStats) continue;
            const total = Object.values(data.baseStats).reduce((a, b) => a + b, 0);
            if (total > minTotal) {
                pool.push(parseInt(id));
            }
        }
        this[cacheKey] = pool;
        return pool;
    }

    // 生成挑战塔某层的6只敌方宝可梦ID列表（只存id，不缓存属性）
    generateTowerFloorEnemies(floor) {
        const pool = this._getTowerCandidatePool(floor);
        const enemyIds = [];
        const usedIds = new Set();

        for (let i = 0; i < TOWER_ENEMIES_PER_FLOOR; i++) {
            let id;
            let attempts = 0;
            do {
                id = pool[Math.floor(this.rng() * pool.length)];
                attempts++;
            } while (usedIds.has(id) && attempts < 100);
            usedIds.add(id);
            enemyIds.push(id);
        }
        return enemyIds;
    }

    // 根据挑战塔敌人ID实时构建完整宝可梦对象（不缓存，每次战斗实时计算）
    buildTowerEnemy(pokemonId, floor) {
        const level = this.getTowerFloorLevel(floor);
        const baseData = POKEMON_DATA[pokemonId];
        return {
            id: pokemonId,
            name: baseData.name,
            level: level,
            ivs: { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 },
            isShiny: true, // 挑战塔怪物全部闪光
            isWild: true,  // 敌方不享受玩家树果加成
        };
    }

    // 进入挑战塔（暂停主线战斗，初始化当前层）
    enterTower() {
        if (!this.isTowerUnlocked()) return { success: false, message: '挑战塔未解锁' };

        const tower = this.gameState.tower;

        // 如果当前层没有敌人，生成新的（只存id列表）
        if (!tower.enemies) {
            tower.enemies = this.generateTowerFloorEnemies(tower.currentFloor);
            tower.currentEnemyIndex = 0;
        }
        // 兼容旧存档：如果 enemies 是对象数组，迁移为纯 id 数组
        if (tower.enemies.length > 0 && typeof tower.enemies[0] === 'object') {
            tower.enemies = tower.enemies.map(e => e.id);
        }

        // 暂停主线战斗
        this.stopBattle();
        this._towerMode = true;
        this._towerPlayerHpPercent = 1; // 进入新层时满血
        tower.inBattle = true;

        this.save();
        return { success: true, tower: tower };
    }

    // 退出挑战塔（恢复主线战斗）
    exitTower() {
        this._towerMode = false;
        this._towerBattle = null;
        this.gameState.tower.inBattle = false;
        this.save();
        // 恢复主线战斗
        this.startBattle();
    }

    // 开始挑战塔当前层的战斗（与当前敌人开始战斗）
    startTowerBattle() {
        if (!this._towerMode) return;

        const tower = this.gameState.tower;
        if (!tower.enemies || tower.currentEnemyIndex >= tower.enemies.length) return;

        // 从 id 实时构建敌方宝可梦（不缓存属性，确保实时计算）
        const enemyId = tower.enemies[tower.currentEnemyIndex];
        const enemy = this.buildTowerEnemy(enemyId, tower.currentFloor);
        const enemyStats = this.calculateStats(enemy);

        // 自动更换最优宝可梦出战（与主线战斗一致）
        if (this.gameState.settings?.autoSwitchBest && this.gameState.team.length > 1) {
            const bestIndex = this.getBestTeamMemberForEnemy(enemy);
            if (bestIndex !== -1 && bestIndex !== this.gameState.activePokemonIndex) {
                this.gameState.activePokemonIndex = bestIndex;
                this.save();
                if (this.onBattleEvent) {
                    this.onBattleEvent('autoSwitched', { newIndex: bestIndex });
                }
            }
        }

        // 获取玩家战斗属性
        const playerStats = this.calculateBattleStats(this.gameState.activePokemonIndex);
        if (!playerStats) return;

        // 计算玩家 HP（按百分比继承）
        const playerHp = Math.max(1, Math.floor(playerStats.hp * this._towerPlayerHpPercent));

        this.currentBattle = {
            wild: enemy,
            wildMaxHp: enemyStats.hp,
            wildCurrentHp: enemyStats.hp,
            wildStats: enemyStats,
            playerMaxHp: playerStats.hp,
            playerCurrentHp: playerHp,
            playerStats: playerStats,
            playerNextAttack: this.getAttackInterval(playerStats.speed),
            enemyNextAttack: this.getAttackInterval(enemyStats.speed),
            playerTimer: 0,
            enemyTimer: 0,
            lastTick: Date.now(),
        };
        this._cacheBattleDerived();

        if (this.onBattleEvent) {
            this.onBattleEvent('start', this.currentBattle);
        }

        this.startBattleLoop();
    }

    // 挑战塔内敌人被击败
    onTowerEnemyDefeated() {
        this.stopBattle();
        const battle = this.currentBattle;
        const tower = this.gameState.tower;

        // 记录玩家 HP 百分比（不回血，直接继承当前血量）
        this._towerPlayerHpPercent = battle.playerCurrentHp / battle.playerMaxHp;

        tower.currentEnemyIndex++;

        // 通知 UI 更新
        if (this.onBattleEvent) {
            this.onBattleEvent('towerEnemyDefeated', {
                floorIndex: tower.currentEnemyIndex,
                totalEnemies: TOWER_ENEMIES_PER_FLOOR,
                playerHp: battle.playerCurrentHp,
                playerMaxHp: battle.playerMaxHp,
            });
        }

        // 检查是否通关本层
        if (tower.currentEnemyIndex >= TOWER_ENEMIES_PER_FLOOR) {
            // 通关本层
            if (tower.currentFloor > tower.highestFloor) {
                tower.highestFloor = tower.currentFloor;
            }

            if (this.onBattleEvent) {
                this.onBattleEvent('towerFloorCleared', {
                    floor: tower.currentFloor,
                    highestFloor: tower.highestFloor,
                });
            }

            // 推进到下一层
            if (tower.currentFloor < TOWER_MAX_FLOOR) {
                tower.currentFloor++;
            }
            tower.enemies = null;
            tower.currentEnemyIndex = 0;
            tower.inBattle = false;
            this._towerMode = false;
            this._towerPlayerHpPercent = 1; // 新层满血

            this.save();
            return;
        }

        this.save();

        // 短暂延迟后开始下一只
        setTimeout(() => {
            if (this._towerMode) {
                this.startTowerBattle();
            }
        }, 800);
    }

    // 挑战塔内玩家失败
    onTowerPlayerFainted() {
        this.stopBattle();

        if (this.onBattleEvent) {
            this.onBattleEvent('towerPlayerFainted', {
                floor: this.gameState.tower.currentFloor,
                enemyIndex: this.gameState.tower.currentEnemyIndex,
            });
        }

        // 失败后重置进度，重新挑战从第一只怪开始
        this._towerMode = false;
        this._towerBattle = null;
        this._towerPlayerHpPercent = 1;
        this.gameState.tower.inBattle = false;
        this.gameState.tower.currentEnemyIndex = 0;

        this.save();
    }

    // 获取挑战塔通关加成百分比
    getTowerBonus() {
        return this.gameState.tower?.highestFloor || 0;
    }
}
