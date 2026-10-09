"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { EmptyState, HealthBadge, PageHeader, SeverityBadge, StatCard, StatGrid } from "@/components/app";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Database,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  XCircle,
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

interface NodeStats {
  nodes: Record<string, {
    name: string;
    host: string;
    ip: string;
    roles: string[];
    jvm: {
      mem: {
        heap_used_percent: number;
        heap_used_in_bytes: number;
        heap_max_in_bytes: number;
      };
    };
    os: {
      cpu: {
        percent: number;
      };
      mem: {
        used_percent: number;
        used_in_bytes: number;
        total_in_bytes: number;
      };
    };
    fs: {
      total: {
        total_in_bytes: number;
        free_in_bytes: number;
        available_in_bytes: number;
      };
    };
    indices: {
      indexing: {
        index_total: number;
        index_time_in_millis: number;
      };
      search: {
        query_total: number;
        query_time_in_millis: number;
      };
      docs: {
        count: number;
      };
      store: {
        size_in_bytes: number;
      };
    };
  }>;
}

interface HealthIssue {
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  recommendation: string;
  value?: string | number;
}

export default function ClusterHealthPage() {
  const { isConnected } = useConnection();
  const [clusterHealth, setClusterHealth] = useState<ClusterHealth | null>(null);
  const [nodeStats, setNodeStats] = useState<NodeStats | null>(null);
  const [healthIssues, setHealthIssues] = useState<HealthIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Load cluster health data
  const loadClusterHealth = async () => {
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
      // Load cluster health
      const healthResponse = await client.request('/_cluster/health');
      setClusterHealth(healthResponse);
      
      // Load node stats
      const statsResponse = await client.request('/_nodes/stats/jvm,os,fs,indices');
      setNodeStats(statsResponse);
      
      // Analyze health and generate issues
      analyzeClusterHealth(healthResponse, statsResponse);
      
    } catch (err: any) {
      setError(`Failed to load cluster health: ${err.message}`);
      console.error('Error loading cluster health:', err);
    } finally {
      setLoading(false);
    }
  };

  // Analyze cluster health and identify issues
  const analyzeClusterHealth = (health: ClusterHealth, stats: NodeStats) => {
    const issues: HealthIssue[] = [];

    // Cluster status issues
    if (health.status === 'red') {
      issues.push({
        severity: "critical",
        category: "Cluster Status",
        title: "Cluster Status is RED",
        description: "Some primary shards are not allocated",
        recommendation: "Check unassigned shards and node availability",
        value: health.status
      });
    } else if (health.status === 'yellow') {
      issues.push({
        severity: "warning",
        category: "Cluster Status",
        title: "Cluster Status is YELLOW", 
        description: "Some replica shards are not allocated",
        recommendation: "Consider adding more data nodes or adjusting replica settings",
        value: health.status
      });
    }

    // Unassigned shards
    if (health.unassigned_shards > 0) {
      issues.push({
        severity: health.status === 'red' ? "critical" : "warning",
        category: "Shard Allocation",
        title: `${health.unassigned_shards} Unassigned Shards`,
        description: "Shards that cannot be allocated to any node",
        recommendation: "Check node disk space, shard allocation settings, and cluster routing",
        value: health.unassigned_shards
      });
    }

    // Pending tasks
    if (health.number_of_pending_tasks > 10) {
      issues.push({
        severity: "warning",
        category: "Cluster Performance", 
        title: `${health.number_of_pending_tasks} Pending Tasks`,
        description: "High number of pending cluster state update tasks",
        recommendation: "Monitor cluster performance and consider reducing indexing load",
        value: health.number_of_pending_tasks
      });
    }

    // Node-specific issues
    if (stats.nodes) {
      Object.values(stats.nodes).forEach(node => {
        // High heap usage
        if (node.jvm.mem.heap_used_percent > 85) {
          issues.push({
            severity: node.jvm.mem.heap_used_percent > 95 ? "critical" : "warning",
            category: "Memory",
            title: `High Heap Usage on ${node.name}`,
            description: `JVM heap usage is at ${node.jvm.mem.heap_used_percent}%`,
            recommendation: "Consider increasing heap size or reducing memory usage",
            value: `${node.jvm.mem.heap_used_percent}%`
          });
        }

        // High CPU usage
        if (node.os.cpu.percent > 80) {
          issues.push({
            severity: node.os.cpu.percent > 95 ? "critical" : "warning",
            category: "CPU",
            title: `High CPU Usage on ${node.name}`,
            description: `CPU usage is at ${node.os.cpu.percent}%`,
            recommendation: "Monitor workload and consider scaling or optimizing queries",
            value: `${node.os.cpu.percent}%`
          });
        }

        // Low disk space
        const diskUsedPercent = ((node.fs.total.total_in_bytes - node.fs.total.available_in_bytes) / node.fs.total.total_in_bytes) * 100;
        if (diskUsedPercent > 85) {
          issues.push({
            severity: diskUsedPercent > 95 ? "critical" : "warning",
            category: "Disk Space",
            title: `Low Disk Space on ${node.name}`,
            description: `Disk usage is at ${diskUsedPercent.toFixed(1)}%`,
            recommendation: "Free up disk space or add more storage capacity",
            value: `${diskUsedPercent.toFixed(1)}%`
          });
        }

        // High memory usage
        if (node.os.mem.used_percent > 90) {
          issues.push({
            severity: "warning",
            category: "Memory",
            title: `High Memory Usage on ${node.name}`,
            description: `System memory usage is at ${node.os.mem.used_percent}%`,
            recommendation: "Monitor memory usage and consider adding more RAM",
            value: `${node.os.mem.used_percent}%`
          });
        }
      });
    }

    // Active shards percentage
    if (health.active_shards_percent_as_number < 100) {
      issues.push({
        severity: health.active_shards_percent_as_number < 50 ? "critical" : "warning",
        category: "Shard Allocation",
        title: "Incomplete Shard Allocation",
        description: `Only ${health.active_shards_percent_as_number}% of shards are active`,
        recommendation: "Investigate shard allocation issues and node health",
        value: `${health.active_shards_percent_as_number}%`
      });
    }

    setHealthIssues(issues);
  };

  // loadClusterHealth is recreated every render; effects call the latest version
  // through a ref so they keep firing only on their listed triggers.
  const loadClusterHealthRef = useRef(loadClusterHealth);
  loadClusterHealthRef.current = loadClusterHealth;

  // Auto-refresh functionality
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoRefresh && isConnected) {
      interval = setInterval(() => loadClusterHealthRef.current(), 30000); // Refresh every 30 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, isConnected]);

  // Load data on mount
  useEffect(() => {
    if (isConnected) {
      loadClusterHealthRef.current();
    } else {
      setClusterHealth(null);
      setNodeStats(null);
      setHealthIssues([]);
    }
  }, [isConnected]);

  const formatBytes = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "critical": return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
      case "warning": return <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />;
      default: return <AlertCircle className="h-4 w-4 shrink-0 text-info" />;
    }
  };

  const usageTone = (pct: number) => (pct >= 90 ? "text-destructive" : pct >= 75 ? "text-warning" : "text-muted-foreground");

  const criticalIssues = healthIssues.filter(issue => issue.severity === 'critical');
  const warningIssues = healthIssues.filter(issue => issue.severity === 'warning');
  const score = clusterHealth ? Math.max(0, 100 - (criticalIssues.length * 20 + warningIssues.length * 10)) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cluster health"
        description="Node resources, shard state and automatically detected issues."
        meta={clusterHealth ? <><HealthBadge status={clusterHealth.status} /><span className="text-sm text-muted-foreground">{clusterHealth.cluster_name}</span></> : undefined}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              disabled={!isConnected}
              aria-pressed={autoRefresh}
            >
              <Clock className="h-4 w-4 mr-2" />
              {autoRefresh ? "Auto-refresh on" : "Auto-refresh off"}
            </Button>
            <Button size="sm" onClick={loadClusterHealth} disabled={!isConnected || loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </>
        }
      />

      {!isConnected && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to run health diagnostics."
          action={<Button size="sm" asChild><Link href="/connections">Go to connections</Link></Button>}
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
            label="Health score"
            icon={Activity}
            value={`${score}%`}
            hint={`${criticalIssues.length} critical · ${warningIssues.length} warnings`}
            tone={criticalIssues.length ? "danger" : warningIssues.length ? "warning" : "success"}
          />
          <StatCard label="Nodes" icon={Server} value={clusterHealth.number_of_nodes} hint={`${clusterHealth.number_of_data_nodes} data nodes`} />
          <StatCard label="Active shards" icon={Layers} value={clusterHealth.active_shards.toLocaleString()} hint={`${clusterHealth.active_primary_shards.toLocaleString()} primary`} />
          <StatCard
            label="Shards active"
            icon={CheckCircle}
            value={`${clusterHealth.active_shards_percent_as_number}%`}
            tone={clusterHealth.active_shards_percent_as_number < 100 ? "warning" : "default"}
            hint={clusterHealth.unassigned_shards ? `${clusterHealth.unassigned_shards} unassigned` : "All shards allocated"}
          />
        </StatGrid>
      )}

      {isConnected && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Detected issues ({healthIssues.length})</CardTitle>
              <CardDescription>Health and performance problems found in the latest check, with recommendations.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading && !clusterHealth ? (
                <div className="space-y-3">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
              ) : healthIssues.length === 0 ? (
                <EmptyState icon={CheckCircle} title="No issues detected" description="No critical issues or warnings were found." className="border-none p-6" />
              ) : (
                <ul className="space-y-3">
                  {healthIssues.map((issue, index) => (
                    <li key={index} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {severityIcon(issue.severity)}
                        <h3 className="text-sm font-medium">{issue.title}</h3>
                        <SeverityBadge level={issue.severity} className="capitalize">{issue.severity}</SeverityBadge>
                        <Badge variant="outline" className="font-normal">{issue.category}</Badge>
                        {issue.value && <span className="ml-auto text-sm font-medium tabular-nums">{issue.value}</span>}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{issue.description}</p>
                      <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
                        <span className="font-medium">Recommendation: </span>{issue.recommendation}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Node resources</CardTitle>
              <CardDescription>Heap, CPU and disk per node.</CardDescription>
            </CardHeader>
            <CardContent>
              {nodeStats ? (
                <ul className="space-y-4">
                  {Object.values(nodeStats.nodes).map((node, index) => {
                    const diskUsedPercent = ((node.fs.total.total_in_bytes - node.fs.total.available_in_bytes) / node.fs.total.total_in_bytes) * 100;
                    const rows = [
                      { label: "JVM heap", value: node.jvm.mem.heap_used_percent },
                      { label: "CPU", value: node.os.cpu.percent },
                      { label: "Disk", value: diskUsedPercent },
                    ];
                    return (
                      <li key={index} className="rounded-lg border p-3">
                        <h4 className="mb-2 truncate text-sm font-medium">{node.name}</h4>
                        <div className="space-y-2">
                          {rows.map(r => (
                            <div key={r.label}>
                              <div className="mb-1 flex justify-between text-xs">
                                <span className="text-muted-foreground">{r.label}</span>
                                <span className={`tabular-nums ${usageTone(r.value)}`}>{r.value.toFixed(r.label === "Disk" ? 1 : 0)}%</span>
                              </div>
                              <Progress value={r.value} className="h-1.5" />
                            </div>
                          ))}
                          <div className="text-xs text-muted-foreground">
                            {node.indices.docs.count.toLocaleString()} docs · {formatBytes(node.indices.store.size_in_bytes)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-28" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {clusterHealth && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cluster statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="shards">
              <TabsList>
                <TabsTrigger value="shards">Shards</TabsTrigger>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
              </TabsList>

              <TabsContent value="shards" className="pt-4">
                <dl className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                  <Figure label="Active" value={clusterHealth.active_shards} />
                  <Figure label="Relocating" value={clusterHealth.relocating_shards} tone={clusterHealth.relocating_shards ? "text-info" : undefined} />
                  <Figure label="Initializing" value={clusterHealth.initializing_shards} tone={clusterHealth.initializing_shards ? "text-warning" : undefined} />
                  <Figure label="Unassigned" value={clusterHealth.unassigned_shards} tone={clusterHealth.unassigned_shards ? "text-destructive" : undefined} />
                </dl>
              </TabsContent>

              <TabsContent value="tasks" className="pt-4">
                <dl className="grid gap-4 grid-cols-2 md:grid-cols-3">
                  <Figure label="Pending tasks" value={clusterHealth.number_of_pending_tasks} />
                  <Figure label="In-flight fetches" value={clusterHealth.number_of_in_flight_fetch} />
                  <Figure label="Max queue wait" value={`${clusterHealth.task_max_waiting_in_queue_millis} ms`} />
                </dl>
              </TabsContent>

              <TabsContent value="performance" className="pt-4">
                {nodeStats && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {Object.values(nodeStats.nodes).map((node, index) => (
                      <div key={index} className="rounded-lg border p-4">
                        <h4 className="mb-3 truncate text-sm font-medium">{node.name}</h4>
                        <dl className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <dt className="text-muted-foreground">Indexing throughput</dt>
                            <dd className="font-medium tabular-nums">
                              {(node.indices.indexing.index_total / (node.indices.indexing.index_time_in_millis / 1000 || 1)).toFixed(1)} ops/s
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Search throughput</dt>
                            <dd className="font-medium tabular-nums">
                              {(node.indices.search.query_total / (node.indices.search.query_time_in_millis / 1000 || 1)).toFixed(1)} ops/s
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Documents</dt>
                            <dd className="font-medium tabular-nums">{node.indices.docs.count.toLocaleString()}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Store size</dt>
                            <dd className="font-medium tabular-nums">{formatBytes(node.indices.store.size_in_bytes)}</dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
