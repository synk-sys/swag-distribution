/**
 * Fixed-window, per-instance rate limiter. App Hosting may run several instances,
 * so the effective limit is (limit × instances); it exists to stop runaway
 * clients and scripted enumeration, not as a hard quota.
 */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  w.count++;
  return w.count <= limit;
}

export function resetRateLimits() {
  windows.clear();
}
