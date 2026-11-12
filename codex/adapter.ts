import { classify, clean, setupFrom } from '../hooks/map';
import type { Board, Entry, StationId, Status } from '../types';

export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'PreModelRequest',
  'PostModelRequest',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];
export interface Receipt {
  id: string;
  at: number;
  sessionId: string;
  event: HookEvent;
  turnId?: string;
  callId?: string;
  agentId?: string;
  model?: string;
  station: StationId;
  label: string;
  status: Status;
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const name = (value: unknown, max = 128): string | undefined =>
  typeof value === 'string' && value.trim() ? clean(value).slice(0, max) : undefined;

function resultStatus(value: unknown): Status {
  const result = record(value);

  if (result.isError === true || result.is_error === true || result.status === 'failed') {
    return 'err';
  }

  const code = result.exit_code ?? result.exitCode;

  if (typeof code === 'number' && code !== 0) {
    return 'err';
  }

  // Codex shell outputs include an execution header before the command's output.
  const header =
    typeof value === 'string' ? value.split(/(?:Final output:|Output:)/)[0]?.slice(0, 512) : '';
  const match = /^(?:Exit code:|Process exited with code)\s*(-?\d+)\s*$/im.exec(header ?? '');

  return match && Number(match[1]) !== 0 ? 'err' : 'ok';
}

/** Reduce raw hook input to safe metadata BEFORE it reaches disk or the UI. */
export function normalize(
  input: unknown,
  id: string,
  at = Date.now(),
  options: Record<string, unknown> = {}
): Receipt | null {
  const raw = record(input);
  const event = raw.hook_event_name as HookEvent;
  const sessionId = name(raw.session_id);

  if (!sessionId || !HOOK_EVENTS.includes(event)) {
    return null;
  }

  const tool = name(raw.tool_name) ?? 'Tool';

  if (/^mcp__.*(?:lot_map|lot-map).*__lot_map_/.test(tool)) {
    return null;
  }

  const args = record(raw.tool_input);
  const paths = Array.isArray(options.memoryPaths)
    ? options.memoryPaths
    : typeof options.memoryPaths === 'string'
      ? options.memoryPaths.split(',')
      : [];
  const setup = setupFrom({
    coreName: 'CODEX',
    ...options,
    memoryPaths: ['/.codex/memories/', ...paths],
  });
  let station: StationId = 'hooks';
  let label: string = event;
  let status: Status = 'ok';

  if (event === 'PreToolUse' || event === 'PostToolUse') {
    if (tool === 'apply_patch') {
      station = 'files';
      label = 'apply_patch';
    } else if (
      ['spawn_agent', 'wait_agent', 'send_message', 'followup_task', 'close_agent'].includes(tool)
    ) {
      station = 'agents';
      label = tool;
    } else if (/^mcp__(?:cua_repl|browser)__/.test(tool)) {
      station = 'browser';
      label = tool.split('__').pop() ?? 'Browser';
    } else if (tool === 'request_user_input' || tool === 'request_user_input_async') {
      station = 'you';
      label = 'Question';
    } else {
      // Descriptions and agent prompts can contain user content; never persist them.
      const safeArgs = { ...args, description: undefined };
      const classified = classify(
        tool === 'exec_command' ? 'Bash' : tool,
        tool === 'exec_command' ? { command: args.cmd } : safeArgs,
        setup
      );
      station = classified.station;
      label = classified.label;
    }

    status = event === 'PreToolUse' ? 'run' : resultStatus(raw.tool_response);
  } else if (event === 'PreModelRequest' || event === 'PostModelRequest') {
    station = 'model';
    label = 'Model request';
    status = event === 'PreModelRequest' ? 'run' : raw.status === 'failed' ? 'err' : 'ok';
  } else if (event === 'UserPromptSubmit') {
    station = 'you';
    label = 'New message';
  } else if (event === 'Stop') {
    station = 'you';
    label = 'Answer ready';
  } else if (event === 'Interrupt') {
    station = 'you';
    label = 'Interrupted';
  } else if (event === 'PermissionRequest') {
    label = `Permission requested: ${tool}`;
  } else if (event === 'SubagentStart' || event === 'SubagentStop') {
    station = 'agents';
    label = name(raw.agent_type, 48) ?? 'Subagent';
    status = event === 'SubagentStart' ? 'run' : 'ok';
  } else if (event === 'PreCompact' || event === 'PostCompact') {
    station = 'model';
    label = 'Context compaction';
    status = event === 'PreCompact' ? 'run' : 'ok';
  }

  return {
    id,
    at,
    sessionId,
    event,
    turnId: name(raw.turn_id),
    callId: name(raw.tool_use_id),
    agentId: name(raw.agent_id),
    model: name(raw.model, 80),
    station,
    label: clean(label).slice(0, 96),
    status,
  };
}

function pair(receipt: Receipt): string | undefined {
  const scope = `${receipt.turnId ?? ''}:${receipt.agentId ?? ''}`;

  switch (receipt.event) {
    case 'PreToolUse':
    case 'PostToolUse':
      return receipt.callId ? `tool:${scope}:${receipt.callId}` : undefined;
    case 'PreModelRequest':
    case 'PostModelRequest':
      return `model:${scope}`;
    case 'PreCompact':
    case 'PostCompact':
      return `compact:${scope}`;
    case 'SubagentStart':
    case 'SubagentStop':
      return receipt.agentId ? `agent:${receipt.agentId}` : undefined;
    default:
      return undefined;
  }
}

/** Deterministic reconstruction handles overlapping calls and separates sessions. */
export function boardFrom(receipts: Receipt[], sessionId: string): Board {
  const board: Board = { entries: [], counts: {}, faults: {}, agents: [] };
  const pending = new Map<string, Entry[]>();
  const turns = new Map<string, string | undefined>();

  for (const receipt of receipts
    .filter((r) => r.sessionId === sessionId)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (receipt.event === 'UserPromptSubmit') {
      board.faults = {};

      // A new main turn is evidence that an older main turn ended, even if its
      // Stop hook was lost during a plugin update. Steering within the same
      // turn and background agents must remain active.
      if (receipt.turnId) {
        for (const entry of board.entries) {
          if (
            entry.status === 'run' &&
            !entry.agentId &&
            turns.get(entry.id) &&
            turns.get(entry.id) !== receipt.turnId
          ) {
            entry.status = 'ok';
            entry.endedAt = receipt.at;
            entry.label = `${entry.label} · ended before next turn`;
          }
        }

        for (const [key, entries] of pending) {
          pending.set(
            key,
            entries.filter((entry) => entry.status === 'run')
          );
        }
      }
    }

    if (receipt.model && !receipt.agentId) {
      board.model = receipt.model;
    }

    if (receipt.event === 'SubagentStart' && receipt.agentId) {
      board.agents = [...new Set([...board.agents!, receipt.agentId])];
    }

    if (receipt.event === 'SubagentStop') {
      board.agents = board.agents!.filter((id) => id !== receipt.agentId);
    }

    const key = pair(receipt);
    const queue = key ? pending.get(key) : undefined;
    const open = receipt.status !== 'run' ? queue?.shift() : undefined;

    if (open) {
      open.status = receipt.status;
      open.endedAt = Math.max(open.startedAt, receipt.at);
    } else {
      const entry: Entry = {
        id: receipt.id,
        station: receipt.station,
        label: receipt.label,
        from: receipt.agentId
          ? 'agents'
          : receipt.event === 'UserPromptSubmit'
            ? 'inbound'
            : 'core',
        startedAt: receipt.at,
        status: receipt.status,
        ...(receipt.status !== 'run' ? { endedAt: receipt.at } : {}),
        ...(receipt.agentId ? { agentId: receipt.agentId } : {}),
        ...(receipt.event === 'Stop' ? { mark: 'done' as const } : {}),
      };
      board.entries.push(entry);
      turns.set(entry.id, receipt.turnId);
      board.counts[entry.station] = (board.counts[entry.station] ?? 0) + 1;

      if (key && receipt.status === 'run') {
        pending.set(key, [...(queue ?? []), entry]);
      }
    }

    if (receipt.status === 'err') {
      board.faults![receipt.station] = (board.faults![receipt.station] ?? 0) + 1;
    }

    if (
      receipt.event === 'Stop' ||
      receipt.event === 'Interrupt' ||
      receipt.event === 'SessionEnd' ||
      receipt.event === 'SubagentStop'
    ) {
      for (const entry of board.entries) {
        const sameTurn =
          !receipt.turnId || !turns.get(entry.id) || turns.get(entry.id) === receipt.turnId;
        const closesEntry =
          receipt.event === 'SessionEnd' ||
          (receipt.event === 'SubagentStop'
            ? !!receipt.agentId && entry.agentId === receipt.agentId
            : sameTurn && entry.agentId === receipt.agentId);

        if (entry.status === 'run' && closesEntry) {
          entry.status = 'ok';
          entry.endedAt = receipt.at;
          entry.label = `${entry.label} · ended without result`;
        }
      }

      if (receipt.event === 'SessionEnd') {
        board.agents = [];
      }

      for (const [key, entries] of pending) {
        pending.set(
          key,
          entries.filter((e) => e.status === 'run')
        );
      }
    }
  }

  board.entries = board.entries.filter(
    (e, i) => i >= board.entries.length - 160 || e.status === 'run'
  );

  return board;
}
