import type { Board } from '../types';

export const EVENT_FRESHNESS_MS = 30_000;

/** A successful poll proves the server is reachable, not that hooks still arrive. */
export function activityView(
  board: Board,
  lastEventAt: number | null,
  now: number,
  connected = true
) {
  const running = board.entries.some((entry) => entry.status === 'run');
  const state = !connected
    ? 'disconnected'
    : lastEventAt === null
      ? 'empty'
      : running && now - lastEventAt >= EVENT_FRESHNESS_MS
        ? 'unconfirmed'
        : running
          ? 'active'
          : 'idle';

  return {
    state,
    frozen: state === 'unconfirmed' || state === 'disconnected',
    renderAt: state === 'unconfirmed' || state === 'disconnected' ? (lastEventAt ?? now) : now,
    label: {
      disconnected: 'Disconnected · activity status unknown',
      empty: 'Waiting for hook events',
      unconfirmed: 'No recent hook events · activity status unknown',
      active: 'Activity observed',
      idle: 'Idle',
    }[state],
  };
}
