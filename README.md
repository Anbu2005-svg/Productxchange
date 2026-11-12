# ProductXchange

> **Location-Based Peer-to-Peer Student Marketplace**  
> *Final Year Engineering Project — Anbu*

ProductXchange is a decentralized, location-first peer-to-peer marketplace tailored specifically for college student communities. It facilitates buying, selling, exchanging, renting, and donating academic and campus essentials (textbooks, lab equipment, calculators, electronics, project components) with built-in privacy protection, proximity discovery, and negotiation workflows.

---

## Key Features & Highlights

- **Proximity-Based Discovery**: Instant geospatial distance sorting and filtering powered by PostGIS spatial queries.
- **Privacy-by-Design Architecture**:
  - Exact pickup locations (`pickup_area`) are masked and only revealed once a transaction is explicitly **CONFIRMED**.
  - Public listing coordinates are blurred (~1.1 km resolution) to protect student dorm and residential privacy.
- **Offer & Negotiation State Machine**:
  - Multi-stage transaction pipeline: `PENDING` ➔ `COUNTERED` ➔ `ACCEPTED` ➔ `CONFIRMED` ➔ `COMPLETED` / `CANCELLED`.
  - Strict counterparty authorization: users cannot accept, reject, or counter their own offers.
  - Double-party completion sign-off: both buyer and seller must confirm handover before the transaction moves to `COMPLETED` and the listing is marked `SOLD`.
- **Trust & Safety Enforcement**:
  - User reporting and mutual blocking system.
  - Blocked users and suspended accounts are automatically filtered out of all search feeds and listing pages.
  - Native password hashing using salted bcrypt and secure JWT authentication via `httpOnly` cookies.
- **AI-Assisted Listing & Hybrid Search**:
  - Image attribute recognition and automated description generation modules.
  - Category price estimation based on transaction history.
  - Database support for 1024-dimensional semantic embeddings (BGE-M3) with HNSW vector indexing.

---

## Tech Stack

| Component | Technology |
|---|---|
| **Frontend** | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| **Backend API** | FastAPI, Python 3.12, Uvicorn, Pydantic v2 |
| **Database & ORM** | PostgreSQL 16, PostGIS, pgvector, SQLAlchemy 2.0, Alembic (Supabase) |
| **Cloud Storage** | Supabase Storage (BaaS) & Local Static Fallback (Zero AWS S3) |
| **Caching & OTP** | Redis (with in-memory fallback & rate limiting) |
| **Testing** | Pytest, HTTPX, SQLite Spatial Test Engine |
| **Infrastructure** | Supabase BaaS, Docker, GitHub Actions |

---

## Running Locally (No Docker Required)

### 1. Prerequisites
- **Python 3.12+**
- **Node.js 18+ & npm**

### 2. Backend Setup
1. Open a terminal in the project root:
   ```bash
   # Create and activate Python virtual environment
   python -m venv venv
   .\venv\Scripts\Activate.ps1    # On Windows PowerShell
   # source venv/bin/activate     # On Linux / macOS

   # Install dependencies
   pip install -r backend/requirements.txt
   ```

2. Configure environment:
   ```bash
   cp backend/.env.example backend/.env
   ```

3. Seed Demo Data (for presentation & testing):
   ```bash
   python backend/seed_demo.py --sqlite
   ```
   Pre-loads verified student accounts (`anbu@college.edu`, `priya@pes.edu`, etc. with password `Password123!`), 12 realistic campus listings with photos, and active negotiation deals.

4. Run the backend API server:
   ```bash
   python -m uvicorn app.main:app --app-dir backend --reload --port 8000
   ```
   - **Interactive API Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)
   - **Health Endpoint**: [http://localhost:8000/health](http://localhost:8000/health)

### 3. Frontend Setup
1. In a separate terminal, navigate to the `frontend` folder:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
2. Open your browser at [http://localhost:3000](http://localhost:3000).

---

## Running the Automated Test Suite

A complete suite of **132 automated unit, integration, and adversarial security tests** verifies authentication, access control, state machine transitions, privacy enforcement, search filtering, and penetration loopholes:

```bash
# Run all tests with pytest
.\venv\Scripts\pytest backend\tests -v
```

### Test Coverage Summary (132 Passing Tests across 19 Test Modules):
- **`test_audit_improvements_and_features.py`**: 5 comprehensive verification tests covering the end-to-end rental return circular economy lifecycle (`ACTIVE` ➔ `RENTED` ➔ return confirmation ➔ `ACTIVE`), strict `confirm()` counterparty authorization, student watchlist / saved items collection and toggling, memory-safe streaming CSV export, and full CORS `PUT` allowance.
- **`test_hacker_penetration_suite.py`**: 12 hacker penetration tests verifying zero-day defenses: blocking mutations on SOLD/REMOVED items, auto-cancelling orphaned negotiations upon account closure, blocking third-party spoofed product IDs in chat, brute-force PIN rate-limiting, zero/negative price guards on buy listings, spatial coordinate bounding [-90, 90], inverted price window validation, insecure HTTP attachment blocking, spreadsheet formula injection defense (CWE-1236), 24h bump spam cooldowns, and cross-conversation access denial.
- **`test_adversarial_security_suite.py`**: 13 penetration test cases preventing rug-pull deletions, ghost product messaging, suspended account exploitation, algorithm-none JWT bypasses, stored XSS, self-blocking, and invalid targets.
- **`test_all_features_master_suite.py`**: Comprehensive end-to-end integration across all 14 core system capabilities.
- **`test_auth.py` & `test_admin_and_auth_conditions.py`**: User registration, credential verification, admin capabilities, suspended account lockout, OTP rate-limiting, and `httpOnly` cookie lifecycle.
- **`test_transactions.py` & `test_transaction_conditions.py`**: State machine transitions, negotiation rules, handshake PIN verification, dual-party sign-off, and counterparty authorization.
- **`test_products.py` & `test_product_conditions.py`**: Product CRUD, pickup area masking for strangers, revealed pickup for confirmed deals, coordinate blurring, and blocked user exclusion.
- **`test_multi_campus_and_3d.py`**: Multi-campus aggregation, college-specific filtering, and 360° turntable asset handling.
- **`test_chat_and_trust_conditions.py`**: Real-time messaging, unread counts, reviews, reports, and mutual blocking.
- **`test_geospatial_and_notification_conditions.py`**: PostGIS spherical distance math, proximity sorting, and notification triggers.
- **`test_analytics_and_websockets.py`**: Campus sustainability analytics and real-time deal WebSockets.
- **`test_health.py`**: API service availability and health checks.

---

## Database Migrations

Database schema changes are managed via Alembic:

- **`0001_initial`**: Base tables for users, products, transactions, offers, conversations, messages, reviews, reports, and blocks with PostGIS geography indexing.
- **`0002_add_embeddings_and_completion_flags`**: Adds `buyer_completed` and `seller_completed` flags to transactions, plus `embedding vector(1024)` with HNSW index for semantic AI search.

To apply migrations against a PostgreSQL instance:
```bash
cd backend
alembic upgrade head
```

---

## Project Structure

```
productxchange/
├── backend/
│   ├── alembic/              # Database migration versions & configurations
│   ├── app/
│   │   ├── ai/               # Vision, description, pricing & hybrid search modules
│   │   ├── core/             # Configuration, database engine & security/auth
│   │   ├── models/           # SQLAlchemy database models
│   │   ├── routers/          # API route endpoints (auth, products, transactions, etc.)
│   │   ├── schemas/          # Pydantic data validation schemas
│   │   └── services/         # State machine & business logic services
│   ├── tests/                # Automated pytest test suite
│   ├── requirements.txt      # Python dependencies
│   └── alembic.ini           # Alembic migration configuration
├── frontend/
│   ├── src/
│   │   ├── app/              # Next.js App Router pages (browse, details, login, admin)
│   │   ├── components/       # Reusable UI components
│   │   └── lib/              # Client API helper & authentication utilities
│   ├── package.json          # Node dependencies & build scripts
│   └── tailwind.config.js    # Design system configuration
├── infra/
│   └── terraform/            # AWS Cloud infrastructure (VPC, RDS, S3, ECS)
└── .github/workflows/        # CI/CD pipelines (test, lint, deploy)
```

---

## Author

**Anbu**  
Final Year Project — ProductXchange
