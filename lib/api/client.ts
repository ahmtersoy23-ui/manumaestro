/**
 * API Client Utility
 * Enhanced fetch with error handling, retry logic, and toast notifications
 */

import toast from 'react-hot-toast';
import { createLogger } from '@/lib/logger';

const logger = createLogger('API Client');

interface ApiClientOptions extends RequestInit {
  retry?: number;
  retryDelay?: number;
  showSuccessToast?: boolean;
  showErrorToast?: boolean;
  successMessage?: string;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Sleep utility for retry delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enhanced fetch with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: ApiClientOptions = {}
): Promise<Response> {
  const {
    retry = 0,
    retryDelay = 1000,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= retry) {
    try {
      const response = await fetch(url, fetchOptions);

      // Don't retry on client errors (4xx) except 408 (Request Timeout) and 429 (Too Many Requests)
      if (response.status >= 400 && response.status < 500) {
        if (response.status !== 408 && response.status !== 429) {
          return response;
        }
      }

      // Success or retriable error
      if (response.ok || attempt === retry) {
        return response;
      }

      // Network error or 5xx - retry
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network error');

      // Don't retry if it's the last attempt
      if (attempt === retry) {
        throw lastError;
      }
    }

    // Wait before retry
    const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
    logger.debug(`Retry attempt ${attempt + 1}/${retry} after ${delay}ms`, { url });
    await sleep(delay);
    attempt++;
  }

  throw lastError || new Error('Request failed');
}

/**
 * API Client with enhanced error handling
 */
export async function apiClient<T = unknown>(
  url: string,
  options: ApiClientOptions = {}
): Promise<T> {
  const {
    showSuccessToast = false,
    showErrorToast = true,
    successMessage,
    ...fetchOptions
  } = options;

  try {
    logger.debug('API Request', { url, method: fetchOptions.method || 'GET' });

    const response = await fetchWithRetry(url, fetchOptions);

    // Parse JSON response
    let data: ApiResponse<T>;
    try {
      data = await response.json();
    } catch (error) {
      // Response is not JSON
      if (response.ok) {
        // For non-JSON success responses (like file downloads)
        return null as T;
      }
      throw new Error('Invalid response format');
    }

    // Handle error responses
    if (!response.ok || !data.success) {
      const errorMessage = data.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      const errorCode = data.error?.code;

      logger.error('API Error', {
        url,
        status: response.status,
        message: errorMessage,
        code: errorCode,
      });

      if (showErrorToast) {
        // Special handling for rate limiting
        if (response.status === 429) {
          toast.error('Çok fazla istek. Lütfen bir süre bekleyip tekrar deneyin.', {
            duration: 6000,
          });
        } else {
          toast.error(errorMessage, { duration: 6000 });
        }
      }

      throw new Error(errorMessage);
    }

    // Success
    logger.debug('API Success', { url });

    if (showSuccessToast && successMessage) {
      toast.success(successMessage);
    }

    return data.data as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';

    logger.error('API Request Failed', { url, error: message });

    if (showErrorToast) {
      toast.error(message);
    }

    throw error;
  }
}

/**
 * Convenience methods for different HTTP verbs
 */
export const api = {
  get: <T = unknown>(url: string, options?: ApiClientOptions) =>
    apiClient<T>(url, { ...options, method: 'GET' }),

  post: <T = unknown>(url: string, body?: unknown, options?: ApiClientOptions) =>
    apiClient<T>(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T = unknown>(url: string, body?: unknown, options?: ApiClientOptions) =>
    apiClient<T>(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T = unknown>(url: string, body?: unknown, options?: ApiClientOptions) =>
    apiClient<T>(url, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T = unknown>(url: string, options?: ApiClientOptions) =>
    apiClient<T>(url, { ...options, method: 'DELETE' }),
};

/**
 * Hook-like wrapper for easier usage in components
 */
export function createApiCall<T = unknown>(options?: ApiClientOptions) {
  return {
    get: (url: string) => api.get<T>(url, options),
    post: (url: string, body?: unknown) => api.post<T>(url, body, options),
    put: (url: string, body?: unknown) => api.put<T>(url, body, options),
    patch: (url: string, body?: unknown) => api.patch<T>(url, body, options),
    delete: (url: string) => api.delete<T>(url, options),
  };
}
