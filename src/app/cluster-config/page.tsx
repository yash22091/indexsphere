"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useConnection } from "@/contexts/connection-context";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  RefreshCw, Loader2, AlertCircle, Link2, FileText,
  Puzzle, Clock, Archive, FolderOpen, Settings, Search
} from "lucide-react";

export default function ClusterConfigPage() {
  const { isConnected } = useConnection();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [aliases, setAliases] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [componentTemplates, setComponentTemplates] = useState<any[]>([]);
  const [ilmPolicies, setIlmPolicies] = useState<any[]>([]);
  const [repositories, setRepositories] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [clusterSettings, setClusterSettings] = useState<any>(null);

  const loadAll = async () => {
    if (!isConnected) return;
    const client = getElasticsearchClient();
    if (!client) return;

    setLoading(true);
    setError(null);

    try {
      const [aliasesRes, templatesRes, compTemplatesRes, ilmRes, reposRes, settingsRes] =
        await Promise.allSettled([
          client.getAliases(),
          client.genericRequest("GET", "/_index_template"),
          client.getComponentTemplates(),
          client.getILMPolicies(),
          client.getRepositories(),
          client.getClusterSettings(),
        ]);

      // Aliases: { indexName: { aliases: { aliasName: {} } } }
      if (aliasesRes.status === "fulfilled") {
        const flat: any[] = [];
        Object.entries(aliasesRes.value as Record<string, any>).forEach(([index, indexData]) => {
          Object.entries((indexData as any).aliases || {}).forEach(([alias, cfg]: [string, any]) => {
            flat.push({ alias, index, ...cfg });
          });
        });
        setAliases(flat);
      }

      // Index templates
      if (templatesRes.status === "fulfilled") {
        setTemplates((templatesRes.value as any)?.index_templates || []);
      }

      // Component templates
      if (compTemplatesRes.status === "fulfilled") {
        setComponentTemplates((compTemplatesRes.value as any)?.component_templates || []);
      }

      // ILM / ISM policies
      if (ilmRes.status === "fulfilled") {
        const data = ilmRes.value as any;
        if (data?.policies) {
          // OpenSearch ISM format
          setIlmPolicies(data.policies.map((p: any) => ({ name: p._id, ...p.policy })));
        } else {
          // Elasticsearch ILM format: { policyName: { policy, version, ... } }
          setIlmPolicies(
            Object.entries(data as Record<string, any>).map(([name, val]) => ({ name, ...val }))
          );
        }
      }

      // Repositories + snapshots
      if (reposRes.status === "fulfilled") {
        const data = reposRes.value as Record<string, any>;
        const repoList = Object.entries(data).map(([name, val]) => ({ name, ...val }));
        setRepositories(repoList);

        // Load snapshots for all repos concurrently
        const snapshotResults = await Promise.allSettled(
          repoList.map((r) => client.getSnapshots(r.name))
        );
        const allSnapshots: any[] = [];
        snapshotResults.forEach((res, i) => {
          if (res.status === "fulfilled") {
            ((res.value as any)?.snapshots || []).forEach((s: any) => {
              allSnapshots.push({ ...s, repository: repoList[i].name });
            });
          }
        });
        setSnapshots(allSnapshots);
      }

      if (settingsRes.status === "fulfilled") {
        setClusterSettings(settingsRes.value);
      }
    } catch (err: any) {
      setError(`Failed to load data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected) loadAll();
  }, [isConnected]);

  const filtered = <T extends Record<string, any>>(items: T[], key: string): T[] =>
    items.filter((i) => (i[key] ?? "").toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
            <Settings className="h-7 w-7" />
            Config &amp; Policies
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Read-only visibility — aliases, templates, ILM/ISM policies, snapshots &amp; cluster settings
          </p>
        </div>
        <Button onClick={loadAll} variant="outline" disabled={!isConnected || loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh All
        </Button>
      </div>

      {!isConnected && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Not connected to a cluster. Please connect first.</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert className="border-destructive/50 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Global filter */}
      <div className="relative w-64">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      <Tabs defaultValue="aliases">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="aliases">
            Aliases
            <Badge variant="outline" className="ml-1.5">{aliases.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="templates">
            Index Templates
            <Badge variant="outline" className="ml-1.5">{templates.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="component-templates">
            Component Templates
            <Badge variant="outline" className="ml-1.5">{componentTemplates.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ilm">
            ILM / Policies
            <Badge variant="outline" className="ml-1.5">{ilmPolicies.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="repositories">
            Repositories
            <Badge variant="outline" className="ml-1.5">{repositories.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="snapshots">
            Snapshots
            <Badge variant="outline" className="ml-1.5">{snapshots.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="settings">Cluster Settings</TabsTrigger>
        </TabsList>

        {/* ── ALIASES ─────────────────────────────────────────────── */}
        <TabsContent value="aliases">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Aliases
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alias</TableHead>
                      <TableHead>Index</TableHead>
                      <TableHead>Write Index</TableHead>
                      <TableHead>Search Routing</TableHead>
                      <TableHead>Filter</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered(aliases, "alias").map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{a.alias}</TableCell>
                        <TableCell>{a.index}</TableCell>
                        <TableCell>
                          {a.is_write_index ? (
                            <Badge>Yes</Badge>
                          ) : (
                            <Badge variant="outline">No</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {a.routing ?? a.search_routing ?? a.index_routing ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {a.filter ? JSON.stringify(a.filter) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {aliases.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No aliases found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── INDEX TEMPLATES ─────────────────────────────────────── */}
        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4" /> Index Templates
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Index Patterns</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Composed Of</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered(templates, "name").map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(t.index_template?.index_patterns ?? []).map((p: string) => (
                              <Badge key={p} variant="secondary">{p}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{t.index_template?.priority ?? "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {(t.index_template?.composed_of ?? []).join(", ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {templates.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          No index templates found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── COMPONENT TEMPLATES ─────────────────────────────────── */}
        <TabsContent value="component-templates">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Puzzle className="h-4 w-4" /> Component Templates
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Mappings</TableHead>
                      <TableHead>Settings</TableHead>
                      <TableHead>Aliases</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered(componentTemplates, "name").map((t, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{t.component_template?.version ?? "—"}</Badge>
                        </TableCell>
                        <TableCell>
                          {t.component_template?.template?.mappings ? (
                            <Badge>Yes</Badge>
                          ) : (
                            <Badge variant="outline">No</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.component_template?.template?.settings ? (
                            <Badge>Yes</Badge>
                          ) : (
                            <Badge variant="outline">No</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.component_template?.template?.aliases ? (
                            <Badge>Yes</Badge>
                          ) : (
                            <Badge variant="outline">No</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {componentTemplates.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No component templates found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ILM / ISM POLICIES ──────────────────────────────────── */}
        <TabsContent value="ilm">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" /> ILM / ISM Policies
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Phases</TableHead>
                      <TableHead>Modified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered(ilmPolicies, "name").map((p, i) => {
                      const phases = Object.keys(p.policy?.phases ?? {});
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{p.version ?? "—"}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {phases.length > 0 ? (
                                phases.map((ph) => (
                                  <Badge key={ph} variant="secondary">{ph}</Badge>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {p.modified_date_string ?? p.modified_date ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {ilmPolicies.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          No ILM / ISM policies found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── REPOSITORIES ────────────────────────────────────────── */}
        <TabsContent value="repositories">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" /> Snapshot Repositories
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Location / Bucket</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered(repositories, "name").map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>
                          <Badge>{r.type}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.settings?.location ?? r.settings?.bucket ?? JSON.stringify(r.settings ?? {})}
                        </TableCell>
                      </TableRow>
                    ))}
                    {repositories.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                          No repositories configured
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SNAPSHOTS ───────────────────────────────────────────── */}
        <TabsContent value="snapshots">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Archive className="h-4 w-4" /> Snapshots
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Repository</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Indices</TableHead>
                      <TableHead>Start Time</TableHead>
                      <TableHead>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered(snapshots, "snapshot").map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{s.snapshot}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{s.repository}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              s.state === "SUCCESS"
                                ? "default"
                                : s.state === "FAILED"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {s.state}
                          </Badge>
                        </TableCell>
                        <TableCell>{s.indices?.length ?? 0}</TableCell>
                        <TableCell className="text-xs">{s.start_time ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {s.duration_in_millis
                            ? `${(s.duration_in_millis / 1000).toFixed(1)}s`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {snapshots.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No snapshots found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── CLUSTER SETTINGS ────────────────────────────────────── */}
        <TabsContent value="settings">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Persistent Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={JSON.stringify(clusterSettings?.persistent ?? {}, null, 2)}
                  rows={22}
                  readOnly
                  className="font-mono text-xs"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Transient Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={JSON.stringify(clusterSettings?.transient ?? {}, null, 2)}
                  rows={22}
                  readOnly
                  className="font-mono text-xs"
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
