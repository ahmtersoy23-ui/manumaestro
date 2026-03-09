/**
 * Admin Marketplace Permissions Page
 * Manage per-marketplace access for OPERATOR users
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, ChevronDown, AlertTriangle, CheckSquare, Square } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AdminPermissionsPage');

interface OperatorUser {
  id: string;
  name: string;
  email: string;
  permissions: { marketplaceId: string; canView: boolean; canEdit: boolean }[];
}

interface MarketplaceOption {
  id: string;
  name: string;
  code: string;
  colorTag: string | null;
}

type PermMap = Map<string, { canView: boolean; canEdit: boolean }>;

export default function AdminPermissionsPage() {
  const { role } = useAuth();
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [marketplaces, setMarketplaces] = useState<MarketplaceOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [permMap, setPermMap] = useState<PermMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // marketplaceId being saved

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/admin/marketplace-permissions');
        const data = await res.json();
        if (data.success) {
          setUsers(data.data.users);
          setMarketplaces(data.data.marketplaces);
        }
      } catch (err) {
        logger.error('Failed to fetch permissions data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const buildPermMap = useCallback((userId: string): PermMap => {
    const user = users.find(u => u.id === userId);
    if (!user) return new Map();
    return new Map(user.permissions.map(p => [p.marketplaceId, { canView: p.canView, canEdit: p.canEdit }]));
  }, [users]);

  const handleUserChange = (userId: string) => {
    setSelectedUserId(userId);
    setPermMap(buildPermMap(userId));
  };

  const upsertPermission = async (marketplaceId: string, canView: boolean, canEdit: boolean) => {
    setSaving(marketplaceId);
    // Optimistic update
    setPermMap(prev => {
      const next = new Map(prev);
      next.set(marketplaceId, { canView, canEdit });
      return next;
    });
    try {
      const res = await fetch('/api/admin/marketplace-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId, marketplaceId, canView, canEdit }),
      });
      if (!res.ok) {
        // Revert on failure
        setPermMap(buildPermMap(selectedUserId));
      } else {
        // Update users state to keep in sync
        setUsers(prev => prev.map(u => {
          if (u.id !== selectedUserId) return u;
          const existing = u.permissions.find(p => p.marketplaceId === marketplaceId);
          if (existing) {
            return { ...u, permissions: u.permissions.map(p => p.marketplaceId === marketplaceId ? { ...p, canView, canEdit } : p) };
          }
          return { ...u, permissions: [...u.permissions, { marketplaceId, canView, canEdit }] };
        }));
      }
    } catch (err) {
      logger.error('Failed to update permission:', err);
      setPermMap(buildPermMap(selectedUserId));
    } finally {
      setSaving(null);
    }
  };

  const deletePermission = async (marketplaceId: string) => {
    setSaving(marketplaceId);
    // Optimistic update
    setPermMap(prev => {
      const next = new Map(prev);
      next.delete(marketplaceId);
      return next;
    });
    try {
      const res = await fetch('/api/admin/marketplace-permissions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId, marketplaceId }),
      });
      if (!res.ok) {
        setPermMap(buildPermMap(selectedUserId));
      } else {
        setUsers(prev => prev.map(u => {
          if (u.id !== selectedUserId) return u;
          return { ...u, permissions: u.permissions.filter(p => p.marketplaceId !== marketplaceId) };
        }));
      }
    } catch (err) {
      logger.error('Failed to delete permission:', err);
      setPermMap(buildPermMap(selectedUserId));
    } finally {
      setSaving(null);
    }
  };

  const handleCanViewChange = (marketplaceId: string, checked: boolean) => {
    const current = permMap.get(marketplaceId);
    if (!checked) {
      // Removing view also removes edit
      if (current) {
        deletePermission(marketplaceId);
      }
    } else {
      upsertPermission(marketplaceId, true, current?.canEdit ?? false);
    }
  };

  const handleCanEditChange = (marketplaceId: string, checked: boolean) => {
    if (checked) {
      // Enabling edit implicitly enables view
      upsertPermission(marketplaceId, true, true);
    } else {
      upsertPermission(marketplaceId, true, false);
    }
  };

  const grantAll = () => {
    marketplaces.forEach(m => upsertPermission(m.id, true, true));
  };

  const revokeAll = () => {
    marketplaces.forEach(m => {
      if (permMap.has(m.id)) deletePermission(m.id);
    });
  };

  if (role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-64">
        <p className="text-gray-500">Bu sayfaya erişim izniniz yok.</p>
      </div>
    );
  }

  const selectedUser = users.find(u => u.id === selectedUserId);
  const permCount = permMap.size;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-8 h-8 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900">Pazar Yeri İzinleri</h1>
        </div>
        <p className="text-gray-600">
          OPERATOR kullanıcılarının hangi pazar yerlerini görüntüleyip düzenleyebileceğini yönetin.
        </p>
      </div>

      {/* User Selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Kullanıcı Seç</label>
        {loading ? (
          <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-500">Sistemde OPERATOR rolünde aktif kullanıcı bulunmuyor.</p>
        ) : (
          <div className="relative">
            <select
              value={selectedUserId}
              onChange={e => handleUserChange(e.target.value)}
              className="w-full appearance-none px-4 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="">— Kullanıcı seçin —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {/* Permission Matrix */}
      {selectedUserId && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Matrix Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div>
              <p className="text-sm font-semibold text-gray-900">{selectedUser?.name}</p>
              <p className="text-xs text-gray-500">{selectedUser?.email}</p>
            </div>
            <div className="flex items-center gap-2">
              {permCount === 0 && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mr-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Hiç izin yok — talep oluşturamaz
                </div>
              )}
              <button
                onClick={grantAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                Tümünü Ver
              </button>
              <button
                onClick={revokeAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                Tümünü Kaldır
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Pazar Yeri
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider w-28">
                    Görüntüle
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider w-28">
                    Düzenle
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {marketplaces.map(marketplace => {
                  const perm = permMap.get(marketplace.id);
                  const isSaving = saving === marketplace.id;
                  return (
                    <tr key={marketplace.id} className={`hover:bg-gray-50 ${isSaving ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          {marketplace.colorTag && (
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: marketplace.colorTag }}
                            />
                          )}
                          <span className="text-sm font-medium text-gray-900">{marketplace.name}</span>
                          <span className="text-xs text-gray-400 font-mono">{marketplace.code}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={perm?.canView ?? false}
                          disabled={isSaving}
                          onChange={e => handleCanViewChange(marketplace.id, e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={perm?.canEdit ?? false}
                          disabled={isSaving}
                          onChange={e => handleCanEditChange(marketplace.id, e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
