/**
 * Shared shape of the best-practice configuration reviews
 * (clickhouse-config-review.ts, search-config-review.ts).
 *
 * A review is a list of checks. Each check compares a live value with the
 * documented recommendation; failed checks carry a severity and a fix, and a
 * check that could not be evaluated is "skipped" — never silently passed.
 * Scoring reuses the posture weights so grades mean the same on every page.
 */
import { gradeFor, type PostureFinding, type PostureSeverity } from './posture';

export interface ConfigCheck<C extends string = string> {
  id: string;
  category: C;
  title: string;
  status: 'pass' | 'fail' | 'skipped';
  severity?: PostureSeverity;
  /** What the server has now. */
  current?: string;
  /** What the vendor recommends. */
  recommended?: string;
  detail?: string;
  remediation?: string;
  /** Best-practice rule name or documentation link. */
  reference?: string;
}

export interface ConfigReview {
  engine?: 'clickhouse' | 'elasticsearch' | 'opensearch';
  version: string;
  target: string;
  checkedAt: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  categories: string[];
  checks: ConfigCheck[];
  summary: { pass: number; fail: number; skipped: number; bySeverity: Record<PostureSeverity, number> };
}

export class Review<C extends string = string> {
  checks: ConfigCheck<C>[] = [];
  pass(c: Omit<ConfigCheck<C>, 'status' | 'severity'>) { this.checks.push({ ...c, status: 'pass' }); }
  fail(c: Omit<ConfigCheck<C>, 'status'> & { severity: PostureSeverity }) { this.checks.push({ ...c, status: 'fail' }); }
  skip(c: Pick<ConfigCheck<C>, 'id' | 'category' | 'title'> & { detail: string }) { this.checks.push({ ...c, status: 'skipped' }); }
}

export function finalizeReview<C extends string>(
  r: Review<C>,
  categories: readonly C[],
  meta: { version: string; target: string; engine?: ConfigReview['engine'] },
): ConfigReview {
  const findings: PostureFinding[] = r.checks
    .filter(c => c.status === 'fail' && c.severity)
    .map(c => ({ id: c.id, category: 'Hardening', severity: c.severity!, title: c.title, detail: c.detail ?? '' }));
  const { score, grade } = gradeFor(findings);
  const bySeverity: Record<PostureSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  const statusOrder: Record<string, number> = { fail: 0, skipped: 1, pass: 2 };
  const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const checks = [...r.checks].sort((a, b) =>
    categories.indexOf(a.category) - categories.indexOf(b.category)
    || statusOrder[a.status] - statusOrder[b.status]
    || sevOrder[a.severity ?? 'info'] - sevOrder[b.severity ?? 'info']);

  return {
    engine: meta.engine,
    version: meta.version,
    target: meta.target,
    checkedAt: new Date().toISOString(),
    score,
    grade,
    categories: [...categories],
    checks,
    summary: {
      pass: checks.filter(c => c.status === 'pass').length,
      fail: checks.filter(c => c.status === 'fail').length,
      skipped: checks.filter(c => c.status === 'skipped').length,
      bySeverity,
    },
  };
}

export function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
