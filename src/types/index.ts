// Common types for the application
export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: "admin" | "user" | "moderator";
  createdAt: Date;
  updatedAt: Date;
}

export interface NavigationItem {
  name: string;
  href: string;
  icon?: string;
  children?: NavigationItem[];
}

export interface ElasticsearchConnectionConfig {
  url: string;
  auth?: {
    username: string;
    password: string;
  };
  headers?: Record<string, string>;
  name?: string;
  type?: 'elasticsearch' | 'opensearch';
  /** Verify the cluster's TLS certificate (server-side only). Default false for self-signed on-prem certs. */
  verifyTls?: boolean;
}

export interface ApiResponse<T = unknown> {
  data: T;
  message: string;
  status: "success" | "error";
}

export interface PaginationParams {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Elasticsearch specific types
export interface ElasticsearchCluster {
  host: string;
  name: string;
  status: "green" | "yellow" | "red";
  numberOfNodes: number;
  numberOfDataNodes: number;
  activePrimaryShards: number;
  activeShards: number;
  relocatingShards: number;
  initializingShards: number;
  unassignedShards: number;
  delayedUnassignedShards: number;
  numberOfPendingTasks: number;
  numberOfInFlightFetch: number;
  taskMaxWaitingInQueueMillis: number;
  activeShardsPercentAsNumber: number;
}

export interface ElasticsearchNode {
  id: string;
  name: string;
  transportAddress: string;
  host: string;
  ip: string;
  version: string;
  buildHash: string;
  roles: string[];
  attributes: Record<string, string>;
  os: {
    name: string;
    arch: string;
    version: string;
    availableProcessors: number;
  };
  jvm: {
    version: string;
    vmName: string;
    vmVersion: string;
    vmVendor: string;
    startTimeInMillis: number;
    mem: {
      heapUsedInBytes: number;
      heapMaxInBytes: number;
      nonHeapUsedInBytes: number;
      nonHeapMaxInBytes: number;
    };
  };
  fs: {
    total: {
      totalInBytes: number;
      freeInBytes: number;
      availableInBytes: number;
    };
  };
}

export interface ElasticsearchIndex {
  name: string;
  status: "open" | "close";
  health: "green" | "yellow" | "red";
  uuid: string;
  pri: number;
  rep: number;
  "docs.count": number;
  "docs.deleted": number;
  "store.size": string;
  "pri.store.size": string;
  aliases: string[];
  settings?: Record<string, unknown>;
  mappings?: Record<string, unknown>;
}

export interface ElasticsearchTemplate {
  name: string;
  indexPatterns: string[];
  version?: number;
  order?: number;
  settings?: Record<string, unknown>;
  mappings?: Record<string, unknown>;
  aliases?: Record<string, unknown>;
}

export interface ElasticsearchSnapshot {
  snapshot: string;
  uuid: string;
  versionId: number;
  version: string;
  indices: string[];
  state: "IN_PROGRESS" | "SUCCESS" | "FAILED" | "PARTIAL";
  startTime: string;
  startTimeInMillis: number;
  endTime?: string;
  endTimeInMillis?: number;
  durationInMillis?: number;
  failures?: unknown[];
  shards: {
    total: number;
    failed: number;
    successful: number;
  };
}

export interface ElasticsearchRepository {
  name: string;
  type: string;
  settings: Record<string, unknown>;
}
