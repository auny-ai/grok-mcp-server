# Architecture

## Overview

One Cloudflare Worker, one file that matters (`src/index.ts`) plus one auth
module (`src/auth.ts`). No database, no KV, no Durable Objects, no session
state. Every `/mcp` request builds a fresh `McpServer` instance scoped to that
request's `env`.

```
MCP client (Claude Code / claude.ai connector / any MCP client)
        │
        │  Streamable HTTP MCP, Bearer auth (static secret or OAuth token)
        ▼
Cloudflare Worker (this repo)
        │
        │  gateMcp() — fail-closed inbound auth check
        ▼
buildServer(env) — fresh McpServer per request
        ├── 8 Grok tools + default x_search
        │     Bearer XAI_API_KEY → xAI Grok API (api.x.ai/v1)
        └── optional x_search route
              x-api-key: XQUIK_API_KEY → Xquik public tweet search
```

## Request routing (`src/index.ts` fetch handler)

Requests are checked in this order:

1. **OAuth routes** (`handleOAuthRoutes`) — `/.well-known/oauth-authorization-server`,
   `/oauth/register`, `/oauth/authorize`, `/oauth/confirm`, `/oauth/token`.
   Unauthenticated by design: these routes issue a credential, they don't
   consume one.
2. **`/`** — health/info JSON (tool list, version).
3. **`/mcp`** — gated by `gateMcp()` first, then handled by the MCP SDK's
   Streamable HTTP transport.
4. Anything else — 404.

## Inbound auth (`src/auth.ts`)

Two credential paths both terminate at the same `/mcp` handler:

- **Path A — static bearer.** `Authorization: Bearer <AUTH_SECRET>`. No
  handshake, no expiry beyond the secret's own rotation. Meant for headless
  clients that can set a header once: Claude Code, cron jobs, scripts.
- **Path B — OAuth 2.0 + PKCE.** Meant for the claude.ai connector's one-click
  Connect flow. `/oauth/authorize` renders a consent page; `/oauth/confirm`
  issues a short-lived authorization code (HMAC-signed, 10-minute expiry);
  `/oauth/token` verifies the PKCE `code_verifier` (S256) against the
  `code_challenge` from `/authorize` and, if it matches, issues a long-lived
  access token (HMAC-signed with `AUTH_SECRET`, 1-year expiry, `grk1.` prefix).

Both paths converge on `gateMcp()`, which:

- Returns **503** if `AUTH_SECRET` is unset and `MCP_PUBLIC` is not `"true"` —
  fails closed, never serves openly by accident.
- Returns **401** if the presented bearer is neither the raw `AUTH_SECRET` nor
  a validly signed, unexpired token.
- Otherwise returns `null`, letting the request through to `buildServer(env)`.

No KV, no database: tokens and authorization codes are stateless and
self-verifying via HMAC-SHA256 keyed on `AUTH_SECRET`. Revoking access means
rotating `AUTH_SECRET`, which invalidates every previously issued token at
once.

## Outbound calls

Eight Grok-only tools and the default `x_search` route use
`xaiFetch(env, path, body)`. It attaches `Authorization: Bearer
${env.XAI_API_KEY}` and posts JSON to `api.x.ai/v1<path>`.

When `X_SEARCH_BACKEND=xquik`, only `x_search` uses `xquikSearch`. That helper
sends a bounded GET request to the public Xquik tweet-search endpoint with
`XQUIK_API_KEY`, a 20-result limit, and the requested query. Invalid backend
values or missing Xquik credentials fail the tool instead of falling back.

## Statelessness

There is deliberately no persistence layer. Each `/mcp` request:

1. Passes `gateMcp()`.
2. Builds a brand-new `McpServer` via `buildServer(env)`.
3. Executes exactly one tool call against xAI or the selected Xquik search route.
4. Returns the result.

This means restarts, redeploys, and concurrent requests never interact with
each other. It also means there's no session or conversation memory across
tool calls — each call is a fresh request to xAI.
