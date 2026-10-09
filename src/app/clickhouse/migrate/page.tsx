"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, StatusDot } from "@/components/app";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConnection } from "@/contexts/connection-context";
import { useAuth } from "@/contexts/auth-context";
import { ErrorBanner, chFetch, formatNumber, useClickHouseConnection } from "@/components/clickhouse/shared";
import { MigrationJobs } from "@/components/clickhouse/migration-jobs";
import type { MigrationPlan } from "@/lib/es-to-clickhouse";
import { ArrowRight, Check, CheckCircle, Copy, Database, ExternalLink, Loader2, PlugZap, Sparkles } from "lucide-react";

const ruleUrl = (rule: string) =>
  `https://github.com/ClickHouse/agent-skills/blob/main/skills/clickhouse-best-practices/rules/${rule}.md`;

interface CatIndex { index: string; "docs.count"?: string; "store.size"?: string }

function RuleChip({ rule }: { rule?: string }) {
  if (!rule) return null;
  return (
    <a href={ruleUrl(rule)} target="_blank" rel="noopener noreferrer"
      className="inline-block font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:text-primary hover:underline break-all">
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

const tableNameFor = (index: string) =>
  index.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "migrated";

export default function ClickHouseMigratePage() {
  const { isConnected, connectionConfig } = useConnection();
  const { status: ch } = useClickHouseConnection();
  const { user } = useAuth();
  const canWrite = !!user?.permissions?.includes("user");

  const [indices, setIndices] = useState<CatIndex[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [indexLoadError, setIndexLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState("");
  const [database, setDatabase] = useState("default");
  const [table, setTable] = useState("");
  const [tableTouched, setTableTouched] = useState(false);
  const [naming, setNaming] = useState<"underscore" | "dotted">("underscore");
  const [analyzeCardinality, setAnalyzeCardinality] = useState(true);

  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [cardinalityAnalyzed, setCardinalityAnalyzed] = useState(false);
  const [busy, setBusy] = useState<"plan" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected) return;
    chFetch<CatIndex[]>("/api/es-proxy/_cat/indices?format=json&h=index,docs.count,store.size&s=index")
      .then(d => { setIndices(Array.isArray(d) ? d : []); setIndexLoadError(null); })
      .catch(e => setIndexLoadError(e instanceof Error ? e.message : "Could not list indices"));
  }, [isConnected]);

  const visibleIndices = useMemo(
    () => indices.filter(i => showHidden || !i.index.startsWith(".")),
    [indices, showHidden],
  );

  const pickIndex = (value: string) => {
    setIndex(value);
    if (!tableTouched) setTable(tableNameFor(value));
  };

  const run = async (create: boolean) => {
    if (create && !confirm(`Create table ${database}.${table} in ClickHouse?`)) return;
    setBusy(create ? "create" : "plan"); setError(null); setCreated(null);
    try {
      const d = await chFetch<{ plan: MigrationPlan; created: boolean; cardinalityAnalyzed: boolean }>("/api/clickhouse/migrate", {
        method: "POST",
        body: JSON.stringify({ index: index.trim(), database: database.trim(), table: table.trim(), naming, analyzeCardinality, create }),
      });
      setPlan(d.plan);
      setCardinalityAnalyzed(d.cardinalityAnalyzed);
      if (d.created) setCreated(`${d.plan.database}.${d.plan.table}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };

  const canPlan = isConnected && !!index.trim() && !!database.trim() && !!table.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Migrate from Elasticsearch"
        description="Turn an Elasticsearch / OpenSearch index mapping into a ClickHouse table that follows the ClickHouse best-practice rules: native types, LowCardinality, no Nullable, ORDER BY and partitioning."
      />

      {/* Connection status for both sides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Source · Elasticsearch / OpenSearch</div>
              <div className="font-medium truncate mt-0.5">{isConnected ? connectionConfig?.url : "Not connected"}</div>
            </div>
            {isConnected
              ? <Badge variant="outline" className="shrink-0 gap-1.5 font-normal"><StatusDot status="green" />Connected</Badge>
              : <div className="flex gap-2 shrink-0">
                  <Link href="/connect"><Button size="sm" variant="outline"><PlugZap className="h-3.5 w-3.5 mr-1" />Connect</Button></Link>
                  <Link href="/connections"><Button size="sm" variant="ghost">Saved</Button></Link>
                </div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Target · ClickHouse (optional)</div>
              <div className="font-medium truncate mt-0.5">
                {ch?.connected ? `${ch.url} · ${ch.version}` : "Not connected — plans still work; creating needs a connection"}
              </div>
            </div>
            {ch?.connected
              ? <Badge variant="outline" className="shrink-0 gap-1.5 font-normal"><StatusDot status="green" />Connected</Badge>
              : <Link href="/clickhouse" className="shrink-0"><Button size="sm" variant="outline"><Database className="h-3.5 w-3.5 mr-1" />Connect</Button></Link>}
          </CardContent>
        </Card>
      </div>

      {!isConnected ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground space-y-3">
          <p>Connect to an Elasticsearch or OpenSearch cluster to read index mappings.</p>
          <div className="flex justify-center gap-2">
            <Link href="/connect"><Button>Connect</Button></Link>
            <Link href="/connections"><Button variant="outline">Saved connections</Button></Link>
          </div>
        </CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Source index and target table</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ErrorBanner message={indexLoadError} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="space-y-1.5 min-w-0">
                <Label>Index</Label>
                <Select value={visibleIndices.some(i => i.index === index) ? index : ""} onValueChange={pickIndex}>
                  <SelectTrigger><SelectValue placeholder={`Pick an index (${visibleIndices.length})`} /></SelectTrigger>
                  <SelectContent>
                    {visibleIndices.map(i => (
                      <SelectItem key={i.index} value={i.index}>
                        {i.index}{i["docs.count"] ? ` · ${formatNumber(Number(i["docs.count"]))} docs` : ""}{i["store.size"] ? ` · ${i["store.size"]}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Switch checked={showHidden} onCheckedChange={setShowHidden} />
                  <span className="text-xs text-muted-foreground">Show hidden (.) indices</span>
                </div>
              </div>
              <div className="space-y-1.5 min-w-0">
                <Label>…or index name / pattern</Label>
                <Input value={index} onChange={e => pickIndex(e.target.value)} placeholder="wazuh-alerts-*" />
                <p className="text-xs text-muted-foreground">Patterns merge the mappings of all matching indices.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Target database</Label>
                <Input value={database} onChange={e => setDatabase(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Target table</Label>
                <Input value={table} onChange={e => { setTable(e.target.value); setTableTouched(true); }} />
              </div>
              <div className="space-y-1.5">
                <Label>Column naming</Label>
                <Select value={naming} onValueChange={v => setNaming(v as "underscore" | "dotted")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="underscore">source.ip → source_ip</SelectItem>
                    <SelectItem value="dotted">keep `source.ip`</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Switch checked={analyzeCardinality} onCheckedChange={setAnalyzeCardinality} />
              <div>
                <Label>Analyze field cardinality</Label>
                <p className="text-xs text-muted-foreground">Runs a read-only cardinality aggregation on keyword fields, so LowCardinality and ORDER BY are chosen from real distinct counts instead of name heuristics.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run(false)} disabled={!canPlan || !!busy}>
                {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}Generate plan
              </Button>
              {plan && ch?.connected && canWrite && (
                <Button variant="secondary" onClick={() => run(true)} disabled={!canPlan || !!busy}>
                  {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Database className="h-4 w-4 mr-1" />}Create table in ClickHouse
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <ErrorBanner message={error} />
      {created && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm">
          <CheckCircle className="h-4 w-4 shrink-0 text-success" />Created table <span className="font-mono">{created}</span> in ClickHouse.
          <Link href={`/clickhouse/advisor?database=${encodeURIComponent(plan?.database ?? "")}&table=${encodeURIComponent(plan?.table ?? "")}`} className="text-primary hover:underline ml-1">Review in advisor</Link>
        </div>
      )}

      {plan && (
        <>
          <MigrationJobs
            index={index}
            database={plan.database}
            table={plan.table}
            naming={naming}
            analyzeCardinality={analyzeCardinality}
            canWrite={canWrite}
            chConnected={!!ch?.connected}
          />
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Table definition</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{cardinalityAnalyzed ? "cardinality measured" : "heuristic types"}</Badge>
                <Link href={`/clickhouse/sql?q=${encodeURIComponent(plan.ddl)}`}>
                  <Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5 mr-1" />Open in SQL workbench</Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md bg-muted p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{plan.columns.length} columns</span>
                  <CopyButton text={plan.ddl} />
                </div>
                <pre className="max-h-96 overflow-x-auto font-mono text-xs leading-relaxed">{plan.ddl}</pre>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">ORDER BY</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="font-mono text-sm break-words">({plan.orderBy.join(", ") || "—"})</div>
                <p className="text-xs text-muted-foreground">{plan.orderByReason}</p>
                <div className="flex flex-wrap gap-1"><RuleChip rule="schema-pk-cardinality-order" /><RuleChip rule="schema-pk-prioritize-filters" /><RuleChip rule="schema-pk-plan-before-creation" /></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">PARTITION BY</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="font-mono text-sm break-words">{plan.partitionBy ?? "none"}</div>
                <p className="text-xs text-muted-foreground">
                  {plan.partitionBy
                    ? `Monthly partitions on ${plan.timeColumn}: low partition count, cheap retention via DROP PARTITION.`
                    : "No date field found, so the table is not partitioned."}
                </p>
                <div className="flex flex-wrap gap-1"><RuleChip rule="schema-partition-lifecycle" /><RuleChip rule="schema-partition-low-cardinality" /></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Column mapping</CardTitle></CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-auto max-h-[520px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {["ES field", "", "Column", "ClickHouse type", "Why"].map(h => (
                        <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap border-b">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.columns.map(c => (
                      <tr key={c.column} className="border-b last:border-0 hover:bg-muted/40 align-top">
                        <td className="px-3 py-1.5 font-mono break-all">{c.source}</td>
                        <td className="px-1 py-1.5 text-muted-foreground"><ArrowRight className="h-3 w-3" /></td>
                        <td className="px-3 py-1.5 font-mono break-all">{c.column}</td>
                        <td className="px-3 py-1.5 font-mono whitespace-nowrap">{c.type}</td>
                        <td className="px-3 py-1.5 space-y-1 min-w-[200px]">
                          <div>{c.reason}</div>
                          <RuleChip rule={c.rule} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {plan.skipped.length > 0 && (
                <div className="mt-3 text-xs">
                  <div className="font-medium mb-1">Skipped fields ({plan.skipped.length})</div>
                  <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
                    {plan.skipped.map(s => <li key={s.source}><span className="font-mono">{s.source}</span> — {s.reason}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 text-sm space-y-1">
                {plan.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Ingestion next steps</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <ul className="list-disc pl-5 space-y-1">
            <li>Insert in batches of 10K–100K rows per INSERT; every insert creates a part, and tiny inserts cause &quot;too many parts&quot;. <RuleChip rule="insert-batch-size" /></li>
            <li>Many small producers? Enable <span className="font-mono">async_insert</span> so the server batches for you. <RuleChip rule="insert-async-small-batches" /></li>
            <li>Shippers such as Vector or Logstash can write to ClickHouse directly with their ClickHouse outputs, batched as above.</li>
            <li>For a one-off backfill, ClickHouse can read the source over HTTP from inside the cluster (for example an <span className="font-mono">INSERT … SELECT</span> from an external source). Run large backfills in time-sliced batches.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
