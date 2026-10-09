# Development

- [Local setup](#local-setup)
- [Project structure](#project-structure)
- [Conventions for API routes](#conventions-for-api-routes)
- [Testing](#testing)
- [Frontend](#frontend)

---

## Local setup

```bash
# Node 20 or 22, plus build tools for native modules (better-sqlite3, bcrypt)
npm ci
export JWT_SECRET=$(openssl rand -hex 32)
npm run dev                    # http://localhost:3000, admin/admin on first run
```

In development `ALLOW_LOOPBACK_TARGETS` defaults to true, so a local Elasticsearch or ClickHouse on `localhost` works. Throwaway services for testing:

```bash
docker run -d --name es -p 9200:9200 -e discovery.type=single-node -e xpack.security.enabled=false docker.elastic.co/elasticsearch/elasticsearch:8.15.0
docker run -d --name ch -p 8123:8123 -e CLICKHOUSE_USER=dev -e CLICKHOUSE_PASSWORD=dev clickhouse/clickhouse-server:latest
```

## Project structure

```
src/
  app/                     Pages (App Router) and API routes (app/api/**/route.ts)
  components/
    ui/                    shadcn/ui primitives
    app/                   Shared building blocks: PageHeader, StatCard, HealthBadge, EmptyState, BrandMark…
    organisms/             App shell: sidebar, header, ⌘K command menu
    clickhouse/            ClickHouse shared client pieces, migration jobs panel
    security/              Vulnerability banner
  constants/navigation.ts  Single source of truth for the sidebar, breadcrumbs and command palette
  contexts/                Auth, connection (browser side), theme
  lib/
    auth.ts                Token verification (boot nonce, user state from DB), role helpers
    cluster-session.ts     Per-user server-side sessions (search + ClickHouse), saved-connection access
    url-guard.ts           SSRF guard (shape + DNS + connect-time lookup)
    ssl-bypass.ts          Pooled HTTP(S) transport for cluster traffic (keep-alive, size caps, retry)
    es-permissions.ts      Role → allowed Elasticsearch API calls
    clickhouse.ts          ClickHouse HTTP client (safety settings, JSONEachRow inserts)
    clickhouse-sql.ts      ClickHouse statement classifier and role checks
    clickhouse-advisor.ts  Table advisor rules (best-practice skill)
    es-to-clickhouse.ts    Mapping → ClickHouse table plan
    migration-*.ts         Plan from a live index; background copy jobs
    posture.ts             Security posture audits
    drift*.ts              Configuration snapshots, normalisation, diff, storage
    vuln-intel.ts          NVD / OSV / KEV / EPSS matching and caching
    scheduler.ts           Background jobs (started once from instrumentation.ts)
    database-sqlite.ts     SQLite schema, migrations and accessors
  instrumentation.ts       Server start hook
tests/                     Unit tests (vitest)
docs/                      This documentation
```

## Conventions for API routes

- **Authenticate first.** Use `getUserFromRequest` / `requireAuth` / `requireWriter` / `requireAdmin` from `lib/auth`. Never trust the token payload for roles; `verifyToken` already loads the user's current role from the database.
- **Cluster access:**
  - Search clusters: `requireClusterAccess(request, method, esPath)`, which does auth, the session lookup and the role check in one call.
  - ClickHouse: `requireClickHouseSession`, plus `checkClickHouseQuery(role, sql)` for any SQL that comes from users.
- **Never build URLs from user input** without `parseOutboundUrl` / `assertSafeOutboundUrl`. Cluster traffic goes through `sslBypassFetch`, which guards automatically.
- **SQL:**
  - SQLite: always use `?` parameters.
  - ClickHouse: use `{name:Type}` parameters (`Identifier` for database/table names) or `quoteIdent`.
  - Dynamic `UPDATE` columns must be in `UPDATABLE_COLUMNS`.
- **Process-wide state** (pools, caches, job registries, sessions) lives on `globalThis` under a namespaced key. Next.js gives every route its own module instance.
- **Long or periodic work:**
  - Bound concurrency with `namedSemaphore`.
  - Never let timers overlap: chain them with `setTimeout`, or guard with an in-flight flag.
  - Clean up on abort.
- **Audit:** write significant actions with `writeAuditLog`.

## Testing

```bash
npm test                      # unit tests (vitest): permissions, SSRF guard, SQL classifier,
                              # advisor rules, mapping planner, row transform, drift diff,
                              # vulnerability matching, semaphore, single-flight, CSV escaping
npx tsc --noEmit -p .         # type-check
npm run build                 # production build
```

Before a release, also run end-to-end checks against real clusters:

- **Auth and roles:** anonymous requests rejected, roles enforced, forced password change, session revocation.
- **SSRF:** metadata and loopback targets blocked.
- **Isolation:** one user's session can't be used by another.
- **ClickHouse:** readonly enforcement, cancel, advisor, migration with row parity.
- **Posture and drift.**
- **Load:** concurrent mixed load with memory sampling under a capped heap (`--max-old-space-size=256`); memory must plateau.
- **Docker:** build the image and run the same suites against the container.

## Frontend

Follow [UI guidelines](ui-guidelines.md). In short:

- Start every page with `PageHeader`.
- Use neutral tokens, and colour only for state (`text-success` / `warning` / `destructive`).
- Use `StatCard`, `HealthBadge`, `SeverityBadge` and `EmptyState`.
- Use sentence case.
- Pages must work at 390 px wide.
- Polling must never overlap.

Add new pages to `src/constants/navigation.ts` so they appear in the sidebar, breadcrumbs and ⌘K.
