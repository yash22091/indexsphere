"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatGrid } from "@/components/app";
import { useAuth } from "@/contexts/auth-context";
import {
  ClickHouseGate, ClickHouseHeader, DataTable, ErrorBanner, RefreshButton, Section, StatTile, chFetch,
  formatBytes, formatMs, formatNumber, useChData,
} from "@/components/clickhouse/shared";
import { Loader2, XOctagon } from "lucide-react";

type Row = Record<string, any>;
interface MergesData {
  merges: Row[] | null;
  mutations: Row[] | null;
  partitions: Row[] | null;
  thresholds: Row[] | null;
  moves: Row[] | null;
  history: Row[] | null;
  unavailable: { section: string; error: string }[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;

function MergesView() {
  const { user } = useAuth();
  const isAdmin = !!user?.permissions?.includes("admin");
  const { data, error, loading, reload, unavailableFor } = useChData<MergesData>("/api/clickhouse/merges");
  const [killing, setKilling] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const th = Object.fromEntries((data?.thresholds ?? []).map(r => [r.name, n(r.value)]));
  const delay = th.parts_to_delay_insert || 1000;
  const thrw = th.parts_to_throw_insert || 3000;
  const pending = (data?.mutations ?? []).filter(m => !n(m.is_done));
  const failing = pending.filter(m => m.latest_fail_reason);
  const worst = n(data?.partitions?.[0]?.parts);

  const kill = async (m: Row) => {
    if (!confirm(`Kill mutation ${m.mutation_id} on ${m.database}.${m.table}?\n\nParts already mutated stay mutated.`)) return;
    setKilling(m.mutation_id);
    setActionError(null);
    try {
      await chFetch("/api/clickhouse/merges/kill-mutation", { method: "POST", body: JSON.stringify({ database: m.database, table: m.table, mutationId: m.mutation_id }) });
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Kill failed");
    } finally {
      setKilling(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><RefreshButton loading={loading} onClick={reload} /></div>
      <ErrorBanner message={error ?? actionError} />
      {loading && !data && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {data && (
        <>
          <StatGrid>
            <StatTile label="Running merges" value={formatNumber(data.merges?.length)} sub={`${formatNumber((data.merges ?? []).filter(m => n(m.is_mutation)).length)} are mutations`} />
            <StatTile label="Pending mutations" value={formatNumber(pending.length)} tone={failing.length ? "crit" : pending.length ? "warn" : "ok"} sub={failing.length ? `${failing.length} failing` : "none failing"} />
            <StatTile label="Max parts in a partition" value={formatNumber(worst)} tone={worst >= delay ? "crit" : worst >= delay / 2 ? "warn" : "ok"} sub={`inserts slow at ${delay}, fail at ${thrw}`} />
            <StatTile label="Part moves" value={formatNumber(data.moves?.length)} sub="between disks / volumes" />
          </StatGrid>

          <Tabs defaultValue="merges">
            <TabsList className="flex-wrap">
              <TabsTrigger value="merges">Running merges</TabsTrigger>
              <TabsTrigger value="mutations">Mutations{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
              <TabsTrigger value="parts">Parts pressure</TabsTrigger>
              <TabsTrigger value="history">Merge history (24h)</TabsTrigger>
            </TabsList>

            <TabsContent value="merges" className="mt-4 space-y-4">
              <Section title="Running merges" description="Background merges combine small parts into larger ones. Long merges of huge parts are normal; many concurrent merges on one table usually mean too-frequent inserts." unavailable={unavailableFor("merges")}>
                <DataTable rows={data.merges} empty="No merges running." columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "progress", label: "Progress", render: r => <div className="flex min-w-32 items-center gap-2"><Progress value={n(r.progress) * 100} className="h-1.5" /><span className="tabular-nums">{Math.round(n(r.progress) * 100)}%</span></div> },
                  { key: "elapsed", label: "Elapsed", right: true, render: r => `${n(r.elapsed).toFixed(1)} s` },
                  { key: "num_parts", label: "Parts", right: true },
                  { key: "total_size_bytes_compressed", label: "Size", right: true, render: r => formatBytes(r.total_size_bytes_compressed) },
                  { key: "memory_usage", label: "Memory", right: true, render: r => formatBytes(r.memory_usage) },
                  { key: "kind", label: "Kind", render: r => n(r.is_mutation) ? <Badge variant="outline">mutation</Badge> : <span className="text-muted-foreground">{r.merge_type} · {r.merge_algorithm}</span> },
                ]} />
              </Section>
              {!!data.moves?.length && (
                <Section title="Part moves" description="Parts being moved between disks by a storage policy or TTL MOVE rule.">
                  <DataTable rows={data.moves} columns={[
                    { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                    { key: "part_name", label: "Part", mono: true },
                    { key: "target_disk_name", label: "Target disk" },
                    { key: "part_size", label: "Size", right: true, render: r => formatBytes(r.part_size) },
                    { key: "elapsed", label: "Elapsed", right: true, render: r => `${n(r.elapsed).toFixed(1)} s` },
                  ]} />
                </Section>
              )}
            </TabsContent>

            <TabsContent value="mutations" className="mt-4">
              <Section title="Mutations" description="ALTER … UPDATE/DELETE rewrite whole parts in the background. Prefer lightweight DELETE or dropping partitions (insert-mutation-avoid-update)." unavailable={unavailableFor("mutations")}>
                <DataTable rows={data.mutations} empty="No mutations in the last 7 days." rowKey={r => `${r.database}.${r.table}.${r.mutation_id}`} columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "command", label: "Command", render: r => <code className="line-clamp-2 break-all font-mono">{r.command}</code> },
                  { key: "create_time", label: "Created", className: "whitespace-nowrap" },
                  { key: "parts_to_do", label: "Parts left", right: true },
                  { key: "status", label: "Status", render: r => n(r.is_done)
                    ? <Badge variant="outline" className="font-normal">done</Badge>
                    : r.latest_fail_reason
                      ? <div className="max-w-sm space-y-1"><Badge variant="outline" className="border-destructive/40 text-destructive">failing</Badge><p className="line-clamp-3 text-destructive">{r.latest_fail_reason}</p></div>
                      : <Badge variant="outline" className="border-warning/40 text-warning">running</Badge> },
                  { key: "actions", label: "", render: r => !n(r.is_done) && isAdmin ? (
                    <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => kill(r)} disabled={killing === r.mutation_id}>
                      {killing === r.mutation_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XOctagon className="mr-1 h-3.5 w-3.5" />}Kill
                    </Button>
                  ) : null },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="parts" className="mt-4">
              <Section title="Partitions with the most parts"
                description={`Each INSERT creates at least one part. At ${delay} active parts in one partition inserts are slowed down; at ${thrw} they fail with TOO_MANY_PARTS. Batch inserts (10K–100K rows) or use async_insert.`}
                unavailable={unavailableFor("partitions")}>
                <DataTable rows={data.partitions} columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "partition", label: "Partition", mono: true },
                  { key: "parts", label: "Active parts", right: true, render: r => (
                    <span className={n(r.parts) >= delay ? "font-semibold text-destructive" : n(r.parts) >= delay / 2 ? "font-semibold text-warning" : ""}>{formatNumber(r.parts)}</span>
                  ) },
                  { key: "pressure", label: "of limit", render: r => <div className="min-w-24"><Progress value={Math.min(100, (n(r.parts) / thrw) * 100)} className="h-1.5" /></div> },
                  { key: "rows", label: "Rows", right: true, render: r => formatNumber(r.rows) },
                  { key: "bytes", label: "Size", right: true, render: r => formatBytes(r.bytes) },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <Section title="Merges and mutations per table, last 24 hours" description="From system.part_log." unavailable={unavailableFor("history")}>
                <DataTable rows={data.history} empty="No merges recorded in the last 24 hours." columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "merges", label: "Merges", right: true, render: r => formatNumber(r.merges) },
                  { key: "mutations", label: "Mutated parts", right: true, render: r => formatNumber(r.mutations) },
                  { key: "avg_merge_ms", label: "Avg merge", right: true, render: r => formatMs(r.avg_merge_ms) },
                  { key: "max_merge_ms", label: "Longest", right: true, render: r => formatMs(r.max_merge_ms) },
                  { key: "merged_bytes", label: "Written", right: true, render: r => formatBytes(r.merged_bytes) },
                  { key: "errors", label: "Errors", right: true, render: r => <span className={n(r.errors) ? "text-destructive" : ""}>{formatNumber(r.errors)}</span> },
                ]} />
              </Section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

export default function ClickHouseMergesPage() {
  return (
    <ClickHouseGate>
      {(status, disconnect) => (
        <div className="space-y-6">
          <ClickHouseHeader title="Merges & mutations" status={status} onDisconnect={disconnect}
            description="Background work that keeps MergeTree tables healthy: running merges, mutations (with kill), parts per partition against the insert limits, and merge history." />
          <MergesView />
        </div>
      )}
    </ClickHouseGate>
  );
}
