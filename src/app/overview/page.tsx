"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { VulnerabilityBanner } from "@/components/security/vulnerability-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState, HealthBadge, PageHeader, StatCard, StatGrid } from "@/components/app";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Database,
  Download,
  Layers,
  Loader2,
  RefreshCw,
  Server,
} from "lucide-react";

interface ClusterHealth {
  cluster_name: string;
  status: "green" | "yellow" | "red";
  timed_out: boolean;
  number_of_nodes: number;
  number_of_data_nodes: number;
  active_primary_shards: number;
  active_shards: number;
  relocating_shards: number;
  initializing_shards: number;
  unassigned_shards: number;
  delayed_unassigned_shards: number;
  number_of_pending_tasks: number;
  number_of_in_flight_fetch: number;
  task_max_waiting_in_queue_millis: number;
  active_shards_percent_as_number: number;
}

interface ClusterStats {
  nodes: {
    count: {
      total: number;
      data: number;
      coordinating_only: number;
      master: number;
      ingest: number;
    };
  };
  indices: {
    count: number;
    shards: {
      total: number;
      primaries: number;
      replication: number;
    };
    docs: {
      count: number;
      deleted: number;
    };
    store: {
      size_in_bytes: number;
    };
  };
}

export default function OverviewPage() {
  const { isConnected } = useConnection();
  const router = useRouter();
  const [clusterHealth, setClusterHealth] = useState<ClusterHealth | null>(null);
  const [clusterStats, setClusterStats] = useState<ClusterStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Load cluster data
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  const loadClusterData = useCallback(async () => {
    if (!isConnected) {
      setError("Not connected to cluster");
      return;
    }

    const client = getElasticsearchClient();
    if (!client) {
      setError("No client available");
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const [health, stats] = await Promise.all([
        client.getClusterHealth(),
        client.getClusterStats()
      ]);
      
      setClusterHealth(health);
      setClusterStats(stats);
    } catch (err: any) {
      setError(`Failed to load cluster data: ${err.message}`);
      console.error('Error loading cluster data:', err);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  // Load data on mount and when connection changes
  useEffect(() => {
    if (isConnected) {
      loadClusterData();
    } else {
      setClusterHealth(null);
      setClusterStats(null);
    }
  }, [isConnected, loadClusterData]);

  // Auto-refresh functionality
  useEffect(() => {
    if (autoRefresh && isConnected) {
      // Refresh every 30 seconds; skip a tick while the previous refresh is still running
      const interval = setInterval(() => { if (!loadingRef.current) loadClusterData(); }, 30000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, isConnected, loadClusterData]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  // Simple, factual checks derived from health + stats (details on Cluster analysis)
  const checks = clusterHealth ? [
    {
      label: "Cluster status",
      ok: clusterHealth.status === "green",
      warn: clusterHealth.status === "yellow",
      detail: clusterHealth.status === "green" ? "All shards allocated" : clusterHealth.status === "yellow" ? "Some replica shards are unassigned" : "Some primary shards are unassigned",
    },
    {
      label: "Unassigned shards",
      ok: clusterHealth.unassigned_shards === 0,
      warn: false,
      detail: clusterHealth.unassigned_shards === 0 ? "None" : `${formatNumber(clusterHealth.unassigned_shards)} shards need allocation`,
    },
    {
      label: "Node redundancy",
      ok: clusterHealth.number_of_nodes >= 3,
      warn: clusterHealth.number_of_nodes < 3,
      detail: clusterHealth.number_of_nodes >= 3 ? `${clusterHealth.number_of_nodes} nodes` : `${clusterHealth.number_of_nodes} node(s) — 3 or more recommended for high availability`,
    },
    {
      label: "Pending cluster tasks",
      ok: clusterHealth.number_of_pending_tasks === 0,
      warn: clusterHealth.number_of_pending_tasks > 0,
      detail: clusterHealth.number_of_pending_tasks === 0 ? "Queue empty" : `${clusterHealth.number_of_pending_tasks} waiting`,
    },
  ] : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={clusterHealth ? `Health and capacity of ${clusterHealth.cluster_name}.` : "Health and capacity of the connected cluster."}
        meta={clusterHealth ? <HealthBadge status={clusterHealth.status} /> : undefined}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              disabled={!isConnected}
              aria-pressed={autoRefresh}
            >
              <Activity className="h-4 w-4 mr-2" />
              {autoRefresh ? "Auto-refresh on" : "Auto-refresh off"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/reports')}
              disabled={!isConnected}
              className="hidden sm:inline-flex"
            >
              <Download className="h-4 w-4 mr-2" />
              Export report
            </Button>
            <Button size="sm" onClick={loadClusterData} disabled={!isConnected || loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </>
        }
      />

      {isConnected && <VulnerabilityBanner target="search" />}

      {!isConnected && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to see its health and capacity."
          action={<Button size="sm" onClick={() => router.push('/connections')}>Go to connections</Button>}
        />
      )}

      {error && isConnected && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {clusterHealth && (
        <StatGrid>
          <StatCard
            label="Active shards"
            icon={Layers}
            value={formatNumber(clusterHealth.active_shards)}
            hint={`${clusterHealth.active_shards_percent_as_number}% of all shards active`}
            tone={clusterHealth.active_shards_percent_as_number < 100 ? "warning" : "default"}
          />
          <StatCard label="Primary shards" icon={Layers} value={formatNumber(clusterHealth.active_primary_shards)} />
          <StatCard
            label="Nodes"
            icon={Server}
            value={formatNumber(clusterHealth.number_of_nodes)}
            hint={`${clusterHealth.number_of_data_nodes} data nodes`}
          />
          <StatCard
            label="Unassigned shards"
            icon={AlertTriangle}
            value={formatNumber(clusterHealth.unassigned_shards)}
            tone={clusterHealth.unassigned_shards > 0 ? "danger" : "default"}
            hint={clusterHealth.unassigned_shards > 0 ? "See Shards for allocation details" : "All shards allocated"}
          />
        </StatGrid>
      )}

      {clusterHealth && (clusterHealth.relocating_shards > 0 || clusterHealth.initializing_shards > 0 || clusterHealth.number_of_pending_tasks > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operations in progress</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">Relocating shards</span>
              <span className="font-medium tabular-nums">{clusterHealth.relocating_shards}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">Initializing shards</span>
              <span className="font-medium tabular-nums">{clusterHealth.initializing_shards}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">Pending tasks</span>
              <span className="font-medium tabular-nums">{clusterHealth.number_of_pending_tasks}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {clusterHealth && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base">Quick checks</CardTitle>
              <CardDescription>Basic resilience checks. Cluster analysis scores configuration and performance in depth.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => router.push('/cluster-analysis')}>
              Open analysis
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {checks.map(c => (
                <li key={c.label} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  {c.ok
                    ? <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                    : c.warn
                      ? <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                      : <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}
                  <span className="font-medium">{c.label}</span>
                  <span className="ml-auto text-right text-muted-foreground">{c.detail}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {clusterStats && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Indices</CardTitle>
              <CardDescription>Shards, documents and storage across all indices.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <Metric label="Indices" value={formatNumber(clusterStats.indices.count)} />
                <Metric label="Total shards" value={formatNumber(clusterStats.indices.shards.total)} />
                <Metric label="Primary shards" value={formatNumber(clusterStats.indices.shards.primaries)} />
                <Metric label="Replica shards" value={formatNumber(clusterStats.indices.shards.total - clusterStats.indices.shards.primaries)} />
                <Metric label="Documents" value={formatNumber(clusterStats.indices.docs.count)} />
                <Metric label="Store size" value={formatBytes(clusterStats.indices.store.size_in_bytes)} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nodes</CardTitle>
              <CardDescription>Node count by role.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <Metric label="Total" value={formatNumber(clusterStats.nodes.count.total)} />
                <Metric label="Data" value={formatNumber(clusterStats.nodes.count.data)} />
                <Metric label="Master-eligible" value={formatNumber(clusterStats.nodes.count.master)} />
                <Metric label="Ingest" value={formatNumber(clusterStats.nodes.count.ingest)} />
                <Metric label="Coordinating only" value={formatNumber(clusterStats.nodes.count.coordinating_only)} />
              </dl>
            </CardContent>
          </Card>
        </div>
      )}

      {loading && !clusterHealth && (
        <div className="space-y-6">
          <StatGrid>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
          </StatGrid>
          <Skeleton className="h-48 rounded-xl" />
        </div>
      )}

      {!loading && !clusterHealth && isConnected && (
        <EmptyState
          icon={Activity}
          title="No cluster data"
          description="The cluster did not return health information."
          action={
            <Button variant="outline" size="sm" onClick={loadClusterData}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          }
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
