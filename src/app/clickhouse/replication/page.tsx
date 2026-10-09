"use client";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, StatGrid } from "@/components/app";
import {
  ClickHouseGate, ClickHouseHeader, DataTable, ErrorBanner, RefreshButton, Section, StatTile,
  formatBytes, formatNumber, useChData, YesNo,
} from "@/components/clickhouse/shared";
import { Loader2, Network } from "lucide-react";

type Row = Record<string, any>;
interface ReplicationData {
  clusters: Row[] | null;
  replicas: Row[] | null;
  queue: Row[] | null;
  ddl: Row[] | null;
  distribution: Row[] | null;
  keeper: Row[] | null;
  unavailable: { section: string; error: string }[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;

function ReplicationView() {
  const { data, error, loading, reload, unavailableFor } = useChData<ReplicationData>("/api/clickhouse/replication");

  const replicas = data?.replicas ?? [];
  const readonly = replicas.filter(r => n(r.is_readonly) || n(r.is_session_expired));
  const maxDelay = Math.max(0, ...replicas.map(r => n(r.absolute_delay)));
  const degraded = replicas.filter(r => n(r.active_replicas) < n(r.total_replicas));
  const clusterNames = [...new Set((data?.clusters ?? []).map(c => c.cluster))];
  const keeperUp = (data?.keeper ?? []).some(k => !n(k.is_expired));
  const failedDdl = (data?.ddl ?? []).filter(d => n(d.exception_code));
  const nothingReplicated = data && !replicas.length && !(data.distribution ?? []).length;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><RefreshButton loading={loading} onClick={reload} /></div>
      <ErrorBanner message={error} />
      {loading && !data && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {data && (
        <>
          <StatGrid>
            <StatTile label="Replicated tables" value={formatNumber(replicas.length)} sub={degraded.length ? `${degraded.length} missing a replica` : "all replicas active"} tone={degraded.length ? "warn" : "ok"} />
            <StatTile label="Read-only replicas" value={formatNumber(readonly.length)} tone={readonly.length ? "crit" : "ok"} sub="reject inserts — usually lost Keeper" />
            <StatTile label="Max replication delay" value={`${formatNumber(maxDelay)} s`} tone={maxDelay > 300 ? "crit" : maxDelay > 60 ? "warn" : "ok"} />
            <StatTile label="ClickHouse Keeper" value={data.keeper === null ? "not configured" : keeperUp ? "connected" : "disconnected"}
              tone={data.keeper === null ? undefined : keeperUp ? "ok" : "crit"} sub={`${clusterNames.length} cluster definition${clusterNames.length === 1 ? "" : "s"}`} />
          </StatGrid>

          {nothingReplicated && (
            <EmptyState icon={Network} title="This server does not replicate data"
              description="There are no Replicated*MergeTree or Distributed tables, so a lost disk or host means restoring from backup. For high availability use ReplicatedMergeTree with a 3-node ClickHouse Keeper ensemble." />
          )}

          <Tabs defaultValue="replicas">
            <TabsList className="flex-wrap">
              <TabsTrigger value="replicas">Replicas</TabsTrigger>
              <TabsTrigger value="queue">Replication queue{data.queue?.length ? ` (${data.queue.length})` : ""}</TabsTrigger>
              <TabsTrigger value="topology">Cluster topology</TabsTrigger>
              <TabsTrigger value="ddl">Distributed DDL{failedDdl.length ? ` (${failedDdl.length} failed)` : ""}</TabsTrigger>
              <TabsTrigger value="distribution">Distributed sends</TabsTrigger>
            </TabsList>

            <TabsContent value="replicas" className="mt-4">
              <Section title="Replicated tables" description="Each row is this server's replica of a table. A growing queue or delay means the replica is falling behind." unavailable={unavailableFor("replicas")}>
                <DataTable rows={data.replicas} empty="No replicated tables." columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "replica_name", label: "Replica", mono: true },
                  { key: "active", label: "Active / total", right: true, render: r => <span className={n(r.active_replicas) < n(r.total_replicas) ? "text-warning" : ""}>{r.active_replicas} / {r.total_replicas}</span> },
                  { key: "absolute_delay", label: "Delay", right: true, render: r => <span className={n(r.absolute_delay) > 300 ? "text-destructive" : ""}>{formatNumber(r.absolute_delay)} s</span> },
                  { key: "queue_size", label: "Queue", right: true },
                  { key: "inserts_in_queue", label: "Inserts", right: true },
                  { key: "merges_in_queue", label: "Merges", right: true },
                  { key: "is_leader", label: "Leader", render: r => <YesNo value={r.is_leader} /> },
                  { key: "is_readonly", label: "Read-only", render: r => <YesNo value={r.is_readonly} invert /> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="queue" className="mt-4">
              <Section title="Stuck or retrying replication tasks" description="Fetches, merges and mutations that have been retried, failed, or waited more than 10 minutes. postpone_reason explains why a task is waiting." unavailable={unavailableFor("queue")}>
                <DataTable rows={data.queue} empty="Nothing stuck in the replication queue." columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "type", label: "Task" },
                  { key: "new_part_name", label: "Part", mono: true },
                  { key: "create_time", label: "Queued", className: "whitespace-nowrap" },
                  { key: "num_tries", label: "Tries", right: true },
                  { key: "postpone_reason", label: "Waiting because", render: r => r.postpone_reason ? <span className="line-clamp-2">{r.postpone_reason}</span> : null },
                  { key: "last_exception", label: "Last error", render: r => r.last_exception ? <span className="line-clamp-3 text-destructive">{r.last_exception}</span> : null },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="topology" className="mt-4 space-y-4">
              <Section title="Clusters" description="From remote_servers in the server configuration. errors_count counts failed connections to that host." unavailable={unavailableFor("clusters")}>
                <DataTable rows={data.clusters} empty="No clusters defined." columns={[
                  { key: "cluster", label: "Cluster", mono: true },
                  { key: "shard_num", label: "Shard", right: true },
                  { key: "replica_num", label: "Replica", right: true },
                  { key: "host_name", label: "Host", render: r => <span className="font-mono">{r.host_name}:{r.port}{n(r.is_local) ? <Badge variant="outline" className="ml-2 font-normal">this server</Badge> : null}</span> },
                  { key: "host_address", label: "Address", mono: true },
                  { key: "errors_count", label: "Errors", right: true, render: r => <span className={n(r.errors_count) ? "text-destructive" : ""}>{formatNumber(r.errors_count)}</span> },
                  { key: "estimated_recovery_time", label: "Recovery in", right: true, render: r => n(r.estimated_recovery_time) ? `${r.estimated_recovery_time} s` : "—" },
                ]} />
              </Section>
              <Section title="ClickHouse Keeper / ZooKeeper" description="Replication and ON CLUSTER DDL need a healthy Keeper connection." unavailable={unavailableFor("keeper") ? "Keeper is not configured on this server" : null}>
                <DataTable rows={data.keeper} columns={[
                  { key: "name", label: "Name", mono: true },
                  { key: "host", label: "Host", render: k => <span className="font-mono">{k.host}:{k.port}</span> },
                  { key: "connected_time", label: "Connected since" },
                  { key: "is_expired", label: "Session expired", render: k => <YesNo value={k.is_expired} invert /> },
                  { key: "keeper_api_version", label: "API version", right: true },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="ddl" className="mt-4">
              <Section title="ON CLUSTER DDL" description="Each DDL statement run ON CLUSTER and its status per host." unavailable={unavailableFor("ddl") ? "needs ClickHouse Keeper and a cluster definition" : null}>
                <DataTable rows={data.ddl} empty="No distributed DDL recorded." columns={[
                  { key: "query_create_time", label: "Created", className: "whitespace-nowrap" },
                  { key: "cluster", label: "Cluster", mono: true },
                  { key: "host", label: "Host", mono: true },
                  { key: "status", label: "Status", render: d => <Badge variant="outline" className={n(d.exception_code) ? "border-destructive/40 text-destructive" : "font-normal"}>{d.status}</Badge> },
                  { key: "query", label: "Query", render: d => <code className="line-clamp-2 break-all font-mono">{d.query}</code> },
                  { key: "exception_text", label: "Error", render: d => d.exception_text ? <span className="line-clamp-2 text-destructive">{d.exception_text}</span> : null },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="distribution" className="mt-4">
              <Section title="Distributed table send queues" description="Inserts into Distributed tables are queued locally and sent to shards in the background. A growing queue or broken files mean a shard is unreachable." unavailable={unavailableFor("distribution")}>
                <DataTable rows={data.distribution} empty="No Distributed tables with queued data." columns={[
                  { key: "table", label: "Table", render: r => <span className="font-mono">{r.database}.{r.table}</span> },
                  { key: "data_files", label: "Files", right: true },
                  { key: "data_compressed_bytes", label: "Queued", right: true, render: r => formatBytes(r.data_compressed_bytes) },
                  { key: "broken_data_files", label: "Broken", right: true, render: r => <span className={n(r.broken_data_files) ? "text-destructive" : ""}>{r.broken_data_files}</span> },
                  { key: "error_count", label: "Errors", right: true },
                  { key: "is_blocked", label: "Blocked", render: r => <YesNo value={r.is_blocked} invert /> },
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

export default function ClickHouseReplicationPage() {
  return (
    <ClickHouseGate>
      {(status, disconnect) => (
        <div className="space-y-6">
          <ClickHouseHeader title="Replication & cluster" status={status} onDisconnect={disconnect}
            description="Replica health and lag, the replication queue, cluster topology, ClickHouse Keeper, ON CLUSTER DDL and Distributed send queues." />
          <ReplicationView />
        </div>
      )}
    </ClickHouseGate>
  );
}
