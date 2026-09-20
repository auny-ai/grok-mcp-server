# AUDIT BRIEF — grok-mcp-server auth backport (AUN-1241)

## Task bundle

**Purpose.** Adversarially audit the OAuth/auth backport in `src/auth.ts` before
it is pushed to a PUBLIC GitHub repo that strangers fork and deploy. The file
gates an MCP endpoint and mints year-long access tokens, so a hole costs every
deployer their xAI spend. Linear: AUN-1241. Standing rule: Claude writes,
Codex attacks, Claude verifies and fixes.

**SCOPE, READ THIS FIRST.** Audit EXACTLY these three files as they stand in the
WORKING TREE right now, committed or not:
- `src/auth.ts` — the primary target, nearly all of it is new
- `src/index.ts` — only the `Env` interface and the model constants changed
- `test/auth.test.ts`

IGNORE the repo-hygiene scaffold entirely: `SECURITY.md`, `CODE_OF_CONDUCT.md`,
`CONTRIBUTING.md`, `CHANGELOG.md`, `llms.txt`, `.editorconfig`, `.gitattributes`,
`AUDIT_BRIEF.md`, and everything under `.github/`. A previous run spent itself on
those and explicitly excluded the auth code, which is the only part that matters.
Review the files on disk, not git history and not any commit.

**Denied actions.** Absence from this list is not permission.
- Do NOT edit, write, create, move or delete any file. Read-only, entirely.
- Do NOT run `git` in any mutating form: no commit, push, checkout or stash.
- Do NOT deploy, run `wrangler deploy`, or call any live endpoint.
- Do NOT install packages or modify `package.json` / `package-lock.json`.
- Do NOT hand me fixes as applied diffs. Claude owns every fix.
- Do NOT report a finding you have not traced to specific lines in these files.

**Report contract.** Per finding: file and line, the exact input or sequence that
triggers it, the concrete consequence, and your confidence. Separate CONFIRMED
(traced end to end) from SUSPECTED. Answer each of the six challenged design
decisions explicitly, including the ones where my reasoning holds. End with what
you did NOT check and why, so I know the blind spots.

## Runtime

Cloudflare Worker, TypeScript, ES modules, no Node builtins at runtime.
`compatibility_date` 2026-09-01, `nodejs_compat` on. `src/index.ts` exports a
`fetch` handler that calls `handleOAuthRoutes()` first, then `gateMcp()` on
`/mcp`, then the MCP Streamable HTTP handler from the `agents` package. No
Durable Objects, no KV, no D1. Stateless by design.

## What this repo is

A PUBLIC deploy-your-own template. Each person clones it and deploys to THEIR
Cloudflare account with THEIR xAI key and THEIR secrets. No shared multi-tenant
deployment. A compromise costs the individual deployer their xAI spend, not a
central operator.

## What changed and why

This file was the unpatched twin of a private hosted server already fixed for
two incidents. This backports those fixes:

1. `esc()` on every attacker-controlled value reaching the consent page HTML.
   Before, `${clientName}` from `?client_name=` went in raw. Reflected XSS,
   reproduced with a `<script>` payload.
2. `ALLOWED_REDIRECT_HOSTS` + `redirectUriAllowed()`, checked at BOTH
   `/oauth/authorize` and `/oauth/confirm`. Before, no allowlist at all, so
   consent handed a live authorization code to any host the caller named.
   Both points, because `/oauth/confirm` is a plain POST an attacker can call
   directly, skipping `/oauth/authorize`.
3. `safeEq(redirectUri, claims.redirectUri)` at `/oauth/token`. The redirect URI
   was always signed into the code but the old `verifyCode` threw it away, so
   the token endpoint had nothing to bind against.
4. `CONNECT_SECRET`: owner authentication on the consent page, fail-closed (503
   when unset). Before, the consent page authenticated nobody, so anyone
   reaching `/oauth/authorize` could click Connect and mint a year-long token
   spending the deployer's xAI key.
5. `safeEq()` constant-time comparison replacing `===` / `!==` on the static
   secret and on both HMAC signature checks.
6. PKCE mandatory with no caller-selectable bypass: `issueCode` is reached only
   after `/oauth/confirm` rejects an empty `code_challenge`, and `verifyCode`
   returns null for a code carrying no challenge.
7. `CODE_SIGNING_DOMAIN` prefix so an access token can never be presented as an
   authorization code or the reverse.
8. `CODE_TTL_MS` cut from 10 minutes to 2 minutes.

## Design decisions I want challenged, with my reasoning

- **No single-use enforcement on authorization codes.** The private hosted twin
  uses a Durable Object ledger (its incident was concurrent redemptions of one
  code each minting a token). I deliberately did NOT port it: this repo
  advertises "Stateless. No Durable Objects", its wrangler config already carries
  a migration DELETING its old DO class, and adding a DO changes the deploy story
  for every forker. My judgment: once the redirect allowlist is in, an attacker
  who can read a code off an allowlisted redirect already holds the resulting
  token, so replay adds close to zero marginal risk. TTL cut to 2 minutes as the
  mitigation, limitation documented. **Attack this reasoning.** Is there a path
  where a code leaks WITHOUT the token also leaking, making replay meaningfully
  worse than I assumed?
- **`ALLOWED_REDIRECT_HOSTS` hardcoded in source, not env.** I chose source
  because a forker editing a const and redeploying is harder to get wrong than a
  runtime-parsed env var, and a misparsed env var fails open. Right call?
- **`http://localhost` and `http://127.0.0.1` allowed over plain http**, for
  local MCP inspector clients. Any way this becomes an attack on a deployed
  Worker (DNS rebinding, a redirect chain, a client that follows it)?
- **Access token TTL still 1 year, stateless, no revocation.** Unchanged.
  Rotating `AUTH_SECRET` invalidates every token at once and is the only
  revocation. Acceptable for a single-owner deploy?
- **`Access-Control-Allow-Origin: *` on `/oauth/token` and discovery**, with
  `token_endpoint_auth_method: "none"` (public client), required by the MCP
  connector spec. With PKCE mandatory and the redirect bound, is there still a
  cross-origin path worth worrying about?
- **`/oauth/register` stores nothing**, returns a fixed `client_id`, echoes back
  whatever `redirect_uris` the caller sent. Dynamic client registration is
  effectively a no-op. Does that matter now that the real control is the host
  allowlist rather than registered redirect URIs?

## Already verified, do not re-report as unknown

- `npx tsc --noEmit` exits 0.
- `npx wrangler deploy --dry-run` exits 0.
- `npm audit` reports 0 vulnerabilities (was 19, 10 high, before the dep bump).
- 16 regression tests in `test/auth.test.ts` pass.
- Those tests were mutation-checked: reintroducing the XSS fails 1 test,
  reintroducing the open redirect fails 3, removing the CONNECT_SECRET gate
  fails 2, and restoring the file returns all 16 to green.

## What I want attacked

1. Any path to `/mcp` that does not present a valid credential.
2. Any way to obtain an access token without knowing `CONNECT_SECRET`.
3. Any way to get an authorization code delivered to a host not in the
   allowlist, including URL parsing tricks against `redirectUriAllowed`
   (userinfo `@`, backslashes, unicode/IDN homographs, trailing dots, uppercase
   hosts, embedded credentials, `javascript:`, `data:`).
4. Anything in the consent page HTML that escapes its context despite `esc()`,
   including the `value="${esc(encodeURIComponent(...))}"` double-treatment.
5. Any input that turns a 400/401 into a 500, or makes a handler throw before
   its gate runs.
6. Type-level holes: `env.AUTH_SECRET as string` casts, optional fields read as
   required.
7. Whether the fixes are actually reachable, or whether an earlier branch
   short-circuits one of them.

---

# ROUND 1 — 2026-09-20

Auditor: Codex, `gpt-6-astra`, effort `xhigh`, 315s. Verdict: "changes needed
before push." Every finding below was reproduced independently before it was
acted on. One codex round only; the harness verifies the fixes.

| # | Finding | Severity | Reproduced | Disposition |
|---|---------|----------|-----------|-------------|
| 1 | Authorization codes are replayable inside the TTL. A request-only trace exposes `code` + `redirect_uri` + `code_verifier` without exposing the token response, so a reader of that trace can redeem again without `CONNECT_SECRET`. | medium | yes, by inspection of `handleOAuthToken` | **FIXED.** Ported the `CodeLedger` Durable Object after all (`src/code-ledger.ts`, `src/ledger-name.ts`, wrangler `v3` migration, `CODE_LEDGER` binding). Claimed LAST, after signature, expiry, redirect binding and PKCE, so a failed check never burns a good code. Fails closed when the binding is missing or the RPC throws. |
| 2 | `{"code":42}` on `/oauth/token` reaches `code.split()` and throws `TypeError`. JSON `null` on `/oauth/register` throws on property access. Both unauthenticated. | low | yes, `TypeError code.split is not a function` and `Cannot read properties of null` | **FIXED.** Both handlers now check `typeof` per field instead of casting, and only accept a non-array object body. |
| 3 | `btoa()` throws `InvalidCharacterError` on any code point above 0xFF, so an allowlisted redirect carrying an emoji path or a full-width hostname passes validation and then crashes code issuance. | low | yes, `DOMException Invalid character`; `https://ｃｌａｕｄｅ.ai/cb` normalizes to `claude.ai` and then crashes | **FIXED.** `b64urlJson` encodes through `TextEncoder` and the new `parseB64urlJson` decodes through `TextDecoder`, returning null on garbage rather than throwing. |
| 4 | With `CONNECT_SECRET` set and `AUTH_SECRET` absent, HMAC key import throws `DataError`. The `as string` casts guard nothing at runtime. | low | yes, `DOMException Zero-length key is not supported` | **FIXED.** `hmacSign` raises a typed `MissingSecretError`; `handleOAuthRoutes` and `gateMcp` catch it and return a controlled 503. |
| 5 | The redirect-binding test asserted the returned claims, not enforcement at `/oauth/token`. Codex removed the token endpoint's comparison in memory and all 16 tests stayed green. | coverage gap | yes, reproduced as mutant A below | **FIXED.** Added tests that drive `handleOAuthToken` end to end. Mutant A now fails. |

## Design decisions, after the challenge

- **Single-use codes.** My reasoning was wrong and I changed the decision. I had
  assumed a leaked code implies a leaked token. Codex named the case where it
  does not: logging that captures requests but not responses. The Durable Object
  is now in, and the "Stateless. No Durable Objects." claim has been corrected in
  `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md` and `SECURITY.md` rather than
  left standing as a false claim.
- **Source allowlist.** Held. Codex agreed the constant is reasonable and
  correctly noted my "an env var fails open" justification was unnecessary. Its
  real point, that the list permits every path, query and port on each host, is
  now stated in `SECURITY.md` so a deployer adding a host knows what they grant.
- **Plain-HTTP loopback.** Held. Codex tested userinfo, backslash, IDN,
  trailing-dot and numeric-IP variants and none escaped the destination boundary.
- **Year-long tokens.** Held, and now documented in `SECURITY.md` as an explicit
  exposure decision with `AUTH_SECRET` rotation as the only revocation, which
  Codex confirmed works.
- **Wildcard CORS.** Held. No independent bypass found. Its one real consequence,
  making replay browser-reachable, is removed by fix 1.
- **No-op registration.** Held. Not a gate bypass; the host allowlist is the
  control, and the consent page is owner-authenticated.

## Verification after the fixes

- `npx tsc --noEmit` exits 0.
- `npx wrangler deploy --dry-run` exits 0 and reports the `CODE_LEDGER` binding.
- `npm audit` reports 0 vulnerabilities.
- 30 regression tests pass, up from 16.
- Mutation-checked, each reintroduction goes red and restoring returns to green
  with the file byte-identical:
  - remove the redirect binding at `/oauth/token` (the exact mutation that
    stayed green before) → 1 fail
  - remove the single-use claim → 3 fails
  - revert to raw `btoa` → 2 fails
  - revert the JSON type guards → 1 fail
  - reintroduce the XSS → 1 fail
  - reintroduce the open redirect → 3 fails
  - remove the `CONNECT_SECRET` gate → 2 fails

## Not fixed, on purpose

- Codex's own "not checked" list stands: no live endpoint was exercised, no
  workerd timing or memory testing, and a synthetic body-read failure escaping
  before the connect-key comparison was not network-triggered. A body-read
  failure yields a 500 with no authorization consequence, so it is logged here
  rather than guarded.
