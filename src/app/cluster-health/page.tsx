"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { 
  Activity, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Database,
  HardDrive,
  Cpu,
  MemoryStick,
  Network,
  Clock,
  Zap,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Loader2,
  FileText,
  Settings,
  Server,
  Layers
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

  // Auto-refresh functionality
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoRefresh && isConnected) {
      interval = setInterval(loadClusterHealth, 30000); // Refresh every 30 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, isConnected]);

  // Load data on mount
  useEffect(() => {
    if (isConnected) {
      loadClusterHealth();
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "green": return "text-green-600 bg-green-100 dark:bg-green-900 dark:text-green-300";
      case "yellow": return "text-yellow-600 bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-300";
      case "red": return "text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-300";
      default: return "text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-300";
      case "warning": return "text-yellow-600 bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-300";
      case "info": return "text-blue-600 bg-blue-100 dark:bg-blue-900 dark:text-blue-300";
      default: return "text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "critical": return <XCircle className="h-4 w-4" />;
      case "warning": return <AlertTriangle className="h-4 w-4" />;
      case "info": return <AlertCircle className="h-4 w-4" />;
      default: return <AlertCircle className="h-4 w-4" />;
    }
  };

  const criticalIssues = healthIssues.filter(issue => issue.severity === 'critical');
  const warningIssues = healthIssues.filter(issue => issue.severity === 'warning');

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <Activity className="h-8 w-8 mr-3" />
            Cluster Health Diagnostics
          </h1>
          <p className="text-muted-foreground mt-2">
            Monitor cluster health and automatically detect performance issues
          </p>
        </div>
        <div className="flex space-x-2">
          <Button 
            onClick={() => setAutoRefresh(!autoRefresh)} 
            variant={autoRefresh ? "default" : "outline"}
            disabled={!isConnected}
          >
            <Clock className="h-4 w-4 mr-2" />
            Auto Refresh
          </Button>
          <Button 
            onClick={loadClusterHealth} 
            variant="outline"
            disabled={!isConnected || loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Connection Status & Error Messages */}
      {!isConnected && (
        <Alert className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          <Database className="h-4 w-4" />
          <AlertDescription>
            Not connected to cluster. Please connect first to view cluster health.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Health Issues Summary */}
      {healthIssues.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-red-200 dark:border-red-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-700 dark:text-red-300">Critical Issues</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{criticalIssues.length}</div>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 dark:border-yellow-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-700 dark:text-yellow-300">Warnings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-600">{warningIssues.length}</div>
            </CardContent>
          </Card>
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">Health Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">
                {clusterHealth ? Math.max(0, 100 - (criticalIssues.length * 20 + warningIssues.length * 10)) : 0}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cluster Overview */}
      {clusterHealth && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Database className="h-5 w-5 mr-2" />
              Cluster Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center space-x-2">
                <Badge className={getStatusColor(clusterHealth.status)}>
                  {clusterHealth.status.toUpperCase()}
                </Badge>
                <span className="font-medium">{clusterHealth.cluster_name}</span>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Nodes</div>
                <div className="text-lg font-semibold">{clusterHealth.number_of_nodes} ({clusterHealth.number_of_data_nodes} data)</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Active Shards</div>
                <div className="text-lg font-semibold">{clusterHealth.active_shards} ({clusterHealth.active_primary_shards} primary)</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Shard Health</div>
                <div className="flex items-center space-x-2">
                  <Progress value={clusterHealth.active_shards_percent_as_number} className="flex-1" />
                  <span className="text-sm font-medium">{clusterHealth.active_shards_percent_as_number}%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Health Issues */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Health Issues ({healthIssues.length})</CardTitle>
              <CardDescription>
                Automatically detected cluster health and performance issues
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Analyzing cluster health...</span>
                </div>
              ) : healthIssues.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  <p className="text-lg font-medium text-green-600">All Systems Healthy</p>
                  <p className="text-sm text-muted-foreground">
                    No critical issues or warnings detected
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {healthIssues.map((issue, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          {getSeverityIcon(issue.severity)}
                          <h3 className="font-medium">{issue.title}</h3>
                          <Badge className={getSeverityColor(issue.severity)}>
                            {issue.severity.toUpperCase()}
                          </Badge>
                          <Badge variant="outline">{issue.category}</Badge>
                        </div>
                        {issue.value && (
                          <span className="text-sm font-medium">{issue.value}</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{issue.description}</p>
                      <div className="bg-muted rounded p-2">
                        <p className="text-sm"><strong>Recommendation:</strong> {issue.recommendation}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Node Resources */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Node Resources</CardTitle>
              <CardDescription>
                Current resource usage across cluster nodes
              </CardDescription>
            </CardHeader>
            <CardContent>
              {nodeStats ? (
                <div className="space-y-4">
                  {Object.values(nodeStats.nodes).map((node, index) => {
                    const diskUsedPercent = ((node.fs.total.total_in_bytes - node.fs.total.available_in_bytes) / node.fs.total.total_in_bytes) * 100;
                    
                    return (
                      <div key={index} className="border rounded-lg p-3">
                        <h4 className="font-medium mb-2">{node.name}</h4>
                        <div className="space-y-2">
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>JVM Heap</span>
                              <span>{node.jvm.mem.heap_used_percent}%</span>
                            </div>
                            <Progress value={node.jvm.mem.heap_used_percent} />
                          </div>
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>CPU</span>
                              <span>{node.os.cpu.percent}%</span>
                            </div>
                            <Progress value={node.os.cpu.percent} />
                          </div>
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Disk</span>
                              <span>{diskUsedPercent.toFixed(1)}%</span>
                            </div>
                            <Progress value={diskUsedPercent} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {node.indices.docs.count.toLocaleString()} docs • {formatBytes(node.indices.store.size_in_bytes)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Server className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {isConnected ? "Loading node statistics..." : "Connect to view node resources"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Detailed Statistics */}
      {clusterHealth && (
        <Card>
          <CardHeader>
            <CardTitle>Cluster Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="shards">
              <TabsList>
                <TabsTrigger value="shards">Shards</TabsTrigger>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
              </TabsList>

              <TabsContent value="shards" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Active Shards</div>
                    <div className="text-2xl font-bold text-green-600">{clusterHealth.active_shards}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Relocating</div>
                    <div className="text-2xl font-bold text-yellow-600">{clusterHealth.relocating_shards}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Initializing</div>
                    <div className="text-2xl font-bold text-blue-600">{clusterHealth.initializing_shards}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Unassigned</div>
                    <div className="text-2xl font-bold text-red-600">{clusterHealth.unassigned_shards}</div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="tasks" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Pending Tasks</div>
                    <div className="text-2xl font-bold">{clusterHealth.number_of_pending_tasks}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">In-Flight Fetches</div>
                    <div className="text-2xl font-bold">{clusterHealth.number_of_in_flight_fetch}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Max Wait Time</div>
                    <div className="text-2xl font-bold">{clusterHealth.task_max_waiting_in_queue_millis}ms</div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="performance" className="space-y-4">
                {nodeStats && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {Object.values(nodeStats.nodes).map((node, index) => (
                      <div key={index} className="border rounded-lg p-4">
                        <h4 className="font-medium mb-2">{node.name}</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <div className="text-muted-foreground">Indexing Rate</div>
                            <div className="font-medium">
                              {(node.indices.indexing.index_total / (node.indices.indexing.index_time_in_millis / 1000 || 1)).toFixed(1)} ops/s
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Search Rate</div>
                            <div className="font-medium">
                              {(node.indices.search.query_total / (node.indices.search.query_time_in_millis / 1000 || 1)).toFixed(1)} ops/s
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Total Docs</div>
                            <div className="font-medium">{node.indices.docs.count.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Store Size</div>
                            <div className="font-medium">{formatBytes(node.indices.store.size_in_bytes)}</div>
                          </div>
                        </div>
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
