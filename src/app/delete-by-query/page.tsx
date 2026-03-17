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
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { 
  Trash2, 
  AlertTriangle, 
  Search, 
  Shield, 
  Play,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Database,
  Loader2,
  FileText,
  Clock,
  Activity,
  Settings,
  Eye,
  Copy,
  Save,
  Download
} from "lucide-react";

interface DeleteOperation {
  id: string;
  index: string;
  query: string;
  deleted: number;
  timestamp: Date;
  status: 'success' | 'failed' | 'running';
  duration: number;
  dryRun: boolean;
}

interface QueryPreview {
  totalMatches: number;
  sampleDocs: any[];
  indices: string[];
}

export default function DeleteByQueryPage() {
  const { isConnected } = useConnection();
  const [selectedIndex, setSelectedIndex] = useState<string>("*");
  const [queryText, setQueryText] = useState<string>('{\n  "match_all": {}\n}');
  const [indices, setIndices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [preview, setPreview] = useState<QueryPreview | null>(null);
  const [history, setHistory] = useState<DeleteOperation[]>([]);
  const [conflicts, setConflicts] = useState<"abort" | "proceed">("abort");
  const [waitForCompletion, setWaitForCompletion] = useState(true);
  const [slices, setSlices] = useState<string>("auto");
  const [scrollSize, setScrollSize] = useState<number>(1000);
  
  // Sample queries for common delete operations
  const sampleQueries = {
    "Delete old logs": {
      query: '{\n  "range": {\n    "@timestamp": {\n      "lt": "now-30d"\n    }\n  }\n}',
      description: "Delete documents older than 30 days"
    },
    "Delete by status": {
      query: '{\n  "term": {\n    "status": "inactive"\n  }\n}',
      description: "Delete documents with inactive status"
    },
    "Delete test data": {
      query: '{\n  "prefix": {\n    "environment": "test"\n  }\n}',
      description: "Delete all test environment data"
    },
    "Delete empty fields": {
      query: '{\n  "bool": {\n    "must_not": {\n      "exists": {\n        "field": "important_field"\n      }\n    }\n  }\n}',
      description: "Delete documents missing important field"
    },
    "Delete by size": {
      query: '{\n  "script": {\n    "source": "doc[\'data_size\'].value > params.max_size",\n    "params": {\n      "max_size": 1000000\n    }\n  }\n}',
      description: "Delete documents larger than specified size"
    }
  };

  // Load indices on component mount
  useEffect(() => {
    if (isConnected) {
      loadIndices();
    }
  }, [isConnected]);

  const loadIndices = async () => {
    const client = getElasticsearchClient();
    if (!client) return;

    try {
      const response = await client.catIndices();
      const indexNames = response?.map((index: any) => index.index) || [];
      setIndices(["*", ...indexNames.sort()]);
    } catch (err: any) {
      console.error('Error loading indices:', err);
    }
  };

  const loadSampleQuery = (queryName: string) => {
    const sample = sampleQueries[queryName as keyof typeof sampleQueries];
    if (sample) {
      setQueryText(sample.query);
    }
  };

  const previewQuery = async () => {
    if (!isConnected) {
      setError("Not connected to cluster");
      return;
    }

    const client = getElasticsearchClient();
    if (!client) {
      setError("No client available");
      return;
    }

    setPreviewLoading(true);
    setError(null);

    try {
      let parsedQuery;
      try {
        parsedQuery = JSON.parse(queryText);
      } catch {
        throw new Error("Invalid JSON query");
      }

      // Get count of matching documents
      const countResponse = await client.request(`/${selectedIndex}/_count`, {
        method: 'POST',
        body: JSON.stringify({ query: parsedQuery })
      });

      // Get sample documents
      const searchResponse = await client.request(`/${selectedIndex}/_search`, {
        method: 'POST',
        body: JSON.stringify({
          query: parsedQuery,
          size: 5,
          _source: true
        })
      });

      const previewData: QueryPreview = {
        totalMatches: countResponse.count || 0,
        sampleDocs: searchResponse.hits?.hits || [],
        indices: Array.isArray(searchResponse.hits?.hits) 
          ? ([...new Set(searchResponse.hits.hits.map((hit: any) => hit._index as string))] as string[])
          : []
      };

      setPreview(previewData);
    } catch (err: any) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const executeDeleteByQuery = async () => {
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
    setShowConfirmDialog(false);

    const operationId = `del-${Date.now()}`;
    
    try {
      let parsedQuery;
      try {
        parsedQuery = JSON.parse(queryText);
      } catch {
        throw new Error("Invalid JSON query");
      }

      const startTime = Date.now();
      
      // Build delete by query parameters
      const params = new URLSearchParams();
      if (conflicts === "proceed") params.append("conflicts", "proceed");
      if (!waitForCompletion) params.append("wait_for_completion", "false");
      if (slices !== "auto") params.append("slices", slices);
      params.append("scroll_size", scrollSize.toString());

      const url = `/${selectedIndex}/_delete_by_query?${params.toString()}`;
      
      const response = await client.request(url, {
        method: 'POST',
        body: JSON.stringify({ query: parsedQuery })
      });

      const duration = Date.now() - startTime;
      const deleted = response.deleted || 0;

      // Add to history
      const operation: DeleteOperation = {
        id: operationId,
        index: selectedIndex,
        query: queryText,
        deleted,
        timestamp: new Date(),
        status: 'success',
        duration,
        dryRun: false
      };

      setHistory([operation, ...history.slice(0, 9)]);
      setPreview(null);
      
      // Success message
      setError(null);
      
    } catch (err: any) {
      const operation: DeleteOperation = {
        id: operationId,
        index: selectedIndex,
        query: queryText,
        deleted: 0,
        timestamp: new Date(),
        status: 'failed',
        duration: 0,
        dryRun: false
      };
      
      setHistory([operation, ...history.slice(0, 9)]);
      setError(`Delete operation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const downloadQuery = () => {
    const blob = new Blob([queryText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delete-query-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatJSON = (obj: any, spaces = 2) => {
    try {
      return JSON.stringify(obj, null, spaces);
    } catch {
      return String(obj);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <Trash2 className="h-8 w-8 mr-3 text-red-500" />
            Delete by Query
          </h1>
          <p className="text-muted-foreground mt-2">
            Safely delete documents matching specific criteria with preview and safeguards
          </p>
        </div>
        <div className="flex space-x-2">
          <Button 
            onClick={loadIndices} 
            variant="outline"
            disabled={!isConnected}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Indices
          </Button>
        </div>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <Alert className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          <Database className="h-4 w-4" />
          <AlertDescription>
            Not connected to cluster. Please connect first to use delete by query.
          </AlertDescription>
        </Alert>
      )}

      {/* Error Alert */}
      {error && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Warning Alert */}
      <Alert className="border-orange-500/50 text-orange-700 dark:text-orange-400">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>⚠️ CAUTION:</strong> Delete by query operations are irreversible. Always preview your query first and consider using dry-run mode.
          Make sure you have proper backups before proceeding with destructive operations.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Query Builder */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Search className="h-5 w-5" />
                <span>Query Builder</span>
              </CardTitle>
              <CardDescription>
                Build and test your delete query with safety controls
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Target Index</Label>
                  <Select value={selectedIndex} onValueChange={setSelectedIndex}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {indices.map((index) => (
                        <SelectItem key={index} value={index}>
                          {index}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Sample Queries</Label>
                  <Select onValueChange={loadSampleQuery}>
                    <SelectTrigger>
                      <SelectValue placeholder="Load sample query" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(sampleQueries).map(([name, query]) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Delete Query (JSON)</Label>
                <Textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                  placeholder="Enter your Elasticsearch query in JSON format..."
                />
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(queryText)}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Query
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadQuery}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>
              </div>

              <div className="flex space-x-2">
                <Button 
                  onClick={previewQuery} 
                  disabled={!isConnected || previewLoading}
                  variant="outline"
                  className="flex-1"
                >
                  {previewLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4 mr-2" />
                  )}
                  Preview Query
                </Button>
                <Button 
                  onClick={() => setShowConfirmDialog(true)} 
                  disabled={!isConnected || loading || !preview}
                  className="flex-1"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Execute Delete
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Query Preview */}
          {preview && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Eye className="h-5 w-5" />
                  <span>Query Preview</span>
                </CardTitle>
                <CardDescription>
                  Documents that will be affected by this delete operation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-2xl font-bold text-red-600">{preview.totalMatches.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Documents to Delete</div>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-2xl font-bold">{preview.indices.length}</div>
                    <div className="text-sm text-muted-foreground">Affected Indices</div>
                  </div>
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-2xl font-bold">{preview.sampleDocs.length}</div>
                    <div className="text-sm text-muted-foreground">Sample Documents</div>
                  </div>
                </div>

                {preview.sampleDocs.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-medium">Sample Documents:</h4>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {preview.sampleDocs.map((doc, index) => (
                        <Card key={doc._id || `doc-${index}`} className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <Badge variant="outline">{doc._index}</Badge>
                            <div className="text-xs text-muted-foreground">ID: {doc._id}</div>
                          </div>
                          <Textarea
                            value={formatJSON(doc._source, 2)}
                            rows={4}
                            readOnly
                            className="font-mono text-xs"
                          />
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Settings & History */}
        <div className="space-y-6">
          {/* Advanced Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Settings className="h-5 w-5" />
                <span>Safety & Settings</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="dry-run"
                    checked={dryRun}
                    onCheckedChange={(checked) => setDryRun(!!checked)}
                  />
                  <Label htmlFor="dry-run" className="text-sm">
                    Dry Run (Preview Only)
                  </Label>
                </div>
                
                <div className="space-y-2">
                  <Label>Conflict Handling</Label>
                  <Select value={conflicts} onValueChange={(value: "abort" | "proceed") => setConflicts(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abort">Abort on conflicts</SelectItem>
                      <SelectItem value="proceed">Proceed with conflicts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="wait-completion"
                    checked={waitForCompletion}
                    onCheckedChange={(checked) => setWaitForCompletion(!!checked)}
                  />
                  <Label htmlFor="wait-completion" className="text-sm">
                    Wait for completion
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label>Parallel Slices</Label>
                  <Input
                    value={slices}
                    onChange={(e) => setSlices(e.target.value)}
                    placeholder="auto"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Scroll Size</Label>
                  <Input
                    type="number"
                    value={scrollSize}
                    onChange={(e) => setScrollSize(parseInt(e.target.value) || 1000)}
                    min={100}
                    max={10000}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Operation History */}
          {history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Clock className="h-5 w-5" />
                  <span>Recent Operations</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {history.map((operation) => (
                    <div 
                      key={operation.id}
                      className="p-3 border rounded-lg space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <Badge 
                          variant={operation.status === 'success' ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {operation.status === 'success' ? (
                            <CheckCircle className="h-3 w-3 mr-1" />
                          ) : (
                            <AlertCircle className="h-3 w-3 mr-1" />
                          )}
                          {operation.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {operation.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-sm">
                        <div className="font-medium">{operation.index}</div>
                        <div className="text-muted-foreground">
                          Deleted: {operation.deleted.toLocaleString()} docs
                        </div>
                        <div className="text-muted-foreground">
                          Duration: {operation.duration}ms
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <span>Confirm Delete Operation</span>
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. Please review the details carefully.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg">
              <div className="text-sm space-y-2">
                <div><strong>Target Index:</strong> {selectedIndex}</div>
                <div><strong>Documents to Delete:</strong> {preview?.totalMatches.toLocaleString() || 'Unknown'}</div>
                <div><strong>Affected Indices:</strong> {preview?.indices.join(', ') || 'Unknown'}</div>
                <div><strong>Conflict Handling:</strong> {conflicts}</div>
              </div>
            </div>
            
            <Alert className="border-red-500/50 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>WARNING:</strong> This will permanently delete {preview?.totalMatches.toLocaleString() || 'unknown number of'} documents. 
                Make sure you have proper backups and have tested your query thoroughly.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={executeDeleteByQuery}
              className="bg-red-600 hover:bg-red-700"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
