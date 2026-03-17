"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  AlertTriangle, CheckCircle, XCircle, Info, RefreshCw, Loader2,
  ChevronDown, ChevronRight, Search, Lightbulb, TrendingUp,
  Database, Layers, HardDrive, Copy, Check
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CatIndex {
  health: string;
  status: string;
  index: string;
  uuid: string;
  pri: string;
  rep: string;
  "docs.count": string;
  "docs.deleted": string;
  "store.size": string;
  "pri.store.size": string;
}

interface Issue {
  severity: "critical" | "warning" | "info" | "good";
  category: string;
  message: string;
  fix?: string;
}

interface IndexScore {
  index: string;
  health: string;
  status: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  issues: Issue[];
  metrics: {
    docs: number;
    deleted: number;
    storeBytes: number;
    priStoreBytes: number;
    pri: number;
    rep: number;
    deletionRatio: number;
    avgShardSizeGB: number;
  };
  fieldCount?: number; // loaded on demand
}

interface Summary {
  total: number;
  healthy: number; // score >= 80
  needsWork: number; // score 50-79
  critical: number; // score < 50
  totalStoreBytes: number;
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function parseBytes(s: string): number {
  if (!s || s === "-" || s === "b" || s === "") return 0;
  const clean = s.trim().toLowerCase().replace(/\s/g, "");
  const m = clean.match(/^([\d.]+)(b|kb|mb|gb|tb|pb)?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5 };
  return n * (units[m[2] ?? "b"] ?? 1);
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const k = 1024;
  const sz = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), sz.length - 1);
  return `${(b / k ** i).toFixed(1)} ${sz[i]}`;
}

function toGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 45) return "D";
  return "F";
}

// ─── Scoring Engine ───────────────────────────────────────────────────────────
function scoreIndex(idx: CatIndex): IndexScore {
  const issues: Issue[] = [];
  let score = 100;

  const docs = parseInt(idx["docs.count"] ?? "0") || 0;
  const deleted = parseInt(idx["docs.deleted"] ?? "0") || 0;
  const storeBytes = parseBytes(idx["store.size"] ?? "0");
  const priStoreBytes = parseBytes(idx["pri.store.size"] ?? "0");
  const pri = parseInt(idx.pri ?? "1") || 1;
  const rep = parseInt(idx.rep ?? "1");
  const deletionRatio = docs + deleted > 0 ? deleted / (docs + deleted) : 0;
  const avgShardSizeGB = pri > 0 ? priStoreBytes / pri / 1024 ** 3 : 0;

  // 1. Cluster health status
  if (idx.health === "red") {
    score -= 40;
    issues.push({
      severity: "critical",
      category: "Cluster Health",
      message: "Index is RED — one or more primary shards are unassigned. Data may be inaccessible.",
      fix: `POST /_cluster/reroute?retry_failed=true\n\n# If that doesn't work, investigate with:\nGET /_cluster/allocation/explain`,
    });
  } else if (idx.health === "yellow") {
    score -= 8;
    issues.push({
      severity: "warning",
      category: "Cluster Health",
      message: "Index is YELLOW — replica shards are unassigned. In a single-node cluster this is expected.",
      fix: rep === 0
        ? undefined
        : `# Force replica awareness off (single-node only):\nPUT /${idx.index}/_settings\n{\n  "index.number_of_replicas": 0\n}`,
    });
  }

  // 2. Closed index
  if (idx.status === "close") {
    score -= 5;
    issues.push({
      severity: "info",
      category: "Index Status",
      message: "Index is CLOSED — it cannot be searched or written to.",
      fix: `POST /${idx.index}/_open`,
    });
  }

  // 3. Zero replicas (on a non-system index)
  if (rep === 0 && !idx.index.startsWith(".")) {
    score -= 20;
    issues.push({
      severity: "warning",
      category: "High Availability",
      message: "No replicas configured — this index has zero fault tolerance. If the node fails, data is lost.",
      fix: `PUT /${idx.index}/_settings\n{\n  "index.number_of_replicas": 1\n}`,
    });
  }

  // 4. High deletion ratio → forcemerge needed
  if (docs + deleted > 5000 && deletionRatio > 0.25) {
    const pct = (deletionRatio * 100).toFixed(1);
    score -= 10;
    issues.push({
      severity: "warning",
      category: "Storage Efficiency",
      message: `${pct}% of segment space is occupied by deleted (tombstoned) documents. A force-merge will reclaim this space.`,
      fix: `POST /${idx.index}/_forcemerge?only_expunge_deletes=true\n\n# Or full merge to 1 segment (for read-only indices):\nPOST /${idx.index}/_forcemerge?max_num_segments=1`,
    });
  }

  // 5. Shard sizing
  if (priStoreBytes > 0) {
    if (avgShardSizeGB < 0.5 && pri > 1) {
      score -= 15;
      const optimal = Math.max(1, Math.ceil(priStoreBytes / (10 * 1024 ** 3)));
      issues.push({
        severity: "warning",
        category: "Shard Sizing",
        message: `Over-sharded: average primary shard size is ${formatBytes(priStoreBytes / pri)} (recommended: 10–50 GB). Too many small shards increase cluster state and merge overhead.`,
        fix: `# Reindex to a new index with ${optimal} primary shard(s):\nPOST /_reindex\n{\n  "source": { "index": "${idx.index}" },\n  "dest": { "index": "${idx.index}_v2" }\n}\n# Create alias and switch traffic, then delete original.`,
      });
    } else if (avgShardSizeGB > 50) {
      score -= 15;
      const optimal = Math.max(2, Math.ceil(priStoreBytes / (25 * 1024 ** 3)));
      issues.push({
        severity: "warning",
        category: "Shard Sizing",
        message: `Under-sharded: average primary shard size is ${formatBytes(priStoreBytes / pri)} (recommended: 10–50 GB). Large shards slow down recovery and rebalancing.`,
        fix: `# Reindex to new index with ${optimal} primary shards:\nPOST /_reindex\n{\n  "source": { "index": "${idx.index}" },\n  "dest": { "index": "${idx.index}_v2" }\n}`,
      });
    } else {
      issues.push({
        severity: "good",
        category: "Shard Sizing",
        message: `Good shard sizing: average ${formatBytes(priStoreBytes / pri)} per primary shard (target: 10–50 GB).`,
      });
    }
  }

  // 6. System index warnings
  if (idx.index.startsWith(".") && storeBytes > 5 * 1024 ** 3) {
    score -= 5;
    issues.push({
      severity: "info",
      category: "System Index",
      message: `System index is unusually large (${formatBytes(storeBytes)}). Consider reviewing retention settings.`,
    });
  }

  // 7. Perfect score recognition
  if (score >= 100 && issues.filter(i => i.severity !== "good").length === 0) {
    issues.push({
      severity: "good",
      category: "Status",
      message: "Index is healthy and well-configured — no issues detected.",
    });
  }

  return {
    index: idx.index,
    health: idx.health ?? "unknown",
    status: idx.status ?? "open",
    score: Math.max(0, Math.min(100, score)),
    grade: toGrade(Math.max(0, score)),
    issues,
    metrics: { docs, deleted, storeBytes, priStoreBytes, pri, rep, deletionRatio, avgShardSizeGB },
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function HealthDot({ health }: { health: string }) {
  const cls = health === "green" ? "bg-emerald-500" : health === "yellow" ? "bg-yellow-400" : health === "red" ? "bg-red-500" : "bg-gray-400";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls} mr-1.5`} />;
}

function GradeBadge({ grade, score }: { grade: string; score: number }) {
  const colors: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
    B: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    C: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    D: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
    F: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  };
  return (
    <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg font-bold text-lg ${colors[grade] ?? colors.F}`}>
      {grade}
      <span className="text-[10px] font-normal leading-none">{score}</span>
    </div>
  );
}

function SeverityIcon({ s }: { s: Issue["severity"] }) {
  if (s === "critical") return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (s === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  if (s === "good") return <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-500 shrink-0" />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" size="sm" className="h-6 px-1.5"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-start gap-2.5 p-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => issue.fix && setOpen(o => !o)}
      >
        <SeverityIcon s={issue.severity} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{issue.category}</span>
          <p className="text-sm mt-0.5">{issue.message}</p>
        </div>
        {issue.fix && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            Fix {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
      </button>
      {open && issue.fix && (
        <div className="border-t bg-zinc-950 dark:bg-zinc-900 p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-400 font-medium">Remediation</span>
            <CopyButton text={issue.fix} />
          </div>
          <pre className="text-xs text-green-400 whitespace-pre-wrap font-mono leading-relaxed">{issue.fix}</pre>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function IndexAdvisorPage() {
  const { connectionConfig } = useConnection();
  const [scores, setScores] = useState<IndexScore[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadingFields, setLoadingFields] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "critical" | "warning" | "healthy">("all");

  const analyze = useCallback(async () => {
    if (!connectionConfig) { setError("Not connected to any cluster."); return; }
    setLoading(true); setError(null); setScores([]);
    try {
      const client = getElasticsearchClient();
      if (!client) throw new Error("No Elasticsearch client — connect first.");

      const indices: CatIndex[] = await client.catIndices();
      if (!Array.isArray(indices) || indices.length === 0) {
        setError("No indices found on this cluster."); setLoading(false); return;
      }

      const scored = indices.map(scoreIndex).sort((a, b) => a.score - b.score);
      const totalStore = scored.reduce((s, x) => s + x.metrics.storeBytes, 0);
      setSummary({
        total: scored.length,
        healthy: scored.filter(s => s.score >= 80).length,
        needsWork: scored.filter(s => s.score >= 50 && s.score < 80).length,
        critical: scored.filter(s => s.score < 50).length,
        totalStoreBytes: totalStore,
      });
      setScores(scored);
    } catch (e: any) {
      setError(e.message ?? "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [connectionConfig]);

  const loadFieldCount = async (indexName: string) => {
    setLoadingFields(indexName);
    try {
      const client = getElasticsearchClient();
      if (!client) return;
      const mapping = await client.getIndexMapping(indexName);
      const props = mapping?.[indexName]?.mappings?.properties ?? {};
      const count = countFields(props);
      setScores(prev => prev.map(s => s.index === indexName ? { ...s, fieldCount: count } : s));
    } catch { /* silently fail */ } finally {
      setLoadingFields(null);
    }
  };

  function countFields(props: Record<string, any>, depth = 0): number {
    if (depth > 10) return 0;
    return Object.entries(props).reduce((acc, [, v]) => {
      acc += 1;
      if (v.properties) acc += countFields(v.properties, depth + 1);
      if (v.fields) acc += Object.keys(v.fields).length;
      return acc;
    }, 0);
  }

  const filtered = scores.filter(s => {
    const matchSearch = search === "" || s.index.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      activeFilter === "all" ? true :
      activeFilter === "critical" ? s.score < 50 :
      activeFilter === "warning" ? (s.score >= 50 && s.score < 80) :
      s.score >= 80;
    return matchSearch && matchFilter;
  });

  const criticalIssues = scores.flatMap(s => s.issues.filter(i => i.severity === "critical")).length;
  const warningIssues = scores.flatMap(s => s.issues.filter(i => i.severity === "warning")).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-yellow-500" />
            Index Intelligence Advisor
          </h1>
          <p className="text-muted-foreground mt-1">
            Automated scoring and actionable remediation for every index — shard sizing, HA, storage efficiency, and more.
          </p>
        </div>
        <Button onClick={analyze} disabled={loading || !connectionConfig}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {scores.length === 0 ? "Run Analysis" : "Re-analyze"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!connectionConfig && !loading && (
        <Alert>
          <AlertDescription>Connect to an Elasticsearch / OpenSearch cluster first to run the advisor.</AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Indices", value: summary.total, icon: <Database className="h-5 w-5 text-blue-500" />, filter: "all" as const },
            { label: "Healthy (A/B)", value: summary.healthy, icon: <CheckCircle className="h-5 w-5 text-emerald-500" />, filter: "healthy" as const },
            { label: "Needs Work (C/D)", value: summary.needsWork, icon: <AlertTriangle className="h-5 w-5 text-yellow-500" />, filter: "warning" as const },
            { label: "Critical (F)", value: summary.critical, icon: <XCircle className="h-5 w-5 text-red-500" />, filter: "critical" as const },
          ].map(c => (
            <Card key={c.label} className={`cursor-pointer transition-colors ${activeFilter === c.filter ? "ring-2 ring-primary" : "hover:bg-muted/40"}`}
              onClick={() => setActiveFilter(prev => prev === c.filter ? "all" : c.filter)}>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                {c.icon}
                <div>
                  <p className="text-2xl font-bold">{c.value}</p>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Issue rollup */}
      {summary && (criticalIssues > 0 || warningIssues > 0) && (
        <div className="flex gap-3 flex-wrap">
          {criticalIssues > 0 && (
            <Badge variant="destructive" className="text-sm py-1 px-3">
              <XCircle className="h-3.5 w-3.5 mr-1.5" /> {criticalIssues} Critical Issue{criticalIssues !== 1 ? "s" : ""}
            </Badge>
          )}
          {warningIssues > 0 && (
            <Badge className="bg-yellow-500 text-white text-sm py-1 px-3">
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" /> {warningIssues} Warning{warningIssues !== 1 ? "s" : ""}
            </Badge>
          )}
          <Badge variant="secondary" className="text-sm py-1 px-3">
            <HardDrive className="h-3.5 w-3.5 mr-1.5" /> {formatBytes(summary.totalStoreBytes)} total data
          </Badge>
        </div>
      )}

      {/* Filters + search */}
      {scores.length > 0 && (
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Filter by index name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground self-center">
            {filtered.length} / {scores.length} indices
          </p>
        </div>
      )}

      {/* Index list */}
      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(s => (
            <Card key={s.index} className={`transition-all ${expanded === s.index ? "ring-2 ring-primary/50" : ""}`}>
              <button
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
                onClick={() => setExpanded(prev => prev === s.index ? null : s.index)}
              >
                <GradeBadge grade={s.grade} score={s.score} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <HealthDot health={s.health} />
                    <span className="font-mono font-medium truncate">{s.index}</span>
                    {s.index.startsWith(".") && <Badge variant="secondary" className="text-xs">system</Badge>}
                    {s.status === "close" && <Badge variant="outline" className="text-xs">closed</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                    <span>{s.metrics.pri}P / {s.metrics.rep}R shards</span>
                    <span>{s.metrics.docs.toLocaleString()} docs</span>
                    <span>{formatBytes(s.metrics.storeBytes)}</span>
                    {s.fieldCount !== undefined && <span>{s.fieldCount} mapping fields</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.issues.filter(i => i.severity === "critical").length > 0 && (
                    <Badge variant="destructive" className="text-xs">{s.issues.filter(i => i.severity === "critical").length} critical</Badge>
                  )}
                  {s.issues.filter(i => i.severity === "warning").length > 0 && (
                    <Badge className="bg-yellow-500 text-white text-xs">{s.issues.filter(i => i.severity === "warning").length} warnings</Badge>
                  )}
                  <Progress value={s.score} className="w-20 h-2" />
                  {expanded === s.index ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>

              {expanded === s.index && (
                <div className="border-t p-4 space-y-3">
                  <Tabs defaultValue="issues">
                    <TabsList>
                      <TabsTrigger value="issues">Issues &amp; Fixes</TabsTrigger>
                      <TabsTrigger value="metrics">Metrics</TabsTrigger>
                    </TabsList>

                    <TabsContent value="issues" className="space-y-2 mt-3">
                      {s.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}

                      {/* Load field count on demand */}
                      {s.fieldCount === undefined && (
                        <Button variant="outline" size="sm" className="mt-2" disabled={loadingFields === s.index}
                          onClick={() => loadFieldCount(s.index)}>
                          {loadingFields === s.index
                            ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Loading mapping…</>
                            : <><Layers className="h-3 w-3 mr-1.5" />Analyze mapping field count</>}
                        </Button>
                      )}
                      {s.fieldCount !== undefined && s.fieldCount > 500 && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            <strong>Mapping explosion risk:</strong> {s.fieldCount} fields detected. Elasticsearch recommends keeping field counts below 500 to avoid out-of-memory errors in the cluster state.
                            {s.fieldCount > 1000 && (
                              <pre className="mt-2 text-sm font-mono bg-black/30 p-2 rounded">
                                {`PUT /${s.index}/_settings\n{\n  "index.mapping.total_fields.limit": ${Math.ceil(s.fieldCount * 1.2)}\n}`}
                              </pre>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                    </TabsContent>

                    <TabsContent value="metrics" className="mt-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                        {[
                          { label: "Health", value: <span className="capitalize flex items-center gap-1"><HealthDot health={s.health} />{s.health}</span> },
                          { label: "Primary Shards", value: s.metrics.pri },
                          { label: "Replica Shards", value: s.metrics.rep },
                          { label: "Documents", value: s.metrics.docs.toLocaleString() },
                          { label: "Deleted Docs", value: `${s.metrics.deleted.toLocaleString()} (${(s.metrics.deletionRatio * 100).toFixed(1)}%)` },
                          { label: "Total Storage", value: formatBytes(s.metrics.storeBytes) },
                          { label: "Primary Storage", value: formatBytes(s.metrics.priStoreBytes) },
                          { label: "Avg Shard Size", value: formatBytes(s.metrics.priStoreBytes / s.metrics.pri) },
                          { label: "Score", value: `${s.score} / 100 (Grade ${s.grade})` },
                          ...(s.fieldCount !== undefined ? [{ label: "Mapping Fields", value: `${s.fieldCount}` }] : []),
                        ].map(m => (
                          <div key={m.label} className="bg-muted/40 rounded p-2">
                            <p className="text-xs text-muted-foreground">{m.label}</p>
                            <p className="font-medium mt-0.5">{m.value}</p>
                          </div>
                        ))}
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {scores.length === 0 && !loading && !error && connectionConfig && (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center text-center gap-3">
            <TrendingUp className="h-12 w-12 text-muted-foreground/40" />
            <CardTitle className="text-lg">Ready to Analyze</CardTitle>
            <p className="text-muted-foreground max-w-md">
              Click <strong>Run Analysis</strong> to score every index on your cluster—shard sizing, health, high availability, storage efficiency, and mapping quality.
            </p>
            <Button onClick={analyze} className="mt-2">
              <Lightbulb className="h-4 w-4 mr-2" /> Run Analysis
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
