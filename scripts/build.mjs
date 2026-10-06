import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.local/build');
await mkdir(resolve(output, 'web'), { recursive: true });
await mkdir(resolve(output, 'apps-script'), { recursive: true });
const client = await build({ entryPoints: [resolve(root, 'web/app.mjs')], bundle: true,
  minify: true, format: 'iife', platform: 'browser', target: 'es2020', write: false });
const js = client.outputFiles[0].text;
const css = await readFile(resolve(root, 'web/style.css'), 'utf8');
const html = await readFile(resolve(root, 'web/index.html'), 'utf8');
await writeFile(resolve(output, 'web/app.js'), js);
await writeFile(resolve(output, 'web/style.css'), css);
await writeFile(resolve(output, 'web/index.html'), html);
const googleHtml = html.replace('<link rel="stylesheet" href="/style.css">', `<style>${css}</style>`)
  .replace('<script type="module" src="/app.js"></script>', `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(resolve(output, 'apps-script/Index.html'), googleHtml);
const server = await build({ entryPoints: [resolve(root, 'gas/entry.mjs')], bundle: true,
  minify: false, format: 'iife', globalName: 'KitCore', platform: 'neutral', target: 'es2020',
  write: false, plugins: [{ name: 'gas-crypto', setup(builder) {
    builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: resolve(root, 'gas/crypto-shim.mjs') }));
  } }] });
const serverJs = server.outputFiles[0].text;
if (/\brequire\(|\bprocess\.|node:crypto/.test(serverJs)) throw new Error('NODE_RUNTIME_IN_GAS_BUILD');
await writeFile(resolve(output, 'apps-script/KitCore.gs'), serverJs);
for (const file of ['Code.gs', 'appsscript.json']) {
  await writeFile(resolve(output, 'apps-script', file), await readFile(resolve(root, 'gas', file), 'utf8'));
}
console.log(JSON.stringify({ webBuilt: true, gasBuilt: true, lineEnabled: false,
  googleAccess: 'MYSELF', outputContainsPrivateConfig: false }));
