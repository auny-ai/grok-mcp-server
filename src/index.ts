import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleOAuthRoutes, gateMcp } from "./auth";

/**
 * grok-mcp-server
 *
 * Remote MCP server exposing xAI Grok's full capability surface as tools:
 *  - x_search, grok_web_search, grok_chat (search + chat)
 *  - grok_image_generate, grok_image_understand, grok_image_edit (vision)
 *  - grok_video_generate (video)
 *  - grok_structured_output (JSON schema)
 *  - grok_reasoning (deep thinking)
 *
 * Stateless. No Durable Objects. Each request gets a freshly-built McpServer
 * scoped to that request's env. Deployed as a Cloudflare Worker.
 *
 * Endpoints:
 *   /     — health/info (JSON)
 *   /mcp  — MCP Streamable HTTP
 */

export interface Env {
  XAI_API_KEY: string;
  /** Selects the provider for x_search. Defaults to xai. */
  X_SEARCH_BACKEND?: string;
  /** Required only when X_SEARCH_BACKEND is xquik. */
  XQUIK_API_KEY?: string;
  /** Gates the inbound /mcp endpoint (src/auth.ts). Fails closed when unset. */
  AUTH_SECRET?: string;
  /** Deliberate opt-out: set to "true" to run /mcp unauthenticated on purpose. */
  MCP_PUBLIC?: string;
}

const BASE_URL = "https://api.x.ai/v1";
const XQUIK_SEARCH_URL = "https://xquik.com/api/v1/x/tweets/search";
const DEFAULT_TEXT_MODEL = "grok-4.3";
const DEFAULT_IMAGE_MODEL = "grok-imagine-image-quality";
const DEFAULT_VIDEO_MODEL = "grok-imagine-video";

type XSearchBackend = "xai" | "xquik";

function getXSearchBackend(env: Env): XSearchBackend {
  const configured = env.X_SEARCH_BACKEND?.trim().toLowerCase();
  if (!configured || configured === "xai" || configured === "grok") {
    return "xai";
  }
  if (configured === "xquik") {
    return "xquik";
  }
  throw new Error('Unsupported X_SEARCH_BACKEND. Use "xai", "grok", or "xquik".');
}

async function xquikSearch(
  env: Env,
  query: string,
  context?: string,
): Promise<string> {
  const apiKey = env.XQUIK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Set XQUIK_API_KEY before selecting X_SEARCH_BACKEND=xquik.",
    );
  }

  const scopedQuery = context?.trim() ? `${query} ${context.trim()}` : query;
  const url = new URL(XQUIK_SEARCH_URL);
  url.searchParams.set("q", scopedQuery);
  url.searchParams.set("queryType", "Latest");
  url.searchParams.set("limit", "20");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Xquik API error ${response.status}: ${errorText}`);
  }

  const data: unknown = await response.json();
  return JSON.stringify(
    {
      source: "xquik",
      query,
      ...(context?.trim() ? { context: context.trim() } : {}),
      results: data,
    },
    null,
    2,
  );
}

// ─── Shared xAI fetch helper ─────────────────────────────────────────
async function xaiFetch(
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.XAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`xAI API error ${response.status}: ${err}`);
  }
  return (await response.json()) as Record<string, any>;
}

// Extract text from /v1/responses output
function extractText(data: any): string {
  if (Array.isArray(data.output)) {
    return data.output
      .filter((i: any) => i.type === "message")
      .flatMap((i: any) => i.content || [])
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();
  }
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  return JSON.stringify(data, null, 2);
}

// Extract image URLs from /v1/images/generations response
function extractImageUrls(data: any): string[] {
  if (Array.isArray(data.data)) {
    return data.data.map((d: any) => d.url).filter(Boolean);
  }
  if (data.url) return [data.url];
  return [];
}

// Extract video URL from /v1/videos/generations response
function extractVideoUrl(data: any): string | null {
  if (data.url) return data.url;
  if (Array.isArray(data.data) && data.data[0]?.url) return data.data[0].url;
  return null;
}

function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: "grok", version: "1.2.0" });

  // ═══════════════════════════════════════════════════════════════════
  // SEARCH + CHAT TOOLS (v1.0)
  // ═══════════════════════════════════════════════════════════════════

  // ─── x_search ─────────────────────────────────────────────────────
  server.tool(
    "x_search",
    "Search X (Twitter) for recent and relevant posts through the configured xAI or Xquik backend. Returns author handles, post content, and engagement signals. Supports X advanced search operators like min_faves:N, filter:blue_verified, from:user, since:YYYY-MM-DD.",
    {
      query: z.string().describe("What to search for on X. Supports X advanced search operators."),
      context: z.string().optional().describe("Optional focus or filter for results"),
    },
    async ({ query, context }) => {
      if (getXSearchBackend(env) === "xquik") {
        return {
          content: [{ type: "text", text: await xquikSearch(env, query, context) }],
        };
      }
      const input = context
        ? `Search X for posts about: "${query}"\n\nFocus on: ${context}\n\nReturn recent posts with author, content, and engagement signals.`
        : `Search X for the most recent and relevant posts about: "${query}". Include author handles, post content, and notable engagement.`;
      const data = await xaiFetch(env, "/responses", {
        model: DEFAULT_TEXT_MODEL,
        tools: [{ type: "x_search" }],
        input,
      });
      return { content: [{ type: "text", text: extractText(data) }] };
    },
  );

  // ─── grok_web_search ──────────────────────────────────────────────
  server.tool(
    "grok_web_search",
    "Search the web via Grok. Returns current information with sources. Useful for live data beyond training cutoffs: news, pricing, releases, recent papers.",
    {
      query: z.string().describe("What to search for"),
      context: z.string().optional().describe("Optional focus or filter for results"),
    },
    async ({ query, context }) => {
      const input = context
        ? `Search the web for: "${query}"\n\nFocus on: ${context}\n\nProvide findings with sources.`
        : `Search the web for current information about: "${query}". Provide detailed, up-to-date findings with sources.`;
      const data = await xaiFetch(env, "/responses", {
        model: DEFAULT_TEXT_MODEL,
        tools: [{ type: "web_search" }],
        input,
      });
      return { content: [{ type: "text", text: extractText(data) }] };
    },
  );

  // ─── grok_chat ────────────────────────────────────────────────────
  server.tool(
    "grok_chat",
    "Chat with Grok. Plain text completion with optional system prompt. Useful when you want Grok's reasoning style or voice, not Claude's.",
    {
      prompt: z.string().describe("User prompt"),
      system: z.string().optional().describe("Optional system prompt"),
      model: z.string().optional().describe(`Optional model override (default: ${DEFAULT_TEXT_MODEL})`),
    },
    async ({ prompt, system, model }) => {
      const input = system
        ? [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ]
        : prompt;
      const data = await xaiFetch(env, "/responses", {
        model: model || DEFAULT_TEXT_MODEL,
        input,
      });
      return { content: [{ type: "text", text: extractText(data) }] };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // VISION + MEDIA TOOLS (v1.1)
  // ═══════════════════════════════════════════════════════════════════

  // ─── grok_image_generate ──────────────────────────────────────────
  server.tool(
    "grok_image_generate",
    "Generate images from a text prompt using Grok Imagine. Returns image URL(s). Good for mockups, social cards, thumbnails, brand visuals, A/B variants.",
    {
      prompt: z.string().describe("Text description of the image to generate"),
      n: z.number().int().min(1).max(4).optional().describe("Number of image variations (1-4, default 1)"),
      model: z.string().optional().describe(`Optional model override (default: ${DEFAULT_IMAGE_MODEL})`),
    },
    async ({ prompt, n, model }) => {
      const data = await xaiFetch(env, "/images/generations", {
        model: model || DEFAULT_IMAGE_MODEL,
        prompt,
        n: n || 1,
      });
      const urls = extractImageUrls(data);
      const text =
        urls.length === 0
          ? `No image URLs returned. Raw response: ${JSON.stringify(data)}`
          : urls.length === 1
          ? `Generated image: ${urls[0]}`
          : `Generated ${urls.length} images:\n${urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
      return { content: [{ type: "text", text }] };
    },
  );

  // ─── grok_image_understand ────────────────────────────────────────
  server.tool(
    "grok_image_understand",
    "Analyze an image with Grok's vision capabilities. Pass an image URL and a prompt describing what to analyze. Useful for screenshot analysis, content audits, alt-text, design feedback.",
    {
      image_url: z.string().describe("URL of the image to analyze (jpg, jpeg, or png)"),
      prompt: z.string().describe("What you want to know about the image"),
      model: z.string().optional().describe(`Optional model override (default: ${DEFAULT_TEXT_MODEL})`),
    },
    async ({ image_url, prompt, model }) => {
      const data = await xaiFetch(env, "/responses", {
        model: model || DEFAULT_TEXT_MODEL,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url },
            ],
          },
        ],
      });
      return { content: [{ type: "text", text: extractText(data) }] };
    },
  );

  // ─── grok_image_edit ──────────────────────────────────────────────
  server.tool(
    "grok_image_edit",
    "Edit an existing image via a text prompt using Grok Imagine. Pass an image URL and a description of the change. Returns the edited image URL.",
    {
      image_url: z.string().describe("URL of the image to edit"),
      prompt: z.string().describe("Description of the edit (e.g. 'make the background blue', 'change to night scene')"),
      model: z.string().optional().describe(`Optional model override (default: ${DEFAULT_IMAGE_MODEL})`),
    },
    async ({ image_url, prompt, model }) => {
      const data = await xaiFetch(env, "/images/edits", {
        model: model || DEFAULT_IMAGE_MODEL,
        image: image_url,
        prompt,
      });
      const urls = extractImageUrls(data);
      const text =
        urls.length === 0
          ? `No edited image URL returned. Raw response: ${JSON.stringify(data)}`
          : `Edited image: ${urls[0]}`;
      return { content: [{ type: "text", text }] };
    },
  );

  // ─── grok_video_generate ──────────────────────────────────────────
  server.tool(
    "grok_video_generate",
    "Generate a short video (up to 10 seconds, 720p) using Grok Imagine. Supports text-to-video and image-to-video. Returns the video URL when ready. Note: can take 20-60 seconds.",
    {
      prompt: z.string().describe("Text description of the video to generate"),
      image_url: z.string().optional().describe("Optional starting image URL for image-to-video generation"),
      model: z.string().optional().describe(`Optional model override (default: ${DEFAULT_VIDEO_MODEL})`),
    },
    async ({ prompt, image_url, model }) => {
      const body: Record<string, unknown> = {
        model: model || DEFAULT_VIDEO_MODEL,
        prompt,
      };
      if (image_url) body.image_url = image_url;
      const data = await xaiFetch(env, "/videos/generations", body);
      const url = extractVideoUrl(data);
      const text = url
        ? `Generated video: ${url}`
        : `No video URL returned. Raw response: ${JSON.stringify(data)}`;
      return { content: [{ type: "text", text }] };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // STRUCTURED OUTPUT + REASONING TOOLS (v1.1)
  // ═══════════════════════════════════════════════════════════════════

  // ─── grok_structured_output ───────────────────────────────────────
  server.tool(
    "grok_structured_output",
    "Get a JSON-schema-enforced response from Grok. Pass a prompt and a JSON Schema describing the expected structure. Returns parsed JSON matching the schema. Useful for reliable agent pipelines, data extraction, ETL workflows.",
    {
      prompt: z.string().describe("What you want Grok to produce"),
      schema: z
        .union([z.string(), z.record(z.string(), z.any())])
        .describe("JSON Schema (as object or stringified JSON) describing the expected response shape"),
      system: z.string().optional().describe("Optional system prompt"),
      model: z.string().optional().describe(`Optional model override (default: ${DEFAULT_TEXT_MODEL})`),
    },
    async ({ prompt, schema, system, model }) => {
      const parsedSchema = typeof schema === "string" ? JSON.parse(schema) : schema;
      const input = system
        ? [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ]
        : prompt;
      const data = await xaiFetch(env, "/responses", {
        model: model || DEFAULT_TEXT_MODEL,
        input,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "structured_output",
            strict: true,
            schema: parsedSchema,
          },
        },
      });
      return { content: [{ type: "text", text: extractText(data) }] };
    },
  );

  // ─── grok_reasoning ───────────────────────────────────────────────
  server.tool(
    "grok_reasoning",
    "Use Grok's reasoning mode for deep analysis on complex problems. Slower than grok_chat but produces more rigorous output. Good for strategy questions, multi-step problems, debate prep, technical analysis.",
    {
      prompt: z.string().describe("The question or problem to reason through"),
      effort: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Reasoning depth (default: medium). 'high' is slower but more thorough."),
      system: z.string().optional().describe("Optional system prompt"),
      model: z.string().optional().describe(`Optional model override (default: ${DEFAULT_TEXT_MODEL})`),
    },
    async ({ prompt, effort, system, model }) => {
      const input = system
        ? [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ]
        : prompt;
      const data = await xaiFetch(env, "/responses", {
        model: model || DEFAULT_TEXT_MODEL,
        input,
        reasoning: { effort: effort || "medium" },
      });
      return { content: [{ type: "text", text: extractText(data) }] };
    },
  );

  return server;
}

// ─── WORKER ENTRY POINT ──────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // OAuth 2.0 / PKCE routes (discovery, register, authorize, confirm, token).
    // All unauthenticated by design — they issue the credential, they don't
    // consume one. Checked before anything else.
    const oauthResponse = await handleOAuthRoutes(request, url, env);
    if (oauthResponse) return oauthResponse;

    // Health / info endpoint
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify(
          {
            name: "grok-mcp-server",
            version: "1.2.0",
            mcp_endpoint: `${url.origin}/mcp`,
            tools: [
              "x_search",
              "grok_web_search",
              "grok_chat",
              "grok_image_generate",
              "grok_image_understand",
              "grok_image_edit",
              "grok_video_generate",
              "grok_structured_output",
              "grok_reasoning",
            ],
            status: "ok",
          },
          null,
          2,
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // MCP endpoint — stateless: new server per request
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const denied = await gateMcp(request, env);
      if (denied) return denied;
      const server = buildServer(env);
      const handler = createMcpHandler(server, { route: "/mcp" });
      return handler(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};
