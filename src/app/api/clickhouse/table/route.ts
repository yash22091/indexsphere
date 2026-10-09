/** GET /api/clickhouse/table?database=…&table=… — columns, DDL, partitions, skip indices, sample rows. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, settled } from '@/lib/clickhouse-api';
import { quoteIdent } from '@/lib/clickhouse-sql';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const database = request.nextUrl.searchParams.get('database');
  const table = request.nextUrl.searchParams.get('table');
  if (!database || !table) return NextResponse.json({ error: 'database and table are required' }, { status: 400 });

  const params = { db: database, t: table };
  const q = (sql: string, extra: Record<string, string | number> = {}) =>
    session.client.query(sql, { role: user.role, params, settings: extra }).then(r => r.data);

  try {
    const info = await q(`SELECT name, engine, engine_full, sorting_key, primary_key, partition_key, sampling_key,
                                 ifNull(total_rows, 0) AS rows, ifNull(total_bytes, 0) AS bytes, comment,
                                 create_table_query, metadata_modification_time AS modified
                          FROM system.tables WHERE database = {db:String} AND name = {t:String}`);
    if (!info.length) return NextResponse.json({ error: 'Table not found' }, { status: 404 });

    const isView = /View$/.test(String(info[0].engine));
    const [columns, partitions, skipIndices, sample] = await Promise.allSettled([
      q(`SELECT name, type, default_kind, default_expression, comment, compression_codec,
                is_in_sorting_key, is_in_primary_key, is_in_partition_key,
                data_compressed_bytes, data_uncompressed_bytes
         FROM system.columns WHERE database = {db:String} AND table = {t:String} ORDER BY position`),
      q(`SELECT partition, count() AS parts, sum(rows) AS rows, sum(bytes_on_disk) AS bytes,
                min(min_time) AS min_time, max(max_time) AS max_time
         FROM system.parts WHERE active AND database = {db:String} AND table = {t:String}
         GROUP BY partition ORDER BY partition DESC LIMIT 200`),
      q(`SELECT name, type, expr, granularity FROM system.data_skipping_indices
         WHERE database = {db:String} AND table = {t:String}`),
      // Sample is bounded by LIMIT and a scan cap (agent-query-safety)
      q(`SELECT * FROM ${quoteIdent(database)}.${quoteIdent(table)} LIMIT 10`,
        isView ? { max_execution_time: 10 } : { max_execution_time: 10, max_rows_to_read: 100_000, read_overflow_mode: 'break' }),
    ]);

    return NextResponse.json({
      table: info[0],
      columns: settled(columns) ?? [],
      partitions: settled(partitions) ?? [],
      skipIndices: settled(skipIndices) ?? [],
      sample: settled(sample) ?? [],
      sampleError: sample.status === 'rejected' ? (sample.reason as Error)?.message : null,
    });
  } catch (err) {
    return chErrorResponse(err);
  }
}
