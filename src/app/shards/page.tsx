"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { EmptyState, PageHeader, SeverityBadge, StatCard, StatGrid } from "@/components/app";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  AlertCircle,
  Database,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
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
  const [, setShardAllocation] = useState<ShardAllocation[]>([]);
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
  const loadShards = useCallback(async () => {
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
  }, [isConnected]);

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
  }, [isConnected, loadShards]);

  // Reset page when filters change
  useEffect(() => { setIndexPage(1); }, [searchQuery, shardFilter, stateFilter]);

  const STATE_LEVEL: Record<string, string> = {
    STARTED: "ok",
    INITIALIZING: "info",
    RELOCATING: "warning",
    UNASSIGNED: "critical",
  };

  const stateLabel = (state: string) => state.charAt(0) + state.slice(1).toLowerCase();

  const formatBytes = (bytes: string) => {
    if (!bytes || bytes === "null") return "0B";
    const num = parseFloat(bytes.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return bytes;
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    const size = num;
    
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
    <div className="space-y-6">
      <PageHeader
        title="Shards"
        description="Shard placement across nodes. Select a shard to see why it is, or is not, allocated."
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRerouteCluster}
              disabled={!isConnected}
              title="POST _cluster/reroute?retry_failed=true"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry failed allocations
            </Button>
            <Button size="sm" variant="outline" onClick={loadShards} disabled={!isConnected || loading}>
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
          description="Connect to an Elasticsearch or OpenSearch cluster to inspect shard allocation."
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
        <>
          <StatGrid className="lg:grid-cols-4 xl:grid-cols-7">
            <StatCard label="Total" value={shardStats.total} />
            <StatCard label="Primary" value={shardStats.primary} />
            <StatCard label="Replica" value={shardStats.replica} />
            <StatCard label="Started" value={shardStats.started} />
            <StatCard label="Initializing" value={shardStats.initializing} tone={shardStats.initializing ? "info" : "default"} />
            <StatCard label="Relocating" value={shardStats.relocating} tone={shardStats.relocating ? "warning" : "default"} />
            <StatCard label="Unassigned" value={shardStats.unassigned} tone={shardStats.unassigned ? "danger" : "default"} />
          </StatGrid>

          {shardStats.unassigned > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {shardStats.unassigned} shard{shardStats.unassigned === 1 ? " is" : "s are"} unassigned. Select one to see the allocation explanation.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by index or node"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={shardFilter} onValueChange={setShardFilter}>
              <SelectTrigger className="sm:w-[160px]">
                <SelectValue placeholder="Shard type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All shard types</SelectItem>
                <SelectItem value="primary">Primary</SelectItem>
                <SelectItem value="replica">Replica</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="sm:w-[160px]">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                <SelectItem value="started">Started</SelectItem>
                <SelectItem value="initializing">Initializing</SelectItem>
                <SelectItem value="relocating">Relocating</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Shards by index ({indexEntries.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {loading && shards.length === 0 ? (
                  <div className="space-y-3">
                    <Skeleton className="h-32" />
                    <Skeleton className="h-32" />
                  </div>
                ) : indexEntries.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {shards.length ? "No shards match the filters." : "No shards found."}
                  </p>
                ) : (
                  <div className="space-y-4">
                    {pagedIndexEntries.map(([indexName, indexShards]) => (
                      <div key={indexName} className="overflow-hidden rounded-lg border">
                        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                          <h3 className="truncate text-sm font-medium" title={indexName}>{indexName}</h3>
                          <span className="shrink-0 text-xs text-muted-foreground">{indexShards.length} shards</span>
                        </div>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-16">Shard</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>State</TableHead>
                                <TableHead>Node</TableHead>
                                <TableHead className="text-right">Docs</TableHead>
                                <TableHead className="text-right">Size</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {indexShards.map((shard, index) => (
                                <TableRow
                                  key={`${shard.index}-${shard.shard}-${shard.prirep}-${index}`}
                                  className="cursor-pointer"
                                  data-state={selectedShard === shard ? "selected" : undefined}
                                  onClick={() => explainAllocation(shard)}
                                >
                                  <TableCell className="font-medium">{shard.shard}</TableCell>
                                  <TableCell className="text-muted-foreground">{shard.prirep === 'p' ? 'Primary' : 'Replica'}</TableCell>
                                  <TableCell>
                                    <SeverityBadge level={STATE_LEVEL[shard.state] ?? "info"}>{stateLabel(shard.state)}</SeverityBadge>
                                  </TableCell>
                                  <TableCell className={shard.node ? "" : "text-muted-foreground"}>{shard.node || 'Unassigned'}</TableCell>
                                  <TableCell className="text-right">{shard.docs || '0'}</TableCell>
                                  <TableCell className="text-right">{formatBytes(shard.store)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {totalIndexPages > 1 && (
                  <div className="mt-4 flex items-center justify-between border-t pt-4">
                    <span className="text-sm text-muted-foreground">
                      Page {indexPage} of {totalIndexPages}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={indexPage === 1} onClick={() => setIndexPage(p => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={indexPage === totalIndexPages} onClick={() => setIndexPage(p => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="min-w-0">
              {selectedShard && allocationExplanation ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Allocation details</CardTitle>
                    <CardDescription className="break-all">
                      {selectedShard.index} · shard {selectedShard.shard} · {selectedShard.prirep === 'p' ? 'primary' : 'replica'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="overview">
                      <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="decisions">Node decisions</TabsTrigger>
                      </TabsList>

                      <TabsContent value="overview" className="pt-4">
                        <dl className="space-y-3 text-sm">
                          <div className="flex justify-between gap-4">
                            <dt className="text-muted-foreground">State</dt>
                            <dd><SeverityBadge level={STATE_LEVEL[selectedShard.state] ?? "info"}>{stateLabel(selectedShard.state)}</SeverityBadge></dd>
                          </div>
                          <Row label="Node" value={selectedShard.node || 'Not assigned'} />
                          <Row label="IP address" value={selectedShard.ip || '—'} />
                          <Row label="Documents" value={selectedShard.docs || '0'} />
                          <Row label="Size" value={formatBytes(selectedShard.store)} />
                        </dl>
                        {allocationExplanation.unassigned_info && (
                          <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
                            <p className="font-medium">Unassigned: {allocationExplanation.unassigned_info.reason}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Since {new Date(allocationExplanation.unassigned_info.at).toLocaleString()}
                            </p>
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="decisions" className="pt-4">
                        {allocationExplanation.node_allocation_decisions ? (
                          <ul className="space-y-3">
                            {allocationExplanation.node_allocation_decisions.map((decision: any, index: number) => (
                              <li key={`${decision.node_name}-${index}`} className="rounded-lg border p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <h4 className="truncate text-sm font-medium">{decision.node_name}</h4>
                                  <SeverityBadge level={decision.node_decision === 'YES' ? 'ok' : 'high'}>{decision.node_decision}</SeverityBadge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {decision.transport_address} · weight rank {decision.weight_ranking}
                                </p>
                                {decision.deciders && decision.deciders.length > 0 && (
                                  <ul className="mt-2 space-y-1 text-xs">
                                    {decision.deciders.slice(0, 3).map((decider: any, dIndex: number) => (
                                      <li key={`${decider.decider}-${dIndex}`}>
                                        <span className="font-medium">{decider.decider}</span>
                                        <span className="ml-2 text-muted-foreground">{decider.decision}</span>
                                      </li>
                                    ))}
                                    {decision.deciders.length > 3 && (
                                      <li className="text-muted-foreground">+{decision.deciders.length - 3} more</li>
                                    )}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">No allocation decisions available.</p>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              ) : (
                <EmptyState
                  icon={Layers}
                  title="No shard selected"
                  description="Select a shard to see its allocation explanation."
                  className="min-h-64"
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums">{value}</dd>
    </div>
  );
}
