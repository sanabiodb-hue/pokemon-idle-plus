// 自动化 · 个体品质评估（纯函数，不读写游戏状态）
// 品质只由个体值决定：score = 六项个体值之和（0–186），percentage = score / 186，
// grade 按百分比分档。闪光单独用 shiny 字段返回——是否"必捕闪光"属于策略，不混进品质分。

const QUALITY_MAX_SCORE = 31 * 6;
const QUALITY_GRADES = [
    { grade: 'S', min: 90 },
    { grade: 'A', min: 75 },
    { grade: 'B', min: 60 },
    { grade: 'C', min: 40 },
    { grade: 'D', min: 0 },
];

function qualityGradeFor(percentage) {
    for (const g of QUALITY_GRADES) if (percentage >= g.min) return g.grade;
    return 'D';
}

// 接受个体（含 ivs / shiny）或敌人对象；缺失个体值按 0 处理
function calculatePokemonQuality(instance) {
    const ivs = instance && instance.ivs ? instance.ivs : null;
    const score = ivs ? ivTotal(normalizeIvs(ivs)) : 0;
    const percentage = Math.round(score / QUALITY_MAX_SCORE * 1000) / 10;
    return {
        score,
        percentage,
        grade: qualityGradeFor(percentage),
        perfect: isPerfectIvs(ivs),
        shiny: !!(instance && instance.shiny),
    };
}
