// The single Durable Object every code redemption routes to. Lives in its own
// module with no imports so `src/auth.ts` can use it without pulling in
// `cloudflare:workers`, which only exists inside the Workers runtime.
// Redemptions are a handful per device ever, so one serialization point costs
// nothing measurable.
export const LEDGER_NAME = "authorization-codes";
