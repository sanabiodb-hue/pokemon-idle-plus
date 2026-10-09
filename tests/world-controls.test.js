'use strict';
// F7.2: entrada do mundo (teclado e direcional na tela). Pilha de direções pura + ligação ao DOM com proteção contra
// teclas e toques presos (perder foco, esconder a página, sair da aba, perder o ponteiro).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorld, fakeEnv } = require('./helpers/world-env');

function setup({ enabled = true } = {}) {
    const env = fakeEnv();
    const world = loadWorld(env.globals);
    const changes = [], interacts = [];
    const controls = new world.WorldControls({ root: env.root, onChange: (d) => changes.push(d), onInteract: () => interacts.push(1) });
    controls.attach();
    controls.setEnabled(enabled);
    return { env, world, controls, changes, interacts };
}
const dirBtn = (dir) => ({ dataset: { dir }, tagName: 'BUTTON', captured: null, closest(sel) { return sel === '[data-dir]' ? this : null; }, setPointerCapture(id) { this.captured = id; } });
const ptr = (env, type, target, pointerId) => { const e = { target, pointerId, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; env.root.fire(type, e); return e; };

test('F7.2 entrada: pilha de direções — vale a última pressionada, soltar volta para a anterior, repetir não duplica', () => {
    const { DirectionStack } = loadWorld();
    const s = new DirectionStack();
    assert.equal(s.current(), null);
    assert.equal(s.press('a', 'up'), true);
    assert.equal(s.press('b', 'left'), true);
    assert.equal(s.current(), 'left', 'a última vence');
    assert.equal(s.press('b', 'left'), false, 'repetir a mesma fonte não muda nada');
    assert.equal(s.size, 2);
    assert.equal(s.release('b'), true);
    assert.equal(s.current(), 'up', 'soltar volta para a anterior');
    assert.equal(s.release('zzz'), false, 'soltar o que não está pressionado é inofensivo');
    assert.equal(s.press('a', 'down'), true, 'a mesma fonte pode mudar de direção');
    assert.equal(s.current(), 'down');
    assert.equal(s.size, 1);
    assert.equal(s.clear(), true);
    assert.equal(s.clear(), false);
    assert.equal(s.current(), null);
});

test('F7.2 entrada: setas e WASD (por code ou só por key) viram as quatro direções e evitam rolar a página', () => {
    const { env, controls } = setup();
    for (const [code, dir] of [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['KeyW', 'up'], ['KeyA', 'left'], ['KeyS', 'down'], ['KeyD', 'right']]) {
        const down = env.key('keydown', code);
        assert.equal(controls.direction(), dir, code);
        assert.equal(down.defaultPrevented, true, `${code}: não rola a página`);
        env.key('keyup', code);
        assert.equal(controls.direction(), null, `${code}: soltou`);
    }
    env.key('keydown', undefined, { code: '', key: 'a' });
    assert.equal(controls.direction(), 'left', 'só com key (sem code): "a"');
    env.key('keyup', undefined, { code: '', key: 'A' });
    assert.equal(controls.direction(), null);
    const other = env.key('keydown', 'KeyQ');
    assert.equal(other.defaultPrevented, false, 'teclas que não são nossas passam');
    assert.equal(controls.direction(), null);
});

test('F7.2 entrada: duas teclas — a última vence e soltar volta para a outra; repetição automática da tecla é ignorada', () => {
    const { env, controls, changes } = setup();
    env.key('keydown', 'ArrowUp');
    env.key('keydown', 'ArrowUp', { repeat: true });
    env.key('keydown', 'ArrowUp', { repeat: true });
    assert.deepEqual(changes, ['up'], 'repetição não gera mudança nem duplica');
    env.key('keydown', 'KeyD');
    assert.equal(controls.direction(), 'right');
    env.key('keyup', 'KeyD');
    assert.equal(controls.direction(), 'up', 'soltou a última: volta para a anterior');
    env.key('keyup', 'ArrowUp');
    assert.equal(controls.direction(), null);
    assert.deepEqual(changes, ['up', 'right', 'up', null], 'só mudanças efetivas');
});

test('F7.2 entrada: campos de formulário, teclas com Ctrl/Alt/Meta e entrada desligada são ignorados', () => {
    const { env, controls, changes } = setup();
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
        const e = env.key('keydown', 'KeyW', { target: { tagName: tag } });
        assert.equal(e.defaultPrevented, false, `${tag}: não interfere`);
    }
    env.key('keydown', 'KeyW', { target: { tagName: 'DIV', isContentEditable: true } });
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) env.key('keydown', 'ArrowLeft', { [mod]: true });
    assert.equal(controls.direction(), null);
    assert.equal(changes.length, 0);
    controls.setEnabled(false);
    const off = env.key('keydown', 'ArrowLeft');
    assert.equal(controls.direction(), null, 'desligada: nada');
    assert.equal(off.defaultPrevented, false, 'desligada: as setas rolam a página normalmente');
});

test('F7.2 entrada: perder o foco, esconder a página e desligar a entrada soltam tudo (nada de tecla presa)', () => {
    const { env, controls, changes } = setup();
    env.key('keydown', 'ArrowRight');
    assert.equal(controls.direction(), 'right');
    env.winListeners.blur.forEach(f => f());
    assert.equal(controls.direction(), null, 'blur da janela');
    assert.equal(changes[changes.length - 1], null);
    env.key('keydown', 'KeyA');
    env.document.hidden = false;
    env.listeners.visibilitychange.forEach(f => f());
    assert.equal(controls.direction(), 'left', 'página visível: não solta');
    env.document.hidden = true;
    env.listeners.visibilitychange.forEach(f => f());
    assert.equal(controls.direction(), null, 'página escondida');
    env.key('keydown', 'KeyS');
    controls.setEnabled(false);
    assert.equal(controls.direction(), null, 'desligar solta');
    controls.setEnabled(true);
    assert.equal(controls.direction(), null, 'religar não ressuscita teclas antigas');
    env.key('keyup', 'KeyS');                                              // o keyup tardio é inofensivo
    assert.equal(controls.direction(), null);
});

test('F7.2 entrada: soltar a tecla vale mesmo com a entrada desligada (sem tecla presa no retorno)', () => {
    const { env, controls, changes } = setup();
    env.key('keydown', 'KeyW');
    controls.enabled = false;                                              // desligada "por baixo" (cenário extremo): sem clear
    env.key('keyup', 'KeyW');
    controls.enabled = true;
    assert.equal(controls.stack.size, 0, 'o keyup liberou a tecla');
    assert.equal(controls.direction(), null);
    assert.ok(changes.length >= 2);
});

test('F7.2 entrada: E e Enter pedem interação (Enter em botão não, para não duplicar o clique); desligada ou repetida não', () => {
    const { env, controls, interacts } = setup();
    assert.equal(env.key('keydown', 'KeyE').defaultPrevented, true);
    env.key('keydown', 'Enter');
    assert.equal(interacts.length, 2);
    env.key('keydown', 'Enter', { target: { tagName: 'BUTTON' } });
    env.key('keydown', 'KeyE', { repeat: true });
    env.key('keydown', 'KeyE', { target: { tagName: 'SELECT' } });
    env.key('keydown', 'KeyE', { ctrlKey: true });
    assert.equal(interacts.length, 2, 'botão, repetição, formulário e Ctrl não interagem');
    controls.setEnabled(false);
    env.key('keydown', 'KeyE');
    assert.equal(interacts.length, 2, 'desligada: nada');
});

test('F7.2 entrada: direcional na tela — pressionar anda, soltar/cancelar/perder o ponteiro para; vários dedos usam a pilha', () => {
    const { env, controls, changes } = setup();
    const up = dirBtn('up'), right = dirBtn('right');
    const down1 = ptr(env, 'pointerdown', up, 1);
    assert.equal(controls.direction(), 'up');
    assert.equal(down1.defaultPrevented, true, 'não rola/zoom da página');
    assert.equal(up.captured, 1, 'captura o ponteiro');
    ptr(env, 'pointerdown', right, 2);
    assert.equal(controls.direction(), 'right', 'segundo dedo vence');
    ptr(env, 'pointerup', right, 2);
    assert.equal(controls.direction(), 'up', 'soltar o segundo volta ao primeiro');
    for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        ptr(env, 'pointerdown', up, 5);
        assert.equal(controls.direction(), 'up');
        ptr(env, end, up, 5);
        ptr(env, end, up, 1);
        assert.equal(controls.direction(), null, `${end} solta`);
        ptr(env, 'pointerdown', up, 1);                                     // reabre o primeiro dedo para a próxima rodada
    }
    ptr(env, 'pointerup', up, 1);
    assert.equal(controls.direction(), null);
    ptr(env, 'pointerdown', { dataset: {}, closest: () => null }, 9);
    assert.equal(controls.direction(), null, 'toque fora do direcional não faz nada');
    ptr(env, 'pointerdown', { dataset: { dir: 'diagonal' }, closest() { return this; } }, 9);
    assert.equal(controls.direction(), null, 'direção inválida é ignorada');
    controls.setEnabled(false);
    ptr(env, 'pointerdown', up, 11);
    assert.equal(controls.direction(), null, 'desligado: ignora toques');
    const ctx = { target: up, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    env.root.fire('contextmenu', ctx);
    assert.equal(ctx.defaultPrevented, true, 'pressão longa não abre o menu de contexto no direcional');
    assert.ok(changes.length > 4);
});

test('F7.2 entrada: attach/detach são idempotentes, não vazam ouvintes e detach solta a direção', () => {
    const { env, controls } = setup();
    controls.attach(); controls.attach();
    assert.equal(env.listenerCount('keydown'), 1);
    assert.equal(env.listenerCount('keyup'), 1);
    assert.equal(env.listenerCount('visibilitychange'), 1);
    assert.equal(env.winListeners.blur.size, 1);
    assert.equal(env.root.listenerCount('pointerdown'), 1);
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture', 'contextmenu']) assert.equal(env.root.listenerCount(t), 1, t);
    env.key('keydown', 'KeyD');
    assert.equal(controls.direction(), 'right');
    controls.detach(); controls.detach();
    assert.equal(controls.direction(), null, 'detach solta');
    for (const t of ['keydown', 'keyup', 'visibilitychange']) assert.equal(env.listenerCount(t), 0, t);
    assert.equal(env.winListeners.blur.size, 0);
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'contextmenu']) assert.equal(env.root.listenerCount(t), 0, t);
    env.key('keydown', 'KeyD');
    assert.equal(controls.direction(), null, 'depois do detach nenhuma tecla é lida');
});
