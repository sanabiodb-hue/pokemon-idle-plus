// 自动化 · 动作系统：决策只产出"动作对象"，由 ActionDispatcher 统一 校验 → 执行 → 发事件。
// 约定：
//   - 每个动作先 validate，通过才 execute；校验失败绝不修改游戏状态，只返回 { ok:false, code, message } 并发 action_rejected。
//   - execute 只调用核心已有的规则（changeRoute / setActivePokemon / processDefeat …），不自己算伤害、经验、奖励。
//   - 除 START_HUNT 外，所有动作都要求有一场"进行中"的狩猎；没有狩猎 = 什么都不执行。
//   - 动作对象是纯数据：{ type, ...参数 }，以后服务器版可以原样序列化传输。

const AUTOMATION_ACTION_TYPES = [
    'START_HUNT', 'PAUSE_HUNT', 'RESUME_HUNT', 'STOP_HUNT',
    'ATTACK', 'HEAL', 'CAPTURE', 'SWITCH_POKEMON', 'CHANGE_ROUTE',
];

const _fail = (code, message) => ({ ok: false, code, message });
const _pass = { ok: true };

function _huntActive(game) {
    const s = game.getHuntSession();
    return s && s.state === 'running' ? s : null;
}

const AUTOMATION_ACTION_HANDLERS = {
    START_HUNT: {
        validate(game, a) {
            const s = game.getHuntSession();
            if (s && (s.state === 'running' || s.state === 'paused')) return _fail('hunt_active', 'Já existe uma caçada em andamento.');
            if (game._isOfflineSimulating) return _fail('offline', 'Não é possível iniciar a caçada durante a simulação offline.');
            if (game._towerMode) return _fail('tower_mode', 'Saia da Torre de Desafio para iniciar a caçada.');
            if (!validateAutomationPolicy(game.getAutomationPolicy()).ok) return _fail('invalid_policy', 'A política de automação é inválida.');
            if (!game.gameState.team || game.gameState.team.length === 0) return _fail('no_party', 'Monte uma equipe antes de iniciar a caçada.');
            if (a.routeId !== undefined) {
                const check = game._checkRouteAccess(a.routeId);
                if (!check.ok) return check;
            }
            return _pass;
        },
        execute(game, a) {
            if (a.routeId !== undefined && a.routeId !== game.gameState.currentRoute) game.changeRoute(a.routeId, 'automation');
            const gs = game.gameState;
            if (!gs.automation) gs.automation = { policy: game.getAutomationPolicy() };
            game._huntSeq = (game._huntSeq || 0) + 1;
            const session = createHuntSession({
                id: 'h' + game.now().toString(36) + game._huntSeq,
                now: game.now(),
                routeId: gs.currentRoute,
                policy: JSON.parse(JSON.stringify(gs.automation.policy)),
                partyUids: (gs.party || []).slice(),
            });
            huntSessionTransition(session, 'running', game.now());
            gs.automation.session = session;
            game._emit('hunt_started', { id: session.id, route: session.routeId });
            game.analyzerBegin(session);
            game.save();
            game._automationSync();
            return { sessionId: session.id };
        },
    },

    PAUSE_HUNT: {
        validate(game) {
            if (!_huntActive(game)) return _fail('no_running_hunt', 'Não há caçada em execução.');
            if (game._towerMode) return _fail('tower_mode', 'Saia da Torre de Desafio antes de pausar a caçada.');
            return _pass;
        },
        execute(game) {
            const s = game.getHuntSession();
            huntSessionTransition(s, 'paused', game.now());
            game._emit('hunt_paused', { id: s.id });
            game.analyzerFlush();
            game.save();
            game._automationSync();
            return {};
        },
    },

    RESUME_HUNT: {
        validate(game) {
            const s = game.getHuntSession();
            if (!s || s.state !== 'paused') return _fail('no_paused_hunt', 'Não há caçada pausada.');
            if (game._towerMode) return _fail('tower_mode', 'Saia da Torre de Desafio para retomar a caçada.');
            return _pass;
        },
        execute(game) {
            const s = game.getHuntSession();
            huntSessionTransition(s, 'running', game.now());
            game._emit('hunt_resumed', { id: s.id });
            game.analyzerFlush();                         // 读档后恢复的会话可能还有没记账的增量
            game.analyzerBegin(s);
            game.save();
            game._automationSync();
            return {};
        },
    },

    STOP_HUNT: {
        validate(game) {
            const s = game.getHuntSession();
            return s && (s.state === 'running' || s.state === 'paused') ? _pass : _fail('no_active_hunt', 'Não há caçada ativa.');
        },
        execute(game, a) {
            const s = game.getHuntSession();
            const reason = HUNT_STOP_REASONS.includes(a.reason) ? a.reason : 'manual';
            huntSessionTransition(s, 'stopped', game.now(), reason);
            game.analyzerFinish(s);
            game._emit('hunt_stopped', { id: s.id, reason, message: huntStopMessage(s), durationMs: huntSessionDurationMs(s, game.now()), stats: { ...s.stats } });
            game.save();
            game._automationSync();
            if (game.onHuntEvent) game.onHuntEvent('stopped', { reason, message: huntStopMessage(s), byCondition: huntStoppedByCondition(s) });
            return { reason };
        },
    },

    // 开始下一场遭遇（战斗循环空闲时）。战斗中的出招仍由核心的战斗循环负责
    ATTACK: {
        validate(game) {
            if (!_huntActive(game)) return _fail('no_running_hunt', 'Não há caçada em execução.');
            if (game._towerMode) return _fail('tower_mode', 'Indisponível na Torre de Desafio.');
            if (game._isOfflineSimulating) return _fail('offline', 'Indisponível durante a simulação offline.');
            if (game.battleTimer || game.healTimer || game._nextBattleTimeout) return _fail('already_engaged', 'Já existe uma batalha em andamento.');
            return _pass;
        },
        execute(game) {
            game.startBattle();
            return {};
        },
    },

    // 对出战宝可梦使用一瓶药水（消耗与回血由核心 usePotion 完成）
    HEAL: {
        validate(game) {
            if (!_huntActive(game)) return _fail('no_running_hunt', 'Não há caçada em execução.');
            if (game._towerMode) return _fail('tower_mode', 'Indisponível na Torre de Desafio.');
            if (!game.currentBattle) return _fail('no_battle', 'Não há batalha em andamento.');
            if (game.getPotions() <= 0) return _fail('no_potions', 'Sem poções.');
            const b = game.currentBattle;
            if (b.playerCurrentHp > 0 && b.playerCurrentHp >= b.playerMaxHp) return _fail('full_hp', 'O Pokémon já está com a vida cheia.');
            return _pass;
        },
        execute(game) {
            const r = game.usePotion('automation');
            return r.ok ? { amount: r.amount, potionsLeft: r.potionsLeft, revived: r.revived } : {};
        },
    },

    // 对一只已被击败、尚未结算的野生宝可梦执行捕获决策。每只只结算一次
    CAPTURE: {
        validate(game, a) {
            if (!_huntActive(game)) return _fail('no_running_hunt', 'Não há caçada em execução.');
            const w = a.wild;
            if (!w || typeof w !== 'object' || !_has(POKEMON_DATA, w.id) || !_isObj(w.ivs)) return _fail('invalid_target', 'Pokémon selvagem inválido.');
            if (w._captureResolved) return _fail('already_resolved', 'Esse Pokémon já foi resolvido.');
            return _pass;
        },
        execute(game, a) {
            const outcome = game.processDefeat(a.wild);
            return { captured: !!outcome, outcome };
        },
    },

    SWITCH_POKEMON: {
        validate(game, a) {
            if (!_huntActive(game)) return _fail('no_running_hunt', 'Não há caçada em execução.');
            if (game._towerMode) return _fail('tower_mode', 'Indisponível na Torre de Desafio.');
            const team = game.gameState.team || [];
            if (!Number.isInteger(a.index) || a.index < 0 || a.index >= team.length) return _fail('invalid_member', 'Membro da equipe inválido.');
            if (a.index === game.gameState.activePokemonIndex) return _fail('already_active', 'Esse Pokémon já está em campo.');
            if (game.healTimer || !game.currentBattle || game.currentBattle.playerCurrentHp <= 0) return _fail('cannot_switch', 'Não é possível trocar agora.');
            return _pass;
        },
        execute(game, a) {
            const from = game.gameState.activePokemonIndex;
            game.setActivePokemon(a.index);
            game._emit('pokemon_switched', { from, to: a.index, reason: typeof a.reason === 'string' ? a.reason.slice(0, 40) : 'automation' });
            return { from, to: a.index };
        },
    },

    CHANGE_ROUTE: {
        validate(game, a) {
            if (!_huntActive(game)) return _fail('no_running_hunt', 'Não há caçada em execução.');
            if (game._towerMode) return _fail('tower_mode', 'Indisponível na Torre de Desafio.');
            const check = game._checkRouteAccess(a.routeId);
            if (!check.ok) return check;
            if (a.routeId === game.gameState.currentRoute) return _fail('same_route', 'Você já está nessa rota.');
            return _pass;
        },
        execute(game, a) {
            const from = game.gameState.currentRoute;
            game.changeRoute(a.routeId, 'automation');
            const s = game.getHuntSession();
            if (s) s.routeId = a.routeId;
            return { from, to: a.routeId };
        },
    },
};

class ActionDispatcher {
    constructor(game) { this.game = game; }

    // 返回 { ok, type, ...结果 } 或 { ok:false, type, code, message }。绝不抛异常
    dispatch(action) {
        const game = this.game;
        const type = action && typeof action.type === 'string' ? action.type : null;
        const handler = type && _has(AUTOMATION_ACTION_HANDLERS, type) ? AUTOMATION_ACTION_HANDLERS[type] : null;
        if (!handler) {
            const res = { ..._fail('unknown_action', 'Ação desconhecida.'), type };
            game._emit('action_rejected', { action: String(type).slice(0, 40), code: res.code });
            return res;
        }
        let check;
        try {
            check = handler.validate(game, action);
        } catch (e) {
            check = _fail('validation_error', 'Falha ao validar a ação.');
            game._emit('automation_error', { action: type, stage: 'validate', message: String(e && e.message).slice(0, 120) });
        }
        if (!check.ok) {
            game._emit('action_rejected', { action: type, code: check.code });
            return { ok: false, type, code: check.code, message: check.message };
        }
        try {
            const result = handler.execute(game, action) || {};
            return { ok: true, type, ...result };
        } catch (e) {
            game._emit('automation_error', { action: type, stage: 'execute', message: String(e && e.message).slice(0, 120) });
            return { ok: false, type, code: 'execution_error', message: 'Falha ao executar a ação.' };
        }
    }
}
