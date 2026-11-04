// Teste do Mapa de Caça: anda, força um encontro, luta e lança orbe.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
    const out = process.argv[2], W = Number(process.argv[3] || 1280), H = Number(process.argv[4] || 800);
    const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const p = await b.newPage({ viewport: { width: W, height: H } }); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    const T = { timeout: 8000 };
    const safe = async (f) => { try { await f(); } catch (e) { errs.push(e.message.split('\n')[0]); } };
    await p.goto('http://localhost:8080/?new=1&seed=hunt2'); await p.waitForTimeout(2500);
    await safe(() => p.click('[data-st="0"]', T)); await p.waitForTimeout(400); await safe(() => p.click('[data-close]', T));
    await p.evaluate(() => { const g = __rift.game; for (const c of g.teamGenomes()) c.level = 14; });
    await safe(() => p.click('[data-tab="hunt"]', T)); await p.waitForTimeout(3000);
    await p.evaluate(() => { const ow = __rift.hunt.ow; ow.cool = 99; ow.keys.add('w'); }); await p.waitForTimeout(2200);
    await p.screenshot({ path: out + '-walk.png' });
    await p.evaluate(() => { const ow = __rift.hunt.ow; ow.keys.clear(); ow.cool = 0; const r = ow.roamers[0]; ow.player.position.copy(r.m.position); });
    await p.waitForTimeout(3500); await p.screenshot({ path: out + '-wild.png' });
    await safe(() => p.click('[data-m="fight"]', T)); await p.waitForTimeout(300); await p.screenshot({ path: out + '-moves.png' });
    await safe(() => p.click('[data-i="1"]', T)); await p.waitForTimeout(5000); await p.screenshot({ path: out + '-after.png' });
    await safe(() => p.click('[data-m="orb"]', T)); await p.waitForTimeout(1600); await p.screenshot({ path: out + '-orb.png' }); await p.waitForTimeout(9000); await p.screenshot({ path: out + '-orb2.png' });
    console.log('errors', errs.length, errs.slice(0, 8).join(' | '));
    await b.close();
})();
