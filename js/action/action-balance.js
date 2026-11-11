// ============================================================
// F12 · Mundo de Ação 3D · números do balanceamento (funções puras, sem DOM). Contrato: docs/action/CONTRATO.md.
// As CHAVES são fixas (os outros módulos leem); os VALORES são do economista, ajustados com medição (docs/action/balanceamento.md).
// ============================================================
let ACTION_ENABLED = true;
const ACTION_STEP = 1 / 30;                  // passo fixo da simulação (segundos)
const ACTION_BALANCE = {
    // vida sobre a vida oficial do selvagem (o arquétipo de action-horde.js ainda multiplica por 0,7–2,2). Minion: 1–2 golpes básicos
    // no nível da rota; elite: ~8–11 s de foco; chefe: ~45–60 s de foco (medido: docs/action/balanceamento.md)
    hpMul: { minion: 0.25, elite: 4, boss: 11 },
    // 6 minions colados e repostos: o jogador no nível da rota parado cai em ~22 s (mediana); esquivando, bem mais
    enemyDamageMul: 0.15, playerDamageMul: 1,
    // vitórias oficiais (_processVictoryRewards) por abate. Generoso de propósito: quem limita a renda é o teto `rewardCap` abaixo
    rewardCredit: { minion: 0.4, elite: 6, boss: 20 },
    // teto da renda (chave nova, F12): vitórias oficiais por minuto ≤ vitórias/min do idle desta equipe nesta rota × multiplicador.
    // Balde de fichas: enche no ritmo do teto, guarda no máximo `windowSec` segundos de fichas e começa VAZIO (entrar e sair não recarrega).
    // O crédito que não cabe espera no banco até `bankMax`; o que passa disso se perde. Sem estimativa do idle: `fallbackPerMin` vitórias/min.
    rewardCap: { manual: 1.5, auto: 1.05, windowSec: 300, bankMax: 30, fallbackPerMin: 6 },
    limit: { low: 28, medium: 40, high: 60 },               // inimigos vivos por preset de qualidade
    wave: { base: 8, growth: 3, max: 44, eliteEvery: 3, bossAt: 8, rest: 3.5 },
    spawnMinDist: 9, thinkPerStep: 16,
    basicInterval: 0.6, dash: { dist: 3.2, time: 0.18, cd: 2.2, iframes: 0.3 },
    captureHpFrac: 0.35, captureRange: 6, pickupRadius: 2.5, potionCd: 4,
    playerSpeed: 5.2, enemySpeed: 3.0, accel: 28,
};
// Recarga do golpe especial pelo poder (segundos): golpe mais forte demora mais. 60 → 3,5 s · 90 → 4,5 s · 120 → 5,5 s; sempre entre 1 e 12 s
function actionSkillCooldown(power) { const p = Math.max(0, Number(power) || 0); return Math.min(12, Math.max(1, Math.round((1.5 + p / 30) * 10) / 10)); }
// Vida do inimigo no mundo de ação a partir da vida oficial do selvagem
function actionEnemyHp(officialHp, tier) { const m = ACTION_BALANCE.hpMul[tier] || ACTION_BALANCE.hpMul.minion; return Math.max(1, Math.round((Number(officialHp) || 1) * m)); }

// ---------- teto de renda (F12) ----------
// Vitórias oficiais por minuto permitidas: o ritmo do idle (vitórias/h da mesma equipe na mesma rota) × 1,5 (manual) ou × 1,05 (automático)
function actionRewardCapPerMin(idleVictoriesPerHour, auto) {
    const C = ACTION_BALANCE.rewardCap, v = Number(idleVictoriesPerHour);
    const base = Number.isFinite(v) && v > 0 ? v / 60 : C.fallbackPerMin;
    return base * (auto ? C.auto : C.manual);
}
// Balde de fichas do teto: soma capPerMin/60 fichas por segundo, guarda no máximo windowSec segundos delas. Muda e devolve `bucket`.
// O núcleo: a cada passo `actionRewardBucket(b, dt, actionRewardCapPerMin(idle, world.auto))`; ao acertar o crédito,
// `const cost = actionVictoryTokenCost(game.getBaseExpYield(wild.id, wild.level) * wild.level, refExp)`
// `while (credit >= 1 && b.tokens >= cost) { credit--; b.tokens -= cost; vitória oficial }` e depois `credit = Math.min(credit, rewardCap.bankMax)`.
function actionRewardBucket(bucket, dt, capPerMin) {
    const b = bucket || { tokens: 0 }, rate = Math.max(0, Number(capPerMin) || 0) / 60, d = Math.max(0, Number(dt) || 0);
    const t = Number(b.tokens);
    b.tokens = Math.min(rate * ACTION_BALANCE.rewardCap.windowSec, Math.max(0, Number.isFinite(t) ? t : 0) + rate * d);
    return b;
}
// Fichas que UMA vitória oficial gasta: a EXP dela sobre a EXP média de uma vitória da rota (elite e chefe têm nível e espécie acima da rota
// e pagariam mais EXP por vitória; sem isso o teto contado em vitórias deixaria a EXP passar de 2× o idle). Nunca menos de 1 nem mais de 12.
// Os dois argumentos na mesma unidade: getBaseExpYield(id, nível) × nível. Pura.
function actionVictoryTokenCost(wildExpUnits, routeExpUnits) {
    const w = Number(wildExpUnits), r = Number(routeExpUnits);
    if (!(w > 0) || !(r > 0)) return 1;
    return Math.min(12, Math.max(1, w / r));
}
// EXP média (na unidade de actionVictoryTokenCost) de uma vitória na rota: média ponderada pelos pesos de encontro, no meio da faixa de nível
function actionRouteExpUnits(game, route) {
    if (!game || !route || !Array.isArray(route.pokemon) || !route.pokemon.length) return 0;
    let s = 0, wsum = 0;
    for (const p of route.pokemon) {
        const lr = p.levelRange || route.levelRange || [1, 1], lv = Math.round((lr[0] + lr[1]) / 2), w = Number(p.weight) || 0;
        s += w * game.getBaseExpYield(p.id, lv) * lv; wsum += w;
    }
    return wsum > 0 ? s / wsum : 0;
}
// Estimativa do que o modo paga por hora, em vitórias da rota equivalentes (fichas), para um ritmo de abates
// { minionPerMin, elitesPerHour, bossesPerHour, eliteCost, bossCost } (custos em fichas por vitória; 1 se ausentes), cortado pelo teto.
// Serve ao documento, ao teste que trava a renda e ao HUD. Pura.
function actionEstimateVictoriesPerHour(kills, idleVictoriesPerHour, auto) {
    const c = ACTION_BALANCE.rewardCredit, k = kills || {};
    const ec = Math.max(1, Number(k.eliteCost) || 1), bc = Math.max(1, Number(k.bossCost) || 1);
    const credit = (Number(k.minionPerMin) || 0) * 60 * c.minion + (Number(k.elitesPerHour) || 0) * c.elite * ec + (Number(k.bossesPerHour) || 0) * c.boss * bc;
    return Math.min(credit, actionRewardCapPerMin(idleVictoriesPerHour, auto) * 60);
}
// Vitórias por hora do idle desta equipe nesta rota (a referência do teto). Usa a cópia sem cabeça do simulador de caça
// (createSimulationClone + simulateHunt, js/automation/simulation.js): não mexe no jogo de verdade. 0 quando não dá para estimar
// (o teto cai no fallbackPerMin). Chamar ao entrar no modo e a cada subida de nível ou evolução (custa ~20 ms).
function actionIdleVictoriesPerHour(game, routeId, minutes = 5) {
    if (typeof createSimulationClone !== 'function' || typeof simulateHunt !== 'function' || !game || !routeId) return 0;
    try {
        const clone = createSimulationClone(game, routeId, { seed: 20240607 });
        if (!clone) return 0;
        const r = simulateHunt(clone, Math.max(1, minutes) * 60000);
        if (clone.stopBattle) clone.stopBattle();
        return r && r.ok && r.simulatedMs > 0 ? Math.round(r.victories / (r.simulatedMs / 3600000)) : 0;
    } catch (e) {
        return 0;
    }
}
