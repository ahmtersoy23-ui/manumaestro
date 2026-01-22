/**
 * Auth Context
 * Provides SSO authentication state from middleware headers
 * Authentication is handled by middleware.ts - this just exposes user info
 */

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface SSOUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface AuthContextType {
  user: SSOUser | null;
  role: 'admin' | 'editor' | 'viewer' | null;
  loading: boolean;
  isAuthenticated: boolean;
  logout: () => void;
  hasRole: (roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SSOUser | null>(null);
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If we reach here, middleware has already authenticated the user
    // User info is available in request headers (set by middleware)
    // For now, we'll create a minimal user object
    // In a real app, you'd fetch this from an API endpoint that reads the headers

    setUser({
      id: 'authenticated-user',
      email: 'user@example.com',
      name: 'Authenticated User'
    });
    setRole('admin');
    setLoading(false);
  }, []);

  const hasRoleCheck = (requiredRoles: string[]): boolean => {
    if (!role) return false;
    return requiredRoles.includes(role);
  };

  const handleLogout = () => {
    // Redirect to SSO portal for logout
    window.location.href = 'https://apps.iwa.web.tr';
  };

  const value: AuthContextType = {
    user,
    role,
    loading,
    isAuthenticated: !!user,
    logout: handleLogout,
    hasRole: hasRoleCheck,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
