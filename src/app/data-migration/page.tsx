"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConnection } from "@/contexts/connection-context";
import { EmptyState, PageHeader, SeverityBadge } from "@/components/app";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { AlertCircle, ArrowRight, Database, Loader2, Play, Plus, RefreshCw } from "lucide-react";

interface ReindexOperation {
  id: string;
  sourceIndex: string;
  destIndex: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  progress: number;
  documentsProcessed: number;
  totalDocuments: number;
  startTime: Date;
  endTime?: Date;
  error?: string;
}

interface IndexMapping {
  [field: string]: {
    type: string;
    properties?: IndexMapping;
  };
}

export default function DataMigrationPage() {
  const { isConnected } = useConnection();
  const [sourceIndex, setSourceIndex] = useState<string>("");
  const [destIndex, setDestIndex] = useState<string>("");
  const [indices, setIndices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operations, setOperations] = useState<ReindexOperation[]>([]);
  const [showCreateIndex, setShowCreateIndex] = useState(false);
  const [newIndexSettings, setNewIndexSettings] = useState('{\n  "number_of_shards": 1,\n  "number_of_replicas": 1\n}');
  const [newIndexMapping, setNewIndexMapping] = useState('{\n  "properties": {\n    "@timestamp": {\n      "type": "date"\n    }\n  }\n}');
  const [reindexQuery, setReindexQuery] = useState('{\n  "match_all": {}\n}');
  const [batchSize, setBatchSize] = useState(1000);
  const [conflictStrategy, setConflictStrategy] = useState<"abort" | "proceed">("abort");
  const [sourceMapping, setSourceMapping] = useState<IndexMapping | null>(null);
  const [destMapping, setDestMapping] = useState<IndexMapping | null>(null);

  // Sample migration templates
  const migrationTemplates = {
    "Simple Reindex": {
      query: '{\n  "match_all": {}\n}',
      description: "Copy all documents from source to destination"
    },
    "Date Range Migration": {
      query: '{\n  "range": {\n    "@timestamp": {\n      "gte": "2024-01-01",\n      "lte": "2024-12-31"\n    }\n  }\n}',
      description: "Migrate documents within date range"
    },
    "Field Transformation": {
      query: '{\n  "bool": {\n    "must": [\n      {"exists": {"field": "user_id"}}\n    ]\n  }\n}',
      description: "Migrate documents with specific fields"
    },
    "Data Cleanup": {
      query: '{\n  "bool": {\n    "must_not": [\n      {"term": {"status": "deleted"}}\n    ]\n  }\n}',
      description: "Exclude deleted/invalid records"
    }
  };

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
      setIndices(indexNames.sort());
    } catch (err: any) {
      console.error('Error loading indices:', err);
    }
  };

  const loadIndexMapping = async (indexName: string, type: 'source' | 'dest') => {
    const client = getElasticsearchClient();
    if (!client || !indexName) return;

    try {
      const response = await client.request(`/${indexName}/_mapping`);
      const mapping = response[indexName]?.mappings?.properties || {};
      
      if (type === 'source') {
        setSourceMapping(mapping);
      } else {
        setDestMapping(mapping);
      }
    } catch (err: any) {
      console.error(`Error loading ${type} mapping:`, err);
    }
  };

  const createDestinationIndex = async () => {
    if (!isConnected || !destIndex) {
      setError("Please provide destination index name");
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
      let settings, mappings;
      try {
        settings = JSON.parse(newIndexSettings);
        mappings = JSON.parse(newIndexMapping);
      } catch {
        throw new Error("Invalid JSON in settings or mappings");
      }

      await client.request(`/${destIndex}`, {
        method: 'PUT',
        body: JSON.stringify({
          settings,
          mappings
        })
      });

      setShowCreateIndex(false);
      await loadIndices();
      setError(null);
    } catch (err: any) {
      setError(`Failed to create index: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const startReindex = async () => {
    if (!isConnected || !sourceIndex || !destIndex) {
      setError("Please select source and destination indices");
      return;
    }

    const client = getElasticsearchClient();
    if (!client) {
      setError("No client available");
      return;
    }

    setLoading(true);
    setError(null);

    const operationId = `reindex-${Date.now()}`;
    
    try {
      let query;
      try {
        query = JSON.parse(reindexQuery);
      } catch {
        throw new Error("Invalid JSON query");
      }

      // Create operation tracking
      const operation: ReindexOperation = {
        id: operationId,
        sourceIndex,
        destIndex,
        status: 'running',
        progress: 0,
        documentsProcessed: 0,
        totalDocuments: 0,
        startTime: new Date()
      };

      setOperations([operation, ...operations]);

      // Start reindex operation
      const reindexBody: any = {
        source: {
          index: sourceIndex,
          query: query
        },
        dest: {
          index: destIndex
        }
      };

      if (conflictStrategy === "proceed") {
        reindexBody.conflicts = "proceed";
      }

      const response = await client.request('/_reindex?wait_for_completion=false', {
        method: 'POST',
        body: reindexBody
      });

      // Update operation with task info
      const updatedOperation = {
        ...operation,
        status: 'running' as const,
        progress: 0
      };

      setOperations(prev => prev.map(op => op.id === operationId ? updatedOperation : op));
      
      // Start monitoring the reindex task
      if (response.task) {
        monitorReindexTask(response.task, operationId);
      } else {
        // Completed immediately
        const completedOperation = {
          ...operation,
          status: 'completed' as const,
          progress: 100,
          endTime: new Date(),
          documentsProcessed: response.created || 0,
          totalDocuments: response.total || 0
        };
        setOperations(prev => prev.map(op => op.id === operationId ? completedOperation : op));
      }

    } catch (err: any) {
      const failedOperation: ReindexOperation = {
        id: operationId,
        sourceIndex,
        destIndex,
        status: 'failed',
        progress: 0,
        documentsProcessed: 0,
        totalDocuments: 0,
        startTime: new Date(),
        endTime: new Date(),
        error: err.message
      };
      
      setOperations(prev => prev.map(op => op.id === operationId ? failedOperation : op));
      setError(`Reindex failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const monitorReindexTask = async (taskId: string, operationId: string) => {
    const client = getElasticsearchClient();
    if (!client) return;

    const checkTask = async () => {
      try {
        const taskResponse = await client.request(`/_tasks/${taskId}`);
        const task = taskResponse.task;
        
        if (task) {
          const progress = task.status ? 
            Math.round((task.status.created / Math.max(task.status.total, 1)) * 100) : 0;
          
          const updatedOperation: ReindexOperation = {
            id: operationId,
            sourceIndex,
            destIndex,
            status: taskResponse.completed ? 'completed' : 'running',
            progress,
            documentsProcessed: task.status?.created || 0,
            totalDocuments: task.status?.total || 0,
            startTime: new Date(task.start_time_in_millis),
            endTime: taskResponse.completed ? new Date() : undefined
          };

          setOperations(prev => prev.map(op => op.id === operationId ? updatedOperation : op));

          if (!taskResponse.completed) {
            setTimeout(checkTask, 2000); // Check every 2 seconds
          }
        }
      } catch (err) {
        console.error('Error monitoring task:', err);
      }
    };

    checkTask();
  };

  const loadTemplate = (templateName: string) => {
    const template = migrationTemplates[templateName as keyof typeof migrationTemplates];
    if (template) {
      setReindexQuery(template.query);
    }
  };

  const formatDuration = (start: Date, end?: Date) => {
    const endTime = end || new Date();
    const duration = Math.round((endTime.getTime() - start.getTime()) / 1000);
    return `${duration}s`;
  };

  const renderMappingComparison = () => {
    if (!sourceMapping && !destMapping) return null;

    const sourceFields = sourceMapping ? Object.keys(sourceMapping) : [];
    const destFields = destMapping ? Object.keys(destMapping) : [];
    const allFields = [...new Set([...sourceFields, ...destFields])];

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Field mapping comparison</CardTitle>
          <CardDescription>Source field types against the destination. Mismatches are highlighted.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Destination</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allFields.map((field) => {
                  const inSource = sourceFields.includes(field);
                  const inDest = destFields.includes(field);
                  const sourceType = inSource ? sourceMapping![field]?.type : null;
                  const destType = inDest ? destMapping![field]?.type : null;
                  const typeMismatch = inSource && inDest && sourceType !== destType;
                  return (
                    <TableRow key={field}>
                      <TableCell className="font-mono text-xs">{field}</TableCell>
                      <TableCell className={inSource ? "font-mono text-xs" : "text-xs text-muted-foreground"}>{inSource ? (sourceType ?? "object") : "missing"}</TableCell>
                      <TableCell className="text-xs">
                        {inDest
                          ? typeMismatch
                            ? <SeverityBadge level="high" className="font-mono">{destType ?? "object"}</SeverityBadge>
                            : <span className="font-mono">{destType ?? "object"}</span>
                          : <span className="text-muted-foreground">missing</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data migration"
        description="Copy and transform documents between indices, compare mappings and monitor progress."
        actions={
          <>
            <Button onClick={loadIndices} variant="outline" disabled={!isConnected}>
              <RefreshCw className="mr-2 h-4 w-4" />Refresh indices
            </Button>
            <Button onClick={() => setShowCreateIndex(true)} variant="outline" disabled={!isConnected}>
              <Plus className="mr-2 h-4 w-4" />Create index
            </Button>
          </>
        }
      />

      {!isConnected && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to migrate data."
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
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Migration</CardTitle>
              <CardDescription>Choose the source and destination and, optionally, filter the documents to copy.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Source index</Label>
                  <Select
                    value={sourceIndex}
                    onValueChange={(value) => {
                      setSourceIndex(value);
                      loadIndexMapping(value, 'source');
                    }}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select source index" /></SelectTrigger>
                    <SelectContent>
                      {indices.map((index) => (
                        <SelectItem key={index} value={index}>{index}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Destination index</Label>
                  <Select
                    value={indices.includes(destIndex) ? destIndex : ""}
                    onValueChange={(value) => {
                      setDestIndex(value);
                      loadIndexMapping(value, 'dest');
                    }}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select an existing index" /></SelectTrigger>
                    <SelectContent>
                      {indices.map((index) => (
                        <SelectItem key={index} value={index}>{index}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="…or type a new index name"
                    value={destIndex}
                    onChange={(e) => setDestIndex(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Start from a template</Label>
                <Select onValueChange={loadTemplate}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose a template" /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(migrationTemplates).map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dm-query">Source query</Label>
                <Textarea
                  id="dm-query"
                  value={reindexQuery}
                  onChange={(e) => setReindexQuery(e.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="dm-batch">Batch size</Label>
                  <Input
                    id="dm-batch"
                    type="number"
                    value={batchSize}
                    onChange={(e) => setBatchSize(parseInt(e.target.value) || 1000)}
                    min={100}
                    max={10000}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>On version conflict</Label>
                  <Select value={conflictStrategy} onValueChange={(value: "abort" | "proceed") => setConflictStrategy(value)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abort">Abort</SelectItem>
                      <SelectItem value="proceed">Skip and continue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={startReindex} disabled={!isConnected || loading || !sourceIndex || !destIndex}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Start migration
                </Button>
              </div>
            </CardContent>
          </Card>

          {renderMappingComparison()}
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">Operations</CardTitle>
          </CardHeader>
          <CardContent>
            {operations.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No migrations in this session.</p>
            ) : (
              <div className="space-y-3">
                {operations.slice(0, 5).map((operation) => (
                  <div key={operation.id} className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 break-all font-mono text-xs">
                        {operation.sourceIndex} <ArrowRight className="inline h-3 w-3 text-muted-foreground" /> {operation.destIndex}
                      </div>
                      <SeverityBadge level={operation.status === 'completed' ? 'ok' : operation.status === 'failed' ? 'high' : operation.status === 'paused' ? 'warning' : 'info'}>
                        {operation.status === 'running' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        {operation.status}
                      </SeverityBadge>
                    </div>

                    {operation.status === 'running' && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                          <span>Progress</span><span>{operation.progress}%</span>
                        </div>
                        <Progress value={operation.progress} className="h-1.5" />
                      </div>
                    )}

                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        ["Processed", operation.documentsProcessed.toLocaleString()],
                        ["Total", operation.totalDocuments.toLocaleString()],
                        ["Started", operation.startTime.toLocaleTimeString()],
                        ["Duration", formatDuration(operation.startTime, operation.endTime)],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="font-medium tabular-nums">{v}</dd>
                        </div>
                      ))}
                    </dl>

                    {operation.error && <p className="text-xs text-destructive">{operation.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      <Dialog open={showCreateIndex} onOpenChange={setShowCreateIndex}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create index</DialogTitle>
            <DialogDescription>Create the destination index with explicit settings and mappings.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="dm-new-name">Index name</Label>
            <Input id="dm-new-name" value={destIndex} onChange={(e) => setDestIndex(e.target.value)} placeholder="logs-2026.10" />
          </div>

          <Tabs defaultValue="settings">
            <TabsList>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="mappings">Mappings</TabsTrigger>
            </TabsList>
            <TabsContent value="settings" className="mt-3">
              <Textarea
                aria-label="Index settings (JSON)"
                value={newIndexSettings}
                onChange={(e) => setNewIndexSettings(e.target.value)}
                rows={10}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </TabsContent>
            <TabsContent value="mappings" className="mt-3">
              <Textarea
                aria-label="Index mappings (JSON)"
                value={newIndexMapping}
                onChange={(e) => setNewIndexMapping(e.target.value)}
                rows={10}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateIndex(false)}>Cancel</Button>
            <Button onClick={createDestinationIndex} disabled={loading || !destIndex}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
