/**
 * ManuMaestro Database Seed Script
 *
 * This script creates initial data:
 * - Default marketplaces (Amazon US, EU, UK, CA, AU, Wayfair US, UK, etc.)
 * - Admin user
 */

import { PrismaClient, MarketplaceType, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Explicitly disable env variable fallback
  user: undefined,
  database: undefined,
  password: undefined,
  host: undefined,
  port: undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🎼 Starting ManuMaestro database seed...\n');

  // ============================================
  // 1. CREATE DEFAULT ADMIN USER
  // ============================================
  console.log('👤 Creating admin user...');

  const generatedPassword = crypto.randomBytes(16).toString('hex');
  const adminPassword = await bcrypt.hash(generatedPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@iwa.web.tr' },
    update: {},
    create: {
      email: 'admin@iwa.web.tr',
      name: 'Admin User',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  console.log(`✅ Admin user created: ${admin.email}`);
  console.log(`   Generated password: ${generatedPassword}`);
  console.log(`   ⚠️  Save this password now — it will not be shown again.\n`);

  // ============================================
  // 2. CREATE DEFAULT MARKETPLACES
  // ============================================
  console.log('🏪 Creating default marketplaces...\n');

  const marketplaces = [
    // Amazon marketplaces
    {
      name: 'Amazon US',
      code: 'AMZN_US',
      marketplaceType: MarketplaceType.AMAZON,
      region: 'US',
      colorTag: '#FF9900',
      isCustom: false,
    },
    {
      name: 'Amazon EU',
      code: 'AMZN_EU',
      marketplaceType: MarketplaceType.AMAZON,
      region: 'EU',
      colorTag: '#FF9900',
      isCustom: false,
    },
    {
      name: 'Amazon UK',
      code: 'AMZN_UK',
      marketplaceType: MarketplaceType.AMAZON,
      region: 'UK',
      colorTag: '#FF9900',
      isCustom: false,
    },
    {
      name: 'Amazon CA',
      code: 'AMZN_CA',
      marketplaceType: MarketplaceType.AMAZON,
      region: 'CA',
      colorTag: '#FF9900',
      isCustom: false,
    },
    {
      name: 'Amazon AU',
      code: 'AMZN_AU',
      marketplaceType: MarketplaceType.AMAZON,
      region: 'AU',
      colorTag: '#FF9900',
      isCustom: false,
    },

    // Wayfair marketplaces
    {
      name: 'Wayfair US',
      code: 'WAYFAIR_US',
      marketplaceType: MarketplaceType.WAYFAIR,
      region: 'US',
      colorTag: '#7B16FF',
      isCustom: false,
    },
    {
      name: 'Wayfair UK',
      code: 'WAYFAIR_UK',
      marketplaceType: MarketplaceType.WAYFAIR,
      region: 'UK',
      colorTag: '#7B16FF',
      isCustom: false,
    },

    // Other marketplaces
    {
      name: 'Takealot',
      code: 'TAKEALOT_ZA',
      marketplaceType: MarketplaceType.TAKEALOT,
      region: 'ZA',
      colorTag: '#0B79BF',
      isCustom: false,
    },
    {
      name: 'Bol',
      code: 'BOL_NL',
      marketplaceType: MarketplaceType.BOL,
      region: 'NL',
      colorTag: '#0080FF',
      isCustom: false,
    },
  ];

  let createdCount = 0;
  let skippedCount = 0;

  for (const marketplace of marketplaces) {
    const existing = await prisma.marketplace.findUnique({
      where: { code: marketplace.code },
    });

    if (existing) {
      console.log(`⏭️  Skipped: ${marketplace.name} (already exists)`);
      skippedCount++;
    } else {
      await prisma.marketplace.create({
        data: {
          ...marketplace,
          createdById: admin.id,
        },
      });
      console.log(`✅ Created: ${marketplace.name}`);
      createdCount++;
    }
  }

  console.log(`\n📊 Marketplace summary:`);
  console.log(`   Created: ${createdCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  console.log(`   Total: ${marketplaces.length}\n`);

  // ============================================
  // 3. GRANT ADMIN PERMISSIONS TO ALL MARKETPLACES
  // ============================================
  console.log('🔑 Granting admin permissions to all marketplaces...');

  const allMarketplaces = await prisma.marketplace.findMany();

  for (const marketplace of allMarketplaces) {
    await prisma.userMarketplacePermission.upsert({
      where: {
        userId_marketplaceId: {
          userId: admin.id,
          marketplaceId: marketplace.id,
        },
      },
      update: {},
      create: {
        userId: admin.id,
        marketplaceId: marketplace.id,
        canView: true,
        canEdit: true,
      },
    });
  }

  console.log(`✅ Admin granted access to ${allMarketplaces.length} marketplaces\n`);

  // ============================================
  // SUMMARY
  // ============================================
  console.log('🎉 Seed completed successfully!\n');
  console.log('📝 Next steps:');
  console.log('   1. Update .env with correct database password');
  console.log('   2. Run: npm run db:migrate');
  console.log('   3. Login with: admin@iwa.web.tr and the generated password above');
  console.log('   4. Change the admin password after first login!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
