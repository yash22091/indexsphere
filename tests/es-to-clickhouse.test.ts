import { describe, expect, it } from 'vitest';
import { planMigration } from '@/lib/es-to-clickhouse';

const mapping = {
  '@timestamp': { type: 'date' },
  agent: { properties: { name: { type: 'keyword' }, id: { type: 'keyword' } } },
  rule: { properties: { level: { type: 'long' }, description: { type: 'text', fields: { keyword: { type: 'keyword' } } } } },
  source: { properties: { ip: { type: 'ip' }, port: { type: 'integer' } } },
  event: { properties: { uuid: { type: 'keyword' } } },
  price: { type: 'scaled_float', scaling_factor: 100 },
  data: { type: 'flattened' },
  location: { type: 'geo_point' },
  weird: { type: 'percolator' },
};

describe('planMigration', () => {
  it('maps ES types to native ClickHouse types', () => {
    const p = planMigration(mapping, { database: 'logs', table: 'events' });
    const t = Object.fromEntries(p.columns.map(c => [c.source, c.type]));
    expect(t['@timestamp']).toBe('DateTime64(3)');
    expect(t['agent.name']).toBe('LowCardinality(String)');
    expect(t['agent.id']).toBe('String');
    expect(t['rule.level']).toBe('Int64');
    expect(t['rule.description']).toBe('String');
    expect(t['source.ip']).toBe('IPv6');
    expect(t['source.port']).toBe('Int32');
    expect(t['event.uuid']).toBe('UUID');
    expect(t.price).toBe('Decimal64(2)');
    expect(t.data).toBe('JSON');
    expect(t.location).toBe('Point');
    expect(p.skipped).toEqual([{ source: 'weird', reason: 'unsupported ES type "percolator"' }]);
    expect(p.columns.every(c => !c.type.startsWith('Nullable'))).toBe(true);
  });

  it('orders by low-cardinality filter fields then time, partitions monthly', () => {
    const p = planMigration(mapping, { database: 'logs', table: 'events' });
    expect(p.orderBy).toEqual(['agent_name', 'timestamp']);
    expect(p.partitionBy).toBe('toYYYYMM(`timestamp`)');
    expect(p.ddl).toContain('ENGINE = MergeTree');
    expect(p.ddl).toContain('ORDER BY (`agent_name`, `timestamp`)');
  });

  it('uses measured cardinality for types and key order', () => {
    const p = planMigration({
      ts: { type: 'date' }, a: { type: 'keyword' }, b: { type: 'keyword' }, c: { type: 'keyword' },
    }, { database: 'd', table: 't', cardinality: { a: 500, b: 3, c: 50_000 } });
    const t = Object.fromEntries(p.columns.map(c => [c.source, c.type]));
    expect(t.c).toBe('String');
    expect(p.orderBy).toEqual(['b', 'a', 'ts']);
  });

  it('treats text+keyword fields as LowCardinality when measured cardinality is low', () => {
    const p = planMigration({
      ts: { type: 'date' },
      category: { type: 'text', fields: { keyword: { type: 'keyword' } } },
      body: { type: 'text', fields: { keyword: { type: 'keyword' } } },
    }, { database: 'd', table: 't', cardinality: { category: 4, body: 90_000 } });
    const t = Object.fromEntries(p.columns.map(c => [c.source, c.type]));
    expect(t.category).toBe('LowCardinality(String)');
    expect(t.body).toBe('String');
    expect(p.orderBy).toEqual(['category', 'ts']);
  });

  it('keeps dotted names when asked', () => {
    const p = planMigration(mapping, { database: 'd', table: 't', naming: 'dotted' });
    expect(p.columns.find(c => c.source === 'source.ip')?.column).toBe('source.ip');
  });
});
