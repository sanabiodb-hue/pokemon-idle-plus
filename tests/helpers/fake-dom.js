'use strict';
// DOM mínimo para testar as views sem navegador: só o que a HuntView usa.
// Os elementos "#id" são persistentes; innerHTML guarda a string renderizada para as asserções.
function makeFakeDom(ctx) {
    const nodes = new Map();
    const node = (id) => {
        if (!nodes.has(id)) nodes.set(id, { id, innerHTML: '', handlers: {}, addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); },
            querySelector(sel) { return sel.startsWith('#') ? node(sel.slice(1)) : null; }, querySelectorAll() { return []; } });
        return nodes.get(id);
    };
    const root = node('hunt-container');
    const document = { getElementById: (id) => (id === 'hunt-container' ? root : null) };
    ctx.sandbox.document = document;
    const text = (id) => String(node(id).innerHTML).replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return { node, text, html: (id) => node(id).innerHTML, root };
}

// Elemento de formulário falso: matches('[data-hunt-policy]') confere o dataset (camelCase)
function fakeEl(dataset, props = {}) {
    return {
        dataset, ...props,
        matches(sel) {
            const m = /^\[data-([a-z-]+)\]$/.exec(sel);
            if (!m) return false;
            const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            return Object.prototype.hasOwnProperty.call(dataset, key);
        },
    };
}

function makeUi(game) {
    const ui = { game, toasts: [], logs: [], tab: 'tab-hunt', currentTab: 'tab-hunt', switched: [] };
    ui.showToast = (m) => ui.toasts.push(m);
    ui.addBattleLog = (m, k) => ui.logs.push([m, k]);
    ui.switchTab = (t) => ui.switched.push(t);
    return ui;
}

module.exports = { makeFakeDom, fakeEl, makeUi };
