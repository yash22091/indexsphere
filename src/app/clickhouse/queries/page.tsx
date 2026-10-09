"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import {
  ClickHouseGate, ClickHouseHeader, ErrorBanner, chFetch, formatBytes, formatMs, formatNumber,
} from "@/components/clickhouse/shared";
import { Info, Lightbulb, Loader2, RefreshCw, SquareTerminal, XOctagon } from "lucide-react";

type Row = Record<string, any>;

interface QueriesResponse {
  hours: number;
  running: Row[];
  slow: Row[];
  failed: Row[];
  patterns: Row[];
  queryLogAvailable: boolean;
}

const HOURS = [1, 6, 24, 72, 168];

function QueryText({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const text = String(query ?? "");
  const long = text.length > 160;
  return (
    <div className="space-y-1 min-w-0">
      <pre className={`font-mono text-xs whitespace-pre-wrap break-all ${open ? "" : "line-clamp-2"}`}>{text}</pre>
      <div className="flex gap-3 text-xs">
        {long && (
          <button className="text-primary hover:underline" onClick={() => setOpen(o => !o)}>{open ? "Collapse" : "Expand"}</button>
        )}
        <Link href={`/clickhouse/sql?q=${encodeURIComponent(text)}`} className="text-primary hover:underline inline-flex items-center gap-1">
          <SquareTerminal className="h-3 w-3" />Open in SQL
        </Link>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-medium whitespace-nowrap border-b ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return <td className={`px-3 py-2 align-top ${right ? "text-right tabular-nums whitespace-nowrap" : ""} ${mono ? "font-mono" : ""}`}>{children}</td>;
}
function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-xs">{children}</table>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground py-6 text-center">{text}</p>;
}

function QueriesView() {
  const { user } = useAuth();
  const isAdmin = !!user?.permissions?.includes("admin");
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<QueriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("running");
  const [auto, setAuto] = useState(false);
  const [killing, setKilling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await chFetch<QueriesResponse>(`/api/clickhouse/queries?hours=${hours}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queries");
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!auto || tab !== "running") return;
    // Skip a tick while the previous load is still running
    const t = setInterval(() => { if (!loadingRef.current) load(); }, 10_000);
    return () => clearInterval(t);
  }, [auto, tab, load]);

  const kill = async (queryId: string) => {
    if (!confirm(`Kill query ${queryId}?`)) return;
    setKilling(queryId);
    try {
      await chFetch("/api/clickhouse/queries/kill", { method: "POST", body: JSON.stringify({ queryId }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kill failed");
    } finally {
      setKilling(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Window</Label>
          <Select value={String(hours)} onValueChange={v => setHours(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {HOURS.map(h => <SelectItem key={h} value={String(h)}>{h < 24 ? `${h}h` : `${h / 24}d`}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}Refresh
        </Button>
        <div className="flex items-center gap-2">
          <Switch checked={auto} onCheckedChange={setAuto} />
          <Label className="text-sm">Auto-refresh running (10s)</Label>
        </div>
      </div>

      <ErrorBanner message={error} />

      {data && !data.queryLogAvailable && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>system.query_log is disabled or not granted to this ClickHouse user, so only running queries are shown.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-4 flex items-start gap-3 text-sm">
          <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-muted-foreground">
            Heavy patterns that read many rows usually don&apos;t filter on the ORDER BY prefix
            (<code className="text-xs">schema-pk-filter-on-orderby</code>) or need a data-skipping index
            (<code className="text-xs">query-index-skipping-indices</code>). Open a query in the SQL workbench and use
            <span className="font-medium"> EXPLAIN (indexes)</span> to see how many granules the primary key and skip indexes prune.
          </p>
        </CardContent>
      </Card>

      {!data && loading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {data && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="running">Running <Badge variant="secondary" className="ml-1.5">{data.running.length}</Badge></TabsTrigger>
            <TabsTrigger value="slow">Slowest <Badge variant="secondary" className="ml-1.5">{data.slow.length}</Badge></TabsTrigger>
            <TabsTrigger value="failed">Failed <Badge variant="secondary" className="ml-1.5">{data.failed.length}</Badge></TabsTrigger>
            <TabsTrigger value="patterns">Heaviest patterns</TabsTrigger>
          </TabsList>

          <TabsContent value="running" className="mt-4">
            {data.running.length === 0 ? <Empty text="No queries running right now." /> : (
              <TableWrap>
                <thead className="bg-muted"><tr>
                  <Th>Query</Th><Th>User</Th><Th right>Elapsed</Th><Th right>Read rows</Th><Th right>Read</Th><Th right>Memory</Th>
                  {isAdmin && <Th right>{""}</Th>}
                </tr></thead>
                <tbody>
                  {data.running.map(r => (
                    <tr key={r.query_id} className="border-b last:border-0">
                      <Td>
                        <div className="text-[10px] text-muted-foreground font-mono mb-1 break-all">{r.query_id}</div>
                        <QueryText query={r.query} />
                      </Td>
                      <Td>{r.user}</Td>
                      <Td right>{Number(r.elapsed ?? 0).toFixed(1)} s</Td>
                      <Td right>{formatNumber(r.read_rows)}</Td>
                      <Td right>{formatBytes(r.read_bytes)}</Td>
                      <Td right>{formatBytes(r.memory_usage)}</Td>
                      {isAdmin && (
                        <Td right>
                          <Button size="sm" variant="destructive" className="h-7" onClick={() => kill(r.query_id)} disabled={killing === r.query_id}>
                            {killing === r.query_id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XOctagon className="h-3 w-3 mr-1" />}Kill
                          </Button>
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </TabsContent>

          <TabsContent value="slow" className="mt-4">
            {data.slow.length === 0 ? <Empty text="No finished queries in this window." /> : (
              <TableWrap>
                <thead className="bg-muted"><tr>
                  <Th>Query</Th><Th>Time</Th><Th>User</Th><Th right>Duration</Th><Th right>Read rows</Th><Th right>Read</Th><Th right>Result rows</Th><Th right>Memory</Th>
                </tr></thead>
                <tbody>
                  {data.slow.map(r => (
                    <tr key={r.query_id} className="border-b last:border-0">
                      <Td><QueryText query={r.query} /></Td>
                      <Td><span className="whitespace-nowrap">{r.event_time}</span></Td>
                      <Td>{r.user}</Td>
                      <Td right>{formatMs(r.query_duration_ms)}</Td>
                      <Td right>{formatNumber(r.read_rows)}</Td>
                      <Td right>{formatBytes(r.read_bytes)}</Td>
                      <Td right>{formatNumber(r.result_rows)}</Td>
                      <Td right>{formatBytes(r.memory_usage)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </TabsContent>

          <TabsContent value="failed" className="mt-4">
            {data.failed.length === 0 ? <Empty text="No failed queries in this window." /> : (
              <TableWrap>
                <thead className="bg-muted"><tr>
                  <Th>Query</Th><Th>Time</Th><Th>User</Th><Th>Error</Th>
                </tr></thead>
                <tbody>
                  {data.failed.map(r => (
                    <tr key={r.query_id} className="border-b last:border-0">
                      <Td><QueryText query={r.query} /></Td>
                      <Td><span className="whitespace-nowrap">{r.event_time}</span></Td>
                      <Td>{r.user}</Td>
                      <Td>
                        <Badge variant="destructive" className="mb-1">Code {r.exception_code}</Badge>
                        <p className="max-w-md break-words text-xs text-destructive">{r.exception}</p>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </TabsContent>

          <TabsContent value="patterns" className="mt-4">
            {data.patterns.length === 0 ? <Empty text="No query patterns in this window." /> : (
              <TableWrap>
                <thead className="bg-muted"><tr>
                  <Th>Pattern (example)</Th><Th right>Calls</Th><Th right>Avg</Th><Th right>Max</Th><Th right>Read rows</Th><Th right>Read</Th><Th right>Avg memory</Th>
                </tr></thead>
                <tbody>
                  {data.patterns.map(r => (
                    <tr key={String(r.hash)} className="border-b last:border-0">
                      <Td>
                        <div className="text-[10px] text-muted-foreground font-mono mb-1">#{String(r.hash)}</div>
                        <QueryText query={r.example} />
                      </Td>
                      <Td right>{formatNumber(r.calls)}</Td>
                      <Td right>{formatMs(r.avg_ms)}</Td>
                      <Td right>{formatMs(r.max_ms)}</Td>
                      <Td right>{formatNumber(r.read_rows)}</Td>
                      <Td right>{formatBytes(r.read_bytes)}</Td>
                      <Td right>{formatBytes(r.avg_memory)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default function ClickHouseQueriesPage() {
  return (
    <div className="space-y-6">
      <ClickHouseGate>
        {(status, disconnect) => (
          <div className="space-y-6">
            <ClickHouseHeader
              title="Query activity"
              description="Running, slowest, failed and heaviest queries from system.processes and system.query_log."
              status={status}
              onDisconnect={disconnect}
            />
            <QueriesView />
          </div>
        )}
      </ClickHouseGate>
    </div>
  );
}
