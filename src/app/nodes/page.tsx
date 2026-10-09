"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { EmptyState, PageHeader, StatusDot } from "@/components/app";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  Activity,
  AlertCircle,
  Cpu,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Server,
} from "lucide-react";

interface NodeInfo {
  name: string;
  transport_address: string;
  host: string;
  ip: string;
  version: string;
  build_flavor: string;
  build_type: string;
  build_hash: string;
  roles: string[];
  attributes: any;
  settings: any;
}

interface NodeStats {
  name: string;
  transport_address: string;
  host: string;
  roles: string[];
  indices: {
    docs: { count: number; deleted: number };
    store: { size_in_bytes: number };
    indexing: { index_total: number; index_time_in_millis: number };
    search: { query_total: number; query_time_in_millis: number };
  };
  os: {
    cpu: { percent: number; load_average?: any };
    mem: { total_in_bytes: number; free_in_bytes: number; used_in_bytes: number };
    swap: { total_in_bytes: number; free_in_bytes: number; used_in_bytes: number };
  };
  process: {
    cpu: { percent: number; total_time_in_millis: number };
    mem: { total_virtual_in_bytes: number };
  };
  jvm: {
    mem: { heap_used_in_bytes: number; heap_max_in_bytes: number };
    gc: { collectors: any };
  };
  fs: {
    total: { total_in_bytes: number; free_in_bytes: number; available_in_bytes: number };
  };
}

export default function NodesPage() {
  const { isConnected } = useConnection();
  const [nodes, setNodes] = useState<Record<string, NodeInfo>>({});
  const [nodeStats, setNodeStats] = useState<Record<string, NodeStats>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Load nodes data
  const loadNodesData = useCallback(async () => {
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
      const [nodesInfo, nodesStats] = await Promise.all([
        client.getNodes(),
        client.getNodeStats()
      ]);
      
      setNodes(nodesInfo.nodes || {});
      setNodeStats(nodesStats.nodes || {});
    } catch (err: any) {
      setError(`Failed to load nodes: ${err.message}`);
      console.error('Error loading nodes:', err);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  // Load data on mount and when connection changes
  useEffect(() => {
    if (isConnected) {
      loadNodesData();
    } else {
      setNodes({});
      setNodeStats({});
      setSelectedNode(null);
    }
  }, [isConnected, loadNodesData]);

  const nodesList = Object.entries(nodes).map(([id, node]) => ({
    id,
    ...node,
    stats: nodeStats[id]
  }));

  const filteredNodes = nodesList.filter(node =>
    node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.roles.some(role => role.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const selectedNodeData = selectedNode ? nodesList.find(n => n.id === selectedNode) : null;

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

  const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
  const usageDot = (value: number) => (value < 80 ? "green" : value < 90 ? "yellow" : "red");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nodes"
        description="Roles, resource usage and activity of every node in the cluster."
        actions={
          <Button size="sm" variant="outline" onClick={loadNodesData} disabled={!isConnected || loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        }
      />

      {!isConnected && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to inspect its nodes."
          action={<Button size="sm" asChild><Link href="/connections">Go to connections</Link></Button>}
        />
      )}

      {error && isConnected && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isConnected && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader className="space-y-3">
              <CardTitle className="text-base">Nodes ({filteredNodes.length})</CardTitle>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter by name, host or role"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading && nodesList.length === 0 ? (
                <div className="space-y-2">
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </div>
              ) : filteredNodes.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No nodes match the filter.</p>
              ) : (
                filteredNodes.map((node) => {
                  const cpu = node.stats?.os.cpu.percent ?? 0;
                  return (
                    <button
                      type="button"
                      key={node.id}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        selectedNode === node.id ? "border-primary bg-muted" : "hover:bg-muted/60"
                      }`}
                      onClick={() => setSelectedNode(node.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{node.name}</span>
                        {node.stats && <StatusDot status={usageDot(cpu)} />}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{node.host} · {node.version}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {node.roles.map((role, index) => (
                          <Badge key={`${role}-${index}`} variant="secondary" className="font-normal">{role}</Badge>
                        ))}
                      </div>
                      {node.stats && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <span className="text-muted-foreground">CPU <span className="font-medium text-foreground tabular-nums">{cpu}%</span></span>
                          <span className="text-muted-foreground">Memory <span className="font-medium text-foreground tabular-nums">
                            {Math.round(pct(node.stats.os.mem.used_in_bytes, node.stats.os.mem.total_in_bytes))}%
                          </span></span>
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            {selectedNodeData ? (
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{selectedNodeData.name}</CardTitle>
                      <CardDescription>{selectedNodeData.host} · {selectedNodeData.version}</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedNodeData.roles.map((role, index) => (
                        <Badge key={`${role}-${index}`} variant="secondary" className="font-normal">{role}</Badge>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="overview">
                    <TabsList>
                      <TabsTrigger value="overview">Resources</TabsTrigger>
                      <TabsTrigger value="performance">Activity</TabsTrigger>
                      <TabsTrigger value="indices">Indices</TabsTrigger>
                      <TabsTrigger value="settings">Node info</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="pt-4">
                      {selectedNodeData.stats && (() => {
                        const st = selectedNodeData.stats;
                        const resources = [
                          { label: "CPU", icon: Cpu, value: st.os.cpu.percent, detail: `Process ${st.process.cpu.percent}%` },
                          { label: "Memory", icon: Activity, value: pct(st.os.mem.used_in_bytes, st.os.mem.total_in_bytes), detail: `${formatBytes(st.os.mem.used_in_bytes)} of ${formatBytes(st.os.mem.total_in_bytes)}` },
                          { label: "Disk", icon: HardDrive, value: pct(st.fs.total.total_in_bytes - st.fs.total.free_in_bytes, st.fs.total.total_in_bytes), detail: `${formatBytes(st.fs.total.total_in_bytes - st.fs.total.free_in_bytes)} of ${formatBytes(st.fs.total.total_in_bytes)}` },
                          { label: "JVM heap", icon: Server, value: pct(st.jvm.mem.heap_used_in_bytes, st.jvm.mem.heap_max_in_bytes), detail: `${formatBytes(st.jvm.mem.heap_used_in_bytes)} of ${formatBytes(st.jvm.mem.heap_max_in_bytes)}` },
                        ];
                        return (
                          <div className="grid gap-4 sm:grid-cols-2">
                            {resources.map(r => (
                              <div key={r.label} className="rounded-lg border p-4">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="flex items-center gap-2 font-medium"><r.icon className="h-4 w-4 text-muted-foreground" />{r.label}</span>
                                  <span className={`tabular-nums ${r.value >= 90 ? "text-destructive" : r.value >= 75 ? "text-warning" : ""}`}>{r.value.toFixed(0)}%</span>
                                </div>
                                <Progress value={r.value} className="mt-3 h-1.5" />
                                <p className="mt-2 text-xs text-muted-foreground">{r.detail}</p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </TabsContent>

                    <TabsContent value="performance" className="pt-4">
                      {selectedNodeData.stats && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <KeyValues title="Search" rows={[
                            ["Queries", formatNumber(selectedNodeData.stats.indices.search.query_total)],
                            ["Time spent", `${(selectedNodeData.stats.indices.search.query_time_in_millis / 1000).toFixed(2)} s`],
                          ]} />
                          <KeyValues title="Indexing" rows={[
                            ["Documents indexed", formatNumber(selectedNodeData.stats.indices.indexing.index_total)],
                            ["Time spent", `${(selectedNodeData.stats.indices.indexing.index_time_in_millis / 1000).toFixed(2)} s`],
                          ]} />
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="indices" className="pt-4">
                      {selectedNodeData.stats && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <KeyValues title="Documents" rows={[
                            ["Documents", formatNumber(selectedNodeData.stats.indices.docs.count)],
                            ["Deleted documents", formatNumber(selectedNodeData.stats.indices.docs.deleted)],
                          ]} />
                          <KeyValues title="Storage" rows={[
                            ["Store size", formatBytes(selectedNodeData.stats.indices.store.size_in_bytes)],
                          ]} />
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="settings" className="pt-4">
                      <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                        {JSON.stringify({
                          name: selectedNodeData.name,
                          version: selectedNodeData.version,
                          build_flavor: selectedNodeData.build_flavor,
                          build_type: selectedNodeData.build_type,
                          build_hash: selectedNodeData.build_hash,
                          host: selectedNodeData.host,
                          transport_address: selectedNodeData.transport_address,
                          roles: selectedNodeData.roles,
                          attributes: selectedNodeData.attributes
                        }, null, 2)}
                      </pre>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                icon={Server}
                title="No node selected"
                description="Select a node to see its resources, activity and configuration."
                className="h-full min-h-64"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KeyValues({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border p-4">
      <h4 className="mb-3 text-sm font-medium">{title}</h4>
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
