import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import './build.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const marketplace = join(root, 'dist/codex-marketplace');
const plugin = join(marketplace, 'plugins/lot-map');
await rm(plugin, { recursive: true, force: true });
await mkdir(join(plugin, '.codex-plugin'), { recursive: true });
await mkdir(join(plugin, 'codex'), { recursive: true });
for (const path of ['.codex-plugin/plugin.json', 'codex/hooks.json', 'codex/mcp.json', 'LICENSE']) {
  await cp(join(root, path), join(plugin, path));
}
await mkdir(join(plugin, 'codex/dist'), { recursive: true });
for (const file of ['collect.mjs', 'server.mjs', 'panel.html']) {
  await cp(join(root, 'codex/dist', file), join(plugin, 'codex/dist', file));
}
await cp(join(root, 'codex/README.md'), join(plugin, 'README.md'));
await cp(join(root, 'codex/skills'), join(plugin, 'codex/skills'), { recursive: true });
await mkdir(join(marketplace, '.agents/plugins'), { recursive: true });
const manifest = JSON.parse(await readFile(join(root, '.codex-plugin/plugin.json'), 'utf8'));
await writeFile(
  join(marketplace, '.agents/plugins/marketplace.json'),
  JSON.stringify(
    {
      name: 'lot-map-codex',
      interface: { displayName: 'Lot Map' },
      plugins: [
        {
          name: manifest.name,
          source: { source: 'local', path: './plugins/lot-map' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Developer Tools',
        },
      ],
    },
    null,
    2
  ) + '\n'
);
console.log(`Built Codex marketplace: ${marketplace}`);
