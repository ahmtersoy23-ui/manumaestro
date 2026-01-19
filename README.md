# 🎼 ManuMaestro

**Production Request Management System**
*Orchestrating Production Excellence*

ManuMaestro is a comprehensive platform for managing production requests across multiple marketplaces. It consolidates orders from Amazon, Wayfair, Takealot, Bol, and other custom marketplaces into a unified manufacturing dashboard.

---

## 🎯 Features

### Multi-Marketplace Support
- **Amazon**: US, EU, UK, CA, AU
- **Wayfair**: US, UK
- **Takealot**: South Africa
- **Bol**: Netherlands
- **Custom Marketplaces**: Add any marketplace dynamically

### Data Entry Options
- ✅ **Manual Entry**: Select products via dropdown/autocomplete
- ✅ **Excel Bulk Import**: Upload spreadsheets with multiple requests
- ✅ Auto-populated product details (name, category) from existing product database

### Intelligent Aggregation
- **Input/Requested View**: All marketplace requests in one place
- **Manufacturer Dashboard**: Consolidated production requirements by product
- **Multi-column Breakdown**: See exactly which marketplace needs what quantity
- **Category-based Filtering**: Organize production by product categories

### User Management
- Role-based access control (Admin, Operator, Viewer)
- Marketplace-level permissions
- Audit trail for all entries

---

## 🏗️ Technology Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Styling**: Tailwind CSS
- **Authentication**: JWT + bcrypt

---

## 📦 Project Structure

```
manumaestro/
├── app/
│   ├── api/              # API routes
│   │   ├── auth/         # Authentication endpoints
│   │   ├── marketplaces/ # Marketplace CRUD
│   │   ├── requests/     # Production requests
│   │   └── products/     # Product lookup
│   ├── dashboard/        # Main dashboard
│   ├── auth/             # Login/signup pages
│   └── layout.tsx        # Root layout
├── components/
│   ├── ui/               # Reusable UI components
│   ├── forms/            # Form components
│   └── tables/           # Table components
├── lib/
│   ├── db/               # Database utilities
│   ├── auth/             # Auth helpers
│   └── utils/            # General utilities
├── prisma/
│   └── schema.prisma     # Database schema
├── types/                # TypeScript types
└── public/               # Static assets
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

## 📈 Roadmap

- [ ] Real-time production status tracking
- [ ] Email notifications for new requests
- [ ] Advanced analytics and reporting
- [ ] Mobile app
- [ ] API integrations with marketplaces
- [ ] Automated request imports

---

## 🤝 Contributing

This is an internal project. For access or contributions, contact the development team.

---

## 📄 License

Proprietary - Internal Use Only

---

## 📞 Support

For technical support or questions:
- Internal Slack: #manumaestro-support
- Email: dev-team@yourcompany.com

---

**ManuMaestro** - *Orchestrating Production Excellence* 🎼
