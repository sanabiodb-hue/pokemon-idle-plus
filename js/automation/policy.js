// 自动化 · 策略（AutomationPolicy v1）：玩家"配置"出来的规则，纯数据，不含任何决策逻辑。
// validateAutomationPolicy：严格校验（给 UI / 开始狩猎前用），返回错误列表；
// sanitizeAutomationPolicy：宽松清洗（读档/导入用），永远返回一份合法策略。
// 两者共用 _normalizePolicy，保证"能存下来的策略一定能通过校验"。
// 预留项（目前只接受默认值）：heal.onNoPotions='rest'、ballPolicy 的其他类型。

const AUTOMATION_POLICY_VERSION = 1;
const AUTOMATION_TARGET_TYPES = ['any', 'species'];
const AUTOMATION_ROUTE_MODES = ['stay', 'stop', 'switchWhenComplete'];
const AUTOMATION_SWITCH_MODES = ['keep', 'bestMatchup'];
const AUTOMATION_NO_POTION_BEHAVIORS = ['stop'];         // 'rest'（原地休息回血）留给以后
const AUTOMATION_RESERVED_NO_POTION = ['rest'];
const AUTOMATION_BALL_POLICIES = ['none'];               // 精灵球种类/数量策略留给经济阶段
const AUTOMATION_MAX_TARGET_SPECIES = 50;

function defaultAutomationPolicy() {
    return {
        version: AUTOMATION_POLICY_VERSION,
        target: { type: 'any', speciesIds: [] },
        capture: { enabled: true, minQualityPercent: 0, alwaysShiny: true, alwaysNewSpecies: true },
        heal: { enabled: true, belowPercent: 40, onNoPotions: 'stop' },
        route: { mode: 'stay' },
        switchPolicy: { mode: 'bestMatchup' },
        ballPolicy: { type: 'none' },
        stopConditions: { maxBattles: 0, maxMinutes: 0 },   // 0 = 不限
    };
}

// 严格数值：不像 _num 那样把越界值截断，越界/非数字一律返回 null 交给调用方报错
function _strictNumber(v, min, max) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

const _POLICY_KEYS = ['version', 'target', 'capture', 'heal', 'route', 'switchPolicy', 'ballPolicy', 'stopConditions'];

function _normalizePolicy(raw) {
    const errors = [];
    const err = (path, code, message) => errors.push({ path, code, message });
    const out = defaultAutomationPolicy();
    if (!_isObj(raw)) {
        err('', 'not_object', 'A política de automação é inválida.');
        return { policy: out, errors };
    }
    for (const k of Object.keys(raw)) if (!_POLICY_KEYS.includes(k)) err(k, 'unknown_field', `Campo desconhecido na política: ${k}.`);
    if (_has(raw, 'version') && raw.version !== AUTOMATION_POLICY_VERSION) err('version', 'bad_version', 'Versão de política não suportada.');

    const section = (key) => {
        if (!_has(raw, key) || raw[key] === undefined) return null;
        if (!_isObj(raw[key])) { err(key, 'not_object', `A seção "${key}" da política é inválida.`); return null; }
        return raw[key];
    };

    const target = section('target');
    if (target) {
        if (_has(target, 'type')) {
            if (AUTOMATION_TARGET_TYPES.includes(target.type)) out.target.type = target.type;
            else err('target.type', 'bad_enum', 'Tipo de alvo inválido.');
        }
        if (_has(target, 'speciesIds')) {
            if (Array.isArray(target.speciesIds)) {
                const ids = [];
                for (const v of target.speciesIds) {
                    const id = _validPokemonId(v);
                    if (id === null) err('target.speciesIds', 'unknown_species', 'Espécie-alvo desconhecida.');
                    else if (!ids.includes(id)) ids.push(id);
                }
                if (ids.length > AUTOMATION_MAX_TARGET_SPECIES) {
                    err('target.speciesIds', 'too_many', `No máximo ${AUTOMATION_MAX_TARGET_SPECIES} espécies-alvo.`);
                    ids.length = AUTOMATION_MAX_TARGET_SPECIES;
                }
                out.target.speciesIds = ids;
            } else err('target.speciesIds', 'not_array', 'A lista de espécies-alvo é inválida.');
        }
        if (out.target.type === 'species' && out.target.speciesIds.length === 0) {
            err('target.speciesIds', 'empty_target', 'Escolha ao menos uma espécie-alvo.');
            out.target.type = 'any';
        }
        if (out.target.type === 'any') out.target.speciesIds = out.target.speciesIds.slice();
    }

    const cap = section('capture');
    if (cap) {
        if (_has(cap, 'enabled')) { if (typeof cap.enabled === 'boolean') out.capture.enabled = cap.enabled; else err('capture.enabled', 'not_boolean', 'Valor inválido.'); }
        if (_has(cap, 'alwaysNewSpecies')) { if (typeof cap.alwaysNewSpecies === 'boolean') out.capture.alwaysNewSpecies = cap.alwaysNewSpecies; else err('capture.alwaysNewSpecies', 'not_boolean', 'Valor inválido.'); }
        if (_has(cap, 'alwaysShiny')) { if (typeof cap.alwaysShiny === 'boolean') out.capture.alwaysShiny = cap.alwaysShiny; else err('capture.alwaysShiny', 'not_boolean', 'Valor inválido.'); }
        if (_has(cap, 'minQualityPercent')) {
            const v = _strictNumber(cap.minQualityPercent, 0, 100);
            if (v === null) err('capture.minQualityPercent', 'out_of_range', 'A qualidade mínima deve estar entre 0 e 100.');
            else out.capture.minQualityPercent = v;
        }
    }

    const heal = section('heal');
    if (heal) {
        if (_has(heal, 'enabled')) { if (typeof heal.enabled === 'boolean') out.heal.enabled = heal.enabled; else err('heal.enabled', 'not_boolean', 'Valor inválido.'); }
        if (_has(heal, 'belowPercent')) {
            const v = _strictNumber(heal.belowPercent, 1, 99);
            if (v === null) err('heal.belowPercent', 'out_of_range', 'O limite de cura deve estar entre 1% e 99%.');
            else out.heal.belowPercent = v;
        }
        if (_has(heal, 'onNoPotions')) {
            if (AUTOMATION_NO_POTION_BEHAVIORS.includes(heal.onNoPotions)) out.heal.onNoPotions = heal.onNoPotions;
            else if (AUTOMATION_RESERVED_NO_POTION.includes(heal.onNoPotions)) err('heal.onNoPotions', 'reserved', 'Descansar sem poções ainda não está disponível.');
            else err('heal.onNoPotions', 'bad_enum', 'Comportamento sem poções inválido.');
        }
    }

    const route = section('route');
    if (route && _has(route, 'mode')) {
        if (AUTOMATION_ROUTE_MODES.includes(route.mode)) out.route.mode = route.mode;
        else err('route.mode', 'bad_enum', 'Modo de rota inválido.');
    }

    const sw = section('switchPolicy');
    if (sw && _has(sw, 'mode')) {
        if (AUTOMATION_SWITCH_MODES.includes(sw.mode)) out.switchPolicy.mode = sw.mode;
        else err('switchPolicy.mode', 'bad_enum', 'Modo de troca de Pokémon inválido.');
    }

    const ball = section('ballPolicy');
    if (ball && _has(ball, 'type')) {
        if (AUTOMATION_BALL_POLICIES.includes(ball.type)) out.ballPolicy.type = ball.type;
        else err('ballPolicy.type', 'reserved', 'Essa política de bolas ainda não está disponível.');
    }

    const stop = section('stopConditions');
    if (stop) {
        for (const [key, max] of [['maxBattles', 1e9], ['maxMinutes', 1e6]]) {
            if (!_has(stop, key)) continue;
            const v = _strictNumber(stop[key], 0, max);
            if (v === null || !Number.isInteger(v)) err(`stopConditions.${key}`, 'out_of_range', 'Limite de parada inválido.');
            else out.stopConditions[key] = v;
        }
    }
    return { policy: out, errors };
}

function validateAutomationPolicy(raw) {
    const { policy, errors } = _normalizePolicy(raw);
    return { ok: errors.length === 0, errors, policy };
}

function sanitizeAutomationPolicy(raw) {
    return _normalizePolicy(raw).policy;
}

// 目标物种只影响"捕获优先级"（任何目标类型下非目标仍会被战斗并获得经验）
function policyTargetsSpecies(policy, speciesId) {
    return !!policy && policy.target.type === 'species' && policy.target.speciesIds.includes(speciesId);
}

// 存档里的 automation 字段：只存策略（会话与统计另有字段，见 hunt-session）。没有字段 = 自动化从未配置
function sanitizeAutomationState(raw) {
    if (!_isObj(raw)) return null;
    const out = { policy: sanitizeAutomationPolicy(raw.policy) };
    if (typeof sanitizeHuntSession === 'function' && _isObj(raw.session)) {
        const s = sanitizeHuntSession(raw.session);
        if (s) out.session = s;
    }
    return out;
}
