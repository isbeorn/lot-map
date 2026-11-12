# Lot Map for Codex

A native MCP App panel shows Codex activity using lot-map's existing map and
timeline renderer. Command hooks capture activity locally; the panel reads it
through an app-only MCP tool. No public server, browser port, model calls, or
transcript scraping are needed.

## Install

Requires Node.js 18 or later on PATH, a Codex desktop build with MCP Apps, and
Codex lifecycle hooks. Tested with desktop 26.1106.51428 and CLI 0.167.0 on Linux.
The hook launcher uses POSIX shell syntax; Windows support is not yet verified.

From the lot-map repository:

```bash
npm ci
npm run package:codex
codex plugin marketplace add ./dist/codex-marketplace
codex plugin add lot-map@lot-map-codex
```

The generated marketplace contains a standalone plugin, including bundled
JavaScript and HTML. It does not require npm or this checkout at runtime.
Keep the marketplace directory for upgrades; it can also be copied to another
machine with Node.js installed.

Start the Codex CLI with `codex`, open `/hooks`, and review and trust Lot Map's
hooks. Installation alone does not trust hooks. Then restart the desktop app
so it loads the plugin and the approved hooks.

Ask Codex **“Open Lot Map for this session.”** The `lot_map_open` tool opens the
MCP UI and requests the desktop panel. The **Open panel** button makes the same
request if the host initially keeps it inline. Unlike the Claude mod, the
Codex plugin does not automatically open the pane at every session start.

The tool accepts an optional `session_id`. Without it, the latest captured
session is selected once and stays selected. Use the session selector to
switch; activity from different sessions is never combined. **Pause** stops
polling and animation until **Resume** is clicked.

To update, run `npm ci` and `npm run package:codex` from the updated checkout,
then reinstall with `codex plugin add lot-map@lot-map-codex`. If `/hooks` shows
Lot Map's hooks as changed, review and trust the new versions. Then restart
the desktop app and ask to open Lot Map again.

## Coverage and limits

- Tool starts/completions, shell and file activity, MCP calls, model requests,
  subagents, compaction, prompts, permission requests, interruption, and turn
  completion are captured when Codex emits the corresponding hooks.
- Known shell/file/memory classification and map/timeline rendering are shared
  with Claude. Codex `apply_patch` is Files; agent tools are Agents; browser
  tools from the browser/CUA MCP servers are Browser.
- Hosted tools (including hosted web search) do not emit the local tool hooks.
  A script's internal network traffic is not observable.
- Skill activation, context-window percentage, other hooks' injected content,
  and every permission decision are not exposed by this adapter. A permission
  request is shown as a request, not falsely reported as a refusal.
- Explicit tool failures and model-request failures are marked red. Not every
  tool exposes a structured error status. Missing completion events are not
  guessed to be errors. Turn completion or interruption closes unfinished
  entries in that turn; subagents remain independent. Session end closes all
  remaining entries with an “ended without result” label.
- If unfinished activity has no new hook events for 30 seconds, the map freezes
  at its last known state and reports **activity status unknown**. This can also
  happen during a long tool call; a later event resumes the live display. A
  successful poll alone never proves that hooks are still delivering events.
- The display uses up to 512 recent hook receipts per session, so counts are
  for that retained history, not lifetime totals. Up to 32 recent sessions are
  offered in the selector. Old session data is removed after seven idle days
  when a new session starts.

## Options and stored data

Defaults live under `~/.codex/lot-map/`. Set `LOT_MAP_DATA` in the environment
of **both** the MCP server and hooks to override the directory. The directory
must be writable by the Codex host process.

Put optional settings in `~/.codex/lot-map/options.json`, for example:

```json
{
  "coreName": "CODEX",
  "language": "en",
  "theme": "auto",
  "memoryServers": ["memory"],
  "layout": "you-top"
}
```

The display, color, language, layout and memory classification settings use the
same values as the Claude plugin. Claude's `hookRecords` and `hookReasons` do
not apply to the Codex adapter. Most display options refresh on the next poll;
classification changes apply to new receipts.

Raw hook input is reduced before storage. Stored receipts contain sanitized
labels, event names, station names, model names, timestamps, session/turn/agent
IDs, tool-call IDs and status. No prompts, raw command lines, file contents,
tool outputs, credentials, or transcripts are stored. File labels can contain
the last two path components; network labels can contain a hostname. The map
has local access to the captured sessions through the selector.

Receipt files are created privately and atomically. Concurrent calls write
separate files. The collector is advisory and prints nothing to the model.
It drops malformed or oversized inputs and never returns a blocking decision.
Deleting `~/.codex/lot-map/sessions/` clears the captured history.

## Development

```bash
npm run build:codex
npm run typecheck:codex
npm run test:codex
```

`adapter.ts` translates Codex hooks into the shared `Board` model. `collect.ts`
and `store.ts` handle local receipts. `server.ts` serves the MCP tools and UI;
`panel.ts` uses `hooks/map.ts` and `hooks/text.ts` unchanged. `package.mjs`
builds a standalone local marketplace. The root `.claude-plugin/` and
`hooks/hooks.json` remain exclusively for Claude; Codex explicitly points to
`codex/hooks.json` and `codex/mcp.json`.

The regression tests cover event classification, completion, interrupted turns,
stale activity, session isolation, private storage, and the bundled MCP server.
The test runner builds its test bundle in a temporary directory and removes it
after the run. Only runtime JavaScript and HTML go into the packaged plugin.

Plugin hooks currently require manual/local installation and are not eligible
for the public plugin directory. See the [official packaging guidance](https://developers.openai.com/plugins/build/plugins).
