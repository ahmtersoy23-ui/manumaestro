# 🎼 ManuMaestro

**Production Request Management System**
*Orchestrating Production Excellence*

ManuMaestro is a comprehensive platform for managing production requests across multiple marketplaces. It consolidates orders from Amazon, Wayfair, Takealot, Bol, and other custom marketplaces into a unified manufacturing dashboard.

---

## 🎯 Features

### Multi-Marketplace Support
- ✅ **Amazon**: US, EU, UK, CA, AU (5 marketplaces)
- ✅ **Wayfair**: US, UK (2 marketplaces)
- ✅ **Takealot**: South Africa
- ✅ **Bol**: Netherlands
- ✅ **Custom Marketplaces**: Dynamically add any marketplace
- **Total Active**: 10 marketplaces configured

### Production Workflow Management
- ✅ **Kanban Board**: Visual drag-and-drop workflow management
- ✅ **6 Workflow Stages**:
  - REQUESTED → CUTTING → ASSEMBLY → QUALITY_CHECK → PACKAGING → READY_TO_SHIP
- ✅ **Category-based Workflow**: Separate boards for each product category
- ✅ **Real-time Updates**: Drag cards to update production stages instantly
- ✅ **Progress Tracking**: Monitor production status for 630+ active requests

### Data Entry Options
- ✅ **Manual Entry**: Select products via dropdown/autocomplete
- ✅ **Excel Bulk Import**: Upload spreadsheets with multiple requests (xlsx package)
- ✅ **Auto-populated Product Details**: Name and category from existing product database
- ✅ **Product Search API**: Fast IWASKU lookup from pricelab_db

### Intelligent Aggregation
- ✅ **Input/Requested View**: All marketplace requests in one place
- ✅ **Manufacturer Dashboard**: Consolidated production requirements by product
- ✅ **Multi-column Breakdown**: Exact marketplace quantity breakdown
- ✅ **Category-based Filtering**: Organize by product categories (IWA Metal, IWA Ahşap, etc.)
- ✅ **Month-based Views**: Filter requests by production month

### Authentication & Security
- ✅ **SSO Integration**: Unified authentication with apps-sso-backend
- ✅ **Role-based Access**: Admin, Operator, Viewer roles
- ✅ **Marketplace Permissions**: User-specific marketplace access control
- ✅ **Audit Trail**: Complete logging of all user actions
- ✅ **JWT Token Authentication**: Secure session management

---

## 🏗️ Technology Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL (pricelab_db + manumaestro_db)
- **ORM**: Prisma 7.2
- **Styling**: Tailwind CSS 4
- **Authentication**: SSO Integration (apps-sso-backend) + JWT
- **UI Components**: Lucide React icons
- **Drag & Drop**: @dnd-kit (core, sortable, utilities)
- **Excel Processing**: xlsx
- **Process Manager**: PM2
- **Web Server**: Nginx + Let's Encrypt SSL
- **Server**: 78.47.117.36 (Hetzner)

---

## 📦 Project Structure

```
manumaestro/
├── app/
│   ├── api/                      # API routes
│   │   ├── auth/                 # SSO authentication endpoints
│   │   ├── marketplaces/         # Marketplace CRUD operations
│   │   ├── requests/             # Production request management
│   │   ├── products/             # Product lookup from pricelab_db
│   │   ├── manufacturer/         # Manufacturer dashboard aggregation
│   │   └── workflow/             # Workflow stage updates
│   ├── dashboard/                # Main application
│   │   ├── marketplace/[slug]/   # Marketplace entry pages
│   │   ├── manufacturer/         # Manufacturer dashboard
│   │   ├── month/[month]/        # Month-based request views
│   │   └── workflow/[category]/  # Kanban workflow boards
│   ├── auth/                     # SSO login/callback pages
│   ├── middleware.ts             # SSO authentication middleware
│   └── layout.tsx                # Root layout with header/navigation
├── components/
│   ├── ui/                       # Reusable UI components
│   ├── forms/                    # Manual entry & Excel upload forms
│   └── tables/                   # Request tables & manufacturer views
├── lib/
│   ├── db/                       # Prisma client instances
│   ├── auth/                     # SSO helpers
│   ├── utils/                    # Utility functions
│   └── monthUtils.ts             # Month formatting helpers
├── prisma/
│   ├── schema.prisma             # Database schema (6 tables)
│   └── seed.ts                   # Default data seed script
├── contexts/                     # React context providers
├── types/                        # TypeScript type definitions
└── public/                       # Static assets & icons
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Access to existing products database

### Installation

1. **Clone and Install**
```bash
cd ~/Desktop/manumaestro
npm install
```

2. **Configure Environment**
```bash
# Copy example env file
cp .env.example .env

# Edit .env with your database credentials
# Required: DATABASE_URL, PRODUCT_DB_URL, JWT_SECRET
```

3. **Setup Database**
```bash
# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# (Optional) Seed initial data
npx prisma db seed
```

4. **Run Development Server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📊 Database Schema

### Key Tables

**users** - User accounts and roles
**marketplaces** - Marketplace definitions (Amazon US, Wayfair UK, etc.)
**user_marketplace_permissions** - Who can access which marketplace
**production_requests** - All production requests from all marketplaces

### External Reference
**products** (external DB) - Referenced by `iwasku` for product details

---

## 🔐 Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:pass@host:5432/manumaestro_db"
PRODUCT_DB_URL="postgresql://user:pass@host:5432/products_db"

# Security
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="7d"

# App Config
NODE_ENV="development"
PORT=3000
NEXT_PUBLIC_APP_NAME="ManuMaestro"
```

---

## 📝 Usage

### Adding a New Marketplace
1. Navigate to Admin > Marketplaces
2. Click "Add Marketplace"
3. Fill in name, code, type, and region
4. Assign permissions to users

### Entering Production Requests

**Manual Entry:**
1. Select marketplace from dashboard
2. Choose product (IWASKU) from dropdown
3. Enter quantity
4. Submit

**Excel Import:**
1. Download template from marketplace page
2. Fill in: iwasku, quantity
3. Upload Excel file
4. Review and confirm

### Viewing Manufacturing Dashboard
1. Go to Manufacturer section
2. See total quantities needed per product
3. Expand to see breakdown by marketplace
4. Filter by category as needed

---

## 🛠️ Development

### Key Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
npx prisma studio    # Open database GUI
npx prisma migrate   # Run migrations
```

### Adding New Features
1. Update Prisma schema if needed (`prisma/schema.prisma`)
2. Run `npx prisma migrate dev`
3. Create API routes in `app/api/`
4. Build UI components in `components/`
5. Add pages in `app/`

---

## 🚀 Production Deployment

### Live Application
- **URL**: https://manumaestro.apps.iwa.web.tr
- **Server**: 78.47.117.36:2222 (SSH)
- **Location**: /var/www/manumaestro
- **Process Manager**: PM2 (process name: manumaestro)
- **Port**: 3004 (proxied via Nginx)
- **SSL**: Let's Encrypt (auto-renewed)

### Current Statistics (Feb 2026)
- **Production Requests**: 630+ active
- **Marketplaces**: 10 configured
- **Top Categories**:
  - IWA Metal (244 requests)
  - IWA Ahşap (112 requests)
  - CFW Ahşap Harita (94 requests)
- **Users**: SSO integrated with apps-sso-backend

### Deployment Commands
```bash
# SSH to server
ssh -p 2222 root@78.47.117.36

# Navigate to app directory
cd /var/www/manumaestro

# Pull latest changes
git pull origin main

# Install dependencies (if package.json changed)
npm install

# Build production bundle
npm run build

# Restart PM2 process
pm2 restart manumaestro

# Check logs
pm2 logs manumaestro --lines 50
```

---

## 📈 Roadmap

- [x] Kanban workflow board with drag-and-drop
- [x] SSO authentication integration
- [x] Month-based request filtering
- [x] Category-based workflow management
- [ ] Bulk workflow stage updates
- [ ] Real-time production status notifications
- [ ] Email notifications for new requests
- [ ] Advanced analytics and reporting
- [ ] Mobile app
- [ ] API integrations with marketplaces
- [ ] Automated request imports from Excel/CSV

---

## 🤝 Contributing

This is an internal project. For access or contributions, contact the development team.

---

## 📄 License

Proprietary - Internal Use Only

---

## 📞 Support

For technical support or questions:
- **Production URL**: https://manumaestro.apps.iwa.web.tr
- **SSO Login**: Via apps-sso-backend
- **GitHub**: https://github.com/ahmtersoy23-ui/manumaestro

---

**ManuMaestro** - *Orchestrating Production Excellence* 🎼
