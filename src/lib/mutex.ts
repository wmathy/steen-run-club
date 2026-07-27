/**
 * Per-key async mutex for serializing concurrent work (e.g. chat saves).
 * In-memory only — single process. Fine for local MVP / single Node instance.
 */

const locks = new Map<string, Promise<void>>();

export async function withUserLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = prev.then(() => gate);
  locks.set(userId, chain);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(userId) === chain) {
      locks.delete(userId);
    }
  }
}
