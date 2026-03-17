"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, GitCompare, AlertTriangle, CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SavedConnection { id: number; name: string; url: string; color?: string }
interface ClusterInfo { cluster_name: string; status: string; nodes: number; indices: number; docs: number; store_size: string }
interface IndexDiff {
  name: string; in_a: boolean; in_b: boolean;
  diff?: { field: string; a: unknown; b: unknown }[];
}
interface CompareResult {
  cluster_a: ClusterInfo; cluster_b: ClusterInfo;
  indices: IndexDiff[];
  templates_only_a: string[]; templates_only_b: string[];
  settings_diff: { field: string; a: unknown; b: unknown }[];
}

type ConnSource = "saved" | "manual";
interface ClusterInput { source: ConnSource; saved_id: string; url: string; username: string; password: string }
function emptyInput(): ClusterInput { return { source: "saved", saved_id: "", url: "", username: "", password: "" }; }

const statusColor = (s: string) => ({ green: "text-emerald-500", yellow: "text-amber-500", red: "text-red-500" }[s] ?? "text-muted-foreground");

export default function ClusterComparePage() {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [clusterA, setClusterA] = useState<ClusterInput>(emptyInput());
  const [clusterB, setClusterB] = useState<ClusterInput>(emptyInput());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult|null>(null);
  const [error, setError] = useState<string|null>(null);

  useEffect(() => {
    fetch("/api/saved-connections").then(r => r.json()).then(d => setConnections(d.connections ?? [])).catch(() => {});
  }, []);

  const compare = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const toSpec = (inp: ClusterInput) => inp.source === "saved" ? { saved_connection_id: Number(inp.saved_id) } : { url: inp.url, username: inp.username, password: inp.password };
      const r = await fetch("/api/cluster-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cluster_a: toSpec(clusterA), cluster_b: toSpec(clusterB) }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setResult(d);
    } catch (e) { setError(e instanceof Error ? e.message : "Comparison failed"); }
    finally { setLoading(false); }
  };

  const onlyA = result?.indices.filter(i => i.in_a && !i.in_b) ?? [];
  const onlyB = result?.indices.filter(i => !i.in_a && i.in_b) ?? [];
  const both = result?.indices.filter(i => i.in_a && i.in_b) ?? [];
  const diffBoth = both.filter(i => i.diff && i.diff.length > 0);
  const sameBoth = both.filter(i => !i.diff || i.diff.length === 0);

  const ClusterInputCard = ({ label, value, onChange }: { label: string; value: ClusterInput; onChange: (v: ClusterInput) => void }) => (
    <Card>
      <CardHeader><CardTitle className="text-sm">{label}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Source</Label>
          <Select value={value.source} onValueChange={v => onChange({ ...value, source: v as ConnSource })}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="saved">Saved Connection</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.source === "saved" ? (
          <div className="space-y-1.5">
            <Label>Connection</Label>
            <Select value={value.saved_id} onValueChange={v => onChange({ ...value, saved_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger>
              <SelectContent>
                {connections.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c.color ?? "#6366f1" }}/>
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div className="space-y-1.5"><Label>URL</Label><Input value={value.url} onChange={e => onChange({ ...value, url: e.target.value })} placeholder="https://es.example.com:9200"/></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Username</Label><Input value={value.username} onChange={e => onChange({ ...value, username: e.target.value })} placeholder="admin"/></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={value.password} onChange={e => onChange({ ...value, password: e.target.value })} placeholder="••••••"/></div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><GitCompare className="h-6 w-6 text-primary"/>Cross-Cluster Compare</h1>
        <p className="text-sm text-muted-foreground mt-1">Side-by-side diff of indices, templates, and settings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ClusterInputCard label="Cluster A" value={clusterA} onChange={setClusterA}/>
        <ClusterInputCard label="Cluster B" value={clusterB} onChange={setClusterB}/>
      </div>

      <Button onClick={compare} disabled={loading} className="w-full md:w-auto">
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <GitCompare className="h-4 w-4 mr-2"/>}
        {loading ? "Comparing..." : "Compare Clusters"}
      </Button>

      {error && <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-3"><AlertTriangle className="h-4 w-4"/>{error}</div>}

      {result && (
        <div className="space-y-6">
          {/* Health cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {([result.cluster_a, result.cluster_b] as const).map((c, i) => (
              <Card key={i}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{i === 0 ? "Cluster A" : "Cluster B"}</span>
                    <Badge className={`${statusColor(c.status)} border capitalize`} variant="outline">{c.status}</Badge>
                  </div>
                  <p className="text-sm font-mono text-muted-foreground">{c.cluster_name}</p>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                    <div><p className="font-bold text-lg">{c.nodes}</p><p className="text-muted-foreground">Nodes</p></div>
                    <div><p className="font-bold text-lg">{c.indices}</p><p className="text-muted-foreground">Indices</p></div>
                    <div><p className="font-bold text-lg">{c.docs?.toLocaleString()}</p><p className="text-muted-foreground">Docs</p></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Indices diff */}
          <Tabs defaultValue="diff">
            <TabsList>
              <TabsTrigger value="diff">Different <Badge variant="secondary" className="ml-1">{diffBoth.length}</Badge></TabsTrigger>
              <TabsTrigger value="only_a">Only in A <Badge variant="secondary" className="ml-1">{onlyA.length}</Badge></TabsTrigger>
              <TabsTrigger value="only_b">Only in B <Badge variant="secondary" className="ml-1">{onlyB.length}</Badge></TabsTrigger>
              <TabsTrigger value="same">Identical <Badge variant="secondary" className="ml-1">{sameBoth.length}</Badge></TabsTrigger>
              <TabsTrigger value="templates">Templates</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="diff" className="mt-3 space-y-2">
              {diffBoth.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No differences found in shared indices</p> : diffBoth.map(idx => (
                <Card key={idx.name}>
                  <CardContent className="pt-3 pb-2">
                    <p className="font-mono text-sm font-medium mb-2">{idx.name}</p>
                    <div className="text-xs space-y-1">
                      {idx.diff?.map((d, i) => (
                        <div key={i} className="grid grid-cols-3 gap-2">
                          <span className="text-muted-foreground">{d.field}</span>
                          <span className="font-mono text-emerald-500">{String(d.a)}</span>
                          <span className="font-mono text-blue-500">{String(d.b)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="only_a" className="mt-3">
              {onlyA.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">None</p> : (
                <div className="flex flex-wrap gap-2">{onlyA.map(i => <Badge key={i.name} variant="outline" className="font-mono text-xs text-red-500 border-red-500/40">{i.name}</Badge>)}</div>
              )}
            </TabsContent>

            <TabsContent value="only_b" className="mt-3">
              {onlyB.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">None</p> : (
                <div className="flex flex-wrap gap-2">{onlyB.map(i => <Badge key={i.name} variant="outline" className="font-mono text-xs text-emerald-500 border-emerald-500/40">{i.name}</Badge>)}</div>
              )}
            </TabsContent>

            <TabsContent value="same" className="mt-3">
              <div className="flex flex-wrap gap-2">{sameBoth.map(i => <Badge key={i.name} variant="secondary" className="font-mono text-xs">{i.name}</Badge>)}</div>
              {sameBoth.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">None</p>}
            </TabsContent>

            <TabsContent value="templates" className="mt-3 space-y-3">
              {result.templates_only_a.length > 0 && (
                <div><p className="text-xs font-medium text-muted-foreground mb-1">Only in A</p>
                  <div className="flex flex-wrap gap-2">{result.templates_only_a.map(t => <Badge key={t} variant="outline" className="font-mono text-xs text-red-500 border-red-500/40">{t}</Badge>)}</div>
                </div>
              )}
              {result.templates_only_b.length > 0 && (
                <div><p className="text-xs font-medium text-muted-foreground mb-1">Only in B</p>
                  <div className="flex flex-wrap gap-2">{result.templates_only_b.map(t => <Badge key={t} variant="outline" className="font-mono text-xs text-emerald-500 border-emerald-500/40">{t}</Badge>)}</div>
                </div>
              )}
              {result.templates_only_a.length === 0 && result.templates_only_b.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Templates are identical</p>}
            </TabsContent>

            <TabsContent value="settings" className="mt-3">
              {result.settings_diff.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">Settings are identical</p> : (
                <div className="text-xs font-mono space-y-1">
                  <div className="grid grid-cols-3 gap-2 font-bold text-muted-foreground pb-1 border-b">
                    <span>Setting</span><span className="text-emerald-500">Cluster A</span><span className="text-blue-500">Cluster B</span>
                  </div>
                  {result.settings_diff.map((d, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 py-0.5 border-b border-muted/30">
                      <span className="text-muted-foreground truncate">{d.field}</span>
                      <span className="text-emerald-500 truncate">{String(d.a)}</span>
                      <span className="text-blue-500 truncate">{String(d.b)}</span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
