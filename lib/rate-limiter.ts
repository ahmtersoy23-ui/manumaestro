/**
 * Rate Limiter for Next.js Middleware (Edge Runtime compatible)
 *
 * This implementation uses an in-memory store for simplicity.
 * For production with multiple instances, consider using Redis with Upstash.
 */

interface RateLimitConfig {
  /**
   * Maximum number of requests allowed
   */
  maxRequests: number;
  /**
   * Time window in milliseconds
   */
  windowMs: number;
  /**
   * Custom identifier function (default: uses IP)
   */
  identifier?: (request: any) => string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (resets on server restart)
// For production with multiple instances, use Upstash Redis
const store = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries every 1 minute
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}, 60000);

/**
 * Rate limiter for Next.js middleware
 */
export class RateLimiter {
  private config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      identifier: config.identifier || this.defaultIdentifier,
    };
  }

  /**
   * Default identifier uses IP address
   */
  private defaultIdentifier(request: any): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() :
               request.headers.get('x-real-ip') ||
               'unknown';
    return ip;
  }

  /**
   * Check if request is rate limited
   * Returns { limited: boolean, remaining: number, resetTime: number }
   */
  check(request: any): {
    limited: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  } {
    const identifier = this.config.identifier(request);
    const now = Date.now();

    let entry = store.get(identifier);

    // If no entry or window expired, create new entry
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 1,
        resetTime: now + this.config.windowMs,
      };
      store.set(identifier, entry);

      return {
        limited: false,
        remaining: this.config.maxRequests - 1,
        resetTime: entry.resetTime,
      };
    }

    // Increment counter
    entry.count++;

    // Check if rate limit exceeded
    if (entry.count > this.config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return {
        limited: true,
        remaining: 0,
        resetTime: entry.resetTime,
        retryAfter,
      };
    }

    return {
      limited: false,
      remaining: this.config.maxRequests - entry.count,
      resetTime: entry.resetTime,
    };
  }
}

// Pre-configured rate limiters

/**
 * Aggressive rate limiter for auth endpoints
 * 5 requests per 15 minutes
 */
export const authRateLimiter = new RateLimiter({
  maxRequests: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  identifier: (request) => {
    // Use IP + User-Agent for auth to prevent bypassing by changing IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
               request.headers.get('x-real-ip') ||
               'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    return `auth:${ip}:${userAgent}`;
  },
});

/**
 * Moderate rate limiter for API endpoints
 * 100 requests per minute
 */
export const apiRateLimiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
});

/**
 * Strict rate limiter for export endpoints (resource-intensive)
 * 10 requests per 5 minutes
 */
export const exportRateLimiter = new RateLimiter({
  maxRequests: 10,
  windowMs: 5 * 60 * 1000, // 5 minutes
});
