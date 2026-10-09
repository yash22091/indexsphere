"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ClickHouseGate, ClickHouseHeader, ErrorBanner, StatTile, chFetch, formatBytes, formatCompact,
} from "@/components/clickhouse/shared";
import type { AdvisorFinding, TableScore } from "@/lib/clickhouse-advisor";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Info, Lightbulb, Loader2, Microscope, RefreshCw, XCircle,
} from "lucide-react";

const ALL = "__all__";
const SKILL_URL = "https://github.com/ClickHouse/agent-skills/tree/main/skills/clickhouse-best-practices";
const ruleUrl = (rule: string) =>
  `https://github.com/ClickHouse/agent-skills/blob/main/skills/clickhouse-best-practices/rules/${rule}.md`;

const RULES_CHECKED = [
  "schema-pk-plan-before-creation", "schema-pk-cardinality-order", "schema-pk-filter-on-orderby",
  "query-index-skipping-indices", "schema-partition-low-cardinality", "schema-partition-start-without",
  "insert-batch-size", "insert-async-small-batches", "insert-mutation-avoid-update", "insert-mutation-avoid-delete",
  "insert-optimize-avoid-final", "schema-types-avoid-nullable", "schema-types-native-types",
  "schema-types-lowcardinality", "schema-types-minimize-bitwidth", "schema-json-when-to-use",
];

interface DbRow { name: string; tables: number }

function GradeBadge({ grade, score }: { grade: string; score: number }) {
  const colors: Record<string, string> = {
    A: "bg-success/15 text-success",
    B: "bg-success/10 text-success",
    C: "bg-warning/20 text-warning-foreground dark:text-warning",
    D: "bg-destructive/10 text-destructive",
    F: "bg-destructive/15 text-destructive",
  };
  return (
    <div className={`flex flex-col items-center justify-center w-12 h-12 shrink-0 rounded-md font-semibold text-lg ${colors[grade] ?? colors.F}`}>
      {grade}
      <span className="text-[10px] font-normal leading-none">{score}</span>
    </div>
  );
}

function SeverityIcon({ s }: { s: AdvisorFinding["severity"] }) {
  if (s === "critical") return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (s === "warning") return <AlertTriangle className="h-4 w-4 text-warning shrink-0" />;
  return <Info className="h-4 w-4 text-info shrink-0" />;
}

function RuleChip({ rule }: { rule: string }) {
  const cls = "inline-block font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground break-all";
  if (rule === "general-guidance") return <span className={cls}>general guidance</span>;
  return (
    <a href={ruleUrl(rule)} target="_blank" rel="noopener noreferrer" className={`${cls} hover:text-primary hover:underline`}>
      {rule}
    </a>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-foreground"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function FindingRow({ finding }: { finding: AdvisorFinding }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-start gap-2.5 p-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => finding.fix && setOpen(o => !o)}
      >
        <SeverityIcon s={finding.severity} />
        <div className="flex-1 min-w-0">
          <span onClick={e => e.stopPropagation()}><RuleChip rule={finding.rule} /></span>
          <p className="text-sm mt-1">{finding.message}</p>
        </div>
        {finding.fix && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            Fix {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
      </button>
      {open && finding.fix && (
        <div className="border-t p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Remediation</span>
            <CopyButton text={finding.fix} />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{finding.fix}</pre>
        </div>
      )}
    </div>
  );
}

function TableRow({ s, open, onToggle, onDeep, deepBusy }: {
  s: TableScore; open: boolean; onToggle: () => void; onDeep: () => void; deepBusy: boolean;
}) {
  return (
    <Card>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
        <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={onToggle}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <GradeBadge grade={s.grade} score={s.score} />
          <div className="min-w-0">
            <div className="font-medium truncate">{s.database}.{s.table}</div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              <span>{s.engine}</span>
              <span>{formatCompact(s.metrics.rows)} rows</span>
              <span>{formatBytes(s.metrics.bytes)}</span>
              {s.metrics.compressionRatio > 0 && <span>{s.metrics.compressionRatio}× compression</span>}
              <span>{s.metrics.activeParts} parts / {s.metrics.partitions} partitions</span>
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0 pl-7 sm:pl-0">
          {s.deepAnalyzed && <Badge variant="secondary" className="text-xs font-normal">Deep analyzed</Badge>}
          <Badge variant={s.findings.length ? "secondary" : "outline"} className="text-xs">
            {s.findings.length} finding{s.findings.length === 1 ? "" : "s"}
          </Badge>
          <Button size="sm" variant="outline" onClick={onDeep} disabled={deepBusy}
            title="Samples up to 1M rows (with scan caps) to check LowCardinality candidates and integer bit-width (schema-types-lowcardinality, schema-types-minimize-bitwidth)">
            {deepBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Microscope className="h-3.5 w-3.5 mr-1" />}
            Deep analyze
          </Button>
        </div>
      </div>
      {open && (
        <CardContent className="pt-0 space-y-2">
          {s.findings.length === 0
            ? <p className="text-sm text-success">No issues found against the checked rules.</p>
            : s.findings.map((f, i) => <FindingRow key={i} finding={f} />)}
        </CardContent>
      )}
    </Card>
  );
}

function AdvisorBody() {
  const params = useSearchParams();
  const initialDb = params.get("database");
  const initialTable = params.get("table");

  const [databases, setDatabases] = useState<DbRow[]>([]);
  const [database, setDatabase] = useState<string>(initialDb || ALL);
  const [scores, setScores] = useState<TableScore[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deepBusy, setDeepBusy] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [autoRan, setAutoRan] = useState(false);

  useEffect(() => {
    chFetch<{ databases: DbRow[] }>("/api/clickhouse/databases")
      .then(d => setDatabases(d.databases ?? []))
      .catch(() => setDatabases([]));
  }, []);

  const analyze = useCallback(async (db: string) => {
    setLoading(true); setError(null);
    try {
      const q = db && db !== ALL ? `?database=${encodeURIComponent(db)}` : "";
      const d = await chFetch<{ scores: TableScore[]; warnings: string[] }>(`/api/clickhouse/advisor${q}`);
      setScores([...(d.scores ?? [])].sort((a, b) => a.score - b.score));
      setWarnings(d.warnings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // ?database=&table= → preselect, auto-run, auto-expand
  useEffect(() => {
    if (autoRan || !initialDb) return;
    setAutoRan(true);
    analyze(initialDb);
    if (initialTable) setExpanded(new Set([`${initialDb}.${initialTable}`]));
  }, [autoRan, initialDb, initialTable, analyze]);

  const deepAnalyze = async (s: TableScore) => {
    const key = `${s.database}.${s.table}`;
    setDeepBusy(key); setError(null);
    try {
      const d = await chFetch<{ score: TableScore; warnings: string[] }>("/api/clickhouse/advisor", {
        method: "POST",
        body: JSON.stringify({ database: s.database, table: s.table }),
      });
      setScores(prev => (prev ?? []).map(x => (x.database === s.database && x.table === s.table ? d.score : x)));
      setExpanded(prev => new Set(prev).add(key));
    } catch (e) {
      setError(`Deep analysis of ${key} failed: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setDeepBusy(null);
    }
  };

  const summary = useMemo(() => {
    if (!scores) return null;
    const findings = scores.flatMap(s => s.findings);
    return {
      tables: scores.length,
      avg: scores.length ? Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length) : 0,
      good: scores.filter(s => s.grade === "A" || s.grade === "B").length,
      bad: scores.filter(s => s.grade === "D" || s.grade === "F").length,
      critical: findings.filter(f => f.severity === "critical").length,
      warning: findings.filter(f => f.severity === "warning").length,
      info: findings.filter(f => f.severity === "info").length,
    };
  }, [scores]);

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="space-y-1.5 flex-1 min-w-0 sm:max-w-xs">
            <div className="text-xs text-muted-foreground font-medium">Database</div>
            <Select value={database} onValueChange={setDatabase}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All databases</SelectItem>
                {databases.map(d => <SelectItem key={d.name} value={d.name}>{d.name} ({d.tables})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => analyze(database)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : scores ? <RefreshCw className="h-4 w-4 mr-1" /> : <Lightbulb className="h-4 w-4 mr-1" />}
            {scores ? "Re-analyze" : "Analyze"}
          </Button>
          <p className="text-xs text-muted-foreground sm:ml-auto sm:max-w-sm">
            Reads only system tables. Use <span className="font-medium">Deep analyze</span> on a table to sample up to 1M rows (with scan caps) for LowCardinality and integer bit-width checks.
          </p>
        </CardContent>
      </Card>

      <ErrorBanner message={error} />

      {warnings.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="space-y-1">{warnings.map((w, i) => <p key={i} className="break-words">{w}</p>)}</AlertDescription>
        </Alert>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Tables analyzed" value={summary.tables} />
          <StatTile label="Average score" value={summary.avg}
            tone={summary.avg < 50 ? "crit" : summary.avg < 80 ? "warn" : "ok"} />
          <StatTile label="Grade A / B" value={summary.good} sub={`${summary.bad} graded D / F`} tone={summary.bad ? "warn" : "ok"} />
          <StatTile label="Findings" value={summary.critical + summary.warning + summary.info}
            sub={`${summary.critical} critical · ${summary.warning} warning · ${summary.info} info`}
            tone={summary.critical ? "crit" : summary.warning ? "warn" : "ok"} />
        </div>
      )}

      {loading && !scores && (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      )}

      {scores && scores.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No tables found.</CardContent></Card>
      )}

      {scores && scores.length > 0 && (
        <div className="space-y-2">
          {scores.map(s => {
            const key = `${s.database}.${s.table}`;
            return (
              <TableRow key={key} s={s} open={expanded.has(key)} onToggle={() => toggle(key)}
                onDeep={() => deepAnalyze(s)} deepBusy={deepBusy === key} />
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader className="py-3">
          <button className="flex items-center gap-2 text-left" onClick={() => setShowRules(o => !o)}>
            {showRules ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <CardTitle className="text-sm">Rules checked ({RULES_CHECKED.length})</CardTitle>
          </button>
        </CardHeader>
        {showRules && (
          <CardContent className="pt-0 flex flex-wrap gap-1.5">
            {RULES_CHECKED.map(r => <RuleChip key={r} rule={r} />)}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export default function ClickHouseAdvisorPage() {
  return (
    <div className="space-y-6">
      <ClickHouseGate>
        {(status, disconnect) => (
          <>
            <ClickHouseHeader
              title="Table advisor"
              status={status}
              onDisconnect={disconnect}
              description={undefined}
            />
            <p className="text-sm text-muted-foreground -mt-3">
              Grades every table A–F against the ClickHouse best-practices rules from{" "}
              <a href={SKILL_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                ClickHouse agent-skills: clickhouse-best-practices
              </a>
              . Each finding cites its rule and includes a fix.
            </p>
            <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <AdvisorBody />
            </Suspense>
          </>
        )}
      </ClickHouseGate>
    </div>
  );
}
