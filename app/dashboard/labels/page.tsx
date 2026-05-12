/**
 * Etiket Bas — Server Component.
 *
 * URL searchParams: ?search=...&category=...&parent=...&page=N
 * pricelab_db.products doğrudan server'da sorgulanır (queryProductDb).
 * Search input debounce + URL state + modal interactivity LabelsClient'te.
 */

import { Printer } from 'lucide-react';
import { queryProductDb } from '@/lib/db/prisma';
import { LabelsClient, type ProductDTO, type PaginationDTO } from './LabelsClient';

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ search?: string; category?: string; parent?: string; page?: string }>;
}

type Row = {
  iwasku: string;
  product_name: string;
  category: string | null;
  parent: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  weight: string | null;
  verified_package: boolean | null;
};
type CountRow = { count: string };
type StrRow = { value: string };

async function loadProducts(search: string, category: string, parent: string, page: number) {
  const offset = (page - 1) * PAGE_SIZE;
  const conditions: string[] = ['product_sku IS NOT NULL', 'name IS NOT NULL'];
  const params: (string | number)[] = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(LOWER(product_sku) LIKE LOWER($${params.length}) OR LOWER(name) LIKE LOWER($${params.length}))`);
  }
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (parent) {
    params.push(parent);
    conditions.push(`parent = $${params.length}`);
  }
  const whereSql = conditions.join(' AND ');

  const countResult = (await queryProductDb(
    `SELECT COUNT(*) AS count FROM products WHERE ${whereSql}`,
    params,
  )) as CountRow[];
  const total = parseInt(countResult[0].count, 10);

  params.push(PAGE_SIZE, offset);
  const rows = (await queryProductDb(
    `SELECT product_sku AS iwasku, name AS product_name, category, parent, width, length, height, weight, verified_package
     FROM products
     WHERE ${whereSql}
     ORDER BY name
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )) as Row[];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { rows, total, totalPages };
}

async function loadFilters(category: string) {
  const categoryRows = (await queryProductDb(
    `SELECT DISTINCT category AS value FROM products
     WHERE category IS NOT NULL AND category <> ''
     ORDER BY value`,
    [],
  )) as StrRow[];

  let parentRows: StrRow[] = [];
  if (category) {
    parentRows = (await queryProductDb(
      `SELECT DISTINCT parent AS value FROM products
       WHERE category = $1 AND parent IS NOT NULL AND parent <> ''
       ORDER BY value`,
      [category],
    )) as StrRow[];
  }

  return {
    categories: categoryRows.map(r => r.value),
    parents: parentRows.map(r => r.value),
  };
}

export default async function LabelsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const search = (sp.search ?? '').slice(0, 100);
  const category = (sp.category ?? '').slice(0, 200);
  const parent = (sp.parent ?? '').slice(0, 200);
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [products, filters] = await Promise.all([
    loadProducts(search, category, parent, page),
    loadFilters(category),
  ]);

  const initialProducts: ProductDTO[] = products.rows;
  const pagination: PaginationDTO = {
    page,
    pageSize: PAGE_SIZE,
    total: products.total,
    totalPages: products.totalPages,
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Printer className="w-6 h-6 text-purple-600" />
          Etiket Bas
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Katalogdaki herhangi bir ürün için 100×30 mm QR etiketi bas.
        </p>
      </div>

      <LabelsClient
        initialProducts={initialProducts}
        pagination={pagination}
        categories={filters.categories}
        parents={filters.parents}
        currentSearch={search}
        currentCategory={category}
        currentParent={parent}
      />
    </div>
  );
}
