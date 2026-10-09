"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VulnerabilityBanner } from "@/components/security/vulnerability-banner";
import { ReviewSummaryCard } from "@/components/best-practices/review-view";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ClickHouseGate, ClickHouseHeader, ClickHouseStatus, chFetch, formatBytes, formatCompact, formatDuration,
  formatMs, formatNumber, MiniChart, StatTile, ErrorBanner,
} from "@/components/clickhouse/shared";
import { Combine, FileText, FolderTree, HardDrive, Import, Info, Lightbulb, ListTree, Loader2, Network, RefreshCw, Shuffle, Terminal } from "lucide-react";

type Row = Record<string, any>;

interface Overview {
  server: { version: string; uptime: number; host: string; timezone: string; user: string };
  storage: Row | null;
  databases: number;
  activity: Row | null;
  memory: { tracked: number | null; total: number | null; available: number | null };
  load1: number | null;
  maxPartsPerPartition: number | null;
  connections: { tcp: number | null; http: number | null };
  disks: Row[];
  replication: Row | null;
  topTables: Row[];
  queries1h: Row | null;
  recentErrors: Row[];
  unavailable: string[];
}

interface MetricSample {
  timestamp: number;
  ch_running_queries: number;
  ch_merges_running: number;
  ch_memory_bytes: number;
  ch_memory_percent: number;
  ch_max_parts_per_partition: number;
  ch_replica_delay_seconds: number;
  ch_load1: number;
  ch_queries_per_sec: number;
  ch_insert_rows_per_sec: number;
  ch_failed_queries_5m: number;
}

const HISTORY = 60;
const n = (v: unknown) => Number(v ?? 0) || 0;

const LIVE: { key: keyof MetricSample; label: string; color: string; fmt: (v: number) => string; tone?: (v: number) => "ok" | "warn" | "crit" }[] = [
  { key: "ch_running_queries", label: "Running queries", color: "var(--chart-1)", fmt: v => formatNumber(v) },
  { key: "ch_memory_percent", label: "Memory tracked %", color: "var(--chart-2)", fmt: v => `${v.toFixed(1)}%`, tone: v => (v > 90 ? "crit" : v > 75 ? "warn" : "ok") },
  { key: "ch_queries_per_sec", label: "Queries / sec", color: "var(--chart-3)", fmt: v => v.toFixed(2) },
  { key: "ch_insert_rows_per_sec", label: "Inserted rows / sec", color: "var(--chart-4)", fmt: v => formatCompact(v) },
  // insert-batch-size: > 300 parts per partition means inserts are too small/frequent
  { key: "ch_max_parts_per_partition", label: "Max parts / partition", color: "var(--chart-5)", fmt: v => formatNumber(v), tone: v => (v > 1000 ? "crit" : v > 300 ? "warn" : "ok") },
  { key: "ch_failed_queries_5m", label: "Failed queries (5m)", color: "var(--chart-1)", fmt: v => formatNumber(v), tone: v => (v > 0 ? "warn" : "ok") },
];

const UNAVAILABLE_LABELS: Record<string, string> = {
  storage: "storage stats (system.parts)",
  databases: "database list",
  activity: "activity (processes / merges / mutations)",
  async_metrics: "system.asynchronous_metrics",
  metrics: "system.metrics",
  disks: "system.disks",
  replicas: "system.replicas",
  top_tables: "table sizes",
  query_log: "system.query_log",
  errors: "system.errors",
};

function toneClass(t?: "ok" | "warn" | "crit") {
  return t === "crit" ? "text-destructive" : t === "warn" ? "text-warning" : "";
}

function OverviewContent({ status, disconnect }: { status: ClickHouseStatus; disconnect: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<MetricSample[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await chFetch<Overview>("/api/clickhouse/overview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, []);

  const polling = useRef(false);
  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (polling.current) return; // previous request still running — never stack requests
    polling.current = true;
    try {
      const m = await chFetch<MetricSample>("/api/clickhouse/metrics");
      setHistory(h => [...h, m].slice(-HISTORY));
      setLiveError(null);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : "Live metrics unavailable");
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    poll();
    timer.current = setInterval(poll, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [poll]);

  const s = data?.storage;
  const compressed = n(s?.compressed);
  const ratio = compressed > 0 ? n(s?.uncompressed) / compressed : 0;
  const latest = history[history.length - 1];
  const memTotal = n(data?.memory.total);
  const memTracked = n(data?.memory.tracked);
  const q1h = data?.queries1h;

  return (
    <div className="space-y-6">
      <ClickHouseHeader
        title="ClickHouse overview"
        description="Server health, storage and live activity."
        status={status}
        onDisconnect={disconnect}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}Refresh
          </Button>
        }
      />

      <VulnerabilityBanner target="clickhouse" />

      <div className="flex flex-wrap gap-2">
        {[
          { href: "/clickhouse/explorer", label: "Explorer", icon: FolderTree },
          { href: "/clickhouse/queries", label: "Query activity", icon: ListTree },
          { href: "/clickhouse/sql", label: "SQL workbench", icon: Terminal },
          { href: "/clickhouse/advisor", label: "Table advisor", icon: Lightbulb },
          { href: "/clickhouse/merges", label: "Merges & mutations", icon: Combine },
          { href: "/clickhouse/storage", label: "Storage", icon: HardDrive },
          { href: "/clickhouse/ingestion", label: "Ingestion", icon: Import },
          { href: "/clickhouse/replication", label: "Replication", icon: Network },
          { href: "/clickhouse/server", label: "Server & logs", icon: FileText },
          { href: "/clickhouse/migrate", label: "Migrate from Elasticsearch", icon: Shuffle },
        ].map(l => (
          <Link key={l.href} href={l.href}>
            <Button variant="outline" size="sm"><l.icon className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />{l.label}</Button>
          </Link>
        ))}
      </div>

      <ErrorBanner message={error} />

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : data && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <StatTile label="Version" value={data.server.version} sub={`up ${formatDuration(data.server.uptime)} · ${data.server.host}`} />
            <StatTile label="Databases" value={formatNumber(data.databases)} />
            <StatTile label="Tables" value={formatNumber(s?.tables)} sub={`${formatNumber(s?.parts)} active parts`} />
            <StatTile label="Total rows" value={formatCompact(s?.rows)} sub={formatNumber(s?.rows)} />
            <StatTile label="Size on disk" value={formatBytes(s?.bytes_on_disk)} sub={`${formatBytes(s?.uncompressed)} uncompressed`} />
            <StatTile label="Compression" value={ratio ? `${ratio.toFixed(1)}x` : "—"} tone={ratio && ratio < 2 ? "warn" : "ok"} />
            <StatTile label="Running queries" value={formatNumber(data.activity?.running_queries)} />
            <StatTile label="Merges" value={formatNumber(data.activity?.merges)} />
            <StatTile label="Pending mutations" value={formatNumber(data.activity?.pending_mutations)} tone={n(data.activity?.pending_mutations) > 0 ? "warn" : "ok"} />
            <StatTile
              label="Queries (1h)"
              value={q1h ? formatNumber(q1h.finished) : "—"}
              sub={q1h ? `${formatNumber(q1h.failed)} failed · p95 ${formatMs(q1h.p95_ms)}` : "query_log unavailable"}
              tone={q1h && n(q1h.failed) > 0 ? "warn" : "ok"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Memory &amp; load</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-muted-foreground">Tracked by ClickHouse</span>
                    <span className="tabular-nums">{formatBytes(memTracked)} / {memTotal ? formatBytes(memTotal) : "?"}</span>
                  </div>
                  <Progress value={memTotal ? Math.min(100, (memTracked / memTotal) * 100) : 0} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted-foreground">OS available</div><div className="font-medium">{data.memory.available != null ? formatBytes(data.memory.available) : "—"}</div></div>
                  <div><div className="text-muted-foreground">Load (1m)</div><div className="font-medium">{data.load1 != null ? data.load1.toFixed(2) : "—"}</div></div>
                  <div><div className="text-muted-foreground">Connections</div><div className="font-medium">TCP {data.connections.tcp ?? "—"} · HTTP {data.connections.http ?? "—"}</div></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Disks</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {data.disks.length === 0 && <p className="text-sm text-muted-foreground">No disk information.</p>}
                {data.disks.map(d => {
                  const total = n(d.total_space);
                  const used = total - n(d.free_space);
                  const pct = total ? (used / total) * 100 : 0;
                  return (
                    <div key={String(d.name)} className="text-sm">
                      <div className="flex justify-between gap-2 mb-1">
                        <span className="truncate"><span className="font-medium">{String(d.name)}</span> <span className="text-xs text-muted-foreground">{String(d.path)}</span></span>
                        <span className={`tabular-nums shrink-0 ${pct > 90 ? "text-destructive" : pct > 80 ? "text-warning" : ""}`}>
                          {formatBytes(n(d.free_space))} free of {formatBytes(total)}
                        </span>
                      </div>
                      <Progress value={pct} />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {data.replication && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Replication</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Replicas</div><div className="font-semibold">{formatNumber(data.replication.replicas)}</div></div>
                <div><div className="text-xs text-muted-foreground">Read-only</div><div className={`font-semibold ${n(data.replication.readonly_replicas) ? "text-destructive" : ""}`}>{formatNumber(data.replication.readonly_replicas)}</div></div>
                <div><div className="text-xs text-muted-foreground">Session expired</div><div className={`font-semibold ${n(data.replication.expired) ? "text-destructive" : ""}`}>{formatNumber(data.replication.expired)}</div></div>
                <div><div className="text-xs text-muted-foreground">Max delay</div><div className={`font-semibold ${n(data.replication.max_delay) > 300 ? "text-warning" : ""}`}>{formatDuration(n(data.replication.max_delay))}</div></div>
                <div><div className="text-xs text-muted-foreground">Queue size</div><div className="font-semibold">{formatNumber(data.replication.queue)}</div></div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <ReviewSummaryCard target="clickhouse" />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Live metrics</CardTitle>
          <CardDescription>Sampled every 5 seconds · last {history.length} samples</CardDescription>
        </CardHeader>
        <CardContent>
          {liveError && <p className="mb-2 text-xs text-destructive">{liveError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {LIVE.map(m => {
              const series = history.map(h => n(h[m.key]));
              const v = latest ? n(latest[m.key]) : 0;
              const tone = m.tone?.(v);
              return (
                <div key={m.key} className="rounded-md border p-3">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-muted-foreground">{m.label}</span>
                    <span className={`text-lg font-semibold tabular-nums ${toneClass(tone)}`}>{latest ? m.fmt(v) : "—"}</span>
                  </div>
                  <MiniChart data={series} color={tone === "crit" ? "var(--destructive)" : tone === "warn" ? "var(--warning)" : m.color} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {data && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Largest tables</CardTitle></CardHeader>
            <CardContent>
              {data.topTables.length === 0 ? <p className="text-sm text-muted-foreground">No tables.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3">Table</th><th className="py-2 pr-3">Engine</th><th className="py-2 pr-3 text-right">Rows</th><th className="py-2 text-right">Size</th>
                    </tr></thead>
                    <tbody>
                      {data.topTables.map(t => (
                        <tr key={`${t.database}.${t.name}`} className="border-b last:border-0">
                          <td className="py-1.5 pr-3">
                            <Link className="text-primary hover:underline" href={`/clickhouse/explorer?database=${encodeURIComponent(String(t.database))}&table=${encodeURIComponent(String(t.name))}`}>
                              {String(t.database)}.{String(t.name)}
                            </Link>
                          </td>
                          <td className="py-1.5 pr-3 text-xs text-muted-foreground">{String(t.engine)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatCompact(t.total_rows)}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatBytes(t.total_bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Recent server errors (24h)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.recentErrors.length === 0 && <p className="text-sm text-muted-foreground">No errors recorded in the last 24 hours.</p>}
              {data.recentErrors.map(e => (
                <div key={String(e.name)} className="border rounded-lg p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium">{String(e.name)} <span className="text-muted-foreground">({String(e.code)})</span></span>
                    <Badge variant="outline" className="text-xs">×{formatNumber(e.value)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">{String(e.last_error_message ?? "")}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{String(e.last_error_time)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {data && data.unavailable.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground border rounded p-3">
          <Info className="h-4 w-4 shrink-0" />
          <span>Not available to this ClickHouse user (missing grants or disabled): {data.unavailable.map(u => UNAVAILABLE_LABELS[u] ?? u).join(", ")}.</span>
        </div>
      )}
    </div>
  );
}

export default function ClickHouseOverviewPage() {
  return (
    <ClickHouseGate>
      {(status, disconnect) => <OverviewContent status={status} disconnect={disconnect} />}
    </ClickHouseGate>
  );
}
