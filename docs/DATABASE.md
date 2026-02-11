# Database Management Guide

## Overview

ManuMaestro uses **PostgreSQL** as its database with **Prisma ORM** for schema management and migrations. This document outlines best practices and procedures for database operations.

## Technology Stack

- **Database**: PostgreSQL 15+
- **ORM**: Prisma 7.2.0
- **Migration Tool**: Prisma Migrate

---

## Development Workflow

### 1. Making Schema Changes

When you need to modify the database schema:

```bash
# 1. Edit the schema file
vim prisma/schema.prisma

# 2. Create a migration
npm run db:migrate

# 3. Name your migration descriptively
# Examples:
#   - add_user_permissions
#   - add_workflow_stage_field
#   - create_audit_logs_table
```

### 2. Migration Naming Convention

Use descriptive, snake_case names that clearly indicate what the migration does:

✅ **Good**:
- `add_produced_quantity_field`
- `create_marketplace_table`
- `add_status_index`
- `rename_quantity_to_requested_quantity`

❌ **Bad**:
- `migration_1`
- `update`
- `fix`
- `changes`

### 3. Reviewing Migrations

Before applying a migration, always review the generated SQL:

```bash
# View the migration SQL
cat prisma/migrations/YYYYMMDDHHMMSS_migration_name/migration.sql
```

Check for:
- Data loss (DROP statements)
- Missing default values for NOT NULL columns
- Index creation on large tables (might cause locks)
- Foreign key constraints

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] Database backup completed
- [ ] Migration tested in staging environment
- [ ] Migration is backwards-compatible (if doing zero-downtime deployment)
- [ ] Rollback plan prepared
- [ ] Maintenance window scheduled (if needed)

### Deployment Steps

#### 1. Backup Database

```bash
# Connect to production server
ssh -p 2222 root@78.47.117.36

# Create backup
pg_dump -U postgres manumaestro_db > /var/backups/manumaestro_$(date +%Y%m%d_%H%M%S).sql

# Verify backup
ls -lh /var/backups/manumaestro_*.sql
```

#### 2. Deploy Migration

```bash
# Navigate to project directory
cd /var/www/manumaestro

# Pull latest code
git pull

# Install dependencies (if package.json changed)
npm install

# Run migrations
npx prisma migrate deploy

# Verify migration status
npx prisma migrate status
```

#### 3. Restart Application

```bash
# Rebuild application
npm run build

# Restart PM2
pm2 restart manumaestro

# Check logs
pm2 logs manumaestro --lines 50
```

#### 4. Smoke Testing

After deployment, verify:
- Application starts without errors
- Database connections work
- Critical features function correctly
- No migration-related errors in logs

---

## Rollback Procedures

### Option 1: Restore from Backup (Safest)

```bash
# Stop application
pm2 stop manumaestro

# Drop and recreate database
psql -U postgres -c "DROP DATABASE manumaestro_db;"
psql -U postgres -c "CREATE DATABASE manumaestro_db;"

# Restore backup
psql -U postgres manumaestro_db < /var/backups/manumaestro_TIMESTAMP.sql

# Restart application
pm2 restart manumaestro
```

### Option 2: Revert Migration (If Safe)

⚠️ **Warning**: Only use if migration is reversible and no data has been written to new schema.

```bash
# Revert to specific migration
npx prisma migrate resolve --rolled-back MIGRATION_NAME

# Reset database to previous state (DEVELOPMENT ONLY!)
# DO NOT USE IN PRODUCTION
npx prisma migrate reset
```

---

## Common Migration Scenarios

### Adding a New Field

```prisma
// prisma/schema.prisma
model ProductionRequest {
  // ... existing fields
  manufacturerNotes String? // New field
}
```

```bash
npm run db:migrate
# Name: add_manufacturer_notes_field
```

### Adding a Required Field with Default

```prisma
model ProductionRequest {
  // ... existing fields
  priority Priority @default(NORMAL)
}

enum Priority {
  LOW
  NORMAL
  HIGH
  URGENT
}
```

### Renaming a Field

```prisma
model ProductionRequest {
  // Before: quantity Int
  // After:
  requestedQuantity Int // Renamed from quantity
}
```

⚠️ **Important**: Prisma will DROP and CREATE, losing data! Instead:

1. Add new field
2. Migrate data (custom SQL)
3. Remove old field in separate migration

### Adding an Index

```prisma
model ProductionRequest {
  // ... fields

  @@index([productCategory, productionMonth])
}
```

---

## Migration History

### Current Migrations

```bash
# List all migrations
ls -la prisma/migrations/

# View migration status
npx prisma migrate status
```

### Initial Migration

- **20260119123744_init**: Initial database schema
  - Created all base tables
  - Set up relationships
  - Added initial indexes

---

## Best Practices

### 1. Always Backup Before Migrating

```bash
# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U postgres manumaestro_db > /var/backups/manumaestro_$DATE.sql
echo "Backup created: /var/backups/manumaestro_$DATE.sql"
```

### 2. Test Migrations in Development First

```bash
# Development: Safe to test
npm run db:migrate

# If issues occur, can reset:
npx prisma migrate reset
```

### 3. Never Edit Migration Files Manually

❌ **Never** edit `migration.sql` files after they're created

✅ **Instead**: Create a new migration to fix issues

### 4. Use Transactions for Data Migrations

```sql
-- migration.sql
BEGIN;

-- Schema changes
ALTER TABLE production_requests ADD COLUMN new_field TEXT;

-- Data migration
UPDATE production_requests SET new_field = 'default_value' WHERE new_field IS NULL;

-- Constraint
ALTER TABLE production_requests ALTER COLUMN new_field SET NOT NULL;

COMMIT;
```

### 5. Monitor Long-Running Migrations

For large tables, migrations might take time:

```sql
-- Check migration progress
SELECT pid, state, query
FROM pg_stat_activity
WHERE datname = 'manumaestro_db';
```

---

## Troubleshooting

### Migration Fails Mid-Way

```bash
# Check migration status
npx prisma migrate status

# If migration is partially applied, mark as rolled back
npx prisma migrate resolve --rolled-back MIGRATION_NAME

# Restore from backup
psql -U postgres manumaestro_db < backup.sql
```

### Schema Drift Detected

```bash
# Prisma detected manual changes
# Option 1: Create migration from current state
npx prisma migrate dev --create-only

# Option 2: Reset to match schema (DEVELOPMENT ONLY)
npx prisma db push --force-reset
```

### Connection Issues

```bash
# Test database connection
npx prisma db execute --stdin <<< "SELECT 1;"

# Check connection string
cat .env | grep DATABASE_URL
```

---

## Environment Variables

### Development

```bash
DATABASE_URL="postgresql://username:password@localhost:5432/manumaestro_dev"
```

### Production

```bash
DATABASE_URL="postgresql://username:password@host:5432/manumaestro_db?schema=public"
```

### Connection Pooling (Optional)

For high-traffic applications:

```bash
DATABASE_URL="postgresql://username:password@host:5432/manumaestro_db?pgbouncer=true&connection_limit=10"
```

---

## Backup Strategy

### Automated Backups (Recommended)

```bash
# Add to crontab
crontab -e

# Daily backup at 2 AM
0 2 * * * /usr/local/bin/backup-manumaestro.sh

# Weekly backup retention (keep last 4 weeks)
0 3 * * 0 find /var/backups/manumaestro_*.sql -mtime +28 -delete
```

### Backup Script

```bash
#!/bin/bash
# /usr/local/bin/backup-manumaestro.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups"
DB_NAME="manumaestro_db"

# Create backup
pg_dump -U postgres $DB_NAME | gzip > $BACKUP_DIR/manumaestro_$DATE.sql.gz

# Verify backup
if [ $? -eq 0 ]; then
    echo "✓ Backup successful: manumaestro_$DATE.sql.gz"
else
    echo "✗ Backup failed!"
    exit 1
fi
```

---

## Resources

- [Prisma Migrate Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Project Prisma Schema](../prisma/schema.prisma)

---

**Last Updated**: February 11, 2026
**Maintained By**: Development Team
