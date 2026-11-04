// Screenshots e erros de console com Chromium (WebGL por SwiftShader). Uso: node tools/shot.cjs <url> <saida-prefixo> [script-de-passos.json]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
    const url = process.argv[2], out = process.argv[3] || 'shot';
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const sizes = (process.env.SIZES || '1280x800,390x844').split(',');
    for (const s of sizes) {
        const [w, h] = s.split('x').map(Number);
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        const errs = [];
        page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
        page.on('pageerror', e => errs.push('pageerror: ' + e.message));
        await page.goto(url);
        await page.waitForTimeout(Number(process.env.WAIT || 4000));
        if (process.env.STEPS) { for (const st of JSON.parse(process.env.STEPS)) { if (st.click) await page.click(st.click).catch(e => errs.push('click ' + st.click + ': ' + e.message)); if (st.eval) await page.evaluate(st.eval).catch(e => errs.push('eval: ' + e.message)); if (st.wait) await page.waitForTimeout(st.wait); if (st.shot) await page.screenshot({ path: `${out}-${w}-${st.shot}.png` }); } }
        await page.screenshot({ path: `${out}-${w}.png` });
        const fps = await page.evaluate(() => window.__rift ? Math.round(window.__rift.stage3d.fps) : null).catch(() => null);
        console.log(s, 'fps', fps, 'errors', errs.length); errs.slice(0, 15).forEach(e => console.log('  ', e));
        await page.close();
    }
    await browser.close();
})();
