// ============================================================
// F8.0 · Central de Caça — lógica PURA (sem DOM, sem estado próprio)
//
// Tudo aqui é derivado, a cada chamada, do estado real do jogo: a sessão de caça (game.getHuntSession) e o status somente leitura do
// controlador do mundo (WorldEncounters.status). Nada é guardado nem copiado: a interface chama estas funções a cada renderização, e os
// testes as chamam direto. As operações continuam sendo as oficiais (dispatchAutomationAction e WorldEncounters.begin); a matriz abaixo
// só diz o que o jogador pode pedir agora e por quê — as próprias operações revalidam, então um clique atrasado nunca vale mais que o estado.
// ============================================================

const HUNT_CENTER_RESULT_LIMIT = 10;

// Busca de espécies do catálogo: mesma regra do mapa — espécie ainda não vista aparece como ??? e só se acha pelo número.
function huntSpeciesMatches(query, pokedex, limit = HUNT_CENTER_RESULT_LIMIT) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { list: [], total: 0 };
    const dex = pokedex || {};
    const out = [];
    let total = 0;
    for (const key of Object.keys(POKEMON_DATA)) {
        const id = Number(key), data = POKEMON_DATA[key], known = dex[id] === 'seen' || dex[id] === 'caught';
        const hit = String(id).includes(q) || (known && data && typeof data.name === 'string' && data.name.toLowerCase().includes(q));
        if (!hit) continue;
        total++;
        if (out.length < limit) out.push({ id, name: known && data.name ? data.name : '???' });
    }
    return { list: out, total };
}

// Retrato do estado real. `enc` é o WorldEncounters (ou null: sem mundo, só a caçada comum por rota).
//   sessionState: 'none' (nunca houve) | 'running' | 'paused' | 'stopped' (parada ou concluída)
//   cycle: null (sem caminhada do mundo) | { speciesId, phase: approaching|arrived|battling|resolved|pending, progressPx, lengthPx, pct, battleBusy, healing }
function huntCenterSnapshot(game, enc) {
    const s = game.getHuntSession ? game.getHuntSession() : null;
    const sessionState = !s ? 'none' : (s.state === 'running' || s.state === 'paused') ? s.state : 'stopped';
    const st = enc && enc.status ? enc.status() : null;
    const cycle = st && st.active ? {
        speciesId: st.speciesId, phase: st.phase, progressPx: st.progressPx, lengthPx: st.lengthPx,
        pct: st.lengthPx > 0 ? Math.min(100, Math.floor(st.progressPx / st.lengthPx * 100)) : 0,
        battleBusy: !!st.battleBusy, healing: !!st.healing,
    } : null;
    const team = game.gameState && game.gameState.team;
    return {
        sessionState,
        stoppedByCondition: !!(s && sessionState === 'stopped' && typeof huntStoppedByCondition === 'function' && huntStoppedByCondition(s)),
        offline: !!game._isOfflineSimulating,
        tower: !!game._towerMode,
        hasTeam: !!(team && team.length > 0),
        cycle,
        lastResult: enc && enc.lastResult ? enc.lastResult : null,
    };
}

// Matriz estado × controle. Cada entrada: { enabled, reason } (reason = por que está desabilitado). Espelha as regras REAIS das operações:
//   START_HUNT  : recusa se já há caçada (running/paused), offline, Torre, política inválida ou sem equipe;
//   begin()     : recusa se já há ciclo, offline, Torre, espécie inválida, sessão PAUSADA; ADOTA uma sessão que já está rodando;
//   PAUSE_HUNT  : só running (e nunca na Torre); RESUME_HUNT: só paused; STOP_HUNT: running ou paused;
//   F8.0        : pausar/retomar/parar manualmente durante a simulação offline também são recusados (ver actions.js).
// A fase do trajeto (caminhando, chegou, em batalha, escolhendo ponto) NÃO muda os controles: pausar com a luta em curso é permitido (a luta
// termina normalmente) e a retomada continua do mesmo ponto; a fase só altera o texto de status.
function huntControlMatrix(snap, targetId) {
    const yes = { enabled: true, reason: null };
    const no = (reason) => ({ enabled: false, reason });
    const active = snap.sessionState === 'running' || snap.sessionState === 'paused';
    const blocked = snap.offline ? 'Aguarde o cálculo offline terminar.' : snap.tower ? 'Saia da Torre de Desafio primeiro.' : null;
    const hasTarget = Number.isInteger(targetId) && targetId >= 1;

    const start = active ? no('Já existe uma caçada em andamento.') : blocked ? no(blocked) : !snap.hasTeam ? no('Monte uma equipe antes de iniciar a caçada.') : yes;

    let startTarget;
    if (!hasTarget) startTarget = no('Escolha uma espécie para caçar.');
    else if (snap.cycle) startTarget = no('Já existe uma caçada ativa em um mapa de caça.');
    else if (snap.sessionState === 'paused') startTarget = no('Retome ou pare a caçada pausada antes de iniciar outra.');
    else if (blocked) startTarget = no(blocked);
    else if (snap.sessionState !== 'running' && !snap.hasTeam) startTarget = no('Monte uma equipe antes de iniciar a caçada.');
    else startTarget = yes;                                              // running sem ciclo: o controlador adota a sessão

    const pause = snap.sessionState !== 'running' ? no('Não há caçada em execução.') : blocked ? no(blocked) : yes;
    const resume = snap.sessionState !== 'paused' ? no('Não há caçada pausada.') : blocked ? no(blocked) : yes;
    const stop = !active ? no('Não há caçada ativa.') : snap.offline ? no('Aguarde o cálculo offline terminar.') : yes;
    // Abrir no Mapa só navega (nunca inicia nem muda a rota). Com um ciclo ativo só abre o mapa DELE: abrir outro cancelaria a caminhada.
    const openMap = hasTarget || snap.cycle ? yes : no('Escolha uma espécie para ver o mapa.');
    return { start, startTarget, pause, resume, stop, openMap };
}

// Espécie exibida: a do ciclo ativo (autoritativa); sem ciclo, a escolhida na interface (só uma seleção, não é estado do jogo).
function huntCenterTargetId(snap, selectedId) {
    return snap.cycle ? snap.cycle.speciesId : (Number.isInteger(selectedId) ? selectedId : null);
}

// Texto de status do alvo, só com dados autoritativos (sem ETA inventado: passos = distância restante ÷ tile).
function huntCenterStatusText(snap, name, tilePx = 16) {
    const c = snap.cycle;
    if (!c) {
        if (snap.sessionState === 'running') return 'Caçada comum por rota em andamento. Iniciar um alvo faz o treinador caminhar até um mapa de caça.';
        if (snap.sessionState === 'paused') return 'Caçada pausada. Retome ou pare para escolher outro alvo.';
        return 'Nenhum alvo ativo. Escolha uma espécie e inicie a caçada.';
    }
    const paused = snap.sessionState === 'paused';
    const steps = Math.max(0, Math.ceil((c.lengthPx - c.progressPx) / tilePx));
    let text;
    if (c.phase === 'approaching') text = paused ? `Pausada, parada a ${c.pct}% do caminho até ${name}.` : `Caminhando até ${name}: ${c.pct}% (faltam ${steps} ${steps === 1 ? 'passo' : 'passos'}).`;
    else if (c.phase === 'arrived') text = paused ? `Pausada: ${name} chegou ao ponto; a batalha começa na retomada.` : c.battleBusy ? 'Chegou ao ponto; aguardando a batalha atual terminar.' : c.healing ? 'Chegou ao ponto; aguardando a recuperação do Pokémon.' : `Chegou ao ponto: a batalha contra ${name} vai começar.`;
    else if (c.phase === 'battling') text = paused ? 'Pausada (a batalha em curso termina normalmente).' : `Batalha contra ${name} em andamento.`;
    else text = paused ? 'Pausada: o próximo ponto será escolhido na retomada.' : 'Escolhendo o próximo ponto.';
    if (snap.offline) text += ' (calculando o tempo offline…)';
    return text;
}
