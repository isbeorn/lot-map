import { randomUUID } from 'node:crypto';

import { normalize } from './adapter';
import { bindSession } from './bind-session';
import { pruneSessions, readOptions, saveReceipt } from './store';

// Bounded input. Only the open tool receives a session binding; collection stays silent.
try {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of process.stdin) {
    size += chunk.length;

    if (size > 16 * 1024 * 1024) {
      process.exit(0);
    }

    chunks.push(chunk);
  }

  const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const binding = bindSession(input);

  if (binding) {
    process.stdout.write(JSON.stringify(binding));
  }

  const receipt = normalize(input, randomUUID(), Date.now(), await readOptions());

  if (receipt) {
    await saveReceipt(receipt);

    if (receipt.event === 'SessionStart') {
      await pruneSessions();
    }
  }
} catch {
  // Monitoring failures never block work or inject model context.
}
