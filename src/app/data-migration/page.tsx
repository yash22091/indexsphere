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
import { Progress } from "@/components/ui/progress";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { 
  ArrowRight, 
  Database, 
  Play, 
  Pause,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Loader2,
  Copy,
  Settings,
  Eye,
  Clock,
  Activity,
  BarChart3,
  Shuffle,
  GitBranch,
  Filter,
  Zap
} from "lucide-react";

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

  const formatJSON = (obj: any, spaces = 2) => {
    try {
      return JSON.stringify(obj, null, spaces);
    } catch {
      return String(obj);
    }
  };

  const renderMappingComparison = () => {
    if (!sourceMapping && !destMapping) return null;

    const sourceFields = sourceMapping ? Object.keys(sourceMapping) : [];
    const destFields = destMapping ? Object.keys(destMapping) : [];
    const allFields = [...new Set([...sourceFields, ...destFields])];

    return (
      <Card>
        <CardHeader>
          <CardTitle>Field Mapping Comparison</CardTitle>
          <CardDescription>
            Compare field mappings between source and destination indices
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {allFields.map((field) => {
              const inSource = sourceFields.includes(field);
              const inDest = destFields.includes(field);
              const sourceType = inSource ? sourceMapping![field]?.type : null;
              const destType = inDest ? destMapping![field]?.type : null;
              const typeMismatch = inSource && inDest && sourceType !== destType;

              return (
                <div key={field} className="flex items-center justify-between p-2 border rounded">
                  <div className="font-mono text-sm">{field}</div>
                  <div className="flex items-center space-x-2">
                    <Badge variant={inSource ? "default" : "secondary"}>
                      {inSource ? sourceType : "Missing"}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <Badge variant={inDest ? (typeMismatch ? "destructive" : "default") : "secondary"}>
                      {inDest ? destType : "Missing"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <Shuffle className="h-8 w-8 mr-3 text-blue-500" />
            Data Migration & Reindex
          </h1>
          <p className="text-muted-foreground mt-2">
            Migrate and transform data between indices with monitoring and safety controls
          </p>
        </div>
        <div className="flex space-x-2">
          <Button onClick={loadIndices} variant="outline" disabled={!isConnected}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Indices
          </Button>
          <Button onClick={() => setShowCreateIndex(true)} variant="outline" disabled={!isConnected}>
            <Database className="h-4 w-4 mr-2" />
            Create Index
          </Button>
        </div>
      </div>

      {!isConnected && (
        <Alert className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          <Database className="h-4 w-4" />
          <AlertDescription>
            Not connected to cluster. Please connect first to use data migration.
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
        {/* Migration Configuration */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <GitBranch className="h-5 w-5" />
                <span>Migration Configuration</span>
              </CardTitle>
              <CardDescription>
                Configure source and destination for data migration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source Index</Label>
                  <Select 
                    value={sourceIndex} 
                    onValueChange={(value) => {
                      setSourceIndex(value);
                      loadIndexMapping(value, 'source');
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select source index" />
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
                  <Label>Destination Index</Label>
                  <div className="flex space-x-2">
                    <Select 
                      value={destIndex} 
                      onValueChange={(value) => {
                        setDestIndex(value);
                        loadIndexMapping(value, 'dest');
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select or create destination" />
                      </SelectTrigger>
                      <SelectContent>
                        {indices.map((index) => (
                          <SelectItem key={index} value={index}>
                            {index}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Or type new index name"
                      value={destIndex}
                      onChange={(e) => setDestIndex(e.target.value)}
                      className="w-48"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Migration Templates</Label>
                <Select onValueChange={loadTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Load migration template" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(migrationTemplates).map(([name, template]) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Source Query (Filter Documents)</Label>
                <Textarea
                  value={reindexQuery}
                  onChange={(e) => setReindexQuery(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                  placeholder="Enter query to filter source documents..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Batch Size</Label>
                  <Input
                    type="number"
                    value={batchSize}
                    onChange={(e) => setBatchSize(parseInt(e.target.value) || 1000)}
                    min={100}
                    max={10000}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Conflict Strategy</Label>
                  <Select value={conflictStrategy} onValueChange={(value: "abort" | "proceed") => setConflictStrategy(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abort">Abort on conflicts</SelectItem>
                      <SelectItem value="proceed">Proceed with conflicts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex space-x-2">
                <Button 
                  onClick={startReindex} 
                  disabled={!isConnected || loading || !sourceIndex || !destIndex}
                  className="flex-1"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Start Migration
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Field Mapping Comparison */}
          {renderMappingComparison()}
        </div>

        {/* Operations Monitor */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Activity className="h-5 w-5" />
                <span>Active Operations</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {operations.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm">No operations running</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {operations.slice(0, 5).map((operation) => (
                    <div key={operation.id} className="space-y-3 p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">
                          {operation.sourceIndex} → {operation.destIndex}
                        </div>
                        <Badge 
                          variant={
                            operation.status === 'completed' ? 'default' :
                            operation.status === 'failed' ? 'destructive' :
                            operation.status === 'paused' ? 'secondary' : 'outline'
                          }
                        >
                          {operation.status === 'completed' && <CheckCircle className="h-3 w-3 mr-1" />}
                          {operation.status === 'failed' && <AlertCircle className="h-3 w-3 mr-1" />}
                          {operation.status === 'running' && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          {operation.status}
                        </Badge>
                      </div>

                      {operation.status === 'running' && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Progress</span>
                            <span>{operation.progress}%</span>
                          </div>
                          <Progress value={operation.progress} className="h-2" />
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Processed:</span>
                          <span className="ml-1 font-medium">{operation.documentsProcessed.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Total:</span>
                          <span className="ml-1 font-medium">{operation.totalDocuments.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Started:</span>
                          <span className="ml-1 font-medium">{operation.startTime.toLocaleTimeString()}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Duration:</span>
                          <span className="ml-1 font-medium">{formatDuration(operation.startTime, operation.endTime)}</span>
                        </div>
                      </div>

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

      {/* Create Index Dialog */}
      <Dialog open={showCreateIndex} onOpenChange={setShowCreateIndex}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Index</DialogTitle>
            <DialogDescription>
              Create a new destination index with custom settings and mappings
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="settings">
            <TabsList>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="mappings">Mappings</TabsTrigger>
            </TabsList>
            
            <TabsContent value="settings" className="space-y-4">
              <div className="space-y-2">
                <Label>Index Name</Label>
                <Input
                  value={destIndex}
                  onChange={(e) => setDestIndex(e.target.value)}
                  placeholder="Enter index name"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Index Settings (JSON)</Label>
                <Textarea
                  value={newIndexSettings}
                  onChange={(e) => setNewIndexSettings(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>
            </TabsContent>
            
            <TabsContent value="mappings" className="space-y-4">
              <div className="space-y-2">
                <Label>Index Mappings (JSON)</Label>
                <Textarea
                  value={newIndexMapping}
                  onChange={(e) => setNewIndexMapping(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateIndex(false)}>
              Cancel
            </Button>
            <Button onClick={createDestinationIndex} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              Create Index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
