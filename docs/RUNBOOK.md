# Runbook

Operational procedures for a deployed instance of grok-mcp-server. Assumes
you've already followed `AGENTS.md` for initial setup.

---

## Rotate your xAI key

1. Generate a new key at console.x.ai (do this before revoking the old one,
   so there's no gap).
2. `wrangler secret put XAI_API_KEY` and paste the new key.
3. `wrangler deploy` — Workers pick up new secret values on next deploy.
4. Revoke the old key in the xAI console.
5. Smoke-test: `AUTH_SECRET=... ./verify.sh` (this doesn't test XAI_API_KEY
   directly, so also run one real tool call, e.g. `grok_chat`, from a
   connected client).

## Rotate your optional Xquik key

Use this procedure only when `X_SEARCH_BACKEND=xquik`.

1. Create a replacement key in your Xquik account before revoking the old one.
2. Run `wrangler secret put XQUIK_API_KEY` and paste the replacement key.
3. Run `wrangler deploy`.
4. Call `x_search` once and confirm it returns structured results with
   `source: "xquik"`.
5. Revoke the old key.

## Rotate AUTH_SECRET

Rotating this invalidates **every** previously issued credential at once —
the static bearer and every OAuth access token, because both are verified
against the current secret value.

1. `printf '%s' "$(openssl rand -hex 32)" | wrangler secret put AUTH_SECRET`
2. `wrangler deploy`
3. Update the static-bearer header in every direct client config (Claude
   Code, scripts, cron jobs) with the new value.
4. Reconnect the claude.ai connector: disconnect it, then Connect again to
   redo the OAuth/PKCE handshake against the new secret.
5. Run `AUTH_SECRET=<new value> ./verify.sh` — expect `PASS`.

## Redeploy after a code change

```sh
npx wrangler deploy
```

No migration or restart step needed — the Worker is stateless. Follow with
`./verify.sh` to confirm the auth gate and tool count are unchanged.

## Reconnect a client after any auth change

Symptom: a previously working client starts getting 401s.

1. Confirm which path it uses — static bearer (Claude Code, scripts) or OAuth
   (claude.ai connector).
2. Static bearer: update the `Authorization` header with the current
   `AUTH_SECRET`.
3. OAuth: disconnect and reconnect the connector to redo the handshake and
   receive a token signed with the current secret.
4. Verify with one real tool call, not just `verify.sh` — `verify.sh` proves
   the server is healthy, not that a specific client's config is correct.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `503` on every `/mcp` request | `AUTH_SECRET` is unset | `wrangler secret put AUTH_SECRET` (see AGENTS.md step 2), then `wrangler deploy` |
| `401` with a bearer you believe is correct | Stale value after a rotation, or a copy/paste error (stray newline/whitespace) | Re-copy the secret exactly; if it was rotated, see "Reconnect a client" above |
| `verify.sh` reports `no credential ... ENDPOINT IS OPEN` | `MCP_PUBLIC=true` is set, or `AUTH_SECRET` never got set and something changed the fail-closed default | Unset `MCP_PUBLIC`, confirm `AUTH_SECRET` is set, redeploy, rerun `verify.sh` |
| `verify.sh` PKCE step fails (`B: wrong PKCE rejected` shows FAIL) | Code path bug after a local edit to `src/auth.ts` | Do not deploy; PKCE rejection is the only thing standing between a stolen `code` and a valid token |
| Tool call errors with `xAI API error 401` | `XAI_API_KEY` invalid, expired, or unset | Rotate the key (see above) |
| Tool call errors with `xAI API error 429` | Rate limited or hit an xAI usage cap | Check console.x.ai usage/billing |
| `x_search` reports an unsupported backend | `X_SEARCH_BACKEND` has an invalid value | Leave it unset for xAI, or set it to `xquik` |
| `x_search` asks for `XQUIK_API_KEY` | The Xquik route is selected without its credential | Set the key, or remove `X_SEARCH_BACKEND` to restore xAI |
| `x_search` returns an Xquik API 401 or 429 | The optional Xquik key is invalid or its account is rate limited | Rotate the key or check the Xquik account, then retry |
| Image/video tool call times out or is very slow | Normal for video (20-60s); check xAI status page if image is also slow | Retry; consider raising client-side timeout for `grok_video_generate` |
