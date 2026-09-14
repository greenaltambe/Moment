/**
 * Moment Domain Errors
 */

export class MomentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MomentError';
  }
}

export class ValidationError extends MomentError {
  constructor(message: string) {
    super(`Validation Error: ${message}`);
    this.name = 'ValidationError';
  }
}

export class SecurityError extends MomentError {
  constructor(message: string) {
    super(`Security Error: ${message}`);
    this.name = 'SecurityError';
  }
}
