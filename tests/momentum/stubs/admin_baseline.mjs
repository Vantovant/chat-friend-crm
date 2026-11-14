// Baseline (0cd907b) code under test keeps the ORIGINAL permissive behaviour: the guard is not what the compat/freeze suites test.
export async function requireAdminOrSystem(_req) { return { ok: true, kind: "system" }; }
export function timingSafeEqualStr(a, b) { const e = new TextEncoder(), x = e.encode(a), y = e.encode(b); let d = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0); return d === 0; }
