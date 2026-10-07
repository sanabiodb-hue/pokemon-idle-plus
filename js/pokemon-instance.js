// ============================================================
// 宝可梦个体（Instance）- 玩家拥有的每一只“真实个体”
//
// 与旧结构的区别：
//   旧：caughtPokemon[物种ID] = { ivs, level, exp, skillLevel }   （每个物种只有一条记录）
//   新：ownedPokemon[uid]     = 个体对象                          （同一物种可以有多只）
//
// 本文件只包含纯函数与常量（无 DOM、无游戏状态依赖），所以可以在 Node 中直接测试。
// 个体对象的唯一规范形状由 buildInstance() 产生；创建、迁移、读档清洗都走它，
// 保证“内存里的对象”与“读档重建的对象”逐字段一致。
//
// 依赖的全局：POKEMON_DATA / getExpForLevel（pokemon-data.js）、MAX_POKEMON_LEVEL / MAX_SKILL_LEVEL（game-config.js）
// ============================================================

// ===================== 常量 =====================
const IV_KEYS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];

// 25 种性格。plus/minus 为将来“性格效果”预留（当前不参与任何计算，保持原有平衡）。
const POKEMON_NATURES = [
    { id: 'hardy',   name: 'Esforçada',   plus: null,    minus: null },
    { id: 'lonely',  name: 'Solitária',   plus: 'atk',   minus: 'def' },
    { id: 'brave',   name: 'Corajosa',   plus: 'atk',   minus: 'speed' },
    { id: 'adamant', name: 'Firme',   plus: 'atk',   minus: 'spAtk' },
    { id: 'naughty', name: 'Travessa',   plus: 'atk',   minus: 'spDef' },
    { id: 'bold',    name: 'Ousada',   plus: 'def',   minus: 'atk' },
    { id: 'docile',  name: 'Dócil',   plus: null,    minus: null },
    { id: 'relaxed', name: 'Relaxada',   plus: 'def',   minus: 'speed' },
    { id: 'impish',  name: 'Marota',   plus: 'def',   minus: 'spAtk' },
    { id: 'lax',     name: 'Despreocupada',   plus: 'def',   minus: 'spDef' },
    { id: 'timid',   name: 'Tímida',   plus: 'speed', minus: 'atk' },
    { id: 'hasty',   name: 'Apressada',   plus: 'speed', minus: 'def' },
    { id: 'serious', name: 'Séria',   plus: null,    minus: null },
    { id: 'jolly',   name: 'Alegre',   plus: 'speed', minus: 'spAtk' },
    { id: 'naive',   name: 'Ingênua',   plus: 'speed', minus: 'spDef' },
    { id: 'modest',  name: 'Modesta',   plus: 'spAtk', minus: 'atk' },
    { id: 'mild',    name: 'Mansa', plus: 'spAtk', minus: 'def' },
    { id: 'quiet',   name: 'Quieta',   plus: 'spAtk', minus: 'speed' },
    { id: 'bashful', name: 'Envergonhada',   plus: null,    minus: null },
    { id: 'rash',    name: 'Imprudente',   plus: 'spAtk', minus: 'spDef' },
    { id: 'calm',    name: 'Calma',   plus: 'spDef', minus: 'atk' },
    { id: 'gentle',  name: 'Gentil',   plus: 'spDef', minus: 'def' },
    { id: 'sassy',   name: 'Atrevida',   plus: 'spDef', minus: 'speed' },
    { id: 'careful', name: 'Cuidadosa',   plus: 'spDef', minus: 'spAtk' },
    { id: 'quirky',  name: 'Excêntrica',   plus: null,    minus: null },
];
const DEFAULT_NATURE = 'hardy';   // 中性性格：旧存档迁移/旧捕获流程使用，保证数值与旧版完全一致

const POKEMON_GENDERS = ['male', 'female'];   // null = 无性别 / 尚未分配（当前数据表没有物种性别比）

// 个体来历。egg/gift 为将来的孵蛋、赠送预留。
const POKEMON_ORIGINS = ['starter', 'wild', 'evolution', 'legacy_migration', 'egg', 'gift', 'debug', 'unknown'];

const NICKNAME_MAX_LENGTH = 12;
const INSTANCE_UID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ABILITY_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;
const ROUTE_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

const DAY_MS = 24 * 3600 * 1000;

// ===================== 工具 =====================
function isValidNature(id) {
    return typeof id === 'string' && POKEMON_NATURES.some(n => n.id === id);
}

function getNature(id) {
    return POKEMON_NATURES.find(n => n.id === id) || POKEMON_NATURES[0];
}

// 昵称：去掉控制字符和 HTML/引号相关字符，折叠空白，限制长度（按字符而不是字节）
function sanitizeNickname(value) {
    if (typeof value !== 'string') return '';
    const cleaned = value
        .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
        .replace(/[<>"'`&\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return Array.from(cleaned).slice(0, NICKNAME_MAX_LENGTH).join('').trim();
}

// 捕获日期以“当天 UTC 零点”的毫秒数保存：它是一个“日期”，也让同一天的两次运行产生相同数据
function toCaptureDate(timestamp) {
    const n = Number(timestamp);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n / DAY_MS) * DAY_MS;
}

function normalizeIvs(raw) {
    const out = {};
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const k of IV_KEYS) {
        const n = Number(src[k]);
        out[k] = Number.isFinite(n) ? Math.min(31, Math.max(0, Math.floor(n))) : 0;
    }
    return out;
}

function generateIvs(rng = Math.random) {
    const out = {};
    for (const k of IV_KEYS) out[k] = Math.floor(rng() * 32);
    return out;
}

function ivTotal(ivs) {
    return IV_KEYS.reduce((sum, k) => sum + (ivs[k] || 0), 0);
}

function isPerfectIvs(ivs) {
    return !!ivs && IV_KEYS.every(k => ivs[k] === 31);
}

function createEmptyInstanceStats() {
    return { victories: 0, faints: 0, expGained: 0, damageDealt: 0, damageTaken: 0, criticalHits: 0 };
}

function _nonNeg(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// 用不可信字符串（存档、外部调用）查 ownedPokemon 时必须用它：
// 直接写 owned[uid] 时 uid 为 "__proto__" 会拿到 Object.prototype（是个“真值”）。
function ownedLookup(owned, uid) {
    return typeof uid === 'string' && Object.prototype.hasOwnProperty.call(owned, uid) ? owned[uid] : null;
}

// uid 不能与 Object.prototype 上的任何名字重名（__proto__ / constructor / toString …）
function isValidInstanceUid(uid) {
    return typeof uid === 'string' && INSTANCE_UID_PATTERN.test(uid) && !(uid in Object.prototype);
}

// 个体 uid 形如 "p123"：同一存档内单调递增，所以可复现、可排序
function uidSequence(uid) {
    const m = /^p(\d{1,12})$/.exec(String(uid));
    return m ? Number(m[1]) : null;
}

// ===================== 规范形状 =====================
// 无论来自创建、迁移还是读档，都经过这里，得到字段完全相同的对象。
// 这里只做“强制类型与范围”，不判断业务规则（物种是否存在由调用方先检查）。
function buildInstance(f) {
    const speciesId = Number(f.speciesId);
    const data = POKEMON_DATA[speciesId];
    const level = Math.min(MAX_POKEMON_LEVEL, Math.max(1, Math.floor(_nonNeg(f.level, 1)) || 1));
    const stats = f.stats && typeof f.stats === 'object' ? f.stats : {};
    const defaults = createEmptyInstanceStats();
    const outStats = {};
    for (const k of Object.keys(defaults)) outStats[k] = _nonNeg(stats[k], 0);
    return {
        uid: String(f.uid),
        speciesId,
        level,
        exp: _nonNeg(f.exp, data ? getExpForLevel(data.expGroup, level) : 0),
        ivs: normalizeIvs(f.ivs),
        nature: isValidNature(f.nature) ? f.nature : DEFAULT_NATURE,
        ability: typeof f.ability === 'string' && ABILITY_ID_PATTERN.test(f.ability) ? f.ability : null,
        gender: POKEMON_GENDERS.includes(f.gender) ? f.gender : null,
        shiny: f.shiny === true,
        nickname: sanitizeNickname(f.nickname),
        origin: POKEMON_ORIGINS.includes(f.origin) ? f.origin : 'unknown',
        originRoute: typeof f.originRoute === 'string' && ROUTE_ID_PATTERN.test(f.originRoute) ? f.originRoute : null,
        caughtAt: f.caughtAt === null || f.caughtAt === undefined ? null : toCaptureDate(f.caughtAt),
        battles: Math.floor(_nonNeg(f.battles, 0)),
        stats: outStats,
        skillLevel: Math.min(MAX_SKILL_LEVEL, Math.floor(_nonNeg(f.skillLevel, 0))),
    };
}

// 创建个体（uid 由调用方分配，通常是 PokemonRoster.nextUid()）。
// opts：speciesId、level、exp、ivs、nature、ability、gender、shiny、nickname、origin、originRoute、caughtAt、rng
// 没给的字段：ivs / nature 用 rng 随机，其余用中性默认值。
function createPokemonInstance(opts) {
    const o = opts || {};
    if (!isValidInstanceUid(String(o.uid))) throw new Error('个体 uid 非法: ' + o.uid);
    if (!Object.prototype.hasOwnProperty.call(POKEMON_DATA, o.speciesId)) throw new Error('未知物种: ' + o.speciesId);
    const rng = typeof o.rng === 'function' ? o.rng : Math.random;
    const nature = isValidNature(o.nature)
        ? o.nature
        : POKEMON_NATURES[Math.floor(rng() * POKEMON_NATURES.length)].id;
    return buildInstance({
        ...o,
        ivs: o.ivs ? o.ivs : generateIvs(rng),
        nature,
        caughtAt: o.caughtAt === undefined ? Date.now() : o.caughtAt,
    });
}

// 个体在界面上显示的名字：有昵称用昵称，否则物种名
function getInstanceDisplayName(inst) {
    if (inst && inst.nickname) return inst.nickname;
    const data = inst && POKEMON_DATA[inst.speciesId];
    return data ? data.name : '???';
}
