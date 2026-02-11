# Performance Monitoring & Error Tracking Guide

**Last Updated**: February 11, 2026

---

## Table of Contents

- [Overview](#overview)
- [Current Implementation](#current-implementation)
- [Recommended Tools](#recommended-tools)
- [Sentry Integration Guide](#sentry-integration-guide)
- [Metrics to Monitor](#metrics-to-monitor)
- [Alert Configuration](#alert-configuration)

---

## Overview

ManuMaestro uses a comprehensive logging and error handling strategy to ensure system reliability and quick issue resolution.

### Current Implementation ✅

- **Structured Logging**: Environment-aware logger (`lib/logger.ts`)
- **Error Boundaries**: React error catching with graceful fallback UI
- **Toast Notifications**: User-friendly error messages
- **Retry Logic**: Automatic retry for transient failures
- **Rate Limiting**: API protection with detailed headers
- **Audit Logging**: User action tracking in database

---

## Current Implementation

### 1. Logger System

**Location**: `lib/logger.ts`

```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger('Module Name');

logger.info('Operation completed', { userId, count });
logger.error('Operation failed', error);
logger.debug('Debug info', data); // Development only
logger.warn('Warning message', { context });
```

**Features:**
- Environment-aware (production logs errors only)
- Structured logging with metadata
- Module-based namespacing
- JSON output for log aggregation

### 2. Error Handling

**API Errors**: `lib/api/errors.ts`

```typescript
throw new ValidationError('Invalid input', { field: 'email' });
throw new NotFoundError('User');
throw new UnauthorizedError();
throw new InternalServerError('Database connection failed');
```

**Error Responses**: `lib/api/response.ts`

```typescript
return errorResponse(error, 'Failed to fetch data');
// Automatically handles ApiError types and logging
```

### 3. Frontend Error Tracking

**Error Boundary**: `components/ErrorBoundary.tsx`
- Catches React component errors
- Shows user-friendly fallback UI
- Logs error details (development mode)
- Page reload option

**Toast Notifications**: `lib/api/client.ts`
- Network error handling
- Rate limit notifications
- Success/error feedback

### 4. Audit Logging

**Database Logs**: `lib/auditLog.ts`

```typescript
await logAction({
  userId: user.id,
  userName: user.name,
  userEmail: user.email,
  action: 'CREATE_REQUEST',
  entityType: 'ProductionRequest',
  entityId: request.id,
  description: 'Created production request',
  metadata: { category, quantity },
});
```

**Tracked Actions:**
- CREATE_REQUEST, UPDATE_REQUEST, DELETE_REQUEST
- CREATE_MARKETPLACE, UPDATE_PRODUCTION
- BULK_UPLOAD, EXPORT_DATA

---

## Recommended Tools

### Option 1: Sentry (Recommended) ⭐

**Why Sentry:**
- ✅ Comprehensive error tracking
- ✅ Performance monitoring
- ✅ Release tracking
- ✅ User context
- ✅ Source maps support
- ✅ Slack/email alerts
- ✅ Free tier: 5K errors/month

**Pricing:**
- Free: 5,000 errors/month
- Team: $26/month (50,000 errors)
- Business: $80/month (100,000 errors)

### Option 2: LogRocket

**Why LogRocket:**
- ✅ Session replay
- ✅ Network monitoring
- ✅ Performance insights
- ✅ User journey tracking

### Option 3: DataDog

**Why DataDog:**
- ✅ Full-stack monitoring
- ✅ Log aggregation
- ✅ APM (Application Performance Monitoring)
- ⚠️ Higher cost

---

## Sentry Integration Guide

### 1. Installation

```bash
npm install @sentry/nextjs
```

### 2. Configuration

Create `sentry.client.config.ts`:

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Performance Monitoring
  tracesSampleRate: 1.0,

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Error filtering
  beforeSend(event, hint) {
    // Filter out known errors
    if (event.exception?.values?.[0]?.value?.includes('ResizeObserver')) {
      return null;
    }
    return event;
  },

  // Integrations
  integrations: [
    new Sentry.BrowserTracing(),
    new Sentry.Replay(),
  ],
});
```

Create `sentry.server.config.ts`:

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});
```

### 3. Environment Variables

Add to `.env`:

```bash
# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=xxx
SENTRY_ORG=your-org
SENTRY_PROJECT=manumaestro
```

### 4. Update Logger

Modify `lib/logger.ts` to send errors to Sentry:

```typescript
import * as Sentry from '@sentry/nextjs';

error(...args: any[]) {
  console.error(...this.formatMessage('error', ...args));

  // Send to Sentry in production
  if (!this.isDevelopment && args[0] instanceof Error) {
    Sentry.captureException(args[0], {
      tags: { module: this.module },
      extra: args[1],
    });
  }
}
```

### 5. Update Error Boundary

```typescript
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  logger.error('React Error Boundary caught an error:', {
    error: error.message,
    stack: error.stack,
    componentStack: errorInfo.componentStack,
  });

  // Send to Sentry
  Sentry.captureException(error, {
    contexts: {
      react: {
        componentStack: errorInfo.componentStack,
      },
    },
  });
}
```

### 6. API Error Tracking

Update `lib/api/response.ts`:

```typescript
import * as Sentry from '@sentry/nextjs';

if (error.statusCode >= 500) {
  logger.error('API Error:', { ... });

  // Send 5xx errors to Sentry
  Sentry.captureException(error, {
    tags: {
      api: true,
      statusCode: error.statusCode,
    },
  });
}
```

---

## Metrics to Monitor

### 1. Error Metrics

| Metric | Alert Threshold | Priority |
|---|---|---|
| Error rate | > 1% | High |
| 5xx errors | > 0.5% | Critical |
| API failures | > 5 in 5 min | High |
| Database errors | > 2 in 5 min | Critical |

### 2. Performance Metrics

| Metric | Target | Alert |
|---|---|---|
| API response time (p95) | < 500ms | > 1000ms |
| Database query time | < 100ms | > 300ms |
| Page load time (p95) | < 2s | > 3s |
| Time to Interactive | < 3s | > 5s |

### 3. Business Metrics

| Metric | Description |
|---|---|
| Request creation rate | New requests per hour |
| Excel export success rate | % successful exports |
| Bulk upload success rate | % successful bulk operations |
| User action frequency | Actions per user per day |

### 4. Infrastructure Metrics

| Metric | Alert Threshold |
|---|---|
| CPU usage | > 80% for 5 min |
| Memory usage | > 85% |
| Disk usage | > 90% |
| PM2 process restarts | > 3 in 1 hour |

---

## Alert Configuration

### Critical Alerts (Immediate)

**Slack/Email/SMS:**
- Application crash/restart
- Database connection failure
- Error rate > 5%
- 5xx error rate > 1%

### High Priority Alerts (15 min response)

**Slack/Email:**
- API response time > 2s
- Memory usage > 85%
- Rate limit exceeded frequently
- Failed authentication attempts > 10

### Medium Priority Alerts (1 hour response)

**Slack:**
- Excel export failures
- Missing product data warnings
- Audit log gaps

---

## Dashboard Metrics

### Sentry Dashboard

**Widgets to Add:**
1. **Error Overview**
   - Total errors (last 24h)
   - Error rate trend
   - Most common errors

2. **Performance**
   - Average response time
   - Slowest endpoints
   - Database query performance

3. **User Impact**
   - Affected users
   - User sessions with errors
   - Error distribution by browser/OS

4. **Releases**
   - New errors in latest release
   - Regression detection
   - Adoption rate

---

## Monitoring Checklist

### Daily
- [ ] Check error dashboard
- [ ] Review critical alerts
- [ ] Monitor API response times
- [ ] Check database performance

### Weekly
- [ ] Review error trends
- [ ] Analyze slow queries
- [ ] Check user feedback
- [ ] Review audit logs

### Monthly
- [ ] Performance optimization review
- [ ] Alert threshold adjustment
- [ ] Cost analysis (Sentry usage)
- [ ] Infrastructure scaling review

---

## Useful Commands

### View PM2 Logs
```bash
pm2 logs manumaestro --lines 100
pm2 logs manumaestro --err # Errors only
```

### Database Query Performance
```sql
-- Slowest queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Active connections
SELECT count(*) FROM pg_stat_activity;
```

### Server Metrics
```bash
# CPU usage
top -b -n 1 | head -20

# Memory usage
free -h

# Disk usage
df -h

# Network connections
netstat -an | grep :3000
```

---

## Resources

- [Sentry Next.js Documentation](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Next.js Performance Monitoring](https://nextjs.org/docs/advanced-features/measuring-performance)
- [PM2 Monitoring](https://pm2.keymetrics.io/docs/usage/monitoring/)

---

**Maintained By**: Development Team
