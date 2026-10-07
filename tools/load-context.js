'use strict';
// ============================================================
// 把浏览器里的全局脚本（无模块系统）加载进一个独立的 vm 上下文，
// 供数据校验和单元测试使用。不依赖任何第三方包。
// ============================================================
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DATA_FILES = ['js/pokemon-data.js', 'js/route-data.js', 'js/game-config.js'];
const GAME_FILES = [
    'js/lzstring.min.js', 'js/util.js', 'js/pokemon-data.js', 'js/route-data.js',
    'js/game-config.js', 'js/analytics.js', 'js/pokemon-instance.js', 'js/species-traits.js', 'js/party.js', 'js/pc.js',
    'js/pokemon-validation.js', 'js/pokemon-migration.js', 'js/pokemon-roster.js',
    'js/save-manager.js', 'js/game-core.js',
];

// 内存版 localStorage，可模拟容量上限与异常
function createMemoryStorage(initial = {}, opts = {}) {
    const map = new Map(Object.entries(initial));
    const api = {
        quotaChars: opts.quotaChars ?? Infinity, // 所有 key+value 字符数上限
        failReads: false,
        failWrites: false,
        writes: [],                              // 记录每次 setItem 的 key（用于断言写入次数）
        get length() { return map.size; },
        key(i) { return Array.from(map.keys())[i] ?? null; },
        getItem(k) {
            if (api.failReads) throw new Error('SecurityError: storage disabled');
            return map.has(k) ? map.get(k) : null;
        },
        setItem(k, v) {
            if (api.failWrites) throw new Error('SecurityError: storage disabled');
            v = String(v);
            let used = 0;
            for (const [key, val] of map) if (key !== k) used += key.length + val.length;
            if (used + k.length + v.length > api.quotaChars) {
                const e = new Error('The quota has been exceeded.');
                e.name = 'QuotaExceededError';
                e.code = 22;
                throw e;
            }
            map.set(k, v);
            api.writes.push(k);
        },
        removeItem(k) { map.delete(k); },
        clear() { map.clear(); },
        keys() { return Array.from(map.keys()); },
        _map: map,
    };
    return api;
}

function makeSandbox(storage) {
    const listeners = {};
    const unref = (h) => { if (h && typeof h.unref === 'function') h.unref(); return h; };
    const sandbox = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        // setTimeout 保持“有引用”：离线结算用 setTimeout(0) 分批，必须让事件循环等它；
        // setInterval（战斗循环/自动保存）则 unref，避免测试进程被常驻定时器卡住。
        setTimeout: (fn, ms, ...a) => setTimeout(fn, ms, ...a),
        setInterval: (fn, ms, ...a) => unref(setInterval(fn, ms, ...a)),
        clearTimeout, clearInterval,
        Date, Math, JSON, Object, Array, Map, Set, Number, String, Promise, Error,
        Uint8Array, TextEncoder, TextDecoder, atob, btoa, parseInt, parseFloat, isFinite,
        localStorage: storage,
        document: {
            visibilityState: 'visible',
            addEventListener(type, fn) { (listeners['document:' + type] ||= []).push(fn); },
        },
        window: {
            addEventListener(type, fn) { (listeners['window:' + type] ||= []).push(fn); },
        },
        __listeners: listeners,
    };
    return sandbox;
}

function readFiles(files) {
    return files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
}

// 只加载数据文件（校验器使用）
function loadData() {
    const sandbox = makeSandbox(createMemoryStorage());
    const code = readFiles(DATA_FILES) + `
;({ POKEMON_DATA, REGIONS, EXP_GROUPS, TYPE_CHART, TYPE_NAMES, getExpForLevel,
    BADGE_DATA, GEM_QUALITIES, GEM_ATTRIBUTES, BERRY_DATA, SKILL_DATA, TALENT_DATA,
    MAX_SKILL_LEVEL, REGION_POKEDEX_RANGES })`;
    return vm.runInContext(code, vm.createContext(sandbox), { filename: 'game-data' });
}

// 加载完整游戏逻辑（不含 UI）
function loadGameContext(opts = {}) {
    const storage = opts.storage || createMemoryStorage();
    const sandbox = makeSandbox(storage);
    const code = readFiles(GAME_FILES) + `
;({
  GameCore, SaveManager, SaveCodec, sanitizeSave, processSaveObject, migrateSave, SAVE_MIGRATIONS,
  escapeHtml, safeCssColor,
  PokemonRoster, PartyManager, PCStorage, PARTY_MAX, PC_BOX_CAPACITY, PC_MAX_BOXES, PC_BOX_NAME_MAX, RELEASED_LOG_MAX,
  POKEMON_NATURES, DEFAULT_NATURE, POKEMON_GENDERS, POKEMON_ORIGINS, NICKNAME_MAX_LENGTH, IV_KEYS,
  createPokemonInstance, buildInstance, sanitizeInstance, sanitizeRosterSection, validateRosterIntegrity,
  migrateLegacyToInstances, sanitizeNickname, sanitizeBoxName, toCaptureDate, getInstanceDisplayName,
  uidSequence, generateIvs, ivTotal, isPerfectIvs,
  ABILITY_SLOTS, HIDDEN_ABILITY_RATE, GENDER_OVERRIDES, getGenderRule, rollNature, rollGender, rollAbilitySlot, rollTraits,
  POKEMON_DATA, REGIONS, BADGE_DATA, GEM_QUALITIES, GEM_ATTRIBUTES, BERRY_DATA, TALENT_DATA, SKILL_DATA,
  EXP_GROUPS, getExpForLevel, getBestTypeEffectiveness, REGION_POKEDEX_RANGES, LZString,
  SAVE_KEY, SAVE_SCHEMA_VERSION, SAVE_BACKUP_KEYS, SAVE_CORRUPT_KEY, SAVE_META_KEY, SAVE_PREMIGRATION_PREFIX,
  SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS, SAVE_BACKUP_INTERVAL_MS, SAVE_BACKUP_COUNT, SAVE_IMPORT_MAX_CHARS,
  BASE_CRIT_RATE, BASE_CRIT_MULTIPLIER, BASE_SHINY_RATE, DEFEAT_HEAL_MS, MAX_OFFLINE_TIME,
  Analytics, ANALYTICS_STORAGE_KEY, ANALYTICS_QUEUE_MAX, ANALYTICS_EVENT_NAMES, ANALYTICS_SESSION_GAP_MS,
  CAPTURE_DUPLICATE_POLICIES, DEFAULT_CAPTURE_DUPLICATE_POLICY, DUPLICATE_CAPTURE_RATE, DUPLICATE_SPECIES_CAP,
  MAX_POKEMON_LEVEL, MAX_SKILL_LEVEL, TOWER_MAX_FLOOR, GEM_BAG_MAX, BERRY_STAT_CAP
})`;
    const ctx = vm.runInContext(code, vm.createContext(sandbox), { filename: 'game' });
    ctx.storage = storage;
    ctx.sandbox = sandbox;
    return ctx;
}

module.exports = { ROOT, createMemoryStorage, makeSandbox, loadData, loadGameContext };
