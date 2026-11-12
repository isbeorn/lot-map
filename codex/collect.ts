import { randomUUID } from 'node:crypto';

import { normalize } from './adapter';
import { pruneSessions, readOptions, saveReceipt } from './store';

// Silent, advisory, bounded input. No prompt, argument, output or transcript is stored.
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

  const receipt = normalize(
    JSON.parse(Buffer.concat(chunks).toString('utf8')),
    randomUUID(),
    Date.now(),
    await readOptions()
  );

  if (receipt) {
    await saveReceipt(receipt);

    if (receipt.event === 'SessionStart') {
      await pruneSessions();
    }
  }
} catch {
  // Monitoring failures never change hook decisions or inject model context.
}
