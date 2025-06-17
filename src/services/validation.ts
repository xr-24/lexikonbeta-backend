import validator from 'validator';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// Create a DOMPurify instance for server-side use
const window = new JSDOM('').window;
const purify = DOMPurify(window);

export interface ValidationResult {
  isValid: boolean;
  sanitized: string;
  errors: string[];
}

export class ValidationUtils {
  static validatePlayerName(name: any): ValidationResult {
    const errors: string[] = [];
    
    // Type check
    if (typeof name !== 'string') {
      return {
        isValid: false,
        sanitized: '',
        errors: ['Player name must be a string']
      };
    }

    // Length validation
    if (name.length < 1) {
      errors.push('Player name cannot be empty');
    }
    if (name.length > 20) {
      errors.push('Player name cannot exceed 20 characters');
    }

    // Basic character validation
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
      errors.push('Player name contains invalid characters');
    }

    // Sanitize
    const escaped = validator.escape(name);
    const sanitized = purify.sanitize(escaped).trim();

    return {
      isValid: errors.length === 0,
      sanitized,
      errors
    };
  }

  static validateChatMessage(message: any): ValidationResult {
    const errors: string[] = [];
    
    // Type check
    if (typeof message !== 'string') {
      return {
        isValid: false,
        sanitized: '',
        errors: ['Chat message must be a string']
      };
    }

    // Length validation
    if (message.length > 500) {
      errors.push('Chat message cannot exceed 500 characters');
    }

    // Basic sanitization
    const sanitized = purify.sanitize(message).trim();

    return {
      isValid: errors.length === 0,
      sanitized,
      errors
    };
  }

  static validateRoomCode(code: any): ValidationResult {
    const errors: string[] = [];
    
    // Type check
    if (typeof code !== 'string') {
      return {
        isValid: false,
        sanitized: '',
        errors: ['Room code must be a string']
      };
    }

    // Format validation
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      errors.push('Room code must be 6 alphanumeric characters');
    }

    // Sanitize
    const sanitized = validator.escape(code).toUpperCase();

    return {
      isValid: errors.length === 0,
      sanitized,
      errors
    };
  }

  static validateBoardPosition(row: any, col: any): { isValid: boolean; row: number; col: number; errors: string[] } {
    const errors: string[] = [];
    
    // Type and range validation
    if (!Number.isInteger(row) || row < 0 || row >= 15) {
      errors.push('Invalid row position');
    }
    if (!Number.isInteger(col) || col < 0 || col >= 15) {
      errors.push('Invalid column position');
    }

    return {
      isValid: errors.length === 0,
      row: Math.floor(row),
      col: Math.floor(col),
      errors
    };
  }
}

// Rate limiting utilities
export class RateLimiter {
  private static instances = new Map<string, Map<string, number>>();

  static checkLimit(socketId: string, action: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    
    if (!this.instances.has(action)) {
      this.instances.set(action, new Map());
    }
    
    const actionMap = this.instances.get(action)!;
    const lastRequest = actionMap.get(socketId) || 0;
    
    // Clean up old entries periodically
    if (Math.random() < 0.01) { // 1% chance to clean up
      this.cleanup(action, windowMs);
    }
    
    if (now - lastRequest < windowMs / maxRequests) {
      return false; // Rate limit exceeded
    }
    
    actionMap.set(socketId, now);
    return true;
  }

  private static cleanup(action: string, windowMs: number): void {
    const now = Date.now();
    const actionMap = this.instances.get(action);
    if (!actionMap) return;

    for (const [socketId, timestamp] of actionMap.entries()) {
      if (now - timestamp > windowMs) {
        actionMap.delete(socketId);
      }
    }
  }
}
