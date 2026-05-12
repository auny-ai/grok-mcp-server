# grok-mcp-server

A remote MCP server that gives any Claude (or any MCP-compatible AI) access to xAI Grok's live X (Twitter) search, web search, and chat — from anywhere. Your laptop, your phone, an automated routine running while you sleep.

Whether you're a developer building agents, an automation tinkerer wiring up workflows, or a creator who wants real-time data inside Claude — this is the same install.

Hosted on your own Cloudflare account. 4 commands. Stateless. ~150 lines of code.

Built as part of [auny-ai/claude-os](https://github.com/auny-ai/claude-os) — a multi-AI operating system being built in public. 🧡

---

## What it does

Three tools, all wrapping xAI's `/v1/responses` endpoint. Each tool is general-purpose — the use cases below are just examples of what's possible.

### `x_search` — Real-time X (Twitter) data

Searches X via xAI's native x_search backend. Returns posts with author handles, follower counts, engagement metrics (likes, retweets, replies, views), timestamps, embedded media, and quote-tweet context.

Supports the full X advanced search operator set: `min_faves:N`, `min_retweets:N`, `filter:blue_verified`, `filter:verified`, `from:user`, `lang:en`, `since:YYYY-MM-DD`, and the rest.

### `grok_web_search` — Live web search with current information

General web search via Grok, with results synthesized into a coherent answer plus sources. Updated continuously — not subject to a model knowledge cutoff.

### `grok_chat` — Grok as a model, not just a search tool

Plain text completion with Grok directly. Optional system prompt and model override. Useful when you want Grok's reasoning style or voice — not Claude's — for a specific output.

---

## Use cases

This is a general-purpose Grok wrapper that any MCP client can hit. The use cases stretch as far as Grok's capabilities themselves.

### For developers

- **Build agents that need real-time data.** Most AI agents are blind to the last 24 hours. This gives any MCP-compatible agent live X + web search as a primitive.
- **Multi-model orchestration.** Claude as orchestrator, Grok as worker — cheaper, faster fan-out for tasks where Claude's reasoning isn't needed but recency or specific tone is.
- **Live research inside Claude Code.** When debugging a library, pulling current GitHub issues or recent docs without leaving your terminal.
- **Cross-model evaluation.** Pipe the same prompt to both models from inside Claude. Compare outputs in one workflow.
- **Replace web-scraping infra.** If you have brittle Puppeteer/Playwright setups pulling X data, this replaces them with a single MCP call. xAI handles the auth, rate limits, and rendering.
- **Cheap real-time data layer for SaaS prototypes.** Validate a "real-time market intelligence" or "X mention monitoring" feature in a weekend before building a proper backend.

### For data, analytics, and research

- **Pull X conversation data on any topic for analysis.** Sentiment, volume, who's posting, engagement distribution.
- **Track regulatory, policy, or industry developments** as they happen, not as they hit Claude's training data months later.
- **Academic research on social discourse** — pull real-time data on how a topic is being discussed without writing a Twitter API client.
- **Competitive intelligence pipelines** — track competitor releases, hiring posts, customer complaints, pricing changes.

### For automation and ops

- **Wake up to a daily brief on topics you care about** (Claude Routines + this MCP = autonomous personal news desk).
- **Brand mention monitoring** without paying for Brandwatch / Mention.com.
- **Trend detection** — surface things going viral in your niche before they peak.
- **Lead-gen triage** — find people publicly complaining about problems your product solves.
- **Customer support reconnaissance** — see what users are saying about your product before a support ticket exists.

### For creators

- **Trending content radar** — daily, autonomous research on what's going viral in your niche.
- **Quote-tweet opportunity finder** — surface high-engagement posts in your pillars worth responding to.
- **Audience research** — see what your target audience actually talks about, not what you assume they care about.
- **Source pulls for any output** — articles, threads, presentations — without context-switching to a browser.

### For everyone

- **Get current info into Claude.** Anything that happened after Claude's knowledge cutoff is reachable through this — without leaving your Claude chat.
- **Fact-check Claude's outputs** against live web data.
- **Cross-reference claims** with both web sources and live X discussion.

---

## What you'll need

- An **xAI API key** — get one at https://console.x.ai/
- A **Cloudflare account** (free, takes 30 seconds to set up if you don't have one)
- **A terminal you're comfortable pasting commands into** (macOS Terminal, iTerm, Windows Terminal — anything works)
- **Node 18+** installed — [download here](https://nodejs.org/) if you don't have it
- ~5 minutes

### A note on cost

This repo doesn't bill you for anything. You're deploying your own copy of the server, paying xAI directly for Grok usage, and paying Cloudflare nothing for typical use.

- **xAI**: you pay xAI for Grok API calls, billed to whatever payment method is on your xAI account ([console.x.ai](https://console.x.ai/))
- **Cloudflare**: Workers free tier = 100k requests/day, more than you'll hit
- **Me**: zero — no telemetry, no proxying, no relay. The code runs on your account, your key, your bill.

---

## Install in 4 commands

```bash
git clone https://github.com/auny-ai/grok-mcp-server.git
cd grok-mcp-server
npm install
npx wrangler login
```

(`wrangler login` opens a browser tab — authorize Cloudflare access once.)

Then set your xAI key as a Worker secret and deploy:

```bash
npx wrangler secret put XAI_API_KEY
# (paste your xai-... key when prompted)

npx wrangler deploy
```

You'll see something like:

```
Deployed grok-mcp-server triggers
  https://grok-mcp-server.<your-account>.workers.dev
```

Done. Your Worker is live.

Sanity check:

```bash
curl https://grok-mcp-server.<your-account>.workers.dev/
```

Should return JSON listing the three tools.

---

## Connect to Claude

### In Claude.ai (Routines, Projects, custom integrations)

1. Settings → Connectors → **Add custom connector**
2. Name: `Grok`
3. URL: `https://grok-mcp-server.<your-account>.workers.dev/mcp`
4. Save

The three tools are now available to any chat or Routine where you enable the Grok connector.

### In Claude Desktop / Claude Code

Add to your MCP config file:

```json
{
  "mcpServers": {
    "grok": {
      "url": "https://grok-mcp-server.<your-account>.workers.dev/mcp"
    }
  }
}
```

Restart your Claude client and the tools become available.

---

## Tools reference

### `x_search`

Search X (Twitter) via xAI's native X search tool.

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

---

## Local development

For testing changes before deploying:

1. Create a `.dev.vars` file (gitignored) in the repo root:
   ```
   XAI_API_KEY="xai-..."
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
        │  Streamable HTTP MCP
        ▼
Cloudflare Worker (this repo)
        │
        │  Bearer auth via Worker secret
        ▼
xAI Grok API (api.x.ai/v1/responses)
```

- **Transport:** MCP over Streamable HTTP at `/mcp`
- **State:** stateless per request, no Durable Objects, no session memory
- **Auth (server → xAI):** Bearer token via `XAI_API_KEY` Worker secret
- **Auth (client → server):** none by default (the Worker URL itself is the only secret)

If you want to add auth in front of the Worker (e.g. require a bearer token from clients), it's ~5 lines in `src/index.ts` — check the `fetch` handler.

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

## License

MIT. Fork it, ship it, change it, sell it.

---

## Related

- [auny-ai/claude-os](https://github.com/auny-ai/claude-os) — the multi-AI operating system this is part of
- [Cloudflare Agents SDK docs](https://developers.cloudflare.com/agents/) — the SDK underneath this
- [Model Context Protocol](https://modelcontextprotocol.io) — the standard this implements

If you build something interesting on top of this, open an issue or [tag me on X](https://x.com/AunySillyMe). 🧡
