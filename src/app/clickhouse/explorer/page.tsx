"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClickHouseGate, ClickHouseHeader, ClickHouseStatus, chFetch, formatBytes, formatCompact, formatNumber,
  ResultTable, ErrorBanner,
} from "@/components/clickhouse/shared";
import { Check, Copy, Database, Lightbulb, Loader2, Search, Table2, Terminal } from "lucide-react";

type Row = Record<string, any>;

interface DbRow { name: string; engine: string; comment?: string; tables: number; rows: number; bytes: number }
interface TableRow {
  name: string; engine: string; sorting_key: string; partition_key: string; comment: string;
  rows: number; bytes: number; parts: number; partitions: number; compressed: number; uncompressed: number;
}
interface TableDetail {
  table: Row;
  columns: Row[];
  partitions: Row[];
  skipIndices: Row[];
  sample: Row[];
  sampleError: string | null;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ratioOf(compressed: number, uncompressed: number) {
  return compressed > 0 ? `${(uncompressed / compressed).toFixed(1)}x` : "—";
}

function ExplorerContent({ status, disconnect }: { status: ClickHouseStatus; disconnect: () => void }) {
  const params = useSearchParams();
  const [showSystem, setShowSystem] = useState(false);
  const [dbs, setDbs] = useState<DbRow[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [db, setDb] = useState<string | null>(params.get("database"));
  const [tables, setTables] = useState<TableRow[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [table, setTable] = useState<string | null>(params.get("table"));
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDbs = useCallback(async () => {
    setDbLoading(true);
    try {
      const d = await chFetch<{ databases: DbRow[] }>(`/api/clickhouse/databases${showSystem ? "?system=1" : ""}`);
      setDbs(d.databases);
      setDb(cur => cur ?? d.databases[0]?.name ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load databases"); }
    finally { setDbLoading(false); }
  }, [showSystem]);

  useEffect(() => { loadDbs(); }, [loadDbs]);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    setTablesLoading(true);
    chFetch<{ tables: TableRow[] }>(`/api/clickhouse/tables?database=${encodeURIComponent(db)}`)
      .then(d => { if (!cancelled) setTables(d.tables); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load tables"); })
      .finally(() => { if (!cancelled) setTablesLoading(false); });
    return () => { cancelled = true; };
  }, [db]);

  useEffect(() => {
    if (!db || !table) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    chFetch<TableDetail>(`/api/clickhouse/table?database=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}`)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(e => { if (!cancelled) { setDetail(null); setError(e instanceof Error ? e.message : "Failed to load table"); } })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [db, table]);

  const filtered = useMemo(
    () => tables.filter(t => !filter || t.name.toLowerCase().includes(filter.toLowerCase())),
    [tables, filter],
  );

  const selectDb = (name: string) => {
    setDb(name);
    setTable(null);
    setFilter("");
    setError(null);
  };

  const sqlLink = db && table
    ? `/clickhouse/sql?q=${encodeURIComponent(`SELECT * FROM \`${db}\`.\`${table}\` LIMIT 100`)}`
    : "#";

  return (
    <div className="space-y-6">
      <ClickHouseHeader
        title="Explorer"
        description="Browse databases and tables: columns, DDL, partitions, skip indices and sample rows."
        status={status}
        onDisconnect={disconnect}
      />
      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        {/* Databases */}
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5"><Database className="h-4 w-4" />Databases</span>
              <span className="flex items-center gap-1.5 text-xs font-normal">
                <Switch id="sys" checked={showSystem} onCheckedChange={setShowSystem} />
                <Label htmlFor="sys" className="text-xs">system</Label>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 space-y-0.5 max-h-[70vh] overflow-auto">
            {dbLoading && <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" /></div>}
            {!dbLoading && dbs.length === 0 && <p className="text-xs text-muted-foreground p-2">No databases.</p>}
            {dbs.map(d => (
              <button
                key={d.name}
                onClick={() => selectDb(d.name)}
                className={`w-full text-left rounded-md px-2.5 py-1.5 text-sm transition-colors ${db === d.name ? "bg-secondary" : "hover:bg-muted/60"}`}
              >
                <div className="font-medium truncate">{d.name}</div>
                <div className="text-[11px] text-muted-foreground">{n(d.tables)} tables · {formatBytes(d.bytes)}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4 min-w-0">
          {/* Tables */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-1.5"><Table2 className="h-4 w-4" />{db ? `Tables in ${db}` : "Tables"}</CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter tables" className="h-8 pl-8" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {tablesLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tables.</p>
              ) : (
                <div className="overflow-auto max-h-[40vh]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="py-2 pr-3">Name</th>
                        <th className="py-2 pr-3">Engine</th>
                        <th className="py-2 pr-3 text-right">Rows</th>
                        <th className="py-2 pr-3 text-right">Size</th>
                        <th className="py-2 pr-3 text-right">Ratio</th>
                        <th className="py-2 pr-3 text-right">Parts</th>
                        <th className="py-2 pr-3 text-right">Partitions</th>
                        <th className="py-2">Sorting key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(t => (
                        <tr
                          key={t.name}
                          onClick={() => setTable(t.name)}
                          className={`border-b last:border-0 cursor-pointer ${table === t.name ? "bg-secondary" : "hover:bg-muted/40"}`}
                        >
                          <td className="py-1.5 pr-3 font-medium">{t.name}</td>
                          <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{t.engine}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatCompact(t.rows)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">{formatBytes(t.bytes)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{ratioOf(n(t.compressed), n(t.uncompressed))}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(t.parts)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(t.partitions)}</td>
                          <td className="py-1.5 font-mono text-xs text-muted-foreground truncate max-w-[260px]" title={t.sorting_key}>{t.sorting_key || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Table detail */}
          {table && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{db}.{table}</CardTitle>
                    {detail && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5 text-xs">
                        <Badge variant="outline">{String(detail.table.engine)}</Badge>
                        <Badge variant="outline">{formatNumber(detail.table.rows)} rows</Badge>
                        <Badge variant="outline">{formatBytes(detail.table.bytes)}</Badge>
                        {detail.table.partition_key && <Badge variant="outline" className="font-mono">PARTITION BY {String(detail.table.partition_key)}</Badge>}
                      </div>
                    )}
                    {detail?.table.comment && <p className="text-xs text-muted-foreground mt-1">{String(detail.table.comment)}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Link href={sqlLink}><Button size="sm" variant="outline"><Terminal className="h-3.5 w-3.5 mr-1" />Open in SQL</Button></Link>
                    <Link href={`/clickhouse/advisor?database=${encodeURIComponent(db ?? "")}&table=${encodeURIComponent(table)}`}>
                      <Button size="sm" variant="outline"><Lightbulb className="h-3.5 w-3.5 mr-1" />Analyze in Advisor</Button>
                    </Link>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {detailLoading || !detail ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <Tabs defaultValue="columns">
                    <TabsList className="flex-wrap h-auto">
                      <TabsTrigger value="columns">Columns ({detail.columns.length})</TabsTrigger>
                      <TabsTrigger value="ddl">DDL</TabsTrigger>
                      <TabsTrigger value="partitions">Partitions ({detail.partitions.length})</TabsTrigger>
                      <TabsTrigger value="indices">Skip indices ({detail.skipIndices.length})</TabsTrigger>
                      <TabsTrigger value="sample">Sample</TabsTrigger>
                    </TabsList>

                    <TabsContent value="columns" className="mt-3">
                      <div className="overflow-auto max-h-[55vh]">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-card">
                            <tr className="text-left text-xs text-muted-foreground border-b">
                              <th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Default</th>
                              <th className="py-2 pr-3">Codec</th><th className="py-2 pr-3">Keys</th>
                              <th className="py-2 pr-3 text-right">Compressed</th><th className="py-2 pr-3 text-right">Uncompressed</th>
                              <th className="py-2">Comment</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.columns.map(c => (
                              <tr key={String(c.name)} className="border-b last:border-0 align-top">
                                <td className="py-1.5 pr-3 font-medium font-mono text-xs">{String(c.name)}</td>
                                <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{String(c.type)}</td>
                                <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">
                                  {c.default_kind ? `${c.default_kind} ${c.default_expression}` : ""}
                                </td>
                                <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{String(c.compression_codec ?? "")}</td>
                                <td className="py-1.5 pr-3">
                                  <div className="flex gap-1 flex-wrap">
                                    {n(c.is_in_sorting_key) ? <Badge className="text-[10px] px-1.5 py-0">sort</Badge> : null}
                                    {n(c.is_in_primary_key) ? <Badge variant="secondary" className="text-[10px] px-1.5 py-0">primary</Badge> : null}
                                    {n(c.is_in_partition_key) ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">partition</Badge> : null}
                                  </div>
                                </td>
                                <td className="py-1.5 pr-3 text-right tabular-nums text-xs">{formatBytes(c.data_compressed_bytes)}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums text-xs">{formatBytes(c.data_uncompressed_bytes)}</td>
                                <td className="py-1.5 text-xs text-muted-foreground">{String(c.comment ?? "")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </TabsContent>

                    <TabsContent value="ddl" className="mt-3">
                      <div className="relative rounded-md bg-muted">
                        <div className="absolute right-1 top-1"><CopyButton text={String(detail.table.create_table_query ?? "")} /></div>
                        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words p-3 pr-10 font-mono text-xs">
                          {String(detail.table.create_table_query ?? "")}
                        </pre>
                      </div>
                    </TabsContent>

                    <TabsContent value="partitions" className="mt-3">
                      {detail.partitions.length === 0 ? <p className="text-sm text-muted-foreground">No active parts.</p> : (
                        <div className="overflow-auto max-h-[55vh]">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-card">
                              <tr className="text-left text-xs text-muted-foreground border-b">
                                <th className="py-2 pr-3">Partition</th><th className="py-2 pr-3 text-right">Parts</th>
                                <th className="py-2 pr-3 text-right">Rows</th><th className="py-2 pr-3 text-right">Size</th>
                                <th className="py-2 pr-3">Min time</th><th className="py-2">Max time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.partitions.map(p => (
                                <tr key={String(p.partition)} className="border-b last:border-0">
                                  <td className="py-1.5 pr-3 font-mono text-xs">{String(p.partition)}</td>
                                  <td className={`py-1.5 pr-3 text-right tabular-nums ${n(p.parts) > 300 ? "text-warning font-medium" : ""}`}>{formatNumber(p.parts)}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(p.rows)}</td>
                                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatBytes(p.bytes)}</td>
                                  <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{String(p.min_time ?? "")}</td>
                                  <td className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">{String(p.max_time ?? "")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="indices" className="mt-3">
                      {detail.skipIndices.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No data-skipping indices. Consider them for frequent filters on columns outside the ORDER BY (query-index-skipping-indices).</p>
                      ) : (
                        <ResultTable rows={detail.skipIndices} />
                      )}
                    </TabsContent>

                    <TabsContent value="sample" className="mt-3 space-y-2">
                      {detail.sampleError && <ErrorBanner message={`Sample unavailable: ${detail.sampleError}`} />}
                      {!detail.sampleError && <ResultTable rows={detail.sample} />}
                      <p className="text-xs text-muted-foreground">First 10 rows, read with a row-scan cap.</p>
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ExplorerPage() {
  return (
    <ClickHouseGate>
      {(status, disconnect) => <ExplorerContent status={status} disconnect={disconnect} />}
    </ClickHouseGate>
  );
}

export default function ClickHouseExplorerPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <ExplorerPage />
    </Suspense>
  );
}
