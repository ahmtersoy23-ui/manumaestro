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
    // Fetch user info from API endpoint that reads middleware headers
    const fetchUserInfo = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
          setRole(data.role);
        } else {
          // If API fails, redirect to SSO
          window.location.href = 'https://apps.iwa.web.tr';
        }
      } catch (error) {
        console.error('Failed to fetch user info:', error);
        window.location.href = 'https://apps.iwa.web.tr';
      } finally {
        setLoading(false);
      }
    };

    fetchUserInfo();
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
