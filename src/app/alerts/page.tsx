"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, SeverityBadge, StatCard } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, BellRing, AlertCircle, CheckCircle, Clock, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface AlertRule {
  id: number; name: string; metric: string; operator: string;
  threshold: number; window_minutes: number; severity: string;
  channels?: string; is_active: number; created_at: string;
  trigger_count?: number; last_triggered?: string;
}
interface AlertTrigger {
  id: number; rule_id: number; metric: string; value: number;
  threshold: number; severity: string; message: string; created_at: string;
}

// Search-cluster metrics come from the Monitoring stream; ch_* from the ClickHouse dashboard.
// A rule only fires for the source that reports its metric.
const METRICS = [
  "cpu_percent","heap_percent","gc_pressure","unassigned_shards","indexing_rate","node_count",
  "ch_running_queries","ch_memory_percent","ch_max_parts_per_partition","ch_replica_delay_seconds",
  "ch_failed_queries_5m","ch_queries_per_sec","ch_insert_rows_per_sec","ch_merges_running","ch_load1",
];
const OPERATORS = [{ v: "gt", l: ">" }, { v: "lt", l: "<" }, { v: "gte", l: ">=" }, { v: "lte", l: "<=" }];
const SEVERITIES = ["info","warning","critical"];

interface Channel { type: "email"|"slack"|"webhook"; value: string }
interface FormState {
  name: string; metric: string; operator: string; threshold: string;
  window_minutes: string; severity: string; is_active: boolean;
  channels: Channel[];
}
const emptyForm = (): FormState => ({ name: "", metric: "cpu_percent", operator: "gt", threshold: "80", window_minutes: "5", severity: "warning", is_active: true, channels: [] });

// API shape: email → { type, to }, slack/webhook → { type, url }
function toApiChannel(c: Channel) {
  return c.type === "email" ? { type: c.type, to: c.value } : { type: c.type, url: c.value };
}
function fromApiChannels(raw?: string): Channel[] {
  try {
    const list = JSON.parse(raw ?? "[]") as { type: Channel["type"]; to?: string; url?: string; value?: string }[];
    return list.map(c => ({ type: c.type, value: c.to ?? c.url ?? c.value ?? "" }));
  } catch {
    return [];
  }
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
    const chans = fromApiChannels(r.channels);
    setForm({ name: r.name, metric: r.metric, operator: r.operator, threshold: String(r.threshold), window_minutes: String(r.window_minutes), severity: r.severity, is_active: !!r.is_active, channels: chans });
    setFormError(null); setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    setSaving(true); setFormError(null);
    try {
      const url = editing ? `/api/alerts/${editing.id}` : "/api/alerts";
      const method = editing ? "PUT" : "POST";
      // An address typed into the channel field but not yet added with "+" still counts —
      // otherwise the rule would silently be saved without that notification
      const channels = newChan.value.trim() ? [...form.channels, { ...newChan, value: newChan.value.trim() }] : form.channels;
      const payload = { ...form, threshold: Number(form.threshold), window_minutes: Number(form.window_minutes), channels: channels.map(toApiChannel) };
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setNewChan({ type: newChan.type, value: "" });
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

  const ruleName = (id: number) => rules.find(r => r.id === id)?.name ?? `Rule ${id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Threshold rules on cluster and ClickHouse metrics, with email, Slack or webhook notifications."
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5"/>Add rule</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Rules" value={rules.length} icon={BellRing}/>
        <StatCard label="Active" value={rules.filter(r => r.is_active).length} icon={CheckCircle}/>
        <StatCard label="Triggered (24 h)" value={last24h.length} icon={Clock} tone={last24h.length ? "warning" : "default"}/>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4"/>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rules</CardTitle>
          <CardDescription>Rules evaluate while a monitoring view is open: search-cluster metrics from Live monitoring, <code className="font-mono text-xs">ch_*</code> metrics from the ClickHouse overview.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10"/>)}</div>
          ) : rules.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title="No alert rules"
              description="Create a rule to be notified when a metric crosses a threshold."
              action={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5"/>Add rule</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="text-right">Triggers</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.metric} {OPERATORS.find(o => o.v === r.operator)?.l} {r.threshold}</TableCell>
                      <TableCell><SeverityBadge level={r.severity}/></TableCell>
                      <TableCell className="text-right">
                        <div className="tabular-nums">{r.trigger_count ?? 0}</div>
                        {r.last_triggered && <div className="text-xs text-muted-foreground">{new Date(r.last_triggered).toLocaleDateString()}</div>}
                      </TableCell>
                      <TableCell><Switch checked={!!r.is_active} onCheckedChange={() => toggleActive(r)} aria-label={`Toggle ${r.name}`}/></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`}><Pencil className="h-4 w-4"/></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={deletingId === r.id}
                            onClick={() => { if (confirm(`Delete alert rule "${r.name}"?`)) deleteRule(r.id); }} aria-label={`Delete ${r.name}`}>
                            {deletingId === r.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4"/>}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent triggers</CardTitle>
          <CardDescription>The last 20 times a rule fired.</CardDescription>
        </CardHeader>
        <CardContent>
          {triggers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No triggers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {triggers.slice(0, 20).map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(t.created_at).toLocaleString()}</TableCell>
                      <TableCell className="font-medium">{ruleName(t.rule_id)}</TableCell>
                      <TableCell><SeverityBadge level={t.severity}/></TableCell>
                      <TableCell className="text-muted-foreground">{t.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit alert rule" : "Add alert rule"}</DialogTitle>
            <DialogDescription>Fires when the metric meets the condition, at most once per cooldown.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input id="rule-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="High heap usage"/>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2 sm:col-span-1">
                <Label>Metric</Label>
                <Select value={form.metric} onValueChange={v => setForm(f => ({ ...f, metric: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{METRICS.map(m => <SelectItem key={m} value={m}><span className="font-mono text-xs">{m}</span></SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Operator</Label>
                <Select value={form.operator} onValueChange={v => setForm(f => ({ ...f, operator: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{OPERATORS.map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rule-threshold">Threshold</Label>
                <Input id="rule-threshold" type="number" value={form.threshold} onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}/>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="rule-cooldown">Cooldown (minutes)</Label>
                <Input id="rule-cooldown" type="number" min={1} value={form.window_minutes} onChange={e => setForm(f => ({ ...f, window_minutes: e.target.value }))}/>
              </div>
              <div className="grid gap-2">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notifications</Label>
              {form.channels.map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                  <Badge variant="outline">{c.type}</Badge>
                  <span className="flex-1 truncate text-muted-foreground">{c.value}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove channel"
                    onClick={() => setForm(f => ({ ...f, channels: f.channels.filter((_, j) => j !== i) }))}><X className="h-3.5 w-3.5"/></Button>
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
                <Input className="flex-1" value={newChan.value} onChange={e => setNewChan(c => ({ ...c, value: e.target.value }))}
                  placeholder={newChan.type === "email" ? "ops@example.com" : "https://hooks.example.com/…"}/>
                <Button variant="outline" onClick={addChannel} aria-label="Add channel"><Plus className="h-4 w-4"/></Button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="rule-active">Rule is active</Label>
              <Switch id="rule-active" checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}/>
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
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5"/>}{editing ? "Save changes" : "Add rule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
