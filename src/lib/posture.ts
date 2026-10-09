/**
 * Security posture audit for Elasticsearch / OpenSearch and ClickHouse.
 *
 * Read-only checks of configuration that commonly leads to breaches: exposed
 * or default credentials, demo TLS material, missing TLS, risky privileges,
 * missing audit logging / backups, and known CVEs for the running version.
 * Every finding has a category, severity and a concrete remediation.
 *
 * Checks never attempt to log in with guessed passwords (that would trip
 * lockouts and SIEM alerts); they inspect configuration the connected user can read.
 */
import tls from 'tls';
import { guardedLookup, parseOutboundUrl } from './url-guard';
import { sslBypassFetch } from './ssl-bypass';
import type { ElasticsearchClient } from './elasticsearch';
import type { ClickHouseClient } from './clickhouse';
import type { UserRole } from './auth';
import { assessVersion, Product } from './vuln-intel';

export type PostureSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type PostureCategory = 'Vulnerabilities' | 'Encryption' | 'Authentication' | 'Authorization' | 'Logging' | 'Resilience' | 'Hardening';

export interface PostureFinding {
  id: string;
  category: PostureCategory;
  severity: PostureSeverity;
  title: string;
  detail: string;
  remediation?: string;
  reference?: string;
}

export interface PostureCheck { id: string; title: string; status: 'pass' | 'fail' | 'skipped'; note?: string }

export interface PostureReport {
  engine: Product;
  version: string;
  target: string;
  checkedAt: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  findings: PostureFinding[];
  checks: PostureCheck[];
}

const WEIGHT: Record<PostureSeverity, number> = { critical: 25, high: 12, medium: 6, low: 2, info: 0 };

export function gradeFor(findings: PostureFinding[]): { score: number; grade: PostureReport['grade'] } {
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + WEIGHT[f.severity], 0));
  return { score, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F' };
}

class Audit {
  findings: PostureFinding[] = [];
  checks: PostureCheck[] = [];
  pass(id: string, title: string, note?: string) { this.checks.push({ id, title, status: 'pass', note }); }
  skip(id: string, title: string, note: string) { this.checks.push({ id, title, status: 'skipped', note }); }
  fail(f: PostureFinding) {
    this.findings.push(f);
    if (!this.checks.some(c => c.id === f.id)) this.checks.push({ id: f.id, title: f.title, status: 'fail' });
  }
}

// ── TLS certificate inspection (works without any API privilege) ────────────

export interface CertInfo { subject: string; issuer: string; validTo: string; daysLeft: number; selfSigned: boolean }

const DEMO_CERT_MARKERS = [
  /Example Com Inc\. Root CA/i,      // OpenSearch demo configuration
  /node-0\.example\.com/i,
  /CN=kirk/i,
  /O=Example Com Inc/i,
];

export async function inspectCertificate(url: string): Promise<CertInfo | null> {
  const u = parseOutboundUrl(url, 'cluster');
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port: Number(u.port || 443),
      servername: /^[\d.:]+$/.test(host) ? undefined : host,
      rejectUnauthorized: false, // we inspect the certificate, we don't trust it
      lookup: guardedLookup as unknown as tls.ConnectionOptions['lookup'],
      timeout: 8000,
    }, () => {
      const c = socket.getPeerCertificate();
      socket.end();
      if (!c || !c.subject) return resolve(null);
      const fmt = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : v}`).join(', ');
      const subject = fmt(c.subject as unknown as Record<string, unknown>);
      const issuer = fmt(c.issuer as unknown as Record<string, unknown>);
      const daysLeft = Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86_400_000);
      resolve({ subject, issuer, validTo: new Date(c.valid_to).toISOString(), daysLeft, selfSigned: subject === issuer });
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('TLS handshake timed out')); });
    socket.on('error', reject);
  });
}

function certChecks(a: Audit, url: string, cert: CertInfo | null, engine: string) {
  if (!url.startsWith('https:')) {
    a.fail({
      id: 'tls-http', category: 'Encryption', severity: 'high',
      title: 'Traffic is not encrypted',
      detail: `IndexSphere reaches ${engine} over plain HTTP. Credentials and data cross the network in clear text.`,
      remediation: engine === 'ClickHouse'
        ? 'Enable the HTTPS interface (<https_port>8443</https_port> with a certificate in <openSSL>) and connect on 8443.'
        : 'Enable TLS on the HTTP layer (xpack.security.http.ssl.* / plugins.security.ssl.http.*) and connect with https://.',
    });
    return;
  }
  a.pass('tls-http', 'HTTP layer uses TLS');
  if (!cert) { a.skip('tls-cert', 'Certificate inspection', 'Could not read the server certificate'); return; }
  const blob = `${cert.subject} ${cert.issuer}`;
  if (DEMO_CERT_MARKERS.some(re => re.test(blob))) {
    a.fail({
      id: 'tls-demo-cert', category: 'Encryption', severity: 'critical',
      title: 'Demo TLS certificate in use',
      detail: `The node presents the public demo certificate (subject "${cert.subject}", issuer "${cert.issuer}"). Its private key is published, so anyone can impersonate the node or decrypt traffic.`,
      remediation: 'Generate your own CA and node certificates (or use your PKI), replace the demo certificates, and remove the demo configuration (plugins.security.allow_unsafe_democertificates: false).',
      reference: 'https://opensearch.org/docs/latest/security/configuration/tls/',
    });
  } else {
    a.pass('tls-demo-cert', 'Not using publicly known demo certificates');
  }
  if (cert.daysLeft < 0) {
    a.fail({ id: 'tls-expiry', category: 'Encryption', severity: 'high', title: 'TLS certificate expired',
      detail: `The certificate expired on ${cert.validTo.slice(0, 10)}.`, remediation: 'Renew the certificate and reload it on every node.' });
  } else if (cert.daysLeft < 30) {
    a.fail({ id: 'tls-expiry', category: 'Encryption', severity: 'medium', title: 'TLS certificate expires soon',
      detail: `The certificate expires in ${cert.daysLeft} days (${cert.validTo.slice(0, 10)}).`, remediation: 'Renew the certificate before it expires.' });
  } else {
    a.pass('tls-expiry', 'Certificate validity', `${cert.daysLeft} days left`);
  }
  if (cert.selfSigned) {
    a.fail({ id: 'tls-self-signed', category: 'Encryption', severity: 'low', title: 'Self-signed certificate',
      detail: 'Clients cannot verify the server identity without pinning this certificate.',
      remediation: 'Issue the node certificate from your internal CA and enable certificate verification on clients.' });
  }
}

async function cveCheck(a: Audit, product: Product, version: string) {
  try {
    const v = await assessVersion(product, version);
    const s = v.summary;
    if (s.total === 0) { a.pass('cve', `No known CVEs for ${version}`); return; }
    const sev: PostureSeverity = s.kev > 0 || s.CRITICAL > 0 ? 'critical' : s.HIGH > 0 ? 'high' : 'medium';
    a.fail({
      id: 'cve', category: 'Vulnerabilities', severity: sev,
      title: `${s.total} known vulnerabilit${s.total === 1 ? 'y' : 'ies'} in ${version}`,
      detail: `${s.CRITICAL} critical, ${s.HIGH} high, ${s.MEDIUM} medium${s.kev ? `; ${s.kev} actively exploited (CISA KEV)` : ''}.`,
      remediation: v.recommendation.upgradeTo ? `Upgrade to ${v.recommendation.upgradeTo} or later.` : 'Review the advisories and apply vendor fixes.',
      reference: '/vulnerabilities',
    });
  } catch (err) {
    a.skip('cve', 'Known vulnerabilities', err instanceof Error ? err.message : 'lookup failed');
  }
}

// ── Elasticsearch / OpenSearch ───────────────────────────────────────────────

const OPENSEARCH_DEMO_USERS = ['kibanaro', 'logstash', 'readall', 'snapshotrestore', 'anomalyadmin'];

async function tryReq<T>(client: ElasticsearchClient, path: string): Promise<T | null> {
  try { return await client.request(path) as T; } catch { return null; }
}

export async function auditSearchCluster(client: ElasticsearchClient, url: string): Promise<PostureReport> {
  const a = new Audit();
  const info = await client.getClusterInfo() as { version?: { number?: string; distribution?: string } };
  const isOS = info.version?.distribution === 'opensearch';
  const product: Product = isOS ? 'opensearch' : 'elasticsearch';
  const version = info.version?.number ?? 'unknown';
  const engine = isOS ? 'OpenSearch' : 'Elasticsearch';

  // Anonymous access: the same endpoint without credentials
  try {
    const anon = await sslBypassFetch(`${url.replace(/\/+$/, '')}/_cat/indices?format=json&h=index`, { verifyTls: client.getVerifyTls() });
    if (anon.ok) {
      a.fail({ id: 'anon-access', category: 'Authentication', severity: 'critical', title: 'Anonymous access allowed',
        detail: `${engine} answers API requests without credentials — anyone who can reach it can read (and possibly change) data.`,
        remediation: isOS ? 'Disable anonymous auth (plugins.security.config.dynamic.http.anonymous_auth_enabled: false) or enable the security plugin.'
          : 'Enable security (xpack.security.enabled: true) and remove anonymous roles (xpack.security.authc.anonymous.*).' });
    } else {
      a.pass('anon-access', 'Authentication required for API access');
    }
  } catch (err) {
    a.skip('anon-access', 'Anonymous access', err instanceof Error ? err.message : 'probe failed');
  }

  let cert: CertInfo | null = null;
  try { cert = await inspectCertificate(url); } catch { /* reported below */ }
  certChecks(a, url, cert, engine);

  // Cluster-wide safety settings
  const settings = await tryReq<{ defaults?: Record<string, unknown>; persistent?: Record<string, unknown>; transient?: Record<string, unknown> }>(
    client, '/_cluster/settings?include_defaults=true&flat_settings=true');
  if (settings) {
    const get = (k: string) => (settings.transient?.[k] ?? settings.persistent?.[k] ?? settings.defaults?.[k]) as string | undefined;
    if (String(get('action.destructive_requires_name')) === 'false') {
      a.fail({ id: 'destructive-wildcards', category: 'Hardening', severity: 'medium', title: 'Wildcard deletes allowed',
        detail: 'action.destructive_requires_name is false: a single DELETE /* or DELETE /logs-* removes every matching index.',
        remediation: 'PUT _cluster/settings {"persistent":{"action.destructive_requires_name":true}}' });
    } else {
      a.pass('destructive-wildcards', 'Destructive actions require explicit index names');
    }
    if (String(get('http.cors.enabled')) === 'true' && String(get('http.cors.allow-origin') ?? '').includes('*')) {
      a.fail({ id: 'cors', category: 'Hardening', severity: 'high', title: 'CORS open to any origin',
        detail: 'http.cors.allow-origin includes "*": any web page a user visits can call the cluster with their browser credentials.',
        remediation: 'Set http.cors.allow-origin to the exact origins that need access, or disable CORS.' });
    } else {
      a.pass('cors', 'CORS not open to all origins');
    }
  } else {
    a.skip('destructive-wildcards', 'Cluster safety settings', 'cluster settings not readable by this user');
  }

  // Security plugin configuration
  if (isOS) {
    const users = await tryReq<Record<string, { reserved?: boolean }>>(client, '/_plugins/_security/api/internalusers');
    if (users) {
      const demo = OPENSEARCH_DEMO_USERS.filter(u => u in users);
      if (demo.length) {
        a.fail({ id: 'demo-users', category: 'Authentication', severity: 'high', title: 'Demo users present',
          detail: `Demo accounts from the OpenSearch sample configuration exist: ${demo.join(', ')}. Their default passwords are published in the OpenSearch repository unless they were changed.`,
          remediation: `Delete unused demo users (DELETE _plugins/_security/api/internalusers/<name>) or rotate their passwords: ${demo.join(', ')}.` });
      } else {
        a.pass('demo-users', 'No demo users');
      }
    } else {
      a.skip('demo-users', 'Demo users', 'security API not readable by this user');
    }
    const audit = await tryReq<{ config?: { enabled?: boolean; audit?: { enable_rest?: boolean; enable_transport?: boolean } } }>(client, '/_plugins/_security/api/audit');
    if (audit?.config) {
      if (audit.config.enabled === false || (audit.config.audit && !audit.config.audit.enable_rest)) {
        a.fail({ id: 'audit-log', category: 'Logging', severity: 'medium', title: 'Security audit logging disabled',
          detail: 'Authentication failures and privileged REST actions are not recorded by the security plugin.',
          remediation: 'Enable audit logging (plugins.security.audit.type) and REST auditing in the audit configuration.' });
      } else {
        a.pass('audit-log', 'Security audit logging enabled');
      }
    } else {
      a.skip('audit-log', 'Audit logging', 'audit configuration not readable by this user');
    }
  } else {
    const secUsage = await tryReq<{ security?: { enabled?: boolean; audit?: { enabled?: boolean } } }>(client, '/_xpack/usage?filter_path=security.enabled,security.audit');
    const enabled = secUsage?.security?.enabled;
    if (enabled === false) {
      a.fail({ id: 'security-disabled', category: 'Authentication', severity: 'critical', title: 'Security features disabled',
        detail: 'xpack.security.enabled is false: no authentication, authorization or TLS enforcement.',
        remediation: 'Set xpack.security.enabled: true, configure TLS and built-in user passwords (elasticsearch-reset-password).' });
    } else if (enabled === true) {
      a.pass('security-disabled', 'Security features enabled');
      if (secUsage?.security?.audit?.enabled === false) {
        a.fail({ id: 'audit-log', category: 'Logging', severity: 'medium', title: 'Security audit logging disabled',
          detail: 'Authentication events and privileged actions are not audited.',
          remediation: 'Set xpack.security.audit.enabled: true (requires an appropriate license).' });
      }
    } else {
      a.skip('security-disabled', 'Security features', 'usage API not readable by this user');
    }
  }

  // Resilience: snapshots
  const repos = await tryReq<Record<string, unknown>>(client, '/_snapshot');
  if (repos && Object.keys(repos).length === 0) {
    a.fail({ id: 'snapshots', category: 'Resilience', severity: 'high', title: 'No snapshot repository',
      detail: 'Without snapshots there is no recovery from accidental deletion, corruption or ransomware.',
      remediation: 'Register a repository (PUT _snapshot/<name>) on storage outside the cluster and schedule snapshots (SLM / ISM snapshot policy).' });
  } else if (repos) {
    const names = Object.keys(repos);
    let latest = 0;
    for (const repo of names.slice(0, 5)) {
      const snaps = await tryReq<Array<{ end_epoch?: string; status?: string }>>(client, `/_cat/snapshots/${encodeURIComponent(repo)}?format=json`);
      for (const s of snaps ?? []) if (s.status === 'SUCCESS') latest = Math.max(latest, Number(s.end_epoch ?? 0) * 1000);
    }
    const ageH = latest ? (Date.now() - latest) / 3_600_000 : Infinity;
    if (ageH > 48) {
      a.fail({ id: 'snapshots', category: 'Resilience', severity: 'medium', title: latest ? 'Snapshots are stale' : 'No successful snapshot',
        detail: latest ? `Last successful snapshot finished ${Math.round(ageH)} hours ago.` : `Repositories exist (${names.join(', ')}) but no successful snapshot was found.`,
        remediation: 'Schedule daily snapshots with SLM (Elasticsearch) or an ISM snapshot policy (OpenSearch) and monitor failures.' });
    } else {
      a.pass('snapshots', 'Recent successful snapshot', `${Math.round(ageH)} h ago`);
    }
  }

  // Resilience: replicas and disk
  const indices = await tryReq<Array<{ index: string; rep: string }>>(client, '/_cat/indices?format=json&h=index,rep&expand_wildcards=open');
  const nodes = await tryReq<Array<{ name: string; 'disk.used_percent'?: string }>>(client, '/_cat/allocation?format=json&h=node,disk.percent');
  const dataNodeCount = (await tryReq<{ number_of_data_nodes?: number }>(client, '/_cluster/health'))?.number_of_data_nodes ?? 1;
  if (indices) {
    const noReplica = indices.filter(i => !i.index.startsWith('.') && i.rep === '0');
    if (noReplica.length && dataNodeCount > 1) {
      a.fail({ id: 'replicas', category: 'Resilience', severity: 'medium', title: `${noReplica.length} indices without replicas`,
        detail: `Losing one node loses data for: ${noReplica.slice(0, 5).map(i => i.index).join(', ')}${noReplica.length > 5 ? '…' : ''}.`,
        remediation: 'PUT <index>/_settings {"index":{"number_of_replicas":1}}' });
    } else if (noReplica.length && dataNodeCount === 1) {
      a.fail({ id: 'replicas', category: 'Resilience', severity: 'low', title: 'Single data node',
        detail: 'With one data node no index can have a replica; a disk or node failure loses data that is not in snapshots.',
        remediation: 'Add data nodes for redundancy, and keep snapshots current.' });
    } else {
      a.pass('replicas', 'Indices have replicas');
    }
  }
  const full = (nodes ?? []).filter(n => Number((n as Record<string, string>)['disk.percent'] ?? 0) >= 85);
  if (full.length) {
    a.fail({ id: 'disk', category: 'Resilience', severity: 'medium', title: 'Disk usage above high watermark',
      detail: `Nodes at ≥ 85% disk: ${full.map(n => (n as Record<string, string>).node).join(', ')}. Shards stop allocating at the high watermark and indices go read-only at the flood stage.`,
      remediation: 'Delete or snapshot-and-close old indices, add storage, or adjust ILM/ISM retention.' });
  } else if (nodes) {
    a.pass('disk', 'Disk usage below watermarks');
  }

  await cveCheck(a, product, version);

  const { score, grade } = gradeFor(a.findings);
  return { engine: product, version, target: url, checkedAt: new Date().toISOString(), score, grade,
    findings: sortFindings(a.findings), checks: a.checks };
}

// ── ClickHouse ───────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const EXTERNAL_GRANTS = ['FILE', 'URL', 'REMOTE', 'S3', 'HDFS', 'MYSQL', 'POSTGRES', 'ODBC', 'JDBC', 'SOURCES', 'AZURE', 'MONGO', 'REDIS'];

export async function auditClickHouse(client: ClickHouseClient, role: UserRole, version: string): Promise<PostureReport> {
  const a = new Audit();
  const url = client.getBaseUrl();
  const q = async (sql: string) => { try { return (await client.query<Row>(sql, { role })).data; } catch { return null; } };

  let cert: CertInfo | null = null;
  try { cert = await inspectCertificate(url); } catch { /* reported below */ }
  certChecks(a, url, cert, 'ClickHouse');

  const users = await q(`SELECT name, auth_type, host_ip, host_names, host_names_regexp, host_names_like FROM system.users`);
  if (users) {
    const authOf = (u: Row) => (Array.isArray(u.auth_type) ? u.auth_type.map(String) : [String(u.auth_type)]);
    const noPw = users.filter(u => authOf(u).includes('no_password'));
    if (noPw.length) {
      a.fail({ id: 'ch-no-password', category: 'Authentication', severity: 'critical', title: 'Users without a password',
        detail: `These users can log in with no password: ${noPw.map(u => u.name).join(', ')}.`,
        remediation: `ALTER USER <name> IDENTIFIED WITH sha256_password BY '<strong password>';  -- for: ${noPw.map(u => u.name).join(', ')}` });
    } else {
      a.pass('ch-no-password', 'All users require a password');
    }
    const plain = users.filter(u => authOf(u).includes('plaintext_password'));
    if (plain.length) {
      a.fail({ id: 'ch-plaintext', category: 'Authentication', severity: 'medium', title: 'Plaintext password storage',
        detail: `Passwords stored in plain text for: ${plain.map(u => u.name).join(', ')}.`,
        remediation: "ALTER USER <name> IDENTIFIED WITH sha256_password BY '<password>';" });
    }
    const anyHost = (u: Row) => {
      const ips = (u.host_ip as string[] | undefined) ?? [];
      const re = (u.host_names_regexp as string[] | undefined) ?? [];
      const like = (u.host_names_like as string[] | undefined) ?? [];
      return ips.includes('::/0') || ips.includes('0.0.0.0/0') || re.includes('.*') || like.includes('%');
    };
    const def = users.find(u => u.name === 'default');
    if (def && anyHost(def)) {
      a.fail({ id: 'ch-default-user', category: 'Authentication', severity: 'high', title: '"default" user reachable from any host',
        detail: 'The well-known "default" account accepts connections from any address. It is the first account attackers try.',
        remediation: "Create named users per application, then restrict or disable default: ALTER USER default HOST LOCAL;  (or HOST IP '10.0.0.0/8')" });
    } else if (def) {
      a.pass('ch-default-user', '"default" user restricted by host');
    }
  } else {
    a.skip('ch-no-password', 'User authentication', 'system.users not readable (needs SHOW USERS privilege)');
  }

  const grants = await q(`SELECT user_name, role_name, access_type, grant_option FROM system.grants`);
  if (grants) {
    const ext = grants.filter(g => EXTERNAL_GRANTS.includes(String(g.access_type).toUpperCase()));
    const holders = [...new Set(ext.map(g => String(g.user_name || g.role_name)))];
    if (holders.length) {
      a.fail({ id: 'ch-external-grants', category: 'Authorization', severity: 'high', title: 'External table functions granted',
        detail: `${holders.join(', ')} can use url()/file()/s3()/remote() and similar sources. Any SQL they (or an injected query) run can make the server fetch internal URLs, read local files or exfiltrate data.`,
        remediation: `REVOKE SOURCES ON *.* FROM ${holders.join(', ')};  -- grant only the specific source (e.g. S3) to the ingestion user that needs it` });
    } else {
      a.pass('ch-external-grants', 'No external-source privileges');
    }
    const grantOpt = [...new Set(grants.filter(g => Number(g.grant_option) === 1).map(g => String(g.user_name || g.role_name)))];
    if (grantOpt.length > 1) {
      a.fail({ id: 'ch-grant-option', category: 'Authorization', severity: 'low', title: 'Several principals can grant privileges',
        detail: `GRANT OPTION is held by: ${grantOpt.join(', ')}.`,
        remediation: 'Keep GRANT OPTION with a single administrative role; revoke it from application users.' });
    }
  } else {
    a.skip('ch-external-grants', 'Privileges', 'system.grants not readable (needs SHOW USERS privilege)');
  }

  const limits = await q(`SELECT name, value FROM system.settings WHERE name IN ('max_execution_time', 'max_memory_usage', 'readonly')`);
  if (limits) {
    const v = Object.fromEntries(limits.map(r => [String(r.name), String(r.value)]));
    if (v.max_execution_time === '0') {
      a.fail({ id: 'ch-query-limits', category: 'Hardening', severity: 'low', title: 'No query time limit in the user profile',
        detail: 'The connected user\'s settings profile has max_execution_time = 0, so a runaway query can run indefinitely.',
        remediation: 'CREATE SETTINGS PROFILE app_limits SETTINGS max_execution_time = 60, max_memory_usage = 10000000000 TO <users>;' });
    } else {
      a.pass('ch-query-limits', 'Query time limit set', `max_execution_time = ${v.max_execution_time}`);
    }
  }

  const logs = await q(`SELECT name FROM system.tables WHERE database = 'system' AND name IN ('query_log', 'session_log', 'part_log')`);
  if (logs) {
    const names = logs.map(r => String(r.name));
    if (!names.includes('query_log')) {
      a.fail({ id: 'ch-query-log', category: 'Logging', severity: 'medium', title: 'Query log disabled',
        detail: 'Without system.query_log there is no record of who ran which query.',
        remediation: 'Enable <query_log> in the server configuration (enabled by default).' });
    } else {
      a.pass('ch-query-log', 'Query log enabled');
    }
    if (!names.includes('session_log')) {
      a.fail({ id: 'ch-session-log', category: 'Logging', severity: 'low', title: 'Session (login) log disabled',
        detail: 'Successful and failed logins are not recorded in system.session_log.',
        remediation: 'Add <session_log><database>system</database><table>session_log</table></session_log> to the server configuration.' });
    } else {
      a.pass('ch-session-log', 'Login (session) log enabled');
    }
  }

  const backups = await q(`SELECT max(end_time) AS last FROM system.backups WHERE status = 'BACKUP_CREATED'`);
  if (backups) {
    // max() over no rows returns the epoch, not NULL
    const raw = String(backups[0]?.last ?? '');
    const last = raw && !raw.startsWith('1970') ? new Date(raw.replace(' ', 'T') + 'Z').getTime() : 0;
    const stale = last && Date.now() - last > 7 * 86_400_000;
    if (!last || stale) {
      a.fail({ id: 'ch-backups', category: 'Resilience', severity: 'medium', title: last ? 'Last backup is over a week old' : 'No backups recorded',
        detail: last ? `The most recent successful BACKUP finished on ${raw}.`
          : 'system.backups has no successful BACKUP since the last restart. (Backups made with external tools such as clickhouse-backup are not visible here.)',
        remediation: "BACKUP DATABASE <db> TO S3('https://…/backups/<date>', '<key>', '<secret>');  -- or schedule clickhouse-backup" });
    } else {
      a.pass('ch-backups', 'Recent backup recorded');
    }
  }

  const disks = await q(`SELECT name, free_space, total_space FROM system.disks`);
  const low = (disks ?? []).filter(d => Number(d.total_space) > 0 && Number(d.free_space) / Number(d.total_space) < 0.15);
  if (low.length) {
    a.fail({ id: 'ch-disk', category: 'Resilience', severity: 'medium', title: 'Low free disk space',
      detail: `Disks under 15% free: ${low.map(d => d.name).join(', ')}. Merges need free space; inserts fail when it runs out.`,
      remediation: 'Add storage, set TTLs to expire old data, or move cold partitions to object storage.' });
  } else if (disks) {
    a.pass('ch-disk', 'Disk space healthy');
  }

  await cveCheck(a, 'clickhouse', version);

  const { score, grade } = gradeFor(a.findings);
  return { engine: 'clickhouse', version, target: url, checkedAt: new Date().toISOString(), score, grade,
    findings: sortFindings(a.findings), checks: a.checks };
}

const SEV_ORDER: Record<PostureSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
function sortFindings(f: PostureFinding[]) {
  return [...f].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}
