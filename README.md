# ShareBite — Food Redistribution Platform

ShareBite is a full-stack surplus food redistribution platform connecting generous food donors with local NGOs. The system features a reliable, deterministic AI-assisted food prioritization system based **exclusively on food expiry dates**.

---

## Key Features

1. **AI Food Prioritization (Expiry Date Only)**:
   - Priority is calculated deterministically on the backend using the current calendar date and the food's expiry date.
   - **🔴 CRITICAL**: Food expired in the past or expires today. Food expiring today requires urgent review; expired food is marked `EXPIRED` and strictly prohibited from redistribution.
   - **🟠 HIGH**: Food expires within the next 1–2 days.
   - **🟡 MEDIUM**: Food expires in 3–5 days.
   - **🟢 LOW**: Food expires in more than 5 days.
   - Backend is the single source of truth; client-provided priority is never trusted.

2. **Donor Portal & Donation Form**:
   - **Mandatory Expiry Date**: Strict entry and display format in `DD/MM/YYYY` (e.g., `16/10/2026`). Invalid calendar dates (e.g. `32/13/2026`) and missing dates are rejected on both frontend and backend.
   - **Mandatory Food Photo**: Food photo upload is compulsory (JPG, JPEG, PNG, WebP up to 5MB). Photo preview and replacement before submission are provided. Images are preserved persistently for display on NGO dashboards.
   - Unnecessary external AI vision API calls have been completely removed from the donation creation workflow.

3. **NGO Dashboard**:
   - Each donation card displays food photo, food name, quantity, donor information, pickup location, expiry date in `DD/MM/YYYY`, days remaining until expiry, priority badge, and donation status.
   - Available food donations are sorted by urgency:
     1. Highest priority first (`CRITICAL` → `HIGH` → `MEDIUM` → `LOW`).
     2. Earliest expiry date first.
     3. Stable secondary sort by donation ID.
   - Expired donations are prevented from appearing in the available redistribution feed and cannot be accepted by NGOs.

---

## Date Format & Validation Rules

- **User Interface**: `DD/MM/YYYY` (e.g., `16/10/2026`)
- **Database Storage**: ISO `YYYY-MM-DD` (e.g., `2026-10-16`)
- **Validation**: Strict leap year and month-end validation (rejects invalid days like `31/04/2026` or `29/02/2025`).
- **Timezone Safety**: Dates are compared at local calendar midnight boundaries to prevent UTC day-shift errors.

---

## Environment Variables (`.env`)

Configure the following variables in `.env` as needed:

```env
# Server Port
PORT=3001

# Optional Map Services (MapTiler or Google Maps)
MAPTILER_API_KEY="your_maptiler_api_key"
GOOGLE_MAPS_API_KEY=""

# Persistent Hosted Database (Optional for remote production deployment)
# DATABASE_URL="postgresql://user:password@host/dbname"
```

*Note: No AI API key is required to create donations or compute food priorities.*

---

## Running Locally

1. Clone or navigate to the repository:
   ```bash
   cd ShareBite
   ```

2. Run automated test suite:
   ```bash
   node tests/test_scenarios.js
   ```

3. Start the application:
   ```bash
   node server.js
   ```

4. Open [http://localhost:3001](http://localhost:3001) in your browser.

---

## Testing Scenarios

Run the automated test suite covering all 14 required scenarios:
```bash
node tests/test_scenarios.js
```

All 14 tests validate:
- TEST 1: Expiry date Today → `CRITICAL`; requires urgent review.
- TEST 2: Expiry date Tomorrow → `HIGH`.
- TEST 3: Expiry date Two days from today → `HIGH`.
- TEST 4: Expiry date Four days from today → `MEDIUM`.
- TEST 5: Expiry date Seven days from today → `LOW`.
- TEST 6: Expiry date Yesterday → `EXPIRED`; unavailable for acceptance.
- TEST 7: Missing expiry date → Rejected.
- TEST 8: Invalid date (e.g. `32/13/2026`) → Rejected.
- TEST 9: Missing food image → Rejected.
- TEST 10: Valid image → Saved persistently and displayed on NGO dashboard.
- TEST 11: Multi-item sorting → Sorted by urgency (CRITICAL → HIGH → MEDIUM → LOW) and earliest expiry.
- TEST 12: Backend restart → Data and image persist.
- TEST 13: Donation dynamic expiration → Status updates dynamically.
- TEST 14: NGO attempt to accept expired food → Rejected by backend.

---

## Deploying to Vercel

1. **Vercel Serverless Configuration**:
   The repository includes [`vercel.json`](file:///d:/Projects/ShareBite/vercel.json) and [`api/index.js`](file:///d:/Projects/ShareBite/api/index.js) configuring Node.js serverless functions.

2. **Persistent Storage**:
   - **Database**: When deploying to Vercel serverless environments, local `/tmp` files are ephemeral between container cold starts. Configure a hosted database (such as Turso LibSQL, Supabase Postgres, or Neon) using `DATABASE_URL`.
   - **Images**: Uploaded image data is stored as persistent data URIs directly within donation database records or in configured external cloud storage (e.g. Cloudinary / Vercel Blob), avoiding temporary serverless filesystem loss.

3. **Deploy via Vercel CLI**:
   ```bash
   vercel
   ```
   Or import the Git repository into the [Vercel Dashboard](https://vercel.com/new).
