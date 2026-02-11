/**
 * API Response Helpers Tests
 */

import { describe, it, expect } from 'vitest';
import {
  successResponse,
  createdResponse,
  noContentResponse,
  errorResponse,
  createPaginationMeta,
} from '@/lib/api/response';
import {
  ApiError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
} from '@/lib/api/errors';

describe('API Response Helpers', () => {
  describe('successResponse', () => {
    it('should create success response with data', () => {
      const data = { id: 1, name: 'Test' };
      const response = successResponse(data);

      expect(response.status).toBe(200);

      // Parse JSON body
      response.json().then((body: any) => {
        expect(body.success).toBe(true);
        expect(body.data).toEqual(data);
      });
    });

    it('should include metadata when provided', () => {
      const data = { id: 1 };
      const meta = { page: 1, total: 10 };
      const response = successResponse(data, meta);

      response.json().then((body: any) => {
        expect(body.meta).toEqual(meta);
      });
    });

    it('should use custom status code', () => {
      const response = successResponse({ id: 1 }, undefined, 201);
      expect(response.status).toBe(201);
    });
  });

  describe('createdResponse', () => {
    it('should create 201 response', () => {
      const data = { id: 1 };
      const response = createdResponse(data);
      expect(response.status).toBe(201);
    });
  });

  describe('noContentResponse', () => {
    it('should create 204 response', () => {
      const response = noContentResponse();
      expect(response.status).toBe(204);
    });
  });

  describe('errorResponse', () => {
    it('should handle ApiError instances', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });
      const response = errorResponse(error);

      expect(response.status).toBe(400);

      response.json().then((body: any) => {
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Invalid input');
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(body.error.details).toEqual({ field: 'email' });
      });
    });

    it('should handle NotFoundError', () => {
      const error = new NotFoundError('User');
      const response = errorResponse(error);

      expect(response.status).toBe(404);

      response.json().then((body: any) => {
        expect(body.error.message).toBe('User not found');
        expect(body.error.code).toBe('NOT_FOUND');
      });
    });

    it('should handle UnauthorizedError', () => {
      const error = new UnauthorizedError();
      const response = errorResponse(error);

      expect(response.status).toBe(401);
    });

    it('should handle standard Error instances', () => {
      const error = new Error('Something went wrong');
      const response = errorResponse(error);

      expect(response.status).toBe(500);

      response.json().then((body: any) => {
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
      });
    });

    it('should handle unknown errors', () => {
      const error = 'string error';
      const response = errorResponse(error);

      expect(response.status).toBe(500);

      response.json().then((body: any) => {
        expect(body.error.code).toBe('UNKNOWN_ERROR');
      });
    });
  });

  describe('createPaginationMeta', () => {
    it('should create correct pagination metadata', () => {
      const meta = createPaginationMeta(2, 10, 45);

      expect(meta.pagination.page).toBe(2);
      expect(meta.pagination.limit).toBe(10);
      expect(meta.pagination.total).toBe(45);
      expect(meta.pagination.totalPages).toBe(5);
      expect(meta.pagination.hasNextPage).toBe(true);
      expect(meta.pagination.hasPreviousPage).toBe(true);
    });

    it('should handle first page correctly', () => {
      const meta = createPaginationMeta(1, 10, 45);

      expect(meta.pagination.hasPreviousPage).toBe(false);
      expect(meta.pagination.hasNextPage).toBe(true);
    });

    it('should handle last page correctly', () => {
      const meta = createPaginationMeta(5, 10, 45);

      expect(meta.pagination.hasPreviousPage).toBe(true);
      expect(meta.pagination.hasNextPage).toBe(false);
    });

    it('should handle single page correctly', () => {
      const meta = createPaginationMeta(1, 10, 5);

      expect(meta.pagination.totalPages).toBe(1);
      expect(meta.pagination.hasPreviousPage).toBe(false);
      expect(meta.pagination.hasNextPage).toBe(false);
    });
  });
});
