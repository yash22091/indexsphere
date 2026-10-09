"use client";
import { Fragment, useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ScrollText, Download, ChevronDown, ChevronRight, AlertCircle, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, SeverityBadge } from "@/components/app";

interface AuditEntry {
  id: string; created_at: string; username?: string;
  action: string; target?: string; endpoint?: string; method?: string; status_code?: number;
  duration_ms?: number; cluster_url?: string; request_body?: string; ip_address?: string;
}
interface AuditResponse { total: number; entries: AuditEntry[]; offset: number; limit: number }

// Action names as written by the server (see writeAuditLog calls)
const ACTIONS = [
  "es:get", "es:post", "es:put", "es:delete", "cluster:connect", "index:create", "index:delete",
  "template:create", "template:delete", "reindex", "clickhouse:connect", "clickhouse:query",
  "clickhouse:create-table", "clickhouse:kill",
];

function statusLevel(s?: number) {
  if (!s) return null;
  if (s < 300) return "ok";
  if (s < 400) return "info";
  if (s < 500) return "warning";
  return "high";
}

const PAGE_LIMIT = 50;

export default function AuditTrailPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filters
  const [username, setUsername] = useState("");
  const [action, setAction] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(off) });
      if (username) p.set("username", username);
      if (action && action !== "all") p.set("action", action);
      if (dateFrom) p.set("from", dateFrom);
      if (dateTo) p.set("to", dateTo);
      const r = await fetch(`/api/audit?${p}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setData(d);
      setOffset(off);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [username, action, dateFrom, dateTo]);

  useEffect(() => { load(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams({ export: "csv" });
      if (username) p.set("username", username);
      if (action && action !== "all") p.set("action", action);
      if (dateFrom) p.set("from", dateFrom);
      if (dateTo) p.set("to", dateTo);
      const r = await fetch(`/api/audit?${p}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `audit-${Date.now()}.csv`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });

  const totalPages = data ? Math.ceil(data.total / PAGE_LIMIT) : 0;
  const currentPage = Math.floor(offset / PAGE_LIMIT) + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit trail"
        description="Every cluster operation, with who ran it, when, and the result. Administrators see all users; others see their own actions."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5"/> : <Download className="h-4 w-4 mr-1.5"/>}
            Export CSV
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <form
            className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={e => { e.preventDefault(); load(0); }}
          >
            <div className="grid gap-2">
              <Label htmlFor="audit-user">User</Label>
              <Input id="audit-user" value={username} onChange={e => setUsername(e.target.value)} placeholder="Any user"/>
            </div>
            <div className="grid gap-2">
              <Label>Action</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {ACTIONS.map(a => <SelectItem key={a} value={a}><span className="font-mono text-xs">{a}</span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="audit-from">From</Label>
              <Input id="audit-from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}/>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="audit-to">To</Label>
              <Input id="audit-to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}/>
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5"/> : <Search className="h-4 w-4 mr-1.5"/>}
              Apply filters
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4"/>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading && !data ? (
            <div className="space-y-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9"/>)}</div>
          ) : !data?.entries.length ? (
            <EmptyState icon={ScrollText} title="No audit records" description="Nothing matches these filters yet."/>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><span className="sr-only">Details</span></TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.entries.map(e => {
                    const level = statusLevel(e.status_code);
                    const open = expanded.has(e.id);
                    return (
                      <Fragment key={e.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggleExpand(e.id)} aria-expanded={open}>
                          <TableCell className="text-muted-foreground">{open ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(e.created_at).toLocaleString()}</TableCell>
                          <TableCell className="font-medium">{e.username ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="font-mono text-xs">{e.action}</Badge></TableCell>
                          <TableCell className="max-w-[280px] truncate font-mono text-xs text-muted-foreground" title={e.endpoint ?? e.target}>{e.endpoint ?? e.target ?? "—"}</TableCell>
                          <TableCell>{level ? <SeverityBadge level={level}>{e.status_code}</SeverityBadge> : <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{e.duration_ms != null ? `${e.duration_ms} ms` : "—"}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{e.ip_address ?? "—"}</TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={8}>
                              <div className="grid gap-2 py-1 text-xs">
                                {e.cluster_url && <div><span className="text-muted-foreground">Cluster:</span> <span className="font-mono">{e.cluster_url}</span></div>}
                                {e.target && e.endpoint && <div><span className="text-muted-foreground">Target:</span> <span className="font-mono">{e.target}</span></div>}
                                {e.request_body ? (
                                  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{(() => { try { return JSON.stringify(JSON.parse(e.request_body!), null, 2); } catch { return e.request_body; } })()}</pre>
                                ) : <span className="text-muted-foreground">No request body.</span>}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.total > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
          <span>{data.total.toLocaleString()} records</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE_LIMIT))}>Previous</Button>
            <span className="tabular-nums">Page {currentPage} of {totalPages || 1}</span>
            <Button variant="outline" size="sm" disabled={offset + PAGE_LIMIT >= (data?.total ?? 0) || loading} onClick={() => load(offset + PAGE_LIMIT)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
