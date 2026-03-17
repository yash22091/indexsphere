"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { 
  Database,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  BarChart3,
  HardDrive,
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
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
const evaluateTemplateReliability = (template: any, index: IndexDetails): string => {
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
    case 'excellent': return 'text-green-600';
    case 'good': return 'text-blue-600';
    case 'fair': return 'text-yellow-600';
    case 'poor': return 'text-red-600';
    default: return 'text-gray-600';
  }
};

const getReliabilityBadge = (reliability: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (reliability) {
    case 'excellent': return 'default';
    case 'good': return 'secondary';
    case 'fair': return 'outline';
    case 'poor': return 'destructive';
    default: return 'outline';
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
  const [templates, setTemplates] = useState<any[]>([]);
  const [indexTemplateMap, setIndexTemplateMap] = useState<{[key: string]: Array<{name: string, type: string, reliability: string, score: number}>}>({});

  // Load indices from Elasticsearch/OpenSearch
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
  };

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
  }, [isConnected]);

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

  const getStatusIcon = (health: string) => {
    switch (health) {
      case "green":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "yellow":
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case "red":
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

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

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center">
            <Database className="h-6 w-6 sm:h-8 sm:w-8 mr-2 sm:mr-3" />
            Indices
          </h1>
          <p className="text-muted-foreground mt-1 sm:mt-2 text-sm sm:text-base">
            Monitor health and status of your Elasticsearch indices
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:space-x-2">
          <Button 
            onClick={loadIndices} 
            variant="outline"
            disabled={!isConnected || loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Connection Status & Error Messages */}
      {!isConnected && (
        <Alert className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          <Database className="h-4 w-4" />
          <AlertDescription>
            Not connected to cluster. Please connect first to view indices.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Statistics Cards */}
      {isConnected && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <Database className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Indices</p>
                  <p className="text-2xl font-bold">{indices.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <FileText className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Documents</p>
                  <p className="text-2xl font-bold">{totalDocuments.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Healthy Indices</p>
                  <p className="text-2xl font-bold">{healthyIndices}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <BarChart3 className="h-8 w-8 text-purple-500" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg. Shards</p>
                  <p className="text-2xl font-bold">
                    {indices.length > 0 ? Math.round(indices.reduce((acc, idx) => acc + parseInt(idx.pri || "0"), 0) / indices.length) : 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Indices List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Indices ({filteredIndices.length})</CardTitle>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search indices..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1); // Reset to first page when searching
                    }}
                    className="pl-8"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Show:</span>
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
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Loading indices...</span>
                </div>
              ) : filteredIndices.length === 0 ? (
                <div className="text-center py-8">
                  <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {isConnected ? "No indices found" : "Connect to cluster to view indices"}
                  </p>
                </div>
              ) : (
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Health</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Documents</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Shards</TableHead>
                        <TableHead>Templates</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedIndices.map((index) => (
                        <TableRow 
                          key={index.index} 
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleRowClick(index)}
                        >
                          <TableCell className="font-medium">{index.index}</TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-2">
                              {getStatusIcon(index.health)}
                              <Badge 
                                variant={index.health === "green" ? "default" : index.health === "yellow" ? "secondary" : "destructive"}
                              >
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
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {indexTemplateMap[index.index]?.length > 0 ? (
                                indexTemplateMap[index.index].slice(0, 2).map((template, i) => (
                                  <div key={i} className="flex items-center gap-1">
                                    <Badge 
                                      variant={getReliabilityBadge(template.reliability)} 
                                      className={`text-xs ${getReliabilityColor(template.reliability)}`}
                                    >
                                      {template.name}
                                    </Badge>
                                    <span className={`text-xs ${getReliabilityColor(template.reliability)}`}>
                                      ({template.reliability})
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">No templates</span>
                              )}
                              {indexTemplateMap[index.index]?.length > 2 && (
                                <Badge variant="outline" className="text-xs">
                                  +{indexTemplateMap[index.index].length - 2} more
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  
                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t">
                      <div className="text-sm text-muted-foreground">
                        Showing {startIndex + 1} to {Math.min(endIndex, totalItems)} of {totalItems} indices
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={goToFirstPage}
                          disabled={currentPage === 1}
                        >
                          <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={goToPreviousPage}
                          disabled={currentPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        
                        <div className="flex items-center space-x-1">
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
                                size="sm"
                                onClick={() => goToPage(pageNumber)}
                                className="w-8 h-8 p-0"
                              >
                                {pageNumber}
                              </Button>
                            );
                          })}
                        </div>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={goToNextPage}
                          disabled={currentPage === totalPages}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={goToLastPage}
                          disabled={currentPage === totalPages}
                        >
                          <ChevronsRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Index Details */}
        <div className="lg:col-span-1">
          {selectedIndex ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  {selectedIndex.index}
                  <Badge className="ml-2" variant={selectedIndex.health === "green" ? "default" : "destructive"}>
                    {selectedIndex.health}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="overview">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                    <TabsTrigger value="mappings">Mappings</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Documents</Label>
                        <p className="text-sm font-medium mt-1">{formatNumber(selectedIndex["docs.count"])}</p>
                      </div>
                      <div>
                        <Label>Size</Label>
                        <p className="text-sm font-medium mt-1">{formatBytes(selectedIndex["store.size"])}</p>
                      </div>
                      <div>
                        <Label>Primary Shards</Label>
                        <p className="text-sm font-medium mt-1">{selectedIndex.pri}</p>
                      </div>
                      <div>
                        <Label>Replica Shards</Label>
                        <p className="text-sm font-medium mt-1">{selectedIndex.rep}</p>
                      </div>
                      <div>
                        <Label>Status</Label>
                        <p className="text-sm font-medium mt-1">{selectedIndex.status}</p>
                      </div>
                      <div>
                        <Label>UUID</Label>
                        <p className="text-xs font-mono mt-1 break-all">{selectedIndex.uuid}</p>
                      </div>
                    </div>
                    
                    {/* Templates Section */}
                    <div className="mt-6">
                      <Label>Applied Templates</Label>
                      <div className="mt-2 space-y-2">
                        {indexTemplateMap[selectedIndex.index]?.length > 0 ? (
                          indexTemplateMap[selectedIndex.index].map((template, i) => (
                            <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                              <div className="flex items-center gap-3">
                                <Badge 
                                  variant={getReliabilityBadge(template.reliability)}
                                  className={getReliabilityColor(template.reliability)}
                                >
                                  {template.name}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {template.type.replace('_', ' ')}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${getReliabilityColor(template.reliability)}`}>
                                  {template.reliability.charAt(0).toUpperCase() + template.reliability.slice(1)}
                                </span>
                                <div className="flex">
                                  {[...Array(4)].map((_, starIndex) => (
                                    <span
                                      key={starIndex}
                                      className={`text-sm ${
                                        starIndex < template.score
                                          ? getReliabilityColor(template.reliability)
                                          : 'text-gray-300'
                                      }`}
                                    >
                                      ★
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground py-3 px-4 border rounded-lg bg-muted/20">
                            No templates applied to this index
                          </p>
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="settings">
                    <div className="space-y-4">
                      <Label>Index Settings</Label>
                      <Textarea
                        value={JSON.stringify(indexSettings || {}, null, 2)}
                        rows={12}
                        readOnly
                        className="font-mono text-sm"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="mappings">
                    <div className="space-y-4">
                      <Label>Field Mappings</Label>
                      <Textarea
                        value={JSON.stringify(indexMappings || {}, null, 2)}
                        rows={12}
                        readOnly
                        className="font-mono text-sm"
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-64">
                <div className="text-center">
                  <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium">No Index Selected</p>
                  <p className="text-muted-foreground">
                    Click on an index to view its details
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

    </div>
  );
}
