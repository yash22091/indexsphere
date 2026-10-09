"use client";

/**
 * Renders a best-practice configuration review (lib/config-review.ts):
 * score, a per-category scorecard, and every check with its current value,
 * the recommended value and — for failures — the fix.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, Check, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, ClipboardCheck, Copy, Download,
  ExternalLink, Loader2, RefreshCw, XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState, SeverityBadge, StatCard, StatGrid } from "@/components/app";
import { cn } from "@/lib/utils";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Target = "search" | "clickhouse";

export interface ReviewCheck {
  id: string;
  category: string;
  title: string;
  status: "pass" | "fail" | "skipped";
  severity?: Severity;
  current?: string;
  recommended?: string;
  detail?: string;
  remediation?: string;
  reference?: string;
}

export interface Review {
  engine?: "clickhouse" | "elasticsearch" | "opensearch";
  version: string;
  target: string;
  checkedAt: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  categories: string[];
  checks: ReviewCheck[];
  summary: { pass: number; fail: number; skipped: number; bySeverity: Record<Severity, number> };
}

const ENGINE: Record<string, string> = { elasticsearch: "Elasticsearch", opensearch: "OpenSearch", clickhouse: "ClickHouse" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function gradeTone(grade: Review["grade"]) {
  if (grade === "A" || grade === "B") return "success" as const;
  if (grade === "C") return "warning" as const;
  return "danger" as const;
}

/** Load (and reload) a review for one engine. */
export function useReview(target: Target) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/best-practices?target=${target}${refresh ? "&refresh=1" : ""}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Review failed");
      setReview(d.review);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [target]);
  useEffect(() => { run(); }, [run]);
  return { review, error, loading, run };
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

function StatusIcon({ status }: { status: ReviewCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Pass" />;
  if (status === "fail") return <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Fail" />;
  return <CircleSlash className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Skipped" />;
}

function Reference({ reference }: { reference: string }) {
  if (reference.startsWith("http")) {
    return (
      <a href={reference} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm underline underline-offset-4">
        Documentation<ExternalLink className="h-3 w-3" />
      </a>
    );
  }
  return <span className="text-xs text-muted-foreground">Rule: <code className="font-mono">{reference}</code></span>;
}

function CheckRow({ c }: { c: ReviewCheck }) {
  const expandable = c.status !== "pass" || !!c.detail;
  const [open, setOpen] = useState(c.status === "fail" && (c.severity === "critical" || c.severity === "high"));
  return (
    <li className="py-1">
      <button
        type="button"
        className={cn("grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-md px-2 py-2 text-left sm:grid-cols-[1rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem]", expandable && "hover:bg-muted/50")}
        onClick={() => expandable && setOpen(o => !o)}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="mt-0.5"><StatusIcon status={c.status} /></span>
        <span className={cn("text-sm", c.status === "skipped" && "text-muted-foreground", c.status === "fail" && "font-medium")}>{c.title}</span>
        <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto sm:text-sm">
          <span className="sm:hidden">Now: </span>{c.current ?? (c.status === "skipped" ? c.detail : "—")}
        </span>
        <span className="col-start-2 text-xs text-muted-foreground sm:col-start-auto sm:text-sm">
          <span className="sm:hidden">Recommended: </span>{c.recommended ?? "—"}
        </span>
        <span className="col-start-2 flex items-center gap-2 sm:col-start-auto sm:justify-end">
          {c.status === "fail" && c.severity && <SeverityBadge level={c.severity}>{cap(c.severity)}</SeverityBadge>}
          {expandable && (open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />)}
        </span>
      </button>
      {open && expandable && (
        <div className="ml-9 mr-2 mb-2 space-y-3 rounded-md border bg-muted/30 p-3">
          {c.detail && <p className="text-sm text-muted-foreground">{c.detail}</p>}
          {c.remediation && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">How to fix</span>
                <CopyButton text={c.remediation} />
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">{c.remediation}</pre>
            </div>
          )}
          {c.reference && <Reference reference={c.reference} />}
        </div>
      )}
    </li>
  );
}

export function ReviewView({ review }: { review: Review }) {
  const [issuesOnly, setIssuesOnly] = useState(false);
  const byCategory = useMemo(() => review.categories
    .map(cat => ({ cat, checks: review.checks.filter(c => c.category === cat) }))
    .filter(g => g.checks.length), [review]);
  const sev = review.summary.bySeverity;
  const ran = review.summary.pass + review.summary.fail;

  const download = () => {
    const blob = new Blob([JSON.stringify(review, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `best-practices-${review.engine ?? "review"}-${review.checkedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard label="Best-practice score"
          value={<>{review.grade} <span className="text-base font-normal text-muted-foreground">· {review.score}/100</span></>}
          tone={gradeTone(review.grade)} hint={`${ENGINE[review.engine ?? ""] ?? ""} ${review.version}`} icon={ClipboardCheck} />
        <StatCard label="Critical / high" value={`${sev.critical} / ${sev.high}`}
          tone={sev.critical ? "danger" : sev.high ? "warning" : "default"} hint="Fix these first" />
        <StatCard label="Medium / low" value={`${sev.medium} / ${sev.low}`} hint={sev.info ? `${sev.info} informational` : undefined} />
        <StatCard label="Checks passed" value={`${review.summary.pass} / ${ran}`}
          hint={review.summary.skipped ? `${review.summary.skipped} skipped (not readable by this account)` : "All checks ran"} />
      </StatGrid>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scorecard</CardTitle>
          <CardDescription>{review.target} · reviewed {new Date(review.checkedAt).toLocaleString()}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {byCategory.map(({ cat, checks }) => {
              const fails = checks.filter(c => c.status === "fail");
              const worst = fails.find(c => c.severity === "critical") ?? fails.find(c => c.severity === "high") ?? fails.find(c => c.severity === "medium") ?? fails[0];
              const pass = checks.filter(c => c.status === "pass").length;
              const tone = !fails.length ? "ok" : worst?.severity === "critical" || worst?.severity === "high" ? "bad" : worst?.severity === "info" ? "info" : "warn";
              return (
                <a key={cat} href={`#cat-${cat.replace(/\W+/g, "-")}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full",
                      tone === "ok" ? "bg-success" : tone === "bad" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-info")} />
                    <span className="truncate">{cat}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {fails.length ? `${fails.length} issue${fails.length > 1 ? "s" : ""}` : `${pass}/${checks.length} ok`}
                  </span>
                </a>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="issues-only" checked={issuesOnly} onCheckedChange={setIssuesOnly} />
          <Label htmlFor="issues-only" className="font-normal">Show issues only</Label>
        </div>
        <Button variant="outline" size="sm" onClick={download}><Download className="mr-2 h-4 w-4" />Download JSON</Button>
      </div>

      {byCategory.map(({ cat, checks }) => {
        const shown = issuesOnly ? checks.filter(c => c.status !== "pass") : checks;
        if (!shown.length) return null;
        return (
          <Card key={cat} id={`cat-${cat.replace(/\W+/g, "-")}`} className="scroll-mt-20">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{cat}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="hidden grid-cols-[1rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem] gap-x-3 px-2 pb-1 text-xs font-medium text-muted-foreground sm:grid">
                <span /><span>Check</span><span>Current</span><span>Recommended</span><span />
              </div>
              <ul className="divide-y">{shown.map(c => <CheckRow key={c.id} c={c} />)}</ul>
            </CardContent>
          </Card>
        );
      })}
      {issuesOnly && review.summary.fail === 0 && (
        <EmptyState icon={CheckCircle2} title="No issues" description="Every check that could run follows the recommendation." />
      )}
    </div>
  );
}

export function ReviewPanel({ target }: { target: Target }) {
  const { review, error, loading, run } = useReview(target);

  if (error && /connected/i.test(error)) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={target === "clickhouse" ? "No ClickHouse server connected" : "No cluster connected"}
        description="Connect first, then review that server's configuration."
        action={<Button asChild><Link href={target === "clickhouse" ? "/clickhouse" : "/connections"}>Connect</Link></Button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => run(true)} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Run review
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading && !review && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reviewing configuration…
        </div>
      )}
      {review && <ReviewView review={review} />}
    </div>
  );
}

/** Compact card for overview pages: grade + top issues + link to the full review. */
export function ReviewSummaryCard({ target }: { target: Target }) {
  const { review, error, loading } = useReview(target);
  if (error) return null;
  const href = `/best-practices${target === "clickhouse" ? "?target=clickhouse" : ""}`;
  const top = review?.checks.filter(c => c.status === "fail" && c.severity !== "info").slice(0, 3) ?? [];
  const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  top.sort((a, b) => sevRank[a.severity ?? "info"] - sevRank[b.severity ?? "info"]);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Best practices</CardTitle>
          <CardDescription>Configuration compared with the vendor&apos;s production recommendations.</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm"><Link href={href}>Open review</Link></Button>
      </CardHeader>
      <CardContent>
        {loading || !review ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reviewing…</div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-semibold",
                gradeTone(review.grade) === "success" ? "text-success" : gradeTone(review.grade) === "warning" ? "text-warning" : "text-destructive")}>
                {review.grade}
              </span>
              <span className="text-sm text-muted-foreground">{review.score}/100 · {review.summary.pass}/{review.summary.pass + review.summary.fail} checks pass</span>
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5">
              {top.length === 0
                ? <li className="text-sm text-muted-foreground">No issues found.</li>
                : top.map(c => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <SeverityBadge level={c.severity!}>{cap(c.severity!)}</SeverityBadge>
                    <span className="truncate">{c.title}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
