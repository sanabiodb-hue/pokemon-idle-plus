#!/usr/bin/env node
'use strict';
// ============================================================
// 浏览器冒烟测试（“构建测试”）：用无头 Chromium 真实加载 index.html。
// 本项目没有构建步骤，所以这里验证：所有脚本能加载、游戏能启动并自动战斗、
// 存档/备份/离线结算/导入安全/保存失败提示在真实浏览器里都工作。
// 依赖：playwright（全局或本地安装均可）；找不到则跳过（退出码 0）。
// 用法：node tests/smoke/smoke.js
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

function loadPlaywright() {
    const candidates = [() => require('playwright')];
    try {
        const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        candidates.push(() => require(path.join(globalRoot, 'playwright')));
    } catch (e) { /* ignore */ }
    for (const c of candidates) { try { return c(); } catch (e) { /* try next */ } }
    return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = decodeURIComponent(req.url.split('?')[0]);
            const file = path.join(ROOT, url === '/' ? 'index.html' : url);
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ' — ' + detail}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    const pw = loadPlaywright();
    if (!pw) {
        console.log('⏭  未找到 playwright，跳过浏览器冒烟测试（npm i -D playwright 后可启用）');
        process.exit(0);
    }
    const server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}/`;
    const browser = await pw.chromium.launch();
    const errors = [];

    async function newPage(initScript) {
        const context = await browser.newContext({ viewport: { width: 480, height: 900 } });
        const page = await context.newPage();
        page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
        // 外部统计脚本在沙箱里不可达，直接拦截，避免无关报错
        await page.route(/googletagmanager\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
        if (initScript) await page.addInitScript(initScript);
        return { page, context };
    }

    try {
        // ---------- A. 全新游戏：启动、自动战斗、防抖保存 ----------
        {
            const { page, context } = await newPage(() => {
                window.__mainWrites = 0;
                const orig = Storage.prototype.setItem;
                Storage.prototype.setItem = function (k, v) { if (k === 'pokemon_idle_save') window.__mainWrites++; return orig.call(this, k, v); };
                localStorage.setItem('pokemon_idle_tutorial_done', '1');
            });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            check('页面加载并启动战斗', true);
            await sleep(1500);
            check('战斗日志出现内容', await page.locator('#battle-messages .log-entry').count() > 0);
            check('队伍面板渲染', await page.locator('#team-list .team-slot').count() >= 1);
            check('版本号显示', (await page.locator('.version-tag').textContent()).startsWith('v2.'));
            await page.evaluate(() => game.saveNow());
            const saved = await page.evaluate(() => {
                const raw = localStorage.getItem('pokemon_idle_save');
                return { raw: raw && raw.slice(0, 3), version: game.gameState.schemaVersion };
            });
            check('存档写入为 LZ 格式并带 schemaVersion=3', saved.raw === 'LZ:' && saved.version === 3, JSON.stringify(saved));
            // 防抖：连续战斗 12 秒，写入次数应远小于“每场胜利一次”
            const w0 = await page.evaluate(() => window.__mainWrites);
            await page.evaluate(() => { for (let i = 0; i < 50; i++) game.save(); });
            // 等待防抖写入完成（用条件等待而不是固定 sleep：机器繁忙时浏览器定时器可能被推迟）
            await page.waitForFunction(() => !game.saver.hasPending(), null, { timeout: 15000 });
            const w1 = await page.evaluate(() => window.__mainWrites);
            const dbg = await page.evaluate(() => ({ pending: game.saver.hasPending(), paused: game.saver.paused, timer: !!game.saver._timer, first: game.saver._firstRequestAt, now: Date.now(), err: game.saver.lastError, writes: game.saver.stats }));
            check('50 次 save() 请求被合并为 1 次写入', w1 - w0 === 1, `写入 ${w1 - w0} 次 ${JSON.stringify(dbg)}`);
            // 切换所有标签页不报错
            for (const tab of ['tab-map', 'tab-pokedex', 'tab-settings', 'tab-battle']) {
                await page.evaluate((t) => gameUI.switchTab(t), tab);
            }
            check('切换标签页不报错', true);
            await context.close();
        }

        // ---------- B. 旧版存档 + 1 小时离线：结算报告 ----------
        {
            const legacy = fs.readFileSync(path.join(ROOT, 'tests/fixtures/legacy-localstorage.txt'), 'utf8');
            const { page, context } = await newPage(`
                localStorage.setItem('pokemon_idle_tutorial_done', '1');
                if (!localStorage.getItem('pokemon_idle_save')) localStorage.setItem('pokemon_idle_save', ${JSON.stringify(legacy)});
            `);
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.gameState, null, { timeout: 10000 });
            const loaded = await page.evaluate(() => ({
                team: game.gameState.team.slice(), caught: Object.keys(game.gameState.caughtPokemon).length,
                from: game.loadReport.fromVersion, ver: game.gameState.schemaVersion,
                owned: game.roster.count(), problems: game.roster.checkIntegrity(),
            }));
            check('旧版(v1)存档在浏览器里可加载并迁移为个体', loaded.caught === 190 && loaded.from === 1 && loaded.ver === 3 && loaded.owned === 190 && loaded.problems.length === 0, JSON.stringify(loaded));
            // 把存储里的 lastSave 拨回 1 小时前，再刷新页面触发“页面加载时的离线结算”
            await page.evaluate(() => {
                const st = JSON.parse(JSON.stringify(game.gameState));
                st.lastSave = Date.now() - 3600 * 1000;
                localStorage.setItem('pokemon_idle_save', SaveCodec.encodePayload(JSON.stringify(st)));
                game.saver.cancelPending();
            });
            // 阻止 beforeunload 里的 saveNow 覆盖我们刚构造的存档
            await page.evaluate(() => { game.saveNow = () => ({ ok: true }); game.saver.flush = () => ({ ok: true }); });
            await page.reload();
            await page.waitForSelector('#offline-report:not(.hidden)', { timeout: 30000 });
            const reportText = await page.locator('#offline-report').innerText();
            check('离线结算报告显示（战斗数/经验）', /完成战斗/.test(reportText) && /获得经验/.test(reportText), reportText.slice(0, 120));
            await page.locator('.offline-report-close').click();
            await sleep(600);
            check('点击确定后遮罩关闭', await page.locator('#offline-overlay.hidden').count() === 1);
            check('离线结算后战斗恢复', await page.evaluate(() => !!game.currentBattle));
            await context.close();
        }

        // ---------- C. 恶意导入：HTML/JS 不得进入页面 ----------
        {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'));
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle);
            const evil = '<img src=x onerror="window.__pwned=1">';
            const result = await page.evaluate((evil) => {
                const s = JSON.parse(JSON.stringify(game.gameState));
                const gem = { uid: '"><svg onload=window.__pwned=2>', quality: 'epic', qualityName: evil, qualityColor: 'red;background:url(javascript:window.__pwned=3)', attrs: [{ id: 'hp_bonus', name: evil, value: 3, unit: evil, icon: evil }], locked: false };
                s.badges = { kanto: { unlocked: true, gem } };
                s.gems = [gem, { ...gem, uid: 'second' }];
                document.getElementById('save-data-area').value = JSON.stringify(s);
                document.getElementById('btn-import').click();
                return true;
            }, evil);
            await sleep(800);
            for (const tab of ['tab-badge', 'tab-settings']) await page.evaluate((t) => gameUI.switchTab(t), tab);
            await sleep(300);
            const probe = await page.evaluate(() => ({
                pwned: window.__pwned,
                evilImgs: document.querySelectorAll('img[src="x"]').length,
                svgs: document.querySelectorAll('svg[onload]').length,
                gems: game.gameState.gems.length,
                name: game.gameState.badges.kanto && game.gameState.badges.kanto.gem && game.gameState.badges.kanto.gem.qualityName,
            }));
            check('恶意存档导入后没有脚本执行', result && probe.pwned === undefined && probe.evilImgs === 0 && probe.svgs === 0, JSON.stringify(probe));
            check('恶意宝石字段已被配置值替换', probe.name === '史诗' && probe.gems === 2, JSON.stringify(probe));
            // 无效导入给出明确提示且不破坏当前游戏
            await page.evaluate(() => { document.getElementById('save-data-area').value = '{"team":[999999]}'; document.getElementById('btn-import').click(); });
            await sleep(300);
            const toast = await page.locator('.toast').last().textContent();
            check('无效导入显示具体原因', /导入失败/.test(toast), toast);
            check('无效导入不破坏当前游戏', await page.evaluate(() => game.gameState.team.length >= 1 && !!game.currentBattle));
            await context.close();
        }

        // ---------- D. 保存失败要有可见提示，恢复后自动消失 ----------
        {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'));
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle);
            await page.evaluate(() => {
                window.__realSet = Storage.prototype.setItem;
                Storage.prototype.setItem = function (k, v) {
                    if (k.startsWith('pokemon_idle_save')) { const e = new Error('quota'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
                    return window.__realSet.call(this, k, v);
                };
                game.saveNow();
            });
            await sleep(200);
            const banner = await page.locator('#save-banner');
            check('保存失败时显示红色横幅', (await banner.getAttribute('class')).includes('error') && /空间已满/.test(await banner.innerText()));
            await page.evaluate(() => { Storage.prototype.setItem = window.__realSet; game.saveNow(); });
            await sleep(200);
            check('保存恢复后横幅自动消失', (await banner.getAttribute('class')).includes('hidden'));
            await context.close();
        }

        // ---------- E. 主存档损坏：自动从备份恢复并提示 ----------
        {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'));
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle);
            await page.evaluate(() => { game.gameState.gold = 4242; game.saveNow(); game.saver.backupNow(true); });
            await page.evaluate(() => { game.saveNow = () => ({ ok: true }); game.saver.flush = () => ({ ok: true }); localStorage.setItem('pokemon_idle_save', 'LZ:坏掉的存档'); });
            await page.reload();
            await page.waitForFunction(() => typeof game !== 'undefined' && game.gameState);
            const info = await page.evaluate(() => ({ gold: game.gameState.gold, rec: game.loadReport.recovered, corrupt: localStorage.getItem('pokemon_idle_save_corrupt') }));
            check('损坏的主存档从备份恢复', info.rec === true && info.gold === 4242, JSON.stringify(info));
            check('损坏原文被保留', info.corrupt === 'LZ:坏掉的存档');
            check('恢复时显示警告横幅', (await page.locator('#save-banner').getAttribute('class')).includes('warn'));
            await context.close();
        }

        // ---------- F. 第 2 阶段：v2 存档迁移为个体；同物种多只；昵称不能注入；导出/导入往返 ----------
        {
            const v2 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/legacy-v2-localstorage.txt'), 'utf8');
            const { page, context } = await newPage(`
                localStorage.setItem('pokemon_idle_tutorial_done', '1');
                if (!localStorage.getItem('pokemon_idle_save')) localStorage.setItem('pokemon_idle_save', ${JSON.stringify(v2)});
            `);
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            const mig = await page.evaluate(() => ({
                from: game.loadReport.fromVersion, ver: game.gameState.schemaVersion, owned: game.roster.count(),
                party: game.gameState.party.length, boxes: game.gameState.pc.boxes.length,
                problems: game.roster.checkIntegrity(), origin: game.roster.primaryOf(25).origin,
            }));
            check('v2 存档迁移为个体（190 只、队伍 5、PC 箱子 7、不变量全部成立）',
                mig.from === 2 && mig.ver === 3 && mig.owned === 190 && mig.party === 5 && mig.boxes === 7 && mig.problems.length === 0 && mig.origin === 'legacy_migration', JSON.stringify(mig));

            // 第二只皮卡丘（昵称里带 HTML）进队伍：界面按个体显示，且不能注入
            await page.evaluate(() => {
                const r = game.roster.create({ speciesId: 25, level: 30, ivs: { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 }, shiny: true, nickname: '<img src=x onerror=window.__pwned2=1>', rng: Math.random });
                game.roster.moveToParty(r.instance.uid);
                gameUI.renderTeam();
            });
            await sleep(300);
            const ui = await page.evaluate(() => ({
                slots: document.querySelectorAll('#team-list .team-slot').length,
                text: document.getElementById('team-list').innerText,
                pwned: window.__pwned2, evilImgs: document.querySelectorAll('img[src="x"]').length,
                party: game.gameState.team.slice(),
            }));
            check('队伍面板显示 6 只（含同物种的两只皮卡丘）', ui.slots === 6 && ui.party.filter(id => id === 25).length === 2, JSON.stringify({ slots: ui.slots, party: ui.party }));
            check('个体昵称显示为纯文本，没有脚本执行', ui.pwned === undefined && ui.evilImgs === 0 && /img src=x on/.test(ui.text) && !ui.text.includes('<img'));

            // 导出 → 清空 → 通过界面导入：个体完整往返
            const text = await page.evaluate(() => game.exportSave());
            const before = await page.evaluate(() => JSON.stringify({ owned: game.gameState.ownedPokemon, party: game.gameState.party, pc: game.gameState.pc }));
            await page.evaluate((t) => { game.gameState.ownedPokemon = {}; document.getElementById('save-data-area').value = t; document.getElementById('btn-import').click(); }, text);
            await sleep(800);
            const after = await page.evaluate(() => JSON.stringify({ owned: game.gameState.ownedPokemon, party: game.gameState.party, pc: game.gameState.pc }));
            check('通过界面导出/导入：个体、队伍、PC 完全一致', after === before && JSON.parse(after).party.length === 6);
            const afterProblems = await page.evaluate(() => game.roster.checkIntegrity());
            check('导入后名册不变量成立且战斗继续', afterProblems.length === 0 && await page.evaluate(() => !!game.currentBattle));

            // 保存后刷新：个体仍在（含昵称）
            await page.evaluate(() => game.saveNow());
            await page.reload();
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            const reloaded = await page.evaluate(() => ({ owned: game.roster.count(), ver: game.loadReport.fromVersion, nick: game.roster.ofSpecies(25).map(i => i.nickname) }));
            check('保存并刷新后个体仍在（含净化后的昵称）', reloaded.owned === 191 && reloaded.ver === 3 && reloaded.nick.includes('img src=x on'), JSON.stringify(reloaded));
            await context.close();
        }

        check('整个过程中没有页面错误或 console.error', errors.length === 0, errors.slice(0, 5).join(' | '));
    } catch (e) {
        check('冒烟测试流程', false, e.stack || String(e));
    } finally {
        await browser.close();
        server.close();
    }

    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
    process.exit(failed.length ? 1 : 0);
})();
