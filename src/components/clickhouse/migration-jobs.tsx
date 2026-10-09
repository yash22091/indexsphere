"use client";

/**
 * Copy documents from an Elasticsearch/OpenSearch index into ClickHouse and
 * follow the background jobs (progress, cancel, verification, storage savings).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Play, Square, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/app";
import { chFetch, ErrorBanner, formatBytes, formatNumber } from "./shared";

interface JobResult {
  sourceDocs: number;
  rowsAdded: number;
  parity: boolean;
  esPrimaryBytes: number;
  chCompressedBytes: number;
  chUncompressedBytes: number;
  storageRatio: number | null;
  durationSec: number;
  rowsPerSec: number;
}

interface Job {
  id: string;
  source_index: string;
  target_table: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  total_docs: number;
  read_docs: number;
  inserted_rows: number;
  batch_size: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  result: JobResult | null;
}

const STATUS_LEVEL: Record<Job["status"], string> = {
  queued: "info", running: "info", completed: "ok", failed: "critical", cancelled: "medium", interrupted: "medium",
};

export function MigrationJobs({ index, database, table, naming, analyzeCardinality, canWrite, chConnected }: {
  index: string;
  database: string;
  table: string;
  naming: "underscore" | "dotted";
  analyzeCardinality: boolean;
  canWrite: boolean;
  chConnected: boolean;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [createTable, setCreateTable] = useState(true);
  const [insertBatch, setInsertBatch] = useState("20000");
  const [maxDocs, setMaxDocs] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const d = await chFetch<{ jobs: Job[] }>("/api/clickhouse/migrate/jobs");
      setJobs(d.jobs);
    } catch { /* keep last list */ } finally {
      inFlight.current = false;
    }
  }, []);

  const active = jobs.some(j => j.status === "running" || j.status === "queued");
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (!document.hidden) load(); }, 2000);
    return () => clearInterval(t);
  }, [active, load]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await chFetch("/api/clickhouse/migrate/jobs", {
        method: "POST",
        body: JSON.stringify({
          index, database, table, naming, analyzeCardinality, createTable,
          insertBatch: Number(insertBatch), maxDocs: maxDocs ? Number(maxDocs) : undefined,
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the copy");
    } finally {
      setStarting(false);
    }
  };

  const cancel = async (id: string) => {
    await fetch(`/api/clickhouse/migrate/jobs/${id}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Copy data</CardTitle>
        <CardDescription>
          Streams the documents into <span className="font-mono">{database}.{table}</span> in batches, then verifies row counts and
          compares storage. Runs in the background — you can leave this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {canWrite && chConnected ? (
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="grid gap-2">
              <Label htmlFor="batch">Rows per insert</Label>
              <Input id="batch" type="number" min={1000} max={100000} step={1000} value={insertBatch} onChange={e => setInsertBatch(e.target.value)} />
              <p className="text-xs text-muted-foreground">10,000–100,000 recommended (insert-batch-size).</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="max">Document limit (optional)</Label>
              <Input id="max" type="number" min={1} placeholder="All documents" value={maxDocs} onChange={e => setMaxDocs(e.target.value)} />
              <p className="text-xs text-muted-foreground">Try a sample first, e.g. 100,000.</p>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={createTable} onCheckedChange={setCreateTable} /> Create table if missing
              </label>
              <Button onClick={start} disabled={starting || !index}>
                {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Start copy
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {!chConnected ? "Connect to ClickHouse to copy data." : "Your role is read-only; ask an operator to run the copy."}
          </p>
        )}
        <ErrorBanner message={error} />

        {jobs.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Recent jobs</h3>
            {jobs.slice(0, 10).map(j => {
              const pct = j.total_docs ? Math.min(100, Math.round((j.read_docs / j.total_docs) * 100)) : 0;
              const running = j.status === "running" || j.status === "queued";
              return (
                <div key={j.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <span className="font-mono">{j.source_index}</span>
                      <span className="text-muted-foreground"> → </span>
                      <span className="font-mono">{j.target_table}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <SeverityBadge level={STATUS_LEVEL[j.status]}>{j.status}</SeverityBadge>
                      {running && (
                        <Button variant="outline" size="sm" onClick={() => cancel(j.id)}>
                          <Square className="mr-1.5 h-3.5 w-3.5" />Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                  {(running || j.status !== "completed") && j.total_docs > 0 && (
                    <div className="space-y-1">
                      <Progress value={pct} />
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatNumber(j.read_docs)} / {formatNumber(j.total_docs)} documents read · {formatNumber(j.inserted_rows)} rows inserted
                      </p>
                    </div>
                  )}
                  {j.error && <p className="text-sm text-destructive">{j.error}</p>}
                  {j.result && (
                    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <div className="text-xs text-muted-foreground">Row parity</div>
                        <div className="flex items-center gap-1.5 font-medium">
                          {j.result.parity ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                          {formatNumber(j.result.rowsAdded)} of {formatNumber(j.result.sourceDocs)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Elasticsearch (primary)</div>
                        <div className="font-medium tabular-nums">{formatBytes(j.result.esPrimaryBytes)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">ClickHouse (compressed)</div>
                        <div className="font-medium tabular-nums">{formatBytes(j.result.chCompressedBytes)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Storage</div>
                        <div className="font-medium">
                          {j.result.storageRatio ? (
                            <Badge variant="outline" className="border-success/40 text-success">
                              {j.result.storageRatio >= 1 ? `${j.result.storageRatio.toFixed(1)}× smaller` : `${(1 / j.result.storageRatio).toFixed(1)}× larger`}
                            </Badge>
                          ) : "—"}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
                        {formatNumber(j.result.rowsPerSec)} rows/s over {j.result.durationSec}s. ClickHouse keeps compressing as background merges run, so the ratio usually improves.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
