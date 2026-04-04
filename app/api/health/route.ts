import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      app: 'manumaestro',
      database: 'connected',
      uptime: process.uptime(),
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      status: 'error',
      app: 'manumaestro',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
