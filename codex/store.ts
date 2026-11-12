import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { HOOK_EVENTS, type Receipt } from './adapter';

export const MAX_RECEIPTS = 512;
export const dataDirectory = () => process.env.LOT_MAP_DATA || join(homedir(), '.codex', 'lot-map');
const sessionKey = (id: string) => createHash('sha256').update(id).digest('hex');

export async function readOptions(root = dataDirectory()): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(join(root, 'options.json'), 'utf8'));

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const allowed = [
      'language',
      'coreName',
      'memoryServers',
      'memoryCommands',
      'memorySubcommands',
      'memoryPaths',
      'memoryLabels',
      'theme',
      'background',
      'colors',
      'layout',
    ];

    return Object.fromEntries(
      allowed.filter((key) => key in value).map((key) => [key, value[key]])
    );
  } catch {
    return {};
  }
}

/** Remove only old monitor receipts, never project files. Called once per session start. */
export async function pruneSessions(root = dataDirectory(), now = Date.now()): Promise<void> {
  const directory = join(root, 'sessions');
  const names = await readdir(directory).catch(() => []);
  await Promise.all(
    names
      .filter((name) => /^[a-f0-9]{64}$/.test(name))
      .map(async (name) => {
        const path = join(directory, name);
        const info = await stat(path).catch(() => null);

        if (info?.isDirectory() && now - info.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
          await rm(path, { recursive: true, force: true });
        }
      })
  );
}

export async function saveReceipt(receipt: Receipt, root = dataDirectory()): Promise<void> {
  const directory = join(root, 'sessions', sessionKey(receipt.sessionId));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stem = `${String(receipt.at).padStart(16, '0')}-${randomUUID()}`;
  const temporary = join(directory, `${stem}.tmp`);
  await writeFile(temporary, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
  await rename(temporary, join(directory, `${stem}.json`));
  const files = (await readdir(directory)).filter((f) => f.endsWith('.json')).sort();
  await Promise.all(
    files
      .slice(0, Math.max(0, files.length - MAX_RECEIPTS))
      .map((file) => rm(join(directory, file), { force: true }))
  );
}

export async function readReceipts(sessionId: string, root = dataDirectory()): Promise<Receipt[]> {
  return readDirectory(join(root, 'sessions', sessionKey(sessionId)));
}

async function readDirectory(directory: string, limit = MAX_RECEIPTS): Promise<Receipt[]> {
  let files: string[];

  try {
    files = (await readdir(directory))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .slice(-limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const receipts = await Promise.all(
    files.map(async (file) => {
      try {
        return JSON.parse(await readFile(join(directory, file), 'utf8')) as Receipt;
      } catch {
        return null;
      } // Concurrent retention cleanup or an incomplete/corrupt record.
    })
  );

  return receipts.filter(
    (r): r is Receipt =>
      r !== null &&
      typeof r === 'object' &&
      typeof r.sessionId === 'string' &&
      typeof r.id === 'string' &&
      Number.isFinite(r.at) &&
      HOOK_EVENTS.includes(r.event) &&
      typeof r.label === 'string' &&
      [
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
      ].includes(r.station) &&
      ['run', 'ok', 'err', 'block'].includes(r.status)
  );
}

export async function listSessions(
  root = dataDirectory()
): Promise<{ id: string; updatedAt: number }[]> {
  const directory = join(root, 'sessions');
  let names: string[];

  try {
    names = (await readdir(directory)).filter((name) => /^[a-f0-9]{64}$/.test(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const candidates = await Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      const info = await stat(path).catch(() => null);

      return info?.isDirectory() ? { path, time: info.mtimeMs } : null;
    })
  );
  const recent = candidates
    .filter((c) => c !== null)
    .sort((a, b) => b.time - a.time)
    .slice(0, 32);
  const sessions = await Promise.all(
    recent.map(async ({ path }) => {
      const receipts = await readDirectory(path, 8);
      const last = receipts.sort((a, b) => b.at - a.at)[0];

      return last ? { id: last.sessionId, updatedAt: last.at } : null;
    })
  );

  return sessions.filter((s) => s !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}
