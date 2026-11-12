import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { drawMap, setupFrom } from '../hooks/map';
import { EVENT_FRESHNESS_MS, activityView } from './activity';
import { boardFrom, normalize } from './adapter';
import {
  MAX_RECEIPTS,
  listSessions,
  pruneSessions,
  readOptions,
  readReceipts,
  saveReceipt,
} from './store';

const event = (event: string, at: number, values: Record<string, unknown> = {}) =>
  normalize(
    {
      hook_event_name: event,
      session_id: 'session-A',
      turn_id: 'turn-1',
      model: 'test-model',
      ...values,
    },
    `event-${at}`,
    at
  )!;

test('raw content is reduced before storage, including command descriptions and agent prompts', () => {
  const secret = 'DO_NOT_PERSIST_THIS_SECRET';
  const receipts = [
    event('UserPromptSubmit', 1, { prompt: secret }),
    event('PreToolUse', 2, {
      tool_name: 'Bash',
      tool_input: { command: `printf ${secret}`, description: secret },
    }),
    event('PostToolUse', 3, {
      tool_name: 'Bash',
      tool_input: { command: `printf ${secret}` },
      tool_response: secret,
    }),
    event('PreToolUse', 4, {
      tool_name: 'apply_patch',
      tool_input: { command: `*** Add File: /tmp/file\n+${secret}` },
    }),
    event('PreToolUse', 5, {
      tool_name: 'spawn_agent',
      tool_input: { message: secret, description: secret },
    }),
    event('PreToolUse', 6, {
      tool_name: 'WebFetch',
      tool_input: { url: `https://user:${secret}@example.com/${secret}?q=${secret}` },
    }),
  ];
  assert(!JSON.stringify(receipts).includes(secret));
  assert.equal(receipts[3]?.station, 'files');
  assert.equal(receipts[4]?.station, 'agents');
  assert.equal(receipts[5]?.label, 'example.com');
  assert.equal(normalize({ hook_event_name: 'Unknown', session_id: 'x' }, 'id'), null);
  assert.equal(event('PreToolUse', 7, { tool_name: 'mcp__lot_map__lot_map_snapshot' }), null);
});

test('Codex shell, file, memory and browser calls use appropriate stations', () => {
  const at = (tool: string, input: unknown) =>
    event('PreToolUse', 1, { tool_name: tool, tool_input: input }).station;
  assert.equal(at('exec_command', { cmd: 'cat src/main.ts' }), 'files');
  assert.equal(at('Bash', { command: 'cat ~/.codex/memories/note.md' }), 'memory');
  assert.equal(at('Bash', { command: 'git push origin main' }), 'web');
  assert.equal(at('mcp__cua_repl__js', { code: 'secret()' }), 'browser');
  assert.equal(at('request_user_input', {}), 'you');
});

test('overlapping tool calls pair by ID, count once, and retain errors', () => {
  const events = [
    event('PreToolUse', 1, { tool_name: 'Bash', tool_use_id: 'one' }),
    event('PreToolUse', 2, { tool_name: 'Bash', tool_use_id: 'two' }),
    event('PostToolUse', 3, {
      tool_name: 'Bash',
      tool_use_id: 'two',
      tool_response: { exit_code: 2 },
    }),
    event('PostToolUse', 4, {
      tool_name: 'Bash',
      tool_use_id: 'one',
      tool_response: { exit_code: 0 },
    }),
    event('PreToolUse', 5, { session_id: 'other-session', tool_name: 'Bash', tool_use_id: 'one' }),
  ];
  const board = boardFrom(events, 'session-A');
  assert.equal(board.entries.length, 2);
  assert.deepEqual(
    board.entries.map((e) => [e.startedAt, e.endedAt, e.status]),
    [
      [1, 4, 'ok'],
      [2, 3, 'err'],
    ]
  );
  assert.equal(board.counts.shell, 2);
  assert.equal(board.faults?.shell, 1);
  assert.deepEqual(boardFrom([...events, event('UserPromptSubmit', 6)], 'session-A').faults, {});
});

test('main and subagent model requests do not complete one another', () => {
  const receipts = [
    event('PreModelRequest', 1),
    event('PreModelRequest', 2, { agent_id: 'agent-a' }),
    event('PostModelRequest', 3, { agent_id: 'agent-a', status: 'failed' }),
    event('PostModelRequest', 4),
  ];
  const board = boardFrom(receipts, 'session-A');
  assert.deepEqual(
    board.entries.map((e) => [e.endedAt, e.status]),
    [
      [4, 'ok'],
      [3, 'err'],
    ]
  );
  assert.equal(board.context, undefined);
});

test('subagents, interrupts, and compaction settle without inventing failures', () => {
  const receipts = [
    event('SubagentStart', 1, { agent_id: 'a' }),
    event('PreToolUse', 2, { agent_id: 'a', tool_name: 'Bash', tool_use_id: 'x' }),
    event('SubagentStop', 3, { agent_id: 'a' }),
    event('PreCompact', 4),
    event('PostCompact', 5),
    event('PreToolUse', 6, { tool_name: 'Bash', tool_use_id: 'y' }),
    event('Interrupt', 7),
  ];
  const board = boardFrom(receipts, 'session-A');
  assert.deepEqual(board.agents, []);
  assert(!board.entries.some((e) => e.status === 'run'));
  assert.deepEqual(board.faults, {});
  assert.match(board.entries.find((e) => e.startedAt === 2)!.label, /ended without result/);
  assert.equal(board.entries.find((e) => e.startedAt === 4)?.endedAt, 5);
});

test('Stop settles its main turn without closing a subagent or another turn', () => {
  const receipts = [
    event('PreToolUse', 1, { tool_name: 'Bash', tool_use_id: 'missing-result' }),
    event('PreModelRequest', 2),
    event('SubagentStart', 3, { agent_id: 'worker' }),
    event('PreToolUse', 4, { agent_id: 'worker', tool_name: 'Bash', tool_use_id: 'worker-call' }),
    event('PreModelRequest', 5, { turn_id: 'other-turn' }),
    event('Stop', 6),
  ];
  const board = boardFrom(receipts, 'session-A');
  assert.equal(board.entries.find((e) => e.startedAt === 1)?.endedAt, 6);
  assert.equal(board.entries.find((e) => e.startedAt === 2)?.status, 'ok');
  assert.equal(board.entries.find((e) => e.startedAt === 4)?.status, 'run');
  assert.equal(board.entries.find((e) => e.startedAt === 5)?.status, 'run');
  assert.deepEqual(board.agents, ['worker']);
  assert.deepEqual(board.faults, {});
  const ended = boardFrom([...receipts, event('SessionEnd', 7)], 'session-A');
  assert(!ended.entries.some((e) => e.status === 'run'));
  assert.deepEqual(ended.agents, []);
});

test('a new turn settles old main entries after a missing Stop, but steering leaves them open', () => {
  const events = [
    event('PreModelRequest', 1),
    event('PreToolUse', 2, { tool_name: 'Bash', tool_use_id: 'lost' }),
    event('PreToolUse', 3, { tool_name: 'Bash', tool_use_id: 'worker', agent_id: 'worker' }),
  ];
  const steered = boardFrom([...events, event('UserPromptSubmit', 4)], 'session-A');
  assert.equal(steered.entries.filter((e) => e.status === 'run').length, 3);
  const resumed = boardFrom(
    [
      ...events,
      event('UserPromptSubmit', 4, { turn_id: 'new-turn' }),
      event('PreModelRequest', 5, { turn_id: 'new-turn' }),
    ],
    'session-A'
  );
  assert.equal(resumed.entries.find((e) => e.startedAt === 1)?.endedAt, 4);
  assert.equal(resumed.entries.find((e) => e.startedAt === 2)?.status, 'ok');
  assert.equal(resumed.entries.find((e) => e.startedAt === 3)?.status, 'run');
  assert.equal(resumed.entries.find((e) => e.startedAt === 5)?.status, 'run');
});

test('missing completions become unconfirmed; a successful poll cannot make old events fresh', () => {
  const board = boardFrom([event('PreModelRequest', 1)], 'session-A');
  assert.equal(activityView(board, 1, EVENT_FRESHNESS_MS).state, 'active');
  const stale = activityView(board, 1, EVENT_FRESHNESS_MS + 1);
  assert.equal(stale.state, 'unconfirmed');
  assert.equal(stale.frozen, true);
  assert.equal(stale.renderAt, 1);
  assert.equal(board.entries[0]?.status, 'run'); // No fabricated completion.
  assert.equal(activityView(board, EVENT_FRESHNESS_MS + 1, EVENT_FRESHNESS_MS + 2).state, 'active');
  assert.equal(activityView(board, 1, 2, false).state, 'disconnected');
  const finished = boardFrom([event('PreModelRequest', 1), event('Stop', 2)], 'session-A');
  assert.equal(activityView(finished, 2, 900000).state, 'idle');
  assert.equal(activityView({ entries: [], counts: {} }, null, 100).state, 'empty');
});

test('rendering escapes hook-supplied labels and core/model names', () => {
  const board = boardFrom(
    [event('PreModelRequest', 1, { model: '<script>evil()</script>' })],
    'session-A'
  );
  const svg = drawMap(board, 2, setupFrom({ coreName: '<svg/>' }));
  assert(!svg.includes('<script>'));
  assert(svg.includes('&lt;script&gt;'));
});

test('atomic receipt store isolates sessions, caps history, and restricts options', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lot-map-store-test-'));

  try {
    const receipts = Array.from({ length: MAX_RECEIPTS + 8 }, (_, i) =>
      event('UserPromptSubmit', i + 1)
    );

    for (let i = 0; i < receipts.length; i += 24) {
      await Promise.all(receipts.slice(i, i + 24).map((r) => saveReceipt(r, root)));
    }

    await saveReceipt(event('SessionStart', 900, { session_id: 'session-B' }), root);
    const stored = await readReceipts('session-A', root);
    assert.equal(stored.length, MAX_RECEIPTS);
    assert.equal(new Set(stored.map((r) => r.id)).size, MAX_RECEIPTS);
    assert.equal((await readReceipts('session-B', root)).length, 1);
    assert.equal((await readReceipts('../../elsewhere', root)).length, 0);
    assert.deepEqual(
      (await listSessions(root)).map((s) => s.id),
      ['session-B', 'session-A']
    );
    await writeFile(
      join(root, 'options.json'),
      JSON.stringify({ language: 'de', apiKey: 'secret' })
    );
    assert.deepEqual(await readOptions(root), { language: 'de' });
    const directory = join(
      root,
      'sessions',
      createHash('sha256').update('session-A').digest('hex')
    );
    const file = (await readdir(directory))[0]!;

    await writeFile(
      join(directory, 'corrupt.json'),
      JSON.stringify({ sessionId: 'session-A', at: 999 })
    );
    assert(!(await readReceipts('session-A', root)).some((r) => r.at === 999));

    if (process.platform !== 'win32') {
      assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
    }

    const old = new Date(Date.now() - 8 * 86400000);
    await utimes(directory, old, old);
    await pruneSessions(root);
    assert.equal((await readReceipts('session-A', root)).length, 0);
    assert.equal((await readReceipts('session-B', root)).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundled collector is silent, stores real-shaped hooks, and ignores malformed input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lot-map-collector-test-'));

  try {
    const run = (input: string) =>
      spawnSync(process.execPath, [resolve('codex/dist/collect.mjs')], {
        input,
        encoding: 'utf8',
        env: { ...process.env, LOT_MAP_DATA: root },
        timeout: 5000,
      });
    const good = run(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'test',
        tool_use_id: 'call',
        tool_name: 'Bash',
        tool_input: { command: 'printf SECRET', description: 'SECRET' },
      })
    );
    assert.equal(good.status, 0);
    assert.equal(good.stdout, '');
    assert.equal(good.stderr, '');
    const stored = await readReceipts('test', root);
    assert.equal(stored.length, 1);
    assert(!JSON.stringify(stored).includes('SECRET'));
    const bad = run('{invalid');
    assert.equal(bad.status, 0);
    assert.equal(bad.stdout, '');
    assert.equal(bad.stderr, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundled MCP server advertises a native pane and serves isolated snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lot-map-mcp-test-'));
  const relocated = join(root, 'relocated-plugin');
  const client = new Client({ name: 'lot-map-test', version: '1' });

  try {
    await mkdir(join(relocated, 'codex/dist'), { recursive: true });

    for (const file of ['server.mjs', 'panel.html']) {
      await cp(resolve('codex/dist', file), join(relocated, 'codex/dist', file));
    }

    const config = JSON.parse(await readFile(resolve('codex/mcp.json'), 'utf8')).mcpServers.lot_map;
    await saveReceipt(event('PreToolUse', 1, { tool_name: 'Bash', tool_use_id: 'a' }), root);
    await saveReceipt(event('UserPromptSubmit', 2, { session_id: 'session-B' }), root);
    await client.connect(
      new StdioClientTransport({
        command: config.command,
        args: config.args,
        cwd: resolve(relocated, config.cwd),
        env: { ...process.env, LOT_MAP_DATA: root },
      })
    );
    const { tools } = await client.listTools();
    const open = tools.find((t) => t.name === 'lot_map_open')!;
    assert.equal(
      (open._meta!['openai/ui'] as { preferredModelDisplayMode: string }).preferredModelDisplayMode,
      'fullscreen'
    );
    assert.deepEqual(
      (tools.find((t) => t.name === 'lot_map_snapshot')!._meta!.ui as { visibility: string[] })
        .visibility,
      ['app']
    );
    const resource = await client.readResource({
      uri: (open._meta!.ui as { resourceUri: string }).resourceUri,
    });
    assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app');
    const content = resource.contents[0]!;
    assert('text' in content);
    assert.match(content.text, /Open panel/);
    const before = await client.callTool({
      name: 'lot_map_snapshot',
      arguments: { session_id: 'session-A' },
    });
    const first = before.structuredContent as {
      board: { entries: { status: string }[] };
      receiptCount: number;
    };
    assert.equal(first.receiptCount, 1);
    assert.equal(first.board.entries[0]?.status, 'run');
    await saveReceipt(event('PostToolUse', 3, { tool_name: 'Bash', tool_use_id: 'a' }), root);
    const after = await client.callTool({
      name: 'lot_map_snapshot',
      arguments: { session_id: 'session-A' },
    });
    const second = after.structuredContent as typeof first;
    assert.equal(second.receiptCount, 2);
    assert.equal(second.board.entries.length, 1);
    assert.equal(second.board.entries[0]?.status, 'ok');
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
