/**
 * API Error Classes
 * Standardized error handling for API routes
 */

/**
 * Base API Error class
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: Record<string, unknown> | Record<string, unknown>[] | string
  ) {
    super(message);
    this.name = 'ApiError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request - Validation errors
 */
export class ValidationError extends ApiError {
  constructor(message: string = 'Doğrulama hatası', details?: Record<string, unknown> | Record<string, unknown>[] | string) {
    super(400, message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * 401 Unauthorized - Authentication errors
 */
export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Yetkisiz erişim') {
    super(401, message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

/**
 * 403 Forbidden - Permission errors
 */
export class ForbiddenError extends ApiError {
  constructor(message: string = 'Erişim engellendi') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

/**
 * 404 Not Found - Resource not found
 */
export class NotFoundError extends ApiError {
  constructor(resource: string = 'Kaynak') {
    super(404, `${resource} bulunamadı`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * 409 Conflict - Resource conflict
 */
export class ConflictError extends ApiError {
  constructor(message: string = 'Kaynak çakışması') {
    super(409, message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

/**
 * 500 Internal Server Error
 */
export class InternalServerError extends ApiError {
  constructor(message: string = 'Sunucu hatası', details?: Record<string, unknown> | Record<string, unknown>[] | string) {
    super(500, message, 'INTERNAL_ERROR', details);
    this.name = 'InternalServerError';
  }
}

/**
 * 503 Service Unavailable
 */
export class ServiceUnavailableError extends ApiError {
  constructor(message: string = 'Servis geçici olarak kullanılamıyor') {
    super(503, message, 'SERVICE_UNAVAILABLE');
    this.name = 'ServiceUnavailableError';
  }
}
