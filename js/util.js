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
