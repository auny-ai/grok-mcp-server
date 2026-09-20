# Security policy

This is a deploy-your-own remote MCP server: a Cloudflare Worker exposing xAI Grok tools (`x_search`, `grok_web_search`, `grok_chat`, image generation and editing, vision, video generation, structured output, reasoning). Each deployer runs their own copy on their own Cloudflare account, with their own xAI API key and their own `AUTH_SECRET`. Inbound requests to `/mcp` are gated with dual-route auth: a static `AUTH_SECRET` bearer for automation and Claude Code, and stateless HMAC OAuth 2.0/PKCE for the claude.ai connector. The gate fails closed: a 503 when `AUTH_SECRET` is unset, a 401 on a bad credential.

Design and the auth flow: `docs/ARCHITECTURE.md`. `verify.sh` is the adversarial check: it asserts an unauthenticated request is refused.

## Known limitations

- This is a deploy-your-own template, not a shared hosted service. Each deployer holds their own xAI key and their own `AUTH_SECRET`; neither ships with this repo.
- Authorization codes are stateless and signed, not stored server-side. The design cannot enforce single-use on a code without adding a Durable Object. The short code TTL is the mitigation: a replayed code has a narrow window to matter.
- Endpoints in the docs and examples are placeholders; a deployer's live URL is their own.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). That opens a private security advisory, visible only to the maintainer and to GitHub's own advisory collaborators and security managers, not the public. Please do not open a public issue for an auth bypass, a key leak, or anything that lets `/mcp` serve a request it should have refused.

You will get an acknowledgement within 7 days and a fix or a reasoned "won't fix" within 30. Only the latest release receives fixes. Credit is given in the changelog unless you ask otherwise.

## Scope

In scope: `src/`, `wrangler.jsonc`, `mcp.json`, and the auth gate. Out of scope: the xAI API itself, the Cloudflare Workers runtime, and any deployer's own key or secret material.
