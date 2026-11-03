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
| **Database & ORM** | PostgreSQL 16, PostGIS, pgvector, SQLAlchemy 2.0, Alembic |
| **Caching & OTP** | Redis (with in-memory fallback & rate limiting) |
| **Testing** | Pytest, HTTPX, SQLite Spatial Test Engine |
| **Infrastructure** | Terraform, AWS ECS, RDS, S3, Docker, GitHub Actions |

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

A complete suite of automated unit and integration tests verifies authentication, access control, state machine transitions, privacy enforcement, and search filtering:

```bash
# Run all tests with pytest
.\venv\Scripts\pytest backend\tests -v
```

### Test Coverage Summary:
- **`test_auth.py`**: User registration, duplicate prevention, credential verification, suspended account blocking, OTP rate-limiting, and `httpOnly` cookie lifecycle.
- **`test_transactions.py`**: Offer creation, authorization enforcement (preventing self-accept/counter), negotiation flow, and dual-party confirmation and completion.
- **`test_products.py`**: Product CRUD, pickup area masking for strangers, revealed pickup for confirmed deals, coordinate blurring, and blocked user exclusion.
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
