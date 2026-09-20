// Regression suite for the auth fixes backported from the hosted server.
// One test per vulnerability that shipped in v1.2.0, so a reintroduction goes red.
//
// Run: npm test   (node's built-in runner, TypeScript stripped natively on 22+)

import { test } from "node:test";
import assert from "node:assert/strict";
import { __testing, gateMcp, handleOAuthRoutes as handleOAuthRoutesSafe } from "../src/auth.ts";

const {
  esc, safeEq, redirectUriAllowed, issueCode, verifyCode, sha256b64url,
  handleOAuthAuthorize, handleOAuthConfirm, CODE_TTL_MS,
} = __testing;

// Fixtures are generated per run, never written into the file. Nothing here is
// a credential; the point is only that two distinct unguessable strings exist.
const SECRET = `fixture-${crypto.randomUUID()}`;
const CONNECT = `fixture-${crypto.randomUUID()}`;
const OTHER = `fixture-${crypto.randomUUID()}`;
const env: any = { AUTH_SECRET: SECRET, CONNECT_SECRET: CONNECT };
const OK_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

// ── 1. Reflected XSS on the consent page ─────────────────────
test("esc neutralizes a script payload", () => {
  assert.equal(esc('<script>alert(1)</script>'), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(esc('" onload="x'), "&quot; onload=&quot;x");
  assert.equal(esc("it's"), "it&#x27;s");
});

test("consent page renders no raw client_name payload", async () => {
  const url = new URL(
    `https://w.example/oauth/authorize?redirect_uri=${encodeURIComponent(OK_REDIRECT)}` +
    `&code_challenge=abc&client_name=${encodeURIComponent("<script>alert(document.domain)</script>")}`
  );
  const html = await handleOAuthAuthorize(url, env).text();
  assert.ok(!html.includes("<script>alert"), "raw script tag reached the page");
  assert.ok(html.includes("&lt;script&gt;alert"), "payload was not escaped into the page at all");
});

// ── 2. Open redirect: no redirect_uri allowlist ──────────────
test("redirectUriAllowed accepts only allowlisted hosts", () => {
  assert.equal(redirectUriAllowed(OK_REDIRECT), true);
  assert.equal(redirectUriAllowed("https://claude.com/cb"), true);
  assert.equal(redirectUriAllowed("https://evil.example/cb"), false);
  assert.equal(redirectUriAllowed("https://claude.ai.evil.example/cb"), false);
  assert.equal(redirectUriAllowed("http://claude.ai/cb"), false, "plain http must be refused");
  assert.equal(redirectUriAllowed("http://localhost:6274/cb"), true, "local dev client");
  assert.equal(redirectUriAllowed("not a url"), false);
  assert.equal(redirectUriAllowed(""), false);
});

test("authorize refuses a disallowed redirect_uri before rendering", () => {
  const url = new URL("https://w.example/oauth/authorize?redirect_uri=https%3A%2F%2Fevil.example%2Fcb&code_challenge=abc");
  assert.equal(handleOAuthAuthorize(url, env).status, 400);
});

test("confirm re-checks the redirect_uri, since it is directly callable", async () => {
  const body = new URLSearchParams({
    connect_key: CONNECT,
    redirect_uri: encodeURIComponent("https://evil.example/cb"),
    code_challenge: "abc",
  });
  const req = new Request("https://w.example/oauth/confirm", { method: "POST", body });
  assert.equal((await handleOAuthConfirm(req, env)).status, 400);
});

// ── 3. No owner authentication on the consent page (AUN-454) ──
test("connector flow is disabled without CONNECT_SECRET", () => {
  const url = new URL(`https://w.example/oauth/authorize?redirect_uri=${encodeURIComponent(OK_REDIRECT)}&code_challenge=abc`);
  assert.equal(handleOAuthAuthorize(url, { AUTH_SECRET: SECRET } as any).status, 503);
});

test("confirm rejects a wrong connect key", async () => {
  const body = new URLSearchParams({
    connect_key: OTHER,
    redirect_uri: encodeURIComponent(OK_REDIRECT),
    code_challenge: "abc",
  });
  const req = new Request("https://w.example/oauth/confirm", { method: "POST", body });
  assert.equal((await handleOAuthConfirm(req, env)).status, 401);
});

test("the connect-key gate runs before any decoding that can throw", async () => {
  // A lone '%' makes decodeURIComponent raise. If decoding sat above the gate,
  // an unauthenticated caller would get a 500 instead of a 401.
  const body = new URLSearchParams({ connect_key: OTHER, redirect_uri: "%", code_challenge: "%" });
  const req = new Request("https://w.example/oauth/confirm", { method: "POST", body });
  assert.equal((await handleOAuthConfirm(req, env)).status, 401);
});

// ── 4. Code not bound to its redirect_uri ────────────────────
test("verifyCode returns the signed redirect_uri for the token endpoint to bind", async () => {
  const challenge = await sha256b64url("verifier-abc");
  const code = await issueCode(SECRET, OK_REDIRECT, challenge);
  const claims = await verifyCode(SECRET, code);
  assert.equal(claims?.redirectUri, OK_REDIRECT);
  assert.equal(claims?.codeChallenge, challenge);
});

// ── 5. PKCE was skippable ────────────────────────────────────
test("a code with no PKCE challenge never verifies", async () => {
  const code = await issueCode(SECRET, OK_REDIRECT, "");
  assert.equal(await verifyCode(SECRET, code), null);
});

// ── 6. Signature and domain separation ───────────────────────
test("a code signed with another secret is refused", async () => {
  const code = await issueCode(OTHER, OK_REDIRECT, "abc");
  assert.equal(await verifyCode(SECRET, code), null);
});

test("a tampered payload is refused", async () => {
  const code = await issueCode(SECRET, OK_REDIRECT, "abc");
  const [payload, sig] = code.split(".");
  const evil = btoa(JSON.stringify({ redirectUri: "https://evil.example/cb", codeChallenge: "abc", iat: Date.now() }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  assert.equal(await verifyCode(SECRET, `${evil}.${sig}`), null);
  assert.notEqual(payload, evil);
});

// ── 7. Replay window ─────────────────────────────────────────
test("codes expire, and the TTL stays short because they are not single-use", async () => {
  assert.ok(CODE_TTL_MS <= 5 * 60 * 1000, "stateless codes need a short TTL");
  const stale = Date.now() - CODE_TTL_MS - 1000;
  const payload = btoa(JSON.stringify({ redirectUri: OK_REDIRECT, codeChallenge: "abc", iat: stale }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  // Re-sign it honestly so only expiry can be what rejects it.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode("grok-mcp-server/authorization-code/v1." + payload));
  const sig = btoa(String.fromCharCode(...new Uint8Array(raw)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  assert.equal(await verifyCode(SECRET, `${payload}.${sig}`), null);
});

// ── 8. Timing-unsafe comparison ──────────────────────────────
test("safeEq compares correctly and never throws", () => {
  assert.equal(safeEq("abc", "abc"), true);
  assert.equal(safeEq("abc", "abd"), false);
  assert.equal(safeEq("abc", "abcd"), false);
  assert.equal(safeEq("", ""), true);
  assert.equal(safeEq(undefined, "abc"), false);
  assert.equal(safeEq(null, undefined), false);
});

// ── 9. /mcp still fails closed ───────────────────────────────
test("gateMcp refuses with no AUTH_SECRET, and honours the explicit opt-out", async () => {
  const req = new Request("https://w.example/mcp");
  assert.equal((await gateMcp(req, {} as any))?.status, 503);
  assert.equal(await gateMcp(req, { MCP_PUBLIC: "true" } as any), null);
});

test("gateMcp rejects a wrong bearer and accepts the static secret", async () => {
  const bad = new Request("https://w.example/mcp", { headers: { Authorization: `Bearer ${OTHER}` } });
  assert.equal((await gateMcp(bad, env))?.status, 401);
  const good = new Request("https://w.example/mcp", { headers: { Authorization: `Bearer ${SECRET}` } });
  assert.equal(await gateMcp(good, env), null);
});

// ═══════════════════════════════════════════════════════════════
// Findings from the 2026-09-20 Codex audit (ROUND 1). One test per
// finding, so each stays fixed.
// ═══════════════════════════════════════════════════════════════

const { handleOAuthToken, handleOAuthRegister, b64urlJson, parseB64urlJson } = __testing;

/** Minimal stand-in for the CodeLedger Durable Object namespace. */
function fakeLedger() {
  const seen = new Set<string>();
  return {
    calls: 0,
    idFromName(_n: string) { return { name: _n }; },
    get(_id: unknown) {
      return {
        consume: async (codeId: string, expiresAt: number) => {
          if (Date.now() > expiresAt) return false;
          if (seen.has(codeId)) return false;
          seen.add(codeId);
          return true;
        },
      };
    },
  };
}

function tokenEnv() {
  return { AUTH_SECRET: SECRET, CONNECT_SECRET: CONNECT, CODE_LEDGER: fakeLedger() } as any;
}

async function exchange(env: any, code: string, redirectUri: string, verifier: string) {
  const body = new URLSearchParams({ code, redirect_uri: redirectUri, code_verifier: verifier });
  const req = new Request("https://w.example/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return handleOAuthToken(req, env);
}

// ── F5. The redirect binding is ENFORCED at /oauth/token ─────
// The earlier test only asserted verifyCode returns the claim. Codex removed
// the token endpoint's comparison in memory and all 16 tests stayed green.
test("token endpoint refuses a code redeemed against a different redirect_uri", async () => {
  const verifier = "verifier-f5";
  const code = await issueCode(SECRET, OK_REDIRECT, await sha256b64url(verifier));
  const res = await exchange(tokenEnv(), code, "https://claude.ai/some-other-callback", verifier);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error_description, "redirect_uri does not match the authorization request");
});

test("token endpoint issues a token when everything matches", async () => {
  const verifier = "verifier-happy";
  const code = await issueCode(SECRET, OK_REDIRECT, await sha256b64url(verifier));
  const res = await exchange(tokenEnv(), code, OK_REDIRECT, verifier);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.token_type, "Bearer");
  const req = new Request("https://w.example/mcp", { headers: { Authorization: `Bearer ${body.access_token}` } });
  assert.equal(await gateMcp(req, { AUTH_SECRET: SECRET } as any), null, "issued token must open /mcp");
});

test("token endpoint enforces PKCE at the exchange, not only in the claim", async () => {
  const code = await issueCode(SECRET, OK_REDIRECT, await sha256b64url("right"));
  const res = await exchange(tokenEnv(), code, OK_REDIRECT, "wrong");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error_description, "PKCE verification failed");
});

// ── F1. Replay: a redeemed code cannot be spent twice ────────
test("a code is single-use, so a replayed exchange is refused", async () => {
  const env = tokenEnv();
  const verifier = "verifier-replay";
  const code = await issueCode(SECRET, OK_REDIRECT, await sha256b64url(verifier));
  const first = await exchange(env, code, OK_REDIRECT, verifier);
  assert.equal(first.status, 200, "first redemption must succeed");
  const second = await exchange(env, code, OK_REDIRECT, verifier);
  assert.equal(second.status, 400, "replay must be refused");
  assert.equal((await second.json()).error_description, "Authorization code has already been redeemed");
});

test("the ledger is claimed last, so a failed check does not burn a good code", async () => {
  const env = tokenEnv();
  const verifier = "verifier-order";
  const code = await issueCode(SECRET, OK_REDIRECT, await sha256b64url(verifier));
  // Burn an attempt on a wrong verifier first.
  assert.equal((await exchange(env, code, OK_REDIRECT, "wrong")).status, 400);
  // The code must still be spendable.
  assert.equal((await exchange(env, code, OK_REDIRECT, verifier)).status, 200);
});

test("no ledger binding fails closed rather than minting a token", async () => {
  const verifier = "verifier-noledger";
  const code = await issueCode(SECRET, OK_REDIRECT, await sha256b64url(verifier));
  const res = await exchange({ AUTH_SECRET: SECRET } as any, code, OK_REDIRECT, verifier);
  assert.equal(res.status, 503);
});

test("a throwing ledger fails closed", async () => {
  const env: any = {
    AUTH_SECRET: SECRET,
    CODE_LEDGER: { idFromName: () => ({}), get: () => ({ consume: async () => { throw new Error("down"); } }) },
  };
  const verifier = "verifier-throw";
  const code = await issueCode(SECRET, OK_REDIRECT, await sha256b64url(verifier));
  assert.equal((await exchange(env, code, OK_REDIRECT, verifier)).status, 503);
});

// ── F2. Malformed JSON returns a controlled error, never a throw ──
test("non-string fields in a JSON token request do not throw", async () => {
  for (const payload of ['{"code":42}', "null", '"a string"', "[1,2,3]", '{"code":{"a":1}}']) {
    const req = new Request("https://w.example/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: payload,
    });
    const res = await handleOAuthToken(req, tokenEnv());
    assert.equal(res.status, 400, `payload ${payload} should be a controlled 400`);
  }
});

test("/oauth/register survives a null or scalar JSON body", async () => {
  for (const payload of ["null", '"x"', "7", "[]"]) {
    const req = new Request("https://w.example/oauth/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: payload,
    });
    const res = await handleOAuthRegister(req);
    assert.equal(res.status, 201, `payload ${payload} should still register`);
  }
});

// ── F3. Non-Latin1 values round-trip instead of crashing btoa ──
test("base64url round-trips non-Latin1 JSON", () => {
  const obj = { redirectUri: "https://claude.ai/😀", note: "ｆｕｌｌｗｉｄｔｈ" };
  assert.deepEqual(parseB64urlJson(b64urlJson(obj)), obj);
});

test("an emoji path in an allowlisted redirect issues a code instead of throwing", async () => {
  const emoji = "https://claude.ai/😀";
  assert.equal(redirectUriAllowed(emoji), true, "allowlist accepts it, so issuance must not crash");
  const code = await issueCode(SECRET, emoji, "abc");
  assert.equal((await verifyCode(SECRET, code))?.redirectUri, emoji);
});

test("parseB64urlJson returns null on garbage rather than throwing", () => {
  for (const bad of ["!!!!", "", "e30", "bm90LWpzb24"]) {
    assert.doesNotThrow(() => parseB64urlJson(bad));
  }
});

// ── F4. A missing AUTH_SECRET is a 503, never an uncaught throw ──
test("confirm with CONNECT_SECRET set but AUTH_SECRET missing returns 503", async () => {
  const body = new URLSearchParams({
    connect_key: CONNECT,
    redirect_uri: encodeURIComponent(OK_REDIRECT),
    code_challenge: "abc",
  });
  const req = new Request("https://w.example/oauth/confirm", { method: "POST", body });
  const url = new URL("https://w.example/oauth/confirm");
  const res = await handleOAuthRoutesSafe(req, url, { CONNECT_SECRET: CONNECT } as any);
  assert.equal(res?.status, 503);
});

test("an unauthenticated token POST on a deploy with no AUTH_SECRET returns 503", async () => {
  const req = new Request("https://w.example/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"code":"x.y"}',
  });
  const url = new URL("https://w.example/oauth/token");
  const res = await handleOAuthRoutesSafe(req, url, {} as any);
  assert.equal(res?.status, 503);
});
