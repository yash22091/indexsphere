import { describe, expect, it } from 'vitest';
import { analyzeClickHouseQuery, checkClickHouseQuery, quoteIdent, stripLiteralsAndComments } from '@/lib/clickhouse-sql';

describe('analyzeClickHouseQuery', () => {
  it.each([
    ['SELECT 1', 'read'],
    ['  with x as (select 1) select * from x', 'read'],
    ['SHOW TABLES', 'read'],
    ['DESCRIBE TABLE t', 'read'],
    ['EXPLAIN indexes=1 SELECT * FROM t', 'read'],
    ['(SELECT 1) UNION ALL (SELECT 2)', 'read'],
    ['INSERT INTO t VALUES (1)', 'write'],
    ['CREATE TABLE t (a UInt8) ENGINE=Memory', 'write'],
    ['ALTER TABLE t DELETE WHERE 1', 'write'],
    ['DROP TABLE t', 'write'],
    ['OPTIMIZE TABLE t FINAL', 'write'],
    ['CREATE USER x IDENTIFIED BY \'p\'', 'admin'],
    ['DROP ROLE r', 'admin'],
    ['CREATE OR REPLACE ROW POLICY p ON t USING 1 TO x', 'admin'],
    ['GRANT ALL ON *.* TO x', 'admin'],
    ['SYSTEM FLUSH LOGS', 'admin'],
    ['KILL QUERY WHERE 1', 'admin'],
    ['DROP DATABASE d', 'admin'],
    ['FOO BAR', 'admin'],
  ])('%s → %s', (sql, level) => {
    expect(analyzeClickHouseQuery(sql).level).toBe(level);
  });

  it('is not fooled by keywords in strings or comments', () => {
    expect(analyzeClickHouseQuery("SELECT 'DROP TABLE x; url(1)' -- KILL\n").level).toBe('read');
    expect(analyzeClickHouseQuery("SELECT 'url(' AS x").usesExternalSource).toBe(false);
    expect(analyzeClickHouseQuery('/* INSERT */ SELECT 1').level).toBe('read');
    expect(analyzeClickHouseQuery("SELECT 'a;b'").multipleStatements).toBe(false);
  });

  it('detects external table functions and engines', () => {
    expect(analyzeClickHouseQuery("SELECT * FROM url('http://169.254.169.254', RawBLOB)").usesExternalSource).toBe(true);
    expect(analyzeClickHouseQuery("SELECT * FROM file('/etc/passwd')").usesExternalSource).toBe(true);
    expect(analyzeClickHouseQuery("SELECT * FROM remoteSecure('h:9440', db.t)").usesExternalSource).toBe(true);
    expect(analyzeClickHouseQuery("CREATE TABLE t (a String) ENGINE = URL('http://x')").usesExternalSource).toBe(true);
    expect(analyzeClickHouseQuery("SELECT cutURLParameter(url, 'a'), domain(url) FROM t").usesExternalSource).toBe(false);
  });
});

describe('checkClickHouseQuery', () => {
  it('readonly: reads only, no external sources, no safety overrides', () => {
    expect(checkClickHouseQuery('readonly', 'SELECT * FROM t LIMIT 10')).toBeNull();
    expect(checkClickHouseQuery('readonly', 'INSERT INTO t VALUES (1)')).toMatch(/Read-only/);
    expect(checkClickHouseQuery('readonly', 'KILL QUERY WHERE 1')).toMatch(/admins/);
    expect(checkClickHouseQuery('readonly', "SELECT * FROM url('http://x', CSV)")).toMatch(/External/);
    expect(checkClickHouseQuery('readonly', 'SELECT * FROM t SETTINGS max_execution_time = 0')).toMatch(/safety limits/);
    expect(checkClickHouseQuery('readonly', 'SELECT * FROM t SETTINGS readonly=0')).toMatch(/safety limits/);
  });

  it('user: data writes, not access control', () => {
    expect(checkClickHouseQuery('user', 'INSERT INTO t VALUES (1)')).toBeNull();
    expect(checkClickHouseQuery('user', 'CREATE TABLE t (a UInt8) ENGINE=MergeTree ORDER BY a')).toBeNull();
    expect(checkClickHouseQuery('user', 'GRANT SELECT ON *.* TO x')).toMatch(/admins/);
    expect(checkClickHouseQuery('user', "CREATE TABLE t (a String) ENGINE = S3('https://b/x')")).toMatch(/External/);
  });

  it('admin: everything, but still one statement at a time', () => {
    expect(checkClickHouseQuery('admin', "SELECT * FROM url('http://x', CSV)")).toBeNull();
    expect(checkClickHouseQuery('admin', 'SYSTEM FLUSH LOGS')).toBeNull();
    expect(checkClickHouseQuery('admin', 'SELECT 1; SELECT 2')).toMatch(/one statement/);
    expect(checkClickHouseQuery('admin', '  ')).toMatch(/empty/);
  });
});

describe('helpers', () => {
  it('quoteIdent escapes backticks', () => {
    expect(quoteIdent('a`b')).toBe('`a\\`b`');
  });
  it('stripLiteralsAndComments handles escaped quotes', () => {
    expect(stripLiteralsAndComments("SELECT 'it\\'s' FROM t")).toBe("SELECT '' FROM t");
  });
});
