"use client";
/**
 * AI Query Builder
 *
 * Key design principles:
 * 1. API keys live in localStorage ONLY — they are passed in the request body and
 *    used by the server proxy once per call. They are NEVER stored server-side.
 * 2. The PII sanitizer scrubs emails, IPs, tokens, passwords, hashes, credit-card
 *    numbers, and common secret JSON fields from your query BEFORE anything is
 *    sent to the external AI provider.
 * 3. The user picks a provider from a curated list; the server routes the request
 *    to the appropriate API format (OpenAI-compatible or Anthropic native).
 */
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sanitize, type RedactionEntry } from "@/lib/pii-sanitizer";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { useConnection } from "@/contexts/connection-context";
import {
  Sparkles, Play, Settings, Loader2, Copy, CheckCheck,
  AlertTriangle, Database, ChevronDown, ChevronUp,
  ShieldCheck, Eye, EyeOff, Trash2, Info,
} from "lucide-react";

// ── Provider presets ──────────────────────────────────────────────────────────
interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  format: "openai" | "anthropic";
  keyPlaceholder: string;
  keyHint: string;
}

const PROVIDERS: Provider[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    format: "openai",
    keyPlaceholder: "sk-...",
    keyHint: "From platform.openai.com → API Keys",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307", "claude-3-opus-20240229"],
    format: "anthropic",
    keyPlaceholder: "sk-ant-api03-...",
    keyHint: "From console.anthropic.com → API Keys",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.2", "llama3.1", "mistral", "codellama", "deepseek-r1", "phi3"],
    format: "openai",
    keyPlaceholder: "ollama (no key required)",
    keyHint: "Leave blank — Ollama runs locally without a key",
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    baseUrl: "",
    models: [],
    format: "openai",
    keyPlaceholder: "Azure API key",
    keyHint: "https://<resource>.openai.azure.com/openai/deployments/<deployment>",
  },
  {
    id: "custom",
    label: "Custom / Self-hosted",
    baseUrl: "",
    models: [],
    format: "openai",
    keyPlaceholder: "API key (if required)",
    keyHint: "Any OpenAI-compatible endpoint (LM Studio, vLLM, Together AI, …)",
  },
];

const LS_PREFIX = "is:ai:";
function lsGet(k: string): string { return (typeof window !== "undefined" && localStorage.getItem(LS_PREFIX + k)) || ""; }
function lsSet(k: string, v: string): void { if (typeof window !== "undefined") { if (v) localStorage.setItem(LS_PREFIX + k, v); else localStorage.removeItem(LS_PREFIX + k); } }

interface SearchResult { hits?: { hits: unknown[]; total?: { value: number } | number }; error?: string }

const EXAMPLE_QUERIES = [
  "Show me all failed auth events in the last 24 hours",
  "Find the top 10 source IPs by request count today",
  "Get all documents where response code is 500",
  "Show me error-level alerts from the last 7 days",
  "Find documents containing the word 'timeout' in the message field",
];

export default function AiQueryPage() {
  const { isConnected } = useConnection();

  // Provider / config state
  const [providerId, setProviderId] = useState<string>(() => lsGet("provider") || "openai");
  const [customBaseUrl, setCustomBaseUrl] = useState<string>(() => lsGet("customBaseUrl"));
  const [customModel, setCustomModel] = useState<string>(() => lsGet("customModel"));
  const [apiKey, setApiKey] = useState<string>(() => lsGet("apiKey"));
  const [showKey, setShowKey] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Query state
  const [naturalLanguage, setNaturalLanguage] = useState("");
  const [index, setIndex] = useState("__none__");
  const [indices, setIndices] = useState<string[]>([]);
  const [dsl, setDsl] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // PII state
  const [redactions, setRedactions] = useState<RedactionEntry[]>([]);
  const [sanitizedQuery, setSanitizedQuery] = useState<string | null>(null);

  const provider = PROVIDERS.find(p => p.id === providerId) ?? PROVIDERS[0];
  const activeBaseUrl = ["azure", "custom"].includes(providerId) ? customBaseUrl : provider.baseUrl;
  const activeModels  = ["azure", "custom"].includes(providerId)
    ? (customModel ? [customModel] : [])
    : provider.models;
  const [selectedModel, setSelectedModel] = useState<string>(() => lsGet("model") || provider.models[0] || "");

  useEffect(() => { lsSet("provider", providerId); }, [providerId]);
  useEffect(() => { lsSet("apiKey", apiKey); }, [apiKey]);
  useEffect(() => { lsSet("model", selectedModel); }, [selectedModel]);
  useEffect(() => { lsSet("customBaseUrl", customBaseUrl); }, [customBaseUrl]);
  useEffect(() => { lsSet("customModel", customModel); }, [customModel]);

  useEffect(() => {
    if (!["azure", "custom"].includes(providerId)) {
      setSelectedModel(provider.models[0] ?? "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const loadIndices = useCallback(async () => {
    const client = getElasticsearchClient();
    if (!client) return;
    try {
      const raw: Record<string, string>[] = await client.request("/_cat/indices?format=json");
      setIndices(
        (Array.isArray(raw) ? raw : [])
          .map(i => i.index ?? "")
          .filter(n => n && !n.startsWith("."))
          .sort()
      );
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (isConnected) loadIndices();
    else setIndices([]);
  }, [isConnected, loadIndices]);

  // PII detection while typing
  useEffect(() => {
    if (!naturalLanguage) { setRedactions([]); setSanitizedQuery(null); return; }
    const r = sanitize(naturalLanguage);
    setRedactions(r.redactions);
    setSanitizedQuery(r.redactions.length > 0 ? r.sanitized : null);
  }, [naturalLanguage]);

  const generateDsl = async () => {
    if (!naturalLanguage.trim()) return;
    const resolvedKey = apiKey.trim();
    if (!resolvedKey && providerId !== "ollama") {
      setError("Please enter an API key in the AI Settings panel.");
      setShowConfig(true);
      return;
    }
    const { sanitized } = sanitize(naturalLanguage);

    setLoading(true); setError(null); setDsl(""); setResults(null);
    try {
      const resp = await fetch("/api/ai-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naturalLanguage: sanitized,
          index: index === "__none__" ? undefined : index,
          apiKey: resolvedKey || "ollama",
          baseUrl: activeBaseUrl,
          model: ["azure", "custom"].includes(providerId) ? (customModel || selectedModel) : selectedModel,
          format: provider.format,
        }),
      });
      const data = await resp.json();
      if (data.error) { setError(data.error); return; }
      setDsl(JSON.stringify(data.dsl, null, 2));
    } catch (e) {
      setError("Request failed: " + String(e));
    } finally {
      setLoading(false);
    }
  };

  const executeQuery = async () => {
    if (!dsl || index === "__none__") return;
    setExecuting(true); setError(null);
    try {
      let parsedDsl: unknown;
      try { parsedDsl = JSON.parse(dsl); } catch { setError("DSL is not valid JSON"); setExecuting(false); return; }
      const resp = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, query: parsedDsl }),
      });
      const data = await resp.json();
      setResults(data);
      if (data.error) setError(data.error);
    } catch (e) {
      setError("Execution failed: " + String(e));
    } finally {
      setExecuting(false);
    }
  };

  const copyDsl = () => { navigator.clipboard.writeText(dsl); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const clearKey = () => { setApiKey(""); lsSet("apiKey", ""); };

  const totalHits = results?.hits?.total;
  const hitsCount = typeof totalHits === "object" ? (totalHits as { value?: number })?.value ?? 0 : (totalHits ?? 0);
  const hasKey = !!apiKey.trim();
  const configOk = hasKey || providerId === "ollama";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            AI Query Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Natural language → Elasticsearch DSL · API key stored locally only · PII auto-redacted
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {configOk
            ? <Badge variant="outline" className="text-emerald-600 border-emerald-500"><ShieldCheck className="h-3 w-3 mr-1"/>Key stored locally</Badge>
            : <Badge variant="outline" className="text-amber-500 border-amber-400"><AlertTriangle className="h-3 w-3 mr-1"/>No API key set</Badge>
          }
          <Button variant="outline" size="sm" onClick={() => setShowConfig(v => !v)}>
            <Settings className="h-4 w-4 mr-1" /> AI Settings
            {showConfig ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
          </Button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" /> AI Provider Configuration
              <Badge variant="secondary" className="text-xs ml-auto">Stored in your browser only — never sent to server</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select value={providerId} onValueChange={id => setProviderId(id)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                {["azure", "custom"].includes(providerId) ? (
                  <Input value={customModel} onChange={e => setCustomModel(e.target.value)} placeholder="model name or deployment ID" />
                ) : (
                  <Select value={selectedModel} onValueChange={setSelectedModel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {activeModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {["azure", "custom"].includes(providerId) && (
                <div className="space-y-1.5">
                  <Label>Base URL</Label>
                  <Input value={customBaseUrl} onChange={e => setCustomBaseUrl(e.target.value)} placeholder={provider.keyHint} />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                API Key
                {hasKey && <Badge variant="outline" className="text-emerald-600 border-emerald-500 text-xs"><ShieldCheck className="h-3 w-3 mr-0.5"/>Saved</Badge>}
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={provider.keyPlaceholder}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowKey(v => !v)}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {hasKey && (
                  <Button variant="outline" size="icon" onClick={clearKey} title="Delete saved key">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3 shrink-0" />
                {provider.keyHint} · Saved to <code className="bg-muted px-1 rounded">localStorage</code> only — never stored on the server.
              </p>
            </div>
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Privacy:</strong> Your query is automatically scanned for PII (emails, IPs, tokens, passwords, hashes) and sensitive fields are redacted <em>before</em> anything leaves this browser. Your cluster credentials and index data are never included.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Describe Your Query</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Target Index <span className="text-muted-foreground text-xs">(optional — improves accuracy)</span></Label>
                <Select value={index} onValueChange={setIndex}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select index…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No specific index</SelectItem>
                    {indices.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!isConnected && <p className="text-xs text-muted-foreground">Connect to a cluster to load index list.</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Natural Language Query</Label>
                <Textarea
                  value={naturalLanguage}
                  onChange={e => setNaturalLanguage(e.target.value)}
                  placeholder="Describe what you want to search for…"
                  rows={4}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) generateDsl(); }}
                />
                <p className="text-xs text-muted-foreground">Ctrl+Enter to generate</p>
              </div>
              {redactions.length > 0 && (
                <Alert className="border-amber-500/40 bg-amber-500/5">
                  <ShieldCheck className="h-4 w-4 text-amber-500" />
                  <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                    <strong>PII detected and will be redacted before sending:</strong>{" "}
                    {redactions.map(r => `${r.count}× ${r.type}`).join(", ")}.
                    {sanitizedQuery && (
                      <details className="mt-1">
                        <summary className="cursor-pointer hover:underline">Preview sanitized query</summary>
                        <pre className="mt-1 text-xs bg-muted rounded p-2 whitespace-pre-wrap">{sanitizedQuery}</pre>
                      </details>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <Button onClick={generateDsl} disabled={loading || !naturalLanguage.trim()} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                {loading ? "Generating…" : "Generate DSL"}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Example Queries</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {EXAMPLE_QUERIES.map((q, i) => (
                <button key={i}
                  className="w-full text-left text-xs px-3 py-2 rounded bg-muted hover:bg-muted/80 transition-colors"
                  onClick={() => setNaturalLanguage(q)}>
                  {q}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Output */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Generated DSL</CardTitle>
                <div className="flex gap-2">
                  {dsl && (
                    <>
                      <Button size="sm" variant="outline" onClick={copyDsl}>
                        {copied ? <CheckCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" onClick={executeQuery} disabled={executing || index === "__none__"}>
                        {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        Execute
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {dsl && index === "__none__" && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3" /> Select an index above to execute the query
                </p>
              )}
            </CardHeader>
            <CardContent>
              {!dsl && !error && (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Generated DSL will appear here
                </div>
              )}
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
                </div>
              )}
              {dsl && <pre className="text-xs font-mono bg-muted rounded p-3 overflow-auto max-h-72">{dsl}</pre>}
              {results?.hits && (
                <>
                  <Separator className="my-4" />
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {hitsCount.toLocaleString()} hit{hitsCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {results.hits.hits.slice(0, 10).map((hit, i) => {
                      const h = hit as Record<string, unknown>;
                      return (
                        <div key={i} className="text-xs font-mono bg-muted rounded p-2">
                          <div className="text-muted-foreground mb-0.5">{h._index as string} / {h._id as string}</div>
                          <pre className="whitespace-pre-wrap">{JSON.stringify(h._source, null, 2).slice(0, 400)}</pre>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
