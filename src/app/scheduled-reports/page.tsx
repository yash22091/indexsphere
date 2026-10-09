"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, SeverityBadge } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Play, CalendarClock, AlertCircle } from "lucide-react";

interface ScheduledReport {
  id: number; name: string; report_type: string; format: string;
  cron_expression: string; email_to: string; email_subject?: string;
  is_active: number; last_run?: string; last_status?: string;
  created_at: string; next_run?: string; connection_id?: string;
}

interface SavedConnectionOption { id: string; name: string; url: string; engine?: string }

interface FormState {
  name: string; report_type: string; format: string; cron_expression: string;
  email_to: string; email_subject: string; is_active: boolean; connection_id: string;
}
const emptyForm = (): FormState => ({ name: "", report_type: "cluster_health", format: "csv", cron_expression: "0 8 * * *", email_to: "", email_subject: "", is_active: true, connection_id: "" });

const CRON_PRESETS = [
  { label: "Daily 8am", value: "0 8 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Monday 9am", value: "0 9 * * 1" },
  { label: "1st of month", value: "0 8 1 * *" },
];

const REPORT_TYPES: Record<string, string> = { cluster_health: "Cluster health", index_stats: "Index statistics" };

/** last_status is "success" or "error: <message>". */
function LastRun({ report }: { report: ScheduledReport }) {
  if (!report.last_run) return <span className="text-muted-foreground">Never</span>;
  const failed = report.last_status?.startsWith("error");
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <SeverityBadge level={failed ? "high" : "ok"}>{failed ? "Failed" : "Delivered"}</SeverityBadge>
        <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(report.last_run).toLocaleString()}</span>
      </div>
      {failed && <p className="max-w-xs truncate text-xs text-destructive" title={report.last_status}>{report.last_status?.replace(/^error:\s*/, "")}</p>}
    </div>
  );
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
  const [connections, setConnections] = useState<SavedConnectionOption[]>([]);

  useEffect(() => {
    // Reports run against Elasticsearch/OpenSearch connections only
    fetch("/api/saved-connections").then(r => r.json())
      .then(d => setConnections((d.connections ?? []).filter((c: SavedConnectionOption) => c.engine !== "clickhouse")))
      .catch(() => {});
  }, []);

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
    setForm({ name: r.name, report_type: r.report_type, format: r.format, cron_expression: r.cron_expression, email_to: JSON.parse(r.email_to ?? "[]").join(", "), email_subject: r.email_subject ?? "", is_active: !!r.is_active, connection_id: r.connection_id ?? "" });
    setFormError(null); setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    if (!form.connection_id) { setFormError("Choose the cluster this report runs against"); return; }
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
      setRunResult(prev => ({ ...prev, [id]: d.error ? `Error: ${d.error}` : "Run finished" }));
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
    <div className="space-y-6">
      <PageHeader
        title="Scheduled reports"
        description="Generate cluster reports on a cron schedule and email them as CSV or JSON."
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5"/>Add report</Button>}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4"/>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10"/>)}</div>
          ) : reports.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No scheduled reports"
              description="Reports run against a saved connection and need SMTP configured under Settings."
              action={<Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5"/>Add report</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Report</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{REPORT_TYPES[r.report_type] ?? r.report_type}</span>
                          <Badge variant="outline" className="uppercase">{r.format}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.cron_expression}</TableCell>
                      <TableCell>
                        <LastRun report={r}/>
                        {runResult[r.id] && <p className="mt-0.5 text-xs text-muted-foreground">{runResult[r.id]}</p>}
                      </TableCell>
                      <TableCell><Switch checked={!!r.is_active} onCheckedChange={() => toggleActive(r)} aria-label={`Toggle ${r.name}`}/></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" className="h-8" onClick={() => runNow(r.id)} disabled={runningId === r.id}>
                            {runningId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5"/> : <Play className="h-3.5 w-3.5 mr-1.5"/>}
                            Run now
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`}><Pencil className="h-4 w-4"/></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={deletingId === r.id}
                            onClick={() => { if (confirm(`Delete scheduled report "${r.name}"?`)) deleteReport(r.id); }} aria-label={`Delete ${r.name}`}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit scheduled report" : "Add scheduled report"}</DialogTitle>
            <DialogDescription>Times use the server&apos;s time zone.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="rep-name">Name</Label>
              <Input id="rep-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Daily cluster health"/>
            </div>
            <div className="grid gap-2">
              <Label>Cluster</Label>
              <Select value={form.connection_id} onValueChange={v => setForm(f => ({ ...f, connection_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select a saved connection"/></SelectTrigger>
                <SelectContent>
                  {connections.map(c => <SelectItem key={c.id} value={c.id}>{c.name} · {c.url}</SelectItem>)}
                </SelectContent>
              </Select>
              {connections.length === 0 && <p className="text-xs text-muted-foreground">Add an Elasticsearch or OpenSearch connection on the Connections page first.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Report</Label>
                <Select value={form.report_type} onValueChange={v => setForm(f => ({ ...f, report_type: v }))}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cluster_health">Cluster health</SelectItem>
                    <SelectItem value="index_stats">Index statistics</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
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
            <div className="grid gap-2">
              <Label htmlFor="rep-cron">Schedule (cron)</Label>
              <Input id="rep-cron" className="font-mono" value={form.cron_expression} onChange={e => setForm(f => ({ ...f, cron_expression: e.target.value }))} placeholder="0 8 * * *"/>
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map(p => (
                  <Button key={p.value} type="button" size="sm" variant={form.cron_expression === p.value ? "secondary" : "outline"} className="h-7 text-xs"
                    onClick={() => setForm(f => ({ ...f, cron_expression: p.value }))}>{p.label}</Button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rep-to">Recipients</Label>
              <Input id="rep-to" value={form.email_to} onChange={e => setForm(f => ({ ...f, email_to: e.target.value }))} placeholder="ops@example.com, oncall@example.com"/>
              <p className="text-xs text-muted-foreground">Separate addresses with commas.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rep-subject">Email subject</Label>
              <Input id="rep-subject" value={form.email_subject} onChange={e => setForm(f => ({ ...f, email_subject: e.target.value }))} placeholder="Optional"/>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="rep-active">Report is active</Label>
              <Switch id="rep-active" checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}/>
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
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5"/>}{editing ? "Save changes" : "Add report"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
