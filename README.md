<p align="center">
  <img src="public/brand/logo-lockup-light.png" alt="TaskPulse logo" width="480" />
</p>

# ⚡ TaskPulse

<div align="center">

[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x%20%2F%207.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_%26_Auth-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Paystack](https://img.shields.io/badge/Paystack-Banking_Rails-09A5DB?style=for-the-badge&logo=paystack&logoColor=white)](https://paystack.com/)
[![Vercel](https://img.shields.io/badge/Vercel-Serverless_Deployed-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge)](https://opensource.org/licenses/Apache-2.0)

**A high-performance, monochromatic Nigerian FinTech micro-tasking and automated escrow payout platform.**

[Live Application](https://taskpulse.website) • [Key Features](#-key-features) • [System Architecture](#-system-architecture) • [FinTech Invariants](#-fintech-invariants--business-rules) • [API Reference](#-api-endpoints-reference) • [Setup Guide](#-getting-started--local-development)

</div>

---

## 📖 Overview

**TaskPulse** is a production-grade digital micro-tasking and liquidity rewards platform engineered specifically for the Nigerian digital economy. It allows users to complete verified social engagement and app-testing tasks, claim daily login streak rewards, grow through referral networks, and execute instant, automated bank withdrawals directly into any verified Nigerian bank account (commercial banks & digital MFBs like Moniepoint, OPay, and Kuda).

Built with a modern web stack—**React 19**, **TypeScript**, **Tailwind CSS v4**, **Supabase (PostgreSQL with RLS + Auth + Storage)**, **Paystack Payment Gateway**, and **Vercel Serverless Functions**—TaskPulse enforces rigorous financial integrity, double-entry bookkeeping, and concurrency protection.

---

## 🚀 Key Features

### 1. 💼 Dynamic Micro-Task Engine
- Real-time catalog of high-converting micro-tasks (app testing, surveys, social engagement).
- Database-backed task definitions with slot tracking and dynamic countdown timers for task drops.
- Proof submission workflow supporting screenshot uploads directly to secure **Supabase Storage** (`taskpulse-proofs` bucket) with instant SLA review settlement.

### 2. 🏦 Bank-Grade Paystack Integration
- **Direct Card & Transfer Funding**: Secure account activation and deposit processing via Paystack API with server-side validation.
- **Real-Time NUBAN Resolution**: Resolves 10-digit Nigerian bank account numbers to validated account holder names across 20+ commercial and microfinance banks (Moniepoint, OPay, Kuda, GTBank, Zenith, Access, UBA, First Bank, etc.).
- **Automated Payouts (Transfers)**: Direct disbursement to bank accounts via Paystack Transfer Recipient rails (`RCP_...`) with idempotent retry protection.

### 3. 📈 Progressive 6-Tier Return System (8x to 10x Caps)
- High-yield tier architecture structured with strict cumulative cashout ceilings and daily liquidation limits:
  - **Bronze Pulse**: ₦3,000 Stake | ₦24,000 Max Cumulative Cap (8x) | ₦10,000 Daily Max
  - **Silver Pulse**: ₦10,000 Stake | ₦80,000 Max Cumulative Cap (8x) | ₦25,000 Daily Max
  - **Gold Pulse**: ₦15,000 Stake | ₦120,000 Max Cumulative Cap (8x) | ₦40,000 Daily Max
  - **Platinum Pulse**: ₦30,000 Stake | ₦250,000 Max Cumulative Cap (8.33x) | ₦75,000 Daily Max
  - **Diamond Pulse**: ₦50,000 Stake | ₦450,000 Max Cumulative Cap (9x) | ₦120,000 Daily Max
  - **Black Crown VIP**: ₦75,000 Stake | ₦750,000 Max Cumulative Cap (10x) | ₦200,000 Daily Max
- Tier upgrades can be purchased directly from wallet balances via PostgreSQL atomic procedures.

### 4. 👥 Referral Growth Network & 100% Match
- **Instant Referral Commissions**: Referrers earn an instant **₦1,000 cash credit** for each referee who activates with the entry ₦3,000 deposit.
- **100% Deposit Double Bonus**: Referrers who bring in 3 qualified members with ₦9,000+ total volume receive a 100% initial deposit match bonus.
- Real-time referral lineage and qualification tracking.

### 5. 🔥 Daily Login Streak Engine
- Daily rewards of **₦450** per calendar day for active members.
- Strict timezone evaluation locked to **West Africa Time (WAT / `Africa/Lagos`)**.
- Anti-exploit check preventing multiple claims within the same calendar day.

### 6. 🎨 Sleek Monochromatic UI / UX
- Clean, focused mobile-first interface designed with custom typography, dark/light theme switching, glassmorphic accents, and responsive layout.
- Micro-animations powered by **Motion** (Framer Motion) and celebration dynamics with **Canvas Confetti**.
- Tabbed navigation: **Home (Compass)**, **Tasks (CheckSquare)**, **Withdraw (Wallet)**, **History (History)**, and **Profile (User)**.

---

## 🔒 FinTech Invariants & Business Rules

TaskPulse enforces four strict non-negotiable financial invariants to ensure enterprise solvency and fraud prevention:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TASKPULSE INVARIANTS                            │
├────────────────────────────────────────────────────────────────────────┤
│ 1. DOUBLE-ENTRY LEDGER                                                 │
│    Every balance shift (Deposit, Cashout, Referral, Streak, Upgrade)  │
│    writes an immutable audit log to public.transactions with unique ref.│
├────────────────────────────────────────────────────────────────────────┤
│ 2. ATOMIC ROW-LEVEL LOCKING                                            │
│    Balance mutators use PostgreSQL SELECT ... FOR UPDATE on profiles   │
│    to eliminate race conditions and double-spending across serverless. │
├────────────────────────────────────────────────────────────────────────┤
│ 3. TRI-RULE CASHOUT GATING                                             │
│    • Rule A (Seasoning): 48-hour cooling period from first deposit.     │
│    • Rule B (Condition): 3 qualified referrals OR Tier 2+ upgrade.     │
│    • Rule C (Limits): ₦3,000 minimum cashout; bounded by daily & cap.  │
├────────────────────────────────────────────────────────────────────────┤
│ 4. ZERO FLOATING DEMO DATA                                             │
│    Zero simulated demo data in production ledger and task catalogs.    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Tier Architecture Breakdown

| Tier Level | Stake (₦) | Cumulative Withdrawal Cap (₦) | Multiplier | Daily Max Cashout (₦) | Referral Boost |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **🥉 Bronze Pulse** | ₦3,000 | ₦24,000 | 8.0x | ₦10,000 | 1.0x Commissions |
| **🥈 Silver Pulse** | ₦10,000 | ₦80,000 | 8.0x | ₦25,000 | 1.25x Commissions |
| **🥇 Gold Pulse** | ₦15,000 | ₦120,000 | 8.0x | ₦40,000 | 1.5x Commissions |
| **💎 Platinum Pulse** | ₦30,000 | ₦250,000 | 8.33x | ₦75,000 | 2.0x Commissions |
| **🔷 Diamond Pulse** | ₦50,000 | ₦450,000 | 9.0x | ₦120,000 | 2.5x Commissions |
| **👑 Black Crown VIP** | ₦75,000 | ₦750,000 | 10.0x | ₦200,000 | 3.0x Commissions |

---

## 🏗 System Architecture

```
                  ┌─────────────────────────────────┐
                  │       Client Frontend           │
                  │   (React 19 + Vite + Tailwind)  │
                  └──────────────┬──────────────────┘
                                 │
           ┌─────────────────────┴──────────────────────┐
           │                                            │
           ▼                                            ▼
┌──────────────────────────────┐           ┌──────────────────────────────┐
│   Vercel Serverless API      │           │      Supabase Services       │
│         (/api/*)             │           │  (Auth, DB, RLS, Storage)    │
├──────────────────────────────┤           ├──────────────────────────────┤
│ • initialize-deposit         │           │ • auth.users (Credentials)   │
│ • verify-transaction         │◄─────────►│ • public.profiles (Ledger)   │
│ • resolve-account (NUBAN)    │           │ • public.transactions        │
│ • link-bank (Recipients)     │           │ • public.referrals           │
│ • disburse-transfer (Payout) │           │ • public.task_completions    │
│ • paystack-webhook           │           │ • Storage (taskpulse-proofs) │
└──────────────┬───────────────┘           └──────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│     Paystack Gateway         │
│  (Cards, Transfers, NUBAN)   │
└──────────────────────────────┘
```

---

## 📂 Directory & File Structure

```
TASKPULSE/
├── api/                           # Vercel serverless backend endpoints
│   ├── check-db.ts                # Database health and connectivity check
│   ├── disburse-transfer.ts       # Atomic cashout disbursement via Paystack
│   ├── initialize-deposit.ts      # Paystack transaction initialization
│   ├── keep-alive.ts              # Serverless ping to prevent cold sleeps
│   ├── link-bank.ts               # Bank verification & recipient creation
│   ├── paystack-webhook.ts        # Asynchronous Paystack webhook listener
│   ├── resolve-account.ts         # Real-time NUBAN bank account resolution
│   └── verify-transaction.ts      # Deposit verification & balance settlement
├── src/                           # Client-side React 19 application
│   ├── lib/
│   │   ├── api.ts                 # Frontend adapter for /api serverless calls
│   │   └── supabaseClient.ts      # Supabase client, queries, and RPC bindings
│   ├── utils/
│   │   └── confetti.ts            # High-velocity confetti celebration effects
│   ├── App.tsx                    # Primary stateful application shell & views
│   ├── index.css                  # Tailwind CSS v4 styling & typography
│   └── main.tsx                   # React root entry point
├── supabase/                      # Database configuration & migrations
│   ├── migrations/                # Historical migration files
│   ├── 002_hardening.sql          # Free-tier optimization & index hardening
│   ├── 003_resilience.sql         # Idempotent mutation guards
│   ├── 004_auto_confirm.sql       # User auto-confirmation hooks
│   ├── 005_daily_reward_450.sql   # ₦450 Lagos-time streak claim function
│   ├── 006_remove_demo_data.sql   # Demo data elimination
│   ├── 007_referral_commission_1k.sql # ₦1,000 referral commissions & cashout RPC
│   ├── config.toml                # Supabase local environment config
│   └── schema.sql                 # Complete consolidated database schema
├── .agents/                       # Agentic runbooks & debugging skills
│   └── skills/taskpulse-debugging/# Comprehensive FinTech debugging guide
├── .env.example                   # Template environment variables
├── package.json                   # Project dependencies and script runner
├── tsconfig.json                  # Strict TypeScript compiler options
├── vercel.json                    # Vercel deployment rewrites and build specs
└── vite.config.ts                 # Vite bundler configuration
```

---

## 🗄 Database Schema & Relationships

### Core Entities:
1. **`public.profiles`**: Extends `auth.users`. Tracks `withdrawable_balance`, `pending_balance`, `tier_id`, `streak_days`, `referral_code`, `activation_timestamp`, and `is_activated`.
2. **`public.transactions`**: Double-entry ledger. Stores all `deposit`, `cashout`, `streak_reward`, `task_payout`, and `tier_upgrade` events with unique references.
3. **`public.referrals`**: Direct lineage mapping. Automatically links users using referral codes; tracks deposited amounts and qualified status (`deposited_amount >= 3000`).
4. **`public.bank_accounts`**: Stores verified Nigerian bank accounts, Paystack recipient codes (`RCP_...`), and active withdrawal targets.
5. **`public.tasks`**: Dynamic micro-task registry with rewards, step instructions, and available spots.
6. **`public.task_completions`**: User task submissions with storage URLs pointing to `taskpulse-proofs` and approval statuses.
7. **`public.tiers`**: Configuration table for tier stakes, withdrawal limits, daily caps, and reward multipliers.

### Key Database RPC Functions:
- `public.settle_deposit(reference, paid_amount)`: Atomically credits wallet balances, activates accounts, updates referral lineage, and dispenses ₦1,000 instant referral commissions.
- `public.request_cashout(user_id, amount, bank_account_id, reference)`: Enforces 48-hour cooldown, referral gating, tier allowances, and row locks before debiting balance and recording transaction.
- `public.claim_daily_reward()`: Issues ₦450 daily login bonus based on Nigerian Standard Time (`Africa/Lagos`).
- `public.execute_financial_mutation(...)`: Centralized, row-locked financial mutator with anti-double-entry protection.
- `public.check_user_exists(email, username, phone)`: Secure duplicate-detection RPC accessible pre-signup across RLS.

---

## 🔌 API Endpoints Reference

All backend endpoints run as Vercel Serverless Functions under `/api`:

### `POST /api/initialize-deposit`
Initializes a Paystack deposit transaction for wallet funding or initial activation.
- **Headers**: `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`
- **Request Body**:
  ```json
  {
    "amount": 3000,
    "email": "user@example.com"
  }
  ```
- **Response**: Returns Paystack authorization URL and checkout reference.

### `GET /api/verify-transaction`
Verifies transaction status with Paystack and settles balance in Supabase.
- **Query Params**: `?reference=ref_deposit_123`
- **Response**: Settle confirmation with updated activation status and balances.

### `GET /api/resolve-account`
Resolves a Nigerian 10-digit NUBAN against a selected bank.
- **Headers**: `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`
- **Query Params**: `?accountNumber=0123456789&bankCode=50515`
- **Response**:
  ```json
  {
    "status": true,
    "accountName": "JOHN DOE",
    "accountNumber": "0123456789",
    "bankCode": "50515"
  }
  ```

### `POST /api/link-bank`
Generates a Paystack Transfer Recipient (`RCP_...`) and registers bank account to user profile.
- **Headers**: `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`
- **Request Body**:
  ```json
  {
    "bankCode": "50515",
    "bankName": "Moniepoint MFB",
    "accountNumber": "0123456789",
    "accountName": "JOHN DOE"
  }
  ```

### `POST /api/disburse-transfer`
Initiates an atomic bank cashout using Paystack Transfer API with server-side validation.
- **Headers**: `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`
- **Request Body**:
  ```json
  {
    "amount": 5000,
    "bankAccountId": "uuid-bank-id",
    "idempotencyKey": "cashout_uuid_timestamp"
  }
  ```

### `POST /api/paystack-webhook`
Listens for asynchronous Paystack events (`charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed`) with HMAC SHA-512 signature validation (`x-paystack-signature`).

---

## ⚙️ Getting Started & Local Development

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)
- A [Supabase](https://supabase.com/) project (Free tier supported)
- A [Paystack](https://paystack.com/) developer account (Test or Live keys)

### 1. Clone the Repository
```bash
git clone https://github.com/geosan11/TASKPULSE.git
cd TASKPULSE
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the project root:
```bash
cp .env.example .env
```

Populate the required credentials:
```env
# Paystack Keys
VITE_PAYSTACK_PUBLIC_KEY="your_paystack_public_key_here"
PAYSTACK_SECRET_KEY="your_paystack_secret_key_here"

# Supabase Keys
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your_supabase_anon_key_here"
SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key_here"

# Application URL
APP_URL="http://localhost:3000"
```

### 4. Setup Database Schema
1. Open your **Supabase Dashboard** -> **SQL Editor**.
2. Run the consolidated schema found in [`supabase/schema.sql`](./supabase/schema.sql).
3. Execute the migration [`supabase/007_referral_commission_1k.sql`](./supabase/007_referral_commission_1k.sql) to apply the latest referral and cashout logic.
4. Verify that the **Storage Bucket** `taskpulse-proofs` has been provisioned with public read access.

### 5. Run the Local Development Server
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.

To test serverless endpoints locally alongside Vite, you can use the [Vercel CLI](https://vercel.com/docs/cli):
```bash
npx vercel dev
```

---

## 🛠 Quality Assurance & Build Commands

TaskPulse includes scripts for strict typing and production bundle compilation:

```bash
# Run TypeScript strict type verification
npm run lint

# Build production bundle with Vite
npm run build

# Preview production build locally
npm run preview
```

---

## 🚀 Deployment Guide (Vercel)

TaskPulse is configured out-of-the-box for seamless deployment on **Vercel**:

1. Push your repository to GitHub.
2. In the **Vercel Dashboard**, click **Add New Project** and import `TASKPULSE`.
3. Configure the **Build & Development Settings**:
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Add all environment variables in **Settings > Environment Variables**:
   - `VITE_PAYSTACK_PUBLIC_KEY`
   - `PAYSTACK_SECRET_KEY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_URL` (e.g. `https://taskpulse.website`)
5. Deploy! Vercel handles both client static assets and serverless functions under `/api/*` defined in [`vercel.json`](./vercel.json).
6. Set your **Paystack Webhook URL** in Paystack Dashboard Settings -> API Keys & Webhooks to:
   `https://your-domain.vercel.app/api/paystack-webhook`

---

## 🛡 Security & Compliance

- **No Secret Leakage**: `PAYSTACK_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are strictly confined to serverless functions; never exposed to the client bundle.
- **Row Level Security (RLS)**: Enforced across all Supabase tables ensuring users can only read and mutate their authorized records.
- **Webhook Verification**: Paystack webhooks require HMAC SHA-512 hash validation against the raw request body.
- **Idempotency Safeguards**: Unique cryptographic references prevent duplicate deposit crediting or double-withdrawal replays.

---

## 📄 License

This project is licensed under the **Apache-2.0 License** - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
Developed with ⚡ by the <b>TaskPulse Engineering Team</b>.
</div>
