"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  Play, Gauge, Search, Clock, AlertTriangle, Loader2, Trash2,
  Save, BookOpen, ChevronDown, ChevronRight, Sparkles, Copy, Check,
  RefreshCw, X, FileText
} from "lucide-react";

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

const DEFAULT_QUERY = JSON.stringify({ query: { match_all: {} }, size: 10 }, null, 2);

// ─── Utils ────────────────────────────────────────────────────────────────────
function nsToMs(ns: number) { return (ns / 1e6).toFixed(2); }
function pct(ns: number, total: number) { return total > 0 ? ((ns / total) * 100).toFixed(1) : "0"; }

function getMaxTime(queries: ProfileQuery[]): number {
  return Math.max(...queries.map(q => q.time_in_nanos));
}

// ─── Profile Tree ─────────────────────────────────────────────────────────────
function ProfileNode({ node, globalMax }: { node: ProfileQuery; globalMax: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const timePct = parseFloat(pct(node.time_in_nanos, globalMax));
  const barColor = timePct > 60 ? "bg-red-500" : timePct > 30 ? "bg-orange-400" : timePct > 10 ? "bg-yellow-400" : "bg-emerald-500";
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
            <span className="text-xs font-medium ml-auto shrink-0">{nsToMs(node.time_in_nanos)} ms ({pct(node.time_in_nanos, globalMax)}%)</span>
          </div>
          <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${timePct}%` }} />
          </div>
          {topBreakdown.length > 0 && (
            <div className="mt-1.5 flex gap-2 flex-wrap">
              {topBreakdown.map(([k, v]) => (
                <span key={k} className="text-xs text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 font-mono">
                  {k}: {nsToMs(v)}ms
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
      {c ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {label}
    </Button>
  );
}

// ─── AI Settings helper ───────────────────────────────────────────────────────
function aiConfig() {
  if (typeof window === "undefined") return null;
  const provider = localStorage.getItem("ai-provider") ?? "openai";
  const apiKey = localStorage.getItem("ai-api-key") ?? "";
  const model = localStorage.getItem("ai-model") ?? "gpt-4o-mini";
  const endpoint = localStorage.getItem("ai-endpoint") ?? "";
  if (!apiKey && provider !== "ollama") return null;
  return { provider, apiKey, model, endpoint };
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

  function persistHistory(entries: HistoryEntry[]) {
    setHistory(entries);
    localStorage.setItem(LS_HISTORY, JSON.stringify(entries));
  }
  function addHistory(entry: Omit<HistoryEntry, "id">) {
    const next: HistoryEntry[] = [{ ...entry, id: Date.now().toString() }, ...history].slice(0, MAX_HISTORY);
    persistHistory(next);
  }

  function parseQuery(): Record<string, unknown> | null {
    try { return JSON.parse(query); } catch { return null; }
  }

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
  }, [selectedIndex, query, history]);

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
  }, [selectedIndex, docId, query]);

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
    setSaved(next); localStorage.setItem(LS_SAVED, JSON.stringify(next));
    setSaveName(""); setShowSaveDialog(false);
  };

  const deleteHistoryItem = (id: string) => persistHistory(history.filter(h => h.id !== id));
  const clearHistory = () => persistHistory([]);
  const loadFromHistory = (h: HistoryEntry) => { setSelectedIndex(h.index === "*" ? "" : h.index); setQuery(h.query); };
  const loadFromSaved = (s: SavedQuery) => { setSelectedIndex(s.index); setQuery(s.query); };
  const deleteSaved = (id: string) => { const n = saved.filter(s => s.id !== id); setSaved(n); localStorage.setItem(LS_SAVED, JSON.stringify(n)); };

  const hits = (result?.hits as any)?.hits ?? [];
  const totalHits = (result?.hits as any)?.total?.value ?? (result?.hits as any)?.total ?? 0;

  const filteredIndices = indicesSearch
    ? indices.filter(i => i.toLowerCase().includes(indicesSearch.toLowerCase()))
    : indices;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── Left Panel: Editor ── */}
      <div className="w-[42%] min-w-[320px] border-r flex flex-col">
        <div className="p-4 border-b space-y-3">
          <h1 className="font-bold text-lg flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" /> Query Workbench
          </h1>

          {/* Index Selector */}
          <div>
            <Label className="text-xs mb-1 block">Index (leave blank for all)</Label>
            <Select value={selectedIndex} onValueChange={setSelectedIndex}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All indices (*)" />
              </SelectTrigger>
              <SelectContent>
                <div className="p-2">
                  <Input
                    placeholder="Search indices…"
                    value={indicesSearch}
                    onChange={e => setIndicesSearch(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
                <SelectItem value="">All indices (*)</SelectItem>
                {filteredIndices.slice(0, 100).map(idx => (
                  <SelectItem key={idx} value={idx}>{idx}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Query Editor */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Query (DSL JSON)</Label>
            <div className="flex gap-1">
              <CopyBtn text={query} />
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setQuery(DEFAULT_QUERY)}>
                <RefreshCw className="h-3 w-3" /> Reset
              </Button>
            </div>
          </div>
          <Textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 font-mono text-xs resize-none min-h-[200px]"
            spellCheck={false}
          />

          {/* Explain Doc ID */}
          <div>
            <Label className="text-xs mb-1 block">Explain Doc ID (optional)</Label>
            <Input
              placeholder="document _id…"
              value={docId}
              onChange={e => setDocId(e.target.value)}
              className="h-8 text-sm font-mono"
            />
          </div>

          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => execute(false)} disabled={executing || !connectionConfig} className="flex-1">
              {executing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              Execute
            </Button>
            <Button size="sm" variant="outline" onClick={() => execute(true)} disabled={profiling || !connectionConfig} className="flex-1">
              {profiling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Gauge className="h-4 w-4 mr-1" />}
              Profile
            </Button>
            <Button size="sm" variant="outline" onClick={explainDoc} disabled={explaining || !docId || !selectedIndex} className="flex-1">
              {explaining ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
              Explain Doc
            </Button>
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => setShowSaveDialog(s => !s)}>
              <Save className="h-3.5 w-3.5" /> Save Query
            </Button>
            {aiConfig() && (
              <Button size="sm" variant="ghost" className="text-xs gap-1"
                onClick={() => askAI(`Analyze this Elasticsearch query and tell me: 1) what it does, 2) potential performance issues, 3) optimization suggestions.\n\nIndex: ${selectedIndex || '*'}\n\nQuery:\n${query}`)}>
                <Sparkles className="h-3.5 w-3.5 text-purple-500" /> AI Analyze Query
              </Button>
            )}
          </div>

          {showSaveDialog && (
            <div className="flex gap-2">
              <Input placeholder="Query name…" value={saveName} onChange={e => setSaveName(e.target.value)} className="h-8 text-sm flex-1" />
              <Button size="sm" onClick={saveQuery} disabled={!saveName.trim()}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)}><X className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel: Results ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b px-4 pt-2 flex items-center gap-2">
            <TabsList className="h-8">
              <TabsTrigger value="results" className="text-xs h-7">
                Results {totalHits > 0 && <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{totalHits}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="profile" className="text-xs h-7">
                Profile {profile && <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{profile.shards.length}S</Badge>}
              </TabsTrigger>
              <TabsTrigger value="explain" className="text-xs h-7">Explain</TabsTrigger>
              <TabsTrigger value="ai" className="text-xs h-7">
                <Sparkles className="h-3 w-3 mr-1 text-purple-500" />AI
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs h-7">
                History {history.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{history.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="saved" className="text-xs h-7">
                Saved {saved.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 text-[10px]">{saved.length}</Badge>}
              </TabsTrigger>
            </TabsList>
            {execTime !== null && (
              <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                <Clock className="h-3 w-3" /> {execTime}ms
              </span>
            )}
          </div>

          {/* ── Results Tab ── */}
          <TabsContent value="results" className="flex-1 overflow-auto p-4 space-y-2 mt-0">
            {!result && <p className="text-muted-foreground text-sm text-center mt-10">No results yet — execute a query.</p>}
            {result && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {totalHits.toLocaleString()} hit{totalHits !== 1 ? "s" : ""}
                    {(result.took as number) && <span className="text-muted-foreground ml-2">({result.took as number} ms took)</span>}
                  </span>
                  <CopyBtn text={JSON.stringify(result, null, 2)} label="Copy All" />
                </div>
                {hits.length > 0 ? hits.map((hit: any, i: number) => (
                  <Card key={i} className="text-xs">
                    <CardHeader className="py-2 px-3 flex-row items-center gap-2">
                      <Badge variant="outline" className="font-mono">{hit._index}</Badge>
                      <span className="font-mono text-muted-foreground">{hit._id}</span>
                      {hit._score != null && <span className="ml-auto text-muted-foreground">score {hit._score?.toFixed(4)}</span>}
                    </CardHeader>
                    <CardContent className="py-2 px-3">
                      <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed overflow-x-auto">
                        {JSON.stringify(hit._source, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )) : (
                  <pre className="text-xs font-mono bg-muted/30 p-3 rounded-lg overflow-x-auto leading-relaxed">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Profile Tab ── */}
          <TabsContent value="profile" className="flex-1 overflow-auto p-4 mt-0">
            {!profile && <p className="text-muted-foreground text-sm text-center mt-10">No profile data yet — click <strong>Profile</strong>.</p>}
            {profile && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{profile.shards.length} shard{profile.shards.length !== 1 ? "s" : ""} profiled</span>
                  <div className="flex gap-2">
                    {aiConfig() && (
                      <Button size="sm" variant="outline" className="text-xs gap-1" disabled={aiLoading}
                        onClick={() => askAI(`Analyze this Elasticsearch query profile. Identify the slowest components, explain what each step means, and provide specific optimization recommendations.\n\nProfile:\n${JSON.stringify(profile, null, 2)}`)}>
                        {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-purple-500" />}
                        AI Explain Profile
                      </Button>
                    )}
                    <CopyBtn text={JSON.stringify(profile, null, 2)} label="Copy JSON" />
                  </div>
                </div>
                {profile.shards.map((shard, si) => {
                  const allQueries = shard.searches.flatMap(s => s.query);
                  const globalMax = Math.max(1, ...allQueries.map(q => q.time_in_nanos));
                  return (
                    <Card key={si}>
                      <CardHeader className="py-3 px-4">
                        <CardTitle className="text-xs font-mono text-muted-foreground">{shard.id}</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4 space-y-3">
                        {shard.searches.map((search, searchI) => (
                          <div key={searchI}>
                            {search.rewrite_time > 0 && (
                              <p className="text-xs text-muted-foreground mb-1">Rewrite: {nsToMs(search.rewrite_time)}ms</p>
                            )}
                            {search.query.map((q, qi) => (
                              <ProfileNode key={qi} node={q} globalMax={globalMax} />
                            ))}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Explain Tab ── */}
          <TabsContent value="explain" className="flex-1 overflow-auto p-4 mt-0">
            {!explainResult && <p className="text-muted-foreground text-sm text-center mt-10">Enter a doc ID and click <strong>Explain Doc</strong>.</p>}
            {explainResult && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Badge variant={(explainResult.matched as boolean) ? "default" : "secondary"}>
                      {(explainResult.matched as boolean) ? "MATCHED" : "NOT MATCHED"}
                    </Badge>
                    <span className="ml-2 text-sm">Score: {((explainResult.explanation as any)?.value ?? 0).toFixed(6)}</span>
                  </div>
                  <div className="flex gap-2">
                    {aiConfig() && (
                      <Button size="sm" variant="outline" className="text-xs gap-1" disabled={aiLoading}
                        onClick={() => askAI(`Explain this Elasticsearch relevance score breakdown in plain English. What factors are contributing most to the score? How can I improve the ranking?\n\nExplain output:\n${JSON.stringify(explainResult, null, 2)}`)}>
                        {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-purple-500" />}
                        AI Explain Score
                      </Button>
                    )}
                    <CopyBtn text={JSON.stringify(explainResult, null, 2)} label="Copy JSON" />
                  </div>
                </div>
                <pre className="text-xs font-mono bg-muted/30 p-3 rounded-lg overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(explainResult?.explanation, null, 2)}
                </pre>
              </div>
            )}
          </TabsContent>

          {/* ── AI Tab ── */}
          <TabsContent value="ai" className="flex-1 overflow-auto p-4 mt-0">
            {aiLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm mt-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Analyzing with AI…
              </div>
            )}
            {!aiLoading && !aiExplanation && (
              <div className="text-center text-muted-foreground text-sm mt-10 space-y-2">
                <Sparkles className="h-8 w-8 mx-auto text-purple-400/60" />
                <p>Use the <strong>AI Analyze Query</strong> or <strong>AI Explain Profile</strong> buttons to get an intelligent analysis.</p>
                {!aiConfig() && (
                  <Alert className="mt-4 max-w-sm mx-auto">
                    <AlertDescription className="text-xs">
                      Configure your AI provider in the <strong>AI Query</strong> page first.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
            {aiExplanation && (
              <div className="max-w-2xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-purple-500" /> AI Analysis
                  </span>
                  <CopyBtn text={aiExplanation} label="Copy" />
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/30 p-4 rounded-lg">{aiExplanation}</pre>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── History Tab ── */}
          <TabsContent value="history" className="flex-1 overflow-auto p-4 mt-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Recent Queries ({history.length})</span>
              {history.length > 0 && (
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={clearHistory}>
                  <Trash2 className="h-3 w-3" /> Clear
                </Button>
              )}
            </div>
            {history.length === 0 && <p className="text-muted-foreground text-sm">No history yet.</p>}
            <div className="space-y-2">
              {history.map(h => (
                <Card key={h.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => loadFromHistory(h)}>
                  <CardContent className="py-2 px-3 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs font-mono">{h.index}</Badge>
                        {h.hits !== undefined && <span className="text-xs text-muted-foreground">{h.hits.toLocaleString()} hits</span>}
                        {h.took !== undefined && <span className="text-xs text-muted-foreground">{h.took}ms</span>}
                      </div>
                      <pre className="text-xs font-mono text-muted-foreground truncate mt-0.5 overflow-hidden">{h.query.replace(/\s+/g, " ")}</pre>
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={e => { e.stopPropagation(); deleteHistoryItem(h.id); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ── Saved Tab ── */}
          <TabsContent value="saved" className="flex-1 overflow-auto p-4 mt-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" /> Saved Queries ({saved.length})
              </span>
            </div>
            {saved.length === 0 && <p className="text-muted-foreground text-sm">No saved queries. Write a query and click <strong>Save Query</strong>.</p>}
            <div className="space-y-2">
              {saved.map(s => (
                <Card key={s.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => loadFromSaved(s)}>
                  <CardContent className="py-2 px-3 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{s.name}</span>
                        {s.index && <Badge variant="outline" className="text-xs font-mono">{s.index}</Badge>}
                      </div>
                      <pre className="text-xs font-mono text-muted-foreground truncate mt-0.5 overflow-hidden">{s.query.replace(/\s+/g, " ")}</pre>
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(s.savedAt).toLocaleDateString()}
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={e => { e.stopPropagation(); deleteSaved(s.id); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
