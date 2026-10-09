"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, Pencil, Wifi, Globe, AlertCircle, PlugZap } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, SeverityBadge } from "@/components/app";
import { useConnection } from "@/contexts/connection-context";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "next/navigation";

interface SavedConnection {
  id: number;
  name: string;
  url: string;
  username?: string;
  description?: string;
  color?: string;
  ssl_verify: number;
  allowed_roles: string;
  is_active: number;
  created_at: string;
  last_tested_at?: string;
  last_test_status?: "ok" | "error";
  engine?: Engine;
}

type Engine = "elasticsearch" | "opensearch" | "clickhouse";
const ENGINES: { value: Engine; label: string; defaultUrl: string }[] = [
  { value: "elasticsearch", label: "Elasticsearch", defaultUrl: "http://localhost:9200" },
  { value: "opensearch", label: "OpenSearch", defaultUrl: "https://localhost:9200" },
  { value: "clickhouse", label: "ClickHouse", defaultUrl: "http://localhost:8123" },
];

const COLORS = ["#6366f1","#0ea5e9","#f59e0b","#10b981","#ef4444","#8b5cf6","#ec4899","#14b8a6"];


// Must match the application roles enforced by the API
const rolesOptions = ["admin","user","readonly"];

interface FormState {
  name: string; url: string; username: string; password: string;
  description: string; color: string; ssl_verify: boolean;
  allowed_roles: string[]; engine: Engine;
}
const emptyForm = (): FormState => ({ name:"", url:"http://localhost:9200", username:"", password:"", description:"", color:COLORS[0], ssl_verify:true, allowed_roles:["admin"], engine: "elasticsearch" });

export default function ConnectionsPage() {
  const { activateSavedConnection, currentSavedConnectionId, connecting } = useConnection();
  const router = useRouter();
  const [chConnectingId, setChConnectingId] = useState<number|null>(null);

  const connectClickHouse = async (c: SavedConnection) => {
    setChConnectingId(c.id);
    try {
      const r = await fetch(`/api/saved-connections/${c.id}/connect`, { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? "Connection failed");
      router.push("/clickhouse");
    } catch (e) {
      setTestResults(prev => ({ ...prev, [c.id]: { status: "error", message: e instanceof Error ? e.message : "Connection failed" } }));
    } finally { setChConnectingId(null); }
  };
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SavedConnection|null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string|null>(null);
  const [testingId, setTestingId] = useState<number|null>(null);
  const [testResults, setTestResults] = useState<Record<number, { status: "ok"|"error"; message: string }>>({});
  const [deletingId, setDeletingId] = useState<number|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/saved-connections");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setConnections(d.connections ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormError(null); setOpen(true); };
  const openEdit = (c: SavedConnection) => {
    setEditing(c);
    setForm({ name: c.name, url: c.url, username: c.username??"", password: "", description: c.description??"", color: c.color ?? COLORS[0], ssl_verify: !!c.ssl_verify, allowed_roles: JSON.parse(c.allowed_roles??"[]"), engine: c.engine ?? "elasticsearch" });
    setFormError(null);
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) { setFormError("Name and URL are required"); return; }
    setSaving(true); setFormError(null);
    try {
      const url = editing ? `/api/saved-connections/${editing.id}` : "/api/saved-connections";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, allowed_roles: form.allowed_roles }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setOpen(false);
      load();
    } catch (e) { setFormError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const testConn = async (id: number) => {
    setTestingId(id);
    try {
      const r = await fetch(`/api/saved-connections/${id}/test`, { method: "POST" });
      const d = await r.json();
      setTestResults(prev => ({ ...prev, [id]: { status: d.ok ? "ok" : "error", message: d.message ?? d.error ?? (d.cluster ? `${d.cluster.name ?? ""} ${d.cluster.status ?? ""}`.trim() : "") } }));
    } catch { setTestResults(prev => ({ ...prev, [id]: { status: "error", message: "Network error" } })); }
    finally { setTestingId(null); load(); }
  };

  const deleteConn = async (id: number) => {
    setDeletingId(id);
    await fetch(`/api/saved-connections/${id}`, { method: "DELETE" });
    setDeletingId(null);
    load();
  };

  const toggleRole = (role: string) => {
    setForm(f => ({ ...f, allowed_roles: f.allowed_roles.includes(role) ? f.allowed_roles.filter(r => r !== role) : [...f.allowed_roles, role] }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connections"
        description="Saved Elasticsearch, OpenSearch and ClickHouse connections. Passwords are encrypted at rest and never sent to the browser."
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5"/>Add connection</Button>}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4"/>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-44 rounded-xl"/>)}
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No saved connections"
          description="Add a cluster once and connect to it from anywhere in IndexSphere. You choose which roles may use it."
          action={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5"/>Add connection</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connections.map(c => {
            const res = testResults[c.id];
            const status = res?.status ?? c.last_test_status ?? undefined;
            const isActive = currentSavedConnectionId === String(c.id);
            const engineLabel = ENGINES.find(e => e.value === (c.engine ?? "elasticsearch"))?.label;
            let roles: string[] = [];
            try { roles = JSON.parse(c.allowed_roles ?? "[]"); } catch { /* malformed */ }
            return (
              <Card key={c.id} className="gap-0 py-0">
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color ?? COLORS[0] }} aria-hidden/>
                      <span className="truncate">{c.name}</span>
                    </CardTitle>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{c.url}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`}>
                      <Pencil className="h-4 w-4"/>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={deletingId === c.id}
                      onClick={() => { if (confirm(`Delete connection "${c.name}"? Users connected through it are disconnected.`)) deleteConn(c.id); }}
                      aria-label={`Delete ${c.name}`}>
                      {deletingId === c.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4"/>}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 p-4 pt-0">
                  {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{engineLabel}</Badge>
                    {status === "ok" && <SeverityBadge level="ok">Reachable</SeverityBadge>}
                    {status === "error" && <SeverityBadge level="high">Unreachable</SeverityBadge>}
                    {!status && <Badge variant="outline" className="text-muted-foreground">Not tested</Badge>}
                    {!c.ssl_verify && <Badge variant="outline" className="text-muted-foreground">TLS not verified</Badge>}
                    {c.username && <Badge variant="outline" className="font-mono text-muted-foreground">{c.username}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">Available to: {roles.length ? roles.join(", ") : "admin"}</p>
                  {res?.message && (
                    <p className={`truncate text-xs ${res.status === "error" ? "text-destructive" : "text-muted-foreground"}`} title={res.message}>{res.message}</p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => testConn(c.id)} disabled={testingId === c.id}>
                      {testingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5"/> : <Wifi className="h-3.5 w-3.5 mr-1.5"/>}
                      Test
                    </Button>
                    {c.engine === "clickhouse" ? (
                      <Button size="sm" className="flex-1" disabled={chConnectingId !== null} onClick={() => connectClickHouse(c)}>
                        {chConnectingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5"/> : <PlugZap className="h-3.5 w-3.5 mr-1.5"/>}
                        Connect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={connecting}
                        variant={isActive ? "secondary" : "default"}
                        onClick={async () => {
                          try { await activateSavedConnection(c.id, c.url, c.engine ?? "elasticsearch"); }
                          catch {}
                        }}
                      >
                        {connecting && isActive
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5"/>
                          : <PlugZap className="h-3.5 w-3.5 mr-1.5"/>}
                        {isActive ? "Connected" : "Connect"}
                      </Button>
                    )}
                  </div>
                  {c.last_tested_at && <p className="text-xs text-muted-foreground">Last tested {new Date(c.last_tested_at).toLocaleString()}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit connection" : "Add connection"}</DialogTitle>
            <DialogDescription>Credentials are encrypted and only used server-side.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Engine</Label>
              <Select value={form.engine} onValueChange={v => setForm(f => {
                const engine = v as Engine;
                // Swap the default URL when the user hasn't typed their own
                const isDefaultUrl = ENGINES.some(e => e.defaultUrl === f.url);
                return { ...f, engine, url: isDefaultUrl ? ENGINES.find(e => e.value === engine)!.defaultUrl : f.url };
              })}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {ENGINES.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="conn-name">Name</Label>
              <Input id="conn-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Production cluster"/>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="conn-url">URL</Label>
              <Input id="conn-url" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder={form.engine === "clickhouse" ? "https://clickhouse.example.com:8443" : "https://es.example.com:9200"}/>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="conn-user">Username</Label>
                <Input id="conn-user" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoComplete="off"/>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="conn-pass">{editing ? "New password" : "Password"}</Label>
                <Input id="conn-pass" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editing ? "Leave blank to keep" : ""} autoComplete="new-password"/>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="conn-desc">Description</Label>
              <Input id="conn-desc" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional"/>
            </div>
            <div className="grid gap-2">
              <Label>Label colour</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map(col => (
                  <button key={col} type="button" aria-label={`Colour ${col}`}
                    className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition ${form.color === col ? "ring-2 ring-ring" : "opacity-70 hover:opacity-100"}`}
                    style={{ backgroundColor: col }} onClick={() => setForm(f => ({ ...f, color: col }))}/>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="conn-tls">Verify TLS certificate</Label>
                <p className="text-xs text-muted-foreground">Turn off only for self-signed certificates.</p>
              </div>
              <Switch id="conn-tls" checked={form.ssl_verify} onCheckedChange={v => setForm(f => ({ ...f, ssl_verify: v }))}/>
            </div>
            <div className="grid gap-2">
              <Label>Allowed roles</Label>
              <div className="flex flex-wrap gap-2">
                {rolesOptions.map(r => (
                  <Button key={r} type="button" size="sm" variant={form.allowed_roles.includes(r) ? "default" : "outline"} onClick={() => toggleRole(r)}>{r}</Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Admins can always use every connection.</p>
            </div>
            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4"/>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5"/>}
              {editing ? "Save changes" : "Add connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
