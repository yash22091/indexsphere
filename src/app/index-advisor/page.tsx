"use client";

import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { useConnection } from "@/contexts/connection-context";
import { EmptyState, HealthBadge, PageHeader, SeverityBadge, StatCard, StatGrid, StatusDot } from "@/components/app";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  AlertTriangle, AlertCircle, CheckCircle, XCircle, Info, RefreshCw, Loader2,
  ChevronDown, ChevronRight, Search, Lightbulb,
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
function GradeBadge({ grade, score }: { grade: string; score: number }) {
  const tone =
    grade === "A" || grade === "B" ? "bg-success/15 text-success" :
    grade === "C" || grade === "D" ? "bg-warning/20 text-warning-foreground dark:text-warning" :
    "bg-destructive/15 text-destructive";
  return (
    <div className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-md text-base font-semibold ${tone}`}>
      {grade}
      <span className="text-[10px] font-normal leading-none tabular-nums">{score}</span>
    </div>
  );
}

function SeverityIcon({ s }: { s: Issue["severity"] }) {
  if (s === "critical") return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  if (s === "warning") return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />;
  if (s === "good") return <CheckCircle className="h-4 w-4 shrink-0 text-success" />;
  return <Info className="h-4 w-4 shrink-0 text-info" />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" size="sm" className="h-6 px-1.5" aria-label="Copy"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-md border">
      <button
        className="flex w-full items-start gap-2.5 p-3 text-left transition-colors hover:bg-muted/50"
        onClick={() => issue.fix && setOpen(o => !o)}
      >
        <SeverityIcon s={issue.severity} />
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium text-muted-foreground">{issue.category}</span>
          <p className="mt-0.5 text-sm">{issue.message}</p>
        </div>
        {issue.fix && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            Fix {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
      </button>
      {open && issue.fix && (
        <div className="border-t bg-muted/50 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Remediation</span>
            <CopyButton text={issue.fix} />
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{issue.fix}</pre>
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

  const filterCards = summary ? [
    { label: "Indices", value: summary.total, icon: Database, filter: "all" as const, tone: "default" as const },
    { label: "Healthy (A–B)", value: summary.healthy, icon: CheckCircle, filter: "healthy" as const, tone: "success" as const },
    { label: "Needs work (C–D)", value: summary.needsWork, icon: AlertTriangle, filter: "warning" as const, tone: summary.needsWork ? "warning" as const : "default" as const },
    { label: "Critical (F)", value: summary.critical, icon: XCircle, filter: "critical" as const, tone: summary.critical ? "danger" as const : "default" as const },
  ] : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Index advisor"
        description="Scores every index for shard sizing, availability, storage efficiency and mapping size, with the command to fix each issue."
        actions={
          <Button onClick={analyze} disabled={loading || !connectionConfig}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {scores.length === 0 ? "Run analysis" : "Re-analyze"}
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!connectionConfig && !loading && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to run the advisor."
          action={<Button asChild><Link href="/connections">Go to connections</Link></Button>}
        />
      )}

      {summary && (
        <StatGrid>
          {filterCards.map(c => (
            <button key={c.label} type="button" className="text-left"
              aria-pressed={activeFilter === c.filter}
              onClick={() => setActiveFilter(prev => prev === c.filter ? "all" : c.filter)}>
              <StatCard
                label={c.label}
                value={c.value.toLocaleString()}
                icon={c.icon}
                tone={c.tone}
                hint={activeFilter === c.filter && c.filter !== "all" ? "Filter applied — click to clear" : "Click to filter"}
                className={activeFilter === c.filter && c.filter !== "all" ? "ring-2 ring-ring" : "transition-colors hover:bg-muted/40"}
              />
            </button>
          ))}
        </StatGrid>
      )}

      {summary && (criticalIssues > 0 || warningIssues > 0) && (
        <div className="flex flex-wrap gap-2">
          {criticalIssues > 0 && (
            <SeverityBadge level="critical">{criticalIssues} critical issue{criticalIssues !== 1 ? "s" : ""}</SeverityBadge>
          )}
          {warningIssues > 0 && (
            <SeverityBadge level="warning">{warningIssues} warning{warningIssues !== 1 ? "s" : ""}</SeverityBadge>
          )}
          <Badge variant="outline" className="gap-1.5 font-normal">
            <HardDrive className="h-3.5 w-3.5 text-muted-foreground" /> {formatBytes(summary.totalStoreBytes)} total data
          </Badge>
        </div>
      )}

      {scores.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Filter by index name" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {filtered.length} of {scores.length} indices
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(s => (
            <Card key={s.index} className={`gap-0 py-0 ${expanded === s.index ? "ring-1 ring-ring" : ""}`}>
              <button
                className="flex w-full items-center gap-3 rounded-t-xl p-4 text-left transition-colors hover:bg-muted/30"
                onClick={() => setExpanded(prev => prev === s.index ? null : s.index)}
                aria-expanded={expanded === s.index}
              >
                <GradeBadge grade={s.grade} score={s.score} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot status={s.health} />
                    <span className="truncate font-mono text-sm font-medium">{s.index}</span>
                    {s.index.startsWith(".") && <Badge variant="secondary" className="text-xs font-normal">system</Badge>}
                    {s.status === "close" && <Badge variant="outline" className="text-xs font-normal">closed</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted-foreground tabular-nums">
                    <span>{s.metrics.pri}p / {s.metrics.rep}r shards</span>
                    <span>{s.metrics.docs.toLocaleString()} docs</span>
                    <span>{formatBytes(s.metrics.storeBytes)}</span>
                    {s.fieldCount !== undefined && <span>{s.fieldCount} mapping fields</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {s.issues.filter(i => i.severity === "critical").length > 0 && (
                    <SeverityBadge level="critical" className="hidden sm:inline-flex">{s.issues.filter(i => i.severity === "critical").length} critical</SeverityBadge>
                  )}
                  {s.issues.filter(i => i.severity === "warning").length > 0 && (
                    <SeverityBadge level="warning" className="hidden sm:inline-flex">{s.issues.filter(i => i.severity === "warning").length} warnings</SeverityBadge>
                  )}
                  <Progress value={s.score} className="hidden h-1.5 w-20 md:block" />
                  {expanded === s.index ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>

              {expanded === s.index && (
                <div className="space-y-3 border-t p-4">
                  <Tabs defaultValue="issues">
                    <TabsList>
                      <TabsTrigger value="issues">Issues and fixes</TabsTrigger>
                      <TabsTrigger value="metrics">Metrics</TabsTrigger>
                    </TabsList>

                    <TabsContent value="issues" className="mt-3 space-y-2">
                      {s.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}

                      {s.fieldCount === undefined && (
                        <Button variant="outline" size="sm" className="mt-2" disabled={loadingFields === s.index}
                          onClick={() => loadFieldCount(s.index)}>
                          {loadingFields === s.index
                            ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Loading mapping…</>
                            : <><Layers className="mr-1.5 h-3 w-3" />Count mapping fields</>}
                        </Button>
                      )}
                      {s.fieldCount !== undefined && s.fieldCount > 500 && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            <span><strong>Mapping explosion risk:</strong> {s.fieldCount} fields. Keep field counts below 500 to avoid memory pressure from a large cluster state.</span>
                            {s.fieldCount > 1000 && (
                              <pre className="mt-2 rounded-md bg-muted p-2 font-mono text-xs text-foreground">
                                {`PUT /${s.index}/_settings\n{\n  "index.mapping.total_fields.limit": ${Math.ceil(s.fieldCount * 1.2)}\n}`}
                              </pre>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                    </TabsContent>

                    <TabsContent value="metrics" className="mt-3">
                      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                        {[
                          { label: "Health", value: <HealthBadge status={s.health} /> },
                          { label: "Primary shards", value: s.metrics.pri },
                          { label: "Replica shards", value: s.metrics.rep },
                          { label: "Documents", value: s.metrics.docs.toLocaleString() },
                          { label: "Deleted docs", value: `${s.metrics.deleted.toLocaleString()} (${(s.metrics.deletionRatio * 100).toFixed(1)}%)` },
                          { label: "Total storage", value: formatBytes(s.metrics.storeBytes) },
                          { label: "Primary storage", value: formatBytes(s.metrics.priStoreBytes) },
                          { label: "Avg. shard size", value: formatBytes(s.metrics.priStoreBytes / s.metrics.pri) },
                          { label: "Score", value: `${s.score} / 100 (grade ${s.grade})` },
                          ...(s.fieldCount !== undefined ? [{ label: "Mapping fields", value: `${s.fieldCount}` }] : []),
                        ].map(m => (
                          <div key={m.label} className="rounded-md border p-2.5">
                            <p className="text-xs text-muted-foreground">{m.label}</p>
                            <div className="mt-0.5 font-medium tabular-nums">{m.value}</div>
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

      {scores.length === 0 && !loading && !error && connectionConfig && (
        <EmptyState
          icon={Lightbulb}
          title="No analysis yet"
          description="Run the analysis to score every index on shard sizing, health, availability, storage efficiency and mapping size."
          action={
            <Button onClick={analyze}>
              <RefreshCw className="mr-2 h-4 w-4" /> Run analysis
            </Button>
          }
        />
      )}
    </div>
  );
}
