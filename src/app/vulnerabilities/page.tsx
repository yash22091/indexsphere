"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader, SeverityBadge } from "@/components/app";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth-context";
import {
  AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Flame, Loader2, RefreshCw, Search, ShieldAlert, ShieldCheck,
} from "lucide-react";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

interface Finding {
  id: string;
  aliases: string[];
  summary: string;
  severity: Severity;
  score?: number;
  vector?: string;
  published?: string;
  fixedIn: string[];
  affectedRange?: string;
  kev?: { dateAdded: string; ransomware: string; action: string; due: string };
  epss?: { epss: number; percentile: number };
  cwes: string[];
  references: string[];
  sources: string[];
  url: string;
}

interface FeedStatus { ok: boolean; fetchedAt?: string; error?: string; cached?: boolean }

interface Assessment {
  product: "elasticsearch" | "opensearch" | "clickhouse";
  version: string;
  checkedAt: string;
  nodes: string[];
  findings: Finding[];
  summary: Record<Severity, number> & { total: number; kev: number };
  recommendation: { upgradeTo: string | null; fixesAll: boolean; unfixed: string[] };
  sources: Record<"nvd" | "osv" | "kev" | "epss", FeedStatus>;
}

const LABEL = { elasticsearch: "Elasticsearch", opensearch: "OpenSearch", clickhouse: "ClickHouse" } as const;
const SEV_CLS: Record<Severity, string> = {
  CRITICAL: "",
  HIGH: "",
  MEDIUM: "",
  LOW: "",
  UNKNOWN: "bg-muted text-muted-foreground",
};

function SevBadge({ s, score }: { s: Severity; score?: number }) {
  const label = s.charAt(0) + s.slice(1).toLowerCase();
  return (
    <SeverityBadge level={s === "UNKNOWN" ? "unknown" : s.toLowerCase()} className={`text-xs ${SEV_CLS[s]}`}>
      {label}{score !== undefined ? ` ${score.toFixed(1)}` : ""}
    </SeverityBadge>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/40 transition-colors" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold">{f.id}</span>
            <SevBadge s={f.severity} score={f.score} />
            {f.kev && <Badge variant="destructive" className="text-xs"><Flame className="mr-1 h-3 w-3" />Actively exploited</Badge>}
            {f.epss && f.epss.epss >= 0.1 && <Badge variant="outline" className="border-destructive/40 text-xs text-destructive">EPSS {(f.epss.epss * 100).toFixed(1)}%</Badge>}
            {f.fixedIn.length > 0 && <Badge variant="outline" className="text-xs">Fixed in {f.fixedIn.slice(0, 3).join(", ")}</Badge>}
          </div>
          <p className={`text-sm text-muted-foreground ${open ? "" : "line-clamp-2"}`}>{f.summary || "No description."}</p>
        </div>
      </button>
      {open && (
        <div className="border-t p-3 text-sm space-y-2 bg-muted/20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {f.affectedRange && <div><span className="text-muted-foreground">Affected range:</span> <span className="font-mono">{f.affectedRange}</span></div>}
            {f.published && <div><span className="text-muted-foreground">Published:</span> {new Date(f.published).toLocaleDateString()}</div>}
            {f.vector && <div className="md:col-span-2 break-all"><span className="text-muted-foreground">CVSS vector:</span> <span className="font-mono text-xs">{f.vector}</span></div>}
            {f.epss && <div><span className="text-muted-foreground">EPSS:</span> {(f.epss.epss * 100).toFixed(2)}% (percentile {(f.epss.percentile * 100).toFixed(0)})</div>}
            {f.cwes.length > 0 && <div><span className="text-muted-foreground">Weakness:</span> {f.cwes.join(", ")}</div>}
            {f.aliases.length > 0 && <div><span className="text-muted-foreground">Also known as:</span> <span className="font-mono text-xs">{f.aliases.join(", ")}</span></div>}
            <div><span className="text-muted-foreground">Sources:</span> {f.sources.join(" + ")}</div>
          </div>
          {f.kev && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
              Added to CISA KEV on {f.kev.dateAdded}{f.kev.ransomware === "Known" ? " — used in ransomware campaigns" : ""}. Required action: {f.kev.action}
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
              Advisory <ExternalLink className="h-3 w-3" />
            </a>
            {f.references.slice(0, 5).map(u => {
              let host = u;
              try { host = new URL(u).host; } catch { /* keep raw */ }
              return (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline underline-offset-2">
                  {host} <ExternalLink className="h-3 w-3" />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AssessmentView({ a }: { a: Assessment }) {
  const [query, setQuery] = useState("");
  const [minSev, setMinSev] = useState<"ALL" | Severity>("ALL");
  const [kevOnly, setKevOnly] = useState(false);
  const order: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

  const shown = useMemo(() => a.findings.filter(f => {
    if (kevOnly && !f.kev) return false;
    if (minSev !== "ALL" && order.indexOf(f.severity) > order.indexOf(minSev)) return false;
    if (query && !`${f.id} ${f.aliases.join(" ")} ${f.summary}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [a.findings, query, minSev, kevOnly]);

  const s = a.summary;
  const feedErrors = Object.entries(a.sources).filter(([, v]) => v.error);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              {s.total === 0 ? <ShieldCheck className="h-6 w-6 text-success" /> : <ShieldAlert className={`h-6 w-6 ${s.CRITICAL + s.HIGH + s.kev > 0 ? "text-destructive" : "text-warning"}`} />}
              <div>
                <div className="text-lg font-semibold">{LABEL[a.product]} {a.version}</div>
                <div className="text-xs text-muted-foreground">
                  {a.nodes.length > 0 && <>{a.nodes.length} node{a.nodes.length === 1 ? "" : "s"}: {a.nodes.slice(0, 5).join(", ")}{a.nodes.length > 5 ? "…" : ""} · </>}
                  checked {new Date(a.checkedAt).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
              {[["Total", s.total, ""], ["Critical", s.CRITICAL, s.CRITICAL ? "text-destructive" : ""], ["High", s.HIGH, s.HIGH ? "text-destructive" : ""],
                ["Medium", s.MEDIUM, s.MEDIUM ? "text-warning" : ""], ["Low", s.LOW, ""], ["Exploited", s.kev, s.kev ? "text-destructive" : ""]].map(([l, v, c]) => (
                <div key={String(l)} className="rounded border px-3 py-1.5">
                  <div className={`text-lg font-bold tabular-nums ${c}`}>{v}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
          </div>
          {a.recommendation.upgradeTo && (
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              Recommended: upgrade to <strong>{LABEL[a.product]} ≥ {a.recommendation.upgradeTo}</strong>
              {a.recommendation.fixesAll ? " — fixes all findings with a published fix." : ` — ${a.recommendation.unfixed.length} finding(s) have no fixed version listed; review them individually.`}
              {" "}Check the version below with &ldquo;Check a version&rdquo; before upgrading.
            </div>
          )}
          {feedErrors.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{feedErrors.map(([k, v]) => `${k.toUpperCase()}: ${v.error}${v.fetchedAt ? ` (using data from ${new Date(v.fetchedAt).toLocaleString()})` : ""}`).join(" · ")}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {a.findings.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Filter by CVE id or text" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <Select value={minSev} onValueChange={v => setMinSev(v as typeof minSev)}>
            <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All severities</SelectItem>
              <SelectItem value="CRITICAL">Critical only</SelectItem>
              <SelectItem value="HIGH">High and above</SelectItem>
              <SelectItem value="MEDIUM">Medium and above</SelectItem>
              <SelectItem value="LOW">Low and above</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={kevOnly} onCheckedChange={setKevOnly} /> Exploited only
          </label>
        </div>
      )}

      <div className="space-y-2">
        {shown.map(f => <FindingRow key={f.id} f={f} />)}
        {a.findings.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">No findings match the filters.</p>}
      </div>
    </div>
  );
}

function TargetPanel({ target, isAdmin }: { target: "search" | "clickhouse"; isAdmin: boolean }) {
  const [data, setData] = useState<Assessment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null);
    try {
      const r = force
        ? await fetch("/api/vulnerabilities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) })
        : await fetch(`/api/vulnerabilities?target=${target}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Lookup failed");
      setData(d.assessments);
    } catch (e) { setError(e instanceof Error ? e.message : "Lookup failed"); setData(null); }
    finally { setLoading(false); }
  }, [target]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => load(isAdmin)} disabled={loading} title={isAdmin ? "Re-fetch feeds, ignoring the 24h cache" : "Reload"}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          {isAdmin ? "Refresh from sources" : "Reload"}
        </Button>
      </div>
      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Detecting version and querying NVD, OSV, CISA KEV and EPSS (first lookup can take ~15s)…
        </div>
      )}
      {error && (
        <Card><CardContent className="p-4 text-sm text-muted-foreground flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          <span>{error}{/connected/i.test(error) && <> — connect on the {target === "clickhouse" ? <a className="underline" href="/clickhouse">ClickHouse</a> : <a className="underline" href="/connections">Connections</a>} page.</>}</span>
        </CardContent></Card>
      )}
      {data?.map(a => <AssessmentView key={`${a.product}-${a.version}`} a={a} />)}
    </div>
  );
}

function ManualCheck() {
  const [product, setProduct] = useState<"elasticsearch" | "opensearch" | "clickhouse">("elasticsearch");
  const [version, setVersion] = useState("");
  const [data, setData] = useState<Assessment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/vulnerabilities?product=${product}&version=${encodeURIComponent(version.trim())}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Lookup failed");
      setData(d.assessments);
    } catch (e) { setError(e instanceof Error ? e.message : "Lookup failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Check any version</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5 sm:w-48">
            <Label>Product</Label>
            <Select value={product} onValueChange={v => setProduct(v as typeof product)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="elasticsearch">Elasticsearch</SelectItem>
                <SelectItem value="opensearch">OpenSearch</SelectItem>
                <SelectItem value="clickhouse">ClickHouse</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 flex-1">
            <Label>Version</Label>
            <Input value={version} onChange={e => setVersion(e.target.value)} placeholder={product === "clickhouse" ? "25.8.2.29" : "8.15.0"}
              onKeyDown={e => { if (e.key === "Enter" && version.trim()) run(); }} />
          </div>
          <Button onClick={run} disabled={loading || !version.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Search className="h-4 w-4 mr-1" />}Check
          </Button>
        </CardContent>
      </Card>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.map(a => <AssessmentView key={`${a.product}-${a.version}`} a={a} />)}
    </div>
  );
}

function VulnerabilitiesContent() {
  const params = useSearchParams();
  const { user } = useAuth();
  const isAdmin = !!user?.permissions?.includes("admin");
  const initial = params.get("target") === "clickhouse" ? "clickhouse" : params.get("target") === "manual" ? "manual" : "search";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vulnerabilities"
        description={<>Known CVEs for the versions you run, matched against NVD and OSV (GitHub advisories), flagged with CISA&apos;s Known Exploited Vulnerabilities catalog and EPSS exploit probability. Feeds are cached for 24 hours.</>}
      />
      <Tabs defaultValue={initial}>
        <TabsList>
          <TabsTrigger value="search">Elasticsearch / OpenSearch</TabsTrigger>
          <TabsTrigger value="clickhouse">ClickHouse</TabsTrigger>
          <TabsTrigger value="manual">Check a version</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-4"><TargetPanel target="search" isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="clickhouse" className="mt-4"><TargetPanel target="clickhouse" isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="manual" className="mt-4"><ManualCheck /></TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        Matching is based on product version only. Some CVEs apply only to specific plugins, features or configurations — confirm applicability in the linked advisory.
      </p>
    </div>
  );
}

export default function VulnerabilitiesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <VulnerabilitiesContent />
    </Suspense>
  );
}
