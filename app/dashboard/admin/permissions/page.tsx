/**
 * Admin Permissions Page
 * Manage per-marketplace and per-category access for OPERATOR users
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Shield, ChevronDown, AlertTriangle, CheckSquare, Square, ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AdminPermissionsPage');

interface OperatorUser {
  id: string;
  name: string;
  email: string;
  permissions: { marketplaceId: string; canView: boolean; canEdit: boolean }[];
  categoryPermissions: { category: string; canView: boolean; canEdit: boolean }[];
}

interface MarketplaceOption {
  id: string;
  name: string;
  code: string;
  colorTag: string | null;
}

type PermMap = Map<string, { canView: boolean; canEdit: boolean }>;
type CatPermMap = Map<string, { canView: boolean; canEdit: boolean }>;

export default function AdminPermissionsPage() {
  const { role } = useAuth();
  const [activeTab, setActiveTab] = useState<'marketplace' | 'category'>('marketplace');

  // Marketplace tab state
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [marketplaces, setMarketplaces] = useState<MarketplaceOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [permMap, setPermMap] = useState<PermMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Category tab state
  const [catUsers, setCatUsers] = useState<OperatorUser[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [catSelectedUserId, setCatSelectedUserId] = useState<string>('');
  const [catPermMap, setCatPermMap] = useState<CatPermMap>(new Map());
  const [catLoading, setCatLoading] = useState(true);
  const [catSaving, setCatSaving] = useState<string | null>(null);

  // SSO sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const fetchMarketplaceData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/marketplace-permissions');
      const data = await res.json();
      if (data.success) {
        setUsers(data.data.users);
        setMarketplaces(data.data.marketplaces);
      }
    } catch (err) {
      logger.error('Failed to fetch marketplace permissions data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCatData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/category-permissions');
      const data = await res.json();
      if (data.success) {
        setCatUsers(data.data.users);
        setCategories(data.data.categories);
      }
    } catch (err) {
      logger.error('Failed to fetch category permissions data:', err);
    } finally {
      setCatLoading(false);
    }
  }, []);

  // Load data on mount
  useEffect(() => { fetchMarketplaceData(); }, [fetchMarketplaceData]);
  useEffect(() => { fetchCatData(); }, [fetchCatData]);

  // SSO sync: fetch users from SSO and upsert into local DB
  const syncUsers = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/admin/sync-users', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSyncResult(`${data.data.synced} kullanıcı senkronize edildi`);
        // Reload both tabs
        await Promise.all([fetchMarketplaceData(), fetchCatData()]);
      } else {
        setSyncResult(data.error || 'Senkronizasyon başarısız');
      }
    } catch (err) {
      logger.error('SSO sync failed:', err);
      setSyncResult('Senkronizasyon hatası');
    } finally {
      setSyncing(false);
    }
  };

  // --- Marketplace helpers ---
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
    setPermMap(prev => { const next = new Map(prev); next.set(marketplaceId, { canView, canEdit }); return next; });
    try {
      const res = await fetch('/api/admin/marketplace-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId, marketplaceId, canView, canEdit }),
      });
      if (!res.ok) {
        setPermMap(buildPermMap(selectedUserId));
      } else {
        setUsers(prev => prev.map(u => {
          if (u.id !== selectedUserId) return u;
          const existing = u.permissions.find(p => p.marketplaceId === marketplaceId);
          if (existing) return { ...u, permissions: u.permissions.map(p => p.marketplaceId === marketplaceId ? { ...p, canView, canEdit } : p) };
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
    setPermMap(prev => { const next = new Map(prev); next.delete(marketplaceId); return next; });
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
    if (!checked) { if (current) deletePermission(marketplaceId); }
    else { upsertPermission(marketplaceId, true, current?.canEdit ?? false); }
  };

  const handleCanEditChange = (marketplaceId: string, checked: boolean) => {
    if (checked) { upsertPermission(marketplaceId, true, true); }
    else { upsertPermission(marketplaceId, true, false); }
  };

  const grantAll = () => { marketplaces.forEach(m => upsertPermission(m.id, true, true)); };
  const revokeAll = () => { marketplaces.forEach(m => { if (permMap.has(m.id)) deletePermission(m.id); }); };

  // --- Category helpers ---
  const buildCatPermMap = useCallback((userId: string): CatPermMap => {
    const user = catUsers.find(u => u.id === userId);
    if (!user) return new Map();
    return new Map(user.categoryPermissions.map(p => [p.category, { canView: p.canView, canEdit: p.canEdit }]));
  }, [catUsers]);

  const handleCatUserChange = (userId: string) => {
    setCatSelectedUserId(userId);
    setCatPermMap(buildCatPermMap(userId));
  };

  const upsertCatPermission = async (category: string, canView: boolean, canEdit: boolean) => {
    setCatSaving(category);
    setCatPermMap(prev => { const next = new Map(prev); next.set(category, { canView, canEdit }); return next; });
    try {
      const res = await fetch('/api/admin/category-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: catSelectedUserId, category, canView, canEdit }),
      });
      if (!res.ok) {
        setCatPermMap(buildCatPermMap(catSelectedUserId));
      } else {
        setCatUsers(prev => prev.map(u => {
          if (u.id !== catSelectedUserId) return u;
          const existing = u.categoryPermissions.find(p => p.category === category);
          if (existing) return { ...u, categoryPermissions: u.categoryPermissions.map(p => p.category === category ? { ...p, canView, canEdit } : p) };
          return { ...u, categoryPermissions: [...u.categoryPermissions, { category, canView, canEdit }] };
        }));
      }
    } catch (err) {
      logger.error('Failed to update category permission:', err);
      setCatPermMap(buildCatPermMap(catSelectedUserId));
    } finally {
      setCatSaving(null);
    }
  };

  const deleteCatPermission = async (category: string) => {
    setCatSaving(category);
    setCatPermMap(prev => { const next = new Map(prev); next.delete(category); return next; });
    try {
      const res = await fetch('/api/admin/category-permissions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: catSelectedUserId, category }),
      });
      if (!res.ok) {
        setCatPermMap(buildCatPermMap(catSelectedUserId));
      } else {
        setCatUsers(prev => prev.map(u => {
          if (u.id !== catSelectedUserId) return u;
          return { ...u, categoryPermissions: u.categoryPermissions.filter(p => p.category !== category) };
        }));
      }
    } catch (err) {
      logger.error('Failed to delete category permission:', err);
      setCatPermMap(buildCatPermMap(catSelectedUserId));
    } finally {
      setCatSaving(null);
    }
  };

  const handleCatCanViewChange = (category: string, checked: boolean) => {
    const current = catPermMap.get(category);
    if (!checked) { if (current) deleteCatPermission(category); }
    else { upsertCatPermission(category, true, current?.canEdit ?? false); }
  };

  const handleCatCanEditChange = (category: string, checked: boolean) => {
    if (checked) { upsertCatPermission(category, true, true); }
    else { upsertCatPermission(category, true, false); }
  };

  const grantAllCat = () => { categories.forEach(c => upsertCatPermission(c, true, true)); };
  const revokeAllCat = () => { categories.forEach(c => { if (catPermMap.has(c)) deleteCatPermission(c); }); };

  if (role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-64">
        <p className="text-gray-500">Bu sayfaya erişim izniniz yok.</p>
      </div>
    );
  }

  const selectedUser = users.find(u => u.id === selectedUserId);
  const catSelectedUser = catUsers.find(u => u.id === catSelectedUserId);

  return (
    <div className="space-y-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Ana sayfaya dön
      </Link>

      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-8 h-8 text-purple-600" />
            <h1 className="text-3xl font-bold text-gray-900">İzin Yönetimi</h1>
          </div>
          <p className="text-gray-600">
            OPERATOR kullanıcılarının pazar yeri ve kategori erişimlerini yönetin.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={syncUsers}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Senkronize ediliyor...' : 'SSO Senkronize Et'}
          </button>
          {syncResult && (
            <span className="text-xs text-gray-500">{syncResult}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0">
          <button
            onClick={() => setActiveTab('marketplace')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'marketplace'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Pazar Yeri İzinleri
          </button>
          <button
            onClick={() => setActiveTab('category')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'category'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Kategori İzinleri
          </button>
        </nav>
      </div>

      {/* Marketplace Tab */}
      {activeTab === 'marketplace' && (
        <>
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

          {selectedUserId && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selectedUser?.name}</p>
                  <p className="text-xs text-gray-500">{selectedUser?.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {permMap.size === 0 && (
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
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Pazar Yeri</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider w-28">Görüntüle</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider w-28">Düzenle</th>
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
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: marketplace.colorTag }} />
                              )}
                              <span className="text-sm font-medium text-gray-900">{marketplace.name}</span>
                              <span className="text-xs text-gray-400 font-mono">{marketplace.code}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input type="checkbox" checked={perm?.canView ?? false} disabled={isSaving}
                              onChange={e => handleCanViewChange(marketplace.id, e.target.checked)}
                              className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input type="checkbox" checked={perm?.canEdit ?? false} disabled={isSaving}
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
        </>
      )}

      {/* Category Tab */}
      {activeTab === 'category' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Kullanıcı Seç</label>
            {catLoading ? (
              <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ) : catUsers.length === 0 ? (
              <p className="text-sm text-gray-500">Sistemde OPERATOR rolünde aktif kullanıcı bulunmuyor.</p>
            ) : (
              <div className="relative">
                <select
                  value={catSelectedUserId}
                  onChange={e => handleCatUserChange(e.target.value)}
                  className="w-full appearance-none px-4 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="">— Kullanıcı seçin —</option>
                  {catUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          {catSelectedUserId && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{catSelectedUser?.name}</p>
                  <p className="text-xs text-gray-500">{catSelectedUser?.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {catPermMap.size === 0 && categories.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mr-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Hiç kategori izni yok — hiçbir kategoriyi düzenleyemez
                    </div>
                  )}
                  <button
                    onClick={grantAllCat}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    Tümünü Ver
                  </button>
                  <button
                    onClick={revokeAllCat}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Tümünü Kaldır
                  </button>
                </div>
              </div>
              {categories.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-gray-500">
                  Sistemde henüz üretim talebi kategorisi bulunmuyor.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Kategori</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider w-28">Görüntüle</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider w-28">Düzenle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {categories.map(category => {
                        const perm = catPermMap.get(category);
                        const isSaving = catSaving === category;
                        return (
                          <tr key={category} className={`hover:bg-gray-50 ${isSaving ? 'opacity-50' : ''}`}>
                            <td className="px-6 py-3">
                              <span className="text-sm font-medium text-gray-900">{category}</span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input type="checkbox" checked={perm?.canView ?? false} disabled={isSaving}
                                onChange={e => handleCatCanViewChange(category, e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input type="checkbox" checked={perm?.canEdit ?? false} disabled={isSaving}
                                onChange={e => handleCatCanEditChange(category, e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer disabled:cursor-not-allowed"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
