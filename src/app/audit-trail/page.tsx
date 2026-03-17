"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ScrollText, Download, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

interface AuditEntry {
  id: number; timestamp: string; username: string; user_role: string;
  action: string; endpoint?: string; method?: string; status_code?: number;
  duration_ms?: number; cluster_url?: string; request_body?: string; ip_address?: string;
}
interface AuditResponse { total: number; entries: AuditEntry[]; offset: number; limit: number }

const ACTION_COLORS: Record<string, string> = {
  "es:GET": "bg-blue-500", "es:POST": "bg-emerald-500", "es:PUT": "bg-amber-500",
  "es:DELETE": "bg-red-500", "es:HEAD": "bg-muted-foreground",
  "auth:login": "bg-purple-500", "auth:logout": "bg-muted-foreground",
};
const actionBadge = (a: string) => <Badge className={`${ACTION_COLORS[a] ?? "bg-slate-500"} text-white text-xs px-1.5 py-0`}>{a}</Badge>;

const statusColor = (s?: number) => {
  if (!s) return "text-muted-foreground";
  if (s < 300) return "text-emerald-500";
  if (s < 400) return "text-blue-500";
  if (s < 500) return "text-amber-500";
  return "text-red-500";
};

const PAGE_LIMIT = 50;

export default function AuditTrailPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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

  const toggleExpand = (id: number) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const totalPages = data ? Math.ceil(data.total / PAGE_LIMIT) : 0;
  const currentPage = Math.floor(offset / PAGE_LIMIT) + 1;

  const ACTIONS = ["es:GET","es:POST","es:PUT","es:DELETE","es:HEAD","auth:login","auth:logout"];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ScrollText className="h-6 w-6 text-primary"/>Audit Trail</h1>
          <p className="text-sm text-muted-foreground mt-1">Every action logged with user, timestamp, and details</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={exporting}>
          {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Download className="h-4 w-4 mr-2"/>}
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card><CardContent className="pt-4 pb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Username</Label>
            <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Filter by user" className="h-8 text-sm"/>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="h-8 text-sm"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm"/>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm"/>
          </div>
          <Button size="sm" onClick={() => load(0)} className="h-8">Search</Button>
        </div>
      </CardContent></Card>

      {data && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{data.total.toLocaleString()} total records</span>
          <span>Page {currentPage} of {totalPages || 1}</span>
        </div>
      )}

      {error && <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded p-3"><AlertTriangle className="h-4 w-4"/>{error}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 px-2 font-medium w-4"/>
                <th className="text-left py-2 px-2 font-medium">Timestamp</th>
                <th className="text-left py-2 px-2 font-medium">User</th>
                <th className="text-left py-2 px-2 font-medium">Action</th>
                <th className="text-left py-2 px-2 font-medium">Endpoint</th>
                <th className="text-left py-2 px-2 font-medium">Status</th>
                <th className="text-left py-2 px-2 font-medium">Duration</th>
                <th className="text-left py-2 px-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries ?? []).map(e => (
                <>
                  <tr key={e.id} className="border-b hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => toggleExpand(e.id)}>
                    <td className="py-1.5 px-2 text-muted-foreground">{expanded.has(e.id) ? <ChevronDown className="h-3.5 w-3.5"/> : <ChevronRight className="h-3.5 w-3.5"/>}</td>
                    <td className="py-1.5 px-2 font-mono whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="py-1.5 px-2">
                      <div className="font-medium">{e.username}</div>
                      {e.user_role && <div className="text-muted-foreground">{e.user_role}</div>}
                    </td>
                    <td className="py-1.5 px-2">{actionBadge(e.action)}</td>
                    <td className="py-1.5 px-2 font-mono max-w-[200px] truncate text-muted-foreground">{e.endpoint ?? "-"}</td>
                    <td className={`py-1.5 px-2 font-bold ${statusColor(e.status_code)}`}>{e.status_code ?? "-"}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{e.duration_ms != null ? `${e.duration_ms}ms` : "-"}</td>
                    <td className="py-1.5 px-2 font-mono text-muted-foreground">{e.ip_address ?? "-"}</td>
                  </tr>
                  {expanded.has(e.id) && (
                    <tr key={`${e.id}-detail`} className="bg-muted/20 border-b">
                      <td colSpan={8} className="py-2 px-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {e.cluster_url && <div><span className="text-muted-foreground">Cluster:</span> <span className="font-mono">{e.cluster_url}</span></div>}
                          {e.request_body && (
                            <div className="md:col-span-2">
                              <span className="text-muted-foreground">Request Body:</span>
                              <pre className="mt-1 bg-muted rounded p-2 text-xs font-mono overflow-auto max-h-32">{(() => { try { return JSON.stringify(JSON.parse(e.request_body!), null, 2); } catch { return e.request_body; } })()}</pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {data?.entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No audit records found</p>}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_LIMIT))}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {currentPage} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={offset + PAGE_LIMIT >= (data?.total ?? 0)} onClick={() => load(offset + PAGE_LIMIT)}>Next</Button>
        </div>
      )}
    </div>
  );
}
