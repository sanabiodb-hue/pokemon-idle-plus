// ============================================================
// 通用工具 - 与游戏逻辑无关的纯函数
// ============================================================

// 转义 HTML，防止存档/外部数据被当作标签解析
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"'`]/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;',
    }[ch]));
}

// 只允许 #rgb / #rrggbb 颜色，其余一律回退，避免 style 注入
function safeCssColor(value, fallback = '#a0a0a0') {
    return typeof value === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value) ? value : fallback;
}

// ===================== 存档/数据清洗用的小工具（save-manager.js 与 pokemon-validation.js 共用）=====================
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

// ===================== 文案辅助（界面文字为巴西葡萄牙语）=====================
// 葡萄牙语单复数：1 → 单数；0 和其他 → 复数
function ptPlural(n, one, many) {
    return Number(n) === 1 ? one : many;
}
// 数字按巴西习惯显示：1.234.567
function ptNumber(n) {
    return Number(n).toLocaleString('pt-BR');
}
