'use strict';
// O relógio falso dos testes (tests/helpers/clock.js) é a base de vários testes determinísticos: ele próprio precisa de testes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeClock, installFakeTimers } = require('./helpers/clock');

test('fakeClock: timer único dispara uma vez, no instante certo, e sai da fila', () => {
    const clk = fakeClock(1000);
    const seen = [];
    clk.setTimer(() => seen.push(clk.now()), 500);
    clk.advance(499);
    assert.deepEqual(seen, [], 'antes do prazo não dispara');
    assert.equal(clk.pendingTimers(), 1);
    clk.advance(1);
    assert.deepEqual(seen, [1500], 'dispara quando o relógio marca exatamente o prazo');
    assert.equal(clk.pendingTimers(), 0, 'timer único não fica agendado');
    clk.advance(5000);
    assert.deepEqual(seen, [1500], 'e nunca dispara de novo');
});

test('fakeClock: setRepeating dispara N vezes em advance(N*ms) e continua agendado', () => {
    const clk = fakeClock(0);
    const seen = [];
    clk.setRepeating(() => seen.push(clk.now()), 100);
    clk.advance(5 * 100);
    assert.deepEqual(seen, [100, 200, 300, 400, 500]);
    assert.equal(clk.pendingTimers(), 1, 'o repetido continua agendado');
    clk.advance(99);
    assert.equal(seen.length, 5, 'ainda não venceu a próxima volta');
    clk.advance(1);
    assert.deepEqual(seen.slice(5), [600]);
    assert.equal(clk.now(), 600);
});

test('fakeClock: clearTimer dentro do callback cancela os disparos seguintes (repetido e único)', () => {
    const clk = fakeClock(0);
    let rep = 0, id;
    id = clk.setRepeating(() => { rep++; if (rep === 3) clk.clearTimer(id); }, 10);
    clk.advance(1000);
    assert.equal(rep, 3, 'o repetido para depois de se cancelar no 3º disparo');
    assert.equal(clk.pendingTimers(), 0);

    const order = [];
    let later;
    clk.setTimer(() => { order.push('a'); clk.clearTimer(later); }, 50);
    later = clk.setTimer(() => order.push('b'), 60);
    clk.advance(100);
    assert.deepEqual(order, ['a'], 'um timer cancelado por outro, antes de vencer, não dispara');
});

test('fakeClock: timers no mesmo instante disparam na ordem de criação (inclusive repetido × único)', () => {
    const clk = fakeClock(0);
    const order = [];
    clk.setTimer(() => order.push('t1'), 100);
    clk.setRepeating(() => order.push('r2'), 100);
    clk.setTimer(() => order.push('t3'), 100);
    clk.setTimer(() => order.push('t0-cedo'), 50);
    clk.advance(100);
    assert.deepEqual(order, ['t0-cedo', 't1', 'r2', 't3']);
});

test('fakeClock: advance(0) só dispara o que já venceu', () => {
    const clk = fakeClock(100);
    const seen = [];
    clk.setTimer(() => seen.push('agora'), 0);
    clk.setTimer(() => seen.push('depois'), 1);
    clk.advance(0);
    assert.deepEqual(seen, ['agora']);
    assert.equal(clk.now(), 100, 'o relógio não anda');
    assert.equal(clk.pendingTimers(), 1);
    clk.advance(0);
    assert.deepEqual(seen, ['agora'], 'repetir advance(0) não dispara de novo nem adianta o que ainda não venceu');
});

test('fakeClock: timer criado dentro do callback entra no mesmo advance se vencer dentro da janela', () => {
    const clk = fakeClock(0);
    const seen = [];
    clk.setTimer(() => { seen.push('a'); clk.setTimer(() => seen.push('b'), 10); }, 10);
    clk.advance(30);
    assert.deepEqual(seen, ['a', 'b']);
    assert.equal(clk.now(), 30);
});

test('installFakeTimers: setTimeout/setInterval/clear* do contexto do jogo vão para o relógio falso', () => {
    const sandbox = {};
    const clk = installFakeTimers({ sandbox });
    let t = 0, i = 0;
    sandbox.setTimeout(() => t++, 20);
    const id = sandbox.setInterval(() => i++, 10);
    clk.advance(35);
    assert.equal(t, 1);
    assert.equal(i, 3);
    sandbox.clearInterval(id);
    clk.advance(100);
    assert.equal(i, 3, 'clearInterval cancela o repetido');
    const tid = sandbox.setTimeout(() => t++, 5);
    sandbox.clearTimeout(tid);
    clk.advance(10);
    assert.equal(t, 1, 'clearTimeout cancela o único');
});
