import { ElasticsearchConnectionConfig } from '@/types';
import { logger } from './logger';
import { sslBypassFetch } from './ssl-bypass';

export class ElasticsearchClient {
  private baseUrl: string;
  private auth?: { username: string; password: string };
  private headers: Record<string, string>;
  private serverType: 'elasticsearch' | 'opensearch';
  private useApiProxy: boolean;
  private verifyTls: boolean;

  constructor(config: ElasticsearchConnectionConfig, useApiProxy = true) {
    this.baseUrl = config.url;
    this.auth = config.auth;
    this.serverType = config.type || 'elasticsearch'; // Default to elasticsearch
    this.useApiProxy = useApiProxy;
    this.verifyTls = config.verifyTls === true;
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    if (this.auth) {
      const credentials = btoa(`${this.auth.username}:${this.auth.password}`);
      this.headers.Authorization = `Basic ${credentials}`;
    }
  }

  getServerType() {
    return this.serverType;
  }

  // Auto-detect server type by checking version info
  async detectServerType(): Promise<'elasticsearch' | 'opensearch'> {
    try {
      const info = await this.request('/');
      if (info.version?.distribution === 'opensearch') {
        this.serverType = 'opensearch';
        return 'opensearch';
      }
      // Default to elasticsearch
      this.serverType = 'elasticsearch';
      return 'elasticsearch';
    } catch {
      return this.serverType;
    }
  }

  async request(endpoint: string, options: RequestInit = {}) {
    const startTime = Date.now();
    const method = options.method || 'GET';
    
    try {
      // If using API proxy, route through Next.js API routes
      if (this.useApiProxy) {
        // Browser mode: the server resolves the cluster (URL + credentials) from the
        // user's server-side session. Nothing about the cluster is sent from here.
        const apiUrl = `/api/es-proxy${endpoint}`;

        const response = await fetch(apiUrl, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        const duration = Date.now() - startTime;
        
        if (!response.ok) {
          const errorText = await response.text();
          logger.esError(endpoint, method, new Error(`${response.status} ${response.statusText} - ${errorText}`));
          throw new Error(`Request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        logger.esRequest(endpoint, method, duration, response.status);
        return response.json();
      } else {
        // Direct connection (for server-side usage)
        // sslBypassFetch uses a scoped https.Agent to handle self-signed certs (on-prem)
        const url = `${this.baseUrl}${endpoint}`;
        
        const response = await sslBypassFetch(url, {
          method,
          body: typeof options.body === 'string' ? options.body : undefined,
          headers: {
            ...this.headers,
            ...(options.headers as Record<string, string> | undefined),
          },
          verifyTls: this.verifyTls,
        });

        const duration = Date.now() - startTime;

        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          logger.esError(endpoint, method, new Error(`${response.status} ${response.statusText}`));
          throw new Error(`Request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
        }

        logger.esRequest(endpoint, method, duration, response.status);
        return response.json();
      }
    } catch (error) {
      logger.esError(endpoint, method, error as Error);
      throw error;
    }
  }

  /**
   * Server-side passthrough used by the ES proxy: sends the request with this
   * client's credentials and TLS policy and returns the raw response (any status).
   * `absoluteUrl` must already be validated to point at this client's cluster.
   */
  async rawRequest(method: string, absoluteUrl: string, body?: string, contentType = 'application/json') {
    if (this.useApiProxy) throw new Error('rawRequest is server-side only');
    const { 'Content-Type': _ct, ...headers } = this.headers;
    return sslBypassFetch(absoluteUrl, {
      method,
      body,
      headers: { ...headers, 'Content-Type': contentType },
      verifyTls: this.verifyTls,
    });
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getVerifyTls() {
    return this.verifyTls;
  }

  // Public method to get cluster info
  async getClusterInfo() {
    return this.request('/');
  }

  // Cluster APIs
  async getClusterHealth() {
    return this.request('/_cluster/health');
  }

  async getClusterStats() {
    return this.request('/_cluster/stats');
  }

  async getClusterSettings() {
    return this.request('/_cluster/settings');
  }

  async updateClusterSettings(settings: Record<string, unknown>) {
    return this.request('/_cluster/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Node APIs
  async getNodes() {
    return this.request('/_nodes');
  }

  async getNodeStats() {
    return this.request('/_nodes/stats');
  }

  // Search APIs
  async getSearchTemplates() {
    // OpenSearch 7.x does not support listing all stored scripts via /_scripts.
    // Return an empty object gracefully instead of throwing a 400.
    try {
      return await this.request('/_scripts');
    } catch {
      return { scripts: {} };
    }
  }

  // Index APIs
  async getIndices() {
    return this.request('/_cat/indices?format=json');
  }

  async getIndex(indexName: string) {
    return this.request(`/${indexName}`);
  }

  async createIndex(indexName: string, settings: Record<string, unknown>) {
    return this.request(`/${indexName}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async deleteIndex(indexName: string) {
    return this.request(`/${indexName}`, {
      method: 'DELETE',
    });
  }

  // Template APIs - with OpenSearch compatibility
  async getIndexTemplates() {
    if (this.serverType === 'opensearch') {
      // OpenSearch uses legacy template API
      return this.request('/_template');
    }
    // Elasticsearch 7.8+ composable templates
    return this.request('/_index_template');
  }

  async getIndexTemplate(templateName: string) {
    if (this.serverType === 'opensearch') {
      return this.request(`/_template/${templateName}`);
    }
    return this.request(`/_index_template/${templateName}`);
  }

  async createIndexTemplate(templateName: string, template: Record<string, unknown>) {
    if (this.serverType === 'opensearch') {
      return this.request(`/_template/${templateName}`, {
        method: 'PUT',
        body: JSON.stringify(template),
      });
    }
    return this.request(`/_index_template/${templateName}`, {
      method: 'PUT',
      body: JSON.stringify(template),
    });
  }

  async deleteIndexTemplate(templateName: string) {
    if (this.serverType === 'opensearch') {
      return this.request(`/_template/${templateName}`, {
        method: 'DELETE',
      });
    }
    return this.request(`/_index_template/${templateName}`, {
      method: 'DELETE',
    });
  }

  // Component Template APIs
  async getComponentTemplates() {
    return this.request('/_component_template');
  }

  async createComponentTemplate(templateName: string, template: Record<string, unknown>) {
    return this.request(`/_component_template/${templateName}`, {
      method: 'PUT',
      body: JSON.stringify(template),
    });
  }

  // Alias APIs
  async getAliases() {
    return this.request('/_alias');
  }

  async updateAliases(actions: Record<string, unknown>[]) {
    return this.request('/_aliases', {
      method: 'POST',
      body: JSON.stringify({ actions }),
    });
  }

  // ILM APIs - OpenSearch uses ISM (Index State Management)
  async getILMPolicies() {
    if (this.serverType === 'opensearch') {
      // OpenSearch ISM policies
      return this.request('/_plugins/_ism/policies');
    }
    return this.request('/_ilm/policy');
  }

  async createILMPolicy(policyName: string, policy: Record<string, unknown>) {
    if (this.serverType === 'opensearch') {
      return this.request(`/_plugins/_ism/policies/${policyName}`, {
        method: 'PUT',
        body: JSON.stringify(policy),
      });
    }
    return this.request(`/_ilm/policy/${policyName}`, {
      method: 'PUT',
      body: JSON.stringify(policy),
    });
  }

  async getILMStatus() {
    if (this.serverType === 'opensearch') {
      // ISM doesn't have a direct status endpoint
      return { enabled: true };
    }
    return this.request('/_ilm/status');
  }

  // Snapshot APIs
  async getRepositories() {
    return this.request('/_snapshot');
  }

  async createRepository(repoName: string, settings: Record<string, unknown>) {
    return this.request(`/_snapshot/${repoName}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async getSnapshots(repoName: string) {
    return this.request(`/_snapshot/${repoName}/_all`);
  }

  async createSnapshot(repoName: string, snapshotName: string, settings: Record<string, unknown>) {
    return this.request(`/_snapshot/${repoName}/${snapshotName}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Search APIs
  async search(indexPattern: string, query: Record<string, unknown>) {
    return this.request(`/${indexPattern}/_search`, {
      method: 'POST',
      body: JSON.stringify(query),
    });
  }

  // Cat APIs
  async catIndices() {
    return this.request('/_cat/indices?format=json&v');
  }

  async catNodes() {
    return this.request('/_cat/nodes?format=json&v');
  }

  async catShards() {
    return this.request('/_cat/shards?format=json&v');
  }

  async catAllocation() {
    return this.request('/_cat/allocation?format=json&v');
  }

  // Generic request method for REST interface
  async genericRequest(method: string, endpoint: string, body?: Record<string, unknown>) {
    return this.request(endpoint, {
      method: method.toUpperCase(),
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // Enhanced visibility methods for cluster analysis
  async getInstalledPlugins() {
    try {
      // Try nodes info with plugins
      const response = await this.request('/_nodes/plugins');
      return response;
    } catch (error) {
      console.warn('Could not fetch plugin information:', error);
      return null;
    }
  }

  /** Allocation explanation for the first unassigned shard, or null when every shard is assigned. */
  async getClusterAllocation() {
    try {
      const health = await this.request('/_cluster/health') as { unassigned_shards?: number };
      if (!health.unassigned_shards) return null; // nothing to explain (the API would answer 400)
      return await this.request('/_cluster/allocation/explain');
    } catch (error) {
      console.warn('Could not fetch allocation information:', error);
      return null;
    }
  }

  async getIndicesSettings() {
    try {
      return await this.request('/_all/_settings');
    } catch (error) {
      console.warn('Could not fetch index settings:', error);
      return null;
    }
  }

  async getClusterPendingTasks() {
    try {
      return await this.request('/_cluster/pending_tasks');
    } catch (error) {
      console.warn('Could not fetch pending tasks:', error);
      return null;
    }
  }

  async getHotThreads() {
    try {
      return await this.request('/_nodes/hot_threads?threads=10&type=cpu');
    } catch (error) {
      console.warn('Could not fetch hot threads:', error);
      return null;
    }
  }

  async getThreadPoolStats() {
    try {
      return await this.request('/_nodes/stats/thread_pool');
    } catch (error) {
      console.warn('Could not fetch thread pool stats:', error);
      return null;
    }
  }

  async getSegmentInfo() {
    try {
      return await this.request('/_cat/segments?format=json&v');
    } catch (error) {
      console.warn('Could not fetch segment information:', error);
      return null;
    }
  }

  // ── Monitoring: full JVM/CPU/GC stats ────────────────────────────────────
  async getDetailedNodeStats() {
    return this.request('/_nodes/stats/jvm,os,process,indices,thread_pool');
  }

  async getClusterPendingTasksCount() {
    try {
      const r = await this.request('/_cluster/pending_tasks');
      return { count: Array.isArray(r.tasks) ? r.tasks.length : 0 };
    } catch {
      return { count: 0 };
    }
  }

  // ── Reindex ──────────────────────────────────────────────────────────────
  async reindex(body: Record<string, unknown>, waitForCompletion = false) {
    return this.request(`/_reindex?wait_for_completion=${waitForCompletion}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getTask(taskId: string) {
    // Single-task lookup returns full details; Elasticsearch rejects ?detailed here (it is only valid when listing tasks)
    return this.request(`/_tasks/${taskId}`);
  }

  async cancelTask(taskId: string) {
    return this.request(`/_tasks/${taskId}/_cancel`, { method: 'POST' });
  }

  // ── Index mapping for AI context ─────────────────────────────────────────
  async getIndexMapping(indexName: string) {
    return this.request(`/${indexName}/_mapping`);
  }

  // ── Cross-cluster: list indices from a remote direct client ──────────────
  async fetchRemoteIndices() {
    return this.request('/_cat/indices?format=json&h=index,health,status,pri,rep,docs.count,store.size');
  }

  /** Template name → definition. Composable templates first, legacy templates as fallback. */
  async fetchRemoteTemplates(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    try {
      const composable = await this.request('/_index_template') as { index_templates?: { name: string; index_template: unknown }[] };
      for (const t of composable.index_templates ?? []) out[t.name] = t.index_template;
    } catch { /* older clusters: legacy only */ }
    try {
      const legacy = await this.request('/_template') as Record<string, unknown>;
      for (const [name, t] of Object.entries(legacy)) if (!(name in out)) out[name] = t;
    } catch { /* ignore */ }
    return out;
  }

  async fetchRemoteSettings() {
    try { return this.request('/_cluster/settings'); } catch { return {}; }
  }
}

// Browser-side singleton: the proxy client for the current tab. It holds no
// credentials (see request()). On the server it is deliberately disabled —
// server code must use the per-user session store in cluster-session.ts so one
// user's connection can never be used by another.
let elasticsearchClient: ElasticsearchClient | null = null;
const isServer = typeof window === 'undefined';

export function getElasticsearchClient(): ElasticsearchClient | null {
  return isServer ? null : elasticsearchClient;
}

export function setElasticsearchClient(client: ElasticsearchClient) {
  if (isServer) return;
  elasticsearchClient = client;
}

export function clearElasticsearchClient() {
  elasticsearchClient = null;
}
