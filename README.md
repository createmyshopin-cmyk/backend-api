# backend-api (NestJS + Supabase REST API)

This is the production backend application for the coin-based voice calling system. It is built using the NestJS framework and relies on Supabase PostgreSQL for persistent database storage, Firebase Admin SDK for auth verification & FCM push alerts, Agora for token generation, and Razorpay for payment coin transactions.

---

## Technical Stack
- **Framework**: NestJS (Node.js)
- **Database**: Supabase PostgreSQL
- **Realtime / Ledgers**: Supabase + custom PG functions
- **Auth**: Firebase JWT Verification
- **Video/Voice RTC**: Agora SDK
- **Payment Processing**: Razorpay Gateway

---

## Local Development Setup

### 1. Prerequisite Installations
- Node.js (v18.x or v20.x recommended)
- npm (v9.x or later)

### 2. Dependency Installation
Run the following command in the repository root directory:
```bash
npm install
```

### 3. Environment Variable Configuration
Copy the template `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Fill in the credentials in `.env` (refer to the **Environment Variables Reference** section below).

### 4. Database Migrations
Database tables are initialized using Supabase migrations located under the `supabase/migrations/` folder. Ensure migrations are applied on your remote instance using the Supabase CLI:
```bash
npx supabase db push
```

### 5. Running the Application
To run the server in hot-reload watch mode:
```bash
npm run start:dev
```
The server will start on the port configured in `.env` (default is `5000`).
Open [http://localhost:5000/api](http://localhost:5000/api) for Swagger documentation (if running).

---

## Environment Variables Reference

Ensure these configuration keys are specified in your environment:

| Key | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Local server port | `5000` |
| `JWT_SECRET` | Secret key used to sign NestJS internal tokens | `long-random-string-at-least-32-chars` |
| `SUPABASE_URL` | Supabase endpoint URL | `https://xxxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role API Key | `eyJhbGciOiJIUzI1NiIsInR5...` |
| `FIREBASE_PROJECT_ID` | Firebase ID for authentication verification | `calling-app-firebase-id` |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin Service Account email | `firebase-adminsdk@xxxx.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin Service Account private key | `"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"` |
| `AGORA_APP_ID` | App ID from Agora developer dashboard | `09725e40253f4465...` |
| `AGORA_APP_CERTIFICATE` | Agora Certificate for secure token generation | `2b822a85cfa742...` |
| `RAZORPAY_KEY_ID` | Razorpay Key ID | `rzp_test_xxxxxx` |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret | `mockKeySecretxxxxxx` |

---

## Production Deployment: Railway

Railway is the recommended host for deploying the NestJS API:

1. **Create Repository**: Push this code to a private GitHub repository.
2. **Setup Railway Project**:
   - Go to [Railway.app](https://railway.app) and log in.
   - Click **New Project** → **Deploy from GitHub repo** and select your repository.
3. **Configure Environment Variables**:
   - In your Railway service settings, navigate to the **Variables** tab.
   - Add all key-value entries from `.env.example` (ensure `PORT` is set to `5000`).
4. **Build Config**:
   - Railway will automatically detect the `package.json` file and use the `npm run build` and `npm start` commands.
   - Set the `NPM_CONFIG_PRODUCTION` variable to `false` if build dependencies are required at compile time.
5. **Generate Domain**:
   - In the **Settings** tab under **Networking**, click **Generate Domain** or map a custom DNS domain to expose the server.

---

## Verification & Audits

Before every deployment, execute the pre-launch readiness checks to verify database integrity, matching ledgers, and secure controller routing guards:
```bash
node scripts/final-production-audit.mjs
```
This script returns exit code `0` on success and logs the Database Health Score.
