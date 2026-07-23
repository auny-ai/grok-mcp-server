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
//      by handshake (one Connect click) and receives a signed, expiring token,
//      never the raw secret and never a key in a URL.

import type { Env } from "./index";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlJson(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}

async function hmacSign(secret: string, data: string): Promise<string> {
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
  if (sig !== expected) return false;
  try {
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof decoded.exp === "number" && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

// Path A (static secret) OR Path B (a valid signed token) is accepted on /mcp.
async function isValidBearer(env: Env, presented: string): Promise<boolean> {
  if (!presented || !env.AUTH_SECRET) return false;
  if (presented === env.AUTH_SECRET) return true;
  return verifyAccessToken(env.AUTH_SECRET, presented);
}

async function issueCode(secret: string, redirectUri: string, codeChallenge: string): Promise<string> {
  const payload = b64urlJson({ redirectUri, codeChallenge, iat: Date.now() });
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

async function verifyCode(secret: string, code: string): Promise<string | null> {
  const parts = code.split(".");
  if (parts.length < 2) return null;
  const sig = parts.pop() as string;
  const payload = parts.join(".");
  const expected = await hmacSign(secret, payload);
  if (sig !== expected) return null;
  try {
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (Date.now() - decoded.iat > 10 * 60 * 1000) return null; // 10-min code
    return decoded.codeChallenge ?? "";
  } catch {
    return null;
  }
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
  try { body = await request.json() as Record<string, unknown>; } catch {}
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

function handleOAuthAuthorize(url: URL): Response {
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const clientName = url.searchParams.get("client_name") ?? "Claude";

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
  p{color:#888;font-size:14px;line-height:1.6;margin-bottom:32px}
  .client{color:#ff6b35;font-weight:500}
  form{display:flex;flex-direction:column;gap:12px}
  button[type=submit]{background:#ff6b35;color:#fff;border:none;border-radius:10px;
    padding:14px;font-size:15px;font-weight:600;cursor:pointer}
  button[type=submit]:hover{background:#e05a2b}
  .deny{background:transparent;color:#666;border:1px solid #2a2a35;
    border-radius:10px;padding:12px;font-size:14px;cursor:pointer}
</style></head>
<body><div class="card">
  <div class="mark">🤖</div>
  <h1>Connect to Grok MCP</h1>
  <p><span class="client">${clientName}</span> is requesting access to this Grok MCP server (search, chat, image, and video tools backed by xAI).</p>
  <form method="POST" action="/oauth/confirm">
    <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirectUri)}">
    <input type="hidden" name="state" value="${encodeURIComponent(state)}">
    <input type="hidden" name="code_challenge" value="${encodeURIComponent(codeChallenge)}">
    <button type="submit">✓ Connect</button>
    <button type="button" class="deny" onclick="window.close()">Cancel</button>
  </form>
</div></body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handleOAuthConfirm(request: Request, env: Env): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const redirectUri = decodeURIComponent(params.get("redirect_uri") ?? "");
  const state = decodeURIComponent(params.get("state") ?? "");
  const codeChallenge = decodeURIComponent(params.get("code_challenge") ?? "");

  const code = await issueCode(env.AUTH_SECRET as string, redirectUri, codeChallenge);
  const dest = new URL(redirectUri);
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
      const body = await request.json() as Record<string, string>;
      code = body.code ?? "";
      redirectUri = body.redirect_uri ?? "";
      codeVerifier = body.code_verifier ?? "";
    } catch {}
  }

  const codeChallenge = await verifyCode(env.AUTH_SECRET as string, code);
  if (codeChallenge === null) {
    return Response.json(
      { error: "invalid_grant", error_description: "Invalid or expired code" },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Real PKCE: if authorize carried a code_challenge, the exchange MUST present
  // the matching code_verifier (S256).
  if (codeChallenge) {
    if (!codeVerifier) {
      return Response.json(
        { error: "invalid_request", error_description: "code_verifier required" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }
    const hashed = await sha256b64url(codeVerifier);
    if (hashed !== codeChallenge) {
      return Response.json(
        { error: "invalid_grant", error_description: "PKCE verification failed" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }
  }

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
    return handleOAuthAuthorize(url);
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
  if (!(await isValidBearer(env, presented))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
