"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { 
  Server, 
  Cpu, 
  HardDrive, 
  Activity, 
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Database,
  Loader2,
  BarChart3,
  Zap,
  Settings
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
  const loadNodesData = async () => {
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
  };

  // Load data on mount and when connection changes
  useEffect(() => {
    if (isConnected) {
      loadNodesData();
    } else {
      setNodes({});
      setNodeStats({});
      setSelectedNode(null);
    }
  }, [isConnected]);

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

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'master': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
      case 'data': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case 'ingest': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'coordinating_only': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <Server className="h-8 w-8 mr-3" />
            Cluster Nodes
          </h1>
          <p className="text-muted-foreground mt-2">
            Monitor and manage cluster nodes performance and configuration
          </p>
        </div>
        <div className="flex space-x-2">
          <Button 
            onClick={loadNodesData} 
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
            Not connected to cluster. Please connect first to view nodes.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Nodes List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Nodes ({filteredNodes.length})</CardTitle>
              <Input
                placeholder="Search nodes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Loading nodes...</span>
                </div>
              ) : filteredNodes.length === 0 ? (
                <div className="text-center py-8">
                  <Server className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {isConnected ? "No nodes found" : "Connect to cluster to view nodes"}
                  </p>
                </div>
              ) : (
                filteredNodes.map((node) => (
                  <div
                    key={node.id}
                    className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedNode === node.id
                        ? "bg-primary/10 border-primary"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => setSelectedNode(node.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium truncate">{node.name}</h3>
                      <div className="flex items-center space-x-1">
                        {node.stats && (
                          <div className={`w-2 h-2 rounded-full ${
                            node.stats.os.cpu.percent < 80 ? 'bg-green-500' : 
                            node.stats.os.cpu.percent < 90 ? 'bg-yellow-500' : 'bg-red-500'
                          }`} />
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {node.host} • {node.version}
                      </p>
                      
                      <div className="flex flex-wrap gap-1">
                        {node.roles.map((role, index) => (
                          <Badge key={`${role}-${index}`} variant="secondary" className={`text-xs ${getRoleColor(role)}`}>
                            {role}
                          </Badge>
                        ))}
                      </div>

                      {node.stats && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">CPU: </span>
                            <span className="font-medium">{node.stats.os.cpu.percent}%</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Memory: </span>
                            <span className="font-medium">
                              {Math.round((node.stats.os.mem.used_in_bytes / node.stats.os.mem.total_in_bytes) * 100)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Node Details */}
        <div className="lg:col-span-2">
          {selectedNodeData ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center">
                      <Server className="h-5 w-5 mr-2" />
                      {selectedNodeData.name}
                    </CardTitle>
                    <CardDescription>
                      {selectedNodeData.host} • {selectedNodeData.version}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedNodeData.roles.map((role, index) => (
                      <Badge key={`${role}-${index}`} className={getRoleColor(role)}>
                        {role}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="overview">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="performance">Performance</TabsTrigger>
                    <TabsTrigger value="indices">Indices</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4">
                    {selectedNodeData.stats && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Card>
                          <CardContent className="p-4">
                            <div className="flex items-center space-x-2 mb-2">
                              <Cpu className="h-4 w-4 text-blue-500" />
                              <span className="font-medium">CPU Usage</span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="text-sm">System</span>
                                <span className="text-sm font-medium">{selectedNodeData.stats.os.cpu.percent}%</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm">Process</span>
                                <span className="text-sm font-medium">{selectedNodeData.stats.process.cpu.percent}%</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardContent className="p-4">
                            <div className="flex items-center space-x-2 mb-2">
                              <Activity className="h-4 w-4 text-green-500" />
                              <span className="font-medium">Memory Usage</span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="text-sm">Used</span>
                                <span className="text-sm font-medium">
                                  {formatBytes(selectedNodeData.stats.os.mem.used_in_bytes)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm">Total</span>
                                <span className="text-sm font-medium">
                                  {formatBytes(selectedNodeData.stats.os.mem.total_in_bytes)}
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardContent className="p-4">
                            <div className="flex items-center space-x-2 mb-2">
                              <HardDrive className="h-4 w-4 text-purple-500" />
                              <span className="font-medium">Disk Usage</span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="text-sm">Used</span>
                                <span className="text-sm font-medium">
                                  {formatBytes(selectedNodeData.stats.fs.total.total_in_bytes - selectedNodeData.stats.fs.total.free_in_bytes)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm">Total</span>
                                <span className="text-sm font-medium">
                                  {formatBytes(selectedNodeData.stats.fs.total.total_in_bytes)}
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardContent className="p-4">
                            <div className="flex items-center space-x-2 mb-2">
                              <Zap className="h-4 w-4 text-yellow-500" />
                              <span className="font-medium">JVM Heap</span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between">
                                <span className="text-sm">Used</span>
                                <span className="text-sm font-medium">
                                  {formatBytes(selectedNodeData.stats.jvm.mem.heap_used_in_bytes)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm">Max</span>
                                <span className="text-sm font-medium">
                                  {formatBytes(selectedNodeData.stats.jvm.mem.heap_max_in_bytes)}
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="performance" className="space-y-4">
                    {selectedNodeData.stats && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Card>
                          <CardContent className="p-4">
                            <h4 className="font-medium mb-3">Search Performance</h4>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-sm">Total Queries</span>
                                <span className="text-sm font-medium">
                                  {formatNumber(selectedNodeData.stats.indices.search.query_total)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm">Query Time</span>
                                <span className="text-sm font-medium">
                                  {(selectedNodeData.stats.indices.search.query_time_in_millis / 1000).toFixed(2)}s
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardContent className="p-4">
                            <h4 className="font-medium mb-3">Indexing Performance</h4>
                            <div className="space-y-2">
                              <div className="flex justify-between">
                                <span className="text-sm">Total Indexed</span>
                                <span className="text-sm font-medium">
                                  {formatNumber(selectedNodeData.stats.indices.indexing.index_total)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-sm">Index Time</span>
                                <span className="text-sm font-medium">
                                  {(selectedNodeData.stats.indices.indexing.index_time_in_millis / 1000).toFixed(2)}s
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="indices" className="space-y-4">
                    {selectedNodeData.stats && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <h4 className="font-medium mb-2">Document Statistics</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span>Total Documents</span>
                              <span className="font-medium">
                                {formatNumber(selectedNodeData.stats.indices.docs.count)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Deleted Documents</span>
                              <span className="font-medium">
                                {formatNumber(selectedNodeData.stats.indices.docs.deleted)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <h4 className="font-medium mb-2">Storage</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span>Index Size</span>
                              <span className="font-medium">
                                {formatBytes(selectedNodeData.stats.indices.store.size_in_bytes)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="settings" className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Node Information</h4>
                      <Textarea
                        value={JSON.stringify({
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
                        rows={12}
                        readOnly
                        className="font-mono text-sm"
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-64">
                <div className="text-center">
                  <Server className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium">No Node Selected</p>
                  <p className="text-muted-foreground">
                    Select a node from the list to view its details
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
