# InboxOffers — Multi-Email Promotional Offer Scanner

A full-stack **Next.js (TypeScript) + Tailwind CSS + PostgreSQL (Prisma)** application that lets users connect multiple email accounts, scans the **last 30 days** of emails for promotional offers using **Gemini structured extraction** (with heuristic fallback), runs **automatically on a nightly schedule (2:00 AM)**, and provides a **Manual Refresh** trigger.

## Key Features

- **Connect Multiple Email Accounts**:
  - Connect real Gmail accounts via Google OAuth 2.0 (`gmail.readonly` scope) or add instant Demo Inbox accounts to test multi-inbox filtering.
- **30-Day Rolling Scan Window**:
  - Queries promotional emails from the last 30 days (`newer_than:30d`) and deduplicates by `(emailAccountId, messageId)`.
- **Automated Nightly Scan + Manual Refresh**:
  - Built-in nightly cron job (`0 2 * * *`) via `src/instrumentation.ts` (`node-cron`) and `/api/cron/nightly-scan` (compatible with Vercel Cron / GitHub Actions).
  - One-click **Manual Refresh** button in the top navigation bar.
- **Offers Grouped by Merchant in Card Format**:
  - Displays each merchant's logo/favicon, discount badge, offer title, description, one-click copyable promo code, receiving email address, and expiration countdown.
- **Comprehensive Filtering & Dismiss Action**:
  - Filter by **Category** (`Fashion`, `Food & Dining`, `Tech`, `Travel`, `Beauty`, `Home`, `Entertainment`, `Other`)
  - Filter by **Code Only** (only offers containing an explicit promo code)
  - Filter by **Email ID** (`emailAccountId` selector and inbox bar)
  - Filter by **Expiration** (`Active & Non-Expired`, `Expiring Soon ≤ 7 days`, `No Expiration Date`, `All`)
  - **Dismiss Offer** (`X` button on every card) permanently hides dismissed offers from the listing.

## Quick Start

### 1. Start PostgreSQL & Configure Environment

```bash
cp .env.example .env
docker compose up -d
```

### 2. Install Dependencies, Push Schema & Seed Demo Data

```bash
npm install
npm run db:push
npm run db:seed
```

### 3. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
