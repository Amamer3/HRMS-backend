const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StateEntry {
  createdAt: number;
}

const states = new Map<string, StateEntry>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of states) {
    if (now - entry.createdAt > STATE_TTL_MS) states.delete(key);
  }
}

export function storeOAuthState(state: string): void {
  purgeExpired();
  states.set(state, { createdAt: Date.now() });
}

/** Returns true and removes the state if it exists and has not expired. */
export function consumeOAuthState(state: string): boolean {
  const entry = states.get(state);
  if (!entry) return false;
  states.delete(state);
  return Date.now() - entry.createdAt <= STATE_TTL_MS;
}
