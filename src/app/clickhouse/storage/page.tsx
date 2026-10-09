"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatGrid } from "@/components/app";
import { useAuth } from "@/contexts/auth-context";
import {
  ClickHouseGate, ClickHouseHeader, DataTable, ErrorBanner, RefreshButton, Section, StatTile, chFetch,
  formatBytes, formatNumber, useChData,
} from "@/components/clickhouse/shared";
import { Loader2, Trash2, Wand2 } from "lucide-react";

type Row = Record<string, any>;
interface StorageData {
  disks: Row[] | null;
  diskUsage: Row[] | null;
  policies: Row[] | null;
  tables: Row[] | null;
  detached: Row[] | null;
  dropped: Row[] | null;
  dictionaries: Row[] | null;
  unavailable: { section: string; error: string }[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const BROKEN = /broken|unexpected|noquorum|covered|clone/i;

function Partitions({ tables, canWrite, isAdmin }: { tables: Row[]; canWrite: boolean; isAdmin: boolean }) {
  const [selected, setSelected] = useState<string>(tables[0] ? `${tables[0].database}.${tables[0].table}` : "");
  const [db, table] = useMemo(() => {
    const t = tables.find(x => `${x.database}.${x.table}` === selected);
    return t ? [t.database as string, t.table as string] : ["", ""];
  }, [selected, tables]);
  const { data, error, loading, reload } = useChData<{ partitions: Row[] }>(db ? `/api/clickhouse/storage/partitions?database=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dropping, setDropping] = useState<Row | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const act = async (partitionId: string, action: "optimize" | "drop") => {
    setBusy(`${action}:${partitionId}`);
    setActionError(null);
    try {
      await chFetch("/api/clickhouse/storage/partition", { method: "POST", body: JSON.stringify({ database: db, table, partitionId, action }) });
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Partitions" description="Active parts grouped by partition. OPTIMIZE … FINAL merges a partition into one part (expensive — use for closed, historical partitions). Dropping a partition is the cheapest way to delete old data."
      actions={
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Choose a table" /></SelectTrigger>
          <SelectContent>
            {tables.map(t => <SelectItem key={`${t.database}.${t.table}`} value={`${t.database}.${t.table}`}>{t.database}.{t.table}</SelectItem>)}
          </SelectContent>
        </Select>
      }>
      <div className="space-y-3">
        <ErrorBanner message={error ?? actionError} />
        {loading && !data ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
          <DataTable rows={data?.partitions} empty={db ? "No active parts." : "Choose a table."} maxHeight={520} rowKey={r => r.partition_id} columns={[
            { key: "partition", label: "Partition", mono: true },
            { key: "parts", label: "Parts", right: true, render: r => <span className={n(r.parts) > 100 ? "font-semibold text-warning" : ""}>{formatNumber(r.parts)}</span> },
            { key: "rows", label: "Rows", right: true, render: r => formatNumber(r.rows) },
            { key: "bytes", label: "On disk", right: true, render: r => formatBytes(r.bytes) },
            { key: "ratio", label: "Compression", right: true, render: r => n(r.bytes) ? `${(n(r.uncompressed) / n(r.bytes)).toFixed(1)}×` : "—" },
            { key: "range", label: "Time range", render: r => String(r.min_time).startsWith("1970") ? <span className="text-muted-foreground">—</span> : <span className="whitespace-nowrap">{r.min_time} → {r.max_time}</span> },
            { key: "disks", label: "Disks" },
            { key: "last_modified", label: "Last write", className: "whitespace-nowrap" },
            { key: "actions", label: "", render: r => (
              <div className="flex justify-end gap-1">
                {canWrite && (
                  <Button size="sm" variant="ghost" className="h-7" title="OPTIMIZE PARTITION FINAL" disabled={!!busy || n(r.parts) < 2}
                    onClick={() => confirm(`Merge partition ${r.partition} of ${db}.${table} into one part?\n\nThis rewrites the whole partition and can take a long time.`) && act(r.partition_id, "optimize")}>
                    {busy === `optimize:${r.partition_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  </Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" title="Drop partition" disabled={!!busy}
                    onClick={() => { setDropping(r); setConfirmText(""); }}>
                    {busy === `drop:${r.partition_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            ) },
          ]} />
        )}
      </div>
      <Dialog open={!!dropping} onOpenChange={o => !o && setDropping(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop partition {dropping?.partition}?</DialogTitle>
            <DialogDescription>
              Permanently deletes {formatNumber(dropping?.rows)} rows ({formatBytes(dropping?.bytes)}) from <span className="font-mono">{db}.{table}</span>.
              This cannot be undone. Type the partition ID <span className="font-mono font-medium">{dropping?.partition_id}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={dropping?.partition_id} className="font-mono" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDropping(null)}>Cancel</Button>
            <Button variant="destructive" disabled={confirmText !== dropping?.partition_id}
              onClick={() => { const id = dropping!.partition_id; setDropping(null); act(id, "drop"); }}>
              Drop partition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function StorageView() {
  const { user } = useAuth();
  const isAdmin = !!user?.permissions?.includes("admin");
  const canWrite = isAdmin || !!user?.permissions?.includes("user");
  const { data, error, loading, reload, unavailableFor } = useChData<StorageData>("/api/clickhouse/storage");

  const usage = new Map((data?.diskUsage ?? []).map(d => [d.disk_name, d]));
  const broken = (data?.detached ?? []).filter(d => BROKEN.test(String(d.reason)));
  const withTtl = (data?.tables ?? []).filter(t => t.ttl);
  const local = (data?.disks ?? []).filter(d => n(d.total_space) > 0 && n(d.total_space) < 2 ** 60);
  const worstFree = local.length ? Math.min(...local.map(d => n(d.free_space) / n(d.total_space))) : null;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><RefreshButton loading={loading} onClick={reload} /></div>
      <ErrorBanner message={error} />
      {loading && !data && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
      {data && (
        <>
          <StatGrid>
            <StatTile label="Lowest free space" value={worstFree === null ? "—" : `${Math.round(worstFree * 100)}%`}
              tone={worstFree === null ? undefined : worstFree < 0.1 ? "crit" : worstFree < 0.2 ? "warn" : "ok"} sub="merges need room for a copy" />
            <StatTile label="Tables with TTL" value={`${withTtl.length} / ${data.tables?.length ?? 0}`} sub="MergeTree tables" />
            <StatTile label="Detached parts" value={formatNumber(data.detached?.length)} tone={broken.length ? "warn" : "ok"} sub={`${broken.length} broken / unexpected`} />
            <StatTile label="Dictionaries" value={formatNumber(data.dictionaries?.length)}
              tone={(data.dictionaries ?? []).some(d => d.last_exception) ? "warn" : "ok"}
              sub={formatBytes((data.dictionaries ?? []).reduce((a, d) => a + n(d.bytes_allocated), 0)) + " in memory"} />
          </StatGrid>

          <Tabs defaultValue="disks">
            <TabsList className="flex-wrap">
              <TabsTrigger value="disks">Disks & policies</TabsTrigger>
              <TabsTrigger value="partitions">Partitions</TabsTrigger>
              <TabsTrigger value="ttl">TTL & lifecycle</TabsTrigger>
              <TabsTrigger value="detached">Detached parts</TabsTrigger>
              <TabsTrigger value="dictionaries">Dictionaries</TabsTrigger>
            </TabsList>

            <TabsContent value="disks" className="mt-4 space-y-4">
              <Section title="Disks" unavailable={unavailableFor("disks")}>
                <DataTable rows={data.disks} columns={[
                  { key: "name", label: "Disk", mono: true },
                  { key: "type", label: "Type" },
                  { key: "path", label: "Path", mono: true },
                  { key: "used", label: "Used", render: d => {
                    const total = n(d.total_space);
                    if (!total || total >= 2 ** 60) return <span className="text-muted-foreground">object storage</span>;
                    const used = 1 - n(d.free_space) / total;
                    return <div className="flex min-w-40 items-center gap-2"><Progress value={used * 100} className="h-1.5" /><span className={`tabular-nums ${used > 0.9 ? "text-destructive" : used > 0.8 ? "text-warning" : ""}`}>{Math.round(used * 100)}%</span></div>;
                  } },
                  { key: "free_space", label: "Free", right: true, render: d => n(d.total_space) >= 2 ** 60 ? "—" : formatBytes(d.free_space) },
                  { key: "total_space", label: "Total", right: true, render: d => n(d.total_space) >= 2 ** 60 ? "—" : formatBytes(d.total_space) },
                  { key: "parts", label: "Parts / data", right: true, render: d => { const u = usage.get(d.name); return u ? `${formatNumber(u.parts)} · ${formatBytes(u.bytes)}` : "—"; } },
                ]} />
              </Section>
              <Section title="Storage policies" description="Volumes are filled in priority order; move_factor sets when parts start moving to the next volume (hot → cold tiering)." unavailable={unavailableFor("policies")}>
                <DataTable rows={data.policies} columns={[
                  { key: "policy_name", label: "Policy", mono: true },
                  { key: "volume_name", label: "Volume", mono: true },
                  { key: "volume_priority", label: "Priority", right: true },
                  { key: "disks", label: "Disks" },
                  { key: "volume_type", label: "Type" },
                  { key: "max_data_part_size", label: "Max part size", right: true, render: p => n(p.max_data_part_size) ? formatBytes(p.max_data_part_size) : "—" },
                  { key: "move_factor", label: "Move factor", right: true },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="partitions" className="mt-4">
              {data.tables?.length
                ? <Partitions tables={data.tables} canWrite={canWrite} isAdmin={isAdmin} />
                : <Section title="Partitions" unavailable={unavailableFor("tables")}><p className="py-6 text-center text-sm text-muted-foreground">No MergeTree tables.</p></Section>}
            </TabsContent>

            <TabsContent value="ttl" className="mt-4 space-y-4">
              <Section title="Tables and their TTL" description="TTL deletes or moves old data automatically. With a time-based partition key, set ttl_only_drop_parts = 1 so expired data is removed by dropping whole parts instead of rewriting them." unavailable={unavailableFor("tables")}>
                <DataTable rows={data.tables} columns={[
                  { key: "table", label: "Table", render: t => <span className="font-mono">{t.database}.{t.table}</span> },
                  { key: "engine", label: "Engine" },
                  { key: "partition_key", label: "Partition key", mono: true },
                  { key: "ttl", label: "TTL", render: t => t.ttl ? <code className="font-mono">{t.ttl}</code> : <Badge variant="outline" className="font-normal text-muted-foreground">none</Badge> },
                  { key: "storage_policy", label: "Policy", mono: true },
                  { key: "total_rows", label: "Rows", right: true, render: t => formatNumber(t.total_rows) },
                  { key: "total_bytes", label: "Size", right: true, render: t => formatBytes(t.total_bytes) },
                ]} />
              </Section>
              <Section title="Recently dropped tables" description="Dropped tables are kept for database_atomic_delay_before_drop_table_sec (8 minutes by default) and can be restored with UNDROP TABLE." unavailable={unavailableFor("dropped")}>
                <DataTable rows={data.dropped} empty="No recently dropped tables." columns={[
                  { key: "table", label: "Table", render: t => <span className="font-mono">{t.database}.{t.table}</span> },
                  { key: "engine", label: "Engine" },
                  { key: "table_dropped_time", label: "Dropped at" },
                  { key: "undrop", label: "Restore with", render: t => <code className="font-mono">UNDROP TABLE {t.database}.{t.table}</code> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="detached" className="mt-4">
              <Section title="Detached parts" description="Parts ClickHouse no longer uses. 'broken-on-start' or 'unexpected' parts were found damaged; they take disk space and may hold data. Re-attach valid parts with ALTER TABLE … ATTACH PART, or remove them with ALTER TABLE … DROP DETACHED PART (needs allow_drop_detached = 1)." unavailable={unavailableFor("detached")}>
                <DataTable rows={data.detached} empty="No detached parts." maxHeight={560} columns={[
                  { key: "table", label: "Table", render: d => <span className="font-mono">{d.database}.{d.table}</span> },
                  { key: "name", label: "Part", mono: true },
                  { key: "partition_id", label: "Partition", mono: true },
                  { key: "disk", label: "Disk" },
                  { key: "reason", label: "Reason", render: d => d.reason
                    ? <Badge variant="outline" className={BROKEN.test(d.reason) ? "border-warning/40 text-warning" : "font-normal"}>{d.reason}</Badge>
                    : <span className="text-muted-foreground">detached by user</span> },
                ]} />
              </Section>
            </TabsContent>

            <TabsContent value="dictionaries" className="mt-4">
              <Section title="Dictionaries" description="In-memory lookup tables. A failed load keeps serving the previous version (or nothing on first load)." unavailable={unavailableFor("dictionaries")}>
                <DataTable rows={data.dictionaries} empty="No dictionaries." columns={[
                  { key: "name", label: "Dictionary", render: d => <span className="font-mono">{d.database ? `${d.database}.` : ""}{d.name}</span> },
                  { key: "status", label: "Status", render: d => <Badge variant="outline" className={d.status === "LOADED" ? "font-normal" : d.last_exception ? "border-destructive/40 text-destructive" : "border-warning/40 text-warning"}>{d.status}</Badge> },
                  { key: "type", label: "Layout" },
                  { key: "element_count", label: "Elements", right: true, render: d => formatNumber(d.element_count) },
                  { key: "bytes_allocated", label: "Memory", right: true, render: d => formatBytes(d.bytes_allocated) },
                  { key: "hit_rate", label: "Hit rate", right: true },
                  { key: "last_successful_update_time", label: "Last update", className: "whitespace-nowrap" },
                  { key: "last_exception", label: "Last error", render: d => d.last_exception ? <span className="line-clamp-2 text-destructive">{d.last_exception}</span> : null },
                ]} />
              </Section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

export default function ClickHouseStoragePage() {
  return (
    <ClickHouseGate>
      {(status, disconnect) => (
        <div className="space-y-6">
          <ClickHouseHeader title="Storage" status={status} onDisconnect={disconnect}
            description="Disks and storage policies, partitions (with optimize and drop), TTL coverage, detached parts and dictionaries." />
          <StorageView />
        </div>
      )}
    </ClickHouseGate>
  );
}
