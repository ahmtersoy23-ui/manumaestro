# 🎼 ManuMaestro - Setup Instructions

## 📋 Prerequisites Checklist

- [x] Node.js 18+ installed
- [x] PostgreSQL server accessible (78.47.117.36)
- [ ] PostgreSQL password for 'pricelab' user
- [ ] SSH access to server (optional, for database creation)

---

## 🚀 Setup Steps

### Step 1: Update Environment Variables

Edit the `.env` file and replace `your_password` with the actual PostgreSQL password:

```bash
# Open .env file
nano .env

# Update this line:
DATABASE_URL="postgresql://pricelab:YOUR_ACTUAL_PASSWORD@78.47.117.36:5432/manumaestro_db?schema=public"
PRODUCT_DB_URL="postgresql://pricelab:YOUR_ACTUAL_PASSWORD@78.47.117.36:5432/pricelab_db?schema=public"
```

### Step 2: Create Database on Server

Connect to the server and create the database:

```bash
# SSH to server
ssh root@78.47.117.36

# Connect to PostgreSQL
sudo -u postgres psql

# Create database
CREATE DATABASE manumaestro_db;

# Grant permissions
GRANT ALL PRIVILEGES ON DATABASE manumaestro_db TO pricelab;

# Exit
\q
exit
```

### Step 3: Generate Prisma Client

```bash
cd ~/Desktop/manumaestro
npm run db:generate
```

### Step 4: Run Database Migration

This will create all tables in the database:

```bash
npm run db:migrate
```

When prompted for migration name, use: `init`

### Step 5: Seed Initial Data

This will create:
- Default admin user
- All default marketplaces (Amazon US/EU/UK/CA/AU, Wayfair US/UK, Takealot, Bol)
- Admin permissions

```bash
npm run db:seed
```

### Step 6: Start Development Server

```bash
npm run dev
```

Open browser: [http://localhost:3000](http://localhost:3000)

---

## 🔐 First Login

**Email**: `admin@iwa.web.tr`
**Password**: `admin123`

**⚠️ IMPORTANT**: Change this password immediately after first login!

---

## 📊 Verify Setup

### Check Database Tables

```bash
# SSH to server
ssh root@78.47.117.36

# Connect to database
sudo -u postgres psql -d manumaestro_db

# List tables
\dt

# Check users
SELECT * FROM users;

# Check marketplaces
SELECT * FROM marketplaces;

# Exit
\q
```

Expected tables:
- `users`
- `marketplaces`
- `user_marketplace_permissions`
- `production_requests`
- `_prisma_migrations`

### Open Prisma Studio (Optional)

Visual database browser:

```bash
npm run db:studio
```

Opens at: [http://localhost:5555](http://localhost:5555)

---

## 🛠️ Troubleshooting

### Problem: "Can't reach database server"

**Solution**: Check if PostgreSQL allows remote connections:

```bash
# On server:
sudo nano /etc/postgresql/*/main/postgresql.conf

# Ensure this line exists:
listen_addresses = '*'

# Then check pg_hba.conf:
sudo nano /etc/postgresql/*/main/pg_hba.conf

# Add this line:
host    all             all             0.0.0.0/0               md5

# Restart PostgreSQL:
sudo systemctl restart postgresql
```

### Problem: "Password authentication failed"

**Solution**: Verify password in `.env` file is correct

### Problem: "Database does not exist"

**Solution**: Create database manually (see Step 2)

### Problem: Prisma migration fails

**Solution**:
```bash
# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# Or manually drop and recreate:
# ssh root@78.47.117.36
# sudo -u postgres psql
# DROP DATABASE manumaestro_db;
# CREATE DATABASE manumaestro_db;
# \q
```

---

## 📦 Next Development Steps

### 1. Authentication System
- [ ] Login page
- [ ] JWT token generation
- [ ] Protected routes
- [ ] Session management

### 2. Dashboard Layout
- [ ] Navigation bar
- [ ] Sidebar with marketplace list
- [ ] User menu
- [ ] Responsive design

### 3. Marketplace Entry Pages
- [ ] Dynamic marketplace routing
- [ ] Manual entry form
- [ ] Excel upload component
- [ ] Product autocomplete (from pricelab_db.products)

### 4. API Routes
- [ ] `/api/auth/login`
- [ ] `/api/auth/logout`
- [ ] `/api/marketplaces`
- [ ] `/api/requests`
- [ ] `/api/products` (query pricelab_db)

### 5. Manufacturer Dashboard
- [ ] Aggregated view
- [ ] Multi-column breakdown
- [ ] Category filters
- [ ] Export to Excel

---

## 🔧 Useful Commands

```bash
# Development
npm run dev                 # Start dev server
npm run build              # Production build
npm run start              # Start production server

# Database
npm run db:generate        # Generate Prisma Client
npm run db:migrate         # Run migrations
npm run db:seed            # Seed data
npm run db:studio          # Open Prisma Studio

# Code Quality
npm run lint               # Run ESLint
```

---

## 📞 Support

For issues or questions:
- Check [README.md](README.md) for project overview
- Review Prisma schema: [prisma/schema.prisma](prisma/schema.prisma)
- Inspect seed data: [prisma/seed.ts](prisma/seed.ts)

---

**ManuMaestro** - *Orchestrating Production Excellence* 🎼
