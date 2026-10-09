import { describe, expect, it } from 'vitest';
import { scoreTable, smallestIntType, TableFacts } from '@/lib/clickhouse-advisor';

const base = (over: Partial<TableFacts> = {}): TableFacts => ({
  database: 'db', table: 't', engine: 'MergeTree', engineFull: 'MergeTree ORDER BY (a, ts)',
  sortingKey: 'a, ts', partitionKey: 'toYYYYMM(ts)', totalRows: 10_000_000, totalBytes: 5 * 1024 ** 3,
  columns: [
    { name: 'a', type: 'LowCardinality(String)', inSortingKey: true, inPartitionKey: false, compressed: 100, uncompressed: 1000 },
    { name: 'ts', type: 'DateTime', inSortingKey: true, inPartitionKey: true, compressed: 100, uncompressed: 1000 },
  ],
  activeParts: 20, partitions: 12, maxPartsPerPartition: 3, skipIndexCount: 0,
  pendingMutations: 0, recentMutations: 0,
  insertQueries24h: 100, avgRowsPerInsert24h: 50_000, optimizeFinal7d: 0, selectQueries24h: 100, fullScanQueries24h: 0,
  ...over,
});

const rules = (f: TableFacts) => scoreTable(f).findings.map(x => x.rule);

describe('scoreTable', () => {
  it('a well-designed table scores A with no findings', () => {
    const s = scoreTable(base());
    expect(s.grade).toBe('A');
    expect(s.findings).toEqual([]);
  });

  it('flags a missing ORDER BY as critical on large tables', () => {
    const s = scoreTable(base({ sortingKey: '' }));
    expect(s.findings[0]).toMatchObject({ rule: 'schema-pk-plan-before-creation', severity: 'critical' });
  });

  it('flags timestamp-first ORDER BY', () => {
    expect(rules(base({ sortingKey: 'ts, a' }))).toContain('schema-pk-cardinality-order');
  });

  it('flags Nullable, String timestamps and IPs', () => {
    const r = rules(base({ columns: [
      ...base().columns,
      { name: 'n', type: 'Nullable(Int32)', inSortingKey: false, inPartitionKey: false, compressed: 1, uncompressed: 1 },
      { name: 'time_dt', type: 'String', inSortingKey: false, inPartitionKey: false, compressed: 1, uncompressed: 1 },
      { name: 'device_ip', type: 'String', inSortingKey: false, inPartitionKey: false, compressed: 1, uncompressed: 1 },
    ] }));
    expect(r).toContain('schema-types-avoid-nullable');
    expect(r.filter(x => x === 'schema-types-native-types')).toHaveLength(2);
  });

  it('flags partition explosion, too many parts, small inserts, mutations and OPTIMIZE FINAL', () => {
    const r = rules(base({
      partitions: 2000, maxPartsPerPartition: 1500, insertQueries24h: 50_000, avgRowsPerInsert24h: 10,
      pendingMutations: 6, optimizeFinal7d: 10,
    }));
    expect(r).toEqual(expect.arrayContaining([
      'schema-partition-low-cardinality', 'insert-batch-size', 'insert-async-small-batches',
      'insert-mutation-avoid-update', 'insert-optimize-avoid-final',
    ]));
    expect(scoreTable(base({ partitions: 2000, maxPartsPerPartition: 1500, pendingMutations: 6 })).grade).toBe('F');
  });

  it('flags full scans that ignore the ORDER BY prefix', () => {
    expect(rules(base({ selectQueries24h: 100, fullScanQueries24h: 80 }))).toContain('schema-pk-filter-on-orderby');
  });

  it('uses deep stats for LowCardinality and bit-width', () => {
    const f = base({
      columns: [
        ...base().columns,
        { name: 'status', type: 'String', inSortingKey: false, inPartitionKey: false, compressed: 1, uncompressed: 1 },
        { name: 'port', type: 'Int64', inSortingKey: false, inPartitionKey: false, compressed: 1, uncompressed: 1 },
      ],
      deep: { status: { uniq: 12 }, port: { uniq: 900, min: 1, max: 65535 } },
    });
    const s = scoreTable(f);
    expect(s.findings.map(x => x.rule)).toEqual(expect.arrayContaining(['schema-types-lowcardinality', 'schema-types-minimize-bitwidth']));
    expect(s.findings.find(x => x.rule === 'schema-types-minimize-bitwidth')?.message).toContain('UInt16');
  });

  it('does not apply MergeTree rules to other engines', () => {
    expect(rules(base({ engine: 'Memory', sortingKey: '', partitions: 5000 }))).toEqual([]);
  });
});

describe('smallestIntType', () => {
  it.each([[0, 200, 'UInt8'], [0, 70_000, 'UInt32'], [-5, 100, 'Int8'], [-40_000, 1, 'Int32']])('%i..%i → %s', (min, max, t) => {
    expect(smallestIntType(min, max)).toBe(t);
  });
});
