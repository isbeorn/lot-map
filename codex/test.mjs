import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import './build.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'lot-map-tests-'));

try {
  const bundle = join(temporary, 'tests.mjs');
  await build({
    absWorkingDir: root,
    entryPoints: ['codex/tests.ts'],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', bundle], { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
