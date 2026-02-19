/**
 * API Error Classes Tests
 * Tests for standardized error handling classes
 */

import { describe, it, expect } from 'vitest';
import {
  ApiError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
  ServiceUnavailableError,
} from '@/lib/api/errors';

describe('API Error Classes', () => {
  describe('ApiError', () => {
    it('should create error with all properties', () => {
      const error = new ApiError(400, 'Bad Request', 'BAD_REQUEST', { field: 'email' });
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Bad Request');
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.details).toEqual({ field: 'email' });
      expect(error.name).toBe('ApiError');
    });

    it('should be an instance of Error', () => {
      const error = new ApiError(500, 'Server Error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should work without optional fields', () => {
      const error = new ApiError(500, 'Server Error');
      expect(error.code).toBeUndefined();
      expect(error.details).toBeUndefined();
    });
  });

  describe('ValidationError', () => {
    it('should create 400 error with default message', () => {
      const error = new ValidationError();
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.name).toBe('ValidationError');
    });

    it('should accept custom message and details', () => {
      const error = new ValidationError('Invalid email', { field: 'email' });
      expect(error.message).toBe('Invalid email');
      expect(error.details).toEqual({ field: 'email' });
    });

    it('should be an instance of ApiError', () => {
      const error = new ValidationError();
      expect(error).toBeInstanceOf(ApiError);
    });
  });

  describe('UnauthorizedError', () => {
    it('should create 401 error with default message', () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Unauthorized');
      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.name).toBe('UnauthorizedError');
    });

    it('should accept custom message', () => {
      const error = new UnauthorizedError('Token expired');
      expect(error.message).toBe('Token expired');
    });
  });

  describe('ForbiddenError', () => {
    it('should create 403 error with default message', () => {
      const error = new ForbiddenError();
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Forbidden');
      expect(error.code).toBe('FORBIDDEN');
      expect(error.name).toBe('ForbiddenError');
    });

    it('should accept custom message', () => {
      const error = new ForbiddenError('Admin access required');
      expect(error.message).toBe('Admin access required');
    });
  });

  describe('NotFoundError', () => {
    it('should create 404 error with default resource name', () => {
      const error = new NotFoundError();
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Resource not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.name).toBe('NotFoundError');
    });

    it('should include custom resource name in message', () => {
      const error = new NotFoundError('User');
      expect(error.message).toBe('User not found');
    });

    it('should include custom resource name in message', () => {
      const error = new NotFoundError('Marketplace');
      expect(error.message).toBe('Marketplace not found');
    });
  });

  describe('ConflictError', () => {
    it('should create 409 error with default message', () => {
      const error = new ConflictError();
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Resource conflict');
      expect(error.code).toBe('CONFLICT');
      expect(error.name).toBe('ConflictError');
    });

    it('should accept custom message', () => {
      const error = new ConflictError('Duplicate entry');
      expect(error.message).toBe('Duplicate entry');
    });
  });

  describe('InternalServerError', () => {
    it('should create 500 error with default message', () => {
      const error = new InternalServerError();
      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Internal server error');
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.name).toBe('InternalServerError');
    });

    it('should accept custom message and details', () => {
      const error = new InternalServerError('DB connection failed', { db: 'postgres' });
      expect(error.message).toBe('DB connection failed');
      expect(error.details).toEqual({ db: 'postgres' });
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should create 503 error with default message', () => {
      const error = new ServiceUnavailableError();
      expect(error.statusCode).toBe(503);
      expect(error.message).toBe('Service temporarily unavailable');
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(error.name).toBe('ServiceUnavailableError');
    });

    it('should accept custom message', () => {
      const error = new ServiceUnavailableError('Maintenance mode');
      expect(error.message).toBe('Maintenance mode');
    });
  });

  describe('Error hierarchy', () => {
    it('all error subclasses should be instances of ApiError and Error', () => {
      const errors = [
        new ValidationError(),
        new UnauthorizedError(),
        new ForbiddenError(),
        new NotFoundError(),
        new ConflictError(),
        new InternalServerError(),
        new ServiceUnavailableError(),
      ];

      errors.forEach((error) => {
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toBeInstanceOf(Error);
      });
    });
  });
});
