// Default: every caller is "system" (the guard is not what the Momentum suites test).
// REAL_GUARD=1 (or globalThis.__REAL_GUARD) delegates to the REAL supabase/functions/_shared/require-admin-or-system.ts.
export async function requireAdminOrSystem(req, opts) {
  if (!globalThis.__REAL_GUARD) return { ok: true, kind: "system" };
  const m = await import(globalThis.__REAL_GUARD_URL);
  return m.requireAdminOrSystem(req, opts);
}
export function timingSafeEqualStr(a, b) { const e = new TextEncoder(), x = e.encode(a), y = e.encode(b); let d = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0); return d === 0; }
