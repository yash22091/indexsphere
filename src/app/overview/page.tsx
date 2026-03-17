"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { useRouter } from "next/navigation";
import { 
  RefreshCw, 
  Activity, 
  CheckCircle, 
  Server, 
  Database, 
  FileText,
  Zap,
  Plus,
  Search,
  Settings,
  Download,
  BarChart3,
  TrendingUp,
  Clock,
  AlertTriangle,
  Loader2,
  AlertCircle
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
  const loadClusterData = async () => {
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
  };

  // Load data on mount and when connection changes
  useEffect(() => {
    if (isConnected) {
      loadClusterData();
    } else {
      setClusterHealth(null);
      setClusterStats(null);
    }
  }, [isConnected]);

  // Auto-refresh functionality
  useEffect(() => {
    if (autoRefresh && isConnected) {
      const interval = setInterval(loadClusterData, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh, isConnected]);

  const getHealthIcon = (status: string) => {
    switch (status) {
      case "green":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "yellow":
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case "red":
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-600" />;
    }
  };

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center">
            <Activity className="h-6 w-6 sm:h-8 sm:w-8 mr-2 sm:mr-3" />
            Cluster Overview
          </h1>
          <p className="text-muted-foreground mt-1 sm:mt-2 text-sm sm:text-base">
            {clusterHealth ? `Monitor your ${clusterHealth.cluster_name} cluster health and performance` : "Monitor your cluster health and performance"}
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Activity className="h-4 w-4 mr-2" />
            Auto Refresh
          </Button>
          <Button 
            onClick={loadClusterData} 
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
          <Button 
            onClick={() => router.push('/reports')} 
            variant="outline"
            disabled={!isConnected}
            className="hidden sm:flex"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Connection Status & Error Messages */}
      {!isConnected && (
        <Alert className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          <Database className="h-4 w-4" />
          <AlertDescription>
            Not connected to cluster. Please connect first to view cluster overview.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Cluster Health Status */}
      {clusterHealth && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              {getHealthIcon(clusterHealth.status)}
              <span>Cluster Health</span>
              <Badge 
                variant={clusterHealth.status === "green" ? "default" : clusterHealth.status === "yellow" ? "secondary" : "destructive"}
              >
                {clusterHealth.status.toUpperCase()}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Active Shards</p>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">{formatNumber(clusterHealth.active_shards)}</span>
                    <Badge variant="outline">{clusterHealth.active_shards_percent_as_number}%</Badge>
                  </div>
                  <Progress value={clusterHealth.active_shards_percent_as_number} className="h-2" />
                </div>
              </div>
              
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Primary Shards</p>
                <p className="text-2xl font-bold">{formatNumber(clusterHealth.active_primary_shards)}</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Nodes</p>
                <p className="text-2xl font-bold">
                  {formatNumber(clusterHealth.number_of_nodes)}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    ({clusterHealth.number_of_data_nodes} data)
                  </span>
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Unassigned Shards</p>
                <p className={`text-2xl font-bold ${clusterHealth.unassigned_shards > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatNumber(clusterHealth.unassigned_shards)}
                </p>
              </div>
            </div>

            {/* Additional Status Information */}
            {(clusterHealth.relocating_shards > 0 || clusterHealth.initializing_shards > 0 || clusterHealth.number_of_pending_tasks > 0) && (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-medium mb-2">Active Operations</h4>
                <div className="grid gap-2 md:grid-cols-3">
                  {clusterHealth.relocating_shards > 0 && (
                    <div className="flex items-center space-x-2">
                      <TrendingUp className="h-4 w-4 text-blue-500" />
                      <span className="text-sm">Relocating: {clusterHealth.relocating_shards}</span>
                    </div>
                  )}
                  {clusterHealth.initializing_shards > 0 && (
                    <div className="flex items-center space-x-2">
                      <Clock className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm">Initializing: {clusterHealth.initializing_shards}</span>
                    </div>
                  )}
                  {clusterHealth.number_of_pending_tasks > 0 && (
                    <div className="flex items-center space-x-2">
                      <Activity className="h-4 w-4 text-purple-500" />
                      <span className="text-sm">Pending Tasks: {clusterHealth.number_of_pending_tasks}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cluster Analysis Quick View */}
      {clusterHealth && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center">
                <BarChart3 className="h-5 w-5 mr-2" />
                Cluster Analysis
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => router.push('/cluster-analysis')}
              >
                View Details
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Health Score</p>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">
                      {clusterHealth.status === 'green' ? '95' : 
                       clusterHealth.status === 'yellow' ? '75' : '45'}%
                    </span>
                    <Badge variant={
                      clusterHealth.status === 'green' ? 'default' : 
                      clusterHealth.status === 'yellow' ? 'secondary' : 'destructive'
                    }>
                      {clusterHealth.status.toUpperCase()}
                    </Badge>
                  </div>
                  <Progress 
                    value={clusterHealth.status === 'green' ? 95 : 
                           clusterHealth.status === 'yellow' ? 75 : 45} 
                    className="h-2" 
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Configuration</p>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">
                      {clusterHealth.number_of_nodes >= 3 ? '85' : '60'}%
                    </span>
                    <Badge variant={clusterHealth.number_of_nodes >= 3 ? 'default' : 'secondary'}>
                      {clusterHealth.number_of_nodes >= 3 ? 'GOOD' : 'WARNING'}
                    </Badge>
                  </div>
                  <Progress 
                    value={clusterHealth.number_of_nodes >= 3 ? 85 : 60} 
                    className="h-2" 
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Best Practices</p>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">
                      {clusterHealth.unassigned_shards === 0 ? '90' : '65'}%
                    </span>
                    <Badge variant={clusterHealth.unassigned_shards === 0 ? 'default' : 'secondary'}>
                      {clusterHealth.unassigned_shards === 0 ? 'COMPLIANT' : 'REVIEW'}
                    </Badge>
                  </div>
                  <Progress 
                    value={clusterHealth.unassigned_shards === 0 ? 90 : 65} 
                    className="h-2" 
                  />
                </div>
              </div>
            </div>
            
            {(clusterHealth.status !== 'green' || clusterHealth.unassigned_shards > 0 || clusterHealth.number_of_nodes < 3) && (
              <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="flex items-center text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  <span className="text-sm font-medium">
                    {clusterHealth.status !== 'green' && 'Cluster health needs attention. '}
                    {clusterHealth.unassigned_shards > 0 && 'Unassigned shards detected. '}
                    {clusterHealth.number_of_nodes < 3 && 'Consider adding more nodes for high availability.'}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cluster Statistics */}
      {clusterStats && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Indices Statistics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Database className="h-5 w-5 mr-2" />
                Indices Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Indices</p>
                  <p className="text-2xl font-bold">{formatNumber(clusterStats.indices.count)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Shards</p>
                  <p className="text-2xl font-bold">{formatNumber(clusterStats.indices.shards.total)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Primary Shards</p>
                  <p className="text-2xl font-bold">{formatNumber(clusterStats.indices.shards.primaries)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Replica Shards</p>
                  <p className="text-2xl font-bold">{formatNumber(clusterStats.indices.shards.total - clusterStats.indices.shards.primaries)}</p>
                </div>
              </div>
              
              <div className="pt-4 border-t">
                <div className="grid gap-4 grid-cols-2">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Documents</p>
                    <p className="text-xl font-bold">{formatNumber(clusterStats.indices.docs.count)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Storage Size</p>
                    <p className="text-xl font-bold">{formatBytes(clusterStats.indices.store.size_in_bytes)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Nodes Statistics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Server className="h-5 w-5 mr-2" />
                Nodes Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Nodes</p>
                  <p className="text-2xl font-bold">{formatNumber(clusterStats.nodes.count.total)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Data Nodes</p>
                  <p className="text-2xl font-bold">{formatNumber(clusterStats.nodes.count.data)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Master Nodes</p>
                  <p className="text-2xl font-bold">{formatNumber(clusterStats.nodes.count.master)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Ingest Nodes</p>
                  <p className="text-2xl font-bold">{formatNumber(clusterStats.nodes.count.ingest)}</p>
                </div>
              </div>

              <div className="pt-4 border-t">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Coordinating Only</p>
                  <p className="text-xl font-bold">{formatNumber(clusterStats.nodes.count.coordinating_only)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Loading State */}
      {loading && !clusterHealth && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-lg font-medium">Loading cluster data...</p>
              <p className="text-muted-foreground">Fetching health and statistics</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Data State */}
      {!loading && !clusterHealth && isConnected && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium">No Cluster Data</p>
              <p className="text-muted-foreground mb-4">
                Unable to fetch cluster information
              </p>
              <Button onClick={loadClusterData} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
