"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { 
  Layers, 
  Server, 
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle,
  XCircle,
  ArrowRight,
  Database,
  HardDrive,
  Activity,
  Zap,
  Settings,
  Filter,
  Loader2,
  Clock,
  BarChart3,
  FileText
} from "lucide-react";

interface Shard {
  index: string;
  shard: string;
  prirep: "p" | "r"; // primary or replica
  state: "STARTED" | "INITIALIZING" | "RELOCATING" | "UNASSIGNED";
  docs: string;
  store: string;
  ip: string;
  node: string;
}

interface ShardAllocation {
  current_state: string;
  index: string;
  shard: number;
  primary: boolean;
  current_node: string;
  relocating_node?: string;
  unassigned_info?: {
    reason: string;
    at: string;
    details?: string;
  };
}

interface ClusterReroute {
  index?: string;
  shard?: number;
  primary?: boolean;
  current_state?: string;
  unassigned_info?: {
    reason: string;
    at: string;
    details?: string;
    last_allocation_status?: string;
  };
  can_allocate?: string;
  allocate_explanation?: string;
  node_allocation_decisions?: Array<{
    node_id: string;
    node_name: string;
    transport_address: string;
    node_decision: string;
    weight_ranking: number;
    deciders: Array<{
      decider: string;
      decision: string;
      explanation: string;
    }>;
  }>;
  explanations?: Array<{
    index: string;
    shard: number;
    primary: boolean;
    current_state: string;
    unassigned_info?: any;
    can_allocate: string;
    allocate_explanation: string;
    node_allocation_decisions: Array<{
      node_id: string;
      node_name: string;
      transport_address: string;
      node_decision: string;
      weight_ranking: number;
      deciders: Array<{
        decider: string;
        decision: string;
        explanation: string;
      }>;
    }>;
  }>;
}

export default function ShardsPage() {
  const { isConnected } = useConnection();
  const [shards, setShards] = useState<Shard[]>([]);
  const [shardAllocation, setShardAllocation] = useState<ShardAllocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [shardFilter, setShardFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [selectedShard, setSelectedShard] = useState<Shard | null>(null);
  const [allocationExplanation, setAllocationExplanation] = useState<ClusterReroute | null>(null);
  const [indexPage, setIndexPage] = useState(1);
  const INDICES_PER_PAGE = 20;

  // Load shard data
  const loadShards = async () => {
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
      // Load shard information
      const shardsResponse = await client.request('/_cat/shards?h=index,shard,prirep,state,docs,store,ip,node&format=json');
      setShards(shardsResponse || []);
      
      // Load cluster allocation explanation for unassigned shards
      try {
        const allocationResponse = await client.request('/_cluster/allocation/explain', {
          method: 'GET'
        });
        setAllocationExplanation(allocationResponse);
      } catch (allocError) {
        console.warn('Could not get allocation explanation:', allocError);
      }
      
    } catch (err: any) {
      setError(`Failed to load shard information: ${err.message}`);
      console.error('Error loading shards:', err);
    } finally {
      setLoading(false);
    }
  };

  // Reroute cluster
  const handleRerouteCluster = async () => {
    if (!isConnected) return;

    const client = getElasticsearchClient();
    if (!client) return;

    try {
      await client.request('/_cluster/reroute?retry_failed=true', {
        method: 'POST'
      });
      
      await loadShards();
      setError(null);
    } catch (error: any) {
      setError(`Failed to reroute cluster: ${error.message}`);
    }
  };

  // Explain allocation for a specific shard
  const explainAllocation = async (shard: Shard) => {
    if (!isConnected) return;

    const client = getElasticsearchClient();
    if (!client) return;

    try {
      const explanation = await client.request('/_cluster/allocation/explain', {
        method: 'POST',
        body: JSON.stringify({
          index: shard.index,
          shard: parseInt(shard.shard),
          primary: shard.prirep === 'p'
        })
      });
      setAllocationExplanation(explanation);
      setSelectedShard(shard);
    } catch (error: any) {
      setError(`Failed to explain allocation: ${error.message}`);
    }
  };

  // Load data on mount
  useEffect(() => {
    if (isConnected) {
      loadShards();
    } else {
      setShards([]);
      setShardAllocation([]);
      setSelectedShard(null);
      setAllocationExplanation(null);
    }
  }, [isConnected]);

  // Reset page when filters change
  useEffect(() => { setIndexPage(1); }, [searchQuery, shardFilter, stateFilter]);

  const getStateColor = (state: string) => {
    switch (state) {
      case "STARTED": return "text-green-600 bg-green-100 dark:bg-green-900 dark:text-green-300";
      case "INITIALIZING": return "text-blue-600 bg-blue-100 dark:bg-blue-900 dark:text-blue-300";
      case "RELOCATING": return "text-yellow-600 bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-300";
      case "UNASSIGNED": return "text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-300";
      default: return "text-gray-600 bg-gray-100 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case "STARTED": return <CheckCircle className="h-4 w-4" />;
      case "INITIALIZING": return <Clock className="h-4 w-4" />;
      case "RELOCATING": return <ArrowRight className="h-4 w-4" />;
      case "UNASSIGNED": return <XCircle className="h-4 w-4" />;
      default: return <AlertCircle className="h-4 w-4" />;
    }
  };

  const formatBytes = (bytes: string) => {
    if (!bytes || bytes === "null") return "0B";
    const num = parseFloat(bytes.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return bytes;
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = num;
    
    if (bytes.includes('kb')) unitIndex = 1;
    else if (bytes.includes('mb')) unitIndex = 2;
    else if (bytes.includes('gb')) unitIndex = 3;
    else if (bytes.includes('tb')) unitIndex = 4;
    
    return `${size.toFixed(1)}${units[unitIndex]}`;
  };

  // Filter shards
  const filteredShards = shards.filter(shard => {
    const matchesSearch = shard.index.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         shard.node.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesShardType = shardFilter === "all" || 
                            (shardFilter === "primary" && shard.prirep === "p") ||
                            (shardFilter === "replica" && shard.prirep === "r");
    const matchesState = stateFilter === "all" || shard.state.toLowerCase() === stateFilter.toLowerCase();
    
    return matchesSearch && matchesShardType && matchesState;
  });

  // Calculate statistics
  const shardStats = {
    total: shards.length,
    primary: shards.filter(s => s.prirep === 'p').length,
    replica: shards.filter(s => s.prirep === 'r').length,
    started: shards.filter(s => s.state === 'STARTED').length,
    initializing: shards.filter(s => s.state === 'INITIALIZING').length,
    relocating: shards.filter(s => s.state === 'RELOCATING').length,
    unassigned: shards.filter(s => s.state === 'UNASSIGNED').length
  };

  // Group shards by index
  const groupedShards = filteredShards.reduce((acc, shard) => {
    if (!acc[shard.index]) {
      acc[shard.index] = [];
    }
    acc[shard.index].push(shard);
    return acc;
  }, {} as Record<string, Shard[]>);

  // Pagination for grouped shards
  const indexEntries = Object.entries(groupedShards);
  const totalIndexPages = Math.ceil(indexEntries.length / INDICES_PER_PAGE);
  const pagedIndexEntries = indexEntries.slice((indexPage - 1) * INDICES_PER_PAGE, indexPage * INDICES_PER_PAGE);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <Layers className="h-8 w-8 mr-3" />
            Shard Management
          </h1>
          <p className="text-muted-foreground mt-2">
            Monitor and manage shard allocation across cluster nodes
          </p>
        </div>
        <div className="flex space-x-2">
          <Button 
            onClick={handleRerouteCluster} 
            variant="outline"
            disabled={!isConnected}
          >
            <Settings className="h-4 w-4 mr-2" />
            Reroute
          </Button>
          <Button 
            onClick={loadShards} 
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
            Not connected to cluster. Please connect first to view shard information.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Shards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{shardStats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Primary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{shardStats.primary}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Replica</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{shardStats.replica}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Started</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{shardStats.started}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Initializing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{shardStats.initializing}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Relocating</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{shardStats.relocating}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Unassigned</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{shardStats.unassigned}</div>
          </CardContent>
        </Card>
      </div>

      {/* Unassigned Shards Alert */}
      {shardStats.unassigned > 0 && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {shardStats.unassigned} shard(s) are unassigned. This may indicate cluster health issues.
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search indices or nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={shardFilter} onValueChange={setShardFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Shard Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Shards</SelectItem>
            <SelectItem value="primary">Primary</SelectItem>
            <SelectItem value="replica">Replica</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="started">Started</SelectItem>
            <SelectItem value="initializing">Initializing</SelectItem>
            <SelectItem value="relocating">Relocating</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Shards List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Shards by Index ({indexEntries.length} indices)</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Loading shard information...</span>
                </div>
              ) : indexEntries.length === 0 ? (
                <div className="text-center py-8">
                  <Layers className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {isConnected ? "No shards found" : "Connect to cluster to view shards"}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pagedIndexEntries.map(([indexName, indexShards]) => (
                    <div key={indexName} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <Database className="h-5 w-5" />
                          <h3 className="font-semibold">{indexName}</h3>
                          <Badge variant="outline">{indexShards.length} shards</Badge>
                        </div>
                      </div>
                      
                      <div className="grid gap-2">
                        {indexShards.map((shard, index) => (
                          <div 
                            key={`${shard.index}-${shard.shard}-${shard.prirep}-${index}`} 
                            className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 cursor-pointer transition-colors"
                            onClick={() => explainAllocation(shard)}
                          >
                            <div className="flex items-center space-x-4">
                              <div className="flex items-center space-x-2">
                                {getStateIcon(shard.state)}
                                <span className="font-medium">Shard {shard.shard}</span>
                                <Badge className={shard.prirep === 'p' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'}>
                                  {shard.prirep === 'p' ? 'Primary' : 'Replica'}
                                </Badge>
                                <Badge className={getStateColor(shard.state)}>
                                  {shard.state}
                                </Badge>
                              </div>
                            </div>
                            
                            <div className="flex items-center space-x-4 text-sm">
                              <div>
                                <Label className="text-xs text-muted-foreground">Node</Label>
                                <p className="font-medium">{shard.node || 'Unassigned'}</p>
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Docs</Label>
                                <p className="font-medium">{shard.docs || '0'}</p>
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Size</Label>
                                <p className="font-medium">{formatBytes(shard.store)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {totalIndexPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <span className="text-sm text-muted-foreground">
                    Page {indexPage} of {totalIndexPages} ({indexEntries.length} indices)
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={indexPage === 1} onClick={() => setIndexPage(p => p - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={indexPage === totalIndexPages} onClick={() => setIndexPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Allocation Explanation */}
        <div className="lg:col-span-1">
          {selectedShard && allocationExplanation ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <FileText className="h-5 w-5 mr-2" />
                  Allocation Details
                </CardTitle>
                <CardDescription>
                  {selectedShard.index} shard {selectedShard.shard} ({selectedShard.prirep === 'p' ? 'Primary' : 'Replica'})
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="overview">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="decisions">Decisions</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4">
                    <div>
                      <Label>Current State</Label>
                      <div className="flex items-center mt-1">
                        {getStateIcon(selectedShard.state)}
                        <span className="ml-2">{selectedShard.state}</span>
                      </div>
                    </div>
                    
                    <div>
                      <Label>Current Node</Label>
                      <p className="text-sm font-medium mt-1">{selectedShard.node || 'Not assigned'}</p>
                    </div>

                    <div>
                      <Label>IP Address</Label>
                      <p className="text-sm font-medium mt-1">{selectedShard.ip || 'N/A'}</p>
                    </div>

                    <div>
                      <Label>Document Count</Label>
                      <p className="text-sm font-medium mt-1">{selectedShard.docs || '0'}</p>
                    </div>

                    <div>
                      <Label>Storage Size</Label>
                      <p className="text-sm font-medium mt-1">{formatBytes(selectedShard.store)}</p>
                    </div>

                    {allocationExplanation.unassigned_info && (
                      <div>
                        <Label>Unassigned Reason</Label>
                        <p className="text-sm font-medium mt-1">{allocationExplanation.unassigned_info.reason}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(allocationExplanation.unassigned_info.at).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="decisions" className="space-y-4">
                    {allocationExplanation.node_allocation_decisions ? (
                      <div className="space-y-3">
                        {allocationExplanation.node_allocation_decisions.map((decision: any, index: number) => (
                          <div key={`${decision.node_name}-${index}`} className="border rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-medium">{decision.node_name}</h4>
                              <Badge className={
                                decision.node_decision === 'YES' 
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                              }>
                                {decision.node_decision}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">
                              {decision.transport_address} • Weight: {decision.weight_ranking}
                            </p>
                            {decision.deciders && decision.deciders.length > 0 && (
                              <div className="space-y-1">
                                {decision.deciders.slice(0, 3).map((decider: any, dIndex: number) => (
                                  <div key={`${decider.decider}-${dIndex}`} className="text-xs">
                                    <span className="font-medium">{decider.decider}:</span>
                                    <span className="ml-2">{decider.decision}</span>
                                  </div>
                                ))}
                                {decision.deciders.length > 3 && (
                                  <p className="text-xs text-muted-foreground">
                                    +{decision.deciders.length - 3} more decisions...
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No allocation decisions available.</p>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-64">
                <div className="text-center">
                  <Layers className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium">No Shard Selected</p>
                  <p className="text-muted-foreground">
                    Click on a shard to view allocation details
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
