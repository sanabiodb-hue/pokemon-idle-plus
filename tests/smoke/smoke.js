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

    async function newPage(initScript, ctxOpts = {}) {
        const context = await browser.newContext({ viewport: { width: 480, height: 900 }, ...ctxOpts });
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
            // 先暂停战斗：战斗自己（新敌人出现、捕获等）也会请求存档，会让“恰好 1 次”随时序抖动
            await page.evaluate(() => game.stopBattle());
            await page.waitForFunction(() => !game.saver.hasPending(), null, { timeout: 15000 });
            const w0 = await page.evaluate(() => window.__mainWrites);
            await page.evaluate(() => { for (let i = 0; i < 50; i++) game.save(); });
            // 等待防抖写入完成（用条件等待而不是固定 sleep：机器繁忙时浏览器定时器可能被推迟）
            await page.waitForFunction(() => !game.saver.hasPending(), null, { timeout: 15000 });
            const w1 = await page.evaluate(() => window.__mainWrites);
            const dbg = await page.evaluate(() => ({ pending: game.saver.hasPending(), paused: game.saver.paused, timer: !!game.saver._timer, first: game.saver._firstRequestAt, now: Date.now(), err: game.saver.lastError, writes: game.saver.stats }));
            check('50 次 save() 请求被合并为 1 次写入', w1 - w0 === 1, `写入 ${w1 - w0} 次 ${JSON.stringify(dbg)}`);
            await page.evaluate(() => game.startBattle());
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
            check('旧版(v1)存档在浏览器里可加载并迁移为个体', loaded.caught === 190 && loaded.from === 1 && loaded.ver === 3 && loaded.owned >= 190 && loaded.problems.length === 0, JSON.stringify(loaded));
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
            check('离线结算报告显示（战斗数/经验）', /Batalhas/.test(reportText) && /EXP ganho/.test(reportText), reportText.slice(0, 120));
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
            check('恶意宝石字段已被配置值替换', probe.name === 'Épica' && probe.gems === 2, JSON.stringify(probe));
            // 无效导入给出明确提示且不破坏当前游戏
            await page.evaluate(() => { document.getElementById('save-data-area').value = '{"team":[999999]}'; document.getElementById('btn-import').click(); });
            await sleep(300);
            const toast = await page.locator('.toast').last().textContent();
            check('无效导入显示具体原因', /Falha ao importar/.test(toast), toast);
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
            check('保存失败时显示红色横幅', (await banner.getAttribute('class')).includes('error') && /cheio/.test(await banner.innerText()));
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
                problems: game.roster.checkIntegrity(), origin: game.roster.all().some(i => i.origin === 'legacy_migration') ? 'legacy_migration' : 'none',
            }));
            // 离线结算会在加载时跑真实战斗：可能新捕获同种个体（>190）、箱子变多、队伍里的宝可梦进化，所以只检查下限与不变量
            check('v2 存档迁移为个体（至少 190 只、队伍 5、PC 箱子 ≥7、不变量全部成立）',
                mig.from === 2 && mig.ver === 3 && mig.owned >= 190 && mig.party === 5 && mig.boxes >= 7 && mig.problems.length === 0 && mig.origin === 'legacy_migration', JSON.stringify(mig));

            // 队伍首位物种的第二只（昵称里带 HTML）进队伍：界面按个体显示，且不能注入
            const dupSpecies = await page.evaluate(() => game.gameState.team[0]);
            await page.evaluate((sp) => {
                const r = game.roster.create({ speciesId: sp, level: 30, ivs: { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 }, shiny: true, nickname: '<img src=x onerror=window.__pwned2=1>', rng: Math.random });
                game.roster.moveToParty(r.instance.uid);
                gameUI.renderTeam();
            }, dupSpecies);
            await sleep(300);
            const ui = await page.evaluate(() => ({
                slots: document.querySelectorAll('#team-list .team-slot').length,
                text: document.getElementById('team-list').innerText,
                pwned: window.__pwned2, evilImgs: document.querySelectorAll('img[src="x"]').length,
                party: game.gameState.team.slice(),
            }));
            check('队伍面板显示 6 只（含同物种的两只）', ui.slots === 6 && ui.party.filter(id => id === dupSpecies).length === 2, JSON.stringify({ slots: ui.slots, party: ui.party }));
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
            const ownedBefore = await page.evaluate(() => game.roster.count());
            await page.evaluate(() => game.saveNow());
            await page.reload();
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            const reloaded = await page.evaluate((sp) => ({ owned: game.roster.count(), ver: game.loadReport.fromVersion, nick: game.roster.ofSpecies(sp).map(i => i.nickname) }), dupSpecies);
            check('保存并刷新后个体仍在（含净化后的昵称）', reloaded.owned >= ownedBefore && reloaded.ver === 3 && reloaded.nick.includes('img src=x on'), JSON.stringify({ ...reloaded, ownedBefore }));
            await context.close();
        }

        // ---------- G. 第 3 阶段：捕获同种 → PC 界面 → 队伍界面 → 保存刷新 ----------
        {
            const { page, context } = await newPage(`localStorage.setItem('pokemon_idle_tutorial_done', '1');`);
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });

            // 设置里的“重复捕获”策略：默认 all；改成 better 后写入存档
            await page.click('[data-tab="tab-settings"]');
            check('设置：重复捕获策略默认选中“有几率收为新个体”', await page.locator('input[name="capture-duplicates"][value="all"]').isChecked());
            await page.locator('input[name="capture-duplicates"][value="better"]').check();
            check('设置：切换为“只收更高的”后写入游戏状态', await page.evaluate(() => game.gameState.settings.captureDuplicates === 'better'));

            // 走真实的击败流程：同一物种连续遇到两只，第二只个体值更高 → 收为新的个体
            await page.evaluate(() => {
                game.stopBattle();
                const mk = (v) => { const w = game.createWildPokemon(16, 5, 0); w.isShiny = false; w.ivs = { hp: v, atk: v, def: v, spAtk: v, spDef: v, speed: v }; return w; };
                game.processDefeat(mk(5));
                game.processDefeat(mk(25));
                game.startBattle();
            });
            await page.click('[data-tab="tab-pc"]');
            await sleep(300);
            const pc1 = await page.evaluate(() => ({
                cards: [...document.querySelectorAll('#pc-grid .pc-card[data-uid]')].map(c => c.dataset.uid),
                badges: [...document.querySelectorAll('#pc-grid .pc-same-badge')].map(b => b.textContent.trim()),
                summary: document.getElementById('pc-summary').textContent,
                partyCards: document.querySelectorAll('#pc-party .pc-card').length,
            }));
            check('PC 界面列出同一物种的两只个体，并标出 ×2', pc1.cards.length === 2 && new Set(pc1.cards).size === 2 && pc1.badges.length === 2 && pc1.badges.every(b => b === '×2') && pc1.partyCards === 1, JSON.stringify(pc1));

            // 点第二张卡片 → 详情显示它自己的编号与个体值 → 加入队伍
            const target = pc1.cards[1];
            await page.click(`#pc-grid .pc-card[data-uid="${target}"]`);
            const detail = await page.locator('#pc-detail').innerText();
            check('详情显示编号、个体值、性格', detail.includes('#' + target) && /Total/.test(detail) && /Natureza/.test(detail), detail.slice(0, 120));
            await page.click('#pc-detail [data-pc-action="to-party"]');
            await sleep(200);
            const afterAdd = await page.evaluate((uid) => ({
                party: game.gameState.party.slice(), where: game.roster.locate(uid).where,
                slots: document.querySelectorAll('#team-list .team-slot').length, pcParty: document.querySelectorAll('#pc-party .pc-card').length,
            }), target);
            check('从 PC 加入队伍：名册、队伍面板、PC 页面一致', afterAdd.party.length === 2 && afterAdd.where === 'party' && afterAdd.pcParty === 2, JSON.stringify(afterAdd));

            // 队伍面板里的 ▲▼ 调整顺序、放回 PC
            await page.click('[data-tab="tab-battle"]');
            await sleep(200);
            const snap = () => page.evaluate(() => ({ party: game.gameState.party.slice(), active: game.gameState.party[game.gameState.activePokemonIndex] }));
            const orderBefore = await snap();
            await page.click('#team-list .team-slot:nth-of-type(2) .team-slot-actions button[title="Subir"]');
            const orderAfter = await snap();
            check('队伍面板 ▲：顺序交换，出战者仍是同一只',
                orderAfter.party[0] === orderBefore.party[1] && orderAfter.party[1] === orderBefore.party[0] && orderAfter.active === orderBefore.active,
                JSON.stringify({ orderBefore, orderAfter }));
            await page.evaluate(() => { game.setActivePokemon(game.gameState.party.indexOf(game.roster.primaryOf(25).uid)); gameUI.renderTeam(); });
            const removeIdx = await page.evaluate(() => game.gameState.party.findIndex((u, i) => i !== game.gameState.activePokemonIndex));
            await page.evaluate((i) => gameUI.removeFromTeam(i), removeIdx);
            const afterRemove = await page.evaluate(() => ({ party: game.gameState.party.length, problems: game.roster.checkIntegrity() }));
            check('队伍面板“放回PC”：个体回到 PC，不变量成立', afterRemove.party === 1 && afterRemove.problems.length === 0, JSON.stringify(afterRemove));

            // 保存并刷新：两只同种个体仍在，策略仍是 better
            const snapshot = await page.evaluate(() => { game.saveNow(); return { uids: game.roster.ofSpecies(16).map(i => i.uid).sort(), ivs: game.roster.ofSpecies(16).map(i => i.ivs.hp).sort() }; });
            await page.reload();
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            const reloaded2 = await page.evaluate(() => ({
                uids: game.roster.ofSpecies(16).map(i => i.uid).sort(), ivs: game.roster.ofSpecies(16).map(i => i.ivs.hp).sort(),
                policy: game.gameState.settings.captureDuplicates, problems: game.roster.checkIntegrity(),
            }));
            check('刷新后同种的两只个体、策略设置都在', JSON.stringify(reloaded2.uids) === JSON.stringify(snapshot.uids) && JSON.stringify(reloaded2.ivs) === JSON.stringify(snapshot.ivs) && reloaded2.policy === 'better' && reloaded2.problems.length === 0, JSON.stringify({ reloaded2, snapshot }));
            await context.close();
        }

        // ---------- H. 第 4 阶段：新玩家的第一次游玩（手机视口）----------
        {
            const { page, context } = await newPage(null, { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            await page.waitForSelector('.tutorial-modal', { timeout: 5000 });

            // 手机视口：页面没有被 initial-scale 放大裁切，也没有横向滚动
            const vp = await page.evaluate(() => ({ vv: window.visualViewport.width, iw: window.innerWidth, sw: document.documentElement.scrollWidth, scale: window.visualViewport.scale }));
            check('手机视口：没有被放大裁切，没有横向滚动', vp.scale === 1 && vp.sw <= vp.iw + 1 && vp.vv >= vp.iw - 1, JSON.stringify(vp));

            const welcome = await page.locator('.tutorial-modal').innerText();
            check('欢迎页只有三件事，并提示跟着任务条走', /capture todos os Pokémon/.test(welcome) && /automáticas/.test(welcome) && /barra de passos/.test(welcome) && welcome.length < 320, welcome);
            await page.click('.tutorial-start-btn');
            await sleep(500);
            const bar1 = await page.locator('#guide-bar').innerText();
            check('下一步条：显示步骤 1/5 与进度', /1\/5/.test(bar1) && /primeira batalha/.test(bar1) && await page.locator('#guide-bar .guide-progress').count() === 1, bar1);

            const teamHint = await page.locator('#team-list .team-empty-slots').innerText();
            check('队伍没满：提示还有几个空位以及怎么补', /5 vagas livres/.test(teamHint), teamHint);

            // 统计：打开/会话已记录；第一次操作（上面的点击）已记录
            const an0 = await page.evaluate(() => JSON.parse(localStorage.getItem('pokemon_idle_analytics')).queue.map(e => e.n));
            check('统计：game_open / session_start / first_action 已记录', ['game_open', 'session_start', 'first_action', 'battle_start'].every(n => an0.includes(n)), JSON.stringify(an0));

            // PC 空状态
            await page.evaluate(() => game.stopBattle());
            await page.click('[data-tab="tab-pc"]');
            const pcEmpty = await page.locator('#pc-grid').innerText();
            check('PC 空状态：说明新宝可梦会送到这里', /O PC está vazio/.test(pcEmpty), pcEmpty);
            await page.click('[data-tab="tab-battle"]');
            await page.evaluate(() => { game.gameState.guide.flags.pcOpened = false; });   // 上面只是看了一眼空 PC，下面重新走“打开 PC”这一步

            // 走真实的胜利流程：看战斗 + 捕获新伙伴 → 事件卡片、PC 页签红点、引导进入第 3 步
            await page.evaluate(() => {
                for (let i = 0; i < 8 && game.getPokedexStats().caught < 2; i++) {
                    const w = game.createWildPokemon(19, 3, 0); w.isShiny = false;
                    game._processVictoryRewards(w, 25, 100, 100);
                }
                game._guideLastUpdate = 0; game.guideUpdate({ force: true });
            });
            await sleep(400);
            const afterCapture = await page.evaluate(() => ({
                cards: [...document.querySelectorAll('#event-cards .event-card-title')].map(e => e.textContent),
                dot: (document.querySelector('.tab-btn[data-tab="tab-pc"] .tab-dot') || {}).textContent || '',
                bar: document.getElementById('guide-bar').innerText,
            }));
            check('捕获新宝可梦：弹出事件卡片（发生了什么 + 去哪看），PC 页签出现红点', afterCapture.cards.some(t => /Novo Pokémon/.test(t)) && afterCapture.dot === '1', JSON.stringify(afterCapture));
            check('引导推进到“打开 PC”，并给出一键入口', /3\/5/.test(afterCapture.bar) && /Abrir PC/.test(afterCapture.bar));

            // 打开 PC → 红点消失 → 引导进入“组建队伍” → 在 PC 里加入队伍 → 进入“探索”
            await page.click('#guide-bar [data-guide-action="open-tab"]');
            await sleep(300);
            check('打开 PC：红点消失，进入第 4 步，PC 页签是当前页签（导航高亮没有被引导按钮抢走）',
                await page.locator('.tab-btn[data-tab="tab-pc"] .tab-dot').count() === 0 && /4\/5/.test(await page.locator('#guide-bar').innerText())
                && await page.evaluate(() => document.querySelector('#tab-nav .tab-btn.active').dataset.tab === 'tab-pc' && document.querySelectorAll('[data-tab].active').length === 1));
            await page.click('#pc-grid .pc-card[data-uid]');
            await page.click('#pc-detail [data-pc-action="to-party"]');
            await sleep(300);
            await page.click('[data-tab="tab-battle"]');
            const bar5 = await page.locator('#guide-bar').innerText();
            check('加入队伍后进入第 5 步“探索新道路”', /5\/5/.test(bar5) && /Mapa/.test(bar5), bar5);

            // 抓齐一号道路 → 地图上有“推荐”的新道路，并显示每条道路还有几种没抓到
            await page.evaluate(() => { for (const id of [16, 19]) if (game.gameState.pokedex[id] !== 'caught') game.catchPokemonWithIvs(id, 1, { hp: 5, atk: 5, def: 5, spAtk: 5, spDef: 5, speed: 5 }); });
            await page.click('[data-tab="tab-map"]');
            await sleep(300);
            const map = await page.evaluate(() => ({
                rec: [...document.querySelectorAll('.route-card.recommended h3')].map(h => h.textContent),
                chips: [...document.querySelectorAll('.route-progress-line')].map(c => c.textContent.trim()),
            }));
            check('地图：被推荐的新道路高亮，每条道路显示还有几种没抓到', map.rec.length === 1 && /Rota 2/.test(map.rec[0]) && /Sugerida/.test(map.rec[0]) && map.chips.some(c => /Completa/.test(c)) && map.chips.some(c => /Faltam \d+/.test(c)), JSON.stringify(map));
            await page.click('.route-card.recommended');
            await sleep(300);
            await page.click('[data-tab="tab-battle"]');
            const done = await page.evaluate(() => ({ onboarding: game.gameState.guide.onboarding, bar: document.getElementById('guide-bar').className, steps: Object.keys(game.gameState.guide.steps).length }));
            check('换到新道路后引导完成，下一步条切换为目标/建议', done.onboarding === 'done' && done.steps === 5 && !/guide-onboarding/.test(done.bar), JSON.stringify(done));

            // 目标面板与空状态
            await page.evaluate(() => gameUI.guideView.showGoals());
            const goals = await page.locator('.goals-modal').innerText();
            check('目标面板：列出目标和进度', /Metas \(\d+\/\d+\)/.test(goals) && /Capture 10 espécies/.test(goals) && /Desbloqueie Johto/.test(goals), goals.slice(0, 80));
            await page.click('.goals-close');
            await page.click('[data-tab="tab-pokedex"]');
            await page.evaluate(() => { const i = document.getElementById('pokedex-search-input'); i.value = '不存在的名字'; i.dispatchEvent(new Event('input')); });
            await sleep(300);
            check('图鉴：搜索无结果有说明和返回按钮', /Nada encontrado/.test(await page.locator('#pokedex-grid').innerText()));
            await page.evaluate(() => { const i = document.getElementById('pokedex-search-input'); i.value = ''; i.dispatchEvent(new Event('input')); });
            await page.click('.filter-btn[data-filter="shiny"]');
            await sleep(200);
            check('图鉴：没有闪光时说明获得方式', /1\/4096/.test(await page.locator('#pokedex-grid').innerText()));

            // 各页签：手机上没有横向滚动
            const overflows = [];
            for (const t of ['tab-battle', 'tab-map', 'tab-pokedex', 'tab-pc', 'tab-settings']) {
                await page.click(`[data-tab="${t}"]`);
                await sleep(150);
                if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) overflows.push(t);
            }
            check('手机上所有主要页签都没有横向滚动', overflows.length === 0, overflows.join());

            // 设置：匿名统计开关 / 测试报告 / 目标入口
            const rep = await page.evaluate(() => JSON.parse(gameUI.buildBetaReport()));
            check('测试报告：包含进度与统计摘要，不含存档内容', rep.progress.species >= 3 && rep.analytics && rep.analytics.sessions === 1 && !JSON.stringify(rep).includes('ownedPokemon'), JSON.stringify(rep).slice(0, 120));
            await page.click('[data-tab="tab-settings"]');
            await page.click('label.setting-toggle:has(#setting-analytics)');
            const off = await page.evaluate(() => ({ q: JSON.parse(localStorage.getItem('pokemon_idle_analytics')).queue.length, on: game.analytics.isEnabled() }));
            check('关闭匿名统计：不再记录并清空队列', off.q === 0 && off.on === false, JSON.stringify(off));
            await page.click('label.setting-toggle:has(#setting-analytics)');

            // 刷新回来：不再弹欢迎页，统计记为回访（第 2 次会话）
            await page.evaluate(() => game.saveNow());
            await page.reload();
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            const back = await page.evaluate(() => {
                const q = JSON.parse(localStorage.getItem('pokemon_idle_analytics')).queue;
                const open = q.filter(e => e.n === 'game_open').pop();
                return { modal: document.querySelectorAll('.tutorial-modal').length, open: open && open.p, ended: q.filter(e => e.n === 'session_end').length };
            });
            check('刷新回来：没有欢迎页，game_open 标记为回访', back.modal === 0 && back.open && back.open.returning === true && back.open.sessions === 2, JSON.stringify(back));
            await context.close();
        }

        // ---------- I. 跳过引导 / 老玩家 ----------
        {
            const { page, context } = await newPage(null, { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
            await page.goto(base);
            await page.waitForSelector('.tutorial-modal', { timeout: 15000 });
            await page.click('.tutorial-skip-btn');
            await sleep(500);
            const sk = await page.evaluate(() => ({ s: game.gameState.guide.onboarding, bar: document.getElementById('guide-bar').className }));
            check('欢迎页“跳过引导”：引导标记为已跳过，下一步条不再是引导', sk.s === 'skipped' && !/guide-onboarding/.test(sk.bar), JSON.stringify(sk));
            await context.close();

            const v2 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/legacy-v2-localstorage.txt'), 'utf8');
            const vet = await newPage(`
                localStorage.setItem('pokemon_idle_save', ${JSON.stringify(v2)});
            `, { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
            await vet.page.goto(base);
            await vet.page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            await sleep(500);
            const vs = await vet.page.evaluate(() => ({ modal: document.querySelectorAll('.tutorial-modal').length, ob: game.gameState.guide.onboarding, bar: document.getElementById('guide-bar').className, hidden: document.getElementById('guide-bar').classList.contains('hidden') }));
            check('老存档：没有欢迎页、没有新手引导，下一步条给出建议/目标', vs.modal === 0 && vs.ob === 'done' && !/guide-onboarding/.test(vs.bar) && !vs.hidden, JSON.stringify(vs));
            await vet.context.close();
        }

        // ---------- J. Localização pt-BR: nenhuma tela mostra chinês e o texto não estoura o layout ----------
        for (const vp of [{ name: 'desktop 1280x800', opts: { viewport: { width: 1280, height: 800 } } }, { name: 'celular 360x640', opts: { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true } }]) {
            const { page, context } = await newPage(`localStorage.setItem('pokemon_idle_tutorial_done', '1');`, vp.opts);
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            // estado "avançado": tudo capturado, insígnias, gemas, frutas, para renderizar TODAS as abas
            await page.evaluate(() => {
                game.stopBattle();
                const iv = { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 };
                for (let id = 1; id <= 1073; id++) if (game.gameState.pokedex[id] !== 'caught') game.catchPokemonWithIvs(id, 1, iv);
                for (const r of Object.keys(REGIONS)) game.tryUnlockBadge(r);
                game.gameState.gold = 1e9;
                for (let i = 0; i < 12; i++) game.buyGem();
                for (const id of Object.keys(BERRY_DATA)) { game.gameState.berryBag[id] = 3; }
                game.plantBerryFree(Object.keys(BERRY_DATA)[0]);
                gameUI.updateBadgeTabVisibility(); gameUI.updateBerryTabVisibility(); gameUI.updateSkillTabVisibility();
                gameUI.updateTalentTabVisibility(); gameUI.updateTowerTabVisibility();
                game.gameState.shinyDex[25] = true;
                game.startBattle();
            });
            const CJK = '[\\u3400-\\u9fff\\uff00-\\uffef\\u3000-\\u303f]';
            const scan = (label) => page.evaluate(({ label, CJK }) => {
                const re = new RegExp(CJK);
                const texts = [];
                for (const el of document.querySelectorAll('body *')) {
                    for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) { const v = el.getAttribute(attr); if (v && re.test(v)) texts.push(attr + ':' + v.slice(0, 30)); }
                    if (el.children.length === 0 && re.test(el.textContent)) texts.push(el.textContent.trim().slice(0, 30));
                }
                const doc = document.documentElement;
                return { label, cjk: texts.slice(0, 5), overflow: doc.scrollWidth > window.innerWidth + 1 };
            }, { label, CJK });
            const problems = [];
            const tabs = ['tab-battle', 'tab-map', 'tab-badge', 'tab-berry', 'tab-skill', 'tab-talent', 'tab-tower', 'tab-pokedex', 'tab-pc', 'tab-settings'];
            for (const t of tabs) {
                const btn = page.locator(`#tab-nav [data-tab="${t}"]`);
                await btn.click();
                await sleep(250);
                const active = await page.evaluate(() => document.querySelector('#tab-nav .tab-btn.active').dataset.tab);
                if (active !== t) problems.push(`${t}: não abriu (${active})`);
                const r = await scan(t);
                if (r.cjk.length) problems.push(`${t}: chinês ${JSON.stringify(r.cjk)}`);
                if (r.overflow) problems.push(`${t}: rolagem horizontal`);
            }
            check(`pt-BR ${vp.name}: todas as 10 abas abrem, sem chinês e sem rolagem horizontal`, problems.length === 0, problems.join(' | '));

            // mapa: regiões bloqueadas/desbloqueadas e todas as rotas de cada região
            const mapProblems = [];
            await page.click('#tab-nav [data-tab="tab-map"]');
            for (const rid of ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea', 'mega']) {
                await page.evaluate((rid) => gameUI.showRoutes(rid), rid);
                const r = await scan('mapa ' + rid);
                if (r.cjk.length || r.overflow) mapProblems.push(`${rid}: ${JSON.stringify(r)}`);
            }
            check(`pt-BR ${vp.name}: mapa de todas as 10 regiões (192 rotas) em português`, mapProblems.length === 0, mapProblems.join(' | ').slice(0, 300));

            // pokédex: filtros, regiões, busca
            const dexProblems = [];
            await page.click('#tab-nav [data-tab="tab-pokedex"]');
            for (const f of ['all', 'caught', 'uncaught', 'shiny', 'not_shiny']) {
                await page.click(`.filter-btn[data-filter="${f}"]`);
                await sleep(150);
                const r = await scan('dex ' + f);
                if (r.cjk.length || r.overflow) dexProblems.push(`${f}: ${JSON.stringify(r)}`);
            }
            check(`pt-BR ${vp.name}: Pokédex (todos os filtros) em português e sem estourar`, dexProblems.length === 0, dexProblems.join(' | ').slice(0, 300));

            // diálogos e cartões
            const dialogProblems = [];
            const dialogs = [
                ['guia de jogo', () => gameUI.showGameplayHelpDialog()],
                ['boas-vindas', () => gameUI.showTutorialDialog(() => {})],
                ['metas', () => gameUI.guideView.showGoals()],
                ['síntese de gemas', () => gameUI.showGemSynthesisDialog('common', 'magic')],
                ['refazer gema', () => gameUI.showReforgeDialog()],
            ];
            for (const [name, open] of dialogs) {
                try { await page.evaluate(open); } catch (e) { dialogProblems.push(`${name}: erro ${e.message.slice(0, 60)}`); continue; }
                await sleep(200);
                const r = await scan(name);
                if (r.cjk.length || r.overflow) dialogProblems.push(`${name}: ${JSON.stringify(r)}`);
                await page.evaluate(() => document.querySelectorAll('.modal-overlay, .dialog-overlay').forEach(e => e.remove()));
            }
            // cartões de evento (nova espécie, shiny, evolução, região, meta)
            await page.evaluate(() => {
                const v = gameUI.guideView;
                v.onNewSpecies({ name: 'Pikachu', uid: 'p1', shiny: true });
                v.onShiny('Pikachu');
                v.onEvolved({ oldName: 'Pikachu', newName: 'Raichu', keptLevel: false, archivedOld: true, pokemon: { level: 1 } });
                v.onRegionUnlocked({ regionName: 'Região de Johto' });
                v.onGuideEvent({ kind: 'goal', title: 'Capture 10 espécies', text: 'x', exp: 50 });
                gameUI.showCatchNotification({ name: 'Rattata', isDuplicate: true, uid: 'p1' });
                gameUI.showToast('x');
            });
            const rc = await scan('cartões');
            if (rc.cjk.length || rc.overflow) dialogProblems.push(`cartões: ${JSON.stringify(rc)}`);
            check(`pt-BR ${vp.name}: diálogos e cartões de evento em português e sem estourar`, dialogProblems.length === 0, dialogProblems.join(' | ').slice(0, 300));
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
