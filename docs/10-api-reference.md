# API reference

All endpoints are under `/api` and use JSON. Authenticate with the `auth-token` cookie set by `POST /api/auth/login`, or `Authorization: Bearer <token>`.

**Common status codes**

| Code | Meaning |
|---|---|
| 401 | Not signed in |
| 403 | Your role is not allowed |
| 404 | Not found, or not visible to you |
| 409 | No cluster / ClickHouse session — connect first |
| 413 | Body too large |
| 429 | Busy (PDF) |
| 502 | The cluster or an external service failed |

Role column: **any** = any signed-in user; **user** = `user` or `admin`; **admin** = admin only. *Session* means the request acts on your own connected cluster or ClickHouse server.

## Authentication & users

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/login` | public | `{username, password}`; sets the session cookie |
| POST | `/auth/logout` | any | Ends the session and drops your cluster sessions |
| GET | `/auth/verify` | any | Current user |
| POST | `/auth/change-password` | any | `{currentPassword, newPassword}` |
| GET / POST | `/users` | admin | List / create (`{username, email, password, role}`) |
| PATCH / DELETE | `/users/{id}` | admin | Change role or password / delete |
| GET / POST / PATCH | `/auth-config` | admin | Sign-in policy, recent attempts, unlock |
| GET / POST | `/settings/security` | admin | Security lock and debug settings |
| GET / PUT / POST | `/settings/email` | admin | SMTP settings / save / send test |

## Connections & sessions

| Method | Path | Role | Description |
|---|---|---|---|
| GET / POST | `/saved-connections` | any / admin | List (filtered by role) / create (`engine`: `elasticsearch`, `opensearch`, `clickhouse`) |
| GET / PUT / DELETE | `/saved-connections/{id}` | any / admin / admin | Read / update / delete |
| POST | `/saved-connections/{id}/test` | any* | Test reachability |
| POST | `/saved-connections/{id}/connect` | any* | Open your session (search or ClickHouse by engine) |
| GET / POST / DELETE | `/connect` | any / user / any | Search-cluster session status / ad-hoc connect / disconnect |
| GET / POST / DELETE | `/clickhouse/connect` | any / user / any | ClickHouse session status / ad-hoc connect / disconnect |

\* only connections whose `allowed_roles` include your role.

## Elasticsearch / OpenSearch (session)

| Method | Path | Role | Description |
|---|---|---|---|
| any | `/es-proxy/{path}` | per [role rules](06-security.md#roles) | Raw API passthrough to your cluster |
| GET | `/cluster/health` | any | Cluster health |
| POST | `/cluster/health`, `/cluster/info` | user | Test an ad-hoc URL |
| PUT | `/cluster/health` | any | Export report data as JSON/CSV |
| GET | `/nodes`, `/indices` | any | Nodes / indices |
| GET / PUT / DELETE | `/indices/{name}` | any / user / user | Read / create / delete an index |
| GET / POST | `/templates` | any / user | List / create templates |
| GET / DELETE | `/templates/{name}` | any / user | Read / delete |
| GET / POST | `/search` | any | Search templates / execute search |
| POST / GET / DELETE | `/reindex` | user / any / user | Start / poll (`?task=`) / cancel |
| GET | `/monitoring/stream` | any | Server-sent events, 5-second metrics |
| GET / PUT | `/monitoring/thresholds` | any / admin | Warning/critical thresholds |
| POST | `/cluster-compare` | any | Diff two saved (or ad-hoc, user role) clusters |

## ClickHouse (session)

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/clickhouse/overview` | any | Server summary |
| GET | `/clickhouse/metrics` | any | Live metrics (also evaluates `ch_*` alert rules) |
| GET | `/clickhouse/databases` | any | `?system=1` includes system databases |
| GET | `/clickhouse/tables?database=` | any | Tables with storage stats |
| GET | `/clickhouse/table?database=&table=` | any | Columns, DDL, partitions, skip indices, sample |
| GET | `/clickhouse/queries?hours=` | any | Running / slow / failed / patterns |
| POST | `/clickhouse/queries/kill` | admin | `{queryId}` |
| POST | `/clickhouse/query` | any (role-checked) | `{sql, database?, mode: run, explain or estimate, maxRows?, clientQueryId?}` |
| POST | `/clickhouse/query/cancel` | owner / admin | `{clientQueryId}` |
| GET / POST | `/clickhouse/advisor` | any | Grade tables (`?database=`) / deep-analyze one `{database, table}` |
| POST | `/clickhouse/migrate` | any (create: user) | Plan `{index, database, table, naming?, analyzeCardinality?, create?}` |
| GET / POST | `/clickhouse/migrate/jobs` | any / user | List / start a copy `{index, database, table, createTable?, insertBatch?, maxDocs?}` |
| GET / DELETE | `/clickhouse/migrate/jobs/{id}` | owner / admin | Job status / cancel |

## Security

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/security/posture?target=search\|clickhouse` | any | Posture audit of your connected server |
| GET | `/vulnerabilities?target=search\|clickhouse` | any | Vulnerabilities for your connected server's version(s) |
| GET | `/vulnerabilities?product=&version=` | any | Manual lookup |
| POST | `/vulnerabilities` | admin | Same, bypassing the 24 h cache |
| GET / POST | `/drift?target=` | user | Snapshot timeline / take a snapshot |
| GET | `/drift/{id}` | user | Changes in a snapshot (user/role/grant sections admin-only) |
| GET | `/audit` | any | Audit log (non-admins: own entries) |

## Alerts & reports

| Method | Path | Role | Description |
|---|---|---|---|
| GET / POST | `/alerts` | any / admin | Rules and recent triggers / create |
| PUT / DELETE | `/alerts/{id}` | admin | Update / delete |
| GET / POST | `/scheduled-reports` | any / admin | List / create (needs a saved search-cluster `connection_id`) |
| PUT / DELETE / POST | `/scheduled-reports/{id}` | admin | Update / delete / run now |
| POST | `/reports/cluster-report` | any | Collect report data (`useActiveConnection` or saved `connectionId`) |
| POST | `/reports/generate-pdf` | admin | Render a PDF |

## AI

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/ai-query` | any | Natural language → DSL (`apiKey` from the browser, never stored) |
| GET / PUT | `/ai-query` | any / admin | Default base URL and model |
| POST | `/ai-explain` | any | Explain a query, profile or mapping |

## Misc

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/health` | public | Liveness |
| GET | `/init` | public | Whether first-run setup is needed |
