# Changelog

What changed in each version of lot-map, newest first. To get a new version, see [Updating](README.md#updating).

## Unreleased — Codex adapter 0.4.1

- Added a Codex plugin with local command hooks and a native MCP App side panel, sharing Claude's map and timeline renderer.
- Added session selection, pause/resume, sanitized local receipts with bounded retention, and standalone Codex marketplace packaging.
- Verified the native panel updating during a real Codex run. Documented differences in available hook events and the need to trust installed hooks.
- Let native SVG animations run between activity updates, avoiding repeated animation restarts in the Codex panel.
- Settle unfinished main-turn entries on Stop without stopping subagents; freeze and label stale or disconnected activity as unknown instead of showing it as live work.
- Kept the Claude adapter and its 0.3.10 manifest unchanged.

## 0.3.10 (2026-11-12)

- The pane always shows the map with the lanes under it, both at the pane's full width. The `view` option and the buttons that switched views are gone.
- The lanes are an image again, as the map is: drawn in a frame they came out narrower than the map. A bar no longer answers the pointer.

## 0.3.9 (2026-11-12)

- New option `view`: `lanes` draws the last two minutes on a time axis, one lane per station, and `both` puts the lanes under the map. `map`, the default, is the pane as it was.
- Three buttons at the top of the pane switch between the map, the lanes and both for the session.
- In the lanes each subagent has a lane of its own under Agents, and a bar under the pointer says what it was.

## 0.3.8 (2026-11-11)

- Italian labels: `language` takes `it`. Contributed by kesi26. (#20)

## 0.3.7 (2026-11-11)

- Background work stays on the map until it ends: a command sent to the background, a monitor, a background subagent or a workflow keeps its row open, and the row closes when the task reports back. A task that failed leaves a fault on its station. (#17)
- A background task's report is no longer drawn as a new message of yours.
- Monitor has its own label on the Shell station.

## 0.3.6 (2026-11-11)

- New option `colors`: colours of your own, by name, as `name=#rrggbb`. (#15)

## 0.3.5 (2026-11-11)

- The route is softer on a light surface, and each leg fades by itself: it stays for 40 seconds and fades over 20. (#14)

## 0.3.4 (2026-11-11)

- The PowerShell tool is read the same way as Bash, with PowerShell's own command names. (#13)
- A quoted path with a space is read as one word, and a Windows program is read by its name: `CURL.EXE` is `curl`.

## 0.3.3 (2026-11-11)

- Windows paths with backslashes are read: the label of a file, the memory folders and the names of commands. Contributed by davidkinsler. (#11)

## 0.3.2 (2026-11-11)

- New option `background`: with `transparent` the map leaves its ground out and the surface shows through. (#10)

## 0.3.1 (2026-11-11)

- Fixed: a password in a web address could reach a label when the address was written in an unusual way. An address that can be read two ways now shows only its scheme. (#6)
- A hook's refusal shows the name of the tool it stopped; its first line shows only with the new option `hookReasons`.
- The word after a memory command shows only if it is listed in the new option `memorySubcommands`.
- A name in `memoryCommands` counts when it is the command itself or begins with it and `-`, `_` or `.`.
- More commands light Network: `rsync`, `nc`, `sftp`, `npm install`, `docker pull` and the like, also inside `$(…)`.
- Control characters are taken out of every label.

## 0.3.0 (2026-11-10)

- New option `layout`: `you-bottom` turns the ring so that you are at the bottom and the network at the top.

## 0.2.0 (2026-11-10)

- The route: a thin line joins the last stations in order.
- Spokes wear in with use, and two clock hands grow around a station while a call runs.
- Memory has a colour of its own; what a hook brought unasked is drawn and counted apart.
- A ring around the centre shows how full the context window is.
- A change of model rings at the centre and gets a row of its own.
- Subagents circle the Agents station.
- Calls that start together fly side by side; a fault leaves a dot until the next message; finished calls at one station fold into one row.
- A light palette and the option `theme`; with `auto` the map follows a light or a dark surface by itself.

## 0.1.0 (2026-11-09)

- The first version: a pane beside the chat with ten stations that light up as memory, files, shell, the network, the model, agents, skills and hooks are used.
- Labels in English, Russian, Spanish, French and German.
