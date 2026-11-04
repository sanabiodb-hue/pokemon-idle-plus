// Gera dist/index.html: um único arquivo com CSS e JS embutidos (Three.js incluído), pronto para hospedar em qualquer lugar.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const res = await build({
    entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'esm', minify: true, write: false, target: 'es2020',
    alias: { three: path.join(root, 'vendor/three.module.js') }, legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;600;800&family=Orbitron:wght@600;800&display=swap">';
// sem <html>/<head>/<body>: a hospedagem embrulha o arquivo; título e estilos ficam no topo
const out = `<title>Rift Tamers</title>\n<meta name="description" content="Idle 3D de criaturas geradas por genoma.">\n<meta name="theme-color" content="#07030f">\n${fonts}\n<style>\n${css}\n</style>\n${body}<script type="module">\n${js}\n</script>\n`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), out);
console.log('dist/index.html', (out.length / 1024).toFixed(0) + ' KB');
