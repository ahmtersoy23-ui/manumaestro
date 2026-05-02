/**
 * Auth Context
 * Provides SSO authentication state from middleware headers
 * Authentication is handled by middleware.ts - this just exposes user info
 */

'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AuthContext');
const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || 'https://apps.iwa.web.tr';

export interface SSOUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface MarketplacePerm {
  code: string;
  canView: boolean;
  canEdit: boolean;
}

interface AuthContextType {
  user: SSOUser | null;
  role: 'admin' | 'editor' | 'viewer' | null;
  loading: boolean;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  canViewStock: boolean;
  marketplacePermissions: MarketplacePerm[];
  logout: () => void;
  hasRole: (roles: string[]) => boolean;
}

// Süper-admin email allowlist (server'la eşit tutulmalı — env'den okumak için
// NEXT_PUBLIC_ prefix gerek; default: ersoy@iwaconcept.com.tr)
const SUPER_ADMIN_EMAILS = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS ?? 'ersoy@iwaconcept.com.tr')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function checkSuperAdmin(email?: string | null): boolean {
  return !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SSOUser | null>(null);
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [canViewStock, setCanViewStock] = useState(false);
  const [marketplacePermissions, setMarketplacePermissions] = useState<MarketplacePerm[]>([]);
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
          setCanViewStock(data.permissions?.canViewStock ?? false);
          setMarketplacePermissions(data.permissions?.marketplaces ?? []);
        } else {
          // If API fails, redirect to SSO
          window.location.href = SSO_URL;
        }
      } catch (error) {
        logger.error('Failed to fetch user info:', error);
        window.location.href = SSO_URL;
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
    window.location.href = SSO_URL;
  };

  const value: AuthContextType = {
    user,
    role,
    loading,
    isAuthenticated: !!user,
    isSuperAdmin: checkSuperAdmin(user?.email),
    canViewStock,
    marketplacePermissions,
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
