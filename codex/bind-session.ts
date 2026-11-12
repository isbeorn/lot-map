/** Bind only Lot Map's open call; all other tools and hook events remain advisory. */
export function bindSession(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const raw = input as Record<string, unknown>;

  if (
    raw.hook_event_name !== 'PreToolUse' ||
    !['mcp__lot_map__lot_map_open', 'mcp__lot-map__lot_map_open'].includes(String(raw.tool_name)) ||
    typeof raw.session_id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.session_id)
  ) {
    return null;
  }

  const args = raw.tool_input;

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null;
  }

  const argumentsObject = args as Record<string, unknown>;

  // An explicitly requested session still works; the panel's selector is independent.
  if (argumentsObject.session_id !== undefined) {
    return null;
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...argumentsObject, session_id: raw.session_id },
    },
  };
}
