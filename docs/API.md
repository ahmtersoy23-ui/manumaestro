# ManuMaestro API Documentation

**Version**: 1.0.0
**Base URL**: `https://manumaestro.iwa.web.tr` (Production)
**Base URL**: `http://localhost:3000` (Development)

---

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Handling](#error-handling)
- [Endpoints](#endpoints)
  - [Production Requests](#production-requests)
  - [Manufacturer Operations](#manufacturer-operations)
  - [Marketplaces](#marketplaces)
  - [Export](#export)
  - [Products](#products)
  - [Workflow](#workflow)
  - [Audit Logs](#audit-logs)

---

## Authentication

ManuMaestro uses **SSO (Single Sign-On)** authentication via IWA Apps SSO.

### Headers

All API requests include automatic headers from SSO middleware:

```http
x-user-id: <UUID>
x-user-email: <email@example.com>
x-user-name: <User Name>
x-user-role: <admin|viewer|manufacturer>
```

### Roles

- **admin**: Full access to all endpoints
- **manufacturer**: Access to manufacturer-specific endpoints
- **viewer**: Read-only access

---

## Rate Limiting

All endpoints are rate-limited to prevent abuse:

| Operation Type | Limit |
|---|---|
| **Bulk Operations** | 10 requests/minute |
| **Write Operations** | 100 requests/minute |
| **Read Operations** | 200 requests/minute |

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1707681600000
Retry-After: 60 (when limit exceeded)
```

### Rate Limit Response (429)

```json
{
  "success": false,
  "error": {
    "message": "Too many requests. Please try again later.",
    "code": "RATE_LIMIT_EXCEEDED",
    "details": {
      "limit": 100,
      "retryAfter": 45,
      "resetTime": "2026-02-11T19:30:00.000Z"
    }
  }
}
```

---

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "details": {}
  }
}
```

### Error Codes

| Code | Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Endpoints

### Production Requests

#### GET `/api/requests`

List production requests with filters.

**Query Parameters:**
- `marketplaceId` (optional): Filter by marketplace UUID
- `status` (optional): `REQUESTED | IN_PRODUCTION | COMPLETED | CANCELLED`
- `month` (optional): Production month in `YYYY-MM` format
- `archiveMode` (optional): `true` to show archived months
- `limit` (optional): Max results (default: 50)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "iwasku": "IWA-12345",
      "productName": "Product Name",
      "productCategory": "Furniture",
      "productSize": 15.5,
      "marketplaceId": "uuid",
      "marketplace": {
        "name": "Amazon DE",
        "code": "AMAZON_DE"
      },
      "quantity": 100,
      "producedQuantity": 0,
      "requestDate": "2026-02-11T10:00:00.000Z",
      "productionMonth": "2026-03",
      "status": "REQUESTED",
      "notes": "Special requirements",
      "manufacturerNotes": null,
      "entryType": "MANUAL",
      "enteredBy": {
        "id": "uuid",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "createdAt": "2026-02-11T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### POST `/api/requests`

Create a single production request.

**Request Body:**
```json
{
  "iwasku": "IWA-12345",
  "productName": "Product Name",
  "productCategory": "Furniture",
  "productSize": 15.5,
  "marketplaceId": "uuid",
  "quantity": 100,
  "productionMonth": "2026-03",
  "notes": "Optional notes"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "iwasku": "IWA-12345",
    ...
  },
  "warning": "Product IWA-12345 is missing desi (size) data. Please update in PriceLab."
}
```

#### POST `/api/requests/bulk`

Create multiple production requests (Excel import).

**Request Body:**
```json
{
  "requests": [
    {
      "iwasku": "IWA-12345",
      "quantity": 100,
      "notes": "Optional"
    }
  ],
  "marketplaceId": "uuid",
  "productionMonth": "2026-03"
}
```

**Validation:**
- Min 1 request, max 1000 requests
- Each quantity must be positive integer (max 999,999)
- Production month format: `YYYY-MM`
- Notes max length: 500 characters

**Response (200):**
```json
{
  "success": true,
  "data": {
    "created": 95,
    "errors": [
      "Product not found: IWA-99999"
    ],
    "warnings": [
      "IWA-12345: Missing desi data"
    ]
  }
}
```

#### DELETE `/api/requests/[id]`

Delete a production request.

**Response (200):**
```json
{
  "success": true,
  "message": "Request deleted successfully"
}
```

#### GET `/api/requests/monthly`

Get aggregated monthly statistics.

**Query Parameters:**
- `month` (required): `YYYY-MM` format

**Response:**
```json
{
  "success": true,
  "data": {
    "totalRequests": 150,
    "totalQuantity": 5000,
    "totalProduced": 4500,
    "totalDesi": 75000,
    "totalProducedDesi": 67500,
    "itemsWithoutSize": 5,
    "missingDesiItems": [
      {
        "productName": "Product A",
        "productCategory": "Furniture"
      }
    ],
    "summary": [
      {
        "productCategory": "Furniture",
        "totalQuantity": 2000,
        "totalDesi": 30000,
        "requestCount": 50,
        "itemsWithoutSize": 2,
        "marketplaces": ["Amazon DE", "Amazon UK"],
        "totalProduced": 1800,
        "producedDesi": 27000
      }
    ],
    "marketplaceSummary": [
      {
        "marketplaceId": "uuid",
        "marketplaceName": "Amazon DE",
        "totalQuantity": 1500,
        "totalDesi": 22500,
        "requestCount": 30
      }
    ]
  },
  "meta": {
    "debug": {
      "aggregateSum": 4500,
      "calculatedTotal": 4500,
      "uniqueProducts": 120,
      "month": "2026-03"
    }
  }
}
```

---

### Manufacturer Operations

#### GET `/api/manufacturer/category/[category]`

Get requests for a specific category.

**Query Parameters:**
- `month` (optional): `YYYY-MM` format (defaults to current month)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "iwasku": "IWA-12345",
      "productName": "Product Name",
      "productCategory": "Furniture",
      "marketplaceName": "Amazon DE",
      "quantity": 100,
      "producedQuantity": 50,
      "manufacturerNotes": "In progress",
      "workflowStage": "CUTTING",
      "status": "IN_PRODUCTION",
      "requestDate": "2026-02-11T10:00:00.000Z"
    }
  ]
}
```

#### PATCH `/api/manufacturer/requests/[id]`

Update manufacturer-specific fields.

**Request Body:**
```json
{
  "producedQuantity": 50,
  "manufacturerNotes": "Production notes",
  "status": "IN_PRODUCTION"
}
```

**Auto-Complete Feature:**
When status is set to `COMPLETED` and `producedQuantity` is 0/null/undefined, the system automatically sets `producedQuantity` to match the requested `quantity`.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "producedQuantity": 50,
    "status": "IN_PRODUCTION",
    ...
  }
}
```

---

### Marketplaces

#### GET `/api/marketplaces`

List all active marketplaces.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Amazon DE",
      "code": "AMAZON_DE",
      "region": "EU",
      "marketplaceType": "AMAZON",
      "isCustom": false,
      "isActive": true,
      "createdAt": "2026-01-19T10:00:00.000Z"
    }
  ]
}
```

#### POST `/api/marketplaces`

Create custom marketplace (admin only).

**Request Body:**
```json
{
  "name": "Custom Market",
  "region": "EU",
  "marketplaceType": "CUSTOM"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Custom Market",
    "code": "CUSTOM_01",
    "region": "EU",
    "marketplaceType": "CUSTOM",
    "isCustom": true,
    "isActive": true
  }
}
```

---

### Export

#### GET `/api/export/manufacturer`

Export manufacturer data to Excel.

**Query Parameters:**
- `category` (optional): Filter by product category
- `month` (optional): Filter by production month (`YYYY-MM`)

**Response:**
Excel file download with:
- Aggregated data by IWASKU
- Turkish column headers
- Professional styling
- Auto-filter enabled

**Columns:**
- IWASKU, Ürün Adı, Kategori, Pazaryerleri
- Talep Edilen, Üretilen, Desi (Birim), Toplam Desi
- Durum, Üretim Ayı, Notlar, Üretici Notları

#### GET `/api/export/monthly`

Export monthly production report to Excel.

**Query Parameters:**
- `month` (required): `YYYY-MM` format

**Response:**
Excel file with detailed monthly data.

---

### Products

#### GET `/api/products/search`

Search products from PriceLab database.

**Query Parameters:**
- `q` (required): Search query (min 2 characters)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "iwasku": "IWA-12345",
      "name": "Product Name",
      "category": "Furniture",
      "size": "15.5"
    }
  ]
}
```

#### GET `/api/products/[iwasku]`

Get product details by IWASKU.

**Response:**
```json
{
  "success": true,
  "data": {
    "iwasku": "IWA-12345",
    "name": "Product Name",
    "category": "Furniture",
    "size": "15.5"
  }
}
```

---

### Workflow

#### PATCH `/api/workflow`

Update workflow stage for a request.

**Request Body:**
```json
{
  "requestId": "uuid",
  "workflowStage": "CUTTING"
}
```

**Valid Stages:**
- `PENDING`, `CUTTING`, `ASSEMBLY`, `PACKAGING`, `COMPLETED`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "workflowStage": "CUTTING",
    ...
  }
}
```

---

### Audit Logs

#### GET `/api/audit-logs`

Get audit logs (admin only).

**Query Parameters:**
- `limit` (optional): Max results (default: 100)
- `action` (optional): Filter by action type
- `userId` (optional): Filter by user UUID

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "userName": "John Doe",
      "userEmail": "john@example.com",
      "action": "CREATE_REQUEST",
      "entityType": "ProductionRequest",
      "entityId": "uuid",
      "description": "Created production request for Product X",
      "metadata": {
        "category": "Furniture",
        "quantity": 100
      },
      "createdAt": "2026-02-11T10:00:00.000Z",
      "user": {
        "name": "John Doe",
        "email": "john@example.com",
        "role": "ADMIN"
      }
    }
  ]
}
```

---

## Common Response Patterns

### Success Response

```json
{
  "success": true,
  "data": <T>,
  "meta": {} // optional
}
```

### Pagination

```json
{
  "success": true,
  "data": [...],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 150,
      "totalPages": 3,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

---

## Postman Collection

Import this collection for quick API testing:

```json
{
  "info": {
    "name": "ManuMaestro API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Production Requests",
      "item": [
        {
          "name": "List Requests",
          "request": {
            "method": "GET",
            "header": [],
            "url": {
              "raw": "{{baseUrl}}/api/requests?month=2026-03",
              "host": ["{{baseUrl}}"],
              "path": ["api", "requests"],
              "query": [{"key": "month", "value": "2026-03"}]
            }
          }
        }
      ]
    }
  ],
  "variable": [
    {
      "key": "baseUrl",
      "value": "https://manumaestro.iwa.web.tr"
    }
  ]
}
```

---

**Last Updated**: February 11, 2026
**Maintained By**: Development Team
