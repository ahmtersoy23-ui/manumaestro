/**
 * Auth Context
 * Provides SSO authentication state and methods throughout the app
 */

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getAccessToken, verifyToken, redirectToSSO, logout, SSOUser } from '@/lib/auth/sso';

interface AuthContextType {
  user: SSOUser | null;
  role: 'admin' | 'editor' | 'viewer' | null;
  loading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  hasRole: (roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SSOUser | null>(null);
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function initAuth() {
      try {
        const token = getAccessToken();

        if (!token) {
          // No token - redirect to SSO
          redirectToSSO();
          return;
        }

        // Verify token
        const result = await verifyToken(token);

        if (result.success && result.data) {
          setUser(result.data.user);
          setRole(result.data.role);
        } else {
          // Invalid token - redirect to SSO
          redirectToSSO();
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        redirectToSSO();
      } finally {
        setLoading(false);
      }
    }

    initAuth();
  }, []);

  const hasRoleCheck = (requiredRoles: string[]): boolean => {
    if (!role) return false;
    return requiredRoles.includes(role);
  };

  const value: AuthContextType = {
    user,
    role,
    loading,
    isAuthenticated: !!user,
    logout,
    hasRole: hasRoleCheck,
  };

  // Show loading state while verifying
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Authenticating...</p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
