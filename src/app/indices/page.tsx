"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { EmptyState, HealthBadge, PageHeader, StatCard, StatGrid } from "@/components/app";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  AlertCircle,
  BarChart3,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

interface IndexDetails {
  index: string;
  health: "green" | "yellow" | "red";
  status: "open" | "close";
  uuid: string;
  pri: string; // primary shards
  rep: string; // replica shards
  "docs.count": string;
  "docs.deleted": string;
  "store.size": string;
  "pri.store.size": string;
}

// Template reliability evaluation functions
const evaluateTemplateReliability = (template: any, _index: IndexDetails): string => {
  let score = 0;
  let maxScore = 0;

  // Check if template has proper settings
  maxScore += 3;
  if (template.settings && Object.keys(template.settings).length > 0) {
    score += 2;
    // Bonus for important settings
    if (template.settings.number_of_shards || template.settings.number_of_replicas) score += 1;
  }

  // Check if template has mappings
  maxScore += 3;
  if (template.mappings && Object.keys(template.mappings).length > 0) {
    score += 2;
    // Bonus for detailed mappings
    if (template.mappings.properties && Object.keys(template.mappings.properties).length > 5) score += 1;
  }

  // Check template type (newer is generally better)
  maxScore += 2;
  if (template.type === 'index_template') {
    score += 2; // Composable templates are newest
  } else if (template.type === 'legacy_template') {
    score += 1; // Legacy templates are older but still functional
  }

  // Check for lifecycle management
  maxScore += 1;
  if (template.settings && (template.settings['index.lifecycle.name'] || template.settings['index.lifecycle.policy'])) {
    score += 1;
  }

  // Check for specific patterns that indicate well-designed templates
  maxScore += 1;
  const templateName = template.name.toLowerCase();
  if (templateName.includes('wazuh') || templateName.includes('elastic') || templateName.includes('beats') || templateName.includes('logstash')) {
    score += 1; // Well-known template types
  }

  const percentage = (score / maxScore) * 100;
  
  if (percentage >= 80) return 'excellent';
  if (percentage >= 60) return 'good';
  if (percentage >= 40) return 'fair';
  return 'poor';
};

const getReliabilityScore = (reliability: string): number => {
  switch (reliability) {
    case 'excellent': return 4;
    case 'good': return 3;
    case 'fair': return 2;
    case 'poor': return 1;
    default: return 0;
  }
};

const getReliabilityColor = (reliability: string): string => {
  switch (reliability) {
    case 'excellent': return 'text-success';
    case 'good': return 'text-foreground';
    case 'fair': return 'text-warning';
    case 'poor': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
};

// Infer templates from index naming patterns when APIs fail
const inferTemplatesFromIndices = (indices: IndexDetails[]): any[] => {
  const templates: any[] = [];
  const patternGroups: { [key: string]: string[] } = {};
  
  // Group indices by common patterns
  indices.forEach(index => {
    const indexName = index.index;
    
    // Common patterns to detect
    const patterns = [
      // Wazuh patterns
      { pattern: 'wazuh-alerts-*', name: 'wazuh-alerts-template', type: 'inferred_legacy' },
      { pattern: 'wazuh-monitoring-*', name: 'wazuh-monitoring-template', type: 'inferred_legacy' },
      { pattern: 'wazuh-statistics-*', name: 'wazuh-statistics-template', type: 'inferred_legacy' },
      
      // Common ELK patterns
      { pattern: 'logstash-*', name: 'logstash-template', type: 'inferred_legacy' },
      { pattern: 'filebeat-*', name: 'filebeat-template', type: 'inferred_legacy' },
      { pattern: 'metricbeat-*', name: 'metricbeat-template', type: 'inferred_legacy' },
      { pattern: 'packetbeat-*', name: 'packetbeat-template', type: 'inferred_legacy' },
      
      // Date-based patterns
      { pattern: '*-{date}', name: 'time-series-template', type: 'inferred_legacy' },
    ];
    
    patterns.forEach(patternDef => {
      const basePattern = patternDef.pattern.replace('*', '').replace('-{date}', '');
      if (indexName.includes(basePattern)) {
        if (!patternGroups[patternDef.name]) {
          patternGroups[patternDef.name] = [];
          templates.push({
            name: patternDef.name,
            type: patternDef.type,
            patterns: [patternDef.pattern],
            priority: 100,
            settings: {
              // Infer basic settings based on pattern
              number_of_shards: indexName.includes('wazuh') ? 3 : 1,
              number_of_replicas: 1,
              'index.lifecycle.name': indexName.includes('alerts') ? 'alerts-policy' : undefined
            },
            mappings: {
              properties: {
                // Basic mapping inference
                '@timestamp': { type: 'date' },
                'message': { type: 'text' },
                'level': { type: 'keyword' }
              }
            }
          });
        }
        patternGroups[patternDef.name].push(indexName);
      }
    });
  });
  
  return templates;
};

export default function IndicesPage() {
  const { isConnected } = useConnection();
  const [indices, setIndices] = useState<IndexDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<IndexDetails | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [indexSettings, setIndexSettings] = useState<any>(null);
  const [indexMappings, setIndexMappings] = useState<any>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  
  // Template information
  const [, setTemplates] = useState<any[]>([]);
  const [indexTemplateMap, setIndexTemplateMap] = useState<{[key: string]: Array<{name: string, type: string, reliability: string, score: number}>}>({});

  // Load indices from Elasticsearch/OpenSearch
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
      const [indicesResponse, ...templateResponses] = await Promise.all([
        client.catIndices(),
        // Check multiple template types
        fetch('/api/es-proxy/_index_template').catch(() => null), // Composable index templates
        fetch('/api/es-proxy/_template').catch(() => null),       // Legacy templates
        fetch('/api/es-proxy/_component_template').catch(() => null) // Component templates
      ]);
      
      setIndices(indicesResponse || []);
      
      // Combine all template types
      let allTemplates: any[] = [];
      let templatesLoadFailed = true;
      
      // Process composable index templates
      if (templateResponses[0] && templateResponses[0].ok) {
        templatesLoadFailed = false;
        const data = await templateResponses[0].json();
        const templates = (data.index_templates || []).map((t: any) => ({
          ...t,
          type: 'index_template',
          patterns: t.index_template?.index_patterns || [],
          priority: t.index_template?.priority || 0,
          settings: t.index_template?.template?.settings || {},
          mappings: t.index_template?.template?.mappings || {}
        }));
        allTemplates = [...allTemplates, ...templates];
      }
      
      // Process legacy templates
      if (templateResponses[1] && templateResponses[1].ok) {
        templatesLoadFailed = false;
        const data = await templateResponses[1].json();
        const templates = Object.entries(data).map(([name, template]: [string, any]) => ({
          name,
          type: 'legacy_template',
          patterns: template.index_patterns || [],
          priority: template.order || 0,
          settings: template.settings || {},
          mappings: template.mappings || {}
        }));
        allTemplates = [...allTemplates, ...templates];
      }
      
      // Process component templates
      if (templateResponses[2] && templateResponses[2].ok) {
        templatesLoadFailed = false;
        const data = await templateResponses[2].json();
        const templates = (data.component_templates || []).map((t: any) => ({
          ...t,
          type: 'component_template',
          patterns: [], // Component templates don't have patterns directly
          priority: 0,
          settings: t.template?.settings || {},
          mappings: t.template?.mappings || {}
        }));
        allTemplates = [...allTemplates, ...templates];
      }
      
      // If all template APIs failed, infer templates from index patterns
      if (templatesLoadFailed && indicesResponse) {
        console.log('Template APIs failed, inferring templates from index patterns...');
        const inferredTemplates = inferTemplatesFromIndices(indicesResponse);
        allTemplates = [...allTemplates, ...inferredTemplates];
      }
      
      setTemplates(allTemplates);
      
      // Create enhanced index to template mapping with reliability scoring
      const templateMap: {[key: string]: Array<{name: string, type: string, reliability: string, score: number}>} = {};
      if (indicesResponse) {
        indicesResponse.forEach((index: IndexDetails) => {
          const matchingTemplates: Array<{name: string, type: string, reliability: string, score: number}> = [];
          
          allTemplates.forEach((template: any) => {
            const patterns = template.patterns || [];
            patterns.forEach((pattern: string) => {
              // Convert Elasticsearch pattern to regex
              const regexPattern = pattern
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.')
                .replace(/\{[^}]*\}/g, '.*'); // Handle date patterns like {YYYY.MM.DD}
              
              try {
                const regex = new RegExp(`^${regexPattern}$`);
                if (regex.test(index.index)) {
                  const reliability = evaluateTemplateReliability(template, index);
                  const score = getReliabilityScore(reliability);
                  matchingTemplates.push({
                    name: template.name,
                    type: template.type,
                    reliability,
                    score
                  });
                }
              } catch (regexError) {
                // Fallback for invalid regex patterns
                if (pattern === '*' || index.index.includes(pattern.replace('*', ''))) {
                  const reliability = evaluateTemplateReliability(template, index);
                  const score = getReliabilityScore(reliability);
                  matchingTemplates.push({
                    name: template.name,
                    type: template.type,
                    reliability,
                    score
                  });
                }
              }
            });
          });
          
          // Sort by score (highest first) and priority
          matchingTemplates.sort((a, b) => b.score - a.score);
          templateMap[index.index] = matchingTemplates;
        });
      }
      setIndexTemplateMap(templateMap);
    } catch (err: any) {
      setError(`Failed to load indices: ${err.message}`);
      console.error('Error loading indices:', err);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  // Load detailed index information
  const loadIndexDetails = async (indexName: string) => {
    const client = getElasticsearchClient();
    if (!client) return;

    try {
      const response = await client.getIndex(indexName);
      setIndexSettings(response[indexName]?.settings || {});
      setIndexMappings(response[indexName]?.mappings || {});
    } catch (err: any) {
      console.error('Error loading index details:', err);
    }
  };

  // Load indices on mount and when connection changes
  useEffect(() => {
    if (isConnected) {
      loadIndices();
    } else {
      setIndices([]);
      setSelectedIndex(null);
    }
  }, [isConnected, loadIndices]);

  const filteredIndices = indices.filter(index =>
    index.index.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate pagination
  const totalItems = filteredIndices.length;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedIndices = filteredIndices.slice(startIndex, endIndex);
  
  // Update total pages when filtered data changes
  useEffect(() => {
    const pages = Math.ceil(totalItems / itemsPerPage);
    setTotalPages(pages);
    
    // Reset to first page if current page is beyond total pages
    if (currentPage > pages && pages > 0) {
      setCurrentPage(1);
    }
  }, [totalItems, itemsPerPage, currentPage]);

  // Pagination functions
  const goToFirstPage = () => setCurrentPage(1);
  const goToPreviousPage = () => setCurrentPage(Math.max(1, currentPage - 1));
  const goToNextPage = () => setCurrentPage(Math.min(totalPages, currentPage + 1));
  const goToLastPage = () => setCurrentPage(totalPages);
  const goToPage = (page: number) => setCurrentPage(Math.max(1, Math.min(totalPages, page)));

  // Calculate statistics
  const totalDocuments = indices.reduce((acc, idx) => {
    const docCount = parseInt(idx["docs.count"] || "0");
    return acc + (isNaN(docCount) ? 0 : docCount);
  }, 0);
  
  const healthyIndices = indices.filter(idx => idx.health === "green").length;

  const formatBytes = (bytes: string) => {
    if (!bytes || bytes === "0b") return "0 B";
    return bytes;
  };

  const formatNumber = (num: string) => {
    const parsed = parseInt(num || "0");
    if (isNaN(parsed)) return "0";
    return parsed.toLocaleString();
  };

  const handleRowClick = (index: IndexDetails) => {
    setSelectedIndex(index);
    loadIndexDetails(index.index);
  };

  const avgPrimaries = indices.length > 0 ? Math.round(indices.reduce((acc, idx) => acc + parseInt(idx.pri || "0"), 0) / indices.length) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indices"
        description="Health, size and shard layout of every index. Select an index for its settings and mappings."
        actions={
          <Button size="sm" variant="outline" onClick={loadIndices} disabled={!isConnected || loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        }
      />

      {!isConnected && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to browse its indices."
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
        <StatGrid>
          <StatCard label="Indices" icon={Database} value={indices.length.toLocaleString()} />
          <StatCard label="Documents" icon={FileText} value={totalDocuments.toLocaleString()} />
          <StatCard
            label="Healthy indices"
            icon={CheckCircle}
            value={healthyIndices.toLocaleString()}
            hint={indices.length ? `${indices.length - healthyIndices} yellow or red` : undefined}
            tone={indices.length && healthyIndices < indices.length ? "warning" : "default"}
          />
          <StatCard label="Average primaries" icon={BarChart3} value={avgPrimaries} hint="primary shards per index" />
        </StatGrid>
      )}

      {isConnected && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="min-w-0 xl:col-span-2">
            <CardHeader className="space-y-3">
              <CardTitle className="text-base">Indices ({filteredIndices.length})</CardTitle>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filter indices"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1); // Reset to first page when searching
                    }}
                    className="pl-8"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Rows</span>
                  <Select value={itemsPerPage.toString()} onValueChange={(value) => {
                    setItemsPerPage(parseInt(value));
                    setCurrentPage(1); // Reset to first page when changing items per page
                  }}>
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading && indices.length === 0 ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
                </div>
              ) : filteredIndices.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {indices.length ? "No indices match the filter." : "This cluster has no indices."}
                </p>
              ) : (
                <div>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Health</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Documents</TableHead>
                          <TableHead className="text-right">Size</TableHead>
                          <TableHead>Shards</TableHead>
                          <TableHead>Templates</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedIndices.map((index) => (
                          <TableRow
                            key={index.index}
                            className="cursor-pointer"
                            data-state={selectedIndex?.index === index.index ? "selected" : undefined}
                            onClick={() => handleRowClick(index)}
                          >
                            <TableCell className="max-w-[280px] truncate font-medium" title={index.index}>{index.index}</TableCell>
                            <TableCell><HealthBadge status={index.health} /></TableCell>
                            <TableCell className="text-muted-foreground">{index.status}</TableCell>
                            <TableCell className="text-right">{formatNumber(index["docs.count"])}</TableCell>
                            <TableCell className="text-right">{formatBytes(index["store.size"])}</TableCell>
                            <TableCell className="text-muted-foreground">{index.pri}p / {index.rep}r</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {indexTemplateMap[index.index]?.length > 0 ? (
                                  indexTemplateMap[index.index].slice(0, 2).map((template, i) => (
                                    <Badge key={i} variant="outline" className="font-normal" title={`Match: ${template.reliability}`}>
                                      {template.name}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground">None</span>
                                )}
                                {indexTemplateMap[index.index]?.length > 2 && (
                                  <Badge variant="secondary" className="font-normal">
                                    +{indexTemplateMap[index.index].length - 2}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        {startIndex + 1}–{Math.min(endIndex, totalItems)} of {totalItems}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToFirstPage} disabled={currentPage === 1} aria-label="First page">
                          <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToPreviousPage} disabled={currentPage === 1} aria-label="Previous page">
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        {[...Array(Math.min(5, totalPages))].map((_, index) => {
                          let pageNumber;
                          if (totalPages <= 5) {
                            pageNumber = index + 1;
                          } else if (currentPage <= 3) {
                            pageNumber = index + 1;
                          } else if (currentPage >= totalPages - 2) {
                            pageNumber = totalPages - 4 + index;
                          } else {
                            pageNumber = currentPage - 2 + index;
                          }
                          return (
                            <Button
                              key={pageNumber}
                              variant={currentPage === pageNumber ? "default" : "outline"}
                              size="icon"
                              onClick={() => goToPage(pageNumber)}
                              className="h-8 w-8"
                            >
                              {pageNumber}
                            </Button>
                          );
                        })}
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToNextPage} disabled={currentPage === totalPages} aria-label="Next page">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToLastPage} disabled={currentPage === totalPages} aria-label="Last page">
                          <ChevronsRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="min-w-0">
            {selectedIndex ? (
              <Card>
                <CardHeader className="space-y-2">
                  <CardTitle className="break-all text-base">{selectedIndex.index}</CardTitle>
                  <div><HealthBadge status={selectedIndex.health} /></div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="overview">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="settings">Settings</TabsTrigger>
                      <TabsTrigger value="mappings">Mappings</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-6 pt-4">
                      <dl className="grid grid-cols-2 gap-4 text-sm">
                        <Detail label="Documents" value={formatNumber(selectedIndex["docs.count"])} />
                        <Detail label="Size" value={formatBytes(selectedIndex["store.size"])} />
                        <Detail label="Primary shards" value={selectedIndex.pri} />
                        <Detail label="Replica shards" value={selectedIndex.rep} />
                        <Detail label="Status" value={selectedIndex.status} />
                        <div className="col-span-2 space-y-1">
                          <dt className="text-muted-foreground">UUID</dt>
                          <dd className="break-all font-mono text-xs">{selectedIndex.uuid}</dd>
                        </div>
                      </dl>

                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Matching templates</h4>
                        {indexTemplateMap[selectedIndex.index]?.length > 0 ? (
                          <ul className="divide-y rounded-md border">
                            {indexTemplateMap[selectedIndex.index].map((template, i) => (
                              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{template.name}</div>
                                  <div className="text-xs text-muted-foreground">{template.type.replace('_', ' ')}</div>
                                </div>
                                <span className={`text-xs ${getReliabilityColor(template.reliability)}`}>
                                  {template.reliability.charAt(0).toUpperCase() + template.reliability.slice(1)} match
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                            No templates match this index.
                          </p>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="settings" className="pt-4">
                      <pre className="max-h-[480px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                        {JSON.stringify(indexSettings || {}, null, 2)}
                      </pre>
                    </TabsContent>

                    <TabsContent value="mappings" className="pt-4">
                      <pre className="max-h-[480px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                        {JSON.stringify(indexMappings || {}, null, 2)}
                      </pre>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                icon={Database}
                title="No index selected"
                description="Select an index to see its details, settings and mappings."
                className="min-h-64"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
