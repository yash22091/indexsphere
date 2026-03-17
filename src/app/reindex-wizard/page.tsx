"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, ChevronRight, CheckCircle, AlertTriangle, XCircle, StopCircle } from "lucide-react";
import { getElasticsearchClient } from "@/lib/elasticsearch";
import { useConnection } from "@/contexts/connection-context";

interface IndexInfo { name: string; docs: number; size: string }
interface TaskStatus {
  task_id: string; completed: boolean; total: number; created: number;
  updated: number; deleted: number; conflicts: number; status_text: string;
  error?: string;
}

const STEPS = ["Source", "Destination", "Filter", "Confirm", "Progress"];

export default function ReindexWizardPage() {
  const { isConnected } = useConnection();
  const [step, setStep] = useState(0);
  const [indices, setIndices] = useState<IndexInfo[]>([]);
  const [loadingIndices, setLoadingIndices] = useState(false);

  // Form state
  const [srcIndex, setSrcIndex] = useState("");
  const [dstIndex, setDstIndex] = useState("");
  const [conflicts, setConflicts] = useState<"abort"|"proceed">("abort");
  const [queryFilter, setQueryFilter] = useState('{\n  "match_all": {}\n}');
  const [queryError, setQueryError] = useState<string|null>(null);

  // Task state
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string|null>(null);
  const [taskId, setTaskId] = useState<string|null>(null);
  const [task, setTask] = useState<TaskStatus|null>(null);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const loadIndices = useCallback(async () => {
    const client = getElasticsearchClient();
    if (!client) return;
    setLoadingIndices(true);
    try {
      const raw: Record<string, string>[] = await client.request("/_cat/indices?format=json");
      const list: IndexInfo[] = (Array.isArray(raw) ? raw : []).map(idx => ({
        name: idx.index ?? idx.name ?? "",
        docs: Number(idx["docs.count"] ?? idx.docs ?? 0),
        size: idx["store.size"] ?? idx.size ?? "?",
      })).filter(i => i.name && !i.name.startsWith("."));
      setIndices(list);
    } catch { /* ignore */ }
    finally { setLoadingIndices(false); }
  }, []);

  useEffect(() => {
    if (isConnected) loadIndices();
    else setIndices([]);
  }, [isConnected, loadIndices]);

  const stopPolling = useCallback(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollTask = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/reindex?task=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (d.error) { setTask(t => ({ ...(t!), error: d.error, completed: true })); stopPolling(); return; }
      setTask(d);
      if (d.completed) stopPolling();
    } catch { /* keep polling */ }
  }, [stopPolling]);

  const startReindex = async () => {
    setQueryError(null);
    try { JSON.parse(queryFilter); } catch { setQueryError("Invalid JSON in query filter"); return; }
    if (!srcIndex || !dstIndex) { setStartError("Source and destination are required"); return; }
    setStarting(true); setStartError(null);
    try {
      const r = await fetch("/api/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_index: srcIndex, dest_index: dstIndex, conflicts, query: JSON.parse(queryFilter) }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setTaskId(d.task_id);
      setTask({ task_id: d.task_id, completed: false, total: 0, created: 0, updated: 0, deleted: 0, conflicts: 0, status_text: "Starting..." });
      setStep(4);
      pollRef.current = setInterval(() => pollTask(d.task_id), 2000);
    } catch (e) { setStartError(e instanceof Error ? e.message : "Failed to start"); }
    finally { setStarting(false); }
  };

  const cancelTask = async () => {
    if (!taskId) return;
    setCancelling(true);
    await fetch(`/api/reindex?task=${encodeURIComponent(taskId)}`, { method: "DELETE" }).catch(() => {});
    stopPolling();
    setTask(t => t ? { ...t, completed: true, status_text: "Cancelled" } : t);
    setCancelling(false);
  };

  const progress = task && task.total > 0 ? Math.min(100, Math.round(((task.created + task.updated + task.deleted) / task.total) * 100)) : (task && !task.completed ? 5 : 100);

  const selectedSrc = indices.find(i => i.name === srcIndex);

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><RefreshCw className="h-6 w-6 text-primary"/>Reindex Wizard</h1>
        <p className="text-sm text-muted-foreground mt-1">Guided reindex with live task progress</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
              {i < step ? <CheckCircle className="h-3 w-3"/> : <span className="w-3 text-center">{i+1}</span>}
              {s}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground"/>}
          </div>
        ))}
      </div>

      {/* Step 0: Source */}
      {step === 0 && (
        <Card><CardContent className="pt-6 space-y-4">
          <h3 className="font-medium">Select Source Index</h3>
          {loadingIndices ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/></div> : (
            <div className="space-y-1.5">
              <Label>Source Index <span className="text-red-500">*</span></Label>
              <Select value={srcIndex} onValueChange={setSrcIndex}>
                <SelectTrigger><SelectValue placeholder="Select index..."/></SelectTrigger>
                <SelectContent>
                  {indices.map(i => (
                    <SelectItem key={i.name} value={i.name}>
                      <span className="font-mono">{i.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{i.docs?.toLocaleString()} docs · {i.size}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {srcIndex && selectedSrc && (
            <div className="rounded border bg-muted/30 p-3 text-sm grid grid-cols-2 gap-2">
              <div><p className="text-muted-foreground text-xs">Documents</p><p className="font-bold">{selectedSrc.docs.toLocaleString()}</p></div>
              <div><p className="text-muted-foreground text-xs">Size</p><p className="font-bold">{selectedSrc.size}</p></div>
            </div>
          )}
          <Button onClick={() => setStep(1)} disabled={!srcIndex} className="w-full">Next <ChevronRight className="h-4 w-4 ml-1"/></Button>
        </CardContent></Card>
      )}

      {/* Step 1: Destination */}
      {step === 1 && (
        <Card><CardContent className="pt-6 space-y-4">
          <h3 className="font-medium">Destination Index</h3>
          <div className="space-y-1.5">
            <Label>Destination Index Name <span className="text-red-500">*</span></Label>
            <Input value={dstIndex} onChange={e => setDstIndex(e.target.value)} placeholder={`${srcIndex}-v2`}/>
            <p className="text-xs text-muted-foreground">Will be created if it does not exist</p>
          </div>
          <div className="space-y-1.5">
            <Label>On Conflict</Label>
            <Select value={conflicts} onValueChange={v => setConflicts(v as "abort"|"proceed")}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="abort">Abort on conflict</SelectItem>
                <SelectItem value="proceed">Proceed (skip conflicting docs)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)} disabled={!dstIndex} className="flex-1">Next <ChevronRight className="h-4 w-4 ml-1"/></Button>
          </div>
        </CardContent></Card>
      )}

      {/* Step 2: Filter */}
      {step === 2 && (
        <Card><CardContent className="pt-6 space-y-4">
          <h3 className="font-medium">Query Filter (optional)</h3>
          <p className="text-xs text-muted-foreground">Only documents matching this query will be reindexed. Use <code className="bg-muted px-1 rounded">match_all</code> to copy everything.</p>
          <div className="space-y-1.5">
            <Label>Query DSL</Label>
            <Textarea value={queryFilter} onChange={e => { setQueryFilter(e.target.value); setQueryError(null); }} className="font-mono text-sm min-h-[120px]"/>
            {queryError && <p className="text-xs text-red-500">{queryError}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => setStep(3)} className="flex-1">Review <ChevronRight className="h-4 w-4 ml-1"/></Button>
          </div>
        </CardContent></Card>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <Card><CardContent className="pt-6 space-y-4">
          <h3 className="font-medium">Confirm Reindex</h3>
          <div className="rounded border bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Source</span><span className="font-mono">{srcIndex}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Destination</span><span className="font-mono">{dstIndex}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">On Conflict</span><span>{conflicts}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Estimated docs</span><span>{selectedSrc?.docs.toLocaleString() ?? "?"}</span></div>
          </div>
          {startError && <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2"><AlertTriangle className="h-4 w-4"/>{startError}</div>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
            <Button onClick={startReindex} disabled={starting} className="flex-1">
              {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <RefreshCw className="h-4 w-4 mr-2"/>}
              {starting ? "Starting..." : "Start Reindex"}
            </Button>
          </div>
        </CardContent></Card>
      )}

      {/* Step 4: Progress */}
      {step === 4 && task && (
        <Card><CardContent className="pt-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Reindex Progress</h3>
            {task.completed && !task.error && <Badge className="bg-emerald-500 text-white"><CheckCircle className="h-3.5 w-3.5 mr-1"/>Complete</Badge>}
            {task.completed && task.error && <Badge variant="destructive"><XCircle className="h-3.5 w-3.5 mr-1"/>Failed</Badge>}
            {!task.completed && <Badge variant="secondary"><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin"/>Running</Badge>}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{(task.created + task.updated + task.deleted || 0).toLocaleString()} / {(task.total || 0).toLocaleString()} docs</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress}/>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-center">
            <div className="rounded border p-2"><p className="text-2xl font-bold text-emerald-500">{task.created?.toLocaleString()}</p><p className="text-xs text-muted-foreground">Created</p></div>
            <div className="rounded border p-2"><p className="text-2xl font-bold text-blue-500">{task.updated?.toLocaleString()}</p><p className="text-xs text-muted-foreground">Updated</p></div>
            <div className="rounded border p-2"><p className="text-2xl font-bold text-muted-foreground">{task.deleted?.toLocaleString()}</p><p className="text-xs text-muted-foreground">Deleted</p></div>
            <div className="rounded border p-2"><p className={`text-2xl font-bold ${task.conflicts > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{task.conflicts?.toLocaleString()}</p><p className="text-xs text-muted-foreground">Conflicts</p></div>
          </div>

          {task.error && <div className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5"/>{task.error}</div>}

          <div className="flex gap-2">
            {!task.completed && (
              <Button variant="destructive" onClick={cancelTask} disabled={cancelling} className="flex-1">
                {cancelling ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <StopCircle className="h-4 w-4 mr-2"/>}
                Cancel
              </Button>
            )}
            {task.completed && (
              <Button variant="outline" className="flex-1" onClick={() => { setStep(0); setTaskId(null); setTask(null); setSrcIndex(""); setDstIndex(""); }}>
                <RefreshCw className="h-4 w-4 mr-2"/>New Reindex
              </Button>
            )}
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
