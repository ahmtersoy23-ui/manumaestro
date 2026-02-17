/**
 * Auth Verify Utilities Tests
 * Tests for SSO token verification and role checking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyAuth, requireRole } from '@/lib/auth/verify';

// Mock fetch globally
global.fetch = vi.fn();

describe('Auth Verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyAuth', () => {
    it('should return error when no token is provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/test');
      const result = await verifyAuth(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No authentication token');
      expect(result.user).toBeUndefined();
    });

    it('should return error when token verification fails', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=invalid-token',
        },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await verifyAuth(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token verification failed');
      expect(result.user).toBeUndefined();
    });

    it('should return error when SSO backend returns invalid token', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=test-token',
        },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: 'Invalid token',
        }),
      });

      const result = await verifyAuth(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('should return user data when token is valid', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=valid-token',
        },
      });

      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            user: mockUser,
            role: 'admin',
          },
        }),
      });

      const result = await verifyAuth(request);

      expect(result.success).toBe(true);
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        role: 'admin',
      });
    });

    it('should default to viewer role when role is not provided', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=valid-token',
        },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            user: {
              id: 'user-123',
              email: 'test@example.com',
              name: 'Test User',
            },
            // No role provided
          },
        }),
      });

      const result = await verifyAuth(request);

      expect(result.success).toBe(true);
      expect(result.user?.role).toBe('viewer');
    });

    it('should handle network errors gracefully', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=test-token',
        },
      });

      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await verifyAuth(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal server error');
    });

    it('should send correct payload to SSO backend', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=my-test-token',
        },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            user: { id: '1', email: 'test@test.com', name: 'Test' },
            role: 'editor',
          },
        }),
      });

      await verifyAuth(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://apps.iwa.web.tr/api/auth/verify',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'my-test-token', app_code: 'manumaestro' }),
        })
      );
    });
  });

  describe('requireRole', () => {
    it('should return 401 when user is not authenticated', async () => {
      const request = new NextRequest('http://localhost:3000/api/test');

      const result = await requireRole(request, ['admin']);

      expect(result).toHaveProperty('status', 401);
      const json = await result.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('No authentication token');
    });

    it('should return 403 when user lacks required role', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=valid-token',
        },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            user: { id: '1', email: 'viewer@test.com', name: 'Viewer' },
            role: 'viewer',
          },
        }),
      });

      const result = await requireRole(request, ['admin']);

      expect(result).toHaveProperty('status', 403);
      const json = await result.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Insufficient permissions');
    });

    it('should return user when role matches (single role)', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=valid-token',
        },
      });

      const mockUser = {
        id: 'admin-123',
        email: 'admin@test.com',
        name: 'Admin User',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            user: mockUser,
            role: 'admin',
          },
        }),
      });

      const result = await requireRole(request, ['admin']);

      expect(result).toHaveProperty('user');
      expect((result as any).user.email).toBe(mockUser.email);
      expect((result as any).user.role).toBe('admin');
    });

    it('should return user when role matches (multiple allowed roles)', async () => {
      const request = new NextRequest('http://localhost:3000/api/test', {
        headers: {
          Cookie: 'sso_access_token=valid-token',
        },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            user: { id: '1', email: 'editor@test.com', name: 'Editor' },
            role: 'editor',
          },
        }),
      });

      const result = await requireRole(request, ['admin', 'editor']);

      expect(result).toHaveProperty('user');
      expect((result as any).user.role).toBe('editor');
    });

    it('should handle all role types correctly', async () => {
      const testCases = [
        { role: 'admin', allowed: ['admin', 'editor', 'viewer'], shouldPass: true },
        { role: 'editor', allowed: ['admin', 'editor'], shouldPass: true },
        { role: 'viewer', allowed: ['admin'], shouldPass: false },
        { role: 'viewer', allowed: ['viewer'], shouldPass: true },
      ];

      for (const testCase of testCases) {
        const request = new NextRequest('http://localhost:3000/api/test', {
          headers: {
            Cookie: 'sso_access_token=valid-token',
          },
        });

        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              user: { id: '1', email: 'test@test.com', name: 'Test' },
              role: testCase.role,
            },
          }),
        });

        const result = await requireRole(request, testCase.allowed as any);

        if (testCase.shouldPass) {
          expect(result).toHaveProperty('user');
        } else {
          expect(result).toHaveProperty('status', 403);
        }
      }
    });
  });
});
