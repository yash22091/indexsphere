"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Info,
  Server,
  Database,
  Settings,
  TrendingUp,
  Cpu,
  HardDrive,
  Network,
  BarChart3,
  RefreshCw,
  Loader2,
  FileText,
  Target,
  Zap,
  Wifi,
  Eye,
  EyeOff,
  Activity
} from "lucide-react";

interface ConnectionConfig {
  url: string;
  username?: string;
  password?: string;
  type: "elasticsearch" | "opensearch";
}

interface ClusterAnalysis {
  health: {
    status: "green" | "yellow" | "red";
    score: number;
    issues: string[];
    recommendations: string[];
  };
  configuration: {
    score: number;
    issues: string[];
    recommendations: string[];
  };
  performance: {
    score: number;
    issues: string[];
    recommendations: string[];
  };
  sizing: {
    recommendations: Array<{
      category: string;
      current: string;
      recommended: string;
      reasoning: string;
      priority: "low" | "medium" | "high";
    }>;
  };
}

export default function StandaloneClusterAnalysisPage() {
  const router = useRouter();
  const [connectionConfig, setConnectionConfig] = useState<ConnectionConfig>({
    url: "http://localhost:9200",
    type: "elasticsearch"
  });
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ClusterAnalysis | null>(null);

  // Try to load saved connection on mount
  useEffect(() => {
    const savedConnection = localStorage.getItem('elasticsearch-connection');
    if (savedConnection) {
      try {
        const config = JSON.parse(savedConnection);
        setConnectionConfig(config);
        // Auto-connect if we have saved credentials
        handleConnect(config);
      } catch (error) {
        console.warn('Failed to load saved connection:', error);
      }
    }
  }, []);

  const handleConnect = async (config?: ConnectionConfig) => {
    const configToUse = config || connectionConfig;
    setConnecting(true);
    setError(null);

    try {
      // Test connection using the API
      const response = await fetch('/api/cluster/health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(configToUse),
      });

      if (!response.ok) {
        throw new Error(`Connection failed: ${response.statusText}`);
      }

      setConnected(true);
      
      // Save connection for future use
      localStorage.setItem('elasticsearch-connection', JSON.stringify(configToUse));
      
      // Automatically start analysis
      await loadClusterAnalysis(configToUse);
    } catch (err: any) {
      setError(`Connection failed: ${err.message}`);
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  };

  const loadClusterAnalysis = async (config?: ConnectionConfig) => {
    setLoading(true);
    setError(null);

    try {
      const configToUse = config || connectionConfig;
      
      // Get cluster data directly via API with the connection config
      const [healthResponse, statsResponse, nodesResponse, indicesResponse] = await Promise.all([
        fetch('/api/es-proxy/_cluster/health', {
          method: 'GET',
          headers: {
            'X-Cluster-Config': JSON.stringify(configToUse)
          }
        }),
        fetch('/api/es-proxy/_cluster/stats', {
          method: 'GET',
          headers: {
            'X-Cluster-Config': JSON.stringify(configToUse)
          }
        }),
        fetch('/api/es-proxy/_nodes/stats', {
          method: 'GET',
          headers: {
            'X-Cluster-Config': JSON.stringify(configToUse)
          }
        }),
        fetch('/api/es-proxy/_cat/indices?format=json', {
          method: 'GET',
          headers: {
            'X-Cluster-Config': JSON.stringify(configToUse)
          }
        })
      ]);

      if (!healthResponse.ok || !statsResponse.ok) {
        throw new Error('Failed to fetch cluster data');
      }

      const health = await healthResponse.json();
      const stats = await statsResponse.json();
      const nodes = nodesResponse.ok ? await nodesResponse.json() : { nodes: {} };
      const indices = indicesResponse.ok ? await indicesResponse.json() : [];

      // Perform analysis
      const analysisResult = {
        health: analyzeHealth(health, stats),
        configuration: analyzeConfiguration(stats, nodes),
        performance: analyzePerformance(stats, nodes),
        sizing: analyzeSizing(stats, nodes, indices)
      };

      setAnalysis(analysisResult);
    } catch (err: any) {
      setError(`Failed to load cluster analysis: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const analyzeHealth = (health: any, stats: any) => {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    if (health.status === "red") {
      score -= 50;
      issues.push("Cluster status is RED - data loss possible");
      recommendations.push("Investigate failed shards immediately");
    } else if (health.status === "yellow") {
      score -= 20;
      issues.push("Cluster status is YELLOW - reduced redundancy");
      recommendations.push("Check replica shard allocation");
    }

    if (health.unassigned_shards > 0) {
      score -= Math.min(30, health.unassigned_shards * 5);
      issues.push(`${health.unassigned_shards} unassigned shards detected`);
      recommendations.push("Review shard allocation and node capacity");
    }

    return { status: health.status, score: Math.max(0, score), issues, recommendations };
  };

  const analyzeConfiguration = (stats: any, nodes: any) => {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Basic configuration analysis
    const nodeCount = Object.keys(nodes.nodes || {}).length;
    if (nodeCount < 3) {
      score -= 20;
      issues.push("Less than 3 nodes - limited fault tolerance");
      recommendations.push("Consider adding more nodes for high availability");
    }

    return { score: Math.max(0, score), issues, recommendations };
  };

  const analyzePerformance = (stats: any, nodes: any) => {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Basic performance analysis
    if (stats.indices?.search?.query_time_in_millis) {
      const avgQueryTime = stats.indices.search.query_time_in_millis / (stats.indices.search.query_total || 1);
      if (avgQueryTime > 100) {
        score -= 15;
        issues.push("High average query response time");
        recommendations.push("Review query patterns and consider optimizations");
      }
    }

    return { score: Math.max(0, score), issues, recommendations };
  };

  const analyzeSizing = (stats: any, nodes: any, indices: any[]) => {
    const recommendations = [];

    // Basic sizing recommendations
    const totalDocs = stats.indices?.docs?.count || 0;
    const totalSize = stats.indices?.store?.size_in_bytes || 0;
    const nodeCount = Object.keys(nodes.nodes || {}).length;

    if (totalDocs > 10000000) { // 10M+ docs
      recommendations.push({
        category: "Scaling",
        current: `${totalDocs.toLocaleString()} documents`,
        recommended: "Consider horizontal scaling",
        reasoning: "Large document count may benefit from additional nodes",
        priority: "medium" as const
      });
    }

    return { recommendations };
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-500";
    if (score >= 60) return "text-yellow-500";
    return "text-red-500";
  };

  const getScoreBadgeVariant = (score: number) => {
    if (score >= 80) return "default";
    if (score >= 60) return "secondary";
    return "destructive";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Standalone Cluster Analysis</h1>
          <p className="text-muted-foreground">
            Connect to any Elasticsearch/OpenSearch cluster for comprehensive analysis
          </p>
        </div>
        {connected && (
          <Button onClick={() => loadClusterAnalysis()} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh Analysis
          </Button>
        )}
      </div>

      {/* Connection Form */}
      {!connected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              Connect to Cluster
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="url">Cluster URL</Label>
                <Input
                  id="url"
                  value={connectionConfig.url}
                  onChange={(e) => setConnectionConfig(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="http://localhost:9200"
                />
              </div>
              <div>
                <Label htmlFor="type">Server Type</Label>
                <select
                  id="type"
                  className="w-full h-10 px-3 py-2 border border-input bg-background rounded-md"
                  value={connectionConfig.type}
                  onChange={(e) => setConnectionConfig(prev => ({ ...prev, type: e.target.value as any }))}
                >
                  <option value="elasticsearch">Elasticsearch</option>
                  <option value="opensearch">OpenSearch</option>
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="username">Username (optional)</Label>
                <Input
                  id="username"
                  value={connectionConfig.username || ""}
                  onChange={(e) => setConnectionConfig(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="elastic"
                />
              </div>
              <div>
                <Label htmlFor="password">Password (optional)</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={connectionConfig.password || ""}
                    onChange={(e) => setConnectionConfig(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <Button onClick={() => handleConnect()} disabled={connecting} className="w-full">
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              Connect & Analyze
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connection Status */}
      {connected && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            Connected to {connectionConfig.url} • Ready for analysis
          </AlertDescription>
        </Alert>
      )}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mr-2" />
          <span>Analyzing cluster...</span>
        </div>
      )}

      {/* Analysis Results */}
      {analysis && !loading && (
        <Tabs defaultValue="health" className="space-y-4">
          <TabsList>
            <TabsTrigger value="health">Health Analysis</TabsTrigger>
            <TabsTrigger value="configuration">Configuration</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="sizing">Sizing</TabsTrigger>
          </TabsList>

          <TabsContent value="health">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Cluster Health
                  </span>
                  <Badge variant={getScoreBadgeVariant(analysis.health.score)}>
                    Score: {analysis.health.score}/100
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <span>Overall Status:</span>
                  <Badge 
                    variant={
                      analysis.health.status === "green" ? "default" :
                      analysis.health.status === "yellow" ? "secondary" : "destructive"
                    }
                  >
                    {analysis.health.status.toUpperCase()}
                  </Badge>
                </div>
                
                <Progress value={analysis.health.score} className="w-full" />
                
                {analysis.health.issues.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-red-600 mb-2">Issues Found:</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {analysis.health.issues.map((issue, i) => (
                        <li key={i} className="text-sm">{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {analysis.health.recommendations.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-blue-600 mb-2">Recommendations:</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {analysis.health.recommendations.map((rec, i) => (
                        <li key={i} className="text-sm">{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="configuration">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Configuration Analysis
                  </span>
                  <Badge variant={getScoreBadgeVariant(analysis.configuration.score)}>
                    Score: {analysis.configuration.score}/100
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={analysis.configuration.score} className="w-full" />
                
                {analysis.configuration.issues.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-red-600 mb-2">Configuration Issues:</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {analysis.configuration.issues.map((issue, i) => (
                        <li key={i} className="text-sm">{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {analysis.configuration.recommendations.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-blue-600 mb-2">Recommendations:</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {analysis.configuration.recommendations.map((rec, i) => (
                        <li key={i} className="text-sm">{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Performance Analysis
                  </span>
                  <Badge variant={getScoreBadgeVariant(analysis.performance.score)}>
                    Score: {analysis.performance.score}/100
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={analysis.performance.score} className="w-full" />
                
                {analysis.performance.issues.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-red-600 mb-2">Performance Issues:</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {analysis.performance.issues.map((issue, i) => (
                        <li key={i} className="text-sm">{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {analysis.performance.recommendations.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-blue-600 mb-2">Recommendations:</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {analysis.performance.recommendations.map((rec, i) => (
                        <li key={i} className="text-sm">{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sizing">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Sizing Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analysis.sizing.recommendations.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Current</TableHead>
                        <TableHead>Recommended</TableHead>
                        <TableHead>Reasoning</TableHead>
                        <TableHead>Priority</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.sizing.recommendations.map((rec, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{rec.category}</TableCell>
                          <TableCell>{rec.current}</TableCell>
                          <TableCell>{rec.recommended}</TableCell>
                          <TableCell>{rec.reasoning}</TableCell>
                          <TableCell>
                            <Badge variant={
                              rec.priority === "high" ? "destructive" :
                              rec.priority === "medium" ? "secondary" : "outline"
                            }>
                              {rec.priority}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground">No specific sizing recommendations at this time.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => router.push('/dashboard')}>
          ← Back to Dashboard
        </Button>
        {connected && (
          <Button variant="outline" onClick={() => setConnected(false)}>
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
