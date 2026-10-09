/**
 * Version-based vulnerability intelligence for Elasticsearch, OpenSearch and ClickHouse.
 *
 * Sources (public, no account needed; NVD_API_KEY raises NVD rate limits):
 *   • NVD CVE API 2.0  — CVEs whose CPE configuration covers the product; version
 *                        ranges are evaluated locally against the running version
 *   • OSV.dev          — GitHub / Bitnami advisories for the Maven server artifacts
 *   • CISA KEV         — "known exploited in the wild" flag
 *   • FIRST EPSS       — probability of exploitation in the next 30 days
 *
 * Feeds are cached in SQLite (intel_cache) for 24h and refreshed daily by the
 * scheduler. Only product names and versions are sent to these services.
 * Set VULN_INTEL_DISABLED=true for air-gapped deployments.
 */
import { getDatabase } from './database-sqlite';

export type Product = 'elasticsearch' | 'opensearch' | 'clickhouse';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

const NVD_CPES: Record<Product, string[]> = {
  elasticsearch: ['cpe:2.3:a:elastic:elasticsearch'],
  opensearch: ['cpe:2.3:a:amazon:opensearch', 'cpe:2.3:a:linuxfoundation:opensearch'],
  clickhouse: ['cpe:2.3:a:clickhouse:clickhouse', 'cpe:2.3:a:yandex:clickhouse'],
};
const OSV_PACKAGES: Record<Product, { ecosystem: string; name: string }[]> = {
  elasticsearch: [{ ecosystem: 'Maven', name: 'org.elasticsearch:elasticsearch' }],
  opensearch: [{ ecosystem: 'Maven', name: 'org.opensearch:opensearch' }],
  clickhouse: [],
};

export const PRODUCT_LABEL: Record<Product, string> = {
  elasticsearch: 'Elasticsearch',
  opensearch: 'OpenSearch',
  clickhouse: 'ClickHouse',
};

const TTL_MS = 24 * 60 * 60 * 1000;
const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const OSV_URL = 'https://api.osv.dev/v1/query';
const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const EPSS_URL = 'https://api.first.org/data/v1/epss';

// ── Version comparison ───────────────────────────────────────────────────────

/** "v8.10.0-SNAPSHOT" → [8, 10, 0]; "25.12.1.649" → [25, 12, 1, 649] */
export function parseVersion(v: string): number[] {
  return v.trim().replace(/^v/i, '').split(/[-+_ ]/)[0].split('.').map(x => parseInt(x, 10)).map(x => (Number.isFinite(x) ? x : 0));
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// ── NVD ──────────────────────────────────────────────────────────────────────

export interface CpeMatch {
  vulnerable: boolean;
  criteria: string;
  versionStartIncluding?: string;
  versionStartExcluding?: string;
  versionEndIncluding?: string;
  versionEndExcluding?: string;
}

interface NvdCve {
  id: string;
  published: string;
  description: string;
  score?: number;
  severity: Severity;
  vector?: string;
  cvssVersion?: string;
  cwes: string[];
  references: { url: string; tags: string[] }[];
  matches: CpeMatch[]; // only cpeMatch entries for the product
}

/**
 * Does `version` fall inside this CPE match? Exact-version criteria compare
 * directly; wildcard criteria use the start/end bounds. A wildcard with no
 * bounds means "all versions".
 */
export function cpeMatchCovers(m: CpeMatch, version: string): boolean {
  if (!m.vulnerable) return false;
  const parts = m.criteria.split(':');
  const exact = parts[5];
  if (exact && exact !== '*' && exact !== '-') return compareVersions(version, exact) === 0;
  if (m.versionStartIncluding && compareVersions(version, m.versionStartIncluding) < 0) return false;
  if (m.versionStartExcluding && compareVersions(version, m.versionStartExcluding) <= 0) return false;
  if (m.versionEndIncluding && compareVersions(version, m.versionEndIncluding) > 0) return false;
  if (m.versionEndExcluding && compareVersions(version, m.versionEndExcluding) >= 0) return false;
  return true;
}

function nvdSeverity(metrics: Record<string, any[]> | undefined): Pick<NvdCve, 'score' | 'severity' | 'vector' | 'cvssVersion'> {
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const list = metrics?.[key];
    if (!list?.length) continue;
    const m = list.find(x => x.type === 'Primary') ?? list[0];
    const d = m.cvssData ?? {};
    const sev = String(d.baseSeverity ?? m.baseSeverity ?? 'UNKNOWN').toUpperCase();
    return {
      score: d.baseScore,
      severity: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(sev) ? sev : 'UNKNOWN') as Severity,
      vector: d.vectorString,
      cvssVersion: d.version,
    };
  }
  return { severity: 'UNKNOWN' };
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 45_000): Promise<any> {
  const r = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${new URL(url).host} returned HTTP ${r.status}`);
  return r.json();
}

async function fetchNvdForCpe(cpePrefix: string): Promise<NvdCve[]> {
  const vendorProduct = cpePrefix.split(':').slice(3, 5).join(':');
  const out: NvdCve[] = [];
  const headers: Record<string, string> = process.env.NVD_API_KEY ? { apiKey: process.env.NVD_API_KEY } : {};
  let start = 0;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ virtualMatchString: cpePrefix, resultsPerPage: '2000', startIndex: String(start) });
    const d = await fetchJson(`${NVD_URL}?${qs}`, { headers });
    for (const v of d.vulnerabilities ?? []) {
      const c = v.cve;
      const matches: CpeMatch[] = [];
      for (const cfg of c.configurations ?? []) {
        for (const node of cfg.nodes ?? []) {
          for (const m of node.cpeMatch ?? []) {
            if (m.vulnerable && String(m.criteria).split(':').slice(3, 5).join(':') === vendorProduct) matches.push(m);
          }
        }
      }
      out.push({
        id: c.id,
        published: c.published,
        description: (c.descriptions ?? []).find((x: any) => x.lang === 'en')?.value ?? '',
        ...nvdSeverity(c.metrics),
        cwes: (c.weaknesses ?? []).flatMap((w: any) => (w.description ?? []).map((x: any) => x.value)).filter((x: string) => /^CWE-\d+$/.test(x)),
        references: (c.references ?? []).slice(0, 12).map((r: any) => ({ url: r.url, tags: r.tags ?? [] })),
        matches,
      });
    }
    start += d.resultsPerPage ?? 0;
    if (!d.resultsPerPage || start >= (d.totalResults ?? 0)) break;
    if (!process.env.NVD_API_KEY) await new Promise(r => setTimeout(r, 6500)); // 5 req / 30 s without a key
  }
  return out;
}

interface FeedStatus { ok: boolean; fetchedAt?: string; error?: string; cached?: boolean }

interface IntelMemo { inflight: Map<string, Promise<unknown>>; memo: Map<string, { data: unknown; fetchedAt: string }> }
const MEMO_KEY = '__INDEXSPHERE_INTEL_MEMO__';
function intelMemo(): IntelMemo {
  const g = globalThis as unknown as Record<string, IntelMemo>;
  if (!g[MEMO_KEY]) g[MEMO_KEY] = { inflight: new Map(), memo: new Map() };
  return g[MEMO_KEY];
}

/**
 * Single-flight: concurrent callers for the same key share one in-flight fetch,
 * so a cold cache + many users can't fan out into parallel NVD requests (which
 * would trip its rate limit). Exported for tests.
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const { inflight } = intelMemo();
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const MEMO_MAX = 500;

function remember(key: string, value: { data: unknown; fetchedAt: string }) {
  const { memo } = intelMemo();
  memo.delete(key);
  memo.set(key, value);
  // Bounded: per-version OSV entries from manual checks must not grow forever
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
}

async function cached<T>(key: string, force: boolean, loader: () => Promise<T>): Promise<{ data: T | null; status: FeedStatus }> {
  const { memo } = intelMemo();
  const isFresh = (at: string) => Date.now() - new Date(at).getTime() < TTL_MS;

  // Hot path: parsed copy in memory, no SQLite read / JSON.parse
  const mem = memo.get(key) as { data: T; fetchedAt: string } | undefined;
  if (mem && !force && isFresh(mem.fetchedAt)) return { data: mem.data, status: { ok: true, fetchedAt: mem.fetchedAt, cached: true } };

  const db = getDatabase();
  const hit = db.getIntelCache<T>(key);
  if (hit && isFresh(hit.fetchedAt) && !force) {
    remember(key, hit);
    return { data: hit.data, status: { ok: true, fetchedAt: hit.fetchedAt, cached: true } };
  }
  if (process.env.VULN_INTEL_DISABLED === 'true') {
    return { data: hit?.data ?? null, status: { ok: !!hit, fetchedAt: hit?.fetchedAt, error: 'Online lookups disabled (VULN_INTEL_DISABLED=true)' } };
  }
  try {
    const { data, fetchedAt } = await singleFlight(`load:${key}`, async () => {
      const loaded = await loader();
      return { data: loaded, fetchedAt: db.setIntelCache(key, loaded) };
    });
    remember(key, { data, fetchedAt });
    return { data, status: { ok: true, fetchedAt } };
  } catch (err) {
    // Serve stale data rather than nothing
    return {
      data: hit?.data ?? null,
      status: { ok: !!hit, fetchedAt: hit?.fetchedAt, cached: !!hit, error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/** All NVD CVEs for a product (every known version), cached 24h. */
export async function getNvdFeed(product: Product, force = false) {
  return cached<NvdCve[]>(`nvd:${product}`, force, async () => {
    const all: NvdCve[] = [];
    for (const [i, cpe] of NVD_CPES[product].entries()) {
      if (i > 0 && !process.env.NVD_API_KEY) await new Promise(r => setTimeout(r, 6500));
      all.push(...await fetchNvdForCpe(cpe));
    }
    const seen = new Set<string>();
    return all.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  });
}

// ── OSV ──────────────────────────────────────────────────────────────────────

interface OsvVuln {
  id: string;
  aliases: string[];
  summary: string;
  published: string;
  severityLabel?: string;
  vector?: string;
  fixed: string[];
  references: string[];
}

async function getOsv(product: Product, version: string, force = false) {
  if (!OSV_PACKAGES[product].length) return { data: [] as OsvVuln[], status: { ok: true } as FeedStatus };
  return cached<OsvVuln[]>(`osv:${product}:${version}`, force, async () => {
    const out: OsvVuln[] = [];
    for (const pkg of OSV_PACKAGES[product]) {
      const d = await fetchJson(OSV_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg, version }),
      });
      for (const v of d.vulns ?? []) {
        const fixed = (v.affected ?? [])
          .filter((a: any) => a.package?.name === pkg.name)
          .flatMap((a: any) => (a.ranges ?? []).flatMap((r: any) => (r.events ?? []).map((e: any) => e.fixed).filter(Boolean)));
        out.push({
          id: v.id,
          aliases: v.aliases ?? [],
          summary: v.summary ?? (v.details ?? '').slice(0, 300),
          published: v.published,
          severityLabel: v.database_specific?.severity,
          vector: (v.severity ?? []).find((s: any) => /CVSS_V3|CVSS_V4/.test(s.type))?.score,
          fixed: [...new Set<string>(fixed)],
          references: (v.references ?? []).slice(0, 8).map((r: any) => r.url),
        });
      }
    }
    return out;
  });
}

// ── CISA KEV + EPSS ──────────────────────────────────────────────────────────

type KevMap = Record<string, { dateAdded: string; ransomware: string; action: string; due: string }>;

async function getKev(force = false) {
  return cached<KevMap>('kev', force, async () => {
    const d = await fetchJson(KEV_URL, {}, 60_000);
    const map: KevMap = {};
    for (const v of d.vulnerabilities ?? []) {
      map[v.cveID] = { dateAdded: v.dateAdded, ransomware: v.knownRansomwareCampaignUse, action: v.requiredAction, due: v.dueDate };
    }
    return map;
  });
}

async function getEpss(cves: string[], force = false): Promise<{ data: Record<string, { epss: number; percentile: number }>; status: FeedStatus }> {
  const result: Record<string, { epss: number; percentile: number }> = {};
  const missing: string[] = [];
  const db = getDatabase();
  for (const id of cves) {
    const hit = db.getIntelCache<{ epss: number; percentile: number }>(`epss:${id}`);
    if (hit && !force && Date.now() - new Date(hit.fetchedAt).getTime() < TTL_MS) result[id] = hit.data;
    else missing.push(id);
  }
  if (!missing.length) return { data: result, status: { ok: true, cached: true } };
  if (process.env.VULN_INTEL_DISABLED === 'true') return { data: result, status: { ok: false, error: 'Online lookups disabled' } };
  try {
    for (let i = 0; i < missing.length; i += 80) {
      const batch = missing.slice(i, i + 80);
      const d = await fetchJson(`${EPSS_URL}?cve=${batch.join(',')}`);
      for (const row of d.data ?? []) {
        const v = { epss: Number(row.epss), percentile: Number(row.percentile) };
        result[row.cve] = v;
        db.setIntelCache(`epss:${row.cve}`, v);
      }
    }
    return { data: result, status: { ok: true, fetchedAt: new Date().toISOString() } };
  } catch (err) {
    return { data: result, status: { ok: false, error: err instanceof Error ? err.message : String(err) } };
  }
}

// ── Assessment ───────────────────────────────────────────────────────────────

export interface VulnFinding {
  id: string;                 // CVE id, or GHSA/OSV id when no CVE exists
  aliases: string[];
  summary: string;
  severity: Severity;
  score?: number;
  vector?: string;
  published?: string;
  fixedIn: string[];          // versions that fix it (relevant to the running version)
  affectedRange?: string;     // human-readable matched range
  kev?: KevMap[string];
  epss?: { epss: number; percentile: number };
  cwes: string[];
  references: string[];
  sources: ('NVD' | 'OSV')[];
  url: string;
}

export interface VulnAssessment {
  product: Product;
  version: string;
  checkedAt: string;
  findings: VulnFinding[];
  summary: Record<Severity, number> & { total: number; kev: number };
  recommendation: { upgradeTo: string | null; fixesAll: boolean; unfixed: string[] } ;
  sources: Record<'nvd' | 'osv' | 'kev' | 'epss', FeedStatus>;
}

const SEV_ORDER: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

function rangeText(m: CpeMatch): string {
  const exact = m.criteria.split(':')[5];
  if (exact && exact !== '*' && exact !== '-') return `= ${exact}`;
  const lo = m.versionStartIncluding ? `≥ ${m.versionStartIncluding}` : m.versionStartExcluding ? `> ${m.versionStartExcluding}` : '';
  const hi = m.versionEndExcluding ? `< ${m.versionEndExcluding}` : m.versionEndIncluding ? `≤ ${m.versionEndIncluding}` : '';
  return [lo, hi].filter(Boolean).join(', ') || 'all versions';
}

/** Pure merge of feed data for one version — exported for unit tests. */
export function assessFromFeeds(
  product: Product,
  version: string,
  nvd: NvdCve[],
  osv: OsvVuln[],
  kev: KevMap,
): VulnFinding[] {
  const byId = new Map<string, VulnFinding>();

  for (const c of nvd) {
    const hit = c.matches.find(m => cpeMatchCovers(m, version));
    if (!hit) continue;
    byId.set(c.id, {
      id: c.id,
      aliases: [],
      summary: c.description,
      severity: c.severity,
      score: c.score,
      vector: c.vector,
      published: c.published,
      fixedIn: hit.versionEndExcluding ? [hit.versionEndExcluding] : [],
      affectedRange: rangeText(hit),
      kev: kev[c.id],
      cwes: c.cwes,
      references: c.references.map(r => r.url),
      sources: ['NVD'],
      url: `https://nvd.nist.gov/vuln/detail/${c.id}`,
    });
  }

  for (const v of osv) {
    const cve = v.aliases.find(a => a.startsWith('CVE-'));
    const id = cve ?? v.id;
    const fixedIn = v.fixed.filter(f => compareVersions(f, version) > 0).sort(compareVersions);
    const existing = byId.get(id);
    if (existing) {
      existing.sources.push('OSV');
      existing.aliases = [...new Set([...existing.aliases, v.id, ...v.aliases.filter(a => a !== id)])];
      existing.fixedIn = [...new Set([...existing.fixedIn, ...fixedIn])].sort(compareVersions);
      continue;
    }
    const label = String(v.severityLabel ?? '').toUpperCase();
    byId.set(id, {
      id,
      aliases: [v.id, ...v.aliases.filter(a => a !== id)],
      summary: v.summary,
      severity: (label === 'MODERATE' ? 'MEDIUM' : ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(label) ? label : 'UNKNOWN') as Severity,
      vector: v.vector,
      published: v.published,
      fixedIn,
      kev: cve ? kev[cve] : undefined,
      cwes: [],
      references: v.references,
      sources: ['OSV'],
      url: cve ? `https://nvd.nist.gov/vuln/detail/${cve}` : `https://osv.dev/vulnerability/${v.id}`,
    });
  }

  return [...byId.values()].sort((a, b) =>
    (b.kev ? 1 : 0) - (a.kev ? 1 : 0)
    || SEV_ORDER[b.severity] - SEV_ORDER[a.severity]
    || (b.score ?? 0) - (a.score ?? 0)
    || String(b.published).localeCompare(String(a.published)));
}

/**
 * Smallest version that fixes every finding with a known fix, preferring fixes
 * on the running version's own release line (same major).
 */
export function recommendUpgrade(version: string, findings: VulnFinding[]) {
  const major = parseVersion(version)[0];
  let target: string | null = null;
  const unfixed: string[] = [];
  for (const f of findings) {
    const candidates = f.fixedIn.filter(v => compareVersions(v, version) > 0).sort(compareVersions);
    if (!candidates.length) { unfixed.push(f.id); continue; }
    const sameLine = candidates.find(v => parseVersion(v)[0] === major) ?? candidates[0];
    if (!target || compareVersions(sameLine, target) > 0) target = sameLine;
  }
  return { upgradeTo: target, fixesAll: unfixed.length === 0, unfixed };
}

export async function assessVersion(product: Product, version: string, force = false): Promise<VulnAssessment> {
  const [nvd, osv, kev] = await Promise.all([getNvdFeed(product, force), getOsv(product, version, force), getKev(force)]);
  const findings = assessFromFeeds(product, version, nvd.data ?? [], osv.data ?? [], kev.data ?? {});
  const epss = await getEpss(findings.map(f => f.id).filter(id => id.startsWith('CVE-')), force);
  for (const f of findings) f.epss = epss.data[f.id];

  const summary = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0, total: findings.length, kev: 0 };
  for (const f of findings) {
    summary[f.severity]++;
    if (f.kev) summary.kev++;
  }
  return {
    product,
    version,
    checkedAt: new Date().toISOString(),
    findings,
    summary,
    recommendation: recommendUpgrade(version, findings),
    sources: { nvd: nvd.status, osv: osv.status, kev: kev.status, epss: epss.status },
  };
}

/** Warm the per-product feeds (called daily by the scheduler). */
export async function refreshFeeds(): Promise<void> {
  if (process.env.VULN_INTEL_DISABLED === 'true') return;
  await getKev(true);
  for (const p of Object.keys(NVD_CPES) as Product[]) await getNvdFeed(p, true);
}
