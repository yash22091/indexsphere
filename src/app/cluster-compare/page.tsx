"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HealthBadge, PageHeader } from "@/components/app";
import { AlertCircle, GitCompare, Loader2 } from "lucide-react";
import { ClickHouseCompare } from "@/components/clickhouse/compare";

interface SavedConnection { id: string | number; name: string; url: string; engine?: string }

/** Response of POST /api/cluster-compare */
interface Health { cluster_name?: string; status?: string; number_of_nodes?: number; number_of_data_nodes?: number; active_shards?: number; unassigned_shards?: number }
interface CompareResponse {
  clusterA: Health | null;
  clusterB: Health | null;
  indices: {
    countA: number; countB: number;
    onlyInA: string[]; onlyInB: string[]; inBoth: string[];
    differences: Array<Record<string, unknown> & { index: string }>;
  };
  templates: { countA: number; countB: number; onlyInA: string[]; onlyInB: string[]; inBoth: string[] };
  settings: { a: Record<string, unknown> | null; b: Record<string, unknown> | null };
}

type ConnSource = "saved" | "manual";
interface ClusterInput { source: ConnSource; saved_id: string; url: string; username: string; password: string }
function emptyInput(): ClusterInput { return { source: "saved", saved_id: "", url: "", username: "", password: "" }; }

/** Flatten nested settings to dotted keys, e.g. cluster.routing.allocation.enable */
function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = Array.isArray(obj) ? JSON.stringify(obj) : String(obj);
  }
  return out;
}

function settingsDiff(a: Record<string, unknown> | null, b: Record<string, unknown> | null) {
  const fa = { ...flatten(a?.persistent, "persistent"), ...flatten(a?.transient, "transient") };
  const fb = { ...flatten(b?.persistent, "persistent"), ...flatten(b?.transient, "transient") };
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])]
    .filter(k => fa[k] !== fb[k])
    .sort()
    .map(k => ({ field: k, a: fa[k], b: fb[k] }));
}

function ClusterInputCard({ label, value, onChange, connections }: {
  label: string; value: ClusterInput; onChange: (v: ClusterInput) => void; connections: SavedConnection[];
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{label}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          <Label>Source</Label>
          <Select value={value.source} onValueChange={v => onChange({ ...value, source: v as ConnSource })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="saved">Saved connection</SelectItem>
              <SelectItem value="manual">Enter URL and credentials</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.source === "saved" ? (
          <div className="grid gap-2">
            <Label>Connection</Label>
            <Select value={value.saved_id} onValueChange={v => onChange({ ...value, saved_id: v })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a connection" /></SelectTrigger>
              <SelectContent>
                {connections.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No saved connections</div>}
                {connections.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div className="grid gap-2">
              <Label>URL</Label>
              <Input value={value.url} onChange={e => onChange({ ...value, url: e.target.value })} placeholder="https://es.example.com:9200" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>Username</Label>
                <Input value={value.username} onChange={e => onChange({ ...value, username: e.target.value })} autoComplete="off" />
              </div>
              <div className="grid gap-2">
                <Label>Password</Label>
                <Input type="password" value={value.password} onChange={e => onChange({ ...value, password: e.target.value })} autoComplete="new-password" />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NameList({ names, empty }: { names: string[]; empty: string }) {
  if (names.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map(n => <Badge key={n} variant="outline" className="font-mono text-xs font-normal">{n}</Badge>)}
    </div>
  );
}

function SearchCompare() {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [clusterA, setClusterA] = useState<ClusterInput>(emptyInput());
  const [clusterB, setClusterB] = useState<ClusterInput>(emptyInput());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/saved-connections")
      .then(r => r.json())
      // ClickHouse connections can't be compared here
      .then(d => setConnections((d.connections ?? []).filter((c: SavedConnection) => c.engine !== "clickhouse")))
      .catch(() => {});
  }, []);

  const ready = (c: ClusterInput) => (c.source === "saved" ? !!c.saved_id : !!c.url.trim());

  const compare = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const spec = (inp: ClusterInput, key: "A" | "B") => inp.source === "saved"
        ? { [`connection${key}Id`]: inp.saved_id }
        : { [`connection${key}`]: { url: inp.url.trim(), username: inp.username || undefined, password: inp.password || undefined } };
      const r = await fetch("/api/cluster-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...spec(clusterA, "A"), ...spec(clusterB, "B") }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error ?? `Comparison failed (${r.status})`);
      setResult(d as CompareResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  const diffs = useMemo(() => result?.indices.differences ?? [], [result]);
  const setDiff = useMemo(() => (result ? settingsDiff(result.settings.a, result.settings.b) : []), [result]);
  const sameCount = result ? result.indices.inBoth.length - diffs.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Indices, templates and cluster settings of two Elasticsearch or OpenSearch clusters.</p>
        <Button onClick={compare} disabled={loading || !ready(clusterA) || !ready(clusterB)}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitCompare className="mr-2 h-4 w-4" />}
          {loading ? "Comparing…" : "Compare"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ClusterInputCard label="Cluster A" value={clusterA} onChange={setClusterA} connections={connections} />
        <ClusterInputCard label="Cluster B" value={clusterB} onChange={setClusterB} connections={connections} />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {([["Cluster A", result.clusterA, result.indices.countA, result.templates.countA], ["Cluster B", result.clusterB, result.indices.countB, result.templates.countB]] as const)
              .map(([label, h, idxCount, tplCount]) => (
                <Card key={label}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="truncate font-mono text-sm font-medium">{h?.cluster_name ?? "Unreachable"}</p>
                      </div>
                      <HealthBadge status={h?.status} />
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-sm">
                      {[["Nodes", h?.number_of_nodes], ["Indices", idxCount], ["Templates", tplCount], ["Shards", h?.active_shards]].map(([k, v]) => (
                        <div key={String(k)}>
                          <p className="text-xs text-muted-foreground">{k}</p>
                          <p className="font-semibold tabular-nums">{v === undefined || v === null ? "—" : Number(v).toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>

          <Card className="gap-0 py-0">
            <Tabs defaultValue="diff" className="gap-0">
              <div className="overflow-x-auto border-b px-4 py-2">
                <TabsList>
                  <TabsTrigger value="diff">Different <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{diffs.length}</Badge></TabsTrigger>
                  <TabsTrigger value="only_a">Only in A <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{result.indices.onlyInA.length}</Badge></TabsTrigger>
                  <TabsTrigger value="only_b">Only in B <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{result.indices.onlyInB.length}</Badge></TabsTrigger>
                  <TabsTrigger value="same">Identical <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{sameCount}</Badge></TabsTrigger>
                  <TabsTrigger value="templates">Templates</TabsTrigger>
                  <TabsTrigger value="settings">Settings <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{setDiff.length}</Badge></TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="diff" className="mt-0 p-4">
                {diffs.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Shared indices have the same health, shards, document count and size.</p> : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Index</TableHead>
                          <TableHead>Property</TableHead>
                          <TableHead>Cluster A</TableHead>
                          <TableHead>Cluster B</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {diffs.flatMap(d => Object.entries(d).filter(([k]) => k !== "index").map(([field, v], i) => {
                          const pair = v as { a: unknown; b: unknown };
                          return (
                            <TableRow key={`${d.index}-${field}`}>
                              <TableCell className="font-mono text-xs">{i === 0 ? d.index : ""}</TableCell>
                              <TableCell className="text-muted-foreground">{field}</TableCell>
                              <TableCell className="font-mono text-xs">{String(pair?.a ?? "—")}</TableCell>
                              <TableCell className="font-mono text-xs">{String(pair?.b ?? "—")}</TableCell>
                            </TableRow>
                          );
                        }))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="only_a" className="mt-0 p-4"><NameList names={result.indices.onlyInA} empty="No indices exist only in cluster A." /></TabsContent>
              <TabsContent value="only_b" className="mt-0 p-4"><NameList names={result.indices.onlyInB} empty="No indices exist only in cluster B." /></TabsContent>
              <TabsContent value="same" className="mt-0 p-4">
                <NameList names={result.indices.inBoth.filter(n => !diffs.some(d => d.index === n))} empty="No identical indices." />
              </TabsContent>

              <TabsContent value="templates" className="mt-0 space-y-4 p-4">
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Only in cluster A</p>
                  <NameList names={result.templates.onlyInA} empty="None" />
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Only in cluster B</p>
                  <NameList names={result.templates.onlyInB} empty="None" />
                </div>
              </TabsContent>

              <TabsContent value="settings" className="mt-0 p-4">
                {setDiff.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Persistent and transient cluster settings are identical.</p> : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Setting</TableHead>
                          <TableHead>Cluster A</TableHead>
                          <TableHead>Cluster B</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {setDiff.map(d => (
                          <TableRow key={d.field}>
                            <TableCell className="font-mono text-xs">{d.field}</TableCell>
                            <TableCell className="font-mono text-xs">{d.a ?? <span className="text-muted-foreground">not set</span>}</TableCell>
                            <TableCell className="font-mono text-xs">{d.b ?? <span className="text-muted-foreground">not set</span>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function ClusterComparePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cluster compare"
        description="Compare two servers side by side — for example production and staging, or a cluster before and after a migration."
      />
      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search">Elasticsearch / OpenSearch</TabsTrigger>
          <TabsTrigger value="clickhouse">ClickHouse</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-4"><SearchCompare /></TabsContent>
        <TabsContent value="clickhouse" className="mt-4"><ClickHouseCompare /></TabsContent>
      </Tabs>
    </div>
  );
}
