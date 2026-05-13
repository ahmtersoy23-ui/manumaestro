/**
 * Marketplaces API
 * GET: List all active marketplaces
 * POST: Create new custom marketplace
 */

import { prisma } from '@/lib/db/prisma';
import { logAction } from '@/lib/auditLog';
import { MarketplaceCreateSchema, formatValidationError } from '@/lib/validation/schemas';
import { successResponse, createdResponse } from '@/lib/api/response';
import { ValidationError, NotFoundError } from '@/lib/api/errors';
import { z } from 'zod';
import { withRoute } from '@/lib/api/withRoute';

export const GET = withRoute(
  { rateLimit: 'read', fallbackMessage: 'Pazar yerleri getirilemedi' },
  async ({ request }) => {
    const searchParams = request.nextUrl.searchParams;

    // Pagination parameters
    const rawPage = parseInt(searchParams.get('page') || '1');
    const rawLimit = parseInt(searchParams.get('limit') || '50');
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const skip = (page - 1) * limit;

    const where = { isActive: true };

    const [marketplaces, total] = await Promise.all([
      prisma.marketplace.findMany({
        where,
        orderBy: {
          name: 'asc',
        },
        skip,
        take: limit,
      }),
      prisma.marketplace.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return successResponse(marketplaces, {
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  }
);

export const POST = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Pazar yeri oluşturulamadı' },
  async ({ request, user }) => {
    const body = await request.json();

    // Validate with Zod
    const validation = MarketplaceCreateSchema.safeParse(body);
    if (!validation.success) {
      throw new ValidationError('Doğrulama hatası', formatValidationError(validation.error));
    }

    const { name, region, marketplaceType } = validation.data;

    // Generate unique code for custom marketplace
    const existingCustom = await prisma.marketplace.findMany({
      where: {
        code: {
          startsWith: 'CUSTOM_',
        },
      },
    });

    const nextNumber = existingCustom.length + 1;
    const code = `CUSTOM_${String(nextNumber).padStart(2, '0')}`;

    // Create marketplace
    const marketplace = await prisma.marketplace.create({
      data: {
        name,
        code,
        region,
        marketplaceType: marketplaceType || 'CUSTOM',
        isCustom: true,
        isActive: true,
        createdById: user!.id,
      },
    });

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'CREATE_MARKETPLACE',
      entityType: 'Marketplace',
      entityId: marketplace.id,
      description: `Created custom marketplace: ${name} (${region})`,
      metadata: { code, region, marketplaceType },
    });

    return createdResponse(marketplace);
  }
);

const MarketplaceUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
});

export const PATCH = withRoute(
  { roles: ['admin'], rateLimit: 'write', fallbackMessage: 'Pazar yeri güncellenemedi' },
  async ({ request, user }) => {
    const body = await request.json();
    const validation = MarketplaceUpdateSchema.safeParse(body);
    if (!validation.success) {
      throw new ValidationError('Doğrulama hatası', formatValidationError(validation.error));
    }

    const { id, name, region } = validation.data;

    const existing = await prisma.marketplace.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Pazar yeri bulunamadı');

    const data: Record<string, string> = {};
    if (name !== undefined) data.name = name;
    if (region !== undefined) data.region = region;

    const updated = await prisma.marketplace.update({ where: { id }, data });

    const changes: string[] = [];
    if (name && name !== existing.name) changes.push(`ad: ${existing.name} → ${name}`);
    if (region && region !== existing.region) changes.push(`bölge: ${existing.region} → ${region}`);

    await logAction({
      userId: user!.id,
      userName: user!.name,
      userEmail: user!.email,
      action: 'UPDATE_MARKETPLACE',
      entityType: 'Marketplace',
      entityId: id,
      description: `Pazar yeri güncellendi: ${updated.name} — ${changes.join(', ')}`,
      metadata: { old: { name: existing.name, region: existing.region }, new: { name: updated.name, region: updated.region } },
    });

    return successResponse(updated);
  }
);
