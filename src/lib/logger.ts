// Simple production-ready logging utility
// Alternative to Sentry for Next.js 15 compatibility

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
  userId?: string;
  sessionId?: string;
}

class Logger {
  private level: LogLevel;
  private isDevelopment: boolean;

  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private formatLog(entry: LogEntry): string {
    return JSON.stringify({
      ...entry,
      environment: process.env.NODE_ENV,
      service: 'indexsphere',
    });
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    if (error) {
      entry.stack = error.stack;
    }

    if (this.isDevelopment) {
      // Pretty print for development
      console[level](message, context, error);
    } else {
      // Structured logging for production
      console.log(this.formatLog(entry));
    }

    // In production, you could send to external logging service
    if (process.env.NODE_ENV === 'production' && level === 'error') {
      this.sendToExternalService(entry);
    }
  }

  private async sendToExternalService(entry: LogEntry) {
    // Example: Send to external logging service
    // You can integrate with LogRocket, DataDog, or custom webhook
    try {
      if (process.env.WEBHOOK_URL) {
        await fetch(process.env.WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
      }
    } catch (error) {
      console.error('Failed to send log to external service:', error);
    }
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>, error?: Error) {
    this.log('error', message, context, error);
  }

  // Elasticsearch specific logging
  esRequest(endpoint: string, method: string, duration: number, statusCode: number) {
    this.info('Elasticsearch request', {
      endpoint,
      method,
      duration,
      statusCode,
      type: 'elasticsearch_request',
    });
  }

  esError(endpoint: string, method: string, error: Error) {
    this.error('Elasticsearch request failed', {
      endpoint,
      method,
      type: 'elasticsearch_error',
    }, error);
  }

  // Security events
  securityEvent(event: string, details: Record<string, unknown>) {
    this.warn('Security event', {
      event,
      ...details,
      type: 'security_event',
    });
  }

  // Performance monitoring
  performance(operation: string, duration: number, metadata?: Record<string, unknown>) {
    this.info('Performance metric', {
      operation,
      duration,
      ...metadata,
      type: 'performance',
    });
  }
}

// Singleton instance
export const logger = new Logger();

// Error boundary helper
export function captureException(error: Error, context?: Record<string, unknown>) {
  logger.error('Unhandled exception', context, error);
}
