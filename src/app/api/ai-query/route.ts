/**
 * POST /api/ai-query
 * Converts a natural-language query into an Elasticsearch DSL query using an LLM.
 *
 * Security model:
 *   - The API key is NEVER stored server-side. It is passed in each request body
 *     by the browser (where it lives in localStorage) and used once per call.
 *   - The server only stores the preferred base_url and model (non-secret defaults).
 *   - Supports OpenAI-compatible APIs and the native Anthropic Messages API.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';
import { getClusterSession } from '@/lib/cluster-session';
import { isEsRequestAllowed } from '@/lib/es-permissions';
import { assertSafeOutboundUrl, parseOutboundUrl } from '@/lib/url-guard';

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const body = await request.json();
  const { naturalLanguage, index, apiKey, baseUrl, model, format } = body as {
    naturalLanguage: string;
    index?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    format?: 'openai' | 'anthropic';
  };

  if (!naturalLanguage?.trim()) {
    return NextResponse.json({ error: 'naturalLanguage is required' }, { status: 400 });
  }

  // API key must come from the request body — it is never stored server-side.
  const resolvedApiKey = apiKey?.trim() ?? '';
  if (!resolvedApiKey || resolvedApiKey === 'ollama') {
    // Ollama runs locally without a key; any other provider needs one.
    const isOllama = (baseUrl ?? '').includes('11434');
    if (!isOllama && !resolvedApiKey) {
      return NextResponse.json(
        { error: 'API key required. Configure it in the AI Settings panel.' },
        { status: 400 }
      );
    }
  }

  const db = getDatabase();
  const settings = db.getAllSettings();
  // baseUrl and model can come from request (user's provider choice) or server defaults.
  const resolvedBaseUrl = baseUrl?.trim() || settings['ai_base_url'] || process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const resolvedModel   = model?.trim()   || settings['ai_model']    || process.env.AI_MODEL    || 'gpt-4o-mini';
  const resolvedFormat  = format ?? (resolvedBaseUrl.includes('anthropic.com') ? 'anthropic' : 'openai');

  // Fetch index mappings to give the LLM context
  let mappingContext = '';
  if (index) {
    try {
      const client = getClusterSession(user.id)?.client;
      const mappingPath = `/${encodeURIComponent(index)}/_mapping`;
      if (client && isEsRequestAllowed(user.role, 'GET', mappingPath)) {
        const mapping = await client.getIndexMapping(encodeURIComponent(index));
        const props = (mapping as Record<string, unknown>)[index] as Record<string, unknown> ?? {};
        const mappings = (props.mappings ?? (Object.values(mapping as object)[0] as Record<string, unknown>)?.mappings ?? {}) as Record<string, unknown>;
        const fields = Object.keys((mappings.properties as Record<string, unknown>) ?? {}).slice(0, 30);
        mappingContext = fields.length ? `\n\nIndex "${index}" fields: ${fields.join(', ')}` : '';
      }
    } catch { /* ignore */ }
  }

  const systemPrompt = `You are an Elasticsearch/OpenSearch DSL query builder. Convert natural language to valid JSON DSL queries.
Rules:
- Return ONLY valid JSON, no markdown, no explanation, no code fences
- The JSON must be a valid Elasticsearch query body (with "query" key at root, optionally "size", "sort", "aggs")
- Use match, term, range, bool queries as appropriate
- For time ranges, use "now-24h", "now-7d" etc.
- Default size is 100 unless specified${mappingContext}`;

  const userPrompt = index
    ? `Convert to DSL for index "${index}": ${naturalLanguage}`
    : `Convert to DSL: ${naturalLanguage}`;

  try {
    // The LLM endpoint is user-controlled: block metadata/link-local destinations
    await assertSafeOutboundUrl(resolvedBaseUrl);
    let raw: string;

    if (resolvedFormat === 'anthropic') {
      // Native Anthropic Messages API
      const resp = await fetch(`${resolvedBaseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': resolvedApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return NextResponse.json({ error: `Anthropic API error ${resp.status}: ${errText}` }, { status: 502 });
      }
      const data = await resp.json() as { content?: { type: string; text: string }[] };
      raw = data.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
    } else {
      // OpenAI-compatible API (OpenAI, Azure, Ollama, vLLM, etc.)
      const resp = await fetch(`${resolvedBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedApiKey}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 1000,
        }),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return NextResponse.json({ error: `LLM API error ${resp.status}: ${errText}` }, { status: 502 });
      }
      const llmData = await resp.json() as { choices?: { message?: { content?: string } }[] };
      raw = llmData.choices?.[0]?.message?.content?.trim() ?? '';
    }

    // Strip markdown code fences if the model added them
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let dsl: unknown;
    try {
      dsl = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: 'LLM returned invalid JSON', raw }, { status: 502 });
    }

    return NextResponse.json({ dsl, raw });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `AI request failed: ${msg}` }, { status: 500 });
  }
}

/**
 * GET /api/ai-query — returns server-side AI defaults (no key — key is browser-only).
 * The `has_key` field is always false: the API key lives in the browser's localStorage.
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const settings = getDatabase().getAllSettings();
  return NextResponse.json({
    base_url: settings['ai_base_url'] ?? process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
    model:    settings['ai_model']    ?? process.env.AI_MODEL    ?? 'gpt-4o-mini',
    has_key:  false, // API key is always browser-only — never stored server-side
  });
}

/**
 * PUT /api/ai-query — saves non-secret AI defaults (base_url and model only).
 * API keys are explicitly excluded and will NOT be persisted.
 */
export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  // Global default for every user — whoever controls it receives other users' API keys
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const body = await request.json();
  const db = getDatabase();
  if (body.baseUrl) {
    try {
      parseOutboundUrl(body.baseUrl);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid URL' }, { status: 400 });
    }
  }
  // Deliberately omit apiKey — it must never be stored server-side
  if (body.baseUrl) db.setSetting('ai_base_url', body.baseUrl);
  if (body.model)   db.setSetting('ai_model',    body.model);
  return NextResponse.json({ ok: true });
}
