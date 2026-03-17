import https from 'https';
import http from 'http';
import { URL } from 'url';

// NOTE: NODE_TLS_REJECT_UNAUTHORIZED is intentionally NOT set globally.
// On-premises Elasticsearch / OpenSearch clusters always use self-signed
// certificates; we handle this safely by passing a scoped https.Agent with
// rejectUnauthorized:false only for requests destined for the cluster.
// This avoids disabling TLS verification for every other outbound connection
// the process makes (logging webhooks, external APIs, etc.).

const RESPONSE_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB guard

/**
 * Fetch wrapper that disables TLS certificate verification for the specific
 * request only.  Always enabled because on-prem clusters ship self-signed
 * certs by default — this is a deliberate, scoped decision, not a global
 * security downgrade.
 */
export async function sslBypassFetch(url: string, options: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';

    // Scoped agent: rejectUnauthorized:false applies only to THIS connection.
    const agent = isHttps
      ? new https.Agent({ rejectUnauthorized: false })
      : new http.Agent();

    const requestOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      agent,
    };

    const client = isHttps ? https : http;

    const req = client.request(requestOptions, (res) => {
      let data = '';
      let size = 0;

      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > RESPONSE_SIZE_LIMIT) {
          req.destroy();
          reject(new Error(`Response too large (> ${RESPONSE_SIZE_LIMIT / 1024 / 1024} MB)`));
          return;
        }
        data += chunk;
      });

      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
          headers: res.headers,
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}
