# AGENTS.md — install contract for grok-mcp-server

Instructions for an AI agent installing this server on a new machine or for a
new LLM client. Follow in order. `mcp.json` is the machine-readable companion
to this file; if the two ever disagree, `mcp.json` wins and this file is stale.

This deploys a copy on the **installer's own** Cloudflare account, billed to
the **installer's own** xAI key. Every value below is theirs to supply — never
reuse a value you've seen elsewhere.

---

## What this is

A single-tenant MCP server wrapping xAI Grok, running as a Cloudflare Worker.
Nine tools. Stateless — no Durable Objects, no KV, no session memory.

---

## 0. Prerequisites

- Node >= 18, `npx wrangler` >= 4
- A Cloudflare account (Workers free tier is enough)
- An xAI API account with billing set up (console.x.ai) — image and video
  generation cost more than text
- `wrangler login` already completed

Stop and ask the operator if any are missing. Do not create accounts on their
behalf.

---

## 1. Install

```sh
npm install
```

---

## 2. Set secrets — the installer's own values

Prompt the operator for each value. Never write them to a file, never echo
them, never commit them. `mcp.json` carries a `how` field per secret
describing where each comes from.

```sh
wrangler secret put XAI_API_KEY
# paste your own xai-... key when prompted

printf '%s' "$(openssl rand -hex 32)" | wrangler secret put AUTH_SECRET
```

`AUTH_SECRET` is required. It gates the inbound `/mcp` endpoint (`src/auth.ts`),
dual-route: a static bearer (`Authorization: Bearer <AUTH_SECRET>`) for direct
clients like Claude Code, and OAuth/PKCE (stateless HMAC tokens, no KV) for the
claude.ai connector's one-click Connect. Both routes are backed by this one
secret, generated fresh for this install. The gate fails closed — if
`AUTH_SECRET` is unset the server returns 503 on every request, never open
access. Set it without a trailing newline (`printf '%s'`, not `echo`) and
never echo the value back. `MCP_PUBLIC=true` is a deliberate escape hatch to
run open on purpose; leave it unset otherwise.

---

## 3. Deploy

```sh
npx wrangler deploy
```

Note the deployed URL from the output, e.g.
`https://grok-mcp-server.<your-subdomain>.workers.dev`. This URL is **yours** —
it will differ from every other install of this repo.

---

## 4. Verify

```sh
AUTH_SECRET=<the secret you generated> MCP_URL=https://<your-worker-url> ./verify.sh
```

Expected:

```
A: static bearer → tools/list       ok (9 tools)
no credential                       ok (401)
bad credential                      ok (401)
oauth discovery                     ok (200)
B: OAuth/PKCE → token                ok
B: oauth token → tools/list         ok (9 tools)
B: wrong PKCE rejected              ok (invalid_grant)

PASS
```

Non-zero exit means do not proceed. The failing line names the step to
revisit — a `no credential` failure specifically means the endpoint is open
and billing your xAI account to anyone who finds the URL.

---

## 5. Register with the client

**Claude Code (local, static bearer)**

```sh
claude mcp add grok --transport http \
  https://<your-worker-url>/mcp \
  --header "Authorization: Bearer <your AUTH_SECRET>"
```

**claude.ai connector (OAuth one-click Connect)**

Add the connector by URL (`https://<your-worker-url>/mcp`) in claude.ai
connector settings and click Connect. It completes OAuth/PKCE against
`/oauth/authorize` and `/oauth/token` automatically — never put the key in the
URL as `?key=`.

Confirm each client lists 9 tools.

---

## 6. After any change to inbound auth, reconnect and prove it

Rotating or changing `AUTH_SECRET` invalidates the static bearer for direct
clients and the connector's existing session alike. After any such change:

1. Update the static-bearer header for direct clients (Claude Code, etc.) with
   the new value.
2. Reconnect the claude.ai connector (disconnect, then Connect again to redo
   OAuth).
3. Prove it with one real tool call (e.g. `grok_chat`) from each client, not
   just `verify.sh`.

---

## Gotchas

- **Image and video generation cost more than text.** Check xAI pricing before
  wiring high-volume automation to `grok_image_generate` or
  `grok_video_generate`.
- **Video generation is slow.** 20-60 seconds is normal, not a hang.
- **No worker name conflicts across accounts.** Each Cloudflare account has
  its own namespace, so keeping the default `grok-mcp-server` name in
  `wrangler.jsonc` is safe.
