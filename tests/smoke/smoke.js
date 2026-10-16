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

        // ---------- A2. 自动化（阶段 5A）：用控制台工具开始/暂停/结束一次狩猎 ----------
        {
            const { page, context } = await newPage(() => { localStorage.setItem('pokemon_idle_tutorial_done', '1'); });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            const startMsg = await page.evaluate(() => caca.iniciar({ stopConditions: { battleLimit: 3 } }));
            check('Automação: caçada inicia pelo console', startMsg === 'Caçada iniciada.', String(startMsg));
            await page.waitForFunction(() => caca.status().estado === 'stopped' || caca.status().batalhas >= 3, null, { timeout: 60000 }).catch(() => {});
            const st = await page.evaluate(() => caca.status());
            check('Automação: caçada para sozinha ao atingir o limite de batalhas', st.estado === 'stopped' && st.motivoParada === 'battle_limit' && st.batalhas === 3, JSON.stringify(st));
            const sync = await page.evaluate(() => ({ listeners: game.bus.hasListeners(), battling: !!game.currentBattle }));
            check('Automação: após parar, o jogo continua no modo normal sem assinantes', !sync.listeners && sync.battling, JSON.stringify(sync));
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

        // ---------- B2. aba Caça: configurar, iniciar, pausar, parar, motivo, relatório offline (mobile e desktop) ----------
        for (const vp of [{ name: 'celular 360x640', width: 360, height: 640 }, { name: 'desktop 1280x800', width: 1280, height: 800 }]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height } });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            const noOverflow = async () => page.evaluate(() => {
                const c = document.getElementById('hunt-container');
                return document.documentElement.scrollWidth <= window.innerWidth + 1 && c.scrollWidth <= c.clientWidth + 1;
            });
            await page.locator('#tab-nav [data-tab="tab-hunt"]').click();
            await page.waitForSelector('#hunt-container [data-hunt-action="start"]');
            check(`Caça ${vp.name}: aba abre com rota, equipe, captura, cura e condições`, await page.evaluate(() => ['#hunt-status', '#hunt-route', '#hunt-team', '#hunt-settings'].every(sel => document.querySelector(sel).innerText.length > 10) && /Captura/.test(document.getElementById('hunt-settings').innerText) && /Cura/.test(document.getElementById('hunt-settings').innerText) && /Poções/.test(document.getElementById('hunt-status').innerText)));
            check(`Caça ${vp.name}: sem rolagem horizontal`, await noOverflow());
            // configurar pela interface
            await page.locator('input[data-hunt-limit="battleLimit"]').check();
            await page.locator('input[data-hunt-policy="stopConditions.battleLimit"]').fill('3');
            await page.locator('input[data-hunt-policy="stopConditions.battleLimit"]').blur();
            await page.locator('input[data-hunt-policy="capture.enabled"]').uncheck();
            await page.locator('input[data-hunt-policy="capture.enabled"]').check();
            await page.evaluate(() => { const r = document.querySelector('input[data-hunt-policy="capture.minQualityPercent"]'); r.value = '40'; r.dispatchEvent(new Event('change', { bubbles: true })); });
            await page.locator('input[data-hunt-policy="heal.whenHpBelowPercent"]').fill('25');
            await page.locator('input[data-hunt-policy="heal.whenHpBelowPercent"]').blur();
            await page.locator('select[data-hunt-route]').selectOption('kanto_route2');
            const pol = await page.evaluate(() => ({ p: game.getAutomationPolicy(), route: game.gameState.currentRoute }));
            check(`Caça ${vp.name}: configuração pela interface chega à política e à rota`, pol.p.stopConditions.battleLimit === 3 && pol.p.capture.minQualityPercent === 40 && pol.p.heal.whenHpBelowPercent === 25 && pol.p.capture.enabled === true && pol.route === 'kanto_route2', JSON.stringify(pol));
            // iniciar / pausar / retomar
            await page.locator('[data-hunt-action="start"]').click();
            await page.waitForFunction(() => /Caçando/.test(document.querySelector('.hunt-state-label').textContent));
            check(`Caça ${vp.name}: iniciar mostra 🟢 Caçando`, await page.evaluate(() => game.isHuntRunning()));
            await page.locator('[data-hunt-action="pause"]').click();
            await page.waitForFunction(() => /Pausada/.test(document.querySelector('.hunt-state-label').textContent));
            await page.locator('input[data-hunt-policy="stopConditions.shinyFound"]').check();   // alterar a política com a caçada pausada
            check(`Caça ${vp.name}: pausar mostra 🟡 e dá para alterar a política`, await page.evaluate(() => game.getAutomationPolicy().stopConditions.shinyFound === true && game.getHuntSession().state === 'paused'));
            await page.locator('[data-hunt-action="resume"]').click();
            await page.waitForFunction(() => /Caçando/.test(document.querySelector('.hunt-state-label').textContent));
            // para sozinha no limite de batalhas, com o motivo na tela
            await page.waitForFunction(() => game.getHuntSession().state === 'stopped', null, { timeout: 90000 });
            await page.waitForFunction(() => /Parada por condição/.test(document.querySelector('.hunt-state-label').textContent), null, { timeout: 5000 });
            const stopped = await page.evaluate(() => ({ notice: document.querySelector('.hunt-notice').innerText, battles: game.getHuntSession().stats.battles }));
            check(`Caça ${vp.name}: parada automática mostra 🔴, "Caça encerrada" e o motivo`, /Caça encerrada/.test(stopped.notice) && /limite de 3 batalhas atingido/.test(stopped.notice) && stopped.battles === 3, JSON.stringify(stopped));
            const statsText = await page.locator('.hunt-stats').innerText();
            check(`Caça ${vp.name}: estatísticas visíveis (tempo, batalhas, capturas, EXP, poções, dinheiro, eficiência)`, ['Tempo', 'Batalhas', 'Vitórias', 'Capturas', 'Shinies', 'EXP ganha', 'Poções usadas', 'Dinheiro ganho', 'Eficiência'].every(t => statsText.includes(t)), statsText.slice(0, 160));
            // iniciar de novo e parar manualmente
            await page.locator('input[data-hunt-limit="battleLimit"]').uncheck();
            await page.locator('[data-hunt-action="start"]').click();
            await page.waitForFunction(() => game.isHuntRunning());
            await page.locator('[data-hunt-action="stop"]').click();
            await page.waitForFunction(() => /Parada/.test(document.querySelector('.hunt-state-label').textContent) && !/condição/.test(document.querySelector('.hunt-state-label').textContent));
            check(`Caça ${vp.name}: parar manualmente mostra ⚪ Parada`, await page.evaluate(() => game.getHuntSession().stopReason === 'manual'));
            check(`Caça ${vp.name}: sem rolagem horizontal ao final`, await noOverflow());
            // a Torre recusa entrar com a caçada rodando
            await page.locator('[data-hunt-action="start"]').click();
            await page.waitForFunction(() => game.isHuntRunning());
            check(`Caça ${vp.name}: Torre recusa entrada com a caçada rodando`, await page.evaluate(() => { const r = game.enterTower(); return r.success === false && /caçada/.test(r.message); }));
            // economia: Recursos / Loja / Upgrades / Análise dentro da aba Caça
            await page.evaluate(() => { game.dispatchAutomationAction({ type: 'STOP_HUNT' }); game.earnMoney(5000, 'reward'); });
            await page.locator('[data-hunt-section="shop"]').click();
            await page.waitForSelector('#hunt-shop [data-eco-action="buy-item"]');
            check(`Caça ${vp.name}: loja mostra poção com preço, efeito e estoque, e recursos no topo`, await page.evaluate(() => /Preço: \$\d/.test(document.getElementById('hunt-shop').innerText) && /Recupera/.test(document.getElementById('hunt-shop').innerText) && /💰/.test(document.getElementById('hunt-resources').innerText)));
            const potBefore = await page.evaluate(() => ({ p: game.getPotions(), m: game.getMoney(), price: game.getPotionPrice() }));
            await page.locator('#hunt-shop [data-qty="5"]').click();
            check(`Caça ${vp.name}: comprar 5 poções desconta moedas e soma ao estoque`, await page.evaluate((b) => game.getPotions() === b.p + 5 && game.gameState.economy.byReason.potion_purchase.spent >= 5 * b.price, potBefore));
            check(`Caça ${vp.name}: loja sem rolagem horizontal`, await noOverflow());
            await page.locator('[data-hunt-section="upgrades"]').click();
            await page.waitForSelector('#hunt-upgrades [data-eco-action="buy-upgrade"]');
            check(`Caça ${vp.name}: upgrades mostram custo e efeito ("Gastar $X para ir de A para B") e bloqueios`, await page.evaluate(() => /Gastar \$\d+ para ir de/.test(document.getElementById('hunt-upgrades').innerText) && /Requer/.test(document.getElementById('hunt-upgrades').innerText)));
            await page.locator('#hunt-upgrades [data-id="heal_efficiency"]').click();
            check(`Caça ${vp.name}: comprar upgrade sobe o nível`, await page.evaluate(() => game.getUpgradeLevel('heal_efficiency') === 1));
            check(`Caça ${vp.name}: upgrades sem rolagem horizontal`, await noOverflow());
            await page.locator('[data-hunt-section="analysis"]').click();
            await page.waitForSelector('#hunt-analysis [data-eco-action="set-goal"]');
            await page.locator('#hunt-analysis [data-goal="money"]').click();
            check(`Caça ${vp.name}: objetivo da análise muda e persiste`, await page.evaluate(() => game.getAnalyzerGoal() === 'money'));
            await page.locator('#hunt-analysis [data-eco-action="estimate"]').click();
            await page.waitForFunction(() => document.querySelectorAll('#hunt-analysis .hunt-badge-src.est').length >= 1, null, { timeout: 30000 });
            check(`Caça ${vp.name}: estimativas aparecem marcadas como "Estimado" e a rota não muda sozinha`, await page.evaluate(() => /Estimado/.test(document.getElementById('hunt-analysis').innerText) && game.gameState.currentRoute === 'kanto_route2'));
            check(`Caça ${vp.name}: análise sem rolagem horizontal`, await noOverflow());
            await page.locator('[data-hunt-section="ops"]').click();
            await context.close();
        }

        // fechar e reabrir com a caçada rodando: relatório "Durante sua ausência", sessão pausada, retomar
        {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: 360, height: 640 } });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            await page.evaluate(() => { game.setAutomationPolicy({ heal: { enabled: false } }); game.dispatchAutomationAction({ type: 'START_HUNT' }); });
            await sleep(1500);
            await page.evaluate(() => {
                const st = JSON.parse(JSON.stringify(game.gameState));
                st.lastSave = Date.now() - 20 * 60 * 1000;
                localStorage.setItem('pokemon_idle_save', SaveCodec.encodePayload(JSON.stringify(st)));
                game.saver.cancelPending();
                game.saveNow = () => ({ ok: true }); game.saver.flush = () => ({ ok: true });
            });
            await page.reload();
            await page.waitForSelector('#offline-report:not(.hidden)', { timeout: 30000 });
            const rep = await page.locator('#offline-report').innerText();
            check('Caça: relatório offline mostra "Durante sua ausência", poções, motivo/estado e recomendação', /Durante sua ausência/.test(rep) && /Poções usadas/.test(rep) && /Próxima recomendação/.test(rep) && /pausada/.test(rep), rep.slice(0, 200));
            await page.locator('.offline-report-close').click();
            await sleep(500);
            check('Caça: sessão volta pausada depois do offline', await page.evaluate(() => game.getHuntSession().state === 'paused' && !game.isHuntRunning()));
            await page.locator('#tab-nav [data-tab="tab-hunt"]').click();
            await page.waitForFunction(() => /Pausada/.test(document.querySelector('.hunt-state-label').textContent));
            await page.locator('[data-hunt-action="resume"]').click();
            await page.waitForFunction(() => /Caçando/.test(document.querySelector('.hunt-state-label').textContent));
            check('Caça: depois do offline dá para retomar', await page.evaluate(() => game.isHuntRunning()));
            await context.close();
        }

        // ---------- B3. F8.0 Central de Caça: alvo da caçada pela aba Caça (mobile e desktop), efeitos reais sobre a sessão ----------
        for (const vp of [{ name: 'celular 360x640', width: 360, height: 640 }, { name: 'desktop 1280x800', width: 1280, height: 800 }]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height } });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            await page.locator('#tab-nav [data-tab="tab-hunt"]').click();
            await page.waitForSelector('#hunt-target [data-hunt-target-search]');
            const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('hunt-container').scrollWidth <= document.getElementById('hunt-container').clientWidth + 1);
            check(`Central ${vp.name}: o card do alvo existe, os botões de alvo começam desabilitados e há busca`, await page.evaluate(() => { const t = document.getElementById('hunt-target'); return /Alvo da caçada/.test(t.innerText) && t.querySelector('[data-hunt-action="target-start"]').disabled && t.querySelector('[data-hunt-action="target-open-map"]').disabled; }));
            await page.locator('#hunt-target [data-hunt-target-search]').fill('25');
            await page.waitForSelector('#hunt-target [data-hunt-action="target-pick"]');
            await page.locator('#hunt-target [data-hunt-action="target-pick"]').first().click();
            check(`Central ${vp.name}: escolher a espécie mostra bioma e habilita iniciar e abrir no mapa`, await page.evaluate(() => { const t = document.getElementById('hunt-target'); return /Bioma: \S+/.test(t.innerText) && !t.querySelector('[data-hunt-action="target-start"]').disabled && !t.querySelector('[data-hunt-action="target-open-map"]').disabled && game.getHuntSession() === null; }));
            check(`Central ${vp.name}: botões com pelo menos 44 px de altura e sem rolagem horizontal`, await page.evaluate(() => [...document.querySelectorAll('#hunt-target .hunt-btn')].every(b => b.getBoundingClientRect().height >= 44)) && await noOverflow());
            await page.locator('#hunt-target [data-hunt-action="target-start"]').click();
            await page.waitForFunction(() => game.isHuntRunning() && gameUI.worldEncounters.cycle !== null, null, { timeout: 5000 });
            const started = await page.evaluate(() => ({ id: game.getHuntSession().id, species: gameUI.worldEncounters.cycle.speciesId, text: document.getElementById('hunt-target').innerText }));
            check(`Central ${vp.name}: iniciar usa o fluxo oficial — sessão ativa, ciclo do mapa da espécie e texto "Caminhando"`, started.species === 25 && /Caminhando|Chegou|Batalha/.test(started.text), JSON.stringify(started));
            // pausar → retomar rápido pelos botões reais: mesma sessão, progresso preservado
            await page.evaluate(() => { window.__prog = gameUI.worldEncounters.status().progressPx; });
            await page.locator('[data-hunt-action="pause"]').click();
            await page.waitForFunction(() => game.getHuntSession().state === 'paused');
            const frozen = await page.evaluate(async () => { const a = gameUI.worldEncounters.status().progressPx; await new Promise(r => setTimeout(r, 700)); return { a, b: gameUI.worldEncounters.status().progressPx }; });
            check(`Central ${vp.name}: pausar congela o deslocamento e a tela mostra Pausada`, frozen.a === frozen.b && await page.evaluate(() => /Pausada/.test(document.getElementById('hunt-target').innerText)), JSON.stringify(frozen));
            await page.locator('[data-hunt-action="resume"]').click();
            await page.waitForFunction(() => game.getHuntSession().state === 'running');
            check(`Central ${vp.name}: retomar mantém a MESMA sessão e o progresso não recua`, await page.evaluate((id) => game.getHuntSession().id === id && gameUI.worldEncounters.status().progressPx >= window.__prog, started.id));
            // trocar de aba interna e voltar: a caçada não é interrompida e a tela volta ao estado atual
            await page.locator('#tab-nav [data-tab="tab-map"]').click();
            await sleep(600);
            check(`Central ${vp.name}: trocar para o Mapa não interrompe a caçada nem duplica a sessão`, await page.evaluate((id) => game.getHuntSession().id === id && game.isHuntRunning() && gameUI.worldEncounters.cycle !== null, started.id));
            await page.locator('#tab-nav [data-tab="tab-hunt"]').click();
            await page.waitForSelector('#hunt-target [data-hunt-target-text]');
            check(`Central ${vp.name}: voltar à aba Caça mostra o estado atual sem recriar a sessão`, await page.evaluate((id) => game.getHuntSession().id === id && /Caminhando|Chegou|Batalha/.test(document.getElementById('hunt-target').innerText), started.id));
            // abrir no mapa: só navega
            await page.locator('#hunt-target [data-hunt-action="target-open-map"]').click();
            check(`Central ${vp.name}: Abrir no Mapa mostra a aba Mapa na área da espécie, sem trocar a rota nem a sessão`, await page.evaluate((id) => document.getElementById('tab-map').classList.contains('active') && gameUI.worldView.areaId === 'hunt_25' && game.getHuntSession().id === id, started.id));
            await page.locator('#tab-nav [data-tab="tab-hunt"]').click();
            await page.locator('[data-hunt-action="stop"]').click();
            await page.waitForFunction(() => game.getHuntSession().state === 'stopped');
            check(`Central ${vp.name}: encerrar limpa o ciclo e a tela volta a "Nenhum alvo ativo"`, await page.evaluate(() => gameUI.worldEncounters.cycle === null && /Nenhum alvo ativo|Escolha/.test(document.getElementById('hunt-target').innerText)));
            await context.close();
        }

        // ---------- B3b. F8.3 sprites do encontro no Mapa (mobile e desktop): espécie certa, proporção, sem imagem retida após parar ----------
        for (const vp of [{ name: 'celular 360x640', width: 360, height: 640, dpr: 3 }, { name: 'desktop 1280x800', width: 1280, height: 800, dpr: 1 }]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            await page.click('[data-tab="tab-map"]');
            await page.waitForFunction(() => gameUI.worldView.drawCount > 0, null, { timeout: 10000 });
            await page.evaluate(() => gameUI.worldView.openHuntMap(25));
            await page.waitForFunction(() => !document.getElementById('world-encounter-btn').disabled, null, { timeout: 5000 });
            await page.evaluate(() => document.getElementById('world-encounter-btn').click());
            await page.waitForFunction(() => gameUI.worldView._enc && [...gameUI.worldView._enc.values()].some(e => e.ready), null, { timeout: 10000 });
            const spr = await page.evaluate(() => { const e = [...gameUI.worldView._enc.values()][0]; return { n: gameUI.worldView._enc.size, id: e.id, src: e.img.getAttribute('src'), w: e.img.naturalWidth, h: e.img.naturalHeight, box: e.box, smooth: document.getElementById('world-canvas').getContext('2d').imageSmoothingEnabled }; });
            check(`Sprite ${vp.name}: imagem da espécie do ciclo (#25), normal, carregada com o tamanho real do PNG`, spr.n === 1 && spr.id === 25 && spr.src === 'sprites/pokemon/25.png' && spr.w === 96 && spr.h === 96, JSON.stringify(spr));
            check(`Sprite ${vp.name}: caixa opaca lida do PNG e canvas sem suavização`, !!spr.box && spr.box.x1 > spr.box.x0 && spr.box.y1 > spr.box.y0 && spr.smooth === false, JSON.stringify(spr));
            await page.evaluate(() => { const e = gameUI.worldEncounters, lg = e.cycle.leg; lg.progressPx = lg.lengthPx; lg.state = 'arrived'; e.current.state = 'arrived'; window.__dc = gameUI.worldView.drawCount; gameUI.worldView.requestRedraw(true); });   // sonda visual: coloca o treinador no ponto (só estado de teste)
            await page.waitForFunction(() => gameUI.worldView.drawCount > window.__dc && !gameUI.worldView._fxRunning(), null, { timeout: 5000 });     // F8.4: espera a entrada (fade) terminar
            await page.waitForTimeout(100);
            check(`Sprite ${vp.name}: o Pokémon está pintado no canvas, junto ao ponto (pixels amarelos do Pikachu na região do sprite)`, await page.evaluate(() => { const wv = gameUI.worldView, c = gameUI.worldEncounters.current, m = wv.lastMetrics, cam = wv.lastCamera, off = wv._encounterOffset(c), cv = document.getElementById('world-canvas'); const p = worldToScreen(cam, m, (c.point.x + 0.5) * 16 + off.dx, (c.point.y + 0.5) * 16 + 6 + off.dy), z = m.zoom; const x0 = Math.max(0, Math.round(p.x - 24 * z)), y0 = Math.max(0, Math.round(p.y - 36 * z)), w = Math.min(cv.width - x0, 48 * z), h = Math.min(cv.height - y0, 36 * z); if (w <= 0 || h <= 0) return false; const px = cv.getContext('2d').getImageData(x0, y0, w, h).data; let yellow = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 170 && px[i + 2] < 90) yellow++; return yellow > 10 * z; }));
            await page.evaluate(() => { game.dispatchAutomationAction({ type: 'STOP_HUNT' }); gameUI.worldEncounters.cancel('smoke'); gameUI.worldView.requestRedraw(true); });
            await page.waitForFunction(() => gameUI.worldView._enc === null, null, { timeout: 5000 });
            check(`Sprite ${vp.name}: ao parar a caçada nenhuma imagem do encontro fica retida`, await page.evaluate(() => gameUI.worldView._enc === null && gameUI.worldEncounters.cycle === null));
            await context.close();
        }

        // ---------- B3c. F8.4 transições do encontro no Mapa (celular, desktop e movimento reduzido): efeitos reais, limpeza e ociosidade ----------
        for (const vp of [{ name: 'celular 360x640', width: 360, height: 640, dpr: 3, reduced: false }, { name: 'desktop 1280x800', width: 1280, height: 800, dpr: 1, reduced: false }, { name: 'celular com movimento reduzido', width: 360, height: 640, dpr: 3, reduced: true }]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, reducedMotion: vp.reduced ? 'reduce' : 'no-preference' });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            await page.click('[data-tab="tab-map"]');
            await page.waitForFunction(() => gameUI.worldView.drawCount > 0, null, { timeout: 10000 });
            await page.evaluate(() => gameUI.worldView.openHuntMap(25));
            await page.waitForFunction(() => !document.getElementById('world-encounter-btn').disabled, null, { timeout: 5000 });
            await page.evaluate(() => { window.__raf = 0; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (fn) => { window.__raf++; return raf(fn); }; window.__tm = 0; const st = window.setTimeout.bind(window); window.setTimeout = (...a) => { window.__tm++; return st(...a); }; window.__si = 0; const si = window.setInterval.bind(window); window.setInterval = (...a) => { window.__si++; return si(...a); }; });
            await page.evaluate(() => document.getElementById('world-encounter-btn').click());
            await page.waitForFunction(() => gameUI.worldView._enc && [...gameUI.worldView._enc.values()].some(e => e.ready), null, { timeout: 10000 });
            const entered = await page.evaluate(() => { const f = gameUI.worldView._fx; return !!(f && f.enter); });
            check(`Transição ${vp.name}: a entrada do Pokémon ${vp.reduced ? 'não anima (movimento reduzido)' : 'anima'}`, entered === !vp.reduced);
            // chegada pelo caminho oficial; termina a batalha de rota em curso até a do encontro começar
            await page.evaluate(() => { const e = gameUI.worldEncounters, lg = e.cycle.leg; lg.progressPx = lg.lengthPx; e._advance(game.now()); });
            for (let i = 0; i < 100 && await page.evaluate(() => gameUI.worldEncounters.current.state) !== 'battling'; i++) {
                await page.evaluate(() => { const bt = game.currentBattle; if (bt) { bt.wildCurrentHp = 1; bt.playerTimer = bt.playerNextAttack; bt.enemyTimer = 0; const sv = game.rng; game.rng = () => 0.99; game.battleTick(); game.rng = sv; } });
                await page.waitForTimeout(300);
            }
            check(`Transição ${vp.name}: a batalha do encontro começa e o indicador de combate aparece (anel vermelho no canvas)`, await page.evaluate(async () => {
                await new Promise(r => setTimeout(r, 900));
                const wv = gameUI.worldView, cv = document.getElementById('world-canvas'), px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
                let red = 0; for (let i = 0; i < px.length; i += 4) if (px[i] === 229 && px[i + 1] === 72 && px[i + 2] === 77) red++;
                return gameUI.worldEncounters.current.state === 'battling' && red > 20 && !wv._fxRunning();
            }));
            const idle = await page.evaluate(async () => { const a = window.__raf, t = window.__tm, i = window.__si; await new Promise(r => setTimeout(r, 900)); return { raf: window.__raf - a, setTimeout: window.__tm - t - 1, setInterval: window.__si - i }; });
            check(`Transição ${vp.name}: batalha em curso e treinador parado → nenhum quadro nem timer novo (ocioso)`, idle.raf === 0 && idle.setInterval === 0, JSON.stringify(idle));
            await page.evaluate(() => { const bt = game.currentBattle; bt.wildCurrentHp = 1; bt.playerTimer = bt.playerNextAttack; bt.enemyTimer = 0; const sv = game.rng; game.rng = () => 0.99; game.battleTick(); game.rng = sv; });
            await page.waitForTimeout(100);
            const exit = await page.evaluate(() => { const f = gameUI.worldView._fx; return f && f.exit ? { label: f.exit.label && f.exit.label.text, reduced: f.exit.reduced } : null; });
            check(`Transição ${vp.name}: o desfecho real (captura) aparece como rótulo e respeita o movimento reduzido`, !!exit && /^(Capturado!|Vitória)$/.test(exit.label) && exit.reduced === vp.reduced, JSON.stringify(exit));
            await page.waitForFunction(() => gameUI.worldView._fx === null, null, { timeout: 5000 });
            check(`Transição ${vp.name}: depois do desfecho nenhum efeito sobra`, await page.evaluate(() => gameUI.worldView._fx === null));
            await page.evaluate(() => { gameUI.worldEncounters.cancel('smoke'); game.dispatchAutomationAction({ type: 'STOP_HUNT' }); gameUI.worldView.requestRedraw(true); });
            await page.waitForFunction(() => gameUI.worldView._enc === null && gameUI.worldView._fx === null, null, { timeout: 5000 });
            check(`Transição ${vp.name}: ao parar a caçada não restam imagem, efeito nem observação ativa`, await page.evaluate(() => gameUI.worldView._enc === null && !gameUI.worldView._fxRunning() && !(gameUI.worldView._seen && gameUI.worldView._seen.active)));
            await context.close();
        }

        // ---------- B3d. F9.1 cadeia de shiny na Central de Caça (celular e desktop): linha só com cadeia > 0, no teto e depois da derrota ----------
        for (const vp of [{ name: 'celular 360x640', width: 360, height: 640 }, { name: 'desktop 1280x800', width: 1280, height: 800 }]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height } });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            await page.locator('#tab-nav [data-tab="tab-hunt"]').click();
            await page.waitForSelector('#hunt-target [data-hunt-target-search]');
            await page.locator('#hunt-target [data-hunt-target-search]').fill('25');
            await page.waitForSelector('#hunt-target [data-hunt-action="target-pick"]');
            await page.locator('#hunt-target [data-hunt-action="target-pick"]').first().click();
            await page.locator('#hunt-target [data-hunt-action="target-start"]').click();
            await page.waitForFunction(() => game.isHuntRunning(), null, { timeout: 5000 });
            const line = () => page.evaluate(() => { const el = document.querySelector('#hunt-target [data-hunt-shiny-chain]'); return el ? el.innerText.trim() : null; });
            const fit = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('hunt-container').scrollWidth <= document.getElementById('hunt-container').clientWidth + 1);
            check(`Cadeia ${vp.name}: sem cadeia a linha não aparece`, (await line()) === null);
            // vitórias reais pelo evento oficial (o mesmo que o motor emite): a linha aparece e cresce
            await page.evaluate(() => { for (let i = 0; i < 12; i++) game._emit('battle_completed', { result: 'victory', enemyId: 25, xp: 1, gold: 1, route: game.gameState.currentRoute }); });
            await page.waitForFunction(() => document.querySelector('#hunt-target [data-hunt-shiny-chain]'), null, { timeout: 5000 });
            check(`Cadeia ${vp.name}: "Cadeia: 12 · +60% shiny" aparece depois de 12 vitórias seguidas`, /^Cadeia: 12 · \+60% shiny$/.test(await line()), String(await line()));
            check(`Cadeia ${vp.name}: sem rolagem horizontal com a linha visível`, await fit());
            await page.evaluate(() => { for (let i = 0; i < 40; i++) game._emit('battle_completed', { result: 'victory', enemyId: 25, xp: 1, gold: 1, route: game.gameState.currentRoute }); });
            await page.waitForFunction(() => /máx/.test((document.querySelector('#hunt-target [data-hunt-shiny-chain]') || {}).innerText || ''), null, { timeout: 5000 });
            check(`Cadeia ${vp.name}: no teto mostra "+200% shiny (máx.)"`, /\+200% shiny \(máx\.\)/.test(await line()), String(await line()));
            await page.evaluate(() => game._emit('battle_completed', { result: 'defeat', enemyId: 25, xp: 0, gold: 0, route: game.gameState.currentRoute, tower: false }));
            await page.waitForFunction(() => !document.querySelector('#hunt-target [data-hunt-shiny-chain]'), null, { timeout: 5000 });
            check(`Cadeia ${vp.name}: com o líder derrotado a linha some`, (await line()) === null && !(await page.evaluate(() => game.getHuntSession().shinyChain)));
            await context.close();
        }

        // ---------- B3e. F9.2 Pokémon líder seguindo o treinador (celular e desktop): desenhado no canvas, atrás do treinador, ocioso sem quadros, limpo ao sair ----------
        for (const vp of [{ name: 'celular 360x640', width: 360, height: 640, dpr: 3 }, { name: 'desktop 1280x800', width: 1280, height: 800, dpr: 1 }]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            await page.click('[data-tab="tab-map"]');
            await page.waitForFunction(() => gameUI.worldView.drawCount > 0 && gameUI.worldView._fol && gameUI.worldView._fol.cur && gameUI.worldView._fol.cur.ready, null, { timeout: 10000 });
            await page.evaluate(() => { window.__raf = 0; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (fn) => { window.__raf++; return raf(fn); }; window.__tm = 0; const st = window.setTimeout.bind(window); window.setTimeout = (...a) => { window.__tm++; return st(...a); }; });
            check(`Seguidor ${vp.name}: o sprite do líder (Pikachu #25) é carregado numa entrada própria`, await page.evaluate(() => { const f = gameUI.worldView._fol.cur; return f.id === 25 && f.shiny === false && f.img.getAttribute('src') === 'sprites/pokemon/25.png' && f.img.naturalWidth > 0; }));
            check(`Seguidor ${vp.name}: o líder aparece pintado no canvas junto do treinador (pixels amarelos na região do seguidor)`, await page.evaluate(() => {
                const wv = gameUI.worldView, map = wv.currentScene().map, pl = wv._player(map), m = wv.lastMetrics, cam = wv.lastCamera, cv = document.getElementById('world-canvas'), z = m.zoom;
                const fp = wv._followerPoint(map, pl), p = worldToScreen(cam, m, fp.x, fp.y);
                const x0 = Math.max(0, Math.round(p.x - 14 * z)), y0 = Math.max(0, Math.round(p.y - 26 * z)), w = Math.min(cv.width - x0, 28 * z), h = Math.min(cv.height - y0, 28 * z);
                if (w <= 0 || h <= 0) return false;
                const px = cv.getContext('2d').getImageData(x0, y0, w, h).data; let yellow = 0;
                for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 170 && px[i + 2] < 90) yellow++;
                return yellow > 6 * z;
            }));
            const idle = await page.evaluate(async () => { const a = window.__raf, t = window.__tm; await new Promise(r => setTimeout(r, 800)); return { raf: window.__raf - a, tm: window.__tm - t - 1 }; });
            check(`Seguidor ${vp.name}: treinador parado → nenhum quadro nem timer novo (ocioso)`, idle.raf === 0 && idle.tm === 0, JSON.stringify(idle));
            // caminhada da caçada: o seguidor fica atrás do treinador (entre 8 e 34 px de distância, nunca em cima)
            await page.evaluate(() => gameUI.worldView.openHuntMap(25));
            await page.waitForFunction(() => !document.getElementById('world-encounter-btn').disabled, null, { timeout: 5000 });
            await page.evaluate(() => document.getElementById('world-encounter-btn').click());
            await page.waitForTimeout(3500);
            const gap = await page.evaluate(() => { const wv = gameUI.worldView, map = wv.currentScene().map, pl = wv._player(map), fp = wv._followerPoint(map, pl); return { d: Math.hypot(pl.x - fp.x, pl.y - fp.y), moving: !!pl.moving }; });
            check(`Seguidor ${vp.name}: andando, fica 1 a 2 passos atrás do treinador (${gap.d.toFixed(1)} px)`, gap.moving && gap.d >= 8 && gap.d <= 34, JSON.stringify(gap));
            await page.evaluate(() => { gameUI.worldEncounters.cancel('smoke'); game.dispatchAutomationAction({ type: 'STOP_HUNT' }); });
            await page.click('[data-tab="tab-hunt"]');
            await page.waitForFunction(() => gameUI.worldView._fol === null && gameUI.worldView._trail === null, null, { timeout: 5000 });
            check(`Seguidor ${vp.name}: ao sair da aba do mapa o seguidor e o rastro são limpos`, true);
            await context.close();
        }

        // ---------- B3f. F9.3 natureza com efeito: ▲/▼ na equipe, no PC e no detalhamento dos atributos (celular e desktop) ----------
        for (const vp of [{ name: 'celular 360x640', width: 360, height: 640 }, { name: 'desktop 1280x800', width: 1280, height: 800 }]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height } });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
            const before = await page.evaluate(() => { const s = game.calculateBattleStats(0); return { attack: s.attack, speed: s.speed, text: (document.querySelector('.slot-traits') || {}).innerText || '' }; });
            check(`Natureza ${vp.name}: o líder inicial (neutro) aparece só com o nome, sem ▲/▼`, !/[▲▼]/.test(before.text) && /Esforçada/.test(before.text), before.text);
            await page.evaluate(() => { const gs = game.gameState, inst = gs.ownedPokemon[gs.party[0]]; inst.level = 100; inst.nature = 'adamant'; game._touchInstance(inst); gameUI.renderTeam(); });
            const after = await page.evaluate(() => ({ s: game.calculateBattleStats(0), text: document.querySelector('.slot-traits').innerText }));
            check(`Natureza ${vp.name}: equipe mostra "Firme ▲Atq ▼Atq.Esp" e os atributos usam a natureza`, /Firme ▲Atq ▼Atq\.Esp/.test(after.text), after.text);
            const raw = await page.evaluate(() => { const gs = game.gameState, inst = gs.ownedPokemon[gs.party[0]]; inst.nature = 'hardy'; game._touchInstance(inst); const n = game.calculateBattleStats(0); inst.nature = 'adamant'; game._touchInstance(inst); const a = game.calculateBattleStats(0); return { neutral: [n.rawAtk, n.rawSpAtk], adamant: [a.rawAtk, a.rawSpAtk] }; });
            check(`Natureza ${vp.name}: +10% em Atq e −10% em Atq.Esp (floor) sobre o neutro, no navegador`, raw.adamant[0] === Math.floor(raw.neutral[0] * 110 / 100) && raw.adamant[1] === Math.floor(raw.neutral[1] * 90 / 100), JSON.stringify(raw));
            check(`Natureza ${vp.name}: o detalhamento dos atributos mostra o efeito da natureza (Alegre: +Vel sempre muda o atributo, quaisquer que sejam os IVs)`, await page.evaluate(() => { const gs = game.gameState, inst = gs.ownedPokemon[gs.party[0]]; inst.nature = 'jolly'; game._touchInstance(inst); const html = gameUI._renderBattleStatSources(); inst.nature = 'adamant'; game._touchInstance(inst); return /Natureza: ▲ \+\d+ \(já em Próprio\)/.test(html); }));
            await page.locator('#tab-nav [data-tab="tab-pc"]').click();
            await page.evaluate(() => gameUI.pcView && gameUI.pcView.render && gameUI.pcView.render());
            check(`Natureza ${vp.name}: sem rolagem horizontal com os indicadores`, await noOverflow());
            await context.close();
        }

        // ---------- B4. F8.1 fila de alvos na Central (mobile e desktop): montar, iniciar, pausar, interromper, continuar, limpar ----------
        for (const vp of [{ name: 'celular 360x640', width: 360, height: 640 }, { name: 'desktop 1280x800', width: 1280, height: 800 }]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height } });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 10000 });
            await page.locator('#tab-nav [data-tab="tab-hunt"]').click();
            await page.waitForSelector('#hunt-queue');
            const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('hunt-container').scrollWidth <= document.getElementById('hunt-container').clientWidth + 1);
            const addTarget = async (id, value, type = 'time') => {
                await page.locator('#hunt-target [data-hunt-target-search]').fill(String(id));
                await page.locator(`#hunt-target [data-hunt-action="target-pick"][data-id="${id}"]`).click();
                await page.locator('#hunt-target [data-hunt-queue-type]').selectOption(type);
                await page.locator('#hunt-target [data-hunt-queue-value]').fill(String(value));
                await page.locator('#hunt-queue [data-hunt-action="queue-add"]').click();
            };
            check(`Fila ${vp.name}: começa vazia e sem iniciar`, await page.evaluate(() => /Fila vazia/.test(document.getElementById('hunt-queue').innerText) && document.querySelector('#hunt-queue [data-hunt-action="queue-start"]').disabled));
            await addTarget(25, 2); await addTarget(16, 3);
            check(`Fila ${vp.name}: adicionar pela busca monta a fila na ordem, com a duração de cada alvo`, await page.evaluate(() => { const v = gameUI.huntQueue.view(); return v.items.length === 2 && v.items[0].speciesId === 25 && v.items[0].condition.type === 'time' && v.items[0].condition.value === 2 && v.items[1].speciesId === 16 && v.items[1].condition.value === 3 && document.querySelectorAll('#hunt-queue .hunt-queue-item').length === 2; }));
            await addTarget(1, 7, 'battles');
            check(`Fila ${vp.name}: alvo por batalhas — o campo muda para quantidade, a fila mostra "7 batalhas" e guarda a condição`, await page.evaluate(() => { const v = gameUI.huntQueue.view(); const it = v.items[2]; return it && it.speciesId === 1 && it.condition.type === 'battles' && it.condition.value === 7 && /7 batalhas/.test(document.getElementById('hunt-queue').innerText) && /Quantidade de batalhas/.test(document.getElementById('hunt-target-pick').innerText); }));
            await page.locator('#hunt-queue [data-hunt-action="queue-remove"][data-index="2"]').click();
            await page.locator('#hunt-queue [data-hunt-action="queue-down"][data-index="0"]').click();
            await page.locator('#hunt-queue [data-hunt-action="queue-up"][data-index="1"]').click();
            check(`Fila ${vp.name}: reordenar pendentes funciona e a tela lê a fila do jogo`, await page.evaluate(() => gameUI.huntQueue.view().items.map(i => i.speciesId).join() === '25,16'));
            check(`Fila ${vp.name}: botões com pelo menos 44 px e sem rolagem horizontal`, await page.evaluate(() => [...document.querySelectorAll('#hunt-queue .hunt-btn')].every(b => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().width >= 44)) && await noOverflow());
            await page.locator('#hunt-queue [data-hunt-action="queue-start"]').click();
            await page.waitForFunction(() => game.isHuntRunning() && gameUI.huntQueue.view().state === 'running', null, { timeout: 5000 });
            const run = await page.evaluate(() => ({ species: gameUI.worldEncounters.cycle.speciesId, id: game.getHuntSession().id, qs: gameUI.huntQueue.view().sessionId, text: document.getElementById('hunt-queue').innerText }));
            check(`Fila ${vp.name}: iniciar a fila começa o 1º alvo pela entrada oficial (uma sessão, um ciclo) e marca o ativo`, run.species === 25 && run.id === run.qs && /alvo 1 de 2/.test(run.text), JSON.stringify(run));
            check(`Fila ${vp.name}: com a fila rodando, iniciar de novo e limpar ficam desabilitados`, await page.evaluate(() => { const plain = document.querySelector('[data-hunt-action="start"]'); return document.querySelector('#hunt-queue [data-hunt-action="queue-start"]').disabled && document.querySelector('#hunt-queue [data-hunt-action="queue-clear"]').disabled && (plain === null || plain.disabled); }));
            await page.locator('[data-hunt-action="pause"]').click();
            await page.waitForFunction(() => game.getHuntSession().state === 'paused');
            check(`Fila ${vp.name}: pausar mantém a fila na mesma posição`, await page.evaluate((id) => gameUI.huntQueue.view().index === 0 && gameUI.huntQueue.view().sessionId === id && /Fila pausada/.test(document.getElementById('hunt-queue').innerText), run.id));
            await page.locator('#tab-nav [data-tab="tab-map"]').click();
            await sleep(400);
            await page.locator('#tab-nav [data-tab="tab-hunt"]').click();
            check(`Fila ${vp.name}: trocar de aba não altera a fila nem a sessão`, await page.evaluate((id) => gameUI.huntQueue.view().sessionId === id && game.getHuntSession().id === id && gameUI.huntQueue.view().index === 0, run.id));
            await page.locator('[data-hunt-action="stop"]').click();
            await page.waitForFunction(() => gameUI.huntQueue.view().state === 'halted');
            check(`Fila ${vp.name}: encerrar interrompe a fila na posição e oferece continuar`, await page.evaluate(() => /CONTINUAR FILA/.test(document.getElementById('hunt-queue').innerText) && gameUI.huntQueue.view().index === 0 && gameUI.huntQueue.view().total === 2));
            await page.locator('#hunt-queue [data-hunt-action="queue-start"]').click();
            await page.waitForFunction(() => game.isHuntRunning());
            check(`Fila ${vp.name}: continuar recomeça o mesmo alvo numa sessão nova`, await page.evaluate((old) => game.getHuntSession().id !== old && gameUI.worldEncounters.cycle.speciesId === 25, run.id));
            await page.locator('[data-hunt-action="stop"]').click();
            await page.waitForFunction(() => gameUI.huntQueue.view().state === 'halted');
            await page.locator('#hunt-queue [data-hunt-action="queue-clear"]').click();
            check(`Fila ${vp.name}: limpar volta a fila vazia`, await page.evaluate(() => gameUI.huntQueue.view().total === 0 && /Fila vazia/.test(document.getElementById('hunt-queue').innerText)) && await noOverflow());
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

            // 先等加载时的离线结算（旧存档的 lastSave 很早，会在后台分批跑真实战斗）真正结束，再导出。
            // 否则导出/导入的前后快照会被仍在写入名册的模拟污染（见 F7.0）。超时则明确报错，不会悄悄放过。
            const offlineDone = await page.waitForFunction(() => !game._isOfflineSimulating && !game._offlineSimState, null, { timeout: 60000 }).then(() => true, () => false);
            check('离线结算在导出前已结束（simulação offline terminou antes de exportar o save）', offlineDone,
                'timeout de 60 s: game._isOfflineSimulating continua true; o teste de exportação/importação não é confiável sem isso');
            if (!offlineDone) throw new Error('A simulação offline do carregamento não terminou em 60 s; abortando o teste de exportação/importação.');

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

        // ---------- Mundo visual (F7.1/F7.2): aba Mapa = cidade inicial (Canvas) com caminhada manual, Centro Pokémon e Depot ----------
        for (const vp of [
            { name: 'celular 360x640', width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
            { name: 'desktop 1280x800', width: 1280, height: 800, deviceScaleFactor: 1 },
        ]) {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            await page.evaluate(() => { window.__raf = 0; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (fn) => { window.__raf++; return raf(fn); }; });
            const routeBefore = await page.evaluate(() => game.gameState.currentRoute);
            const inactive = await page.evaluate(() => ({ active: gameUI.worldView.active, draws: gameUI.worldView.drawCount }));
            await page.click('[data-tab="tab-map"]');
            await page.waitForFunction(() => gameUI.worldView.drawCount > 0, null, { timeout: 10000 });
            await page.waitForFunction(() => gameUI.worldView._fol && gameUI.worldView._fol.cur && gameUI.worldView._fol.cur.ready, null, { timeout: 10000 });     // F9.2: o sprite do líder carrega depois do 1º quadro e pede UM redesenho; espera antes de medir a ociosidade
            await sleep(150);
            const probe = () => page.evaluate(() => {
                const c = document.getElementById('world-canvas'), r = c.getBoundingClientRect();
                const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                const colors = new Set(); let hero = 0;
                for (let i = 0; i < px.length; i += 4) { if (i % 20 === 0) colors.add(px[i] << 16 | px[i + 1] << 8 | px[i + 2]); if (px[i] === 31 && px[i + 1] === 163 && px[i + 2] === 163) hero++; }
                const wv = gameUI.worldView, map = wv.currentScene().map, pl = wv._player(map);
                const pad = document.querySelector('.world-dpad'), padBtn = document.querySelector('[data-dir="up"]');
                return {
                    bw: c.width, bh: c.height, cw: r.width, ch: r.height, dpr: window.devicePixelRatio, colors: colors.size, hero,
                    route: game.gameState.currentRoute, active: wv.active, draws: wv.drawCount, area: wv.areaId,
                    zoom: wv.lastMetrics && wv.lastMetrics.zoom, sw: document.documentElement.scrollWidth, iw: window.innerWidth,
                    routes: document.querySelectorAll('#route-list .route-card').length, regions: document.querySelectorAll('#region-list .region-card').length,
                    rendering: getComputedStyle(c).imageRendering, aria: c.getAttribute('aria-label'), caption: document.getElementById('world-caption').textContent,
                    hint: document.getElementById('world-hint').textContent, px: pl.x, py: pl.y, dist: pl.distance, moving: pl.moving,
                    padShown: getComputedStyle(pad).display !== 'none', padBtn: padBtn ? padBtn.getBoundingClientRect().width : 0,
                    controlsHidden: document.getElementById('world-controls').hidden, interactDisabled: document.getElementById('world-interact').disabled,
                    pcActive: document.getElementById('tab-pc').classList.contains('active'),
                };
            });
            // andar: teclado no desktop; no celular, o direcional (eventos de ponteiro sintéticos, não toque físico)
            const hold = async (dir, ms) => {
                const code = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' }[dir];
                if (vp.isMobile) {
                    await page.evaluate((d) => document.querySelector(`[data-dir="${d}"]`).dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true, cancelable: true, isPrimary: true })), dir);
                    await sleep(ms);
                    await page.evaluate((d) => document.querySelector(`[data-dir="${d}"]`).dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })), dir);
                } else { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); }
                await sleep(120);
            };
            const a = await probe();
            check(`Mundo ${vp.name}: antes de abrir a aba o renderer está inativo e não desenhou`, inactive.active === false && inactive.draws === 0, JSON.stringify(inactive));
            check(`Mundo ${vp.name}: abre na cidade inicial, com buffer = tamanho CSS x dpr e zoom inteiro`, a.area === 'starter_town' && a.bw === Math.round(a.cw * a.dpr) && a.bh === Math.round(a.ch * a.dpr) && Number.isInteger(a.zoom) && a.zoom >= 2, JSON.stringify(a));
            check(`Mundo ${vp.name}: cenário variado (não é uma cor lisa) e personagem visível`, a.colors >= 14 && a.hero > 20, JSON.stringify({ colors: a.colors, hero: a.hero }));
            check(`Mundo ${vp.name}: pixel art nítida, rótulo acessível e legenda em português`, /pixelated|crisp-edges/.test(a.rendering) && /Cidade Inicial/.test(a.aria) && /Cidade Inicial/.test(a.caption), JSON.stringify({ r: a.rendering, aria: a.aria }));
            check(`Mundo ${vp.name}: sem rolagem horizontal; listas de regiões e rotas continuam na aba`, a.sw <= a.iw + 1 && a.routes > 0 && a.regions > 0, JSON.stringify({ sw: a.sw, iw: a.iw, routes: a.routes, regions: a.regions }));
            check(`Mundo ${vp.name}: puramente visual: a rota do jogo não mudou`, a.route === routeBefore, `${routeBefore} → ${a.route}`);
            check(`Mundo ${vp.name}: direcional na tela só em telas de toque, com botões de pelo menos 44 px`, vp.isMobile ? (a.padShown && a.padBtn >= 44) : !a.padShown, JSON.stringify({ shown: a.padShown, w: a.padBtn }));

            // parada: sem pedir quadros de animação nem redesenhar
            const rafBefore = await page.evaluate(() => window.__raf);
            await sleep(1200);
            const idle = await probe();
            check(`Mundo ${vp.name}: cena parada não pede quadros nem redesenha (sem loop)`, (await page.evaluate(() => window.__raf)) === rafBefore && idle.draws === a.draws, JSON.stringify({ rafBefore, draws: [a.draws, idle.draws] }));

            // caminhar de verdade até o Centro Pokémon: esquerda, cima, esquerda (a distância usa o tempo real, sem depender da taxa de quadros)
            await hold('left', 500); await hold('up', 900); await hold('left', 1300);
            const walked = await probe();
            const dx = a.px - walked.px, dy = a.py - walked.py;
            check(`Mundo ${vp.name}: caminhada manual anda (≈64 px/s, sem teleporte) e acumula a distância`, dx > 80 && dx < 140 && dy > 45 && dy < 75 && walked.dist > 140 && walked.dist < 215 && !walked.moving, JSON.stringify({ dx, dy, dist: walked.dist }));
            const rafWalk = await page.evaluate(() => window.__raf);
            await sleep(600);
            check(`Mundo ${vp.name}: ao soltar a direção o loop de quadros para`, (await page.evaluate(() => window.__raf)) === rafWalk, 'continuou pedindo quadros parado');
            check(`Mundo ${vp.name}: perto do Centro Pokémon o botão Interagir habilita e mostra a dica`, walked.interactDisabled === false && /Centro Pok/.test(walked.hint), JSON.stringify({ d: walked.interactDisabled, hint: walked.hint }));

            // Centro Pokémon: cura o HP da batalha (mesma regra da poção, sem gastar poção)
            await page.evaluate(() => { game.currentBattle.playerCurrentHp = 1; });
            const potionsBefore = await page.evaluate(() => game.getPotions());
            await page.click('#world-interact');
            await sleep(200);
            const healed = await page.evaluate(() => ({ hp: game.currentBattle.playerCurrentHp, max: game.currentBattle.playerMaxHp, potions: game.getPotions(), toast: !!document.querySelector('.toast') }));
            check(`Mundo ${vp.name}: Centro Pokémon cura o Pokémon em batalha sem gastar poção e avisa`, healed.hp >= healed.max - 1 && healed.potions === potionsBefore && healed.toast, JSON.stringify(healed));

            // Com a Caça EM ANDAMENTO o Centro recusa (a automação seguiria progredindo); pausar libera
            const centerHeals = () => page.evaluate(() => game.bus.recent(200, 'heal').filter(e => e.reason === 'center').length);
            const healsBefore = await centerHeals();
            await page.evaluate(() => { game.dispatchAutomationAction({ type: 'START_HUNT' }); game.currentBattle.playerCurrentHp = 1; });
            await page.click('#world-interact');
            await sleep(200);
            const blockedHunt = await page.evaluate(() => ({ running: game.isHuntRunning(), hint: document.getElementById('world-hint').textContent }));
            check(`Mundo ${vp.name}: com a Caça em andamento o Centro Pokémon recusa e orienta a pausar`, blockedHunt.running === true && (await centerHeals()) === healsBefore && /Pause ou pare a caçada/.test(blockedHunt.hint), JSON.stringify({ blockedHunt, heals: [healsBefore, await centerHeals()] }));
            await page.evaluate(() => { game.dispatchAutomationAction({ type: 'PAUSE_HUNT' }); game.currentBattle.playerCurrentHp = 1; });
            await page.click('#world-interact');
            await sleep(200);
            check(`Mundo ${vp.name}: depois de pausar a caçada o Centro Pokémon atende de novo`, (await centerHeals()) === healsBefore + 1 && (await page.evaluate(() => game.isHuntRunning())) === false, JSON.stringify({ heals: await centerHeals() }));
            await page.evaluate(() => { game.dispatchAutomationAction({ type: 'STOP_HUNT' }); });

            // Depot: abre a aba PC existente (posição levada até a porta por atalho de teste)
            await page.evaluate(() => { const wv = gameUI.worldView, m = wv.currentScene().map, it = m.interactions.find(i => i.type === 'depot'); wv._players[m.id] = { ...wv._player(m), x: (it.cell.x + 0.5) * 16, y: (it.cell.y + 0.5) * 16, moving: false }; wv.requestRedraw(true); });
            await sleep(250);
            const atDepot = await probe();
            check(`Mundo ${vp.name}: perto do Depot a dica aparece`, atDepot.interactDisabled === false && /Depot/.test(atDepot.hint), JSON.stringify({ hint: atDepot.hint }));
            await page.click('#world-interact');
            await sleep(250);
            const pc = await probe();
            check(`Mundo ${vp.name}: Depot abre a aba PC existente e o renderer do mundo fica inativo`, pc.pcActive === true && pc.active === false, JSON.stringify({ pc: pc.pcActive, active: pc.active }));
            await page.click('[data-tab="tab-map"]');
            await page.waitForFunction(() => gameUI.worldView.active === true && gameUI.worldView.drawCount > 0, null, { timeout: 10000 });

            // destino: Rota 1 é só visual (não muda a rota do jogo) e não aceita caminhada manual
            await page.selectOption('#world-destination', 'kanto_route1');
            await sleep(300);
            const rt = await probe();
            const rafR = await page.evaluate(() => window.__raf);
            if (vp.isMobile) await page.evaluate(() => document.querySelector('[data-dir="right"]') && document.querySelector('[data-dir="right"]').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, bubbles: true, cancelable: true })));
            else await page.keyboard.press('ArrowRight');
            await sleep(400);
            const rt2 = await probe();
            if (vp.isMobile) await page.evaluate(() => document.querySelector('[data-dir="right"]') && document.querySelector('[data-dir="right"]').dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, bubbles: true })));
            check(`Mundo ${vp.name}: "Ir para" abre a Rota 1 (área visual): sem controles e sem caminhada manual, rota do jogo intacta`, rt.area === 'kanto_route1' && rt.controlsHidden === true && rt.hero > 20 && /Rota 1/.test(rt.aria) && rt2.px === rt.px && rt2.py === rt.py && (await page.evaluate(() => window.__raf)) === rafR && rt.route === routeBefore, JSON.stringify({ area: rt.area, hidden: rt.controlsHidden, aria: rt.aria, same: [rt.px, rt2.px], route: rt.route }));
            await page.selectOption('#world-destination', 'starter_town');
            await sleep(300);
            const back = await probe();
            check(`Mundo ${vp.name}: voltar à cidade devolve os controles e lembra a posição`, back.area === 'starter_town' && back.controlsHidden === false && Math.abs(back.px - atDepot.px) < 1 && Math.abs(back.py - atDepot.py) < 1, JSON.stringify({ area: back.area, px: back.px, depotPx: atDepot.px }));

            // resize/orientação: redesenha com o novo tamanho e continua sem overflow
            await page.setViewportSize(vp.isMobile ? { width: 640, height: 360 } : { width: 900, height: 700 });
            await page.waitForFunction((n) => gameUI.worldView.drawCount > n, back.draws, { timeout: 10000 });
            const b = await probe();
            check(`Mundo ${vp.name}: após resize/orientação o buffer acompanha o novo tamanho, sem overflow`, b.bw === Math.round(b.cw * b.dpr) && b.bh === Math.round(b.ch * b.dpr) && b.sw <= b.iw + 1 && b.hero > 20, JSON.stringify({ bw: b.bw, cw: b.cw, sw: b.sw, iw: b.iw }));

            // perder o foco durante a caminhada: nada de tecla presa
            if (!vp.isMobile) {
                await page.keyboard.down('ArrowLeft');
                await sleep(150);
                await page.evaluate(() => window.dispatchEvent(new Event('blur')));
                await sleep(150);
                const x1 = (await probe()).px;
                await sleep(400);
                const x2 = (await probe()).px;
                await page.keyboard.up('ArrowLeft');
                check(`Mundo ${vp.name}: perder o foco solta a tecla (o personagem para sozinho)`, Math.abs(x2 - x1) < 0.01, JSON.stringify({ x1, x2 }));
            }

            // sair da aba durante a caminhada: renderer inativo, sem redesenhar e sem tecla presa
            if (!vp.isMobile) await page.keyboard.down('ArrowDown'); else await page.evaluate(() => document.querySelector('[data-dir="down"]').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true, cancelable: true })));
            await sleep(150);
            await page.click('[data-tab="tab-battle"]');
            const off = await probe();
            await sleep(500);
            const off2 = await probe();
            if (!vp.isMobile) await page.keyboard.up('ArrowDown');
            check(`Mundo ${vp.name}: sair da aba no meio da caminhada deixa o renderer inativo, sem redesenhar nem andar`, off.active === false && off2.active === false && off2.draws === off.draws && off2.px === off.px && off2.py === off.py, JSON.stringify({ off: off.draws, off2: off2.draws }));

            // voltar: retoma e as listas continuam funcionando (a lista troca a rota do JOGO; a cena continua na cidade)
            await page.click('[data-tab="tab-map"]');
            await page.waitForFunction((n) => gameUI.worldView.drawCount > n, off2.draws, { timeout: 10000 });
            const again = await probe();
            check(`Mundo ${vp.name}: ao voltar para a aba o renderer retoma sem tecla presa`, again.active === true && again.draws > off2.draws && again.hero > 20 && again.moving === false, JSON.stringify({ active: again.active, moving: again.moving }));
            await page.click('#route-list .route-card:not(.active)');
            await sleep(300);
            const after = await page.evaluate(() => ({ route: game.gameState.currentRoute, caption: document.getElementById('world-caption').textContent, area: gameUI.worldView.areaId }));
            check(`Mundo ${vp.name}: a lista de rotas segue mudando a rota do jogo (a cena continua na cidade)`, after.route !== routeBefore && after.area === 'starter_town' && /Cidade Inicial/.test(after.caption), JSON.stringify(after));

            // F7.3: câmera de acompanhamento no navegador real (viewport emulada). Mapas sintéticos só em memória, criados e removidos aqui
            // (sem assets nem API de produção): usa o mesmo mecanismo dos testes acima (gameUI.worldView + WORLD_MAPS global).
            await page.evaluate(() => {
                const border = (w, h) => Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? 'T'.repeat(w) : 'T' + '.'.repeat(w - 2) + 'T'));
                WORLD_MAPS.smoke_big = { id: 'smoke_big', type: 'city', name: 'Mapa grande de teste', width: 120, height: 90, spawn: { x: 60, y: 45, dir: 'down' }, rows: border(120, 90) };
                WORLD_MAPS.smoke_small = { id: 'smoke_small', type: 'city', name: 'Mapa pequeno de teste', width: 6, height: 5, spawn: { x: 3, y: 2, dir: 'down' }, rows: border(6, 5) };
            });
            const camProbe = () => page.evaluate(() => {
                const wv = gameUI.worldView, map = wv.currentScene().map, p = wv._player(map), m = wv.lastMetrics, c = wv.lastCamera;
                const feet = worldToScreen(c, m, p.x, p.y - 6);
                return { area: map.id, px: p.x, py: p.y, cx: c.x, cy: c.y, zoom: m.zoom, bw: m.bufferWidth, bh: m.bufferHeight, vw: m.viewWidth, vh: m.viewHeight, fx: feet.x, fy: feet.y, mw: map.width * 16, mh: map.height * 16, draws: wv.drawCount };
            });
            const walk = async (dir, ms) => {
                const key = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' }[dir];
                if (!vp.isMobile) await page.keyboard.down(key);
                else await page.evaluate((d) => document.querySelector(`[data-dir="${d}"]`).dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, bubbles: true, cancelable: true })), dir);
                await sleep(ms);
                if (!vp.isMobile) await page.keyboard.up(key);
                else await page.evaluate((d) => document.querySelector(`[data-dir="${d}"]`).dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, bubbles: true, cancelable: true })), dir);
                await sleep(150);
            };
            const place = async (id, x, y) => {
                await page.evaluate(([id, x, y]) => { const wv = gameUI.worldView; wv.setArea(id); const m = wv.currentScene().map; wv._players[m.id] = { ...wv._player(m), x, y, moving: false }; wv.requestRedraw(true); }, [id, x, y]);
                await sleep(250);
            };
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await sleep(250);
            await place('smoke_big', 60 * 16 + 8, 45 * 16);
            const c0 = await camProbe();
            check(`Mundo ${vp.name} [câmera]: em um mapa muito maior que a vista o personagem começa no centro`, c0.area === 'smoke_big' && c0.mw > c0.vw * 2 && c0.mh > c0.vh * 2 && Math.abs(c0.fx - c0.bw / 2) <= c0.zoom && Math.abs(c0.fy - c0.bh / 2) <= c0.zoom, JSON.stringify(c0));
            await walk('right', 700);
            const c1 = await camProbe();
            check(`Mundo ${vp.name} [câmera]: ao andar o cenário acompanha (câmera anda o mesmo que o personagem) e ele continua centralizado`, c1.px - c0.px > 20 && Math.abs((c1.cx - c0.cx) - (c1.px - c0.px)) <= 1 / c1.zoom + 0.01 && Math.abs(c1.fx - c1.bw / 2) <= c1.zoom, JSON.stringify({ c0, c1 }));
            await place('smoke_big', 4 * 16, 45 * 16);
            await walk('left', 1200);
            const c2 = await camProbe();
            check(`Mundo ${vp.name} [câmera]: na borda esquerda a câmera para em 0 e o personagem sai do centro (colidindo com as árvores)`, c2.cx === 0 && c2.fx < c2.bw / 2 - 8 * c2.zoom && c2.px >= 16 + 5 - 0.01 && c2.px < 16 + 6, JSON.stringify(c2));
            await place('smoke_big', 116 * 16, 45 * 16);
            await walk('right', 1200);
            const c3 = await camProbe();
            check(`Mundo ${vp.name} [câmera]: na borda direita a câmera para sem mostrar fora do mapa e o personagem passa do centro`, Math.abs(c3.cx + c3.vw - c3.mw) <= 1 / c3.zoom + 0.01 && c3.fx > c3.bw / 2 + 8 * c3.zoom && c3.px <= 119 * 16 - 5 + 0.01, JSON.stringify(c3));
            await place('smoke_big', 60 * 16, 3 * 16);
            await walk('up', 1200);
            const c4 = await camProbe();
            await place('smoke_big', 60 * 16, 87 * 16);
            await walk('down', 1200);
            const c5 = await camProbe();
            check(`Mundo ${vp.name} [câmera]: topo e base do mapa também limitam a câmera e tiram o personagem do centro`, c4.cy === 0 && c4.fy < c4.bh / 2 - 8 * c4.zoom && Math.abs(c5.cy + c5.vh - c5.mh) <= 1 / c5.zoom + 0.01 && c5.fy > c5.bh / 2 + 8 * c5.zoom, JSON.stringify({ c4, c5 }));

            await place('smoke_small', 3 * 16, 2 * 16 + 13);
            const s0 = await camProbe();
            await walk('right', 400);
            const s1 = await camProbe();
            const small = await page.evaluate(() => { const wv = gameUI.worldView, m = wv.lastMetrics, c = wv.lastCamera, w = 96, h = 80; const tl = worldToScreen(c, m, 0, 0), br = worldToScreen(c, m, w, h); return { tl, br, bw: m.bufferWidth, bh: m.bufferHeight, zoom: m.zoom }; });
            check(`Mundo ${vp.name} [câmera]: mapa menor que a tela aparece inteiro e centralizado (zoom inteiro) e a câmera não segue o personagem`,
                small.tl.x >= 0 && small.tl.y >= 0 && small.br.x <= small.bw && small.br.y <= small.bh && Math.abs(small.tl.x - (small.bw - small.br.x)) <= 1 && Math.abs(small.tl.y - (small.bh - small.br.y)) <= 1 && Number.isInteger(small.zoom) && s1.px > s0.px + 10 && s1.cx === s0.cx && s1.cy === s0.cy, JSON.stringify({ small, s0, s1 }));

            // F7.4: mapa de caça gerado sob demanda (hunt_<espécie>) aparece no renderer real, sem controles de caminhada e com o tileset ampliado
            await page.evaluate(() => { gameUI.worldView.setArea('hunt_74'); });
            await sleep(400);
            const hunt = await probe();
            const huntInfo = await page.evaluate(() => ({ tilesetH: WorldView.images.tileset.naturalHeight, w: getWorldMap('hunt_74').width, type: getWorldMap('hunt_74').type, inList: Object.keys(WORLD_MAPS).some(k => /^hunt_/.test(k)) }));
            check(`Mundo ${vp.name} [F7.4]: mapa de caça gerado (hunt_74) desenha no navegador, sem caminhada manual, e não entra na lista de mapas`, hunt.area === 'hunt_74' && hunt.controlsHidden === true && hunt.colors >= 8 && huntInfo.tilesetH === 160 && huntInfo.type === 'hunt' && huntInfo.w >= 48 && huntInfo.inList === false, JSON.stringify({ hunt: { area: hunt.area, hidden: hunt.controlsHidden, colors: hunt.colors }, huntInfo }));

            // F7.5: a lista de rotas (progressão) abre o mapa visual; rota sem mapa só avisa; a busca de espécie abre o mapa de caça sem caçar
            await page.evaluate(() => { gameUI.worldView.setArea('starter_town'); });
            const cards = await page.evaluate(() => document.querySelectorAll('#route-list .route-card').length);
            await page.evaluate(() => document.querySelectorAll('#route-list .route-card')[0].click());
            await sleep(300);
            const r1 = await page.evaluate(() => ({ area: gameUI.worldView.areaId, route: game.gameState.currentRoute, hidden: document.getElementById('world-controls').hidden }));
            check(`Mundo ${vp.name} [F7.5]: clicar na Rota 1 da lista muda a rota do jogo e abre o mapa visual dela (sem caminhada manual)`, cards >= 2 && r1.route === 'kanto_route1' && r1.area === 'kanto_route1' && r1.hidden === true, JSON.stringify({ cards, r1 }));
            await page.evaluate(() => document.querySelectorAll('#route-list .route-card')[1].click());
            await sleep(300);
            const r2 = await page.evaluate(() => ({ area: gameUI.worldView.areaId, route: game.gameState.currentRoute, hint: document.getElementById('world-hint').textContent }));
            check(`Mundo ${vp.name} [F7.5]: rota sem mapa visual muda só a progressão e avisa (a área exibida não muda)`, r2.route !== 'kanto_route1' && r2.area === 'kanto_route1' && /ainda não tem mapa visual/.test(r2.hint), JSON.stringify(r2));
            const search = await page.evaluate(async () => {
                const input = document.getElementById('world-hunt-input'), res = document.getElementById('world-hunt-results');
                const cachedBefore = worldHuntStats().generated;
                input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true }));
                const many = res.children.length, total = res.textContent;
                input.value = '25'; input.dispatchEvent(new Event('input', { bubbles: true }));
                const btn = res.querySelector('[data-species-id="25"]');
                const generatedAfterTyping = worldHuntStats().generated;
                const routeBefore = game.gameState.currentRoute;
                btn.click();
                return { many, total, cachedBefore, generatedAfterTyping, area: gameUI.worldView.areaId, routeSame: game.gameState.currentRoute === routeBefore, running: game.isHuntRunning(), generated: worldHuntStats().generated, left: res.children.length };
            });
            await sleep(300);
            check(`Mundo ${vp.name} [F7.5]: a busca mostra no máximo 10 espécies, não gera mapas ao digitar e abre o mapa de caça escolhido sem iniciar a caçada`,
                search.many <= 11 && /Mostrando 10 de/.test(search.total) && search.generatedAfterTyping === search.cachedBefore && search.area === 'hunt_25' && search.routeSame && search.running === false && search.generated === search.cachedBefore + 1 && search.left === 0, JSON.stringify(search));
            check(`Mundo ${vp.name} [F7.5]: depois de abrir o mapa de caça o renderer segue ativo e sem controles de caminhada`, (await probe()).area === 'hunt_25' && (await probe()).controlsHidden === true, JSON.stringify(await probe()));
            // F7.6/F7.7: caçada no mapa — botão explícito, caminhada lógica (relógio manual), câmera, chegada, batalha oficial e limpeza ao sair do mapa
            await page.evaluate(() => { gameUI.worldView.openHuntMap(25); });
            await sleep(300);
            const e0 = await page.evaluate(() => ({ hidden: document.getElementById('world-encounter').hidden, disabled: document.getElementById('world-encounter-btn').disabled, cycle: gameUI.worldEncounters.cycle, hook: game.encounterHook, running: game.isHuntRunning(), session: game.getHuntSession() && game.getHuntSession().state }));
            check(`Mundo ${vp.name} [F7.7]: abrir o mapa de caça mostra o botão "Iniciar caçada neste mapa" e não cria sessão, ciclo nem batalha`, e0.hidden === false && e0.disabled === false && e0.cycle === null && e0.hook === null && e0.running === false, JSON.stringify(e0));
            const e1 = await page.evaluate(async () => {
                const sleepIn = (ms) => new Promise(r => setTimeout(r, ms));
                const realClock = game.clock;
                game.clock = new ManualClock(game.now());
                const wv = gameUI.worldView, map = wv.currentScene().map;
                game.stopBattle(); game.gameState.currentEnemy = null;
                document.getElementById('world-encounter-btn').click();                       // ação explícita do jogador
                await sleepIn(400);
                const c = gameUI.worldEncounters.current;
                const noRouteBattle = !game.battleTimer && !game.gameState.currentEnemy;
                const status = document.getElementById('world-encounter-status').textContent;
                const sprite = !!(wv._enc && wv._enc.get('25') && wv._enc.get('25').ready);
                const poses = [], cams = [];
                for (let i = 0; i < 4; i++) {
                    game.clock.advance(2000);
                    wv.requestRedraw(true);
                    await sleepIn(120);
                    const p = wv._player(map);
                    poses.push([p.x, p.y, p.moving]); cams.push([wv.lastCamera.x, wv.lastCamera.y]);
                }
                const justBefore = (() => { game.clock.advance(c.etaMs - 8000 - 1 - 0); return gameUI.worldEncounters.current.state; })();
                const noBattleBeforeArrival = !game.battleTimer && !game.gameState.currentEnemy;
                const guardBefore = game.startBattle();
                game.clock.advance(2);
                const arrived = gameUI.worldEncounters.current.state;
                const enemy = game.currentBattle && game.currentBattle.wild.id;
                const hookOn = game.encounterHook === gameUI.worldEncounters;
                const moved = poses.some((p, i) => i > 0 && (p[0] !== poses[i - 1][0] || p[1] !== poses[i - 1][1]));
                const camMoved = cams.some((p, i) => i > 0 && (p[0] !== cams[i - 1][0] || p[1] !== cams[i - 1][1]));
                wv.setArea('starter_town');
                const afterLeave = { cycle: gameUI.worldEncounters.cycle, reason: gameUI.worldEncounters.current.reason, hook: game.encounterHook, timers: game.clock.pendingTimers() };
                game.dispatchAutomationAction({ type: 'STOP_HUNT' });
                game.stopBattle();
                game.clock = realClock;
                return { len: c.lengthPx, eta: c.etaMs, noRouteBattle, status, sprite, poses, moved, camMoved, justBefore, noBattleBeforeArrival, guardBefore, arrived, enemy, hookOn, afterLeave };
            });
            check(`Mundo ${vp.name} [F7.7]: o botão inicia a caçada; o Pokémon aparece, o personagem caminha (posição e câmera mudam) e não há batalha de rota`, e1.noRouteBattle && /caminhando até Pikachu/i.test(e1.status) && e1.sprite === true && e1.moved && e1.poses.every(p => p[2] === true) && e1.camMoved, JSON.stringify({ status: e1.status, sprite: e1.sprite, moved: e1.moved, cam: e1.camMoved, poses: e1.poses }));
            check(`Mundo ${vp.name} [F7.7]: a batalha só começa na chegada lógica (nem um ms antes), com a espécie do mapa, pela entrada oficial`, e1.justBefore === 'approaching' && e1.noBattleBeforeArrival && e1.guardBefore === false && e1.arrived === 'battling' && e1.enemy === 25 && e1.hookOn, JSON.stringify({ justBefore: e1.justBefore, noBefore: e1.noBattleBeforeArrival, guardBefore: e1.guardBefore, arrived: e1.arrived, enemy: e1.enemy, eta: e1.eta, len: e1.len }));
            check(`Mundo ${vp.name} [F7.7]: sair do mapa encerra o ciclo e solta gancho e timers (a batalha em curso não é abortada por isso)`, e1.afterLeave.cycle === null && e1.afterLeave.reason === 'left_map' && e1.afterLeave.hook === null && e1.afterLeave.timers === 0, JSON.stringify(e1.afterLeave));
            await page.evaluate(() => { gameUI.worldView.setArea('starter_town'); delete WORLD_MAPS.smoke_big; delete WORLD_MAPS.smoke_small; delete gameUI.worldView._players.smoke_big; delete gameUI.worldView._players.smoke_small; });
            await context.close();
        }

        // ---------- Dispositivo híbrido (desktop com tela de toque): o direcional aparece e o teclado continua funcionando ----------
        {
            const { page, context } = await newPage(() => localStorage.setItem('pokemon_idle_tutorial_done', '1'), { viewport: { width: 1280, height: 800 }, hasTouch: true });
            await page.goto(base);
            await page.waitForFunction(() => typeof game !== 'undefined' && game.currentBattle, null, { timeout: 15000 });
            await page.click('[data-tab="tab-map"]');
            await page.waitForFunction(() => gameUI.worldView.drawCount > 0, null, { timeout: 10000 });
            const hy = await page.evaluate(() => ({ coarse: matchMedia('(any-pointer: coarse)').matches, shown: getComputedStyle(document.querySelector('.world-dpad')).display !== 'none', x: gameUI.worldView._player(gameUI.worldView.currentScene().map).x }));
            await page.keyboard.down('ArrowLeft'); await sleep(500); await page.keyboard.up('ArrowLeft'); await sleep(150);
            const hy2 = await page.evaluate(() => gameUI.worldView._player(gameUI.worldView.currentScene().map).x);
            check('Mundo híbrido (1280x800 com tela de toque): direcional visível', hy.coarse === true && hy.shown === true, JSON.stringify(hy));
            check('Mundo híbrido (1280x800 com tela de toque): o teclado continua andando', hy.x - hy2 > 20, JSON.stringify({ x0: hy.x, x1: hy2 }));
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
