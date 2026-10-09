"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { useConnection } from "@/contexts/connection-context";
import { EmptyState, PageHeader, SeverityBadge } from "@/components/app";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { Play, Gauge, Clock, AlertCircle, Loader2, Trash2, Database, Save, BookOpen, ChevronDown, ChevronRight, Sparkles, Copy, Check, RefreshCw, X, FileText } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ProfileQuery {
  type: string;
  description: string;
  time_in_nanos: number;
  breakdown: Record<string, number>;
  children?: ProfileQuery[];
}
interface ProfileShard {
  id: string;
  searches: Array<{ query: ProfileQuery[]; rewrite_time: number }>;
  aggregations?: ProfileQuery[];
}
interface ProfileResult {
  shards: ProfileShard[];
}
interface HistoryEntry {
  id: string;
  index: string;
  query: string;
  timestamp: number;
  took?: number;
  hits?: number;
  name?: string;
}
interface SavedQuery {
  id: string;
  name: string;
  index: string;
  query: string;
  savedAt: number;
}

const LS_HISTORY = "qwb-history-v1";
const LS_SAVED = "qwb-saved-v1";
const MAX_HISTORY = 30;

/** Select items can't use "" as a value — sentinel for "all indices" */
const ALL_INDICES = "__all__";

const DEFAULT_QUERY = JSON.stringify({ query: { match_all: {} }, size: 10 }, null, 2);

// ─── Utils ────────────────────────────────────────────────────────────────────
function nsToMs(ns: number) { return (ns / 1e6).toFixed(2); }
function pct(ns: number, total: number) { return total > 0 ? ((ns / total) * 100).toFixed(1) : "0"; }

// ─── Profile Tree ─────────────────────────────────────────────────────────────
function ProfileNode({ node, globalMax }: { node: ProfileQuery; globalMax: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const timePct = parseFloat(pct(node.time_in_nanos, globalMax));
  const barColor = timePct > 60 ? "bg-destructive" : timePct > 30 ? "bg-warning" : timePct > 10 ? "bg-info" : "bg-success";
  const topBreakdown = Object.entries(node.breakdown)
    .filter(([k]) => !k.endsWith("_count"))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="ml-4 border-l-2 border-muted pl-3 mt-2">
      <div className="flex items-start gap-2">
        {hasChildren ? (
          <button onClick={() => setOpen(o => !o)} className="mt-0.5 shrink-0">
            {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        ) : <span className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs font-mono">{node.type}</Badge>
            <span className="text-xs text-muted-foreground font-mono truncate max-w-sm">{node.description}</span>
            <span className="text-xs font-medium ml-auto shrink-0"><span className="tabular-nums">{nsToMs(node.time_in_nanos)} ms ({pct(node.time_in_nanos, globalMax)}%)</span></span>
          </div>
          <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${timePct}%` }} />
          </div>
          {topBreakdown.length > 0 && (
            <div className="mt-1.5 flex gap-2 flex-wrap">
              {topBreakdown.map(([k, v]) => (
                <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {k}: {nsToMs(v)} ms
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {open && hasChildren && node.children!.map((c, i) => (
        <ProfileNode key={i} node={c} globalMax={globalMax} />
      ))}
    </div>
  );
}

// ─── Copy Button ─────────────────────────────────────────────────────────────
function CopyBtn({ text, label = "" }: { text: string; label?: string }) {
  const [c, setC] = useState(false);
  return (
    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
      onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(() => setC(false), 1500); }}>
      {c ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      {label}
    </Button>
  );
}

// ─── AI Settings helper ───────────────────────────────────────────────────────
function aiConfig() {
  if (typeof window === "undefined") return null;
  try {
    // Settings are saved by the AI query page under the "is:ai:" prefix; older builds used "ai-*"
    const get = (k: string, legacy: string) => localStorage.getItem(`is:ai:${k}`) ?? localStorage.getItem(legacy) ?? "";
    const provider = get("provider", "ai-provider") || "openai";
    const apiKey = get("apiKey", "ai-api-key");
    const model = (["azure", "custom"].includes(provider) ? get("customModel", "ai-model") : "") || get("model", "ai-model") || "gpt-4o-mini";
    const endpoint = get("customBaseUrl", "ai-endpoint") || undefined;
    if (!apiKey && provider !== "ollama") return null;
    return { provider, apiKey, model, endpoint };
  } catch {
    return null;
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function QueryWorkbenchPage() {
  const { connectionConfig } = useConnection();
  const [indices, setIndices] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [docId, setDocId] = useState("");

  const [executing, setExecuting] = useState(false);
  const [profiling, setProfiling] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [explainResult, setExplainResult] = useState<Record<string, unknown> | null>(null);
  const [aiExplanation, setAiExplanation] = useState("");
  const [activeTab, setActiveTab] = useState("results");
  const [error, setError] = useState<string | null>(null);
  const [execTime, setExecTime] = useState<number | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [saveName, setSaveName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [indicesSearch, setIndicesSearch] = useState("");

  // Load history/saved on mount
  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem(LS_HISTORY) ?? "[]");
      setHistory(Array.isArray(h) ? h : []);
      const s = JSON.parse(localStorage.getItem(LS_SAVED) ?? "[]");
      setSaved(Array.isArray(s) ? s : []);
    } catch { /*ignore*/ }
  }, []);

  // Load index list
  useEffect(() => {
    if (!connectionConfig) return;
    const client = getElasticsearchClient();
    if (!client) return;
    client.catIndices().then((list: any[]) => {
      const names = list.map((l: any) => l.index).filter(Boolean).sort();
      setIndices(names);
    }).catch(() => {});
  }, [connectionConfig]);

  const persistHistory = useCallback((entries: HistoryEntry[]) => {
    setHistory(entries);
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(entries)); } catch { /* storage unavailable */ }
  }, []);
  const addHistory = useCallback((entry: Omit<HistoryEntry, "id">) => {
    const next: HistoryEntry[] = [{ ...entry, id: Date.now().toString() }, ...history].slice(0, MAX_HISTORY);
    persistHistory(next);
  }, [history, persistHistory]);

  const parseQuery = useCallback((): Record<string, unknown> | null => {
    try { return JSON.parse(query); } catch { return null; }
  }, [query]);

  const execute = useCallback(async (withProfile = false) => {
    const client = getElasticsearchClient();
    if (!client) { setError("Not connected."); return; }
    const parsed = parseQuery();
    if (!parsed) { setError("Invalid JSON query."); return; }
    setError(null);
    if (withProfile) { setProfiling(true); setProfile(null); }
    else { setExecuting(true); setResult(null); }

    const t0 = Date.now();
    try {
      const body = withProfile ? { ...parsed, profile: true } : parsed;
      const endpoint = selectedIndex ? `/${selectedIndex}/_search` : "/_search";
      const resp = await client.genericRequest("POST", endpoint, body);
      const took = Date.now() - t0;
      setExecTime(took);

      if (withProfile) {
        setProfile((resp.profile as ProfileResult) ?? null);
        setResult(resp);
        setActiveTab("profile");
      } else {
        setResult(resp);
        setActiveTab("results");
      }

      addHistory({
        index: selectedIndex || "*",
        query,
        timestamp: Date.now(),
        took,
        hits: (resp.hits as any)?.total?.value ?? (resp.hits as any)?.total ?? 0,
      });
    } catch (e: any) {
      setError(e.message ?? "Query failed");
    } finally {
      setExecuting(false); setProfiling(false);
    }
  }, [selectedIndex, query, addHistory, parseQuery]);

  const explainDoc = useCallback(async () => {
    if (!docId.trim()) { setError("Enter a document ID to explain."); return; }
    if (!selectedIndex) { setError("Select an index to explain a document."); return; }
    const client = getElasticsearchClient();
    if (!client) { setError("Not connected."); return; }
    const parsed = parseQuery();
    if (!parsed) { setError("Invalid JSON query."); return; }
    setError(null); setExplaining(true); setExplainResult(null);
    try {
      const resp = await client.genericRequest("GET", `/${selectedIndex}/_explain/${docId}`, parsed);
      setExplainResult(resp as Record<string, unknown>);
      setActiveTab("explain");
    } catch (e: any) {
      setError(e.message ?? "Explain failed");
    } finally { setExplaining(false); }
  }, [selectedIndex, docId, parseQuery]);

  const askAI = useCallback(async (content: string) => {
    const cfg = aiConfig();
    if (!cfg) { setError("Configure AI provider in the AI Query page first (save API key there)."); return; }
    setAiLoading(true); setAiExplanation(""); setActiveTab("ai");
    try {
      const resp = await fetch("/api/ai-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, ...cfg }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "AI failed");
      setAiExplanation(data.explanation ?? "");
    } catch (e: any) {
      setError(e.message);
    } finally { setAiLoading(false); }
  }, []);

  const saveQuery = () => {
    if (!saveName.trim()) return;
    const entry: SavedQuery = { id: Date.now().toString(), name: saveName, index: selectedIndex, query, savedAt: Date.now() };
    const next = [entry, ...saved];
    setSaved(next);
    try { localStorage.setItem(LS_SAVED, JSON.stringify(next)); } catch { /* storage unavailable */ }
    setSaveName(""); setShowSaveDialog(false);
  };

  const deleteHistoryItem = (id: string) => persistHistory(history.filter(h => h.id !== id));
  const clearHistory = () => persistHistory([]);
  const loadFromHistory = (h: HistoryEntry) => { setSelectedIndex(h.index === "*" ? "" : h.index); setQuery(h.query); };
  const loadFromSaved = (s: SavedQuery) => { setSelectedIndex(s.index); setQuery(s.query); };
  const deleteSaved = (id: string) => {
    const n = saved.filter(s => s.id !== id);
    setSaved(n);
    try { localStorage.setItem(LS_SAVED, JSON.stringify(n)); } catch { /* storage unavailable */ }
  };

  const hits = (result?.hits as any)?.hits ?? [];
  const totalHits = (result?.hits as any)?.total?.value ?? (result?.hits as any)?.total ?? 0;

  const filteredIndices = indicesSearch
    ? indices.filter(i => i.toLowerCase().includes(indicesSearch.toLowerCase()))
    : indices;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Query workbench"
        description="Run, profile and explain search queries against the connected cluster."
        actions={execTime !== null ? (
          <Badge variant="outline" className="gap-1 font-normal tabular-nums">
            <Clock className="h-3 w-3" /> Last run {execTime} ms
          </Badge>
        ) : undefined}
      />

      {!connectionConfig ? (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to run queries."
          action={<Button asChild><Link href="/connections">Go to connections</Link></Button>}
        />
      ) : (
      <div className="grid gap-6 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        {/* ── Editor ── */}
        <Card className="gap-0 py-0 lg:self-start">
          <CardHeader className="border-b px-4 py-3">
            <CardTitle className="text-base">Query</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-2">
              <Label>Index</Label>
              <Select value={selectedIndex || ALL_INDICES} onValueChange={v => setSelectedIndex(v === ALL_INDICES ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All indices (*)" />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Filter indices…"
                      value={indicesSearch}
                      onChange={e => setIndicesSearch(e.target.value)}
                      onKeyDown={e => e.stopPropagation()}
                      className="h-8 text-sm"
                    />
                  </div>
                  <SelectItem value={ALL_INDICES}>All indices (*)</SelectItem>
                  {filteredIndices.slice(0, 100).map(idx => (
                    <SelectItem key={idx} value={idx}>{idx}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="qwb-query">Query DSL (JSON)</Label>
                <div className="flex gap-1">
                  <CopyBtn text={query} />
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setQuery(DEFAULT_QUERY)}>
                    <RefreshCw className="h-3 w-3" /> Reset
                  </Button>
                </div>
              </div>
              <Textarea
                id="qwb-query"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="min-h-[260px] resize-y font-mono text-xs"
                spellCheck={false}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="qwb-doc">Document ID to explain (optional)</Label>
              <Input
                id="qwb-doc"
                placeholder="_id"
                value={docId}
                onChange={e => setDocId(e.target.value)}
                className="font-mono"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => execute(false)} disabled={executing || !connectionConfig}>
                {executing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                Run
              </Button>
              <Button variant="outline" onClick={() => execute(true)} disabled={profiling || !connectionConfig}>
                {profiling ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Gauge className="mr-1 h-4 w-4" />}
                Profile
              </Button>
              <Button variant="outline" onClick={explainDoc} disabled={explaining || !docId || !selectedIndex}>
                {explaining ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                Explain
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => setShowSaveDialog(s => !s)}>
                <Save className="h-3.5 w-3.5" /> Save query
              </Button>
              {aiConfig() && (
                <Button size="sm" variant="ghost" className="gap-1"
                  onClick={() => askAI(`Analyze this Elasticsearch query and tell me: 1) what it does, 2) potential performance issues, 3) optimization suggestions.\n\nIndex: ${selectedIndex || '*'}\n\nQuery:\n${query}`)}>
                  <Sparkles className="h-3.5 w-3.5" /> Review with AI
                </Button>
              )}
            </div>

            {showSaveDialog && (
              <div className="flex gap-2">
                <Input placeholder="Query name" value={saveName} onChange={e => setSaveName(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={saveQuery} disabled={!saveName.trim()}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)} aria-label="Cancel"><X className="h-4 w-4" /></Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Results ── */}
        <Card className="min-w-0 gap-0 py-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0">
            <div className="overflow-x-auto border-b px-4 py-2">
              <TabsList>
                <TabsTrigger value="results">
                  Results {totalHits > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] tabular-nums">{totalHits}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="profile">
                  Profile {profile && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{profile.shards.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="explain">Explain</TabsTrigger>
                <TabsTrigger value="ai">AI review</TabsTrigger>
                <TabsTrigger value="history">
                  History {history.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{history.length}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="saved">
                  Saved {saved.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{saved.length}</Badge>}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Results Tab ── */}
            <TabsContent value="results" className="mt-0 max-h-[70vh] space-y-2 overflow-auto p-4">
              {!result && <p className="py-10 text-center text-sm text-muted-foreground">Run a query to see results.</p>}
              {result && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium tabular-nums">
                      {totalHits.toLocaleString()} hit{totalHits !== 1 ? "s" : ""}
                      {(result.took as number) && <span className="ml-2 font-normal text-muted-foreground">{result.took as number} ms on the cluster</span>}
                    </span>
                    <CopyBtn text={JSON.stringify(result, null, 2)} label="Copy all" />
                  </div>
                  {hits.length > 0 ? hits.map((hit: any, i: number) => (
                    <div key={i} className="rounded-md border text-xs">
                      <div className="flex items-center gap-2 border-b px-3 py-2">
                        <Badge variant="outline" className="font-mono font-normal">{hit._index}</Badge>
                        <span className="truncate font-mono text-muted-foreground">{hit._id}</span>
                        {hit._score != null && <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">score {hit._score?.toFixed(4)}</span>}
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed">
                        {JSON.stringify(hit._source, null, 2)}
                      </pre>
                    </div>
                  )) : (
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </TabsContent>

            {/* ── Profile Tab ── */}
            <TabsContent value="profile" className="mt-0 max-h-[70vh] overflow-auto p-4">
              {!profile && <p className="py-10 text-center text-sm text-muted-foreground">Click <strong>Profile</strong> to see where query time is spent.</p>}
              {profile && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{profile.shards.length} shard{profile.shards.length !== 1 ? "s" : ""} profiled</span>
                    <div className="flex gap-2">
                      {aiConfig() && (
                        <Button size="sm" variant="outline" className="gap-1" disabled={aiLoading}
                          onClick={() => askAI(`Analyze this Elasticsearch query profile. Identify the slowest components, explain what each step means, and provide specific optimization recommendations.\n\nProfile:\n${JSON.stringify(profile, null, 2)}`)}>
                          {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          Explain profile
                        </Button>
                      )}
                      <CopyBtn text={JSON.stringify(profile, null, 2)} label="Copy JSON" />
                    </div>
                  </div>
                  {profile.shards.map((shard, si) => {
                    const allQueries = shard.searches.flatMap(s => s.query);
                    const globalMax = Math.max(1, ...allQueries.map(q => q.time_in_nanos));
                    return (
                      <div key={si} className="rounded-md border p-3">
                        <p className="mb-1 font-mono text-xs text-muted-foreground">{shard.id}</p>
                        {shard.searches.map((search, searchI) => (
                          <div key={searchI}>
                            {search.rewrite_time > 0 && (
                              <p className="mb-1 text-xs text-muted-foreground">Rewrite: {nsToMs(search.rewrite_time)} ms</p>
                            )}
                            {search.query.map((q, qi) => (
                              <ProfileNode key={qi} node={q} globalMax={globalMax} />
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── Explain Tab ── */}
            <TabsContent value="explain" className="mt-0 max-h-[70vh] overflow-auto p-4">
              {!explainResult && <p className="py-10 text-center text-sm text-muted-foreground">Enter a document ID and click <strong>Explain</strong>.</p>}
              {explainResult && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <SeverityBadge level={(explainResult.matched as boolean) ? "ok" : "warning"}>
                        {(explainResult.matched as boolean) ? "Matched" : "Not matched"}
                      </SeverityBadge>
                      <span className="text-sm tabular-nums">Score {((explainResult.explanation as any)?.value ?? 0).toFixed(6)}</span>
                    </div>
                    <div className="flex gap-2">
                      {aiConfig() && (
                        <Button size="sm" variant="outline" className="gap-1" disabled={aiLoading}
                          onClick={() => askAI(`Explain this Elasticsearch relevance score breakdown in plain English. What factors are contributing most to the score? How can I improve the ranking?\n\nExplain output:\n${JSON.stringify(explainResult, null, 2)}`)}>
                          {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          Explain score
                        </Button>
                      )}
                      <CopyBtn text={JSON.stringify(explainResult, null, 2)} label="Copy JSON" />
                    </div>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                    {JSON.stringify(explainResult?.explanation, null, 2)}
                  </pre>
                </div>
              )}
            </TabsContent>

            {/* ── AI Tab ── */}
            <TabsContent value="ai" className="mt-0 max-h-[70vh] overflow-auto p-4">
              {aiLoading && (
                <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Waiting for the AI provider…
                </div>
              )}
              {!aiLoading && !aiExplanation && (
                <div className="space-y-3 py-10 text-center text-sm text-muted-foreground">
                  <p>Use <strong>Review with AI</strong>, <strong>Explain profile</strong> or <strong>Explain score</strong> to get a written analysis.</p>
                  {!aiConfig() && (
                    <p>Configure an AI provider on the <Link href="/ai-query" className="underline underline-offset-4">AI query</Link> page first.</p>
                  )}
                </div>
              )}
              {aiExplanation && (
                <div className="max-w-3xl">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium">AI review</span>
                    <CopyBtn text={aiExplanation} label="Copy" />
                  </div>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 font-sans text-sm leading-relaxed">{aiExplanation}</pre>
                </div>
              )}
            </TabsContent>

            {/* ── History Tab ── */}
            <TabsContent value="history" className="mt-0 max-h-[70vh] overflow-auto p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium">Recent queries ({history.length})</span>
                {history.length > 0 && (
                  <Button variant="ghost" size="sm" className="gap-1" onClick={clearHistory}>
                    <Trash2 className="h-3 w-3" /> Clear
                  </Button>
                )}
              </div>
              {history.length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} role="button" tabIndex={0}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50"
                    onClick={() => loadFromHistory(h)}
                    onKeyDown={e => { if (e.key === "Enter") loadFromHistory(h); }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs font-normal">{h.index}</Badge>
                        {h.hits !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{h.hits.toLocaleString()} hits</span>}
                        {h.took !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{h.took} ms</span>}
                      </div>
                      <pre className="mt-0.5 truncate overflow-hidden font-mono text-xs text-muted-foreground">{h.query.replace(/\s+/g, " ")}</pre>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(h.timestamp).toLocaleTimeString()}</span>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Remove from history"
                        onClick={e => { e.stopPropagation(); deleteHistoryItem(h.id); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* ── Saved Tab ── */}
            <TabsContent value="saved" className="mt-0 max-h-[70vh] overflow-auto p-4">
              <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
                <BookOpen className="h-4 w-4 text-muted-foreground" /> Saved queries ({saved.length})
              </div>
              {saved.length === 0 && <p className="text-sm text-muted-foreground">No saved queries. Write a query and click <strong>Save query</strong>.</p>}
              <div className="space-y-2">
                {saved.map(sq => (
                  <div key={sq.id} role="button" tabIndex={0}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50"
                    onClick={() => loadFromSaved(sq)}
                    onKeyDown={e => { if (e.key === "Enter") loadFromSaved(sq); }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{sq.name}</span>
                        {sq.index && <Badge variant="outline" className="font-mono text-xs font-normal">{sq.index}</Badge>}
                      </div>
                      <pre className="mt-0.5 truncate overflow-hidden font-mono text-xs text-muted-foreground">{sq.query.replace(/\s+/g, " ")}</pre>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(sq.savedAt).toLocaleDateString()}</span>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Delete saved query"
                        onClick={e => { e.stopPropagation(); deleteSaved(sq.id); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
      )}
    </div>
  );
}
