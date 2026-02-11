/**
 * Rate Limiting Middleware
 * IP-based rate limiting for API endpoints
 *
 * Usage:
 * import { createRateLimiter } from '@/lib/middleware/rateLimit';
 * const limiter = createRateLimiter({ maxRequests: 100, windowMs: 60000 });
 * const result = await limiter.check(request);
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Rate Limiter');

interface RateLimitConfig {
  maxRequests: number;  // Maximum number of requests
  windowMs: number;     // Time window in milliseconds
}

interface RateLimitStore {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting
// Note: For production scale, consider Redis
const store = new Map<string, RateLimitStore>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (value.resetTime < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Get client identifier from request
 */
function getClientId(request: NextRequest): string {
  // Try to get real IP from various headers (for proxy/load balancer scenarios)
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip'); // Cloudflare

  if (forwardedFor) {
    // x-forwarded-for can be comma-separated list
    return forwardedFor.split(',')[0].trim();
  }

  if (realIp) {
    return realIp;
  }

  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // Fallback to user email from SSO (if available)
  const userEmail = request.headers.get('x-user-email');
  if (userEmail) {
    return `user:${userEmail}`;
  }

  // Last resort: use a generic identifier
  return 'unknown';
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * Create a rate limiter with specific configuration
 */
export function createRateLimiter(config: RateLimitConfig) {
  return {
    /**
     * Check if request should be rate limited
     */
    async check(request: NextRequest, keyPrefix?: string): Promise<RateLimitResult> {
      const clientId = getClientId(request);
      const key = keyPrefix ? `${keyPrefix}:${clientId}` : clientId;
      const now = Date.now();

      let record = store.get(key);

      // Initialize or reset if window expired
      if (!record || record.resetTime < now) {
        record = {
          count: 0,
          resetTime: now + config.windowMs,
        };
      }

      // Increment count
      record.count++;
      store.set(key, record);

      const remaining = Math.max(0, config.maxRequests - record.count);
      const isAllowed = record.count <= config.maxRequests;

      const result: RateLimitResult = {
        success: isAllowed,
        limit: config.maxRequests,
        remaining,
        resetTime: record.resetTime,
      };

      if (!isAllowed) {
        result.retryAfter = Math.ceil((record.resetTime - now) / 1000);
        logger.warn('Rate limit exceeded', {
          clientId,
          key,
          count: record.count,
          limit: config.maxRequests,
          retryAfter: result.retryAfter,
        });
      }

      return result;
    },

    /**
     * Add rate limit headers to response
     */
    addHeaders(response: NextResponse, result: RateLimitResult): NextResponse {
      response.headers.set('X-RateLimit-Limit', result.limit.toString());
      response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
      response.headers.set('X-RateLimit-Reset', result.resetTime.toString());

      if (result.retryAfter) {
        response.headers.set('Retry-After', result.retryAfter.toString());
      }

      return response;
    },
  };
}

/**
 * Pre-configured rate limiters for different endpoint types
 */
export const rateLimiters = {
  // Bulk operations: 10 requests per minute
  bulk: createRateLimiter({
    maxRequests: 10,
    windowMs: 60 * 1000,
  }),

  // Write operations: 100 requests per minute
  write: createRateLimiter({
    maxRequests: 100,
    windowMs: 60 * 1000,
  }),

  // Read operations: 200 requests per minute
  read: createRateLimiter({
    maxRequests: 200,
    windowMs: 60 * 1000,
  }),
};

/**
 * Rate limit response helper
 */
export function rateLimitExceededResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        message: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        details: {
          limit: result.limit,
          retryAfter: result.retryAfter,
          resetTime: new Date(result.resetTime).toISOString(),
        },
      },
    },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': result.resetTime.toString(),
        'Retry-After': result.retryAfter?.toString() || '60',
      },
    }
  );
}
