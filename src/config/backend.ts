// Backend configuration for production deployment
// 
// SSL Configuration Notes:
// - Set ELASTICSEARCH_SSL_VERIFY=false to disable SSL certificate verification
// - This is useful for self-signed certificates in development/testing
// - In production, use proper CA-signed certificates when possible
//
export const backendConfig = {
  // Server settings
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
  },

  // Elasticsearch/OpenSearch connection
  elasticsearch: {
    url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    username: process.env.ELASTICSEARCH_USERNAME,
    password: process.env.ELASTICSEARCH_PASSWORD,
    apiKey: process.env.ELASTICSEARCH_API_KEY,
    cloudId: process.env.ELASTICSEARCH_CLOUD_ID,
    // SSL/TLS settings
    ssl: {
      rejectUnauthorized: process.env.ELASTICSEARCH_SSL_VERIFY !== 'false', // Default to false for self-signed certs
      requestCert: false,
      checkServerIdentity: false,
    },
    // Connection pool settings
    maxConnections: parseInt(process.env.ELASTICSEARCH_MAX_CONNECTIONS || '10'),
    requestTimeout: parseInt(process.env.ELASTICSEARCH_REQUEST_TIMEOUT || '30000'),
    pingTimeout: parseInt(process.env.ELASTICSEARCH_PING_TIMEOUT || '3000'),
  },

  // CORS settings for production
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: process.env.CORS_CREDENTIALS === 'true',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  },

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'), // requests per window
    message: 'Too many requests from this IP, please try again later.',
  },

  // Security settings
  security: {
    enableHttps: process.env.ENABLE_HTTPS === 'true',
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    sessionSecret: process.env.SESSION_SECRET || 'your-session-secret',
    allowedIPs: process.env.ALLOWED_IPS?.split(',') || [],
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableAccessLog: process.env.ENABLE_ACCESS_LOG === 'true',
    logToFile: process.env.LOG_TO_FILE === 'true',
    logFile: process.env.LOG_FILE || './logs/backend.log',
  },

  // Monitoring
  monitoring: {
    enableHealthCheck: true,
    healthCheckPath: '/api/health',
    enableMetrics: process.env.ENABLE_METRICS === 'true',
    metricsPath: '/api/metrics',
  },

  // Cache settings
  cache: {
    enabled: process.env.CACHE_ENABLED === 'true',
    type: process.env.CACHE_TYPE || 'memory', // memory, redis
    ttl: parseInt(process.env.CACHE_TTL || '300'), // seconds
    maxSize: parseInt(process.env.CACHE_MAX_SIZE || '100'), // MB
  },

  // API versioning
  api: {
    version: 'v1',
    prefix: '/api',
    enableVersioning: process.env.ENABLE_API_VERSIONING === 'true',
  },
};

// Environment validation
export function validateEnvironment() {
  const required = ['ELASTICSEARCH_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// Database connection pool management
export class ConnectionPool {
  private static instance: ConnectionPool;
  private connections: Map<string, any> = new Map();
  
  static getInstance(): ConnectionPool {
    if (!ConnectionPool.instance) {
      ConnectionPool.instance = new ConnectionPool();
    }
    return ConnectionPool.instance;
  }
  
  getConnection(key: string) {
    return this.connections.get(key);
  }
  
  setConnection(key: string, connection: any) {
    this.connections.set(key, connection);
  }
  
  closeAll() {
    this.connections.clear();
  }
}
