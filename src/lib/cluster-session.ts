/**
 * Per-user cluster sessions (server-side only).
 *
 * Each authenticated user has their own active cluster connection. The client
 * (URL + credentials) lives only in server memory, keyed by user id, so:
 *   • user A's requests can never hit user B's cluster;
 *   • the browser never needs to hold cluster credentials;
 *   • the ES proxy can only reach the cluster the user explicitly connected to.
 *
 * Stored on globalThis so every Next.js route bundle shares the same map.
 * Sessions expire after IDLE_TTL_MS without use and are dropped on restart.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ElasticsearchClient } from './elasticsearch';
import { AuthUser, getUserFromRequest, canWrite } from './auth';
import { getDatabase, decryptValue, isRoleAllowedForConnection, SavedConnection } from './database-sqlite';
import { ClickHouseClient } from './clickhouse';
import { parseOutboundUrl } from './url-guard';
import { isEsRequestAllowed } from './es-permissions';
import { ElasticsearchConnectionConfig } from '@/types';

export interface ClusterSession {
  client: ElasticsearchClient;
  url: string;
  serverType: 'elasticsearch' | 'opensearch';
  savedConnectionId?: string;
  connectedAt: number;
  lastUsed: number;
}

/** A user's ClickHouse connection — independent of their search-cluster session. */
export interface ClickHouseSession {
  client: ClickHouseClient;
  url: string;
  version: string;
  savedConnectionId?: string;
  connectedAt: number;
  lastUsed: number;
}

const IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const STORE_KEY = '__INDEXSPHERE_CLUSTER_SESSIONS__';
const CH_STORE_KEY = '__INDEXSPHERE_CLICKHOUSE_SESSIONS__';

function globalMap<T>(key: string): Map<string, T> {
  const g = globalThis as unknown as Record<string, Map<string, T>>;
  if (!g[key]) g[key] = new Map();
  return g[key];
}

function store(): Map<string, ClusterSession> {
  return globalMap<ClusterSession>(STORE_KEY);
}

function chStore(): Map<string, ClickHouseSession> {
  return globalMap<ClickHouseSession>(CH_STORE_KEY);
}

function sweep(): void {
  const now = Date.now();
  for (const map of [store(), chStore()] as Map<string, { lastUsed: number }>[]) {
    for (const [userId, session] of map) {
      if (now - session.lastUsed > IDLE_TTL_MS) map.delete(userId);
    }
  }
}

export function getClusterSession(userId: string): ClusterSession | null {
  sweep();
  const session = store().get(userId) ?? null;
  if (session) session.lastUsed = Date.now();
  return session;
}

export function setClusterSession(userId: string, client: ElasticsearchClient, url: string, savedConnectionId?: string): ClusterSession {
  const now = Date.now();
  const session: ClusterSession = {
    client,
    url,
    serverType: client.getServerType(),
    savedConnectionId,
    connectedAt: now,
    lastUsed: now,
  };
  store().set(userId, session);
  return session;
}

export function clearClusterSession(userId: string): void {
  store().delete(userId);
}

export function getClickHouseSession(userId: string): ClickHouseSession | null {
  sweep();
  const session = chStore().get(userId) ?? null;
  if (session) session.lastUsed = Date.now();
  return session;
}

export function setClickHouseSession(userId: string, client: ClickHouseClient, version: string, savedConnectionId?: string): ClickHouseSession {
  const now = Date.now();
  const session: ClickHouseSession = { client, url: client.getBaseUrl(), version, savedConnectionId, connectedAt: now, lastUsed: now };
  chStore().set(userId, session);
  return session;
}

export function clearClickHouseSession(userId: string): void {
  chStore().delete(userId);
}

/** Drop every session (search or ClickHouse) bound to a saved connection (after it is edited or deleted). */
export function clearSessionsForSavedConnection(savedConnectionId: string): void {
  for (const map of [store(), chStore()] as Map<string, { savedConnectionId?: string }>[]) {
    for (const [userId, session] of map) {
      if (session.savedConnectionId === savedConnectionId) map.delete(userId);
    }
  }
}

/** Build a ClickHouse client and verify it can run a query. */
export async function openClickHouseClient(config: ConstructorParameters<typeof ClickHouseClient>[0]): Promise<{ client: ClickHouseClient; version: string }> {
  const client = new ClickHouseClient(config);
  const { version } = await client.ping();
  return { client, version };
}

/** Build a server-side client and verify it can talk to the cluster. */
export async function openClusterClient(config: ElasticsearchConnectionConfig): Promise<ElasticsearchClient> {
  parseOutboundUrl(config.url, 'cluster');
  const client = new ElasticsearchClient({ ...config, url: config.url.replace(/\/+$/, '') }, false);
  await client.detectServerType();
  await client.getClusterHealth();
  return client;
}

export function configFromSavedConnection(conn: SavedConnection): ElasticsearchConnectionConfig {
  const password = conn.password_enc ? decryptValue(conn.password_enc) : undefined;
  return {
    url: conn.url,
    type: 'elasticsearch',
    verifyTls: conn.ssl_verify,
    ...(conn.username && password ? { auth: { username: conn.username, password } } : {}),
  };
}

/**
 * Load a saved connection the user is permitted to use.
 * Returns a NextResponse (404) when it does not exist or is not visible to the user's role —
 * 404 rather than 403 so connection ids cannot be enumerated.
 */
export function getSavedConnectionForUser(
  id: string,
  user: AuthUser,
  kind: 'search' | 'clickhouse' | 'any' = 'search',
): SavedConnection | NextResponse {
  const conn = getDatabase().getSavedConnectionById(id);
  const isClickHouse = conn?.engine === 'clickhouse';
  if (!conn || (!conn.is_active && user.role !== 'admin') || !isRoleAllowedForConnection(conn, user.role)
      || (kind !== 'any' && isClickHouse !== (kind === 'clickhouse'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return conn;
}

export function clickHouseConfigFromSavedConnection(conn: SavedConnection) {
  return {
    url: conn.url,
    username: conn.username,
    password: conn.password_enc ? decryptValue(conn.password_enc) : undefined,
    verifyTls: conn.ssl_verify,
  };
}

/** Auth + active ClickHouse session lookup for API routes. */
export function requireClickHouseSession(request: NextRequest): { user: AuthUser; session: ClickHouseSession } | NextResponse {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const session = getClickHouseSession(user.id);
  if (!session) {
    return NextResponse.json({ error: 'No ClickHouse server connected. Please connect first.' }, { status: 409 });
  }
  return { user, session };
}

/**
 * Ad-hoc cluster URLs (typed in by the user rather than a saved connection)
 * are restricted to roles that may write — readonly users can only use the
 * saved connections an admin granted them.
 */
export function assertMayUseAdHocConnection(user: AuthUser): NextResponse | null {
  if (canWrite(user)) return null;
  return NextResponse.json(
    { error: 'Read-only users can only connect through saved connections assigned by an admin' },
    { status: 403 },
  );
}

/** Auth + active cluster session lookup for API routes. */
export function requireClusterSession(request: NextRequest): { user: AuthUser; session: ClusterSession } | NextResponse {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const session = getClusterSession(user.id);
  if (!session) {
    return NextResponse.json({ error: 'No cluster connected. Please connect to a cluster first.' }, { status: 409 });
  }
  return { user, session };
}

/**
 * requireClusterSession + role check for the ES operation the route is about to
 * perform (same rules as the ES proxy, see es-permissions.ts).
 */
export function requireClusterAccess(
  request: NextRequest,
  method: string,
  esPath: string,
): { user: AuthUser; session: ClusterSession } | NextResponse {
  const ctx = requireClusterSession(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!isEsRequestAllowed(ctx.user.role, method, esPath)) {
    return NextResponse.json(
      { error: `Your role (${ctx.user.role}) is not allowed to perform ${method} ${esPath}` },
      { status: 403 },
    );
  }
  return ctx;
}
