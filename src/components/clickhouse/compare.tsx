"use client";

/** ClickHouse tab of Cluster compare: schema, settings and access-control diff of two servers. */
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/app";
import { DataTable, ErrorBanner, chFetch, formatBytes, formatNumber, useClickHouseConnection } from "@/components/clickhouse/shared";
import { CheckCircle2, GitCompare, Loader2 } from "lucide-react";

interface Change { section: string; key: string; kind: "added" | "removed" | "changed"; details?: { path: string; before: unknown; after: unknown }[] }
interface CompareResult {
  a: { label: string; version: string; tables: number; unreadable: string[] };
  b: { label: string; version: string; tables: number; unreadable: string[] };
  changes: Change[];
  sizes: { table: string; engine: string; rowsA: number; rowsB: number; bytesA: number; bytesB: number }[];
  hiddenSections: string[];
}
interface SavedConn { id: string; name: string; url: string; engine?: string }

const SECTION_LABEL: Record<string, string> = {
  tables: "Tables (schema)", dictionaries: "Dictionaries", server_settings: "Server settings", users: "Users", roles: "Roles",
  grants: "Grants", settings_profiles: "Settings profiles", quotas: "Quotas", row_policies: "Row policies",
};
const show = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

function ServerPicker({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Choose a ClickHouse server" /></SelectTrigger>
        <SelectContent>
          {options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No ClickHouse servers available</div>}
          {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ClickHouseCompare() {
  const { status } = useClickHouseConnection();
  const [saved, setSaved] = useState<SavedConn[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);

  useEffect(() => {
    chFetch<{ connections: SavedConn[] }>("/api/saved-connections")
      .then(d => setSaved((d.connections ?? []).filter(c => c.engine === "clickhouse")))
      .catch(() => setSaved([]));
  }, []);

  const options = useMemo(() => [
    ...(status?.connected ? [{ value: "session", label: `Current connection (${status.url})` }] : []),
    ...saved.map(c => ({ value: c.id, label: `${c.name} — ${c.url}` })),
  ], [status, saved]);

  const compare = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await chFetch<CompareResult>("/api/clickhouse/compare", { method: "POST", body: JSON.stringify({ a, b }) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  };

  const bySection = useMemo(() => {
    const m = new Map<string, Change[]>();
    for (const c of result?.changes ?? []) m.set(c.section, [...(m.get(c.section) ?? []), c]);
    return [...m.entries()];
  }, [result]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Schema (CREATE TABLE statements), dictionaries, server settings and access control of two ClickHouse servers.</p>
        <Button onClick={compare} disabled={loading || !a || !b || a === b}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitCompare className="mr-2 h-4 w-4" />}
          {loading ? "Comparing…" : "Compare"}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="pt-6"><ServerPicker label="Server A" value={a} onChange={setA} options={options} /></CardContent></Card>
        <Card><CardContent className="pt-6"><ServerPicker label="Server B" value={b} onChange={setB} options={options} /></CardContent></Card>
      </div>
      {options.length < 2 && (
        <p className="text-sm text-muted-foreground">Connect to a ClickHouse server and/or add saved ClickHouse connections (Administration → Connections) to compare two servers.</p>
      )}
      <ErrorBanner message={error} />

      {result && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {([["Server A", result.a], ["Server B", result.b]] as const).map(([label, s]) => (
              <Card key={label}>
                <CardContent className="space-y-1 p-4">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="truncate font-mono text-sm font-medium">{s.label}</p>
                  <p className="text-sm">ClickHouse {s.version} · {formatNumber(s.tables)} tables</p>
                  {s.unreadable.length > 0 && <p className="text-xs text-muted-foreground">Not readable: {s.unreadable.join(", ")}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          {result.changes.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Configuration is identical" description="Schema, dictionaries, settings and access control match." />
          ) : bySection.map(([section, changes]) => (
            <Card key={section}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {SECTION_LABEL[section] ?? section}
                  <Badge variant="outline" className="font-normal">{changes.length} difference{changes.length > 1 ? "s" : ""}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-md border">
                  {changes.map(c => (
                    <li key={`${c.kind}:${c.key}`} className="space-y-1.5 px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={c.kind === "changed" ? "border-warning/40 text-warning" : "font-normal"}>
                          {c.kind === "added" ? "only in B" : c.kind === "removed" ? "only in A" : "differs"}
                        </Badge>
                        <span className="break-all font-mono">{c.key}</span>
                      </div>
                      {c.details?.map(d => (
                        <div key={d.path} className="grid gap-1 pl-2 text-xs sm:grid-cols-[minmax(0,10rem)_1fr_1fr] sm:gap-3">
                          <span className="font-mono text-muted-foreground">{d.path || "value"}</span>
                          <span className="break-all font-mono"><span className="text-muted-foreground">A: </span>{show(d.before)}</span>
                          <span className="break-all font-mono"><span className="text-muted-foreground">B: </span>{show(d.after)}</span>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}

          {result.sizes.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Data in tables present on both servers</CardTitle></CardHeader>
              <CardContent>
                <DataTable rows={result.sizes} maxHeight={480} columns={[
                  { key: "table", label: "Table", mono: true },
                  { key: "engine", label: "Engine" },
                  { key: "rowsA", label: "Rows A", right: true, render: r => formatNumber(r.rowsA) },
                  { key: "rowsB", label: "Rows B", right: true, render: r => formatNumber(r.rowsB) },
                  { key: "delta", label: "Δ rows", right: true, render: r => <span className={r.rowsB !== r.rowsA ? "text-warning" : ""}>{formatNumber(r.rowsB - r.rowsA)}</span> },
                  { key: "bytesA", label: "Size A", right: true, render: r => formatBytes(r.bytesA) },
                  { key: "bytesB", label: "Size B", right: true, render: r => formatBytes(r.bytesB) },
                ]} />
              </CardContent>
            </Card>
          )}
          {result.hiddenSections.length > 0 && (
            <p className="text-xs text-muted-foreground">Access-control sections ({result.hiddenSections.join(", ")}) are only compared for admins.</p>
          )}
        </div>
      )}
    </div>
  );
}
