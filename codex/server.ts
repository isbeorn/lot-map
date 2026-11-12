import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import { boardFrom } from './adapter';
import { listSessions, readOptions, readReceipts } from './store';

const URI = 'ui://lot-map/map-v2.html';
const server = new McpServer({ name: 'lot-map', version: '0.4.2' });
const inputSchema = { session_id: z.string().max(128).optional() };
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

async function snapshot(sessionId?: string) {
  const sessions = await listSessions();
  const selected = sessionId;
  const receipts = selected ? await readReceipts(selected) : [];

  return {
    sessions,
    sessionId: selected ?? null,
    board: boardFrom(receipts, selected ?? ''),
    options: await readOptions(),
    receiptCount: receipts.length,
    lastEventAt: receipts.length ? Math.max(...receipts.map((r) => r.at)) : null,
    observedAt: Date.now(),
  };
}

server.registerResource(
  'lot-map-panel',
  URI,
  { mimeType: 'text/html;profile=mcp-app' },
  async () => ({
    contents: [
      {
        uri: URI,
        mimeType: 'text/html;profile=mcp-app',
        text: await readFile(new URL('./panel.html', import.meta.url), 'utf8'),
        _meta: {
          ui: { prefersBorder: true },
          'openai/ui': {
            availableDisplayModes: ['inline', 'fullscreen'],
            preferredDisplayMode: 'fullscreen',
          },
        },
      },
    ],
  })
);
server.registerTool(
  'lot_map_open',
  {
    title: 'Lot Map',
    description:
      'Open the live activity map beside this Codex chat. Omit session_id for the current chat: the trusted Lot Map hook supplies its exact ID. Pass session_id only when the user requests another session. If hooks are unavailable, the panel asks the user to choose a session instead of guessing.',
    inputSchema,
    annotations,
    _meta: {
      ui: { resourceUri: URI },
      'openai/ui': { entrypoints: [{ type: 'thread' }], preferredModelDisplayMode: 'fullscreen' },
    },
  },
  async ({ session_id }) => ({
    content: [
      { type: 'text', text: 'Lot Map is open. It shows locally captured Codex hook activity.' },
    ],
    structuredContent: await snapshot(session_id),
  })
);
server.registerTool(
  'lot_map_snapshot',
  {
    title: 'Refresh Lot Map',
    description: 'Read the selected session’s activity for the Lot Map panel.',
    inputSchema,
    annotations,
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ session_id }) => ({ content: [], structuredContent: await snapshot(session_id) })
);
await server.connect(new StdioServerTransport());
