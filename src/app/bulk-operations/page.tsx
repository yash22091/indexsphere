"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { useConnection } from "@/contexts/connection-context";
import { EmptyState, HealthBadge, PageHeader, SeverityBadge } from "@/components/app";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { Activity, AlertCircle, Archive, Database, Loader2, Lock, RefreshCw, Search, Trash2, Unlock } from "lucide-react";

interface IndexInfo {
  index: string;
  health: string;
  status: string;
  uuid: string;
  pri: string;
  rep: string;
  "docs.count": string;
  "docs.deleted": string;
  "store.size": string;
  "pri.store.size": string;
}

interface BulkOperation {
  id: string;
  type: 'delete' | 'close' | 'open' | 'forcemerge' | 'refresh' | 'flush';
  indices: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  timestamp: Date;
}

export default function BulkOperationsPage() {
  const { isConnected } = useConnection();
  const [indices, setIndices] = useState<IndexInfo[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<string>("");
  const [operations, setOperations] = useState<BulkOperation[]>([]);
  const [forcemergeSegments, setForcemergeSegments] = useState<number>(1);
  const [deleteText, setDeleteText] = useState("");

  const loadIndices = useCallback(async () => {
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
      const response = await client.catIndices();
      setIndices(response || []);
    } catch (err: any) {
      setError(`Failed to load indices: ${err.message}`);
      console.error('Error loading indices:', err);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  // Load indices data
  useEffect(() => {
    if (isConnected) {
      loadIndices();
    }
  }, [isConnected, loadIndices]);

  // Filter indices based on search and filters
  const filteredIndices = indices.filter(index => {
    const matchesSearch = index.index.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesHealth = healthFilter === "all" || index.health === healthFilter;
    const matchesStatus = statusFilter === "all" || index.status === statusFilter;
    return matchesSearch && matchesHealth && matchesStatus;
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIndices(filteredIndices.map(index => index.index));
    } else {
      setSelectedIndices([]);
    }
  };

  const handleSelectIndex = (indexName: string, checked: boolean) => {
    if (checked) {
      setSelectedIndices([...selectedIndices, indexName]);
    } else {
      setSelectedIndices(selectedIndices.filter(name => name !== indexName));
    }
  };

  const executeBulkOperation = async (operation: string) => {
    if (selectedIndices.length === 0) {
      setError("Please select at least one index");
      return;
    }

    const client = getElasticsearchClient();
    if (!client) {
      setError("No client available");
      return;
    }

    setLoading(true);
    setError(null);
    setShowConfirmDialog(false);

    const operationId = `bulk-${Date.now()}`;
    
    const bulkOp: BulkOperation = {
      id: operationId,
      type: operation as any,
      indices: [...selectedIndices],
      status: 'running',
      timestamp: new Date()
    };

    setOperations([bulkOp, ...operations]);

    try {
      const results: string[] = [];
      
      for (const indexName of selectedIndices) {
        try {
          switch (operation) {
            case 'delete':
              await client.request(`/${indexName}`, { method: 'DELETE' });
              results.push(`${indexName}: Deleted successfully`);
              break;
              
            case 'close':
              await client.request(`/${indexName}/_close`, { method: 'POST' });
              results.push(`${indexName}: Closed successfully`);
              break;
              
            case 'open':
              await client.request(`/${indexName}/_open`, { method: 'POST' });
              results.push(`${indexName}: Opened successfully`);
              break;
              
            case 'forcemerge':
              await client.request(`/${indexName}/_forcemerge`, {
                method: 'POST',
                body: JSON.stringify({ max_num_segments: forcemergeSegments })
              });
              results.push(`${indexName}: Force merged to ${forcemergeSegments} segments`);
              break;
              
            case 'refresh':
              await client.request(`/${indexName}/_refresh`, { method: 'POST' });
              results.push(`${indexName}: Refreshed successfully`);
              break;
              
            case 'flush':
              await client.request(`/${indexName}/_flush`, { method: 'POST' });
              results.push(`${indexName}: Flushed successfully`);
              break;
              
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
        } catch (err: any) {
          results.push(`${indexName}: Failed - ${err.message}`);
        }
      }

      const completedOp: BulkOperation = {
        ...bulkOp,
        status: 'completed',
        result: results.join('\n')
      };

      setOperations(prev => prev.map(op => op.id === operationId ? completedOp : op));
      setSelectedIndices([]);
      await loadIndices(); // Reload indices to reflect changes
      
    } catch (err: any) {
      const failedOp: BulkOperation = {
        ...bulkOp,
        status: 'failed',
        error: err.message
      };
      
      setOperations(prev => prev.map(op => op.id === operationId ? failedOp : op));
      setError(`Bulk operation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const confirmOperation = (operation: string) => {
    setPendingOperation(operation);
    setShowConfirmDialog(true);
  };

  const formatBytes = (bytes: string) => {
    if (!bytes || bytes === '0b') return '0 B';
    return bytes;
  };

  const formatNumber = (num: string) => {
    if (!num || num === '0') return '0';
    return parseInt(num).toLocaleString();
  };

  const OP_LABELS: Record<string, string> = {
    refresh: "Refresh", flush: "Flush", forcemerge: "Force merge", close: "Close", open: "Open", delete: "Delete",
  };
  const deleteConfirmed = pendingOperation !== "delete" || deleteText.trim().toLowerCase() === "delete";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk operations"
        description="Refresh, flush, force-merge, open, close or delete many indices at once, with confirmation."
        actions={
          <Button onClick={loadIndices} variant="outline" disabled={!isConnected || loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh list
          </Button>
        }
      />

      {!isConnected && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to run bulk operations."
          action={<Button asChild><Link href="/connections">Go to connections</Link></Button>}
        />
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isConnected && (
      <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter indices"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={healthFilter} onValueChange={setHealthFilter}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Health filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any health</SelectItem>
            <SelectItem value="green">Green</SelectItem>
            <SelectItem value="yellow">Yellow</SelectItem>
            <SelectItem value="red">Red</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Status filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="close">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedIndices.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 md:flex-row md:items-center md:justify-between">
          <span className="text-sm font-medium tabular-nums">{selectedIndices.length} selected</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => confirmOperation('refresh')} disabled={loading}>
              <RefreshCw className="mr-1 h-4 w-4" />Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => confirmOperation('flush')} disabled={loading}>
              <Activity className="mr-1 h-4 w-4" />Flush
            </Button>
            <Button size="sm" variant="outline" onClick={() => confirmOperation('forcemerge')} disabled={loading}>
              <Archive className="mr-1 h-4 w-4" />Force merge
            </Button>
            <Button size="sm" variant="outline" onClick={() => confirmOperation('close')} disabled={loading}>
              <Lock className="mr-1 h-4 w-4" />Close
            </Button>
            <Button size="sm" variant="outline" onClick={() => confirmOperation('open')} disabled={loading}>
              <Unlock className="mr-1 h-4 w-4" />Open
            </Button>
            <Button size="sm" variant="destructive" onClick={() => confirmOperation('delete')} disabled={loading}>
              <Trash2 className="mr-1 h-4 w-4" />Delete
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-4">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Indices <span className="font-normal text-muted-foreground tabular-nums">({filteredIndices.length})</span></CardTitle>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={selectedIndices.length === filteredIndices.length && filteredIndices.length > 0}
                onCheckedChange={handleSelectAll}
              />
              Select all
            </label>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading indices…
              </div>
            ) : filteredIndices.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No indices match the filters.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"><span className="sr-only">Select</span></TableHead>
                      <TableHead>Index</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Documents</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="text-right">Shards</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredIndices.map((index) => (
                      <TableRow key={index.index} data-state={selectedIndices.includes(index.index) ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${index.index}`}
                            checked={selectedIndices.includes(index.index)}
                            onCheckedChange={(checked) => handleSelectIndex(index.index, !!checked)}
                          />
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate font-mono text-xs" title={index.index}>{index.index}</TableCell>
                        <TableCell><HealthBadge status={index.health} /></TableCell>
                        <TableCell className="text-muted-foreground">{index.status === "close" ? "Closed" : "Open"}</TableCell>
                        <TableCell className="text-right">{formatNumber(index["docs.count"])}</TableCell>
                        <TableCell className="text-right">{formatBytes(index["store.size"])}</TableCell>
                        <TableCell className="text-right">{index.pri}p / {index.rep}r</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent operations</CardTitle>
          </CardHeader>
          <CardContent>
            {operations.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No operations in this session.</p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto">
                {operations.slice(0, 10).map((operation) => (
                  <div key={operation.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <SeverityBadge level={operation.status === 'completed' ? 'ok' : operation.status === 'failed' ? 'high' : 'info'}>
                        {operation.status === 'running' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        {operation.status}
                      </SeverityBadge>
                      <span className="text-xs text-muted-foreground">{operation.timestamp.toLocaleTimeString()}</span>
                    </div>
                    <div className="text-sm">
                      <div className="font-medium">{OP_LABELS[operation.type] ?? operation.type}</div>
                      <div className="text-muted-foreground tabular-nums">{operation.indices.length} indices</div>
                    </div>
                    {operation.result && (
                      <div className="max-h-20 overflow-y-auto rounded bg-muted p-2 font-mono text-xs">{operation.result}</div>
                    )}
                    {operation.error && (
                      <p className="text-xs text-destructive">{operation.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </>
      )}

      <Dialog open={showConfirmDialog} onOpenChange={(o) => { setShowConfirmDialog(o); if (!o) setDeleteText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{OP_LABELS[pendingOperation] ?? pendingOperation} {selectedIndices.length} {selectedIndices.length === 1 ? "index" : "indices"}?</DialogTitle>
            <DialogDescription>Review the selection before continuing.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="max-h-40 overflow-y-auto rounded-md border p-3">
              <div className="flex flex-wrap gap-1">
                {selectedIndices.map((index) => (
                  <Badge key={index} variant="outline" className="font-mono font-normal">{index}</Badge>
                ))}
              </div>
            </div>

            {pendingOperation === 'forcemerge' && (
              <div className="grid gap-2">
                <Label htmlFor="bo-segments">Max segments per shard</Label>
                <Input
                  id="bo-segments"
                  type="number"
                  value={forcemergeSegments}
                  onChange={(e) => setForcemergeSegments(parseInt(e.target.value) || 1)}
                  min={1}
                  max={100}
                />
              </div>
            )}

            {pendingOperation === 'delete' && (
              <>
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>This permanently deletes the selected indices and all their data. It cannot be undone.</AlertDescription>
                </Alert>
                <div className="grid gap-2">
                  <Label htmlFor="bo-confirm">Type <span className="font-mono">delete</span> to confirm</Label>
                  <Input id="bo-confirm" value={deleteText} onChange={e => setDeleteText(e.target.value)} autoComplete="off" />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
            <Button
              onClick={() => { setDeleteText(""); executeBulkOperation(pendingOperation); }}
              variant={pendingOperation === 'delete' ? 'destructive' : 'default'}
              disabled={loading || !deleteConfirmed}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {OP_LABELS[pendingOperation] ?? pendingOperation}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
