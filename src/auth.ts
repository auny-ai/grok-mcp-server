// Inbound auth for the /mcp endpoint: self-contained OAuth 2.0 + PKCE, plus a
// static-secret bearer path. No external OAuth library, no KV — access tokens
// are stateless, HMAC-signed, and expire.
//
// NOTE: this is DISTINCT from the outbound Bearer sent to xAI in index.ts
// (that one authenticates this server to api.x.ai). This module gates who
// may call this server.
//
// Two credential paths converge on the same /mcp handler:
//   A. Static AUTH_SECRET as a Bearer token — for headless automation and
//      Claude Code (configs that can set an Authorization header). No
//      interactive step, so scheduled/routine sessions are never blocked.
//   B. Full OAuth 2.0 / PKCE — for the claude.ai connector, which authenticates
//      by handshake (one Connect click plus the CONNECT_SECRET you chose) and
//      receives a signed, expiring token, never the raw secret and never a key
//      in a URL.

import type { Env } from "./index";
import { LEDGER_NAME } from "./ledger-name.ts";

/** Thrown when a signing secret is absent. Callers turn it into a controlled
 *  503, never an uncaught exception. */
class MissingSecretError extends Error {
  constructor() {
    super("AUTH_SECRET is not configured");
    this.name = "MissingSecretError";
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// Authorization codes are stateless and signed, so this server cannot enforce
// single-use without adding a Durable Object (see SECURITY.md, "Known
// limitations"). A short TTL is the mitigation: the exchange happens in
// seconds, so two minutes is generous for a real client and leaves almost no
// window for a replayed code.
const CODE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Domain-separates code signatures from access-token signatures so one can
// never be presented as the other. Bump the version if the code format changes.
const CODE_SIGNING_DOMAIN = "grok-mcp-server/authorization-code/v1.";

// Hosts permitted to receive an authorization code. Without this allowlist the
// consent flow hands the code to whatever host the caller names in
// redirect_uri, which turns one Connect click into a token for an attacker.
// Add your own client's host here if you use something other than claude.ai.
const ALLOWED_REDIRECT_HOSTS = new Set([
  "claude.ai",
  "www.claude.ai",
  "claude.com",
  "www.claude.com",
]);

/** Constant-time compare that cannot throw. A comparison that raises turns a
 *  would-be 401 into a 500 and leaks which branch was taken. Bytes, not strings. */
function safeEq(a: unknown, b: unknown): boolean {
  try {
    const enc = new TextEncoder();
    const x = enc.encode(String(a));
    const y = enc.encode(String(b));
    if (x.length !== y.length) return false; // length is not secret
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
  } catch {
    return false; // refuse rather than surface an error
  }
}

/** Escape for HTML text and double-quoted attribute contexts. Every value
 *  reaching the consent page is attacker-supplied. */
function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Exact-host allowlist for redirect_uri. Checked at BOTH /oauth/authorize and
 *  /oauth/confirm: validating only at authorize is useless, since confirm is a
 *  plain POST an attacker can call directly. */
function redirectUriAllowed(redirectUri: string): boolean {
  if (!redirectUri) return false;
  let parsed: URL;
  try { parsed = new URL(redirectUri); } catch { return false; }
  if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
    return true; // local MCP clients during development
  }
  if (parsed.protocol !== "https:") return false;
  return ALLOWED_REDIRECT_HOSTS.has(parsed.hostname);
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** UTF-8 safe. btoa() throws on any code point above 0xFF, so JSON carrying a
 *  non-Latin1 character (an emoji in a path, a full-width hostname) would crash
 *  code issuance after the allowlist had already accepted it. */
function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/** Inverse of b64urlJson. Returns null rather than throwing on malformed
 *  input, so a hand-crafted code can never turn a 400 into a 500. */
function parseB64urlJson(payload: string): Record<string, unknown> | null {
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}

async function hmacSign(secret: string, data: string): Promise<string> {
  // Guard, not a cast. importKey throws DataError on a zero-length key, which
  // would escape as a 500 from an unauthenticated request.
  if (typeof secret !== "string" || secret.length === 0) {
    throw new MissingSecretError();
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

async function issueAccessToken(secret: string): Promise<string> {
  const payload = b64urlJson({ v: 1, scope: "grok", iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS });
  const sig = await hmacSign(secret, `grk1.${payload}`);
  return `grk1.${payload}.${sig}`;
}

async function verifyAccessToken(secret: string, token: string): Promise<boolean> {
  if (!token.startsWith("grk1.")) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [, payload, sig] = parts;
  const expected = await hmacSign(secret, `grk1.${payload}`);
  if (!safeEq(sig, expected)) return false;
  const decoded = parseB64urlJson(payload);
  if (decoded === null) return false;
  return typeof decoded.exp === "number" && decoded.exp > Date.now();
}

// Path A (static secret) OR Path B (a valid signed token) is accepted on /mcp.
async function isValidBearer(env: Env, presented: string): Promise<boolean> {
  if (!presented || !env.AUTH_SECRET) return false;
  if (safeEq(presented, env.AUTH_SECRET)) return true;
  return verifyAccessToken(env.AUTH_SECRET, presented);
}

interface CodeClaims {
  redirectUri: string;
  codeChallenge: string;
  iat: number;
}

async function issueCode(secret: string, redirectUri: string, codeChallenge: string): Promise<string> {
  const payload = b64urlJson({ redirectUri, codeChallenge, iat: Date.now() });
  const sig = await hmacSign(secret, CODE_SIGNING_DOMAIN + payload);
  return `${payload}.${sig}`;
}

/** Returns the SIGNED claims, not just the challenge. The redirect URI is
 *  signed into the code so the token endpoint has something to bind against:
 *  the allowlist controls where a code can be SENT, this controls where it can
 *  be REDEEMED, and both are needed. */
async function verifyCode(secret: string, code: string): Promise<CodeClaims | null> {
  const parts = code.split(".");
  if (parts.length < 2) return null;
  const sig = parts.pop() as string;
  const payload = parts.join(".");
  const expected = await hmacSign(secret, CODE_SIGNING_DOMAIN + payload);
  if (!safeEq(sig, expected)) return null;
  const decoded = parseB64urlJson(payload);
  if (decoded === null) return null;
  if (typeof decoded.iat !== "number" || !Number.isFinite(decoded.iat)) return null;
  if (Date.now() - decoded.iat > CODE_TTL_MS) return null;
  // PKCE is not optional, see issueCode.
  if (typeof decoded.codeChallenge !== "string" || decoded.codeChallenge === "") return null;
  if (typeof decoded.redirectUri !== "string") return null;
  return {
    redirectUri: decoded.redirectUri,
    codeChallenge: decoded.codeChallenge,
    iat: decoded.iat,
  };
}

/** Single-use enforcement via the CodeLedger Durable Object.
 *
 *  Returns null when the code may be spent, or a Response to return instead:
 *    503 — binding missing, or the RPC threw. Fail closed: a ledger we cannot
 *          reach is a ledger we cannot trust.
 *    400 — the ledger returned anything other than strictly `true`
 *          (already redeemed, or a misbehaving consume). */
async function claimCode(env: Env, codeId: string, expiresAt: number): Promise<Response | null> {
  const json = (status: number, error: string, desc: string) =>
    Response.json({ error, error_description: desc },
      { status, headers: { "Access-Control-Allow-Origin": "*" } });

  const ledger = env.CODE_LEDGER;
  if (!ledger) {
    return json(503, "server_misconfigured",
      "CODE_LEDGER binding missing; cannot enforce single-use codes");
  }
  let firstUse: unknown;
  try {
    const stub = ledger.get(ledger.idFromName(LEDGER_NAME));
    firstUse = await stub.consume(codeId, expiresAt);
  } catch {
    return json(503, "temporarily_unavailable", "cannot confirm the code is unused");
  }
  if (firstUse !== true) {
    return json(400, "invalid_grant", "Authorization code has already been redeemed");
  }
  return null;
}

function oauthDiscovery(base: string): Response {
  return Response.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["grok"],
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}

async function handleOAuthRegister(request: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    // JSON `null`, a bare string or a number all parse fine and then throw on
    // property access. Only take an object.
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {}
  return Response.json({
    client_id: "grok-mcp-server-client",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body.redirect_uris ?? [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...(body.client_name ? { client_name: body.client_name } : {}),
  }, { status: 201, headers: { "Access-Control-Allow-Origin": "*" } });
}

function handleOAuthAuthorize(url: URL, env: Env, error = ""): Response {
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const clientName = url.searchParams.get("client_name") ?? "Claude";

  // Fail closed: with no CONNECT_SECRET there is no way to authenticate the
  // owner, so the connector flow is disabled rather than left open. Without
  // this, anyone who reaches /oauth/authorize can mint a year-long token that
  // spends YOUR xAI account.
  if (!env.CONNECT_SECRET) {
    return new Response(
      "Connector flow disabled: CONNECT_SECRET is not configured. " +
        "Set it with `wrangler secret put CONNECT_SECRET`. " +
        "The static-bearer path (Authorization: Bearer <AUTH_SECRET>) is unaffected.",
      { status: 503 }
    );
  }

  // Refuse before rendering anything if the code could never be delivered.
  if (!redirectUriAllowed(redirectUri)) {
    return new Response("redirect_uri is not an allowed host.", { status: 400 });
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connect to Grok MCP</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    background:#0f0f11;color:#e8e8f0;display:flex;align-items:center;
    justify-content:center;min-height:100vh;padding:24px}
  .card{background:#1a1a20;border:1px solid #2a2a35;border-radius:16px;
    padding:40px;max-width:420px;width:100%;text-align:center}
  .mark{font-size:48px;margin-bottom:16px}
  h1{font-size:22px;font-weight:600;margin-bottom:8px}
  p{color:#888;font-size:14px;line-height:1.6;margin-bottom:24px}
  .client{color:#ff6b35;font-weight:500}
  form{display:flex;flex-direction:column;gap:12px}
  button[type=submit]{background:#ff6b35;color:#fff;border:none;border-radius:10px;
    padding:14px;font-size:15px;font-weight:600;cursor:pointer}
  button[type=submit]:hover{background:#e05a2b}
  .deny{background:transparent;color:#666;border:1px solid #2a2a35;
    border-radius:10px;padding:12px;font-size:14px;cursor:pointer}
  input[type=password]{background:#0f0f11;color:#e8e8f0;border:1px solid #2a2a35;
    border-radius:10px;padding:14px;font-size:15px;width:100%}
  .err{color:#ff6b6b;font-size:13px;margin-bottom:12px}
</style></head>
<body><div class="card">
  <div class="mark">🤖</div>
  <h1>Connect to Grok MCP</h1>
  <p><span class="client">${esc(clientName)}</span> is requesting access to this Grok MCP server (search, chat, image, and video tools backed by xAI).</p>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
  <form method="POST" action="/oauth/confirm">
    <input type="password" name="connect_key" placeholder="Connect key" autocomplete="off" required>
    <input type="hidden" name="redirect_uri" value="${esc(encodeURIComponent(redirectUri))}">
    <input type="hidden" name="state" value="${esc(encodeURIComponent(state))}">
    <input type="hidden" name="code_challenge" value="${esc(encodeURIComponent(codeChallenge))}">
    <button type="submit">✓ Connect</button>
    <button type="button" class="deny" onclick="window.close()">Cancel</button>
  </form>
</div></body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handleOAuthConfirm(request: Request, env: Env): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const connectKey = params.get("connect_key") ?? "";

  // Fail closed, same as authorize.
  if (!env.CONNECT_SECRET) {
    return new Response("Connector flow disabled: CONNECT_SECRET is not configured.", { status: 503 });
  }

  // THE GATE, and it comes FIRST. Nothing that can throw runs ahead of it:
  // decodeURIComponent raises on a lone '%', which would hand an unauthenticated
  // caller a 500 if the decoding sat above this check.
  if (!safeEq(connectKey, env.CONNECT_SECRET)) {
    return new Response("Invalid connect key.", { status: 401 });
  }

  // Now decode, and refuse malformed input rather than throwing.
  let redirectUri: string, state: string, codeChallenge: string;
  try {
    redirectUri = decodeURIComponent(params.get("redirect_uri") ?? "");
    state = decodeURIComponent(params.get("state") ?? "");
    codeChallenge = decodeURIComponent(params.get("code_challenge") ?? "");
  } catch {
    return new Response("Malformed percent-encoding in request.", { status: 400 });
  }

  // Re-validate here, not just at authorize: this endpoint is directly callable.
  if (!redirectUriAllowed(redirectUri)) {
    return new Response("redirect_uri is not an allowed host.", { status: 400 });
  }

  // PKCE is mandatory. Refusing here means no code without a challenge ever
  // exists, so the token endpoint has no caller-selectable path around PKCE.
  if (!codeChallenge) {
    return new Response("code_challenge is required (PKCE S256).", { status: 400 });
  }

  const code = await issueCode(env.AUTH_SECRET as string, redirectUri, codeChallenge);
  const dest = new URL(redirectUri);
  // Do NOT encodeURIComponent these. URLSearchParams.set percent-encodes on
  // serialization, so pre-encoding double-encodes: a state of `a b+c` comes
  // back to the client as `a%20b%2Bc`.
  dest.searchParams.set("code", code);
  if (state) dest.searchParams.set("state", state);
  return Response.redirect(dest.toString(), 302);
}

async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
  let code = "", redirectUri = "", codeVerifier = "";
  const ct = request.headers.get("Content-Type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await request.text());
    code = params.get("code") ?? "";
    redirectUri = params.get("redirect_uri") ?? "";
    codeVerifier = params.get("code_verifier") ?? "";
  } else {
    try {
      const parsed = await request.json();
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const body = parsed as Record<string, unknown>;
        // Cast, not check, was the bug: `{"code":42}` reached code.split().
        code = typeof body.code === "string" ? body.code : "";
        redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";
        codeVerifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
      }
    } catch {}
  }

  const bad = (desc: string, err = "invalid_grant") =>
    Response.json({ error: err, error_description: desc },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });

  const claims = await verifyCode(env.AUTH_SECRET as string, code);
  if (claims === null) return bad("Invalid or expired code");

  // Bind the code to the destination it was issued for. The redirect allowlist
  // controls where a code can be SENT; this controls where it can be REDEEMED.
  // Without both, holding a code is enough to redeem it from anywhere.
  if (!safeEq(redirectUri, claims.redirectUri)) {
    return bad("redirect_uri does not match the authorization request");
  }

  // PKCE, mandatory. verifyCode rejects a code with no challenge, so there is
  // no caller-selectable path around this.
  if (!codeVerifier) return bad("code_verifier required", "invalid_request");
  const hashed = await sha256b64url(codeVerifier);
  if (!safeEq(hashed, claims.codeChallenge)) return bad("PKCE verification failed");

  // Single use, claimed LAST: after signature, expiry, redirect binding and
  // PKCE have all passed. A failed check above must not burn a code that was
  // otherwise still good.
  const codeId = await sha256b64url(code); // never store the code itself
  const spent = await claimCode(env, codeId, claims.iat + CODE_TTL_MS + 60_000);
  if (spent) return spent;

  return Response.json({
    access_token: await issueAccessToken(env.AUTH_SECRET as string),
    token_type: "Bearer",
    expires_in: Math.floor(TOKEN_TTL_MS / 1000),
    scope: "grok",
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}

/**
 * Routes every auth/OAuth path. Returns a Response to short-circuit, or null to
 * let the caller continue to its own routes.
 */
export async function handleOAuthRoutes(request: Request, url: URL, env: Env): Promise<Response | null> {
  try {
    return await routeOAuth(request, url, env);
  } catch (err) {
    if (err instanceof MissingSecretError) {
      return new Response(
        "Refusing to serve: AUTH_SECRET is not configured. Set it with " +
          "`wrangler secret put AUTH_SECRET`.",
        { status: 503 }
      );
    }
    throw err;
  }
}

async function routeOAuth(request: Request, url: URL, env: Env): Promise<Response | null> {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    return oauthDiscovery(url.origin);
  }
  if (url.pathname === "/oauth/register" && request.method === "POST") {
    return handleOAuthRegister(request);
  }
  if (url.pathname === "/oauth/authorize" && request.method === "GET") {
    return handleOAuthAuthorize(url, env);
  }
  if (url.pathname === "/oauth/confirm" && request.method === "POST") {
    return handleOAuthConfirm(request, env);
  }
  if (url.pathname === "/oauth/token" && request.method === "POST") {
    return handleOAuthToken(request, env);
  }
  return null;
}

/** Gate for /mcp. Returns null when access is allowed, or a Response to return. */
export async function gateMcp(request: Request, env: Env): Promise<Response | null> {
  // Fail CLOSED. No secret configured => refuse, never serve openly.
  if (!env.AUTH_SECRET) {
    if (env.MCP_PUBLIC === "true") return null; // deliberate, explicit opt-out
    return new Response(
      "Refusing to serve: AUTH_SECRET is not configured. Set it with " +
        "`wrangler secret put AUTH_SECRET`, or set MCP_PUBLIC=\"true\" to run " +
        "this endpoint unauthenticated on purpose.",
      { status: 503 }
    );
  }
  const presented = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let allowed: boolean;
  try {
    allowed = await isValidBearer(env, presented);
  } catch (err) {
    if (err instanceof MissingSecretError) {
      return new Response("Refusing to serve: AUTH_SECRET is not configured.", { status: 503 });
    }
    throw err;
  }
  if (!allowed) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

// Internals exported for the regression suite in test/auth.test.ts only.
// Nothing in src/ imports these; the Worker entrypoints above are the real API.
export const __testing = {
  esc,
  safeEq,
  redirectUriAllowed,
  issueCode,
  verifyCode,
  sha256b64url,
  handleOAuthAuthorize,
  handleOAuthConfirm,
  handleOAuthToken,
  handleOAuthRegister,
  b64urlJson,
  parseB64urlJson,
  CODE_TTL_MS,
};
