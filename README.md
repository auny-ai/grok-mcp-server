# grok-mcp-server

A remote MCP server that gives any Claude (or any MCP-compatible AI) access to xAI Grok's full surface area — live X (Twitter) search, web search, chat, image generation, vision, image editing, video generation, structured outputs, and reasoning — from anywhere. Your laptop, your phone, an automated routine running while you sleep.

Whether you're a developer building agents, an automation tinkerer wiring up workflows, or a creator who wants real-time data inside Claude — this is the same install.

Hosted on your own Cloudflare account. 4 commands. Stateless. **9 tools.**

Built as part of [auny-ai/claude-os](https://github.com/auny-ai/claude-os) — a multi-AI operating system being built in public. 🧡

---

## What it does

Nine tools. Eight always use xAI. `x_search` uses xAI by default and can use Xquik as an optional structured X/Twitter backend.

### Search + chat

#### `x_search` — Real-time X (Twitter) data

Searches X via xAI's native `x_search` backend by default. Operators can select Xquik for structured public post results without changing the MCP tool contract.

Supports the full X advanced search operator set: `min_faves:N`, `min_retweets:N`, `filter:blue_verified`, `filter:verified`, `from:user`, `lang:en`, `since:YYYY-MM-DD`, and the rest.

#### `grok_web_search` — Live web search with current information

General web search via Grok, with results synthesized into a coherent answer plus sources. Updated continuously — not subject to a model knowledge cutoff.

#### `grok_chat` — Grok as a model, not just a search tool

Plain text completion with Grok directly. Optional system prompt and model override. Useful when you want Grok's reasoning style or voice — not Claude's — for a specific output.

### Vision + media

#### `grok_image_generate` — Text-to-image generation

Generate images from a text prompt using Grok Imagine (Quality Mode). Returns image URL(s). Good for mockups, social cards, thumbnails, brand visuals, and A/B variants. Up to 4 variations per call.

#### `grok_image_understand` — Multimodal vision

Pass an image URL and a question — get analysis back. Useful for screenshot debugging, content audits, alt-text generation, design feedback, and visual triage.

#### `grok_image_edit` — Text-prompt image editing

Pass an existing image URL and a description of the change — get an edited image back. Useful for iterating on brand visuals, generating color/style variants, and remixing existing assets.

#### `grok_video_generate` — Text-to-video / image-to-video

Generate short videos (up to 10 seconds, 720p) using Grok Imagine. Supports text-only prompts and image-to-video (start from a still). Returns the video URL. Note: video generation can take 20-60 seconds.

### Structured outputs + reasoning

#### `grok_structured_output` — JSON-schema-enforced responses

Pass a prompt and a JSON Schema describing the expected structure. Returns parsed JSON matching the schema. Useful for reliable agent pipelines, data extraction from text, and ETL workflows where you need consistent output shape.

#### `grok_reasoning` — Deep analysis mode

Use Grok's reasoning mode for complex problems. Slower than `grok_chat` but produces more rigorous output. Effort level adjustable (`low`, `medium`, `high`). Good for strategy questions, multi-step analysis, debate prep, and technical reviews.

---

## Use cases

This is a general-purpose Grok wrapper that any MCP client can hit. The use cases stretch as far as Grok's capabilities themselves.

### For developers

- **Build agents that need real-time data.** Most AI agents are blind to the last 24 hours. This gives any MCP-compatible agent live X + web search as a primitive.
- **Multi-model orchestration.** Claude as orchestrator, Grok as worker — cheaper, faster fan-out for tasks where Claude's reasoning isn't needed but recency or specific tone is.
- **Live research inside Claude Code.** When debugging a library, pulling current GitHub issues or recent docs without leaving your terminal.
- **Cross-model evaluation.** Pipe the same prompt to both models from inside Claude. Compare outputs in one workflow.
- **Replace web-scraping infra.** If you have brittle Puppeteer/Playwright setups pulling X data, this replaces them with a single MCP call. xAI handles the auth, rate limits, and rendering.
- **Reliable data extraction with `grok_structured_output`.** Define a schema once, get consistent JSON back. Drop the regex parsing.
- **Programmatic asset generation.** Spin up test mockups, design variants, or visual placeholders mid-pipeline with `grok_image_generate`.
- **Vision-augmented agents.** Use `grok_image_understand` to let agents reason over screenshots, design files, or live UI.
- **Cheap real-time data layer for SaaS prototypes.** Validate a "real-time market intelligence" or "X mention monitoring" feature in a weekend before building a proper backend.

### For data, analytics, and research

- **Pull X conversation data on any topic for analysis.** Sentiment, volume, who's posting, engagement distribution.
- **Track regulatory, policy, or industry developments** as they happen, not as they hit Claude's training data months later.
- **Academic research on social discourse** — pull real-time data on how a topic is being discussed without writing a Twitter API client.
- **Competitive intelligence pipelines** — track competitor releases, hiring posts, customer complaints, pricing changes.
- **Structured data extraction at scale.** `grok_structured_output` reliably extracts entities, relationships, or features from unstructured text.

### For automation and ops

- **Wake up to a daily brief on topics you care about** (Claude Routines + this MCP = autonomous personal news desk).
- **Brand mention monitoring** without paying for Brandwatch / Mention.com.
- **Trend detection** — surface things going viral in your niche before they peak.
- **Lead-gen triage** — find people publicly complaining about problems your product solves.
- **Customer support reconnaissance** — see what users are saying about your product before a support ticket exists.
- **Auto-generate visual alerts.** Trigger a `grok_image_generate` call to make a custom thumbnail when something noteworthy happens.

### For creators

- **Trending content radar** — daily, autonomous research on what's going viral in your niche.
- **Quote-tweet opportunity finder** — surface high-engagement posts in your topics worth responding to.
- **Audience research** — see what your target audience actually talks about, not what you assume they care about.
- **Source pulls for any output** — articles, threads, presentations — without context-switching to a browser.
- **Visual brand workflows.** Generate banner art, social cards, post thumbnails, and video clips in one workflow without leaving Claude.
- **Design feedback in chat.** Drop a screenshot via `grok_image_understand` and ask "what's wrong with this design?" — get specific notes.
- **Multi-step content production:** `grok_web_search` → research, `grok_chat` → draft, `grok_image_generate` → visual, `grok_video_generate` → clip. One pipeline, one chat.

### For everyone

- **Get current info into Claude.** Anything that happened after Claude's knowledge cutoff is reachable through this — without leaving your Claude chat.
- **Fact-check Claude's outputs** against live web data.
- **Cross-reference claims** with both web sources and live X discussion.
- **Generate visuals you can actually use** — Grok Imagine Quality Mode produces production-ready images.

---

## What you'll need

- An **xAI API key** — get one at https://console.x.ai/
- A **Cloudflare account** (free, takes 30 seconds to set up if you don't have one)
- **A terminal you're comfortable pasting commands into** (macOS Terminal, iTerm, Windows Terminal — anything works)
- **Node 18+** installed — [download here](https://nodejs.org/) if you don't have it
- ~5 minutes

### A note on cost

This repo doesn't bill you for anything. You're deploying your own copy of the server, paying xAI directly for Grok usage, and paying Cloudflare nothing for typical use.

- **xAI**: you pay xAI for Grok API calls, billed to whatever payment method is on your xAI account ([console.x.ai](https://console.x.ai/)). Image and video generation are more expensive than text — check pricing before automating high-volume creative workflows.
- **Xquik (optional)**: selecting the Xquik backend for `x_search` uses your own Xquik API key and account. The other eight tools still use xAI.
- **Cloudflare**: Workers free tier = 100k requests/day, more than you'll hit
- **Me**: zero — no telemetry, no proxying, no relay. The code runs on your account, your key, your bill.

---

## Install in 5 commands

```bash
git clone https://github.com/auny-ai/grok-mcp-server.git
cd grok-mcp-server
npm install
npx wrangler login
```

(`wrangler login` opens a browser tab — authorize Cloudflare access once.)

Set your xAI key and generate your own auth secret as Worker secrets, then deploy:

```bash
npx wrangler secret put XAI_API_KEY
# (paste your xai-... key when prompted)

printf '%s' "$(openssl rand -hex 32)" | npx wrangler secret put AUTH_SECRET
# generates and sets your own random secret — this gates the endpoint below

npx wrangler deploy
```

To route only `x_search` through Xquik, set 2 additional Worker secrets before deployment:

```bash
npx wrangler secret put XQUIK_API_KEY
printf '%s' 'xquik' | npx wrangler secret put X_SEARCH_BACKEND
```

Leave `X_SEARCH_BACKEND` unset to keep the default xAI route. Xquik is an independent third-party service. Not affiliated with X Corp. "Twitter" and "X" are trademarks of X Corp.

You'll see something like:

```
Deployed grok-mcp-server triggers
  https://grok-mcp-server.<your-account>.workers.dev
```

Done. Your Worker is live — and gated. Unlike v1, the `/mcp` endpoint now
fails closed: it refuses every request (503) until `AUTH_SECRET` is set, and
401s any request that doesn't present a valid credential. See
[`AGENTS.md`](./AGENTS.md) for the full install contract and
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for how the auth gate works.

Verify both auth paths and the tool count in one shot:

```bash
AUTH_SECRET=<the secret you generated> \
MCP_URL=https://grok-mcp-server.<your-account>.workers.dev \
./verify.sh
```

Should end in `PASS`.

---

## Connect to Claude

The endpoint is gated behind `AUTH_SECRET`. There are two ways to authenticate,
matching the two client shapes:

### In Claude.ai (Routines, Projects, custom integrations)

1. Settings → Connectors → **Add custom connector**
2. Name: `Grok`
3. URL: `https://grok-mcp-server.<your-account>.workers.dev/mcp`
4. Save, then **Connect** — this triggers a one-click OAuth/PKCE handshake
   against `/oauth/authorize` and `/oauth/token`. You never paste the raw
   secret into claude.ai; the connector receives a signed, expiring token.

The nine tools are now available to any chat or Routine where you enable the Grok connector.

### In Claude Desktop / Claude Code

These are headless clients, so they use the static-bearer path directly. Add
to your MCP config file:

```json
{
  "mcpServers": {
    "grok": {
      "url": "https://grok-mcp-server.<your-account>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your AUTH_SECRET>"
      }
    }
  }
}
```

Or with the Claude Code CLI:

```bash
claude mcp add grok --transport http \
  https://grok-mcp-server.<your-account>.workers.dev/mcp \
  --header "Authorization: Bearer <your AUTH_SECRET>"
```

Restart your Claude client and the tools become available.

---

## Tools reference

### `x_search`

Search X (Twitter) through the configured backend. The default xAI route returns Grok's synthesized response. The optional Xquik route returns structured public search results as JSON.

**Inputs:**
- `query` (string, required) — what to search for
- `context` (string, optional) — narrows the focus

**Example call (from inside Claude):**
> use x_search to find recent posts about "Claude Code" with min_faves:500 filter:blue_verified

**X search operators that work here:** `min_faves:N`, `min_retweets:N`, `filter:blue_verified`, `filter:verified`, `from:user`, `lang:en`, `since:YYYY-MM-DD`, and most other [advanced search operators](https://github.com/igorbrigadir/twitter-advanced-search).

### `grok_web_search`

General web search via Grok.

**Inputs:**
- `query` (string, required) — what to search for
- `context` (string, optional) — narrows the focus

### `grok_chat`

Plain text Grok completion.

**Inputs:**
- `prompt` (string, required) — user prompt
- `system` (string, optional) — system prompt
- `model` (string, optional) — model override (default: `grok-4.3`)

### `grok_image_generate`

Generate images from a text prompt.

**Inputs:**
- `prompt` (string, required) — description of the image
- `n` (integer 1-4, optional) — number of variations (default: 1)
- `model` (string, optional) — model override (default: `grok-imagine-image-quality`)

**Returns:** image URL(s). For multiple, returns a numbered list.

**Example call:**
> use grok_image_generate to make a cyberpunk-style poster of a black cat sitting on a glowing keyboard, n=2

### `grok_image_understand`

Analyze an image using Grok's vision capabilities.

**Inputs:**
- `image_url` (string, required) — URL of the image (jpg, jpeg, or png)
- `prompt` (string, required) — what you want to know about it
- `model` (string, optional) — model override (default: `grok-4.3`)

**Example call:**
> use grok_image_understand on https://example.com/dashboard.png — what UX issues do you see?

### `grok_image_edit`

Edit an existing image via a text prompt.

**Inputs:**
- `image_url` (string, required) — URL of the source image
- `prompt` (string, required) — description of the edit
- `model` (string, optional) — model override (default: `grok-imagine-image-quality`)

**Returns:** edited image URL.

**Example call:**
> use grok_image_edit on https://example.com/banner.jpg — change the background to a sunset and add a small moon in the upper right

### `grok_video_generate`

Generate a short video (up to 10 seconds, 720p) from text or an image.

**Inputs:**
- `prompt` (string, required) — description of the video
- `image_url` (string, optional) — starting image for image-to-video
- `model` (string, optional) — model override (default: `grok-imagine-video`)

**Returns:** video URL. Note: generation typically takes 20-60 seconds.

**Example call:**
> use grok_video_generate with the prompt "ocean waves crashing on rocks at sunset, slow motion"

### `grok_structured_output`

Get a JSON-schema-enforced response from Grok.

**Inputs:**
- `prompt` (string, required) — what you want Grok to produce
- `schema` (object or stringified JSON, required) — JSON Schema describing the expected response shape
- `system` (string, optional) — system prompt
- `model` (string, optional) — model override (default: `grok-4.3`)

**Returns:** JSON matching the provided schema.

**Example call:**
> use grok_structured_output to extract people, companies, and locations from this text. Schema: { type: "object", properties: { people: { type: "array", items: { type: "string" } }, companies: { ... }, locations: { ... } }, required: ["people", "companies", "locations"] }

### `grok_reasoning`

Use Grok's reasoning mode for deep analysis.

**Inputs:**
- `prompt` (string, required) — the question or problem
- `effort` (`"low"` | `"medium"` | `"high"`, optional) — reasoning depth (default: medium)
- `system` (string, optional) — system prompt
- `model` (string, optional) — model override (default: `grok-4.3`)

**Example call:**
> use grok_reasoning with effort=high to analyze whether building a personal MCP server is worth the maintenance cost vs using existing connectors

---

## Local development

For testing changes before deploying:

1. Copy `.env.example` to `.dev.vars` (gitignored) in the repo root and fill
   in your own values:
   ```
   XAI_API_KEY="xai-..."
   AUTH_SECRET="<output of: openssl rand -hex 32>"
   ```
2. Run the dev server:
   ```bash
   npm run dev
   ```
3. The server is now at `http://localhost:8787`.

---

## Architecture

```
MCP client (Claude / Cursor / anything)
        │
        │  Streamable HTTP MCP, Bearer auth (static secret or OAuth token)
        ▼
Cloudflare Worker (this repo)
        │  gateMcp() — fails closed without AUTH_SECRET
        ├── 8 Grok tools + default x_search → xAI Grok API
        └── optional x_search → Xquik public tweet search
```

- **Transport:** MCP over Streamable HTTP at `/mcp`
- **State:** stateless per request, no Durable Objects, no session memory
- **Auth (server → providers):** `XAI_API_KEY` remains required for Grok tools. The optional Xquik `x_search` route uses `XQUIK_API_KEY`.
- **Auth (client → server):** gated by `AUTH_SECRET` (`src/auth.ts`), fail-closed.
  Two routes: a static bearer for headless clients (Claude Code), and OAuth
  2.0 + PKCE with stateless HMAC-signed tokens for the claude.ai connector.
  No KV, no database — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
  for the full request-routing and token-verification walkthrough.

See [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) for rotating secrets, redeploying,
and common failure modes.

---

## Adding tools

`src/index.ts` defines tools using the MCP SDK's `server.tool()` pattern:

```typescript
server.tool(
  "tool_name",
  "Tool description for the LLM",
  { param: z.string() },
  async ({ param }) => {
    // your logic here
    return { content: [{ type: "text", text: "..." }] };
  }
);
```

The 8 Grok-only tools share `xaiFetch(env, path, body)`. `x_search` selects either that helper or the bounded `xquikSearch` helper from `X_SEARCH_BACKEND`.

Add a new tool, run `npm run dev` to test locally, then `npx wrangler deploy` to ship.

---

## Worker name

By default the Worker deploys as `grok-mcp-server`. To rename it, edit the `name` field in `wrangler.jsonc` before deploying:

```jsonc
{
  "name": "grok-mcp-server"  // change this
}
```

Each Cloudflare account has its own namespace, so `grok-mcp-server.<you>.workers.dev` won't conflict with anyone else's deploy.

---

## Why does this exist?

Most MCP servers run locally on your machine. They work great — until you want to use Claude somewhere that isn't your laptop.

The moment you do:

- **Claude Routines** can't reach a local server — they run in Anthropic's cloud, not on your machine
- **Claude on your phone** can't talk to your desktop
- **Any agent or automation** running anywhere but your laptop is locked out
- **Sharing your setup** means asking someone to install Node, clone the repo, and keep their laptop awake

A hosted MCP fixes all of that. The server lives on the open internet — on your Cloudflare account, behind your secret. Claude can reach it from anywhere. Same tools, same key, same behavior, from any device or workflow.

**If you're a developer:** this is the production pattern. Local for prototyping, hosted for shipping. The same code runs in dev and prod.

**If you're a creator or automation user:** this is what lets the magic follow you off your laptop. Your routines run while you sleep. Your phone has the same powers as your desktop. Your context is portable.

The longer version — the architecture, the trade-offs, the templates for building this kind of context system around Claude — lives in [CLAUDE.md is the Starting Point](https://github.com/auny-ai/claude-os/blob/main/articles/claude_md_is_the_starting_point.md). Worth a read if you're thinking about building a system around Claude, not just chatting with it.

---

## Changelog

**v1.2.0** — Added fail-closed dual-route inbound auth (`src/auth.ts`): a
static-bearer path for headless clients and self-contained OAuth 2.0 + PKCE
for the claude.ai connector, both backed by one `AUTH_SECRET`. No KV, no
database — stateless HMAC-signed tokens. Added `verify.sh`, `mcp.json`,
`AGENTS.md`, `.env.example`, and `docs/`.

**v1.1.0** — Added 6 new tools: `grok_image_generate`, `grok_image_understand`, `grok_image_edit`, `grok_video_generate`, `grok_structured_output`, `grok_reasoning`. Refactored to a shared `xaiFetch` helper. Server now exposes Grok's full surface area.

**v1.0.0** — Initial release. Three tools: `x_search`, `grok_web_search`, `grok_chat`. Stateless MCP server on Cloudflare Workers.

---

## License

MIT. Fork it, ship it, change it, sell it.

---

## Related

- [auny-ai/claude-os](https://github.com/auny-ai/claude-os) — the multi-AI operating system this is part of
- [Cloudflare Agents SDK docs](https://developers.cloudflare.com/agents/) — the SDK underneath this
- [Model Context Protocol](https://modelcontextprotocol.io) — the standard this implements
- [xAI API docs](https://docs.x.ai/) — the underlying API this wraps

If you build something interesting on top of this, open an issue or [tag me on X](https://x.com/AunySillyMe). 🧡
