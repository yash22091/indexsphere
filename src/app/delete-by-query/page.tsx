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
import Link from "next/link";
import { useConnection } from "@/contexts/connection-context";
import { EmptyState, PageHeader, SeverityBadge } from "@/components/app";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { AlertCircle, AlertTriangle, CheckCircle, Copy, Database, Download, Eye, Loader2, RefreshCw, Trash2 } from "lucide-react";

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
  const [confirmText, setConfirmText] = useState("");
  
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

  const confirmOk = confirmText.trim().toLowerCase() === "delete";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delete by query"
        description="Delete the documents that match a query. Preview the matches first; deletions can't be undone."
        actions={
          <Button onClick={loadIndices} variant="outline" disabled={!isConnected}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh indices
          </Button>
        }
      />

      {!isConnected && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to delete documents by query."
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
      <Alert>
        <AlertTriangle className="h-4 w-4 text-warning" />
        <AlertDescription>
          Deleted documents can&apos;t be recovered. Preview the query, keep dry run on until the matches look right, and make sure a recent snapshot exists.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Query</CardTitle>
              <CardDescription>Documents matching this query will be deleted.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Target index</Label>
                  <Select value={selectedIndex} onValueChange={setSelectedIndex}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {indices.map((index) => (
                        <SelectItem key={index} value={index}>{index === "*" ? "All indices (*)" : index}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Start from an example</Label>
                  <Select onValueChange={loadSampleQuery}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Choose an example" /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(sampleQueries).map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dbq-query">Query DSL (JSON)</Label>
                <Textarea
                  id="dbq-query"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(queryText)}>
                    <Copy className="mr-2 h-4 w-4" />Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={downloadQuery}>
                    <Download className="mr-2 h-4 w-4" />Download
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={previewQuery} disabled={!isConnected || previewLoading} variant="outline" className="flex-1">
                  {previewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                  Preview matches
                </Button>
                <Button
                  onClick={() => { setConfirmText(""); setShowConfirmDialog(true); }}
                  disabled={!isConnected || loading || !preview || dryRun}
                  variant="destructive"
                  className="flex-1"
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Delete matching documents
                </Button>
              </div>
              {(!preview || dryRun) && (
                <p className="text-xs text-muted-foreground">
                  {!preview ? "Preview the matches before deleting." : "Dry run is on — turn it off under Safety settings to enable deletion."}
                </p>
              )}
            </CardContent>
          </Card>

          {preview && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preview</CardTitle>
                <CardDescription>Documents that this operation would delete.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ["Matching documents", preview.totalMatches.toLocaleString(), preview.totalMatches > 0 ? "text-destructive" : ""],
                    ["Indices affected", String(preview.indices.length), ""],
                    ["Samples shown", String(preview.sampleDocs.length), ""],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={`mt-1 text-xl font-semibold tabular-nums ${cls}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {preview.sampleDocs.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Sample documents</h4>
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                      {preview.sampleDocs.map((doc, index) => (
                        <div key={doc._id || `doc-${index}`} className="rounded-md border">
                          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                            <Badge variant="outline" className="font-mono font-normal">{doc._index}</Badge>
                            <span className="truncate font-mono text-xs text-muted-foreground">{doc._id}</span>
                          </div>
                          <pre className="max-h-40 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">{formatJSON(doc._source, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Safety settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2">
                <Checkbox id="dry-run" checked={dryRun} onCheckedChange={(checked) => setDryRun(!!checked)} />
                <div className="grid gap-0.5">
                  <Label htmlFor="dry-run">Dry run (preview only)</Label>
                  <p className="text-xs text-muted-foreground">While on, deletion is disabled.</p>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>On version conflict</Label>
                <Select value={conflicts} onValueChange={(value: "abort" | "proceed") => setConflicts(value)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abort">Abort</SelectItem>
                    <SelectItem value="proceed">Skip and continue</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="wait-completion" checked={waitForCompletion} onCheckedChange={(checked) => setWaitForCompletion(!!checked)} />
                <Label htmlFor="wait-completion">Wait for completion</Label>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dbq-slices">Parallel slices</Label>
                <Input id="dbq-slices" value={slices} onChange={(e) => setSlices(e.target.value)} placeholder="auto" />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dbq-scroll">Batch size</Label>
                <Input
                  id="dbq-scroll"
                  type="number"
                  value={scrollSize}
                  onChange={(e) => setScrollSize(parseInt(e.target.value) || 1000)}
                  min={100}
                  max={10000}
                />
              </div>
            </CardContent>
          </Card>

          {history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent operations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {history.map((operation) => (
                    <div key={operation.id} className="space-y-1.5 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <SeverityBadge level={operation.status === 'success' ? 'ok' : 'high'}>
                          {operation.status === 'success' ? <CheckCircle className="mr-1 h-3 w-3" /> : <AlertCircle className="mr-1 h-3 w-3" />}
                          {operation.status}
                        </SeverityBadge>
                        <span className="text-xs text-muted-foreground">{operation.timestamp.toLocaleTimeString()}</span>
                      </div>
                      <div className="text-sm">
                        <div className="truncate font-mono text-xs font-medium">{operation.index}</div>
                        <div className="text-muted-foreground tabular-nums">{operation.deleted.toLocaleString()} deleted · {operation.duration} ms</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      </>
      )}

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {preview?.totalMatches.toLocaleString() ?? "the matching"} documents?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <dl className="divide-y rounded-md border text-sm">
              {[
                ["Target", selectedIndex === "*" ? "All indices (*)" : selectedIndex],
                ["Matching documents", preview?.totalMatches.toLocaleString() || "Unknown"],
                ["Indices affected", preview?.indices.join(", ") || "Unknown"],
                ["On conflict", conflicts === "abort" ? "Abort" : "Skip and continue"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-3 py-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-all text-right font-mono text-xs">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-2">
              <Label htmlFor="dbq-confirm">Type <span className="font-mono">delete</span> to confirm</Label>
              <Input id="dbq-confirm" value={confirmText} onChange={e => setConfirmText(e.target.value)} autoComplete="off" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>Cancel</Button>
            <Button onClick={executeDeleteByQuery} variant="destructive" disabled={loading || !confirmOk}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete documents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
