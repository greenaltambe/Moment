/**
 * Moment Diagnostics & Logging
 * In-memory structured logging with zero network telemetry.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly component: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
}

export class Logger {
  private component: string;
  private static ringBuffer: LogEntry[] = [];
  private static readonly MAX_BUFFER_SIZE = 100;

  constructor(component: string) {
    this.component = component;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component: this.component,
      message,
      context,
    };

    Logger.ringBuffer.push(entry);
    if (Logger.ringBuffer.length > Logger.MAX_BUFFER_SIZE) {
      Logger.ringBuffer.shift();
    }

    const formatted = `[Moment:${this.component}] [${level}] ${message}`;
    if (level === 'ERROR') {
      console.error(formatted, context ?? '');
    } else if (level === 'WARN') {
      console.warn(formatted, context ?? '');
    } else if (level === 'INFO') {
      console.info(formatted, context ?? '');
    } else {
      console.debug(formatted, context ?? '');
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('ERROR', message, context);
  }

  static getRecentLogs(): readonly LogEntry[] {
    return [...this.ringBuffer];
  }

  static clearLogs(): void {
    this.ringBuffer = [];
  }
}
