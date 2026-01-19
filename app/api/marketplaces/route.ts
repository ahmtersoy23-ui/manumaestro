/**
 * Marketplaces API
 * GET: List all active marketplaces
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  try {
    const marketplaces = await prisma.marketplace.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return NextResponse.json({
      success: true,
      data: marketplaces,
    });
  } catch (error) {
    console.error('Fetch marketplaces error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch marketplaces',
      },
      { status: 500 }
    );
  }
}
