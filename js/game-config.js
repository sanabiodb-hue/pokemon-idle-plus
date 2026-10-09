// ============================================================
// 游戏配置数据 - 徽章、宝石、树果系统
// ============================================================

// ===================== 基础常量 =====================
const MAX_POKEMON_LEVEL = 9999; // 宝可梦等级上限

// 重复捕获：已拥有的物种再次遇到时，是否把野生个体收为一只新的独立个体
//   all    = 以 DUPLICATE_CAPTURE_RATE 的概率捕获（默认）
//   better = 只有个体值总和高于已拥有的所有同种个体时才捕获
//   off    = 不捕获重复（旧版行为：只提升主个体的个体值）
// 闪光个体不受概率限制（始终捕获，除非策略为 off 或 PC 已满）。
const CAPTURE_DUPLICATE_POLICIES = ['all', 'better', 'off'];
const DEFAULT_CAPTURE_DUPLICATE_POLICY = 'all';
const DUPLICATE_CAPTURE_RATE = 0.05;
// 同一物种最多这么多只个体时，不再自动收普通（非闪光）重复，避免长时间挂机把 PC 塞满。闪光不受限制。
const DUPLICATE_SPECIES_CAP = 20;

// ===================== 消耗品：药水（阶段 5A 的第一个消耗品）=====================
const INITIAL_POTIONS = 10;          // 新玩家（以及还没有 inventory 的旧存档）的初始药水数
const MAX_POTIONS = 99999;           // 存档清洗上限
const POTION_HEAL_PERCENT = 0.5;     // 一瓶药水回复出战宝可梦最大生命的比例
function potionHealAmount(maxHp, percent = POTION_HEAL_PERCENT) { return Math.max(1, Math.ceil(maxHp * percent)); }

// ===================== 徽章配置 =====================
const BADGE_DATA = {
    kanto: {
        name: 'Insígnia de Kanto',
        icon: '🏅',
        description: 'Obtida ao completar Kanto.',
        effect: 'Libera Moedas: derrotar Pokémon dá Moedas.',
        effectType: 'unlock_gold',
    },
    johto: {
        name: 'Insígnia de Johto',
        icon: '🎖️',
        description: 'Obtida ao completar a Pokédex de Johto.',
        effect: 'Moedas ganhas +100%',
        effectType: 'gold_bonus',
        value: 1.0, // +100%
    },
    hoenn: {
        name: 'Insígnia de Hoenn',
        icon: '🌟',
        description: 'Obtida ao completar a Pokédex de Hoenn.',
        effect: 'EXP ganha +50%',
        effectType: 'exp_bonus',
        value: 0.5, // +50%
    },
    sinnoh: {
        name: 'Insígnia de Sinnoh',
        icon: '💎',
        description: 'Obtida ao completar a Pokédex de Sinnoh.',
        effect: 'Chance de Pokémon Shiny +100%',
        effectType: 'shiny_bonus',
        value: 1.0, // +100% (闪光概率翻倍)
    },
    unova: {
        name: 'Insígnia de Unova',
        icon: '⚡',
        description: 'Obtida ao completar a Pokédex de Unova.',
        effect: 'Pokémon 6V e Shiny já obtidos aparecem menos.',
        effectType: 'completed_weight_reduce',
        value: 9 / 10, // 权重减少 9/10
    },
    kalos: {
        name: 'Insígnia de Kalos',
        icon: '🌸',
        description: 'Obtida ao completar a Pokédex de Kalos.',
        effect: 'Frutas amadurecem na metade do tempo.',
        effectType: 'berry_time_bonus',
        value: 0.5, // 成熟时间 ×0.5（减半）
    },
    alola: {
        name: 'Insígnia de Alola',
        icon: '🌺',
        description: 'Obtida ao completar a Pokédex de Alola.',
        effect: 'Gemas tendem a vir com atributos mais altos.',
        effectType: 'gem_value_bonus',
        value: 0.5, // 属性值在 min~max 范围内偏向高值（加权50%）
    },
    galar: {
        name: 'Insígnia de Galar',
        icon: '⚙️',
        description: 'Obtida ao completar a Pokédex de Galar.',
        effect: 'Colheita de Frutas em dobro.',
        effectType: 'berry_yield_bonus',
        value: 2, // 收获数量 ×2
    },
    paldea: {
        name: 'Insígnia de Paldea',
        icon: '💎',
        description: 'Obtida ao completar a Pokédex de Paldea.',
        effect: 'Tempo offline máximo sobe para 48 h.',
        effectType: 'offline_time_bonus',
        value: 48 * 60 * 60 * 1000, // 48小时（毫秒）
    },
    mega: {
        name: 'Insígnia Mega',
        icon: '🔥',
        description: 'Obtida ao completar a Pokédex da Mega Evolução.',
        effect: 'EXP dos Pokémon da Pokédex +50%.',
        effectType: 'pokedex_exp_bonus',
        value: 0.5, // +50%
    },
};

// ===================== 宝石系统配置 =====================
const GEM_QUALITIES = [
    { id: 'common',    name: 'Comum', color: '#a0a0a0', attrCount: 1, weight: 10000, price: 100 },
    { id: 'magic',     name: 'Mágica', color: '#2ecc71', attrCount: 2, weight: 1000, price: 300 },
    { id: 'rare',      name: 'Rara', color: '#3498db', attrCount: 3, weight: 100, price: 800 },
    { id: 'epic',      name: 'Épica', color: '#9b59b6', attrCount: 4, weight: 10,  price: 2000 },
    { id: 'mythic',    name: 'Mítica', color: '#f39c12', attrCount: 5, weight: 1,  price: 5000 },
    { id: 'legendary', name: 'Lendária', color: '#e74c3c', attrCount: 6, weight: 0.1, price: 10000 },
    { id: 'eternal',   name: 'Eterna', color: '#00d2ff', attrCount: 8, weight: 0.01, price: 25000 },
];

const GEM_ATTRIBUTES = [
    { id: 'crit_rate',       name: 'Chance de Crítico',         min: 1,  max: 5,  unit: '%',  icon: '💥' },
    { id: 'hp_bonus',        name: 'HP',               min: 1,  max: 5,  unit: '%',  icon: '❤️' },
    { id: 'atk_bonus',       name: 'Ataque',               min: 1,  max: 5,  unit: '%',  icon: '⚔️' },
    { id: 'def_bonus',       name: 'Defesa',               min: 1,  max: 5,  unit: '%',  icon: '🛡️' },
    { id: 'speed_bonus',     name: 'Velocidade',                 min: 1,  max: 5,  unit: '%',  icon: '💨' },
    { id: 'dodge_rate',      name: 'Chance de Esquiva',             min: 1,  max: 5,  unit: '%',  icon: '💫' },
];

const GEM_BAG_MAX = 100;

// ===================== 树果系统配置 =====================
const BERRY_DATA = {
    hp_berry:    { id: 'hp_berry',    name: 'Fruta HP',  icon: '🍎', stat: 'hp',    color: '#e74c3c' },
    atk_berry:   { id: 'atk_berry',   name: 'Fruta de Ataque',  icon: '🍊', stat: 'atk',   color: '#e67e22' },
    def_berry:   { id: 'def_berry',   name: 'Fruta de Defesa',  icon: '🍋', stat: 'def',   color: '#f1c40f' },
    spAtk_berry: { id: 'spAtk_berry', name: 'Fruta de Atq. Esp.',  icon: '🍇', stat: 'spAtk', color: '#9b59b6' },
    spDef_berry: { id: 'spDef_berry', name: 'Fruta de Def. Esp.',  icon: '🫐', stat: 'spDef', color: '#3498db' },
    speed_berry: { id: 'speed_berry', name: 'Fruta de Velocidade',  icon: '🍑', stat: 'speed', color: '#2ecc71' },
};
const BERRY_SEED_PRICE = 50000;      // 种子价格（金币）
const BERRY_PLOT_MAX = 10;           // 最大种植空地
const BERRY_GROW_TIME = 5 * 60 * 60 * 1000; // 5小时成熟（毫秒）
const BERRY_STAT_BONUS = 5;          // 每个树果增加种族值基础数值+5
const BERRY_STAT_CAP = 255;          // 每只宝可梦单独种族值上限255

// ===================== 技能系统配置 =====================
const SKILL_LEVEL_REQUIREMENT = 1000; // 升级技能所需最低等级
const MAX_SKILL_LEVEL = 8;            // 技能最大等级

// 每个属性8个等级的技能，严格按伤害递增排列（招式名和威力参考官方原版数据）
// 技能等级>0时，战斗中使用对应技能替代固定威力50
const SKILL_DATA = {
    normal: [
        { level: 1,  name: 'Swift',   power: 60  },
        { level: 2,  name: 'Cut',       power: 70  },
        { level: 3,  name: 'Strength',       power: 80  },
        { level: 4,  name: 'Rock Climb',       power: 90  },
        { level: 5,  name: 'Hyper Drill',     power: 100 },
        { level: 6,  name: 'Double-Edge',   power: 120 },
        { level: 7,  name: 'Hyper Voice',     power: 140 },
        { level: 8,  name: 'Hyper Beam',   power: 150 },
    ],
    fire: [
        { level: 1,  name: 'Flame Wheel',     power: 60  },
        { level: 2,  name: 'Fire Punch',     power: 75  },
        { level: 3,  name: 'Blaze Kick',     power: 85  },
        { level: 4,  name: 'Heat Wave',       power: 95  },
        { level: 5,  name: 'Fire Blast',   power: 110 },
        { level: 6,  name: 'Flare Blitz',   power: 120 },
        { level: 7,  name: 'Overheat',       power: 130 },
        { level: 8,  name: 'Blast Burn',   power: 150 },
    ],
    water: [
        { level: 1,  name: 'Water Pulse',   power: 60  },
        { level: 2,  name: 'Aqua Cutter',     power: 70  },
        { level: 3,  name: 'Scald',       power: 80  },
        { level: 4,  name: 'Surf',       power: 90  },
        { level: 5,  name: 'Crabhammer',     power: 100 },
        { level: 6,  name: 'Hydro Cannon',   power: 110 },
        { level: 7,  name: 'Wave Crash',     power: 120 },
        { level: 8,  name: 'Hydro Pump',       power: 150 },
    ],
    electric: [
        { level: 1,  name: 'Shock Wave',     power: 60  },
        { level: 2,  name: 'Thunder Punch',     power: 75  },
        { level: 3,  name: 'Discharge',       power: 80  },
        { level: 4,  name: 'Thunderbolt',   power: 90  },
        { level: 5,  name: 'Thunder',       power: 110 },
        { level: 6,  name: 'Zap Cannon',     power: 120 },
        { level: 7,  name: 'Bolt Strike',       power: 130 },
        { level: 8,  name: 'Electro Shot',     power: 150 },
    ],
    grass: [
        { level: 1,  name: 'Magical Leaf',     power: 60  },
        { level: 2,  name: 'Giga Drain',   power: 75  },
        { level: 3,  name: 'Seed Bomb',   power: 80  },
        { level: 4,  name: 'Energy Ball',     power: 90  },
        { level: 5,  name: 'Leaf Blade',       power: 90  },
        { level: 6,  name: 'Power Whip',   power: 120 },
        { level: 7,  name: 'Leaf Storm',   power: 130 },
        { level: 8,  name: 'Frenzy Plant',   power: 150 },
    ],
    ice: [
        { level: 1,  name: 'Aurora Beam',     power: 65  },
        { level: 2,  name: 'Ice Punch',     power: 75  },
        { level: 3,  name: 'Icicle Crash',   power: 85  },
        { level: 4,  name: 'Ice Beam',   power: 90  },
        { level: 5,  name: 'Ice Hammer',       power: 100 },
        { level: 6,  name: 'Glacial Lance',       power: 120 },
        { level: 7,  name: 'Ice Burn',   power: 140 },
        { level: 8,  name: 'Freeze Shock',   power: 150 },
    ],
    fighting: [
        { level: 1,  name: 'Rolling Kick',     power: 60  },
        { level: 2,  name: 'Circle Throw',     power: 70  },
        { level: 3,  name: 'Aura Sphere',     power: 80  },
        { level: 4,  name: 'Sacred Sword',       power: 90 },
        { level: 5,  name: 'Flying Press',   power: 100 },
        { level: 6,  name: 'Superpower',       power: 120 },
        { level: 7,  name: 'High Jump Kick',     power: 130 },
        { level: 8,  name: 'Meteor Assault',   power: 150 },
    ],
    poison: [
        { level: 1,  name: 'Venoshock',   power: 65  },
        { level: 2,  name: 'Cross Poison',   power: 70  },
        { level: 3,  name: 'Poison Jab',       power: 80  },
        { level: 4,  name: 'Sludge Bomb',   power: 90  },
        { level: 5,  name: 'Sludge Wave',     power: 95  },
        { level: 6,  name: 'Noxious Torque',   power: 100  },
        { level: 7,  name: 'Belch',       power: 120 },
        { level: 8,  name: 'Gunk Shot',   power: 150 },
    ],
    ground: [
        { level: 1,  name: 'Bulldoze',      power: 60  },
        { level: 2,  name: 'Mud Bomb',   power: 65  },
        { level: 3,  name: 'Stomping Tantrum',     power: 75  },
        { level: 4,  name: 'Dig',       power: 80  },
        { level: 5,  name: 'Earth Power',   power: 90  },
        { level: 6,  name: 'Earthquake',      power: 100  },
        { level: 7,  name: 'Headlong Rush',   power: 120 },
        { level: 8,  name: 'Precipice Blades',   power: 150 },
    ],
    flying: [
        { level: 1,  name: 'Wing Attack',   power: 60  },
        { level: 2,  name: 'Air Slash',     power: 75  },
        { level: 3,  name: 'Fly',       power: 90  },
        { level: 4,  name: 'Aeroblast',   power: 100 },
        { level: 5,  name: 'Hurricane',       power: 110 },
        { level: 6,  name: 'Brave Bird',   power: 120 },
        { level: 7,  name: 'Dragon Ascent',   power: 130 },
        { level: 8,  name: 'Sky Attack',   power: 150 },
    ],
    psychic: [
        { level: 1,  name: 'Psybeam',   power: 65  },
        { level: 2,  name: 'Psycho Cut',   power: 70  },
        { level: 3,  name: 'Zen Headbutt',   power: 80  },
        { level: 4,  name: 'Psychic',   power: 90  },
        { level: 5,  name: 'Psystrike',   power: 100 },
        { level: 6,  name: 'Future Sight',   power: 110 },
        { level: 7,  name: 'Synchronoise',   power: 130 },
        { level: 8,  name: 'Prismatic Laser',   power: 160 },
    ],
    bug: [
        { level: 1,  name: 'Bug Bite',       power: 60  },
        { level: 2,  name: 'U-turn',   power: 70  },
        { level: 3,  name: 'X-Scissor',     power: 80  },
        { level: 4,  name: 'First Impression',   power: 90  },
        { level: 5,  name: 'Bug Buzz',       power: 100  },
        { level: 6,  name: 'Attack Order',   power: 110  },
        { level: 7,  name: 'Pollen Puff',     power: 120  },
        { level: 8,  name: 'Megahorn',   power: 150  },
    ],
    rock: [
        { level: 1,  name: 'Ancient Power',   power: 60  },
        { level: 2,  name: 'Rock Slide',       power: 75  },
        { level: 3,  name: 'Power Gem',   power: 80  },
        { level: 4,  name: 'Mighty Cleave',   power: 95  },
        { level: 5,  name: 'Diamond Storm',   power: 100 },
        { level: 6,  name: 'Meteor Beam',   power: 120 },
        { level: 7,  name: 'Head Smash',   power: 130 },
        { level: 8,  name: 'Rock Wrecker',     power: 150 },
    ],
    ghost: [
        { level: 1,  name: 'Shadow Punch',     power: 60  },
        { level: 2,  name: 'Shadow Claw',     power: 70  },
        { level: 3,  name: 'Shadow Ball',     power: 80  },
        { level: 4,  name: 'Shadow Bone',   power: 85  },
        { level: 5,  name: 'Phantom Force',   power: 90  },
        { level: 6,  name: 'Moongeist Beam',   power: 100 },
        { level: 7,  name: 'Shadow Force',    power: 120 },
        { level: 8,  name: 'Astral Barrage',       power: 150 },
    ],
    dragon: [
        { level: 1,  name: 'Dragon Breath',       power: 60  },
        { level: 2,  name: 'Dragon Claw',       power: 80  },
        { level: 3,  name: 'Dragon Hammer',       power: 90  },
        { level: 4,  name: 'Dragon Rush',   power: 100 },
        { level: 5,  name: 'Outrage',       power: 120 },
        { level: 6,  name: 'Draco Meteor',     power: 130 },
        { level: 7,  name: 'Roar of Time',   power: 150 },
        { level: 8,  name: 'Eternabeam',   power: 160 },
    ],
    dark: [
        { level: 1,  name: 'Bite',       power: 60  },
        { level: 2,  name: 'Night Slash',   power: 70  },
        { level: 3,  name: 'Crunch',       power: 80  },
        { level: 4,  name: 'Dark Pulse',   power: 90  },
        { level: 5,  name: 'Night Daze',   power: 100  },
        { level: 6,  name: 'Fiery Wrath',   power: 110  },
        { level: 7,  name: 'Darkest Lariat',   power: 120 },
        { level: 8,  name: 'Hyperspace Fury', power: 150 },
    ],
    steel: [
        { level: 1,  name: 'Double Iron Bash',   power: 60  },
        { level: 2,  name: 'Steel Wing',      power: 70  },
        { level: 3,  name: 'Iron Head',      power: 80  },
        { level: 4,  name: 'Meteor Mash',    power: 90  },
        { level: 5,  name: 'Iron Tail',      power: 100  },
        { level: 6,  name: 'Make It Rain',     power: 120 },
        { level: 7,  name: 'Doom Desire',   power: 140 },
        { level: 8,  name: 'Gigaton Hammer',     power: 160 },
    ],
    fairy: [
        { level: 1,  name: 'Fairy Wind',   power: 60  },
        { level: 2,  name: 'Disarming Voice',   power: 70  },
        { level: 3,  name: 'Draining Kiss',   power: 80  },
        { level: 4,  name: 'Dazzling Gleam',   power: 90  },
        { level: 5,  name: 'Play Rough',       power: 100  },
        { level: 6,  name: 'Moonblast',   power: 110  },
        { level: 7,  name: 'Fleur Cannon', power: 130 },
        { level: 8,  name: 'Light of Ruin',   power: 150 },
    ],
};

// ===================== 天赋系统配置 =====================
const TALENT_RESET_COST = 1000000; // 重置天赋花费100万金币
const TALENT_MAX_LEVEL = 100;      // 天赋最大等级
const TALENT_DATA = {
    exp_bonus: {
        id: 'exp_bonus',
        name: 'EXP extra',
        icon: '📚',
        description: 'Derrotar Pokémon dá EXP extra.',
        maxLevel: 100,
        perLevel: 1,
        unit: '%',
        category: 'growth',
    },
    gold_bonus: {
        id: 'gold_bonus',
        name: 'Moedas extras',
        icon: '🪙',
        description: 'Derrotar Pokémon dá Moedas extras.',
        maxLevel: 100,
        perLevel: 1,
        unit: '%',
        category: 'growth',
    },
    shiny_bonus: {
        id: 'shiny_bonus',
        name: 'Chance Shiny extra',
        icon: '✨',
        description: 'Aumenta a chance de encontrar Pokémon Shiny.',
        maxLevel: 100,
        perLevel: 1,
        unit: '%',
        category: 'growth',
    },
    gem_common_reduce: {
        id: 'gem_common_reduce',
        name: 'Menos Gemas comuns',
        icon: '💎',
        description: 'Reduz a chance de vir uma Gema Comum ao comprar Gemas.',
        maxLevel: 100,
        perLevel: 1,
        unit: '%',
        category: 'resource',
    },
    berry_time_reduce: {
        id: 'berry_time_reduce',
        name: 'Frutas mais rápidas',
        icon: '🌱',
        description: 'Reduz o tempo de maturação das Frutas.',
        maxLevel: 100,
        perLevel: 1,
        unit: ' min',
        category: 'resource',
    },
    crit_damage_bonus: {
        id: 'crit_damage_bonus',
        name: 'Dano crítico extra',
        icon: '💥',
        description: 'Aumenta o multiplicador de dano crítico (base de 150%).',
        maxLevel: 100,
        perLevel: 1,
        unit: '%',
        category: 'battle',
    },
    team_exp_bonus: {
        id: 'team_exp_bonus',
        name: 'Nível selvagem maior',
        icon: '👥',
        description: 'Aumenta o nível dos Pokémon selvagens. No máximo, todos os Pokémon do mapa ficam no Lv.30000 (exceto na Torre de Desafio; quem passa do Lv.30000 não é afetado).',
        maxLevel: 100,
        perLevel: 1,
        unit: '',
        category: 'growth',
    },
    pokedex_exp_bonus: {
        id: 'pokedex_exp_bonus',
        name: 'EXP da Pokédex extra',
        icon: '📖',
        description: 'Pokémon capturados fora da equipe ganham EXP extra.',
        maxLevel: 100,
        perLevel: 1,
        unit: '%',
        category: 'growth',
    },
    skill_stat_bonus: {
        id: 'skill_stat_bonus',
        name: 'Todos os atributos',
        icon: '⚡',
        description: 'Aumenta todos os atributos dos Pokémon (%) conforme a soma dos níveis das Técnicas.',
        maxLevel: 100,
        perLevel: 0.0002,
        unit: '%',
        category: 'battle',
        special: 'Soma dos níveis das Técnicas × 0,0002% por nível',
    },
    gem_attr_boost: {
        id: 'gem_attr_boost',
        name: 'Atributo de Gema favorito',
        icon: '🔮',
        description: 'Escolha um atributo de Gema para aumentar a chance de ele aparecer.',
        maxLevel: 100,
        perLevel: 1,
        unit: '%',
        category: 'resource',
        special: 'Escolha um atributo alvo',
    },
};

// 天赋分类
const TALENT_CATEGORIES = {
    growth: { name: 'Crescimento', icon: '📈' },
    battle: { name: 'Batalha', icon: '⚔️' },
    resource: { name: 'Recursos', icon: '💰' },
};

// ===================== 挑战塔配置 =====================
const TOWER_MAX_FLOOR = 255;            // 最高层数
const TOWER_ENEMIES_PER_FLOOR = 6;      // 每层敌人数量
const TOWER_BASE_LEVEL = 18000;         // 第1层怪物等级
const TOWER_LEVEL_INCREMENT = 1000;      // 每层等级递增
const TOWER_MIN_BASE_STAT_TOTAL = 500;  // 候选怪物种族值总和下限

// ===================== 离线模拟配置 =====================
const MAX_OFFLINE_TIME = 24 * 60 * 60 * 1000;  // 离线模拟上限24小时（毫秒）
const OFFLINE_BATCH_SIZE = 200;                  // 每批模拟战斗数

// ===================== 地区图鉴范围（唯一来源） =====================
// 各地区宝可梦编号区间。核心逻辑、UI、数据校验都从这里读取，避免多处硬编码。
const REGION_POKEDEX_RANGES = {
    kanto:  [1, 151],
    johto:  [152, 251],
    hoenn:  [252, 386],
    sinnoh: [387, 493],
    unova:  [494, 649],
    kalos:  [650, 721],
    alola:  [722, 809],
    galar:  [810, 905],
    paldea: [906, 1025],
    mega:   [1026, 1073],
};

// ===================== 战斗/进度公共常量（在线与离线共用） =====================
const BASE_CRIT_RATE = 0.05;            // 基础会心率（在线/离线统一）
const BASE_CRIT_MULTIPLIER = 1.5;       // 基础会心倍率
const BASE_SHINY_RATE = 1 / 4096;       // 基础闪光概率
const DEFEAT_HEAL_PERCENT_PER_SEC = 0.2; // 战败后每秒回复最大生命的比例
const VICTORY_HEAL_PERCENT = 0.1;       // 胜利后回复最大生命的比例
const TEAM_EXP_RATE = 0.5;              // 队伍其他成员获得的经验比例
const RESERVE_EXP_RATE = 0.01;          // 图鉴其余宝可梦获得的经验比例
const NEXT_BATTLE_MAX_DELAY_MS = 800;   // 两场战斗之间的最大间隔

// ===================== 存档配置 =====================
const SAVE_KEY = 'pokemon_idle_save';
const SAVE_SCHEMA_VERSION = 3;          // 当前存档结构版本（v1=无版本号的旧存档，v2=第1阶段，v3=个体名册）
const SAVE_DEBOUNCE_MS = 2000;          // 防抖：最后一次请求后 2 秒写入
const SAVE_MAX_WAIT_MS = 10000;         // 防抖上限：持续请求时最迟 10 秒写入
const SAVE_BACKUP_COUNT = 3;            // 轮转备份份数
const SAVE_BACKUP_INTERVAL_MS = 10 * 60 * 1000; // 自动备份最小间隔
const SAVE_IMPORT_MAX_CHARS = 30 * 1000 * 1000; // 导入文本长度上限
const DEFEAT_HEAL_MS = Math.ceil(1 / DEFEAT_HEAL_PERCENT_PER_SEC) * 1000; // 从 0 血回满所需时间（仅当 20% 整除最大生命时精确；实际时长用 defeatHealMs）

// F7.8: duração OFICIAL da recuperação após derrota (online, pré-simulação offline e Fast Driver usam a mesma conta).
// A cada segundo recupera-se max(1, floor(maxHp x 20%)) de vida; o tempo é o nº de segundos até encher.
function defeatHealMs(maxHp, currentHp = 0) {
    if (!(maxHp > 0)) return 0;
    const missing = Math.max(0, maxHp - Math.max(0, currentHp));
    const perSecond = Math.max(1, Math.floor(maxHp * DEFEAT_HEAL_PERCENT_PER_SEC));
    return Math.ceil(missing / perSecond) * 1000;
}
