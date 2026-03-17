"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { useConnection } from "@/contexts/connection-context";
import {
  Activity, Cpu, Database, AlertTriangle, CheckCircle, XCircle,
  Wifi, WifiOff, Settings, RefreshCw, Zap, Server, PlugZap
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

function statusColor(status: string): string {
  if (status === "green") return "text-emerald-500";
  if (status === "yellow") return "text-yellow-500";
  if (status === "red") return "text-red-500";
  return "text-muted-foreground";
}

function levelFor(value: number, warn: number, crit: number): "ok" | "warn" | "crit" {
  if (value >= crit) return "crit";
  if (value >= warn) return "warn";
  return "ok";
}

function levelColor(level: "ok" | "warn" | "crit"): string {
  if (level === "crit") return "bg-red-500";
  if (level === "warn") return "bg-yellow-500";
  return "bg-emerald-500";
}

function MiniChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 100);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 200},${60 - (v / max) * 55}`).join(" ");
  return (
    <svg viewBox="0 0 200 60" className="w-full h-12 opacity-80">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function GaugeBar({ value, warn, crit, label }: { value: number; warn: number; crit: number; label: string }) {
  const level = levelFor(value, warn, crit);
  const color = level === "crit" ? "text-red-500" : level === "warn" ? "text-yellow-500" : "text-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className={`font-mono font-bold ${color}`}>{value.toFixed(1)}%</span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${levelColor(level)}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
        <div className="absolute top-0 h-full w-0.5 bg-yellow-400 opacity-60" style={{ left: `${warn}%` }} />
        <div className="absolute top-0 h-full w-0.5 bg-red-400 opacity-60" style={{ left: `${crit}%` }} />
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

  const StatusIcon = connected
    ? () => <Wifi className="h-4 w-4 text-emerald-500 animate-pulse" />
    : () => <WifiOff className="h-4 w-4 text-red-500" />;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Real-Time Monitoring
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Live cluster metrics — updates every 5 seconds</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm">
            <StatusIcon />
            <span className={connected ? "text-emerald-600" : "text-red-500"}>
              {connected ? "Live" : "Disconnected"}
            </span>
          </div>
          {metrics && (
            <Badge variant={metrics.cluster_status === "green" ? "default" : "destructive"}
              className={metrics.cluster_status === "green" ? "bg-emerald-500" : metrics.cluster_status === "yellow" ? "bg-yellow-500" : ""}>
              {metrics.cluster_status.toUpperCase()}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)}>
            <Settings className="h-4 w-4 mr-1" /> Thresholds
          </Button>
          <Button variant="outline" size="sm" onClick={() => reconnectServer()} disabled={reconnecting}>
            {reconnecting
              ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              : <RefreshCw className="h-4 w-4 mr-1" />}
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </Button>
        </div>
      </div>

      {/* Active alerts banner */}
      {alerts.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
          <div className="text-sm text-yellow-700 dark:text-yellow-400 space-y-0.5">
            {alerts.map((a, i) => <div key={i}>{a}</div>)}
          </div>
        </div>
      )}

      {reconnecting && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2">
          <PlugZap className="h-4 w-4 shrink-0 animate-pulse" />
          Re-registering cluster connection on server… stream will resume shortly.
        </div>
      )}

      {error && error !== 'no_client_needs_reconnect' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {error === 'no_client_needs_reconnect' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <PlugZap className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Server lost the cluster connection (e.g. after a restart).
            </p>
            <p className="text-xs text-muted-foreground">
              Credentials are not stored in the browser after a page refresh. Please reconnect to restore the stream.
            </p>
            <Link href="/connect">
              <button className="mt-1 text-xs font-medium px-3 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                Go to Connect →
              </button>
            </Link>
          </div>
        </div>
      )}

      {/* Threshold settings panel */}
      {showSettings && (
        <Card>
          <CardHeader><CardTitle className="text-base">Alert Thresholds</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {([
                ["cpu_warn", "CPU Warn %"], ["cpu_crit", "CPU Crit %"],
                ["heap_warn", "Heap Warn %"], ["heap_crit", "Heap Crit %"],
                ["gc_warn", "GC Warn %"], ["gc_crit", "GC Crit %"],
                ["unassigned_shards_warn", "Unassigned Warn"], ["unassigned_shards_crit", "Unassigned Crit"],
              ] as [keyof Thresholds, string][]).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input type="number" value={thresholds[key]} min={0} max={1000}
                    onChange={e => setThresholds(t => ({ ...t, [key]: Number(e.target.value) }))}
                    className="w-full rounded border bg-background px-2 py-1 text-sm" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <Button size="sm" onClick={saveThresholds}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!metrics && !error && (
        <div className="text-center text-muted-foreground py-12">
          <Activity className="h-8 w-8 mx-auto mb-2 animate-pulse" />
          Waiting for first metrics sample…
        </div>
      )}

      {metrics && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
                  <Cpu className="h-3.5 w-3.5" /> Nodes
                </div>
                <div className="text-3xl font-bold">{metrics.node_count}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
                  <Database className="h-3.5 w-3.5" /> Active Shards
                </div>
                <div className="text-3xl font-bold">{metrics.active_shards.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
                  <AlertTriangle className="h-3.5 w-3.5" /> Unassigned
                </div>
                <div className={`text-3xl font-bold ${metrics.unassigned_shards > 0 ? "text-yellow-500" : "text-emerald-500"}`}>
                  {metrics.unassigned_shards}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
                  <Zap className="h-3.5 w-3.5" /> Indexing Rate
                </div>
                <div className="text-3xl font-bold">{metrics.indexing_rate.toFixed(1)}<span className="text-base text-muted-foreground ml-1">doc/s</span></div>
              </CardContent>
            </Card>
          </div>

          {/* Gauge bars */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" /> Resource Utilisation</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <GaugeBar value={metrics.cpu_percent} warn={thresholds.cpu_warn} crit={thresholds.cpu_crit} label="CPU" />
              <GaugeBar value={metrics.heap_percent} warn={thresholds.heap_warn} crit={thresholds.heap_crit} label={`JVM Heap (${formatBytes(metrics.heap_used_bytes)} / ${formatBytes(metrics.heap_max_bytes)})`} />
              <GaugeBar value={metrics.gc_pressure} warn={thresholds.gc_warn} crit={thresholds.gc_crit} label="GC Pressure" />
            </CardContent>
          </Card>

          {/* Sparkline charts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">CPU % (last {cpuHistory.length} samples)</CardTitle></CardHeader>
              <CardContent>
                <MiniChart data={cpuHistory} color="#3b82f6" />
                <div className="text-right text-lg font-bold mt-1">{metrics.cpu_percent.toFixed(1)}%</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">JVM Heap %</CardTitle></CardHeader>
              <CardContent>
                <MiniChart data={heapHistory} color="#8b5cf6" />
                <div className="text-right text-lg font-bold mt-1">{metrics.heap_percent.toFixed(1)}%</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">GC Pressure %</CardTitle></CardHeader>
              <CardContent>
                <MiniChart data={gcHistory} color="#f59e0b" />
                <div className="text-right text-lg font-bold mt-1">{metrics.gc_pressure.toFixed(1)}%</div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
