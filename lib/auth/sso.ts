/**
 * SSO Authentication Utilities
 * Handles token management and verification with IWA Apps SSO
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('SSO');
const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || 'https://apps.iwa.web.tr';
const APP_CODE = process.env.NEXT_PUBLIC_SSO_APP_CODE || 'manumaestro';

export interface SSOUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface SSOVerifyResponse {
  success: boolean;
  data?: {
    user: SSOUser;
    role: 'admin' | 'editor' | 'viewer';
    apps: Record<string, string>;
  };
  error?: string;
}

/**
 * Get access token from URL or localStorage
 */
export const getAccessToken = (): string | null => {
  if (typeof window === 'undefined') return null;

  // Check URL parameters first (for initial login)
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');

  if (urlToken) {
    localStorage.setItem('sso_access_token', urlToken);
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    return urlToken;
  }

  // Get from localStorage
  return localStorage.getItem('sso_access_token');
};

/**
 * Verify token with SSO backend
 */
export const verifyToken = async (token: string): Promise<SSOVerifyResponse> => {
  try {
    const response = await fetch(`${SSO_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, app_code: APP_CODE }),
    });

    if (!response.ok) {
      return { success: false, error: 'Invalid token' };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error('Token verification error:', error);
    return { success: false, error: 'Verification failed' };
  }
};

/**
 * Redirect to SSO login portal
 */
export const redirectToSSO = () => {
  if (typeof window !== 'undefined') {
    window.location.href = SSO_URL;
  }
};

/**
 * Logout and clear tokens
 */
export const logout = async () => {
  if (typeof window === 'undefined') return;

  const token = getAccessToken();

  // Notify SSO backend
  if (token) {
    try {
      await fetch(`${SSO_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      logger.error('Logout error:', error);
    }
  }

  // Clear local token
  localStorage.removeItem('sso_access_token');
  localStorage.removeItem('sso_refresh_token');

  // Redirect to SSO portal
  redirectToSSO();
};

/**
 * Check if user has required role
 */
export const hasRole = (userRole: string, requiredRoles: string[]): boolean => {
  return requiredRoles.includes(userRole);
};
