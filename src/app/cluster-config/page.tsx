"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { useConnection } from "@/contexts/connection-context";
import { EmptyState, PageHeader, SeverityBadge } from "@/components/app";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import {
  RefreshCw, Loader2, AlertCircle, Database, Search
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

  const loadAll = useCallback(async () => {
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
  }, [isConnected]);

  useEffect(() => {
    if (isConnected) loadAll();
  }, [isConnected, loadAll]);

  const filtered = <T extends Record<string, any>>(items: T[], key: string): T[] =>
    items.filter((i) => (i[key] ?? "").toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Config and policies"
        description="Read-only view of aliases, index and component templates, lifecycle policies, snapshots and cluster settings."
        actions={
          <Button onClick={loadAll} variant="outline" disabled={!isConnected || loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      {!isConnected && (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to view its configuration."
          action={<Button asChild><Link href="/connections">Go to connections</Link></Button>}
        />
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="relative w-full sm:w-64">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by name"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      <Tabs defaultValue="aliases">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="aliases">
            Aliases
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] tabular-nums">{aliases.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="templates">
            Index templates
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] tabular-nums">{templates.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="component-templates">
            Component templates
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] tabular-nums">{componentTemplates.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ilm">
            Lifecycle policies
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] tabular-nums">{ilmPolicies.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="repositories">
            Repositories
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] tabular-nums">{repositories.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="snapshots">
            Snapshots
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px] tabular-nums">{snapshots.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="settings">Cluster settings</TabsTrigger>
        </TabsList>

        {/* ── ALIASES ─────────────────────────────────────────────── */}
        <TabsContent value="aliases">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aliases</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alias</TableHead>
                      <TableHead>Index</TableHead>
                      <TableHead>Write index</TableHead>
                      <TableHead>Routing</TableHead>
                      <TableHead>Filter</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered(aliases, "alias").map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{a.alias}</TableCell>
                        <TableCell>{a.index}</TableCell>
                        <TableCell>
                          {a.is_write_index ? "Yes" : <span className="text-muted-foreground">No</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {a.routing ?? a.search_routing ?? a.index_routing ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[320px] truncate font-mono text-xs text-muted-foreground">
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
                </Table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── INDEX TEMPLATES ─────────────────────────────────────── */}
        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Index templates</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Index patterns</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Composed of</TableHead>
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
                </Table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── COMPONENT TEMPLATES ─────────────────────────────────── */}
        <TabsContent value="component-templates">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Component templates</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <div className="overflow-x-auto"><Table>
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
                          {t.component_template?.template?.mappings ? "Yes" : <span className="text-muted-foreground">No</span>}
                        </TableCell>
                        <TableCell>
                          {t.component_template?.template?.settings ? "Yes" : <span className="text-muted-foreground">No</span>}
                        </TableCell>
                        <TableCell>
                          {t.component_template?.template?.aliases ? "Yes" : <span className="text-muted-foreground">No</span>}
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
                </Table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ILM / ISM POLICIES ──────────────────────────────────── */}
        <TabsContent value="ilm">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lifecycle policies (ILM / ISM)</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <div className="overflow-x-auto"><Table>
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
                </Table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── REPOSITORIES ────────────────────────────────────────── */}
        <TabsContent value="repositories">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Snapshot repositories</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Location / bucket</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered(repositories, "name").map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-normal">{r.type}</Badge>
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
                </Table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SNAPSHOTS ───────────────────────────────────────────── */}
        <TabsContent value="snapshots">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Snapshots</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Repository</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Indices</TableHead>
                      <TableHead>Started</TableHead>
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
                          <SeverityBadge level={s.state === "SUCCESS" ? "ok" : s.state === "FAILED" ? "high" : s.state === "PARTIAL" ? "warning" : "info"}>
                            {String(s.state ?? "").toLowerCase()}
                          </SeverityBadge>
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
                </Table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── CLUSTER SETTINGS ────────────────────────────────────── */}
        <TabsContent value="settings">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Persistent settings</CardTitle>
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
                <CardTitle className="text-base">Transient settings</CardTitle>
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
