// ============================================================
// 新手引导与目标（Guidance）：回答玩家两个问题——“我现在该做什么？”和“继续玩能得到什么？”
//
//   1. 新手引导：5 个很短的步骤（战斗 → 捕获 → PC → 组队 → 探索），每一步都由“游戏状态”判定完成，
//      所以玩家按自己的节奏玩也会被正确识别；完成一步给一点经验奖励；随时可以跳过；老存档自动跳过。
//   2. 下一步建议（getNextAction）：永远给出一条最该做的事——引导步骤 > 当前道路已抓齐则推荐新道路 >
//      即将进化 > 最接近完成的目标。
//   3. 目标（GUIDE_GOALS）：用现有系统（图鉴/战斗数/等级/进化/闪光/地区解锁）派生的里程碑，达成自动发奖励。
//   4. 道路进度（getRouteProgress / getRecommendedRoute）：每条道路还有几种没抓到。
//
// 不含任何 DOM，状态存在 gameState.guide（随存档保存），所以可以在 Node 里完整测试。
// 奖励只有“少量经验”（不是新的经济系统）：不超过出战宝可梦当前等级升一级所需经验。
// ============================================================
const GUIDE_REWARD_MIN_EXP = 10;
const GUIDE_EVOLUTION_NEAR_LEVELS = 6;      // 距离进化等级不超过这么多级时，提示“即将进化”
const GUIDE_UPDATE_MIN_INTERVAL_MS = 1000;  // 由战斗胜利触发的检查最多每秒一次

// 新手引导步骤。done(game)：由状态判定；cta：可点的快捷入口
const GUIDE_ONBOARDING_STEPS = [
    {
        id: 'battle', icon: '⚔️', title: 'Assista à sua primeira batalha',
        text: 'A batalha é automática. Espere seu Pikachu vencer o primeiro Pokémon selvagem.',
        done: (g) => g.gameState.stats.totalBattles >= 1,
        progress: (g) => ({ current: Math.min(1, g.gameState.stats.totalBattles), total: 1 }),
        reward: 0.3,
        doneText: 'Boa! Vencer dá EXP, e seu Pikachu fica cada vez mais forte.',
    },
    {
        id: 'capture', icon: '🎯', title: 'Capture seu primeiro Pokémon',
        text: 'Vencer um Pokémon selvagem captura ele automaticamente. Ganhe mais algumas batalhas!',
        done: (g) => g.getPokedexStats().caught >= 2,
        progress: (g) => ({ current: Math.min(2, g.getPokedexStats().caught), total: 2, label: 'Coletados' }),
        reward: 0.4,
        doneText: 'Você tem um novo Pokémon! Ele foi enviado para o PC.',
    },
    {
        id: 'pc', icon: '🖥️', title: 'Abra o PC',
        text: 'Seu novo Pokémon está no PC. Toque em “PC” lá embaixo.',
        done: (g) => !!g.gameState.guide.flags.pcOpened,
        cta: { label: 'Abrir PC', tab: 'tab-pc' },
        reward: 0.2,
        doneText: 'O PC guarda quem não está na equipe. Se capturar a mesma espécie de novo, cada um aparece separado.',
    },
    {
        id: 'party', icon: '👥', title: 'Monte sua equipe',
        text: 'No PC, toque no novo Pokémon e depois em “Adicionar à equipe”. Quem está na equipe ganha EXP junto.',
        done: (g) => g.gameState.party.length >= 2,
        progress: (g) => ({ current: Math.min(2, g.gameState.party.length), total: 2, label: 'Equipe' }),
        cta: { label: 'Ir ao PC', tab: 'tab-pc' },
        reward: 0.5,
        doneText: 'A equipe tem até 6 Pokémon. Quem fica de fora ainda dá um bônus à equipe.',
    },
    {
        id: 'explore', icon: '🗺️', title: 'Explore uma nova rota',
        text: 'Você já capturou quase tudo desta rota. Abra o “Mapa” e escolha uma rota nova!',
        done: (g) => !!g.gameState.guide.flags.routeChanged,
        cta: { label: 'Abrir Mapa', tab: 'tab-map' },
        reward: 0.6,
        doneText: 'Cada rota tem Pokémon e níveis diferentes. Complete a Pokédex de uma região para desbloquear a próxima!',
    },
];

// 目标（里程碑）。current(game) → 当前进度；达成后自动发奖励（reward 是“占升一级所需经验的比例”）
const GUIDE_GOALS = [
    { id: 'evolve_first', title: 'Evolua um Pokémon', desc: 'Faça um Pokémon evoluir', target: 1, reward: 1, current: (g) => g.guideCounters().evolved ? 1 : 0 },
    { id: 'catch_10', title: 'Capture 10 espécies', desc: 'Tenha 10 espécies na Pokédex', target: 10, reward: 0.6, current: (g) => g.getPokedexStats().caught },
    { id: 'win_50', title: 'Vença 50 batalhas', desc: 'Acumule 50 vitórias', target: 50, reward: 0.6, current: (g) => g.gameState.stats.totalBattles },
    { id: 'level_10', title: 'Treine um Pokémon até o Lv.10', desc: 'Tenha um Pokémon no Lv.10', target: 10, reward: 0.6, current: (g) => g.guideMaxLevel() },
    { id: 'duplicate_2', title: 'Capture a mesma espécie de novo', desc: 'Tenha 2 Pokémon da mesma espécie (cada um com IVs e natureza próprios)', target: 2, reward: 0.8, current: (g) => g.guideMostOfOneSpecies() },
    { id: 'catch_25', title: 'Capture 25 espécies', desc: 'Tenha 25 espécies na Pokédex', target: 25, reward: 0.8, current: (g) => g.getPokedexStats().caught },
    { id: 'party_6', title: 'Complete sua equipe', desc: 'Tenha 6 Pokémon na equipe', target: 6, reward: 0.8, current: (g) => g.gameState.party.length },
    { id: 'level_25', title: 'Treine um Pokémon até o Lv.25', desc: 'Tenha um Pokémon no Lv.25', target: 25, reward: 0.8, current: (g) => g.guideMaxLevel() },
    { id: 'win_200', title: 'Vença 200 batalhas', desc: 'Acumule 200 vitórias', target: 200, reward: 0.8, current: (g) => g.gameState.stats.totalBattles },
    { id: 'shiny_first', title: 'Encontre um Pokémon Shiny', desc: 'Derrote um Pokémon Shiny (chance de cerca de 1 em 4096)', target: 1, reward: 1, current: (g) => Math.min(1, g.getShinyStats()) },
    { id: 'catch_50', title: 'Capture 50 espécies', desc: 'Tenha 50 espécies na Pokédex', target: 50, reward: 1, current: (g) => g.getPokedexStats().caught },
    { id: 'perfect_iv', title: 'Tenha um Pokémon 6V', desc: 'Um Pokémon com os seis IVs em 31', target: 1, reward: 1, current: (g) => g.guideHasPerfectIv() ? 1 : 0 },
    { id: 'level_50', title: 'Treine um Pokémon até o Lv.50', desc: 'Tenha um Pokémon no Lv.50', target: 50, reward: 1, current: (g) => g.guideMaxLevel() },
    { id: 'win_1000', title: 'Vença 1.000 batalhas', desc: 'Acumule 1.000 vitórias', target: 1000, reward: 1, current: (g) => g.gameState.stats.totalBattles },
    { id: 'catch_100', title: 'Capture 100 espécies', desc: 'Tenha 100 espécies na Pokédex', target: 100, reward: 1, current: (g) => g.getPokedexStats().caught },
];

function guideDefaultState(onboarding) {
    return { onboarding, steps: {}, flags: { pcOpened: false, routeChanged: false }, claimed: {}, counters: { evolutions: 0 } };
}

// 读档/导入时的清洗（白名单重建）。raw 可以是任何东西
function sanitizeGuideState(raw) {
    const out = guideDefaultState('active');
    if (!_isObj(raw)) return null;
    out.onboarding = ['active', 'done', 'skipped'].includes(raw.onboarding) ? raw.onboarding : 'active';
    const stepIds = GUIDE_ONBOARDING_STEPS.map(s => s.id);
    if (_isObj(raw.steps)) for (const id of stepIds) if (_has(raw.steps, id)) out.steps[id] = _num(raw.steps[id], 0, 0);
    if (_isObj(raw.flags)) {
        out.flags.pcOpened = raw.flags.pcOpened === true;
        out.flags.routeChanged = raw.flags.routeChanged === true;
    }
    const goalIds = GUIDE_GOALS.map(x => x.id);
    if (_isObj(raw.claimed)) for (const id of goalIds) if (_has(raw.claimed, id)) out.claimed[id] = _num(raw.claimed[id], 0, 0);
    if (_isObj(raw.counters)) out.counters.evolutions = _int(raw.counters.evolutions, 0, 1e9, 0);
    return out;
}

// 以 mixin 的方式给 GameCore 增加引导能力（见文件末尾 installGuidance），这样引导逻辑和战斗核心放在不同文件里。
const GuidanceMethods = {
    // ---------- 状态 ----------
    // 老存档（没有 guide 字段）：有一定进度就视为已经会玩，直接跳过引导；全新存档从第一步开始
    ensureGuide() {
        const gs = this.gameState;
        if (!gs) return null;
        if (!_isObj(gs.guide)) {
            const veteran = (gs.stats && gs.stats.totalBattles >= 20) || this.getPokedexStats().caught > 3 || this.roster.count() > 3;
            gs.guide = guideDefaultState(veteran ? 'done' : 'active');
            // 老存档里已经满足的目标不发奖励（视为已领取），避免读档就弹一堆
            if (veteran) this._guideClaimSilently();
        }
        return gs.guide;
    },

    // 进化过没有：计数器，或者留下的痕迹（图鉴存档 = 最后一只进化走了；origin=evolution 是第 2 阶段的旧规则）
    guideCounters() {
        const g = this.ensureGuide();
        const gs = this.gameState;
        let evolved = g.counters.evolutions > 0 || Object.keys(gs.archivedSpecies || {}).length > 0;
        if (!evolved) evolved = this.roster.all().some(inst => inst.origin === 'evolution');
        return { evolved };
    },

    guideMaxLevel() {
        let max = 0;
        for (const inst of this.roster.all()) if (inst.level > max) max = inst.level;
        return max;
    },

    guideMostOfOneSpecies() {
        const counts = new Map();
        let max = 0;
        for (const inst of this.roster.all()) {
            const n = (counts.get(inst.speciesId) || 0) + 1;
            counts.set(inst.speciesId, n);
            if (n > max) max = n;
        }
        return max;
    },

    guideHasPerfectIv() {
        return this.roster.all().some(inst => isPerfectIvs(inst.ivs));
    },

    _guideClaimSilently() {
        const g = this.gameState.guide;
        const now = this.now();
        for (const goal of GUIDE_GOALS) if (goal.current(this) >= goal.target) g.claimed[goal.id] = now;
    },

    // 玩家做了某件“引导关心”的事（打开 PC / 换了道路）
    guideNote(flag) {
        const g = this.ensureGuide();
        if (!g || !_has(g.flags, flag) || g.flags[flag]) return;
        g.flags[flag] = true;
        if (this.guideAutoUpdate) this.guideUpdate({ force: true });
    },

    guideSkipOnboarding() {
        const g = this.ensureGuide();
        if (g.onboarding !== 'active') return false;
        g.onboarding = 'skipped';
        this._track('onboarding_skip', { step: (this.guideCurrentStep() || {}).id || 'none' });
        this.save();
        return true;
    },

    // 重新打开引导（设置里的“重新查看新手引导”）：只重置引导进度，不动游戏数据
    guideRestartOnboarding() {
        const g = this.ensureGuide();
        g.onboarding = 'active';
        g.steps = {};
        g.flags = { pcOpened: false, routeChanged: false };
        this.save();
    },

    guideCurrentStep() {
        const g = this.ensureGuide();
        if (!g || g.onboarding !== 'active') return null;
        return GUIDE_ONBOARDING_STEPS.find(s => !g.steps[s.id]) || null;
    },

    // 奖励：给出战宝可梦一点经验（上限：升一级所需经验）
    _guideReward(ratio) {
        const inst = this._partyInstance(this.gameState.activePokemonIndex);
        if (!inst || inst.level >= MAX_POKEMON_LEVEL) return 0;
        const data = POKEMON_DATA[inst.speciesId];
        const need = getExpForLevel(data.expGroup, inst.level + 1) - getExpForLevel(data.expGroup, inst.level);
        const amount = Math.max(GUIDE_REWARD_MIN_EXP, Math.floor(need * ratio));
        this.addExpToInstance(inst, amount);
        return amount;
    },

    // 检查并发放：新手引导步骤完成、目标达成。返回本次新完成的列表
    guideUpdate(opts = {}) {
        if (!this.gameState || this._isOfflineSimulating || this._guideBusy) return [];
        const now = this.now();
        if (!opts.force && now - (this._guideLastUpdate || 0) < GUIDE_UPDATE_MIN_INTERVAL_MS) return [];
        this._guideLastUpdate = now;
        const g = this.ensureGuide();
        this._guideBusy = true;
        const done = [];
        try {
            if (g.onboarding === 'active') {
                for (const step of GUIDE_ONBOARDING_STEPS) {
                    if (g.steps[step.id]) continue;
                    if (!step.done(this)) break;           // 一步一步来：当前步没完成，后面的不检查
                    g.steps[step.id] = now;
                    const exp = this._guideReward(step.reward);
                    const last = GUIDE_ONBOARDING_STEPS.every(s => g.steps[s.id]);
                    if (last) g.onboarding = 'done';
                    done.push({ kind: 'step', id: step.id, icon: step.icon, title: step.title, text: step.doneText, exp, last });
                    this._track('onboarding_step', { step: step.id });
                }
            }
            for (const goal of GUIDE_GOALS) {
                if (g.claimed[goal.id]) continue;
                if (g.onboarding === 'active') break;      // 引导期间只专注引导，目标在引导结束后统一结算
                if (goal.current(this) < goal.target) continue;
                g.claimed[goal.id] = now;
                const exp = this._guideReward(goal.reward);
                done.push({ kind: 'goal', id: goal.id, icon: '🏆', title: goal.title, text: goal.desc, exp });
                this._track('goal_complete', { goal: goal.id });
            }
        } finally {
            this._guideBusy = false;
        }
        if (done.length) {
            this.save();
            for (const d of done) if (this.onGuideEvent) this.onGuideEvent(d);
        }
        return done;
    },

    // ---------- 道路进度 ----------
    // 一条道路上：一共几种、已抓到几种、还没抓到的是哪些
    getRouteProgress(route) {
        const seen = new Set();
        const missing = [];
        let caught = 0;
        for (const p of route.pokemon) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            if (this.gameState.pokedex[p.id] === 'caught') caught++;
            else missing.push(p.id);
        }
        return { total: seen.size, caught, missing, newCount: missing.length };
    },

    _guideActiveLevel() {
        const inst = this._partyInstance(this.gameState.activePokemonIndex);
        return inst ? inst.level : 1;
    },

    // 推荐去的下一条道路：已解锁地区里，第一条“有没抓到的宝可梦、等级也打得过”的道路
    getRecommendedRoute() {
        const current = this.gameState.currentRoute;
        const level = this._guideActiveLevel();
        let fallback = null;
        for (const regionId in REGIONS) {
            if (!this.isRegionUnlocked(regionId)) continue;
            for (const route of REGIONS[regionId].routes) {
                if (route.id === current) continue;
                const prog = this.getRouteProgress(route);
                if (prog.newCount === 0) continue;
                const entry = { regionId, route, progress: prog };
                if (route.levelRange[0] <= level * 1.5 + 5) return entry;   // 等级差不多：第一条就是它
                if (!fallback || route.levelRange[0] < fallback.route.levelRange[0]) fallback = entry;
            }
        }
        return fallback;
    },

    // 距离进化最近的队伍成员
    _guideNearestEvolution() {
        let best = null;
        for (let i = 0; i < this.gameState.party.length; i++) {
            const inst = this._partyInstance(i);
            const data = inst && POKEMON_DATA[inst.speciesId];
            if (!data || !data.evolvesTo) continue;
            const evos = Array.isArray(data.evolvesTo) ? data.evolvesTo : [data.evolvesTo];
            const open = evos.filter(e => this._isEvolutionRegionUnlocked(e.id) && POKEMON_DATA[e.id]);
            if (!open.length) continue;
            const evo = open.reduce((a, b) => (a.level <= b.level ? a : b));
            const left = evo.level - inst.level;
            if (left <= 0 || left > GUIDE_EVOLUTION_NEAR_LEVELS) continue;
            if (!best || left < best.left) best = { inst, evo, left, resets: this.gameState.pokedex[evo.id] !== 'caught' };
        }
        return best;
    },

    // 正在追的目标：未达成里完成度最高的（引导期间不显示目标）
    getGoals() {
        const g = this.ensureGuide();
        const list = GUIDE_GOALS.map(goal => {
            const cur = goal.current(this);
            return { id: goal.id, title: goal.title, desc: goal.desc, current: Math.min(cur, goal.target), target: goal.target, done: !!g.claimed[goal.id], ratio: Math.min(1, cur / goal.target) };
        });
        // 地区解锁：下一个还没解锁的地区，进度 = 上一个地区的图鉴
        for (const regionId in REGIONS) {
            if (this.isRegionUnlocked(regionId)) continue;
            const prog = this.getRegionUnlockProgress(regionId);
            list.push({
                id: 'unlock_' + regionId, title: `Desbloqueie ${REGIONS[regionId].name}`, desc: REGIONS[regionId].description,
                current: prog.current, target: prog.total, done: false, ratio: prog.total ? prog.current / prog.total : 0, region: true,
            });
            break;
        }
        return list;
    },

    // 此刻最该做的一件事。返回 { type, icon, title, text, progress?, cta? }
    // cta：{ label, tab? , route? }（界面据此生成按钮）
    getNextAction() {
        const g = this.ensureGuide();
        if (!g) return null;
        const step = this.guideCurrentStep();
        const route = this.getRoute(this.gameState.currentRoute);
        const here = route ? this.getRouteProgress(route) : null;

        if (step) {
            const idx = GUIDE_ONBOARDING_STEPS.indexOf(step);
            const action = {
                type: 'onboarding', id: step.id, icon: step.icon, title: step.title, text: step.text,
                stepNo: idx + 1, stepTotal: GUIDE_ONBOARDING_STEPS.length, progress: step.progress ? step.progress(this) : null,
                cta: step.cta || null, skippable: true,
            };
            // 探索这一步：当前道路确实还有没抓到的，就先别催着换路
            if (step.id === 'explore' && here && here.newCount > 0) {
                action.text = `${ptPlural(here.newCount, 'Falta', 'Faltam')} ${here.newCount} ${ptPlural(here.newCount, 'espécie', 'espécies')} nesta rota, mas você pode abrir o “Mapa” e ver outras rotas.`;
            }
            return action;
        }

        // 当前道路已经抓齐：这是最常见的“卡住”，给一键前往
        if (here && here.total > 0 && here.newCount === 0) {
            const rec = this.getRecommendedRoute();
            if (rec) {
                return {
                    type: 'route', icon: '🗺️', title: 'Esta rota está completa',
                    text: `Vá para ${rec.route.name} (Lv.${rec.route.levelRange[0]}~${rec.route.levelRange[1]}): há ${rec.progress.newCount} ${ptPlural(rec.progress.newCount, 'espécie nova', 'espécies novas')} para capturar.`,
                    cta: { label: 'Ir', route: rec.route.id, tab: 'tab-map' },
                };
            }
        }

        const evo = this._guideNearestEvolution();
        if (evo) {
            const name = POKEMON_DATA[evo.inst.speciesId].name;
            const target = POKEMON_DATA[evo.evo.id].name;
            return {
                type: 'evolution', icon: '🌟', title: `${name} está quase evoluindo`,
                text: evo.resets
                    ? `Faltam ${evo.left} ${ptPlural(evo.left, 'nível', 'níveis')}. A nova forma (${target}) volta para o Lv.1, e ${name} continua na Pokédex.`
                    : `Faltam ${evo.left} ${ptPlural(evo.left, 'nível', 'níveis')} para virar ${target}. O nível se mantém.`,
                progress: { current: evo.inst.level, total: evo.evo.level, label: 'Lv.' },
            };
        }

        const goals = this.getGoals().filter(x => !x.done).sort((a, b) => b.ratio - a.ratio);
        if (goals.length) {
            const goal = goals[0];
            return {
                type: 'goal', icon: '🏆', title: goal.title, text: goal.desc,
                progress: { current: goal.current, total: goal.target }, cta: { label: 'Todas as metas', goals: true },
            };
        }
        return { type: 'idle', icon: '✨', title: 'Continue jogando', text: 'Ainda há mais Pokémon e rotas para descobrir.', cta: { label: 'Todas as metas', goals: true } };
    },
};

// 把引导能力装进 GameCore（game-core.js 之后加载）
function installGuidance(GameCoreClass) {
    for (const key of Object.keys(GuidanceMethods)) GameCoreClass.prototype[key] = GuidanceMethods[key];
}

installGuidance(GameCore);
