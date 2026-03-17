/**
 * POST /api/ai-explain
 * Sends arbitrary ES data (profile, mapping, slow query, etc.) to an LLM and returns
 * a plain-English explanation plus optimization recommendations.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";

const SYSTEM_PROMPT = `You are an expert Elasticsearch/OpenSearch performance engineer.
The user will provide raw data from their cluster (query profiles, slow query output, mappings, allocation explain, etc.).
Your job is to:
1. Identify the biggest bottlenecks or issues.
2. Explain in plain English what is happening and why it is slow or problematic.
3. List concrete, prioritized optimization recommendations with exact API calls or config changes.
Always be concise, practical, and use bullet points. Use code blocks for API calls.`;

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { content, provider = "openai", apiKey, model, endpoint } = body as {
    content: string; provider: string; apiKey: string; model: string; endpoint?: string;
  };

  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });
  if (!apiKey && provider !== "ollama") return NextResponse.json({ error: "apiKey is required" }, { status: 400 });

  try {
    if (provider === "anthropic") {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model || "claude-3-5-sonnet-20241022",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error?.message ?? "Anthropic API error");
      const explanation = data.content?.[0]?.text ?? "";
      return NextResponse.json({ explanation });
    }

    // OpenAI-compatible (openai, azure, ollama, custom)
    const baseUrl =
      provider === "azure" ? endpoint?.replace(/\/$/, "") :
      provider === "ollama" ? (endpoint ?? "http://localhost:11434") + "/v1" :
      provider === "custom" ? endpoint?.replace(/\/$/, "") :
      "https://api.openai.com/v1";

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
        max_tokens: 1024,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message ?? "AI API error");
    const explanation = data.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ explanation });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
