"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, HealthBadge, PageHeader, SeverityBadge, StatCard, StatGrid, StatusDot } from "@/components/app";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
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
  BarChart3,
  RefreshCw,
  Loader2,
  FileText,
  Target,
  Zap
} from "lucide-react";

interface TemplateInfo {
  name: string;
  index_patterns: string[];
  priority: number;
  settings: any;
  mappings: any;
  aliases: any;
  lifecycle?: any;
}

interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  type?: string;
  node?: string;
}

interface AllocationInfo {
  unassigned_shards?: number;
  relocating_shards?: number;
  shards?: { active?: number; relocating?: number; unassigned?: number } | null;
  explanations: Array<{
    index: string;
    shard: number;
    primary: boolean;
    current_state: string;
    unassigned_info?: any;
  }>;
}

interface SystemInsights {
  plugins: PluginInfo[];
  allocation: AllocationInfo | null;
  pendingTasks: any[];
  threadPools: any;
  repositories: any[];
  segmentInfo: any[];
}

interface ClusterAnalysis {
  health: {
    status: "green" | "yellow" | "red";
    score: number;
    issues: string[];
    recommendations: string[];
  };
  performance: {
    overall: number;
    metrics: Array<{
      name: string;
      current: number;
      threshold: number;
      unit: string;
      status: "good" | "warning" | "critical";
      description: string;
    }>;
  };
  configuration: {
    checks: Array<{
      category: string;
      name: string;
      status: "pass" | "warning" | "fail";
      current: string;
      recommended: string;
      impact: "low" | "medium" | "high";
    }>;
  };
  sizing: {
    current: {
      nodes: number;
      totalStorage: string;
      cpuCores: number;
      dataIngestionRate: string;
      searchRate: string;
    };
    recommendations: Array<{
      category: string;
      priority: "low" | "medium" | "high";
      current: string;
      recommended: string;
      reasoning: string;
    }>;
  };
}

export default function ClusterAnalysisPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ClusterAnalysis | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [systemInsights, setSystemInsights] = useState<SystemInsights | null>(null);
  const { isConnected, connectionConfig } = useConnection();
  const router = useRouter();

  // Helper functions
  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pass':
      case 'good':
      case 'green':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'warning':
      case 'yellow':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case 'fail':
      case 'critical':
      case 'red':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Info className="h-4 w-4 text-info" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pass':
      case 'good':
      case 'green':
        return 'text-success';
      case 'warning':
      case 'yellow':
        return 'text-warning';
      case 'fail':
      case 'critical':
      case 'red':
        return 'text-destructive';
      default:
        return 'text-info';
    }
  };

  // Function to infer templates from index names when API access is limited
  const inferTemplatesFromIndicesNames = (indices: any[]): TemplateInfo[] => {
    const inferredTemplates: TemplateInfo[] = [];
    const patterns = new Map<string, string[]>();

    // Common patterns to detect
    const commonPatterns = [
      { pattern: /^(.*)-\d{4}\.\d{2}\.\d{2}$/, name: (match: string) => `${match}-daily` },
      { pattern: /^(.*)-\d{4}\.\d{2}$/, name: (match: string) => `${match}-monthly` },
      { pattern: /^(.*)-\d{4}$/, name: (match: string) => `${match}-yearly` },
      { pattern: /^(.*)-\d+$/, name: (match: string) => `${match}-indexed` },
      { pattern: /^(wazuh|elastic|kibana|logstash|beats)/, name: (match: string) => `${match}-template` },
      { pattern: /^(.+)-alerts?-/, name: (match: string) => `${match}-alerts-template` },
      { pattern: /^(.+)-logs?-/, name: (match: string) => `${match}-logs-template` },
      { pattern: /^(.+)-metrics?-/, name: (match: string) => `${match}-metrics-template` }
    ];

    indices.forEach(index => {
      const indexName = typeof index === 'string' ? index : index.index;
      
      for (const { pattern, name } of commonPatterns) {
        const match = indexName.match(pattern);
        if (match) {
          const basePattern = match[1];
          const templateName = name(basePattern);
          
          if (!patterns.has(templateName)) {
            patterns.set(templateName, []);
          }
          patterns.get(templateName)!.push(indexName);
          break;
        }
      }
    });

    // Convert patterns to template info
    patterns.forEach((matchedIndices, templateName) => {
      const basePattern = templateName.replace(/-template$/, '').replace(/-daily$/, '').replace(/-monthly$/, '').replace(/-yearly$/, '').replace(/-indexed$/, '').replace(/-alerts-template$/, '').replace(/-logs-template$/, '').replace(/-metrics-template$/, '');
      
      inferredTemplates.push({
        name: templateName,
        index_patterns: [`${basePattern}-*`],
        priority: templateName.includes('wazuh') ? 100 : 50,
        settings: { inferred: true },
        mappings: { inferred: true },
        aliases: {},
        lifecycle: templateName.includes('daily') || templateName.includes('monthly') ? { inferred: true } : undefined
      });
    });

    return inferredTemplates;
  };

  const fetchTemplates = async (_client: any): Promise<TemplateInfo[]> => {
    const templates: TemplateInfo[] = [];
    
    try {
      // Try modern index templates first
      try {
        const indexTemplatesResponse = await fetch('/api/es-proxy/_index_template', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (indexTemplatesResponse.ok) {
          const data = await indexTemplatesResponse.json();
          if (data.index_templates) {
            data.index_templates.forEach((template: any) => {
              templates.push({
                name: template.name,
                index_patterns: template.index_template?.index_patterns || [],
                priority: template.index_template?.priority || 0,
                settings: template.index_template?.template?.settings || {},
                mappings: template.index_template?.template?.mappings || {},
                aliases: template.index_template?.template?.aliases || {},
                lifecycle: template.index_template?.template?.lifecycle
              });
            });
          }
        }
      } catch (error) {
        console.warn('Modern index templates API failed:', error);
      }

      // Try legacy templates
      try {
        const legacyTemplatesResponse = await fetch('/api/es-proxy/_template', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (legacyTemplatesResponse.ok) {
          const data = await legacyTemplatesResponse.json();
          Object.entries(data).forEach(([name, template]: [string, any]) => {
            templates.push({
              name,
              index_patterns: template.index_patterns || template.template ? [template.template] : [],
              priority: template.order || 0,
              settings: template.settings || {},
              mappings: template.mappings || {},
              aliases: template.aliases || {}
            });
          });
        }
      } catch (error) {
        console.warn('Legacy templates API failed:', error);
      }

      // Try component templates
      try {
        const componentTemplatesResponse = await fetch('/api/es-proxy/_component_template', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (componentTemplatesResponse.ok) {
          const data = await componentTemplatesResponse.json();
          if (data.component_templates) {
            data.component_templates.forEach((template: any) => {
              templates.push({
                name: `${template.name} (component)`,
                index_patterns: ['*'],
                priority: 0,
                settings: template.component_template?.template?.settings || {},
                mappings: template.component_template?.template?.mappings || {},
                aliases: template.component_template?.template?.aliases || {}
              });
            });
          }
        }
      } catch (error) {
        console.warn('Component templates API failed:', error);
      }

    } catch (error) {
      console.error('All template APIs failed:', error);
    }

    return templates;
  };

  const fetchSystemInsights = async (client: any): Promise<SystemInsights> => {
    const insights: SystemInsights = {
      plugins: [],
      allocation: null,
      pendingTasks: [],
      threadPools: null,
      repositories: [],
      segmentInfo: []
    };

    try {
      // Fetch plugins information
      const pluginsData = await client.getInstalledPlugins();
      if (pluginsData?.nodes) {
        const allPlugins: PluginInfo[] = [];
        Object.entries(pluginsData.nodes).forEach(([nodeId, nodeData]: [string, any]) => {
          if (nodeData.plugins) {
            nodeData.plugins.forEach((plugin: any) => {
              allPlugins.push({
                name: plugin.name,
                version: plugin.version,
                description: plugin.description,
                type: plugin.type || 'unknown',
                node: nodeData.name || nodeId
              });
            });
          }
        });
        insights.plugins = allPlugins;
      }

      // Fetch allocation information
      try {
        const allocation = await client.getClusterAllocation();
        if (allocation) {
          insights.allocation = allocation;
        }
      } catch (error) {
        console.warn('Allocation API not available:', error);
      }

      // Fetch pending tasks
      try {
        const pendingTasks = await client.getClusterPendingTasks();
        if (pendingTasks?.tasks) {
          insights.pendingTasks = pendingTasks.tasks;
        }
      } catch (error) {
        console.warn('Pending tasks API not available:', error);
      }

      // Fetch thread pool stats
      try {
        const threadPoolStats = await client.getThreadPoolStats();
        if (threadPoolStats) {
          insights.threadPools = threadPoolStats;
        }
      } catch (error) {
        console.warn('Thread pool stats not available:', error);
      }

      // Fetch repositories
      try {
        const repositories = await client.getRepositories();
        if (repositories) {
          insights.repositories = Object.entries(repositories).map(([name, repo]: [string, any]) => ({
            name,
            type: repo.type,
            settings: repo.settings
          }));
        }
      } catch (error) {
        console.warn('Repositories API not available:', error);
      }

      // Fetch segment information
      try {
        const segments = await client.getSegmentInfo();
        if (segments) {
          insights.segmentInfo = segments;
        }
      } catch (error) {
        console.warn('Segment info not available:', error);
      }

    } catch (error) {
      console.warn('Error fetching system insights:', error);
    }

    return insights;
  };

  const runClusterAnalysis = async () => {
    if (!connectionConfig) {
      setError("No Elasticsearch connection configured");
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const client = getElasticsearchClient();
      if (!client) {
        throw new Error('No Elasticsearch client available');
      }

      // Fetch basic cluster info using client methods (like overview page)
      const health = await client.getClusterHealth();
      const stats = await client.getClusterStats();
      
      // Try to get indices, but don't fail if it doesn't work
      let indices = [];
      try {
        indices = await client.catIndices() || [];
      } catch (indicesError) {
        console.warn('Could not fetch indices:', indicesError);
        // Continue without indices data
      }

      // Fetch templates with fallback (make it more resilient)
      let allTemplates: TemplateInfo[] = [];
      try {
        allTemplates = await fetchTemplates(client);
      } catch (templateError) {
        console.warn('Could not fetch templates via API, trying inference:', templateError);
      }
      
      // If no templates found via API, try to infer from index names
      if (allTemplates.length === 0 && indices.length > 0) {
        console.log('No templates found via API, inferring from index patterns...');
        allTemplates = inferTemplatesFromIndicesNames(indices);
      }

      setTemplates(allTemplates);

      // Calculate performance metrics with fallback
      const calculatePerformanceMetrics = () => {
        const metrics = [];
        
        // CPU Usage (if available)
        if (stats.nodes?.process?.cpu?.percent !== undefined) {
          metrics.push({
            name: 'CPU Usage',
            current: stats.nodes.process.cpu.percent,
            threshold: 80,
            unit: '%',
            status: (stats.nodes.process.cpu.percent > 80 ? 'critical' : stats.nodes.process.cpu.percent > 60 ? 'warning' : 'good') as 'good' | 'warning' | 'critical',
            description: 'Average CPU usage across all nodes'
          });
        } else {
          // Fallback based on cluster load
          const estimatedCpu = Math.min(95, Math.max(10, (stats.indices?.docs?.count || 1000) / 10000 * 30));
          metrics.push({
            name: 'CPU Usage (estimated)',
            current: estimatedCpu,
            threshold: 80,
            unit: '%',
            status: (estimatedCpu > 80 ? 'critical' : estimatedCpu > 60 ? 'warning' : 'good') as 'good' | 'warning' | 'critical',
            description: 'Estimated CPU usage based on document count'
          });
        }

        // Memory Usage
        if (stats.nodes?.jvm?.mem?.heap_used_percent !== undefined) {
          metrics.push({
            name: 'Memory Usage',
            current: stats.nodes.jvm.mem.heap_used_percent,
            threshold: 85,
            unit: '%',
            status: (stats.nodes.jvm.mem.heap_used_percent > 85 ? 'critical' : stats.nodes.jvm.mem.heap_used_percent > 70 ? 'warning' : 'good') as 'good' | 'warning' | 'critical',
            description: 'JVM heap memory usage'
          });
        } else {
          // Fallback memory calculation
          const estimatedMemory = Math.min(90, Math.max(20, (indices.length * 2) + 30));
          metrics.push({
            name: 'Memory Usage (estimated)',
            current: estimatedMemory,
            threshold: 85,
            unit: '%',
            status: (estimatedMemory > 85 ? 'critical' : estimatedMemory > 70 ? 'warning' : 'good') as 'good' | 'warning' | 'critical',
            description: 'Estimated memory usage based on index count'
          });
        }

        // Disk Usage
        const totalStoreSize = stats.indices?.store?.size_in_bytes || 0;
        if (totalStoreSize > 0) {
          // Estimate disk usage (assuming 70% of total disk is data)
          const estimatedDiskUsage = Math.min(95, (totalStoreSize / (1024 * 1024 * 1024 * 100)) * 100); // Assume 100GB total
          metrics.push({
            name: 'Disk Usage',
            current: estimatedDiskUsage,
            threshold: 90,
            unit: '%',
            status: (estimatedDiskUsage > 90 ? 'critical' : estimatedDiskUsage > 75 ? 'warning' : 'good') as 'good' | 'warning' | 'critical',
            description: 'Estimated disk space usage'
          });
        }

        return metrics;
      };

      const performanceMetrics = calculatePerformanceMetrics();
      const overallPerformance = performanceMetrics.length > 0 
        ? Math.round(performanceMetrics.reduce((acc, metric) => {
            const score = metric.status === 'good' ? 100 : metric.status === 'warning' ? 70 : 30;
            return acc + score;
          }, 0) / performanceMetrics.length)
        : 75; // Default fallback

      // Health scoring
      let healthScore = 100;
      const issues: string[] = [];
      const recommendations: string[] = [];

      if (health.status === 'red') {
        healthScore -= 40;
        issues.push('Cluster status is RED - some data is unavailable');
      } else if (health.status === 'yellow') {
        healthScore -= 20;
        issues.push('Cluster status is YELLOW - some replicas are unassigned');
      }

      if (health.unassigned_shards > 0) {
        healthScore -= 10;
        issues.push(`${health.unassigned_shards} unassigned shards detected`);
        recommendations.push('Investigate unassigned shards and consider adding nodes or adjusting replica settings');
      }

      if (indices.length > 1000) {
        healthScore -= 5;
        issues.push('Large number of indices may impact performance');
        recommendations.push('Consider using index lifecycle management (ILM) to manage index rollover');
      }

      // Configuration checks
      const configChecks = [
        {
          category: 'Cluster',
          name: 'Node Count',
          status: (stats.nodes?.count?.total >= 3 ? 'pass' : stats.nodes?.count?.total >= 2 ? 'warning' : 'fail') as 'pass' | 'warning' | 'fail',
          current: stats.nodes?.count?.total?.toString() || 'Unknown',
          recommended: '3+',
          impact: 'high' as const
        },
        {
          category: 'Indices',
          name: 'Replica Configuration',
          status: (health.unassigned_shards === 0 ? 'pass' : 'warning') as 'pass' | 'warning' | 'fail',
          current: health.unassigned_shards === 0 ? 'All replicas assigned' : `${health.unassigned_shards} unassigned`,
          recommended: 'All replicas assigned',
          impact: 'medium' as const
        },
        {
          category: 'Templates',
          name: 'Index Templates',
          status: (allTemplates.length > 0 ? 'pass' : 'warning') as 'pass' | 'warning' | 'fail',
          current: `${allTemplates.length} templates`,
          recommended: '1+ template for data patterns',
          impact: 'low' as const
        }
      ];

      // Sizing analysis
      const currentSizing = {
        nodes: stats.nodes?.count?.total || 1,
        totalStorage: stats.indices?.store?.size_in_bytes 
          ? `${(stats.indices.store.size_in_bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
          : 'Unknown',
        cpuCores: stats.nodes?.process?.cpu?.total_cores || 'Unknown',
        dataIngestionRate: `${Math.round((stats.indices?.indexing?.index_total || 0) / 3600)} docs/hour`,
        searchRate: `${Math.round((stats.indices?.search?.query_total || 0) / 3600)} queries/hour`
      };

      const sizingRecommendations = [];
      
      if (stats.nodes?.count?.total < 3) {
        sizingRecommendations.push({
          category: 'High Availability',
          priority: 'high' as const,
          current: `${stats.nodes?.count?.total || 1} node(s)`,
          recommended: '3+ nodes',
          reasoning: 'Minimum 3 nodes recommended for high availability and fault tolerance'
        });
      }

      if (health.unassigned_shards > 0) {
        sizingRecommendations.push({
          category: 'Shard Distribution',
          priority: 'medium' as const,
          current: `${health.unassigned_shards} unassigned shards`,
          recommended: 'All shards assigned',
          reasoning: 'Add more nodes or reduce replica count to ensure all shards are assigned'
        });
      }

      const analysis: ClusterAnalysis = {
        health: {
          status: health.status,
          score: Math.max(0, healthScore),
          issues,
          recommendations
        },
        performance: {
          overall: overallPerformance,
          metrics: performanceMetrics
        },
        configuration: {
          checks: configChecks
        },
        sizing: {
          current: currentSizing,
          recommendations: sizingRecommendations
        }
      };

      setAnalysis(analysis);

      // Fetch system insights for enhanced visibility (non-blocking)
      try {
        const insights = await fetchSystemInsights(client);
        setSystemInsights(insights);
      } catch (insightsError) {
        console.warn('Could not fetch system insights:', insightsError);
        // Don't fail the entire analysis if insights fail
      }

    } catch (error) {
      console.error('Error running cluster analysis:', error);
      setError(error instanceof Error ? error.message : 'Failed to analyze cluster');
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    // The connection is restored asynchronously after a reload: show an empty
    // state while disconnected instead of redirecting away.
    setIsLoading(false);
  }, [isConnected, connectionConfig]);

  // runClusterAnalysis is recreated every render and calls many plain helpers;
  // call the latest version through a ref so the effect only fires on these triggers.
  const runClusterAnalysisRef = useRef(runClusterAnalysis);
  runClusterAnalysisRef.current = runClusterAnalysis;

  useEffect(() => {
    if (!isLoading && isConnected && connectionConfig) {
      runClusterAnalysisRef.current();
    }
  }, [isLoading, isConnected, connectionConfig]);

  const header = (
    <PageHeader
      title="Cluster analysis"
      description="Scores health, performance, configuration and sizing against Elasticsearch / OpenSearch best practices."
      meta={analysis ? <HealthBadge status={analysis.health.status} /> : undefined}
      actions={
        <Button size="sm" onClick={runClusterAnalysis} disabled={isAnalyzing || !isConnected}>
          {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {isAnalyzing ? "Analyzing…" : "Run analysis"}
        </Button>
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <StatGrid>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
        </StatGrid>
      </div>
    );
  }

  if (!isConnected || !connectionConfig) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to analyze it."
          action={<Button size="sm" onClick={() => router.push('/connections')}>Go to connections</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {analysis ? (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="configuration">Configuration</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="sizing">Sizing</TabsTrigger>
            <TabsTrigger value="plugins">Plugins</TabsTrigger>
            <TabsTrigger value="insights">System insights</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <StatGrid>
              <StatCard
                label="Health score"
                icon={Database}
                value={`${analysis.health.score}%`}
                tone={analysis.health.status === 'red' ? 'danger' : analysis.health.status === 'yellow' ? 'warning' : 'default'}
                hint={<span className="inline-flex items-center gap-1.5"><StatusDot status={analysis.health.status} />Cluster is {analysis.health.status}</span>}
              />
              <StatCard
                label="Performance"
                icon={TrendingUp}
                value={`${analysis.performance.overall}%`}
                hint={<Progress value={analysis.performance.overall} className="mt-1 h-1.5" />}
              />
              <StatCard
                label="Configuration checks"
                icon={Settings}
                value={`${analysis.configuration.checks.filter(c => c.status === 'pass').length} / ${analysis.configuration.checks.length}`}
                hint="checks passed"
              />
              <StatCard label="Index templates" icon={FileText} value={templates.length} hint="configured" />
            </StatGrid>

            {/* Quick Issues */}
            {analysis.health.issues.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Issues detected</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {analysis.health.issues.map((issue, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Quick Recommendations */}
            {analysis.health.recommendations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recommendations</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {analysis.health.recommendations.map((rec, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <Target className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="templates" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Index templates</CardTitle>
                <CardDescription>Templates define settings, mappings and aliases for index patterns.</CardDescription>
              </CardHeader>
              <CardContent>
                {templates.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No index templates found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto"><Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Template</TableHead>
                        <TableHead>Index patterns</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Features</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templates.map((template, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{template.name}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {template.index_patterns.map((pattern, i) => (
                                <Badge key={i} variant="outline">{pattern}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>{template.priority}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {Object.keys(template.settings).length > 0 && (
                                <Badge variant="secondary">Settings</Badge>
                              )}
                              {Object.keys(template.mappings).length > 0 && (
                                <Badge variant="secondary">Mappings</Badge>
                              )}
                              {Object.keys(template.aliases).length > 0 && (
                                <Badge variant="secondary">Aliases</Badge>
                              )}
                              {template.lifecycle && (
                                <Badge variant="secondary">ILM</Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table></div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="configuration" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration</CardTitle>
                <CardDescription>Cluster configuration evaluated against best practices.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Check</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Current</TableHead>
                      <TableHead>Recommended</TableHead>
                      <TableHead>Impact</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.configuration.checks.map((check, index) => (
                      <TableRow key={index}>
                        <TableCell>{check.category}</TableCell>
                        <TableCell>{check.name}</TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            {getStatusIcon(check.status)}
                            <span className={`ml-2 ${getStatusColor(check.status)}`}>
                              {check.status.charAt(0).toUpperCase() + check.status.slice(1)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{check.current}</TableCell>
                        <TableCell>{check.recommended}</TableCell>
                        <TableCell>
                          <SeverityBadge level={check.impact} className="capitalize">{check.impact}</SeverityBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Performance</CardTitle>
                <CardDescription>Current indicators compared with recommended thresholds.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead>Current</TableHead>
                      <TableHead>Threshold</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.performance.metrics.map((metric, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{metric.name}</TableCell>
                        <TableCell>{metric.current.toLocaleString()} {metric.unit}</TableCell>
                        <TableCell>{metric.threshold.toLocaleString()} {metric.unit}</TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            {getStatusIcon(metric.status)}
                            <span className={`ml-2 ${getStatusColor(metric.status)}`}>
                              {metric.status.charAt(0).toUpperCase() + metric.status.slice(1)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {metric.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sizing" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Current sizing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center">
                      <Server className="h-4 w-4 mr-2 text-muted-foreground" />
                      Nodes
                    </span>
                    <span className="font-medium">{analysis.sizing.current.nodes}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center">
                      <HardDrive className="h-4 w-4 mr-2 text-muted-foreground" />
                      Storage
                    </span>
                    <span className="font-medium">{analysis.sizing.current.totalStorage}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center">
                      <Cpu className="h-4 w-4 mr-2 text-muted-foreground" />
                      CPU cores
                    </span>
                    <span className="font-medium">{analysis.sizing.current.cpuCores}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center">
                      <BarChart3 className="h-4 w-4 mr-2 text-muted-foreground" />
                      Data ingestion
                    </span>
                    <span className="font-medium">{analysis.sizing.current.dataIngestionRate}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center">
                      <Zap className="h-4 w-4 mr-2 text-muted-foreground" />
                      Search rate
                    </span>
                    <span className="font-medium">{analysis.sizing.current.searchRate}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sizing recommendations</CardTitle>
                </CardHeader>
                <CardContent>
                  {analysis.sizing.recommendations.length === 0 ? (
                    <div className="text-center py-8">
                      <CheckCircle className="h-8 w-8 mx-auto mb-2 text-success" />
                      <p className="text-sm text-muted-foreground">
                        No sizing changes recommended.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {analysis.sizing.recommendations.map((rec, index) => (
                        <div key={index} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium">{rec.category}</h4>
                            <SeverityBadge level={rec.priority}>{rec.priority} priority</SeverityBadge>
                          </div>
                          <div className="text-sm space-y-1">
                            <div><strong>Current:</strong> {rec.current}</div>
                            <div><strong>Recommended:</strong> {rec.recommended}</div>
                            <div className="text-muted-foreground">{rec.reasoning}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="plugins" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Installed plugins</CardTitle>
              </CardHeader>
              <CardContent>
                {systemInsights && systemInsights.plugins.length > 0 ? (
                  <div className="space-y-4">
                    {systemInsights.plugins.map((plugin, index) => (
                      <div key={index} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium">{plugin.name}</h4>
                          <Badge variant="secondary">{plugin.version}</Badge>
                        </div>
                        <div className="text-sm space-y-1">
                          <div><strong>Type:</strong> {plugin.type}</div>
                          {plugin.description && (
                            <div className="text-muted-foreground">{plugin.description}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Settings className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No plugin information available.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="insights" className="space-y-6">
            {systemInsights ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Shard allocation</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {systemInsights.allocation?.shards && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Active shards</span>
                        <span className="font-medium">{systemInsights.allocation?.shards?.active || 'N/A'}</span>
                      </div>
                    )}
                    {systemInsights.allocation?.relocating_shards !== undefined && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Relocating shards</span>
                        <span className="font-medium">{systemInsights.allocation?.relocating_shards}</span>
                      </div>
                    )}
                    {systemInsights.allocation?.unassigned_shards !== undefined && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Unassigned shards</span>
                        <span className="font-medium">{systemInsights.allocation?.unassigned_shards}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Thread pools</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {Object.entries(systemInsights.threadPools as Record<string, Record<string, number>>).map(([name, stats]) => (
                      <div key={name} className="border rounded-lg p-3">
                        <div className="font-medium mb-2">{name}</div>
                        <div className="text-sm space-y-1">
                          <div className="flex justify-between">
                            <span>Queue:</span>
                            <span>{stats.queue || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Active:</span>
                            <span>{stats.active || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Rejected:</span>
                            <span>{stats.rejected || 0}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {systemInsights.repositories.length > 0 && (
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-base">Snapshot repositories</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {systemInsights.repositories.map((repo, index) => (
                          <div key={index} className="border rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-medium">{repo.name}</h4>
                              <Badge variant="outline">{repo.type}</Badge>
                            </div>
                            {repo.settings && Object.keys(repo.settings).length > 0 && (
                              <div className="text-sm">
                                <strong>Settings:</strong>
                                <pre className="mt-1 text-xs bg-muted p-2 rounded">
                                  {JSON.stringify(repo.settings, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <BarChart3 className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  System insights are not available.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
