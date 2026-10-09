"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, Copy, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader, SeverityBadge, StatCard, StatGrid } from "@/components/app";
import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface Finding {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  remediation?: string;
  reference?: string;
}

interface Check { id: string; title: string; status: "pass" | "fail" | "skipped"; note?: string }

interface Report {
  engine: "elasticsearch" | "opensearch" | "clickhouse";
  version: string;
  target: string;
  checkedAt: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  findings: Finding[];
  checks: Check[];
}

const ENGINE: Record<Report["engine"], string> = { elasticsearch: "Elasticsearch", opensearch: "OpenSearch", clickhouse: "ClickHouse" };

function gradeTone(grade: Report["grade"]) {
  if (grade === "A" || grade === "B") return "success" as const;
  if (grade === "C") return "warning" as const;
  return "danger" as const;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Copy"
      onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function FindingItem({ f }: { f: Finding }) {
  const [open, setOpen] = useState(f.severity === "critical");
  return (
    <div className="rounded-lg border">
      <button className="flex w-full items-start gap-3 p-4 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge level={f.severity}>{f.severity.charAt(0).toUpperCase() + f.severity.slice(1)}</SeverityBadge>
            <span className="text-xs text-muted-foreground">{f.category}</span>
          </div>
          <p className="text-sm font-medium">{f.title}</p>
          {!open && <p className="line-clamp-1 text-sm text-muted-foreground">{f.detail}</p>}
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t px-4 py-3 pl-11">
          <p className="text-sm text-muted-foreground">{f.detail}</p>
          {f.remediation && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Remediation</span>
                <CopyButton text={f.remediation} />
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">{f.remediation}</pre>
            </div>
          )}
          {f.reference && (
            f.reference.startsWith("/")
              ? <Link href={f.reference} className="text-sm underline underline-offset-4">View details</Link>
              : <a href={f.reference} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">Documentation</a>
          )}
        </div>
      )}
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  const counts = (s: Severity) => report.findings.filter(f => f.severity === s).length;
  const passed = report.checks.filter(c => c.status === "pass").length;
  const skipped = report.checks.filter(c => c.status === "skipped");

  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard label="Posture score" value={<>{report.grade} <span className="text-base font-normal text-muted-foreground">· {report.score}/100</span></>}
          tone={gradeTone(report.grade)} hint={`${ENGINE[report.engine]} ${report.version}`} icon={ShieldCheck} />
        <StatCard label="Critical / high" value={`${counts("critical")} / ${counts("high")}`}
          tone={counts("critical") ? "danger" : counts("high") ? "warning" : "default"} hint="Fix these first" />
        <StatCard label="Medium / low" value={`${counts("medium")} / ${counts("low")}`} />
        <StatCard label="Checks passed" value={`${passed} / ${report.checks.length}`} hint={skipped.length ? `${skipped.length} skipped (insufficient privileges)` : "All checks ran"} />
      </StatGrid>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Findings</CardTitle>
          <CardDescription>
            {report.target} · audited {new Date(report.checkedAt).toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {report.findings.length === 0
            ? <EmptyState icon={CheckCircle2} title="No issues found" description="Every check that could run passed." />
            : report.findings.map(f => <FindingItem key={f.id} f={f} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checks</CardTitle>
          <CardDescription>Everything the audit looked at. Skipped checks need more privileges for the connected account.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {report.checks.map(c => (
              <li key={c.id} className="flex items-start gap-3 py-2.5 text-sm">
                {c.status === "pass" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
                {c.status === "fail" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                {c.status === "skipped" && <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className={cn("flex-1", c.status === "skipped" && "text-muted-foreground")}>{c.title}</span>
                {c.note && <span className="text-right text-xs text-muted-foreground">{c.note}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function TargetPanel({ target }: { target: "search" | "clickhouse" }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/security/posture?target=${target}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Audit failed");
      setReport(d.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => { run(); }, [run]);

  if (error && /connected/i.test(error)) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title={target === "clickhouse" ? "No ClickHouse server connected" : "No cluster connected"}
        description="Connect first, then run the audit against that server."
        action={<Button asChild><Link href={target === "clickhouse" ? "/clickhouse" : "/connections"}>Connect</Link></Button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Run audit
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading && !report && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Auditing configuration, TLS and known vulnerabilities…
        </div>
      )}
      {report && <ReportView report={report} />}
    </div>
  );
}

export default function SecurityPosturePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Security posture"
        description="Read-only audit of authentication, encryption, privileges, logging and backups, combined with known vulnerabilities for the running version."
        meta={<Badge variant="outline">No passwords are guessed — checks only read configuration</Badge>}
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
