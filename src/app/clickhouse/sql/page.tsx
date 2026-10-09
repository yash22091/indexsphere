"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ClickHouseGate, ClickHouseHeader, ErrorBanner, ResultTable, chFetch, formatBytes, formatMs, formatNumber,
} from "@/components/clickhouse/shared";
import {
  ChevronDown, ChevronRight, Copy, Download, History, Loader2, Play, ScanSearch, Shield, Square, Table2, Gauge,
} from "lucide-react";

type Mode = "run" | "explain" | "estimate";

interface QueryResponse {
  queryId: string;
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  rowsBeforeLimit: number | null;
  statistics: { elapsed: number; rows_read: number; bytes_read: number } | null;
  elapsedMs: number;
  statement: string;
}

interface TableInfo { name: string; engine: string; sorting_key: string; rows: number }

const DEFAULT_SQL = "SELECT database, name, engine, total_rows FROM system.tables WHERE database NOT IN ('system') LIMIT 100";
const HISTORY_KEY = "indexsphere-ch-sql-history";
const NO_DB = "__none__";

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory(items: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch { /* storage unavailable */ }
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // block CSV formula injection
  return `"${s.replace(/"/g, '""')}"`;
}

function quoteIdent(name: string) {
  return "`" + name.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}

function Workbench() {
  const searchParams = useSearchParams();
  const [sql, setSql] = useState(() => searchParams.get("q") || DEFAULT_SQL);
  const [database, setDatabase] = useState<string>(NO_DB);
  const [databases, setDatabases] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [maxRows, setMaxRows] = useState("1000");
  const [running, setRunning] = useState<Mode | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showSafety, setShowSafety] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runningIdRef = useRef<string | null>(null);

  useEffect(() => { setHistory(loadHistory()); }, []);

  useEffect(() => {
    chFetch<{ databases: { name: string }[] }>("/api/clickhouse/databases")
      .then(d => setDatabases((d.databases ?? []).map(x => String(x.name))))
      .catch(() => setDatabases([]));
  }, []);

  useEffect(() => {
    if (database === NO_DB) { setTables([]); return; }
    setTablesLoading(true);
    chFetch<{ tables: TableInfo[] }>(`/api/clickhouse/tables?database=${encodeURIComponent(database)}`)
      .then(d => setTables(d.tables ?? []))
      .catch(() => setTables([]))
      .finally(() => setTablesLoading(false));
  }, [database]);

  const execute = useCallback(async (mode: Mode) => {
    const text = sql.trim();
    if (!text || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    // Client-chosen id so Cancel can kill the query server-side while it runs
    const clientQueryId = crypto.randomUUID();
    runningIdRef.current = clientQueryId;
    setRunning(mode);
    setError(null);
    try {
      const r = await chFetch<QueryResponse>("/api/clickhouse/query", {
        method: "POST",
        body: JSON.stringify({ sql: text, database: database === NO_DB ? undefined : database, mode, maxRows: Number(maxRows), clientQueryId }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return; // cancelled: ignore late response
      setResult(r);
      const next = [text, ...loadHistory().filter(h => h !== text)].slice(0, 30);
      saveHistory(next);
      setHistory(next);
    } catch (e) {
      if (controller.signal.aborted) {
        setError("Query cancelled.");
      } else {
        setError(e instanceof Error ? e.message : "Query failed");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (runningIdRef.current === clientQueryId) runningIdRef.current = null;
      setRunning(null);
    }
  }, [sql, database, maxRows, running]);

  const cancel = () => {
    const id = runningIdRef.current;
    if (id) {
      fetch("/api/clickhouse/query/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientQueryId: id }),
      }).catch(() => {});
    }
    abortRef.current?.abort();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      execute("run");
    }
  };

  const downloadCsv = () => {
    if (!result) return;
    const cols = result.columns.length ? result.columns.map(c => c.name) : Object.keys(result.rows[0] ?? {});
    const lines = [cols.map(csvCell).join(","), ...result.rows.map(r => cols.map(c => csvCell(r[c])).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clickhouse-result-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyJson = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.rows, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const insertTable = (t: string) => {
    setSql(`SELECT * FROM ${quoteIdent(database)}.${quoteIdent(t)} LIMIT 100`);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">
      <div className="space-y-4 min-w-0">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Database</Label>
                <Select value={database} onValueChange={setDatabase}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DB}>(default)</SelectItem>
                    {databases.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max rows</Label>
                <Select value={maxRows} onValueChange={setMaxRows}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["100", "1000", "5000", "10000"].map(n => <SelectItem key={n} value={n}>{formatNumber(Number(n))}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Textarea
              value={sql}
              onChange={e => setSql(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              className="font-mono text-sm min-h-[180px]"
              placeholder="SELECT …"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => execute("run")} disabled={!!running || !sql.trim()}>
                {running === "run" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}Run
              </Button>
              <Button variant="outline" onClick={() => execute("explain")} disabled={!!running || !sql.trim()}>
                {running === "explain" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ScanSearch className="h-4 w-4 mr-1" />}EXPLAIN (indexes)
              </Button>
              <Button variant="outline" onClick={() => execute("estimate")} disabled={!!running || !sql.trim()}>
                {running === "estimate" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Gauge className="h-4 w-4 mr-1" />}EXPLAIN ESTIMATE
              </Button>
              {running && (
                <Button variant="destructive" onClick={cancel}><Square className="h-4 w-4 mr-1" />Cancel</Button>
              )}
              <span className="text-xs text-muted-foreground ml-auto">Ctrl/⌘ + Enter to run</span>
            </div>
          </CardContent>
        </Card>

        <ErrorBanner message={error} />

        {result && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                  Result
                  <Badge variant="secondary">{result.statement || "query"}</Badge>
                  {result.truncated && <Badge variant="outline" className="border-warning/50 text-warning">truncated at {formatNumber(result.rowCount)} rows</Badge>}
                </CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!result.rows.length}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
                  <Button size="sm" variant="outline" onClick={copyJson} disabled={!result.rows.length}><Copy className="h-3.5 w-3.5 mr-1" />{copied ? "Copied" : "JSON"}</Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatNumber(result.rowCount)} rows
                {result.rowsBeforeLimit !== null && ` (≥ ${formatNumber(result.rowsBeforeLimit)} before LIMIT)`}
                {" · "}{formatMs(result.statistics ? result.statistics.elapsed * 1000 : result.elapsedMs)}
                {result.statistics && <> · read {formatNumber(result.statistics.rows_read)} rows / {formatBytes(result.statistics.bytes_read)}</>}
              </p>
            </CardHeader>
            <CardContent>
              <ResultTable rows={result.rows} columns={result.columns} />
            </CardContent>
          </Card>
        )}

        <Card>
          <button className="w-full flex items-center gap-2 p-4 text-left text-sm font-medium" onClick={() => setShowSafety(s => !s)}>
            {showSafety ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Shield className="h-4 w-4 text-muted-foreground" />Query safety limits
          </button>
          {showSafety && (
            <CardContent className="pt-0 text-sm text-muted-foreground space-y-1.5">
              <p>Per <code className="text-xs">agent-query-safety</code>, every workbench query runs with:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>a result-row cap (the Max rows setting) with <code className="text-xs">result_overflow_mode = &apos;break&apos;</code>, so you get partial results instead of an error;</li>
                <li><code className="text-xs">max_execution_time</code>, so runaway queries are stopped server-side;</li>
                <li>a scan cap (<code className="text-xs">max_bytes_to_read</code>), so a missing filter can&apos;t read the whole cluster;</li>
                <li>readonly IndexSphere users run with ClickHouse <code className="text-xs">readonly = 2</code>, so ClickHouse itself refuses writes and DDL;</li>
                <li>external table functions and engines (url, file, s3, remote, mysql, …) are admin-only, and non-admins can&apos;t override these limits with SETTINGS.</li>
              </ul>
            </CardContent>
          )}
        </Card>
      </div>

      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Table2 className="h-4 w-4" />Tables</CardTitle>
            <p className="text-xs text-muted-foreground">Discover the schema first (<code>agent-discovery-schema</code>): filter on the sorting key.</p>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[420px] overflow-auto">
            {database === NO_DB && <p className="text-xs text-muted-foreground">Select a database to list its tables.</p>}
            {tablesLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {database !== NO_DB && !tablesLoading && tables.length === 0 && <p className="text-xs text-muted-foreground">No tables.</p>}
            {tables.map(t => (
              <button key={t.name} onClick={() => insertTable(t.name)} className="w-full text-left rounded p-2 hover:bg-muted/60 transition-colors">
                <div className="text-sm font-medium truncate">{t.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {t.engine}{t.sorting_key ? ` · ORDER BY ${t.sorting_key}` : ""}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <button className="w-full flex items-center gap-2 p-4 text-left text-sm font-medium" onClick={() => setShowHistory(s => !s)}>
            {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <History className="h-4 w-4" />History <Badge variant="secondary" className="ml-auto">{history.length}</Badge>
          </button>
          {showHistory && (
            <CardContent className="pt-0 space-y-1 max-h-[360px] overflow-auto">
              {history.length === 0 && <p className="text-xs text-muted-foreground">No queries yet.</p>}
              {history.map((h, i) => (
                <button key={i} onClick={() => setSql(h)} className="w-full text-left rounded p-2 hover:bg-muted/60">
                  <pre className="font-mono text-[11px] whitespace-pre-wrap break-all line-clamp-3">{h}</pre>
                </button>
              ))}
              {history.length > 0 && (
                <Button size="sm" variant="ghost" className="w-full" onClick={() => { saveHistory([]); setHistory([]); }}>Clear history</Button>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function ClickHouseSqlPage() {
  return (
    <div className="space-y-6">
      <ClickHouseGate>
        {(status, disconnect) => (
          <div className="space-y-6">
            <ClickHouseHeader
              title="SQL workbench"
              description="Run SQL with enforced safety limits, inspect index usage with EXPLAIN, and export results."
              status={status}
              onDisconnect={disconnect}
            />
            <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <Workbench />
            </Suspense>
          </div>
        )}
      </ClickHouseGate>
    </div>
  );
}
