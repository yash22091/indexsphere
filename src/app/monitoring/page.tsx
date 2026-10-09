"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { EmptyState, HealthBadge, PageHeader, StatCard, StatGrid, StatusDot } from "@/components/app";
import { useConnection } from "@/contexts/connection-context";
import {
  AlertTriangle, Database, PlugZap, RefreshCw, Server, Settings, XCircle, Zap,
} from "lucide-react";

interface Metrics {
  type: string;
  cpu_percent: number;
  heap_percent: number;
  heap_used_bytes: number;
  heap_max_bytes: number;
  gc_pressure: number;
  unassigned_shards: number;
  active_shards: number;
  docs_count: number;
  indexing_rate: number;
  node_count: number;
  cluster_status: string;
  message?: string;
}

interface Thresholds {
  cpu_warn: number; cpu_crit: number;
  heap_warn: number; heap_crit: number;
  gc_warn: number; gc_crit: number;
  unassigned_shards_warn: number; unassigned_shards_crit: number;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  cpu_warn: 70, cpu_crit: 90,
  heap_warn: 75, heap_crit: 90,
  gc_warn: 30, gc_crit: 60,
  unassigned_shards_warn: 1, unassigned_shards_crit: 10,
};

const MAX_HISTORY = 60;

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

function levelFor(value: number, warn: number, crit: number): "ok" | "warn" | "crit" {
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "ok";
}

const LEVEL_BAR = { ok: "bg-success", warn: "bg-warning", crit: "bg-destructive" } as const;
const LEVEL_TEXT = { ok: "text-foreground", warn: "text-warning", crit: "text-destructive" } as const;

function MiniChart({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) {
    return <div className="flex h-12 items-center text-xs text-muted-foreground">Collecting samples…</div>;
  }
  const max = Math.max(...data, 100);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 200},${60 - (v / max) * 55}`).join(" ");
  return (
    <svg viewBox="0 0 200 60" className="h-12 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function GaugeBar({ value, warn, crit, label }: { value: number; warn: number; crit: number; label: string }) {
  const level = levelFor(value, warn, crit);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium tabular-nums ${LEVEL_TEXT[level]}`}>{value.toFixed(1)}%</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${LEVEL_BAR[level]}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
        <div className="absolute top-0 h-full w-px bg-warning" style={{ left: `${warn}%` }} title={`Warning at ${warn}%`} />
        <div className="absolute top-0 h-full w-px bg-destructive" style={{ left: `${crit}%` }} title={`Critical at ${crit}%`} />
      </div>
    </div>
  );
}

export default function MonitoringPage() {
  const { connectionConfig, currentSavedConnectionId } = useConnection();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [showSettings, setShowSettings] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [heapHistory, setHeapHistory] = useState<number[]>([]);
  const [gcHistory, setGcHistory] = useState<number[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const connectionConfigRef = useRef(connectionConfig);
  useEffect(() => { connectionConfigRef.current = connectionConfig; }, [connectionConfig]);

  // Re-register the server-side ES client then restart the SSE stream
  const reconnectServer = useCallback(async () => {
    const cfg = connectionConfigRef.current;
    setReconnecting(true);
    setError(null);
    try {
      if (currentSavedConnectionId) {
        // Use server-side encrypted saved connection — no credentials needed client-side
        const res = await fetch(`/api/saved-connections/${currentSavedConnectionId}/connect`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error ?? 'reconnect failed');
      } else if (cfg?.auth?.username && cfg?.auth?.password) {
        const res = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cfg.url, username: cfg.auth.username, password: cfg.auth.password, type: cfg.type }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'reconnect failed');
      } else {
        // No credentials in memory and no saved connection — user must reconnect manually
        setError('no_client_needs_reconnect');
        setReconnecting(false);
        return;
      }
    } catch (err: any) {
      setError(`Reconnect failed: ${err.message}`);
      setReconnecting(false);
      return;
    }
    setReconnecting(false);
    connectSSERef.current?.();
  }, [currentSavedConnectionId]);

  const connectSSERef = useRef<(() => void) | null>(null);

  const connectSSE = useCallback(() => {
    if (esRef.current) { esRef.current.close(); }
    const es = new EventSource("/api/monitoring/stream");
    esRef.current = es;
    es.onopen = () => { setConnected(true); setError(null); };
    es.onmessage = (e) => {
      try {
        const data: Metrics = JSON.parse(e.data);
        if (data.type === "error") {
          if (data.message === 'no_client') {
            setConnected(false);
            reconnectServer();
          } else {
            setError(data.message ?? "Unknown error");
          }
          return;
        }
        setMetrics(data);
        setCpuHistory(h => [...h.slice(-(MAX_HISTORY - 1)), data.cpu_percent]);
        setHeapHistory(h => [...h.slice(-(MAX_HISTORY - 1)), data.heap_percent]);
        setGcHistory(h => [...h.slice(-(MAX_HISTORY - 1)), data.gc_pressure]);

        // Collect active threshold alerts
        const newAlerts: string[] = [];
        if (data.cpu_percent >= thresholds.cpu_crit) newAlerts.push(`CPU critical: ${data.cpu_percent.toFixed(1)}%`);
        else if (data.cpu_percent >= thresholds.cpu_warn) newAlerts.push(`CPU warning: ${data.cpu_percent.toFixed(1)}%`);
        if (data.heap_percent >= thresholds.heap_crit) newAlerts.push(`Heap critical: ${data.heap_percent.toFixed(1)}%`);
        else if (data.heap_percent >= thresholds.heap_warn) newAlerts.push(`Heap warning: ${data.heap_percent.toFixed(1)}%`);
        if (data.unassigned_shards >= thresholds.unassigned_shards_crit) newAlerts.push(`Unassigned shards critical: ${data.unassigned_shards}`);
        else if (data.unassigned_shards >= thresholds.unassigned_shards_warn) newAlerts.push(`Unassigned shards warning: ${data.unassigned_shards}`);
        setAlerts(newAlerts);
      } catch { /* ignore parse error */ }
    };
    es.onerror = () => { setConnected(false); };
  }, [thresholds, reconnectServer]);

  // keep ref in sync so reconnectServer can call connectSSE without a dep cycle
  useEffect(() => { connectSSERef.current = connectSSE; }, [connectSSE]);

  useEffect(() => {
    fetch("/api/monitoring/thresholds")
      .then(r => r.json())
      .then(t => setThresholds({ ...DEFAULT_THRESHOLDS, ...t }))
      .catch(() => {});
    connectSSE();
    return () => { esRef.current?.close(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const saveThresholds = async () => {
    await fetch("/api/monitoring/thresholds", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(thresholds),
    });
    setShowSettings(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live monitoring"
        description="Cluster metrics streamed every 5 seconds, checked against your alert thresholds."
        meta={
          <>
            <Badge variant="outline" className="gap-1.5 font-medium">
              <StatusDot status={connected ? "green" : "red"} />
              {connected ? "Live" : "Disconnected"}
            </Badge>
            {metrics && <HealthBadge status={metrics.cluster_status} />}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>
              <Settings className="h-4 w-4 mr-2" />
              Thresholds
            </Button>
            <Button variant="outline" size="sm" onClick={() => reconnectServer()} disabled={reconnecting}>
              <RefreshCw className={`h-4 w-4 mr-2 ${reconnecting ? "animate-spin" : ""}`} />
              {reconnecting ? "Reconnecting…" : "Reconnect"}
            </Button>
          </>
        }
      />

      {alerts.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle>Thresholds exceeded</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {alerts.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {reconnecting && (
        <Alert>
          <PlugZap className="h-4 w-4" />
          <AlertDescription>Re-registering the cluster connection on the server. The stream resumes shortly.</AlertDescription>
        </Alert>
      )}

      {error && error !== 'no_client_needs_reconnect' && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {error === 'no_client_needs_reconnect' && (
        <EmptyState
          icon={PlugZap}
          title="Cluster connection needed"
          description="The server has no active cluster connection for you (for example after a restart). Connect again to resume the stream."
          action={<Button size="sm" asChild><Link href="/connections">Go to connections</Link></Button>}
        />
      )}

      {showSettings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alert thresholds</CardTitle>
            <CardDescription>Values at which metrics are flagged as warning or critical on this page.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {([
                ["cpu_warn", "CPU warning (%)"], ["cpu_crit", "CPU critical (%)"],
                ["heap_warn", "Heap warning (%)"], ["heap_crit", "Heap critical (%)"],
                ["gc_warn", "GC warning (%)"], ["gc_crit", "GC critical (%)"],
                ["unassigned_shards_warn", "Unassigned warning"], ["unassigned_shards_crit", "Unassigned critical"],
              ] as [keyof Thresholds, string][]).map(([key, label]) => (
                <div key={key} className="grid gap-2">
                  <Label htmlFor={`t-${key}`} className="text-xs text-muted-foreground">{label}</Label>
                  <Input
                    id={`t-${key}`}
                    type="number"
                    value={thresholds[key]}
                    min={0}
                    max={1000}
                    onChange={e => setThresholds(t => ({ ...t, [key]: Number(e.target.value) }))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={saveThresholds}>Save thresholds</Button>
              <Button size="sm" variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!metrics && !error && (
        <div className="space-y-6">
          <StatGrid>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
          </StatGrid>
          <p className="text-center text-sm text-muted-foreground">Waiting for the first metrics sample…</p>
        </div>
      )}

      {metrics && (
        <>
          <StatGrid>
            <StatCard label="Nodes" icon={Server} value={metrics.node_count} />
            <StatCard label="Active shards" icon={Database} value={metrics.active_shards.toLocaleString()} />
            <StatCard
              label="Unassigned shards"
              icon={AlertTriangle}
              value={metrics.unassigned_shards}
              tone={metrics.unassigned_shards >= thresholds.unassigned_shards_crit ? "danger" : metrics.unassigned_shards >= thresholds.unassigned_shards_warn ? "warning" : "default"}
            />
            <StatCard label="Indexing rate" icon={Zap} value={metrics.indexing_rate.toFixed(1)} hint="documents per second" />
          </StatGrid>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resource utilisation</CardTitle>
              <CardDescription>Markers show the warning and critical thresholds.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <GaugeBar value={metrics.cpu_percent} warn={thresholds.cpu_warn} crit={thresholds.cpu_crit} label="CPU" />
              <GaugeBar value={metrics.heap_percent} warn={thresholds.heap_warn} crit={thresholds.heap_crit} label={`JVM heap (${formatBytes(metrics.heap_used_bytes)} of ${formatBytes(metrics.heap_max_bytes)})`} />
              <GaugeBar value={metrics.gc_pressure} warn={thresholds.gc_warn} crit={thresholds.gc_crit} label="GC pressure" />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { title: "CPU", data: cpuHistory, value: metrics.cpu_percent, color: "var(--chart-1)" },
              { title: "JVM heap", data: heapHistory, value: metrics.heap_percent, color: "var(--chart-2)" },
              { title: "GC pressure", data: gcHistory, value: metrics.gc_pressure, color: "var(--chart-4)" },
            ].map(c => (
              <Card key={c.title}>
                <CardHeader className="pb-2">
                  <div className="flex items-baseline justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
                    <span className="text-lg font-semibold tabular-nums">{c.value.toFixed(1)}%</span>
                  </div>
                  <CardDescription className="text-xs">Last {c.data.length} samples</CardDescription>
                </CardHeader>
                <CardContent>
                  <MiniChart data={c.data} color={c.color} />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
