# lot-map

A plugin for Claude Code and Codex: a live map of the work, in a pane beside the chat. Activity sends a pulse from the centre to its station, so you see memory, files, shell, web and agents at work instead of reading a list of commands. The two adapters share the map and timeline renderer.

![The map during a work session](docs/demo.gif)

*A made-up session replayed through the mod's own drawing code. [Video (MP4)](docs/demo.mp4).*

This is a fork of [alexeyw/lot-map](https://github.com/alexeyw/lot-map), kept at [isbeorn/lot-map](https://github.com/isbeorn/lot-map). The commands below install the fork; issues and pull requests for it go to the fork's repository.

## Install

### Codex

Requires Node.js 18 or later on PATH, the Codex CLI and a Codex desktop build with MCP Apps and lifecycle hooks. Tested on Linux; Windows support is not yet verified. From a clone of this repository:

```bash
npm ci
npm run package:codex
codex plugin marketplace add ./dist/codex-marketplace
codex plugin add lot-map@lot-map-codex
```

Start the Codex CLI with `codex`, open `/hooks`, and review and trust Lot Map's hooks. Installation alone does not trust them. Then restart the desktop app and ask **“Open Lot Map for this session.”** The map opens as an MCP App; if it appears inline in the conversation, click **Open panel** to move it beside the chat. It does not open automatically at session start.

Use **Session** to choose a captured session. **Pause** freezes the display; **Resume** brings it up to date. **Idle** means the recorded work has ended. If unfinished work has no new hooks for 30 seconds, the map freezes and says **Activity status unknown** until another event arrives.

| At work in Codex | After the answer |
| --- | --- |
| ![At work in Codex](docs/codex-working.jpg) | ![An idle Codex session](docs/codex-idle.jpg) |

*Captured from live Codex sessions, with the same map and lanes as Claude.*

The Codex adapter captures local lifecycle hooks and stores a bounded history on disk. Hosted web search, skill activation, context percentage and injected hook content are not exposed. See the [Codex guide](codex/README.md) for coverage, privacy, options and updates.

### Claude Code

At the prompt of a terminal session:

```
/plugin install lot-map --marketplace isbeorn/lot-map
```

Answer `y` to add the marketplace, then choose a scope. From a shell:

```bash
claude plugin install lot-map --marketplace isbeorn/lot-map
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `isbeorn/lot-map`, then **Add plugin**.

The pane opens by itself when a session starts. In a terminal it needs at least 144 columns and draws text only; otherwise type `/lot-map`. Built and tested on Claude Code 2.1.321 on macOS; users report it working on Windows as well.

## Updating

### Codex

From an updated clone of this repository:

```bash
npm ci
npm run package:codex
codex plugin add lot-map@lot-map-codex
```

If `/hooks` shows Lot Map's hooks as changed, review and trust the new versions. Then restart the desktop app and ask to open Lot Map again.

### Claude Code

From a shell:

```bash
claude plugin marketplace update lot-map
claude plugin update lot-map@lot-map
```

Then start a new session. The first command is needed: without it the second one reports the installed version as the latest.

What each version changed is in [CHANGELOG.md](CHANGELOG.md).

## What lights up

The detailed behavior below describes the Claude adapter. Codex uses the same stations and visuals, subject to its [hook coverage](codex/README.md#coverage-and-limits).

| Station | When |
| --- | --- |
| You | your messages, questions and files sent to you |
| Model | each model request, context compaction |
| Memory | Claude Code's memory folder, plus whatever you name in the options |
| Files | Read, Write, Edit, Grep, Glob, and shell commands that work on files and nothing else: they read, search, move, delete or edit in place (`cat`, `grep`, `mv`, `sed -i`, `tee`, `find … -delete`) |
| Shell | every other shell command |
| Network | web fetch and search, MCP servers, and shell commands known to reach the network: `curl`, `gh`, `ssh`, `rsync`, `git push`, `npm install`, `docker pull` and the like, also inside `$(…)` |
| Browser | browser tools |
| Agents | subagents and workflows; their own calls start from this station |
| Skills | skills and tool search |
| Hooks | settings hooks that refuse a call, ask for permission, add context or take a moment |

On Windows the PowerShell tool is read the same way as Bash, with PowerShell's own names: `Get-Content` and `Select-String` light Files, `Invoke-WebRequest` lights Network. A program run by its full path is read by its name, also from a quoted path with a space, and `CURL.EXE` is `curl`.

The shell stations go by the command's name, not by what it does: a script that opens a connection itself, such as `python -c "…"`, shows as Shell.

A pulse flies out when something starts and returns when it ends. Refusals and errors turn red.

## Reading the map

- **The route.** A thin line joins the last few stations the main loop went through, in order, and its newest leg draws itself. A leg stays for 40 seconds and then fades over 20, so a minute after the work stops only the spokes are left; their thickness keeps where the work went. Model steps are left out, or every leg would pass through Model.
- **Worn spokes.** A spoke grows thicker and brighter the more its station is used, so at the end of a session the map shows where the work went.
- **How long.** Two clock hands grow around a station while a call runs: the inner one goes round in a minute, the outer one in ten.
- **Background work.** A command sent to the background, a monitor, a background subagent or a workflow stays lit on its station after the turn that started it is over, with the clock hands growing, until the task reports that it ended. A task that failed leaves the red dot. The report itself is not shown as a message of yours.
- **Several at once.** Calls that start together fly side by side, and the station carries their number, such as `×3`.
- **What went wrong.** A red dot with a count stays on a station from an error or a refusal until your next message.
- **Memory.** It has a colour of its own. A solid pulse is a memory Claude asked for; a hollow one on a dashed line is what a hook brought unasked. Under the station, the plain number counts the first and `↓` the second.
- **The context window.** The ring around the centre fills as the session goes, with the percentage above the name. It turns amber at 70% and red at 90%.
- **A change of model.** The centre and the Model station ring for a few seconds, and the feed gets a row such as `opus 5.5 → fable 5.2`. This also happens when a session starts on a different model from the last session in the same folder.
- **Subagents.** Each one still at work circles the Agents station as a small dot, and its calls start from there.
- **The answer.** One wide ring leaves the centre when the answer is ready.

Below the map are the current action with the context percentage, and the last 16 rows: `●` running, `·` done, `✕` failed or blocked, `◆` a change of model. Finished calls that follow one another at one station fold into one row, marked `+2` for the two it stands for besides the one named.

| At work | Subagents | A hook refuses |
| --- | --- | --- |
| ![At work](docs/map-working.png) | ![Subagents](docs/map-agents.png) | ![A hook refuses](docs/map-blocked.png) |

| A change of model | After the answer | Light colours |
| --- | --- | --- |
| ![A change of model](docs/map-switch.png) | ![After the answer](docs/map-after.png) | ![Light colours](docs/map-light.png) |

## Lanes

Under the map the pane draws the last two minutes on a time axis, one lane per station, with now at the right edge. The map shows where the work is; the lanes also show when, for how long and what ran together. A terminal draws words only and has neither.

- **A bar** is one call, from its start to its end. A running one reaches the right edge and carries a light cap there.
- **Bars one above another** in a lane ran at the same time, up to three rows.
- **Red** is an error, **hatched red** a refusal by a hook. A red dot beside a lane stays until your next message, as on the map.
- **A hollow bar** is a subagent's call; a dashed one is what a hook brought unasked.
- **Subagents** each get a narrow lane of their own under Agents, up to four, with their calls drawn whole. One launched to run on goes by what it was started with, another by its number.
- **Your message** is a mark on your lane with a line down all of them; the answer is a ring, a change of model a mark on Model.
- **The number** at the end of a lane is how often the station was used this session.
## Options

In Claude Code, the install offers them on a screen. Later, use `/config` in a terminal or `claude plugin configure`, then restart the session.

In Codex, put settings in `~/.codex/lot-map/options.json`. The centre says `CODEX` by default; the display and memory options below use the same values. `hookRecords` and `hookReasons` are Claude-only. See the [Codex example](codex/README.md#options-and-stored-data).

| Option | Default | Meaning |
| --- | --- | --- |
| `language` | `en` | `en`, `ru`, `es`, `fr`, `de` or `it` |
| `coreName` | `CLAUDE` | what the circle in the middle says, up to ten characters |
| `memoryServers` | `memory` | MCP servers whose tools light Memory |
| `memoryCommands` | none | shell commands or scripts that light Memory; a name counts when it is the command itself or begins with it and `-`, `_` or `.`, so `recall` also names `recall-sync.py` |
| `memorySubcommands` | none | words after a memory command that the map may show, such as `add` or `search`; without them the command goes by its own name |
| `memoryPaths` | none | parts of a path that make a file a memory |
| `memoryLabels` | none | short names for memory tools, each as `tool=name` |
| `hookRecords` | `false` | turn on if a hook of yours adds memory records numbered like `[#123]`; they appear on Memory by number only. Such a number in the text of any hook counts, not only a memory hook's |
| `hookReasons` | `false` | show the first line of a hook's refusal, up to 72 characters; off, the map says only which tool was stopped |
| `theme` | `auto` | the map's colours: `dark`, `light`, or `auto`, which is dark on a dark surface and light on a light one |
| `background` | `solid` | the map's own background, or `transparent`, which lets the pane behind it show through. The rim around the labels keeps the background's colour, so on a surface of another shade it shows as a faint halo |
| `colors` | none | colours of your own, each as `name=#rrggbb`; see [Colours of your own](#colours-of-your-own) |
| `layout` | `you-top` | where you are on the map: `you-top`, or `you-bottom`, which turns the ring half a turn so that you are at the bottom and the network and the browser at the top |

For example, Russian labels and your own memory server:

```bash
echo '{"language":"ru","memoryServers":"my-memory"}' | claude plugin configure lot-map@lot-map --values-stdin
```

Lists are written with commas.

| Russian labels | `layout` set to `you-bottom` |
| --- | --- |
| <img src="docs/map-russian.png" width="320" alt="The map with Russian labels"> | <img src="docs/map-turned.png" width="320" alt="The map turned, with the person at the bottom"> |

## Colours of your own

`colors` replaces the map's colours one by one. Set one, a few, or all thirteen; what you leave out stays as it is.

```bash
echo '{"theme":"dark","colors":"accent=#7fb4ff,active=#b8d6ff,text=#e6edf7"}' | claude plugin configure lot-map@lot-map --values-stdin
```

| Name | What it colours |
| --- | --- |
| `background` | the map's ground, and the rim around the labels |
| `node` | the inside of a station and of the centre |
| `line`, `spoke` | the dashed contours and the idle spokes |
| `text`, `label`, `faint` | the name in the centre and lit labels, the other labels, the counts |
| `accent`, `active` | the main colour, and a station at work |
| `error` | errors and refusals |
| `memory`, `memoryActive` | the Memory station and its spoke |
| `route` | the route between stations |

<img src="docs/map-colors.png" width="640" alt="The map in two palettes of one's own: a cool blue one and a green one">

- Only `#rgb` and `#rrggbb` are taken. Anything else, and any other name, counts as not set.
- With `theme` left on `auto`, a colour of your own holds on a light surface as well, and the rest is repainted as before. With a whole palette of your own, set `theme` to `dark` or `light`.
- With `background` set to `transparent`, still give `background` here the colour of your pane: the rim around the labels takes it, and the halo is gone.

## What it shows and what it keeps

This section describes Claude. Codex stores sanitized hook receipts locally; see [Codex stored data](codex/README.md#options-and-stored-data).

The mod makes no network requests, reads no files, runs no processes, calls no model and adds nothing to the conversation. Its rows live only for the session.

Like any mod that follows tool calls, it is handed every call's whole input, including command lines and the text written to files. It takes names from that and nothing else; the code that does so is `classify` in `hooks/map.ts`. A marketplace added from this repository follows its `main` branch, so an update brings whatever is there: read the diff before updating if that matters to you.

It asks Claude Code for one thing: how full the context window is, after each model step. Between sessions it keeps one thing, the name of the model last used in each folder, so that it can show a change. Each is stored under the folder's full path, in Claude Code's own store for the plugin.

A label holds a name, never content:

- a file: the last two parts of its path;
- a web address: the host alone, without a login, password, path or query; an address that can be read two ways shows only its scheme;
- a shell command: the short description Claude wrote for it, or the command's name, never the command line;
- a memory call: the tool's name and a record number or short identifier, never the text or the query;
- a memory command: its name, and the word after it only if you listed that word in `memorySubcommands`;
- a subagent: the short description it was started with;
- a background task's report: that the task ended and whether it failed, never its summary or its output;
- a hook's refusal: the name of the tool it stopped. Its first line shows only with `hookReasons` on, because a refusal may quote what the hook found.

Control characters are taken out of every label before it is drawn.

A fault on the map never reaches a tool call or a model turn.

## Developing

For the Codex adapter:

```bash
npm run lint:codex
npm run typecheck:codex
npm run test:codex
npm run package:codex
```

For the Claude adapter:

```bash
claude plugin test .
claude plugin validate .
```

Lint and format (ESLint and Prettier, LF line endings):

```bash
npm install
npm run lint
npm run format:check
```

Type check, against the declarations the engine writes to `.claude-plugin/types/` the first time it loads the mod from this folder (`claude --plugin-dir .`):

```bash
npm run typecheck
```

Words live in `hooks/text.ts`; a new language is one more table there and one more value of `language` in `.claude-plugin/plugin.json`.

## License

[MIT](LICENSE)
