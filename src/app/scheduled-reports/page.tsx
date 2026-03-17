"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Play, CalendarClock, AlertTriangle, CheckCircle, X } from "lucide-react";

interface ScheduledReport {
  id: number; name: string; report_type: string; format: string;
  cron_expression: string; email_to: string; email_subject?: string;
  is_active: number; last_run_at?: string; last_run_status?: string;
  last_run_error?: string; created_at: string; next_run?: string;
}

interface FormState {
  name: string; report_type: string; format: string; cron_expression: string;
  email_to: string; email_subject: string; is_active: boolean;
}
const emptyForm = (): FormState => ({ name: "", report_type: "cluster_health", format: "csv", cron_expression: "0 8 * * *", email_to: "", email_subject: "", is_active: true });

const CRON_PRESETS = [
  { label: "Daily 8am", value: "0 8 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Monday 9am", value: "0 9 * * 1" },
  { label: "1st of month", value: "0 8 1 * *" },
];

function statusBadge(status?: string) {
  if (!status) return null;
  if (status === "ok") return <Badge className="bg-emerald-500 text-white text-xs"><CheckCircle className="h-3 w-3 mr-1"/>OK</Badge>;
  return <Badge variant="destructive" className="text-xs">Error</Badge>;
}

export default function ScheduledReportsPage() {
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledReport|null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string|null>(null);
  const [runningId, setRunningId] = useState<number|null>(null);
  const [deletingId, setDeletingId] = useState<number|null>(null);
  const [runResult, setRunResult] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/scheduled-reports");
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setReports(d.reports ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormError(null); setOpen(true); };
  const openEdit = (r: ScheduledReport) => {
    setEditing(r);
    setForm({ name: r.name, report_type: r.report_type, format: r.format, cron_expression: r.cron_expression, email_to: JSON.parse(r.email_to ?? "[]").join(", "), email_subject: r.email_subject ?? "", is_active: !!r.is_active });
    setFormError(null); setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    setSaving(true); setFormError(null);
    try {
      const url = editing ? `/api/scheduled-reports/${editing.id}` : "/api/scheduled-reports";
      const method = editing ? "PUT" : "POST";
      const payload = { ...form, email_to: form.email_to.split(",").map(s => s.trim()).filter(Boolean) };
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setOpen(false); load();
    } catch (e) { setFormError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const runNow = async (id: number) => {
    setRunningId(id); setRunResult(prev => ({ ...prev, [id]: "" }));
    try {
      const r = await fetch(`/api/scheduled-reports/${id}`, { method: "POST" });
      const d = await r.json();
      setRunResult(prev => ({ ...prev, [id]: d.error ? `Error: ${d.error}` : "Sent!" }));
    } catch { setRunResult(prev => ({ ...prev, [id]: "Error" })); }
    finally { setRunningId(null); load(); }
  };

  const toggleActive = async (r: ScheduledReport) => {
    await fetch(`/api/scheduled-reports/${r.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !r.is_active }) });
    load();
  };

  const deleteReport = async (id: number) => {
    setDeletingId(id);
    await fetch(`/api/scheduled-reports/${id}`, { method: "DELETE" });
    setDeletingId(null); load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarClock className="h-6 w-6 text-primary"/>Scheduled Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Auto-generate and email reports on a cron schedule</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1"/>New Report</Button>
      </div>

      {error && <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-3"><AlertTriangle className="h-4 w-4"/>{error}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/></div>
      ) : reports.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <CalendarClock className="h-8 w-8 mx-auto mb-2 opacity-40"/>
          <p>No scheduled reports yet.</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}><Plus className="h-4 w-4 mr-1"/>Create Report</Button>
        </CardContent></Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium">Type</th>
                <th className="text-left py-2 px-3 font-medium">Format</th>
                <th className="text-left py-2 px-3 font-medium">Schedule</th>
                <th className="text-left py-2 px-3 font-medium">Last Run</th>
                <th className="text-left py-2 px-3 font-medium">Active</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id} className="border-b hover:bg-muted/40 transition-colors">
                  <td className="py-2 px-3 font-medium">{r.name}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.report_type}</td>
                  <td className="py-2 px-3"><Badge variant="outline" className="text-xs uppercase">{r.format}</Badge></td>
                  <td className="py-2 px-3 font-mono text-xs">{r.cron_expression}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1.5">
                      {statusBadge(r.last_run_status)}
                      {r.last_run_at ? <span className="text-xs text-muted-foreground">{new Date(r.last_run_at).toLocaleString()}</span> : <span className="text-xs text-muted-foreground">Never</span>}
                    </div>
                    {runResult[r.id] && <p className="text-xs text-emerald-500 mt-0.5">{runResult[r.id]}</p>}
                  </td>
                  <td className="py-2 px-3">
                    <Switch checked={!!r.is_active} onCheckedChange={() => toggleActive(r)}/>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Run now" onClick={() => runNow(r.id)} disabled={runningId === r.id}>
                        {runningId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Play className="h-3.5 w-3.5"/>}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5"/></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => deleteReport(r.id)} disabled={deletingId === r.id}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Report" : "New Scheduled Report"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Daily Cluster Health"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Report Type</Label>
                <Select value={form.report_type} onValueChange={v => setForm(f => ({ ...f, report_type: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cluster_health">Cluster Health</SelectItem>
                    <SelectItem value="index_stats">Index Stats</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Format</Label>
                <Select value={form.format} onValueChange={v => setForm(f => ({ ...f, format: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Cron Expression</Label>
              <Input value={form.cron_expression} onChange={e => setForm(f => ({ ...f, cron_expression: e.target.value }))} placeholder="0 8 * * *"/>
              <div className="flex gap-1.5 flex-wrap">
                {CRON_PRESETS.map(p => (
                  <button key={p.value} className="text-xs px-2 py-0.5 rounded border border-muted-foreground/30 hover:border-primary transition-colors" onClick={() => setForm(f => ({ ...f, cron_expression: p.value }))}>{p.label}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email Recipients (comma-separated)</Label>
              <Input value={form.email_to} onChange={e => setForm(f => ({ ...f, email_to: e.target.value }))} placeholder="ops@example.com, cto@example.com"/>
            </div>
            <div className="space-y-1.5">
              <Label>Email Subject (optional)</Label>
              <Input value={form.email_subject} onChange={e => setForm(f => ({ ...f, email_subject: e.target.value }))} placeholder="Weekly Cluster Report"/>
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
