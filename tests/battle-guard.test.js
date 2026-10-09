'use strict';
// Fase 7 · F7.0: startBattle() não pode abrir uma segunda batalha por cima de outra.
// Cobre os chamadores legítimos (encadeamento, cura, poção, Torre, offline, troca de Pokémon, Caça)
// e as recusas (batalha em curso, cura em curso, próxima batalha agendada, offline, Torre).
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, plain } = require('./helpers/game');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const watch = (game) => { const ev = []; game.bus.on('*', (e) => ev.push(e)); return ev; };
const count = (ev, type, live = true) => ev.filter(e => e.type === type && (!live || !e.offline)).length;

function wildOf(game, id = 19, level = 3) {
    const saved = game.rng;
    game.rng = () => 0.5;
    const w = game.createWildPokemon(id, level, 0);
    game.rng = saved;
    return w;
}

// Derrota o inimigo atual pelo caminho real (battleTick → onEnemyDefeated). Deixa a próxima batalha agendada.
function kill(game) {
    const b = game.currentBattle;
    b.wildCurrentHp = 1;
    b.playerTimer = b.playerNextAttack;
    b.enemyTimer = 0;
    const saved = game.rng;
    game.rng = () => 0.99;
    game.battleTick();
    game.rng = saved;
}

test('F7.0: começar uma batalha normal funciona e devolve true', () => {
    const { game } = newGame();
    const ev = watch(game);
    assert.equal(game.startBattle(), true);
    assert.ok(game.battleTimer, 'o loop de 50 ms está ativo');
    assert.ok(game.currentBattle);
    assert.equal(count(ev, 'battle_started'), 1);
});

test('F7.0: segunda chamada com batalha em curso é recusada sem mexer em nada', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.startBattle();
    const battle = game.currentBattle, timer = game.battleTimer, enemy = game.gameState.currentEnemy;
    battle.wildCurrentHp = Math.max(1, battle.wildCurrentHp - 1);
    const wildHp = battle.wildCurrentHp;
    assert.equal(game.startBattle(), false);
    assert.equal(game.currentBattle, battle, 'mesma batalha (objeto)');
    assert.equal(game.battleTimer, timer, 'mesmo timer');
    assert.equal(game.gameState.currentEnemy, enemy, 'mesmo inimigo');
    assert.equal(game.currentBattle.wildCurrentHp, wildHp, 'o inimigo não voltou à vida cheia');
    assert.equal(count(ev, 'battle_started'), 1);
    assert.equal(game._battleGuard.refused, 1);
    assert.equal(game._battleGuard.last, 'in_battle');
});

test('F7.0: com a próxima batalha já agendada, uma chamada extra é recusada e a recompensa vem uma vez só', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.gameState.currentEnemy = wildOf(game);
    game.startBattle();
    kill(game);
    assert.ok(game._nextBattleTimeout, 'a próxima batalha ficou agendada');
    const pending = game._nextBattleTimeout, battle = game.currentBattle;
    for (let i = 0; i < 3; i++) assert.equal(game.startBattle(), false);
    assert.equal(game._nextBattleTimeout, pending, 'o agendamento não foi trocado');
    assert.equal(game.currentBattle, battle);
    assert.equal(game.battleTimer, null, 'nenhum loop novo foi aberto');
    assert.equal(game._battleGuard.last, 'next_scheduled');
    assert.equal(game.gameState.stats.totalBattles, 1);
    assert.equal(count(ev, 'battle_completed'), 1);
    game.stopBattle();
});

test('F7.0: durante a cura após derrota, startBattle não reanima o Pokémon de graça', () => {
    const { game } = newGame();
    game.startBattle();
    game.stopBattle();
    game.currentBattle.playerCurrentHp = 0;
    game.startHealingAfterDefeat();
    const heal = game.healTimer;
    assert.ok(heal);
    assert.equal(game.startBattle(), false);
    assert.equal(game.currentBattle.playerCurrentHp, 0, 'continua desmaiado, sem HP cheio de graça');
    assert.equal(game.healTimer, heal);
    assert.equal(game.battleTimer, null);
    assert.equal(game._battleGuard.last, 'healing');
    game.stopBattle();
});

test('F7.0: durante a simulação offline e na Torre startBattle é recusado', () => {
    const { game } = newGame();
    game._isOfflineSimulating = true;
    assert.equal(game.startBattle(), false);
    assert.equal(game._battleGuard.last, 'offline');
    game._isOfflineSimulating = false;
    game._towerMode = true;
    assert.equal(game.startBattle(), false);
    assert.equal(game._battleGuard.last, 'tower');
    assert.ok(!game.currentBattle, 'nada foi criado');
    assert.equal(game.battleTimer, null);
    game._towerMode = false;
    assert.equal(game.startBattle(), true, 'sem bloqueios volta a funcionar');
    game.stopBattle();
});

test('F7.0: sem time ou sem rota continua não iniciando (e devolve false)', () => {
    const { game } = newGame();
    game.gameState.team.length = 0;
    assert.equal(game.startBattle(), false);
    assert.equal(game.battleTimer, null);
});

test('F7.0 legítimo: o encadeamento depois da vitória abre exatamente uma nova batalha', async () => {
    const { game } = newGame();
    const ev = watch(game);
    game.gameState.currentEnemy = wildOf(game);
    game.startBattle();
    kill(game);
    await sleep(1000);                                       // atraso máximo entre batalhas: 800 ms
    assert.equal(count(ev, 'battle_started'), 2, 'início + encadeada');
    assert.ok(game.battleTimer, 'a nova batalha está rodando');
    assert.equal(game._nextBattleTimeout, null);
    assert.equal(count(ev, 'battle_completed'), 1, 'uma única recompensa');
    assert.equal(game.gameState.stats.totalBattles, 1);
    game.stopBattle();
});

test('F7.0 legítimo: ao terminar a cura a batalha recomeça uma vez', async () => {
    const { game } = newGame();
    const ev = watch(game);
    game.startBattle();
    game.stopBattle();
    const b = game.currentBattle;
    b.playerCurrentHp = Math.max(0, b.playerMaxHp - 1);      // a primeira cura de 1 s já enche a vida
    game.startHealingAfterDefeat();
    await sleep(1300);
    assert.equal(game.healTimer, null);
    assert.ok(game.battleTimer, 'voltou a lutar');
    assert.equal(count(ev, 'battle_started'), 2);
    game.stopBattle();
});

test('F7.0 legítimo: poção que reanima reabre a batalha (e só uma)', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.ensureInventory().potions = 1;
    game.startBattle();
    game.stopBattle();
    game.currentBattle.playerCurrentHp = 0;
    game.startHealingAfterDefeat();
    const r = game.usePotion('manual');
    assert.equal(r.ok, true);
    assert.equal(game.healTimer, null);
    assert.ok(game.battleTimer, 'a batalha reabriu');
    assert.equal(count(ev, 'battle_started'), 2);
    assert.equal(game.getPotions(), 0);
    game.stopBattle();
});

test('F7.0 legítimo: trocar o Pokémon em batalha é troca a quente (sem nova batalha); sem batalha, começa uma', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.currentBattle = null;
    game.setActivePokemon(0);
    assert.ok(game.battleTimer, 'sem batalha, a troca começa uma');
    assert.equal(count(ev, 'battle_started'), 1);
    const timer = game.battleTimer, battle = game.currentBattle;
    game.setActivePokemon(0);
    assert.equal(game.battleTimer, timer);
    assert.equal(game.currentBattle, battle);
    assert.equal(count(ev, 'battle_started'), 1, 'troca a quente não abre outra');
    game.stopBattle();
});

test('F7.0 legítimo: sair da Torre no meio de uma luta devolve a linha principal', () => {
    const { game } = newGame();
    game.isTowerUnlocked = () => true;
    assert.equal(game.enterTower().success, true);
    game.startTowerBattle();
    assert.ok(game.battleTimer, 'luta da Torre em andamento');
    game.exitTower();
    assert.equal(game._towerMode, false);
    assert.ok(game.battleTimer, 'a linha principal voltou a lutar');
    const route = game.getRoute(game.gameState.currentRoute);
    assert.ok(route.pokemon.some(p => p.id === game.currentBattle.wild.id), 'o inimigo é da rota atual, não da Torre');
    game.stopBattle();
});

test('F7.0 legítimo: ao concluir um andar da Torre o jogo pode retomar a linha principal (chamada da interface)', () => {
    const { game } = newGame();
    game.isTowerUnlocked = () => true;
    game.enterTower();
    game.startTowerBattle();
    game.gameState.tower.currentEnemyIndex = 5;               // o último de 6
    kill(game);
    assert.equal(game._towerMode, false, 'andar concluído sai do modo Torre');
    assert.equal(game.battleTimer, null);
    assert.equal(game.startBattle(), true, 'a interface retoma a linha principal');
    game.stopBattle();
});

test('F7.0 legítimo: a Caça iniciada com o loop idle ligado não abre uma segunda batalha', () => {
    const { game } = newGame();
    const ev = watch(game);
    game.startBattle();
    const timer = game.battleTimer;
    const r = game.dispatchAutomationAction({ type: 'START_HUNT' });
    assert.equal(r.ok, true, JSON.stringify(plain(r)));
    assert.equal(game.battleTimer, timer);
    assert.equal(count(ev, 'battle_started'), 1);
    assert.equal(game.dispatchAutomationAction({ type: 'ATTACK' }).code, 'already_engaged');
    game.stopBattle();
});

test('F7.0 legítimo: ao fim da simulação offline a batalha reabre uma vez', async () => {
    const { game } = newGame();
    const ev = watch(game);
    game.startBattle();
    await new Promise((resolve) => {
        const prev = game.onBattleEvent;
        game.onBattleEvent = (event, data) => {
            if (prev) prev(event, data);
            if (event === 'offlineEnd') setTimeout(resolve, 0);
        };
        game._processOfflineBattles(60000);
    });
    assert.equal(game._isOfflineSimulating, false);
    assert.ok(game.battleTimer, 'o loop reabriu');
    assert.equal(count(ev, 'battle_started'), 2, 'a inicial e a de depois do offline');
    game.stopBattle();
});

// ---- Importar/excluir save no meio da simulação offline (o smoke faz isso ao carregar um save antigo) ----
const savedText = () => newGame({ seed: 5 }).game.exportSave();

test('F7.0: importar um save durante a simulação offline cancela a simulação por completo e a batalha volta', async () => {
    const { game } = newGame();
    const original = () => {};
    game.startBattle();
    game.onBattleEvent = original;
    game._processOfflineBattles(3600000);
    assert.equal(game._isOfflineSimulating, true, 'a simulação começou');
    assert.notEqual(game.onBattleEvent, original, 'callbacks silenciados durante a simulação');
    const r = game.importSave(savedText());
    assert.equal(r.success, true);
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game._offlineSimState, null);
    assert.equal(game._fastSim, null);
    assert.equal(game.onBattleEvent, original, 'callback original devolvido');
    assert.equal(game.clock.constructor.name, 'SystemClock');
    assert.equal(game.startBattle(), true, 'a batalha pode voltar (a guarda não trava o jogo)');
    const battle = game.currentBattle;
    game._runOfflineBatch();                                  // o lote pendente, executado à mão, não pode ressuscitar a simulação
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game._fastSim, null);
    assert.equal(game.currentBattle, battle, 'a batalha em curso não foi tocada');
    await sleep(60);                                          // e o lote realmente agendado também não
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game._fastSim, null);
    game.stopBattle();
});

test('F7.0: o mesmo vale com uma Caça em andamento (relógio simulado devolvido)', async () => {
    const { game } = newGame();
    game.startBattle();
    assert.equal(game.dispatchAutomationAction({ type: 'START_HUNT' }).ok, true);
    game._processOfflineBattles(3600000);
    assert.equal(game.clock.constructor.name, 'SimulationClock', 'a Caça roda em relógio simulado no offline');
    assert.equal(game.importSave(savedText()).success, true);
    assert.equal(game.clock.constructor.name, 'SystemClock');
    assert.equal(game._offlineHunt, null);
    assert.equal(game.startBattle(), true);
    await sleep(60);
    assert.equal(game.clock.constructor.name, 'SystemClock');
    game.stopBattle();
});

test('F7.0: excluir o save durante a simulação offline também devolve callbacks e flags', async () => {
    const { game } = newGame();
    const original = () => {};
    game.startBattle();
    game.onBattleEvent = original;
    game._processOfflineBattles(3600000);
    game.stopBattle();
    game.deleteSave();
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game.onBattleEvent, original);
    assert.equal(game._offlineSimState, null);
    await sleep(60);                                          // o lote pendente encontra o estado vazio e para
    assert.equal(game._isOfflineSimulating, false);
});

test('F7.0: importar sem simulação offline continua igual (nada a cancelar)', () => {
    const { game } = newGame();
    game.startBattle();
    assert.equal(game._abortOfflineSimulation(), false);
    assert.equal(game.importSave(savedText()).success, true);
    assert.equal(game.startBattle(), true);
    game.stopBattle();
});

test('F7.0: o cancelamento devolve TODOS os callbacks e não gera recompensa depois (import e delete)', async () => {
    for (const how of ['import', 'delete']) {
        const { game } = newGame({ seed: 9 });
        const cbs = { battle: () => {}, catch: () => {}, level: () => {} };
        game.startBattle();
        game.onBattleEvent = cbs.battle; game.onCatch = cbs.catch; game.onLevelUp = cbs.level;
        game._processOfflineBattles(3600000);
        assert.equal(game._isOfflineSimulating, true, how + ': simulação em curso');
        assert.notEqual(game.onCatch, cbs.catch, how + ': callbacks mudos durante a simulação');
        game.stopBattle();
        if (how === 'import') assert.equal(game.importSave(savedText()).success, true);
        else game.deleteSave();
        assert.equal(game.onBattleEvent, cbs.battle, how);
        assert.equal(game.onCatch, cbs.catch, how);
        assert.equal(game.onLevelUp, cbs.level, how);
        assert.equal(game._savedOnBattleEvent, undefined, how);
        assert.equal(game._savedOnCatch, undefined, how);
        assert.equal(game._savedOnLevelUp, undefined, how);
        assert.equal(game._offlineSummary, null, how);
        assert.equal(game._offlineHunt, null, how);
        assert.equal(game.clock.constructor.name, 'SystemClock', how);
        const snap = () => (game.gameState ? plain({ s: game.gameState.stats, gold: game.gameState.gold, state: game.gameState }) : null);
        const before = snap();
        // Determinístico: é exatamente o que o setTimeout(0) pendente do lote faria. Sem _offlineSimState ele não pode agir.
        game._runOfflineBatch();
        game._runOfflineBatch();
        assert.deepEqual(snap(), before, how + ': um lote pendente executado à mão não muda estado, estatísticas nem ouro');
        assert.equal(game._offlineSimState, null, how);
        assert.equal(game._fastSim, null, how);
        assert.equal(game._isOfflineSimulating, false, how);
        await sleep(120);                                       // além disso, o lote realmente agendado também não age
        assert.deepEqual(snap(), before, how + ': nenhuma recompensa depois do cancelamento');
        assert.equal(game._isOfflineSimulating, false, how);
        game.stopBattle();
    }
});

test('F7.0: importar um save inválido durante a simulação offline falha sem cancelar nem tocar na simulação', async () => {
    const { game } = newGame();
    let ended = null;
    const original = (event, data) => { if (event === 'offlineEnd') ended = data; };
    game.startBattle();
    game.onBattleEvent = original;
    game._processOfflineBattles(600000);
    assert.equal(game._isOfflineSimulating, true, 'a simulação começou');
    // referências da simulação em curso
    const keep = {
        muted: game.onBattleEvent, state: game.gameState, sim: game._offlineSimState, fast: game._fastSim,
        clock: game.clock, summary: game._offlineSummary, savedBattle: game._savedOnBattleEvent,
        savedCatch: game._savedOnCatch, savedLevel: game._savedOnLevelUp, hunt: game._offlineHunt,
    };
    assert.equal(keep.savedBattle, original, 'o callback original está guardado para ser devolvido no fim');
    const source = newGame({ seed: 5 }).game;
    const newer = JSON.stringify({ ...plain(source.gameState), schemaVersion: 999 });   // JSON puro é aceito pelo decodificador
    const rejected = { '': 'empty', '   ': 'empty', 'isto não é um save': 'base64', '{"não":"é um save"}': 'shape', 'LZ:corrompido': null, [newer]: 'newer_version' };
    for (const [bad, code] of Object.entries(rejected)) {
        const r = game.importSave(bad);
        assert.equal(r.success, false, 'rejeitado: ' + JSON.stringify(bad).slice(0, 40));
        assert.equal(typeof r.message, 'string');
        if (code) assert.equal(r.code, code, 'motivo da rejeição: ' + JSON.stringify(bad).slice(0, 40));
        assert.equal(game._isOfflineSimulating, true);
        assert.equal(game.onBattleEvent, keep.muted, 'callback mudo da simulação intacto');
        assert.equal(game._savedOnBattleEvent, keep.savedBattle);
        assert.equal(game._savedOnCatch, keep.savedCatch);
        assert.equal(game._savedOnLevelUp, keep.savedLevel);
        assert.equal(game._offlineSimState, keep.sim);
        assert.equal(game._fastSim, keep.fast);
        assert.equal(game._offlineSummary, keep.summary);
        assert.equal(game._offlineHunt, keep.hunt);
        assert.equal(game.clock, keep.clock);
        assert.equal(game.gameState, keep.state, 'o estado do jogo não foi substituído');
    }
    // a simulação segue viva e termina sozinha, devolvendo o callback e reabrindo a batalha uma vez
    const deadline = Date.now() + 20000;
    while (!ended && Date.now() < deadline) await sleep(10);
    assert.ok(ended, 'a simulação terminou normalmente (offlineEnd recebido)');
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game.onBattleEvent, original, 'callback original devolvido pelo fim normal');
    assert.equal(game.clock.constructor.name, 'SystemClock');
    assert.ok(game.battleTimer, 'a batalha reabriu no fim da simulação');
    game.stopBattle();
});
