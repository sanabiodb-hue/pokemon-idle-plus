#!/usr/bin/env node
'use strict';
// 用法：node tools/validate-data.js   （有 error 时退出码为 1）
const { loadData } = require('./load-context');
const { validateGameData } = require('./data-validator');

const result = validateGameData(loadData());
const { errors, warnings, stats } = result;

console.log(`校验完成：${stats.pokemon} 只宝可梦 / ${stats.regions} 个地区 / ${stats.routes} 条路线`);
if (warnings.length) {
    const byCode = {};
    warnings.forEach(w => { (byCode[w.code] ||= []).push(w.message); });
    console.log(`\n⚠️  ${warnings.length} 条警告（历史遗留，不阻断）：`);
    for (const [code, list] of Object.entries(byCode)) {
        console.log(`  [${code}] ×${list.length}`);
        list.slice(0, 3).forEach(m => console.log(`     - ${m}`));
        if (list.length > 3) console.log(`     … 还有 ${list.length - 3} 条`);
    }
}
if (errors.length) {
    console.error(`\n❌ ${errors.length} 个错误：`);
    errors.slice(0, 50).forEach(e => console.error(`  [${e.code}] ${e.message}`));
    process.exit(1);
}
console.log('\n✅ 数据校验通过');
