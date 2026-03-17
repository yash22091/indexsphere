import fs from 'fs';
import path from 'path';

interface IndexsphereConfig {
  // Server configuration
  server: {
    port: number;
    host: string;
    cors: {
      enabled: boolean;
      origins: string[];
    };
    rateLimit: {
      enabled: boolean;
      windowMs: number;
      maxRequests: number;
    };
  };

  // Database configuration
  database: {
    path: string;
    backupInterval: number; // in hours
    maxBackups: number;
  };

  // Security configuration
  security: {
    jwtSecret: string;
    jwtExpiresIn: string;
    bcryptRounds: number;
    sessionTimeout: number; // in minutes
    maxLoginAttempts: number;
    lockoutDuration: number; // in minutes
    auditLogging: boolean;
    requireStrongPasswords: boolean;
  };

  // Elasticsearch/OpenSearch configuration
  elasticsearch: {
    connectionTimeout: number; // in ms
    requestTimeout: number; // in ms
    maxRetries: number;
    retryDelay: number; // in ms
    defaultType: 'elasticsearch' | 'opensearch';
  };

  // Logging configuration
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    file: {
      enabled: boolean;
      path: string;
      maxSize: string;
      maxFiles: number;
    };
    console: {
      enabled: boolean;
      colorize: boolean;
    };
  };

  // Application features
  features: {
    userManagement: boolean;
    savedConnections: boolean;
    clusterAnalysis: boolean;
    indexManagement: boolean;
    templateManagement: boolean;
    snapshotManagement: boolean;
    queryInterface: boolean;
    restInterface: boolean;
  };

  // Debug configuration
  debug: {
    enabled: boolean;
    level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
    components: {
      authentication: boolean;
      database: boolean;
      elasticsearch: boolean;
      api: boolean;
      userManagement: boolean;
    };
  };

  // UI configuration
  ui: {
    theme: 'light' | 'dark' | 'auto';
    pageSize: number;
    autoRefresh: {
      enabled: boolean;
      interval: number; // in seconds
    };
    notifications: {
      enabled: boolean;
      position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
      duration: number; // in ms
    };
  };
}

const DEFAULT_CONFIG: IndexsphereConfig = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    cors: {
      enabled: true,
      origins: ['*']
    },
    rateLimit: {
      enabled: true,
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 100
    }
  },

  database: {
    path: './data/indexsphere.db',
    backupInterval: 24, // 24 hours
    maxBackups: 7
  },

  security: {
    jwtSecret: (() => {
      // Skip JWT_SECRET validation during Next.js build phase
      if (process.env.NEXT_PHASE === 'phase-production-build') {
        return 'build-time-placeholder-not-used-for-signing';
      }
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error(
            '[IndexSphere] JWT_SECRET environment variable is required in production. ' +
            'Set it to a random string of at least 32 characters.'
          );
        }
        // Development only: generate a session-scoped random secret and warn.
        const devSecret = require('crypto').randomBytes(32).toString('hex');
        console.warn(
          '\n⚠️  JWT_SECRET is not set. Using a randomly generated secret for this ' +
          'session. All existing sessions will be invalidated on restart. ' +
          'Set JWT_SECRET in your .env.local file to fix this.\n'
        );
        return devSecret;
      }
      if (secret.length < 32) {
        throw new Error(
          '[IndexSphere] JWT_SECRET must be at least 32 characters long.'
        );
      }
      return secret;
    })(),
    jwtExpiresIn: '24h',
    bcryptRounds: 12,
    sessionTimeout: 480, // 8 hours
    maxLoginAttempts: 5,
    lockoutDuration: 15, // 15 minutes
    auditLogging: true,
    requireStrongPasswords: false
  },

  elasticsearch: {
    connectionTimeout: 10000,
    requestTimeout: 30000,
    maxRetries: 3,
    retryDelay: 1000,
    defaultType: 'elasticsearch'
  },

  logging: {
    level: 'info',
    file: {
      enabled: true,
      path: './logs/indexsphere.log',
      maxSize: '10M',
      maxFiles: 5
    },
    console: {
      enabled: true,
      colorize: true
    }
  },

  features: {
    userManagement: true,
    savedConnections: true,
    clusterAnalysis: true,
    indexManagement: true,
    templateManagement: true,
    snapshotManagement: true,
    queryInterface: true,
    restInterface: true
  },

  debug: {
    enabled: false,
    level: 'info',
    components: {
      authentication: false,
      database: false,
      elasticsearch: false,
      api: false,
      userManagement: false
    }
  },

  ui: {
    theme: 'auto',
    pageSize: 25,
    autoRefresh: {
      enabled: false,
      interval: 30
    },
    notifications: {
      enabled: true,
      position: 'top-right',
      duration: 5000
    }
  }
};

class ConfigManager {
  private config: IndexsphereConfig;
  private configPath: string;

  constructor() {
    this.configPath = this.getConfigPath();
    this.config = this.loadConfig();
  }

  private getConfigPath(): string {
    // Check environment variable first
    if (process.env.INDEXSPHERE_CONFIG) {
      return process.env.INDEXSPHERE_CONFIG;
    }

    // Check common locations
    const possiblePaths = [
      path.join(process.cwd(), 'indexsphere.json'),
      path.join(process.cwd(), 'config', 'indexsphere.json'),
      '/etc/indexsphere/config.json',
      '/usr/local/etc/indexsphere/config.json'
    ];

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }

    // Default to current directory
    return path.join(process.cwd(), 'indexsphere.json');
  }

  private loadConfig(): IndexsphereConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const configContent = fs.readFileSync(this.configPath, 'utf8');
        const userConfig = JSON.parse(configContent) as Partial<IndexsphereConfig>;
        
        // Deep merge with defaults
        const mergedConfig = this.deepMerge(DEFAULT_CONFIG, userConfig);
        
        console.log(`Configuration loaded from: ${this.configPath}`);
        return mergedConfig;
      } else {
        console.log('No configuration file found, creating default configuration...');
        this.createDefaultConfig();
        return DEFAULT_CONFIG;
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
      console.log('Using default configuration...');
      return DEFAULT_CONFIG;
    }
  }

  private createDefaultConfig(): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const jsonContent = JSON.stringify(DEFAULT_CONFIG, null, 2);

      fs.writeFileSync(this.configPath, jsonContent, 'utf8');
      console.log(`Default configuration created at: ${this.configPath}`);
    } catch (error) {
      console.error('Error creating default configuration:', error);
    }
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  public get(): IndexsphereConfig {
    return this.config;
  }

  public reload(): void {
    this.config = this.loadConfig();
  }

  public update(newConfig: Partial<IndexsphereConfig>): void {
    this.config = this.deepMerge(this.config, newConfig);
    this.save();
  }

  public save(): void {
    try {
      const jsonContent = JSON.stringify(this.config, null, 2);
      
      fs.writeFileSync(this.configPath, jsonContent, 'utf8');
      console.log('Configuration saved successfully');
    } catch (error) {
      console.error('Error saving configuration:', error);
    }
  }

  public getConfigFilePath(): string {
    return this.configPath;
  }

  // Environment variable overrides
  public applyEnvironmentOverrides(): void {
    const envOverrides: Partial<IndexsphereConfig> = {};

    // Server overrides
    if (process.env.PORT) {
      envOverrides.server = { ...this.config.server, port: parseInt(process.env.PORT) };
    }
    if (process.env.HOST) {
      envOverrides.server = { ...envOverrides.server, ...this.config.server, host: process.env.HOST };
    }

    // Database overrides
    if (process.env.INDEXSPHERE_DB_PATH) {
      envOverrides.database = { ...this.config.database, path: process.env.INDEXSPHERE_DB_PATH };
    }

    // Security overrides
    if (process.env.JWT_SECRET) {
      envOverrides.security = { ...this.config.security, jwtSecret: process.env.JWT_SECRET };
    }

    // Logging overrides
    if (process.env.LOG_LEVEL) {
      envOverrides.logging = { 
        ...this.config.logging, 
        level: process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug'
      };
    }

    if (Object.keys(envOverrides).length > 0) {
      this.config = this.deepMerge(this.config, envOverrides);
      console.log('Applied environment variable overrides');
    }
  }

  // Validation
  public validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate required fields
    if (!this.config.security.jwtSecret || this.config.security.jwtSecret.length < 32) {
      errors.push('JWT secret must be at least 32 characters long');
    }

    if (this.config.server.port < 1 || this.config.server.port > 65535) {
      errors.push('Server port must be between 1 and 65535');
    }

    if (this.config.security.bcryptRounds < 10 || this.config.security.bcryptRounds > 15) {
      errors.push('Bcrypt rounds should be between 10 and 15 for security and performance');
    }

    // Validate paths
    const dbDir = path.dirname(this.config.database.path);
    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
    } catch (error) {
      errors.push(`Cannot create database directory: ${dbDir}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Singleton instance
let configManager: ConfigManager | null = null;

export function getConfig(): IndexsphereConfig {
  if (!configManager) {
    configManager = new ConfigManager();
    configManager.applyEnvironmentOverrides();

    // Skip strict validation at build time — JWT_SECRET is injected at runtime
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const validation = configManager.validate();
      if (!validation.valid) {
        console.error('Configuration validation failed:');
        validation.errors.forEach(error => console.error(`  - ${error}`));
        process.exit(1);
      }
    }
  }
  return configManager.get();
}

export function reloadConfig(): void {
  if (configManager) {
    configManager.reload();
    configManager.applyEnvironmentOverrides();
  }
}

export function updateConfig(newConfig: Partial<IndexsphereConfig>): void {
  if (!configManager) {
    configManager = new ConfigManager();
  }
  configManager.update(newConfig);
}

export type { IndexsphereConfig };
