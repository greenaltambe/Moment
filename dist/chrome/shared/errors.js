/**
 * Moment Domain Errors
 */
export class MomentError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MomentError';
    }
}
export class ValidationError extends MomentError {
    constructor(message) {
        super(`Validation Error: ${message}`);
        this.name = 'ValidationError';
    }
}
export class SecurityError extends MomentError {
    constructor(message) {
        super(`Security Error: ${message}`);
        this.name = 'SecurityError';
    }
}
