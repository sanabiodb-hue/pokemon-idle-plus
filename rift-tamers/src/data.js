// Dados do jogo: tipos (elementos), tabela de efetividade, golpes, relíquias da expedição e perks permanentes.
export const TYPES = ['ember', 'tide', 'bloom', 'volt', 'frost', 'stone', 'gale', 'umbra', 'lumen', 'venom'];

export const TYPE_INFO = {
    ember: { name: 'Brasa', hue: 12, color: '#ff6a3d' },
    tide: { name: 'Maré', hue: 205, color: '#3d9bff' },
    bloom: { name: 'Flora', hue: 120, color: '#5fd96a' },
    volt: { name: 'Volt', hue: 52, color: '#ffe14a' },
    frost: { name: 'Gelo', hue: 185, color: '#9ff0ff' },
    stone: { name: 'Rocha', hue: 32, color: '#b59a76' },
    gale: { name: 'Vendaval', hue: 160, color: '#9cf2c8' },
    umbra: { name: 'Umbra', hue: 270, color: '#8a5cff' },
    lumen: { name: 'Lúmen', hue: 45, color: '#ffe9a8' },
    venom: { name: 'Veneno', hue: 305, color: '#d64cff' },
};

// Cada tipo é forte contra dois. O defensor resiste a quem ele mesmo vence (×2 / ×0,5). Única exceção: Umbra e Lúmen se anulam (×2 um no outro).
const STRONG = {
    ember: ['bloom', 'frost'], tide: ['ember', 'stone'], bloom: ['tide', 'stone'], volt: ['tide', 'gale'], frost: ['bloom', 'gale'],
    stone: ['ember', 'volt'], gale: ['bloom', 'venom'], umbra: ['lumen', 'gale'], lumen: ['umbra', 'venom'], venom: ['tide', 'bloom'],
};
export function effectiveness(atk, def) {
    if (STRONG[atk] && STRONG[atk].includes(def)) return 2;
    if (STRONG[def] && STRONG[def].includes(atk)) return 0.5;
    return 1;
}
export function multiEffectiveness(atk, defTypes) { return defTypes.reduce((m, d) => m * effectiveness(atk, d), 1); }

// Energia: cada criatura ganha 2 por turno (máx. 10). Golpes custam 0 (básico), 2 (técnica) ou 5 (supremo): sem PP, mais decisões por turno.
export const MOVE_TEMPLATES = [
    { key: 'strike', cost: 0, power: 38, acc: 1, label: 'Investida' },
    { key: 'art', cost: 2, power: 62, acc: 0.95, label: 'Arte' },
    { key: 'ult', cost: 5, power: 105, acc: 0.85, label: 'Supremo' },
];
export const MOVE_NAMES = {
    ember: ['Faísca', 'Labareda', 'Erupção Solar'], tide: ['Jato', 'Maremoto', 'Abismo Azul'], bloom: ['Espinho', 'Chicote Verde', 'Floresta Viva'],
    volt: ['Choque', 'Trovão Curvo', 'Colapso Elétrico'], frost: ['Cristal', 'Nevasca', 'Zero Absoluto'], stone: ['Pedrada', 'Avalanche', 'Terremoto Mudo'],
    gale: ['Rajada', 'Ciclone', 'Olho da Tempestade'], umbra: ['Sombra', 'Eclipse', 'Vazio Total'], lumen: ['Raio Suave', 'Prisma', 'Alvorada'],
    venom: ['Ferrão', 'Névoa Ácida', 'Praga Rubra'],
};
// Status que a "arte" do tipo pode aplicar (chance 35%).
export const TYPE_STATUS = { ember: 'burn', tide: 'slow', bloom: 'leech', volt: 'stun', frost: 'slow', stone: 'guard', gale: 'haste', umbra: 'curse', lumen: 'heal', venom: 'poison' };
export const STATUS_INFO = {
    burn: { name: 'Queimadura', dot: 0.0625 }, poison: { name: 'Veneno', dot: 0.0625 }, slow: { name: 'Lentidão' }, stun: { name: 'Atordoado' },
    curse: { name: 'Maldição' }, leech: { name: 'Sanguessuga' }, guard: { name: 'Guarda' }, haste: { name: 'Pressa' }, heal: { name: 'Bênção' },
};

// Marés da Fenda: o "clima" do mundo. Rotaciona com o relógio do jogo e reforça (×1,25) o tipo ativo em batalha e nas criaturas que aparecem.
export const TIDES = TYPES.map(t => ({ type: t, name: 'Maré de ' + TYPE_INFO[t].name }));

// Relíquias da expedição (empilháveis, como em roguelikes): cada pegada soma um stack.
export const RELICS = [
    { id: 'fang', name: 'Presa Prismática', desc: '+8% de dano por stack', stat: 'dmg', per: 0.08 },
    { id: 'shell', name: 'Casco de Cristal', desc: '+10% de vida máxima por stack', stat: 'hp', per: 0.10 },
    { id: 'wing', name: 'Pena do Vento', desc: '+8% de velocidade por stack', stat: 'spd', per: 0.08 },
    { id: 'core', name: 'Núcleo de Energia', desc: '+1 de energia por turno a cada 2 stacks', stat: 'energy', per: 0.5 },
    { id: 'lens', name: 'Lente de Foco', desc: '+6% de acerto crítico por stack', stat: 'crit', per: 0.06 },
    { id: 'heart', name: 'Coração Pulsante', desc: 'Cura 6% da vida máxima após cada batalha, por stack', stat: 'regen', per: 0.06 },
    { id: 'orb', name: 'Orbe Magnético', desc: '+12% de chance de captura por stack', stat: 'catch', per: 0.12 },
    { id: 'gold', name: 'Moeda da Fenda', desc: '+15% de Estilhaços por stack', stat: 'shards', per: 0.15 },
];

// Perks permanentes comprados com Estilhaços entre as expedições (meta-progressão).
export const PERKS = [
    { id: 'starter', name: 'Ninho Aprimorado', desc: 'Criaturas iniciais com +2 níveis por nível do perk', max: 5, cost: (n) => 30 + n * 40 },
    { id: 'orbs', name: 'Bolsa de Orbes', desc: '+2 orbes ao iniciar cada expedição por nível', max: 5, cost: (n) => 20 + n * 25 },
    { id: 'relic', name: 'Sorte do Domador', desc: '+1 opção de relíquia (nível 1) e relíquia inicial (nível 2)', max: 2, cost: (n) => 120 + n * 160 },
    { id: 'sanct', name: 'Santuário Eterno', desc: '+25% de produção ociosa por nível', max: 6, cost: (n) => 25 + n * 35 },
    { id: 'rift', name: 'Visão da Fenda', desc: 'Mostra a efetividade dos golpes antes de usar (nível 1) e o tipo inimigo de longe (nível 2)', max: 2, cost: (n) => 60 + n * 120 },
];
