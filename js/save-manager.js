// ============================================================
// 存档管理 - 版本号、迁移、校验/清洗、备份轮转、防抖写入
//
// 设计要点：
//   - 存档格式保持兼容：localStorage 中仍是 "LZ:" + LZString(JSON) 或纯 JSON；
//     导出文本仍是 Base64(UTF-8(payload))，旧版本导出的文本可直接导入。
//   - 任何来源（本地存档、备份、导入）都走同一条流水线：
//       解码 → 基本结构检查 → 版本迁移 → 白名单清洗（sanitizeSave）。
//     清洗会重建整个对象，只保留已知字段并强制类型，因此存档里的字符串
//     不可能把 HTML/JS 带进界面（宝石名称/颜色等展示字段一律由配置重建）。
//   - 依赖的全局：POKEMON_DATA / REGIONS / 各类 *_DATA 配置 / LZString(可选)。
// ============================================================

// ===================== 编解码 =====================
const SaveCodec = {
    // 压缩（仅当确实变小时），带 "LZ:" 前缀
    encodePayload(json) {
        if (typeof LZString !== 'undefined') {
            const compressed = LZString.compressToUTF16(json);
            if (compressed.length < json.length) return 'LZ:' + compressed;
        }
        return json;
    },

    // 还原 payload → 对象。失败时抛出带 code 的 Error
    decodePayload(raw) {
        if (typeof raw !== 'string' || raw.length === 0) throw SaveCodec._err('empty', '存档为空');
        let json = raw;
        if (raw.startsWith('LZ:')) {
            if (typeof LZString === 'undefined') throw SaveCodec._err('no_lz', 'LZString 库未加载，无法读取压缩存档');
            json = LZString.decompressFromUTF16(raw.slice(3));
            if (!json) throw SaveCodec._err('decompress', '存档解压失败，数据可能已损坏');
        }
        try {
            return JSON.parse(json);
        } catch (e) {
            throw SaveCodec._err('parse', '存档不是有效的 JSON');
        }
    },

    // 导出文本：Base64(UTF-8(payload))，与旧版格式一致
    encodeExport(state) {
        const payload = SaveCodec.encodePayload(JSON.stringify(state));
        const bytes = new TextEncoder().encode(payload);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
    },

    // 导入文本：兼容 Base64 / 直接粘贴的 LZ: payload / 纯 JSON
    decodeExport(text) {
        if (typeof text !== 'string') throw SaveCodec._err('empty', '存档为空');
        const trimmed = text.trim();
        if (!trimmed) throw SaveCodec._err('empty', '存档为空');
        if (trimmed.length > SAVE_IMPORT_MAX_CHARS) throw SaveCodec._err('too_large', '存档文本过大');
        if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('LZ:')) {
            return SaveCodec.decodePayload(trimmed);
        }
        let bin;
        try {
            bin = atob(trimmed.replace(/\s+/g, ''));
        } catch (e) {
            throw SaveCodec._err('base64', '存档格式无法识别（不是有效的 Base64）');
        }
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        let payload;
        try {
            payload = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (e) {
            payload = bin; // 极老的导出可能不是 UTF-8，退回按原始字符处理
        }
        return SaveCodec.decodePayload(payload);
    },

    _err(code, message) {
        const e = new Error(message);
        e.code = code;
        return e;
    },
};

// ===================== 版本迁移 =====================
// 每个函数把 vN 的数据升级为 vN+1（原地修改并返回）。新增版本时：
//   1. 递增 game-config.js 中的 SAVE_SCHEMA_VERSION；
//   2. 在此处添加 [旧版本号]: (data) => { ...; return data; }；
//   3. 在 sanitizeSave 中补充新字段，并在 tests/save.test.js 增加对应用例。
const SAVE_MIGRATIONS = {
    // v1（无 schemaVersion 的历史存档）→ v2
    1: (data) => {
        // 挑战塔：更老的存档把敌人对象数组存进来，现在只存 id
        if (_isObj(data.tower)) {
            if (Array.isArray(data.tower.enemies)) {
                data.tower.enemies = data.tower.enemies.map(e => (e && typeof e === 'object') ? e.id : e);
            }
            // 战斗中的挑战塔状态不跨会话保留
            data.tower.inBattle = false;
        }
        return data;
    },
};

function migrateSave(data) {
    const detected = Number.isInteger(data.schemaVersion) && data.schemaVersion >= 1 ? data.schemaVersion : 1;
    if (detected > SAVE_SCHEMA_VERSION) {
        const e = new Error(`存档来自更新版本 (v${detected})，当前游戏仅支持到 v${SAVE_SCHEMA_VERSION}`);
        e.code = 'newer_version';
        throw e;
    }
    let version = detected;
    while (version < SAVE_SCHEMA_VERSION) {
        const step = SAVE_MIGRATIONS[version];
        if (typeof step !== 'function') {
            const e = new Error(`缺少 v${version} → v${version + 1} 的迁移`);
            e.code = 'no_migration';
            throw e;
        }
        data = step(data) || data;
        version++;
        data.schemaVersion = version;
    }
    return { data, fromVersion: detected, toVersion: version };
}

// ===================== 清洗 / 校验 =====================
const SAVE_THEMES = ['midnight', 'forest', 'sakura', 'ocean', 'sunset', 'purple'];
const SAVE_ONESHOT_STRATEGIES = ['fastest', 'lowest_level', 'no_change'];
const SAVE_ROUTE_CONDITIONS = ['6v_shiny', '6v_only'];
const SAVE_IV_KEYS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
const SAVE_MAX_ENEMY_LEVEL = 1000000;

function _isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function _has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
function _int(v, min, max, def) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.floor(n)));
}
function _num(v, min, def) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return def;
    return Math.max(min, n);
}
function _validPokemonId(id) {
    const n = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
    return Number.isInteger(n) && _has(POKEMON_DATA, n) ? n : null;
}
function _findRoute(routeId) {
    if (typeof routeId !== 'string') return null;
    for (const regionKey in REGIONS) {
        for (const route of REGIONS[regionKey].routes) {
            if (route.id === routeId) return { regionKey, route };
        }
    }
    return null;
}

function _sanitizeIvs(raw) {
    const out = {};
    const src = _isObj(raw) ? raw : {};
    for (const k of SAVE_IV_KEYS) out[k] = _int(src[k], 0, 31, 0);
    return out;
}

let _sanitizeUidCounter = 0;
function _makeUid() {
    return 'r' + Date.now().toString(36) + '_' + (++_sanitizeUidCounter).toString(36);
}

// 宝石：所有展示字段（名称/颜色/图标/单位）都由配置重建，只信任 id 与数值
function _sanitizeGem(raw, usedUids) {
    if (!_isObj(raw)) return null;
    const quality = GEM_QUALITIES.find(q => q.id === raw.quality);
    if (!quality) return null;
    const attrs = [];
    if (Array.isArray(raw.attrs)) {
        for (const a of raw.attrs.slice(0, 16)) {
            if (!_isObj(a)) continue;
            const tpl = GEM_ATTRIBUTES.find(t => t.id === a.id);
            if (!tpl) continue;
            const value = _num(a.value, 0, tpl.min);
            attrs.push({
                id: tpl.id,
                name: tpl.name,
                value: Math.min(tpl.max, Math.max(tpl.min, value)),
                unit: tpl.unit,
                icon: tpl.icon,
            });
        }
    }
    if (attrs.length === 0) return null;
    let uid = typeof raw.uid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.uid) ? raw.uid : null;
    if (!uid || usedUids.has(uid)) uid = _makeUid();
    usedUids.add(uid);
    const gem = {
        uid,
        quality: quality.id,
        qualityName: quality.name,
        qualityColor: quality.color,
        attrs,
        locked: raw.locked === true,
    };
    if (raw.isNew === true) gem.isNew = true;
    return gem;
}

// 返回 { ok, state, errors, warnings }
function sanitizeSave(raw, now = Date.now()) {
    const errors = [];
    const warnings = [];
    const dropped = { pokemon: 0, gems: 0, other: 0 };

    if (!_isObj(raw)) return { ok: false, state: null, errors: ['存档不是对象'], warnings };
    if (!Array.isArray(raw.team) || raw.team.length === 0) {
        return { ok: false, state: null, errors: ['存档缺少队伍数据'], warnings };
    }

    const out = {};
    out.schemaVersion = SAVE_SCHEMA_VERSION;

    // ---- caughtPokemon ----
    out.caughtPokemon = {};
    const srcCaught = _isObj(raw.caughtPokemon) ? raw.caughtPokemon : {};
    for (const key of Object.keys(srcCaught)) {
        const id = _validPokemonId(key);
        const e = srcCaught[key];
        if (id === null || !_isObj(e)) { dropped.pokemon++; continue; }
        const data = POKEMON_DATA[id];
        const level = _int(e.level, 1, MAX_POKEMON_LEVEL, 1);
        out.caughtPokemon[id] = {
            ivs: _sanitizeIvs(e.ivs),
            level,
            // 注意：新开局的 Lv5 皮卡丘 exp=0 是合法状态（exp 可以低于该等级的起点），不能强行抬高
            exp: _num(e.exp, 0, getExpForLevel(data.expGroup, level)),
            skillLevel: _int(e.skillLevel, 0, MAX_SKILL_LEVEL, 0),
        };
    }

    // ---- pokedex（与 caughtPokemon 保持一致）----
    out.pokedex = {};
    const srcDex = _isObj(raw.pokedex) ? raw.pokedex : {};
    for (const key of Object.keys(srcDex)) {
        const id = _validPokemonId(key);
        if (id === null) { dropped.other++; continue; }
        const state = srcDex[key];
        if (state === 'caught') {
            // 没有对应数据的“已捕获”降级为“已见过”，避免队伍/战斗拿到空数据
            out.pokedex[id] = out.caughtPokemon[id] ? 'caught' : 'seen';
        } else if (state === 'seen') {
            out.pokedex[id] = 'seen';
        }
    }
    for (const id in out.caughtPokemon) out.pokedex[id] = 'caught';

    // ---- shiny ----
    out.shinyDex = {};
    if (_isObj(raw.shinyDex)) {
        for (const key of Object.keys(raw.shinyDex)) {
            const id = _validPokemonId(key);
            if (id !== null && raw.shinyDex[key]) out.shinyDex[id] = true;
        }
    }
    out.pokedexDisplay = {};
    if (_isObj(raw.pokedexDisplay)) {
        for (const key of Object.keys(raw.pokedexDisplay)) {
            const id = _validPokemonId(key);
            if (id !== null && raw.pokedexDisplay[key] === 'shiny') out.pokedexDisplay[id] = 'shiny';
        }
    }

    // ---- 队伍 ----
    const team = [];
    for (const v of raw.team.slice(0, 100)) {
        const id = _validPokemonId(v);
        if (id !== null && out.caughtPokemon[id] && !team.includes(id)) team.push(id);
        if (team.length >= 6) break;
    }
    if (team.length === 0) {
        return { ok: false, state: null, errors: ['队伍中没有有效的已捕获宝可梦'], warnings };
    }
    out.team = team;
    out.activePokemonIndex = _int(raw.activePokemonIndex, 0, team.length - 1, 0);

    // ---- 地区/路线 ----
    let found = _findRoute(raw.currentRoute);
    if (!found) {
        warnings.push('当前路线无效，已重置为 1 号道路');
        found = _findRoute('kanto_route1');
    }
    out.currentRoute = found.route.id;
    out.currentRegion = _has(REGIONS, raw.currentRegion) ? raw.currentRegion : found.regionKey;

    // ---- 数值 ----
    out.gold = _num(raw.gold, 0, 0);
    const st = _isObj(raw.stats) ? raw.stats : {};
    out.stats = {
        totalBattles: _num(st.totalBattles, 0, 0),
        totalCatches: _num(st.totalCatches, 0, 0),
        totalExp: _num(st.totalExp, 0, 0),
        totalGold: _num(st.totalGold, 0, 0),
        playTime: _num(st.playTime, 0, 0),
    };

    // ---- 设置 ----
    const se = _isObj(raw.settings) ? raw.settings : {};
    out.settings = {};
    if (typeof se.autoSwitchBest === 'boolean') out.settings.autoSwitchBest = se.autoSwitchBest;
    if (SAVE_ONESHOT_STRATEGIES.includes(se.oneShotStrategy)) out.settings.oneShotStrategy = se.oneShotStrategy;
    if (typeof se.autoRouteSwitch === 'boolean') out.settings.autoRouteSwitch = se.autoRouteSwitch;
    if (SAVE_ROUTE_CONDITIONS.includes(se.routeSwitchCondition)) out.settings.routeSwitchCondition = se.routeSwitchCondition;
    if (SAVE_THEMES.includes(se.theme)) out.settings.theme = se.theme;

    // ---- 徽章与宝石 ----
    const usedUids = new Set();
    out.gems = [];
    if (Array.isArray(raw.gems)) {
        for (const g of raw.gems.slice(0, 1000)) {
            const gem = _sanitizeGem(g, usedUids);
            if (gem) out.gems.push(gem); else dropped.gems++;
        }
    }
    out.badges = {};
    if (_isObj(raw.badges)) {
        for (const regionId of Object.keys(raw.badges)) {
            const b = raw.badges[regionId];
            if (!_has(BADGE_DATA, regionId) || !_isObj(b) || !b.unlocked) continue;
            out.badges[regionId] = { unlocked: true, gem: _sanitizeGem(b.gem, usedUids) };
        }
    }

    // ---- 树果 ----
    out.berryPlots = [];
    if (Array.isArray(raw.berryPlots)) {
        for (const p of raw.berryPlots.slice(0, BERRY_PLOT_MAX)) {
            if (_isObj(p) && _has(BERRY_DATA, p.berryId)) {
                out.berryPlots.push({ berryId: p.berryId, plantedAt: _num(p.plantedAt, 0, now) });
            }
        }
    }
    out.berryBag = {};
    if (_isObj(raw.berryBag)) {
        for (const berryId of Object.keys(raw.berryBag)) {
            const n = _int(raw.berryBag[berryId], 0, Number.MAX_SAFE_INTEGER, 0);
            if (_has(BERRY_DATA, berryId) && n > 0) out.berryBag[berryId] = n;
        }
    }
    out.berryFed = {};
    if (_isObj(raw.berryFed)) {
        for (const key of Object.keys(raw.berryFed)) {
            const id = _validPokemonId(key);
            const fedRaw = raw.berryFed[key];
            if (id === null || !_isObj(fedRaw)) continue;
            const fed = {};
            for (const berryId of Object.keys(fedRaw)) {
                const n = _int(fedRaw[berryId], 0, 1000, 0);
                if (_has(BERRY_DATA, berryId) && n > 0) fed[berryId] = n;
            }
            out.berryFed[id] = fed;
        }
    }

    // ---- 天赋 ----
    out.talents = {};
    if (_isObj(raw.talents)) {
        for (const tid of Object.keys(raw.talents)) {
            if (tid === 'gemAttrChoice') {
                if (GEM_ATTRIBUTES.some(a => a.id === raw.talents[tid])) out.talents.gemAttrChoice = raw.talents[tid];
            } else if (_has(TALENT_DATA, tid)) {
                const lv = _int(raw.talents[tid], 0, TALENT_DATA[tid].maxLevel, 0);
                if (lv > 0) out.talents[tid] = lv;
            }
        }
    }

    // ---- 挑战塔 ----
    const tw = _isObj(raw.tower) ? raw.tower : {};
    let enemies = null;
    if (Array.isArray(tw.enemies)) {
        enemies = tw.enemies.map(e => _validPokemonId(_isObj(e) ? e.id : e)).filter(id => id !== null).slice(0, TOWER_ENEMIES_PER_FLOOR);
        if (enemies.length !== TOWER_ENEMIES_PER_FLOOR) enemies = null; // 不完整就让游戏重新生成
    }
    out.tower = {
        currentFloor: _int(tw.currentFloor, 1, TOWER_MAX_FLOOR, 1),
        highestFloor: _int(tw.highestFloor, 0, TOWER_MAX_FLOOR, 0),
        enemies,
        currentEnemyIndex: enemies ? _int(tw.currentEnemyIndex, 0, TOWER_ENEMIES_PER_FLOOR - 1, 0) : 0,
        inBattle: false,
    };

    // ---- 当前敌人 / 战斗血量（可丢弃）----
    out.currentEnemy = null;
    if (_isObj(raw.currentEnemy)) {
        const id = _validPokemonId(raw.currentEnemy.id);
        if (id !== null) {
            const level = _int(raw.currentEnemy.level, 1, SAVE_MAX_ENEMY_LEVEL, 1);
            out.currentEnemy = {
                uid: typeof raw.currentEnemy.uid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.currentEnemy.uid)
                    ? raw.currentEnemy.uid : _makeUid(),
                id,
                name: POKEMON_DATA[id].name,
                level,
                exp: getExpForLevel(POKEMON_DATA[id].expGroup, level),
                ivs: _sanitizeIvs(raw.currentEnemy.ivs),
                isShiny: raw.currentEnemy.isShiny === true,
                isWild: true,
                currentHp: _num(raw.currentEnemy.currentHp, 0, 0),
            };
        }
    }
    if (_isObj(raw.battleHp)) {
        const b = raw.battleHp;
        out.battleHp = {
            playerHp: _num(b.playerHp, 0, 0),
            playerMaxHp: _num(b.playerMaxHp, 0, 0),
            enemyHp: _num(b.enemyHp, 0, 0),
            playerTimer: _num(b.playerTimer, 0, 0),
            enemyTimer: _num(b.enemyTimer, 0, 0),
        };
    }

    // ---- 时间戳：不允许来自未来（修改系统时间刷离线收益）----
    let lastSave = _num(raw.lastSave, 0, now);
    if (lastSave > now) {
        warnings.push('存档时间晚于当前时间，已修正');
        lastSave = now;
    }
    out.lastSave = lastSave;

    if (dropped.pokemon) warnings.push(`已忽略 ${dropped.pokemon} 条无效的宝可梦记录`);
    if (dropped.gems) warnings.push(`已忽略 ${dropped.gems} 个无效的宝石`);
    return { ok: true, state: out, errors, warnings };
}

// 完整流水线：已解码的对象 → { ok, state, fromVersion, warnings, error, code }
function processSaveObject(obj, now = Date.now()) {
    if (!_isObj(obj)) return { ok: false, error: '存档不是对象', code: 'shape' };
    if (!Array.isArray(obj.team) || obj.team.length === 0) {
        return { ok: false, error: '存档缺少队伍数据', code: 'shape' };
    }
    let migrated;
    try {
        migrated = migrateSave(obj);
    } catch (e) {
        return { ok: false, error: e.message, code: e.code || 'migrate' };
    }
    const result = sanitizeSave(migrated.data, now);
    if (!result.ok) return { ok: false, error: result.errors.join('；'), code: 'invalid' };
    return {
        ok: true,
        state: result.state,
        fromVersion: migrated.fromVersion,
        warnings: result.warnings,
    };
}

// ===================== 存储层 =====================
const SAVE_BACKUP_KEYS = Array.from({ length: SAVE_BACKUP_COUNT }, (_, i) => `${SAVE_KEY}_bak${i + 1}`);
const SAVE_META_KEY = `${SAVE_KEY}_meta`;
const SAVE_CORRUPT_KEY = `${SAVE_KEY}_corrupt`;
const SAVE_PREMIGRATION_PREFIX = `${SAVE_KEY}_premigration_v`;

class SaveManager {
    // 某些浏览器在禁用 Cookie/隐私模式下，仅访问 localStorage 属性就会抛 SecurityError
    static defaultStorage() {
        try {
            return typeof localStorage !== 'undefined' ? localStorage : null;
        } catch (e) {
            return null;
        }
    }

    // opts: { storage, now, setTimer, clearTimer, getState, onError, onRecover, onConflict, win }
    constructor(opts = {}) {
        this.storage = 'storage' in opts ? opts.storage : SaveManager.defaultStorage();
        this.now = opts.now || (() => Date.now());
        this.setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
        this.clearTimer = opts.clearTimer || ((id) => clearTimeout(id));
        this.getState = opts.getState || (() => null);
        this.onError = opts.onError || (() => {});
        this.onRecover = opts.onRecover || (() => {});
        this.onConflict = opts.onConflict || (() => {});

        this._timer = null;
        this._dirty = false;
        this._firstRequestAt = null;
        this._failing = false;
        this.paused = false;        // 检测到其他标签页写入后暂停
        this.lastError = null;
        this.stats = { writes: 0, skipped: 0, backups: 0 };

        if (opts.win && typeof opts.win.addEventListener === 'function') {
            opts.win.addEventListener('storage', (e) => {
                if (e.key === SAVE_KEY || e.key === null) this._handleExternalWrite();
            });
        }
    }

    _handleExternalWrite() {
        if (this.paused) return;
        this.paused = true;
        if (this._timer) { this.clearTimer(this._timer); this._timer = null; }
        this.onConflict();
    }

    // 用户确认“接管”：恢复写入并立刻保存本页状态
    takeOver() {
        this.paused = false;
        return this.flush(true);
    }

    // ---------- 读取 ----------
    _readRaw(key) {
        try { return this.storage.getItem(key); } catch (e) { return null; }
    }

    _tryParse(raw) {
        try {
            return processSaveObject(SaveCodec.decodePayload(raw), this.now());
        } catch (e) {
            return { ok: false, error: e.message, code: e.code || 'decode' };
        }
    }

    // 返回 { ok, state?, source, warnings, fromVersion, recovered, failures, empty, error }
    load() {
        if (!this.storage) return { ok: false, empty: true, error: '存储不可用', failures: [] };
        const sources = [{ name: 'main', key: SAVE_KEY }]
            .concat(SAVE_BACKUP_KEYS.map((key, i) => ({ name: `backup${i + 1}`, key })));
        const failures = [];
        let anyRaw = false;
        const mainRaw = this._readRaw(SAVE_KEY);

        for (const src of sources) {
            const raw = src.key === SAVE_KEY ? mainRaw : this._readRaw(src.key);
            if (!raw) continue;
            anyRaw = true;
            const r = this._tryParse(raw);
            if (r.ok) {
                const recovered = src.name !== 'main';
                if (recovered && mainRaw) this._preserveCorrupt(mainRaw);
                if (r.fromVersion < SAVE_SCHEMA_VERSION) this._savePremigration(r.fromVersion, raw);
                return {
                    ok: true,
                    state: r.state,
                    source: src.name,
                    recovered,
                    warnings: r.warnings,
                    fromVersion: r.fromVersion,
                    failures,
                };
            }
            failures.push({ source: src.name, error: r.error, code: r.code });
        }
        if (!anyRaw) return { ok: false, empty: true, failures };
        if (mainRaw) this._preserveCorrupt(mainRaw);
        return { ok: false, empty: false, failures, error: failures.map(f => `${f.source}: ${f.error}`).join('；') };
    }

    // 导入文本（不触碰存储）
    parseImport(text) {
        try {
            const obj = SaveCodec.decodeExport(text);
            const r = processSaveObject(obj, this.now());
            return r.ok ? r : { ok: false, error: r.error, code: r.code };
        } catch (e) {
            return { ok: false, error: e.message, code: e.code || 'decode' };
        }
    }

    exportText(state) {
        return SaveCodec.encodeExport(state);
    }

    // ---------- 写入 ----------
    _freeSpace() {
        // 依次牺牲：损坏副本 → 迁移前副本 → 最旧备份
        const victims = [SAVE_CORRUPT_KEY];
        for (let v = 1; v < SAVE_SCHEMA_VERSION; v++) victims.push(SAVE_PREMIGRATION_PREFIX + v);
        for (let i = SAVE_BACKUP_KEYS.length - 1; i >= 0; i--) victims.push(SAVE_BACKUP_KEYS[i]);
        for (const key of victims) {
            if (this._readRaw(key) !== null) {
                try { this.storage.removeItem(key); return true; } catch (e) { /* ignore */ }
            }
        }
        return false;
    }

    _readMeta() {
        try { return JSON.parse(this._readRaw(SAVE_META_KEY)) || {}; } catch (e) { return {}; }
    }

    _looksValid(raw) {
        const r = this._tryParse(raw);
        return r.ok;
    }

    // 把当前主存档轮转进备份。force=true 忽略时间间隔
    backupNow(force = true) {
        const prev = this._readRaw(SAVE_KEY);
        if (!prev) return false;
        const now = this.now();
        if (!force) {
            const meta = this._readMeta();
            if (meta.lastBackupAt && now - meta.lastBackupAt < SAVE_BACKUP_INTERVAL_MS) return false;
        }
        if (!this._looksValid(prev)) return false; // 不让损坏的存档挤掉好备份
        try {
            for (let i = SAVE_BACKUP_KEYS.length - 1; i >= 1; i--) {
                const older = this._readRaw(SAVE_BACKUP_KEYS[i - 1]);
                if (older !== null) this.storage.setItem(SAVE_BACKUP_KEYS[i], older);
            }
            this.storage.setItem(SAVE_BACKUP_KEYS[0], prev);
            this.storage.setItem(SAVE_META_KEY, JSON.stringify({ lastBackupAt: now }));
            this.stats.backups++;
            return true;
        } catch (e) {
            return false; // 备份失败不阻止主存档写入
        }
    }

    _preserveCorrupt(raw) {
        try {
            if (this._readRaw(SAVE_CORRUPT_KEY) !== raw) this.storage.setItem(SAVE_CORRUPT_KEY, raw);
        } catch (e) { /* 空间不足时放弃 */ }
    }

    _savePremigration(fromVersion, raw) {
        const key = SAVE_PREMIGRATION_PREFIX + fromVersion;
        try {
            if (this._readRaw(key) === null) this.storage.setItem(key, raw);
        } catch (e) { /* ignore */ }
    }

    // 立即写入。返回 { ok, error?, code? }
    write(state) {
        if (!this.storage) return this._fail('storage_unavailable', '浏览器存储不可用（可能处于隐私模式）');
        let payload;
        try {
            payload = SaveCodec.encodePayload(JSON.stringify(state));
        } catch (e) {
            return this._fail('serialize', '存档序列化失败：' + e.message);
        }

        this.backupNow(false);

        let lastErr = null;
        for (let attempt = 0; attempt < 6; attempt++) {
            try {
                this.storage.setItem(SAVE_KEY, payload);
                lastErr = null;
                break;
            } catch (e) {
                lastErr = e;
                if (!this._freeSpace()) break; // 已无可释放的内容
            }
        }
        if (lastErr) {
            const quota = lastErr && (lastErr.name === 'QuotaExceededError' || lastErr.code === 22 || lastErr.code === 1014);
            return this._fail(quota ? 'quota' : 'write',
                quota ? '浏览器存储空间已满，存档未能保存！请立即导出存档文件备份' : '存档写入失败：' + lastErr.message);
        }
        this.stats.writes++;
        if (this._failing) {
            this._failing = false;
            this.lastError = null;
            this.onRecover();
        }
        return { ok: true, size: payload.length };
    }

    _fail(code, message) {
        this._failing = true;
        this.lastError = { code, message };
        this.onError(this.lastError);
        return { ok: false, code, error: message };
    }

    // ---------- 防抖 ----------
    request() {
        if (this.paused) return;
        this._dirty = true;
        const now = this.now();
        if (this._firstRequestAt === null) this._firstRequestAt = now;
        if (this._timer) this.clearTimer(this._timer);
        const remaining = this._firstRequestAt + SAVE_MAX_WAIT_MS - now;
        const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, remaining));
        this._timer = this.setTimer(() => { this._timer = null; this.flush(); }, delay);
    }

    hasPending() {
        return this._dirty;
    }

    // force=true：即使没有挂起请求也写入（手动保存、导出、退出）
    flush(force = false) {
        if (this._timer) { this.clearTimer(this._timer); this._timer = null; }
        if (this.paused) return { ok: false, code: 'paused', error: '其他标签页正在使用存档' };
        if (!this._dirty && !force) { this.stats.skipped++; return { ok: true, skipped: true }; }
        this._firstRequestAt = null;
        let state;
        try { state = this.getState(); } catch (e) { return this._fail('serialize', e.message); }
        if (!state) return { ok: false, code: 'no_state', error: '没有可保存的状态' };
        const r = this.write(state);
        this._dirty = !r.ok; // 失败则保持脏标记，下次自动保存重试
        return r;
    }

    cancelPending() {
        if (this._timer) { this.clearTimer(this._timer); this._timer = null; }
        this._dirty = false;
        this._firstRequestAt = null;
    }

    // 删除所有存档相关数据
    deleteAll() {
        this.cancelPending();
        const keys = [SAVE_KEY, SAVE_META_KEY, SAVE_CORRUPT_KEY, ...SAVE_BACKUP_KEYS];
        for (let v = 1; v <= SAVE_SCHEMA_VERSION; v++) keys.push(SAVE_PREMIGRATION_PREFIX + v);
        for (const key of keys) {
            try { this.storage.removeItem(key); } catch (e) { /* ignore */ }
        }
    }
}
