import { AsyncLocalStorage } from "node:async_hooks";

const health = new AsyncLocalStorage<{ unavailable: boolean }>();
export function markSessionUnavailable() { const current = health.getStore(); if (current) current.unavailable = true; }

export async function readSessionHealth<T>(read: () => Promise<T>) {
  return health.run({ unavailable: false }, async () => {
    const session = await read();
    return { session, unavailable: health.getStore()!.unavailable };
  });
}
