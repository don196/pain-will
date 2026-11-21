// Сборка: node build/build.mjs
//   dist/index.html — страница полигона одним файлом (стили и скрипт внутри)
//   dist/sim.cjs    — симулятор боёв для Node (правила без браузера)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const page = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'none',
});
const js = page.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/index.html', 'utf8')
  .replace('/*STYLES*/', () => readFileSync('src/styles.css', 'utf8'))
  .replace('/*SCRIPT*/', () => js);
writeFileSync('dist/index.html', html);

await build({
  entryPoints: ['src/sim/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/sim.cjs',
  legalComments: 'none',
  logLevel: 'warning',
});

console.log(`dist/index.html: ${Math.round(Buffer.byteLength(html) / 1024)} КБ, dist/sim.cjs готов`);
