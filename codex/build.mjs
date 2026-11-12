import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, 'codex/dist');
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['codex/collect.ts', 'codex/server.ts'],
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
const ui = await build({
  absWorkingDir: root,
  entryPoints: ['codex/panel.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  write: false,
});
await writeFile(
  join(outdir, 'panel.html'),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lot Map</title></head><body><script type="module">${ui.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`
);
