"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, Pencil, Wifi, WifiOff, GlobeIcon, CheckCircle, AlertTriangle, X, PlugZap } from "lucide-react";
import { useConnection } from "@/contexts/connection-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

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
}

const COLORS = ["#6366f1","#0ea5e9","#f59e0b","#10b981","#ef4444","#8b5cf6","#ec4899","#14b8a6"];

const statusBadge = (s?: string) => {
  if (s === "ok") return <Badge className="bg-emerald-500 text-white text-xs"><CheckCircle className="h-3 w-3 mr-1"/>OK</Badge>;
  if (s === "error") return <Badge variant="destructive" className="text-xs"><WifiOff className="h-3 w-3 mr-1"/>Error</Badge>;
  return <Badge variant="secondary" className="text-xs">Untested</Badge>;
};

const rolesOptions = ["admin","operator","viewer"];

interface FormState {
  name: string; url: string; username: string; password: string;
  description: string; color: string; ssl_verify: boolean;
  allowed_roles: string[];
}
const emptyForm = (): FormState => ({ name:"", url:"http://localhost:9200", username:"", password:"", description:"", color:COLORS[0], ssl_verify:true, allowed_roles:["admin"] });

export default function ConnectionsPage() {
  const { activateSavedConnection, currentSavedConnectionId, connecting } = useConnection();
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
    setForm({ name: c.name, url: c.url, username: c.username??"", password: "", description: c.description??"", color: c.color ?? COLORS[0], ssl_verify: !!c.ssl_verify, allowed_roles: JSON.parse(c.allowed_roles??"[]") });
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
      setTestResults(prev => ({ ...prev, [id]: { status: d.ok ? "ok" : "error", message: d.message ?? "" } }));
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><GlobeIcon className="h-6 w-6 text-primary"/>Saved Connections</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage multi-cluster connections with role-based access</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1"/>New Connection</Button>
      </div>

      {error && <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-3"><AlertTriangle className="h-4 w-4"/>{error}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/></div>
      ) : connections.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <GlobeIcon className="h-8 w-8 mx-auto mb-2 opacity-40"/>
          <p>No saved connections yet.</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}><Plus className="h-4 w-4 mr-1"/>Add Connection</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {connections.map(c => {
            const res = testResults[c.id];
            return (
              <Card key={c.id} className="relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: c.color ?? "#6366f1" }}/>
                <CardHeader className="pl-5 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{c.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.url}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="h-3.5 w-3.5"/></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => deleteConn(c.id)} disabled={deletingId === c.id}>
                        {deletingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Trash2 className="h-3.5 w-3.5"/>}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pl-5 space-y-3">
                  {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(res?.status ?? c.last_test_status ?? undefined)}
                    {c.username && <Badge variant="outline" className="text-xs">{c.username}</Badge>}
                    {!c.ssl_verify && <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/40">SSL off</Badge>}
                  </div>
                  {res && <p className="text-xs text-muted-foreground truncate">{res.message}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => testConn(c.id)} disabled={testingId === c.id}>
                      {testingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1"/> : <Wifi className="h-3.5 w-3.5 mr-1"/>}
                      Test
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={connecting}
                      variant={currentSavedConnectionId === String(c.id) ? 'secondary' : 'default'}
                      onClick={async () => {
                        try { await activateSavedConnection(c.id, c.url); }
                        catch {}
                      }}
                    >
                      {connecting && currentSavedConnectionId === String(c.id)
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1"/>
                        : <PlugZap className="h-3.5 w-3.5 mr-1"/>}
                      {currentSavedConnectionId === String(c.id) ? 'Active' : 'Connect'}
                    </Button>
                  </div>
                  {c.last_tested_at && <p className="text-xs text-muted-foreground">Last tested: {new Date(c.last_tested_at).toLocaleString()}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Connection" : "New Connection"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Production cluster"/>
            </div>
            <div className="space-y-1.5">
              <Label>URL <span className="text-red-500">*</span></Label>
              <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://es.example.com:9200"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="admin"/>
              </div>
              <div className="space-y-1.5">
                <Label>{editing ? "New Password" : "Password"}</Label>
                <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={editing ? "Leave blank to keep" : "••••••"}/>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional note"/>
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(col => (
                  <button key={col} className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === col ? "border-foreground scale-110" : "border-transparent opacity-70 hover:opacity-100"}`} style={{ backgroundColor: col }} onClick={() => setForm(f => ({ ...f, color: col }))}/>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.ssl_verify} onCheckedChange={v => setForm(f => ({ ...f, ssl_verify: v }))}/>
              <Label>Verify SSL certificate</Label>
            </div>
            <div className="space-y-1.5">
              <Label>Allowed Roles</Label>
              <div className="flex gap-2">
                {rolesOptions.map(r => (
                  <button key={r} onClick={() => toggleRole(r)} className={`px-3 py-1 rounded text-sm border transition-colors ${form.allowed_roles.includes(r) ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground hover:border-primary"}`}>{r}</button>
                ))}
              </div>
            </div>
            {formError && <div className="text-sm text-red-500 flex gap-1"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5"/>{formError}</div>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-1"/>Cancel</Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1"/> : null}Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
