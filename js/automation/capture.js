// 自动化 · 捕获决策（纯函数）：只回答"这只要不要收"，不修改任何状态、不消耗随机数。
// 当前捕获数学不变（一旦决定收，必定成功）；以后加精灵球/捕获率时，只需让决策多返回一个 modifiers。
//
// context: { policy, wild: { id, ivs, shiny }, isNewSpecies }
// 返回 { capture: boolean, reason, priority, quality }
//   reason 取值：capture_disabled | owned_species | always_shiny | new_species | target_species | quality_ok | quality_too_low
//   priority：'shiny' | 'target' | 'normal'（给报告/界面用）
// 规则顺序：闪光优先 → 总开关 → 新物种（图鉴进度）→ 目标物种（跳过品质门槛）→ 品质门槛。
// 目标物种只是"捕获优先级"：非目标照常战斗、拿经验，仍按品质门槛决定是否收。

// F9.7 · veredito PURO sobre a duplicata (espécie que o jogador já tem), usado pela captura de verdade (_applyCapture) e pela checagem antes de gastar a bola,
// para as duas regras nunca divergirem. Devolve { verdict: 'accept' | 'reject' | 'roll', reason }; 'roll' = decidir com UM sorteio (só política all, não shiny).
// c: { policy: 'all'|'better'|'off', hasLive, count, cap, shiny, wildTotal, ownedTotals[] }
function duplicateVerdict(c) {
    if (!c.hasLive) return c.policy === 'off' ? { verdict: 'reject', reason: 'duplicate_policy_off' } : { verdict: 'accept', reason: 'archive_only' };
    if (c.policy === 'off') return { verdict: 'reject', reason: 'duplicate_policy_off' };
    if (c.shiny) return { verdict: 'accept', reason: 'shiny' };
    if (c.count >= c.cap) return { verdict: 'reject', reason: 'duplicate_species_cap' };
    if (c.policy === 'better') return c.ownedTotals.every(t => c.wildTotal > t) ? { verdict: 'accept', reason: 'better' } : { verdict: 'reject', reason: 'duplicate_not_better' };
    return { verdict: 'roll', reason: 'chance' };
}

function shouldCapture(context) {
    context = context || {};
    const policy = context.policy ? context.policy : defaultAutomationPolicy();
    const wild = context.wild ? context.wild : {};
    const cap = policy.capture;
    const quality = calculatePokemonQuality({ ivs: wild.ivs, shiny: !!wild.shiny });
    const result = (capture, reason, priority) => ({ capture, reason, priority, quality });

    if (wild.shiny && cap.alwaysShiny) return result(true, 'always_shiny', 'shiny');
    if (!cap.enabled) return result(false, 'capture_disabled', 'normal');
    // F9.6: poupar bola — espécie que o jogador já possui não é nem tentada (sem bola, sem sorteio). Shiny sempre segue as regras normais.
    if (cap.skipOwnedSpecies && !context.isNewSpecies && !wild.shiny) return result(false, 'owned_species', 'normal');
    if (context.isNewSpecies && cap.alwaysNewSpecies) return result(true, 'new_species', 'normal');
    if (policyTargetsSpecies(policy, wild.id)) return result(true, 'target_species', 'target');
    if (quality.percentage >= cap.minQualityPercent) return result(true, 'quality_ok', 'normal');
    return result(false, 'quality_too_low', 'normal');
}
