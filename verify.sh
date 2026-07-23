#!/usr/bin/env bash
# Adversarial health check for grok-mcp-server. Proves BOTH auth paths work
# and, crucially, that an unauthenticated request is REFUSED. An open endpoint
# here bills your xAI account, so "open" is a hard failure, never a warning.
#
#   AUTH_SECRET=... ./verify.sh
#   MCP_URL=https://your-worker.your-subdomain.workers.dev AUTH_SECRET=... ./verify.sh
#
# The secret is read from the environment on purpose. Never hardcode it — this
# file is committed.

set -uo pipefail

URL="${MCP_URL:-https://<your-worker>.<your-subdomain>.workers.dev}"
SECRET="${AUTH_SECRET:-}"
EXPECTED_TOOLS="${EXPECTED_TOOLS:-9}"
fail=0
p(){ printf '%-38s %s\n' "$1" "$2"; }

if [ -z "$SECRET" ]; then
  echo "AUTH_SECRET is not set. Export it and re-run." >&2
  exit 2
fi

count_tools() {
  # $1 = bearer token. Stateless transport: tools/list needs no initialize and
  # no session id. Response is SSE, hence the sed.
  curl -s -m 25 -X POST "$URL/mcp" \
    -H "authorization: Bearer $1" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
    | sed -n 's/^data: //p' \
    | python3 -c 'import json,sys
try: print(len(json.load(sys.stdin)["result"]["tools"]))
except Exception: print(0)' 2>/dev/null
}

http() { curl -s -m 15 -o /dev/null -w '%{http_code}' "$@"; }

# ── Path A: static AUTH_SECRET bearer (headless automation, Claude Code) ───────
n=$(count_tools "$SECRET")
if [ "${n:-0}" -eq "$EXPECTED_TOOLS" ]; then p "A: static bearer → tools/list" "ok ($n tools)"
else p "A: static bearer" "FAIL (got $n, expected $EXPECTED_TOOLS)"; fail=1; fi

# ── Auth gate: no request should ever reach tools/list unauthenticated ────────
c=$(http -X POST "$URL/mcp" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
if [ "$c" = "401" ]; then p "no credential" "ok (401)"
else p "no credential" "FAIL ($c — ENDPOINT IS OPEN)"; fail=1; fi

c=$(http -X POST "$URL/mcp" -H 'authorization: Bearer wrong' -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
if [ "$c" = "401" ]; then p "bad credential" "ok (401)"
else p "bad credential" "FAIL ($c, expected 401)"; fail=1; fi

# ── Path B: full OAuth 2.0 / PKCE (the claude.ai connector) ────────────────────
c=$(http "$URL/.well-known/oauth-authorization-server")
if [ "$c" = "200" ]; then p "oauth discovery" "ok (200)"
else p "oauth discovery" "FAIL ($c)"; fail=1; fi

VER=$(openssl rand -hex 32)
CH=$(printf '%s' "$VER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')
LOC=$(curl -s -m 15 -o /dev/null -w '%{redirect_url}' -X POST "$URL/oauth/confirm" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "state=xyz" --data-urlencode "code_challenge=$CH")
CODE=$(printf '%s' "$LOC" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
TOK=$(curl -s -m 15 -X POST "$URL/oauth/token" -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "code_verifier=$VER" \
  | python3 -c 'import json,sys
try: print(json.load(sys.stdin)["access_token"])
except Exception: print("")' 2>/dev/null)
if [ -n "$TOK" ]; then p "B: OAuth/PKCE → token" "ok"
else p "B: token exchange" "FAIL"; fail=1; fi

n=$(count_tools "$TOK")
if [ "${n:-0}" -eq "$EXPECTED_TOOLS" ]; then p "B: oauth token → tools/list" "ok ($n tools)"
else p "B: oauth token" "FAIL (got $n)"; fail=1; fi

# PKCE must reject a mismatched verifier — else the flow is theater.
err=$(curl -s -m 15 -X POST "$URL/oauth/token" -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "code_verifier=WRONG" \
  | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("error","none"))
except Exception: print("none")' 2>/dev/null)
if [ "$err" != "none" ]; then p "B: wrong PKCE rejected" "ok ($err)"
else p "B: PKCE negative" "FAIL (mismatched verifier accepted!)"; fail=1; fi

echo
[ "$fail" -eq 0 ] && echo "PASS" || echo "FAIL"
exit "$fail"
