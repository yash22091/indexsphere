import { getConfig } from './config';

type DebugComponent = 'authentication' | 'database' | 'elasticsearch' | 'api' | 'userManagement';
type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

class DebugLogger {
  private static instance: DebugLogger;
  private config: any;

  constructor() {
    this.config = getConfig();
  }

  static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger();
    }
    return DebugLogger.instance;
  }

  private shouldLog(component: DebugComponent, level: LogLevel = 'debug'): boolean {
    if (!this.config.debug.enabled) return false;
    if (!this.config.debug.components[component]) return false;
    
    const levels = ['error', 'warn', 'info', 'debug', 'trace'];
    const configLevelIndex = levels.indexOf(this.config.debug.level);
    const requestedLevelIndex = levels.indexOf(level);
    
    return requestedLevelIndex <= configLevelIndex;
  }

  private formatMessage(component: DebugComponent, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${component.toUpperCase()}]`;
    
    if (data) {
      return `${prefix} ${message}\n${JSON.stringify(data, null, 2)}`;
    }
    return `${prefix} ${message}`;
  }

  error(component: DebugComponent, message: string, data?: any): void {
    if (this.shouldLog(component, 'error')) {
      console.error('❌', this.formatMessage(component, message, data));
    }
  }

  warn(component: DebugComponent, message: string, data?: any): void {
    if (this.shouldLog(component, 'warn')) {
      console.warn('⚠️', this.formatMessage(component, message, data));
    }
  }

  info(component: DebugComponent, message: string, data?: any): void {
    if (this.shouldLog(component, 'info')) {
      console.info('ℹ️', this.formatMessage(component, message, data));
    }
  }

  debug(component: DebugComponent, message: string, data?: any): void {
    if (this.shouldLog(component, 'debug')) {
      console.log('🔍', this.formatMessage(component, message, data));
    }
  }

  trace(component: DebugComponent, message: string, data?: any): void {
    if (this.shouldLog(component, 'trace')) {
      console.log('🔬', this.formatMessage(component, message, data));
    }
  }

  // Convenience methods for common scenarios
  auth = {
    login: (message: string, data?: any) => this.debug('authentication', `🔐 LOGIN: ${message}`, data),
    verify: (message: string, data?: any) => this.debug('authentication', `🔍 VERIFY: ${message}`, data),
    error: (message: string, data?: any) => this.error('authentication', `❌ AUTH ERROR: ${message}`, data),
    success: (message: string, data?: any) => this.info('authentication', `✅ AUTH SUCCESS: ${message}`, data)
  };

  api = {
    request: (method: string, path: string, data?: any) => 
      this.debug('api', `📡 ${method} ${path}`, data),
    response: (status: number, message: string, data?: any) => 
      this.debug('api', `📤 Response ${status}: ${message}`, data),
    error: (message: string, data?: any) => this.error('api', `❌ API ERROR: ${message}`, data)
  };

  db = {
    query: (message: string, data?: any) => this.debug('database', `💾 DB: ${message}`, data),
    error: (message: string, data?: any) => this.error('database', `❌ DB ERROR: ${message}`, data)
  };

  user = {
    action: (message: string, data?: any) => this.debug('userManagement', `👥 USER: ${message}`, data),
    error: (message: string, data?: any) => this.error('userManagement', `❌ USER ERROR: ${message}`, data)
  };
}

export const debugLog = DebugLogger.getInstance();
export default debugLog;
