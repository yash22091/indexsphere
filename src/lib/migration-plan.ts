/** Build a ClickHouse table plan from a live Elasticsearch/OpenSearch index mapping. */
import type { ElasticsearchClient } from './elasticsearch';
import { cardinalityField, EsField, flattenMapping, MigrationPlan, planMigration } from './es-to-clickhouse';

export const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function indexPath(index: string): string {
  return `/${encodeURIComponent(index).replace(/%2A/gi, '*').replace(/%2C/gi, ',')}`;
}

export async function planFromIndex(
  client: ElasticsearchClient,
  opts: { index: string; database: string; table: string; naming?: 'underscore' | 'dotted'; analyzeCardinality?: boolean },
): Promise<{ plan: MigrationPlan; cardinalityAnalyzed: boolean }> {
  const path = indexPath(opts.index);
  const mapping = await client.request(`${path}/_mapping`) as Record<string, { mappings?: { properties?: Record<string, EsField> } }>;
  // Merge properties across matched indices (patterns like logs-*)
  const properties: Record<string, EsField> = {};
  for (const m of Object.values(mapping)) Object.assign(properties, m.mappings?.properties ?? {});
  if (!Object.keys(properties).length) throw new Error('Index has no mapped fields');

  // Optional: measured cardinality (read-only aggregation) for keyword and text+keyword fields
  let cardinality: Record<string, number> | undefined;
  if (opts.analyzeCardinality) {
    const targets = flattenMapping(properties)
      .map(l => ({ path: l.path, agg: cardinalityField(l.path, l.field) }))
      .filter((t): t is { path: string; agg: string } => t.agg !== null)
      .slice(0, 60);
    if (targets.length) {
      try {
        const aggs = Object.fromEntries(targets.map((t, i) => [`f${i}`, { cardinality: { field: t.agg, precision_threshold: 20000 } }]));
        const res = await client.request(`${path}/_search`, {
          method: 'POST',
          body: JSON.stringify({ size: 0, track_total_hits: false, aggs }),
        }) as { aggregations?: Record<string, { value: number }> };
        cardinality = Object.fromEntries(targets.map((t, i) => [t.path, res.aggregations?.[`f${i}`]?.value ?? 0]));
      } catch { /* fall back to heuristics */ }
    }
  }

  return {
    plan: planMigration(properties, { database: opts.database, table: opts.table, naming: opts.naming, cardinality }),
    cardinalityAnalyzed: !!cardinality,
  };
}
