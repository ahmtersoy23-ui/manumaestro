/**
 * Rate Limiter Tests
 * Tests for in-memory rate limiting functionality
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '@/lib/rate-limiter';

// The default identifier uses x-forwarded-for or x-real-ip headers, NOT the ip property.
// We need to pass unique header values to differentiate mock requests.
function createMockRequest(ipHeader: string): {
  ip: string;
  headers: { get(name: string): string | null };
} {
  return {
    ip: ipHeader,
    headers: {
      get(name: string) {
        if (name === 'x-real-ip') return ipHeader;
        return null;
      },
    },
  };
}

// Each test creates a new RateLimiter instance, but they all share the same
// module-level store Map. To isolate tests, we use unique IPs per test.
let testCounter = 0;
function uniqueIp() {
  testCounter++;
  return `test-ip-${testCounter}-${Date.now()}`;
}

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter({
      maxRequests: 3,
      windowMs: 60000, // 1 minute
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests under the limit', () => {
    const ip = uniqueIp();
    const request = createMockRequest(ip);
    const result = limiter.check(request);

    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(2); // 3 max - 1 used
  });

  it('should decrement remaining count on each request', () => {
    const ip = uniqueIp();
    const request = createMockRequest(ip);

    const first = limiter.check(request);
    expect(first.remaining).toBe(2);

    const second = limiter.check(request);
    expect(second.remaining).toBe(1);

    const third = limiter.check(request);
    expect(third.remaining).toBe(0);
  });

  it('should rate limit after exceeding max requests', () => {
    const ip = uniqueIp();
    const request = createMockRequest(ip);

    // Make 3 allowed requests
    limiter.check(request);
    limiter.check(request);
    limiter.check(request);

    // 4th request should be limited
    const result = limiter.check(request);
    expect(result.limited).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('should track different IPs independently', () => {
    const ip1 = uniqueIp();
    const ip2 = uniqueIp();
    const request1 = createMockRequest(ip1);
    const request2 = createMockRequest(ip2);

    // Exhaust limit for IP 1
    limiter.check(request1);
    limiter.check(request1);
    limiter.check(request1);
    const limited1 = limiter.check(request1);
    expect(limited1.limited).toBe(true);

    // IP 2 should still be allowed
    const result2 = limiter.check(request2);
    expect(result2.limited).toBe(false);
    expect(result2.remaining).toBe(2);
  });

  it('should reset after window expires', () => {
    const ip = uniqueIp();
    const request = createMockRequest(ip);

    // Exhaust limit
    limiter.check(request);
    limiter.check(request);
    limiter.check(request);
    const limited = limiter.check(request);
    expect(limited.limited).toBe(true);

    // Advance time past the window
    vi.advanceTimersByTime(61000);

    // Should be allowed again
    const result = limiter.check(request);
    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(2);
  });

  it('should use x-forwarded-for header for IP by default', () => {
    // Create request with x-forwarded-for header
    const forwardedIp = uniqueIp();
    const request = {
      ip: 'fallback',
      headers: {
        get(name: string) {
          if (name === 'x-forwarded-for') return `${forwardedIp}, 10.0.0.1`;
          return null;
        },
      },
    };

    limiter.check(request);
    limiter.check(request);
    limiter.check(request);

    // Same forwarded IP should be limited
    const limited = limiter.check(request);
    expect(limited.limited).toBe(true);

    // Different forwarded IP should not be limited
    const differentForwardedIp = uniqueIp();
    const differentRequest = {
      ip: 'fallback',
      headers: {
        get(name: string) {
          if (name === 'x-forwarded-for') return differentForwardedIp;
          return null;
        },
      },
    };
    const result = limiter.check(differentRequest);
    expect(result.limited).toBe(false);
  });

  it('should accept custom identifier function', () => {
    const customLimiter = new RateLimiter({
      maxRequests: 2,
      windowMs: 60000,
      identifier: (request) => {
        return request.headers.get('x-api-key') || 'anonymous';
      },
    });

    const key1 = uniqueIp();
    const key2 = uniqueIp();

    const request1 = {
      ip: 'any',
      headers: { get(name: string) { return name === 'x-api-key' ? key1 : null; } },
    };
    const request2 = {
      ip: 'any',
      headers: { get(name: string) { return name === 'x-api-key' ? key2 : null; } },
    };

    // Exhaust key1 limit
    customLimiter.check(request1);
    customLimiter.check(request1);
    const limited = customLimiter.check(request1);
    expect(limited.limited).toBe(true);

    // key2 should still be allowed
    const result = customLimiter.check(request2);
    expect(result.limited).toBe(false);
  });

  it('should include resetTime in response', () => {
    const ip = uniqueIp();
    const request = createMockRequest(ip);
    const result = limiter.check(request);

    expect(result.resetTime).toBeGreaterThan(Date.now());
  });

  it('should calculate retryAfter in seconds when limited', () => {
    const ip = uniqueIp();
    const request = createMockRequest(ip);

    // Exhaust limit (3 requests)
    limiter.check(request);
    limiter.check(request);
    limiter.check(request);

    // Advance 30 seconds into the window
    vi.advanceTimersByTime(30000);

    // 4th request should be limited
    const result = limiter.check(request);
    expect(result.limited).toBe(true);
    // retryAfter should be roughly 30 seconds (remaining in window)
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(31);
  });
});
