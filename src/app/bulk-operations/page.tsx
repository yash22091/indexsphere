"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { 
  Database, 
  Trash2, 
  Settings, 
  Lock,
  Unlock,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Loader2,
  Archive,
  RotateCcw,
  Zap,
  Copy,
  Eye,
  Search,
  Filter,
  MoreVertical,
  Shield,
  Activity
} from "lucide-react";

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

  // Load indices data
  useEffect(() => {
    if (isConnected) {
      loadIndices();
    }
  }, [isConnected]);

  const loadIndices = async () => {
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
  };

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
      let results: string[] = [];
      
      for (const indexName of selectedIndices) {
        try {
          let response;
          switch (operation) {
            case 'delete':
              response = await client.request(`/${indexName}`, { method: 'DELETE' });
              results.push(`${indexName}: Deleted successfully`);
              break;
              
            case 'close':
              response = await client.request(`/${indexName}/_close`, { method: 'POST' });
              results.push(`${indexName}: Closed successfully`);
              break;
              
            case 'open':
              response = await client.request(`/${indexName}/_open`, { method: 'POST' });
              results.push(`${indexName}: Opened successfully`);
              break;
              
            case 'forcemerge':
              response = await client.request(`/${indexName}/_forcemerge`, {
                method: 'POST',
                body: JSON.stringify({ max_num_segments: forcemergeSegments })
              });
              results.push(`${indexName}: Force merged to ${forcemergeSegments} segments`);
              break;
              
            case 'refresh':
              response = await client.request(`/${indexName}/_refresh`, { method: 'POST' });
              results.push(`${indexName}: Refreshed successfully`);
              break;
              
            case 'flush':
              response = await client.request(`/${indexName}/_flush`, { method: 'POST' });
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

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'green': return 'text-green-600 bg-green-100 dark:bg-green-900 dark:text-green-300';
      case 'yellow': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-300';
      case 'red': return 'text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-300';
      default: return 'text-gray-600 bg-gray-100 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const getStatusIcon = (health: string) => {
    switch (health) {
      case 'green': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'yellow': return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'red': return <AlertCircle className="h-4 w-4 text-red-500" />;
      default: return <Database className="h-4 w-4 text-gray-500" />;
    }
  };

  const formatBytes = (bytes: string) => {
    if (!bytes || bytes === '0b') return '0 B';
    return bytes;
  };

  const formatNumber = (num: string) => {
    if (!num || num === '0') return '0';
    return parseInt(num).toLocaleString();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <Zap className="h-8 w-8 mr-3 text-purple-500" />
            Bulk Operations
          </h1>
          <p className="text-muted-foreground mt-2">
            Perform bulk operations on multiple indices with safety controls
          </p>
        </div>
        <div className="flex space-x-2">
          <Button onClick={loadIndices} variant="outline" disabled={!isConnected || loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {!isConnected && (
        <Alert className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          <Database className="h-4 w-4" />
          <AlertDescription>
            Not connected to cluster. Please connect first to use bulk operations.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Filters and Bulk Actions */}
      <div className="flex flex-col space-y-4">
        {/* Search and Filters */}
        <div className="flex space-x-4">
          <div className="flex-1">
            <Input
              placeholder="Search indices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>
          <Select value={healthFilter} onValueChange={setHealthFilter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Health</SelectItem>
              <SelectItem value="green">Green</SelectItem>
              <SelectItem value="yellow">Yellow</SelectItem>
              <SelectItem value="red">Red</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="close">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Bulk Action Buttons */}
        {selectedIndices.length > 0 && (
          <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge variant="secondary">{selectedIndices.length} selected</Badge>
                  <span className="text-sm text-muted-foreground">
                    Bulk actions:
                  </span>
                </div>
                <div className="flex space-x-2">
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => confirmOperation('refresh')}
                    disabled={loading}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Refresh
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => confirmOperation('flush')}
                    disabled={loading}
                  >
                    <Activity className="h-4 w-4 mr-1" />
                    Flush
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => confirmOperation('forcemerge')}
                    disabled={loading}
                  >
                    <Archive className="h-4 w-4 mr-1" />
                    Force Merge
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => confirmOperation('close')}
                    disabled={loading}
                  >
                    <Lock className="h-4 w-4 mr-1" />
                    Close
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => confirmOperation('open')}
                    disabled={loading}
                  >
                    <Unlock className="h-4 w-4 mr-1" />
                    Open
                  </Button>
                  <Button 
                    size="sm" 
                    variant="destructive"
                    onClick={() => confirmOperation('delete')}
                    disabled={loading}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Indices Table */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Indices ({filteredIndices.length})</span>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={selectedIndices.length === filteredIndices.length && filteredIndices.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                  <span className="text-sm text-muted-foreground">Select All</span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <span className="ml-2">Loading indices...</span>
                </div>
              ) : filteredIndices.length === 0 ? (
                <div className="text-center py-8">
                  <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {isConnected ? "No indices found" : "Connect to cluster to view indices"}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Select</TableHead>
                        <TableHead>Index Name</TableHead>
                        <TableHead>Health</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Documents</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Shards</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIndices.map((index) => (
                        <TableRow key={index.index}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIndices.includes(index.index)}
                              onCheckedChange={(checked) => handleSelectIndex(index.index, !!checked)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center space-x-2">
                              <Database className="h-4 w-4 text-muted-foreground" />
                              <span>{index.index}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              {getStatusIcon(index.health)}
                              <Badge className={getHealthColor(index.health)}>
                                {index.health}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{index.status}</Badge>
                          </TableCell>
                          <TableCell>{formatNumber(index["docs.count"])}</TableCell>
                          <TableCell>{formatBytes(index["store.size"])}</TableCell>
                          <TableCell>{index.pri}p / {index.rep}r</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Operations History */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Activity className="h-5 w-5" />
                <span>Recent Operations</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {operations.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Archive className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm">No operations yet</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {operations.slice(0, 10).map((operation) => (
                    <div key={operation.id} className="p-3 border rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge 
                          variant={
                            operation.status === 'completed' ? 'default' :
                            operation.status === 'failed' ? 'destructive' :
                            operation.status === 'running' ? 'outline' : 'secondary'
                          }
                          className="text-xs"
                        >
                          {operation.status === 'completed' && <CheckCircle className="h-3 w-3 mr-1" />}
                          {operation.status === 'failed' && <AlertCircle className="h-3 w-3 mr-1" />}
                          {operation.status === 'running' && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          {operation.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {operation.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      
                      <div className="text-sm">
                        <div className="font-medium capitalize">{operation.type}</div>
                        <div className="text-muted-foreground">
                          {operation.indices.length} indices
                        </div>
                      </div>

                      {operation.result && (
                        <div className="text-xs bg-muted p-2 rounded font-mono max-h-20 overflow-y-auto">
                          {operation.result}
                        </div>
                      )}

                      {operation.error && (
                        <Alert className="border-destructive/50 text-destructive text-xs">
                          <AlertCircle className="h-3 w-3" />
                          <AlertDescription>{operation.error}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Shield className="h-5 w-5 text-amber-500" />
              <span>Confirm Bulk Operation</span>
            </DialogTitle>
            <DialogDescription>
              This action will affect multiple indices. Please review carefully.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded-lg">
              <div className="text-sm space-y-2">
                <div><strong>Operation:</strong> {pendingOperation}</div>
                <div><strong>Selected Indices:</strong> {selectedIndices.length}</div>
                <div className="max-h-32 overflow-y-auto">
                  <strong>Indices:</strong>
                  <div className="mt-1 space-y-1">
                    {selectedIndices.map((index) => (
                      <Badge key={index} variant="outline" className="mr-1 mb-1">
                        {index}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {pendingOperation === 'forcemerge' && (
              <div className="space-y-2">
                <Label>Max Segments</Label>
                <Input
                  type="number"
                  value={forcemergeSegments}
                  onChange={(e) => setForcemergeSegments(parseInt(e.target.value) || 1)}
                  min={1}
                  max={100}
                />
              </div>
            )}

            {pendingOperation === 'delete' && (
              <Alert className="border-red-500/50 text-red-700 dark:text-red-400">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>WARNING:</strong> This will permanently delete the selected indices and all their data. 
                  This action cannot be undone.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => executeBulkOperation(pendingOperation)}
              variant={pendingOperation === 'delete' ? 'destructive' : 'default'}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Confirm {pendingOperation}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
