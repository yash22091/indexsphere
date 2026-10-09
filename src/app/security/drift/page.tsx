"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Camera, GitCommitHorizontal, History, Loader2, Minus, Pencil, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/app";
import { cn } from "@/lib/utils";

interface Snapshot {
  id: string;
  taken_at: string;
  taken_by: string;
  last_checked_at: string;
  engine: string;
  version: string | null;
  changes: number;
}

interface Change {
  section: string;
  key: string;
  kind: "added" | "removed" | "changed";
  details?: { path: string; before: unknown; after: unknown }[];
}

interface Detail {
  snapshot: Snapshot;
  previous: { id: string; taken_at: string } | null;
  changes: Change[];
  sections: Record<string, number>;
  unreadable: string[];
  hiddenSections: string[];
}

const SECTION_LABEL: Record<string, string> = {
  cluster_settings: "Cluster settings", index_templates: "Index templates", legacy_templates: "Legacy templates",
  component_templates: "Component templates", ingest_pipelines: "Ingest pipelines", lifecycle_policies: "Lifecycle policies",
  aliases: "Aliases", snapshot_repositories: "Snapshot repositories", indices: "Indices", security_roles: "Security roles",
  security_role_mappings: "Role mappings", security_users: "Users", tables: "Tables", users: "Users", roles: "Roles",
  grants: "Grants", settings_profiles: "Settings profiles", quotas: "Quotas", row_policies: "Row policies",
  server_settings: "Server settings (changed)", dictionaries: "Dictionaries",
};

const label = (s: string) => SECTION_LABEL[s] ?? s;
const fmt = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function ChangeRow({ c }: { c: Change }) {
  const Icon = c.kind === "added" ? Plus : c.kind === "removed" ? Minus : Pencil;
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded",
          c.kind === "added" && "bg-success/15 text-success",
          c.kind === "removed" && "bg-destructive/15 text-destructive",
          c.kind === "changed" && "bg-warning/20 text-warning-foreground dark:text-warning")}>
          <Icon className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm">
            <span className="font-mono">{c.key}</span>
            <span className="text-muted-foreground"> {c.kind}</span>
          </p>
          {c.details && c.details.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr><th className="px-3 py-1.5 text-left font-medium">Setting</th><th className="px-3 py-1.5 text-left font-medium">Before</th><th className="px-3 py-1.5 text-left font-medium">After</th></tr>
                </thead>
                <tbody>
                  {c.details.map(d => (
                    <tr key={d.path} className="border-t">
                      <td className="px-3 py-1.5 font-mono">{d.path}</td>
                      <td className="max-w-[320px] truncate px-3 py-1.5 font-mono text-destructive" title={fmt(d.before)}>{fmt(d.before)}</td>
                      <td className="max-w-[320px] truncate px-3 py-1.5 font-mono text-success" title={fmt(d.after)}>{fmt(d.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function TargetPanel({ target }: { target: "search" | "clickhouse" }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [connection, setConnection] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/drift?target=${target}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not load history");
      setSnapshots(d.snapshots);
      setConnection(d.connection);
      setSelected(prev => prev ?? d.snapshots[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
      setSnapshots([]);
    }
  }, [target]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let cancelled = false;
    fetch(`/api/drift/${selected}`).then(r => r.json()).then(d => { if (!cancelled && d.snapshot) setDetail(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  const capture = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await fetch("/api/drift", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Snapshot failed");
      setNotice(d.firstSnapshot ? "Baseline snapshot saved. Future snapshots are compared against it."
        : d.changed ? `${d.changes} change${d.changes === 1 ? "" : "s"} detected since the last snapshot.` : "No changes since the last snapshot.");
      setSelected(d.snapshotId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snapshot failed");
    } finally {
      setBusy(false);
    }
  };

  if (error && /connected/i.test(error)) {
    return (
      <EmptyState icon={History}
        title={target === "clickhouse" ? "No ClickHouse server connected" : "No cluster connected"}
        description="Connect to see the configuration history of that server."
        action={<Button asChild><Link href={target === "clickhouse" ? "/clickhouse" : "/connections"}>Connect</Link></Button>} />
    );
  }

  const grouped = (detail?.changes ?? []).reduce<Record<string, Change[]>>((acc, c) => { (acc[c.section] ??= []).push(c); return acc; }, {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{connection}</p>
        <Button onClick={capture} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          Take snapshot
        </Button>
      </div>
      {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert><GitCommitHorizontal className="h-4 w-4" /><AlertDescription>{notice}</AlertDescription></Alert>}

      {snapshots && snapshots.length === 0 ? (
        <EmptyState icon={History} title="No snapshots yet"
          description="Take a baseline snapshot now. Saved connections are also snapshotted automatically every night."
          action={<Button onClick={capture} disabled={busy}>Take baseline snapshot</Button>} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="h-fit">
            <CardHeader><CardTitle className="text-base">History</CardTitle><CardDescription>Stored only when something changed</CardDescription></CardHeader>
            <CardContent className="p-2">
              <ul className="space-y-1">
                {(snapshots ?? []).map((s, i) => (
                  <li key={s.id}>
                    <button onClick={() => setSelected(s.id)}
                      className={cn("w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted", selected === s.id && "bg-muted")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{new Date(s.taken_at).toLocaleString()}</span>
                        {i === snapshots!.length - 1 ? <Badge variant="outline">Baseline</Badge>
                          : <Badge variant="outline" className={s.changes ? "border-warning/50" : ""}>{s.changes} change{s.changes === 1 ? "" : "s"}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        by {s.taken_by} · confirmed {new Date(s.last_checked_at).toLocaleDateString()}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {detail?.previous ? "Changes in this snapshot" : "Baseline"}
              </CardTitle>
              <CardDescription>
                {detail?.previous
                  ? `Compared with ${new Date(detail.previous.taken_at).toLocaleString()}`
                  : "The first snapshot of this server. Later snapshots are compared against the one before them."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!detail && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
              {detail && !detail.previous && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(detail.sections).map(([s, n]) => (
                    <div key={s} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span>{label(s)}</span><span className="tabular-nums text-muted-foreground">{n}</span>
                    </div>
                  ))}
                </div>
              )}
              {detail?.previous && detail.changes.length === 0 && (
                <p className="text-sm text-muted-foreground">No differences in the sections visible to your role.</p>
              )}
              {Object.entries(grouped).map(([section, list]) => (
                <div key={section}>
                  <h3 className="text-sm font-semibold">{label(section)} <span className="font-normal text-muted-foreground">({list.length})</span></h3>
                  <ul className="divide-y">{list.map(c => <ChangeRow key={`${c.section}:${c.key}`} c={c} />)}</ul>
                </div>
              ))}
              {detail && (detail.unreadable.length > 0 || detail.hiddenSections.length > 0) && (
                <p className="text-xs text-muted-foreground">
                  {detail.unreadable.length > 0 && <>Not readable with this account: {detail.unreadable.map(label).join(", ")}. </>}
                  {detail.hiddenSections.length > 0 && <>Visible to admins only: {detail.hiddenSections.map(label).join(", ")}.</>}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function DriftPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuration drift"
        description="Snapshots of templates, policies, mappings, users and grants — so you can see exactly what changed, when, and between which snapshots."
      />
      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search">Elasticsearch / OpenSearch</TabsTrigger>
          <TabsTrigger value="clickhouse">ClickHouse</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-4"><TargetPanel target="search" /></TabsContent>
        <TabsContent value="clickhouse" className="mt-4"><TargetPanel target="clickhouse" /></TabsContent>
      </Tabs>
    </div>
  );
}
