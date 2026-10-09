"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatGrid } from "@/components/app";
import {
  ClickHouseGate, ClickHouseHeader, DataTable, ErrorBanner, MiniChart, RefreshButton, Section, StatTile,
  formatBytes, formatCompact, formatNumber, useChData,
} from "@/components/clickhouse/shared";
import { Lightbulb, Loader2 } from "lucide-react";

type Row = Record<string, any>;
interface IngestionData {
  hours: number;
  bucketMinutes: number;
  tables: Row[] | null;
  timeline: Row[] | null;
  asyncPending: Row[] | null;
  asyncLog: Row[] | null;
  errors: Row[] | null;
  kafka: Row[] | null;
  views: Row[] | null;
  refreshes: Row[] | null;
  viewErrors: Row[] | null;
  unavailable: { section: string; error: string }[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const HOURS = [1, 6, 24, 72, 168];

/** insert-batch-size: many inserts of few rows each. */
function isSmallBatch(r: Row, hours: number) {
  return n(r.avg_rows) < 1000 && n(r.inserts) / hours >= 60; // ≥ 1 insert per minute on average
}

function IngestionView() {
  const [hours, setHours] = useState(24);
  const { data, error, loading, reload, unavailableFor } = useChData<IngestionData>(`/api/clickhouse/ingestion?hours=${hours}`);

  const tables = data?.tables ?? [];
  const totalRows = tables.reduce((a, t) => a + n(t.total_rows), 0);
  const totalInserts = tables.reduce((a, t) => a + n(t.inserts), 0);
  const small = tables.filter(t => isSmallBatch(t, hours));
  const insertErrors = (data?.errors ?? []).reduce((a, e) => a + n(e.failures), 0);
  const timeline = data?.timeline ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Window</Label>
          <Select value={String(hours)} onValueChange={v => setHours(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{HOURS.map(h => <SelectItem key={h} value={String(h)}>{h < 24 ? `${h}h` : `${h / 24}d`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <RefreshButton loading={loading} onClick={reload} />
      </div>
      <ErrorBanner message={error} />
      {loading && !data && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {data && (
        <>
          <StatGrid>
            <StatTile label="Rows inserted" value={formatCompact(totalRows)} sub={`${formatCompact(totalRows / (hours * 3600))} rows/s average`} />
            <StatTile label="Inserts (new parts)" value={formatCompact(totalInserts)} sub={`${(totalInserts / (hours * 60)).toFixed(1)} per minute`} />
            <StatTile label="Tables with small inserts" value={formatNumber(small.length)} tone={small.length ? "warn" : "ok"} sub="< 1,000 rows per INSERT" />
            <StatTile label="Failed inserts" value={formatNumber(insertErrors)} tone={insertErrors ? "crit" : "ok"} sub={`last ${hours < 24 ? `${hours}h` : `${hours / 24}d`}`} />
          </StatGrid>

          {small.length > 0 && (
            <Alert>
              <Lightbulb className="h-4 w-4" />
              <AlertTitle>Inserts are too small on {small.length} table{small.length > 1 ? "s" : ""}</AlertTitle>
              <AlertDescription>
                Every INSERT creates a part that has to be merged later. Send 10K–100K rows per INSERT (insert-batch-size), or let
                ClickHouse buffer small writes with <code className="font-mono">SET async_insert = 1, wait_for_async_insert = 1</code> (insert-async-small-batches).
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Rows inserted over time</CardTitle>
              <CardDescription>{data.bucketMinutes}-minute buckets, user tables only (system.part_log)</CardDescription>
            </CardHeader>
            <CardContent>
              {unavailableFor("timeline")
                ? <p className="text-sm text-muted-foreground">Not available: {unavailableFor("timeline")}</p>
                : <MiniChart data={timeline.map(t => n(t.rows))} color="var(--chart-2)" height={96} />}
            </CardContent>
          </Card>

          <Tabs defaultValue="tables">
            <TabsList className="flex-wrap">
              <TabsTrigger value="tables">Per table</TabsTrigger>
              <TabsTrigger value="async">Async inserts</TabsTrigger>
              <TabsTrigger value="errors">Insert errors{insertErrors ? ` (${insertErrors})` : ""}</TabsTrigger>
              <TabsTrigger value="views">Materialized views</TabsTrigger>
              <TabsTrigger value="kafka">Kafka</TabsTrigger>
            </TabsList>

            <TabsContent value="tables" className="mt-4">
              <Section title="Insert activity per table" description="From system.part_log (NewPart events). Average rows per insert below 1,000 with frequent inserts is flagged." unavailable={unavailableFor("tables")}>
                <DataTable rows={tables} empty="No inserts into user tables in this window." columns={[
                  { key: "table", label: "Table", render: r => <Link href={`/clickhouse/explorer?database=${encodeURIComponent(r.database)}&table=${encodeURIComponent(r.table)}`} className="font-mono hover:underline">{r.database}.{r.table}</Link> },
                  { key: "inserts", label: "Inserts", right: true, render: r => formatNumber(r.inserts) },
                  { key: "total_rows", label: "Rows", right: true, render: r => formatNumber(r.total_rows) },
                  { key: "avg_rows", label: "Rows / insert", right: true, render: r => (
                    <span className={isSmallBatch(r, hours) ? "font-semibold text-warning" : ""}>{formatNumber(r.avg_rows)}</span>
                  ) },
                  { key: "bytes", label: "Written", right: true, render: r => formatBytes(r.bytes) },
                  { key: "last_insert", label: "Last insert", className: "whitespace-nowrap" },
                  { key: "flag", label: "", render: r => isSmallBatch(r, hours) ? <Badge variant="outline" className="border-warning/40 text-warning">batch inserts</Badge> : null },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="async" className="mt-4 space-y-4">
              <Section title="Buffered async inserts" description="Data waiting in memory to be flushed as one part." unavailable={unavailableFor("asyncPending")}>
                <DataTable rows={data.asyncPending} empty="No async inserts waiting to be flushed." columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "format", label: "Format" },
                  { key: "first_update", label: "Buffered since" },
                  { key: "total_bytes", label: "Size", right: true, render: r => formatBytes(r.total_bytes) },
                ]} />
              </Section>
              <Section title="Async insert flushes" description="From system.asynchronous_insert_log." unavailable={unavailableFor("asyncLog")}>
                <DataTable rows={data.asyncLog} empty="No async inserts in this window (async_insert is off, or the log is disabled)." columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "status", label: "Status", render: r => <Badge variant="outline" className={r.status === "Ok" ? "font-normal" : "border-destructive/40 text-destructive"}>{r.status}</Badge> },
                  { key: "flushes", label: "Entries", right: true, render: r => formatNumber(r.flushes) },
                  { key: "rows", label: "Rows", right: true, render: r => formatNumber(r.rows) },
                  { key: "last", label: "Last", className: "whitespace-nowrap" },
                  { key: "exception", label: "Error", render: r => r.exception ? <span className="line-clamp-2 text-destructive">{r.exception}</span> : null },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="errors" className="mt-4">
              <Section title="Failed INSERT statements" description="Grouped by target table and error code (system.query_log)." unavailable={unavailableFor("errors")}>
                <DataTable rows={data.errors} empty="No failed inserts in this window." columns={[
                  { key: "tables", label: "Table", mono: true },
                  { key: "exception_code", label: "Code", right: true },
                  { key: "failures", label: "Failures", right: true, render: r => formatNumber(r.failures) },
                  { key: "last", label: "Last", className: "whitespace-nowrap" },
                  { key: "exception", label: "Error", render: r => <span className="line-clamp-3 text-destructive">{r.exception}</span> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="views" className="mt-4 space-y-4">
              <Section title="Materialized views" description="Each view runs on every insert into its source table and writes to its target. A slow or failing view slows down or fails those inserts." unavailable={unavailableFor("views")}>
                <DataTable rows={data.views} empty="No materialized views." columns={[
                  { key: "name", label: "View", render: v => <span className="font-mono">{v.database}.{v.name}</span> },
                  { key: "sources", label: "Source", render: v => v.sources?.length ? <span className="font-mono">{v.sources.join(", ")}</span> : <span className="text-muted-foreground">—</span> },
                  { key: "target", label: "Target", render: v => v.target ? <span className="font-mono">{String(v.target).replace(/`/g, "")}</span> : <span className="text-muted-foreground">inner table</span> },
                  { key: "as_select", label: "Query", render: v => <code className="line-clamp-2 break-all font-mono">{v.as_select}</code> },
                ]} />
              </Section>
              {!!data.viewErrors?.length && (
                <Section title="View errors" description="From system.query_views_log.">
                  <DataTable rows={data.viewErrors} columns={[
                    { key: "view_name", label: "View", mono: true },
                    { key: "view_type", label: "Type" },
                    { key: "status", label: "Status" },
                    { key: "c", label: "Count", right: true },
                    { key: "exception", label: "Error", render: r => <span className="line-clamp-2 text-destructive">{r.exception}</span> },
                  ]} />
                </Section>
              )}
              {!!data.refreshes?.length && (
                <Section title="Refreshable materialized views" description="Views rebuilt on a schedule (REFRESH EVERY …).">
                  <DataTable rows={data.refreshes} columns={Object.keys(data.refreshes[0]).slice(0, 9).map(k => ({ key: k, label: k }))} />
                </Section>
              )}
            </TabsContent>

            <TabsContent value="kafka" className="mt-4">
              <Section title="Kafka consumers" description="Kafka engine tables and their consumers." unavailable={unavailableFor("kafka")}>
                <DataTable rows={data.kafka} empty="No Kafka engine tables." columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "consumer_id", label: "Consumer", mono: true },
                  { key: "num_messages_read", label: "Messages", right: true, render: r => formatNumber(r.num_messages_read) },
                  { key: "last_poll_time", label: "Last poll", className: "whitespace-nowrap" },
                  { key: "last_commit_time", label: "Last commit", className: "whitespace-nowrap" },
                  { key: "num_rebalance_revocations", label: "Rebalances", right: true },
                  { key: "last_exception", label: "Last error", render: r => r.last_exception ? <span className="line-clamp-2 text-destructive">{r.last_exception}</span> : null },
                ]} />
              </Section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

export default function ClickHouseIngestionPage() {
  return (
    <ClickHouseGate>
      {(status, disconnect) => (
        <div className="space-y-6">
          <ClickHouseHeader title="Ingestion" status={status} onDisconnect={disconnect}
            description="How data arrives: insert rate per table, too-small batches, async inserts, failed inserts, materialized views and Kafka consumers." />
          <IngestionView />
        </div>
      )}
    </ClickHouseGate>
  );
}
