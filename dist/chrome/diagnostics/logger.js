/**
 * Moment Diagnostics & Logging
 * In-memory structured logging with zero network telemetry.
 */
export class Logger {
    component;
    static ringBuffer = [];
    static MAX_BUFFER_SIZE = 100;
    constructor(component) {
        this.component = component;
    }
    log(level, message, context) {
        const entry = {
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
        }
        else if (level === 'WARN') {
            console.warn(formatted, context ?? '');
        }
        else if (level === 'INFO') {
            console.info(formatted, context ?? '');
        }
        else {
            console.debug(formatted, context ?? '');
        }
    }
    debug(message, context) {
        this.log('DEBUG', message, context);
    }
    info(message, context) {
        this.log('INFO', message, context);
    }
    warn(message, context) {
        this.log('WARN', message, context);
    }
    error(message, context) {
        this.log('ERROR', message, context);
    }
    static getRecentLogs() {
        return [...this.ringBuffer];
    }
    static clearLogs() {
        this.ringBuffer = [];
    }
}
