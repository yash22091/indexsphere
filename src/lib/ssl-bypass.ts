import https from 'https';
import http from 'http';

import { parseOutboundUrl, guardedLookup } from './url-guard';

// NOTE: NODE_TLS_REJECT_UNAUTHORIZED is intentionally NOT set globally.
// On-premises Elasticsearch / OpenSearch / ClickHouse servers often use
// self-signed certificates, so certificate verification is decided per
// connection (`verifyTls`) via one of two dedicated agents.
//
// Every request is SSRF-guarded: the URL shape is validated up front and the
// resolved IP is re-checked at connect time (guardedLookup), so cloud metadata
// / link-local addresses are unreachable even via DNS rebinding. Redirects are
// never followed.

const RESPONSE_SIZE_LIMIT = Number(process.env.CLUSTER_MAX_RESPONSE_BYTES ?? 50 * 1024 * 1024);
const REQUEST_TIMEOUT_MS = Number(process.env.CLUSTER_REQUEST_TIMEOUT_MS ?? 60_000);

// Keep-alive pools shared by all cluster traffic: avoids a TCP + TLS handshake
// per request, and maxSockets bounds concurrent connections per host so a burst
// of requests queues instead of exhausting sockets on either side.
// Idle pooled sockets expire after 5 s — shorter than common server keep-alive
// timeouts (ClickHouse 10–30 s, Elasticsearch/nginx ≥ 60 s), so we rarely reuse
// a socket the server is closing. The rare race left is retried once below.
const IDLE_SOCKET_MS = 5_000;
const AGENT_OPTIONS = { keepAlive: true, keepAliveMsecs: 1_000, maxSockets: 32, maxFreeSockets: 8, timeout: IDLE_SOCKET_MS };
const AGENTS_KEY = '__INDEXSPHERE_HTTP_AGENTS__';

interface Agents { http: http.Agent; httpsVerify: https.Agent; httpsNoVerify: https.Agent }

function agents(): Agents {
  const g = globalThis as unknown as Record<string, Agents>;
  if (!g[AGENTS_KEY]) {
    g[AGENTS_KEY] = {
      http: new http.Agent(AGENT_OPTIONS),
      httpsVerify: new https.Agent({ ...AGENT_OPTIONS, rejectUnauthorized: true }),
      httpsNoVerify: new https.Agent({ ...AGENT_OPTIONS, rejectUnauthorized: false }),
    };
  }
  return g[AGENTS_KEY];
}

export interface ClusterFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Verify the server certificate. Defaults to false (on-prem self-signed certs). */
  verifyTls?: boolean;
  /** Socket inactivity timeout; defaults to CLUSTER_REQUEST_TIMEOUT_MS (60 s). */
  timeoutMs?: number;
}

export interface ClusterResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: http.IncomingHttpHeaders;
  text: () => Promise<string>;
  json: () => Promise<any>;
}

/**
 * Fetch wrapper for cluster traffic. TLS verification is opt-in per connection
 * via `verifyTls`; the destination is always SSRF-checked.
 */
export async function sslBypassFetch(url: string, options: ClusterFetchOptions = {}): Promise<ClusterResponse> {
  try {
    return await fetchOnce(url, options);
  } catch (err) {
    // The server closed a pooled keep-alive socket just as we reused it: the
    // request never reached it, so one retry on a fresh socket is safe.
    if ((err as { reusedSocketReset?: boolean }).reusedSocketReset) return fetchOnce(url, options);
    throw err;
  }
}

function fetchOnce(url: string, options: ClusterFetchOptions): Promise<ClusterResponse> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = parseOutboundUrl(url, 'cluster');
    } catch (err) {
      reject(err);
      return;
    }
    const isHttps = parsedUrl.protocol === 'https:';
    const pool = agents();
    const agent = isHttps ? (options.verifyTls === true ? pool.httpsVerify : pool.httpsNoVerify) : pool.http;

    const requestOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname.replace(/^\[|\]$/g, ''),
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        ...(options.headers || {}),
        ...(options.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(options.body)) } : {}),
      },
      agent,
      lookup: guardedLookup as unknown as https.RequestOptions['lookup'],
      timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    };

    const client = isHttps ? https : http;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    let gotResponse = false;
    const req = client.request(requestOptions, (res) => {
      gotResponse = true;
      const chunks: Buffer[] = [];
      let size = 0;

      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > RESPONSE_SIZE_LIMIT) {
          // Stop reading and drop the socket instead of buffering an unbounded body
          res.destroy();
          req.destroy();
          fail(new Error(`Response too large (> ${Math.round(RESPONSE_SIZE_LIMIT / 1024 / 1024)} MB). Narrow the request (size, _source, filters).`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('error', fail);

      res.on('end', () => {
        if (settled) return;
        settled = true;
        const data = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          headers: res.headers,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${(options.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000}s`));
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (req.reusedSocket && err.code === 'ECONNRESET' && !gotResponse) {
        fail(Object.assign(err, { reusedSocketReset: true }));
      } else {
        fail(err);
      }
    });

    if (options.body !== undefined) {
      req.write(options.body);
    }

    req.end();
  });
}
