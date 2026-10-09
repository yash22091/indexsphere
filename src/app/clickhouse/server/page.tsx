"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatGrid } from "@/components/app";
import {
  ClickHouseGate, ClickHouseHeader, DataTable, ErrorBanner, RefreshButton, Section, StatTile,
  formatBytes, formatNumber, useChData,
} from "@/components/clickhouse/shared";
import { AlertTriangle, Loader2, Search } from "lucide-react";

type Row = Record<string, any>;
interface ServerData {
  warnings: Row[] | null;
  errors: Row[] | null;
  crashes: Row[] | null;
  serverSettings: Row[] | null;
  mergeTreeSettings: Row[] | null;
  metrics: Row[] | null;
  backups: Row[] | null;
  backupLog: Row[] | null;
  build: Row[] | null;
  profile: Row[] | null;
  unavailable: { section: string; error: string }[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const LEVELS = ["Fatal", "Critical", "Error", "Warning", "Notice", "Information", "Debug"];
const WINDOWS = [{ v: 15, l: "15 min" }, { v: 60, l: "1 hour" }, { v: 360, l: "6 hours" }, { v: 1440, l: "24 hours" }, { v: 10080, l: "7 days" }];
const levelClass: Record<string, string> = {
  Fatal: "border-destructive/40 text-destructive", Critical: "border-destructive/40 text-destructive", Error: "border-destructive/40 text-destructive",
  Warning: "border-warning/40 text-warning",
};

function Logs() {
  const [level, setLevel] = useState("Warning");
  const [minutes, setMinutes] = useState(60);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const url = `/api/clickhouse/server/logs?level=${level}&minutes=${minutes}&q=${encodeURIComponent(query)}`;
  const { data, error, loading, reload } = useChData<{ logs: Row[] }>(url);

  return (
    <Section title="Server log" description="From system.text_log (newest first, up to 500 lines). The level filter includes everything more severe."
      unavailable={error && /text_log|UNKNOWN_TABLE|doesn't exist/i.test(error) ? "system.text_log is not enabled (<text_log> in the server config)" : null}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Level</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{LEVELS.map(l => <SelectItem key={l} value={l}>{l} and above</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Window</Label>
            <Select value={String(minutes)} onValueChange={v => setMinutes(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{WINDOWS.map(w => <SelectItem key={w.v} value={String(w.v)}>{w.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setQuery(text); }}>
            <Input value={text} onChange={e => setText(e.target.value)} placeholder="Search message or logger…" className="w-64" />
            <Button type="submit" variant="outline" size="sm" className="h-9"><Search className="h-3.5 w-3.5" /></Button>
          </form>
          <RefreshButton loading={loading} onClick={reload} />
        </div>
        {error && !/text_log|UNKNOWN_TABLE|doesn't exist/i.test(error) && <ErrorBanner message={error} />}
        {loading && !data ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
          <DataTable rows={data?.logs} empty="No log lines match." maxHeight={600} columns={[
            { key: "time", label: "Time", className: "whitespace-nowrap font-mono", render: r => String(r.time).slice(0, 23) },
            { key: "level", label: "Level", render: r => <Badge variant="outline" className={levelClass[r.level] ?? "font-normal"}>{r.level}</Badge> },
            { key: "logger_name", label: "Logger", mono: true, className: "max-w-48 truncate" },
            { key: "message", label: "Message", render: r => <span className="whitespace-pre-wrap break-all font-mono">{r.message}</span> },
          ]} />
        )}
      </div>
    </Section>
  );
}

function ServerView() {
  const { data, error, loading, reload, unavailableFor } = useChData<ServerData>("/api/clickhouse/server");
  const [metricFilter, setMetricFilter] = useState("");
  const [kind, setKind] = useState("all");

  const metrics = useMemo(() => {
    const f = metricFilter.trim().toLowerCase();
    return (data?.metrics ?? []).filter(m => (kind === "all" || m.kind === kind) && (!f || String(m.name).toLowerCase().includes(f) || String(m.description).toLowerCase().includes(f)));
  }, [data, metricFilter, kind]);
  const errorsDay = (data?.errors ?? []).filter(e => Date.now() - new Date(String(e.last_error_time).replace(" ", "T") + "Z").getTime() < 86_400_000);
  const lastBackup = (data?.backupLog ?? []).find(b => b.status === "BACKUP_CREATED");
  const build = Object.fromEntries((data?.build ?? []).map(b => [b.name, b.value]));

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><RefreshButton loading={loading} onClick={reload} /></div>
      <ErrorBanner message={error} />
      {loading && !data && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {data && (
        <>
          <StatGrid>
            <StatTile label="Server warnings" value={formatNumber(data.warnings?.length)} tone={data.warnings?.length ? "warn" : "ok"} sub="system.warnings" />
            <StatTile label="Error types (24h)" value={formatNumber(errorsDay.length)} tone={errorsDay.length ? "warn" : "ok"} sub={`${formatNumber(data.errors?.length)} since start`} />
            <StatTile label="Crashes" value={formatNumber(data.crashes?.length)} tone={data.crashes?.length ? "crit" : "ok"} sub={data.crashes === null ? "crash_log not enabled" : "system.crash_log"} />
            <StatTile label="Last backup" value={lastBackup ? String(lastBackup.event_time).slice(0, 10) : "none"} tone={lastBackup ? "ok" : "warn"} sub={lastBackup ? formatBytes(lastBackup.total_size) : "no native BACKUP recorded"} />
          </StatGrid>

          {!!data.warnings?.length && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">{data.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="logs">
            <TabsList className="flex-wrap">
              <TabsTrigger value="logs">Server log</TabsTrigger>
              <TabsTrigger value="errors">Errors</TabsTrigger>
              <TabsTrigger value="settings">Changed settings</TabsTrigger>
              <TabsTrigger value="metrics">Metrics & events</TabsTrigger>
              <TabsTrigger value="backups">Backups</TabsTrigger>
              <TabsTrigger value="crashes">Crashes</TabsTrigger>
            </TabsList>

            <TabsContent value="logs" className="mt-4"><Logs /></TabsContent>

            <TabsContent value="errors" className="mt-4">
              <Section title="Errors by type" description="Every error code the server has raised since it started, with the latest message (system.errors)." unavailable={unavailableFor("errors")}>
                <DataTable rows={data.errors} empty="No errors since the server started." maxHeight={600} columns={[
                  { key: "name", label: "Error", mono: true },
                  { key: "code", label: "Code", right: true },
                  { key: "value", label: "Count", right: true, render: e => formatNumber(e.value) },
                  { key: "last_error_time", label: "Last", className: "whitespace-nowrap" },
                  { key: "remote", label: "Remote", render: e => n(e.remote) ? <Badge variant="outline" className="font-normal">remote</Badge> : null },
                  { key: "last_error_message", label: "Last message", render: e => <span className="line-clamp-2">{e.last_error_message}</span> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="settings" className="mt-4 space-y-4">
              <Section title="Your profile's query settings" description="Effective values for the connected user, as its settings profile defines them." unavailable={data.profile === null ? "system.settings is not readable" : null}>
                <DataTable rows={data.profile} columns={[
                  { key: "name", label: "Setting", mono: true },
                  { key: "value", label: "Value", mono: true },
                  { key: "changed", label: "Changed from default", render: s => n(s.changed) ? <Badge variant="outline" className="font-normal">changed</Badge> : <span className="text-muted-foreground">default</span> },
                ]} />
              </Section>
              <Section title="Server settings changed from defaults" description="From config.xml / config.d (system.server_settings)." unavailable={unavailableFor("serverSettings")}>
                <DataTable rows={data.serverSettings} empty="All server settings are at their defaults." columns={[
                  { key: "name", label: "Setting", mono: true },
                  { key: "value", label: "Value", mono: true, className: "max-w-xs break-all" },
                  { key: "default", label: "Default", mono: true, className: "max-w-xs break-all text-muted-foreground" },
                  { key: "description", label: "Description", render: s => <span className="line-clamp-2 text-muted-foreground">{s.description}</span> },
                ]} />
              </Section>
              <Section title="MergeTree settings changed from defaults" unavailable={unavailableFor("mergeTreeSettings")}>
                <DataTable rows={data.mergeTreeSettings} empty="All MergeTree settings are at their defaults." columns={[
                  { key: "name", label: "Setting", mono: true },
                  { key: "value", label: "Value", mono: true },
                  { key: "description", label: "Description", render: s => <span className="line-clamp-2 text-muted-foreground">{s.description}</span> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="metrics" className="mt-4">
              <Section title="Metrics and events" description="Current gauges (metrics), counters since start (events) and periodically computed values (asynchronous metrics)." unavailable={unavailableFor("metrics")}
                actions={
                  <div className="flex gap-2">
                    <Select value={kind} onValueChange={setKind}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="metric">Metrics</SelectItem>
                        <SelectItem value="event">Events</SelectItem>
                        <SelectItem value="async">Async metrics</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={metricFilter} onChange={e => setMetricFilter(e.target.value)} placeholder="Filter…" className="w-48" />
                  </div>
                }>
                <DataTable rows={metrics} maxHeight={600} rowKey={m => `${m.kind}:${m.name}`} columns={[
                  { key: "name", label: "Name", mono: true },
                  { key: "kind", label: "Kind" },
                  { key: "value", label: "Value", right: true, render: m => formatNumber(m.value) },
                  { key: "description", label: "Description", render: m => <span className="line-clamp-2 text-muted-foreground">{m.description}</span> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="backups" className="mt-4 space-y-4">
              <Section title="Backup history" description="Native BACKUP / RESTORE operations (system.backup_log). Backups made with external tools such as clickhouse-backup are not listed." unavailable={unavailableFor("backupLog") ? "system.backup_log is not enabled" : null}>
                <DataTable rows={data.backupLog} empty="No native backups recorded. Example: BACKUP DATABASE mydb TO Disk('backups', 'mydb.zip')" columns={[
                  { key: "event_time", label: "Time", className: "whitespace-nowrap" },
                  { key: "name", label: "Destination", mono: true },
                  { key: "status", label: "Status", render: b => <Badge variant="outline" className={/FAILED/.test(b.status) ? "border-destructive/40 text-destructive" : "font-normal"}>{b.status}</Badge> },
                  { key: "total_size", label: "Size", right: true, render: b => formatBytes(b.total_size) },
                  { key: "error", label: "Error", render: b => b.error ? <span className="line-clamp-2 text-destructive">{b.error}</span> : null },
                ]} />
              </Section>
              <Section title="Backups since the server started" unavailable={unavailableFor("backups")}>
                <DataTable rows={data.backups} empty="None." columns={[
                  { key: "start_time", label: "Started", className: "whitespace-nowrap" },
                  { key: "name", label: "Destination", mono: true },
                  { key: "status", label: "Status" },
                  { key: "num_files", label: "Files", right: true },
                  { key: "total_size", label: "Size", right: true, render: b => formatBytes(b.total_size) },
                  { key: "error", label: "Error", render: b => b.error ? <span className="line-clamp-2 text-destructive">{b.error}</span> : null },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="crashes" className="mt-4">
              <Section title="Crashes" description="Fatal signals with stack traces (system.crash_log)." unavailable={unavailableFor("crashes") ? "system.crash_log is not enabled" : null}>
                <DataTable rows={data.crashes} empty="No crashes recorded." columns={[
                  { key: "event_time", label: "Time", className: "whitespace-nowrap" },
                  { key: "signal", label: "Signal", right: true },
                  { key: "version", label: "Version" },
                  { key: "query_id", label: "Query", mono: true },
                  { key: "trace", label: "Trace", render: c => <details><summary className="cursor-pointer">stack trace</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre font-mono">{c.trace}</pre></details> },
                ]} />
              </Section>
            </TabsContent>
          </Tabs>

          {build.VERSION_DESCRIBE && (
            <p className="text-xs text-muted-foreground">Build: {build.VERSION_DESCRIBE} · {build.BUILD_TYPE} · {build.SYSTEM}</p>
          )}
        </>
      )}
    </div>
  );
}

export default function ClickHouseServerPage() {
  return (
    <ClickHouseGate>
      {(status, disconnect) => (
        <div className="space-y-6">
          <ClickHouseHeader title="Server & logs" status={status} onDisconnect={disconnect}
            description="Server warnings and log, errors by type, settings changed from defaults, every metric and event, backups and crashes." />
          <ServerView />
        </div>
      )}
    </ClickHouseGate>
  );
}
