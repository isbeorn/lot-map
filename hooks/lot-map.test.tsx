import { expect, test } from 'claude-code/testing';

import type { Board, Entry } from '../types';
import {
  COLOR_NAMES,
  TRAIL_FADE_MS,
  TRAIL_HOLD_MS,
  classify,
  clean,
  describeNow,
  drawLanes,
  drawMap,
  firstLine,
  foldRows,
  formatMs,
  memoryIds,
  routeOf,
  setupFrom,
  shortModel,
  taskNotice,
  taskOf,
} from './map';
import { stringsFor } from './text';

const PANE = {
  plugin: 'lot-map',
  component: 'Pane',
  requestId: 'lot-map',
  props: {
    title: 'Map',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

// Someone's own setup as it stands in settings: Russian labels and a memory of their own.
const OWN = {
  language: 'ru',
  coreName: 'ДОМ',
  memoryServers: ['recall'],
  memoryCommands: ['recall', 'check_recall'],
  memorySubcommands: ['add', 'memory'],
  memoryPaths: ['/.recall/'],
  memoryLabels: ['search=поиск', 'get_note=чтение записи'],
  hookRecords: true,
} as const;
const SETUP = setupFrom(OWN);
const STRANGER = setupFrom({
  language: 'en',
  coreName: 'CLAUDE',
  memoryServers: ['memory'],
  hookRecords: false,
});

test('every kind of call lands on its station', () => {
  const at = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).station;
  expect(at('Bash', { command: 'recall memory journal --last 30' })).toBe('memory');
  expect(at('Bash', { command: 'python3 ~/.claude/scripts/recall-sync.py --apply' })).toBe(
    'memory'
  );
  expect(at('Bash', { command: 'python3 scripts/check_recall.py' })).toBe('memory');
  expect(at('Bash', { command: 'D=/tmp; cat $D/a | grep x; echo done' })).toBe('files');
  expect(at('Bash', { command: 'cat ~/.claude/projects/-Users-a/memory/x.md' })).toBe('memory');
  expect(at('Bash', { command: 'cat ~/.recall/x.md' })).toBe('memory');
  expect(at('Bash', { command: 'git push origin main' })).toBe('web');
  expect(at('Bash', { command: 'gh pr list' })).toBe('web');
  expect(at('Bash', { command: 'git status' })).toBe('shell');
  expect(at('Bash', { command: 'python3 _src/build.py' })).toBe('shell');
  expect(at('Read', { file_path: '/a/b/c/content.py' })).toBe('files');
  expect(at('Grep', { pattern: 'x' })).toBe('files');
  expect(at('Glob', { pattern: 'x' })).toBe('files');
  expect(at('Edit', { file_path: '/Users/a/.claude/projects/p/memory/n.md' })).toBe('memory');
  expect(at('mcp__recall__search', { query: 'x' })).toBe('memory');
  expect(at('mcp__Claude_Browser__navigate', { url: 'https://a.b/c' })).toBe('browser');
  expect(at('WebFetch', { url: 'https://a.b/c' })).toBe('web');
  expect(at('Agent', { description: 'x' })).toBe('agents');
  expect(at('Skill', { skill: 'pdf' })).toBe('skills');
  expect(at('AskUserQuestion', {})).toBe('you');
});

test('out of the box, memory is only what every install has', () => {
  const at = (tool: string, input: Record<string, unknown>) =>
    classify(tool, input, STRANGER).station;
  expect(at('Read', { file_path: '/Users/a/.claude/projects/p/memory/n.md' })).toBe('memory');
  expect(at('Read', { file_path: '/Users/a/.recall/n.md' })).toBe('files');
  expect(at('mcp__memory__search_nodes', {})).toBe('memory');
  expect(at('mcp__recall__search', {})).toBe('web');
  expect(at('Bash', { command: 'recall memory journal' })).toBe('shell');
  expect(classify('mcp__memory__search_nodes', {}, STRANGER).label).toBe('search nodes');
});

test('labels never carry what was written or searched', () => {
  const label = (tool: string, input: Record<string, unknown>) =>
    classify(tool, input, SETUP).label;
  expect(label('Read', { file_path: '/a/b/c/content.py' })).toBe('c/content.py');
  expect(label('Bash', { command: 'recall add "private text" --category journal' })).toBe('add');
  expect(label('Bash', { command: 'recall memory journal --last 30' })).toBe('memory');
  expect(label('Bash', { command: 'recall add private words here' })).toBe('add');
  expect(label('Bash', { command: 'recall private words here' })).toBe('recall');
  expect(label('Bash', { command: 'recall "private text"' })).toBe('recall');
  expect(label('mcp__recall__search', { query: 'private' })).toBe('поиск');
  expect(label('mcp__recall__get_note', { id: 7 })).toBe('чтение записи #7');
  expect(label('WebFetch', { url: 'https://a.b/secret?x=1' })).toBe('a.b');
  expect(label('WebFetch', { url: 'https://user:private@a.b/x' })).toBe('a.b');
  expect(label('WebFetch', { url: 'a.b/reset?token=private' })).toBe('a.b');
  expect(label('WebFetch', { url: 'file:///Users/a/private.txt' })).toBe('file');
  expect(label('mcp__Claude_Browser__navigate', { url: 'https://user:private@a.b/x' })).toBe('a.b');
  expect(label('Grep', { pattern: 'private' })).toBe('Grep');
  expect(label('WebSearch', { query: 'private' })).toBe('поиск в сети');
});

test('a password never reaches a label, even with a slash, a question mark or a hash in it', () => {
  const label = (url: string) => classify('WebFetch', { url }, SETUP).label;
  expect(label('https://user:pa/ss@host.com/x')).toBe('host.com');
  expect(label('https://user:pa?ss@host.com')).toBe('host.com');
  expect(label('https://user:p#w@host.com')).toBe('host.com');
  expect(label('https://u:p%40ss@h.com')).toBe('h.com');
  expect(label('postgres://admin:hunter2@db.internal:5432/prod')).toBe('db.internal:5432');
  // A number after the colon may be a port or a password: neither reading is shown.
  expect(label('https://user:12345/x@host.com')).toBe('https');
  expect(label('https://host.com:8080/x?mail=a@b.com')).toBe('https');
  expect(label('https://host.com/x?mail=a@b.com')).toBe('host.com');
  expect(label('https://[::1]:8080/x')).toBe('[::1]:8080');
  expect(label('https://пример.рф/x')).toBe('пример.рф');
  expect(label('https://bad host/x')).toBe('https');
});

test('a Windows path is read like any other: the last two parts, memory folders, command names', () => {
  const label = (tool: string, input: Record<string, unknown>) =>
    classify(tool, input, SETUP).label;
  const at = (tool: string, input: Record<string, unknown>, setup = SETUP) =>
    classify(tool, input, setup).station;
  expect(label('Read', { file_path: 'C:\\Users\\a\\private\\c\\content.py' })).toBe('c/content.py');
  expect(label('Edit', { file_path: 'C:\\Users\\a\\b/mixed\\n.md' })).toBe('mixed/n.md');
  expect(
    at(
      'Read',
      { file_path: 'C:\\Users\\a\\.claude\\projects\\C--Users-a-p\\memory\\n.md' },
      STRANGER
    )
  ).toBe('memory');
  expect(at('Read', { file_path: 'C:\\Users\\a\\.recall\\n.md' })).toBe('memory');
  expect(at('Read', { file_path: 'C:\\Users\\a\\recall\\n.md' })).toBe('files');
  expect(at('Bash', { command: 'C:\\tools\\curl.exe -s https://a.b/list' })).toBe('web');
  expect(at('Bash', { command: 'C:\\Git\\cmd\\git.exe push origin main' })).toBe('web');
  expect(at('Bash', { command: 'C:\\tools\\grep.exe x C:\\Users\\a\\.recall\\n.md' })).toBe(
    'memory'
  );
  expect(label('Bash', { command: 'C:\\Users\\a\\private\\python.exe build.py' })).toBe('python');
  expect(label('Bash', { command: 'C:\\Users\\a\\private\\recall.exe add private words' })).toBe(
    'add'
  );
});

test('a memory command shows a word after it only when that word is a listed subcommand', () => {
  const label = (command: string) => classify('Bash', { command }, SETUP).label;
  expect(label('recall add private words')).toBe('add');
  expect(label('recall hello world')).toBe('recall');
  expect(label('recall search private')).toBe('recall');
  expect(classify('mcp__recall__get_note', { id: 'note-7' }, SETUP).label).toBe(
    'чтение записи #note-7'
  );
  expect(classify('mcp__recall__get_note', { id: 'private words under id' }, SETUP).label).toBe(
    'чтение записи'
  );
});

test('a memory command is matched by its whole name, not by how any name starts', () => {
  const short = setupFrom({ memoryCommands: ['m', 'recall'] });
  const at = (command: string) => classify('Bash', { command }, short).station;
  expect(at('mv a b')).toBe('files');
  expect(at('mkdir x')).toBe('files');
  expect(at('make all')).toBe('shell');
  expect(at('recallable --now')).toBe('shell');
  expect(at('m note')).toBe('memory');
  expect(at('recall-sync.py --apply')).toBe('memory');
  expect(at('python3 scripts/recall_check.py')).toBe('memory');
});

test('commands that reach the network light Network, also from inside another command', () => {
  const at = (command: string) => classify('Bash', { command }, SETUP).station;
  expect(at('rsync -a a/ host:b/')).toBe('web');
  expect(at('nc -z host 80')).toBe('web');
  expect(at('npm install')).toBe('web');
  expect(at('npm test')).toBe('shell');
  expect(at('docker pull image')).toBe('web');
  expect(at('docker ps')).toBe('shell');
  expect(at('cat $(curl -s https://a.b/list)')).toBe('web');
  expect(at('cat `curl -s https://a.b/list`')).toBe('web');
  expect(at('cat "$(dirname x)/a"')).toBe('files');
});

test('a label loses what a terminal would act on', () => {
  expect(clean('a\u001b[31mred\u0007 b')).toBe('a [31mred b');
  expect(clean('line\nnext\ttab')).toBe('line next tab');
  expect(clean('x\u202egnp.exe')).toBe('x gnp.exe');
  expect(clean('я'.repeat(200)).length).toBe(120);
});

test('hook helpers', () => {
  expect(memoryIds('• [#1971 excerpt] and [now #45] and [todo #3] and [#1971 again]')).toEqual([
    '1971',
    '45',
    '3',
  ]);
  expect(firstLine('\nBlocked by x: rule.\nCommand: secret')).toBe('Blocked by x: rule.');
  expect(formatMs(1500, stringsFor('en'))).toBe('1.5 s');
  expect(formatMs(1500, stringsFor('ru'))).toBe('1.5 с');
  expect(formatMs(1500, stringsFor('de'))).toBe('1,5 s');
  expect(stringsFor('en').records(1, '#7')).toBe('1 record: #7');
  expect(stringsFor('en').stations.web).toBe('Network');
});

const LANGUAGES = ['en', 'ru', 'es', 'fr', 'de', 'it'] as const;

test('every language has every word, in a table of its own', () => {
  const en = stringsFor('en');

  for (const language of LANGUAGES) {
    const t = stringsFor(language);
    expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(t.stations).sort()).toEqual(Object.keys(en.stations).sort());
    expect(Object.values(t.stations).every((name) => name !== '')).toBe(true);
  }

  expect(new Set(LANGUAGES.map((language) => stringsFor(language).title)).size).toBe(
    LANGUAGES.length
  );
  expect(stringsFor('constructor').title).toBe(en.title);
});

for (const [language, row] of [
  ['es', 'Archivos  b/content.py'],
  ['fr', 'Fichiers   b/content.py'],
  ['de', 'Dateien    b/content.py'],
  ['it', 'File      b/content.py'],
] as const) {
  test(
    `the pane speaks ${language}, its columns even`,
    { options: { language } },
    async ($, on) => {
      on('clock.now', () => ({ value: 1_000_000 }));
      on('tool.call', () => ({ result: {} }));
      await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' });

      const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
      expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain(row);
      await ui.unmount();
    }
  );
}

test('options that make no sense count as not set', () => {
  const odd = setupFrom({
    language: 'xx',
    coreName: '   ',
    memoryServers: 7,
    memoryLabels: ['no-equals', '=x', 'y='],
    hookRecords: 'yes',
  });
  expect(odd.t.idle).toBe(stringsFor('en').idle);
  expect(odd.core).toBe('CLAUDE');
  expect(odd.memoryServers.size).toBe(0);
  expect(odd.memoryLabels.size).toBe(0);
  expect(odd.hookRecords).toBe(false);
});

test('a long name shrinks inside the core and cannot break the drawing', () => {
  const svg = (name: string) =>
    drawMap({ entries: [], counts: {} }, 1000, setupFrom({ coreName: name }));
  expect(svg('A<B&"C"DEFGHIJK')).toContain('A&lt;B&amp;&quot;C&quot;DEF<');
  expect(svg('ABC')).toContain('font-size="17" letter-spacing="2.5"');
  expect(svg('CLAUDE')).toContain('font-size="13.8"');
  expect(svg('')).toContain('>CLAUDE<');
});

test('the drawing stays within what Svg accepts at its fullest', () => {
  const now = 1_000_000;
  const stations = [
    'you',
    'model',
    'memory',
    'files',
    'shell',
    'web',
    'browser',
    'agents',
    'skills',
    'hooks',
  ] as const;
  const board: Board = {
    model: 'claude-opus-5-5',
    step: 12,
    counts: { files: 12345 },
    entries: Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      station: stations[i % stations.length] as (typeof stations)[number],
      label: 'x'.repeat(70),
      from: 'core' as const,
      startedAt: now - 100 - i,
      status: 'run' as const,
    })),
  };
  const svg = drawMap(board, now, SETUP);
  expect(svg.length).toBeLessThan(131072);
  expect(svg).toContain('<animateMotion');
  expect(svg).toContain('opus 5.5');
  expect(svg).not.toContain('xxxxx');
  expect(svg).not.toContain('NaN');
  // Attributes are well formed: none empty, none run into the next.
  expect(svg).not.toContain('=""');
  expect(/"[a-z-]+="/.test(svg)).toBe(false);
  expect(svg).toContain('font-family="SF Mono, ui-monospace, Menlo, monospace"');
  expect(svg).not.toContain('Infinity');
});

test('with no options set the map speaks English and shows no record numbers', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('tool.call', () => ({ result: {} }));
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#12 excerpt] text of a note'] }));

  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never);
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' });
  await $.tool.call({ tool: 'Bash', command: 'recall add note', description: 'Save a note' });

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ type: 'Text', text: /[а-яё]/i })).toBeUndefined();
    expect((await ui.find({ type: 'Text', text: /added context to the message/ }))?.text).toContain(
      'Hooks'
    );
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Files');
    expect((await ui.find({ type: 'Text', text: /Save a note/ }))?.text).toContain('Shell');
    expect(await ui.find({ type: 'Text', text: /#12/ })).toBeUndefined();
    await ui.unmount();
  }
});

test('a call shows on the pane, on every surface', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('command.register', () => ({ value: { command: 'lot-map' } }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('tool.call', () => ({ result: {} }));

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true });
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' });

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Файлы');
    await ui.unmount();
  }
});

test(
  'a call a settings hook refused reads as blocked, with the hook lit and its words kept back',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on('classic.PreToolUse', () => ({ deny: 'JUDGE: found key sk-private\nCommand: secret' }));
    on('tool.call', () => ({ result: {} }));

    await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' });

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    expect((await ui.find({ type: 'Text', text: /остановил Bash/ }))?.text).toContain('Хуки');
    expect((await ui.find({ type: 'Text', text: /Показать статус/ }))?.text).toContain('✕');
    expect(await ui.find({ type: 'Text', text: /JUDGE|sk-private|secret/ })).toBeUndefined();
    await ui.unmount();
  }
);

test(
  'with hookReasons on, the first line of a refusal shows and the rest does not',
  { options: { ...OWN, hookReasons: true } },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on('classic.PreToolUse', () => ({ deny: 'JUDGE: нельзя\nCommand: secret' }));
    on('tool.call', () => ({ result: {} }));

    await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' });

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    expect((await ui.find({ type: 'Text', text: /JUDGE/ }))?.text).toContain('Хуки');
    expect(await ui.find({ type: 'Text', text: /secret/ })).toBeUndefined();
    await ui.unmount();
  }
);

test('memory a hook adds shows as numbers, never as its text', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('classic.UserPromptSubmit', () => ({
    additionalContext: ['• [#1971 excerpt] тайный текст записи\n• [#277 excerpt] ещё'],
  }));

  await $.classic.UserPromptSubmit({ prompt: 'привет', permission_mode: 'default' } as never);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect((await ui.find({ type: 'Text', text: /записей 2/ }))?.text).toContain('#1971 #277');
  expect(await ui.find({ type: 'Text', text: /тайный/ })).toBeUndefined();
  await ui.unmount();
});

test('a broken board never stops the tool', async ($, on) => {
  on('state.get', () => {
    throw new Error('no state');
  });
  on('state.set', () => {
    throw new Error('no state');
  });
  on('tool.call', () => ({ result: { ok: true } }));

  const ran = await $.tool.call({ tool: 'Read', file_path: '/a' });
  expect(ran.deny).toBeUndefined();
  expect(ran.result).toEqual({ ok: true });
});

test('what an earlier version stored is declined', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('state.get', () => ({ value: { value: { rows: 1 }, version: 1 } }));

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect((await ui.find({ type: 'Text', text: /Пока ничего/ }))?.text).toBe('Пока ничего не было.');
  await ui.unmount();
});

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as const;

test(
  'a model step streams through untouched and shows on the map',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on('turn.step', async function* () {
      yield { kind: 'text', index: 0, text: 'первый' } as never;
      yield { kind: 'text', index: 0, text: 'второй' } as never;

      return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
    });

    const seen: unknown[] = [];
    const stream = $.turn.step(STEP);

    for await (const chunk of stream) {
      seen.push(chunk);
    }

    expect(seen).toEqual([
      { kind: 'text', index: 0, text: 'первый' },
      { kind: 'text', index: 0, text: 'второй' },
    ]);

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    const row = await ui.find({ type: 'Text', text: /шаг 1/ });
    expect(row?.text).toContain('Модель');
    expect(row?.text).toContain('opus 5.5');
    await ui.unmount();
  }
);

test('a broken board never stops a model step', async ($, on) => {
  on('state.get', () => {
    throw new Error('no state');
  });
  on('state.set', () => {
    throw new Error('no state');
  });
  on('clock.now', () => {
    throw new Error('no clock');
  });
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'дошло' } as never;

    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
  });

  const seen: unknown[] = [];

  for await (const chunk of $.turn.step(STEP)) {
    seen.push(chunk);
  }

  expect(seen).toEqual([{ kind: 'text', index: 0, text: 'дошло' }]);
});

test(
  'the end of a turn settles a call that never reported back',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on('turn.complete', () => ({ text: '' }));
    on('turn.step', async function* () {
      yield { kind: 'text', index: 0, text: 'и всё' } as never;

      return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
    });
    // A step that was never read to its end stays "running", as an interrupted call does.
    const hanging = $.turn.step(STEP)[Symbol.asyncIterator]();
    await hanging.next();

    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: true,
      turnId: 't1',
      reason: 'aborted',
    } as never);

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    expect((await ui.find({ type: 'Text', text: /ход прерван/ }))?.text).toContain('Ты');
    expect(await ui.find({ type: 'Text', text: /идёт/ })).toBeUndefined();
    await ui.unmount();
  }
);

// ---- what the second version added ---------------------------------------------------------------

const entry = (station: Entry['station'], startedAt: number, more: Partial<Entry> = {}): Entry => ({
  id: `${station}${startedAt}`,
  station,
  label: station,
  from: 'core',
  startedAt,
  endedAt: startedAt + 10,
  status: 'ok',
  ...more,
});

test("the route is the main loop's stations in order, repeats and model steps left out", () => {
  const entries = [
    entry('you', 1, { from: 'inbound' }),
    entry('model', 2),
    entry('memory', 3),
    entry('memory', 4),
    entry('model', 5),
    entry('files', 6),
    entry('shell', 7, { from: 'agents', agentId: 'a1' }),
    entry('shell', 8),
  ];
  expect(routeOf(entries).map((stop) => stop.station)).toEqual(['you', 'memory', 'files', 'shell']);
  expect(routeOf(entries)[1]?.at).toBe(4);
  expect(routeOf(entries, 2).map((stop) => stop.station)).toEqual(['files', 'shell']);

  const svg = drawMap({ entries, counts: {} }, 5000, STRANGER);
  expect(svg.split('<path d="M').length - 1).toBe(3);
  expect(svg).toContain('stroke-dashoffset');
});

test('finished calls in a row at one station fold into one row, anything else stands alone', () => {
  const rows = foldRows([
    entry('files', 1),
    entry('files', 20),
    entry('files', 40),
    entry('shell', 60, { status: 'err' }),
    entry('shell', 80, { status: 'err' }),
    entry('model', 100, { mark: 'switch' }),
    entry('files', 120, { status: 'run', endedAt: undefined }),
    entry('files', 140),
  ]);
  expect(rows.map((row) => `${row.entry.station} ${row.times} ${row.tookMs}`)).toEqual([
    'files 1 10',
    'files 1 0',
    'model 1 10',
    'shell 1 10',
    'shell 1 10',
    'files 3 30',
  ]);
  expect(
    foldRows(Array.from({ length: 40 }, (_, i) => entry(i % 2 ? 'files' : 'shell', i * 20))).length
  ).toBe(16);
});

test('a spoke wears in with use and memory has a colour of its own', () => {
  const quiet = drawMap({ entries: [], counts: {} }, 1000, STRANGER);
  const busy = drawMap(
    { entries: [], counts: { files: 200, memory: 9 }, pushed: 4 },
    1000,
    STRANGER
  );
  expect(quiet).not.toContain('stroke-width="3.6"');
  expect(busy).toContain('stroke-width="3.6"');
  expect(busy).toContain('>5 <tspan fill="#62c7ba">↓4</tspan>');
  expect(drawMap({ entries: [], counts: { memory: 4 }, pushed: 4 }, 1000, STRANGER)).toContain(
    '><tspan fill="#62c7ba">↓4</tspan>'
  );
});

test('a long call shows two clock hands, several at once a count, a fault a dot until the next message', () => {
  const now = 1_000_000;
  const running = (startedAt: number): Entry =>
    entry('shell', startedAt, { status: 'run', endedAt: undefined });
  const one = drawMap({ entries: [running(now - 90_000)], counts: { shell: 1 } }, now, STRANGER);
  expect(one).toContain('begin="-30.000s" dur="60.000s" repeatCount="indefinite"');
  expect(one).toContain('begin="-90.000s" dur="600.000s" fill="freeze"');
  expect(one).not.toContain('×');
  const three = drawMap(
    { entries: [running(now - 300), running(now - 200), running(now - 100)], counts: { shell: 3 } },
    now,
    STRANGER
  );
  expect(three).toContain('>×3<');
  expect(drawMap({ entries: [], counts: {}, faults: { shell: 2 } }, now, STRANGER)).toContain(
    'font-weight="700" fill="#0a0c11">2<'
  );
  expect(drawMap({ entries: [], counts: {} }, now, STRANGER)).not.toContain('font-weight="700"');
});

test('the context ring, the crew, the model change and the light theme are drawn only when there is something to show', () => {
  const now = 1_000_000;
  const bare = drawMap({ entries: [], counts: {} }, now, STRANGER);
  expect(bare).not.toContain('pathLength="100"');
  expect(bare).not.toContain('animateTransform');
  expect(bare).toContain('#0a0c11');

  const full = drawMap(
    {
      entries: [],
      counts: {},
      model: 'claude-fable-5-2',
      context: 92.4,
      agents: ['a', 'b'],
      switchedAt: now - 2000,
    },
    now,
    STRANGER
  );
  expect(full).toContain('stroke="#e8654f" pathLength="100" stroke-dasharray="92 100"');
  expect(full).toContain('>92%<');
  expect(full.split('<animateTransform').length - 1).toBe(2);
  expect(full).toContain('repeatCount="4" fill="freeze"');
  expect(drawMap({ entries: [], counts: {}, switchedAt: now - 9000 }, now, STRANGER)).not.toContain(
    'repeatCount="1" fill="freeze"'
  );

  // Left to itself the map is drawn dark and carries the rules that repaint it on a light surface; a set theme carries none.
  expect(bare).toContain(
    '<style>@media (prefers-color-scheme: light){[fill="#0a0c11"]{fill:#f5f2ea}'
  );
  expect(bare).toContain('<rect width="460" height="430" rx="12" fill="#0a0c11"/>');
  const dark = drawMap({ entries: [], counts: {} }, now, setupFrom({ theme: 'dark' }));
  expect(dark).not.toContain('<style>');
  expect(dark).not.toContain('#f5f2ea');
  const light = drawMap({ entries: [], counts: {} }, now, setupFrom({ theme: 'light' }));
  expect(light).not.toContain('<style>');
  expect(light).toContain('<rect width="460" height="430" rx="12" fill="#f5f2ea"/>');
  // Whatever is lit, every color the dark drawing uses is one the rules know.
  const lit = drawMap(
    {
      entries: [
        entry('memory', now - 100, { from: 'inbound' }),
        entry('shell', now - 50, { status: 'err' }),
        entry('files', now - 20, { status: 'run', endedAt: undefined }),
      ],
      counts: { files: 50, memory: 3 },
      pushed: 1,
      faults: { shell: 1 },
      context: 80,
      agents: ['a'],
      switchedAt: now - 10,
      model: 'claude-fable-5-2',
    },
    now,
    setupFrom({ theme: 'dark' })
  );
  const known = new Set([
    '#0a0c11',
    '#12151c',
    '#272c36',
    '#1a1e27',
    '#ebe6dc',
    '#9ba1ab',
    '#6b7280',
    '#e1ac6e',
    '#f0c595',
    '#e8654f',
    '#62c7ba',
    '#a5e6dc',
    '#ebe6dd',
  ]);
  expect(
    [...new Set(lit.match(/#[0-9a-f]{6}/g) ?? [])].filter((color) => !known.has(color))
  ).toEqual([]);
});

const stepOn = (model: string) => ({ turnId: 't1', index: 0, model, messageCount: 1 }) as const;

test(
  'a model that changes mid-session is a row of its own, and the first model of a session is not',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    // The handler has to be a generator, even with nothing to stream.
    // eslint-disable-next-line require-yield
    on('turn.step', async function* () {
      return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
    });

    for (const model of ['claude-opus-5-5', 'claude-opus-5-5', 'claude-fable-5-2']) {
      for await (const _ of $.turn.step(stepOn(model))) {
        void _;
      }
    }

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    const row = await ui.find({ type: 'Text', text: /→/ });
    expect(row?.text).toContain('◆ Модель');
    expect(row?.text).toContain('opus 5.5 → fable 5.2');
    expect((await ui.find({ type: 'Text', text: /\+1/ }))?.text).toContain('opus 5.5 · шаг 1');
    await ui.unmount();
  }
);

test(
  'a subagent circles the agents station until its loop ends, and its hanging call is settled then',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on('turn.complete', () => ({ text: '' }));
    on('turn.step', async function* () {
      yield { kind: 'text', index: 0, text: 'x' } as never;

      return { turnId: 't2', index: 0, answer: '', toolUses: [] } as never;
    });
    const hanging = $.turn
      .step({ ...stepOn('claude-haiku-5-5'), turnId: 't2', agentId: 'a1' } as never)
      [Symbol.asyncIterator]();
    await hanging.next();

    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    expect((await ui.find({ type: 'Text', text: /идёт/ }))?.text).toContain('субагент');
    expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('animateTransform');
    await ui.unmount();

    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't2',
      reason: 'answer',
      agentId: 'a1',
    } as never);

    ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    expect(await ui.find({ type: 'Text', text: /идёт/ })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: /ответ готов/ })).toBeUndefined();
    expect((await ui.find({ type: 'Svg' }))?.props.source).not.toContain('animateTransform');
    await ui.unmount();
  }
);

test(
  'what goes wrong stays on its station until the next message; an interrupted turn is no fault',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on('turn.complete', () => ({ text: '' }));
    on('turn.start', (_, e) => ({ turnId: e.turnId }) as never);
    on('tool.call', () => ({ result: {}, isError: true }) as never);

    await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' });
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: true,
      turnId: 't1',
      reason: 'aborted',
    } as never);

    const dots = async (): Promise<number> => {
      const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
      const source = String((await ui.find({ type: 'Svg' }))?.props.source);
      await ui.unmount();

      return source.split('font-weight="700"').length - 1;
    };

    expect(await dots()).toBe(1);
    await $.turn.start({ text: 'дальше', turnId: 't2' } as never);
    expect(await dots()).toBe(0);
  }
);

test(
  'the context window shows as soon as the engine tells how full it is',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on(
      'session.usage',
      () => ({ value: { startedAt: 0, context: { window: 200000, percent: 37 } } }) as never
    );
    // The handler has to be a generator, even with nothing to stream.
    // eslint-disable-next-line require-yield
    on('turn.step', async function* () {
      return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
    });

    for await (const _ of $.turn.step(stepOn('claude-opus-5-5'))) {
      void _;
    }

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('>37%<');
    expect((await ui.find({ type: 'Text', text: /контекст 37%/ }))?.text).toContain(
      'Сейчас ничего не выполняется'
    );
    await ui.unmount();
  }
);

test('the ring can be turned so that the person is at the bottom and the network at the top', () => {
  const heightOf = (svg: string, name: string): number =>
    Number(new RegExp(`y="([\\d.]+)"[^>]*>${name}<`).exec(svg)?.[1]);
  const board: Board = { entries: [], counts: {} };
  const usual = drawMap(board, 1000, setupFrom({ theme: 'dark' }));
  const turned = drawMap(board, 1000, setupFrom({ theme: 'dark', layout: 'you-bottom' }));
  expect(heightOf(usual, 'You')).toBeLessThan(heightOf(usual, 'Network'));
  expect(heightOf(turned, 'You')).toBe(heightOf(usual, 'Network'));
  expect(heightOf(turned, 'Network')).toBe(heightOf(usual, 'You'));
  expect(heightOf(turned, 'Browser')).toBe(heightOf(usual, 'Model'));
  // A turned map does not leak into the next one drawn, and nonsense counts as not set.
  expect(drawMap(board, 1000, setupFrom({ theme: 'dark' }))).toBe(usual);
  expect(drawMap(board, 1000, setupFrom({ theme: 'dark', layout: 'sideways' }))).toBe(usual);
});

test('the map paints its ground unless told to leave the surface showing', () => {
  const board = { entries: [], counts: {} } as never;
  const ground = /<rect width="460" height="430" rx="12"/;
  expect(drawMap(board, 0, SETUP)).toMatch(ground);
  expect(drawMap(board, 0, setupFrom({ ...OWN, background: 'clear' }))).toMatch(ground);
  const bare = drawMap(board, 0, setupFrom({ ...OWN, background: 'transparent' }));
  expect(bare).not.toMatch(ground);
  expect(bare).toContain('ДОМ');
  // The setting does not leak into the next drawing.
  expect(drawMap(board, 0, SETUP)).toMatch(ground);
});

test('a quoted path with a space is one command, and a Windows program is read whatever its capitals', () => {
  const at = (command: string) => classify('Bash', { command }, SETUP).station;
  const label = (command: string) => classify('Bash', { command }, SETUP).label;
  expect(at('"C:\\Program Files\\Git\\cmd\\git.exe" push origin main')).toBe('web');
  expect(label('"C:\\Program Files\\Git\\cmd\\git.exe" status')).toBe('git');
  expect(at("'/Applications/My Tools/bin/curl' -s https://a.b/x")).toBe('web');
  expect(at('C:\\tools\\CURL.EXE -s https://a.b/x')).toBe('web');
  expect(at('npm.cmd install')).toBe('web');
  expect(at('NPM.CMD test')).toBe('shell');
  // Without a Windows ending a name keeps its case: on other systems `Curl` is another program.
  expect(at('Curl -s https://a.b/x')).toBe('shell');
  // A quote left open does not swallow the line into nothing.
  expect(label('grep "unfinished x.txt')).toBe('grep');
  expect(at('cat "my notes.txt" | grep "two words"')).toBe('files');
});

test('the PowerShell tool is read like the shell: its description as the label, its commands by their own names', () => {
  const ps = (command: string, description = '') =>
    classify('PowerShell', { command, description }, SETUP);
  expect(ps('Get-Content C:\\Users\\a\\private\\notes.txt', 'Read the notes').label).toBe(
    'Read the notes'
  );
  expect(ps('Get-Content C:\\Users\\a\\private\\notes.txt').label).toBe('Get-Content');
  expect(ps('Get-Content notes.txt | Select-String todo').station).toBe('files');
  expect(
    ps('get-childitem -Recurse | Where-Object { $_.Length -gt 1kb } | Sort-Object Length').station
  ).toBe('files');
  expect(ps('$text = Get-Content notes.txt; Write-Host done').station).toBe('files');
  expect(ps('Get-Content C:\\Users\\a\\.recall\\n.md').station).toBe('memory');
  expect(ps('Invoke-WebRequest https://a.b/x -OutFile x.zip').station).toBe('web');
  expect(ps('IRM https://a.b/x').station).toBe('web');
  expect(ps('& "C:\\Program Files\\Git\\cmd\\git.exe" push origin main').station).toBe('web');
  expect(ps('git status').station).toBe('shell');
  expect(ps('Get-Process | Stop-Process').station).toBe('shell');
  expect(ps('recall add private words').label).toBe('add');
  expect(ps('Invoke-WebRequest https://user:private@a.b/secret?x=1').label).toBe(
    'Invoke-WebRequest'
  );
  // The same names mean nothing to the Bash tool.
  expect(classify('Bash', { command: 'Get-Content notes.txt' }, SETUP).station).toBe('shell');
});

test('the route is soft on a light surface and each leg fades by itself after a while', () => {
  const walk = [
    entry('you', 1000, { from: 'inbound' }),
    entry('memory', 2000),
    entry('files', 3000),
    entry('shell', 4000),
  ];
  const legs = (svg: string) => svg.split('<path d="M').length - 1;
  const fresh = 5000;

  // Three legs, each carrying the animation that takes it away: it starts when the hold is over.
  const dark = drawMap({ entries: walk, counts: {} }, fresh, setupFrom({ theme: 'dark' }));
  expect(legs(dark)).toBe(3);
  expect(dark.split('attributeName="opacity" values="').length - 1).toBeGreaterThanOrEqual(3);
  expect(dark).toContain(
    `begin="${((TRAIL_HOLD_MS - (fresh - 4000)) / 1000).toFixed(3)}s" dur="${(TRAIL_FADE_MS / 1000).toFixed(3)}s"`
  );
  expect(dark).toContain('stroke="#ebe6dd"');

  // On a light surface the route is a grey of its own, not the ink of the words.
  const light = drawMap({ entries: walk, counts: {} }, fresh, setupFrom({ theme: 'light' }));
  expect(light).toContain('stroke="#9c978b"');
  expect(light).not.toMatch(/<path d="M[^>]*stroke="#1f2228"[^>]*stroke-linecap="round" opacity=/);
  // Left to itself the map repaints the route with the rest.
  expect(drawMap({ entries: walk, counts: {} }, fresh, STRANGER)).toContain(
    '[stroke="#ebe6dd"]{stroke:#9c978b}'
  );

  // A leg in the middle of its fading starts the animation in the past, so it is drawn part-way gone.
  // The two older legs are gone by then; the newest has a second left.
  const almost = 3000 + TRAIL_HOLD_MS + TRAIL_FADE_MS;
  const fading = drawMap({ entries: walk, counts: {} }, almost, setupFrom({ theme: 'dark' }));
  expect(legs(fading)).toBe(1);
  expect(fading).toContain(`begin="${((TRAIL_HOLD_MS - (almost - 4000)) / 1000).toFixed(3)}s"`);

  // After the hold and the fade nothing of the route is left; the spokes still say where the work went.
  const later = drawMap(
    { entries: walk, counts: { shell: 1 } },
    4000 + TRAIL_HOLD_MS + TRAIL_FADE_MS,
    setupFrom({ theme: 'dark' })
  );
  expect(legs(later)).toBe(0);
  expect(later).not.toContain('stroke="#ebe6dd"');
});

test('colors of your own replace their places in the palette, and nothing but a hex color gets into the drawing', () => {
  const board = {
    entries: [entry('you', 1000, { from: 'inbound' }), entry('files', 2000), entry('shell', 3000)],
    counts: { files: 1, shell: 1 },
  };
  const draw = (options: Record<string, unknown>) => drawMap(board, 4000, setupFrom(options));

  const own = draw({
    theme: 'dark',
    colors: ['accent=#FF9900', 'background = #123', 'route=#00ff88'],
  });
  expect(own).toContain('#ff9900');
  expect(own).not.toContain('#e1ac6e');
  expect(own).toContain('<rect width="460" height="430" rx="12" fill="#112233"/>');
  expect(own).toContain('stroke="#00ff88"');
  // The rest of the palette is as it was.
  expect(own).toContain('#ebe6dc');

  // Written as one line with commas, as `claude plugin configure` takes lists.
  expect(setupFrom({ colors: 'accent=#ff9900, text=#ffffff' }).colors).toEqual({
    accent: '#ff9900',
    bone: '#ffffff',
  });

  // Anything that is not a hex color, and any unknown name, counts as not set.
  const hostile = [
    'accent="/><script>alert(1)</script>',
    'accent=red',
    'accent=#12345',
    'accent=#1234567',
    'accent=url(#x)',
    'accent=#ff9900"',
    'nonsense=#ffffff',
    '=#ffffff',
    'accent',
    'text=rgb(1,2,3)',
  ];
  expect(setupFrom({ colors: hostile }).colors).toEqual({});
  expect(draw({ theme: 'dark', colors: hostile })).toBe(draw({ theme: 'dark' }));
  expect(draw({ theme: 'dark', colors: 12 })).toBe(draw({ theme: 'dark' }));

  // Left on `auto`, a color of your own holds on a light surface too; the rest is still repainted.
  const auto = draw({ colors: ['accent=#ff9900'] });
  expect(auto).not.toContain('[fill="#ff9900"]');
  expect(auto).not.toContain('[fill="#e1ac6e"]');
  expect(auto).toContain('[fill="#0a0c11"]{fill:#f5f2ea}');
  // A color that takes the value of another place keeps that place from being repainted with it.
  expect(draw({ colors: ['accent=#ebe6dc'] })).not.toContain('[fill="#ebe6dc"]');

  // Every place of the palette has a name, and no two names share a place.
  expect(new Set(Object.values(COLOR_NAMES)).size).toBe(13);
  // The setting does not leak into the next drawing.
  expect(draw({ theme: 'dark' })).toContain('#e1ac6e');
});

const NOTICE = (id: string, status: string): string =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/secret-place/${id}.output</output-file>\n<status>${status}</status>\n<summary>Background command "private words" ${status}</summary>\n</task-notification>`;

test('a background task is read from the answer that started it, and its notification for the id and the ending alone', () => {
  expect(taskOf({ stdout: '', backgroundTaskId: 'bqf7movxe' })).toBe('bqf7movxe');
  expect(taskOf({ status: 'async_launched', agentId: 'a1', description: 'x' })).toBe('a1');
  expect(taskOf({ status: 'async_launched', taskId: 'w1' })).toBe('w1');
  expect(taskOf({ taskId: 'm1', timeoutMs: 300000 })).toBe('m1');
  expect(taskOf({ stdout: 'done' })).toBeUndefined();
  expect(taskOf({ taskId: 'x', status: 'completed' })).toBeUndefined();
  expect(taskOf({ backgroundTaskId: 'a b <c>' })).toBeUndefined();
  expect(taskOf(undefined)).toBeUndefined();

  expect(taskNotice(NOTICE('b1', 'completed'))).toEqual({ id: 'b1', status: 'ok' });
  expect(taskNotice(NOTICE('b1', 'killed'))).toEqual({ id: 'b1', status: 'ok' });
  expect(taskNotice(NOTICE('b1', 'failed'))).toEqual({ id: 'b1', status: 'err' });
  expect(
    taskNotice(
      '<task-notification>\n<task-id>m1</task-id>\n<summary>line</summary>\n</task-notification>'
    )
  ).toEqual({ id: 'm1' });
  expect(taskNotice('please read <task-notification><task-id>b1</task-id>')).toBeUndefined();
  expect(taskNotice('привет')).toBeUndefined();
});

test(
  'a command sent to the background stays on the map until its task reports back',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on('turn.complete', () => ({ text: '' }));
    on('turn.start', (_, e) => ({ turnId: e.turnId }) as never);
    on(
      'tool.call',
      () =>
        ({
          result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
        }) as never
    );

    await $.tool.call({
      tool: 'Bash',
      command: 'sleep 600',
      description: 'Ждать сборку',
      run_in_background: true,
    });
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    } as never);

    const seen = async (): Promise<{ running: boolean; text: string }> => {
      const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
      const running =
        (await ui.find({ type: 'Text', text: /Ждать сборку/ })) !== undefined &&
        (await ui.find({ type: 'Text', text: /идёт/ })) !== undefined;
      const source = String((await ui.find({ type: 'Svg' }))?.props.source);
      await ui.unmount();

      return { running, text: source };
    };

    // The turn is over and the command is not.
    expect((await seen()).running).toBe(true);

    // Another task's notification leaves it alone.
    await $.turn.start({ text: NOTICE('other', 'completed'), turnId: 't2' } as never);
    expect((await seen()).running).toBe(true);

    await $.turn.start({ text: NOTICE('b1', 'completed'), turnId: 't3' } as never);
    const after = await seen();
    expect(after.running).toBe(false);
    // Nothing of the notification but the fact gets onto the map, and it is not read as the person's message.
    expect(after.text).not.toContain('private words');
    expect(after.text).not.toContain('secret-place');
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    expect(await ui.find({ type: 'Text', text: /новое сообщение/ })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: /private words/ })).toBeUndefined();
    await ui.unmount();
  }
);

test(
  'a background task that failed leaves a fault on its station',
  { options: OWN },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on('turn.start', (_, e) => ({ turnId: e.turnId }) as never);
    on(
      'tool.call',
      () =>
        ({
          result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b2' },
        }) as never
    );
    await $.tool.call({
      tool: 'Bash',
      command: 'make',
      description: 'Сборка',
      run_in_background: true,
    });
    await $.turn.start({ text: NOTICE('b2', 'failed'), turnId: 't2' } as never);
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    const source = String((await ui.find({ type: 'Svg' }))?.props.source);
    await ui.unmount();
    expect(source.split('font-weight="700"').length - 1).toBe(1);
  }
);

// ---- what mutation testing found unguarded -------------------------------------------------------

test('each built-in tool has a station and a label of its own', () => {
  const seen = (tool: string, input: Record<string, unknown> = {}) =>
    classify(tool, input, STRANGER);
  expect(seen('Write', { file_path: '/a/b/c.md' })).toEqual({ station: 'files', label: 'b/c.md' });
  expect(seen('NotebookEdit', { notebook_path: '/a/b/n.ipynb' })).toEqual({
    station: 'files',
    label: 'b/n.ipynb',
  });
  expect(seen('Read')).toEqual({ station: 'files', label: 'Read' });
  expect(seen('Read', { file_path: '/x/a/b/' }).label).toBe('a/b');
  expect(seen('WebSearch', { query: 'x' })).toEqual({ station: 'web', label: 'web search' });
  expect(seen('Artifact')).toEqual({ station: 'web', label: 'artifact' });
  expect(seen('Agent')).toEqual({ station: 'agents', label: 'subagent' });
  expect(seen('Agent', { description: 'Find it' })).toEqual({
    station: 'agents',
    label: 'Find it',
  });
  expect(seen('Monitor')).toEqual({ station: 'shell', label: 'Monitor' });
  expect(seen('Monitor', { description: 'Watch' })).toEqual({ station: 'shell', label: 'Watch' });
  expect(seen('Workflow')).toEqual({ station: 'agents', label: 'workflow' });
  expect(seen('SendMessage')).toEqual({ station: 'agents', label: 'SendMessage' });
  expect(seen('TaskStop')).toEqual({ station: 'agents', label: 'TaskStop' });
  expect(seen('Skill')).toEqual({ station: 'skills', label: 'skill' });
  expect(seen('Skill', { skill: 'pdf' })).toEqual({ station: 'skills', label: 'pdf' });
  expect(seen('ToolSearch')).toEqual({ station: 'skills', label: 'loading tools' });
  expect(seen('AskUserQuestion')).toEqual({ station: 'you', label: 'question for you' });
  expect(seen('SendUserFile')).toEqual({ station: 'you', label: 'file for you' });
  expect(seen('SomethingNew')).toEqual({ station: 'shell', label: 'SomethingNew' });
});

test('an MCP tool lands by the server it belongs to, its name read with spaces', () => {
  const seen = (tool: string, input: Record<string, unknown> = {}) =>
    classify(tool, input, STRANGER);
  expect(seen('mcp__terminal__run_in_terminal')).toEqual({
    station: 'shell',
    label: 'run in terminal',
  });
  expect(seen('mcp__visualize__show_widget')).toEqual({ station: 'you', label: 'show widget' });
  expect(seen('mcp__ccd_session__mark_chapter')).toEqual({ station: 'you', label: 'mark chapter' });
  expect(seen('mcp__plugin-authoring__read_guide')).toEqual({
    station: 'skills',
    label: 'read guide',
  });
  expect(seen('mcp__claude-in-chrome__read_page')).toEqual({
    station: 'browser',
    label: 'read page',
  });
  expect(seen('mcp__claude-in-chrome__navigate', { url: 'https://a.b/c' }).label).toBe('a.b');
  // An address without a scheme is not read for a host: the tool's name stands.
  expect(seen('mcp__Claude_Browser__navigate', { url: 'a.b/c' }).label).toBe('navigate');
  expect(seen('mcp__Claude_Browser__navigate', { url: '/path/x:1' }).label).toBe('navigate');
  expect(seen('mcp__github__list_open_issues')).toEqual({
    station: 'web',
    label: 'github: list open issues',
  });
  // Only a name that begins as an MCP tool's does is read as one.
  expect(seen('xmcp__github__list')).toEqual({ station: 'shell', label: 'xmcp__github__list' });
});

test('a shell line is read word by word: assignments, quotes, runners and empty pieces', () => {
  const at = (command: string) => classify('Bash', { command }, SETUP).station;
  const label = (command: string, description = '') =>
    classify('Bash', { command, description }, SETUP).label;
  expect(at('TOKEN=1 curl -s https://a.b')).toBe('web');
  // A quote left open keeps the rest of the line one word, whichever quote it is.
  expect(at('"git push')).toBe('shell');
  expect(at("'git push")).toBe('shell');
  expect(at('cat a;')).toBe('files');
  // Only words that say nothing either way: not a file command.
  expect(at('echo hi')).toBe('shell');
  expect(at('cat a; make')).toBe('shell');
  // A file command is not a memory command because the file it reads is named like one.
  expect(at('cat recall.txt')).toBe('files');
  expect(at('recallable-x --now')).toBe('shell');
  expect(label('')).toBe('shell');
  expect(label('git status', '   ')).toBe('git');
  expect(label('git status', '  Show status ')).toBe('Show status');
  expect(label('TOOL.exeX arg')).toBe('TOOL.exeX');
  expect(label('python3 ~/scripts/recall-sync.py --apply')).toBe('recall-sync');
  expect(label('python3 recall.sync.py')).toBe('recall.sync');
  expect(label('recall-sync.py --apply')).toBe('recall-sync');

  const ps = (command: string) => classify('PowerShell', { command }, SETUP).station;
  expect(ps('. "C:\\Program Files\\Git\\cmd\\git.exe" push origin main')).toBe('web');
  expect(ps('$t =; Get-Content notes.txt')).toBe('files');
  expect(ps('Test-Connection host')).toBe('web');
  expect(ps('Start-BitsTransfer https://a.b/x')).toBe('web');
});

test('a host is cut to length and a login with letters after the colon is never a port', () => {
  const label = (url: string) => classify('WebFetch', { url }, SETUP).label;
  expect(label(`https://${'h'.repeat(60)}.com/x`)).toBe('h'.repeat(40));
  expect(label('https://user:1a/x@host.com')).toBe('host.com');
});

test('options are trimmed, and anything but the known values falls back', () => {
  const setup = setupFrom({
    memoryCommands: ' a , ,b ',
    memoryLabels: [' k = v '],
    coreName: 7,
    background: 'clear',
    layout: 'sideways',
  });
  expect(setup.memoryCommands).toEqual(['a', 'b']);
  expect(setup.memoryLabels.get('k')).toBe('v');
  expect(setup.core).toBe('CLAUDE');
  expect(setup.background).toBe('solid');
  expect(setup.layout).toBe('you-top');
  expect(setupFrom({ coreName: '  ABCDEFGHIJKLMNOP ' }).core).toBe('ABCDEFGHIJ');
});

test('labels, lines, durations and model names are cut and rounded at their edges', () => {
  expect(clean('  a  ')).toBe('a');
  expect(clean('x'.repeat(120))).toBe('x'.repeat(120));
  expect(clean('x'.repeat(121))).toBe(`${'x'.repeat(119)}…`);

  expect(firstLine('  a  \nb')).toBe('a');
  expect(firstLine('   \nreal')).toBe('real');
  expect(firstLine(' \n ')).toBe('');
  expect(firstLine('x'.repeat(72))).toBe('x'.repeat(72));
  expect(firstLine('x'.repeat(73))).toBe(`${'x'.repeat(71)}…`);

  const en = stringsFor('en');
  expect(formatMs(0.2, en)).toBe('1 ms');
  expect(formatMs(999, en)).toBe('999 ms');
  expect(formatMs(1000, en)).toBe('1.0 s');
  expect(formatMs(59_999, en)).toBe('60.0 s');
  expect(formatMs(60_000, en)).toBe('1 min 0 s');
  expect(formatMs(125_000, en)).toBe('2 min 5 s');

  expect(shortModel('some-other-model')).toBe('some-other-model');
  expect(shortModel('claude-opus-5')).toBe('opus 5');
  expect(shortModel('claude-opus-12-10')).toBe('opus 12.10');
});

test('a task id or a notification that is not quite one is not read', () => {
  expect(taskOf({ backgroundTaskId: 'bad id' })).toBeUndefined();
  expect(taskNotice(`  \n${NOTICE('b1', 'completed')}`)).toEqual({ id: 'b1', status: 'ok' });
  expect(taskNotice('<task-notification>\n<summary>no id</summary>')).toBeUndefined();
});

test('rows fold only when they also start from the same place', () => {
  const rows = foldRows([entry('shell', 1), entry('shell', 20, { from: 'agents' })]);
  expect(rows.map((row) => row.times)).toEqual([1, 1]);
});

test('the line under the map names what runs now, how many more, and the context', () => {
  const en = stringsFor('en');
  const running = (station: Entry['station'], at: number, label: string): Entry =>
    entry(station, at, { status: 'run', endedAt: undefined, label });
  expect(describeNow({ entries: [], counts: {} }, en)).toBe('Nothing is running.');
  expect(describeNow({ entries: [entry('files', 1)], counts: {} }, en)).toBe('Nothing is running.');
  expect(describeNow({ entries: [], counts: {}, context: 37.4 }, en)).toBe(
    'Nothing is running. · context 37%'
  );
  expect(describeNow({ entries: [running('files', 1, 'a.py')], counts: {} }, en)).toBe(
    'Files: a.py'
  );
  expect(
    describeNow(
      {
        entries: [running('files', 1, 'a.py'), entry('web', 2), running('shell', 3, 'Build')],
        counts: {},
        context: 80,
      },
      en
    )
  ).toBe('Shell: Build and 1 more · context 80%');
});

test('every language puts what it is given into its sentences', () => {
  for (const language of LANGUAGES) {
    const t = stringsFor(language);
    expect(t.cannotOpen('REASON')).toContain('REASON');
    expect(t.step(7)).toContain('7');
    expect(t.addedContext('WHEN')).toContain('WHEN');
    expect(t.addedMemory('WHEN')).toContain('WHEN');
    expect(t.records(3, '#1 #2 #3')).toContain('3');
    expect(t.records(3, '#1 #2 #3')).toContain('#1 #2 #3');
    expect(t.stopped('TOOL')).toContain('TOOL');
    expect(t.askedPermission('TOOL')).toContain('TOOL');
    expect(t.checkBefore('TOOL')).toContain('TOOL');
    expect(t.andMore(4)).toContain('4');
    expect(t.ms(250)).toContain('250');
    expect(t.seconds('1.5')).toMatch(/1[.,]5/);
    expect(t.minutes(2, 5)).toMatch(/2.*5/);
  }
});

test('one record and several are worded apart, and seconds take the comma where it is written', () => {
  const records = (language: string, n: number) => stringsFor(language).records(n, 'x');
  expect([records('en', 1), records('en', 2)]).toEqual(['1 record: x', '2 records: x']);
  expect([records('es', 1), records('es', 2)]).toEqual(['1 registro: x', '2 registros: x']);
  expect([records('fr', 0), records('fr', 1), records('fr', 2)]).toEqual([
    '0 enregistrement : x',
    '1 enregistrement : x',
    '2 enregistrements : x',
  ]);
  expect([records('de', 1), records('de', 2)]).toEqual(['1 Eintrag: x', '2 Einträge: x']);
  expect([records('it', 1), records('it', 2)]).toEqual(['1 voce: x', '2 voci: x']);
  expect(stringsFor('en').seconds('1.5')).toBe('1.5 s');
  expect(stringsFor('es').seconds('1.5')).toBe('1.5 s');
  expect(stringsFor('fr').seconds('1.5')).toBe('1,5 s');
  expect(stringsFor('it').seconds('1.5')).toBe('1,5 s');
  expect(stringsFor('en').minutes(2, 5)).toBe('2 min 5 s');
});

// ---- the drawing, state by state ------------------------------------------------------------------

const DARK_SETUP = setupFrom({ theme: 'dark' });
const count = (svg: string, part: string): number => svg.split(part).length - 1;

test('a fault lights its station red for a while, then the red is gone', () => {
  const now = 1_000_000;
  const failed = entry('shell', now - 2000, { status: 'err' });
  const lit = drawMap({ entries: [failed], counts: { shell: 1 } }, now, DARK_SETUP);
  expect(lit).toContain('fill="#e8654f" opacity="0"');
  expect(lit).toContain('dur="6.000s"');
  const later = drawMap({ entries: [failed], counts: { shell: 1 } }, now + 6000, DARK_SETUP);
  expect(later).not.toContain('#e8654f');
  // A call that went well glows in the accent, and for a shorter time.
  const fine = drawMap({ entries: [entry('shell', now - 2000)], counts: {} }, now, DARK_SETUP);
  expect(fine).toContain('fill="#e1ac6e" opacity="0"');
  expect(fine).toContain('dur="3.200s"');
  expect(fine).not.toContain('#e8654f');
});

test('the context ring changes color at seventy and at ninety, and stays within the ring', () => {
  const ring = (context: number) =>
    /stroke="(#[0-9a-f]{6})" pathLength="100" stroke-dasharray="(\d+) 100"/
      .exec(drawMap({ entries: [], counts: {}, context }, 1000, DARK_SETUP))
      ?.slice(1);
  expect(ring(69)).toEqual(['#9ba1ab', '69']);
  expect(ring(70)).toEqual(['#e1ac6e', '70']);
  expect(ring(89)).toEqual(['#e1ac6e', '89']);
  expect(ring(90)).toEqual(['#e8654f', '90']);
  expect(ring(150)).toEqual(['#e8654f', '100']);
  expect(ring(-5)).toEqual(['#9ba1ab', '0']);
});

test('counts on the map have their limits: faults past 99, a crew of six', () => {
  const draw = (board: Board) => drawMap(board, 1000, DARK_SETUP);
  expect(draw({ entries: [], counts: {}, faults: { shell: 99 } })).toContain('>99<');
  expect(draw({ entries: [], counts: {}, faults: { shell: 100 } })).toContain('>99+<');
  expect(draw({ entries: [], counts: { files: 3 } })).toContain('>3</text>');
  const crew = draw({ entries: [], counts: {}, agents: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  expect(count(crew, '<animateTransform')).toBe(6);
});

test('the core breathes slowly at rest and faster while something runs', () => {
  const now = 1_000_000;
  const idle = drawMap({ entries: [], counts: {} }, now, DARK_SETUP);
  expect(idle).toContain('dur="4.800s" repeatCount="indefinite"');
  expect(idle).not.toContain('dur="1.600s"');
  const busy = drawMap(
    { entries: [entry('shell', now - 5000, { status: 'run', endedAt: undefined })], counts: {} },
    now,
    DARK_SETUP
  );
  expect(busy).toContain('dur="1.600s" repeatCount="indefinite"');
  expect(busy).not.toContain('dur="4.800s"');
});

test('a call flies out as a pulse with a tail, comes back plain, and a signal comes in hollow', () => {
  const now = 1_000_000;
  const draw = (...entries: Entry[]) => drawMap({ entries, counts: {} }, now, DARK_SETUP);

  // Out: three circles on one path, and a beam that is not dashed.
  const out = draw(entry('files', now - 100, { status: 'run', endedAt: undefined }));
  expect(count(out, '<animateMotion')).toBe(3);
  expect(out).not.toContain('stroke-dasharray="3 4"');

  // Back: a call that started long ago and has just ended flies home in grey, or in red when it failed.
  const back = draw(entry('files', now - 60_000, { endedAt: now - 100 }));
  expect(count(back, '<animateMotion')).toBe(3);
  expect(back).toContain('fill="#9ba1ab" opacity="0"><animateMotion');
  const failed = draw(entry('files', now - 60_000, { endedAt: now - 100, status: 'err' }));
  expect(failed).toContain('fill="#e8654f" opacity="0"><animateMotion');

  // In: one hollow circle and a dashed beam; it never flies back.
  const inbound = draw(entry('you', now - 100, { from: 'inbound' }));
  expect(count(inbound, '<animateMotion')).toBe(1);
  expect(inbound).toContain('fill="none" stroke="#f0c595" stroke-width="1.4" opacity="0">');
  expect(inbound).toContain('stroke-dasharray="3 4"');

  // Long after, nothing flies.
  expect(
    count(
      drawMap({ entries: [entry('files', now - 60_000)], counts: {} }, now, DARK_SETUP),
      '<animateMotion'
    )
  ).toBe(0);
});

test('two calls at once on one spoke fly side by side, not on top of each other', () => {
  const now = 1_000_000;
  const running = (id: string): Entry =>
    entry('files', now - 100, { id, status: 'run', endedAt: undefined });
  const svg = drawMap({ entries: [running('a'), running('b')], counts: {} }, now, DARK_SETUP);
  const paths = new Set([...svg.matchAll(/<animateMotion path="([^"]+)"/g)].map((m) => m[1]));
  expect(paths.size).toBe(2);
});

test('the answer leaves the core as a ring, for a moment', () => {
  const now = 1_000_000;
  const done = entry('you', now - 500, { mark: 'done' });
  expect(drawMap({ entries: [done], counts: {} }, now, DARK_SETUP)).toContain('values="40;78"');
  expect(drawMap({ entries: [done], counts: {} }, now + 1000, DARK_SETUP)).not.toContain(
    'values="40;78"'
  );
  expect(
    drawMap({ entries: [entry('you', now - 500)], counts: {} }, now, DARK_SETUP)
  ).not.toContain('values="40;78"');
});

// ---- the hooks, one by one ------------------------------------------------------------------------

const rowsOf = async (ui: { findAll: (query: { type: string }) => Promise<unknown> }) =>
  (await ui.findAll({ type: 'Text' })) as { text: string; props: Record<string, unknown> }[];

test('a row says how its call went: its mark, its color and how long it took', async ($, on) => {
  let now = 1_000_000;
  on('clock.now', () => ({ value: now }));
  on('tool.call', (_, e) => {
    const call = e as unknown as { tool: string; file_path?: string };

    if (call.file_path !== '/a/b/fast.py') {
      now += 1500;
    }

    return (call.tool === 'Bash' ? { result: {}, isError: true } : { result: {} }) as never;
  });
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never;

    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
  });

  await $.tool.call({ tool: 'Read', file_path: '/a/b/slow.py' });
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build' });
  await $.tool.call({ tool: 'Read', file_path: '/a/b/fast.py' });
  const hanging = $.turn.step(STEP)[Symbol.asyncIterator]();
  await hanging.next();

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const rows = await rowsOf(ui);
  const row = (part: string) => rows.find((r) => r.text.includes(part));
  expect(row('slow.py')?.text).toBe('· Files    b/slow.py  1.5 s');
  expect(row('slow.py')?.props.dimColor).toBe(true);
  expect(row('slow.py')?.props.color).toBeUndefined();
  expect(row('fast.py')?.text).toBe('· Files    b/fast.py');
  expect(row('Build')?.text).toBe('✕ Shell    Build  1.5 s');
  expect(row('Build')?.props.color).toBe('error');
  expect(row('Build')?.props.dimColor).toBe(false);
  expect(row('●')?.text).toBe('● Model    opus 5.5 · step 1  running');
  expect(row('●')?.props.color).toBe('claude');
  expect(row('●')?.props.dimColor).toBe(false);
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Work map. Model: opus 5.5 · step 1');
  await ui.unmount();
});

test('in a terminal the pane is words only: what runs, the counts, the rows', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('tool.call', () => ({ result: {} }));

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect((await rowsOf(ui)).map((r) => r.text)).toEqual([
    'Nothing is running.',
    'No counts yet.',
    'Nothing yet.',
  ]);
  await ui.unmount();

  await $.tool.call({ tool: 'Read', file_path: '/a/b/one.py' });
  await $.tool.call({ tool: 'Read', file_path: '/a/b/two.py' });
  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Status' });

  ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const tally = (await rowsOf(ui)).find((r) => r.text.includes(' · '));
  expect(tally?.text).toBe('Files 2 · Shell 1');
  expect(tally?.props.dimColor).toBe(true);
  expect(await ui.find({ type: 'Svg' })).toBeUndefined();
  await ui.unmount();

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect((await desktop.find({ type: 'Svg' }))?.props.alt).toBe('Work map. Nothing is running.');
  expect((await rowsOf(desktop)).some((r) => r.text === 'Files 2 · Shell 1')).toBe(false);
  await desktop.unmount();
});

test('a model change is marked in the feed and adds nothing to the count', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never;

    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
  });

  for (const model of ['claude-opus-5-5', 'claude-fable-5-2']) {
    for await (const _ of $.turn.step(stepOn(model))) {
      void _;
    }
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const rows = await rowsOf(ui);
  const change = rows.find((r) => r.text.includes('→'));
  expect(change?.text).toBe('◆ Model    opus 5.5 → fable 5.2');
  expect(change?.props.color).toBe('claude');
  expect(change?.props.dimColor).toBe(false);
  expect(rows.some((r) => r.text === 'Model 2')).toBe(true);
  expect(rows.some((r) => r.text === '· Model    fable 5.2 · step 1')).toBe(true);
  await ui.unmount();
});

test('a typed slash command shows as a skill, and a skill the model called is not counted twice', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('skill.prompt', (_, e) => ({ text: e.text }) as never);
  on('tool.call', async (_, e) => {
    // The model's own call of a skill raises the same event while its tool call still runs.
    if ((e as unknown as { tool: string }).tool === 'Skill') {
      await $.skill.prompt({ skill: 'pdf', text: 'x' } as never);
    }

    return { result: {} };
  });

  await $.skill.prompt({ skill: 'review', text: 'x' } as never);
  await $.tool.call({ tool: 'Skill', skill: 'pdf' } as never);

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const rows = (await rowsOf(ui)).map((r) => r.text);
  expect(rows).toContain('Skills 2');
  // Two rows of one station fold into one: the typed command and the model's call, and no third.
  expect(rows).toContain('· Skills   pdf  +1');
  await ui.unmount();
});

test('a notification that arrives inside a running turn settles its task, and nothing else does', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('prompt.submit', (_, e) => ({ text: e.text }) as never);
  on('tool.call', () => ({ result: { backgroundTaskId: 'b1' } }) as never);
  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Wait for build' });

  const running = async (): Promise<boolean> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    const rows = await rowsOf(ui);
    await ui.unmount();

    return rows.some((r) => r.text.includes('Wait for build') && r.text.includes('running'));
  };

  await $.prompt.submit({ text: NOTICE('b1', 'completed') } as never);
  await $.prompt.submit({ text: NOTICE('b1', 'completed'), origin: { kind: 'user' } } as never);
  await $.prompt.submit({
    text: NOTICE('other', 'completed'),
    origin: { kind: 'task-notification' },
  } as never);
  await $.prompt.submit({ text: 'hello', origin: { kind: 'task-notification' } } as never);
  expect(await running()).toBe(true);

  await $.prompt.submit({
    text: NOTICE('b1', 'completed'),
    origin: { kind: 'task-notification' },
  } as never);
  expect(await running()).toBe(false);
});

test('a compaction shows on the model station and refreshes the context', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('session.compact', (_, e) => ({ messages: e.messages }) as never);
  on(
    'session.usage',
    () => ({ value: { startedAt: 0, context: { window: 200000, percent: 12 } } }) as never
  );

  await $.session.compact({ messages: [{ role: 'user', text: 'kept', toolUses: [] }] } as never);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const rows = (await rowsOf(ui)).map((r) => r.text);
  expect(rows).toContain('· Model    compacting context');
  expect(rows).toContain('Nothing is running. · context 12%');
  expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('>12%<');
  await ui.unmount();
});

test('the command opens the pane and says so, or says why it could not', async ($, on) => {
  const asked: unknown[] = [];
  let answer: Record<string, unknown> = { isPlaced: true };
  on('ui.open', (_, e) => {
    asked.push(e);

    return { value: answer } as never;
  });

  expect((await $.command.run({ command: 'lot-map' } as never)).text).toBe('Work map opened.');
  expect(JSON.stringify(asked)).toContain('"id":"lot-map"');
  expect(JSON.stringify(asked)).toContain('"title":"Work map"');

  answer = { isPlaced: false, reason: 'too narrow' };
  expect((await $.command.run({ command: 'lot-map' } as never)).text).toBe(
    'Nowhere to show the map right now: too narrow'
  );
});

test('a session registers the command, opens the pane and remembers the model of the last one', async ($, on) => {
  const seen: Record<string, unknown[]> = { register: [], open: [], get: [], set: [] };
  on('clock.now', () => ({ value: 1_000_000 }));
  on('command.register', (_, e) => {
    seen.register?.push(e);

    return { value: { command: 'lot-map' } } as never;
  });
  on('ui.open', (_, e) => {
    seen.open?.push(e);

    return { value: { isPlaced: true } } as never;
  });
  on('store.get', (_, e) => {
    seen.get?.push(e);

    return { value: 'claude-opus-5-5' } as never;
  });
  on('store.set', (_, e) => {
    seen.set?.push(e);

    return { value: undefined } as never;
  });
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never;

    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
  });

  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true });
  expect(JSON.stringify(seen.register)).toContain('"name":"lot-map"');
  expect(JSON.stringify(seen.register)).toContain('Open the work map beside the chat');
  expect(JSON.stringify(seen.open)).toContain('"id":"lot-map"');
  expect(JSON.stringify(seen.open)).toContain('"title":"Work map"');
  expect(JSON.stringify(seen.get)).toContain('model:/work');

  for await (const _ of $.turn.step(stepOn('claude-fable-5-2'))) {
    void _;
  }

  expect(JSON.stringify(seen.set)).toContain('model:/work');
  expect(JSON.stringify(seen.set)).toContain('claude-fable-5-2');

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect((await rowsOf(ui)).map((r) => r.text)).toContain('◆ Model    opus 5.5 → fable 5.2');
  await ui.unmount();
});

test('a stored model that is no name is not taken for one', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('store.get', () => ({ value: 7 }) as never);
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never;

    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
  });

  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true });

  for await (const _ of $.turn.step(stepOn('claude-fable-5-2'))) {
    void _;
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect((await rowsOf(ui)).some((r) => r.text.includes('→'))).toBe(false);
  await ui.unmount();
});

for (const [name, wait, decided, expected] of [
  ['a hook that asks', 0, { ask: 'sure?' }, '· Hooks    asked permission: Bash'],
  ['a check that took a moment', 400, {}, '· Hooks    check before Bash  400 ms'],
  ['an instant check', 399, {}, undefined],
] as const) {
  test(`${name} ${expected === undefined ? 'leaves no row' : 'leaves a row'}`, async ($, on) => {
    let now = 1_000_000;
    on('clock.now', () => ({ value: now }));
    on('classic.PreToolUse', () => {
      now += wait;

      return decided as never;
    });
    on('tool.call', () => ({ result: {} }));

    await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Status' });

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    const hooks = (await rowsOf(ui)).map((r) => r.text).filter((text) => text.includes('Hooks  '));
    expect(hooks).toEqual(expected === undefined ? [] : [expected]);
    await ui.unmount();
  });
}

test('a tool call that fails outright is passed on as it failed and reads as an error', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));

  // Nothing answers the call, so it fails beneath the map.
  let caught = '';

  try {
    await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build' });
  } catch (failure) {
    caught = String(failure);
  }

  expect(caught).toContain('tool.call');

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const row = (await rowsOf(ui)).find((r) => r.text.includes('Build'));
  expect(row?.text).toBe('✕ Shell    Build');
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('font-weight="700"');
  await ui.unmount();
});

test('the board keeps its newest eighty rows, and a background task however old', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on(
    'tool.call',
    (_, e) =>
      ((e as unknown as { tool: string }).tool === 'Bash'
        ? { result: { backgroundTaskId: 'b1' } }
        : { result: {} }) as never
  );

  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Wait for build' });

  for (let i = 0; i < 85; i++) {
    await $.tool.call({ tool: 'Read', file_path: `/a/b/f${i}.py` });
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const rows = (await rowsOf(ui)).map((r) => r.text);
  expect(rows).toContain('· Files    b/f84.py  +79');
  expect(rows).toContain('● Shell    Wait for build  running');
  // The counts go on past what the board keeps.
  expect(rows).toContain('Files 85 · Shell 1');
  await ui.unmount();
});

test(
  'what a hook brings to memory is counted apart, and its numbers trail off after six',
  { options: { hookRecords: true } },
  async ($, on) => {
    let context = ['[#1 a] [#2 a] [#3 a] [#4 a] [#5 a] [#6 a]'];
    on('clock.now', () => ({ value: 1_000_000 }));
    on('classic.UserPromptSubmit', () => ({ additionalContext: context }));
    on('classic.SessionStart', () => ({ additionalContext: ['plain words'] }) as never);

    const rows = async (): Promise<string[]> => {
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
      const texts = (await rowsOf(ui)).map((r) => r.text);
      await ui.unmount();

      return texts;
    };

    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never);
    expect(await rows()).toContain('· Memory   6 records: #1 #2 #3 #4 #5 #6');
    expect(await rows()).toContain('· Hooks    added memory to the message');

    context = ['[#1 a] [#2 a] [#3 a] [#4 a] [#5 a] [#6 a] [#7 a]'];
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never);
    expect(await rows()).toContain('· Memory   7 records: #1 #2 #3 #4 #5 #6 …');

    await $.classic.SessionStart({} as never);
    expect(await rows()).toContain('· Hooks    added context at session start');
    expect(await rows()).toContain('Memory 2 · Hooks 3');

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('>↓2</tspan>');
    await ui.unmount();

    // Nothing added, or only blank lines: no row.
    context = [' ', '\n'];
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never);
    context = [];
    await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never);
    expect(await rows()).toContain('Memory 2 · Hooks 3');
  }
);

test('only a message of the person starts a row of theirs', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never);

  const rows = async (): Promise<string[]> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    const texts = (await rowsOf(ui)).map((r) => r.text);
    await ui.unmount();

    return texts;
  };

  await $.turn.start({ text: '', turnId: 't1' } as never);
  await $.turn.start({ text: 'for a subagent', turnId: 't2', agentId: 'a1' } as never);
  expect(await rows()).toContain('Nothing yet.');

  await $.turn.start({ text: 'hello', turnId: 't3' } as never);
  expect(await rows()).toContain('· You      new message');
  expect(await rows()).toContain('You 1');
});

test('the end of a loop settles its own calls and leaves the others running', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.complete', () => ({ text: '' }));
  // Every call starts a background task, so its row stays open until something settles it.
  on(
    'tool.call',
    (_, e) =>
      ({
        result: { backgroundTaskId: (e as unknown as { description: string }).description },
      }) as never
  );

  const start = (task: string, agentId?: string) =>
    $.tool.call({ tool: 'Bash', command: 'sleep 600', description: task, agentId } as never);

  const running = async (): Promise<string[]> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    const texts = (await rowsOf(ui)).map((r) => r.text).filter((text) => text.endsWith('running'));
    await ui.unmount();

    return texts;
  };

  const complete = (agentId?: string) =>
    $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: false,
      turnId: 't',
      reason: 'answer',
      agentId,
    } as never);

  await start('first', 'a1');
  await start('second', 'a2');
  await start('third');
  expect((await running()).length).toBe(3);

  // One subagent ends: its call is settled, the other subagent's and the main loop's go on.
  await complete('a1');
  expect(await running()).toEqual(['● Shell    third  running', '● Shell    second  running']);

  // The main loop ends: a background task outlives it, and so does the subagent still at work.
  await complete();
  expect(await running()).toEqual(['● Shell    third  running', '● Shell    second  running']);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect((await rowsOf(ui)).map((r) => r.text)).toContain('· You      answer ready');
  expect(count(String((await ui.find({ type: 'Svg' }))?.props.source), '<animateTransform')).toBe(
    1
  );
  await ui.unmount();
});

// ---- second pass: faults, settling, and where things are drawn -------------------------------------

const DARK_OPTIONS = { options: { theme: 'dark' } } as const;
const FAULT_DOT = 'font-weight="700"';
/** A pulse flying out in red: only a refused call has one. An error flies out like any call and comes back red. */
const RED_FLIGHT = '<circle r="3.8" fill="#e8654f"';

test(
  'a call that went well is no fault, an error is one, a refusal is one for the tool and one for the hook',
  DARK_OPTIONS,
  async ($, on) => {
    let refuse = false;
    on('clock.now', () => ({ value: 1_000_000 }));
    on('classic.PreToolUse', () => (refuse ? { deny: 'no' } : {}) as never);
    on(
      'tool.call',
      (_, e) =>
        ((e as unknown as { command?: string }).command === 'make'
          ? { result: {}, isError: true }
          : { result: {} }) as never
    );

    const drawn = async (): Promise<string> => {
      const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
      const source = String((await ui.find({ type: 'Svg' }))?.props.source);
      await ui.unmount();

      return source;
    };

    await $.tool.call({ tool: 'Read', file_path: '/a/b/ok.py' });
    expect(count(await drawn(), FAULT_DOT)).toBe(0);

    await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build' });
    expect(count(await drawn(), FAULT_DOT)).toBe(1);
    expect(await drawn()).not.toContain(RED_FLIGHT);

    refuse = true;
    await $.tool.call({ tool: 'Read', file_path: '/a/b/no.py', tool_use_id: 'tu1' } as never);
    // Shell, files and hooks: one dot each.
    expect(count(await drawn(), FAULT_DOT)).toBe(3);
    expect(await drawn()).toContain(RED_FLIGHT);

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    const rows = (await rowsOf(ui)).map((r) => r.text);
    expect(rows).toContain('✕ Files    b/no.py');
    expect(rows).toContain('✕ Hooks    stopped Read');
    expect(rows).toContain('· Files    b/ok.py');
    await ui.unmount();
  }
);

test('a failed call is no background task, whatever its answer carries', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('tool.call', () => ({ result: { backgroundTaskId: 'b1' }, isError: true }) as never);

  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build' });

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect((await rowsOf(ui)).map((r) => r.text)).toContain('✕ Shell    Build');
  await ui.unmount();
});

test('a typed skill is left out only while that very skill is running as a tool call', async ($, on) => {
  let typed: string | undefined;
  on('clock.now', () => ({ value: 1_000_000 }));
  on('skill.prompt', (_, e) => ({ text: e.text }) as never);
  on('tool.call', async () => {
    if (typed !== undefined) {
      await $.skill.prompt({ skill: typed, text: 'x' } as never);
    }

    return { result: {} };
  });

  const tally = async (): Promise<string | undefined> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    const texts = (await rowsOf(ui)).map((r) => r.text);
    await ui.unmount();

    return texts[1];
  };

  // The skill's tool call is over: a typed command of the same name is a new use.
  await $.tool.call({ tool: 'Skill', skill: 'pdf' } as never);
  await $.skill.prompt({ skill: 'pdf', text: 'x' } as never);
  expect(await tally()).toBe('Skills 2');

  // Another skill typed while one runs is counted.
  typed = 'review';
  await $.tool.call({ tool: 'Skill', skill: 'pdf' } as never);
  expect(await tally()).toBe('Skills 4');

  // A running call elsewhere that happens to carry the skill's name does not hide it.
  typed = 'pdf';
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'pdf' });
  expect(await tally()).toBe('Shell 1 · Skills 5');
});

test('the end of a turn closes what the main loop left open, and nothing that had ended', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.complete', () => ({ text: '' }));
  on('tool.call', (_, e) => {
    const call = e as unknown as { description: string };

    return (
      call.description === 'Build'
        ? { result: {}, isError: true }
        : { result: { backgroundTaskId: 'b1' } }
    ) as never;
  });
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never;

    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
  });

  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build' });
  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Wait' });
  await $.turn.step(STEP)[Symbol.asyncIterator]().next();
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: true,
    turnId: 't1',
    reason: 'aborted',
  } as never);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const rows = (await rowsOf(ui)).map((r) => r.text);
  expect(rows).toContain('✕ You      turn interrupted');
  expect(rows).toContain('· Model    opus 5.5 · step 1');
  expect(rows).toContain('● Shell    Wait  running');
  expect(rows).toContain('✕ Shell    Build');
  // An interrupted turn sends no answer out.
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('values="40;78"');
  await ui.unmount();
});

test('the end of the main loop leaves a subagent at work, and an answer rings out', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.complete', () => ({ text: '' }));
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never;

    return { turnId: 't2', index: 0, answer: '', toolUses: [] } as never;
  });

  const step = $.turn.step({ ...stepOn('claude-haiku-5-5'), agentId: 'a1' } as never);
  await step[Symbol.asyncIterator]().next();
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  } as never);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const rows = (await rowsOf(ui)).map((r) => r.text);
  expect(rows).toContain('● Model    haiku 5.5 · step 1 · subagent  running');
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('values="40;78"');
  await ui.unmount();
});

test('a subagent launched to run on is settled when its loop ends, and only what was open', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.complete', () => ({ text: '' }));
  on('tool.call', (_, e) => {
    const call = e as unknown as { tool: string };

    return (
      call.tool === 'Agent'
        ? { result: { status: 'async_launched', agentId: 'a9' } }
        : { result: {}, isError: true }
    ) as never;
  });

  await $.tool.call({ tool: 'Agent', description: 'Research' } as never);
  await $.tool.call({
    tool: 'Bash',
    command: 'make',
    description: 'Build',
    agentId: 'a9',
  } as never);
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't9',
    reason: 'answer',
    agentId: 'a9',
  } as never);

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const rows = (await rowsOf(ui)).map((r) => r.text);
  expect(rows).toContain('· Agents   Research');
  // The subagent's failed call stays a failure.
  expect(rows).toContain('✕ Shell    Build');
  await ui.unmount();
});

test('a task report settles its own row and no other, and only when it says how the task ended', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never);
  on(
    'tool.call',
    (_, e) =>
      ((e as unknown as { tool: string }).tool === 'Bash'
        ? { result: { backgroundTaskId: 'b1' } }
        : { result: {} }) as never
  );

  const rows = async (): Promise<string[]> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    const texts = (await rowsOf(ui)).map((r) => r.text);
    await ui.unmount();

    return texts;
  };

  await $.tool.call({ tool: 'Read', file_path: '/a/b/ok.py' });
  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Wait' });

  // A monitor's event names the task and no ending: the task goes on.
  await $.turn.start({
    text: '<task-notification>\n<task-id>b1</task-id>\n<summary>line</summary>\n</task-notification>',
    turnId: 't2',
  } as never);
  // A report that reaches a subagent's turn is not the main loop's to read.
  await $.turn.start({ text: NOTICE('b1', 'failed'), turnId: 't3', agentId: 'a1' } as never);
  expect(await rows()).toContain('● Shell    Wait  running');

  await $.turn.start({ text: NOTICE('b1', 'failed'), turnId: 't4' } as never);
  expect(await rows()).toContain('✕ Shell    Wait');
  expect(await rows()).toContain('· Files    b/ok.py');
});

test('a new message clears the faults and keeps the rows', DARK_OPTIONS, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never);
  on('tool.call', () => ({ result: {}, isError: true }) as never);

  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build' });
  await $.turn.start({ text: 'next', turnId: 't2' } as never);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const rows = (await rowsOf(ui)).map((r) => r.text);
  expect(rows).toContain('✕ Shell    Build');
  expect(rows).toContain('· You      new message');
  expect(count(String((await ui.find({ type: 'Svg' }))?.props.source), FAULT_DOT)).toBe(0);
  await ui.unmount();
});

test(
  'a changed model rings on the map, and a context the engine cannot tell is not drawn',
  DARK_OPTIONS,
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    on(
      'session.usage',
      () => ({ value: { startedAt: 0, context: { percent: 'unknown' } } }) as never
    );
    on('turn.step', async function* () {
      yield { kind: 'text', index: 0, text: 'x' } as never;

      return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never;
    });

    const drawn = async (): Promise<string> => {
      const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
      const source = String((await ui.find({ type: 'Svg' }))?.props.source);
      await ui.unmount();

      return source;
    };

    for await (const _ of $.turn.step(stepOn('claude-opus-5-5'))) {
      void _;
    }

    expect(await drawn()).not.toContain('repeatCount="5" fill="freeze"');
    expect(await drawn()).not.toContain('pathLength="100"');

    for await (const _ of $.turn.step(stepOn('claude-fable-5-2'))) {
      void _;
    }

    expect(await drawn()).toContain('repeatCount="5" fill="freeze"');
  }
);

test('memory that was asked for is not counted as brought by a hook, and a hook that adds nothing leaves no row', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('tool.call', () => ({ result: {} }));
  on('classic.UserPromptSubmit', () => ({}) as never);

  await $.tool.call({ tool: 'mcp__memory__search_nodes' } as never);
  await $.tool.call({ tool: 'Read', file_path: '/a/b/ok.py' });
  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never);

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('↓');
  expect((await rowsOf(ui)).some((r) => r.text.includes('Hooks'))).toBe(false);
  await ui.unmount();
});

test('a background task that has ended is dropped with the other old rows', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never);
  on(
    'tool.call',
    (_, e) =>
      ((e as unknown as { tool: string }).tool === 'Bash'
        ? { result: { backgroundTaskId: 'b0' } }
        : { result: {} }) as never
  );

  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Old build' });
  await $.turn.start({ text: NOTICE('b0', 'completed'), turnId: 't2' } as never);

  for (let i = 0; i < 85; i++) {
    await $.tool.call({ tool: 'Read', file_path: `/a/b/f${i}.py` });
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  const rows = (await rowsOf(ui)).map((r) => r.text);
  expect(rows).toContain('· Files    b/f84.py  +79');
  expect(rows.some((text) => text.includes('Old build'))).toBe(false);
  await ui.unmount();
});

// ---- where things are drawn -----------------------------------------------------------------------

interface Spot {
  x: number;
  y: number;
}

const CORE_SPOT: Spot = { x: 230, y: 212 };
const NODE_RADIUS = 22;
const HUB_RADIUS = 48;
const NEAR = 0.2;
const far = (a: Spot, b: Spot): number => Math.hypot(a.x - b.x, a.y - b.y);
const spot = (x: string | undefined, y: string | undefined): Spot => ({
  x: Number(x),
  y: Number(y),
});
/** The station circles of a drawing, in the order of the ring. */
const stationsIn = (svg: string): Spot[] =>
  [
    ...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="22" fill="#12151c" stroke="#272c36"/g),
  ].map((m) => spot(m[1], m[2]));
const at = (spots: Spot[], i: number): Spot => spots[i] ?? { x: NaN, y: NaN };

test('the stations stand on a ring around the core, the person at the top and the network opposite', () => {
  const svg = drawMap({ entries: [], counts: {} }, 1000, DARK_SETUP);
  const stations = stationsIn(svg);
  expect(stations.length).toBe(10);
  expect(at(stations, 0)).toEqual({ x: 230, y: 48 });
  expect(at(stations, 5)).toEqual({ x: 230, y: 376 });

  for (const s of stations) {
    const onRing = ((s.x - CORE_SPOT.x) / 176) ** 2 + ((s.y - CORE_SPOT.y) / 164) ** 2;
    expect(Math.abs(onRing - 1)).toBeLessThan(0.01);
  }

  // The right half mirrors the left, going down one side as it goes down the other.
  for (let i = 1; i < 5; i++) {
    expect(Math.abs(at(stations, i).x + at(stations, 10 - i).x - 460)).toBeLessThan(NEAR);
    expect(Math.abs(at(stations, i).y - at(stations, 10 - i).y)).toBeLessThan(NEAR);
    expect(at(stations, i).x).toBeGreaterThan(CORE_SPOT.x);
    expect(at(stations, i).y).toBeGreaterThan(at(stations, i - 1).y);
  }

  // Each name stands under its own station.
  const names = [
    'You',
    'Model',
    'Memory',
    'Files',
    'Shell',
    'Network',
    'Browser',
    'Agents',
    'Skills',
    'Hooks',
  ];
  names.forEach((name, i) => {
    const label = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${name}</text>`).exec(svg);
    expect(spot(label?.[1], label?.[2])).toEqual({
      x: at(stations, i).x,
      y: Math.round((at(stations, i).y + 37) * 10) / 10,
    });
  });
});

test('a spoke runs from the rim of the core to the rim of its station', () => {
  const svg = drawMap({ entries: [], counts: {} }, 1000, DARK_SETUP);
  const stations = stationsIn(svg);
  const spokes = [
    ...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g),
  ];
  expect(spokes.length).toBe(10);
  spokes.forEach((m, i) => {
    const from = spot(m[1], m[2]);
    const to = spot(m[3], m[4]);
    expect(Math.abs(far(from, CORE_SPOT) - HUB_RADIUS)).toBeLessThan(NEAR);
    expect(Math.abs(far(to, at(stations, i)) - NODE_RADIUS)).toBeLessThan(NEAR);
    // Straight at the station: the two ends and the two centers add up to the whole way.
    expect(
      Math.abs(far(from, to) + HUB_RADIUS + NODE_RADIUS - far(CORE_SPOT, at(stations, i)))
    ).toBeLessThan(NEAR * 2);
  });
});

test("a pulse flies along its spoke, two at once five apart, and a subagent's starts at the agents station", () => {
  const now = 1_000_000;
  const running = (id: string, more: Partial<Entry> = {}): Entry =>
    entry('files', now - 100, { id, status: 'run', endedAt: undefined, ...more });
  const flights = (svg: string): [Spot, Spot][] =>
    [
      ...new Set(
        [...svg.matchAll(/<animateMotion path="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)"/g)].map(
          (m) => m[0]
        )
      ),
    ].map((path) => {
      const m = /M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/.exec(path);

      return [spot(m?.[1], m?.[2]), spot(m?.[3], m?.[4])];
    });

  const one = drawMap({ entries: [running('a')], counts: {} }, now, DARK_SETUP);
  const files = at(stationsIn(one), 3);
  const [[from, to] = [CORE_SPOT, CORE_SPOT]] = flights(one);
  expect(Math.abs(far(from, CORE_SPOT) - HUB_RADIUS)).toBeLessThan(NEAR);
  expect(Math.abs(far(to, files) - NODE_RADIUS)).toBeLessThan(NEAR);
  expect(Math.abs(far(from, to) + HUB_RADIUS + NODE_RADIUS - far(CORE_SPOT, files))).toBeLessThan(
    NEAR * 2
  );

  const two = flights(
    drawMap({ entries: [running('a'), running('b')], counts: {} }, now, DARK_SETUP)
  );
  expect(two.length).toBe(2);
  const [[fromA, toA] = [CORE_SPOT, CORE_SPOT], [fromB, toB] = [CORE_SPOT, CORE_SPOT]] = two;
  expect(Math.abs(far(fromA, fromB) - 5)).toBeLessThan(NEAR * 2);
  expect(Math.abs(far(toA, toB) - 5)).toBeLessThan(NEAR * 2);
  // Either side of the spoke, the same length each.
  expect(Math.abs(far(fromA, toA) - far(fromB, toB))).toBeLessThan(NEAR * 2);
  expect(Math.abs(far(fromA, CORE_SPOT) - far(fromB, CORE_SPOT))).toBeLessThan(NEAR * 2);

  const crew = drawMap(
    { entries: [running('a', { from: 'agents', agentId: 'a1' })], counts: {} },
    now,
    DARK_SETUP
  );
  const agents = at(stationsIn(crew), 7);
  const [[start, end] = [CORE_SPOT, CORE_SPOT]] = flights(crew);
  expect(Math.abs(far(start, agents) - NODE_RADIUS)).toBeLessThan(NEAR);
  expect(Math.abs(far(end, files) - NODE_RADIUS)).toBeLessThan(NEAR);
});

test('a leg of the route starts and ends just outside its two stations and bends between them', () => {
  const now = 1_000_000;
  const svg = drawMap(
    { entries: [entry('files', now - 3000), entry('agents', now - 2000)], counts: {} },
    now,
    DARK_SETUP
  );
  const stations = stationsIn(svg);
  const leg = /<path d="M([\d.]+) ([\d.]+)Q([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  const from = spot(leg?.[1], leg?.[2]);
  const bend = spot(leg?.[3], leg?.[4]);
  const to = spot(leg?.[5], leg?.[6]);
  expect(Math.abs(far(from, at(stations, 3)) - 26)).toBeLessThan(NEAR);
  expect(Math.abs(far(to, at(stations, 7)) - 26)).toBeLessThan(NEAR);
  // Files and agents face each other across the middle: the bend lies between them, below the core, inside the ring.
  expect(Math.abs(bend.x - CORE_SPOT.x)).toBeLessThan(NEAR);
  expect(bend.y).toBeGreaterThan(CORE_SPOT.y + 40);
  expect(bend.y).toBeLessThan(376);
  // The dot at the head of the route sits where the leg ends.
  expect(svg).toContain(`<circle cx="${leg?.[5]}" cy="${leg?.[6]}" r="2.4"`);
});

// ---- the lanes ------------------------------------------------------------------------------------

const LANES_LEFT_EDGE = 74;
const LANES_NOW_EDGE = 420;
const LANES_PER_MS = (LANES_NOW_EDGE - LANES_LEFT_EDGE) / 120_000;
const rects = (svg: string): { x: number; y: number; width: number; rest: string }[] =>
  [
    ...svg.matchAll(
      /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="[\d.]+"([^>]*)\/>/g
    ),
  ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), rest: m[4] ?? '' }));

test('view is map unless it names the lanes or both', () => {
  expect(setupFrom({}).view).toBe('map');
  expect(setupFrom({ view: 'lanes' }).view).toBe('lanes');
  expect(setupFrom({ view: 'both' }).view).toBe('both');
  expect(setupFrom({ view: 'sideways' }).view).toBe('map');
});

test('a finished call is a bar as long as it took, placed by when it ran', () => {
  const now = 1_000_000;
  const svg = drawLanes(
    { entries: [entry('shell', now - 60_000, { endedAt: now - 30_000 })], counts: { shell: 1 } },
    now,
    DARK_SETUP
  );
  const bar = rects(svg).find((r) => r.rest.includes('fill="#e1ac6e"'));
  expect(Math.abs((bar?.x ?? 0) - (LANES_NOW_EDGE - 60_000 * LANES_PER_MS))).toBeLessThan(NEAR);
  expect(Math.abs((bar?.width ?? 0) - 30_000 * LANES_PER_MS)).toBeLessThan(NEAR);
  expect(svg).not.toContain('NaN');
});

test('a running call reaches the right edge and beyond, and carries a cap at now', () => {
  const now = 1_000_000;
  const svg = drawLanes(
    {
      entries: [entry('shell', now - 10_000, { endedAt: undefined, status: 'run' })],
      counts: { shell: 1 },
    },
    now,
    DARK_SETUP
  );
  const bar = rects(svg).find((r) => r.rest.includes('fill="#f0c595"'));
  expect(Math.abs((bar?.x ?? 0) - (LANES_NOW_EDGE - 10_000 * LANES_PER_MS))).toBeLessThan(NEAR);
  expect((bar?.x ?? 0) + (bar?.width ?? 0)).toBeGreaterThan(LANES_NOW_EDGE + 1000);
  expect(rects(svg).some((r) => r.x === LANES_NOW_EDGE - 2 && r.width === 2)).toBe(true);
  expect(svg).toContain('>running: 1<');
});

test('calls that ran together lie one above another in their lane', () => {
  const now = 1_000_000;
  const svg = drawLanes(
    {
      entries: [
        entry('files', now - 20_000, { endedAt: now - 10_000 }),
        entry('files', now - 18_000, { endedAt: now - 12_000 }),
        entry('files', now - 5000, { endedAt: now - 4000 }),
      ],
      counts: { files: 3 },
    },
    now,
    DARK_SETUP
  );
  const [one, two, three] = rects(svg).filter((r) => r.rest.includes('fill="#e1ac6e"'));
  expect(two?.y).toBeGreaterThan(one?.y ?? Infinity);
  // The third began after the first ended, so it is back in the first row.
  expect(three?.y).toBe(one?.y);
});

test('a failure is red, a refusal hatched, a subagent call hollow, and what left the window is gone', () => {
  const now = 1_000_000;
  const svg = drawLanes(
    {
      entries: [
        entry('web', now - 500_000),
        entry('shell', now - 50_000, { status: 'err' }),
        entry('hooks', now - 40_000, { status: 'block' }),
        entry('files', now - 30_000, { from: 'agents' }),
        entry('memory', now - 20_000, { from: 'inbound' }),
      ],
      counts: { shell: 1 },
      faults: { shell: 1 },
    },
    now,
    DARK_SETUP
  );
  const bars = rects(svg).filter((r) => r.x > LANES_LEFT_EDGE && r.width < 5 && r.width > 2);
  expect(bars.map((b) => b.rest.trim())).toEqual([
    'fill="none" stroke="#62c7ba" stroke-width="1" stroke-dasharray="2 2"',
    'fill="none" stroke="#e1ac6e" stroke-width="1"',
    'fill="#e8654f"',
    'fill="url(#lot-hatch)" stroke="#e8654f" stroke-width=".8"',
  ]);
  // The fault's dot sits beside the shell's lane.
  expect(svg).toContain('r="2.8" fill="#e8654f"');
});

test('your message is a mark with a line down the lanes, the answer a ring', () => {
  const now = 1_000_000;
  const svg = drawLanes(
    {
      entries: [
        entry('you', now - 30_000, { from: 'inbound' }),
        entry('you', now - 5000, { mark: 'done' }),
      ],
      counts: {},
    },
    now,
    DARK_SETUP
  );
  const at = (LANES_NOW_EDGE - 30_000 * LANES_PER_MS).toFixed(1);
  expect(svg).toContain(`<path d="M${at} `);
  expect(
    rects(svg).some((r) => r.x === Number(at) && r.width === 0.8 && r.rest.includes('#6b7280'))
  ).toBe(true);
  expect(count(svg, 'r="3.5" fill="none"')).toBe(1);
});

test('the head names the model and the context; under the map the lanes go without it', () => {
  const board: Board = { entries: [], counts: {}, model: 'claude-opus-5-5', context: 66 };
  const alone = drawLanes(board, 1000, DARK_SETUP);
  expect(alone).toContain('CLAUDE');
  expect(alone).toContain('>66%<');
  expect(alone).toContain('Nothing is running.');
  expect(alone).toContain('viewBox="0 0 460 288"');
  const under = drawLanes(board, 1000, DARK_SETUP, false);
  expect(under).not.toContain('CLAUDE');
  expect(under).not.toContain('>66%<');
  expect(under).toContain('viewBox="0 0 460 250"');
  expect(drawLanes({ ...board, context: 95 }, 1000, DARK_SETUP)).toContain('fill="#e8654f">95%<');
});

test('the lanes speak the language and move by themselves', () => {
  const svg = drawLanes({ entries: [], counts: {} }, 1000, setupFrom({ language: 'de' }));
  expect(svg).toContain('>jetzt<');
  expect(svg).toContain('Netz');
  expect(svg).toContain('<animateTransform attributeName="transform" type="translate"');
  expect(svg).toContain('prefers-color-scheme: light');
});

test(
  'view lanes shows the lanes in place of the map',
  { options: { view: 'lanes' } },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    const pictures = await ui.findAll({ type: 'Svg' });
    expect(pictures.length).toBe(1);
    expect(String(pictures[0]?.props.source)).toContain('lot-lanes');
    expect(String(pictures[0]?.props.source)).toContain('CLAUDE');
    await ui.unmount();
  }
);

test(
  'view both shows the map and under it the lanes',
  { options: { view: 'both' } },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    const sources = (await ui.findAll({ type: 'Svg' })).map((p) => String(p.props.source));
    expect(sources.length).toBe(2);
    expect(sources[0]).toContain('<ellipse');
    expect(sources[1]).toContain('lot-lanes');
    expect(sources[1]).not.toContain('CLAUDE');
    await ui.unmount();
  }
);

test('view map, the default, shows the map alone', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const sources = (await ui.findAll({ type: 'Svg' })).map((p) => String(p.props.source));
  expect(sources.length).toBe(1);
  expect(sources[0]).not.toContain('lot-lanes');
  await ui.unmount();
});

test('each subagent has a lane of its own under the agents, with its calls drawn whole', () => {
  const now = 1_000_000;
  const board: Board = {
    entries: [
      entry('agents', now - 60_000, {
        endedAt: undefined,
        status: 'run',
        task: 'a1',
        label: 'Audit the tokens',
      }),
      entry('files', now - 50_000, { from: 'agents', agentId: 'a1' }),
      entry('shell', now - 40_000, {
        from: 'agents',
        agentId: 'b2',
        endedAt: undefined,
        status: 'run',
      }),
    ],
    counts: {},
    agents: ['a1', 'b2', 'c3'],
  };
  const svg = drawLanes(board, now, DARK_SETUP);
  // Three lanes of sixteen more than the ten stations take.
  expect(svg).toContain('viewBox="0 0 460 336"');
  expect(svg).toContain('>Audit the t<');
  expect(svg).toContain('>subagent 2<');
  expect(svg).toContain('>subagent 3<');
  // The file call: hollow in the files lane, whole in the first subagent's lane, which lies under the agents.
  const at = LANES_NOW_EDGE - 50_000 * LANES_PER_MS;
  const [hollow, whole] = rects(svg).filter((r) => Math.abs(r.x - at) < NEAR && r.width === 2.5);
  expect(hollow?.rest).toContain('fill="none"');
  expect(whole?.rest).toContain('fill="#e1ac6e"');
  expect(whole?.y).toBeGreaterThan(46 + 8 * 22);
  expect(whole?.y).toBeLessThan(46 + 8 * 22 + 16);
  // The stations after the agents move down by the three lanes.
  expect(svg).toContain(
    `y="${46 + 8 * 22 + 48 + 15}" font-family="SF Mono, ui-monospace, Menlo, monospace" font-size="10.5" fill="#9ba1ab">Skills<`
  );
  expect(
    drawLanes({ entries: [], counts: {}, agents: ['1', '2', '3', '4', '5', '6'] }, now, DARK_SETUP)
  ).toContain(`viewBox="0 0 460 ${288 + 4 * 16}"`);
});

test('a bar under the pointer names its station, its label and how long it took', () => {
  const now = 1_000_000;
  const svg = drawLanes(
    {
      entries: [
        entry('shell', now - 60_000, { endedAt: now - 30_000, label: 'Run <all> tests' }),
        entry('files', now - 20_000, { endedAt: undefined, status: 'run', label: 'b/slow.py' }),
        entry('you', now - 10_000, {
          from: 'inbound',
          endedAt: now - 10_000,
          label: 'new message',
        }),
      ],
      counts: {},
    },
    now,
    DARK_SETUP
  );
  expect(svg).toContain('<g><title>Shell: Run &lt;all&gt; tests · 30.0 s</title><rect ');
  expect(svg).toContain('<g><title>Files: b/slow.py · running</title><rect ');
  expect(svg).toContain('<g><title>You: new message</title><path ');
});

test(
  'the lanes are drawn in a frame, so the pointer works on them; the map stays an image',
  { options: { view: 'both' } },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }));
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
    const [map, lanes] = await ui.findAll({ type: 'Svg' });
    expect(map?.props.isInteractive).toBeUndefined();
    expect(lanes?.props.isInteractive).toBe(true);
    await ui.unmount();
  }
);

test('the buttons at the top switch the view for the session, starting from the option', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' });
  const buttons = await ui.findAll({ type: 'Button' });
  expect(buttons.map((b) => b.props.label)).toEqual(['Map', 'Lanes', 'Both']);
  expect(buttons.map((b) => b.props.variant)).toEqual(['primary', undefined, undefined]);
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(1);

  await ui.press({ key: 'view-both' });
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(2);
  expect((await ui.findAll({ type: 'Button' })).map((b) => b.props.variant)).toEqual([
    undefined,
    undefined,
    'primary',
  ]);

  await ui.press({ key: 'view-lanes' });
  const pictures = await ui.findAll({ type: 'Svg' });
  expect(pictures.length).toBe(1);
  expect(String(pictures[0]?.props.source)).toContain('lot-lanes');
  await ui.unmount();
});

test('in a terminal there is nothing to switch', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }));
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0);
  await ui.unmount();
});
