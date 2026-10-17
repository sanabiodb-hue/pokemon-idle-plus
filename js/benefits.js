// F9.7 · camada mínima de benefícios (VIP). Única porta de entrada: hasBenefit(state, benefitId); o resto do jogo não olha o save diretamente.
// O marcador local (gameState.account.benefits, lista de ids) é editável pelo jogador: a proteção real exige validação de servidor (fora de escopo aqui;
// também não há pagamento, conta, login nem expiração). BENEFITS_DEV_OVERRIDE concede todos os benefícios conhecidos, para desenvolvimento e testes.

// state: gameState (ou null). Ids desconhecidos nunca valem; save ausente/malformado = sem benefícios.
function hasBenefit(state, benefitId) {
    if (!BENEFIT_IDS.includes(benefitId)) return false;
    if (BENEFITS_DEV_OVERRIDE) return true;
    const list = state && state.account && state.account.benefits;
    return Array.isArray(list) && list.includes(benefitId);
}

// Limpeza do save: só ids conhecidos, sem repetição, na ordem do catálogo. Devolve a lista (vazia = sem benefícios; o campo não é gravado)
function sanitizeBenefits(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.benefits)) return [];
    return BENEFIT_IDS.filter(id => raw.benefits.includes(id));
}
