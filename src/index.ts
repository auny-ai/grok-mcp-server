import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * grok-mcp-hosted
 *
 * Remote MCP server exposing xAI Grok's x_search, web_search, and chat as tools.
 * Stateless — no Durable Objects, no per-session memory. Each request gets a
 * freshly-built McpServer scoped to that request's env.
 *
 * Three tools:
 *   - x_search        — search X/Twitter via xAI's native x_search
 *   - grok_web_search — general web search via Grok
 *   - grok_chat       — plain Grok chat completion
 *
 * Endpoints:
 *   /     — health/info (JSON)
 *   /mcp  — MCP Streamable HTTP (current spec)
 */

export interface Env {
  XAI_API_KEY: string;
}

const BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4.3";

function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: "grok", version: "1.0.0" });

  const callGrok = async ({
    input,
    tools = [],
    model = DEFAULT_MODEL,
    system = null,
  }: {
    input: string | object;
    tools?: object[];
    model?: string;
    system?: string | null;
  }) => {
    const body: Record<string, unknown> = { model, tools };
    if (system && typeof input === "string") {
      body.input = [
        { role: "system", content: system },
        { role: "user", content: input },
      ];
    } else {
      body.input = input;
    }
    const response = await fetch(`${BASE_URL}/responses`, {
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
  };

  const extractText = (data: any): string => {
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
  };

  // ─── TOOL 1: x_search ──────────────────────────────────────────
  server.tool(
    "x_search",
    "Search X (Twitter) for recent and relevant posts via xAI's native X search. Returns author handles, post content, and engagement signals.",
    {
      query: z.string().describe("What to search for on X"),
      context: z.string().optional().describe("Optional focus or filter for results"),
    },
    async ({ query, context }) => {
      const input = context
        ? `Search X for posts about: "${query}"\n\nFocus on: ${context}\n\nReturn recent posts with author, content, and engagement signals.`
        : `Search X for the most recent and relevant posts about: "${query}". Include author handles, post content, and notable engagement.`;
      const data = await callGrok({ input, tools: [{ type: "x_search" }] });
      return { content: [{ type: "text", text: extractText(data) }] };
    },
  );

  // ─── TOOL 2: grok_web_search ───────────────────────────────────
  server.tool(
    "grok_web_search",
    "Search the web via Grok. Returns current information with sources.",
    {
      query: z.string().describe("What to search for"),
      context: z.string().optional().describe("Optional focus or filter for results"),
    },
    async ({ query, context }) => {
      const input = context
        ? `Search the web for: "${query}"\n\nFocus on: ${context}\n\nProvide findings with sources.`
        : `Search the web for current information about: "${query}". Provide detailed, up-to-date findings with sources.`;
      const data = await callGrok({ input, tools: [{ type: "web_search" }] });
      return { content: [{ type: "text", text: extractText(data) }] };
    },
  );

  // ─── TOOL 3: grok_chat ─────────────────────────────────────────
  server.tool(
    "grok_chat",
    "Chat with Grok. Plain text completion with optional system prompt.",
    {
      prompt: z.string().describe("User prompt"),
      system: z.string().optional().describe("Optional system prompt"),
      model: z.string().optional().describe(`Optional model override (default: ${DEFAULT_MODEL})`),
    },
    async ({ prompt, system, model }) => {
      const data = await callGrok({
        input: prompt,
        system: system || null,
        model: model || DEFAULT_MODEL,
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

    // Health / info endpoint
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify(
          {
            name: "grok-mcp-hosted",
            version: "1.0.0",
            mcp_endpoint: `${url.origin}/mcp`,
            tools: ["x_search", "grok_web_search", "grok_chat"],
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
      const server = buildServer(env);
      const handler = createMcpHandler(server, { route: "/mcp" });
      return handler(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};
