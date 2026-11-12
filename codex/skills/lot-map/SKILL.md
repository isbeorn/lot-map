---
name: lot-map
description: Open the Lot Map activity panel beside the current Codex chat. Use when the user asks to open or show Lot Map or invokes its shortcut.
---

Call the Lot Map plugin's `lot_map_open` MCP tool once with empty arguments.
Its trusted hook supplies the current chat's session ID. Do not guess an ID
from the most recently active session. Pass `session_id` only if the user
explicitly requests another session and its ID is known.

If the card remains inline, point to **Open panel**. If the result has no
`sessionId`, explain that the hooks need review and trust, or the user can
choose a session in the panel. Do not claim the current chat was selected.

If the tool is unavailable, explain that Lot Map must be installed and enabled.
Keep the reply brief; opening the map is the task.
