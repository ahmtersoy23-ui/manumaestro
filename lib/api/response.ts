/**
 * API Response Helpers
 * Standardized response formatting for API routes
 */

import { NextResponse } from 'next/server';
import { ApiError } from './errors';
import { createLogger } from '@/lib/logger';

const logger = createLogger('API Response');

/**
 * Success response helper
 */
export function successResponse<T>(data: T, meta?: Record<string, unknown>, status: number = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
      ...(meta && { meta }),
    },
    { status }
  );
}

/**
 * Created response helper (201)
 */
export function createdResponse<T>(data: T, meta?: Record<string, unknown>) {
  return successResponse(data, meta, 201);
}

/**
 * No content response helper (204)
 */
export function noContentResponse() {
  return new NextResponse(null, { status: 204 });
}

/**
 * Error response helper
 */
export function errorResponse(
  error: unknown,
  fallbackMessage: string = 'An error occurred',
  fallbackStatus: number = 500
): NextResponse {
  // Handle ApiError instances
  if (error instanceof ApiError) {
    const response = {
      success: false,
      error: {
        message: error.message,
        code: error.code,
        ...(error.details && { details: error.details }),
      },
    };

    // Log errors (but not client errors like 400, 401, 403, 404)
    if (error.statusCode >= 500) {
      logger.error('API Error:', {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        details: error.details,
      });
    }

    return NextResponse.json(response, { status: error.statusCode });
  }

  // Handle standard Error instances
  if (error instanceof Error) {
    logger.error('Unexpected error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          message: process.env.NODE_ENV === 'production' ? fallbackMessage : error.message,
          code: 'INTERNAL_ERROR',
        },
      },
      { status: fallbackStatus }
    );
  }

  // Handle unknown errors
  logger.error('Unknown error type:', error);

  return NextResponse.json(
    {
      success: false,
      error: {
        message: fallbackMessage,
        code: 'UNKNOWN_ERROR',
      },
    },
    { status: fallbackStatus }
  );
}

/**
 * Pagination metadata helper
 */
export function createPaginationMeta(
  page: number,
  limit: number,
  total: number
) {
  const totalPages = Math.ceil(total / limit);

  return {
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}
