// Ferramenta de teste manual da automação (antes da aba "Caça" existir): use no console do navegador.
//   caca.iniciar({ capture: { minQualityPercent: 60 }, route: { mode: 'switchWhenComplete' } })   // a interface oficial agora é a aba Caça
//   caca.status()      caca.eventos(20)      caca.pausar()   caca.retomar()   caca.parar()
//   caca.politica()    (política atual)      caca.politica({ ... })  (altera, valida antes de salvar)
// Não decide nada: só chama a API pública do GameCore (dispatchAutomationAction / setAutomationPolicy).
// A interface final virá na aba "Caça"; este arquivo é descartável.

const caca = {
    _game() { return typeof game !== 'undefined' ? game : null; },

    iniciar(politica, routeId) {
        const g = this._game();
        if (!g) return 'O jogo ainda não carregou.';
        if (politica) {
            const r = g.setAutomationPolicy(politica);
            if (!r.ok) return { ok: false, erros: r.errors.map(e => `${e.path || '(raiz)'}: ${e.message}`) };
        }
        const r = g.dispatchAutomationAction(routeId ? { type: 'START_HUNT', routeId } : { type: 'START_HUNT' });
        return r.ok ? 'Caçada iniciada.' : `Não foi possível iniciar: ${r.message}`;
    },
    pausar() { return this._acao('PAUSE_HUNT', 'Caçada pausada.'); },
    retomar() { return this._acao('RESUME_HUNT', 'Caçada retomada.'); },
    parar() { return this._acao('STOP_HUNT', 'Caçada encerrada.'); },
    _acao(type, ok) {
        const g = this._game();
        if (!g) return 'O jogo ainda não carregou.';
        const r = g.dispatchAutomationAction({ type });
        return r.ok ? ok : `Não foi possível: ${r.message}`;
    },

    politica(nova) {
        const g = this._game();
        if (!g) return 'O jogo ainda não carregou.';
        if (nova === undefined) return JSON.parse(JSON.stringify(g.getAutomationPolicy()));
        const r = g.setAutomationPolicy(nova);
        return r.ok ? 'Política salva.' : { ok: false, erros: r.errors.map(e => `${e.path || '(raiz)'}: ${e.message}`) };
    },

    status() {
        const g = this._game();
        const s = g && g.getHuntSession();
        if (!s) return 'Nenhuma caçada configurada.';
        return {
            estado: s.state, motivoParada: s.stopReason, rota: s.routeId,
            duracaoSegundos: Math.round(huntSessionDurationMs(s, g.now()) / 1000),
            batalhas: s.stats.battles, vitorias: s.stats.victories, derrotas: s.stats.defeats,
            capturas: s.stats.captures, shinies: s.stats.shinies, xp: s.stats.xp, dinheiro: s.stats.money,
        };
    },

    eventos(n = 20) {
        const g = this._game();
        if (!g) return [];
        const quiet = new Set(['xp_gained', 'pokemon_defeated', 'capture_attempted']);
        return g.bus.recent(200).filter(e => !quiet.has(e.type)).slice(-n).map(e => {
            const { seq, t, type, ...resto } = e;
            return `${new Date(t).toLocaleTimeString('pt-BR')} ${type} ${JSON.stringify(resto)}`;
        });
    },
};
