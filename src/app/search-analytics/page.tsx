"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, StatCard, StatGrid } from "@/components/app";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { Activity, AlertCircle, Clock, Database, FileInput, Loader2, RefreshCw, Search, Timer } from "lucide-react";

/** Cumulative counters from one sample; rates are computed from two consecutive samples. */
interface Totals {
  at: number;
  queryTotal: number;
  queryTimeMs: number;
  fetchTotal: number;
  fetchTimeMs: number;
  queryCurrent: number;
  indexTotal: number;
  indexTimeMs: number;
  perIndex: Record<string, { indexTotal: number; queryTotal: number }>;
}

interface IndexRow {
  name: string;
  docs: number;
  sizeBytes: number;
  indexingCurrent: number;
  queryTotal: number;
  indexRate: number | null;
  searchRate: number | null;
}

interface Derived {
  searchRate: number | null;     // queries/s over the last interval
  indexRate: number | null;      // docs/s over the last interval
  intervalLatency: number | null; // avg ms per query over the last interval
  avgLatency: number;            // avg ms per query since node start
  avgFetch: number;
  queryCurrent: number;
  queryTotal: number;
  indexTotal: number;
  updatedAt: string;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatRate(v: number | null, unit: string) {
  return v === null ? "—" : `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} ${unit}`;
}

export default function SearchAnalyticsPage() {
  const { isConnected } = useConnection();
  const [derived, setDerived] = useState<Derived | null>(null);
  const [rows, setRows] = useState<IndexRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(10_000);
  const [filter, setFilter] = useState("");
  const prev = useRef<Totals | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!isConnected || inFlight.current) return;
    const client = getElasticsearchClient();
    if (!client) { setError("No cluster client available. Reconnect and try again."); return; }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const [nodeStats, indicesStats] = await Promise.all([
        client.request("/_nodes/stats/indices/search,indexing"),
        client.request("/_stats/indexing,search,docs,store"),
      ]);

      const t: Totals = {
        at: Date.now(), queryTotal: 0, queryTimeMs: 0, fetchTotal: 0, fetchTimeMs: 0,
        queryCurrent: 0, indexTotal: 0, indexTimeMs: 0, perIndex: {},
      };
      for (const node of Object.values((nodeStats?.nodes ?? {}) as Record<string, any>)) {
        const sx = node.indices?.search ?? {};
        const ix = node.indices?.indexing ?? {};
        t.queryTotal += sx.query_total ?? 0;
        t.queryTimeMs += sx.query_time_in_millis ?? 0;
        t.fetchTotal += sx.fetch_total ?? 0;
        t.fetchTimeMs += sx.fetch_time_in_millis ?? 0;
        t.queryCurrent += sx.query_current ?? 0;
        t.indexTotal += ix.index_total ?? 0;
        t.indexTimeMs += ix.index_time_in_millis ?? 0;
      }

      const p = prev.current;
      const dt = p ? (t.at - p.at) / 1000 : 0;
      // Counters reset when a node restarts: treat negative deltas as "no data"
      const rate = (now: number, before: number | undefined) =>
        p && dt > 0 && before !== undefined && now >= before ? (now - before) / dt : null;

      const indexRows: IndexRow[] = [];
      for (const [name, st] of Object.entries((indicesStats?.indices ?? {}) as Record<string, any>)) {
        const ix = st.total?.indexing ?? {};
        const sx = st.total?.search ?? {};
        t.perIndex[name] = { indexTotal: ix.index_total ?? 0, queryTotal: sx.query_total ?? 0 };
        indexRows.push({
          name,
          docs: st.total?.docs?.count ?? 0,
          sizeBytes: st.total?.store?.size_in_bytes ?? 0,
          indexingCurrent: ix.index_current ?? 0,
          queryTotal: sx.query_total ?? 0,
          indexRate: rate(ix.index_total ?? 0, p?.perIndex[name]?.indexTotal),
          searchRate: rate(sx.query_total ?? 0, p?.perIndex[name]?.queryTotal),
        });
      }
      indexRows.sort((a, b) =>
        (b.indexRate ?? 0) - (a.indexRate ?? 0) || (b.searchRate ?? 0) - (a.searchRate ?? 0) || b.docs - a.docs);

      const dq = p ? t.queryTotal - p.queryTotal : 0;
      setDerived({
        searchRate: rate(t.queryTotal, p?.queryTotal),
        indexRate: rate(t.indexTotal, p?.indexTotal),
        intervalLatency: p && dq > 0 ? (t.queryTimeMs - p.queryTimeMs) / dq : null,
        avgLatency: t.queryTotal ? t.queryTimeMs / t.queryTotal : 0,
        avgFetch: t.fetchTotal ? t.fetchTimeMs / t.fetchTotal : 0,
        queryCurrent: t.queryCurrent,
        queryTotal: t.queryTotal,
        indexTotal: t.indexTotal,
        updatedAt: new Date(t.at).toLocaleTimeString(),
      });
      setRows(indexRows);
      prev.current = t;
    } catch (err: any) {
      setError(`Failed to load search statistics: ${err?.message ?? err}`);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [isConnected]);

  // Initial sample, then a second one shortly after so rates appear without waiting a full interval
  useEffect(() => {
    if (!isConnected) return;
    prev.current = null;
    load();
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [isConnected, load]);

  useEffect(() => {
    if (!autoRefresh || !isConnected) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, refreshInterval);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, isConnected, load]);

  const shown = filter ? rows.filter(r => r.name.toLowerCase().includes(filter.toLowerCase())) : rows;

  if (!isConnected) {
    return (
      <div className="space-y-6">
        <PageHeader title="Search analytics" description="Search and indexing throughput, latency and per-index activity." />
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to see search analytics."
          action={<Button asChild><Link href="/connections">Go to connections</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search analytics"
        description="Search and indexing throughput, latency and per-index activity. Rates are measured between consecutive samples."
        meta={derived && <span className="text-xs text-muted-foreground">Updated {derived.updatedAt}</span>}
        actions={
          <>
            <div className="flex items-center gap-2">
              <Switch id="sa-auto" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <Label htmlFor="sa-auto" className="text-sm font-normal">Auto-refresh</Label>
            </div>
            <Select value={String(refreshInterval)} onValueChange={v => setRefreshInterval(Number(v))}>
              <SelectTrigger className="w-24" aria-label="Refresh interval"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5000">5 s</SelectItem>
                <SelectItem value="10000">10 s</SelectItem>
                <SelectItem value="30000">30 s</SelectItem>
                <SelectItem value="60000">60 s</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <StatGrid>
        <StatCard label="Search rate" icon={Search} value={formatRate(derived?.searchRate ?? null, "q/s")}
          hint={derived?.searchRate === null ? "Measuring — needs two samples" : "Queries per second, last interval"} />
        <StatCard label="Indexing rate" icon={FileInput} value={formatRate(derived?.indexRate ?? null, "docs/s")}
          hint={derived?.indexRate === null ? "Measuring — needs two samples" : "Documents per second, last interval"} />
        <StatCard label="Query latency" icon={Timer}
          value={derived ? `${(derived.intervalLatency ?? derived.avgLatency).toFixed(1)} ms` : "—"}
          hint={derived?.intervalLatency != null ? `Last interval · ${derived.avgLatency.toFixed(1)} ms since node start` : "Average since node start"}
          tone={(derived?.intervalLatency ?? derived?.avgLatency ?? 0) > 500 ? "warning" : "default"} />
        <StatCard label="In-flight searches" icon={Activity} value={derived ? derived.queryCurrent.toLocaleString() : "—"}
          hint="Query phases executing right now" />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Since node start</CardTitle>
            <CardDescription>Cumulative counters across all nodes.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            {[
              { label: "Queries", value: derived ? derived.queryTotal.toLocaleString() : "—" },
              { label: "Documents indexed", value: derived ? derived.indexTotal.toLocaleString() : "—" },
              { label: "Avg. query phase", value: derived ? `${derived.avgLatency.toFixed(1)} ms` : "—" },
              { label: "Avg. fetch phase", value: derived ? `${derived.avgFetch.toFixed(1)} ms` : "—" },
            ].map(m => (
              <div key={m.label}>
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className="mt-0.5 font-medium tabular-nums">{m.value}</p>
              </div>
            ))}
            <p className="col-span-2 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" /> Counters reset when a node restarts.
            </p>
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Per-index activity</CardTitle>
              <CardDescription>Busiest indices first, by indexing then search rate.</CardDescription>
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Filter indices" value={filter} onChange={e => setFilter(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent>
            {shown.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{loading ? "Loading…" : "No indices match."}</p>
            ) : (
              <div className="max-h-[480px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Index</TableHead>
                      <TableHead className="text-right">Indexing</TableHead>
                      <TableHead className="text-right">Search</TableHead>
                      <TableHead className="text-right">Documents</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.slice(0, 200).map(r => (
                      <TableRow key={r.name}>
                        <TableCell className="max-w-[260px] truncate font-mono text-xs" title={r.name}>
                          {r.name}
                          {r.indexingCurrent > 0 && (
                            <Badge variant="outline" className="ml-2 font-normal">{r.indexingCurrent} writing</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{formatRate(r.indexRate, "/s")}</TableCell>
                        <TableCell className="text-right">{formatRate(r.searchRate, "/s")}</TableCell>
                        <TableCell className="text-right">{r.docs.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{formatBytes(r.sizeBytes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
