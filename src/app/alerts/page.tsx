"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, BellRing, AlertTriangle, CheckCircle, Clock, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface AlertRule {
  id: number; name: string; metric: string; operator: string;
  threshold: number; window_minutes: number; severity: string;
  notification_channels: string; is_active: number; created_at: string;
  trigger_count?: number; last_triggered_at?: string;
}
interface AlertTrigger {
  id: number; rule_id: number; rule_name?: string; metric_value: number;
  threshold: number; severity: string; message: string; created_at: string;
}

const METRICS = ["cpu_percent","heap_percent","gc_pressure","unassigned_shards","indexing_rate","node_count"];
const OPERATORS = [{ v: "gt", l: ">" }, { v: "lt", l: "<" }, { v: "gte", l: ">=" }, { v: "lte", l: "<=" }];
const SEVERITIES = ["info","warning","critical"];

interface Channel { type: "email"|"slack"|"webhook"; value: string }
interface FormState {
  name: string; metric: string; operator: string; threshold: string;
  window_minutes: string; severity: string; is_active: boolean;
  channels: Channel[];
}
const emptyForm = (): FormState => ({ name: "", metric: "cpu_percent", operator: "gt", threshold: "80", window_minutes: "5", severity: "warning", is_active: true, channels: [] });

function severityBadge(s: string) {
  const map: Record<string, string> = { critical: "bg-red-500", warning: "bg-amber-500", info: "bg-blue-500" };
  return <Badge className={`${map[s] ?? "bg-muted"} text-white text-xs`}>{s}</Badge>;
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [triggers, setTriggers] = useState<AlertTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule|null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string|null>(null);
  const [deletingId, setDeletingId] = useState<number|null>(null);
  const [newChan, setNewChan] = useState<Channel>({ type: "email", value: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/alerts");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setRules(d.rules ?? []);
      setTriggers(d.triggers ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormError(null); setOpen(true); };
  const openEdit = (r: AlertRule) => {
    setEditing(r);
    const chans: Channel[] = JSON.parse(r.notification_channels ?? "[]");
    setForm({ name: r.name, metric: r.metric, operator: r.operator, threshold: String(r.threshold), window_minutes: String(r.window_minutes), severity: r.severity, is_active: !!r.is_active, channels: chans });
    setFormError(null); setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    setSaving(true); setFormError(null);
    try {
      const url = editing ? `/api/alerts/${editing.id}` : "/api/alerts";
      const method = editing ? "PUT" : "POST";
      const payload = { ...form, threshold: Number(form.threshold), window_minutes: Number(form.window_minutes), notification_channels: form.channels };
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setOpen(false); load();
    } catch (e) { setFormError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const deleteRule = async (id: number) => {
    setDeletingId(id);
    await fetch(`/api/alerts/${id}`, { method: "DELETE" });
    setDeletingId(null); load();
  };

  const toggleActive = async (r: AlertRule) => {
    await fetch(`/api/alerts/${r.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !r.is_active }) });
    load();
  };

  const addChannel = () => {
    if (!newChan.value.trim()) return;
    setForm(f => ({ ...f, channels: [...f.channels, { ...newChan }] }));
    setNewChan({ type: newChan.type, value: "" });
  };

  const last24h = triggers.filter(t => Date.now() - new Date(t.created_at).getTime() < 86_400_000);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BellRing className="h-6 w-6 text-primary"/>Anomaly Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">Threshold-based rules with email/Slack/webhook notifications</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1"/>New Rule</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Rules</p>
          <p className="text-3xl font-bold mt-1">{rules.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Rules</p>
          <p className="text-3xl font-bold mt-1 text-primary">{rules.filter(r => r.is_active).length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Triggers (24h)</p>
          <p className="text-3xl font-bold mt-1 text-amber-500">{last24h.length}</p>
        </CardContent></Card>
      </div>

      {error && <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-3"><AlertTriangle className="h-4 w-4"/>{error}</div>}

      {/* Rules table */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/></div>
      ) : rules.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          <BellRing className="h-8 w-8 mx-auto mb-2 opacity-40"/>
          <p>No alert rules yet.</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}><Plus className="h-4 w-4 mr-1"/>Create Rule</Button>
        </CardContent></Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-muted-foreground">
              <th className="text-left py-2 px-3 font-medium">Name</th>
              <th className="text-left py-2 px-3 font-medium">Condition</th>
              <th className="text-left py-2 px-3 font-medium">Severity</th>
              <th className="text-left py-2 px-3 font-medium">Triggers</th>
              <th className="text-left py-2 px-3 font-medium">Active</th>
              <th className="text-right py-2 px-3 font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="border-b hover:bg-muted/40 transition-colors">
                  <td className="py-2 px-3 font-medium">{r.name}</td>
                  <td className="py-2 px-3 text-xs font-mono text-muted-foreground">{r.metric} {OPERATORS.find(o => o.v === r.operator)?.l} {r.threshold}</td>
                  <td className="py-2 px-3">{severityBadge(r.severity)}</td>
                  <td className="py-2 px-3 text-muted-foreground">
                    <span className="font-mono">{r.trigger_count ?? 0}</span>
                    {r.last_triggered_at && <span className="text-xs block text-muted-foreground/60">{new Date(r.last_triggered_at).toLocaleDateString()}</span>}
                  </td>
                  <td className="py-2 px-3"><Switch checked={!!r.is_active} onCheckedChange={() => toggleActive(r)}/></td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5"/></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => deleteRule(r.id)} disabled={deletingId === r.id}>
                        {deletingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Trash2 className="h-3.5 w-3.5"/>}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent triggers */}
      {triggers.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground"/>Recent Triggers</h2>
          <div className="space-y-2">
            {triggers.slice(0, 20).map(t => (
              <div key={t.id} className="flex items-start gap-3 text-sm border rounded p-2 bg-muted/20">
                <div className="mt-0.5">{t.severity === "critical" ? <AlertTriangle className="h-4 w-4 text-red-500"/> : <AlertTriangle className="h-4 w-4 text-amber-500"/>}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{t.rule_name ?? `Rule #${t.rule_id}`}</span>
                    {severityBadge(t.severity)}
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5">{t.message}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{new Date(t.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Alert Rule" : "New Alert Rule"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="High CPU Alert"/>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Metric</Label>
                <Select value={form.metric} onValueChange={v => setForm(f => ({ ...f, metric: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{METRICS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Operator</Label>
                <Select value={form.operator} onValueChange={v => setForm(f => ({ ...f, operator: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{OPERATORS.map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Threshold</Label>
                <Input type="number" value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cooldown (minutes)</Label>
                <Input type="number" min={1} value={form.window_minutes} onChange={e => setForm(f => ({ ...f, window_minutes: e.target.value }))}/>
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notification Channels</Label>
              {form.channels.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-xs">{c.type}</Badge>
                  <span className="flex-1 truncate text-muted-foreground">{c.value}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setForm(f => ({ ...f, channels: f.channels.filter((_,j) => j !== i) }))}><X className="h-3 w-3"/></Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Select value={newChan.type} onValueChange={v => setNewChan(c => ({ ...c, type: v as Channel["type"] }))}>
                  <SelectTrigger className="w-28"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="slack">Slack</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="flex-1" value={newChan.value} onChange={e => setNewChan(c => ({ ...c, value: e.target.value }))} placeholder={newChan.type === "email" ? "ops@example.com" : "https://..."}/>
                <Button variant="outline" onClick={addChannel}><Plus className="h-4 w-4"/></Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}/>
              <Label>Active</Label>
            </div>
            {formError && <div className="text-sm text-red-500 flex gap-1"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5"/>{formError}</div>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-1"/>Cancel</Button>
              <Button className="flex-1" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1"/> : null}Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
