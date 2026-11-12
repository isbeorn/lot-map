import { App } from '@modelcontextprotocol/ext-apps';

import { describeNow, drawLanes, drawMap, foldRows, setupFrom } from '../hooks/map';
import type { Board } from '../types';
import { activityView } from './activity';

interface Snapshot {
  sessions: { id: string; updatedAt: number }[];
  sessionId: string | null;
  board: Board;
  options: Record<string, unknown>;
  receiptCount: number;
  observedAt: number;
  lastEventAt?: number | null;
}
const app = new App({ name: 'Lot Map', version: '0.4.1' });
document.body.innerHTML = `<style>
:root { color-scheme: light dark; font: 13px system-ui, sans-serif; }
* { box-sizing: border-box; } body { margin: 0; background: #0a0f16; color: #d7e3ed; }
header { display:flex; gap:8px; align-items:center; padding:12px 14px; border-bottom:1px solid #253141; }
header strong { margin-right:auto; } button, select { font:inherit; color:inherit; background:#172230; border:1px solid #354252; border-radius:5px; padding:6px 9px; }
button { cursor:pointer; } .session { display:flex; gap:8px; align-items:center; padding:10px 14px 0; }
select { min-width:0; flex:1; } #status, #action, #empty { padding:8px 14px; margin:0; color:#a7bbcc; }
#status { font-size:12px; } #map svg, #lanes svg { width:100%; height:auto; display:block; }
#map, #lanes { max-width:660px; margin:auto; } #feed { list-style:none; padding:0 14px 14px; margin:0; }
#feed li { font:12px ui-monospace,monospace; padding:4px 0; overflow-wrap:anywhere; }
#feed li[data-status=err], #feed li[data-status=block] { color:#f47777; }
[hidden] { display:none !important; }
@media(prefers-color-scheme:light) { body { background:#f4f6f8; color:#25313e; } button,select { background:#fff; } #status,#action,#empty { color:#536779; } }
</style><header><strong>Lot Map</strong><button id="expand">Open panel</button><button id="pause">Pause</button></header>
<label class="session">Session <select id="session"><option value="">Waiting for activity</option></select></label>
<p id="status" role="status">Connecting…</p>
<p id="empty">No captured activity yet. Review and trust Lot Map’s hooks, then start a Codex turn.</p>
<div id="map" aria-label="Activity map"></div><div id="lanes" aria-label="Activity timeline"></div>
<p id="action"></p><ol id="feed"></ol>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const selector = element<HTMLSelectElement>('session');
let snapshot: Snapshot | undefined;
let setup = setupFrom({ coreName: 'CODEX' });
let selected: string | undefined;
let paused = false;
let stopped = false;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let visualKey = '';
let lastDraw = 0;
let requestGeneration = 0;
let connected = true;

function render(data: Snapshot) {
  if (!data?.board || !Array.isArray(data.sessions)) {
    return;
  }

  snapshot = data;
  selected ??= data.sessionId ?? undefined;
  const sessions = [...data.sessions];

  if (selected && !sessions.some((s) => s.id === selected)) {
    sessions.unshift({ id: selected, updatedAt: 0 });
  }

  selector.replaceChildren(
    ...(sessions.length
      ? sessions.map((s) => {
          const label = `${s.id.slice(0, 8)}…${s.id.slice(-8)}${s.updatedAt ? ' · ' + new Date(s.updatedAt).toLocaleTimeString() : ''}`;

          return new Option(label, s.id, false, s.id === selected);
        })
      : [new Option('Waiting for activity', '')])
  );
  setup = setupFrom({ coreName: 'CODEX', ...data.options });
  const lastEventAt =
    data.lastEventAt ?? data.sessions.find((s) => s.id === data.sessionId)?.updatedAt ?? null;
  const activity = activityView(data.board, lastEventAt, Date.now(), connected);
  const key = JSON.stringify([data.sessionId, data.board, data.options, activity.frozen]);

  // The shared SVG already animates itself with SMIL. Replacing it every frame
  // restarts that timeline and briefly exposes the unanimated circles.
  if (!paused && (key !== visualKey || Date.now() - lastDraw >= 5000)) {
    const now = activity.renderAt;
    element('map').innerHTML = drawMap(data.board, now, setup);
    element('lanes').innerHTML = drawLanes(data.board, now, setup);

    for (const svg of document.querySelectorAll<SVGSVGElement>('#map svg, #lanes svg')) {
      // Renderer offsets are relative to this snapshot, not the HTML document's age.
      svg.setCurrentTime(0);

      if (activity.frozen) {
        svg.pauseAnimations();
      }
    }

    visualKey = key;
    lastDraw = Date.now();
  }

  element('empty').hidden = data.receiptCount > 0;
  element('status').textContent =
    `${paused ? 'Paused' : activity.label} · ${data.receiptCount} recent hook events${lastEventAt ? ' · last event ' + new Date(lastEventAt).toLocaleTimeString() : ''}`;
  element('action').textContent = activity.frozen
    ? 'Last known activity is frozen. No completion was received; check that Lot Map’s hooks are enabled and trusted.'
    : describeNow(data.board, setup.t);
  element('feed').replaceChildren(
    ...foldRows(data.board.entries.slice(-80))
      .slice(-16)
      .reverse()
      .map(({ entry, times }) => {
        const li = document.createElement('li');
        const unknown = activity.frozen && entry.status === 'run';
        li.dataset.status = unknown ? 'unknown' : entry.status;
        li.textContent = `${unknown ? '?' : entry.status === 'run' ? '●' : entry.status === 'err' || entry.status === 'block' ? '✕' : '·'} ${setup.t.stations[entry.station]} · ${entry.label}${unknown ? ' · completion unconfirmed' : ''}${times > 1 ? ` +${times - 1}` : ''}`;

        return li;
      })
  );
}

app.ontoolresult = (result) => {
  if (result.structuredContent) {
    render(result.structuredContent as unknown as Snapshot);
  }
};

async function poll() {
  const generation = requestGeneration;

  if (!paused && !stopped) {
    try {
      const result = await app.callServerTool({
        name: 'lot_map_snapshot',
        arguments: selected ? { session_id: selected } : {},
      });

      if (result.isError) {
        throw new Error('Activity could not be read');
      }

      if (generation === requestGeneration && !paused && !stopped) {
        connected = true;
        render(result.structuredContent as unknown as Snapshot);
      }
    } catch {
      if (generation === requestGeneration && !paused && !stopped) {
        connected = false;

        if (snapshot) {
          render(snapshot);
        } else {
          element('status').textContent = 'Connection interrupted · retrying';
        }
      }
    }
  }

  if (!stopped) {
    pollTimer = setTimeout(poll, 750);
  }
}

selector.addEventListener('change', () => {
  selected = selector.value || undefined;
  requestGeneration++;
});
element('pause').addEventListener('click', () => {
  paused = !paused;
  requestGeneration++;
  element('pause').textContent = paused ? 'Resume' : 'Pause';

  for (const svg of document.querySelectorAll<SVGSVGElement>('#map svg, #lanes svg')) {
    if (paused) {
      svg.pauseAnimations();
    } else {
      svg.unpauseAnimations();
    }
  }

  if (!paused) {
    visualKey = '';
  }

  if (snapshot) {
    render(snapshot);
  }
});

async function expand() {
  try {
    await app.requestDisplayMode({ mode: 'fullscreen' });
  } catch {
    element('status').textContent = 'This host kept the map inline';
  }
}

element('expand').addEventListener('click', expand);
addEventListener('pagehide', () => {
  stopped = true;
  clearTimeout(pollTimer);
});
await app.connect();
void expand();
void poll();
