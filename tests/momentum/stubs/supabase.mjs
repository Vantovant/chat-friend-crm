// createClient() returns a PostgREST-like client backed by the REAL local Postgres (globalThis.__TEST_POOL).
export function createClient() { return globalThis.__TEST_MAKE_CLIENT(); }
