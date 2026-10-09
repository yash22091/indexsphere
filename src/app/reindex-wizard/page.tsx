"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState, PageHeader, SeverityBadge } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, ChevronRight, CheckCircle, AlertCircle, XCircle, StopCircle, Database } from "lucide-react";
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

  const stepCard = (title: string, description: string | null, body: React.ReactNode) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reindex"
        description="Copy documents from one index to another, optionally filtered, with live task progress."
      />

      {!isConnected ? (
        <EmptyState
          icon={Database}
          title="No cluster connected"
          description="Connect to an Elasticsearch or OpenSearch cluster to reindex data."
          action={<Button asChild><Link href="/connections">Go to connections</Link></Button>}
        />
      ) : (
      <div className="max-w-2xl space-y-6">
        {/* Step indicator */}
        <ol className="flex flex-wrap items-center gap-1 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              <span
                aria-current={i === step ? "step" : undefined}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition-colors ${
                  i === step ? "border-primary bg-primary text-primary-foreground"
                  : i < step ? "border-transparent bg-muted text-foreground"
                  : "border-transparent text-muted-foreground"}`}
              >
                {i < step ? <CheckCircle className="h-3 w-3 text-success" /> : <span className="w-3 text-center tabular-nums">{i + 1}</span>}
                {s}
              </span>
              {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </li>
          ))}
        </ol>

        {step === 0 && stepCard("Source index", "The index to copy documents from.", <>
          {loadingIndices ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
            <div className="grid gap-2">
              <Label>Source index</Label>
              <Select value={srcIndex} onValueChange={setSrcIndex}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select an index" /></SelectTrigger>
                <SelectContent>
                  {indices.map(i => (
                    <SelectItem key={i.name} value={i.name}>
                      <span className="font-mono">{i.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{i.docs?.toLocaleString()} docs · {i.size}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {srcIndex && selectedSrc && (
            <div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Documents</p><p className="font-medium tabular-nums">{selectedSrc.docs.toLocaleString()}</p></div>
              <div><p className="text-xs text-muted-foreground">Size</p><p className="font-medium tabular-nums">{selectedSrc.size}</p></div>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} disabled={!srcIndex}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </>)}

        {step === 1 && stepCard("Destination", "Created automatically if it doesn't exist.", <>
          <div className="grid gap-2">
            <Label htmlFor="rw-dst">Destination index</Label>
            <Input id="rw-dst" value={dstIndex} onChange={e => setDstIndex(e.target.value)} placeholder={`${srcIndex}-v2`} />
          </div>
          <div className="grid gap-2">
            <Label>On version conflict</Label>
            <Select value={conflicts} onValueChange={v => setConflicts(v as "abort" | "proceed")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="abort">Abort the reindex</SelectItem>
                <SelectItem value="proceed">Skip conflicting documents and continue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)} disabled={!dstIndex}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </>)}

        {step === 2 && stepCard("Filter (optional)", "Only documents matching this query are copied. Keep match_all to copy everything.", <>
          <div className="grid gap-2">
            <Label htmlFor="rw-query">Query DSL</Label>
            <Textarea id="rw-query" value={queryFilter} onChange={e => { setQueryFilter(e.target.value); setQueryError(null); }} className="min-h-[140px] font-mono text-xs" />
            {queryError && <p className="text-xs text-destructive">{queryError}</p>}
          </div>
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => setStep(3)}>Review <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </>)}

        {step === 3 && stepCard("Review", null, <>
          <dl className="divide-y rounded-md border text-sm">
            {[
              ["Source", <span key="s" className="font-mono">{srcIndex}</span>],
              ["Destination", <span key="d" className="font-mono">{dstIndex}</span>],
              ["On conflict", conflicts === "abort" ? "Abort" : "Skip and continue"],
              ["Estimated documents", selectedSrc?.docs.toLocaleString() ?? "Unknown"],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-4 px-3 py-2">
                <dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {startError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{startError}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
            <Button onClick={startReindex} disabled={starting}>
              {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {starting ? "Starting…" : "Start reindex"}
            </Button>
          </div>
        </>)}

        {step === 4 && task && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Progress</CardTitle>
              {task.completed && !task.error && <SeverityBadge level="ok"><CheckCircle className="mr-1 h-3.5 w-3.5" />Complete</SeverityBadge>}
              {task.completed && task.error && <SeverityBadge level="critical"><XCircle className="mr-1 h-3.5 w-3.5" />Failed</SeverityBadge>}
              {!task.completed && <Badge variant="secondary"><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />Running</Badge>}
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{(task.created + task.updated + task.deleted || 0).toLocaleString()} of {(task.total || 0).toLocaleString()} documents</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Created", task.created, ""],
                  ["Updated", task.updated, ""],
                  ["Deleted", task.deleted, ""],
                  ["Conflicts", task.conflicts, task.conflicts > 0 ? "text-warning" : ""],
                ].map(([label, value, cls]) => (
                  <div key={String(label)} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`mt-1 text-xl font-semibold tabular-nums ${cls}`}>{Number(value ?? 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>

              {task.error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{task.error}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                {!task.completed && (
                  <Button variant="destructive" onClick={cancelTask} disabled={cancelling}>
                    {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StopCircle className="mr-2 h-4 w-4" />}
                    Cancel reindex
                  </Button>
                )}
                {task.completed && (
                  <Button variant="outline" onClick={() => { setStep(0); setTaskId(null); setTask(null); setSrcIndex(""); setDstIndex(""); }}>
                    <RefreshCw className="mr-2 h-4 w-4" />New reindex
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      )}
    </div>
  );
}
