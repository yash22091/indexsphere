"use client";

/**
 * Shared client pieces for the ClickHouse pages: connection state, the connect
 * gate shown when no ClickHouse session exists, formatters and small widgets.
 * All data comes from /api/clickhouse/* — the browser never holds credentials.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState, PageHeader, StatCard } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { AlertCircle, Database, Loader2, PlugZap, RefreshCw as RefreshIcon, Unplug } from "lucide-react";

export interface ClickHouseStatus {
  connected: boolean;
  url?: string;
  version?: string;
  username?: string;
  savedConnectionId?: string | null;
}

/** fetch → JSON, throwing the API's error message on non-2xx. */
export async function chFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? data.message ?? `Request failed (${r.status})`);
  return data as T;
}

export function useClickHouseConnection() {
  const [status, setStatus] = useState<ClickHouseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setStatus(await chFetch<ClickHouseStatus>("/api/clickhouse/connect"));
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await fetch("/api/clickhouse/connect", { method: "DELETE" }).catch(() => {});
    setStatus({ connected: false });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { status, loading, refresh, disconnect };
}

interface SavedConn { id: string; name: string; url: string; engine?: string; color?: string }

/** Renders children only when the user has a ClickHouse session; otherwise a connect panel. */
export function ClickHouseGate({ children }: { children: (status: ClickHouseStatus, disconnect: () => void) => ReactNode }) {
  const { status, loading, refresh, disconnect } = useClickHouseConnection();
  const { user } = useAuth();
  const canAdHoc = !!user?.permissions?.includes("user");
  const [saved, setSaved] = useState<SavedConn[]>([]);
  const [form, setForm] = useState({ url: "http://localhost:8123", username: "default", password: "", verifyTls: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status && !status.connected) {
      chFetch<{ connections: SavedConn[] }>("/api/saved-connections")
        .then(d => setSaved((d.connections ?? []).filter(c => c.engine === "clickhouse")))
        .catch(() => setSaved([]));
    }
  }, [status]);

  const connectSaved = async (id: string) => {
    setBusy(id); setError(null);
    try {
      const d = await chFetch<{ ok: boolean; error?: string }>(`/api/saved-connections/${id}/connect`, { method: "POST" });
      if (!d.ok) throw new Error(d.error ?? "Connection failed");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Connection failed"); }
    finally { setBusy(null); }
  };

  const connectAdHoc = async () => {
    setBusy("adhoc"); setError(null);
    try {
      await chFetch("/api/clickhouse/connect", { method: "POST", body: JSON.stringify(form) });
      setForm(f => ({ ...f, password: "" }));
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Connection failed"); }
    finally { setBusy(null); }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (status?.connected) return <>{children(status, disconnect)}</>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connect to ClickHouse"
        description="Connect over the HTTP interface (port 8123, or 8443 for HTTPS). This session is separate from your Elasticsearch / OpenSearch connection."
      />
      <ErrorBanner message={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved connections</CardTitle>
            <CardDescription>ClickHouse servers an administrator has made available to your role.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {saved.length === 0 ? (
              <EmptyState
                icon={Database}
                title="No saved ClickHouse connections"
                description="Administrators can add one on the Connections page with engine set to ClickHouse."
                className="p-6"
              />
            ) : saved.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.url}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => connectSaved(c.id)} disabled={!!busy}>
                  {busy === c.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" />}Connect
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        {canAdHoc && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connect directly</CardTitle>
              <CardDescription>Credentials are sent to the IndexSphere server once and never stored in the browser.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="ch-url">URL</Label>
                <Input id="ch-url" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://clickhouse.example.com:8443" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ch-user">Username</Label>
                  <Input id="ch-user" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoComplete="off" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ch-pass">Password</Label>
                  <Input id="ch-pass" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="ch-tls" checked={form.verifyTls} onCheckedChange={v => setForm(f => ({ ...f, verifyTls: v }))} />
                <Label htmlFor="ch-tls" className="font-normal">Verify TLS certificate</Label>
              </div>
              <Button onClick={connectAdHoc} disabled={!!busy || !form.url}>
                {busy === "adhoc" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1.5 h-4 w-4" />}Connect
              </Button>
              <p className="text-xs text-muted-foreground">Use a dedicated ClickHouse user with only the grants IndexSphere needs, and a settings profile that enforces limits server-side.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Header used on every ClickHouse page: PageHeader + server context + disconnect. */
export function ClickHouseHeader({ title, description, status, onDisconnect, actions }: {
  title: string;
  description?: ReactNode;
  /** Kept for compatibility; page headers no longer show decorative icons. */
  icon?: ReactNode;
  status: ClickHouseStatus;
  onDisconnect: () => void;
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={title}
      description={description}
      meta={
        <>
          <Badge variant="outline" className="font-normal">ClickHouse {status.version}</Badge>
          <span className="truncate text-xs text-muted-foreground">{status.username}@{status.url}</span>
        </>
      }
      actions={
        <>
          {actions}
          <Button variant="outline" size="sm" onClick={onDisconnect}><Unplug className="mr-1.5 h-3.5 w-3.5" />Disconnect</Button>
        </>
      }
    />
  );
}

export function formatBytes(b: number | null | undefined): string {
  const n = Number(b ?? 0);
  if (!n) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.abs(n)) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat().format(Number(n ?? 0));
}

export function formatCompact(n: number | null | undefined): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(Number(n ?? 0));
}

export function formatDuration(seconds: number | null | undefined): string {
  let s = Math.floor(Number(seconds ?? 0));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function formatMs(ms: number | null | undefined): string {
  const n = Number(ms ?? 0);
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
}

/** Tiny SVG sparkline. */
export function MiniChart({ data, color, height = 48 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} className="flex items-center text-xs text-muted-foreground">Collecting…</div>;
  const max = Math.max(...data, 1);
  const w = 200;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - (v / max) * (height - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "crit" }) {
  return <StatCard label={label} value={value} hint={sub} tone={tone === "crit" ? "danger" : tone === "warn" ? "warning" : "default"} />;
}

/** Generic result grid for query results / sample rows. */
export function ResultTable({ rows, columns, maxHeight = 480 }: {
  rows: Record<string, unknown>[];
  columns?: { name: string; type?: string }[];
  maxHeight?: number;
}) {
  const cols: { name: string; type?: string }[] = columns?.length ? columns : Object.keys(rows[0] ?? {}).map(name => ({ name }));
  if (!rows.length) return <p className="text-sm text-muted-foreground py-4">No rows.</p>;
  return (
    <div className="border rounded-lg overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {cols.map(c => (
              <th key={c.name} className="text-left font-medium px-3 py-2 whitespace-nowrap border-b">
                {c.name}{c.type && <span className="ml-1 font-normal text-muted-foreground">{c.type}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
              {cols.map(c => {
                const v = r[c.name];
                const text = v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v);
                return (
                  <td key={c.name} className={`px-3 py-1.5 font-mono whitespace-nowrap max-w-[420px] truncate ${v === null ? "text-muted-foreground" : ""}`} title={text}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription className="break-words">{message}</AlertDescription>
    </Alert>
  );
}

// ── Building blocks for the operations pages ────────────────────────────────

type AnyRow = Record<string, any>;

export interface Column<T extends AnyRow = AnyRow> {
  key: string;
  label: ReactNode;
  right?: boolean;
  mono?: boolean;
  /** Custom cell; defaults to the raw value. */
  render?: (row: T) => ReactNode;
  className?: string;
}

/** Plain, dense table used by the ClickHouse operations pages. */
export function DataTable<T extends AnyRow>({ rows, columns, empty = "Nothing to show.", maxHeight, rowKey }: {
  rows: T[] | null | undefined;
  columns: Column<T>[];
  empty?: string;
  maxHeight?: number;
  rowKey?: (row: T, i: number) => string;
}) {
  if (!rows?.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-auto rounded-lg border" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {columns.map(c => (
              <th key={c.key} className={`whitespace-nowrap border-b px-3 py-2 font-medium ${c.right ? "text-right" : "text-left"}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey?.(r, i) ?? i} className="border-b last:border-0 hover:bg-muted/40">
              {columns.map(c => {
                const v = r[c.key];
                const content = c.render ? c.render(r) : v === null || v === undefined || v === "" ? <span className="text-muted-foreground">—</span>
                  : Array.isArray(v) ? v.join(", ") || <span className="text-muted-foreground">—</span>
                  : typeof v === "object" ? JSON.stringify(v) : String(v);
                return (
                  <td key={c.key} className={`px-3 py-2 align-top ${c.right ? "whitespace-nowrap text-right tabular-nums" : ""} ${c.mono ? "font-mono" : ""} ${c.className ?? ""}`}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card wrapper; shows why a section is empty when the server could not provide it. */
export function Section({ title, description, unavailable, actions, children }: {
  title: ReactNode;
  description?: ReactNode;
  /** Error text from the API's `unavailable` list for this section. */
  unavailable?: string | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-3">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions}
      </CardHeader>
      <CardContent>
        {unavailable
          ? <p className="py-4 text-sm text-muted-foreground">Not available on this server: {unavailable}</p>
          : children}
      </CardContent>
    </Card>
  );
}

/** GET a ClickHouse API route; `unavailableFor(section)` returns that section's error, if any. */
export function useChData<T extends object>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      setData(await chFetch<T>(url));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => { reload(); }, [reload]);
  const unavailableFor = useCallback(
    (section: string) => (data as { unavailable?: { section: string; error: string }[] } | null)
      ?.unavailable?.find(u => u.section === section)?.error ?? null,
    [data],
  );
  return { data, error, loading, reload, unavailableFor };
}

export function RefreshButton({ loading, onClick, label = "Refresh" }: { loading: boolean; onClick: () => void; label?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
      {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshIcon className="mr-1.5 h-3.5 w-3.5" />}{label}
    </Button>
  );
}

export function YesNo({ value, invert }: { value: unknown; invert?: boolean }) {
  const yes = value === true || value === 1 || value === "1" || value === "true";
  const bad = invert ? yes : false;
  return <Badge variant="outline" className={bad ? "border-destructive/40 text-destructive" : "font-normal"}>{yes ? "yes" : "no"}</Badge>;
}
